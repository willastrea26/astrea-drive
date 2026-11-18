-- =====================================================================
-- Astrea Drive — nightly odometer sync (scheduled job) — LIGHT pass
--
-- Runs the netstar edge function's "sync-odometers" action once a night so
-- vehicle odometers stay current without anyone pressing the button. With
-- no "depth" in the body it defaults to depth "recent" — only the last 3
-- days of engine-hour data per vehicle (a few dozen calls, done in seconds),
-- which stays comfortably clear of Netstar's rate limit every single night.
--
-- The 30-day totals shown in the app ("4 hrs/week" etc) still cover the full
-- month — they're rolled up from everything ever stored, not just what a
-- given run fetched. See refresh-work-hours-totals.sql.
--
-- Pair this with netstar-deep-resync-cron.sql (once a week), which pulls the
-- full 30-day window to backfill any days this light nightly pass missed.
--
-- EASIEST WAY (recommended): use the dashboard, no SQL needed.
--   Dashboard > Integrations > Cron  (or Database > Cron Jobs)
--   > Create a new job
--     Name:     netstar-odometer-sync
--     Schedule: 0 16 * * *        (daily ~2-3am Sydney; exact hour doesn't matter)
--     Type:     Supabase Edge Function  ->  netstar
--     Method:   POST
--     Body:     {"action":"sync-odometers"}
--   The dashboard wires the authorization for you. Save and you're done.
--
-- SQL ALTERNATIVE (if you prefer running it here): paste this into the
-- SQL Editor. Replace <PASTE_KEY> with your project's service-role key
-- (Dashboard > Project Settings > API Keys > "Legacy API keys" tab > service_role).
-- It must be the long key starting "eyJ" (a JWT). The newer "sb_secret_..." keys
-- are NOT accepted here: the gateway rejects them with 401
-- UNAUTHORIZED_INVALID_JWT_FORMAT and the sync never runs. Do NOT commit the real key
-- anywhere — it only needs to live in this job definition in the database.
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Re-running? Remove the old job first so it isn't scheduled twice.
select cron.unschedule('netstar-odometer-sync')
where exists (select 1 from cron.job where jobname = 'netstar-odometer-sync');

select cron.schedule(
  'netstar-odometer-sync',
  '0 16 * * *',  -- 16:00 UTC ≈ 2-3am Australia/Sydney (DST drifts an hour; fine here)
  $$
  select net.http_post(
    url                   := 'https://ysczookfayziqsnegzjc.supabase.co/functions/v1/netstar',
    headers               := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <PASTE_KEY>'
    ),
    body                  := jsonb_build_object('action', 'sync-odometers'),
    -- The light pass does odometers + a trip-summary call + three days of
    -- paced engine-hours calls per vehicle — ~45-75s in practice. pg_net
    -- defaults to a 5-second HTTP timeout, which was dropping the response
    -- long before the sync finished (and so no row ever reached sync_log
    -- for the dashboard's "Telematic inputs" to show). 120s gives it room.
    timeout_milliseconds  := 120000
  );
  $$
);

-- To check it's scheduled:        select * from cron.job;
-- To see recent runs:             select * from cron.job_run_details order by start_time desc limit 10;
-- To remove it later:             select cron.unschedule('netstar-odometer-sync');
