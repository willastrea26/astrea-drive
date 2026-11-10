// =====================================================================
// Astrea Drive — Netstar telematics proxy (Supabase Edge Function)
//
// Holds the Netstar API key server-side (never reaches the browser) and
// exposes the two endpoints the app needs, matched to Astrea Drive regos.
//
// Secrets required (Dashboard > Edge Functions > Secrets):
//   NETSTAR_API_KEY   the x-api-key value Netstar issued
//   NETSTAR_COMPANY   optional, defaults to "Astrea"
//
// Called from the browser with the signed-in user's session, e.g.
//   AD.sb.functions.invoke('netstar', { body: { action: 'live' } })
// Supabase verifies the user's JWT at the gateway before this runs, so
// only signed-in users can reach it.
//
// Actions (POST body { action }):
//   'live'            (default) vehicle list + latest position, joined by
//                     imei, one row per device keyed by rego — map data
//   'vehicles'        the flat device list only (imei / rego / name / branch)
//   'positions'       { imeis: [...] } latest status for specific imeis
//   'sync-odometers'  write each matched vehicle's latest odometer into the
//                     vehicles table (only ever increasing it). Used by the
//                     "Sync from GPS" button and the nightly cron job.
// =====================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const NETSTAR_BASE = "https://fleetai-api.netstaraus.com.au";
const API_KEY = Deno.env.get("NETSTAR_API_KEY") ?? "";
const COMPANY = Deno.env.get("NETSTAR_COMPANY") ?? "Astrea";
const CONCURRENCY = 6; // how many object-status calls to run at once

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// "3,700.43" / "35" / "--" -> number | null
function num(v: unknown): number | null {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

// "(-27.319184,152.984486)" -> { lat, lng } | null
function parseCoords(s: unknown): { lat: number; lng: number } | null {
  if (typeof s !== "string") return null;
  const m = s.match(/(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/);
  if (!m) return null;
  const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null; // "no fix yet" sentinel
  return { lat, lng };
}

interface Device {
  imei: string;
  rego: string;
  deviceName: string;
  deviceModel: string;
  branch: string;
}

async function fetchVehicles(): Promise<Device[]> {
  const res = await fetch(`${NETSTAR_BASE}/external/company-vehicles`, {
    method: "POST",
    headers: {
      accept: "*/*",
      "x-api-key": API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ company_name: COMPANY, company_names: [COMPANY] }),
  });
  if (!res.ok) throw new Error(`company-vehicles ${res.status}`);
  const payload = await res.json();
  const out: Device[] = [];
  for (const branch of payload?.data?.branch ?? []) {
    for (const v of branch.vehicles ?? []) {
      out.push({
        imei: String(v.imei_no ?? "").trim(),
        rego: String(v.vehicle_no ?? "").trim(),
        deviceName: v.device_name ?? "",
        deviceModel: v.device_model ?? "",
        branch: branch.branch_name ?? "",
      });
    }
  }
  return out;
}

// Netstar wants dates as "dd-MM-yyyy HH:mm:ss" in Australia/Sydney time.
function netstarDate(ms: number): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(ms).map((x) => [x.type, x.value]));
  return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}:${p.second}`;
}

// "22:45:09" -> 22.7525 (decimal hours) | null
function parseWorkHour(s: unknown): number | null {
  const m = /^(\d+):(\d{2}):(\d{2})/.exec(String(s ?? ""));
  if (!m) return null;
  return Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600;
}

// Engine work hours + distance for one device over a date window.
// Never throws — a slow or failed call returns null so one bad device
// can't sink the whole batch.
async function fetchWorkHours(imei: string, from: string, to: string) {
  try {
    const url = `${NETSTAR_BASE}/external/reports/workhour-report?imei=${
      encodeURIComponent(imei)
    }&start_date_time=${encodeURIComponent(from)}&end_date_time=${encodeURIComponent(to)}`;
    const res = await fetch(url, {
      headers: { accept: "*/*", "x-api-key": API_KEY },
    });
    if (!res.ok) return null;
    const payload = await res.json();
    const d = Array.isArray(payload?.data) ? payload.data[0] : null;
    if (!d) return null;
    return { hours: parseWorkHour(d.work_hour), distance: num(d.distance) };
  } catch (_e) {
    return null;
  }
}

async function fetchStatus(imei: string) {
  const url = `${NETSTAR_BASE}/external/reports/object-status?imei=${
    encodeURIComponent(imei)
  }`;
  const res = await fetch(url, {
    headers: { accept: "*/*", "x-api-key": API_KEY },
  });
  if (!res.ok) return null;
  const payload = await res.json();
  const d = Array.isArray(payload?.data) ? payload.data[0] : null;
  if (!d) return null;
  const coords = parseCoords(d.coordinates);
  return {
    imei,
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
    location: d.location ?? "",
    city: d.city === "--" ? "" : (d.city ?? ""),
    speed: num(d.speed),
    ignition: d.ignition_status ?? "",
    gps: d.gps_status ?? "",
    lastData: d.last_data ?? "",
    statusSince: d.status_since ?? "",
    vehicleMode: d.vehicle_mode ?? "",
    driver: d.driver && d.driver !== "No Driver Found" ? d.driver : "",
    odometerYesterday: num(d.yesterday_odometer),
    installedOdometer: num(d.installed_odometer),
  };
}

// Run fn over items with at most `limit` in flight at once.
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (i < items.length) {
        const idx = i++;
        results[idx] = await fn(items[idx]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/**
 * Collect each matched vehicle's latest telematics odometer and hand the
 * readings to the sync_odometers_from_telematics() database function, which
 * applies them (only ever increasing) and logs a summary. That function is
 * SECURITY DEFINER, so no service-role key is needed here — this calls it
 * with the ordinary anon key.
 */
async function syncOdometers() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ??
    "sb_publishable_hInlEU8CHjlKIiMtAz4t1g_qggctjTA";
  if (!supabaseUrl) return json({ error: "Supabase URL unavailable" }, 500);
  const db = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Latest odometer per device, matched to fleet by rego.
  const devices = (await fetchVehicles()).filter((v) => v.imei);
  const statuses = await mapLimit(devices, CONCURRENCY, (v) => fetchStatus(v.imei));
  const readings: Array<{ rego: string; km: number | null }> = [];
  devices.forEach((v, i) => {
    const km = statuses[i]?.odometerYesterday;
    readings.push({ rego: v.rego, km: km != null && km > 0 ? Math.round(km) : null });
  });

  const { data, error } = await db.rpc("sync_odometers_from_telematics", { readings });
  if (error) throw error;

  // Also refresh each vehicle's engine work hours over the last 30 days, so
  // utilisation can be measured in hours (right for stationary vac-truck work).
  let workHoursRecorded = 0;
  const workHoursDebug: Record<string, unknown> = {};
  try {
    const WINDOW_DAYS = 30;
    const now = Date.now();
    const from = netstarDate(now - WINDOW_DAYS * 86400000);
    const to = netstarDate(now);
    workHoursDebug.window = [from, to];
    const wh = await mapLimit(devices, 3, (v) => fetchWorkHours(v.imei, from, to));
    workHoursDebug.fetched = wh.filter((w) => w && w.hours != null).length;
    const workRows: Array<{ rego: string; hours: number; distance: number | null; days: number }> = [];
    devices.forEach((v, i) => {
      const w = wh[i];
      if (w && w.hours != null && w.hours > 0) {
        workRows.push({
          rego: v.rego,
          hours: Math.round(w.hours * 100) / 100,
          distance: w.distance != null ? Math.round(w.distance) : null,
          days: WINDOW_DAYS,
        });
      }
    });
    workHoursDebug.rows = workRows.length;
    if (workRows.length) {
      const { data: whData, error: whErr } = await db.rpc("record_work_hours", { rows: workRows });
      if (whErr) workHoursDebug.rpcError = whErr.message;
      else workHoursRecorded = Number(whData) || workRows.length;
    }
  } catch (e) {
    workHoursDebug.error = String((e as Error)?.message ?? e);
  }

  return json({
    updated: (data && data.updated) ?? 0,
    verified: (data && data.verified) ?? 0,
    results: data?.results ?? null,
    added: (data && data.added) ?? 0,
    readings: readings.length,
    workHoursRecorded,
    workHoursDebug,
    syncedAt: new Date().toISOString(),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!API_KEY) return json({ error: "NETSTAR_API_KEY secret not set" }, 500);

  try {
    const body = req.method === "POST"
      ? await req.json().catch(() => ({}))
      : {};
    const action = body.action ?? "live";

    if (action === "vehicles") {
      return json({ vehicles: await fetchVehicles() });
    }

    if (action === "positions") {
      const imeis: string[] = Array.isArray(body.imeis) ? body.imeis : [];
      const positions = (await mapLimit(imeis, CONCURRENCY, fetchStatus))
        .filter(Boolean);
      return json({ positions });
    }

    if (action === "sync-odometers") return await syncOdometers();

    // default: live — list + status joined, one row per device, keyed by rego
    const vehicles = await fetchVehicles();
    const withImei = vehicles.filter((v) => v.imei);
    const statuses = await mapLimit(
      withImei,
      CONCURRENCY,
      (v) => fetchStatus(v.imei),
    );
    const byImei = new Map(
      statuses.filter(Boolean).map((s) => [s!.imei, s!]),
    );
    const positions = vehicles.map((v) => {
      const s = byImei.get(v.imei);
      return {
        ...v,
        ...(s ?? {}),
        hasFix: !!s && s.lat != null && s.lng != null,
      };
    });
    return json({
      positions,
      count: positions.length,
      located: positions.filter((p) => p.hasFix).length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 502);
  }
});
