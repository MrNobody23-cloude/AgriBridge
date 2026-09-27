import { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/response';
import { requirePermission } from '@/lib/auth';
import { readStoredTrustScore, calculateTrustScore } from '@/lib/services/trustScoreService';

/**
 * GET /api/trust-score/[batchId]
 *
 * This used to have no authentication at all and called `calculateTrustScore`,
 * which is not read-only: it wrote `batch.trustScore` and upserted a
 * `TrustScore` record. Any anonymous caller could therefore overwrite any
 * batch's trust score using a sequential, publicly-printed batch code, and got
 * the full batch record back in the response.
 *
 * The two responsibilities are now separated:
 *
 *   GET   reads the stored score. Public, like the QR verification page, but
 *         returns only what a consumer legitimately needs and never writes.
 *   POST  recomputes the score, and requires the `ml:view` permission.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
    try {
        const { batchId } = await params;
        const stored = await readStoredTrustScore(batchId);
        if (!stored) {
            return errorResponse('Trust score has not been computed for this batch', 'TRUST_SCORE_NOT_COMPUTED', 404);
        }
        return successResponse(stored);
    } catch (error: unknown) {
        console.error('Trust score read error:', error);
        const message = error instanceof Error ? error.message : 'Failed to read Trust Score';
        return errorResponse(message, 'SERVER_ERROR', 500);
    }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
    const authResult = await requirePermission(req, 'ml:view');
    if (authResult instanceof Response) return authResult;

    try {
        const { batchId } = await params;
        const result = await calculateTrustScore(batchId);
        return successResponse(result);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : '';
        if (message.includes('not found')) {
            return errorResponse('Batch was not found', 'BATCH_NOT_FOUND', 404);
        }
        console.error('Trust score calculation error:', error);
        return errorResponse(message || 'Failed to calculate Trust Score', 'SERVER_ERROR', 500);
    }
}
