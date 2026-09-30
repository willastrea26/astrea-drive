/* Workshops & repairers: directory + map of external service locations */
AD.views = AD.views || {};

AD.views.workshops = (function () {
  const { esc, pageHeader, badge, dash } = AD.ui;
  let root = null, map = null, cat = '';
  let markers = [];

  const CAT_LABEL = { ute: 'Utes, cars & vans', heavy: 'Vac trucks & tippers', excavator: 'Excavators', all: 'All vehicle types' };
  const CAT_BADGE = { ute: 'blue', heavy: 'amber', excavator: 'violet', all: 'green' };
  const CAT_COLOR = { ute: '#3b7dc9', heavy: '#d9781f', excavator: '#8a6fd8', all: '#2f9e6e' };

  function render(el) {
    root = el;
    cat = '';
    draw();
  }

  function onSite(id) {
    return AD.store.all('vehicles').filter((v) => v.status === 'In workshop' && v.workshopId === id);
  }

  function shops() {
    const all = AD.store.all('workshops').slice().sort((a, b) => a.name.localeCompare(b.name));
    return cat ? all.filter((w) => w.category === cat || w.category === 'all') : all;
  }

  function draw() {
    const total = AD.store.all('workshops').length;
    const parked = AD.store.all('vehicles').filter((v) => v.status === 'In workshop' && v.workshopId);

    root.innerHTML = `
      ${pageHeader({
        title: 'Workshops & repairers',
        sub: `${total} location${total === 1 ? '' : 's'}${parked.length ? ' · ' + parked.length + ' vehicle' + (parked.length === 1 ? '' : 's') + ' at a workshop now' : ''}`
      })}
      <div class="toolbar">
        <select id="wk-cat" aria-label="Vehicle category">
          <option value="">All categories</option>
          <option value="ute">Utes, cars &amp; vans</option>
          <option value="heavy">Vac trucks &amp; tippers</option>
          <option value="excavator">Excavators</option>
        </select>
        <span class="count" id="wk-count"></span>
      </div>
      <section class="section"><div class="wk-map" id="wk-map" aria-label="Map of workshop locations"></div></section>
      <section class="section">
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Workshop</th><th class="col-opt">Category</th><th class="col-opt col-wide">Address</th><th>Vehicles here now</th></tr></thead>
          <tbody id="wk-body"></tbody>
        </table></div>
      </section>`;

    root.querySelector('#wk-cat').value = cat;
    root.querySelector('#wk-cat').onchange = (e) => { cat = e.target.value; update(); };

    initMap();
    update();
  }

  function initMap() {
    const container = root.querySelector('#wk-map');
    map = AD.maps.create(container, container, { scrollWheelZoom: true });
    if (map) setTimeout(() => map && map.invalidateSize(), 60);
  }

  function pinIcon(color, count) {
    return window.L.divIcon({
      className: 'wk-pin',
      html: `<div class="wk-pin-inner">
        <svg viewBox="0 0 24 24" width="30" height="30"><path d="M12 22s-7-6.4-7-12a7 7 0 0 1 14 0c0 5.6-7 12-7 12z" fill="${color}" stroke="#fff" stroke-width="1.5"/><circle cx="12" cy="10" r="3" fill="#fff"/></svg>
        ${count ? `<span class="wk-pin-badge">${count}</span>` : ''}
      </div>`,
      iconSize: [30, 30], iconAnchor: [15, 29]
    });
  }

  function popupHtml(w) {
    const here = onSite(w.id);
    return `<div class="wk-pop">
      <b>${esc(w.name)}</b><br>
      <span class="muted">${esc(w.address)}</span><br>
      ${badge(CAT_LABEL[w.category] || w.category, CAT_BADGE[w.category] || 'grey muted')}
      ${here.length
        ? `<div style="margin-top:8px"><b>${here.length} vehicle${here.length > 1 ? 's' : ''} here now:</b><br>${here.map((v) => esc(v.id)).join(', ')}</div>`
        : '<div class="muted" style="margin-top:8px">No vehicles here right now.</div>'}
    </div>`;
  }

  function update() {
    const list = shops();
    root.querySelector('#wk-count').textContent = `${list.length} location${list.length === 1 ? '' : 's'}`;

    if (map) {
      markers.forEach((m) => map.removeLayer(m));
      markers = [];
      const pts = [];
      list.forEach((w) => {
        if (w.lat == null || w.lng == null) return;
        const here = onSite(w.id);
        const m = window.L.marker([w.lat, w.lng], { icon: pinIcon(CAT_COLOR[w.category] || '#6b7280', here.length) });
        m.bindPopup(popupHtml(w));
        m._wid = w.id;
        m.addTo(map);
        markers.push(m);
        pts.push([w.lat, w.lng]);
      });
      if (pts.length === 1) map.setView(pts[0], 12, { animate: false });
      else if (pts.length) map.fitBounds(pts, { padding: [60, 60], maxZoom: 12, animate: false });
      else map.fitBounds(AD.maps.AU_BOUNDS, { animate: false });
    }

    root.querySelector('#wk-body').innerHTML = list.map((w) => {
      const here = onSite(w.id);
      return `<tr${w.lat != null ? ` class="link" data-open="${w.id}"` : ''}>
        <td><span class="id">${esc(w.name)}</span></td>
        <td class="col-opt">${badge(CAT_LABEL[w.category] || w.category, CAT_BADGE[w.category] || 'grey muted')}</td>
        <td class="col-opt col-wide">${w.address ? esc(w.address) : dash}</td>
        <td>${here.length ? `<span class="flag flag-amber">${here.length} · ${here.map((v) => esc(v.id)).join(', ')}</span>` : dash}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="4" class="empty">No workshops in this category.</td></tr>';

    root.querySelectorAll('[data-open]').forEach((tr) => {
      tr.onclick = () => {
        const w = AD.store.get('workshops', tr.dataset.open);
        if (!w || w.lat == null || !map) return;
        map.setView([w.lat, w.lng], 14, { animate: false });
        const m = markers.find((mk) => mk._wid === w.id);
        if (m) m.openPopup();
      };
    });
  }

  function destroy() {
    if (map) { map.remove(); map = null; }
    markers = [];
    root = null;
  }

  return { title: 'Workshops', render, refresh: () => root && update(), destroy };
})();
