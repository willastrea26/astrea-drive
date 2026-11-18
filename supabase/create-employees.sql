-- ==========================================================================
-- Employee register: create table and permissions
-- Run this ONCE in the Supabase SQL Editor (after schema.sql). Safe to re-run.
--
-- Holds personal details (date of birth, home address), so like every other
-- table it is readable only by approved Astrea Drive users. No rows here —
-- staff data is never committed to the repository. It is loaded separately
-- from the HR export, or added through the app's "Add employee" button.
-- ==========================================================================

BEGIN;

create table if not exists public.employees (
  id                  text primary key,
  name                text not null,
  "licencesApplied"   text not null default '',   -- Full / Mobility
  position            text not null default '',
  mobile              text not null default '',
  email               text not null default '',
  "dateOfBirth"       date,
  "startDate"         date,                        -- date of commencement
  address             text not null default '',
  suburb              text not null default '',
  state               text not null default '',
  postcode            text not null default '',
  "licenceRegister"   text not null default ''     -- comma-separated licences and tickets
);

revoke all on table public.employees from anon;
grant select, insert, update, delete on table public.employees to authenticated;

alter table public.employees enable row level security;

drop policy if exists "approved users full access" on public.employees;
create policy "approved users full access" on public.employees
  for all to authenticated using (is_approved()) with check (is_approved());

COMMIT;
