-- PROPOSED ONLY — NOT APPLIED. Review, then mirror in database/schema.prisma and apply via your
-- normal migration workflow against a disposable database first. Never run against dentalease_db unreviewed.

-- 1. Invoice payment links (RazorpayService.createPaymentLink currently returns/emits the URL but cannot persist it)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS razorpay_payment_link TEXT;
--   schema.prisma (Invoice):  razorpayPaymentLink String? @map("razorpay_payment_link")

-- 2. Notifications: NO schema change recommended. Staff in-app notifications are stored in `notifications`
--    with channel='push', userId set, readAt for read state (implemented in code). Optional later:
--    CREATE INDEX idx_notifications_user_unread ON notifications (clinic_id, user_id) WHERE read_at IS NULL;

-- 3. Patient emergency contact (API currently rejects the field with 400 instead of dropping it)
ALTER TABLE patients ADD COLUMN IF NOT EXISTS emergency_contact_name  TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT;
--   (DTO would split emergencyContact into name + phone; treat as personal data — encrypt at rest if policy requires)

-- 4. 48-hour reminders (currently stateless 30-minute window; a missed cron run skips the reminder)
ALTER TYPE reminder_status ADD VALUE IF NOT EXISTS 'sent_48h' BEFORE 'sent_24h';
--   NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block on older PostgreSQL.

-- 5. Appointment ratings (currently only logged: appointment id + score, no patient data)
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS patient_rating SMALLINT CHECK (patient_rating BETWEEN 1 AND 5);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS patient_feedback TEXT;
