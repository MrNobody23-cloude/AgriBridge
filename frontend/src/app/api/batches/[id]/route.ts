import { NextRequest, NextResponse } from 'next/server';
import {
    getBatchDetail,
    findBatchByIdOrCode,
    updateBatch,
    deleteBatchCascade,
    createSupplyChainEvent,
} from '@/lib/db/repositories/batches';
import { findProductById, findProductByNameInsensitive, createProduct } from '@/lib/db/repositories/catalog';
import { requireAuth, optionalAuth } from '@/lib/auth';
import { verifyBatchOnChain, generateBatchHash, registerBatchOnChain } from '@/lib/blockchain';
import { calculateTrustScore } from '@/lib/services/trustScoreService';
import { successResponse, errorResponse } from '@/lib/response';
import { createAuditLog } from '@/lib/auditLog';

// ─── GET /api/batches/[id] ────────────────────────────────────────────────────

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    // Public endpoint but optional auth for owner-specific fields
    const user = await optionalAuth(req);
    const { id } = await params;

    try {
        const batch = await getBatchDetail(id);

        if (!batch) {
            return errorResponse(`Batch ${id} not found`, 'BATCH_NOT_FOUND', 404);
        }

        if (user?.role === 'FARMER' && batch.farmerId !== user.id) {
            return errorResponse('You can only view your own batch records.', 'FORBIDDEN', 403);
        }

        // Blockchain verification
        const chainVerification = await verifyBatchOnChain(batch.batchCode, batch.blockchainHash);

        // Hide sensitive farmer details from unauthenticated or non-privileged users
        let result: unknown = { ...batch, chainVerification };
        if (!user || user.role === 'CONSUMER') {
            // Only `name` and a reduced `farmerProfile` are public — the farmer's
            // email and `_id` are not.
            //
            // Destructured from `batch` rather than from `result`: `result` is
            // `unknown` once it has been widened for the response, so narrowing
            // has to happen while the type is still known.
            //
            // `farmer` is `BatchFarmer | null`: the user row can be absent (a
            // batch whose owner was deleted), and reading `farmer.name` through
            // the `as any` that used to be here turned that into a TypeError
            // and a 500. `null` is the honest answer, and the verification page
            // already handles a missing name.
            const { farmer, ...publicBatch } = batch;
            result = {
                ...publicBatch,
                chainVerification,
                farmer: farmer
                    ? {
                        name: farmer.name,
                        farmerProfile: farmer.farmerProfile
                            ? {
                                farmName: farmer.farmerProfile.farmName,
                                location: farmer.farmerProfile.location,
                                state: farmer.farmerProfile.state,
                            }
                            : null,
                    }
                    : null,
            };
        }

        return successResponse(result);
    } catch (error: unknown) {
        console.error('Get batch error:', error);
        return errorResponse('Failed to retrieve batch', 'FETCH_ERROR', 500);
    }
}

// ─── PATCH /api/batches/[id] ──────────────────────────────────────────────────

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const authResult = await requireAuth(req, ['FARMER']);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;
    const { id } = await params;

    try {
        const batch = await findBatchByIdOrCode(id);
        if (!batch) return errorResponse(`Batch ${id} not found`, 'BATCH_NOT_FOUND', 404);

        if (batch.farmerId !== user.id) {
            return errorResponse('You can only update your own batches', 'FORBIDDEN', 403);
        }

        const body = await req.json();
        const allowedFields = ['quantity', 'unit', 'harvestDate', 'sowingDate', 'location', 'destinationCountry', 'variety'];
        const updateData: Record<string, unknown> = {};
        for (const field of allowedFields) {
            if (body[field] !== undefined) updateData[field] = body[field];
        }

        const productBefore = await findProductById(batch.productId);
        const hashedFieldsChanged =
            (body.crop !== undefined && String(body.crop).trim() !== (productBefore?.name || '')) ||
            (body.variety !== undefined && String(body.variety) !== (batch.variety || '')) ||
            (body.quantity !== undefined && Number(body.quantity) !== batch.quantity) ||
            (body.unit !== undefined && String(body.unit) !== batch.unit) ||
            (body.sowingDate !== undefined && (body.sowingDate ? new Date(String(body.sowingDate)).getTime() : null) !== (batch.sowingDate?.getTime() ?? null)) ||
            (body.harvestDate !== undefined && new Date(String(body.harvestDate)).getTime() !== batch.harvestDate.getTime()) ||
            (body.location !== undefined && String(body.location) !== batch.location) ||
            (body.destinationCountry !== undefined && String(body.destinationCountry) !== (batch.destinationCountry || ''));
        if (hashedFieldsChanged && batch.blockchainTransactionHash) {
            return errorResponse('Registration details are locked after on-chain registration. Add a dated field update to preserve the original proof.', 'BATCH_PROOF_IMMUTABLE', 409);
        }
        for (const field of ['quantity', 'harvestDate', 'sowingDate']) {
            if (updateData[field] !== undefined) {
                if (field === 'sowingDate' && (updateData[field] === '' || updateData[field] === null)) { updateData[field] = null; continue; }
                if (field === 'quantity') {
                    const quantity = Number(updateData[field]);
                    if (!Number.isFinite(quantity) || quantity <= 0) return errorResponse('Quantity must be greater than zero.', 'VALIDATION_ERROR', 400);
                    updateData[field] = quantity;
                } else {
                    const date = new Date(String(updateData[field]));
                    if (Number.isNaN(date.getTime())) return errorResponse(`Invalid ${field}.`, 'VALIDATION_ERROR', 400);
                    updateData[field] = date;
                }
            }
        }
        if (body.unit !== undefined) {
            if (typeof body.unit !== 'string' || !body.unit.trim() || body.unit.trim().length > 32) return errorResponse('Unit must be 1–32 characters.', 'VALIDATION_ERROR', 400);
            updateData.unit = body.unit.trim();
        }
        if (body.crop !== undefined) {
            if (typeof body.crop !== 'string' || !body.crop.trim() || body.crop.trim().length > 100) return errorResponse('Crop name must be 1–100 characters.', 'VALIDATION_ERROR', 400);
            let product = await findProductByNameInsensitive(body.crop.trim());
            if (!product) product = await createProduct({ name: body.crop.trim(), category: 'Agriculture', description: `${body.crop.trim()} — registered on AgriBridge AI platform` });
            updateData.productId = product._id;
        }
        if (body.variety !== undefined && (typeof body.variety !== 'string' || body.variety.length > 100)) return errorResponse('Variety must be 100 characters or fewer.', 'VALIDATION_ERROR', 400);
        if (body.destinationCountry !== undefined && (typeof body.destinationCountry !== 'string' || body.destinationCountry.length > 100)) return errorResponse('Destination must be 100 characters or fewer.', 'VALIDATION_ERROR', 400);
        if (body.variety !== undefined) updateData.variety = String(body.variety).trim();
        if (body.location !== undefined && (typeof body.location !== 'string' || !body.location.trim() || body.location.length > 200)) return errorResponse('Location must be 1–200 characters.', 'VALIDATION_ERROR', 400);

        const productAfter = body.crop ? await findProductById(String(updateData.productId)) : productBefore;
        if (hashedFieldsChanged) {
            const hasSowingDateUpdate = Object.prototype.hasOwnProperty.call(updateData, 'sowingDate');
            const hash = generateBatchHash({ batchCode: batch.batchCode, farmerId: batch.farmerId, crop: productAfter?.name || productBefore?.name || '', variety: String(updateData.variety ?? batch.variety ?? ''), quantity: Number(updateData.quantity ?? batch.quantity), unit: String(updateData.unit ?? batch.unit ?? 'kg'), sowingDate: hasSowingDateUpdate ? updateData.sowingDate instanceof Date ? updateData.sowingDate.toISOString() : null : batch.sowingDate?.toISOString(), harvestDate: new Date(String(updateData.harvestDate ?? batch.harvestDate)).toISOString(), location: String(updateData.location ?? batch.location), destinationCountry: String(updateData.destinationCountry ?? batch.destinationCountry ?? '') });
            const chain = await registerBatchOnChain(batch.batchCode, hash);
            updateData.blockchainHash = hash;
            updateData.blockchainTransactionHash = chain.transactionHash;
            updateData.blockchainMode = chain.mode;
        }
        const effectiveSowingDate = Object.prototype.hasOwnProperty.call(updateData, 'sowingDate') ? updateData.sowingDate as Date | null : batch.sowingDate;
        const effectiveHarvestDate = updateData.harvestDate instanceof Date ? updateData.harvestDate : batch.harvestDate;
        if (effectiveSowingDate && effectiveSowingDate > effectiveHarvestDate) return errorResponse('Sowing date cannot be later than expected harvest.', 'VALIDATION_ERROR', 400);

        const updated = await updateBatch(batch._id, { ...updateData, updatedAt: new Date() });
        // The Prisma `include: { product: true }` re-attached the product after
        // the write. Callers read `updated.product.name`, so re-attach it the
        // same way rather than changing the response shape.
        const product = await findProductById(updated?.productId || batch.productId);

        if (Object.keys(updateData).length > 0) {
            await createSupplyChainEvent({
                batchId: batch._id,
                eventType: 'BATCH_PROFILE_UPDATED',
                actorId: user.id,
                actorRole: user.role,
                location: String(updateData.location || batch.location),
                metadata: JSON.stringify({ fields: Object.keys(updateData), blockchainHashUpdated: Boolean(updateData.blockchainHash) }),
            });
            if (hashedFieldsChanged) calculateTrustScore(batch._id).catch(console.error);
        }

        await createAuditLog({
            userId: user.id,
            action: 'BATCH_UPDATED',
            resource: 'Batch',
            resourceId: batch._id,
            metadata: JSON.stringify(updateData),
        });

        return successResponse({ ...updated, product });
    } catch (error: unknown) {
        console.error('Update batch error:', error);
        return errorResponse('Failed to update batch', 'SERVER_ERROR', 500);
    }
}

// ─── DELETE /api/batches/[id] ─────────────────────────────────────────────────

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const authResult = await requireAuth(req, ['ADMIN']);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;
    const { id } = await params;

    try {
        const batch = await findBatchByIdOrCode(id);
        if (!batch) return errorResponse(`Batch ${id} not found`, 'BATCH_NOT_FOUND', 404);

        // Postgres did this through `ON DELETE CASCADE` on the foreign keys,
        // which is not something MongoDB offers. `deleteBatchCascade` spells the
        // fan-out out explicitly, and it keeps the batch itself if any child
        // delete fails — a half-deleted batch with live children pointing at it
        // is worse than a delete that reported what it could not remove.
        const result = await deleteBatchCascade(batch._id);

        if (!result.deleted) {
            return errorResponse(
                `Batch ${batch.batchCode} was not deleted because these records could not be removed: ${result.failed.join(', ')}`,
                'CASCADE_DELETE_FAILED',
                500
            );
        }

        await createAuditLog({
            userId: user.id,
            action: 'BATCH_DELETED',
            resource: 'Batch',
            resourceId: batch._id,
            metadata: JSON.stringify({ batchCode: batch.batchCode }),
        });

        return successResponse({ deleted: true, batchId: batch._id });
    } catch (error: unknown) {
        console.error('Delete batch error:', error);
        return errorResponse('Failed to delete batch', 'SERVER_ERROR', 500);
    }
}
