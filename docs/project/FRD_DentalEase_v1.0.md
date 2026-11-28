# Functional Requirements Document — DentalEase v1.0

| | |
|---|---|
| Document ID | FRD-DENTALEASE-v1.0 |
| Version | 1.0 Rev 1.1 — owner-approved amendments (2026-11-22) |
| Document date | 2026-11-22 |
| Baseline branch / commit | `security/remediation-sprint-01` @ `938182e9a8513fad0c25bced6c6ebe52fbc29050` |
| Status | DRAFT — documentation-only. No implementation change. |
| Companion documents | `BRD_DentalEase_v1.0.md`, `RBAC_Permissions_Matrix_v1.0.md`, `Clinical_Workflow_Specification_v1.0.md`, `Financial_Workflow_Specification_v1.0.md`, `NFR_Security_Requirements_v1.0.md`, `Production_Acceptance_Criteria_v1.0.md` |
| Source material | `ARCHITECTURE.md`, `database/schema.prisma`, `docs/PROJECT_FEATURE_STATUS.md` (PFSR), `BRD enhnanced.txt`, `apps/api/src/common/guards/permissions.guard.ts` |

> **Convention.** `[A]` = approved + evidenced; `[?]` = reasonable assumption needing confirmation; `[!]` = unresolved decision. Each FR row traces to BRD and PFSR. Status tags follow PFSR ("COMPLETE — VERIFIED", "IMPLEMENTED — PARTIALLY VERIFIED", etc.). This document does not re-declare PFSR status; it names the current PFSR status for context only and defers to PFSR as the authoritative verification record.

---

## 1. Authentication, session and authorisation

| FR ID | Requirement | BRD | PFSR | Type | Notes |
|---|---|---|---|---|---|
| FR-AUTH-001 | A public `POST /auth/register` endpoint SHALL create a new clinic (tenant), create the first user with role `clinic_admin`, start a 14-day trial, and issue a JWT access + refresh pair. Response SHALL NOT include `passwordHash` or any hash. | BR-SCP-001, BR-VIS-001 | A1 | [A] | Open-signup policy is BR-OPEN-001 `[!]`. |
| FR-AUTH-002 | Registration SHALL hash the password with bcrypt cost 12. | BR-SCP-001 | A1, A2 | [A] | |
| FR-AUTH-003 | `POST /auth/login` SHALL authenticate email + password, reject with `401` using the same body for unknown-email and wrong-password cases (subject to the enumeration decision BR-OPEN-002), and lock the account for 15 minutes after 5 consecutive failed attempts. | BR-SCP-001 | A2 | [A] | |
| FR-AUTH-004 | JWT access tokens SHALL be short-lived; refresh tokens SHALL be rotated on every refresh with a unique `jti`; logout SHALL revoke both the refresh token and the current access token. | BR-SCP-001 | A3 | [A] | |
| FR-AUTH-005 | The system SHALL read the user role from the database on every request and ignore any `role` claim present in the token. | BR-SCP-001 | A3, A4 | [A] |
| FR-AUTH-ROLE | Owner-approved role model (Decision Record A1–A4): clinic users carry one of two primary roles — `dentist` or `receptionist`. Ownership is an **attribute** on the user (e.g. `isClinicOwner: boolean`), **not** a separate role. Owners of either primary role gain the administrative permissions that `clinic_admin` currently holds. `super_admin` is a platform-operations role only. `assistant` is **deferred** (no permission grants in v1.0). | BR-USR-001…005, BR-OPEN-011 | A4 | [A] Documentation of target model. **Application code still reflects the five-role enum** until BR-OPEN-011 closes. | |
| FR-AUTH-006 | The global guard order SHALL be: Throttler (100/min/IP) → JwtAuth → TenantIsolation → Roles → Permissions. | BR-CST-001, BR-CST-006 | §1 | [A] | |
| FR-AUTH-007 | Passwordless flows (OTP, magic link) are **not** part of v1.0 scope. | BR-OOS (implied) | n/a | [?] | No OTP route present in DentalEase code; the C3 section of the imported `MASTER_PROJECT_TRACKER.md` describes a different project and does not apply. |

## 2. Multi-tenancy

| FR ID | Requirement | BRD | PFSR | Type |
|---|---|---|---|---|
| FR-TEN-001 | Every tenant-scoped table SHALL carry `clinicId: UUID NOT NULL` and SHALL be queried with `clinicId` derived from the verified JWT only. | BR-SCP-010, BR-CST-001 | §1 | [A] |
| FR-TEN-002 | The system SHALL NOT trust a `clinicId` supplied in a request body or query parameter. | BR-CST-001 | A4, F- | [A] |
| FR-TEN-003 | Cross-tenant object access SHALL return `404` (safe), not `403`. | BR-SCP-010 | P4 | [A] |
| FR-TEN-004 | Database-level row-level security is NOT enforced in v1.0; isolation is enforced in application services and guards. | BR-CST-005 | §1 | [A] |
| FR-TEN-005 | Each clinic MAY have its own WhatsApp provider API key stored in `clinic.waApiKey`; webhook URL SHALL be `/api/v1/whatsapp/webhook/:clinicId` (or `:tenantId` compatibility). | BR-SCP-004 | I1–I3 | [A] |

## 3. Clinic configuration and staff management

| FR ID | Requirement | BRD | PFSR | Type |
|---|---|---|---|---|
| FR-CFG-001 | A clinic admin SHALL be able to read and update the clinic profile (name, address, GST number, logo URL, contact). | BR-SCP-001 | B-, O- | [A] |
| FR-CFG-002 | Clinic settings (working hours, slot duration, break window, buffer time) SHALL be stored in `clinic.settings` JSON and editable via a dedicated endpoint. | BR-ASM-003 | §1 | [A] |
| FR-CFG-003 | Clinic admins SHALL add, activate, deactivate and list staff (dentist, receptionist, assistant). | BR-SCP-009 | A4, F- | [A] |
| FR-CFG-004 | Chairs SHALL be manageable per clinic (name, is_active, display order); chairs are optional for single-dentist clinics. | BR-SCP-002 | D-, F- | [A] |

## 4. Single- and multi-dentist scheduling

| FR ID | Requirement | BRD | PFSR | Type |
|---|---|---|---|---|
| FR-SCHED-001 | Each dentist SHALL have weekly availability rules (`doctor_availabilities`) and may receive per-day overrides (`doctor_schedules`, type `working`/`leave`/`holiday`). | BR-SCP-002 | D-, F- | [A] |
| FR-SCHED-002 | Slots (`appointment_slots`) SHALL be generable per dentist, per day, respecting availability, overrides, slot minutes, and optional auto-assigned chair. | BR-SCP-002, BR-SCP-003 | D- | [A] |
| FR-SCHED-003 | Availability queries SHALL return, per dentist per day: working window, slotMins, booked slots with patient reference, and status (`working` / `leave` / `holiday` / `unavailable`). | BR-SCP-002 | D- | [A] |
| FR-SCHED-004 | Single-dentist clinics SHALL work without requiring chair or multi-doctor data; the schema permits `chair_id IS NULL` in slots and appointments. | BR-SCP-002 | D- | [A] |
| FR-SCHED-005 | Slot blocking SHALL carry a free-text `block_reason`; only `SLOT_MANAGER_ROLES` may read or modify blocked reasons. | BR-SCP-003 | A4, D- | [A] |

## 5. Appointment lifecycle

| FR ID | Requirement | BRD | PFSR | Type |
|---|---|---|---|---|
| FR-APT-001 | An appointment SHALL have status in {`scheduled`, `confirmed`, `in_progress`, `completed`, `cancelled`, `no_show`, `rescheduled`}. | BR-SCP-003 | C-, D- | [A] |
| FR-APT-002 | Booking an appointment SHALL emit `appointment.booked`; completion SHALL emit `appointment.completed`; cancellation SHALL emit `appointment.cancelled`. | BR-SCP-004 | C-, I-, J- | [A] |
| FR-APT-003 | Reschedule SHALL preserve original appointment via `rescheduled_from_id`. | BR-SCP-003 | C-, D- | [A] |
| FR-APT-004 | No-show SHALL be transitionable from `confirmed` / `scheduled`. | BR-SCP-003 | C- | [A] |
| FR-APT-005 | List queries SHALL support filters: date, dentistId, status, startDate, endDate. | BR-SCP-003 | C-, D- | [A] |
| FR-APT-006 | Appointment responses SHALL hide money fields (`estimatedCost`, nested `invoice`, treatment `unitPrice`, `discountPct`) from callers lacking `billing:read`; keys SHALL be removed and `financialsRestricted: true` SHALL be set. | BR-OPEN-004 | §4 appointment-financials | [A] |
| FR-APT-APPROVE | **Every new booking SHALL remain pending until it is approved by a dentist.** On creation by any non-dentist actor (including WhatsApp self-booking by patient), the appointment enters a provisional state and SHALL NOT be treated as confirmed. A dentist (the assigned dentist OR another authorised dentist in the same clinic) SHALL explicitly approve the booking. The appointment record SHALL carry `approvedByUserId` and `approvedAt`; final patient confirmation (dashboard notification + WhatsApp confirmation template) SHALL be sent **only** after approval. | BR-SCP-003, Decision Record A5, C16–C18 | C-, I-, J- | [A] Requirement. Schema addition is BR-OPEN-012-adjacent (approval fields). |
| FR-APT-APPROVE-TIMEOUT | Unresolved pending-approval bookings SHALL expire after a configurable timeout (clinic-level setting, default value pending BR-OPEN-014). On expiry the slot SHALL be released and the patient SHALL receive a courtesy "we could not confirm your request" message when they have `waOptIn=true`. | Decision Record C17, BR-OPEN-014 | C-, I-, J- | [A] Requirement. Default value pending. |

## 6. Patient CRM

| FR ID | Requirement | BRD | PFSR | Type |
|---|---|---|---|---|
| FR-PAT-001 | Patients SHALL carry demographic, contact, medical, consent and family-linking fields (`familyHeadId`, `relationship`, `allergies[]`, `medicalConditions[]`, `waOptIn`). | BR-SCP-005 | B-, P- | [A] |
| FR-PAT-002 | Patient create and update SHALL use explicit field lists; no mass assignment. `clinicId`, `outstandingBalance`, `patientCode`, `totalVisits`, `isActive` SHALL NOT be writable through update DTOs. | BR-CST-001 | P1, P3 | [A] |
| FR-PAT-003 | `GET /patients/stats` SHALL return counts for every role, but `totalOutstanding` SHALL be gated by `billing:read` with `financialsRestricted: true` when gated. | BR-OPEN-004 | P2 | [A] |
| FR-PAT-004 | Family linking SHALL allow spouse / child / parent relationships and shared treatment history. | BR-SCP-005 | B- | [A] |
| FR-PAT-005 | WhatsApp opt-in (`waOptIn`) SHALL be the single source of truth for outbound WhatsApp consent and SHALL NOT be rewritten by an omitted field in an update DTO. | BR-SCP-005 | P3 consent.spec | [A] |
| FR-PAT-006 | Permission enforcement across `/patients*` routes is **unresolved**: current state leaves routes unguarded. Final policy owes decisions BR-OPEN-003. | BR-OPEN-003 | A4, P5, P6, P8 | [!] |

## 7. Clinical workflow (procedures, treatment plans, treatment sessions, EHR, prescriptions, documents)

| FR ID | Requirement | BRD | PFSR | Type |
|---|---|---|---|---|
| FR-CLIN-001 | A procedure catalog SHALL support name, code, category, default price, duration minutes, is_active. | BR-SCP-006 | G-, H- | [A] |
| FR-CLIN-002 | Treatment plans SHALL have multi-line items (`unitPrice`, `discountPct`, `quantity`, tooth, surfaces) and plan-level status in {`draft`, `presented`, `accepted`, `in_progress`, `completed`, `cancelled`}. | BR-SCP-006 | G-, H- | [A] |
| FR-CLIN-SESSION | **TreatmentSession** SHALL be a distinct artefact representing clinical work performed. One session SHALL be linked to exactly one appointment and MAY be linked to zero or more treatment-plan procedures. One treatment-plan procedure MAY be completed across multiple sessions. No-show / cancelled appointments produce no session and therefore no invoice. Invoicing is anchored on the session, not on the appointment. | BR-SCP-003a, Decision Record B8, B9, B15 | E-, G-, H- | [A] Implementation choice tracked under BR-OPEN-012. |
| FR-CLIN-003 | EHR capability SHALL cover clinical notes with attachments, odontogram data, and link clinical items to the session (and through it to the appointment). | BR-SCP-006 | E-, G-, H- | [A] |
| FR-CLIN-004 | Prescription records SHALL exist as a distinct module with their own routes. | BR-SCP-006 | H- | [A] |
| FR-CLIN-005 | Documents (X-rays, PDFs) SHALL be stored in S3; database holds metadata only. | BR-SCP-006, BR-DEP-005 | E-, G- | [A] |
| FR-CLIN-006 | 6-month recall for cleaning and routine check-ups SHALL be supported via scheduled jobs. | BR-SCP-006 | J- | [A] |
| FR-CLIN-007 | The `treatments` controller is present in source but currently **NOT mounted** in `AppModule`; it SHALL remain unmounted until the gates in `docs/security/treatment-price-policy.md` §4 are met. | BR-OPEN-008 | §1 | [!] |

## 8. WhatsApp automation

| FR ID | Requirement | BRD | PFSR | Type |
|---|---|---|---|---|
| FR-WA-001 | Each clinic SHALL have a webhook URL scoped by clinic id; inbound messages SHALL be routed to the correct tenant. | BR-SCP-004 | I-, J- | [A] |
| FR-WA-002 | Outbound messages SHALL use approved templates for appointment **provisional notice**, **appointment confirmation (only after dentist approval)**, 48/24/2h reminders, cancellation, reschedule, invoice link, follow-up, broadcast, payment receipt, and pending-approval expiry notice. | BR-SCP-004, Decision Record C17–C18 | I-, J- | [A] |
| FR-WA-BOOK-PROVISIONAL | A WhatsApp self-booking SHALL immediately receive a **provisional** acknowledgement ("received, pending dentist approval"); the **final confirmation** template SHALL be sent **only** after the dentist approves the booking (FR-APT-APPROVE). On expiry (FR-APT-APPROVE-TIMEOUT) the patient SHALL receive the pending-approval expiry notice. | Decision Record C17–C18 | I-, J- | [A] |
| FR-WA-003 | Message delivery states SHALL be tracked: `queued`, `sent`, `delivered`, `read`, `failed` with `failure_reason`. | BR-SCP-004 | I-, J- | [A] |
| FR-WA-004 | The system SHALL NOT send any live WhatsApp message unless the recipient's `waOptIn` is `true` and the active provider is configured with valid credentials. | BR-OOS-005 | I-, J-, O3 | [A] |
| FR-WA-005 | Inbound webhook SHALL verify Twilio signature authenticity before processing. | BR-OPEN-005 | O3 | [!] |
| FR-WA-006 | Conversation and message retrieval SHALL be gated by a permission; current state leaves `GET /whatsapp/conversations*` unguarded (W1–W3 in authorisation review). | BR-OPEN-003 | §1 | [!] |
| FR-WA-007 | Automation flows (`AutomationService` via `EventEmitter`) are additive to the scheduled flows (`ReminderFlow`, `FollowupFlow`). `AutomationService` is currently **not registered** in any module and SHALL remain so unless the double-send and in-memory-timer concerns are resolved. | BR-SCP-004 | I-, J- | [!] |

## 9. Billing, invoicing, payments

| FR ID | Requirement | BRD | PFSR | Type |
|---|---|---|---|---|
| FR-BIL-001 | Invoices SHALL carry `invoiceNumber` (unique per clinic), status in {`draft`, `sent`, `partially_paid`, `paid`, `overdue`, `cancelled`, `refunded`}, totals (`subtotal`, `discountAmount`, `taxAmount`, `totalAmount`, `paidAmount`, `balanceAmount`). Invoice SHALL be anchored on a **TreatmentSession** (FR-CLIN-SESSION); appointments without a session produce no invoice. | BR-SCP-007, BR-SCP-011 | L-, M- | [A] |
| FR-BIL-GST | **GST is configured explicitly at the clinic level** (Decision Record B12). Default state is OFF. When enabled, standard rate is 18%; clinics MAY override per invoice via `taxPercent`. When GST is OFF, invoices SHALL omit tax lines and `taxAmount SHALL = 0`, and the clinic SHALL NOT appear in the monthly GST report. | BR-SCP-011, Decision Record B12 | L- | [A] |
| FR-BIL-002 | Payment records SHALL support methods in {`razorpay`, `cash`, `upi`, `card`, `netbanking`, `other`} with status in {`pending`, `success`, `failed`, `refunded`}. `insurance` method is **not in v1.0 scope** (BR-OOS-004); its presence in the Prisma enum does not authorise use. | BR-SCP-007, BR-OOS-004 | L-, M- | [A] |
| FR-BIL-003 | Razorpay signature SHALL be verified via HMAC-SHA256 before marking a payment as success. | BR-SCP-007 | L-, M- | [A] |
| FR-BIL-004 | Financial fields on patient (`outstandingBalance`) and appointment (`estimatedCost`, `invoice`, treatment prices) responses SHALL be removed for callers lacking `billing:read`. | BR-OPEN-004 | P1, P2, §4 appointment-financials | [A] |
| FR-BIL-005 | Daily closing and ageing (0-30 / 31-60 / 61-90 / 90+) reports SHALL be derivable from invoice and payment tables. | BR-SCP-007 | L-, N- | [A] |
| FR-BIL-006 | Treatment-price catalog edits are reserved for admins (ownership attribute); dentist price edit permission is pending decision. | BR-OPEN-004 | §1, price-policy | [!] |
| FR-BIL-SPLIT | One invoice MAY be settled by **multiple payments of different methods captured in one operator action** (split tender). Each tender produces a separate `Payment` row; the invoice's `paidAmount` and `balanceAmount` are derived from the sum of successful payments. The operator SHALL NOT be forced to create a draft invoice per tender. | BR-SCP-007, Decision Record B10 | L-, M- | [A] |
| FR-BIL-DISC | Clinics SHALL be able to configure a **percentage cap** and a **fixed-INR cap** on discounts (per line and per invoice); discounts within the cap SHALL be applied without approval; discounts above the cap SHALL require an approver (approver role pending BR-OPEN-013). An above-cap discount SHALL carry `discountApprovedByUserId`, `discountApprovedAt` and `discountReason`. Default cap values are pending BR-OPEN-013. | BR-SCP-007, Decision Record B14 | L-, M- | [A] Pending default values. |
| FR-BIL-RCPT | On every successful payment the system SHALL emit a **separate receipt** record (one receipt per payment, not per invoice). The receipt SHALL be deliverable as PDF and as a WhatsApp template (`WA_TMPL_RECEIPT`) when `patient.waOptIn=true`. Receipt SHALL carry its own unique receipt number scoped by clinic. | BR-SCP-007, Decision Record B13, B15 | L-, M- | [A] |
| FR-BIL-REFUND | Refunds SHALL require **explicit dentist approval** before execution (full or partial). A receptionist MAY execute a refund **only** when a valid dentist approval exists (`refundApprovedByUserId`, `refundApprovedAt`, `refundReason`). Refund records are **separate from the original Payment** (Decision Record B15) and carry an audit trail: executor, approver, amount, method, timestamp. | BR-SCP-007, Decision Record B11, B15 | L- | [A] |
| FR-BIL-RECORDS | Invoice, payment, receipt and refund SHALL be stored as **separate financial records** with their own identifiers, status enums and audit trails; the system SHALL NOT model any two of these as a single logical row. | BR-SCP-007a, Decision Record B15 | L- | [A] |
| FR-BIL-OOS-PKG | **Treatment packages (`TreatmentPackage`, `PatientPackage`) are NOT in v1.0 scope** (BR-OOS-005). The existing source-code implementation is present but does not qualify the feature for v1.0 (Decision Record D19). Route disposition is tracked under BR-OPEN-008; no runtime change is authorised by this FRD amendment (Decision Record D20). | BR-OOS-005 | L- | [A] Documentation-level exclusion. |
| FR-BIL-OOS-INS | **Insurance claims are NOT in v1.0 scope** (BR-OOS-004). The existing `insurance.service.ts` / `insurance.controller.ts` implementation does not qualify the feature for v1.0. No runtime change is authorised by this FRD amendment (Decision Record D20). | BR-OOS-004 | L- | [A] Documentation-level exclusion. |

## 10. Analytics and reports

| FR ID | Requirement | BRD | PFSR | Type |
|---|---|---|---|---|
| FR-ANA-001 | The executive dashboard SHALL surface daily revenue, appointments, no-show rate, and top procedures scoped by `clinicId`. | BR-SCP-008 | N- | [A] |
| FR-ANA-002 | Monthly / yearly trend endpoints SHALL be provided. | BR-SCP-008 | N- | [A] |
| FR-ANA-003 | Revenue exposure SHALL be gated by `billing:read`; a separate `RevenueAccessService` governs clinic-stats redaction. | BR-OPEN-004 | §4 N- | [A] |
| FR-ANA-004 | Predictive insights (inactive patients, LTV tiers) SHALL exist as endpoints; rollout is phase 1.5. | BR-SCP-008 | N- | [A] |

## 11. Notifications, errors, observability

| FR ID | Requirement | BRD | PFSR | Type |
|---|---|---|---|---|
| FR-OBS-001 | All failed requests SHALL be handled by the single global `HttpExceptionFilter` and `classifyException`. Per-controller try/catch for error-body shaping is prohibited. | BR-CST-006 | A-, O- | [A] |
| FR-OBS-002 | Structured logs SHALL be emitted via `logEvent(level, 'domain.event', { ...context })`; phone numbers SHALL be masked with `maskPhone`; patient-identifying data, SQL, stack traces or secrets SHALL NOT appear in logs or responses. | BR-CST-006 | A-, O-, log-hygiene.spec | [A] |
| FR-OBS-003 | Error alerts SHALL go only via `ErrorEmailService.report()` using environment-only configuration; no default recipient; `smtp_accepted` is **not** proof of delivery. | BR-CST-006 | O- | [A] |
| FR-OBS-004 | Notifications centre SHALL persist outbound email/WhatsApp notifications for audit; consent and fail-closed policy apply. | BR-SCP-009 | I-, J- | [A] |

## 12. Operational constraints

| FR ID | Requirement | Source |
|---|---|---|
| FR-OPS-REG | Hosting target: ap-south-1 for RDS / SES / S3; Next.js deployed via Vercel edge in India region. | `ARCHITECTURE.md` §5, `.env` |
| FR-OPS-HTTPS | HTTPS SHALL be enforced with HSTS and TLS 1.3 in production. | `ARCHITECTURE.md` §5 |
| FR-OPS-RATE | 100 requests per minute per IP SHALL be the baseline throttle; specific routes have lower limits (register 5/min, login 10/min). | `ARCHITECTURE.md` §5, PFSR A1, A2 |
| FR-OPS-BACKUP | Backups and restore procedure SHALL be executed and documented before production. Not yet executed in v1.0. | PFSR §2, BR-OPEN-007 |

## 13. Interface summary (reference, not source of truth)

Approved REST surface summary. Authoritative route list is `ARCHITECTURE.md` §3 and the mounted modules in PFSR §1. Routes not mounted in `AppModule` SHALL return `404`:

- Mounted modules: `analytics`, `appointments`, `auth`, `billing`, `clinic`, `clinic-management`, `documents`, `ehr`, `errors`, `notifications`, `patients`, `prescriptions`, `whatsapp`.
- NOT mounted: `tenants`, `treatments`, `users`.

## 14. Traceability (FR → BR → PFSR)

All rows above carry explicit `BRD` and `PFSR` columns. When changing an FR, update:
1. The corresponding BR row in `BRD_DentalEase_v1.0.md`.
2. The corresponding feature row in `docs/PROJECT_FEATURE_STATUS.md` with evidence (per `AGENTS.md` §1).
3. This FRD change-log table below.

## 15. Change log (FRD only)

| Date | Change | Author |
|---|---|---|
| 2026-11-22 | Initial FRD v1.0 drafted from authoritative sources. Documentation-only. | Documentation agent |
| 2026-11-22 | Rev 1.1 applied per owner-approved Decision Record. Added FR-AUTH-ROLE (two-primary-role model), FR-APT-APPROVE + FR-APT-APPROVE-TIMEOUT (dentist approval gate), FR-CLIN-SESSION (TreatmentSession artefact), FR-WA-BOOK-PROVISIONAL, FR-BIL-SPLIT, FR-BIL-DISC, FR-BIL-RCPT, FR-BIL-REFUND, FR-BIL-RECORDS, FR-BIL-OOS-PKG, FR-BIL-OOS-INS. Updated FR-BIL-GST (clinic-level optional) and FR-BIL-002 (dropped `insurance` method from v1.0). **No code, migration, route or data change.** | Documentation agent |
