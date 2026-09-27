/**
 * Test environment, loaded by Vite before any test module is imported.
 *
 * This has to be a separate file rather than assignments at the top of a test.
 * ES module imports are hoisted — TypeScript emits every `import` above every
 * other statement — so `process.env.AUTH_SECRET = '…'` written above an
 * `import { … } from '../src/lib/auth'` line does not run before that import is
 * evaluated. `auth.ts` reads the variable at module scope and throws when it is
 * missing, so the suite failed to collect entirely.
 *
 * `setupFiles` runs before the test module graph is imported, which is the one
 * point that is guaranteed to be earlier.
 *
 * Nothing here connects to a database. The auth tests exercise JWT signing,
 * password hashing and the permission map, none of which touch MongoDB, so
 * `npm test` stays runnable with no database running — which is what CI
 * relies on.
 */

process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'test_secret_for_agribridge_jwt';

// A syntactically valid URI, so `connectToDatabase` would parse it if anything
// ever did call it. It is never dialled in this suite.
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/agribridge_test';
