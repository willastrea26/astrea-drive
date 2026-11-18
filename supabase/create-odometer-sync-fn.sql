-- =====================================================================
-- Astrea Drive — odometer sync database function
--
-- Run once in the Supabase SQL Editor (Dashboard > SQL Editor > New query
-- > paste > Run). Requires the odometerSource / odometerSyncedAt columns
-- (update-vehicles-odometer-sync.sql), the odometer_readings table
-- (create-odometer-readings.sql) and the netstarRego column
-- (update-vehicles-netstar-rego.sql) to exist first.
--
-- The netstar edge function fetches odometers from Netstar and calls this
-- function with an array of { rego, km } readings. Because it is SECURITY
-- DEFINER (runs as its owner), the edge function needs no service-role key.
--
-- How it keeps mileage current (delta accumulation):
--   The telematics device counts distance from when it was installed, so its
--   reading is usually LOWER than the vehicle's true saved odometer. We keep
--   the saved odometer as the baseline and ADD the day-to-day *increase* in
--   the GPS reading to it — so the real lifetime mileage stays correct and
--   grows by the actual distance driven. A vehicle being tracked this way is
--   marked GPS-verified. The raw GPS reading is also stored each day so the
--   increase can be measured.
--
--   * first reading  -> baseline recorded, mileage unchanged
--   * GPS higher than any reading already counted -> add the increase,
--     mark GPS-verified (whenever a sync sees it — any time of day)
--   * no rise -> mark GPS-verified, mileage unchanged
--   * a jump of more than 5,000 km in one go (e.g. a tracker moved between
--     trucks) -> recorded as the new reading but NOT added; flagged 'suspect'
--   * zero / missing readings and unmatched regos -> reported as skipped
--
-- Fixed 19 Nov 2026: this used to add distance only on the FIRST sync of
-- each day (compared with the previous day's stored reading), while later
-- syncs overwrote the stored reading without adding anything. Netstar's
-- "yesterday odometer" refreshes at an unpredictable time each morning, so
-- when the first sync ran before that refresh it added 0, and the refreshed
-- (higher) reading was then stored by a later sync and never counted. Now
-- the comparison is against the highest reading ever counted for the vehicle
-- (a high-water mark), so each kilometre is added exactly once no matter
-- when, or how often, the sync runs.
-- =====================================================================

create or replace function public.sync_odometers_from_telematics(readings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r             record;
  v_vehicle     record;
  v_prev        integer;
  v_today       date := (now() at time zone 'Australia/Sydney')::date;
  v_delta       integer;
  v_max_jump    constant integer := 5000;  -- bigger single jumps aren't trusted
  v_verified    integer := 0;
  v_updated     integer := 0;
  v_added       bigint  := 0;
  v_results     jsonb   := '[]'::jsonb;
  v_now         timestamptz := now();
begin
  for r in
    select upper(btrim(x->>'rego')) as rego, max((x->>'km')::integer) as km
    from jsonb_array_elements(coalesce(readings, '[]'::jsonb)) as x
    group by upper(btrim(x->>'rego'))
  loop
    if r.rego is null or r.km is null or r.km <= 0 then
      v_results := v_results || jsonb_build_array(jsonb_build_object('rego', r.rego, 'status', 'missing'));
      continue;
    end if;

    -- Match the real plate, or a vehicle's Netstar alias (set when Netstar
    -- spells the plate differently), so the register plate can stay correct.
    select id, odometer into v_vehicle
    from public.vehicles
    where upper(btrim(rego)) = r.rego
       or upper(btrim("netstarRego")) = r.rego
    limit 1 for update;

    if not found then
      v_results := v_results || jsonb_build_array(jsonb_build_object('rego', r.rego, 'status', 'unmatched', 'gpsKm', r.km));
      continue;
    end if;

    -- High-water mark: the highest GPS reading already counted for this
    -- vehicle, on any day (including earlier today). Only the part of a
    -- reading above it is new distance, so repeated syncs can't double-count
    -- and a late Netstar refresh can't be missed.
    select max(km) into v_prev
    from public.odometer_readings
    where "vehicleId" = v_vehicle.id;

    -- Store today's raw GPS reading (never lowering it within the day).
    insert into public.odometer_readings (id, "vehicleId", km, "readDate", at)
    values (
      'odr-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
      v_vehicle.id, r.km, v_today, v_now
    )
    on conflict ("vehicleId", "readDate") do update
      set km = greatest(public.odometer_readings.km, excluded.km), at = excluded.at;

    if v_prev is null then
      -- First GPS reading for this vehicle: set the baseline, leave mileage.
      v_results := v_results || jsonb_build_array(jsonb_build_object('rego', r.rego, 'status', 'baseline', 'gpsKm', r.km));
    elsif r.km - v_prev > v_max_jump then
      -- Implausible jump (tracker swapped, reset or bad data): take it as the
      -- new reading so later increases count from here, but don't add it.
      v_results := v_results || jsonb_build_array(jsonb_build_object('rego', r.rego, 'status', 'suspect', 'gpsKm', r.km, 'jumpKm', r.km - v_prev));
    elsif r.km > v_prev then
      -- GPS rose above everything already counted — add the new distance.
      v_delta := r.km - v_prev;
      update public.vehicles
        set odometer = coalesce(odometer, 0) + v_delta,
            "odometerSource" = 'telematics',
            "odometerSyncedAt" = v_now
        where id = v_vehicle.id;
      v_updated := v_updated + 1;
      v_added := v_added + v_delta;
      v_results := v_results || jsonb_build_array(jsonb_build_object('rego', r.rego, 'status', 'accumulated', 'addedKm', v_delta, 'savedKm', coalesce(v_vehicle.odometer, 0) + v_delta));
    else
      -- No increase over what's already counted: confirm GPS-verified, no change.
      update public.vehicles
        set "odometerSource" = 'telematics',
            "odometerSyncedAt" = v_now
        where id = v_vehicle.id;
      v_verified := v_verified + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object('rego', r.rego, 'status', 'verified', 'gpsKm', r.km));
    end if;
  end loop;

  if v_updated > 0 then
    insert into public.activity (id, ts, "vehicleId", text)
    values (
      'act-odo-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
      v_now, '',
      'Odometers accumulated from telematics — ' || v_updated || ' vehicle' ||
      case when v_updated = 1 then '' else 's' end ||
      ' (+' || to_char(v_added, 'FM999,999,999') || ' km driven)'
    );
  end if;

  return jsonb_build_object('updated', v_updated, 'verified', v_verified, 'added', v_added, 'results', v_results);
end;
$$;

-- Only this narrow function is callable; it cannot be used to read or write
-- anything else in the database.
revoke all on function public.sync_odometers_from_telematics(jsonb) from public;
grant execute on function public.sync_odometers_from_telematics(jsonb) to anon, authenticated;
