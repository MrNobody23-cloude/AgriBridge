/**
 * Reading a Zod validation failure out of a `catch` block.
 *
 * ## Why this exists
 *
 * Ten route handlers were written as:
 *
 * ```ts
 * } catch (error: any) {
 *     if (error.name === 'ZodError') {
 *         return errorResponse(error.errors[0]?.message || 'Validation failed', 'VALIDATION_ERROR', 400);
 *     }
 * ```
 *
 * The project is on **Zod 4** (`zod@4.5.4`). Zod 4 renamed the issue array
 * from `error.errors` to `error.issues`; `error.errors` is `undefined`. The
 * optional chaining made the failure quiet at the type level and the bug
 * invisible to `tsc` — but at runtime `error.errors[0]` threw
 * `TypeError: Cannot read properties of undefined (reading '0')`.
 *
 * So a bad request payload was never reported as a 400. It escaped the
 * `catch` block's own logic, got caught by whatever `catch` came next (usually
 * none — it propagated to the framework), and surfaced as a **500**. The user
 * saw a server error for their own typo, and the validation message was lost.
 *
 * ## Why `instanceof` and not `error.name`
 *
 * `instanceof z.ZodError` is the check Zod documents and it is what survives a
 * library upgrade; the `name` string is an implementation detail that has
 * already changed once here. The `name` check is kept as a fallback because
 * some middleware re-throws a *rehydrated* error that no longer shares the
 * constructor identity — across module instances, or after a bundler has
 * duplicated the module.
 */

import { z } from 'zod';

interface ZodLikeError {
    issues?: Array<{ path?: Array<string | number>; message?: string }>;
    errors?: Array<{ path?: Array<string | number>; message?: string }>;
    message?: string;
}

/** Is this a Zod validation failure? Safe on `unknown` and on `null`. */
export function isZodError(error: unknown): error is z.ZodError {
    if (error instanceof z.ZodError) return true;
    if (typeof error !== 'object' || error === null) return false;
    const name = (error as { name?: unknown }).name;
    return name === 'ZodError';
}

/**
 * The first validation message, phrased for a human.
 *
 * Prefers a single field's message, because "email: Invalid email address"
 * tells a caller which part of the payload to fix. Falls back to the
 * multi-issue summary ("2 validation errors") and finally to a fixed string,
 * so this never returns `undefined` — the caller can pass it straight to
 * `errorResponse`.
 */
export function firstValidationMessage(error: unknown, fallback = 'Validation failed'): string {
    if (!isZodError(error)) return fallback;

    const issues = (error as ZodLikeError).issues ?? (error as ZodLikeError).errors;
    if (!Array.isArray(issues) || issues.length === 0) return fallback;

    const first = issues[0];
    const field = first.path && first.path.length > 0 ? first.path.join('.') : null;
    if (field && first.message) return `${field}: ${first.message}`;
    return first.message || fallback;
}
