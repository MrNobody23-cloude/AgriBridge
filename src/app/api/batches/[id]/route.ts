import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
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
        const batch = await prisma.batch.findFirst({
            where: { OR: [{ id }, { batchCode: id }] },
            include: {
                product: true,
                farmer: { select: { id: true, name: true, email: true, farmerProfile: true } },
                certificates: true,
                events: { orderBy: { timestamp: 'asc' }, include: { actor: { select: { id: true, name: true, role: true } } } },
                fraudAlerts: true,
                trustScoreDetails: true,
                temperatureLogs: { orderBy: { timestamp: 'asc' }, take: 200 },
                mlPredictions: { orderBy: { createdAt: 'desc' }, take: 10 },
                shipments: {
                    include: {
                        complianceChecks: true,
                        exporter: { select: { id: true, name: true, email: true } },
                    },
                },
                ipfsDocuments: true,
            },
        });

        if (!batch) {
            return errorResponse(`Batch ${id} not found`, 'BATCH_NOT_FOUND', 404);
        }

        // Blockchain verification
        const chainVerification = await verifyBatchOnChain(batch.batchCode, batch.blockchainHash);

        // Hide sensitive farmer details from unauthenticated or non-privileged users
        let result: Record<string, unknown> = { ...batch, chainVerification };
        if (!user || (user.role === 'CONSUMER')) {
            // Remove sensitive internal fields
            const { farmer, ...publicBatch } = result as any;
            result = {
                ...publicBatch,
                farmer: {
                    name: farmer.name,
                    farmerProfile: farmer.farmerProfile
                        ? { farmName: farmer.farmerProfile.farmName, location: farmer.farmerProfile.location, state: farmer.farmerProfile.state }
                        : null,
                },
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
        const batch = await prisma.batch.findFirst({
            where: { OR: [{ id }, { batchCode: id }] },
        });
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

        const updated = await prisma.batch.update({
            where: { id: batch.id },
            data: { ...updateData, updatedAt: new Date() },
            include: { product: true },
        });

        // Record supply chain event if status changed
        if (body.status && body.status !== batch.status) {
            await prisma.supplyChainEvent.create({
                data: {
                    batchId: batch.id,
                    eventType: `STATUS_CHANGED_TO_${body.status.toUpperCase().replace(/\s+/g, '_')}`,
                    actorId: user.id,
                    location: body.location || batch.location,
                    metadata: JSON.stringify({ from: batch.status, to: body.status }),
                },
            });

            // Recalculate trust score
            calculateTrustScore(batch.id).catch(console.error);
        }

        await createAuditLog({
            userId: user.id,
            action: 'BATCH_UPDATED',
            resource: 'Batch',
            resourceId: batch.id,
            metadata: JSON.stringify(updateData),
        });

        return successResponse(updated);
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
        const batch = await prisma.batch.findFirst({ where: { OR: [{ id }, { batchCode: id }] } });
        if (!batch) return errorResponse(`Batch ${id} not found`, 'BATCH_NOT_FOUND', 404);

        await prisma.batch.delete({ where: { id: batch.id } });

        await createAuditLog({
            userId: user.id,
            action: 'BATCH_DELETED',
            resource: 'Batch',
            resourceId: batch.id,
            metadata: JSON.stringify({ batchCode: batch.batchCode }),
        });

        return successResponse({ deleted: true, batchId: batch.id });
    } catch (error: unknown) {
        console.error('Delete batch error:', error);
        return errorResponse('Failed to delete batch', 'SERVER_ERROR', 500);
    }
}
