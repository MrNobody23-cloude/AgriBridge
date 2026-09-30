import mongoose from 'mongoose';

/**
 * MongoDB connection.
 *
 * Replaces the Prisma client, which was declared against PostgreSQL while the
 * only data that has ever existed sat in a stale SQLite file. There is now
 * exactly one database and it is MongoDB.
 *
 * Two things this has to get right, because they are what break a free-tier
 * deployment:
 *
 *  - **Atlas M0 allows 5 concurrent connections, total.** Not per app, not per
 *    instance — five. A serverless host spins up a fresh function per request,
 *    so an uncached client per request exhausts the limit within a few
 *    concurrent visitors and the app stops working with
 *    `MongoServerError: too many connections`. The connection is therefore
 *    cached on `global` (the same trick the Prisma singleton used, for the
 *    same reason: `next dev` re-evaluates modules on every hot reload) and the
 *    pool is capped at 1 client, so N functions share the same few sockets
 *    rather than each opening their own.
 *
 *  - **Never connect at import time.** Importing a route must not open a
 *    socket, or a build or a test that merely imports the module hangs waiting
 *    for a database that isn't there. `connect()` is called lazily by the
 *    repositories, and it is safe to call concurrently — the in-flight promise
 *    is cached, so ten requests racing on a cold start produce one connection.
 */

interface MongooseCache {
    conn: typeof mongoose | null;
    promise: Promise<typeof mongoose> | null;
}

const globalForMongoose = global as unknown as {
    __agribridgeMongoose?: MongooseCache;
};

const cache: MongooseCache =
    globalForMongoose.__agribridgeMongoose ?? { conn: null, promise: null };

if (process.env.NODE_ENV !== 'production') {
    globalForMongoose.__agribridgeMongoose = cache;
}

export function getMongoUri(): string | undefined {
    return process.env.MONGODB_URI;
}

export function isDatabaseConfigured(): boolean {
    const uri = getMongoUri();
    return Boolean(uri && uri.trim() !== '');
}

/**
 * The reason the database is unusable, phrased for /api/health.
 *
 * A missing URI is a configuration fact, not a crash, and the health endpoint
 * reports it as `not_configured` rather than as a failing service — the same
 * treatment unconfigured services already get elsewhere.
 */
export function databaseConfiguration(): { configured: boolean; reason: string | null } {
    if (isDatabaseConfigured()) return { configured: true, reason: null };
    return {
        configured: false,
        reason:
            'DATABASE_NOT_CONFIGURED: MONGODB_URI is not set. ' +
            'Set it to a mongodb:// or mongodb+srv:// URI — either a local mongod ' +
            'or a MongoDB Atlas free cluster — and the application will connect on first use.',
    };
}

/**
 * Connect once, memoised.
 *
 * The in-flight promise is cached rather than only the resolved connection, so
 * that concurrent callers on a cold start share one attempt instead of each
 * opening their own. A rejected attempt is cleared, so a transient network
 * failure does not poison the process for the rest of its life.
 */
export async function connectToDatabase(): Promise<typeof mongoose> {
    if (cache.conn && mongoose.connection.readyState === 1) {
        return cache.conn;
    }

    const uri = getMongoUri();

    if (!isDatabaseConfigured() || !uri) {
        throw new Error(
            'MONGODB_URI is not set. Point it at a local mongod or a MongoDB Atlas cluster.'
        );
    }

    if (!cache.promise) {
        cache.promise = mongoose
            .connect(uri, {
                // One client per process. On Atlas M0 the connection limit is
                // shared by every instance of the app, so each instance
                // taking a small share is the only thing that works.
                maxPoolSize: 1,
                // A pooled socket held open costs one of those five slots even
                // while idle. Fail fast instead, so a request that arrives
                // between requests doesn't wait a minute to be told no.
                serverSelectionTimeoutMS: 5000,
                // Fail a write rather than write it and find out later. The
                // batch-code and certificate writes are correctness-relevant.
                bufferCommands: false,
            })
            .then((m) => m)
            .catch((err) => {
                cache.promise = null;
                throw err;
            });
    }

    cache.conn = await cache.promise;
    return cache.conn;
}

/** Close the connection. Used by scripts; never by a request handler. */
export async function disconnectFromDatabase(): Promise<void> {
    cache.promise = null;
    cache.conn = null;
    await mongoose.disconnect().catch(() => undefined);
}

/**
 * Ping the server. Backs GET /api/health/database.
 *
 * `admin().command({ ping: 1 })` is the MongoDB equivalent of Prisma's
 * `$queryRaw\`SELECT 1\``: it proves the server is reachable and answering,
 * without reading application data.
 */
export async function pingDatabase(): Promise<{ ok: boolean; reason: string | null }> {
    if (!isDatabaseConfigured()) {
        return { ok: false, reason: databaseConfiguration().reason };
    }
    try {
        await connectToDatabase();
        const db = mongoose.connection.db;
        if (!db) {
            return { ok: false, reason: 'DATABASE_NOT_CONNECTED: no active connection handle.' };
        }
        await db.admin().command({ ping: 1 });
        return { ok: true, reason: null };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, reason: `DATABASE_UNREACHABLE: ${message}` };
    }
}
