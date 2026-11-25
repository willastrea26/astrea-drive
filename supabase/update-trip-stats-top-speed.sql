-- =====================================================================
-- Astrea Drive — top speed over the last 10 days
--
-- Run once in the Supabase SQL Editor (after create-trip-stats.sql).
-- Adds "maxSpeed10d" to vehicle_trip_stats: each vehicle's top speed over
-- the last 10 days, from a second Netstar trip-summary call in the nightly
-- sync. The dashboard's Top speed tile uses it, because one bad GPS fix can
-- hold a 30-day maximum for a month. The 30-day "maxSpeed" stays as it is.
--
-- Safe to run before or after the netstar function is redeployed: the old
-- function just doesn't send the new field, so it stays empty.
-- =====================================================================

alter table public.vehicle_trip_stats add column if not exists "maxSpeed10d" integer;

create or replace function public.record_trip_stats(rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r     record;
  v_id  text;
  n     integer := 0;
begin
  for r in
    select upper(btrim(x->>'rego'))                 as rego,
           nullif(x->>'runningKm','')::integer      as running_km,
           nullif(x->>'workingDays','')::numeric    as working_days,
           nullif(x->>'workMinutes','')::integer    as work_minutes,
           nullif(x->>'idleMinutes','')::integer    as idle_minutes,
           nullif(x->>'stopMinutes','')::integer    as stop_minutes,
           nullif(x->>'trips','')::integer          as trips,
           nullif(x->>'avgSpeed','')::integer       as avg_speed,
           nullif(x->>'maxSpeed','')::integer       as max_speed,
           nullif(x->>'maxSpeed10d','')::integer    as max_speed_10d,
           nullif(x->>'overspeed','')::integer      as overspeed,
           coalesce((x->>'days')::integer, 30)      as days
    from jsonb_array_elements(coalesce(rows, '[]'::jsonb)) as x
  loop
    if r.rego is null then continue; end if;
    select id into v_id from public.vehicles
      where upper(btrim(rego)) = r.rego or upper(btrim("netstarRego")) = r.rego
      limit 1;
    if v_id is null then continue; end if;

    insert into public.vehicle_trip_stats
      ("vehicleId", "runningKm", "workingDays", "workMinutes", "idleMinutes",
       "stopMinutes", trips, "avgSpeed", "maxSpeed", "maxSpeed10d", overspeed, "windowDays", "updatedAt")
    values
      (v_id, r.running_km, r.working_days, r.work_minutes, r.idle_minutes,
       r.stop_minutes, r.trips, r.avg_speed, r.max_speed, r.max_speed_10d, r.overspeed, r.days, now())
    on conflict ("vehicleId") do update
      set "runningKm"   = excluded."runningKm",
          "workingDays" = excluded."workingDays",
          "workMinutes" = excluded."workMinutes",
          "idleMinutes" = excluded."idleMinutes",
          "stopMinutes" = excluded."stopMinutes",
          trips         = excluded.trips,
          "avgSpeed"    = excluded."avgSpeed",
          "maxSpeed"    = excluded."maxSpeed",
          "maxSpeed10d" = excluded."maxSpeed10d",
          overspeed     = excluded.overspeed,
          "windowDays"  = excluded."windowDays",
          "updatedAt"   = excluded."updatedAt";
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.record_trip_stats(jsonb) from public;
grant execute on function public.record_trip_stats(jsonb) to anon, authenticated;
