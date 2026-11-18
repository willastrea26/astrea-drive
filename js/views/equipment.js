/*
 * Equipment profile — opened from the Equipment register (#/equipment/<id>)
 * or an employee's Equipment list. Same shape as the device, employee and
 * vehicle profiles: breadcrumb, a header with a photo and the key facts, then
 * detail sections.
 *
 * Photo: drop an image on the photo box (top left); it's shrunk to a small
 * JPEG and stored on the item's own row. Until one is added, an icon for the
 * category stands in. Sample items (shown while the register is empty) open
 * read-only.
 */
AD.views = AD.views || {};

AD.views.equipment = (function () {
  const { esc, sectionHead, dash, badge } = AD.ui;
  const T = AD.time, I = AD.icons;
  let root = null, itemId = '';

  const CAT_ICON = { Surveying: 'pin', Locating: 'map', Civil: 'wrench', Safety: 'shield', 'Traffic control': 'alert' };
  const initials = (name) => String(name || '?').trim().split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const day10 = (v) => (v ? String(v).slice(0, 10) : '');
  const soonDays = () => (AD.equipment && AD.equipment.INSPECT_SOON_DAYS) || 30;

  /** Next inspection with a flag: amber when due soon, red when overdue. */
  function inspection(key) {
    if (!key) return { html: dash, flag: '' };
    const days = T.daysBetween(T.todayKey(), key);
    const flag = days < 0 ? `<span class="flag flag-red">Overdue ${-days}d</span>`
      : days === 0 ? '<span class="flag flag-amber">Due today</span>'
      : days <= soonDays() ? `<span class="flag flag-amber">Due in ${days}d</span>` : '';
    return { html: T.fmtKey(key), flag };
  }

  // ------------------------------------------------------------- photo
  function photoBox(x) {
    const icon = I[CAT_ICON[x.category] || 'box'] || I.box;
    if (x.sample) return `<div class="emp-avatar dev-photo" aria-hidden="true"><span class="dev-photo-icon">${icon}</span></div>`;
    return `<div class="emp-avatar dev-photo is-drop${x.photo ? ' has-photo' : ''}" id="eq-photo" role="button" tabindex="0"
        title="${x.photo ? 'Drop a new photo or click to change it' : 'Drop a photo or click to add one'}" aria-label="${x.photo ? 'Change' : 'Add'} equipment photo">
      ${x.photo ? `<img src="${esc(x.photo)}" alt="">` : `<span class="dev-photo-icon">${icon}</span>`}
      <span class="emp-avatar-cta">${I.camera}<span>${x.photo ? 'Change' : 'Add photo'}</span></span>
      ${x.photo ? `<button type="button" class="emp-photo-clear" id="eq-photo-clear" title="Remove photo" aria-label="Remove photo">${I.x}</button>` : ''}
      <input type="file" id="eq-photo-input" accept="image/*" hidden>
    </div>`;
  }

  async function savePhoto(file, x, photo) {
    const { toast, compressImage } = AD.ui;
    let dataUrl = photo;
    if (file) {
      try { dataUrl = await compressImage(file, 400, 0.82); } catch (e) { return; } // compressImage already explained why
    }
    try {
      await AD.store.update('equipment', x.id, { photo: dataUrl });
    } catch (err) {
      return toast('Could not save photo: ' + ((err && err.message) || err), 'error');
    }
    toast(dataUrl ? 'Photo updated' : 'Photo removed');
    draw();
  }

  function bindPhoto(el, x) {
    const zone = el.querySelector('#eq-photo');
    if (!zone) return;
    const input = el.querySelector('#eq-photo-input');
    zone.addEventListener('click', (ev) => { if (!ev.target.closest('#eq-photo-clear')) input.click(); });
    zone.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); input.click(); } });
    input.addEventListener('change', () => input.files[0] && savePhoto(input.files[0], x));
    ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => {
      e.preventDefault();
      if (ev === 'dragleave' && zone.contains(e.relatedTarget)) return;
      zone.classList.remove('is-over');
    }));
    zone.addEventListener('drop', (e) => { const f = (e.dataTransfer.files || [])[0]; if (f) savePhoto(f, x); });
    const clear = el.querySelector('#eq-photo-clear');
    if (clear) clear.onclick = () => savePhoto(null, x, '');
  }

  // -------------------------------------------------------------- page
  function draw() {
    const el = root;
    // A real item, or one of the read-only sample items the register shows
    // until the first real one is added.
    const x = AD.store.get('equipment', itemId) || (AD.equipment && AD.equipment.sampleEquipment(itemId));
    const sample = !!(x && x.sample);
    const back = `<nav class="crumbs" aria-label="Breadcrumb"><a href="#/equipment-register">Equipment register</a>${I.chevR}<span aria-current="page">${esc((x && x.name) || 'Equipment')}</span></nav>`;
    if (!x && !AD.store.available('equipment')) {
      el.innerHTML = `${back}<p class="empty">The equipment register hasn’t been set up yet. Run <code>supabase/create-equipment.sql</code> in the Supabase SQL Editor, then refresh.</p>`;
      return;
    }
    if (!x) {
      el.innerHTML = `${back}<p class="empty">This item wasn’t found. It may have been removed from the register.</p>`;
      return;
    }
    const tone = (AD.equipment && AD.equipment.EQ_TONE[x.status]) || 'grey';
    // Sample items carry a made-up person (no profile, no contact details).
    const emp = sample ? x.sampleAssignee : (x.employeeId ? AD.store.get('employees', x.employeeId) : null);
    const team = emp && !sample && AD.employees ? AD.employees.teamOf(emp) : '';
    const next = inspection(day10(x.nextInspection));
    const telHref = emp && emp.mobile ? 'tel:' + emp.mobile.replace(/[^\d+]/g, '') : '';
    const empLink = !emp ? '<span class="muted">Depot pool</span>'
      : sample ? esc(emp.name)
      : `<a href="#/employee/${encodeURIComponent(emp.id)}">${esc(emp.name)}</a>`;
    const notRec = '<span class="muted">Not recorded</span>';

    const details = [
      ['Item', esc(x.name)],
      ['Category', esc(x.category || 'Other')],
      ['Make / model', x.make ? esc(x.make) : notRec],
      ['Asset tag', x.assetTag ? esc(x.assetTag) : notRec],
      ['Serial number', x.serial ? esc(x.serial) : notRec],
      ['Location', x.location ? esc(x.location) : notRec],
      ['Last inspection', x.lastInspection ? T.fmtKey(day10(x.lastInspection)) : notRec],
      ['Next inspection / calibration', x.nextInspection ? `${next.html}${next.flag ? `<span class="t2">${next.flag}</span>` : ''}` : notRec],
      ['Status', badge(x.status, tone)]
    ];

    el.innerHTML = `
      ${back}
      ${sample ? `<div class="sample-note">${I.alert}<div><b>Sample item.</b> Made up to show how an equipment profile looks — it isn’t saved anywhere, can’t be edited, and disappears once you add your first real item to the equipment register.</div></div>` : ''}
      <header class="veh-hero emp-hero">
        ${photoBox(x)}
        <div class="veh-ident">
          <h1>${esc(x.name || 'Equipment')}</h1>
          <p class="veh-model">${esc([x.make, x.assetTag].filter(Boolean).join(' · ') || x.category || 'Equipment')}</p>
          ${badge(x.status, tone)}
        </div>
        <dl class="veh-facts">
          <div><dt>Assigned to</dt><dd>${empLink}</dd></div>
          <div><dt>Location</dt><dd>${x.location ? esc(x.location) : dash}</dd></div>
          <div><dt>Next inspection</dt><dd>${next.html}${next.flag ? ` ${next.flag}` : ''}</dd></div>
        </dl>
        <div class="veh-actions">
          ${sample ? '' : `<button class="btn btn-primary" data-edit-eq>${I.edit} Edit item</button>`}
        </div>
      </header>

      <div class="cols-2">
        <section class="section">
          ${sectionHead({ title: 'Item details', level: 3 })}
          <dl class="emp-details">${details.map(([dt, dd]) => `<div><dt>${esc(dt)}</dt><dd>${dd}</dd></div>`).join('')}</dl>
        </section>
        <section class="section">
          ${sectionHead({ title: 'Assigned to', level: 3, actions: sample ? '' : `<button type="button" class="btn btn-ghost btn-sm" data-reassign>${I.edit} ${emp ? 'Reassign' : 'Assign'}</button>` })}
          ${emp && sample
            ? `<div class="dev-person is-sample">
                <span class="emp-thumb" aria-hidden="true">${esc(initials(emp.name))}</span>
                <span class="dev-person-text"><span class="id">${esc(emp.name)}</span><span class="t2">${esc(emp.position || '')}</span></span>
              </div>`
            : emp
            ? `<div class="dev-person" data-emp="${esc(emp.id)}" title="Open ${esc(emp.name)}’s profile">
                <span class="emp-thumb" aria-hidden="true">${emp.photo ? `<img src="${esc(emp.photo)}" alt="">` : esc(initials(emp.name))}</span>
                <span class="dev-person-text">
                  <a class="id" href="#/employee/${encodeURIComponent(emp.id)}">${esc(emp.name)}</a>
                  <span class="t2">${esc([emp.position, team].filter(Boolean).join(' · ') || 'Employee')}</span>
                </span>
                <span class="dev-person-actions">
                  ${telHref ? `<a class="btn btn-secondary btn-sm" href="${esc(telHref)}">Call</a>` : ''}
                  ${emp.email ? `<a class="btn btn-secondary btn-sm" href="mailto:${esc(emp.email)}">Email</a>` : ''}
                </span>
              </div>`
            : `<div class="empty-tidy">${I.box}<span>In the depot pool — nobody is responsible for it at the moment.<span class="empty-hint">Use Assign to give it to someone from the Employee register.</span></span></div>`}

          ${sectionHead({ title: 'Notes', level: 3 })}
          ${x.notes ? `<p class="dev-notes">${esc(x.notes)}</p>` : `<div class="empty-tidy">${I.file}No notes yet.</div>`}
        </section>
      </div>`;

    if (sample) return; // read-only: nothing to wire up
    const openForm = () => AD.equipmentForm(x, (saved) => (saved ? draw() : AD.go('equipment-register')));
    el.querySelector('[data-edit-eq]').onclick = openForm;
    el.querySelector('[data-reassign]').onclick = openForm;
    const card = el.querySelector('.dev-person');
    if (card) card.addEventListener('click', (e) => { if (!e.target.closest('a, button')) AD.go('employee/' + card.dataset.emp); });
    bindPhoto(el, x);
  }

  return {
    title: (arg) => ((AD.store.get('equipment', arg) || (AD.equipment && AD.equipment.sampleEquipment(arg)) || {}).name) || 'Equipment',
    render(el, params, arg) { root = el; itemId = arg || ''; draw(); },
    refresh: () => root && draw(),
    destroy: () => { root = null; }
  };
})();
