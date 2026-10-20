# Live HTTP checks (disposable database only)

These scripts exercise the REAL running API (guards, tenant middleware, validation, throttling) with locally signed test tokens.
They create and delete their own rows and are refused unless `DATABASE_URL` is a local database whose name contains `test`, `tmp`, `disposable` or `e2e`.

| Script | What it checks |
|---|---|
| `revenue-and-permissions.js` | revenue access, money redaction per role, tenant isolation, consent default, appointment money redaction (102 checks) |
| `whatsapp-appointment-routes.js` | 401/403 on send/send-template/appointment mutations, consent, cross-clinic, start-booking gate and rate limit (30 checks) |
| `price-exposure-probe.js` | prints which roles see which money fields on each route (documentation evidence, no pass/fail) |

## Run
1. Start a disposable PostgreSQL with the schema applied (`prisma db push` against the disposable DB), a throwaway Redis, and the built API (`apps/api`, `node dist/main`) with a random `JWT_SECRET`.
2. `DATABASE_URL=<disposable> API_BASE=http://127.0.0.1:3011/api/v1 JWT_SECRET=<same secret as the API> node scripts/e2e/<script>.js`

Note: the API applies a global 100 requests/minute limit per client; the longest script makes close to that many calls, so run them one at a time.
