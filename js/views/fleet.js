/* Fleet register + add/edit vehicle form */
AD.views = AD.views || {};

AD.VEHICLE_TYPES = ['Vac truck', 'Ute', 'Van', 'Tipper truck', 'Other'];
AD.VEHICLE_STATUSES = ['Available', 'In use', 'In workshop', 'Out of service'];

/** Add / edit vehicle modal. Calls onSaved(vehicle) after saving. */
AD.vehicleForm = function (vehicle, onSaved) {
  const { esc, options, formData, showErrors, modal, toast } = AD.ui;
  const T = AD.time;
  const isNew = !vehicle;
  const v = vehicle || {
    id: '', rego: '', make: '', model: '', year: new Date().getFullYear(), type: 'Ute', driverId: '', odometer: 0,
    status: 'Available', regoExpiry: T.addDays(T.todayKey(), 365), nextServiceDate: T.addDays(T.todayKey(), 180),
    nextServiceKm: 10000, serviceIntervalKm: 10000, serviceIntervalMonths: 6, notes: ''
  };
  const drivers = AD.store.all('drivers').map((d) => [d.id, d.name]);

  modal({
    title: isNew ? 'Add vehicle' : `Edit ${v.id}`,
    body: `
      <form class="form-grid" novalidate>
        <div class="field"><label>Fleet ID <span class="req">*</span></label>
          <input type="text" name="id" value="${esc(v.id)}" ${isNew ? '' : 'disabled'} placeholder="e.g. UTE-03" maxlength="12">
          ${isNew ? '<div class="help">Unique short code, e.g. UTE-03.</div>' : ''}</div>
        <div class="field"><label>Registration <span class="req">*</span></label>
          <input type="text" name="rego" value="${esc(v.rego)}" maxlength="10"></div>
        <div class="field"><label>Make <span class="req">*</span></label><input type="text" name="make" value="${esc(v.make)}"></div>
        <div class="field"><label>Model <span class="req">*</span></label><input type="text" name="model" value="${esc(v.model)}"></div>
        <div class="field"><label>Vehicle type</label><select name="type">${options(AD.VEHICLE_TYPES, v.type)}</select></div>
        <div class="field"><label>Year</label><input type="number" name="year" value="${esc(v.year)}" min="1980" max="2100"></div>
        <div class="field"><label>Assigned driver</label><select name="driverId">${options(drivers, v.driverId, 'Unassigned')}</select></div>
        <div class="field"><label>Status</label><select name="status">${options(AD.VEHICLE_STATUSES, v.status)}</select></div>
        <div class="field"><label>Odometer (km) <span class="req">*</span></label><input type="number" name="odometer" value="${esc(v.odometer)}" min="0" step="1"></div>
        <div class="field"><label>Registration expiry <span class="req">*</span></label><input type="date" name="regoExpiry" value="${esc(v.regoExpiry)}"></div>
        <div class="field"><label>Next service date <span class="req">*</span></label><input type="date" name="nextServiceDate" value="${esc(v.nextServiceDate)}"></div>
        <div class="field"><label>Next service odometer (km) <span class="req">*</span></label><input type="number" name="nextServiceKm" value="${esc(v.nextServiceKm)}" min="0" step="1"></div>
        <div class="field full"><label>Notes</label><textarea name="notes" rows="2">${esc(v.notes)}</textarea></div>
      </form>
      <div class="form-actions">
        <button class="btn btn-ghost" data-close type="button">Cancel</button>
        <button class="btn btn-primary" data-save type="button">${isNew ? 'Add vehicle' : 'Save changes'}</button>
      </div>`,
    onMount(el, close) {
      const form = el.querySelector('form');
      el.querySelector('[data-close]').onclick = close;
      el.querySelector('[data-save]').onclick = () => {
        const d = formData(form);
        const err = {};
        const id = (isNew ? d.id : v.id).toUpperCase();
        if (isNew) {
          if (!/^[A-Z0-9-]{2,12}$/.test(id)) err.id = 'Use 2–12 letters, numbers or dashes.';
          else if (AD.store.get('vehicles', id)) err.id = 'That fleet ID is already in use.';
        }
        if (!d.rego) err.rego = 'Registration is required.';
        if (!d.make) err.make = 'Make is required.';
        if (!d.model) err.model = 'Model is required.';
        const odo = Number(d.odometer);
        if (d.odometer === '' || !(odo >= 0)) err.odometer = 'Enter a valid odometer reading.';
        if (!d.regoExpiry) err.regoExpiry = 'Registration expiry is required.';
        if (!d.nextServiceDate) err.nextServiceDate = 'Next service date is required.';
        if (d.nextServiceKm === '' || !(Number(d.nextServiceKm) >= 0)) err.nextServiceKm = 'Enter a valid odometer value.';
        if (!showErrors(form, err)) return;

        const rec = {
          rego: d.rego.toUpperCase(), make: d.make, model: d.model, type: d.type, year: Number(d.year) || '',
          driverId: d.driverId, status: d.status, odometer: Math.round(odo), regoExpiry: d.regoExpiry,
          nextServiceDate: d.nextServiceDate, nextServiceKm: Math.round(Number(d.nextServiceKm)), notes: d.notes
        };
        let saved;
        if (isNew) {
          saved = AD.store.insert('vehicles', Object.assign({ id, serviceIntervalKm: 10000, serviceIntervalMonths: 6, lastServiceDate: '', lastServiceKm: rec.odometer }, rec));
          AD.store.log(`${id} added to the fleet register`, id);
          toast(`${id} added`);
        } else {
          saved = AD.store.update('vehicles', v.id, rec);
          AD.store.log(`${v.id} details updated`, v.id);
          toast(`${v.id} saved`);
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
    st = { q: params.q || '', type: params.type || '', status: params.status || '', flag: params.flag || '' };
    const all = AD.store.all('vehicles');
    const vac = all.filter((v) => v.type === 'Vac truck').length;
    el.innerHTML = `
      ${AD.ui.pageHeader({
        title: 'Fleet register',
        sub: `${all.length} vehicles · ${vac} vac trucks, ${all.length - vac} support vehicles`,
        actions: `<button class="btn btn-primary" id="add-veh">${I.plus} Add vehicle</button>`
      })}
      <div class="toolbar">
        <div class="search">${I.search}<input type="search" id="f-q" placeholder="Search ID, rego, make, model or driver" value="${esc(st.q)}" aria-label="Search vehicles"></div>
        <select id="f-type" aria-label="Vehicle type">${options(AD.VEHICLE_TYPES, st.type, 'All types')}</select>
        <select id="f-status" aria-label="Status">${options(AD.VEHICLE_STATUSES, st.status, 'All statuses')}</select>
        <select id="f-flag" aria-label="Alerts">${options([['service', 'Service due or overdue'], ['rego', 'Rego due or expired'], ['defects', 'Has open defects']], st.flag, 'Any alerts')}</select>
        <span class="count" id="f-count"></span>
      </div>
      <div class="table-wrap"><table class="data">
        <thead><tr>
          <th style="width:96px">Fleet ID</th><th class="col-opt">Registration</th><th class="col-model">Make / model</th><th class="col-opt col-wide">Type</th>
          <th class="col-opt">Assigned driver</th><th class="num col-opt col-wide">Odometer</th><th>Status</th><th class="col-opt">Needs attention</th><th class="col-action col-opt col-wide"><span class="hide">Actions</span></th>
        </tr></thead>
        <tbody id="f-body"></tbody>
      </table></div>`;

    const bind = (id, key, ev = 'change') => el.querySelector(id).addEventListener(ev, (e) => { st[key] = e.target.value; sync(); });
    bind('#f-q', 'q', 'input'); bind('#f-type', 'type'); bind('#f-status', 'status'); bind('#f-flag', 'flag');
    el.querySelector('#add-veh').onclick = () => AD.vehicleForm(null, (v) => AD.go('vehicle/' + v.id));
    rows();
  }

  function sync() { AD.setParams(st); rows(); }

  function rows() {
    const q = st.q.toLowerCase();
    const list = AD.store.all('vehicles').filter((v) => {
      if (st.type && v.type !== st.type) return false;
      if (st.status && v.status !== st.status) return false;
      if (st.flag === 'service' && L.serviceState(v).state === 'ok') return false;
      if (st.flag === 'rego' && L.regoState(v).state === 'ok') return false;
      if (st.flag === 'defects' && !L.openDefects(v.id).length) return false;
      if (q) {
        const hay = [v.id, v.rego, v.make, v.model, v.type, L.driverName(v.driverId)].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => a.id.localeCompare(b.id));

    root.querySelector('#f-count').textContent = `${list.length} of ${AD.store.all('vehicles').length} vehicles`;
    const body = root.querySelector('#f-body');
    body.innerHTML = list.map((v) => {
      const alerts = AD.ui.attentionFlags(v);
      const [model, spec] = v.model.split(' — ');
      return `<tr class="row-link" data-id="${v.id}" title="Open ${v.id}">
        <td><a class="id" href="#/vehicle/${v.id}">${esc(v.id)}</a><span class="t2 only-mobile">${esc(v.rego)}</span></td>
        <td class="col-opt">${esc(v.rego)}</td>
        <td>${esc(v.make)} ${esc(model)}<span class="t2">${esc(v.year)}${spec ? ' · ' + esc(spec) : ''}</span>${alerts ? `<span class="t2 only-mobile">${alerts}</span>` : ''}</td>
        <td class="col-opt col-wide">${esc(v.type)}</td>
        <td class="col-opt">${v.driverId ? esc(L.driverName(v.driverId)) : '<span class="muted">Unassigned</span>'}</td>
        <td class="num col-opt col-wide">${L.fmtKm(v.odometer)}</td>
        <td>${vehicleBadge(v.status)}</td>
        <td class="col-opt">${alerts || AD.ui.dash}</td>
        <td class="col-action col-opt col-wide">
          <button class="row-menu" data-edit="${v.id}" title="Edit ${esc(v.id)}" aria-label="Edit ${esc(v.id)}">${I.dots}</button>
        </td></tr>`;
    }).join('') || `<tr><td colspan="9" class="empty">No vehicles match these filters.</td></tr>`;

    body.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', (e) => {
      if (e.target.closest('[data-edit]')) { AD.vehicleForm(AD.store.get('vehicles', tr.dataset.id)); return; }
      if (e.target.closest('a')) return;
      AD.go('vehicle/' + tr.dataset.id);
    }));
  }

  // Full re-render so the header counts stay current after adding or editing a vehicle.
  return { title: 'Fleet register', render, refresh: () => root && render(root, Object.assign({}, st)) };
})();
