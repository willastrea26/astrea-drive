-- =====================================================================
-- Astrea Drive — roll up the 30-day engine-hours total from daily rows
--
-- Run once in the Supabase SQL Editor. vehicle_work_hours (the single "X
-- hrs/week" figure on the vehicle profile) used to be recomputed from
-- whatever the sync had JUST fetched that run. That breaks once the sync
-- only pulls a few recent days at a time (to stay well under Netstar's rate
-- limit) — a light run would make the 30-day total look thinner than it
-- really is.
--
-- This rolls it up from vehicle_work_hours_daily instead, which keeps every
-- day's figure permanently once fetched. So the total is always correct for
-- whatever days we've ever collected, regardless of how much a given sync
-- run just pulled.
-- =====================================================================

create or replace function public.refresh_work_hours_totals()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  insert into public.vehicle_work_hours ("vehicleId", hours, "distanceKm", "windowDays", "updatedAt")
  select "vehicleId",
         round(sum(hours)::numeric, 2),
         sum("distanceKm")::integer,
         30,
         now()
  from public.vehicle_work_hours_daily
  where day >= (current_date - interval '29 days')::date
  group by "vehicleId"
  having sum(hours) > 0
  on conflict ("vehicleId") do update
    set hours        = excluded.hours,
        "distanceKm" = excluded."distanceKm",
        "windowDays" = excluded."windowDays",
        "updatedAt"  = excluded."updatedAt";
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.refresh_work_hours_totals() from public;
grant execute on function public.refresh_work_hours_totals() to anon, authenticated;
