-- Rollback for 20261021000200_reminder_status_sent_48h.
-- PostgreSQL cannot DROP an enum value. Safe procedure (run in ONE transaction, in a maintenance window):
--   1. Stop code paths that write 'sent_48h'.
--   2. Map existing rows back, then recreate the type without the value.
-- NOTE: the partial index on reminder_status must be dropped and rebuilt around the type swap.
BEGIN;
ALTER TABLE "appointments" DROP COLUMN IF EXISTS "reminder_48h_at";
UPDATE "appointments" SET "reminder_status" = 'pending' WHERE "reminder_status" = 'sent_48h';

DROP INDEX IF EXISTS idx_appt_reminder;  -- name per database/schema.sql; verify before running

ALTER TYPE "reminder_status" RENAME TO "reminder_status_old";
CREATE TYPE "reminder_status" AS ENUM ('pending', 'sent_24h', 'sent_2h', 'sent_followup', 'suppressed');
ALTER TABLE "appointments" ALTER COLUMN "reminder_status" DROP DEFAULT;
ALTER TABLE "appointments"
  ALTER COLUMN "reminder_status" TYPE "reminder_status" USING "reminder_status"::text::"reminder_status";
ALTER TABLE "appointments" ALTER COLUMN "reminder_status" SET DEFAULT 'pending';
DROP TYPE "reminder_status_old";
-- Recreate the partial index exactly as defined in database/schema.sql (line ~568):
CREATE INDEX IF NOT EXISTS idx_appt_reminder ON appointments(clinic_id, appointment_date) WHERE reminder_status = 'pending' AND status = 'scheduled';
COMMIT;
