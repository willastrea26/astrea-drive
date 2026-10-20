/* Cost sheet — what the fleet cost this week, measured against its average week. */
AD.views = AD.views || {};

AD.views['cost-sheet'] = (function () {
  const { esc, pageHeader, sectionHead } = AD.ui;
  const L = AD.logic, T = AD.time, I = AD.icons, V = AD.viz;
  const AVG_WEEKS = 4; // same trailing window the dashboard uses for its utilisation trend
  const RUN_WEEKS = 52; // running-cost window: a year of weeks, ending with the week on screen
  const RUN_MAX = 15; // running-cost rows shown; the count of the rest is stated beside it
  const TREND_WEEKS = 12; // Spend over time, weekly mode
  const TREND_MONTHS = 12; // Spend over time, monthly mode
  let root = null, start = '', period = 'week';

  const mondayOf = (key) => T.addDays(key, -T.dayOfWeek(key));

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
  const rowsFor = (from) => rowsBetween(from, T.addDays(from, 6));
  const rowsForMonth = (key) => allRows().filter((r) => r.date.slice(0, 7) === key);

  const sum = (rows) => rows.reduce((n, r) => n + r.cost, 0);
  const avgOf = (nums) => nums.reduce((a, b) => a + b, 0) / (nums.length || 1);

  /** The AVG_WEEKS weeks immediately before `before` — the baseline "an average week" is measured against. */
  function baseline(before) {
    return Array.from({ length: AVG_WEEKS }, (_, i) => {
      const from = T.addDays(before, -7 * (i + 1));
      return { from, rows: rowsFor(from) };
    });
  }

  /** 'worse' | 'better' | null (flat, untoned, or no baseline to compare against) — drives both the delta text and a card's accent. */
  function trendTone(now, avg, haveBaseline, toned) {
    if (!haveBaseline || !avg || !toned) return null;
    const pct = Math.round(((now - avg) / avg) * 100);
    return pct > 0 ? 'worse' : pct < 0 ? 'better' : null;
  }

  /** Change line under a figure, against the AVG_WEEKS average. `toned` marks a rise as worse — only money is judged. */
  function delta(now, avg, haveBaseline, fmt, toned) {
    if (!haveBaseline) return `<small class="cs-delta">${now ? `No weeks before this one yet` : 'Nothing recorded'}</small>`;
    if (!avg) return `<small class="cs-delta">${now ? `Nothing in the ${AVG_WEEKS}-week average` : 'Nothing either way'}</small>`;
    const pct = Math.round(((now - avg) / avg) * 100);
    const arrow = pct > 0 ? '↑' : pct < 0 ? '↓' : '—';
    const tone = trendTone(now, avg, haveBaseline, toned) || 'flat';
    return `<small class="cs-delta cs-delta-${tone}">${arrow} ${Math.abs(pct)}% · ${fmt(avg)} avg</small>`;
  }

  const TONE_VAR = { worse: 'var(--red)', better: 'var(--green)' };
  const kpi = (label, value, foot, tone) => `<div class="cs-kpi"${tone ? ` style="--cs-tone:${TONE_VAR[tone]}"` : ''}><span>${esc(label)}</span><strong>${value}</strong>${foot}</div>`;
  const fmtChange = (n) => Math.abs(n) < 0.005 ? '—' : (n > 0 ? '+' : '−') + L.fmtAUD(Math.abs(n));
  const changeTone = (n) => n > 0.005 ? 'cs-delta-worse' : n < -0.005 ? 'cs-delta-better' : '';

  function render(el, params) {
    root = el;
    start = /^\d{4}-\d{2}-\d{2}$/.test(params.week || '') ? mondayOf(params.week) : mondayOf(T.todayKey());
    period = params.period === 'month' ? 'month' : 'week';
    draw();
  }

  function draw() {
    const el = root;
    const thisWeek = mondayOf(T.todayKey());
    const end = T.addDays(start, 6);
    const now = rowsFor(start);
    const base = baseline(start);
    const haveBaseline = base.some((w) => w.rows.length);

    const spend = sum(now), avgSpend = avgOf(base.map((w) => sum(w.rows)));
    const jobs = now.length, avgJobs = avgOf(base.map((w) => w.rows.length));
    const perJob = jobs ? spend / jobs : 0, avgPerJob = avgJobs ? avgSpend / avgJobs : 0;
    const fleet = AD.store.all('vehicles').length;
    const vehicleCount = new Set(now.map((r) => r.vehicleId)).size;
    const avgVehicleCount = avgOf(base.map((w) => new Set(w.rows.map((r) => r.vehicleId)).size));

    el.innerHTML = `
      ${pageHeader({
        title: 'Cost sheet',
        sub: `${T.fmtKey(start)} – ${T.fmtKey(end)}${start === thisWeek ? ' · this week' : ''} · against the average of the ${AVG_WEEKS} weeks before`,
        actions: `<div class="seg" role="group" aria-label="Week">
            <button type="button" id="w-prev" aria-label="Previous week">${I.chevL}</button>
            <button type="button" id="w-this"${start === thisWeek ? ' class="on"' : ''}>This week</button>
            <button type="button" id="w-next" aria-label="Next week">${I.chevR}</button>
          </div>`
      })}

      <div class="cs-kpis" role="group" aria-label="This week against the average week">
        ${kpi('Total spend', L.fmtAUD(spend), delta(spend, avgSpend, haveBaseline, L.fmtAUD, true), trendTone(spend, avgSpend, haveBaseline, true))}
        ${kpi('Jobs recorded', String(jobs), delta(jobs, avgJobs, haveBaseline, (n) => n.toFixed(1), false))}
        ${kpi('Average per job', L.fmtAUD(perJob), delta(perJob, avgPerJob, haveBaseline, L.fmtAUD, true), trendTone(perJob, avgPerJob, haveBaseline, true))}
        ${kpi('Vehicles with costs', `${vehicleCount}`, `<small class="cs-delta">of ${fleet} in the fleet · ${haveBaseline ? avgVehicleCount.toFixed(1) + ' avg' : 'no prior weeks'}</small>`)}
      </div>

      ${days(now, base)}

      ${trend(end)}

      <section class="section">
        ${sectionHead({ title: 'By vehicle', meta: 'Biggest increases first' })}
        ${sheet(now, base)}
      </section>

      <section class="section">
        ${sectionHead({ title: 'Running cost', meta: `${RUN_WEEKS} weeks to ${T.fmtKey(end)} · dearest first` })}
        ${running(end)}
      </section>

      <p class="section-foot muted small">Spend is recorded services plus resolved defects, counted on the day the service was recorded or the defect was resolved. The average is the ${AVG_WEEKS} weeks before this one. Running cost divides a vehicle's spend by the distance or hours covered between its first and last service in the window, so it needs at least two services to show a rate.</p>`;

    el.querySelector('#w-prev').onclick = () => go(T.addDays(start, -7));
    el.querySelector('#w-next').onclick = () => go(T.addDays(start, 7));
    el.querySelector('#w-this').onclick = () => go(thisWeek);
    el.querySelectorAll('[data-period]').forEach((b) => (b.onclick = () => setPeriod(b.dataset.period)));
    el.querySelectorAll('tr[data-veh]').forEach((tr) => tr.addEventListener('click', () => AD.go('vehicle/' + tr.dataset.veh)));
  }

  function go(week) {
    start = week;
    setParams();
    draw();
  }

  function setPeriod(p) {
    if (p === period) return;
    period = p;
    setParams();
    draw();
  }

  function setParams() {
    AD.setParams({ week: start === mondayOf(T.todayKey()) ? '' : start, period: period === 'week' ? '' : period });
  }

  /** One row per weekday, this week's bar above the average for that weekday over the baseline weeks. */
  function days(now, base) {
    const byDay = (rows, from) => Array.from({ length: 7 }, (_, i) => sum(rows.filter((r) => r.date === T.addDays(from, i))));
    const a = byDay(now, start);
    const perWeek = base.map((w) => byDay(w.rows, w.from));
    const b = Array.from({ length: 7 }, (_, i) => avgOf(perWeek.map((week) => week[i])));
    const top = Math.max(...a, ...b, 1);
    const COLOR_NOW = 'var(--viz-confirmed)', COLOR_AVG = 'var(--viz-free-key)';
    const rows = a.map((v, i) => `
      <div class="hb-row" ${V.tipAttr(T.DOW[i], [['This week', L.fmtAUD(v), COLOR_NOW], [`${AVG_WEEKS}-week average`, L.fmtAUD(b[i]), COLOR_AVG]])}>
        <span class="hb-label">${T.DOW[i]}</span>
        <span class="hb-track cs-track">
          <i style="width:${(v / top) * 100}%;background:${COLOR_NOW}"></i>
          <i style="width:${(b[i] / top) * 100}%;background:${COLOR_AVG}"></i>
        </span>
        <span class="hb-val">${v ? L.fmtAUD(v) : '—'}</span>
      </div>`).join('');
    return `<figure class="viz-card">
      <figcaption><h3>Day by day</h3><span class="viz-sub">This week against the ${AVG_WEEKS}-week average</span></figcaption>
      ${V.legend([{ label: 'This week', color: COLOR_NOW }, { label: `${AVG_WEEKS}-week average`, color: COLOR_AVG }], { counts: false })}
      <div class="hb cs-days">${rows}</div>
      ${V.table(['Day', 'This week', `${AVG_WEEKS}-week average`], a.map((v, i) => [T.DOW[i], L.fmtAUD(v), L.fmtAUD(b[i])]))}
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
      return { total: sum(rowsBetween(from, T.addDays(from, 6))), label: showMonth ? `${p.d} ${T.MONTHS[p.m - 1].slice(0, 3)}` : String(p.d), full: `Week of ${T.fmtKey(from)}` };
    });
  }

  /** TREND_MONTHS calendar-month totals ending with the month that contains `end`. */
  function monthlyPoints(end) {
    const { y, m } = T.parseKey(end);
    return Array.from({ length: TREND_MONTHS }, (_, i) => {
      const dt = new Date(Date.UTC(y, m - 1 - (TREND_MONTHS - 1 - i), 1));
      const key = dt.toISOString().slice(0, 7);
      return {
        total: sum(rowsForMonth(key)), label: T.MONTHS[dt.getUTCMonth()].slice(0, 3),
        full: `${T.MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`
      };
    });
  }

  /** Weekly or monthly spend leading up to the week on screen — the trend a single week-to-week comparison can't show. */
  function trend(end) {
    const points = period === 'month' ? monthlyPoints(end) : weeklyPoints(end);
    const top = niceTop(Math.max(...points.map((p) => p.total), 1));
    const W = 760, H = 200, padL = 56, padR = 12, padT = 16, padB = 26;
    const plotW = W - padL - padR, plotH = H - padT - padB, n = points.length;
    const x = (i) => padL + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
    const y = (v) => padT + plotH - (Math.min(v, top) / top) * plotH;
    const lineD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.total).toFixed(1)}`).join(' ');
    const areaD = `${lineD} L${x(n - 1).toFixed(1)},${(padT + plotH).toFixed(1)} L${x(0).toFixed(1)},${(padT + plotH).toFixed(1)} Z`;
    const gridY = [0, 0.5, 1].map((f) => padT + plotH * (1 - f));
    const grid = gridY.map((gy) => `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}" class="cs-grid"></line>`).join('');
    const yTicks = [0, top / 2, top].map((v, i) => `<text class="cs-axis-y" x="${padL - 8}" y="${(gridY[i] + 4).toFixed(1)}" text-anchor="end">${fmtAxis(v)}</text>`).join('');
    const xTicks = points.map((p, i) => `<text class="cs-axis-x" x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(p.label)}</text>`).join('');
    const marks = points.map((p, i) => `
        <circle cx="${x(i).toFixed(1)}" cy="${y(p.total).toFixed(1)}" r="4" class="cs-dot"></circle>
        <circle cx="${x(i).toFixed(1)}" cy="${y(p.total).toFixed(1)}" r="14" class="cs-hit" ${V.tipAttr(p.full, [['Spend', L.fmtAUD(p.total), 'var(--viz-confirmed)']])}></circle>`).join('');
    const ariaDesc = points.map((p) => `${p.full}: ${L.fmtAUD(p.total)}`).join(', ');

    return `<figure class="viz-card">
      <figcaption><h3>Spend over time</h3><span class="viz-sub">${period === 'month' ? TREND_MONTHS + ' months' : TREND_WEEKS + ' weeks'} to ${T.fmtKey(end)}</span></figcaption>
      <div class="seg cs-period" role="group" aria-label="Chart period">
        <button type="button" data-period="week" class="${period === 'week' ? 'on' : ''}">Weekly</button>
        <button type="button" data-period="month" class="${period === 'month' ? 'on' : ''}">Monthly</button>
      </div>
      <div class="cs-line-wrap">
        <svg viewBox="0 0 ${W} ${H}" class="cs-line-svg" role="img" aria-label="${esc('Spend per ' + period + ': ' + ariaDesc)}">
          ${grid}
          <path d="${areaD}" class="cs-area"></path>
          <path d="${lineD}" class="cs-line-path"></path>
          ${yTicks}${xTicks}${marks}
        </svg>
      </div>
      ${V.table([period === 'month' ? 'Month' : 'Week starting', 'Spend'], points.map((p) => [p.full, L.fmtAUD(p.total)]))}
    </figure>`;
  }

  /** The sheet itself: a line per vehicle that cost something this week or in the baseline weeks. */
  function sheet(now, base) {
    const baseIds = base.flatMap((w) => w.rows.map((r) => r.vehicleId));
    const ids = [...new Set(now.map((r) => r.vehicleId).concat(baseIds))];
    if (!ids.length) return '<p class="empty">Nothing recorded.</p>';
    const lines = ids.map((id) => {
      const mine = now.filter((r) => r.vehicleId === id);
      const a = sum(mine);
      const b = avgOf(base.map((w) => sum(w.rows.filter((r) => r.vehicleId === id))));
      return { id, a, b, change: a - b, jobs: mine.length };
    }).sort((x, y) => y.change - x.change);
    const totals = lines.reduce((t, r) => ({ a: t.a + r.a, b: t.b + r.b, jobs: t.jobs + r.jobs }), { a: 0, b: 0, jobs: 0 });
    const maxChange = Math.max(...lines.map((r) => Math.abs(r.change)), 1);

    /** A diverging bar centred on zero — red growing right (spend up), green growing left (spend down). */
    const divBar = (n) => {
      const pct = (Math.min(Math.abs(n), maxChange) / maxChange) * 50;
      if (pct < 0.5) return '<span class="cs-divbar"></span>';
      const side = n > 0 ? `left:50%;width:${pct}%;background:var(--red)` : `right:50%;width:${pct}%;background:var(--green)`;
      return `<span class="cs-divbar"><i style="${side}"></i></span>`;
    };

    return `<div class="table-wrap"><table class="data">
      <thead><tr><th>Vehicle</th><th class="num">Jobs</th><th class="num">This week</th><th class="num">Weekly average</th><th class="num">Change</th></tr></thead>
      <tbody>${lines.map((r) => `<tr class="row-link" data-veh="${esc(r.id)}" title="Open ${esc(r.id)}">
        <td><span class="id">${esc(r.id)}</span></td>
        <td class="num">${r.jobs || '—'}</td>
        <td class="num">${r.a ? L.fmtAUD(r.a) : '—'}</td>
        <td class="num">${r.b >= 0.005 ? L.fmtAUD(r.b) : '—'}</td>
        <td class="num cs-change-cell"><span class="cs-change ${changeTone(r.change)}">${fmtChange(r.change)}</span>${divBar(r.change)}</td>
      </tr>`).join('')}</tbody>
      <tfoot><tr><th>Fleet total</th><th class="num">${totals.jobs}</th><th class="num">${L.fmtAUD(totals.a)}</th><th class="num">${L.fmtAUD(totals.b)}</th>
        <th class="num cs-change ${changeTone(totals.a - totals.b)}">${fmtChange(totals.a - totals.b)}</th></tr></tfoot>
    </table></div>`;
  }

  /**
   * What each vehicle has cost over the trailing year, against the distance or
   * engine hours it covered in that time. Hours-tracked plant is rated per hour,
   * everything else per kilometre; a vehicle with one service (or none carrying
   * a reading) has no span to divide by, so it shows spend only.
   */
  function running(end) {
    const from = T.addDays(end, -(7 * RUN_WEEKS - 1));
    const rows = rowsBetween(from, end);
    const ids = [...new Set(rows.map((r) => r.vehicleId))];
    if (!ids.length) return '<p class="empty">No costs recorded in this period.</p>';

    const lines = ids.map((id) => {
      const mine = rows.filter((r) => r.vehicleId === id);
      const v = AD.store.get('vehicles', id);
      const byHours = !!v && L.HOURS_TYPES.has(v.type);
      const reads = mine.map((r) => Number(byHours ? r.hours : r.odometer)).filter((n) => Number.isFinite(n) && n > 0);
      const span = reads.length > 1 ? Math.max(...reads) - Math.min(...reads) : 0;
      const total = sum(mine);
      return { id, total, jobs: mine.length, span, byHours, type: v ? v.type : '', rate: span > 0 ? total / span : null };
    }).sort((a, b) => b.total - a.total);

    const shown = lines.slice(0, RUN_MAX);
    const maxSpend = Math.max(...shown.map((r) => r.total), 1);
    const rated = (r) => r.rate == null ? '<span class="muted">—</span>'
      : `${L.fmtAUD(r.rate)}<span class="t2">per ${r.byHours ? 'hour' : 'km'}</span>`;

    return `<div class="table-wrap"><table class="data">
      <thead><tr><th>Vehicle</th><th class="col-opt">Type</th><th class="num">Jobs</th><th class="num">Spend</th><th class="num">Covered</th><th class="num">Running cost</th></tr></thead>
      <tbody>${shown.map((r) => `<tr class="row-link" data-veh="${esc(r.id)}" title="Open ${esc(r.id)}">
        <td><span class="id">${esc(r.id)}</span></td>
        <td class="col-opt">${esc(r.type) || '<span class="muted">Not in the fleet list</span>'}</td>
        <td class="num">${r.jobs}</td>
        <td class="num cs-spend-cell"><span>${L.fmtAUD(r.total)}</span><span class="cs-bar"><i style="width:${(r.total / maxSpend) * 100}%"></i></span></td>
        <td class="num">${r.span > 0 ? (r.byHours ? L.fmtHours(r.span) : L.fmtKm(r.span)) : '<span class="muted">—</span>'}</td>
        <td class="num">${rated(r)}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    ${lines.length > RUN_MAX ? `<p class="section-foot muted small">Showing the ${RUN_MAX} dearest of ${lines.length} vehicles with costs in this window.</p>` : ''}`;
  }

  return { title: 'Cost sheet', render, refresh: () => root && draw() };
})();
