import { NextRequest } from 'next/server';
import { successResponse } from '@/lib/response';
import { prisma } from '@/lib/prisma';
import { isBlockchainConfigured } from '@/lib/blockchain';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

/**
 * A service is only 'healthy' if it was actually reached and answered
 * correctly. A service that is not configured is 'not_configured', which is
 * deliberately not counted as healthy: the previous version folded a missing
 * service into a generic 'degraded' and reported nothing at all about
 * blockchain, IPFS or the LLM provider, so an unconfigured deployment looked
 * merely degraded rather than plainly unconfigured.
 */
type ServiceStatus = 'healthy' | 'unavailable' | 'not_configured' | 'degraded';

interface ServiceReport {
    status: ServiceStatus;
    latencyMs?: number;
    detail: string;
}

async function checkService(url: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        return { ok: res.ok, latencyMs: Date.now() - start, error: res.ok ? undefined : `HTTP ${res.status}` };
    } catch (err: any) {
        return { ok: false, latencyMs: Date.now() - start, error: err?.message ?? String(err) };
    }
}

/** A capability is configured when the credentials it needs are present. */
function hasEnv(...names: string[]): boolean {
    return names.some((n) => {
        const v = process.env[n];
        return typeof v === 'string' && v.trim() !== '';
    });
}

export async function GET(req: NextRequest) {
    // ── Database: queried directly rather than through an internal HTTP call,
    //    so this reports the state of this process's own connection.
    const dbStart = Date.now();
    let database: ServiceReport;
    try {
        await prisma.$queryRaw`SELECT 1`;
        database = {
            status: 'healthy',
            latencyMs: Date.now() - dbStart,
            detail: 'Connection established and a query round-tripped.',
        };
    } catch (err: any) {
        database = { status: 'unavailable', detail: err?.message ?? 'Query failed' };
    }

    const [ai, rag, ml, agents] = await Promise.all([
        checkService(`${AI_SERVICE_URL}/api/health`),
        checkService(`${AI_SERVICE_URL}/api/rag/documents/count`),
        checkService(`${AI_SERVICE_URL}/api/ml/models`),
        checkService(`${AI_SERVICE_URL}/api/agents/v2/registry`),
    ]);

    const aiService: ServiceReport = ai.ok
        ? { status: 'healthy', latencyMs: ai.latencyMs, detail: 'Responded on /api/health.' }
        : {
              status: process.env.AI_SERVICE_URL ? 'unavailable' : 'not_configured',
              detail: ai.error ?? 'No response.',
          };

    // RAG and ML are only reported as reachable if the AI service itself
    // answered. A failed AI service cannot make its sub-endpoints "unavailable"
    // in a way that implies the RAG index itself is broken.
    const ragReport: ServiceReport = ai.ok
        ? rag.ok
            ? { status: 'healthy', latencyMs: rag.latencyMs, detail: 'RAG document store responded.' }
            : { status: 'degraded', latencyMs: rag.latencyMs, detail: rag.error ?? 'No response from the RAG endpoint.' }
        : { status: 'not_configured', detail: 'Depends on the AI service, which is not answering.' };

    const mlReport: ServiceReport = ai.ok
        ? ml.ok
            ? { status: 'healthy', latencyMs: ml.latencyMs, detail: 'ML model registry responded.' }
            : { status: 'degraded', latencyMs: ml.latencyMs, detail: ml.error ?? 'No response from the ML endpoint.' }
        : { status: 'not_configured', detail: 'Depends on the AI service, which is not answering.' };

    const blockchain: ServiceReport = isBlockchainConfigured()
        ? { status: 'healthy', detail: 'A contract address is configured; chain reads will be attempted on demand.' }
        : {
              status: 'not_configured',
              detail: 'No contract address set. Batches are not written to any chain and no on-chain verification is performed.',
          };

    const ipfsConfigured = hasEnv('PINATA_JWT');
    const ipfs: ServiceReport = ipfsConfigured
        ? { status: 'healthy', detail: 'Pinata credentials present; documents can be pinned.' }
        : {
              status: 'not_configured',
              detail: 'No PINATA_JWT set. Documents are not pinned to IPFS and no IPFS integrity check can run.',
          };

    // The LLM keys are consumed by the Python service, not by this process, so
    // their presence here is a statement about the deployment's environment,
    // not a verification that the key works.
    const llmProvider = hasEnv('GEMINI_API_KEY')
        ? 'Gemini'
        : hasEnv('OPENAI_API_KEY')
          ? 'OpenAI'
          : null;
    const llm: ServiceReport = llmProvider
        ? { status: 'healthy', detail: `${llmProvider} credentials present in the environment.` }
        : {
              status: 'not_configured',
              detail: 'Neither GEMINI_API_KEY nor OPENAI_API_KEY is set. The RAG answer-generation step cannot run.',
          };

    const agentsReport: ServiceReport = ai.ok
        ? agents.ok
            ? { status: 'healthy', latencyMs: agents.latencyMs, detail: 'Trained agent registry responded.' }
            : { status: 'degraded', latencyMs: agents.latencyMs, detail: agents.error ?? 'No response from the agent registry.' }
        : { status: 'not_configured', detail: 'Depends on the AI service, which is not answering.' };

    const services: Record<string, ServiceReport> = {
        backend: { status: 'healthy', detail: 'The Next.js API is serving this request.' },
        database,
        ml: mlReport,
        rag: ragReport,
        agents: agentsReport,
        llm,
        blockchain,
        ipfs,
    };

    const names = Object.keys(services) as (keyof typeof services)[];
    const healthy = names.filter((n) => services[n].status === 'healthy');
    const notConfigured = names.filter((n) => services[n].status === 'not_configured');
    const degraded = names.filter((n) => services[n].status === 'degraded');
    const unavailable = names.filter((n) => services[n].status === 'unavailable');

    // The backend is up if it can answer at all, even when optional
    // capabilities are missing — but the response says exactly which.
    const status =
        database.status === 'healthy'
            ? unavailable.length === 0 && degraded.length === 0
                ? 'healthy'
                : notConfigured.length > 0
                  ? 'operational_with_unconfigured_services'
                  : 'degraded'
            : 'unhealthy';

    return successResponse({
        status,
        summary: {
            healthy: healthy.length,
            not_configured: notConfigured.length,
            degraded: degraded.length,
            unavailable: unavailable.length,
        },
        services,
        // Names only, never values.
        llmProvider,
        version: '2.0.0',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV,
    });
}
