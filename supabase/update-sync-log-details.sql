-- =====================================================================
-- Astrea Drive — per-vehicle details for each GPS sync
--
-- Run once in the Supabase SQL Editor, after create-sync-log.sql. Safe to
-- re-run.
--
-- Adds a "details" column to sync_log so each run can record WHICH vehicles
-- it changed and how. The dashboard's Telematic inputs shows this when a run
-- is clicked:
--   odometers   — [{ rego, status, addedKm, savedKm, gpsKm, jumpKm }]
--                 status: accumulated / verified / baseline / suspect /
--                 missing / unmatched (see create-odometer-sync-fn.sql)
--   engineHours — [{ rego, day, hours, distance }]   one row per vehicle-day saved
--   tripStats   — [{ rego, runningKm, workingDays, trips, ... }]  30-day snapshot
--
-- The netstar edge function sends these through a new 11-argument version
-- of record_sync_log. The old 10-argument version is left in place, so a
-- function that hasn't been redeployed yet keeps logging counts as before.
-- Runs from before this change simply have no details.
-- =====================================================================

BEGIN;

alter table public.sync_log add column if not exists details jsonb;

create or replace function public.record_sync_log(
  p_source text, p_depth text, p_quick boolean, p_ok boolean,
  p_updated integer, p_verified integer,
  p_daily_recorded integer, p_trip_stats_recorded integer, p_work_hours_recorded integer,
  p_error text,
  p_details jsonb
) returns bigint
language sql
security definer
set search_path = public
as $$
  insert into public.sync_log
    (source, depth, quick, ok, updated, verified, "dailyRecorded", "tripStatsRecorded", "workHoursRecorded", error, details)
  values
    (p_source, p_depth, coalesce(p_quick, false), p_ok, p_updated, p_verified, p_daily_recorded, p_trip_stats_recorded, p_work_hours_recorded, p_error, p_details)
  returning id;
$$;

revoke all on function public.record_sync_log(text, text, boolean, boolean, integer, integer, integer, integer, integer, text, jsonb) from public;
grant execute on function public.record_sync_log(text, text, boolean, boolean, integer, integer, integer, integer, integer, text, jsonb) to anon, authenticated;

COMMIT;
