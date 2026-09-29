/*
 * Small chart toolkit (plain HTML/CSS — no chart library).
 *
 * Colours are validated palettes (see css/styles.css, "Chart colours"):
 *   booking types  confirmed / tentative / depot / maintenance
 *   vehicle status in use / available / in workshop / out of service
 *   severity       critical / serious / warning / good (always with a label)
 *
 * Every chart gets: a legend or direct labels, a hover/focus tooltip, and a
 * "View as table" twin so no value depends on colour or hovering.
 */
window.AD = window.AD || {};

AD.viz = (function () {
  const { esc } = AD.ui;

  // Booking type → colour token + label, in fixed stacking order.
  const BOOKING = [
    { key: 'confirmed', label: 'Confirmed job', color: 'var(--viz-confirmed)' },
    { key: 'tentative', label: 'Tentative', color: 'var(--viz-tentative)' },
    { key: 'depot', label: 'Depot', color: 'var(--viz-depot)' },
    { key: 'maintenance', label: 'Maintenance', color: 'var(--viz-maint)' }
  ];
  const VEHICLE = [
    { key: 'In use', label: 'In use', color: 'var(--viz-inuse)' },
    { key: 'Available', label: 'Available', color: 'var(--viz-available)' },
    { key: 'In workshop', label: 'In workshop', color: 'var(--viz-workshop)' },
    { key: 'Out of service', label: 'Out of service', color: 'var(--viz-out)' }
  ];

  /** Horizontal stacked bar (part of a whole) with 2px gaps between segments. */
  function stack(parts, total, { height = 8, label = '' } = {}) {
    const sum = parts.reduce((n, p) => n + p.value, 0);
    const base = Math.max(total || sum, 1);
    const segs = parts.filter((p) => p.value > 0).map((p) =>
      `<i style="flex:${p.value};background:${p.color}" data-tip="${esc(JSON.stringify({ t: label, rows: [[p.label, String(p.value), p.color]] }))}"></i>`).join('');
    const rest = base - sum > 0 ? `<i class="rest" style="flex:${base - sum}"></i>` : '';
    return `<span class="viz-stack" style="height:${height}px" role="img" aria-label="${esc(label + ': ' + parts.map((p) => `${p.value} ${p.label}`).join(', '))}">${segs}${rest}</span>`;
  }

  /** Inline legend: coloured key + text in ink (never coloured text). */
  function legend(parts, { counts = true } = {}) {
    return `<span class="viz-legend">${parts.map((p) =>
      `<span><i style="background:${p.color}"></i>${counts ? `<b>${p.value}</b> ` : ''}${esc(p.label)}</span>`).join('')}</span>`;
  }

  /** "View as table" twin for a chart. */
  function table(head, rows) {
    return `<details class="viz-table"><summary>View as table</summary>
      <table class="data"><thead><tr>${head.map((h, i) => `<th class="${i ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i ? 'num' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></details>`;
  }

  // ---------- one shared tooltip (values lead, labels follow; textContent only) ----------
  let tipEl = null;
  function tip() {
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.className = 'viz-tip';
      tipEl.setAttribute('role', 'tooltip');
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }
  function showTip(target, x, y) {
    let data;
    try { data = JSON.parse(target.dataset.tip); } catch (e) { return; }
    const el = tip();
    el.textContent = '';
    if (data.t) { const h = document.createElement('div'); h.className = 'vt-title'; h.textContent = data.t; el.appendChild(h); }
    (data.rows || []).forEach(([label, value, color]) => {
      const row = document.createElement('div'); row.className = 'vt-row';
      const key = document.createElement('i'); key.style.background = color || 'transparent';
      const v = document.createElement('b'); v.textContent = value;
      const l = document.createElement('span'); l.textContent = label;
      row.append(key, v, l); el.appendChild(row);
    });
    el.classList.add('show');
    const r = el.getBoundingClientRect();
    let left = x + 14, top = y - r.height - 12;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (top < 8) top = y + 16;
    el.style.left = Math.max(8, left) + 'px';
    el.style.top = top + 'px';
  }
  function hideTip() { if (tipEl) tipEl.classList.remove('show'); }

  // Delegated once: any element with data-tip gets hover and keyboard-focus tooltips.
  document.addEventListener('pointermove', (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (t) showTip(t, e.clientX, e.clientY); else hideTip();
  });
  document.addEventListener('focusin', (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) return;
    const r = t.getBoundingClientRect();
    showTip(t, r.left + r.width / 2, r.top);
  });
  document.addEventListener('focusout', hideTip);
  document.addEventListener('scroll', hideTip, true);

  const tipAttr = (title, rows) => `data-tip="${esc(JSON.stringify({ t: title, rows }))}"`;

  return { BOOKING, VEHICLE, stack, legend, table, tipAttr, hideTip };
})();
