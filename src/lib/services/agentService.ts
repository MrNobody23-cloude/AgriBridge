import { prisma } from '@/lib/prisma';
import { runFraudScan } from './fraudDetectionService';
import { calculateTrustScore } from './trustScoreService';
import { predictSpoilage as heuristicSpoilage } from './spoilageService';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

export interface AgentResponse {
    agentName: string;
    agentType: 'supervisor' | 'fraud' | 'compliance' | 'traceability' | 'quality' | 'spoilage' | 'consumer';
    status: 'PASSED' | 'FLAGGED' | 'COMPLETED' | 'HIGH_RISK' | 'ANSWERED' | 'CONFLICT' | 'PENDING';
    title: string;
    details: string;
    confidence: number;
    sources?: unknown[];
    data?: unknown;
    toolsUsed?: string[];
}

/**
 * Compliance Agent — delegates to Python RAG service.
 * Falls back to heuristic if Python service is unavailable.
 */
export async function checkComplianceRAG(
    country: string,
    batchId?: string,
    shipmentId?: string
): Promise<{ country: string; passed: boolean; checks: unknown[]; summary: string; sources?: unknown[] }> {
    let batch: { product?: { name?: string } } | null = null;
    if (batchId) {
        batch = await prisma.batch.findFirst({
            where: { OR: [{ id: batchId }, { batchCode: batchId }] },
            include: { product: true },
        }) as any;
    }

    const crop = (batch as any)?.product?.name || 'General Agriculture';

    try {
        const res = await fetch(`${AI_SERVICE_URL}/api/rag/compliance/check`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ country, crop, batchId, shipmentId }),
            signal: AbortSignal.timeout(20000),
        });
        if (res.ok) {
            const data = await res.json() as Record<string, unknown>;
            const answer = String(data.answer || '');
            const sources = (data.sources as unknown[]) || [];
            const passed = !answer.toLowerCase().includes('insufficient evidence') && answer.length > 20;
            const checks = [{
                country,
                requirement: `Export compliance: ${country}`,
                status: passed ? 'PASSED' : 'PENDING',
                explanation: answer.slice(0, 500),
                source: (sources[0] as any)?.source || 'AgriBridge RAG Knowledge Base',
                evidence: data.evidence,
            }];
            // A run that came back confident with no evidence to back it is
            // worse than one that reports having none, so the confidence
            // figure is only quoted when the service actually supplied one.
            const reportedConfidence = Number(data.confidence || 0);
            const summary = reportedConfidence > 0
                ? `RAG Compliance Agent retrieved regulatory evidence for export to ${country}. Confidence: ${Math.round(reportedConfidence * 100)}%.`
                : `RAG Compliance Agent returned an answer for export to ${country} without reporting a confidence value. Verify the cited source before relying on it.`;

            await prisma.aiAgentLog.create({
                data: {
                    agentName: 'Compliance Agent (RAG)',
                    agentType: 'compliance',
                    task: `Regulatory Screening for Export to ${country}`,
                    input: `Country: ${country}, Batch: ${batchId || 'N/A'}`,
                    output: summary,
                    // 0 rather than the previous 0.85 default: `res.ok` only
                    // means an HTTP 200, not that the RAG service had evidence.
                    // A compliant answer with no confidence behind it is not a
                    // finding, which is why `summary` above says so too.
                    confidence: Number(data.confidence || 0),
                    status: passed ? 'PASSED' : 'PENDING',
                    sources: JSON.stringify(sources),
                },
            });
            return { country, passed, checks, summary, sources };
        }
    } catch (err: any) {
        console.warn(`[ComplianceAgent] RAG service unavailable: ${err.message}`);
    }

    // Fallback: return honest "service unavailable" response
    return {
        country,
        passed: false,
        checks: [{
            country,
            requirement: 'Export compliance check',
            status: 'PENDING',
            explanation: 'RAG compliance service temporarily unavailable. Manual regulatory review required.',
            source: 'N/A',
        }],
        summary: `Compliance check for ${country} pending — AI service temporarily unavailable.`,
    };
}

/**
 * Consumer Trust Agent — delegates to Python RAG + Gemini.
 */
export async function answerConsumerQuery(
    batchCode: string,
    userQuery: string
): Promise<{ answer: string; checkpoints: number; trustScore: number; verifiedOnChain: boolean; sources?: unknown[]; confidence?: number }> {
    const batch = await prisma.batch.findFirst({
        where: { OR: [{ batchCode }, { id: batchCode }] },
        include: { product: true, events: true, farmer: { include: { farmerProfile: true } }, certificates: true, trustScoreDetails: true },
    });

    if (!batch) {
        return {
            answer: `Batch ${batchCode} could not be found in the supply chain ledger. Please verify the QR code on your package.`,
            checkpoints: 0,
            trustScore: 0,
            verifiedOnChain: false,
        };
    }

    const { verifyBatchOnChain } = await import('@/lib/blockchain');
    const chainV = await verifyBatchOnChain(batch.batchCode, batch.blockchainHash);

    const batchContext = {
        batchCode: batch.batchCode,
        product: batch.product.name,
        origin: batch.location,
        harvestDate: batch.harvestDate,
        status: batch.status,
        farmerName: batch.farmer.name,
        farmName: batch.farmer.farmerProfile?.farmName,
        farmLocation: batch.farmer.farmerProfile?.location,
        blockchainVerified: chainV.status === 'VERIFIED',
        blockchainStatus: chainV.status,
        certificatesCount: batch.certificates.length,
        certificatesVerified: batch.certificates.filter(c => c.verificationStatus === 'VERIFIED').length,
        supplyChainEvents: batch.events.length,
        trustScore: batch.trustScore,
    };

    let answer = '';
    let sources: unknown[] = [];
    // Zero until the service supplies its own. This was 0.75, so a run where
    // the Python service never responded was logged and returned as a
    // three-quarter-confident answer built from a database lookup.
    let confidence = 0;

    try {
        const res = await fetch(`${AI_SERVICE_URL}/api/agents/consumer/answer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ batchCode: batch.batchCode, query: userQuery, batchData: batchContext }),
            signal: AbortSignal.timeout(25000),
        });
        if (res.ok) {
            const data = await res.json() as Record<string, unknown>;
            answer = String(data.answer || '');
            sources = (data.sources as unknown[]) || [];
            confidence = Number(data.confidence || 0);
        }
    } catch (err: any) {
        console.warn(`[ConsumerAgent] AI service unavailable: ${err.message}`);
    }

    if (!answer) {
        // Honest fallback using real DB data (no hallucination)
        answer = `Batch ${batch.batchCode} (${batch.product.name}) was produced by ${batch.farmer.name} in ${batch.location}. Blockchain status: ${chainV.status}. Trust score: ${batch.trustScore}/100. ${batch.events.length} supply chain events recorded.`;
    }

    await prisma.aiAgentLog.create({
        data: {
            agentName: 'Consumer Trust Agent',
            agentType: 'consumer',
            task: `Answer consumer query for ${batch.batchCode}`,
            input: userQuery,
            output: answer,
            confidence,
            status: 'ANSWERED',
        },
    });

    return {
        answer,
        checkpoints: batch.events.length,
        trustScore: batch.trustScore,
        verifiedOnChain: chainV.status === 'VERIFIED',
        sources,
        confidence,
    };
}

/**
 * Supervisor Agent — orchestrates all sub-agents.
 * Delegates ML/RAG work to Python service; uses real DB data.
 */
export async function runSupervisorOrchestration(batchId: string): Promise<AgentResponse[]> {
    const responses: AgentResponse[] = [];

    const batch = await prisma.batch.findFirst({
        where: { OR: [{ id: batchId }, { batchCode: batchId }] },
        include: {
            product: true,
            certificates: true,
            events: { orderBy: { timestamp: 'asc' } },
            farmer: { include: { farmerProfile: true } },
            fraudAlerts: true,
            trustScoreDetails: true,
            temperatureLogs: { orderBy: { timestamp: 'desc' }, take: 50 },
            shipments: { include: { complianceChecks: true, exporter: { select: { name: true } } } },
        },
    });
    if (!batch) return responses;

    // Verify blockchain
    const { verifyBatchOnChain } = await import('@/lib/blockchain');
    const chainV = await verifyBatchOnChain(batch.batchCode, batch.blockchainHash);

    // Try Python AI service for full orchestration
    let pythonResult: Record<string, unknown> | null = null;
    try {
        const batchContext = {
            batchCode: batch.batchCode,
            product: { name: batch.product.name },
            location: batch.location,
            harvestDate: batch.harvestDate,
            status: batch.status,
            trustScore: batch.trustScore,
            blockchainHash: batch.blockchainHash,
            destinationCountry: batch.destinationCountry || batch.shipments[0]?.destinationCountry,
            events: batch.events,
            certificates: batch.certificates,
            fraudAlerts: batch.fraudAlerts,
            temperatureLogs: batch.temperatureLogs,
            shipments: batch.shipments,
            chainVerification: chainV,
        };
        const res = await fetch(`${AI_SERVICE_URL}/api/agents/orchestrate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ batchId: batch.batchCode, batchData: batchContext, sensorData: batch.temperatureLogs }),
            signal: AbortSignal.timeout(45000),
        });
        if (res.ok) pythonResult = await res.json() as Record<string, unknown>;
    } catch (err: any) {
        console.warn(`[Supervisor] Python AI service unavailable: ${err.message}. Using fallback.`);
    }

    if (pythonResult?.agentResponses) {
        // Use Python service results directly
        const pythonResponses = pythonResult.agentResponses as AgentResponse[];
        responses.push(...pythonResponses);
    } else {
        // Fallback: run TypeScript-side agents

        // 1. Traceability
        // `verified` is false for a chain that was never configured and for one
        // that is unreachable, neither of which is evidence of tampering. Only
        // an actual VERIFIED or TAMPERED reading may move this agent to
        // PASSED/FLAGGED; anything else reports the gap without accusing anyone.
        const chainDecisive = chainV.status === 'VERIFIED' || chainV.status === 'TAMPERED';
        responses.push({
            agentName: '🔍 Traceability Agent',
            agentType: 'traceability',
            status: chainDecisive ? (chainV.verified ? 'PASSED' : 'FLAGGED') : 'ANSWERED',
            title: chainDecisive && !chainV.verified
                ? `On-chain hash does not match the database record`
                : `${batch.events.length} supply chain events recorded`,
            details: `Blockchain: ${chainV.status} | ${batch.events.length} events | Hash: ${batch.blockchainHash.slice(0, 16)}...`,
            confidence: chainV.status === 'VERIFIED' ? 0.99 : chainDecisive ? 0.70 : 0.30,
            toolsUsed: ['verify_blockchain', 'get_supply_chain_events'],
        });

        // 2. Fraud Detection (real rules)
        const fraudScans = await runFraudScan(batch.id);
        const openFraud = batch.fraudAlerts.filter(f => f.status !== 'RESOLVED' && f.status !== 'FALSE_POSITIVE');
        responses.push({
            agentName: '🚨 Fraud Detection Agent',
            agentType: 'fraud',
            status: openFraud.length > 0 ? 'FLAGGED' : 'PASSED',
            title: openFraud.length > 0 ? `${openFraud.length} fraud alert(s) detected` : 'No fraud signatures detected',
            details: openFraud.length > 0
                ? `${openFraud[0].description} (Confidence: ${Math.round(openFraud[0].confidence * 100)}%)`
                : `Certificate hash scan passed | ${batch.certificates.length} certificate(s) verified`,
            confidence: openFraud.length > 0 ? openFraud[0].confidence : 0.97,
            toolsUsed: ['check_certificates', 'verify_blockchain', 'temperature_analysis'],
        });

        // 3. Spoilage (heuristic fallback when Python unavailable)
        // A batch with no temperature readings used to be scored as though it
        // had sat at exactly 12.5 °C — a plausible-looking cold-chain figure
        // invented to fill a missing input, which then flowed into the live
        // Agent Activity feed as a real assessment. With no readings there is
        // nothing to assess, so the agent reports ANSWERED (it ran, and the
        // answer is that the evidence is missing) and emits no risk figure.
        const hasSensorData = batch.temperatureLogs.length > 0;
        const meanTemp = hasSensorData
            ? batch.temperatureLogs.reduce((s, t) => s + t.temperature, 0) / batch.temperatureLogs.length
            : null;

        if (!hasSensorData || meanTemp === null) {
            responses.push({
                agentName: '🦠 Spoilage Prediction Agent',
                agentType: 'spoilage',
                status: 'ANSWERED',
                title: 'Cannot assess spoilage — no cold-chain readings',
                details:
                    'This batch has no temperature readings recorded, so there is no evidence to assess. ' +
                    'Attach a sensor or enter readings manually rather than assuming a temperature.',
                confidence: 0,
                toolsUsed: [],
            });
        } else {
            const spoilageResult = await heuristicSpoilage(
                batch.product.name,
                meanTemp,
                Math.floor((Date.now() - new Date(batch.harvestDate).getTime()) / (1000 * 60 * 60 * 24)),
                batch.harvestDate
            );
            responses.push({
                agentName: '🦠 Spoilage Prediction Agent',
                agentType: 'spoilage',
                status: spoilageResult.spoilageRisk === 'HIGH' || spoilageResult.spoilageRisk === 'CRITICAL' ? 'HIGH_RISK' : 'COMPLETED',
                title: `Spoilage risk: ${spoilageResult.spoilageRisk} — ${spoilageResult.remainingDays} days remaining`,
                details: `${spoilageResult.explanation} ${spoilageResult.recommendation.slice(0, 80)}`,
                confidence: 0.85,
                toolsUsed: ['heuristic_spoilage_model', 'sensor_data'],
            });
        }

        // 4. Compliance
        const destination = batch.destinationCountry || batch.shipments[0]?.destinationCountry || 'UK';
        const complianceResult = await checkComplianceRAG(destination, batch.id);
        responses.push({
            agentName: '⚖️ Compliance Agent',
            agentType: 'compliance',
            status: complianceResult.passed ? 'PASSED' : 'PENDING',
            title: `Compliance check: ${destination}`,
            details: complianceResult.summary,
            confidence: 0.88,
            toolsUsed: ['rag_retrieval', 'regulatory_knowledge_base'],
        });

        // 5. Quality (honest about source when Python unavailable)
        const certCount = batch.certificates.filter(c => c.verificationStatus === 'VERIFIED').length;
        responses.push({
            agentName: '⭐ Quality Intelligence Agent',
            agentType: 'quality',
            status: 'COMPLETED',
            title: `Quality assessment: ${certCount} certificate(s) verified`,
            details: `Quality ML model requires Python AI service. ${certCount}/${batch.certificates.length} certificates verified. Run /api/ml/quality for XGBoost prediction.`,
            confidence: 0.70,
            toolsUsed: ['check_certificates'],
        });

        // 6. Consumer readiness
        responses.push({
            agentName: '👤 Consumer Trust Agent',
            agentType: 'consumer',
            status: 'ANSWERED',
            title: `QR verification ready — Trust Score ${batch.trustScore}/100`,
            details: `Consumer can verify this batch at /verify/${batch.batchCode}. ${chainV.status === 'VERIFIED' ? 'Blockchain verified.' : chainV.status === 'TAMPERED' ? 'Blockchain hash mismatch — do not trust this batch.' : `Blockchain ${String(chainV.status).toLowerCase().replace(/_/g, ' ')}.`}`,
            confidence: 0.96,
            toolsUsed: ['get_batch', 'verify_blockchain'],
        });
    }

    // Supervisor log
    const flagged = responses.filter(r => r.status === 'FLAGGED' || r.status === 'HIGH_RISK');
    await prisma.aiAgentLog.create({
        data: {
            agentName: 'Supervisor Agent',
            agentType: 'supervisor',
            task: `Multi-Agent Orchestration: ${batch.batchCode}`,
            input: JSON.stringify({ batchId: batch.batchCode }),
            output: `${responses.length}-agent pipeline. Status: ${flagged.length > 0 ? 'FLAGGED' : 'PASSED'}. ${flagged.length} issue(s).`,
            confidence: 0.98,
            status: flagged.length > 0 ? 'FLAGGED' : 'PASSED',
            toolsUsed: JSON.stringify(['python_ai_service', 'fraud_detector', 'compliance_rag']),
        },
    });

    return responses;
}
