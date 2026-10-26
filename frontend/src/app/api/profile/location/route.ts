import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { connectToDatabase } from '@/lib/db/connection';
import { FarmerProfileModel, UserModel } from '@/lib/db/models';
import { successResponse, errorResponse } from '@/lib/response';

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req, ['FARMER', 'RETAILER']);
  if (auth instanceof Response) return auth;
  try {
    const body = await req.json() as Record<string, unknown>;
    const location = typeof body.location === 'string' ? body.location.trim() : '';
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    if (location.length < 5 || location.length > 300 || !Number.isFinite(latitude) || latitude < 6 || latitude > 38 || !Number.isFinite(longitude) || longitude < 68 || longitude > 98) {
      return errorResponse('Provide a valid Indian address and precise GPS coordinates.', 'VALIDATION_ERROR', 400);
    }
    await connectToDatabase();
    if (auth.user.role === 'FARMER') {
      const profile = await FarmerProfileModel.findOneAndUpdate({ userId: auth.user.id }, { $set: { location, latitude, longitude } }, { new: true }).lean();
      if (!profile) return errorResponse('Farmer profile not found.', 'NOT_FOUND', 404);
      await UserModel.updateOne({ _id: auth.user.id }, { $set: { latitude, longitude } });
      return successResponse({ role: auth.user.role, location, latitude, longitude });
    }
    const user = await UserModel.findByIdAndUpdate(auth.user.id, { $set: { shopLocation: location, latitude, longitude } }, { new: true }).select({ password: 0 }).lean();
    if (!user) return errorResponse('Retailer account not found.', 'NOT_FOUND', 404);
    return successResponse({ role: auth.user.role, location, latitude, longitude });
  } catch (error) {
    console.error('Save profile location error:', error);
    return errorResponse('Unable to save the current location.', 'SERVER_ERROR', 500);
  }
}
