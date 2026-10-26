import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { connectToDatabase } from '@/lib/db/connection';
import { BatchModel, MarketplaceOfferModel, ProductModel, UserModel } from '@/lib/db/models';
import { successResponse, errorResponse } from '@/lib/response';

/* eslint-disable @typescript-eslint/no-explicit-any -- compact joined records use the shared Mongoose model registry. */

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, ['FARMER', 'RETAILER', 'TRANSPORTER']);
  if (auth instanceof Response) return auth;
  try {
    await connectToDatabase();
    let query: Record<string, unknown>;
    if (auth.user.role === 'TRANSPORTER') query = { acceptedBy: auth.user.id, status: { $in: ['ACCEPTED', 'PICKUP_OTP_PENDING', 'IN_TRANSIT', 'DELIVERY_OTP_PENDING', 'DELIVERED'] } };
    else if (auth.user.role === 'RETAILER') query = { retailerId: auth.user.id, status: { $in: ['ACCEPTED', 'PICKUP_OTP_PENDING', 'IN_TRANSIT', 'DELIVERY_OTP_PENDING', 'DELIVERED'] } };
    else {
      const batches = await BatchModel.find({ farmerId: auth.user.id }).select({ _id: 1 }).lean<Array<{ _id: string }>>();
      query = { batchId: { $in: batches.map((batch) => batch._id) }, status: { $in: ['ACCEPTED', 'PICKUP_OTP_PENDING', 'IN_TRANSIT', 'DELIVERY_OTP_PENDING', 'DELIVERED'] } };
    }
    const orders = await MarketplaceOfferModel.find(query).sort({ updatedAt: -1 }).limit(100).lean<Record<string, any>[]>();
    const batches = await BatchModel.find({ _id: { $in: [...new Set(orders.map((order) => order.batchId))] } }).lean<Record<string, any>[]>();
    const [users, products] = await Promise.all([
      UserModel.find({ _id: { $in: [...new Set(orders.map((order) => order.retailerId))] } }).select({ password: 0 }).lean<Record<string, any>[]>(),
      ProductModel.find({ _id: { $in: [...new Set(batches.map((batch) => batch.productId))] } }).lean<Record<string, any>[]>(),
    ]);
    const batchMap = new Map(batches.map((batch) => [batch._id, batch]));
    const userMap = new Map(users.map((user) => [user._id, user]));
    const productMap = new Map(products.map((product) => [product._id, product]));
    const enriched = orders.map((order) => {
      const batch = batchMap.get(order.batchId);
      const retailer = userMap.get(order.retailerId);
      return { _id: order._id, status: order.status, batchId: order.batchId, batchCode: batch?.batchCode || '', crop: batch ? productMap.get(batch.productId)?.name || 'Crop' : 'Crop', quantity: batch?.quantity, unit: batch?.unit, harvestDate: batch?.actualHarvestDate || batch?.harvestDate, farmLocation: batch?.location, farmerId: batch?.farmerId, retailerId: order.retailerId, retailerName: retailer?.name || 'Retailer', retailerPhone: retailer?.phone || '', retailerLocation: order.retailerLocation || retailer?.shopLocation || '', retailerLatitude: order.latitude ?? retailer?.latitude ?? null, retailerLongitude: order.longitude ?? retailer?.longitude ?? null, transporterLatitude: order.transporterLatitude ?? null, transporterLongitude: order.transporterLongitude ?? null, lastLocationAt: order.lastLocationAt ?? null, pricePerUnit: order.pricePerUnit, commissionAmount: order.commissionAmount, farmerPayoutAmount: order.farmerPayoutAmount, pickupVerifiedAt: order.pickupVerifiedAt, deliveredAt: order.deliveredAt };
    });
    return successResponse(enriched);
  } catch (error) {
    console.error('Marketplace order list error:', error);
    return errorResponse('Unable to load delivery orders.', 'SERVER_ERROR', 500);
  }
}
