import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { findBatchByIdOrCode, createSupplyChainEvent } from '@/lib/db/repositories/batches';
import { findDuplicateCertificate, createCertificate } from '@/lib/db/repositories/catalog';
import { createFraudAlert } from '@/lib/db/repositories/shipments';
import { certificateUploadSchema } from '@/lib/validators';
import { runFraudScan } from '@/lib/services/fraudDetectionService';
import { calculateTrustScore } from '@/lib/services/trustScoreService';
import { successResponse, errorResponse } from '@/lib/response';
import { requireAuth } from '@/lib/auth';
import { createAuditLog } from '@/lib/auditLog';
import { isZodError, firstValidationMessage } from '@/lib/zod-error';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';
const PINATA_GATEWAY = process.env.PINATA_GATEWAY_URL || 'https://gateway.pinata.cloud';

/**
 * Fetches a document from IPFS and computes its SHA-256 hash for integrity verification.
 * Returns null if the file is unreachable (non-blocking — we flag rather than reject).
 */
async function verifyIpfsHash(ipfsHash: string, expectedHash: string): Promise<{
    verified: boolean;
    computedHash: string | null;
    mismatch: boolean;
}> {
    try {
        const url = `${PINATA_GATEWAY}/ipfs/${ipfsHash}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) return { verified: false, computedHash: null, mismatch: false };

        const buffer = Buffer.from(await res.arrayBuffer());
        const computedHash = crypto.createHash('sha256').update(buffer).digest('hex');
        const mismatch = computedHash !== expectedHash;

        return { verified: true, computedHash, mismatch };
    } catch {
        // IPFS gateway unreachable — flag for manual review, don't block upload
        return { verified: false, computedHash: null, mismatch: false };
    }
}

/**
 * Pin a certificate document to Pinata IPFS via the Python AI service.
 * Falls back to direct Pinata REST API if AI service is unavailable.
 */
async function pinCertificateToPinata(
    fileBase64: string,
    fileName: string,
    metadata: Record<string, string>
): Promise<{ ipfsHash: string; ipfsUrl: string } | null> {
    // Try Python AI service IPFS router first
    try {
        const res = await fetch(`${AI_SERVICE_URL}/api/ipfs/pin-base64`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileBase64, fileName, metadata }),
            signal: AbortSignal.timeout(30000),
        });
        if (res.ok) {
            const data = await res.json() as { ipfs_hash?: string; ipfs_url?: string };
            if (data.ipfs_hash) {
                return {
                    ipfsHash: data.ipfs_hash,
                    ipfsUrl: data.ipfs_url || `${PINATA_GATEWAY}/ipfs/${data.ipfs_hash}`,
                };
            }
        }
    } catch {
        // fall through to direct Pinata
    }

    // Direct Pinata fallback
    const pinataJwt = process.env.PINATA_JWT;
    if (!pinataJwt) return null;

    try {
        const formData = new FormData();
        const binaryData = Buffer.from(fileBase64, 'base64');
        formData.append('file', new Blob([binaryData]), fileName);
        formData.append('pinataMetadata', JSON.stringify({ name: fileName, keyvalues: metadata }));

        const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
            method: 'POST',
            headers: { Authorization: `Bearer ${pinataJwt}` },
            body: formData,
            signal: AbortSignal.timeout(30000),
        });

        if (res.ok) {
            const data = await res.json() as { IpfsHash?: string };
            if (data.IpfsHash) {
                return {
                    ipfsHash: data.IpfsHash,
                    ipfsUrl: `${PINATA_GATEWAY}/ipfs/${data.IpfsHash}`,
                };
            }
        }
    } catch {
        // IPFS pinning failed — proceed without IPFS
    }

    return null;
}

/**
 * POST /api/certificates/upload
 *
 * Accepts a certificate document (as base64 or pre-pinned IPFS details),
 * verifies SHA-256 hash integrity against both the DB and optionally the IPFS CID,
 * stores the certificate, triggers fraud scan, and recalculates Trust Score.
 *
 * Required roles: FARMER, EXPORTER, REGULATOR, ADMIN
 */
export async function POST(req: NextRequest) {
    const session = await requireAuth(req, ['FARMER', 'EXPORTER', 'REGULATOR', 'ADMIN']);
    if ('status' in session) return session;

    try {
        const contentLength = Number(req.headers.get('content-length') || 0);
        if (contentLength > 7 * 1024 * 1024) {
            return errorResponse('Certificate upload must be 5 MB or smaller', 'FILE_TOO_LARGE', 413);
        }
        const body = await req.json();
        const validated = certificateUploadSchema.parse(body);

        if (validated.fileBase64) {
            const fileBytes = Buffer.from(validated.fileBase64, 'base64');
            if (fileBytes.length === 0 || fileBytes.length > 5 * 1024 * 1024) {
                return errorResponse('Certificate upload must be between 1 byte and 5 MB', 'FILE_TOO_LARGE', 413);
            }
            const actualHash = crypto.createHash('sha256').update(fileBytes).digest('hex');
            if (actualHash.toLowerCase() !== validated.fileHash.toLowerCase()) {
                return errorResponse('The uploaded file does not match its SHA-256 hash', 'FILE_HASH_MISMATCH', 400);
            }
            const isPdf = fileBytes.subarray(0, 5).toString('ascii') === '%PDF-';
            const isPng = fileBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
            const isJpeg = fileBytes[0] === 0xff && fileBytes[1] === 0xd8 && fileBytes[2] === 0xff;
            if (!isPdf && !isPng && !isJpeg) {
                return errorResponse('Upload a valid PDF, PNG, or JPEG certificate file', 'UNSUPPORTED_FILE_TYPE', 415);
            }
        }

        // Verify the batch exists and the uploader is authorized. Only
        // `farmerId` is read from the batch — Prisma's `farmer: { select: { id } }`
        // was one extra join for a single foreign key.
        const batch = await findBatchByIdOrCode(validated.batchId);

        if (!batch) {
            return errorResponse('Batch not found', 'BATCH_NOT_FOUND', 404);
        }

        // Only the batch owner, exporters, regulators, and admins can upload certificates
        const isOwner = batch.farmerId === session.user.id;
        const isPrivileged = ['EXPORTER', 'REGULATOR', 'ADMIN'].includes(session.user.role);
        if (!isOwner && !isPrivileged) {
            return errorResponse('Not authorized to upload certificates for this batch', 'FORBIDDEN', 403);
        }

        // ── 1. Duplicate SHA-256 Hash Detection ─────────────────────────────────
        // The repository excludes this batch, so a non-null result is a match on
        // a *different* batch — which is the fraud signal, exactly as before.
        const duplicate = await findDuplicateCertificate(validated.fileHash, batch._id);

        // A file hash proves byte integrity only; it does not authenticate the
        // issuer or certificate. Mark it verified only after IPFS bytes match.
        let verificationStatus = 'PENDING';
        let duplicateDetected = false;
        let fraudReason = '';

        if (duplicate) {
            // Hash collision across DIFFERENT batches → definite fraud signal
            verificationStatus = 'SUSPICIOUS';
            duplicateDetected = true;
            fraudReason = `SHA-256 hash collision: file hash matches certificate on batch ${duplicate.batch.batchCode}.`;
        }

        // ── 2. IPFS Pin (if file content provided) ──────────────────────────────
        let ipfsHash: string | undefined = validated.ipfsHash;
        let fileUrl = validated.fileUrl;

        if (validated.fileBase64 && !ipfsHash) {
            const pinResult = await pinCertificateToPinata(
                validated.fileBase64,
                (validated.fileName || `${validated.certificateType}_${batch.batchCode}`)
                    .replace(/[\\/\0]/g, '_')
                    .slice(0, 255),
                {
                    batchCode: batch.batchCode,
                    certificateType: validated.certificateType,
                    issuer: validated.issuer,
                }
            );
            if (pinResult) {
                ipfsHash = pinResult.ipfsHash;
                fileUrl = pinResult.ipfsUrl;
            }
        }

        // ── 3. IPFS Hash Integrity Verification ─────────────────────────────────
        let ipfsVerified = false;
        let ipfsHashMismatch = false;

        if (ipfsHash && validated.fileHash) {
            const ipfsCheck = await verifyIpfsHash(ipfsHash, validated.fileHash);
            ipfsVerified = ipfsCheck.verified && !ipfsCheck.mismatch;
            ipfsHashMismatch = ipfsCheck.mismatch;

            if (ipfsHashMismatch && !duplicateDetected) {
                verificationStatus = 'SUSPICIOUS';
                duplicateDetected = true; // Treat as a trust violation
                fraudReason = `IPFS content hash mismatch: declared ${validated.fileHash.slice(0, 16)}… but IPFS computed ${ipfsCheck.computedHash?.slice(0, 16) ?? 'unknown'}…`;
            }
            if (ipfsVerified && !duplicateDetected) verificationStatus = 'VERIFIED';
        }

        // ── 4. Persist Certificate ───────────────────────────────────────────────
        const certificate = await createCertificate({
            batchId: batch._id,
            certificateType: validated.certificateType,
            fileUrl: fileUrl || validated.fileUrl || '',
            fileHash: validated.fileHash,
            ipfsHash: ipfsHash,
            issuer: validated.issuer,
            issueDate: new Date(`${validated.issueDate}T00:00:00Z`),
            expiryDate: new Date(validated.expiryDate),
            verificationStatus,
        });

        await createSupplyChainEvent({
            batchId: batch._id,
            eventType: 'CERTIFICATE_UPLOADED',
            actorId: session.user.id,
            actorRole: session.user.role,
            location: batch.location,
            metadata: JSON.stringify({
                certificateId: certificate._id,
                certificateType: validated.certificateType,
                verificationStatus,
                fileHash: validated.fileHash,
                ipfsHash: ipfsHash || null,
            }),
        });

        // ── 5. Fraud Alert if suspicious ────────────────────────────────────────
        let fraudAlerts: unknown[] = [];
        if (duplicateDetected && fraudReason) {
            await createFraudAlert({
                batchId: batch._id,
                fraudType: ipfsHashMismatch ? 'HASH_MISMATCH' : 'DUPLICATE_CERTIFICATE',
                severity: 'CRITICAL',
                description: fraudReason,
                confidence: ipfsHashMismatch ? 1.0 : 0.99,
                status: 'OPEN',
            });
        }

        // Always run fraud scan (detects other anomaly signals too)
        fraudAlerts = await runFraudScan(batch._id);

        // ── 6. Recalculate Trust Score ───────────────────────────────────────────
        await calculateTrustScore(batch._id);

        // ── 7. Audit Log ─────────────────────────────────────────────────────────
        await createAuditLog({
            userId: session.user.id,
            action: 'CERTIFICATE_UPLOAD',
            resource: 'Certificate',
            resourceId: certificate._id,
            details: {
                batchCode: batch.batchCode,
                certificateType: validated.certificateType,
                fileHash: validated.fileHash,
                ipfsHash: ipfsHash || null,
                verificationStatus,
                duplicateDetected,
                ipfsVerified,
            },
        });

        return successResponse({
            certificate,
            duplicateDetected,
            fraudAlerts,
            ipfsVerified,
            ipfsHashMismatch,
            message: duplicateDetected
                ? `⚠️ FRAUD ALERT: ${fraudReason} Certificate flagged for Regulator review.`
                : ipfsVerified
                    ? `Certificate bytes were matched against the IPFS copy (${ipfsHash}). Issuer authenticity is not independently confirmed.`
                    : 'Certificate recorded as pending verification. File integrity or issuer authenticity has not been confirmed.',
        });
    } catch (error: unknown) {
        if (isZodError(error)) {
            return errorResponse(firstValidationMessage(error), 'VALIDATION_ERROR', 400);
        }
        console.error('[CertificateUpload] Error:', error);
        const message = error instanceof Error ? error.message : 'Failed to upload certificate';
        return errorResponse(message, 'SERVER_ERROR', 500);
    }
}
