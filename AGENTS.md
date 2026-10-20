# AGENTS.md — rules for anyone (human or AI agent) changing this repository

## 1. Keep the feature status report current (mandatory)

Whenever a feature, API route, permission, database schema, migration, integration or test status is added, modified, removed or verified, update `docs/PROJECT_FEATURE_STATUS.md` in the same change. Update only statuses supported by evidence, record the verification date and results, and preserve unresolved risks. Do not mark a feature COMPLETE — VERIFIED without appropriate evidence.

How to apply it:
- Status values: COMPLETE — VERIFIED, IMPLEMENTED — PARTIALLY VERIFIED, PARTIALLY IMPLEMENTED, BLOCKED, NOT IMPLEMENTED, NOT VERIFIED, DEFERRED (definitions are in the report).
- Evidence means a named passing test, a reproducible live HTTP check (`scripts/e2e/`), or a documented manual check. File existence, a successful compile or an HTTP 200 is not evidence that a feature works.
- Mark evidence **[R]** only when you re-ran it on the date you write. Keep older results as **[H]** (historical).
- Add a row to "Change history" and refresh the counts table, the test/build results and the latest verified commit.
- Never delete a risk or blocker to make the report look better; remove it only when it is actually resolved and say how.

Enforcement: this is a written rule plus an optional local check. `node scripts/check-feature-status.mjs --base origin/main` (also `npm run check:feature-status`) fails when feature-defining files changed but the report did not. To run it before every commit: `git config core.hooksPath .githooks`. There is **no CI** in this repository yet, so nothing blocks a push automatically, and the check only proves the report file was touched, not that it is correct. Reviewers must read the report diff.

## 2. Frontend verification builds

While the development server is running, verification builds must not overwrite its `.next` directory:

```powershell
cd apps/web
$env:NEXT_DIST_DIR = '.next-build'
npx tsc --noEmit
npx next build
```

`NODE_ENV` must not be `development` when running `next build` (it makes the build fail with exit code 1 on `/_not-found`). Clear it or set it to `production` first, for example after starting the API for live checks.

## 3. Safety rules

- Never touch the real `dentalease_db` or change database credentials, firewall settings or listen addresses without an explicit owner instruction. Do not apply migrations: proposed ones live in `database/proposals/` and need owner approval.
- Integration tests and `scripts/e2e/*` may only use a disposable local database. The e2e scripts refuse any database whose name does not contain `test`, `tmp`, `disposable` or `e2e`. Set `TEST_DATABASE_URL` only for such a database.
- Do not call live payment or messaging providers (Razorpay, Twilio, 360Dialog, SES, S3) from tests or scripts. Use mocks or provider sandboxes with test credentials.
- Never commit `.env` files, secrets, database dumps, `node_modules`, `dist`, `.next`, `.next-build`, or temporary databases. `.env.example` must contain placeholders only.
- Do not operate on a parent directory repository: the repository root is the directory containing this file. Check `git rev-parse --show-toplevel` before committing.
- No force-push. Do not rewrite published history.

## 4. Commands

```powershell
# API (apps/api)
npx tsc --noEmit
npm run build
npx jest                       # unit tests; *.int.spec.ts are skipped without TEST_DATABASE_URL
$env:TEST_DATABASE_URL='<disposable database url>'; npx jest   # adds the integration suites

# Web (apps/web) — see section 2
```
