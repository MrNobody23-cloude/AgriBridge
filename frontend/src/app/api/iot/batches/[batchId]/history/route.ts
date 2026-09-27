import { NextRequest } from 'next/server';
import { findBatchByIdOrCode } from '@/lib/db/repositories/batches';
import { findProductById } from '@/lib/db/repositories/catalog';
import { listTemperatureLogs } from '@/lib/db/repositories/iot';
import { requirePermission } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/response';

// ─── GET /api/iot/batches/[batchId]/history ────────────────────────────────────
// Return the full cold-chain history for a batch.

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ batchId: string }> }
) {
    const authResult = await requirePermission(req, 'iot:read');
    if (authResult instanceof Response) return authResult;

    const { batchId } = await params;

    try {
        const batch = await findBatchByIdOrCode(batchId);
        if (!batch) return errorResponse(`Batch ${batchId} not found`, 'BATCH_NOT_FOUND', 404);

        // Prisma selected only the product *name* through the relation. MongoDB
        // has no joins, so the product is fetched and reduced to the same shape —
        // a wider object here would change what the consumer-facing payload
        // contains, not just how it is nested.
        const product = await findProductById(batch.productId);
        const productName = product ? { name: product.name } : null;

        // Oldest first, and unbounded: the summary below divides by the reading
        // count, so a capped page would report a percentage computed over a
        // subset of the trace.
        const readings = await listTemperatureLogs({ batchId: batch._id, order: 'asc' });

        const temps = readings.map((r) => r.temperature);
        const humidities = readings.filter((r) => r.humidity !== null).map((r) => r.humidity as number);

        const summary = {
            totalReadings: readings.length,
            simulatedReadings: readings.filter((r) => r.isSimulated).length,
            realReadings: readings.filter((r) => !r.isSimulated).length,
            temperature: temps.length > 0 ? {
                min: Math.min(...temps),
                max: Math.max(...temps),
                avg: Math.round((temps.reduce((a, b) => a + b, 0) / temps.length) * 100) / 100,
                breaches: temps.filter((t) => t > 8.0 || t < 1.0).length,
                breachPercent: Math.round((temps.filter((t) => t > 8.0 || t < 1.0).length / temps.length) * 100),
            } : null,
            humidity: humidities.length > 0 ? {
                min: Math.min(...humidities),
                max: Math.max(...humidities),
                avg: Math.round((humidities.reduce((a, b) => a + b, 0) / humidities.length) * 100) / 100,
            } : null,
        };

        return successResponse({ batch: { id: batch._id, batchCode: batch.batchCode, product: productName }, readings, summary });
    } catch (error: unknown) {
        console.error('IoT history error:', error);
        return errorResponse('Failed to retrieve cold chain history', 'FETCH_ERROR', 500);
    }
}
