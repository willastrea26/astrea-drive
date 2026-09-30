BEGIN;

create table if not exists public.workshops (
  id       text primary key,
  name     text not null,
  address  text not null default '',
  category text not null default 'all',
  lat      double precision,
  lng      double precision
);

revoke all on table public.workshops from anon;
grant select, insert, update, delete on table public.workshops to authenticated;

alter table public.workshops enable row level security;

drop policy if exists "approved users full access" on public.workshops;
create policy "approved users full access" on public.workshops
  for all to authenticated using (is_approved()) with check (is_approved());

-- category: 'ute' (utes/cars/vans), 'heavy' (vac trucks/tippers), 'excavator', or 'all'.
-- wsp-nhvr has no fixed address ("Multiple locations" in the source register), so lat/lng are left null.
insert into public.workshops (id, name, address, category, lat, lng) values
  ('wsp-cityford',     'City Ford Ryde Service Centre',     '4 Hope Street, Melrose Park NSW 2114',                        'ute',       -33.815667,  151.068721),
  ('wsp-nsmitsubishi', 'North Shore Mitsubishi Ryde',        '603 Victoria Road, Ryde NSW 2112',                            'ute',       -33.8154497, 151.1009593),
  ('wsp-payless',      'Payless Tyres & Brakes Forestville', '702 Warringah Road, Forestville NSW 2087',                    'ute',       -33.7594097, 151.218886),
  ('wsp-stm',          'STM Trucks & Machinery',             '20-26 Dunn Road, Smeaton Grange NSW 2567',                    'excavator', -34.0321923, 150.752158),
  ('wsp-kor',          'KOR — Keep Operations Running',      'Unit 2, 98 Kurrajong Avenue, Mount Druitt NSW 2770',          'heavy',     -33.7661935, 150.8166027),
  ('wsp-vcv',          'VCV Sydney West',                    '9 Oatley Close, Blacktown NSW 2148',                          'heavy',     -33.8006737, 150.8998117),
  ('wsp-loyal',        'Loyal Truck Services',               '233-241 Cowpasture Road, Wetherill Park NSW 2164',            'heavy',     -33.8391972, 150.8805146),
  ('wsp-cityhino',     'City Hino — Arndell Park',           'Penelope Crescent & McCormack Street, Arndell Park NSW 2148', 'heavy',     -33.7900602, 150.8734948),
  ('wsp-gilbertroach', 'Gilbert and Roach',                  '8 Huntingwood Drive, Huntingwood NSW 2148',                   'heavy',     -33.7967234, 150.8874094),
  ('wsp-astreaheavy',  'Astrea Heavy Fleet (own workshop)',  '10B Tepco Road, Terrey Hills NSW 2084',                       'all',       -33.6829775, 151.2282964),
  ('wsp-nhvr',         'NHVR Heavy Vehicle Inspection',      'Multiple locations',                                          'heavy',     null,        null)
on conflict (id) do nothing;

COMMIT;
