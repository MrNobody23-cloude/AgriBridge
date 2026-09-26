import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/auth';
import { investigateFraudSchema } from '@/lib/validators';
import { successResponse, errorResponse } from '@/lib/response';

export async function POST(req: NextRequest) {
    const authResult = await requirePermission(req, 'fraud:investigate');
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    try {
        const body = await req.json();
        const validated = investigateFraudSchema.parse(body);

        const alert = await prisma.fraudAlert.findUnique({
            where: { id: validated.alertId },
            include: { batch: true },
        });

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

        const updatedAlert = await prisma.fraudAlert.update({
            where: { id: alert.id },
            data: {
                status: updatedStatus,
                description: validated.notes ? `${alert.description} [Regulator Note: ${validated.notes}]` : alert.description,
            },
        });

        // If resolved or false positive, restore batch status if no other open alerts
        if ((updatedStatus === 'RESOLVED' || updatedStatus === 'FALSE_POSITIVE') && alert.batchId) {
            const otherAlerts = await prisma.fraudAlert.count({
                where: { batchId: alert.batchId, status: 'OPEN', id: { not: alert.id } },
            });

            if (otherAlerts === 0) {
                await prisma.batch.update({
                    where: { id: alert.batchId },
                    data: { status: 'Registered' },
                });
            }
        }

        // Log regulator audit log
        await prisma.aiAgentLog.create({
            data: {
                agentName: 'Regulator Audit Agent',
                task: `Fraud Alert Investigation Update (${alert.id})`,
                input: `Action: ${validated.action}, Alert: ${alert.fraudType}`,
                output: `Alert ${alert.id} status changed from ${alert.status} to ${updatedStatus}`,
                confidence: 1.0,
                status: 'COMPLETED',
            },
        });

        return successResponse({
            alert: updatedAlert,
            message: `Fraud alert state updated to ${updatedStatus}.`,
        });
    } catch (error: any) {
        if (error.name === 'ZodError') {
            return errorResponse(error.errors[0]?.message || 'Validation failed', 'VALIDATION_ERROR', 400);
        }
        console.error('Investigate alert error:', error);
        return errorResponse(error.message || 'Failed to update investigation status', 'SERVER_ERROR', 500);
    }
}
