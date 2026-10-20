/* Cost sheet — what the fleet cost this week, measured against its average week. */
AD.views = AD.views || {};

AD.views['cost-sheet'] = (function () {
  const { esc, pageHeader, sectionHead } = AD.ui;
  const L = AD.logic, T = AD.time, I = AD.icons;
  const AVG_WEEKS = 4; // same trailing window the dashboard uses for its utilisation trend
  let root = null, start = '';

  const mondayOf = (key) => T.addDays(key, -T.dayOfWeek(key));

  /**
   * Everything the fleet was charged for in the week beginning `from`: a
   * service on the day it was recorded, a defect on the day it was resolved,
   * which is when the repair bill actually lands.
   */
  function rowsFor(from) {
    const to = T.addDays(from, 6);
    const inWeek = (key) => !!key && key >= from && key <= to;
    const services = AD.store.all('services').filter((s) => inWeek(s.date))
      .map((s) => ({ vehicleId: s.vehicleId, date: s.date, cost: Number(s.cost || 0), kind: 'Service' }));
    const defects = AD.store.all('defects').filter((d) => d.status === 'Resolved' && inWeek(d.resolvedDate))
      .map((d) => ({ vehicleId: d.vehicleId, date: d.resolvedDate, cost: Number(d.cost || 0), kind: 'Defect' }));
    return services.concat(defects);
  }

  const sum = (rows) => rows.reduce((n, r) => n + r.cost, 0);
  const avgOf = (nums) => nums.reduce((a, b) => a + b, 0) / (nums.length || 1);

  /** The AVG_WEEKS weeks immediately before `before` — the baseline "an average week" is measured against. */
  function baseline(before) {
    return Array.from({ length: AVG_WEEKS }, (_, i) => {
      const from = T.addDays(before, -7 * (i + 1));
      return { from, rows: rowsFor(from) };
    });
  }

  /** Change line under a figure, against the AVG_WEEKS average. `toned` marks a rise as worse — only money is judged. */
  function delta(now, avg, haveBaseline, fmt, toned) {
    if (!haveBaseline) return `<small class="cs-delta">${now ? `No weeks before this one yet` : 'Nothing recorded'}</small>`;
    if (!avg) return `<small class="cs-delta">${now ? `Nothing in the ${AVG_WEEKS}-week average` : 'Nothing either way'}</small>`;
    const pct = Math.round(((now - avg) / avg) * 100);
    const arrow = pct > 0 ? '↑' : pct < 0 ? '↓' : '—';
    const tone = !toned || pct === 0 ? 'flat' : pct > 0 ? 'worse' : 'better';
    return `<small class="cs-delta cs-delta-${tone}">${arrow} ${Math.abs(pct)}% · ${fmt(avg)} avg</small>`;
  }

  const kpi = (label, value, foot) => `<div class="cs-kpi"><span>${esc(label)}</span><strong>${value}</strong>${foot}</div>`;
  const fmtChange = (n) => Math.abs(n) < 0.005 ? '—' : (n > 0 ? '+' : '−') + L.fmtAUD(Math.abs(n));
  const changeTone = (n) => n > 0.005 ? 'cs-delta-worse' : n < -0.005 ? 'cs-delta-better' : '';

  function render(el, params) {
    root = el;
    start = /^\d{4}-\d{2}-\d{2}$/.test(params.week || '') ? mondayOf(params.week) : mondayOf(T.todayKey());
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
        ${kpi('Total spend', L.fmtAUD(spend), delta(spend, avgSpend, haveBaseline, L.fmtAUD, true))}
        ${kpi('Jobs recorded', String(jobs), delta(jobs, avgJobs, haveBaseline, (n) => n.toFixed(1), false))}
        ${kpi('Average per job', L.fmtAUD(perJob), delta(perJob, avgPerJob, haveBaseline, L.fmtAUD, true))}
        ${kpi('Vehicles with costs', `${vehicleCount}`, `<small class="cs-delta">of ${fleet} in the fleet · ${haveBaseline ? avgVehicleCount.toFixed(1) + ' avg' : 'no prior weeks'}</small>`)}
      </div>

      <section class="section">
        ${sectionHead({ title: 'Day by day', meta: `This week against the ${AVG_WEEKS}-week average` })}
        <div class="hb cs-days">${days(now, base)}</div>
      </section>

      <section class="section">
        ${sectionHead({ title: 'By vehicle', meta: 'Biggest increases first' })}
        ${sheet(now, base)}
      </section>

      <p class="section-foot muted small">Spend is recorded services plus resolved defects, counted on the day the service was recorded or the defect was resolved. The average is the ${AVG_WEEKS} weeks before this one.</p>`;

    el.querySelector('#w-prev').onclick = () => go(T.addDays(start, -7));
    el.querySelector('#w-next').onclick = () => go(T.addDays(start, 7));
    el.querySelector('#w-this').onclick = () => go(thisWeek);
    el.querySelectorAll('tr[data-veh]').forEach((tr) => tr.addEventListener('click', () => AD.go('vehicle/' + tr.dataset.veh)));
  }

  function go(week) {
    start = week;
    AD.setParams({ week: start === mondayOf(T.todayKey()) ? '' : start });
    draw();
  }

  /** One row per weekday, this week's bar above the average for that weekday over the baseline weeks. */
  function days(now, base) {
    const byDay = (rows, from) => Array.from({ length: 7 }, (_, i) => sum(rows.filter((r) => r.date === T.addDays(from, i))));
    const a = byDay(now, start);
    const perWeek = base.map((w) => byDay(w.rows, w.from));
    const b = Array.from({ length: 7 }, (_, i) => avgOf(perWeek.map((week) => week[i])));
    const top = Math.max(...a, ...b, 1);
    return a.map((v, i) => `
      <div class="hb-row">
        <span class="hb-label">${T.DOW[i]}</span>
        <span class="hb-track cs-track">
          <i style="width:${(v / top) * 100}%;background:var(--viz-confirmed)" title="This week: ${L.fmtAUD(v)}"></i>
          <i style="width:${(b[i] / top) * 100}%;background:var(--viz-free-key)" title="${AVG_WEEKS}-week average: ${L.fmtAUD(b[i])}"></i>
        </span>
        <span class="hb-val">${v ? L.fmtAUD(v) : '—'}</span>
      </div>`).join('');
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

    return `<div class="table-wrap"><table class="data">
      <thead><tr><th>Vehicle</th><th class="num">Jobs</th><th class="num">This week</th><th class="num">Weekly average</th><th class="num">Change</th></tr></thead>
      <tbody>${lines.map((r) => `<tr class="row-link" data-veh="${esc(r.id)}" title="Open ${esc(r.id)}">
        <td><span class="id">${esc(r.id)}</span></td>
        <td class="num">${r.jobs || '—'}</td>
        <td class="num">${r.a ? L.fmtAUD(r.a) : '—'}</td>
        <td class="num">${r.b >= 0.005 ? L.fmtAUD(r.b) : '—'}</td>
        <td class="num cs-change ${changeTone(r.change)}">${fmtChange(r.change)}</td>
      </tr>`).join('')}</tbody>
      <tfoot><tr><th>Fleet total</th><th class="num">${totals.jobs}</th><th class="num">${L.fmtAUD(totals.a)}</th><th class="num">${L.fmtAUD(totals.b)}</th>
        <th class="num cs-change ${changeTone(totals.a - totals.b)}">${fmtChange(totals.a - totals.b)}</th></tr></tfoot>
    </table></div>`;
  }

  return { title: 'Cost sheet', render, refresh: () => root && draw() };
})();
