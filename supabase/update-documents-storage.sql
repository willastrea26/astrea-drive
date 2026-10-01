BEGIN;

-- 1. Grow the documents row to carry a real file reference
ALTER TABLE documents ADD COLUMN IF NOT EXISTS "storagePath" text NOT NULL DEFAULT '';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS "contentType" text NOT NULL DEFAULT '';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS "sizeBytes"   bigint NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS "uploadedAt"  timestamptz;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS "uploadedBy"  text NOT NULL DEFAULT '';

-- 2. Private bucket for uploaded files (one bucket, folders keyed by vehicle id).
--    Private = downloads only via short-lived signed URLs the app requests.
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

-- 3. Storage RLS: only approved users can read / upload / delete.
--    Mirrors the "approved users full access" pattern used by every table.
DROP POLICY IF EXISTS "approved users read documents"   ON storage.objects;
DROP POLICY IF EXISTS "approved users upload documents" ON storage.objects;
DROP POLICY IF EXISTS "approved users update documents" ON storage.objects;
DROP POLICY IF EXISTS "approved users delete documents" ON storage.objects;

CREATE POLICY "approved users read documents"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'documents' AND is_approved());

CREATE POLICY "approved users upload documents"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'documents' AND is_approved());

CREATE POLICY "approved users update documents"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'documents' AND is_approved())
  WITH CHECK (bucket_id = 'documents' AND is_approved());

CREATE POLICY "approved users delete documents"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'documents' AND is_approved());

COMMIT;
