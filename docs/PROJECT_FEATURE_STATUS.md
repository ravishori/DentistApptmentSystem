# AI Dentist Appointment System — Feature Status Report

> Living document. Maintained under the rule in [`AGENTS.md`](../AGENTS.md): any change to a feature, route, permission, schema, migration, integration or test status must update this file in the same change.
> Statuses are evidence-based. "Compiles" or "page returns 200" is never treated as proof that a feature works.

| | |
|---|---|
| Report date | 2026-10-21 |
| Repository | `D:\ravishori\DentistAptSystem` (remote `origin` = `https://github.com/ravishori/DentistApptmentSystem.git`) |
| Baseline commit before this audit | `ad4a92e` (`chore: initialise AI dentist appointment system`) |
| Latest verified commit | `d8706ea` (code verified 2026-10-21; remote `origin/main` is still at `ad4a92e` until pushed) |
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
| Authentication behaviour (register, login, lockout, refresh, logout) | **No tests** |
| Frontend ↔ API contract | **Known mismatches** (section 5.3) — some UI actions call routes that do not exist |
| Frontend tests, accessibility and responsive verification | **None automated**; not verified in a browser this session |
| Operational config (PostgreSQL listen address/firewall, Swagger exposure, container ports, monitoring, backups) | **Unresolved** |

## 3. Summary of features by status

| Status | Count | Feature IDs |
|---|---|---|
| COMPLETE — VERIFIED | 13 | C2, C3, D2, D5, G1, I2, I3, J1, J2, J3, M4, P1, P2 |
| IMPLEMENTED — PARTIALLY VERIFIED | 24 | A3, A4, B1, C1, C4, D1, D3, D4, D7, F1, F2, F3, G2, I1, I5, J4, J6, J7, L1, M1, M2, N1, O1, O2 |
| PARTIALLY IMPLEMENTED | 7 | B3, E3, F5, H3, L3, L4, M7 |
| BLOCKED | 5 | C6, F4, I4, N2, N4 |
| NOT IMPLEMENTED | 5 | B2, J8, L2, N3, O3 |
| NOT VERIFIED | 21 | A1, A2, A5, C5, D6, E1, E2, F6, G3, H1, H2, I6, J5, J9, K1, K2, M3, M5, M6, O4, P3 |
| DEFERRED | 0 | — |
| **Total** | **75** | |


Rows counted: the feature rows in section 4 (IDs A1–P3).

## 4. Feature-by-feature status matrix

Columns: **Where** = frontend page(s) / backend routes and modules (source under `apps/web/src/app`, `apps/api/src/modules`). **Evidence** = tests/checks (counts are tests in the named spec file). **Verified** = date the evidence was last re-run (`—` = no evidence).

### A. Authentication, sessions and role-based access

| ID | Feature | Status | Where | Evidence | Gaps, defects, risks | Next action | Verified |
|---|---|---|---|---|---|---|---|
| A1 | Clinic registration (public, creates clinic + first `clinic_admin`, 14-day trial) | NOT VERIFIED | `(auth)/register`; `POST /auth/register` (5/min); `auth/auth.service.ts` | None | Self-service signup lets anyone create a tenant; no email verification found; password policy unverified | Decide signup policy (invite-only vs open); add tests | — |
| A2 | Login, bcrypt(12), lockout after 5 failures for 15 min | NOT VERIFIED | `(auth)/login`; `POST /auth/login` (10/min) | None | No MFA found; lockout logic untested | Add unit + integration tests | — |
| A3 | Token handling: JWT access, 30-day refresh, logout revoke | IMPLEMENTED — PARTIALLY VERIFIED | `POST /auth/refresh`, `/logout`, `GET /auth/me`; `jwt-auth.guard.ts`, `tenant.middleware.ts`, `cache/token-blacklist.service.ts` | Guard + middleware exercised by 132 live checks using locally signed tokens [R]; `startup-imports.spec.ts` (11) | Refresh, logout and blacklist never exercised; `/auth/refresh` is public | Test refresh/logout/revocation | 2026-10-21 |
| A4 | Role and permission model | IMPLEMENTED — PARTIALLY VERIFIED | `permissions.guard.ts` (`ROLE_PERMISSIONS`, `roleHasPermission`), `roles.guard.ts` | `permissions.guard.spec.ts` (17), `whatsapp-routes.http.spec.ts` (74), live matrix [R] | Many routes have **no** permission or role guard: all of `patients`, non-revenue `analytics`, `clinic-management` GETs, `notifications`, `whatsapp/conversations*`, appointment reads. Assistants can create/edit patients | Decide and apply `patients:*`, `analytics:read`, `appointments:read` enforcement (decisions in section 8) | 2026-10-21 |
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
| C1 | Patient CRUD, list/search | IMPLEMENTED — PARTIALLY VERIFIED | `patients`, `patients/[id]`; `/patients*`; `patients.service.ts` | Redaction + consent specs (below) [R]; CRUD logic itself untested | No permission guard (assistant can create/update/read PHI). **Frontend defects:** `PUT /patients/:id` (API is `PATCH`), `GET /patients/stats` (no such route) | Fix FE calls; add guard decision; add CRUD tests | 2026-10-21 |
| C2 | Patient privacy: balance/invoice redaction without `billing:read` | COMPLETE — VERIFIED | `patient-financials.ts`, `patients.controller.ts` | `patient-financials.spec.ts` (9); live: assistant sees no `outstandingBalance`/`invoices` [R] | Free-text PHI still visible to all roles (see A4) | — | 2026-10-21 |
| C3 | WhatsApp consent flag (opt-in default false; strict boolean input; enforced on automated and manual sends) | COMPLETE — VERIFIED | `patient.dto.ts`, `strict-boolean.ts`, senders, broadcast filter | `consent.spec.ts` (13), `strict-boolean.spec.ts` (44), `reminder-dedupe.int.spec.ts`, `route-security.int.spec.ts` [R] | START re-subscribe not implemented (see M5) | — | 2026-10-21 |
| C4 | Family links and patient timeline | IMPLEMENTED — PARTIALLY VERIFIED | `/patients/:id/family`, `/timeline`, `PATCH /patients/:id/family-link` | Timeline money redaction live-checked [R] | Family-link logic untested | Add tests | 2026-10-21 |
| C5 | Patient documents (upload, S3, presigned URLs, search) | NOT VERIFIED | `patients/[id]/documents`; `/patients/:id/documents*`; `documents.controller.ts` (`patients:read/write`) | None | S3 unavailable here; 50 MB in-memory upload per request; file-type validation not reviewed | Test with a mock S3; limit size/type | — |
| C6 | Emergency contact on patients | BLOCKED | `patients.dto.ts` (API returns 400 if sent) | — | Needs data-model/privacy decision (encryption, access) | Decide field design | 2026-10-21 |

### D. Appointments

| ID | Feature | Status | Where | Evidence | Gaps, defects, risks | Next action | Verified |
|---|---|---|---|---|---|---|---|
| D1 | Slots: available, generate, block/unblock | IMPLEMENTED — PARTIALLY VERIFIED | `/appointments/slots*`; `slots.service.ts` | `m7-availability.spec.ts` (11), `m7-booking.spec.ts` (9) [R] | `GET slots` has no permission guard | Add tests for block/unblock roles | 2026-10-21 |
| D2 | Booking (API) | COMPLETE — VERIFIED | `POST /appointments` (`appointments:write`); `appointments.service.ts` | `m7-booking.spec.ts` (9), `m7-concurrency.int.spec.ts` (5), `route-security.int.spec.ts` (cross-clinic patient/dentist/slot), `whatsapp-routes.http.spec.ts` (401/403/validation), live 30/30 [R] | Assistants can no longer book (policy A3 in `docs/security/whatsapp-appointment-route-inventory.md`); `estimatedCost` settable by any `appointments:write` role | Confirm assistant policy | 2026-10-21 |
| D3 | Status transitions and cancellation | IMPLEMENTED — PARTIALLY VERIFIED | `PATCH /appointments/:id/status`; `assertValidTransition` | Permission, validation, cross-clinic tests [R] | Transition table has no dedicated test; `clinicalNotes` writable via status route by receptionist | Add FSM tests; decide notes policy | 2026-10-21 |
| D4 | Reschedule | IMPLEMENTED — PARTIALLY VERIFIED | `POST /appointments/:id/reschedule` | Permission + cross-clinic tests [R] | **Frontend calls `PATCH …/reschedule` → 404**, so UI reschedule is broken (found by code comparison, UI not run) | Fix FE method; add test | 2026-10-21 |
| D5 | Appointment money redaction (estimated cost, invoice, treatment prices) | COMPLETE — VERIFIED | `appointment-financials.ts`, `appointments.controller.ts` | `appointment-financials.spec.ts` (9); live role matrix [R] | Reads still unguarded by `appointments:read` | — | 2026-10-21 |
| D6 | Appointments UI (week calendar, book modal) | NOT VERIFIED | `(dashboard)/appointments`, `components/appointments/book-modal.tsx` | `tsc` + `next build` pass [R]; no UI test | See D4 | Browser test | 2026-10-21 |
| D7 | Clinic management: chairs, doctor availability, schedule overrides, free slots, day schedule, booking via `/clinic-management/appointments` | IMPLEMENTED — PARTIALLY VERIFIED | `clinic` page; `/clinic-management/*` | `m7-availability.spec.ts` (11) [R] | Second booking entry point not covered by the new permission/tenant tests; GETs unguarded | Align with D2 rules; add tests | 2026-10-21 |

### E. Dentist and staff management

| ID | Feature | Status | Where | Evidence | Gaps, defects, risks | Next action | Verified |
|---|---|---|---|---|---|---|---|
| E1 | Staff create / activate / deactivate | NOT VERIFIED | `settings`; `POST /clinic/staff`, `PATCH …/activate|deactivate` (admin roles) | None | Role escalation, last-admin deactivation untested | Add tests | — |
| E2 | Dentist listings | NOT VERIFIED | `GET /clinic/dentists`, `/clinic-management/doctors` | None | — | Add tests | — |
| E3 | Users module (`/users`) | PARTIALLY IMPLEMENTED | `modules/users` (unmounted); FE `users` calls | 404 [H] | Frontend calls `/users`, `/users/dentists` → 404 | Mount safely or remove calls | 2026-10-21 |

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
| G2 | Dashboard KPIs / LTV / funnel / trends with money redaction | IMPLEMENTED — PARTIALLY VERIFIED | `dashboard`, `analytics`; `/analytics/*` | Redaction live-checked [R] | Non-revenue analytics routes have no `analytics:read` guard; CSV exports (`/analytics/export/*`) not tested | Add guard decision + tests | 2026-10-21 |
| G3 | Billing reports UI | NOT VERIFIED | `components/billing/ReportsDashboard.tsx` | Build only | — | Browser test | 2026-10-21 |

### H. Prescriptions, clinical notes, treatments

| ID | Feature | Status | Where | Evidence | Gaps, defects, risks | Next action | Verified |
|---|---|---|---|---|---|---|---|
| H1 | Prescriptions + PDF + templates | NOT VERIFIED | `patients/[id]/prescriptions`; `/patients/:id/prescriptions*`, `/prescription-templates` (`treatments:read/write`) | None | Dentist-only write by matrix; PDF untested | Add tests | — |
| H2 | EHR: dental chart, visits, diagnoses, timeline | NOT VERIFIED | `patients/[id]/ehr`; `/patients/:id/ehr/*` (`patients:read`, `treatments:write`) | Chart/timeline money probe only [H] | Clinical correctness untested | Add tests | — |
| H3 | Treatment plans and procedure catalog | PARTIALLY IMPLEMENTED | `(dashboard)/treatments`; `treatments` module **unmounted** | 404 for all roles [H] | UI page calls non-existent API; price policy undecided (`docs/security/treatment-price-policy.md`) | Decide policy, then mount | 2026-10-21 |

### I. Notifications, reminders and scheduled jobs

| ID | Feature | Status | Where | Evidence | Gaps, defects, risks | Next action | Verified |
|---|---|---|---|---|---|---|---|
| I1 | In-app notifications | IMPLEMENTED — PARTIALLY VERIFIED | `/notifications*`; Bull processor | None direct | **Frontend calls `PATCH /notifications/:id/read`; API only has `PATCH /notifications/read`** | Fix contract; add tests | 2026-10-21 |
| I2 | Two-hour reminder window (midnight-safe, active statuses only, consent) | COMPLETE — VERIFIED | `reminder-window.ts`, `reminders.service.ts` (cron `*/30`) | `reminder-window.spec.ts` (28, incl. a brute-force minute oracle), `reminder-dedupe.int.spec.ts` (real DB) [R] | Goes through 360Dialog only; noisy retries if unconfigured | — | 2026-10-21 |
| I3 | Reminder claim/lease (no duplicate sends under concurrency) | COMPLETE — VERIFIED | `reminder-claim.ts` | `reminder-dedupe.int.spec.ts` (51) on disposable PostgreSQL [R] | Residual at-least-once risk on ambiguous provider failures if Redis absent | — | 2026-10-21 |
| I4 | 48h reminder step | BLOCKED | `reminder.flow.ts` (cron) | — | Needs migration `…reminder_status_sent_48h` (unapplied) | Approve migration | 2026-10-21 |
| I5 | 24h reminder batching | IMPLEMENTED — PARTIALLY VERIFIED | `reminder.flow.ts` | Dedupe tests [R] | Whole-day batch can fire ~48h early | Decide window | 2026-10-21 |
| I6 | Email (SES) | NOT VERIFIED | `notifications.service.ts`, `error-email.service.ts` | None | Provider unavailable | Sandbox test | — |

### J. WhatsApp, Twilio and other integrations (audit only — not modified in this task)

| ID | Feature | Status | Where | Evidence | Gaps, defects, risks | Next action | Verified |
|---|---|---|---|---|---|---|---|
| J1 | Provider selection + safe failover (failover only on definitive 4xx; ambiguous outcome pins provider) | COMPLETE — VERIFIED (against mocks) | `whatsapp-provider.policy.ts`, `reminder-delivery.ts` | `whatsapp-provider.spec.ts` (20), `reminder-delivery.spec.ts` (36), `reminder-dedupe.int.spec.ts` [R] | No real-provider verification | Sandbox run | 2026-10-21 |
| J2 | Manual send / send-template (permission, consent, allow-list, 20/min) | COMPLETE — VERIFIED | `POST /whatsapp/send`, `/send-template` | `whatsapp-routes.http.spec.ts` (74), `route-security.int.spec.ts` (23), live 30/30 [R] | UI `sendMessage` helper unused | — | 2026-10-21 |
| J3 | Public `start-booking` gate (validation, 5/min, consent, cooldown) | COMPLETE — VERIFIED | `POST /whatsapp/start-booking`; `public-booking.service.ts` | Same suites [R] | Policy A6: inbound-within-24h as consent proxy | Confirm | 2026-10-21 |
| J4 | Inbound Twilio webhook (STOP, BOOK, CANCEL, etc.) | IMPLEMENTED — PARTIALLY VERIFIED | `POST /whatsapp/webhook/:clinicId` (public); `webhook.handler.ts` | None for the handler | **No `X-Twilio-Signature` verification; clinic id path param unvalidated** → forged STOP/CANCEL/BOOK possible | P0: add signature check (needs public URL + auth token) | 2026-10-21 |
| J5 | Conversational booking / reschedule / cancel flows | NOT VERIFIED | `flows/booking.flow.ts`, `reschedule.flow.ts` | None | Depends on J4 | Test after J4 | — |
| J6 | Broadcast campaigns (admin only, opted-in audience) | IMPLEMENTED — PARTIALLY VERIFIED | `whatsapp` page; `/whatsapp/broadcast*` | Audience consent filter covered in consent specs [R] | Sending untested against real provider | Sandbox run | 2026-10-21 |
| J7 | Conversations list/history | IMPLEMENTED — PARTIALLY VERIFIED | `/whatsapp/conversations*` | None | Any logged-in role can read patient chats (policy A1) | Decide permission | 2026-10-21 |
| J8 | START re-subscribe | NOT IMPLEMENTED | `webhook.handler.ts` | — | STOP reply promises it | Implement or reword | 2026-10-21 |
| J9 | Template approval / provider account state | NOT VERIFIED | `.env.example` `WA_TMPL_*` | None | External dependency | Confirm with provider | — |

### K. Admin functions, settings, user management

| ID | Feature | Status | Where | Evidence | Gaps, defects, risks | Next action | Verified |
|---|---|---|---|---|---|---|---|
| K1 | Clinic profile and stats | NOT VERIFIED | `settings`, `clinic`; `/clinic/profile`, `/clinic/stats` | Stats redaction live-checked [R] | Profile update (admin) untested | Add tests | 2026-10-21 |
| K2 | Client error reporting | NOT VERIFIED | `POST /errors/client` (public) | None | Public unauthenticated endpoint that can email on errors → abuse/spam vector | Rate-limit + test | — |

### L. Frontend usability, responsiveness, accessibility, error states

| ID | Feature | Status | Where | Evidence | Gaps, defects, risks | Next action | Verified |
|---|---|---|---|---|---|---|---|
| L1 | Design system, dark mode, a11y helpers | IMPLEMENTED — PARTIALLY VERIFIED | `components/ui/*`, `a11y-enhancer.tsx`, `theme-toggle.tsx` | `tsc` + `next build` pass [R]; 21 files use `aria-*` | No automated a11y, visual or responsive test; not reviewed in a browser this session | Run axe + manual keyboard/mobile review | 2026-10-21 |
| L2 | Error and not-found pages | NOT IMPLEMENTED | `app/error.tsx`, `not-found.tsx`, `global-error.tsx` absent | — | Unhandled render errors show framework default | Add error boundaries | 2026-10-21 |
| L3 | Role-aware UI | PARTIALLY IMPLEMENTED | `analytics/page.tsx` hides money; sidebar shows all pages to all roles | — | Navigation not role-filtered | Filter nav by permission | 2026-10-21 |
| L4 | Frontend ↔ API contract | PARTIALLY IMPLEMENTED | `apps/web/src/lib/api.ts` | Static comparison of web calls vs mounted routes [R] | Mismatches: `PUT /patients/:id`, `/patients/stats`, `PATCH /notifications/:id/read`, `PATCH /appointments/:id/reschedule`, `/users*`, `/treatments*` | Fix or remove calls | 2026-10-21 |

### M. API validation, rate limiting, audit logging, security controls

| ID | Feature | Status | Where | Evidence | Gaps, defects, risks | Next action | Verified |
|---|---|---|---|---|---|---|---|
| M1 | Input validation (DTO whitelist, strict booleans, E.164, UUIDs) | IMPLEMENTED — PARTIALLY VERIFIED | `ValidationPipe`, DTOs | `strict-boolean.spec.ts`, `whatsapp-routes.http.spec.ts` [R] | Implicit conversion turns objects into `"[object Object]"` for plain `@IsString()`; other DTOs not audited | Audit DTOs | 2026-10-21 |
| M2 | Rate limiting | IMPLEMENTED — PARTIALLY VERIFIED | Throttler 100/min global; stricter on auth, webhook, send, start-booking | `whatsapp-routes.http.spec.ts` rate tests; live 429 check [R] | In-memory per instance; per-IP (proxy `trust proxy` not configured) | Redis store + proxy config | 2026-10-21 |
| M3 | Audit logging | NOT VERIFIED | `audit.interceptor.ts` (all POST/PATCH/PUT/DELETE → `audit_logs`) | None | Failure is swallowed (warn only); no tamper protection or read-access logging | Test + review | — |
| M4 | Startup secret validation | COMPLETE — VERIFIED | `config/validate-env.ts` | `validate-env.spec.ts` (32) [R] | Dev mode only warns | — | 2026-10-21 |
| M5 | Field encryption service | NOT VERIFIED | `common/encryption/encryption.service.ts` | None | Key management unverified | Test | — |
| M6 | Request sanitization middleware | NOT VERIFIED | `sanitization.middleware.ts` | None | Signature-based; not a substitute for output encoding | Review | — |
| M7 | Swagger docs exposure | PARTIALLY IMPLEMENTED | `main.ts` serves `/api/docs` unconditionally | — | Public API documentation in production | Gate by environment | 2026-10-21 |

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
| O4 | Monitoring / error alerting | NOT VERIFIED | `winston.logger.ts`, `error-email.service.ts` | None | — | Define | — |

### P. Build, quality gates

| ID | Feature | Status | Where | Evidence | Gaps, defects, risks | Next action | Verified |
|---|---|---|---|---|---|---|---|
| P1 | API type-check and production build | COMPLETE — VERIFIED | `apps/api` | `tsc --noEmit` exit 0; `npm run build` exit 0 [R] | — | — | 2026-10-21 |
| P2 | Web type-check and production build (`NEXT_DIST_DIR=.next-build`) | COMPLETE — VERIFIED | `apps/web` | `tsc --noEmit` exit 0; `next build` exit 0 [R] | Fails with exit 1 if `NODE_ENV=development` is set in the shell (see 7) | Documented in AGENTS.md | 2026-10-21 |
| P3 | Lint | NOT VERIFIED | `npm run lint` | Not run | No ESLint config verified | Run and fix | — |

## 5. Security and privacy findings

### 5.1 Open (highest first)
1. **P0 — Unsigned Twilio webhook** (J4): forged inbound messages can opt patients out, cancel or create bookings.
2. **P0 — No automated authentication tests** (A1–A3): register, login, lockout, refresh and logout have never been exercised.
3. **P1 — Unguarded PHI routes** (A4, C1, J7): patients, conversations, non-revenue analytics and notifications are readable/writable by any authenticated role including `assistant`.
4. **P1 — Swagger exposed** in all environments (M7); **public error-report endpoint** (K2); **public Razorpay checkout/verify routes** need review (F2, F6).
5. **P1 — No database-level tenant isolation** (B2); cross-tenant tests missing for most modules (B1).
6. **P1 — Docker compose publishes database and Redis ports to the host** (O1).
7. **P2 — Open self-service registration** (A1); implicit conversion of objects to strings in DTOs (M1); in-memory rate limiter (M2); audit-log failures swallowed (M3).

### 5.2 Fixed and verified in this project
Appointment money leaked to assistants (D5); billing/patient/analytics money redaction (C2, G1, G2); manual WhatsApp send had no permission or consent check (J2); `start-booking` unvalidated and un-rate-limited (J3); 2h reminder dropped after 22:00 and never sent (I2); tenant decorator read an unset field (B1); duplicate/ambiguous-failure reminder sends (I3, J1).

### 5.3 Frontend ↔ API mismatches (static comparison, 2026-10-21)
`PUT /patients/:id` (API: PATCH), `GET /patients/stats` (absent), `PATCH /notifications/:id/read` (API: `PATCH /notifications/read`), `PATCH /appointments/:id/reschedule` (API: POST), `/users`, `/users/dentists`, `/treatments*` (modules unmounted).

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

### 7.1 Re-run on 2026-10-21 (this audit)
| Check | Result |
|---|---|
| API `tsc --noEmit` | exit 0 |
| API `npm run build` | exit 0 |
| Jest without database | 17 suites passed, 6 skipped (integration); **420 passed**, 103 skipped, 523 total |
| Jest with disposable PostgreSQL | **23/23 suites, 523/523 tests passed** |
| Live HTTP `scripts/e2e/whatsapp-appointment-routes.js` | **30/30** |
| Live HTTP `scripts/e2e/revenue-and-permissions.js` | 102/102 in 4 consecutive reruns; **1 run showed 101/102** (`owner → timeline has invoices` false) and could not be reproduced; likely the global 100 requests/minute limit while the script ran, **not proven** |
| Web `tsc --noEmit` | exit 0 |
| Web `next build` with `NEXT_DIST_DIR=.next-build` | exit 0 (when `NODE_ENV` is not `development`) |
| Dev server :3000 | `/` 307; `/login`, `/dashboard` 200 and fast; process unchanged (pid 23160). Full route probe was run earlier the same day: `/register`, `/analytics`, `/billing`, `/patients`, `/whatsapp` 200, `/does-not-exist` 404 |

Note on a build failure seen twice: `next build` exits 1 when the shell has `NODE_ENV=development` (left over from starting the API for live tests). It passed once the variable was cleared.

### 7.2 Historical (not re-run on a separate date)
Price-exposure probe before/after the appointment redaction fix; Docker/compose static audit; Postgres hardening review; migration forward/rollback on a disposable copy; mutation checks proving the permission, consent and rate-limit tests fail when the protections are removed.

## 8. Outstanding decisions and external dependencies

Decisions (owner): treatment/catalog price policy A–E (`docs/security/treatment-price-policy.md`); route policies A1–A7 (`docs/security/whatsapp-appointment-route-inventory.md`); registration policy; whether assistants may book or change appointment status; emergency-contact design; migration approval and order.
External: PostgreSQL credential and backups; Razorpay sandbox/test keys; Twilio and 360Dialog accounts and approved templates; AWS S3/SES accounts; production domain and public webhook URL; GitHub token scope if CI workflows are added.

## 9. Prioritised backlog

| P | Item |
|---|---|
| P0 | Verify Twilio webhook signatures and validate the clinic id (J4) |
| P0 | Add authentication test suite (A1–A3) |
| P0 | Resolve PostgreSQL credential; take and **restore-test** a backup (N3, N4) |
| P0 | Approve/apply migrations in staging first (N2) — unblocks F4, I4, rating persistence |
| P1 | Apply permission guards to patients, notifications, conversations, non-revenue analytics (A4) |
| P1 | Fix frontend ↔ API mismatches (L4); add error boundaries (L2) |
| P1 | Sandbox verification: Razorpay, Twilio, 360Dialog (F2, F3, J1) |
| P1 | Gate Swagger; rate-limit `/errors/client`; review public billing routes (M7, K2, F6) |
| P1 | Cross-tenant tests for billing, EHR, documents, prescriptions, clinic-management (B1) |
| P1 | Close compose-published DB/Redis ports; add CI (O1, O3) |
| P2 | Row-level security (B2); Redis rate-limit store; audit-log hardening (M2, M3) |
| P2 | Frontend tests, axe accessibility run, responsive review (L1); lint (P3) |
| P2 | Treatment plans, user management, tenant settings modules (B3, E3, H3) after policy decisions |

## 10. Change history

| Date | Change | Why |
|---|---|---|
| 2026-10-21 | Report created from a full repository audit; statuses assigned from re-run evidence; `AGENTS.md` and `scripts/check-feature-status.mjs` added | Establish a single evidence-based source of truth before the first commit |

## 11. Latest verified Git commit

`d8706eab720293a96e99bc930c512cf2fee22d10` (`d8706ea`, 2026-10-21) — the code and tests in this commit are exactly the tree that the section 7.1 checks ran against (working tree was clean apart from this report and `AGENTS.md`). Later commits that only change documentation do not change the verified code state.
