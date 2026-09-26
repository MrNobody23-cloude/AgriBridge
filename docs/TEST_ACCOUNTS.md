# Development / Testing Accounts — Development Only

> ⚠️ DEVELOPMENT / TESTING ONLY. Never use in production.
> These accounts are created by `npm run seed:test-users` using `TEST_USER_PASSWORD` from .env.

| Email | Role | Password (env-controlled) |
|---|---|---|
| farmer@agribridge.test | FARMER | `$TEST_USER_PASSWORD` (default SecretApp123!) |
| exporter@agribridge.test | EXPORTER | `$TEST_USER_PASSWORD` (default SecretApp123!) |
| transporter@agribridge.test | TRANSPORTER | `$TEST_USER_PASSWORD` (default SecretApp123!) |
| importer@agribridge.test | IMPORTER | `$TEST_USER_PASSWORD` (default SecretApp123!) |
| retailer@agribridge.test | RETAILER | `$TEST_USER_PASSWORD` (default SecretApp123!) |
| consumer@agribridge.test | CONSUMER | `$TEST_USER_PASSWORD` (default SecretApp123!) |
| regulator@agribridge.test | REGULATOR | `$TEST_USER_PASSWORD` (default SecretApp123!) |
| admin@agribridge.test | ADMIN | `$TEST_USER_PASSWORD` (default SecretApp123!) |

## Seed command
```bash
npm run seed:test-users
```

Idempotent — running twice creates no duplicates (findUnique before create).
Passwords are hashed with bcrypt cost 12. Never stored in plaintext.
