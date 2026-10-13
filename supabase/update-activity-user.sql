-- Captures which signed-in user made each change, so "Recent activity" on
-- the dashboard can show who did what. Existing rows default to '' and
-- simply show no attribution until new activity is logged.
ALTER TABLE activity ADD COLUMN IF NOT EXISTS "userEmail" text NOT NULL DEFAULT '';
