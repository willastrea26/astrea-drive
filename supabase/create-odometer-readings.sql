-- =====================================================================
-- Astrea Drive — odometer reading history
--
-- Run once in the Supabase SQL Editor (Dashboard > SQL Editor > New query
-- > paste > Run). Stores one odometer snapshot per vehicle per day so the
-- app can measure distance driven over time (utilisation), independent of
-- service records. The odometer sync writes to it; approved users read it.
-- =====================================================================

create table if not exists public.odometer_readings (
  id          text primary key,
  "vehicleId" text not null references public.vehicles(id) on delete cascade,
  km          integer not null,
  "readDate"  date not null,
  at          timestamptz not null default now(),
  unique ("vehicleId", "readDate")
);

-- Fast lookups of a vehicle's recent readings.
create index if not exists odometer_readings_vehicle_date
  on public.odometer_readings ("vehicleId", "readDate");

-- Reads: approved users only. Writes come through the SECURITY DEFINER sync
-- function (its owner bypasses RLS), so no insert policy is granted here.
revoke all on table public.odometer_readings from anon;
grant select on table public.odometer_readings to authenticated;
alter table public.odometer_readings enable row level security;
create policy "approved users read" on public.odometer_readings
  for select to authenticated using (is_approved());
