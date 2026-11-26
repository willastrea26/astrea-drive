-- =====================================================================
-- Astrea Drive — move the Astrea Heavy Fleet workshop to Tepco Road
--
-- Run once in the Supabase SQL Editor. Safe to re-run.
--
-- The workshop was seeded at -33.6829775, 151.2282964, which is the middle
-- of Terrey Hills village (Booralie Road), about 470 m from the yard at
-- 10B Tepco Road. Its 150 m geofence therefore never contained a vehicle
-- parked at the workshop, so nothing was marked "In workshop".
--
-- The new point is AVT06's live GPS position (Netstar, ignition off) while
-- it was parked in the yard on 26 Nov 2026.
-- =====================================================================

update public.workshops
   set lat = -33.680776,
       lng = 151.223958
 where id = 'wsp-astreaheavy';

select id, name, address, lat, lng, "geofenceRadius", "geofenceEnabled"
  from public.workshops
 where id = 'wsp-astreaheavy';
