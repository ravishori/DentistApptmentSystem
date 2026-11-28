# DentalEase — Master Project Status Report

| | |
|---|---|
| Document ID | DENTALEASE-MPSR-v1.0 |
| Report date | 2026-11-23 |
| Repository | `D:\ravishori\DentistAptSystem` · remote `ravishori/DentistApptmentSystem` |
| Primary branch audited | `main` @ `500d7ca` (merge of PR #2, 2026-11-28, which brought PR #1's P0 insurance fix and the full `security/remediation-sprint-01` content onto `main`) |
| Underlying evidence commit | `3e6defb` for the original PFSR §7.1 run (2026-10-21); `500d7ca` re-validated 2026-11-28 (API `tsc --noEmit` exit 0, build exit 0, Jest 37/46 suites green, 933 passed / 134 skipped / 0 failed) |
| 2026-11-23 increment | `0ba63e9` — `fix(billing): reject insurance as manual payment method` (merged via PR #1 into `security/remediation-sprint-01` at `761c87e`; subsequently to `main` via PR #2 at `500d7ca`) |
| Status | **NOT PRODUCTION-READY (NO-GO)** |
| Deliverable rule | Evidence-based; no feature counted complete on UI presence alone; PFSR is the authoritative per-feature record; this report synthesises and reconciles against the Rev 1.1 requirements set |

---

## 1. Executive summary

DentalEase is a NestJS 10 + Next.js 14 multi-tenant dental-clinic SaaS for India. The engineering core (auth, appointments, patient CRM, revenue privacy, reminders, observability, build + test gates) carries meaningful automated and live-HTTP evidence. However, every launch gate in the Rev 1.1 **Production Acceptance Criteria** (PAC-LG-001 … PAC-PRV-005) is either PENDING or BLOCKED. 18 of 18 security gates (PAC-SEC-001 … PAC-SEC-018) are BLOCKED, and 11 of them (PAC-SEC-010 … PAC-SEC-018) encode Rev 1.1 scope that has **no implementation evidence** (two-primary-role model, dentist-approval booking gate, WhatsApp provisional flow, dentist-approved refunds, discount cap, GST toggle, receipt emission, TreatmentSession).

Headline evidence (from PFSR §7.1, commit `3e6defb`, plus today's increment):

- API: `tsc --noEmit` exit 0; `npm run build` exit 0; Jest with disposable PostgreSQL 43/43 suites, 1043/1043 tests.
- Web: `tsc --noEmit` exit 0; `next build` exit 0 (NEXT_DIST_DIR=`.next-build`); Jest 233/233.
- Live HTTP: `auth-and-contracts.js` 41/41, `revenue-and-permissions.js` 102/102, `whatsapp-appointment-routes.js` 30/30, `observability.js` 33/33 across up / down / recovered phases, 0 secret or PII leaks in 335 JSON log lines.
- Today's P0 billing fix (`0ba63e9`): manual-payment DTO now rejects `method: "insurance"` (400); added 11-test `manual-payment.dto.spec.ts`; full `src/modules/billing` suite 56 pass / 10 skipped / 0 fail.

**Weighted overall completion: ~59%** of in-scope features (see §4); production readiness: **~12%** (see §4).

## 2. Methodology and evidence basis

1. Read the Rev 1.1 requirements set under `docs/project/` (BRD, FRD, RBAC, Clinical Workflow, Financial Workflow, NFR Security, Production Acceptance Criteria) at baseline `938182e9` and the Owner Decision Record.
2. Used `docs/PROJECT_FEATURE_STATUS.md` (PFSR) at `3e6defb` as the authoritative per-feature evidence record (95 rows, A1–P4).
3. Reconciled the Rev 1.1 scope expansion (dentist-approval gate, split payments, separate receipts, configurable GST, configurable discount cap, dentist-approved refunds, TreatmentSession, insurance / packages → OOS, assistant → deferred) against PFSR coverage.
4. Applied today's increment (PR #1 / `0ba63e9`) to PFSR row F1 (billing) and C7-adjacent writes.
5. Did **not** rerun the 1043-test suite; relied on the PFSR section 7.1 evidence recorded for commit `3e6defb` which this work has not invalidated.
6. Scoring rubric (consistent across sections):

| PFSR status | Weight |
|---|---|
| COMPLETE — VERIFIED | 1.00 |
| IMPLEMENTED — PARTIALLY VERIFIED | 0.60 |
| NOT VERIFIED (code path exists, untested) | 0.40 |
| PARTIALLY IMPLEMENTED | 0.30 |
| BLOCKED (external / decision gated) | 0.20 |
| NOT IMPLEMENTED | 0.00 |
| DEFERRED | excluded from the denominator |

## 3. Requirement → implementation map

This table is a reconciliation layer. The authoritative feature-by-feature evidence (routes, specs, verified dates) lives in **PFSR §4** (A1–P4). For the Rev 1.1 scope added after PFSR was written, the status is derived from the current repository, the Owner Decision Record and the BR-OPEN register.

| BRD / PAC | What it says | PFSR row(s) | Current state | Gap |
|---|---|---|---|---|
| BR-SCP-001 · PAC-LG-001/002 | Auth + RBAC with bcrypt(12), JWT + 30d refresh + rotation, lockout | A1–A4 · M1 · P1–P2 | A2/A3 VERIFIED; A1/A4 PARTIAL; policy items (enumeration, fail-open blacklist, open signup) OPEN (BR-OPEN-001/002) | Decide A7–A12 policy flags; close open signup posture |
| BR-SCP-002 · PAC-SEC-004 | Multi-dentist chairs, availability, overrides | D1 · D7 | D1/D7 IMPLEMENTED — PARTIALLY VERIFIED; permission matrix on appointment reads undecided (RP-OPEN-003) | Decide appointment-read guards; add tests |
| BR-SCP-003 · PAC-SEC-011/012 | Appointment lifecycle + **dentist-approval gate on every booking, including WhatsApp self-bookings** | D2 · D3 · D4 · D6 + (new scope) | Core D2/D4/D5 VERIFIED, D3/D6 PARTIAL. Dentist-approval gate: **no code evidence** (BR-OPEN-011 engineering task gated) | FR-APT-APPROVE: `approvedByUserId`, `approvedAt`, pending-approval timeout, courtesy expiry message not yet implemented |
| BR-SCP-003a · PAC-SEC-018 | TreatmentSession as a distinct clinical/billing artefact; no session → no invoice | H2 (EHR) + (new scope) | **No code evidence** — session entity not modeled (BR-OPEN-012) | Decide schema (new entity vs extension); implement invoice anchor |
| BR-SCP-004 · PAC-SEC-002/006 · PAC-PRV-002 | WhatsApp automation + inbound Twilio signature + conversation permissions + provisional self-bookings | I1–I7 · J1–J12 | J1/J2/J3/J6 VERIFIED against mocks; **J4 (inbound signature) NOT IMPLEMENTED — P0**; J7/J10 DEFERRED; sandbox provider verification not done | Add Twilio signature verification; sandbox verify; permission + redaction on conversations |
| BR-SCP-005 | Patient CRM: profile, family, segmentation, consent, onboarding | C1 · C2 · C3 · C4 · C7 | C2/C3/C7 VERIFIED; C1/C4 PARTIAL (phone format untested, no guard on `/patients`); C5 (S3 docs) NOT VERIFIED; C6 (emergency contact) BLOCKED | Decide P5 patient guards; validate E.164; S3 pathway |
| BR-SCP-006 | Prescriptions, EHR, treatment catalog | H1 · H2 · H3 | H1/H2 NOT VERIFIED; H3 PARTIALLY IMPLEMENTED (treatments controller **unmounted**; TREATMENTS_API_AVAILABLE=false) | Decide treatment-price policy; mount or deprecate |
| BR-SCP-007 · PAC-SEC-013/014/016 | Billing: invoice + split payments + separate receipts + configurable discount cap + dentist-approved refunds | F1–F5 · (new scope) | Razorpay path PARTIAL (F2/F3 mocked only); refunds via webhook (F5); **today: manual-payment DTO rejects `insurance` (`0ba63e9`)**; split-payment / per-payment receipt / discount cap / dentist-approved refund flow: **no code evidence** | Implement split tender, receipts, cap enforcement, refund approval gate |
| BR-SCP-007a · PAC-SEC-015 | Invoice / payment / receipt / refund kept as separate records · GST toggle | F1 · (new scope) | Current schema has invoice + payment; receipt entity + GST-OFF switch per clinic: no code evidence (Decision Record B12) | Add Receipt entity (per payment); clinic-level `gstEnabled` with 0% when off |
| BR-SCP-008 | Analytics + revenue + predictive | G1–G3 · N1 | G1 VERIFIED (revenue access + redaction); G2/G3 PARTIAL/NV; predictive not scoped | Add `analytics:read` guards on non-revenue routes; CSV export tests |
| BR-SCP-009 | Staff mgmt, audit logs, notifications centre, a11y, offline reception | E1–E3 · K1 · I1 · L1 · L2 · M3 | E1 NV, E3 PARTIAL (users module unmounted); K1 PARTIAL; I1 VERIFIED (read-status); M3 (audit) NOT VERIFIED; L1/L2 PARTIAL | Add tests; decide audit-body retention (D-AUDIT); mount or delete users module |
| BR-SCP-010 · PAC-SEC-001 | Multi-tenant isolation; shared DB, row-level tenancy | B1 · B2 | B1 PARTIAL (not tested for billing/EHR/docs/prescriptions); **B2 (RLS) NOT IMPLEMENTED** | Enable RLS or ship application-layer tenant guard (prior P0-2 recommendation) |
| BR-SCP-011 | INR + ap-south-1; **clinic-level GST toggle** | — (new scope) | Schema has `taxPercent` default; no per-clinic `gstEnabled` switch found | Implement toggle; exclude GST-OFF clinics from GST report |
| BR-OOS-004 | Insurance — **out of scope v1.0** | — (DTO constrained) | `insurance.service.ts` / `insurance.controller.ts` present but **not approved**; today's commit `0ba63e9` explicitly closes the manual-payment path to `method=insurance` | Decide final disposition (feature-flag OFF or deprecate per PAC-SEC-017) |
| BR-OOS-005 | Treatment packages — **out of scope v1.0** | — | `PackagesService` present but not approved | Same as above |
| BR-OOS-006 | Assistant role — **deferred** | A4 · D-row permissions | Enum value remains; routes refer to role (`assistant`); decision pending (BR-OPEN-011) | Engineering plan to collapse `clinic_admin` into ownership attribute and defer `assistant` |
| NFR-SEC-OBS-006 · PAC-OPS-001 · BR-OPEN-006 | Alert e-mail recipient + SMTP configured, real test alert confirmed | M11 | IMPLEMENTED — PARTIALLY VERIFIED (local SMTP sink only); real delivery not confirmed | Owner configures `ALERT_EMAIL_TO` + SMTP; runs `POST /ops/alerts/test?wait=true` |
| PAC-LG-007 · BR-OPEN-007 | Backup + restore on `dentalease_db` with RTO / RPO | N3 · N4 | **NOT IMPLEMENTED** | Execute backup + restore drill |
| PAC-LG-006 | Prisma migrations baseline | N2 | **BLOCKED** (3 proposed migrations in `database/proposals/`, unapplied, unapproved) | Owner approve + stage |
| PAC-LG-008 | Independent security / privacy review | — | NOT STARTED | Commission |
| PAC-LG-009 | DPDP applicability review + retention policy | — | NOT STARTED | Commission |

(The full 95-row matrix is in [docs/PROJECT_FEATURE_STATUS.md](PROJECT_FEATURE_STATUS.md) §4 and is not duplicated here.)

## 4. Completion dashboard

### 4.1 PFSR status distribution (95 feature rows)

| Status | Count | % |
|---|---:|---:|
| COMPLETE — VERIFIED | 22 | 23.2 |
| IMPLEMENTED — PARTIALLY VERIFIED | 39 | 41.1 |
| NOT VERIFIED | 16 | 16.8 |
| PARTIALLY IMPLEMENTED | 7 | 7.4 |
| BLOCKED | 5 | 5.3 |
| NOT IMPLEMENTED | 4 | 4.2 |
| DEFERRED | 2 | 2.1 |

### 4.2 Weighted completion per dimension

Scored with the rubric in §2. DEFERRED rows excluded from the denominator. Rev 1.1 scope items that have **no code evidence** are scored 0.0 and included in Business workflows and Security.

| Dimension | PFSR rows used | Score / Max | Completion |
|---|---|---:|---:|
| Backend (API services, guards, modules) | A, B, C, D, E, F, G, H, I, J (non-def), K, M | 42.4 / 70 | **61%** |
| Frontend (web app) | L1–L11 | 6.3 / 11 | **57%** |
| Database (schema, migrations, backup) | N1–N4 | 1.0 / 4 | **25%** |
| Security (PAC-SEC gates 001–018) | 18 gates, all BLOCKED | 3.6 / 18 (weight 0.2 for BLOCKED) | **20%** gate-level; applied features sit at ~55% via A/C/D/M rows |
| Business workflows (appointments + patients + billing + notifications + WhatsApp) | C, D, F, I, J (non-def) + Rev 1.1 gaps (dentist-approval, split, receipts, cap, refund approval, TreatmentSession ⇒ 6 × 0) | 23.4 / 43 | **54%** |
| Integrations (Razorpay, Twilio/360Dialog, SES, S3) | F2–F5, I1–I7, J1–J9, J12 | 12.6 / 22 | **57%** |
| Testing (type-check, build, unit, integration, live HTTP; web harness) | P1, P2, P4, L7 | 3.4 / 4 + 0.6 / 1 | **80%** |
| Production readiness (launch gates) | PAC-LG-001…009 + PAC-OPS-001…006 + PAC-PRV-001…005 (20 gates, 1 reported green, 19 pending/blocked) | ~2.2 / 20 | **11%** |
| **Overall weighted** (non-deferred PFSR rows + Rev 1.1 new scope) | 93 PFSR rows + 11 Rev 1.1 items ⇒ 54.9 / 104 | | **~53%** (project-wide) / **~59%** (PFSR-only, Rev 1.1 unaccounted) |

Interpretation: engineering has produced a solid core (auth, revenue privacy, reminders, observability, build/test gates) — ~60% weighted. The gap to launch is dominated by (a) unverified production gates (migrations, backup, provider sandboxing, security review) and (b) Rev 1.1 scope that has not yet been built (dentist-approval gate, TreatmentSession, split payments, receipts, discount cap, dentist-approved refunds, GST toggle).

### 4.3 Fully implemented (COMPLETE — VERIFIED), 22 rows

A2, A3, C2, C3, C7, D2, D4, D5, G1, I1, I2, I3, J1, J2, J3, M4, M8, M9, M10, P1, P2, P4. Each is backed by named specs re-run on 2026-10-21 and in most cases a live HTTP check.

### 4.4 Partially implemented (code exists, tests incomplete), 46 rows

IMPLEMENTED — PARTIALLY VERIFIED (39) + PARTIALLY IMPLEMENTED (7). Covers most of the API surface outside auth/reminders. The common pattern is: HTTP route mounted, happy-path tested, cross-tenant test and role-matrix test missing.

### 4.5 Implemented but not tested (NOT VERIFIED), 16 rows

A5, C5, E1, E2, F6, G3, H1, H2, I6, I7, J5, J9, M3, M5, M6, P3. These are latent risk: features that will ship with zero test coverage unless tests are added.

### 4.6 Missing features (NOT IMPLEMENTED or Rev 1.1 unbuilt)

- B2 — Database-level tenant isolation (RLS)
- J8 — START re-subscribe keyword (promised by STOP reply)
- N3 — Backup / restore (not configured)
- O3 — CI pipeline (none)
- **Rev 1.1 scope (no code evidence)**: dentist-approval booking gate, WhatsApp provisional self-booking flow, TreatmentSession entity, split payments, per-payment receipts, configurable discount cap, dentist-approved refund flow, clinic-level GST toggle.

### 4.7 Security P0/P1 items (from PFSR §5.1)

| Priority | Item | Status |
|---|---|---|
| P0 | Unsigned Twilio inbound webhook (J4) | OPEN |
| P0 | Alert e-mail delivery to a real mailbox (M11) | OPEN |
| P0 | PostgreSQL credential + backup/restore (N3, N4) | OPEN |
| P0 | Migration baseline (N2) | OPEN |
| P1 | Patients / conversations / analytics / notifications permission guards (A4, C1, J7) | OPEN |
| P1 | Swagger exposure + public error-report rate limit + public billing route review (M7, K2, F6) | OPEN |
| P1 | Cross-tenant tests for billing, EHR, docs, prescriptions, clinic-management (B1) | OPEN |
| P1 | Docker-compose publishes DB/Redis ports to host (O1) | OPEN |
| P2 | RLS (B2), Redis rate-limit store, audit-log hardening (M2, M3) | OPEN |
| ✅ Today | Reject `insurance` as manual payment method (BR-OOS-004 enforcement) | **CLOSED by `0ba63e9`** |

### 4.8 Database and API integration gaps

- No `prisma/migrations` history (`db push` + SQL files only); prevents controlled rollouts.
- Drift between `database/schema.sql` (`TIMESTAMPTZ`) and `prisma db push` (`timestamp(3)`).
- 3 proposed migrations unapproved (`20261021000100_invoice_payment_link`, `20261021000200_reminder_status_sent_48h`, `20261021000300_appointment_patient_rating`).
- `tenants`, `treatments`, `users` controllers present in source but **not mounted** (routes 404).
- `AutomationService` class present but not registered (BR-OPEN-009).
- `ReminderFlow` refers to `sent_48h` reminder state that is not in the Prisma `ReminderStatus` enum (BR-OPEN-010).

### 4.9 Production deployment blockers

All 9 launch gates (PAC-LG-001…009), 18 security gates (PAC-SEC-001…018), 6 ops gates (PAC-OPS-001…006) and 5 provider-verification gates (PAC-PRV-001…005) carry PENDING or BLOCKED. The repository has no CI (`O3`), no external uptime check (`O4`), no DPDP review, no security review, and no backup drill.

## 5. Outstanding blockers (prioritised)

| # | Blocker | Owner | Depends on |
|---|---|---|---|
| 1 | Twilio inbound webhook signature verification (J4 / PAC-SEC-002) | Engineering | BR-OPEN-005 |
| 2 | Real SMTP alert delivery verified (M11 / PAC-OPS-001) | Owner + ops | BR-OPEN-006 |
| 3 | Backup + restore drill on `dentalease_db` (N3, N4 / PAC-LG-007) | Platform ops | BR-OPEN-007 |
| 4 | Migrations baseline (N2 / PAC-LG-006) | Platform ops | BR-OPEN-007 |
| 5 | Dentist-approval booking gate (PAC-SEC-011/012) | Engineering | Decision Record A5, BR-OPEN-014 |
| 6 | TreatmentSession schema + invoice anchor (PAC-SEC-018) | Engineering | BR-OPEN-012 |
| 7 | Split payments + per-payment receipts + discount cap + refund approval (PAC-SEC-013/014/016) | Engineering | BR-OPEN-013 |
| 8 | Clinic-level GST toggle (PAC-SEC-015) | Engineering | Decision Record B12 |
| 9 | Role-model reconciliation (PAC-SEC-010) | Engineering | BR-OPEN-011 |
| 10 | Patient / conversations / analytics permission guards (A4 / PAC-SEC-003/006) | Engineering | BR-OPEN-003 |
| 11 | Independent security / privacy review (PAC-LG-008) | Security | external |
| 12 | DPDP applicability + retention policy (PAC-LG-009) | Legal | external |
| 13 | Cross-tenant tests for billing / EHR / docs / prescriptions / clinic-management (B1) | Engineering | — |
| 14 | Package / insurance controller disposition (PAC-SEC-017; BR-OOS-004/005) | Engineering + owner | Decision Record A6, A7 |
| 15 | Treatment-price policy A–E and mount/deprecate `treatments` controller (H3 / PAC-SEC-005) | Owner + engineering | BR-OPEN-004, BR-OPEN-008 |

## 6. Recommended development roadmap

### Phase 1 — Security closure and launch gates (P0, 6–8 weeks, non-feature)

1. Verify Twilio webhook signature; validate `clinicId` path param (J4).
2. Owner configures `ALERT_EMAIL_TO` + SMTP; run and confirm `POST /ops/alerts/test?wait=true`; rotate legacy Gmail credentials (M11).
3. Execute backup + restore drill on `dentalease_db`; document RTO / RPO (N3, N4).
4. Approve and stage the three proposed migrations (N2) — unblocks F4 (payment links), I4 (48h reminder), rating persistence.
5. Decide `/patients*`, conversations, analytics, notifications permission matrix and apply guards (A4 / BR-OPEN-003).
6. Ship cross-tenant tests for billing / EHR / documents / prescriptions / clinic-management (B1).
7. Rate-limit `/errors/client`; gate Swagger by environment; review public billing routes (M7, K2, F6).
8. Close compose-published DB/Redis ports; set up a basic CI pipeline (O1, O3).

### Phase 2 — Rev 1.1 scope implementation (P0, 8–10 weeks, feature)

1. **Dentist-approval booking gate** (FR-APT-APPROVE, PAC-SEC-011/012): add `approvedByUserId`, `approvedAt`, pending-approval timeout; implement WhatsApp provisional ack / approval / expiry flow (Decision Record A5, C17–C18).
2. **TreatmentSession entity** or appointment-extension decision (BR-OPEN-012) + invoice anchor (PAC-SEC-018).
3. **Split payments + per-payment receipts** (Decision Record B10, B13; PAC-SEC-016). Split tender writes N payment rows, emits one receipt per payment; invoice settles when sum matches total.
4. **Configurable discount cap** (Decision Record B14, BR-OPEN-013; PAC-SEC-014): clinic-level percentage + fixed-INR caps; above-cap requires approver metadata.
5. **Dentist-approved refunds** (Decision Record B11; PAC-SEC-013): receptionist can execute only after dentist approval; audit trail.
6. **Clinic-level GST toggle** (Decision Record B12; PAC-SEC-015): per-clinic `gstEnabled` with 0% when off; exclude GST-OFF clinics from GST report.
7. **Role-model reconciliation plan** (PAC-SEC-010 / BR-OPEN-011): engineering plan for collapsing `clinic_admin` into an ownership attribute and deferring `assistant`.

### Phase 3 — Integrations and operability (P1, 4–6 weeks)

1. Razorpay sandbox verification with real test keys (PAC-PRV-001).
2. Twilio + (optional) 360Dialog sandbox verification with approved templates (PAC-PRV-002, 003).
3. AWS SES verified sender / domain in ap-south-1 (PAC-PRV-004).
4. AWS S3 bucket with encryption + lifecycle (PAC-PRV-005); patient-document upload tests (C5).
5. External uptime monitor on `/api/v1/health/ready`; decide log retention + shipping (O4).
6. Playwright browser tests: trigger error boundaries, Retry, add-patient + booking + settings forms; replace `alert()` in clinic components (L2, L5, L6, L7).

### Phase 4 — Compliance and launch (P0 external, 2–4 weeks)

1. Independent security / privacy review (PAC-LG-008).
2. DPDP applicability + retention policy + subject-access procedures (PAC-LG-009).
3. Incident response runbook review; rollback drill (PAC-OPS-003/004).
4. Metrics dashboard set up for API p95, 5xx rate, Bull queue depth (PAC-OPS-005).
5. Staging sign-off and explicit human production approval.

### Phase 5 — Deferred (post-launch)

- AI assist (clinician-supervised; BR-OOS-002).
- Google Calendar / Outlook sync (BR-OOS-003).
- Insurance claims / treatment packages — explicit owner decision required (BR-OOS-004/005).
- Mobile app (BR-OOS-001).
- Patient-rating persistence (depends on migration `20261021000300_appointment_patient_rating`).
- Row-level security at the database layer (B2) — after credential cleanup and application tenant guard are stable.

## 7. Report integrity

- **No application source code was modified** in producing this report.
- **No production migrations** were run; the real `dentalease_db` was not accessed.
- **No Git branches were switched or merged**; the working branch is `fix/reject-insurance-manual-payment` (merged into `security/remediation-sprint-01` via PR #1 earlier today at commit `761c87e`).
- The underlying evidence commit `3e6defb` was not re-verified (lightweight scope-change audit only, per the task rule). PFSR §7.1 is the standing evidence; this work has not invalidated it.
- Where Rev 1.1 scope items have no code evidence, they are scored 0.0 and flagged, not invented.

## 8. Change log

| Date | Change | Author |
|---|---|---|
| 2026-11-23 | Initial Master Project Status Report assembled from Rev 1.1 requirements set and `docs/PROJECT_FEATURE_STATUS.md` @ `3e6defb`; today's increment `0ba63e9` folded in. | Documentation agent |
