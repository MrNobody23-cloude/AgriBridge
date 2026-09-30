import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { findUserByIdWithProfileSafe } from './db/repositories/users';

function getJwtSecret(): string {
    const secret = process.env.AUTH_SECRET;
    if (!secret) {
        throw new Error('Missing required environment variable: AUTH_SECRET. Please set AUTH_SECRET in your .env file.');
    }
    return secret;
}

const TOKEN_NAME = 'agribridge_token';
const TOKEN_EXPIRY = '7d';

export interface UserPayload {
    phone: null;
    id: string;
    email: string;
    name: string;
    role: string;
}

// ─── Password helpers ──────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
}

// ─── JWT helpers ───────────────────────────────────────────────────────────────

export function generateToken(payload: UserPayload): string {
    return jwt.sign(payload, getJwtSecret(), { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token: string): UserPayload | null {
    try {
        return jwt.verify(token, getJwtSecret()) as UserPayload;
    } catch {
        return null;
    }
}

// ─── Session helpers (Server Components / Route Handlers) ─────────────────────

export async function getSessionUser(): Promise<UserPayload | null> {
    try {
        const cookieStore = await cookies();
        const token = cookieStore.get(TOKEN_NAME)?.value;
        if (!token) return null;
        return verifyToken(token);
    } catch {
        return null;
    }
}

/**
 * The signed-in user with their farmer profile, or null.
 *
 * `password` is excluded **in the query**, not by the caller. The only caller
 * used to destructure it away afterwards, which meant the bcrypt hash was read
 * from the database and held in this process for no reason. A projection that
 * depends on every caller remembering to strip a field is not a boundary.
 */
export async function getFullSessionUser() {
    const payload = await getSessionUser();
    if (!payload) return null;
    return findUserByIdWithProfileSafe(payload.id);
}

// ─── Auth guard for API Route Handlers ────────────────────────────────────────

import { hasPermission, Permission, Role } from './permissions';

/**
 * Use inside a Route Handler to require an authenticated session.
 * Optionally restrict to specific roles.
 *
 * @example
 * const authResult = await requireAuth(req);
 * if (authResult instanceof NextResponse) return authResult; // 401/403
 * const { user } = authResult;
 */
export async function requireAuth(
    req: NextRequest,
    allowedRoles?: string[]
): Promise<{ user: UserPayload } | NextResponse> {
    // Try cookie first, then Authorization header (for mobile / external clients)
    let token: string | undefined;

    try {
        const cookieStore = await cookies();
        token = cookieStore.get(TOKEN_NAME)?.value;
    } catch {
        // cookies() throws outside a Next.js Server Component or Route Handler context
    }

    if (!token) {
        const authHeader = req.headers.get('Authorization');
        if (authHeader?.startsWith('Bearer ')) {
            token = authHeader.slice(7);
        }
    }

    if (!token) {
        return NextResponse.json(
            { success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
            { status: 401 }
        );
    }

    const payload = verifyToken(token);
    if (!payload) {
        return NextResponse.json(
            { success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' } },
            { status: 401 }
        );
    }

    if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(payload.role)) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: 'FORBIDDEN',
                    message: `Access denied. Required role: ${allowedRoles.join(' or ')}`,
                },
            },
            { status: 403 }
        );
    }

    return { user: payload };
}

export async function requirePermission(
    req: NextRequest,
    permission: Permission
): Promise<{ user: UserPayload } | NextResponse> {
    const authResult = await requireAuth(req);
    if (authResult instanceof NextResponse) {
        return authResult; // Returns Unauthenticated immediately
    }

    const { user } = authResult;
    if (!hasPermission(user.role as Role, permission)) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: 'FORBIDDEN',
                    message: `Access denied. Requires permission: ${permission}`,
                },
            },
            { status: 403 }
        );
    }

    return { user };
}

/**
 * Convenience guard for public-facing read routes (optional auth).
 * Returns the session user or null — never blocks the request.
 */
export async function optionalAuth(req: NextRequest): Promise<UserPayload | null> {
    let token: string | undefined;

    try {
        const cookieStore = await cookies();
        token = cookieStore.get(TOKEN_NAME)?.value;
    } catch {
        // cookies() may throw outside request context
    }

    if (!token) {
        const authHeader = req.headers.get('Authorization');
        if (authHeader?.startsWith('Bearer ')) {
            token = authHeader.slice(7);
        }
    }

    if (!token) return null;
    return verifyToken(token);
}

export { TOKEN_NAME };
