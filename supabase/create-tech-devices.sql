-- ==========================================================================
-- Technology register: create table and permissions
-- Run ONCE in the Supabase SQL Editor, AFTER create-employees.sql (devices
-- are assigned to employees). Safe to re-run.
--
-- Laptops, phones, tablets, field controllers, drones, site internet, etc.
-- "employeeId" links a device to the person who has it; if that employee is
-- removed, the device simply becomes unassigned (on delete set null).
-- No seed data — add devices through the app's "Add device" button.
-- ==========================================================================

BEGIN;

create table if not exists public.tech_devices (
  id               text primary key,
  type             text not null default 'Other',      -- Laptop, Phone, Tablet, ...
  make             text not null default '',           -- make / model
  "assetTag"       text not null default '',           -- your own label, e.g. IT-004
  serial           text not null default '',           -- serial number or IMEI
  "employeeId"     text references public.employees(id) on delete set null,
  mobile           text not null default '',           -- SIM number, for phones/tablets
  purchased        date,
  "warrantyEnds"   date,
  status           text not null default 'In use',     -- In use / Spare / In repair / Retired
  notes            text not null default ''
);

-- Device photo for its profile page: a small JPEG stored on the row, like the
-- vehicle and employee photos. Added after this file was first published —
-- re-running the whole file is safe.
alter table public.tech_devices add column if not exists photo text not null default '';

create index if not exists tech_devices_employee on public.tech_devices ("employeeId");

revoke all on table public.tech_devices from anon;
grant select, insert, update, delete on table public.tech_devices to authenticated;

alter table public.tech_devices enable row level security;

drop policy if exists "approved users full access" on public.tech_devices;
create policy "approved users full access" on public.tech_devices
  for all to authenticated using (is_approved()) with check (is_approved());

COMMIT;
