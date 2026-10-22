/* Cost sheet — what the fleet cost this week, measured against its average week. */
AD.views = AD.views || {};

AD.views['cost-sheet'] = (function () {
  const { esc, pageHeader, sectionHead } = AD.ui;
  const L = AD.logic, T = AD.time, I = AD.icons, V = AD.viz;
  const AVG_WEEKS = 4; // same trailing window the dashboard uses for its utilisation trend
  const RUN_WEEKS = 52; // running-cost window: a year of weeks, ending with the week on screen
  const RUN_PER_GROUP = 8; // running-cost rows per vehicle type; the rest live in the table view
  const MOVERS_MAX = 8; // vehicles shown in "What moved"; the rest live in the table view
  const TREND_WEEKS = 12; // Spend over time, weekly mode
  const TREND_MONTHS = 12; // Spend over time, monthly mode
  const PROJ_MONTHS = 6;  // months to project forward from current
  let root = null, start = '', period = 'month';
  let projOverrides = {}; // keyed by month label, e.g. { "Nov 2026": { planned: 1200, unplanned: 400 } }
  // Replays the draw-in whenever the figures on screen actually change — opening
  // the page, stepping a week, switching period — but not on a background refresh,
  // which would make the page twitch while someone is reading it.
  let fresh = true;

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

  // A service is work we chose to do; a resolved defect is work that chose us.
  // Spend rising on planned servicing and spend rising on unplanned repairs call
  // for opposite responses, so every figure that can carry the split, does.
  const PLANNED = 'Service', UNPLANNED = 'Defect';
  const sumKind = (rows, kind) => sum(rows.filter((r) => r.kind === kind));
  const COLOR_PLANNED = 'var(--mint)', COLOR_UNPLANNED = 'var(--amber)';

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
  // Hourly plant runs to tens of dollars, light vehicles to cents per km; whole
  // dollars for the first, cents only where they carry the comparison.
  const fmtRate = (n) => n >= 10 ? '$' + Math.round(n).toLocaleString('en-AU') : '$' + n.toFixed(2);
  const median = (nums) => {
    const s = [...nums].sort((a, b) => a - b), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const vehHref = (id) => `#/vehicle/${encodeURIComponent(id)}`;
  const changeTone = (n) => n > 0.005 ? 'cs-delta-worse' : n < -0.005 ? 'cs-delta-better' : '';

  function render(el, params) {
    root = el;
    start = /^\d{4}-\d{2}-\d{2}$/.test(params.week || '') ? mondayOf(params.week) : mondayOf(T.todayKey());
    period = params.period === 'week' ? 'week' : 'month';
    fresh = true;
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

    // Share rather than dollars: unplanned spend rises with a heavy week either way,
    // but the proportion is what says whether maintenance is keeping ahead of failure.
    const unplanned = sumKind(now, UNPLANNED);
    const share = spend ? (unplanned / spend) * 100 : 0;
    const avgUnplanned = avgOf(base.map((w) => sumKind(w.rows, UNPLANNED)));
    const avgShare = avgSpend ? (avgUnplanned / avgSpend) * 100 : 0;
    const shareTone = !haveBaseline || !avgSpend ? null
      : share > avgShare + 0.5 ? 'worse' : share < avgShare - 0.5 ? 'better' : null;
    const shareFoot = !spend ? '<small class="cs-delta">Nothing recorded</small>'
      : `<small class="cs-delta${shareTone ? ' cs-delta-' + shareTone : ''}">${L.fmtAUD(unplanned)} of ${L.fmtAUD(spend)}${haveBaseline && avgSpend ? ` · ${Math.round(avgShare)}% avg` : ''}</small>`;

    el.classList.toggle('anim-in', fresh);
    fresh = false;

    el.innerHTML = `
      ${pageHeader({
        title: 'Cost sheet',
        sub: `${T.fmtKey(start)} – ${T.fmtKey(end)}${start === thisWeek ? ' · this week' : ''} · against the average of the ${AVG_WEEKS} weeks before`,
        actions: `<div class="seg" role="group" aria-label="Week">
            <button type="button" id="w-prev" aria-label="Previous week">${I.chevL}</button>
            <button type="button" id="w-this"${start === thisWeek ? ' class="on"' : ''}>This week</button>
            <button type="button" id="w-next" aria-label="Next week">${I.chevR}</button>
          </div>
          <input type="date" id="w-jump" class="cs-jump" value="${start}" aria-label="Go to week">`
      })}

      <div class="cs-kpis" role="group" aria-label="This week against the average week">
        ${kpi('Total spend', L.fmtAUD(spend), delta(spend, avgSpend, haveBaseline, L.fmtAUD, true), trendTone(spend, avgSpend, haveBaseline, true))}
        ${kpi('Jobs recorded', String(jobs), delta(jobs, avgJobs, haveBaseline, (n) => n.toFixed(1), false))}
        ${kpi('Average per job', L.fmtAUD(perJob), delta(perJob, avgPerJob, haveBaseline, L.fmtAUD, true), trendTone(perJob, avgPerJob, haveBaseline, true))}
        ${kpi('Unplanned share', `${Math.round(share)}%`, shareFoot, shareTone)}
        ${kpi('Vehicles charged this week', `${vehicleCount}`, `<small class="cs-delta">of ${fleet} in the fleet · ${haveBaseline ? avgVehicleCount.toFixed(1) + ' avg' : 'no prior weeks'}</small>`)}
      </div>

      ${trend(end)}

      <div class="cs-pair">
        ${months(end)}
        ${movers(now, base)}
      </div>

      <section class="section">
        ${sectionHead({ title: 'Running cost', meta: `${RUN_WEEKS} weeks to ${T.fmtKey(end)} · grouped by vehicle type · the tick marks each type's median` })}
        ${running(end)}
      </section>

      <p class="section-foot muted small">Spend is recorded services plus resolved defects, counted on the day the service was recorded or the defect was resolved. Planned is scheduled servicing; unplanned is a defect repair. The average is the ${AVG_WEEKS} weeks before this one. Running cost divides a vehicle's spend by the distance or hours covered between its first and last service in the window, so it needs at least two services to show a rate.</p>

      ${projection(end)}`;

    el.querySelector('#w-prev').onclick = () => go(T.addDays(start, -7));
    el.querySelector('#w-next').onclick = () => go(T.addDays(start, 7));
    el.querySelector('#w-this').onclick = () => go(thisWeek);
    el.querySelector('#w-jump').onchange = (e) => { if (e.target.value) go(mondayOf(e.target.value)); };
    el.querySelectorAll('[data-period]').forEach((b) => (b.onclick = () => setPeriod(b.dataset.period)));
    bindProjectionInputs();
  }

  function go(week) {
    start = week;
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
    AD.setParams({ week: start === mondayOf(T.todayKey()) ? '' : start, period: period === 'month' ? '' : period });
  }

  /** One row per calendar month over the trailing year, each bar split planned against unplanned. */
  function months(end) {
    const pts = monthlyPoints(end);
    const top = Math.max(...pts.map((p) => p.total), 1);
    const pct = (v) => (v / top) * 100;
    const rows = pts.map((p, i) => `
      <div class="hb-row" ${V.tipAttr(p.full, [
        ['Planned', L.fmtAUD(p.planned), COLOR_PLANNED],
        ['Unplanned', L.fmtAUD(p.unplanned), COLOR_UNPLANNED],
        ['Total', L.fmtAUD(p.total), 'var(--ink)']
      ])}>
        <span class="hb-label">${esc(p.short)}</span>
        <span class="cs-mbar" style="--i:${i}">
          ${p.planned ? `<i style="width:${pct(p.planned)}%;background:${COLOR_PLANNED}"></i>` : ''}
          ${p.unplanned ? `<i style="width:${pct(p.unplanned)}%;background:${COLOR_UNPLANNED}"></i>` : ''}
        </span>
        <span class="hb-val">${p.total ? L.fmtAUD(p.total) : '—'}</span>
      </div>`).join('');
    return `<figure class="viz-card">
      <figcaption><h3>Month by month</h3><span class="viz-sub">${TREND_MONTHS} months to ${T.fmtKey(end)} · planned servicing against unplanned repairs</span></figcaption>
      ${V.legend([{ label: 'Planned servicing', color: COLOR_PLANNED }, { label: 'Unplanned repairs', color: COLOR_UNPLANNED }], { counts: false })}
      <div class="hb cs-months">${rows}</div>
      ${V.table(['Month', 'Planned', 'Unplanned', 'Total'], pts.map((p) => [p.full, L.fmtAUD(p.planned), L.fmtAUD(p.unplanned), L.fmtAUD(p.total)]))}
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
      return {
        total: sum(rows), planned: sumKind(rows, PLANNED), unplanned: sumKind(rows, UNPLANNED),
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
      return {
        total: sum(rows), planned: sumKind(rows, PLANNED), unplanned: sumKind(rows, UNPLANNED),
        label: T.MONTHS[dt.getUTCMonth()].slice(0, 3),
        short: `${T.MONTHS[dt.getUTCMonth()].slice(0, 3)} ${String(dt.getUTCFullYear()).slice(2)}`,
        full: `${T.MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`
      };
    });
  }

  /** Projected future months based on the trailing 3-month average of planned and unplanned spend. */
  function projectedMonths(end) {
    const { y, m } = T.parseKey(end);
    const recent = Array.from({ length: 3 }, (_, i) => {
      const dt = new Date(Date.UTC(y, m - 1 - i, 1));
      const key = dt.toISOString().slice(0, 7);
      const rows = rowsForMonth(key);
      return { planned: sumKind(rows, PLANNED), unplanned: sumKind(rows, UNPLANNED) };
    });
    const avgP = avgOf(recent.map((r) => r.planned));
    const avgU = avgOf(recent.map((r) => r.unplanned));
    return Array.from({ length: PROJ_MONTHS }, (_, i) => {
      const dt = new Date(Date.UTC(y, m + i, 1));
      const key = T.MONTHS[dt.getUTCMonth()] + ' ' + dt.getUTCFullYear();
      const ov = projOverrides[key];
      const p = ov ? ov.planned : avgP;
      const u = ov ? ov.unplanned : avgU;
      return {
        total: p + u, planned: p, unplanned: u,
        label: T.MONTHS[dt.getUTCMonth()].slice(0, 3),
        short: T.MONTHS[dt.getUTCMonth()].slice(0, 3) + ' ' + String(dt.getUTCFullYear()).slice(2),
        full: key + ' (projected)',
        key, defaultPlanned: avgP, defaultUnplanned: avgU,
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

    const top = niceTop(Math.max(...points.map((p) => p.total), 1) * 1.15);
    const W = 880, H = 184, padL = 56, padR = 12, padT = 16, padB = 26;
    const plotW = W - padL - padR, plotH = H - padT - padB, n = points.length;
    const x = (i) => padL + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
    const y = (v) => padT + plotH - (Math.min(v, top) / top) * plotH;
    const coords = points.map((p, i) => ({ x: x(i), y: y(p.total) }));
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
    const lineD = spline(coords);
    const plannedD = spline(plannedCoords);
    const floorY = (padT + plotH).toFixed(1);
    const areaD = `${plannedD} L${x(n - 1).toFixed(1)},${floorY} L${x(0).toFixed(1)},${floorY} Z`;
    const bandD = `${lineD} ${spline([...plannedCoords].reverse()).replace(/^M/, 'L')} Z`;
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

    // "Now" vertical marker and clip paths for the historical/projected split
    const nowX = hasProj ? x(splitIdx).toFixed(1) : null;
    const nowMarker = nowX
      ? `<line x1="${nowX}" y1="${padT}" x2="${nowX}" y2="${padT + plotH}" class="cs-now-line"></line>
         <text class="cs-now-label" x="${nowX}" y="${padT - 4}" text-anchor="middle">Now</text>` : '';
    const clipDefs = hasProj
      ? `<clipPath id="cs-hist-clip"><rect x="0" y="0" width="${nowX}" height="${H}"/></clipPath>
         <clipPath id="cs-proj-clip"><rect x="${nowX}" y="0" width="${W}" height="${H}"/></clipPath>` : '';

    const marks = points.map((p, i) => {
      const cx = x(i).toFixed(1), cy = y(p.total).toFixed(1);
      const isLast = i === splitIdx;
      const isProj = !!p.projected;
      return `<g class="cs-mark${isLast ? ' cs-current' : ''}${isProj ? ' cs-proj-mark' : ''}" style="--i:${i}">
        ${isLast ? `<circle cx="${cx}" cy="${cy}" r="9" class="cs-halo"></circle>` : ''}
        <circle cx="${cx}" cy="${cy}" r="4" class="cs-dot"></circle>
        <circle cx="${cx}" cy="${cy}" r="16" class="cs-hit" ${V.tipAttr(p.full, [
          ['Planned', L.fmtAUD(p.planned), COLOR_PLANNED],
          ['Unplanned', L.fmtAUD(p.unplanned), COLOR_UNPLANNED],
          ['Total', L.fmtAUD(p.total), 'var(--ink)']
        ])}></circle>
      </g>`;
    }).join('');
    const ariaDesc = points.map((p) => `${p.full}: ${L.fmtAUD(p.total)} total, ${L.fmtAUD(p.unplanned)} unplanned`).join(', ');

    let svgBody;
    if (hasProj) {
      svgBody = `${grid}
          <g clip-path="url(#cs-hist-clip)">
            <path d="${areaD}" class="cs-area"></path>
            <path d="${bandD}" class="cs-band"></path>
            <path d="${plannedD}" class="cs-line-planned" pathLength="1"></path>
            <path d="${lineD}" class="cs-line-path" pathLength="1"></path>
          </g>
          <g clip-path="url(#cs-proj-clip)" class="cs-proj-g">
            <path d="${areaD}" class="cs-area"></path>
            <path d="${bandD}" class="cs-band"></path>
            <path d="${plannedD}" class="cs-line-planned" pathLength="1"></path>
            <path d="${lineD}" class="cs-line-path" pathLength="1"></path>
          </g>
          ${nowMarker}
          ${yTicks}${xTicks}${marks}`;
    } else {
      svgBody = `${grid}
          <path d="${areaD}" class="cs-area"></path>
          <path d="${bandD}" class="cs-band"></path>
          <path d="${plannedD}" class="cs-line-planned" pathLength="1"></path>
          <path d="${lineD}" class="cs-line-path" pathLength="1"></path>
          ${yTicks}${xTicks}${marks}`;
    }

    const legendItems = [
      { label: 'Planned servicing', color: COLOR_PLANNED },
      { label: 'Unplanned repairs', color: COLOR_UNPLANNED }
    ];
    if (hasProj) legendItems.push({ label: 'Projected', color: 'var(--violet)' });

    return `<figure class="viz-card">
      <figcaption><h3>Spend over time</h3><span class="viz-sub">${isMonthly ? TREND_MONTHS + ' months' : TREND_WEEKS + ' weeks'} to ${T.fmtKey(end)}${hasProj ? ' + ' + PROJ_MONTHS + '-month projection' : ''}</span></figcaption>
      <div class="seg cs-period" role="group" aria-label="Chart period">
        <button type="button" data-period="week" class="${period === 'week' ? 'on' : ''}">Weekly</button>
        <button type="button" data-period="month" class="${period === 'month' ? 'on' : ''}">Monthly</button>
      </div>
      ${V.legend(legendItems, { counts: false })}
      <div class="cs-line-wrap">
        <svg viewBox="0 0 ${W} ${H}" class="cs-line-svg" role="img" aria-label="${esc('Spend per ' + period + ': ' + ariaDesc)}">
          <defs>
            <linearGradient id="cs-area-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style="stop-color:var(--mint);stop-opacity:.34"></stop>
              <stop offset="100%" style="stop-color:var(--mint);stop-opacity:0"></stop>
            </linearGradient>
            <linearGradient id="cs-band-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style="stop-color:var(--amber);stop-opacity:.46"></stop>
              <stop offset="100%" style="stop-color:var(--amber);stop-opacity:.16"></stop>
            </linearGradient>
            ${clipDefs}
          </defs>
          ${svgBody}
        </svg>
      </div>
      ${V.table([isMonthly ? 'Month' : 'Week starting', 'Planned', 'Unplanned', 'Total'],
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
      const edited = !!projOverrides[p.key];
      return `<tr${edited ? ' class="cs-proj-edited"' : ''}>
        <td>${esc(p.key)}</td>
        <td><input type="number" class="cs-proj-input" data-idx="${i}" data-field="planned" value="${Math.round(p.planned)}" step="100" min="0"></td>
        <td><input type="number" class="cs-proj-input" data-idx="${i}" data-field="unplanned" value="${Math.round(p.unplanned)}" step="100" min="0"></td>
        <td class="cs-proj-total">${L.fmtAUD(p.total)}</td>
        <td>${L.fmtAUD(running)}</td>
      </tr>`;
    }).join('');
    return `<section class="cs-proj-section" id="cs-proj-section">
      <figure class="viz-card cs-proj-card">
        <figcaption>
          <h3>Projected costs</h3>
          <span class="viz-sub">${PROJ_MONTHS}-month forecast · edit planned and unplanned to adjust the chart${hasOverrides ? ' · <button type="button" class="link-btn cs-proj-reset" id="cs-proj-reset">reset to averages</button>' : ''}</span>
        </figcaption>
        <table class="cs-proj-table">
          <thead><tr><th>Month</th><th>Planned</th><th>Unplanned</th><th>Total</th><th>Running total</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td>${PROJ_MONTHS}-month total</td><td></td><td></td><td></td><td class="cs-proj-total">${L.fmtAUD(running)}</td></tr></tfoot>
        </table>
      </figure>
    </section>`;
  }

  function bindProjectionInputs() {
    const section = root.querySelector('#cs-proj-section');
    if (!section) return;
    const end = T.addDays(start, 6);
    const proj = projectedMonths(end);
    section.querySelectorAll('.cs-proj-input').forEach((inp) => {
      inp.addEventListener('change', () => {
        const idx = +inp.dataset.idx;
        const field = inp.dataset.field;
        const val = Math.max(0, parseFloat(inp.value) || 0);
        const p = proj[idx];
        if (!p) return;
        const ov = projOverrides[p.key] || { planned: p.defaultPlanned, unplanned: p.defaultUnplanned };
        ov[field] = val;
        if (Math.abs(ov.planned - p.defaultPlanned) < 0.5 && Math.abs(ov.unplanned - p.defaultUnplanned) < 0.5) {
          delete projOverrides[p.key];
        } else {
          projOverrides[p.key] = ov;
        }
        draw();
      });
    });
    const resetBtn = section.querySelector('#cs-proj-reset');
    if (resetBtn) resetBtn.onclick = () => { projOverrides = {}; draw(); };
  }

  /**
   * The few vehicles whose spend moved furthest from their own weekly average —
   * the ones that explain the headline figure. A vehicle that didn't move says
   * nothing, so it stays out of the chart and only appears in the table view.
   */
  function movers(now, base) {
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
        ['This week', L.fmtAUD(r.a), up ? 'var(--red)' : 'var(--green)'],
        [`${AVG_WEEKS}-week average`, L.fmtAUD(r.b), 'var(--muted)']
      ])}>
        <span class="id">${esc(r.id)}</span>
        <span class="cs-hbar cs-diverge"><i class="${up ? 'cs-up' : 'cs-down'}" style="${up ? 'left' : 'right'}:50%;width:${pct}%"></i></span>
        <span class="cs-row-val ${changeTone(r.change)}">${fmtChange(r.change)}</span>
        <span class="cs-row-meta">${L.fmtAUD(r.a)} this week · ${L.fmtAUD(r.b)} average${r.jobs ? ` · ${r.jobs} job${r.jobs === 1 ? '' : 's'}` : ''}</span>
      </a>`;
    }).join('');

    return `<figure class="viz-card">
      <figcaption><h3>What moved this week</h3><span class="viz-sub">Each vehicle against its own ${AVG_WEEKS}-week average · fleet ${Math.abs(net) < 0.005 ? 'unchanged' : fmtChange(net)} overall</span></figcaption>
      ${rows ? `<div class="cs-rows">${rows}</div>` : '<p class="empty">No vehicle’s spend moved against its average this week.</p>'}
      ${movedAll.length > moved.length ? `<p class="cs-more">${movedAll.length - moved.length} more moved by less — open the table to see them.</p>` : ''}
      ${lines.length ? V.table(['Vehicle', 'Jobs', 'This week', `${AVG_WEEKS}-week average`, 'Change'],
        lines.map((r) => [r.id, String(r.jobs), L.fmtAUD(r.a), L.fmtAUD(r.b), fmtChange(r.change)])) : ''}
    </figure>`;
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
      return { id, total, jobs: mine.length, span, byHours, type: v ? v.type : 'Not in the fleet list', rate: span > 0 ? total / span : null };
    });
    const unit = (r) => (r.byHours ? 'hr' : 'km');
    const covered = (r) => (r.byHours ? L.fmtHours(r.span) : L.fmtKm(r.span));

    // Rates only compare fairly within a type: an excavator per engine hour and a
    // ute per kilometre aren't on the same scale, and even two per-km classes
    // differ by an order of magnitude. Each type gets its own card and its own bar scale.
    const rated = lines.filter((r) => r.rate != null);
    const groups = [...new Set(rated.map((r) => r.type))].map((type) => {
      const mine = rated.filter((r) => r.type === type).sort((a, b) => b.rate - a.rate);
      return { type, lines: mine, byHours: mine[0].byHours, mid: median(mine.map((r) => r.rate)), spend: mine.reduce((n, r) => n + r.total, 0) };
    }).sort((a, b) => b.spend - a.spend);

    const card = (g) => {
      const top = Math.max(...g.lines.map((r) => r.rate));
      // A median of one or two vehicles is just those vehicles; don't flag against it.
      const judge = g.lines.length >= 3;
      const shown = g.lines.slice(0, RUN_PER_GROUP);
      return `<article class="cs-rc-group">
        <header><h3>${esc(g.type)}</h3><span class="viz-sub">Per ${g.byHours ? 'engine hour' : 'kilometre'} · median ${fmtRate(g.mid)}/${unit(g)} · ${g.lines.length} vehicle${g.lines.length === 1 ? '' : 's'}</span></header>
        <div class="cs-rows">${shown.map((r, i) => {
          const over = g.mid ? (r.rate - g.mid) / g.mid : 0;
          const high = judge && over > 0.25;
          return `<a class="cs-row" href="${vehHref(r.id)}" style="--i:${i}">
            <span class="id">${esc(r.id)}</span>
            <span class="cs-hbar"><i${high ? ' class="cs-high"' : ''} style="width:${(r.rate / top) * 100}%"></i>${g.lines.length > 1 ? `<b class="cs-median" style="left:${(g.mid / top) * 100}%"></b>` : ''}</span>
            <span class="cs-row-val">${fmtRate(r.rate)}<small>/${unit(r)}</small></span>
            <span class="cs-row-meta">${high ? `<span class="cs-flag">${Math.round(over * 100)}% above median</span> · ` : ''}${L.fmtAUD(r.total)} over ${covered(r)} · ${r.jobs} job${r.jobs === 1 ? '' : 's'}</span>
          </a>`;
        }).join('')}</div>
        ${g.lines.length > shown.length ? `<p class="cs-more">${g.lines.length - shown.length} more in the table below.</p>` : ''}
      </article>`;
    };

    const unrated = lines.filter((r) => r.rate == null).sort((a, b) => b.total - a.total);
    const noRate = unrated.length ? `<p class="cs-norate"><b>No rate yet for ${unrated.length} vehicle${unrated.length === 1 ? '' : 's'}.</b>
      A rate needs at least two services with ${unrated.some((r) => r.byHours) ? 'meter' : 'odometer'} readings in this window:
      ${unrated.slice(0, 12).map((r) => `<a href="${vehHref(r.id)}">${esc(r.id)}</a>`).join(', ')}${unrated.length > 12 ? ` and ${unrated.length - 12} more` : ''}.</p>` : '';

    const tableRows = [...lines].sort((a, b) => a.type.localeCompare(b.type) || (b.rate || 0) - (a.rate || 0))
      .map((r) => [r.id, r.type, String(r.jobs), L.fmtAUD(r.total), r.span > 0 ? covered(r) : '—', r.rate != null ? `${fmtRate(r.rate)}/${unit(r)}` : '—']);

    return `${groups.length ? `<div class="cs-rc-grid">${groups.map(card).join('')}</div>` : ''}
      ${noRate}
      ${V.table(['Vehicle', 'Type', 'Jobs', 'Spend', 'Covered', 'Running cost'], tableRows)}`;
  }

  return { title: 'Cost sheet', render, refresh: () => root && draw() };
})();
