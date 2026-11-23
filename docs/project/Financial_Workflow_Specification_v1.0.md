# Financial Workflow Specification — DentalEase v1.0

| | |
|---|---|
| Document ID | FWF-DENTALEASE-v1.0 |
| Version | 1.0 Rev 1.1 — owner-approved amendments (2026-11-22) |
| Document date | 2026-11-22 |
| Baseline | `security/remediation-sprint-01` @ `938182e9a8513fad0c25bced6c6ebe52fbc29050` |
| Status | DRAFT — documentation-only |
| Authoritative sources | `BRD enhnanced.txt` §4.5 / §4.6, `ARCHITECTURE.md` §2 / §5, `database/schema.prisma` (Invoice, InvoiceItem, Payment, TreatmentPackage, InsuranceClaim), `docs/security/treatment-price-policy.md`, `docs/PROJECT_FEATURE_STATUS.md` L-, M-, N-, P1–P3 |

---

## 1. Entities

Per owner-approved Decision Record B15: invoice, payment, receipt and refund SHALL be stored as **separate** financial records with their own identifiers, status enums and audit trails.

| Entity | Key fields | Status enum / notes |
|---|---|---|
| `Invoice` | `invoiceNumber` (`INV-YYYY-NNNN`, unique per clinic), `subtotal`, `discountPercent`, `discountAmount` (within clinic cap unless overridden with approval), `taxPercent` (0 unless GST enabled for clinic), `taxAmount`, `totalAmount`, `paidAmount`, `balanceAmount`, `sessionId` (anchor, FR-CLIN-SESSION) | `draft` / `sent` / `partially_paid` / `paid` / `overdue` / `cancelled` / `refunded` |
| `InvoiceItem` | `description`, `toothNumber`, `quantity`, `unitPrice`, `discountPct` (within cap), `lineTotal` (generated SQL column) | — |
| `Payment` | `amount`, `method`, `status`, Razorpay fields (`orderId`, `paymentId`, `signature`), `paidAt`, `splitGroupId` (nullable, groups split tenders) | method ∈ {`razorpay`, `cash`, `upi`, `card`, `netbanking`, `other`}, status ∈ {`pending`, `success`, `failed`, `refunded`}. **`insurance` method is OUT of v1.0 scope (BR-OOS-004) even though it exists in the Prisma enum.** |
| `Receipt` *(NEW, target model)* | `receiptNumber` (unique per clinic), `paymentId`, `amount`, `issuedAt`, optional WhatsApp delivery status | One receipt per successful `Payment`. Separate from `Invoice.pdfUrl`. Entity implementation deferred (BR-OPEN-012 adjacent). |
| `Refund` *(NEW, target model)* | `refundNumber`, `originalPaymentId`, `amount`, `method`, `status`, `approvedByUserId` (dentist), `approvedAt`, `executedByUserId` (dentist or receptionist), `executedAt`, `reason` | Separate record from the original `Payment`. |
| ~~`TreatmentPackage`~~ | — | **OUT of v1.0 scope** (BR-OOS-005, Decision Record A7). Source-code presence does not qualify the feature (Decision Record D19). |
| ~~`PatientPackage`~~ | — | **OUT of v1.0 scope** (BR-OOS-005). |
| ~~`InsuranceClaim`~~ | — | **OUT of v1.0 scope** (BR-OOS-004, Decision Record A6). Source-code presence does not qualify the feature. |

## 2. Core workflows

### FW-001 Invoice creation from a TreatmentSession

- Actor: receptionist or dentist (with `billing:write`) or owner.
- Owner-approved billing anchor (Decision Record B8, B15, FR-CLIN-SESSION): the invoice is produced from a **TreatmentSession**, not from the appointment. No session ⇒ no invoice (no-show / cancellation produces no invoice).
- Preconditions: session exists and is completed; GST state is determined from clinic settings (FR-BIL-GST).
- Steps:
  1. Operator opens `POST /billing/invoices` with `patientId`, `sessionId` (and derived `appointmentId`), line items.
  2. Server derives `subtotal`, applies discounts within clinic cap (above-cap discounts require approval, FR-BIL-DISC), computes `taxAmount` from clinic GST state (0 if GST disabled), computes `totalAmount` and `balanceAmount`, and assigns next `invoiceNumber`.
  3. Invoice is created with status `draft` unless explicit status is passed.
- Postconditions: event `invoice.created` may be emitted; PDF generation is on demand. Receipt emission is deferred to payment success (FW-004 / FW-005).

### FW-002 Invoice from a treatment plan (multi-session)

- Dentist/receptionist generates an invoice from the plan items completed within a given session.
- One plan item MAY be completed across multiple sessions; each completed slice is billed from its session (FR-CLIN-SESSION).
- Items are copied into `InvoiceItem` preserving tooth, surfaces, discount (within cap).

### FW-003 Sending an invoice via WhatsApp

- Trigger: operator sends invoice → event `invoice.sent` emitted.
- Side-effect: `WhatsappService.sendInvoiceLink` fires using `WA_TMPL_PAYMENT` with the Razorpay payment link.
- Consent: only `patient.waOptIn=true`.

### FW-004 Payment via Razorpay

- Steps:
  1. Operator or system calls `POST /billing/invoices/:id/pay` to create a Razorpay order; response includes `razorpayOrderId` and the amount in paise.
  2. Patient completes payment via Razorpay hosted page (public `/pay/[orderId]` web page).
  3. Browser or Razorpay callback hits `POST /billing/payments/verify`.
  4. Server verifies HMAC-SHA256 signature (`razorpay.keySecret`) before marking payment `success`.
  5. `Payment` created; invoice's `paidAmount`, `balanceAmount` and `status` updated (`paid` / `partially_paid`).
  6. **Receipt emission (FW-RCPT)** fires on success.
- Guarantees:
  - Signature verification is mandatory (FR-BIL-003).
  - Replay protected by unique `razorpayPaymentId` constraint.
  - Patient-identifying data is not logged (`maskPhone`, redacted fields).

### FW-005 Manual payment capture (cash / UPI / card off-provider)

- Receptionist records payment on `POST /billing/payments/manual` or an invoice-scoped endpoint, with method ∈ {`cash`, `upi`, `card`, `netbanking`, `other`}. `insurance` method is **out of v1.0 scope**.
- Payment status defaults to `success` when recorded manually.
- Invoice totals are updated identically to FW-004.
- Receipt emission (FW-RCPT) fires on success.

### FW-SPLIT Split-tender payment (one invoice, multiple methods)

- Owner-approved (Decision Record B10): one invoice MAY be settled by multiple payments of different methods captured in a single operator action.
- Steps:
  1. Operator chooses invoice → enters N tender lines (e.g. ₹500 cash + ₹1,500 UPI). Each tender carries method and amount.
  2. Server creates N `Payment` rows, sharing a `splitGroupId` for reconciliation, each with `status=success` (for manual tenders) or `status=pending` (for Razorpay until signature verified).
  3. Invoice totals are re-derived from the sum of successful payments.
  4. One `Receipt` is emitted per successful `Payment` (one receipt per tender), not one receipt for the split group.
- Audit: the split group is logged with operator userId and timestamp.

### FW-RCPT Receipt issuance

- Owner-approved (Decision Record B13, B15): on every successful `Payment`, emit a **separate `Receipt`** record. One receipt per payment (never per invoice).
- Receipt is addressable as PDF and deliverable over WhatsApp via `WA_TMPL_RECEIPT` when `patient.waOptIn=true`.
- Receipt number is unique per clinic.

### FW-DISC Discount and discount-cap workflow

- Owner-approved (Decision Record B14): clinic configures a percentage cap and a fixed-INR cap on discounts.
- At invoice entry:
  - Below the cap: discount is applied without approval.
  - Above the cap: approver (role pending BR-OPEN-013) SHALL approve before the invoice can move from `draft` to `sent`. Approval captures `discountApprovedByUserId`, `discountApprovedAt`, `discountReason`.
- Cap defaults are configured on `clinic.settings` (owner-editable through the clinic admin UI). Default cap values pending BR-OPEN-013.

### FW-006 Refund (dentist-approved, receptionist-executable)

- Owner-approved (Decision Record B11, B15): every refund requires explicit **dentist approval** before execution. A receptionist MAY execute a refund **only** when a valid dentist approval exists.
- Steps:
  1. Operator opens the payment record and requests a refund (full or partial) with a reason.
  2. Dentist approves (`refundApprovedByUserId`, `refundApprovedAt`, `refundReason`).
  3. Executor (dentist or receptionist) executes: a new `Refund` record is created (separate from the original `Payment`). `Refund.status` transitions `pending → processing → completed` for Razorpay-mediated refunds, or `completed` on write for manual refunds.
  4. Invoice `paidAmount` decreases; `balanceAmount` is recomputed; invoice status updates (`refunded` on full, `partially_paid` on partial).
  5. Refund audit trail is append-only.
- Razorpay refunds go through the Razorpay refund API; signature / provider-event reconciliation applies.
- A refund SHALL NOT be executed on a `Payment` that is already fully refunded.

### FW-007 Due tracking and ageing

- Ageing buckets (0–30 / 31–60 / 61–90 / 90+ days overdue) are derivable from `invoices` with `balanceAmount > 0` and `invoiceDate`.
- Automated due reminders (BRD feature 29): scheduled job can WhatsApp a reminder to patients with overdue invoices. Rollout subject to consent policy.

### FW-008 Daily closing report

- Scope: for a given clinic + date, summarise:
  - Cash collected (sum of `Payment.amount` with method=`cash`, status=`success`).
  - UPI / card / Razorpay collected similarly.
  - Open balance across unpaid invoices.
  - Count of invoices created and settled.
- Exported as CSV (the `/billing/reports/*` route group).

### FW-009 GST reporting (clinic-configurable)

- Owner-approved (Decision Record B12): GST is **explicitly configured at the clinic level**. Default state is OFF; the clinic admin enables it and provides a GST number.
- When GST is OFF for a clinic: invoices issued by that clinic SHALL omit tax lines (`taxAmount=0`), and the clinic SHALL NOT appear in the monthly GST report.
- When GST is ON: monthly report groups invoices by `invoiceDate` month and sums `taxableBase`, `cgst`, `sgst`, `igst`, `totalTax`, `totalRevenue`. Tax split is `CGST + SGST` for intra-state and `IGST` for inter-state. Intra-state vs inter-state detection remains `[?]`.

### FW-010 Treatment packages — OUT OF SCOPE v1.0

- Excluded by Decision Record A7. Entities and workflows deferred to a future release. Source-code presence does not qualify the feature (Decision Record D19). No runtime change authorised by this spec (Decision Record D20).

### FW-011 Insurance claims — OUT OF SCOPE v1.0

- Excluded by Decision Record A6. Entities and workflows deferred to a future release. Source-code presence does not qualify the feature. No runtime change authorised by this spec.

## 3. Price exposure controls

Governed by `docs/security/treatment-price-policy.md`. Approved rules in the current build:

| Surface | Hidden from role lacking `billing:read` |
|---|---|
| `GET /appointments*` | `estimatedCost`, nested `invoice`, treatment `unitPrice`, `discountPct` removed; `financialsRestricted: true` is set. |
| `GET /patients*` | `outstandingBalance` removed from create / update / list / detail / timeline responses. |
| `GET /patients/stats` | `totalOutstanding` omitted; `financialsRestricted: true` is set. |
| `GET /billing/invoices*` | `billing:read` gate; assistant → 403. |
| `GET /treatments*`, `/treatments/procedures/catalog` | Controllers not mounted (returns 404). |

Unresolved price decisions (from the price-policy proposal §5):

| ID | Topic |
|---|---|
| FW-OPEN-001 | Dentist price-edit rights. |
| FW-OPEN-002 | Receptionist access to `estimatedCost` at booking (current: yes via `billing:read`). |
| FW-OPEN-003 | Assistant visibility of any price at all. |
| FW-OPEN-004 | Catalog pricing: clinic-wide vs patient-specific. |
| FW-OPEN-005 | Appointment mutation permission guards. |

## 4. Reconciliation and audit

- Every payment capture is logged with userId (actor), amount, method, invoiceId, Razorpay IDs (if any) and paidAt.
- Status transitions on `Invoice` and `Payment` entities are append-only in the audit trail.
- Alerting is through `ErrorEmailService.report()`; delivery to real recipients is disabled by default (BR-CST-006).
- Webhook replays: idempotency on `razorpayPaymentId` ensures a payment is only applied once.

## 5. Reporting surface

| Route | Content | Permission |
|---|---|---|
| `GET /billing/reports/daily-revenue` | Daily revenue CSV/JSON | `billing:read` |
| `GET /billing/reports/outstanding` | Outstanding dues with 30 / 60 / 90 / 90+ buckets | `billing:read` |
| `GET /billing/reports/gst` | Monthly GST report | `billing:read` |
| `GET /analytics/dashboard` | Clinic KPIs (revenue / appointments / patients) | `analytics:read`; revenue redacted without `billing:read` via `RevenueAccessService` |
| `GET /analytics/revenue/*` | Revenue trends / per-procedure | `billing:read` |
| `GET /analytics/patients/ltv` | Patient lifetime value with tiers | `billing:read` |
| `GET /analytics/patients/inactive` | Inactive-patient flags with risk level | `analytics:read` |

## 6. Traceability

| FW ID | BRD | FRD | PFSR |
|---|---|---|---|
| FW-001…002 | BR-SCP-007 | FR-BIL-001, FR-BIL-GST | L-, M- |
| FW-003 | BR-SCP-004 | FR-WA-002 | I-, J- |
| FW-004 | BR-SCP-007 | FR-BIL-003 | L-, M- |
| FW-005 | BR-SCP-007 | FR-BIL-002 | L-, M- |
| FW-006 | BR-SCP-007 | FR-BIL-002 | L- |
| FW-007 | BR-GOAL-003, BR-SCP-007 | FR-BIL-005 | L-, M-, N- |
| FW-008 | BR-GOAL-004 | FR-BIL-005 | N- |
| FW-009 | BR-SCP-011 | FR-BIL-GST | L- |
| FW-010 / FW-011 | BR-SCP-007 | FR-BIL-007 | L- |

## 7. Change log

| Date | Change | Author |
|---|---|---|
| 2026-11-22 | Initial financial workflow spec v1.0. | Documentation agent |
| 2026-11-22 | Rev 1.1 applied per owner-approved Decision Record. §1 entities updated: added `Receipt` and `Refund` as separate records, dropped `insurance` method from v1.0, moved `TreatmentPackage` / `PatientPackage` / `InsuranceClaim` to OOS. FW-001 / FW-002 rewritten to anchor on TreatmentSession. Added FW-SPLIT, FW-RCPT, FW-DISC; rewrote FW-006 refund as dentist-approved and receptionist-executable. Rewrote FW-009 GST as clinic-level optional. FW-010 and FW-011 marked OOS. **No code, migration, route or data change.** | Documentation agent |
