-- =============================================================================
-- DentalEase — Multi-Doctor Clinic Management Migration
-- Adds: Chair, DoctorAvailability, DoctorSchedule; extends appointments/slots
-- Run once against dentalease_db
-- =============================================================================

BEGIN;

-- ── 1. Enums ──────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE day_of_week AS ENUM (
    'sunday','monday','tuesday','wednesday','thursday','friday','saturday'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE schedule_override_type AS ENUM (
    'working','leave','holiday','emergency'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. chairs ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chairs (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID         NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name         TEXT         NOT NULL,
  chair_number INT          NOT NULL,
  description  TEXT,
  color        TEXT         NOT NULL DEFAULT '#3B82F6',
  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(clinic_id, chair_number)
);

CREATE INDEX IF NOT EXISTS idx_chairs_clinic ON chairs(clinic_id);

-- ── 3. doctor_availabilities ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS doctor_availabilities (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID         NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  dentist_id   UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week  day_of_week  NOT NULL,
  start_time   TEXT         NOT NULL,   -- "HH:MM"
  end_time     TEXT         NOT NULL,
  slot_mins    INT          NOT NULL DEFAULT 30,
  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  valid_from   DATE,
  valid_until  DATE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(clinic_id, dentist_id, day_of_week, start_time)
);

CREATE INDEX IF NOT EXISTS idx_doctor_avail_clinic_dentist
  ON doctor_availabilities(clinic_id, dentist_id);

-- ── 4. doctor_schedules ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS doctor_schedules (
  id          UUID                   PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID                   NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  dentist_id  UUID                   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chair_id    UUID                   REFERENCES chairs(id) ON DELETE SET NULL,
  date        DATE                   NOT NULL,
  type        schedule_override_type NOT NULL DEFAULT 'working',
  start_time  TEXT,
  end_time    TEXT,
  reason      TEXT,
  created_at  TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
  UNIQUE(clinic_id, dentist_id, date)
);

CREATE INDEX IF NOT EXISTS idx_doctor_schedules_clinic_dentist
  ON doctor_schedules(clinic_id, dentist_id);
CREATE INDEX IF NOT EXISTS idx_doctor_schedules_clinic_date
  ON doctor_schedules(clinic_id, date);

-- ── 5. Extend appointment_slots with chair_id ─────────────────────────────────

ALTER TABLE appointment_slots
  ADD COLUMN IF NOT EXISTS chair_id UUID REFERENCES chairs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_apt_slots_clinic_chair_date
  ON appointment_slots(clinic_id, chair_id, slot_date);

-- ── 6. Extend appointments with chair_id ─────────────────────────────────────

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS chair_id UUID REFERENCES chairs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_clinic_chair_date
  ON appointments(clinic_id, chair_id, appointment_date);

-- ── 7. updated_at triggers ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$ DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'chairs', 'doctor_availabilities', 'doctor_schedules'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = 'trg_' || t || '_updated_at'
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER trg_%s_updated_at
         BEFORE UPDATE ON %s
         FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()',
        t, t
      );
    END IF;
  END LOOP;
END $$;

-- ── 8. Seed a default chair for every existing clinic ─────────────────────────

INSERT INTO chairs(clinic_id, name, chair_number, color)
SELECT id, 'Chair 1', 1, '#3B82F6'
FROM clinics
WHERE NOT EXISTS (
  SELECT 1 FROM chairs c WHERE c.clinic_id = clinics.id
);

COMMIT;
