-- Engine-hours tracking for vac trucks, tippers and excavators.
-- Vehicles can be set to flag their next service by any combination of
-- date / kilometres / engine hours. Add nullable columns so existing
-- rows keep working; the app treats missing values as "not tracked".
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS "engineHours"           numeric;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS "lastServiceHours"      numeric;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS "nextServiceHours"      numeric;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS "serviceIntervalHours"  numeric;

-- "Notify me when due by …" switches. NULL = fall back to defaults for the
-- vehicle type (hours+date for vac/tipper/excavator, km+date for others).
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS "trackByDate"   boolean;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS "trackByKm"     boolean;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS "trackByHours"  boolean;

-- Capture engine hours alongside odometer when logging a service.
ALTER TABLE services ADD COLUMN IF NOT EXISTS hours numeric;
