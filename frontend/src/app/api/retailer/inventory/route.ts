import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { connectToDatabase } from '@/lib/db/connection';
import { BatchModel, ProductModel, RetailerInventoryModel } from '@/lib/db/models';
import { successResponse, errorResponse } from '@/lib/response';

/* eslint-disable @typescript-eslint/no-explicit-any -- this route joins compact projections from the shared Mongoose model registry. */

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, ['RETAILER']);
  if (auth instanceof Response) return auth;
  try {
    await connectToDatabase();
    const owner = auth.user.role === 'ADMIN' ? req.nextUrl.searchParams.get('retailerId') : auth.user.id;
    const items = await RetailerInventoryModel.find(owner ? { retailerId: owner } : {}).sort({ receivedAt: -1 }).lean<Record<string, any>[]>();
    const batches = await BatchModel.find({ _id: { $in: [...new Set(items.map((item) => item.batchId))] } }).lean<Record<string, any>[]>();
    const products = await ProductModel.find({ _id: { $in: [...new Set(batches.map((batch) => batch.productId))] } }).lean<Record<string, any>[]>();
    const productMap = new Map(products.map((product) => [product._id, product]));
    const batchMap = new Map(batches.map((batch) => [batch._id, batch]));
    return successResponse(items.map((item) => ({ ...item, batchCode: batchMap.get(item.batchId)?.batchCode || '', crop: productMap.get(batchMap.get(item.batchId)?.productId)?.name || 'Crop' })));
  } catch (error) { console.error('Retailer inventory read failed:', error); return errorResponse('Unable to load retailer inventory.', 'SERVER_ERROR', 500); }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req, ['RETAILER']);
  if (auth instanceof Response) return auth;
  try {
    await connectToDatabase();
    const body = await req.json() as { inventoryId?: string; action?: string; quantity?: number; retailPricePerUnit?: number };
    const owner = auth.user.role === 'ADMIN' ? undefined : auth.user.id;
    const row = await RetailerInventoryModel.findOne({ _id: body.inventoryId, ...(owner ? { retailerId: owner } : {}) }).lean<Record<string, any>>();
    if (!row) return errorResponse('Inventory item not found.', 'NOT_FOUND', 404);
    if (body.action === 'PRICE') {
      if (!Number.isFinite(body.retailPricePerUnit) || Number(body.retailPricePerUnit) <= 0) return errorResponse('Enter a positive sale price.', 'VALIDATION_ERROR', 400);
      const updated = await RetailerInventoryModel.findOneAndUpdate({ _id: row._id, ...(owner ? { retailerId: owner } : {}) }, { $set: { retailPricePerUnit: body.retailPricePerUnit } }, { new: true }).lean<Record<string, any>>();
      return successResponse(updated);
    }
    if (body.action === 'SELL') {
      const quantity = Number(body.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > row.quantityAvailable) return errorResponse('Sale quantity must be positive and no greater than available stock.', 'VALIDATION_ERROR', 400);
      if (!row.retailPricePerUnit || row.retailPricePerUnit <= 0) return errorResponse('Set a retail sale price before recording a sale.', 'PRICE_REQUIRED', 409);
      const unitPrice = row.retailPricePerUnit;
      const sale = { soldAt: new Date(), quantity, unitPrice, amount: Math.round(quantity * unitPrice * 100) / 100, actorId: auth.user.id };
      const updated = await RetailerInventoryModel.findOneAndUpdate({ _id: row._id, ...(owner ? { retailerId: owner } : {}), quantityAvailable: { $gte: quantity } }, { $inc: { quantityAvailable: -quantity, quantitySold: quantity }, $set: { status: row.quantityAvailable - quantity <= 0 ? 'SOLD_OUT' : 'IN_STOCK' }, $push: { salesLog: sale } }, { new: true }).lean<Record<string, any>>();
      if (!updated) return errorResponse('Stock changed while recording sale. Refresh and try again.', 'CONFLICT', 409);
      return successResponse({ ...updated, saleValue: sale.amount });
    }
    return errorResponse('Unsupported inventory action.', 'VALIDATION_ERROR', 400);
  } catch (error) { console.error('Retailer inventory update failed:', error); return errorResponse('Unable to update retailer inventory.', 'SERVER_ERROR', 500); }
}
