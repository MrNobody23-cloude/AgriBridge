import { connectToDatabase } from '../connection';
import {
    AiAgentLogModel,
    AuditLogModel,
    BatchModel,
    CertificateModel,
    ComplianceCheckModel,
    CounterModel,
    FarmerProfileModel,
    FraudAlertModel,
    IpfsDocumentModel,
    MlPredictionModel,
    NotificationModel,
    ProductModel,
    ShipmentModel,
    SupplyChainEventModel,
    TemperatureLogModel,
    TrustScoreModel,
    UserModel,
    type AiAgentLogDoc,
    type AuditLogDoc,
    type BatchDoc,
    type CertificateDoc,
    type ComplianceCheckDoc,
    type FarmerProfileDoc,
    type FraudAlertDoc,
    type IpfsDocumentDoc,
    type MlPredictionDoc,
    type ProductDoc,
    type ShipmentDoc,
    type SupplyChainEventDoc,
    type TemperatureLogDoc,
    type TrustScoreDoc,
    type UserDoc,
} from '../models';

/**
 * Case-insensitive string matching.
 *
 * Prisma's `{ contains, mode: 'insensitive' }` became a `$regex` with the `i`
 * option, so `Wheat`, `wheat` and `WHEAT` all match the same way they did
 * under Postgres.
 *
 * The first attempt here was a Mongo collation (`{ locale: 'en', strength: 2 }`).
 * It was dropped for a concrete reason worth recording, because it is not
 * obvious: **a collation cannot be combined with `$regex` in the same query**,
 * and the unique-index lookup in `findProductByNameInsensitive` needs exactly
 * that. Anchoring the pattern to `^…$` with `$options: 'i'` matches identically
 * with no second mechanism to keep consistent.
 */

/** Match a string field case-insensitively as a substring. */
function containsInsensitive(value: string): Record<string, unknown> {
    return { $regex: escapeRegex(value), $options: 'i' };
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── BATCH ────────────────────────────────────────────────────────────────────

/** A batch row plus the `_count` of its temperature logs, as the list view needs. */
export interface BatchWithTempCount extends BatchDoc {
    _count: { temperatureLogs: number };
}

export interface ListBatchesOptions {
    farmerId?: string;
    status?: string;
    /** Free-text search across batchCode, location and product name. */
    query?: string;
    limit: number;
    offset: number;
}

export interface ListBatchesResult {
    batches: BatchWithTempCount[];
    total: number;
}

/**
 * List batches with their product, farmer, certificates, events, open fraud
 * alerts, trust score and temperature-log count.
 *
 * Three Prisma idioms needed replacing:
 *
 *  1. `where.OR: [{ product: { name: … } }]` — a filter on a *relation*. Mongo
 *     has no joins in a query, so the product ids matching the term are
 *     resolved first and the parent filtered by `productId: { $in: [...] }`.
 *     The corpora here are small (a handful of products), so this is one extra
 *     round trip and no `$lookup` pipeline to read. If the term matches no
 *     product, the `productId` branch is dropped rather than left as an empty
 *     `$in`, which would match nothing and silently empty the whole OR.
 *
 *  2. `fraudAlerts: { where: { status: { not: 'RESOLVED' } } }` — a filter
 *     *inside* an include. Applied to the child query directly.
 *
 *  3. `_count: { select: { temperatureLogs: true } }` — one count per row. A
 *     `countDocuments` per batch inside a 50-row page would be 50 round trips,
 *     so the counts come from a single grouped aggregation over the ids of the
 *     page that was just fetched, not over the whole collection.
 */
export async function listBatches(options: ListBatchesOptions): Promise<ListBatchesResult> {
    await connectToDatabase();
    const { farmerId, status, query, limit, offset } = options;

    const where: Record<string, unknown> = {};
    if (farmerId) where.farmerId = farmerId;
    if (status) where.status = status;

    if (query) {
        const or: Record<string, unknown>[] = [
            { batchCode: containsInsensitive(query) },
            { location: containsInsensitive(query) },
        ];

        // Resolve the matching products first, then filter batches by productId.
        // Collation cannot be combined with $regex, so the product query uses
        // an explicit case-insensitive regex instead.
        const products = await ProductModel.find({ name: containsInsensitive(query) })
            .select({ _id: 1 })
            .lean<Array<{ _id: string }>>()
            .exec();
        if (products.length > 0) {
            or.push({ productId: { $in: products.map((p) => p._id) } });
        }

        where.$or = or;
    }

    const [rows, total] = await Promise.all([
        BatchModel.find(where)
            .sort({ createdAt: -1 })
            .skip(offset)
            .limit(limit)
            .lean<BatchDoc[]>()
            .exec(),
        BatchModel.countDocuments(where).exec(),
    ]);

    const batchIds = rows.map((b) => b._id);
    if (batchIds.length === 0) {
        return { batches: [], total };
    }

    const farmerIds = [...new Set(rows.map((b) => b.farmerId))];

    const [products, farmers, profiles, certificates, events, fraudAlerts, trustScores, tempCounts] =
        await Promise.all([
            // Product ids are the ones the page actually references, so this is
            // bounded by the page size rather than the product table.
            ProductModel.find({ _id: { $in: [...new Set(rows.map((b) => b.productId))] } })
                .lean<ProductDoc[]>()
                .exec(),
            UserModel.find({ _id: { $in: farmerIds } })
                .select({ _id: 1, name: 1, email: 1 })
                .lean<Array<Pick<UserDoc, '_id' | 'name' | 'email'>>>()
                .exec(),
            FarmerProfileModel.find({ userId: { $in: farmerIds } })
                .lean<FarmerProfileDoc[]>()
                .exec(),
            CertificateModel.find({ batchId: { $in: batchIds } })
                .select({
                    _id: 1, batchId: 1, certificateType: 1, verificationStatus: 1, expiryDate: 1,
                })
                .lean<CertificateDoc[]>()
                .exec(),
            SupplyChainEventModel.find({ batchId: { $in: batchIds } })
                .sort({ timestamp: 1 })
                .lean<SupplyChainEventDoc[]>()
                .exec(),
            // The Prisma `where` sat inside the include: only unresolved alerts.
            FraudAlertModel.find({ batchId: { $in: batchIds }, status: { $ne: 'RESOLVED' } })
                .select({ _id: 1, batchId: 1, fraudType: 1, severity: 1, status: 1 })
                .lean<Array<Pick<FraudAlertDoc, '_id' | 'batchId' | 'fraudType' | 'severity' | 'status'>>>()
                .exec(),
            TrustScoreModel.find({ batchId: { $in: batchIds } })
                .lean<TrustScoreDoc[]>()
                .exec(),
            // One grouped aggregation for the whole page, rather than a
            // countDocuments per batch.
            TemperatureLogModel.aggregate<{ _id: string; n: number }>([
                { $match: { batchId: { $in: batchIds } } },
                { $group: { _id: '$batchId', n: { $sum: 1 } } },
            ]).exec(),
        ]);

    const productById = new Map(products.map((p) => [p._id, p]));
    const farmerById = new Map(farmers.map((f) => [f._id, f]));
    const profileByUserId = new Map(profiles.map((p) => [p.userId, p]));
    const tempCountByBatch = new Map(tempCounts.map((t) => [t._id, t.n]));

    const groupBy = <T extends { batchId?: string | null }>(rows: T[]): Map<string, T[]> => {
        const map = new Map<string, T[]>();
        for (const row of rows) {
            if (!row.batchId) continue;
            const list = map.get(row.batchId);
            if (list) list.push(row);
            else map.set(row.batchId, [row]);
        }
        return map;
    };

    const certsByBatch = groupBy(certificates);
    const eventsByBatch = groupBy(events);
    const fraudByBatch = groupBy(fraudAlerts);
    const trustByBatch = new Map(trustScores.map((t) => [t.batchId, t]));

    const batches: BatchWithTempCount[] = rows.map((batch) => {
        const farmer = farmerById.get(batch.farmerId);
        return {
            ...batch,
            product: productById.get(batch.productId) ?? null,
            farmer: farmer
                ? {
                      id: farmer._id,
                      name: farmer.name,
                      email: farmer.email,
                      farmerProfile: profileByUserId.get(farmer._id) ?? null,
                  }
                : null,
            certificates: certsByBatch.get(batch._id) ?? [],
            events: eventsByBatch.get(batch._id) ?? [],
            fraudAlerts: fraudByBatch.get(batch._id) ?? [],
            trustScoreDetails: trustByBatch.get(batch._id) ?? null,
            _count: { temperatureLogs: tempCountByBatch.get(batch._id) ?? 0 },
        };
    });

    return { batches, total };
}

// ─── BATCH LOOKUP ─────────────────────────────────────────────────────────────

/**
 * The one batch-plus-relations shape the AI agents and the trust score read.
 *
 * This replaces `trainedAgentsService.ts`'s `BatchWithRelations`, which was
 * derived from the generated Prisma client type
 * (`Awaited<ReturnType<typeof prisma.batch.findFirst<{ include: … }>>>`) and
 * therefore disappeared with Prisma. Written out by hand instead, because
 * a type that is inferred from a query builder is a type that cannot be
 * checked against anything.
 *
 * Two details are load-bearing and were previously carried by Prisma's types:
 *  - `shipments` is an **array** even when one shipment is requested. The
 *    query takes the most recent one, and `batch.shipments[0]` is read
 *    directly; a nullable single object would make that an unchecked index.
 *  - `trustScoreDetails` is **nullable**. It is a 1:1 that does not exist
 *    until a score has been computed, and `readStoredTrustScore` branches on
 *    its absence.
 */
export interface BatchWithRelations extends BatchDoc {
    product: ProductDoc | null;
    farmer: BatchFarmer | null;
    certificates: CertificateDoc[];
    events: SupplyChainEventDoc[];
    temperatureLogs: TemperatureLogDoc[];
    shipments: Array<ShipmentDoc & { complianceChecks: ComplianceCheckDoc[] }>;
    fraudAlerts: FraudAlertDoc[];
    trustScoreDetails: TrustScoreDoc | null;
}

export interface LoadBatchOptions {
    /**
     * How many sensor readings to load, most recent first.
     * `0` or omitted means *all* of them, not "none".
     */
    temperatureLogLimit?: number;
    /** How many shipments to load, most recent first. `0` or omitted means all. */
    shipmentLimit?: number;
    eventOrder?: 'asc' | 'desc';
    /**
     * Exclude `RESOLVED` fraud alerts. The consumer chat asks "is anything
     * wrong with this batch", and a resolved alert is the answer *no* — but the
     * count it renders is read straight off this array, so filtering has to
     * happen here rather than after the fact.
     */
    excludeResolvedFraudAlerts?: boolean;
}

/** Resolve a batch by id *or* `batchCode`. */
async function findBatchRow(
    idOrCode: string
): Promise<BatchDoc | null> {
    await connectToDatabase();
    return BatchModel.findOne({
        $or: [{ _id: idOrCode }, { batchCode: idOrCode }],
    })
        .lean<BatchDoc>()
        .exec();
}

export async function loadBatchWithRelations(
    idOrCode: string,
    options: LoadBatchOptions = {}
): Promise<BatchWithRelations | null> {
    const {
        temperatureLogLimit = 100,
        shipmentLimit = 1,
        eventOrder = 'asc',
        excludeResolvedFraudAlerts = false,
    } = options;

    const batch = await findBatchRow(idOrCode);
    if (!batch) return null;

    // A limit of 0 means "every row" in Mongo's query language but reads as
    // "no rows" to anyone reading this, so it is resolved here rather than
    // passed to `.limit()`.
    const tempQuery = TemperatureLogModel.find({ batchId: batch._id }).sort({ timestamp: -1 });
    if (temperatureLogLimit > 0) tempQuery.limit(temperatureLogLimit);
    const shipmentQuery = ShipmentModel.find({ batchId: batch._id }).sort({ createdAt: -1 });
    if (shipmentLimit > 0) shipmentQuery.limit(shipmentLimit);
    const fraudQuery = FraudAlertModel.find(
        excludeResolvedFraudAlerts
            ? { batchId: batch._id, status: { $ne: 'RESOLVED' } }
            : { batchId: batch._id }
    );

    const [product, farmer, certificates, events, temperatureLogs, shipments, fraudAlerts, trustScoreDetails] =
        await Promise.all([
            ProductModel.findById(batch.productId).lean<ProductDoc>().exec(),
            UserModel.findById(batch.farmerId)
                .select({ _id: 1, name: 1, email: 1 })
                .lean<Pick<UserDoc, '_id' | 'name' | 'email'>>()
                .exec(),
            CertificateModel.find({ batchId: batch._id })
                .lean<CertificateDoc[]>()
                .exec(),
            SupplyChainEventModel.find({ batchId: batch._id })
                .sort({ timestamp: eventOrder === 'asc' ? 1 : -1 })
                .lean<SupplyChainEventDoc[]>()
                .exec(),
            tempQuery.lean<TemperatureLogDoc[]>().exec(),
            shipmentQuery.lean<ShipmentDoc[]>().exec(),
            fraudQuery.lean<FraudAlertDoc[]>().exec(),
            TrustScoreModel.findOne({ batchId: batch._id }).lean<TrustScoreDoc>().exec(),
        ]);

    const [farmerProfile, complianceChecks] = await Promise.all([
        farmer
            ? FarmerProfileModel.findOne({ userId: farmer._id }).lean<FarmerProfileDoc>().exec()
            : null,
        shipments.length > 0
            ? ComplianceCheckModel.find({ shipmentId: { $in: shipments.map((s) => s._id) } })
                  .lean<ComplianceCheckDoc[]>()
                  .exec()
            : Promise.resolve([] as ComplianceCheckDoc[]),
    ]);

    return {
        ...batch,
        product,
        farmer: farmer ? { ...farmer, farmerProfile } : null,
        certificates,
        events,
        temperatureLogs,
        shipments: shipments.map((s) => ({
            ...s,
            complianceChecks: complianceChecks.filter((c) => c.shipmentId === s._id),
        })),
        fraudAlerts,
        trustScoreDetails,
    };
}

/** Just the batch, no relations — for the fraud scan's existence check. */
export async function findBatchByIdOrCode(idOrCode: string): Promise<BatchDoc | null> {
    return findBatchRow(idOrCode);
}

// ─── CONSUMER-FACING BATCH DETAIL ─────────────────────────────────────────────

/** An event with the acting user's id, name and role resolved. */
export interface EventWithActor extends SupplyChainEventDoc {
    actor: Pick<UserDoc, '_id' | 'name' | 'role'> | null;
}

/**
 * The full batch record a consumer sees when they scan the QR code.
 *
 * Wider than `BatchWithRelations` in three ways, all driven by what the
 * verification page shows: events carry their actor, the ten most recent ML
 * predictions are attached, and IPFS documents are listed.
 *
 * On `ipfsDocuments`: the old include read `ipfsDocuments: true`, but nothing
 * in the codebase has ever written to that table — the certificate upload path
 * records a hash on the `Certificate` row and does not insert an `IpfsDocument`.
 * So this list is empty in practice. It is queried rather than dropped because
 * it is part of the public response shape, and an empty array is an honest
 * answer; removing the key would change the response contract for no gain.
 */
export interface BatchDetail extends Omit<BatchWithRelations, 'events' | 'mlPredictions' | 'ipfsDocuments'> {
    events: EventWithActor[];
    mlPredictions: MlPredictionDoc[];
    ipfsDocuments: IpfsDocumentDoc[];
    shipments: Array<
        ShipmentDoc & {
            complianceChecks: ComplianceCheckDoc[];
            exporter: Pick<UserDoc, '_id' | 'name' | 'email'> | null;
        }
    >;
}

export async function getBatchDetail(idOrCode: string): Promise<BatchDetail | null> {
    await connectToDatabase();
    const batch = await findBatchRow(idOrCode);
    if (!batch) return null;

    const [product, farmer, certificates, events, temperatureLogs, shipments, fraudAlerts, trustScoreDetails, mlPredictions, ipfsDocuments] =
        await Promise.all([
            ProductModel.findById(batch.productId).lean<ProductDoc>().exec(),
            UserModel.findById(batch.farmerId)
                .select({ _id: 1, name: 1, email: 1 })
                .lean<Pick<UserDoc, '_id' | 'name' | 'email'>>()
                .exec(),
            CertificateModel.find({ batchId: batch._id }).lean<CertificateDoc[]>().exec(),
            SupplyChainEventModel.find({ batchId: batch._id })
                .sort({ timestamp: 1 })
                .lean<SupplyChainEventDoc[]>()
                .exec(),
            TemperatureLogModel.find({ batchId: batch._id })
                .sort({ timestamp: 1 })
                .limit(200)
                .lean<TemperatureLogDoc[]>()
                .exec(),
            ShipmentModel.find({ batchId: batch._id })
                .sort({ createdAt: -1 })
                .lean<ShipmentDoc[]>()
                .exec(),
            FraudAlertModel.find({ batchId: batch._id }).lean<FraudAlertDoc[]>().exec(),
            TrustScoreModel.findOne({ batchId: batch._id }).lean<TrustScoreDoc>().exec(),
            MlPredictionModel.find({ batchId: batch._id })
                .sort({ createdAt: -1 })
                .limit(10)
                .lean<MlPredictionDoc[]>()
                .exec(),
            IpfsDocumentModel.find({ batchId: batch._id }).lean<IpfsDocumentDoc[]>().exec(),
        ]);

    const [farmerProfile, actorIds, complianceChecks, exporters] = await Promise.all([
        farmer
            ? FarmerProfileModel.findOne({ userId: farmer._id }).lean<FarmerProfileDoc>().exec()
            : Promise.resolve(null),
        events.some((e) => e.actorId)
            ? UserModel.find({ _id: { $in: [...new Set(events.map((e) => e.actorId).filter(Boolean))] } })
                  .select({ _id: 1, name: 1, role: 1 })
                  .lean<Array<Pick<UserDoc, '_id' | 'name' | 'role'>>>()
                  .exec()
            : Promise.resolve([] as Array<Pick<UserDoc, '_id' | 'name' | 'role'>>),
        shipments.length > 0
            ? ComplianceCheckModel.find({ shipmentId: { $in: shipments.map((s) => s._id) } })
                  .lean<ComplianceCheckDoc[]>()
                  .exec()
            : Promise.resolve([] as ComplianceCheckDoc[]),
        shipments.length > 0
            ? UserModel.find({ _id: { $in: [...new Set(shipments.map((s) => s.exporterId))] } })
                  .select({ _id: 1, name: 1, email: 1 })
                  .lean<Array<Pick<UserDoc, '_id' | 'name' | 'email'>>>()
                  .exec()
            : Promise.resolve([] as Array<Pick<UserDoc, '_id' | 'name' | 'email'>>),
    ]);

    const actorById = new Map(actorIds.map((a) => [a._id, a]));
    const exporterById = new Map(exporters.map((e) => [e._id, e]));

    return {
        ...batch,
        product,
        farmer: farmer ? { ...farmer, farmerProfile } : null,
        certificates,
        events: events.map((e) => ({
            ...e,
            actor: (e.actorId && actorById.get(e.actorId)) || null,
        })),
        temperatureLogs,
        shipments: shipments.map((s) => ({
            ...s,
            complianceChecks: complianceChecks.filter((c) => c.shipmentId === s._id),
            exporter: exporterById.get(s.exporterId) ?? null,
        })),
        fraudAlerts,
        trustScoreDetails,
        mlPredictions,
        ipfsDocuments,
    };
}

/** Add a supply-chain event to a batch. */
export interface CreateSupplyChainEventInput {
    batchId: string;
    eventType: string;
    actorId?: string | null;
    actorRole?: string | null;
    location: string;
    metadata?: string | null;
    blockchainTransactionHash?: string | null;
    timestamp?: Date;
}

export async function createSupplyChainEvent(
    input: CreateSupplyChainEventInput
): Promise<SupplyChainEventDoc> {
    await connectToDatabase();
    const event = await SupplyChainEventModel.create({
        ...input,
        actorId: input.actorId ?? null,
        actorRole: input.actorRole ?? null,
        metadata: input.metadata ?? null,
        blockchainTransactionHash: input.blockchainTransactionHash ?? null,
        timestamp: input.timestamp ?? new Date(),
    });
    return event.toObject() as SupplyChainEventDoc;
}

export async function createIpfsDocument(input: Omit<IpfsDocumentDoc, '_id' | 'uploadedAt'>): Promise<IpfsDocumentDoc> {
    await connectToDatabase();
    const document = await IpfsDocumentModel.findOneAndUpdate(
        { ipfsCid: input.ipfsCid },
        { $setOnInsert: { ...input, uploadedAt: new Date() } },
        { new: true, upsert: true },
    ).lean<IpfsDocumentDoc>().exec();
    return document as IpfsDocumentDoc;
}

/** Record a cached ML prediction against a batch. */
export interface CreateMlPredictionInput {
    batchId: string;
    modelType: string;
    modelName: string;
    modelVersion?: string;
    result: string;
    confidence: number;
    featuresJson?: string | null;
    shapJson?: string | null;
    inputJson?: string | null;
}

export async function createMlPrediction(input: CreateMlPredictionInput): Promise<MlPredictionDoc> {
    await connectToDatabase();
    const prediction = await MlPredictionModel.create({
        ...input,
        modelVersion: input.modelVersion ?? '1.0.0',
        featuresJson: input.featuresJson ?? null,
        shapJson: input.shapJson ?? null,
        inputJson: input.inputJson ?? null,
    });
    return prediction.toObject() as MlPredictionDoc;
}

export async function findBatchById(id: string): Promise<BatchDoc | null> {
    await connectToDatabase();
    return BatchModel.findById(id).lean<BatchDoc>().exec();
}

export interface CreateBatchInput {
    batchCode: string;
    farmerId: string;
    productId: string;
    variety?: string | null;
    quantity: number;
    unit: string;
    sowingDate?: Date | null;
    harvestDate: Date;
    actualHarvestDate?: Date | null;
    harvestStage?: string;
    location: string;
    destinationCountry?: string | null;
    status: string;
    blockchainHash: string;
    blockchainTransactionHash?: string | null;
    blockchainMode: string;
    trustScore?: number;
}

/**
 * A farmer as it appears beside a batch: never the full `UserDoc`.
 *
 * The projection already excludes the bcrypt hash, so nothing further is
 * stripped. Prisma's unfiltered `farmer: true` include would have carried it.
 */
type BatchFarmer = Pick<UserDoc, '_id' | 'name' | 'email'> & {
    farmerProfile: FarmerProfileDoc | null;
};

/** Create a batch and return it with its product and farmer, as the POST route needs. */
export async function createBatch(
    input: CreateBatchInput
): Promise<BatchDoc & { product: ProductDoc | null; farmer: BatchFarmer | null }> {
    await connectToDatabase();
    const batch = await BatchModel.create(input);
    const row = batch.toObject() as BatchDoc;

    const [product, farmer] = await Promise.all([
        ProductModel.findById(row.productId).lean<ProductDoc>().exec(),
        UserModel.findById(row.farmerId)
            .select({ _id: 1, name: 1, email: 1 })
            .lean<Pick<UserDoc, '_id' | 'name' | 'email'>>()
            .exec(),
    ]);
    const farmerProfile = farmer
        ? await FarmerProfileModel.findOne({ userId: farmer._id }).lean<FarmerProfileDoc>().exec()
        : null;

    return {
        ...row,
        product,
        farmer: farmer ? { ...farmer, farmerProfile } : null,
    };
}

export async function updateBatch(id: string, update: Record<string, unknown>): Promise<BatchDoc | null> {
    await connectToDatabase();
    return BatchModel.findByIdAndUpdate(id, { $set: update }, { new: true })
        .lean<BatchDoc>()
        .exec();
}

export async function countBatches(): Promise<number> {
    await connectToDatabase();
    return BatchModel.countDocuments().exec();
}

// ─── SEQUENCE NUMBERS ─────────────────────────────────────────────────────────

/**
 * Atomically reserve the next number in a named sequence.
 *
 * Replaces `count()` + 1, which is a race: two simultaneous registrations read
 * the same count and mint the same `batchCode`, and the unique index then
 * rejects the second write with an error that says nothing about the cause.
 * `$inc` is atomic per document, so the server serialises the callers.
 */
export async function nextSequence(name: string): Promise<number> {
    await connectToDatabase();
    const result = await CounterModel.findByIdAndUpdate(
        name,
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
    )
        .lean<{ _id: string; seq: number }>()
        .exec();
    return result.seq;
}

// ─── CASCADE DELETE ───────────────────────────────────────────────────────────

/**
 * Delete a batch and everything that hangs off it.
 *
 * Postgres did this in one statement via `ON DELETE CASCADE` across the foreign
 * keys. MongoDB has no equivalent, so the fan-out is written out here where it
 * is visible and testable.
 *
 * Three things this gets right that a naive `deleteMany` loop would not:
 *
 *  1. **The parent is deleted last.** Every child row above still names a
 *     batch while the batch exists. Deleting the parent first would leave
 *     children pointing at nothing, which is the state a partial failure
 *     would leave behind anyway.
 *
 *  2. **`Notification` and `AuditLog` are NOT deleted.** Their foreign keys are
 *     `onDelete: SetNull`, so Postgres kept the rows and blanked the reference.
 *     Deleting a batch must not erase the audit trail of who looked at it.
 *     Their `batchId` is nulled instead, which is exactly what SetNull meant.
 *
 *  3. **Fraud alerts and temperature logs are dual-parented** — they reference
 *     a batch *or* a shipment, and either may be null. A reading recorded
 *     against a live shipment must survive its batch being deleted, so only
 *     rows with no `shipmentId` are removed. The Prisma `CASCADE` on both
 *     foreign keys was arguably wrong here and this does not repeat it.
 *
 * Uses `allSettled` rather than `all`: one failing child delete must not leave
 * *unreported* orphans. The caller gets the per-collection result either way.
 */
export interface CascadeDeleteResult {
    deleted: boolean;
    /** Collections whose delete failed; empty on a clean delete. */
    failed: string[];
}

export async function deleteBatchCascade(batchId: string): Promise<CascadeDeleteResult> {
    await connectToDatabase();

    const exists = await BatchModel.findById(batchId).select({ _id: 1 }).lean().exec();
    if (!exists) return { deleted: false, failed: [] };

    const shipmentIds = await ShipmentModel.find({ batchId }).select({ _id: 1 }).lean().exec();
    const shipmentIdList = shipmentIds.map((s) => s._id);

    const legs: Array<[string, () => Promise<unknown>]> = [
        [
            'supplyChainEvents',
            () => SupplyChainEventModel.deleteMany({ batchId }).exec(),
        ],
        [
            'certificates',
            () => CertificateModel.deleteMany({ batchId }).exec(),
        ],
        [
            'ipfsDocuments',
            () => IpfsDocumentModel.deleteMany({ batchId }).exec(),
        ],
        [
            'mlPredictions',
            () => MlPredictionModel.deleteMany({ batchId }).exec(),
        ],
        ['trustScores', () => TrustScoreModel.deleteMany({ batchId }).exec()],
        [
            'complianceChecks',
            () =>
                shipmentIdList.length > 0
                    ? ComplianceCheckModel.deleteMany({ shipmentId: { $in: shipmentIdList } }).exec()
                    : Promise.resolve({ deletedCount: 0 }),
        ],
        // Dual-parented: only remove the rows not attached to a live shipment.
        [
            'fraudAlerts',
            () =>
                FraudAlertModel.deleteMany({
                    $or: [{ batchId, shipmentId: null }, { batchId, shipmentId: { $exists: false } }],
                }).exec(),
        ],
        [
            'temperatureLogs',
            () =>
                TemperatureLogModel.deleteMany({
                    $or: [{ batchId, shipmentId: null }, { batchId, shipmentId: { $exists: false } }],
                }).exec(),
        ],
        [
            'shipments',
            () => ShipmentModel.deleteMany({ batchId }).exec(),
        ],
        // SetNull, not Cascade — the notification itself survives.
        ['notifications', () => NotificationModel.updateMany({ batchId }, { $set: { batchId: null } }).exec()],
    ];

    const settled = await Promise.allSettled(legs.map(([, run]) => run()));
    const failed = settled
        .map((result, i) => ({ result, name: legs[i][0] }))
        .filter(({ result }) => result.status === 'rejected')
        .map(({ name }) => name);

    if (failed.length > 0) {
        // The batch is deliberately still here. Deleting it now would make the
        // orphans unreachable and unrecoverable through this function.
        console.error(`[db] batch ${batchId} cascade incomplete, batch retained: ${failed.join(', ')}`);
        return { deleted: false, failed };
    }

    await BatchModel.deleteOne({ _id: batchId }).exec();
    return { deleted: true, failed: [] };
}

// ─── AUDIT LOG ────────────────────────────────────────────────────────────────

export interface CreateAuditLogInput {
    userId?: string | null;
    action: string;
    resource: string;
    resourceId?: string | null;
    metadata?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
}

export async function writeAuditLog(input: CreateAuditLogInput): Promise<void> {
    await connectToDatabase();
    await AuditLogModel.create({
        userId: input.userId ?? null,
        action: input.action,
        resource: input.resource,
        resourceId: input.resourceId ?? null,
        metadata: input.metadata ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        timestamp: new Date(),
    });
}

// Re-exported so callers can reach the agent-log types from the batch module,
// where `createAgentLog` and the audit trail live together.
export type { AiAgentLogDoc, AuditLogDoc };
export { AiAgentLogModel };
