/* Cost sheet — what the fleet cost over the selected period, measured against its prior average. */
AD.views = AD.views || {};

AD.views['cost-sheet'] = (function () {
  const { esc, pageHeader, sectionHead } = AD.ui;
  const L = AD.logic, T = AD.time, I = AD.icons, V = AD.viz;
  const AVG_WEEKS = 4; // same trailing window the dashboard uses for its utilisation trend
  // How many trailing periods the headline KPIs and "What moved" compare the
  // period on screen against, per scope — a week against its last 4 weeks, a
  // month against its last 3, a year against the one before it.
  const SCOPE_CFG = {
    week: { label: 'week', plural: 'weeks', baselineN: AVG_WEEKS },
    month: { label: 'month', plural: 'months', baselineN: 3 },
    year: { label: 'year', plural: 'years', baselineN: 1 }
  };
  const RUN_WEEKS = 52; // cost-vs-usage measurement cap: a year of weeks, ending with the week on screen
  const MOVERS_MAX = 8; // vehicles shown in "What moved"; the rest live in the table view
  const TREND_WEEKS = 12; // Spend over time, weekly mode
  const TREND_MONTHS = 12; // Spend over time, monthly mode
  const PROJ_MONTHS = 6;  // months to project forward from current
  const MIN_USAGE_SPAN_DAYS = 28;      // below this, a vehicle's own measurement window is too noisy to trust a per-km rate
  const THIN_USAGE_SPAN_DAYS = 12 * 7; // below this, the rate is shown but flagged "Thin data"
  let root = null, start = '', end = '', scope = 'year', period = 'month';
  const PROJ_STORE_KEY = 'ad-cost-proj-overrides';
  let projOverrides = (() => { try { const v = JSON.parse(localStorage.getItem(PROJ_STORE_KEY)) || {}; /* migrate old {planned,unplanned} format */ for (const k of Object.keys(v)) { if (typeof v[k] === 'object') v[k] = (v[k].planned || 0) + (v[k].unplanned || 0); } return v; } catch { return {}; } })();
  function saveOverrides() { try { localStorage.setItem(PROJ_STORE_KEY, JSON.stringify(projOverrides)); } catch {} }
  // Replays the draw-in whenever the figures on screen actually change — opening
  // the page, stepping a week, switching period — but not on a background refresh,
  // which would make the page twitch while someone is reading it.
  let fresh = true;

  const mondayOf = (key) => T.addDays(key, -T.dayOfWeek(key));

  /** The start of the week/month/year containing `key`, for whichever scope is on screen. */
  function periodStart(sc, key) {
    if (sc === 'week') return mondayOf(key);
    const { y, m } = T.parseKey(key);
    return sc === 'month' ? `${y}-${T.pad(m)}-01` : `${y}-01-01`;
  }
  /** The last day of the week/month/year that starts at `s`. */
  function periodEnd(sc, s) {
    const { y, m } = T.parseKey(s);
    if (sc === 'week') return T.addDays(s, 6);
    if (sc === 'month') {
      const dt = new Date(Date.UTC(y, m, 0)); // day 0 of next month = last day of this one
      return `${dt.getUTCFullYear()}-${T.pad(dt.getUTCMonth() + 1)}-${T.pad(dt.getUTCDate())}`;
    }
    return `${y}-12-31`;
  }
  /** One period forward/back (dir = ±1) from a period start `s`. */
  function stepPeriod(sc, s, dir) {
    const { y, m } = T.parseKey(s);
    if (sc === 'week') return T.addDays(s, dir * 7);
    if (sc === 'month') {
      const dt = new Date(Date.UTC(y, m - 1 + dir, 1));
      return `${dt.getUTCFullYear()}-${T.pad(dt.getUTCMonth() + 1)}-01`;
    }
    return `${y + dir}-01-01`;
  }
  function fmtPeriodLabel(sc, s) {
    if (sc === 'week') return `${T.fmtKey(s)} – ${T.fmtKey(periodEnd(sc, s))}`;
    const { y, m } = T.parseKey(s);
    return sc === 'month' ? `${T.MONTHS[m - 1]} ${y}` : String(y);
  }

  /**
   * Every service and resolved defect the fleet has ever been charged for, as
   * one flat list: a service on the day it was recorded, a defect on the day
   * it was resolved, which is when the repair bill actually lands. Service
   * meter readings come along so running cost can be put against distance or
   * hours covered. Date-filtered downstream by whichever window is needed.
   */
  function allRows() {
    const services = AD.store.all('services').filter((s) => s.date)
      .map((s) => ({ vehicleId: s.vehicleId, date: s.date, cost: Number(s.cost || 0), odometer: s.odometer, hours: s.hours, kind: 'Service' }));
    const defects = AD.store.all('defects').filter((d) => d.status === 'Resolved' && d.resolvedDate)
      .map((d) => ({ vehicleId: d.vehicleId, date: d.resolvedDate, cost: Number(d.cost || 0), kind: 'Defect' }));
    return services.concat(defects);
  }

  const rowsBetween = (from, to) => allRows().filter((r) => r.date >= from && r.date <= to);
  const rowsForMonth = (key) => allRows().filter((r) => r.date.slice(0, 7) === key);

  const sum = (rows) => rows.reduce((n, r) => n + r.cost, 0);
  const avgOf = (nums) => nums.reduce((a, b) => a + b, 0) / (nums.length || 1);

  // A service is work we chose to do; a resolved defect is work that chose us.
  // Spend rising on planned servicing and spend rising on unplanned repairs call
  // for opposite responses, so every figure that can carry the split, does.
  const PLANNED = 'Service', UNPLANNED = 'Defect';
  const sumKind = (rows, kind) => sum(rows.filter((r) => r.kind === kind));
  const COLOR_PLANNED = 'var(--mint)', COLOR_UNPLANNED = 'var(--cs-amber)', COLOR_FUEL = 'var(--cs-blue)';

  // Imported fuel-card spend, kept separate from maintenance rows so it never
  // skews the planned/unplanned maintenance figures — it rides on top as its
  // own series in the spend chart and adds into cost-per-km.
  const fuelRows = () => (AD.store.all('fuel_entries') || [])
    .filter((r) => r.date && Number(r.cost) > 0)
    .map((r) => ({ vehicleId: r.vehicleId, date: String(r.date).slice(0, 10), cost: Number(r.cost) }));
  const fuelBetween = (from, to) => fuelRows().filter((r) => r.date >= from && r.date <= to).reduce((n, r) => n + r.cost, 0);
  const fuelForMonth = (key) => fuelRows().filter((r) => r.date.slice(0, 7) === key).reduce((n, r) => n + r.cost, 0);

  /** The scope's own trailing baseline — the N periods (weeks/months/years) immediately before `curStart`. */
  function baseline(curStart) {
    let cursor = curStart;
    return Array.from({ length: SCOPE_CFG[scope].baselineN }, () => {
      cursor = stepPeriod(scope, cursor, -1);
      return { from: cursor, to: periodEnd(scope, cursor), rows: rowsBetween(cursor, periodEnd(scope, cursor)) };
    });
  }

  /** 'worse' | 'better' | null (flat, untoned, or no baseline to compare against) — drives both the delta text and a card's accent. */
  function trendTone(now, avg, haveBaseline, toned) {
    if (!haveBaseline || !avg || !toned) return null;
    const pct = Math.round(((now - avg) / avg) * 100);
    return pct > 0 ? 'worse' : pct < 0 ? 'better' : null;
  }

  /** Change line under a figure, against the scope's trailing average. `toned` marks a rise as worse — only money is judged. */
  function delta(now, avg, haveBaseline, fmt, toned) {
    const cfg = SCOPE_CFG[scope];
    if (!haveBaseline) return `<small class="cs-delta">${now ? `No ${cfg.plural} before this one yet` : 'Nothing recorded'}</small>`;
    if (!avg) return `<small class="cs-delta">${now ? `Nothing in the ${cfg.baselineN}-${cfg.label} average` : 'Nothing either way'}</small>`;
    const pct = Math.round(((now - avg) / avg) * 100);
    const arrow = pct > 0 ? '↑' : pct < 0 ? '↓' : '—';
    const tone = trendTone(now, avg, haveBaseline, toned) || 'flat';
    return `<small class="cs-delta cs-delta-${tone}">${arrow} ${Math.abs(pct)}% · ${fmt(avg)} avg</small>`;
  }

  const TONE_VAR = { worse: 'var(--red)', better: 'var(--green)' };
  const kpi = (label, value, foot, tone) => `<div class="cs-kpi"${tone ? ` style="--cs-tone:${TONE_VAR[tone]}"` : ''}><span>${esc(label)}</span><strong>${value}</strong>${foot}</div>`;
  const fmtChange = (n) => Math.abs(n) < 0.005 ? '—' : (n > 0 ? '+' : '−') + L.fmtAUD(Math.abs(n));
  const median = (nums) => {
    const s = [...nums].sort((a, b) => a - b), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const vehHref = (id) => `#/vehicle/${encodeURIComponent(id)}`;
  const changeTone = (n) => n > 0.005 ? 'cs-delta-worse' : n < -0.005 ? 'cs-delta-better' : '';

  function render(el, params) {
    root = el;
    scope = params.scope === 'week' || params.scope === 'month' ? params.scope : 'year';
    const anchor = /^\d{4}-\d{2}-\d{2}$/.test(params.week || '') ? params.week : T.todayKey();
    start = periodStart(scope, anchor);
    period = params.period === 'week' ? 'week' : 'month';
    fresh = true;
    draw();
  }

  function draw() {
    const el = root;
    const cfg = SCOPE_CFG[scope];
    end = periodEnd(scope, start);
    const thisStart = periodStart(scope, T.todayKey());
    const isCurrent = start === thisStart;
    const now = rowsBetween(start, end);
    const base = baseline(start);
    const haveBaseline = base.some((w) => w.rows.length || fuelBetween(w.from, w.to) > 0);

    const spend = sum(now) + fuelBetween(start, end), avgSpend = avgOf(base.map((w) => sum(w.rows) + fuelBetween(w.from, w.to)));

    // Share rather than dollars: unplanned spend rises with a heavy period either way,
    // but the proportion is what says whether maintenance is keeping ahead of failure.
    const unplanned = sumKind(now, UNPLANNED);
    const share = spend ? (unplanned / spend) * 100 : 0;
    const avgUnplanned = avgOf(base.map((w) => sumKind(w.rows, UNPLANNED)));
    const avgShare = avgSpend ? (avgUnplanned / avgSpend) * 100 : 0;
    const shareTone = !haveBaseline || !avgSpend ? null
      : share > avgShare + 0.5 ? 'worse' : share < avgShare - 0.5 ? 'better' : null;
    const shareFoot = !spend ? '<small class="cs-delta">Nothing recorded</small>'
      : `<small class="cs-delta${shareTone ? ' cs-delta-' + shareTone : ''}">${L.fmtAUD(unplanned)} of ${L.fmtAUD(spend)}${haveBaseline && avgSpend ? ` · ${Math.round(avgShare)}% avg` : ''}</small>`;

    // Projected rest-of-year spend for the KPI — not meaningful once you're
    // already looking at a whole year, so it only appears in week/month view.
    const projForKpi = scope === 'year' ? [] : projectedMonths(end);
    const curYear = T.parseKey(end).y;
    const restOfYearMonths = projForKpi.filter(p => { const yr = parseInt(p.key.split(' ')[1]); return yr === curYear; });
    const projRestTotal = restOfYearMonths.reduce((n, p) => n + p.total, 0);
    const projMonthAvg = restOfYearMonths.length ? projRestTotal / restOfYearMonths.length : 0;

    el.classList.toggle('anim-in', fresh);
    fresh = false;

    el.innerHTML = `
      ${pageHeader({
        title: 'Cost sheet',
        sub: `${fmtPeriodLabel(scope, start)}${isCurrent ? ` · this ${cfg.label}` : ''} · against the average of the ${cfg.baselineN} ${cfg.baselineN === 1 ? cfg.label : cfg.plural} before`,
        actions: `<button type="button" class="btn btn-primary" id="cs-import">${I.file} Import cost data</button>
          <div class="seg" role="group" aria-label="View by">
            <button type="button" data-scope="week"${scope === 'week' ? ' class="on"' : ''}>Week</button>
            <button type="button" data-scope="month"${scope === 'month' ? ' class="on"' : ''}>Month</button>
            <button type="button" data-scope="year"${scope === 'year' ? ' class="on"' : ''}>Year</button>
          </div>
          <div class="seg" role="group" aria-label="${esc(cfg.label)}">
            <button type="button" id="w-prev" aria-label="Previous ${cfg.label}">${I.chevL}</button>
            <button type="button" id="w-this"${isCurrent ? ' class="on"' : ''}>This ${cfg.label}</button>
            <button type="button" id="w-next" aria-label="Next ${cfg.label}">${I.chevR}</button>
          </div>
          <input type="date" id="w-jump" class="cs-jump" value="${start}" aria-label="Go to ${cfg.label}">`
      })}

      <div class="cs-kpis" role="group" aria-label="This ${cfg.label} against the average ${cfg.label}">
        ${kpi('Total spend', L.fmtAUD(spend), delta(spend, avgSpend, haveBaseline, L.fmtAUD, true), trendTone(spend, avgSpend, haveBaseline, true))}
        ${kpi('Unplanned share', `${Math.round(share)}%`, shareFoot, shareTone)}
        ${restOfYearMonths.length ? kpi('Projected to year-end', L.fmtAUD(projRestTotal), `<small class="cs-delta">${restOfYearMonths.length} month${restOfYearMonths.length === 1 ? '' : 's'} remaining · ${L.fmtAUD(projMonthAvg)}/mo avg</small>`) : ''}
      </div>

      ${trend(end)}

      <div class="cs-pair">
        ${months(end)}
        ${movers(now, base)}
      </div>

      ${fuelLitreage()}

      ${fuelPerKm()}

      ${costVsUsage(end)}

      <p class="section-foot muted small">Spend is recorded services plus resolved defects, counted on the day the service was recorded or the defect was resolved; imported fuel-card spend is shown as its own band on Spend over time, folded into Cost vs usage, and broken out on its own in Fuel cost per km. Planned is scheduled servicing; unplanned is a defect repair. The KPIs above cover maintenance only, for the ${cfg.label} on screen, against the average of the ${cfg.baselineN} ${cfg.baselineN === 1 ? cfg.label : cfg.plural} before. Running cost divides a vehicle's spend by the distance or hours covered between its first and last service in the window, so it needs at least two services to show a rate.</p>

      ${projection(end)}`;

    el.querySelector('#cs-import').onclick = () => AD.importFuelData(() => draw());
    el.querySelector('#w-prev').onclick = () => go(stepPeriod(scope, start, -1));
    el.querySelector('#w-next').onclick = () => go(stepPeriod(scope, start, 1));
    el.querySelector('#w-this').onclick = () => go(thisStart);
    el.querySelector('#w-jump').onchange = (e) => { if (e.target.value) go(periodStart(scope, e.target.value)); };
    el.querySelectorAll('[data-scope]').forEach((b) => (b.onclick = () => setScope(b.dataset.scope)));
    el.querySelectorAll('[data-period]').forEach((b) => (b.onclick = () => setPeriod(b.dataset.period)));
    bindProjectionInputs();
  }

  function go(key) {
    start = key;
    fresh = true;
    setParams();
    draw();
  }

  function setScope(s) {
    if (s === scope) return;
    scope = s;
    start = periodStart(s, start); // land on the period that contains where we were
    fresh = true;
    setParams();
    draw();
  }

  function setPeriod(p) {
    if (p === period) return;
    period = p;
    fresh = true;
    setParams();
    draw();
  }

  function setParams() {
    AD.setParams({ week: start === periodStart(scope, T.todayKey()) ? '' : start, period: period === 'month' ? '' : period, scope: scope === 'year' ? '' : scope });
  }

  /** One row per calendar month over the trailing year, each bar split planned against unplanned. */
  function months(end) {
    const pts = monthlyPoints(end);
    const anyFuel = pts.some((p) => p.fuel > 0);
    const top = Math.max(...pts.map((p) => p.grand), 1);
    const pct = (v) => (v / top) * 100;
    const rows = pts.map((p, i) => `
      <div class="hb-row" ${V.tipAttr(p.full, [
        ['Planned', L.fmtAUD(p.planned), COLOR_PLANNED],
        ['Unplanned', L.fmtAUD(p.unplanned), COLOR_UNPLANNED],
        ...(p.fuel ? [['Fuel', L.fmtAUD(p.fuel), COLOR_FUEL]] : []),
        ['Total', L.fmtAUD(p.grand), 'var(--ink)']
      ])}>
        <span class="hb-label">${esc(p.short)}</span>
        <span class="cs-mbar" style="--i:${i}">
          ${p.planned ? `<i style="width:${pct(p.planned)}%;background:${COLOR_PLANNED}"></i>` : ''}
          ${p.unplanned ? `<i style="width:${pct(p.unplanned)}%;background:${COLOR_UNPLANNED}"></i>` : ''}
          ${p.fuel ? `<i style="width:${pct(p.fuel)}%;background:${COLOR_FUEL}"></i>` : ''}
        </span>
        <span class="hb-val">${p.grand ? L.fmtAUD(p.grand) : '—'}</span>
      </div>`).join('');
    const legend = [{ label: 'Planned servicing', color: COLOR_PLANNED }, { label: 'Unplanned repairs', color: COLOR_UNPLANNED }];
    if (anyFuel) legend.push({ label: 'Fuel', color: COLOR_FUEL });
    return `<figure class="viz-card">
      <figcaption><h3>Month by month</h3><span class="viz-sub">${TREND_MONTHS} months to ${T.fmtKey(end)} · servicing, repairs${anyFuel ? ' and fuel' : ''}</span></figcaption>
      ${V.legend(legend, { counts: false })}
      <div class="hb cs-months">${rows}</div>
      ${anyFuel
        ? V.table(['Month', 'Planned', 'Unplanned', 'Fuel', 'Total'], pts.map((p) => [p.full, L.fmtAUD(p.planned), L.fmtAUD(p.unplanned), L.fmtAUD(p.fuel), L.fmtAUD(p.grand)]))
        : V.table(['Month', 'Planned', 'Unplanned', 'Total'], pts.map((p) => [p.full, L.fmtAUD(p.planned), L.fmtAUD(p.unplanned), L.fmtAUD(p.total)]))}
    </figure>`;
  }

  /** A round axis ceiling above `max`, so ticks read as clean numbers rather than the raw data max. */
  function niceTop(max) {
    if (max <= 0) return 1;
    const step = max > 20000 ? 5000 : max > 8000 ? 2000 : max > 2000 ? 500 : max > 400 ? 100 : 20;
    return Math.ceil(max / step) * step;
  }
  const fmtAxis = (n) => '$' + Math.round(n).toLocaleString('en-AU');

  /** TREND_WEEKS weekly totals ending with (and including) the week on screen. */
  function weeklyPoints(end) {
    let lastMonth = null;
    return Array.from({ length: TREND_WEEKS }, (_, i) => {
      const from = T.addDays(end, -6 - 7 * (TREND_WEEKS - 1 - i));
      const p = T.parseKey(from);
      const showMonth = p.m !== lastMonth;
      lastMonth = p.m;
      const rows = rowsBetween(from, T.addDays(from, 6));
      const maint = sum(rows), fuel = fuelBetween(from, T.addDays(from, 6));
      return {
        total: maint, maint, fuel, grand: maint + fuel, planned: sumKind(rows, PLANNED), unplanned: sumKind(rows, UNPLANNED),
        label: showMonth ? `${p.d} ${T.MONTHS[p.m - 1].slice(0, 3)}` : String(p.d), full: `Week of ${T.fmtKey(from)}`
      };
    });
  }

  /** TREND_MONTHS calendar-month totals ending with the month that contains `end`. */
  function monthlyPoints(end) {
    const { y, m } = T.parseKey(end);
    return Array.from({ length: TREND_MONTHS }, (_, i) => {
      const dt = new Date(Date.UTC(y, m - 1 - (TREND_MONTHS - 1 - i), 1));
      const key = dt.toISOString().slice(0, 7);
      const rows = rowsForMonth(key);
      const maint = sum(rows), fuel = fuelForMonth(key);
      return {
        total: maint, maint, fuel, grand: maint + fuel, planned: sumKind(rows, PLANNED), unplanned: sumKind(rows, UNPLANNED),
        label: T.MONTHS[dt.getUTCMonth()].slice(0, 3),
        short: `${T.MONTHS[dt.getUTCMonth()].slice(0, 3)} ${String(dt.getUTCFullYear()).slice(2)}`,
        full: `${T.MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`
      };
    });
  }

  /** Projected future months — one flat forecast value per month. */
  function projectedMonths(end) {
    const { y, m } = T.parseKey(end);
    const recent = Array.from({ length: 3 }, (_, i) => {
      const dt = new Date(Date.UTC(y, m - 1 - i, 1));
      const key = dt.toISOString().slice(0, 7);
      return sum(rowsForMonth(key)) + fuelForMonth(key); // forecast total cost incl fuel
    });
    const avgTotal = avgOf(recent);
    return Array.from({ length: PROJ_MONTHS }, (_, i) => {
      const dt = new Date(Date.UTC(y, m + i, 1));
      const key = T.MONTHS[dt.getUTCMonth()] + ' ' + dt.getUTCFullYear();
      const total = projOverrides[key] != null ? projOverrides[key] : avgTotal;
      return {
        total, maint: total, fuel: 0, grand: total, planned: total, unplanned: 0,
        label: T.MONTHS[dt.getUTCMonth()].slice(0, 3),
        short: T.MONTHS[dt.getUTCMonth()].slice(0, 3) + ' ' + String(dt.getUTCFullYear()).slice(2),
        full: key + ' (forecast)',
        key, defaultTotal: avgTotal,
        projected: true
      };
    });
  }

  /** Weekly or monthly spend leading up to the week on screen — the trend a single week-to-week comparison can't show.
   *  In monthly mode the chart extends with a dashed projection line. */
  function trend(end) {
    const isMonthly = period === 'month';
    const actuals = isMonthly ? monthlyPoints(end) : weeklyPoints(end);
    const proj = isMonthly ? projectedMonths(end) : [];
    const points = actuals.concat(proj);
    const splitIdx = actuals.length - 1;
    const hasProj = proj.length > 0;

    const anyFuel = points.some((p) => p.fuel > 0);
    const top = niceTop(Math.max(...points.map((p) => p.grand), 1) * 1.15);
    const W = 880, H = 184, padL = 56, padR = 12, padT = 16, padB = 26;
    const plotW = W - padL - padR, plotH = H - padT - padB, n = points.length;
    const x = (i) => padL + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
    const y = (v) => padT + plotH - (Math.min(v, top) / top) * plotH;
    // coords is the top (grand) line — marks, forecast and dots ride on it.
    const coords = points.map((p, i) => ({ x: x(i), y: y(p.grand) }));
    const maintCoords = points.map((p, i) => ({ x: x(i), y: y(p.maint) }));
    const plannedCoords = points.map((p, i) => ({ x: x(i), y: y(p.planned) }));
    const clampY = (v) => Math.max(padT, Math.min(padT + plotH, v));
    const spline = (pts) => pts.length < 2 ? `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}` : pts.reduce((d, p1, i) => {
      if (i === pts.length - 1) return d;
      const p0 = pts[i - 1] || p1;
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c1y = clampY(p1.y + (p2.y - p0.y) / 6);
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = clampY(p2.y - (p3.y - p1.y) / 6);
      return `${d} C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }, `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`);
    const floorY = (padT + plotH).toFixed(1);

    // Separate paths for historical vs forecast so fills and glow can't bleed
    const histCoords = hasProj ? coords.slice(0, splitIdx + 1) : coords;          // grand (top)
    const histMaint = hasProj ? maintCoords.slice(0, splitIdx + 1) : maintCoords;  // planned + unplanned
    const histPlanned = hasProj ? plannedCoords.slice(0, splitIdx + 1) : plannedCoords;
    const histGrandD = spline(histCoords);
    const histMaintD = spline(histMaint);
    const histPlannedD = spline(histPlanned);
    const histLineD = histMaintD; // the maintenance total line keeps its amber styling
    const areaD = `${histPlannedD} L${histPlanned[histPlanned.length - 1].x.toFixed(1)},${floorY} L${histPlanned[0].x.toFixed(1)},${floorY} Z`;
    const bandD = `${histMaintD} ${spline([...histPlanned].reverse()).replace(/^M/, 'L')} Z`;     // unplanned: planned → maint
    const fuelBandD = anyFuel ? `${histGrandD} ${spline([...histMaint].reverse()).replace(/^M/, 'L')} Z` : ''; // fuel: maint → grand
    // Forecast: standalone zone after NOW — NOT connected to the actuals
    const projCoords = hasProj ? coords.slice(splitIdx + 1) : [];
    const projLineD = projCoords.length >= 2 ? spline(projCoords) : (projCoords.length === 1 ? `M${projCoords[0].x.toFixed(1)},${projCoords[0].y.toFixed(1)}` : '');
    const projAreaD = projCoords.length ? `${projLineD.replace(/^M/, 'M')} L${projCoords[projCoords.length - 1].x.toFixed(1)},${floorY} L${projCoords[0].x.toFixed(1)},${floorY} Z` : '';
    const gridY = [0, 0.5, 1].map((f) => padT + plotH * (1 - f));
    const hline = (gy, cls) => `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}" class="${cls}"></line>`;
    const grid = gridY.map((gy) => hline(gy, 'cs-grid')).join('')
      + [0.25, 0.75].map((f) => hline(padT + plotH * (1 - f), 'cs-grid cs-grid-minor')).join('')
      + coords.map((p) => `<line x1="${p.x.toFixed(1)}" y1="${padT}" x2="${p.x.toFixed(1)}" y2="${padT + plotH}" class="cs-grid cs-grid-x"></line>`).join('');
    const yTicks = [0, top / 2, top].map((v, i) => `<text class="cs-axis-y" x="${padL - 8}" y="${(gridY[i] + 4).toFixed(1)}" text-anchor="end">${fmtAxis(v)}</text>`).join('');

    // X-axis labels — show the year suffix only at transitions so months don't repeat ambiguously
    let lastYr = '';
    const xTicks = points.map((p, i) => {
      let txt = p.label;
      if (hasProj && p.short) {
        const yr = p.short.split(' ')[1] || '';
        if (yr !== lastYr) { txt += " '" + yr; lastYr = yr; }
      }
      return `<text class="cs-axis-x${p.projected ? ' cs-proj-label' : ''}" x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(txt)}</text>`;
    }).join('');

    // "Now" vertical marker
    const nowX = hasProj ? x(splitIdx).toFixed(1) : null;
    const nowMarker = nowX
      ? `<line x1="${nowX}" y1="${padT}" x2="${nowX}" y2="${padT + plotH}" class="cs-now-line"></line>
         <text class="cs-now-label" x="${nowX}" y="${padT - 4}" text-anchor="middle">Now</text>` : '';

    // Each stacked line gets its own hover dot, in its own color, at its own
    // height — showing what that line is made of plus the running total,
    // rather than one ball on the top (grand) line standing in for all three.
    const seriesDots = (seriesCoords, colorVar, tipRow) => seriesCoords.map((c, i) => {
      const p = points[i];
      const isLast = i === splitIdx;
      const cx = c.x.toFixed(1), cy = c.y.toFixed(1);
      return `<g class="cs-mark${isLast ? ' cs-current' : ''}" style="--i:${i};--cs-line:${colorVar}">
        ${isLast ? `<circle cx="${cx}" cy="${cy}" r="9" class="cs-halo"></circle>` : ''}
        <circle cx="${cx}" cy="${cy}" r="4" class="cs-dot"></circle>
        <circle cx="${cx}" cy="${cy}" r="10" class="cs-hit" ${V.tipAttr(p.full, [tipRow(p), ['Total', L.fmtAUD(p.grand), 'var(--ink)']])}></circle>
      </g>`;
    }).join('');
    const plannedDots = seriesDots(histPlanned, COLOR_PLANNED, (p) => ['Planned servicing', L.fmtAUD(p.planned), COLOR_PLANNED]);
    const maintDots = seriesDots(histMaint, COLOR_UNPLANNED, (p) => ['Unplanned repairs', L.fmtAUD(p.unplanned), COLOR_UNPLANNED]);
    const grandDots = anyFuel ? seriesDots(histCoords, COLOR_FUEL, (p) => ['Fuel', L.fmtAUD(p.fuel), COLOR_FUEL]) : '';
    const projMarks = projCoords.map((c, j) => {
      const p = points[splitIdx + 1 + j];
      const cx = c.x.toFixed(1), cy = c.y.toFixed(1);
      return `<g class="cs-mark cs-proj-mark" style="--i:${splitIdx + 1 + j}">
        <circle cx="${cx}" cy="${cy}" r="4" class="cs-dot"></circle>
        <circle cx="${cx}" cy="${cy}" r="16" class="cs-hit" ${V.tipAttr(p.full, [['Forecast', L.fmtAUD(p.total), 'var(--violet)']])}></circle>
      </g>`;
    }).join('');
    const marks = plannedDots + maintDots + grandDots + projMarks;
    const ariaDesc = points.map((p) => `${p.full}: ${L.fmtAUD(p.grand)} total, ${L.fmtAUD(p.fuel)} fuel, ${L.fmtAUD(p.unplanned)} unplanned`).join(', ');

    const fuelLayer = fuelBandD
      ? `<path d="${fuelBandD}" class="cs-band-fuel"></path>
         <path d="${histGrandD}" class="cs-line-grand" pathLength="1"></path>`
      : '';
    let svgBody;
    if (hasProj) {
      svgBody = `${grid}
          <path d="${areaD}" class="cs-area"></path>
          <path d="${bandD}" class="cs-band"></path>
          ${fuelLayer}
          <path d="${histPlannedD}" class="cs-line-planned" pathLength="1"></path>
          <path d="${histLineD}" class="cs-line-path" pathLength="1"></path>
          <g class="cs-proj-g">
            ${projAreaD ? `<path d="${projAreaD}" class="cs-proj-area"></path>` : ''}
            ${projLineD ? `<path d="${projLineD}" class="cs-line-path" pathLength="1"></path>` : ''}
          </g>
          ${nowMarker}
          ${yTicks}${xTicks}${marks}`;
    } else {
      svgBody = `${grid}
          <path d="${areaD}" class="cs-area"></path>
          <path d="${bandD}" class="cs-band"></path>
          ${fuelLayer}
          <path d="${histPlannedD}" class="cs-line-planned" pathLength="1"></path>
          <path d="${histLineD}" class="cs-line-path" pathLength="1"></path>
          ${yTicks}${xTicks}${marks}`;
    }

    const legendItems = [
      { label: 'Planned servicing', color: COLOR_PLANNED },
      { label: 'Unplanned repairs', color: COLOR_UNPLANNED }
    ];
    if (anyFuel) legendItems.push({ label: 'Fuel (imported)', color: COLOR_FUEL });
    if (hasProj) legendItems.push({ label: 'Forecast', color: 'var(--violet)' });

    return `<figure class="viz-card">
      <figcaption><h3>Spend over time</h3><span class="viz-sub">${isMonthly ? TREND_MONTHS + ' months' : TREND_WEEKS + ' weeks'} to ${T.fmtKey(end)}${hasProj ? ' + ' + PROJ_MONTHS + '-month forecast' : ''}</span></figcaption>
      <div class="seg cs-period" role="group" aria-label="Chart period">
        <button type="button" data-period="week" class="${period === 'week' ? 'on' : ''}">Weekly</button>
        <button type="button" data-period="month" class="${period === 'month' ? 'on' : ''}">Monthly</button>
      </div>
      ${V.legend(legendItems, { counts: false })}
      <div class="cs-line-wrap">
        <svg viewBox="0 0 ${W} ${H}" class="cs-line-svg" role="img" aria-label="${esc('Spend per ' + period + ': ' + ariaDesc)}">
          <defs>
            <linearGradient id="cs-area-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style="stop-color:var(--mint);stop-opacity:.38"></stop>
              <stop offset="40%" style="stop-color:var(--mint);stop-opacity:.18"></stop>
              <stop offset="100%" style="stop-color:var(--mint);stop-opacity:0"></stop>
            </linearGradient>
            <linearGradient id="cs-band-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style="stop-color:var(--cs-amber);stop-opacity:.36"></stop>
              <stop offset="50%" style="stop-color:var(--cs-amber);stop-opacity:.16"></stop>
              <stop offset="100%" style="stop-color:var(--cs-amber);stop-opacity:.05"></stop>
            </linearGradient>
            <linearGradient id="cs-band-fuel-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style="stop-color:var(--cs-blue);stop-opacity:.32"></stop>
              <stop offset="60%" style="stop-color:var(--cs-blue);stop-opacity:.14"></stop>
              <stop offset="100%" style="stop-color:var(--cs-blue);stop-opacity:.04"></stop>
            </linearGradient>
            <linearGradient id="cs-proj-area-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style="stop-color:var(--violet);stop-opacity:.30"></stop>
              <stop offset="50%" style="stop-color:var(--violet);stop-opacity:.12"></stop>
              <stop offset="100%" style="stop-color:var(--violet);stop-opacity:0"></stop>
            </linearGradient>
            <filter id="cs-glow-mint" x="-12%" y="-12%" width="124%" height="124%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur"/>
              <feFlood flood-color="var(--mint)" flood-opacity=".45"/>
              <feComposite in2="blur" operator="in"/>
              <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <filter id="cs-glow-amber" x="-12%" y="-12%" width="124%" height="124%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur"/>
              <feFlood flood-color="var(--cs-amber)" flood-opacity=".4"/>
              <feComposite in2="blur" operator="in"/>
              <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <filter id="cs-glow-blue" x="-12%" y="-12%" width="124%" height="124%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur"/>
              <feFlood flood-color="var(--cs-blue)" flood-opacity=".4"/>
              <feComposite in2="blur" operator="in"/>
              <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <filter id="cs-glow-violet" x="-12%" y="-12%" width="124%" height="124%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur"/>
              <feFlood flood-color="var(--violet)" flood-opacity=".5"/>
              <feComposite in2="blur" operator="in"/>
              <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>
          ${svgBody}
        </svg>
      </div>
      ${anyFuel
        ? V.table([isMonthly ? 'Month' : 'Week starting', 'Planned', 'Unplanned', 'Fuel', 'Total'],
          points.map((p) => [p.full, L.fmtAUD(p.planned), L.fmtAUD(p.unplanned), L.fmtAUD(p.fuel), L.fmtAUD(p.grand)]))
        : V.table([isMonthly ? 'Month' : 'Week starting', 'Planned', 'Unplanned', 'Total'],
          points.map((p) => [p.full, L.fmtAUD(p.planned), L.fmtAUD(p.unplanned), L.fmtAUD(p.total)]))}
    </figure>`;
  }

  function projection(end) {
    if (period !== 'month') return '';
    const proj = projectedMonths(end);
    if (!proj.length) return '';
    const hasOverrides = Object.keys(projOverrides).length > 0;
    let running = 0;
    const rows = proj.map((p, i) => {
      running += p.total;
      const edited = projOverrides[p.key] != null;
      return `<tr${edited ? ' class="cs-proj-edited"' : ''}>
        <td>${esc(p.key)}</td>
        <td><input type="number" class="cs-proj-input" data-idx="${i}" value="${Math.round(p.total)}" step="100" min="0"></td>
        <td>${L.fmtAUD(running)}</td>
      </tr>`;
    }).join('');
    return `<section class="cs-proj-section" id="cs-proj-section">
      <figure class="viz-card cs-proj-card">
        <figcaption>
          <h3>Forecast</h3>
          <span class="viz-sub">${PROJ_MONTHS}-month forecast · edit to adjust the chart${hasOverrides ? ' · <button type="button" class="link-btn cs-proj-reset" id="cs-proj-reset">reset to average</button>' : ''}</span>
        </figcaption>
        <table class="cs-proj-table">
          <thead><tr><th>Month</th><th>Forecast spend</th><th>Running total</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td>${PROJ_MONTHS}-month total</td><td></td><td class="cs-proj-total">${L.fmtAUD(running)}</td></tr></tfoot>
        </table>
      </figure>
    </section>`;
  }

  function bindProjectionInputs() {
    const section = root.querySelector('#cs-proj-section');
    if (!section) return;
    const proj = projectedMonths(end);
    section.querySelectorAll('.cs-proj-input').forEach((inp) => {
      inp.addEventListener('change', () => {
        const idx = +inp.dataset.idx;
        const val = Math.max(0, parseFloat(inp.value) || 0);
        const p = proj[idx];
        if (!p) return;
        if (Math.abs(val - p.defaultTotal) < 0.5) { delete projOverrides[p.key]; }
        else { projOverrides[p.key] = val; }
        saveOverrides();
        draw();
      });
    });
    const resetBtn = section.querySelector('#cs-proj-reset');
    if (resetBtn) resetBtn.onclick = () => { projOverrides = {}; saveOverrides(); draw(); };
  }

  /**
   * The few vehicles whose spend moved furthest from their own weekly average —
   * the ones that explain the headline figure. A vehicle that didn't move says
   * nothing, so it stays out of the chart and only appears in the table view.
   */
  function movers(now, base) {
    const cfg = SCOPE_CFG[scope];
    const avgLabel = `${cfg.baselineN}-${cfg.label} average`;
    const baseIds = base.flatMap((w) => w.rows.map((r) => r.vehicleId));
    const ids = [...new Set(now.map((r) => r.vehicleId).concat(baseIds))];
    const lines = ids.map((id) => {
      const mine = now.filter((r) => r.vehicleId === id);
      const a = sum(mine);
      const b = avgOf(base.map((w) => sum(w.rows.filter((r) => r.vehicleId === id))));
      return { id, a, b, change: a - b, jobs: mine.length };
    }).sort((x, y) => y.change - x.change);
    const net = lines.reduce((n, r) => n + r.change, 0);
    const movedAll = lines.filter((r) => Math.abs(r.change) >= 1);
    const moved = [...movedAll].sort((x, y) => Math.abs(y.change) - Math.abs(x.change))
      .slice(0, MOVERS_MAX).sort((x, y) => y.change - x.change);
    const maxChange = Math.max(...moved.map((r) => Math.abs(r.change)), 1);

    const rows = moved.map((r, i) => {
      const up = r.change > 0;
      const pct = (Math.abs(r.change) / maxChange) * 50;
      return `<a class="cs-row" href="${vehHref(r.id)}" style="--i:${i}" ${V.tipAttr(r.id, [
        [`This ${cfg.label}`, L.fmtAUD(r.a), up ? 'var(--red)' : 'var(--green)'],
        [avgLabel, L.fmtAUD(r.b), 'var(--muted)']
      ])}>
        <span class="id">${esc(r.id)}</span>
        <span class="cs-hbar cs-diverge"><i class="${up ? 'cs-up' : 'cs-down'}" style="${up ? 'left' : 'right'}:50%;width:${pct}%"></i></span>
        <span class="cs-row-val ${changeTone(r.change)}">${fmtChange(r.change)}</span>
        <span class="cs-row-meta">${L.fmtAUD(r.a)} this ${cfg.label} · ${L.fmtAUD(r.b)} average${r.jobs ? ` · ${r.jobs} job${r.jobs === 1 ? '' : 's'}` : ''}</span>
      </a>`;
    }).join('');

    return `<figure class="viz-card">
      <figcaption><h3>What moved this ${cfg.label}</h3><span class="viz-sub">Each vehicle against its own ${avgLabel} · fleet ${Math.abs(net) < 0.005 ? 'unchanged' : fmtChange(net)} overall</span></figcaption>
      ${rows ? `<div class="cs-rows">${rows}</div>` : `<p class="empty">No vehicle’s spend moved against its average this ${cfg.label}.</p>`}
      ${movedAll.length > moved.length ? `<p class="cs-more">${movedAll.length - moved.length} more moved by less — open the table to see them.</p>` : ''}
      ${lines.length ? V.table(['Vehicle', 'Jobs', `This ${cfg.label}`, avgLabel, 'Change'],
        lines.map((r) => [r.id, String(r.jobs), L.fmtAUD(r.a), L.fmtAUD(r.b), fmtChange(r.change)])) : ''}
    </figure>`;
  }

  /**
   * Cost against actual use. Spend over the trailing year divided by the
   * distance the vehicle actually drove in that time (from the telematics
   * usage rate), giving a real cost per kilometre — and flagging the two
   * cases that matter: vehicles that are expensive per km, and vehicles that
   * barely move yet still cost money. Only covers vehicles with a usage rate
   * (i.e. GPS-tracked with enough history); the rest have nothing to divide by.
   */
  function costVsUsage(end) {
    const MIN_SPAN_DAYS = MIN_USAGE_SPAN_DAYS, THIN_SPAN_DAYS = THIN_USAGE_SPAN_DAYS;
    const maxWindowDays = RUN_WEEKS * 7;
    const fmtKmRate = (n) => '$' + (n >= 10 ? Math.round(n).toLocaleString('en-AU') : n.toFixed(2));

    // Per vehicle, measure over its OWN honest window — the span we actually
    // have data for — rather than extrapolating a short GPS sample out to 52
    // fake weeks. When both km and hours data exist, use the SHORTER of the
    // two spans so spend, km, and hours all cover the same real period and
    // the rates are comparable.
    const lines = AD.store.all('vehicles').filter((v) => !v.hired).map((v) => {
      const u = L.usageRate(v);                                     // km rate from odometer history
      const wh = L.workHours(v);                                    // engine hours from telematics
      if (!u && !wh) return null;

      const kmSpan = u ? Math.min(maxWindowDays, u.days) : 0;
      const hrSpan = wh ? Math.min(maxWindowDays, wh.days) : 0;
      // When we have both, use the shorter — both rates then share one honest window.
      const span = u && wh ? Math.min(kmSpan, hrSpan)
        : u ? kmSpan : hrSpan;
      if (span < MIN_SPAN_DAYS) return null;                        // not enough data to trust a rate

      const from = T.addDays(end, -(span - 1));
      const maintRows = rowsBetween(from, end).filter((r) => r.vehicleId === v.id);
      const maintSpend = maintRows.reduce((n, r) => n + r.cost, 0);
      const unplanned = maintRows.filter((r) => r.kind === UNPLANNED).reduce((n, r) => n + r.cost, 0);
      const fuel = fuelRows().filter((r) => r.vehicleId === v.id && r.date >= from && r.date <= end).reduce((n, r) => n + r.cost, 0);
      const spend = maintSpend + fuel;

      let perKm = null, windowKm = null;
      if (u) {
        windowKm = u.perDay * span;
        if (windowKm > 0) perKm = spend / windowKm;
      }
      let perHour = null, windowHrs = null;
      if (wh) {
        windowHrs = wh.perDay * span;
        if (windowHrs > 0) perHour = spend / windowHrs;
      }
      if (perKm == null && perHour == null) return null;

      return { v, spend, fuel, unplanned,
               span, kmSpan, hrSpan,
               perDay: u ? u.perDay : null, perWeek: u ? u.perWeek : null,
               windowKm, perKm,
               hrsWeek: wh ? wh.perWeek : null, windowHrs, perHour,
               thin: span < THIN_SPAN_DAYS };
    }).filter(Boolean).sort((a, b) => (b.perKm || 0) - (a.perKm || 0));
    const anyHours = lines.some((l) => l.perHour != null);

    if (!lines.length) {
      return `<section class="section">
        ${sectionHead({ title: 'Cost vs usage', meta: 'Spend per kilometre actually driven' })}
        <figure class="viz-card"><p class="empty">No usage data yet. Once vehicles have at least ${MIN_SPAN_DAYS} days of GPS-synced odometer or engine-hour history, their cost per kilometre or hour appears here.</p></figure>
      </section>`;
    }

    const medKm = median(lines.filter((l) => l.perKm != null).map((l) => l.perKm));
    const medUse = median(lines.filter((l) => l.perDay != null).map((l) => l.perDay));
    const top = Math.max(...lines.map((l) => l.perKm || 0), 0.0001);

    const fmtSpan = (days) => days >= 49 ? `${Math.round(days / 7)} weeks` : `${days} days`;

    const rows = lines.map((l, i) => {
      const costly = l.perKm != null && medKm > 0 && l.perKm > medKm * 1.3;
      const lowUse = l.perDay != null && medUse > 0 && l.perDay < medUse * 0.6;
      const flag = l.thin ? '<span class="cs-flag cs-flag-soft">Thin data</span>'
        : costly && lowUse ? '<span class="cs-flag">Low use · high cost</span>'
        : costly ? '<span class="cs-flag">Costly per km</span>'
        : lowUse ? '<span class="cs-flag cs-flag-soft">Low use</span>' : '';
      const tipRows = [
        ...(l.perKm != null ? [['Cost per km', fmtKmRate(l.perKm), 'var(--cs-amber)']] : []),
        ...(l.perHour != null ? [['Cost per hour', fmtKmRate(l.perHour), 'var(--cs-amber)']] : []),
        [`Spend (${fmtSpan(l.span)})`, L.fmtAUD(l.spend), 'var(--muted)'],
        ...(l.fuel ? [['of which fuel', L.fmtAUD(l.fuel), COLOR_FUEL]] : []),
        ...(l.windowKm != null ? [['Driven', `${Math.round(l.windowKm).toLocaleString('en-AU')} km`, 'var(--mint)']] : []),
        ...(l.windowHrs != null ? [['Engine hours', `${Math.round(l.windowHrs).toLocaleString('en-AU')} hrs`, 'var(--mint)']] : [])
      ];
      const barPct = l.perKm != null ? (l.perKm / top) * 100 : 0;
      const val = l.perKm != null ? `${fmtKmRate(l.perKm)}<small>/km</small>` : `${fmtKmRate(l.perHour)}<small>/hr</small>`;
      return `<a class="cs-row" href="${vehHref(l.v.id)}" style="--i:${i}" ${V.tipAttr(l.v.id, tipRows)}>
        <span class="id">${esc(l.v.id)}</span>
        <span class="cs-hbar"><i${costly ? ' class="cs-high"' : ''} style="width:${barPct}%"></i>${medKm > 0 ? `<b class="cs-median" style="left:${(medKm / top) * 100}%"></b>` : ''}</span>
        <span class="cs-row-val">${val}</span>
        <span class="cs-row-meta">${flag ? flag + ' · ' : ''}${L.fmtAUD(l.spend)} over ${fmtSpan(l.span)}${l.perWeek != null ? ` · ~${Math.round(l.perWeek).toLocaleString('en-AU')} km/week` : ''}${l.perHour != null ? ` · ${fmtKmRate(l.perHour)}/hr · ~${Math.round(l.hrsWeek).toLocaleString('en-AU')} hrs/week` : ''}</span>
      </a>`;
    }).join('');

    const anyFuel = lines.some((l) => l.fuel > 0);
    const tableHead = ['Vehicle', 'Cost / km', anyHours ? 'Cost / hr' : null, 'Window', 'Spend', anyFuel ? 'Fuel' : null, 'Unplanned', 'Driven', 'Per week', anyHours ? 'Hrs / week' : null].filter(Boolean);
    const tableRows = lines.map((l) => [l.v.id,
      l.perKm != null ? fmtKmRate(l.perKm) : '—',
      anyHours ? (l.perHour != null ? fmtKmRate(l.perHour) : '—') : null,
      fmtSpan(l.span),
      L.fmtAUD(l.spend), anyFuel ? L.fmtAUD(l.fuel) : null, L.fmtAUD(l.unplanned),
      l.windowKm != null ? `${Math.round(l.windowKm).toLocaleString('en-AU')} km` : '—',
      l.perWeek != null ? `${Math.round(l.perWeek).toLocaleString('en-AU')} km` : '—',
      anyHours ? (l.hrsWeek != null ? Math.round(l.hrsWeek).toLocaleString('en-AU') : '—') : null].filter((x) => x !== null));

    const spans = lines.map((l) => l.span);
    const spanMin = Math.min(...spans), spanMax = Math.max(...spans);
    const spanLabel = spanMin === spanMax ? fmtSpan(spanMin) : `${fmtSpan(spanMin)}–${fmtSpan(spanMax)}`;

    return `<section class="section">
      ${sectionHead({ title: 'Cost vs usage', meta: `${lines.length} GPS-tracked vehicle${lines.length === 1 ? '' : 's'} · spend (incl. fuel) ÷ distance driven${anyHours ? ' / engine hours' : ''} over each vehicle's measurement window (${spanLabel}) · the tick marks the median` })}
      <figure class="viz-card">
        <figcaption><span class="viz-sub">A high cost per kilometre or hour, or a vehicle that barely moves yet still costs money, is a candidate to question, service, or replace. Each vehicle is measured only over the period we actually have GPS or engine-hour data for — no extrapolation.${anyHours ? ' Cost per hour counts stationary work, so it is the fairer measure for vac trucks.' : ''}</span></figcaption>
        <div class="cs-rows">${rows}</div>
        ${V.table(tableHead, tableRows)}
      </figure>
    </section>`;
  }

  /**
   * Fuel cost per km AND litres per 100km, each from REAL fuel matched to the
   * REAL distance driven over the exact days we have both (L.fuelEconomy uses
   * the daily GPS km, not an extrapolated rate). Only GPS-tracked vehicles have
   * daily km, so only they appear. Every row's tooltip shows the full
   * derivation — the fuel, the distance, the days, and the division itself — so
   * the number can be trusted at a glance.
   */
  function fuelPerKm() {
    const MIN_DAYS = 5, THIN_DAYS = 14;   // days of GPS readings needed before a rate is shown / is trustworthy
    const fmtFuelRate = (n) => '$' + (n >= 10 ? Math.round(n).toLocaleString('en-AU') : n.toFixed(2));
    const fmtL100 = (n) => n.toFixed(1) + ' L/100km';
    const km0 = (n) => Math.round(n).toLocaleString('en-AU');

    const lines = AD.store.all('vehicles').filter((v) => !v.hired).map((v) => {
      const fe = L.fuelEconomy(v);                    // null → no daily GPS km, so not shown at all
      if (!fe || fe.kmDaysWithData < MIN_DAYS) return null;
      return { v, fe, thin: fe.kmDaysWithData < THIN_DAYS };
    }).filter(Boolean).sort((a, b) => (b.fe.costPerKm || -1) - (a.fe.costPerKm || -1));

    if (!lines.length) {
      return `<section class="section">
        ${sectionHead({ title: 'Fuel cost per km', meta: 'Real fuel ÷ real distance driven' })}
        <figure class="viz-card"><p class="empty">No GPS-tracked vehicle has at least ${MIN_DAYS} days of daily distance data yet. As the nightly sync builds up daily kilometres for the vac trucks and tippers, their fuel cost per kilometre appears here.</p></figure>
      </section>`;
    }

    const withFuel = lines.filter((l) => l.fe.hasFuel && l.fe.costPerKm != null);
    const medKm = withFuel.length ? median(withFuel.map((l) => l.fe.costPerKm)) : 0;
    const top = Math.max(...withFuel.map((l) => l.fe.costPerKm), 0.0001);

    // The derivation tooltip — spells out exactly how the figure was reached.
    const tip = (l) => {
      const fe = l.fe;
      const window = `${fe.kmDaysWithData} day${fe.kmDaysWithData === 1 ? '' : 's'} · ${T.fmtKey(fe.fromKey)}–${T.fmtKey(fe.toKey)}`;
      if (!fe.hasFuel) {
        return V.tipAttr(l.v.id, [
          ['Distance (GPS)', `${km0(fe.kmTotal)} km`, 'var(--mint)'],
          ['Over', window, 'var(--muted)'],
          ['Fuel in this window', 'none imported', 'var(--muted)']
        ]);
      }
      return V.tipAttr(l.v.id, [
        ...(fe.costPerKm != null ? [['Fuel cost / km', fmtFuelRate(fe.costPerKm), COLOR_FUEL]] : []),
        ...(fe.litresPer100 != null ? [['Fuel economy', fmtL100(fe.litresPer100), COLOR_FUEL]] : []),
        ['Fuel used', `${fe.litres.toFixed(0)} L · ${L.fmtAUD(fe.fuelCost)}`, 'var(--muted)'],
        ['Transactions', `${fe.fuelTxns} fill${fe.fuelTxns === 1 ? '' : 's'}`, 'var(--muted)'],
        ['Distance (GPS)', `${km0(fe.kmTotal)} km`, 'var(--mint)'],
        ['Over', window, 'var(--muted)'],
        ...(fe.costPerKm != null ? [[`= ${L.fmtAUD(fe.fuelCost)} ÷ ${km0(fe.kmTotal)} km`, fmtFuelRate(fe.costPerKm) + '/km', 'var(--ink)']] : [])
      ]);
    };

    const rows = lines.map((l, i) => {
      const fe = l.fe;
      if (!fe.hasFuel || fe.costPerKm == null) {
        return `<a class="cs-row cs-row-muted" href="${vehHref(l.v.id)}" style="--i:${i}" ${tip(l)}>
          <span class="id">${esc(l.v.id)}</span>
          <span class="cs-hbar"></span>
          <span class="cs-row-val">—</span>
          <span class="cs-row-meta">No fuel in the GPS window · ${km0(fe.kmTotal)} km over ${fe.kmDaysWithData} days</span>
        </a>`;
      }
      const costly = medKm > 0 && fe.costPerKm > medKm * 1.3;
      const flag = l.thin ? '<span class="cs-flag cs-flag-soft">Thin data</span>'
        : costly ? '<span class="cs-flag">High fuel/km</span>' : '';
      const econ = fe.litresPer100 != null ? ` · ${fmtL100(fe.litresPer100)}` : '';
      return `<a class="cs-row" href="${vehHref(l.v.id)}" style="--i:${i}" ${tip(l)}>
        <span class="id">${esc(l.v.id)}</span>
        <span class="cs-hbar"><i${costly ? ' class="cs-high-fuel"' : ' class="cs-fuel"'} style="width:${(fe.costPerKm / top) * 100}%"></i>${medKm > 0 ? `<b class="cs-median" style="left:${(medKm / top) * 100}%"></b>` : ''}</span>
        <span class="cs-row-val">${fmtFuelRate(fe.costPerKm)}<small>/km</small></span>
        <span class="cs-row-meta">${flag ? flag + ' · ' : ''}${L.fmtAUD(fe.fuelCost)} fuel over ${km0(fe.kmTotal)} km${econ}</span>
      </a>`;
    }).join('');

    const tableRows = lines.map((l) => {
      const fe = l.fe;
      return [l.v.id,
        fe.costPerKm != null ? fmtFuelRate(fe.costPerKm) : '—',
        fe.litresPer100 != null ? fe.litresPer100.toFixed(1) : '—',
        fe.hasFuel ? L.fmtAUD(fe.fuelCost) : '—',
        fe.hasFuel ? fe.litres.toFixed(0) : '—',
        `${km0(fe.kmTotal)} km`,
        `${fe.kmDaysWithData} days`];
    });

    const daysArr = lines.map((l) => l.fe.kmDaysWithData);
    const dMin = Math.min(...daysArr), dMax = Math.max(...daysArr);
    const dayLabel = dMin === dMax ? `${dMin} days` : `${dMin}–${dMax} days`;

    return `<section class="section">
      ${sectionHead({ title: 'Fuel cost per km', meta: `${lines.length} GPS-tracked vehicle${lines.length === 1 ? '' : 's'} · real fuel ÷ real distance driven, matched day-for-day (${dayLabel} of data) · the tick marks the median` })}
      <figure class="viz-card">
        <figcaption><span class="viz-sub">Fuel-card spend divided by the distance the GPS actually recorded over the same days — no estimated kilometres. Hover any row to see the full working: the fuel, the distance, the days, and the division. Litres per 100km is the truer efficiency measure, since it ignores fuel-price swings.</span></figcaption>
        <div class="cs-rows">${rows}</div>
        ${V.table(['Vehicle', 'Fuel / km', 'L/100km', 'Fuel spend', 'Litres', 'Distance', 'GPS days'], tableRows)}
      </figure>
    </section>`;
  }

  /**
   * Fuel litres purchased per vehicle, most litres first — every vehicle with
   * imported fuel-card data, so the whole fuelled fleet shows (not just the
   * GPS-tracked ones). All-time across every imported transaction, independent
   * of the week/month/year selector above, so the totals are the full picture.
   * Hover shows the litres, the accumulated fuel cost, the number of fills and
   * the average price per litre.
   */
  function fuelLitreage() {
    const l0 = (n) => Math.round(n).toLocaleString('en-AU');
    const lines = AD.store.all('vehicles').filter((v) => !v.hired).map((v) => {
      const f = L.fuelFor(v); // no window → all-time
      if (!f || !(f.litres > 0)) return null;
      return { v, litres: f.litres, cost: f.cost, fills: f.count, cpl: f.litres > 0 ? f.cost / f.litres : null, lastDate: f.lastDate };
    }).filter(Boolean).sort((a, b) => b.litres - a.litres);

    if (!lines.length) {
      return `<section class="section">
        ${sectionHead({ title: 'Fuel purchased by vehicle', meta: 'Litres · all imported fuel-card data' })}
        <figure class="viz-card"><p class="empty">No fuel-card data imported yet. Use “Import cost data” at the top of the page to load a WEX or BP export.</p></figure>
      </section>`;
    }

    const top = Math.max(...lines.map((l) => l.litres), 1);
    const totalLitres = lines.reduce((n, l) => n + l.litres, 0);
    const totalCost = lines.reduce((n, l) => n + l.cost, 0);

    const rows = lines.map((l, i) => `<a class="cs-row" href="${vehHref(l.v.id)}" style="--i:${i}" ${V.tipAttr(l.v.id, [
      ['Litres purchased', l0(l.litres) + ' L', COLOR_FUEL],
      ['Fuel cost (total)', L.fmtAUD(l.cost), 'var(--cs-amber)'],
      ['Fills', String(l.fills), 'var(--muted)'],
      ...(l.cpl != null ? [['Average price', '$' + l.cpl.toFixed(2) + '/L', 'var(--muted)']] : []),
      ...(l.lastDate ? [['Last fill', T.fmtKey(l.lastDate), 'var(--muted)']] : [])
    ])}>
      <span class="id">${esc(l.v.id)}${l.v.rego ? `<small class="cs-rego">${esc(l.v.rego)}</small>` : ''}</span>
      <span class="cs-hbar"><i class="cs-fuel" style="width:${(l.litres / top) * 100}%"></i></span>
      <span class="cs-row-val">${l0(l.litres)}<small> L</small></span>
      <span class="cs-row-meta">${L.fmtAUD(l.cost)} total · ${l.fills} fill${l.fills === 1 ? '' : 's'}${l.cpl != null ? ` · $${l.cpl.toFixed(2)}/L avg` : ''}</span>
    </a>`).join('');

    const tableRows = lines.map((l) => [l.v.id, l.v.rego || '—', L.driverName(l.v.driverId) || '—',
      l0(l.litres) + ' L', L.fmtAUD(l.cost), String(l.fills),
      l.cpl != null ? '$' + l.cpl.toFixed(2) : '—', l.lastDate ? T.fmtKey(l.lastDate) : '—']);

    return `<section class="section">
      ${sectionHead({ title: 'Fuel purchased by vehicle', meta: `${lines.length} vehicle${lines.length === 1 ? '' : 's'} · ${l0(totalLitres)} L · ${L.fmtAUD(totalCost)} total · all imported fuel-card data` })}
      <figure class="viz-card">
        <figcaption><span class="viz-sub">Every vehicle with imported fuel-card data, most litres first. Hover any row for the litres purchased, the accumulated fuel cost, the number of fills and the average price per litre. This covers all imported transactions, not just the period selected above.</span></figcaption>
        <div class="cs-rows">${rows}</div>
        ${V.table(['Vehicle', 'Rego', 'Assigned driver', 'Litres', 'Fuel cost', 'Fills', 'Avg /L', 'Last fill'], tableRows)}
      </figure>
    </section>`;
  }

  return { title: 'Cost sheet', render, refresh: () => root && draw() };
})();
