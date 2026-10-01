/* Maintenance + record-service form */
AD.views = AD.views || {};

AD.SERVICE_TYPES = ['Scheduled service', 'Major service', 'Major service + vac pump overhaul', 'Repair', 'Tyres', 'Safety inspection'];

AD.serviceForm = function (vehicleId) {
  const { esc, options, formData, showErrors, modal, toast } = AD.ui;
  const T = AD.time, L = AD.logic;
  const vehicles = AD.store.all('vehicles').filter((v) => !v.hired).slice().sort((a, b) => a.id.localeCompare(b.id));
  const today = T.todayKey();

  let map = null;
  modal({
    wide: true,
    title: 'Record completed service',
    onClose: () => { if (map) { map.remove(); map = null; } },
    body: `
      <form class="form-grid" novalidate>
        <div class="field full"><label>Vehicle <span class="req">*</span></label>
          <select name="vehicleId">${options(vehicles.map((v) => [v.id, `${v.id} · ${v.rego} · ${v.make} ${v.model.split(' —')[0]}`]), vehicleId, 'Select a vehicle')}</select></div>
        <div class="field"><label>Service date <span class="req">*</span></label><input type="date" name="date" value="${today}" max="${today}"></div>
        <div class="field"><label>Odometer at service (km) <span class="req">*</span></label><input type="number" name="odometer" min="0" step="1"></div>
        <div class="field"><label>Service type</label><select name="type">${options(AD.SERVICE_TYPES, 'Scheduled service')}</select></div>
        <div class="field"><label>Workshop</label>
          <select name="workshopSel" id="svc-wk"></select>
          <input type="text" name="workshopOther" id="svc-wk-other" placeholder="Workshop name" class="hide" style="margin-top:6px">
        </div>
        <div class="field full">
          <div class="pick-map-wrap" style="position:relative"><div class="pick-map" id="svc-map"></div></div>
          <p class="help" id="svc-map-help">Pins are workshops for this vehicle's category. Click one to select it.</p>
        </div>
        <div class="field"><label>Cost (AUD, inc. GST)</label><input type="number" name="cost" min="0" step="0.01" placeholder="0.00"></div>
        <div class="field"><label>&nbsp;</label><div class="help" id="svc-hint"></div></div>
        <div class="field"><label>Next service date <span class="req">*</span></label><input type="date" name="nextServiceDate"></div>
        <div class="field"><label>Next service odometer (km) <span class="req">*</span></label><input type="number" name="nextServiceKm" min="0" step="1"></div>
        <div class="field full"><label>Notes</label><textarea name="notes" rows="2" placeholder="Work carried out, parts replaced…"></textarea></div>
        <div class="field full hide" id="ret-wrap"><label class="check"><input type="checkbox" name="returnAvail" checked> Set vehicle status back to <b>Available</b> (currently In workshop)</label></div>
      </form>
      <div class="form-actions">
        <button class="btn btn-ghost" data-close type="button">Cancel</button>
        <button class="btn btn-primary" data-save type="button">Save service record</button>
      </div>`,
    onMount(el, close) {
      const f = el.querySelector('form');
      el.querySelector('[data-close]').onclick = close;

      const mapEl = el.querySelector('#svc-map');
      map = AD.maps.create(mapEl, mapEl.parentElement, { scrollWheelZoom: true });
      setTimeout(() => map && map.invalidateSize(), 60);
      let wsMarkers = [];

      function wsPinIcon(sel, occupied) {
        const size = sel ? 34 : 28;
        const color = sel ? '#2f9e6e' : '#3b7dc9';
        return window.L.divIcon({
          className: 'wk-pin',
          html: `<div class="wk-pin-inner">
            <svg viewBox="0 0 24 24" width="${size}" height="${size}"><path d="M12 22s-7-6.4-7-12a7 7 0 0 1 14 0c0 5.6-7 12-7 12z" fill="${color}" stroke="#fff" stroke-width="1.5"/><circle cx="12" cy="10" r="3" fill="#fff"/></svg>
            ${occupied ? `<span class="wk-pin-badge">${occupied}</span>` : ''}
          </div>`,
          iconSize: [size, size], iconAnchor: [size / 2, size - 1]
        });
      }

      function drawWorkshopMap() {
        if (!map) return;
        wsMarkers.forEach((m) => map.removeLayer(m));
        wsMarkers = [];
        const v = AD.store.get('vehicles', f.vehicleId.value);
        const shops = v ? L.workshopsFor(v.type) : [];
        const pts = [];
        shops.forEach((w) => {
          if (w.lat == null) return;
          const here = L.atWorkshop(w.id);
          const sel = f.workshopSel.value === w.id;
          const m = window.L.marker([w.lat, w.lng], { icon: wsPinIcon(sel, here.length) });
          m.bindTooltip(`<b>${esc(w.name)}</b>${here.length ? `<br>${here.length} here now: ${here.map((x) => esc(x.id)).join(', ')}` : ''}`, { direction: 'top', offset: [0, sel ? -32 : -26], className: 'tm-tip' });
          m.on('click', () => {
            f.workshopSel.value = w.id;
            f.workshopSel.dispatchEvent(new Event('change', { bubbles: true }));
          });
          m.addTo(map);
          wsMarkers.push(m);
          pts.push([w.lat, w.lng]);
        });
        if (pts.length === 1) map.setView(pts[0], 11, { animate: false });
        else if (pts.length) map.fitBounds(pts, { padding: [50, 50], maxZoom: 11, animate: false });
        else map.fitBounds(AD.maps.AU_BOUNDS, { animate: false });
      }
      const toggleWkOther = () => el.querySelector('#svc-wk-other').classList.toggle('hide', f.workshopSel.value !== 'other');
      function updateMapHelp() {
        const help = el.querySelector('#svc-map-help');
        const v = AD.store.get('vehicles', f.vehicleId.value);
        if (!v) { help.textContent = 'Select a vehicle to see relevant workshops on the map.'; return; }
        const wid = f.workshopSel.value;
        if (wid && wid !== 'other') {
          const w = AD.store.get('workshops', wid);
          const here = w ? L.atWorkshop(w.id).filter((x) => x.id !== v.id) : [];
          help.innerHTML = w ? `Selected <b>${esc(w.name)}</b>${here.length ? ` — also here: ${here.map((x) => esc(x.id)).join(', ')}` : ''}` : '';
        } else {
          help.textContent = 'Pins are workshops for this vehicle’s category. Click one to select it.';
        }
      }
      const fill = () => {
        const v = AD.store.get('vehicles', f.vehicleId.value);
        el.querySelector('#ret-wrap').classList.toggle('hide', !(v && v.status === 'In workshop'));
        if (!v) {
          el.querySelector('#svc-hint').textContent = '';
          f.workshopSel.innerHTML = options([['other', 'Other / not listed']], '', 'Select a vehicle first');
          toggleWkOther();
          drawWorkshopMap();
          updateMapHelp();
          return;
        }
        f.odometer.value = v.odometer;
        const d = f.date.value || today;
        const { y, m, d: dd } = T.parseKey(d);
        const next = new Date(Date.UTC(y, m - 1 + (v.serviceIntervalMonths || 6), dd));
        f.nextServiceDate.value = next.toISOString().slice(0, 10);
        f.nextServiceKm.value = v.odometer + (v.serviceIntervalKm || 10000);
        el.querySelector('#svc-hint').textContent = `Interval: every ${(v.serviceIntervalKm || 10000).toLocaleString('en-AU')} km or ${v.serviceIntervalMonths || 6} months. Current odometer ${L.fmtKm(v.odometer)}.`;
        const shops = L.workshopsFor(v.type);
        // Preserve the vehicle's current workshop selection when the form opens for a vehicle already in the shop.
        const preferred = f.workshopSel.value || (v.workshopId && shops.some((s) => s.id === v.workshopId) ? v.workshopId : '');
        f.workshopSel.innerHTML = options(shops.map((w) => [w.id, w.name]).concat([['other', 'Other / not listed']]), preferred, shops.length ? 'Select a workshop' : undefined);
        toggleWkOther();
        drawWorkshopMap();
        updateMapHelp();
      };
      f.vehicleId.addEventListener('change', fill);
      f.workshopSel.addEventListener('change', () => { toggleWkOther(); drawWorkshopMap(); updateMapHelp(); });
      f.odometer.addEventListener('input', () => {
        const v = AD.store.get('vehicles', f.vehicleId.value);
        if (v && f.odometer.value) f.nextServiceKm.value = Number(f.odometer.value) + (v.serviceIntervalKm || 10000);
      });
      fill();

      const saveBtn = el.querySelector('[data-save]');
      saveBtn.onclick = async () => {
        const d = formData(f);
        const v = AD.store.get('vehicles', d.vehicleId);
        const err = {};
        if (!v) err.vehicleId = 'Choose a vehicle.';
        if (!d.date) err.date = 'Enter the service date.';
        else if (d.date > today) err.date = 'A completed service can’t be in the future.';
        const odo = Number(d.odometer);
        if (d.odometer === '' || !(odo >= 0)) err.odometer = 'Enter the odometer reading.';
        else if (v && v.lastServiceKm && odo < v.lastServiceKm) err.odometer = `Lower than the last service (${L.fmtKm(v.lastServiceKm)}).`;
        if (!d.nextServiceDate) err.nextServiceDate = 'Enter the next service date.';
        else if (d.date && d.nextServiceDate <= d.date) err.nextServiceDate = 'Must be after the service date.';
        if (d.nextServiceKm === '' || !(Number(d.nextServiceKm) > odo)) err.nextServiceKm = 'Must be higher than the service odometer.';
        if (d.cost !== '' && !(Number(d.cost) >= 0)) err.cost = 'Enter a valid amount.';
        if (!showErrors(f, err)) return;

        const workshopName = d.workshopSel === 'other' ? d.workshopOther
          : d.workshopSel ? ((AD.store.get('workshops', d.workshopSel) || {}).name || '') : '';

        saveBtn.disabled = true;
        try {
          await AD.store.insert('services', {
            vehicleId: v.id, date: d.date, odometer: Math.round(odo), type: d.type,
            workshop: workshopName, cost: d.cost === '' ? 0 : Number(d.cost), notes: d.notes
          }, 'svc');
          const patch = { lastServiceDate: d.date, lastServiceKm: Math.round(odo), nextServiceDate: d.nextServiceDate, nextServiceKm: Math.round(Number(d.nextServiceKm)) };
          if (odo > v.odometer) patch.odometer = Math.round(odo);
          if (v.status === 'In workshop' && d.returnAvail) patch.status = 'Available';
          await AD.store.update('vehicles', v.id, patch);
          await AD.store.log(`Service recorded for ${v.id} at ${L.fmtKm(odo)} — next due ${T.fmtKey(d.nextServiceDate)}`, v.id);
        } catch (err2) {
          saveBtn.disabled = false;
          toast('Could not save service record: ' + err2.message, 'error');
          return;
        }
        toast(`Service recorded for ${v.id}`);
        close();
      };
    }
  });
};

AD.views.maintenance = (function () {
  const { esc, stateBadge, bookingBadge, pageHeader, sectionHead, dash } = AD.ui;
  const L = AD.logic, T = AD.time, I = AD.icons;
  let root = null, filter = 'due';

  function render(el, params) {
    root = el;
    filter = params.filter || 'due';
    draw();
  }

  function draw() {
    const el = root;
    // Owned fleet only — hired vehicles are serviced by their hire company, not us.
    const all = AD.store.all('vehicles').filter((v) => !v.hired).map((v) => ({ v, s: L.serviceState(v) }));
    const order = { overdue: 0, soon: 1, ok: 2 };
    all.sort((a, b) => order[a.s.state] - order[b.s.state] || a.s.daysLeft - b.s.daysLeft);
    const overdue = all.filter((x) => x.s.state === 'overdue');
    const soon = all.filter((x) => x.s.state === 'soon');
    const list = filter === 'overdue' ? overdue : filter === 'due' ? overdue.concat(soon) : all;
    const now = Date.now();
    const blocks = AD.store.all('bookings').filter((b) => b.kind === 'maintenance' && b.status !== 'cancelled' && Date.parse(b.end) > now).sort((a, b) => a.start.localeCompare(b.start));
    const recent = AD.store.all('services').slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
    const late = (text) => `<span class="flag flag-red">${text}</span>`;
    const startsIn = (b) => {
      if (Date.parse(b.start) <= now) return 'Now';
      const d = T.daysBetween(T.todayKey(), T.dateKey(b.start));
      return d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `In ${d} days`;
    };

    el.innerHTML = `
      ${pageHeader({
        title: 'Maintenance',
        sub: `Due means within ${L.SOON_DAYS} days or ${L.SOON_KM.toLocaleString('en-AU')} km of the next service`,
        actions: `<button class="btn btn-primary" id="rec">${I.plus} Record completed service</button>`
      })}

      <section class="section">
        ${sectionHead({
          title: 'Servicing',
          meta: `${overdue.length ? `<span class="flag flag-red">${overdue.length} overdue</span> · ` : ''}${soon.length} due soon`,
          actions: `<div class="seg" role="group" aria-label="Filter">
            <button data-f="due" class="${filter === 'due' ? 'on' : ''}">Due &amp; overdue (${overdue.length + soon.length})</button>
            <button data-f="overdue" class="${filter === 'overdue' ? 'on' : ''}">Overdue (${overdue.length})</button>
            <button data-f="all" class="${filter === 'all' ? 'on' : ''}">All (${all.length})</button>
          </div>`
        })}
        <div class="table-wrap"><table class="data">
          <thead><tr><th style="width:110px">Vehicle</th><th class="col-opt">Last service</th><th>Next service</th><th class="num col-opt">Next at</th><th class="num">Remaining</th><th>Status</th><th class="col-action col-opt"><span class="hide">Action</span></th></tr></thead>
          <tbody>
          ${list.map(({ v, s }) => `<tr>
            <td><a class="id" href="#/vehicle/${v.id}">${esc(v.id)}</a><span class="t2">${esc(v.type)}</span></td>
            <td class="nowrap col-opt">${v.lastServiceDate ? T.fmtKey(v.lastServiceDate) : dash}<span class="t2">${v.lastServiceKm ? L.fmtKm(v.lastServiceKm) : ''}</span></td>
            <td class="nowrap">${T.fmtKey(v.nextServiceDate)}</td>
            <td class="num col-opt">${L.fmtKm(v.nextServiceKm)}<span class="t2">now ${L.fmtKm(v.odometer)}</span></td>
            <td class="num">${s.daysLeft < 0 ? late(`${-s.daysLeft} days late`) : `${s.daysLeft} days`}<span class="t2">${s.kmLeft < 0 ? late(`${L.fmtKm(-s.kmLeft)} over`) : L.fmtKm(s.kmLeft)}</span></td>
            <td>${s.state === 'ok' ? AD.ui.badge('Not due', 'green muted') : AD.ui.badge(s.label, L.attentionTone(s.state, s.daysLeft, s.kmLeft) || 'ink')}</td>
            <td class="col-action col-opt"><button class="btn btn-link" data-rec="${v.id}">Record service</button></td>
          </tr>`).join('') || '<tr><td colspan="7" class="empty">Nothing in this list.</td></tr>'}
          </tbody></table></div>
      </section>

      <div class="cols-2">
        <section class="section">
          ${sectionHead({ title: 'Workshop blocks', meta: 'Vac truck maintenance from the Calendar', actions: `<a class="btn btn-sm btn-secondary" href="#/calendar?new=1&kind=maintenance">${I.plus} Book workshop time</a>` })}
          ${blocks.length ? `<ul class="rows">${blocks.map((b) => `<li class="link" data-open="${b.id}">
            <span class="id">${esc(b.truckId)}</span>
            <span class="what">${esc(L.bookingTitle(b))}<span class="t2">${T.fmtDateTime(b.start)} → ${T.fmtDateTime(b.end)}</span></span>
            <span class="when">${startsIn(b)}</span></li>`).join('')}</ul>`
            : '<p class="empty">No upcoming workshop blocks.</p>'}
        </section>
        <section class="section">
          ${sectionHead({ title: 'Recently recorded services' })}
          <ul class="rows">${recent.map((x) => `<li class="link" data-veh="${x.vehicleId}">
            <span class="id">${esc(x.vehicleId)}</span>
            <span class="what">${esc(x.type)}<span class="t2">${T.fmtKey(x.date)} · ${L.fmtKm(x.odometer)} · ${esc(x.workshop || 'Workshop not recorded')}</span></span>
            <span class="when">${L.fmtAUD(x.cost)}</span></li>`).join('')}</ul>
        </section>
      </div>`;

    el.querySelector('#rec').onclick = () => AD.serviceForm('');
    el.querySelectorAll('[data-rec]').forEach((b) => (b.onclick = () => AD.serviceForm(b.dataset.rec)));
    el.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { filter = b.dataset.f; AD.setParams({ filter }); draw(); }));
    el.querySelectorAll('[data-veh]').forEach((b) => (b.onclick = () => AD.go('vehicle/' + b.dataset.veh)));
    el.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => {
      const bk = AD.store.get('bookings', b.dataset.open);
      AD.go('calendar', { view: 'day', date: T.dateKey(bk.start), open: bk.id });
    }));
  }

  return { title: 'Maintenance', render, refresh: () => root && draw() };
})();
