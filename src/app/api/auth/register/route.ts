import { NextRequest } from 'next/server';
import { findUserByEmail, createUserWithProfile, createUser } from '@/lib/db/repositories/users';
import { hashPassword, generateToken, TOKEN_NAME } from '@/lib/auth';
import { registerSchema } from '@/lib/validators';
import { successResponse, errorResponse } from '@/lib/response';
import { isZodError, firstValidationMessage } from '@/lib/zod-error';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const validated = registerSchema.parse(body);

        const existingUser = await findUserByEmail(validated.email);

        if (existingUser) {
            return errorResponse('User with this email already exists', 'USER_EXISTS', 400);
        }

        const hashedPassword = await hashPassword(validated.password);

        // The Prisma version created the user and, for farmers, their profile
        // in one nested `create`. MongoDB has no nested create, and this is the
        // one place in the app where the difference is user-visible — a
        // half-registered farmer with no profile cannot log back in and fix it.
        // `createUserWithProfile` runs both writes in a transaction and rolls
        // back on failure; a non-farmer has no profile to write.
        const newUser =
            validated.role === 'FARMER'
                ? await createUserWithProfile({
                      name: validated.name,
                      email: validated.email,
                      password: hashedPassword,
                      role: validated.role,
                      phone: validated.phone,
                      farmerProfile: {
                          farmName: validated.farmName || `${validated.name}'s Farm`,
                          location: validated.location || 'Nashik, Maharashtra',
                          state: validated.state || 'Maharashtra',
                          district: validated.district || 'Nashik',
                      },
                  })
                : {
                      ...(await createUser({
                          name: validated.name,
                          email: validated.email,
                          password: hashedPassword,
                          role: validated.role,
                          phone: validated.phone,
                      })),
                      farmerProfile: null,
                  };

        const token = generateToken({
            id: newUser._id,
            email: newUser.email,
            name: newUser.name,
            role: newUser.role,
        });

        const response = successResponse({
            user: {
                id: newUser._id,
                name: newUser.name,
                email: newUser.email,
                role: newUser.role,
                phone: newUser.phone,
                farmerProfile: newUser.farmerProfile,
            },
            token,
        });

        response.cookies.set({
            name: TOKEN_NAME,
            value: token,
            httpOnly: true,
            path: '/',
            maxAge: 7 * 24 * 60 * 60,
            sameSite: 'lax',
        });

        return response;
    } catch (error: unknown) {
        if (isZodError(error)) {
            return errorResponse(firstValidationMessage(error), 'VALIDATION_ERROR', 400);
        }
        console.error('Registration error:', error);
        return errorResponse('Internal server error', 'SERVER_ERROR', 500);
    }
}
