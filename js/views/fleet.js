/* Fleet register + add/edit vehicle form */
AD.views = AD.views || {};

AD.VEHICLE_TYPES = ['Vac truck', 'Ute', 'Van', 'Car', 'Tipper truck', 'Excavator', 'Trailer', 'Other'];
AD.VEHICLE_STATUSES = ['Available', 'In use', 'In workshop', 'Out of service'];

/** Add / edit vehicle modal. Calls onSaved(vehicle) after saving.
 *  If called with just { hired: true } (no id), opens the form in hired mode. */
AD.vehicleForm = function (vehicle, onSaved) {
  const { esc, options, formData, showErrors, modal, toast } = AD.ui;
  const T = AD.time;
  const seedHired = vehicle && vehicle.hired && !vehicle.id;
  const isNew = !vehicle || seedHired;
  const v = (!isNew ? vehicle : null) || {
    id: '', rego: '', make: '', model: '', year: new Date().getFullYear(), type: seedHired ? 'Vac truck' : 'Ute', driverId: '', odometer: 0,
    status: seedHired ? 'In use' : 'Available', regoExpiry: T.addDays(T.todayKey(), 365), nextServiceDate: T.addDays(T.todayKey(), 180),
    nextServiceKm: 10000, serviceIntervalKm: 10000, serviceIntervalMonths: 6, notes: '',
    hired: !!seedHired, hireCompany: ''
  };
  const drivers = AD.store.all('drivers').map((d) => [d.id, d.name]);
  const hiredMode = !!v.hired;
  const companies = [...new Set(AD.store.all('vehicles').filter((x) => x.hired && x.hireCompany).map((x) => x.hireCompany))].sort();

  modal({
    title: isNew ? 'Add vehicle' : `Edit ${v.id}`,
    wide: true,
    body: `
      <form class="form-grid" novalidate>
        <div class="form-section-title full"><b>Vehicle details</b><span>Identification and assignment</span></div>
        <div class="field"><label>Fleet ID <span class="req">*</span></label>
          <input type="text" name="id" value="${esc(v.id)}" ${isNew ? '' : 'disabled'} placeholder="e.g. UTE-03" maxlength="12">
          ${isNew ? '<div class="help">Unique short code, e.g. UTE-03.</div>' : ''}</div>
        <div class="field"><label>Registration <span class="req">*</span></label>
          <input type="text" name="rego" value="${esc(v.rego)}" maxlength="10"></div>
        <div class="field"><label>Make <span class="req">*</span></label><input type="text" name="make" value="${esc(v.make)}"></div>
        <div class="field"><label>Model <span class="req">*</span></label><input type="text" name="model" value="${esc(v.model)}"></div>
        <div class="field"><label>Vehicle type</label><select name="type">${options(AD.VEHICLE_TYPES, v.type)}</select></div>
        <div class="field"><label>Year</label><input type="number" name="year" value="${esc(v.year)}" min="1980" max="2100"></div>
        ${hiredMode
          ? `<div class="field"><label>Hire company <span class="req">*</span></label>
               <input type="text" name="hireCompany" value="${esc(v.hireCompany)}" list="hired-co-list" placeholder="e.g. Quinnex">
               <datalist id="hired-co-list">${companies.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>`
          : `<div class="field"><label>Assigned driver</label><select name="driverId">${options(drivers, v.driverId, 'Unassigned')}</select></div>`}
        <div class="form-section-title full"><b>Fleet status and servicing</b><span>Current operating and compliance information</span></div>
        <div class="field"><label>Status</label><select name="status">${options(AD.VEHICLE_STATUSES, v.status)}</select></div>
        <div class="field"><label>Odometer (km) <span class="req">*</span></label><input type="number" name="odometer" value="${esc(v.odometer)}" min="0" step="1"></div>
        <div class="field"><label>Registration expiry <span class="req">*</span></label><input type="date" name="regoExpiry" value="${esc(v.regoExpiry)}"></div>
        <div class="field"><label>Next service date <span class="req">*</span></label><input type="date" name="nextServiceDate" value="${esc(v.nextServiceDate)}"></div>
        <div class="field"><label>Next service odometer (km) <span class="req">*</span></label><input type="number" name="nextServiceKm" value="${esc(v.nextServiceKm)}" min="0" step="1"></div>
        <div class="form-section-title full"><b>Identifiers and notes</b><span>Optional fleet reference details</span></div>
        <div class="field"><label>VIN</label><input type="text" name="vin" value="${esc(v.vin || '')}" maxlength="20"></div>
        <div class="field"><label>Variant / spec</label><input type="text" name="variant" value="${esc(v.variant || '')}"></div>
        <div class="field"><label>Linkt tag</label><input type="text" name="linktTag" value="${esc(v.linktTag || '')}"></div>
        <div class="field"><label>WRDT plant no.</label><input type="text" name="wrdtPlantNo" value="${esc(v.wrdtPlantNo || '')}"></div>
        <div class="field"><label>EVIE fob</label><input type="text" name="evieFob" value="${esc(v.evieFob || '')}"></div>
        <div class="field"><label>EVIE card</label><input type="text" name="evieCard" value="${esc(v.evieCard || '')}"></div>
        <div class="field full"><label>Notes</label><textarea name="notes" rows="2">${esc(v.notes)}</textarea></div>
      </form>
      <div class="form-actions">
        <button class="btn btn-ghost" data-close type="button">Cancel</button>
        <button class="btn btn-primary" data-save type="button">${isNew ? 'Add vehicle' : 'Save changes'}</button>
      </div>`,
    onMount(el, close) {
      const form = el.querySelector('form');
      el.querySelector('[data-close]').onclick = close;
      const saveBtn = el.querySelector('[data-save]');
      saveBtn.onclick = async () => {
        const d = formData(form);
        const err = {};
        const id = (isNew ? d.id : v.id).toUpperCase();
        if (isNew) {
          if (!/^[A-Z0-9-]{2,12}$/.test(id)) err.id = 'Use 2–12 letters, numbers or dashes.';
          else if (AD.store.get('vehicles', id)) err.id = 'That fleet ID is already in use.';
        }
        if (!d.rego) err.rego = 'Registration is required.';
        if (!hiredMode && !d.make) err.make = 'Make is required.';
        if (!hiredMode && !d.model) err.model = 'Model is required.';
        if (hiredMode && !d.hireCompany) err.hireCompany = 'Hire company is required.';
        const odo = Number(d.odometer);
        if (d.odometer === '' || !(odo >= 0)) err.odometer = 'Enter a valid odometer reading.';
        if (!d.regoExpiry) err.regoExpiry = 'Registration expiry is required.';
        if (!d.nextServiceDate) err.nextServiceDate = 'Next service date is required.';
        if (d.nextServiceKm === '' || !(Number(d.nextServiceKm) >= 0)) err.nextServiceKm = 'Enter a valid odometer value.';
        if (!showErrors(form, err)) return;

        const rec = {
          rego: d.rego.toUpperCase(), make: d.make, model: d.model, type: d.type, year: Number(d.year) || null,
          driverId: hiredMode ? '' : d.driverId, status: d.status, odometer: Math.round(odo), regoExpiry: d.regoExpiry,
          nextServiceDate: d.nextServiceDate, nextServiceKm: Math.round(Number(d.nextServiceKm)), notes: d.notes,
          vin: d.vin || null, variant: d.variant || null, linktTag: d.linktTag || null,
          wrdtPlantNo: d.wrdtPlantNo || null, evieFob: d.evieFob || null, evieCard: d.evieCard || null,
          hired: hiredMode, hireCompany: hiredMode ? (d.hireCompany || '') : ''
        };
        saveBtn.disabled = true;
        let saved;
        try {
          if (isNew) {
            saved = await AD.store.insert('vehicles', Object.assign({ id, serviceIntervalKm: 10000, serviceIntervalMonths: 6, lastServiceDate: null, lastServiceKm: rec.odometer }, rec));
            await AD.store.log(`${id} added to the fleet register`, id);
            toast(`${id} added`);
          } else {
            saved = await AD.store.update('vehicles', v.id, rec);
            await AD.store.log(`${v.id} details updated`, v.id);
            toast(`${v.id} saved`);
          }
        } catch (err2) {
          saveBtn.disabled = false;
          toast('Could not save vehicle: ' + err2.message, 'error');
          return;
        }
        close();
        onSaved && onSaved(saved);
      };
    }
  });
};

AD.views.fleet = (function () {
  const { esc, options, vehicleBadge, stateBadge } = AD.ui;
  const L = AD.logic, I = AD.icons;
  let st = {};
  let root = null;

  function render(el, params) {
    root = el;
    st = { section: params.section === 'hired' ? 'hired' : 'own', q: params.q || '', type: params.type || '', status: params.status || '', flag: params.flag || '', company: params.company || '' };
    draw();
  }

  function draw() {
    const all = AD.store.all('vehicles');
    const owned = all.filter((v) => !v.hired);
    const hired = all.filter((v) => v.hired);
    const isHired = st.section === 'hired';
    const vac = owned.filter((v) => v.type === 'Vac truck').length;
    const companies = [...new Set(hired.map((v) => v.hireCompany).filter(Boolean))].sort();

    const title = isHired ? 'Hired fleet' : 'Fleet register';
    const sub = isHired
      ? `${hired.length} hired vehicle${hired.length === 1 ? '' : 's'} across ${companies.length} compan${companies.length === 1 ? 'y' : 'ies'}`
      : `${owned.length} vehicles · ${vac} vac trucks, ${owned.length - vac} support vehicles`;

    const actions = isHired
      ? `<button class="btn btn-secondary" id="import-docs">${I.file} Import documents from folder</button><button class="btn btn-primary" id="add-veh">${I.plus} Add hired vehicle</button>`
      : `<button class="btn btn-primary" id="add-veh">${I.plus} Add vehicle</button>`;

    root.innerHTML = `
      ${AD.ui.pageHeader({ title, sub, actions })}
      <div class="seg" role="tablist" aria-label="Fleet section" style="margin-bottom:18px">
        <button role="tab" data-sec="own"   class="${!isHired ? 'on' : ''}" aria-selected="${!isHired}">Owned fleet <span class="t2">${owned.length}</span></button>
        <button role="tab" data-sec="hired" class="${isHired ? 'on' : ''}"  aria-selected="${isHired}">Hired fleet <span class="t2">${hired.length}</span></button>
      </div>
      <div class="toolbar">
        <div class="search">${I.search}<input type="search" id="f-q" placeholder="Search ID, rego, make, model${isHired ? ' or company' : ' or driver'}" value="${esc(st.q)}" aria-label="Search vehicles"></div>
        <select id="f-type" aria-label="Vehicle type">${options(AD.VEHICLE_TYPES, st.type, 'All types')}</select>
        <select id="f-status" aria-label="Status">${options(AD.VEHICLE_STATUSES, st.status, 'All statuses')}</select>
        ${isHired
          ? `<select id="f-company" aria-label="Hire company">${options(companies, st.company, 'All companies')}</select>`
          : `<select id="f-flag" aria-label="Alerts">${options([['service', 'Service due or overdue'], ['rego', 'Rego due or expired'], ['defects', 'Has open defects']], st.flag, 'Any alerts')}</select>`}
        <span class="count" id="f-count"></span>
      </div>
      <div class="table-wrap"><table class="data">
        <thead><tr>
          <th class="col-thumb" aria-hidden="true"></th>
          <th style="width:110px">Fleet ID</th>
          <th class="col-opt">Registration</th>
          <th class="col-model">Make / model</th>
          <th class="col-opt col-wide">Type</th>
          ${isHired
            ? '<th class="col-opt col-wide">Hire company</th>'
            : '<th class="col-opt">Assigned driver</th><th class="num col-opt col-wide">Odometer</th>'}
          <th>Status</th>
          ${isHired ? '<th class="col-opt" style="min-width:140px">Documents</th>' : '<th class="col-opt" style="min-width:360px">Needs attention</th>'}
          <th class="col-action col-opt col-wide"><span class="hide">Actions</span></th>
        </tr></thead>
        <tbody id="f-body"></tbody>
      </table></div>`;

    const bind = (id, key, ev = 'change') => { const node = root.querySelector(id); if (node) node.addEventListener(ev, (e) => { st[key] = e.target.value; sync(); }); };
    bind('#f-q', 'q', 'input'); bind('#f-type', 'type'); bind('#f-status', 'status');
    bind('#f-flag', 'flag'); bind('#f-company', 'company');
    root.querySelectorAll('[data-sec]').forEach((b) => b.addEventListener('click', () => {
      st = { section: b.dataset.sec, q: '', type: '', status: '', flag: '', company: '' };
      AD.setParams(st); draw();
    }));
    root.querySelector('#add-veh').onclick = () => AD.vehicleForm(st.section === 'hired' ? { hired: true } : null, (v) => AD.go('vehicle/' + v.id));
    const imp = root.querySelector('#import-docs');
    if (imp) imp.onclick = () => AD.importHiredDocs();
    rows();
  }

  function sync() { AD.setParams(st); rows(); }

  function rows() {
    const isHired = st.section === 'hired';
    const q = st.q.toLowerCase();
    const base = AD.store.all('vehicles').filter((v) => !!v.hired === isHired);
    const list = base.filter((v) => {
      if (st.type && v.type !== st.type) return false;
      if (st.status && v.status !== st.status) return false;
      if (!isHired) {
        if (st.flag === 'service' && L.serviceState(v).state === 'ok') return false;
        if (st.flag === 'rego' && L.regoState(v).state === 'ok') return false;
        if (st.flag === 'defects' && !L.openDefects(v.id).length) return false;
      }
      if (isHired && st.company && v.hireCompany !== st.company) return false;
      if (q) {
        const hay = [v.id, v.rego, v.make, v.model, v.type, isHired ? v.hireCompany : L.driverName(v.driverId)].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => isHired ? (a.hireCompany || '').localeCompare(b.hireCompany || '') || a.id.localeCompare(b.id) : a.id.localeCompare(b.id));

    root.querySelector('#f-count').textContent = `${list.length} of ${base.length} vehicles`;
    const body = root.querySelector('#f-body');
    const allDocs = AD.store.all('documents') || [];
    body.innerHTML = list.map((v) => {
      const alerts = isHired ? '' : AD.ui.attentionFlags(v);
      const [model, spec] = (v.model || '').split(' — ');
      const art = AD.art.forVehicle(v, 52) || `<span class="fleet-thumb-icon">${I.truck}</span>`;
      const docCount = allDocs.filter((d) => d.vehicleId === v.id && d.storagePath).length;
      return `<tr class="row-link" data-id="${v.id}" title="Open ${v.id}">
        <td class="col-thumb"><span class="fleet-thumb">${art}</span></td>
        <td><a class="id" href="#/vehicle/${v.id}">${esc(v.id)}</a><span class="t2 only-mobile">${esc(v.rego)}</span></td>
        <td class="col-opt">${esc(v.rego)}</td>
        <td>${esc(v.make || '')} ${esc(model || '')}<span class="t2">${esc(v.year || '')}${spec ? ' · ' + esc(spec) : ''}</span>${alerts ? `<span class="t2 only-mobile">${alerts}</span>` : ''}</td>
        <td class="col-opt col-wide">${esc(v.type)}</td>
        ${isHired
          ? `<td class="col-opt col-wide">${esc(v.hireCompany || '—')}</td>`
          : `<td class="col-opt">${v.driverId ? esc(L.driverName(v.driverId)) : '<span class="muted">Unassigned</span>'}</td>
             <td class="num col-opt col-wide">${L.fmtKm(v.odometer)}</td>`}
        <td>${vehicleBadge(v.status)}</td>
        ${isHired
          ? `<td class="col-opt">${docCount ? `<span class="flag flag-muted">${docCount} file${docCount === 1 ? '' : 's'}</span>` : '<span class="muted">None</span>'}</td>`
          : `<td class="col-opt">${alerts || AD.ui.dash}</td>`}
        <td class="col-action col-opt col-wide">
          <button class="btn btn-ghost btn-sm" data-edit="${v.id}" title="Edit ${esc(v.id)}" aria-label="Edit ${esc(v.id)}">${I.edit} Edit</button>
        </td></tr>`;
    }).join('') || `<tr><td colspan="${isHired ? 9 : 10}" class="empty">No vehicles match these filters.</td></tr>`;

    body.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', (e) => {
      if (e.target.closest('[data-edit]')) { AD.vehicleForm(AD.store.get('vehicles', tr.dataset.id)); return; }
      if (e.target.closest('a')) return;
      AD.go('vehicle/' + tr.dataset.id);
    }));
  }

  return { title: 'Fleet register', render, refresh: () => root && draw() };
})();
