# Business Requirements Document — DentalEase v1.0

| | |
|---|---|
| Document ID | BRD-DENTALEASE-v1.0 |
| Version | 1.0 Rev 1.1 — owner-approved amendments (2026-11-22) |
| Document date | 2026-11-22 |
| Repository | `D:\ravishori\DentistAptSystem` (remote `origin` = `https://github.com/ravishori/DentistApptmentSystem.git`) |
| Baseline branch | `security/remediation-sprint-01` |
| Baseline commit | `938182e9a8513fad0c25bced6c6ebe52fbc29050` |
| Status | DRAFT — documentation-only. No implementation change. |
| Authors / approvers | TBD. Owner approval required for Section 4 and Section 9. |
| Source material (authoritative) | `BRD.txt`, `BRD enhnanced.txt`, `ARCHITECTURE.md`, `docs/PROJECT_FEATURE_STATUS.md`, `docs/security/*`, `AGENTS.md`, `database/schema.prisma`, `apps/api/src/common/guards/permissions.guard.ts` |

> **Scope note.** This BRD captures the approved business decisions already visible in the repository artefacts above. It does not invent scope. Items marked `[A]` are approved decisions supported by at least one authoritative source; `[?]` are assumptions filled in for completeness and must be confirmed; `[!]` are unresolved decisions tracked elsewhere and required before production.

---

## 1. Vision and strategic intent

| ID | Statement | Source | Type |
|---|---|---|---|
| BR-VIS-001 | DentalEase is a WhatsApp-first, multi-tenant SaaS automation platform for dental clinics in India, focused on Mumbai and Tier 2/3 cities. | `BRD.txt` §1, `BRD enhnanced.txt` §1, `ARCHITECTURE.md` lead | [A] |
| BR-VIS-002 | Dentists and clinic staff use a responsive web dashboard; patients interact primarily through WhatsApp. | `BRD.txt` §4, `BRD enhnanced.txt` §3, `ARCHITECTURE.md` §1 | [A] |
| BR-VIS-003 | Target success metrics (12 months): 40–60% reduction in no-shows, 25–40% retention lift, 30%+ treatment completion lift, 70%+ bookings via WhatsApp. | `BRD enhnanced.txt` §1 | [A] |
| BR-VIS-004 | Mobile application is Phase 2, out of v1.0 scope. | `BRD.txt` §4, `BRD enhnanced.txt` §3 | [A] |

## 2. Business goals and KPIs

| ID | Goal | KPI | Source | Type |
|---|---|---|---|---|
| BR-GOAL-001 | Reduce clinic manual workload by 70–80%. | Time spent on booking/reminder/billing per receptionist shift. | `BRD enhnanced.txt` §1 | [A] |
| BR-GOAL-002 | Increase patient retention via family linking and recall reminders. | Repeat-visit rate, 6-month recall response rate. | `BRD.txt` §5–7, `BRD enhnanced.txt` §4.3 / §4.4 | [A] |
| BR-GOAL-003 | Raise collection effectiveness via WhatsApp payment links and due tracking. | Collection on due, 30/60/90 ageing buckets. | `BRD.txt` §5 billing, `BRD enhnanced.txt` §4.5 | [A] |
| BR-GOAL-004 | Produce clinic-level daily, monthly, and dentist-performance insights. | Dashboard adoption, report export frequency. | `BRD enhnanced.txt` §4.6 | [A] |

## 3. Users and personas

Owner-approved role model (Decision Record 2026-11-22, items A1–A4): **two primary clinic roles** — Dentist and Receptionist. Clinic ownership is represented as an attribute on a user (not a separate role). Assistant is deferred. Super Admin is a platform-operations role only.

| ID | Persona | Primary channel | Notes | Source | Type |
|---|---|---|---|---|---|
| BR-USR-001 | Dentist | Web dashboard | Primary clinic role. Clinical capture, treatment plans, treatment sessions, booking approval, refund approval, revenue insights. | Decision Record A1, `BRD enhnanced.txt` §2 | [A] |
| BR-USR-002 | Receptionist | Web dashboard | Primary clinic role. Appointment intake, patient data entry, billing entry, chat escalation. May execute refunds that a dentist has approved. | Decision Record A1, `BRD enhnanced.txt` §2 | [A] |
| BR-USR-003 | Clinic Owner (ownership attribute) | Web dashboard | NOT a separate role. A Dentist or Receptionist user may carry an `isClinicOwner` (or equivalent ownership) attribute that grants administrative permissions inside their clinic: staff management, clinic settings, GST configuration, discount-limit configuration, refund policy overrides. | Decision Record A2 | [A] |
| BR-USR-004 | Assistant | n/a | **Deferred from v1.0.** Role stays in schema enum; no primary-role grants in v1.0. | Decision Record A3 | [A] Deferred |
| BR-USR-005 | Super Admin (platform operator) | Ops tooling | Platform operations role only. **Not a clinic role.** Must not appear in clinic-facing permission matrices. | Decision Record A4 | [A] |
| BR-USR-006 | Patient / Family | WhatsApp | Books, reschedules, pays, receives reminders and care messages. WhatsApp self-bookings are provisional until dentist approval (Decision Record C17–C18). | `BRD.txt` §3, Decision Record C17 | [A] |
| BR-USR-007 | Multi-clinic group admin | Web dashboard | Group-level operator across multiple clinics. Architecture supports it via tenancy; v1.0 does not ship dedicated group tooling. | `BRD enhnanced.txt` §2, ARCHITECTURE.md | [?] Deferred UX. |

> **Note on existing application code.** `apps/api/src/common/guards/permissions.guard.ts` currently implements five enum roles (`super_admin`, `clinic_admin`, `dentist`, `receptionist`, `assistant`). Per Decision Record D20, **no code change is authorised by this BRD amendment.** The role-model reconciliation (collapse of `clinic_admin` into an ownership attribute on dentist/receptionist, deferral of `assistant`) is a future engineering task tracked under BR-OPEN-011.

## 4. In-scope capabilities for v1.0

Cross-referenced to the detailed feature list in `BRD enhnanced.txt` §4 and current build status in `docs/PROJECT_FEATURE_STATUS.md` (PFSR). Statuses in that file govern verification; nothing here declares a feature verified that PFSR does not.

| ID | Capability | Approved content | Source | Type |
|---|---|---|---|---|
| BR-SCP-001 | Clinic registration, authentication and role-based access. | 5-role model with bcrypt(12), JWT access + 30-day refresh with rotation, lockout policy. | `BRD enhnanced.txt` §5 Security, PFSR A1–A4, `permissions.guard.ts` | [A] |
| BR-SCP-002 | Single-dentist and multi-dentist clinic support (chairs, per-dentist schedules). | Chairs, doctor availability and overrides tables (`chairs`, `doctor_availabilities`, `doctor_schedules`); appointment_slots carry `chair_id` and `dentist_id`. | `ARCHITECTURE.md` §2, `database/schema.prisma`, `database/multi_doctor.sql` | [A] |
| BR-SCP-003 | Appointment booking, lifecycle (confirm/cancel/reschedule/complete/no-show), slot management, blocking. **Every new booking requires explicit dentist approval before it is treated as confirmed** (Decision Record A5, C16–C18). | Features 1–7 of BRD §4.1 + Decision Record A5. | `BRD enhnanced.txt` §4.1, Decision Record A5 | [A] |
| BR-SCP-003a | Clinical capture through a distinct **TreatmentSession** artefact linked to an appointment and optionally to one or more treatment-plan procedures. One plan procedure MAY be completed across multiple sessions. | Decision Record B8–B9. | Decision Record | [A] |
| BR-SCP-004 | WhatsApp automation: confirmation, reminders (48/24/2h), rescheduling, cancellation, payment links, follow-ups, broadcast campaigns. | Features 8–15. Provider: Twilio primary, 360Dialog fallback. | `BRD enhnanced.txt` §4.2, `ARCHITECTURE.md` §1, `.env` providers | [A] |
| BR-SCP-005 | Patient CRM: profile, family linking, segmentation, digital onboarding, consent management, loyalty/referral (loyalty: phase 1.5). | Features 16–21. | `BRD enhnanced.txt` §4.3 | [A] |
| BR-SCP-006 | Clinical workflows: procedure catalog, treatment plan builder, progress tracking, clinical notes with attachments, 6-month recall. | Features 22–26. | `BRD enhnanced.txt` §4.4, `database/schema.prisma` (TreatmentPlan, Procedure, EHR models) | [A] |
| BR-SCP-007 | Billing and finance: invoice (PDF+WhatsApp), multi-mode payments (UPI/Razorpay/Card/Cash), **split payments** (multiple methods settle one invoice in a single operation, Decision Record B10), **separate receipt per successful payment** (Decision Record B13), **configurable percentage + fixed-INR discount limits with approval for exceptions** (Decision Record B14), **dentist-approved refunds executable by receptionist** (Decision Record B11), dues/aging, daily closing, basic inventory (lite). | Features 27–31 + Decision Record B10–B14. | `BRD enhnanced.txt` §4.5, Decision Record | [A] |
| BR-SCP-007a | Invoice, payment, receipt and refund SHALL be kept as **separate financial records** with their own audit trail (Decision Record B15). | Decision Record | [A] |
| BR-SCP-008 | Analytics: executive dashboard, trends, doctor/staff performance, predictive insights (phase 1.5). | Features 32–35. | `BRD enhnanced.txt` §4.6 | [A] |
| BR-SCP-009 | Staff management & role-based access; audit logs; notifications centre; dark-mode + accessibility; limited offline reception mode. | Features 36, 40, 41, 42, 43. | `BRD enhnanced.txt` §4 (Additional) | [A] |
| BR-SCP-010 | Multi-clinic architecture ready (shared DB, row-level tenancy). | Shared DB, shared schema; `clinicId` from verified JWT applied in every service query. | `ARCHITECTURE.md` §4, `AGENTS.md`, PFSR §1 | [A] |
| BR-SCP-011 | Data residency / payment currency: India (INR), ap-south-1 hosting target. **GST is configured explicitly at the clinic level** (Decision Record B12); default state is OFF until the clinic admin enables it and supplies a GST number. Standard rate is 18% when enabled. | GST fields on invoice schema, Razorpay, SES/S3 region defaults. | `database/schema.prisma`, `.env` defaults, Decision Record B12 | [A] |

## 5. Out-of-scope for v1.0 (DEFERRED)

| ID | Item | Rationale | Source |
|---|---|---|---|
| BR-OOS-001 | Native mobile app (iOS/Android, Flutter). | Phase 2. | `BRD.txt` §4, `BRD enhnanced.txt` §3 |
| BR-OOS-002 | Full autonomous AI diagnosis, prescribing or treatment selection. | Clinical-safety boundary; any AI assist must be clinician-supervised. | PFSR J10/J11 DEFERRED |
| BR-OOS-003 | Google Calendar / Outlook two-way sync. | Listed as optional in BRD. | `BRD enhnanced.txt` §4.1 feature 7 |
| BR-OOS-004 | **Insurance claims (all forms: manual records, submission tracking, reimbursement).** Excluded from v1.0 by Decision Record A6. Source code for `insurance.service.ts` / `insurance.controller.ts` exists but is **not approved** for v1.0; per Decision Record D19 existing implementation does not qualify the feature. | Decision Record A6 | Decision Record |
| BR-OOS-005 | **Treatment packages (bundled offers, `TreatmentPackage`, `PatientPackage`, installment plans).** Excluded from v1.0 by Decision Record A7. Source code exists but is **not approved** for v1.0; per Decision Record D19 existing implementation does not qualify the feature. | Decision Record A7 | Decision Record |
| BR-OOS-006 | **Assistant as a primary clinic role.** Deferred by Decision Record A3. Enum value remains in schema; no permission grants in v1.0. | Decision Record A3 | Decision Record |
| BR-OOS-007 | Live-delivery of SMS/WhatsApp to real patients from any environment that does not hold explicit approval + verified provider credentials. | `AGENTS.md` safety section. | `AGENTS.md` §3 |

## 6. Constraints

| ID | Constraint | Source |
|---|---|---|
| BR-CST-001 | Multi-tenant isolation via `clinicId` from verified JWT; no clinic ID from request body is trusted. | `ARCHITECTURE.md` §5, PFSR §1 |
| BR-CST-002 | Prisma schema is the source of truth for data model; raw SQL files exist for pre-migration setup; `prisma/migrations` history is not tracked in v1.0. | `AGENTS.md` §3, PFSR §1 |
| BR-CST-003 | No CI workflows exist in-repo at v1.0; evidence is produced by local test runs and `scripts/e2e/*` scripts. | PFSR §1 |
| BR-CST-004 | Live provider calls (Razorpay, Twilio, 360Dialog, SES, S3) must not be made from tests or scripts. | `AGENTS.md` §3 |
| BR-CST-005 | Database row-level security (RLS) is NOT enabled at the database layer in v1.0 (commented out); isolation is enforced in application services. | PFSR §1 |
| BR-CST-006 | Error logging is routed through the structured logger and one HTTP exception filter; error e-mails go only via `ErrorEmailService.report()` with environment-only configuration. | `AGENTS.md` §5 |

## 7. Assumptions

| ID | Assumption | Note |
|---|---|---|
| BR-ASM-001 | The authoritative DentalEase v1.0 scope is governed by `BRD enhnanced.txt`, extended by features already present in the codebase (EHR, documents, prescriptions, clinic-management, analytics, revenue). | Confirmed by `docs/PROJECT_FEATURE_STATUS.md`. |
| BR-ASM-002 | GST at 18% is the default on invoices; clinics may override via `invoice.taxPercent`. | From schema defaults; explicit per-clinic policy not documented. |
| BR-ASM-003 | Default working hours and slot duration are configured per clinic through `clinic.settings` JSON. | From schema. Default values not approved. |
| BR-ASM-004 | WhatsApp provider selection (Twilio vs 360Dialog) is configurable per clinic via `WHATSAPP_PROVIDER` and per-tenant API key. | From `ARCHITECTURE.md` §4 and `.env`. |

## 8. Dependencies

| ID | Dependency | Owner | Notes |
|---|---|---|---|
| BR-DEP-001 | PostgreSQL 16 with configured `dentalease_db` and disposable test DB. | Platform ops | `AGENTS.md` §3; backup/restore not yet executed. |
| BR-DEP-002 | Redis (cache, WhatsApp sessions, rate-limit/ambiguity state, Bull queues). | Platform ops | `ARCHITECTURE.md` §5. |
| BR-DEP-003 | Twilio and/or 360Dialog WhatsApp account with approved templates. | Clinic + Platform ops | `BRD enhnanced.txt` §6; templates in `.env`. |
| BR-DEP-004 | Razorpay merchant and webhook secret. | Clinic + Platform ops | `ARCHITECTURE.md` §5 security table. |
| BR-DEP-005 | AWS SES / S3 (ap-south-1). | Platform ops | `.env`, PFSR evidence rows. |

## 9. Unresolved business decisions

These are decisions that must be closed before launch. They are tracked in the stated sources; they are listed here for business visibility, not duplicated here.

| ID | Topic | Where tracked | Status |
|---|---|---|---|
| BR-OPEN-001 | Open-signup policy, email verification, password policy beyond min-length 8. | PFSR A1 "Decide signup policy"; `docs/security/sensitive-data-authorisation-review.md` A-rows | [!] |
| BR-OPEN-002 | Authentication enumeration and lockout-counter policy (A7, A8, A9). | `docs/security/sensitive-data-authorisation-review.md` | [!] |
| BR-OPEN-003 | `patients:*` permission enforcement rules (which clinical roles write patient demographics, allergies, medical history). | PFSR A4, `docs/security/sensitive-data-authorisation-review.md` P5, P6, P8 | [!] |
| BR-OPEN-004 | Treatment-price exposure policy decisions A–E. | `docs/security/treatment-price-policy.md` §5 | [!] |
| BR-OPEN-005 | Twilio inbound webhook signature verification. | PFSR O3, AGENTS.md §3, `docs/security/whatsapp-appointment-route-inventory.md` | [!] |
| BR-OPEN-006 | Alert e-mail recipient, SMTP provider, and delivery verification (`POST /ops/alerts/test?wait=true`). | `AGENTS.md` §5 | [!] |
| BR-OPEN-007 | Backup / restore procedure execution for `dentalease_db`. | PFSR §2, `database/proposals/migrations/README.md` | [!] |
| BR-OPEN-008 | Mounting and remediation of the unmounted `treatments`, `tenants`, `users` controllers (or explicit deprecation). | PFSR §1 "NOT mounted", `docs/security/treatment-price-policy.md` §2 | [!] |
| BR-OPEN-009 | Disposition of the unregistered `AutomationService` class (delete or wire into a module). | FR-WA-007, PFSR I-, J- | [!] |
| BR-OPEN-010 | Reconcile `sent_48h` reminder state used in `ReminderFlow` / `FollowupFlow` against the Prisma `ReminderStatus` enum (which has no `sent_48h`). | PFSR J- | [!] |
| BR-OPEN-011 | Engineering plan to reconcile the five-role Prisma enum with the owner-approved two-primary-role model + ownership attribute. **No code change is authorised by this BRD.** | Decision Record A1–A4, D20 | [!] |
| BR-OPEN-012 | Schema decision for TreatmentSession: new `TreatmentSession` entity vs extended `Appointment` attributes (`sessionCompletedAt`, `sessionPlanItemIds[]`). | Decision Record B8–B9 | [!] |
| BR-OPEN-013 | Discount-limit numeric values and approver role above the cap (percentage cap, fixed-INR cap, exception approver). | Decision Record B14 | [!] |
| BR-OPEN-014 | Timeout for unresolved WhatsApp pending-approval requests (value for "N hours" before the provisional confirmation expires). | Decision Record C17 | [!] |

## 10. Traceability

| BRD ID | FRD anchor | PFSR feature(s) | Workflow / spec |
|---|---|---|---|
| BR-SCP-001 | FR-AUTH-* | A1–A4, M1 | `RBAC_Permissions_Matrix_v1.0.md`, `NFR_Security_Requirements_v1.0.md` |
| BR-SCP-002 | FR-SCHED-* | D1–D6, F1–F3 | `Clinical_Workflow_Specification_v1.0.md`, `FRD` §Scheduling |
| BR-SCP-003 | FR-APT-* | C1–C7, D1–D7 | `Clinical_Workflow_Specification_v1.0.md` |
| BR-SCP-004 | FR-WA-* | I1–I7, J1–J12 | `Clinical_Workflow_Specification_v1.0.md`, `FRD` §WhatsApp |
| BR-SCP-005 | FR-PAT-* | B1–B3, P1–P8 | `Clinical_Workflow_Specification_v1.0.md`, `RBAC_Permissions_Matrix_v1.0.md` |
| BR-SCP-006 | FR-CLIN-* | E1–E3, G1–G3, H1–H3 | `Clinical_Workflow_Specification_v1.0.md` |
| BR-SCP-007 | FR-BIL-* | L1–L11, M1–M14 | `Financial_Workflow_Specification_v1.0.md` |
| BR-SCP-008 | FR-ANA-* | N1–N4 | `Financial_Workflow_Specification_v1.0.md` §Reports, `FRD` §Analytics |
| BR-SCP-009 | FR-OPS-* | O1–O4 | `NFR_Security_Requirements_v1.0.md`, `Production_Acceptance_Criteria_v1.0.md` |
| BR-SCP-010 | FR-TEN-* | §1 architecture | `NFR_Security_Requirements_v1.0.md` |
| BR-SCP-011 | FR-BIL-GST, FR-OPS-REG | L-rows GST, infrastructure | `Financial_Workflow_Specification_v1.0.md`, `NFR_Security_Requirements_v1.0.md` |

## 11. Change log (BRD only)

| Date | Change | Author |
|---|---|---|
| 2026-11-22 | Initial BRD v1.0 drafted from existing authoritative sources. Documentation-only. | Documentation agent |
| 2026-11-22 | Rev 1.1 applied per owner-approved **DentalEase v1.0 — Owner Decision Record** (items A1–D21). Changes: two-primary-role model (Dentist, Receptionist) with ownership attribute; Assistant deferred; Super Admin repositioned as platform-only; dentist-approval gate on every booking (including WhatsApp self-bookings); insurance and treatment packages moved to OOS; TreatmentSession approved as a distinct artefact; split payments, separate receipts, configurable GST, configurable discount limits, dentist-approved refunds added to scope; invoice/payment/receipt/refund kept as separate records. New open items BR-OPEN-009…014. **No code, migration, route or data change.** | Documentation agent |
