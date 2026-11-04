# Live fleet activity

## Activate reports

The published dashboard can already use the existing Netstar `live` action.
To enable its new report panel, replace the **entire** `index.ts` in
Supabase → Edge Functions → netstar → Code with
`supabase/functions/netstar/index.ts`, then deploy updates. Keep existing
secrets and authentication settings. No SQL migration is needed for this change.

Refresh Astrea Drive and open the dashboard. It requests GPS and reports
automatically. The older function is detected and shows a deployment message
instead of interpreting live positions as reports.

## What is included

- The schedule, planned booking chart and activity panel use all owned vac trucks.
  Hired trucks remain in the separate hired fleet and overall fleet totals.
- GPS activity appears beside today's booking status, with location, timestamp,
  a tracker link, and a prompt when moving/ignition-on activity has no current booking.
- Moving, stationary ignition-on, parked, stale and unknown states are separate.
  The dashboard flags readings older than 15 minutes; it does not label them as
  current activity. The existing Tracker's older offline threshold is unchanged.
- Work hours, ignition hours, idle hours and trip distance are fetched from
  Netstar's summary endpoints for the selected day, 7 days, or 30 days.
- GPS refreshes every minute and reports every ten minutes while the dashboard
  is visible. Refresh timers survive dashboard redraws via shared request timestamps;
  requests stop when leaving the dashboard or hiding the page. No unattended
  background collection or database history is introduced.
- Utilisation compares **reported work hours** with a user-entered available-hours
  budget per truck for the whole selected period. There is no assumed 8-hour shift.
  Fleet percentage requires a usable work-hours reading for every included truck.
  Partial totals are labelled and missing data is never treated as zero.

## Interpretation and limits

Netstar publishes request schemas but not response schemas for these reports.
Live account responses still need verification after deployment. The adapter only
accepts one matching summary row per vehicle, an unambiguous registration/IMEI, and
explicit duration/distance units. A numeric `work_hours` field is in hours; a
`work_time` value needs units or `HH:MM:SS`. Plain numeric durations without units,
duplicate/grouped rows, unknown fields, and hours exceeding the requested period
remain unavailable. A report failure does not hide successful reports or GPS data.

Each report has an expandable source response inside the dashboard. If a vehicle
shows a dash, inspect its reason via the cell tooltip and source report. Confirm
Netstar's field definitions before extending the adapter. Source previews are
bounded to avoid rendering very large responses.

Work hours are not assumed to be lifetime engine-meter readings. This feature
does **not** update the vehicle's engine-hour meter or service thresholds.
Stationary ignition-on or reported idle time is not called wasted time: vac trucks
can work while stationary. Productive pump/PTO hours require verified sensor data.
Fetch time is shown separately from the GPS device's last-report time; report
freshness and access depend on Netstar and the account/device configuration.

Report requests are read-only. The proxy keeps the API key server-side, uses fixed
endpoints, validates a maximum 31-day range, and resolves IMEIs against the company's
vehicle list. Location/report caching is bounded, in memory only, and cleared on
sign-out/account change. The new action does not alter the existing odometer sync.

## Validation

`node --test tests/telematics.test.cjs` covers DST-aware GPS timestamps, freshness,
ambiguous units and matches, duplicate records, range validation, company scope,
report error isolation, request deduplication and old proxy detection. Browser QA
uses synthetic data to exercise the actual dashboard at desktop and mobile sizes,
including booking groups, failures, date changes, utilisation and timer cleanup.
