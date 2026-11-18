-- =====================================================================
-- Astrea Drive — weekly deep resync (scheduled job) — FULL pass
--
-- Pairs with the nightly netstar-odometer-cron.sql, which only pulls the
-- last 3 days of engine-hour data each night to stay clear of Netstar's
-- rate limit. Once a week, this pulls the FULL 30-day window (one call per
-- device per day — a few hundred calls, paced, ~60-90s) to backfill any day
-- the light nightly pass never reached — a vehicle added mid-month, a sync
-- that failed one night, a tracker that was briefly offline, etc.
--
-- Run this on its own, a few hours apart from the nightly job (not back to
-- back), so the two never overlap and burn through Netstar's allowance
-- together.
--
-- EASIEST WAY (recommended): use the dashboard, no SQL needed.
--   Dashboard > Integrations > Cron  (or Database > Cron Jobs)
--   > Create a new job
--     Name:     netstar-deep-resync
--     Schedule: 0 18 * * 0        (Sunday ~4-5am Sydney; exact time doesn't matter)
--     Type:     Supabase Edge Function  ->  netstar
--     Method:   POST
--     Body:     {"action":"sync-odometers","depth":"full"}
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
select cron.unschedule('netstar-deep-resync')
where exists (select 1 from cron.job where jobname = 'netstar-deep-resync');

select cron.schedule(
  'netstar-deep-resync',
  '0 18 * * 0',  -- Sundays, 18:00 UTC ≈ 4-5am Australia/Sydney (DST drifts an hour; fine here)
  $$
  select net.http_post(
    url                   := 'https://ysczookfayziqsnegzjc.supabase.co/functions/v1/netstar',
    headers               := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <PASTE_KEY>'
    ),
    body                  := jsonb_build_object('action', 'sync-odometers', 'depth', 'full'),
    -- Full 30-day resync: paced per-vehicle-per-day workhour calls, so ~60-90s.
    -- pg_net defaults to a 5-second HTTP timeout and would drop the response
    -- long before the sync could finish. 180s gives it room, matching the
    -- light-pass cron (netstar-odometer-cron.sql) with extra headroom.
    timeout_milliseconds  := 180000
  );
  $$
);

-- To check it's scheduled:        select * from cron.job;
-- To see recent runs:             select * from cron.job_run_details order by start_time desc limit 10;
-- To remove it later:             select cron.unschedule('netstar-deep-resync');
