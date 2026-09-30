-- =====================================================================
-- Astrea Drive — fleet data import
--
-- Run in Supabase SQL Editor (Dashboard > SQL Editor > New query > paste > Run)
-- This inserts 44 drivers and 63 vehicles from the Astrea fleet register.
-- Existing records with the same ID are skipped (ON CONFLICT DO NOTHING).
-- =====================================================================

-- 1. Drivers
INSERT INTO public.drivers (id, name) VALUES
  ('d-001', 'James Burns'),
  ('d-002', 'Kent'),
  ('d-003', 'James Gulliford'),
  ('d-004', 'Aleksandra Nowicka'),
  ('d-005', 'Sebastion Piukla'),
  ('d-006', 'Kulani'),
  ('d-007', 'Meads Cleaner'),
  ('d-008', 'Jake Jones'),
  ('d-009', 'Alan'),
  ('d-010', 'Rose Kaur'),
  ('d-011', 'Dean Penfold'),
  ('d-012', 'James Lynch'),
  ('d-013', 'Zac Hallinan'),
  ('d-014', 'Dale Mawhinney'),
  ('d-015', 'Ben Deveridge'),
  ('d-016', 'Cahal Murphy'),
  ('d-017', 'Josh Payne'),
  ('d-018', 'Will Hamilton'),
  ('d-019', 'Grant Brodie'),
  ('d-020', 'Richard Barrett'),
  ('d-021', 'Tom Haysler'),
  ('d-022', 'Will Woodhouse'),
  ('d-023', 'Isabella Charon'),
  ('d-024', 'Kieran O''Loan'),
  ('d-025', 'Luke Bramble'),
  ('d-026', 'Jordan Woodhouse'),
  ('d-027', 'James Dimaculangan'),
  ('d-028', 'Stacey Mead'),
  ('d-029', 'Kurt Farrugia'),
  ('d-030', 'Ben Leach'),
  ('d-031', 'William Imseis'),
  ('d-032', 'Edyta Krynicka'),
  ('d-033', 'Christopher Atienza'),
  ('d-034', 'Jacob Deveridge'),
  ('d-035', 'Laurence Mead'),
  ('d-036', 'Jeric Ong'),
  ('d-037', 'Michael Beggs'),
  ('d-038', 'Ben Clews'),
  ('d-039', 'Adam Criscione'),
  ('d-040', 'Rowan Turner'),
  ('d-041', 'Scott Deveridge'),
  ('d-042', 'James Gapps'),
  ('d-043', 'Ben Whitfield'),
  ('d-044', 'Ben Ryder Bourke')
ON CONFLICT (id) DO NOTHING;

-- 2. Vehicles — light fleet (ALV01–ALV47)
INSERT INTO public.vehicles
  (id, rego, make, model, type, "driverId", "regoExpiry", "lastServiceDate", "nextServiceDate", notes)
VALUES
  ('ALV01', 'DI44DT',  'Isuzu',       'NLR Series',         'Tipper truck', '',      '2026-07-14', '2026-05-18', '2026-11-15', '2T tipper · Car Kit'),
  ('ALV02', 'YJH29K',  'Ford',        'Ranger',             'Ute',          '',      '2026-11-15', '2026-05-18', '2026-11-15', 'Spare · Car Kit'),
  ('ALV03', 'YJH29L',  'Ford',        'Ranger',             'Ute',          'd-001', '2026-11-15', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV04', 'YKN55F',  'Ford',        'Ranger',             'Ute',          'd-002', '2027-05-15', '2026-05-18', '2026-11-15', 'Mechanic · Car Kit'),
  ('ALV05', 'EMC80B',  'Ford',        'Ranger',             'Ute',          'd-003', '2027-05-15', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV06', 'EMC80J',  'Ford',        'Ranger',             'Ute',          'd-004', '2026-11-15', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV07', 'EMC82K',  'Ford',        'Ranger',             'Ute',          'd-005', '2026-11-15', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV08', 'EMC85F',  'Ford',        'Ranger',             'Ute',          'd-006', '2027-05-15', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV09', 'EMC88M',  'Ford',        'Ranger',             'Ute',          'd-007', '2027-05-15', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV10', 'EMC90Q',  'Ford',        'Ranger',             'Ute',          'd-008', '2026-10-27', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV11', 'ESG92H',  'Mitsubishi',  'Triton',             'Ute',          'd-009', '2027-02-27', '2026-05-18', '2026-11-15', 'Mechanic · Car Kit'),
  ('ALV12', 'ESG92L',  'Mitsubishi',  'Triton',             'Ute',          'd-010', '2027-02-28', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV13', 'EUK85W',  'Ford',        'Ranger',             'Ute',          'd-011', '2026-08-03', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV14', 'ERE76U',  'Ford',        'Ranger',             'Ute',          'd-012', '2026-09-18', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV15', 'EUU85D',  'Mitsubishi',  'Triton',             'Ute',          'd-013', '2026-08-03', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV16', 'FBU25E',  'Ford',        'Ranger',             'Ute',          'd-014', '2026-08-06', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV17', 'EYG23N',  'Ford',        'Ranger',             'Ute',          'd-015', '2027-05-30', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV18', 'EYT29U',  'Mitsubishi',  'Triton',             'Ute',          'd-016', '2027-05-23', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV19', 'EXK70X',  'Ford',        'Ranger',             'Ute',          'd-017', '2026-06-21', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV20', 'YMH37J',  'Mitsubishi',  'Triton',             'Ute',          'd-018', '2026-07-20', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV21', 'FEL32Q',  'Ford',        'Ranger',             'Ute',          'd-019', '2026-11-27', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV22', 'FEV80Z',  'Ford',        'Ranger',             'Ute',          'd-020', '2027-03-07', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV23', 'FGQ22Q',  'Ford',        'Ranger',             'Ute',          'd-021', '2027-04-28', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV24', 'FGQ22R',  'Ford',        'Ranger',             'Ute',          '',      '2027-04-28', '2026-05-18', '2026-11-15', 'Spare · Car Kit'),
  ('ALV25', 'FFE14H',  'Ford',        'Ranger',             'Ute',          'd-022', '2027-02-23', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV26', 'FFD51M',  'Volkswagen',  'Touareg',            'Car',          'd-023', '2027-02-14', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV27', 'FHI19X',  'Ford',        'Ranger',             'Ute',          'd-024', '2026-06-25', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV28', 'EUN68Q',  'Land Rover',  'Range Rover Velar',  'Car',          'd-025', '2026-08-02', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV29', 'FJT59P',  'Ford',        'Transit Custom',     'Van',          '',      '2026-08-11', '2026-05-18', '2026-11-15', 'Civil Team / Reinstatement · Car Kit'),
  ('ALV30', 'FLK55Z',  'Ford',        'Ranger',             'Ute',          'd-026', '2026-09-12', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV31', 'FLK64B',  'Ford',        'Ranger',             'Ute',          'd-027', '2026-10-01', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV32', 'FFI44H',  'BMW',         'X5',                 'Car',          'd-028', '2027-01-29', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV33', 'FOE86M',  'Ford',        'Ranger',             'Ute',          'd-029', '2027-02-27', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV34', 'FPM53E',  'BYD',         'Atto 3',             'Car',          'd-030', '2027-04-28', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV35', 'FRO96S',  'Ford',        'Ranger',             'Ute',          'd-031', '2027-06-23', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV36', 'FSJ30M',  'BYD',         'Shark',              'Ute',          'd-032', '2026-09-24', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV37', 'FTS23G',  'Ford',        'Ranger',             'Ute',          'd-033', '2026-09-28', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV38', 'FTS23H',  'Ford',        'Ranger',             'Ute',          'd-034', '2026-09-28', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV39', 'NCN48G',  'Audi',        'Q7',                 'Car',          'd-035', '2026-10-27', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV40', 'FZL05Q',  'Volkswagen',  'Amarok',             'Ute',          'd-036', '2027-03-18', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV41', 'FZL37E',  'Ford',        'Ranger',             'Ute',          'd-037', '2027-03-02', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV42', 'FSE35K',  'Ford',        'Ranger',             'Ute',          'd-038', '2026-07-07', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV43', 'GBC35S',  'Ford',        'Ranger',             'Ute',          'd-039', '2027-05-12', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV44', 'GBP16W',  'Ford',        'Ranger',             'Ute',          'd-040', '2027-05-24', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV45', 'GDS30C',  'BYD',         'Atto 3',             'Car',          'd-041', '2027-06-22', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV46', 'GCM06E',  'Ford',        'Ranger',             'Ute',          'd-042', '2027-06-28', '2026-05-18', '2026-11-15', 'Car Kit'),
  ('ALV47', 'GCM06F',  'Ford',        'Ranger',             'Ute',          'd-043', '2027-06-28', '2026-05-18', '2026-11-15', 'Car Kit')
ON CONFLICT (id) DO NOTHING;

-- 3. Vehicles — vac trucks (AVT01–AVT08)
INSERT INTO public.vehicles
  (id, rego, make, model, type, "regoExpiry", "lastServiceDate", "nextServiceDate", notes)
VALUES
  ('AVT01', 'XO78XL', 'Volvo',  'FE08A',  'Vac truck', '2026-12-05', '2026-05-18', '2026-11-15', '26T · Truck Kit'),
  ('AVT02', 'XO53YD', 'Volvo',  'FE08A',  'Vac truck', '2027-02-05', '2026-05-18', '2026-11-15', '26T · Truck Kit'),
  ('AVT03', 'XW52IY', 'Volvo',  'FE08A',  'Vac truck', '2027-02-06', '2026-05-18', '2026-11-15', '26T · Truck Kit'),
  ('AVT04', 'XP27DS', 'Isuzu',  'FH FYH', 'Vac truck', '2027-02-14', '2026-05-18', '2026-11-15', '30T · Truck Kit'),
  ('AVT05', 'XP58JN', 'Volvo',  'FE3A24', 'Vac truck', '2027-06-29', '2026-05-18', '2026-11-15', '26T · Truck Kit'),
  ('AVT06', 'XS34KN', 'Scania', 'P320',   'Vac truck', '2027-01-15', '2026-05-18', '2026-11-15', '26T · Truck Kit · SA registration'),
  ('AVT07', 'XP69PN', 'Volvo',  'FE3A24', 'Vac truck', '2027-05-14', '2026-05-18', '2026-11-15', '26T · Truck Kit'),
  ('AVT08', 'XP26QU', 'Volvo',  'FE3A24', 'Vac truck', '2027-06-28', '2026-05-18', '2026-11-15', '26T · Truck Kit')
ON CONFLICT (id) DO NOTHING;

-- 4. Vehicles — excavators (AEX01–AEX03)
INSERT INTO public.vehicles
  (id, rego, make, model, type, "regoExpiry", "lastServiceDate", "nextServiceDate", notes)
VALUES
  ('AEX01', '61634E', 'Kobelco', 'SK55SRX-6', 'Excavator', '2027-04-17', '2026-05-18', '2026-11-15', '5T · Truck Kit'),
  ('AEX02', '65408E', 'Kobelco', 'SK17SR-6',  'Excavator', '2026-09-26', '2026-05-18', '2026-11-15', '1.7T · Truck Kit'),
  ('AEX03', '78582E', 'Kobelco', 'SK303R',    'Excavator', '2027-04-29', '2026-05-18', '2026-11-15', '3.5T · Truck Kit')
ON CONFLICT (id) DO NOTHING;

-- 5. Vehicles — heavy tippers (AHV01–AHV02)
INSERT INTO public.vehicles
  (id, rego, make, model, type, "regoExpiry", "lastServiceDate", "nextServiceDate", notes)
VALUES
  ('AHV01', 'XO29ZS', 'Isuzu', 'FSR140', 'Tipper truck', '2027-05-01', '2026-05-18', '2026-11-15', '8T · Truck Kit'),
  ('AHV02', 'XP99DH', 'Hino',  'FE1426', 'Tipper truck', '2026-10-13', '2026-05-18', '2026-11-15', '8T · Truck Kit')
ON CONFLICT (id) DO NOTHING;

-- 6. Vehicles — trailers (ATR01–ATR02)
-- No service/odometer tracking on the source sheet (marked N/A), so these get a
-- far-future nextServiceKm — the app's date math requires non-null values on
-- every vehicle, and a null here breaks dashboard/fleet rendering entirely.
INSERT INTO public.vehicles
  (id, rego, make, model, type, "regoExpiry", "lastServiceDate", "nextServiceDate", "nextServiceKm", notes)
VALUES
  ('ATR01', 'TN76CH', 'Sureweld', 'Trailer', 'Trailer', '2025-09-02', '2026-05-18', '2026-11-15', 999999, 'Carries Kobelco 1.7T (AEX02)'),
  ('ATR02', 'TP46QN', 'Sureweld', 'Trailer', 'Trailer', '2027-06-04', '2026-05-18', '2026-11-15', 999999, 'Carries Kobelco 3.5T (AEX03)')
ON CONFLICT (id) DO NOTHING;

-- 7. Vehicles — own vehicle (APV01)
-- Rego expiry was blank on the source sheet — placeholder date below, update
-- via the app once the real expiry is known (must not be null, see note above).
INSERT INTO public.vehicles
  (id, rego, make, model, type, "driverId", "regoExpiry", "lastServiceDate", "nextServiceDate", notes)
VALUES
  ('APV01', 'CY29QY', 'Toyota', 'Hilux', 'Ute', 'd-044', '2027-05-18', '2026-05-18', '2026-11-15', 'Own vehicle — Ben Ryder Bourke — rego expiry unconfirmed')
ON CONFLICT (id) DO NOTHING;

-- 8. Activity log entry
INSERT INTO public.activity (id, ts, "vehicleId", text) VALUES
  ('imp-001', now(), '', 'Fleet register imported: 44 drivers, 63 vehicles')
ON CONFLICT (id) DO NOTHING;
