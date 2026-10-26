import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { connectToDatabase } from '@/lib/db/connection';
import { BatchModel, CertificateModel, FarmerProfileModel, MarketplaceOfferModel, ProductModel, SupplyChainEventModel, UserModel } from '@/lib/db/models';
import { createSupplyChainEvent, findBatchByIdOrCode } from '@/lib/db/repositories/batches';
import { recordSupplyChainEventOnChain } from '@/lib/blockchain';
import { successResponse, errorResponse } from '@/lib/response';

/* eslint-disable @typescript-eslint/no-explicit-any -- these records are compact, bounded projections from the shared wide Mongoose model registry. */

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, ['RETAILER', 'TRANSPORTER']);
  if (auth instanceof Response) return auth;
  try {
    await connectToDatabase();
    if (auth.user.role === 'TRANSPORTER') {
      const offers = await MarketplaceOfferModel.find({ $or: [{ status: 'OPEN' }, { acceptedBy: auth.user.id, status: { $in: ['ACCEPTED', 'PICKUP_OTP_PENDING', 'IN_TRANSIT', 'DELIVERY_OTP_PENDING', 'DELIVERED'] } }] }).sort({ pricePerUnit: -1, createdAt: 1 }).limit(500).lean<Record<string, any>[]>();
      const batchIds = [...new Set(offers.map((offer) => offer.batchId))];
      const batches = await BatchModel.find({ _id: { $in: batchIds } }).lean<Record<string, any>[]>();
      const [retailers, farmers, farmerProfiles] = await Promise.all([
        UserModel.find({ _id: { $in: [...new Set(offers.map((offer) => offer.retailerId))] } }).select({ password: 0 }).lean<Record<string, any>[]>(),
        UserModel.find({ _id: { $in: [...new Set(batches.map((batch) => batch.farmerId))] } }).select({ password: 0 }).lean<Record<string, any>[]>(),
        FarmerProfileModel.find({ userId: { $in: [...new Set(batches.map((batch) => batch.farmerId))] } }).lean<Record<string, any>[]>(),
      ]);
      const products = await ProductModel.find({ _id: { $in: [...new Set(batches.map((batch) => batch.productId))] } }).lean<Record<string, any>[]>();
      const [certificates, certificateEvents] = await Promise.all([
        CertificateModel.find({ batchId: { $in: batchIds }, certificateType: /FSSAI/i }).sort({ createdAt: -1 }).lean<Record<string, any>[]>(),
        SupplyChainEventModel.find({ batchId: { $in: batchIds }, eventType: 'FSSAI_CERTIFICATE_UPLOADED' }).sort({ timestamp: -1 }).lean<Record<string, any>[]>(),
      ]);
      const batchMap = new Map(batches.map((item) => [item._id, item]));
      const productMap = new Map(products.map((item) => [item._id, item]));
      const retailerMap = new Map(retailers.map((item) => [item._id, item]));
      const farmerMap = new Map(farmers.map((item) => [item._id, item]));
      const farmerProfileMap = new Map(farmerProfiles.map((item) => [item.userId, item]));
      const certificateMap = new Map<string, Record<string, any>>();
      for (const cert of certificates) if (!certificateMap.has(cert.batchId)) certificateMap.set(cert.batchId, cert);
      const certificateEventMap = new Map<string, Record<string, any>>();
      for (const event of certificateEvents) if (!certificateEventMap.has(event.batchId)) certificateEventMap.set(event.batchId, event);
      return successResponse(offers.map((offer) => {
        const batch = batchMap.get(offer.batchId);
        const retailer = retailerMap.get(offer.retailerId);
        const farmer = batch ? farmerMap.get(batch.farmerId) : null;
        const farmerProfile = batch ? farmerProfileMap.get(batch.farmerId) : null;
        return { ...offer, retailer: retailer ? { id: retailer._id, name: retailer.name, phone: retailer.phone, shopLocation: retailer.shopLocation, latitude: retailer.latitude, longitude: retailer.longitude } : null,
          farmer: farmer ? { id: farmer._id, name: farmer.name, phone: farmer.phone, location: farmerProfile?.location || batch?.location, latitude: farmerProfile?.latitude, longitude: farmerProfile?.longitude } : null,
          batch: batch ? { ...batch, product: productMap.get(batch.productId) || null, fssaiCertificate: certificateMap.get(batch._id) ? { ...certificateMap.get(batch._id), verificationStatus: certificateMap.get(batch._id).expiryDate && certificateMap.get(batch._id).expiryDate < new Date() ? 'EXPIRED' : certificateMap.get(batch._id).verificationStatus, blockchainTransactionHash: certificateEventMap.get(batch._id)?.blockchainTransactionHash || null } : null } : null };
      }).filter((offer) => offer.batch));
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get('q')?.trim();
    const productMatches = search ? await ProductModel.find({ name: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }).select({ _id: 1 }).lean<Array<{ _id: string }>>() : [];
    const query = search ? { $or: [{ batchCode: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }, { productId: { $in: productMatches.map((item) => item._id) } }] } : {};
    const batches = await BatchModel.find(query).sort({ harvestDate: 1 }).limit(300).lean<Record<string, any>[]>();
    const ids = batches.map((batch) => batch._id);
    const [farmers, profiles, products, certificates, offers] = await Promise.all([
      UserModel.find({ _id: { $in: [...new Set(batches.map((batch) => batch.farmerId))] } }).select({ password: 0 }).lean<Record<string, any>[]>(),
      FarmerProfileModel.find({ userId: { $in: [...new Set(batches.map((batch) => batch.farmerId))] } }).lean<Record<string, any>[]>(),
      ProductModel.find({ _id: { $in: [...new Set(batches.map((batch) => batch.productId))] } }).lean<Record<string, any>[]>(),
      CertificateModel.find({ batchId: { $in: ids }, certificateType: /FSSAI/i }).sort({ createdAt: -1 }).lean<Record<string, any>[]>(),
      MarketplaceOfferModel.find({ retailerId: auth.user.id }).lean<Record<string, any>[]>(),
    ]);
    const farmerMap = new Map(farmers.map((item) => [item._id, item]));
    const profileMap = new Map(profiles.map((item) => [item.userId, item]));
    const productMap = new Map(products.map((item) => [item._id, item]));
    const certMap = new Map<string, Record<string, any>>();
    for (const cert of certificates) if (!certMap.has(cert.batchId)) certMap.set(cert.batchId, cert);
    const offerMap = new Map(offers.map((offer) => [offer.batchId, offer]));
    const offerCountRows = await MarketplaceOfferModel.aggregate([{ $match: { batchId: { $in: ids }, status: 'OPEN' } }, { $group: { _id: '$batchId', count: { $sum: 1 }, highBid: { $max: '$pricePerUnit' } } }]);
    const offerCountMap = new Map(offerCountRows.map((item: any) => [item._id, item]));
    return successResponse(batches.map((batch) => ({ ...batch, product: productMap.get(batch.productId) || null,
      farmer: (() => { const farmer = farmerMap.get(batch.farmerId); const profile = profileMap.get(batch.farmerId); return farmer ? { id: farmer._id, name: farmer.name, phone: farmer.phone, farmerProfile: profile || null } : null; })(),
      fssaiCertificate: certMap.get(batch._id) ? { ...certMap.get(batch._id), verificationStatus: certMap.get(batch._id).expiryDate && certMap.get(batch._id).expiryDate < new Date() ? 'EXPIRED' : certMap.get(batch._id).verificationStatus } : null, myOffer: offerMap.get(batch._id) || null,
      market: offerCountMap.get(batch._id) || { count: 0, highBid: null },
    })));
  } catch (error) {
    console.error('Marketplace listing error:', error);
    return errorResponse('Unable to load marketplace information', 'SERVER_ERROR', 500);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, ['RETAILER']);
  if (auth instanceof Response) return auth;
  try {
    const body = await req.json() as Record<string, unknown>;
    const batchId = typeof body.batchId === 'string' ? body.batchId.trim() : '';
    const pricePerUnit = Number(body.pricePerUnit);
    const retailer = await UserModel.findById(auth.user.id).lean<Record<string, any>>();
    const retailerLocation = (typeof body.retailerLocation === 'string' ? body.retailerLocation.trim() : '') || retailer?.shopLocation || '';
    const latitude = body.latitude === undefined || body.latitude === null ? retailer?.latitude ?? null : Number(body.latitude);
    const longitude = body.longitude === undefined || body.longitude === null ? retailer?.longitude ?? null : Number(body.longitude);
    if (!batchId || !Number.isFinite(pricePerUnit) || pricePerUnit <= 0 || pricePerUnit > 1_000_000 || retailerLocation.length < 3 || retailerLocation.length > 200 || (latitude !== null && (!Number.isFinite(latitude) || latitude < 6 || latitude > 38)) || (longitude !== null && (!Number.isFinite(longitude) || longitude < 68 || longitude > 98))) {
      return errorResponse('Provide a batch, positive INR offer per unit, Indian retailer location, and valid optional India coordinates.', 'VALIDATION_ERROR', 400);
    }
    await connectToDatabase();
    const batch = await findBatchByIdOrCode(batchId);
    if (!batch) return errorResponse('Batch not found', 'NOT_FOUND', 404);
    const acceptedForBatch = await MarketplaceOfferModel.findOne({ batchId: batch._id, status: 'ACCEPTED' }).lean();
    if (acceptedForBatch) return errorResponse('This batch already has an accepted retailer order.', 'CONFLICT', 409);
    const offer = await MarketplaceOfferModel.findOneAndUpdate(
      { batchId: batch._id, retailerId: auth.user.id, status: { $in: ['OPEN', 'WITHDRAWN'] } },
      { $set: { batchId: batch._id, retailerId: auth.user.id, pricePerUnit, currency: 'INR', retailerLocation, latitude, longitude, status: 'OPEN' } },
      { new: true, upsert: true, runValidators: true },
    ).lean<Record<string, any>>();
    await createSupplyChainEvent({ batchId: batch._id, eventType: 'RETAILER_BID_PLACED', actorId: auth.user.id, actorRole: auth.user.role, location: retailerLocation, metadata: JSON.stringify({ offerId: offer?._id, pricePerUnit, currency: 'INR' }) });
    return successResponse(offer, 201);
  } catch (error) {
    console.error('Marketplace bid error:', error);
    return errorResponse('Unable to place offer', 'SERVER_ERROR', 500);
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req, ['TRANSPORTER']);
  if (auth instanceof Response) return auth;
  try {
    const body = await req.json() as { offerId?: unknown };
    const offerId = typeof body.offerId === 'string' ? body.offerId.trim() : '';
    if (!offerId) return errorResponse('Offer ID is required.', 'VALIDATION_ERROR', 400);
    await connectToDatabase();
    const offer = await MarketplaceOfferModel.findOne({ _id: offerId, status: 'OPEN' }).lean<Record<string, any>>();
    if (!offer) return errorResponse('Offer is no longer open.', 'CONFLICT', 409);
    const batch = await findBatchByIdOrCode(offer.batchId);
    if (!batch) return errorResponse('The crop batch is unavailable.', 'NOT_FOUND', 404);
    const existing = await MarketplaceOfferModel.findOne({ batchId: batch._id, status: 'ACCEPTED' }).lean();
    if (existing) return errorResponse('This batch already has an accepted retailer.', 'CONFLICT', 409);
    const gross = Math.round(offer.pricePerUnit * batch.quantity * 100) / 100;
    const commissionAmount = Math.round(gross * 0.04 * 100) / 100;
    const farmerPayoutAmount = Math.round((gross - commissionAmount) * 100) / 100;
    const accepted = await MarketplaceOfferModel.findOneAndUpdate({ _id: offerId, status: 'OPEN' }, { $set: { status: 'ACCEPTED', acceptedBy: auth.user.id, acceptedAt: new Date(), commissionAmount, farmerPayoutAmount } }, { new: true }).lean<Record<string, any>>();
    if (!accepted) return errorResponse('Another transporter accepted this offer first.', 'CONFLICT', 409);
    await MarketplaceOfferModel.updateMany({ batchId: batch._id, _id: { $ne: offerId }, status: 'OPEN' }, { $set: { status: 'CLOSED' } });
    const metadata = JSON.stringify({ offerId, retailerId: offer.retailerId, pricePerUnit: offer.pricePerUnit, grossOrderValue: gross, commissionRate: 0.04, commissionAmount, farmerPayoutAmount, payoutStatus: 'PAYMENT_PROVIDER_REQUIRED' });
    const ledger = await recordSupplyChainEventOnChain({ batchCode: batch.batchCode, eventType: 'RETAILER_ORDER_ACCEPTED', actorRole: auth.user.role, location: offer.retailerLocation, metadata });
    await createSupplyChainEvent({ batchId: batch._id, eventType: 'RETAILER_ORDER_ACCEPTED', actorId: auth.user.id, actorRole: auth.user.role, location: offer.retailerLocation, metadata: JSON.stringify({ ...JSON.parse(metadata), ledgerStatus: ledger.reason || 'ANCHORED' }), blockchainTransactionHash: ledger.transactionHash });
    return successResponse({ ...accepted, grossOrderValue: gross, ledgerStatus: ledger.transactionHash ? 'ANCHORED' : ledger.reason });
  } catch (error) {
    console.error('Offer acceptance error:', error);
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) return errorResponse('This batch already has an accepted retailer.', 'CONFLICT', 409);
    return errorResponse('Unable to accept this offer', 'SERVER_ERROR', 500);
  }
}
