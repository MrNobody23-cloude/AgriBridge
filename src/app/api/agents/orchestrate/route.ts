import { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/response';
import { runSupervisorOrchestration } from '@/lib/services/agentService';
import { requirePermission } from '@/lib/auth';

/**
 * POST /api/agents/orchestrate
 * Runs the full 6-agent supervisor pipeline for a given batch.
 *
 * Gated on `ai:use`, not bare authentication. This route is not read-only:
 * `runSupervisorOrchestration` creates FraudAlert rows, ComplianceCheck rows
 * and can flip `batch.status` to 'Flagged'. Under a bare `requireAuth` any
 * signed-in CONSUMER could trigger all of that on any batch by naming its id.
 */
export async function POST(req: NextRequest) {
    const session = await requirePermission(req, 'ai:use');
    if (session instanceof Response) return session;

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
