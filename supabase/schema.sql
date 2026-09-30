-- =====================================================================
-- Astrea Drive — schema, permissions and RLS
--
-- Run this ONCE, in full, top to bottom:
--   Supabase dashboard → SQL Editor → New query → paste this whole file → Run
--
-- Column names match the app's JS field names exactly (quoted where
-- camelCase, e.g. "driverId"), so the client code needs no translation
-- layer between what's in the browser and what's in the database.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Approved-user allowlist.
--    Locked down completely — no grants, no policies — so nobody can
--    query it directly, even once logged in. Only is_approved() below
--    can read it (see the SECURITY DEFINER note there).
-- ---------------------------------------------------------------------
create table public.approved_users (
  email text primary key
);

insert into public.approved_users (email) values
  ('estimating@astrea.com.au');
  -- To add someone later, run this in the SQL Editor:
  --   insert into public.approved_users (email) values ('name@astrea.com.au');

alter table public.approved_users enable row level security;
-- (RLS on, zero policies -> every direct client request is denied)

-- ---------------------------------------------------------------------
-- 2. is_approved(): true if the signed-in user's email is on the list.
--    SECURITY DEFINER means it runs as its owner (you, via the SQL
--    Editor), which is how it can read approved_users when nothing
--    else can. Every policy below calls this one function, so adding
--    a user later only ever means one INSERT — no policies to touch.
-- ---------------------------------------------------------------------
create or replace function public.is_approved()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.approved_users
    where email = auth.jwt() ->> 'email'
  );
$$;

-- ---------------------------------------------------------------------
-- 3. Data tables — one per AD.store collection.
--    FKs are only added where the app always sets a real id (never '');
--    driverId/siteId are left as plain text because the app uses ''
--    to mean "unassigned", which a foreign key can't express.
-- ---------------------------------------------------------------------

create table public.drivers (
  id   text primary key,
  name text not null
);

create table public.sites (
  id        text primary key,
  name      text not null,
  address   text not null,
  state     text not null default '',
  lat       double precision,
  lng       double precision,
  "isDepot" boolean not null default false
);

create table public.vehicles (
  id                      text primary key,
  rego                    text not null,
  make                    text not null,
  model                   text not null,
  year                    integer,
  type                    text not null,
  "driverId"              text not null default '',
  odometer                integer not null default 0,
  status                  text not null default 'Available',
  "regoExpiry"            date,
  "lastServiceDate"       date,
  "lastServiceKm"         integer,
  "nextServiceDate"       date,
  "nextServiceKm"         integer,
  "serviceIntervalKm"     integer not null default 10000,
  "serviceIntervalMonths" integer not null default 6,
  notes                   text not null default '',
  photo                   text
);

create table public.bookings (
  id               text primary key,
  kind             text not null default 'job',
  status           text not null default 'confirmed',
  "truckId"        text not null references public.vehicles(id) on delete cascade,
  "driverId"       text not null default '',
  "jobName"        text not null default '',
  "jobNumber"      text not null default '',
  client           text not null default '',
  "siteId"         text not null default '',
  address          text not null default '',
  lat              double precision,
  lng              double precision,
  "locationSource" text not null default 'none',
  "start"          timestamptz not null,
  "end"            timestamptz not null,
  notes            text not null default ''
);

create table public.services (
  id          text primary key,
  "vehicleId" text not null references public.vehicles(id) on delete cascade,
  date        date not null,
  odometer    integer not null,
  type        text not null default '',
  workshop    text not null default '',
  cost        numeric not null default 0,
  notes       text not null default ''
);

create table public.defects (
  id                text primary key,
  "vehicleId"       text not null references public.vehicles(id) on delete cascade,
  "reportedDate"    date not null,
  "reportedBy"      text not null default '',
  description       text not null,
  priority          text not null default 'Medium',
  status            text not null default 'Open',
  "resolvedDate"    date,
  "resolutionNotes" text not null default ''
);

create table public.documents (
  id          text primary key,
  "vehicleId" text not null references public.vehicles(id) on delete cascade,
  name        text not null,
  category    text not null default '',
  placeholder boolean not null default true
);

create table public.activity (
  id          text primary key,
  ts          timestamptz not null default now(),
  "vehicleId" text not null default '',
  text        text not null
);

-- ---------------------------------------------------------------------
-- 4. Permissions: anon (unauthenticated) gets nothing at all. Logged-in
--    users get table-level grants, then RLS narrows that down further
--    to "only if your email is on the approved list".
-- ---------------------------------------------------------------------
revoke all on table
  public.drivers, public.sites, public.vehicles, public.bookings,
  public.services, public.defects, public.documents, public.activity
  from anon;

grant select, insert, update, delete on table
  public.drivers, public.sites, public.vehicles, public.bookings,
  public.services, public.defects, public.documents, public.activity
  to authenticated;

alter table public.drivers   enable row level security;
alter table public.sites     enable row level security;
alter table public.vehicles  enable row level security;
alter table public.bookings  enable row level security;
alter table public.services  enable row level security;
alter table public.defects   enable row level security;
alter table public.documents enable row level security;
alter table public.activity  enable row level security;

create policy "approved users full access" on public.drivers
  for all to authenticated using (is_approved()) with check (is_approved());
create policy "approved users full access" on public.sites
  for all to authenticated using (is_approved()) with check (is_approved());
create policy "approved users full access" on public.vehicles
  for all to authenticated using (is_approved()) with check (is_approved());
create policy "approved users full access" on public.bookings
  for all to authenticated using (is_approved()) with check (is_approved());
create policy "approved users full access" on public.services
  for all to authenticated using (is_approved()) with check (is_approved());
create policy "approved users full access" on public.defects
  for all to authenticated using (is_approved()) with check (is_approved());
create policy "approved users full access" on public.documents
  for all to authenticated using (is_approved()) with check (is_approved());
create policy "approved users full access" on public.activity
  for all to authenticated using (is_approved()) with check (is_approved());

-- ---------------------------------------------------------------------
-- 5. Sanity check — run this separately afterwards to confirm all
--    9 tables exist (8 data tables + approved_users).
-- ---------------------------------------------------------------------
-- select table_name from information_schema.tables
--   where table_schema = 'public' order by table_name;
