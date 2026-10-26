import { getFullSessionUser } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/response';

export async function GET() {
    const user = await getFullSessionUser();
    if (!user) {
        return errorResponse('Unauthorized', 'UNAUTHORIZED', 401);
    }
    if (!['FARMER', 'TRANSPORTER', 'RETAILER', 'CONSUMER', 'ADMIN'].includes(user.role)) {
        return errorResponse('This account role is no longer supported. Contact an administrator to migrate the account.', 'ROLE_RETIRED', 403);
    }

    // `getFullSessionUser` already excludes `password` in its query, so there
    // is nothing to strip here. The destructure that used to do it also would
    // not have compiled into a rejection if the field were ever renamed — the
    // protection is at the read now.
    return successResponse(user);
}
