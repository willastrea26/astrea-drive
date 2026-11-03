-- =====================================================================
-- Astrea Drive — odometer sync provenance
--
-- Run once in the Supabase SQL Editor (Dashboard > SQL Editor > New query
-- > paste > Run). Adds two columns so a vehicle's odometer can record
-- where its current reading came from and when it was last synced from
-- Netstar telematics.
-- =====================================================================

alter table public.vehicles
  add column if not exists "odometerSource"   text not null default 'manual',
  add column if not exists "odometerSyncedAt" timestamptz;
