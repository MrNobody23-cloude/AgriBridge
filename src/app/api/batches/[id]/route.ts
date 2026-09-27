import { NextRequest, NextResponse } from 'next/server';
import {
    getBatchDetail,
    findBatchByIdOrCode,
    updateBatch,
    deleteBatchCascade,
    createSupplyChainEvent,
} from '@/lib/db/repositories/batches';
import { findProductById } from '@/lib/db/repositories/catalog';
import { requireAuth, optionalAuth } from '@/lib/auth';
import { verifyBatchOnChain } from '@/lib/blockchain';
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
    const authResult = await requireAuth(req, ['FARMER', 'EXPORTER', 'TRANSPORTER', 'ADMIN']);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;
    const { id } = await params;

    try {
        const batch = await findBatchByIdOrCode(id);
        if (!batch) return errorResponse(`Batch ${id} not found`, 'BATCH_NOT_FOUND', 404);

        // FARMER can only update their own batch
        if (user.role === 'FARMER' && batch.farmerId !== user.id) {
            return errorResponse('You can only update your own batches', 'FORBIDDEN', 403);
        }

        const body = await req.json();
        const allowedFields = ['status', 'destinationCountry', 'variety', 'notes'];
        const updateData: Record<string, unknown> = {};
        for (const field of allowedFields) {
            if (body[field] !== undefined) updateData[field] = body[field];
        }

        const updated = await updateBatch(batch._id, { ...updateData, updatedAt: new Date() });
        // The Prisma `include: { product: true }` re-attached the product after
        // the write. Callers read `updated.product.name`, so re-attach it the
        // same way rather than changing the response shape.
        const product = await findProductById(batch.productId);

        // Record supply chain event if status changed
        if (body.status && body.status !== batch.status) {
            await createSupplyChainEvent({
                batchId: batch._id,
                eventType: `STATUS_CHANGED_TO_${body.status.toUpperCase().replace(/\s+/g, '_')}`,
                actorId: user.id,
                location: body.location || batch.location,
                metadata: JSON.stringify({ from: batch.status, to: body.status }),
            });

            // Recalculate trust score
            calculateTrustScore(batch._id).catch(console.error);
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
