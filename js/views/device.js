/*
 * Device profile — opened from the Technology register (#/device/<id>) or an
 * employee's Devices list. Same shape as the employee and vehicle profiles:
 * breadcrumb, a header with a photo and the key facts, then detail sections.
 *
 * Photo: drop an image on the photo box (top left). It's shrunk to a small
 * JPEG and stored on the device's own row, like the vehicle and employee
 * photos. Until one is added, an icon for the device type stands in.
 */
AD.views = AD.views || {};

AD.views.device = (function () {
  const { esc, sectionHead, dash, badge } = AD.ui;
  const T = AD.time, I = AD.icons;
  const WARRANTY_SOON_DAYS = 30;
  let root = null, devId = '';

  const TYPE_ICON = { Laptop: 'monitor', Desktop: 'monitor', Phone: 'phone', Tablet: 'phone', 'Field controller': 'gauge', Drone: 'route', 'Site internet': 'activity' };
  const initials = (name) => String(name || '?').trim().split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const day10 = (v) => (v ? String(v).slice(0, 10) : '');

  /** "2 yrs 3 mths", "5 mths", "12 days" since the purchase date. */
  function age(purchased) {
    const today = T.todayKey();
    const days = T.daysBetween(purchased, today);
    if (days < 0) return 'Not purchased yet';
    if (days < 31) return `${days} day${days === 1 ? '' : 's'}`;
    const a = T.parseKey(purchased), b = T.parseKey(today);
    let months = (b.y - a.y) * 12 + (b.m - a.m) - (b.d < a.d ? 1 : 0);
    const yrs = Math.floor(months / 12);
    months -= yrs * 12;
    return [yrs ? `${yrs} yr${yrs === 1 ? '' : 's'}` : '', months ? `${months} mth${months === 1 ? '' : 's'}` : ''].filter(Boolean).join(' ') || 'Under a month';
  }

  /** Warranty date with a flag: amber within 30 days, red once ended. */
  function warranty(key) {
    if (!key) return { html: dash, flag: '' };
    const days = T.daysBetween(T.todayKey(), key);
    const flag = days < 0 ? `<span class="flag flag-red">Ended ${-days}d ago</span>`
      : days <= WARRANTY_SOON_DAYS ? `<span class="flag flag-amber">Ends in ${days}d</span>` : '';
    return { html: T.fmtKey(key), flag };
  }

  // ------------------------------------------------------------- photo
  function photoBox(d) {
    const icon = I[TYPE_ICON[d.type] || 'monitor'] || I.monitor;
    return `<div class="emp-avatar dev-photo is-drop${d.photo ? ' has-photo' : ''}" id="dev-photo" role="button" tabindex="0"
        title="${d.photo ? 'Drop a new photo or click to change it' : 'Drop a photo or click to add one'}" aria-label="${d.photo ? 'Change' : 'Add'} device photo">
      ${d.photo ? `<img src="${esc(d.photo)}" alt="">` : `<span class="dev-photo-icon">${icon}</span>`}
      <span class="emp-avatar-cta">${I.camera}<span>${d.photo ? 'Change' : 'Add photo'}</span></span>
      ${d.photo ? `<button type="button" class="emp-photo-clear" id="dev-photo-clear" title="Remove photo" aria-label="Remove photo">${I.x}</button>` : ''}
      <input type="file" id="dev-photo-input" accept="image/*" hidden>
    </div>`;
  }

  async function savePhoto(file, d, photo) {
    const { toast, compressImage } = AD.ui;
    let dataUrl = photo;
    if (file) {
      try { dataUrl = await compressImage(file, 400, 0.82); } catch (e) { return; } // compressImage already explained why
    }
    try {
      await AD.store.update('tech_devices', d.id, { photo: dataUrl });
    } catch (err) {
      const msg = String((err && err.message) || err);
      return toast(/photo|schema cache|could not find|pgrst204|42703/i.test(msg)
        ? 'Photos aren’t set up for devices yet — run supabase/create-tech-devices.sql again in the Supabase SQL Editor.'
        : 'Could not save photo: ' + msg, 'error');
    }
    toast(dataUrl ? 'Photo updated' : 'Photo removed');
    draw();
  }

  function bindPhoto(el, d) {
    const zone = el.querySelector('#dev-photo');
    const input = el.querySelector('#dev-photo-input');
    zone.addEventListener('click', (ev) => { if (!ev.target.closest('#dev-photo-clear')) input.click(); });
    zone.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); input.click(); } });
    input.addEventListener('change', () => input.files[0] && savePhoto(input.files[0], d));
    ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => {
      e.preventDefault();
      if (ev === 'dragleave' && zone.contains(e.relatedTarget)) return;
      zone.classList.remove('is-over');
    }));
    zone.addEventListener('drop', (e) => { const f = (e.dataTransfer.files || [])[0]; if (f) savePhoto(f, d); });
    const clear = el.querySelector('#dev-photo-clear');
    if (clear) clear.onclick = () => savePhoto(null, d, '');
  }

  // -------------------------------------------------------------- page
  function draw() {
    const el = root;
    const d = AD.store.get('tech_devices', devId);
    const back = `<nav class="crumbs" aria-label="Breadcrumb"><a href="#/technology-register">Technology register</a>${I.chevR}<span aria-current="page">${esc((d && d.make) || 'Device')}</span></nav>`;
    if (!AD.store.available('tech_devices')) {
      el.innerHTML = `${back}<p class="empty">The technology register hasn’t been set up yet. Run <code>supabase/create-tech-devices.sql</code> in the Supabase SQL Editor, then refresh.</p>`;
      return;
    }
    if (!d) {
      el.innerHTML = `${back}<p class="empty">This device wasn’t found. It may have been removed from the register.</p>`;
      return;
    }
    const tone = (AD.devices && AD.devices.IT_TONE[d.status]) || 'grey';
    const emp = d.employeeId ? AD.store.get('employees', d.employeeId) : null;
    const team = emp && AD.employees ? AD.employees.teamOf(emp) : '';
    const w = warranty(day10(d.warrantyEnds));
    const telHref = emp && emp.mobile ? 'tel:' + emp.mobile.replace(/[^\d+]/g, '') : '';
    const empLink = emp ? `<a href="#/employee/${encodeURIComponent(emp.id)}">${esc(emp.name)}</a>` : '<span class="muted">Unassigned</span>';
    const notRec = '<span class="muted">Not recorded</span>';

    const details = [
      ['Type', esc(d.type || 'Other')],
      ['Make / model', esc(d.make)],
      ['Asset tag', d.assetTag ? esc(d.assetTag) : notRec],
      ['Serial / IMEI', d.serial ? esc(d.serial) : notRec],
      ['Mobile number', d.mobile ? `<a href="tel:${esc(d.mobile.replace(/[^\d+]/g, ''))}">${esc(d.mobile)}</a>` : '<span class="muted">No SIM recorded</span>'],
      ['Purchased', d.purchased ? `${T.fmtKey(day10(d.purchased))}<span class="t2">${esc(age(day10(d.purchased)))} old</span>` : notRec],
      ['Warranty ends', d.warrantyEnds ? `${w.html}${w.flag ? `<span class="t2">${w.flag}</span>` : ''}` : notRec],
      ['Status', badge(d.status, tone)]
    ];

    el.innerHTML = `
      ${back}
      <header class="veh-hero emp-hero">
        ${photoBox(d)}
        <div class="veh-ident">
          <h1>${esc(d.make || 'Device')}</h1>
          <p class="veh-model">${esc([d.type, d.assetTag].filter(Boolean).join(' · ') || 'Device')}</p>
          ${badge(d.status, tone)}
        </div>
        <dl class="veh-facts">
          <div><dt>Assigned to</dt><dd>${empLink}</dd></div>
          <div><dt>Age</dt><dd>${d.purchased ? esc(age(day10(d.purchased))) : dash}</dd></div>
          <div><dt>Warranty</dt><dd>${w.html}${w.flag ? ` ${w.flag}` : ''}</dd></div>
        </dl>
        <div class="veh-actions">
          <button class="btn btn-primary" data-edit-dev>${I.edit} Edit device</button>
        </div>
      </header>

      <div class="cols-2">
        <section class="section">
          ${sectionHead({ title: 'Device details', level: 3 })}
          <dl class="emp-details">${details.map(([dt, dd]) => `<div><dt>${esc(dt)}</dt><dd>${dd}</dd></div>`).join('')}</dl>
        </section>
        <section class="section">
          ${sectionHead({ title: 'Assigned to', level: 3, actions: `<button type="button" class="btn btn-ghost btn-sm" data-reassign>${I.edit} ${emp ? 'Reassign' : 'Assign'}</button>` })}
          ${emp
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
            : `<div class="empty-tidy">${I.monitor}<span>Nobody has this device at the moment.<span class="empty-hint">Use Assign to give it to someone from the Employee register.</span></span></div>`}

          ${sectionHead({ title: 'Notes', level: 3 })}
          ${d.notes ? `<p class="dev-notes">${esc(d.notes)}</p>` : `<div class="empty-tidy">${I.file}No notes yet.</div>`}
        </section>
      </div>`;

    const openForm = () => AD.deviceForm(d, (saved) => (saved ? draw() : AD.go('technology-register')));
    el.querySelector('[data-edit-dev]').onclick = openForm;
    el.querySelector('[data-reassign]').onclick = openForm;
    const card = el.querySelector('.dev-person');
    if (card) card.addEventListener('click', (e) => { if (!e.target.closest('a, button')) AD.go('employee/' + card.dataset.emp); });
    bindPhoto(el, d);
  }

  return {
    title: (arg) => ((AD.store.get('tech_devices', arg) || {}).make) || 'Device',
    render(el, params, arg) { root = el; devId = arg || ''; draw(); },
    refresh: () => root && draw(),
    destroy: () => { root = null; }
  };
})();
