/* Dashboard — fleet overview */
AD.views = AD.views || {};

AD.views.dashboard = (function () {
  const { esc, stateBadge, bookingBadge, scheduleBadge, pageHeader, sectionHead, dash, relTime } = AD.ui;
  const L = AD.logic, T = AD.time, I = AD.icons;
  const LIST_MAX = 5;
  const FIRST_NAME_BY_EMAIL = {
    'd.macwhinney@astrea.com.au': 'Dale',
  };
  function firstName() {
    const email = (AD.currentUserEmail || '').toLowerCase();
    return FIRST_NAME_BY_EMAIL[email] || 'Will';
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

  function trendTag(pct, label) {
    if (pct === 0) return `<span class="kpi-trend kpi-trend-flat"><b>—</b> ${esc(label)}</span>`;
    const arrow = pct > 0 ? '↑' : '↓';
    return `<span class="kpi-trend kpi-trend-${pct > 0 ? 'up' : 'down'}"><b>${arrow} ${Math.abs(pct)}%</b> ${esc(label)}</span>`;
  }

  function legendGrid(parts, cls) {
    return `<div class="kpi-legend${cls ? ' ' + cls : ''}">${parts.map(p =>
      `<span class="kpi-legend-item" title="${p.value} ${esc(p.label)}"><i style="background:${p.color}"></i><b>${p.value}</b><span>${esc(p.label)}</span></span>`
    ).join('')}</div>`;
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
            <button type="button" class="btn btn-secondary" id="hero-report-btn" title="Download Fleet Performance Report (Excel)">${I.download} Monthly report</button>
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

  async function onReportClick(e) {
    const btn = e.currentTarget;
    if (btn.dataset.busy === '1') return;
    const originalHtml = btn.innerHTML;
    btn.dataset.busy = '1';
    btn.disabled = true;
    btn.innerHTML = 'Preparing…';
    try {
      const filename = await AD.fleetReport.generate((text) => { btn.innerHTML = esc(text); });
      btn.innerHTML = originalHtml;
      if (AD.ui.toast) AD.ui.toast(`Downloaded ${filename}`);
    } catch (err) {
      console.error('Fleet report failed:', err);
      btn.innerHTML = originalHtml;
      if (AD.ui.toast) AD.ui.toast('Report failed — check the console');
    } finally {
      btn.disabled = false;
      delete btn.dataset.busy;
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
    const available = vehicles.filter((v) => v.status === 'Available');
    const svc = vehicles.map((v) => ({ v, s: L.serviceState(v) })).filter((x) => x.s.state !== 'ok')
      .sort((a, b) => (a.s.state === b.s.state ? a.s.daysLeft - b.s.daysLeft : a.s.state === 'overdue' ? -1 : 1));
    const overdue = svc.filter((x) => x.s.state === 'overdue').length;
    const defects = L.openDefects();
    const critical = defects.filter((d) => d.priority === 'Critical').length;
    const high = defects.filter((d) => d.priority === 'High').length;
    const rego = vehicles.map((v) => ({ v, r: L.regoState(v) })).filter((x) => x.r.state !== 'ok').sort((a, b) => a.r.days - b.r.days);
    const expired = rego.filter((x) => x.r.state === 'overdue').length;
    const activityLog = AD.store.all('activity');

    const V = AD.viz;

    /** Donut card: icon + title row, ring on the left, breakdown right, trend across the foot. */
    const donutCard = ({ go, icon, label, ring, legend, foot }) => `
      <button class="strip-item kpi-card-ring" data-go='${JSON.stringify(go)}'>
        <div class="kpi-top">${icon}<span class="kpi-title">${esc(label)}</span><span class="kpi-chev">${I.chevR}</span></div>
        <div class="kpi-ring-wrap">${ring}</div>
        <div class="kpi-ring-side">${legend}</div>
        ${foot ? `<span class="kpi-foot">${foot}</span>` : ''}
      </button>`;

    const join = (...parts) => parts.filter(Boolean).join(' · ');

    // Summary visuals
    const byStatus = V.VEHICLE.map((s) => ({ ...s, value: vehicles.filter((v) => v.status === s.key).length }));

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

    // Utilisation trend. Compared against the same weekday over the previous
    // four weeks so a weekday is never measured against an average dragged
    // down by weekends, when no trucks are booked.
    const dayBusy = (dk) => {
      const s2 = T.startOfDay(dk), e2 = T.startOfDay(T.addDays(dk, 1));
      return vac.filter(v => L.bookingsFor(v.id).some(b => b.status !== 'cancelled' && Date.parse(b.start) < e2 && Date.parse(b.end) > s2)).length;
    };
    const todayBusy = dayBusy(today);
    let sameDaySum = 0;
    for (let w = 1; w <= 4; w++) sameDaySum += dayBusy(T.addDays(today, -7 * w));
    const utilAvg = sameDaySum / 4;
    const utilTrend = utilAvg > 0 ? Math.round(((todayBusy - utilAvg) / utilAvg) * 100) : 0;

    el.classList.toggle('anim-in', fresh);
    fresh = false;

    el.innerHTML = `
      ${insightsBand(facts({ vehicles, vac, svc, rego, defects, today }))}

      <div class="strip" role="group" aria-label="Fleet summary">
        ${donutCard({
          go: ['fleet', {}], icon: kpiIco(I.truck, 'blue'), label: 'Fleet availability',
          ring: donutRing(byStatus, `${Math.round((available.length / (vehicles.length || 1)) * 100)}%`, 'available'),
          legend: legendGrid(byStatus, 'kpi-legend-stack'),
          foot: `<span class="kpi-footline">${vehicles.length} vehicles · ${vac.length} vac trucks</span>${trendTag(utilTrend, 'vs last week')}`
        })}
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

      <section class="section">
        ${sectionHead({ title: 'Recent activity', meta: 'Latest 6 changes' })}
        <ul class="rows activity">
          ${activityLog.slice(0, 6).map((a) => {
            const who = L.userName(a.userEmail);
            return `<li><span class="what">${esc(a.text)}${who ? `<span class="t2">by ${esc(who)} · ${esc(a.userEmail)}</span>` : ''}</span><span class="when">${esc(relTime(a.ts))}</span></li>`;
          }).join('') || '<li class="muted">No activity yet.</li>'}
        </ul>
        <p class="section-foot"><a href="#/activity">View all activity${activityLog.length > 6 ? ` (${activityLog.length})` : ''}</a></p>
      </section>`;

    el.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { const [r, p] = JSON.parse(b.dataset.go); AD.go(r, p); }));
    wireInsights(el);
    el.querySelectorAll('.rows li[data-veh]').forEach((li) => li.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      AD.go('vehicle/' + li.dataset.veh);
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

    // 1. Vac truck utilisation, next 14 days: each truck-day counted once, by its firmest booking.
    const days = Array.from({ length: 14 }, (_, i) => T.addDays(today, i));
    const util = days.map((d) => {
      const ds = T.startOfDay(d), de = T.startOfDay(T.addDays(d, 1));
      const c = { confirmed: 0, tentative: 0, depot: 0, maintenance: 0 };
      vac.forEach((v) => {
        const bs = L.bookingsFor(v.id).filter((b) => b.status !== 'cancelled' && Date.parse(b.start) < de && Date.parse(b.end) > ds);
        if (!bs.length) return;
        const jobs = bs.filter((b) => b.kind === 'job');
        c[jobs.some((b) => b.status === 'confirmed') ? 'confirmed' : jobs.length ? 'tentative' : bs.some((b) => b.kind === 'depot') ? 'depot' : 'maintenance']++;
      });
      c.free = vac.length - (c.confirmed + c.tentative + c.depot + c.maintenance);
      return { d, c };
    });
    const totals = V.BOOKING.map((b) => ({ ...b, value: util.reduce((n, u) => n + u.c[b.key], 0) }));
    const n = vac.length || 1;
    const utilCols = util.map((u) => {
      const k = T.parseKey(u.d);
      const dow = T.DOW[T.dayOfWeek(u.d)];
      const booked = n - u.c.free;
      const rows = V.BOOKING.map((b) => [b.label, String(u.c[b.key]), b.color]).concat([['Free', String(u.c.free), 'var(--viz-free-key)']]);
      const segs = V.BOOKING.filter((b) => u.c[b.key]).map((b) => `<i style="height:${(u.c[b.key] / n) * 100}%;background:${b.color}"></i>`).join('');
      return `<a class="uc-col${u.d === today ? ' is-today' : ''}${T.dayOfWeek(u.d) >= 5 ? ' is-weekend' : ''}" href="#/calendar?view=day&date=${u.d}"
          ${V.tipAttr(`${T.fmtKeyLong(u.d)} · ${booked} of ${n} trucks busy`, rows)} aria-label="${T.fmtKeyLong(u.d)}: ${booked} of ${n} vac trucks busy">
          <span class="uc-bar">${segs}${u.d === today ? `<span class="uc-cap" style="bottom:calc(${(booked / n) * 100}% + 4px)">${booked}</span>` : ''}</span>
          <span class="uc-x"><b>${dow}</b>${k.d}</span>
        </a>`;
    }).join('');

    // 2. Service spend, last 12 months
    const nowP = T.parts(Date.now());
    const months = Array.from({ length: 12 }, (_, i) => {
      const dt = new Date(Date.UTC(nowP.year, nowP.month - 1 - (11 - i), 1));
      return { key: dt.toISOString().slice(0, 7), y: dt.getUTCFullYear(), m: dt.getUTCMonth() };
    });
    const services = AD.store.all('services');
    months.forEach((mo) => {
      const list = services.filter((s) => s.date.slice(0, 7) === mo.key);
      mo.cost = list.reduce((sum, s) => sum + Number(s.cost || 0), 0);
      mo.count = list.length;
    });
    const spendTotal = months.reduce((s, mo) => s + mo.cost, 0);
    const maxSpend = Math.max(...months.map((mo) => mo.cost), 1);
    const step = maxSpend > 8000 ? 4000 : maxSpend > 4000 ? 2000 : 1000;
    const spendTop = Math.ceil(maxSpend / step) * step;
    const peak = months.reduce((a, b) => (b.cost > a.cost ? b : a), months[0]);
    const MON = T.MONTHS.map((x) => x.slice(0, 3));
    const spendCols = months.map((mo) => `
      <a class="uc-col" href="#/maintenance" ${V.tipAttr(`${T.MONTHS[mo.m]} ${mo.y}`, [['Service spend', aud0(mo.cost), 'var(--viz-confirmed)'], ['Services', String(mo.count), '']])}
         aria-label="${T.MONTHS[mo.m]} ${mo.y}: ${aud0(mo.cost)} across ${mo.count} services">
        <span class="uc-bar">${mo.cost ? `<i style="height:${(mo.cost / spendTop) * 100}%;background:var(--viz-confirmed)"></i>` : ''}${mo === peak && mo.cost ? `<span class="uc-cap" style="bottom:calc(${(mo.cost / spendTop) * 100}% + 4px)">${aud0(mo.cost)}</span>` : ''}</span>
        <span class="uc-x"><b>${MON[mo.m]}</b>${mo.m === 0 || mo === months[0] ? String(mo.y).slice(2) : '&nbsp;'}</span>
      </a>`).join('');

    // 3. Open defects by priority (direct labels; severity colours always with text)
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

    const busyToday = n - util[0].c.free;
    return `
      <section class="section">
        ${sectionHead({ title: 'Fleet charts', meta: 'Bookings for the next 14 days, costs for the last 12 months' })}
        <div class="insights">
          <figure class="viz-card viz-wide">
            <figcaption><h3>Vac truck utilisation</h3><span class="viz-sub">Trucks busy each day, next 14 days · ${busyToday} of ${n} today</span></figcaption>
            ${V.legend(totals, { counts: false })}
            <div class="uc" style="--rows:${n}">
              <div class="uc-axis" aria-hidden="true"><span style="bottom:100%">${n}</span><span style="bottom:50%">${n / 2}</span><span style="bottom:0">0</span></div>
              <div class="uc-plot"><div class="uc-grid" aria-hidden="true"><i style="bottom:100%"></i><i style="bottom:50%"></i><i style="bottom:0"></i></div><div class="uc-cols">${utilCols}</div></div>
            </div>
            ${V.table(['Date', 'Confirmed', 'Tentative', 'Depot', 'Maintenance', 'Free'], util.map((u) => [T.fmtKeyLong(u.d), u.c.confirmed, u.c.tentative, u.c.depot, u.c.maintenance, u.c.free].map(String)))}
          </figure>

          <figure class="viz-card">
            <figcaption><h3>Open defects by priority</h3><span class="viz-sub">${priParts.reduce((s, p) => s + p.value, 0)} open · select a bar to filter</span></figcaption>
            <div class="hb">${priRows}</div>
            ${V.table(['Priority', 'Open defects'], priParts.map((p) => [p.label, String(p.value)]))}
          </figure>

          <figure class="viz-card viz-wide">
            <figcaption><h3>Service spend</h3><span class="viz-sub">Recorded services, last 12 months · ${aud0(spendTotal)} total</span></figcaption>
            <div class="uc uc-money">
              <div class="uc-axis" aria-hidden="true"><span style="bottom:100%">${aud0(spendTop)}</span><span style="bottom:50%">${aud0(spendTop / 2)}</span><span style="bottom:0">$0</span></div>
              <div class="uc-plot"><div class="uc-grid" aria-hidden="true"><i style="bottom:100%"></i><i style="bottom:50%"></i><i style="bottom:0"></i></div><div class="uc-cols">${spendCols}</div></div>
            </div>
            ${V.table(['Month', 'Spend (AUD)', 'Services'], months.map((mo) => [`${T.MONTHS[mo.m]} ${mo.y}`, aud0(mo.cost), String(mo.count)]))}
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
            <th class="col-opt col-attn" style="width:170px">Needs attention</th>
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
