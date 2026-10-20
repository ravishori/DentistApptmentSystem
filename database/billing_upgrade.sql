-- =============================================================================
-- DentalEase — Billing Upgrade Migration
-- Adds: package billing, GST breakdown, insurance claims, manual payments
-- Run once against dentalease_db
-- =============================================================================

BEGIN;

-- ── 1. Extend invoices ────────────────────────────────────────────────────────

-- Convert balance_amount from generated column to stored column if needed
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'balance_amount'
    AND is_generated = 'ALWAYS'
  ) THEN
    DROP MATERIALIZED VIEW IF EXISTS mv_clinic_monthly_revenue;
    ALTER TABLE invoices DROP COLUMN balance_amount;
    ALTER TABLE invoices ADD COLUMN balance_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00;
    UPDATE invoices SET balance_amount = GREATEST(0, total_amount - paid_amount);
    -- Recreate the materialized view
    CREATE MATERIALIZED VIEW mv_clinic_monthly_revenue AS
      SELECT clinic_id,
             (date_trunc('month', invoice_date::timestamptz))::date AS month,
             count(DISTINCT id) AS invoice_count,
             sum(total_amount) AS gross_revenue,
             sum(paid_amount) AS paid_amount,
             sum(balance_amount) AS outstanding,
             count(DISTINCT patient_id) AS unique_patients
      FROM invoices i
      WHERE status <> 'cancelled'::invoice_status
      GROUP BY clinic_id, (date_trunc('month', invoice_date::timestamptz))::date;
  END IF;
END $$;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS balance_amount         NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS cgst                   NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS sgst                   NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS igst                   NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS package_enrollment_id  UUID,
  ADD COLUMN IF NOT EXISTS insurance_claim_id     UUID;

-- Back-fill balance_amount for existing non-generated rows
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'balance_amount'
    AND is_generated = 'ALWAYS'
  ) THEN
    UPDATE invoices SET balance_amount = GREATEST(0, total_amount - paid_amount) WHERE balance_amount = 0;
  END IF;
END $$;

-- ── 2. Extend invoice_items ───────────────────────────────────────────────────

-- Convert line_total from generated column to stored column if needed
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoice_items' AND column_name = 'line_total'
    AND is_generated = 'ALWAYS'
  ) THEN
    ALTER TABLE invoice_items DROP COLUMN line_total;
    ALTER TABLE invoice_items ADD COLUMN line_total NUMERIC(12,2) NOT NULL DEFAULT 0.00;
    UPDATE invoice_items SET line_total = ROUND(quantity * unit_price * (1 - discount_pct / 100), 2);
  END IF;
END $$;

ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS line_total NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS hsn        CHAR(8),
  ADD COLUMN IF NOT EXISTS gst_rate   NUMERIC(5,2)  NOT NULL DEFAULT 0.00;

-- Back-fill line_total for non-generated rows that are zero
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoice_items' AND column_name = 'line_total'
    AND is_generated = 'ALWAYS'
  ) THEN
    UPDATE invoice_items
    SET line_total = ROUND(quantity * unit_price * (1 - discount_pct / 100), 2)
    WHERE line_total = 0;
  END IF;
END $$;

-- ── 3. Extend payments ────────────────────────────────────────────────────────

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES patients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payments_clinic_patient
  ON payments(clinic_id, patient_id);

-- Back-fill patient_id from invoice
UPDATE payments p
SET patient_id = i.patient_id
FROM invoices i
WHERE p.invoice_id = i.id AND p.patient_id IS NULL;

-- ── 4. Package enums ──────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE package_status AS ENUM (
    'active', 'completed', 'cancelled', 'suspended'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE insurance_claim_status AS ENUM (
    'draft', 'submitted', 'under_review',
    'approved', 'partially_approved', 'rejected', 'settled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 5. treatment_packages ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS treatment_packages (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID         NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name         TEXT         NOT NULL,
  description  TEXT,
  total_visits INT          NOT NULL DEFAULT 1,
  total_price  NUMERIC(12,2) NOT NULL,
  tax_percent  NUMERIC(5,2) NOT NULL DEFAULT 18.00,
  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(clinic_id, name)
);

CREATE INDEX IF NOT EXISTS idx_treatment_packages_clinic
  ON treatment_packages(clinic_id);

-- ── 6. treatment_package_items ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS treatment_package_items (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id  UUID         NOT NULL REFERENCES treatment_packages(id) ON DELETE CASCADE,
  description TEXT         NOT NULL,
  quantity    INT          NOT NULL DEFAULT 1,
  unit_price  NUMERIC(10,2) NOT NULL,
  sort_order  INT          NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_treatment_package_items_pkg
  ON treatment_package_items(package_id);

-- ── 7. package_enrollments ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS package_enrollments (
  id                UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id         UUID           NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id        UUID           NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  package_id        UUID           NOT NULL REFERENCES treatment_packages(id),
  status            package_status NOT NULL DEFAULT 'active',
  visits_total      INT            NOT NULL,
  visits_completed  INT            NOT NULL DEFAULT 0,
  total_amount      NUMERIC(12,2)  NOT NULL,
  paid_amount       NUMERIC(12,2)  NOT NULL DEFAULT 0.00,
  installments      JSONB          NOT NULL DEFAULT '[]',
  start_date        DATE,
  end_date          DATE,
  notes             TEXT,
  created_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_package_enrollments_clinic
  ON package_enrollments(clinic_id);
CREATE INDEX IF NOT EXISTS idx_package_enrollments_patient
  ON package_enrollments(clinic_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_package_enrollments_status
  ON package_enrollments(clinic_id, status);

-- Now safe to add the FK on invoices → package_enrollments
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_invoices_package_enrollment'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT fk_invoices_package_enrollment
        FOREIGN KEY (package_enrollment_id) REFERENCES package_enrollments(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── 8. insurance_claims ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS insurance_claims (
  id                 UUID                   PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id          UUID                   NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  invoice_id         UUID                   NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  patient_id         UUID                   NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  status             insurance_claim_status NOT NULL DEFAULT 'draft',
  insurer_name       TEXT                   NOT NULL,
  policy_number      TEXT,
  membership_id      TEXT,
  claim_number       TEXT,
  claim_amount       NUMERIC(12,2)          NOT NULL,
  approved_amount    NUMERIC(12,2),
  reimbursed_amount  NUMERIC(12,2),
  submitted_at       TIMESTAMPTZ,
  settled_at         TIMESTAMPTZ,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_insurance_claims_clinic
  ON insurance_claims(clinic_id);
CREATE INDEX IF NOT EXISTS idx_insurance_claims_patient
  ON insurance_claims(clinic_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_insurance_claims_status
  ON insurance_claims(clinic_id, status);

-- Add FK from invoices.insurance_claim_id to insurance_claims
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_invoices_insurance_claim'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT fk_invoices_insurance_claim
        FOREIGN KEY (insurance_claim_id) REFERENCES insurance_claims(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── 9. updated_at triggers ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$ DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'treatment_packages', 'package_enrollments', 'insurance_claims'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = 'trg_' || t || '_updated_at'
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

COMMIT;
