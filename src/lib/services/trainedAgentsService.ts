import { loadBatchWithRelations } from '@/lib/db/repositories/batches';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

/**
 * Bridge to the six trained scikit-learn agents in `ai-service/agents/`.
 *
 * Division of labour: this file owns the database, the Python service owns
 * inference. The Python service has no database connection, so every value an
 * agent sees is read here and passed explicitly. Two consequences worth
 * stating:
 *
 *  - An agent cannot read a batch the caller was not authorised to read. There
 *    is no query to authorise, because the query happened here, under the
 *    caller's session.
 *  - A field AgriBridge does not store is absent, not zero. The agents treat
 *    absence as "this input does not exist" and decline, which is why nothing
 *    here substitutes a default for a measurement that was never taken.
 */

export interface AgentBatchContext {
    batchId: string;
    productName?: string;
    quantityKg?: number;
    harvestDate?: string;
    destinationMarket?: string;
    pesticideResidueLevel?: number;
    certificates: Array<Record<string, unknown>>;
    shipment?: Record<string, unknown>;
    events: Array<Record<string, unknown>>;
    temperatureLogs: Array<Record<string, unknown>>;
    blockchainStatus?: string;
    blockchainVerified?: boolean;
    remainingTransportTime?: number;
}

/** Agent status values, mirroring ai-service/agents/base.py. */
export type AgentStatus = 'OK' | 'NOT_APPLICABLE' | 'UNAVAILABLE';

export interface AgentResult<T = Record<string, unknown>> {
    agent: string;
    label?: string;
    status: AgentStatus;
    reason?: string;
    missingFeatures?: string[];
    prediction: T | null;
    modelLoaded?: boolean;
    [key: string]: unknown;
}

/**
 * Read everything the six agents may see about a batch.
 *
 * Returns null when the batch does not exist, so callers can 404 rather than
 * scoring a batch of empty objects.
 *
 * The query itself moved into the repository as
 * `loadBatchWithRelations(idOrCode, { temperatureLogLimit: 100, shipmentLimit: 1 })`.
 * The ordering and limits that used to be spelled out in the `FULL_BATCH_INCLUDE`
 * constant are now part of the repository call, which matters: the previous
 * code cast the result to a derived Prisma type and the compiler could not
 * check that the type and the query agreed. `loadBatchWithRelations` returns
 * its own hand-written interface, so a mismatch in ordering or arity is a
 * compile error rather than a wrong answer at runtime.
 */
export async function buildAgentContext(
    batchIdOrCode: string,
    options: { pesticideResidueLevel?: number; remainingTransportTime?: number } = {}
): Promise<AgentBatchContext | null> {
    const batch = await loadBatchWithRelations(batchIdOrCode, {
        temperatureLogLimit: 100,
        shipmentLimit: 1,
        eventOrder: 'asc',
    });

    if (!batch) return null;

    const shipment = batch.shipments[0];
    const chain = await verifyChain(batch);

    return {
        batchId: batch.batchCode,

        productName: batch.product.name,
        quantityKg: batch.quantity ?? undefined,
        harvestDate: batch.harvestDate?.toISOString(),

        destinationMarket: destinationMarket(batch.destinationCountry ?? shipment?.destinationCountry),
        // Only present when the caller measured one. AgriBridge has no residue
        // field, so this stays undefined and the compliance agent says the MRL
        // decision rests on certification alone.
        pesticideResidueLevel: options.pesticideResidueLevel,

        certificates: batch.certificates.map((c) => ({
            certificateType: c.certificateType,
            issuer: c.issuer,
            issueDate: c.issueDate.toISOString(),
            expiryDate: c.expiryDate.toISOString(),
            verificationStatus: c.verificationStatus,
            fileHash: c.fileHash,
        })),

        shipment: shipment
            ? {
                shipmentCode: shipment.shipmentCode,
                status: shipment.status,
                quantity: shipment.quantity,
                destinationCountry: shipment.destinationCountry,
                estimatedArrival: shipment.estimatedArrival?.toISOString(),
                createdAt: shipment.createdAt.toISOString(),
                // A temperature breach recorded against the shipment is a real,
                // already-observed signal — unlike `distanceKm`, which nothing
                // in AgriBridge measures.
                riskScore: shipment.riskScore,
                complianceCheckCount: shipment.complianceChecks.length,
            }
            : undefined,

        events: batch.events.map((e) => ({
            eventType: e.eventType,
            actorRole: e.actorRole,
            location: e.location,
            timestamp: e.timestamp.toISOString(),
            blockchainTransactionHash: e.blockchainTransactionHash,
        })),

        temperatureLogs: batch.temperatureLogs.map((t) => ({
            temperature: t.temperature,
            humidity: t.humidity,
            location: t.location,
            isSimulated: t.isSimulated,
            timestamp: t.timestamp.toISOString(),
        })),

        blockchainStatus: chain.status,
        blockchainVerified: chain.verified,
        remainingTransportTime: options.remainingTransportTime,
    };
}

async function verifyChain(batch: {
    batchCode: string;
    blockchainHash: string;
    blockchainMode: string;
}): Promise<{ verified: boolean; status: string }> {
    try {
        const { verifyBatchOnChain } = await import('@/lib/blockchain');
        return await verifyBatchOnChain(batch.batchCode, batch.blockchainHash);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[trainedAgents] chain verification failed: ${message}`);
        return { verified: false, status: `unverified (${message})` };
    }
}

/**
 * Map a destination country onto one of the three markets the compliance model
 * was trained on. Anything unrecognised falls through to Domestic, which is the
 * only market whose thresholds apply to a batch with no export destination.
 */
function destinationMarket(destinationCountry?: string | null): string {
    if (!destinationCountry) return 'Domestic';
    const d = destinationCountry.toLowerCase();
    const eu = [
        'germany', 'france', 'spain', 'italy', 'netherlands', 'belgium', 'ireland',
        'poland', 'portugal', 'austria', 'sweden', 'denmark', 'finland', 'greece',
        'united kingdom', 'uk', 'switzerland', 'norway',
    ];
    const gulf = [
        'uae', 'dubai', 'saudi', 'saudi arabia', 'qatar', 'kuwait', 'bahrain',
        'oman', 'jebel ali',
    ];
    if (eu.some((c) => d.includes(c))) return 'EU';
    if (gulf.some((c) => d.includes(c))) return 'Gulf';
    return 'Domestic';
}

/**
 * POST to one of the six agent endpoints.
 *
 * A transport failure is reported, not swallowed: an unreachable AI service
 * returns UNAVAILABLE with the reason, which is a different thing from an agent
 * that ran and found nothing.
 */
export async function callAgent(
    agent: 'traceability' | 'quality' | 'spoilage' | 'fraud' | 'compliance' | 'trust',
    context: AgentBatchContext
): Promise<AgentResult> {
    try {
        const res = await fetch(`${AI_SERVICE_URL}/api/agents/v2/${agent}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(context),
            signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            return {
                agent,
                status: 'UNAVAILABLE',
                reason: `AI service returned ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
                prediction: null,
                modelLoaded: false,
            };
        }
        return (await res.json()) as AgentResult;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[trainedAgents] ${agent} unreachable: ${message}`);
        return {
            agent,
            status: 'UNAVAILABLE',
            reason: `AI service unreachable at ${AI_SERVICE_URL} — ${message}`,
            prediction: null,
            modelLoaded: false,
        };
    }
}

/** Run the five upstream agents plus the Consumer Trust meta-agent. */
export async function analyzeBatch(
    context: AgentBatchContext
): Promise<{
    trust: AgentResult;
    upstream: Record<string, AgentResult>;
}> {
    try {
        const res = await fetch(`${AI_SERVICE_URL}/api/agents/v2/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ context }),
            signal: AbortSignal.timeout(60000),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            const reason = `AI service returned ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`;
            return { trust: offline('trust', reason), upstream: {} };
        }
        const data = (await res.json()) as { trust: AgentResult; upstream: Record<string, AgentResult> };
        return data;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const reason = `AI service unreachable at ${AI_SERVICE_URL} — ${message}`;
        return {
            trust: offline('trust', reason),
            upstream: Object.fromEntries(
                ['traceability', 'quality', 'spoilage', 'fraud', 'compliance'].map((a) => [a, offline(a, reason)])
            ),
        };
    }
}

function offline(agent: string, reason: string): AgentResult {
    return { agent, status: 'UNAVAILABLE', reason, prediction: null, modelLoaded: false };
}

/**
 * Real per-agent status from the Python service, for the Agents page.
 *
 * Returns null when the service cannot be reached so the page can say so,
 * rather than rendering six cards that look operational.
 */
export async function fetchAgentRegistry(): Promise<{
    agents: Array<Record<string, unknown>>;
    totalAgents: number;
    availableAgents: number;
    registryLoaded: boolean;
    note?: string;
    error?: string;
} | null> {
    try {
        const res = await fetch(`${AI_SERVICE_URL}/api/agents/v2/registry`, {
            signal: AbortSignal.timeout(8000),
            cache: 'no-store',
        });
        if (!res.ok) return null;
        return (await res.json()) as Awaited<ReturnType<typeof fetchAgentRegistry>>;
    } catch {
        return null;
    }
}
