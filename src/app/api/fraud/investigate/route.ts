import { NextRequest } from 'next/server';
import {
    findFraudAlertById, updateFraudAlert, countFraudAlerts,
} from '@/lib/db/repositories/shipments';
import { updateBatch } from '@/lib/db/repositories/batches';
import { createAgentLog } from '@/lib/db/repositories/agents';
import { requirePermission } from '@/lib/auth';
import { investigateFraudSchema } from '@/lib/validators';
import { successResponse, errorResponse } from '@/lib/response';
import { isZodError, firstValidationMessage } from '@/lib/zod-error';

export async function POST(req: NextRequest) {
    const authResult = await requirePermission(req, 'fraud:investigate');
    if (authResult instanceof Response) return authResult;

    try {
        const body = await req.json();
        const validated = investigateFraudSchema.parse(body);

        // The `include: { batch: true }` this used to fetch is not read below —
        // only `batchId` is — so it is not fetched. One less round trip.
        const alert = await findFraudAlertById(validated.alertId);

        if (!alert) {
            return errorResponse('Fraud alert not found', 'NOT_FOUND', 404);
        }

        let updatedStatus = 'UNDER_REVIEW';
        if (validated.action === 'APPROVE' || validated.action === 'RESOLVE') {
            updatedStatus = 'RESOLVED';
        } else if (validated.action === 'REJECT') {
            updatedStatus = 'CONFIRMED';
        } else if (validated.action === 'FALSE_POSITIVE') {
            updatedStatus = 'FALSE_POSITIVE';
        }

        const updatedAlert = await updateFraudAlert(alert._id, {
            status: updatedStatus,
            description: validated.notes
                ? `${alert.description} [Regulator Note: ${validated.notes}]`
                : alert.description,
        });

        // If resolved or false positive, restore batch status if no other open alerts
        if ((updatedStatus === 'RESOLVED' || updatedStatus === 'FALSE_POSITIVE') && alert.batchId) {
            const otherAlerts = await countFraudAlerts({
                batchId: alert.batchId,
                status: 'OPEN',
                _id: { $ne: alert._id },
            });

            if (otherAlerts === 0) {
                await updateBatch(alert.batchId, { status: 'Registered' });
            }
        }

        // Log regulator audit log
        await createAgentLog({
            agentName: 'Regulator Audit Agent',
            task: `Fraud Alert Investigation Update (${alert._id})`,
            input: `Action: ${validated.action}, Alert: ${alert.fraudType}`,
            output: `Alert ${alert._id} status changed from ${alert.status} to ${updatedStatus}`,
            confidence: 1.0,
            status: 'COMPLETED',
        });

        return successResponse({
            alert: updatedAlert,
            message: `Fraud alert state updated to ${updatedStatus}.`,
        });
    } catch (error: unknown) {
        if (isZodError(error)) {
            return errorResponse(firstValidationMessage(error), 'VALIDATION_ERROR', 400);
        }
        console.error('Investigate alert error:', error);
        const message = error instanceof Error ? error.message : 'Failed to update investigation status';
        return errorResponse(message, 'SERVER_ERROR', 500);
    }
}
