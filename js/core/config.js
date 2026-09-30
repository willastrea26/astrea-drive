/*
 * Supabase project connection. The publishable/anon key is designed to be
 * public — it can only do what the database's Row Level Security policies
 * allow (see supabase/schema.sql). Never put a secret/service-role key here.
 */
window.AD = window.AD || {};

AD.config = {
  SUPABASE_URL: 'https://ysczookfayziqsnegzjc.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_hInlEU8CHjlKIiMtAz4t1g_qggctjTA'
};

AD.sb = supabase.createClient(AD.config.SUPABASE_URL, AD.config.SUPABASE_ANON_KEY);
