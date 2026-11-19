-- ==========================================================================
-- LOCK employee rates to a named list of people
-- Run this in the Supabase SQL Editor BEFORE Astrea Drive is given out to all
-- employees. Safe to re-run. (Needs create-employee-rates.sql run first.)
--
-- After this, only people on the rates_viewers list can see or edit pay and
-- charge-out rates. Everyone else gets no rows back at all — the numbers
-- never reach their browser — and the app shows the Rates tab as restricted.
--
-- Fill in the emails in step 3 (the address each person signs in with)
-- before running, or nobody will be able to see rates.
--
-- Later, to add someone:
--     insert into public.rates_viewers (email) values ('name@astrea.com.au');
-- To take access away:
--     delete from public.rates_viewers where lower(email) = lower('name@astrea.com.au');
--
-- To UNLOCK again (every approved user can see rates), re-run
-- create-employee-rates.sql.
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

-- 3. The people who may see rates — edit before running, one line each.
insert into public.rates_viewers (email) values
  ('name@astrea.com.au')
on conflict (email) do nothing;

COMMIT;
