/*
 * Seven-day Sydney forecast from Open-Meteo — free, no API key, CORS-enabled.
 * Cached in localStorage for an hour so moving between pages doesn't refetch.
 * Every failure path resolves to null; the banner simply omits the strip.
 */
window.AD = window.AD || {};

AD.weather = (function () {
  const LAT = -33.8688, LON = 151.2093;
  const CACHE_KEY = 'ad.weather.v1';
  const TTL = 60 * 60 * 1000;
  const TIMEOUT = 7000;
  const URL = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min' +
    '&timezone=Australia%2FSydney&forecast_days=7';

  // ---------- glyphs ----------
  const SUN = '#f5b83d', CLOUD = '#bcd0e6', CLOUD_DARK = '#9db3cc', RAIN = '#5aa9f0', SNOW = '#e2eefc';

  const wrap = (inner) => `<svg class="wx-glyph" viewBox="0 0 32 32" aria-hidden="true">${inner}</svg>`;

  const cloud = (dy, fill) => `<g fill="${fill || CLOUD}" transform="translate(0 ${dy})">
    <circle cx="13.5" cy="14" r="6"/><circle cx="21" cy="17" r="4.8"/><circle cx="9" cy="18" r="4.3"/>
    <rect x="9" y="17.5" width="12.5" height="4.5" rx="2.2"/></g>`;

  const sun = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${SUN}"/>`;

  const rays = (cx, cy, inner, outer) => {
    const d = [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
      const a = (deg * Math.PI) / 180, s = Math.sin(a), c = -Math.cos(a);
      return `M${(cx + s * inner).toFixed(1)} ${(cy + c * inner).toFixed(1)}L${(cx + s * outer).toFixed(1)} ${(cy + c * outer).toFixed(1)}`;
    }).join('');
    return `<path d="${d}" stroke="${SUN}" stroke-width="2.2" stroke-linecap="round" fill="none"/>`;
  };

  const drops = (color) => `<path d="M11 25.5 9.8 29M16 25.5 14.8 29M21 25.5 19.8 29"
    stroke="${color}" stroke-width="2.2" stroke-linecap="round" fill="none"/>`;

  const GLYPH = {
    clear: wrap(rays(16, 16, 9, 13) + sun(16, 16, 6.5)),
    mostlyClear: wrap(rays(12, 12, 7.5, 11) + sun(12, 12, 5.5) + cloud(4)),
    partly: wrap(rays(21, 10, 6.5, 9.5) + sun(21, 10, 4.8) + cloud(3)),
    cloudy: wrap(cloud(3, CLOUD_DARK)),
    fog: wrap(cloud(0, CLOUD_DARK) + `<path d="M8 26.5h16M10.5 30h11" stroke="${CLOUD_DARK}" stroke-width="2.1" stroke-linecap="round" fill="none"/>`),
    drizzle: wrap(cloud(0) + `<path d="M12 26 11.2 28.6M20 26l-.8 2.6" stroke="${RAIN}" stroke-width="2.2" stroke-linecap="round" fill="none"/>`),
    rain: wrap(cloud(0) + drops(RAIN)),
    showers: wrap(rays(22, 8, 5.5, 8) + sun(22, 8, 4) + cloud(1) + drops(RAIN)),
    snow: wrap(cloud(0) + `<g fill="${SNOW}"><circle cx="11" cy="27.5" r="1.6"/><circle cx="16" cy="29.4" r="1.6"/><circle cx="21" cy="27.5" r="1.6"/></g>`),
    storm: wrap(cloud(0, CLOUD_DARK) + `<path d="M17.4 23.5 12 31h3.6l-.9 4 5.4-7.6h-3.5z" fill="${SUN}"/>`)
  };

  // WMO weather codes → glyph + plain-language label.
  const CODES = {
    0: ['clear', 'Clear'],
    1: ['mostlyClear', 'Mainly clear'],
    2: ['partly', 'Partly cloudy'],
    3: ['cloudy', 'Overcast'],
    45: ['fog', 'Fog'], 48: ['fog', 'Freezing fog'],
    51: ['drizzle', 'Light drizzle'], 53: ['drizzle', 'Drizzle'], 55: ['drizzle', 'Heavy drizzle'],
    56: ['drizzle', 'Freezing drizzle'], 57: ['drizzle', 'Freezing drizzle'],
    61: ['rain', 'Light rain'], 63: ['rain', 'Rain'], 65: ['rain', 'Heavy rain'],
    66: ['rain', 'Freezing rain'], 67: ['rain', 'Freezing rain'],
    71: ['snow', 'Light snow'], 73: ['snow', 'Snow'], 75: ['snow', 'Heavy snow'], 77: ['snow', 'Snow grains'],
    80: ['showers', 'Light showers'], 81: ['showers', 'Showers'], 82: ['showers', 'Heavy showers'],
    85: ['snow', 'Snow showers'], 86: ['snow', 'Snow showers'],
    95: ['storm', 'Thunderstorm'], 96: ['storm', 'Thunderstorm, hail'], 99: ['storm', 'Thunderstorm, hail']
  };

  function describe(code) {
    const [key, label] = CODES[code] || ['cloudy', 'Unsettled'];
    return { glyph: GLYPH[key], label };
  }

  // ---------- cache ----------
  function readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const c = JSON.parse(raw);
      if (!c || !Array.isArray(c.days) || !c.days.length) return null;
      return c;
    } catch (e) { return null; }
  }

  function writeCache(days) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), days })); } catch (e) { /* quota or private mode */ }
  }

  function parse(json) {
    const d = json && json.daily;
    if (!d || !Array.isArray(d.time)) return null;
    const days = d.time.map((key, i) => ({
      key,
      code: d.weather_code[i],
      hi: Math.round(d.temperature_2m_max[i]),
      lo: Math.round(d.temperature_2m_min[i])
    })).filter((x) => Number.isFinite(x.hi) && Number.isFinite(x.lo));
    return days.length ? days : null;
  }

  let inflight = null;

  /** Resolves to an array of days, or null if the forecast can't be had. */
  function load() {
    const cached = readCache();
    if (cached && Date.now() - cached.at < TTL) return Promise.resolve(cached.days);
    if (inflight) return inflight;

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT);
    inflight = fetch(URL, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const days = json && parse(json);
        if (days) writeCache(days);
        // A stale cache still beats an empty banner.
        return days || (cached ? cached.days : null);
      })
      .catch(() => (cached ? cached.days : null))
      .finally(() => { clearTimeout(timer); inflight = null; });
    return inflight;
  }

  /** Whatever is already in hand, fresh or stale — for a first paint with no flash. */
  function cached() {
    const c = readCache();
    return c ? c.days : null;
  }

  return { load, cached, describe, SOURCE: 'Open-Meteo' };
})();
