import { NextRequest } from 'next/server';
import { findBatchByIdOrCode, nextSequence, createSupplyChainEvent } from '@/lib/db/repositories/batches';
import { findProductById } from '@/lib/db/repositories/catalog';
import {
    listShipmentsForUser, createShipment, createComplianceCheck,
} from '@/lib/db/repositories/shipments';
import { requirePermission } from '@/lib/auth';
import { createShipmentSchema } from '@/lib/validators';
import { checkComplianceRAG } from '@/lib/services/agentService';
import { runFraudScan } from '@/lib/services/fraudDetectionService';
import { successResponse, errorResponse } from '@/lib/response';
import { createAuditLog } from '@/lib/auditLog';
import { isZodError, firstValidationMessage } from '@/lib/zod-error';

export async function GET(req: NextRequest) {
    const authResult = await requirePermission(req, 'shipment:read');
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    try {
        // Ownership scoping: exporters only see their own shipments;
        // regulators/admins/importers/transporters see all.
        const shipments = await listShipmentsForUser(user.role, user.id);

        return successResponse(shipments);
    } catch (error: unknown) {
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

        const batch = await findBatchByIdOrCode(validated.batchId);

        if (!batch) {
            return errorResponse('Batch not found', 'BATCH_NOT_FOUND', 404);
        }

        // The authenticated exporter owns this shipment — never guess from the DB.
        const exporterId = user.id;

        // The counter is atomic, unlike the `count()` this replaces. Two
        // exporters creating a shipment in the same instant both read the same
        // count and mint the same code; `shipmentCode` carries a unique index,
        // and the second write fails with an error that names neither the race
        // nor the field.
        const seq = await nextSequence('shipment');
        const shipmentCode = `EX-${1924 + seq}`;

        const newShipment = await createShipment({
            shipmentCode,
            batchId: batch._id,
            exporterId,
            destinationCountry: validated.destinationCountry,
            quantity: validated.quantity,
            unit: validated.unit ?? 'kg',
            status: 'In Transit',
            riskScore: 15,
        });

        // The `include: { batch: { include: { product: true } } }` on the
        // create re-attached the batch and its product for the response body.
        const product = await findProductById(batch.productId);

        // Run Compliance RAG checks automatically for destination country
        const ragRes = await checkComplianceRAG(validated.destinationCountry, batch.batchCode);
        for (const check of ragRes.checks as Array<{ country: string; requirement: string; status: string; explanation: string; source: string }>) {
            await createComplianceCheck({
                shipmentId: newShipment._id,
                country: check.country,
                requirement: check.requirement,
                status: check.status,
                explanation: check.explanation,
                source: check.source,
            });
        }

        // Add supply chain event EXPORTED
        await createSupplyChainEvent({
            batchId: batch._id,
            eventType: 'EXPORTED',
            actorId: exporterId,
            location: `Port of Export (Dest: ${validated.destinationCountry})`,
            metadata: `Shipment ${shipmentCode} created for ${validated.quantity} kg`,
        });

        // Run Fraud Detection
        const fraudAlerts = await runFraudScan(batch._id, newShipment._id);

        await createAuditLog({
            userId: user.id,
            action: 'SHIPMENT_CREATED',
            resource: 'Shipment',
            resourceId: newShipment._id,
            metadata: JSON.stringify({ shipmentCode, batchCode: batch.batchCode, destinationCountry: validated.destinationCountry }),
        });

        return successResponse({
            // The batch and product are re-attached under the same keys Prisma
            // nested them under; the client reads `shipment.batch.product.name`.
            shipment: { ...newShipment, batch: { ...batch, product } },
            complianceSummary: ragRes.summary,
            fraudAlerts,
        }, 201);
    } catch (error: unknown) {
        if (isZodError(error)) {
            return errorResponse(firstValidationMessage(error), 'VALIDATION_ERROR', 400);
        }
        console.error('Create shipment error:', error);
        const message = error instanceof Error ? error.message : 'Failed to create shipment';
        return errorResponse(message, 'SERVER_ERROR', 500);
    }
}
