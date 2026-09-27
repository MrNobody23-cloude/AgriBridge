import { NextRequest } from 'next/server';
import {
    listBatches,
    createBatch,
    createSupplyChainEvent,
    nextSequence,
} from '@/lib/db/repositories/batches';
import { findUserByIdWithProfile } from '@/lib/db/repositories/users';
import { findProductByNameInsensitive, createProduct, createCertificate } from '@/lib/db/repositories/catalog';
import { requirePermission } from '@/lib/auth';
import { createBatchSchema } from '@/lib/validators';
import { generateBatchHash, registerBatchOnChain } from '@/lib/blockchain';
import { calculateTrustScore } from '@/lib/services/trustScoreService';
import { runSupervisorOrchestration } from '@/lib/services/agentService';
import { successResponse, errorResponse } from '@/lib/response';
import { createAuditLog } from '@/lib/auditLog';
import { isZodError, firstValidationMessage } from '@/lib/zod-error';

// ─── GET /api/batches ─────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
    const authResult = await requirePermission(req, 'batch:read');
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    try {
        const { searchParams } = new URL(req.url);
        const query = searchParams.get('q');
        const status = searchParams.get('status');
        const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
        const offset = parseInt(searchParams.get('offset') || '0');

        // FARMER can only see their own batches. The product-name branch of the
        // old `where.OR` is resolved inside the repository, since filtering on a
        // related collection's field is a two-step query in Mongo.
        const { batches, total } = await listBatches({
            farmerId: user.role === 'FARMER' ? user.id : undefined,
            status: status ?? undefined,
            query: query ?? undefined,
            limit,
            offset,
        });

        return successResponse({ batches, total, limit, offset });
    } catch (error: unknown) {
        console.error('Error fetching batches:', error);
        return errorResponse('Failed to fetch crop batches', 'FETCH_ERROR', 500);
    }
}

// ─── POST /api/batches ────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    // Only FARMER and ADMIN can create batches
    const authResult = await requirePermission(req, 'batch:create');
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    try {
        const body = await req.json();
        const validated = createBatchSchema.parse(body);

        // Validate quantity is positive
        if (validated.quantity <= 0) {
            return errorResponse('Quantity must be a positive number', 'VALIDATION_ERROR', 400);
        }

        // Validate harvestDate is not in the future by more than 1 day
        const harvestDate = new Date(validated.harvestDate);
        if (harvestDate > new Date(Date.now() + 24 * 60 * 60 * 1000)) {
            return errorResponse('Harvest date cannot be in the future', 'VALIDATION_ERROR', 400);
        }

        // Get the authenticated farmer (not the first farmer in DB)
        const farmer = await findUserByIdWithProfile(user.id);
        if (!farmer) {
            return errorResponse('Farmer account not found', 'USER_NOT_FOUND', 404);
        }

        // Find or create product
        let product = await findProductByNameInsensitive(validated.crop);
        if (!product) {
            product = await createProduct({
                name: validated.crop,
                category: 'Agriculture',
                description: `${validated.crop} — registered on AgriBridge AI platform`,
            });
        }

        // Generate unique batch code: AGR-YYYY-ST-NNNNNN
        //
        // The sequence comes from an atomic counter rather than `count() + 1`.
        // Two farmers registering in the same instant would read the same count
        // and mint the same code, and the unique index would then reject the
        // second write with an error that says nothing about the cause.
        const year = new Date().getFullYear();
        const stateCode = (farmer.farmerProfile?.state || 'IN').substring(0, 2).toUpperCase();
        const seq = await nextSequence('batch');
        const batchCode = `AGR-${year}-${stateCode}-${String(seq).padStart(6, '0')}`;

        // Cryptographic SHA-256 hash
        const cryptographicHash = generateBatchHash({
            batchCode,
            farmerId: farmer._id,
            crop: validated.crop,
            quantity: validated.quantity,
            harvestDate: validated.harvestDate,
            location: validated.location,
        });

        // Register on Polygon blockchain. When no contract is configured this
        // returns success: false with mode 'not_configured' and a null
        // transaction hash; the batch is still created, because refusing to
        // record a harvest because the chain is off would be worse. The record
        // simply says, honestly, that it was never anchored.
        const chainRes = await registerBatchOnChain(batchCode, cryptographicHash);

        // Save batch to database
        const newBatch = await createBatch({
            batchCode,
            farmerId: farmer._id,
            productId: product._id,
            variety: validated.variety,
            quantity: validated.quantity,
            unit: validated.unit || 'kg',
            harvestDate,
            location: validated.location,
            destinationCountry: validated.destinationCountry,
            status: 'Registered',
            blockchainHash: cryptographicHash,
            blockchainTransactionHash: chainRes.transactionHash,
            blockchainMode: chainRes.mode,
            trustScore: 0, // Will be calculated below
        });

        // Record initial FARM_REGISTERED event
        await createSupplyChainEvent({
            batchId: newBatch._id,
            eventType: 'FARM_REGISTERED',
            actorId: farmer._id,
            location: validated.location,
            metadata: JSON.stringify({
                blockchainHash: cryptographicHash,
                blockchainMode: chainRes.mode,
                chainAnchored: chainRes.success,
                chainReason: chainRes.reason ?? null,
                quantity: validated.quantity,
                unit: validated.unit || 'kg',
            }),
            blockchainTransactionHash: chainRes.transactionHash,
        });

        // If certificate details provided, create it
        if (validated.certificateUrl) {
            await createCertificate({
                batchId: newBatch._id,
                certificateType: validated.certificateType || 'Phytosanitary Certificate',
                fileUrl: validated.certificateUrl,
                // The certificate document itself was never downloaded or
                // hashed here, so its content hash is unknown. The previous
                // code stored the *batch's* hash in this field, which is an
                // indexed column the fraud scanner uses to detect a
                // certificate reused across batches — copying the batch hash
                // made that check meaningless, and it would have collided
                // with the real batch-hash check. An empty string is honest
                // and simply never matches; the proper path is
                // POST /api/certificates/upload, which hashes the real file
                // and can verify it against IPFS.
                fileHash: '',
                issuer: validated.certIssuer || 'APEDA / FSSAI Authority',
                issueDate: new Date(),
                expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
                verificationStatus: 'PENDING',
            });
        }

        // Calculate trust score
        const trustResult = await calculateTrustScore(newBatch._id);

        // Run AI Supervisor multi-agent orchestration (async, don't block response)
        runSupervisorOrchestration(newBatch._id).catch(console.error);

        // Audit log
        await createAuditLog({
            userId: user.id,
            action: 'BATCH_CREATED',
            resource: 'Batch',
            resourceId: newBatch._id,
            metadata: JSON.stringify({ batchCode, crop: validated.crop, quantity: validated.quantity }),
        });

        return successResponse(
            {
                batch: { ...newBatch, trustScore: trustResult.finalScore },
                blockchain: chainRes,
                trustScore: trustResult,
            },
            201
        );
    } catch (error: unknown) {
        if (isZodError(error)) {
            return errorResponse(firstValidationMessage(error), 'VALIDATION_ERROR', 400);
        }
        console.error('Create batch error:', error);
        return errorResponse('Failed to create crop batch', 'SERVER_ERROR', 500);
    }
}
