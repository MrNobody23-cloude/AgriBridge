import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { connectToDatabase } from '@/lib/db/connection';
import { AuditLogModel, BatchModel, CertificateModel, FraudAlertModel, FarmerProfileModel, MarketplaceOfferModel, RetailerInventoryModel, ShipmentModel, SupplyChainEventModel, UserModel } from '@/lib/db/models';
import { deleteBatchCascade, findBatchByIdOrCode } from '@/lib/db/repositories/batches';
import { createAuditLog } from '@/lib/auditLog';
import { successResponse, errorResponse } from '@/lib/response';

/* eslint-disable @typescript-eslint/no-explicit-any -- the admin table reads allowlisted collections through the shared Mongoose registry. */
const collections: Record<string, any> = { users: UserModel, batches: BatchModel, certificates: CertificateModel, orders: MarketplaceOfferModel, inventory: RetailerInventoryModel, fraud: FraudAlertModel, shipments: ShipmentModel, events: SupplyChainEventModel, audit: AuditLogModel };
const editableFields: Record<string, string[]> = {
  users: ['name', 'email', 'role', 'phone', 'isActive', 'shopLocation', 'latitude', 'longitude'],
  batches: ['quantity', 'unit', 'harvestDate', 'actualHarvestDate', 'harvestStage', 'location', 'status', 'trustScore', 'qualityScore', 'qualityGrade'],
  certificates: ['certificateType', 'issuer', 'issueDate', 'expiryDate', 'reviewNotes'],
  orders: ['pricePerUnit', 'status', 'retailerLocation', 'latitude', 'longitude', 'commissionAmount', 'farmerPayoutAmount'],
  inventory: ['quantityAvailable', 'quantitySold', 'retailPricePerUnit', 'status'],
  fraud: ['status', 'severity', 'description', 'notes'],
  shipments: ['status', 'quantity', 'riskScore', 'estimatedArrival'],
};

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, ['ADMIN']);
  if (auth instanceof Response) return auth;
  try {
    await connectToDatabase();
    const { searchParams } = new URL(req.url);
    const collection = searchParams.get('collection') || 'batches';
    const model = collections[collection];
    if (!model) return errorResponse('Unknown record collection.', 'VALIDATION_ERROR', 400);
    const queryText = searchParams.get('q')?.trim();
    const query: Record<string, unknown> = {};
    if (queryText && collection === 'users') query.$or = [{ name: { $regex: queryText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }, { email: { $regex: queryText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }];
    else if (queryText && collection === 'batches') query.$or = [{ batchCode: { $regex: queryText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }, { location: { $regex: queryText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }];
    const records = await model.find(query).sort({ updatedAt: -1, createdAt: -1, timestamp: -1 }).limit(200).select(collection === 'users' ? '-password' : {}).lean();
    return successResponse(records.map((record) => ({ ...record, id: record._id })));
  } catch (error) {
    console.error('Admin records listing error:', error);
    return errorResponse('Unable to list records.', 'SERVER_ERROR', 500);
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req, ['ADMIN']);
  if (auth instanceof Response) return auth;
  try {
    const body = await req.json() as { collection?: unknown; id?: unknown; changes?: unknown };
    const collection = typeof body.collection === 'string' ? body.collection : '';
    const id = typeof body.id === 'string' ? body.id : '';
    const model = collections[collection];
    if (!model || !editableFields[collection] || !id || !body.changes || typeof body.changes !== 'object') return errorResponse('Select an editable record and provide field changes.', 'VALIDATION_ERROR', 400);
    const changes = body.changes as Record<string, unknown>;
    const update: Record<string, unknown> = {};
    for (const field of editableFields[collection]) if (Object.prototype.hasOwnProperty.call(changes, field)) update[field] = changes[field];
    if (collection === 'users' && update.role !== undefined && !['FARMER', 'TRANSPORTER', 'RETAILER', 'CONSUMER', 'ADMIN'].includes(String(update.role))) return errorResponse('Unsupported account role.', 'VALIDATION_ERROR', 400);
    if (collection === 'batches' && update.quantity !== undefined && (!Number.isFinite(Number(update.quantity)) || Number(update.quantity) <= 0)) return errorResponse('Batch quantity must be greater than zero.', 'VALIDATION_ERROR', 400);
    if (collection === 'inventory' && update.quantityAvailable !== undefined && Number(update.quantityAvailable) < 0) return errorResponse('Inventory cannot be negative.', 'VALIDATION_ERROR', 400);
    if (collection === 'inventory' && update.retailPricePerUnit !== undefined && Number(update.retailPricePerUnit) < 0) return errorResponse('Retail price cannot be negative.', 'VALIDATION_ERROR', 400);
    if (!Object.keys(update).length) return errorResponse('No editable fields were provided.', 'VALIDATION_ERROR', 400);
    const record = await model.findByIdAndUpdate(id, { $set: update }, { new: true, runValidators: true }).select(collection === 'users' ? '-password' : {}).lean();
    if (!record) return errorResponse('Record not found.', 'NOT_FOUND', 404);
    await createAuditLog({ userId: auth.user.id, action: 'ADMIN_RECORD_UPDATED', resource: collection, resourceId: id, metadata: JSON.stringify({ fields: Object.keys(update) }) });
    return successResponse({ ...record, id: record._id });
  } catch (error) {
    console.error('Admin record update error:', error);
    return errorResponse('Unable to update this record.', 'SERVER_ERROR', 500);
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req, ['ADMIN']);
  if (auth instanceof Response) return auth;
  try {
    const body = await req.json() as { collection?: unknown; id?: unknown };
    const collection = typeof body.collection === 'string' ? body.collection : '';
    const id = typeof body.id === 'string' ? body.id : '';
    const model = collections[collection];
    if (!model || !id || ['events', 'audit'].includes(collection)) return errorResponse('Choose a mutable record collection. Trace and audit entries remain append-only.', 'VALIDATION_ERROR', 400);
    if (collection === 'users') {
      const target = await UserModel.findById(id).lean<Record<string, any>>();
      if (!target) return errorResponse('Record not found.', 'NOT_FOUND', 404);
      if (target.role === 'ADMIN' && (await UserModel.countDocuments({ role: 'ADMIN', isActive: true })) <= 1) return errorResponse('The final active admin account cannot be deleted.', 'CONFLICT', 409);
      if (target.role === 'FARMER') {
        const batches = await BatchModel.find({ farmerId: id }).select({ _id: 1 }).lean<Array<{ _id: string }>>();
        for (const batch of batches) {
          const result = await deleteBatchCascade(batch._id);
          if (!result.deleted) return errorResponse(`Account deletion stopped because batch child records could not be removed: ${result.failed.join(', ')}`, 'CASCADE_DELETE_FAILED', 500);
        }
        await FarmerProfileModel.deleteOne({ userId: id });
      }
      if (target.role === 'RETAILER') {
        await RetailerInventoryModel.deleteMany({ retailerId: id });
        await MarketplaceOfferModel.deleteMany({ retailerId: id, status: { $in: ['OPEN', 'CLOSED', 'WITHDRAWN'] } });
      }
      await UserModel.deleteOne({ _id: id });
    } else if (collection === 'batches') {
      const batch = await findBatchByIdOrCode(id);
      if (!batch) return errorResponse('Record not found.', 'NOT_FOUND', 404);
      const result = await deleteBatchCascade(batch._id);
      if (!result.deleted) return errorResponse(`Batch deletion stopped because child records could not be removed: ${result.failed.join(', ')}`, 'CASCADE_DELETE_FAILED', 500);
    } else {
      const result = await model.deleteOne({ _id: id });
      if (!result.deletedCount) return errorResponse('Record not found.', 'NOT_FOUND', 404);
    }
    await createAuditLog({ userId: auth.user.id, action: 'ADMIN_RECORD_DELETED', resource: collection, resourceId: id });
    return successResponse({ deleted: true, id, collection });
  } catch (error) {
    console.error('Admin record delete error:', error);
    return errorResponse('Unable to delete this record.', 'SERVER_ERROR', 500);
  }
}
