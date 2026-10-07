/* Calendar: day (timeline), week (one row per truck) and month views */
AD.views = AD.views || {};

AD.views.calendar = (function () {
  const { esc, options } = AD.ui;
  const L = AD.logic, T = AD.time, I = AD.icons;
  let root = null;
  let st = { view: 'week', date: '', truck: '' };

  function render(el, params) {
    root = el;
    st = { view: ['day', 'week', 'month'].includes(params.view) ? params.view : 'week', date: /^\d{4}-\d{2}-\d{2}$/.test(params.date || '') ? params.date : T.todayKey(), truck: params.truck || '' };
    draw();
    if (params.new) {
      AD.setParams({ view: st.view, date: st.date, truck: st.truck });
      AD.bookingForm(null, { truckId: params.truck || '', date: params.date || T.todayKey(), kind: params.kind || 'job' });
    } else if (params.open) {
      AD.setParams({ view: st.view, date: st.date, truck: st.truck });
      const b = AD.store.get('bookings', params.open);
      if (b) AD.bookingForm(b);
    }
  }

  function save() { AD.setParams(st); }

  function range() {
    if (st.view === 'day') return [st.date, st.date];
    if (st.view === 'week') { const s = T.addDays(st.date, -T.dayOfWeek(st.date)); return [s, T.addDays(s, 6)]; }
    const { y, m } = T.parseKey(st.date);
    const first = `${y}-${T.pad(m)}-01`;
    const s = T.addDays(first, -T.dayOfWeek(first));
    return [s, T.addDays(s, 41)];
  }

  function title() {
    const [s, e] = range();
    if (st.view === 'day') return T.fmtKeyLong(st.date);
    if (st.view === 'week') return `${T.fmtKey(s)} – ${T.fmtKey(e)}`;
    const { y, m } = T.parseKey(st.date);
    return `${T.MONTHS[m - 1]} ${y}`;
  }

  function step(dir) {
    if (st.view === 'day') st.date = T.addDays(st.date, dir);
    else if (st.view === 'week') st.date = T.addDays(st.date, 7 * dir);
    else { const { y, m } = T.parseKey(st.date); const d = new Date(Date.UTC(y, m - 1 + dir, 1)); st.date = d.toISOString().slice(0, 10); }
    save(); draw();
  }

  function draw() {
    const el = root;
    const trucks = L.vacTrucks();
    el.innerHTML = `
      ${AD.ui.pageHeader({
        title: 'Calendar',
        sub: `${trucks.length} vac trucks · Times in Australia/Sydney (${T.abbr(T.startOfDay(st.date) + 12 * 3600000)} on the selected date)`,
        actions: `<a class="btn btn-secondary" href="#/tracker?date=${st.date}">${I.map} View on Tracker</a>
                  <button class="btn btn-primary" id="new-bk">${I.plus} New booking</button>`
      })}
      <div class="cal-bar">
        <div class="seg" role="group" aria-label="Move">
          <button id="prev" aria-label="Previous ${st.view}">${I.chevL}</button>
          <button id="today">Today</button>
          <button id="next" aria-label="Next ${st.view}">${I.chevR}</button>
        </div>
        <h2 aria-live="polite">${esc(title())}</h2>
        <div class="right">
          <input type="date" id="jump" value="${st.date}" aria-label="Go to date">
          <select id="truck" aria-label="Truck">${options(trucks.map((v) => v.id), st.truck, 'All trucks')}</select>
          <div class="seg" role="group" aria-label="View">${['day', 'week', 'month'].map((v) => `<button data-view="${v}" class="${st.view === v ? 'on' : ''}" aria-pressed="${st.view === v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div>
        </div>
      </div>
      <div class="legend">
        <span><i class="sw-confirmed"></i>Confirmed</span><span><i class="sw-tentative"></i>Tentative</span>
        <span><i class="sw-maintenance"></i>Maintenance (unavailable)</span><span><i class="sw-depot"></i>Depot assignment</span>
        <span><i class="sw-cancelled"></i>Cancelled</span><span><i class="sw-conflict"></i>Clash</span>
        <span class="hint">${st.view === 'month' ? 'Click a day to open it' : 'Click an empty slot to add a booking'}</span>
      </div>
      <div id="cal-body"></div>`;

    el.querySelector('#prev').onclick = () => step(-1);
    el.querySelector('#next').onclick = () => step(1);
    el.querySelector('#today').onclick = () => { st.date = T.todayKey(); save(); draw(); };
    el.querySelector('#jump').onchange = (e) => { if (e.target.value) { st.date = e.target.value; save(); draw(); } };
    el.querySelector('#truck').onchange = (e) => { st.truck = e.target.value; save(); draw(); };
    el.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => { st.view = b.dataset.view; save(); draw(); }));
    el.querySelector('#new-bk').onclick = () => AD.bookingForm(null, { truckId: st.truck, date: st.date });

    const body = el.querySelector('#cal-body');
    const shown = st.truck ? trucks.filter((v) => v.id === st.truck) : trucks;
    const clashes = L.conflictIds();
    if (st.view === 'week') week(body, shown, clashes);
    else if (st.view === 'day') day(body, shown, clashes);
    else month(body, clashes);

    body.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-bk]');
      if (chip) { e.stopPropagation(); AD.bookingForm(AD.store.get('bookings', chip.dataset.bk)); return; }
      // Status chip is an <a>; let it navigate, just block the slot handler.
      if (e.target.closest('[data-status]')) { e.stopPropagation(); return; }
      const more = e.target.closest('[data-day]');
      if (more && st.view === 'month') { st.date = more.dataset.day; st.view = 'day'; save(); draw(); return; }
      const slot = e.target.closest('[data-slot]');
      if (slot) {
        const [truckId, date, hour] = slot.dataset.slot.split('|');
        let h = hour ? Number(hour) : 7;
        if (slot.classList.contains('lane')) {
          const r = slot.getBoundingClientRect();
          const ds = T.startOfDay(date), de = T.startOfDay(T.addDays(date, 1));
          h = Math.min(22, T.parts(ds + ((e.clientX - r.left) / r.width) * (de - ds)).hour);
        }
        AD.bookingForm(null, { truckId, date, hour: h });
      }
    });
  }

  const inDay = (b, key) => Date.parse(b.start) < T.startOfDay(T.addDays(key, 1)) && Date.parse(b.end) > T.startOfDay(key);
  const visible = (b) => !st.truck || b.truckId === st.truck;

  function chipTimes(b, key) {
    const s = Date.parse(b.start), e = Date.parse(b.end);
    const ds = T.startOfDay(key), de = T.startOfDay(T.addDays(key, 1));
    const a = s >= ds ? T.fmtTime(s) : '←';
    const z = e <= de ? T.fmtTime(e) : '→';
    return s < ds && e > de ? 'All day' : `${a}–${z}`;
  }

  function chip(b, key, clashes, compact) {
    const cat = L.bookingCategory(b);
    const clash = clashes.has(b.id);
    const site = b.siteId ? (AD.store.get('sites', b.siteId) || {}).name : L.hasCoords(b) ? 'Pinned site' : 'Site location required';
    const tip = `${b.truckId} · ${L.bookingTitle(b)}\n${T.fmtDateTime(b.start)} – ${T.fmtDateTime(b.end)}\n${AD.ui.BOOKING_LABEL[cat]}${clash ? ' · CLASH' : ''}\n${b.address || site}`;
    const warn = clash ? '<span class="warn">!</span>' : '';
    if (compact) return `<button class="chip ${cat} ${clash ? 'conflict' : ''}" data-bk="${b.id}" title="${esc(tip)}">${warn}<b>${b.truckId}</b> ${esc(L.bookingTitle(b))}</button>`;
    return `<button class="chip ${cat} ${clash ? 'conflict' : ''}" data-bk="${b.id}" title="${esc(tip)}">${warn}<b>${chipTimes(b, key)}</b> ${esc(L.bookingTitle(b))}<span class="t2">${esc(site)}</span></button>`;
  }

  // Non-booking chip for a vac truck that is currently In workshop / Out of service.
  // Shown on today's cell when no maintenance booking already covers today.
  function statusChip(v) {
    const ws = v.workshopId ? (AD.store.get('workshops', v.workshopId) || {}).name : '';
    const label = v.status === 'In workshop' ? 'In workshop' : 'Out of service';
    const tip = `${v.id} · ${v.status}${ws ? ' · at ' + ws : ''}\nOpen vehicle profile`;
    return `<a class="chip maintenance status-chip" data-status="${v.id}" href="#/vehicle/${v.id}?tab=overview" title="${esc(tip)}"><b>${esc(label)}</b>${ws ? `<span class="t2">${esc(ws)}</span>` : ''}</a>`;
  }
  const needsStatusChip = (v, bookingsToday) =>
    (v.status === 'In workshop' || v.status === 'Out of service') &&
    !bookingsToday.some((b) => b.kind === 'maintenance' && b.status !== 'cancelled');

  function week(body, trucks, clashes) {
    const [s] = range();
    const days = Array.from({ length: 7 }, (_, i) => T.addDays(s, i));
    const today = T.todayKey();
    const all = AD.store.all('bookings');
    body.innerHTML = `<div class="sched"><table>
      <thead><tr><th class="truck">Truck</th>${days.map((d) => `<th class="${d === today ? 'today' : ''}">${T.DOW[T.dayOfWeek(d)]} ${T.fmtKey(d).slice(0, 5)}</th>`).join('')}</tr></thead>
      <tbody>${trucks.map((v) => `<tr>
        <th class="truck"><a href="#/vehicle/${v.id}?tab=bookings">${v.id}</a><span class="t2">${v.driverId ? esc(L.driverName(v.driverId)) : 'No assigned driver'}</span>${v.status === 'In workshop' || v.status === 'Out of service' ? `<span class="t2">${esc(v.status)}</span>` : ''}</th>
        ${days.map((d) => {
          const list = all.filter((b) => b.truckId === v.id && inDay(b, d)).sort((a, b) => a.start.localeCompare(b.start));
          const hasClash = list.some((b) => clashes.has(b.id) && list.some((o) => o !== b && clashes.has(o.id) && Date.parse(o.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(o.end)));
          const sChip = (d === today && needsStatusChip(v, list)) ? statusChip(v) : '';
          return `<td class="${d === today ? 'today' : ''} ${T.dayOfWeek(d) >= 5 ? 'weekend' : ''} ${hasClash ? 'clash-cell' : ''}" data-slot="${v.id}|${d}|7" title="Add booking for ${v.id} on ${T.fmtKey(d)}">${sChip}${list.map((b) => chip(b, d, clashes)).join('')}</td>`;
        }).join('')}
      </tr>`).join('')}</tbody></table></div>`;
  }

  function day(body, trucks, clashes) {
    const key = st.date;
    const ds = T.startOfDay(key), de = T.startOfDay(T.addDays(key, 1));
    const span = de - ds;
    const pct = (ms) => ((Math.min(Math.max(ms, ds), de) - ds) / span) * 100;
    const { y, m, d } = T.parseKey(key);
    const hours = [];
    for (let h = 0; h < 24; h++) hours.push({ h, p: pct(T.fromParts(y, m, d, h, 0)) });
    const all = AD.store.all('bookings');
    const now = Date.now();

    const rows = trucks.map((v) => {
      const list = all.filter((b) => b.truckId === v.id && inDay(b, key)).sort((a, b) => a.start.localeCompare(b.start));
      // assign lanes so overlapping bookings are visible side by side
      const lanesEnd = [];
      const placed = list.map((b) => {
        const s = Date.parse(b.start), e = Date.parse(b.end);
        let lane = lanesEnd.findIndex((end) => end <= s);
        if (lane < 0) { lane = lanesEnd.length; lanesEnd.push(e); } else lanesEnd[lane] = e;
        return { b, lane };
      });
      const n = Math.max(1, lanesEnd.length);
      const rowH = n === 1 ? 64 : 12 + n * 40;
      const showStatus = key === T.todayKey() && needsStatusChip(v, list);
      const statusLabel = showStatus ? `<span class="t2">${esc(v.status)}${v.workshopId ? ' · ' + esc(((AD.store.get('workshops', v.workshopId) || {}).name) || '') : ''}</span>` : '';
      const ws = showStatus && v.workshopId ? (AD.store.get('workshops', v.workshopId) || {}).name || '' : '';
      const dayStatusBar = showStatus
        ? `<a class="tl-bar chip maintenance status-chip" data-status="${v.id}" href="#/vehicle/${v.id}?tab=overview" style="left:0;width:100%;top:7px;height:${rowH - 14}px" title="${esc(v.id + ' · ' + v.status + (ws ? ' · at ' + ws : '') + '\nOpen vehicle profile')}"><b>${esc(v.status)}</b>${ws ? `<span class="t2">${esc(ws)}</span>` : ''}</a>`
        : '';
      return `<div class="tl-row" style="min-height:${rowH}px">
        <div class="who"><a href="#/vehicle/${v.id}?tab=bookings">${v.id}</a><span class="t2">${v.driverId ? esc(L.driverName(v.driverId)) : 'No assigned driver'}</span>${statusLabel}</div>
        <div class="lane" data-slot="${v.id}|${key}|" title="Click to add a booking for ${v.id}">
          ${hours.map((x) => `<div class="tl-grid" style="left:${x.p}%"></div>`).join('')}
          ${dayStatusBar}
          ${placed.map(({ b, lane }) => {
            const s = Date.parse(b.start), e = Date.parse(b.end);
            const left = pct(s), width = Math.max(pct(e) - left, 0.6);
            const cat = L.bookingCategory(b);
            const top = n === 1 ? 7 : 6 + lane * 40, h = n === 1 ? rowH - 14 : 34;
            const site = b.siteId ? (AD.store.get('sites', b.siteId) || {}).name : L.hasCoords(b) ? 'Pinned site' : 'Site location required';
            return `<button class="tl-bar chip ${cat} ${clashes.has(b.id) ? 'conflict' : ''}" data-bk="${b.id}" style="left:${left}%;width:${width}%;top:${top}px;height:${h}px"
              title="${esc(`${L.bookingTitle(b)}\n${T.fmtDateTime(b.start)} – ${T.fmtDateTime(b.end)}\n${b.address || site}`)}">
              ${clashes.has(b.id) ? '<span class="warn">!</span>' : ''}<b>${chipTimes(b, key)}</b> ${esc(L.bookingTitle(b))}${n === 1 ? `<span class="t2">${esc(site)}</span>` : ''}</button>`;
          }).join('')}
          ${now >= ds && now < de ? `<div class="tl-now" style="left:${pct(now)}%"></div>` : ''}
        </div></div>`;
    }).join('');

    body.innerHTML = `<div class="timeline"><div class="tl">
      <div class="tl-row tl-head"><div class="who">${T.abbr(ds + 12 * 3600000)}</div><div class="lane">${hours.map((x) => `<div class="tl-hour" style="left:${x.p}%">${T.pad(x.h)}</div>`).join('')}</div></div>
      ${rows}
    </div></div>`;
  }

  function month(body, clashes) {
    const [s] = range();
    const { m } = T.parseKey(st.date);
    const today = T.todayKey();
    const all = AD.store.all('bookings').filter(visible).sort((a, b) => a.start.localeCompare(b.start) || a.truckId.localeCompare(b.truckId));
    const cells = Array.from({ length: 42 }, (_, i) => T.addDays(s, i));
    // Trucks currently in workshop / out of service with no maintenance booking covering today.
    const inShop = L.vacTrucks().filter((v) =>
      (!st.truck || v.id === st.truck) &&
      (v.status === 'In workshop' || v.status === 'Out of service') &&
      !all.some((b) => b.truckId === v.id && b.kind === 'maintenance' && b.status !== 'cancelled' && inDay(b, today))
    );
    const monthStatusChip = (v) => {
      const ws = v.workshopId ? (AD.store.get('workshops', v.workshopId) || {}).name || '' : '';
      const tip = `${v.id} · ${v.status}${ws ? ' · at ' + ws : ''}\nOpen vehicle profile`;
      return `<a class="chip maintenance status-chip" data-status="${v.id}" href="#/vehicle/${v.id}?tab=overview" title="${esc(tip)}"><b>${esc(v.id)}</b> ${esc(v.status)}</a>`;
    };
    body.innerHTML = `<div class="month">
      ${T.DOW.map((d) => `<div class="dow">${d}</div>`).join('')}
      ${cells.map((d) => {
        const list = all.filter((b) => inDay(b, d));
        const showStatus = d === today && inShop.length > 0;
        const extras = showStatus ? inShop.length : 0;
        const max = Math.max(1, 3 - Math.min(extras, 2));
        return `<div class="cell ${T.parseKey(d).m !== m ? 'out' : ''} ${d === today ? 'today' : ''}" data-day="${d}">
          <span class="num">${T.parseKey(d).d}</span>
          ${showStatus ? inShop.slice(0, 2).map(monthStatusChip).join('') : ''}
          ${showStatus && inShop.length > 2 ? `<div class="more">+${inShop.length - 2} in workshop</div>` : ''}
          ${list.slice(0, max).map((b) => chip(b, d, clashes, true)).join('')}
          ${list.length > max ? `<div class="more">+${list.length - max} more</div>` : ''}
        </div>`;
      }).join('')}
    </div>`;
  }

  return { title: 'Calendar', render, refresh: () => root && draw() };
})();
