-- =====================================================================
-- Astrea Drive — fuel-card entries (manual import)
--
-- Run once in the Supabase SQL Editor. Holds fuel-card transactions
-- imported from a WEX / BP / Ampol spreadsheet, matched to a vehicle by
-- rego. A stopgap until the WEX/BP API is wired up; the same table will
-- serve the API later.
--
-- One row per transaction. `id` is deterministic, so re-importing the same
-- source upserts instead of double-counting. Existing WEX spreadsheets retain
-- their legacy rego/date/cost/litres/product identity. BP imports use card +
-- date + receipt, shared with the future BP API, so API backfill replaces the
-- temporary PDF row rather than adding a second transaction.
-- Approved users read and write it with their own sign-in (no service key).
-- =====================================================================

create table if not exists public.fuel_entries (
  id          text primary key,
  "vehicleId" text not null references public.vehicles(id) on delete cascade,
  rego        text,
  date        date,
  litres      numeric,
  cost        numeric not null default 0,
  product     text,
  brand       text,
  docket      text,
  source      text,
  "importedAt" timestamptz not null default now()
);

create index if not exists fuel_entries_vehicle_idx on public.fuel_entries ("vehicleId");
create index if not exists fuel_entries_date_idx on public.fuel_entries (date);

alter table public.fuel_entries enable row level security;
revoke all on table public.fuel_entries from anon;
grant select, insert, update, delete on table public.fuel_entries to authenticated;

create policy "approved users read fuel" on public.fuel_entries
  for select to authenticated using (is_approved());
create policy "approved users write fuel" on public.fuel_entries
  for insert to authenticated with check (is_approved());
create policy "approved users update fuel" on public.fuel_entries
  for update to authenticated using (is_approved()) with check (is_approved());
create policy "approved users delete fuel" on public.fuel_entries
  for delete to authenticated using (is_approved());
