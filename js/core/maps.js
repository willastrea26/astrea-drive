/*
 * Map helpers: Leaflet for interaction and markers, with a styled vector
 * basemap drawn by MapLibre GL (via the maplibre-gl-leaflet plugin).
 *
 * Basemap: OpenFreeMap vector tiles (OpenMapTiles schema, OpenStreetMap data).
 * Free, open, no API key or account. We load its "Positron" style and restyle
 * the actual map layers (land, water, roads, labels) into Astrea light and dark
 * palettes — no CSS filters on tiles.
 *
 * Needs internet and WebGL. If either is missing, the map falls back to
 * standard OpenStreetMap raster tiles, or shows a clear message; the rest of
 * the app keeps working.
 */
window.AD = window.AD || {};

AD.maps = (function () {
  const AU_BOUNDS = [[-43.8, 112.8], [-10.4, 154.2]];
  const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
  const ATTRIBUTION = '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> Data &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
  const available = () => typeof window.L !== 'undefined';
  let baseStyle = null;
  let lastMap = null; // most recent map, for inspection during testing

  // Astrea palettes applied to the vector style's own layers.
  const PALETTE = {
    light: {
      background: '#eef1f4', park: '#e1e9e3', wood: '#dfe7e1', residential: '#e9ecef', building: '#e0e5eb', ice: '#f7f9fb',
      water: '#c9dbea', waterway: '#b9cfe3', roadMinor: '#ffffff', roadMajor: '#ffffff', motorway: '#ffffff', casing: '#d2dae4',
      motorwayCasing: '#c3cedb', rail: '#d6dce4', boundary: '#a9b4c2', aeroway: '#f7f9fb',
      label: '#243148', labelMinor: '#4a576b', halo: '#ffffff', waterLabel: '#44658f', roadLabel: '#5a6679'
    },
    // Tuned to the app's petrol-navy surfaces so the map reads as part of the page.
    dark: {
      background: '#1b3047', park: '#1d3a42', wood: '#1c3740', residential: '#1f3550', building: '#274259', ice: '#24405a',
      water: '#132b42', waterway: '#173350', roadMinor: '#2d4a66', roadMajor: '#3a5c7c', motorway: '#4a7092', casing: '#23394f',
      motorwayCasing: '#2b4762', rail: '#334f6b', boundary: '#5a7590', aeroway: '#243c54',
      label: '#dce8f3', labelMinor: '#a8bdd0', halo: '#12263a', waterLabel: '#8fb2d8', roadLabel: '#9db3c6'
    }
  };

  function paintFor(id, type, p) {
    if (type === 'background') return { 'background-color': p.background };
    if (type === 'fill') {
      if (id === 'water') return { 'fill-color': p.water };
      if (id === 'park') return { 'fill-color': p.park };
      if (id.includes('wood')) return { 'fill-color': p.wood };
      if (id.includes('residential')) return { 'fill-color': p.residential };
      if (id === 'building') return { 'fill-color': p.building, 'fill-outline-color': p.casing };
      if (id.includes('ice') || id.includes('glacier')) return { 'fill-color': p.ice };
      if (id.includes('aeroway')) return { 'fill-color': p.aeroway };
      if (id.includes('pier')) return { 'fill-color': p.background };
      return null;
    }
    if (type === 'line') {
      if (id === 'waterway') return { 'line-color': p.waterway };
      if (id.includes('boundary')) return { 'line-color': p.boundary };
      if (id.includes('rail')) return { 'line-color': p.rail };
      if (id.includes('pier')) return { 'line-color': p.background };
      if (id.includes('aeroway')) return { 'line-color': p.aeroway };
      if (id.includes('motorway') && id.includes('casing')) return { 'line-color': p.motorwayCasing };
      if (id.includes('casing')) return { 'line-color': p.casing };
      if (id.includes('motorway')) return { 'line-color': p.motorway };
      if (id.includes('major')) return { 'line-color': p.roadMajor };
      if (id.includes('highway') || id.includes('road') || id.includes('tunnel')) return { 'line-color': p.roadMinor };
      return null;
    }
    if (type === 'symbol') {
      if (id.includes('water')) return { 'text-color': p.waterLabel, 'text-halo-color': p.halo };
      if (id.includes('highway') || id.includes('road')) return { 'text-color': p.roadLabel, 'text-halo-color': p.halo };
      if (id.includes('city') || id.includes('town') || id.includes('country')) return { 'text-color': p.label, 'text-halo-color': p.halo };
      return { 'text-color': p.labelMinor, 'text-halo-color': p.halo };
    }
    return null;
  }

  /** Copy of the base vector style with Astrea colours written into each layer. */
  function themed(mode) {
    const p = PALETTE[mode] || PALETTE.light;
    const style = JSON.parse(JSON.stringify(baseStyle));
    style.layers.forEach((layer) => {
      const paint = paintFor(layer.id, layer.type, p);
      if (paint) layer.paint = Object.assign({}, layer.paint, paint);
      // Road shields add clutter at fleet zooms; keep names only.
      if (layer.id.includes('shield')) layer.layout = Object.assign({}, layer.layout, { visibility: 'none' });
    });
    return style;
  }

  function loadBaseStyle() {
    if (baseStyle) return Promise.resolve(baseStyle);
    return fetch(STYLE_URL).then((r) => { if (!r.ok) throw new Error('style ' + r.status); return r.json(); }).then((s) => (baseStyle = s));
  }

  function webglOK() {
    try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
  }

  function showMsg(container, html, center) {
    let el = container.querySelector('.map-msg');
    if (!el) {
      el = document.createElement('div');
      el.className = 'map-msg';
      container.appendChild(el);
    }
    el.classList.toggle('center', !!center);
    el.innerHTML = html;
  }

  function rasterFallback(map, why) {
    if (!map._container || map._adRaster) return;
    map._adRaster = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
    }).addTo(map);
    map._adRaster.bringToBack();
    showMsg(map._adWrap, `<b>Styled basemap unavailable</b> — ${why} Showing standard OpenStreetMap tiles instead.`);
  }

  function addVector(map, style) {
    if (!L.maplibreGL || !webglOK()) return rasterFallback(map, 'this browser can’t draw vector maps (WebGL).');
    loadBaseStyle().then(() => {
      if (!map._container) return; // map was removed while loading
      map._adGL = L.maplibreGL({ style: themed(style), attribution: ATTRIBUTION }).addTo(map);
      const gl = map._adGL.getMaplibreMap();
      let loaded = false, errors = 0;
      gl.on('load', () => { loaded = true; const m = map._adWrap.querySelector('.map-msg'); if (m) m.remove(); });
      gl.on('error', () => {
        errors++;
        if (!loaded && errors >= 3) showMsg(map._adWrap, '<b>Map tiles could not load.</b> Check your internet connection. Truck positions and the fleet list still follow the schedule.');
      });
    }).catch(() => rasterFallback(map, 'the map style could not be downloaded.'));
  }

  /**
   * Create a Leaflet map in `el`. `wrap` is the positioned container used for
   * overlay messages. Returns null if Leaflet failed to load.
   */
  function create(el, wrap, opts = {}) {
    if (!available()) {
      showMsg(wrap, '<b>Map unavailable.</b> The mapping library could not load — this usually means there is no internet connection. The fleet list, truck details and the Calendar still work.', true);
      return null;
    }
    const { style = 'light', ...mapOpts } = opts;
    const map = L.map(el, Object.assign({ minZoom: 3, maxZoom: 18, maxBounds: [[-60, 90], [5, 180]], worldCopyJump: false }, mapOpts));
    map._adWrap = wrap;
    map._adStyle = style;
    addVector(map, style);
    lastMap = map;
    map.fitBounds(AU_BOUNDS);
    return map;
  }

  /** Swap between the Astrea light and dark basemap styles. */
  function setStyle(map, style) {
    if (!map || map._adStyle === style) return;
    map._adStyle = style;
    if (map._adGL && baseStyle) map._adGL.getMaplibreMap().setStyle(themed(style));
  }

  return { create, setStyle, available, AU_BOUNDS, showMsg, last: () => lastMap };
})();
