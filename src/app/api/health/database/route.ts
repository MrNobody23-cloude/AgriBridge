import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { successResponse, errorResponse } from '@/lib/response';

export async function GET(req: NextRequest) {
    const start = Date.now();
    try {
        await prisma.$queryRaw`SELECT 1`;
        const latencyMs = Date.now() - start;
        return successResponse({ status: 'healthy', latencyMs, provider: 'postgresql' });
    } catch (err: any) {
        return errorResponse('Database connection failed: ' + err.message, 'DB_ERROR', 503);
    }
}
