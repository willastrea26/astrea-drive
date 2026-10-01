-- Add photo gallery column to vehicles.
-- Each entry: { id, path (storage path), ts (ISO timestamp) }
-- Run this in the Supabase SQL Editor (https://supabase.com/dashboard).

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS photos jsonb DEFAULT '[]'::jsonb;
