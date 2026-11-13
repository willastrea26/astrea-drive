-- =====================================================================
-- Astrea Drive — daily engine hours (for the vehicle "Engine hours" chart)
--
-- Run once in the Supabase SQL Editor. One row per vehicle per day with the
-- engine work hours and distance Netstar reported for that day (its
-- workhour-report, queried one day at a time). The GPS sync refreshes it;
-- approved users read it.
-- =====================================================================

create table if not exists public.vehicle_work_hours_daily (
  "vehicleId" text not null references public.vehicles(id) on delete cascade,
  day         date not null,
  hours       numeric not null default 0,
  "distanceKm" numeric,
  "updatedAt" timestamptz not null default now(),
  primary key ("vehicleId", day)
);

revoke all on table public.vehicle_work_hours_daily from anon;
grant select on table public.vehicle_work_hours_daily to authenticated;
alter table public.vehicle_work_hours_daily enable row level security;
create policy "approved users read" on public.vehicle_work_hours_daily
  for select to authenticated using (is_approved());

-- Upsert daily rows from the sync. SECURITY DEFINER so the edge function
-- needs no service-role key; matches on the real rego or the Netstar alias.
-- rows: [{ rego, day: 'YYYY-MM-DD', hours, distance }]
create or replace function public.record_work_hours_daily(rows jsonb)
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
    select upper(btrim(x->>'rego'))               as rego,
           (x->>'day')::date                      as day,
           coalesce((x->>'hours')::numeric, 0)    as hours,
           nullif(x->>'distance','')::numeric     as distance
    from jsonb_array_elements(coalesce(rows, '[]'::jsonb)) as x
  loop
    if r.rego is null or r.day is null then continue; end if;
    select id into v_id from public.vehicles
      where upper(btrim(rego)) = r.rego or upper(btrim("netstarRego")) = r.rego
      limit 1;
    if v_id is null then continue; end if;

    insert into public.vehicle_work_hours_daily ("vehicleId", day, hours, "distanceKm", "updatedAt")
    values (v_id, r.day, r.hours, r.distance, now())
    on conflict ("vehicleId", day) do update
      set hours = excluded.hours,
          "distanceKm" = excluded."distanceKm",
          "updatedAt" = excluded."updatedAt";
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.record_work_hours_daily(jsonb) from public;
grant execute on function public.record_work_hours_daily(jsonb) to anon, authenticated;
