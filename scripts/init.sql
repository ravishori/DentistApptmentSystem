-- DentalEase — PostgreSQL initialization
-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";           -- for ILIKE full-text patient search
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- ─── Row Level Security helpers ──────────────────────────────────────────────
-- After TypeORM creates tables, enable RLS on tenant-scoped tables so that
-- even if a query bug forgets the tenantId filter, data cannot leak cross-tenant.
-- (Applied by migration, shown here for documentation)

-- Example: ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY tenant_isolation ON patients
--   USING (tenant_id = current_setting('app.tenant_id')::uuid);
-- SET app.tenant_id = '<tenant-uuid>';   ← set per connection via NestJS interceptor

-- ─── Indexes beyond TypeORM entities ─────────────────────────────────────────
-- GIN index for fast ILIKE patient search
-- CREATE INDEX idx_patients_fullname_gin ON patients USING gin(full_name gin_trgm_ops);
-- CREATE INDEX idx_patients_phone_gin ON patients USING gin(phone gin_trgm_ops);
