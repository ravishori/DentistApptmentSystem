# Sensitive-data authorisation review: patients, conversations and authentication

Review date: 2026-10-21. Evidence references are tests in `apps/api/src` and the live script `scripts/e2e/auth-and-contracts.js`.
"Fixed" means changed and covered by a test. "Flagged" means a policy decision is needed; nothing was changed. WhatsApp/Twilio code was **not** modified (findings there are deferred).

## Patients

| # | Finding | Evidence | Action |
|---|---|---|---|
| P1 | `POST /patients` and `PATCH /patients/:id` returned the full row including `outstandingBalance` to every role (the list/detail/timeline routes were already redacted) | `patients-notifications-contract.http.spec.ts` ("update response hides outstandingBalance…", "create also hides…"); live check `PATCH response (assistant) has no outstandingBalance` | **Fixed** (`redactPatientRecord`) |
| P2 | `GET /patients/stats` did not exist; the patients page called it and got a 400 (`stats` parsed as an id) | Contract spec; live `GET /patients/stats` 200 | **Fixed**: counts for everyone, `totalOutstanding` only with `billing:read` (key removed, `financialsRestricted: true`) |
| P3 | Update spread the request body into the Prisma `data` object. The global ValidationPipe whitelist protected the HTTP path, but any other caller of the service could write `clinicId`, `outstandingBalance`, `patientCode`, `totalVisits`, `isActive` | `patients.int.spec.ts` (mass-assignment test on real PostgreSQL); HTTP spec; live mass-assignment check | **Fixed**: explicit field list; omitted keys are not written (so an omitted `waOptIn` never rewrites consent — `consent.spec.ts`) |
| P4 | Tenant scoping of read/update/stats | `patients.int.spec.ts` cross-clinic update → 404, stats per clinic | Verified, no change needed |
| P5 | **No permission guard on any `/patients` route.** The permission matrix gives `patients:read` to dentist and receptionist, and `patients:write` to the receptionist only; `assistant` has neither. Documents and EHR routes already enforce `patients:read/write`, so an assistant is blocked from documents but can list, read, create and edit patients | Route inventory, `docs/PROJECT_FEATURE_STATUS.md` A4 | **Flagged — decision needed.** Applying the matrix would (a) remove the assistant's patient lookup and (b) stop dentists editing demographics, allergies and medical history (they hold read only). Both are clinical-workflow decisions |
| P6 | Patient detail returns every clinical column (allergies, conditions, date of birth) to any role that can open the record | Code review | Flagged with P5 |
| P7 | `phone` is only `@IsString()` on create (no E.164 check), yet WhatsApp consent and manual sends match on the stored phone string | Code review | Flagged: normalise/validate phone format (affects existing data) |
| P8 | `GET /patients/:id/family` returns family members' phone, date of birth and gender to any role | Code review | Flagged with P5 |

## Conversations (WhatsApp module — deferred, not modified)

| # | Finding | Action |
|---|---|---|
| W1 | `GET /whatsapp/conversations` and `/conversations/:id/messages` have no permission guard: any authenticated role reads patient chats | Deferred (WhatsApp out of scope). Candidate: `whatsapp:send` or a new read permission — decision needed |
| W2 | Conversation list returns the whole `whatsapp_conversations` row, including the `context` JSON and assignment fields; messages include `externalId` and `failureReason` | Deferred: add an explicit `select` |
| W3 | `page`/`limit` are `+page`, `+limit` on raw query strings: `limit=1000000` loads everything, `limit=abc` becomes `NaN` | Deferred: DTO with `@Min/@Max` |
| W4 | Twilio inbound webhook has no signature verification | Deferred (P0 in the status report) |

## Authentication (new regression coverage; no policy invented)

| # | Finding | Evidence | Action |
|---|---|---|---|
| A1 | `POST /auth/logout` never passed the access token to `AuthService.logout`, which exists to revoke it: the token kept working until expiry | `auth.http.spec.ts`, live `the SAME access token is rejected immediately after logout` | **Fixed** |
| A2 | Refresh tokens carried only `sub/iat/exp`: two tokens issued to one user in the same second were byte-identical, so rotating within a second returned the same token and a rotated token could be replayed against its replacement; logging out one session revoked both | `auth.service.spec.ts` ("two tokens issued … are different", "REPLAY…") | **Fixed**: unique `jti` per refresh token |
| A3 | `password` accepted a JSON number or object because implicit conversion turned it into `"12345678"` / `"[object Object]"` before validation | `auth.http.spec.ts`, live check | **Fixed** for login and register (`KeepRaw`). The same weakness exists in other DTOs (status report M1) |
| A4 | Role is read from the database on every request; a `role` claim in the token is ignored | `auth.http.spec.ts` ("role comes from the DATABASE") | Verified, no change |
| A5 | Expired, tampered, `alg=none`, wrong-secret, refresh-secret, revoked, user-revoked, deleted-user and deactivated-user tokens are all rejected with 401 | `auth.http.spec.ts` | Verified |
| A6 | Lockout: 5 consecutive failures lock the account for 15 minutes, even the correct password is refused while locked, and the counter resets on success | `auth.service.spec.ts`, live | Verified |
| A7 | The counter is not reset when a lock expires, so the first wrong password after an expired lock locks again immediately; the failed-count update is not atomic (parallel guesses can under-count) | Code review | **Flagged** (policy choice) |
| A8 | Login distinguishes "Account deactivated" and "Account locked until …" from "Invalid credentials" *before* the password is checked, so email existence and lock state can be enumerated | `auth.service.spec.ts` documents the current behaviour | **Flagged** (policy choice) |
| A9 | `/auth/refresh` does not check `isActive` (the next access token is then rejected by the strategy, so impact is limited) and a replayed refresh token is rejected without revoking the user's other sessions | Code review | Flagged |
| A10 | Access tokens have no `jti`; two sessions of the same user issued in the same second can share an identical token, and blacklisting keys on the last 32 token characters | Code review | Flagged (low) |
| A11 | Token blacklist and user-revocation checks fail open if Redis is down | `token-blacklist.service.ts` comments | Flagged (documented design) |
| A12 | Open self-registration of new clinics | Existing behaviour | Flagged (policy: invite-only vs open) |
