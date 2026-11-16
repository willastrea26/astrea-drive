const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function logic(records) {
  const context = vm.createContext({ Date, Intl, console });
  context.window = context;
  context.AD = { store: { all: (key) => records[key] || [], get: () => null } };
  for (const file of ['js/core/time.js', 'js/core/logic.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  }
  return context.AD.logic;
}

test('vehicle costs combine imported fuel, maintenance, repairs and manual ownership costs', () => {
  const L = logic({
    fuel_entries: [{ id: 'f1', vehicleId: 'V1', date: '2026-10-20', cost: '125.50', litres: 60, brand: 'WEX', product: 'Diesel' }],
    services: [
      { id: 's1', vehicleId: 'V1', date: '2026-09-10', cost: 500, type: 'Scheduled service', workshop: 'Astrea' },
      { id: 's2', vehicleId: 'V1', date: '2026-08-10', cost: 220, type: 'Tyres' }
    ],
    defects: [
      { id: 'd1', vehicleId: 'V1', status: 'Resolved', resolvedDate: '2026-07-10', cost: 300, description: 'Hydraulic leak' },
      { id: 'd2', vehicleId: 'V1', status: 'Open', reportedDate: '2026-10-01', cost: 999 }
    ],
    vehicle_costs: [{ id: 'c1', vehicleId: 'V1', date: '2026-06-01', category: 'Insurance', amount: 2400, supplier: 'Insurer' }]
  });
  const rows = L.vehicleCostsFor({ id: 'V1' }, '2026-01-01', '2026-12-31');
  assert.deepEqual(Array.from(rows, (r) => r.category), ['Fuel', 'Servicing', 'Tyres', 'Repairs', 'Insurance']);
  assert.equal(rows.reduce((n, r) => n + r.amount, 0), 3545.5);
  assert.equal(rows[0].litres, 60);
});

test('vehicle cost range and vehicle matching exclude unrelated records', () => {
  const L = logic({
    fuel_entries: [
      { id: 'in', vehicleId: 'V1', date: '2026-10-01', cost: 10 },
      { id: 'old', vehicleId: 'V1', date: '2025-10-01', cost: 20 },
      { id: 'other', vehicleId: 'V2', date: '2026-10-01', cost: 30 }
    ]
  });
  const rows = L.vehicleCostsFor({ id: 'V1' }, '2026-01-01', '2026-12-31');
  assert.deepEqual(Array.from(rows, (r) => r.id), ['in']);
});
