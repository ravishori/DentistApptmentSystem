-- =============================================================================
-- DentalEase — Complete Database Setup Script
-- Run this once against a blank PostgreSQL 16+ database.
--
-- Usage:
--   psql -h localhost -U postgres -d dentalease_db -f database/setup.sql
-- Or via the shell script:
--   bash scripts/setup-db.sh
-- =============================================================================

\set ON_ERROR_STOP on
\timing on

\echo '=== Step 1: Extensions ==='
\i database/schema.sql

\echo '=== Step 2: Stored Procedures & Functions ==='
\i database/stored_procedures.sql

\echo '=== Step 3: Seed system data ==='
\i database/seeds.sql

\echo '=== Database setup complete ==='
