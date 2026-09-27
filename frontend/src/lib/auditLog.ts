import { writeAuditLog } from '@/lib/db/repositories/batches';

interface AuditLogInput {
    userId?: string;
    action: string;
    resource: string;
    resourceId?: string;
    /** Free-form details — serialised to JSON string for the DB metadata column. */
    details?: Record<string, unknown>;
    metadata?: string;
    ipAddress?: string;
    userAgent?: string;
}

/**
 * Create an immutable audit log entry.
 * Never throws — audit failures must not break business logic.
 */
export async function createAuditLog(input: AuditLogInput): Promise<void> {
    try {
        const metadata = input.metadata
            ?? (input.details ? JSON.stringify(input.details) : undefined);

        await writeAuditLog({
            userId:     input.userId ?? null,
            action:     input.action,
            resource:   input.resource,
            resourceId: input.resourceId ?? null,
            metadata:   metadata ?? null,
            ipAddress:  input.ipAddress ?? null,
            userAgent:  input.userAgent ?? null,
        });
    } catch (error) {
        console.error('[AuditLog] Failed to write audit log:', error);
    }
}
