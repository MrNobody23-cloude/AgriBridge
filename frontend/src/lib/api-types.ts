/**
 * The shapes the API actually returns, for the code that consumes them.
 *
 * ## Why this is hand-written and not inferred
 *
 * Every dashboard page fetched JSON with `useState<any>(null)` and then read
 * fields off it, which meant a renamed field or a dropped key was a runtime
 * `undefined` and a blank panel — never a type error. These interfaces are
 * the contract, written from the route handlers that produce the payloads.
 *
 * They live here rather than next to the route handlers for the same reason
 * `SessionUser` does: the pages are `'use client'`, and a type-only import is
 * erased at build time, so this module must not pull in anything server-side.
 *
 * ## Every field that is not in the route's `select`
 *
 * The repository queries project specific columns. A field listed here that a
 * query does not select will be `undefined` at runtime, so each one is either
 * read from a query that does select it, or marked optional below.
 */

/** A product, as it appears nested inside a batch. */
export interface ApiProduct {
    _id?: string;
    id?: string;
    name: string;
    variety?: string | null;
    category?: string | null;
}

/** What `/api/batches` returns per row. */
export interface ApiBatch {
    _id: string;
    batchCode: string;
    productId?: string;
    product?: ApiProduct | null;
    variety?: string | null;
    /** Numeric kilograms. The farmer page aggregates on this. */
    quantity: number;
    unit?: string | null;
    sowingDate?: string | null;
    harvestDate: string;
    actualHarvestDate?: string | null;
    harvestStage?: string | null;
    destinationCountry?: string | null;
    location?: string | null;
    trustScore?: number | null;
    status: BatchStatus;
    fraudFlag?: string | null;
    /** The digest written to the chain. `null` until a contract is configured. */
    blockchainHash?: string | null;
    blockchainTransactionHash?: string | null;
    createdAt?: string;
}

/**
 * The batch lifecycle, as written by the code.
 *
 * `Registered` is what `POST /api/batches` sets, `In Transit` and `Flagged`
 * are set by the shipment and fraud paths, and `Exported`/`Delivered` are what
 * the shipped demo rows contain. `Processing` is display-only and has no writer
 * — it is kept because `BatchTable` accepts it and removing it would be a
 * rendering decision, not a type fix.
 *
 * `BatchTable`'s union was missing `Registered`, so a freshly registered batch
 * was assigned to a badge colour that matched nothing and fell through to the
 * default grey.
 */
export type BatchStatus =
    | 'Registered'
    | 'Processing'
    | 'Exported'
    | 'In Transit'
    | 'Delivered'
    | 'Flagged';

/** A farmer, reduced to what is public. */
export interface ApiFarmer {
    name?: string;
    email?: string;
    farmerProfile?: {
        farmName?: string;
        location?: string;
        state?: string;
        district?: string;
    } | null;
}

/** A blockchain verification result attached to a batch. */
export interface ApiChainVerification {
    verified?: boolean;
    status: string;
    blockchainHash?: string | null;
    transactionHash?: string | null;
    blockNumber?: number | null;
    mode: 'real' | 'mock' | 'none';
    reason?: string | null;
    explanation?: string;
}

/** One entry in a batch's supply-chain history. */
export interface ApiEvent {
    _id: string;
    eventType: string;
    location?: string | null;
    timestamp: string;
    notes?: string | null;
    actorRole?: string | null;
    metadata?: string | null;
    blockchainTransactionHash?: string | null;
    actor?: { name?: string; role?: string } | null;
}

/** A stored trust score, as `trustScoreDetails` in the batch detail. */
export interface ApiTrustScore {
    batchId?: string;
    finalScore?: number | null;
    plainAi?: string | null;
    componentScores?: unknown;
    factors?: unknown;
    createdAt?: string;
    updatedAt?: string;
}

/**
 * The `/api/batches/[id]` payload.
 *
 * **The batch is flat, not nested.** Three pages used to read
 * `data.batch.batchCode` and destructure `const { batch, trustDetails } = data`,
 * which does not exist on this response — the repository returns
 * `{ ...batch, product, farmer, certificates, events, … }`. Every one of those
 * reads was `undefined` at runtime, so the consumer verification page rendered
 * a blank panel and the gauge fell back to `0` for a batch that had a real
 * score. The types below make that unrepresentable.
 *
 * The two renamed keys, which the pages now use:
 *  - `chainVerification` — not `blockchainVerification`
 *  - `trustScoreDetails` — not `trustDetails`
 */
export interface ApiBatchDetail extends ApiBatch {
    chainVerification?: ApiChainVerification;
    trustScoreDetails?: ApiTrustScore | null;
    events?: ApiEvent[];
    certificates?: unknown[];
    temperatureLogs?: unknown[];
    shipments?: unknown[];
    fraudAlerts?: ApiFraudAlert[];
    farmer?: ApiFarmer | null;
}

/**
 * A shipment, as `/api/shipments` returns it.
 *
 * `listShipmentsForUser` returns `ShipmentWithRelations`, which nests the batch
 * (with its product and farmer) and the exporter, and attaches
 * `complianceChecks` and `fraudAlerts`. `riskScore` is a real column on the
 * shipment document, written at creation — it is not derived here.
 *
 * `batch` is nullable for the same reason `farmer` is on `ApiBatchDetail`: the
 * batch row can be absent.
 */
export interface ApiShipment {
    _id: string;
    shipmentCode: string;
    batchId?: string;
    destinationCountry?: string;
    quantity?: number;
    unit?: string;
    status?: string;
    riskScore?: number;
    estimatedArrival?: string | null;
    createdAt?: string;
    exporter?: { _id?: string; name?: string; email?: string } | null;
    batch?: (ApiBatch & {
        product?: ApiProduct | null;
        farmer?: ApiFarmer | null;
    }) | null;
    complianceChecks?: ApiComplianceCheck[];
    fraudAlerts?: ApiFraudAlert[];
}

/**
 * A stored compliance check, as `/api/compliance/check` and the shipment
 * relation both return it.
 *
 * There is no `complianceStatus` or `screenedAt` on a shipment — the exporter
 * dashboard's two stat tiles filtered on both, and both fields exist on neither
 * `ShipmentDoc` nor `ComplianceCheckDoc`, so each tile read a permanent `0`.
 * A shipment's screening state is `complianceChecks[].status`, and "was it
 * screened at all" is `complianceChecks.length > 0`. That is what the tiles
 * count now.
 */
export interface ApiComplianceCheck {
    _id?: string;
    country: string;
    requirement: string;
    status: string;
    explanation?: string;
    source?: string;
    evidence?: unknown;
    createdAt?: string;
}

/** A retrieval source from the RAG service. */
export interface ApiSource {
    source?: string;
    title?: string;
    content?: string;
    score?: number;
}

/** The `/api/compliance/check` response body. */
export interface ApiComplianceResult {
    country?: string;
    passed?: boolean;
    checks?: ApiComplianceCheck[];
    summary?: string;
    /**
     * **The service returns two different shapes here, so this is a union.**
     *
     * `ai-service/rag/pipeline.py` builds `sources` as a bare `string[]` on
     * the retrieval path (line 210) and as a list of `{ title, source }`
     * objects on the two citation paths (lines 250 and 260). Typing it
     * `ApiSource[]` let a string through as `undefined` at the consumer, so the
     * importer page rendered `[object Object]` for one path and nothing for the
     * other. Callers must narrow with `typeof src === 'string'`.
     */
    sources?: (string | ApiSource)[];
    confidence?: number;
    warning?: string;
}

/**
 * A fraud alert, as `/api/fraud/alerts` returns it.
 *
 * `listFraudAlerts` returns bare `FraudAlertDoc` rows — **no `batch` is
 * attached**. The regulator page rendered `alert.batch.batchCode` behind an
 * `alert.batch &&` guard, so nothing crashed, but the batch code was never
 * shown: the guard was permanently false. `batchId` is the only batch
 * reference on the wire, which is why it is the field offered here.
 */
export interface ApiFraudAlert {
    _id: string;
    batchId?: string | null;
    shipmentId?: string | null;
    fraudType?: string;
    severity?: string;
    status?: string;
    description?: string;
    evidence?: string | null;
    /** 0–1. How strongly the detecting rule fired, not a calibrated probability. */
    confidence?: number;
    resolvedBy?: string | null;
    resolvedAt?: string | null;
    notes?: string | null;
    createdAt?: string;
}

/** The four risk bands, matching `RISK_LABELS` in `ai-service/ml/inference.py`. */
export type SpoilageRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** The inner `prediction` block the Python service returns. */
export interface ApiSpoilagePrediction {
    risk?: SpoilageRisk;
    riskCode?: number;
    probability?: number;
    probabilities?: Partial<Record<SpoilageRisk, number>>;
    estimatedRemainingDays?: number;
    recommendation?: string;
}

/**
 * The `/api/ml/spoilage` payload — **nested, not flat**.
 *
 * That route does `successResponse({ ...mlResult, batchId, batchCode })` where
 * `mlResult` is the XGBoost service's own body, so the risk level and the
 * remaining-days figure sit under `prediction`, not at the top level.
 *
 * The retailer page used to read six flat keys — `remainingShelfLifeDays`,
 * `remainingDays`, `riskLevel`, `spoilageRisk`, `recommendation` and a top-level
 * `qualityScore` — and **none of them exist on this response**. Every one
 * resolved to `undefined`, so a successful prediction rendered as: no risk
 * badge, `NaN days`, and no recommendation. Those names are the *column* names
 * the route writes back onto the batch document, not keys of the response;
 * reading them here is what produced the blank panel. The flat aliases that
 * made the page typecheck once were a guess, and the page now reads the real
 * nested shape instead.
 */
export interface ApiSpoilageResult {
    prediction?: ApiSpoilagePrediction;
    explanation?: {
        summary?: string;
        top_features?: unknown[];
        methodology?: string;
    };
    model?: { name?: string; version?: string; datasetType?: string };
    batchId?: string;
    batchCode?: string;
    computedAt?: string;
}

/** The `/api/auth/me` payload, as the dashboards read it. */
export type { SessionUser } from './session';
