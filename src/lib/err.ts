/**
 * Reading a caught value's message without lying about its type.
 *
 * The dashboard pages were written as `catch (err: any) { alert(err.message) }`.
 * `err.message` is only a property on `Error` instances — a `fetch` that
 * rejects with a string, or a thrown object literal, makes it `undefined`, and
 * the user sees "undefined" where the real reason should be. Narrowing first
 * means the fallback text is shown *only* when there genuinely is no message.
 *
 * This lives beside `api-types.ts` rather than in `zod-error.ts` because the
 * dashboards are `'use client'`: it must not pull anything server-side in.
 */

/** `err.message` for a `catch (err: unknown)`, or an empty string. */
export function errText(err: unknown): string {
    return err instanceof Error ? err.message : '';
}
