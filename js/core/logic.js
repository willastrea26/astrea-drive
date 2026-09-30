/*
 * Business rules shared by all screens (no DOM code here).
 */
window.AD = window.AD || {};

AD.logic = (function () {
  const T = AD.time;
  const S = () => AD.store;

  // ---------- Fleet / maintenance ----------
  const SOON_DAYS = 30;
  const SOON_KM = 1000;

  /** 'overdue' | 'soon' | 'ok' with a reason string. */
  function serviceState(v) {
    const today = T.todayKey();
    const daysLeft = T.daysBetween(today, v.nextServiceDate);
    const kmLeft = v.nextServiceKm - v.odometer;
    if (daysLeft < 0 || kmLeft <= 0) {
      const why = daysLeft < 0 ? `${-daysLeft} day${daysLeft === -1 ? '' : 's'} overdue` : `${fmtKm(-kmLeft)} over`;
      return { state: 'overdue', daysLeft, kmLeft, label: 'Overdue', why };
    }
    if (daysLeft <= SOON_DAYS || kmLeft <= SOON_KM) {
      const why = daysLeft <= SOON_DAYS ? (daysLeft === 0 ? 'Due today' : `Due in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`) : `${fmtKm(kmLeft)} to go`;
      return { state: 'soon', daysLeft, kmLeft, label: 'Due soon', why };
    }
    return { state: 'ok', daysLeft, kmLeft, label: 'OK', why: `In ${daysLeft} days` };
  }

  function regoState(v) {
    const d = T.daysBetween(T.todayKey(), v.regoExpiry);
    if (d < 0) return { state: 'overdue', days: d, label: 'Expired', why: `Expired ${-d} day${d === -1 ? '' : 's'} ago` };
    if (d <= 60) return { state: 'soon', days: d, label: 'Renewal due', why: d === 0 ? 'Expires today' : `Expires in ${d} day${d === 1 ? '' : 's'}` };
    return { state: 'ok', days: d, label: 'Current', why: `${d} days left` };
  }

  /**
   * One rule for signal colour everywhere: 'red' when overdue/expired,
   * 'amber' when within 14 days (or 500 km), otherwise '' (no signal colour).
   */
  const URGENT_DAYS = 14, URGENT_KM = 500;
  function attentionTone(state, days, km = Infinity) {
    if (state === 'overdue') return 'red';
    if (state === 'soon' && (days <= URGENT_DAYS || km <= URGENT_KM)) return 'amber';
    return '';
  }

  function openDefects(vehicleId) {
    return S().all('defects').filter((d) => d.status !== 'Resolved' && (!vehicleId || d.vehicleId === vehicleId));
  }

  function fmtKm(n) { return Math.round(n).toLocaleString('en-AU') + ' km'; }
  function fmtAUD(n) { return Number(n || 0).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' }); }

  function driverName(id) {
    const d = id && S().get('drivers', id);
    return d ? d.name : '';
  }

  // ---------- Scheduling ----------
  const vacTrucks = () => S().all('vehicles').filter((v) => v.type === 'Vac truck').sort((a, b) => a.id.localeCompare(b.id));

  const ms = (iso) => Date.parse(iso);

  /** Active = not cancelled. Interval is [start, end): a booking ending at 12:00 does not cover 12:00. */
  const counts = (b) => b.status !== 'cancelled';

  function bookingsFor(truckId) {
    return S().all('bookings').filter((b) => b.truckId === truckId).sort((a, b) => ms(a.start) - ms(b.start));
  }

  function activeAt(truckId, t) {
    return bookingsFor(truckId).filter((b) => counts(b) && ms(b.start) <= t && t < ms(b.end));
  }

  /** Overlapping, non-cancelled bookings for the same truck as `draft` (excluding itself). */
  function overlaps(draft) {
    if (!draft.truckId || draft.status === 'cancelled') return [];
    const s = ms(draft.start), e = ms(draft.end);
    if (!(e > s)) return [];
    return bookingsFor(draft.truckId).filter((b) => b.id !== draft.id && counts(b) && ms(b.start) < e && s < ms(b.end));
  }

  /** Set of booking ids that clash with another booking. */
  function conflictIds() {
    const ids = new Set();
    for (const v of vacTrucks()) {
      const list = bookingsFor(v.id).filter(counts);
      for (let i = 0; i < list.length; i++) {
        const iEnd = ms(list[i].end), iStart = ms(list[i].start);
        for (let j = i + 1; j < list.length; j++) {
          // Sorted by start, so once one starts at/after i's end, so do the rest.
          if (ms(list[j].start) >= iEnd) break;
          if (iStart < ms(list[j].end)) { ids.add(list[i].id); ids.add(list[j].id); }
        }
      }
    }
    return ids;
  }

  function nextBooking(truckId, t) {
    return bookingsFor(truckId).find((b) => counts(b) && ms(b.start) > t) || null;
  }

  const hasCoords = (b) => typeof b.lat === 'number' && typeof b.lng === 'number' && !isNaN(b.lat) && !isNaN(b.lng);

  /**
   * Scheduled position of a truck at instant t. Never guesses:
   *  - no booking → 'unscheduled' (location unknown; we don't assume depot)
   *  - >1 booking → 'conflict' (no position chosen)
   *  - booking without coordinates → 'needs-location'
   */
  function locate(truckId, t) {
    const v = S().get('vehicles', truckId);
    const active = activeAt(truckId, t);
    const base = { truck: v, truckId, active, next: nextBooking(truckId, t) };
    if (active.length === 0) return Object.assign(base, { state: 'unscheduled', label: 'Unscheduled — location unknown' });
    if (active.length > 1) return Object.assign(base, { state: 'conflict', label: `Conflict — ${active.length} overlapping bookings` });
    const b = active[0];
    const kindLabel = b.kind === 'maintenance' ? 'Maintenance' : b.kind === 'depot' ? 'Depot assignment' : b.status === 'tentative' ? 'Tentative booking' : 'Confirmed booking';
    if (!hasCoords(b)) return Object.assign(base, { state: 'needs-location', booking: b, label: 'Site location required', kindLabel });
    return Object.assign(base, { state: 'located', booking: b, lat: b.lat, lng: b.lng, label: b.address || 'Pinned location', kindLabel });
  }

  /** Category used for colours and filters. */
  function bookingCategory(b) {
    if (b.status === 'cancelled') return 'cancelled';
    if (b.kind === 'maintenance') return 'maintenance';
    if (b.kind === 'depot') return 'depot';
    return b.status; // confirmed | tentative
  }

  function bookingTitle(b) {
    if (b.kind === 'maintenance') return b.jobName || 'Maintenance';
    if (b.kind === 'depot') return b.jobName || 'Depot assignment';
    return b.jobName || '(Untitled job)';
  }

  // ---- Revenue -------------------------------------------------------
  /*
   * Charge-out rates and running costs by vehicle type. Revenue and booked
   * hours are read from real bookings; fuel and "other" are modelled from
   * those hours, since no fuel dockets or overheads are recorded.
   */
  const RATE = { 'Vac truck': 180, 'Tipper truck': 145, Ute: 95, Van: 85, Other: 110 };
  const FUEL_PER_HOUR = { 'Vac truck': 32, 'Tipper truck': 26, Ute: 9, Van: 8, Other: 14 };
  const OTHER_PER_HOUR = { 'Vac truck': 9, 'Tipper truck': 7, Ute: 4, Van: 4, Other: 5 };

  const hourlyRate = (v) => RATE[v.type] || RATE.Other;

  /** Billable job bookings that finished inside [from, to). */
  function billableJobs(truckId, from, to) {
    return bookingsFor(truckId).filter((b) =>
      b.kind === 'job' && b.status !== 'cancelled' && ms(b.end) >= from && ms(b.end) < to);
  }

  const bookingHours = (b) => Math.max(0, (ms(b.end) - ms(b.start)) / 3600000);

  /** Revenue, hours and job count for a vehicle over a period. */
  function revenue(v, from, to) {
    const jobs = billableJobs(v.id, from, to);
    const rate = hourlyRate(v);
    let hours = 0;
    jobs.forEach((b) => { hours += bookingHours(b); });
    return { jobs, count: jobs.length, hours, rate, total: hours * rate };
  }

  /** Revenue split by a booking field (client, jobName), largest first. */
  function revenueBy(v, from, to, field) {
    const rate = hourlyRate(v);
    const map = new Map();
    billableJobs(v.id, from, to).forEach((b) => {
      const key = b[field] || 'Unassigned';
      map.set(key, (map.get(key) || 0) + bookingHours(b) * rate);
    });
    return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }

  /** Revenue against maintenance, fuel and overheads for the period. */
  function costs(v, from, to) {
    const rev = revenue(v, from, to);
    const maintenance = AD.store.all('services')
      .filter((s) => s.vehicleId === v.id && ms(s.date) >= from && ms(s.date) < to)
      .reduce((sum, s) => sum + Number(s.cost || 0), 0);
    const fuel = rev.hours * (FUEL_PER_HOUR[v.type] || FUEL_PER_HOUR.Other);
    const other = rev.hours * (OTHER_PER_HOUR[v.type] || OTHER_PER_HOUR.Other);
    return { revenue: rev.total, maintenance, fuel, other, margin: rev.total - maintenance - fuel - other };
  }

  return {
    serviceState, regoState, attentionTone, openDefects, fmtKm, fmtAUD, driverName,
    vacTrucks, bookingsFor, activeAt, overlaps, conflictIds, nextBooking, locate, hasCoords,
    bookingCategory, bookingTitle, SOON_DAYS, SOON_KM,
    hourlyRate, revenue, revenueBy, costs, bookingHours
  };
})();
