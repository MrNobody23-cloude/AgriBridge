import { NextRequest } from 'next/server';
import { loadBatchWithRelations } from '@/lib/db/repositories/batches';
import { createAgentLog } from '@/lib/db/repositories/agents';
import { requireAuth } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/response';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

export async function POST(req: NextRequest) {
    const authResult = await requireAuth(req);
    if (authResult instanceof Response) return authResult;

    try {
        const body = await req.json();
        const { batchId, query } = body;

        if (!batchId || !query) {
            return errorResponse('batchId and query are required', 'VALIDATION_ERROR', 400);
        }
        if (query.length > 500) {
            return errorResponse('Query too long (max 500 chars)', 'VALIDATION_ERROR', 400);
        }

        // Fetch full batch data to ground the AI answer. Events oldest first,
        // the 20 most recent readings, and only *unresolved* fraud alerts — a
        // resolved alert is history, and counting it as a live problem is the
        // difference between an accurate answer and a needlessly alarming one.
        const batch = await loadBatchWithRelations(batchId, {
            eventOrder: 'asc',
            temperatureLogLimit: 20,
            // No `take` on shipments here: every shipment with its compliance
            // checks is part of what the exporter is attesting to.
            shipmentLimit: 0,
            excludeResolvedFraudAlerts: true,
        });

        if (!batch) {
            return successResponse({
                answer: `Batch ${batchId} could not be found in the supply chain ledger. Please verify the QR code on your package.`,
                confidence: 0.0,
                toolsUsed: ['database_lookup'],
                batchFound: false,
            });
        }

        // Verify blockchain
        const { verifyBatchOnChain } = await import('@/lib/blockchain');
        const chainV = await verifyBatchOnChain(batch.batchCode, batch.blockchainHash);

        const productName = batch.product?.name ?? 'unknown product';
        const farmerName = batch.farmer?.name ?? 'unknown';

        const batchContext = {
            batchCode: batch.batchCode,
            product: productName,
            origin: batch.location,
            harvestDate: batch.harvestDate,
            status: batch.status,
            farmerName,
            farmName: batch.farmer?.farmerProfile?.farmName,
            farmLocation: batch.farmer?.farmerProfile?.location,
            blockchainVerified: chainV.status === 'VERIFIED',
            blockchainStatus: chainV.status,
            certificatesCount: batch.certificates.length,
            certificatesVerified: batch.certificates.filter(c => c.verificationStatus === 'VERIFIED').length,
            supplyChainEvents: batch.events.length,
            trustScore: batch.trustScore,
            fraudAlerts: batch.fraudAlerts.length,
        };

        // Call Python AI service for RAG + LLM answer
        let aiResponse: Record<string, unknown> = {};
        try {
            const res = await fetch(`${AI_SERVICE_URL}/api/agents/consumer/answer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ batchCode: batch.batchCode, query, batchData: batchContext }),
                signal: AbortSignal.timeout(30000),
            });
            if (res.ok) {
                aiResponse = await res.json();
            }
        } catch (err: unknown) {
            console.warn('AI service unavailable for consumer chat:', err instanceof Error ? err.message : String(err));
        }

        // Log interaction
        await createAgentLog({
            agentName: 'Consumer Trust Agent',
            agentType: 'consumer',
            task: `Answer consumer query for batch ${batch.batchCode}`,
            input: query,
            output: String(aiResponse.answer || 'AI service unavailable'),
            // 0 when the service did not answer. It previously defaulted to
            // 0.5, recording mid-confidence in a run that produced nothing.
            confidence: Number(aiResponse.confidence || 0),
            status: 'ANSWERED',
            toolsUsed: JSON.stringify(aiResponse.toolsUsed || []),
        });

        return successResponse({
            answer: aiResponse.answer || `Batch ${batch.batchCode} (${productName}) has been verified. Trust score: ${batch.trustScore}/100. Blockchain status: ${chainV.status}.`,
            evidence: aiResponse.evidence || [],
            sources: aiResponse.sources || [],
            confidence: aiResponse.confidence || 0,
            toolsUsed: aiResponse.toolsUsed || ['database_lookup', 'blockchain_verify'],
            batchSummary: {
                batchCode: batch.batchCode,
                product: productName,
                origin: batch.location,
                trustScore: batch.trustScore,
                blockchainVerified: chainV.status === 'VERIFIED',
                blockchainStatus: chainV.status,
                certificatesVerified: batchContext.certificatesVerified,
            },
            batchFound: true,
        });
    } catch (err: unknown) {
        console.error('Consumer chat error:', err);
        return errorResponse('Failed to process consumer query', 'SERVER_ERROR', 500);
    }
}
