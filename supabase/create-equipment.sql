-- ==========================================================================
-- Equipment register: create table and permissions
-- Run ONCE in the Supabase SQL Editor, AFTER create-employees.sql (items can
-- be assigned to employees). Safe to re-run.
--
-- General equipment that isn't a vehicle, power tool or IT device: survey
-- instruments, service locators, safety gear, traffic control, etc.
-- "employeeId" links an item to the person responsible for it; if that
-- employee is removed, the item simply becomes unassigned (on delete set null).
-- No seed data — add items through the app's "Add equipment" button.
-- ==========================================================================

BEGIN;

create table if not exists public.equipment (
  id                 text primary key,
  name               text not null,                      -- e.g. "GNSS rover"
  category           text not null default 'Other',      -- Surveying, Locating, Civil, ...
  make               text not null default '',           -- make / model
  "assetTag"         text not null default '',           -- your own label, e.g. SUR-01
  serial             text not null default '',
  location           text not null default '',           -- depot, site or vehicle
  "employeeId"       text references public.employees(id) on delete set null,
  status             text not null default 'In service', -- In service / Under repair / Out of service
  "lastInspection"   date,
  "nextInspection"   date,                               -- inspection or calibration due
  notes              text not null default '',
  photo              text not null default ''            -- small JPEG for the item's profile
);

create index if not exists equipment_employee on public.equipment ("employeeId");

revoke all on table public.equipment from anon;
grant select, insert, update, delete on table public.equipment to authenticated;

alter table public.equipment enable row level security;

drop policy if exists "approved users full access" on public.equipment;
create policy "approved users full access" on public.equipment
  for all to authenticated using (is_approved()) with check (is_approved());

COMMIT;
