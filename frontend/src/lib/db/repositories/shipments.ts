import { connectToDatabase } from '../connection';
import {
    ComplianceCheckModel,
    FraudAlertModel,
    ShipmentModel,
    UserModel,
    type BatchDoc,
    type ComplianceCheckDoc,
    type FraudAlertDoc,
    type ProductDoc,
    type ShipmentDoc,
    type UserDoc,
} from '../models';

// ─── SHIPMENTS ────────────────────────────────────────────────────────────────

export interface ShipmentWithExporter extends ShipmentDoc {
    exporter: Pick<UserDoc, '_id' | 'name' | 'email'> | null;
}

export async function findShipmentsByExporter(
    exporterId: string
): Promise<ShipmentWithExporter[]> {
    await connectToDatabase();
    const shipments = await ShipmentModel.find({ exporterId })
        .sort({ createdAt: -1 })
        .lean<ShipmentDoc[]>()
        .exec();
    if (shipments.length === 0) return [];

    const exporters = await UserModel.find({ _id: { $in: [...new Set(shipments.map((s) => s.exporterId))] } })
        .select({ _id: 1, name: 1, email: 1 })
        .lean<Array<Pick<UserDoc, '_id' | 'name' | 'email'>>>()
        .exec();
    const byId = new Map(exporters.map((e) => [e._id, e]));

    return shipments.map((s) => ({ ...s, exporter: byId.get(s.exporterId) ?? null }));
}

export async function findShipmentById(id: string): Promise<ShipmentDoc | null> {
    await connectToDatabase();
    return ShipmentModel.findById(id).lean<ShipmentDoc>().exec();
}

/** Resolve a shipment by stored id *or* `shipmentCode`. */
export async function findShipmentByIdOrCode(
    idOrCode: string
): Promise<ShipmentDoc | null> {
    await connectToDatabase();
    return ShipmentModel.findOne({
        $or: [{ _id: idOrCode }, { shipmentCode: idOrCode }],
    })
        .lean<ShipmentDoc>()
        .exec();
}

/**
 * A shipment with the batch behind it, the exporter, its compliance checks and
 * its fraud alerts.
 *
 * This is the `include` tree from `GET /api/shipments`, assembled from separate
 * queries because MongoDB has no joins. Two round trips are saved by loading
 * every child in two `$in` queries rather than one per shipment.
 *
 * `batch.product` and `batch.farmer` come back **narrowed** — `name`/`email`
 * for the farmer, never `password`. Prisma's unfiltered `farmer: true` include
 * would have carried the bcrypt hash in every shipment listing; that is a
 * difference in what leaves the server, not just in nesting, so it is made
 * deliberately rather than by accident.
 */
export interface ShipmentWithRelations extends ShipmentDoc {
    exporter: Pick<UserDoc, '_id' | 'name' | 'email'> | null;
    batch: (BatchDoc & { product: ProductDoc | null; farmer: FarmerBrief | null }) | null;
    complianceChecks: ComplianceCheckDoc[];
    fraudAlerts: FraudAlertDoc[];
}

type FarmerBrief = Pick<UserDoc, '_id' | 'name' | 'email' | 'role'>;

export async function listShipmentsForUser(
    role: string,
    userId: string
): Promise<ShipmentWithRelations[]> {
    await connectToDatabase();

    // Exporter scoping only. Regulators, admins, importers and transporters see
    // every shipment, which is what the unfiltered Prisma `findMany` did.
    const where = role === 'EXPORTER' ? { exporterId: userId } : {};

    const shipments = await ShipmentModel.find(where)
        .sort({ createdAt: -1 })
        .lean<ShipmentDoc[]>()
        .exec();
    if (shipments.length === 0) return [];

    const { BatchModel, ProductModel } = await import('../models');
    const shipmentIds = shipments.map((s) => s._id);
    const batchIds = [...new Set(shipments.map((s) => s.batchId))];

    const [batches, exporters, complianceChecks, fraudAlerts] = await Promise.all([
        BatchModel.find({ _id: { $in: batchIds } }).lean<BatchDoc[]>().exec(),
        UserModel.find({ _id: { $in: [...new Set(shipments.map((s) => s.exporterId))] } })
            .select({ _id: 1, name: 1, email: 1 })
            .lean<Array<Pick<UserDoc, '_id' | 'name' | 'email'>>>()
            .exec(),
        ComplianceCheckModel.find({ shipmentId: { $in: shipmentIds } })
            .lean<ComplianceCheckDoc[]>()
            .exec(),
        FraudAlertModel.find({ shipmentId: { $in: shipmentIds } })
            .lean<FraudAlertDoc[]>()
            .exec(),
    ]);

    const productIds = [...new Set(batches.map((b) => b.productId))];
    const farmerIds = [...new Set(batches.map((b) => b.farmerId))];
    const [products, farmers] = await Promise.all([
        ProductModel.find({ _id: { $in: productIds } }).lean<ProductDoc[]>().exec(),
        UserModel.find({ _id: { $in: farmerIds } })
            .select({ _id: 1, name: 1, email: 1, role: 1 })
            .lean<FarmerBrief[]>()
            .exec(),
    ]);

    const batchById = new Map(batches.map((b) => [b._id, b]));
    const productById = new Map(products.map((p) => [p._id, p]));
    const farmerById = new Map(farmers.map((f) => [f._id, f]));
    const exporterById = new Map(exporters.map((e) => [e._id, e]));

    return shipments.map((s) => {
        const batch = batchById.get(s.batchId) ?? null;
        return {
            ...s,
            exporter: exporterById.get(s.exporterId) ?? null,
            batch: batch
                ? {
                      ...batch,
                      product: productById.get(batch.productId) ?? null,
                      farmer: farmerById.get(batch.farmerId) ?? null,
                  }
                : null,
            complianceChecks: complianceChecks.filter((c) => c.shipmentId === s._id),
            fraudAlerts: fraudAlerts.filter((f) => f.shipmentId === s._id),
        };
    });
}

export async function findShipmentByIdWithBatch(id: string): Promise<
    (ShipmentDoc & { batch: { _id: string; batchCode: string; productId: string } | null }) | null
> {
    await connectToDatabase();
    const shipment = await ShipmentModel.findById(id).lean<ShipmentDoc>().exec();
    if (!shipment) return null;
    const { BatchModel } = await import('../models');
    const batch = await BatchModel.findById(shipment.batchId)
        .select({ _id: 1, batchCode: 1, productId: 1 })
        .lean<{ _id: string; batchCode: string; productId: string } | null>()
        .exec();
    return { ...shipment, batch: batch ?? null };
}

export interface CreateShipmentInput {
    shipmentCode: string;
    batchId: string;
    exporterId: string;
    transporterId?: string | null;
    destinationCountry: string;
    quantity: number;
    unit: string;
    status?: string;
    riskScore?: number;
    estimatedArrival?: Date | null;
}

export async function createShipment(input: CreateShipmentInput): Promise<ShipmentDoc> {
    await connectToDatabase();
    const shipment = await ShipmentModel.create({
        ...input,
        transporterId: input.transporterId ?? null,
        status: input.status ?? 'Pending',
        riskScore: input.riskScore ?? 50,
        estimatedArrival: input.estimatedArrival ?? null,
    });
    return shipment.toObject() as ShipmentDoc;
}

export async function countShipments(): Promise<number> {
    await connectToDatabase();
    return ShipmentModel.countDocuments().exec();
}

// ─── COMPLIANCE CHECKS ────────────────────────────────────────────────────────

/**
 * Replace every compliance check for one shipment in one country.
 *
 * The Prisma version was `deleteMany` then `createMany`. Two notes on the port:
 *
 *  - `createMany` has no Mongo equivalent; `insertMany` is it.
 *  - `createMany` returned `{ count }` and `insertMany` resolves to the array
 *    of inserted documents. `ordered: false` lets one bad document in the batch
 *    not abort the rest.
 *
 * The delete-then-insert pair was **not** atomic under Prisma either, and is
 * not made atomic here. A real transaction needs a replica set: standalone
 * `mongod` does not have one, and neither does Atlas M0. Adding one would
 * break local development to fix a window that is a few milliseconds wide and
 * that the previous code already had. The reasoning is recorded here so the
 * next reader does not mistake it for an oversight.
 */
export async function replaceComplianceChecks(
    shipmentId: string,
    country: string,
    checks: Array<Omit<ComplianceCheckDoc, '_id' | 'shipmentId' | 'country' | 'createdAt'>>
): Promise<number> {
    await connectToDatabase();
    await ComplianceCheckModel.deleteMany({ shipmentId, country }).exec();
    if (checks.length === 0) return 0;
    const inserted = await ComplianceCheckModel.insertMany(
        checks.map((c) => ({ ...c, shipmentId, country })),
        { ordered: false }
    );
    return inserted.length;
}

export interface CreateComplianceCheckInput {
    shipmentId: string;
    country: string;
    requirement: string;
    status: string;
    explanation: string;
    source: string;
    evidence?: string | null;
}

export async function createComplianceCheck(
    input: CreateComplianceCheckInput
): Promise<ComplianceCheckDoc> {
    await connectToDatabase();
    const check = await ComplianceCheckModel.create({
        ...input,
        evidence: input.evidence ?? null,
    });
    return check.toObject() as ComplianceCheckDoc;
}

// ─── FRAUD ALERTS ─────────────────────────────────────────────────────────────

export interface ListFraudAlertsOptions {
    status?: string;
    severity?: string;
    limit: number;
    offset: number;
    /**
     * Who is asking. A FARMER sees only alerts on their own batches; an
     * EXPORTER sees only alerts on their own shipments. Everyone else — ADMIN,
     * REGULATOR, CONSUMER — sees all of them, which is what an unfiltered
     * Prisma `findMany` did.
     */
    role: string;
    userId: string;
}

/**
 * List fraud alerts, filtered by the caller's role.
 *
 * The Prisma version filtered on a *relation*:
 *
 * ```ts
 * where: { shipment: { exporterId: user.id } }   // EXPORTER
 * where: { shipment: { is: {} } }                // IMPORTER
 * ```
 *
 * Mongo has no joins, so the shipment ids are resolved first and the alert is
 * filtered by `shipmentId: { $in: [...] }`.
 *
 * The `is: {}` idiom is worth being explicit about, because it is not "the
 * shipment exists". Prisma emits it for a required-relation filter and it
 * matches every alert that has one — that is, `shipmentId != null`. Reading it
 * as an existence check would be a misreading; the two coincide only because
 * no code path creates a shipment-less alert.
 */
export async function listFraudAlerts(
    options: ListFraudAlertsOptions
): Promise<{ alerts: FraudAlertDoc[]; total: number }> {
    await connectToDatabase();
    const { status, severity, limit, offset, role, userId } = options;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (severity) where.severity = severity;

    if (role === 'FARMER') {
        const { BatchModel } = await import('../models');
        const batches = await BatchModel.find({ farmerId: userId })
            .select({ _id: 1 })
            .lean<Array<{ _id: string }>>()
            .exec();
        where.batchId = { $in: batches.map((b) => b._id) };
    } else if (role === 'EXPORTER') {
        const shipments = await ShipmentModel.find({ exporterId: userId })
            .select({ _id: 1 })
            .lean<Array<{ _id: string }>>()
            .exec();
        where.shipmentId = { $in: shipments.map((s) => s._id) };
    } else if (role === 'IMPORTER') {
        // Was `shipment: { is: {} }` — has a shipment. Not "shipment exists
        // and is non-empty", which is what `is: {}` looks like at a glance.
        where.shipmentId = { $ne: null };
    }

    const [alerts, total] = await Promise.all([
        FraudAlertModel.find(where)
            .sort({ createdAt: -1 })
            .skip(offset)
            .limit(limit)
            .lean<FraudAlertDoc[]>()
            .exec(),
        FraudAlertModel.countDocuments(where).exec(),
    ]);

    return { alerts, total };
}

export async function findFraudAlertById(id: string): Promise<FraudAlertDoc | null> {
    await connectToDatabase();
    return FraudAlertModel.findById(id).lean<FraudAlertDoc>().exec();
}

export async function countFraudAlerts(where: Record<string, unknown> = {}): Promise<number> {
    await connectToDatabase();
    return FraudAlertModel.countDocuments(where).exec();
}

export interface CreateFraudAlertInput {
    batchId?: string | null;
    shipmentId?: string | null;
    fraudType: string;
    severity: string;
    description: string;
    evidence?: string | null;
    confidence?: number;
    status?: string;
}

export async function createFraudAlert(input: CreateFraudAlertInput): Promise<FraudAlertDoc> {
    await connectToDatabase();
    const alert = await FraudAlertModel.create({
        ...input,
        batchId: input.batchId ?? null,
        shipmentId: input.shipmentId ?? null,
        evidence: input.evidence ?? null,
        confidence: input.confidence ?? 0.95,
        status: input.status ?? 'OPEN',
    });
    return alert.toObject() as FraudAlertDoc;
}

export async function updateFraudAlert(
    id: string,
    update: Record<string, unknown>
): Promise<FraudAlertDoc | null> {
    await connectToDatabase();
    return FraudAlertModel.findByIdAndUpdate(id, { $set: update }, { new: true })
        .lean<FraudAlertDoc>()
        .exec();
}
