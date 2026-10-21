# AI Dentist Appointment System — Feature Status Report

> Living document. Maintained under the rule in [`AGENTS.md`](../AGENTS.md): any change to a feature, route, permission, schema, migration, integration or test status must update this file in the same change.
> Statuses are evidence-based. "Compiles" or "page returns 200" is never treated as proof that a feature works.

| | |
|---|---|
| Report date | 2026-10-21 |
| Repository | `D:\ravishori\DentistAptSystem` (remote `origin` = `https://github.com/ravishori/DentistApptmentSystem.git`) |
| Baseline commit before this audit | `ad4a92e` (`chore: initialise AI dentist appointment system`) |
| Latest verified commit | `3e6defb` (code and tests verified 2026-10-21; docs-only commit follows) |
| Production readiness | **NO-GO** — see section 2 |

Evidence tags: **[R]** = re-run on 2026-10-21 during this audit. **[H]** = historical: produced earlier in this project, supported by saved files, not re-run on that date.

---

## 1. Project overview and actual architecture

Multi-tenant (one clinic = one tenant) dental practice system for India: appointments, patients, clinical records, billing, WhatsApp automation, analytics.

| Layer | Actual implementation (from the repository) |
|---|---|
| API | NestJS 10, URI versioning `/api/v1`, global guards in order: Throttler (100/min/IP), JWT, TenantIsolation, Roles, Permissions; ValidationPipe (whitelist, transform, implicit conversion); Audit, Logging and Transform interceptors; HTTP exception filter; Helmet; CORS; sanitization middleware |
| Web | Next.js 14 App Router, React 18, TanStack Query, Tailwind. Dev server on :3000 |
| Data | PostgreSQL via Prisma 5.22 (`database/schema.prisma`, 37 models); raw SQL in `database/*.sql`; **no `prisma/migrations` history** (`db push` / SQL files) |
| Cache / queues | Redis (cache, WhatsApp sessions, rate/ambiguity state), Bull queues for notifications |
| Integrations | Razorpay (payments, webhook), Twilio WhatsApp and 360Dialog (messaging), AWS S3 (documents), AWS SES (email) |
| Multi-tenancy | Shared database, shared schema; clinic id comes from the verified JWT and is applied in service queries. **No database-level row-level security** (commented out in `database/schema.sql`) |
| Roles | `super_admin`, `clinic_admin`, `dentist`, `receptionist`, `assistant`; permission matrix in `apps/api/src/common/guards/permissions.guard.ts` |
| Mounted API modules | analytics (+revenue), appointments, auth, billing (+Razorpay webhook), clinic, clinic-management, documents, ehr, errors, notifications, patients, prescriptions, whatsapp (+broadcast) |
| **Present in source but NOT mounted in `AppModule`** | `tenants`, `treatments`, `users` (routes return 404; see F-rows below) |
| Web pages | login, register, dashboard, appointments, patients (+documents, ehr, prescriptions), billing, analytics, clinic, settings, treatments, whatsapp, public payment page `/pay/[orderId]` |
| Deployment assets | `docker-compose.yml` (postgres 16, redis 7, api, web), `apps/*/Dockerfile`, no CI workflows, no `.github` |
| Tests | Jest 29 + ts-jest in `apps/api` only. **No frontend tests, no browser/E2E tests, no auth tests.** Live HTTP check scripts live in `scripts/e2e/` |

## 2. Overall readiness assessment

**Not production-ready.** The API core (appointments, billing permissions, revenue privacy, reminder logic, consent) has meaningful automated and live-HTTP evidence. Several gates are unresolved:

| Gate | State |
|---|---|
| PostgreSQL credential for the real `dentalease_db` | **Unresolved** — not reset or touched by this work |
| Verified backup + restore of `dentalease_db` | **Not done** — procedure documented in `database/proposals/migrations/README.md`; never executed |
| Database migrations | 3 proposed, **unapplied and unapproved** (`database/proposals/migrations/`) |
| Provider sandbox verification (Razorpay, Twilio, 360Dialog) | **Not done** — all provider behaviour is tested against mocks only |
| Twilio inbound webhook authenticity | **No signature verification** (P0) |
| Authentication behaviour (register, login, lockout, refresh, logout) | **Covered** by 65 unit/HTTP tests and 41 live checks (2026-10-21). Open policy items remain: enumeration, open signup, fail-open blacklist |
| Frontend ↔ API contract | Method/path contract is now test-enforced (110 checks). Payload schemas verified only for tested flows; treatment plans intentionally unavailable |
| Frontend tests, accessibility and responsive verification | **None automated**; not verified in a browser this session |
| Administrator alert e-mail delivery | Code path verified against a LOCAL SMTP sink only. **No real recipient/SMTP provider is configured or verified**; alerting is disabled by default (no recipient). Owner must configure and run the test alert |
| Operational config (PostgreSQL listen address/firewall, Swagger exposure, container ports, external uptime monitoring, backups) | **Unresolved** |

## 3. Summary of features by status

| Status | Count | Feature IDs |
|---|---|---|
| COMPLETE — VERIFIED | 22 | A2, A3, C2, C3, C7, D2, D4, D5, G1, I1, I2, I3, J1, J2, J3, M4, M8, M9, M10, P1, P2, P4 |
| IMPLEMENTED — PARTIALLY VERIFIED | 39 | A1, A4, B1, C1, C4, D1, D3, D6, D7, F1, F2, F3, G2, I5, J4, J6, J7, K1, K2, L1, L2, L4, L5, L6, L7, L8, L9, L10, L11, M1, M2, M11, M12, M13, M14, N1, O1, O2, O4 |
| PARTIALLY IMPLEMENTED | 7 | B3, E3, F5, H3, J12, L3, M7 |
| BLOCKED | 5 | C6, F4, I4, N2, N4 |
| NOT IMPLEMENTED | 4 | B2, J8, N3, O3 |
| NOT VERIFIED | 16 | A5, C5, E1, E2, F6, G3, H1, H2, I6, I7, J5, J9, M3, M5, M6, P3 |
| DEFERRED | 2 | J10, J11 |
| **Total** | **95** | |

Rows counted: the feature rows in section 4 (IDs A1–P3).

## 4. Feature-by-feature status matrix

Columns: **Where** = frontend page(s) / backend routes and modules (source under `apps/web/src/app`, `apps/api/src/modules`). **Evidence** = tests/checks (counts are tests in the named spec file). **Verified** = date the evidence was last re-run (`—` = no evidence).

### A. Authentication, sessions and role-based access

| ID | Feature | Status | Where | Evidence | Gaps, defects, risks | Next action | Verified |
|---|---|---|---|---|---|---|---|
| A1 | Clinic registration (public, creates clinic + first `clinic_admin`, 14-day trial) | IMPLEMENTED — PARTIALLY VERIFIED | `(auth)/register`; `POST /auth/register` (5/min); `auth/auth.service.ts` | `auth.service.spec.ts` (23: tenant + admin created, bcrypt cost 12, no plaintext/hash in response, duplicate → 409); `auth.http.spec.ts` (42: validation 400s, body fields like `role` stripped, 429 on the 6th); live `auth-and-contracts.js` 41/41 [R] | Self-service signup lets anyone create a tenant; no email verification; password policy is only min length 8 (**policy decision**) | Decide signup policy | 2026-10-21 |
| A2 | Login, bcrypt(12), lockout after 5 failures for 15 min | COMPLETE — VERIFIED | `(auth)/login`; `POST /auth/login` (10/min) | `auth.service.spec.ts`, `auth.http.spec.ts`, live: wrong password → 401 (same message as unknown email), 5th failure locks, correct password refused while locked, works after expiry and counter resets [R] | Flagged, unchanged: lock state / deactivation distinguishable before password check (enumeration); counter not reset on lock expiry; non-atomic counter; no MFA (see `docs/security/sensitive-data-authorisation-review.md` A7–A8) | Policy decisions | 2026-10-21 |
| A3 | Token handling: JWT access, 30-day refresh with rotation, logout revoke | COMPLETE — VERIFIED | `POST /auth/refresh`, `/logout`, `GET /auth/me`; `jwt.strategy.ts`, `jwt-auth.guard.ts`, `token-blacklist.service.ts` | `auth.http.spec.ts` (expired, tampered, `alg=none`, wrong secret, refresh-secret token, revoked, user-revoked, deleted and deactivated user → 401; role taken from DB not claim); `auth.service.spec.ts` (rotation, replay, expired, orphan, cross-user); live with real Redis: refresh replay 401, logout → same access token 401 immediately [R]. **Defects fixed:** logout did not revoke the access token; identical refresh tokens within one second | Blacklist fails open if Redis is down; refresh does not check `isActive`; access tokens have no `jti` (A9–A11) | Decide fail-open policy | 2026-10-21 |
| A4 | Role and permission model | IMPLEMENTED — PARTIALLY VERIFIED | `permissions.guard.ts` (`ROLE_PERMISSIONS`, `roleHasPermission`), `roles.guard.ts` | `permissions.guard.spec.ts` (17), `whatsapp-routes.http.spec.ts` (74), `auth.http.spec.ts` (admin-only route: assistant/receptionist/dentist → 403, token role claim cannot escalate), live matrix [R] | Many routes have **no** permission guard: all of `patients`, non-revenue `analytics`, `clinic-management` GETs, `notifications`, `whatsapp/conversations*`, appointment reads. Applying the matrix to patients would remove assistant lookup and dentist demographic edits (decision P5) | Decide patients/analytics/appointment-read enforcement | 2026-10-21 |
| A5 | Super-admin seed | NOT VERIFIED | `apps/api/src/database/seed.ts` (needs `SUPER_ADMIN_EMAIL/PASSWORD`) | None | Credential supplied via env only; never exercised here | Test on a disposable DB | — |

### B. Clinic and tenant isolation

| ID | Feature | Status | Where | Evidence | Gaps, defects, risks | Next action | Verified |
|---|---|---|---|---|---|---|---|
| B1 | Application-level tenant scoping (clinic from verified token, never from body) | IMPLEMENTED — PARTIALLY VERIFIED | `tenant.decorator.ts`, `tenant-isolation.guard.ts`, all services | `tenant.decorator.spec.ts` (4); `route-security.int.spec.ts` (appointments, consent, start-booking cross-clinic); `revenue.int.spec.ts`; live cross-clinic checks [R] | Cross-tenant access **not tested** for invoices/payments, EHR, documents, prescriptions, clinic-management, notifications | Add cross-tenant tests per module | 2026-10-21 |
| B2 | Database-level isolation (RLS) | NOT IMPLEMENTED | `database/schema.sql` lines ~1108+ (commented out, "optional") | — | One application bug can cross tenants; single DB role | P2: evaluate RLS after credential/role cleanup | — |
| B3 | Tenant settings / users / treatments modules | PARTIALLY IMPLEMENTED | `modules/tenants`, `users`, `treatments` (controllers exist, **not mounted**) | Probe: routes 404 for all roles [H] | If mounted as-is: trust of body-supplied tenant data, mass assignment, `passwordHash` exposure risks identified in review [H] | Fix before mounting; decide whether needed | 2026-10-21 (404 confirmed in route inventory) |

### C. Patients, records and privacy

| ID | Feature | Status | Where | Evidence | Gaps, defects, risks | Next action | Verified |
|---|---|---|---|---|---|---|---|
| C1 | Patient CRUD, list/search | IMPLEMENTED — PARTIALLY VERIFIED | `patients`, `patients/[id]`; `/patients*`; `patients.service.ts` | `patients.int.spec.ts` (8, real PostgreSQL: update, mass-assignment, cross-clinic 404); `patients-notifications-contract.http.spec.ts` (26); live: `PATCH` persists, `PUT` 404, protected fields ignored, create/update responses redacted for non-billing roles [R]. **Fixed:** client used `PUT`; create/update leaked `outstandingBalance`; update spread the body into Prisma | No permission guard on any `/patients` route (assistant can read/create/edit PHI) — decision P5; `phone` format not validated | Decide guard policy | 2026-10-21 |
| C2 | Patient privacy: balance/invoice redaction without `billing:read` | COMPLETE — VERIFIED | `patient-financials.ts`, `patients.controller.ts` | `patient-financials.spec.ts` (9); live: assistant sees no `outstandingBalance`/`invoices` [R] | Free-text PHI still visible to all roles (see A4) | — | 2026-10-21 |
| C3 | WhatsApp consent flag (opt-in default false; strict boolean input; enforced on automated and manual sends) | COMPLETE — VERIFIED | `patient.dto.ts`, `strict-boolean.ts`, senders, broadcast filter | `consent.spec.ts` (13), `strict-boolean.spec.ts` (44), `reminder-dedupe.int.spec.ts`, `route-security.int.spec.ts` [R] | START re-subscribe not implemented (see M5) | — | 2026-10-21 |
| C4 | Family links and patient timeline | IMPLEMENTED — PARTIALLY VERIFIED | `/patients/:id/family`, `/timeline`, `PATCH /patients/:id/family-link` | Timeline money redaction live-checked [R] | Family-link logic untested | Add tests | 2026-10-21 |
| C5 | Patient documents (upload, S3, presigned URLs, search) | NOT VERIFIED | `patients/[id]/documents`; `/patients/:id/documents*`; `documents.controller.ts` (`patients:read/write`) | None | S3 unavailable here; 50 MB in-memory upload per request; file-type validation not reviewed | Test with a mock S3; limit size/type | — |
| C6 | Emergency contact on patients | BLOCKED | `patients.dto.ts` (API returns 400 if sent) | — | Needs data-model/privacy decision (encryption, access) | Decide field design | 2026-10-21 |
| C7 | Patient statistics (`GET /patients/stats`: total, new this month, active 30 days, outstanding total) | COMPLETE — VERIFIED | `patients` page strip; `patients.service.ts#getStats` | HTTP contract spec (route precedence over `:id`, money redaction), `patients.int.spec.ts` (counts per clinic, injected clock, empty clinic), live owner vs assistant [R]. **Fixed:** route did not exist, page got 400 | Outstanding total needs `billing:read` (key removed otherwise) | — | 2026-10-21 |

### D. Appointments

| ID | Feature | Status | Where | Evidence | Gaps, defects, risks | Next action | Verified |
|---|---|---|---|---|---|---|---|
| D1 | Slots: available, generate, block/unblock | IMPLEMENTED — PARTIALLY VERIFIED | `/appointments/slots*`; `slots.service.ts` | `m7-availability.spec.ts` (11), `m7-booking.spec.ts` (9) [R]. **Slot manager (uncommitted at the time of writing)**: `appointments-slot-routes.http.spec.ts` (29: block/unblock only for clinic_admin, super_admin, receptionist — dentist/assistant 403, anonymous 401; clinic and slot from token/path; reason validated: ≤200 chars, non-strings rejected; booked slot 409; other clinic 404; `GET slots?includeAll=true` only for those roles, other values never escalate), `slots-manage.spec.ts` (14: full-day list is clinic-scoped, validated and uncached; invalid dates → 400; block refuses booked slots; cache invalidated), `slots-manage.int.spec.ts` (10, real PostgreSQL: free/booked/blocked listing, cross-clinic isolation, block → hidden from free slots → unblock, cancel releases the slot, reschedule into a blocked slot refused, cross-clinic cancel/reschedule 404) [R]. **Real browser** (disposable stack): Manage slots lists a day's slots with state, block needs a reason and a confirmation, unblock needs a confirmation, a slot booked meanwhile gives the API's 409 message and refreshes the list, three rapid clicks send one request; live role matrix: receptionist 200/200/200, assistant and dentist 403 for includeAll, block and unblock [R]. **Fixed:** the block body type erased validation (any body accepted) and a JSON object/number was stored as `"[object Object]"`/`"123"`; malformed dates reached the database | Free-slot `GET slots` still has no permission guard (by design: staff lookup); `includeAll` is the only new surface and is role-gated; `includeAll` is an additive optional query on the existing route (no new endpoint); `slots/generate` has no UI | Decide whether free-slot lookup needs `appointments:read` | 2026-10-21 |
| D2 | Booking (API) | COMPLETE — VERIFIED | `POST /appointments` (`appointments:write`); `appointments.service.ts` | `m7-booking.spec.ts` (9), `m7-concurrency.int.spec.ts` (5), `route-security.int.spec.ts` (cross-clinic patient/dentist/slot), `whatsapp-routes.http.spec.ts` (401/403/validation), live 30/30 [R] | Assistants can no longer book (policy A3 in `docs/security/whatsapp-appointment-route-inventory.md`); `estimatedCost` settable by any `appointments:write` role | Confirm assistant policy | 2026-10-21 |
| D3 | Status transitions and cancellation | IMPLEMENTED — PARTIALLY VERIFIED | `PATCH /appointments/:id/status`; `assertValidTransition` | Permission, validation, cross-clinic tests [R] | Transition table has no dedicated test; `clinicalNotes` writable via status route by receptionist | Add FSM tests; decide notes policy | 2026-10-21 |
| D4 | Reschedule | COMPLETE — VERIFIED (API and client contract); UI verified in a real browser by hand | `POST /appointments/:id/reschedule`; `appointments.service.ts` | `patients-notifications-contract.http.spec.ts` (POST ok, PATCH 404, service errors → 400/404), `route-security.int.spec.ts` (cross-clinic), live: moves the appointment, unavailable slot → 400, assistant → 403 [R]. **Fixed:** client sent `PATCH`. **Reschedule dialog**: `appointment-dialogs.test.tsx` (22 with the other dialogs): accessible modal, free times as a radio group, loading / empty / failed / ready states, past dates blocked; `appointment-rules.test.ts` (42 with the other rules): form validation and the exact request body [R]. `appointments-slot-routes.http.spec.ts`: validation (bad date/time, over-long or non-string reason), roles, 409/400/404 propagation [R]. **Real browser**: moved a booking to a free time (old row `rescheduled` with the reason, new row `scheduled`); picking a time that someone else booked meanwhile showed the API's "not available" message, cleared the selection and refreshed the list; three rapid clicks sent one request [R] | Dialog behaviour (typing, clicking, mutation errors) is not covered by an automated browser test: the web tests render on the server only. Reschedule keeps the same dentist (API rule); the UI offers it for scheduled/confirmed appointments only. The page shows Reschedule/Cancel to roles that the API refuses (assistant): the refusal is shown in the dialog, but the buttons are not hidden (see L3) | Add Playwright tests; hide actions by permission | 2026-10-21 |
| D5 | Appointment money redaction (estimated cost, invoice, treatment prices) | COMPLETE — VERIFIED | `appointment-financials.ts`, `appointments.controller.ts` | `appointment-financials.spec.ts` (9); live role matrix [R] | Reads still unguarded by `appointments:read` | — | 2026-10-21 |
| D6 | Appointments UI (week calendar, book modal) | IMPLEMENTED — PARTIALLY VERIFIED | `(dashboard)/appointments`, `components/appointments/book-modal.tsx`, `components/appointments/{cancel-dialog,reschedule-dialog,slot-manager,dialog-shell}.tsx`, `lib/appointment-rules.ts` | `tsc` + `next build` pass [R]; `appointment-rules.test.ts` + `appointment-dialogs.test.tsx` (64) [R]: which actions each status offers (mirrors the API state machine), form rules, dialogs in loading/empty/failed/ready states, the page's per-status buttons, `Manage slots` shown only to clinic_admin and receptionist. **Real browser** (Chromium pane, disposable stack, generated slots, demo data): cancel needs a confirmation and a reason (empty and 2-character reasons show an inline error and send no request; success records `cancelReason` and frees the slot; three rapid clicks → one request); an API refusal for an assistant (403) is shown inside the dialog; reschedule and slot manager as in D4/D1; role visibility checked for admin, receptionist, dentist and assistant [R]. **Fixed during the browser pass:** the double-submit guard relied on React state and let three same-tick clicks send three requests; it now uses a synchronous ref | Week view, drag-and-drop, the booking modal (patient is a free-text id) and the mobile agenda were not part of this browser pass; no automated browser (Playwright) tests; verification used scripted DOM actions in one session; loading skeletons are covered by server-render tests only; no server-error (5xx/network) drill in the browser; assistants still see Cancel/Reschedule/Start/Complete buttons the API will refuse (L3) | Playwright tests; hide actions by permission; week-view reschedule | 2026-10-21 |
| D7 | Clinic management: chairs, doctor availability, schedule overrides, free slots, day schedule, booking via `/clinic-management/appointments` | IMPLEMENTED — PARTIALLY VERIFIED | `clinic` page; `/clinic-management/*` | `m7-availability.spec.ts` (11) [R]; calendar, chair utilization and availability UI now show failures (were swallowed by empty `catch`) — `pages-error-states.test.tsx` [R] | Second booking entry point not covered by the new permission/tenant tests; GETs unguarded | Align with D2 rules; add tests | 2026-10-21 |

### E. Dentist and staff management

| ID | Feature | Status | Where | Evidence | Gaps, defects, risks | Next action | Verified |
|---|---|---|---|---|---|---|---|
| E1 | Staff create / activate / deactivate | NOT VERIFIED | `settings`; `POST /clinic/staff`, `PATCH …/activate|deactivate` (admin roles) | None | Role escalation, last-admin deactivation untested | Add tests | — |
| E2 | Dentist listings | NOT VERIFIED | `GET /clinic/dentists` (now used by the booking modal and prescription builder), `/clinic-management/doctors` | Contract spec proves the route exists with the right method; response content untested | Returns dentist email/phone to any role | Add tests | 2026-10-21 |
| E3 | Users module (`/users`) | PARTIALLY IMPLEMENTED | `modules/users` (unmounted) | Contract spec asserts no mounted `/users` route and no client call to it [R] | Client now uses `/clinic/dentists`; user creation remains `POST /clinic/staff` | Mount safely or delete the module | 2026-10-21 |

### F. Billing, invoices, payments, refunds, Razorpay

| ID | Feature | Status | Where | Evidence | Gaps, defects, risks | Next action | Verified |
|---|---|---|---|---|---|---|---|
| F1 | Invoices, stats, packages, enrollments, insurance claims, reports (GST, outstanding, daily revenue) | IMPLEMENTED — PARTIALLY VERIFIED | `billing` page; `/billing/*` (class `billing:read`, writes `billing:write`) | Permission gating live-verified [R] (assistant 403) | Calculations (totals, GST, packages) have no unit tests | Add calculation tests | 2026-10-21 |
| F2 | Razorpay order, verify, payment recording | IMPLEMENTED — PARTIALLY VERIFIED | `/billing/invoices/:id/order|pay`, `/payments/verify`; `razorpay.service.ts` | `razorpay-security.spec.ts` (23) [R] | **No sandbox call**; mocks only; `/billing/payments/verify` and checkout are public routes | Provider sandbox run | 2026-10-21 |
| F3 | Razorpay webhook (signature, idempotency) | IMPLEMENTED — PARTIALLY VERIFIED | `POST /billing/webhooks/razorpay` | `razorpay-webhook.spec.ts` (22), `razorpay-webhook.int.spec.ts` (7), `razorpay-idempotency.int.spec.ts` (3) [R] | Real Razorpay signatures/payloads untested | Sandbox webhook test | 2026-10-21 |
| F4 | Payment links | BLOCKED | `POST /billing/invoices/:id/payment-link` | — | Link URL not persisted: column proposed in unapplied migration `…invoice_payment_link` | Approve + apply migration | 2026-10-21 |
| F5 | Refunds | PARTIALLY IMPLEMENTED | `razorpay-webhook.service.ts` (`refund.processed/failed` → `recordRefund`) | Webhook spec [R] | No staff-initiated refund route or UI found | Decide scope | 2026-10-21 |
| F6 | Public payment page | NOT VERIFIED | `/pay/[orderId]`; `GET /billing/orders/:id/checkout` (public) | Build only [R] | Public route exposure review not done | Browser + security test | — |

### G. Dashboards, analytics, reports, charts

| ID | Feature | Status | Where | Evidence | Gaps, defects, risks | Next action | Verified |
|---|---|---|---|---|---|---|---|
| G1 | Private revenue trend + access grants | COMPLETE — VERIFIED | `analytics` page; `/analytics/revenue/*`; `revenue-access.service.ts` | `revenue-access.spec.ts` (58), `revenue.int.spec.ts` (14), live 102/102 [R] | UI chart not browser-tested | — | 2026-10-21 |
| G2 | Dashboard KPIs / LTV / funnel / trends with money redaction | IMPLEMENTED — PARTIALLY VERIFIED | `dashboard`, `analytics`; `/analytics/*` | Redaction live-checked [R]; all analytics sections render error / loading / empty states correctly (`pages-error-states.test.tsx`) [R] | Non-revenue analytics routes have no `analytics:read` guard; CSV exports (`/analytics/export/*`) not tested | Add guard decision + tests | 2026-10-21 |
| G3 | Billing reports UI | NOT VERIFIED | `components/billing/ReportsDashboard.tsx` | Build only | — | Browser test | 2026-10-21 |

### H. Prescriptions, clinical notes, treatments

| ID | Feature | Status | Where | Evidence | Gaps, defects, risks | Next action | Verified |
|---|---|---|---|---|---|---|---|
| H1 | Prescriptions + PDF + templates | NOT VERIFIED | `patients/[id]/prescriptions`; `/patients/:id/prescriptions*`, `/prescription-templates` (`treatments:read/write`) | None | Dentist-only write by matrix; PDF untested | Add tests | — |
| H2 | EHR: dental chart, visits, diagnoses, timeline | NOT VERIFIED | `patients/[id]/ehr`; `/patients/:id/ehr/*` (`patients:read`, `treatments:write`) | Chart/timeline money probe only [H] | Clinical correctness untested | Add tests | — |
| H3 | Treatment plans and procedure catalog | PARTIALLY IMPLEMENTED | `(dashboard)/treatments`; `treatments` module **unmounted** | Contract spec: calls exist only while the flag `TREATMENTS_API_AVAILABLE` is false and the module is unmounted; page shows "Treatment plans are not available yet" before any request [R] | Price policy undecided (`docs/security/treatment-price-policy.md`) | Decide policy, mount, flip flag | 2026-10-21 |

### I. Notifications, reminders and scheduled jobs

| ID | Feature | Status | Where | Evidence | Gaps, defects, risks | Next action | Verified |
|---|---|---|---|---|---|---|---|
| I1 | In-app notifications: list and read-status | COMPLETE — VERIFIED (read-status) | `/notifications`, `PATCH /notifications/read`, `/read-all` | HTTP contract spec (ids validated, per-id route 404, caller+clinic scoping), live: marks only my notification, never another user's [R]. **Fixed:** client called a non-existent `PATCH /notifications/:id/read` | `list` has no dedicated test; no page calls `markRead` yet | Add list test + UI hook | 2026-10-21 |
| I2 | Two-hour reminder window (midnight-safe, active statuses only, consent) | COMPLETE — VERIFIED | `reminder-window.ts`, `reminders.service.ts` (cron `*/30`) | `reminder-window.spec.ts` (28, incl. a brute-force minute oracle), `reminder-dedupe.int.spec.ts` (real DB) [R] | Goes through 360Dialog only; noisy retries if unconfigured | — | 2026-10-21 |
| I3 | Reminder claim/lease (no duplicate sends under concurrency) | COMPLETE — VERIFIED | `reminder-claim.ts` | `reminder-dedupe.int.spec.ts` (51) on disposable PostgreSQL [R] | Residual at-least-once risk on ambiguous provider failures if Redis absent | — | 2026-10-21 |
| I4 | 48h reminder step | BLOCKED | `reminder.flow.ts` (cron) | — | Needs migration `…reminder_status_sent_48h` (unapplied) | Approve migration | 2026-10-21 |
| I5 | 24h reminder batching | IMPLEMENTED — PARTIALLY VERIFIED | `reminder.flow.ts` | Dedupe tests [R] | Whole-day batch can fire ~48h early | Decide window | 2026-10-21 |
| I6 | Email (SES) | NOT VERIFIED | `notifications.service.ts`, `error-email.service.ts` | None | Provider unavailable | Sandbox test | — |
| I7 | Notification generation and delivery (domain events → Bull queue → processor) | NOT VERIFIED | `notifications.service.ts` (`@OnEvent`), `processors/notifications.processor.ts` | None | Queue behaviour and provider delivery unverified | Add integration test | — |

### J. WhatsApp, Twilio and other integrations (audit only — not modified in this task)

| ID | Feature | Status | Where | Evidence | Gaps, defects, risks | Next action | Verified |
|---|---|---|---|---|---|---|---|
| J1 | Provider selection + safe failover (failover only on definitive 4xx; ambiguous outcome pins provider) | COMPLETE — VERIFIED (against mocks) | `whatsapp-provider.policy.ts`, `reminder-delivery.ts` | `whatsapp-provider.spec.ts` (20), `reminder-delivery.spec.ts` (36), `reminder-dedupe.int.spec.ts` [R] | No real-provider verification | Sandbox run | 2026-10-21 |
| J2 | Manual send / send-template (permission, consent, allow-list, 20/min) | COMPLETE — VERIFIED | `POST /whatsapp/send`, `/send-template` | `whatsapp-routes.http.spec.ts` (74), `route-security.int.spec.ts` (23), live 30/30 [R] | UI `sendMessage` helper unused | — | 2026-10-21 |
| J3 | Public `start-booking` gate (validation, 5/min, consent, cooldown) | COMPLETE — VERIFIED | `POST /whatsapp/start-booking`; `public-booking.service.ts` | Same suites [R] | Policy A6: inbound-within-24h as consent proxy | Confirm | 2026-10-21 |
| J4 | Inbound Twilio webhook (STOP, BOOK, CANCEL, etc.) | IMPLEMENTED — PARTIALLY VERIFIED | `POST /whatsapp/webhook/:clinicId` (public); `webhook.handler.ts` | None for the handler | **No `X-Twilio-Signature` verification; clinic id path param unvalidated** → forged STOP/CANCEL/BOOK possible | P0: add signature check (needs public URL + auth token) | 2026-10-21 |
| J5 | Conversational booking / reschedule / cancel flows | NOT VERIFIED | `flows/booking.flow.ts`, `reschedule.flow.ts` | None | Depends on J4 | Test after J4 | — |
| J6 | Broadcast campaigns (admin only, opted-in audience) | IMPLEMENTED — PARTIALLY VERIFIED | `whatsapp` page; `/whatsapp/broadcast*` | Audience consent filter covered in consent specs [R] | Sending untested against real provider | Sandbox run | 2026-10-21 |
| J7 | Conversations list/history | IMPLEMENTED — PARTIALLY VERIFIED | `/whatsapp/conversations*`; `whatsapp` page `components/whatsapp/conversations.tsx` | `pages-error-states.test.tsx`: failed → error state; `{ items: [] }` → genuinely empty; real API row shape rendered [R]. **UI defect fixed:** the page read `.length` of the response object, so it always showed "No active conversations" even when the API returned conversations | Any logged-in role can read patient chats (policy A1); API not modified (WhatsApp hardening deferred, J10) | Decide permission (A1) | 2026-10-21 |
| J8 | START re-subscribe | NOT IMPLEMENTED | `webhook.handler.ts` | — | STOP reply promises it | Implement or reword | 2026-10-21 |
| J9 | Template approval / provider account state | NOT VERIFIED | `.env.example` `WA_TMPL_*` | None | External dependency | Confirm with provider | — |
| J10 | Conversation endpoint hardening (permission, field selection, pagination bounds) | DEFERRED | `/whatsapp/conversations*` | Findings W1–W3 in `docs/security/sensitive-data-authorisation-review.md` | WhatsApp/Twilio out of scope for this change | Do in a WhatsApp-scoped task | 2026-10-21 |
| J11 | Twilio webhook signature verification | DEFERRED | `POST /whatsapp/webhook/:clinicId` | Same as J4 | Still P0; not modified | WhatsApp-scoped task | 2026-10-21 |
| J12 | Broadcast campaign form | PARTIALLY IMPLEMENTED | `whatsapp` page `BroadcastModal`; `POST /whatsapp/broadcast` | Found by comparing the form's payload with the API DTO (not run against a provider) | **The form sends `{ audience, templateName }`; the API requires `{ name, message, targetSegment }`, so a campaign always gets HTTP 400.** Failure is now shown with a reference; the form was NOT changed because a fix makes live broadcasts reachable and needs a decision on the message content | Decide the campaign UX, then fix and sandbox-test | 2026-10-21 |

### K. Admin functions, settings, user management

| ID | Feature | Status | Where | Evidence | Gaps, defects, risks | Next action | Verified |
|---|---|---|---|---|---|---|---|
| K1 | Clinic profile and stats | IMPLEMENTED — PARTIALLY VERIFIED | `settings`, `clinic`; `/clinic/profile`, `/clinic/stats` | Stats redaction live-checked [R]; Settings page: a failed profile load shows an error and NO editable form (previously it showed blank fields whose Save would have overwritten the profile) — `pages-error-states.test.tsx` [R] | Profile update (admin) untested | Add tests | 2026-10-21 |
| K2 | Client error reporting (public `POST /errors/client`) | IMPLEMENTED — PARTIALLY VERIFIED | `lib/error-reporter.ts`, `app/error.tsx`, `ErrorBoundary`; `modules/errors/errors.controller.ts` | `errors.controller.http.spec.ts` (11): field caps and whitelist, sanitised log, rate limit 10/min, only `fatal` can alert and is de-duplicated, hanging/failing SMTP never slows or fails the response [R] | Hardened this pass (was an unauthenticated e-mail trigger with free-form `extra`); React rendering of the boundaries is untested | Browser test | 2026-10-21 |

### L. Frontend usability, responsiveness, accessibility, error states

| ID | Feature | Status | Where | Evidence | Gaps, defects, risks | Next action | Verified |
|---|---|---|---|---|---|---|---|
| L1 | Design system, a11y helpers | IMPLEMENTED — PARTIALLY VERIFIED | `components/ui/*`, `src/styles/tokens.css`, `tailwind.config.ts`, `a11y-enhancer.tsx` | `tsc` + `next build` pass [R]; semantic tokens drive every colour (legacy `blue-*` utilities are remapped to the theme brand scale); `StatusBadge` shows an icon + text for 15 statuses (`ui-theme-components.test.tsx`); rendered-page contrast scan clean in 7 themes on 7 pages (see L8) [R] | No axe run; no screen-reader testing; the Bell button in the header has no notification feature behind it | Run axe + manual keyboard review | 2026-10-21 |
| L2 | Error boundaries and not-found | IMPLEMENTED — PARTIALLY VERIFIED | `app/error.tsx`, `app/(dashboard)/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx`, existing `ErrorBoundary` | `web-error-handling.spec.ts` structural checks; `ErrorState` rendered and exercised by `error-state.test.tsx` (21); successful `next build` [R] | The boundary components themselves are not triggered by a real render error; no browser test | Playwright test that forces a render error | 2026-10-21 |
| L3 | Role-aware UI | PARTIALLY IMPLEMENTED | `analytics/page.tsx` hides money; sidebar shows all pages to all roles | — | Navigation not role-filtered | Filter nav by permission | 2026-10-21 |
| L4 | Frontend ↔ API contract | IMPLEMENTED — PARTIALLY VERIFIED | `apps/web/src/lib/api.ts` | `web-api-contract.spec.ts` (110): every `api.*` call resolves to a mounted route with the same method, with Express first-match semantics (catches `/patients/stats` swallowed by `/:id`); mutation check: re-introducing the old calls fails 6 tests [R] | Request/response payload shapes are verified only for the flows with HTTP tests; `fetch` calls in `pay/[orderId]` and `error-reporter.ts` are outside the check | Extend to payload schemas | 2026-10-21 |
| L5 | Frontend API error handling and data-section states | IMPLEMENTED — PARTIALLY VERIFIED | `lib/api-error.ts`, `lib/api.ts`, `lib/query-state.ts`, `components/ui/{error-state,query-boundary}.tsx`; pages: dashboard, patients, appointments, billing, analytics, clinic (calendar, chairs, availability), settings, whatsapp | `web-error-handling.spec.ts` (39), `error-state.test.tsx` (21), `pages-error-states.test.tsx` (24): every listed page rendered in loading / FAILED / EMPTY / ready states with seeded query results — a failed load shows an error with a support reference and never zeros, "No data yet" or an empty list; no server internals for a 5xx; failed refresh keeps data with a notice [R]. Mutation checks: removing the Settings error guard or the chair-utilization error branch fails tests [R]. **Dashboard KPI cards (commit `c8e020f`)**: `dashboard-kpi.test.tsx` (5) [R] — a failed first load shows `—` in all four KPI values and no sub-figures or trend (never fabricated zeros); a successful response with genuine zeros still shows `0` / `₹0` and its sub-figures; if a refresh fails while earlier data is on screen the last figures stay visible with the stale-data notice (Retry); the existing error message, support reference and retry are unchanged | **Server-side rendering only**: Retry-click, focus management, hydration and real browser behaviour are not exercised; `treatments` page is intentionally unavailable; chair/availability *mutation* errors still use `alert()`; the KPI behaviour is covered by server-rendered tests only (not seen in a browser after the change) | Playwright tests; replace `alert()` | 2026-10-21 |
| L6 | Add-patient and booking form payloads | IMPLEMENTED — PARTIALLY VERIFIED | `lib/payloads.ts`, `patients/page.tsx`, `components/appointments/book-modal.tsx` | `web-error-handling.spec.ts`: the OLD payloads are rejected by the real DTOs (gender `"MALE"`, empty optionals, `startTime` `"09:00:00"`), the new builders are accepted [R]. **Defect fixed: both forms could never succeed** | Forms not exercised in a browser; patient id on the booking form is a free-text UUID field (UX) | Patient picker; browser test | 2026-10-21 |
| L7 | Frontend component test harness | IMPLEMENTED — PARTIALLY VERIFIED | `apps/web/jest.config.js`, `src/__tests__/*` (`npm test` in `apps/web`) | 103/103 tests pass [R] (see 7.1); no new dependencies (Jest + ts-jest + `react-dom/server`); all API modules are replaced by inert mocks, nothing touches a network | No DOM/jsdom: cannot click, type or hydrate | Add a DOM environment or Playwright | 2026-10-21 |
| L8 | Seven-theme system (Light, Dark, Ocean Blue, Mint & Teal, Lavender, Warm Sand, High Contrast) | IMPLEMENTED — PARTIALLY VERIFIED | `src/lib/theme.ts`, `use-theme.ts`, `src/styles/tokens.css`, `components/layout/theme-selector.tsx`, `providers/themed-toaster.tsx`, `lib/chart-theme.ts`, Settings → Appearance, header palette menu | `theme.test.ts` (29): model, init-script simulation (saved theme restored before hydration for all 7, OS fallback, blocked storage), WCAG contrast computed from the real `tokens.css` for every theme (text 4.5:1, controls/focus/chart series 3:1, high contrast 7:1) [R]. **Real browser** (Chromium pane, disposable stack): all 7 apply on click, persist in `localStorage` across reload and navigation, charts and sidebar recolour; rendered text-contrast scan (computed colours vs effective backgrounds): 0 failures in 7 themes on billing, dashboard, appointments, patients, treatments, analytics, settings [R]. Defects found and fixed by the scan: `text-slate-400/300`, orange/emerald status text, chart legend labels, sidebar badge | Preference is per browser (localStorage), not per user account; clinic, WhatsApp, patient sub-pages, login/register and `/pay` not covered by the rendered scan; icon/border non-text contrast only checked through tokens | Store the preference on the user profile (needs an approved schema/API decision); extend the scan to the remaining pages | 2026-10-21 |
| L9 | Mobile-first responsive layout | IMPLEMENTED — PARTIALLY VERIFIED | `header.tsx` (page actions wrap to a second row on phones), `appointments/page.tsx` (agenda cards, always-visible actions), `billing/page.tsx` (invoice cards, keyboard-reachable rows), `ui/tabs.tsx`, clinic and analytics tab bars, `DoctorCalendar.tsx`, `globals.css` (`table.sr-only`) | Real-browser overflow check (`scrollWidth` vs viewport) [R]: 320 / 375 / 768 on all nine dashboard pages = no horizontal page overflow; 1024 and 1440 on dashboard, appointments, billing, clinic, analytics = none. Defects fixed: overflow at 320/375 on Analytics, Clinic, WhatsApp and Billing; hover-only appointment actions (unreachable by keyboard/touch); non-keyboard billing rows; doubled "Dr. Dr."; crushed mobile header title; fabricated login statistics and a dead `/forgot-password` link removed. Mobile drawer open/close/navigate verified [R] | Only the appointments list view has a mobile agenda (week view scrolls inside its card); patient detail sub-pages, modals/date-time pickers and `/pay` were not re-checked at 320; no real device or touch testing; Analytics Revenue/Patients/Insights tabs checked only for overflow on the default tab | Device-lab pass; mobile week agenda | 2026-10-21 |
| L10 | Command palette (Ctrl/Cmd+K) | IMPLEMENTED — PARTIALLY VERIFIED | `components/layout/command-palette.tsx`, `nav-items.ts` (shared with the sidebar) | Real browser: Ctrl+K opens, typing "bill" + Enter navigates to Billing and closes [R]; `ui-theme-components.test.tsx` checks the navigation list is unique and complete | Lists the same destinations as the sidebar (nothing is role-filtered, see L3); actions are navigation, theme switch and sign out only; no patient search (would call the API) | Add role filtering with L3; patient search | 2026-10-21 |
| L11 | Settings → Appearance & Personalisation (mode, themes, accent presets, text size, reduced motion, High Contrast, reset) | IMPLEMENTED — PARTIALLY VERIFIED | `components/settings/appearance-settings.tsx`, `components/ui/choice-group.tsx`, `lib/theme.ts`, `lib/use-theme.ts` (shared store), `styles/accents.css`, `globals.css`, `settings/page.tsx` | `appearance.test.tsx` (61) [R]: invalid/obsolete stored values tolerated per field; System follows the device and updates when it changes; explicit Light/Dark overrides System; all seven themes selectable; accent applies, is dropped under High Contrast and returns afterwards; text size and reduced motion apply and persist; reset restores defaults; refresh restores everything (init script and store); accent × 6 themes × 4 presets keep text 4.5:1, controls/focus ring 3:1 and white-on-accent-fill 4.5:1; accent CSS never defines status colours and never targets High Contrast; Settings renders in loading and failed states with Appearance still available. **Real browser** (Chromium pane, disposable stack): accent/text size/motion apply immediately and persist across reload (attributes present before hydration), arrow keys move AND select within a group with roving tabindex, mode and theme groups stay in sync, reset clears both storage keys, rendered contrast scan 0 failures for 5 accent settings × 7 themes on Settings and Dashboard (Appointments/Billing/Analytics: 3 accents), no horizontal overflow at 320px with larger text on 9 pages. Defects found by these checks and fixed: white-on-accent fills in Dark with teal/sage, tinted default badge, billing tab bar overflow at larger text | **Precedence rule:** `Theme default` = the theme's own colours; any other accent re-colours primary/links/focus ring/selected nav in every theme except High Contrast, where it is ignored (choice remembered). Preference is per browser (`dentalease-theme` + `dentalease-prefs` in localStorage), **not** synced across devices or accounts (no approved backend change). Larger text scales rem-based sizes only (a few dense `text-[11px]` labels stay fixed); reduced motion covers CSS animations/transitions, not chart-library drawing; no axe/screen-reader run; Tailwind config changes need a dev-server restart | Persist per user with an approved API/schema decision; axe run; real-device check | 2026-10-21 |

### M. API validation, rate limiting, audit logging, security controls

| ID | Feature | Status | Where | Evidence | Gaps, defects, risks | Next action | Verified |
|---|---|---|---|---|---|---|---|
| M1 | Input validation (DTO whitelist, strict booleans, E.164, UUIDs) | IMPLEMENTED — PARTIALLY VERIFIED | `ValidationPipe`, DTOs | `strict-boolean.spec.ts`, `whatsapp-routes.http.spec.ts` [R] | Implicit conversion turns objects into `"[object Object]"` for plain `@IsString()`; fixed for auth passwords (`KeepRaw`) and WhatsApp send DTOs, **other DTOs not audited** | Audit DTOs | 2026-10-21 |
| M2 | Rate limiting | IMPLEMENTED — PARTIALLY VERIFIED | Throttler 100/min global; stricter on auth, webhook, send, start-booking | `whatsapp-routes.http.spec.ts` rate tests; live 429 check [R] | In-memory per instance; per-IP (proxy `trust proxy` not configured) | Redis store + proxy config | 2026-10-21 |
| M3 | Audit logging | NOT VERIFIED | `audit.interceptor.ts` (all POST/PATCH/PUT/DELETE → `audit_logs`) | None | Failure is swallowed (warn only); no tamper protection or read-access logging | Test + review | — |
| M4 | Startup secret validation | COMPLETE — VERIFIED | `config/validate-env.ts` | `validate-env.spec.ts` (32) [R] | Dev mode only warns | — | 2026-10-21 |
| M5 | Field encryption service | NOT VERIFIED | `common/encryption/encryption.service.ts` | None | Key management unverified | Test | — |
| M6 | Request sanitization middleware | NOT VERIFIED | `sanitization.middleware.ts` | None | Signature-based; not a substitute for output encoding | Review | — |
| M7 | Swagger docs exposure | PARTIALLY IMPLEMENTED | `main.ts` serves `/api/docs` unconditionally | — | Public API documentation in production | Gate by environment | 2026-10-21 |
| M8 | Central error contract and classification | COMPLETE — VERIFIED | `common/observability/error-classifier.ts`, `filters/http-exception.filter.ts` | `error-classifier.spec.ts` (42), `error-contract.http.spec.ts` (30: contract fields, request id in header+body, nothing sensitive in any 4xx/5xx body, malformed JSON, 429/503 guidance), `error-handling.int.spec.ts` (13, real PostgreSQL: unique/FK/not-found/check/raw SQLSTATE classification, dead-port 503); live `observability.js` [R] | Contract documented in `docs/OBSERVABILITY.md`; additive change (new `error`, `requestId`); P2002 and Throttler texts changed | — | 2026-10-21 |
| M9 | Structured logging, redaction and request correlation | COMPLETE — VERIFIED | `structured-logger.ts`, `redaction.ts`, `request-context.ts`, `winston.logger.ts` facade | `redaction.spec.ts` (24), `logging-core.spec.ts` (24), HTTP spec: one `http.error` per failed request, ids survive awaits and 20 concurrent requests, no secrets/SQL/e-mail/paths in any log line; live: 0 leaks of DB password, JWT secret, token, e-mail, phone or password in the API's own log output [R] | Names inside free-form exception messages cannot be pattern-detected (do not put patient data in exception messages); one `console.error` remains in the WhatsApp controller (out of scope) | — | 2026-10-21 |
| M10 | Health and readiness | COMPLETE — VERIFIED | `GET /api/v1/health/live`, `/ready`; `health.service.ts` | `health.service.spec.ts` (11), HTTP spec (200/503/recovery, minimal body), `error-handling.int.spec.ts` (real database up, dead port down, recovery), live drill with PostgreSQL actually stopped and restarted [R] | Public by design; Redis outage reports `degraded` (200) | — | 2026-10-21 |
| M11 | Administrator e-mail alerting | IMPLEMENTED — PARTIALLY VERIFIED | `common/logger/error-email.service.ts`, `ops.controller.ts` | `ops.controller.http.spec.ts` (13: the alert-test endpoint and its siblings are `super_admin` only — clinic_admin, dentist, receptionist, assistant → 403 with NO alert created, anonymous → 401, rate limit 3/min, SMTP result surfaced, nothing sensitive in status), `error-email.service.spec.ts` (31): no hard-coded recipient, disabled without config, non-blocking, bounded queue/caps, de-duplication + aggregation, retry/backoff, no recursion, sanitised content, real nodemailer SMTP exchange with a LOCAL sink (accept, 451 retry, 550, dropped, hang, port closed); live drill: test alert + one critical outage alert + recovery notice accepted by the local sink [R] | **Delivery to a real mailbox through a real SMTP provider has NOT been verified.** `smtp_accepted` from the local sink only proves the code path. Recipient and SMTP provider must be chosen by the owner. Legacy `.env` contains Gmail credentials that were rejected by Gmail during development (see section 5) | Owner sets `ALERT_EMAIL_TO` + SMTP in the target environment, then `POST /ops/alerts/test?wait=true` and confirms the e-mail arrived | 2026-10-21 |
| M12 | Metrics (in-process) | IMPLEMENTED — PARTIALLY VERIFIED | `metrics.service.ts`, `GET /ops/metrics` | `logging-core.spec.ts` (counters, histogram, cardinality bound, Prometheus text), HTTP spec counters, live `/ops/metrics` as super_admin (403 for clinic_admin, 401 anonymous) [R] | Nothing scrapes it; per process; resets on restart | Attach a scraper if wanted | 2026-10-21 |
| M13 | Process-level failure handling | IMPLEMENTED — PARTIALLY VERIFIED | `process-handlers.ts`, `main.ts` | `logging-core.spec.ts`: rejection → log+count+alert and keep running; uncaught exception → critical alert, bounded flush, `exit(1)` once; failing alert channel cannot block the exit [R] | Tested with an event emitter; a real crash of the running API was not forced | Crash drill in staging | 2026-10-21 |
| M14 | PII-safe logging | IMPLEMENTED — PARTIALLY VERIFIED | `observability/redaction.ts` (`summariseError`, `errText`, `maskPhone`), 13 files of log call sites | `redaction.spec.ts` (28): free-form exception messages omitted (plain Error, Prisma, SyntaxError with data snippets, numeric-coded provider errors), engine/system-coded messages kept; `log-hygiene.spec.ts` (9) statically rejects log statements that interpolate raw messages, stacks, bodies, file names, phones, names or `JSON.stringify`, and any `console.*`; `error-contract.http.spec.ts` name canary "Asha Rao Kulkarni" absent from responses, logs and alerts; live drill leak scan (0 leaks in 331 lines) [R]. **Fixed:** inbound WhatsApp text and phone numbers, document file names (often patient names), S3 keys, refund entities and raw provider messages were being logged | Absence of patient data in logs cannot be proven for future code; `audit_logs` (database table, not log output) still stores request bodies — see decision D-AUDIT | Decide audit-body retention | 2026-10-21 |

### N. Database schema, migrations, backups, operations

| ID | Feature | Status | Where | Evidence | Gaps, defects, risks | Next action | Verified |
|---|---|---|---|---|---|---|---|
| N1 | Schema (37 models) and DB tests | IMPLEMENTED — PARTIALLY VERIFIED | `database/schema.prisma`, `schema.sql` | 6 integration suites (103 tests) pass on a disposable PostgreSQL 18 built with `prisma db push` [R] | Drift between `schema.sql` (`TIMESTAMPTZ`) and `db push` (`timestamp(3)`) noted | Decide canonical path | 2026-10-21 |
| N2 | Migrations | BLOCKED | `database/proposals/migrations/` (3) | Forward and rollback verified on a disposable copy [H] | **Unapproved, unapplied**; no baseline migration history | Owner approval, baseline, staging run | 2026-10-21 |
| N3 | Backups and restore | NOT IMPLEMENTED | Procedure only in `database/proposals/migrations/README.md` | — | No backup job; no restore ever verified | Implement + restore drill | 2026-10-21 |
| N4 | PostgreSQL credential recovery and hardening | BLOCKED | `database/proposals/POSTGRES_HARDENING_PLAN.md` | — | Credential for `dentalease_db` unresolved; listen/firewall not hardened | Owner action | 2026-10-21 |

### O. Deployment readiness, environment, external dependencies

| ID | Feature | Status | Where | Evidence | Gaps, defects, risks | Next action | Verified |
|---|---|---|---|---|---|---|---|
| O1 | Containers | IMPLEMENTED — PARTIALLY VERIFIED | `docker-compose.yml`, `apps/*/Dockerfile` | Static review [H]; images not built here | Compose publishes 5432/6379 on the host; postgres 16 vs local 18 | Bind to loopback / remove ports; build + run | 2026-10-21 |
| O2 | Environment variables | IMPLEMENTED — PARTIALLY VERIFIED | `.env.example` (48 keys), `validate-env.ts` | `validate-env.spec.ts` [R] | Production values and provider accounts unconfirmed | Fill and verify per environment | 2026-10-21 |
| O3 | CI / automated checks | NOT IMPLEMENTED | none (`scripts/check-feature-status.mjs` is a local, opt-in doc gate) | — | No pipeline runs tests/builds | Add CI | 2026-10-21 |
| O4 | Monitoring: logs, metrics, health, outage detection | IMPLEMENTED — PARTIALLY VERIFIED | `common/observability/*`, `GET /health/live|ready`, `GET /ops/metrics` | See M8–M12; live outage drill: database stopped → readiness 503, one critical alert, recovery notice, no leaks in 325 JSON log lines [R] | No external uptime monitor, pager or log shipper; metrics are per process and reset on restart | Add a free external uptime check on `/health/ready`; decide log retention | 2026-10-21 |

### P. Build, quality gates

| ID | Feature | Status | Where | Evidence | Gaps, defects, risks | Next action | Verified |
|---|---|---|---|---|---|---|---|
| P1 | API type-check and production build | COMPLETE — VERIFIED | `apps/api` | `tsc --noEmit` exit 0; `npm run build` exit 0 [R] | — | — | 2026-10-21 |
| P2 | Web type-check and production build (`NEXT_DIST_DIR=.next-build`) | COMPLETE — VERIFIED | `apps/web` | `tsc --noEmit` exit 0; `next build` exit 0 [R] | Fails with exit 1 if `NODE_ENV=development` is set in the shell (see 7) | Documented in AGENTS.md | 2026-10-21 |
| P4 | API production build layout | COMPLETE — VERIFIED | `apps/api/tsconfig.build.json` | Two consecutive clean builds produce 162 files with `dist/main.js`, no spec files [R]. **Defects fixed:** a stale incremental file + `deleteOutDir` produced an EMPTY `dist` with exit code 0; a spec importing web files moved `main.js` to `dist/api/src/main.js` | Dockerfile not rebuilt here | Build the image in staging | 2026-10-21 |
| P3 | Lint | NOT VERIFIED | `npm run lint` | Not run | No ESLint config verified | Run and fix | — |

## 5. Security and privacy findings

### 5.1 Open (highest first)
1. **P0 — Unsigned Twilio webhook** (J4): forged inbound messages can opt patients out, cancel or create bookings.
2. ~~P0 — No automated authentication tests~~ **Closed 2026-10-21** (A1–A3). Remaining auth items are policy flags (A7–A12 in the review document).
3. **P1 — Unguarded PHI routes** (A4, C1, J7): patients, conversations, non-revenue analytics and notifications are readable/writable by any authenticated role including `assistant`.
4. **P1 — Swagger exposed** in all environments (M7); **public error-report endpoint** (K2); **public Razorpay checkout/verify routes** need review (F2, F6).
5. **P1 — No database-level tenant isolation** (B2); cross-tenant tests missing for most modules (B1).
6. **P1 — Docker compose publishes database and Redis ports to the host** (O1).
7. **P2 — Open self-service registration** (A1); implicit conversion of objects to strings in DTOs (M1); in-memory rate limiter (M2); audit-log failures swallowed (M3).

### 5.1a Open decision: request bodies in `audit_logs`
`AuditInterceptor` persists the request body of every POST/PATCH/PUT/DELETE into `audit_logs.new_data` with only password/token/card keys masked. Patient names, phones, clinical notes and prices therefore sit in that table. This is a database record (access-controlled, intended as an audit trail), not log output, and it was not changed. Decide what the audit trail must hold (field names only? changed fields? full body with a retention period?) before production. Tracked as D-AUDIT.

### 5.1b Incident during this change (disclosed)
While verifying alerting, the first live drill started the API with the repository's real `.env` loaded. That file contains legacy `GMAIL_USER`/`GMAIL_APP_PASSWORD` entries, and the OLD transport order preferred Gmail over `SMTP_HOST`, so the test API **attempted to authenticate to smtp.gmail.com** (3 alert deliveries). Gmail answered `535 5.7.8 BadCredentials`; **nothing was delivered** (the recipient was a test address, and authentication failed before any message was accepted). This contacted a live provider contrary to the task rules. Fixed: an explicit `SMTP_HOST` now always wins over legacy Gmail credentials (unit-tested), the live-test orchestration blanks every mail credential, and `AGENTS.md` now forbids tests from reading mail credentials from `.env`. Earlier live drills in this project ran the previous alert service with the same `.env`; if a 5xx occurred in one of them, a real alert may have been sent to the legacy `ALERT_EMAIL` address. The stored Gmail app password was rejected, so it should be treated as invalid or revoked and **rotated by the owner**; it was not read, printed or modified.

### 5.2 Fixed and verified in this project
Browser-verified during the theme/UI work: the Content-Security-Policy `connect-src` carried a path (`/api/v1`), which only matches that exact URL, so every browser API call was blocked (fixed: origin only in `next.config.js`; a running dev server must be restarted to pick it up); the login and register forms could submit natively before hydration with e-mail and password in the URL (fixed: `method="post"`); the login page showed invented statistics ("500+ clinics, 2M+ appointments, 99.9% uptime") and linked to a non-existent `/forgot-password`.

Error responses could carry framework/database wording and no correlation id; alert e-mails contained stack traces, IPs and raw request details and went to a hard-coded personal address; the public client-error endpoint was an unauthenticated e-mail trigger; a failed list showed an empty state; the web client logged users out on the second token refresh; the add-patient and booking forms could never succeed (invalid payloads); `withTimeout`-style probes leaked unhandled rejections; Logout did not revoke the access token and identical refresh tokens within one second allowed replay (A3); auth passwords accepted objects/numbers (M1); patient create/update leaked `outstandingBalance` and update spread the request body (C1); appointment money leaked to assistants (D5); billing/patient/analytics money redaction (C2, G1, G2); manual WhatsApp send had no permission or consent check (J2); `start-booking` unvalidated and un-rate-limited (J3); 2h reminder dropped after 22:00 and never sent (I2); tenant decorator read an unset field (B1); duplicate/ambiguous-failure reminder sends (I3, J1).

### 5.3 Frontend ↔ API mismatches
Found 2026-10-21 by comparing 119 client calls with the mounted routes (107 matched). **Fixed the same day**, each covered by `web-api-contract.spec.ts` and an HTTP/live test:

| Was | Now |
|---|---|
| `PUT /patients/:id` | `PATCH /patients/:id` |
| `GET /patients/stats` (absent → 400) | route implemented (counts for all; outstanding total needs `billing:read`) |
| `PATCH /notifications/:id/read` (absent) | `PATCH /notifications/read` with `{ ids }` |
| `PATCH /appointments/:id/reschedule` | `POST /appointments/:id/reschedule` |
| `GET /users/dentists` (unmounted) | `GET /clinic/dentists` (mounted, reviewed) |
| `POST/GET /users` (unmounted, unused) | removed from the client |
| `/treatments*` (unmounted) | calls kept behind `TREATMENTS_API_AVAILABLE = false`; the page shows "Treatment plans are not available yet" |

### 5.4 Privacy
Patient phones and chats are processed for WhatsApp; consent defaults to opt-out of messaging (opt-in required) and is enforced on automated and manual sends. Emergency contact is intentionally unsupported pending a decision (C6). No secrets or personal data were found in the files committed with this report (pattern scan, values not printed).

## 6. Database and migration status

| Item | State |
|---|---|
| Real database `dentalease_db` | Not accessed by this work. Credential unresolved |
| Applied migrations | None by this work. No `prisma/migrations` history exists |
| Proposed migrations | `20261021000100_invoice_payment_link`, `20261021000200_reminder_status_sent_48h`, `20261021000300_appointment_patient_rating` — forward/rollback verified on a disposable copy [H]; **not approved** |
| Test databases | Disposable PostgreSQL 18 cluster in a temporary directory (database `m7_test`), schema from `prisma db push`; stopped after use. Test scripts refuse any DB not named like a test DB |
| Backups | None verified |

## 7. Test and build results

### 7.1 Re-run on 2026-10-21 (frontend error states, PII-safe logging, operator-endpoint tests)
| Check | Result |
|---|---|
| API `tsc --noEmit` | exit 0 |
| API `npm run build` | exit 0 |
| Jest without database | Test Suites: 9 skipped, 34 passed, 34 of 43 total | Tests: 134 skipped, 909 passed, 1043 total (re-run 2026-10-21 after the appointment-UI API changes) |
| Jest with disposable PostgreSQL | **43/43 suites, 1043/1043 tests passed** (includes `slots-manage.int.spec.ts`) |
| **Web component tests** (`apps/web`, `npm test`) | **233/233 passed**, 8 suites (error-state 21, pages-error-states 24, theme 29, ui-theme-components 29, appearance 61, dashboard-kpi 5, appointment-rules 42, appointment-dialogs 22) |
| Live `observability.js` (3 phases, PostgreSQL stopped and restarted, local SMTP sink) | [up] 19/19 checks passed, [down] 8/8 checks passed, [recovered] 6/6 checks passed; API log lines: 338; JSON lines: 335; secret/PII leaks found: 0 |
| Live `auth-and-contracts.js` / `revenue-and-permissions.js` / `whatsapp-appointment-routes.js` | 41/41, 102/102, 30/30 |
| Web `tsc --noEmit` | exit 0 |
| Web `next build` with `NEXT_DIST_DIR=.next-build`, `NODE_ENV=production` | exit 0 |
| Appearance & Personalisation (separate re-run, same day) | Web `tsc --noEmit` exit 0; `jest` 164/164; `next build` exit 0 (`NEXT_DIST_DIR=.next-build`, `NODE_ENV=production`). Real-browser checks as in L11 (disposable PostgreSQL/Redis/API + own dev server on 3100; the existing :3000 server was not touched and stayed up). API unchanged, API tests not re-run |
| Theme / responsive UI work (separate re-run, same day) | Web `tsc --noEmit` exit 0; `jest` 103/103; `next build` exit 0 (`NEXT_DIST_DIR=.next-build`, `NODE_ENV=production`). **Real-browser checks** (Chromium pane; disposable PostgreSQL 55432, Redis 56379, API 3011, web dev 3100; demo data only; no provider contact): 7 themes switch and persist; rendered contrast scan 0 failures (7 themes × 7 pages); no horizontal overflow at 320/375/768 (9 pages) and 1024/1440 (5 pages); mobile drawer, theme menu and Ctrl+K verified. API code unchanged, so API tests were not re-run for this change |
| Dev server :3000 | **Not running when checked at the end of this change** (no listener on 3000, pid 23160 gone). It was last confirmed healthy at 03:27 the same day; nothing run by this work stops port 3000 (test scripts only stop 3011, 56379, 55432, 2525 and 3100). Left as found: not restarted |

**Browser smoke check (real Chromium pane, a separate dev server on port 3100 with its API URL pointing at nothing, fake local session; no backend and no provider involved):** Settings, Analytics (Overview), Clinic (weekly calendar and doctor filter) and WhatsApp (Conversations tab) each showed their failure state with the "Cannot reach the server" message and a Try again button, no zeros or empty lists; clicking Try again on Settings issued a new `GET /clinic/profile`. Not clicked through: the other tabs, forms and the success/empty states (those are covered only by the server-rendering tests).

**Flaky results seen while preparing the commit, and what was done:** one full run (09:30) had two backend HTTP tests time out at Jest's default 5 s (first test in a file boots a Nest app while the whole suite runs in parallel) and the revenue live script report 101/102 (`owner → timeline has invoices`, the same unexplained single failure seen twice before). The HTTP specs now set a 30 s timeout, and the live script now waits out HTTP 429 (Retry-After) instead of reporting it as a failure and prints how many such retries happened. The rerun passed everything (988/988, 102/102 with 0 rate-limit retries), so **429 is a plausible but unproven cause**; the failing check's cause was not otherwise identified.

**Not performed / not possible here:** any browser interaction (click, type, hydration, responsive layout, keyboard focus); real SMTP delivery to a mailbox; any real provider call; the real `dentalease_db`; a forced crash of the running API.

**Coverage** (Jest/istanbul on the error-handling modules, from the full run with the disposable database):

| File | Lines | Branches | Functions |
|---|---|---|---|
| `common/filters/http-exception.filter.ts` | 97% | 86% | 75% |
| `common/logger/error-email.service.ts` | 100% | 84% | 96% |
| `common/logger/logger.module.ts` | 100% | 100% | 100% |
| `common/logger/winston.logger.ts` | 100% | 100% | 100% |
| `common/observability/context-store.ts` | 100% | 67% | 100% |
| `common/observability/error-classifier.ts` | 96% | 80% | 77% |
| `common/observability/health.controller.ts` | 100% | 80% | 100% |
| `common/observability/health.service.ts` | 100% | 86% | 92% |
| `common/observability/metrics.service.ts` | 100% | 90% | 100% |
| `common/observability/observability.module.ts` | 100% | 100% | 100% |
| `common/observability/ops.controller.ts` | 100% | 84% | 83% |
| `common/observability/process-handlers.ts` | 100% | 67% | 86% |
| `common/observability/redaction.ts` | 100% | 94% | 100% |
| `common/observability/request-context.ts` | 100% | 90% | 64% |
| `common/observability/retry.ts` | 94% | 100% | 100% |
| `common/observability/structured-logger.ts` | 91% | 87% | 81% |
| `modules/errors/errors.controller.ts` | 100% | 74% | 100% |
| `modules/errors/errors.module.ts` | 100% | 100% | 100% |
| **All error-handling files** | **99%** | **85%** | **90%** |

Uncovered or weakly covered critical paths: `error-classifier.ts` branches for rare Prisma codes (P2005–P2020 variants) and Redis `ReplyError`; `request-context.ts` error paths of the `finish` handler; `process-handlers.ts` was exercised with an event emitter, not a real crash; React boundaries (`error.tsx`, `global-error.tsx`) are not rendered by any test; SMTP behaviour against a real provider (TLS, authentication, throttling) is untested.

`next build` exits 1 if the shell has `NODE_ENV=development` (documented in `AGENTS.md`); the verification sets `NODE_ENV=production` for web build and type-check.

### 7.2 Historical (not re-run on a separate date)
Price-exposure probe before/after the appointment redaction fix; Docker/compose static audit; Postgres hardening review; migration forward/rollback on a disposable copy; mutation checks proving the permission, consent and rate-limit tests fail when the protections are removed.

## 8. Outstanding decisions and external dependencies

Decisions (owner): D-AUDIT — what `audit_logs` may store and for how long; the broadcast campaign form (J12); alert recipients and SMTP provider (`ALERT_EMAIL_TO`, `SMTP_*`), alert thresholds (cooldown, hourly cap, minimum severity) and who is on call; whether to add an external uptime monitor; rotate/retire the legacy Gmail credentials found in `.env`; patients route permissions P5 (assistant lookup, dentist demographic edits) and the auth flags A7–A12 in `docs/security/sensitive-data-authorisation-review.md`; treatment/catalog price policy A–E (`docs/security/treatment-price-policy.md`); route policies A1–A7 (`docs/security/whatsapp-appointment-route-inventory.md`); registration policy; whether assistants may book or change appointment status; emergency-contact design; migration approval and order.
External: PostgreSQL credential and backups; Razorpay sandbox/test keys; Twilio and 360Dialog accounts and approved templates; AWS S3/SES accounts; production domain and public webhook URL; GitHub token scope if CI workflows are added.

## 9. Prioritised backlog

| P | Item |
|---|---|
| P0 | Configure alert recipient + SMTP in the target environment and **confirm a real test alert arrives** (M11); rotate the legacy Gmail app password |
| P0 | Verify Twilio webhook signatures and validate the clinic id (J4) |
| P1 | Decide patient permissions (P5) and auth policy flags (A7–A12) |
| P0 | Resolve PostgreSQL credential; take and **restore-test** a backup (N3, N4) |
| P0 | Approve/apply migrations in staging first (N2) — unblocks F4, I4, rating persistence |
| P1 | Apply permission guards to patients, notifications, conversations, non-revenue analytics (A4) |
| P1 | Browser (Playwright) tests: trigger the error boundaries, click Retry, submit the add-patient/booking/settings forms (L2, L5, L6, L7); replace `alert()` in the clinic components; extend the contract test to payload schemas (L4); browser-test the add-patient and booking forms (L6) |
| P1 | Decide `audit_logs` body retention (D-AUDIT); fix or remove the broadcast form (J12) |
| P1 | Add an external uptime check on `/api/v1/health/ready`; decide log retention and shipping (O4) |
| P1 | Sandbox verification: Razorpay, Twilio, 360Dialog (F2, F3, J1) |
| P1 | Gate Swagger; rate-limit `/errors/client`; review public billing routes (M7, K2, F6) |
| P1 | Cross-tenant tests for billing, EHR, documents, prescriptions, clinic-management (B1) |
| P1 | Close compose-published DB/Redis ports; add CI (O1, O3) |
| P2 | Row-level security (B2); Redis rate-limit store; audit-log hardening (M2, M3) |
| P2 | axe accessibility run, device-lab responsive pass, persist the theme per user (needs an approved schema/API decision), extend the rendered contrast scan to the remaining pages (L1, L8, L9); lint (P3) |
| P2 | Treatment plans, user management, tenant settings modules (B3, E3, H3) after policy decisions |

## 10. Change history

| Date | Change | Why |
|---|---|---|
| 2026-10-21 | Appointment management UI: cancel dialog (confirmation + required reason), reschedule dialog (free times of the same dentist, conflict feedback), slot manager (block/unblock with reasons, role-gated); API: block body DTO validation, non-string reasons rejected (`KeepRaw`), malformed dates → 400, `GET /appointments/slots?includeAll=true` for slot managers only; +29 HTTP, +14 unit, +10 integration, +64 web tests; real-browser pass on a disposable stack (found and fixed a double-submit hole); D1, D4, D6 updated | Reception could cancel without a reason or confirmation, there was no reschedule or slot-blocking UI, and the block route accepted any body |
| 2026-10-21 | Dashboard KPI cards: a failed first load shows `—` (no zeros or sub-figures), genuine zeros stay `0`/`₹0`, a failed refresh keeps the last figures with the stale notice (commit `c8e020f`, 5 tests; recorded under L5) | A dashboard whose API was unreachable displayed 0 appointments, 0 patients and ₹0 as if they were real |
| 2026-10-21 | Settings → Appearance & Personalisation: mode (Light/Dark/System) over the existing seven themes, four accent presets with an explicit precedence rule (ignored in High Contrast), text size, explicit reduced motion, High Contrast switch, reset; one shared appearance store so every control updates at once; keyboard radio groups; accent contrast tests; fixed larger-text overflow on Billing; added L11 | Personalisation without a backend change; seven themes and theme ids unchanged |
| 2026-10-21 | Seven-theme system with tokens, selector, persistence and tests; mobile-first responsive fixes (header, appointment agenda, invoice cards, scrolling tab bars); `StatusBadge` with icons; fluid typography and tabular numerals; command palette; theme-aware charts and toasts; rendered contrast scan and viewport sweeps in a real browser; CSP origin fix; login/register form `method`; removed fabricated login stats and dead link; added L8–L10 | Accessible, responsive UI without touching API contracts, auth, permissions or the database |
| 2026-10-21 | Frontend error states for Analytics, Clinic (calendar, chairs, availability), Settings and WhatsApp (loading / failed / empty / ready, support reference, retry); `QueryBoundary` + `query-state`; PII-safe logging (free-form exception messages omitted by default, `errText`, `maskPhone`, 13 call sites, static `log-hygiene` guard); `super_admin`-only alert-test endpoint tests; web component test harness (45 tests); fixed: Settings could overwrite the profile with blanks after a failed load, WhatsApp conversations list always looked empty, analytics showed "No data yet" while loading; found (not fixed): broadcast form payload (J12), `audit_logs` bodies (D-AUDIT); added M14, L7, J12 | Close the remaining frontend gaps from the observability change and remove patient data from logs |
| 2026-10-21 | Observability: central error contract + classifier, structured JSON logging with redaction and request ids, health/readiness + outage monitor, rewritten alert service (bounded queue, dedupe, backoff, sanitised content, no hard-coded recipient), process handlers, in-process metrics, hardened public client-error endpoint, frontend error parser/boundaries/error states, valid form payloads, robust API build; +230 tests, outage drill with PostgreSQL stopped; disclosed the Gmail authentication attempt (5.1b); added M8–M13, L5, L6, P4, raised K2, L2, O4 | Make failures diagnosable and visible without leaking data; do not claim e-mail alerting is operational before a real delivery test |
| 2026-10-21 | Contract + auth stabilisation: fixed 6 client/API mismatches, added `GET /patients/stats`, redacted patient create/update, explicit update fields, logout now revokes the access token, unique refresh tokens, `KeepRaw` for passwords; added 209 tests (65 auth, 110 contract, 26 HTTP contract, 8 patients DB); A1–A3 and D4/C7/I1 raised; WhatsApp findings recorded as DEFERRED (J10, J11) | Close the P0 authentication-test gap and the frontend/API drift without touching WhatsApp |
| 2026-10-21 | Report created from a full repository audit; statuses assigned from re-run evidence; `AGENTS.md` and `scripts/check-feature-status.mjs` added | Establish a single evidence-based source of truth before the first commit |

## 11. Latest verified Git commit

`3e6defb2dd15cf74fbe40918ee68fb510ab1b261` (`3e6defb`, 2026-10-21): the tree that the section 7.1 checks ran against (988/988 backend, 45/45 web, live scripts); the only later change is this report, `AGENTS.md`, `docs/OBSERVABILITY.md` and the incident runbook. Previous verified commit: `ee122e9`.
