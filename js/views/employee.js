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
 * Assigned vehicles are found by matching the employee's name to the
 * fleet's driver list (the Fleet register's "Assigned driver"), since the
 * two lists aren't linked by ID.
 */
AD.views = AD.views || {};

AD.views.employee = (function () {
  const { esc, sectionHead, dash, badge, vehicleBadge } = AD.ui;
  const T = AD.time, I = AD.icons;
  let root = null, empId = '', uploading = '';

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

  // -------------------------------------------------------------- page
  function draw() {
    const el = root;
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
    const { teamOf, listOf } = AD.employees;
    const team = teamOf(e);
    const licences = listOf(e.licenceRegister);
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
          <div><dt>Licences & tickets</dt><dd>${licences.length}</dd></div>
          ${docsReady() ? `<div><dt>Documents</dt><dd>${docsFor(e.id).length}</dd></div>` : ''}
        </dl>
        <div class="veh-actions">
          ${e.mobile ? `<a class="btn btn-secondary" href="${esc(telHref)}">Call</a>` : ''}
          ${e.email ? `<a class="btn btn-secondary" href="mailto:${esc(e.email)}">Email</a>` : ''}
          <button class="btn btn-primary" data-edit-emp>${I.edit} Edit employee</button>
        </div>
      </header>

      <div class="cols-2">
        <section class="section">
          ${sectionHead({ title: 'Contact & personal details', level: 3 })}
          <dl class="emp-details">${details.map(([dt, dd]) => `<div><dt>${esc(dt)}</dt><dd>${dd}</dd></div>`).join('')}</dl>
        </section>
        <section class="section">
          ${sectionHead({ title: 'Licences & tickets', meta: licences.length ? `${licences.length} recorded` : '', level: 3 })}
          ${licences.length
            ? `<div class="reg-tags emp-tags">${licences.map((x) => `<span class="reg-tag">${esc(x)}</span>`).join('')}</div>`
            : `<div class="empty-tidy">${I.file}No licences or tickets recorded for ${esc(firstName(e.name))} yet.</div>`}

          ${sectionHead({ title: 'Assigned vehicles', meta: vehicles.length ? `${vehicles.length} in the fleet` : '', level: 3 })}
          ${vehicles.length
            ? `<ul class="rows emp-vehicles">${vehicles.map((v) => `<li class="link" data-veh="${esc(v.id)}">
                <span class="id">${esc(v.id)}</span>
                <span class="what">${esc(v.make || '')} ${esc((v.model || '').split(' — ')[0])}<span class="t2">${esc(v.rego || '')} · ${esc(v.type || '')}</span></span>
                <span class="when">${vehicleBadge(v.status)}</span>
              </li>`).join('')}</ul>`
            : `<div class="empty-tidy">${I.truck}No fleet vehicles are assigned to ${esc(firstName(e.name))}.</div>`}
        </section>
      </div>

      ${documentsSection(e)}`;

    el.querySelector('[data-edit-emp]').onclick = () => AD.employeeForm(e, (saved) => (saved ? draw() : AD.go('employee-register')));
    el.querySelectorAll('li[data-veh]').forEach((li) => li.addEventListener('click', () => AD.go('vehicle/' + li.dataset.veh)));
    bindPhoto(el, e);
    bindDocs(el, e);
  }

  return {
    title: (arg) => (AD.store.get('employees', arg) || {}).name || 'Employee',
    render(el, params, arg) { root = el; empId = arg || ''; uploading = ''; draw(); },
    // Don't redraw mid-upload (the progress text lives in the drop zone).
    refresh: () => root && !uploading && draw()
  };
})();
