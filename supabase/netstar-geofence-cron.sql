-- =====================================================================
-- Astrea Drive — workshop geofence check (scheduled job), every 15 minutes
--
-- Calls the netstar edge function's "geofence" action, which reads each
-- tracker's live position and marks vehicles In workshop / back to
-- Available (see create-workshop-geofence.sql — run that first, and deploy
-- the updated netstar function).
--
-- EASIEST WAY (recommended): use the dashboard, no SQL needed.
--   Dashboard > Integrations > Cron  (or Database > Cron Jobs)
--   > Create a new job
--     Name:     netstar-geofence
--     Schedule: */15 * * * *        (every 15 minutes)
--     Type:     Supabase Edge Function  ->  netstar
--     Method:   POST
--     Body:     {"action":"geofence"}
--   The dashboard wires the authorization for you. Save and you're done.
--
-- SQL ALTERNATIVE: paste this into the SQL Editor. Replace <PASTE_KEY> with
-- the project's legacy service_role key (the long "eyJ..." JWT — Dashboard >
-- Project Settings > API Keys > "Legacy API keys"). The newer "sb_secret_..."
-- keys are rejected by the gateway here. Do NOT commit the real key anywhere.
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Re-running? Remove the old job first so it isn't scheduled twice.
select cron.unschedule('netstar-geofence')
where exists (select 1 from cron.job where jobname = 'netstar-geofence');

select cron.schedule(
  'netstar-geofence',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://ysczookfayziqsnegzjc.supabase.co/functions/v1/netstar',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <PASTE_KEY>'
    ),
    body    := jsonb_build_object('action', 'geofence')
  );
  $$
);

-- To check it's scheduled:        select * from cron.job;
-- To see recent runs:             select * from cron.job_run_details order by start_time desc limit 10;
-- To see who is inside a geofence right now:
--   select * from public.vehicle_geofence_state;
-- To remove it later:             select cron.unschedule('netstar-geofence');
