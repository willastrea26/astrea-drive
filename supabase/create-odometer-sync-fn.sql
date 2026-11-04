-- =====================================================================
-- Astrea Drive — odometer sync database function
--
-- Run once in the Supabase SQL Editor (Dashboard > SQL Editor > New query
-- > paste > Run). Requires the odometerSource / odometerSyncedAt columns
-- from update-vehicles-odometer-sync.sql to exist first.
--
-- The netstar edge function fetches odometers from Netstar and calls this
-- function with an array of { rego, km } readings. Because it is SECURITY
-- DEFINER (runs as its owner), the edge function needs no service-role key
-- to write — and this function can ONLY touch odometers, nothing else.
--
-- Rules enforced here:
--   * higher readings update mileage; equal readings verify it against GPS
--   * lower readings preserve mileage and its existing source/timestamp
--   * zero / missing readings and unmatched regos are reported as skipped
--   * a single summary line is written to the activity feed
-- =====================================================================

create or replace function public.sync_odometers_from_telematics(readings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r        record;
  v_old    integer;
  v_vehicle record;
  v_verified integer := 0;
  v_results jsonb := '[]'::jsonb;
  v_updated integer := 0;
  v_added  bigint  := 0;
  v_now    timestamptz := now();
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

    select id, odometer into v_vehicle
    from public.vehicles
    where upper(btrim(rego)) = r.rego
    limit 1 for update;

    if not found then
      v_results := v_results || jsonb_build_array(jsonb_build_object('rego', r.rego, 'status', 'unmatched', 'gpsKm', r.km));
      continue;
    end if;
    v_old := v_vehicle.odometer;

    -- Record the raw telematics reading as today's snapshot (one per vehicle
    -- per day), so distance-driven can be measured over time. Kept even when
    -- the reading is lower than the stored odometer, so the history is a
    -- consistent run of device readings.
    insert into public.odometer_readings (id, "vehicleId", km, "readDate", at)
    values (
      'odr-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
      v_vehicle.id, r.km, (v_now at time zone 'Australia/Sydney')::date, v_now
    )
    on conflict ("vehicleId", "readDate")
      do update set km = excluded.km, at = excluded.at;

    if r.km < coalesce(v_old, 0) then
      v_results := v_results || jsonb_build_array(jsonb_build_object('rego', r.rego, 'status', 'lower', 'gpsKm', r.km, 'savedKm', v_old));
      continue;
    end if;

    update public.vehicles
      set odometer = r.km,
          "odometerSource"   = 'telematics',
          "odometerSyncedAt" = v_now
      where id = v_vehicle.id;

    if r.km = v_old then
      v_verified := v_verified + 1;
    else
      v_updated := v_updated + 1;
    end if;
    v_results := v_results || jsonb_build_array(jsonb_build_object('rego', r.rego, 'status', case when r.km = v_old then 'verified' else 'updated' end, 'gpsKm', r.km));
    v_added   := v_added + (r.km - coalesce(v_old, 0));
  end loop;

  if v_updated > 0 then
    insert into public.activity (id, ts, "vehicleId", text)
    values (
      'act-odo-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
      v_now, '',
      'Odometers synced from telematics — ' || v_updated || ' vehicle' ||
      case when v_updated = 1 then '' else 's' end ||
      ' updated (+' || to_char(v_added, 'FM999,999,999') || ' km)'
    );
  end if;

  return jsonb_build_object('updated', v_updated, 'verified', v_verified, 'added', v_added, 'results', v_results);
end;
$$;

-- Only this narrow function is callable; it cannot be used to read or write
-- anything else in the database.
revoke all on function public.sync_odometers_from_telematics(jsonb) from public;
grant execute on function public.sync_odometers_from_telematics(jsonb) to anon, authenticated;
