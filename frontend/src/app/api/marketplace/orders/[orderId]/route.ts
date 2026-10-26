import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { connectToDatabase } from '@/lib/db/connection';
import { FarmerProfileModel, MarketplaceOfferModel, ProductModel, RetailerInventoryModel, UserModel } from '@/lib/db/models';
import { createSupplyChainEvent, findBatchByIdOrCode } from '@/lib/db/repositories/batches';
import { decryptDeliveryOtp, distanceMeters, encryptDeliveryOtp, generateDeliveryOtp, hashDeliveryOtp, verifyDeliveryOtp } from '@/lib/trackingOtp';
import { recordSupplyChainEventOnChain } from '@/lib/blockchain';
import { successResponse, errorResponse } from '@/lib/response';

/* eslint-disable @typescript-eslint/no-explicit-any -- the delivery route joins compact projections from the shared Mongoose model registry. */

type Coordinates = { latitude: number; longitude: number };
const isCoordinate = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

export async function GET(req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const auth = await requireAuth(req, ['FARMER', 'RETAILER', 'TRANSPORTER']);
  if (auth instanceof Response) return auth;
  try {
    await connectToDatabase();
    const { orderId } = await params;
    const offer = await MarketplaceOfferModel.findById(orderId).lean<Record<string, any>>();
    if (!offer) return errorResponse('Order not found.', 'NOT_FOUND', 404);
    const batch = await findBatchByIdOrCode(offer.batchId);
    if (!batch) return errorResponse('Crop batch not found.', 'NOT_FOUND', 404);
    const allowed = auth.user.role === 'ADMIN' || (auth.user.role === 'TRANSPORTER' && offer.acceptedBy === auth.user.id) || (auth.user.role === 'RETAILER' && offer.retailerId === auth.user.id) || (auth.user.role === 'FARMER' && batch.farmerId === auth.user.id);
    if (!allowed) return errorResponse('You cannot view this order.', 'FORBIDDEN', 403);
    const [farmer, farmerProfile, retailer, product] = await Promise.all([
      UserModel.findById(batch.farmerId).select({ password: 0 }).lean<Record<string, any>>(),
      FarmerProfileModel.findOne({ userId: batch.farmerId }).lean<Record<string, any>>(),
      UserModel.findById(offer.retailerId).select({ password: 0 }).lean<Record<string, any>>(),
      ProductModel.findById(batch.productId).lean<Record<string, any>>(),
    ]);
    const recipientOtp = auth.user.role === 'FARMER' && offer.status === 'PICKUP_OTP_PENDING' && offer.pickupOtpCipher
      ? decryptDeliveryOtp(offer.pickupOtpCipher)
      : auth.user.role === 'RETAILER' && offer.status === 'DELIVERY_OTP_PENDING' && offer.deliveryOtpCipher
        ? decryptDeliveryOtp(offer.deliveryOtpCipher) : null;
    const mapOffer = { ...offer, pickupOtpHash: undefined, pickupOtpCipher: undefined, deliveryOtpHash: undefined, deliveryOtpCipher: undefined };
    return successResponse({ order: mapOffer, recipientOtp, batch: { ...batch, product }, farmer: farmer ? { id: farmer._id, name: farmer.name, phone: farmer.phone, location: farmerProfile?.location || batch.location, latitude: farmerProfile?.latitude ?? null, longitude: farmerProfile?.longitude ?? null } : null, retailer: retailer ? { id: retailer._id, name: retailer.name, phone: retailer.phone, location: retailer.shopLocation || offer.retailerLocation, latitude: retailer.latitude ?? offer.latitude ?? null, longitude: retailer.longitude ?? offer.longitude ?? null } : null });
  } catch (error) {
    console.error('Marketplace order detail error:', error);
    return errorResponse('Unable to load order details.', 'SERVER_ERROR', 500);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const auth = await requireAuth(req, ['FARMER', 'RETAILER', 'TRANSPORTER']);
  if (auth instanceof Response) return auth;
  try {
    await connectToDatabase();
    const { orderId } = await params;
    const body = await req.json() as Record<string, unknown>;
    const action = typeof body.action === 'string' ? body.action : '';
    const offer = await MarketplaceOfferModel.findById(orderId).lean<Record<string, any>>();
    if (!offer) return errorResponse('Order not found.', 'NOT_FOUND', 404);
    const batch = await findBatchByIdOrCode(offer.batchId);
    if (!batch) return errorResponse('Crop batch not found.', 'NOT_FOUND', 404);
    const transporterOwns = auth.user.role === 'TRANSPORTER' && offer.acceptedBy === auth.user.id;
    const lat = body.latitude;
    const lon = body.longitude;
    const coords: Coordinates | null = isCoordinate(lat, 6, 38) && isCoordinate(lon, 68, 98) ? { latitude: lat, longitude: lon } : null;
    if (['START_PICKUP', 'VERIFY_PICKUP', 'TRACK_LOCATION', 'START_DELIVERY'].includes(action) && !transporterOwns) return errorResponse('Only the assigned transporter can perform this delivery step.', 'FORBIDDEN', 403);
    if (action === 'VERIFY_DELIVERY' && !transporterOwns) return errorResponse('Only the assigned transporter can verify the retailer receipt OTP.', 'FORBIDDEN', 403);

    if (action === 'START_PICKUP') {
      const canReissue = offer.status === 'PICKUP_OTP_PENDING' && ((offer.pickupOtpAttempts || 0) >= 5 || !offer.pickupOtpExpiresAt || offer.pickupOtpExpiresAt < new Date());
      if ((offer.status !== 'ACCEPTED' && !canReissue) || !coords) return errorResponse('Order is not awaiting pickup or GPS is unavailable.', 'CONFLICT', 409);
      const profile = await FarmerProfileModel.findOne({ userId: batch.farmerId }).lean<Record<string, any>>();
      if (!isCoordinate(profile?.latitude, 6, 38) || !isCoordinate(profile?.longitude, 68, 98)) return errorResponse('The farmer must capture precise farm GPS at login before pickup can be verified.', 'LOCATION_REQUIRED', 409);
      const distance = distanceMeters(coords, { latitude: profile.latitude, longitude: profile.longitude });
      if (distance > 1500) return errorResponse(`Move within 1.5 km of the registered farm to initiate pickup OTP (${Math.round(distance)} m away).`, 'GEOFENCE_FAILED', 409);
      const otp = generateDeliveryOtp();
      const initiated = await MarketplaceOfferModel.updateOne({ _id: offer._id, status: offer.status }, { $set: { status: 'PICKUP_OTP_PENDING', pickupOtpHash: hashDeliveryOtp(offer._id, 'pickup', otp), pickupOtpCipher: encryptDeliveryOtp(otp), pickupOtpExpiresAt: new Date(Date.now() + 10 * 60_000), pickupOtpAttempts: 0, transporterLatitude: coords.latitude, transporterLongitude: coords.longitude, lastLocationAt: new Date() } });
      if (!initiated.modifiedCount) return errorResponse('Pickup state changed; refresh the order.', 'CONFLICT', 409);
      return successResponse({ status: 'PICKUP_OTP_PENDING', expiresInMinutes: 10, message: 'Pickup OTP is now available only in the farmer account.' });
    }

    if (action === 'VERIFY_PICKUP') {
      const otp = typeof body.otp === 'string' ? body.otp.trim() : '';
      if (offer.status !== 'PICKUP_OTP_PENDING' || !otp || (offer.pickupOtpAttempts || 0) >= 5 || !offer.pickupOtpExpiresAt || offer.pickupOtpExpiresAt < new Date()) return errorResponse('Pickup OTP has expired or the attempt limit was reached. Initiate a new request.', 'OTP_EXPIRED', 409);
      if (!verifyDeliveryOtp(offer._id, 'pickup', otp, offer.pickupOtpHash || '')) {
        await MarketplaceOfferModel.updateOne({ _id: offer._id }, { $inc: { pickupOtpAttempts: 1 } });
        return errorResponse('Pickup OTP does not match.', 'OTP_MISMATCH', 400);
      }
      const updated = await MarketplaceOfferModel.findOneAndUpdate({ _id: offer._id, status: 'PICKUP_OTP_PENDING', pickupOtpHash: offer.pickupOtpHash }, { $set: { status: 'IN_TRANSIT', pickupVerifiedAt: new Date(), pickupOtpHash: null, pickupOtpCipher: null, pickupOtpExpiresAt: null } }, { new: true }).lean<Record<string, any>>();
      if (!updated) return errorResponse('Pickup state changed; refresh the order.', 'CONFLICT', 409);
      await createSupplyChainEvent({ batchId: batch._id, eventType: 'TRANSPORTER_PICKUP_VERIFIED', actorId: auth.user.id, actorRole: auth.user.role, location: batch.location, metadata: JSON.stringify({ orderId: offer._id, pickupVerifiedAt: updated.pickupVerifiedAt }) });
      return successResponse({ status: updated.status, pickupVerifiedAt: updated.pickupVerifiedAt });
    }

    if (action === 'TRACK_LOCATION') {
      if (!coords || !['IN_TRANSIT', 'DELIVERY_OTP_PENDING'].includes(offer.status)) return errorResponse('Live tracking is only accepted while this delivery is in transit.', 'CONFLICT', 409);
      const updated = await MarketplaceOfferModel.findByIdAndUpdate(offer._id, { $set: { transporterLatitude: coords.latitude, transporterLongitude: coords.longitude, lastLocationAt: new Date() } }, { new: true }).lean<Record<string, any>>();
      return successResponse({ latitude: updated?.transporterLatitude, longitude: updated?.transporterLongitude, lastLocationAt: updated?.lastLocationAt });
    }

    if (action === 'START_DELIVERY') {
      const canReissue = offer.status === 'DELIVERY_OTP_PENDING' && ((offer.deliveryOtpAttempts || 0) >= 5 || !offer.deliveryOtpExpiresAt || offer.deliveryOtpExpiresAt < new Date());
      if ((offer.status !== 'IN_TRANSIT' && !canReissue) || !coords) return errorResponse('Order is not in transit or GPS is unavailable.', 'CONFLICT', 409);
      const retailer = await UserModel.findById(offer.retailerId).lean<Record<string, any>>();
      const retailerLat = offer.latitude ?? retailer?.latitude; const retailerLon = offer.longitude ?? retailer?.longitude;
      if (!isCoordinate(retailerLat, 6, 38) || !isCoordinate(retailerLon, 68, 98)) return errorResponse('Retailer must save precise shop GPS at login before delivery OTP can be initiated.', 'LOCATION_REQUIRED', 409);
      const distance = distanceMeters(coords, { latitude: retailerLat, longitude: retailerLon });
      if (distance > 1500) return errorResponse(`Move within 1.5 km of the retail shop to initiate delivery OTP (${Math.round(distance)} m away).`, 'GEOFENCE_FAILED', 409);
      const otp = generateDeliveryOtp();
      const initiated = await MarketplaceOfferModel.updateOne({ _id: offer._id, status: offer.status }, { $set: { status: 'DELIVERY_OTP_PENDING', deliveryOtpHash: hashDeliveryOtp(offer._id, 'delivery', otp), deliveryOtpCipher: encryptDeliveryOtp(otp), deliveryOtpExpiresAt: new Date(Date.now() + 10 * 60_000), deliveryOtpAttempts: 0, transporterLatitude: coords.latitude, transporterLongitude: coords.longitude, lastLocationAt: new Date() } });
      if (!initiated.modifiedCount) return errorResponse('Delivery state changed; refresh the order.', 'CONFLICT', 409);
      return successResponse({ status: 'DELIVERY_OTP_PENDING', expiresInMinutes: 10, message: 'Delivery OTP is now available only in the retailer account.' });
    }

    if (action === 'VERIFY_DELIVERY') {
      const otp = typeof body.otp === 'string' ? body.otp.trim() : '';
      if (offer.status !== 'DELIVERY_OTP_PENDING' || !otp || (offer.deliveryOtpAttempts || 0) >= 5 || !offer.deliveryOtpExpiresAt || offer.deliveryOtpExpiresAt < new Date()) return errorResponse('Delivery OTP has expired or the attempt limit was reached.', 'OTP_EXPIRED', 409);
      if (!verifyDeliveryOtp(offer._id, 'delivery', otp, offer.deliveryOtpHash || '')) {
        await MarketplaceOfferModel.updateOne({ _id: offer._id }, { $inc: { deliveryOtpAttempts: 1 } });
        return errorResponse('Delivery OTP does not match.', 'OTP_MISMATCH', 400);
      }
      const product = await ProductModel.findById(batch.productId).lean<Record<string, any>>();
      const inventory = await RetailerInventoryModel.findOneAndUpdate({ sourceOfferId: offer._id }, { $setOnInsert: { retailerId: offer.retailerId, batchId: batch._id, productId: batch.productId, sourceOfferId: offer._id, quantityReceived: batch.quantity, quantityAvailable: batch.quantity, quantitySold: 0, unit: batch.unit, purchasePricePerUnit: offer.pricePerUnit, retailPricePerUnit: null, status: 'IN_STOCK', receivedAt: new Date() } }, { new: true, upsert: true }).lean<Record<string, any>>();
      const updated = await MarketplaceOfferModel.findOneAndUpdate({ _id: offer._id, status: 'DELIVERY_OTP_PENDING', deliveryOtpHash: offer.deliveryOtpHash }, { $set: { status: 'DELIVERED', deliveredAt: new Date(), deliveryOtpHash: null, deliveryOtpCipher: null, deliveryOtpExpiresAt: null, inventoryCreated: true } }, { new: true }).lean<Record<string, any>>();
      if (!updated) return errorResponse('Delivery state changed; contact support before retrying.', 'CONFLICT', 409);
      const metadata = JSON.stringify({ orderId: offer._id, retailerId: offer.retailerId, inventoryId: inventory?._id, quantity: batch.quantity, unit: batch.unit, deliveredAt: updated.deliveredAt });
      const ledger = await recordSupplyChainEventOnChain({ batchCode: batch.batchCode, eventType: 'RETAILER_RECEIPT_OTP_VERIFIED', actorRole: auth.user.role, location: offer.retailerLocation, metadata });
      await createSupplyChainEvent({ batchId: batch._id, eventType: 'RETAILER_RECEIPT_OTP_VERIFIED', actorId: auth.user.id, actorRole: auth.user.role, location: offer.retailerLocation, metadata, blockchainTransactionHash: ledger.transactionHash });
      return successResponse({ status: 'DELIVERED', deliveredAt: updated.deliveredAt, inventory, product });
    }
    return errorResponse('Unsupported delivery action.', 'VALIDATION_ERROR', 400);
  } catch (error) {
    console.error('Marketplace order transition error:', error);
    return errorResponse('Unable to update delivery order.', 'SERVER_ERROR', 500);
  }
}
