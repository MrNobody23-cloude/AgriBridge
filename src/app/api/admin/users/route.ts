import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/response';

export async function GET(req: NextRequest) {
    // Only ADMINs can list all users
    const authResult = await requirePermission(req, 'users:manage');
    if (authResult instanceof Response) return authResult;

    try {
        const users = await prisma.user.findMany({
            orderBy: { createdAt: 'desc' },
            take: 200,
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                createdAt: true,
                phone: true,
            }
        });

        return successResponse(users);
    } catch (err) {
        console.error('Admin user list error:', err);
        return errorResponse('Failed to list users', 'SERVER_ERROR', 500);
    }
}
