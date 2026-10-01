/* Defects + report / resolve forms */
AD.views = AD.views || {};

AD.DEFECT_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
AD.DEFECT_STATUSES = ['Open', 'In progress', 'Resolved'];

AD.defectForm = function (vehicleId) {
  const { options, formData, showErrors, modal, toast, photoPicker } = AD.ui;
  const T = AD.time;
  const vehicles = AD.store.all('vehicles').slice().sort((a, b) => a.id.localeCompare(b.id));
  const today = T.todayKey();
  modal({
    title: 'Report a defect',
    body: `
      <form class="form-grid" novalidate>
        <div class="field full"><label>Vehicle <span class="req">*</span></label>
          <select name="vehicleId">${options(vehicles.map((v) => [v.id, `${v.id} · ${v.rego} · ${v.type}`]), vehicleId, 'Select a vehicle')}</select></div>
        <div class="field full"><label>Description <span class="req">*</span></label>
          <textarea name="description" rows="3" placeholder="What’s wrong, where on the vehicle, and any safety impact"></textarea></div>
        <div class="field full">
          <label>Photos <span class="help" style="font-weight:400;color:var(--muted)">(optional, up to 8)</span></label>
          <div id="defect-photos"></div>
        </div>
        <div class="field"><label>Priority</label><select name="priority">${options(AD.DEFECT_PRIORITIES, 'Medium')}</select>
          <div class="help">Critical = unsafe to operate.</div></div>
        <div class="field"><label>Status</label><select name="status">${options(['Open', 'In progress'], 'Open')}</select></div>
        <div class="field"><label>Reported by <span class="req">*</span></label><input type="text" name="reportedBy" list="drv-list" placeholder="Name">
          <datalist id="drv-list">${AD.store.all('drivers').map((d) => `<option value="${AD.ui.esc(d.name)}">`).join('')}</datalist></div>
        <div class="field"><label>Date reported</label><input type="date" name="reportedDate" value="${today}" max="${today}"></div>
        <div class="field full hide" id="oos-wrap"><label class="check"><input type="checkbox" name="markOOS" checked> Also set the vehicle to <b>Out of service</b></label></div>
      </form>
      <div class="form-actions">
        <button class="btn btn-ghost" data-close type="button">Cancel</button>
        <button class="btn btn-primary" data-save type="button">Report defect</button>
      </div>`,
    onMount(el, close) {
      const f = el.querySelector('form');
      el.querySelector('[data-close]').onclick = close;
      const upd = () => el.querySelector('#oos-wrap').classList.toggle('hide', f.priority.value !== 'Critical');
      f.priority.addEventListener('change', upd);
      const picker = photoPicker(el.querySelector('#defect-photos'), [], { label: 'Defect photo' });
      const saveBtn = el.querySelector('[data-save]');
      saveBtn.onclick = async () => {
        const d = formData(f);
        const err = {};
        if (!d.vehicleId) err.vehicleId = 'Choose a vehicle.';
        if (d.description.length < 5) err.description = 'Describe the defect (at least a few words).';
        if (!d.reportedBy) err.reportedBy = 'Who reported it?';
        if (d.reportedDate > today) err.reportedDate = 'Can’t be in the future.';
        if (!showErrors(f, err)) return;
        saveBtn.disabled = true;
        try {
          await AD.store.insert('defects', {
            vehicleId: d.vehicleId, description: d.description, priority: d.priority, status: d.status,
            reportedBy: d.reportedBy, reportedDate: d.reportedDate || today, resolvedDate: null, resolutionNotes: '',
            photos: picker.get(), resolvedPhotos: []
          }, 'def');
          if (d.priority === 'Critical' && d.markOOS) await AD.store.update('vehicles', d.vehicleId, { status: 'Out of service' });
          await AD.store.log(`Defect reported on ${d.vehicleId}: ${d.description.slice(0, 60)} (${d.priority})`, d.vehicleId);
        } catch (err2) {
          saveBtn.disabled = false;
          toast('Could not report defect: ' + err2.message, 'error');
          return;
        }
        toast(`Defect reported on ${d.vehicleId}`);
        close();
      };
    }
  });
};

AD.resolveDefect = function (defectId) {
  const { esc, modal, toast, photoPicker } = AD.ui;
  const T = AD.time;
  const d = AD.store.get('defects', defectId);
  if (!d) return;
  modal({
    title: `Resolve defect — ${d.vehicleId}`,
    body: `
      <p class="modal-lede" style="color:var(--ink)">${esc(d.description)}</p>
      <form novalidate>
        <div class="field"><label>Resolution notes</label><textarea name="notes" rows="3" placeholder="What was done to fix it"></textarea></div>
        <div class="field">
          <label>Resolution photos <span class="help" style="font-weight:400;color:var(--muted)">(optional, up to 8)</span></label>
          <div id="resolve-photos"></div>
        </div>
      </form>
      <div class="form-actions">
        <button class="btn btn-ghost" data-close type="button">Cancel</button>
        <button class="btn btn-primary" data-save type="button">${AD.icons.check} Mark as resolved</button>
      </div>`,
    onMount(el, close) {
      el.querySelector('[data-close]').onclick = close;
      const picker = photoPicker(el.querySelector('#resolve-photos'), d.resolvedPhotos || [], { label: 'Resolution photo' });
      const saveBtn = el.querySelector('[data-save]');
      saveBtn.onclick = async () => {
        const notes = el.querySelector('textarea').value.trim();
        saveBtn.disabled = true;
        try {
          await AD.store.update('defects', d.id, { status: 'Resolved', resolvedDate: T.todayKey(), resolutionNotes: notes, resolvedPhotos: picker.get() });
          await AD.store.log(`Defect resolved on ${d.vehicleId}: ${d.description.slice(0, 60)}`, d.vehicleId);
        } catch (err) {
          saveBtn.disabled = false;
          toast('Could not resolve defect: ' + err.message, 'error');
          return;
        }
        toast(`Defect on ${d.vehicleId} marked resolved`);
        close();
      };
    }
  });
};

// Shared across the Defects page and the vehicle Defects tab: open the lightbox
// with the defect's reported photos first, then any resolution photos. Does
// nothing when there are no photos (callers hide the button in that case).
AD.viewDefectPhotos = function (defectId, startWith = 'reported') {
  const d = AD.store.get('defects', defectId);
  if (!d) return;
  const reported = (d.photos || []);
  const resolved = (d.resolvedPhotos || []);
  const all = reported.concat(resolved);
  if (!all.length) return;
  AD.ui.photoLightbox(all, startWith === 'resolved' ? reported.length : 0);
};

/** HTML for a small camera chip showing the defect's photo count (empty string if none). */
AD.defectPhotoChip = function (d) {
  const n = (d.photos || []).length + (d.resolvedPhotos || []).length;
  if (!n) return '';
  return `<button type="button" class="photo-chip" data-photos="${d.id}" title="${n} photo${n === 1 ? '' : 's'}" aria-label="View ${n} photo${n === 1 ? '' : 's'}">${AD.icons.camera}<span>${n}</span></button>`;
};

AD.views.defects = (function () {
  const { esc, options, priorityBadge, defectBadge, toast, pageHeader } = AD.ui;
  const T = AD.time, I = AD.icons, L = AD.logic;
  let root = null, st = {};

  function render(el, params) {
    root = el;
    st = { status: params.status || 'open', priority: params.priority || '', vehicle: params.vehicle || '' };
    const vehicles = AD.store.all('vehicles').map((v) => v.id).sort();
    const open = L.openDefects();
    const urgent = open.filter((d) => d.priority === 'Critical' || d.priority === 'High').length;
    el.innerHTML = `
      ${pageHeader({
        title: 'Defects',
        sub: `${open.length} open${urgent ? ` · <span class="flag flag-red">${urgent} high or critical</span>` : ''}`,
        actions: `<button class="btn btn-primary" id="new-def">${I.plus} Report defect</button>`
      })}
      <div class="toolbar">
        <select id="d-status" aria-label="Status">${options([['open', 'Open and in progress'], ['Open', 'Open'], ['In progress', 'In progress'], ['Resolved', 'Resolved'], ['all', 'All statuses']], st.status)}</select>
        <select id="d-priority" aria-label="Priority">${options(AD.DEFECT_PRIORITIES, st.priority, 'All priorities')}</select>
        <select id="d-vehicle" aria-label="Vehicle">${options(vehicles, st.vehicle, 'All vehicles')}</select>
        <span class="count" id="d-count"></span>
      </div>
      <div class="table-wrap"><table class="data">
        <thead><tr><th style="width:96px">Vehicle</th><th>Description</th><th>Priority</th><th class="col-opt">Status</th><th class="col-opt">Reported</th><th class="col-action col-opt"><span class="hide">Actions</span></th></tr></thead>
        <tbody id="d-body"></tbody></table></div>`;
    el.querySelector('#new-def').onclick = () => AD.defectForm(st.vehicle);
    [['#d-status', 'status'], ['#d-priority', 'priority'], ['#d-vehicle', 'vehicle']].forEach(([s, k]) =>
      el.querySelector(s).addEventListener('change', (e) => { st[k] = e.target.value; AD.setParams(st); rows(); }));
    rows();
    if (params.new) { AD.setParams(Object.assign({}, st)); AD.defectForm(''); }
  }

  function rows() {
    const P = { Critical: 0, High: 1, Medium: 2, Low: 3 };
    const all = AD.store.all('defects');
    const list = all.filter((d) => {
      if (st.status === 'open' && d.status === 'Resolved') return false;
      if (!['open', 'all'].includes(st.status) && d.status !== st.status) return false;
      if (st.priority && d.priority !== st.priority) return false;
      if (st.vehicle && d.vehicleId !== st.vehicle) return false;
      return true;
    }).sort((a, b) => (a.status === 'Resolved') - (b.status === 'Resolved') || P[a.priority] - P[b.priority] || b.reportedDate.localeCompare(a.reportedDate));

    root.querySelector('#d-count').textContent = `${list.length} defect${list.length === 1 ? '' : 's'}`;
    const body = root.querySelector('#d-body');
    body.innerHTML = list.map((d) => {
      const resolved = d.status === 'Resolved';
      const actions = `${d.status === 'Open' ? `<button class="btn btn-link" data-prog="${d.id}">Start work</button>` : ''}
        ${!resolved ? `<button class="btn btn-link" data-resolve="${d.id}">Resolve</button>` : `<button class="btn btn-link" data-reopen="${d.id}">Reopen</button>`}`;
      return `<tr class="${resolved ? 'muted-row' : ''}">
      <td><a class="id" href="#/vehicle/${d.vehicleId}?tab=defects">${esc(d.vehicleId)}</a></td>
      <td><span class="defect-desc">${esc(d.description)} ${AD.defectPhotoChip(d)}</span>
        ${resolved ? `<span class="t2">Resolved ${T.fmtKey(d.resolvedDate)}${d.resolutionNotes ? ' — ' + esc(d.resolutionNotes) : ''}</span>` : ''}
        <span class="t2 only-mobile">${defectBadge(d.status)} · Reported ${T.fmtKey(d.reportedDate)} · ${esc(d.reportedBy)}</span>
        <span class="m-actions">${actions}</span></td>
      <td>${priorityBadge(d.priority, resolved)}</td>
      <td class="col-opt">${defectBadge(d.status)}</td>
      <td class="nowrap col-opt">${T.fmtKey(d.reportedDate)}<span class="t2">${esc(d.reportedBy)}</span></td>
      <td class="col-action col-opt">${actions}</td></tr>`;
    }).join('') || '<tr><td colspan="6" class="empty">No defects match these filters.</td></tr>';

    body.querySelectorAll('[data-photos]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); AD.viewDefectPhotos(b.dataset.photos); }));
    body.querySelectorAll('[data-resolve]').forEach((b) => (b.onclick = () => AD.resolveDefect(b.dataset.resolve)));
    body.querySelectorAll('[data-prog]').forEach((b) => (b.onclick = async () => {
      try {
        const d = await AD.store.update('defects', b.dataset.prog, { status: 'In progress' });
        await AD.store.log(`Work started on ${d.vehicleId} defect: ${d.description.slice(0, 50)}`, d.vehicleId);
        toast(`Defect on ${d.vehicleId} set to In progress`);
      } catch (err) { toast('Could not update defect: ' + err.message, 'error'); }
    }));
    body.querySelectorAll('[data-reopen]').forEach((b) => (b.onclick = async () => {
      try {
        const d = await AD.store.update('defects', b.dataset.reopen, { status: 'Open', resolvedDate: null, resolutionNotes: '' });
        await AD.store.log(`Defect reopened on ${d.vehicleId}`, d.vehicleId);
        toast(`Defect on ${d.vehicleId} reopened`);
      } catch (err) { toast('Could not reopen defect: ' + err.message, 'error'); }
    }));
  }

  // Full re-render so the header counts stay current after a change.
  return { title: 'Defects', render, refresh: () => root && render(root, Object.assign({}, st)) };
})();
