/*
 * Data store — the single source of truth for every screen.
 *
 * Demo mode keeps everything in memory and persists to localStorage.
 * To connect Supabase later, replace the bodies of load/persist/insert/update/
 * remove with Supabase queries (one table per collection) and keep this API,
 * so the views don't need to change. Calendar and Tracker both read the same
 * `bookings` collection, which is what keeps them in sync.
 */
window.AD = window.AD || {};

AD.store = (function () {
  const KEY = 'astrea-drive-demo-v1';
  let db = null;
  const listeners = new Set();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === 2) { db = parsed; return; }
      }
    } catch (e) { console.warn('Could not read saved demo data; reseeding.', e); }
    db = AD.seed.build();
    persist();
  }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); }
    catch (e) { console.warn('Could not save demo data to localStorage.', e); }
  }

  function emit(coll) { listeners.forEach((fn) => fn(coll)); }

  const uid = (prefix) => prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function all(coll) { return db[coll]; }
  function get(coll, id) { return db[coll].find((r) => r.id === id) || null; }

  function insert(coll, row, prefix) {
    const rec = Object.assign({ id: row.id || uid(prefix || coll.slice(0, 3)) }, row);
    db[coll].push(rec);
    persist(); emit(coll);
    return rec;
  }

  function update(coll, id, patch) {
    const rec = get(coll, id);
    if (!rec) return null;
    Object.assign(rec, patch);
    persist(); emit(coll);
    return rec;
  }

  function remove(coll, id) {
    const i = db[coll].findIndex((r) => r.id === id);
    if (i >= 0) db[coll].splice(i, 1);
    persist(); emit(coll);
  }

  function log(text, vehicleId) {
    db.activity.unshift({ id: uid('act'), ts: new Date().toISOString(), vehicleId: vehicleId || '', text });
    db.activity = db.activity.slice(0, 60);
    persist(); emit('activity');
  }

  function reset() {
    db = AD.seed.build();
    persist(); emit('*');
  }

  function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  function meta() { return { seededAt: db.seededAt, seedDay: db.seedDay }; }

  return { load, all, get, insert, update, remove, log, reset, on, meta, uid };
})();
