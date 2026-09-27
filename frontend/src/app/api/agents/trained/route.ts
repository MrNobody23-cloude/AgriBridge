import { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/response';
import { requirePermission } from '@/lib/auth';
import { buildAgentContext, analyzeBatch, callAgent } from '@/lib/services/trainedAgentsService';

const AGENT_NAMES = ['traceability', 'quality', 'spoilage', 'fraud', 'compliance', 'trust'] as const;
type AgentName = (typeof AGENT_NAMES)[number];

/**
 * GET  /api/agents/trained            real per-agent status (Agents page)
 * POST /api/agents/trained            run one agent, or the full analysis
 *
 * Authorization is enforced here, before any database read, by
 * `requirePermission`. The Python service holds no database connection and no
 * session, so this route is the only thing standing between a caller and a
 * batch's data — which is why the context is assembled under the caller's
 * session rather than inside the service.
 *
 * An agent that declines still returns 200: the response carries
 * `status: "NOT_APPLICABLE"` and a reason, because "this batch has no residue
 * measurement" is a successful answer, not a failed request.
 */
export async function GET(req: NextRequest) {
    const authResult = await requirePermission(req, 'ai:use');
    if (authResult instanceof Response) return authResult;

    try {
        const { fetchAgentRegistry } = await import('@/lib/services/trainedAgentsService');
        const registry = await fetchAgentRegistry();

        if (!registry) {
            return successResponse({
                serviceReachable: false,
                agents: [],
                totalAgents: AGENT_NAMES.length,
                availableAgents: 0,
                message:
                    'The AI service is not reachable, so no agent status can be reported. ' +
                    'Start it with `uvicorn main:app` in ai-service/ on port 8000.',
            });
        }

        return successResponse({ serviceReachable: true, ...registry });
    } catch (error: unknown) {
        console.error('[TrainedAgents] registry error:', error);
        return errorResponse('Failed to read agent registry', 'SERVER_ERROR', 500);
    }
}

export async function POST(req: NextRequest) {
    const authResult = await requirePermission(req, 'ai:use');
    if (authResult instanceof Response) return authResult;

    try {
        const body = await req.json();
        const batchId: string = body.batchId || body.batchCode || '';
        const agent: string = body.agent || 'all';

        if (!batchId) {
            return errorResponse('batchId is required', 'VALIDATION_ERROR', 400);
        }
        if (agent !== 'all' && !AGENT_NAMES.includes(agent as AgentName)) {
            return errorResponse(
                `Unknown agent '${agent}'. Expected one of: ${AGENT_NAMES.join(', ')}, all.`,
                'VALIDATION_ERROR',
                400
            );
        }

        const context = await buildAgentContext(batchId, {
            pesticideResidueLevel: body.pesticideResidueLevel,
            remainingTransportTime: body.remainingTransportTime,
        });

        if (!context) {
            return errorResponse(`Batch ${batchId} not found`, 'NOT_FOUND', 404);
        }

        if (agent === 'all') {
            const { trust, upstream } = await analyzeBatch(context);
            return successResponse({ batchId: context.batchId, trust, upstream });
        }

        const result = await callAgent(agent as AgentName, context);
        return successResponse({ batchId: context.batchId, result });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Agent run failed';
        console.error('[TrainedAgents] error:', error);
        return errorResponse(message, 'SERVER_ERROR', 500);
    }
}
