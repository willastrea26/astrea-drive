BEGIN;

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS "fireExtInspected" text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS "fireExtStatus" text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS "fireExtNextDue" text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS "fireExtType" text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS "fireExtSize" text;

UPDATE vehicles SET
  "fireExtInspected" = '2026-05-18',
  "fireExtStatus" = 'Pass',
  "fireExtNextDue" = '2026-11-15',
  "fireExtType" = 'Dry Chem',
  "fireExtSize" = '1kg'
WHERE id IN (
  'ALV01','ALV02','ALV03','ALV04','ALV05','ALV06','ALV07','ALV08','ALV09','ALV10',
  'ALV11','ALV12','ALV13','ALV14','ALV15','ALV16','ALV17','ALV18','ALV19','ALV20',
  'ALV21','ALV22','ALV23','ALV24','ALV25','ALV26','ALV27','ALV28','ALV29','ALV30',
  'ALV31','ALV32','ALV33','ALV34','ALV35','ALV36','ALV37','ALV38','ALV39','ALV40',
  'ALV41','ALV42','ALV43','ALV44','ALV45','ALV46','ALV47'
);

UPDATE vehicles SET
  "fireExtInspected" = '2026-05-18',
  "fireExtStatus" = 'Pass',
  "fireExtNextDue" = '2026-11-15',
  "fireExtType" = 'Dry Chem',
  "fireExtSize" = '9kg'
WHERE id IN ('AVT01','AVT02','AVT04','AVT05','AVT06','AVT07','AVT08');

UPDATE vehicles SET
  "fireExtInspected" = '2026-05-18',
  "fireExtStatus" = 'Pass',
  "fireExtNextDue" = '2026-11-15',
  "fireExtType" = 'Dry Chem',
  "fireExtSize" = '1kg'
WHERE id IN ('AEX01','AEX02','AEX03');

UPDATE vehicles SET
  "fireExtInspected" = '2026-05-18',
  "fireExtStatus" = 'Pass',
  "fireExtNextDue" = '2026-11-15',
  "fireExtType" = 'Dry Chem',
  "fireExtSize" = '4.5kg'
WHERE id IN ('AHV01','AHV02');

UPDATE vehicles SET "fireExtStatus" = 'N/A'
WHERE id IN ('ATR01', 'ATR02');

INSERT INTO activity (id, ts, "vehicleId", text)
VALUES ('act-fire-ext', now(), '', 'Fire extinguisher register imported')
ON CONFLICT (id) DO NOTHING;

COMMIT;
