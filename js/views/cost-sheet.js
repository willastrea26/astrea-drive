/* Cost sheet — what the fleet cost this week, measured against last week. */
AD.views = AD.views || {};

AD.views['cost-sheet'] = (function () {
  const { esc, pageHeader, sectionHead } = AD.ui;
  const L = AD.logic, T = AD.time, I = AD.icons;
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

  /** Change line under a figure. `toned` marks a rise as worse — only money is judged. */
  function delta(now, prev, fmt, toned) {
    if (!prev) return `<small class="cs-delta">${now ? 'Nothing last week' : 'Nothing either week'}</small>`;
    const pct = Math.round(((now - prev) / prev) * 100);
    const arrow = pct > 0 ? '↑' : pct < 0 ? '↓' : '—';
    const tone = !toned || pct === 0 ? 'flat' : pct > 0 ? 'worse' : 'better';
    return `<small class="cs-delta cs-delta-${tone}">${arrow} ${Math.abs(pct)}% · ${fmt(prev)} last week</small>`;
  }

  const kpi = (label, value, foot) => `<div class="cs-kpi"><span>${esc(label)}</span><strong>${value}</strong>${foot}</div>`;

  function render(el, params) {
    root = el;
    start = /^\d{4}-\d{2}-\d{2}$/.test(params.week || '') ? mondayOf(params.week) : mondayOf(T.todayKey());
    draw();
  }

  function draw() {
    const el = root;
    const thisWeek = mondayOf(T.todayKey());
    const end = T.addDays(start, 6);
    const now = rowsFor(start), prev = rowsFor(T.addDays(start, -7));
    const spend = sum(now), prevSpend = sum(prev);
    const avg = now.length ? spend / now.length : 0;
    const prevAvg = prev.length ? prevSpend / prev.length : 0;
    const fleet = AD.store.all('vehicles').length;
    const vehicles = new Set(now.map((r) => r.vehicleId));
    const prevVehicles = new Set(prev.map((r) => r.vehicleId));

    el.innerHTML = `
      ${pageHeader({
        title: 'Cost sheet',
        sub: `${T.fmtKey(start)} – ${T.fmtKey(end)}${start === thisWeek ? ' · this week' : ''} · against the week before`,
        actions: `<div class="seg" role="group" aria-label="Week">
            <button type="button" id="w-prev" aria-label="Previous week">${I.chevL}</button>
            <button type="button" id="w-this"${start === thisWeek ? ' class="on"' : ''}>This week</button>
            <button type="button" id="w-next" aria-label="Next week">${I.chevR}</button>
          </div>`
      })}

      <div class="cs-kpis" role="group" aria-label="Week on week summary">
        ${kpi('Total spend', L.fmtAUD(spend), delta(spend, prevSpend, L.fmtAUD, true))}
        ${kpi('Jobs recorded', String(now.length), delta(now.length, prev.length, String, false))}
        ${kpi('Average per job', L.fmtAUD(avg), delta(avg, prevAvg, L.fmtAUD, true))}
        ${kpi('Vehicles with costs', `${vehicles.size}`, `<small class="cs-delta">of ${fleet} in the fleet · ${prevVehicles.size} last week</small>`)}
      </div>

      <section class="section">
        ${sectionHead({ title: 'Day by day', meta: 'This week against last' })}
        <div class="hb cs-days">${days(now, prev)}</div>
      </section>

      <section class="section">
        ${sectionHead({ title: 'By vehicle', meta: 'Biggest increases first' })}
        ${sheet(now, prev)}
      </section>

      <p class="section-foot muted small">Spend is recorded services plus resolved defects, counted on the day the service was recorded or the defect was resolved.</p>`;

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

  /** One row per weekday, this week's bar above last week's on a shared scale. */
  function days(now, prev) {
    const byDay = (rows, from) => Array.from({ length: 7 }, (_, i) => sum(rows.filter((r) => r.date === T.addDays(from, i))));
    const a = byDay(now, start), b = byDay(prev, T.addDays(start, -7));
    const top = Math.max(...a, ...b, 1);
    return a.map((v, i) => `
      <div class="hb-row">
        <span class="hb-label">${T.DOW[i]}</span>
        <span class="hb-track cs-track">
          <i style="width:${(v / top) * 100}%;background:var(--viz-confirmed)" title="This week: ${L.fmtAUD(v)}"></i>
          <i style="width:${(b[i] / top) * 100}%;background:var(--viz-free-key)" title="Last week: ${L.fmtAUD(b[i])}"></i>
        </span>
        <span class="hb-val">${v ? L.fmtAUD(v) : '—'}</span>
      </div>`).join('');
  }

  /** The sheet itself: a line per vehicle that cost something in either week. */
  function sheet(now, prev) {
    const ids = [...new Set(now.concat(prev).map((r) => r.vehicleId))];
    if (!ids.length) return '<p class="empty">Nothing recorded in either week.</p>';
    const lines = ids.map((id) => {
      const mine = now.filter((r) => r.vehicleId === id), theirs = prev.filter((r) => r.vehicleId === id);
      const a = sum(mine), b = sum(theirs);
      return { id, a, b, change: a - b, jobs: mine.length };
    }).sort((x, y) => y.change - x.change);
    const totals = lines.reduce((t, r) => ({ a: t.a + r.a, b: t.b + r.b, jobs: t.jobs + r.jobs }), { a: 0, b: 0, jobs: 0 });

    return `<div class="table-wrap"><table class="data">
      <thead><tr><th>Vehicle</th><th class="num">Jobs</th><th class="num">This week</th><th class="num">Last week</th><th class="num">Change</th></tr></thead>
      <tbody>${lines.map((r) => `<tr class="row-link" data-veh="${esc(r.id)}" title="Open ${esc(r.id)}">
        <td><span class="id">${esc(r.id)}</span></td>
        <td class="num">${r.jobs || '—'}</td>
        <td class="num">${r.a ? L.fmtAUD(r.a) : '—'}</td>
        <td class="num">${r.b ? L.fmtAUD(r.b) : '—'}</td>
        <td class="num cs-change ${r.change > 0 ? 'cs-delta-worse' : r.change < 0 ? 'cs-delta-better' : ''}">${r.change ? (r.change > 0 ? '+' : '−') + L.fmtAUD(Math.abs(r.change)) : '—'}</td>
      </tr>`).join('')}</tbody>
      <tfoot><tr><th>Fleet total</th><th class="num">${totals.jobs}</th><th class="num">${L.fmtAUD(totals.a)}</th><th class="num">${L.fmtAUD(totals.b)}</th>
        <th class="num cs-change ${totals.a > totals.b ? 'cs-delta-worse' : totals.a < totals.b ? 'cs-delta-better' : ''}">${totals.a === totals.b ? '—' : (totals.a > totals.b ? '+' : '−') + L.fmtAUD(Math.abs(totals.a - totals.b))}</th></tr></tfoot>
    </table></div>`;
  }

  return { title: 'Cost sheet', render, refresh: () => root && draw() };
})();
