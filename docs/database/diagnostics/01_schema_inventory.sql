-- =============================================================================
-- DentalEase — Schema Inventory (SELECT-only)
-- Purpose: enumerate tables, columns, data types, PKs, FKs, unique and check
-- constraints, and important indexes in the public schema.
-- Safe to run on any PostgreSQL ≥ 13 instance the operator chooses.
-- Do NOT run on production without a change window; this script performs
-- read-only inspection but may queue behind writers.
-- Generated: 2026-11-23 for DENTALEASE-DGA-v1.0.
-- =============================================================================

\set ON_ERROR_STOP on
\timing on

\echo '=== 1a. Table count and names (public schema, base tables only) ==='
SELECT  table_schema,
        COUNT(*) AS base_table_count
FROM    information_schema.tables
WHERE   table_schema = 'public'
  AND   table_type   = 'BASE TABLE'
GROUP BY table_schema;

SELECT  table_name
FROM    information_schema.tables
WHERE   table_schema = 'public'
  AND   table_type   = 'BASE TABLE'
ORDER BY table_name;

\echo '=== 1b. Columns and PostgreSQL data types (public schema) ==='
SELECT  c.table_name,
        c.ordinal_position,
        c.column_name,
        c.data_type,
        c.udt_name,
        c.is_nullable,
        c.column_default
FROM    information_schema.columns c
JOIN    information_schema.tables  t
  ON    t.table_schema = c.table_schema
  AND   t.table_name   = c.table_name
WHERE   c.table_schema = 'public'
  AND   t.table_type   = 'BASE TABLE'
ORDER BY c.table_name, c.ordinal_position;

\echo '=== 1c. Enum types (public schema) ==='
SELECT  n.nspname    AS schema,
        t.typname    AS enum_name,
        array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
FROM    pg_type t
JOIN    pg_namespace n ON n.oid = t.typnamespace
JOIN    pg_enum e      ON e.enumtypid = t.oid
WHERE   n.nspname = 'public'
GROUP BY n.nspname, t.typname
ORDER BY t.typname;

\echo '=== 1d. Primary keys ==='
SELECT  tc.table_name,
        tc.constraint_name,
        string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS pk_columns
FROM    information_schema.table_constraints tc
JOIN    information_schema.key_column_usage  kcu
  ON    kcu.constraint_name = tc.constraint_name
  AND   kcu.table_schema   = tc.table_schema
WHERE   tc.table_schema    = 'public'
  AND   tc.constraint_type = 'PRIMARY KEY'
GROUP BY tc.table_name, tc.constraint_name
ORDER BY tc.table_name;

\echo '=== 1e. Foreign keys (with ON DELETE / ON UPDATE) ==='
SELECT  conrelid::regclass AS table_name,
        conname            AS fk_name,
        pg_get_constraintdef(oid) AS definition
FROM    pg_constraint
WHERE   contype  = 'f'
  AND   connamespace = 'public'::regnamespace
ORDER BY conrelid::regclass::text, conname;

\echo '=== 1f. UNIQUE constraints ==='
SELECT  tc.table_name,
        tc.constraint_name,
        string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS unique_columns
FROM    information_schema.table_constraints tc
JOIN    information_schema.key_column_usage  kcu
  ON    kcu.constraint_name = tc.constraint_name
  AND   kcu.table_schema   = tc.table_schema
WHERE   tc.table_schema    = 'public'
  AND   tc.constraint_type = 'UNIQUE'
GROUP BY tc.table_name, tc.constraint_name
ORDER BY tc.table_name, tc.constraint_name;

\echo '=== 1g. CHECK constraints ==='
SELECT  conrelid::regclass AS table_name,
        conname            AS check_name,
        pg_get_constraintdef(oid) AS definition
FROM    pg_constraint
WHERE   contype  = 'c'
  AND   connamespace = 'public'::regnamespace
ORDER BY conrelid::regclass::text, conname;

\echo '=== 1h. EXCLUDE constraints (e.g. overlapping-slot guard) ==='
SELECT  conrelid::regclass AS table_name,
        conname            AS exclude_name,
        pg_get_constraintdef(oid) AS definition
FROM    pg_constraint
WHERE   contype  = 'x'
  AND   connamespace = 'public'::regnamespace
ORDER BY conrelid::regclass::text, conname;

\echo '=== 1i. Important indexes (non-unique, non-PK) ==='
SELECT  schemaname,
        tablename,
        indexname,
        indexdef
FROM    pg_indexes
WHERE   schemaname = 'public'
  AND   indexname NOT IN (
          SELECT conname FROM pg_constraint WHERE contype IN ('p', 'u'))
ORDER BY tablename, indexname;

\echo '=== 1j. Materialized views and refresh functions ==='
SELECT  schemaname,
        matviewname,
        hasindexes,
        ispopulated
FROM    pg_matviews
WHERE   schemaname = 'public'
ORDER BY matviewname;

SELECT  n.nspname AS schema,
        p.proname AS function_name,
        pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
FROM    pg_proc p
JOIN    pg_namespace n ON n.oid = p.pronamespace
WHERE   n.nspname = 'public'
  AND   p.proname LIKE 'refresh_%'
ORDER BY p.proname;

\echo '=== 1k. Row counts per table (approximate, from pg_class) ==='
SELECT  relname AS table_name,
        n_live_tup AS approximate_rows
FROM    pg_stat_user_tables
WHERE   schemaname = 'public'
ORDER BY relname;

\echo '=== Schema inventory complete ==='
