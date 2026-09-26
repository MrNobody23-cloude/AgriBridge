import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/auth';
import { spoilagePredictionSchema } from '@/lib/validators';
import { successResponse, errorResponse } from '@/lib/response';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

export async function POST(req: NextRequest) {
    // `ml:predict` excludes CONSUMER. This route writes spoilageProbability,
    // spoilageRisk and remainingShelfLifeDays onto the batch.
    const authResult = await requirePermission(req, 'ml:predict');
    if (authResult instanceof Response) return authResult;

    try {
        const body = await req.json();
        const validated = spoilagePredictionSchema.parse(body);

        // Fetch batch to get crop name + harvest date
        const batch = await prisma.batch.findFirst({
            where: { OR: [{ id: validated.batchId }, { batchCode: validated.batchId }] },
            include: { product: true, temperatureLogs: { orderBy: { timestamp: 'desc' }, take: 50 } },
        });
        if (!batch) return errorResponse(`Batch ${validated.batchId} not found`, 'BATCH_NOT_FOUND', 404);

        const daysSinceHarvest = Math.floor((Date.now() - new Date(batch.harvestDate).getTime()) / (1000 * 60 * 60 * 24));
        const coldChainDeviations = batch.temperatureLogs.filter(t => t.temperature > 8.0 || t.temperature < 1.0).length;

        // Call Python ML service
        let mlResult: Record<string, unknown> | null = null;
        try {
            const res = await fetch(`${AI_SERVICE_URL}/api/ml/spoilage/predict`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    batchId: batch.id,
                    crop: batch.product.name,
                    temperature: validated.temperature,
                    humidity: validated.humidity,
                    transit_days: validated.transitDays,
                    days_since_harvest: daysSinceHarvest,
                    cold_chain_deviations: coldChainDeviations,
                }),
                signal: AbortSignal.timeout(15000),
            });
            if (res.ok) mlResult = await res.json();
        } catch (err: any) {
            console.warn('ML service unavailable:', err.message);
        }

        if (!mlResult) {
            return errorResponse(
                'ML inference service temporarily unavailable. Please retry later.',
                'ML_SERVICE_UNAVAILABLE',
                503
            );
        }

        const prediction = mlResult.prediction as Record<string, unknown>;
        const explanation = mlResult.explanation as Record<string, unknown>;
        const model = mlResult.model as Record<string, unknown>;

        // Cache prediction in DB
        await prisma.batch.update({
            where: { id: batch.id },
            data: {
                spoilageProbability: Number(prediction.probability),
                spoilageRisk: String(prediction.risk),
                remainingShelfLifeDays: Number(prediction.estimatedRemainingDays),
            },
        });
        await prisma.mlPrediction.create({
            data: {
                batchId: batch.id,
                modelType: 'SPOILAGE',
                modelName: String(model.name || 'spoilage-xgboost'),
                modelVersion: String(model.version || '1.0.0'),
                result: JSON.stringify(prediction),
                confidence: Number(prediction.probability),
                featuresJson: JSON.stringify(explanation.top_features),
                shapJson: JSON.stringify(explanation.top_features),
                inputJson: JSON.stringify({ temperature: validated.temperature, transitDays: validated.transitDays }),
            },
        });
        // Log agent activity
        await prisma.aiAgentLog.create({
            data: {
                agentName: 'Spoilage Prediction Agent',
                agentType: 'spoilage',
                task: `Spoilage prediction for batch ${batch.batchCode}`,
                input: JSON.stringify({ crop: batch.product.name, temperature: validated.temperature, transitDays: validated.transitDays }),
                output: `Risk: ${prediction.risk} (${Math.round(Number(prediction.probability) * 100)}%) | Remaining: ${prediction.estimatedRemainingDays} days`,
                confidence: Number(prediction.probability),
                status: 'COMPLETED',
                toolsUsed: JSON.stringify(['xgboost_model', 'shap_explainer']),
            },
        });

        return successResponse({ ...mlResult, batchId: batch.id, batchCode: batch.batchCode });
    } catch (err: any) {
        if (err.name === 'ZodError') return errorResponse(err.errors[0]?.message, 'VALIDATION_ERROR', 400);
        console.error('Spoilage prediction error:', err);
        return errorResponse('Failed to run spoilage prediction', 'SERVER_ERROR', 500);
    }
}
