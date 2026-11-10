-- =====================================================================
-- Astrea Drive — telematics work hours
--
-- Run once in the Supabase SQL Editor. Stores each vehicle's engine work
-- hours (and distance) over a recent window, pulled from Netstar's
-- workhour-report. The sync refreshes it; approved users read it. This is
-- how utilisation can be measured in HOURS (not just distance) — the right
-- measure for vac trucks that work stationary.
-- =====================================================================

create table if not exists public.vehicle_work_hours (
  "vehicleId"  text primary key references public.vehicles(id) on delete cascade,
  hours        numeric not null default 0,
  "distanceKm" integer,
  "windowDays" integer not null default 30,
  "updatedAt"  timestamptz not null default now()
);

revoke all on table public.vehicle_work_hours from anon;
grant select on table public.vehicle_work_hours to authenticated;
alter table public.vehicle_work_hours enable row level security;
create policy "approved users read" on public.vehicle_work_hours
  for select to authenticated using (is_approved());

-- Upsert work hours from the sync. SECURITY DEFINER so the edge function
-- needs no service-role key; matches on the real rego or the Netstar alias.
create or replace function public.record_work_hours(rows jsonb)
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
    select upper(btrim(x->>'rego'))        as rego,
           (x->>'hours')::numeric          as hours,
           nullif(x->>'distance','')::integer as distance,
           coalesce((x->>'days')::integer, 30) as days
    from jsonb_array_elements(coalesce(rows, '[]'::jsonb)) as x
  loop
    if r.rego is null then continue; end if;
    select id into v_id from public.vehicles
      where upper(btrim(rego)) = r.rego or upper(btrim("netstarRego")) = r.rego
      limit 1;
    if v_id is null then continue; end if;

    insert into public.vehicle_work_hours ("vehicleId", hours, "distanceKm", "windowDays", "updatedAt")
    values (v_id, coalesce(r.hours, 0), r.distance, r.days, now())
    on conflict ("vehicleId") do update
      set hours = excluded.hours,
          "distanceKm" = excluded."distanceKm",
          "windowDays" = excluded."windowDays",
          "updatedAt" = excluded."updatedAt";
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.record_work_hours(jsonb) from public;
grant execute on function public.record_work_hours(jsonb) to anon, authenticated;
