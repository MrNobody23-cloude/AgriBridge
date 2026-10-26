import { NextRequest } from 'next/server';
import { listPendingCertificates, reviewCertificate } from '@/lib/db/repositories/catalog';
import { findBatchById, createSupplyChainEvent } from '@/lib/db/repositories/batches';
import { requireAuth } from '@/lib/auth';
import { createAuditLog } from '@/lib/auditLog';
import { recordSupplyChainEventOnChain } from '@/lib/blockchain';
import { successResponse, errorResponse } from '@/lib/response';

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, ['ADMIN']);
  if (auth instanceof Response) return auth;
  try { return successResponse(await listPendingCertificates()); }
  catch (error) { console.error('Admin certificate queue error:', error); return errorResponse('Unable to load pending certificates.', 'SERVER_ERROR', 500); }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req, ['ADMIN']);
  if (auth instanceof Response) return auth;
  try {
    const body = await req.json() as { certificateId?: unknown; decision?: unknown; notes?: unknown };
    const certificateId = typeof body.certificateId === 'string' ? body.certificateId.trim() : '';
    const decision = body.decision;
    const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
    if (!certificateId || (decision !== 'VERIFIED' && decision !== 'REJECTED') || notes.length < 10 || notes.length > 1000) return errorResponse('Provide a certificate, VERIFIED or REJECTED decision, and review notes (10–1000 characters).', 'VALIDATION_ERROR', 400);
    const certificate = await reviewCertificate(certificateId, decision, auth.user.id, notes);
    if (!certificate) return errorResponse('Certificate is not pending review or does not exist.', 'NOT_FOUND', 404);
    const batch = await findBatchById(certificate.batchId);
    if (batch) {
      const metadata = JSON.stringify({ certificateId, certificateType: certificate.certificateType, decision, notes, reviewedBy: auth.user.id, reviewedAt: certificate.reviewedAt?.toISOString() || new Date().toISOString() });
      const ledger = await recordSupplyChainEventOnChain({ batchCode: batch.batchCode, eventType: 'FSSAI_CERTIFICATE_ADMIN_DECISION', actorRole: 'ADMIN', location: 'AgriBridge admin review', metadata });
      await createSupplyChainEvent({ batchId: batch._id, eventType: 'FSSAI_CERTIFICATE_ADMIN_DECISION', actorId: auth.user.id, actorRole: 'ADMIN', location: 'AgriBridge admin review', metadata: JSON.stringify({ ...JSON.parse(metadata), ledgerStatus: ledger.reason || 'ANCHORED' }), blockchainTransactionHash: ledger.transactionHash });
    }
    await createAuditLog({ userId: auth.user.id, action: `CERTIFICATE_${decision}`, resource: 'Certificate', resourceId: certificateId, metadata: JSON.stringify({ batchId: certificate.batchId, notes }) });
    return successResponse({ certificate, decision });
  } catch (error) { console.error('Admin certificate decision error:', error); return errorResponse('Unable to record certificate decision.', 'SERVER_ERROR', 500); }
}
