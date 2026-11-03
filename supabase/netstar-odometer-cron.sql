-- =====================================================================
-- Astrea Drive — nightly odometer sync (scheduled job)
--
-- Runs the netstar edge function's "sync-odometers" action once a night so
-- vehicle odometers stay current without anyone pressing the button.
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
-- (Dashboard > Settings > API > service_role). Do NOT commit the real key
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
    url     := 'https://ysczookfayziqsnegzjc.supabase.co/functions/v1/netstar',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <PASTE_KEY>'
    ),
    body    := jsonb_build_object('action', 'sync-odometers')
  );
  $$
);

-- To check it's scheduled:        select * from cron.job;
-- To see recent runs:             select * from cron.job_run_details order by start_time desc limit 10;
-- To remove it later:             select cron.unschedule('netstar-odometer-sync');
