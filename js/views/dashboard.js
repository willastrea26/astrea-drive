/* Dashboard — fleet overview */
AD.views = AD.views || {};

AD.views.dashboard = (function () {
  const { esc, stateBadge, bookingBadge, scheduleBadge, pageHeader, sectionHead, dash, relTime, detailsSnapshot, detailsRestore } = AD.ui;
  const L = AD.logic, T = AD.time, I = AD.icons;
  const LIST_MAX = 5;
  const FIRST_NAME_BY_EMAIL = {
    'd.macwhinney@astrea.com.au': 'Dale',
  };
  function firstName() {
    const email = (AD.currentUserEmail || '').toLowerCase();
    return FIRST_NAME_BY_EMAIL[email] || 'Will';
  }

  /** "Telematic inputs" row text — which GPS pull this was and what it brought in. */
  function syncLabel(r) {
    if (r.source === 'cron') return r.depth === 'full' ? 'Automatic weekly resync' : 'Automatic nightly sync';
    if (r.quick) return 'Manual sync (odometers)';
    return r.depth === 'full' ? 'Manual 30-day resync' : 'Manual sync';
  }
  function syncDetail(r) {
    if (r.ok === false) return `Failed — ${r.error || 'unknown error'}`;
    const bits = [];
    if (r.updated != null && r.updated > 0) bits.push(`${r.updated} odometer${r.updated === 1 ? '' : 's'} updated`);
    if (r.dailyRecorded != null && r.dailyRecorded > 0) bits.push(`${r.dailyRecorded} daily engine-hour reading${r.dailyRecorded === 1 ? '' : 's'}`);
    if (r.tripStatsRecorded != null && r.tripStatsRecorded > 0) bits.push(`trip stats for ${r.tripStatsRecorded} vehicle${r.tripStatsRecorded === 1 ? '' : 's'}`);
    return bits.length ? bits.join(' · ') : 'Nothing new';
  }
  /** Did this sync actually record anything? Zero-everything successes are
   *  hidden from the main list so the dashboard shows only runs that moved
   *  the numbers. Failures are kept visible — they're always worth seeing. */
  function syncAdded(r) {
    if (r.ok === false) return true;
    return (Number(r.updated) || 0) > 0
      || (Number(r.dailyRecorded) || 0) > 0
      || (Number(r.tripStatsRecorded) || 0) > 0;
  }
  /** What a run pulls, in words — shown at the top of its details. */
  function syncScope(r) {
    if (r.quick) return 'Odometers only (a quick manual sync).';
    return r.depth === 'full'
      ? 'Odometers, 30-day trip statistics, and engine hours for the last 30 days.'
      : 'Odometers, 30-day trip statistics, and engine hours for the last 3 days.';
  }

  /**
   * Click a Telematic inputs run -> which vehicles it changed and how.
   * The per-vehicle breakdown lives in sync_log.details (update-sync-log-details.sql)
   * and is fetched only when asked for, so the dashboard doesn't load it for
   * every run on every page load.
   */
  function openSyncDetails(r) {
    const { modal } = AD.ui;
    const r1 = (x) => Math.round(x * 10) / 10;
    const km = (x) => Math.round(x).toLocaleString('en-AU') + ' km';
    const shortDay = (key) => { const p = String(key).split('-'); return p.length === 3 ? `${+p[2]}/${+p[1]}` : key; };
    const norm = (s) => String(s || '').trim().toUpperCase();
    const vehicles = AD.store.all('vehicles');
    const vehFor = (rego) => vehicles.find((v) => norm(v.rego) === norm(rego) || (v.netstarRego && norm(v.netstarRego) === norm(rego))) || null;

    function render(details) {
      const odo = Array.isArray(details.odometers) ? details.odometers : [];
      const days = Array.isArray(details.engineHours) ? details.engineHours : [];
      const trips = Array.isArray(details.tripStats) ? details.tripStats : [];
      // One entry per vehicle, keyed by the fleet vehicle (or the Netstar rego if unmatched).
      const by = new Map();
      const entry = (rego) => {
        const v = vehFor(rego);
        const key = v ? v.id : 'rego:' + norm(rego);
        if (!by.has(key)) by.set(key, { v, rego: norm(rego), odo: null, days: [], trip: null });
        return by.get(key);
      };
      const unmatched = [];
      odo.forEach((o) => { if (o.status === 'unmatched') unmatched.push(o.rego); else entry(o.rego).odo = o; });
      days.forEach((d) => entry(d.rego).days.push(d));
      trips.forEach((t) => { entry(t.rego).trip = t; });

      const changed = (e) => (e.odo && ['accumulated', 'baseline', 'suspect'].includes(e.odo.status)) || e.days.length > 0;
      const rows = [...by.values()].filter((e) => e.v || e.odo || e.days.length || e.trip);
      rows.sort((a, b) => (changed(b) - changed(a)) || String(a.v ? a.v.id : a.rego).localeCompare(String(b.v ? b.v.id : b.rego)));

      const odoCell = (e) => {
        const o = e.odo;
        if (!o) return r.quick || !odo.length ? '<span class="muted">—</span>' : '<span class="muted">Not in this run</span>';
        if (o.status === 'accumulated') return `<span class="flag flag-green">+${km(o.addedKm || 0)}</span><span class="t2">now ${km(o.savedKm || 0)}</span>`;
        if (o.status === 'verified') return '<span class="muted">No change</span><span class="t2">GPS-verified</span>';
        if (o.status === 'baseline') return `<span class="flag flag-muted">Starting point set</span><span class="t2">tracker at ${km(o.gpsKm || 0)}</span>`;
        if (o.status === 'suspect') return `<span class="flag flag-amber">${km(o.jumpKm || 0)} jump not added</span><span class="t2">check the tracker</span>`;
        if (o.status === 'missing') return '<span class="muted">No reading from Netstar</span>';
        return `<span class="muted">${esc(o.status || '—')}</span>`;
      };
      const hoursCell = (e) => {
        if (!e.days.length) return r.quick ? '<span class="muted">—</span>' : '<span class="muted">No new days</span>';
        const ds = e.days.slice().sort((a, b) => String(a.day).localeCompare(String(b.day)));
        const hrs = ds.reduce((s, d) => s + (Number(d.hours) || 0), 0);
        const dist = ds.reduce((s, d) => s + (Number(d.distance) || 0), 0);
        const line = (d) => `${esc(shortDay(d.day))}: ${r1(Number(d.hours) || 0)} hr${d.distance != null ? ` · ${km(d.distance)}` : ''}`;
        const head = `<b>${r1(hrs)} hr</b>${dist ? ` · ${km(dist)}` : ''}<span class="t2">${ds.length} day${ds.length === 1 ? '' : 's'} saved</span>`;
        return ds.length <= 4
          ? `${head}<span class="sync-days">${ds.map(line).join('<br>')}</span>`
          : `${head}<details class="sync-days-more"><summary>Show each day</summary><span class="sync-days">${ds.map(line).join('<br>')}</span></details>`;
      };
      const tripCell = (e) => {
        const t = e.trip;
        if (!t) return r.quick ? '<span class="muted">Not refreshed (quick sync)</span>' : '<span class="muted">—</span>';
        const bits = [t.runningKm != null ? km(t.runningKm) : '', t.trips != null ? `${t.trips} trip${t.trips === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
        const sub = [t.workingDays != null ? `${t.workingDays} working day${t.workingDays === 1 ? '' : 's'}` : '', t.idleMinutes != null ? `${r1(t.idleMinutes / 60)} hr idle` : ''].filter(Boolean).join(' · ');
        return `${bits || '<span class="muted">No trips</span>'}${sub ? `<span class="t2">${sub}</span>` : ''}`;
      };
      const vehCell = (e) => e.v
        ? `<a href="#/vehicle/${encodeURIComponent(e.v.id)}" data-close-go><b>${esc(e.v.id)}</b></a><span class="t2">${esc([e.v.rego, [e.v.make, String(e.v.model || '').split(' — ')[0]].filter(Boolean).join(' ')].filter(Boolean).join(' · '))}</span>`
        : `<b>${esc(e.rego)}</b><span class="t2">Not in the Fleet register</span>`;
      const tr = (e) => `<tr class="${changed(e) ? '' : 'sync-unchanged'}"><td>${vehCell(e)}</td><td>${odoCell(e)}</td><td>${hoursCell(e)}</td><td>${tripCell(e)}</td></tr>`;
      const head = '<thead><tr><th style="width:24%">Vehicle</th><th style="width:22%">Odometer</th><th style="width:28%">Engine hours</th><th>30-day trip stats</th></tr></thead>';
      const changedRows = rows.filter(changed), quietRows = rows.filter((e) => !changed(e));

      const addedKm = odo.filter((o) => o.status === 'accumulated').reduce((s, o) => s + (Number(o.addedKm) || 0), 0);
      const chips = [
        `${changedRows.length} vehicle${changedRows.length === 1 ? '' : 's'} updated`,
        addedKm ? `+${km(addedKm)} added to odometers` : '',
        days.length ? `${days.length} engine-hour day${days.length === 1 ? '' : 's'} saved` : '',
        trips.length ? `trip stats refreshed for ${trips.length}` : ''
      ].filter(Boolean);

      return `
        <p class="sync-scope">${esc(syncScope(r))}</p>
        <p class="sync-chips">${chips.map((c) => `<span class="sync-chip">${esc(c)}</span>`).join('')}</p>
        ${changedRows.length
          ? `<div class="table-wrap"><table class="data sync-veh-tbl">${head}<tbody>${changedRows.map(tr).join('')}</tbody></table></div>`
          : '<p class="empty">No vehicle’s odometer or engine hours changed in this run.</p>'}
        ${quietRows.length ? `<details class="sync-all sync-quiet"><summary>${quietRows.length} vehicle${quietRows.length === 1 ? '' : 's'} with no change</summary>
          <div class="table-wrap"><table class="data sync-veh-tbl">${head}<tbody>${quietRows.map(tr).join('')}</tbody></table></div></details>` : ''}
        ${unmatched.length ? `<p class="sync-unmatched">${AD.icons.alert}<span><b>Not matched to a fleet vehicle:</b> ${unmatched.map((x) => esc(x)).join(', ')}. These Netstar trackers’ regos don’t match the Fleet register or a vehicle’s Netstar alias, so they were skipped.</span></p>` : ''}`;
    }

    modal({
      title: `${syncLabel(r)} — ${T.fmtDateTime(r.ranAt)}`,
      wide: true,
      body: `<div data-sync-body>${r.ok === false
        ? `<p class="sync-scope">${esc(syncScope(r))}</p><p class="sync-unmatched is-fail">${AD.icons.alert}<span><b>This sync failed.</b> ${esc(r.error || 'No error message was recorded.')}</span></p>`
        : '<p class="empty">Loading details…</p>'}</div>
        <div class="form-actions"><button class="btn btn-ghost" data-close type="button">Close</button></div>`,
      async onMount(el, close) {
        el.querySelector('[data-close]').onclick = close;
        el.addEventListener('click', (ev) => { if (ev.target.closest('[data-close-go]')) close(); });
        if (r.ok === false) return;
        const box = el.querySelector('[data-sync-body]');
        let details = null, missingColumn = false;
        try {
          const { data, error } = await AD.sb.from('sync_log').select('details').eq('id', r.id).maybeSingle();
          if (error) missingColumn = /details|42703|column/i.test(String(error.message || error.code || ''));
          else details = data && data.details;
        } catch (e) { /* shown as "not recorded" below */ }
        if (!box.isConnected) return;
        if (details && (details.odometers || details.engineHours || details.tripStats)) { box.innerHTML = render(details); return; }
        box.innerHTML = `<p class="sync-scope">${esc(syncScope(r))}</p>
          <p class="sync-chips"><span class="sync-chip">${esc(syncDetail(r))}</span></p>
          <p class="empty">${missingColumn
            ? 'Vehicle-by-vehicle details aren’t switched on yet. Run <code>supabase/update-sync-log-details.sql</code> in the Supabase SQL Editor and redeploy the netstar function; syncs after that will show each vehicle here.'
            : 'This run didn’t record which vehicles it changed — only the totals above. Syncs after the netstar function update show each vehicle here.'}</p>`;
      }
    });
  }

  const OWNED_SCHEDULE_VAC_IDS = new Set(Array.from({ length: 8 }, (_, i) => `AVT${String(i + 1).padStart(2, '0')}`));
  let root = null, day = '', schedFilter = 'all';
  // Which insight is on screen. Held across redraws so a background refresh
  // doesn't yank the band back to the first card while it's being read.
  let insightIdx = 0, insightTimer = null;
  // Charts animate in when the page is opened, not on every in-page redraw
  // (changing the schedule tab or date would otherwise replay the whole page).
  let fresh = true;

  function greeting() {
    const hour = T.parts(Date.now()).hour;
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }

  function kpiIco(icon, tone) {
    return `<span class="kpi-ico kpi-${tone}">${icon}</span>`;
  }
  function driverCell(name) {
    if (!name) return '';
    const initials = name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
    return `<span class="driver"><span class="driver-avatar">${esc(initials)}</span>${esc(name)}</span>`;
  }
  function jobProgress(s, e, now) {
    const pct = Math.min(100, Math.max(0, ((now - s) / (e - s)) * 100));
    return `<span class="job-prog"><span class="job-prog-fill" style="width:${pct.toFixed(1)}%"></span></span>`;
  }

  /* ------------------------------------------------------------------ insights
   * Plain-language findings read off whatever the data happens to say today.
   * Every generator stays silent when it has nothing worth reporting, so the
   * band only ever carries live facts; `weight` decides what leads, and the
   * closing "all clear" lines guarantee it is never empty.
   */
  function facts({ vehicles, vac, svc, rego, defects, today }) {
    const out = [];
    const add = (weight, tone, icon, text, sub, href) => out.push({ weight, tone, icon, text, sub, href });
    const b = (x) => `<b>${x}</b>`;
    const isAre = (c) => (c === 1 ? 'is' : 'are');
    const s = (c) => (c === 1 ? '' : 's');
    const few = (ids) => ids.slice(0, 3).map(esc).join(', ') + (ids.length > 3 ? ` and ${ids.length - 3} more` : '');
    const vHref = (id) => `#/vehicle/${encodeURIComponent(id)}`;

    // ---- needs attention
    const critical = defects.filter((d) => d.priority === 'Critical');
    if (critical.length) add(100, 'critical', I.alert,
      `${b(critical.length)} critical defect${s(critical.length)} ${isAre(critical.length)} open`,
      'Raised as unsafe — clear these before the vehicle goes out',
      '#/defects?status=open&priority=Critical');

    const regoGone = rego.filter((x) => x.r.state === 'overdue');
    if (regoGone.length) add(96, 'critical', I.file,
      `${b(regoGone.length)} registration${s(regoGone.length)} ${regoGone.length === 1 ? 'has' : 'have'} expired`,
      few(regoGone.map((x) => x.v.id)), '#/fleet?flag=rego');

    const svcLate = svc.filter((x) => x.s.state === 'overdue');
    if (svcLate.length) add(92, 'critical', I.wrench,
      `${b(svcLate.length)} vehicle${s(svcLate.length)} ${isAre(svcLate.length)} overdue for a service`,
      few(svcLate.map((x) => x.v.id)), '#/maintenance?filter=due');

    const oos = vehicles.filter((v) => v.status === 'Out of service');
    if (oos.length) add(88, 'critical', I.truck,
      `${b(oos.length)} vehicle${s(oos.length)} ${isAre(oos.length)} out of service`,
      few(oos.map((v) => v.id)), '#/fleet?status=' + encodeURIComponent('Out of service'));

    // ---- coming up
    const rego30 = rego.filter((x) => x.r.state !== 'overdue' && x.r.days <= 30);
    if (rego30.length) add(74, 'warn', I.file,
      `${b(rego30.length)} registration${s(rego30.length)} expire${rego30.length === 1 ? 's' : ''} within 30 days`,
      `Soonest: ${esc(rego30[0].v.id)} on ${T.fmtKey(rego30[0].v.regoExpiry)}`, '#/fleet?flag=rego');

    // "This month" means the days that are actually left in it, not a flat 30.
    const p = T.parts(Date.now());
    const leftInMonth = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate() - p.day;
    const svcMonth = svc.filter((x) => x.s.state !== 'overdue' && x.s.daysLeft >= 0 && x.s.daysLeft <= leftInMonth);
    if (svcMonth.length) add(72, 'warn', I.wrench,
      `${b(svcMonth.length)} vehicle${s(svcMonth.length)} ${svcMonth.length === 1 ? 'needs' : 'need'} servicing this month`,
      `${leftInMonth} day${s(leftInMonth)} left in ${T.MONTHS[p.month - 1]}`, '#/maintenance?filter=due');

    // ---- idle plant: last booking finished, nothing since
    const IDLE_MIN = 10;
    const idle = vehicles.map((v) => {
      const bs = L.bookingsFor(v.id).filter((x) => x.status !== 'cancelled');
      if (!bs.length) return null;
      const last = Math.max(...bs.map((x) => Date.parse(x.end)));
      if (!Number.isFinite(last) || last > Date.now()) return null;
      return { v, days: T.daysBetween(T.dateKey(last), today) };
    }).filter((x) => x && x.days >= IDLE_MIN).sort((a, b2) => b2.days - a.days);
    if (idle.length) add(68, 'warn', I.clock,
      `${b(esc(idle[0].v.id))} has been idle for ${b(idle[0].days)} days`,
      idle.length > 1 ? `${idle.length} vehicles have had no booking for ${IDLE_MIN}+ days`
        : `No booking since ${T.fmtKey(T.addDays(today, -idle[0].days))}`,
      vHref(idle[0].v.id) + '?tab=bookings');

    // ---- money: rolling 30 days against the 30 before, so a part-finished
    // calendar month is never compared against a whole one.
    const spend = (from, to) => {
      const within = (d) => d && d >= from && d <= to;
      const serviced = AD.store.all('services').filter((x) => within(x.date)).reduce((t, x) => t + Number(x.cost || 0), 0);
      const fixed = AD.store.all('defects').filter((x) => x.status === 'Resolved' && within(x.resolvedDate)).reduce((t, x) => t + Number(x.cost || 0), 0);
      return { total: serviced + fixed, unplanned: fixed };
    };
    const cur = spend(T.addDays(today, -29), today);
    const prev = spend(T.addDays(today, -59), T.addDays(today, -30));
    if (cur.total > 0 && prev.total > 0) {
      const pct = Math.round(((cur.total - prev.total) / prev.total) * 100);
      if (Math.abs(pct) >= 5) add(64, pct > 0 ? 'warn' : 'good', I.receipt,
        `Spend is ${b((pct > 0 ? 'up ' : 'down ') + Math.abs(pct) + '%')} on the previous 30 days`,
        `${L.fmtAUD(cur.total)} in the last 30 days · ${L.fmtAUD(prev.total)} before that`, '#/cost-sheet');
    }
    if (cur.total > 0) {
      const share = Math.round((cur.unplanned / cur.total) * 100);
      if (share >= 40) add(60, 'warn', I.wrench,
        `${b(share + '%')} of the last 30 days' spend was unplanned repairs`,
        `${L.fmtAUD(cur.unplanned)} on defects against ${L.fmtAUD(cur.total)} all up`, '#/cost-sheet');
    }

    const yearFrom = T.addDays(today, -364);
    const perVehicle = new Map();
    const tally = (id, n2) => perVehicle.set(id, (perVehicle.get(id) || 0) + n2);
    AD.store.all('services').forEach((x) => { if (x.date >= yearFrom && x.date <= today) tally(x.vehicleId, Number(x.cost || 0)); });
    AD.store.all('defects').forEach((x) => { if (x.status === 'Resolved' && x.resolvedDate >= yearFrom && x.resolvedDate <= today) tally(x.vehicleId, Number(x.cost || 0)); });
    const dearest = [...perVehicle.entries()].sort((a, b2) => b2[1] - a[1])[0];
    if (dearest && dearest[1] > 0) add(46, 'info', I.receipt,
      `${b(esc(dearest[0]))} has cost the most this year — ${b(L.fmtAUD(dearest[1]))}`,
      'Services and resolved defects over the last 12 months', vHref(dearest[0]));

    // ---- what the fortnight looks like
    if (vac.length) {
      let peak = null;
      for (let i = 0; i < 14; i++) {
        const dk = T.addDays(today, i), ds = T.startOfDay(dk), de = T.startOfDay(T.addDays(dk, 1));
        const busy = vac.filter((v) => L.bookingsFor(v.id).some((x) => x.status !== 'cancelled' && Date.parse(x.start) < de && Date.parse(x.end) > ds)).length;
        if (!peak || busy > peak.busy) peak = { dk, busy, i };
      }
      if (peak && peak.busy) add(50, 'info', I.calendar,
        `${b(T.DOW[T.dayOfWeek(peak.dk)] + ' ' + T.fmtKey(peak.dk))} is the busiest day ahead — ${b(peak.busy + ' of ' + vac.length)} vac trucks booked`,
        peak.i === 0 ? 'That is today' : `In ${peak.i} day${s(peak.i)}`, `#/calendar?view=day&date=${peak.dk}`);
    }

    const inShop = vehicles.filter((v) => v.status === 'In workshop');
    if (inShop.length) add(44, 'info', I.garage,
      `${b(inShop.length)} vehicle${s(inShop.length)} ${isAre(inShop.length)} in the workshop`,
      few(inShop.map((v) => v.id)), '#/fleet?status=' + encodeURIComponent('In workshop'));

    // ---- all clear, so the band always has something to say
    if (!regoGone.length && !rego30.length) add(25, 'good', I.file,
      'Every registration is current', 'Nothing expires in the next 30 days', '#/fleet?flag=rego');
    if (!svcLate.length) add(24, 'good', I.wrench,
      'No vehicle is overdue for a service', `${svc.length} due in the period ahead`, '#/maintenance');
    if (!critical.length) add(23, 'good', I.checkCircle,
      'No critical defects are open', `${defects.length} open at lower priorities`, '#/defects?status=open');

    return out.sort((a, b2) => b2.weight - a.weight).slice(0, 8);
  }

  /** The rotating band itself. */
  function insightsBand(list) {
    if (!list.length) return '';
    const many = list.length > 1;
    const items = list.map((f, i) => `
      <a class="ib-item${i === 0 ? ' is-on' : ''}" href="${f.href}" data-tone="${f.tone}">
        <span class="ib-ico">${f.icon}</span>
        <span class="ib-copy"><span class="ib-text">${f.text}</span><span class="ib-sub">${f.sub}</span></span>
        <span class="ib-go">${I.chevR}</span>
      </a>`).join('');
    return `<section class="ib" data-tone="${list[0].tone}" aria-label="Fleet insights">
      <div class="ib-head">
        <span class="ib-eyebrow">${I.activity}Fleet insights</span>
        ${many ? `<div class="ib-nav">
          <button type="button" class="ib-arrow ib-prev" aria-label="Previous insight">${I.chevL}</button>
          <span class="ib-dots">${list.map((_, i) => `<button type="button" class="ib-dot${i === 0 ? ' on' : ''}" data-i="${i}" aria-label="Insight ${i + 1} of ${list.length}"></button>`).join('')}</span>
          <button type="button" class="ib-arrow ib-next" aria-label="Next insight">${I.chevR}</button>
        </div>` : ''}
      </div>
      <div class="ib-stage" aria-live="polite">${items}</div>
      ${many ? '<span class="ib-bar"><i></i></span>' : ''}
    </section>`;
  }

  /**
   * Rotation runs on a timeout chain rather than the progress bar's
   * animationend: browsers throttle animation clocks in backgrounded or
   * non-painting tabs, which would stall the band indefinitely. The bar is
   * decoration synced to the same dwell — if it stalls, rotation still works.
   */
  const INSIGHT_DWELL = 7000;

  function wireInsights(el) {
    stopInsights();
    const band = el.querySelector('.ib');
    if (!band) return;
    const items = [...band.querySelectorAll('.ib-item')];
    const dots = [...band.querySelectorAll('.ib-dot')];
    const bar = band.querySelector('.ib-bar i');
    if (!items.length) return;
    const auto = items.length > 1 && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

    let i = Math.min(insightIdx, items.length - 1);
    let held = false;

    const queue = () => {
      clearTimeout(insightTimer);
      if (!auto || held) return;
      insightTimer = setTimeout(() => {
        // The view may have been replaced since the timer was set.
        if (!band.isConnected) return stopInsights();
        show(i + 1);
      }, INSIGHT_DWELL);
    };
    const show = (next, restart = true) => {
      i = (next + items.length) % items.length;
      insightIdx = i;
      items.forEach((it, k) => it.classList.toggle('is-on', k === i));
      dots.forEach((d, k) => d.classList.toggle('on', k === i));
      band.dataset.tone = items[i].dataset.tone;
      // Restart the fill in step with the dwell: drop it, force a reflow, hand it back.
      if (bar && restart) { bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = ''; }
      queue();
    };

    const hold = (on) => { held = on; band.classList.toggle('is-held', on); queue(); };
    band.addEventListener('mouseenter', () => hold(true));
    band.addEventListener('mouseleave', () => hold(false));
    band.addEventListener('focusin', () => hold(true));
    band.addEventListener('focusout', () => { if (!band.contains(document.activeElement)) hold(false); });

    const prev = band.querySelector('.ib-prev'), next = band.querySelector('.ib-next');
    if (prev) prev.onclick = () => show(i - 1);
    if (next) next.onclick = () => show(i + 1);
    dots.forEach((d) => (d.onclick = () => show(Number(d.dataset.i))));
    show(i, false);
  }

  function stopInsights() { clearTimeout(insightTimer); insightTimer = null; }

  /** Multi-segment ring. Each part becomes an arc; the centre carries the headline. */
  function donutRing(parts, big, small) {
    const sz = 120, sw = 21, r = (sz - sw) / 2, c = 2 * Math.PI * r;
    const live = parts.filter(p => p.value > 0);
    const total = live.reduce((s, p) => s + p.value, 0);
    const gap = live.length > 1 ? 3 : 0;
    let acc = 0;
    const arcs = live.map(p => {
      const len = (p.value / total) * c;
      const draw = Math.max(len - gap, 1.5);
      const off = -acc;
      acc += len;
      return `<circle class="ring-arc" cx="${sz / 2}" cy="${sz / 2}" r="${r}" fill="none" stroke="${p.color}" stroke-width="${sw}"
        style="--dash:${draw.toFixed(2)}px"
        stroke-dasharray="${draw.toFixed(2)} ${(c - draw).toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}"
        transform="rotate(-90 ${sz / 2} ${sz / 2})"><title>${esc(p.label)}: ${p.value}</title></circle>`;
    }).join('');
    const desc = live.map(p => `${p.value} ${p.label}`).join(', ');
    return `<svg class="kpi-donut" viewBox="0 0 ${sz} ${sz}" role="img" aria-label="${esc(desc)}">
      <circle cx="${sz / 2}" cy="${sz / 2}" r="${r}" fill="none" stroke="var(--rule)" stroke-width="${sw}"/>
      ${arcs}
      <text class="kpi-donut-big" x="${sz / 2}" y="${sz / 2 - (small ? 7 : 0)}" text-anchor="middle" dominant-baseline="central">${big}</text>
      ${small ? `<text class="kpi-donut-small" x="${sz / 2}" y="${sz / 2 + 13}" text-anchor="middle" dominant-baseline="central">${esc(small)}</text>` : ''}
    </svg>`;
  }

  function legendGrid(parts, cls) {
    return `<div class="kpi-legend${cls ? ' ' + cls : ''}">${parts.map(p =>
      `<span class="kpi-legend-item" title="${p.value} ${esc(p.label)}"><i style="background:${p.color}"></i><b>${p.value}</b><span>${esc(p.label)}</span></span>`
    ).join('')}</div>`;
  }

  /** The year-to-date GPS totals, given a compact 14-day visual pulse. */
  function activityCard(gps, fleetSize, today) {
    const whole = (n) => Math.round(n).toLocaleString('en-AU');
    const one = (n) => (Math.round(n * 10) / 10).toLocaleString('en-AU');
    const from = gps.firstDay
      ? new Date(gps.firstDay + 'T12:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
      : '';
    const dailyRows = AD.store.all('vehicle_work_hours_daily') || [];
    const byDay = new Map();
    dailyRows.forEach((r) => {
      const day = r.day ? String(r.day).slice(0, 10) : '';
      if (day) byDay.set(day, (byDay.get(day) || 0) + (Number(r.distanceKm) || 0));
    });
    const firstPulseDay = T.addDays(today, -13);
    const dailyKm = Array.from({ length: 14 }, (_, i) => {
      const day = T.addDays(firstPulseDay, i);
      return { day, km: byDay.get(day) || 0 };
    });
    const peak = Math.max(...dailyKm.map((d) => d.km), 1);
    const bars = dailyKm.map((d) => {
      const height = d.km > 0 ? Math.max(10, (d.km / peak) * 100) : 4;
      return `<i style="height:${height.toFixed(1)}%" title="${esc(T.fmtKey(d.day))}: ${whole(d.km)} km"></i>`;
    }).join('');
    const coverage = fleetSize ? Math.round((gps.tracked / fleetSize) * 100) : 0;
    const metric = (label, value, note) => `<span class="activity-metric"><small>${esc(label)}</small><b>${value}</b>${note ? `<em>${esc(note)}</em>` : ''}</span>`;
    return `
      <button class="strip-item kpi-card-activity" data-go='${JSON.stringify(['tracker', {}])}'>
        <span class="kpi-top">${kpiIco(I.map, 'blue')}<span class="kpi-title">Fleet activity</span><span class="kpi-chev">${I.chevR}</span></span>
        <span class="activity-main">
          <span class="activity-main-copy"><strong>${whole(gps.km)}<small> km</small></strong><span>Driven this year${from ? ` · GPS from ${esc(from)}` : ''}</span></span>
          <span class="activity-pulse" aria-label="Fleet GPS distance over the last 14 days"><span class="activity-bars" aria-hidden="true">${bars}</span><small>14-day pulse</small></span>
        </span>
        <span class="activity-metrics">
          ${metric('Fuel · YTD', gps.litres ? `${whole(gps.litres)} L` : '—')}
          ${metric('Engine time · YTD', gps.hours ? `${one(gps.hours)} hrs` : '—')}
          ${metric(`Trips · ${gps.tripWindowDays}d`, gps.trips ? whole(gps.trips) : '—')}
          ${metric(`Top speed · ${gps.tripWindowDays}d`, gps.topSpeed != null ? `${whole(gps.topSpeed)} km/h` : '—', gps.topSpeedVeh)}
        </span>
        <span class="activity-coverage">
          <span><b>${gps.tracked}</b> GPS tracked <i>${fleetSize} in fleet</i></span>
          <span class="activity-coverage-track" aria-label="${coverage}% of the fleet is GPS tracked"><i style="width:${coverage}%"></i></span>
        </span>
      </button>`;
  }

  /** Seven-day strip. Empty string when there's no forecast, so the banner just closes up. */
  function wxStrip(days) {
    if (!days || !days.length) return '';
    const today = T.todayKey();
    const cells = days.slice(0, 7).map((d) => {
      const w = AD.weather.describe(d.code);
      const isToday = d.key === today;
      const dow = isToday ? 'Today' : T.DOW[T.dayOfWeek(d.key)];
      return `<li class="wx-day${isToday ? ' is-today' : ''}" aria-label="${esc(dow)}: ${esc(w.label)}, ${d.hi} degrees, low ${d.lo}">
        <span class="wx-dow">${esc(dow)}</span>
        <span class="wx-ico" title="${esc(w.label)}">${w.glyph}</span>
        <span class="wx-hi">${d.hi}°</span>
        <span class="wx-lo">${d.lo}°</span>
      </li>`;
    }).join('');
    return `<ul class="wx-days">${cells}</ul>
      <p class="wx-src">Source: ${esc(AD.weather.SOURCE)} · Sydney</p>`;
  }

  /** Full-bleed banner above the page: greeting, Sydney forecast, primary actions. */
  function hero() {
    const slot = document.getElementById('hero-slot');
    if (!slot) return;
    const longDate = new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Sydney' })
      .format(T.startOfDay(T.todayKey()));
    slot.innerHTML = `
      <div class="hero">
        <div class="hero-inner">
          <div class="hero-lead">
            <img class="hero-logo" src="assets/logo-lockup.png?v=81" alt="Astrea Drive" width="169" height="46">
            <div class="hero-greet">
              <h1>${greeting()}, ${esc(firstName())}.</h1>
              <p class="hero-brand">Fleet operations</p>
              <p class="hero-date"><i class="hero-dot"></i>${esc(longDate)}</p>
            </div>
          </div>
          <div class="hero-wx" id="hero-wx">${wxStrip(AD.weather.cached())}</div>
          <div class="hero-actions">
            <button type="button" class="btn btn-secondary" id="hero-report-btn" title="Download a monthly PDF report or Excel workbook">${I.download} Monthly report</button>
            <a class="btn btn-secondary" href="#/defects?new=1">Report defect</a>
            <a class="btn btn-primary" href="#/calendar?new=1">${I.plus} New booking</a>
          </div>
        </div>
      </div>`;
    AD.weather.load().then((days) => {
      const box = document.getElementById('hero-wx');
      if (box) box.innerHTML = wxStrip(days);
    });
    const reportBtn = document.getElementById('hero-report-btn');
    if (reportBtn) reportBtn.addEventListener('click', onReportClick);
  }

  /** Format picker, then hand off to whichever builder was chosen. */
  let reportBusy = false;
  function onReportClick(e) {
    if (reportBusy) { AD.ui.toast('Your report is still being prepared.'); return; }
    const now = T.parts(Date.now());
    const monthOptions = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(Date.UTC(now.year, now.month - 1 - i, 1));
      const key = d.toISOString().slice(0, 7);
      return `<option value="${key}">${T.MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}${i === 0 ? ' (month to date)' : ''}</option>`;
    }).join('');
    AD.ui.modal({
      title: 'Download monthly report',
      body: `
        <p class="rep-lede">An Astrea-branded review of spend, fleet health and practical next steps.</p>
        <label class="rep-month" for="rep-month">Reporting month<select id="rep-month">${monthOptions}</select></label>
        <p class="rep-lede rep-context">Costs cover the selected month. Fleet status and compliance are a snapshot as of today.</p>
        <div class="rep-picker">
          <button type="button" class="rep-opt" data-fmt="pdf">
            <span class="rep-opt-ico rep-opt-pdf">${I.file}</span>
            <span class="rep-opt-copy">
              <b>PDF report</b>
              <span>A4 pages with charts, monthly statistics and data-based recommendations. Ready to share or print.</span>
            </span>
            <span class="rep-opt-go">${I.chevR}</span>
          </button>
          <button type="button" class="rep-opt" data-fmt="xlsx">
            <span class="rep-opt-ico rep-opt-xls">${I.dashboard}</span>
            <span class="rep-opt-copy">
              <b>Excel workbook</b>
              <span>Five sheets with the underlying figures. For working the numbers yourself.</span>
            </span>
            <span class="rep-opt-go">${I.chevR}</span>
          </button>
        </div>
        <p class="rep-note" id="rep-status" role="status" aria-live="polite"></p>`,
      onMount(el, close) {
        el.querySelectorAll('.rep-opt').forEach((opt) => {
          opt.addEventListener('click', () => runReport(opt.dataset.fmt, el, close));
        });
      }
    });
  }

  async function runReport(fmt, modalEl, close) {
    if (reportBusy) return;
    reportBusy = true;
    const picker = modalEl.querySelector('.rep-picker');
    const status = modalEl.querySelector('#rep-status');
    const month = modalEl.querySelector('#rep-month');
    month.disabled = true;
    picker.setAttribute('aria-busy', 'true');
    picker.querySelectorAll('.rep-opt').forEach((b) => { b.disabled = true; });
    picker.querySelector(`[data-fmt="${fmt}"]`).classList.add('is-running');
    const say = (t) => { if (status) status.textContent = t; };
    try {
      const builder = fmt === 'pdf' ? AD.fleetReportPdf : AD.fleetReport;
      const filename = await builder.generate(say, { month: month.value });
      close();
      AD.ui.toast(`Downloaded ${filename}`);
    } catch (err) {
      console.error('Fleet report failed:', err);
      say('Could not download the report. Check your connection and try again.');
      if (!modalEl.isConnected) AD.ui.toast('Report download failed. Please try again.');
      picker.querySelectorAll('.rep-opt').forEach((b) => { b.disabled = false; });
      picker.querySelector(`[data-fmt="${fmt}"]`).classList.remove('is-running');
    } finally {
      reportBusy = false;
      month.disabled = false;
      picker.setAttribute('aria-busy', 'false');
    }
  }

  function render(el, params) {
    root = el;
    day = /^\d{4}-\d{2}-\d{2}$/.test(params.date || '') ? params.date : T.todayKey();
    fresh = true;
    hero();
    draw();
  }

  function draw() {
    const el = root;
    const today = T.todayKey();
    const vehicles = AD.store.all('vehicles');
    const vac = L.vacTrucks();
    const ownedScheduleVac = vac.filter((v) => !v.hired && OWNED_SCHEDULE_VAC_IDS.has(v.id));
    const svc = vehicles.map((v) => ({ v, s: L.serviceState(v) })).filter((x) => x.s.state !== 'ok')
      .sort((a, b) => (a.s.state === b.s.state ? a.s.daysLeft - b.s.daysLeft : a.s.state === 'overdue' ? -1 : 1));
    const overdue = svc.filter((x) => x.s.state === 'overdue').length;
    const defects = L.openDefects();
    const critical = defects.filter((d) => d.priority === 'Critical').length;
    const high = defects.filter((d) => d.priority === 'High').length;
    const rego = vehicles.map((v) => ({ v, r: L.regoState(v) })).filter((x) => x.r.state !== 'ok').sort((a, b) => a.r.days - b.r.days);
    const expired = rego.filter((x) => x.r.state === 'overdue').length;
    const activityLog = AD.store.all('activity');
    const syncLog = AD.store.all('sync_log');

    /** Donut card: icon + title row, ring on the left, breakdown right, trend across the foot. */
    const donutCard = ({ go, icon, label, ring, legend, foot }) => `
      <button class="strip-item kpi-card-ring" data-go='${JSON.stringify(go)}'>
        <div class="kpi-top">${icon}<span class="kpi-title">${esc(label)}</span><span class="kpi-chev">${I.chevR}</span></div>
        <div class="kpi-ring-wrap">${ring}</div>
        <div class="kpi-ring-side">${legend}</div>
        ${foot ? `<span class="kpi-foot">${foot}</span>` : ''}
      </button>`;

    const join = (...parts) => parts.filter(Boolean).join(' · ');

    // Service & registration health across the whole fleet, bucketed for the
    // rings: red = overdue/expired, orange = due within 2 weeks, green = clear.
    const SOON_DAYS = 14;
    const svcHealth = { overdue: 0, soon: 0, ok: 0 };
    vehicles.forEach((v) => {
      const s = L.serviceState(v);
      if (s.state === 'overdue') svcHealth.overdue++;
      else if (s.daysLeft <= SOON_DAYS || s.kmLeft <= 500) svcHealth.soon++;
      else svcHealth.ok++;
    });
    const regoHealth = { overdue: 0, soon: 0, ok: 0 };
    vehicles.forEach((v) => {
      const r = L.regoState(v);
      if (r.state === 'overdue') regoHealth.overdue++;
      else if (r.days <= SOON_DAYS) regoHealth.soon++;
      else regoHealth.ok++;
    });
    const svcRing = [
      { label: 'Overdue', value: svcHealth.overdue, color: 'var(--st-critical)' },
      { label: 'Within 2 weeks', value: svcHealth.soon, color: 'var(--st-warning)' },
      { label: 'Scheduled', value: svcHealth.ok, color: 'var(--st-good)' }
    ];
    const regoRing = [
      { label: 'Expired', value: regoHealth.overdue, color: 'var(--st-critical)' },
      { label: 'Within 2 weeks', value: regoHealth.soon, color: 'var(--st-warning)' },
      { label: 'Current', value: regoHealth.ok, color: 'var(--st-good)' }
    ];
    const svcDue = svcHealth.overdue + svcHealth.soon;
    const regoDue = regoHealth.overdue + regoHealth.soon;
    const priParts = [
      { label: 'Critical', value: critical, color: 'var(--st-critical)' },
      { label: 'High', value: high, color: 'var(--st-serious)' },
      { label: 'Medium', value: defects.filter((d) => d.priority === 'Medium').length, color: 'var(--st-warning)' },
      { label: 'Low', value: defects.filter((d) => d.priority === 'Low').length, color: 'var(--viz-low)' }
    ];

    // Fleet activity card: year-to-date distance, fuel and engine hours, plus
    // trips and top speed over Netstar's own rolling window.
    const gps = L.gpsTotals();
    el.classList.toggle('anim-in', fresh);
    fresh = false;

    // A background refresh (the 45s poll) rebuilds this whole block — don't
    // let it silently snap shut a "View as table" someone just opened.
    const openDetails = detailsSnapshot(el);

    el.innerHTML = `
      ${insightsBand(facts({ vehicles, vac, svc, rego, defects, today }))}

      <div class="strip" role="group" aria-label="Fleet summary">
        ${activityCard(gps, vehicles.length, today)}
        ${donutCard({
          go: ['maintenance', { filter: 'due' }],
          icon: kpiIco(I.wrench, 'amber'),
          label: 'Servicing',
          ring: donutRing(svcRing, svcDue, 'due'),
          legend: legendGrid(svcRing.filter((p) => p.value), 'kpi-legend-stack'),
          foot: svcHealth.overdue ? `<span class="flag flag-red">${svcHealth.overdue} overdue</span>`
            : svcHealth.soon ? `<span class="flag flag-amber">${svcHealth.soon} within 2 weeks</span>` : 'All up to date'
        })}
        ${donutCard({
          go: ['fleet', { flag: 'rego' }],
          icon: kpiIco(I.file, 'violet'),
          label: 'Registration',
          ring: donutRing(regoRing, regoDue, 'due'),
          legend: legendGrid(regoRing.filter((p) => p.value), 'kpi-legend-stack'),
          foot: regoHealth.overdue ? `<span class="flag flag-red">${regoHealth.overdue} expired</span>`
            : regoHealth.soon ? `<span class="flag flag-amber">${regoHealth.soon} within 2 weeks</span>` : 'All current'
        })}
      </div>

      ${insights(vehicles, vac, priParts)}

      <section class="section" aria-labelledby="sched-h">
        ${schedule(ownedScheduleVac, today)}
      </section>

      <div class="cols-2">
        <section class="section">
          ${sectionHead({ title: 'Registration renewals', meta: join(expired ? `<span class="flag flag-red">${expired} expired</span>` : '', `${rego.length - expired} due within 60 days`) })}
          ${rego.length ? `<ul class="rows">${rego.slice(0, LIST_MAX).map(({ v, r }) => attentionRow(v,
            r.state === 'overdue' ? 'Registration expired' : 'Registration renewal due',
            L.attentionTone(r.state, r.days), `${esc(v.rego)} · ${esc(v.type)}`,
            T.fmtKey(v.regoExpiry), relDays(r.days))).join('')}</ul>`
            : '<p class="empty">No renewals due in the next 60 days.</p>'}
          <p class="section-foot"><a href="#/fleet?flag=rego">View all renewals${rego.length > LIST_MAX ? ` (${rego.length})` : ''}</a></p>
        </section>
        <section class="section">
          ${sectionHead({ title: 'Servicing', meta: join(overdue ? `<span class="flag flag-red">${overdue} overdue</span>` : '', `${svc.length - overdue} due soon`) })}
          ${svc.length ? `<ul class="rows">${svc.slice(0, LIST_MAX).map(({ v, s }) => {
            // Show whichever limit triggered the alert: the date or the odometer.
            const byKm = s.daysLeft >= 0 && (s.kmLeft <= 0 || (s.state === 'soon' && s.daysLeft > L.SOON_DAYS));
            const deadline = byKm ? L.fmtKm(v.nextServiceKm) : T.fmtKey(v.nextServiceDate);
            const rel = byKm ? (s.kmLeft <= 0 ? `${L.fmtKm(-s.kmLeft)} over` : `${L.fmtKm(s.kmLeft)} to go`) : relDays(s.daysLeft);
            const detail = byKm ? `Odometer ${L.fmtKm(v.odometer)} · date limit ${T.fmtKey(v.nextServiceDate)}`
              : s.hasKm ? `Or at ${L.fmtKm(v.nextServiceKm)} · now ${L.fmtKm(v.odometer)}` : `Date-only service schedule · now ${L.fmtKm(v.odometer)}`;
            return attentionRow(v, s.state === 'overdue' ? 'Service overdue' : 'Service due', L.attentionTone(s.state, s.daysLeft, s.kmLeft), detail, deadline, rel);
          }).join('')}</ul>`
            : '<p class="empty">Nothing due in the next 30 days.</p>'}
          <p class="section-foot"><a href="#/maintenance?filter=due">View all servicing${svc.length > LIST_MAX ? ` (${svc.length})` : ''}</a></p>
        </section>
      </div>

      ${staffLicences()}

      <section class="section">
        ${sectionHead({ title: 'Recent activity', meta: 'Latest 6 changes' })}
        <ul class="rows activity">
          ${activityLog.slice(0, 6).map((a) => {
            const who = L.userName(a.userEmail);
            return `<li><span class="what">${esc(a.text)}${who ? `<span class="t2">by ${esc(who)} · ${esc(a.userEmail)}</span>` : ''}</span><span class="when">${esc(relTime(a.ts))}</span></li>`;
          }).join('') || '<li class="muted">No activity yet.</li>'}
        </ul>
        <p class="section-foot"><a href="#/activity">View all activity${activityLog.length > 6 ? ` (${activityLog.length})` : ''}</a></p>
      </section>

      <section class="section">
        ${sectionHead({ title: 'Telematic inputs', meta: 'GPS syncs — automatic and manual' })}
        <ul class="rows activity">
          ${(() => {
            // Top list hides zero-everything successes — only runs that actually
            // moved the numbers (or failed) show up. Everything else is still
            // available in the "View all inputs" table below for diagnostics.
            const shown = syncLog.filter(syncAdded).slice(0, 8);
            return shown.map((r) => `<li class="link${r.ok === false ? ' sync-fail' : ''}" data-sync="${esc(r.id)}" tabindex="0" title="See which vehicles this sync updated"><span class="what">${esc(syncLabel(r))}<span class="t2">${esc(syncDetail(r))}</span></span><span class="when">${esc(T.fmtDateTime(r.ranAt))}</span></li>`).join('')
              || '<li class="muted">No GPS syncs with new data yet.</li>';
          })()}
        </ul>
        ${syncLog.length ? `<details class="sync-all">
          <summary>View all inputs <span class="muted">(${syncLog.length} run${syncLog.length === 1 ? '' : 's'})</span></summary>
          <div class="table-wrap">
            <table class="data sync-tbl">
              <thead><tr>
                <th style="width:160px">When</th>
                <th style="width:200px">Type</th>
                <th style="width:88px">Odometers</th>
                <th style="width:120px">Engine-hour days</th>
                <th style="width:120px">Trip stats</th>
                <th>Result</th>
              </tr></thead>
              <tbody>${syncLog.map((r) => {
                const cell = (n) => n == null ? `<span class="muted">—</span>` : (Number(n) === 0 ? `<span class="muted">0</span>` : String(n));
                const result = r.ok === false
                  ? `<span class="flag flag-red">Failed</span> <span class="t2">${esc(r.error || 'unknown error')}</span>`
                  : syncAdded(r)
                    ? `<span class="flag flag-green">Added data</span>`
                    : `<span class="flag flag-muted">Nothing new</span>`;
                return `<tr class="sync-row${r.ok === false ? ' sync-fail' : ''}" data-sync="${esc(r.id)}" tabindex="0" title="See which vehicles this sync updated">
                  <td>${esc(T.fmtDateTime(r.ranAt))}</td>
                  <td>${esc(syncLabel(r))}</td>
                  <td>${cell(r.updated)}</td>
                  <td>${cell(r.dailyRecorded)}</td>
                  <td>${cell(r.tripStatsRecorded)}</td>
                  <td>${result}</td>
                </tr>`;
              }).join('')}</tbody>
            </table>
          </div>
        </details>` : ''}
      </section>`;

    detailsRestore(el, openDetails);

    el.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { const [r, p] = JSON.parse(b.dataset.go); AD.go(r, p); }));
    wireInsights(el);
    // Telematic inputs: click (or Enter on) a run to see the vehicles it updated.
    el.querySelectorAll('[data-sync]').forEach((row) => {
      const open = () => { const r = syncLog.find((x) => String(x.id) === row.dataset.sync); if (r) openSyncDetails(r); };
      row.addEventListener('click', open);
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
    el.querySelectorAll('.rows li[data-veh]').forEach((li) => li.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      AD.go('vehicle/' + li.dataset.veh);
    }));
    el.querySelectorAll('.rows li[data-emp]').forEach((li) => li.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      AD.go('employee/' + li.dataset.emp);
    }));
    el.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => {
      const menu = e.target.closest('[data-edit]');
      if (menu) { AD.vehicleForm(AD.store.get('vehicles', menu.dataset.edit), () => draw()); return; }
      if (e.target.closest('a, button')) return;
      location.hash = tr.dataset.href;
    }));
    const dateIn = el.querySelector('#sched-date');
    dateIn.addEventListener('change', () => { if (dateIn.value) { day = dateIn.value; AD.setParams({ date: day === today ? '' : day }); draw(); } });
    const todayBtn = el.querySelector('#sched-today');
    if (todayBtn) todayBtn.onclick = () => { day = today; AD.setParams({}); draw(); };
    el.querySelectorAll('.sched-tab').forEach(t => t.addEventListener('click', () => { schedFilter = t.dataset.scope; draw(); }));
  }

  // ---------- Fleet insights (charts) ----------
  function insights(vehicles, vac, priParts) {
    const V = AD.viz;
    const today = T.todayKey();
    const aud0 = (n) => n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });

    // 1. Vac trucks actually working each day, last 14 days — from GPS engine
    //    hours, not bookings (the fleet isn't scheduled through Drive, so a
    //    forward-looking bookings chart would just show zeros). A truck
    //    counts as "working" on a day its tracker reported any engine hours.
    const DAYS_BACK = 14;
    const vacTracked = vac.filter((v) => v.odometerSource === 'telematics' || !!v.netstarRego);
    const perTruck = vacTracked.map((v) => L.workHoursDaily(v, DAYS_BACK)).filter(Boolean);
    const days = Array.from({ length: DAYS_BACK }, (_, i) => T.addDays(today, -(DAYS_BACK - 1 - i)));
    const util = days.map((d, i) => {
      const working = perTruck.filter((p) => p.days[i] && p.days[i].hours > 0).length;
      const noData = perTruck.filter((p) => !p.days[i] || p.days[i].hours == null).length;
      return { d, working, noData };
    });
    const n = vacTracked.length || 1;
    const workingColor = 'var(--mint)', noDataColor = 'var(--viz-free-key)';
    const utilCols = util.map((u) => {
      const k = T.parseKey(u.d);
      const dow = T.DOW[T.dayOfWeek(u.d)];
      const rows = [['Working', String(u.working), workingColor], ['No GPS data', String(u.noData), noDataColor]];
      const segs = u.working ? `<i style="height:${(u.working / n) * 100}%;background:${workingColor}"></i>` : '';
      return `<a class="uc-col${u.d === today ? ' is-today' : ''}${T.dayOfWeek(u.d) >= 5 ? ' is-weekend' : ''}" href="#/fleet?type=${encodeURIComponent('Vac truck')}"
          ${V.tipAttr(`${T.fmtKeyLong(u.d)} · ${u.working} of ${n} trucks working`, rows)} aria-label="${T.fmtKeyLong(u.d)}: ${u.working} of ${n} vac trucks working">
          <span class="uc-bar">${segs}<span class="uc-cap" style="bottom:calc(${(u.working / n) * 100}% + 4px)">${u.working}</span></span>
          <span class="uc-x"><b>${dow}</b>${k.d}</span>
        </a>`;
    }).join('');

    // 2. Open defects by priority (direct labels; severity colours always with text)
    const maxPri = Math.max(...priParts.map((p) => p.value), 1);
    const priRows = priParts.map((p) => `
      <a class="hb-row" href="#/defects?status=open&priority=${p.label}" ${V.tipAttr(`${p.label} priority`, [['Open defects', String(p.value), p.color]])} aria-label="${p.label}: ${p.value} open">
        <span class="hb-label">${p.label}</span>
        <span class="hb-track">${p.value ? `<i style="width:${(p.value / maxPri) * 100}%;background:${p.color}"></i>` : ''}</span>
        <span class="hb-val">${p.value}</span>
      </a>`).join('');

    // 4. Fleet by type and status (stacked bars share one scale)
    const types = AD.VEHICLE_TYPES.map((t) => ({ t, list: vehicles.filter((v) => v.type === t) })).filter((x) => x.list.length);
    const maxType = Math.max(...types.map((x) => x.list.length), 1);
    const typeRows = types.map(({ t, list }) => {
      const parts = V.VEHICLE.map((s) => ({ ...s, value: list.filter((v) => v.status === s.key).length }));
      return `<a class="hb-row" href="#/fleet?type=${encodeURIComponent(t)}" ${V.tipAttr(`${t} · ${list.length}`, parts.filter((p) => p.value).map((p) => [p.label, String(p.value), p.color]))} aria-label="${t}: ${parts.filter((p) => p.value).map((p) => `${p.value} ${p.label}`).join(', ')}">
        <span class="hb-label">${esc(t)}</span>
        <span class="hb-track"><span class="hb-stack" style="width:${(list.length / maxType) * 100}%">${parts.filter((p) => p.value).map((p) => `<i style="flex:${p.value};background:${p.color}"></i>`).join('')}</span></span>
        <span class="hb-val">${list.length}</span>
      </a>`;
    }).join('');
    const statusTotals = V.VEHICLE.map((s) => ({ ...s, value: vehicles.filter((v) => v.status === s.key).length }));

    // 5. Vehicle usage — average distance driven per day, from odometer movement
    //    since last service (odometer kept current by the GPS sync).
    const usageColor = 'var(--mint)';
    const usageList = vehicles.filter((v) => !v.hired)
      .map((v) => ({ v, u: L.usageRate(v) }))
      .filter((x) => x.u)
      .sort((a, b) => b.u.perDay - a.u.perDay);
    const usageShown = usageList.slice(0, 10);
    const maxUse = Math.max(...usageShown.map((x) => x.u.perDay), 1);
    const km0 = (n) => Math.round(n).toLocaleString('en-AU');
    const usageRows = usageShown.map(({ v, u }) => `
      <a class="hb-row" href="#/vehicle/${v.id}" ${V.tipAttr(v.id, [['Per day', km0(u.perDay) + ' km', usageColor], ['Per week', km0(u.perWeek) + ' km', 'var(--muted)']])} aria-label="${v.id}: ${km0(u.perDay)} km per day">
        <span class="hb-label">${esc(v.id)}</span>
        <span class="hb-track"><i style="width:${(u.perDay / maxUse) * 100}%;background:${usageColor}"></i></span>
        <span class="hb-val">${km0(u.perDay)}<small> km/day</small></span>
      </a>`).join('');

    const workingToday = util[util.length - 1].working;
    const trackedNote = vacTracked.length < vac.length ? ` · ${vacTracked.length} of ${vac.length} vac trucks have a GPS tracker` : '';
    return `
      <section class="section">
        ${sectionHead({ title: 'Fleet charts', meta: 'Activity, usage, open defects and fleet mix' })}
        <div class="insights">
          <figure class="viz-card viz-wide">
            <figcaption><h3>Vac trucks working</h3><span class="viz-sub">Last 14 days, from GPS engine hours · ${workingToday} of ${n} today${trackedNote}</span></figcaption>
            ${vacTracked.length ? `
            <div class="uc" style="--rows:${n}">
              <div class="uc-axis" aria-hidden="true"><span style="bottom:100%">${n}</span><span style="bottom:50%">${n / 2}</span><span style="bottom:0">0</span></div>
              <div class="uc-plot"><div class="uc-grid" aria-hidden="true"><i style="bottom:100%"></i><i style="bottom:50%"></i><i style="bottom:0"></i></div><div class="uc-cols">${utilCols}</div></div>
            </div>
            ${V.table(['Date', 'Working', 'No GPS data', 'Of'], util.map((u) => [T.fmtKeyLong(u.d), String(u.working), String(u.noData), String(n)]))}
            ` : `<p class="empty" style="padding:16px">No vac truck has a GPS tracker yet, so there’s nothing to chart here. Fit a tracker and run “Sync GPS data” on the fleet register.</p>`}
          </figure>

          <figure class="viz-card">
            <figcaption><h3>Vehicle usage</h3><span class="viz-sub">Average distance driven per day${usageList.length ? ` · busiest ${usageShown.length} of ${usageList.length} with data` : ''}</span></figcaption>
            ${usageRows
              ? `<div class="hb">${usageRows}</div>`
              : '<p class="empty" style="padding:16px">No usage data yet. It needs a current odometer and a last-service reading — run “Sync GPS data” on the fleet register, then check back.</p>'}
            ${usageList.length ? V.table(['Vehicle', 'Per day', 'Per week', 'Measured over'], usageList.map(({ v, u }) => [v.id, km0(u.perDay) + ' km', km0(u.perWeek) + ' km', u.days + ' days'])) : ''}
          </figure>

          <figure class="viz-card">
            <figcaption><h3>Open defects by priority</h3><span class="viz-sub">${priParts.reduce((s, p) => s + p.value, 0)} open · select a bar to filter</span></figcaption>
            <div class="hb">${priRows}</div>
            ${V.table(['Priority', 'Open defects'], priParts.map((p) => [p.label, String(p.value)]))}
          </figure>

          <figure class="viz-card">
            <figcaption><h3>Fleet by type</h3><span class="viz-sub">${vehicles.length} vehicles, coloured by status</span></figcaption>
            ${V.legend(statusTotals.filter((p) => p.value), { counts: false })}
            <div class="hb">${typeRows}</div>
            ${V.table(['Type'].concat(V.VEHICLE.map((s) => s.label)), types.map(({ t, list }) => [t].concat(V.VEHICLE.map((s) => String(list.filter((v) => v.status === s.key).length)))))}
          </figure>
        </div>
      </section>`;
  }

  const relDays = (days) => (days === 0 ? 'Today' : days < 0 ? `${-days} day${days === -1 ? '' : 's'} ago` : `In ${days} day${days === 1 ? '' : 's'}`);

  function attentionRow(v, issue, tone, detail, deadline, rel) {
    return `<li class="link" data-veh="${v.id}" title="Open ${v.id}">
      <a class="id" href="#/vehicle/${v.id}">${esc(v.id)}</a>
      <span class="what"><span class="${tone ? 'flag flag-' + tone : ''}">${esc(issue)}</span><span class="t2">${detail}</span></span>
      <span class="when">${deadline}<span class="t2">${rel}</span></span>
    </li>`;
  }

  /**
   * Staff licences & tickets that have expired or expire within the warning
   * window, most urgent first — the people-side twin of Registration renewals.
   * Hidden until at least one expiry date has been recorded in the Employee
   * register, so it doesn't sit empty before that data exists.
   */
  function staffLicences() {
    const E = AD.employees;
    if (!E || !AD.store.available('employees')) return '';
    const staff = AD.store.all('employees');
    const anyDates = staff.some((p) => E.licenceStates(p).some((l) => l.expiry));
    if (!anyDates) return '';
    const items = staff.flatMap((p) => E.licenceIssues(p).map((l) => ({ p, l }))).sort((a, b) => a.l.days - b.l.days);
    const expired = items.filter((x) => x.l.state === 'expired').length;
    const initials = (n) => String(n || '?').trim().split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase();
    const row = ({ p, l }) => `<li class="link emp-attn" data-emp="${esc(p.id)}" title="Open ${esc(p.name)}">
        <span class="emp-thumb" aria-hidden="true">${p.photo ? `<img src="${esc(p.photo)}" alt="">` : esc(initials(p.name))}</span>
        <span class="what"><span class="flag flag-${E.LIC_TONE[l.state]}">${esc(l.name)} ${l.state === 'expired' ? 'expired' : 'expiring'}</span><span class="t2"><a href="#/employee/${encodeURIComponent(p.id)}">${esc(p.name)}</a>${p.position ? ' · ' + esc(p.position) : ''}</span></span>
        <span class="when">${T.fmtKey(l.expiry)}<span class="t2">${esc(E.licenceRel(l))}</span></span>
      </li>`;
    return `<section class="section">
      ${sectionHead({ title: 'Staff licences & tickets', meta: items.length ? [expired ? `<span class="flag flag-red">${expired} expired</span>` : '', `${items.length - expired} expiring within ${E.LIC_SOON_DAYS} days`].filter(Boolean).join(' · ') : '' })}
      ${items.length ? `<ul class="rows">${items.slice(0, LIST_MAX).map(row).join('')}</ul>` : `<p class="empty">No staff licences or tickets expiring in the next ${E.LIC_SOON_DAYS} days.</p>`}
      <p class="section-foot"><a href="#/employee-register">View employee register${items.length > LIST_MAX ? ` (${items.length} to action)` : ''}</a></p>
    </section>`;
  }

  // ---------- Today's vac truck schedule ----------
  function schedule(vac, today) {
    const ds = T.startOfDay(day), de = T.startOfDay(T.addDays(day, 1));
    const now = Date.now();
    const clashes = L.conflictIds();
    const inDay = (b) => Date.parse(b.start) < de && Date.parse(b.end) > ds;
    const clock = (ms) => (ms >= ds && ms < de ? T.fmtTime(ms) : `${T.fmtDate(ms).slice(0, 5)} ${T.fmtTime(ms)}`);

    // Compute scope for each truck first so we can build filter tabs with counts.
    const scope = new Map();
    let booked = 0, maint = 0, free = 0, clashCount = 0;
    vac.forEach(v => {
      const live = L.bookingsFor(v.id).filter(b => inDay(b) && b.status !== 'cancelled');
      let s = 'free';
      if (live.length) s = live.every(b => b.kind === 'maintenance') ? 'maint' : 'booked';
      scope.set(v.id, s);
      if (s === 'booked') booked++; else if (s === 'maint') maint++; else free++;
      if (live.some(b => clashes.has(b.id))) clashCount++;
    });

    const scopeMatch = (v) => schedFilter === 'all' || scope.get(v.id) === schedFilter;
    const shown = vac.filter(scopeMatch);

    const body = shown.map((v) => {
      const list = L.bookingsFor(v.id).filter(inDay);
      const live = list.filter((b) => b.status !== 'cancelled');

      // A truck with no active bookings is Unscheduled, even if it has cancelled ones.
      const rows = (live.length ? [] : [null]).concat(list);
      const span = rows.length;
      const truckCell = `<td rowspan="${span}" class="truck-cell${span > 1 ? ' span' : ''}">
          <span class="truck-thumb">${AD.art.vac(AD.art.num(v.id), 72)}</span>
          <a class="id" href="#/vehicle/${v.id}" title="Open ${v.id}">${v.id}</a>
          <span class="t2">${esc(v.rego)}</span>
          ${v.status === 'Out of service' || v.status === 'In workshop' ? `<span class="t2">${esc(v.status)}</span>` : ''}
        </td>`;
      // Vehicle-level cells span the truck's booking rows.
      const attnCell = `<td rowspan="${span}" class="col-opt col-attn">${AD.ui.attentionFlags(v) || dash}</td>`;
      const menuCell = `<td rowspan="${span}" class="col-action col-opt">
          <button class="row-menu" data-edit="${v.id}" title="Edit ${esc(v.id)}" aria-label="Edit ${esc(v.id)}">${I.dots}</button>
        </td>`;

      return rows.map((b, i) => {
        const cls = ['row-link', i === span - 1 ? 'group-end' : 'cont', i > 0 ? 'sub' : ''];
        const first = i === 0 ? truckCell : '';
        if (!b) {
          const truckHref = `#/vehicle/${v.id}?tab=bookings`;
          return `<tr class="${cls.join(' ')}" data-href="${truckHref}" title="Open ${v.id}">
            ${first}
            <td class="col-opt">${dash}</td>
            <td><span class="missing">${list.length ? 'No active bookings on this date' : 'No bookings on this date'}</span></td>
            <td class="col-opt">${dash}</td>
            <td>${scheduleBadge('unscheduled')}</td>
            ${attnCell}${menuCell}
          </tr>`;
        }
        const s = Date.parse(b.start), e = Date.parse(b.end);
        const cancelled = b.status === 'cancelled';
        const strike = cancelled ? 'strike' : '';
        const cat = L.bookingCategory(b);
        const href = `#/calendar?view=day&date=${day}&open=${b.id}`;
        const driver = b.driverId ? driverCell(L.driverName(b.driverId)) : dash;
        const isNow = day === today && !cancelled && s <= now && now < e;
        const clash = clashes.has(b.id);
        if (cancelled) cls.push('muted-row');
        return `<tr class="${cls.join(' ')}" data-href="${href}" title="Open booking">
          ${first}
          <td class="col-opt ${strike}">${driver}</td>
          <td><a class="row-title ${strike}" href="${href}">${esc(L.bookingTitle(b))}</a>${b.jobNumber ? ` <span class="muted small nowrap">${esc(b.jobNumber)}</span>` : ''}${siteHtml(b, cancelled)}<span class="t2 only-mobile ${strike}">${clock(s)} – ${clock(e)}${isNow ? ' · Now' : ''}</span></td>
          <td class="col-opt ${strike}"><span class="nowrap">${clock(s)} –</span> <span class="nowrap">${clock(e)}</span>${isNow ? '<span class="tag-now">Now</span>' : ''}${isNow ? jobProgress(s, e, now) : ''}${dayBar(s, e, cancelled ? 'cancelled' : cat, clash, ds, de, now)}</td>
          <td>${clash ? `${scheduleBadge('conflict')}<span class="t2">${AD.ui.BOOKING_LABEL[cat]} · overlaps</span>` : bookingBadge(cat)}</td>
          ${i === 0 ? attnCell + menuCell : ''}
        </tr>`;
      }).join('');
    }).join('');

    const meta = [
      `${booked} booked`, maint ? `${maint} in maintenance` : '', `${free} unscheduled`,
      clashCount ? `<span class="flag flag-red">${clashCount} with clashes</span>` : ''
    ].filter(Boolean).join(' · ');

    const tabs = [
      { key: 'all', label: 'All', count: vac.length },
      { key: 'booked', label: 'Booked', count: booked },
      { key: 'free', label: 'Unscheduled', count: free },
      { key: 'maint', label: 'Maintenance', count: maint }
    ];
    const tabsHtml = `<div class="sched-tabs" role="tablist" aria-label="Filter schedule">
      ${tabs.map(t => `<button type="button" role="tab" class="sched-tab${schedFilter === t.key ? ' on' : ''}" data-scope="${t.key}" aria-selected="${schedFilter === t.key}">
        ${esc(t.label)}<span class="sched-tab-count">${t.count}</span>
      </button>`).join('')}
    </div>`;

    const emptyRow = `<tr><td colspan="7" class="sched-empty">No trucks in this view — try another tab.</td></tr>`;

    return `
      ${sectionHead({
        title: day === today ? 'Today’s vac truck schedule' : `Vac truck schedule — ${T.fmtKeyLong(day)}`,
        meta,
        actions: `${day !== today ? '<button class="btn btn-ghost" id="sched-today">Today</button>' : ''}
          <input type="date" id="sched-date" value="${day}" aria-label="Schedule date" style="width:150px">
          <a class="btn btn-secondary" href="#/tracker?date=${day}">${I.map} Open Tracker</a>`
      }).replace('<h2>', '<h2 id="sched-h">')}
      ${tabsHtml}
      <div class="table-wrap">
        <table class="data">
          <thead><tr>
            <th style="width:108px">Truck</th><th class="col-opt" style="width:132px">Driver</th><th>Job / site</th>
            <th class="col-opt" style="width:128px">Booking time</th><th style="width:140px">Status</th>
            <th class="col-opt col-attn" style="min-width:380px">Needs attention</th>
            <th class="col-opt col-action"><span class="hide">Actions</span></th>
          </tr></thead>
          <tbody>${body || emptyRow}</tbody>
        </table>
      </div>
      <p class="section-foot muted small">Times in Australia/Sydney (${T.abbr(ds + 12 * 3600000)}). Drivers and times are shown only where a booking records them.</p>`;
  }

  /** 24-hour strip showing when the booking sits in the selected day. */
  function dayBar(s, e, cat, clash, ds, de, now) {
    const span = de - ds;
    const pct = (ms) => ((Math.min(Math.max(ms, ds), de) - ds) / span) * 100;
    const left = pct(s), width = Math.max(pct(e) - left, 1.5);
    const tick = now >= ds && now < de ? `<b style="left:${pct(now)}%"></b>` : '';
    return `<span class="daybar" aria-hidden="true"><i class="db-${cat}${clash ? ' db-clash' : ''}" style="left:${left}%;width:${width}%"></i>${tick}</span>`;
  }

  function siteHtml(b, cancelled) {
    const strike = cancelled ? 'strike' : '';
    if (L.hasCoords(b)) {
      const s = b.siteId ? AD.store.get('sites', b.siteId) : null;
      const name = s ? s.name : (b.address || 'Pinned location');
      let addr = s ? s.address : 'Dropped pin';
      if (s && addr.startsWith(s.name)) addr = addr.slice(s.name.length).replace(/^,\s*/, '');
      return `<span class="t2 ${strike}"><span class="site-pin">${I.pin}</span><span class="site-name">${esc(name)}</span>${addr ? ' · ' + esc(addr) : ''}</span>`;
    }
    return `<span class="t2">${cancelled ? '' : `<span class="flag flag-amber">Site location required</span>`}${b.address ? ` <span class="${strike}">${esc(b.address)} (not located)</span>` : ''}</span>`;
  }

  return { title: 'Fleet overview', render, refresh: () => root && draw(), destroy: stopInsights };
})();
