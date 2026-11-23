/* Fleet performance report — monthly branded Excel workbook.
 *
 * Pulls everything the dashboard already knows (vehicles, services, defects,
 * bookings, rego and service states) and lays it out as an Astrea-branded
 * .xlsx: a cover sheet, an executive summary, the twelve-month spend table
 * with projection against target, a compliance snapshot, and a full vehicle
 * register. ExcelJS is fetched on demand so the dashboard stays light.
 */
window.AD = window.AD || {};

AD.fleetReport = (function () {
  const L = AD.logic, T = AD.time;

  // Astrea brand palette (colour guide), in ExcelJS's AARRGGBB format: blue
  // #1F68DB and white first, navy #002A54 for text and dark fills. Status
  // colours (red/amber) only for state; "good" uses the brand blue.
  const COLOR = {
    navy:      'FF002A54',  // dark brand colour — headers, text
    navy2:     'FF113D6E',
    paper:     'FF1F68DB',
    mint:      'FF1F68DB',  // accent (was mint): the brand blue
    mintSoft:  'FFECF3FD',
    blue:      'FF1F68DB',
    ink:       'FF002A54',  // body text
    muted:     'FF7A8CA3',
    rule:      'FFDDE4ED',
    ruleSoft:  'FFF4F7FB',
    white:     'FFFFFFFF',
    red:       'FFD64545',  // expired / overdue / critical
    redSoft:   'FFFCECEC',
    amber:     'FFE3A008',  // due soon
    amberSoft: 'FFFDF4DD',
    green:     'FF1F68DB',  // clear / fine — brand blue (green is kept for actions)
    greenSoft: 'FFECF3FD'
  };

  const FONT_HEAD = 'Calibri';
  const FONT_BODY = 'Calibri';

  // Lazy loader for ExcelJS — ~900KB, no point blocking page load.
  let excelPromise;
  function loadExcelJS() {
    if (excelPromise) return excelPromise;
    excelPromise = new Promise((resolve, reject) => {
      if (window.ExcelJS) return resolve(window.ExcelJS);
      const s = document.createElement('script');
      const fail = () => { clearTimeout(timer); s.remove(); reject(new Error('Could not load the Excel engine. Please try again.')); };
      const timer = setTimeout(fail, 20000);
      s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
      s.onload = () => {
        if (!window.ExcelJS) return fail();
        clearTimeout(timer);
        resolve(window.ExcelJS);
      };
      s.onerror = fail;
      document.head.appendChild(s);
    }).catch((err) => { excelPromise = null; throw err; });
    return excelPromise;
  }

  // Fetch the horizontal Astrea mark for the cover sheet.
  async function loadLogo() {
    try {
      const r = await fetch('assets/logo-lockup.png', { signal: AbortSignal.timeout(15000) });   // white logo, transparent — sits on the brand-blue band
      if (!r.ok) return null;
      return await r.arrayBuffer();
    } catch (e) { return null; }
  }

  /* ------------------------------------------------------------------ data
   * One pass over the stores so every sheet works from the same snapshot.
   */
  /**
   * options.period: 'month' (default; monthKey = 'YYYY-MM') or 'year'
   * (options.year). A yearly report covers January to December of that year
   * (to date, for the year we're in) and compares it with the year before; a
   * monthly report covers the month and compares it with the month before.
   */
  function gather(monthKey, options = {}) {
    const today = T.todayKey();
    const current = T.parts(Date.now());
    const isYear = options.period === 'year';
    let year, month, periodStart, periodEndFull;
    if (isYear) {
      year = Number(options.year) || current.year;
      if (year > current.year) throw new Error('Choose a year that is not in the future.');
      month = year === current.year ? Number(today.slice(5, 7)) : 12;
      periodStart = `${year}-01-01`;
      periodEndFull = `${year}-12-31`;
    } else {
      const selected = monthKey || today.slice(0, 7);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(selected) || selected > today.slice(0, 7)) {
        throw new Error('Choose a valid reporting month that is not in the future.');
      }
      [year, month] = selected.split('-').map(Number);
      periodStart = `${selected}-01`;
      periodEndFull = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    }
    const reportEnd = periodEndFull < today ? periodEndFull : today;
    const p = { ...current, year, month, day: Number(reportEnd.slice(8)) };
    const isPartial = reportEnd < periodEndFull;
    const inPeriod = (d) => !!d && d >= periodStart && d <= reportEnd;
    // Words the pages use for the period, so one set of pages serves both reports.
    const monthWord = T.MONTHS[month - 1];
    const period = isYear
      ? { isYear, label: String(year), name: String(year), word: 'year', prevLabel: String(year - 1), kind: 'Yearly' }
      : { isYear, label: `${monthWord} ${year}`, name: monthWord, word: 'month', prevLabel: T.MONTHS[(month + 10) % 12], kind: 'Monthly' };
    const vehicles = AD.store.all('vehicles').map((v) => ({ ...v, nextServiceDate: v.nextServiceDate || '', regoExpiry: v.regoExpiry || '' }));
    const services = AD.store.all('services').filter((s) => s.date && s.date <= reportEnd);
    const defects  = AD.store.all('defects');
    const resolved = defects.filter((d) => d.status === 'Resolved' && d.resolvedDate && d.resolvedDate <= reportEnd);
    const cost = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
    // Imported fuel-card spend — the same rows the Cost sheet counts, so the
    // report's totals match it. Fuel arrives by statement import, so the
    // latest transaction date is reported too: a month that looks cheap may
    // simply not have its statement in yet.
    const fuel = (AD.store.all('fuel_entries') || [])
      .map((f) => ({ vehicleId: f.vehicleId, date: f.date ? String(f.date).slice(0, 10) : '', cost: cost(f.cost), litres: cost(f.litres), product: f.product || '' }))
      .filter((f) => f.date && f.date <= reportEnd && f.cost > 0);
    const fuelThrough = fuel.reduce((m, f) => (f.date > m ? f.date : m), '');
    // Linkt tolls (trips, No Tag fees, less account credits) — the same rows
    // the Cost sheet counts. They come by statement too, so how far the latest
    // statement reaches is carried alongside.
    const tollRows = AD.store.all('toll_entries') || [];
    const tolls = tollRows
      .map((r) => ({ date: r.date ? String(r.date).slice(0, 10) : '', cost: Number(r.amount) || 0 }))
      .filter((r) => r.date && r.date <= reportEnd);
    const tollThrough = tollRows.reduce((m, r) => { const e = String(r.periodEnd || r.date || '').slice(0, 10); return e > m ? e : m; }, '');
    // The Cost sheet's own forecast and usage figures, so report and app agree.
    const model = AD.views && AD.views['cost-sheet'] && AD.views['cost-sheet'].model;

    // Spend between two dates, by type — the building block for every figure.
    const sumRange = (from, to) => {
      const within = (d) => !!d && d >= from && d <= to;
      const svc = services.filter((s) => within(s.date));
      const def = resolved.filter((d) => within(d.resolvedDate));
      const fl  = fuel.filter((f) => within(f.date));
      const r = {
        planned:   svc.reduce((t, s) => t + cost(s.cost), 0),
        unplanned: def.reduce((t, d) => t + cost(d.cost), 0),
        fuel:      fl.reduce((t, f) => t + f.cost, 0),
        toll:      tolls.filter((x) => within(x.date)).reduce((t, x) => t + x.cost, 0),
        litres:    fl.filter((f) => L.isFuelPurchase(f)).reduce((t, f) => t + f.litres, 0),   // fuel litres, not AdBlue
        fuelCount: fl.length, svcCount: svc.length, defCount: def.length
      };
      r.total = r.planned + r.unplanned + r.fuel + r.toll;
      return r;
    };
    const monthEndOf = (key) => new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0)).toISOString().slice(0, 10);

    // The chart months: the year's January to December, or the twelve months
    // ending with the reporting month. Months after today are marked future.
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = isYear ? new Date(Date.UTC(year, i, 1)) : new Date(Date.UTC(p.year, p.month - 1 - (11 - i), 1));
      const key = d.toISOString().slice(0, 7);
      const mo = { key, label: T.MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear(), year: d.getUTCFullYear(), m: d.getUTCMonth(), future: key > today.slice(0, 7) };
      return Object.assign(mo, sumRange(`${key}-01`, monthEndOf(key)));
    });
    // Index of the last month with data — the "current" column on the chart.
    const curIdx = isYear ? p.month - 1 : 11;

    const annualTotal = months.reduce((t, m) => t + m.total, 0);
    // The period itself: the month, or the year to date.
    const curMonth = isYear ? Object.assign(sumRange(periodStart, reportEnd), { key: null, label: String(year), year, m: 11 }) : months[11];
    // No Linkt statement reaches into the period yet: its tolls are missing, not $0.
    const tollsNotIn = !tollThrough || tollThrough < periodStart;
    const daysInMonth = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
    const dayOfMonth = p.day;
    const mtdActual = curMonth.total;

    // YTD: calendar-year to date.
    const ytdActual = sumRange(`${year}-01-01`, reportEnd).total;
    const monthsElapsedFull = isYear ? (isPartial ? p.month - 1 : 12) : p.month - 1;  // full months before the current one

    // Forecast, exactly as the Cost sheet shows it: the average month of each
    // cost over the months we have complete data for it (no comparison against
    // an average — a growing fleet is always "above" its past), and for the
    // year we're in, actual spend plus that average for every day not in yet.
    const basis = model ? model.forecastBasis(reportEnd) : null;
    const avgMonth = basis ? basis.total : annualTotal / 12;
    const yearForecast = model ? model.yearForecast(p.year) : null;

    // Compliance snapshot — mirrors the dashboard donuts.
    const svcState = vehicles.map((v) => ({ v, s: L.serviceState(v) }));
    const regoState = vehicles.map((v) => ({ v, r: L.regoState(v) }));
    const SOON = 14;
    const svcOverdue = svcState.filter((x) => x.s.state === 'overdue');
    const svcSoon    = svcState.filter((x) => x.s.state !== 'overdue' && (
      (x.s.triggers.date && x.s.daysLeft <= SOON) ||
      (x.s.triggers.km && x.s.kmLeft <= 500) ||
      (x.s.triggers.hours && x.s.hoursLeft <= 25)));
    const svcOk      = svcState.filter((x) => !svcOverdue.includes(x) && !svcSoon.includes(x));
    const regoExp    = regoState.filter((x) => x.r.state === 'overdue');
    const regoSoon   = regoState.filter((x) => x.r.state !== 'overdue' && x.r.days <= SOON);
    const regoUnknown = regoState.filter((x) => !Number.isFinite(x.r.days));
    const regoOk     = regoState.filter((x) => !regoExp.includes(x) && !regoSoon.includes(x) && !regoUnknown.includes(x));

    const openDefects = defects.filter((d) => d.status !== 'Resolved');
    const defByPri = (p) => openDefects.filter((d) => d.priority === p).length;

    // Status counts.
    const statusCounts = {
      'Available':      vehicles.filter((v) => v.status === 'Available').length,
      'In use':         vehicles.filter((v) => v.status === 'In use').length,
      'In workshop':    vehicles.filter((v) => v.status === 'In workshop').length,
      'Out of service': vehicles.filter((v) => v.status === 'Out of service').length
    };
    const availabilityPct = vehicles.length ? statusCounts['Available'] / vehicles.length : 0;
    const unknownStatus = vehicles.length - Object.values(statusCounts).reduce((a, b) => a + b, 0);

    /* ---- against the previous period (month, or year), for the statistics pages ---- */
    const prevMonth = isYear
      ? Object.assign(sumRange(`${year - 1}-01-01`, `${year - 1}-12-31`), { key: null, label: String(year - 1) })
      : months[10];
    const momPct = prevMonth && prevMonth.total > 0
      ? (curMonth.total - prevMonth.total) / prevMonth.total : null;
    const unplannedShare = curMonth.total > 0 ? curMonth.unplanned / curMonth.total : 0;
    const unplannedShare12 = annualTotal > 0
      ? months.reduce((t, m) => t + m.unplanned, 0) / annualTotal : 0;
    // The other slices of the same total (the four add to 100%), as on the Cost sheet.
    const fuelShare = curMonth.total > 0 ? curMonth.fuel / curMonth.total : 0;
    const tollShare = curMonth.total > 0 ? curMonth.toll / curMonth.total : 0;
    const plannedShare = curMonth.total > 0 ? curMonth.planned / curMonth.total : 0;
    const fuelShare12 = annualTotal > 0 ? months.reduce((t, m) => t + m.fuel, 0) / annualTotal : 0;
    const tollShare12 = annualTotal > 0 ? months.reduce((t, m) => t + m.toll, 0) / annualTotal : 0;
    const plannedShare12 = annualTotal > 0 ? months.reduce((t, m) => t + m.planned, 0) / annualTotal : 0;

    // Defects raised and resolved inside the period.
    const defRaisedMonth = defects.filter((d) => inPeriod(d.reportedDate));
    const defResolvedMonth = resolved.filter((d) => inPeriod(d.resolvedDate));
    // Mean days to resolve, for those resolved this month that record both dates.
    const resolveDays = defResolvedMonth
      .map((d) => (d.reportedDate && d.resolvedDate) ? T.daysBetween(d.reportedDate, d.resolvedDate) : null)
      .filter((n) => Number.isFinite(n) && n >= 0);
    const avgResolveDays = resolveDays.length
      ? resolveDays.reduce((t, n) => t + n, 0) / resolveDays.length : null;

    // Spend per vehicle this month, highest first, split by type as on the
    // Cost sheet's Top spending vehicles (fuel, tolls, servicing, repairs).
    const perVehicleMonth = new Map();
    const tallyMonth = (id, kind, n) => {
      if (!id) return;
      const t = perVehicleMonth.get(id) || { fuel: 0, toll: 0, planned: 0, unplanned: 0 };
      t[kind] += n;
      perVehicleMonth.set(id, t);
    };
    services.filter((s) => inPeriod(s.date))
      .forEach((s) => tallyMonth(s.vehicleId, 'planned', cost(s.cost)));
    defResolvedMonth.forEach((d) => tallyMonth(d.vehicleId, 'unplanned', cost(d.cost)));
    fuel.filter((f) => inPeriod(f.date)).forEach((f) => tallyMonth(f.vehicleId, 'fuel', f.cost));
    const tollsByVeh = L.tollsByVehicle ? L.tollsByVehicle() : new Map();
    tollsByVeh.forEach((rows, id) => rows.forEach((r) => {
      if (inPeriod(String(r.date || '').slice(0, 10))) tallyMonth(id, 'toll', Number(r.amount) || 0);
    }));
    const topSpenders = [...perVehicleMonth.entries()]
      .map(([id, parts]) => ({ id, parts, cost: parts.fuel + parts.toll + parts.planned + parts.unplanned, v: vehicles.find((v) => v.id === id) || null }))
      .filter((s) => s.cost > 0.005)
      .sort((a, b) => b.cost - a.cost).slice(0, 6);

    // Linkt housekeeping: No Tag fees over the imported statements (avoidable
    // with a working tag), by vehicle, and tags recorded on two vehicles.
    const feeRows = tollRows.filter((r) => r.kind === 'fee');
    const noTag = { total: feeRows.reduce((t, r) => t + (Number(r.amount) || 0), 0), count: feeRows.length, byVehicle: [] };
    tollsByVeh.forEach((rows, id) => {
      const fees = rows.filter((r) => r.kind === 'fee');
      if (fees.length) noTag.byVehicle.push({ id, count: fees.length, total: fees.reduce((t, r) => t + (Number(r.amount) || 0), 0) });
    });
    noTag.byVehicle.sort((a, b) => b.total - a.total);
    let sharedTags = 0;
    if (AD.linkt && tollRows.length) {
      const match = AD.linkt.matcher(vehicles);
      const seen = new Set();
      tollRows.forEach((r) => {
        if (!r.tag || seen.has(r.tag)) return;
        seen.add(r.tag);
        if (match(r).ambiguous.length) sharedTags++;
      });
    }

    // Fuel-card coverage: a fortnight with nothing on a whole card is almost
    // certainly a statement that hasn't been imported (last 12 months only).
    const windowStart = months[0].key + '-01';
    const fuelGaps = model ? model.fuelCardCoverage().flatMap((c) => c.gaps.filter((gp) => gp.to >= windowStart).map((gp) => ({ card: c.card, ...gp }))) : [];

    // GPS-tracked vehicles that drove but bought no fuel on their card over the
    // days measured — their fuel is going on some other card.
    const noFuelOnCard = model ? model.usageMeasures('km').list.filter((m) => m.state !== 'waiting' && m.span >= 14 && m.use >= 300 && !(m.fuelOnly > 0))
      .map((m) => ({ id: m.v.id, km: m.use, span: m.span })) : [];
    const vehiclesCharged = perVehicleMonth.size;
    // Share of the month carried by the single dearest vehicle.
    const topShare = curMonth.total > 0 && topSpenders.length
      ? topSpenders[0].cost / curMonth.total : 0;

    // Fleet split by type, for the composition chart.
    const typeList = [...new Set(vehicles.map((v) => v.type || 'Unspecified'))];
    const byType = typeList
      .map((t) => ({ type: t, count: vehicles.filter((v) => (v.type || 'Unspecified') === t).length }))
      .filter((x) => x.count).sort((a, b) => b.count - a.count);

    // Plant that has not been booked for a while.
    const IDLE_MIN = 10;
    let idle = [];
    try {
      idle = vehicles.map((v) => {
        const bs = (L.bookingsFor ? L.bookingsFor(v.id) : []).filter((x) => x.status !== 'cancelled');
        if (!bs.length) return null;
        const last = Math.max(...bs.map((x) => Date.parse(x.end)));
        if (!Number.isFinite(last) || last > Date.now()) return null;
        return { v, days: T.daysBetween(T.dateKey(last), today) };
      }).filter((x) => x && x.days >= IDLE_MIN).sort((a, b) => b.days - a.days);
    } catch (e) { idle = []; }

    const data = {
      today, now: p, reportEnd, isPartial, period, periodStart, isYear,
      vehicles,
      months, curMonth, prevMonth, curIdx,
      annualTotal, avgMonth, basis, yearForecast,
      mtdActual, daysInMonth, dayOfMonth,
      ytdActual, monthsElapsedFull,
      tollThrough, tollsNotIn, noTag, sharedTags, fuelGaps, noFuelOnCard,
      // What the totals are made of, for the report to state plainly.
      tollsLoaded: AD.store.tollsState ? AD.store.tollsState() === 'ready' : true,
      fuelCards: model ? model.fuelCardCoverage().map((c) => ({ card: c.card, from: c.from, to: c.to })) : [],
      svcOverdue, svcSoon, svcOk,
      regoExp, regoSoon, regoOk, regoUnknown,
      openDefects,
      defCounts: {
        Critical: defByPri('Critical'), High: defByPri('High'),
        Medium: defByPri('Medium'),     Low: defByPri('Low')
      },
      statusCounts, availabilityPct, unknownStatus,
      momPct, unplannedShare, unplannedShare12,
      fuelShare, tollShare, plannedShare, fuelShare12, tollShare12, plannedShare12, fuelThrough,
      defRaisedMonth, defResolvedMonth, avgResolveDays,
      topSpenders, vehiclesCharged, topShare, byType, idle
    };
    data.recommendations = recommend(data);
    return data;
  }

  /* ---------------------------------------------------------- recommendations
   * Derived from the figures above by rule, not by a language model — each one
   * states what the data shows and what to do about it. Ordered by weight so
   * the most consequential leads. Every generator stays silent when it has
   * nothing to say, and the closing entries make sure the list is never empty.
   */
  function recommend(d) {
    const out = [];
    const add = (weight, priority, title, finding, action) =>
      out.push({ weight, priority, title, finding, action });
    const s = (n) => (n === 1 ? '' : 's');
    const pct = (x) => Math.round(Math.abs(x) * 100) + '%';
    const names = (list, n = 3) => list.slice(0, n).map((x) => x.v ? x.v.id : x.id).join(', ')
      + (list.length > n ? ` and ${list.length - n} more` : '');

    if (!d.vehicles.length && !d.annualTotal && !d.openDefects.length) {
      add(100, 'Low', 'Build a reporting baseline',
        'No fleet, cost or open-defect records are available in this snapshot.',
        'Add vehicles and check that service and defect records are up to date before using this report for decisions.');
      return out;
    }

    if (d.regoExp.length) add(100, 'High', 'Return expired registrations to compliance',
      `${d.regoExp.length} vehicle${s(d.regoExp.length)} ${d.regoExp.length === 1 ? 'is' : 'are'} on an expired registration — ${names(d.regoExp)}.`,
      'Confirm the expiry records and renewal status with the fleet manager before allocating these vehicles to road work.');

    if (d.defCounts.Critical) add(96, 'High', 'Clear the open critical defects',
      `${d.defCounts.Critical} critical defect${s(d.defCounts.Critical)} ${d.defCounts.Critical === 1 ? 'is' : 'are'} still open.`,
      'Critical defects are raised as unsafe to operate. Book these into the workshop ahead of scheduled work.');

    if (d.svcOverdue.length) add(92, 'High', 'Catch up the overdue servicing',
      `${d.svcOverdue.length} vehicle${s(d.svcOverdue.length)} ${d.svcOverdue.length === 1 ? 'has' : 'have'} passed a service limit — ${names(d.svcOverdue)}.`,
      'Confirm the recorded service limits and schedule overdue work with the workshop, starting with operationally critical vehicles.');

    if (d.regoUnknown.length) add(85, 'Medium', 'Complete missing registration dates',
      `${d.regoUnknown.length} vehicle${s(d.regoUnknown.length)} have no usable registration expiry date in the report.`,
      'Check the source records and enter the expiry dates so renewal alerts can be assessed.');

    // Judged on maintenance alone (servicing + repairs): fuel is a running cost, not a
    // sign of whether maintenance is keeping ahead of failures.
    const maint = d.curMonth.planned + d.curMonth.unplanned;
    const maintShare = maint > 0 ? d.curMonth.unplanned / maint : 0;
    const maint12 = d.months.reduce((t, m) => t + m.planned + m.unplanned, 0);
    const maintShare12 = maint12 > 0 ? d.months.reduce((t, m) => t + m.unplanned, 0) / maint12 : 0;
    if (maintShare >= 0.4 && maint > 0) add(80, 'High', 'Bring the planned/unplanned balance back',
      `Unplanned repairs were ${pct(maintShare)} of this ${d.period.word}'s maintenance spend (${aud(d.curMonth.unplanned)} of ${aud(maint)})${d.isYear ? '' : `, against a 12-month norm of ${pct(maintShare12)}`}.`,
      'Review the repair invoices and repeat defects behind this share. Check whether the costs are one-off repairs or a recurring maintenance issue.');

    if (d.topShare >= 0.3 && d.topSpenders.length) add(72, 'Medium', 'Spend is concentrated in one vehicle',
      `${d.topSpenders[0].id} accounted for ${pct(d.topShare)} of the ${d.period.word}'s cost (${aud(d.topSpenders[0].cost)}).`,
      `Where one asset carries this much of the ${d.period.word}'s spend, it is worth comparing its running cost against replacement or hire for the same duty.`);

    // Fuel arrives by statement import; a stale import makes recent months look cheap.
    const fuelLagDays = d.fuelThrough ? T.daysBetween(d.fuelThrough, d.reportEnd) : null;
    if (fuelLagDays !== null && fuelLagDays > 14) add(70, 'Medium', 'Import the latest fuel statement',
      `The newest fuel-card transaction on record is ${T.fmtKey(d.fuelThrough)}, ${fuelLagDays} days before the end of this report.`,
      'Fuel is most of the fleet’s running cost, so recent months read low until the statement is in. Import it from the Cost sheet, then regenerate this report.');
    if (!d.fuelThrough && d.vehicles.length) add(66, 'Medium', 'Import fuel-card data',
      'No fuel-card transactions have been imported, so spend in this report covers servicing and repairs only.',
      'Import a WEX or BP statement from the Cost sheet so fuel, the largest running cost, is counted.');
    if (d.fuelGaps.length) {
      const gp = d.fuelGaps[0];
      add(67, 'Medium', 'Import the missing fuel statement',
        `${gp.card.toUpperCase()} has no transactions at all between ${T.fmtKey(gp.from)} and ${T.fmtKey(gp.to)}${d.fuelGaps.length > 1 ? `, and ${d.fuelGaps.length - 1} other gap${s(d.fuelGaps.length - 1)} like it` : ''}. A whole card going quiet for a fortnight is almost always a statement that hasn't been imported.`,
        'Download the statement covering those dates and import it from the Cost sheet. Until then, those months and the fuel run rate read low.');
    }

    // Tolls come by Linkt statement (quarterly); a stale one leaves recent months short.
    const tollLagDays = d.tollThrough ? T.daysBetween(d.tollThrough, d.reportEnd) : null;
    if (tollLagDays !== null && tollLagDays > 45) add(69, 'Medium', 'Import the latest Linkt statement',
      `The newest Linkt statement imported ends ${T.fmtKey(d.tollThrough)}, ${tollLagDays} days before the end of this report, so tolls since then aren't counted.`,
      'Import the next Linkt detailed statement PDF from the Cost sheet when it arrives. The forecast estimates the missing tolls until then.');
    if (d.noTag.total >= 250) {
      const worst = d.noTag.byVehicle.slice(0, 3).map((x) => `${x.id} (${aud(x.total)})`).join(', ');
      add(64, 'Medium', 'Fix Linkt tags to stop No Tag fees',
        `${aud(d.noTag.total)} has gone on No Tag fees across ${d.noTag.count.toLocaleString('en-AU')} charges in the imported statements${worst ? `, most on ${worst}` : ''}.${d.sharedTags ? ` ${d.sharedTags} tag${s(d.sharedTags)} ${d.sharedTags === 1 ? 'is' : 'are'} also recorded on two vehicles, so ${d.sharedTags === 1 ? 'its' : 'their'} tolls aren't charged to either.` : ''}`,
        'Check these vehicles have a working, correctly mounted tag linked to the Linkt account, and give each tag a single vehicle in the Fleet register.');
    }
    if (d.noFuelOnCard.length) add(62, 'Medium', 'Find which card these vehicles fuel on',
      `${names(d.noFuelOnCard)} drove ${d.noFuelOnCard.length === 1 ? `${Math.round(d.noFuelOnCard[0].km).toLocaleString('en-AU')} km over ${d.noFuelOnCard[0].span} days` : 'hundreds of kilometres each'} with no fuel bought on ${d.noFuelOnCard.length === 1 ? 'its' : 'their'} fuel card.`,
      'Their fuel is likely going on a person card or a card linked to another vehicle. Link the right card so their running cost is counted against them.');

    if (d.idle.length) add(68, 'Medium', 'Check gaps in recorded bookings',
      `${d.idle.length} vehicle${s(d.idle.length)} last completed a recorded booking at least 10 days ago. ${d.idle[0].v.id} has the longest gap at ${d.idle[0].days} days as of issue.`,
      'Confirm whether the booking records are complete, then review upcoming demand and opportunities to redeploy spare vehicles.');

    if (d.regoSoon.length) add(60, 'Medium', 'Registrations falling due shortly',
      `${d.regoSoon.length} registration${s(d.regoSoon.length)} expire${d.regoSoon.length === 1 ? 's' : ''} within a fortnight.`,
      'Start renewals now so none slip into the expired column before the next report.');

    if (d.svcSoon.length) add(56, 'Medium', 'Plan the next services',
      `${d.svcSoon.length} vehicle${s(d.svcSoon.length)} are due within 14 days, 500 km or 25 engine hours on an active service trigger.`,
      'Book these against quiet days in the schedule rather than letting them fall due mid-job.');

    if (d.statusCounts['Out of service']) add(52, 'Medium', 'Vehicles sitting out of service',
      `${d.statusCounts['Out of service']} vehicle${s(d.statusCounts['Out of service'])} ${d.statusCounts['Out of service'] === 1 ? 'is' : 'are'} marked out of service.`,
      'Each one is unavailable capacity. Confirm the return-to-service date or decide whether to replace or dispose.');

    if (d.availabilityPct < 0.6 && d.vehicles.length) add(48, 'Medium', 'Review available fleet capacity',
      `Only ${pct(d.availabilityPct)} of the fleet is showing as available.`,
      'Check whether this reflects genuine demand or stale status records — vehicles left marked In use after a job overstate utilisation.');

    if (d.avgResolveDays !== null && d.avgResolveDays > 14) add(44, 'Low', 'Defects are taking a while to close',
      `Defects resolved this ${d.period.word} took ${Math.round(d.avgResolveDays)} days on average.`,
      'Longer resolution means vehicles spend more of the month degraded. Look at where the time goes — parts, workshop capacity, or approval.');

    // Closing entries so the section always carries something.
    if (!d.regoExp.length && !d.regoSoon.length && !d.regoUnknown.length && d.vehicles.length) add(20, 'Low', 'Keep registration records complete',
      'No recorded registration is flagged as expired or due within a fortnight.',
      'Check that every vehicle has an expiry date recorded and keep renewal reminders up to date.');
    if (!d.svcOverdue.length) add(19, 'Low', 'Servicing is on schedule',
      'No vehicle has passed a service limit.',
      'Verify that service dates and meter readings are complete, then maintain the planned servicing schedule.');
    if (!d.defCounts.Critical) add(18, 'Low', 'No critical defects outstanding',
      `${d.openDefects.length} defect${s(d.openDefects.length)} open, none at critical.`,
      'Continue clearing by priority so none escalate between reports.');

    // Keep the final page focused on the four highest-priority actions.
    return out.sort((a, b) => b.weight - a.weight).slice(0, 4);
  }

  /* ------------------------------------------------------------------ style helpers */
  const border = (color = COLOR.rule) => ({ style: 'thin', color: { argb: color } });
  const borderAll = (color = COLOR.rule) => ({ top: border(color), left: border(color), bottom: border(color), right: border(color) });

  const styles = {
    title:    { font: { name: FONT_HEAD, size: 28, bold: true, color: { argb: COLOR.white } } },
    sub:      { font: { name: FONT_HEAD, size: 14, color: { argb: COLOR.mint } } },
    smallW:   { font: { name: FONT_BODY, size: 10, color: { argb: COLOR.white } } },

    h1:       { font: { name: FONT_HEAD, size: 20, bold: true, color: { argb: COLOR.navy } } },
    h2:       { font: { name: FONT_HEAD, size: 14, bold: true, color: { argb: COLOR.navy } } },
    sectionBar: {
      font: { name: FONT_HEAD, size: 11, bold: true, color: { argb: COLOR.white } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.navy } },
      alignment: { vertical: 'middle', horizontal: 'left', indent: 1 }
    },
    th: {
      font: { name: FONT_HEAD, size: 11, bold: true, color: { argb: COLOR.white } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.navy } },
      alignment: { vertical: 'middle', horizontal: 'left', indent: 1 },
      border: borderAll(COLOR.navy)
    },
    thRight: {
      font: { name: FONT_HEAD, size: 11, bold: true, color: { argb: COLOR.white } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.navy } },
      alignment: { vertical: 'middle', horizontal: 'right' },
      border: borderAll(COLOR.navy)
    },
    cell:     { font: { name: FONT_BODY, size: 11, color: { argb: COLOR.ink } }, alignment: { vertical: 'middle', horizontal: 'left', indent: 1 }, border: borderAll() },
    cellNum:  { font: { name: FONT_BODY, size: 11, color: { argb: COLOR.ink } }, alignment: { vertical: 'middle', horizontal: 'right' }, border: borderAll(), numFmt: '"$"#,##0' },
    cellPct:  { font: { name: FONT_BODY, size: 11, color: { argb: COLOR.ink } }, alignment: { vertical: 'middle', horizontal: 'right' }, border: borderAll(), numFmt: '0.0%' },
    cellInt:  { font: { name: FONT_BODY, size: 11, color: { argb: COLOR.ink } }, alignment: { vertical: 'middle', horizontal: 'right' }, border: borderAll() },
    cellDate: { font: { name: FONT_BODY, size: 11, color: { argb: COLOR.ink } }, alignment: { vertical: 'middle', horizontal: 'left', indent: 1 }, border: borderAll() },

    // Zebra fill for alternating rows.
    zebra:    { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.ruleSoft } } },

    // Totals row — bold with top rule.
    total:    {
      font: { name: FONT_HEAD, size: 11, bold: true, color: { argb: COLOR.navy } },
      border: { ...borderAll(), top: { style: 'medium', color: { argb: COLOR.navy } } }
    },

    // Metric tile for the summary sheet.
    tileLabel: {
      font: { name: FONT_HEAD, size: 10, bold: true, color: { argb: COLOR.muted } },
      alignment: { vertical: 'middle', horizontal: 'left', indent: 1 },
      border: { bottom: border(COLOR.rule) }
    },
    tileValue: {
      font: { name: FONT_HEAD, size: 20, bold: true, color: { argb: COLOR.navy } },
      alignment: { vertical: 'middle', horizontal: 'left', indent: 1 }
    },
    tileSub: {
      font: { name: FONT_BODY, size: 10, color: { argb: COLOR.muted } },
      alignment: { vertical: 'middle', horizontal: 'left', indent: 1 }
    }
  };

  // Tone colour for variance / status cells.
  function tone(kind) {
    if (kind === 'good')  return { font: { bold: true, color: { argb: COLOR.green } } };
    if (kind === 'warn')  return { font: { bold: true, color: { argb: COLOR.amber } } };
    if (kind === 'bad')   return { font: { bold: true, color: { argb: COLOR.red   } } };
    return {};
  }

  function statusDot(kind) {
    if (kind === 'good') return '● ';
    if (kind === 'warn') return '● ';
    if (kind === 'bad')  return '● ';
    return '';
  }

  function applyStyle(cell, ...parts) {
    parts.forEach((p) => {
      if (!p) return;
      Object.entries(p).forEach(([k, v]) => {
        if (v && typeof v === 'object' && !Array.isArray(v) && cell[k] && typeof cell[k] === 'object') {
          cell[k] = { ...cell[k], ...v };
        } else {
          cell[k] = v;
        }
      });
    });
  }

  /* ------------------------------------------------------------------ sheets */

  async function buildCover(wb, data, logoBuf) {
    const ws = wb.addWorksheet('Cover', {
      views: [{ showGridLines: false }],
      pageSetup: { orientation: 'portrait', paperSize: 9, margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } }
    });

    // Brand-blue band
    ws.getColumn(1).width = 4;
    for (let c = 2; c <= 10; c++) ws.getColumn(c).width = 12;

    // Band rows 1..7 — solid brand blue, white logo on the left.
    for (let r = 1; r <= 7; r++) {
      ws.getRow(r).height = 24;
      for (let c = 1; c <= 10; c++) {
        ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.blue } };
      }
    }

    // Logo as embedded image. Positioned by cell coords.
    if (logoBuf) {
      const imgId = wb.addImage({ buffer: logoBuf, extension: 'png' });
      ws.addImage(imgId, { tl: { col: 1.2, row: 1.6 }, ext: { width: 220, height: 60 } });
    } else {
      ws.getCell('B3').value = 'ASTREA';
      ws.getCell('B3').font = { name: FONT_HEAD, size: 24, bold: true, color: { argb: COLOR.white } };
    }

    // Title block, further down the band.
    ws.mergeCells('B9:J10');
    const title = ws.getCell('B9');
    title.value = `${data.period.kind} Fleet Report`;
    title.font = { name: FONT_HEAD, size: 32, bold: true, color: { argb: COLOR.blue } };   // headings in brand blue (typography guide)
    title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    ws.mergeCells('B11:J11');
    const sub = ws.getCell('B11');
    sub.value = data.period.label + (data.isPartial ? (data.isYear ? ' (year to date)' : ' (month to date)') : '');
    sub.font = { name: FONT_HEAD, size: 16, color: { argb: COLOR.muted } };
    sub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    ws.mergeCells('B12:J12');
    ws.getCell('B12').value = `Issued ${T.fmtKey(data.today)}`;
    ws.getCell('B12').font = { name: FONT_BODY, size: 10, color: { argb: COLOR.muted } };
    ws.getCell('B12').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    // Brand-blue rule under the title.
    for (let c = 2; c <= 10; c++) {
      ws.getCell(14, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.mint } };
    }
    ws.getRow(14).height = 3;

    // Notes block — concise, no fluff.
    ws.mergeCells('B17:J17');
    ws.getCell('B17').value = 'Notes';
    applyStyle(ws.getCell('B17'), styles.h2);

    ws.mergeCells('B19:J21');
    const notes = ws.getCell('B19');
    notes.value =
      `•  Covers spend (fuel, Linkt tolls, servicing and repairs), compliance, defects and the vehicle register for ${data.period.label}.\n` +
      `•  Imported to: fuel cards ${data.fuelThrough ? T.fmtKey(data.fuelThrough) : 'none yet'}, Linkt tolls ${data.tollThrough ? T.fmtKey(data.tollThrough) : 'none yet'}. Forecast = each cost's average month over the months with complete data, not a budget.\n` +
      `•  Recommendations are flagged from spend, compliance, defect and data-coverage checks.`;
    notes.font = { name: FONT_BODY, size: 11, color: { argb: COLOR.ink } };
    notes.alignment = { wrapText: true, vertical: 'top', horizontal: 'left', indent: 1 };

    // Contents block.
    ws.mergeCells('B24:J24');
    ws.getCell('B24').value = 'Contents';
    applyStyle(ws.getCell('B24'), styles.h2);

    const contents = [
      ['1', 'Executive summary',     'Key metrics, fleet composition and trends'],
      ['2', 'Monthly spend',          data.isYear ? 'Month by month through the year, and the year outlook' : 'Twelve-month table and year outlook'],
      ['3', 'Compliance and risk',    'Rego, servicing and open defects'],
      ['4', 'Vehicle register',       'Full fleet with status and odometer'],
      ['5', 'Recommendations',        'Actions flagged by the figures']
    ];
    contents.forEach((row, i) => {
      const r = 26 + i;
      ws.getCell(`B${r}`).value = row[0];
      ws.getCell(`B${r}`).font = { name: FONT_HEAD, size: 11, bold: true, color: { argb: COLOR.mint } };
      ws.getCell(`B${r}`).alignment = { vertical: 'middle', horizontal: 'left' };
      ws.mergeCells(`C${r}:D${r}`);
      ws.getCell(`C${r}`).value = row[1];
      ws.getCell(`C${r}`).font = { name: FONT_HEAD, size: 11, bold: true, color: { argb: COLOR.navy } };
      ws.mergeCells(`E${r}:J${r}`);
      ws.getCell(`E${r}`).value = row[2];
      ws.getCell(`E${r}`).font = { name: FONT_BODY, size: 11, color: { argb: COLOR.muted } };
    });

    // Footer bar.
    for (let c = 1; c <= 10; c++) {
      ws.getCell(46, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.navy } };
    }
    ws.getRow(46).height = 22;
    ws.mergeCells('B46:J46');
    const foot = ws.getCell('B46');
    foot.value = 'Astrea Group Pty Ltd · Fleet Operations · Internal use';
    foot.font = { name: FONT_BODY, size: 10, color: { argb: COLOR.white } };
    foot.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  }

  function buildSummary(wb, data) {
    const ws = wb.addWorksheet('Summary', { views: [{ showGridLines: false, state: 'frozen', ySplit: 3 }] });

    ws.getColumn(1).width = 3;
    [26, 18, 18, 18, 18].forEach((w, i) => { ws.getColumn(i + 2).width = w; });

    // Title row
    ws.getRow(1).height = 36;
    ws.mergeCells('B1:F1');
    const h = ws.getCell('B1');
    h.value = `Executive summary · ${data.period.label}`;
    h.font = { name: FONT_HEAD, size: 18, bold: true, color: { argb: COLOR.navy } };
    h.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    // Mint rule
    for (let c = 2; c <= 6; c++) ws.getCell(2, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.mint } };
    ws.getRow(2).height = 3;

    // Spend block — actual spend and the Cost sheet's forecast. No target or
    // variance: a growing fleet always runs above its own past average.
    const curMonthName = data.period.name;
    const cm = data.curMonth;
    const yf = data.yearForecast;
    const split = ([['Fuel', cm.fuel], ['Tolls', cm.toll], ['Servicing', cm.planned], ['Repairs', cm.unplanned]]
      .filter(([, n]) => n > 0.5).map(([l, n]) => `${l} ${aud(n)}`).join(' · ') || 'Nothing recorded')
      + (data.tollsLoaded ? '' : ' · Linkt tolls could not be loaded, so they are NOT included — generate again');

    sectionBar(ws, 4, 'B', 'F', 'Spend and forecast');

    const rows = [
      // label, value, note
      [`${curMonthName} spend${data.isPartial ? (data.isYear ? ' (year to date)' : ' (month to date)') : ''}`, data.mtdActual, split],
      data.isYear ? [`${data.period.prevLabel} spend`, data.prevMonth.total, 'The year before, for comparison'] : [`Year to date (${data.now.year})`, data.ytdActual, `${data.monthsElapsedFull} full month${data.monthsElapsedFull === 1 ? '' : 's'} plus ${curMonthName}`],
      [yf ? `Forecast for ${yf.year}` : 'Twelve months', yf ? yf.total : data.annualTotal,
        yf ? 'Spent so far plus each cost\'s average month for the days not in yet' : 'Total for the twelve months shown'],
      ['Still to come this year', yf ? yf.total - yf.actual : null, yf ? `As at ${T.fmtKey(data.today)}` : 'Only for the current year'],
      ['Average month', data.avgMonth, 'Each cost over the months with complete data (the forecast basis)']
    ];

    // Header row
    const hdrRow = 6;
    [['Metric', 2], ['Amount', 3], ['Notes', 4]].forEach(([text, c]) => {
      const cell = ws.getCell(hdrRow, c);
      cell.value = text;
      applyStyle(cell, c === 3 ? styles.thRight : styles.th);
    });
    ws.mergeCells(hdrRow, 4, hdrRow, 6);
    ws.getRow(hdrRow).height = 24;

    rows.forEach((row, i) => {
      const r = hdrRow + 1 + i;
      ws.getRow(r).height = 22;
      const [label, val, note] = row;
      ws.getCell(r, 2).value = label;  applyStyle(ws.getCell(r, 2), styles.cell);
      ws.getCell(r, 3).value = val;    applyStyle(ws.getCell(r, 3), styles.cellNum);
      ws.mergeCells(r, 4, r, 6);
      ws.getCell(r, 4).value = note;   applyStyle(ws.getCell(r, 4), styles.cell);
      if (i === 2 && yf) ws.getCell(r, 3).font = { ...(ws.getCell(r, 3).font || {}), bold: true, color: { argb: 'FF7658D6' } };
      if (i % 2 === 1) [2, 3, 4].forEach((c) => applyStyle(ws.getCell(r, c), styles.zebra));
    });

    // Fleet block
    const fleetTop = hdrRow + 1 + rows.length + 2;
    sectionBar(ws, fleetTop, 'B', 'F', 'Fleet & compliance snapshot');

    const fleetRows = [
      ['Vehicles in fleet',              data.vehicles.length,              null, 'int'],
      ['Available',                      data.statusCounts['Available'],    null, 'int'],
      ['In workshop',                    data.statusCounts['In workshop'],  null, 'int'],
      ['Out of service',                 data.statusCounts['Out of service'], null, 'int'],
      ['Availability',                   data.availabilityPct,              null, 'pct'],
      ['Overdue services',               data.svcOverdue.length,            data.svcOverdue.length ? 'bad' : 'good', 'int'],
      ['Services due soon (date / km / hours)', data.svcSoon.length,          data.svcSoon.length ? 'warn' : 'good', 'int'],
      ['Expired registrations',          data.regoExp.length,               data.regoExp.length ? 'bad' : 'good', 'int'],
      ['Registrations due in 2 weeks',   data.regoSoon.length,              data.regoSoon.length ? 'warn' : 'good', 'int'],
      ['Open critical defects',          data.defCounts.Critical,           data.defCounts.Critical ? 'bad' : 'good', 'int'],
      ['Open high defects',              data.defCounts.High,               data.defCounts.High ? 'warn' : 'good', 'int']
    ];

    const fh = fleetTop + 2;
    ['Measure', 'Value'].forEach((text, i) => {
      const cell = ws.getCell(fh, 2 + i);
      cell.value = text;
      applyStyle(cell, i === 0 ? styles.th : styles.thRight);
    });
    ws.getRow(fh).height = 24;

    fleetRows.forEach(([label, val, kind, fmt], i) => {
      const r = fh + 1 + i;
      ws.getRow(r).height = 20;
      ws.getCell(r, 2).value = kind ? statusDot(kind) + label : label;
      applyStyle(ws.getCell(r, 2), styles.cell);
      if (kind) applyStyle(ws.getCell(r, 2), tone(kind));
      const valCell = ws.getCell(r, 3);
      valCell.value = val;
      applyStyle(valCell, fmt === 'pct' ? styles.cellPct : styles.cellInt);
      if (kind) applyStyle(valCell, tone(kind));
      if (i % 2 === 1) [2, 3].forEach((c) => applyStyle(ws.getCell(r, c), styles.zebra));
    });

    // ---- Fleet composition by type ----
    let compRow = fh + 1 + fleetRows.length + 2;
    sectionBar(ws, compRow, 'B', 'F', 'Fleet composition by type');
    compRow += 2;
    ['Type', 'Count', '', '', 'Share'].forEach((t, i) => {
      if (!t) return;
      const cell = ws.getCell(compRow, 2 + i);
      cell.value = t;
      applyStyle(cell, i === 0 ? styles.th : styles.thRight);
    });
    ws.getRow(compRow).height = 24;
    const compFirst = compRow + 1;
    data.byType.forEach(({ type, count }, i) => {
      const r = compRow + 1 + i;
      ws.getRow(r).height = 22;
      ws.getCell(r, 2).value = type;  applyStyle(ws.getCell(r, 2), styles.cell);
      ws.getCell(r, 3).value = count; applyStyle(ws.getCell(r, 3), styles.cellInt);
      ws.getCell(r, 6).value = data.vehicles.length ? count / data.vehicles.length : 0;
      applyStyle(ws.getCell(r, 6), styles.cellPct);
      if (i % 2 === 1) [2, 3, 6].forEach((c) => applyStyle(ws.getCell(r, c), styles.zebra));
    });
    const compLast = compRow + data.byType.length;

    // ---- Top spending vehicles in the period ----
    let spRow = compLast + 3;
    sectionBar(ws, spRow, 'B', 'F', 'Top spending vehicles · ' + data.period.label);
    spRow += 2;
    ['Vehicle', 'Fuel', 'Tolls', 'Servicing + repairs', 'Total'].forEach((t, i) => {
      const cell = ws.getCell(spRow, 2 + i);
      cell.value = t;
      applyStyle(cell, i === 0 ? styles.th : styles.thRight);
    });
    ws.getRow(spRow).height = 24;
    const spFirst = spRow + 1;
    data.topSpenders.forEach(({ id, cost, parts }, i) => {
      const p = parts || { fuel: cost, toll: 0, planned: 0, unplanned: 0 };
      const r = spRow + 1 + i;
      ws.getRow(r).height = 22;
      ws.getCell(r, 2).value = id;                      applyStyle(ws.getCell(r, 2), styles.cell);
      ws.getCell(r, 3).value = p.fuel;                  applyStyle(ws.getCell(r, 3), styles.cellNum);
      ws.getCell(r, 4).value = p.toll;                  applyStyle(ws.getCell(r, 4), styles.cellNum);
      ws.getCell(r, 5).value = p.planned + p.unplanned; applyStyle(ws.getCell(r, 5), styles.cellNum);
      ws.getCell(r, 6).value = cost;                    applyStyle(ws.getCell(r, 6), styles.cellNum);
      ws.getCell(r, 6).font = { ...(ws.getCell(r, 6).font || {}), bold: true };
      if (i % 2 === 1) [2, 3, 4, 5, 6].forEach((c) => applyStyle(ws.getCell(r, c), styles.zebra));
    });
    const spLast = spRow + data.topSpenders.length;

    // ---- Against the previous period (month, or year) ----
    let moRow = spLast + 3;
    sectionBar(ws, moRow, 'B', 'F', data.isYear ? 'Year-on-year comparison' : 'Month-on-month comparison');
    moRow += 2;
    const prevName = data.period.prevLabel;
    [' ', data.period.name, prevName, 'Avg month', 'Trend'].forEach((t, i) => {
      const cell = ws.getCell(moRow, 2 + i);
      cell.value = t;
      applyStyle(cell, i === 0 ? styles.th : styles.thRight);
    });
    ws.getRow(moRow).height = 24;
    // The average month is the Cost sheet's forecast basis: each cost over its complete months.
    const b = data.basis;
    const avg12 = (k) => data.months.reduce((t, m) => t + (m[k] || 0), 0) / 12;
    const avg12S = avg12('svcCount');
    const avg12D = avg12('defCount');
    const moStats = [
      ['Total spend',     data.curMonth.total,     data.prevMonth ? data.prevMonth.total : null,     data.avgMonth, data.momPct],
      ['Fuel spend',      data.curMonth.fuel,      data.prevMonth ? data.prevMonth.fuel : null,      b ? b.fuel : avg12('fuel'), null],
      ['Toll spend',      data.curMonth.toll,      data.prevMonth ? data.prevMonth.toll : null,      b ? b.toll : avg12('toll'), null],
      ['Planned spend',   data.curMonth.planned,   data.prevMonth ? data.prevMonth.planned : null,   b ? b.planned : avg12('planned'), null],
      ['Unplanned spend', data.curMonth.unplanned, data.prevMonth ? data.prevMonth.unplanned : null, b ? b.unplanned : avg12('unplanned'), null],
      ['Service events',  data.curMonth.svcCount,  data.prevMonth ? data.prevMonth.svcCount : null,  Math.round(avg12S), null],
      ['Defects resolved', data.curMonth.defCount, data.prevMonth ? data.prevMonth.defCount : null,  Math.round(avg12D), null]
    ];
    moStats.forEach(([label, cur, prev, avg, trend], i) => {
      const r = moRow + 1 + i;
      ws.getRow(r).height = 22;
      ws.getCell(r, 2).value = label; applyStyle(ws.getCell(r, 2), styles.cell);
      const isMoney = i < 5;
      const fmt = isMoney ? styles.cellNum : styles.cellInt;
      ws.getCell(r, 3).value = cur;  applyStyle(ws.getCell(r, 3), fmt);
      ws.getCell(r, 4).value = prev; applyStyle(ws.getCell(r, 4), fmt);
      ws.getCell(r, 5).value = avg != null ? (isMoney ? Math.round(avg) : avg) : null;
      applyStyle(ws.getCell(r, 5), fmt);
      if (trend != null) {
        const up = trend > 0;
        const arrow = up ? '▲' : '▼';
        ws.getCell(r, 6).value = arrow + ' ' + (up ? '+' : '') + Math.round(trend * 100) + '%';
        applyStyle(ws.getCell(r, 6), styles.cell, tone(up ? 'bad' : 'good'));
        ws.getCell(r, 6).alignment = { vertical: 'middle', horizontal: 'center' };
      } else {
        ws.getCell(r, 6).value = '—'; applyStyle(ws.getCell(r, 6), styles.cell);
        ws.getCell(r, 6).alignment = { vertical: 'middle', horizontal: 'center' };
        ws.getCell(r, 6).font = { ...styles.cell.font, color: { argb: COLOR.muted } };
      }
      if (i % 2 === 1) [2, 3, 4, 5, 6].forEach((c) => applyStyle(ws.getCell(r, c), styles.zebra));
    });
    const moFirst = moRow + 1, moLast = moRow + moStats.length;
  }

  function buildSpend(wb, data) {
    const ws = wb.addWorksheet('Monthly spend', { views: [{ showGridLines: false, state: 'frozen', ySplit: 6 }] });
    ws.getColumn(1).width = 3;
    const widths = [18, 16, 16, 16, 16, 16, 16, 14, 12];
    widths.forEach((w, i) => { ws.getColumn(i + 2).width = w; });

    ws.getRow(1).height = 36;
    ws.mergeCells('B1:J1');
    const h = ws.getCell('B1');
    h.value = data.isYear ? `Monthly spend · ${data.now.year}` : 'Monthly spend · last 12 months';
    h.font = { name: FONT_HEAD, size: 18, bold: true, color: { argb: COLOR.navy } };
    h.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    for (let c = 2; c <= 10; c++) ws.getCell(2, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.mint } };
    ws.getRow(2).height = 3;

    // Sub note
    ws.mergeCells('B4:J4');
    ws.getCell('B4').value = `Fuel, Linkt tolls, servicing and repairs  ·  imported to: fuel cards ${data.fuelThrough ? T.fmtKey(data.fuelThrough) : 'none yet'}, Linkt tolls ${data.tollThrough ? T.fmtKey(data.tollThrough) : 'none yet'} (months after those dates are missing that cost, not cheaper)`;
    ws.getCell('B4').font = { name: FONT_BODY, size: 10, italic: true, color: { argb: COLOR.muted } };
    ws.getCell('B4').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    const hdrRow = 6;
    const headers = ['Month', 'Planned', 'Unplanned', 'Fuel', 'Tolls', 'Total', 'Share fuel', 'Share tolls', 'Jobs'];
    headers.forEach((text, i) => {
      const cell = ws.getCell(hdrRow, 2 + i);
      cell.value = text;
      applyStyle(cell, i === 0 ? styles.th : styles.thRight);
    });
    ws.getRow(hdrRow).height = 24;

    data.months.forEach((mo, i) => {
      const r = hdrRow + 1 + i;
      ws.getRow(r).height = 20;
      const isCurrent = i === data.curIdx;

      ws.getCell(r, 2).value = mo.label + (i === data.curIdx && data.isPartial ? ' (to date)' : mo.future ? ' (to come)' : '');
      applyStyle(ws.getCell(r, 2), styles.cell);
      ws.getCell(r, 3).value = mo.planned;    applyStyle(ws.getCell(r, 3), styles.cellNum);
      ws.getCell(r, 4).value = mo.unplanned;  applyStyle(ws.getCell(r, 4), styles.cellNum);
      ws.getCell(r, 5).value = mo.fuel;       applyStyle(ws.getCell(r, 5), styles.cellNum);
      ws.getCell(r, 6).value = mo.toll;       applyStyle(ws.getCell(r, 6), styles.cellNum);
      ws.getCell(r, 7).value = mo.total;      applyStyle(ws.getCell(r, 7), styles.cellNum);
      ws.getCell(r, 8).value = mo.total > 0 ? mo.fuel / mo.total : 0; applyStyle(ws.getCell(r, 8), styles.cellPct);
      ws.getCell(r, 9).value = mo.total > 0 ? mo.toll / mo.total : 0; applyStyle(ws.getCell(r, 9), styles.cellPct);
      ws.getCell(r, 10).value = mo.svcCount + mo.defCount; applyStyle(ws.getCell(r, 10), styles.cellInt);

      if (isCurrent) {
        for (let c = 2; c <= 10; c++) applyStyle(ws.getCell(r, c), { font: { bold: true } });
        ws.getCell(r, 2).border = { ...ws.getCell(r, 2).border, left: { style: 'thick', color: { argb: COLOR.mint } } };
      } else if (i % 2 === 1) {
        for (let c = 2; c <= 10; c++) applyStyle(ws.getCell(r, c), styles.zebra);
      }
    });

    // Totals
    const totRow = hdrRow + 1 + data.months.length;
    ws.getRow(totRow).height = 24;
    const plannedTotal   = data.months.reduce((t, m) => t + m.planned, 0);
    const unplannedTotal = data.months.reduce((t, m) => t + m.unplanned, 0);
    ws.getCell(totRow, 2).value = data.isYear ? `${data.now.year}${data.isPartial ? ' to date' : ' total'}` : 'Twelve-month total';
    ws.getCell(totRow, 3).value = plannedTotal;
    ws.getCell(totRow, 4).value = unplannedTotal;
    const fuelTotal = data.months.reduce((t, m) => t + m.fuel, 0);
    const tollTotal = data.months.reduce((t, m) => t + m.toll, 0);
    ws.getCell(totRow, 5).value = fuelTotal;
    ws.getCell(totRow, 6).value = tollTotal;
    ws.getCell(totRow, 7).value = data.annualTotal;
    ws.getCell(totRow, 8).value = data.annualTotal > 0 ? fuelTotal / data.annualTotal : 0;
    ws.getCell(totRow, 9).value = data.annualTotal > 0 ? tollTotal / data.annualTotal : 0;
    ws.getCell(totRow, 10).value = data.months.reduce((t, m) => t + m.svcCount + m.defCount, 0);
    for (let c = 2; c <= 10; c++) {
      const money = c >= 3 && c <= 7;
      applyStyle(ws.getCell(totRow, c), money ? styles.cellNum : c === 8 || c === 9 ? styles.cellPct : c === 2 ? styles.cell : styles.cellInt);
      applyStyle(ws.getCell(totRow, c), styles.total);
    }

    // Year outlook — the Cost sheet's forecast: spend so far plus each cost's
    // average month for the days not in yet.
    const projRow = totRow + 3;
    sectionBar(ws, projRow, 'B', 'J', 'Year outlook');
    const yf = data.yearForecast;
    const projRows = yf ? [
      [`${yf.year} spent so far`, yf.actual, `As at ${T.fmtKey(data.today)}`],
      [`Forecast for ${yf.year}`, yf.total, 'Spent so far plus each cost\'s average month for the days not in yet'],
      ['Still to come this year', yf.total - yf.actual, `Fuel after ${yf.fuelReach ? T.fmtKey(yf.fuelReach) : 'the latest import'}, tolls after ${yf.tollReach ? T.fmtKey(yf.tollReach) : 'the latest statement'}, servicing and repairs to 31 December`],
      ['Average month', data.avgMonth, 'Each cost over the months with complete data']
    ] : [
      [data.isYear ? `${data.now.year} total` : 'Twelve-month total', data.annualTotal, ''],
      ['Average month', data.avgMonth, 'Each cost over the months with complete data']
    ];
    const pHdr = projRow + 2;
    [['Measure', 2], ['Amount', 3], ['Notes', 4]].forEach(([t, c]) => {
      const cell = ws.getCell(pHdr, c);
      cell.value = t;
      applyStyle(cell, c === 3 ? styles.thRight : styles.th);
    });
    ws.mergeCells(pHdr, 4, pHdr, 10);
    ws.getRow(pHdr).height = 24;
    projRows.forEach(([label, val, note], i) => {
      const r = pHdr + 1 + i;
      ws.getRow(r).height = 22;
      ws.getCell(r, 2).value = label; applyStyle(ws.getCell(r, 2), styles.cell);
      ws.getCell(r, 3).value = val;   applyStyle(ws.getCell(r, 3), styles.cellNum);
      ws.mergeCells(r, 4, r, 10);
      ws.getCell(r, 4).value = note;  applyStyle(ws.getCell(r, 4), styles.cell);
      if (yf && i === 1) ws.getCell(r, 3).font = { ...(ws.getCell(r, 3).font || {}), bold: true, color: { argb: 'FF7658D6' } };
      if (i % 2 === 1) [2, 3, 4].forEach((c) => applyStyle(ws.getCell(r, c), styles.zebra));
    });
  }

  function buildCompliance(wb, data) {
    const ws = wb.addWorksheet('Compliance', { views: [{ showGridLines: false }] });
    ws.getColumn(1).width = 3;
    [12, 32, 16, 20, 16].forEach((w, i) => { ws.getColumn(i + 2).width = w; });

    ws.getRow(1).height = 36;
    ws.mergeCells('B1:F1');
    const h = ws.getCell('B1');
    h.value = 'Compliance and risk';
    h.font = { name: FONT_HEAD, size: 18, bold: true, color: { argb: COLOR.navy } };
    h.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    for (let c = 2; c <= 6; c++) ws.getCell(2, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.mint } };
    ws.getRow(2).height = 3;

    // Registration section — list every vehicle needing attention.
    let row = 4;
    sectionBar(ws, row, 'B', 'F', `Registrations needing attention (${data.regoExp.length} expired, ${data.regoSoon.length} within 2 weeks)`);
    row += 2;
    ['Vehicle', 'Rego', 'Status', 'Expiry', 'Days'].forEach((t, i) => {
      const cell = ws.getCell(row, 2 + i);
      cell.value = t;
      applyStyle(cell, i < 3 ? styles.th : styles.thRight);
    });
    ws.getRow(row).height = 24;
    const regoAll = [...data.regoExp, ...data.regoSoon];
    if (!regoAll.length) {
      row += 1;
      ws.mergeCells(`B${row}:F${row}`);
      ws.getCell(row, 2).value = 'Nothing to action — every registration is current.';
      applyStyle(ws.getCell(row, 2), styles.cell, { font: { italic: true, color: { argb: COLOR.muted } } });
      row += 1;
    } else {
      regoAll.forEach((x, i) => {
        row += 1;
        ws.getRow(row).height = 20;
        ws.getCell(row, 2).value = x.v.id;    applyStyle(ws.getCell(row, 2), styles.cell);
        ws.getCell(row, 3).value = x.v.rego || ''; applyStyle(ws.getCell(row, 3), styles.cell);
        const kind = x.r.state === 'overdue' ? 'bad' : 'warn';
        ws.getCell(row, 4).value = statusDot(kind) + (x.r.state === 'overdue' ? 'Expired' : 'Within 2 weeks');
        applyStyle(ws.getCell(row, 4), styles.cell, tone(kind));
        ws.getCell(row, 5).value = x.v.regoExpiry || ''; applyStyle(ws.getCell(row, 5), styles.cellDate);
        ws.getCell(row, 5).alignment = { ...styles.cellDate.alignment, horizontal: 'right' };
        ws.getCell(row, 6).value = x.r.days; applyStyle(ws.getCell(row, 6), styles.cellInt);
        if (i % 2 === 1) [2, 3, 4, 5, 6].forEach((c) => applyStyle(ws.getCell(row, c), styles.zebra));
      });
    }

    // Servicing section
    row += 3;
    sectionBar(ws, row, 'B', 'F', `Servicing (${data.svcOverdue.length} overdue, ${data.svcSoon.length} due soon)`);
    row += 2;
    ['Vehicle', 'Type', 'Status', 'Next service', 'Days / km'].forEach((t, i) => {
      const cell = ws.getCell(row, 2 + i);
      cell.value = t;
      applyStyle(cell, i < 3 ? styles.th : styles.thRight);
    });
    ws.getRow(row).height = 24;
    const svcAll = [...data.svcOverdue, ...data.svcSoon];
    if (!svcAll.length) {
      row += 1;
      ws.mergeCells(`B${row}:F${row}`);
      ws.getCell(row, 2).value = 'Nothing overdue — all services scheduled.';
      applyStyle(ws.getCell(row, 2), styles.cell, { font: { italic: true, color: { argb: COLOR.muted } } });
    } else {
      svcAll.forEach((x, i) => {
        row += 1;
        ws.getRow(row).height = 20;
        ws.getCell(row, 2).value = x.v.id;    applyStyle(ws.getCell(row, 2), styles.cell);
        ws.getCell(row, 3).value = x.v.type || ''; applyStyle(ws.getCell(row, 3), styles.cell);
        const kind = x.s.state === 'overdue' ? 'bad' : 'warn';
        ws.getCell(row, 4).value = statusDot(kind) + (x.s.state === 'overdue' ? 'Overdue' : 'Due soon');
        applyStyle(ws.getCell(row, 4), styles.cell, tone(kind));
        ws.getCell(row, 5).value = x.v.nextServiceDate || ''; applyStyle(ws.getCell(row, 5), styles.cellDate);
        ws.getCell(row, 5).alignment = { ...styles.cellDate.alignment, horizontal: 'right' };
        const daysKm = x.s.why;
        ws.getCell(row, 6).value = daysKm; applyStyle(ws.getCell(row, 6), styles.cell);
        ws.getCell(row, 6).alignment = { ...styles.cell.alignment, horizontal: 'right', indent: 0 };
        if (i % 2 === 1) [2, 3, 4, 5, 6].forEach((c) => applyStyle(ws.getCell(row, c), styles.zebra));
      });
    }

    // Open defects
    row += 3;
    sectionBar(ws, row, 'B', 'F', `Open defects by priority (${data.openDefects.length} total)`);
    row += 2;
    ['Priority', 'Open count'].forEach((t, i) => {
      const cell = ws.getCell(row, 2 + i);
      cell.value = t;
      applyStyle(cell, i === 0 ? styles.th : styles.thRight);
    });
    ws.getRow(row).height = 24;
    const priList = [
      ['Critical', data.defCounts.Critical, data.defCounts.Critical ? 'bad' : 'good'],
      ['High',     data.defCounts.High,     data.defCounts.High     ? 'warn': 'good'],
      ['Medium',   data.defCounts.Medium,   data.defCounts.Medium   ? 'warn': 'good'],
      ['Low',      data.defCounts.Low,      '']
    ];
    priList.forEach(([label, val, kind], i) => {
      row += 1;
      ws.getRow(row).height = 20;
      ws.getCell(row, 2).value = kind ? statusDot(kind) + label : label;
      applyStyle(ws.getCell(row, 2), styles.cell);
      if (kind) applyStyle(ws.getCell(row, 2), tone(kind));
      ws.getCell(row, 3).value = val;   applyStyle(ws.getCell(row, 3), styles.cellInt);
      if (kind) applyStyle(ws.getCell(row, 3), tone(kind));
      if (i % 2 === 1) [2, 3].forEach((c) => applyStyle(ws.getCell(row, c), styles.zebra));
    });
  }

  function buildRegister(wb, data) {
    const ws = wb.addWorksheet('Vehicle register', { views: [{ showGridLines: false, state: 'frozen', ySplit: 4 }] });
    ws.getColumn(1).width = 3;
    const widths = [10, 10, 12, 20, 16, 14, 14, 14, 14];
    widths.forEach((w, i) => { ws.getColumn(i + 2).width = w; });

    ws.getRow(1).height = 36;
    ws.mergeCells('B1:J1');
    const h = ws.getCell('B1');
    h.value = `Vehicle register · ${data.vehicles.length} vehicles`;
    h.font = { name: FONT_HEAD, size: 18, bold: true, color: { argb: COLOR.navy } };
    h.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    for (let c = 2; c <= 10; c++) ws.getCell(2, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.mint } };
    ws.getRow(2).height = 3;

    const headers = ['ID', 'Rego', 'Type', 'Make / Model', 'Status', 'Odometer', 'Next service', 'Rego expiry', 'Owner'];
    const hdrRow = 4;
    headers.forEach((t, i) => {
      const cell = ws.getCell(hdrRow, 2 + i);
      cell.value = t;
      applyStyle(cell, i < 5 ? styles.th : styles.thRight);
    });
    ws.getRow(hdrRow).height = 24;

    const sorted = [...data.vehicles].sort((a, b) => (a.id || '').localeCompare(b.id || ''));
    sorted.forEach((v, i) => {
      const r = hdrRow + 1 + i;
      ws.getRow(r).height = 20;
      ws.getCell(r, 2).value = v.id || '';
      ws.getCell(r, 3).value = v.rego || '';
      ws.getCell(r, 4).value = v.type || '';
      ws.getCell(r, 5).value = [v.make, v.model].filter(Boolean).join(' ');
      ws.getCell(r, 6).value = v.status || '';
      ws.getCell(r, 7).value = v.odometer != null ? Number(v.odometer) : '';
      ws.getCell(r, 8).value = v.nextServiceDate || '';
      ws.getCell(r, 9).value = v.regoExpiry || '';
      ws.getCell(r, 10).value = v.hired ? `Hired · ${v.hireCompany || ''}` : 'Owned';

      for (let c = 2; c <= 6; c++) applyStyle(ws.getCell(r, c), styles.cell);
      applyStyle(ws.getCell(r, 7), styles.cellInt);
      ws.getCell(r, 7).numFmt = '#,##0 "km"';
      applyStyle(ws.getCell(r, 8), styles.cellDate);
      ws.getCell(r, 8).alignment = { ...styles.cellDate.alignment, horizontal: 'right' };
      applyStyle(ws.getCell(r, 9), styles.cellDate);
      ws.getCell(r, 9).alignment = { ...styles.cellDate.alignment, horizontal: 'right' };
      applyStyle(ws.getCell(r, 10), styles.cell);
      ws.getCell(r, 10).alignment = { ...styles.cell.alignment, horizontal: 'right', indent: 0 };

      // Status cell with dot indicator
      const st = v.status;
      if (st === 'Out of service') {
        ws.getCell(r, 6).value = statusDot('bad') + st;
        applyStyle(ws.getCell(r, 6), tone('bad'));
      } else if (st === 'In workshop') {
        ws.getCell(r, 6).value = statusDot('warn') + st;
        applyStyle(ws.getCell(r, 6), tone('warn'));
      } else if (st === 'Available') {
        ws.getCell(r, 6).value = statusDot('good') + st;
        applyStyle(ws.getCell(r, 6), tone('good'));
      }

      if (i % 2 === 1) [2, 3, 4, 5, 6, 7, 8, 9, 10].forEach((c) => applyStyle(ws.getCell(r, c), styles.zebra));
    });

    ws.autoFilter = { from: { row: hdrRow, column: 2 }, to: { row: hdrRow, column: 10 } };

  }

  // Section bar — navy row spanning columns, used to break up a sheet.
  function sectionBar(ws, row, startCol, endCol, text) {
    ws.mergeCells(`${startCol}${row}:${endCol}${row}`);
    const cell = ws.getCell(`${startCol}${row}`);
    cell.value = text;
    applyStyle(cell, styles.sectionBar);
    ws.getRow(row).height = 26;
    // Thin mint accent below
    const r2 = row + 1;
    const startC = startCol.charCodeAt(0) - 64;
    const endC = endCol.charCodeAt(0) - 64;
    for (let c = startC; c <= endC; c++) {
      ws.getCell(r2, c).border = { top: { style: 'medium', color: { argb: COLOR.mint } } };
    }
  }

  function aud(n) {
    return Number(n || 0).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
  }

  function buildRecommendations(wb, data) {
    const ws = wb.addWorksheet('Recommendations', { views: [{ showGridLines: false }] });
    ws.getColumn(1).width = 3;
    [5, 36, 16, 36].forEach((w, i) => { ws.getColumn(i + 2).width = w; });

    ws.getRow(1).height = 36;
    ws.mergeCells('B1:E1');
    const h = ws.getCell('B1');
    h.value = 'Recommendations · ' + data.period.label;
    h.font = { name: FONT_HEAD, size: 18, bold: true, color: { argb: COLOR.navy } };
    h.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    for (let c = 2; c <= 5; c++) ws.getCell(2, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.mint } };
    ws.getRow(2).height = 3;

    ws.mergeCells('B4:E4');
    ws.getCell('B4').value = 'Actions flagged by the figures, ordered by priority.';
    ws.getCell('B4').font = { name: FONT_BODY, size: 10, italic: true, color: { argb: COLOR.muted } };
    ws.getCell('B4').alignment = { wrapText: true, vertical: 'top', horizontal: 'left', indent: 1 };

    let row = 6;
    data.recommendations.forEach((rec, i) => {
      const priColor = rec.priority === 'High' ? COLOR.red : rec.priority === 'Medium' ? COLOR.amber : COLOR.green;
      const priBg    = rec.priority === 'High' ? COLOR.redSoft : rec.priority === 'Medium' ? COLOR.amberSoft : COLOR.greenSoft;

      // Number badge
      ws.getCell(row, 2).value = i + 1;
      ws.getCell(row, 2).font = { name: FONT_HEAD, size: 14, bold: true, color: { argb: COLOR.white } };
      ws.getCell(row, 2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: priColor } };
      ws.getCell(row, 2).alignment = { vertical: 'middle', horizontal: 'center' };
      ws.getCell(row, 2).border = borderAll(priColor);

      // Title
      ws.mergeCells('C' + row + ':D' + row);
      ws.getCell(row, 3).value = rec.title;
      ws.getCell(row, 3).font = { name: FONT_HEAD, size: 12, bold: true, color: { argb: COLOR.navy } };
      ws.getCell(row, 3).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

      // Priority chip
      ws.getCell(row, 5).value = rec.priority;
      ws.getCell(row, 5).font = { name: FONT_HEAD, size: 10, bold: true, color: { argb: priColor } };
      ws.getCell(row, 5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: priBg } };
      ws.getCell(row, 5).alignment = { vertical: 'middle', horizontal: 'center' };
      ws.getCell(row, 5).border = borderAll(priColor);
      ws.getRow(row).height = 26;
      row++;

      // Finding
      ws.mergeCells('C' + row + ':E' + row);
      ws.getCell(row, 3).value = rec.finding;
      ws.getCell(row, 3).font = { name: FONT_BODY, size: 11, color: { argb: COLOR.ink } };
      ws.getCell(row, 3).alignment = { wrapText: true, vertical: 'top', horizontal: 'left', indent: 1 };
      ws.getRow(row).height = 36;
      row++;

      // Action
      ws.getCell(row, 2).value = 'ACTION';
      ws.getCell(row, 2).font = { name: FONT_HEAD, size: 9, bold: true, color: { argb: COLOR.mint } };
      ws.getCell(row, 2).alignment = { vertical: 'top', horizontal: 'left' };
      ws.mergeCells('C' + row + ':E' + row);
      ws.getCell(row, 3).value = rec.action;
      ws.getCell(row, 3).font = { name: FONT_BODY, size: 11, color: { argb: COLOR.ink } };
      ws.getCell(row, 3).alignment = { wrapText: true, vertical: 'top', horizontal: 'left', indent: 1 };
      ws.getRow(row).height = 42;
      row++;

      // Divider
      for (let c = 2; c <= 5; c++) ws.getCell(row, c).border = { top: border(COLOR.ruleSoft) };
      ws.getRow(row).height = 10;
      row++;
    });

    // Method note
    row++;
    ws.mergeCells('B' + row + ':E' + row);
    ws.getCell('B' + row).value = 'Flagged automatically from spend, compliance state, defect ageing and data-coverage checks (fuel-card and Linkt imports). Review with the fleet manager before acting.';
    ws.getCell('B' + row).font = { name: FONT_BODY, size: 9, italic: true, color: { argb: COLOR.muted } };
    ws.getCell('B' + row).alignment = { wrapText: true, vertical: 'top', horizontal: 'left', indent: 1 };
  }

  /* ------------------------------------------------------------------ public */

  /**
   * Linkt tolls load on demand (they're the biggest table). Make sure they're
   * in before the report gathers its figures, or tolls would be missing. A
   * load already under way (e.g. started by the Cost sheet) returns at once,
   * so wait for it to finish too.
   */
  async function ensureTolls(notify) {
    const S = AD.store;
    if (!S.tollsState || !S.loadTolls) return;
    if (S.tollsState() === 'ready' || S.tollsState() === 'missing') return;
    if (notify) notify('Loading Linkt tolls… this can take up to a minute');
    try { await S.loadTolls(); } catch (e) { /* checked below */ }
    const t0 = Date.now();
    while (S.tollsState() === 'loading' && Date.now() - t0 < 180000) await new Promise((r) => setTimeout(r, 500));
    // One more go if it failed: a report without tolls is missing ~$20k a month.
    if (S.tollsState() === 'missing') {
      if (notify) notify('Retrying the Linkt tolls…');
      try { await S.loadTolls(true); } catch (e) { /* the report says tolls are missing */ }
    }
  }

  async function generate(onProgress, options = {}) {
    const notify = (text) => onProgress && onProgress(text);
    notify('Loading Excel engine…');
    const ExcelJS = await loadExcelJS();
    await ensureTolls(notify);
    notify('Gathering fleet data…');
    const data = gather(options.month, options);
    const logoBuf = await loadLogo();
    notify('Building workbook…');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Astrea Drive';
    wb.company = 'Astrea Group Pty Ltd';
    wb.created = new Date();
    wb.title = 'Fleet Performance Report';
    wb.subject = data.period.label;

    await buildCover(wb, data, logoBuf);
    buildSummary(wb, data);
    buildSpend(wb, data);
    buildCompliance(wb, data);
    buildRegister(wb, data);
    buildRecommendations(wb, data);

    notify('Writing file…');
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const filename = `Astrea ${data.period.kind} Fleet Report — ${data.period.label}.xlsx`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('Done.');
    return filename;
  }

  return { generate, gather, loadLogo, aud, ensureTolls };
})();
