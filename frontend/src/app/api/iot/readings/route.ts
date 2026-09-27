import { NextRequest, NextResponse } from 'next/server';
import { findBatchByIdOrCode } from '@/lib/db/repositories/batches';
import { createTemperatureLog, listTemperatureLogs } from '@/lib/db/repositories/iot';
import { requireAuth } from '@/lib/auth';
import { sensorReadingSchema } from '@/lib/validators';
import { successResponse, errorResponse } from '@/lib/response';
import { runFraudScan } from '@/lib/services/fraudDetectionService';
import { calculateTrustScore } from '@/lib/services/trustScoreService';
import { isZodError, firstValidationMessage } from '@/lib/zod-error';

// ─── POST /api/iot/readings ────────────────────────────────────────────────────
// Ingest a sensor reading from a real ESP32 device or simulator.

export async function POST(req: NextRequest) {
    // IoT devices may use a service token; consumers/admins can post simulated readings
    const authResult = await requireAuth(req, ['TRANSPORTER', 'FARMER', 'EXPORTER', 'ADMIN']);
    if (authResult instanceof NextResponse) return authResult;

    try {
        const body = await req.json();
        const readings = Array.isArray(body) ? body : [body];

        const created = [];

        for (const raw of readings) {
            const validated = sensorReadingSchema.parse(raw);

            if (!validated.batchId && !validated.shipmentId) {
                return errorResponse('Either batchId or shipmentId is required', 'VALIDATION_ERROR', 400);
            }

            // Validate batch exists
            if (validated.batchId) {
                const batch = await findBatchByIdOrCode(validated.batchId);
                if (!batch) {
                    return errorResponse(`Batch ${validated.batchId} not found`, 'BATCH_NOT_FOUND', 404);
                }
                validated.batchId = batch._id; // normalise to the stored id
            }

            const log = await createTemperatureLog({
                batchId: validated.batchId,
                shipmentId: validated.shipmentId,
                sensorId: validated.sensorId,
                temperature: validated.temperature,
                humidity: validated.humidity,
                location: validated.location,
                latitude: validated.latitude,
                longitude: validated.longitude,
                batteryLevel: validated.batteryLevel,
                isSimulated: validated.isSimulated ?? false,
                timestamp: validated.timestamp ? new Date(validated.timestamp) : new Date(),
            });

            // Alert if temperature is out of safe range
            const isTempBreach = validated.temperature > 8.0 || validated.temperature < 1.0;
            if (isTempBreach && validated.batchId) {
                // Run fraud scan which will auto-create a FraudAlert for temp breach
                runFraudScan(validated.batchId, validated.shipmentId).catch(console.error);
                // Recalculate trust score
                calculateTrustScore(validated.batchId).catch(console.error);
            }

            created.push(log);
        }

        return successResponse({ created: created.length, readings: created }, 201);
    } catch (error: unknown) {
        if (isZodError(error)) {
            return errorResponse(firstValidationMessage(error), 'VALIDATION_ERROR', 400);
        }
        console.error('IoT reading error:', error);
        return errorResponse('Failed to ingest sensor reading', 'SERVER_ERROR', 500);
    }
}

// ─── GET /api/iot/readings ─────────────────────────────────────────────────────
// List recent readings; filterable by batchId, shipmentId, sensorId.

export async function GET(req: NextRequest) {
    const authResult = await requireAuth(req);
    if (authResult instanceof NextResponse) return authResult;

    try {
        const { searchParams } = new URL(req.url);
        const batchId = searchParams.get('batchId');
        const shipmentId = searchParams.get('shipmentId');
        const sensorId = searchParams.get('sensorId');
        const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500);

        // Accept a batchCode or the stored id; the repository always filters on
        // the stored id, so an unrecognised code yields no readings rather than
        // a query that could match something unintended.
        let resolvedBatchId: string | undefined;
        if (batchId) {
            const batch = await findBatchByIdOrCode(batchId);
            resolvedBatchId = batch?._id;
        }

        const readings = await listTemperatureLogs({
            batchId: resolvedBatchId,
            shipmentId: shipmentId ?? undefined,
            sensorId: sensorId ?? undefined,
            limit,
        });

        // Compute summary stats
        const temps = readings.map((r) => r.temperature);
        const summary = temps.length > 0
            ? {
                count: temps.length,
                min: Math.min(...temps),
                max: Math.max(...temps),
                avg: Math.round((temps.reduce((a, b) => a + b, 0) / temps.length) * 100) / 100,
                breachCount: temps.filter((t) => t > 8.0 || t < 1.0).length,
            }
            : null;

        return successResponse({ readings, summary });
    } catch (error: unknown) {
        console.error('IoT GET error:', error);
        return errorResponse('Failed to retrieve sensor readings', 'FETCH_ERROR', 500);
    }
}
