-- =============================================================================
-- DentalEase — Seed Data
-- System notification templates, default procedures catalog
-- =============================================================================

-- NOTE: Clinic-specific seeds are inserted by the API onboarding flow.
-- This file only contains platform-level defaults.

-- Populate materialized views (first refresh)
SELECT refresh_monthly_revenue();
SELECT refresh_appointment_weekly();

\echo 'Seed: materialized views refreshed'
