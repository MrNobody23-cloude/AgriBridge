import { connectToDatabase } from '../connection';
import {
    AiAgentLogModel,
    TrustScoreModel,
    type AiAgentLogDoc,
    type TrustScoreDoc,
} from '../models';

// ─── AI AGENT LOG ─────────────────────────────────────────────────────────────

export interface CreateAgentLogInput {
    agentName: string;
    agentType?: string;
    task: string;
    input: string;
    output: string;
    toolsUsed?: string | null;
    evidence?: string | null;
    sources?: string | null;
    confidence?: number;
    status?: string;
    durationMs?: number | null;
}

export async function createAgentLog(input: CreateAgentLogInput): Promise<AiAgentLogDoc> {
    await connectToDatabase();
    const log = await AiAgentLogModel.create({
        ...input,
        agentType: input.agentType ?? 'unknown',
        toolsUsed: input.toolsUsed ?? null,
        evidence: input.evidence ?? null,
        sources: input.sources ?? null,
        confidence: input.confidence ?? 0.0,
        status: input.status ?? 'COMPLETED',
        durationMs: input.durationMs ?? null,
    });
    return log.toObject() as AiAgentLogDoc;
}

export async function listAgentLogs(limit = 50): Promise<AiAgentLogDoc[]> {
    await connectToDatabase();
    return AiAgentLogModel.find({})
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean<AiAgentLogDoc[]>()
        .exec();
}

// ─── TRUST SCORE ──────────────────────────────────────────────────────────────

export type UpsertTrustScoreInput = Omit<TrustScoreDoc, '_id' | 'createdAt' | 'updatedAt'>;

/**
 * Write the trust score for a batch, creating it if absent.
 *
 * Replaces `prisma.trustScore.upsert({ where: { batchId } })`. The native form
 * is `updateOne` with `$set` + `$setOnInsert` and `upsert: true`, backed by the
 * unique index on `batchId` — which is what made the Prisma `upsert` legal in
 * the first place, and which is declared on the schema.
 *
 * The split matters: fields present in both go in `$set`; fields that should
 * only be written when the row is created go in `$setOnInsert`, or they would
 * overwrite the existing row's value on every rescore.
 */
export async function upsertTrustScore(input: UpsertTrustScoreInput): Promise<TrustScoreDoc> {
    await connectToDatabase();
    const { batchId, ...rest } = input;

    await TrustScoreModel.updateOne(
        { batchId },
        {
            $set: rest,
            $setOnInsert: { batchId },
        },
        { upsert: true }
    ).exec();

    const saved = await TrustScoreModel.findOne({ batchId }).lean<TrustScoreDoc>().exec();
    if (!saved) {
        // Unreachable if the upsert above succeeded, but returning null here
        // would push the failure into the caller as a null dereference.
        throw new Error(`Trust score upsert for batch ${batchId} produced no document.`);
    }
    return saved;
}

export async function findTrustScoreByBatchId(batchId: string): Promise<TrustScoreDoc | null> {
    await connectToDatabase();
    return TrustScoreModel.findOne({ batchId }).lean<TrustScoreDoc>().exec();
}
