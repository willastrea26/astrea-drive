-- =====================================================================
-- Astrea Drive — add a "capacity" column to the vehicles table
--
-- Free-text size/class of the asset (e.g. "5t", "20t", "2.5t"), to help
-- operators who don't know the fleet well identify what size truck or
-- plant they're looking at. Optional for every vehicle — a ute doesn't
-- need one, but a tipper or excavator usually will.
--
-- Run ONCE in Supabase > SQL Editor:
--   paste this whole file > Run
--
-- Safe to re-run — the IF NOT EXISTS guard means a second run is a no-op.
-- =====================================================================

alter table public.vehicles
  add column if not exists capacity text;
