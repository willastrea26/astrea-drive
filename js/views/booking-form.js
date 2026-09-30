/*
 * Create / edit / delete a vac truck booking.
 * Bookings are the single dataset behind both Calendar and Tracker.
 */
window.AD = window.AD || {};

AD.bookingForm = function (booking, defaults = {}) {
  const { esc, options, formData, showErrors, modal, toast, confirm } = AD.ui;
  const T = AD.time, L = AD.logic, I = AD.icons;
  const isNew = !booking;
  const trucks = L.vacTrucks();
  const sites = AD.store.all('sites');
  const drivers = AD.store.all('drivers');

  /** Type-ahead options built from what's already been booked, so the list grows with use. */
  const suggestions = (field) => [...new Set(AD.store.all('bookings').map((x) => x[field]).filter(Boolean))]
    .sort((a, z) => a.localeCompare(z))
    .map((v) => `<option value="${esc(v)}">`).join('');

  let b;
  if (booking) b = Object.assign({}, booking);
  else {
    const day = defaults.date || T.todayKey();
    const { y, m, d } = T.parseKey(day);
    const sh = defaults.hour != null ? defaults.hour : 7;
    const start = T.fromParts(y, m, d, sh, 0);
    b = {
      id: '', kind: defaults.kind || 'job', truckId: defaults.truckId || '', jobName: '', jobNumber: '', client: '',
      driverId: '', status: defaults.kind === 'maintenance' ? 'confirmed' : 'confirmed', notes: '',
      siteId: defaults.kind === 'maintenance' ? 'site-depot' : '', address: '', lat: null, lng: null, locationSource: 'none',
      start: new Date(start).toISOString(), end: new Date(T.fromParts(y, m, d, sh + 8, 0)).toISOString()
    };
    if (b.siteId) { const s = sites.find((x) => x.id === b.siteId); Object.assign(b, { address: s.address, lat: s.lat, lng: s.lng, locationSource: 'site' }); }
    if (b.truckId) { const v = AD.store.get('vehicles', b.truckId); if (v && b.kind === 'job') b.driverId = v.driverId; }
  }
  // Location mode: a saved site id, 'pin' or 'none'
  let locMode = b.locationSource === 'site' && b.siteId ? b.siteId : b.locationSource === 'pin' ? 'pin' : 'none';
  let pin = b.locationSource === 'pin' && L.hasCoords(b) ? { lat: b.lat, lng: b.lng } : null;

  const siteOpts = [['none', 'No location yet — site location required'], ['pin', 'Custom location — drop a pin on the map']]
    .concat(sites.map((s) => [s.id, `${s.name} — ${s.address}`]));

  let pickMap = null; // released when the dialog closes
  modal({
    wide: true,
    onClose: () => { if (pickMap) { pickMap.remove(); pickMap = null; } },
    title: isNew ? 'New booking' : `Edit booking — ${b.truckId}`,
    body: `
      <p class="modal-lede">${I.clock} Times are Australia/Sydney (AEST/AEDT).</p>
      <form class="form-grid" novalidate>
        <div class="field"><label>Booking type</label>
          <select name="kind">${options([['job', 'Job'], ['maintenance', 'Maintenance (truck unavailable)'], ['depot', 'Depot assignment']], b.kind)}</select></div>
        <div class="field"><label>Vac truck <span class="req">*</span></label>
          <select name="truckId">${options(trucks.map((v) => [v.id, `${v.id} · ${v.rego}${v.status === 'Out of service' || v.status === 'In workshop' ? ' (' + v.status + ')' : ''}`]), b.truckId, 'Select truck')}</select></div>
        <div class="field"><label id="lbl-job">Job name <span class="req">*</span></label><input type="text" name="jobName" value="${esc(b.jobName)}" list="job-list">
          <datalist id="job-list">${suggestions('jobName')}</datalist></div>
        <div class="field job-only"><label>Job number</label><input type="text" name="jobNumber" value="${esc(b.jobNumber)}" placeholder="e.g. J-26301"></div>
        <div class="field job-only"><label>Client</label><input type="text" name="client" value="${esc(b.client)}" list="client-list">
          <datalist id="client-list">${suggestions('client')}</datalist></div>
        <div class="field"><label>Driver</label><select name="driverId">${options(drivers.map((d) => [d.id, d.name]), b.driverId, 'Unassigned')}</select></div>
        <div class="field"><label>Start <span class="req">*</span> <span class="muted small" id="abbr-s"></span></label><input type="datetime-local" name="start" value="${T.toInput(b.start)}" step="900"></div>
        <div class="field"><label>Finish <span class="req">*</span> <span class="muted small" id="abbr-e"></span></label><input type="datetime-local" name="end" value="${T.toInput(b.end)}" step="900"></div>
        <div class="field"><label>Status</label><select name="status">${options([['tentative', 'Tentative'], ['confirmed', 'Confirmed'], ['cancelled', 'Cancelled']], b.status)}</select></div>
        <div class="field"><label>Duration</label><div class="help" id="dur" style="padding-top:9px"></div></div>

        <div class="field full"><label>Site location</label>
          <select name="loc">${options(siteOpts, locMode)}</select></div>
        <div class="field full">
          <div class="pick-map-wrap" style="position:relative"><div class="pick-map" id="pick-map"></div></div>
          <div class="loc-status" id="loc-status"></div>
        </div>
        <div class="field full"><label id="lbl-addr">Site address</label><input type="text" name="address" value="${esc(b.address)}">
          <div class="help" id="addr-help"></div></div>
        <div class="field full"><label>Notes</label><textarea name="notes" rows="2">${esc(b.notes)}</textarea></div>
      </form>
      <div id="clash" style="margin-top:14px"></div>
      <div class="form-actions">
        ${isNew ? '' : `<button class="btn btn-danger-ghost left" data-del type="button">${I.trash} Delete booking</button>`}
        <button class="btn btn-ghost" data-close type="button">Cancel</button>
        <button class="btn btn-primary" data-save type="button">${isNew ? 'Create booking' : 'Save changes'}</button>
      </div>`,
    onMount(el, close) {
      const f = el.querySelector('form');
      const $ = (s) => el.querySelector(s);
      $('[data-close]').onclick = close;
      let map = null, marker = null;

      // ---- map ----
      const mapEl = $('#pick-map');
      map = AD.maps.create(mapEl, mapEl.parentElement, { scrollWheelZoom: true });
      pickMap = map;
      if (map) {
        setTimeout(() => map && pickMap === map && map.invalidateSize(), 60);
        map.on('click', (e) => {
          pin = { lat: +e.latlng.lat.toFixed(5), lng: +e.latlng.lng.toFixed(5) };
          locMode = 'pin';
          f.loc.value = 'pin';
          syncLoc(false);
        });
      }
      const pinIcon = () => L_icon();
      function L_icon() {
        return window.L.divIcon({ className: 'drop-pin', html: '<svg viewBox="0 0 24 24"><path d="M12 22s-7-6.4-7-12a7 7 0 0 1 14 0c0 5.6-7 12-7 12z" stroke-width="1.5"/><circle cx="12" cy="10" r="2.6" fill="#fff"/></svg>', iconSize: [30, 30], iconAnchor: [15, 29] });
      }

      function currentCoords() {
        if (locMode === 'pin') return pin;
        if (locMode === 'none') return null;
        const s = sites.find((x) => x.id === locMode);
        return s ? { lat: s.lat, lng: s.lng } : null;
      }

      function syncLoc(fly = true) {
        const c = currentCoords();
        const st = $('#loc-status');
        const addr = f.address;
        if (locMode === 'none') {
          st.className = 'loc-status none';
          st.innerHTML = `${I.alert} No coordinates. Tracker will list this truck as “Site location required” during the booking. Click the map to drop a pin.`;
          addr.readOnly = false;
          $('#lbl-addr').textContent = 'Site address (as typed — not looked up)';
          $('#addr-help').textContent = 'Typed addresses are stored as text only. No address search is implemented, so they are not placed on the map.';
        } else if (locMode === 'pin') {
          st.className = pin ? 'loc-status ok' : 'loc-status none';
          st.innerHTML = pin ? `${I.pin} Pin dropped at ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}. Click elsewhere on the map to move it.` : `${I.pin} Click the map to drop a pin for this site.`;
          addr.readOnly = false;
          $('#lbl-addr').textContent = 'Site description / address (as typed — not looked up)';
          $('#addr-help').textContent = 'The map position comes only from the pin. The text is a label and is not checked against the pin.';
        } else {
          const s = sites.find((x) => x.id === locMode);
          st.className = 'loc-status ok';
          st.innerHTML = `${I.check} Site: ${esc(s.name)} (${s.lat.toFixed(4)}, ${s.lng.toFixed(4)})`;
          addr.value = s.address;
          addr.readOnly = true;
          $('#lbl-addr').textContent = 'Site address (from saved site)';
          $('#addr-help').textContent = 'Choose “Custom location” to drop your own pin instead.';
        }
        if (map) {
          if (marker) { map.removeLayer(marker); marker = null; }
          if (c) {
            marker = window.L.marker([c.lat, c.lng], { icon: pinIcon() }).addTo(map);
            if (fly) map.setView([c.lat, c.lng], Math.max(map.getZoom(), 12));
          } else if (fly) map.fitBounds(AD.maps.AU_BOUNDS);
        }
        checkClash();
      }

      function kindUI() {
        const k = f.kind.value;
        el.querySelectorAll('.job-only').forEach((x) => x.classList.toggle('hide', k !== 'job'));
        $('#lbl-job').innerHTML = (k === 'job' ? 'Job name' : k === 'maintenance' ? 'Maintenance description' : 'Assignment description') + ' <span class="req">*</span>';
        if (k !== 'job' && !f.jobName.value) f.jobName.value = k === 'maintenance' ? 'Scheduled maintenance' : 'Depot standby';
      }

      function checkClash() {
        const d = formData(f);
        const s = T.fromInput(d.start), e = T.fromInput(d.end);
        $('#abbr-s').textContent = isNaN(s) ? '' : T.abbr(s);
        $('#abbr-e').textContent = isNaN(e) ? '' : T.abbr(e);
        const durEl = $('#dur');
        if (!isNaN(s) && !isNaN(e) && e > s) {
          const mins = Math.round((e - s) / 60000), h = Math.floor(mins / 60), m = mins % 60;
          durEl.textContent = `${h >= 24 ? Math.floor(h / 24) + 'd ' + (h % 24) + 'h' : h + 'h'}${m ? ' ' + m + 'm' : ''}`;
        } else durEl.textContent = '—';
        const box = $('#clash');
        const saveBtn = $('[data-save]');
        if (isNaN(s) || isNaN(e) || !(e > s)) { box.innerHTML = ''; saveBtn.textContent = isNew ? 'Create booking' : 'Save changes'; return []; }
        const list = L.overlaps({ id: b.id, truckId: d.truckId, status: d.status, start: new Date(s).toISOString(), end: new Date(e).toISOString() });
        const v = d.truckId && AD.store.get('vehicles', d.truckId);
        const vehWarn = v && (v.status === 'Out of service' || v.status === 'In workshop') && d.kind !== 'maintenance'
          ? `<p class="note note-warn">${esc(v.id)} is currently marked <b>${esc(v.status)}</b> in the fleet register.</p>` : '';
        if (!list.length) { box.innerHTML = vehWarn; saveBtn.textContent = isNew ? 'Create booking' : 'Save changes'; return list; }
        const maint = list.some((x) => x.kind === 'maintenance');
        box.innerHTML = vehWarn + `<div class="note note-danger"><b>${maint ? 'Truck unavailable — clashes with maintenance' : 'Overlapping booking for ' + esc(d.truckId)}.</b>
          This will be flagged as a clash in Calendar and Tracker (no location is chosen while bookings overlap).
          <ul>${list.map((x) => `<li>${esc(L.bookingTitle(x))} ${x.jobNumber ? '(' + esc(x.jobNumber) + ')' : ''} — ${T.fmtDateTime(x.start)} to ${T.fmtDateTime(x.end)} · ${AD.ui.BOOKING_LABEL[L.bookingCategory(x)]}</li>`).join('')}</ul>
          Adjacent bookings are fine: one finishing at 12:00 and another starting at 12:00 do not clash.</div>`;
        saveBtn.textContent = 'Save despite clash';
        return list;
      }

      f.kind.addEventListener('change', () => { kindUI(); checkClash(); });
      f.truckId.addEventListener('change', () => {
        const v = AD.store.get('vehicles', f.truckId.value);
        if (v && !f.driverId.value && f.kind.value === 'job') f.driverId.value = v.driverId || '';
        checkClash();
      });
      ['start', 'end', 'status'].forEach((n) => f[n].addEventListener('input', checkClash));
      f.start.addEventListener('change', () => {
        // keep the same duration when the start moves
        const s = T.fromInput(f.start.value), oldS = Date.parse(b.start), oldE = Date.parse(b.end);
        if (!isNaN(s) && isNew && !f.end.dataset.touched) f.end.value = T.toInput(s + (oldE - oldS));
        checkClash();
      });
      f.end.addEventListener('change', () => { f.end.dataset.touched = '1'; });
      f.loc.addEventListener('change', () => {
        locMode = f.loc.value;
        if (locMode === 'pin' && !pin && map) map.getContainer().focus();
        if (locMode !== 'pin' && locMode !== 'none') f.address.value = '';
        if ((locMode === 'none' || locMode === 'pin') && f.address.readOnly) f.address.value = '';
        syncLoc(true);
      });
      kindUI();
      syncLoc(true);

      if (!isNew) $('[data-del]').onclick = async () => {
        const ok = await confirm({ title: 'Delete booking?', message: `Delete <b>${esc(L.bookingTitle(b))}</b> for ${esc(b.truckId)} (${T.fmtDateTime(b.start)} – ${T.fmtDateTime(b.end)})? This can’t be undone.`, confirmText: 'Delete booking', danger: true });
        if (!ok) return;
        try {
          await AD.store.remove('bookings', b.id);
          await AD.store.log(`Booking deleted: ${b.truckId} — ${L.bookingTitle(b)} (${T.fmtDateTime(b.start)})`, b.truckId);
        } catch (err) {
          toast('Could not delete booking: ' + err.message, 'error');
          return;
        }
        toast('Booking deleted');
        close();
      };

      const saveBtn = $('[data-save]');
      saveBtn.onclick = async () => {
        const d = formData(f);
        const s = T.fromInput(d.start), e = T.fromInput(d.end);
        const err = {};
        if (!d.truckId) err.truckId = 'Choose a vac truck.';
        if (!d.jobName) err.jobName = 'Required.';
        if (isNaN(s)) err.start = 'Enter a start date and time.';
        if (isNaN(e)) err.end = 'Enter a finish date and time.';
        if (!isNaN(s) && !isNaN(e) && e <= s) err.end = 'Finish must be after start.';
        if (!isNaN(s) && !isNaN(e) && e - s > 31 * 86400000) err.end = 'Bookings longer than 31 days aren’t supported.';
        if (locMode === 'pin' && !pin) err.loc = 'Click the map to drop a pin, or choose another option.';
        if (!showErrors(f, err)) return;

        const c = currentCoords();
        const rec = {
          kind: d.kind, truckId: d.truckId, jobName: d.jobName, jobNumber: d.kind === 'job' ? d.jobNumber : '',
          client: d.kind === 'job' ? d.client : '', driverId: d.driverId, status: d.status, notes: d.notes,
          start: new Date(s).toISOString(), end: new Date(e).toISOString(),
          siteId: locMode !== 'pin' && locMode !== 'none' ? locMode : '',
          address: d.address, lat: c ? c.lat : null, lng: c ? c.lng : null,
          locationSource: locMode === 'pin' ? 'pin' : locMode === 'none' ? 'none' : 'site'
        };
        const clashes = L.overlaps(Object.assign({ id: b.id }, rec));
        saveBtn.disabled = true;
        let saved;
        try {
          if (isNew) {
            saved = await AD.store.insert('bookings', rec, 'bk');
            await AD.store.log(`Booking created: ${rec.truckId} — ${rec.jobName} (${T.fmtDateTime(rec.start)})`, rec.truckId);
          } else {
            saved = await AD.store.update('bookings', b.id, rec);
            await AD.store.log(`Booking updated: ${rec.truckId} — ${rec.jobName} (${T.fmtDateTime(rec.start)})`, rec.truckId);
          }
        } catch (err) {
          saveBtn.disabled = false;
          toast('Could not save booking: ' + err.message, 'error');
          return;
        }
        toast(clashes.length ? `Booking saved — clashes with ${clashes.length} other booking${clashes.length > 1 ? 's' : ''}` : (isNew ? 'Booking created' : 'Booking saved'), clashes.length ? 'warn' : 'ok');
        close();
        defaults.onSaved && defaults.onSaved(saved);
      };
    }
  });
};
