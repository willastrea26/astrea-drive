/* Vehicle details */
AD.views = AD.views || {};

AD.views.vehicle = (function () {
  const { esc, options, vehicleBadge, stateBadge, priorityBadge, defectBadge, bookingBadge, toast, pageHeader, sectionHead, dash } = AD.ui;
  const L = AD.logic, T = AD.time, I = AD.icons;
  const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'bookings', label: 'Bookings', vacOnly: true },
    { key: 'service', label: 'Maintenance' },
    { key: 'defects', label: 'Defects' },
    { key: 'documents', label: 'Documents' },
    { key: 'photos', label: 'Photos' },
    { key: 'revenue', label: 'Revenue' }
  ];
  const RANGES = [
    { key: '12m', label: 'Last 12 months', short: '12M', months: 12 },
    { key: '3m', label: 'Last 3 months', short: '3M', months: 3 },
    { key: '30d', label: 'Last 30 days', short: '30D', days: 30 },
    { key: 'ytd', label: 'Year to date', short: 'YTD', ytd: true }
  ];
  let root = null, id = null, tab = 'service', range = '12m';
  // Charts animate in when a tab is opened, not on every redraw (saving the
  // odometer would otherwise replay every chart on the page).
  let fresh = true;

  function render(el, params, arg) {
    root = el; id = arg;
    tab = TABS.some((t) => t.key === params.tab) ? params.tab : 'service';
    fresh = true;
    draw();
  }

  /** [from, to) in ms for the selected range. */
  function rangeBounds() {
    const r = RANGES.find((x) => x.key === range) || RANGES[0];
    const to = T.startOfDay(T.addDays(T.todayKey(), 1));
    if (r.ytd) return [Date.parse(T.todayKey().slice(0, 4) + '-01-01'), to];
    if (r.days) return [T.startOfDay(T.addDays(T.todayKey(), -r.days)), to];
    const p = T.parts(Date.now());
    const y = p.year - Math.floor(r.months / 12), m = p.month - (r.months % 12);
    const from = new Date(Date.UTC(m <= 0 ? y - 1 : y, (m <= 0 ? m + 12 : m) - 1, p.day));
    return [from.getTime(), to];
  }

  function draw() {
    const el = root;
    const v = AD.store.get('vehicles', id);
    if (!v) {
      el.innerHTML = `<a class="back" href="#/fleet">${I.chevL} Fleet register</a>
        <p class="empty">Vehicle “${esc(id)}” was not found. It may have been removed.</p>`;
      return;
    }
    const isVac = v.type === 'Vac truck';
    if (tab === 'bookings' && !isVac) tab = 'overview';

    const services = AD.store.all('services').filter((x) => x.vehicleId === v.id).sort((a, b) => b.date.localeCompare(a.date));
    const defects = AD.store.all('defects').filter((x) => x.vehicleId === v.id).sort((a, b) => (a.status === 'Resolved') - (b.status === 'Resolved') || b.reportedDate.localeCompare(a.reportedDate));
    const docs = AD.store.all('documents').filter((x) => x.vehicleId === v.id);
    const upcoming = isVac ? L.bookingsFor(v.id).filter((b) => Date.parse(b.end) > Date.now()) : [];
    const openCount = defects.filter((d) => d.status !== 'Resolved').length;
    const counts = { service: services.length, defects: openCount, documents: docs.length, photos: (v.photos || []).length, bookings: upcoming.filter((b) => b.status !== 'cancelled').length };

    el.classList.toggle('anim-in', fresh);
    fresh = false;

    el.innerHTML = `
      <nav class="crumbs" aria-label="Breadcrumb">
        <a href="#/fleet${v.hired ? '?section=hired' : ''}">${v.hired ? 'Hired fleet' : 'Fleet register'}</a>${I.chevR}<span aria-current="page">${esc(v.id)}</span>
      </nav>

      <header class="veh-hero">
        ${photoDrop(v)}
        <div class="veh-ident">
          <h1>${esc(v.id)}</h1>
          <p class="veh-model">${esc(v.make)} ${esc(v.model.split(' — ')[0])}</p>
          ${v.hired ? `<span class="flag flag-muted">Hired · ${esc(v.hireCompany || 'Unknown company')}</span>` : vehicleBadge(v.status)}
        </div>
        <dl class="veh-facts">
          <div><dt>Rego</dt><dd>${esc(v.rego)}</dd></div>
          <div><dt>Odometer</dt><dd>${L.fmtKm(v.odometer)}</dd></div>
          <div><dt>Type</dt><dd>${esc(v.type)}</dd></div>
          <div><dt>Year</dt><dd>${esc(v.year)}</dd></div>
        </dl>
        <div class="veh-actions">
          ${isVac ? `<a class="btn btn-secondary" href="#/calendar?view=week&truck=${v.id}">${I.calendar} Schedule</a>` : ''}
          <button class="btn btn-primary" data-edit-vehicle>${I.edit} Edit vehicle</button>
        </div>
      </header>

      <div class="veh-tabbar">
        <div class="tabs" role="tablist">
          ${TABS.filter((t) => !t.vacOnly || isVac).map((t) => `
            <button role="tab" data-tab="${t.key}" class="${tab === t.key ? 'on' : ''}" aria-selected="${tab === t.key}">
              ${esc(t.label)}${counts[t.key] ? `<span class="n">${counts[t.key]}</span>` : ''}
            </button>`).join('')}
        </div>
        ${tab === 'revenue' ? `<label class="range-pick">${I.calendar}
          <select id="rev-range" aria-label="Reporting period">
            ${RANGES.map((r) => `<option value="${r.key}"${r.key === range ? ' selected' : ''}>${esc(r.label)}</option>`).join('')}
          </select></label>` : ''}
      </div>

      <div id="tab-body" role="tabpanel">${tabBody(v, services, defects, docs, upcoming)}</div>`;

    el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; fresh = true; AD.setParams({ tab }); draw(); }));
    el.querySelectorAll('[data-edit-vehicle]').forEach((b) => (b.onclick = () => AD.vehicleForm(v, () => draw())));
    const rangeSel = el.querySelector('#rev-range');
    if (rangeSel) rangeSel.onchange = () => { range = rangeSel.value; fresh = true; draw(); };

    bindPhoto(el, v);
    if (tab === 'overview') bindOverview(el, v);

    const tb = el.querySelector('#tab-body');
    tb.querySelector('[data-record]') && (tb.querySelector('[data-record]').onclick = () => AD.serviceForm(v.id));
    tb.querySelector('[data-report]') && (tb.querySelector('[data-report]').onclick = () => AD.defectForm(v.id));
    tb.querySelectorAll('[data-resolve]').forEach((b) => (b.onclick = () => AD.resolveDefect(b.dataset.resolve)));
    tb.querySelectorAll('[data-photos]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); AD.viewDefectPhotos(b.dataset.photos); }));
    tb.querySelectorAll('[data-booking]').forEach((b) => (b.onclick = () => AD.go('calendar', { view: 'day', date: T.dateKey(AD.store.get('bookings', b.dataset.booking).start), open: b.dataset.booking })));

    // Photos tab
    if (tab === 'photos') bindGallery(el, v);

    // Documents tab
    const uploadBtn = tb.querySelector('[data-upload]');
    if (uploadBtn) uploadBtn.onclick = () => AD.documentForm(v.id, () => draw());
    tb.querySelectorAll('[data-open]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); AD.openDocument(AD.store.get('documents', b.dataset.open)); }));
    tb.querySelectorAll('[data-download]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); AD.downloadDocument(AD.store.get('documents', b.dataset.download)); }));
    tb.querySelectorAll('[data-delete]').forEach((b) => (b.onclick = async (e) => {
      e.preventDefault(); e.stopPropagation();
      const doc = AD.store.get('documents', b.dataset.delete);
      if (!doc) return;
      const ok = await AD.ui.confirm({ title: 'Delete document?', message: `Delete <b>${esc(doc.name)}</b>${doc.storagePath ? ' and the attached file' : ''}? This can’t be undone.`, confirmText: 'Delete', danger: true });
      if (!ok) return;
      try {
        await AD.store.removeDocument(doc);
        await AD.store.log(`Document deleted from ${v.id}: ${doc.name}`, v.id);
      } catch (err) { return toast('Could not delete: ' + err.message, 'error'); }
      toast(`${doc.name} deleted`);
      draw();
    }));
    if (tab === 'documents') bindDocsDnd(tb, v);
  }

  /** Rename-category and drag-to-reorder wiring for the documents register. */
  function bindDocsDnd(tb, v) {
    const { esc, toast } = AD.ui;
    const tbody = tb.querySelector('#doc-tbody');
    if (!tbody) return;

    // --- Rename a category heading inline ---
    tb.querySelectorAll('[data-rename]').forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault(); e.stopPropagation();
        const head = btn.closest('.doc-group');
        const nameEl = head && head.querySelector('.doc-group-name');
        if (!nameEl || head.querySelector('.doc-cat-input')) return;
        const oldCat = head.dataset.cat;
        const input = document.createElement('input');
        input.className = 'doc-cat-input';
        input.type = 'text';
        input.value = oldCat === 'Uncategorised' ? '' : oldCat;
        input.setAttribute('aria-label', 'Category name');
        nameEl.replaceWith(input);
        btn.style.display = 'none';
        input.focus(); input.select();
        let done = false;
        const commit = async (save) => {
          if (done) return; done = true;
          const next = input.value.trim();
          if (!save || !next || next === oldCat) { draw(); return; }
          try { await AD.store.renameDocumentCategory(v.id, oldCat, next); }
          catch (err) { toast('Could not rename: ' + (err.message || err), 'error'); }
          draw();
        };
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { ev.preventDefault(); commit(true); }
          else if (ev.key === 'Escape') { ev.preventDefault(); commit(false); }
        });
        input.addEventListener('blur', () => commit(true));
      };
    });

    // --- Drag to reorder documents and whole categories ---
    let dragKind = null, dragId = null, dragCat = null;

    const clearMarks = () => tbody.querySelectorAll('.doc-drop-mark').forEach((el) => el.classList.remove('doc-drop-mark'));

    // Find the row to insert BEFORE given the pointer Y (null = append at end).
    const slotBefore = (clientY, selector) => {
      const els = Array.from(tbody.querySelectorAll(selector)).filter((el) => !el.classList.contains('dragging'));
      let best = { offset: -Infinity, el: null };
      els.forEach((el) => {
        const box = el.getBoundingClientRect();
        const offset = clientY - box.top - box.height / 2;
        if (offset < 0 && offset > best.offset) best = { offset, el };
      });
      return best.el;
    };

    // The heading + all its document rows, as a contiguous block.
    const categoryBlock = (head) => {
      const block = [head];
      let n = head.nextElementSibling;
      while (n && !n.classList.contains('doc-group')) { block.push(n); n = n.nextElementSibling; }
      return block;
    };

    const rebuildAndSave = async () => {
      let curCat = null;
      const ordered = [];
      Array.from(tbody.children).forEach((tr) => {
        if (tr.classList.contains('doc-group')) curCat = tr.dataset.cat;
        else if (tr.classList.contains('doc-row')) {
          ordered.push({ id: tr.dataset.docId, category: curCat === 'Uncategorised' ? '' : (curCat || ''), sortIndex: ordered.length });
        }
      });
      try { await AD.store.reorderDocuments(ordered); }
      catch (err) { toast('Could not save order: ' + (err.message || err), 'error'); }
      draw();
    };

    tbody.addEventListener('dragstart', (e) => {
      const tr = e.target.closest('tr');
      if (!tr) return;
      if (tr.classList.contains('doc-group')) { dragKind = 'cat'; dragCat = tr.dataset.cat; dragId = null; }
      else if (tr.classList.contains('doc-row')) { dragKind = 'doc'; dragId = tr.dataset.docId; dragCat = null; }
      else return;
      tr.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', dragId || dragCat || ''); } catch (err) { /* ignore */ }
    });

    tbody.addEventListener('dragover', (e) => {
      if (!dragKind) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      clearMarks();
      const ref = slotBefore(e.clientY, dragKind === 'cat' ? '.doc-group' : '.doc-row, .doc-group');
      if (ref) ref.classList.add('doc-drop-mark');
    });

    tbody.addEventListener('drop', (e) => {
      if (!dragKind) return;
      e.preventDefault();
      clearMarks();
      if (dragKind === 'doc') {
        const dragged = tbody.querySelector(`.doc-row[data-doc-id="${CSS.escape(dragId)}"]`);
        if (dragged) {
          const ref = slotBefore(e.clientY, '.doc-row, .doc-group');
          if (ref) tbody.insertBefore(dragged, ref); else tbody.appendChild(dragged);
        }
      } else if (dragKind === 'cat') {
        const head = Array.from(tbody.querySelectorAll('.doc-group')).find((h) => h.dataset.cat === dragCat);
        if (head) {
          const block = categoryBlock(head);
          const ref = slotBefore(e.clientY, '.doc-group');
          if (ref && !block.includes(ref)) block.forEach((el) => tbody.insertBefore(el, ref));
          else if (!ref) block.forEach((el) => tbody.appendChild(el));
        }
      }
      dragKind = dragId = dragCat = null;
      rebuildAndSave();
    });

    tbody.addEventListener('dragend', () => {
      clearMarks();
      tbody.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging'));
      dragKind = dragId = dragCat = null;
    });
  }

  // ---------- Photo drop zone ----------
  /** Illustration standing in for a missing photo. Falls back to a plain icon for types we haven't drawn. */
  const placeholderArt = (v) => AD.art.forVehicle(v, 168);

  function photoDrop(v) {
    const art = placeholderArt(v);
    return `<div class="veh-photo${v.photo ? ' has-photo' : ''}" id="veh-photo">
      ${v.photo
        ? `<img src="${esc(v.photo)}" alt="${esc(v.id)}">
           <button type="button" class="veh-photo-clear" id="photo-clear" title="Remove photo" aria-label="Remove photo">${I.x}</button>`
        : `<div class="veh-photo-empty">
             ${art ? `<span class="veh-photo-truck">${art}</span>` : I.truck}
             <span class="veh-photo-hint">Drop a photo<span>or click to browse</span></span>
           </div>`}
      <input type="file" id="photo-input" accept="image/*" hidden>
    </div>`;
  }

  /**
   * Photos are stored on the vehicle record as a data URL, so they're
   * downscaled to a 640px JPEG before saving to keep the row (and the
   * network round-trip) small.
   */
  function storePhoto(file, v) {
    if (!file || !/^image\//.test(file.type)) return toast('That file is not an image');
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = async () => {
        const max = 640;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        try {
          await AD.store.update('vehicles', v.id, { photo: c.toDataURL('image/jpeg', 0.75) });
        } catch (err) {
          toast('Could not save photo: ' + err.message, 'error');
          return;
        }
        toast(`${v.id} photo updated`);
        draw();
      };
      img.onerror = () => toast('That image could not be read');
      img.src = reader.result;
    };
    reader.onerror = () => toast('That file could not be read');
    reader.readAsDataURL(file);
  }

  function bindPhoto(el, v) {
    const zone = el.querySelector('#veh-photo');
    const input = el.querySelector('#photo-input');
    const clear = el.querySelector('#photo-clear');
    zone.addEventListener('click', (e) => { if (!e.target.closest('#photo-clear')) input.click(); });
    input.addEventListener('change', () => input.files[0] && storePhoto(input.files[0], v));
    ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => {
      e.preventDefault(); zone.classList.add('is-over');
    }));
    ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => {
      e.preventDefault(); if (ev === 'dragleave' && zone.contains(e.relatedTarget)) return;
      zone.classList.remove('is-over');
    }));
    zone.addEventListener('drop', (e) => storePhoto(e.dataTransfer.files[0], v));
    if (clear) clear.onclick = async () => {
      try {
        await AD.store.update('vehicles', v.id, { photo: '' });
      } catch (err) {
        return toast('Could not remove photo: ' + err.message, 'error');
      }
      toast(`${v.id} photo removed`);
      draw();
    };
  }

  function bindOverview(el, v) {
    el.querySelector('#odo-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target, val = Number(f.odo.value);
      if (f.odo.value === '' || !Number.isFinite(val)) return AD.ui.showErrors(f, { odo: 'Enter a reading.' });
      if (val < v.odometer) return AD.ui.showErrors(f, { odo: `Must be at least ${v.odometer.toLocaleString('en-AU')} km.` });
      if (val - v.odometer > 20000) return AD.ui.showErrors(f, { odo: 'That’s over 20,000 km more — check the reading.' });
      try {
        await AD.store.update('vehicles', v.id, { odometer: Math.round(val) });
        await AD.store.log(`${v.id} odometer updated to ${L.fmtKm(val)}`, v.id);
      } catch (err) {
        return toast('Could not update odometer: ' + err.message, 'error');
      }
      toast(`${v.id} odometer updated`);
    });
    const statusSel = el.querySelector('#status-in');
    const wkField = el.querySelector('#wk-field');
    statusSel.addEventListener('change', () => { wkField.style.display = statusSel.value === 'In workshop' ? '' : 'none'; });

    el.querySelector('#status-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const status = f.status.value;
      const workshopId = status === 'In workshop' && f.workshopId ? f.workshopId.value : '';
      if (status === v.status && workshopId === (v.workshopId || '')) return;
      try {
        await AD.store.update('vehicles', v.id, { status, workshopId });
        const shop = workshopId && AD.store.get('workshops', workshopId);
        await AD.store.log(`${v.id} status changed to ${status}${shop ? ' at ' + shop.name : ''}`, v.id);
      } catch (err) {
        return toast('Could not change status: ' + err.message, 'error');
      }
      toast(`${v.id} is now ${status}`);
      draw();
    });
  }

  // ---------- Photo gallery ----------
  function compressBlob(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * scale);
          c.height = Math.round(img.height * scale);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          c.toBlob((blob) => blob ? resolve(new File([blob], file.name, { type: 'image/jpeg' })) : reject(new Error('Resize failed')), 'image/jpeg', quality);
        };
        img.onerror = () => reject(new Error('Invalid image'));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.readAsDataURL(file);
    });
  }

  function photosTab(v) {
    const photos = v.photos || [];
    const cls = photos.length === 1 ? ' pg-1' : photos.length <= 4 ? ' pg-few' : '';
    return `
      <div class="tab-tools">
        <span class="t2">${photos.length} photo${photos.length === 1 ? '' : 's'}</span>
        <button class="btn btn-sm btn-primary" id="pg-add-btn">${I.plus} Add photos</button>
        <input type="file" id="pg-input" accept="image/*" multiple hidden>
      </div>
      <div class="pg-grid${cls}" id="pg-grid">
        ${photos.length
          ? photos.map((p) => `<div class="pg-tile pg-loading" data-pid="${p.id}"><div class="pg-shimmer"></div></div>`).join('')
          : `<p class="empty">No photos yet. Click "Add photos" or drag images here.</p>`}
      </div>`;
  }

  async function doUpload(files, vehicleId) {
    let ok = 0;
    for (const f of files) {
      try {
        const blob = await compressBlob(f, 1400, 0.82);
        await AD.store.uploadVehiclePhoto(blob, vehicleId);
        ok++;
      } catch (err) {
        toast('Failed: ' + (f.name || 'photo') + ' — ' + err.message, 'error');
      }
    }
    if (ok) toast(`${ok} photo${ok === 1 ? '' : 's'} uploaded`);
    return ok;
  }

  async function bindGallery(el, v) {
    const photos = v.photos || [];
    const addBtn = el.querySelector('#pg-add-btn');
    const input = el.querySelector('#pg-input');
    const grid = el.querySelector('#pg-grid');

    addBtn.onclick = () => input.click();
    input.onchange = async () => {
      const files = Array.from(input.files || []).filter((f) => /^image\//.test(f.type));
      if (!files.length) return;
      addBtn.disabled = true; addBtn.textContent = 'Uploading…';
      if (await doUpload(files, v.id)) draw();
    };

    ['dragenter', 'dragover'].forEach((ev) => grid.addEventListener(ev, (e) => { e.preventDefault(); grid.classList.add('pg-over'); }));
    ['dragleave', 'drop'].forEach((ev) => grid.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'dragleave' && grid.contains(e.relatedTarget)) return; grid.classList.remove('pg-over'); }));
    grid.addEventListener('drop', async (e) => {
      const files = Array.from(e.dataTransfer.files || []).filter((f) => /^image\//.test(f.type));
      if (!files.length) return;
      addBtn.disabled = true; addBtn.textContent = 'Uploading…';
      if (await doUpload(files, v.id)) draw();
    });

    const urls = [];
    for (const p of photos) {
      const tile = grid.querySelector(`[data-pid="${p.id}"]`);
      if (!tile) continue;
      try {
        const url = await AD.store.signDocumentUrl(p.path);
        urls.push(url);
        tile.innerHTML = `<img src="${esc(url)}" alt="Vehicle photo" loading="lazy"><button class="pg-del" data-pdel="${p.id}" title="Delete photo">${I.x}</button>`;
        tile.classList.remove('pg-loading');
        const idx = urls.length - 1;
        tile.onclick = (e) => { if (!e.target.closest('.pg-del')) AD.ui.photoLightbox(urls, idx); };
      } catch (e) {
        tile.innerHTML = '<span class="pg-err">Could not load</span>';
        tile.classList.remove('pg-loading');
        urls.push('');
      }
    }

    grid.querySelectorAll('[data-pdel]').forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const ok = await AD.ui.confirm({ title: 'Delete photo?', message: 'This photo will be permanently removed.', confirmText: 'Delete', danger: true });
        if (!ok) return;
        try {
          await AD.store.removeVehiclePhoto(v.id, btn.dataset.pdel);
          toast('Photo deleted');
          draw();
        } catch (err) { toast('Could not delete: ' + err.message, 'error'); }
      };
    });
  }

  // ---------- Tabs ----------
  function tabBody(v, services, defects, docs, upcoming) {
    if (tab === 'overview') return overview(v, services, defects);
    if (tab === 'photos') return photosTab(v);
    if (tab === 'revenue') return revenueTab(v);

    if (tab === 'service') return `
      <div class="tab-tools"><span class="t2">Completed services, newest first</span><button class="btn btn-sm btn-secondary" data-record>${I.plus} Record service</button></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th class="num">Odometer</th><th>Service</th><th class="col-opt">Workshop</th><th class="num">Cost</th></tr></thead><tbody>
      ${services.map((x) => `<tr><td class="nowrap">${T.fmtKey(x.date)}</td><td class="num">${L.fmtKm(x.odometer)}</td><td>${esc(x.type)}${x.notes ? `<span class="t2">${esc(x.notes)}</span>` : ''}</td><td class="col-opt">${x.workshop ? esc(x.workshop) : dash}</td><td class="num">${L.fmtAUD(x.cost)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No services recorded.</td></tr>'}
      </tbody></table></div>`;

    if (tab === 'defects') return `
      <div class="tab-tools"><span class="t2">Open defects first</span><button class="btn btn-sm btn-secondary" data-report>${I.plus} Report defect</button></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Reported</th><th>Description</th><th>Priority</th><th>Status</th><th class="col-action"><span class="hide">Action</span></th></tr></thead><tbody>
      ${defects.map((d) => `<tr class="${d.status === 'Resolved' ? 'muted-row' : ''}"><td class="nowrap">${T.fmtKey(d.reportedDate)}<span class="t2">${esc(d.reportedBy)}</span></td><td><span class="defect-desc">${esc(d.description)} ${AD.defectPhotoChip(d)}</span>${d.status === 'Resolved' ? `<span class="t2">Resolved ${T.fmtKey(d.resolvedDate)}${d.resolutionNotes ? ' — ' + esc(d.resolutionNotes) : ''}</span>` : ''}</td><td>${priorityBadge(d.priority, d.status === 'Resolved')}</td><td>${defectBadge(d.status)}</td>
        <td class="col-action">${d.status !== 'Resolved' ? `<button class="btn btn-link" data-resolve="${d.id}">Resolve</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No defects reported.</td></tr>'}
      </tbody></table></div>`;

    if (tab === 'documents') {
      // Documents are grouped under their category (the folder name). Order is
      // user-controlled: sorted by the saved sortIndex, with categories appearing
      // in the order their first document falls. Headings can be renamed and both
      // documents and whole categories can be dragged to reorder.
      const sorted = docs.slice().sort((a, b) => {
        const sa = typeof a.sortIndex === 'number' ? a.sortIndex : 0;
        const sb = typeof b.sortIndex === 'number' ? b.sortIndex : 0;
        if (sa !== sb) return sa - sb;
        const au = a.uploadedAt || '', bu = b.uploadedAt || '';
        if (au !== bu) return bu.localeCompare(au);
        return (a.name || '').localeCompare(b.name || '');
      });
      const groups = [];
      const groupIdx = {};
      sorted.forEach((d) => {
        const cat = (d.category || '').trim() || 'Uncategorised';
        if (groupIdx[cat] == null) { groupIdx[cat] = groups.length; groups.push({ cat, docs: [] }); }
        groups[groupIdx[cat]].docs.push(d);
      });
      const docRow = (d) => {
        const hasFile = !!d.storagePath;
        const sub = hasFile && d.uploadedBy ? `<span class="t2">${esc(d.uploadedBy)}</span>` : (!hasFile ? '<span class="t2 muted">Placeholder — no file attached</span>' : '');
        const icon = AD.fileIcon(hasFile ? (d.storagePath || d.name) : d.name);
        return `<tr class="doc-row${hasFile ? ' row-link' : ''}" draggable="true" data-doc-id="${d.id}"${hasFile ? ` data-open="${d.id}" title="Drag to reorder · click to open ${esc(d.name)}"` : ' title="Drag to reorder"'}>
          <td><div class="doc-cell"><span class="doc-grip" aria-hidden="true"></span>${icon}<div class="doc-name">${hasFile ? `<a class="id" href="#" data-open="${d.id}">${esc(d.name)}</a>` : `<span>${esc(d.name)}</span>`}${sub}</div></div></td>
          <td class="num col-opt">${hasFile ? AD.fmtBytes(d.sizeBytes) : dash}</td>
          <td class="col-opt nowrap">${hasFile && d.uploadedAt ? T.fmtKey(d.uploadedAt.slice(0, 10)) : dash}</td>
          <td class="col-action">
            ${hasFile ? `<button class="btn btn-link" data-download="${d.id}">Download</button>` : ''}
            <button class="btn btn-link btn-danger-ghost" data-delete="${d.id}">${hasFile ? 'Delete' : 'Remove'}</button>
          </td></tr>`;
      };
      const body = groups.map((g) => `
        <tr class="doc-group" draggable="true" data-cat="${esc(g.cat)}">
          <td colspan="4">
            <span class="doc-grip doc-group-grip" aria-hidden="true"></span>
            <span class="doc-group-name">${esc(g.cat)}</span>
            <span class="doc-group-count">${g.docs.length}</span>
            <button class="doc-cat-edit" data-rename="${esc(g.cat)}" type="button" title="Rename category" aria-label="Rename category">${I.edit || '✎'}</button>
          </td>
        </tr>
        ${g.docs.map(docRow).join('')}`).join('');
      return `
      <div class="tab-tools">
        <span class="t2">${docs.length} document${docs.length === 1 ? '' : 's'} on file${groups.length > 1 ? ` · ${groups.length} categories` : ''}</span>
        <button class="btn btn-sm btn-primary" data-upload>${I.plus} Upload document</button>
      </div>
      <div class="table-wrap"><table class="data doc-table"><thead><tr>
        <th>Document</th><th class="num col-opt">Size</th><th class="col-opt">Uploaded</th><th class="col-action"><span class="hide">Actions</span></th>
      </tr></thead><tbody id="doc-tbody">
      ${body || '<tr><td colspan="4" class="empty">No documents yet. Click “Upload document” to add one.</td></tr>'}
      </tbody></table></div>`;
    }

    return `
      <div class="tab-tools"><span class="t2">Current and upcoming bookings — shared with Calendar and Tracker</span><a class="btn btn-sm btn-secondary" href="#/calendar?new=1&truck=${v.id}">${I.plus} New booking</a></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Start</th><th class="col-opt">Finish</th><th>Job</th><th class="col-opt">Site</th><th>Status</th></tr></thead><tbody>
      ${upcoming.map((b) => {
        const cancelled = b.status === 'cancelled';
        const strike = cancelled ? 'strike' : '';
        const site = L.hasCoords(b) ? esc(b.address || 'Pinned location')
          : cancelled ? (b.address ? esc(b.address) : dash) : '<span class="flag flag-amber">Site location required</span>';
        return `<tr class="row-link ${cancelled ? 'muted-row' : ''}" data-booking="${b.id}" title="Open booking">
          <td class="nowrap ${strike}">${T.fmtDateTime(b.start)}</td><td class="nowrap col-opt ${strike}">${T.fmtDateTime(b.end)}</td>
          <td><span class="${strike}">${esc(L.bookingTitle(b))}</span><span class="t2">${[b.jobNumber, b.client].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</span><span class="t2 only-mobile ${strike}">${site}</span></td>
          <td class="col-opt ${strike}">${site}</td><td>${bookingBadge(L.bookingCategory(b))}</td></tr>`;
      }).join('') || '<tr><td colspan="5" class="empty">No upcoming bookings.</td></tr>'}
      </tbody></table></div>`;
  }

  function detailsFacts(v) {
    const rows = [
      v.variant && ['Variant', v.variant],
      v.vin && ['VIN', v.vin],
      v.linktTag && ['Linkt tag', v.linktTag],
      v.wrdtPlantNo && ['WRDT plant no.', v.wrdtPlantNo],
      v.evieFob && ['EVIE fob', v.evieFob],
      v.evieCard && ['EVIE card', v.evieCard],
    ].filter(Boolean);
    if (!rows.length) return '';
    return `<section class="section">
      ${sectionHead({ title: 'Vehicle details', level: 3, actions: `<button type="button" class="btn btn-ghost btn-sm" data-edit-vehicle>${I.edit} Edit</button>` })}
      <dl class="facts">${rows.map(([dt, dd]) => `<div><dt>${esc(dt)}</dt><dd style="font-family:var(--mono,monospace);font-size:.92em">${esc(dd)}</dd></div>`).join('')}</dl>
    </section>`;
  }

  function overview(v, services, defects) {
    const s = L.serviceState(v), r = L.regoState(v);
    const flagTone = (tone) => (tone ? 'flag-' + tone : 'muted');
    return `
      <div class="cols-main-aside">
        <div>
          <dl class="facts">
            <div><dt>Assigned driver</dt><dd>${v.driverId ? esc(L.driverName(v.driverId)) : '<span class="muted" style="font-weight:400">Unassigned</span>'}</dd></div>
            <div><dt>Charge-out rate</dt><dd>${aud0(L.hourlyRate(v))}/hr</dd></div>
            <div><dt>Registration expiry</dt><dd>${T.fmtKey(v.regoExpiry)}<span class="sub ${flagTone(L.attentionTone(r.state, r.days))}">${esc(r.state === 'ok' ? 'Current — ' + r.why : r.why)}</span></dd></div>
            <div><dt>Next service</dt><dd>${T.fmtKey(v.nextServiceDate)}${s.hasKm ? ` or ${L.fmtKm(v.nextServiceKm)}` : ' · date only'}<span class="sub ${flagTone(L.attentionTone(s.state, s.daysLeft, s.kmLeft))}">${esc(s.why.charAt(0).toUpperCase() + s.why.slice(1))}</span></dd></div>
            ${v.status === 'In workshop' && v.workshopId ? `<div><dt>Currently at</dt><dd>${esc((AD.store.get('workshops', v.workshopId) || {}).name || 'Unknown workshop')}</dd></div>` : ''}
          </dl>
          ${detailsFacts(v)}
          <section class="section">
            ${sectionHead({ title: 'Recent services', meta: `${services.length} recorded`, level: 3 })}
            <ul class="rows">
              ${services.slice(0, 4).map((x) => `<li><span class="id">${T.fmtKey(x.date)}</span><span class="what">${esc(x.type)}<span class="t2">${x.workshop ? esc(x.workshop) : 'Workshop not recorded'}</span></span><span class="when">${L.fmtAUD(x.cost)}</span></li>`).join('') || '<li class="muted">No services recorded.</li>'}
            </ul>
          </section>
          <section class="section">
            ${sectionHead({ title: 'Open defects', meta: `${defects.filter((d) => d.status !== 'Resolved').length} open`, level: 3 })}
            <ul class="rows">
              ${defects.filter((d) => d.status !== 'Resolved').slice(0, 4).map((d) => `<li><span class="id">${T.fmtKey(d.reportedDate)}</span><span class="what">${esc(d.description)}<span class="t2">${esc(d.reportedBy)}</span></span><span class="when">${priorityBadge(d.priority)}</span></li>`).join('') || '<li class="muted">No open defects.</li>'}
            </ul>
          </section>
        </div>
        <aside class="aside">
          <section class="section">
            ${sectionHead({ title: 'Update odometer', level: 3 })}
            <form class="inline-form" id="odo-form" novalidate>
              <div class="field"><label for="odo-in">New reading (km)</label><input id="odo-in" type="number" name="odo" min="${v.odometer}" step="1" placeholder="${v.odometer}"></div>
              <button class="btn btn-primary" type="submit">Update</button>
            </form>
            <p class="help">Current ${L.fmtKm(v.odometer)}. Readings can’t go backwards.</p>
          </section>
          <section class="section">
            ${sectionHead({ title: 'Vehicle status', level: 3 })}
            <form class="inline-form" id="status-form">
              <div class="field"><label for="status-in">Status</label><select id="status-in" name="status">${options(AD.VEHICLE_STATUSES, v.status)}</select></div>
              <div class="field" id="wk-field" style="${v.status === 'In workshop' ? '' : 'display:none'}">
                <label for="wk-in">Workshop</label>
                <select id="wk-in" name="workshopId">${options(L.workshopsFor(v.type).map((w) => [w.id, w.name]), v.workshopId || '', 'Not specified')}</select>
              </div>
              <button class="btn btn-secondary" type="submit">Save</button>
            </form>
          </section>
          ${v.notes ? `<section class="section">${sectionHead({ title: 'Notes', level: 3 })}<p style="padding-top:10px">${esc(v.notes)}</p></section>` : ''}
        </aside>
      </div>`;
  }

  // ---------- Revenue ----------
  const aud0 = (n) => Math.round(n).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
  const audK = (n) => (Math.abs(n) >= 1000 ? '$' + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : aud0(n));

  function trend(now, before, label) {
    if (!before) return `<span class="kpi-trend kpi-trend-flat"><b>—</b> ${esc(label)}</span>`;
    const pct = Math.round(((now - before) / before) * 100);
    if (pct === 0) return `<span class="kpi-trend kpi-trend-flat"><b>0%</b> ${esc(label)}</span>`;
    return `<span class="kpi-trend kpi-trend-${pct > 0 ? 'up' : 'down'}"><b>${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)}%</b> ${esc(label)}</span>`;
  }

  function revenueTab(v) {
    const [from, to] = rangeBounds();
    const span = to - from;
    const period = L.revenue(v, from, to);
    const prior = L.revenue(v, from - span, from);
    const rangeLabel = (RANGES.find((r) => r.key === range) || RANGES[0]).label.toLowerCase();

    // Month to date, against the same span in the previous month.
    const p = T.parts(Date.now());
    const monthStart = Date.UTC(p.year, p.month - 1, 1);
    const mtd = L.revenue(v, monthStart, to);
    const prevMonth = L.revenue(v, Date.UTC(p.year, p.month - 2, 1), monthStart);

    const c = L.costs(v, from, to);
    const clients = L.revenueBy(v, from, to, 'client');
    const jobTypes = L.revenueBy(v, from, to, 'jobName');
    const shortLabel = (RANGES.find((r) => r.key === range) || RANGES[0]).short;
    const trendBucket = range === '30d' ? 'day' : range === '3m' ? 'week' : 'month';
    const trendSeries = L.revenueSeries(v, from, to, trendBucket);

    if (!period.count) {
      return `<p class="empty">No completed jobs in the ${esc(rangeLabel)}.${v.type !== 'Vac truck' ? ' Only vac trucks currently generate billable bookings.' : ''}</p>`;
    }

    const kpi = (icon, tone, label, sub, value, foot) => `
      <div class="strip-item is-static">
        <div class="kpi-top">${`<span class="kpi-ico kpi-${tone}">${icon}</span>`}<span class="kpi-title">${esc(label)}${sub ? ` <span class="kpi-sub">(${esc(sub)})</span>` : ''}</span></div>
        <span class="v">${value}</span>
        ${foot ? `<span class="kpi-foot">${foot}</span>` : ''}
      </div>`;

    return `
      <div class="strip strip-5" role="group" aria-label="Revenue summary">
        ${kpi(I.activity, 'blue', 'Revenue', 'MTD', aud0(mtd.total), trend(mtd.total, prevMonth.total, 'vs last month'))}
        ${kpi(I.file, 'green', 'Revenue', shortLabel, aud0(period.total), trend(period.total, prior.total, 'vs prior period'))}
        ${kpi(I.clock, 'blue', 'Booked hours', shortLabel, Math.round(period.hours) + ' hrs', trend(period.hours, prior.hours, 'vs prior period'))}
        ${kpi(I.gauge, 'amber', 'Avg revenue / hour', '', aud0(period.rate) + '/hr', `${period.count} jobs billed`)}
        ${kpi(I.truck, 'amber', 'Avg revenue / job', '', aud0(period.total / period.count), trend(period.total / period.count, prior.count ? prior.total / prior.count : 0, 'vs prior period'))}
      </div>

      <div class="rev-grid rev-grid-2x2">
        <section class="section viz-card">
          ${sectionHead({ title: 'Revenue trend', meta: esc(shortLabel), level: 3 })}
          ${trendBars(trendSeries)}
        </section>
        <section class="section viz-card">
          ${sectionHead({ title: 'Revenue vs operating costs', meta: esc(rangeLabel), level: 3 })}
          ${costBars(c)}
          <p class="section-foot muted small">Maintenance is from recorded services. Fuel and other running costs are modelled from booked hours.</p>
        </section>
        <section class="section viz-card">
          ${sectionHead({ title: 'Revenue by client', meta: `${clients.length} clients`, level: 3 })}
          ${donutSplit(clients, period.total, 'client')}
        </section>
        <section class="section viz-card">
          ${sectionHead({ title: 'Revenue by job type', meta: `${jobTypes.length} types`, level: 3 })}
          ${donutSplit(jobTypes, period.total, 'type')}
        </section>
      </div>`;
  }

  /** Monthly (or weekly/daily) revenue bar chart. Ghost bar shows the ceiling. */
  function trendBars(series) {
    const max = Math.max(...series.map((b) => b.total), 1);
    // Y-axis: 4 gridlines at a rounded step.
    const step = niceStep(max / 4);
    const top = Math.ceil(max / step) * step || step;
    const gridVals = [];
    for (let v = 0; v <= top; v += step) gridVals.push(v);
    // Too many bars → thin the labels (show first, last, and every Nth) so they don't overlap.
    const labelStride = series.length > 20 ? Math.ceil(series.length / 8) : 1;
    return `<div class="trend-chart" role="img" aria-label="${esc('Revenue trend, ' + series.map((b) => `${b.label} ${aud0(b.total)}`).join(', '))}">
      <div class="trend-y">
        ${gridVals.slice().reverse().map((v) => `<span>${audK(v)}</span>`).join('')}
      </div>
      <div class="trend-plot">
        <div class="trend-grid" aria-hidden="true">${gridVals.map(() => '<i></i>').join('')}</div>
        <div class="trend-bars">
          ${series.map((b, i) => {
            const pct = (b.total / top) * 100;
            const showLbl = labelStride === 1 || i === 0 || i === series.length - 1 || i % labelStride === 0;
            return `<div class="trend-bar" tabindex="0" data-tip="${esc(JSON.stringify({ t: b.label, rows: [[b.count + ' jobs', aud0(b.total)]] }))}">
              <span class="tb-track"><i class="tb-ghost"></i><i class="tb-val" style="height:${pct.toFixed(1)}%"></i></span>
              ${showLbl ? `<span class="tb-lbl">${esc(b.label)}</span>` : ''}
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>`;
  }

  /** Pick a "nice" gridline step (1, 2, 5 × 10^n) at or above the raw step. */
  function niceStep(raw) {
    if (!isFinite(raw) || raw <= 0) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / pow;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
  }

  /** Grouped column chart: revenue, each cost line, then the margin. */
  function costBars(c) {
    const bars = [
      { label: 'Revenue', value: c.revenue, color: 'var(--viz-available)' },
      { label: 'Maintenance', value: c.maintenance, color: 'var(--st-critical)' },
      { label: 'Fuel', value: c.fuel, color: 'var(--viz-confirmed)' },
      { label: 'Other', value: c.other, color: 'var(--viz-low)' },
      { label: 'Est. margin', value: c.margin, color: 'var(--mint-strong)' }
    ];
    const max = Math.max(...bars.map((b) => Math.abs(b.value)), 1);
    return `<div class="cost-bars" role="img" aria-label="${esc(bars.map((b) => `${b.label} ${aud0(b.value)}`).join(', '))}">
      ${bars.map((b) => `<div class="cost-bar" title="${esc(b.label)}: ${aud0(b.value)}">
        <span class="cost-val">${audK(b.value)}</span>
        <span class="cost-track"><i style="height:${Math.max((Math.abs(b.value) / max) * 100, 2)}%;background:${b.color}"></i></span>
        <span class="cost-lbl">${esc(b.label)}</span>
      </div>`).join('')}
    </div>`;
  }

  /** Donut with a ranked legend; anything past the top five folds into Other. */
  function donutSplit(parts, total, noun) {
    const PALETTE = ['var(--viz-confirmed)', 'var(--viz-available)', 'var(--viz-maint)', 'var(--st-warning)', 'var(--viz-tentative)'];
    const top = parts.slice(0, 5).map((p, i) => ({ ...p, color: PALETTE[i] }));
    const restVal = parts.slice(5).reduce((s, p) => s + p.value, 0);
    if (restVal > 0) top.push({ label: 'Other', value: restVal, color: 'var(--viz-low)' });

    const sz = 132, sw = 18, r = (sz - sw) / 2, circ = 2 * Math.PI * r;
    const sum = top.reduce((s, p) => s + p.value, 0) || 1;
    let acc = 0;
    const arcs = top.map((p) => {
      const len = (p.value / sum) * circ;
      const draw = Math.max(len - 3, 1.5);
      const off = -acc;
      acc += len;
      return `<circle class="ring-arc" cx="${sz / 2}" cy="${sz / 2}" r="${r}" fill="none" stroke="${p.color}" stroke-width="${sw}"
        style="--dash:${draw.toFixed(2)}px"
        stroke-dasharray="${draw.toFixed(2)} ${(circ - draw).toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}"
        transform="rotate(-90 ${sz / 2} ${sz / 2})"><title>${esc(p.label)}: ${aud0(p.value)}</title></circle>`;
    }).join('');

    return `<div class="rev-split">
      <svg class="rev-donut" viewBox="0 0 ${sz} ${sz}" role="img" aria-label="Revenue by ${esc(noun)}">
        <circle cx="${sz / 2}" cy="${sz / 2}" r="${r}" fill="none" stroke="var(--viz-free)" stroke-width="${sw}"/>
        ${arcs}
        <text class="rev-donut-big" x="${sz / 2}" y="${sz / 2 - 6}" text-anchor="middle" dominant-baseline="central">${audK(total)}</text>
        <text class="rev-donut-small" x="${sz / 2}" y="${sz / 2 + 13}" text-anchor="middle" dominant-baseline="central">total</text>
      </svg>
      <ul class="rev-legend">
        ${top.map((p) => `<li>
          <i style="background:${p.color}"></i>
          <span class="rev-legend-lbl">${esc(p.label)}</span>
          <span class="rev-legend-pct">${Math.round((p.value / sum) * 100)}%</span>
          <span class="rev-legend-val">${aud0(p.value)}</span>
        </li>`).join('')}
      </ul>
    </div>`;
  }

  return { title: (arg) => arg || 'Vehicle', render, refresh: () => root && draw() };
})();
