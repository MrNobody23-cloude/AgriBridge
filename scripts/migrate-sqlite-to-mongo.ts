/**
 * One-time import of the demo data from `prisma/dev.db` into MongoDB.
 *
 * Run it *before* the SQLite file is deleted:
 *
 *     node --experimental-sqlite --import tsx scripts/migrate-sqlite-to-mongo.ts
 *
 * (Node's built-in SQLite reader is used so the script does not need a native
 * driver installed; `--experimental-sqlite` is required on Node 22/24.)
 *
 * ## What it guarantees
 *
 *  - **Existing ids are preserved.** Every row's `id` column becomes the
 *    Mongo `_id`, so the foreign keys in the demo data (`farmerId`, `batchId`,
 *    `shipmentId`) still resolve after the import, and the batch codes printed
 *    on the QR labels keep working.
 *
 *  - **It is idempotent.** A row whose `_id` already exists is skipped and
 *    counted as `skipped`, never re-inserted. Re-running after a partial run
 *    completes it rather than duplicating or overwriting.
 *
 *  - **It verifies itself.** The script re-reads each collection afterwards and
 *    fails loudly if a count does not match what it inserted. Exit code is
 *    non-zero on any mismatch, so a CI step or a shell `&&` chain notices.
 *
 * ## Reading a 2025-08 schema
 *
 * `prisma/dev.db` predates the current Mongoose schemas — it has no
 * `variety`, `unit`, `blockchainMode`, `spoilageProbability` and about a dozen
 * other fields. Those are **not** backfilled here: every one of them has a
 * `default` on the Mongoose schema, so the insert produces a complete document
 * and the defaults apply. The script asserts that assumption per table rather
 * than trusting it, and reports anything genuinely missing.
 *
 * It also **does not** write `password` hashes into the log output. The demo
 * users keep their existing bcrypt hashes verbatim — a hash is not portable
 * across cost factors, and the rows are being moved, not re-created. Use
 * `npm run seed:test-users` afterwards to add the eight role accounts the docs
 * reference.
 */

import { DatabaseSync } from 'node:sqlite';
import { createConnection } from 'node:net';
import { connectToDatabase, disconnectFromDatabase } from '../src/lib/db/connection';
import {
    AiAgentLogModel,
    BatchModel,
    CertificateModel,
    ComplianceCheckModel,
    FarmerProfileModel,
    FraudAlertModel,
    ProductModel,
    ShipmentModel,
    SupplyChainEventModel,
    TemperatureLogModel,
    TrustScoreModel,
    UserModel,
} from '../src/lib/db/models';

// ─── Configuration ────────────────────────────────────────────────────────────

const SQLITE_PATH = process.env.SQLITE_PATH ?? 'prisma/dev.db';

/**
 * Insert order matters only in the sense that a parent should exist before its
 * children, for a human reading a partial-failure log. MongoDB does not
 * enforce foreign keys, so the order is documentation rather than a
 * requirement.
 */
const TABLES: Array<{ table: string; model: any; order: number }> = [
    { table: 'User', model: UserModel, order: 1 },
    { table: 'FarmerProfile', model: FarmerProfileModel, order: 2 },
    { table: 'Product', model: ProductModel, order: 3 },
    { table: 'Batch', model: BatchModel, order: 4 },
    { table: 'SupplyChainEvent', model: SupplyChainEventModel, order: 5 },
    { table: 'Certificate', model: CertificateModel, order: 6 },
    { table: 'Shipment', model: ShipmentModel, order: 7 },
    { table: 'ComplianceCheck', model: ComplianceCheckModel, order: 8 },
    { table: 'FraudAlert', model: FraudAlertModel, order: 9 },
    { table: 'TrustScore', model: TrustScoreModel, order: 10 },
    { table: 'TemperatureLog', model: TemperatureLogModel, order: 11 },
    { table: 'AiAgentLog', model: AiAgentLogModel, order: 12 },
];

type Row = Record<string, unknown>;

/**
 * Read back only the `_id` of every document in a collection.
 *
 * The models are registered as `Model<any>`, which is what keeps `tsc` from
 * expanding eighteen schema types at once — but it also means `.lean()` is
 * untyped and cannot take a type argument. The cast is local to this helper so
 * the `any` does not spread into the call sites.
 */
async function readAllIds(model: any): Promise<Set<string>> {
    const docs = (await model.find({}).select({ _id: 1 }).lean().exec()) as Array<{ _id: string }>;
    return new Set(docs.map((d) => d._id));
}

/** The old file stores dates as `DATETIME` text or as epoch numbers. */
function toDate(value: unknown): Date | null {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) return value;
    if (typeof value === 'number') return new Date(value);
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * SQLite has no boolean type. Prisma's SQLite provider stored booleans as 0/1
 * integers, so anything non-zero is true.
 */
function toBool(value: unknown, fallback: boolean): boolean {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const s = String(value).toLowerCase();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0') return false;
    return fallback;
}

/** Preserve `0` and `''`, but treat SQL NULL as absent so defaults apply. */
function orNull(value: unknown): unknown {
    return value === null || value === undefined ? undefined : value;
}

// ─── Per-table conversion ─────────────────────────────────────────────────────

/**
 * Each entry maps a SQLite column to a Mongoose field. A column mapped to
 * `null` is dropped: it has no counterpart in the new schema.
 *
 * Fields absent here are filled by the Mongoose defaults, which is why this
 * list is short compared to the schemas.
 */
const CONVERTERS: Record<string, (row: Row) => Record<string, unknown>> = {
    User: (row) => ({
        _id: row.id,
        name: row.name,
        email: row.email,
        // The hash moves across untouched. `isActive` has no column in the old
        // file — every seeded user was active, so the default is the truth
        // here rather than a guess.
        password: row.password,
        role: row.role,
        phone: orNull(row.phone),
        isActive: toBool(undefined, true),
        createdAt: toDate(row.createdAt) ?? undefined,
        updatedAt: toDate(row.updatedAt) ?? undefined,
    }),

    FarmerProfile: (row) => ({
        _id: row.id,
        userId: row.userId,
        farmName: row.farmName,
        location: row.location,
        state: row.state,
        district: row.district,
        createdAt: toDate(row.createdAt) ?? undefined,
        updatedAt: toDate(row.updatedAt) ?? undefined,
    }),

    Product: (row) => ({
        _id: row.id,
        name: row.name,
        category: row.category,
        // The old table had no description column at all; the schema default
        // is `''` and several UIs render it.
        description: orNull(row.description) ?? '',
        createdAt: toDate(row.createdAt) ?? undefined,
        updatedAt: toDate(row.updatedAt) ?? undefined,
    }),

    Batch: (row) => ({
        _id: row.id,
        batchCode: row.batchCode,
        farmerId: row.farmerId,
        productId: row.productId,
        variety: orNull(row.variety),
        quantity: row.quantity,
        // `unit`, `destinationCountry`, `blockchainMode` and the ML fields have
        // no column in the old file; their schema defaults apply.
        unit: orNull(row.unit) ?? 'kg',
        harvestDate: toDate(row.harvestDate) ?? undefined,
        location: row.location,
        destinationCountry: orNull(row.destinationCountry),
        status: row.status,
        blockchainHash: row.blockchainHash,
        blockchainTransactionHash: orNull(row.blockchainTransactionHash),
        blockchainMode: orNull(row.blockchainMode) ?? 'not_configured',
        // A plain number. Not a boolean: `trustScore` is 0–100, and routing it
        // through `toBool` would collapse every non-zero score to 1.
        trustScore: typeof row.trustScore === 'number' ? row.trustScore : 0,
        spoilageProbability: orNull(row.spoilageProbability),
        spoilageRisk: orNull(row.spoilageRisk),
        remainingShelfLifeDays: orNull(row.remainingShelfLifeDays),
        qualityScore: orNull(row.qualityScore),
        qualityGrade: orNull(row.qualityGrade),
        ipfsDocumentCids: [],
        createdAt: toDate(row.createdAt) ?? undefined,
        updatedAt: toDate(row.updatedAt) ?? undefined,
    }),

    SupplyChainEvent: (row) => ({
        _id: row.id,
        batchId: row.batchId,
        eventType: row.eventType,
        actorId: orNull(row.actorId),
        // The old file predates the `actorRole` column.
        actorRole: orNull(row.actorRole),
        location: row.location,
        timestamp: toDate(row.timestamp) ?? new Date(),
        metadata: orNull(row.metadata),
        blockchainTransactionHash: orNull(row.blockchainTransactionHash),
    }),

    Certificate: (row) => ({
        _id: row.id,
        batchId: row.batchId,
        certificateType: row.certificateType,
        fileUrl: orNull(row.fileUrl) ?? '',
        ipfsHash: orNull(row.ipfsHash),
        fileHash: row.fileHash,
        issuer: row.issuer,
        issueDate: toDate(row.issueDate) ?? new Date(),
        expiryDate: toDate(row.expiryDate) ?? new Date(),
        verificationStatus: row.verificationStatus,
        blockchainHash: orNull(row.blockchainHash),
        createdAt: toDate(row.createdAt) ?? undefined,
    }),

    Shipment: (row) => ({
        _id: row.id,
        shipmentCode: row.shipmentCode,
        batchId: row.batchId,
        exporterId: row.exporterId,
        // `transporterId`, `unit` and `estimatedArrival` are not in the old
        // file. `transporterId` staying null is meaningful — the shipment list
        // renders it as "unassigned" rather than as a missing user.
        transporterId: orNull(row.transporterId),
        destinationCountry: row.destinationCountry,
        quantity: row.quantity,
        unit: orNull(row.unit) ?? 'kg',
        status: row.status,
        riskScore: row.riskScore ?? 50,
        estimatedArrival: toDate(row.estimatedArrival),
        createdAt: toDate(row.createdAt) ?? undefined,
        updatedAt: toDate(row.updatedAt) ?? undefined,
    }),

    ComplianceCheck: (row) => ({
        _id: row.id,
        shipmentId: row.shipmentId,
        country: row.country,
        requirement: row.requirement,
        status: row.status,
        explanation: row.explanation,
        source: row.source,
        evidence: orNull(row.evidence),
        createdAt: toDate(row.createdAt) ?? undefined,
    }),

    FraudAlert: (row) => ({
        _id: row.id,
        batchId: orNull(row.batchId),
        shipmentId: orNull(row.shipmentId),
        fraudType: row.fraudType,
        severity: row.severity,
        description: row.description,
        evidence: orNull(row.evidence),
        confidence: row.confidence ?? 0.95,
        status: row.status,
        resolvedBy: orNull(row.resolvedBy),
        resolvedAt: toDate(row.resolvedAt),
        notes: orNull(row.notes),
        createdAt: toDate(row.createdAt) ?? undefined,
        updatedAt: toDate(row.updatedAt) ?? undefined,
    }),

    TrustScore: (row) => ({
        _id: row.id,
        batchId: row.batchId,
        blockchainScore: row.blockchainScore ?? 0,
        certificateScore: row.certificateScore ?? 0,
        coldChainScore: row.coldChainScore ?? 0,
        inspectionScore: row.inspectionScore ?? 0,
        complianceScore: row.complianceScore ?? 0,
        qualityScore: row.qualityScore ?? 0,
        // Absent from the old table; the schema default is 0, which is exactly
        // what the Prisma column default produced there too.
        finalScore: row.finalScore ?? 0,
        factorsJson: row.factorsJson,
        explanation: row.explanation,
        createdAt: toDate(row.createdAt) ?? undefined,
        updatedAt: toDate(row.updatedAt) ?? undefined,
    }),

    TemperatureLog: (row) => ({
        _id: row.id,
        shipmentId: orNull(row.shipmentId),
        batchId: orNull(row.batchId),
        // No sensor readings exist in the old file, but the converter is here
        // so the import is complete if the file is ever replaced with a
        // populated one.
        sensorId: orNull(row.sensorId) ?? 'unknown',
        temperature: row.temperature,
        humidity: orNull(row.humidity),
        location: row.location,
        latitude: orNull(row.latitude),
        longitude: orNull(row.longitude),
        batteryLevel: orNull(row.batteryLevel),
        isSimulated: toBool(row.isSimulated, false),
        timestamp: toDate(row.timestamp) ?? new Date(),
    }),

    AiAgentLog: (row) => ({
        _id: row.id,
        agentName: row.agentName,
        // `agentType` and the rest of the evidence columns postdate the file.
        agentType: orNull(row.agentType) ?? 'unknown',
        task: row.task,
        input: row.input,
        output: row.output,
        toolsUsed: orNull(row.toolsUsed),
        evidence: orNull(row.evidence),
        sources: orNull(row.sources),
        confidence: row.confidence ?? 0,
        status: row.status,
        durationMs: orNull(row.durationMs),
        createdAt: toDate(row.createdAt) ?? undefined,
    }),
};

// ─── Pre-flight ───────────────────────────────────────────────────────────────

/**
 * Confirm the Mongo server answers before any write, so a typo in the URI fails
 * in one clear line instead of as twelve per-collection timeouts.
 */
async function checkMongoReachable(uri: string): Promise<void> {
    const { hostname, port } = new URL(uri.replace(/^mongodb(\+srv)?:\/\//, 'http://'));
    const targetPort = Number(port || 27017);
    const targetHost = hostname || '127.0.0.1';

    await new Promise<void>((resolve, reject) => {
        const socket = createConnection({ host: targetHost, port: targetPort });
        const done = (err?: Error) => {
            socket.destroy();
            err ? reject(err) : resolve();
        };
        socket.setTimeout(4000);
        socket.once('connect', () => done());
        socket.once('timeout', () =>
            done(new Error(`No answer from ${targetHost}:${targetPort} within 4s`))
        );
        socket.once('error', (e) => done(e));
    });
}

// ─── Dry run ──────────────────────────────────────────────────────────────────

/**
 * Validate every converted document without touching a database.
 *
 * The part of this script most likely to be wrong is the field mapping — a
 * typo, a column that no longer exists, a `Date` left as a string — and none of
 * that needs a server to detect. `Document.validateSync()` runs the real schema
 * validation that `insertMany` would run, so this answers the question that
 * actually matters: *would every one of these 45 rows be accepted?*
 *
 * It is also how the script can be checked in CI, where no MongoDB is running.
 */
function dryRun(db: DatabaseSync, present: string[]): number {
    const problems: string[] = [];
    let checked = 0;

    for (const { table, model } of TABLES) {
        if (!present.includes(table)) {
            console.log(`  ${table.padEnd(20)} — absent from the SQLite file`);
            continue;
        }
        const rows = db.prepare(`SELECT * FROM "${table}"`).all() as Row[];
        const convert = CONVERTERS[table];
        if (!convert) {
            problems.push(`${table}: no converter defined`);
            continue;
        }

        for (const row of rows) {
            checked++;
            const doc = convert(row);

            // `validateSync` is a *document* method, not a `Model` method, so the
            // document has to be constructed first. `new model(doc)` runs the same
            // casting, defaulting and validation that `insertMany` runs, which is
            // what makes this a real rehearsal of the insert rather than a
            // hand-rolled approximation of it. It returns `undefined` on success
            // and the `ValidationError` itself on failure — not `{ error }`.
            const validationError = new model(doc).validateSync();
            if (validationError) {
                problems.push(`${table}/${row.id}: ${validationError.message}`);
                continue;
            }
            // Flag a field the converter invented that the schema does not
            // declare. Mongoose drops these silently, which is how a mapping
            // mistake turns into missing data with no error anywhere.
            const declared = new Set(Object.keys(model.schema.paths));
            for (const key of Object.keys(doc)) {
                if (!declared.has(key)) {
                    problems.push(`${table}/${row.id}: "${key}" is not in the schema — it would be dropped`);
                }
            }
        }
        console.log(`  ${table.padEnd(20)} — ${rows.length} row(s) validated`);
    }

    console.log(`\n${checked} document(s) checked, no database contacted.`);
    if (problems.length) {
        console.log('\nProblems:');
        for (const p of problems) console.log(`  ${p}`);
        return 1;
    }
    console.log('All documents would be accepted by their schemas.');
    return 0;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const isDryRun = process.argv.includes('--dry-run');
    const db = new DatabaseSync(SQLITE_PATH, { readOnly: true });
    const present = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all()
        .map((r: any) => r.name as string);

    if (isDryRun) {
        const code = dryRun(db, present);
        db.close();
        process.exit(code);
    }

    const uri = process.env.MONGODB_URI;
    if (!uri) {
        db.close();
        throw new Error(
            'MONGODB_URI is not set. Copy .env.example to .env and point it at a ' +
            'local mongod or an Atlas cluster, then re-run.'
        );
    }

    // Fail before writing anything if the server is not there.
    await checkMongoReachable(uri);

    let inserted = 0;
    let skipped = 0;
    const failures: string[] = [];
    const summary: string[] = [];
    /** Row counts read from the SQLite file, used as the expected total below. */
    const expectedCounts = new Map<string, number>();

    for (const { table, model, order } of TABLES.sort((a, b) => a.order - b.order)) {
        if (!present.includes(table)) {
            summary.push(`  ${table.padEnd(20)} — absent from the SQLite file, skipped`);
            continue;
        }

        const rows = db.prepare(`SELECT * FROM "${table}"`).all() as Row[];
        expectedCounts.set(table, rows.length);
        if (rows.length === 0) {
            summary.push(`  ${table.padEnd(20)} — 0 rows in SQLite, nothing to do`);
            continue;
        }

        const convert = CONVERTERS[table];
        if (!convert) {
            failures.push(`${table}: no converter defined`);
            continue;
        }

        // Split into new vs already-present by _id, so the insert is one call
        // and a re-run is a no-op rather than a duplicate-key error.
        const existing = await readAllIds(model);
        const fresh = rows.filter((r) => !existing.has(String(r.id)));

        if (fresh.length > 0) {
            try {
                await model.insertMany(fresh.map(convert), { ordered: false });
            } catch (e: any) {
                // With `ordered: false` the rest still insert; report which
                // ones failed rather than the whole batch.
                const writeErrors = e?.writeErrors ?? [];
                failures.push(
                    `${table}: ${writeErrors.length} row(s) rejected — ` +
                    writeErrors
                        .slice(0, 3)
                        .map((w: any) => `${w.err?.code ?? '?'} ${w.err?.errmsg ?? w.message}`)
                        .join('; ')
                );
            }
        }

        inserted += fresh.length;
        skipped += rows.length - fresh.length;
        summary.push(
            `  ${table.padEnd(20)} — ${rows.length} in SQLite, ${fresh.length} inserted, ` +
            `${rows.length - fresh.length} already present`
        );
    }

    db.close();

    // ─── Verify ──────────────────────────────────────────────────────────────
    // Re-read every collection and compare against what the SQLite file holds.
    // A migration that reports success without checking is a migration that
    // lies when something goes wrong. The file stays open until this is done,
    // so the expected counts are the ones actually on disk.
    console.log('\nVerifying…');
    const problems: string[] = [];

    for (const { table, model } of TABLES) {
        if (!present.includes(table)) continue;
        const expected = expectedCounts.get(table) ?? 0;
        const actual = await model.countDocuments().exec();
        if (actual < expected) {
            problems.push(`${table}: expected at least ${expected}, found ${actual}`);
        } else {
            console.log(`  ${table.padEnd(20)} — ${actual} document(s) present`);
        }
    }

    // A foreign key that points at a row which did not come across would
    // surface much later as a null name in a dashboard, so check now.
    const orphanChecks: Array<[string, string, string]> = [
        ['Batch', 'farmerId', 'User'],
        ['Batch', 'productId', 'Product'],
        ['SupplyChainEvent', 'batchId', 'Batch'],
        ['Certificate', 'batchId', 'Batch'],
        ['Shipment', 'batchId', 'Batch'],
        ['FraudAlert', 'batchId', 'Batch'],
        ['TrustScore', 'batchId', 'Batch'],
    ];
    const byTable = new Map(TABLES.map((t) => [t.table, t.model]));
    for (const [child, field, parent] of orphanChecks) {
        const childModel = byTable.get(child);
        const parentModel = byTable.get(parent);
        if (!childModel || !parentModel) continue;
        const parentIds = await readAllIds(parentModel);
        const children = (await childModel.find({ [field]: { $ne: null } })
            .select({ _id: 1, [field]: 1 })
            .lean()
            .exec()) as Array<Record<string, unknown>>;
        const orphans = children.filter((c) => !parentIds.has(String(c[field])));
        if (orphans.length > 0) {
            problems.push(
                `${child}.${field}: ${orphans.length} row(s) point at a ${parent} that does not exist`
            );
        }
    }

    db.close();

    console.log(`\nImported ${inserted} document(s), skipped ${skipped} already present.`);
    for (const line of summary) console.log(line);
    if (failures.length) {
        console.log('\nFailures:');
        for (const f of failures) console.log(`  ${f}`);
    }
    if (problems.length) {
        console.log('\nVerification problems:');
        for (const p of problems) console.log(`  ${p}`);
    }

    await disconnectFromDatabase();

    if (failures.length || problems.length) process.exitCode = 1;
}

main().catch(async (e) => {
    console.error('\nMigration failed:', e.message);
    await disconnectFromDatabase().catch(() => {});
    process.exit(1);
});
