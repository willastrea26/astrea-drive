-- =====================================================================
-- Astrea Drive — toll charges (Linkt statement import)
--
-- Run once in the Supabase SQL Editor (Dashboard > SQL Editor > New query
-- > paste > Run). Safe to re-run.
--
-- Holds every charge line from a Linkt "Detailed Statement" PDF: toll trips,
-- "No Tag in Vehicle" fees and account adjustments such as the M8/M5E truck
-- multiplier rebate (stored as a negative amount). Payments are not stored.
-- A stopgap until the Linkt API is available; the same table will serve it.
--
-- Every line is kept, including ones whose tag or plate doesn't match a fleet
-- vehicle yet, so the imported total always reconciles with the statement.
-- Which vehicle a line belongs to is worked out in the app from the plate or
-- the vehicle's Linkt tag number, so fixing a tag in the register later
-- re-attributes old trips without re-importing. "vehicleId" records the
-- match made at import time, for reference only.
--
-- `id` is deterministic (statement + line content + repeat number), so
-- re-importing the same statement updates instead of double-counting.
-- Approved users read and write it with their own sign-in (no service key).
-- =====================================================================

create table if not exists public.toll_entries (
  id             text primary key,
  "vehicleId"    text references public.vehicles(id) on delete set null,
  date           date not null,
  plate          text,            -- registration as printed (when Linkt shows a plate)
  state          text,
  tag            text,            -- tag number as printed (when Linkt shows the tag)
  class          text,            -- CAR / HCV / LCV / MOTORCYCLE
  "startTime"    text,
  "finishTime"   text,
  details        text,            -- e.g. "M7 Old Windsor Rd to M2 Motorway"
  road           text,            -- e.g. "Westlink M7"
  kind           text not null default 'trip',   -- trip | fee | adjustment
  amount         numeric not null default 0,     -- incl. GST; credits negative
  statement      text,            -- Linkt statement number
  "periodStart"  date,            -- statement period, for weekly/monthly rates
  "periodEnd"    date,
  source         text,
  "importedAt"   timestamptz not null default now()
);

create index if not exists toll_entries_date_idx on public.toll_entries (date);
create index if not exists toll_entries_statement_idx on public.toll_entries (statement);

alter table public.toll_entries enable row level security;
revoke all on table public.toll_entries from anon;
grant select, insert, update, delete on table public.toll_entries to authenticated;

drop policy if exists "approved users read tolls" on public.toll_entries;
create policy "approved users read tolls" on public.toll_entries
  for select to authenticated using (is_approved());
drop policy if exists "approved users write tolls" on public.toll_entries;
create policy "approved users write tolls" on public.toll_entries
  for insert to authenticated with check (is_approved());
drop policy if exists "approved users update tolls" on public.toll_entries;
create policy "approved users update tolls" on public.toll_entries
  for update to authenticated using (is_approved()) with check (is_approved());
drop policy if exists "approved users delete tolls" on public.toll_entries;
create policy "approved users delete tolls" on public.toll_entries
  for delete to authenticated using (is_approved());

-- Vehicles already have "linktTag" (update-fleet-details.sql); make sure it
-- exists on older databases. It may hold more than one tag, comma-separated.
alter table public.vehicles add column if not exists "linktTag" text;
