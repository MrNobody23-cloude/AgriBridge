import { NextRequest } from 'next/server';
import {
    loadBatchWithRelations, updateBatch, createMlPrediction,
} from '@/lib/db/repositories/batches';
import { requirePermission } from '@/lib/auth';
import { qualityPredictionSchema } from '@/lib/validators';
import { successResponse, errorResponse } from '@/lib/response';
import { isZodError, firstValidationMessage } from '@/lib/zod-error';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

export async function POST(req: NextRequest) {
    // `ml:predict` excludes CONSUMER. This route writes qualityScore and
    // qualityGrade onto the batch, so a bare requireAuth let any signed-in
    // account overwrite a quality assessment it has no standing to make.
    const authResult = await requirePermission(req, 'ml:predict');
    if (authResult instanceof Response) return authResult;

    try {
        const body = await req.json();
        const validated = qualityPredictionSchema.parse(body);

        const batch = await loadBatchWithRelations(validated.batchId, {
            temperatureLogLimit: 50,
        });
        if (!batch) return errorResponse(`Batch ${validated.batchId} not found`, 'BATCH_NOT_FOUND', 404);

        const daysSinceHarvest = validated.daysSinceHarvest ??
            Math.floor((Date.now() - new Date(batch.harvestDate).getTime()) / (1000 * 60 * 60 * 24));
        const coldChainDeviations = validated.coldChainDeviations ??
            batch.temperatureLogs.filter(t => t.temperature > 8.0 || t.temperature < 1.0).length;
        const avgTemp = validated.temperature ??
            (batch.temperatureLogs.length > 0
                ? batch.temperatureLogs.reduce((s, t) => s + t.temperature, 0) / batch.temperatureLogs.length
                : 12.0);
        const hasOrganic = batch.certificates.some(c =>
            c.certificateType.toLowerCase().includes('organic') && c.verificationStatus === 'VERIFIED'
        );

        let mlResult: Record<string, unknown> | null = null;
        try {
            const res = await fetch(`${AI_SERVICE_URL}/api/ml/quality/predict`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    batchId: batch._id,
                    crop: batch.product?.name,
                    temperature: avgTemp,
                    humidity: validated.humidity,
                    days_since_harvest: daysSinceHarvest,
                    cold_chain_deviations: coldChainDeviations,
                    num_certificates: batch.certificates.length,
                    has_organic_cert: hasOrganic,
                }),
                signal: AbortSignal.timeout(15000),
            });
            if (res.ok) mlResult = await res.json();
        } catch (err: unknown) {
            console.warn('ML quality service unavailable:', err instanceof Error ? err.message : String(err));
        }

        if (!mlResult) {
            return errorResponse('ML inference service temporarily unavailable.', 'ML_SERVICE_UNAVAILABLE', 503);
        }

        const prediction = mlResult.prediction as Record<string, unknown>;

        await updateBatch(batch._id, {
            qualityScore: Number(prediction.qualityScore),
            qualityGrade: String(prediction.grade),
        });
        await createMlPrediction({
            batchId: batch._id,
            modelType: 'QUALITY',
            modelName: 'quality-xgboost',
            modelVersion: '1.0.0',
            result: JSON.stringify(prediction),
            confidence: Number(prediction.confidence),
            inputJson: JSON.stringify({ crop: batch.product?.name, temperature: avgTemp, daysSinceHarvest }),
        });

        return successResponse({ ...mlResult, batchId: batch._id, batchCode: batch.batchCode });
    } catch (err: unknown) {
        if (isZodError(err)) return errorResponse(firstValidationMessage(err), 'VALIDATION_ERROR', 400);
        console.error('Quality prediction error:', err);
        return errorResponse('Failed to run quality prediction', 'SERVER_ERROR', 500);
    }
}
