import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requirePermission } from '@/lib/auth';
import { createBatchSchema } from '@/lib/validators';
import { generateBatchHash, registerBatchOnChain } from '@/lib/blockchain';
import { calculateTrustScore } from '@/lib/services/trustScoreService';
import { runSupervisorOrchestration } from '@/lib/services/agentService';
import { successResponse, errorResponse } from '@/lib/response';
import { createAuditLog } from '@/lib/auditLog';

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

        const where: Record<string, unknown> = {};

        // FARMER can only see their own batches
        if (user.role === 'FARMER') {
            where.farmerId = user.id;
        }

        if (status) where.status = status;
        if (query) {
            where.OR = [
                { batchCode: { contains: query, mode: 'insensitive' } },
                { location: { contains: query, mode: 'insensitive' } },
                { product: { name: { contains: query, mode: 'insensitive' } } },
            ];
        }

        const [batches, total] = await Promise.all([
            prisma.batch.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take: limit,
                skip: offset,
                include: {
                    product: true,
                    farmer: { select: { id: true, name: true, email: true, farmerProfile: true } },
                    certificates: { select: { id: true, certificateType: true, verificationStatus: true, expiryDate: true } },
                    events: { orderBy: { timestamp: 'asc' } },
                    fraudAlerts: { where: { status: { not: 'RESOLVED' } }, select: { id: true, fraudType: true, severity: true, status: true } },
                    trustScoreDetails: true,
                    _count: { select: { temperatureLogs: true } },
                },
            }),
            prisma.batch.count({ where }),
        ]);

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
        const farmer = await prisma.user.findUnique({
            where: { id: user.id },
            include: { farmerProfile: true },
        });
        if (!farmer) {
            return errorResponse('Farmer account not found', 'USER_NOT_FOUND', 404);
        }

        // Find or create product
        let product = await prisma.product.findFirst({
            where: { name: { equals: validated.crop, mode: 'insensitive' } },
        });
        if (!product) {
            product = await prisma.product.create({
                data: {
                    name: validated.crop,
                    category: 'Agriculture',
                    description: `${validated.crop} — registered on AgriBridge AI platform`,
                },
            });
        }

        // Generate unique batch code: AGR-YYYY-ST-NNNNNN
        const year = new Date().getFullYear();
        const stateCode = (farmer.farmerProfile?.state || 'IN').substring(0, 2).toUpperCase();
        const count = await prisma.batch.count();
        const batchCode = `AGR-${year}-${stateCode}-${String(count + 1).padStart(6, '0')}`;

        // Cryptographic SHA-256 hash
        const cryptographicHash = generateBatchHash({
            batchCode,
            farmerId: farmer.id,
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
        const newBatch = await prisma.batch.create({
            data: {
                batchCode,
                farmerId: farmer.id,
                productId: product.id,
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
            },
            include: { product: true, farmer: { select: { id: true, name: true, email: true, farmerProfile: true } } },
        });

        // Record initial FARM_REGISTERED event
        await prisma.supplyChainEvent.create({
            data: {
                batchId: newBatch.id,
                eventType: 'FARM_REGISTERED',
                actorId: farmer.id,
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
            },
        });

        // If certificate details provided, create it
        if (validated.certificateUrl) {
            await prisma.certificate.create({
                data: {
                    batchId: newBatch.id,
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
                },
            });
        }

        // Calculate trust score
        const trustResult = await calculateTrustScore(newBatch.id);

        // Run AI Supervisor multi-agent orchestration (async, don't block response)
        runSupervisorOrchestration(newBatch.id).catch(console.error);

        // Audit log
        await createAuditLog({
            userId: user.id,
            action: 'BATCH_CREATED',
            resource: 'Batch',
            resourceId: newBatch.id,
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
        if ((error as any).name === 'ZodError') {
            return errorResponse((error as any).errors[0]?.message || 'Validation failed', 'VALIDATION_ERROR', 400);
        }
        console.error('Create batch error:', error);
        return errorResponse('Failed to create crop batch', 'SERVER_ERROR', 500);
    }
}
