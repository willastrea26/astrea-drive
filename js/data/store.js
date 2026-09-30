/*
 * Data store — the single source of truth for every screen.
 *
 * Backed by Supabase (see supabase/schema.sql for the tables and RLS
 * policies). Reads are served from an in-memory mirror of all 8 tables —
 * all()/get() stay synchronous so view code doesn't need to change —
 * refilled by load() on sign-in, on a timer, and after every write.
 * Writes (insert/update/remove/log) hit Supabase first and only touch the
 * local mirror once the database confirms the change, so a failed write
 * can't get out of sync with what's actually saved.
 *
 * Calendar and Tracker both read the same `bookings` collection, which is
 * what keeps them in sync with each other.
 */
window.AD = window.AD || {};

AD.store = (function () {
  const TABLES = ['vehicles', 'drivers', 'sites', 'bookings', 'services', 'defects', 'documents', 'activity'];
  let db = Object.fromEntries(TABLES.map((t) => [t, []]));
  const listeners = new Set();

  function sb() { return AD.sb; }

  function emit(coll) { listeners.forEach((fn) => fn(coll)); }

  const uid = (prefix) => prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /**
   * Refetch every table. Call after sign-in, and periodically to pick up
   * other users' changes.
   *
   * The activity log is the one table with an order the views depend on —
   * the dashboard takes the first 6 entries and expects the newest — and
   * it's the one table that grows without bound, so it's capped here.
   */
  const ACTIVITY_LIMIT = 100;

  function query(t) {
    const q = sb().from(t).select('*');
    return t === 'activity' ? q.order('ts', { ascending: false }).limit(ACTIVITY_LIMIT) : q;
  }

  async function load() {
    const results = await Promise.all(TABLES.map(query));
    const next = {};
    results.forEach((r, i) => {
      if (r.error) throw r.error;
      next[TABLES[i]] = r.data;
    });
    db = next;
    emit('*');
  }

  function all(coll) { return db[coll]; }
  function get(coll, id) { return db[coll].find((r) => r.id === id) || null; }

  async function insert(coll, row, prefix) {
    const rec = Object.assign({ id: row.id || uid(prefix || coll.slice(0, 3)) }, row);
    const { data, error } = await sb().from(coll).insert(rec).select().single();
    if (error) throw error;
    if (coll === 'activity') db[coll].unshift(data); else db[coll].push(data);
    emit(coll);
    return data;
  }

  async function update(coll, id, patch) {
    const { data, error } = await sb().from(coll).update(patch).eq('id', id).select().single();
    if (error) throw error;
    const i = db[coll].findIndex((r) => r.id === id);
    if (i >= 0) db[coll][i] = data; else db[coll].push(data);
    emit(coll);
    return data;
  }

  async function remove(coll, id) {
    const { error } = await sb().from(coll).delete().eq('id', id);
    if (error) throw error;
    const i = db[coll].findIndex((r) => r.id === id);
    if (i >= 0) db[coll].splice(i, 1);
    emit(coll);
  }

  async function log(text, vehicleId) {
    return insert('activity', { ts: new Date().toISOString(), vehicleId: vehicleId || '', text }, 'act');
  }

  function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  return { load, all, get, insert, update, remove, log, on, uid };
})();
