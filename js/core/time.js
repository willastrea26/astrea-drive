/*
 * Time helpers — all scheduling uses the Australia/Sydney time zone.
 *
 * Instants are stored as ISO-8601 UTC strings (e.g. "2026-09-26T21:00:00.000Z").
 * Wall-clock values the user sees and types are always Sydney local time,
 * so a 07:00 booking stays at 07:00 across the AEST/AEDT changeover.
 */
window.AD = window.AD || {};

AD.time = (function () {
  const TZ = 'Australia/Sydney';

  const partsFmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short'
  });
  const abbrFmt = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, timeZoneName: 'short' });

  const toMs = (v) => (v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : v);
  const pad = (n) => String(n).padStart(2, '0');

  /** Sydney wall-clock parts for an instant. */
  function parts(v) {
    const o = {};
    for (const p of partsFmt.formatToParts(new Date(toMs(v)))) o[p.type] = p.value;
    return {
      year: +o.year, month: +o.month, day: +o.day,
      hour: +o.hour, minute: +o.minute, second: +o.second, weekday: o.weekday
    };
  }

  /** Offset of Sydney from UTC (ms) at an instant. */
  function offsetAt(ms) {
    const p = parts(ms);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return asUtc - Math.floor(ms / 1000) * 1000;
  }

  /**
   * Instant (ms) for a Sydney wall-clock time. Times that don't exist
   * (the skipped hour when daylight saving starts) roll forward an hour;
   * ambiguous times (when it ends) resolve to the first occurrence.
   */
  function fromParts(y, mo, d, h = 0, mi = 0) {
    const guess = Date.UTC(y, mo - 1, d, h, mi);
    let ms = guess - offsetAt(guess);
    const off2 = offsetAt(ms);
    if (guess - off2 !== ms) ms = guess - off2;
    const earlier = ms - 3600000;
    if (guess - offsetAt(earlier) === earlier) ms = earlier;
    return ms;
  }

  /** "YYYY-MM-DD" Sydney date key for an instant. */
  function dateKey(v) {
    const p = parts(v);
    return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  }

  function parseKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return { y, m, d };
  }

  /** Midnight (Sydney) at the start of a date key. */
  function startOfDay(key) {
    const { y, m, d } = parseKey(key);
    return fromParts(y, m, d, 0, 0);
  }

  /** Add whole calendar days to a date key (DST-safe; works on dates, not ms). */
  function addDays(key, n) {
    const { y, m, d } = parseKey(key);
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  }

  function dayOfWeek(key) { // 0 = Monday … 6 = Sunday
    const { y, m, d } = parseKey(key);
    return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  }

  function daysBetween(a, b) { // whole days from key a to key b
    const A = parseKey(a), B = parseKey(b);
    return Math.round((Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d)) / 86400000);
  }

  function todayKey() { return dateKey(Date.now()); }

  /** Value for <input type="datetime-local"> in Sydney time. */
  function toInput(v) {
    const p = parts(v);
    return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
  }

  /** Parse a datetime-local value as Sydney time → ms (NaN if invalid). */
  function fromInput(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(str || '');
    if (!m) return NaN;
    return fromParts(+m[1], +m[2], +m[3], +m[4], +m[5]);
  }

  function abbr(v) {
    const p = abbrFmt.formatToParts(new Date(toMs(v))).find((x) => x.type === 'timeZoneName');
    return p ? p.value : 'Sydney';
  }

  // ---- Display (DD/MM/YYYY, 24-hour) ----
  function fmtDate(v) { const p = parts(v); return `${pad(p.day)}/${pad(p.month)}/${p.year}`; }
  function fmtTime(v) { const p = parts(v); return `${pad(p.hour)}:${pad(p.minute)}`; }
  function fmtDateTime(v) { return `${fmtDate(v)} ${fmtTime(v)}`; }
  function fmtKey(key) { const { y, m, d } = parseKey(key); return `${pad(d)}/${pad(m)}/${y}`; }

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  function fmtKeyLong(key) {
    const { y, m, d } = parseKey(key);
    return `${DOW[dayOfWeek(key)]} ${pad(d)}/${pad(m)}/${y}`;
  }

  /** Minutes since Sydney midnight for an instant, relative to a date key. */
  function minutesIntoDay(v, key) {
    return (toMs(v) - startOfDay(key)) / 60000;
  }

  return {
    TZ, parts, fromParts, dateKey, parseKey, startOfDay, addDays, dayOfWeek, daysBetween,
    todayKey, toInput, fromInput, abbr, fmtDate, fmtTime, fmtDateTime, fmtKey, fmtKeyLong,
    minutesIntoDay, MONTHS, DOW, pad, toMs
  };
})();
