const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const base = path.join(__dirname, '..');
function client(invoke = async () => ({ data: { positions: [] } })) {
  const c = vm.createContext({ Date, Intl, console }); c.window = c;
  c.AD = { sb: { functions: { invoke } } };
  for (const file of ['js/core/time.js', 'js/core/telematics.js']) vm.runInContext(fs.readFileSync(path.join(base, file), 'utf8'), c);
  return c.AD;
}

test('GPS timestamps respect Sydney DST and stale/future timestamps never count as active', () => {
  const N = client().telematics;
  assert.equal(N.seenTime('04-11-2026 11:00:00'), Date.parse('2026-11-04T00:00:00Z'));
  assert.equal(N.seenTime('04-07-2026 10:00:00'), Date.parse('2026-07-04T00:00:00Z'));
  assert.equal(N.seenTime('31-02-2026 10:00:00'), null);
  const v = { rego: 'ABC' }, now = Date.parse('2026-11-04T00:00:00Z');
  const pos = { rego: ' abc ', lastData: '04-11-2026 11:00:00', hasFix: true, speed: 0, ignition: 'on' };
  const check = p => N.position(v, { positions: [p] }, now).kind;
  assert.equal(check(pos), 'stationary');
  assert.equal(check({ ...pos, speed: 42 }), 'moving');
  assert.equal(check({ ...pos, ignition: 'off' }), 'parked');
  assert.equal(check({ ...pos, ignition: '' }), 'unknown');
  assert.equal(check({ ...pos, lastData: '04-11-2026 10:30:00' }), 'stale');
  assert.equal(check({ ...pos, lastData: '04-11-2026 12:30:00' }), 'stale');
  assert.equal(check({ ...pos, hasFix: false }), 'unknown');
  assert.equal(N.position(v, { positions: [pos, pos] }, now).kind, 'unknown');
});

test('only explicit units are accepted; missing and ambiguous values are not zero', () => {
  const N = client().telematics;
  assert.equal(N.metric({ work_hours: '6.5' }, 'work'), 6.5);
  assert.equal(N.metric({ work_time: '06:30:00' }, 'work'), 6.5);
  assert.equal(N.metric({ work_time: 650 }, 'work'), null);
  assert.equal(N.metric({ engine_hours: 9000 }, 'work'), null);
  assert.equal(N.metric({ ignition_on_seconds: 3600 }, 'ignition'), 1);
  assert.equal(N.metric({ idle_duration: '30 minutes' }, 'idle'), 0.5);
  assert.equal(N.metric({ total_distance: 15 }, 'trips'), null);
  assert.equal(N.metric({ total_distance: '15 km' }, 'trips'), 15);
  assert.equal(N.metric({ work_hours: 0 }, 'work'), 0);
  assert.equal(N.metric({ work_hours: '--' }, 'work'), null);
  assert.equal(N.metric({ work_hours: -3 }, 'work'), null);
  const v = { rego: 'ABC' }, devices = [{ rego: 'ABC', imei: '123' }];
  const report = { ok: true, payload: { data: [{ imei: '123', work_hours: 2 }] } };
  assert.equal(N.reportMetric(report, 'work', v, devices).value, 2);
  assert.equal(N.reportMetric(report, 'work', v, devices, 1).value, null);
  report.payload.data.push({ imei: '123', work_hours: 2 });
  assert.equal(N.reportMetric(report, 'work', v, devices).value, null);
  assert.equal(N.reportMetric(report, 'work', { rego: 'OTHER' }, devices).value, null);
});

test('requests are deduplicated and old proxy versions cannot masquerade as activity reports', async () => {
  let count = 0;
  const AD = client(async () => { count++; return { data: { positions: [] } }; });
  await Promise.all([AD.telematics.getLive(), AD.telematics.getLive()]);
  await AD.telematics.getLive();
  assert.equal(count, 1);
  await assert.rejects(AD.telematics.getReports([{ rego: 'ABC' }], '2026-01-01', '2026-01-01'), /updated Supabase/);
});

function server(fetch) {
  let handler;
  const context = vm.createContext({ Date, Intl, console, Response, Request, AbortSignal, fetch,
    Deno: { env: { get: key => key === 'NETSTAR_API_KEY' ? 'synthetic-key' : undefined }, serve: fn => { handler = fn; } },
    createClient: () => { throw new Error('Read-only reports must not access the database'); }
  });
  const source = stripTypeScriptTypes(fs.readFileSync(path.join(base, 'supabase/functions/netstar/index.ts'), 'utf8')).replace(/^import .*;$/m, '');
  vm.runInContext(source, context);
  return async body => handler(new Request('https://example.test/netstar', { method: 'POST', body: JSON.stringify(body) }));
}
test('report proxy validates ranges, uses company-matched devices and isolates report failures', async () => {
  const calls = [];
  const run = server(async (url, opts) => {
    calls.push([url, opts]);
    if (url.endsWith('company-vehicles')) return Response.json({ data: { branch: [{ vehicles: [
      { imei_no: '123', vehicle_no: 'ABC' }, { imei_no: '456', vehicle_no: 'OTHER' }
    ] }] } });
    if (url.endsWith('idle-summary')) return new Response('', { status: 403 });
    return Response.json({ data: [{ imei: '123', work_hours: 6 }] });
  });
  const body = { action: 'activity-reports', from: '2026-01-01T00:00:00Z', to: '2026-01-01T01:00:00Z', regos: ['abc'] };
  assert.equal((await run({ ...body, to: '2026-03-01T00:00:00Z' })).status, 400);
  assert.equal((await run({ ...body, regos: [] })).status, 400);
  assert.equal(calls.length, 0);
  const result = await (await run(body)).json();
  assert.equal(result.reportVersion, 1);
  assert.equal(result.reports.idle.ok, false);
  assert.equal(result.reports.work.ok, true);
  assert.equal(result.vehicles.length, 1);
  assert.equal(calls.length, 5);
  for (const [, opts] of calls.slice(1)) {
    const sent = JSON.parse(opts.body);
    assert.deepEqual(sent.imeis, ['123']);
    assert.equal(sent.start_date_time, '01-01-2026 11:00:00');
    assert.equal(sent.end_date_time, '01-01-2026 12:00:00');
  }
  assert.equal(JSON.stringify(result).includes('synthetic-key'), false);
});
