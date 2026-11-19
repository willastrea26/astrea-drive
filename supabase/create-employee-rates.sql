-- ==========================================================================
-- Employee rates (salary / hourly pay rate / charge-out rate) — RESTRICTED
-- Run ONCE in the Supabase SQL Editor, after create-employees.sql. Safe to re-run.
--
-- Pay is more sensitive than anything else in Astrea Drive, so unlike every
-- other table (open to all approved users), rates are readable and editable
-- ONLY by people on the rates_viewers list. Everyone else gets no rows back at
-- all — the numbers never reach their browser — and the app shows the Rates
-- tab as restricted.
--
-- After running this, give yourself (and anyone else who should see pay)
-- access — one line per person, using the email they sign in with:
--     insert into public.rates_viewers (email) values ('name@astrea.com.au');
-- To take access away again:
--     delete from public.rates_viewers where lower(email) = lower('name@astrea.com.au');
-- ==========================================================================

BEGIN;

-- 1. Who may see rates. Locked down completely (RLS on, no policies), like
--    approved_users: nobody can read it directly, only can_view_rates() can.
create table if not exists public.rates_viewers (
  email text primary key
);
alter table public.rates_viewers enable row level security;

-- 2. True only for an approved user whose email is on the rates list.
--    SECURITY DEFINER so it can read rates_viewers when nothing else can.
create or replace function public.can_view_rates()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select is_approved() and exists (
    select 1 from public.rates_viewers
    where lower(email) = lower(auth.jwt() ->> 'email')
  );
$$;
revoke all on function public.can_view_rates() from public;
grant execute on function public.can_view_rates() to authenticated;

-- 3. One row per employee (id = the employee's id).
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

revoke all on table public.employee_rates from anon;
grant select, insert, update, delete on table public.employee_rates to authenticated;

alter table public.employee_rates enable row level security;

drop policy if exists "rates viewers only" on public.employee_rates;
create policy "rates viewers only" on public.employee_rates
  for all to authenticated using (can_view_rates()) with check (can_view_rates());

COMMIT;
