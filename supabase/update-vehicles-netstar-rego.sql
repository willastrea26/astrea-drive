-- =====================================================================
-- Astrea Drive — Netstar rego alias
--
-- Run once in the Supabase SQL Editor. Adds an optional alias so a vehicle
-- can link to its Netstar tracker even when Netstar spells the number plate
-- differently from the fleet register — the register's plate stays correct.
-- The odometer sync and live tracker match on the real rego OR this alias.
-- =====================================================================

alter table public.vehicles
  add column if not exists "netstarRego" text;

-- AVT03: register plate is XW52IY; Netstar reports it as XW52YI (last two
-- letters transposed). Link them without changing the real plate.
update public.vehicles set "netstarRego" = 'XW52YI' where id = 'AVT03';
