import { NextRequest } from 'next/server';
import { findAllUsers } from '@/lib/db/repositories/users';
import { requirePermission } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/response';

export async function GET(req: NextRequest) {
    // Only ADMINs can list all users
    const authResult = await requirePermission(req, 'users:manage');
    if (authResult instanceof Response) return authResult;

    try {
        // The Prisma `select` listed six fields and, crucially, omitted
        // `password`. The repository returns whole documents, so the projection
        // is applied here instead — sending the bcrypt hash to an admin list
        // endpoint would be a change in what leaves the server, not just in
        // shape. The field name stays `id` because that is what the table
        // renders.
        const all = await findAllUsers();
        const users = all.slice(0, 200).map((u) => ({
            id: u._id,
            name: u.name,
            email: u.email,
            role: u.role,
            createdAt: u.createdAt,
            phone: u.phone,
        }));

        return successResponse(users);
    } catch (err) {
        console.error('Admin user list error:', err);
        return errorResponse('Failed to list users', 'SERVER_ERROR', 500);
    }
}
