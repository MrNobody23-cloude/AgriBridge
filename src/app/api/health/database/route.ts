import { databaseConfiguration, pingDatabase } from '@/lib/db/connection';
import { successResponse, errorResponse } from '@/lib/response';

export async function GET() {
    const start = Date.now();
    const config = databaseConfiguration();

    // No URI at all is a different condition from a URI that will not connect.
    // 503 says "the database is down"; this one says "nothing was ever
    // configured", and reporting it as an outage sends someone looking for a
    // server that does not exist.
    if (!config.configured) {
        return errorResponse(config.reason ?? 'MONGODB_URI is not set.', 'DB_NOT_CONFIGURED', 503);
    }

    const ping = await pingDatabase();
    if (!ping.ok) {
        return errorResponse('Database connection failed: ' + ping.reason, 'DB_ERROR', 503);
    }

    // Read from the connection string rather than a literal. This was a
    // hardcoded 'postgresql', which happened to match the schema and would
    // have kept claiming postgres to a health check that reached some other
    // database. Nothing here reports the host or the credentials — the scheme
    // is the only part that identifies a driver, and it is not sensitive.
    const scheme = (process.env.MONGODB_URI || '').split(':')[0] || 'unknown';
    return successResponse({ status: 'healthy', latencyMs: Date.now() - start, provider: scheme });
}
