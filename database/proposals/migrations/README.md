# Proposed migrations — NOT APPLIED

Status: prepared for owner review. Nothing here has been run against `dentalease_db` or any shared database.

| # | Folder | Change | Risk | Needs code change after |
|---|---|---|---|---|
| 1 | `20261021000100_invoice_payment_link` | `invoices.razorpay_payment_link TEXT NULL` | Low | Re-add the `razorpayPaymentLink: link.short_url` write in `RazorpayService.createPaymentLink` |
| 2 | `20261021000200_reminder_status_sent_48h` | `reminder_status` += `'sent_48h'` **and** `appointments.reminder_48h_at` (claim lease for the 48h step) | Low–Medium (enum; apply alone, then deploy) | Add a `'48h'` step to `reminder-claim.ts` (from `pending`, col `reminder_48h_at`, to `sent_48h`); add `sent_48h` to the `24h` step's `from` list; replace the stateless window in `ReminderFlow.dispatch48h` |
| 3 | `20261021000300_appointment_patient_rating` | `appointments.patient_rating SMALLINT NULL CHECK 1..5` | Low | `FollowupFlow.handleRating` persists the rating instead of only logging it |

**Not prepared (needs your decision):** emergency contact on `patients`. Open questions: one free-text field vs
name + phone, whether it must be encrypted at rest (it is third-party personal data), and who may read it.
Until decided, the API returns 400 if `emergencyContact` is sent rather than silently discarding it.

## How these were checked
* `prisma migrate diff` between the current `schema.prisma` and a patched copy generates the same three DDL
  statements (the CHECK constraint is not expressible in Prisma and is the only intentional extra).
* On a **disposable copy database** (since dropped): forward migrations in order, then `rollback.sql` in reverse
  order — columns, enum labels and the `'pending'` default were verified after each direction; the CHECK
  constraint accepted 5 and NULL and rejected 6.

## Applying (after approval)
1. Back up first (`pg_dump`). Apply in a maintenance window, in numeric order, each file on its own.
2. Edit `database/schema.prisma` exactly as below, run `npm run db:generate`, then deploy the matching code.
3. The project currently has **no `prisma/migrations` history** (it uses `db push` / `schema.sql`). These are plain
   SQL files — apply with `psql`. Do **not** run `prisma migrate deploy` against an existing database without
   first creating a baseline (`prisma migrate resolve --applied`), or Prisma will try to recreate every table.
4. Mirror each change in `database/schema.sql` so fresh installs match.

```prisma
model Invoice     { razorpayPaymentLink String? @map("razorpay_payment_link") }
enum ReminderStatus { pending  sent_48h  sent_24h  sent_2h  sent_followup  suppressed }
model Appointment { patientRating Int? @map("patient_rating") @db.SmallInt
                    reminder48hAt DateTime? @map("reminder_48h_at") }
```

## Data-loss, locking and rollback review (nothing applied)

| # | Forward | Rollback (`rollback.sql`) | Data lost on rollback | Locking / downtime |
|---|---|---|---|---|
| 1 `invoice_payment_link` | `ADD COLUMN … TEXT NULL` — metadata-only, instant, no rewrite | `DROP COLUMN` | Stored payment-link URLs. Recoverable: the link id is already in `invoices.razorpay_order_id`, so the URL can be re-fetched from Razorpay. | Brief ACCESS EXCLUSIVE lock; use `SET lock_timeout='3s'` |
| 2 `reminder_status_sent_48h` | `ADD VALUE` (instant) + `ADD COLUMN reminder_48h_at` (instant) | Remap `sent_48h`→`pending`, drop the column, **recreate the enum and rewrite `appointments.reminder_status`** | `reminder_48h_at` timestamps and the fact that a 48h reminder was sent. Remapped rows become eligible for the 24h reminder again (correct for the patient, but a patient who already got the 48h one gets one more message). | Forward: negligible. **Rollback: `ALTER COLUMN TYPE` rewrites the whole table under ACCESS EXCLUSIVE** — maintenance window on a large table. Also drops/recreates `idx_appt_reminder`. |
| 3 `appointment_patient_rating` | `ADD COLUMN` + `CHECK (… BETWEEN 1 AND 5 OR NULL)` — instant (no existing values to validate) | Drop constraint, drop column | Every collected rating (patient-linked feedback). Export first if you need it: `COPY (SELECT id, patient_rating FROM appointments WHERE patient_rating IS NOT NULL) TO …`. | Brief lock |

**Deployment order:** back up → (staging copy first) → #1 → #3 → #2 (alone, committed before any code that writes `sent_48h`) →
edit `schema.prisma` → `prisma generate` → deploy code. Roll back in reverse order, code first.

**Pre-flight checks:** `SELECT count(*) FROM appointments WHERE reminder_status::text='sent_48h'` must be 0 before any rollback of #2;
confirm `database/schema.sql` partial index name (`idx_appt_reminder`) matches production (`\d appointments`);
`database/schema.sql` types its timestamps `TIMESTAMPTZ` while a `prisma db push` database uses `timestamp(3)` — an existing drift,
unrelated to these migrations; check which one production uses before applying (the new columns are `TIMESTAMPTZ`/`SMALLINT`/`TEXT`).

## Backup requirements (mandatory before applying anything)
1. **Logical dump, custom format, taken immediately before the change** (a plain `psql` login must work first —
   see `../POSTGRES_HARDENING_PLAN.md` §5 for the current credential problem):
   ```powershell
   $stamp = Get-Date -Format yyyyMMdd-HHmmss
   & 'D:\Program Files\PostgreSQL\18\bin\pg_dump.exe' -h localhost -p 5432 -U <admin-role> -Fc -f "D:\backups\dentalease_db-$stamp.dump" dentalease_db
   & 'D:\Program Files\PostgreSQL\18\bin\pg_restore.exe' --list "D:\backups\dentalease_db-$stamp.dump" | Select-Object -First 5   # must list the schema, not error
   ```
2. **Restore rehearsal**: restore that dump into a *different, empty* database and run the migrations there first. The whole
   dump → restore → apply → verify → roll back sequence was rehearsed on a disposable database for this review (37 tables
   restored, all three migrations applied, columns/enum/check verified, rollback returned the schema to its original shape).
3. **Store the dump off the same disk** (C: and D: both have <10 GB free right now — check free space is at least 2× the dump).
4. Keep the dump until at least one full business day after the change; for migration #2's rollback keep it until #2's code
   has been in production without incident.
5. Rolling back a *code* deployment does not undo the migrations (and they are additive/nullable, so old code keeps working
   against the new schema) — **roll back the schema only if needed, and code first**.
