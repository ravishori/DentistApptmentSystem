-- PROPOSED — NOT APPLIED. Requires owner approval.
-- Purpose: give the 48-hour WhatsApp reminder a persisted state (pending -> sent_48h -> sent_24h -> ...).
--          Today ReminderFlow.dispatch48h uses a stateless 30-minute window, so a missed cron run
--          silently skips the reminder. With this value it can be made idempotent AND catch up safely.
-- Risk:    LOW-MEDIUM.
--   * Additive enum value; existing rows and the partial index in schema.sql
--     (WHERE reminder_status = 'pending') are unaffected.
--   * PostgreSQL: ALTER TYPE ... ADD VALUE cannot be used in the SAME transaction that first uses the
--     new value. Apply this migration on its own, THEN deploy code that writes 'sent_48h'.
--   * Prisma: the generated client must be regenerated (`prisma generate`) before the code change.
--   * Enum values cannot be removed later without recreating the type (see rollback.sql).
--   * ALSO adds appointments.reminder_48h_at (nullable TIMESTAMPTZ, like reminder_24h_at in schema.sql).
--     The duplicate-safe reminder protocol (src/modules/appointments/reminder-claim.ts) uses each step's
--     timestamp column as its lease; the 48h step has none, so the enum value alone is NOT enough.
-- Matches: schema.prisma  Appointment.reminder48hAt DateTime? @map("reminder_48h_at")
--          schema.prisma  enum ReminderStatus { pending sent_48h sent_24h sent_2h sent_followup suppressed }

ALTER TYPE "reminder_status" ADD VALUE IF NOT EXISTS 'sent_48h' BEFORE 'sent_24h';

ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "reminder_48h_at" TIMESTAMPTZ;
