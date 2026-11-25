const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function logic(records) {
  const context = vm.createContext({ Date, Intl, console });
  context.window = context;
  context.AD = { store: { all: (name) => records[name] || [], get: () => null } };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'core', 'time.js'), 'utf8'), context, { filename: 'js/core/time.js' });
  context.AD.time.todayKey = () => '2026-11-17';
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'core', 'logic.js'), 'utf8'), context, { filename: 'js/core/logic.js' });
  return context.AD.logic;
}

test('fleet activity totals use true year-to-date GPS and fuel data', () => {
  const L = logic({
    vehicle_work_hours_daily: [
      { vehicleId: 'AVT01', day: '2026-01-02', distanceKm: 100, hours: 2 },
      { vehicleId: 'AVT01', day: '2026-11-17', distanceKm: 45, hours: 1.5 },
      { vehicleId: 'AVT02', day: '2026-11-16', distanceKm: 55, hours: 3 },
      { vehicleId: 'AVT01', day: '2025-12-31', distanceKm: 999, hours: 99 }
    ],
    fuel_entries: [
      { date: '2026-10-01', litres: 80 },
      { date: '2025-12-31', litres: 500 }
    ],
    vehicle_trip_stats: [
      { vehicleId: 'AVT01', trips: 10, maxSpeed: 92, windowDays: 30 },
      { vehicleId: 'AVT02', trips: 14, maxSpeed: 108, windowDays: 30 }
    ]
  });

  const result = L.gpsTotals();
  assert.equal(result.km, 200);
  assert.equal(result.hours, 6.5);
  assert.equal(result.litres, 80);
  assert.equal(result.trips, 24);
  assert.equal(result.topSpeed, 108);
  assert.equal(result.topSpeedVeh, 'AVT02');
  assert.equal(result.tracked, 2);
  assert.equal(result.firstDay, '2026-01-02');
  assert.equal(result.lastDay, '2026-11-17');
  assert.equal(result.tripWindowDays, 30);
});
