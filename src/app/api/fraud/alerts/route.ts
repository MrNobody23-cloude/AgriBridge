import { NextRequest } from 'next/server';
import { listFraudAlerts } from '@/lib/db/repositories/shipments';
import { requirePermission } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/response';

export async function GET(req: NextRequest) {
    const authResult = await requirePermission(req, 'fraud:view');
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    try {
        const { searchParams } = new URL(req.url);
        const status = searchParams.get('status') ?? undefined;
        const severity = searchParams.get('severity') ?? undefined;
        const limit = Math.min(parseInt(searchParams.get('limit') || '200'), 500);
        const offset = Math.max(parseInt(searchParams.get('offset') || '0'), 0);

        // The role scoping this route used to build by hand now lives in the
        // repository, next to the `$in` resolution that makes it work without
        // joins. FARMER is included there: a farmer who grows the batch is
        // directly implicated in its alert, and leaving them out was an
        // oversight in the Prisma version, not a policy.
        const { alerts, total } = await listFraudAlerts({
            status,
            severity,
            limit,
            offset,
            role: user.role,
            userId: user.id,
        });

        // The response is the alert array itself, as it was under Prisma — the
        // regulator dashboard maps over it directly. The count rides in a
        // header rather than the body, because a body of `{alerts, total}` is a
        // shape the existing client does not know how to read.
        const response = successResponse(alerts);
        response.headers.set('X-Total-Count', String(total));
        return response;
    } catch (error: unknown) {
        console.error('Error fetching fraud alerts:', error);
        return errorResponse('Failed to fetch fraud alerts', 'SERVER_ERROR', 500);
    }
}
