import mongoose, { Schema, type Model } from 'mongoose';

/**
 * The Mongoose schemas, ported one-for-one from `prisma/schema.prisma`.
 *
 * Deliberate departures from Prisma, and why each one is safe:
 *
 *  - **IDs are strings, not ObjectIds.** The demo data already has UUIDs in
 *    `id` columns and every API in this project accepts a batch by id *or* by
 *    `batchCode` as a string. ObjectIds would force a rewrite of every id the
 *    QR codes and seed data already carry, for no gain. `_id` is a string.
 *
 *  - **No `enum`.** The Prisma schema had no enums either — every "enum" was
 *    a free-text `String` with the allowed values in a comment. A Mongoose
 *    `enum` would be a *tighter* constraint than Postgres had, and a single
 *    out-of-set value would start throwing where the old database accepted it
 *    and merely meant something. That is a behaviour change disguised as
 *    validation, so the comments are preserved and the strings stay free.
 *
 *  - **`createdAt`/`updatedAt` use the `timestamps` option** rather than being
 *    listed per-schema, which is what `@default(now())` / `@updatedAt` meant.
 *
 *  - **JSON columns (`factorsJson`, `metadata`, …) stay `String`.** The AI
 *    service and the UI both read and write them as serialised JSON text, and
 *    several call sites pass `JSON.stringify(...)` explicitly. Keeping them as
 *    strings avoids a double-encoding mismatch during the port; the type is
 *    unchanged from the Prisma model.
 */

const { Schema: S } = mongoose;

/**
 * A schema that declares a field `unique: true` and *also* indexes it
 * explicitly.
 *
 * Mongoose turns `unique: true` into an index of its own, so writing both
 * registers the same index twice. Two registrations of the same index do not
 * create two indexes — the second is ignored — but Mongoose warns about it, and
 * the warning is emitted from inside `Schema.prototype.index()`, i.e. *while
 * the schema is still being constructed*. It therefore cannot be silenced by a
 * pass that runs afterwards, which is why this is a wrapper applied per schema
 * rather than a loop at the bottom of the file.
 *
 * Clearing `_index` between the two keeps the explicit call, which is the one
 * that carries `{ unique: true }` and sits with the rest of the collection's
 * index set. `_index` is the field Mongoose actually reads
 * (`node_modules/mongoose/lib/helpers/schema/getIndexes.js`, line 70) and any
 * path whose `_index` is `false` is skipped; it is not reachable through
 * `schema.path(name).options.index`, which only holds the declared literal.
 */
function withoutInlineUniqueIndexes<T extends Schema>(schema: T, uniqueFields: string[]): T {
    for (const field of uniqueFields) {
        (schema.path(field) as unknown as { _index?: unknown })._index = false;
    }
    return schema;
}

/**
 * A document id.
 *
 * A string UUID, not an ObjectId. Every API in this project takes a batch by
 * id *or* `batchCode` as a plain string, and the demo data already carries
 * UUIDs, so a string `_id` keeps every existing id valid and every call site
 * working without a conversion layer.
 */
type Id = string;

// ─── USERS & AUTHENTICATION ───────────────────────────────────────────────────

const FarmerProfileSchema = new S(
    {
        _id: { type: String, required: true, default: () => crypto.randomUUID() },
        userId: { type: String, required: true, unique: true },
        farmName: { type: String, required: true },
        location: { type: String, required: true },
        state: { type: String, required: true },
        district: { type: String, required: true },
    },
    { timestamps: true, collection: 'farmerprofiles' }
);
withoutInlineUniqueIndexes(FarmerProfileSchema, ['userId']);

FarmerProfileSchema.index({ userId: 1 }, { unique: true });

const UserSchema = new S(
    {
        _id: { type: String, required: true, default: () => crypto.randomUUID() },
        name: { type: String, required: true },
        email: { type: String, required: true, unique: true },
        password: { type: String, required: true },
        /// FARMER | EXPORTER | TRANSPORTER | IMPORTER | RETAILER | CONSUMER | REGULATOR | ADMIN
        role: { type: String, required: true, default: 'FARMER' },
        phone: { type: String, default: null },
        isActive: { type: Boolean, required: true, default: true },
    },
    { timestamps: true, collection: 'users' }
);
withoutInlineUniqueIndexes(UserSchema, ['email']);

UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ role: 1 });

// ─── PRODUCTS & BATCHES ───────────────────────────────────────────────────────

const ProductSchema = new S(
    {
        _id: { type: String, required: true, default: () => crypto.randomUUID() },
        name: { type: String, required: true, unique: true },
        category: { type: String, required: true },
        description: { type: String, required: true, default: '' },
    },
    { timestamps: true, collection: 'products' }
);
withoutInlineUniqueIndexes(ProductSchema, ['name']);

ProductSchema.index({ name: 1 }, { unique: true });

const BatchSchema = new S(
    {
        _id: { type: String, required: true, default: () => crypto.randomUUID() },
        /// Format: AGR-YYYY-ST-NNNNNN  e.g. AGR-2026-MH-000001
        batchCode: { type: String, required: true, unique: true },
        farmerId: { type: String, required: true },
        productId: { type: String, required: true },
        variety: { type: String, default: null },
        quantity: { type: Number, required: true },
        unit: { type: String, required: true, default: 'kg' },
        harvestDate: { type: Date, required: true },
        location: { type: String, required: true },
        destinationCountry: { type: String, default: null },
        /// Registered | In Transit | Exported | Delivered | Flagged | Recalled
        status: { type: String, required: true, default: 'Registered' },
        blockchainHash: { type: String, required: true },
        blockchainTransactionHash: { type: String, default: null },
        blockchainMode: { type: String, required: true, default: 'not_configured' },
        trustScore: { type: Number, required: true, default: 0 },
        // ML predictions cached
        spoilageProbability: { type: Number, default: null },
        spoilageRisk: { type: String, default: null },
        remainingShelfLifeDays: { type: Number, default: null },
        qualityScore: { type: Number, default: null },
        qualityGrade: { type: String, default: null },
        // IPFS
        ipfsDocumentCids: { type: [String], default: [] },
    },
    { timestamps: true, collection: 'batches' }
);
withoutInlineUniqueIndexes(BatchSchema, ['batchCode']);
BatchSchema.index({ batchCode: 1 }, { unique: true });
BatchSchema.index({ farmerId: 1 });
BatchSchema.index({ status: 1 });
BatchSchema.index({ createdAt: -1 });

// ─── SUPPLY CHAIN EVENTS (TRACEABILITY) ───────────────────────────────────────

const SupplyChainEventSchema = new S(
    {
        _id: { type: String, required: true, default: () => crypto.randomUUID() },
        batchId: { type: String, required: true },
        /// FARM_REGISTERED | HARVESTED | INSPECTED | CERTIFIED | TRANSFERRED_TO_MANDI |
        /// TRANSFERRED_TO_EXPORTER | LOADED_FOR_EXPORT | EXPORTED | IN_TRANSIT |
        /// CUSTOMS_CLEARED | IMPORTER_RECEIVED | RETAILER_RECEIVED | CONSUMER_VERIFIED
        eventType: { type: String, required: true },
        actorId: { type: String, default: null },
        actorRole: { type: String, default: null },
        location: { type: String, required: true },
        timestamp: { type: Date, required: true, default: () => new Date() },
        metadata: { type: String, default: null },
        blockchainTransactionHash: { type: String, default: null },
    },
    { timestamps: false, collection: 'supplychainevents' }
);
SupplyChainEventSchema.index({ batchId: 1 });
SupplyChainEventSchema.index({ eventType: 1 });
SupplyChainEventSchema.index({ timestamp: -1 });

// ─── CERTIFICATES & IPFS DOCUMENTS ────────────────────────────────────────────

const CertificateSchema = new S(
    {
        _id: { type: String, required: true, default: () => crypto.randomUUID() },
        batchId: { type: String, required: true },
        /// APEDA_PHYTOSANITARY | GLOBALG.A.P | GI_TAG | ORGANIC | FSSAI | CUSTOM
        certificateType: { type: String, required: true },
        fileUrl: { type: String, default: '' },
        ipfsHash: { type: String, default: null },
        fileHash: { type: String, required: true },
        issuer: { type: String, required: true },
        issueDate: { type: Date, required: true, default: () => new Date() },
        expiryDate: { type: Date, required: true },
        /// PENDING | VERIFIED | MISMATCH | NOT_FOUND | DUPLICATE | SUSPICIOUS
        verificationStatus: { type: String, required: true, default: 'PENDING' },
        blockchainHash: { type: String, default: null },
    },
    { timestamps: { createdAt: true, updatedAt: false }, collection: 'certificates' }
);
CertificateSchema.index({ batchId: 1 });
CertificateSchema.index({ fileHash: 1 });
CertificateSchema.index({ verificationStatus: 1 });

const IpfsDocumentSchema = new S(
    {
        _id: { type: String, required: true, default: () => crypto.randomUUID() },
        batchId: { type: String, default: null },
        ipfsCid: { type: String, required: true, unique: true },
        fileHash: { type: String, required: true },
        filename: { type: String, required: true },
        mimeType: { type: String, required: true },
        sizBytes: { type: Number, default: null },
        uploadedBy: { type: String, default: null },
        uploadedAt: { type: Date, required: true, default: () => new Date() },
        docType: { type: String, required: true, default: 'CERTIFICATE' },
    },
    { timestamps: false, collection: 'ipfsdocuments' }
);
withoutInlineUniqueIndexes(IpfsDocumentSchema, ['ipfsCid']);

IpfsDocumentSchema.index({ ipfsCid: 1 }, { unique: true });
// Was `index: true` on the field. Every batch's document list is looked up by
// it, and unlike the other inline flags this one had no `schema.index()`
// counterpart, so removing the flag without adding this would have dropped the
// index rather than deduplicated it.
IpfsDocumentSchema.index({ batchId: 1 });

// ─── SHIPMENTS & COMPLIANCE ───────────────────────────────────────────────────

const ShipmentSchema = new S(
    {
        _id: { type: String, required: true, default: () => crypto.randomUUID() },
        shipmentCode: { type: String, required: true, unique: true },
        batchId: { type: String, required: true },
        exporterId: { type: String, required: true },
        transporterId: { type: String, default: null },
        destinationCountry: { type: String, required: true },
        quantity: { type: Number, required: true },
        unit: { type: String, required: true, default: 'kg' },
        /// Pending | In Transit | Under Review | Customs | Delivered | Flagged | Rejected
        status: { type: String, required: true, default: 'Pending' },
        riskScore: { type: Number, required: true, default: 50 },
        estimatedArrival: { type: Date, default: null },
    },
    { timestamps: true, collection: 'shipments' }
);
withoutInlineUniqueIndexes(ShipmentSchema, ['shipmentCode']);

ShipmentSchema.index({ shipmentCode: 1 }, { unique: true });
ShipmentSchema.index({ batchId: 1 });
ShipmentSchema.index({ exporterId: 1 });
ShipmentSchema.index({ status: 1 });

const ComplianceCheckSchema = new S(
    {
        _id: { type: String, required: true, default: () => crypto.randomUUID() },
        shipmentId: { type: String, required: true },
        country: { type: String, required: true },
        requirement: { type: String, required: true },
        /// PASSED | FAILED | MISSING | PENDING
        status: { type: String, required: true, default: 'PENDING' },
        explanation: { type: String, required: true },
        source: { type: String, required: true },
        evidence: { type: String, default: null },
    },
    { timestamps: { createdAt: true, updatedAt: false }, collection: 'compliancechecks' }
);
ComplianceCheckSchema.index({ shipmentId: 1 });
ComplianceCheckSchema.index({ country: 1 });
ComplianceCheckSchema.index({ status: 1 });

// ─── FRAUD DETECTION ──────────────────────────────────────────────────────────

const FraudAlertSchema = new S(
    {
        _id: { type: String, required: true, default: () => crypto.randomUUID() },
        batchId: { type: String, default: null },
        shipmentId: { type: String, default: null },
        /// DUPLICATE_CERTIFICATE | EXPIRED_CERTIFICATE | TEMP_BREACH | IMPOSSIBLE_TIMESTAMP |
        /// IMPOSSIBLE_OWNERSHIP | QUANTITY_ANOMALY | ROUTE_ANOMALY | WEIGHT_DISCREPANCY
        fraudType: { type: String, required: true },
        /// CRITICAL | HIGH | MEDIUM | LOW
        severity: { type: String, required: true, default: 'HIGH' },
        description: { type: String, required: true },
        evidence: { type: String, default: null },
        confidence: { type: Number, required: true, default: 0.95 },
        /// OPEN | UNDER_REVIEW | RESOLVED | FALSE_POSITIVE
        status: { type: String, required: true, default: 'OPEN' },
        resolvedBy: { type: String, default: null },
        resolvedAt: { type: Date, default: null },
        notes: { type: String, default: null },
    },
    { timestamps: true, collection: 'fraudalerts' }
);
FraudAlertSchema.index({ batchId: 1 });
FraudAlertSchema.index({ shipmentId: 1 });
FraudAlertSchema.index({ status: 1 });
FraudAlertSchema.index({ severity: 1 });

// ─── TRUST SCORE ──────────────────────────────────────────────────────────────

const TrustScoreSchema = new S(
    {
        _id: { type: String, required: true, default: () => crypto.randomUUID() },
        batchId: { type: String, required: true, unique: true },
        blockchainScore: { type: Number, required: true, default: 0 },
        certificateScore: { type: Number, required: true, default: 0 },
        coldChainScore: { type: Number, required: true, default: 0 },
        inspectionScore: { type: Number, required: true, default: 0 },
        complianceScore: { type: Number, required: true, default: 0 },
        qualityScore: { type: Number, required: true, default: 0 },
        mlRiskScore: { type: Number, required: true, default: 0 },
        finalScore: { type: Number, required: true, default: 0 },
        factorsJson: { type: String, required: true },
        explanation: { type: String, required: true },
    },
    { timestamps: true, collection: 'trustscores' }
);
withoutInlineUniqueIndexes(TrustScoreSchema, ['batchId']);

TrustScoreSchema.index({ batchId: 1 }, { unique: true });
TrustScoreSchema.index({ finalScore: -1 });

// ─── ML PREDICTIONS ───────────────────────────────────────────────────────────

const MlPredictionSchema = new S(
    {
        _id: { type: String, required: true, default: () => crypto.randomUUID() },
        batchId: { type: String, required: true },
        /// SPOILAGE | QUALITY | SHELF_LIFE | FRAUD | DEMAND
        modelType: { type: String, required: true },
        modelName: { type: String, required: true },
        modelVersion: { type: String, required: true, default: '1.0.0' },
        /// Raw JSON prediction output
        result: { type: String, required: true },
        confidence: { type: Number, required: true },
        featuresJson: { type: String, default: null },
        shapJson: { type: String, default: null },
        inputJson: { type: String, default: null },
    },
    { timestamps: { createdAt: true, updatedAt: false }, collection: 'mlpredictions' }
);
MlPredictionSchema.index({ batchId: 1 });
MlPredictionSchema.index({ modelType: 1 });
MlPredictionSchema.index({ createdAt: -1 });

// ─── IOT / SENSOR READINGS ────────────────────────────────────────────────────

const TemperatureLogSchema = new S(
    {
        _id: { type: String, required: true, default: () => crypto.randomUUID() },
        shipmentId: { type: String, default: null },
        batchId: { type: String, default: null },
        sensorId: { type: String, default: null },
        temperature: { type: Number, required: true },
        humidity: { type: Number, default: null },
        location: { type: String, required: true },
        latitude: { type: Number, default: null },
        longitude: { type: Number, default: null },
        batteryLevel: { type: Number, default: null },
        isSimulated: { type: Boolean, required: true, default: false },
        timestamp: { type: Date, required: true, default: () => new Date() },
    },
    { timestamps: false, collection: 'temperaturelogs' }
);
TemperatureLogSchema.index({ batchId: 1 });
TemperatureLogSchema.index({ shipmentId: 1 });
TemperatureLogSchema.index({ sensorId: 1 });
TemperatureLogSchema.index({ timestamp: -1 });

// ─── AI AGENT LOGS ────────────────────────────────────────────────────────────

const AiAgentLogSchema = new S(
    {
        _id: { type: String, required: true, default: () => crypto.randomUUID() },
        agentName: { type: String, required: true },
        agentType: { type: String, required: true, default: 'unknown' },
        task: { type: String, required: true },
        input: { type: String, required: true },
        output: { type: String, required: true },
        toolsUsed: { type: String, default: null },
        evidence: { type: String, default: null },
        sources: { type: String, default: null },
        confidence: { type: Number, required: true, default: 0.0 },
        /// COMPLETED | PASSED | FLAGGED | FAILED | ANSWERED
        status: { type: String, required: true, default: 'COMPLETED' },
        durationMs: { type: Number, default: null },
    },
    { timestamps: { createdAt: true, updatedAt: false }, collection: 'aiagentlogs' }
);
AiAgentLogSchema.index({ agentName: 1 });
AiAgentLogSchema.index({ status: 1 });
AiAgentLogSchema.index({ createdAt: -1 });

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────

const NotificationSchema = new S(
    {
        _id: { type: String, required: true, default: () => crypto.randomUUID() },
        userId: { type: String, required: true },
        // onDelete: SetNull — deleting a Batch leaves the notification, and
        // clears this reference. See deleteBatchCascade().
        batchId: { type: String, default: null },
        /// TEMP_BREACH | SPOILAGE_RISK | FRAUD_ALERT | COMPLIANCE_FAIL | CERT_EXPIRED |
        /// BATCH_CREATED | SHIPMENT_UPDATE | SYSTEM
        type: { type: String, required: true },
        title: { type: String, required: true },
        message: { type: String, required: true },
        isRead: { type: Boolean, required: true, default: false },
    },
    { timestamps: { createdAt: true, updatedAt: false }, collection: 'notifications' }
);
NotificationSchema.index({ userId: 1 });
NotificationSchema.index({ isRead: 1 });
NotificationSchema.index({ createdAt: -1 });

// ─── AUDIT LOG (immutable) ────────────────────────────────────────────────────

const AuditLogSchema = new S(
    {
        _id: { type: String, required: true, default: () => crypto.randomUUID() },
        // onDelete: SetNull — the row survives the user; the reference does not.
        userId: { type: String, default: null },
        action: { type: String, required: true },
        resource: { type: String, required: true },
        resourceId: { type: String, default: null },
        metadata: { type: String, default: null },
        ipAddress: { type: String, default: null },
        userAgent: { type: String, default: null },
        timestamp: { type: Date, required: true, default: () => new Date() },
    },
    { timestamps: false, collection: 'auditlogs' }
);
AuditLogSchema.index({ userId: 1 });
AuditLogSchema.index({ action: 1 });
AuditLogSchema.index({ resource: 1 });
AuditLogSchema.index({ timestamp: -1 });

// ─── COUNTERS (sequence generation) ───────────────────────────────────────────

/**
 * Monotonic counters, replacing `count()`-then-add-one.
 *
 * `prisma.batch.count()` was used as a sequence generator for `batchCode`:
 * read the number of batches, add one. Two simultaneous registrations read the
 * same count and produce the same code. Under Prisma that surfaced as a
 * Prisma P2002 unique-violation; under Mongo it would surface as a raw
 * `MongoServerError` code 11000 and a generic 500 — an error message that says
 * nothing about the cause.
 *
 * `$inc` with `upsert` is atomic at the document level, so concurrent callers
 * are serialised by the server and each gets a distinct number. This fixes a
 * pre-existing race rather than introducing one.
 */
const CounterSchema = new S(
    {
        _id: { type: String, required: true },
        seq: { type: Number, required: true, default: 0 },
    },
    { timestamps: false, collection: 'counters' }
);

// ─── RAG KNOWLEDGE BASE ───────────────────────────────────────────────────────

/**
 * The RAG corpus, in the same database as everything else.
 *
 * This replaces a 12 KB FAISS binary plus a sidecar `documents.json`. The
 * `pipeline.py` reader used `IndexFlatIP`, which is *exhaustive* search — it
 * compares the query against every stored vector, so scoring the same vectors
 * in process returns identical results. Storing the text and the metadata
 * alongside the embedding makes the knowledgebase inspectable and editable,
 * which a binary index is not, and it works identically against a local mongod
 * and an Atlas M0 cluster.
 */
const RagDocumentSchema = new S(
    {
        title: { type: String, required: true },
        content: { type: String, required: true },
        /// e.g. 'APEDA', 'EU 2016/2031', 'US FSMA', 'FSSAI', 'Codex Alimentarius'
        source: { type: String, required: true },
        /// IN | EU | US | AE | GLOBAL
        jurisdiction: { type: String, default: 'GLOBAL' },
        /// REGULATION | STANDARD | GUIDELINE | CERTIFICATION
        documentType: { type: String, default: 'REGULATION' },
        publicationDate: { type: Date, default: null },
        /// Ordered 500-word chunks with 50-word overlap, mirroring the previous
        /// chunking so retrieval granularity is unchanged.
        chunks: {
            type: [
                // `_id: false` is set in the *options* below, not in the field
                // map. Declaring it as a field is a type error in Mongoose 8 —
                // `_id` is not a schema-definition property — and because the
                // embedded schema is what types every chunk read, the mismatch
                // is not local: it forced a conditional-type expansion that
                // exhausted the compiler's heap across the whole file.
                new S(
                    {
                        index: { type: Number, required: true },
                        text: { type: String, required: true },
                        /// Normalised 384-dim all-MiniLM-L6-v2 embedding.
                        embedding: { type: [Number], required: true },
                    },
                    { _id: false }
                ),
            ],
            default: [],
        },
        createdAt: { type: Date, required: true, default: () => new Date() },
        updatedAt: { type: Date, required: true, default: () => new Date() },
    },
    { timestamps: true, collection: 'rag_documents' }
);
RagDocumentSchema.index({ source: 1 });
RagDocumentSchema.index({ jurisdiction: 1, documentType: 1 });

// ─── LEAN DOCUMENT TYPES ──────────────────────────────────────────────────────

/**
 * The shape of a persisted document as `.lean()` hands it back: the schema's
 * fields, nothing else. Mongoose's `InferSchemaType` cannot be used here — the
 * models are registered as `Model<any>` (see `AnyModel` below) precisely so the
 * compiler does not have to expand eighteen schema types at once, and inferring
 * the lean shape is the same expansion by another name. These are hand-written
 * for that reason, and they are checked against the schemas by `tsc` at every
 * field access in the repositories.
 *
 * Two conventions, both carried over from the Prisma-generated client:
 *
 *  - A field with a `default` is optional (`?`). It is always present on a
 *    document that came back from the database, but the default is also how it
 *    gets *written*, so an input object that omits it must still typecheck.
 *  - `createdAt`/`updatedAt` are present only where the schema enables
 *    `timestamps`, and `updatedAt` is absent where the schema disables it. That
 *    is not an oversight in the schema — `SupplyChainEvent` and `AuditLog` are
 *    append-only, so an `updatedAt` on them would be a lie about immutability.
 */

export interface FarmerProfileDoc {
    _id: Id;
    userId: string;
    farmName: string;
    location: string;
    state: string;
    district: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface UserDoc {
    _id: Id;
    name: string;
    email: string;
    /** bcrypt hash. Never return this across the wire — see `findUserByIdWithProfileSafe`. */
    password: string;
    role: string;
    phone?: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface ProductDoc {
    _id: Id;
    name: string;
    category: string;
    description: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface BatchDoc {
    _id: Id;
    batchCode: string;
    farmerId: string;
    productId: string;
    variety?: string | null;
    quantity: number;
    unit: string;
    harvestDate: Date;
    location: string;
    destinationCountry?: string | null;
    status: string;
    blockchainHash: string;
    blockchainTransactionHash?: string | null;
    blockchainMode: string;
    trustScore: number;
    spoilageProbability?: number | null;
    spoilageRisk?: string | null;
    remainingShelfLifeDays?: number | null;
    qualityScore?: number | null;
    qualityGrade?: string | null;
    ipfsDocumentCids: string[];
    createdAt: Date;
    updatedAt: Date;
}

/** Append-only — no `updatedAt`; see the note above on immutable collections. */
export interface SupplyChainEventDoc {
    _id: Id;
    batchId: string;
    eventType: string;
    actorId?: string | null;
    actorRole?: string | null;
    location: string;
    timestamp: Date;
    /** Serialised JSON text, not an object. See the file header. */
    metadata?: string | null;
    blockchainTransactionHash?: string | null;
}

export interface CertificateDoc {
    _id: Id;
    batchId: string;
    certificateType: string;
    fileUrl: string;
    ipfsHash?: string | null;
    fileHash: string;
    issuer: string;
    issueDate: Date;
    expiryDate: Date;
    verificationStatus: string;
    blockchainHash?: string | null;
    createdAt: Date;
}

export interface IpfsDocumentDoc {
    _id: Id;
    batchId?: string | null;
    ipfsCid: string;
    fileHash: string;
    filename: string;
    mimeType: string;
    sizBytes?: number | null;
    uploadedBy?: string | null;
    uploadedAt: Date;
    docType: string;
}

export interface ShipmentDoc {
    _id: Id;
    shipmentCode: string;
    batchId: string;
    exporterId: string;
    transporterId?: string | null;
    destinationCountry: string;
    quantity: number;
    unit: string;
    status: string;
    riskScore: number;
    estimatedArrival?: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface ComplianceCheckDoc {
    _id: Id;
    shipmentId: string;
    country: string;
    requirement: string;
    status: string;
    explanation: string;
    source: string;
    evidence?: string | null;
    createdAt: Date;
}

export interface FraudAlertDoc {
    _id: Id;
    batchId?: string | null;
    shipmentId?: string | null;
    fraudType: string;
    severity: string;
    description: string;
    evidence?: string | null;
    confidence: number;
    status: string;
    resolvedBy?: string | null;
    resolvedAt?: Date | null;
    notes?: string | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface TrustScoreDoc {
    _id: Id;
    batchId: string;
    blockchainScore: number;
    certificateScore: number;
    coldChainScore: number;
    inspectionScore: number;
    complianceScore: number;
    qualityScore: number;
    /**
     * Optional because nothing writes it.
     *
     * The Prisma model has `mlRiskScore Int @default(0)` and the old `upsert`
     * never included it in its payload, so it was only ever ever the column
     * default — every stored row reads 0. Optional rather than removed so the
     * stored shape still matches the schema; `required` in the Mongoose schema
     * keeps the column present, and the default supplies it. Making it
     * `required` here would instead force every caller to invent a value,
     * which is a *new* meaning the column never had.
     */
    mlRiskScore?: number;
    finalScore: number;
    factorsJson: string;
    explanation: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface MlPredictionDoc {
    _id: Id;
    batchId: string;
    modelType: string;
    modelName: string;
    modelVersion: string;
    /** Raw serialised JSON prediction output, not an object. */
    result: string;
    confidence: number;
    featuresJson?: string | null;
    shapJson?: string | null;
    inputJson?: string | null;
    createdAt: Date;
}

export interface TemperatureLogDoc {
    _id: Id;
    shipmentId?: string | null;
    batchId?: string | null;
    sensorId?: string | null;
    temperature: number;
    humidity?: number | null;
    location: string;
    latitude?: number | null;
    longitude?: number | null;
    batteryLevel?: number | null;
    isSimulated: boolean;
    timestamp: Date;
}

export interface AiAgentLogDoc {
    _id: Id;
    agentName: string;
    agentType: string;
    task: string;
    input: string;
    output: string;
    toolsUsed?: string | null;
    evidence?: string | null;
    sources?: string | null;
    confidence: number;
    status: string;
    durationMs?: number | null;
    createdAt: Date;
}

export interface NotificationDoc {
    _id: Id;
    userId: string;
    /** `onDelete: SetNull` — survives the batch it points at. */
    batchId?: string | null;
    type: string;
    title: string;
    message: string;
    isRead: boolean;
    createdAt: Date;
}

/** Append-only. `userId` is `onDelete: SetNull` — the row outlives the user. */
export interface AuditLogDoc {
    _id: Id;
    userId?: string | null;
    action: string;
    resource: string;
    resourceId?: string | null;
    metadata?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    timestamp: Date;
}

export interface CounterDoc {
    _id: Id;
    seq: number;
}

export interface RagChunk {
    index: number;
    text: string;
    /** Normalised 384-dim all-MiniLM-L6-v2 embedding. */
    embedding: number[];
}

export interface RagDocumentDoc {
    _id: Id;
    title: string;
    content: string;
    source: string;
    jurisdiction: string;
    documentType: string;
    publicationDate?: Date | null;
    chunks: RagChunk[];
    createdAt: Date;
    updatedAt: Date;
}

// ─── MODEL REGISTRY ───────────────────────────────────────────────────────────

/**
 * Every registered model, at its widest.
 *
 * **The `any` is load-bearing and is not a shortcut.** Typing each of the 18
 * models as `Model<ItsOwnDoc>` makes Mongoose instantiate a distinct
 * `Model<T>` for every one, and `tsc` exhausts the 8 GB heap partway through
 * this file and exits without producing output. `Model<any>` collapses them to
 * a single instantiation, which typechecks in a second.
 *
 * The cost is that `.lean()` on a model registered here is untyped and cannot
 * take a type argument — which is why every repository declares its own return
 * interface and spells the projection out, rather than inferring the shape from
 * the model. Callers get real types; only this registry is wide.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
type AnyModel = Model<any>;

function register(name: string, schema: Schema, model?: AnyModel): AnyModel {
    if (model) return model;
    const cached = (mongoose.models as Record<string, AnyModel | undefined>)[name];
    if (cached) return cached;
    return mongoose.model(name, schema);
}

export const UserModel: AnyModel = register('User', UserSchema);
export const BatchModel: AnyModel = register('Batch', BatchSchema);
export const RagDocumentModel: AnyModel = register('RagDocument', RagDocumentSchema);
export const FarmerProfileModel: AnyModel = register('FarmerProfile', FarmerProfileSchema);
export const ProductModel: AnyModel = register('Product', ProductSchema);
export const SupplyChainEventModel: AnyModel = register('SupplyChainEvent', SupplyChainEventSchema);
export const CertificateModel: AnyModel = register('Certificate', CertificateSchema);
export const IpfsDocumentModel: AnyModel = register('IpfsDocument', IpfsDocumentSchema);
export const ShipmentModel: AnyModel = register('Shipment', ShipmentSchema);
export const ComplianceCheckModel: AnyModel = register('ComplianceCheck', ComplianceCheckSchema);
export const FraudAlertModel: AnyModel = register('FraudAlert', FraudAlertSchema);
export const TrustScoreModel: AnyModel = register('TrustScore', TrustScoreSchema);
export const MlPredictionModel: AnyModel = register('MlPrediction', MlPredictionSchema);
export const TemperatureLogModel: AnyModel = register('TemperatureLog', TemperatureLogSchema);
export const AiAgentLogModel: AnyModel = register('AiAgentLog', AiAgentLogSchema);
export const NotificationModel: AnyModel = register('Notification', NotificationSchema);
export const AuditLogModel: AnyModel = register('AuditLog', AuditLogSchema);
export const CounterModel: AnyModel = register('Counter', CounterSchema);
