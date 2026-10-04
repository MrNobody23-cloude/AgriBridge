import { NextRequest } from 'next/server';
import { listPendingCertificates, reviewCertificate } from '@/lib/db/repositories/catalog';
import { findBatchById, createSupplyChainEvent } from '@/lib/db/repositories/batches';
import { requirePermission } from '@/lib/auth';
import { createAuditLog } from '@/lib/auditLog';
import { successResponse, errorResponse } from '@/lib/response';

export async function GET(req: NextRequest) {
    const auth = await requirePermission(req, 'certificate:verify');
    if (auth instanceof Response) return auth;
    if (auth.user.role !== 'REGULATOR') return errorResponse('Regulator review queue is restricted to regulator accounts', 'FORBIDDEN', 403);
    try {
        return successResponse(await listPendingCertificates());
    } catch (error) {
        console.error('Certificate review queue error:', error);
        return errorResponse('Unable to load certificate review queue', 'SERVER_ERROR', 500);
    }
}

export async function PATCH(req: NextRequest) {
    const auth = await requirePermission(req, 'certificate:verify');
    if (auth instanceof Response) return auth;
    if (auth.user.role !== 'REGULATOR') return errorResponse('Only regulator accounts may issue certificate decisions', 'FORBIDDEN', 403);
    try {
        const body = await req.json() as { certificateId?: unknown; decision?: unknown; notes?: unknown };
        const certificateId = typeof body.certificateId === 'string' ? body.certificateId.trim() : '';
        const decision = body.decision;
        const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
        if (!certificateId || (decision !== 'VERIFIED' && decision !== 'REJECTED') || notes.length < 10 || notes.length > 1000) {
            return errorResponse('Provide a certificate, a VERIFIED or REJECTED decision, and review notes (10–1000 characters).', 'VALIDATION_ERROR', 400);
        }
        const certificate = await reviewCertificate(certificateId, decision, auth.user.id, notes);
        if (!certificate) return errorResponse('Certificate is not pending review or does not exist', 'NOT_FOUND', 404);
        const batch = await findBatchById(certificate.batchId);
        if (batch) {
            await createSupplyChainEvent({
                batchId: batch._id,
                eventType: 'CERTIFICATE_REGULATORY_REVIEW',
                actorId: auth.user.id,
                actorRole: auth.user.role,
                location: 'Regulatory review desk',
                metadata: JSON.stringify({ certificateId, decision, notes }),
            });
        }
        await createAuditLog({ userId: auth.user.id, action: `CERTIFICATE_${decision}`, resource: 'Certificate', resourceId: certificateId, metadata: JSON.stringify({ batchId: certificate.batchId, notes }) });
        return successResponse({ certificate, decision });
    } catch (error) {
        console.error('Certificate review decision error:', error);
        return errorResponse('Unable to record certificate decision', 'SERVER_ERROR', 500);
    }
}
