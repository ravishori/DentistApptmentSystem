-- =============================================================================
-- DentalEase — PostgreSQL Schema
-- Multi-tenant SaaS · India-first · WhatsApp-first
-- =============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";      -- fast ILIKE search on names/phones
CREATE EXTENSION IF NOT EXISTS "btree_gin";    -- GIN indexes on scalar columns
CREATE EXTENSION IF NOT EXISTS "pgcrypto";     -- gen_random_uuid(), encrypt()

-- =============================================================================
-- ENUMS
-- =============================================================================

CREATE TYPE plan_tier AS ENUM (
    'starter',      -- 1 dentist, up to 500 patients
    'growth',       -- 5 dentists, up to 3000 patients
    'enterprise'    -- unlimited
);

CREATE TYPE subscription_status AS ENUM (
    'trial',
    'active',
    'past_due',
    'suspended',
    'cancelled'
);

CREATE TYPE user_role AS ENUM (
    'super_admin',      -- DentalEase platform owner
    'clinic_admin',     -- clinic owner / principal dentist
    'dentist',
    'receptionist',
    'assistant'
);

CREATE TYPE gender AS ENUM ('male', 'female', 'other', 'prefer_not_to_say');

CREATE TYPE blood_group AS ENUM (
    'A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-', 'unknown'
);

CREATE TYPE appointment_type AS ENUM (
    'consultation',
    'cleaning',
    'filling',
    'extraction',
    'root_canal',
    'crown',
    'braces',
    'whitening',
    'xray',
    'followup',
    'emergency',
    'other'
);

CREATE TYPE appointment_status AS ENUM (
    'scheduled',
    'confirmed',
    'in_progress',
    'completed',
    'cancelled',
    'no_show',
    'rescheduled'
);

CREATE TYPE reminder_status AS ENUM (
    'pending',
    'sent_24h',
    'sent_2h',
    'sent_followup',
    'suppressed'    -- patient opted out
);

CREATE TYPE treatment_plan_status AS ENUM (
    'draft',
    'presented',
    'accepted',
    'in_progress',
    'completed',
    'cancelled'
);

CREATE TYPE treatment_status AS ENUM (
    'planned',
    'in_progress',
    'completed',
    'cancelled'
);

CREATE TYPE invoice_status AS ENUM (
    'draft',
    'sent',
    'partially_paid',
    'paid',
    'overdue',
    'cancelled',
    'refunded'
);

CREATE TYPE payment_method AS ENUM (
    'razorpay',
    'cash',
    'upi',
    'card',
    'netbanking',
    'insurance',
    'other'
);

CREATE TYPE payment_status AS ENUM (
    'pending',
    'success',
    'failed',
    'refunded'
);

CREATE TYPE message_direction AS ENUM ('inbound', 'outbound');

CREATE TYPE message_type AS ENUM (
    'text',
    'template',
    'interactive',
    'image',
    'document',
    'audio',
    'video',
    'location',
    'sticker'
);

CREATE TYPE message_status AS ENUM (
    'queued',
    'sent',
    'delivered',
    'read',
    'failed'
);

CREATE TYPE conversation_state AS ENUM (
    'idle',
    'booking_flow',
    'reschedule_flow',
    'cancellation_flow',
    'faq_flow',
    'payment_flow',
    'human_takeover'
);

CREATE TYPE notification_channel AS ENUM (
    'whatsapp',
    'email',
    'sms',
    'push'
);

CREATE TYPE notification_type AS ENUM (
    'appointment_confirmation',
    'appointment_reminder_24h',
    'appointment_reminder_2h',
    'appointment_cancelled',
    'appointment_rescheduled',
    'invoice_sent',
    'payment_received',
    'payment_failed',
    'treatment_plan_shared',
    'followup',
    'birthday_wish',
    'recall',
    'custom'
);

CREATE TYPE notification_status AS ENUM (
    'pending',
    'sent',
    'delivered',
    'read',
    'failed',
    'cancelled'
);

CREATE TYPE audit_action AS ENUM (
    'create',
    'update',
    'delete',
    'login',
    'logout',
    'payment',
    'export'
);


-- =============================================================================
-- UTILITY: auto-update updated_at
-- =============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- Macro to attach the trigger to any table
CREATE OR REPLACE PROCEDURE attach_updated_at(tbl TEXT)
LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE format(
        'CREATE TRIGGER trg_%s_updated_at
         BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
        tbl, tbl
    );
END;
$$;


-- =============================================================================
-- PLATFORM LAYER  (no clinic_id — these are global)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- clinics  (tenants)
-- -----------------------------------------------------------------------------
CREATE TABLE clinics (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                TEXT NOT NULL,       -- url-safe: "smile-dental-bandra"
    name                TEXT NOT NULL,
    owner_name          TEXT,
    email               TEXT NOT NULL,
    phone               TEXT,
    address             TEXT,
    city                TEXT,
    state               TEXT,
    pincode             CHAR(6),
    country             CHAR(2) NOT NULL DEFAULT 'IN',
    logo_url            TEXT,
    gst_number          TEXT,
    timezone            TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    currency            CHAR(3) NOT NULL DEFAULT 'INR',

    -- Subscription
    plan                plan_tier NOT NULL DEFAULT 'starter',
    sub_status          subscription_status NOT NULL DEFAULT 'trial',
    trial_ends_at       TIMESTAMPTZ,
    current_period_start TIMESTAMPTZ,
    current_period_end   TIMESTAMPTZ,
    razorpay_customer_id TEXT,
    razorpay_sub_id      TEXT,

    -- WhatsApp
    wa_number           TEXT,               -- clinic's WA Business number
    wa_api_key          TEXT,               -- 360Dialog per-tenant key (encrypted)
    wa_verify_token     TEXT,               -- webhook verification token
    wa_phone_number_id  TEXT,               -- Meta phone number ID

    -- Working hours & slot config (JSONB for flexibility)
    settings JSONB NOT NULL DEFAULT '{
        "workStart":      "09:00",
        "workEnd":        "18:00",
        "slotDuration":   30,
        "breakStart":     "13:00",
        "breakEnd":       "14:00",
        "workDays":       [1,2,3,4,5,6],
        "taxPercent":     18,
        "invoicePrefix":  "INV",
        "patientPrefix":  "PT",
        "reminderChannels": ["whatsapp"]
    }'::jsonb,

    patient_count       INT NOT NULL DEFAULT 0,
    is_active           BOOLEAN NOT NULL DEFAULT true,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT clinics_slug_unique   UNIQUE (slug),
    CONSTRAINT clinics_email_unique  UNIQUE (email)
);
COMMENT ON TABLE clinics IS 'SaaS tenants — one row per dental clinic';
COMMENT ON COLUMN clinics.wa_api_key IS 'Stored encrypted with pgcrypto; decrypt in application layer';

CALL attach_updated_at('clinics');

-- -----------------------------------------------------------------------------
-- clinic_subscriptions  (audit trail of plan changes)
-- -----------------------------------------------------------------------------
CREATE TABLE clinic_subscriptions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    plan            plan_tier NOT NULL,
    status          subscription_status NOT NULL,
    amount_paise    INT NOT NULL DEFAULT 0,  -- in paise (₹ × 100)
    razorpay_sub_id TEXT,
    razorpay_inv_id TEXT,
    period_start    TIMESTAMPTZ NOT NULL,
    period_end      TIMESTAMPTZ NOT NULL,
    cancelled_at    TIMESTAMPTZ,
    cancel_reason   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_clinic_subs_clinic ON clinic_subscriptions(clinic_id);


-- =============================================================================
-- USERS  (staff per clinic)
-- =============================================================================

CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id           UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    full_name           TEXT NOT NULL,
    email               TEXT NOT NULL,
    phone               TEXT,
    password_hash       TEXT NOT NULL,
    role                user_role NOT NULL DEFAULT 'receptionist',

    -- Dentist-specific
    specialization      TEXT,               -- "Orthodontist", "Endodontist"
    registration_number TEXT,               -- Dental Council of India reg#
    qualification       TEXT,               -- "BDS", "MDS"
    bio                 TEXT,
    avatar_url          TEXT,

    -- Auth
    is_active           BOOLEAN NOT NULL DEFAULT true,
    email_verified      BOOLEAN NOT NULL DEFAULT false,
    last_login_at       TIMESTAMPTZ,
    failed_login_count  SMALLINT NOT NULL DEFAULT 0,
    locked_until        TIMESTAMPTZ,
    refresh_token_hash  TEXT,               -- hashed, not plain

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT users_clinic_email_unique UNIQUE (clinic_id, email)
);
COMMENT ON TABLE users IS 'Clinic staff — dentists, receptionists, assistants';

CALL attach_updated_at('users');

CREATE INDEX idx_users_clinic          ON users(clinic_id);
CREATE INDEX idx_users_clinic_role     ON users(clinic_id, role) WHERE is_active = true;
CREATE INDEX idx_users_email           ON users(email);  -- for cross-tenant login lookup

-- Session table (for refresh token rotation)
CREATE TABLE user_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    clinic_id       UUID NOT NULL,
    refresh_token   TEXT NOT NULL UNIQUE,   -- hashed token
    user_agent      TEXT,
    ip_address      INET,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_sessions_user     ON user_sessions(user_id);
CREATE INDEX idx_sessions_expires  ON user_sessions(expires_at) WHERE revoked_at IS NULL;


-- =============================================================================
-- PATIENTS  (CRM)
-- =============================================================================

CREATE TABLE patients (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id           UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,

    -- Identity
    patient_code        TEXT NOT NULL,          -- PT-0001, auto-generated per clinic
    full_name           TEXT NOT NULL,
    phone               TEXT,                   -- primary WhatsApp number
    alt_phone           TEXT,
    email               TEXT,
    date_of_birth       DATE,
    age                 SMALLINT,               -- stored for quick display; recomputed on DOB change
    gender              gender,
    blood_group         blood_group DEFAULT 'unknown',

    -- Address
    address             TEXT,
    city                TEXT,
    state               TEXT,
    pincode             CHAR(6),

    -- Medical
    allergies           TEXT[] NOT NULL DEFAULT '{}',
    medical_conditions  TEXT[] NOT NULL DEFAULT '{}',
    current_medications TEXT[] NOT NULL DEFAULT '{}',
    dental_notes        TEXT,               -- freeform clinical notes

    -- Engagement
    wa_opt_in           BOOLEAN NOT NULL DEFAULT false,
    email_opt_in        BOOLEAN NOT NULL DEFAULT false,
    referred_by         UUID REFERENCES patients(id) ON DELETE SET NULL,
    source              TEXT,               -- 'walkin','online','referral','whatsapp'

    -- Aggregates (updated by triggers / app)
    last_visit_date     DATE,
    total_visits        INT NOT NULL DEFAULT 0,
    outstanding_balance NUMERIC(12,2) NOT NULL DEFAULT 0.00,

    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT patients_clinic_code_unique  UNIQUE (clinic_id, patient_code),
    CONSTRAINT patients_balance_nonneg      CHECK  (outstanding_balance >= 0)
);
COMMENT ON TABLE patients IS 'Patient CRM records — one row per patient per clinic';
COMMENT ON COLUMN patients.age IS 'Denormalized for display speed; authoritative value is date_of_birth';

CALL attach_updated_at('patients');

CREATE INDEX idx_patients_clinic              ON patients(clinic_id);
CREATE INDEX idx_patients_clinic_active       ON patients(clinic_id) WHERE is_active = true;
CREATE INDEX idx_patients_phone               ON patients(clinic_id, phone);
CREATE INDEX idx_patients_last_visit          ON patients(clinic_id, last_visit_date DESC NULLS LAST);
CREATE INDEX idx_patients_outstanding         ON patients(clinic_id, outstanding_balance) WHERE outstanding_balance > 0;
-- Full-text search (GIN trigram) — supports ILIKE on name/phone/email
CREATE INDEX idx_patients_name_trgm   ON patients USING gin(full_name gin_trgm_ops);
CREATE INDEX idx_patients_phone_trgm  ON patients USING gin(phone gin_trgm_ops);

-- Auto-increment patient_code per clinic
CREATE OR REPLACE FUNCTION generate_patient_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_prefix TEXT;
    v_seq    INT;
BEGIN
    SELECT COALESCE((settings->>'patientPrefix'), 'PT')
    INTO v_prefix
    FROM clinics WHERE id = NEW.clinic_id;

    SELECT COUNT(*) + 1
    INTO v_seq
    FROM patients
    WHERE clinic_id = NEW.clinic_id;

    NEW.patient_code := v_prefix || '-' || LPAD(v_seq::TEXT, 4, '0');
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_patients_code
    BEFORE INSERT ON patients
    FOR EACH ROW
    WHEN (NEW.patient_code IS NULL OR NEW.patient_code = '')
    EXECUTE FUNCTION generate_patient_code();


-- =============================================================================
-- FAMILY LINKING
-- Two-table design: a group can span patients who registered separately.
-- family_groups is the "anchor"; every member points to the group.
-- The head is denoted by family_groups.head_patient_id.
-- =============================================================================

CREATE TABLE family_groups (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    group_name      TEXT,                   -- optional: "Sharma Family"
    head_patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_family_groups_clinic ON family_groups(clinic_id);

CREATE TABLE patient_family_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id       UUID NOT NULL,
    group_id        UUID NOT NULL REFERENCES family_groups(id) ON DELETE CASCADE,
    patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    relationship    TEXT NOT NULL,      -- 'self','spouse','child','parent','sibling','other'
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pfm_group_patient_unique UNIQUE (group_id, patient_id)
);
CREATE INDEX idx_pfm_clinic    ON patient_family_members(clinic_id);
CREATE INDEX idx_pfm_patient   ON patient_family_members(patient_id);
CREATE INDEX idx_pfm_group     ON patient_family_members(group_id);


-- =============================================================================
-- APPOINTMENT SLOTS  (availability grid)
-- Generated ahead of time by the API; one row = one bookable block.
-- =============================================================================

CREATE TABLE appointment_slots (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    dentist_id      UUID NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    slot_date       DATE        NOT NULL,
    start_time      TIME        NOT NULL,
    end_time        TIME        NOT NULL,
    is_booked       BOOLEAN     NOT NULL DEFAULT false,
    is_blocked      BOOLEAN     NOT NULL DEFAULT false,
    block_reason    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT slots_no_overlap UNIQUE (clinic_id, dentist_id, slot_date, start_time),
    CONSTRAINT slots_time_order CHECK (end_time > start_time)
);
CREATE INDEX idx_slots_dentist_date ON appointment_slots(clinic_id, dentist_id, slot_date);
CREATE INDEX idx_slots_available    ON appointment_slots(clinic_id, dentist_id, slot_date)
    WHERE is_booked = false AND is_blocked = false;


-- =============================================================================
-- APPOINTMENTS
-- =============================================================================

CREATE TABLE appointments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id           UUID NOT NULL REFERENCES clinics(id)   ON DELETE CASCADE,
    patient_id          UUID NOT NULL REFERENCES patients(id)  ON DELETE CASCADE,
    dentist_id          UUID NOT NULL REFERENCES users(id)     ON DELETE RESTRICT,
    slot_id             UUID REFERENCES appointment_slots(id)  ON DELETE SET NULL,

    -- Schedule
    appointment_date    DATE        NOT NULL,
    start_time          TIME        NOT NULL,
    end_time            TIME        NOT NULL,

    -- Classification
    type                appointment_type   NOT NULL DEFAULT 'consultation',
    status              appointment_status NOT NULL DEFAULT 'scheduled',

    -- Clinical
    chief_complaint     TEXT,
    clinical_notes      TEXT,
    estimated_cost      NUMERIC(10,2),

    -- Booking metadata
    booked_via          TEXT NOT NULL DEFAULT 'web',    -- 'web','whatsapp','phone','walkin'
    booked_by_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,

    -- Reminder tracking
    reminder_status     reminder_status NOT NULL DEFAULT 'pending',
    reminder_24h_at     TIMESTAMPTZ,
    reminder_2h_at      TIMESTAMPTZ,
    followup_sent_at    TIMESTAMPTZ,

    -- Cancellation / reschedule
    cancelled_at        TIMESTAMPTZ,
    cancel_reason       TEXT,
    cancelled_by        UUID REFERENCES users(id) ON DELETE SET NULL,
    rescheduled_from_id UUID REFERENCES appointments(id) ON DELETE SET NULL,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT appt_time_order  CHECK (end_time > start_time),
    CONSTRAINT appt_cost_pos    CHECK (estimated_cost IS NULL OR estimated_cost >= 0)
);
COMMENT ON TABLE appointments IS 'Bookings — one row per patient visit slot';

CALL attach_updated_at('appointments');

CREATE INDEX idx_appt_clinic_date       ON appointments(clinic_id, appointment_date);
CREATE INDEX idx_appt_clinic_patient    ON appointments(clinic_id, patient_id);
CREATE INDEX idx_appt_clinic_dentist    ON appointments(clinic_id, dentist_id, appointment_date);
CREATE INDEX idx_appt_status            ON appointments(clinic_id, status) WHERE status NOT IN ('completed','cancelled');
CREATE INDEX idx_appt_reminder          ON appointments(clinic_id, appointment_date)
    WHERE reminder_status = 'pending' AND status = 'scheduled';


-- =============================================================================
-- PROCEDURES CATALOG  (per clinic — customisable prices)
-- =============================================================================

CREATE TABLE procedures (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    code            TEXT,                   -- ICD-10 / clinic code e.g. "D0120"
    name            TEXT NOT NULL,
    category        TEXT,                   -- "Restorative","Endodontic","Orthodontic"
    description     TEXT,
    default_price   NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    duration_mins   SMALLINT NOT NULL DEFAULT 30,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    sort_order      INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT procedures_price_pos CHECK (default_price >= 0),
    CONSTRAINT procedures_duration_pos CHECK (duration_mins > 0)
);
CALL attach_updated_at('procedures');

CREATE INDEX idx_procedures_clinic    ON procedures(clinic_id) WHERE is_active = true;
CREATE INDEX idx_procedures_category  ON procedures(clinic_id, category);


-- =============================================================================
-- TREATMENT PLANS
-- =============================================================================

CREATE TABLE treatment_plans (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id       UUID NOT NULL REFERENCES clinics(id)  ON DELETE CASCADE,
    patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    dentist_id      UUID NOT NULL REFERENCES users(id)    ON DELETE RESTRICT,

    plan_title      TEXT NOT NULL,
    diagnosis       TEXT,
    notes           TEXT,
    status          treatment_plan_status NOT NULL DEFAULT 'draft',

    total_cost      NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    total_discount  NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    net_cost        NUMERIC(12,2) GENERATED ALWAYS AS (total_cost - total_discount) STORED,

    presented_at    TIMESTAMPTZ,
    accepted_at     TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    cancelled_at    TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE treatment_plans IS 'Treatment plan header — groups multiple procedures for a patient';

CALL attach_updated_at('treatment_plans');

CREATE INDEX idx_tp_clinic         ON treatment_plans(clinic_id);
CREATE INDEX idx_tp_patient        ON treatment_plans(clinic_id, patient_id);
CREATE INDEX idx_tp_status         ON treatment_plans(clinic_id, status);


-- =============================================================================
-- TREATMENT PLAN ITEMS  (line items inside a plan)
-- =============================================================================

CREATE TABLE treatment_plan_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    treatment_plan_id   UUID NOT NULL REFERENCES treatment_plans(id) ON DELETE CASCADE,
    procedure_id        UUID REFERENCES procedures(id) ON DELETE SET NULL,

    description         TEXT NOT NULL,
    tooth_number        TEXT,               -- FDI notation: "11","26","47"
    surfaces            TEXT[] DEFAULT '{}',-- ["M","O","D"] mesial/occlusal/distal
    quantity            SMALLINT NOT NULL DEFAULT 1,
    unit_price          NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    discount_pct        NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    line_total          NUMERIC(10,2) GENERATED ALWAYS AS (
                            quantity * unit_price * (1 - discount_pct / 100)
                        ) STORED,

    status              treatment_status NOT NULL DEFAULT 'planned',
    completed_at        TIMESTAMPTZ,
    completed_appt_id   UUID REFERENCES appointments(id) ON DELETE SET NULL,

    sort_order          INT NOT NULL DEFAULT 0,

    CONSTRAINT tpi_qty_pos      CHECK (quantity > 0),
    CONSTRAINT tpi_price_pos    CHECK (unit_price >= 0),
    CONSTRAINT tpi_disc_range   CHECK (discount_pct BETWEEN 0 AND 100)
);
CREATE INDEX idx_tpi_plan ON treatment_plan_items(treatment_plan_id);
CREATE INDEX idx_tpi_procedure ON treatment_plan_items(procedure_id);


-- =============================================================================
-- TREATMENTS  (delivered / completed — one per appointment + procedure)
-- Records what was actually done, as opposed to what was planned.
-- =============================================================================

CREATE TABLE treatments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id           UUID NOT NULL REFERENCES clinics(id)      ON DELETE CASCADE,
    appointment_id      UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    patient_id          UUID NOT NULL REFERENCES patients(id)     ON DELETE CASCADE,
    dentist_id          UUID NOT NULL REFERENCES users(id)        ON DELETE RESTRICT,
    procedure_id        UUID REFERENCES procedures(id)            ON DELETE SET NULL,
    plan_item_id        UUID REFERENCES treatment_plan_items(id)  ON DELETE SET NULL,

    description         TEXT NOT NULL,
    tooth_number        TEXT,
    surfaces            TEXT[] DEFAULT '{}',
    quantity            SMALLINT NOT NULL DEFAULT 1,
    unit_price          NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    discount_pct        NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    line_total          NUMERIC(10,2) GENERATED ALWAYS AS (
                            quantity * unit_price * (1 - discount_pct / 100)
                        ) STORED,

    clinical_notes      TEXT,
    status              treatment_status NOT NULL DEFAULT 'completed',

    performed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT tr_qty_pos    CHECK (quantity > 0),
    CONSTRAINT tr_price_pos  CHECK (unit_price >= 0),
    CONSTRAINT tr_disc_range CHECK (discount_pct BETWEEN 0 AND 100)
);
COMMENT ON TABLE treatments IS 'Treatments actually delivered — source of truth for invoicing';

CALL attach_updated_at('treatments');

CREATE INDEX idx_treatments_clinic      ON treatments(clinic_id);
CREATE INDEX idx_treatments_patient     ON treatments(clinic_id, patient_id);
CREATE INDEX idx_treatments_appointment ON treatments(appointment_id);


-- =============================================================================
-- INVOICES
-- =============================================================================

CREATE TABLE invoices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id       UUID NOT NULL REFERENCES clinics(id)         ON DELETE CASCADE,
    patient_id      UUID NOT NULL REFERENCES patients(id)        ON DELETE CASCADE,
    appointment_id  UUID REFERENCES appointments(id)             ON DELETE SET NULL,
    created_by_id   UUID REFERENCES users(id)                   ON DELETE SET NULL,

    invoice_number  TEXT NOT NULL,          -- INV-2024-0001 (unique per clinic)
    invoice_date    DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date        DATE,

    status          invoice_status NOT NULL DEFAULT 'draft',

    -- Amounts
    subtotal        NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    discount_pct    NUMERIC(5,2)  NOT NULL DEFAULT 0.00,
    discount_amt    NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    tax_pct         NUMERIC(5,2)  NOT NULL DEFAULT 18.00,   -- GST
    tax_amt         NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    total_amount    NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    paid_amount     NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    balance_amount  NUMERIC(12,2) GENERATED ALWAYS AS (total_amount - paid_amount) STORED,

    notes           TEXT,
    terms           TEXT,

    -- Razorpay
    razorpay_order_id TEXT,
    payment_link      TEXT,
    pdf_url           TEXT,

    sent_at         TIMESTAMPTZ,
    paid_at         TIMESTAMPTZ,
    overdue_at      TIMESTAMPTZ,
    cancelled_at    TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT inv_clinic_number_unique UNIQUE (clinic_id, invoice_number),
    CONSTRAINT inv_subtotal_pos         CHECK (subtotal >= 0),
    CONSTRAINT inv_paid_range           CHECK (paid_amount >= 0 AND paid_amount <= total_amount),
    CONSTRAINT inv_disc_range           CHECK (discount_pct BETWEEN 0 AND 100),
    CONSTRAINT inv_tax_range            CHECK (tax_pct BETWEEN 0 AND 100)
);
COMMENT ON TABLE invoices IS 'Billing headers — one per billing event; may cover multiple treatments';

CALL attach_updated_at('invoices');

CREATE INDEX idx_inv_clinic         ON invoices(clinic_id);
CREATE INDEX idx_inv_patient        ON invoices(clinic_id, patient_id);
CREATE INDEX idx_inv_status         ON invoices(clinic_id, status);
CREATE INDEX idx_inv_due_date       ON invoices(clinic_id, due_date) WHERE status NOT IN ('paid','cancelled');
CREATE INDEX idx_inv_outstanding    ON invoices(clinic_id) WHERE balance_amount > 0;

-- Auto-generate invoice number per clinic
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_prefix TEXT;
    v_year   TEXT;
    v_seq    INT;
BEGIN
    SELECT COALESCE((settings->>'invoicePrefix'), 'INV')
    INTO v_prefix
    FROM clinics WHERE id = NEW.clinic_id;

    v_year := TO_CHAR(NOW(), 'YYYY');

    SELECT COUNT(*) + 1
    INTO v_seq
    FROM invoices
    WHERE clinic_id = NEW.clinic_id
      AND EXTRACT(YEAR FROM invoice_date) = EXTRACT(YEAR FROM NOW());

    NEW.invoice_number := v_prefix || '-' || v_year || '-' || LPAD(v_seq::TEXT, 4, '0');
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_invoices_number
    BEFORE INSERT ON invoices
    FOR EACH ROW
    WHEN (NEW.invoice_number IS NULL OR NEW.invoice_number = '')
    EXECUTE FUNCTION generate_invoice_number();


-- =============================================================================
-- INVOICE ITEMS
-- =============================================================================

CREATE TABLE invoice_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id      UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    treatment_id    UUID REFERENCES treatments(id)        ON DELETE SET NULL,
    procedure_id    UUID REFERENCES procedures(id)        ON DELETE SET NULL,

    description     TEXT NOT NULL,
    tooth_number    TEXT,
    quantity        SMALLINT NOT NULL DEFAULT 1,
    unit_price      NUMERIC(10,2) NOT NULL,
    discount_pct    NUMERIC(5,2)  NOT NULL DEFAULT 0.00,
    tax_pct         NUMERIC(5,2)  NOT NULL DEFAULT 0.00,
    line_total      NUMERIC(10,2) GENERATED ALWAYS AS (
                        ROUND(quantity * unit_price * (1 - discount_pct / 100), 2)
                    ) STORED,

    sort_order      INT NOT NULL DEFAULT 0,

    CONSTRAINT ii_qty_pos    CHECK (quantity > 0),
    CONSTRAINT ii_price_pos  CHECK (unit_price >= 0),
    CONSTRAINT ii_disc_range CHECK (discount_pct BETWEEN 0 AND 100)
);
CREATE INDEX idx_ii_invoice   ON invoice_items(invoice_id);
CREATE INDEX idx_ii_treatment ON invoice_items(treatment_id);


-- =============================================================================
-- PAYMENTS
-- =============================================================================

CREATE TABLE payments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id           UUID NOT NULL REFERENCES clinics(id)  ON DELETE CASCADE,
    invoice_id          UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    recorded_by_id      UUID REFERENCES users(id)             ON DELETE SET NULL,

    amount              NUMERIC(12,2) NOT NULL,
    method              payment_method NOT NULL,
    status              payment_status NOT NULL DEFAULT 'pending',

    -- Razorpay fields
    razorpay_order_id   TEXT,
    razorpay_payment_id TEXT UNIQUE,
    razorpay_signature  TEXT,

    -- Generic
    transaction_ref     TEXT,
    gateway_response    JSONB,

    notes               TEXT,
    paid_at             TIMESTAMPTZ,
    refunded_at         TIMESTAMPTZ,
    refund_reason       TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pay_amount_nonzero CHECK (amount <> 0)
);
COMMENT ON TABLE payments IS 'Individual payment transactions against an invoice';

CALL attach_updated_at('payments');

CREATE INDEX idx_pay_clinic    ON payments(clinic_id);
CREATE INDEX idx_pay_invoice   ON payments(invoice_id);
CREATE INDEX idx_pay_status    ON payments(clinic_id, status);
CREATE INDEX idx_pay_rzp       ON payments(razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL;

-- Keep invoice.paid_amount in sync
CREATE OR REPLACE FUNCTION sync_invoice_paid()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_paid NUMERIC(12,2);
BEGIN
    SELECT COALESCE(SUM(amount), 0)
    INTO v_paid
    FROM payments
    WHERE invoice_id = COALESCE(NEW.invoice_id, OLD.invoice_id)
      AND status = 'success';

    UPDATE invoices
    SET    paid_amount = v_paid,
           status = CASE
               WHEN v_paid <= 0             THEN 'sent'
               WHEN v_paid < total_amount   THEN 'partially_paid'
               ELSE                              'paid'
           END,
           paid_at = CASE WHEN v_paid >= total_amount THEN NOW() ELSE NULL END
    WHERE  id = COALESCE(NEW.invoice_id, OLD.invoice_id);

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payments_sync_invoice
    AFTER INSERT OR UPDATE OF status ON payments
    FOR EACH ROW EXECUTE FUNCTION sync_invoice_paid();


-- =============================================================================
-- WHATSAPP CONVERSATIONS
-- One row per (clinic, patient_phone) pair — session / state machine.
-- =============================================================================

CREATE TABLE whatsapp_conversations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id       UUID NOT NULL REFERENCES clinics(id)  ON DELETE CASCADE,
    patient_id      UUID REFERENCES patients(id)          ON DELETE SET NULL,
    patient_phone   TEXT NOT NULL,

    state           conversation_state NOT NULL DEFAULT 'idle',
    context         JSONB,                  -- flow step data (chosen date, dentist, etc.)

    last_message_at     TIMESTAMPTZ,
    is_human_takeover   BOOLEAN NOT NULL DEFAULT false,
    assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    snoozed_until       TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT conv_clinic_phone_unique UNIQUE (clinic_id, patient_phone)
);

CALL attach_updated_at('whatsapp_conversations');

CREATE INDEX idx_conv_clinic       ON whatsapp_conversations(clinic_id);
CREATE INDEX idx_conv_patient      ON whatsapp_conversations(patient_id);
CREATE INDEX idx_conv_last_msg     ON whatsapp_conversations(clinic_id, last_message_at DESC NULLS LAST);
CREATE INDEX idx_conv_takeover     ON whatsapp_conversations(clinic_id)
    WHERE is_human_takeover = true;


-- =============================================================================
-- WHATSAPP MESSAGES
-- =============================================================================

CREATE TABLE whatsapp_messages (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id           UUID NOT NULL REFERENCES clinics(id)              ON DELETE CASCADE,
    conversation_id     UUID NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,

    direction           message_direction NOT NULL,
    type                message_type NOT NULL DEFAULT 'text',
    content             TEXT NOT NULL,

    -- Template fields (outbound only)
    template_name       TEXT,
    template_params     JSONB,
    template_language   CHAR(5) DEFAULT 'en',

    -- Media
    media_url           TEXT,
    media_mime_type     TEXT,
    media_size_bytes    INT,

    -- External tracking
    external_id         TEXT UNIQUE,        -- 360Dialog / Twilio message SID / WAMID

    status              message_status NOT NULL DEFAULT 'queued',
    failure_reason      TEXT,
    delivered_at        TIMESTAMPTZ,
    read_at             TIMESTAMPTZ,

    -- Sender (for inbound: null; for outbound staff reply)
    sent_by_user_id     UUID REFERENCES users(id) ON DELETE SET NULL,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE whatsapp_messages IS 'Full message log — inbound and outbound';

CREATE INDEX idx_wamsg_conversation ON whatsapp_messages(conversation_id);
CREATE INDEX idx_wamsg_clinic_date  ON whatsapp_messages(clinic_id, created_at DESC);
CREATE INDEX idx_wamsg_status       ON whatsapp_messages(clinic_id, status) WHERE status IN ('queued','failed');
CREATE INDEX idx_wamsg_external     ON whatsapp_messages(external_id) WHERE external_id IS NOT NULL;


-- =============================================================================
-- NOTIFICATION TEMPLATES  (per clinic, multi-channel)
-- =============================================================================

CREATE TABLE notification_templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,

    name            TEXT NOT NULL,          -- internal slug: 'appointment_reminder_24h'
    display_name    TEXT NOT NULL,
    type            notification_type NOT NULL,
    channel         notification_channel NOT NULL,

    subject         TEXT,                   -- email subject
    body            TEXT NOT NULL,          -- template with {{variable}} placeholders
    param_keys      TEXT[] NOT NULL DEFAULT '{}',
    language        CHAR(5) NOT NULL DEFAULT 'en',

    -- WhatsApp-specific
    wa_template_name TEXT,                  -- Meta-approved template name
    wa_approved      BOOLEAN NOT NULL DEFAULT false,
    wa_category      TEXT,                  -- UTILITY | MARKETING | AUTHENTICATION

    is_active        BOOLEAN NOT NULL DEFAULT true,
    is_system        BOOLEAN NOT NULL DEFAULT false,  -- system default, cannot delete

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT ntpl_clinic_name_channel_unique UNIQUE (clinic_id, name, channel)
);

CALL attach_updated_at('notification_templates');

CREATE INDEX idx_ntpl_clinic ON notification_templates(clinic_id) WHERE is_active = true;
CREATE INDEX idx_ntpl_type   ON notification_templates(clinic_id, type, channel);


-- =============================================================================
-- NOTIFICATIONS  (delivery log — one row per send attempt)
-- =============================================================================

CREATE TABLE notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id       UUID NOT NULL REFERENCES clinics(id)  ON DELETE CASCADE,
    template_id     UUID REFERENCES notification_templates(id) ON DELETE SET NULL,

    -- Target
    patient_id      UUID REFERENCES patients(id)          ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id)              ON DELETE CASCADE,  -- if sending to staff
    recipient_phone TEXT,
    recipient_email TEXT,

    -- Content
    channel         notification_channel NOT NULL,
    type            notification_type    NOT NULL,
    subject         TEXT,
    body            TEXT NOT NULL,
    params          JSONB,                  -- variables used when rendering template

    -- Linked entities
    appointment_id  UUID REFERENCES appointments(id)      ON DELETE SET NULL,
    invoice_id      UUID REFERENCES invoices(id)          ON DELETE SET NULL,

    -- Delivery tracking
    status          notification_status NOT NULL DEFAULT 'pending',
    external_id     TEXT,                   -- WA WAMID / SES message ID
    failure_reason  TEXT,
    retry_count     SMALLINT NOT NULL DEFAULT 0,
    next_retry_at   TIMESTAMPTZ,

    scheduled_at    TIMESTAMPTZ,            -- NULL = send immediately
    sent_at         TIMESTAMPTZ,
    delivered_at    TIMESTAMPTZ,
    read_at         TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT notif_one_recipient CHECK (
        patient_id IS NOT NULL OR user_id IS NOT NULL
    )
);
COMMENT ON TABLE notifications IS 'Outbound notification delivery log across all channels';

CALL attach_updated_at('notifications');

CREATE INDEX idx_notif_clinic       ON notifications(clinic_id);
CREATE INDEX idx_notif_patient      ON notifications(patient_id);
CREATE INDEX idx_notif_appointment  ON notifications(appointment_id);
CREATE INDEX idx_notif_status       ON notifications(clinic_id, status)  WHERE status IN ('pending','failed');
CREATE INDEX idx_notif_retry        ON notifications(next_retry_at)      WHERE status = 'failed' AND retry_count < 3;
CREATE INDEX idx_notif_scheduled    ON notifications(scheduled_at)       WHERE status = 'pending' AND scheduled_at IS NOT NULL;


-- =============================================================================
-- AUDIT LOG  (immutable — no UPDATE/DELETE allowed)
-- =============================================================================

CREATE TABLE audit_logs (
    id              BIGSERIAL PRIMARY KEY,
    clinic_id       UUID,                   -- NULL for platform-level actions
    user_id         UUID,                   -- actor
    action          audit_action NOT NULL,
    entity_type     TEXT NOT NULL,          -- 'appointment','invoice','patient', etc.
    entity_id       UUID,
    old_data        JSONB,
    new_data        JSONB,
    ip_address      INET,
    user_agent      TEXT,
    meta            JSONB,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE audit_logs IS 'Immutable audit trail — no rows are ever updated or deleted';

CREATE INDEX idx_audit_clinic      ON audit_logs(clinic_id, occurred_at DESC);
CREATE INDEX idx_audit_entity      ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_user        ON audit_logs(user_id, occurred_at DESC);

-- Prevent modifications
CREATE RULE audit_no_update AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
CREATE RULE audit_no_delete AS ON DELETE TO audit_logs DO INSTEAD NOTHING;


-- =============================================================================
-- ROW LEVEL SECURITY  (optional — production hardening)
-- Uncomment and configure when connection pooling is per-tenant.
-- =============================================================================

-- ALTER TABLE patients           ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE appointments       ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE invoices           ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE payments           ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE whatsapp_messages  ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE notifications      ENABLE ROW LEVEL SECURITY;
--
-- CREATE POLICY clinic_isolation ON patients
--     USING (clinic_id = current_setting('app.clinic_id')::uuid);
-- (Repeat for each table)
--
-- Usage: SET LOCAL app.clinic_id = '<uuid>';


-- =============================================================================
-- SEED — system notification templates (all clinics inherit these)
-- =============================================================================

-- (Templates are inserted per-clinic on onboarding by application seed script)
-- See: apps/api/src/database/seeds/notification-templates.seed.ts
