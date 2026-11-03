-- =====================================================================
-- Astrea Drive — odometer sync database function
--
-- Run once in the Supabase SQL Editor (Dashboard > SQL Editor > New query
-- > paste > Run). Requires the odometerSource / odometerSyncedAt columns
-- from update-vehicles-odometer-sync.sql to exist first.
--
-- The netstar edge function fetches odometers from Netstar and calls this
-- function with an array of { rego, km } readings. Because it is SECURITY
-- DEFINER (runs as its owner), the edge function needs no service-role key
-- to write — and this function can ONLY touch odometers, nothing else.
--
-- Rules enforced here:
--   * a reading is applied only when higher than the stored odometer
--     (odometers never go backwards; a manual reading is never clobbered)
--   * zero / missing readings and unmatched regos are ignored
--   * a single summary line is written to the activity feed
-- =====================================================================

create or replace function public.sync_odometers_from_telematics(readings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r        record;
  v_old    integer;
  v_updated integer := 0;
  v_added  bigint  := 0;
  v_now    timestamptz := now();
begin
  for r in
    select (x->>'rego') as rego, (x->>'km')::integer as km
    from jsonb_array_elements(coalesce(readings, '[]'::jsonb)) as x
  loop
    if r.rego is null or r.km is null or r.km <= 0 then
      continue;
    end if;

    select odometer into v_old
    from public.vehicles
    where upper(rego) = upper(r.rego)
    limit 1;

    if not found or r.km <= coalesce(v_old, 0) then
      continue;
    end if;

    update public.vehicles
      set odometer = r.km,
          "odometerSource"   = 'telematics',
          "odometerSyncedAt" = v_now
      where upper(rego) = upper(r.rego);

    v_updated := v_updated + 1;
    v_added   := v_added + (r.km - coalesce(v_old, 0));
  end loop;

  if v_updated > 0 then
    insert into public.activity (id, ts, "vehicleId", text)
    values (
      'act-odo-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
      v_now, '',
      'Odometers synced from telematics — ' || v_updated || ' vehicle' ||
      case when v_updated = 1 then '' else 's' end ||
      ' updated (+' || to_char(v_added, 'FM999,999,999') || ' km)'
    );
  end if;

  return jsonb_build_object('updated', v_updated, 'added', v_added);
end;
$$;

-- Only this narrow function is callable; it cannot be used to read or write
-- anything else in the database.
revoke all on function public.sync_odometers_from_telematics(jsonb) from public;
grant execute on function public.sync_odometers_from_telematics(jsonb) to anon, authenticated;
