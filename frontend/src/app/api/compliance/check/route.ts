import { NextRequest } from 'next/server';
import { findShipmentByIdOrCode, replaceComplianceChecks } from '@/lib/db/repositories/shipments';
import { findBatchById } from '@/lib/db/repositories/batches';
import { findProductNameById } from '@/lib/db/repositories/catalog';
import { createAgentLog } from '@/lib/db/repositories/agents';
import { requireAuth } from '@/lib/auth';
import { complianceCheckSchema } from '@/lib/validators';
import { successResponse, errorResponse } from '@/lib/response';
import { isZodError, firstValidationMessage } from '@/lib/zod-error';
import type { ApiSource } from '@/lib/api-types';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

export async function POST(req: NextRequest) {
    const authResult = await requireAuth(req, ['EXPORTER', 'REGULATOR', 'ADMIN', 'FARMER', 'IMPORTER', 'RETAILER']);
    if (authResult instanceof Response) return authResult;

    try {
        const body = await req.json();
        const validated = complianceCheckSchema.parse(body);

        const shipment = await findShipmentByIdOrCode(validated.shipmentId);

        if (!shipment) {
            return errorResponse(`Shipment ${validated.shipmentId} not found`, 'SHIPMENT_NOT_FOUND', 404);
        }
        if (authResult.user.role === 'EXPORTER' && shipment.exporterId !== authResult.user.id) {
            return errorResponse('You can only review your own export shipments', 'FORBIDDEN', 403);
        }

        // The `include: { batch: { include: { product, certificates } }, complianceChecks }`
        // this used to fetch is not read below — the crop falls back to the
        // product name, and the old checks are deleted rather than compared —
        // so only the product is loaded.
        const batch = await findBatchById(shipment.batchId);
        const productName = batch ? await findProductNameById(batch.productId) : null;

        const crop = validated.crop || productName || 'unknown crop';

        // Call Python RAG service for real regulatory compliance check
        let ragResult: Record<string, unknown> = {};
        try {
            const res = await fetch(`${AI_SERVICE_URL}/api/rag/compliance/check`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    country: validated.country,
                    crop,
                    shipmentId: shipment._id,
                    batchId: batch?._id,
                }),
                signal: AbortSignal.timeout(30000),
            });
            if (res.ok) {
                ragResult = await res.json();
            } else {
                console.warn('RAG service returned:', res.status);
            }
        } catch (err: unknown) {
            console.warn('RAG service unavailable:', err instanceof Error ? err.message : String(err));
        }

        const answer = String(ragResult.answer || '');
        // The RAG service sends `sources` in one of two shapes — a bare list of
        // citation strings on the retrieval path, or a list of
        // `{ title, source }` objects on the citation paths
        // (`ai-service/rag/pipeline.py:210,250,260`). `ragResult` is
        // `Record<string, unknown>`, so the value is unverified: it may be
        // absent, `null`, or not an array at all. Narrowing once here means the
        // stored `source`, the returned `sources` and the agent log all
        // describe the same citations, and neither downstream read has to
        // guess.
        const sources: (string | ApiSource)[] = Array.isArray(ragResult.sources)
            ? (ragResult.sources as (string | ApiSource)[])
            : [];

        /**
         * The document name for one source, whichever shape it arrived in.
         *
         * Before this, `sources[0]?.source` was read directly. On the string
         * path — which is the path that runs when the service *does* answer —
         * `.source` is `undefined`, so a check with real retrievals behind it
         * was persisted and logged as "No regulatory source retrieved — RAG
         * service did not respond". The service was working; only the read was
         * wrong.
         */
        const sourceName = (src: string | ApiSource | undefined): string => {
            if (!src) return '';
            if (typeof src === 'string') return src;
            return src.source || src.title || '';
        };

        // The citation names the document that was actually retrieved. With
        // nothing retrieved there is no document, so it says so rather than
        // naming a knowledge base that was never queried.
        const firstSource = sourceName(sources[0]) ||
            'No validated regulatory evidence retrieved';
        // An unanswered check has no retrieval behind it, so it has no
        // confidence to report. This defaulted to 0.7 whenever the AI service
        // did not answer, which wrote a fabricated score into AiAgentLog and
        // returned it to the exporter page as the strength of a check that
        // never ran.
        const confidence = ragResult.answer ? Number(ragResult.confidence || 0) : 0;

        // Parse compliance checks from RAG answer or fallback
        // A generated answer or a non-empty retrieval is not a compliance
        // decision. Until an authoritative, versioned ruleset supplies a
        // structured assessment, keep the result pending for human review.
        const passed = false;

        // Save compliance checks to DB
        const checks = [
            {
                requirement: `Export compliance for ${validated.country}`,
                status: 'PENDING',
                // The citation names the document that was actually retrieved.
                // With nothing retrieved there is no document, so it says so
                // rather than naming a knowledge base that was never queried.
                explanation: answer || 'No answer or validated evidence was returned. Manual regulatory review is required.',
                source: firstSource,
            },
        ];

        // Delete old checks for this shipment/country, then insert fresh ones.
        // The repository does both; neither half is atomic, exactly as under
        // Prisma — see the note on `replaceComplianceChecks`.
        await replaceComplianceChecks(
            shipment._id,
            validated.country,
            checks.map((c) => ({
                requirement: c.requirement,
                status: c.status,
                explanation: c.explanation,
                source: c.source,
                evidence: JSON.stringify(ragResult.evidence || []),
            }))
        );

        // Log
        await createAgentLog({
            agentName: 'Compliance Agent (RAG)',
            agentType: 'compliance',
            task: `Regulatory screening for export to ${validated.country}`,
            input: JSON.stringify({ country: validated.country, crop, shipmentId: shipment._id }),
            output: answer,
            confidence,
            status: 'PENDING',
            evidence: JSON.stringify(ragResult.evidence || []),
            sources: JSON.stringify(sources),
        });

        return successResponse({
            shipmentId: shipment._id,
            shipmentCode: shipment.shipmentCode,
            country: validated.country,
            crop,
            passed,
            checks,
            ragAnswer: answer,
            sources,
            confidence,
            warning: !ragResult.answer
                ? 'AI_SERVICE_UNAVAILABLE'
                : sources.length === 0
                    ? 'NO_VALIDATED_REGULATORY_EVIDENCE'
                    : 'HUMAN_REVIEW_REQUIRED',
        });
    } catch (err: unknown) {
        if (isZodError(err)) {
            return errorResponse(firstValidationMessage(err), 'VALIDATION_ERROR', 400);
        }
        console.error('Compliance check error:', err);
        return errorResponse('Failed to perform compliance check', 'SERVER_ERROR', 500);
    }
}
