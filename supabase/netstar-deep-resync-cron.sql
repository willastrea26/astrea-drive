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
-- (Dashboard > Settings > API > service_role). Do NOT commit the real key
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
    url     := 'https://ysczookfayziqsnegzjc.supabase.co/functions/v1/netstar',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <PASTE_KEY>'
    ),
    body    := jsonb_build_object('action', 'sync-odometers', 'depth', 'full')
  );
  $$
);

-- To check it's scheduled:        select * from cron.job;
-- To see recent runs:             select * from cron.job_run_details order by start_time desc limit 10;
-- To remove it later:             select cron.unschedule('netstar-deep-resync');
