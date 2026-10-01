/*
 * Data store — the single source of truth for every screen.
 *
 * Backed by Supabase (see supabase/schema.sql for the tables and RLS
 * policies). Reads are served from an in-memory mirror of every table —
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
  const TABLES = ['vehicles', 'drivers', 'sites', 'bookings', 'services', 'defects', 'documents', 'power_tools', 'workshops', 'activity'];
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

  // ---------- Document storage -----------------------------------------
  // Files live in the private 'documents' bucket in Supabase Storage. The
  // documents table row holds the metadata; the file is pulled through a
  // short-lived signed URL only when someone asks to open or download it.
  const BUCKET = 'documents';
  const safeName = (name) => (name || 'file').replace(/[^\w.\-]+/g, '_').slice(0, 80);

  async function uploadDocument(file, { vehicleId, name, category }) {
    const path = `${vehicleId}/${uid('doc')}-${safeName(file.name)}`;
    const up = await sb().storage.from(BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
    if (up.error) throw up.error;
    let who = '';
    try { const { data } = await sb().auth.getUser(); who = (data && data.user && data.user.email) || ''; } catch (e) { /* leave blank */ }
    const rec = {
      vehicleId, name: name || file.name, category: category || '', placeholder: false,
      storagePath: path, contentType: file.type || 'application/octet-stream',
      sizeBytes: file.size || 0, uploadedAt: new Date().toISOString(), uploadedBy: who
    };
    try {
      return await insert('documents', rec, 'doc');
    } catch (dbErr) {
      // Metadata insert failed — don't orphan the blob.
      try { await sb().storage.from(BUCKET).remove([path]); } catch (e) { /* best effort */ }
      throw dbErr;
    }
  }

  /** Short-lived signed URL for a file in the private bucket. */
  async function signDocumentUrl(storagePath, expiresInSec = 300) {
    const { data, error } = await sb().storage.from(BUCKET).createSignedUrl(storagePath, expiresInSec);
    if (error) throw error;
    return data.signedUrl;
  }

  /** Remove the row AND the backing file (if any). Order: file first — if that
   *  fails, we keep the row so the user sees something to retry; if it succeeds
   *  but the row delete fails, the row is just an orphan metadata entry which
   *  the UI already treats as "no file attached". */
  async function removeDocument(doc) {
    if (doc.storagePath) {
      const { error } = await sb().storage.from(BUCKET).remove([doc.storagePath]);
      if (error && error.statusCode !== '404' && error.statusCode !== 404) throw error;
    }
    return remove('documents', doc.id);
  }

  // ---------- Vehicle photos (gallery) ----------------------------------
  async function uploadVehiclePhoto(file, vehicleId) {
    if (!file || !/^image\//.test(file.type)) throw new Error('Not an image file');
    const path = `photos/${vehicleId}/${uid('pho')}-${safeName(file.name)}`;
    const up = await sb().storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) throw up.error;
    const photo = { id: uid('pho'), path, ts: new Date().toISOString() };
    const v = get('vehicles', vehicleId);
    const photos = [...(v.photos || []), photo];
    await update('vehicles', vehicleId, { photos });
    return photo;
  }

  async function removeVehiclePhoto(vehicleId, photoId) {
    const v = get('vehicles', vehicleId);
    const removed = (v.photos || []).find((p) => p.id === photoId);
    const photos = (v.photos || []).filter((p) => p.id !== photoId);
    if (removed && removed.path) {
      try { await sb().storage.from(BUCKET).remove([removed.path]); } catch (e) { /* best effort */ }
    }
    await update('vehicles', vehicleId, { photos });
  }

  return { load, all, get, insert, update, remove, log, on, uid, uploadDocument, signDocumentUrl, removeDocument, uploadVehiclePhoto, removeVehiclePhoto };
})();
