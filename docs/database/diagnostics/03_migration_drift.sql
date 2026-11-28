-- =============================================================================
-- DentalEase — Migration Drift & Prisma/PostgreSQL Consistency (SELECT-only)
-- Purpose: detect whether Prisma migration tracking is in use, surface the
-- specific column types that are most likely to drift between
-- `database/schema.sql` (TIME / TIMESTAMPTZ) and `prisma db push`
-- (text / timestamp(3)), and flag proposed but unapplied columns.
-- Generated: 2026-11-23 for DENTALEASE-DGA-v1.0.
-- =============================================================================

\set ON_ERROR_STOP on
\timing on

\echo '=== 3a. Prisma migration tracking table ==='
SELECT  t.table_name,
        CASE WHEN t.table_name = '_prisma_migrations' THEN 'PRESENT' ELSE 'OTHER' END AS note
FROM    information_schema.tables t
WHERE   t.table_schema = 'public'
  AND   t.table_name   = '_prisma_migrations';

-- If present, show its row count and the last few migrations by applied date.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = '_prisma_migrations') THEN
        RAISE NOTICE '_prisma_migrations table exists; dumping summary.';
    ELSE
        RAISE NOTICE '_prisma_migrations table does NOT exist; this DB is not under Prisma migrate tracking.';
    END IF;
END
$$ LANGUAGE plpgsql;

-- If _prisma_migrations is absent, this SELECT will fail safely; comment out
-- the block if you want strict silent output.
SELECT  migration_name,
        started_at,
        finished_at,
        applied_steps_count
FROM    _prisma_migrations
ORDER BY started_at DESC
LIMIT   20;

\echo '=== 3b. Known-drift columns: TIME vs text for appointment_slots / doctor_schedules ==='
SELECT  table_name,
        column_name,
        data_type,
        udt_name
FROM    information_schema.columns
WHERE   table_schema = 'public'
  AND   table_name IN ('appointment_slots', 'doctor_schedules', 'doctor_availabilities')
  AND   column_name IN ('start_time', 'end_time')
ORDER BY table_name, column_name;

-- Expected (schema.sql):     data_type = 'time without time zone'
-- Expected (prisma db push): data_type = 'text'
-- Divergence between the two paths is the source of the previously reported
-- "PostgreSQL TIME vs Prisma String" finding.

\echo '=== 3c. Known-drift columns: TIMESTAMPTZ vs timestamp(3) ==='
SELECT  table_name,
        column_name,
        data_type,
        datetime_precision
FROM    information_schema.columns
WHERE   table_schema = 'public'
  AND   column_name IN ('created_at', 'updated_at', 'started_at', 'completed_at', 'deleted_at')
ORDER BY table_name, column_name;

-- Expected (schema.sql):     data_type = 'timestamp with time zone' (no precision)
-- Expected (prisma db push): data_type = 'timestamp without time zone', precision 3

\echo '=== 3d. payment_link / razorpay_payment_link disposition on invoices ==='
SELECT  column_name,
        data_type,
        is_nullable
FROM    information_schema.columns
WHERE   table_schema = 'public'
  AND   table_name   = 'invoices'
  AND   column_name  IN ('payment_link', 'razorpay_payment_link');

-- Expected:
--   payment_link            TEXT NULL  -- declared by schema.sql + schema.prisma.paymentLink
--   razorpay_payment_link   TEXT NULL  -- ONLY if proposal migration
--                                        20261021000100_invoice_payment_link has been applied
-- If razorpay_payment_link exists without schema.prisma declaring it,
-- that is drift the application cannot read.

\echo '=== 3e. Proposed-but-unapplied columns from database/proposals/migrations/ ==='
-- 20261021000200_reminder_status_sent_48h: expects a new enum label or column
SELECT  'reminder_status.sent_48h' AS proposal,
        EXISTS (
          SELECT 1 FROM pg_type t
          JOIN pg_enum e ON e.enumtypid = t.oid
          WHERE t.typname = 'reminder_status'
            AND e.enumlabel = 'sent_48h'
        ) AS present;

-- 20261021000300_appointment_patient_rating: expects a patient_rating column on appointments
SELECT  'appointments.patient_rating' AS proposal,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name   = 'appointments'
            AND column_name  = 'patient_rating'
        ) AS present;

\echo '=== 3f. Addon-script coverage check: are tables from each addon present? ==='
-- schema.sql base (21 tables), billing_upgrade (4), multi_doctor (3),
-- ehr_schema (8), documents_schema (1) = 37 tables total.
SELECT  'billing_upgrade'       AS addon,
        COUNT(*)                AS tables_found,
        array_agg(table_name ORDER BY table_name) AS present
FROM    information_schema.tables
WHERE   table_schema = 'public'
  AND   table_name   IN ('treatment_packages', 'treatment_package_items',
                         'package_enrollments', 'insurance_claims')
UNION ALL
SELECT  'multi_doctor',
        COUNT(*),
        array_agg(table_name ORDER BY table_name)
FROM    information_schema.tables
WHERE   table_schema = 'public'
  AND   table_name   IN ('chairs', 'doctor_availabilities', 'doctor_schedules')
UNION ALL
SELECT  'ehr_schema',
        COUNT(*),
        array_agg(table_name ORDER BY table_name)
FROM    information_schema.tables
WHERE   table_schema = 'public'
  AND   table_name   IN ('dental_charts', 'teeth', 'visits', 'diagnoses',
                         'visit_attachments', 'prescriptions',
                         'prescription_items', 'prescription_templates')
UNION ALL
SELECT  'documents_schema',
        COUNT(*),
        array_agg(table_name ORDER BY table_name)
FROM    information_schema.tables
WHERE   table_schema = 'public'
  AND   table_name   IN ('documents');

\echo '=== 3g. Materialized views: present and populated? ==='
SELECT  matviewname,
        ispopulated
FROM    pg_matviews
WHERE   schemaname  = 'public'
  AND   matviewname IN ('mv_clinic_monthly_revenue', 'mv_appointment_weekly');

\echo '=== Migration drift checks complete ==='
