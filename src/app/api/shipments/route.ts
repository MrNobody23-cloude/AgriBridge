import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/auth';
import { createShipmentSchema } from '@/lib/validators';
import { checkComplianceRAG } from '@/lib/services/agentService';
import { runFraudScan } from '@/lib/services/fraudDetectionService';
import { successResponse, errorResponse } from '@/lib/response';
import { createAuditLog } from '@/lib/auditLog';

export async function GET(req: NextRequest) {
    const authResult = await requirePermission(req, 'shipment:read');
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    try {
        // Ownership scoping: exporters only see their own shipments;
        // regulators/admins/importers/transporters see all.
        const where: any = {};
        if (user.role === 'EXPORTER') {
            where.exporterId = user.id;
        }

        const shipments = await prisma.shipment.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            include: {
                batch: { include: { product: true, farmer: true } },
                exporter: true,
                complianceChecks: true,
                fraudAlerts: true,
            },
        });

        return successResponse(shipments);
    } catch (error: any) {
        console.error('Error fetching shipments:', error);
        return errorResponse('Failed to fetch shipments', 'SERVER_ERROR', 500);
    }
}

export async function POST(req: NextRequest) {
    const authResult = await requirePermission(req, 'shipment:create');
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    try {
        const body = await req.json();
        const validated = createShipmentSchema.parse(body);

        const batch = await prisma.batch.findFirst({
            where: { OR: [{ id: validated.batchId }, { batchCode: validated.batchId }] },
        });

        if (!batch) {
            return errorResponse('Batch not found', 'BATCH_NOT_FOUND', 404);
        }

        // The authenticated exporter owns this shipment — never guess from the DB.
        const exporterId = user.id;

        const count = await prisma.shipment.count();
        const shipmentCode = `EX-${1924 + count}`;

        const newShipment = await prisma.shipment.create({
            data: {
                shipmentCode,
                batchId: batch.id,
                exporterId,
                destinationCountry: validated.destinationCountry,
                quantity: validated.quantity,
                status: 'In Transit',
                riskScore: 15,
            },
            include: { batch: { include: { product: true } } },
        });

        // Run Compliance RAG checks automatically for destination country
        const ragRes = await checkComplianceRAG(validated.destinationCountry, batch.batchCode);
        for (const check of ragRes.checks as Array<{ country: string; requirement: string; status: string; explanation: string; source: string }>) {
            await prisma.complianceCheck.create({
                data: {
                    shipmentId: newShipment.id,
                    country: check.country,
                    requirement: check.requirement,
                    status: check.status,
                    explanation: check.explanation,
                    source: check.source,
                },
            });
        }

        // Add supply chain event EXPORTED
        await prisma.supplyChainEvent.create({
            data: {
                batchId: batch.id,
                eventType: 'EXPORTED',
                actorId: exporterId,
                location: `Port of Export (Dest: ${validated.destinationCountry})`,
                metadata: `Shipment ${shipmentCode} created for ${validated.quantity} kg`,
            },
        });

        // Run Fraud Detection
        const fraudAlerts = await runFraudScan(batch.id, newShipment.id);

        await createAuditLog({
            userId: user.id,
            action: 'SHIPMENT_CREATED',
            resource: 'Shipment',
            resourceId: newShipment.id,
            metadata: JSON.stringify({ shipmentCode, batchCode: batch.batchCode, destinationCountry: validated.destinationCountry }),
        });

        return successResponse({
            shipment: newShipment,
            complianceSummary: ragRes.summary,
            fraudAlerts,
        }, 201);
    } catch (error: any) {
        if (error.name === 'ZodError') {
            return errorResponse(error.errors[0]?.message || 'Validation failed', 'VALIDATION_ERROR', 400);
        }
        console.error('Create shipment error:', error);
        return errorResponse(error.message || 'Failed to create shipment', 'SERVER_ERROR', 500);
    }
}
