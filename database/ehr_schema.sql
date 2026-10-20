-- =============================================================================
-- DentalEase — EHR Schema (Phase 1)
-- Dental Chart · Visits · Diagnoses · Prescriptions
-- Run AFTER schema.sql (requires clinics, patients, users tables)
-- =============================================================================

-- ── Enums ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE tooth_condition AS ENUM (
    'healthy','decayed','filled','missing','crown','implant',
    'root_canal','bridge','fractured','extracted','unerupted',
    'impacted','watch','veneer'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tooth_surface AS ENUM (
    'mesial','distal','buccal','lingual','occlusal','incisal'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Dental Chart ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dental_charts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL UNIQUE REFERENCES patients(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dental_charts_clinic ON dental_charts(clinic_id);

-- ── Teeth ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS teeth (
  id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id         UUID            NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  chart_id          UUID            NOT NULL REFERENCES dental_charts(id) ON DELETE CASCADE,
  fdi_number        SMALLINT        NOT NULL CHECK (fdi_number BETWEEN 11 AND 48),
  condition         tooth_condition NOT NULL DEFAULT 'healthy',
  affected_surfaces tooth_surface[] NOT NULL DEFAULT '{}',
  notes             TEXT,
  history           JSONB[]         NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
  UNIQUE (chart_id, fdi_number)
);

CREATE INDEX IF NOT EXISTS idx_teeth_clinic    ON teeth(clinic_id);
CREATE INDEX IF NOT EXISTS idx_teeth_chart     ON teeth(chart_id);

-- ── Visits ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS visits (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id      UUID        NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  dentist_id      UUID        NOT NULL REFERENCES users(id),
  appointment_id  UUID        UNIQUE REFERENCES appointments(id),
  visit_date      DATE        NOT NULL DEFAULT CURRENT_DATE,
  chief_complaint TEXT,
  clinical_notes  TEXT,
  vital_signs     JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visits_patient  ON visits(clinic_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_visits_date     ON visits(clinic_id, visit_date DESC);

-- ── Diagnoses ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS diagnoses (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  visit_id    UUID        NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  patient_id  UUID        NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  tooth_id    UUID        REFERENCES teeth(id),
  tooth_fdi   SMALLINT,
  icd_code    VARCHAR(20),
  description TEXT        NOT NULL,
  severity    VARCHAR(20),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_diagnoses_visit   ON diagnoses(visit_id);
CREATE INDEX IF NOT EXISTS idx_diagnoses_patient ON diagnoses(clinic_id, patient_id);

-- ── Visit Attachments ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS visit_attachments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  visit_id    UUID        NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  file_name   TEXT        NOT NULL,
  file_url    TEXT        NOT NULL,
  mime_type   VARCHAR(100),
  size_bytes  INT,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attachments_visit ON visit_attachments(visit_id);

-- ── Prescriptions ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS prescriptions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id  UUID        NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  visit_id    UUID        REFERENCES visits(id),
  dentist_id  UUID        NOT NULL REFERENCES users(id),
  template_id UUID,
  notes       TEXT,
  pdf_url     TEXT,
  issued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rx_patient ON prescriptions(clinic_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_rx_issued  ON prescriptions(clinic_id, issued_at DESC);

-- ── Prescription Items ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS prescription_items (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id UUID        NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  medicine_name   TEXT        NOT NULL,
  dosage          TEXT        NOT NULL,
  frequency       TEXT        NOT NULL,
  duration        TEXT        NOT NULL,
  instructions    TEXT,
  quantity        INT,
  sort_order      INT         NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_rx_items ON prescription_items(prescription_id);

-- ── Prescription Templates ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS prescription_templates (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  description TEXT,
  items       JSONB       NOT NULL DEFAULT '[]',
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, name)
);

CREATE INDEX IF NOT EXISTS idx_rx_templates ON prescription_templates(clinic_id);

-- ── Forward-reference FK on prescriptions.template_id ─────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'prescriptions_template_id_fkey'
  ) THEN
    ALTER TABLE prescriptions
      ADD CONSTRAINT prescriptions_template_id_fkey
      FOREIGN KEY (template_id) REFERENCES prescription_templates(id);
  END IF;
END $$;

-- ── updated_at triggers ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['dental_charts','teeth','visits','prescriptions','prescription_templates'] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I;
       CREATE TRIGGER trg_%s_updated_at
         BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();',
      t, t, t, t
    );
  END LOOP;
END $$;

-- ── Seed demo prescription templates ─────────────────────────────────────────

-- Templates are clinic-specific; seeded per clinic via app or individually.
-- Example insert for development (uses first clinic in DB):
-- INSERT INTO prescription_templates (clinic_id, name, description, items)
-- SELECT id, 'Post-RCT', 'After root canal treatment',
--   '[{"medicineName":"Amoxicillin 500mg","dosage":"1 tablet","frequency":"TID","duration":"5 days","instructions":"After meals"},
--     {"medicineName":"Ibuprofen 400mg","dosage":"1 tablet","frequency":"BID","duration":"3 days","instructions":"With food"},
--     {"medicineName":"Metronidazole 400mg","dosage":"1 tablet","frequency":"TID","duration":"5 days","instructions":"After meals"}]'
-- FROM clinics LIMIT 1
-- ON CONFLICT (clinic_id, name) DO NOTHING;

\echo 'EHR schema applied: dental_charts, teeth, visits, diagnoses, visit_attachments, prescriptions, prescription_items, prescription_templates'
