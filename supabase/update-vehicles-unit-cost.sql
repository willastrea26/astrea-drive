-- =====================================================================
-- Astrea Drive — add a "unit cost" column to the vehicles table
--
-- The purchase price of the vehicle or plant itself (the capital cost of
-- the asset), shown as its own KPI on the vehicle's Costs tab — separate
-- from "Total cost", which is ongoing running costs (fuel, servicing,
-- rego etc.) over a period. Optional for every vehicle.
--
-- Run ONCE in Supabase > SQL Editor:
--   paste this whole file > Run
--
-- Safe to re-run — the IF NOT EXISTS guard means a second run is a no-op.
-- =====================================================================

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS "unitCost" numeric;
