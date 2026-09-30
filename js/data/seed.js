/*
 * Demo seed data — ALL FICTIONAL. Vehicles, registrations, drivers, clients,
 * job numbers and bookings are made-up examples, not Astrea records.
 *
 * Dates are generated relative to "today" (Australia/Sydney) at the moment the
 * data is seeded or reset, so overdue / upcoming examples stay useful.
 *
 * Later: the same shapes map 1:1 to Supabase tables (vehicles, drivers, sites,
 * bookings, services, defects, documents, activity).
 */
window.AD = window.AD || {};

AD.seed = (function () {
  const T = AD.time;

  // Demo sites. Coordinates are at street/precinct level for the named place.
  const SITES = [
    { id: 'site-depot', name: 'Demo depot (fictional)', address: 'Industrial area, Wetherill Park NSW 2164', state: 'NSW', lat: -33.8430, lng: 150.9000, isDepot: true },
    { id: 'site-parra', name: 'Parramatta Square', address: 'Parramatta Square, Parramatta NSW 2150', state: 'NSW', lat: -33.8157, lng: 151.0034 },
    { id: 'site-sop', name: 'Sydney Olympic Park', address: 'Olympic Blvd, Sydney Olympic Park NSW 2127', state: 'NSW', lat: -33.8465, lng: 151.0680 },
    { id: 'site-penrith', name: 'Penrith CBD', address: 'Station St, Penrith NSW 2750', state: 'NSW', lat: -33.7505, lng: 150.6942 },
    { id: 'site-liverpool', name: 'Liverpool CBD', address: 'Macquarie St, Liverpool NSW 2170', state: 'NSW', lat: -33.9210, lng: 150.9240 },
    { id: 'site-campbelltown', name: 'Campbelltown CBD', address: 'Queen St, Campbelltown NSW 2560', state: 'NSW', lat: -34.0660, lng: 150.8150 },
    { id: 'site-norwest', name: 'Norwest Business Park', address: 'Norwest Blvd, Norwest NSW 2153', state: 'NSW', lat: -33.7320, lng: 150.9620 },
    { id: 'site-blacktown', name: 'Blacktown CBD', address: 'Main St, Blacktown NSW 2148', state: 'NSW', lat: -33.7690, lng: 150.9060 },
    { id: 'site-botany', name: 'Port Botany', address: 'Foreshore Rd, Port Botany NSW 2036', state: 'NSW', lat: -33.9635, lng: 151.2105 },
    { id: 'site-wsa', name: 'Western Sydney Airport precinct', address: 'Badgerys Creek NSW 2555', state: 'NSW', lat: -33.8900, lng: 150.7250 },
    { id: 'site-wollongong', name: 'Wollongong CBD', address: 'Crown St, Wollongong NSW 2500', state: 'NSW', lat: -34.4250, lng: 150.8930 },
    { id: 'site-newcastle', name: 'Newcastle CBD', address: 'Hunter St, Newcastle NSW 2300', state: 'NSW', lat: -32.9270, lng: 151.7760 },
    { id: 'site-gosford', name: 'Gosford CBD', address: 'Mann St, Gosford NSW 2250', state: 'NSW', lat: -33.4250, lng: 151.3420 },
    { id: 'site-canberra', name: 'Canberra City', address: 'City Walk, Canberra ACT 2601', state: 'ACT', lat: -35.2790, lng: 149.1310 },
    { id: 'site-brisbane', name: 'Brisbane CBD', address: 'Queen St, Brisbane City QLD 4000', state: 'QLD', lat: -27.4690, lng: 153.0250 },
    { id: 'site-docklands', name: 'Docklands', address: 'Docklands VIC 3008', state: 'VIC', lat: -37.8150, lng: 144.9420 }
  ];

  const DRIVERS = [
    'Liam Carter', 'Josh Nguyen', 'Mia Russo', 'Ethan Walsh', 'Sam Patel', 'Chloe Brennan',
    'Noah Kelly', 'Aisha Rahman', 'Tom Fraser', 'Jack Morrison', 'Grace O’Neill', 'Ben Tran'
  ].map((name, i) => ({ id: 'drv-' + String(i + 1).padStart(2, '0'), name }));

  const CLIENTS = ['Harbourline Utilities', 'Westgate Civil', 'Metro Water Works', 'Coastal Rail Alliance', 'Summit Developments', 'Greenfield Energy Networks'];
  const JOBS = ['Stormwater pit clean-out', 'Non-destructive digging (NDD)', 'Potholing — utility locating', 'Sewer line jetting', 'Slurry removal', 'Pier hole excavation', 'Drainage culvert clean', 'Tank & sump clean', 'Trenching for conduit'];

  function build() {
    const today = T.todayKey();
    const dk = (n) => T.addDays(today, n);
    const at = (n, h, m = 0) => {
      const { y, m: mo, d } = T.parseKey(dk(n));
      return new Date(T.fromParts(y, mo, d, h, m)).toISOString();
    };
    const site = (id) => SITES.find((s) => s.id === id);

    // --- Vehicles ------------------------------------------------------
    const V = (o) => Object.assign({ serviceIntervalKm: 10000, serviceIntervalMonths: 6, notes: '' }, o);
    const vehicles = [
      V({ id: 'VAC-01', rego: 'XV01AD', make: 'Isuzu', model: 'FVZ 260-300 — 8,000 L vac unit', year: 2021, type: 'Vac truck', driverId: 'drv-01', odometer: 84210, status: 'In use', regoExpiry: dk(142), lastServiceDate: dk(-70), lastServiceKm: 79800, nextServiceDate: dk(112), nextServiceKm: 89800 }),
      V({ id: 'VAC-02', rego: 'XV02AD', make: 'Hino', model: '500 FM 2632 — 10,000 L vac unit', year: 2022, type: 'Vac truck', driverId: 'drv-02', odometer: 61540, status: 'In use', regoExpiry: dk(201), lastServiceDate: dk(-176), lastServiceKm: 52100, nextServiceDate: dk(6), nextServiceKm: 62100 }),
      V({ id: 'VAC-03', rego: 'XV03AD', make: 'Isuzu', model: 'FVZ 260-300 — 8,000 L vac unit', year: 2020, type: 'Vac truck', driverId: 'drv-03', odometer: 112480, status: 'Available', regoExpiry: dk(88), lastServiceDate: dk(-40), lastServiceKm: 109900, nextServiceDate: dk(142), nextServiceKm: 119900 }),
      V({ id: 'VAC-04', rego: 'XV04AD', make: 'Volvo', model: 'FM 8x4 — 12,000 L vac unit', year: 2023, type: 'Vac truck', driverId: 'drv-04', odometer: 38950, status: 'In use', regoExpiry: dk(10), lastServiceDate: dk(-95), lastServiceKm: 31200, nextServiceDate: dk(87), nextServiceKm: 41200 }),
      V({ id: 'VAC-05', rego: 'XV05AD', make: 'Kenworth', model: 'T410 — 10,000 L vac unit', year: 2019, type: 'Vac truck', driverId: 'drv-05', odometer: 146720, status: 'In workshop', regoExpiry: dk(167), lastServiceDate: dk(-182), lastServiceKm: 136900, nextServiceDate: dk(0), nextServiceKm: 146900, notes: 'Booked in for scheduled service (sample).' }),
      V({ id: 'VAC-06', rego: 'XV06AD', make: 'Hino', model: '500 FM 2632 — 10,000 L vac unit', year: 2021, type: 'Vac truck', driverId: 'drv-06', odometer: 90310, status: 'Available', regoExpiry: dk(250), lastServiceDate: dk(-191), lastServiceKm: 80200, nextServiceDate: dk(-9), nextServiceKm: 90200 }),
      V({ id: 'VAC-07', rego: 'XV07AD', make: 'Isuzu', model: 'FXY 240-350 — 8,000 L vac unit', year: 2022, type: 'Vac truck', driverId: 'drv-07', odometer: 57030, status: 'In use', regoExpiry: dk(54), lastServiceDate: dk(-60), lastServiceKm: 51800, nextServiceDate: dk(122), nextServiceKm: 61800 }),
      V({ id: 'VAC-08', rego: 'XV08AD', make: 'Volvo', model: 'FM 8x4 — 12,000 L vac unit', year: 2024, type: 'Vac truck', driverId: 'drv-08', odometer: 24480, status: 'In use', regoExpiry: dk(310), lastServiceDate: dk(-120), lastServiceKm: 15100, nextServiceDate: dk(62), nextServiceKm: 25100 }),
      V({ id: 'UTE-01', rego: 'XU11AD', make: 'Toyota', model: 'HiLux SR 4x4', year: 2022, type: 'Ute', driverId: 'drv-09', odometer: 71220, status: 'In use', regoExpiry: dk(120), serviceIntervalKm: 15000, serviceIntervalMonths: 12, lastServiceDate: dk(-240), lastServiceKm: 55900, nextServiceDate: dk(125), nextServiceKm: 70900 }),
      V({ id: 'UTE-02', rego: 'XU12AD', make: 'Ford', model: 'Ranger XL 4x4', year: 2021, type: 'Ute', driverId: 'drv-10', odometer: 98640, status: 'Out of service', regoExpiry: dk(-3), serviceIntervalKm: 15000, serviceIntervalMonths: 12, lastServiceDate: dk(-150), lastServiceKm: 88400, nextServiceDate: dk(215), nextServiceKm: 103400, notes: 'Parked up pending brake repair (sample).' }),
      V({ id: 'VAN-01', rego: 'XN21AD', make: 'Toyota', model: 'HiAce LWB', year: 2020, type: 'Van', driverId: 'drv-11', odometer: 132900, status: 'Available', regoExpiry: dk(76), serviceIntervalKm: 15000, serviceIntervalMonths: 12, lastServiceDate: dk(-353), lastServiceKm: 118300, nextServiceDate: dk(12), nextServiceKm: 133300 }),
      V({ id: 'VAN-02', rego: 'XN22AD', make: 'Ford', model: 'Transit Custom', year: 2023, type: 'Van', driverId: '', odometer: 29410, status: 'Available', regoExpiry: dk(21), serviceIntervalKm: 15000, serviceIntervalMonths: 12, lastServiceDate: dk(-100), lastServiceKm: 20100, nextServiceDate: dk(265), nextServiceKm: 35100 }),
      V({ id: 'TRK-01', rego: 'XT31AD', make: 'Isuzu', model: 'NPR 75-190 tipper', year: 2019, type: 'Tipper truck', driverId: 'drv-12', odometer: 155300, status: 'In use', regoExpiry: dk(35), lastServiceDate: dk(-150), lastServiceKm: 146100, nextServiceDate: dk(32), nextServiceKm: 156100 })
    ];

    // --- Service history -----------------------------------------------
    const services = [];
    let sid = 1;
    for (const v of vehicles) {
      const back = [[0, v.lastServiceDate, v.lastServiceKm], [1], [2]];
      back.forEach(([i, date, km], idx) => {
        const d = idx === 0 ? date : T.addDays(v.lastServiceDate, -v.serviceIntervalMonths * 30 * idx);
        const k = idx === 0 ? km : Math.max(1000, v.lastServiceKm - v.serviceIntervalKm * idx);
        if (k < 2000) return;
        services.push({
          id: 'svc-' + sid++, vehicleId: v.id, date: d, odometer: k,
          type: idx === 1 && v.type === 'Vac truck' ? 'Major service + vac pump overhaul' : 'Scheduled service',
          workshop: ['Western Sydney Truck Centre (sample)', 'Hills Fleet Service (sample)', 'Prospect Diesel (sample)'][(sid + idx) % 3],
          cost: v.type === 'Vac truck' ? 1850 + ((sid * 137) % 1400) : 480 + ((sid * 71) % 420),
          notes: idx === 0 ? 'Oil, filters and safety check. (Sample record)' : 'Sample record.'
        });
      });
    }

    // --- Defects ------------------------------------------------------
    const defects = [
      { id: 'def-1', vehicleId: 'VAC-03', reportedDate: dk(-2), reportedBy: 'Mia Russo', description: 'Hydraulic hose weeping on boom lift cylinder.', priority: 'Medium', status: 'Open', resolvedDate: null, resolutionNotes: '' },
      { id: 'def-2', vehicleId: 'UTE-02', reportedDate: dk(-4), reportedBy: 'Jack Morrison', description: 'Brake warning light on; soft pedal feel. Vehicle parked up.', priority: 'Critical', status: 'Open', resolvedDate: null, resolutionNotes: '' },
      { id: 'def-3', vehicleId: 'VAC-07', reportedDate: dk(-1), reportedBy: 'Noah Kelly', description: 'Rear amber beacon intermittent.', priority: 'Low', status: 'Open', resolvedDate: null, resolutionNotes: '' },
      { id: 'def-4', vehicleId: 'VAN-01', reportedDate: dk(-6), reportedBy: 'Grace O’Neill', description: 'Sliding door latch not engaging first time.', priority: 'High', status: 'In progress', resolvedDate: null, resolutionNotes: '' },
      { id: 'def-5', vehicleId: 'VAC-01', reportedDate: dk(-15), reportedBy: 'Liam Carter', description: 'Debris tank door seal worn.', priority: 'Medium', status: 'Resolved', resolvedDate: dk(-11), resolutionNotes: 'Seal replaced at depot.' }
    ];

    // --- Documents (placeholders only, no files) ----------------------
    const documents = [];
    let docId = 1;
    for (const v of vehicles) {
      const list = [['Registration certificate', 'Registration'], ['CTP insurance certificate', 'Insurance'], ['Pre-start checklist', 'Safety']];
      if (v.type === 'Vac truck') list.push(['Vacuum unit pressure vessel inspection', 'Compliance']);
      for (const [name, category] of list) documents.push({ id: 'doc-' + docId++, vehicleId: v.id, name, category, placeholder: true });
    }

    // --- Bookings (vac trucks only) ------------------------------------
    const bookings = [];
    let bid = 1;
    const B = (o) => {
      const s = o.siteId ? site(o.siteId) : null;
      bookings.push(Object.assign({
        id: 'bk-' + bid++, kind: 'job', status: 'confirmed', notes: '',
        client: '', jobNumber: '', jobName: '',
        siteId: s ? s.id : '', address: s ? s.address : '', lat: s ? s.lat : null, lng: s ? s.lng : null,
        locationSource: s ? 'demo-site' : 'none'
      }, o));
    };

    // Today: two jobs in a day
    B({ truckId: 'VAC-01', driverId: 'drv-01', jobName: 'Stormwater pit clean-out', jobNumber: 'J-26101', client: 'Metro Water Works', siteId: 'site-parra', start: at(0, 6), end: at(0, 11) });
    B({ truckId: 'VAC-01', driverId: 'drv-01', jobName: 'Non-destructive digging (NDD)', jobNumber: 'J-26102', client: 'Greenfield Energy Networks', siteId: 'site-sop', start: at(0, 12), end: at(0, 16, 30) });
    B({ truckId: 'VAC-01', driverId: '', kind: 'depot', jobName: 'Depot standby', jobNumber: '', siteId: 'site-depot', start: at(1, 7), end: at(1, 13), notes: 'Explicit depot assignment (sample).' });
    // Multi-day booking
    B({ truckId: 'VAC-02', driverId: 'drv-02', jobName: 'Pipeline trench vac excavation', jobNumber: 'J-26088', client: 'Westgate Civil', siteId: 'site-wsa', start: at(-1, 6), end: at(2, 17), notes: 'Multi-day booking — truck stays on site overnight (sample).' });
    // VAC-03: a job today, a cancelled one, and tomorrow left free
    B({ truckId: 'VAC-03', driverId: 'drv-03', jobName: 'Potholing — utility locating', jobNumber: 'J-26110', client: 'Harbourline Utilities', siteId: 'site-liverpool', start: at(0, 7), end: at(0, 12) });
    B({ truckId: 'VAC-03', driverId: 'drv-03', status: 'cancelled', jobName: 'Pit clean', jobNumber: 'J-26111', client: 'Summit Developments', siteId: 'site-campbelltown', start: at(0, 13), end: at(0, 16), notes: 'Cancelled by client (sample) — does not set a location.' });
    // Tentative + job with no coordinates
    B({ truckId: 'VAC-04', driverId: 'drv-04', status: 'tentative', jobName: 'Drainage culvert clean', jobNumber: 'J-26115', client: 'Coastal Rail Alliance', siteId: 'site-newcastle', start: at(0, 6, 30), end: at(0, 11, 30) });
    B({ truckId: 'VAC-04', driverId: 'drv-04', jobName: 'Sewer line jetting', jobNumber: 'J-26116', client: 'Metro Water Works', address: 'Lot 14 (TBC), Marsden Park NSW', start: at(0, 13), end: at(0, 17), notes: 'Site pin not yet dropped (sample).' });
    // Maintenance block
    B({ truckId: 'VAC-05', driverId: '', kind: 'maintenance', jobName: 'Scheduled service & vac pump inspection', siteId: 'site-depot', start: at(0, 7), end: at(1, 15) });
    // VAC-06: unscheduled today; later work
    B({ truckId: 'VAC-06', driverId: 'drv-06', jobName: 'Tank & sump clean', jobNumber: 'J-26130', client: 'Summit Developments', siteId: 'site-wollongong', start: at(3, 7), end: at(3, 15) });
    B({ truckId: 'VAC-06', driverId: 'drv-06', status: 'tentative', jobName: 'Slurry removal', jobNumber: 'J-26131', client: 'Westgate Civil', siteId: 'site-gosford', start: at(6, 7), end: at(6, 14) });
    B({ truckId: 'VAC-06', driverId: 'drv-06', kind: 'maintenance', jobName: 'Overdue service — workshop', siteId: 'site-depot', start: at(4, 7), end: at(4, 16) });
    // VAC-07: today's job + an overlapping pair later
    B({ truckId: 'VAC-07', driverId: 'drv-07', jobName: 'Pier hole excavation', jobNumber: 'J-26120', client: 'Summit Developments', siteId: 'site-penrith', start: at(0, 7), end: at(0, 15) });
    B({ truckId: 'VAC-07', driverId: 'drv-07', jobName: 'Stormwater pit clean-out', jobNumber: 'J-26140', client: 'Metro Water Works', siteId: 'site-blacktown', start: at(2, 7), end: at(2, 13) });
    B({ truckId: 'VAC-07', driverId: 'drv-09', status: 'tentative', jobName: 'Non-destructive digging (NDD)', jobNumber: 'J-26141', client: 'Greenfield Energy Networks', siteId: 'site-norwest', start: at(2, 11), end: at(2, 15), notes: 'Overlaps J-26140 — clash example (sample).' });
    // VAC-08: interstate
    B({ truckId: 'VAC-08', driverId: 'drv-08', jobName: 'Trenching for conduit', jobNumber: 'J-26125', client: 'Greenfield Energy Networks', siteId: 'site-canberra', start: at(0, 7), end: at(0, 15, 30) });
    B({ truckId: 'VAC-08', driverId: 'drv-08', jobName: 'Non-destructive digging (NDD)', jobNumber: 'J-26150', client: 'Coastal Rail Alliance', siteId: 'site-brisbane', start: at(7, 7), end: at(8, 16) });
    B({ truckId: 'VAC-04', driverId: 'drv-04', jobName: 'Slurry removal', jobNumber: 'J-26160', client: 'Westgate Civil', siteId: 'site-docklands', start: at(11, 7), end: at(12, 15) });
    B({ truckId: 'VAC-01', driverId: 'drv-01', jobName: 'Sewer line jetting', jobNumber: 'J-26095', client: 'Harbourline Utilities', siteId: 'site-botany', start: at(-1, 7), end: at(-1, 14) });

    // Filler across the next two weeks (deterministic pseudo-random)
    let seed = 20260925;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const jobSites = SITES.filter((s) => !s.isDepot && ['NSW'].includes(s.state));
    const busy = (truck, n) => bookings.some((b) => b.truckId === truck && b.status !== 'cancelled' &&
      Date.parse(b.start) < Date.parse(at(n + 1, 0)) && Date.parse(b.end) > Date.parse(at(n, 0)));
    let job = 26200;
    for (let n = -3; n <= 14; n++) {
      if (T.dayOfWeek(dk(n)) >= 5) continue; // weekends off
      for (let t = 1; t <= 8; t++) {
        const truck = 'VAC-0' + t;
        if (n === 0 || (truck === 'VAC-03' && n === 1) || busy(truck, n)) continue;
        if (rnd() > 0.62) continue;
        const s = jobSites[Math.floor(rnd() * jobSites.length)];
        const startH = 6 + Math.floor(rnd() * 3);
        B({
          truckId: truck, driverId: 'drv-0' + t, status: n > 2 && rnd() < 0.22 ? 'tentative' : 'confirmed',
          jobName: JOBS[Math.floor(rnd() * JOBS.length)], jobNumber: 'J-' + job++,
          client: CLIENTS[Math.floor(rnd() * CLIENTS.length)], siteId: s.id,
          start: at(n, startH), end: at(n, startH + 6 + Math.floor(rnd() * 3))
        });
      }
    }

    // Completed job history for the last two years, so revenue, booked hours
    // and client mix are computed from real bookings rather than fixed totals.
    // Two years (not one) so a 12-month view has a prior period to compare to.
    // Starts before the -3 day window above so today's schedule is untouched.
    let hjob = 24000;
    for (let n = -730; n <= -4; n++) {
      if (T.dayOfWeek(dk(n)) >= 5) continue;
      for (let t = 1; t <= 8; t++) {
        // Slightly busier in the most recent year, so trends read as growth.
        if (rnd() > (n > -365 ? 0.46 : 0.4)) continue;
        const s = jobSites[Math.floor(rnd() * jobSites.length)];
        const startH = 6 + Math.floor(rnd() * 3);
        B({
          truckId: 'VAC-0' + t, driverId: 'drv-0' + t, status: 'confirmed',
          jobName: JOBS[Math.floor(rnd() * JOBS.length)], jobNumber: 'J-' + hjob++,
          client: CLIENTS[Math.floor(rnd() * CLIENTS.length)], siteId: s.id,
          start: at(n, startH), end: at(n, startH + 5 + Math.floor(rnd() * 4))
        });
      }
    }

    // --- Activity -----------------------------------------------------
    const ago = (mins) => new Date(Date.now() - mins * 60000).toISOString();
    const activity = [
      { id: 'act-1', ts: ago(35), vehicleId: 'VAC-05', text: 'VAC-05 booked into workshop for scheduled service' },
      { id: 'act-2', ts: ago(140), vehicleId: 'VAC-07', text: 'Defect reported on VAC-07: rear amber beacon intermittent (Low)' },
      { id: 'act-3', ts: ago(60 * 20), vehicleId: 'VAC-03', text: 'Defect reported on VAC-03: hydraulic hose weeping (Medium)' },
      { id: 'act-4', ts: ago(60 * 26), vehicleId: 'VAC-02', text: 'VAC-02 started multi-day booking J-26088 at Badgerys Creek' },
      { id: 'act-5', ts: ago(60 * 50), vehicleId: 'UTE-02', text: 'UTE-02 status changed to Out of service' },
      { id: 'act-6', ts: ago(60 * 75), vehicleId: 'VAC-03', text: 'Service recorded for VAC-03 at 109,900 km' }
    ];

    return {
      version: 2, seededAt: new Date().toISOString(), seedDay: today,
      vehicles, drivers: DRIVERS, sites: SITES, bookings, services, defects, documents, activity
    };
  }

  return { build, SITES, DRIVERS, CLIENTS, JOBS };
})();
