-- ==========================================================================
-- First Aid Kit Register: Add columns and populate inspection data
-- Source: "Astrea Plant and Fleet Register.xlsx" → "First Aid Kit Register"
-- Run this in the Supabase SQL Editor
-- ==========================================================================

BEGIN;

-- 1. Add new columns
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS "firstAidInspected" text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS "firstAidFull" text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS "firstAidNextDue" text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS "firstAidKitType" text;

-- 2. Light vehicles — Car kit (ALV01–ALV47)
UPDATE vehicles SET
  "firstAidInspected" = '2026-05-18',
  "firstAidFull" = 'Yes',
  "firstAidNextDue" = '2026-11-15',
  "firstAidKitType" = 'Car'
WHERE id IN (
  'ALV01','ALV02','ALV03','ALV04','ALV05','ALV06','ALV07','ALV08','ALV09','ALV10',
  'ALV11','ALV12','ALV13','ALV14','ALV15','ALV16','ALV17','ALV18','ALV19','ALV20',
  'ALV21','ALV22','ALV23','ALV24','ALV25','ALV26','ALV27','ALV28','ALV29','ALV30',
  'ALV31','ALV32','ALV33','ALV34','ALV35','ALV36','ALV37','ALV38','ALV39','ALV40',
  'ALV41','ALV42','ALV43','ALV44','ALV45','ALV46','ALV47'
);

-- 3. Vac trucks, excavators, heavy tippers — Truck kit
UPDATE vehicles SET
  "firstAidInspected" = '2026-05-18',
  "firstAidFull" = 'Yes',
  "firstAidNextDue" = '2026-11-15',
  "firstAidKitType" = 'Truck'
WHERE id IN (
  'AVT01','AVT02','AVT03','AVT04','AVT05','AVT06','AVT07','AVT08',
  'AEX01','AEX02','AEX03',
  'AHV01','AHV02'
);

-- 4. Own vehicle — Car kit
UPDATE vehicles SET
  "firstAidInspected" = '2026-05-18',
  "firstAidFull" = 'Yes',
  "firstAidNextDue" = '2026-11-15',
  "firstAidKitType" = 'Car'
WHERE id = 'APV01';

-- 5. Trailers — no first aid kit
UPDATE vehicles SET "firstAidFull" = 'N/A'
WHERE id IN ('ATR01', 'ATR02');

-- 6. Activity log
INSERT INTO activity (id, ts, "vehicleId", text)
VALUES ('act-first-aid', now(), '', 'First aid kit register imported — all kits inspected 18 May 2026, next due 15 Nov 2026');

COMMIT;
