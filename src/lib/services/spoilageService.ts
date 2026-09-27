import { createAgentLog } from '@/lib/db/repositories/agents';

export interface SpoilagePredictionResult {
    crop: string;
    spoilageRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    probability: number;
    remainingDays: number;
    explanation: string;
    recommendation: string;
}

export async function predictSpoilage(
    productName: string,
    temperature: number,
    transitDays: number,
    harvestDate?: Date
): Promise<SpoilagePredictionResult> {
    const normProduct = productName.toLowerCase();

    let baseShelfDays = 14; // Default
    let optimalTempMin = 10;
    let optimalTempMax = 14;

    if (normProduct.includes('mango')) {
        baseShelfDays = 14;
        optimalTempMin = 11;
        optimalTempMax = 14;
    } else if (normProduct.includes('grape')) {
        baseShelfDays = 21;
        optimalTempMin = 1;
        optimalTempMax = 4;
    } else if (normProduct.includes('rice') || normProduct.includes('wheat')) {
        baseShelfDays = 365;
        optimalTempMin = 15;
        optimalTempMax = 30;
    } else if (normProduct.includes('saffron') || normProduct.includes('tea')) {
        baseShelfDays = 180;
        optimalTempMin = 15;
        optimalTempMax = 25;
    }

    // Calculate temperature stress penalty multiplier
    let tempPenaltyDays = 0;
    if (temperature > optimalTempMax) {
        const diff = temperature - optimalTempMax;
        tempPenaltyDays = Math.round(diff * 1.5 * (transitDays / 2));
    }

    const daysPassed = harvestDate
        ? Math.max(1, Math.floor((Date.now() - new Date(harvestDate).getTime()) / (1000 * 60 * 60 * 24)))
        : transitDays;

    const remainingDays = Math.max(0, baseShelfDays - daysPassed - tempPenaltyDays);
    const probSpoilage = Math.min(0.99, Math.max(0.01, 1.0 - remainingDays / baseShelfDays));

    let spoilageRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
    if (probSpoilage > 0.85 || remainingDays <= 2) spoilageRisk = 'CRITICAL';
    else if (probSpoilage > 0.6 || remainingDays <= 5) spoilageRisk = 'HIGH';
    else if (probSpoilage > 0.3 || remainingDays <= 8) spoilageRisk = 'MEDIUM';

    let recommendation = `Maintain reefer temperature at ${optimalTempMin}°C - ${optimalTempMax}°C. Standard logistics pace acceptable.`;
    if (spoilageRisk === 'CRITICAL' || spoilageRisk === 'HIGH') {
        recommendation = `HIGH SPOILAGE RISK: Reroute to nearest domestic mandi or expedite air freight immediately. Cold chain must be maintained below ${optimalTempMax}°C.`;
    }

    const result: SpoilagePredictionResult = {
        crop: productName,
        spoilageRisk,
        probability: Math.round(probSpoilage * 100) / 100,
        remainingDays,
        explanation: `Calculated from ${daysPassed} days since harvest, transit temperature of ${temperature}°C vs optimal baseline (${optimalTempMin}°C-${optimalTempMax}°C).`,
        recommendation,
    };

    // Log in AI Agent Activity
    await createAgentLog({
        agentName: 'Spoilage Prediction Agent',
        task: `Spoilage Analysis for ${productName}`,
        input: `Temp: ${temperature}°C, Transit Days: ${transitDays}`,
        output: `Risk: ${spoilageRisk} (${Math.round(probSpoilage * 100)}% prob) | Remaining: ${remainingDays} days`,
        confidence: 0.91,
        status: 'COMPLETED',
    });

    return result;
}
