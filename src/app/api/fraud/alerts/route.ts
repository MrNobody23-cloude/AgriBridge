import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/response';

export async function GET(req: NextRequest) {
    const authResult = await requirePermission(req, 'fraud:view');
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    try {
        const { searchParams } = new URL(req.url);
        const status = searchParams.get('status');

        const where: any = {};
        if (status) where.status = status;

        // Exporters/importers only see alerts tied to their own shipments;
        // regulators and admins see everything.
        if (user.role === 'EXPORTER') {
            where.shipment = { exporterId: user.id };
        } else if (user.role === 'IMPORTER') {
            where.shipment = { is: {} }; // importers see shipment-linked alerts
        }

        const alerts = await prisma.fraudAlert.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            include: {
                batch: { include: { product: true, farmer: true } },
                shipment: true,
            },
        });

        return successResponse(alerts);
    } catch (error: any) {
        console.error('Error fetching fraud alerts:', error);
        return errorResponse('Failed to fetch fraud alerts', 'SERVER_ERROR', 500);
    }
}
