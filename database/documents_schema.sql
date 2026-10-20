-- =============================================================================
-- DentalEase — Document Management Schema
-- Patient records: X-rays, reports, prescriptions, lab results, photos
-- Run AFTER schema.sql and ehr_schema.sql
-- =============================================================================

-- ── Document type enum ────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE document_type AS ENUM (
    'xray', 'report', 'prescription', 'lab_result',
    'consent_form', 'photo', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Documents ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS documents (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID          NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id    UUID          NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  visit_id      UUID          REFERENCES visits(id) ON DELETE SET NULL,
  uploaded_by_id UUID         REFERENCES users(id) ON DELETE SET NULL,
  type          document_type NOT NULL DEFAULT 'other',
  file_name     TEXT          NOT NULL,
  s3_key        TEXT          NOT NULL,
  mime_type     VARCHAR(100),
  size_bytes    INT,
  description   TEXT,
  -- tags: plain string array for manual + auto tags, e.g. ["xray","radiology","panoramic"]
  tags          JSONB         NOT NULL DEFAULT '[]',
  -- ai_tags: structured { auto: [], suggested: [], confidence: 0.0 }
  ai_tags       JSONB         NOT NULL DEFAULT '{"auto":[],"suggested":[],"confidence":0}',
  is_active     BOOLEAN       NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Primary list query: all docs for a patient
CREATE INDEX IF NOT EXISTS idx_docs_patient
  ON documents(clinic_id, patient_id, is_active, created_at DESC);

-- Filter by document type
CREATE INDEX IF NOT EXISTS idx_docs_type
  ON documents(clinic_id, type, is_active);

-- Visit attachment lookup
CREATE INDEX IF NOT EXISTS idx_docs_visit
  ON documents(visit_id)
  WHERE visit_id IS NOT NULL;

-- Keyword search on filename + description (GIN trigram — requires pg_trgm)
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_docs_filename_trgm
  ON documents USING GIN(file_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_docs_desc_trgm
  ON documents USING GIN(description gin_trgm_ops)
  WHERE description IS NOT NULL;

-- Tag search using GIN on JSONB array
CREATE INDEX IF NOT EXISTS idx_docs_tags
  ON documents USING GIN(tags jsonb_path_ops);

CREATE INDEX IF NOT EXISTS idx_docs_ai_tags
  ON documents USING GIN(ai_tags jsonb_path_ops);

-- Date range queries
CREATE INDEX IF NOT EXISTS idx_docs_created_at
  ON documents(clinic_id, created_at DESC)
  WHERE is_active = true;

-- ── Updated_at trigger ────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_documents_updated_at ON documents;
CREATE TRIGGER trg_documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Full-text search function ─────────────────────────────────────────────────
-- Convenience helper used by fn_search_documents below

CREATE OR REPLACE FUNCTION fn_search_documents(
  p_clinic_id   UUID,
  p_patient_id  UUID,
  p_query       TEXT    DEFAULT NULL,
  p_type        TEXT    DEFAULT NULL,
  p_from_date   DATE    DEFAULT NULL,
  p_to_date     DATE    DEFAULT NULL,
  p_tag         TEXT    DEFAULT NULL,
  p_limit       INT     DEFAULT 20,
  p_offset      INT     DEFAULT 0
)
RETURNS TABLE (
  id            UUID,
  type          document_type,
  file_name     TEXT,
  s3_key        TEXT,
  mime_type     VARCHAR(100),
  size_bytes    INT,
  description   TEXT,
  tags          JSONB,
  ai_tags       JSONB,
  created_at    TIMESTAMPTZ,
  rank          REAL
)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    d.type,
    d.file_name,
    d.s3_key,
    d.mime_type,
    d.size_bytes,
    d.description,
    d.tags,
    d.ai_tags,
    d.created_at,
    CASE
      WHEN p_query IS NOT NULL THEN
        ts_rank(
          to_tsvector('english', coalesce(d.file_name, '') || ' ' || coalesce(d.description, '')),
          plainto_tsquery('english', p_query)
        )
      ELSE 1.0
    END::REAL AS rank
  FROM documents d
  WHERE
    d.clinic_id   = p_clinic_id
    AND d.patient_id  = p_patient_id
    AND d.is_active   = true
    AND (p_type     IS NULL OR d.type::TEXT = p_type)
    AND (p_from_date IS NULL OR d.created_at >= p_from_date::TIMESTAMPTZ)
    AND (p_to_date   IS NULL OR d.created_at <= (p_to_date + INTERVAL '1 day')::TIMESTAMPTZ)
    AND (p_tag       IS NULL OR d.tags @> to_jsonb(p_tag))
    AND (
      p_query IS NULL
      OR d.file_name    ILIKE '%' || p_query || '%'
      OR d.description  ILIKE '%' || p_query || '%'
      OR d.tags::TEXT   ILIKE '%' || p_query || '%'
      OR d.ai_tags::TEXT ILIKE '%' || p_query || '%'
    )
  ORDER BY
    CASE WHEN p_query IS NOT NULL THEN
      ts_rank(to_tsvector('english', coalesce(d.file_name,'') || ' ' || coalesce(d.description,'')), plainto_tsquery('english', p_query))
    ELSE 0 END DESC,
    d.created_at DESC
  LIMIT  p_limit
  OFFSET p_offset;
END;
$$;

-- ── Storage statistics function ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_patient_storage_stats(
  p_clinic_id  UUID,
  p_patient_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql STABLE AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'totalDocuments', COUNT(*),
    'totalSizeBytes', COALESCE(SUM(size_bytes), 0),
    'byType', (
      SELECT jsonb_object_agg(type::TEXT, cnt)
      FROM (
        SELECT type, COUNT(*) AS cnt
        FROM documents
        WHERE clinic_id = p_clinic_id AND patient_id = p_patient_id AND is_active = true
        GROUP BY type
      ) t
    )
  )
  INTO result
  FROM documents
  WHERE clinic_id = p_clinic_id AND patient_id = p_patient_id AND is_active = true;

  RETURN result;
END;
$$;

\echo 'Documents schema applied: documents table, indexes, fn_search_documents, fn_patient_storage_stats'
