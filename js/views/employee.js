/*
 * Employee profile — opened from the Employee register (#/employee/<id>).
 * Same shape as the vehicle profile: breadcrumb, a header with the key
 * facts and an Edit button, then detail sections underneath.
 *
 * Profile photo: drop an image on the initials badge (top left). It's
 * shrunk to a small JPEG and stored on the employee's own row.
 * Documents: drop PDFs, images, Word files etc. into the Documents box.
 * Files go to the private storage bucket and are only ever opened through
 * short-lived signed links (see create-employee-documents.sql).
 *
 * Two tabs: "Employee overview" (everything below) and "Rates" (pay and
 * charge-out rates, restricted — see employee-rates.js).
 *
 * Assigned vehicles are found by matching the employee's name to the
 * fleet's driver list (the Fleet register's "Assigned driver"), since the
 * two lists aren't linked by ID.
 */
AD.views = AD.views || {};

AD.views.employee = (function () {
  const { esc, sectionHead, dash, badge, vehicleBadge } = AD.ui;
  const T = AD.time, I = AD.icons;
  let root = null, empId = '', uploading = '', tab = 'overview';

  const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const initials = (name) => String(name || '?').trim().split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'this person';
  const docsReady = () => AD.store.available('employee_documents');
  const docsFor = (id) => AD.store.all('employee_documents').filter((d) => d.employeeId === id);

  /** Whole years between two YYYY-MM-DD keys. */
  function yearsBetween(from, to) {
    const a = T.parseKey(from), b = T.parseKey(to);
    let y = b.y - a.y;
    if (b.m < a.m || (b.m === a.m && b.d < a.d)) y -= 1;
    return y;
  }

  /** "2 yrs 3 mths", "5 mths", "12 days", or "Starts in 9 days" for a future start. */
  function tenure(start) {
    const today = T.todayKey();
    const days = T.daysBetween(start, today);
    if (days < 0) return `Starts in ${-days} day${days === -1 ? '' : 's'}`;
    if (days < 31) return days === 0 ? 'Started today' : `${days} day${days === 1 ? '' : 's'}`;
    const a = T.parseKey(start), b = T.parseKey(today);
    let months = (b.y - a.y) * 12 + (b.m - a.m) - (b.d < a.d ? 1 : 0);
    const yrs = Math.floor(months / 12);
    months -= yrs * 12;
    return [yrs ? `${yrs} yr${yrs === 1 ? '' : 's'}` : '', months ? `${months} mth${months === 1 ? '' : 's'}` : ''].filter(Boolean).join(' ') || 'Under a month';
  }

  /** Fleet vehicles whose assigned driver has this employee's name. */
  function vehiclesFor(emp) {
    const driverIds = new Set(AD.store.all('drivers').filter((d) => norm(d.name) === norm(emp.name)).map((d) => d.id));
    if (!driverIds.size) return [];
    return AD.store.all('vehicles').filter((v) => driverIds.has(v.driverId)).sort((a, b) => a.id.localeCompare(b.id));
  }

  // ------------------------------------------- live location of their vehicle
  // Looks up ONE vehicle's GPS position: the tracker list once (to find this
  // vehicle's device), then just that device's latest status. Two small calls,
  // instead of the Tracker's whole-fleet load, and cached so opening profiles
  // and the background refresh don't keep hitting Netstar's rate limit.
  const POS_TTL = 2 * 60 * 1000;      // re-check a vehicle's position at most every 2 min
  const DEV_TTL = 30 * 60 * 1000;     // the tracker list barely changes
  const STALE_HOURS = 24;             // no report for this long = offline (same as the Tracker)
  const LIVE_WORD = { moving: 'Moving', idling: 'Idling', parked: 'Parked', offline: 'Offline' };
  const LIVE_TONE = { moving: 'green', idling: 'amber', parked: 'blue', offline: 'grey ring' };
  let devices = null, devicesAt = 0, maps = [];
  const posCache = new Map(), pending = new Map();

  async function netstar(body) {
    const { data, error } = await AD.sb.functions.invoke('netstar', { body });
    if (error) throw error;
    if (data && data.error) throw new Error(data.error);
    return data || {};
  }

  async function deviceFor(v) {
    if (!devices || Date.now() - devicesAt > DEV_TTL) {
      devices = (await netstar({ action: 'vehicles' })).vehicles || [];
      devicesAt = Date.now();
    }
    const A = AD.netstarAliases;
    const want = new Set([A.normalise(v.rego), A.aliasForVehicle(v)].filter(Boolean));
    return devices.find((d) => d.imei && (want.has(A.normalise(d.rego)) || want.has(A.fleetRegoForDevice(d.rego)))) || null;
  }

  /** { pos } with the latest status, { none } if the vehicle has no tracker, or { error }. */
  function livePosition(v) {
    const cached = posCache.get(v.id);
    if (cached && Date.now() - cached.at < POS_TTL) return Promise.resolve(cached);
    if (pending.has(v.id)) return pending.get(v.id);
    const job = (async () => {
      let out;
      try {
        const dev = await deviceFor(v);
        out = dev
          ? { at: Date.now(), pos: ((await netstar({ action: 'positions', imeis: [dev.imei] })).positions || [])[0] || null }
          : { at: Date.now(), none: true };
      } catch (e) {
        out = { at: Date.now(), error: (e && e.message) || 'Could not reach the tracker service' };
      }
      posCache.set(v.id, out);
      pending.delete(v.id);
      return out;
    })();
    pending.set(v.id, job);
    return job;
  }

  /** Netstar reports "dd-MM-yyyy HH:mm:ss" in Sydney time. */
  function nsTime(s) {
    const m = /^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/.exec(String(s || ''));
    if (!m) return null;
    const t = Date.parse(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}+11:00`);
    return Number.isFinite(t) ? t : null;
  }
  function ago(ms) {
    const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const h = Math.round(mins / 60);
    return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
  }
  function liveCat(p) {
    const seen = nsTime(p.lastData);
    if (seen != null && Date.now() - seen > STALE_HOURS * 3600000) return 'offline';
    const on = String(p.ignition || '').toLowerCase() === 'on';
    return on && (p.speed || 0) > 0 ? 'moving' : on ? 'idling' : 'parked';
  }

  const liveBox = (v) => `<div class="emp-veh-live" data-live="${esc(v.id)}">
      <div class="emp-veh-map-wrap"><div class="emp-veh-map"></div><span class="emp-veh-loading">Finding ${esc(v.id)}…</span></div>
      <div class="emp-veh-status"></div>
    </div>`;

  function destroyMaps() {
    maps.forEach((m) => { try { m.remove(); } catch (e) { /* already gone */ } });
    maps = [];
  }

  function paintLive(box, v, res) {
    if (!box.isConnected) return; // the page moved on while we were waiting
    const wrap = box.querySelector('.emp-veh-map-wrap');
    const status = box.querySelector('.emp-veh-status');
    const noMap = (html) => { wrap.remove(); status.innerHTML = html; };
    if (res.error) return noMap(`<span class="flag flag-amber">Live location unavailable</span><span class="t2">${esc(res.error)}</span>`);
    if (res.none) return noMap(`<span class="muted">${esc(v.id)} doesn’t have a GPS tracker linked, so its location isn’t available.</span>`);
    const p = res.pos;
    if (!p || p.lat == null || p.lng == null) return noMap(`<span class="muted">${esc(v.id)}’s tracker hasn’t reported a GPS fix yet.</span>`);

    const cat = liveCat(p);
    const seen = nsTime(p.lastData);
    const where = [p.location, p.city].filter(Boolean).join(', ');
    status.innerHTML = `<span class="emp-veh-where">${badge(LIVE_WORD[cat], LIVE_TONE[cat])}<b>${esc(where || 'Location found')}</b></span>
      <span class="t2">${seen != null ? `Last report ${esc(ago(seen))}` : 'Last report time unknown'}${cat === 'moving' && p.speed ? ` · ${Math.round(p.speed)} km/h` : ''} ·
        <a href="https://www.google.com/maps?q=${encodeURIComponent(p.lat + ',' + p.lng)}" target="_blank" rel="noopener">Open in Google Maps</a></span>`;
    const loading = box.querySelector('.emp-veh-loading');
    if (loading) loading.remove();

    const map = AD.maps.create(box.querySelector('.emp-veh-map'), wrap, { style: 'dark', zoomControl: false, scrollWheelZoom: false });
    if (!map) return; // AD.maps already explained (e.g. no internet for the map library)
    maps.push(map);
    map.setView([p.lat, p.lng], 15, { animate: false });
    const art = AD.art.forVehicle(v, 58) || '';
    window.L.marker([p.lat, p.lng], {
      keyboard: false,
      icon: window.L.divIcon({ className: 'emp-veh-pin', html: `<div class="emp-veh-pin-inner${art ? '' : ' no-art'}">${art || I.truck}</div>`, iconSize: [64, 36], iconAnchor: [32, 30] })
    }).addTo(map);
    setTimeout(() => { if (box.isConnected) map.invalidateSize(); }, 60);
  }

  function bindLive(el) {
    el.querySelectorAll('[data-live]').forEach((box) => {
      const v = AD.store.get('vehicles', box.dataset.live);
      if (v) livePosition(v).then((res) => paintLive(box, v, res));
    });
  }

  // ------------------------------------------------------------- photo
  function avatar(e) {
    if (!docsReady()) return `<div class="emp-avatar" aria-hidden="true"><span class="emp-initials">${esc(initials(e.name))}</span></div>`;
    return `<div class="emp-avatar is-drop${e.photo ? ' has-photo' : ''}" id="emp-photo" role="button" tabindex="0"
        title="${e.photo ? 'Drop a new photo or click to change it' : 'Drop a photo or click to add one'}" aria-label="${e.photo ? 'Change' : 'Add'} profile photo">
      ${e.photo ? `<img src="${esc(e.photo)}" alt="">` : `<span class="emp-initials">${esc(initials(e.name))}</span>`}
      <span class="emp-avatar-cta">${I.camera}<span>${e.photo ? 'Change' : 'Add photo'}</span></span>
      ${e.photo ? `<button type="button" class="emp-photo-clear" id="emp-photo-clear" title="Remove photo" aria-label="Remove photo">${I.x}</button>` : ''}
      <input type="file" id="emp-photo-input" accept="image/*" hidden>
    </div>`;
  }

  async function savePhoto(file, e) {
    const { toast, compressImage } = AD.ui;
    if (!file) return;
    let dataUrl;
    try { dataUrl = await compressImage(file, 400, 0.82); } catch (err) { return; } // compressImage already explained why
    try {
      await AD.store.update('employees', e.id, { photo: dataUrl });
    } catch (err) {
      return toast('Could not save photo: ' + err.message, 'error');
    }
    toast(`${firstName(e.name)}’s photo updated`);
    draw();
  }

  function bindPhoto(el, e) {
    const zone = el.querySelector('#emp-photo');
    if (!zone) return;
    const input = el.querySelector('#emp-photo-input');
    zone.addEventListener('click', (ev) => { if (!ev.target.closest('#emp-photo-clear')) input.click(); });
    zone.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); input.click(); } });
    input.addEventListener('change', () => savePhoto(input.files[0], e));
    dropTarget(zone, (files) => savePhoto(files[0], e));
    const clear = el.querySelector('#emp-photo-clear');
    if (clear) clear.onclick = async () => {
      try { await AD.store.update('employees', e.id, { photo: '' }); } catch (err) { return AD.ui.toast('Could not remove photo: ' + err.message, 'error'); }
      AD.ui.toast(`${firstName(e.name)}’s photo removed`);
      draw();
    };
  }

  /** Highlight while files are dragged over `zone`; call onFiles on drop. */
  function dropTarget(zone, onFiles) {
    ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => {
      e.preventDefault();
      if (ev === 'dragleave' && zone.contains(e.relatedTarget)) return;
      zone.classList.remove('is-over');
    }));
    zone.addEventListener('drop', (e) => { const f = [...(e.dataTransfer.files || [])]; if (f.length) onFiles(f); });
  }

  // --------------------------------------------------------- documents
  function documentsSection(e) {
    const ready = docsReady();
    const docs = ready ? docsFor(e.id) : [];
    const meta = docs.length ? `${docs.length} file${docs.length === 1 ? '' : 's'} · only approved Astrea Drive users can open these` : 'Only approved Astrea Drive users can open these';
    if (!ready) {
      return `<section class="section">
        ${sectionHead({ title: 'Documents', level: 3 })}
        <div class="sample-note">${I.alert}<div><b>Not set up yet.</b> Run <code>supabase/create-employee-documents.sql</code> in the Supabase SQL Editor, then refresh, to store photos and documents here.</div></div>
      </section>`;
    }
    const row = (d) => `<li>
        ${AD.fileIcon(d.name || d.storagePath)}
        <span class="emp-doc-name"><b>${esc(d.name)}</b><span class="t2">${esc(AD.fmtBytes(d.sizeBytes))}${d.uploadedAt ? ` · added ${esc(T.fmtKey(String(d.uploadedAt).slice(0, 10)))}` : ''}${d.uploadedBy ? ` by ${esc(AD.logic.userName(d.uploadedBy) || d.uploadedBy)}` : ''}</span></span>
        <span class="emp-doc-actions">
          <button type="button" class="btn btn-sm btn-ghost" data-doc-view="${esc(d.id)}">${I.eye} View</button>
          <button type="button" class="btn btn-sm btn-ghost" data-doc-dl="${esc(d.id)}">${I.download} Download</button>
          <button type="button" class="btn btn-sm btn-ghost emp-doc-del" data-doc-del="${esc(d.id)}" title="Delete ${esc(d.name)}" aria-label="Delete ${esc(d.name)}">${I.trash}</button>
        </span>
      </li>`;
    return `<section class="section">
      ${sectionHead({ title: 'Documents', meta, level: 3 })}
      <div class="emp-drop${uploading ? ' is-busy' : ''}" id="emp-drop" role="button" tabindex="0" aria-label="Upload documents">
        ${I.file}
        <span class="emp-drop-main">${uploading ? esc(uploading) : '<b>Drop files here</b> or click to browse'}</span>
        <span class="emp-drop-sub">Licences, tickets, contracts, certificates — PDFs, images, Word, Excel · up to ${esc(AD.fmtBytes(AD.MAX_DOC_BYTES))} each</span>
        <input type="file" id="emp-doc-input" multiple hidden>
      </div>
      ${docs.length ? `<ul class="emp-doc-list">${docs.map(row).join('')}</ul>` : ''}
    </section>`;
  }

  async function uploadDocs(files, e) {
    const { toast } = AD.ui;
    if (uploading) return;
    const tooBig = files.filter((f) => f.size > AD.MAX_DOC_BYTES);
    const ok = files.filter((f) => f.size <= AD.MAX_DOC_BYTES);
    if (tooBig.length) toast(`${tooBig.map((f) => f.name).join(', ')} ${tooBig.length === 1 ? 'is' : 'are'} over ${AD.fmtBytes(AD.MAX_DOC_BYTES)} and wasn’t uploaded`, 'error');
    if (!ok.length) return;
    let done = 0;
    const failed = [];
    for (const f of ok) {
      uploading = ok.length === 1 ? `Uploading ${f.name}…` : `Uploading ${done + 1} of ${ok.length} — ${f.name}…`;
      draw();
      try { await AD.store.uploadEmployeeDocument(f, e.id); done++; } catch (err) { failed.push(`${f.name} (${err.message})`); }
    }
    uploading = '';
    if (done) {
      await AD.store.log(`${done} document${done === 1 ? '' : 's'} added to ${e.name}’s employee profile`);
      toast(`${done} document${done === 1 ? '' : 's'} uploaded`);
    }
    if (failed.length) toast('Could not upload: ' + failed.join('; '), 'error');
    draw();
  }

  async function viewDoc(doc) {
    // Open the tab straight away (inside the click) so pop-up blockers allow it,
    // then point it at a short-lived signed link once Supabase returns one.
    const w = window.open('', '_blank');
    try {
      const url = await AD.store.signDocumentUrl(doc.storagePath, 300);
      if (w) w.location.href = url; else location.href = url;
    } catch (err) {
      if (w) w.close();
      AD.ui.toast('Could not open document: ' + err.message, 'error');
    }
  }

  function bindDocs(el, e) {
    const zone = el.querySelector('#emp-drop');
    if (!zone) return;
    const input = el.querySelector('#emp-doc-input');
    zone.addEventListener('click', () => { if (!uploading) input.click(); });
    zone.addEventListener('keydown', (ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && !uploading) { ev.preventDefault(); input.click(); } });
    input.addEventListener('change', () => uploadDocs([...input.files], e));
    dropTarget(zone, (files) => uploadDocs(files, e));
    const find = (id) => docsFor(e.id).find((d) => d.id === id);
    el.querySelectorAll('[data-doc-view]').forEach((b) => (b.onclick = () => viewDoc(find(b.dataset.docView))));
    el.querySelectorAll('[data-doc-dl]').forEach((b) => (b.onclick = () => AD.openDocument(find(b.dataset.docDl))));
    el.querySelectorAll('[data-doc-del]').forEach((b) => (b.onclick = async () => {
      const doc = find(b.dataset.docDel);
      if (!doc) return;
      const yes = await AD.ui.confirm({ title: 'Delete document?', message: `Delete <b>${esc(doc.name)}</b> from ${esc(e.name)}’s profile? The file is permanently removed and can’t be recovered.`, confirmText: 'Delete', danger: true });
      if (!yes) return;
      try {
        await AD.store.removeEmployeeDocument(doc);
        await AD.store.log(`Document removed from ${e.name}’s employee profile`);
        AD.ui.toast('Document deleted');
      } catch (err) { return AD.ui.toast('Could not delete document: ' + err.message, 'error'); }
      draw();
    }));
  }

  // ----------------------------------------------------------- devices
  /** Devices this person holds, from the Technology register. Hidden until
   *  that register's table exists (create-tech-devices.sql). */
  function devicesSection(e) {
    if (!AD.devices || !AD.store.available('tech_devices')) return '';
    const devs = AD.devices.devicesFor(e.id).slice().sort((a, b) => String(a.type).localeCompare(String(b.type)) || String(a.make).localeCompare(String(b.make)));
    return `<div class="emp-devices">
      ${sectionHead({
        title: 'Devices',
        meta: devs.length ? `${devs.length} from the technology register` : '',
        level: 3,
        actions: `<button type="button" class="btn btn-ghost btn-sm" data-add-dev>${I.plus} Add device</button>`
      })}
      ${devs.length
        ? `<ul class="emp-dev-list">${devs.map((d) => `<li data-dev="${esc(d.id)}" title="Open ${esc(d.make)}">
            <span class="emp-dev-name"><b>${esc(d.make)}</b><span class="t2">${esc([d.type, d.assetTag, d.mobile].filter(Boolean).join(' · '))}</span></span>
            ${badge(d.status, AD.devices.IT_TONE[d.status] || 'grey')}
          </li>`).join('')}</ul>`
        : `<div class="empty-tidy">${I.monitor}No devices assigned to ${esc(firstName(e.name))}.</div>`}
    </div>`;
  }

  /** Equipment this person is responsible for, from the Equipment register.
   *  Hidden until that register's table exists (create-equipment.sql). */
  function equipmentSection(e) {
    if (!AD.equipment || !AD.store.available('equipment')) return '';
    const soon = AD.equipment.INSPECT_SOON_DAYS || 30;
    const today = T.todayKey();
    const items = AD.equipment.equipmentFor(e.id).slice().sort((a, b) => String(a.category).localeCompare(String(b.category)) || String(a.name).localeCompare(String(b.name)));
    const due = (x) => {
      if (!x.nextInspection) return '';
      const days = T.daysBetween(today, String(x.nextInspection).slice(0, 10));
      return days < 0 ? ` · <span class="flag flag-red">Inspection overdue ${-days}d</span>` : days <= soon ? ` · <span class="flag flag-amber">Inspection due in ${days}d</span>` : '';
    };
    return `<div class="emp-devices">
      ${sectionHead({
        title: 'Equipment',
        meta: items.length ? `${items.length} from the equipment register` : '',
        level: 3,
        actions: `<button type="button" class="btn btn-ghost btn-sm" data-add-eq>${I.plus} Add equipment</button>`
      })}
      ${items.length
        ? `<ul class="emp-dev-list">${items.map((x) => `<li data-eq="${esc(x.id)}" title="Open ${esc(x.name)}">
            <span class="emp-dev-name"><b>${esc(x.name)}</b><span class="t2">${esc([x.make, x.assetTag].filter(Boolean).join(' · ') || x.category)}${due(x)}</span></span>
            ${badge(x.status, AD.equipment.EQ_TONE[x.status] || 'grey')}
          </li>`).join('')}</ul>`
        : `<div class="empty-tidy">${I.box}No equipment assigned to ${esc(firstName(e.name))}.</div>`}
    </div>`;
  }

  // -------------------------------------------------------------- page
  function draw() {
    const el = root;
    destroyMaps(); // the old page's maps are about to be replaced
    const back = `<nav class="crumbs" aria-label="Breadcrumb"><a href="#/employee-register">Employee register</a>${I.chevR}<span aria-current="page">${esc((AD.store.get('employees', empId) || {}).name || 'Employee')}</span></nav>`;
    if (!AD.store.available('employees')) {
      el.innerHTML = `${back}<p class="empty">The employee register hasn’t been set up yet. Run <code>supabase/create-employees.sql</code> in the Supabase SQL Editor, then refresh.</p>`;
      return;
    }
    const e = AD.store.get('employees', empId);
    if (!e) {
      el.innerHTML = `${back}<p class="empty">This employee wasn’t found. They may have been removed from the register.</p>`;
      return;
    }
    const { teamOf, licenceStates, licenceRel, LIC_TONE } = AD.employees;
    const team = teamOf(e);
    const licences = licenceStates(e);
    const expiredN = licences.filter((l) => l.state === 'expired').length;
    const soonN = licences.filter((l) => l.state === 'soon').length;
    const vehicles = vehiclesFor(e);
    const today = T.todayKey();
    const telHref = e.mobile ? 'tel:' + e.mobile.replace(/[^\d+]/g, '') : '';
    const place = [e.suburb, e.state, e.postcode].filter(Boolean).join(' ');

    const details = [
      ['Mobile', e.mobile ? `<a href="${esc(telHref)}">${esc(e.mobile)}</a>` : '<span class="muted">Not recorded</span>'],
      ['Email', e.email ? `<a href="mailto:${esc(e.email)}">${esc(e.email)}</a>` : '<span class="muted">Not recorded</span>'],
      ['Date of birth', e.dateOfBirth ? `${T.fmtKey(e.dateOfBirth)}<span class="t2">Age ${yearsBetween(e.dateOfBirth, today)}</span>` : '<span class="muted">Not recorded</span>'],
      ['Address', (e.address || place) ? `${e.address ? esc(e.address) : ''}${place ? `<span class="${e.address ? 't2' : ''}">${esc(place)}</span>` : ''}` : '<span class="muted">Not recorded</span>'],
      ['Licences applied', e.licencesApplied ? esc(e.licencesApplied) : '<span class="muted">None recorded</span>'],
      ['Team', `${esc(team)}${e.team ? '' : '<span class="t2">Set automatically from position</span>'}`]
    ];

    el.innerHTML = `
      ${back}
      <header class="veh-hero emp-hero">
        ${avatar(e)}
        <div class="veh-ident">
          <h1>${esc(e.name)}</h1>
          <p class="veh-model">${e.position ? esc(e.position) : 'No position recorded'}</p>
          ${badge(team, team === 'Unassigned' ? 'grey ring' : 'blue')}
        </div>
        <dl class="veh-facts">
          <div><dt>Commenced</dt><dd>${e.startDate ? T.fmtKey(e.startDate) : dash}</dd></div>
          <div><dt>With Astrea</dt><dd>${e.startDate ? esc(tenure(e.startDate)) : dash}</dd></div>
          <div><dt>Licences & tickets</dt><dd>${licences.length}${expiredN ? ` <span class="flag flag-red">${expiredN} expired</span>` : soonN ? ` <span class="flag flag-amber">${soonN} expiring</span>` : ''}</dd></div>
          ${docsReady() ? `<div><dt>Documents</dt><dd>${docsFor(e.id).length}</dd></div>` : ''}
        </dl>
        <div class="veh-actions">
          ${e.mobile ? `<a class="btn btn-secondary" href="${esc(telHref)}">Call</a>` : ''}
          ${e.email ? `<a class="btn btn-secondary" href="mailto:${esc(e.email)}">Email</a>` : ''}
          <button class="btn btn-primary" data-edit-emp>${I.edit} Edit employee</button>
        </div>
      </header>

      <div class="veh-tabbar emp-tabbar">
        <div class="tabs" role="tablist">
          ${[['overview', 'Employee overview'], ['rates', 'Rates']].map(([k, label]) => `
            <button role="tab" data-tab="${k}" class="${tab === k ? 'on' : ''}" aria-selected="${tab === k}">${label}</button>`).join('')}
        </div>
      </div>

      ${tab === 'rates' ? `<div role="tabpanel">${AD.employeeRates.panel(e)}</div>` : `<div role="tabpanel">
      <div class="cols-2">
        <section class="section">
          ${sectionHead({ title: 'Contact & personal details', level: 3 })}
          <dl class="emp-details">${details.map(([dt, dd]) => `<div><dt>${esc(dt)}</dt><dd>${dd}</dd></div>`).join('')}</dl>
          ${devicesSection(e)}
          ${equipmentSection(e)}
        </section>
        <section class="section">
          ${sectionHead({
            title: 'Licences & tickets',
            meta: [licences.length ? `${licences.length} recorded` : '', expiredN ? `<span class="flag flag-red">${expiredN} expired</span>` : '', soonN ? `<span class="flag flag-amber">${soonN} expiring soon</span>` : ''].filter(Boolean).join(' · '),
            level: 3,
            actions: `<button type="button" class="btn btn-ghost btn-sm" data-edit-lic>${I.edit} Edit</button>`
          })}
          ${licences.length
            ? `<ul class="emp-lic-list">${licences.map((l) => `<li class="${LIC_TONE[l.state] ? 'is-' + LIC_TONE[l.state] : ''}">
                <span class="emp-lic-name">${esc(l.name)}</span>
                <span class="emp-lic-exp">${l.expiry
                  ? `${T.fmtKey(l.expiry)}${LIC_TONE[l.state] ? `<span class="flag flag-${LIC_TONE[l.state]}">${esc(licenceRel(l))}</span>` : ''}`
                  : '<span class="muted">No expiry</span>'}</span>
              </li>`).join('')}</ul>`
            : `<div class="empty-tidy">${I.file}No licences or tickets recorded for ${esc(firstName(e.name))} yet.</div>`}

          ${sectionHead({ title: 'Assigned vehicles', meta: vehicles.length ? `${vehicles.length} in the fleet · live location from GPS` : '', level: 3 })}
          ${vehicles.length
            ? vehicles.map((v, i) => `<ul class="rows emp-vehicles"><li class="link" data-veh="${esc(v.id)}">
                <span class="id">${esc(v.id)}</span>
                <span class="what">${esc(v.make || '')} ${esc((v.model || '').split(' — ')[0])}<span class="t2">${esc(v.rego || '')} · ${esc(v.type || '')}</span></span>
                <span class="when">${vehicleBadge(v.status)}</span>
              </li></ul>${i < 3 ? liveBox(v) : ''}`).join('')
            : `<div class="empty-tidy">${I.truck}<span>No fleet vehicles are assigned to ${esc(firstName(e.name))}.<span class="empty-hint">Set them as the Assigned driver on a vehicle in the Fleet register to see it here, with its live location.</span></span></div>`}
        </section>
      </div>

      ${documentsSection(e)}
      </div>`}`;

    const openForm = () => AD.employeeForm(e, (saved) => (saved ? draw() : AD.go('employee-register')));
    el.querySelector('[data-edit-emp]').onclick = openForm;
    el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      tab = b.dataset.tab;
      AD.setParams({ tab: tab === 'overview' ? '' : tab });
      draw();
    }));
    bindPhoto(el, e);
    if (tab === 'rates') {
      AD.employeeRates.bind(el, e, draw);
      // First visit this session: ask the database whether this user may see rates, then redraw.
      if (AD.store.available('employee_rates') && !AD.employeeRates.hasChecked()) AD.employeeRates.checkAccess().then(() => { if (root === el && tab === 'rates') draw(); });
      return;
    }
    const editLic = el.querySelector('[data-edit-lic]');
    if (editLic) editLic.onclick = openForm;
    el.querySelectorAll('li[data-veh]').forEach((li) => li.addEventListener('click', () => AD.go('vehicle/' + li.dataset.veh)));
    // Devices: click one to open its profile; "Add device" opens a new one already assigned to this person.
    el.querySelectorAll('li[data-dev]').forEach((li) => li.addEventListener('click', () => AD.go('device/' + li.dataset.dev)));
    const addDev = el.querySelector('[data-add-dev]');
    if (addDev) addDev.onclick = () => AD.deviceForm(null, () => draw(), { employeeId: e.id });
    // Equipment: same pattern — click to open the item's profile, or add one already assigned here.
    el.querySelectorAll('li[data-eq]').forEach((li) => li.addEventListener('click', () => AD.go('equipment/' + li.dataset.eq)));
    const addEq = el.querySelector('[data-add-eq]');
    if (addEq) addEq.onclick = () => AD.equipmentForm(null, () => draw(), { employeeId: e.id });
    bindDocs(el, e);
    bindLive(el);
  }

  return {
    title: (arg) => (AD.store.get('employees', arg) || {}).name || 'Employee',
    render(el, params, arg) { root = el; empId = arg || ''; uploading = ''; tab = params && params.tab === 'rates' ? 'rates' : 'overview'; draw(); },
    // Don't redraw mid-upload (the progress text lives in the drop zone).
    refresh: () => root && !uploading && draw(),
    destroy: () => { destroyMaps(); root = null; }
  };
})();
