-- ==========================================================================
-- Employee rates (salary / hourly pay rate / charge-out rate)
-- Run ONCE in the Supabase SQL Editor, after create-employees.sql. Safe to re-run.
--
-- CURRENTLY OPEN: every approved Astrea Drive user can see and edit rates,
-- the same as the other registers. This is deliberate while the app is still
-- being set up.
--
-- BEFORE THE APP GOES OUT TO ALL EMPLOYEES, run lock-employee-rates.sql.
-- That restricts rates to a short list of named people; everyone else then
-- gets no rows back at all and the app shows the Rates tab as restricted.
-- No app changes are needed — the app asks the database (can_view_rates)
-- whether the signed-in user may see rates.
-- ==========================================================================

BEGIN;

-- 1. Who may see rates. For now: any approved user.
--    lock-employee-rates.sql replaces this with a named list.
create or replace function public.can_view_rates()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select is_approved();
$$;
revoke all on function public.can_view_rates() from public;
grant execute on function public.can_view_rates() to authenticated;

-- 2. One row per employee (id = the employee's id).
create table if not exists public.employee_rates (
  id               text primary key,
  "employeeId"     text not null unique references public.employees(id) on delete cascade,
  "payType"        text not null default 'Salary',   -- Salary / Hourly
  "annualSalary"   numeric,
  "hourlyRate"     numeric,                          -- pay rate per hour
  "chargeOutRate"  numeric,                          -- charged to clients per hour
  "superPercent"   numeric,
  "effectiveFrom"  date,
  notes            text not null default '',
  "updatedAt"      timestamptz,
  "updatedBy"      text not null default ''
);

-- Night / Saturday / Sunday / public-holiday rates, added later (re-running
-- this file is safe). One entry per shift, e.g.
--   {"night": {"charge": 150, "payX": 1.25}, "sunday": {"charge": 220, "payX": 2}}
-- charge = charge-out $ per hour; payX = pay multiplier (blank = same as day).
alter table public.employee_rates add column if not exists "shiftRates" jsonb not null default '{}'::jsonb;

revoke all on table public.employee_rates from anon;
grant select, insert, update, delete on table public.employee_rates to authenticated;

alter table public.employee_rates enable row level security;

-- The policy always goes through can_view_rates(), so locking later only
-- means changing that function — this policy stays as it is.
drop policy if exists "rates viewers only" on public.employee_rates;
create policy "rates viewers only" on public.employee_rates
  for all to authenticated using (can_view_rates()) with check (can_view_rates());

COMMIT;
