import { NextRequest } from 'next/server';
import { listAgentLogs } from '@/lib/db/repositories/agents';
import { requirePermission } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/response';

export async function GET(req: NextRequest) {
    const authResult = await requirePermission(req, 'ai:use');
    if (authResult instanceof Response) return authResult;

    try {
        const logs = await listAgentLogs(20);

        const feed = logs.map((log) => {
            let agentType: 'fraud' | 'compliance' | 'traceability' | 'quality' | 'consumer' = 'quality';
            let agentIcon = '🤖';

            if (log.agentName.includes('Fraud')) {
                agentType = 'fraud';
                agentIcon = '🚨 Fraud Detection Agent';
            } else if (log.agentName.includes('Compliance')) {
                agentType = 'compliance';
                agentIcon = '⚖️ Compliance Agent';
            } else if (log.agentName.includes('Traceability')) {
                agentType = 'traceability';
                agentIcon = '🔍 Traceability Agent';
            } else if (log.agentName.includes('Consumer')) {
                agentType = 'consumer';
                agentIcon = '👤 Consumer Trust Agent';
            } else if (log.agentName.includes('Spoilage')) {
                agentType = 'quality';
                agentIcon = '🦠 Spoilage Prediction Agent';
            } else {
                agentType = 'quality';
                agentIcon = '⭐ Quality Intelligence Agent';
            }

            let badgeColor: 'red' | 'green' | 'amber' | 'blue' = 'blue';
            if (log.status === 'FLAGGED' || log.status === 'HIGH_RISK') badgeColor = 'red';
            else if (log.status === 'PASSED' || log.status === 'VERIFIED') badgeColor = 'green';
            else if (log.status === 'CONFLICT' || log.status === 'ANOMALY') badgeColor = 'amber';

            return {
                id: log._id,
                time: new Date(log.createdAt).toLocaleTimeString('en-US', { hour12: false }),
                agent: agentIcon,
                agentType,
                title: log.task,
                details: log.output,
                badge: { text: log.status, color: badgeColor },
            };
        });

        return successResponse(feed);
    } catch (error: unknown) {
        console.error('Agent feed error:', error);
        return errorResponse('Failed to fetch agent activity feed', 'SERVER_ERROR', 500);
    }
}
