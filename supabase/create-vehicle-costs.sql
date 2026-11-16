-- Astrea Drive — individual vehicle costs (registration, insurance, tolls, etc.)
-- Run once in Supabase SQL Editor. Fuel-card imports remain in fuel_entries;
-- the vehicle Costs tab combines both tables with services and defect repairs.

create table if not exists public.vehicle_costs (
  id            text primary key,
  "vehicleId"   text not null references public.vehicles(id) on delete cascade,
  date          date not null,
  category      text not null,
  amount        numeric not null check (amount > 0),
  supplier      text not null default '',
  description   text not null default '',
  reference     text not null default '',
  "renewalDate" date,
  source        text not null default 'Manual',
  "createdAt"   timestamptz not null default now()
);

create index if not exists vehicle_costs_vehicle_idx on public.vehicle_costs ("vehicleId");
create index if not exists vehicle_costs_date_idx on public.vehicle_costs (date);

alter table public.vehicle_costs enable row level security;
revoke all on table public.vehicle_costs from anon;
grant select, insert, update, delete on table public.vehicle_costs to authenticated;

drop policy if exists "approved users read vehicle costs" on public.vehicle_costs;
drop policy if exists "approved users write vehicle costs" on public.vehicle_costs;
drop policy if exists "approved users update vehicle costs" on public.vehicle_costs;
drop policy if exists "approved users delete vehicle costs" on public.vehicle_costs;

create policy "approved users read vehicle costs" on public.vehicle_costs
  for select to authenticated using (is_approved());
create policy "approved users write vehicle costs" on public.vehicle_costs
  for insert to authenticated with check (is_approved());
create policy "approved users update vehicle costs" on public.vehicle_costs
  for update to authenticated using (is_approved()) with check (is_approved());
create policy "approved users delete vehicle costs" on public.vehicle_costs
  for delete to authenticated using (is_approved());
