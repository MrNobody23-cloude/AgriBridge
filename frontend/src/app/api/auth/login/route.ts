import { NextRequest } from 'next/server';
import { findUserByEmail, findUserByIdWithProfile } from '@/lib/db/repositories/users';
import { comparePassword, generateToken, TOKEN_NAME } from '@/lib/auth';
import { loginSchema } from '@/lib/validators';
import { successResponse, errorResponse } from '@/lib/response';
import { isZodError, firstValidationMessage } from '@/lib/zod-error';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const validated = loginSchema.parse(body);

        const found = await findUserByEmail(validated.email);

        if (!found) {
            return errorResponse('Invalid email or password', 'INVALID_CREDENTIALS', 401);
        }

        const isValid = await comparePassword(validated.password, found.password);
        if (!isValid) {
            return errorResponse('Invalid email or password', 'INVALID_CREDENTIALS', 401);
        }

        // The profile is only needed for the response body, so it is fetched
        // after the password check rather than as part of the lookup — an
        // attacker probing emails does not get a second query per attempt.
        const user = await findUserByIdWithProfile(found._id);

        const token = generateToken({
            id: found._id,
            email: found.email,
            name: found.name,
            role: found.role,
            phone: found.phone || null,
        } as any);

        const response = successResponse({
            user: {
                id: found._id,
                name: found.name,
                email: found.email,
                role: found.role,
                phone: found.phone,
                farmerProfile: user?.farmerProfile ?? null,
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
        console.error('Login error:', error);
        return errorResponse('Internal server error', 'SERVER_ERROR', 500);
    }
}
