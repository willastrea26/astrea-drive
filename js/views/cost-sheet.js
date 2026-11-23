/* Cost sheet — what the fleet cost over the selected period, measured against its prior average. */
AD.views = AD.views || {};

AD.views['cost-sheet'] = (function () {
  const { esc, pageHeader, sectionHead, detailsSnapshot, detailsRestore } = AD.ui;
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
  const USAGE_WINDOW_DAYS = 90; // Cost vs usage: how far back the daily GPS data is measured
  const MOVERS_MAX = 8; // vehicles shown in "What moved"; the rest live in the table view
  const TREND_WEEKS = 12; // Spend over time, weekly mode
  const TREND_MONTHS = 12; // Spend over time, monthly mode
  const PROJ_MONTHS = 6;  // months to project forward from current
  const READY_USAGE_DAYS = 28;  // Cost vs usage: days of GPS AND fuel data side by side before a vehicle is ranked (about four tank fills)
  const STEADY_USAGE_DAYS = 60; // beyond this the figure barely moves
  let root = null, start = '', end = '', scope = 'year', period = 'month', usageMode = 'km', trendView = 'split', fuelView = 'fuel';   // trendView: Spend over time as 'split' (each cost) or 'total'
  const PROJ_STORE_KEY = 'ad-cost-proj-overrides';
  let projOverrides = (() => { try { const v = JSON.parse(localStorage.getItem(PROJ_STORE_KEY)) || {}; /* migrate old {planned,unplanned} format */ for (const k of Object.keys(v)) { if (typeof v[k] === 'object') v[k] = (v[k].planned || 0) + (v[k].unplanned || 0); } return v; } catch { return {}; } })();
  function saveOverrides() { try { localStorage.setItem(PROJ_STORE_KEY, JSON.stringify(projOverrides)); } catch {} }
  // Replays the draw-in whenever the figures on screen actually change — opening
  // the page, stepping a week, switching period — but not on a background refresh,
  // which would make the page twitch while someone is reading it.
  let fresh = true;

  const mondayOf = (key) => T.addDays(key, -T.dayOfWeek(key));
  /**
   * The last day the charts draw as actual spend: the period's end, but never
   * past today. On the Year view the period ends 31 December, and drawing the
   * months after today as real $0 months dragged the line to the floor and put
   * "Now" on a month that hasn't happened; those months belong to the forecast.
   */
  const chartEnd = () => (end && end < T.todayKey() ? end : T.todayKey());

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
  // Which card a row came from: BP rows are the BP PDF imports (receipt-based
  // ids); every other row came from a WEX card spreadsheet.
  const fuelCard = (r) => (String(r.id || '').startsWith('fuel-bp-') || /^BP PDF/.test(r.source || '') ? 'bp' : 'wex');
  const fuelRows = () => (AD.store.all('fuel_entries') || [])
    .filter((r) => r.date && Number(r.cost) > 0)
    .map((r) => ({ vehicleId: r.vehicleId, date: String(r.date).slice(0, 10), cost: Number(r.cost), card: fuelCard(r) }));
  const fuelBetween = (from, to) => fuelRows().filter((r) => r.date >= from && r.date <= to).reduce((n, r) => n + r.cost, 0);
  const fuelForMonth = (key) => fuelRows().filter((r) => r.date.slice(0, 7) === key).reduce((n, r) => n + r.cost, 0);
  /** Fuel spend split by card for the rows `keep` selects: { wex, bp }. */
  const fuelByCard = (keep) => fuelRows().filter(keep).reduce((t, r) => { t[r.card] += r.cost; return t; }, { wex: 0, bp: 0 });

  // Imported Linkt toll charges (trips + No Tag fees, less account credits),
  // the fourth slice of spend. Loaded on demand (see tolls()), so the first
  // paint can be without them; the page redraws once they arrive. They only
  // cover the statements imported, the same as fuel.
  const COLOR_TOLL = '#f472b6';
  const tollRows = () => (AD.store.all('toll_entries') || [])
    .filter((r) => r.date)
    .map((r) => ({ date: String(r.date).slice(0, 10), cost: Number(r.amount) || 0 }));
  const tollBetween = (from, to) => tollRows().filter((r) => r.date >= from && r.date <= to).reduce((n, r) => n + r.cost, 0);
  const tollForMonth = (key) => tollRows().filter((r) => r.date.slice(0, 7) === key).reduce((n, r) => n + r.cost, 0);

  /** The scope's own trailing baseline — the N periods (weeks/months/years) immediately before `curStart`. */
  function baseline(curStart) {
    let cursor = curStart;
    return Array.from({ length: SCOPE_CFG[scope].baselineN }, () => {
      cursor = stepPeriod(scope, cursor, -1);
      return { from: cursor, to: periodEnd(scope, cursor), rows: rowsBetween(cursor, periodEnd(scope, cursor)) };
    });
  }

  const TONE_VAR = { worse: 'var(--red)', better: 'var(--green)', spend: 'var(--red)', unplanned: 'var(--cs-amber)', fuel: 'var(--cs-blue)', planned: 'var(--mint)', toll: COLOR_TOLL };
  const kpi = (label, value, foot, tone) => `<div class="cs-kpi"${tone ? ` style="--cs-tone:${TONE_VAR[tone]}"` : ''}><span>${esc(label)}</span><strong>${value}</strong>${foot}</div>`;
  const fmtChange = (n) => Math.abs(n) < 0.005 ? '—' : (n > 0 ? '+' : '−') + L.fmtAUD(Math.abs(n));
  const median = (nums) => {
    const s = [...nums].sort((a, b) => a - b), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const vehHref = (id) => `#/vehicle/${encodeURIComponent(id)}`;
  // Long per-vehicle lists show the top 10; the rest sit behind "Show all".
  const LIST_SHOW = 10;
  const topRows = (rowsArr, noun = 'vehicles', show = LIST_SHOW) => rowsArr.slice(0, show).join('')
    + (rowsArr.length > show ? `<details class="cs-show-all"><summary>Show all ${rowsArr.length} ${noun}</summary><div class="cs-rows">${rowsArr.slice(show).join('')}</div></details>` : '');
  const changeTone = (n) => n > 0.005 ? 'cs-delta-worse' : n < -0.005 ? 'cs-delta-better' : '';
  // For a vehicle with GPS data but no fuel in that window: when its latest
  // imported fill was, so "no fuel" never reads as "no fuel ever".
  const lastFillNote = (v) => {
    const f = L.fuelFor(v);
    return f && f.lastFill ? ` · latest fill on record ${T.fmtKey(f.lastFill)}` : ` · no fuel-card fills on record for this vehicle`;
  };

  /*
   * Tolls load after the rest of the page (they're the biggest table). While
   * they load, the Toll share card and the Tolls section show live progress;
   * when they arrive the page redraws once with their lines drawing in
   * (animateTolls), instead of popping in. One shared wait so only ONE redraw
   * runs on arrival — a second would cut the animation short.
   */
  let animateTolls = false, tollWait = null, drawnTollState = null;
  function waitForTolls() {
    if (tollWait) return;
    tollWait = AD.store.loadTolls().then(() => {
      tollWait = null;
      // The store's change notice usually redraws the page already; only draw
      // here if nothing has drawn the new state yet.
      if (root && drawnTollState !== AD.store.tollsState()) draw();
    });
  }
  function tollProgressText() {
    const p = AD.store.tollsProgress ? AD.store.tollsProgress() : { loaded: 0, total: 0 };
    if (!p.total) return 'Loading toll data… this can take up to a minute';
    const pct = Math.min(99, Math.round((p.loaded / p.total) * 100));
    return `Loading toll data… ${pct}% (${p.loaded.toLocaleString('en-AU')} of ${p.total.toLocaleString('en-AU')} lines)`;
  }
  // Update the progress text in place as pages arrive, without redrawing the page.
  if (AD.store.onTollProgress) {
    AD.store.onTollProgress(() => {
      if (!root) return;
      const txt = tollProgressText();
      root.querySelectorAll('[data-toll-progress]').forEach((n) => { n.textContent = txt; });
    });
  }

  function render(el, params) {
    root = el;
    scope = params.scope === 'week' || params.scope === 'month' ? params.scope : 'year';
    const anchor = /^\d{4}-\d{2}-\d{2}$/.test(params.week || '') ? params.week : T.todayKey();
    start = periodStart(scope, anchor);
    period = params.period === 'week' ? 'week' : 'month';
    usageMode = ['hr', 'fuel'].includes(params.use) ? params.use : 'km';   // Cost vs usage: per km, per engine hour, or fuel per km
    trendView = params.view === 'total' ? 'total' : 'split';
    fuelView = params.fv === 'tolls' || params.fv === 'both' ? params.fv : 'fuel';
    fresh = true;
    draw();
  }

  function draw() {
    const el = root;
    // Animate the toll lines only on the first draw after they finish loading.
    const tollStateNow = AD.store.tollsState ? AD.store.tollsState() : 'missing';
    animateTolls = (drawnTollState === 'idle' || drawnTollState === 'loading') && tollStateNow === 'ready'
      && (AD.store.all('toll_entries') || []).length > 0;
    drawnTollState = tollStateNow;
    // Tolls feed the KPIs and Spend over time even while the Fuel & tolls
    // section shows fuel, so make sure they're loading whatever's on screen.
    if (AD.store.tollsState && AD.store.tollsState() === 'idle') waitForTolls();
    const cfg = SCOPE_CFG[scope];
    end = periodEnd(scope, start);
    const thisStart = periodStart(scope, T.todayKey());
    const isCurrent = start === thisStart;
    const now = rowsBetween(start, end);
    const base = baseline(start);
    const haveBaseline = base.some((w) => w.rows.length || fuelBetween(w.from, w.to) > 0 || tollBetween(w.from, w.to) > 0);

    const spend = sum(now) + fuelBetween(start, end) + tollBetween(start, end);
    const avgSpend = avgOf(base.map((w) => sum(w.rows) + fuelBetween(w.from, w.to) + tollBetween(w.from, w.to)));

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

    // Fuel and planned servicing: the other two slices of the same total, so the
    // three shares add to 100%. Not judged better/worse — a rising fuel share
    // just means a busier period, and more planned servicing is no bad thing.
    const fuelNow = fuelBetween(start, end), planned = sumKind(now, PLANNED);
    const avgFuel = avgOf(base.map((w) => fuelBetween(w.from, w.to)));
    const avgPlanned = avgOf(base.map((w) => sumKind(w.rows, PLANNED)));
    const tollNow = tollBetween(start, end), avgToll = avgOf(base.map((w) => tollBetween(w.from, w.to)));
    // The Toll share card always shows; with no toll data it says why.
    const tollState = AD.store.tollsState ? AD.store.tollsState() : 'missing';
    const haveTolls = (AD.store.all('toll_entries') || []).length > 0;
    const tollFoot = haveTolls ? null
      : tollState === 'missing' ? '<small class="cs-delta">Not set up yet: run create-toll-entries.sql</small>'
      : tollState === 'ready' ? '<small class="cs-delta">No Linkt statement imported yet</small>'
      : `<small class="cs-delta" data-toll-progress>${tollProgressText()}</small>`;
    const pctOf = (n) => (spend ? (n / spend) * 100 : 0);
    const sliceFoot = (amt, avgAmt) => !spend ? '<small class="cs-delta">Nothing recorded</small>'
      : `<small class="cs-delta">${L.fmtAUD(amt)} of ${L.fmtAUD(spend)}${haveBaseline && avgSpend ? ` · ${Math.round((avgAmt / avgSpend) * 100)}% avg` : ''}</small>`;

    // Projected rest-of-year spend for the KPI — not meaningful once you're
    // already looking at a whole year, so it only appears in week/month view.
    const projForKpi = scope === 'year' ? [] : projectedMonths(chartEnd());
    const curYear = T.parseKey(end).y;
    const restOfYearMonths = projForKpi.filter(p => { const yr = parseInt(p.key.split(' ')[1]); return yr === curYear; });
    const projRestTotal = restOfYearMonths.reduce((n, p) => n + p.total, 0);
    const projMonthAvg = restOfYearMonths.length ? projRestTotal / restOfYearMonths.length : 0;

    el.classList.toggle('anim-in', fresh);
    fresh = false;

    // A background refresh (the 45s poll) rebuilds this whole block — don't
    // let it silently snap shut a "View as table" someone just opened.
    const openDetails = detailsSnapshot(el);

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

      <div class="cs-kpis" style="--cs-kpi-n:${5 + (restOfYearMonths.length ? 1 : 0)}" role="group" aria-label="This ${cfg.label} against the average ${cfg.label}">
        ${kpi('Total spend', L.fmtAUD(spend), `<small class="cs-delta">${spend ? 'Fuel, tolls, servicing and repairs' : 'Nothing recorded'}</small>`, 'spend')}
        ${kpi('Fuel share', `${Math.round(pctOf(fuelNow))}%`, sliceFoot(fuelNow, avgFuel), 'fuel')}
        ${kpi('Toll share', haveTolls ? `${Math.round(pctOf(tollNow))}%` : '—', tollFoot || sliceFoot(tollNow, avgToll), 'toll')}
        ${kpi('Planned servicing share', `${Math.round(pctOf(planned))}%`, sliceFoot(planned, avgPlanned), 'planned')}
        ${kpi('Unplanned share', `${Math.round(share)}%`, shareFoot, 'unplanned')}
        ${restOfYearMonths.length ? kpi('Projected to year-end', L.fmtAUD(projRestTotal), `<small class="cs-delta">${restOfYearMonths.length} month${restOfYearMonths.length === 1 ? '' : 's'} remaining · ${L.fmtAUD(projMonthAvg)}/mo avg</small>`) : ''}
      </div>

      ${trend(chartEnd())}

      <div class="cs-pair">
        ${months(chartEnd())}
        ${lastMonthSpend()}
      </div>

      ${fuelAndTolls()}

      ${costVsUsage()}

      <p class="section-foot muted small">Spend = recorded services (planned) and resolved defects (unplanned), on the day they were recorded or resolved, plus imported fuel-card and Linkt toll charges. The cards at the top compare the ${cfg.label} on screen with the average of the ${cfg.baselineN} ${cfg.baselineN === 1 ? cfg.label : cfg.plural} before.</p>

      ${projection(chartEnd())}`;

    detailsRestore(el, openDetails);

    el.querySelector('#cs-import').onclick = () => AD.importFuelData(() => draw());
    el.querySelector('#w-prev').onclick = () => go(stepPeriod(scope, start, -1));
    el.querySelector('#w-next').onclick = () => go(stepPeriod(scope, start, 1));
    el.querySelector('#w-this').onclick = () => go(thisStart);
    el.querySelector('#w-jump').onchange = (e) => { if (e.target.value) go(periodStart(scope, e.target.value)); };
    el.querySelectorAll('[data-scope]').forEach((b) => (b.onclick = () => setScope(b.dataset.scope)));
    el.querySelectorAll('[data-period]').forEach((b) => (b.onclick = () => setPeriod(b.dataset.period)));
    el.querySelectorAll('[data-trendview]').forEach((b) => (b.onclick = () => { if (b.dataset.trendview === trendView) return; trendView = b.dataset.trendview; fresh = true; setParams(); draw(); }));
    el.querySelectorAll('[data-fuelview]').forEach((b) => (b.onclick = () => { if (b.dataset.fuelview === fuelView) return; fuelView = b.dataset.fuelview; fresh = true; setParams(); draw(); }));
    el.querySelectorAll('[data-use]').forEach((b) => (b.onclick = () => { if (b.dataset.use === usageMode) return; usageMode = b.dataset.use; setParams(); draw(); }));
    bindTollAssign(el);
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
    AD.setParams({ week: start === periodStart(scope, T.todayKey()) ? '' : start, period: period === 'month' ? '' : period, scope: scope === 'year' ? '' : scope, use: usageMode === 'km' ? '' : usageMode, view: trendView === 'split' ? '' : trendView, fv: fuelView === 'fuel' ? '' : fuelView });
  }

  /** One row per calendar month over the trailing year, each bar split planned against unplanned. */
  function months(end) {
    const pts = monthlyPoints(end);
    const anyFuel = pts.some((p) => p.fuel > 0);
    const anyToll = pts.some((p) => p.toll > 0);
    const top = Math.max(...pts.map((p) => p.grand), 1);
    const pct = (v) => (v / top) * 100;
    const rows = pts.map((p, i) => `
      <div class="hb-row" ${V.tipAttr(p.full, [
        ['Planned', L.fmtAUD(p.planned), COLOR_PLANNED],
        ['Unplanned', L.fmtAUD(p.unplanned), COLOR_UNPLANNED],
        ...(p.fuel ? [['Fuel', L.fmtAUD(p.fuel), COLOR_FUEL]] : []),
        ...(p.toll ? [['Tolls', L.fmtAUD(p.toll), COLOR_TOLL]] : []),
        ['Total', L.fmtAUD(p.grand), 'var(--ink)']
      ])}>
        <span class="hb-label">${esc(p.short)}</span>
        <span class="cs-mbar" style="--i:${i}">
          ${p.planned ? `<i style="width:${pct(p.planned)}%;background:${COLOR_PLANNED}"></i>` : ''}
          ${p.unplanned ? `<i style="width:${pct(p.unplanned)}%;background:${COLOR_UNPLANNED}"></i>` : ''}
          ${p.fuel ? `<i style="width:${pct(p.fuel)}%;background:${COLOR_FUEL}"></i>` : ''}
          ${p.toll > 0 ? `<i${animateTolls ? ' class="cs-arrive-seg"' : ''} style="width:${pct(p.toll)}%;background:${COLOR_TOLL}"></i>` : ''}
        </span>
        <span class="hb-val">${p.grand ? L.fmtAUD(p.grand) : '—'}</span>
      </div>`).join('');
    const legend = [
      ...(anyFuel ? [{ label: 'Fuel', color: COLOR_FUEL }] : []),
      ...(anyToll ? [{ label: 'Tolls', color: COLOR_TOLL }] : []),
      { label: 'Planned servicing', color: COLOR_PLANNED },
      { label: 'Unplanned repairs', color: COLOR_UNPLANNED }
    ];
    const head = ['Month', 'Planned', 'Unplanned'].concat(anyFuel ? ['Fuel'] : [], anyToll ? ['Tolls'] : [], ['Total']);
    const tableRows = pts.map((p) => [p.full, L.fmtAUD(p.planned), L.fmtAUD(p.unplanned)]
      .concat(anyFuel ? [L.fmtAUD(p.fuel)] : [], anyToll ? [L.fmtAUD(p.toll)] : [], [L.fmtAUD(p.grand)]));
    const what = ['servicing', 'repairs'].concat(anyFuel ? ['fuel'] : [], anyToll ? ['tolls'] : []);
    return `<figure class="viz-card">
      <figcaption><h3>Month by month</h3><span class="viz-sub">${TREND_MONTHS} months to ${T.fmtKey(end)} · ${what.slice(0, -1).join(', ')} and ${what[what.length - 1]}</span></figcaption>
      ${V.legend(legend, { counts: false })}
      <div class="hb cs-months">${rows}</div>
      ${V.table(head, tableRows)}
    </figure>`;
  }

  /** A round axis ceiling above `max`, so ticks read as clean numbers rather than the raw data max. */
  function niceTop(max) {
    if (max <= 0) return 1;
    const step = max > 20000 ? 5000 : max > 8000 ? 2000 : max > 2000 ? 500 : max > 400 ? 100 : 20;
    return Math.ceil(max / step) * step;
  }
  // Compact axis labels ($20k, $2.5k) so every gridline can carry one.
  const fmtAxis = (n) => n >= 1000 ? '$' + (n / 1000).toLocaleString('en-AU', { maximumFractionDigits: 1 }) + 'k' : '$' + Math.round(n).toLocaleString('en-AU');

  /** TREND_WEEKS weekly totals ending with (and including) the week on screen. */
  function weeklyPoints(end) {
    let lastMonth = null;
    return Array.from({ length: TREND_WEEKS }, (_, i) => {
      const from = T.addDays(end, -6 - 7 * (TREND_WEEKS - 1 - i));
      const p = T.parseKey(from);
      const showMonth = p.m !== lastMonth;
      lastMonth = p.m;
      const rows = rowsBetween(from, T.addDays(from, 6));
      const maint = sum(rows), fuel = fuelBetween(from, T.addDays(from, 6)), toll = tollBetween(from, T.addDays(from, 6));
      const to = T.addDays(from, 6), cards = fuelByCard((r) => r.date >= from && r.date <= to);
      return {
        total: maint, maint, fuel, toll, fuelTop: maint + fuel, grand: maint + fuel + toll, planned: sumKind(rows, PLANNED), unplanned: sumKind(rows, UNPLANNED),
        fuelWex: cards.wex, fuelBp: cards.bp,
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
      const maint = sum(rows), fuel = fuelForMonth(key), toll = tollForMonth(key);
      const cards = fuelByCard((r) => r.date.slice(0, 7) === key);
      const toDate = key === T.todayKey().slice(0, 7);
      return {
        total: maint, maint, fuel, toll, fuelTop: maint + fuel, grand: maint + fuel + toll, planned: sumKind(rows, PLANNED), unplanned: sumKind(rows, UNPLANNED),
        fuelWex: cards.wex, fuelBp: cards.bp,
        label: T.MONTHS[dt.getUTCMonth()].slice(0, 3),
        short: `${T.MONTHS[dt.getUTCMonth()].slice(0, 3)} ${String(dt.getUTCFullYear()).slice(2)}`,
        full: `${T.MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}${toDate ? ' (to date)' : ''}`
      };
    });
  }

  /** Projected future months — one flat forecast value per month. */
  function projectedMonths(end) {
    const { y, m } = T.parseKey(end);
    // Average the last three COMPLETE months: the month still running is only
    // partly in, and would pull the forecast down.
    const skip = end.slice(0, 7) === T.todayKey().slice(0, 7) ? 1 : 0;
    const recent = Array.from({ length: 3 }, (_, i) => {
      const dt = new Date(Date.UTC(y, m - 1 - i - skip, 1));
      const key = dt.toISOString().slice(0, 7);
      return sum(rowsForMonth(key)) + fuelForMonth(key) + tollForMonth(key); // forecast total cost incl fuel and tolls
    });
    const avgTotal = avgOf(recent);
    return Array.from({ length: PROJ_MONTHS }, (_, i) => {
      const dt = new Date(Date.UTC(y, m + i, 1));
      const key = T.MONTHS[dt.getUTCMonth()] + ' ' + dt.getUTCFullYear();
      const total = projOverrides[key] != null ? projOverrides[key] : avgTotal;
      return {
        total, maint: total, fuel: 0, toll: 0, fuelTop: total, grand: total, planned: total, unplanned: 0,
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
    const anyToll = points.some((p) => p.toll > 0);
    // Each series is drawn at its OWN value from $0 (not stacked), so the pink
    // tolls line is the toll cost, the blue line the fuel cost, and so on. A
    // thin grey line carries the month's total, and the forecast continues it.
    // Axis: 4–6 round steps, every gridline labelled.
    const maxV = Math.max(...points.map((p) => p.grand), 1) * 1.06;
    const rawStep = maxV / 5;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= rawStep);
    const top = Math.ceil(maxV / step) * step;
    const ticks = [];
    for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
    const W = 880, H = 210, padL = 56, padR = 12, padT = 16, padB = 26;
    const plotW = W - padL - padR, plotH = H - padT - padB, n = points.length;
    const x = (i) => padL + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
    const y = (v) => padT + plotH - (Math.max(0, Math.min(v, top)) / top) * plotH;
    const series = (get) => points.map((p, i) => ({ x: x(i), y: y(get(p) || 0) }));
    const coords = series((p) => p.grand);            // total — the forecast continues this line
    const plannedCoords = series((p) => p.planned);
    const unplannedCoords = series((p) => p.unplanned);
    const fuelCoords = series((p) => p.fuel);
    const tollCoords = series((p) => p.toll);
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
    const areaOf = (c) => `${spline(c)} L${c[c.length - 1].x.toFixed(1)},${floorY} L${c[0].x.toFixed(1)},${floorY} Z`;

    // Actuals only (the forecast is drawn separately after NOW).
    const hist = (c) => (hasProj ? c.slice(0, splitIdx + 1) : c);
    const histCoords = hist(coords), histPlanned = hist(plannedCoords), histUnplanned = hist(unplannedCoords);
    const histFuel = hist(fuelCoords), histToll = hist(tollCoords);
    const histTotalD = spline(histCoords);
    const histPlannedD = spline(histPlanned);
    const histUnplannedD = spline(histUnplanned);
    const histFuelD = spline(histFuel);
    const histTollD = spline(histToll);
    // Forecast: standalone zone after NOW, NOT connected to the actuals.
    const projCoords = hasProj ? coords.slice(splitIdx + 1) : [];
    const projLineD = projCoords.length >= 2 ? spline(projCoords) : (projCoords.length === 1 ? `M${projCoords[0].x.toFixed(1)},${projCoords[0].y.toFixed(1)}` : '');
    const projAreaD = projCoords.length ? `${projLineD} L${projCoords[projCoords.length - 1].x.toFixed(1)},${floorY} L${projCoords[0].x.toFixed(1)},${floorY} Z` : '';

    const hline = (gy, cls) => `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}" class="${cls}"></line>`;
    const grid = ticks.map((v) => hline(y(v), v === 0 ? 'cs-grid' : 'cs-grid cs-grid-minor')).join('')
      + coords.map((p) => `<line x1="${p.x.toFixed(1)}" y1="${padT}" x2="${p.x.toFixed(1)}" y2="${padT + plotH}" class="cs-grid cs-grid-x"></line>`).join('');
    const yTicks = ticks.map((v) => `<text class="cs-axis-y" x="${padL - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${fmtAxis(v)}</text>`).join('');

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

    // One hover dot per line per period, at that line's own value. The grey
    // total dot carries the full breakdown for the period.
    // Fuel hover also splits by card — only the cards that appear in the data.
    const cardsSeen = new Set(fuelRows().map((r) => r.card));
    const cardRows = (p) => [['wex', 'fuelWex', '· WEX card'], ['bp', 'fuelBp', '· BP card']]
      .filter(([c]) => cardsSeen.has(c)).map(([, k, label]) => [label, L.fmtAUD(p[k] || 0), 'var(--muted)']);
    const breakdown = (p) => [
      ['Planned servicing', L.fmtAUD(p.planned), COLOR_PLANNED],
      ['Unplanned repairs', L.fmtAUD(p.unplanned), COLOR_UNPLANNED],
      ...(anyFuel ? [['Fuel', L.fmtAUD(p.fuel), COLOR_FUEL], ...cardRows(p)] : []),
      ...(anyToll ? [['Tolls', L.fmtAUD(p.toll || 0), COLOR_TOLL]] : []),
      ['Total', L.fmtAUD(p.grand), 'var(--ink)']
    ];
    const seriesDots = (seriesCoords, colorVar, tipRows, keep) => seriesCoords.map((c, i) => {
      const p = points[i];
      if (keep && !keep(p)) return '';
      const isLast = i === splitIdx;
      const cx = c.x.toFixed(1), cy = c.y.toFixed(1);
      return `<g class="cs-mark${isLast ? ' cs-current' : ''}" style="--i:${i};--cs-line:${colorVar}">
        ${isLast ? `<circle cx="${cx}" cy="${cy}" r="9" class="cs-halo"></circle>` : ''}
        <circle cx="${cx}" cy="${cy}" r="4" class="cs-dot"></circle>
        <circle cx="${cx}" cy="${cy}" r="10" class="cs-hit" ${V.tipAttr(p.full, tipRows(p))}></circle>
      </g>`;
    }).join('');
    const one = (label, key, color) => (p) => [[label, L.fmtAUD(p[key] || 0), color], ['Month total', L.fmtAUD(p.grand), 'var(--ink)']];
    const plannedDots = seriesDots(histPlanned, COLOR_PLANNED, one('Planned servicing', 'planned', COLOR_PLANNED));
    const unplannedDots = seriesDots(histUnplanned, COLOR_UNPLANNED, one('Unplanned repairs', 'unplanned', COLOR_UNPLANNED));
    const fuelDots = anyFuel ? seriesDots(histFuel, COLOR_FUEL, (p) => {
      const rows = one('Fuel', 'fuel', COLOR_FUEL)(p);
      return [rows[0], ...cardRows(p), rows[1]];
    }) : '';
    // Toll dots only on periods that have tolls (no imported statement = no dot).
    const tollDotsRaw = anyToll ? seriesDots(histToll, COLOR_TOLL, one('Tolls', 'toll', COLOR_TOLL), (p) => p.toll > 0) : '';
    const tollDots = animateTolls && tollDotsRaw ? `<g class="cs-arrive-dots">${tollDotsRaw}</g>` : tollDotsRaw;
    // Two views (switch above the chart): 'split' draws each cost as its own
    // line; 'total' draws one red total-spend line. Either way the hover shows
    // what the period is made of.
    const showTotal = trendView === 'total';
    const totalDotsRaw = showTotal ? seriesDots(histCoords, 'var(--red)', breakdown) : '';
    const totalDots = animateTolls && totalDotsRaw ? `<g class="cs-arrive-dots">${totalDotsRaw}</g>` : totalDotsRaw;
    const arr = animateTolls ? ' cs-arrive' : '';   // tolls just arrived: draw their line in rather than popping it in
    const projMarks = projCoords.map((c, j) => {
      const p = points[splitIdx + 1 + j];
      const cx = c.x.toFixed(1), cy = c.y.toFixed(1);
      return `<g class="cs-mark cs-proj-mark" style="--i:${splitIdx + 1 + j}">
        <circle cx="${cx}" cy="${cy}" r="4" class="cs-dot"></circle>
        <circle cx="${cx}" cy="${cy}" r="16" class="cs-hit" ${V.tipAttr(p.full, [['Forecast total', L.fmtAUD(p.total), 'var(--violet)']])}></circle>
      </g>`;
    }).join('');
    const marks = (showTotal ? totalDots : plannedDots + unplannedDots + fuelDots + tollDots) + projMarks;
    const ariaDesc = points.map((p) => `${p.full}: ${L.fmtAUD(p.grand)} total, ${L.fmtAUD(p.fuel)} fuel, ${L.fmtAUD(p.toll || 0)} tolls, ${L.fmtAUD(p.planned)} planned, ${L.fmtAUD(p.unplanned)} unplanned`).join(', ');

    // Tolls only exist where a Linkt statement is imported: the pink line and
    // its fill are clipped to those stretches, so periods with no statement
    // don't show a pink line lying at $0.
    const tollRuns = [];
    if (anyToll) {
      const hasT = histToll.map((_, i) => points[i].toll > 0);
      // Join only neighbouring periods that BOTH have tolls: a period with no
      // statement imported is missing data, not a $0 month, so the line stops.
      for (let i = 0; i < histToll.length - 1; i++) {
        if (!(hasT[i] && hasT[i + 1])) continue;
        const last = tollRuns[tollRuns.length - 1];
        if (last && last.to === i) last.to = i + 1; else tollRuns.push({ from: i, to: i + 1 });
      }
      if (histToll.length === 1 && hasT[0]) tollRuns.push({ from: 0, to: 0 });
    }
    const tollClip = tollRuns.map((r) => {
      const x1 = histToll[r.from].x - 1, x2 = histToll[r.to].x + 1;
      return `<rect x="${x1.toFixed(1)}" y="0" width="${Math.max(2, x2 - x1).toFixed(1)}" height="${H}"></rect>`;
    }).join('');

    // Back to front: fills, then each series line (or, in the Total view, the
    // single red total line and its fill).
    const layers = showTotal ? `
          <path d="${areaOf(histCoords)}" class="cs-area-total${arr}"></path>
          <path d="${histTotalD}" class="cs-line-total-red${arr}" pathLength="1"></path>` : `
          ${anyFuel ? `<path d="${areaOf(histFuel)}" class="cs-band-fuel"></path>` : ''}
          ${anyToll ? `<clipPath id="cs-toll-clip">${tollClip}</clipPath>
          <path d="${areaOf(histToll)}" class="cs-band-toll${arr}" clip-path="url(#cs-toll-clip)"></path>` : ''}
          ${anyFuel ? `<path d="${histFuelD}" class="cs-line-grand" pathLength="1"></path>` : ''}
          ${anyToll ? `<path d="${histTollD}" class="cs-line-toll${arr}" pathLength="1" clip-path="url(#cs-toll-clip)"></path>` : ''}
          <path d="${histUnplannedD}" class="cs-line-path" pathLength="1"></path>
          <path d="${histPlannedD}" class="cs-line-planned" pathLength="1"></path>`;
    const svgBody = `${grid}
          ${layers}
          ${hasProj ? `<g class="cs-proj-g">
            ${projAreaD ? `<path d="${projAreaD}" class="cs-proj-area"></path>` : ''}
            ${projLineD ? `<path d="${projLineD}" class="cs-line-path" pathLength="1"></path>` : ''}
          </g>
          ${nowMarker}` : ''}
          ${yTicks}${xTicks}${marks}`;

    // Same order as the cards above: fuel, tolls, planned servicing, unplanned repairs.
    const legendItems = showTotal ? [{ label: 'Total spend', color: 'var(--red)' }] : [
      ...(anyFuel ? [{ label: 'Fuel (imported)', color: COLOR_FUEL }] : []),
      ...(anyToll ? [{ label: 'Tolls (Linkt)', color: COLOR_TOLL }] : []),
      { label: 'Planned servicing', color: COLOR_PLANNED },
      { label: 'Unplanned repairs', color: COLOR_UNPLANNED }
    ];
    if (hasProj) legendItems.push({ label: 'Forecast (total)', color: 'var(--violet)' });

    return `<figure class="viz-card">
      <figcaption><h3>Spend over time</h3><span class="viz-sub">${isMonthly ? TREND_MONTHS + ' months' : TREND_WEEKS + ' weeks'} to ${T.fmtKey(end)}${hasProj ? ' + ' + PROJ_MONTHS + '-month forecast' : ''}</span></figcaption>
      <div class="cs-trend-controls">
        <div class="seg cs-period" role="group" aria-label="Chart period">
          <button type="button" data-period="week" class="${period === 'week' ? 'on' : ''}">Weekly</button>
          <button type="button" data-period="month" class="${period === 'month' ? 'on' : ''}">Monthly</button>
        </div>
        <div class="seg cs-period" role="group" aria-label="Show">
          <button type="button" data-trendview="split" class="${showTotal ? '' : 'on'}">Breakdown</button>
          <button type="button" data-trendview="total" class="${showTotal ? 'on' : ''}">Total</button>
        </div>
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
            <linearGradient id="cs-total-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style="stop-color:var(--red);stop-opacity:.32"></stop>
              <stop offset="60%" style="stop-color:var(--red);stop-opacity:.12"></stop>
              <stop offset="100%" style="stop-color:var(--red);stop-opacity:.02"></stop>
            </linearGradient>
            <filter id="cs-glow-red" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">
              <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur"/>
              <feFlood flood-color="var(--red)" flood-opacity=".45"/>
              <feComposite in2="blur" operator="in"/>
              <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <linearGradient id="cs-band-toll-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style="stop-color:${COLOR_TOLL};stop-opacity:.34"></stop>
              <stop offset="60%" style="stop-color:${COLOR_TOLL};stop-opacity:.14"></stop>
              <stop offset="100%" style="stop-color:${COLOR_TOLL};stop-opacity:.04"></stop>
            </linearGradient>
            <linearGradient id="cs-proj-area-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style="stop-color:var(--violet);stop-opacity:.30"></stop>
              <stop offset="50%" style="stop-color:var(--violet);stop-opacity:.12"></stop>
              <stop offset="100%" style="stop-color:var(--violet);stop-opacity:0"></stop>
            </linearGradient>
            <!-- userSpaceOnUse: a perfectly flat line (e.g. no repairs all year) has a zero-height box, which a percentage filter region turns invisible. -->
            <filter id="cs-glow-mint" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">
              <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur"/>
              <feFlood flood-color="var(--mint)" flood-opacity=".45"/>
              <feComposite in2="blur" operator="in"/>
              <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <filter id="cs-glow-amber" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur"/>
              <feFlood flood-color="var(--cs-amber)" flood-opacity=".4"/>
              <feComposite in2="blur" operator="in"/>
              <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <filter id="cs-glow-blue" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">
              <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur"/>
              <feFlood flood-color="var(--cs-blue)" flood-opacity=".4"/>
              <feComposite in2="blur" operator="in"/>
              <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <filter id="cs-glow-violet" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">
              <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur"/>
              <feFlood flood-color="var(--violet)" flood-opacity=".5"/>
              <feComposite in2="blur" operator="in"/>
              <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>
          ${svgBody}
        </svg>
      </div>
      ${V.table([isMonthly ? 'Month' : 'Week starting', 'Planned', 'Unplanned'].concat(anyFuel ? ['Fuel'] : [], anyToll ? ['Tolls'] : [], ['Total']),
        points.map((p) => [p.full, L.fmtAUD(p.planned), L.fmtAUD(p.unplanned)]
          .concat(anyFuel ? [L.fmtAUD(p.fuel)] : [], anyToll ? [L.fmtAUD(p.toll || 0)] : [], [L.fmtAUD(p.grand)])))}
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
    const proj = projectedMonths(chartEnd());
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
  /**
   * Each vehicle's spend between two dates — fuel card, Linkt tolls, planned
   * servicing, unplanned repairs — highest first, plus what isn't tied to any
   * vehicle (person fuel cards, unlinked or shared toll tags, account credits),
   * so the lists can say how far short of Total spend they fall.
   */
  function vehicleSpend(from, to) {
    const inP = (d) => d && d >= from && d <= to;
    const totals = new Map();
    const get = (id) => {
      if (!totals.has(id)) totals.set(id, { fuel: 0, toll: 0, planned: 0, unplanned: 0 });
      return totals.get(id);
    };
    let looseFuel = 0, tollAssigned = 0;
    fuelRows().forEach((r) => { if (!inP(r.date)) return; if (r.vehicleId) get(r.vehicleId).fuel += r.cost; else looseFuel += r.cost; });
    rowsBetween(from, to).forEach((r) => { if (r.vehicleId) get(r.vehicleId)[r.kind === PLANNED ? 'planned' : 'unplanned'] += r.cost; });
    (L.tollsByVehicle ? L.tollsByVehicle() : new Map()).forEach((rows, id) => rows.forEach((r) => {
      if (!inP(String(r.date).slice(0, 10))) return;
      const a = Number(r.amount) || 0;
      get(id).toll += a;
      tollAssigned += a;
    }));
    const lines = [...totals.entries()]
      .map(([id, t]) => ({ v: AD.store.get('vehicles', id) || { id }, ...t, total: t.fuel + t.toll + t.planned + t.unplanned }))
      .filter((l) => l.total > 0.005)
      .sort((a, b) => b.total - a.total);
    return { lines, loose: looseFuel + tollBetween(from, to) - tollAssigned };
  }

  const SPEND_PARTS = [['fuel', 'Fuel', 'cs-seg-fuel', COLOR_FUEL], ['toll', 'Tolls', 'cs-seg-toll', COLOR_TOLL],
    ['planned', 'Servicing', 'cs-seg-planned', COLOR_PLANNED], ['unplanned', 'Repairs', 'cs-seg-unplanned', COLOR_UNPLANNED]];

  /** One row per vehicle: art, rego, a bar split by type, the total, and the driver and split underneath. `sub(line)` adds a small line under the total. */
  function spendRows(lines, sub) {
    const top = (lines[0] && lines[0].total) || 1;
    return lines.map((l, i) => {
      const parts = SPEND_PARTS.filter(([k]) => l[k] > 0);
      let left = 0;
      const segs = parts.map(([k, , cls], j) => {
        const w = (l[k] / top) * 100;
        const s = `<i class="${cls}" style="left:${left}%;width:${w}%;--i:${j}"></i>`;
        left += w;
        return s;
      }).join('');
      const drv = L.driverName(l.v.driverId);
      const art = (AD.art && AD.art.forVehicle(l.v, 44)) || '';
      const subTxt = sub ? sub(l) : '';
      return `<a class="cs-row cs-row-art${sub ? ' cs-fuelkm-row' : ''}" href="${vehHref(l.v.id)}" style="--i:${i}" ${V.tipAttr(l.v.id, [
          ...parts.map(([k, label, , color]) => [label, L.fmtAUD(l[k]), color]),
          ['Total', L.fmtAUD(l.total), 'var(--ink)']
        ])}>
        <span class="id">${art ? `<span class="cs-veh-art">${art}</span>` : ''}<span class="cs-id-text">${esc(l.v.id)}${l.v.rego ? `<small class="cs-rego">${esc(l.v.rego)}</small>` : ''}</span></span>
        <span class="cs-hbar cs-stack">${segs}</span>
        <span class="cs-row-val">${L.fmtAUD(l.total)}${subTxt ? `<span class="cs-row-sub">${subTxt}</span>` : ''}</span>
        <span class="cs-row-meta">${drv ? `<span class="cs-driver">${esc(drv)}</span> · ` : ''}${parts.map(([k, label]) => `${label} ${L.fmtAUD(l[k])}`).join(' · ')}</span>
      </a>`;
    });
  }
  const spendLegend = (lines) => V.legend(SPEND_PARTS.filter(([k]) => lines.some((l) => l[k] > 0))
    .map(([, label, , color]) => ({ label, color })), { counts: false });
  const spendTable = (lines) => V.table(['Vehicle', 'Rego', 'Assigned driver', 'Fuel', 'Tolls', 'Servicing', 'Repairs', 'Total'],
    lines.map((l) => [l.v.id, l.v.rego || '', L.driverName(l.v.driverId) || '—', L.fmtAUD(l.fuel), L.fmtAUD(l.toll), L.fmtAUD(l.planned), L.fmtAUD(l.unplanned), L.fmtAUD(l.total)]));
  const looseNote = (loose) => Math.abs(loose) > 0.5
    ? `<p class="cs-more">Plus ${L.fmtAUD(loose)} not tied to a vehicle (person fuel cards, unlinked toll tags, account credits), which is in Total spend.</p>` : '';
  /** While tolls are still loading the lists are fuel and maintenance only — say so rather than show low totals as fact. */
  function tollLoadingNote() {
    const st = AD.store.tollsState ? AD.store.tollsState() : 'missing';
    return st === 'idle' || st === 'loading' ? `<p class="cs-more" data-toll-progress>${tollProgressText()}</p>` : '';
  }
  /** The latest day each import reaches, so a month past it can say its fuel or tolls aren't complete yet. */
  function dataReach() {
    let fuel = '', toll = '';
    (AD.store.all('fuel_entries') || []).forEach((r) => { const d = String(r.date || '').slice(0, 10); if (d > fuel) fuel = d; });
    (AD.store.all('toll_entries') || []).forEach((r) => { const d = String(r.periodEnd || r.date || '').slice(0, 10); if (d > toll) toll = d; });
    return { fuel, toll };
  }

  /**
   * Most expensive last month, beside Month by month: each vehicle's spend for
   * the last complete month on screen (October when looking at this year in
   * November; a past period's own last month when looking back). A single
   * recent month shows who is costing money now, where a year mostly shows
   * who has been in the fleet longest.
   */
  function lastMonthSpend() {
    const ref = chartEnd();
    let ms = periodStart('month', ref);
    if (ref !== periodEnd('month', ms)) ms = stepPeriod('month', ms, -1);
    const me = periodEnd('month', ms);
    const label = fmtPeriodLabel('month', ms);
    const isLast = ms === stepPeriod('month', periodStart('month', T.todayKey()), -1);
    const { lines, loose } = vehicleSpend(ms, me);
    const reach = dataReach();
    const gaps = [];
    if (reach.fuel && reach.fuel < me) gaps.push(`fuel card data only goes to ${T.fmtKey(reach.fuel)}`);
    if (reach.toll && reach.toll < me) gaps.push(`Linkt tolls only go to ${T.fmtKey(reach.toll)} (the latest statement imported)`);
    const gapNote = gaps.length ? `<p class="cs-more">Not the full month yet: ${gaps.join('; ')}.</p>` : '';
    // One short note under the list, so this card stays level with Month by month.
    const notes = [gaps.length ? `Not the full month yet: ${gaps.join('; ')}.` : '',
      Math.abs(loose) > 0.5 ? `Plus ${L.fmtAUD(loose)} not tied to a vehicle (person fuel cards, unlinked toll tags, credits).` : ''].filter(Boolean).join(' ');
    const head = `<figcaption><h3>Most expensive ${isLast ? 'last month' : 'in ' + esc(label)}</h3><span class="viz-sub">${esc(label)} · fuel, tolls, servicing and repairs per vehicle, highest first</span></figcaption>`;
    if (!lines.length) {
      return `<figure class="viz-card">${head}<p class="empty">No costs recorded against any vehicle in ${esc(label)}.</p>${gapNote}${tollLoadingNote()}</figure>`;
    }
    return `<figure class="viz-card">
      ${head}
      ${spendLegend(lines)}
      <div class="cs-rows">${topRows(spendRows(lines), 'vehicles', 7)}</div>
      ${notes ? `<p class="cs-more">${notes}</p>` : ''}
      ${tollLoadingNote()}
      ${spendTable(lines)}
    </figure>`;
  }

  /**
   * Fuel & tolls → Both: Top spending vehicles, full width. Every vehicle's
   * spend for the period on screen (fuel card, tolls, servicing, repairs),
   * highest first, with an average per vehicle — a fair figure for a growing
   * fleet, where the total only ever goes up.
   */
  function topSpendingWide(actions = '') {
    const label = fmtPeriodLabel(scope, start);
    const { lines, loose } = vehicleSpend(start, end);
    const head = (meta) => sectionHead({ title: 'Top spending vehicles', meta, actions });
    if (!lines.length) {
      return `<section class="section" id="cs-top-spend">${head(esc(label))}
        <figure class="viz-card"><p class="empty">No costs recorded against any vehicle in ${esc(label)}.</p>${tollLoadingNote()}</figure>
      </section>`;
    }
    const tied = lines.reduce((t, l) => t + l.total, 0);
    const n = Math.min(5, lines.length);
    const topN = lines.slice(0, n).reduce((t, l) => t + l.total, 0);
    const first = lines[0];
    const firstDrv = L.driverName(first.v.driverId);
    const pct = (x) => { const p = (x / tied) * 100; return p > 0 && p < 1 ? '<1' : String(Math.round(p)); };
    const k = (lbl, value, sub) => `<div class="cost-kpi"><span>${esc(lbl)}</span><strong>${value}</strong><small>${sub}</small></div>`;
    const kpis = `<div class="cost-kpis cs-fuelkm-kpis">
        ${k('Average per vehicle', L.fmtAUD(tied / lines.length), `across the ${lines.length} vehicle${lines.length === 1 ? '' : 's'} with spend`)}
        ${k('Highest', esc(first.v.id), `${L.fmtAUD(first.total)}${firstDrv ? ' · ' + esc(firstDrv) : ''}`)}
        ${k(`Top ${n} vehicle${n === 1 ? '' : 's'}`, `${pct(topN)}%`, `${L.fmtAUD(topN)} of ${L.fmtAUD(tied)} vehicle spend`)}
        ${k('Not tied to a vehicle', L.fmtAUD(loose), 'person fuel cards, unlinked toll tags, credits')}
      </div>`;
    return `<section class="section" id="cs-top-spend">
      ${head(`${esc(label)} · ${lines.length} vehicle${lines.length === 1 ? '' : 's'} · ${L.fmtAUD(tied)}`)}
      <figure class="viz-card">
        <figcaption><span class="viz-sub">Everything charged to each vehicle in ${esc(label)}: fuel card, Linkt tolls, planned servicing and unplanned repairs. Hover a bar for the split, or click a vehicle to open it.</span></figcaption>
        ${kpis}
        ${spendLegend(lines)}
        <div class="cs-rows">${topRows(spendRows(lines, (l) => `${pct(l.total)}% of vehicle spend`))}</div>
        ${tollLoadingNote()}
        ${spendTable(lines)}
      </figure>
    </section>`;
  }

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
   * Cost vs usage: what each GPS-tracked vehicle costs to run per kilometre or
   * per engine hour, or its fuel alone per kilometre. Like for like, or not at
   * all:
   *  - Days: the vehicle's daily GPS readings (last USAGE_WINDOW_DAYS), cut off
   *    at the last day its fuel card's imports reach. GPS arrives nightly but
   *    fuel only with each statement, and counting GPS days that have no fuel
   *    data yet made working vehicles look almost free.
   *  - Spend over exactly those days: fuel card, Linkt tolls (as far as the
   *    latest statement goes), planned servicing and unplanned repairs.
   *  - Ranked only once a vehicle has READY_USAGE_DAYS of that overlap. A tank
   *    fill covers about a week, so over two or three weeks one fill more or
   *    less swings the figure by a third; until then it shows its progress.
   * `metric` is 'km', 'hr' or 'fuel' (fuel purchases ÷ km). Independent of the
   * week/month/year selector: it always measures the most recent data.
   */
  function usageMeasures(metric) {
    const rows = fuelRows();
    const reachByCard = {};
    let anyReach = '';
    const lastRow = new Map();   // vehicle → its latest fuel row (whose card it's on now)
    rows.forEach((r) => {
      if (!reachByCard[r.card] || r.date > reachByCard[r.card]) reachByCard[r.card] = r.date;
      if (r.date > anyReach) anyReach = r.date;
      if (r.vehicleId) { const p = lastRow.get(r.vehicleId); if (!p || r.date > p.date) lastRow.set(r.vehicleId, r); }
    });
    let tollReach = '';
    (AD.store.all('toll_entries') || []).forEach((r) => { const d = String(r.periodEnd || r.date || '').slice(0, 10); if (d > tollReach) tollReach = d; });
    const tollMap = L.tollsByVehicle ? L.tollsByVehicle() : new Map();
    const key = metric === 'hr' ? 'hours' : 'km';

    const list = AD.store.all('vehicles').filter((v) => !v.hired).map((v) => {
      const daily = L.workHoursDaily(v, USAGE_WINDOW_DAYS);
      if (!daily) return null;
      const gps = daily.days.filter((d) => d[key] != null);
      if (!gps.length) return null;
      const card = lastRow.has(v.id) ? lastRow.get(v.id).card : '';
      const reach = card ? reachByCard[card] : anyReach;
      const gpsFrom = gps[0].day, gpsTo = gps[gps.length - 1].day;
      const base = { v, card, reach, gpsFrom, gpsTo };
      const days = reach ? gps.filter((d) => d.day <= reach) : [];
      if (!days.length) return { ...base, state: 'waiting' };
      const fromKey = days[0].day, toKey = days[days.length - 1].day;
      const span = T.daysBetween(fromKey, toKey) + 1;
      const use = days.reduce((n, d) => n + (d[key] || 0), 0);
      const f = L.fuelFor(v, fromKey, toKey);
      const maint = rowsBetween(fromKey, toKey).filter((r) => r.vehicleId === v.id);
      const tollTo = tollReach && tollReach < toKey ? tollReach : toKey;
      const toll = (tollMap.get(v.id) || []).reduce((n, r) => {
        const d = String(r.date).slice(0, 10);
        return d >= fromKey && d <= tollTo ? n + (Number(r.amount) || 0) : n;
      }, 0);
      const m = {
        ...base, fromKey, toKey, span, readings: days.length, use, perDay: use / span,
        fuel: f ? f.cost : 0, fuelOnly: f ? f.fuelCost : 0, litres: f ? f.litres : 0, fills: f ? f.fills : 0,
        toll, planned: sumKind(maint, PLANNED), unplanned: sumKind(maint, UNPLANNED),
        cut: !!reach && reach < gpsTo   // GPS runs on past the fuel data
      };
      m.spend = metric === 'fuel' ? m.fuelOnly : m.fuel + m.toll + m.planned + m.unplanned;
      m.rate = use > 0 && m.fuelOnly > 0 ? m.spend / use : null;
      m.state = !(use > 0) ? 'idle' : span < READY_USAGE_DAYS ? 'collecting' : m.fuelOnly > 0 ? 'ready' : 'nofuel';
      return m;
    }).filter(Boolean);
    return { list, tollReach, anyReach };
  }

  function costVsUsage() {
    // One switch in the heading: total running cost per km or per engine hour,
    // or fuel alone per km (with L/100km).
    const useOpt = (key, label) => `<button type="button" data-use="${key}" class="${usageMode === key ? 'on' : ''}">${label}</button>`;
    const usageSwitch = `<div class="seg" role="group" aria-label="Measure">${useOpt('km', 'Cost per km')}${useOpt('hr', 'Cost per hour')}${useOpt('fuel', 'Fuel per km')}</div>`;
    const READY = READY_USAGE_DAYS, STEADY = STEADY_USAGE_DAYS;
    const HIGH = 1.3, LOW = 0.6;   // 30%+ above the median rate is costly; under 60% of the median use is low use
    const fuelMode = usageMode === 'fuel', perHr = usageMode === 'hr';
    const unit = perHr ? 'hr' : 'km';
    const what = fuelMode ? 'Fuel per km' : perHr ? 'Cost per engine hour' : 'Cost per km';
    const fmtRate = (n) => '$' + (n >= 10 ? Math.round(n).toLocaleString('en-AU') : n.toFixed(2));
    const n0 = (n) => Math.round(n).toLocaleString('en-AU');
    const fmtUse = (n) => perHr ? `${n0(n)} hrs` : `${n0(n)} km`;
    const short = (k) => T.fmtKey(k).slice(0, 5);
    const l100 = (m) => (m.litres > 0 && m.use > 0 ? (m.litres / m.use) * 100 : null);
    const head = (meta) => sectionHead({ title: 'Cost vs usage', meta, actions: usageSwitch });
    const kpi = (label, value, sub) => `<div class="cost-kpi"><span>${esc(label)}</span><strong>${value}</strong><small>${sub}</small></div>`;
    const idCell = (v) => {
      const art = (AD.art && AD.art.forVehicle(v, 44)) || '';
      return `<span class="id">${art ? `<span class="cs-veh-art">${art}</span>` : ''}<span class="cs-id-text">${esc(v.id)}${v.rego ? `<small class="cs-rego">${esc(v.rego)}</small>` : ''}</span></span>`;
    };
    const drv = (v) => { const n = L.driverName(v.driverId); return n ? `<span class="cs-driver">${esc(n)}</span> · ` : ''; };
    const range = (m) => `${m.span} day${m.span === 1 ? '' : 's'} (${short(m.fromKey)}–${short(m.toKey)})`;

    const { list, tollReach, anyReach } = usageMeasures(usageMode);
    const caption = `<figcaption><span class="viz-sub">${fuelMode
      ? 'Fuel bought on the card ÷ the kilometres the GPS recorded'
      : `Everything the vehicle cost (fuel card, tolls, servicing and repairs) ÷ the ${perHr ? 'engine hours' : 'kilometres'} the GPS recorded`}, counted only over days that have both GPS and fuel-card data. A vehicle is ranked once it has ${READY} days of that, so one tank fill more or less doesn’t swing its figure. ${perHr ? 'Engine hours count work done parked, so this is the fairer measure for vac trucks.' : fuelMode ? '' : 'Distance suits tippers, utes and anything that earns its keep on the road.'}</span></figcaption>`;

    if (!list.length) {
      return `<section class="section">${head(`${what} · from the daily GPS data`)}
        <figure class="viz-card">${caption}<p class="empty">No vehicle has daily GPS ${perHr ? 'engine hours' : 'distance'} yet. The nightly sync adds a day for every tracked vehicle, so they appear here on their own.</p></figure>
      </section>`;
    }

    const ready = list.filter((m) => m.state === 'ready').sort((a, b) => b.rate - a.rate);
    const collecting = list.filter((m) => m.state === 'collecting').sort((a, b) => b.span - a.span || a.v.id.localeCompare(b.v.id));
    const cant = list.filter((m) => m.state === 'waiting' || m.state === 'nofuel' || m.state === 'idle');
    const parts = fuelMode
      ? [['fuelOnly', 'Fuel', 'cs-seg-fuel', COLOR_FUEL]]
      : [['fuel', 'Fuel', 'cs-seg-fuel', COLOR_FUEL], ['toll', 'Tolls', 'cs-seg-toll', COLOR_TOLL], ['planned', 'Servicing', 'cs-seg-planned', COLOR_PLANNED], ['unplanned', 'Repairs', 'cs-seg-unplanned', COLOR_UNPLANNED]];

    // The full working behind every figure, on hover.
    const tip = (m) => V.tipAttr(m.v.id, [
      ...(m.rate != null && m.state === 'ready' ? [[what, `${fmtRate(m.rate)}/${unit}`, 'var(--ink)']] : []),
      ...parts.filter(([k]) => m[k] > 0).map(([k, label, , color]) => [label, L.fmtAUD(m[k]), color]),
      ...(fuelMode && m.litres > 0 ? [['Litres', `${n0(m.litres)} L · ${m.fills} fill${m.fills === 1 ? '' : 's'}`, 'var(--muted)']] : []),
      ...(fuelMode && l100(m) != null ? [['Economy', `${l100(m).toFixed(1)} L/100km`, 'var(--muted)']] : []),
      [perHr ? 'Engine hours (GPS)' : 'Distance (GPS)', fmtUse(m.use), 'var(--muted)'],
      ['Over', `${m.span} days · ${T.fmtKey(m.fromKey)}–${T.fmtKey(m.toKey)}`, 'var(--muted)'],
      ...(m.cut ? [['GPS goes on to', `${T.fmtKey(m.gpsTo)}, but fuel data ends ${T.fmtKey(m.reach)}`, 'var(--muted)']] : []),
      ...(m.rate != null && m.state === 'ready' ? [[`= ${L.fmtAUD(m.spend)} ÷ ${fmtUse(m.use)}`, `${fmtRate(m.rate)}/${unit}`, 'var(--ink)']] : [])
    ]);

    // Ranked vehicles: a bar split by spend type, so an expensive vehicle shows why.
    const medRate = ready.length ? median(ready.map((m) => m.rate)) : 0;
    const medUse = ready.length ? median(ready.map((m) => m.perDay)) : 0;
    const top = Math.max(...ready.map((m) => m.rate), 0.0001);
    const stack = (m) => {
      let left = 0;
      return parts.filter(([k]) => m[k] > 0).map(([k, , cls], i) => {
        const w = (m[k] / m.use / top) * 100;
        const seg = `<i class="${cls}" style="left:${left}%;width:${w}%;--i:${i}"></i>`;
        left += w;
        return seg;
      }).join('');
    };
    const vsMedian = (ratio) => (ratio >= 2 ? `${ratio.toFixed(1)}× the median` : `${Math.round((ratio - 1) * 100)}% above median`);
    const rankedRows = ready.map((m, i) => {
      const ratio = medRate > 0 ? m.rate / medRate : 1;
      const costly = ready.length > 1 && ratio > HIGH;
      const chips = [
        costly ? `<span class="cs-chip cs-chip-amber">${vsMedian(ratio)}</span>` : '',
        costly && !fuelMode && m.unplanned > m.spend / 2 ? '<span class="cs-chip">Mostly one-off repairs</span>' : '',
        ready.length > 1 && medUse > 0 && m.perDay < medUse * LOW ? '<span class="cs-chip">Low use</span>' : ''
      ].join('');
      const sub = fuelMode ? (l100(m) != null ? `${l100(m).toFixed(1)} L/100km` : '') : L.fmtAUD(m.spend);
      const detail = fuelMode
        ? `${L.fmtAUD(m.fuelOnly)} fuel · ${fmtUse(m.use)} · ${range(m)}`
        : `${fmtUse(m.use)} · ~${perHr ? `${n0(m.perDay * 7)} hrs` : `${n0(m.perDay * 7)} km`}/week · ${range(m)}`;
      return `<a class="cs-row cs-row-art cs-fuelkm-row" href="${vehHref(m.v.id)}" style="--i:${i}" ${tip(m)}>
        ${idCell(m.v)}
        <span class="cs-hbar cs-stack">${stack(m)}${ready.length > 1 ? `<b class="cs-median" style="left:${(medRate / top) * 100}%"></b>` : ''}</span>
        <span class="cs-row-val">${fmtRate(m.rate)}<small>/${unit}</small>${sub ? `<span class="cs-row-sub">${sub}</span>` : ''}</span>
        <span class="cs-row-meta">${drv(m.v)}${chips}${detail}</span>
      </a>`;
    });

    // Still collecting: progress toward READY days, and the date it gets there.
    const collectRows = collecting.map((m, i) => {
      const target = T.addDays(m.fromKey, READY - 1);
      const when = m.cut && m.gpsTo >= target ? `ready once fuel data reaches ${short(target)}` : `ready about ${short(target)}`;
      return `<a class="cs-row cs-row-art cs-fuelkm-row" href="${vehHref(m.v.id)}" style="--i:${ready.length + i}" ${tip(m)}>
        ${idCell(m.v)}
        <span class="cs-hbar"><i class="cs-progress" style="width:${Math.min(100, (m.span / READY) * 100)}%"></i></span>
        <span class="cs-row-val">${m.span}<small> of ${READY} days</small><span class="cs-row-sub">${when}</span></span>
        <span class="cs-row-meta">${drv(m.v)}so far ${L.fmtAUD(m.spend)}${fuelMode ? ' fuel' : ''} over ${fmtUse(m.use)}${m.cut ? ` · fuel data ends ${short(m.reach)}` : ''}</span>
      </a>`;
    });

    // Can't be measured: no fuel data for its GPS days yet, no fuel bought, or no use.
    const cantRows = cant.map((m, i) => {
      const why = m.state === 'waiting'
        ? `GPS since ${T.fmtKey(m.gpsFrom)}, but ${m.card ? `its ${m.card.toUpperCase()} card data` : 'the fuel-card data'} ${m.reach ? `ends ${T.fmtKey(m.reach)}` : 'hasn’t been imported'}. A newer statement starts the count.`
        : m.state === 'nofuel'
          ? `${fmtUse(m.use)} over ${range(m)}, but no fuel bought on its card in those days${lastFillNote(m.v)}. Its fuel may be going on a person card.`
          : `No ${perHr ? 'engine hours' : 'distance'} recorded over ${range(m)}.`;
      return `<a class="cs-row cs-row-art cs-row-muted cs-fuelkm-row" href="${vehHref(m.v.id)}" style="--i:${ready.length + collecting.length + i}"${m.state === 'waiting' ? '' : ' ' + tip(m)}>
        ${idCell(m.v)}
        <span class="cs-row-nofuel">${why}</span>
        <span class="cs-row-val">—</span>
      </a>`;
    });

    // Headline figures.
    let kpis, meta;
    if (ready.length) {
      const spendSum = ready.reduce((n, m) => n + m.spend, 0), useSum = ready.reduce((n, m) => n + m.use, 0);
      const spans = ready.map((m) => m.span), dMin = Math.min(...spans), dMax = Math.max(...spans);
      const dayLabel = dMin === dMax ? `${dMin}` : `${dMin}–${dMax}`;
      const first = ready[0];
      const econs = ready.map(l100).filter((n) => n != null);
      kpis = `<div class="cost-kpis cs-fuelkm-kpis">
        ${kpi(fuelMode ? 'Median fuel cost' : `Median cost per ${perHr ? 'hour' : 'km'}`, `${fmtRate(medRate)}<small class="cs-kpi-unit">/${unit}</small>`, `across ${ready.length} vehicle${ready.length === 1 ? '' : 's'}`)}
        ${fuelMode
          ? kpi('Median economy', econs.length ? `${median(econs).toFixed(1)}<small class="cs-kpi-unit"> L/100km</small>` : '—', 'litres per 100 km')
          : kpi('Fleet average', `${fmtRate(useSum > 0 ? spendSum / useSum : 0)}<small class="cs-kpi-unit">/${unit}</small>`, `${L.fmtAUD(spendSum)} ÷ ${fmtUse(useSum)}`)}
        ${kpi('Most expensive', esc(first.v.id), `${fmtRate(first.rate)}/${unit}${ready.length > 1 && medRate > 0 && first.rate / medRate > 1.005 ? ` · ${vsMedian(first.rate / medRate)}` : ''}`)}
        ${kpi('Days measured', dayLabel, `GPS and fuel side by side · steadier at ${STEADY}+`)}
      </div>`;
      meta = `${what} · ${ready.length} of ${list.length} GPS-tracked vehicle${list.length === 1 ? '' : 's'} ranked`;
    } else {
      const most = collecting.length ? Math.max(...collecting.map((m) => m.span)) : 0;
      kpis = `<div class="cost-kpis cs-fuelkm-kpis">
        ${kpi('GPS-tracked vehicles', String(list.length), 'with daily GPS data')}
        ${kpi('Ranked', `0 of ${list.length}`, `each needs ${READY} days of GPS and fuel data`)}
        ${kpi('Most days so far', most ? `${most}<small class="cs-kpi-unit"> of ${READY}</small>` : '—', collecting.length ? `${esc(collecting[0].v.id)} is closest` : 'none collecting yet')}
        ${kpi('Fuel data up to', anyReach ? T.fmtKey(anyReach) : '—', 'the latest fuel-card import')}
      </div>`;
      meta = `${what} · collecting data for ${list.length} GPS-tracked vehicle${list.length === 1 ? '' : 's'}`;
    }

    // Tolls only go as far as the latest Linkt statement.
    const measured = ready.concat(collecting);
    let tollNote = '';
    if (!fuelMode && tollReach && measured.length) {
      const minFrom = measured.reduce((a, m) => (m.fromKey < a ? m.fromKey : a), measured[0].fromKey);
      const maxTo = measured.reduce((a, m) => (m.toKey > a ? m.toKey : a), measured[0].toKey);
      if (tollReach < minFrom) tollNote = `Tolls aren’t in these figures yet: the latest Linkt statement ends ${T.fmtKey(tollReach)}, before the days measured.`;
      else if (tollReach < maxTo) tollNote = `Tolls are counted to ${T.fmtKey(tollReach)} (the latest Linkt statement); later days are fuel, servicing and repairs only.`;
    }

    const legend = ready.length ? `<p class="cs-legend">
        ${parts.filter(([k]) => ready.some((m) => m[k] > 0)).map(([, label, cls]) => `<span><i class="cs-legend-swatch ${cls}"></i>${label}</span>`).join('')}
        ${ready.length > 1 ? `<span><b class="cs-legend-tick"></b>Median (${fmtRate(medRate)}/${unit})</span>` : ''}
      </p>` : '';

    const status = (m) => m.state === 'ready' ? 'Ranked' : m.state === 'collecting' ? `Collecting · ${m.span} of ${READY} days`
      : m.state === 'waiting' ? 'Waiting for fuel data' : m.state === 'nofuel' ? 'No fuel bought' : 'Not used';
    const tableRows = ready.concat(collecting, cant).map((m) => {
      const has = m.state !== 'waiting';
      return fuelMode
        ? [m.v.id, m.state === 'ready' ? `${fmtRate(m.rate)}/km` : '—', has && l100(m) != null ? l100(m).toFixed(1) : '—',
          has ? L.fmtAUD(m.fuelOnly) : '—', has ? n0(m.litres) : '—', has ? fmtUse(m.use) : '—', has ? `${m.span}` : '—', status(m)]
        : [m.v.id, m.state === 'ready' ? `${fmtRate(m.rate)}/${unit}` : '—', has ? L.fmtAUD(m.spend) : '—', has ? L.fmtAUD(m.fuel) : '—',
          has ? L.fmtAUD(m.toll) : '—', has ? L.fmtAUD(m.planned) : '—', has ? L.fmtAUD(m.unplanned) : '—', has ? fmtUse(m.use) : '—', has ? `${m.span}` : '—', status(m)];
    });
    const tableHead = fuelMode
      ? ['Vehicle', 'Fuel / km', 'L/100km', 'Fuel', 'Litres', 'Distance', 'Days', 'Status']
      : ['Vehicle', `Cost / ${unit}`, 'Spend', 'Fuel', 'Tolls', 'Servicing', 'Repairs', perHr ? 'Engine hours' : 'Distance', 'Days', 'Status'];

    return `<section class="section">
      ${head(meta)}
      <figure class="viz-card">
        ${caption}
        ${kpis}
        ${rankedRows.length ? `<div class="cs-rows">${topRows(rankedRows)}</div>${legend}` : ''}
        ${collectRows.length ? `<div class="cs-subhead">${ready.length ? 'Still collecting' : 'Collecting data'} <span class="muted">(${collecting.length} · ranked at ${READY} days)</span></div>
        <div class="cs-rows">${collectRows.join('')}</div>` : ''}
        ${cantRows.length ? `<div class="cs-subhead">Can’t measure yet <span class="muted">(${cant.length})</span></div>
        <div class="cs-rows">${cantRows.join('')}</div>` : ''}
        ${tollNote ? `<p class="cs-more">${tollNote}</p>` : ''}
        ${V.table(tableHead, tableRows)}
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
  /**
   * Tolls, from imported Linkt statements: the detail behind the pink tolls
   * band in Spend over time and the Toll share card. Weekly / monthly / yearly figures are
   * the imported statements' daily average (total ÷ the days the statements
   * cover) scaled up, so they're a run rate, not a calendar total. Each line is
   * attributed to a vehicle from the CURRENT register (plate, or the vehicle's
   * Linkt tag number), so linking a tag here re-attributes its past trips.
   */
  function tolls(actions = '') {
    const wrap = (meta, body) => `<section class="section" id="cs-tolls">
      ${sectionHead({ title: 'Fuel & tolls', meta, actions })}
      <figure class="viz-card">${body}</figure>
    </section>`;
    const state = AD.store.tollsState ? AD.store.tollsState() : 'missing';
    if (state === 'idle' || state === 'loading') {
      if (state === 'idle') waitForTolls();
      return wrap('Linkt toll charges', `<p class="empty" data-toll-progress>${tollProgressText()}</p>`);
    }
    if (state === 'missing') {
      return wrap('Linkt toll charges', '<p class="empty">Toll tracking isn’t set up yet. Run <b>create-toll-entries.sql</b> in Supabase, then import a Linkt detailed statement with <b>Import cost data</b>.</p>');
    }
    const rows = AD.store.all('toll_entries');
    if (!rows.length) {
      return wrap('Linkt toll charges', '<p class="empty">No Linkt statements imported yet. Use <b>Import cost data</b> at the top of the page and drop in a Linkt detailed statement PDF.</p>');
    }

    const num = (n) => Number(n) || 0;
    const aud2 = (n) => num(n).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
    const fmtShort = (k) => T.fmtKey(k);

    // Coverage: the statement periods themselves (charges can be dated a little
    // before a period when Linkt posts them late, so the line dates overstate it).
    const stmts = new Map();
    rows.forEach((r) => {
      const k = r.statement || 'none';
      if (!stmts.has(k)) stmts.set(k, { start: r.periodStart || r.date, end: r.periodEnd || r.date });
      const s = stmts.get(k);
      if (!r.periodStart) { if (r.date < s.start) s.start = r.date; if (r.date > s.end) s.end = r.date; }
    });
    const periods = [...stmts.values()];
    const coverDays = periods.reduce((t, p) => t + T.daysBetween(p.start, p.end) + 1, 0) || 1;
    const from = periods.reduce((m, p) => (p.start < m ? p.start : m), periods[0].start);
    const to = periods.reduce((m, p) => (p.end > m ? p.end : m), periods[0].end);

    const total = rows.reduce((t, r) => t + num(r.amount), 0);
    const perDay = total / coverDays;
    const fees = rows.filter((r) => r.kind === 'fee');
    const feeTotal = fees.reduce((t, r) => t + num(r.amount), 0);

    // Attribute every line to a vehicle (cached per tag / plate).
    const match = AD.linkt.matcher(AD.store.all('vehicles'));
    const cache = new Map();
    const owner = (r) => {
      const key = r.tag ? 't' + r.tag : r.plate ? 'p' + r.plate : '';
      if (!key) return { vehicle: null, ambiguous: [] };
      if (!cache.has(key)) cache.set(key, match(r));
      const m = cache.get(key);
      if (!m.vehicle && !m.ambiguous.length && r.vehicleId) return { vehicle: AD.store.get('vehicles', r.vehicleId), ambiguous: [] };
      return m;
    };
    const byVeh = new Map(), loose = new Map(), roads = new Map();
    let credits = 0;
    rows.forEach((r) => {
      const a = num(r.amount);
      if (r.kind === 'trip' && r.road) roads.set(r.road, (roads.get(r.road) || 0) + a);
      if (r.kind === 'adjustment') { credits += a; return; }
      const m = owner(r);
      if (m.vehicle) {
        const g = byVeh.get(m.vehicle.id) || { v: m.vehicle, total: 0, trips: 0, fees: 0, feeAmt: 0, roads: new Map() };
        g.total += a;
        if (r.kind === 'fee') { g.fees++; g.feeAmt += a; } else { g.trips++; if (r.road) g.roads.set(r.road, (g.roads.get(r.road) || 0) + a); }
        byVeh.set(m.vehicle.id, g);
      } else {
        const key = r.tag ? 'tag:' + AD.linkt.tagKey(r.tag) : 'plate:' + r.plate;
        const g = loose.get(key) || { key, tag: r.tag || '', plate: r.plate || '', total: 0, count: 0, fees: 0, owners: m.ambiguous };
        g.total += a; g.count++; if (r.kind === 'fee') g.fees++;
        loose.set(key, g);
      }
    });

    const vehicles = [...byVeh.values()].sort((a, b) => b.total - a.total);
    const looseList = [...loose.values()].sort((a, b) => b.total - a.total);
    const top = Math.max(...vehicles.map((g) => g.total), ...looseList.map((g) => g.total), 0.01);

    const kpi = (label, value, sub) => `<div class="cost-kpi"><span>${esc(label)}</span><strong>${value}</strong><small>${sub}</small></div>`;
    const kpis = `<div class="cost-kpis cs-fuelkm-kpis">
        ${kpi('Per week', L.fmtAUD(perDay * 7), 'average over the imported statements')}
        ${kpi('Per month', L.fmtAUD(perDay * 365 / 12), `${L.fmtAUD(perDay)} a day`)}
        ${kpi('Yearly forecast', L.fmtAUD(perDay * 365), 'at the current run rate · incl. GST')}
        ${kpi('No Tag fees', L.fmtAUD(feeTotal), `${fees.length.toLocaleString('en-AU')} charges · avoidable with a working tag`)}
      </div>`;

    const idCell = (v) => {
      const art = (AD.art && AD.art.forVehicle(v, 44)) || '';
      return `<span class="id">${art ? `<span class="cs-veh-art">${art}</span>` : ''}<span class="cs-id-text">${esc(v.id)}${v.rego ? `<small class="cs-rego">${esc(v.rego)}</small>` : ''}</span></span>`;
    };
    const topRoad = (g) => { const e = [...g.roads.entries()].sort((a, b) => b[1] - a[1])[0]; return e ? e[0] : ''; };
    const vehRows = vehicles.map((g, i) => `<a class="cs-row cs-row-art cs-fuelkm-row" href="${vehHref(g.v.id)}" style="--i:${i}" ${V.tipAttr(g.v.id, [
        ['Tolls', aud2(g.total), COLOR_TOLL],
        ['Trips', g.trips.toLocaleString('en-AU'), 'var(--muted)'],
        ...(g.fees ? [['No Tag fees', `${g.fees} · ${aud2(g.feeAmt)}`, 'var(--amber)']] : []),
        ...(topRoad(g) ? [['Most used', topRoad(g), 'var(--muted)']] : []),
        ['Per week (avg)', aud2((g.total / coverDays) * 7), 'var(--muted)']
      ])}>
        ${idCell(g.v)}
        <span class="cs-hbar"><i class="cs-toll" style="width:${(g.total / top) * 100}%"></i></span>
        <span class="cs-row-val">${L.fmtAUD(g.total)}<span class="cs-row-sub">${L.fmtAUD((g.total / coverDays) * 7)}/wk</span></span>
        <span class="cs-row-meta">${L.driverName(g.v.driverId) ? `<span class="cs-driver">${esc(L.driverName(g.v.driverId))}</span> · ` : ''}${g.fees ? `<span class="cs-chip cs-chip-amber">${g.fees} No Tag fee${g.fees === 1 ? '' : 's'}</span>` : ''}${g.trips.toLocaleString('en-AU')} trips${topRoad(g) ? ` · mostly ${esc(topRoad(g))}` : ''}</span>
      </a>`);

    // Lines that don't belong to a fleet vehicle yet. Tags can be linked here.
    const vehOptions = AD.store.all('vehicles').filter((v) => !v.hired).sort((a, b) => a.id.localeCompare(b.id))
      .map((v) => `<option value="${esc(v.id)}">${esc(v.id)}${v.rego ? ' · ' + esc(v.rego) : ''}</option>`).join('');
    const looseRow = (g, i) => `<div class="cs-row cs-row-art cs-row-muted cs-toll-loose" style="--i:${vehicles.length + i}">
        <span class="id"><span class="cs-id-text">${g.tag ? `Tag ${esc(g.tag)}` : `Plate ${esc(g.plate)}`}<small class="cs-rego">${g.owners.length ? `on ${esc(g.owners.join(' and '))}` : 'not in the fleet register'}</small></span></span>
        <span class="cs-hbar"><i class="cs-toll" style="width:${(g.total / top) * 100}%"></i></span>
        <span class="cs-row-val">${L.fmtAUD(g.total)}</span>
        <span class="cs-row-meta">${g.count.toLocaleString('en-AU')} line${g.count === 1 ? '' : 's'}${g.fees ? ` · ${g.fees} No Tag fee${g.fees === 1 ? '' : 's'}` : ''}
          ${g.tag && !g.owners.length ? ` · <label class="cs-toll-assign">Link to <select data-toll-assign="${esc(g.tag)}"><option value="">choose a vehicle…</option>${vehOptions}</select></label>` : ''}
          ${g.owners.length ? ' · this tag is recorded on more than one vehicle; fix it in the Fleet register' : ''}</span>
      </div>`;
    const LOOSE_SHOW = 8;
    const looseRows = looseList.slice(0, LOOSE_SHOW).map(looseRow).join('')
      + (looseList.length > LOOSE_SHOW ? `<details class="cs-toll-more"><summary>Show ${looseList.length - LOOSE_SHOW} more</summary>${looseList.slice(LOOSE_SHOW).map((g, i) => looseRow(g, i + LOOSE_SHOW)).join('')}</details>` : '');

    // Toll roads.
    const roadList = [...roads.entries()].sort((a, b) => b[1] - a[1]);
    const roadTop = Math.max(...roadList.map(([, a]) => a), 0.01);
    const roadRows = roadList.slice(0, 8).map(([name, a]) => `<div class="hb-row cs-toll-road">
        <span class="hb-label">${esc(name)}</span>
        <span class="cs-hbar"><i class="cs-toll" style="width:${(a / roadTop) * 100}%"></i></span>
        <span class="hb-val">${L.fmtAUD(a)}</span>
      </div>`).join('');

    const tableRows = vehicles.map((g) => [g.v.id, g.v.rego || '', L.driverName(g.v.driverId) || '—', g.trips.toLocaleString('en-AU'), String(g.fees), aud2(g.total), aud2((g.total / coverDays) * 7)])
      .concat(looseList.map((g) => [g.tag ? `Tag ${g.tag}` : `Plate ${g.plate}`, '', '—', String(g.count - g.fees), String(g.fees), aud2(g.total), aud2((g.total / coverDays) * 7)]));

    const body = `
      <figcaption><span class="viz-sub">Linkt toll trips and fees by vehicle. Included in total spend and Spend over time above (pink). Weekly, monthly and yearly figures are the daily average of the imported statements; amounts include GST.</span></figcaption>
      ${kpis}
      <div class="cs-rows">${topRows(vehRows)}</div>
      ${looseList.length ? `<div class="cs-subhead">Not linked to a fleet vehicle <span class="muted">(${looseList.length} · ${L.fmtAUD(looseList.reduce((t, g) => t + g.total, 0))})</span></div>
        <div class="cs-rows">${looseRows}</div>
        <p class="cs-more">Linking a tag saves it on that vehicle in the Fleet register, and all of the tag’s past trips move across.</p>` : ''}
      ${roadList.length ? `<div class="cs-subhead">By toll road</div><div class="hb cs-toll-roads">${roadRows}</div>` : ''}
      ${credits ? `<p class="cs-more">Account credits (e.g. the M8/M5 East truck rebate): ${aud2(credits)}, included in the totals above but not in any one vehicle.</p>` : ''}
      ${V.table(['Vehicle', 'Rego', 'Assigned driver', 'Trips', 'No Tag fees', 'Tolls', 'Per week'], tableRows)}`;

    return wrap(`Linkt · ${stmts.size} statement${stmts.size === 1 ? '' : 's'} · ${fmtShort(from)}–${fmtShort(to)} (${coverDays} days) · ${aud2(total)}`, body);
  }

  /** "Link to vehicle" on an unlinked Linkt tag: add the tag to that vehicle's Linkt tag field. */
  function bindTollAssign(el) {
    el.querySelectorAll('[data-toll-assign]').forEach((sel) => sel.addEventListener('change', async () => {
      const tag = sel.dataset.tollAssign, vid = sel.value;
      const v = vid && AD.store.get('vehicles', vid);
      if (!v) return;
      const existing = String(v.linktTag || '').trim();
      const next = existing ? `${existing}, ${tag}` : tag;
      sel.disabled = true;
      try {
        await AD.store.update('vehicles', v.id, { linktTag: next });
        await AD.store.log(`Linkt tag ${tag} linked to ${v.id}`, v.id);
        AD.ui.toast(`Tag ${tag} linked to ${v.id}. Its trips now count against ${v.id}.`, 'ok');
        draw();
      } catch (e) {
        sel.disabled = false;
        AD.ui.toast('Could not link the tag: ' + ((e && e.message) || e), 'error');
      }
    }));
  }

  /**
   * Fuel-card spend not tied to a vehicle: cards issued to a person (no rego
   * on the statement) and regos not in the fleet register. Counted in total
   * spend and Spend over time so the totals match the card statement, but in
   * no vehicle's figures. Shown here so the gap between the vehicle list and
   * the total is explained, not hidden.
   */
  function unassignedFuelNote() {
    const rows = (AD.store.all('fuel_entries') || []).filter((r) => !r.vehicleId && Number(r.cost) > 0);
    if (!rows.length) return '';
    const cost = rows.reduce((t, r) => t + Number(r.cost || 0), 0);
    const fills = rows.filter(L.isFuelPurchase);
    const litres = fills.reduce((t, r) => t + Number(r.litres || 0), 0);   // fuel litres, not AdBlue
    const cards = new Set(rows.map((r) => r.cardHolder || r.rego || '?')).size;
    return `<div class="cs-subhead">Unassigned <span class="muted">(${cards} card${cards === 1 ? '' : 's'} · ${L.fmtAUD(cost)})</span></div>
      <div class="cs-row cs-row-art cs-row-muted">
        <span class="id"><span class="cs-id-text">Not tied to a vehicle<small class="cs-rego">person cards / regos not in the fleet</small></span></span>
        <span></span>
        <span class="cs-row-val">${Math.round(litres).toLocaleString('en-AU')}<small> L</small></span>
        <span class="cs-row-meta">${L.fmtAUD(cost)} · ${fills.length} fill${fills.length === 1 ? '' : 's'} of ${rows.length} transaction${rows.length === 1 ? '' : 's'} · counted in total spend and Spend over time, not in any vehicle’s figures</span>
      </div>`;
  }

  /**
   * Fuel purchased, Tolls and Both (Top spending vehicles) share one section,
   * switched by the buttons in its heading, instead of three long sections one
   * after another. The choice is kept in the URL (?fv=tolls / ?fv=both).
   */
  function fuelAndTolls() {
    const opt = (key, label) => `<button type="button" data-fuelview="${key}" class="${fuelView === key ? 'on' : ''}">${label}</button>`;
    const sw = `<div class="seg" role="group" aria-label="Show">${opt('fuel', 'Fuel')}${opt('tolls', 'Tolls')}${opt('both', 'Both')}</div>`;
    return fuelView === 'tolls' ? tolls(sw) : fuelView === 'both' ? topSpendingWide(sw) : fuelLitreage(sw);
  }

  function fuelLitreage(actions = '') {
    const l0 = (n) => Math.round(n).toLocaleString('en-AU');
    const lines = AD.store.all('vehicles').filter((v) => !v.hired).map((v) => {
      const f = L.fuelFor(v); // no window → all-time
      if (!f || !(f.litres > 0)) return null;
      return { v, litres: f.litres, cost: f.fuelCost, other: f.otherCost, fills: f.fills, cpl: f.litres > 0 ? f.fuelCost / f.litres : null, lastDate: f.lastFill };
    }).filter(Boolean).sort((a, b) => b.litres - a.litres);

    if (!lines.length) {
      return `<section class="section">
        ${sectionHead({ title: 'Fuel & tolls', meta: 'Fuel purchased · all imported fuel-card data', actions })}
        <figure class="viz-card"><p class="empty">No fuel-card data imported yet. Use “Import cost data” at the top of the page to load a WEX or BP export.</p></figure>
      </section>`;
    }

    const top = Math.max(...lines.map((l) => l.litres), 1);
    const totalLitres = lines.reduce((n, l) => n + l.litres, 0);
    const totalCost = lines.reduce((n, l) => n + l.cost, 0);

    const rows = lines.map((l, i) => {
      const art = (AD.art && AD.art.forVehicle(l.v, 44)) || '';
      return `<a class="cs-row cs-row-art" href="${vehHref(l.v.id)}" style="--i:${i}" ${V.tipAttr(l.v.id, [
      ['Litres purchased', l0(l.litres) + ' L', COLOR_FUEL],
      ['Fuel cost', L.fmtAUD(l.cost), 'var(--cs-amber)'],
      ...(l.other > 0.005 ? [['Fees, AdBlue & other', L.fmtAUD(l.other), 'var(--muted)']] : []),
      ['Fills', String(l.fills), 'var(--muted)'],
      ...(l.cpl != null ? [['Average price', '$' + l.cpl.toFixed(2) + '/L', 'var(--muted)']] : []),
      ...(l.lastDate ? [['Last fill', T.fmtKey(l.lastDate), 'var(--muted)']] : [])
    ])}>
      <span class="id">${art ? `<span class="cs-veh-art">${art}</span>` : ''}<span class="cs-id-text">${esc(l.v.id)}${l.v.rego ? `<small class="cs-rego">${esc(l.v.rego)}</small>` : ''}</span></span>
      <span class="cs-hbar"><i class="cs-fuel" style="width:${(l.litres / top) * 100}%"></i></span>
      <span class="cs-row-val">${l0(l.litres)}<small> L</small></span>
      <span class="cs-row-meta">${L.driverName(l.v.driverId) ? `<span class="cs-driver">${esc(L.driverName(l.v.driverId))}</span> · ` : ''}${L.fmtAUD(l.cost)} fuel · ${l.fills} fill${l.fills === 1 ? '' : 's'}${l.cpl != null ? ` · $${l.cpl.toFixed(2)}/L avg` : ''}${l.other > 0.005 ? ` · +${L.fmtAUD(l.other)} fees, AdBlue &amp; other` : ''}</span>
    </a>`;
    });

    const tableRows = lines.map((l) => [l.v.id, l.v.rego || '—', L.driverName(l.v.driverId) || '—',
      l0(l.litres) + ' L', L.fmtAUD(l.cost), String(l.fills),
      l.cpl != null ? '$' + l.cpl.toFixed(2) : '—', L.fmtAUD(l.other || 0), l.lastDate ? T.fmtKey(l.lastDate) : '—']);
    const totalOther = lines.reduce((n, l) => n + (l.other || 0), 0);
    const totalFills = lines.reduce((n, l) => n + l.fills, 0);

    return `<section class="section">
      ${sectionHead({ title: 'Fuel & tolls', actions, meta: `Fuel purchased · ${lines.length} vehicle${lines.length === 1 ? '' : 's'} · ${l0(totalLitres)} L · ${totalFills.toLocaleString('en-AU')} fills · ${L.fmtAUD(totalCost)} fuel · all imported fuel-card data` })}
      <figure class="viz-card">
        <figcaption><span class="viz-sub">Diesel and petrol purchases only, most litres first: fills, litres and fuel cost leave out card fees, AdBlue and other items (${L.fmtAUD(totalOther)}, shown per vehicle), which still count in total spend. Hover any row for the detail. Covers all imported transactions, not just the period selected above.</span></figcaption>
        <div class="cs-rows">${topRows(rows)}</div>
        ${unassignedFuelNote()}
        ${V.table(['Vehicle', 'Rego', 'Assigned driver', 'Litres', 'Fuel cost', 'Fills', 'Avg /L', 'Fees & other', 'Last fill'], tableRows)}
      </figure>
    </section>`;
  }

  return { title: 'Cost sheet', render, refresh: () => root && draw() };
})();
