# Production Acceptance Criteria — DentalEase v1.0

| | |
|---|---|
| Document ID | PAC-DENTALEASE-v1.0 |
| Version | 1.0 Rev 1.1 — owner-approved amendments (2026-11-22) |
| Document date | 2026-11-22 |
| Baseline | `security/remediation-sprint-01` @ `938182e9a8513fad0c25bced6c6ebe52fbc29050` |
| Status | DRAFT — documentation-only |
| Current overall production readiness | **NO-GO**, per `docs/PROJECT_FEATURE_STATUS.md` §2 |

> Each criterion below has an Owner (role), Evidence type (automated test, live HTTP check, documented procedure, or operator sign-off) and an explicit Pass condition. Any criterion in state `BLOCKED` / `NOT VERIFIED` prevents launch.

---

## 1. Launch gates — must all pass before cutover

| PAC ID | Criterion | Owner | Pass condition | Reference | Current state |
|---|---|---|---|---|---|
| PAC-LG-001 | `apps/api` passes `npx tsc --noEmit` and `npm run build` cleanly on the launch commit. | Engineering | Zero errors, build artefact produced. | `AGENTS.md` §2, §4 | PENDING |
| PAC-LG-002 | `apps/web` passes `npx tsc --noEmit` and `npx next build` with `NEXT_DIST_DIR=.next-build` and `NODE_ENV` ≠ `development`. | Engineering | Zero errors. | `AGENTS.md` §2 | PENDING |
| PAC-LG-003 | Jest unit suite passes on launch commit. | Engineering | All unit suites green, with evidence SHA. | `AGENTS.md` §4 | Partial on current branch (PFSR evidence rows) |
| PAC-LG-004 | Integration suite (`*.int.spec.ts`) passes against a **disposable** PostgreSQL. | Engineering | All integration suites green. | `AGENTS.md` §4 | PENDING |
| PAC-LG-005 | `scripts/e2e/auth-and-contracts.js` reports 100% pass against a disposable staging. | Engineering | All checks pass. | PFSR evidence rows | PENDING on staging |
| PAC-LG-006 | Prisma schema matches the live `dentalease_db` with no uncontrolled divergence; proposed migrations in `database/proposals/` reviewed and applied (or explicitly deferred). | Platform ops | Owner-signed migration record. | `AGENTS.md` §3, PFSR §2 | BLOCKED (BR-OPEN-007) |
| PAC-LG-007 | Backup + restore procedure executed on `dentalease_db` with documented RTO / RPO. | Platform ops | Restore-test report. | PFSR §2, BR-OPEN-007 | BLOCKED |
| PAC-LG-008 | Independent security / privacy review signed off. | Security | Report with findings and resolutions. | NFR-SEC-OPS-005 | BLOCKED |
| PAC-LG-009 | DPDP applicability review completed; retention and subject-access procedures published. | Legal / privacy | Retention policy published. | NFR-SEC-OPS-006 | BLOCKED |

## 2. Security gates

| PAC ID | Criterion | Pass condition | Reference | Current state |
|---|---|---|---|---|
| PAC-SEC-001 | PostgreSQL row-level security enabled on all tenant-scoped tables. | RLS policies applied; integration test proves cross-clinic access returns 404. | NFR-SEC-AUTHZ-004 | BLOCKED |
| PAC-SEC-002 | Twilio inbound webhook verifies Twilio signature. | HTTP test with tampered signature → 401. | NFR-SEC-INT-002, BR-OPEN-005 | BLOCKED |
| PAC-SEC-003 | `/patients*` permission matrix decided and enforced. | Guards applied; HTTP test confirms role matrix. | NFR-SEC-AUTHZ-005, BR-OPEN-003 | BLOCKED |
| PAC-SEC-004 | Appointment mutation permission matrix decided and enforced. | Guards applied; HTTP test confirms role matrix. | NFR-SEC-AUTHZ-006, RP-OPEN-003 | BLOCKED |
| PAC-SEC-005 | Treatment-price exposure policy approved and either the treatments controller is mounted with correct guards or explicitly deprecated. | Decision applied; routes behave per BR-OPEN-008. | `docs/security/treatment-price-policy.md` §4–§5 | BLOCKED |
| PAC-SEC-006 | WhatsApp conversation / message read permission decided and enforced; payload redaction applied. | HTTP test per role. | RP-OPEN-004 | BLOCKED |
| PAC-SEC-007 | Token blacklist fails closed when Redis is unreachable; auth enumeration (A7–A9) addressed per decision. | Failure-mode test covers Redis outage. | NFR-SEC-AUTH-007, NFR-SEC-AUTH-008 | BLOCKED |
| PAC-SEC-008 | Phone format validation applied at DTO boundary (E.164). | Spec covers create / update patient. | NFR-SEC-VAL-004 | BLOCKED |
| PAC-SEC-009 | Operational exposure review: Swagger disabled in production, firewall confirmed, container ports restricted, external uptime monitor configured. | Operator sign-off checklist. | NFR-SEC-OPS-001 … 003 | BLOCKED |
| PAC-SEC-010 | Role-model reconciliation (BR-OPEN-011): engineering plan published for collapsing `clinic_admin` into the ownership attribute, deferring `assistant`, and keeping `super_admin` as platform-only. | Owner-signed engineering plan. | Decision Record A1–A4 | BLOCKED |
| PAC-SEC-011 | Dentist-approval gate (FR-APT-APPROVE) implemented with `approvedByUserId`, `approvedAt`, pending-approval timeout and courtesy expiry message. HTTP test: receptionist-created booking stays provisional until dentist approval. | HTTP test + live check. | Decision Record A5, C16–C18 | BLOCKED |
| PAC-SEC-012 | WhatsApp self-booking provisional flow implemented: provisional ack sent on receipt, final confirmation only after approval, expiry notice on timeout. | Live check with opt-in test number (sandbox provider). | Decision Record C17–C18 | BLOCKED |
| PAC-SEC-013 | Refund flow enforces dentist approval before execution; receptionist cannot approve. HTTP + audit test. | HTTP + audit test. | Decision Record B11 | BLOCKED |
| PAC-SEC-014 | Discount cap enforcement: within-cap discount applies; above-cap discount blocks until approver metadata is attached. | HTTP test on `POST /billing/invoices`. | Decision Record B14, BR-OPEN-013 | BLOCKED |
| PAC-SEC-015 | GST toggle respected: clinic with GST OFF produces zero-tax invoices and is excluded from GST report; clinic with GST ON produces 18% default, overridable per invoice. | HTTP + integration test. | Decision Record B12 | BLOCKED |
| PAC-SEC-016 | Receipt record emitted on every successful payment; split-tender invoice produces one receipt per successful payment. | HTTP + integration test. | Decision Record B10, B13 | BLOCKED |
| PAC-SEC-017 | Treatment packages and insurance claims are NOT exposed as approved v1.0 features. Any mounted route for these capabilities SHALL carry an owner-recorded disposition (feature-flag OFF or documented deprecation). | Operator sign-off. | Decision Record A6, A7, D19, D20; BR-OOS-004, BR-OOS-005, BR-OPEN-008 | BLOCKED |
| PAC-SEC-018 | TreatmentSession workflow implemented per FR-CLIN-SESSION: invoice anchored on session; no session ⇒ no invoice. | Integration test. | Decision Record B8, B9, B15; BR-OPEN-012 | BLOCKED |

## 3. Operational readiness

| PAC ID | Criterion | Pass condition | Reference | Current state |
|---|---|---|---|---|
| PAC-OPS-001 | Alert e-mail recipient and SMTP provider configured; `POST /ops/alerts/test?wait=true` returns a confirmed delivery. | Delivered test alert. | NFR-SEC-OBS-006, BR-OPEN-006 | BLOCKED |
| PAC-OPS-002 | Logging hygiene test (`log-hygiene.spec.ts`) passes on launch commit. | Green. | NFR-SEC-OBS-003 | Reported green on PFSR |
| PAC-OPS-003 | Incident response runbook reviewed in the launch window. | Operator sign-off. | `docs/runbooks/INCIDENT_RESPONSE.md` | PENDING |
| PAC-OPS-004 | Rollback plan: ability to revert code via reusable branch cut; data rollback plan documented. | Rollback drill report. | `docs/runbooks/INCIDENT_RESPONSE.md` | PENDING |
| PAC-OPS-005 | Error tracking and metrics dashboard set up (API p95 latency, 5xx rate, Bull queue depth). | Dashboard accessible to on-call. | `docs/OBSERVABILITY.md` | PENDING |
| PAC-OPS-006 | Razorpay webhook endpoint reachable, signed, and reconciled nightly. | Reconciliation job output. | FW-004 | PENDING |

## 4. Provider verification

| PAC ID | Criterion | Pass condition | Reference | Current state |
|---|---|---|---|---|
| PAC-PRV-001 | Razorpay provider verification in a sandbox with real test keys. | Documented pass of a create-order + verify-signature flow. | PFSR L-, M- | BLOCKED |
| PAC-PRV-002 | Twilio WhatsApp provider verification in a sandbox with approved templates. | Delivered template to opt-in test number; receipt logged. | PFSR I-, J- | BLOCKED |
| PAC-PRV-003 | 360Dialog provider verification (if enabled). | Delivered template to opt-in test number. | PFSR I- | OPTIONAL |
| PAC-PRV-004 | AWS SES verified sender / domain in ap-south-1. | Delivered test e-mail to real recipient. | NFR-SEC-OBS-006 | BLOCKED |
| PAC-PRV-005 | AWS S3 bucket with encryption, bucket policy, lifecycle rules in place. | Infrastructure-as-code or console snapshot. | NFR-SEC-DATA-002 | PENDING |

## 5. Functional acceptance (reference-only; PFSR governs)

Functional acceptance is captured by `docs/PROJECT_FEATURE_STATUS.md`. For launch, the following category thresholds SHALL hold (each threshold is a necessary condition, not a replacement for category-specific verification):

| Category | Launch requirement |
|---|---|
| Authentication, roles, permissions (A, F) | All A-rows at least IMPLEMENTED — PARTIALLY VERIFIED, with A1–A4 COMPLETE — VERIFIED. All open policy items under BR-OPEN-001…003 resolved. |
| Appointments and scheduling (C, D) | Core lifecycle (C1–C7, D1–D5) COMPLETE — VERIFIED; live PostgreSQL concurrency test executed. |
| Patients / CRM (B, P) | P1–P4 COMPLETE — VERIFIED; P5–P8 closed per decision. |
| Billing (L, M) | Razorpay flow COMPLETE — VERIFIED with signature replay guard; manual payment, refund and ageing COMPLETE — VERIFIED. |
| WhatsApp (I, J) | Confirmation, 48/24/2h reminders, follow-up, invoice link, broadcast COMPLETE — VERIFIED; inbound signature verified. |
| Analytics / revenue (N) | Dashboard and revenue reports gated per `RevenueAccessService`; redaction tested per role. |
| Observability (O) | Alert delivery verified end-to-end; log-hygiene suite passing. |

## 6. Change log

| Date | Change | Author |
|---|---|---|
| 2026-11-22 | Initial production acceptance criteria v1.0. | Documentation agent |
| 2026-11-22 | Rev 1.1 applied per owner-approved Decision Record. Added launch gates PAC-SEC-010 … PAC-SEC-018 covering role-model reconciliation, dentist-approval gate, WhatsApp provisional flow, refund approval, discount cap, GST toggle, receipt emission, package/insurance disposition, and TreatmentSession implementation. **No code change authorised.** | Documentation agent |
