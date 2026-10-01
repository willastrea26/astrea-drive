/*
 * Small DOM helpers: escaping, badges, modals, confirmations and toasts.
 */
window.AD = window.AD || {};

AD.ui = (function () {
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /**
   * Status label: small coloured dot + text. `tone` is a space-separated spec:
   * a colour (blue, navy, green, amber, red, slate, teal, grey, ink) plus
   * optional modifiers (ring = hollow dot, square, muted, strike, strong).
   * Red and amber are for things that need attention; blue = scheduled/selected.
   */
  function badge(text, tone = 'grey') {
    const [colour, ...mods] = String(tone).split(' ');
    return `<span class="status st-${colour} ${mods.join(' ')}">${esc(text)}</span>`;
  }

  const VEHICLE_TONE = { 'Available': 'aqua', 'In use': 'blue', 'In workshop': 'violet', 'Out of service': 'red' }; // matches chart colours
  const PRIORITY_TONE = { Low: 'grey', Medium: 'ink', High: 'amber', Critical: 'red strong' };
  const DEFECT_TONE = { Open: 'ink ring', 'In progress': 'navy', Resolved: 'green muted' };
  const STATE_TONE = { overdue: 'red', soon: 'amber', ok: 'green muted' };
  const BOOKING_TONE = { confirmed: 'blue', tentative: 'blue ring', cancelled: 'grey strike', maintenance: 'violet square', depot: 'aqua square' };
  const BOOKING_LABEL = { confirmed: 'Confirmed', tentative: 'Tentative', cancelled: 'Cancelled', maintenance: 'Maintenance', depot: 'Depot' };

  const vehicleBadge = (s) => badge(s, VEHICLE_TONE[s] || 'grey');
  /** Priority colour only matters while a defect is still open. */
  const priorityBadge = (p, resolved = false) => badge(p, resolved ? 'grey muted' : PRIORITY_TONE[p] || 'grey');
  const defectBadge = (s) => badge(s, DEFECT_TONE[s] || 'grey');
  const stateBadge = (st, label) => badge(label, STATE_TONE[st] || 'grey');
  const bookingBadge = (cat) => badge(BOOKING_LABEL[cat] || cat, BOOKING_TONE[cat] || 'grey');

  /** Schedule state label used by Dashboard and Tracker (never invents a location). */
  const SCHEDULE_TONE = { unscheduled: 'grey ring muted', conflict: 'red strong', 'needs-location': 'amber' };
  const SCHEDULE_LABEL = { unscheduled: 'Unscheduled', conflict: 'Clash', 'needs-location': 'Site location required' };
  const scheduleBadge = (key) => SCHEDULE_TONE[key] ? badge(SCHEDULE_LABEL[key], SCHEDULE_TONE[key]) : bookingBadge(key);

  /** Page header used by every screen. */
  function pageHeader({ title, sub = '', actions = '', back = '' }) {
    return `${back}<header class="page-header">
      <div><h1>${esc(title)}</h1>${sub ? `<p class="page-sub">${sub}</p>` : ''}</div>
      ${actions ? `<div class="page-actions">${actions}</div>` : ''}
    </header>`;
  }

  /** Section heading with a fine rule underneath. */
  function sectionHead({ title, meta = '', actions = '', level = 2 }) {
    return `<div class="section-head"><h${level}>${esc(title)}</h${level}>${meta ? `<span class="section-meta">${meta}</span>` : ''}${actions ? `<div class="section-actions">${actions}</div>` : ''}</div>`;
  }

  const dash = '<span class="dash" aria-hidden="true">—</span><span class="sr-only">Not recorded</span>';

  /**
   * Vehicle-level alerts (service, registration, open defects) as a leading
   * icon plus one line per issue. Shared by the fleet register and dashboard.
   * Returns '' when nothing needs attention.
   */
  function attentionFlags(v) {
    const L = AD.logic, T = AD.time, I = AD.icons;
    const s = L.serviceState(v), r = L.regoState(v), defects = L.openDefects(v.id);
    const flag = (tone, text) => `<span class="flag ${tone ? 'flag-' + tone : ''}">${esc(text)}</span>`;
    const defectTone = defects.some((d) => d.priority === 'Critical' || d.priority === 'High') ? 'red'
      : defects.some((d) => d.priority === 'Medium') ? 'amber' : '';
    const regoDate = T.fmtKey(v.regoExpiry).slice(0, 5);
    const regoDays = Math.abs(r.days);
    const regoLine = r.state === 'overdue'
      ? flag('red', `Rego expired ${regoDate} · ${regoDays}d ago`)
      : flag(r.state === 'soon' ? L.attentionTone(r.state, r.days) : 'muted', `Rego due ${regoDate} · ${r.days}d`);
    const svcDate = T.fmtKey(v.nextServiceDate).slice(0, 5);
    const serviceLine = s.state === 'overdue'
      ? flag('red', `Service overdue · ${-s.daysLeft}d`)
      : s.state === 'soon'
        ? flag(L.attentionTone(s.state, s.daysLeft, s.kmLeft), `Service due ${svcDate} · ${s.daysLeft}d`)
        : flag('muted', `Service due ${svcDate} · ${s.daysLeft}d`);
    const lines = [
      serviceLine,
      regoLine,
      defects.length ? flag(defectTone, `${defects.length} open defect${defects.length > 1 ? 's' : ''}`) : ''
    ].filter(Boolean);
    const hasIssue = s.state !== 'ok' || r.state !== 'ok' || defects.length;
    const red = s.state === 'overdue' || r.state === 'overdue' || defectTone === 'red';
    const icon = red ? I.alert : s.state !== 'ok' ? I.wrench : I.calendar;
    const iconTone = red ? 'flag-red' : hasIssue ? 'flag-amber' : 'flag-muted';
    return `<span class="attn-cell"><span class="attn-icon ${iconTone}">${icon}</span><span class="attn-lines">${lines.join('')}</span></span>`;
  }

  /** Link every form label to its control so screen readers announce it. */
  let labelSeq = 0;
  function labelFields(root) {
    root.querySelectorAll('.field').forEach((field) => {
      const label = field.querySelector(':scope > label');
      const control = field.querySelector('input:not([type=checkbox]):not([type=hidden]), select, textarea');
      if (!label || !control || label.htmlFor) return;
      if (!control.id) control.id = `fld-${control.name || 'x'}-${++labelSeq}`;
      label.htmlFor = control.id;
    });
  }

  // ---------- Modal ----------
  let current = null;

  /**
   * Open a modal. `body` is HTML; `onMount(el, close)` wires it up.
   * Returns the close function.
   */
  function modal({ title, body, wide = false, onMount, onClose }) {
    closeModal();
    const root = $('#modal-root');
    root.innerHTML = `
      <div class="modal-backdrop" data-close></div>
      <div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-head">
          <h2 id="modal-title">${esc(title)}</h2>
          <button class="icon-btn" data-close aria-label="Close">${AD.icons.x}</button>
        </div>
        <div class="modal-body">${body}</div>
      </div>`;
    root.classList.add('open');
    document.body.classList.add('modal-open');
    const el = $('.modal', root);
    const close = () => {
      if (current !== close) return;
      current = null;
      root.classList.remove('open');
      root.innerHTML = '';
      document.body.classList.remove('modal-open');
      onClose && onClose();
    };
    current = close;
    $$('[data-close]', root).forEach((b) => b.addEventListener('click', close));
    onMount && onMount(el, close);
    labelFields(el);
    const first = el.querySelector('input:not([type=hidden]):not([disabled]), select, textarea');
    if (first) setTimeout(() => first.focus(), 30);
    return close;
  }

  function closeModal() { if (current) current(); }

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && current && !document.querySelector('.confirm-open')) current(); });

  /** Promise-based confirmation dialog (layered above any modal). */
  function confirm({ title, message, confirmText = 'Confirm', danger = false }) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'confirm-layer confirm-open';
      wrap.innerHTML = `
        <div class="modal-backdrop"></div>
        <div class="modal modal-sm" role="alertdialog" aria-modal="true">
          <div class="modal-head"><h2>${esc(title)}</h2></div>
          <div class="modal-body"><p class="confirm-msg">${message}</p>
            <div class="form-actions">
              <button class="btn btn-ghost" data-no>Cancel</button>
              <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes>${esc(confirmText)}</button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(wrap);
      const done = (v) => { wrap.remove(); document.removeEventListener('keydown', key, true); resolve(v); };
      const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
      document.addEventListener('keydown', key, true);
      wrap.querySelector('[data-no]').onclick = () => done(false);
      wrap.querySelector('.modal-backdrop').onclick = () => done(false);
      wrap.querySelector('[data-yes]').onclick = () => done(true);
      wrap.querySelector('[data-yes]').focus();
    });
  }

  /** Brief notice — only used after a change has actually been saved. */
  function toast(msg, tone = 'ok') {
    const host = $('#toast-root');
    const t = document.createElement('div');
    t.className = `toast toast-${tone}`;
    t.textContent = msg;
    host.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3200);
  }

  /** Read a form into an object keyed by name. */
  function formData(form) {
    const o = {};
    for (const el of form.elements) {
      if (!el.name) continue;
      o[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim();
    }
    return o;
  }

  function showErrors(form, errors) {
    $$('.field-error', form).forEach((e) => e.remove());
    $$('.invalid', form).forEach((e) => { e.classList.remove('invalid'); e.removeAttribute('aria-invalid'); e.removeAttribute('aria-describedby'); });
    for (const [name, msg] of Object.entries(errors)) {
      const el = form.elements[name];
      if (!el) continue;
      el.classList.add('invalid');
      const p = document.createElement('div');
      p.className = 'field-error';
      p.id = `err-${name}-${++labelSeq}`;
      p.textContent = msg;
      el.setAttribute('aria-invalid', 'true');
      el.setAttribute('aria-describedby', p.id);
      el.closest('.field').appendChild(p);
    }
    const first = Object.keys(errors)[0];
    if (first && form.elements[first]) form.elements[first].focus();
    return Object.keys(errors).length === 0;
  }

  const options = (list, selected, placeholder) =>
    (placeholder != null ? `<option value="">${esc(placeholder)}</option>` : '') +
    list.map((o) => {
      const [v, l] = Array.isArray(o) ? o : [o, o];
      return `<option value="${esc(v)}" ${String(v) === String(selected) ? 'selected' : ''}>${esc(l)}</option>`;
    }).join('');

  /**
   * Downscale an image file to at most `max` px on the longest edge and return
   * a JPEG data URL. Rejects non-images and unreadable files via toast + the
   * returned promise rejecting, so callers can abort cleanly.
   */
  function compressImage(file, max = 1200, quality = 0.78) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) { toast('That file is not an image'); return reject(new Error('not-image')); }
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * scale);
          c.height = Math.round(img.height * scale);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => { toast('That image could not be read'); reject(new Error('image-decode')); };
        img.src = reader.result;
      };
      reader.onerror = () => { toast('That file could not be read'); reject(new Error('file-read')); };
      reader.readAsDataURL(file);
    });
  }

  /**
   * Multi-photo picker: renders inside `host`, wraps `initial` in a working
   * array, and calls `onChange(array)` whenever photos are added or removed.
   * Click a thumb to open the lightbox.
   */
  function photoPicker(host, initial, { onChange, label = 'Photos', max = 8 } = {}) {
    const photos = Array.isArray(initial) ? initial.slice() : [];
    host.innerHTML = `
      <div class="photo-picker">
        <div class="photo-grid" role="list"></div>
        <button type="button" class="photo-add" data-add>${AD.icons.plus}<span>Add photo</span></button>
        <input type="file" accept="image/*" multiple hidden>
      </div>`;
    const grid = host.querySelector('.photo-grid');
    const input = host.querySelector('input[type=file]');
    const addBtn = host.querySelector('[data-add]');

    function render() {
      grid.innerHTML = photos.map((src, i) => `
        <div class="photo-thumb" role="listitem">
          <img src="${esc(src)}" alt="${esc(label)} ${i + 1}" data-view="${i}">
          <button type="button" class="photo-rm" data-rm="${i}" title="Remove" aria-label="Remove photo ${i + 1}">${AD.icons.x}</button>
        </div>`).join('');
      addBtn.disabled = photos.length >= max;
      addBtn.classList.toggle('is-full', photos.length >= max);
      grid.querySelectorAll('[data-view]').forEach((im) => im.onclick = () => photoLightbox(photos, Number(im.dataset.view)));
      grid.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { photos.splice(Number(b.dataset.rm), 1); render(); onChange && onChange(photos.slice()); });
    }
    addBtn.onclick = () => input.click();
    input.onchange = async () => {
      for (const f of Array.from(input.files || [])) {
        if (photos.length >= max) { toast(`At most ${max} photos.`); break; }
        try { photos.push(await compressImage(f)); } catch (e) { /* already toasted */ }
      }
      input.value = '';
      render();
      onChange && onChange(photos.slice());
    };
    render();
    return { get: () => photos.slice(), set: (next) => { photos.length = 0; photos.push(...(next || [])); render(); } };
  }

  /** Simple lightbox: shows a photo array with prev/next arrows + close. */
  function photoLightbox(photos, startIndex = 0) {
    if (!photos || !photos.length) return;
    let i = Math.max(0, Math.min(startIndex, photos.length - 1));
    const root = $('#modal-root');
    root.innerHTML = `
      <div class="modal-backdrop" data-lb-close></div>
      <div class="lightbox" role="dialog" aria-modal="true" aria-label="Photo viewer">
        <button class="lb-btn lb-close" data-lb-close aria-label="Close">${AD.icons.x}</button>
        ${photos.length > 1 ? `<button class="lb-btn lb-prev" data-lb-prev aria-label="Previous photo">${AD.icons.chevL}</button>` : ''}
        <img class="lb-img" alt="">
        ${photos.length > 1 ? `<button class="lb-btn lb-next" data-lb-next aria-label="Next photo">${AD.icons.chevR}</button>` : ''}
        <span class="lb-count"></span>
      </div>`;
    root.classList.add('open');
    document.body.classList.add('modal-open');
    const img = $('.lb-img', root);
    const count = $('.lb-count', root);
    const draw = () => { img.src = photos[i]; count.textContent = photos.length > 1 ? `${i + 1} of ${photos.length}` : ''; };
    const close = () => { root.classList.remove('open'); root.innerHTML = ''; document.body.classList.remove('modal-open'); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight' && photos.length > 1) { i = (i + 1) % photos.length; draw(); } else if (e.key === 'ArrowLeft' && photos.length > 1) { i = (i - 1 + photos.length) % photos.length; draw(); } };
    $$('[data-lb-close]', root).forEach((b) => b.addEventListener('click', close));
    const nextBtn = $('[data-lb-next]', root); if (nextBtn) nextBtn.onclick = () => { i = (i + 1) % photos.length; draw(); };
    const prevBtn = $('[data-lb-prev]', root); if (prevBtn) prevBtn.onclick = () => { i = (i - 1 + photos.length) % photos.length; draw(); };
    document.addEventListener('keydown', onKey);
    draw();
  }

  function relTime(iso) {
    const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins} min ago`;
    const h = Math.round(mins / 60);
    if (h < 24) return `${h} hr${h === 1 ? '' : 's'} ago`;
    return AD.time.fmtDate(iso);
  }

  return {
    esc, $, $$, badge, vehicleBadge, priorityBadge, defectBadge, stateBadge, bookingBadge, scheduleBadge, BOOKING_LABEL,
    pageHeader, sectionHead, dash, attentionFlags, labelFields, modal, closeModal, confirm, toast, formData, showErrors, options, relTime,
    compressImage, photoPicker, photoLightbox
  };
})();
