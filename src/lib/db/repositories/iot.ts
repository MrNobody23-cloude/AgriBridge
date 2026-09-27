import { connectToDatabase } from '../connection';
import {
    TemperatureLogModel,
    type TemperatureLogDoc,
} from '../models';

// ─── TEMPERATURE / SENSOR READINGS ────────────────────────────────────────────

export interface CreateTemperatureLogInput {
    shipmentId?: string | null;
    batchId?: string | null;
    sensorId?: string | null;
    temperature: number;
    humidity?: number | null;
    location: string;
    latitude?: number | null;
    longitude?: number | null;
    batteryLevel?: number | null;
    isSimulated?: boolean;
    timestamp?: Date;
}

export async function createTemperatureLog(
    input: CreateTemperatureLogInput
): Promise<TemperatureLogDoc> {
    await connectToDatabase();
    const reading = await TemperatureLogModel.create({
        ...input,
        shipmentId: input.shipmentId ?? null,
        batchId: input.batchId ?? null,
        sensorId: input.sensorId ?? null,
        humidity: input.humidity ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        batteryLevel: input.batteryLevel ?? null,
        isSimulated: input.isSimulated ?? false,
        timestamp: input.timestamp ?? new Date(),
    });
    return reading.toObject() as TemperatureLogDoc;
}

/**
 * Insert many readings at once.
 *
 * `prisma.temperatureLog.createMany` had no Mongo equivalent; `insertMany` is
 * it. **The return shape differs**, and it matters: Prisma's `createMany`
 * resolved to `{ count }`, while `insertMany` resolves to an array of the
 * inserted documents. The IoT simulator returned `created.count` straight to
 * the client, so this function returns a plain number deliberately — taking
 * `.length` at the call site would have produced a working-looking response
 * whose `readingsCreated` was `undefined`.
 *
 * `ordered: false` so one malformed reading does not discard the rest of a
 * simulated burst.
 */
export async function createManyTemperatureLogs(
    inputs: CreateTemperatureLogInput[]
): Promise<number> {
    await connectToDatabase();
    if (inputs.length === 0) return 0;
    const inserted = await TemperatureLogModel.insertMany(
        inputs.map((i) => ({
            ...i,
            shipmentId: i.shipmentId ?? null,
            batchId: i.batchId ?? null,
            sensorId: i.sensorId ?? null,
            humidity: i.humidity ?? null,
            latitude: i.latitude ?? null,
            longitude: i.longitude ?? null,
            batteryLevel: i.batteryLevel ?? null,
            isSimulated: i.isSimulated ?? false,
            timestamp: i.timestamp ?? new Date(),
        })),
        { ordered: false }
    );
    return inserted.length;
}

export interface ListTemperatureLogsOptions {
    batchId?: string;
    shipmentId?: string;
    sensorId?: string;
    /**
     * Omit for every matching reading. Prisma's `findMany` had no default cap
     * and the cold-chain history route relied on that — it plots the whole
     * trace, and a silently truncated one would be a wrong chart rather than a
     * visibly short one.
     */
    limit?: number;
    /** Newest first unless the caller asks otherwise. */
    order?: 'asc' | 'desc';
}

export async function listTemperatureLogs(
    options: ListTemperatureLogsOptions = {}
): Promise<TemperatureLogDoc[]> {
    await connectToDatabase();
    const { batchId, shipmentId, sensorId, limit, order = 'desc' } = options;

    const where: Record<string, unknown> = {};
    if (batchId) where.batchId = batchId;
    if (shipmentId) where.shipmentId = shipmentId;
    if (sensorId) where.sensorId = sensorId;

    let query = TemperatureLogModel.find(where).sort({ timestamp: order === 'asc' ? 1 : -1 });
    if (limit !== undefined) query = query.limit(limit);

    return query.lean<TemperatureLogDoc[]>().exec();
}
