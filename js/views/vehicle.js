/* Vehicle details */
AD.views = AD.views || {};

AD.views.vehicle = (function () {
  const { esc, options, vehicleBadge, stateBadge, priorityBadge, defectBadge, bookingBadge, toast, pageHeader, sectionHead, dash } = AD.ui;
  const L = AD.logic, T = AD.time, I = AD.icons;
  const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'bookings', label: 'Bookings', vacOnly: true },
    { key: 'trips', label: 'Trips', trackedOnly: true },
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
  let root = null, id = null, tab = 'overview', range = '12m';
  // Trips are fetched live from Netstar; cache per-vehicle so a redraw (e.g.
  // after saving the odometer) doesn't refetch.
  let tripsData = null, tripsFor = null;
  // Live Leaflet map + animation frame for the Trips tab, torn down on redraw.
  let tripMap = null, tripRaf = null;
  // Charts animate in when a tab is opened, not on every redraw (saving the
  // odometer would otherwise replay every chart on the page).
  let fresh = true;

  function render(el, params, arg) {
    root = el; id = arg;
    tab = TABS.some((t) => t.key === params.tab) ? params.tab : 'overview';
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
    killTripMap(); // the old map's DOM is about to be replaced
    const v = AD.store.get('vehicles', id);
    if (!v) {
      el.innerHTML = `<a class="back" href="#/fleet">${I.chevL} Fleet register</a>
        <p class="empty">Vehicle “${esc(id)}” was not found. It may have been removed.</p>`;
      return;
    }
    const isVac = v.type === 'Vac truck';
    const isTracked = v.odometerSource === 'telematics' || !!v.netstarRego;
    if (tab === 'bookings' && !isVac) tab = 'overview';
    if (tab === 'trips' && !isTracked) tab = 'overview';

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
          ${(L.HOURS_TYPES && L.HOURS_TYPES.has(v.type)) || (v.engineHours != null && v.engineHours !== '') ? `<div><dt>Engine hours</dt><dd>${v.engineHours != null && v.engineHours !== '' ? L.fmtHours(v.engineHours) : '<span class="muted" style="font-weight:400">Not recorded</span>'}</dd></div>` : ''}
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
          ${TABS.filter((t) => (!t.vacOnly || isVac) && (!t.trackedOnly || isTracked)).map((t) => `
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

    // Trips tab
    if (tab === 'trips') bindTrips(el, v);

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
    // Activity panel: switch the chart + insight tiles between hours and km.
    const panel = el.querySelector('.act-panel');
    if (panel) panel.querySelectorAll('[data-act-chart]').forEach((b) => (b.onclick = () => {
      panel.dataset.unit = b.dataset.actChart;
      panel.querySelectorAll('[data-act-chart]').forEach((o) => o.classList.toggle('on', o === b));
    }));
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
    if (tab === 'trips') return tripsTab(v);
    if (tab === 'photos') return photosTab(v);
    if (tab === 'revenue') return revenueTab(v);

    if (tab === 'service') {
      const trig = L.serviceTriggers(v);
      const showHours = trig.hours || services.some((x) => x.hours != null && x.hours !== '');
      return `
      <div class="tab-tools"><span class="t2">Completed services, newest first</span><button class="btn btn-sm btn-secondary" data-record>${I.plus} Record service</button></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th class="num">Odometer</th>${showHours ? '<th class="num">Hours</th>' : ''}<th>Service</th><th class="col-opt">Workshop</th><th class="num">Cost</th></tr></thead><tbody>
      ${services.map((x) => `<tr><td class="nowrap">${T.fmtKey(x.date)}</td><td class="num">${L.fmtKm(x.odometer)}</td>${showHours ? `<td class="num">${x.hours != null && x.hours !== '' ? L.fmtHours(x.hours) : dash}</td>` : ''}<td>${esc(x.type)}${x.notes ? `<span class="t2">${esc(x.notes)}</span>` : ''}</td><td class="col-opt">${x.workshop ? esc(x.workshop) : dash}</td><td class="num">${L.fmtAUD(x.cost)}</td></tr>`).join('') || `<tr><td colspan="${showHours ? 6 : 5}" class="empty">No services recorded.</td></tr>`}
      </tbody></table></div>`;
    }

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

  function nextServiceLabel(v, s) {
    const bits = [];
    if (s.triggers.date && v.nextServiceDate) bits.push(T.fmtKey(v.nextServiceDate));
    if (s.triggers.km && s.hasKm) bits.push(L.fmtKm(v.nextServiceKm));
    if (s.triggers.hours && s.hasHours) bits.push(L.fmtHours(v.nextServiceHours));
    if (!bits.length) return '<span class="muted" style="font-weight:400">Not scheduled</span>';
    const triggerLabels = [];
    if (s.triggers.date) triggerLabels.push('date');
    if (s.triggers.km) triggerLabels.push('km');
    if (s.triggers.hours) triggerLabels.push('hours');
    return `${bits.join(' · ')} <span class="t2" style="font-weight:400">Notify by ${triggerLabels.join(' + ')}</span>`;
  }

  /**
   * C: estimate when the km-based service will fall due, from how far the
   * vehicle has actually been driven since its last service. Needs a km
   * trigger, a positive distance-to-go, and at least a week of history for a
   * stable average — otherwise returns '' so no noisy guess is shown.
   */
  const fmtPerDay = (perDay) => perDay >= 10 ? Math.round(perDay).toLocaleString('en-AU') : perDay.toFixed(1);

  /** The vehicle's usage rate, anchored on its most precise last-service record. */
  function usageFor(v, services) {
    const last = services && services[0];
    return L.usageRate(v, last && last.odometer != null ? last.odometer : null, last ? last.date : null);
  }

  function projServiceByDistance(v, s, services) {
    if (!(s.triggers.km && s.hasKm) || !Number.isFinite(s.kmLeft) || s.kmLeft <= 0) return '';
    const u = usageFor(v, services);
    if (!u) return '';
    const daysTo = Math.round(s.kmLeft / u.perDay);
    return `About ${daysTo.toLocaleString('en-AU')} day${daysTo === 1 ? '' : 's'} at current use (~${fmtPerDay(u.perDay)} km/day)`;
  }

  /**
   * Activity over the last 30 days from the GPS tracker — engine hours and
   * distance, each as a line/area chart with per-day detail on hover, four
   * insight tiles, and a full table. A toggle switches between the two; days
   * the tracker reported nothing for are left as gaps, not zeros. Vehicles with
   * no tracker get no section at all.
   */
  function engineHoursChart(v) {
    const daily = L.workHoursDaily(v, 30);
    const tracked = v.odometerSource === 'telematics' || !!v.netstarRego;
    if (!daily && !tracked) return '';
    if (!daily || !daily.withData) {
      return `<section class="section">
        ${sectionHead({ title: 'Activity', meta: 'last 30 days · from GPS', level: 3 })}
        <div class="empty-tidy">${I.activity}No daily activity data yet. Press “Sync GPS data” on the Fleet register to pull it in.</div>
      </section>`;
    }

    const days = daily.days;
    const fmtDay = (k) => new Date(k + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
    const r1 = (n) => (Math.round(n * 10) / 10).toLocaleString('en-AU');
    const r0 = (n) => Math.round(n).toLocaleString('en-AU');

    // One unit's worth of numbers + insight tiles + chart.
    function build(cfg) {
      const vals = days.map((d) => cfg.get(d));
      const active = vals.filter((x) => x != null);
      const total = active.reduce((s, x) => s + x, 0);
      const worked = active.filter((x) => x > 0).length;
      const avg = worked ? total / worked : 0;
      let peak = { v: -1, day: null };
      days.forEach((d) => { const x = cfg.get(d); if (x != null && x > peak.v) peak = { v: x, day: d.day }; });
      const sumRange = (from, to) => days.slice(from, to).reduce((s, d) => s + (cfg.get(d) || 0), 0);
      const last7 = sumRange(days.length - 7, days.length);
      const prev7 = sumRange(days.length - 14, days.length - 7);
      const delta = prev7 > 0 ? (last7 - prev7) / prev7 * 100 : null;
      const trend = delta == null ? '—' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(delta))}%`;
      const trendTone = delta == null ? 'muted' : (delta >= 0 ? 'up' : 'down');

      const tile = (label, big, sub) => `<div class="act-tile"><span class="act-tile-l">${label}</span><b>${big}</b><span class="act-tile-s">${sub}</span></div>`;
      const tiles = `
        ${tile('This week', `${cfg.fmt(last7)}`, `<span class="act-trend ${trendTone}">${trend}</span> vs last week`)}
        ${tile('Daily average', cfg.fmt(avg), `on the ${worked} day${worked === 1 ? '' : 's'} it worked`)}
        ${tile('Busiest day', peak.day ? cfg.fmt(peak.v) : '—', peak.day ? fmtDay(peak.day) : 'no activity')}
        ${tile('30-day total', cfg.fmt(total), `${worked} of 30 days active`)}`;

      // Spline line + area chart (matches the cost sheet's style).
      const W = 760, H = 190, padL = 44, padR = 14, padT = 14, padB = 26;
      const plotW = W - padL - padR, plotH = H - padT - padB, n = days.length;
      const top = (() => { const m = Math.max(...active, cfg.min); const step = cfg.step; return Math.max(step, Math.ceil(m / step) * step); })();
      const x = (i) => padL + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
      const y = (val) => padT + plotH - (Math.min(val, top) / top) * plotH;
      // Points we actually have (gaps are skipped so the line doesn't dive to 0).
      const pts = days.map((d, i) => ({ i, x: x(i), v: cfg.get(d), day: d.day, d })).filter((p) => p.v != null).map((p) => ({ ...p, y: y(p.v) }));
      const clampY = (val) => Math.max(padT, Math.min(padT + plotH, val));
      const spline = (ps) => ps.length < 2 ? (ps.length ? `M${ps[0].x.toFixed(1)},${ps[0].y.toFixed(1)}` : '') : ps.reduce((dd, p1, i) => {
        if (i === ps.length - 1) return dd;
        const p0 = ps[i - 1] || p1, p2 = ps[i + 1], p3 = ps[i + 2] || p2;
        const c1x = p1.x + (p2.x - p0.x) / 6, c1y = clampY(p1.y + (p2.y - p0.y) / 6);
        const c2x = p2.x - (p3.x - p1.x) / 6, c2y = clampY(p2.y - (p3.y - p1.y) / 6);
        return `${dd} C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
      }, `M${ps[0].x.toFixed(1)},${ps[0].y.toFixed(1)}`);
      const floorY = (padT + plotH).toFixed(1);
      const lineD = spline(pts);
      const areaD = pts.length >= 2 ? `${lineD} L${pts[pts.length - 1].x.toFixed(1)},${floorY} L${pts[0].x.toFixed(1)},${floorY} Z` : '';
      const gridY = [0, 0.5, 1].map((f) => padT + plotH * (1 - f));
      const grid = gridY.map((gy) => `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}" class="act-grid"></line>`).join('');
      // gridY is [bottom, middle, top], so the tick values must run 0 → top.
      const yTicks = [0, top / 2, top].map((val, i) => `<text class="act-axis" x="${padL - 7}" y="${(gridY[i] + 4).toFixed(1)}" text-anchor="end">${cfg.axis(val)}</text>`).join('');
      const dots = pts.map((p) => {
        const recent = p.i >= n - 7;
        const tipRows = [['Engine hours', p.d.hours != null ? r1(p.d.hours) + ' hr' : '—'], ['Distance', p.d.km != null ? r0(p.d.km) + ' km' : '—']];
        return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${recent ? 4.5 : 3.5}" class="act-dot${recent ? ' recent' : ''}" tabindex="0" ${AD.viz.tipAttr(fmtDay(p.day), tipRows)}></circle>`;
      }).join('');
      const chart = `<svg class="act-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${cfg.label} per day over the last 30 days">
        ${grid}${yTicks}
        ${areaD ? `<path d="${areaD}" class="act-area" style="fill:url(#actgrad-${cfg.key})"></path>` : ''}
        <defs><linearGradient id="actgrad-${cfg.key}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${cfg.color}" stop-opacity="0.34"></stop>
          <stop offset="100%" stop-color="${cfg.color}" stop-opacity="0.02"></stop>
        </linearGradient></defs>
        ${lineD ? `<path d="${lineD}" class="act-line" style="stroke:${cfg.color}"></path>` : ''}
        ${dots}
      </svg>`;
      return { tiles, chart };
    }

    const hours = build({ key: 'h', label: 'Engine hours', get: (d) => d.hours, min: 2, step: 2, fmt: (x) => `${r1(x)} hr`, axis: (x) => `${r1(x)}h` });
    const km = build({ key: 'k', label: 'Distance', get: (d) => d.km, min: 50, step: 50, fmt: (x) => `${r0(x)} km`, axis: (x) => r0(x) });

    const tableRows = days.map((d) => [fmtDay(d.day), d.hours != null ? r1(d.hours) + ' hr' : '—', d.km != null ? r0(d.km) + ' km' : '—']);
    const first = fmtDay(days[0].day), lastDay = fmtDay(days[days.length - 1].day);

    return `<section class="section act-panel" data-unit="h" style="--act-h:${'#5fe0b4'};--act-k:${'#5aa2f0'}">
      <div class="act-head">
        ${sectionHead({ title: 'Activity', meta: `last 30 days · ${daily.withData} days with data · from GPS`, level: 3 })}
        <div class="act-toggle" role="group" aria-label="Metric">
          <button type="button" data-act-chart="h" class="on">${I.gauge} Engine hours</button>
          <button type="button" data-act-chart="k">${I.truck} Distance</button>
        </div>
      </div>
      <div class="act-tiles act-when-h">${hours.tiles}</div>
      <div class="act-tiles act-when-k">${km.tiles}</div>
      <div class="act-chartwrap act-when-h">${hours.chart}</div>
      <div class="act-chartwrap act-when-k">${km.chart}</div>
      <div class="act-x"><span>${esc(first)}</span><span class="act-key"><i class="act-keydot recent"></i>Last 7 days <i class="act-keydot"></i>Earlier · gaps = no GPS data</span><span>${esc(lastDay)}</span></div>
      ${AD.viz.table(['Date', 'Engine hours', 'Distance'], tableRows)}
    </section>`;
  }

  // ---- Trips tab -------------------------------------------------------
  // A map of where a trackered vehicle has been. Opens showing the last 10
  // days' routes; pick a day to replay it, with the vehicle's own cartoon
  // driving the route and the trail coloured by speed.
  //
  // NOTE: `L` in this file is AD.logic — Leaflet is always `window.L`.

  const fmtMins = (m) => {
    m = Math.round(Number(m) || 0);
    if (!m) return '0m';
    const h = Math.floor(m / 60), mm = m % 60;
    return h ? `${h}h ${mm}m` : `${mm}m`;
  };
  const fmtDayShort = (k) => new Date(k + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });

  function mapStyle() {
    const t = document.documentElement.getAttribute('data-theme');
    if (t === 'dark') return 'dark';
    if (t === 'light') return 'light';
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  // Green (slow) -> amber -> red (fast), 0..100 km/h.
  function speedColor(s) {
    if (s == null || !Number.isFinite(Number(s))) return '#5aa2f0';
    const stops = [[0, [70, 232, 171]], [0.5, [245, 177, 76]], [1, [240, 103, 95]]];
    const x = Math.max(0, Math.min(1, Number(s) / 100));
    let a = stops[0], b = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) { if (x >= stops[i][0] && x <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; break; } }
    const f = (b[0] - a[0]) ? (x - a[0]) / (b[0] - a[0]) : 0;
    const c = a[1].map((val, i) => Math.round(val + (b[1][i] - val) * f));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  function statStrip(s) {
    const cell = (label, val) => `<div><dt>${label}</dt><dd>${val}</dd></div>`;
    if (!s) return `<dl class="trip-stat-row">${['Trips', 'Distance', 'Driving', 'Idle', 'Top speed', 'Engine hours'].map((l) => cell(l, '—')).join('')}</dl>`;
    return `<dl class="trip-stat-row">
      ${cell('Trips', s.trips)}
      ${cell('Distance', `${Math.round(s.km).toLocaleString('en-AU')} km`)}
      ${cell('Driving', fmtMins(s.driveMin))}
      ${cell('Idle', fmtMins(s.idleMin))}
      ${cell('Top speed', s.maxSpeed ? `${s.maxSpeed} km/h` : '—')}
      ${cell('Engine hours', s.hours != null ? `${Math.round(s.hours * 10) / 10} hr` : '—')}
    </dl>`;
  }

  function tripsTab(v) {
    return `<div class="trips-tab">
      <div id="tp-stats">${statStrip(null)}</div>
      <div class="trip-days" id="tp-days"><span class="t2">Loading trips from GPS…</span></div>
      <div class="trk-map-wrap trip-mapwrap" id="tp-wrap">
        <div class="trk-map" id="tp-map" aria-label="Map of where ${esc(v.id)} has been"></div>
        <div class="replay-legend">Slow<i class="replay-ramp"></i>Fast</div>
        <div class="trip-source" id="tp-source" hidden></div>
        <div class="trip-play" id="tp-bar" hidden>
          <button class="btn btn-sm btn-primary trip-playbtn" id="tp-play">${I.play} Play</button>
          <input type="range" id="tp-scrub" min="0" max="1000" value="0" aria-label="Scrub through the day">
          <span class="replay-read" id="tp-read"></span>
          <div class="trip-dur" role="group" aria-label="Replay length">
            <button type="button" data-dur="15">15s</button>
            <button type="button" data-dur="30" class="on">30s</button>
            <button type="button" data-dur="60">60s</button>
          </div>
        </div>
      </div>
    </div>`;
  }

  /** Tear down the trips map when the view redraws or the tab changes. */
  function killTripMap() {
    if (tripRaf) { cancelAnimationFrame(tripRaf); tripRaf = null; }
    if (tripMap) { try { tripMap.remove(); } catch (e) { /* already gone */ } tripMap = null; }
  }

  async function bindTrips(el, v) {
    const LF = window.L;
    const wrap = el.querySelector('#tp-wrap');
    const daysEl = el.querySelector('#tp-days');
    const statsEl = el.querySelector('#tp-stats');
    const bar = el.querySelector('#tp-bar');
    const playBtn = el.querySelector('#tp-play');
    const scrub = el.querySelector('#tp-scrub');
    const read = el.querySelector('#tp-read');
    const sourceEl = el.querySelector('#tp-source');
    const durWrap = el.querySelector('.trip-dur');
    let durSec = 30; // whole route replays in this many seconds (max 60)
    if (durWrap) durWrap.querySelectorAll('[data-dur]').forEach((b) => (b.onclick = () => {
      durSec = Number(b.dataset.dur) || 30;
      durWrap.querySelectorAll('[data-dur]').forEach((o) => o.classList.toggle('on', o === b));
    }));
    if (!wrap || !LF) { if (daysEl) daysEl.innerHTML = '<span class="t2">Map library unavailable — check your connection.</span>'; return; }

    const dark = mapStyle() === 'dark';
    wrap.classList.toggle('is-dark', dark);
    const map = AD.maps.create(el.querySelector('#tp-map'), wrap, { style: mapStyle(), zoomControl: true, zoomSnap: 0.5 });
    tripMap = map;
    if (!map) return;
    setTimeout(() => { try { map.invalidateSize(); } catch (e) { /* removed */ } }, 60);

    // --- data -----------------------------------------------------------
    let data = (tripsFor === v.id && tripsData) ? tripsData : null;
    if (!data) {
      try {
        const r = await AD.sb.functions.invoke('netstar', { body: { action: 'trips', rego: v.rego, netstarRego: v.netstarRego, days: 10 } });
        if (r.error) throw r.error;
        data = r.data; tripsData = data; tripsFor = v.id;
      } catch (e) {
        daysEl.innerHTML = `<span class="t2">Couldn’t load trips: ${esc((e && e.message) || 'tracker service unavailable')}</span>`;
        return;
      }
    }
    if (tripMap !== map) return; // view redrew while we were loading
    const days = (data && data.days) || [];
    if (!days.length) {
      daysEl.innerHTML = `<span class="t2">No trips in the last 10 days.${data && data.raw ? ` <span class="muted">${esc(String(data.raw).slice(0, 120))}</span>` : ''}</span>`;
      return;
    }

    // --- helpers ---------------------------------------------------------
    let layers = [], marker = null, sel = null, playing = false;
    const pathCache = {};

    const clearLayers = () => { layers.forEach((l) => map.removeLayer(l)); layers = []; if (marker) { map.removeLayer(marker); marker = null; } };
    const stopPlay = () => { playing = false; if (tripRaf) { cancelAnimationFrame(tripRaf); tripRaf = null; } playBtn.innerHTML = `${I.play} Play`; };

    const km2 = (a, b) => {
      const R = 6371, rad = (x) => x * Math.PI / 180;
      const dLa = rad(b.lat - a.lat), dLo = rad(b.lng - a.lng);
      const s = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLo / 2) ** 2;
      return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
    };
    // Netstar doesn't always send a speed per point; work it out from the
    // distance and time between neighbours so the line is always coloured.
    function fillSpeeds(pts) {
      for (let i = 0; i < pts.length; i++) {
        const s = Number(pts[i].speed);
        if (Number.isFinite(s) && s > 0) { pts[i].speed = s; continue; }
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        const hrs = Math.abs(b.ms - a.ms) / 3600000;
        pts[i].speed = hrs > 0 ? Math.min(130, km2(a, b) / hrs) : 0;
      }
      return pts;
    }
    // Sparse routes (e.g. two points per trip) animate in jerky hops; add
    // in-between points so the vehicle glides and the colour reads smoothly.
    function densify(pts, target = 220) {
      if (pts.length < 2 || pts.length >= target) return pts;
      const spans = pts.length - 1, per = Math.max(1, Math.ceil(target / spans));
      const out = [];
      for (let i = 0; i < spans; i++) {
        const a = pts[i], b = pts[i + 1];
        for (let k = 0; k < per; k++) {
          const f = k / per;
          out.push({ lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f, ms: a.ms + (b.ms - a.ms) * f, speed: a.speed != null ? a.speed : b.speed });
        }
      }
      out.push(pts[pts.length - 1]);
      return out;
    }
    function normalise(pts) {
      pts = (pts || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
      if (pts.length < 2) return pts;
      if (!pts.every((p) => Number.isFinite(p.ms))) pts.forEach((p, i) => (p.ms = i * 60000));
      pts.sort((a, b) => a.ms - b.ms);
      return pts;
    }
    /** Thick, speed-coloured route: a dark casing with coloured runs on top. */
    function drawRoute(points) {
      layers.push(LF.polyline(points.map((p) => [p.lat, p.lng]), {
        color: dark ? '#071a2b' : '#1d3550', weight: 12, opacity: 0.55, lineJoin: 'round', lineCap: 'round'
      }).addTo(map));
      const bucket = (s) => Math.min(7, Math.floor((Number(s) || 0) / 15));
      let runStart = 0;
      for (let i = 1; i < points.length; i++) {
        const last = i === points.length - 1;
        if (last || bucket(points[i + 1].speed) !== bucket(points[i].speed)) {
          const seg = points.slice(runStart, i + 1).map((p) => [p.lat, p.lng]);
          if (seg.length > 1) {
            layers.push(LF.polyline(seg, { color: speedColor(points[i].speed), weight: 7, opacity: 0.98, lineJoin: 'round', lineCap: 'round' }).addTo(map));
          }
          runStart = i;
        }
      }
    }
    // Fallback when there are no GPS breadcrumbs: the trips' own start/end points.
    function tripPoints(day) {
      const pts = [];
      day.trips.forEach((t) => {
        if (t.startC) pts.push({ lat: t.startC.lat, lng: t.startC.lng, ms: t.startMs, speed: t.avgSpeed });
        if (t.endC) pts.push({ lat: t.endC.lat, lng: t.endC.lng, ms: (t.startMs != null && t.travelMin != null) ? t.startMs + t.travelMin * 60000 : null, speed: t.avgSpeed });
      });
      return normalise(pts);
    }
    async function pathFor(date, day) {
      if (pathCache[date]) return pathCache[date];
      let pts = [], raw = null;
      try {
        const r = await AD.sb.functions.invoke('netstar', { body: { action: 'trip-path', rego: v.rego, netstarRego: v.netstarRego, date } });
        pts = normalise(((r.data && r.data.points) || []).slice());
        raw = (r.data && r.data.raw) || null;
      } catch (e) { /* fall back */ }
      let approx = false;
      if (pts.length < 2) { pts = tripPoints(day); approx = true; }
      // How coarse is the tracker's reporting? Big gaps are why a route can
      // cut across country instead of following streets.
      let gapKm = 0, gapMin = 0;
      for (let i = 1; i < pts.length; i++) { gapKm += km2(pts[i - 1], pts[i]); gapMin += Math.abs(pts[i].ms - pts[i - 1].ms) / 60000; }
      const spans = Math.max(1, pts.length - 1);
      const out = {
        points: pts, approx, raw,
        n: pts.length,
        rows: raw && raw.count != null ? raw.count : null,
        avgGapKm: gapKm / spans,
        avgGapMin: gapMin / spans
      };
      pathCache[date] = out;
      return out;
    }
    const fitTo = (pts) => { if (pts.length) map.fitBounds(LF.latLngBounds(pts.map((p) => [p.lat, p.lng])), { padding: [30, 30] }); };

    function hoursFor(dates) {
      const daily = L.workHoursDaily(v, 30);
      if (!daily) return null;
      const want = new Set(dates);
      let h = 0, any = false;
      daily.days.forEach((d) => { if (want.has(d.day) && d.hours != null) { h += d.hours; any = true; } });
      return any ? h : null;
    }
    function statsFor(list) {
      const s = { trips: 0, km: 0, driveMin: 0, idleMin: 0, maxSpeed: 0 };
      list.forEach((d) => {
        s.trips += d.totals.trips; s.km += d.totals.km;
        s.driveMin += d.totals.driveMin; s.idleMin += d.totals.idleMin;
        s.maxSpeed = Math.max(s.maxSpeed, d.totals.maxSpeed || 0);
      });
      s.hours = hoursFor(list.map((d) => d.date));
      return s;
    }
    const markChips = () => daysEl.querySelectorAll('[data-day]').forEach((b) => b.classList.toggle('on', (b.dataset.day || '') === (sel || '')));

    // --- views ------------------------------------------------------------
    function showAll() {
      stopPlay(); sel = null; bar.hidden = true; sourceEl.hidden = true; clearLayers(); markChips();
      statsEl.innerHTML = statStrip(statsFor(days));
      const all = [];
      days.forEach((d) => {
        const pts = (pathCache[d.date] && pathCache[d.date].points) || fillSpeeds(tripPoints(d));
        if (pts.length > 1) { drawRoute(pts); all.push(...pts); }
      });
      if (all.length) fitTo(all);
    }

    async function showDay(date) {
      stopPlay(); sel = date; clearLayers(); markChips();
      const day = days.find((d) => d.date === date);
      statsEl.innerHTML = statStrip(statsFor([day]));
      bar.hidden = false; sourceEl.hidden = true;
      playBtn.disabled = true; scrub.disabled = true;
      read.textContent = 'Loading route…';

      const info = await pathFor(date, day);
      const { points, approx } = info;
      if (sel !== date || tripMap !== map) return; // switched away while loading
      clearLayers();
      if (points.length < 2) {
        read.textContent = 'No route recorded for this day.';
        playBtn.disabled = true; scrub.disabled = true;
        return;
      }
      // The whole route, thick and speed-coloured, straight away — the operator
      // should see where it went without having to press anything.
      const route = fillSpeeds(densify(points));
      drawRoute(route);
      fitTo(route);
      sourceEl.hidden = false;
      // Coarse breadcrumbs can't follow streets, so say so rather than letting
      // a straight line across country look like the road it took.
      const coarse = !approx && info.avgGapKm > 0.35;
      sourceEl.className = `trip-source${approx || coarse ? ' is-approx' : ''}`;
      sourceEl.textContent = approx
        ? 'Straight-line estimate — no GPS breadcrumbs'
        : `GPS route · ${info.n} points${coarse ? ` · ${info.avgGapKm.toFixed(1)} km apart — too coarse for street detail` : ''}`;
      sourceEl.title = `parsed points: ${info.n}`
        + (info.rows != null ? ` · rows from Netstar: ${info.rows}` : '')
        + ` · average gap: ${info.avgGapKm.toFixed(2)} km / ${info.avgGapMin.toFixed(1)} min`
        + (info.raw && info.raw.keys ? ` · fields: ${info.raw.keys.join(', ')}` : '');
      setupReplay(route, approx);
    }

    function setupReplay(points, approx) {
      const t0 = points[0].ms, t1 = points[points.length - 1].ms;
      const span = t1 - t0;
      const realTime = span > 120000; // the index-based fallback has synthetic times
      let simMs = t0, lastReal = null;

      marker = LF.marker([points[0].lat, points[0].lng], {
        interactive: false, zIndexOffset: 1000,
        icon: LF.divIcon({
          className: 'trip-veh',
          html: `<div class="trip-veh-in">${AD.art.forVehicle(v, 72, `${v.id}`) || AD.art.car(72, v.id)}</div>`,
          iconSize: [72, 54], iconAnchor: [36, 42]
        })
      }).addTo(map);

      const clock = (ms) => realTime ? new Date(ms).toISOString().slice(11, 16) : `${Math.round((ms - t0) / span * 100)}%`;
      function posAt(ms) {
        if (ms <= t0) return points[0];
        if (ms >= t1) return points[points.length - 1];
        for (let i = 0; i < points.length - 1; i++) {
          const a = points[i], b = points[i + 1];
          if (ms >= a.ms && ms <= b.ms) {
            const f = (b.ms - a.ms) ? (ms - a.ms) / (b.ms - a.ms) : 0;
            return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f, speed: a.speed != null ? a.speed : b.speed };
          }
        }
        return points[points.length - 1];
      }
      function render() {
        const p = posAt(simMs);
        marker.setLatLng([p.lat, p.lng]);
        read.textContent = `${clock(simMs)} · ${Math.round(p.speed || 0)} km/h`;
        scrub.value = String(Math.round((simMs - t0) / span * 1000));
      }
      function frame(ts) {
        if (!playing) return;
        if (lastReal == null) lastReal = ts;
        const dt = ts - lastReal; lastReal = ts;
        simMs += dt * (span / (durSec * 1000)); // whole route in durSec seconds
        if (simMs >= t1) { simMs = t1; render(); stopPlay(); return; }
        render();
        tripRaf = requestAnimationFrame(frame);
      }

      playBtn.disabled = false; scrub.disabled = false;
      playBtn.onclick = () => {
        if (playing) { stopPlay(); return; }
        if (simMs >= t1) simMs = t0;
        playing = true; lastReal = null; playBtn.innerHTML = `${I.pause} Pause`;
        tripRaf = requestAnimationFrame(frame);
      };
      scrub.oninput = () => { stopPlay(); simMs = t0 + (Number(scrub.value) / 1000) * span; render(); };
      render();
    }

    // --- day chips --------------------------------------------------------
    daysEl.innerHTML = `<button type="button" class="trip-chip" data-day="">All 10 days</button>`
      + days.map((d) => `<button type="button" class="trip-chip" data-day="${esc(d.date)}">${fmtDayShort(d.date)}<span class="trip-chip-n">${d.totals.trips}</span></button>`).join('');
    daysEl.querySelectorAll('[data-day]').forEach((b) => (b.onclick = () => (b.dataset.day ? showDay(b.dataset.day) : showAll())));

    showAll();
  }

  function overview(v, services, defects) {
    const s = L.serviceState(v), r = L.regoState(v);
    const flagTone = (tone) => (tone ? 'flag-' + tone : 'muted');
    const faint = (txt) => `<span class="muted" style="font-weight:400">${txt}</span>`;
    const isHours = (L.HOURS_TYPES && L.HOURS_TYPES.has(v.type)) || (v.engineHours != null && v.engineHours !== '');
    // A: show where the odometer reading came from when it was synced from GPS.
    const odoProvenance = v.odometerSource === 'telematics'
      ? `<span class="sub sub-gps">From GPS${v.odometerSyncedAt ? ' · synced ' + new Date(v.odometerSyncedAt).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</span>`
      : '';
    // Lead the reading fact with engine hours for hours-tracked plant, else odometer.
    const readingFact = isHours
      ? `<div><dt>Engine hours</dt><dd>${v.engineHours != null && v.engineHours !== '' ? L.fmtHours(v.engineHours) : faint('Not recorded')}${v.odometer != null ? `<span class="sub">${L.fmtKm(v.odometer)} on the clock${v.odometerSource === 'telematics' ? ' · from GPS' : ''}</span>` : ''}</dd></div>`
      : `<div><dt>Odometer</dt><dd>${L.fmtKm(v.odometer)}${odoProvenance}</dd></div>`;
    // Last service: the most recent recorded service, else the stored last-service fields.
    const last = services[0];
    const lastBits = [];
    if (last) {
      lastBits.push(T.fmtKey(last.date));
      if (isHours && last.hours != null && last.hours !== '') lastBits.push(L.fmtHours(last.hours));
      else if (last.odometer != null) lastBits.push(L.fmtKm(last.odometer));
    } else {
      if (v.lastServiceDate) lastBits.push(T.fmtKey(v.lastServiceDate));
      if (isHours && v.lastServiceHours != null && v.lastServiceHours !== '') lastBits.push(L.fmtHours(v.lastServiceHours));
      else if (v.lastServiceKm != null && v.lastServiceKm !== '') lastBits.push(L.fmtKm(v.lastServiceKm));
    }
    const lastServiceCell = lastBits.length ? lastBits.join(' · ') : faint('Not recorded');
    const projService = projServiceByDistance(v, s, services);
    const usage = usageFor(v, services);
    const usageFact = usage
      ? `<div><dt>Usage</dt><dd>${Math.round(usage.perWeek).toLocaleString('en-AU')} km/week<span class="sub">~${fmtPerDay(usage.perDay)} km/day · measured over ${usage.days} days</span></dd></div>`
      : '';
    const wh = L.workHours(v);
    const workHoursFact = wh
      ? `<div><dt>Work hours</dt><dd>${Math.round(wh.perWeek).toLocaleString('en-AU')} hrs/week<span class="sub sub-gps">${Math.round(wh.hours).toLocaleString('en-AU')} hrs engine time over ${wh.days} days · from GPS</span></dd></div>`
      : '';
    const ts = L.tripStats(v);
    const tripSub = ts ? [
      ts.idlePct != null ? `idle ${Math.round(ts.idlePct * 100)}%` : null,
      ts.maxSpeed != null ? `top ${ts.maxSpeed} km/h` : null,
      ts.overspeed ? `${ts.overspeed} overspeed` : null
    ].filter(Boolean).join(' · ') : '';
    const tripFact = ts && (ts.trips != null || ts.runningKm != null || ts.idlePct != null)
      ? `<div><dt>GPS activity</dt><dd>${ts.trips != null ? `${ts.trips.toLocaleString('en-AU')} trip${ts.trips === 1 ? '' : 's'}` : '—'}${ts.runningKm != null ? ` · ${L.fmtKm(ts.runningKm)}` : ''}<span class="sub sub-gps">${tripSub ? tripSub + ' · ' : ''}over ${ts.days} days · from GPS</span></dd></div>`
      : '';
    const openDefs = defects.filter((d) => d.status !== 'Resolved');
    const engineChart = engineHoursChart(v);
    return `
      <div class="cols-main-aside">
        <div>
          <dl class="facts facts-snapshot">
            <div><dt>Assigned driver</dt><dd>${v.driverId ? esc(L.driverName(v.driverId)) : faint('Unassigned')}</dd></div>
            <div><dt>Charge-out rate</dt><dd>${aud0(L.hourlyRate(v))}/hr</dd></div>
            ${readingFact}
            ${usageFact}
            ${workHoursFact}
            ${tripFact}
            <div><dt>Registration expiry</dt><dd>${T.fmtKey(v.regoExpiry)}<span class="sub ${flagTone(L.attentionTone(r.state, r.days))}">${esc(r.state === 'ok' ? 'Current — ' + r.why : r.why)}</span></dd></div>
            <div><dt>Last service</dt><dd>${lastServiceCell}</dd></div>
            <div><dt>Next service</dt><dd>${nextServiceLabel(v, s)}<span class="sub ${flagTone(L.attentionTone(s.state, s.daysLeft, s.kmLeft, s.hoursLeft))}">${esc(s.why.charAt(0).toUpperCase() + s.why.slice(1))}</span>${projService ? `<span class="sub">${esc(projService)}</span>` : ''}</dd></div>
            ${v.status === 'In workshop' && v.workshopId ? `<div class="facts-span"><dt>Currently at</dt><dd>${esc((AD.store.get('workshops', v.workshopId) || {}).name || 'Unknown workshop')}</dd></div>` : ''}
          </dl>
          ${detailsFacts(v)}
          <section class="section">
            ${sectionHead({ title: 'Recent services', meta: `${services.length} recorded`, level: 3 })}
            ${services.length ? `<ul class="rows">
              ${services.slice(0, 4).map((x) => `<li><span class="id">${T.fmtKey(x.date)}</span><span class="what">${esc(x.type)}<span class="t2">${x.workshop ? esc(x.workshop) : 'Workshop not recorded'}</span></span><span class="when">${L.fmtAUD(x.cost)}</span></li>`).join('')}
            </ul>` : `<div class="empty-tidy">${I.wrench}No services recorded yet.</div>`}
          </section>
          <section class="section">
            ${sectionHead({ title: 'Open defects', meta: `${openDefs.length} open`, level: 3 })}
            ${openDefs.length ? `<ul class="rows">
              ${openDefs.slice(0, 4).map((d) => `<li><span class="id">${T.fmtKey(d.reportedDate)}</span><span class="what">${esc(d.description)}<span class="t2">${esc(d.reportedBy)}</span></span><span class="when">${priorityBadge(d.priority)}</span></li>`).join('')}
            </ul>` : `<div class="empty-tidy ok">${I.check}No open defects — all clear.</div>`}
          </section>
          ${engineChart}
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
