-- =====================================================================
-- Astrea Drive — telematics trip summary stats
--
-- Run once in the Supabase SQL Editor. Stores each vehicle's trip-summary
-- figures over a recent window, pulled from Netstar's trip-summary report:
-- distance, working days, engine/idle/stop time, trip count, speeds and
-- overspeed events. The GPS sync refreshes it; approved users read it.
--
-- These are all fields with a documented, verified response shape, so the
-- numbers are real rather than guessed.
-- =====================================================================

create table if not exists public.vehicle_trip_stats (
  "vehicleId"    text primary key references public.vehicles(id) on delete cascade,
  "runningKm"    integer,
  "workingDays"  numeric,
  "workMinutes"  integer,
  "idleMinutes"  integer,
  "stopMinutes"  integer,
  trips          integer,
  "avgSpeed"     integer,
  "maxSpeed"     integer,
  overspeed      integer,
  "windowDays"   integer not null default 30,
  "updatedAt"    timestamptz not null default now()
);

revoke all on table public.vehicle_trip_stats from anon;
grant select on table public.vehicle_trip_stats to authenticated;
alter table public.vehicle_trip_stats enable row level security;
create policy "approved users read" on public.vehicle_trip_stats
  for select to authenticated using (is_approved());

-- Upsert trip stats from the sync. SECURITY DEFINER so the edge function
-- needs no service-role key; matches on the real rego or the Netstar alias.
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
       "stopMinutes", trips, "avgSpeed", "maxSpeed", overspeed, "windowDays", "updatedAt")
    values
      (v_id, r.running_km, r.working_days, r.work_minutes, r.idle_minutes,
       r.stop_minutes, r.trips, r.avg_speed, r.max_speed, r.overspeed, r.days, now())
    on conflict ("vehicleId") do update
      set "runningKm"   = excluded."runningKm",
          "workingDays" = excluded."workingDays",
          "workMinutes" = excluded."workMinutes",
          "idleMinutes" = excluded."idleMinutes",
          "stopMinutes" = excluded."stopMinutes",
          trips         = excluded.trips,
          "avgSpeed"    = excluded."avgSpeed",
          "maxSpeed"    = excluded."maxSpeed",
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
