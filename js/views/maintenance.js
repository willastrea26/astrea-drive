/* Maintenance + record-service form */
AD.views = AD.views || {};

AD.SERVICE_TYPES = ['Scheduled service', 'Major service', 'Major service + vac pump overhaul', 'Repair', 'Tyres', 'Safety inspection'];

/** Retry a write, dropping engine-hours columns if the vehicles/services
 *  migration (update-vehicles-engine-hours.sql) has not been run yet. */
async function stripUnknownVehicleColumns(fn, patch) {
  const extras = ['engineHours', 'lastServiceHours', 'nextServiceHours', 'serviceIntervalHours', 'trackByDate', 'trackByKm', 'trackByHours'];
  try { return await fn(patch); }
  catch (e) {
    const msg = String((e && (e.message || e.details || e.hint)) || e);
    if (!/pgrst204|42703|schema cache|could not find/i.test(msg)) throw e;
    const stripped = Object.assign({}, patch);
    extras.forEach((k) => delete stripped[k]);
    return fn(stripped);
  }
}
async function stripUnknownServiceColumns(fn, row) {
  try { return await fn(row); }
  catch (e) {
    const msg = String((e && (e.message || e.details || e.hint)) || e);
    if (!/pgrst204|42703|schema cache|could not find/i.test(msg)) throw e;
    const stripped = Object.assign({}, row); delete stripped.hours;
    return fn(stripped);
  }
}

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
        <div class="field"><label>Engine hours at service</label><input type="number" name="hours" min="0" step="0.1" placeholder="e.g. 1250"><div class="help" id="svc-hours-hint">Required for vehicles that notify by hours.</div></div>
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
        <div class="field"><label>Next service date</label><input type="date" name="nextServiceDate"><div class="help" id="svc-next-date-hint"></div></div>
        <div class="field"><label>Next service odometer (km)</label><input type="number" name="nextServiceKm" min="0" step="1"><div class="help" id="svc-next-km-hint"></div></div>
        <div class="field"><label>Next service hours</label><input type="number" name="nextServiceHours" min="0" step="0.1"><div class="help" id="svc-next-hr-hint"></div></div>
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
      const toggleTriggerHints = (v) => {
        const tr = v ? L.serviceTriggers(v) : { date: true, km: true, hours: false };
        el.querySelector('#svc-hours-hint').textContent = tr.hours ? 'Required — this vehicle notifies by engine hours.' : 'Optional — this vehicle does not notify by hours.';
        el.querySelector('#svc-next-date-hint').textContent = tr.date ? 'Required — Date trigger is on.' : 'Not watched for this vehicle.';
        el.querySelector('#svc-next-km-hint').textContent = tr.km ? 'Required — Km trigger is on.' : 'Not watched for this vehicle.';
        el.querySelector('#svc-next-hr-hint').textContent = tr.hours ? 'Required — Hours trigger is on.' : 'Not watched for this vehicle.';
      };

      const fill = () => {
        const v = AD.store.get('vehicles', f.vehicleId.value);
        el.querySelector('#ret-wrap').classList.toggle('hide', !(v && v.status === 'In workshop'));
        if (!v) {
          el.querySelector('#svc-hint').textContent = '';
          f.workshopSel.innerHTML = options([['other', 'Other / not listed']], '', 'Select a vehicle first');
          toggleWkOther();
          drawWorkshopMap();
          updateMapHelp();
          toggleTriggerHints(null);
          return;
        }
        const tr = L.serviceTriggers(v);
        toggleTriggerHints(v);
        f.odometer.value = v.odometer;
        f.hours.value = v.engineHours != null && v.engineHours !== '' ? v.engineHours : '';
        const d = f.date.value || today;
        const { y, m, d: dd } = T.parseKey(d);
        const next = new Date(Date.UTC(y, m - 1 + (v.serviceIntervalMonths || 6), dd));
        f.nextServiceDate.value = next.toISOString().slice(0, 10);
        f.nextServiceKm.value = tr.km && Number(v.nextServiceKm) > 0 ? v.odometer + (v.serviceIntervalKm || 10000)
          : tr.km ? v.odometer + (v.serviceIntervalKm || 10000) : '';
        f.nextServiceHours.value = tr.hours ? ((Number(v.engineHours || 0)) + Number(v.serviceIntervalHours || 250)) : '';
        const bits = [];
        if (tr.date) bits.push(`every ${v.serviceIntervalMonths || 6} months`);
        if (tr.km) bits.push(`every ${(v.serviceIntervalKm || 10000).toLocaleString('en-AU')} km`);
        if (tr.hours) bits.push(`every ${(Number(v.serviceIntervalHours) || 250).toLocaleString('en-AU')} hours`);
        el.querySelector('#svc-hint').textContent = `Interval: ${bits.join(' / ') || 'no triggers set'}. Current odometer ${L.fmtKm(v.odometer)}${v.engineHours != null && v.engineHours !== '' ? ` · ${L.fmtHours(v.engineHours)}` : ''}.`;
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
        if (!v) return;
        const tr = L.serviceTriggers(v);
        if (tr.km && f.odometer.value) f.nextServiceKm.value = Number(f.odometer.value) + (v.serviceIntervalKm || 10000);
      });
      f.hours.addEventListener('input', () => {
        const v = AD.store.get('vehicles', f.vehicleId.value);
        if (!v) return;
        const tr = L.serviceTriggers(v);
        if (tr.hours && f.hours.value) f.nextServiceHours.value = (Number(f.hours.value) + Number(v.serviceIntervalHours || 250)).toString();
      });
      fill();

      const saveBtn = el.querySelector('[data-save]');
      saveBtn.onclick = async () => {
        const d = formData(f);
        const v = AD.store.get('vehicles', d.vehicleId);
        const tr = v ? L.serviceTriggers(v) : { date: true, km: true, hours: false };
        const err = {};
        if (!v) err.vehicleId = 'Choose a vehicle.';
        if (!d.date) err.date = 'Enter the service date.';
        else if (d.date > today) err.date = 'A completed service can’t be in the future.';
        const odo = Number(d.odometer);
        if (d.odometer === '' || !(odo >= 0)) err.odometer = 'Enter the odometer reading.';
        else if (v && v.lastServiceKm && odo < v.lastServiceKm) err.odometer = `Lower than the last service (${L.fmtKm(v.lastServiceKm)}).`;
        const hoursVal = d.hours === '' ? null : Number(d.hours);
        if (tr.hours && (d.hours === '' || !(Number(d.hours) >= 0))) err.hours = 'Enter the engine hours reading.';
        else if (tr.hours && v && v.lastServiceHours != null && hoursVal < Number(v.lastServiceHours)) err.hours = `Lower than the last service (${L.fmtHours(v.lastServiceHours)}).`;
        if (d.hours !== '' && !(Number(d.hours) >= 0)) err.hours = 'Enter a valid number.';
        if (tr.date) {
          if (!d.nextServiceDate) err.nextServiceDate = 'Enter the next service date.';
          else if (d.date && d.nextServiceDate <= d.date) err.nextServiceDate = 'Must be after the service date.';
        }
        if (tr.km) {
          if (d.nextServiceKm === '' || !(Number(d.nextServiceKm) > odo)) err.nextServiceKm = 'Must be higher than the service odometer.';
        }
        if (tr.hours) {
          if (d.nextServiceHours === '' || !(Number(d.nextServiceHours) > (hoursVal || 0))) err.nextServiceHours = 'Must be higher than the engine hours at service.';
        }
        if (d.cost !== '' && !(Number(d.cost) >= 0)) err.cost = 'Enter a valid amount.';
        if (!showErrors(f, err)) return;

        const workshopName = d.workshopSel === 'other' ? d.workshopOther
          : d.workshopSel ? ((AD.store.get('workshops', d.workshopSel) || {}).name || '') : '';

        saveBtn.disabled = true;
        try {
          const svcRow = {
            vehicleId: v.id, date: d.date, odometer: Math.round(odo), type: d.type,
            workshop: workshopName, cost: d.cost === '' ? 0 : Number(d.cost), notes: d.notes
          };
          if (hoursVal != null) svcRow.hours = hoursVal;
          await stripUnknownServiceColumns((row) => AD.store.insert('services', row, 'svc'), svcRow);
          const patch = {
            lastServiceDate: d.date, lastServiceKm: Math.round(odo),
            nextServiceDate: tr.date ? d.nextServiceDate : v.nextServiceDate,
            nextServiceKm: tr.km && d.nextServiceKm !== '' ? Math.round(Number(d.nextServiceKm)) : v.nextServiceKm,
            nextServiceHours: tr.hours && d.nextServiceHours !== '' ? Number(d.nextServiceHours) : v.nextServiceHours
          };
          if (hoursVal != null) { patch.engineHours = hoursVal; patch.lastServiceHours = hoursVal; }
          if (odo > v.odometer) patch.odometer = Math.round(odo);
          if (v.status === 'In workshop' && d.returnAvail) patch.status = 'Available';
          await stripUnknownVehicleColumns((p) => AD.store.update('vehicles', v.id, p), patch);
          const nextBits = [];
          if (tr.date) nextBits.push(T.fmtKey(d.nextServiceDate));
          if (tr.km) nextBits.push(L.fmtKm(d.nextServiceKm));
          if (tr.hours) nextBits.push(L.fmtHours(d.nextServiceHours));
          await AD.store.log(`Service recorded for ${v.id} at ${L.fmtKm(odo)}${hoursVal != null ? ' · ' + L.fmtHours(hoursVal) : ''} — next due ${nextBits.join(' / ')}`, v.id);
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
  const { esc, options, pageHeader, sectionHead, dash } = AD.ui;
  const L = AD.logic, T = AD.time, I = AD.icons;
  let root = null, filter = 'all', query = '', type = '';

  function render(el, params) {
    root = el;
    filter = params.filter || 'all';
    query = params.q || '';
    type = params.type || '';
    draw();
  }

  function draw() {
    const el = root;
    // Owned fleet only — hired vehicles are serviced by their hire company, not us.
    const all = AD.store.all('vehicles').filter((v) => !v.hired).map((v) => ({ v, s: L.serviceState(v) }));
    const order = { overdue: 0, soon: 1, ok: 2 };
    all.sort((a, b) => order[a.s.state] - order[b.s.state] || Math.min(a.s.daysLeft, a.s.kmLeft) - Math.min(b.s.daysLeft, b.s.kmLeft) || a.v.id.localeCompare(b.v.id));
    const overdue = all.filter((x) => x.s.state === 'overdue');
    const soon = all.filter((x) => x.s.state === 'soon');
    const scheduled = all.filter((x) => x.s.state === 'ok');
    const dateOnly = all.filter((x) => !x.s.hasKm);
    const types = [...new Set(all.map(({ v }) => v.type).filter(Boolean))].sort();
    const now = Date.now();
    const blocks = AD.store.all('bookings').filter((b) => b.kind === 'maintenance' && b.status !== 'cancelled' && Date.parse(b.end) > now).sort((a, b) => a.start.localeCompare(b.start));
    const recent = AD.store.all('services').slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
    const startsIn = (b) => {
      if (Date.parse(b.start) <= now) return 'Now';
      const d = T.daysBetween(T.todayKey(), T.dateKey(b.start));
      return d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `In ${d} days`;
    };

    const triggerInfo = ({ v, s }) => {
      const parts = [];
      if (s.dateOverdue) parts.push({ text: 'Date overdue', tone: 'overdue' });
      if (s.kmOverdue) parts.push({ text: 'KM overdue', tone: 'overdue' });
      if (s.hoursOverdue) parts.push({ text: 'Hours overdue', tone: 'overdue' });
      if (!parts.length) {
        if (s.dateSoon) parts.push({ text: 'Date due soon', tone: 'soon' });
        if (s.kmSoon) parts.push({ text: 'KM due soon', tone: 'soon' });
        if (s.hoursSoon) parts.push({ text: 'Hours due soon', tone: 'soon' });
      }
      const label = parts.length ? parts.map((p) => p.text).join(' · ') : 'Scheduled';
      const tone = parts[0] ? parts[0].tone : 'ok';
      const detailBits = [];
      if (s.triggers.date && v.nextServiceDate) detailBits.push(T.fmtKey(v.nextServiceDate));
      if (s.triggers.km && s.hasKm) detailBits.push(L.fmtKm(v.nextServiceKm));
      if (s.triggers.hours && s.hasHours) detailBits.push(L.fmtHours(v.nextServiceHours));
      return { label, tone, detail: detailBits.join(' · ') || 'No triggers set' };
    };

    const progressInfo = ({ v, s }) => {
      const daysInInterval = Math.max(30, Number(v.serviceIntervalMonths || 6) * 30);
      const datePct = s.triggers.date ? 100 - (Math.max(0, s.daysLeft) / daysInInterval * 100) : 0;
      const kmInterval = Math.max(1, Number(v.serviceIntervalKm || 10000));
      const kmPct = s.triggers.km && s.hasKm ? 100 - (Math.max(0, s.kmLeft) / kmInterval * 100) : 0;
      const hoursInterval = Math.max(1, Number(v.serviceIntervalHours || 250));
      const hoursPct = s.triggers.hours && s.hasHours ? 100 - (Math.max(0, s.hoursLeft) / hoursInterval * 100) : 0;
      const pct = Math.max(3, Math.min(100, Math.round(Math.max(datePct, kmPct, hoursPct))));
      const bits = [];
      if (s.triggers.date) bits.push(s.daysLeft < 0 ? `${-s.daysLeft} day${s.daysLeft === -1 ? '' : 's'} late` : s.daysLeft === 0 ? 'Due today' : `${s.daysLeft} days left`);
      if (s.triggers.km && s.hasKm) bits.push(s.kmLeft < 0 ? `${L.fmtKm(-s.kmLeft)} over` : s.kmLeft === 0 ? 'KM limit reached' : `${L.fmtKm(s.kmLeft)} left`);
      if (s.triggers.hours && s.hasHours) bits.push(s.hoursLeft < 0 ? `${L.fmtHours(-s.hoursLeft)} over` : s.hoursLeft === 0 ? 'Hours reached' : `${L.fmtHours(s.hoursLeft)} left`);
      return { pct, text: bits.join(' · ') || 'No service trigger set' };
    };

    const rowHtml = (item) => {
      const { v, s } = item;
      const trigger = triggerInfo(item);
      const progress = progressInfo(item);
      const art = AD.art.forVehicle(v, 74) || `<span class="maintenance-thumb-icon">${I.truck}</span>`;
      const badge = s.state === 'overdue' ? AD.ui.badge('Overdue', 'red') : s.state === 'soon' ? AD.ui.badge('Due soon', 'amber') : AD.ui.badge('Scheduled', 'green muted');
      return `<article class="maintenance-row maintenance-${s.state}" data-id="${esc(v.id)}" tabindex="0" aria-label="Open ${esc(v.id)} vehicle profile">
        <div class="maintenance-vehicle">
          <span class="maintenance-thumb">${art}</span>
          <span><b>${esc(v.id)}</b><small>${esc(v.rego || 'No registration')} · ${esc(v.type)}</small></span>
        </div>
        <div class="maintenance-cell"><span>Due trigger</span><strong class="maintenance-trigger maintenance-trigger-${trigger.tone}">${trigger.label}</strong><small>${trigger.detail}</small></div>
        <div class="maintenance-cell"><span>Last service</span><strong>${v.lastServiceDate ? T.fmtKey(v.lastServiceDate) : 'Not recorded'}</strong><small>${v.lastServiceKm != null ? L.fmtKm(v.lastServiceKm) : 'No odometer recorded'}</small></div>
        <div class="maintenance-cell maintenance-progress-cell"><span>Service progress</span><div class="maintenance-progress" aria-label="${progress.pct}% through service interval"><i style="width:${progress.pct}%"></i></div><small>${progress.text}</small></div>
        <div class="maintenance-status">${badge}</div>
        <button type="button" class="btn btn-primary btn-sm" data-rec="${esc(v.id)}">Record service</button>
      </article>`;
    };

    const groupHtml = (label, state, items) => items.length ? `<section class="maintenance-group maintenance-group-${state}">
      <header><span><i></i><b>${label}</b></span><small>${items.length} vehicle${items.length === 1 ? '' : 's'}</small></header>
      <div class="maintenance-rows">${items.map(rowHtml).join('')}</div>
    </section>` : '';

    el.innerHTML = `
      ${pageHeader({
        title: 'Maintenance',
        sub: `A clearer view of what is overdue, what is approaching, and why`,
        actions: `<button class="btn btn-primary" id="rec">${I.plus} Record completed service</button>`
      })}

      <div class="maintenance-summary" role="group" aria-label="Maintenance summary">
        <button data-f="overdue" class="maintenance-kpi maintenance-kpi-overdue${filter === 'overdue' ? ' is-active' : ''}"><span>Overdue</span><strong>${overdue.length}</strong><small>Needs attention now</small></button>
        <button data-f="soon" class="maintenance-kpi maintenance-kpi-soon${filter === 'soon' ? ' is-active' : ''}"><span>Due soon</span><strong>${soon.length}</strong><small>Within ${L.SOON_DAYS} days, ${L.SOON_KM.toLocaleString('en-AU')} km or ${L.SOON_HOURS} hr</small></button>
        <button data-f="ok" class="maintenance-kpi maintenance-kpi-ok${filter === 'ok' ? ' is-active' : ''}"><span>Scheduled</span><strong>${scheduled.length}</strong><small>Currently on track</small></button>
        <button data-f="date" class="maintenance-kpi maintenance-kpi-date${filter === 'date' ? ' is-active' : ''}"><span>Date only</span><strong>${dateOnly.length}</strong><small>No kilometre limit</small></button>
      </div>

      <section class="section maintenance-register">
        ${sectionHead({ title: 'Service register', meta: '<span id="maint-count"></span>' })}
        <div class="toolbar maintenance-toolbar">
          <label class="search">${I.search}<input id="maint-search" type="search" value="${esc(query)}" placeholder="Search fleet ID, registration or type" aria-label="Search maintenance register"></label>
          <select id="maint-type" aria-label="Vehicle type">${options(types, type, 'All vehicle types')}</select>
          <select id="maint-status" aria-label="Service status">${options([['due', 'Due and overdue'], ['overdue', 'Overdue'], ['soon', 'Due soon'], ['ok', 'Scheduled'], ['date', 'Date only'], ['all', 'All vehicles']], filter)}</select>
        </div>
        <div id="maintenance-groups"></div>
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
    const groups = el.querySelector('#maintenance-groups');
    const count = el.querySelector('#maint-count');
    const statusSelect = el.querySelector('#maint-status');
    const syncParams = () => AD.setParams({ filter, q: query, type });
    const renderRegister = () => {
      const q = query.trim().toLowerCase();
      const list = all.filter(({ v, s }) => {
        if (filter === 'due' && s.state === 'ok') return false;
        if (filter === 'overdue' && s.state !== 'overdue') return false;
        if (filter === 'soon' && s.state !== 'soon') return false;
        if (filter === 'ok' && s.state !== 'ok') return false;
        if (filter === 'date' && s.hasKm) return false;
        if (type && v.type !== type) return false;
        if (q && !`${v.id} ${v.rego || ''} ${v.type || ''} ${v.make || ''} ${v.model || ''}`.toLowerCase().includes(q)) return false;
        return true;
      });
      count.textContent = `${list.length} of ${all.length} vehicles`;
      groups.innerHTML = groupHtml('Overdue', 'overdue', list.filter(({ s }) => s.state === 'overdue'))
        + groupHtml('Due soon', 'soon', list.filter(({ s }) => s.state === 'soon'))
        + groupHtml('Scheduled', 'ok', list.filter(({ s }) => s.state === 'ok'))
        || `<div class="maintenance-empty">${I.search}<b>No vehicles found</b><span>Try changing the search or filters.</span></div>`;
      el.querySelectorAll('.maintenance-kpi').forEach((b) => b.classList.toggle('is-active', b.dataset.f === filter));
      groups.querySelectorAll('[data-rec]').forEach((b) => (b.onclick = () => AD.serviceForm(b.dataset.rec)));
      groups.querySelectorAll('[data-id]').forEach((row) => {
        const open = () => AD.go('vehicle/' + row.dataset.id);
        row.addEventListener('click', (e) => { if (!e.target.closest('button, a')) open(); });
        row.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('button, a')) { e.preventDefault(); open(); } });
      });
    };
    el.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => {
      filter = b.dataset.f;
      statusSelect.value = filter;
      syncParams();
      renderRegister();
    }));
    statusSelect.onchange = () => { filter = statusSelect.value; syncParams(); renderRegister(); };
    el.querySelector('#maint-type').onchange = (e) => { type = e.target.value; syncParams(); renderRegister(); };
    el.querySelector('#maint-search').oninput = (e) => { query = e.target.value; syncParams(); renderRegister(); };
    el.querySelectorAll('[data-veh]').forEach((b) => (b.onclick = () => AD.go('vehicle/' + b.dataset.veh)));
    el.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => {
      const bk = AD.store.get('bookings', b.dataset.open);
      AD.go('calendar', { view: 'day', date: T.dateKey(bk.start), open: bk.id });
    }));
    renderRegister();
  }

  return { title: 'Maintenance', render, refresh: () => root && draw() };
})();
