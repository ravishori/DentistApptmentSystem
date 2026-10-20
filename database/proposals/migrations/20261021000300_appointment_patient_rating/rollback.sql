-- Rollback for 20261021000300_appointment_patient_rating. DESTRUCTIVE: discards collected ratings.
ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "appointments_patient_rating_check";
ALTER TABLE "appointments" DROP COLUMN IF EXISTS "patient_rating";
