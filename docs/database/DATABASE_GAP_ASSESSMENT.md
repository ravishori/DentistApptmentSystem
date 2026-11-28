# DentalEase — Database Gap Assessment

| | |
|---|---|
| Document ID | DENTALEASE-DGA-v1.0 |
| Report date | 2026-11-23 |
| Mode | READ-ONLY inspection |
| Repository baseline | `security/remediation-sprint-01` @ `761c87e` (merge of PR #1; working branch `fix/reject-insurance-manual-payment`) |
| Evidence files | `database/schema.prisma`, `database/schema.sql`, `database/billing_upgrade.sql`, `database/multi_doctor.sql`, `database/ehr_schema.sql`, `database/documents_schema.sql`, `database/setup.sql`, `database/seeds.sql`, `database/stored_procedures.sql`, `database/proposals/migrations/*`, `apps/api/src/modules/billing/razorpay/razorpay.service.ts` |
| Diagnostic scripts shipped | `docs/database/diagnostics/{01_schema_inventory,02_tenant_integrity,03_migration_drift}.sql` |
| Live DB access | **NOT available in this session.** The owner's previous rehearsal on disposable `dentalease_test_rehearsal` reported "37 public tables, 28 public enum types" (noted in SESSION_CHECKPOINT) — carried forward as context; not independently re-verified. |

---

## 1. Actual database baseline (from the authoritative files)

| Artefact | Count | Evidence |
|---|---:|---|
| Prisma `model` declarations in `database/schema.prisma` | **37** | `grep -c "^model " database/schema.prisma` |
| Prisma `enum` declarations | **28** | `grep -c "^enum " database/schema.prisma` |
| SQL `CREATE TABLE` statements across the five DDL files | **37** | `schema.sql` 21 + `billing_upgrade.sql` 4 + `multi_doctor.sql` 3 + `ehr_schema.sql` 8 + `documents_schema.sql` 1 |
| FK references to `clinics(id)` in `database/schema.sql` | **15** | `grep -cE "clinic_id.*REFERENCES|REFERENCES clinics" database/schema.sql` |
| `clinicId` fields declared in `schema.prisma` | **32** | `grep -cE "clinicId\s+String" database/schema.prisma` |
| Materialised views defined in `stored_procedures.sql` | **2** (`mv_clinic_monthly_revenue`, `mv_appointment_weekly`) | lines 884, 908 |
| App references to those materialised views | **0** | `grep -rniE "mv_clinic\|mv_appointment\|refresh_monthly_revenue\|refresh_appointment_weekly" apps/` returned nothing |
| Proposed migrations under `database/proposals/migrations/` | **3** | directories `20261021000100_invoice_payment_link`, `20261021000200_reminder_status_sent_48h`, `20261021000300_appointment_patient_rating` |
| `prisma/migrations/` directory at repo root | **ABSENT** | not present in the repository |

### 1.1 "38 live tables vs 37 Prisma models" — verdict

**Not verified in this session; most likely stale.** The authoritative file set defines exactly 37 tables, matched 1:1 by 37 Prisma models. Prisma's `db push` workflow (which this project uses) does **not** create `_prisma_migrations`; so the 38th live table — if a prior rehearsal observed one — would have to come from (a) an addon script that silently created an extra table, (b) a prior `prisma migrate` attempt that left `_prisma_migrations` behind, or (c) a legacy helper table from the original `dentalease_db`. Diagnostic script `01_schema_inventory.sql` §1a and `03_migration_drift.sql` §3a resolve this when run against a live DB.

## 2. Schema completeness vs Rev 1.1 scope

Mapped against the DentalEase v1.0 Rev 1.1 scope in `docs/project/BRD_DentalEase_v1.0.md` and the Owner Decision Record.

| Rev 1.1 requirement | Schema coverage | Verdict |
|---|---|---|
| BR-SCP-002 — multi-dentist chairs, doctor availability, schedule overrides | `chairs`, `doctor_availabilities`, `doctor_schedules` (multi_doctor.sql) with `clinic_id` FK | **Present** |
| BR-SCP-003 — appointment lifecycle | `appointment_slots`, `appointments`, status enum | **Present** |
| BR-SCP-003 (new, Decision Record A5, C16–C18) — **dentist-approval gate on every booking** (`approvedByUserId`, `approvedAt`, pending-approval timeout) | `grep -nE "approvedBy\|approvedAt\|pendingApproval" database/schema.prisma database/*.sql` → not found | **ABSENT** |
| BR-SCP-003a (Decision Record B8–B9) — **TreatmentSession** as a distinct artefact anchoring an invoice | no `TreatmentSession` model / `treatment_sessions` table | **ABSENT** (BR-OPEN-012: schema decision pending) |
| BR-SCP-004 — WhatsApp: `whatsapp_conversations`, `whatsapp_messages`, consent | present | **Present** |
| BR-SCP-005 — patients + family linking + consent | `patients`, `family_groups`, `patient_family_members`, `whatsapp_opt_in` flag on `patients` | **Present** |
| BR-SCP-006 — EHR (dental_charts, teeth, visits, diagnoses, visit_attachments), prescriptions (+ templates), procedures, treatment plans | 8 tables in `ehr_schema.sql` + 3 billing tables in `schema.sql` | **Present** |
| BR-SCP-007 — billing core: invoices, invoice_items, payments | present | **Present** |
| BR-SCP-007 (new, Decision Record B10) — **split payments** (N payment rows per invoice, each a separate record) | `payments.invoice_id` FK allows it, but no `payment_group_id` or ordering field; `invoices.status` transitions depend on application logic | **Structurally supported, policy not expressed in schema** |
| BR-SCP-007 (new, Decision Record B13) — **separate receipt per successful payment** | no `receipts` table | **ABSENT** |
| BR-SCP-007 (new, Decision Record B14) — **configurable percentage + fixed-INR discount cap with approver metadata** | invoice has `discount` column but no cap config on `clinics.settings` or approval-trail fields | **ABSENT** |
| BR-SCP-007 (new, Decision Record B11) — **dentist-approved refunds** | no `refund_approval_by` field; `payments.status` enum carries `refunded` but no approval audit column | **ABSENT** |
| BR-SCP-007a — invoice/payment/receipt/refund as separate records | invoice and payment are separate; receipt/refund are not modeled as independent entities | **Partially absent** (receipt not modeled; refund folded into `payments.status`) |
| BR-SCP-011 — **clinic-level GST toggle** | `invoices.tax_percent` (per invoice) + no `clinics.gst_enabled` or `clinics.gst_number` columns | **ABSENT** at clinic level |
| BR-OOS-004 — insurance (out of scope) | `insurance_claims` table exists in `billing_upgrade.sql`; still in Prisma | present but out-of-scope — disposition pending (PAC-SEC-017) |
| BR-OOS-005 — treatment packages (out of scope) | `treatment_packages`, `treatment_package_items`, `package_enrollments` exist | present but out-of-scope — disposition pending |
| BR-OOS-006 — Assistant role deferred | `UserRole` enum still carries `assistant` | enum unchanged (BR-OPEN-011) |

## 3. Prisma / PostgreSQL consistency

### 3.1 Known data-type divergence — PostgreSQL `TIME` vs Prisma `String`

**Verified from files.**

| Field | `database/schema.sql` | `database/schema.prisma` |
|---|---|---|
| `appointment_slots.start_time` / `end_time` | `TIME NOT NULL` (lines 497–498) | `String @map("start_time")`, `String @map("end_time")` with comment `// stored as "HH:MM:SS"` (lines 552–553) |
| `doctor_schedules.start_time` / `end_time` | `TIME NOT NULL` (lines 525–526) | `String` (lines 1324–1325) |
| `doctor_availabilities.start_time` / `end_time` | `TIME NOT NULL` (addon) | `String?` (lines 1349–1350) |
| `stored_procedures.sql` local vars | `TIME` (lines 42–43) | n/a |

**Impact.** If the DB was initialised via `psql database/schema.sql`, columns are `time without time zone` and PostgreSQL will coerce `'HH:MM:SS'` text into `TIME` on insert. If the DB was initialised via `prisma db push`, Prisma rewrote those columns as `text`. Either path yields a working app (string in, string out), but the two paths are **not byte-identical** and schema snapshots will not match.

### 3.2 `TIMESTAMPTZ` vs `timestamp(3)` drift

**Verified from files.** `database/schema.sql` declares `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`, etc. Prisma's `DateTime` field default maps to `timestamp(3) without time zone` on `db push`. PFSR §4 N1 already records this drift: "Drift between `schema.sql` (`TIMESTAMPTZ`) and `db push` (`timestamp(3)`) noted".

**Impact.** Two canonical-schema states exist and the choice determines time-zone handling at query time. The repository has not approved either.

### 3.3 `paymentLink` vs `payment_link` — verdict

**Not a current mismatch.** Verified from files:

- `schema.prisma` line 779: `paymentLink String? @map("payment_link")`.
- `schema.sql` line 743 (`payments` table, not `invoices`): `payment_link TEXT`.
- `razorpay.service.ts` line 145 writes `paymentLink: link.short_url`.

The three artefacts agree. The earlier phrasing of this finding likely referred to the proposed migration `20261021000100_invoice_payment_link`, which introduces a **second, different** column `invoices.razorpay_payment_link` matching `Invoice.razorpayPaymentLink` — but `razorpayPaymentLink` **is not declared** in the current `schema.prisma` (verified by `grep`). Applying that migration today would create an unreferenced column.

### 3.4 Absence of `_prisma_migrations`

**Verified at file level.** No `prisma/migrations/` directory exists in the repository. The project operates via `prisma db push` (Prisma schema → DB) plus manual SQL application of the five DDL files and the three proposals. This is called out in BR-CST-002 and PFSR §1 as a **BLOCKED** gate for production (PAC-LG-006). The live DB cannot carry `_prisma_migrations` unless a prior operator ran `prisma migrate` by hand.

## 4. Relationship and constraint gaps

Verified from the SQL and Prisma files:

1. **`setup.sql` is incomplete.** `database/setup.sql` runs `schema.sql`, `stored_procedures.sql`, `seeds.sql` only. It does **not** run `billing_upgrade.sql`, `multi_doctor.sql`, `ehr_schema.sql`, or `documents_schema.sql`. A fresh DB built via `setup.sql` will be missing 16 of 37 tables (packages + insurance + chairs + doctor availability + EHR + documents). This is a severe gap for anyone bootstrapping a fresh environment.

2. **Addon script order is undocumented.** `documents_schema.sql` creates `documents` with a FK on `visits(id)` (from `ehr_schema.sql`); therefore EHR must run before Documents. No file states this requirement. The rehearsal carried the correct order; a new operator can get it wrong.

3. **`_prisma_migrations` absent — no baseline.** Any schema change applied by hand will succeed silently; `prisma migrate deploy` on a non-empty DB fails with P3005 ("baseline not set").

4. **Row-Level Security is commented out.** `database/schema.sql` lines 1108–1119 provide commented-out `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` blocks. No RLS is active. Isolation is 100% application-layer (service queries filter by `clinicId` from the verified JWT). Verified in PFSR B2 (`NOT IMPLEMENTED`).

5. **FK coverage on `clinic_id` is partial.** `schema.sql` has 15 FK references to `clinics(id)` but 32 `clinicId` fields in Prisma. Some will be covered by composite FKs (e.g. `(clinic_id, patient_id) → patients(clinic_id, id)`); some tables from addon SQL files are not re-counted in the base. Diagnostic script `02_tenant_integrity.sql` §2c resolves this per live DB.

6. **Materialised views are orphaned.** `mv_clinic_monthly_revenue` and `mv_appointment_weekly` are refreshed by `seeds.sql` but no application code reads them (verified by `grep -r` on `apps/`). They cost disk + refresh time with no consumer.

7. **`AutomationService` references `sent_48h` reminder state that does not exist in the `ReminderStatus` enum** — tracked as BR-OPEN-010; the proposed migration `20261021000200_reminder_status_sent_48h` would add it but has not been approved.

## 5. Tenant-isolation findings

1. **No database-layer tenant boundary.** RLS is defined but commented out; a single DB role is used (`DATABASE_URL`). Any application bug that forgets a `where clinicId` clause leaks cross-tenant data.

2. **32 Prisma models carry `clinicId`.** Application services filter by `clinicId` from the verified JWT (`tenant.decorator.ts`, `tenant-isolation.guard.ts`). PFSR B1 records that cross-tenant tests exist for **appointments, consent, start-booking** but **not for invoices / payments / EHR / documents / prescriptions / clinic-management / notifications** — meaning an untested leak surface for 7 modules.

3. **No `clinic_isolation` policy on `patients`, `appointments`, `invoices`, `payments`, `whatsapp_messages`, `notifications`.** Commented blocks name these exact tables but no `CREATE POLICY` has been executed.

4. **Owner-approved interim is `$extends` application tenant guard, not RLS** (per SESSION_CHECKPOINT §5, labelled P0-2). This is the defensible interim boundary; DB-level RLS is deferred until the DB credential + role separation (N4) is closed.

## 6. Migration status

| Dimension | State |
|---|---|
| `prisma/migrations/` at repo root | **Absent** |
| `_prisma_migrations` in the DB | **Unknown in this session** (diagnostic script §3a resolves it) |
| Proposed migrations | **3 unapproved, unapplied** under `database/proposals/migrations/` (per SESSION_CHECKPOINT §3 and PFSR §6) |
| Baseline dump of `dentalease_db` | **Absent** |
| Backup / restore drill | **Never executed** (PFSR N3, N4 — BLOCKED) |
| `prisma migrate deploy` on the real DB | Would fail P3005 without a baseline |
| Change control on the five DDL files | None — files are edited directly, no checksum / history |

## 7. Evidence register (what this assessment is based on)

| Finding | Evidence source |
|---|---|
| 37 Prisma models | `grep -c "^model " database/schema.prisma` → 37 |
| 28 Prisma enums | `grep -c "^enum " database/schema.prisma` → 28 |
| 37 CREATE TABLE statements across 5 files | `grep -ciE "^CREATE TABLE" database/{schema,billing_upgrade,multi_doctor,ehr_schema,documents_schema}.sql` → 21+4+3+8+1 |
| TIME vs String | `database/schema.sql` lines 497, 498, 525, 526; `database/schema.prisma` lines 552, 553, 582, 583, 1324, 1325, 1349, 1350 |
| payment_link alignment | `database/schema.prisma` line 779; `database/schema.sql` line 743; `apps/api/src/modules/billing/razorpay/razorpay.service.ts` line 145 |
| `razorpay_payment_link` not declared in Prisma | `grep -nE "razorpayPaymentLink" database/schema.prisma` returns nothing |
| No `prisma/migrations/` | directory listing of repo root; see also BR-CST-002 in BRD |
| Proposed migrations list | directory listing of `database/proposals/migrations/` |
| MVs defined but unused | `database/stored_procedures.sql` lines 884, 908, 901, 924; `grep -r` on `apps/` returned no consumers |
| 3 providers verified only against mocks | PFSR rows F2, F3, J1, J2 |
| Setup.sql omits addon scripts | `cat database/setup.sql` — only `\i` for schema, stored_procedures, seeds |
| RLS commented out | `database/schema.sql` lines 1108–1119 |
| Rev 1.1 scope gaps | `docs/project/BRD_DentalEase_v1.0.md` BR-SCP-003/003a/007/007a/011 vs schema file greps (all negative for `approvedBy*`, `treatment_sessions`, `receipts`, `gst_enabled`) |

## 8. Unverified assumptions (require live-DB execution)

- The actual table count in any specific live DB (test, staging, prod). Only diagnostic script §1a can confirm.
- Whether `_prisma_migrations` is present in `dentalease_db` or `dentalease_test_rehearsal`. Script §3a.
- Which initialisation path the live DB took (`psql schema.sql` vs `prisma db push`). Script §3b / §3c reveal it by data type.
- Whether the live DB has orphan rows that violate the clinic-FK invariant. Script §2g.
- Whether the three proposed migration columns (`razorpay_payment_link`, `ReminderStatus.sent_48h`, `appointments.patient_rating`) have been applied by hand already. Script §3d, §3e.

## 9. Scope of this assessment

Read-only inspection of files. No source code modified. No database contacted. No migration created or executed. No branches switched. No commits.
