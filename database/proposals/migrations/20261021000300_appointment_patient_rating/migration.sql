-- PROPOSED — NOT APPLIED. Requires owner approval.
-- Purpose: store the 1-5 post-visit rating collected by the WhatsApp follow-up flow
--          (FollowupFlow.handleRating currently only logs it because the column does not exist).
-- Risk:    LOW. Additive, nullable, constrained to 1..5, no backfill. NULL means "not rated".
--          Free-text feedback is intentionally NOT included: it is stored as a WhatsApp message
--          today and its retention/PII handling has not been decided.
-- Privacy: a rating tied to an appointment is patient-linked health-service feedback; restrict it to
--          clinic staff and keep it out of analytics exports that leave the clinic.
-- Matches: schema.prisma  Appointment.patientRating Int? @map("patient_rating") @db.SmallInt

ALTER TABLE "appointments" ADD COLUMN "patient_rating" SMALLINT;
ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_patient_rating_check" CHECK ("patient_rating" IS NULL OR "patient_rating" BETWEEN 1 AND 5);
