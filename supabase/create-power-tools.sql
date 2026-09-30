-- ==========================================================================
-- Power & Motor Tools: create table, permissions and seed data
-- Run this in the Supabase SQL Editor (after schema.sql)
-- ==========================================================================

BEGIN;

create table if not exists public.power_tools (
  id                  text primary key,
  type                text not null,
  make                text not null default '',
  serial              text not null default '',
  location            text not null default '',
  responsible         text not null default '',
  "serviceInterval"   text not null default '',
  "lastService"       date,
  "nextService"       date
);

revoke all on table public.power_tools from anon;
grant select, insert, update, delete on table public.power_tools to authenticated;

alter table public.power_tools enable row level security;

drop policy if exists "approved users full access" on public.power_tools;
create policy "approved users full access" on public.power_tools
  for all to authenticated using (is_approved()) with check (is_approved());

-- Seed the 12 tools from the "Power motor tools" sheet. Make/serial/dates
-- are left blank — fill them in via the app's Edit button.
insert into public.power_tools (id, type, "serviceInterval", location, responsible) values
  ('DEMO1', 'Demo Saw',     '3 months or 100 hrs', 'Various sites', 'Dale or Beggs'),
  ('DEMO2', 'Demo Saw',     '3 months or 100 hrs', 'Various sites', 'Dale or Beggs'),
  ('DEMO3', 'Demo Saw',     '3 months or 100 hrs', 'Various sites', 'Dale or Beggs'),
  ('VIBE1', 'Vibe Plate',   '3 months or 100 hrs', 'Various sites', 'Dale or Beggs'),
  ('VIBE2', 'Vibe Plate',   '3 months or 100 hrs', 'Various sites', 'Dale or Beggs'),
  ('VIBE3', 'Vibe Plate',   '3 months or 100 hrs', 'Various sites', 'Dale or Beggs'),
  ('JACK1', 'Jumping Jack', '3 months or 100 hrs', 'Various sites', 'Dale or Beggs'),
  ('JACK2', 'Jumping Jack', '3 months or 100 hrs', 'Various sites', 'Dale or Beggs'),
  ('JACK3', 'Jumping Jack', '3 months or 100 hrs', 'Various sites', 'Dale or Beggs'),
  ('GEN1',  'Generator',    '3 months or 200 hrs', 'Various sites', 'Dale or Beggs'),
  ('GEN2',  'Generator',    '3 months or 200 hrs', 'Various sites', 'Dale or Beggs'),
  ('GEN3',  'Generator',    '3 months or 200 hrs', 'Various sites', 'Dale or Beggs')
on conflict (id) do nothing;

COMMIT;
