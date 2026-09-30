/*
 * Thin wrapper over Supabase Auth. Who is *allowed* to do anything with the
 * data is decided by the database's RLS policies (the approved_users
 * allowlist), not by this file — this just handles signing in and out.
 */
window.AD = window.AD || {};

AD.auth = (function () {
  const sb = () => AD.sb;

  async function getSession() {
    const { data, error } = await sb().auth.getSession();
    if (error) throw error;
    return data.session;
  }

  async function signIn(email, password) {
    const { data, error } = await sb().auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.session;
  }

  async function signOut() {
    const { error } = await sb().auth.signOut();
    if (error) throw error;
  }

  /** Fires on sign-in, sign-out, and token refresh. */
  function onChange(fn) {
    sb().auth.onAuthStateChange((_event, session) => fn(session));
  }

  return { getSession, signIn, signOut, onChange };
})();
