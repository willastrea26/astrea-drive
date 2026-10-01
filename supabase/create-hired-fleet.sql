BEGIN;

-- Mark a vehicle as hired (not owned) and track the hire company.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS hired         boolean NOT NULL DEFAULT false;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS "hireCompany" text    NOT NULL DEFAULT '';

-- Hired fleet seed. IDs are prefixed H- so they can't clash with owned-fleet
-- codes. Placeholders used for rego/service dates where unknown; fill in via
-- the Edit button on each vehicle's page.
INSERT INTO vehicles (
  id, rego, make, model, type, hired, "hireCompany",
  status, odometer, "regoExpiry", "nextServiceDate", "nextServiceKm",
  "serviceIntervalKm", "serviceIntervalMonths", notes
) VALUES
  ('H-18276E', '18276E', '',            '1.7t Excavator',                        'Excavator',    true, 'AMCG',                     'In use', 0, '2027-01-01', '2027-04-01', 10000, 10000, 6, ''),
  ('H-DD15RJ', 'DD15RJ', '',            '2t Tipper',                             'Tipper truck', true, 'AMCG',                     'In use', 0, '2027-01-01', '2027-04-01', 10000, 10000, 6, ''),
  ('H-XO72EP', 'XO72EP', 'Isuzu',       'Tipper',                                'Tipper truck', true, 'AMCG',                     'In use', 0, '2027-01-01', '2027-04-01', 10000, 10000, 6, ''),
  ('H-DTS003', 'DTS003', '',            'CCTV Unit with Tractor and Rod Camera', 'Other',        true, 'Draintech Solutions',      'In use', 0, '2027-01-01', '2027-04-01', 10000, 10000, 6, ''),
  ('H-DTS010', 'DTS010', 'Cappellotto', 'JetVac Recycler Unit',                  'Vac truck',    true, 'Draintech Solutions',      'In use', 0, '2027-01-01', '2027-04-01', 10000, 10000, 6, 'Also marked XN37ZF'),
  ('H-DTS011', 'DTS011', 'Hino',        '300 Medium Jetter Unit',                'Vac truck',    true, 'Draintech Solutions',      'In use', 0, '2027-01-01', '2027-04-01', 10000, 10000, 6, ''),
  ('H-DTS024', 'DTS024', 'Cappellotto', 'JetVac Recycler Unit',                  'Vac truck',    true, 'Draintech Solutions',      'In use', 0, '2027-01-01', '2027-04-01', 10000, 10000, 6, ''),
  ('H-DTS025', 'DTS025', '',            'CCTV Unit with Tractor and Rod Camera', 'Other',        true, 'Draintech Solutions',      'In use', 0, '2027-01-01', '2027-04-01', 10000, 10000, 6, ''),
  ('H-DTS040', 'DTS040', 'Kroll',       'JetVac Combination Unit',               'Vac truck',    true, 'Draintech Solutions',      'In use', 0, '2027-01-01', '2027-04-01', 10000, 10000, 6, ''),
  ('H-CO52FO', 'CO52FO', '',            '',                                      'Vac truck',    true, 'Linbeck',                  'In use', 0, '2027-01-01', '2027-04-01', 10000, 10000, 6, ''),
  ('H-XO08HM', 'XO08HM', '',            '',                                      'Vac truck',    true, 'Linbeck',                  'In use', 0, '2027-01-01', '2027-04-01', 10000, 10000, 6, ''),
  ('H-XO10IM', 'XO10IM', 'Cappellotto', '',                                      'Vac truck',    true, 'Linbeck',                  'In use', 0, '2027-01-01', '2027-04-01', 10000, 10000, 6, ''),
  ('H-XO60KM', 'XO60KM', '',            '',                                      'Vac truck',    true, 'Linbeck',                  'In use', 0, '2027-01-01', '2027-04-01', 10000, 10000, 6, ''),
  ('H-51695E', '51695E', '',            '14t Excavator',                         'Excavator',    true, 'Nuffield Civil',           'In use', 0, '2027-01-01', '2027-04-01', 10000, 10000, 6, ''),
  ('H-61811E', '61811E', '',            '14t Excavator',                         'Excavator',    true, 'Nuffield Civil',           'In use', 0, '2027-01-01', '2027-04-01', 10000, 10000, 6, ''),
  ('H-CY66RK', 'CY66RK', '',            'Tool Van',                              'Van',          true, 'Nuffield Civil',           'In use', 0, '2027-01-01', '2027-04-01', 10000, 10000, 6, ''),
  ('H-XN75DD', 'XN75DD', 'Vermeer',     'VX200 Mega Vac',                        'Vac truck',    true, 'O''Hara Brothers Services', 'In use', 0, '2027-01-01', '2027-04-01', 10000, 10000, 6, ''),
  ('H-BP23BD', 'BP23BD', '',            'Tipper',                                'Tipper truck', true, 'Quinnex',                  'In use', 0, '2027-01-01', '2027-04-01', 10000, 10000, 6, 'Quinnex internal ID: Q012'),
  ('H-CN23JS', 'CN23JS', '',            '',                                      'Vac truck',    true, 'Quinnex',                  'In use', 0, '2027-01-01', '2027-04-01', 10000, 10000, 6, 'Quinnex internal ID: Q011'),
  ('H-XP24BN', 'XP24BN', 'VTI',         '10,000L Vacuum Excavation',             'Vac truck',    true, 'Quinnex',                  'In use', 0, '2027-01-01', '2027-04-01', 10000, 10000, 6, 'Quinnex internal ID: Q001'),
  ('H-XO46YQ', 'XO46YQ', 'VTI',         '7,000L Helix 750',                      'Vac truck',    true, 'Quinnex',                  'In use', 0, '2027-01-01', '2027-04-01', 10000, 10000, 6, 'Quinnex internal ID: Q002'),
  ('H-XP90HE', 'XP90HE', 'VTI',         '10,000L Vacuum Excavation',             'Vac truck',    true, 'Quinnex',                  'In use', 0, '2027-01-01', '2027-04-01', 10000, 10000, 6, 'Quinnex internal ID: Q003'),
  ('H-XN52MQ', 'XN52MQ', '',            'HDV 8000L',                             'Vac truck',    true, 'Quinnex',                  'In use', 0, '2027-01-01', '2027-04-01', 10000, 10000, 6, 'Quinnex internal ID: Q004'),
  ('H-CO70LY', 'CO70LY', '',            '',                                      'Vac truck',    true, 'Quinnex',                  'In use', 0, '2027-01-01', '2027-04-01', 10000, 10000, 6, 'Quinnex internal ID: Q005'),
  ('H-XN14DG', 'XN14DG', 'Hino',        'HDV 8000L',                             'Vac truck',    true, 'Quinnex',                  'In use', 0, '2027-01-01', '2027-04-01', 10000, 10000, 6, 'Formerly Quinnex Q003'),
  ('H-XN63HA', 'XN63HA', '',            '',                                      'Vac truck',    true, 'Quinnex',                  'In use', 0, '2027-01-01', '2027-04-01', 10000, 10000, 6, ''),
  ('H-XO29ZS', 'XO29ZS', 'Isuzu',       'Tipper',                                'Tipper truck', true, 'Quinnex',                  'In use', 0, '2027-01-01', '2027-04-01', 10000, 10000, 6, ''),
  ('H-XO75ST', 'XO75ST', '',            '',                                      'Vac truck',    true, 'Quinnex',                  'In use', 0, '2027-01-01', '2027-04-01', 10000, 10000, 6, ''),
  ('H-XP38AD', 'XP38AD', '',            '',                                      'Vac truck',    true, 'Quinnex',                  'In use', 0, '2027-01-01', '2027-04-01', 10000, 10000, 6, ''),
  ('H-XP39AD', 'XP39AD', '',            '',                                      'Vac truck',    true, 'Quinnex',                  'In use', 0, '2027-01-01', '2027-04-01', 10000, 10000, 6, ''),
  ('H-XO32EJ', 'XO32EJ', '',            'Effer 3055s Crane Truck',               'Other',        true, 'Reach Crane Trucks',       'In use', 0, '2027-01-01', '2027-04-01', 10000, 10000, 6, ''),
  ('H-XO38PY', 'XO38PY', '',            'Effer 505 Crane Truck',                 'Other',        true, 'Reach Crane Trucks',       'In use', 0, '2027-01-01', '2027-04-01', 10000, 10000, 6, 'Truck 38')
ON CONFLICT (id) DO NOTHING;

COMMIT;
