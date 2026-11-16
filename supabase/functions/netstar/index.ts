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
//                     vehicles table (only ever increasing it), plus trip
//                     stats and daily engine hours. Body may also carry
//                     { quick: true } to skip the trip-stats/daily-hours
//                     calls and only touch odometers — used by the manual
//                     "Sync GPS data" button so it stays fast; the nightly
//                     cron job omits it and keeps refreshing everything.
// =====================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const NETSTAR_BASE = "https://fleetai-api.netstaraus.com.au";
const API_KEY = Deno.env.get("NETSTAR_API_KEY") ?? "";
const COMPANY = Deno.env.get("NETSTAR_COMPANY") ?? "Astrea";
const CONCURRENCY = 6; // how many object-status calls to run at once

// The FleetAI reference says to send a browser-style User-Agent, otherwise
// some calls are blocked/ignored when made programmatically. We attach it to
// every Netstar request through this helper.
const NETSTAR_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
function netstarHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { accept: "*/*", "x-api-key": API_KEY, "User-Agent": NETSTAR_UA, ...extra };
}

// Netstar rate-limits with a token bucket ("429 Rate limit exceeded"). The
// report calls (the many per-day ones especially) go through nsFetch, which
// spaces requests ~4/second and, on a 429, waits and retries instead of
// failing. The live-map calls stay on plain fetch so the map stays snappy.
const GAP_MS = 250;
let nextSlot = 0;
async function paced(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + GAP_MS;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}
async function nsFetch(url: string, init: RequestInit = {}, tries = 4): Promise<Response> {
  let res!: Response;
  for (let a = 0; a < tries; a++) {
    await paced();
    res = await fetch(url, init);
    if (res.status !== 429) return res;
    const ra = Number(res.headers.get("retry-after"));
    const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1500 * (a + 1);
    await res.text().catch(() => "");
    await new Promise((r) => setTimeout(r, Math.min(wait, 8000)));
  }
  return res;
}

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

// These two Netstar records currently report their Streamax hardware ID in
// vehicle_no instead of the fleet registration. Normalising here keeps live
// positions, trips and odometer sync tied to the correct Astrea vehicle.
const NETSTAR_REGO_OVERRIDES: Record<string, string> = {
  "00D2087143": "XP58JN", // AVT05
  "00D208715E": "XS34KN", // AVT06
};

async function fetchVehicles(): Promise<Device[]> {
  const res = await fetch(`${NETSTAR_BASE}/external/company-vehicles`, {
    method: "POST",
    headers: netstarHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ company_name: COMPANY, company_names: [COMPANY] }),
  });
  if (!res.ok) throw new Error(`company-vehicles ${res.status}`);
  const payload = await res.json();
  const out: Device[] = [];
  for (const branch of payload?.data?.branch ?? []) {
    for (const v of branch.vehicles ?? []) {
      const reportedRego = String(v.vehicle_no ?? "").trim();
      out.push({
        imei: String(v.imei_no ?? "").trim(),
        rego: NETSTAR_REGO_OVERRIDES[reportedRego.toUpperCase()] ?? reportedRego,
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

// Netstar durations come in two shapes: "HH:MM:SS" (e.g. work_duration
// "05:25:06") and "HH:MM" (e.g. total_idle_duration "01:33"). Return whole
// minutes, or null if it isn't a time we recognise.
function durToMinutes(s: unknown): number | null {
  const parts = String(s ?? "").trim().split(":").map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 3) return Math.round(parts[0] * 60 + parts[1] + parts[2] / 60);
  if (parts.length === 2) return Math.round(parts[0] * 60 + parts[1]);
  return null;
}

// Trip-summary totals per device over a date window. One POST covers every
// IMEI. Returns the data rows (one per device) plus Netstar's raw reply for
// diagnostics; never throws, so a bad call can't sink the rest of the sync.
async function fetchTripSummaries(
  imeis: string[],
  from: string,
  to: string,
): Promise<{ rows: Record<string, unknown>[]; raw: string }> {
  try {
    const res = await nsFetch(`${NETSTAR_BASE}/external/reports/trip-summary`, {
      method: "POST",
      headers: netstarHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        start_date_time: from,
        end_date_time: to,
        imei_nos: imeis.join(","),
        imeis,
        user_api_config_id: 0,
      }),
    });
    const text = await res.text();
    const raw = `${res.status} ${text.slice(0, 200)}`;
    if (!res.ok) return { rows: [], raw };
    let payload: { data?: Record<string, unknown>[] } = {};
    try { payload = JSON.parse(text); } catch (_e) { /* not json */ }
    return { rows: Array.isArray(payload?.data) ? payload.data : [], raw };
  } catch (e) {
    return { rows: [], raw: `error ${String((e as Error)?.message ?? e)}` };
  }
}

// "01-12-2025 03:16:07" -> { day:"2025-12-01", hm:"03:16", ms } | null.
// ms is built from the local parts via Date.UTC, so it is consistent for
// ordering and reads back the same HH:MM through toISOString on the client.
function parseNsDate(s: unknown): { day: string; hm: string; ms: number } | null {
  const m = /(\d{2})-(\d{2})-(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s ?? ""));
  if (!m) return null;
  return {
    day: `${m[3]}-${m[2]}-${m[1]}`,
    hm: `${m[4]}:${m[5]}`,
    ms: Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)),
  };
}

// Find the tracker device for a fleet vehicle by its rego or Netstar alias.
function matchDevice(devices: Device[], rego: unknown, netstarRego: unknown): Device | null {
  const keys = [rego, netstarRego].map((x) => String(x ?? "").trim().toUpperCase()).filter(Boolean);
  if (!keys.length) return null;
  return devices.find((d) => keys.includes(String(d.rego ?? "").trim().toUpperCase())) ?? null;
}

// Trip-detail for one device over a window: one row per trip. Documented
// fields (start/reach time + location + coordinate, travel_km, times, speeds,
// odometer). Returns rows + Netstar's raw reply; never throws.
async function fetchTripDetail(imei: string, from: string, to: string): Promise<{ rows: Record<string, unknown>[]; raw: string }> {
  try {
    const url = `${NETSTAR_BASE}/external/reports/trip-detail?imei=${encodeURIComponent(imei)}&start_date_time=${encodeURIComponent(from)}&end_date_time=${encodeURIComponent(to)}`;
    const res = await nsFetch(url, { headers: netstarHeaders() });
    const text = await res.text();
    const raw = `${res.status} ${text.slice(0, 200)}`;
    if (!res.ok) return { rows: [], raw };
    let payload: { data?: Record<string, unknown>[] } = {};
    try { payload = JSON.parse(text); } catch (_e) { /* not json */ }
    return { rows: Array.isArray(payload?.data) ? payload.data : [], raw };
  } catch (e) {
    return { rows: [], raw: `error ${String((e as Error)?.message ?? e)}` };
  }
}

// One trip-detail row -> the shape the app's Trips tab uses.
function tripFromRow(d: Record<string, unknown>) {
  const s = parseNsDate(d.start_time), e = parseNsDate(d.reach_time);
  return {
    day: s?.day ?? null,
    startMs: s?.ms ?? null,
    start: s?.hm ?? "", end: e?.hm ?? "",
    startLoc: d.start_location ?? "", endLoc: d.reach_location ?? "",
    startC: parseCoords(d.start_coordinate), endC: parseCoords(d.reach_coordinate),
    km: num(d.travel_km), travelMin: durToMinutes(d.travel_time), idleMin: durToMinutes(d.idle_time),
    parkMin: durToMinutes(d.park_duration), maxSpeed: num(d.max_speed), avgSpeed: num(d.avg_speed),
    startOdom: num(d.day_start_odom), endOdom: num(d.end_odom_print),
  };
}

// Travel-history (GPS breadcrumbs) for one device over a day. The report's
// response schema isn't documented, so this parses flexibly across the likely
// field names and returns a raw sample so the exact shape can be confirmed.
async function fetchTravelPath(imei: string, from: string, to: string): Promise<{ points: Array<{ lat: number; lng: number; ms: number | null; speed: number | null }>; raw: Record<string, unknown> }> {
  try {
    const url = `${NETSTAR_BASE}/external/reports/travel-history-report?imei=${encodeURIComponent(imei)}&start_date_time=${encodeURIComponent(from)}&end_date_time=${encodeURIComponent(to)}`;
    const res = await nsFetch(url, { headers: netstarHeaders() });
    const text = await res.text();
    if (!res.ok) return { points: [], raw: { status: res.status, body: text.slice(0, 200) } };
    let payload: unknown = {};
    try { payload = JSON.parse(text); } catch (_e) { return { points: [], raw: { status: res.status, body: text.slice(0, 200) } }; }
    const p = payload as Record<string, unknown>;
    const arr: Record<string, unknown>[] = Array.isArray(p?.data) ? p.data as Record<string, unknown>[]
      : Array.isArray(payload) ? payload as Record<string, unknown>[] : [];
    const pick = (o: Record<string, unknown>, keys: string[]) => {
      for (const k of keys) { if (o[k] != null && o[k] !== "") return o[k]; }
      return null;
    };
    const points: Array<{ lat: number; lng: number; ms: number | null; speed: number | null }> = [];
    for (const it of arr) {
      let c = parseCoords(pick(it, ["coordinate", "coordinates", "location_coordinate", "gps_coordinate", "latlng"]));
      if (!c) {
        const la = num(pick(it, ["latitude", "lat", "gps_lat"]));
        const ln = num(pick(it, ["longitude", "lng", "lon", "gps_lng", "gps_lon"]));
        if (la != null && ln != null && !(la === 0 && ln === 0)) c = { lat: la, lng: ln };
      }
      if (!c) continue;
      const t = parseNsDate(pick(it, ["time", "datetime", "date_time", "gps_time", "timestamp", "event_time", "received_time", "location_time", "device_time"]));
      points.push({ lat: c.lat, lng: c.lng, ms: t?.ms ?? null, speed: num(pick(it, ["speed", "gps_speed", "velocity"])) });
    }
    points.sort((a, b) => (a.ms ?? 0) - (b.ms ?? 0));
    return { points, raw: { status: res.status, count: arr.length, keys: arr[0] ? Object.keys(arr[0]) : [], sample: arr[0] ? JSON.stringify(arr[0]).slice(0, 400) : "" } };
  } catch (e) {
    return { points: [], raw: { error: String((e as Error)?.message ?? e) } };
  }
}

// Last `count` calendar days in Sydney time, newest first, each with the
// day key (YYYY-MM-DD) and Netstar-formatted start/end of that day.
function sydneyDays(count: number): Array<{ key: string; from: string; to: string }> {
  const out: Array<{ key: string; from: string; to: string }> = [];
  const seen = new Set<string>();
  const now = Date.now();
  for (let i = 0; i < count + 2 && out.length < count; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
      timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(now - i * 86400000).map((x) => [x.type, x.value]));
    const key = `${p.year}-${p.month}-${p.day}`;
    if (seen.has(key)) continue; // DST edge: same day twice
    seen.add(key);
    out.push({ key, from: `${p.day}-${p.month}-${p.year} 00:00:00`, to: `${p.day}-${p.month}-${p.year} 23:59:59` });
  }
  return out;
}

// One device, one day of engine work hours. Returns { raw } always (for
// diagnostics) plus hours/distance only when Netstar actually returned a row.
async function fetchWorkHoursDay(imei: string, from: string, to: string) {
  try {
    const url = `${NETSTAR_BASE}/external/reports/workhour-report?imei=${
      encodeURIComponent(imei)
    }&start_date_time=${encodeURIComponent(from)}&end_date_time=${encodeURIComponent(to)}`;
    const res = await nsFetch(url, { headers: netstarHeaders() });
    const text = await res.text();
    const raw = `${res.status} ${text.slice(0, 240)}`;
    if (!res.ok) return { raw, hours: null as number | null, distance: null as number | null };
    let payload: { data?: Array<Record<string, unknown>> } = {};
    try { payload = JSON.parse(text); } catch (_e) { /* not json */ }
    const d = Array.isArray(payload?.data) ? payload.data[0] : null;
    if (!d) return { raw, hours: null as number | null, distance: null as number | null };
    return { raw, hours: parseWorkHour(d.work_hour), distance: num(d.distance) };
  } catch (e) {
    return { raw: `error ${String((e as Error)?.message ?? e)}`, hours: null as number | null, distance: null as number | null };
  }
}

// Diagnostic: when the reports come back empty (and not just rate-limited),
// try the plausible request shapes against ONE tracker and record Netstar's
// reply to each, so we can see which shape it actually accepts.
async function probeReports(imei: string, from: string, to: string) {
  const q = (o: Record<string, string>) =>
    Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  const base = { start_date_time: from, end_date_time: to };
  const tests: Array<[string, string, string, unknown?]> = [
    ["GET workhour imei", "GET", `/external/reports/workhour-report?${q({ ...base, imei })}`],
    ["GET workhour imei_nos", "GET", `/external/reports/workhour-report?${q({ ...base, imei_nos: imei })}`],
    ["GET workhour imeis", "GET", `/external/reports/workhour-report?${q({ ...base, imeis: imei })}`],
    ["GET workhour imei+imeis", "GET", `/external/reports/workhour-report?${q({ ...base, imei, imeis: imei })}`],
    ["GET workhour imei+config0", "GET", `/external/reports/workhour-report?${q({ ...base, imei, user_api_config_id: "0" })}`],
    ["POST workhour imei_nos+imeis", "POST", "/external/reports/workhour-report", { ...base, imei_nos: imei, imeis: [imei] }],
    ["POST workhour imei_nos only", "POST", "/external/reports/workhour-report", { ...base, imei_nos: imei }],
    ["POST workhour imei_nos+imeis+config0", "POST", "/external/reports/workhour-report", { ...base, imei_nos: imei, imeis: [imei], user_api_config_id: 0 }],
    ["GET trip-summary imei", "GET", `/external/reports/trip-summary?${q({ ...base, imei })}`],
    ["POST trip-summary imei_nos", "POST", "/external/reports/trip-summary", { ...base, imei_nos: imei }],
    ["GET object-status (control)", "GET", `/external/reports/object-status?${q({ imei })}`],
  ];
  const out: Record<string, string> = {};
  for (const [name, method, path, body] of tests) {
    try {
      const res = await nsFetch(`${NETSTAR_BASE}${path}`, {
        method,
        headers: netstarHeaders(body ? { "Content-Type": "application/json" } : {}),
        body: body ? JSON.stringify(body) : undefined,
      });
      out[name] = `${res.status} ${(await res.text()).slice(0, 150)}`;
    } catch (e) {
      out[name] = `error ${String((e as Error)?.message ?? e)}`;
    }
  }
  return out;
}

async function fetchStatus(imei: string) {
  const url = `${NETSTAR_BASE}/external/reports/object-status?imei=${
    encodeURIComponent(imei)
  }`;
  const res = await fetch(url, { headers: netstarHeaders() });
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
 * with the ordinary anon key. Also refreshes trip stats and engine hours.
 *
 * depth 'recent' (default): pulls only the last RECENT_DAYS days of daily
 * engine hours — a handful of calls per vehicle, safely inside Netstar's rate
 * limit even run back-to-back. Used for the nightly cron.
 * depth 'full': pulls the full 30-day window (one call per device per day —
 * a few hundred calls, ~60-90s paced). Used for the weekly deep-resync cron,
 * or a manual full resync, to backfill any days a light run never reaches.
 * Either way, the 30-day totals shown in the app come from everything ever
 * stored in vehicle_work_hours_daily, not just what this run fetched — so a
 * light run never makes the numbers look thinner than they really are.
 *
 * quick: skips trip-summary and daily engine-hours entirely — odometers
 * only. Used by the manual "Sync GPS data" button, so clicking it doesn't
 * sit through dozens of paced per-vehicle-per-day calls someone is just
 * waiting on; the nightly cron (quick=false) still refreshes those every
 * night regardless of whether anyone clicks the button.
 */
async function syncOdometers(depth: "recent" | "full" = "recent", quick = false) {
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

  // ---- Trip-summary stats (ONE call for the whole fleet, so it goes first
  // while Netstar's rate allowance is fullest) ----------------------------
  // distance, working days, engine/idle/stop time, trips, speeds, overspeed.
  // Matched back to a rego by imei, then applied by record_trip_stats.
  // Skipped entirely on a quick run — see the "quick" doc comment above.
  let tripStatsRecorded: number | null = 0;
  const tripStatsDebug: Record<string, unknown> = {};
  if (quick) {
    tripStatsRecorded = null;
    tripStatsDebug.skipped = "quick sync — odometers only; this refreshes via the nightly sync";
  } else try {
    const WINDOW_DAYS = 30;
    const now = Date.now();
    const from = netstarDate(now - WINDOW_DAYS * 86400000);
    const to = netstarDate(now);
    tripStatsDebug.window = [from, to];
    const imeis = devices.map((v) => v.imei).filter(Boolean);
    const { rows: summaries, raw } = await fetchTripSummaries(imeis, from, to);
    tripStatsDebug.returned = summaries.length;
    tripStatsDebug.firstResponse = raw;
    const byImei = new Map(devices.map((v) => [String(v.imei), v]));
    const tripRows: Array<Record<string, unknown>> = [];
    for (const d of summaries) {
      const dev = byImei.get(String((d as Record<string, unknown>).imei_no ?? ""));
      const rego = dev ? dev.rego : String((d as Record<string, unknown>).vehicle_info ?? "").trim();
      if (!rego) continue;
      tripRows.push({
        rego,
        runningKm: num(d.total_running_km),
        workingDays: num(d.working_days),
        workMinutes: durToMinutes(d.work_duration),
        idleMinutes: durToMinutes(d.total_idle_duration),
        stopMinutes: durToMinutes(d.total_stop_duration),
        trips: num(d.no_of_trip),
        avgSpeed: num(d.avg_speed),
        maxSpeed: num(d.max_speed),
        overspeed: num(d.overspeed),
        days: WINDOW_DAYS,
      });
    }
    tripStatsDebug.rows = tripRows.length;
    if (tripRows.length) {
      const { data: tData, error: tErr } = await db.rpc("record_trip_stats", { rows: tripRows });
      if (tErr) tripStatsDebug.rpcError = tErr.message;
      else tripStatsRecorded = Number(tData) || tripRows.length;
    }
  } catch (e) {
    tripStatsDebug.error = String((e as Error)?.message ?? e);
  }

  // ---- Daily engine hours, last 30 days (feeds the vehicle "Engine hours"
  // chart AND the 30-day total). One workhour-report call per device per day,
  // newest days first so a partial run still fills the most recent week. Calls
  // are paced and retried on 429 (see nsFetch) and stop at a time budget.
  // Skipped entirely on a quick run — see the "quick" doc comment above.
  const RECENT_DAYS = 3, FULL_DAYS = 30;
  let dailyRecorded: number | null = 0;
  let workHoursRecorded: number | null = 0;
  const dailyDebug: Record<string, unknown> = { depth };
  const workHoursDebug: Record<string, unknown> = {};
  if (quick) {
    dailyRecorded = null;
    workHoursRecorded = null;
    dailyDebug.skipped = "quick sync — odometers only; this refreshes via the nightly sync";
  } else try {
    const days = sydneyDays(depth === "full" ? FULL_DAYS : RECENT_DAYS);
    const tasks: Array<{ rego: string; imei: string; day: { key: string; from: string; to: string } }> = [];
    for (const day of days) for (const v of devices) tasks.push({ rego: v.rego, imei: v.imei, day });
    dailyDebug.calls = tasks.length;
    const deadline = Date.now() + 90000; // stop starting new calls after ~90s
    let started = 0, skipped = 0, rateLimited = 0;
    let firstRaw = "", firstError = "";
    const dayRows: Array<{ rego: string; day: string; hours: number; distance: number | null }> = [];
    await mapLimit(tasks, 2, async (t) => {
      if (Date.now() > deadline) { skipped++; return; }
      started++;
      const r = await fetchWorkHoursDay(t.imei, t.day.from, t.day.to);
      if (!firstRaw) firstRaw = r.raw;
      if (r.raw.startsWith("429")) rateLimited++;
      else if (!firstError && !r.raw.startsWith("200")) firstError = r.raw;
      if (r.hours != null) {
        dayRows.push({
          rego: t.rego,
          day: t.day.key,
          hours: Math.round(r.hours * 100) / 100,
          distance: r.distance != null ? Math.round(r.distance) : null,
        });
      }
    });
    dailyDebug.withData = dayRows.length;
    dailyDebug.skippedForTime = skipped;
    dailyDebug.rateLimited = rateLimited;
    dailyDebug.firstResponse = firstRaw;
    dailyDebug.firstError = firstError; // first non-200, non-429 reply (e.g. the 400)
    // Nothing came back and it wasn't mainly throttling: test request shapes.
    if (!dayRows.length && devices.length && rateLimited < started / 2) {
      const y = days[1] || days[0]; // yesterday, a full day
      dailyDebug.probeImei = devices[0].imei;
      dailyDebug.probe = await probeReports(devices[0].imei, y.from, y.to);
    }
    for (let i = 0; i < dayRows.length; i += 400) {
      const { data: dData, error: dErr } = await db.rpc("record_work_hours_daily", { rows: dayRows.slice(i, i + 400) });
      if (dErr) { dailyDebug.rpcError = dErr.message; break; }
      dailyRecorded = (dailyRecorded ?? 0) + (Number(dData) || 0);
    }

    // Roll the 30-day "hrs/week" total up from EVERY day ever stored, not
    // just what this run fetched — so a light 'recent' run never makes the
    // total look thinner than it really is. See refresh-work-hours-totals.sql.
    const { data: whData, error: whErr } = await db.rpc("refresh_work_hours_totals");
    if (whErr) workHoursDebug.rpcError = whErr.message;
    else workHoursRecorded = Number(whData) || 0;
  } catch (e) {
    dailyDebug.error = String((e as Error)?.message ?? e);
  }

  return json({
    updated: (data && data.updated) ?? 0,
    verified: (data && data.verified) ?? 0,
    results: data?.results ?? null,
    added: (data && data.added) ?? 0,
    readings: readings.length,
    workHoursRecorded,
    workHoursDebug,
    dailyRecorded,
    dailyDebug,
    tripStatsRecorded,
    tripStatsDebug,
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

    if (action === "sync-odometers") {
      return await syncOdometers(body.depth === "full" ? "full" : "recent", !!body.quick);
    }

    // Trips for one vehicle over the last N days, grouped by day (Trips tab).
    if (action === "trips") {
      const devices = await fetchVehicles();
      const dev = matchDevice(devices, body.rego, body.netstarRego);
      if (!dev) return json({ error: "No Netstar tracker for this vehicle", days: [] });
      // trip-detail is capped at a 10-day window by Netstar.
      const daysBack = Math.min(Math.max(Number(body.days) || 10, 1), 10);
      const now = Date.now();
      const { rows, raw } = await fetchTripDetail(dev.imei, netstarDate(now - daysBack * 86400000), netstarDate(now));
      const trips = rows.map(tripFromRow).filter((t) => t.day);
      const byDay = new Map<string, ReturnType<typeof tripFromRow>[]>();
      for (const t of trips) { const k = t.day as string; if (!byDay.has(k)) byDay.set(k, []); byDay.get(k)!.push(t); }
      const days = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([day, ts]) => {
        ts.sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
        const sum = (f: keyof ReturnType<typeof tripFromRow>) => ts.reduce((s, x) => s + (Number(x[f]) || 0), 0);
        return {
          date: day,
          trips: ts,
          totals: {
            trips: ts.length,
            km: Math.round(sum("km")),
            driveMin: sum("travelMin"),
            idleMin: sum("idleMin"),
            maxSpeed: Math.max(0, ...ts.map((x) => x.maxSpeed || 0)),
          },
        };
      });
      return json({ imei: dev.imei, rego: dev.rego, days, raw });
    }

    // GPS breadcrumb path for one vehicle on one day (the replay map).
    if (action === "trip-path") {
      const devices = await fetchVehicles();
      const dev = matchDevice(devices, body.rego, body.netstarRego);
      if (!dev) return json({ error: "No Netstar tracker for this vehicle", points: [] });
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(body.date || ""));
      if (!m) return json({ error: "bad date", points: [] });
      const from = `${m[3]}-${m[2]}-${m[1]} 00:00:00`, to = `${m[3]}-${m[2]}-${m[1]} 23:59:59`;
      const { points, raw } = await fetchTravelPath(dev.imei, from, to);
      return json({ points, source: points.length ? "travel-history" : "none", raw });
    }

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
