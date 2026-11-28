# DentalEase — Database Remediation Plan

| | |
|---|---|
| Document ID | DENTALEASE-DRP-v1.0 |
| Report date | 2026-11-23 |
| Companion | `DATABASE_GAP_ASSESSMENT.md` (same folder) |
| Status | **Plan only. No implementation authorised.** Each entry awaits owner approval before execution. |

Priority key:
- **P0** — blocks production launch, has to land before cutover.
- **P1** — ships before general availability; defensible to launch without it only with a signed-off risk acceptance.
- **P2** — quality or hardening, scheduled but not launch-blocking.
- **P3** — cleanup or deferred.

---

## R-01 (P0) — Build a Prisma migrations baseline

| Field | Value |
|---|---|
| Current implementation | No `prisma/migrations/` directory. Schema is maintained via `prisma db push` and five hand-maintained SQL files. Three proposals under `database/proposals/migrations/`. |
| Gap | No forward-only history, no `_prisma_migrations` table, no rollback discipline. `prisma migrate deploy` on the live DB would fail P3005. |
| Recommended fix | (1) Freeze the current Prisma schema as `prisma/migrations/00000000000000_init/migration.sql` built by `prisma migrate diff --from-empty --to-schema-datamodel`. (2) Run `prisma migrate resolve --applied 00000000000000_init` against a disposable clone of `dentalease_db` to seed `_prisma_migrations` without re-executing DDL. (3) Convert the three approved proposals into real migration folders. |
| Dependencies | R-02 (addon-script consolidation) so the init migration is complete; owner approval for the three proposals. |
| Migration required? | **Yes**, but the baseline is non-destructive (resolve, not apply). |
| How tested | On a disposable DB: `prisma migrate deploy` returns "No pending migrations"; `SELECT COUNT(*) FROM _prisma_migrations` ≥ 1; a dry-run `prisma migrate dev --create-only` on a trivial additive change yields a clean diff against the baseline. |

## R-02 (P0) — Consolidate `setup.sql` to run every DDL file in the right order

| Field | Value |
|---|---|
| Current implementation | `database/setup.sql` runs `schema.sql`, `stored_procedures.sql`, `seeds.sql` only. Addon files (`billing_upgrade.sql`, `multi_doctor.sql`, `ehr_schema.sql`, `documents_schema.sql`) are not referenced. A fresh DB built via `setup.sql` is missing 16 of 37 tables. |
| Gap | The owner's rehearsal succeeded only because the operator ran the addon files manually. No file states the correct order. `documents_schema.sql` depends on `ehr_schema.sql.visits` (FK). |
| Recommended fix | Rewrite `setup.sql` to run, in this exact order: `schema.sql` → `billing_upgrade.sql` → `multi_doctor.sql` → `ehr_schema.sql` → `documents_schema.sql` → `stored_procedures.sql` → `seeds.sql`. Add a header comment stating why documents follow EHR. |
| Dependencies | None. |
| Migration required? | No (it's a bootstrap-script fix, not a schema change). |
| How tested | On a fresh disposable DB: `psql -f database/setup.sql`; assert `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' = 37`; run `prisma validate` against the resulting DB. |

## R-03 (P0) — Decide the canonical column-type path (TIME vs text, TIMESTAMPTZ vs timestamp(3)) and align both the SQL file and `prisma db push`

| Field | Value |
|---|---|
| Current implementation | `schema.sql` uses `TIME` for `start_time` / `end_time` and `TIMESTAMPTZ` for timestamps; `prisma db push` produces `text` and `timestamp(3)` because the Prisma types are `String` and `DateTime` without the `@db.*` annotations. |
| Gap | Two canonical states exist. If the live DB came from `schema.sql`, Prisma's `timestamp(3)` migrations will diff spuriously. If from `db push`, `schema.sql` is stale and misleading. |
| Recommended fix | Owner-chosen path. The safer choice is **native PostgreSQL types**: annotate Prisma fields with `@db.Time`, `@db.Timestamptz(6)` where appropriate; otherwise, rewrite the SQL file to match the `db push` output. Either way, `schema.sql` and `schema.prisma` must agree. |
| Dependencies | R-01 (so the alignment lands as a tracked migration, not a silent rewrite). |
| Migration required? | **Yes** — type `ALTER COLUMN` statements. For a populated table the ALTER is in-place for `TIME ↔ text` (text accepts both), potentially rewriting for `timestamp ↔ timestamptz`. |
| How tested | On a disposable DB populated with seed data: before/after diff via `pg_dump --schema-only` shows only the targeted columns changed; existing integration specs (`reminder-dedupe.int.spec.ts`, `m7-concurrency.int.spec.ts`) still pass. |

## R-04 (P0) — Decide the disposition of the proposed migrations

| Field | Value |
|---|---|
| Current implementation | Three proposals exist unapproved: `20261021000100_invoice_payment_link`, `20261021000200_reminder_status_sent_48h`, `20261021000300_appointment_patient_rating`. |
| Gap | Each blocks a dependent feature (payment link URL persistence → F4; 48h reminder step → I4; appointment rating → post-visit review). `20261021000100_invoice_payment_link` additionally requires a matching Prisma field (`razorpayPaymentLink String? @map("razorpay_payment_link")`) which is not currently declared. |
| Recommended fix | Owner approves each proposal individually. For each, update `schema.prisma` first, generate the matching Prisma migration under `prisma/migrations/` (R-01 dependency), apply to disposable, run tests, then stage. |
| Dependencies | R-01. For payment link: also update the Prisma schema. |
| Migration required? | **Yes**, one per proposal. |
| How tested | On disposable DB: each migration applies cleanly, rollback runs cleanly, affected integration spec passes (e.g. a new `payment-link-persistence.int.spec.ts`, `reminder-48h.int.spec.ts`, `appointment-rating.int.spec.ts`). |

## R-05 (P0) — Add dentist-approval booking columns (BR-SCP-003 Rev 1.1)

| Field | Value |
|---|---|
| Current implementation | `appointments` table has `status` but no `approvedByUserId`, `approvedAt`, `pendingApprovalExpiresAt`, no `created_via` (receptionist vs WhatsApp self-booking) explicitly. |
| Gap | Decision Record A5, C16–C18 requires every booking — including WhatsApp self-bookings — to remain provisional until a dentist approves. Not yet modeled. PAC-SEC-011/012 BLOCKED. |
| Recommended fix | New migration adding `approved_by_user_id UUID NULL REFERENCES users(id)`, `approved_at TIMESTAMPTZ NULL`, `pending_approval_expires_at TIMESTAMPTZ NULL`, `created_via appointment_source_enum NOT NULL DEFAULT 'receptionist'` (new enum). Backfill existing rows with `approved_at = created_at` and `approved_by_user_id = <system user>` or NULL (owner decision). |
| Dependencies | R-01. Owner decision on expiry value (BR-OPEN-014) and backfill rule. |
| Migration required? | **Yes.** |
| How tested | Application-level HTTP test: receptionist-created booking stays provisional until dentist calls `POST /appointments/:id/approve`; expiry cron moves provisional → expired after the configured timeout. |

## R-06 (P0) — Add `TreatmentSession` (BR-SCP-003a / BR-OPEN-012)

| Field | Value |
|---|---|
| Current implementation | Clinical capture currently lives across `appointments`, `visits`, `treatment_plans`, `treatment_plan_items`. There is no artefact that anchors an invoice to "the work actually performed in one visit". |
| Gap | Decision Record B8–B9: TreatmentSession is a distinct billing anchor (no session ⇒ no invoice); one plan procedure MAY be completed across multiple sessions. |
| Recommended fix | Two documented options for owner to pick between: **(a)** new `treatment_sessions` table with `appointment_id`, `dentist_id`, `completed_at`, `plan_item_ids UUID[]`; or **(b)** extend `appointments` with `session_completed_at`, `session_plan_item_ids UUID[]`. Add FK `invoices.session_id NULL` (nullable during migration window) and enforce non-null after backfill. |
| Dependencies | R-01; R-05 (so approval + session fit together); owner schema decision (BR-OPEN-012). |
| Migration required? | **Yes.** |
| How tested | Integration spec: creating an invoice without a session returns 400; completing a plan item across two sessions produces two invoices each tied to its own session. |

## R-07 (P1) — Add `receipts` as a separate entity (BR-SCP-007 B13)

| Field | Value |
|---|---|
| Current implementation | Payments are modeled; receipts are implicit (a "payment row" is treated as proof of payment). Invoice/payment/refund are separate, receipt is not. |
| Gap | Decision Record B13: each successful payment emits its own receipt. A split-tender invoice therefore emits multiple receipts. Needed for compliance and audit (PAC-SEC-016). |
| Recommended fix | New `receipts` table `(id, payment_id, clinic_id, receipt_number, issued_at, pdf_url)` with unique `(clinic_id, receipt_number)`; `payments.receipt_id NULL` back-reference or inverse FK. Introduce `nextReceiptNumber(clinicId)` application helper. |
| Dependencies | R-01. |
| Migration required? | **Yes.** |
| How tested | HTTP + integration test: split-payment invoice of ₹600 settled with ₹400 UPI + ₹200 cash produces two receipt rows, each with a distinct `receipt_number`. |

## R-08 (P1) — Add discount-cap configuration and approver metadata (BR-SCP-007 B14)

| Field | Value |
|---|---|
| Current implementation | `invoices.discount` column accepts any amount; no cap configuration on clinics; no approver metadata. |
| Gap | Decision Record B14, BR-OPEN-013: configurable `%` cap + fixed-INR cap; above-cap discounts need an approver recorded on the invoice. |
| Recommended fix | Extend `clinics.settings` JSON with `discountCapPercent`, `discountCapFixedInr`, `discountApprovalRequired`. Add `invoices.discount_approved_by_user_id UUID NULL`, `invoices.discount_approval_reason TEXT NULL`. |
| Dependencies | R-01; BR-OPEN-013 numeric defaults. |
| Migration required? | **Yes**, non-destructive. |
| How tested | DTO + service test: below-cap discount applies without approval; above-cap discount without `discount_approved_by_user_id` → 403. |

## R-09 (P1) — Add refund-approval metadata (BR-SCP-007 B11)

| Field | Value |
|---|---|
| Current implementation | Refunds surface as `payments.status = 'refunded'`; `razorpay-webhook.service.ts` sets it on `refund.processed`. No application-triggered refund route or dentist-approval column. |
| Gap | Decision Record B11: receptionist executes refunds only after dentist approves (PAC-SEC-013). |
| Recommended fix | Either (a) add `refunds` table `(id, payment_id, clinic_id, amount, approved_by_dentist_id, approved_at, executed_by_user_id, executed_at, reason, razorpay_refund_id)` — recommended, matches BR-SCP-007a's "separate records" policy, or (b) extend `payments` with `refund_approved_by_dentist_id`, `refund_approved_at`. |
| Dependencies | R-01; application route to initiate refund. |
| Migration required? | **Yes.** |
| How tested | HTTP test: receptionist calling the execute endpoint without an approving dentist returns 403; with approval, refund row created and Razorpay sandbox call succeeds (PAC-PRV-001). |

## R-10 (P1) — Add clinic-level GST toggle (BR-SCP-011 B12)

| Field | Value |
|---|---|
| Current implementation | GST is per-invoice (`invoices.tax_percent` default 18). No clinic-level switch; a clinic cannot opt out of GST globally. |
| Gap | Decision Record B12: GST OFF is the default; clinic admin enables and supplies a GST number (PAC-SEC-015). |
| Recommended fix | Add `clinics.gst_enabled BOOLEAN NOT NULL DEFAULT FALSE`, `clinics.gst_number VARCHAR(15) NULL` (format check), `clinics.gst_default_percent NUMERIC(5,2) DEFAULT 18.00`. Service writes `tax_percent = 0` when `gst_enabled = false`. |
| Dependencies | R-01. |
| Migration required? | **Yes.** |
| How tested | Integration spec: a clinic with `gst_enabled = false` produces invoices with `tax_percent = 0` and is excluded from the GST report; a clinic with `gst_enabled = true` defaults to 18%. |

## R-11 (P1) — Add the application tenant guard (`$extends`) before enabling RLS (BR-SCP-010)

| Field | Value |
|---|---|
| Current implementation | Tenant isolation is 100% service-layer. RLS is commented out. `$queryRaw` call sites are not allow-listed. |
| Gap | A single missing `where clinicId` leaks tenants (PFSR B2). SESSION_CHECKPOINT §5 proposes `$extends` application tenant guard as the P0-2 interim. |
| Recommended fix | Implement `PrismaClient().$extends` with an `$allOperations` hook that injects / validates `clinicId` on every tenant-scoped model; add `TENANT_CONTEXT_MISMATCH` error for `data.clinicId` violations; narrow `where` automatically. Not a schema change; **no migration required**. |
| Dependencies | None schema-side; application change tracked separately. |
| Migration required? | No. |
| How tested | New `tenant-guard.int.spec.ts`: cross-clinic SELECT returns 0 rows; cross-clinic UPDATE rejected. |

## R-12 (P1) — Address orphan materialised views

| Field | Value |
|---|---|
| Current implementation | `mv_clinic_monthly_revenue` and `mv_appointment_weekly` are created by `stored_procedures.sql`, refreshed by `seeds.sql`. No application code consumes them. |
| Gap | They occupy storage + refresh time with no reader. Analytics code reads live tables. |
| Recommended fix | Owner chooses: (a) wire the analytics service to use them (saves query time but introduces staleness windows), or (b) drop them and remove refresh calls from `seeds.sql`. Prefer (b) in v1.0 since the analytics load is modest. |
| Dependencies | None. |
| Migration required? | Yes if dropping (DROP MATERIALIZED VIEW). |
| How tested | No application-visible change; after drop, `seeds.sql` no longer fails. |

## R-13 (P1) — Document and enforce addon-script order; or fold addons into `schema.sql`

| Field | Value |
|---|---|
| Current implementation | Correct order is EHR before Documents, but nothing in the repo states this. `setup.sql` doesn't even include the addon files (R-02). |
| Gap | A new operator can get it wrong and will see opaque FK errors. |
| Recommended fix | After R-02 lands, either (a) keep the five files but add a top-of-file ordering comment, or (b) fold the addons into `schema.sql` so there is one DDL file. Prefer (b) once R-01 is in place — the init migration becomes the source of truth and the SQL files become historical. |
| Dependencies | R-01, R-02. |
| Migration required? | No schema change; file reorganisation only. |
| How tested | Fresh DB bootstrap from `setup.sql` succeeds without manual steps. |

## R-14 (P1) — Reconcile `ReminderFlow.sent_48h` with the Prisma enum (BR-OPEN-010)

| Field | Value |
|---|---|
| Current implementation | Code references a `sent_48h` reminder state; the Prisma `ReminderStatus` enum has no such label. |
| Gap | Any code path that persists `sent_48h` will fail at the enum boundary. |
| Recommended fix | Apply proposed migration `20261021000200_reminder_status_sent_48h` (adds enum label) and regenerate the Prisma client. Dependent on R-01 and R-04. |
| Dependencies | R-01, R-04. |
| Migration required? | **Yes**, covered by the existing proposal. |
| How tested | `reminder-dedupe.int.spec.ts` extended with a 48h claim scenario. |

## R-15 (P2) — Row-level security on tenant-scoped tables, after R-11 is stable

| Field | Value |
|---|---|
| Current implementation | RLS commented out. |
| Gap | Defence-in-depth against application bugs that bypass the `$extends` guard. |
| Recommended fix | After R-11 is proven in staging for ≥ 30 days, enable RLS on `patients`, `appointments`, `invoices`, `payments`, `whatsapp_messages`, `notifications` using `current_setting('app.clinic_id')::uuid`, with separate DB roles for API (`FORCE ROW LEVEL SECURITY` off for `migrator`; on for `api_user`). |
| Dependencies | R-11; R-16 (role separation). |
| Migration required? | **Yes**, policy DDL + ALTER TABLE. |
| How tested | Cross-tenant integration specs that previously relied on service-layer checks now pass even when the service forgets a `where`. |

## R-16 (P2) — Separate `migrator` and `api_user` DB roles

| Field | Value |
|---|---|
| Current implementation | Single DB role used for both DDL and DML. |
| Gap | Any application compromise can drop schema. |
| Recommended fix | Create `migrator` role owning the schema; `api_user` role with only the `SELECT, INSERT, UPDATE, DELETE` grants on tables; `prisma migrate deploy` runs as `migrator` from CI/ops, API runs as `api_user`. Documented in `database/proposals/POSTGRES_HARDENING_PLAN.md`. |
| Dependencies | Owner approves the hardening plan; R-01 (migrations). |
| Migration required? | DDL / grant changes; non-destructive. |
| How tested | On disposable DB: `api_user` cannot `DROP TABLE`; `prisma migrate deploy` as `api_user` fails, as `migrator` succeeds. |

## R-17 (P2) — Decide the final disposition of unmounted modules and OOS code

| Field | Value |
|---|---|
| Current implementation | `insurance_claims` + treatment packages tables + unmounted `treatments`/`tenants`/`users` controllers still ship. |
| Gap | PAC-SEC-017: OOS code must carry an owner-recorded disposition (feature-flag OFF or documented deprecation). |
| Recommended fix | Owner decision per module: delete, or mount with a feature flag + guards + tests. If delete, generate a migration to drop the tables and remove Prisma models in the same change. |
| Dependencies | Owner decision. |
| Migration required? | Only if deleting tables. |
| How tested | API route inventory shows the modules either missing (404) or correctly guarded. |

## R-18 (P2) — Backup + restore drill on `dentalease_db` (PAC-LG-007, N3, N4)

| Field | Value |
|---|---|
| Current implementation | No backup job; no restore ever verified. |
| Gap | Launch gate blocked. No RTO/RPO. |
| Recommended fix | Configure `pg_dump` + WAL archiving (managed PG) or equivalent; execute a restore drill into a disposable instance; document RTO/RPO. |
| Dependencies | Owner provisions the backup target; R-16 helps separate dump role. |
| Migration required? | No schema change. |
| How tested | Restore drill report. |

## R-19 (P3) — Tighten FK ON DELETE semantics

| Field | Value |
|---|---|
| Current implementation | FKs use PostgreSQL defaults (NO ACTION) in most addon tables. |
| Gap | Patient delete / clinic delete would fail noisily and leak foreign-key errors to the API. Clinical records should probably CASCADE from Visit to VisitAttachment; audit logs should RESTRICT. |
| Recommended fix | Owner-approved per-FK review. Document the policy in `database/ER_DIAGRAM.md`. |
| Dependencies | R-01. |
| Migration required? | Yes for each FK whose semantic changes. |
| How tested | Integration spec: deleting a clinic with active appointments raises a controlled application error, not a 500. |

---

## Implementation sequence (suggested; owner to confirm)

Phase A — foundation (P0, blocks everything downstream):
1. **R-02** (consolidate `setup.sql`) — fastest, zero-risk fix with highest operational payoff.
2. **R-01** (Prisma migrations baseline) — enables every subsequent change to be tracked.
3. **R-03** (canonical column types) — must land as part of or before the first real migration.
4. **R-04** (approve and land the three existing proposals) — unblocks F4, I4, patient rating.

Phase B — Rev 1.1 scope (P0 features):
5. **R-05** (dentist-approval columns) + application gate.
6. **R-06** (TreatmentSession schema decision + migration).
7. **R-07** (receipts entity) + **R-09** (refunds entity) + **R-08** (discount caps) + **R-10** (GST toggle).

Phase C — isolation and hardening (P1):
8. **R-11** (application tenant guard via `$extends`).
9. **R-14** (ReminderFlow enum reconciliation).
10. **R-13** (addon-script consolidation into `schema.sql` or ordering docs).
11. **R-12** (materialised view disposition).
12. **R-18** (backup + restore drill).

Phase D — defence in depth and cleanup (P2–P3):
13. **R-16** (role separation) → **R-15** (RLS).
14. **R-17** (OOS code disposition).
15. **R-19** (FK ON DELETE policy).

Nothing in this document is authorised to execute. Each item is a proposal awaiting owner approval, and R-03, R-05, R-06, R-10, R-15, R-19 require additional decisions already tracked under BR-OPEN-* and the Owner Decision Record.
