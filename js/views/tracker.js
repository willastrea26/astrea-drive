/*
 * Tracker: scheduled vac truck positions on a map of Australia.
 *
 * Positions come ONLY from Calendar bookings at the selected instant. Trucks
 * jump between booked sites as time changes — never GPS, never interpolated
 * travel, never an assumed return to depot.
 */
AD.views = AD.views || {};

AD.views.tracker = (function () {
  const { esc, options, bookingBadge, scheduleBadge, vehicleBadge } = AD.ui;
  const L = AD.logic, T = AD.time, I = AD.icons;
  const PREF_KEY = 'astrea-drive-tracker';
  const STATUS_WORD = { confirmed: 'Confirmed', tentative: 'Tentative', maintenance: 'Maintenance', depot: 'Depot' };
  const reducedMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  let root = null, map = null, group = null, wsGroup = null, centerDot = null, playTimer = null;
  const markers = new Map();
  const wsMarkers = new Map();
  let st = {};
  let prefs = loadPrefs();

  function loadPrefs() {
    try { return Object.assign({ panel: 'open', style: 'dark' }, JSON.parse(localStorage.getItem(PREF_KEY) || '{}')); }
    catch (e) { return { panel: 'open', style: 'dark' }; }
  }
  function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { /* preference only */ } }

  // ------------------------------------------------------------------ render
  function render(el, params) {
    root = el;
    el.classList.add('view-flush');
    let t = Date.now();
    if (/^\d{4}-\d{2}-\d{2}$/.test(params.date || '')) {
      const { y, m, d } = T.parseKey(params.date);
      const now = T.parts(Date.now());
      const [hh, mm] = /^\d{2}:\d{2}$/.test(params.time || '') ? params.time.split(':').map(Number) : [now.hour, now.minute];
      t = T.fromParts(y, m, d, hh, mm);
    }
    st = { t, truck: '', status: params.status || '', avail: params.avail || '', sel: params.truck || '', playing: false };

    const tool = (act, icon, label, extra = '') => `<button type="button" data-act="${act}" title="${label}" aria-label="${label}" ${extra}>${icon}</button>`;

    el.innerHTML = `
      <div class="trk">
        <header class="trk-head">
          <h1>Tracker</h1>
          <div class="trk-readout" aria-live="polite"><span class="mode" id="t-mode"></span><b id="t-when"></b><span class="muted" id="t-tz"></span></div>
          <a class="btn btn-secondary" id="to-cal" href="#/calendar">${I.calendar} Open Calendar</a>
        </header>

        <div class="trk-stage ${prefs.panel === 'closed' ? 'panel-closed' : ''}" id="t-stage">
          <div class="trk-map-wrap" id="map-wrap">
            <div class="trk-map" id="t-map" aria-label="Map of scheduled truck positions"></div>
            <div class="trk-tools" role="toolbar" aria-label="Map controls">
              ${tool('zin', I.plus, 'Zoom in')}
              ${tool('zout', '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg>', 'Zoom out')}
              <span class="sep"></span>
              ${tool('fit', I.fit, 'Fit fleet')}
              ${tool('au', '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3.5 11.5 7 7l4 1 2-3 3.5 2 1 3.5 2.5 2.5-1 4-3.5 2.5-3-1.5-2 1-3-2.5-1-3z"/></svg>', 'Show all of Australia')}
              <span class="sep"></span>
              ${tool('style', prefs.style === 'dark' ? SUN : MOON, prefs.style === 'dark' ? 'Use light map' : 'Use dark map', `aria-pressed="${prefs.style === 'dark'}"`)}
            </div>
            <div class="trk-gps"><i aria-hidden="true"></i>Scheduled positions · Not live GPS</div>
          </div>

          <aside class="trk-panel" aria-label="Fleet">
            <div class="fp-head">
              <h2>Fleet</h2><span class="fp-count" id="t-count"></span>
              <button type="button" class="fp-toggle" id="t-collapse" aria-controls="t-panel-body" aria-expanded="${prefs.panel !== 'closed'}" title="Hide fleet panel" aria-label="Hide fleet panel">${I.chevR}</button>
            </div>
            <div class="fp-body" id="t-panel-body">
              <div class="fp-filters">
                <select id="f-truck" aria-label="Truck">${options(L.vacTrucks().map((v) => v.id), st.truck, 'All trucks')}</select>
                <select id="f-status" aria-label="Booking status">${options([['confirmed', 'Confirmed'], ['tentative', 'Tentative'], ['maintenance', 'Maintenance'], ['depot', 'Depot'], ['unscheduled', 'Unscheduled'], ['conflict', 'Clash'], ['needs-location', 'Site location required']], st.status, 'Any status')}</select>
                <select id="f-avail" aria-label="Availability">${options([['free', 'Free (no booking)'], ['booked', 'Booked on a job'], ['unavailable', 'Unavailable']], st.avail, 'Availability')}</select>
              </div>
              <div class="fp-list" id="t-list" role="list"></div>
            </div>
            <button type="button" class="fp-rail" id="t-expand" aria-label="Show fleet panel">${I.chevL}<span>Fleet</span></button>
          </aside>
        </div>

        <div class="trk-timeline" aria-label="Forecast timeline">
          <div class="tl-day">
            <div class="seg" role="group" aria-label="Day">
              <button type="button" id="t-prev" aria-label="Previous day">${I.chevL}</button>
              <button type="button" id="t-today">Today</button>
              <button type="button" id="t-next" aria-label="Next day">${I.chevR}</button>
            </div>
            <input type="date" id="t-date" aria-label="Date">
          </div>
          <button type="button" class="tl-play" id="t-play" aria-pressed="false" aria-label="Play the day’s schedule">${PLAY}</button>
          <div class="tl-scrub">
            <div class="tl-track" id="t-track">
              <div class="tl-segs" id="t-segs" aria-hidden="true"></div>
              <div class="tl-nowtick" id="t-nowtick" aria-hidden="true"><span>Now</span></div>
              <input type="range" id="t-slider" min="0" step="5" aria-label="Time of day">
              <div class="tl-bubble" id="t-bubble" aria-hidden="true"></div>
            </div>
            <div class="tl-hours" id="t-hours" aria-hidden="true"></div>
          </div>
          <input type="time" id="t-time" step="300" aria-label="Time (Australia/Sydney)">
        </div>
      </div>`;

    const $ = (s) => el.querySelector(s);
    const manual = (fn) => (e) => { stopPlay(); fn(e); };
    $('#t-date').onchange = manual((e) => { if (!e.target.value) return; const p = T.parts(st.t); const { y, m, d } = T.parseKey(e.target.value); setT(T.fromParts(y, m, d, p.hour, p.minute)); });
    $('#t-time').onchange = manual((e) => { const mt = /^(\d{2}):(\d{2})/.exec(e.target.value); if (!mt) return; const { y, m, d } = T.parseKey(T.dateKey(st.t)); setT(T.fromParts(y, m, d, +mt[1], +mt[2])); });
    $('#t-slider').oninput = manual((e) => setT(T.startOfDay(T.dateKey(st.t)) + Number(e.target.value) * 60000));
    $('#t-today').onclick = manual(() => setT(Date.now()));
    $('#t-prev').onclick = manual(() => shiftDay(-1));
    $('#t-next').onclick = manual(() => shiftDay(1));
    $('#t-play').onclick = () => (st.playing ? stopPlay() : startPlay());
    $('#f-truck').onchange = (e) => { st.truck = e.target.value; if (st.truck) st.sel = st.truck; update(); fitFleet(); };
    $('#f-status').onchange = (e) => { st.status = e.target.value; update(); };
    $('#f-avail').onchange = (e) => { st.avail = e.target.value; update(); };
    $('#t-collapse').onclick = () => setPanel('closed');
    $('#t-expand').onclick = () => setPanel('open');
    el.querySelectorAll('.trk-tools [data-act]').forEach((b) => (b.onclick = () => toolAction(b.dataset.act, b)));

    initMap();
    update();
    setTimeout(() => {
      if (!map) return;
      map.invalidateSize();
      if (st.sel) revealMarker(st.sel, true); else fitFleet();
    }, 60);
  }

  const PLAY = '<svg class="ico" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
  const PAUSE = '<svg class="ico" viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5.5" width="4" height="13" rx="1"/><rect x="13.5" y="5.5" width="4" height="13" rx="1"/></svg>';
  const MOON = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z"/></svg>';
  const SUN = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>';

  // ---------------------------------------------------------------- map
  function initMap() {
    const wrap = root.querySelector('#map-wrap');
    map = AD.maps.create(root.querySelector('#t-map'), wrap, {
      style: prefs.style, zoomControl: false, zoomSnap: 0.5,
      zoomAnimation: !reducedMotion(), fadeAnimation: !reducedMotion(), markerZoomAnimation: !reducedMotion()
    });
    wrap.classList.toggle('is-dark', prefs.style === 'dark');
    if (!map) return;
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');

    if (window.L.markerClusterGroup) {
      group = window.L.markerClusterGroup({
        maxClusterRadius: 92, // markers are ~88px wide; closer than this they would overlap
        showCoverageOnHover: false,
        zoomToBoundsOnClick: false,
        spiderfyOnMaxZoom: false,
        spiderfyDistanceMultiplier: 5.2,
        animate: !reducedMotion(),
        spiderLegPolylineOptions: { weight: 1.5, color: '#101D35', opacity: 0.55, dashArray: '3 4' },
        iconCreateFunction: clusterIcon
      });
      // Same site (or already close in): fan the trucks out; otherwise zoom in.
      group.on('clusterclick', (e) => {
        const kids = e.layer.getAllChildMarkers();
        const same = kids.every((m) => m.getLatLng().equals(kids[0].getLatLng()));
        if (same || map.getZoom() >= 14) e.layer.spiderfy();
        else e.layer.zoomToBounds({ padding: [80, 80], maxZoom: 14 });
      });
      group.on('clustermouseover', (e) => {
        const ids = e.layer.getAllChildMarkers().map((m) => m._tid).sort();
        e.layer.bindTooltip(`<b>${ids.length} trucks</b><br>${ids.join(', ')}<br><span class="muted">Click to ${ids.length && sameSpot(e.layer) ? 'separate' : 'zoom in'}</span>`, { direction: 'top', offset: [0, -26], className: 'tm-tip' }).openTooltip();
      });
      // Keep the true site visible while trucks are fanned out.
      group.on('spiderfied', (e) => {
        if (centerDot) map.removeLayer(centerDot);
        centerDot = window.L.circleMarker(e.cluster.getLatLng(), { radius: 5, color: '#101D35', weight: 2, fillColor: '#79E2C3', fillOpacity: 1, interactive: false }).addTo(map);
        e.markers.forEach((m) => m.getElement() && m.getElement().classList.add('spread'));
      });
      group.on('unspiderfied', (e) => {
        if (centerDot) { map.removeLayer(centerDot); centerDot = null; }
        e.markers.forEach((m) => m.getElement() && m.getElement().classList.remove('spread'));
      });
    } else {
      group = window.L.layerGroup(); // clustering plugin unavailable: plain markers
    }
    group.addTo(map);

    // Static, always-on layer of repairer/workshop locations relevant to vac trucks.
    wsGroup = window.L.layerGroup().addTo(map);
    L.workshopsFor('Vac truck').filter((w) => w.lat != null).forEach((w) => {
      const m = window.L.marker([w.lat, w.lng], { icon: wsIcon(0), keyboard: false, zIndexOffset: -1000 });
      m._wid = w.id;
      m._w = w;
      wsGroup.addLayer(m);
      wsMarkers.set(w.id, m);
    });
  }

  function wsIcon(count) {
    return window.L.divIcon({
      className: 'wk-pin wk-pin-sm',
      html: `<div class="wk-pin-inner">
        <svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 22s-7-6.4-7-12a7 7 0 0 1 14 0c0 5.6-7 12-7 12z" fill="#6b7280" stroke="#fff" stroke-width="1.5"/><circle cx="12" cy="10" r="3" fill="#fff"/></svg>
        ${count ? `<span class="wk-pin-badge">${count}</span>` : ''}
      </div>`,
      iconSize: [22, 22], iconAnchor: [11, 21]
    });
  }

  /** Refresh workshop pin badges/tooltips with whichever trucks are currently located there. */
  function syncWorkshops(shown) {
    for (const [id, m] of wsMarkers) {
      const w = m._w;
      const here = shown.filter((l) => l.state === 'located' && l.lat === w.lat && l.lng === w.lng);
      m.setIcon(wsIcon(here.length));
      m.bindTooltip(`<b>${esc(w.name)}</b><br>${esc(w.address)}${here.length ? `<br><b>${here.length} truck${here.length > 1 ? 's' : ''} here now:</b> ${here.map((l) => esc(l.truckId)).join(', ')}` : ''}`, { direction: 'top', offset: [0, -18], className: 'tm-tip' });
    }
  }

  const sameSpot = (cluster) => { const k = cluster.getAllChildMarkers(); return k.every((m) => m.getLatLng().equals(k[0].getLatLng())); };

  function clusterIcon(cluster) {
    const kids = cluster.getAllChildMarkers();
    const hasSel = kids.some((m) => m._tid === st.sel);
    return window.L.divIcon({
      className: 'tcluster',
      html: `<div class="tc${hasSel ? ' sel' : ''}" aria-label="${kids.length} trucks"><span class="tc-n">${kids.length}</span><span class="tc-l">trucks</span></div>`,
      iconSize: [56, 56], iconAnchor: [28, 28]
    });
  }

  function markerIcon(l, sel) {
    const num = AD.art.num(l.truckId);
    return window.L.divIcon({
      className: 'tm-wrap',
      html: `<div class="tm tm-${l.cat}${sel ? ' sel' : ''}">
        <span class="tm-halo"></span>
        <span class="tm-status"><i></i>${STATUS_WORD[l.cat] || ''}</span>
        ${AD.art.vac(num, 88)}
        <span class="tm-stem"></span><span class="tm-anchor"></span>
      </div>`,
      iconSize: [88, 64], iconAnchor: [44, 60]
    });
  }

  function wireMarker(m, l) {
    const el = m.getElement();
    if (!el) return;
    el.setAttribute('aria-label', `${l.truckId}, ${STATUS_WORD[l.cat] || ''}: ${L.bookingTitle(l.booking)}, ${l.booking.address || 'pinned site'}`);
    el.onfocus = () => m.openTooltip();
    el.onblur = () => m.closeTooltip();
  }

  function syncMarkers(shown) {
    if (!map) return;
    if (group.unspiderfy) group.unspiderfy();
    const want = new Map(shown.filter((l) => l.state === 'located').map((l) => [l.truckId, l]));
    for (const [id, m] of markers) if (!want.has(id)) { group.removeLayer(m); markers.delete(id); }
    for (const [id, l] of want) {
      const sel = id === st.sel;
      const key = `${l.cat}|${sel}`;
      const ll = window.L.latLng(l.lat, l.lng);
      const tip = `<b>${id}</b> · ${esc(STATUS_WORD[l.cat])}<br>${esc(L.bookingTitle(l.booking))}<br><span class="muted">${esc(siteName(l.booking))}</span>`;
      let m = markers.get(id);
      if (!m) {
        m = window.L.marker(ll, { icon: markerIcon(l, sel), keyboard: true, riseOnHover: true, zIndexOffset: sel ? 1000 : 0 });
        m._tid = id; m._key = key; m._loc = l;
        m.bindTooltip(tip, { direction: 'top', offset: [0, -60], className: 'tm-tip' });
        m.on('click', () => select(id, 'map'));
        m.on('add', () => wireMarker(m, m._loc));
        markers.set(id, m);
        group.addLayer(m);
      } else {
        m._loc = l;
        if (!m.getLatLng().equals(ll)) { group.removeLayer(m); m.setLatLng(ll); group.addLayer(m); }
        if (m._key !== key) { m.setIcon(markerIcon(l, sel)); m._key = key; m.setZIndexOffset(sel ? 1000 : 0); }
        m.setTooltipContent(tip);
        wireMarker(m, l);
      }
    }
    if (group.refreshClusters) group.refreshClusters();
  }

  /**
   * Make a truck visible without jumping to street level: pan to it if needed,
   * fan out a cluster of trucks at the same site, otherwise zoom in two levels
   * at a time (up to 14) until it separates.
   */
  function revealMarker(id, initial, attempt = 0) {
    const m = markers.get(id);
    if (!m || !map) return;
    const ll = m.getLatLng();
    const again = () => map.once('moveend', () => setTimeout(() => revealMarker(id, false, attempt + 1), 30));
    if (initial) { map.setView(ll, Math.max(map.getZoom(), 10), { animate: false }); setTimeout(() => revealMarker(id, false, 1), 30); return; }
    if (!map.getBounds().pad(-0.1).contains(ll) && attempt < 6) { again(); map.panTo(ll, { animate: !reducedMotion() }); return; }
    const parent = group.getVisibleParent ? group.getVisibleParent(m) : m;
    if (!parent || parent === m) return;
    const kids = parent.getAllChildMarkers();
    if (kids.every((k) => k.getLatLng().equals(ll)) || map.getZoom() >= 14 || attempt >= 6) { parent.spiderfy(); return; }
    again();
    map.setView(ll, Math.min(map.getZoom() + 2, 14), { animate: !reducedMotion() });
  }

  function fitFleet() {
    if (!map) return;
    const pts = locations().filter(passes).filter((l) => l.state === 'located').map((l) => [l.lat, l.lng]);
    if (!pts.length) map.fitBounds(AD.maps.AU_BOUNDS, { animate: false });
    else if (pts.length === 1) map.setView(pts[0], 11, { animate: false });
    else map.fitBounds(pts, { padding: [90, 90], maxZoom: 12, animate: false });
  }

  function toolAction(act, btn) {
    if (!map) return;
    if (act === 'zin') map.zoomIn();
    else if (act === 'zout') map.zoomOut();
    else if (act === 'fit') fitFleet();
    else if (act === 'au') map.fitBounds(AD.maps.AU_BOUNDS, { animate: !reducedMotion() });
    else if (act === 'style') {
      prefs.style = prefs.style === 'dark' ? 'light' : 'dark';
      savePrefs();
      AD.maps.setStyle(map, prefs.style);
      root.querySelector('#map-wrap').classList.toggle('is-dark', prefs.style === 'dark');
      btn.innerHTML = prefs.style === 'dark' ? SUN : MOON;
      const label = prefs.style === 'dark' ? 'Use light map' : 'Use dark map';
      btn.title = label; btn.setAttribute('aria-label', label); btn.setAttribute('aria-pressed', String(prefs.style === 'dark'));
    }
  }

  function setPanel(state) {
    prefs.panel = state; savePrefs();
    root.querySelector('#t-stage').classList.toggle('panel-closed', state === 'closed');
    root.querySelector('#t-collapse').setAttribute('aria-expanded', String(state !== 'closed'));
    setTimeout(() => { if (map) map.invalidateSize(); (state === 'closed' ? root.querySelector('#t-expand') : root.querySelector('#t-collapse')).focus(); }, 220);
  }

  // ---------------------------------------------------------------- time
  function setT(t) { st.t = t; update(); }

  function shiftDay(n) {
    const p = T.parts(st.t);
    const { y, m, d } = T.parseKey(T.addDays(T.dateKey(st.t), n));
    setT(T.fromParts(y, m, d, p.hour, p.minute)); // same wall-clock time, DST-safe
  }

  // Playback steps through the day's booked positions; trucks jump between sites.
  function startPlay() {
    const key = T.dateKey(st.t);
    const ds = T.startOfDay(key), de = T.startOfDay(T.addDays(key, 1));
    if (st.t >= de - 20 * 60000) st.t = ds;
    const slow = reducedMotion();
    const stepMs = (slow ? 30 : 15) * 60000;
    st.playing = true;
    playTimer = setInterval(() => {
      const next = st.t + stepMs;
      if (next >= de) { setT(de - 5 * 60000); stopPlay(); return; }
      setT(next);
    }, slow ? 1000 : 350);
    playButton();
  }
  function stopPlay() {
    if (playTimer) clearInterval(playTimer);
    playTimer = null;
    if (st.playing) { st.playing = false; playButton(); }
  }
  function playButton() {
    const b = root && root.querySelector('#t-play');
    if (!b) return;
    b.innerHTML = st.playing ? PAUSE : PLAY;
    b.setAttribute('aria-pressed', String(st.playing));
    b.setAttribute('aria-label', st.playing ? 'Pause playback' : 'Play the day’s schedule');
    b.classList.toggle('on', st.playing);
  }

  // ---------------------------------------------------------------- state
  function locations() {
    return L.vacTrucks().map((v) => {
      const loc = L.locate(v.id, st.t);
      loc.cat = loc.state === 'conflict' ? 'conflict' : loc.state === 'unscheduled' ? 'unscheduled' : L.bookingCategory(loc.booking);
      const vehicleDown = v.status === 'Out of service' || v.status === 'In workshop';
      loc.avail = loc.cat === 'maintenance' || (vehicleDown && loc.cat === 'unscheduled') ? 'unavailable' : loc.cat === 'unscheduled' ? 'free' : 'booked';
      return loc;
    });
  }

  function passes(loc) {
    if (st.truck && loc.truckId !== st.truck) return false;
    if (st.status === 'needs-location' ? loc.state !== 'needs-location' : st.status && loc.cat !== st.status) return false;
    if (st.avail && loc.avail !== st.avail) return false;
    return true;
  }

  function update() {
    if (!root) return;
    const $ = (s) => root.querySelector(s);
    const key = T.dateKey(st.t);
    const ds = T.startOfDay(key), de = T.startOfDay(T.addDays(key, 1));
    const now = Date.now();

    // Header + mode
    const mode = Math.abs(st.t - now) < 60000 ? 'now' : st.t > now ? 'forecast' : 'past';
    const modeEl = $('#t-mode');
    modeEl.className = `mode mode-${mode}`;
    modeEl.textContent = mode === 'now' ? 'Now' : mode === 'forecast' ? 'Forecast' : 'Past schedule';
    $('#t-when').textContent = `${T.fmtKeyLong(key)} · ${T.fmtTime(st.t)}`;
    $('#t-tz').textContent = `${T.abbr(st.t)} · Australia/Sydney${(de - ds) !== 86400000 ? ' · daylight saving changes today' : ''}`;
    $('#to-cal').href = `#/calendar?view=day&date=${key}`;
    AD.setParams({ date: key, time: T.fmtTime(st.t), truck: st.sel, status: st.status, avail: st.avail });

    const locs = locations();
    const shown = locs.filter(passes);
    $('#t-count').textContent = `${shown.length} of ${locs.length} · ${shown.filter((l) => l.state === 'located').length} on map`;
    drawTimeline(key, ds, de, now);
    drawList(shown);
    syncMarkers(shown);
    syncWorkshops(locs);
  }

  // ---------------------------------------------------------------- timeline
  function drawTimeline(key, ds, de, now) {
    const $ = (s) => root.querySelector(s);
    const span = de - ds;
    const pct = (ms) => ((Math.min(Math.max(ms, ds), de) - ds) / span) * 100;
    $('#t-date').value = key;
    $('#t-time').value = T.fmtTime(st.t);
    $('#t-today').classList.toggle('on', key === T.todayKey());
    const sl = $('#t-slider');
    sl.max = Math.round(span / 60000) - 5;
    sl.value = Math.round((st.t - ds) / 60000);
    sl.setAttribute('aria-valuetext', `${T.fmtTime(st.t)} ${T.abbr(st.t)}`);
    const p = pct(st.t);
    $('#t-track').style.setProperty('--pct', p + '%');
    const bubble = $('#t-bubble');
    bubble.textContent = T.fmtTime(st.t);
    bubble.style.left = p + '%';

    const { y, m, d } = T.parseKey(key);
    const hours = [];
    for (let h = 0; h <= 24; h++) {
      const at = h === 24 ? de : T.fromParts(y, m, d, h, 0);
      hours.push(`<span class="${h % 3 === 0 ? 'lbl' : ''}" style="left:${pct(at)}%">${h % 3 === 0 ? `${T.pad(h)}:00` : ''}</span>`);
    }
    $('#t-hours').innerHTML = hours.join('');

    const tick = $('#t-nowtick');
    tick.hidden = !(now >= ds && now < de);
    tick.style.left = pct(now) + '%';

    // Selected truck's bookings for the day, so you can scrub straight to a job.
    const segs = st.sel ? L.bookingsFor(st.sel).filter((b) => b.status !== 'cancelled' && Date.parse(b.start) < de && Date.parse(b.end) > ds) : [];
    const clashes = L.conflictIds();
    $('#t-segs').innerHTML = segs.map((b) => {
      const left = pct(Date.parse(b.start)), right = pct(Date.parse(b.end));
      return `<i class="seg-${L.bookingCategory(b)}${clashes.has(b.id) ? ' seg-clash' : ''}" style="left:${left}%;width:${Math.max(right - left, 0.5)}%" title="${esc(L.bookingTitle(b))}"></i>`;
    }).join('');
  }

  // ---------------------------------------------------------------- fleet list
  const siteName = (b) => {
    if (!b) return '';
    const s = b.siteId ? AD.store.get('sites', b.siteId) : null;
    if (s) return s.name;
    const w = b.siteId ? AD.store.get('workshops', b.siteId) : null;
    if (w) return w.name;
    return b.address || (L.hasCoords(b) ? 'Pinned location' : '');
  };

  function timeRange(b) {
    const s = Date.parse(b.start), e = Date.parse(b.end);
    const key = T.dateKey(st.t);
    const f = (ms) => (T.dateKey(ms) === key ? T.fmtTime(ms) : `${T.fmtDate(ms).slice(0, 5)} ${T.fmtTime(ms)}`);
    return `${f(s)} – ${f(e)}`;
  }

  function statusFor(l) {
    if (l.state === 'conflict' || l.state === 'unscheduled') return scheduleBadge(l.state);
    return bookingBadge(l.cat);
  }

  function drawList(shown) {
    const list = root.querySelector('#t-list');
    list.innerHTML = shown.map((l) => {
      const sel = l.truckId === st.sel;
      const b = l.booking;
      let job, site, when;
      if (l.state === 'unscheduled') {
        job = '<span class="muted">No booking at this time</span>';
        site = '<span class="fp-unknown">Unscheduled — location unknown</span>';
        when = l.next ? `Next: ${T.fmtKeyLong(T.dateKey(l.next.start)).slice(0, 9)} ${T.fmtTime(l.next.start)}` : 'No upcoming bookings';
      } else if (l.state === 'conflict') {
        job = 'Schedule clash';
        site = `<span class="fp-clash">${l.active.length} overlapping bookings — no position shown</span>`;
        when = l.active.map((x) => timeRange(x)).join(' · ');
      } else {
        job = esc(L.bookingTitle(b));
        site = l.state === 'needs-location' ? '<span class="fp-req">Site location required</span>' : esc(siteName(b));
        when = timeRange(b);
      }
      const fullSite = b ? (b.address || siteName(b)) : '';
      return `<div class="fp-item${sel ? ' sel' : ''}" role="listitem" data-t="${l.truckId}">
        <button type="button" class="fp-row" data-pick="${l.truckId}" aria-expanded="${sel}" aria-controls="fp-d-${l.truckId}" ${fullSite ? `title="${esc(fullSite)}"` : ''}>
          <span class="fp-thumb">${AD.art.vac(AD.art.num(l.truckId), 64)}</span>
          <span class="fp-main">
            <span class="fp-top"><b>${l.truckId}</b>${statusFor(l)}</span>
            <span class="fp-job">${job}</span>
            <span class="fp-site">${site}</span>
            <span class="fp-time">${when}</span>
          </span>
        </button>
        ${sel ? `<div class="fp-detail" id="fp-d-${l.truckId}">${detail(l)}</div>` : ''}
      </div>`;
    }).join('') || '<p class="empty" style="padding:16px">No trucks match these filters.</p>';

    list.querySelectorAll('[data-pick]').forEach((btn) => {
      btn.onclick = (e) => select(btn.dataset.pick, 'list', e.detail === 0);
    });
    list.querySelectorAll('[data-open]').forEach((btn) => (btn.onclick = () => AD.bookingForm(AD.store.get('bookings', btn.dataset.open))));
    list.querySelectorAll('[data-cal]').forEach((btn) => (btn.onclick = () => {
      const bk = AD.store.get('bookings', btn.dataset.cal);
      AD.go('calendar', { view: 'day', date: T.dateKey(bk.start), open: bk.id });
    }));
    list.querySelectorAll('[data-veh]').forEach((btn) => (btn.onclick = () => AD.go('vehicle/' + btn.dataset.veh, { tab: 'bookings' })));
  }

  function detail(l) {
    const v = l.truck, b = l.booking;
    const assigned = L.driverName(v.driverId);
    const next = l.next;
    const nextHtml = next ? `${esc(L.bookingTitle(next))}<span class="t2">${T.fmtDateTime(next.start)} · ${esc(siteName(next) || 'Site location required')}</span>` : '<span class="muted">None scheduled</span>';
    const vehicleBtn = `<button type="button" class="btn btn-secondary btn-sm" data-veh="${v.id}">View vehicle</button>`;
    const head = `<div class="fpd-veh">${esc(v.make)} ${esc(v.model.split(' —')[0])} · ${esc(v.rego)} · ${vehicleBadge(v.status)}</div>`;

    if (l.state === 'unscheduled') {
      return `${head}
        <p class="note">No booking, depot or maintenance assignment covers ${T.fmtDateTime(st.t)}. The truck is not assumed to be at the depot.</p>
        <dl><dt>Driver</dt><dd>${assigned ? `${esc(assigned)}<span class="t2">Fleet assignment</span>` : '<span class="muted">Not recorded</span>'}</dd>
        <dt>Next job</dt><dd>${nextHtml}</dd></dl>
        <div class="btns">${next ? `<button type="button" class="btn btn-primary btn-sm" data-open="${next.id}">Open next booking</button>` : ''}${vehicleBtn}</div>`;
    }
    if (l.state === 'conflict') {
      return `${head}
        <p class="note note-danger"><b>Schedule clash.</b> ${l.active.length} bookings overlap, so no location is shown. Open one to fix it.</p>
        <div class="clash-list">${l.active.map((x) => `<div class="clash-item"><div>${esc(L.bookingTitle(x))}${x.jobNumber ? ' · ' + esc(x.jobNumber) : ''}
          <span class="t2">${timeRange(x)} · ${esc(siteName(x) || 'Site location required')}</span></div>
          <button type="button" class="btn btn-link" data-open="${x.id}">Open</button></div>`).join('')}</div>
        <div class="btns">${vehicleBtn}</div>`;
    }
    const driver = b.driverId ? esc(L.driverName(b.driverId))
      : assigned ? `${esc(assigned)}<span class="t2">Fleet assignment — not on this booking</span>` : '<span class="muted">Not recorded</span>';
    const site = l.state === 'needs-location'
      ? `<span class="flag flag-amber">Site location required</span>${b.address ? `<span class="t2">${esc(b.address)} (typed, not located)</span>` : ''}`
      : `${esc(b.address || 'Pinned location')}<span class="t2">${b.lat.toFixed(4)}, ${b.lng.toFixed(4)} · ${b.locationSource === 'pin' ? 'dropped pin' : 'saved site'}</span>`;
    return `${head}
      <dl>
        <dt>Job</dt><dd>${esc(L.bookingTitle(b))}${[b.jobNumber, b.client].filter(Boolean).length ? `<span class="t2">${[b.jobNumber, b.client].filter(Boolean).map(esc).join(' · ')}</span>` : ''}</dd>
        <dt>Driver</dt><dd>${driver}</dd>
        <dt>Site</dt><dd>${site}</dd>
        <dt>Start</dt><dd>${T.fmtDateTime(b.start)} <span class="muted">${T.abbr(b.start)}</span></dd>
        <dt>Finish</dt><dd>${T.fmtDateTime(b.end)} <span class="muted">${T.abbr(b.end)}</span></dd>
        <dt>Status</dt><dd>${bookingBadge(L.bookingCategory(b))}</dd>
        <dt>Next job</dt><dd>${nextHtml}</dd>
      </dl>
      <div class="btns">
        <button type="button" class="btn btn-primary btn-sm" data-open="${b.id}">Open booking</button>
        ${vehicleBtn}
        <button type="button" class="btn btn-link" data-cal="${b.id}">Show in Calendar</button>
      </div>`;
  }

  // ---------------------------------------------------------------- selection
  function select(id, source, fromKeyboard) {
    st.sel = source === 'list' && st.sel === id ? '' : id; // clicking an open entry closes it
    update();
    const list = root.querySelector('#t-list');
    const item = root.querySelector(`.fp-item[data-t="${id}"]`);
    if (item && list.scrollHeight > list.clientHeight) {
      const top = item.offsetTop, bottom = top + item.offsetHeight;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = Math.min(top, bottom - list.clientHeight);
    }
    if (st.sel && source === 'list') revealMarker(id, false);
    if (fromKeyboard && item) item.querySelector('.fp-row').focus();
  }

  function destroy() {
    stopPlay();
    if (map) { map.remove(); map = null; group = null; wsGroup = null; centerDot = null; }
    markers.clear();
    wsMarkers.clear();
    if (root) root.classList.remove('view-flush');
    root = null;
  }

  return { title: 'Tracker', render, refresh: update, destroy };
})();
