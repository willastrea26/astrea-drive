/*
 * Tracker: scheduled vehicle positions and current workshop assignments on a map of Australia.
 *
 * Positions come from Calendar bookings at the selected instant, plus a
 * vehicle's explicit "In workshop" assignment. Never GPS, never interpolated
 * travel, and never an assumed return to depot.
 */
AD.views = AD.views || {};

AD.views.tracker = (function () {
  const { esc, options, bookingBadge, scheduleBadge, vehicleBadge } = AD.ui;
  const L = AD.logic, T = AD.time, I = AD.icons;
  const PREF_KEY = 'astrea-drive-tracker';
  const STATUS_WORD = { confirmed: 'Confirmed', tentative: 'Tentative', maintenance: 'Maintenance', depot: 'Depot' };
  const reducedMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Live GPS (Netstar) --------------------------------------------------
  const LIVE_REFRESH_MS = 60000;   // auto-refresh cadence while on the live tab
  const LIVE_STALE_HOURS = 24;     // older than this since last report = offline
  const LIVE_WORD = { moving: 'Moving', idling: 'Idling', parked: 'Parked', offline: 'Offline' };
  let liveData = null;             // last successful response
  let liveFetchedAt = 0;           // ms epoch of last success
  let liveLoading = false, liveError = '', liveTimer = null, liveFitted = false;

  let root = null, map = null, group = null, wsGroup = null, centerDot = null, playTimer = null;
  const markers = new Map();
  const wsMarkers = new Map();
  let st = {};
  let prefs = loadPrefs();

  /** Netstar reports times as "DD-MM-YYYY HH:MM:SS" (Australia local). -> ms epoch | null */
  function parseNetstarTime(s) {
    const m = /^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/.exec(String(s || ''));
    if (!m) return null;
    const [, dd, mm, yyyy, hh, mi, ss] = m;
    const t = Date.parse(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+11:00`); // treat as Sydney; close enough for "ago"
    return Number.isFinite(t) ? t : null;
  }

  /** How long ago, compactly: "3 min ago", "2 h ago", "5 d ago". */
  function agoText(ms) {
    if (ms == null) return 'unknown';
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  }

  /** Classify a live position into moving / idling / parked / offline. */
  function liveStatus(p) {
    const seen = parseNetstarTime(p.lastData);
    if (!p.hasFix || (seen != null && Date.now() - seen > LIVE_STALE_HOURS * 3600000)) return 'offline';
    const on = String(p.ignition || '').toLowerCase() === 'on';
    if (on && (p.speed || 0) > 0) return 'moving';
    if (on) return 'idling';
    return 'parked';
  }

  function trackedVehicles() {
    const vehicles = new Map(L.vacTrucks().map((v) => [v.id, v]));
    AD.store.all('vehicles').filter((v) => !v.hired && v.status === 'In workshop' && v.workshopId).forEach((v) => vehicles.set(v.id, v));
    return [...vehicles.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  function loadPrefs() {
    try { return Object.assign({ panel: 'open', style: 'dark', mode: 'scheduled' }, JSON.parse(localStorage.getItem(PREF_KEY) || '{}')); }
    catch (e) { return { panel: 'open', style: 'dark', mode: 'scheduled' }; }
  }
  function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { /* preference only */ } }

  /** Pull the latest live positions from the Netstar proxy function. */
  async function fetchLive(force) {
    if (liveLoading) return;
    if (!force && liveData && Date.now() - liveFetchedAt < LIVE_REFRESH_MS) return;
    liveLoading = true; liveError = '';
    if (st.mode === 'live') update();
    try {
      const { data, error } = await AD.sb.functions.invoke('netstar', { body: { action: 'live' } });
      if (error) throw error;
      if (data && data.error) throw new Error(data.error);
      liveData = data;
      liveFetchedAt = Date.now();
    } catch (e) {
      liveError = (e && e.message) || 'Could not reach the tracker service';
    } finally {
      liveLoading = false;
      if (st.mode === 'live' && root) update();
    }
  }

  function startLiveTimer() {
    stopLiveTimer();
    liveTimer = setInterval(() => { if (st.mode === 'live') fetchLive(true); }, LIVE_REFRESH_MS);
  }
  function stopLiveTimer() { if (liveTimer) { clearInterval(liveTimer); liveTimer = null; } }

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
    st = { t, truck: '', status: params.status || '', avail: params.avail || '', sel: params.truck || '', playing: false,
           mode: params.mode === 'live' ? 'live' : prefs.mode, liveStatus: params.livestatus || '' };

    const tool = (act, icon, label, extra = '') => `<button type="button" data-act="${act}" title="${label}" aria-label="${label}" ${extra}>${icon}</button>`;

    el.innerHTML = `
      <div class="trk ${st.mode === 'live' ? 'mode-live' : ''}" id="t-root">
        <header class="trk-head">
          <h1>Tracker</h1>
          <div class="seg trk-mode" role="group" aria-label="Position source">
            <button type="button" data-mode="scheduled" class="${st.mode !== 'live' ? 'on' : ''}">Scheduled</button>
            <button type="button" data-mode="live" class="${st.mode === 'live' ? 'on' : ''}">Live GPS</button>
          </div>
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
            <div class="trk-gps" id="t-gps"><i aria-hidden="true"></i><span id="t-gps-text">Scheduled positions · Not live GPS</span>
              <button type="button" id="t-refresh" class="trk-refresh" title="Refresh now" aria-label="Refresh live positions" hidden>${REFRESH}</button>
            </div>
          </div>

          <aside class="trk-panel" aria-label="Fleet">
            <div class="fp-head">
              <h2>Fleet</h2><span class="fp-count" id="t-count"></span>
              <button type="button" class="fp-toggle" id="t-collapse" aria-controls="t-panel-body" aria-expanded="${prefs.panel !== 'closed'}" title="Hide fleet panel" aria-label="Hide fleet panel">${I.chevR}</button>
            </div>
            <div class="fp-body" id="t-panel-body">
              <div class="fp-filters">
                <select id="f-truck" aria-label="Vehicle">${options(trackedVehicles().map((v) => v.id), st.truck, 'All vehicles')}</select>
                <select id="f-status" class="only-scheduled" aria-label="Booking status">${options([['confirmed', 'Confirmed'], ['tentative', 'Tentative'], ['maintenance', 'Maintenance'], ['depot', 'Depot'], ['unscheduled', 'Unscheduled'], ['conflict', 'Clash'], ['needs-location', 'Site location required']], st.status, 'Any status')}</select>
                <select id="f-avail" class="only-scheduled" aria-label="Availability">${options([['free', 'Free (no booking)'], ['booked', 'Booked on a job'], ['unavailable', 'Unavailable']], st.avail, 'Availability')}</select>
                <select id="f-livestatus" class="only-live" aria-label="Live status">${options([['moving', 'Moving'], ['idling', 'Idling'], ['parked', 'Parked'], ['offline', 'Offline']], st.liveStatus, 'Any status')}</select>
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
    $('#f-livestatus').onchange = (e) => { st.liveStatus = e.target.value; update(); };
    $('#t-collapse').onclick = () => setPanel('closed');
    $('#t-expand').onclick = () => setPanel('open');
    $('#t-refresh').onclick = () => fetchLive(true);
    el.querySelectorAll('.trk-mode [data-mode]').forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
    el.querySelectorAll('.trk-tools [data-act]').forEach((b) => (b.onclick = () => toolAction(b.dataset.act, b)));

    initMap();
    if (st.mode === 'live') { liveFitted = false; startLiveTimer(); fetchLive(false); }
    update();
    setTimeout(() => {
      if (!map) return;
      map.invalidateSize();
      if (st.sel) revealMarker(st.sel, true); else fitFleet();
    }, 60);
  }

  const PLAY = '<svg class="ico" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
  const PAUSE = '<svg class="ico" viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5.5" width="4" height="13" rx="1"/><rect x="13.5" y="5.5" width="4" height="13" rx="1"/></svg>';
  const REFRESH = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v5h-5"/></svg>';
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
        e.layer.bindTooltip(`<b>${ids.length} vehicles</b><br>${ids.join(', ')}<br><span class="muted">Click to ${ids.length && sameSpot(e.layer) ? 'separate' : 'zoom in'}</span>`, { direction: 'top', offset: [0, -26], className: 'tm-tip' }).openTooltip();
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

    // Static, always-on layer of all saved repairer/workshop locations.
    wsGroup = window.L.layerGroup().addTo(map);
    AD.store.all('workshops').filter((w) => w.lat != null && w.lng != null).forEach((w) => {
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

  /** Refresh workshop pin badges/tooltips with whichever vehicles are currently located there. */
  function syncWorkshops(shown) {
    for (const [id, m] of wsMarkers) {
      const w = m._w;
      const here = shown.filter((l) => l.state === 'located' && l.lat === w.lat && l.lng === w.lng);
      m.setIcon(wsIcon(here.length));
      m.bindTooltip(`<b>${esc(w.name)}</b><br>${esc(w.address)}${here.length ? `<br><b>${here.length} vehicle${here.length > 1 ? 's' : ''} here now:</b> ${here.map((l) => esc(l.truckId)).join(', ')}` : ''}`, { direction: 'top', offset: [0, -18], className: 'tm-tip' });
    }
  }

  const sameSpot = (cluster) => { const k = cluster.getAllChildMarkers(); return k.every((m) => m.getLatLng().equals(k[0].getLatLng())); };

  function clusterIcon(cluster) {
    const kids = cluster.getAllChildMarkers();
    const hasSel = kids.some((m) => m._tid === st.sel);
    return window.L.divIcon({
      className: 'tcluster',
      html: `<div class="tc${hasSel ? ' sel' : ''}" aria-label="${kids.length} vehicles"><span class="tc-n">${kids.length}</span><span class="tc-l">vehicles</span></div>`,
      iconSize: [56, 56], iconAnchor: [28, 28]
    });
  }

  const markerLabel = (l) => l.live && !l.matched ? (l.deviceName || l.live.rego || l.truckId) : l.truckId;
  // forVehicle() throws on a null vehicle, so only call it when we actually have one.
  const vehArt = (truck, size, label) => (truck && AD.art.forVehicle(truck, size, label)) || AD.art.car(size, label);

  function markerIcon(l, sel) {
    const word = l.live ? (LIVE_WORD[l.cat] || '') : (STATUS_WORD[l.cat] || '');
    const label = markerLabel(l);
    return window.L.divIcon({
      className: 'tm-wrap',
      html: `<div class="tm tm-${l.cat}${l.live ? ' tm-live' : ''}${sel ? ' sel' : ''}">
        <span class="tm-halo"></span>
        <span class="tm-status"><i></i>${esc(word)}</span>
        ${vehArt(l.truck, 88, `${label} location`)}
        <span class="tm-stem"></span><span class="tm-anchor"></span>
      </div>`,
      iconSize: [88, 64], iconAnchor: [44, 60]
    });
  }

  function markerTip(l) {
    if (l.live) {
      const p = l.live;
      const where = p.location || (p.lat != null ? `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}` : '');
      return `<b>${esc(markerLabel(l))}</b> · ${esc(LIVE_WORD[l.cat] || '')}<br>${esc(where)}<br><span class="muted">Seen ${esc(agoText(l.seenAt))}${p.speed ? ` · ${Math.round(p.speed)} km/h` : ''}</span>`;
    }
    return `<b>${esc(l.truckId)}</b> · ${esc(STATUS_WORD[l.cat])}<br>${esc(L.bookingTitle(l.booking))}<br><span class="muted">${esc(siteName(l.booking))}</span>`;
  }

  function wireMarker(m, l) {
    const el = m.getElement();
    if (!el) return;
    const aria = l.live
      ? `${markerLabel(l)}, ${LIVE_WORD[l.cat] || ''}: ${l.live.location || 'location unknown'}, seen ${agoText(l.seenAt)}`
      : `${l.truckId}, ${STATUS_WORD[l.cat] || ''}: ${L.bookingTitle(l.booking)}, ${l.booking.address || 'pinned site'}`;
    el.setAttribute('aria-label', aria);
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
      const tip = markerTip(l);
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
    const pts = activeLocations().filter(activePasses).filter((l) => l.state === 'located').map((l) => [l.lat, l.lng]);
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

  function setMode(mode) {
    if (mode === st.mode) return;
    stopPlay();
    st.mode = mode;
    prefs.mode = mode; savePrefs();
    st.sel = '';
    // Clear the current marker set so icons from the other mode don't linger.
    for (const [, m] of markers) group.removeLayer(m);
    markers.clear();
    root.querySelector('#t-root').classList.toggle('mode-live', mode === 'live');
    root.querySelectorAll('.trk-mode [data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    if (mode === 'live') { liveFitted = false; startLiveTimer(); fetchLive(false); } else { stopLiveTimer(); }
    update();
    setTimeout(() => { if (map) { map.invalidateSize(); fitFleet(); } }, 60);
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
    return trackedVehicles().map((v) => {
      let loc = L.locate(v.id, st.t);
      const workshop = v.status === 'In workshop' && v.workshopId ? AD.store.get('workshops', v.workshopId) : null;
      // A saved workshop assignment supplies a trustworthy position when no
      // calendar booking (or a booking without coordinates) can locate it.
      if (workshop && workshop.lat != null && workshop.lng != null && (loc.state === 'unscheduled' || loc.state === 'needs-location')) {
        const day = T.dateKey(st.t);
        const booking = {
          id: `workshop-${v.id}`, truckId: v.id, kind: 'maintenance', status: 'confirmed',
          jobName: 'In workshop', siteId: workshop.id, address: workshop.address || workshop.name,
          lat: workshop.lat, lng: workshop.lng,
          start: new Date(T.startOfDay(day)).toISOString(), end: new Date(T.startOfDay(T.addDays(day, 1))).toISOString()
        };
        loc = Object.assign({}, loc, {
          state: 'located', booking, lat: workshop.lat, lng: workshop.lng,
          label: workshop.address || workshop.name, kindLabel: 'Maintenance', workshopAssignment: workshop
        });
      }
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

  /**
   * Live positions from Netstar, matched to the fleet register by rego.
   * Devices with no matching vehicle (fake/placeholder regos) are kept but
   * flagged, so nothing is silently dropped. One location object per device.
   */
  function liveLocations() {
    const positions = (liveData && liveData.positions) || [];
    const byRego = new Map(AD.store.all('vehicles').map((v) => [String(v.rego || '').toUpperCase(), v]));
    return positions.map((p) => {
      const v = byRego.get(String(p.rego || '').toUpperCase()) || null;
      const cat = liveStatus(p);
      return {
        truckId: v ? v.id : `dev-${p.imei}`,
        truck: v,                       // null when not in the fleet register
        matched: !!v,
        deviceName: p.deviceName,
        state: p.hasFix ? 'located' : 'nofix',
        lat: p.lat, lng: p.lng,
        cat,                            // moving | idling | parked | offline
        live: p,
        seenAt: parseNetstarTime(p.lastData)
      };
    }).sort((a, b) => a.truckId.localeCompare(b.truckId));
  }

  function livePasses(loc) {
    if (st.truck && loc.truckId !== st.truck) return false;
    if (st.liveStatus && loc.cat !== st.liveStatus) return false;
    return true;
  }

  /** The location set for whichever mode is active. */
  function activeLocations() { return st.mode === 'live' ? liveLocations() : locations(); }
  function activePasses(l) { return st.mode === 'live' ? livePasses(l) : passes(l); }

  function update() {
    if (!root) return;
    if (st.mode === 'live') { updateLive(); return; }
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
    $('#t-gps-text').textContent = 'Scheduled positions · Not live GPS';
    $('#t-refresh').hidden = true;
    AD.setParams({ date: key, time: T.fmtTime(st.t), truck: st.sel, status: st.status, avail: st.avail, mode: '', livestatus: '' });

    const locs = locations();
    const shown = locs.filter(passes);
    $('#t-count').textContent = `${shown.length} of ${locs.length} · ${shown.filter((l) => l.state === 'located').length} on map`;
    drawTimeline(key, ds, de, now);
    drawList(shown);
    syncMarkers(shown);
    syncWorkshops(locs);
  }

  function updateLive() {
    const $ = (s) => root.querySelector(s);
    const modeEl = $('#t-mode');
    modeEl.className = 'mode mode-now';
    modeEl.textContent = 'Live';
    $('#to-cal').href = '#/calendar';
    $('#t-refresh').hidden = false;
    $('#t-refresh').classList.toggle('spin', liveLoading);

    // GPS banner reflects freshness / loading / error
    let banner;
    if (liveError) banner = `Live GPS unavailable — ${esc(liveError)}`;
    else if (!liveData && liveLoading) banner = 'Loading live positions…';
    else if (!liveData) banner = 'Live GPS';
    else banner = `Live GPS · updated ${agoText(liveFetchedAt)}`;
    $('#t-gps-text').textContent = banner;
    $('#t-when').textContent = liveData ? `${liveData.located} of ${liveData.count} located` : '';
    $('#t-tz').textContent = liveData ? 'Positions from Netstar' : '';

    AD.setParams({ mode: 'live', truck: st.sel, livestatus: st.liveStatus, date: '', time: '', status: '', avail: '' });

    const locs = liveLocations();
    const shown = locs.filter(livePasses);
    const onMap = shown.filter((l) => l.state === 'located').length;
    $('#t-count').textContent = liveData ? `${shown.length} of ${locs.length} · ${onMap} on map` : '';
    drawLiveList(shown);
    syncMarkers(shown);
    for (const [, m] of wsMarkers) m.setIcon(wsIcon(0)); // no vehicle-at-workshop counts in live mode
    // Fit to the fleet once, the first time real positions arrive.
    if (!liveFitted && onMap > 0) { liveFitted = true; if (!st.sel) fitFleet(); }
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
      if (l.workshopAssignment) {
        job = 'In workshop';
        site = esc(l.workshopAssignment.name);
        when = 'Current workshop assignment';
      } else if (l.state === 'unscheduled') {
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
          <span class="fp-thumb">${AD.art.forVehicle(l.truck, 64, `${l.truckId} vehicle`) || AD.art.car(64, `${l.truckId} vehicle`)}</span>
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

  const liveBadge = (cat) => `<span class="fp-live fp-live-${cat}"><i></i>${LIVE_WORD[cat] || ''}</span>`;

  function drawLiveList(shown) {
    const list = root.querySelector('#t-list');
    if (!liveData && liveLoading) { list.innerHTML = '<p class="empty" style="padding:16px">Loading live positions…</p>'; return; }
    if (liveError && !liveData) { list.innerHTML = `<p class="empty" style="padding:16px">${esc(liveError)}<br><button type="button" class="btn btn-secondary btn-sm" id="t-retry" style="margin-top:10px">Try again</button></p>`; const r = list.querySelector('#t-retry'); if (r) r.onclick = () => fetchLive(true); return; }

    list.innerHTML = shown.map((l) => {
      const sel = l.truckId === st.sel;
      const p = l.live;
      const name = markerLabel(l);
      const where = p.hasFix ? esc(p.location || `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`) : '<span class="fp-unknown">No GPS fix</span>';
      const when = `Seen ${esc(agoText(l.seenAt))}${p.speed ? ` · ${Math.round(p.speed)} km/h` : ''}`;
      return `<div class="fp-item${sel ? ' sel' : ''}" role="listitem" data-t="${l.truckId}">
        <button type="button" class="fp-row" data-pick="${l.truckId}" aria-expanded="${sel}" aria-controls="fp-d-${l.truckId}" title="${esc(p.location || name)}">
          <span class="fp-thumb">${vehArt(l.truck, 64, `${name} vehicle`)}</span>
          <span class="fp-main">
            <span class="fp-top"><b>${esc(name)}</b>${liveBadge(l.cat)}</span>
            <span class="fp-job">${l.matched ? esc(l.truck.make + ' ' + l.truck.model.split(' —')[0]) : '<span class="muted">Not in fleet register</span>'}</span>
            <span class="fp-site">${where}</span>
            <span class="fp-time">${when}</span>
          </span>
        </button>
        ${sel ? `<div class="fp-detail" id="fp-d-${l.truckId}">${liveDetail(l)}</div>` : ''}
      </div>`;
    }).join('') || '<p class="empty" style="padding:16px">No vehicles match these filters.</p>';

    list.querySelectorAll('[data-pick]').forEach((btn) => { btn.onclick = (e) => select(btn.dataset.pick, 'list', e.detail === 0); });
    list.querySelectorAll('[data-veh]').forEach((btn) => (btn.onclick = () => AD.go('vehicle/' + btn.dataset.veh, { tab: 'overview' })));
  }

  function liveDetail(l) {
    const p = l.live, v = l.truck;
    const head = v
      ? `<div class="fpd-veh">${esc(v.make)} ${esc(v.model.split(' —')[0])} · ${esc(v.rego)} · ${vehicleBadge(v.status)}</div>`
      : `<div class="fpd-veh">${esc(p.deviceName || 'Telematics device')} · ${esc(p.rego || p.imei)}</div>`;
    const coords = p.hasFix ? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : '';
    const mapLink = p.hasFix ? `<a class="btn btn-link" href="https://www.google.com/maps?q=${p.lat},${p.lng}" target="_blank" rel="noopener">Open in Google Maps</a>` : '';
    return `${head}
      ${!l.matched ? '<p class="note">This device isn’t linked to a vehicle in the fleet register (its Netstar rego doesn’t match a plate).</p>' : ''}
      <dl>
        <dt>Status</dt><dd>${liveBadge(l.cat)}</dd>
        <dt>Location</dt><dd>${p.hasFix ? esc(p.location || coords) : '<span class="muted">No GPS fix</span>'}${coords ? `<span class="t2">${coords}</span>` : ''}</dd>
        <dt>Last report</dt><dd>${esc(agoText(l.seenAt))}${p.lastData ? `<span class="t2">${esc(p.lastData)}</span>` : ''}</dd>
        <dt>Ignition</dt><dd>${esc(p.ignition || '—')}${p.speed ? ` · ${Math.round(p.speed)} km/h` : ''}</dd>
        ${p.odometerYesterday != null ? `<dt>Odometer</dt><dd>${esc(Math.round(p.odometerYesterday).toLocaleString('en-AU'))} km<span class="t2">as at yesterday</span></dd>` : ''}
        ${p.driver ? `<dt>Driver</dt><dd>${esc(p.driver)}</dd>` : ''}
        <dt>Device</dt><dd>${esc(p.deviceName || '—')}${p.deviceModel ? `<span class="t2">${esc(p.deviceModel)}</span>` : ''}</dd>
      </dl>
      <div class="btns">
        ${v ? `<button type="button" class="btn btn-secondary btn-sm" data-veh="${v.id}">View vehicle</button>` : ''}
        ${mapLink}
      </div>`;
  }

  function detail(l) {
    const v = l.truck, b = l.booking;
    const assigned = L.driverName(v.driverId);
    const next = l.next;
    const nextHtml = next ? `${esc(L.bookingTitle(next))}<span class="t2">${T.fmtDateTime(next.start)} · ${esc(siteName(next) || 'Site location required')}</span>` : '<span class="muted">None scheduled</span>';
    const vehicleBtn = `<button type="button" class="btn btn-secondary btn-sm" data-veh="${v.id}">View vehicle</button>`;
    const head = `<div class="fpd-veh">${esc(v.make)} ${esc(v.model.split(' —')[0])} · ${esc(v.rego)} · ${vehicleBadge(v.status)}</div>`;

    if (l.workshopAssignment) {
      const w = l.workshopAssignment;
      return `${head}
        <p class="note"><b>Workshop location shown.</b> ${esc(v.id)} is assigned to ${esc(w.name)}.</p>
        <dl><dt>Workshop</dt><dd>${esc(w.name)}${w.address ? `<span class="t2">${esc(w.address)}</span>` : ''}</dd>
        <dt>Driver</dt><dd>${assigned ? esc(assigned) : '<span class="muted">Not recorded</span>'}</dd>
        <dt>Next job</dt><dd>${nextHtml}</dd></dl>
        <div class="btns">${vehicleBtn}</div>`;
    }

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
    stopLiveTimer();
    if (map) { map.remove(); map = null; group = null; wsGroup = null; centerDot = null; }
    markers.clear();
    wsMarkers.clear();
    if (root) root.classList.remove('view-flush');
    root = null;
  }

  return { title: 'Tracker', render, refresh: update, destroy };
})();
