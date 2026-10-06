-- Document ordering: lets users drag documents to reorder them and move them
-- between categories. sortIndex is a per-vehicle position (lower = higher up).
-- Existing rows default to 0 and fall back to upload date until first reordered.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS "sortIndex" int NOT NULL DEFAULT 0;
