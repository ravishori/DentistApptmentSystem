# Clinical Workflow Specification — DentalEase v1.0

| | |
|---|---|
| Document ID | CWF-DENTALEASE-v1.0 |
| Version | 1.0 Rev 1.1 — owner-approved amendments (2026-11-22) |
| Document date | 2026-11-22 |
| Baseline | `security/remediation-sprint-01` @ `938182e9a8513fad0c25bced6c6ebe52fbc29050` |
| Status | DRAFT — documentation-only |
| Authoritative sources | `BRD enhnanced.txt` §4.1 / §4.3 / §4.4, `ARCHITECTURE.md` §2 / §7, `database/schema.prisma` (Appointment, TreatmentPlan, Patient, EHR, Prescription, Document models), `docs/PROJECT_FEATURE_STATUS.md` B-, C-, D-, E-, F-, G-, H-, I-, J-, P-rows |

> **Scope.** This specification covers patient journeys where clinical workflow is touched. Financial side-effects (invoice creation, payment capture) are summarised and linked to `Financial_Workflow_Specification_v1.0.md`. Reminder and WhatsApp wire-level flows are summarised; the authoritative sequence diagram is `ARCHITECTURE.md` §7.

---

## 1. Patient onboarding

### CW-001 New-patient creation (clinic-initiated)

- Actor: receptionist (or clinic_admin). WhatsApp-initiated onboarding → CW-002.
- Preconditions: authenticated session; `patients:write` (RP-PERM-002) applies once BR-OPEN-003 is closed.
- Steps:
  1. Receptionist opens `/patients/new`.
  2. Required fields: `fullName`, `phone` (format validation pending BR-OPEN-003 P7), `waOptIn`.
  3. Optional: `email`, `dateOfBirth`, `gender`, `bloodGroup`, `address`, `city`, `pincode`, `allergies[]`, `medicalConditions[]`, `familyHeadId`, `relationship`.
  4. Server creates record with next `patientCode` (`PT-NNNN`, unique per clinic) and returns the patient row minus financial and system fields (`outstandingBalance`, `patientCode`, `totalVisits`, `isActive`) per PFSR P1/P3.
- Postconditions: audit event emitted; patient appears in list and search.

### CW-002 WhatsApp-initiated onboarding

- Actor: Patient (via WhatsApp). See BR-SCP-005 feature 19.
- Preconditions: clinic has active WhatsApp provider; FR-WA-005 signature verification resolved (BR-OPEN-005 open).
- Steps:
  1. Inbound WhatsApp message with onboarding intent routed via webhook → `WhatsappSessionService`.
  2. Bot asks for name, age, medical info, consent.
  3. On consent, a `Patient` record is created with `waOptIn=true`.
  4. WhatsApp session context stored in Redis under session key.
- Open decisions: signature verification (BR-OPEN-005); conversation payload redaction (RP-OPEN-004).

### CW-003 Family linking

- Actor: receptionist / clinic admin.
- Steps:
  1. Open patient profile → link family member.
  2. Set `familyHeadId` and `relationship` (spouse / child / parent / other).
  3. Both patients share medical history visibility inside family view.
- Access: `GET /patients/:id/family` currently returns phone, DOB, gender to any role (P8 open).

## 2. Appointment booking

> **Owner rule (Decision Record A5, C16–C18):** every new booking — dashboard or WhatsApp — remains **pending** until a dentist approves it. The patient confirmation (WhatsApp template `WA_TMPL_APT_CONFIRM`) is sent **only after approval**.

### CW-004 Dashboard booking (single-dentist clinic)

- Actor: receptionist.
- Preconditions: dentist has `doctor_availabilities` rules; slot generator has produced `appointment_slots`.
- Steps:
  1. Receptionist chooses patient, date.
  2. UI calls `GET /appointments/slots?dentistId=…&date=…`.
  3. Receptionist selects slot → `POST /appointments` with `type`, optional `chiefComplaint`, optional `notes`.
  4. Appointment status is **`scheduled` (pending dentist approval)**; event `appointment.booked.pending` is emitted (naming subject to engineering).
  5. The assigned dentist (or an authorised dentist in the same clinic) opens the pending-approval queue and approves. Approval sets `approvedByUserId` and `approvedAt`; status transitions to `confirmed`; event `appointment.approved` is emitted.
  6. On approval, the final confirmation template is sent to the patient when `patient.waOptIn=true`.
- WhatsApp side-effect (receptionist-created booking): no outbound message is sent before approval. Optional operator-visible "created, awaiting dentist approval" indicator on the dashboard.
- Reject / timeout: dentist MAY reject with reason; a pending booking that is not approved within the configured timeout (default pending BR-OPEN-014) expires, releases the slot, and sends a "could not confirm" courtesy message to the patient.

### CW-005 Dashboard booking (multi-dentist clinic with chairs)

- Difference from CW-004: slot generator may auto-assign `chair_id`; receptionist may override. Overlapping bookings for the same `dentistId` or `chair_id` are rejected.

### CW-006 WhatsApp booking flow (provisional)

- Actor: Patient via WhatsApp (`BookingFlow`, see `apps/api/src/modules/whatsapp/flows/booking.flow.ts`).
- Steps: patient picks dentist → date → slot. The flow creates an appointment in status `scheduled` (pending). The patient immediately receives a **provisional acknowledgement** ("Received. Pending dentist approval."). No final confirmation is sent at this step.
- The assigned dentist receives the request in the pending-approval queue (dashboard + optional provider notification) and approves or rejects:
  - **Approve:** status → `confirmed`, `approvedByUserId`/`approvedAt` set, final confirmation template sent to the patient.
  - **Reject:** patient receives a rejection message with optional reason; slot is released.
  - **Timeout:** on no decision within the configured window (default pending BR-OPEN-014), the slot is released and the patient receives the pending-approval expiry notice.
- Constraints:
  - Only `patient.waOptIn=true` patients receive outbound responses.
  - Dentist listing: `role in {dentist}` (and users carrying the `isClinicOwner` attribute if they are also dentists). Target model drops `clinic_admin` as a role (BR-OPEN-011).
  - Policy flag: reminder state `sent_48h` vs the Prisma `ReminderStatus` enum — tracked under BR-OPEN-010.

### CW-007 Reschedule

- Allowed from statuses {`scheduled`, `confirmed`}.
- New appointment is created or current appointment moved (implementation-specific) with `rescheduled_from_id` pointer; event `appointment.rescheduled` emitted; WhatsApp template `WA_TMPL_RESCHEDULED` sent.

### CW-008 Cancellation

- Allowed from statuses {`scheduled`, `confirmed`}. Captures `cancel_reason`, `cancelled_at`.
- Event `appointment.cancelled` → `WA_TMPL_CANCELLED` template.
- Policy: `<24h` cancellation handling is part of clinic policy (BRD feature 3); current implementation does not enforce a time window.

### CW-009 No-show

- Allowed from statuses {`scheduled`, `confirmed`} after the appointment window elapses.
- No automatic WhatsApp template for no-show in v1.0.

### CW-010 Check-in and lifecycle

- Dentist/receptionist transitions: `confirmed` → `in_progress` on check-in, `in_progress` → `completed` on finish.
- `appointment.completed` event → follow-up WhatsApp after 24h (`FollowupFlow`).

## 3. Clinical capture

### CW-SESSION TreatmentSession as the clinical-work artefact

- Owner-approved (Decision Record B8, B9, B15): a **TreatmentSession** is a distinct artefact representing the clinical work actually performed.
- Relationships:
  - Exactly one TreatmentSession per appointment that produced clinical work (no session for no-show / cancelled appointments).
  - Zero or many links to treatment-plan procedures: a session MAY fulfil one or more plan items, and one plan item MAY be fulfilled across multiple sessions (partial fulfilment with quantity tracking).
  - TreatmentSession is the **billing anchor**: an invoice is produced from a session (FR-BIL-001), not directly from an appointment.
- Implementation decision (new entity vs attributes on `Appointment`): tracked under BR-OPEN-012.

### CW-011 Clinical notes and EHR

- Dentist attaches clinical notes to the **TreatmentSession** (and through it to the appointment).
- Attachments (X-ray, images) are stored in S3; DB holds metadata (name, size, S3 key, MIME).
- Odontogram data is tied to the patient; updates during a session reference that session.

### CW-012 Treatment plan

- Dentist creates a plan: `planTitle`, optional `diagnosis`, `notes`, status `draft`.
- Items reference procedures; carry `unitPrice`, `discountPct`, `quantity`, tooth and surfaces.
- Plan items are **completed by TreatmentSessions**, not directly by appointments. One item MAY be completed across multiple sessions (quantity decrement per session).
- Status flow: `draft → presented → accepted → in_progress → completed` (or `cancelled`).
- Current build: treatments controller is unmounted (FR-CLIN-007); the dentist UI pages exist. Plans can be created once the controller is mounted and the price-policy gates (`docs/security/treatment-price-policy.md` §4) are closed.

### CW-013 Prescription issuance

- Dentist issues a prescription from a TreatmentSession (or an appointment where no session is expected).
- Prescription stored under the Prescription model (route group mounted per PFSR §1).
- Patient-facing PDF delivery over WhatsApp uses an approved prescription template; route group remains subject to WhatsApp consent.

## 4. Reminders and follow-ups

### CW-014 Reminder cadence

- Pre-visit reminders at 48h (BRD feature 9), 24h and 2h before appointment, driven by `ScheduleModule` cron jobs in the WhatsApp module.
- Each reminder transitions `reminderStatus` to the next value from `ReminderStatus`.
- Idempotency: a reminder is sent at most once per state.

### CW-015 6-month recall

- Trigger: `FollowupFlow` identifies patients whose last completed visit exceeds 6 months and schedules a recall message.
- Consent: only `patient.waOptIn=true` patients receive messages.

### CW-016 Post-treatment follow-up

- Trigger: `appointment.completed` → 24h delay → follow-up template.
- Content: care instructions + feedback / rating prompt (which `FollowupFlow` processes).

## 5. Patient communication and escalation

### CW-017 Two-way media

- Patients can send X-rays, photos; staff can send PDFs and images back (BRD feature 13).
- Media handling: WhatsApp → provider → inbound webhook → stored; outbound media uses signed S3 URLs.

### CW-018 Human takeover

- `WhatsappConversation.isHumanTakeover = true` and `assignedToUserId` route the conversation to a receptionist.
- Outbound automation is paused for conversations in `HUMAN_TAKEOVER` state.

## 6. Clinical guardrails

- No AI autonomous diagnosis, prescribing or treatment selection (BR-OOS-002).
- All clinical actions are authenticated; all patient and clinical queries are tenant-scoped.
- Patient-identifying data must not appear in logs or alerts (`AGENTS.md` §5). Masking via `maskPhone` is required for phone numbers.
- Treatment prices are financial data; display is gated by `billing:read` once the matrix is applied to the appointment payload (already applied in appointment responses).

## 7. Open clinical decisions

| ID | Topic | Reference |
|---|---|---|
| CW-OPEN-001 | Phone-number format validation (E.164) and consent enforcement at boundary. | PFSR P7 |
| CW-OPEN-002 | `patients:*` permission enforcement scope. | RP-OPEN-001 |
| CW-OPEN-003 | Prescription PDF delivery via WhatsApp (template approval and consent). | PFSR H- |
| CW-OPEN-004 | Odontogram surface definition canonicalisation (per-tooth surfaces list). | PFSR E- |
| CW-OPEN-005 | 48h reminder state storage vs current `ReminderStatus` enum. | PFSR J-, `ReminderFlow` |

## 8. Traceability

| CW ID | BRD | FRD | PFSR | Workflow or flow file |
|---|---|---|---|---|
| CW-001 / CW-002 / CW-003 | BR-SCP-005 | FR-PAT-001…005 | B-, P1–P8 | `patients.service.ts` |
| CW-004 / CW-005 | BR-SCP-002, BR-SCP-003 | FR-APT-001…005 | C-, D-, F- | `appointments.service.ts`, `appointment-slots.service.ts` |
| CW-006 | BR-SCP-004 | FR-WA-001…006 | I-, J- | `whatsapp/flows/booking.flow.ts` |
| CW-007 | BR-SCP-003 | FR-APT-003 | C- | `appointments.service.ts` |
| CW-008 | BR-SCP-003 | FR-APT-002 | C- | `appointments.service.ts`, `AutomationService.onCancelled` |
| CW-009 | BR-SCP-003 | FR-APT-004 | C- | `appointments.service.ts` |
| CW-010 | BR-SCP-003 | FR-APT-001 | C- | `appointments.service.ts` |
| CW-011 / CW-012 / CW-013 | BR-SCP-006 | FR-CLIN-001…005 | E-, G-, H- | `ehr`, `treatments`, `prescriptions` modules |
| CW-014 / CW-015 / CW-016 | BR-SCP-004, BR-SCP-006 | FR-WA-002…004 | I-, J- | `whatsapp/flows/reminder.flow.ts`, `followup.flow.ts` |
| CW-017 / CW-018 | BR-SCP-004 | FR-WA-001…006 | I-, J- | `whatsapp.service.ts`, `whatsapp-session.service.ts` |

## 9. Change log

| Date | Change | Author |
|---|---|---|
| 2026-11-22 | Initial clinical workflow spec v1.0. | Documentation agent |
| 2026-11-22 | Rev 1.1 applied per owner-approved Decision Record. Introduced dentist-approval gate (CW-004, CW-005, CW-006) for every booking including WhatsApp self-bookings; added CW-SESSION as the TreatmentSession workflow anchor; rewrote CW-011, CW-012, CW-013 to anchor on the session rather than the appointment. Removed references to packages/insurance clinical workflows. **No code, migration or data change.** | Documentation agent |
