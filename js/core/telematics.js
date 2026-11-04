/* Netstar data shared by the dashboard. No credentials or persistent GPS cache. */
window.AD = window.AD || {};
AD.telematics = (function () {
  const T = AD.time;
  const normal = value => String(value || '').trim().toUpperCase();
  const fieldKey = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  let live = null, liveAt = 0, livePending = null;
  let account = '', generation = 0;
  const reports = new Map();
  function reset() { live = null; liveAt = 0; livePending = null; reports.clear(); generation++; }
  function checkAccount() {
    const next = AD.currentUserEmail || '';
    if (account !== next) { reset(); account = next; }
  }
  AD.sb?.auth?.onAuthStateChange?.((event) => { if (event === 'SIGNED_OUT') reset(); });

  async function invoke(body) {
    const { data, error } = await AD.sb.functions.invoke('netstar', { body });
    if (error || data?.error) throw new Error(data?.error || 'Could not reach Netstar. Check your connection and try again.');
    return data;
  }
  function getLive(force = false) {
    checkAccount();
    if (livePending) return livePending;
    if (!force && live && Date.now() - liveAt < 60000) return Promise.resolve(live);
    const version = generation;
    livePending = invoke({ action: 'live' }).then(data => {
      if (!Array.isArray(data?.positions)) throw new Error('Netstar returned no position list.');
      if (generation === version) { live = data; liveAt = Date.now(); }
      return data;
    }).finally(() => { if (generation === version) livePending = null; });
    return livePending;
  }
  function getReports(vehicles, fromKey, toKey, force = false) {
    checkAccount();
    const regos = [...new Set(vehicles.map(v => normal(v.rego)).filter(Boolean))].sort();
    const key = JSON.stringify([regos, fromKey, toKey]);
    const old = reports.get(key);
    if (old?.pending) return old.pending;
    if (!force && old?.data && Date.now() - old.at < 600000) return Promise.resolve(old.data);
    const entry = old || {};
    const from = T.startOfDay(fromKey);
    const to = Math.min(Date.now(), T.startOfDay(T.addDays(toKey, 1)) - 1);
    if (to <= from) return Promise.reject(new Error('Reports are available for past or current dates.'));
    if (!regos.length) return Promise.reject(new Error('No registered trucks in this fleet.'));
    entry.pending = invoke({ action: 'activity-reports', regos,
      from: new Date(from).toISOString(), to: new Date(to).toISOString() }).then(data => {
      if (data?.reportVersion !== 1) throw new Error('The Netstar report connection needs the updated Supabase function.');
      entry.data = data; entry.at = Date.now(); return data;
    }).finally(() => { entry.pending = null; });
    reports.set(key, entry);
    // Bound in-memory history when switching dates repeatedly.
    if (reports.size > 6) reports.delete(reports.keys().next().value);
    return entry.pending;
  }
  function liveDueIn() { return Math.max(1000, 60000 - (Date.now() - liveAt)); }
  function reportsDueIn(vehicles, from, to) {
    const key = JSON.stringify([[...new Set(vehicles.map(v => normal(v.rego)).filter(Boolean))].sort(), from, to]);
    return Math.max(1000, 600000 - (Date.now() - (reports.get(key)?.at || 0)));
  }
  function seenTime(value) {
    if (typeof value !== 'string') return null;
    const m = /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
    if (m) {
      const ms = T.fromParts(+m[3], +m[2], +m[1], +m[4], +m[5]) + +m[6] * 1000;
      const p = T.parts(ms);
      return p.year === +m[3] && p.month === +m[2] && p.day === +m[1] && p.hour === +m[4] && p.minute === +m[5] && p.second === +m[6] ? ms : null;
    }
    // ISO timestamps must carry a timezone; do not guess the computer's zone.
    if (!/(Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  function position(v, snapshot, now = Date.now()) {
    const matches = (snapshot?.positions || []).filter(p => normal(p.rego) && normal(p.rego) === normal(v.rego));
    if (!matches.length) return { kind: 'unknown', label: 'No matching GPS device', seen: null };
    if (matches.length > 1) return { kind: 'unknown', label: 'Multiple GPS devices — check match', seen: null };
    const p = matches[0], seen = seenTime(p.lastData);
    const recent = seen !== null && now - seen <= 15 * 60000 && now - seen >= -60000;
    let kind = 'unknown', label = 'Status unavailable';
    if (!recent) { kind = 'stale'; label = seen ? 'Last report is stale' : 'Report time unavailable'; }
    else if (!p.hasFix) { label = 'No GPS fix'; }
    else if (Number(p.speed) > 0) { kind = 'moving'; label = 'Moving'; }
    else if (String(p.ignition).toLowerCase() === 'on') { kind = 'stationary'; label = 'Stationary · ignition on'; }
    else if (String(p.ignition).toLowerCase() === 'off') { kind = 'parked'; label = 'Parked · ignition off'; }
    return { kind, label, seen, p };
  }

  // Report schemas are not documented by Netstar. Only consume fields whose
  // name or value states units. Unknown numeric durations must stay unknown.
  function number(value) {
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
    if (typeof value !== 'string' || !/^\d[\d,]*(\.\d+)?$/.test(value.trim())) return null;
    const n = Number(value.replaceAll(',', ''));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  function hours(value, unit) {
    if (typeof value === 'string') {
      const s = value.trim();
      const clock = /^(\d+):([0-5]\d):([0-5]\d)$/.exec(s);
      if (clock) return +clock[1] + +clock[2] / 60 + +clock[3] / 3600;
      const named = /^(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|seconds?|secs?)$/i.exec(s);
      if (named) return hours(+named[1], /^h/i.test(named[2]) ? 'hours' : /^m/i.test(named[2]) ? 'minutes' : 'seconds');
    }
    const n = number(value);
    return n === null || !unit ? null : n / (unit === 'seconds' ? 3600 : unit === 'minutes' ? 60 : 1);
  }
  const SPECS = {
    work: { title: 'Reported work hours', roots: ['work', 'working'], generic: ['worktime', 'workduration', 'workingtime', 'workingduration'] },
    ignition: { title: 'Ignition-on hours', roots: ['ignition', 'ignitionon'], generic: ['ignitiontime', 'ignitionontime', 'ignitionduration', 'ignitiononduration'] },
    idle: { title: 'Reported idle hours', roots: ['idle', 'idling'], generic: ['idletime', 'idlingtime', 'idleduration', 'idlingduration'] },
    trips: { title: 'Distance', keys: ['distancekm', 'totaldistancekm', 'traveldistancekm', 'tripdistancekm'] }
  };
  function metric(row, type) {
    const fields = Object.fromEntries(Object.entries(row).map(([k, v]) => [fieldKey(k), v]));
    const spec = SPECS[type];
    if (type === 'trips') {
      for (const k of spec.keys) { const n = number(fields[k]); if (n !== null) return n; }
      for (const k of ['distance', 'totaldistance', 'traveldistance']) {
        const m = /^(\d[\d,]*(?:\.\d+)?)\s*km$/i.exec(String(fields[k] ?? '').trim());
        if (m) return number(m[1]);
      }
      return null;
    }
    for (const prefix of ['', 'total']) for (const root of spec.roots) for (const unit of ['hours', 'minutes', 'seconds']) {
      const n = hours(fields[prefix + root + unit], unit);
      if (n !== null) return n;
    }
    for (const k of spec.generic) for (const prefix of ['', 'total']) {
      const n = hours(fields[prefix + k], null);
      if (n !== null) return n;
    }
    return null;
  }
  function reportRows(payload) {
    // Follow envelopes, not arbitrary nested totals/details (which double count).
    if (Array.isArray(payload)) return payload.filter(x => x && typeof x === 'object' && !Array.isArray(x));
    if (!payload || typeof payload !== 'object') return [];
    for (const k of ['data', 'rows', 'records', 'result', 'results']) {
      if (payload[k] != null) return reportRows(payload[k]);
    }
    return [];
  }
  function reportMetric(report, type, vehicle, devices, periodHours = null) {
    if (!report?.ok) return { value: null, reason: report?.error || 'Report unavailable' };
    const matches = (devices || []).filter(d => normal(d.rego) === normal(vehicle.rego));
    if (matches.length !== 1) return { value: null, reason: matches.length ? 'Multiple GPS devices' : 'No matching device' };
    const device = matches[0];
    const rows = reportRows(report.payload).filter(row => {
      const f = Object.fromEntries(Object.entries(row).map(([k, v]) => [fieldKey(k), v]));
      const imei = f.imei ?? f.imeino ?? f.imeinumber;
      const rego = f.rego ?? f.vehicleno ?? f.registration ?? f.vehicleregistration;
      return imei != null ? String(imei).trim() === device.imei : normal(rego) !== '' && normal(rego) === normal(vehicle.rego);
    });
    // Summary report expected: one record per vehicle for the requested period.
    // Never sum multiple rows until their dates/grouping semantics are verified.
    if (rows.length !== 1) return { value: null, reason: rows.length ? 'Multiple report rows — grouping needs verification' : 'No matching report row' };
    const value = metric(rows[0], type);
    if (type !== 'trips' && value !== null && periodHours !== null && value > periodHours + 0.02) {
      return { value: null, reason: 'Hours exceed the requested period — check report definition' };
    }
    return { value, reason: value === null ? 'Report units need verification' : '' };
  }
  return { getLive, getReports, liveDueIn, reportsDueIn, position, normal, seenTime, hours, metric, reportRows, reportMetric, SPECS };
})();
