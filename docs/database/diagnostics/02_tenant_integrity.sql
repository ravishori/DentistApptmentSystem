-- =============================================================================
-- DentalEase — Tenant Integrity Checks (SELECT-only)
-- Purpose: assess whether clinic-level tenant isolation is structurally
-- enforced. Reports which tables carry a `clinic_id` column, whether that
-- column has an FK to `clinics(id)`, whether it is NOT NULL, whether an
-- index exists on it, and whether PostgreSQL row-level security is enabled.
-- No DML. No access to patient, clinical or financial record contents.
-- Generated: 2026-11-23 for DENTALEASE-DGA-v1.0.
-- =============================================================================

\set ON_ERROR_STOP on
\timing on

\echo '=== 2a. Tables carrying a clinic_id column, with nullability and default ==='
SELECT  c.table_name,
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default
FROM    information_schema.columns c
JOIN    information_schema.tables  t
  ON    t.table_schema = c.table_schema
  AND   t.table_name   = c.table_name
WHERE   c.table_schema = 'public'
  AND   t.table_type   = 'BASE TABLE'
  AND   c.column_name  = 'clinic_id'
ORDER BY c.table_name;

\echo '=== 2b. Tables in public with no clinic_id column (potential tenant gap) ==='
SELECT  t.table_name
FROM    information_schema.tables t
WHERE   t.table_schema = 'public'
  AND   t.table_type   = 'BASE TABLE'
  AND   NOT EXISTS (
          SELECT 1
          FROM   information_schema.columns c
          WHERE  c.table_schema = t.table_schema
            AND  c.table_name   = t.table_name
            AND  c.column_name  = 'clinic_id')
ORDER BY t.table_name;

\echo '=== 2c. FK coverage: does every clinic_id reference clinics(id)? ==='
WITH clinic_tables AS (
    SELECT  c.table_name
    FROM    information_schema.columns c
    JOIN    information_schema.tables  t
      ON    t.table_schema = c.table_schema
      AND   t.table_name   = c.table_name
    WHERE   c.table_schema = 'public'
      AND   t.table_type   = 'BASE TABLE'
      AND   c.column_name  = 'clinic_id'
), fk_links AS (
    SELECT  conrelid::regclass::text  AS src_table,
            confrelid::regclass::text AS dst_table,
            pg_get_constraintdef(oid) AS definition
    FROM    pg_constraint
    WHERE   contype      = 'f'
      AND   connamespace = 'public'::regnamespace
      AND   confrelid    = 'public.clinics'::regclass
)
SELECT  ct.table_name,
        COUNT(fl.definition) AS clinic_fk_count,
        array_agg(fl.definition ORDER BY fl.definition) FILTER (WHERE fl.definition IS NOT NULL) AS clinic_fk_definitions
FROM    clinic_tables ct
LEFT JOIN fk_links fl ON fl.src_table = 'public.' || ct.table_name
GROUP BY ct.table_name
ORDER BY ct.table_name;

\echo '=== 2d. Indexes on clinic_id (direct or composite with clinic_id first) ==='
SELECT  schemaname,
        tablename,
        indexname,
        indexdef
FROM    pg_indexes
WHERE   schemaname = 'public'
  AND   indexdef ILIKE '%(clinic_id%'
ORDER BY tablename, indexname;

\echo '=== 2e. Row-Level Security status on tenant-scoped tables ==='
SELECT  n.nspname    AS schema,
        c.relname    AS table_name,
        c.relrowsecurity   AS rls_enabled,
        c.relforcerowsecurity AS rls_forced
FROM    pg_class c
JOIN    pg_namespace n ON n.oid = c.relnamespace
WHERE   n.nspname = 'public'
  AND   c.relkind = 'r'
ORDER BY c.relname;

\echo '=== 2f. Policies defined on public tables (RLS detail) ==='
SELECT  schemaname,
        tablename,
        policyname,
        permissive,
        roles,
        cmd,
        qual
FROM    pg_policies
WHERE   schemaname = 'public'
ORDER BY tablename, policyname;

\echo '=== 2g. Cross-tenant orphan detection (reads COUNTs only; no PHI) ==='
-- Count rows whose clinic_id does not match the clinic_id of their logical parent.
-- These queries COUNT only; no PII / clinical / financial content is retrieved.

-- Patient → Clinic sanity (every patient's clinic_id must exist in clinics)
SELECT  'patients_orphan_clinic' AS check_name,
        COUNT(*)                 AS row_count
FROM    patients p
WHERE   NOT EXISTS (SELECT 1 FROM clinics c WHERE c.id = p.clinic_id);

-- Appointment → Patient clinic match
SELECT  'appointments_patient_clinic_mismatch' AS check_name,
        COUNT(*)                                AS row_count
FROM    appointments a
JOIN    patients     p ON p.id = a.patient_id
WHERE   p.clinic_id <> a.clinic_id;

-- Invoice → Patient clinic match
SELECT  'invoices_patient_clinic_mismatch' AS check_name,
        COUNT(*)                            AS row_count
FROM    invoices i
JOIN    patients p ON p.id = i.patient_id
WHERE   p.clinic_id <> i.clinic_id;

-- Payment → Invoice clinic match
SELECT  'payments_invoice_clinic_mismatch' AS check_name,
        COUNT(*)                            AS row_count
FROM    payments p
JOIN    invoices i ON i.id = p.invoice_id
WHERE   i.clinic_id <> p.clinic_id;

\echo '=== Tenant integrity checks complete ==='
