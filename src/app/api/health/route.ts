import { NextRequest } from 'next/server';
import { successResponse } from '@/lib/response';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

async function checkService(url: string, label: string): Promise<{ status: string; latencyMs?: number; error?: string }> {
    const start = Date.now();
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        const latencyMs = Date.now() - start;
        return res.ok ? { status: 'healthy', latencyMs } : { status: 'degraded', latencyMs, error: `HTTP ${res.status}` };
    } catch (err: any) {
        return { status: 'unavailable', error: err.message };
    }
}

export async function GET(req: NextRequest) {
    const [db, ai, aiRag] = await Promise.all([
        checkService(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/health/database`, 'database'),
        checkService(`${AI_SERVICE_URL}/api/health`, 'ai'),
        checkService(`${AI_SERVICE_URL}/api/rag/documents/count`, 'rag'),
    ]);

    const all = { database: db, ai_service: ai, rag: aiRag };
    const overall = Object.values(all).every(s => s.status === 'healthy') ? 'healthy' : 'degraded';

    return successResponse({
        status: overall,
        services: all,
        version: '2.0.0',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV,
    });
}
