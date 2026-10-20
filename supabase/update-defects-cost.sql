-- What a defect cost to put right. Recorded when the defect is resolved (or
-- corrected later by editing it), so the weekly Cost sheet can count repair
-- spend alongside recorded services. Existing rows default to 0.
ALTER TABLE defects ADD COLUMN IF NOT EXISTS cost numeric NOT NULL DEFAULT 0;
