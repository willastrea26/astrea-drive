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
  const SOON_HOURS = 100;
  const URGENT_HOURS = 25;

  // Vehicle types whose next service is tracked by engine hours (as well as
  // date) by default. Everything else defaults to km + date. The user can
  // still tick a different mix in the vehicle form.
  const HOURS_TYPES = new Set(['Vac truck', 'Tipper truck', 'Excavator']);

  /** Which "notify when due by …" switches are on for this vehicle.
   *  Reads v.trackByDate/trackByKm/trackByHours when set, otherwise
   *  derives sensible defaults from the vehicle type (so rows that pre-date
   *  the engine-hours migration still behave sensibly). */
  function serviceTriggers(v) {
    const hoursType = HOURS_TYPES.has(v.type);
    const anySet = v.trackByDate != null || v.trackByKm != null || v.trackByHours != null;
    if (anySet) {
      return { date: !!v.trackByDate, km: !!v.trackByKm, hours: !!v.trackByHours };
    }
    return { date: true, km: !hoursType, hours: hoursType };
  }

  /** 'overdue' | 'soon' | 'ok' with a reason string.
   *  Only triggers ticked under serviceTriggers() can raise the flag; the
   *  other values are still returned for display but marked inactive. */
  function serviceState(v) {
    const today = T.todayKey();
    const tr = serviceTriggers(v);
    const daysLeft = T.daysBetween(today, v.nextServiceDate);
    // Legacy imports used 0 to mean "not applicable". Treat it as not-tracked
    // so those vehicles do not appear falsely overdue by kilometres/hours.
    const hasKm = Number.isFinite(Number(v.nextServiceKm)) && Number(v.nextServiceKm) > 0;
    const kmLeft = hasKm ? Number(v.nextServiceKm) - Number(v.odometer || 0) : Infinity;
    const hasHours = Number.isFinite(Number(v.nextServiceHours)) && Number(v.nextServiceHours) > 0;
    const hoursLeft = hasHours ? Number(v.nextServiceHours) - Number(v.engineHours || 0) : Infinity;

    const dateOverdue = tr.date && Number.isFinite(daysLeft) && daysLeft < 0;
    const kmOverdue = tr.km && hasKm && kmLeft <= 0;
    const hoursOverdue = tr.hours && hasHours && hoursLeft <= 0;
    const dateSoon = tr.date && Number.isFinite(daysLeft) && daysLeft >= 0 && daysLeft <= SOON_DAYS;
    const kmSoon = tr.km && hasKm && kmLeft > 0 && kmLeft <= SOON_KM;
    const hoursSoon = tr.hours && hasHours && hoursLeft > 0 && hoursLeft <= SOON_HOURS;

    // Pick the most urgent REASON (what to show in the "why" string).
    const reasons = [];
    if (dateOverdue) reasons.push({ kind: 'date', urgency: 0, text: `${-daysLeft} day${daysLeft === -1 ? '' : 's'} overdue` });
    if (kmOverdue)   reasons.push({ kind: 'km',   urgency: 0, text: `${fmtKm(-kmLeft)} over` });
    if (hoursOverdue) reasons.push({ kind: 'hours', urgency: 0, text: `${fmtHours(-hoursLeft)} over` });
    if (dateSoon)  reasons.push({ kind: 'date', urgency: 1, text: daysLeft === 0 ? 'Due today' : `Due in ${daysLeft} day${daysLeft === 1 ? '' : 's'}` });
    if (kmSoon)    reasons.push({ kind: 'km',   urgency: 1, text: `${fmtKm(kmLeft)} to go` });
    if (hoursSoon) reasons.push({ kind: 'hours', urgency: 1, text: `${fmtHours(hoursLeft)} to go` });
    reasons.sort((a, b) => a.urgency - b.urgency);

    const base = { daysLeft, kmLeft, hoursLeft, hasKm, hasHours, triggers: tr,
                   dateOverdue, kmOverdue, hoursOverdue, dateSoon, kmSoon, hoursSoon };
    if (dateOverdue || kmOverdue || hoursOverdue) {
      return Object.assign(base, { state: 'overdue', label: 'Overdue', why: reasons[0].text, kind: reasons[0].kind });
    }
    if (dateSoon || kmSoon || hoursSoon) {
      return Object.assign(base, { state: 'soon', label: 'Due soon', why: reasons[0].text, kind: reasons[0].kind });
    }
    // Nothing ticked is near — "why" shows the soonest ticked trigger.
    const nextActive = [
      tr.date && Number.isFinite(daysLeft) && { kind: 'date', text: `In ${daysLeft} days` },
      tr.km && hasKm && Number.isFinite(kmLeft) && { kind: 'km', text: `${fmtKm(kmLeft)} to go` },
      tr.hours && hasHours && Number.isFinite(hoursLeft) && { kind: 'hours', text: `${fmtHours(hoursLeft)} to go` }
    ].filter(Boolean);
    const why = nextActive.length ? nextActive[0].text : 'No service trigger set';
    return Object.assign(base, { state: 'ok', label: 'OK', why, kind: nextActive[0] ? nextActive[0].kind : 'date' });
  }

  function regoState(v) {
    const d = T.daysBetween(T.todayKey(), v.regoExpiry);
    if (d < 0) return { state: 'overdue', days: d, label: 'Expired', why: `Expired ${-d} day${d === -1 ? '' : 's'} ago` };
    if (d <= 60) return { state: 'soon', days: d, label: 'Renewal due', why: d === 0 ? 'Expires today' : `Expires in ${d} day${d === 1 ? '' : 's'}` };
    return { state: 'ok', days: d, label: 'Current', why: `${d} days left` };
  }

  /**
   * One rule for signal colour everywhere: 'red' when overdue/expired,
   * 'amber' when within 14 days / 500 km / 25 engine hours, otherwise ''.
   */
  const URGENT_DAYS = 14, URGENT_KM = 500;
  function attentionTone(state, days, km = Infinity, hours = Infinity) {
    if (state === 'overdue') return 'red';
    if (state === 'soon' && (days <= URGENT_DAYS || km <= URGENT_KM || hours <= URGENT_HOURS)) return 'amber';
    return '';
  }

  function openDefects(vehicleId) {
    return S().all('defects').filter((d) => d.status !== 'Resolved' && (!vehicleId || d.vehicleId === vehicleId));
  }

  // ---------- Workshops ----------
  // Which repairer category a vehicle type uses. Trailers have none (matches
  // first aid / fire extinguisher registers, which also skip trailers).
  const WORKSHOP_CATEGORY = { Ute: 'ute', Car: 'ute', Van: 'ute', 'Vac truck': 'heavy', 'Tipper truck': 'heavy', Excavator: 'excavator' };

  /** Workshops relevant to a vehicle type: its own category plus any 'all' (own-yard) locations. */
  function workshopsFor(type) {
    const cat = WORKSHOP_CATEGORY[type];
    if (!cat) return [];
    return S().all('workshops').filter((w) => w.category === cat || w.category === 'all').sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Vehicles currently parked at a given workshop (status set with a linked workshop). */
  function atWorkshop(workshopId) {
    return S().all('vehicles').filter((v) => v.status === 'In workshop' && v.workshopId === workshopId);
  }

  function fmtKm(n) { return n === null || n === '' || !Number.isFinite(Number(n)) ? 'N/A' : Math.round(Number(n)).toLocaleString('en-AU') + ' km'; }
  function fmtHours(n) {
    if (n === null || n === '' || !Number.isFinite(Number(n))) return 'N/A';
    const num = Number(n);
    const rounded = Math.abs(num) < 10 ? Math.round(num * 10) / 10 : Math.round(num);
    return rounded.toLocaleString('en-AU') + ' hr';
  }
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
  const RATE = { 'Vac truck': 180, 'Tipper truck': 145, Excavator: 165, Ute: 95, Van: 85, Car: 75, Trailer: 45, Other: 110 };
  const FUEL_PER_HOUR = { 'Vac truck': 32, 'Tipper truck': 26, Excavator: 28, Ute: 9, Van: 8, Car: 8, Trailer: 0, Other: 14 };
  const OTHER_PER_HOUR = { 'Vac truck': 9, 'Tipper truck': 7, Excavator: 8, Ute: 4, Van: 4, Car: 5, Trailer: 2, Other: 5 };

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

  /**
   * Revenue broken into a series of equal buckets across [from, to).
   * Returns [{ label, from, to, total, hours, count }, ...].
   * bucket: 'day' | 'week' | 'month'.
   */
  function revenueSeries(v, from, to, bucket) {
    const rate = hourlyRate(v);
    const jobs = billableJobs(v.id, from, to);
    const buckets = [];
    if (bucket === 'day') {
      let d = new Date(from);
      d.setUTCHours(0, 0, 0, 0);
      while (d.getTime() < to) {
        const start = d.getTime();
        const end = start + 86400000;
        buckets.push({ label: T.fmtKey(T.dateKey(start)).slice(0, 5), from: start, to: end, total: 0, hours: 0, count: 0 });
        d = new Date(end);
      }
    } else if (bucket === 'week') {
      let start = from;
      while (start < to) {
        const end = Math.min(start + 7 * 86400000, to);
        buckets.push({ label: T.fmtKey(T.dateKey(start)).slice(0, 5), from: start, to: end, total: 0, hours: 0, count: 0 });
        start = end;
      }
    } else {
      const fp = T.parts(from);
      let y = fp.year, m = fp.month;
      while (true) {
        const s = Date.UTC(y, m - 1, 1);
        const e = Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1);
        if (s >= to) break;
        buckets.push({ label: new Date(s).toLocaleString('en-AU', { month: 'short' }), from: Math.max(s, from), to: Math.min(e, to), total: 0, hours: 0, count: 0 });
        if (m === 12) { y++; m = 1; } else m++;
      }
    }
    jobs.forEach((b) => {
      const t = ms(b.end);
      const bkt = buckets.find((x) => t >= x.from && t < x.to);
      if (!bkt) return;
      const h = bookingHours(b);
      bkt.total += h * rate;
      bkt.hours += h;
      bkt.count += 1;
    });
    return buckets;
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
    serviceState, serviceTriggers, HOURS_TYPES,
    regoState, attentionTone, openDefects, fmtKm, fmtHours, fmtAUD, driverName,
    vacTrucks, bookingsFor, activeAt, overlaps, conflictIds, nextBooking, locate, hasCoords,
    bookingCategory, bookingTitle, SOON_DAYS, SOON_KM, SOON_HOURS, URGENT_HOURS,
    hourlyRate, revenue, revenueBy, costs, bookingHours, revenueSeries,
    workshopsFor, atWorkshop
  };
})();
