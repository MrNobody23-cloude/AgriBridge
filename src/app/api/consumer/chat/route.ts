import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
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

        // Fetch full batch data to ground the AI answer
        const batch = await prisma.batch.findFirst({
            where: { OR: [{ id: batchId }, { batchCode: batchId }] },
            include: {
                product: true,
                farmer: { select: { name: true, farmerProfile: true } },
                events: { orderBy: { timestamp: 'asc' } },
                certificates: true,
                trustScoreDetails: true,
                temperatureLogs: { orderBy: { timestamp: 'desc' }, take: 20 },
                shipments: { include: { complianceChecks: true } },
                fraudAlerts: { where: { status: { not: 'RESOLVED' } } },
            },
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
        } catch (err: any) {
            console.warn('AI service unavailable for consumer chat:', err.message);
        }

        // Log interaction
        await prisma.aiAgentLog.create({
            data: {
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
            },
        });

        return successResponse({
            answer: aiResponse.answer || `Batch ${batch.batchCode} (${batch.product.name}) has been verified. Trust score: ${batch.trustScore}/100. Blockchain status: ${chainV.status}.`,
            evidence: aiResponse.evidence || [],
            sources: aiResponse.sources || [],
            confidence: aiResponse.confidence || 0,
            toolsUsed: aiResponse.toolsUsed || ['database_lookup', 'blockchain_verify'],
            batchSummary: {
                batchCode: batch.batchCode,
                product: batch.product.name,
                origin: batch.location,
                trustScore: batch.trustScore,
                blockchainVerified: chainV.status === 'VERIFIED',
                blockchainStatus: chainV.status,
                certificatesVerified: batchContext.certificatesVerified,
            },
            batchFound: true,
        });
    } catch (err: any) {
        console.error('Consumer chat error:', err);
        return errorResponse('Failed to process consumer query', 'SERVER_ERROR', 500);
    }
}
