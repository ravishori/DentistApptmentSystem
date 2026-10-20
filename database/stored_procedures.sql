-- =============================================================================
-- DentalEase — Stored Procedures & Functions
-- PostgreSQL 16+
-- Covers: Complex Transactions · Reports · Bulk Ops · Performance
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 1 — COMPLEX TRANSACTIONS
-- ─────────────────────────────────────────────────────────────────────────────

-- -----------------------------------------------------------------------------
-- 1a. book_appointment_atomic
--
-- Atomically:
--   1. Locks the slot row (FOR UPDATE SKIP LOCKED) to prevent double-booking
--   2. Creates the appointment
--   3. Marks the slot as booked
--   4. Updates patient.last_visit_date / total_visits
--   5. Inserts an audit log entry
--   6. Schedules 24h and 2h reminder timestamps
--
-- Returns the new appointment id.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION book_appointment_atomic(
    p_clinic_id         UUID,
    p_patient_id        UUID,
    p_dentist_id        UUID,
    p_slot_id           UUID,
    p_type              appointment_type DEFAULT 'consultation',
    p_chief_complaint   TEXT            DEFAULT NULL,
    p_booked_via        TEXT            DEFAULT 'web',
    p_booked_by_user_id UUID            DEFAULT NULL,
    p_estimated_cost    NUMERIC(10,2)   DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_slot          RECORD;
    v_appt_id       UUID;
    v_appt_date     DATE;
    v_start_time    TIME;
    v_end_time      TIME;
    v_remind_24h    TIMESTAMPTZ;
    v_remind_2h     TIMESTAMPTZ;
BEGIN
    -- Step 1: Lock slot and verify it is still free
    SELECT slot_date, start_time, end_time, is_booked, is_blocked, clinic_id, dentist_id
    INTO   v_slot
    FROM   appointment_slots
    WHERE  id = p_slot_id
      AND  clinic_id = p_clinic_id
    FOR    UPDATE SKIP LOCKED;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'SLOT_UNAVAILABLE: slot % is already being booked by another request', p_slot_id;
    END IF;

    IF v_slot.is_booked OR v_slot.is_blocked THEN
        RAISE EXCEPTION 'SLOT_TAKEN: slot % is already booked or blocked', p_slot_id;
    END IF;

    IF v_slot.clinic_id <> p_clinic_id OR v_slot.dentist_id <> p_dentist_id THEN
        RAISE EXCEPTION 'SLOT_MISMATCH: slot does not belong to this clinic/dentist';
    END IF;

    v_appt_date  := v_slot.slot_date;
    v_start_time := v_slot.start_time;
    v_end_time   := v_slot.end_time;

    -- Step 2: Compute reminder timestamps
    v_remind_24h := (v_appt_date + v_start_time)::TIMESTAMPTZ - INTERVAL '24 hours';
    v_remind_2h  := (v_appt_date + v_start_time)::TIMESTAMPTZ - INTERVAL '2 hours';

    -- Step 3: Create appointment
    INSERT INTO appointments (
        clinic_id, patient_id, dentist_id, slot_id,
        appointment_date, start_time, end_time,
        type, status, chief_complaint, estimated_cost,
        booked_via, booked_by_user_id,
        reminder_status, reminder_24h_at, reminder_2h_at
    )
    VALUES (
        p_clinic_id, p_patient_id, p_dentist_id, p_slot_id,
        v_appt_date, v_start_time, v_end_time,
        p_type, 'scheduled', p_chief_complaint, p_estimated_cost,
        p_booked_via, p_booked_by_user_id,
        'pending', v_remind_24h, v_remind_2h
    )
    RETURNING id INTO v_appt_id;

    -- Step 4: Mark slot booked
    UPDATE appointment_slots
    SET    is_booked = true
    WHERE  id = p_slot_id;

    -- Step 5: Update patient aggregates
    UPDATE patients
    SET    last_visit_date = GREATEST(last_visit_date, v_appt_date),
           total_visits    = total_visits + 1
    WHERE  id = p_patient_id AND clinic_id = p_clinic_id;

    -- Step 6: Audit log
    INSERT INTO audit_logs (clinic_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (
        p_clinic_id,
        p_booked_by_user_id,
        'create',
        'appointment',
        v_appt_id,
        jsonb_build_object(
            'patientId',   p_patient_id,
            'dentistId',   p_dentist_id,
            'slotId',      p_slot_id,
            'date',        v_appt_date,
            'startTime',   v_start_time,
            'bookedVia',   p_booked_via
        )
    );

    RETURN v_appt_id;
END;
$$;

COMMENT ON FUNCTION book_appointment_atomic IS
    'Atomically book a slot, create appointment, update patient stats, schedule reminders';


-- -----------------------------------------------------------------------------
-- 1b. complete_appointment_with_invoice
--
-- Marks an appointment completed and optionally auto-creates a draft invoice
-- from treatments linked to the appointment.
-- Returns: JSONB { appointmentId, invoiceId }
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION complete_appointment_with_invoice(
    p_clinic_id     UUID,
    p_appointment_id UUID,
    p_completed_by  UUID DEFAULT NULL,
    p_clinical_notes TEXT DEFAULT NULL,
    p_create_invoice BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_appt     RECORD;
    v_invoice_id UUID;
    v_subtotal NUMERIC(12,2) := 0;
    v_tax_pct  NUMERIC(5,2);
    v_tax_amt  NUMERIC(12,2);
    v_total    NUMERIC(12,2);
    v_inv_prefix TEXT;
BEGIN
    -- Lock appointment row
    SELECT id, patient_id, status, appointment_date
    INTO   v_appt
    FROM   appointments
    WHERE  id = p_appointment_id AND clinic_id = p_clinic_id
    FOR    UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Appointment % not found', p_appointment_id;
    END IF;

    IF v_appt.status NOT IN ('scheduled','confirmed','in_progress') THEN
        RAISE EXCEPTION 'Appointment is in % state — cannot complete', v_appt.status;
    END IF;

    -- Mark appointment completed
    UPDATE appointments
    SET    status       = 'completed',
           clinical_notes = COALESCE(p_clinical_notes, clinical_notes),
           updated_at   = NOW()
    WHERE  id = p_appointment_id;

    IF NOT p_create_invoice THEN
        RETURN jsonb_build_object('appointmentId', p_appointment_id, 'invoiceId', NULL);
    END IF;

    -- Gather treatment totals for this appointment
    SELECT COALESCE(SUM(line_total), 0)
    INTO   v_subtotal
    FROM   treatments
    WHERE  appointment_id = p_appointment_id AND status = 'completed';

    IF v_subtotal = 0 THEN
        RETURN jsonb_build_object('appointmentId', p_appointment_id, 'invoiceId', NULL);
    END IF;

    -- Clinic tax setting
    SELECT COALESCE((settings->>'taxPercent')::NUMERIC, 18)
    INTO   v_tax_pct
    FROM   clinics WHERE id = p_clinic_id;

    v_tax_amt := ROUND(v_subtotal * v_tax_pct / 100, 2);
    v_total   := v_subtotal + v_tax_amt;

    -- Create draft invoice (number filled by trigger)
    INSERT INTO invoices (
        clinic_id, patient_id, appointment_id,
        invoice_date, status,
        subtotal, tax_pct, tax_amt, total_amount,
        due_date
    )
    VALUES (
        p_clinic_id, v_appt.patient_id, p_appointment_id,
        CURRENT_DATE, 'draft',
        v_subtotal, v_tax_pct, v_tax_amt, v_total,
        CURRENT_DATE + INTERVAL '7 days'
    )
    RETURNING id INTO v_invoice_id;

    -- Populate invoice items from treatments
    INSERT INTO invoice_items (
        invoice_id, treatment_id, procedure_id,
        description, tooth_number, quantity,
        unit_price, discount_pct, sort_order
    )
    SELECT
        v_invoice_id,
        t.id,
        t.procedure_id,
        t.description,
        t.tooth_number,
        t.quantity,
        t.unit_price,
        t.discount_pct,
        ROW_NUMBER() OVER (ORDER BY t.created_at)
    FROM treatments t
    WHERE t.appointment_id = p_appointment_id AND t.status = 'completed';

    -- Audit
    INSERT INTO audit_logs (clinic_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (
        p_clinic_id, p_completed_by, 'create', 'invoice', v_invoice_id,
        jsonb_build_object('appointmentId', p_appointment_id, 'total', v_total)
    );

    RETURN jsonb_build_object(
        'appointmentId', p_appointment_id,
        'invoiceId',     v_invoice_id,
        'total',         v_total
    );
END;
$$;


-- -----------------------------------------------------------------------------
-- 1c. cancel_appointment_atomic
--
-- Cancels an appointment, frees the slot, decrements patient.total_visits,
-- and logs the action.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cancel_appointment_atomic(
    p_clinic_id      UUID,
    p_appointment_id UUID,
    p_cancelled_by   UUID,
    p_reason         TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_appt RECORD;
BEGIN
    SELECT id, slot_id, patient_id, status
    INTO   v_appt
    FROM   appointments
    WHERE  id = p_appointment_id AND clinic_id = p_clinic_id
    FOR    UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Appointment % not found', p_appointment_id;
    END IF;

    IF v_appt.status IN ('completed','cancelled') THEN
        RAISE EXCEPTION 'Cannot cancel — appointment is already %', v_appt.status;
    END IF;

    UPDATE appointments
    SET    status         = 'cancelled',
           cancelled_at   = NOW(),
           cancel_reason  = p_reason,
           cancelled_by   = p_cancelled_by
    WHERE  id = p_appointment_id;

    -- Free the slot
    IF v_appt.slot_id IS NOT NULL THEN
        UPDATE appointment_slots SET is_booked = false WHERE id = v_appt.slot_id;
    END IF;

    -- Adjust patient visit count
    UPDATE patients
    SET    total_visits = GREATEST(0, total_visits - 1)
    WHERE  id = v_appt.patient_id AND clinic_id = p_clinic_id;

    INSERT INTO audit_logs (clinic_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (
        p_clinic_id, p_cancelled_by, 'update', 'appointment', p_appointment_id,
        jsonb_build_object('status', 'cancelled', 'reason', p_reason)
    );
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 2 — HEAVY DATA PROCESSING  (Reports & Aggregations)
-- ─────────────────────────────────────────────────────────────────────────────

-- -----------------------------------------------------------------------------
-- 2a. fn_monthly_revenue_report
--
-- Returns month-by-month revenue for a clinic over the last N months.
-- Covers: total_revenue, paid_revenue, outstanding, payment_count, invoice_count
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_monthly_revenue_report(
    p_clinic_id UUID,
    p_months    INT DEFAULT 12
)
RETURNS TABLE (
    month           DATE,
    invoice_count   BIGINT,
    payment_count   BIGINT,
    gross_revenue   NUMERIC,
    discount_total  NUMERIC,
    tax_total       NUMERIC,
    net_revenue     NUMERIC,
    paid_amount     NUMERIC,
    outstanding     NUMERIC,
    avg_invoice_val NUMERIC
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        DATE_TRUNC('month', i.invoice_date)::DATE                          AS month,
        COUNT(DISTINCT i.id)                                               AS invoice_count,
        COUNT(DISTINCT p.id)                                               AS payment_count,
        SUM(i.total_amount)                                                AS gross_revenue,
        SUM(i.discount_amt)                                                AS discount_total,
        SUM(i.tax_amt)                                                     AS tax_total,
        SUM(i.total_amount - i.discount_amt)                               AS net_revenue,
        SUM(i.paid_amount)                                                 AS paid_amount,
        SUM(i.balance_amount)                                              AS outstanding,
        ROUND(AVG(i.total_amount), 2)                                      AS avg_invoice_val
    FROM   invoices i
    LEFT JOIN payments p
           ON  p.invoice_id = i.id
           AND p.status      = 'success'
           AND DATE_TRUNC('month', p.paid_at) = DATE_TRUNC('month', i.invoice_date)
    WHERE  i.clinic_id  = p_clinic_id
      AND  i.status    NOT IN ('cancelled')
      AND  i.invoice_date >= DATE_TRUNC('month', NOW() - (p_months - 1 || ' months')::INTERVAL)
    GROUP  BY DATE_TRUNC('month', i.invoice_date)
    ORDER  BY month DESC;
$$;


-- -----------------------------------------------------------------------------
-- 2b. fn_patient_retention_report
--
-- Cohort retention: patients acquired in each month and how many returned
-- within 30, 60, 90, and 180 days.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_patient_retention_report(
    p_clinic_id UUID,
    p_months    INT DEFAULT 6
)
RETURNS TABLE (
    cohort_month   DATE,
    new_patients   BIGINT,
    returned_30d   BIGINT,
    returned_60d   BIGINT,
    returned_90d   BIGINT,
    returned_180d  BIGINT,
    retention_30d  NUMERIC,
    retention_90d  NUMERIC
)
LANGUAGE sql
STABLE
AS $$
WITH cohorts AS (
    SELECT
        DATE_TRUNC('month', p.created_at)::DATE AS cohort_month,
        p.id                                     AS patient_id,
        p.created_at                             AS first_seen
    FROM   patients p
    WHERE  p.clinic_id = p_clinic_id
      AND  p.created_at >= DATE_TRUNC('month', NOW() - (p_months - 1 || ' months')::INTERVAL)
),
returns AS (
    SELECT
        c.cohort_month,
        c.patient_id,
        MIN(a.appointment_date) AS first_return
    FROM   cohorts c
    JOIN   appointments a
           ON  a.patient_id = c.patient_id
           AND a.clinic_id  = p_clinic_id
           AND a.appointment_date > c.first_seen::DATE
           AND a.status NOT IN ('cancelled','no_show')
    GROUP  BY c.cohort_month, c.patient_id
)
SELECT
    c.cohort_month,
    COUNT(DISTINCT c.patient_id)                                                   AS new_patients,
    COUNT(DISTINCT CASE WHEN r.first_return <= c.first_seen::DATE + 30  THEN c.patient_id END) AS returned_30d,
    COUNT(DISTINCT CASE WHEN r.first_return <= c.first_seen::DATE + 60  THEN c.patient_id END) AS returned_60d,
    COUNT(DISTINCT CASE WHEN r.first_return <= c.first_seen::DATE + 90  THEN c.patient_id END) AS returned_90d,
    COUNT(DISTINCT CASE WHEN r.first_return <= c.first_seen::DATE + 180 THEN c.patient_id END) AS returned_180d,
    ROUND(
        COUNT(DISTINCT CASE WHEN r.first_return <= c.first_seen::DATE + 30 THEN c.patient_id END)::NUMERIC
        / NULLIF(COUNT(DISTINCT c.patient_id), 0) * 100, 1
    ) AS retention_30d,
    ROUND(
        COUNT(DISTINCT CASE WHEN r.first_return <= c.first_seen::DATE + 90 THEN c.patient_id END)::NUMERIC
        / NULLIF(COUNT(DISTINCT c.patient_id), 0) * 100, 1
    ) AS retention_90d
FROM cohorts c
LEFT JOIN returns r USING (patient_id)
GROUP BY c.cohort_month
ORDER BY c.cohort_month DESC;
$$;


-- -----------------------------------------------------------------------------
-- 2c. fn_dentist_performance
--
-- Per-dentist KPIs: appointments, completions, no-shows, revenue, avg appointment value.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_dentist_performance(
    p_clinic_id  UUID,
    p_from_date  DATE DEFAULT (CURRENT_DATE - INTERVAL '30 days')::DATE,
    p_to_date    DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
    dentist_id        UUID,
    dentist_name      TEXT,
    total_scheduled   BIGINT,
    completed         BIGINT,
    cancelled         BIGINT,
    no_show           BIGINT,
    completion_rate   NUMERIC,
    total_revenue     NUMERIC,
    avg_appt_value    NUMERIC,
    unique_patients   BIGINT
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        u.id                                                  AS dentist_id,
        u.full_name                                           AS dentist_name,
        COUNT(a.id)                                           AS total_scheduled,
        COUNT(a.id) FILTER (WHERE a.status = 'completed')    AS completed,
        COUNT(a.id) FILTER (WHERE a.status = 'cancelled')    AS cancelled,
        COUNT(a.id) FILTER (WHERE a.status = 'no_show')      AS no_show,
        ROUND(
            COUNT(a.id) FILTER (WHERE a.status = 'completed')::NUMERIC
            / NULLIF(COUNT(a.id) FILTER (WHERE a.status NOT IN ('cancelled')), 0) * 100, 1
        )                                                     AS completion_rate,
        COALESCE(SUM(i.total_amount) FILTER (WHERE i.status NOT IN ('cancelled')), 0)
                                                              AS total_revenue,
        ROUND(
            COALESCE(SUM(i.total_amount) FILTER (WHERE i.status NOT IN ('cancelled')), 0)
            / NULLIF(COUNT(a.id) FILTER (WHERE a.status = 'completed'), 0), 2
        )                                                     AS avg_appt_value,
        COUNT(DISTINCT a.patient_id)                          AS unique_patients
    FROM   users u
    LEFT JOIN appointments a
           ON  a.dentist_id  = u.id
           AND a.clinic_id   = p_clinic_id
           AND a.appointment_date BETWEEN p_from_date AND p_to_date
    LEFT JOIN invoices i
           ON  i.appointment_id = a.id
    WHERE  u.clinic_id = p_clinic_id
      AND  u.role       = 'dentist'
      AND  u.is_active   = true
    GROUP  BY u.id, u.full_name
    ORDER  BY completed DESC;
$$;


-- -----------------------------------------------------------------------------
-- 2d. fn_procedure_revenue_breakdown
--
-- Breakdown of revenue by procedure category and individual procedure.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_procedure_revenue_breakdown(
    p_clinic_id UUID,
    p_from_date DATE DEFAULT (CURRENT_DATE - INTERVAL '30 days')::DATE,
    p_to_date   DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
    category         TEXT,
    procedure_name   TEXT,
    treatment_count  BIGINT,
    total_revenue    NUMERIC,
    avg_price        NUMERIC
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        COALESCE(pr.category, 'Uncategorised')  AS category,
        COALESCE(pr.name, t.description)        AS procedure_name,
        COUNT(t.id)                             AS treatment_count,
        SUM(t.line_total)                       AS total_revenue,
        ROUND(AVG(t.unit_price), 2)             AS avg_price
    FROM treatments t
    LEFT JOIN procedures pr ON pr.id = t.procedure_id
    WHERE t.clinic_id    = p_clinic_id
      AND t.status       = 'completed'
      AND t.performed_at::DATE BETWEEN p_from_date AND p_to_date
    GROUP BY COALESCE(pr.category,'Uncategorised'), COALESCE(pr.name, t.description)
    ORDER BY total_revenue DESC;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 3 — BULK OPERATIONS
-- ─────────────────────────────────────────────────────────────────────────────

-- -----------------------------------------------------------------------------
-- 3a. fn_campaign_target_patients
--
-- Returns patients matching a campaign audience filter.
-- audience_type: 'all' | 'inactive_90d' | 'outstanding_balance' |
--                'birthday_this_month' | 'no_appointment_6m' | 'new_patients_30d'
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_campaign_target_patients(
    p_clinic_id     UUID,
    p_audience_type TEXT,
    p_limit         INT  DEFAULT 1000,
    p_offset        INT  DEFAULT 0
)
RETURNS TABLE (
    patient_id   UUID,
    full_name    TEXT,
    phone        TEXT,
    email        TEXT,
    wa_opt_in    BOOLEAN,
    email_opt_in BOOLEAN,
    last_visit   DATE,
    balance      NUMERIC
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.id,
        p.full_name,
        p.phone,
        p.email,
        p.wa_opt_in,
        p.email_opt_in,
        p.last_visit_date,
        p.outstanding_balance
    FROM patients p
    WHERE p.clinic_id = p_clinic_id
      AND p.is_active  = true
      AND CASE p_audience_type
            WHEN 'all' THEN
                true
            WHEN 'inactive_90d' THEN
                (p.last_visit_date IS NULL OR p.last_visit_date < CURRENT_DATE - 90)
            WHEN 'outstanding_balance' THEN
                p.outstanding_balance > 0
            WHEN 'birthday_this_month' THEN
                EXTRACT(MONTH FROM p.date_of_birth) = EXTRACT(MONTH FROM CURRENT_DATE)
            WHEN 'no_appointment_6m' THEN
                NOT EXISTS (
                    SELECT 1 FROM appointments a
                    WHERE a.patient_id = p.id
                      AND a.clinic_id  = p_clinic_id
                      AND a.appointment_date >= CURRENT_DATE - 180
                      AND a.status NOT IN ('cancelled','no_show')
                )
            WHEN 'new_patients_30d' THEN
                p.created_at >= CURRENT_DATE - 30
            ELSE true
          END
    ORDER BY p.full_name
    LIMIT  p_limit
    OFFSET p_offset;
END;
$$;

COMMENT ON FUNCTION fn_campaign_target_patients IS
    'Returns patients matching a broadcast campaign audience filter';


-- -----------------------------------------------------------------------------
-- 3b. schedule_appointment_reminders_bulk
--
-- Inserts pending notification rows for all appointments whose reminder
-- windows fall within the next p_lookahead_hours hours and haven't been
-- scheduled yet. Called by the cron job every 15 minutes.
-- Returns: count of notifications scheduled.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION schedule_appointment_reminders_bulk(
    p_clinic_id      UUID DEFAULT NULL,     -- NULL = all clinics
    p_lookahead_hours INT  DEFAULT 2
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    v_count INT := 0;
    v_now   TIMESTAMPTZ := NOW();
    v_until TIMESTAMPTZ := NOW() + (p_lookahead_hours || ' hours')::INTERVAL;
BEGIN
    -- ── 24h reminders ─────────────────────────────────────────────────────────
    WITH eligible AS (
        SELECT
            a.id          AS appointment_id,
            a.clinic_id,
            a.patient_id,
            a.dentist_id,
            a.reminder_24h_at AS scheduled_at
        FROM   appointments a
        JOIN   patients p ON p.id = a.patient_id
        WHERE  (p_clinic_id IS NULL OR a.clinic_id = p_clinic_id)
          AND  a.status          = 'scheduled'
          AND  a.reminder_status = 'pending'
          AND  a.reminder_24h_at BETWEEN v_now AND v_until
          AND  p.wa_opt_in = true
          AND  p.phone IS NOT NULL
          -- Don't schedule if already queued
          AND  NOT EXISTS (
                  SELECT 1 FROM notifications n
                  WHERE n.appointment_id = a.id
                    AND n.type           = 'appointment_reminder_24h'
                    AND n.status        NOT IN ('failed','cancelled')
               )
    ),
    ins AS (
        INSERT INTO notifications (
            clinic_id, patient_id, channel, type, body,
            appointment_id, scheduled_at, status,
            recipient_phone
        )
        SELECT
            e.clinic_id, e.patient_id, 'whatsapp',
            'appointment_reminder_24h',
            'reminder_24h',   -- body rendered at send time from template
            e.appointment_id,
            e.scheduled_at,
            'pending',
            (SELECT phone FROM patients WHERE id = e.patient_id)
        FROM eligible e
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_count FROM ins;

    -- Mark reminder_status updated so we don't re-check
    UPDATE appointments
    SET    reminder_status = 'sent_24h'
    WHERE  id IN (
        SELECT appointment_id FROM notifications
        WHERE  type         = 'appointment_reminder_24h'
          AND  status       = 'pending'
          AND  scheduled_at BETWEEN v_now AND v_until
    );

    -- ── 2h reminders ──────────────────────────────────────────────────────────
    WITH eligible2 AS (
        SELECT
            a.id          AS appointment_id,
            a.clinic_id,
            a.patient_id,
            a.reminder_2h_at AS scheduled_at
        FROM   appointments a
        JOIN   patients p ON p.id = a.patient_id
        WHERE  (p_clinic_id IS NULL OR a.clinic_id = p_clinic_id)
          AND  a.status          IN ('scheduled','confirmed')
          AND  a.reminder_status IN ('pending','sent_24h')
          AND  a.reminder_2h_at BETWEEN v_now AND v_until
          AND  p.wa_opt_in = true
          AND  NOT EXISTS (
                  SELECT 1 FROM notifications n
                  WHERE n.appointment_id = a.id
                    AND n.type           = 'appointment_reminder_2h'
                    AND n.status        NOT IN ('failed','cancelled')
               )
    ),
    ins2 AS (
        INSERT INTO notifications (
            clinic_id, patient_id, channel, type, body,
            appointment_id, scheduled_at, status, recipient_phone
        )
        SELECT
            e.clinic_id, e.patient_id, 'whatsapp',
            'appointment_reminder_2h', 'reminder_2h',
            e.appointment_id, e.scheduled_at, 'pending',
            (SELECT phone FROM patients WHERE id = e.patient_id)
        FROM eligible2 e
        RETURNING 1
    )
    SELECT v_count + COUNT(*) INTO v_count FROM ins2;

    RETURN v_count;
END;
$$;


-- -----------------------------------------------------------------------------
-- 3c. mark_overdue_invoices_bulk
--
-- Sets status = 'overdue' for all sent/partially-paid invoices whose due_date
-- has passed. Called nightly by cron.
-- Returns: count of invoices updated.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_overdue_invoices_bulk(
    p_clinic_id UUID DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    v_count INT;
BEGIN
    WITH updated AS (
        UPDATE invoices
        SET    status    = 'overdue',
               overdue_at = NOW()
        WHERE  (p_clinic_id IS NULL OR clinic_id = p_clinic_id)
          AND  status   IN ('sent','partially_paid')
          AND  due_date  < CURRENT_DATE
          AND  due_date IS NOT NULL
        RETURNING id
    )
    SELECT COUNT(*) INTO v_count FROM updated;

    RETURN v_count;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 4 — PERFORMANCE OPTIMIZATION
-- ─────────────────────────────────────────────────────────────────────────────

-- -----------------------------------------------------------------------------
-- 4a. fn_clinic_dashboard_stats
--
-- Single-call dashboard aggregation: today's stats, month-to-date, all-time.
-- Replaces 6+ separate queries from the frontend.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_clinic_dashboard_stats(p_clinic_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_build_object(
        -- Today
        'todayAppointments',    (SELECT COUNT(*) FROM appointments
                                  WHERE clinic_id = p_clinic_id
                                    AND appointment_date = CURRENT_DATE
                                    AND status NOT IN ('cancelled')),
        'todayCompleted',       (SELECT COUNT(*) FROM appointments
                                  WHERE clinic_id = p_clinic_id
                                    AND appointment_date = CURRENT_DATE
                                    AND status = 'completed'),
        'todayRevenue',         (SELECT COALESCE(SUM(p.amount),0) FROM payments p
                                  JOIN invoices i ON i.id = p.invoice_id
                                  WHERE i.clinic_id = p_clinic_id
                                    AND p.paid_at::DATE = CURRENT_DATE
                                    AND p.status = 'success'),

        -- Month to date
        'mtdRevenue',           (SELECT COALESCE(SUM(p.amount),0) FROM payments p
                                  JOIN invoices i ON i.id = p.invoice_id
                                  WHERE i.clinic_id = p_clinic_id
                                    AND DATE_TRUNC('month', p.paid_at) = DATE_TRUNC('month', NOW())
                                    AND p.status = 'success'),
        'mtdAppointments',      (SELECT COUNT(*) FROM appointments
                                  WHERE clinic_id = p_clinic_id
                                    AND DATE_TRUNC('month', appointment_date::TIMESTAMPTZ) = DATE_TRUNC('month', NOW())
                                    AND status NOT IN ('cancelled')),
        'mtdNewPatients',       (SELECT COUNT(*) FROM patients
                                  WHERE clinic_id = p_clinic_id
                                    AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())),

        -- Outstanding
        'outstandingAmount',    (SELECT COALESCE(SUM(balance_amount),0) FROM invoices
                                  WHERE clinic_id = p_clinic_id
                                    AND status NOT IN ('paid','cancelled','refunded')),
        'overdueCount',         (SELECT COUNT(*) FROM invoices
                                  WHERE clinic_id = p_clinic_id AND status = 'overdue'),

        -- All-time totals
        'totalPatients',        (SELECT patient_count FROM clinics WHERE id = p_clinic_id),
        'activePatients',       (SELECT COUNT(*) FROM patients
                                  WHERE clinic_id = p_clinic_id AND is_active = true),

        -- Pending reminders
        'pendingReminders',     (SELECT COUNT(*) FROM notifications
                                  WHERE clinic_id = p_clinic_id AND status = 'pending')
    ) INTO v_result;

    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION fn_clinic_dashboard_stats IS
    'Single-call dashboard aggregation — replaces 6+ individual queries';


-- -----------------------------------------------------------------------------
-- 4b. fn_patient_quick_summary
--
-- Returns a patient's full profile + recent history in one DB round-trip.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_patient_quick_summary(
    p_clinic_id  UUID,
    p_patient_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_patient    RECORD;
    v_appts      JSONB;
    v_invoices   JSONB;
    v_treatments JSONB;
BEGIN
    SELECT * INTO v_patient
    FROM patients
    WHERE id = p_patient_id AND clinic_id = p_clinic_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Patient % not found', p_patient_id;
    END IF;

    -- Last 5 appointments
    SELECT jsonb_agg(row_to_json(r)) INTO v_appts FROM (
        SELECT id, appointment_date, start_time, status, type,
               (SELECT full_name FROM users WHERE id = a.dentist_id) AS dentist_name
        FROM appointments a
        WHERE a.patient_id = p_patient_id AND a.clinic_id = p_clinic_id
        ORDER BY a.appointment_date DESC, a.start_time DESC
        LIMIT 5
    ) r;

    -- Last 3 invoices
    SELECT jsonb_agg(row_to_json(r)) INTO v_invoices FROM (
        SELECT id, invoice_number, invoice_date, status, total_amount, balance_amount
        FROM invoices
        WHERE patient_id = p_patient_id AND clinic_id = p_clinic_id
        ORDER BY invoice_date DESC LIMIT 3
    ) r;

    -- Last 10 treatments
    SELECT jsonb_agg(row_to_json(r)) INTO v_treatments FROM (
        SELECT id, description, tooth_number, quantity, unit_price, line_total, performed_at
        FROM treatments
        WHERE patient_id = p_patient_id AND clinic_id = p_clinic_id
        ORDER BY performed_at DESC LIMIT 10
    ) r;

    RETURN jsonb_build_object(
        'patient',    row_to_json(v_patient),
        'appointments', COALESCE(v_appts, '[]'::jsonb),
        'invoices',     COALESCE(v_invoices, '[]'::jsonb),
        'treatments',   COALESCE(v_treatments, '[]'::jsonb)
    );
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 5 — MATERIALIZED VIEWS (pre-computed analytics)
-- ─────────────────────────────────────────────────────────────────────────────

-- Monthly clinic revenue snapshot — refresh nightly
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_clinic_monthly_revenue AS
    SELECT
        i.clinic_id,
        DATE_TRUNC('month', i.invoice_date)::DATE AS month,
        COUNT(DISTINCT i.id)                      AS invoice_count,
        SUM(i.total_amount)                       AS gross_revenue,
        SUM(i.paid_amount)                        AS paid_amount,
        SUM(i.balance_amount)                     AS outstanding,
        COUNT(DISTINCT i.patient_id)              AS unique_patients
    FROM   invoices i
    WHERE  i.status NOT IN ('cancelled')
    GROUP  BY i.clinic_id, DATE_TRUNC('month', i.invoice_date)
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_revenue_pk
    ON mv_clinic_monthly_revenue(clinic_id, month);

CREATE OR REPLACE FUNCTION refresh_monthly_revenue()
RETURNS VOID LANGUAGE sql AS $$
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_clinic_monthly_revenue;
$$;


-- Appointment weekly summary — refresh every 30 minutes
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_appointment_weekly AS
    SELECT
        a.clinic_id,
        DATE_TRUNC('week', a.appointment_date::TIMESTAMPTZ)::DATE AS week_start,
        COUNT(*)                                             AS total,
        COUNT(*) FILTER (WHERE a.status = 'completed')     AS completed,
        COUNT(*) FILTER (WHERE a.status = 'cancelled')     AS cancelled,
        COUNT(*) FILTER (WHERE a.status = 'no_show')       AS no_show,
        COUNT(DISTINCT a.patient_id)                        AS unique_patients
    FROM   appointments a
    GROUP  BY a.clinic_id, DATE_TRUNC('week', a.appointment_date::TIMESTAMPTZ)
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_appt_weekly_pk
    ON mv_appointment_weekly(clinic_id, week_start);

CREATE OR REPLACE FUNCTION refresh_appointment_weekly()
RETURNS VOID LANGUAGE sql AS $$
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_appointment_weekly;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 6 — ROW LEVEL SECURITY  (production hardening)
-- ─────────────────────────────────────────────────────────────────────────────

-- The app uses a connection pool; SET LOCAL ensures per-transaction isolation.
-- The application sets:  SET LOCAL app.clinic_id = '<uuid>';

ALTER TABLE patients           ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices           ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE treatments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE treatment_plans    ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications      ENABLE ROW LEVEL SECURITY;

-- Helper function — reads the current-transaction clinic_id setting
CREATE OR REPLACE FUNCTION current_clinic_id()
RETURNS UUID LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.clinic_id', true), '')::UUID;
$$;

-- Policies (using DO to skip if already exist)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'rls_patients' AND tablename = 'patients') THEN
        CREATE POLICY rls_patients ON patients
            USING (clinic_id = current_clinic_id() OR current_clinic_id() IS NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'rls_appointments' AND tablename = 'appointments') THEN
        CREATE POLICY rls_appointments ON appointments
            USING (clinic_id = current_clinic_id() OR current_clinic_id() IS NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'rls_invoices' AND tablename = 'invoices') THEN
        CREATE POLICY rls_invoices ON invoices
            USING (clinic_id = current_clinic_id() OR current_clinic_id() IS NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'rls_payments' AND tablename = 'payments') THEN
        CREATE POLICY rls_payments ON payments
            USING (clinic_id = current_clinic_id() OR current_clinic_id() IS NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'rls_treatments' AND tablename = 'treatments') THEN
        CREATE POLICY rls_treatments ON treatments
            USING (clinic_id = current_clinic_id() OR current_clinic_id() IS NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'rls_treatment_plans' AND tablename = 'treatment_plans') THEN
        CREATE POLICY rls_treatment_plans ON treatment_plans
            USING (clinic_id = current_clinic_id() OR current_clinic_id() IS NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'rls_wa_messages' AND tablename = 'whatsapp_messages') THEN
        CREATE POLICY rls_wa_messages ON whatsapp_messages
            USING (clinic_id = current_clinic_id() OR current_clinic_id() IS NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'rls_notifications' AND tablename = 'notifications') THEN
        CREATE POLICY rls_notifications ON notifications
            USING (clinic_id = current_clinic_id() OR current_clinic_id() IS NULL);
    END IF;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 7 — DB-LEVEL ERROR LOGGING TABLE + TRIGGER
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_error_logs (
    id           BIGSERIAL PRIMARY KEY,
    source       TEXT NOT NULL DEFAULT 'db',   -- 'db' | 'api' | 'frontend'
    level        TEXT NOT NULL DEFAULT 'error', -- 'error' | 'warning' | 'fatal'
    context      TEXT,
    message      TEXT NOT NULL,
    detail       TEXT,
    hint         TEXT,
    sql_state    TEXT,
    clinic_id    UUID,
    user_id      UUID,
    request_path TEXT,
    stack_trace  TEXT,
    extra        JSONB,
    occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE app_error_logs IS 'Centralised error log: DB exceptions, API errors, and frontend errors';

CREATE INDEX IF NOT EXISTS idx_err_occurred  ON app_error_logs(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_err_source    ON app_error_logs(source, level);
CREATE INDEX IF NOT EXISTS idx_err_clinic    ON app_error_logs(clinic_id, occurred_at DESC) WHERE clinic_id IS NOT NULL;

-- Prevent any cleanup; errors are immutable records
CREATE RULE err_no_update AS ON UPDATE TO app_error_logs DO INSTEAD NOTHING;
CREATE RULE err_no_delete AS ON DELETE TO app_error_logs DO INSTEAD NOTHING;

-- Helper function to write a DB-level error log
CREATE OR REPLACE FUNCTION log_db_error(
    p_context    TEXT,
    p_message    TEXT,
    p_detail     TEXT     DEFAULT NULL,
    p_clinic_id  UUID     DEFAULT NULL,
    p_extra      JSONB    DEFAULT NULL,
    p_sql_state  TEXT     DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO app_error_logs (source, level, context, message, detail, sql_state, clinic_id, extra)
    VALUES ('db', 'error', p_context, p_message, p_detail, p_sql_state, p_clinic_id, p_extra);
EXCEPTION WHEN OTHERS THEN
    NULL; -- logging must never throw
END;
$$;

-- Wrap book_appointment_atomic to auto-log exceptions
CREATE OR REPLACE FUNCTION book_appointment_safe(
    p_clinic_id         UUID,
    p_patient_id        UUID,
    p_dentist_id        UUID,
    p_slot_id           UUID,
    p_type              appointment_type DEFAULT 'consultation',
    p_chief_complaint   TEXT            DEFAULT NULL,
    p_booked_via        TEXT            DEFAULT 'web',
    p_booked_by_user_id UUID            DEFAULT NULL,
    p_estimated_cost    NUMERIC(10,2)   DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_appt_id UUID;
BEGIN
    v_appt_id := book_appointment_atomic(
        p_clinic_id, p_patient_id, p_dentist_id, p_slot_id,
        p_type, p_chief_complaint, p_booked_via, p_booked_by_user_id, p_estimated_cost
    );
    RETURN jsonb_build_object('success', true, 'appointmentId', v_appt_id);
EXCEPTION WHEN OTHERS THEN
    PERFORM log_db_error(
        'book_appointment_safe',
        SQLERRM,
        SQLSTATE,
        p_clinic_id,
        jsonb_build_object(
            'patientId', p_patient_id,
            'slotId',    p_slot_id,
            'sqlState',  SQLSTATE
        ),
        SQLSTATE
    );
    RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'code', SQLSTATE);
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 8 — USEFUL INDEXES FOR HIGH-FREQUENCY QUERIES
-- ─────────────────────────────────────────────────────────────────────────────

-- Appointment list page: clinic + date range + status filter
CREATE INDEX IF NOT EXISTS idx_appt_list
    ON appointments(clinic_id, appointment_date, status, dentist_id)
    INCLUDE (patient_id, start_time, end_time, type);

-- Billing page: unpaid invoices sorted by due date
CREATE INDEX IF NOT EXISTS idx_inv_unpaid_due
    ON invoices(clinic_id, due_date)
    WHERE status IN ('sent','partially_paid','overdue');

-- Patient search by phone (exact)
CREATE INDEX IF NOT EXISTS idx_patient_phone_exact
    ON patients(clinic_id, phone)
    WHERE phone IS NOT NULL AND is_active = true;

-- Payment page: look up by razorpay order id
CREATE INDEX IF NOT EXISTS idx_inv_rzp_order
    ON invoices(razorpay_order_id)
    WHERE razorpay_order_id IS NOT NULL;

-- Reminder cron: scheduled notifications not yet sent
CREATE INDEX IF NOT EXISTS idx_notif_due
    ON notifications(scheduled_at, clinic_id)
    WHERE status = 'pending' AND scheduled_at IS NOT NULL;

-- Audit log queries by clinic + action
CREATE INDEX IF NOT EXISTS idx_audit_clinic_action
    ON audit_logs(clinic_id, action, occurred_at DESC);

-- Error log queries
CREATE INDEX IF NOT EXISTS idx_err_recent ON app_error_logs(occurred_at DESC)
    WHERE level = 'error';


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 9 — FIELD-LEVEL ENCRYPTION HELPERS  (pgcrypto)
-- ─────────────────────────────────────────────────────────────────────────────

-- Store the app encryption key as a DB-level setting (set via ALTER SYSTEM or
-- session variable — never hard-code here in production).
-- Usage: SELECT current_setting('app.encryption_key');

CREATE OR REPLACE FUNCTION encrypt_field(plaintext TEXT)
RETURNS TEXT LANGUAGE sql AS $$
    SELECT encode(
        pgp_sym_encrypt(plaintext, current_setting('app.encryption_key', true)),
        'base64'
    );
$$;

CREATE OR REPLACE FUNCTION decrypt_field(ciphertext TEXT)
RETURNS TEXT LANGUAGE sql AS $$
    SELECT pgp_sym_decrypt(
        decode(ciphertext, 'base64'),
        current_setting('app.encryption_key', true)
    );
$$;

-- Convenience: encrypt wa_api_key on insert/update
CREATE OR REPLACE FUNCTION encrypt_clinic_secrets()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.wa_api_key IS NOT NULL
       AND current_setting('app.encryption_key', true) IS NOT NULL
       AND NOT (NEW.wa_api_key LIKE 'encrypted:%') THEN
        NEW.wa_api_key := 'encrypted:' || encrypt_field(NEW.wa_api_key);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_clinics_encrypt_secrets
    BEFORE INSERT OR UPDATE OF wa_api_key ON clinics
    FOR EACH ROW EXECUTE FUNCTION encrypt_clinic_secrets();

-- =============================================================================
-- End of stored_procedures.sql
-- =============================================================================
