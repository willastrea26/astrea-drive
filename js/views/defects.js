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
      <div class="defect-grid" id="d-grid" role="list" aria-live="polite"></div>`;
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
    const grid = root.querySelector('#d-grid');
    grid.innerHTML = list.map((d) => {
      const resolved = d.status === 'Resolved';
      const vehicle = AD.store.get('vehicles', d.vehicleId);
      const reportedPhotos = d.photos || [];
      const resolvedPhotos = d.resolvedPhotos || [];
      const photoCount = reportedPhotos.length + resolvedPhotos.length;
      const firstPhoto = reportedPhotos[0] || resolvedPhotos[0] || '';
      const priorityClass = String(d.priority || 'medium').toLowerCase();
      const media = firstPhoto
        ? `<button type="button" class="defect-card-media" data-photos="${d.id}" aria-label="View ${photoCount} photo${photoCount === 1 ? '' : 's'} for ${esc(d.vehicleId)} defect">
            <img src="${esc(firstPhoto)}" alt="${esc(d.vehicleId)} defect: ${esc(d.description)}" loading="lazy" decoding="async">
            <span class="defect-photo-count">${I.camera}<b>${photoCount}</b> photo${photoCount === 1 ? '' : 's'}</span>
          </button>`
        : `<div class="defect-card-media defect-card-media-empty" aria-label="No defect photo uploaded">
            ${I.camera}<span>No photo uploaded</span>
          </div>`;
      const actions = `${d.status === 'Open' ? `<button type="button" class="btn btn-secondary btn-sm" data-prog="${d.id}">Start work</button>` : ''}
        ${!resolved ? `<button type="button" class="btn btn-primary btn-sm" data-resolve="${d.id}">${I.check} Resolve</button>` : `<button type="button" class="btn btn-secondary btn-sm" data-reopen="${d.id}">Reopen</button>`}`;
      return `<article class="defect-card defect-card-${priorityClass}${resolved ? ' is-resolved' : ''}" role="listitem">
        ${media}
        <div class="defect-card-body">
          <div class="defect-card-head">
            <div class="defect-card-vehicle">
              <a class="id" href="#/vehicle/${d.vehicleId}?tab=defects">${esc(d.vehicleId)}</a>
              ${vehicle && vehicle.rego ? `<span>${esc(vehicle.rego)}</span>` : ''}
            </div>
            ${priorityBadge(d.priority, resolved)}
          </div>
          <p class="defect-card-desc" title="${esc(d.description)}">${esc(d.description)}</p>
          <dl class="defect-card-meta">
            <div><dt>Status</dt><dd>${defectBadge(d.status)}</dd></div>
            <div><dt>Reported</dt><dd>${T.fmtKey(d.reportedDate)}</dd></div>
            <div><dt>Reported by</dt><dd>${esc(d.reportedBy)}</dd></div>
            ${vehicle && vehicle.type ? `<div><dt>Vehicle type</dt><dd>${esc(vehicle.type)}</dd></div>` : ''}
          </dl>
          ${resolved ? `<div class="defect-resolution"><b>Resolved ${T.fmtKey(d.resolvedDate)}</b>${d.resolutionNotes ? `<span>${esc(d.resolutionNotes)}</span>` : ''}</div>` : ''}
        </div>
        <div class="defect-card-actions">${actions}</div>
      </article>`;
    }).join('') || `<div class="defect-grid-empty">${I.search}<b>No defects found</b><span>No defects match these filters.</span></div>`;

    grid.querySelectorAll('[data-photos]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); AD.viewDefectPhotos(b.dataset.photos); }));
    grid.querySelectorAll('[data-resolve]').forEach((b) => (b.onclick = () => AD.resolveDefect(b.dataset.resolve)));
    grid.querySelectorAll('[data-prog]').forEach((b) => (b.onclick = async () => {
      try {
        const d = await AD.store.update('defects', b.dataset.prog, { status: 'In progress' });
        await AD.store.log(`Work started on ${d.vehicleId} defect: ${d.description.slice(0, 50)}`, d.vehicleId);
        toast(`Defect on ${d.vehicleId} set to In progress`);
      } catch (err) { toast('Could not update defect: ' + err.message, 'error'); }
    }));
    grid.querySelectorAll('[data-reopen]').forEach((b) => (b.onclick = async () => {
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
