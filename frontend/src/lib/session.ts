/**
 * The user object as the browser sees it.
 *
 * This is a separate module from `src/lib/db/repositories/users.ts` on purpose.
 * The dashboard components are `'use client'`, and importing the repository
 * interface into one would pull Mongoose — and the whole data layer — into the
 * client bundle. A type-only import is erased at build time so the bundler
 * would not actually follow it, but the *name* lives here anyway so the wire
 * format has exactly one definition that both sides can see.
 *
 * `UserWithProfile` is the server-side shape: it is keyed on `_id` and, in
 * principle, carries `password`. This one is keyed on `id`, because that is what
 * the session token is keyed on (`UserPayload` in `auth.ts`) and what the
 * dashboards compare against.
 *
 * Everything except `id`, `name`, `email` and `role` is optional because
 * `/api/auth/me` returns whatever the user row happened to contain.
 */

export interface SessionUser {
    id: string;
    name: string;
    email: string;
    role: string;
    phone?: string | null;
    isActive?: boolean;
    farmerProfile?: {
        farmName?: string;
        location?: string;
        state?: string;
        district?: string;
    } | null;
}
