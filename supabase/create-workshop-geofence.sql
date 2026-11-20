-- =====================================================================
-- Astrea Drive — workshop geofences (auto "In workshop" from GPS)
--
-- Run once in the Supabase SQL Editor (Dashboard > SQL Editor > New query
-- > paste > Run). Safe to re-run. Requires the workshops table
-- (create-workshops.sql) and the vehicles."workshopId" column
-- (update-vehicles-workshop.sql).
--
-- Every workshop with a map location gets a geofence (150 m by default).
-- The netstar edge function's "geofence" action reads each tracked
-- vehicle's live GPS position every 15 minutes and calls
-- apply_workshop_geofence() below, which:
--
--   * ENTER — a vehicle that has stayed inside a workshop's geofence for 30
--     minutes or more (so driving past, or a quick stop, never counts) and is
--     Available or In use is set to In workshop at that workshop, and the
--     change is logged in Activity.
--   * LEAVE — once it is seen outside the geofence again, it goes back to the
--     status it had before (Available / In use), and that is logged too.
--   * MANUAL ALWAYS WINS — it only ever releases a vehicle it marked itself
--     and that is still In workshop at the same workshop. If someone changes
--     the status by hand during the visit (e.g. back to Available, or to Out
--     of service), it leaves that alone and won't re-mark it until the
--     vehicle has left and come back. Out of service vehicles are never
--     touched.
--   * A vehicle with no GPS fix that run is simply skipped.
--
-- To change a workshop's radius or switch its geofence off:
--   update public.workshops set "geofenceRadius" = 250 where id = 'wsp-kor';
--   update public.workshops set "geofenceEnabled" = false where id = 'wsp-kor';
-- =====================================================================

BEGIN;

alter table public.workshops add column if not exists "geofenceRadius"  integer not null default 150;
alter table public.workshops add column if not exists "geofenceEnabled" boolean not null default true;

-- Who set the current status: '' = a person (or never set), 'geofence' = GPS.
alter table public.vehicles add column if not exists "statusSource" text not null default '';

-- One row per vehicle currently inside a workshop geofence.
create table if not exists public.vehicle_geofence_state (
  "vehicleId"  text primary key references public.vehicles(id) on delete cascade,
  "workshopId" text not null,
  "enteredAt"  timestamptz not null default now(),  -- first seen inside
  "lastSeenAt" timestamptz not null default now(),
  "markedAt"   timestamptz,                         -- when we set In workshop
  "prevStatus" text not null default 'Available',   -- restored on leaving
  suppressed   boolean not null default false       -- someone overrode it by hand this visit
);

revoke all on table public.vehicle_geofence_state from anon;
grant select on table public.vehicle_geofence_state to authenticated;
alter table public.vehicle_geofence_state enable row level security;
drop policy if exists "approved users read geofence state" on public.vehicle_geofence_state;
create policy "approved users read geofence state" on public.vehicle_geofence_state
  for select to authenticated using (is_approved());

create or replace function public.apply_workshop_geofence(readings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r          record;
  v          record;
  w          record;
  st         record;
  v_now      timestamptz := now();
  v_dwell    constant interval := interval '30 minutes';
  v_entered  integer := 0;
  v_left     integer := 0;
  v_inside   integer := 0;
  v_results  jsonb := '[]'::jsonb;
  v_restore  text;
  v_in       boolean;
  v_has_st   boolean;
begin
  for r in
    select upper(btrim(x->>'rego')) as rego,
           (x->>'lat')::double precision as lat,
           (x->>'lng')::double precision as lng
    from jsonb_array_elements(coalesce(readings, '[]'::jsonb)) as x
  loop
    if r.rego is null or r.lat is null or r.lng is null then continue; end if;

    select id, status, "workshopId", "statusSource" into v
    from public.vehicles
    where upper(btrim(rego)) = r.rego or upper(btrim("netstarRego")) = r.rego
    limit 1 for update;
    if not found then continue; end if;

    -- Nearest enabled workshop whose geofence this position falls inside.
    select ws.id, ws.name, d.metres into w
    from public.workshops ws
    cross join lateral (
      select 2 * 6371000 * asin(sqrt(
        power(sin(radians(r.lat - ws.lat) / 2), 2) +
        cos(radians(ws.lat)) * cos(radians(r.lat)) * power(sin(radians(r.lng - ws.lng) / 2), 2)
      )) as metres
    ) d
    where ws."geofenceEnabled" and ws.lat is not null and ws.lng is not null
      and d.metres <= ws."geofenceRadius"
    order by d.metres
    limit 1;
    v_in := found;

    select * into st from public.vehicle_geofence_state where "vehicleId" = v.id;
    v_has_st := found;

    if v_in then
      v_inside := v_inside + 1;
      -- Inside a geofence. New visit (or moved to a different workshop): start the clock.
      if not v_has_st or st."workshopId" <> w.id then
        delete from public.vehicle_geofence_state where "vehicleId" = v.id;
        insert into public.vehicle_geofence_state ("vehicleId", "workshopId", "enteredAt", "lastSeenAt")
        values (v.id, w.id, v_now, v_now);
        v_results := v_results || jsonb_build_array(jsonb_build_object('vehicle', v.id, 'workshop', w.id, 'event', 'arrived', 'metres', round(w.metres)));
        continue;
      end if;

      update public.vehicle_geofence_state set "lastSeenAt" = v_now where "vehicleId" = v.id;

      -- Already marked: if someone has since changed it by hand, respect that for this visit.
      if st."markedAt" is not null then
        if not st.suppressed and (v.status <> 'In workshop' or v."workshopId" <> w.id) then
          update public.vehicle_geofence_state set suppressed = true where "vehicleId" = v.id;
          v_results := v_results || jsonb_build_array(jsonb_build_object('vehicle', v.id, 'workshop', w.id, 'event', 'overridden'));
        end if;
        continue;
      end if;

      -- Not yet marked: after 30 minutes inside, mark it In workshop (only from Available / In use).
      if v_now - st."enteredAt" >= v_dwell and v.status in ('Available', 'In use') and not st.suppressed then
        update public.vehicles
          set status = 'In workshop', "workshopId" = w.id, "statusSource" = 'geofence'
          where id = v.id;
        update public.vehicle_geofence_state
          set "markedAt" = v_now, "prevStatus" = v.status
          where "vehicleId" = v.id;
        insert into public.activity (id, ts, "vehicleId", text)
        values ('act-geo-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12), v_now, v.id,
                v.id || ' parked at ' || w.name || ' for 30+ min — marked In workshop (GPS)');
        v_entered := v_entered + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object('vehicle', v.id, 'workshop', w.id, 'event', 'marked'));
      end if;

    elsif v_has_st then
      -- Outside every geofence, and we had a visit open: close it.
      if st."markedAt" is not null and not st.suppressed
         and v.status = 'In workshop' and v."workshopId" = st."workshopId" and v."statusSource" = 'geofence' then
        v_restore := case when st."prevStatus" in ('Available', 'In use') then st."prevStatus" else 'Available' end;
        update public.vehicles
          set status = v_restore, "workshopId" = '', "statusSource" = ''
          where id = v.id;
        insert into public.activity (id, ts, "vehicleId", text)
        values ('act-geo-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12), v_now, v.id,
                v.id || ' left ' || coalesce((select name from public.workshops where id = st."workshopId"), 'the workshop') ||
                ' — back to ' || v_restore || ' (GPS)');
        v_left := v_left + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object('vehicle', v.id, 'workshop', st."workshopId", 'event', 'released'));
      end if;
      delete from public.vehicle_geofence_state where "vehicleId" = v.id;
    end if;
  end loop;

  return jsonb_build_object('marked', v_entered, 'released', v_left, 'inside', v_inside, 'results', v_results);
end;
$$;

-- Only this narrow function is callable; it cannot be used to read or write
-- anything else in the database.
revoke all on function public.apply_workshop_geofence(jsonb) from public;
grant execute on function public.apply_workshop_geofence(jsonb) to anon, authenticated;

COMMIT;
