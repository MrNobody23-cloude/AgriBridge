import { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/response';
import { runSupervisorOrchestration } from '@/lib/services/agentService';
import { requireAuth } from '@/lib/auth';

/**
 * POST /api/agents/orchestrate
 * Runs the full 6-agent supervisor pipeline for a given batch.
 * Requires authentication (any role).
 */
export async function POST(req: NextRequest) {
    const session = await requireAuth(req);
    if ('status' in session) return session;

    try {
        const body = await req.json();
        const batchId: string = body.batchId || body.batchCode || '';
        if (!batchId) {
            return errorResponse('batchId is required', 'VALIDATION_ERROR', 400);
        }

        const agentResponses = await runSupervisorOrchestration(batchId);
        return successResponse({ agentResponses, total: agentResponses.length });
    } catch (error: any) {
        console.error('[Orchestrate] Error:', error);
        return errorResponse(error.message || 'Orchestration failed', 'SERVER_ERROR', 500);
    }
}
