const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(records = {}) {
  const at = Date.parse('2026-10-22T00:00:00Z');
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [at])); } static now() { return at; } }
  const context = vm.createContext({ Date: FixedDate, Intl, console });
  context.window = context;
  context.AD = { store: { all: key => records[key] || [], get: (key, id) => (records[key] || []).find(v => v.id === id) } };
  for (const file of ['js/core/time.js', 'js/core/logic.js', 'js/views/fleet-report.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  }
  return context.AD.fleetReport;
}

test('current month excludes future costs, counts resolved defects once and keeps money numeric', () => {
  const report = fixture({ services: [
    { vehicleId: 'V1', date: '2026-10-01', cost: '100.25' },
    { vehicleId: 'V1', date: '2026-10-22', cost: 200 },
    { vehicleId: 'V1', date: '2026-10-23', cost: 9000 },
    { vehicleId: 'V1', date: '2026-10-03', cost: 'bad input' },
  ], defects: [
    { vehicleId: 'V2', status: 'Resolved', reportedDate: '2026-10-01', resolvedDate: '2026-10-10', cost: 50 },
    { vehicleId: 'V2', status: 'Open', reportedDate: '2026-10-01', cost: 2000 },
    { vehicleId: 'V2', status: 'Resolved', reportedDate: '2026-10-25', resolvedDate: '2026-10-30', cost: 1000 },
  ] });
  const d = report.gather();
  assert.equal(d.curMonth.total, 350.25);
  assert.equal(d.curMonth.defCount, 1);
  assert.equal(d.defRaisedMonth.length, 2);
  assert.equal(d.reportEnd, '2026-10-22');
  assert.equal(d.isPartial, true);
  assert.equal(d.avgResolveDays, 9);
  assert.equal(d.vehiclesCharged, 2);
});

test('selected completed month has full-month totals and Sydney month boundaries', () => {
  const report = fixture({ services: [
    { date: '2026-09-30', cost: 320 }, { date: '2026-10-01', cost: 500 }
  ] });
  const d = report.gather('2026-09');
  assert.equal(d.curMonth.total, 320);
  assert.equal(d.reportEnd, '2026-09-30');
  assert.equal(d.today, '2026-10-22');
  assert.equal(d.isPartial, false);
  assert.equal(d.mtdExpected, d.monthlyTarget);
  assert.equal(report.gather('2024-02').reportEnd, '2024-02-29');
  assert.throws(() => report.gather('2026-13'));
  assert.throws(() => report.gather('2026-11'));
});

test('active engine-hour triggers are included; inactive kilometre limits are ignored', () => {
  const d = fixture({ vehicles: [
    { id: 'HOUR', type: 'Vac truck', engineHours: 1000, nextServiceHours: 1020, nextServiceDate: '2027-01-01', regoExpiry: '2027-01-01' },
    { id: 'IGNORE', type: 'Ute', trackByDate: true, trackByKm: false, nextServiceKm: 200, odometer: 100, nextServiceDate: '2027-01-01', regoExpiry: '2027-01-01' },
  ] }).gather();
  assert.deepEqual(Array.from(d.svcSoon, x => x.v.id), ['HOUR']);
  assert.deepEqual(Array.from(d.svcOk, x => x.v.id), ['IGNORE']);
});

test('empty data and missing dates do not imply compliance or successful savings', () => {
  const empty = fixture().gather();
  assert.equal(empty.recommendations.length, 1);
  assert.match(empty.recommendations[0].title, /baseline/);
  const d = fixture({ vehicles: [{ id: 'MISSING', type: 'Ute' }] }).gather();
  assert.equal(d.regoUnknown.length, 1);
  assert.equal(d.regoOk.length, 0);
  assert.equal(d.unknownStatus, 1);
  assert.ok(d.recommendations.some(r => /missing registration/i.test(r.title)));
});

test('partial-month recommendation uses a day-adjusted baseline and caps actions at four', () => {
  const d = fixture({ services: [
    { date: '2026-09-01', cost: 1200 }, { date: '2026-10-01', cost: 80 }
  ] }).gather();
  assert.equal(d.vsAvgPct, (80 - d.mtdExpected) / d.mtdExpected);
  assert.ok(d.recommendations.length <= 4);
});
