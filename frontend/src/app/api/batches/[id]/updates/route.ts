import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createIpfsDocument, createSupplyChainEvent, findBatchByIdOrCode, updateBatch } from '@/lib/db/repositories/batches';
import { createAuditLog } from '@/lib/auditLog';
import { calculateTrustScore } from '@/lib/services/trustScoreService';
import { errorResponse, successResponse } from '@/lib/response';

const stages = ['LAND_PREPARATION', 'SOWING', 'GERMINATION', 'VEGETATIVE_GROWTH', 'FLOWERING', 'FRUITING', 'HARVEST_READY', 'HARVESTED'] as const;
const maxImageBytes = 4 * 1024 * 1024;
const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';

function validateImage(bytes: Buffer, mimeType: string) {
    if (mimeType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (mimeType === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (mimeType === 'image/webp') return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    return false;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireAuth(req, ['FARMER']);
    if (auth instanceof Response) return auth;
    const bodyLength = Number(req.headers.get('content-length') || 0);
    if (bodyLength > 6 * 1024 * 1024) return errorResponse('Update and photo must be smaller than 4 MB.', 'FILE_TOO_LARGE', 413);
    const { id } = await params;

    try {
        const body = await req.json() as Record<string, unknown>;
        const batch = await findBatchByIdOrCode(id);
        if (!batch) return errorResponse('Batch not found.', 'BATCH_NOT_FOUND', 404);
        if (batch.farmerId !== auth.user.id) return errorResponse('You can only update your own batches.', 'FORBIDDEN', 403);

        const stage = String(body.stage || '');
        const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
        const location = typeof body.location === 'string' && body.location.trim() ? body.location.trim() : batch.location;
        if (!stages.includes(stage as typeof stages[number])) return errorResponse('Choose a valid crop lifecycle stage.', 'VALIDATION_ERROR', 400);
        if (notes.length > 2000 || location.length > 200) return errorResponse('Notes or location are too long.', 'VALIDATION_ERROR', 400);

        const measurements: Record<string, string | number> = {};
        for (const field of ['weather', 'irrigation', 'fertilizer', 'pestDisease', 'soilMoisture', 'plantHeightCm', 'growthNotes']) {
            const value = body[field];
            if (value === undefined || value === null || value === '') continue;
            if (field === 'soilMoisture' || field === 'plantHeightCm') {
                const numeric = Number(value);
                if (!Number.isFinite(numeric) || numeric < 0 || (field === 'soilMoisture' && numeric > 100)) return errorResponse(`Invalid ${field}.`, 'VALIDATION_ERROR', 400);
                measurements[field] = numeric;
            } else {
                if (typeof value !== 'string' || value.length > 300) return errorResponse(`${field} must be 300 characters or fewer.`, 'VALIDATION_ERROR', 400);
                measurements[field] = value.trim();
            }
        }

        const fileBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64.replace(/^data:image\/(?:jpeg|png|webp);base64,/i, '') : '';
        let image: { cid: string; url: string; hash: string; name: string; mimeType: string; size: number } | null = null;
        if (fileBase64) {
            if (fileBase64.length > Math.ceil(maxImageBytes * 4 / 3) + 512) return errorResponse('Photo must be 4 MB or smaller.', 'FILE_TOO_LARGE', 413);
            const bytes = Buffer.from(fileBase64, 'base64');
            const mimeType = String(body.imageMimeType || '');
            if (!bytes.length || bytes.length > maxImageBytes || !validateImage(bytes, mimeType)) return errorResponse('Upload a valid JPEG, PNG or WebP photo up to 4 MB.', 'INVALID_IMAGE', 415);
            const fileName = (typeof body.imageName === 'string' ? body.imageName : `field-${stage.toLowerCase()}`).replace(/[^a-z0-9._-]/gi, '_').slice(0, 120);
            const formData = new FormData();
            formData.append('file', new Blob([bytes], { type: mimeType }), fileName);
            formData.append('batchId', batch._id);
            formData.append('docType', 'FIELD_PHOTO');
            const pinned = await fetch(`${aiServiceUrl}/api/ipfs/upload`, { method: 'POST', body: formData, signal: AbortSignal.timeout(45000) });
            if (!pinned.ok) return errorResponse('Photo storage is unavailable; the update was not recorded. Please retry when IPFS storage is online.', 'IPFS_UNAVAILABLE', 503);
            const result = await pinned.json() as { ipfsCid?: string; gatewayUrl?: string; fileHash?: string; filename?: string; mimeType?: string; sizeBytes?: number };
            if (!result.ipfsCid || !result.fileHash) return errorResponse('Photo storage did not return a valid content identifier.', 'IPFS_ERROR', 502);
            image = { cid: result.ipfsCid, url: result.gatewayUrl || `https://gateway.pinata.cloud/ipfs/${result.ipfsCid}`, hash: result.fileHash, name: result.filename || fileName, mimeType: result.mimeType || mimeType, size: result.sizeBytes || bytes.length };
        }

        const observedAt = body.observedAt ? new Date(String(body.observedAt)) : new Date();
        if (Number.isNaN(observedAt.getTime()) || observedAt.getTime() > Date.now() + 5 * 60 * 1000) return errorResponse('Update time must be a valid date and cannot be in the future.', 'VALIDATION_ERROR', 400);

        let documentId: string | null = null;
        if (image) {
            const document = await createIpfsDocument({ batchId: batch._id, ipfsCid: image.cid, fileHash: image.hash, filename: image.name, mimeType: image.mimeType, sizBytes: image.size, uploadedBy: auth.user.id, docType: 'FIELD_PHOTO' });
            documentId = document._id;
        }
        const metadata = { stage, notes, measurements, observedAt: observedAt.toISOString(), imageDocumentId: documentId, imageCid: image?.cid || null, imageUrl: image?.url || null, imageHash: image?.hash || null };
        const event = await createSupplyChainEvent({ batchId: batch._id, eventType: 'FARMER_PROGRESS_UPDATE', actorId: auth.user.id, actorRole: auth.user.role, location, timestamp: observedAt, metadata: JSON.stringify(metadata) });
        await updateBatch(batch._id, { harvestStage: stage, ...(stage === 'HARVESTED' ? { actualHarvestDate: observedAt } : {}) });
        calculateTrustScore(batch._id).catch(console.error);
        await createAuditLog({ userId: auth.user.id, action: 'BATCH_PROGRESS_UPDATED', resource: 'Batch', resourceId: batch._id, metadata: JSON.stringify({ stage, eventId: event._id, imageCid: image?.cid || null }) });
        return successResponse({ event, image: image ? { cid: image.cid, url: image.url, hash: image.hash } : null }, 201);
    } catch (error) {
        console.error('Farmer batch update error:', error);
        return errorResponse('Unable to save this crop update.', 'SERVER_ERROR', 500);
    }
}
