import { NextRequest } from 'next/server';
import { getBatchDetail, type BatchDetail } from '@/lib/db/repositories/batches';
import { createAgentLog } from '@/lib/db/repositories/agents';
import { optionalAuth } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/response';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';
const AI_SERVICE_API_KEY = process.env.AI_SERVICE_API_KEY;

function feedJson(value: Record<string, unknown>): string {
    return JSON.stringify(value, (_key, item) => typeof item === 'string' ? item.slice(0, 1000) : item).slice(0, 4000);
}

function buildKnowledgeDocuments(batch: BatchDetail, chainVerification: { status: string; verified: boolean; blockchainHash: string | null; transactionHash: string | null }) {
    const docs = [{
        document_id: `batch:${batch._id}`,
        title: `Batch ${batch.batchCode} feed record`,
        source: 'AgriBridge batch feed',
        verification: 'MongoDB source record',
        content: feedJson({
            batchCode: batch.batchCode, product: batch.product?.name, variety: batch.variety,
            quantity: batch.quantity, unit: batch.unit, harvestDate: batch.harvestDate,
            origin: batch.location, status: batch.status, trustScore: batch.trustScore,
            farmerName: batch.farmer?.name,
        }),
    }];

    for (const event of batch.events.slice(-50)) {
        docs.push({
            document_id: `event:${event._id}`,
            title: `Supply-chain event ${event.eventType} for ${batch.batchCode}`,
            source: 'AgriBridge supply-chain event feed',
            verification: event.blockchainTransactionHash ? 'Database feed; transaction hash recorded, event not independently verified' : 'Database feed; no transaction hash recorded',
            content: feedJson({
                eventType: event.eventType, timestamp: event.timestamp, location: event.location,
                actorRole: event.actor?.role || event.actorRole || 'UNKNOWN',
                actorName: event.actor?.name || null, metadata: event.metadata || null,
                transactionHash: event.blockchainTransactionHash || null,
            }),
        });
    }

    for (const cert of batch.certificates.slice(0, 30)) {
        docs.push({
            document_id: `certificate:${cert._id}`,
            title: `${cert.certificateType} certificate for ${batch.batchCode}`,
            source: 'AgriBridge certificate feed',
            verification: `Certificate status: ${cert.verificationStatus}`,
            content: feedJson({
                type: cert.certificateType, issuer: cert.issuer, issueDate: cert.issueDate,
                expiryDate: cert.expiryDate, verificationStatus: cert.verificationStatus,
                fileHash: cert.fileHash, blockchainHash: cert.blockchainHash,
            }),
        });
    }

    for (const shipment of batch.shipments.slice(0, 30)) {
        docs.push({
            document_id: `shipment:${shipment._id}`,
            title: `Shipment ${shipment.shipmentCode} for ${batch.batchCode}`,
            source: 'AgriBridge exporter/importer shipment feed',
            verification: 'MongoDB shipment feed',
            content: feedJson({
                shipmentCode: shipment.shipmentCode, destinationCountry: shipment.destinationCountry,
                quantity: shipment.quantity, unit: shipment.unit, status: shipment.status,
                riskScore: shipment.riskScore, estimatedArrival: shipment.estimatedArrival,
                exporterName: shipment.exporter?.name,
                compliance: shipment.complianceChecks.map((check) => ({
                    country: check.country, requirement: check.requirement, status: check.status,
                    explanation: check.explanation, source: check.source,
                })),
            }),
        });
    }

    docs.push({
        document_id: `blockchain:${batch.batchCode}`,
        title: `Blockchain verification for ${batch.batchCode}`,
        source: 'Configured blockchain verification result',
        verification: chainVerification.status,
        content: feedJson({
            status: chainVerification.status, verified: chainVerification.verified,
            databaseHash: batch.blockchainHash, blockchainHash: chainVerification.blockchainHash,
            transactionHash: batch.blockchainTransactionHash || chainVerification.transactionHash,
        }),
    });
    return docs;
}

function retrieveFeedEvidence(query: string, documents: ReturnType<typeof buildKnowledgeDocuments>) {
    const terms = [...new Set(query.toLowerCase().match(/[a-z0-9-]{3,}/g) || [])];
    return documents
        .map((doc) => {
            const text = `${doc.title} ${doc.content}`.toLowerCase();
            const matches = terms.filter((term) => text.includes(term)).length;
            return { doc, score: matches / Math.max(terms.length, 1) };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 4);
}

export async function POST(req: NextRequest) {
    // Optional auth allows unauthenticated public consumers to query verified batch information
    await optionalAuth(req);

    try {
        const body = await req.json();
        const { batchId, query } = body;

        if (!batchId || !query) {
            return errorResponse('batchId and query are required', 'VALIDATION_ERROR', 400);
        }
        if (query.length > 500) {
            return errorResponse('Query too long (max 500 chars)', 'VALIDATION_ERROR', 400);
        }

        // Fetch full batch data to ground the AI answer.
        const batch = await getBatchDetail(batchId);

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
            product: { name: productName },
            crop: productName,
            location: batch.location,
            origin: batch.location,
            harvestDate: batch.harvestDate,
            status: batch.status,
            farmerName,
            farmName: batch.farmer?.farmerProfile?.farmName,
            farmLocation: batch.farmer?.farmerProfile?.location,
            blockchainVerified: chainV.status === 'VERIFIED',
            blockchainStatus: chainV.status,
            certificates: batch.certificates,
            certificatesCount: batch.certificates.length,
            certificatesVerified: batch.certificates.filter(c => c.verificationStatus === 'VERIFIED').length,
            events: batch.events,
            supplyChainEvents: batch.events.length,
            trustScore: batch.trustScore,
            fraudAlerts: batch.fraudAlerts,
            fraudAlertsCount: batch.fraudAlerts.length,
        };

        const knowledgeDocuments = buildKnowledgeDocuments(batch, chainV);
        const localMatches = retrieveFeedEvidence(query, knowledgeDocuments);
        const groundedRag = {
            answer: localMatches.length
                ? `Matching live records for batch ${batch.batchCode}:\n${localMatches.map(({ doc }) => `• ${doc.title} (${doc.verification}): ${doc.content}`).join('\n')}`
                : 'I could not find a matching validated record for that question. Try asking about the batch origin, a recorded supply-chain event, a certificate, a shipment, or the blockchain verification result.',
            confidence: localMatches[0]?.score ?? 0,
            evidence: localMatches.map(({ doc }) => `${doc.title} [${doc.verification}]: ${doc.content}`),
            sources: localMatches.map(({ doc }) => ({ title: doc.title, source: doc.source, verification: doc.verification })),
        };

        // Call Python AI service for RAG + LLM answer if service is available
        let aiResponse: Record<string, unknown> = {};
        if (AI_SERVICE_API_KEY) try {
            const res = await fetch(`${AI_SERVICE_URL}/api/agents/consumer/answer`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(AI_SERVICE_API_KEY ? { 'x-agribridge-api-key': AI_SERVICE_API_KEY } : {}),
                },
                body: JSON.stringify({
                    batchCode: batch.batchCode,
                    query,
                    batchData: {
                        ...batchContext,
                        blockchainHash: batch.blockchainHash,
                        blockchainTransactionHash: batch.blockchainTransactionHash,
                        chainVerification: chainV,
                        knowledgeDocuments,
                    },
                }),
                signal: AbortSignal.timeout(5000),
            });
            if (res.ok) {
                const json = await res.json();
                if (json.success && json.answer) {
                    aiResponse = json;
                }
            }
        } catch (err: unknown) {
            console.warn('AI service unavailable for consumer chat, using local grounded RAG engine:', err instanceof Error ? err.message : String(err));
        }

        const finalAnswer = (aiResponse.answer as string) || groundedRag.answer;
        const finalConfidence = typeof aiResponse.confidence === 'number' ? aiResponse.confidence : groundedRag.confidence;
        const finalEvidence = (aiResponse.evidence as string[]) || groundedRag.evidence;
        const toolsUsed = (aiResponse.toolsUsed as string[]) || ['database_lookup', 'blockchain_verify', 'rag_synthesis'];

        // Log interaction
        await createAgentLog({
            agentName: 'Consumer Trust Agent',
            agentType: 'consumer',
            task: `Answer consumer query for batch ${batch.batchCode}`,
            input: query,
            output: finalAnswer,
            confidence: finalConfidence,
            status: 'ANSWERED',
            toolsUsed: JSON.stringify(toolsUsed),
        });

        return successResponse({
            answer: finalAnswer,
            evidence: finalEvidence,
            sources: (aiResponse.sources as string[]) || groundedRag.sources,
            confidence: finalConfidence,
            toolsUsed,
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
