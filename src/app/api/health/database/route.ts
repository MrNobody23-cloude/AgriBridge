import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { successResponse, errorResponse } from '@/lib/response';

export async function GET(req: NextRequest) {
    const start = Date.now();
    try {
        await prisma.$queryRaw`SELECT 1`;
        const latencyMs = Date.now() - start;
        // Read from the connection string rather than a literal. This was a
        // hardcoded 'postgresql', which happened to match the schema and
        // would have kept claiming postgres to a health check that reached
        // some other database. Nothing here reports the host or the
        // credentials — the scheme is the only part that identifies a driver,
        // and it is not sensitive.
        const scheme = (process.env.DATABASE_URL || '').split(':')[0] || 'unknown';
        return successResponse({ status: 'healthy', latencyMs, provider: scheme });
    } catch (err: any) {
        return errorResponse('Database connection failed: ' + err.message, 'DB_ERROR', 503);
    }
}
