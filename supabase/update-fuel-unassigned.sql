-- =====================================================================
-- Astrea Drive — fuel transactions not tied to a vehicle
--
-- Run once in the Supabase SQL Editor. Safe to re-run.
--
-- Some WEX cards are issued to a person, not a vehicle, so their
-- transactions have no registration; a few others carry a rego that isn't
-- in the fleet register. Until those cards are set up properly, the
-- importer saves these rows with no vehicle ("vehicleId" empty) so they
-- still count in total spend and Spend over time, and the Cost sheet's
-- totals match the WEX statement. They are left out of anything worked out
-- per vehicle (fuel cost per km, cost vs usage, vehicle pages).
--
-- "cardHolder" keeps the name printed on the card, for assigning later.
-- =====================================================================

alter table public.fuel_entries alter column "vehicleId" drop not null;
alter table public.fuel_entries add column if not exists "cardHolder" text;
