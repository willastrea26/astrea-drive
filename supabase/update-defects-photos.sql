BEGIN;

-- Each defect can carry two photo sets: the problem (reported) and the fix (resolution).
-- Stored as JSON arrays of data URLs so a single select('*') call returns them.
ALTER TABLE defects ADD COLUMN IF NOT EXISTS photos          jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE defects ADD COLUMN IF NOT EXISTS "resolvedPhotos" jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
