import { prisma } from '@/lib/prisma';
import { verifyBatchOnChain, ChainStatus } from '@/lib/blockchain';

export interface TrustFactor {
    name: string;
    score: number;
    /** null when the factor cannot be scored from available evidence. */
    max: number | null;
    desc: string;
    /**
     * Contribution of this factor to the final score, in points. The real
     * explainability mechanism is the observed value that produced the score
     * (`observed`); this is a signed magnitude, not a SHAP value. Nothing in
     * this project fits a SHAP model over the trust factors, so no value here
     * is presented as one.
     */
    weight: number;
    observed: string;
}

export interface TrustScoreResult {
    batchId: string;
    batchCode: string;
    crop: string;
    farmerName: string;
    finalScore: number;
    riskLevel: 'Excellent' | 'High Trust' | 'Moderate Risk' | 'High Risk';
    factors: TrustFactor[];
    /** Factors that exist in the design but had no evidence to score. */
    unavailableFactors: UnavailableFactor[];
    /** Points a factor would have contributed had it been scorable. */
    coverageMax: number;
    risks: string[];
    plainAi: string;
}

/** Why a factor could not be scored. Surfaced to the caller, never hidden. */
export interface UnavailableFactor {
    name: string;
    code: string;
    message: string;
}

/**
 * Read a previously computed trust score without recomputing or writing it.
 *
 * This is the only trust-score path a public caller (a consumer scanning the QR
 * code) is allowed to reach. It returns the stored factors and the stored
 * score; it never touches the chain, never recomputes, and never writes.
 *
 * Returns null when no score has been computed, so the caller can say
 * "not yet computed" rather than inventing one.
 */
export async function readStoredTrustScore(
    batchId: string
): Promise<TrustScoreResult | null> {
    const batch = await prisma.batch.findFirst({
        where: { OR: [{ id: batchId }, { batchCode: batchId }] },
        include: {
            product: true,
            farmer: { select: { name: true } },
            // `trustScore` on Batch is a denormalized Int, not the relation.
            trustScoreDetails: true,
        },
    });

    if (!batch?.trustScoreDetails) return null;

    let factors: TrustFactor[] = [];
    try {
        factors = JSON.parse(batch.trustScoreDetails.factorsJson || '[]');
    } catch {
        factors = [];
    }

    const coverageMax = factors.reduce((sum, f) => sum + (f.max ?? 0), 0);
    const finalScore = batch.trustScoreDetails.finalScore;

    let riskLevel: TrustScoreResult['riskLevel'] = 'High Risk';
    if (finalScore >= 90) riskLevel = 'Excellent';
    else if (finalScore >= 75) riskLevel = 'High Trust';
    else if (finalScore >= 50) riskLevel = 'Moderate Risk';

    return {
        batchId: batch.id,
        batchCode: batch.batchCode,
        crop: batch.product.name,
        farmerName: batch.farmer.name,
        finalScore,
        riskLevel,
        factors,
        // A stored score cannot say which factors were unavailable at
        // computation time — that is not in the persisted shape. The
        // coverageMax recovered from the factors is the honest partial
        // answer, and the UI must not imply full coverage from it.
        unavailableFactors: [],
        coverageMax,
        risks: [],
        plainAi: batch.trustScoreDetails.explanation,
    };
}

/**
 * Score a batch on evidence that exists.
 *
 * Two rules this function follows, both of which the previous version broke:
 *
 * 1. A factor with no evidence scores nothing and is reported as unavailable.
 *    It is never given a neutral or near-full default.
 * 2. The denominator is the points that could actually be scored, so a batch
 *    with only cold-chain data is not punished for the four subsystems that
 *    were never switched on. `coverageMax` says how much was scoreable, and the
 *    UI must show it.
 */
export async function calculateTrustScore(batchId: string): Promise<TrustScoreResult> {
    const batch = await prisma.batch.findFirst({
        where: {
            OR: [{ id: batchId }, { batchCode: batchId }],
        },
        include: {
            farmer: { include: { farmerProfile: true } },
            product: true,
            certificates: true,
            events: true,
            shipments: { include: { complianceChecks: true } },
            fraudAlerts: true,
            temperatureLogs: true,
        },
    });

    if (!batch) {
        throw new Error(`Batch with ID or Code ${batchId} not found`);
    }

    const factors: TrustFactor[] = [];
    const unavailableFactors: UnavailableFactor[] = [];
    const risks: string[] = [];

    /** Run a factor, keeping it only if it produced a score. */
    const scoreFactor = (
        name: string,
        max: number,
        code: string,
        unavailableMessage: string,
        run: () => { score: number; desc: string; risk?: string }
    ) => {
        try {
            const { score, desc, risk } = run();
            factors.push({
                name,
                score: Math.max(0, Math.min(max, Math.round(score))),
                max,
                desc,
                weight: score - max / 2,
                observed: desc,
            });
            if (risk) risks.push(risk);
        } catch (e: any) {
            unavailableFactors.push({ name, code, message: e?.message ?? unavailableMessage });
        }
    };

    // 1. Blockchain (20) — real chain read, or explicitly not configured.
    const chainCheck = await verifyBatchOnChain(batch.batchCode, batch.blockchainHash);
    if (chainCheck.status === 'NOT_CONFIGURED' || chainCheck.status === 'UNREACHABLE') {
        unavailableFactors.push({
            name: 'Blockchain Verification',
            code: chainCheck.reason ?? 'BLOCKCHAIN_UNAVAILABLE',
            message:
                chainCheck.status === 'NOT_CONFIGURED'
                    ? 'No contract is configured, so no batch was ever written to a chain. This contributes 0 points and proves nothing either way.'
                    : chainCheck.explanation,
        });
    } else {
        const chainDescriptions: Record<ChainStatus, string> = {
            VERIFIED: 'Database SHA-256 matches the hash recorded on-chain.',
            TAMPERED: `On-chain hash (${(chainCheck.blockchainHash || '').slice(0, 10)}...) differs from the database record.`,
            NOT_FOUND: 'This batch has no record on the configured contract.',
            NOT_CONFIGURED: '',
            UNREACHABLE: '',
        };
        factors.push({
            name: 'Blockchain Verification',
            score: chainCheck.verified ? 20 : 0,
            max: 20,
            desc: chainDescriptions[chainCheck.status],
            weight: chainCheck.verified ? 10 : -10,
            observed: `chain status: ${chainCheck.status}`,
        });
        if (chainCheck.status === 'TAMPERED') {
            risks.push('TAMPER SUSPECTED: the on-chain hash does not match the database record.');
        }
    }

    // 2. Certificates (20) — only when certificates were actually uploaded.
    scoreFactor('Certificate Authenticity', 20, 'NO_CERTIFICATES', 'No certificates on record.', () => {
        if (batch.certificates.length === 0) throw new Error('No certificates uploaded for this batch.');
        const valid = batch.certificates.filter((c) => c.verificationStatus === 'VERIFIED');
        return {
            score: (valid.length / batch.certificates.length) * 20,
            desc: `${valid.length} of ${batch.certificates.length} certificate(s) verified.`,
            risk:
                valid.length < batch.certificates.length
                    ? `${batch.certificates.length - valid.length} certificate(s) are not verified.`
                    : undefined,
        };
    });

    // 3. Cold chain (20) — only when sensors have reported.
    scoreFactor('Cold Chain Integrity', 20, 'NO_TEMPERATURE_DATA', 'No sensor readings recorded.', () => {
        if (batch.temperatureLogs.length === 0) {
            throw new Error('No temperature readings have been recorded for this batch.');
        }
        // Deviation is a fraction of readings, so more readings make the
        // measure sharper rather than more punishing.
        const deviations = batch.temperatureLogs.filter((t) => t.temperature > 8.0 || t.temperature < 2.0);
        const rate = deviations.length / batch.temperatureLogs.length;
        return {
            score: 20 * (1 - rate),
            desc:
                `${deviations.length} of ${batch.temperatureLogs.length} reading(s) outside the 2–8°C band.`,
            risk:
                deviations.length > 0
                    ? `Cold Chain Alert: ${deviations.length} temperature deviation(s) across ${batch.temperatureLogs.length} reading(s).`
                    : undefined,
        };
    });

    // 4. Compliance (10) — only when a compliance check was actually run.
    scoreFactor('Regulatory Compliance', 10, 'NO_COMPLIANCE_CHECK', 'No compliance check has been run.', () => {
        const checks = batch.shipments.flatMap((s) => s.complianceChecks);
        if (checks.length === 0) {
            throw new Error('No compliance check has been recorded for any shipment on this batch.');
        }
        const failed = checks.filter((c) => c.status === 'MISSING' || c.status === 'FAILED');
        return {
            score: 10 * (1 - failed.length / checks.length),
            desc: `${checks.length - failed.length} of ${checks.length} requirement(s) satisfied.`,
            risk:
                failed.length > 0
                    ? `Compliance gap: ${failed.length} requirement(s) missing or failed.`
                    : undefined,
        };
    });

    // 5. ML assessment (10) — only when a model actually scored this batch.
    //    The previous version gave 9/10 for "Computer vision analysis verified
    //    harvest freshness" on every batch. There is no computer vision in this
    //    project and no prediction was consulted; the points were invented.
    scoreFactor('ML Quality Assessment', 10, 'NO_ML_PREDICTION', 'No ML model has scored this batch.', () => {
        if (batch.qualityScore == null) {
            throw new Error('No ML quality prediction has been recorded for this batch.');
        }
        return {
            score: (batch.qualityScore / 100) * 10,
            desc: `ML quality score ${batch.qualityScore}/100${batch.qualityGrade ? `, grade ${batch.qualityGrade}` : ''}.`,
        };
    });

    // 6. Chain of custody (30) — only when events exist. Replaces the old
    //    "Inspection Results" factor, which awarded 18/20 for a "Grade A
    //    classification" derived from nothing but the absence of a fraud alert.
    scoreFactor('Chain of Custody', 30, 'NO_CUSTODY_EVENTS', 'No supply chain events recorded.', () => {
        if (batch.events.length === 0) {
            throw new Error('No supply chain events have been recorded for this batch.');
        }
        // Custody coverage: how much of the lifecycle has actually been walked.
        const stages = new Set(batch.events.map((e) => e.eventType));
        const coverage = Math.min(1, stages.size / 4);
        const criticalFraud = batch.fraudAlerts.filter(
            (f) => f.severity === 'CRITICAL' && f.status !== 'RESOLVED'
        );
        const penalty = criticalFraud.length > 0 ? 15 : 0;
        return {
            score: Math.max(0, coverage * 30 - penalty),
            desc: `${stages.size} custody event type(s) recorded across ${batch.events.length} event(s).`,
            risk:
                criticalFraud.length > 0
                    ? `CRITICAL ALERT: ${criticalFraud[0].description}`
                    : undefined,
        };
    });

    // Denominator = what could actually be scored. A batch is not marked down
    // for subsystems that were never switched on, and the UI is told which ones
    // so a high score over a narrow base is visible as such.
    const coverageMax = factors.reduce((sum, f) => sum + (f.max ?? 0), 0);
    const rawTotal = factors.reduce((sum, f) => sum + f.score, 0);
    const finalScore =
        coverageMax === 0
            ? 0
            : Math.max(0, Math.min(100, Math.round((rawTotal / coverageMax) * 100)));

    let riskLevel: 'Excellent' | 'High Trust' | 'Moderate Risk' | 'High Risk' = 'High Risk';
    if (coverageMax === 0) riskLevel = 'High Risk';
    else if (finalScore >= 90) riskLevel = 'Excellent';
    else if (finalScore >= 75) riskLevel = 'High Trust';
    else if (finalScore >= 50) riskLevel = 'Moderate Risk';

    if (risks.length === 0 && factors.length > 0) {
        risks.push('No active risks detected in the factors that could be scored.');
    }

    const farmerName = batch.farmer.name;
    const cropName = batch.product.name;
    const firstName = farmerName.split(' ')[0];
    const coverageNote =
        coverageMax === 100
            ? 'All six factors were scorable.'
            : `Scored on ${coverageMax} of 100 available points; ${6 - factors.length} factor(s) had no evidence and contributed nothing: ${unavailableFactors.map((u) => u.name).join(', ')}.`;

    let plainAi =
        coverageMax === 0
            ? `${firstName}, batch ${batch.batchCode} has no evidence recorded against it yet — ` +
              `no certificates, sensor readings, custody events or ML prediction. A trust score ` +
              `cannot be calculated until at least one of those exists.`
            : `${firstName}, your ${cropName} batch ${batch.batchCode} scored ${finalScore}/100 ` +
              `(${riskLevel.toUpperCase()}) across ${factors.length} of 6 factors. ${coverageNote}` +
              (risks.length > 0 ? ` Outstanding: ${risks[0]}` : '');

    // Update DB records
    await prisma.batch.update({
        where: { id: batch.id },
        data: { trustScore: finalScore },
    });

    const payload = {
        blockchainScore: factors.find((f) => f.name === 'Blockchain Verification')?.score ?? 0,
        certificateScore: factors.find((f) => f.name === 'Certificate Authenticity')?.score ?? 0,
        coldChainScore: factors.find((f) => f.name === 'Cold Chain Integrity')?.score ?? 0,
        // The schema keeps the historical column name; it now holds the
        // chain-of-custody score, which is what this factor replaced.
        inspectionScore: factors.find((f) => f.name === 'Chain of Custody')?.score ?? 0,
        complianceScore: factors.find((f) => f.name === 'Regulatory Compliance')?.score ?? 0,
        qualityScore: factors.find((f) => f.name === 'ML Quality Assessment')?.score ?? 0,
        finalScore,
        factorsJson: JSON.stringify(factors),
        explanation: plainAi,
    };

    await prisma.trustScore.upsert({
        where: { batchId: batch.id },
        update: payload,
        create: { batchId: batch.id, ...payload },
    });

    return {
        batchId: batch.id,
        batchCode: batch.batchCode,
        crop: cropName,
        farmerName: `${farmerName} (${batch.location})`,
        finalScore,
        riskLevel,
        factors,
        unavailableFactors,
        coverageMax,
        risks,
        plainAi,
    };
}
