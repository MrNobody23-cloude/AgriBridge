import { prisma } from '@/lib/prisma';

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

        await prisma.auditLog.create({
            data: {
                userId:     input.userId,
                action:     input.action,
                resource:   input.resource,
                resourceId: input.resourceId,
                metadata,
                ipAddress:  input.ipAddress,
                userAgent:  input.userAgent,
            },
        });
    } catch (error) {
        console.error('[AuditLog] Failed to write audit log:', error);
    }
}
