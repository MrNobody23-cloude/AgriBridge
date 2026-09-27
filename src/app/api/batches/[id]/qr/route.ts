import { NextRequest } from 'next/server';
import { findBatchByIdOrCode } from '@/lib/db/repositories/batches';
import { successResponse, errorResponse } from '@/lib/response';
import QRCode from 'qrcode';

// ─── GET /api/batches/[id]/qr ──────────────────────────────────────────────────
// Generate a QR code for a verified batch. Returns base64 PNG.

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    try {
        // A QR code is a public verification entry point, so this route
        // deliberately has no role check — the same batch id or batchCode works
        // either way, exactly as it did under Prisma's `OR` lookup.
        const batch = await findBatchByIdOrCode(id);
        if (!batch) return errorResponse(`Batch ${id} not found`, 'BATCH_NOT_FOUND', 404);

        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
        const verifyUrl = `${appUrl}/verify/${batch.batchCode}`;

        // Generate QR code as PNG base64 data URI
        const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
            errorCorrectionLevel: 'H',
            type: 'image/png',
            margin: 2,
            color: { dark: '#1a5c2e', light: '#ffffff' },
            width: 400,
        });

        // Also generate as SVG string
        const qrSvg = await QRCode.toString(verifyUrl, {
            type: 'svg',
            errorCorrectionLevel: 'H',
            margin: 2,
        });

        return successResponse({
            batchId: batch._id,
            batchCode: batch.batchCode,
            verifyUrl,
            qrDataUrl,
            qrSvg,
            trustScore: batch.trustScore,
            generatedAt: new Date().toISOString(),
        });
    } catch (error: unknown) {
        console.error('QR generation error:', error);
        return errorResponse('Failed to generate QR code', 'SERVER_ERROR', 500);
    }
}
