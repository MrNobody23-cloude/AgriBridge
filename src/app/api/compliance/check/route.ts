import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { complianceCheckSchema } from '@/lib/validators';
import { successResponse, errorResponse } from '@/lib/response';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

export async function POST(req: NextRequest) {
    const authResult = await requireAuth(req, ['EXPORTER', 'REGULATOR', 'ADMIN', 'FARMER']);
    if (authResult instanceof Response) return authResult;

    try {
        const body = await req.json();
        const validated = complianceCheckSchema.parse(body);

        const shipment = await prisma.shipment.findFirst({
            where: { OR: [{ id: validated.shipmentId }, { shipmentCode: validated.shipmentId }] },
            include: {
                batch: { include: { product: true, certificates: true } },
                complianceChecks: true,
            },
        });

        if (!shipment) {
            return errorResponse(`Shipment ${validated.shipmentId} not found`, 'SHIPMENT_NOT_FOUND', 404);
        }

        const crop = validated.crop || shipment.batch.product.name;

        // Call Python RAG service for real regulatory compliance check
        let ragResult: Record<string, unknown> = {};
        try {
            const res = await fetch(`${AI_SERVICE_URL}/api/rag/compliance/check`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    country: validated.country,
                    crop,
                    shipmentId: shipment.id,
                    batchId: shipment.batch.id,
                }),
                signal: AbortSignal.timeout(30000),
            });
            if (res.ok) {
                ragResult = await res.json();
            } else {
                console.warn('RAG service returned:', res.status);
            }
        } catch (err: any) {
            console.warn('RAG service unavailable:', err.message);
        }

        const answer = String(ragResult.answer || '');
        const sources = (ragResult.sources as any[]) || [];
        // An unanswered check has no retrieval behind it, so it has no
        // confidence to report. This defaulted to 0.7 whenever the AI service
        // did not answer, which wrote a fabricated score into AiAgentLog and
        // returned it to the exporter page as the strength of a check that
        // never ran.
        const confidence = ragResult.answer ? Number(ragResult.confidence || 0) : 0;

        // Parse compliance checks from RAG answer or fallback
        const passed = !answer.toLowerCase().includes('insufficient evidence') &&
                       !answer.toLowerCase().includes('not compliant') &&
                       answer.length > 50;

        // Save compliance checks to DB
        const checks = [
            {
                requirement: `Export compliance for ${validated.country}`,
                status: passed ? 'PASSED' : 'PENDING',
                // The citation names the document that was actually retrieved.
                // With nothing retrieved there is no document, so it says so
                // rather than naming a knowledge base that was never queried.
                explanation: answer.slice(0, 500) || 'RAG analysis pending',
                source: sources[0]?.source || 'No regulatory source retrieved — RAG service did not respond',
            },
        ];

        // Delete old checks for this shipment/country, then insert fresh ones
        await prisma.complianceCheck.deleteMany({
            where: { shipmentId: shipment.id, country: validated.country },
        });
        await prisma.complianceCheck.createMany({
            data: checks.map(c => ({
                shipmentId: shipment.id,
                country: validated.country,
                requirement: c.requirement,
                status: c.status,
                explanation: c.explanation,
                source: c.source,
                evidence: JSON.stringify(ragResult.evidence || []),
            })),
        });

        // Log
        await prisma.aiAgentLog.create({
            data: {
                agentName: 'Compliance Agent (RAG)',
                agentType: 'compliance',
                task: `Regulatory screening for export to ${validated.country}`,
                input: JSON.stringify({ country: validated.country, crop, shipmentId: shipment.id }),
                output: answer.slice(0, 500),
                confidence,
                status: passed ? 'PASSED' : 'PENDING',
                evidence: JSON.stringify(ragResult.evidence || []),
                sources: JSON.stringify(sources),
            },
        });

        return successResponse({
            shipmentId: shipment.id,
            shipmentCode: shipment.shipmentCode,
            country: validated.country,
            crop,
            passed,
            checks,
            ragAnswer: answer,
            sources,
            confidence,
            warning: !ragResult.answer ? 'AI_SERVICE_UNAVAILABLE' : undefined,
        });
    } catch (err: any) {
        if (err.name === 'ZodError') {
            return errorResponse(err.errors[0]?.message || 'Validation failed', 'VALIDATION_ERROR', 400);
        }
        console.error('Compliance check error:', err);
        return errorResponse('Failed to perform compliance check', 'SERVER_ERROR', 500);
    }
}
