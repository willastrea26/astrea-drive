// Run with PGLITE_MODULE pointing to an installed @electric-sql/pglite module.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('GPS sync verifies equal mileage, preserves higher saved readings and explains skips', async () => {
  const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create table vehicles (id text primary key, rego text, odometer integer,
        "odometerSource" text default 'manual', "odometerSyncedAt" timestamptz);
      create table activity (id text, ts timestamptz, "vehicleId" text, text text);
      insert into vehicles (id, rego, odometer) values
        ('up', 'UP1', 100), ('equal', 'EQ1', 200), ('lower', 'LOW1', 300),
        ('missing', 'MISS1', 400), ('zero', 'ZERO1', 500), ('null', 'NULL1', null);`);
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/create-odometer-sync-fn.sql'), 'utf8'));
    const readings = [
      { rego: ' up1 ', km: 150 }, { rego: 'UP1', km: 140 },
      { rego: 'EQ1', km: 200 }, { rego: 'LOW1', km: 250 },
      { rego: 'MISS1', km: null }, { rego: 'ZERO1', km: 0 },
      { rego: 'UNKNOWN', km: 10 }, { rego: 'NULL1', km: 50 }
    ];
    const sync = async () => (await db.query('select sync_odometers_from_telematics($1::jsonb) as result', [JSON.stringify(readings)])).rows[0].result;
    const result = await sync();
    assert.equal(result.updated, 2);
    assert.equal(result.verified, 1);
    assert.equal(result.added, 100);
    assert.equal(result.results.length, 7);
    assert.equal(result.results.find(r => r.rego === 'LOW1').status, 'lower');
    assert.equal(result.results.find(r => r.rego === 'UNKNOWN').status, 'unmatched');
    assert.equal(result.results.filter(r => r.status === 'missing').length, 2);
    const vehicles = (await db.query('select * from vehicles order by id')).rows;
    for (const id of ['up', 'equal', 'null']) {
      const v = vehicles.find(v => v.id === id);
      assert.equal(v.odometerSource, 'telematics');
      assert.ok(v.odometerSyncedAt);
    }
    for (const id of ['lower', 'missing', 'zero']) {
      const v = vehicles.find(v => v.id === id);
      assert.equal(v.odometerSource, 'manual');
      assert.equal(v.odometerSyncedAt, null);
    }
    assert.equal(vehicles.find(v => v.id === 'lower').odometer, 300);
    const again = await sync();
    assert.equal(again.updated, 0);
    assert.equal(again.verified, 3);
    assert.equal(again.added, 0);
  } finally { await db.close(); }
});

test('sync dialog explains skips, escapes regos and handles an older server', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../js/views/fleet.js'), 'utf8');
  const fn = source.slice(source.indexOf('  async function syncOdometers(btn)'), source.indexOf('\n  function rows()'));
  let response = { updated: 1, verified: 1, results: [
    { rego: '<rego>', status: 'updated' }, { rego: 'EQ1', status: 'verified' },
    { rego: 'LOW1', status: 'lower', gpsKm: 100, savedKm: 200 }
  ] };
  let modal, toast;
  const ctx = vm.createContext({
    AD: {
      sb: { functions: { invoke: async () => ({ data: response }) } },
      store: { load: async () => {}, all: () => [{ rego: 'NONE' }] },
      ui: { modal: m => { modal = m; }, toast: t => { toast = t; } }
    },
    I: { gauge: '' }, L: { fmtKm: n => `${n} km` }, draw() {},
    esc: value => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  });
  vm.runInContext(fn, ctx);
  await ctx.syncOdometers({ innerHTML: 'Sync' });
  assert.match(modal.body, /1 updated · 1 GPS verified · 2 skipped/);
  assert.match(modal.body, /&lt;rego&gt;/);
  assert.match(modal.body, /GPS 100 km · saved 200 km/);
  assert.match(modal.body, /No matching registration returned by Netstar/);
  response = { updated: 0 };
  await ctx.syncOdometers({ innerHTML: 'Sync' });
  assert.match(toast, /requires the latest server update/);
});
