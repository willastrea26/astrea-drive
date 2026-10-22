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

  // Astrea palette, in ExcelJS's AARRGGBB format.
  const COLOR = {
    navy:      'FF12283D',  // sidebar / primary brand
    navy2:     'FF1E3A52',
    paper:     'FF2C4762',
    mint:      'FF5FE0B4',  // accent + "under target" positive
    mintSoft:  'FFCFF5E6',
    ink:       'FF1E3148',  // body text
    muted:     'FF657C92',
    rule:      'FFD6DEE5',
    ruleSoft:  'FFEDF2F6',
    white:     'FFFFFFFF',
    red:       'FFD9534F',  // over target / overdue
    redSoft:   'FFFDE2E1',
    amber:     'FFD98A1F',
    amberSoft: 'FFFBE9CC',
    green:     'FF2F8F56',  // on target / clear
    greenSoft: 'FFDCF1E4'
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
      const r = await fetch('assets/logo-horizontal-navy.png', { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return null;
      return await r.arrayBuffer();
    } catch (e) { return null; }
  }

  /* ------------------------------------------------------------------ data
   * One pass over the stores so every sheet works from the same snapshot.
   */
  function gather(monthKey) {
    const today = T.todayKey();
    const current = T.parts(Date.now());
    const selected = monthKey || today.slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(selected) || selected > today.slice(0, 7)) {
      throw new Error('Choose a valid reporting month that is not in the future.');
    }
    const [year, month] = selected.split('-').map(Number);
    const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    const reportEnd = monthEnd < today ? monthEnd : today;
    const p = { ...current, year, month, day: Number(reportEnd.slice(8)) };
    const isPartial = reportEnd < monthEnd;
    const vehicles = AD.store.all('vehicles').map((v) => ({ ...v, nextServiceDate: v.nextServiceDate || '', regoExpiry: v.regoExpiry || '' }));
    const services = AD.store.all('services').filter((s) => s.date && s.date <= reportEnd);
    const defects  = AD.store.all('defects');
    const resolved = defects.filter((d) => d.status === 'Resolved' && d.resolvedDate && d.resolvedDate <= reportEnd);
    const cost = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

    // Twelve calendar months ending with the current one.
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(Date.UTC(p.year, p.month - 1 - (11 - i), 1));
      const key = d.toISOString().slice(0, 7);
      return { key, label: T.MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear(), year: d.getUTCFullYear(), m: d.getUTCMonth() };
    });

    months.forEach((mo) => {
      const svc = services.filter((s) => (s.date || '').slice(0, 7) === mo.key);
      const def = resolved.filter((d) => d.resolvedDate.slice(0, 7) === mo.key);
      mo.planned   = svc.reduce((t, s) => t + cost(s.cost), 0);
      mo.unplanned = def.reduce((t, d) => t + cost(d.cost), 0);
      mo.total     = mo.planned + mo.unplanned;
      mo.svcCount  = svc.length;
      mo.defCount  = def.length;
    });

    // Baseline target: rolling 12-month average of total spend. Noted on the
    // sheet so the reader knows this is trend-derived, not a formal budget.
    const annualTotal = months.reduce((t, m) => t + m.total, 0);
    const monthlyTarget = annualTotal / 12 || 0;

    const curMonth = months[11];
    const daysInMonth = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
    const dayOfMonth = p.day;
    const mtdExpected = monthlyTarget * (dayOfMonth / daysInMonth);
    const mtdActual = curMonth.total;
    const mtdVariance = mtdActual - mtdExpected;

    // YTD: calendar-year to date. Prior months in this year + current month MTD.
    const ytdMonths = months.filter((m) => m.year === p.year);
    const ytdActual = ytdMonths.reduce((t, m) => t + m.total, 0);
    const monthsElapsedFull = ytdMonths.length - 1;  // excluding current partial
    const ytdExpected = monthlyTarget * monthsElapsedFull + mtdExpected;
    const ytdVariance = ytdActual - ytdExpected;

    // Full-year projection: current run rate × 12. If we're in month 1 with
    // thin data this will be rough, which is honest.
    const runRateMonthly = ytdActual / (monthsElapsedFull + (dayOfMonth / daysInMonth)) || 0;
    const projectedYearEnd = runRateMonthly * 12;
    const remainingMonths = 12 - ytdMonths.length;
    const projectedRemaining = runRateMonthly * (remainingMonths + (1 - dayOfMonth / daysInMonth));

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

    /* ---- month-on-month, for the statistics pages ---- */
    const prevMonth = months[10];
    const momPct = prevMonth && prevMonth.total > 0
      ? (curMonth.total - prevMonth.total) / prevMonth.total : null;
    const vsAvgPct = mtdExpected > 0 ? (curMonth.total - mtdExpected) / mtdExpected : null;
    const unplannedShare = curMonth.total > 0 ? curMonth.unplanned / curMonth.total : 0;
    const unplannedShare12 = annualTotal > 0
      ? months.reduce((t, m) => t + m.unplanned, 0) / annualTotal : 0;

    // Defects raised and resolved inside the current month.
    const curKey = curMonth.key;
    const defRaisedMonth = defects.filter((d) => (d.reportedDate || '').slice(0, 7) === curKey && d.reportedDate <= reportEnd);
    const defResolvedMonth = resolved.filter((d) => d.resolvedDate.slice(0, 7) === curKey);
    // Mean days to resolve, for those resolved this month that record both dates.
    const resolveDays = defResolvedMonth
      .map((d) => (d.reportedDate && d.resolvedDate) ? T.daysBetween(d.reportedDate, d.resolvedDate) : null)
      .filter((n) => Number.isFinite(n) && n >= 0);
    const avgResolveDays = resolveDays.length
      ? resolveDays.reduce((t, n) => t + n, 0) / resolveDays.length : null;

    // Spend per vehicle this month, highest first.
    const perVehicleMonth = new Map();
    const tallyMonth = (id, n) => { if (id) perVehicleMonth.set(id, (perVehicleMonth.get(id) || 0) + n); };
    services.filter((s) => (s.date || '').slice(0, 7) === curKey)
      .forEach((s) => tallyMonth(s.vehicleId, cost(s.cost)));
    defResolvedMonth.forEach((d) => tallyMonth(d.vehicleId, cost(d.cost)));
    const topSpenders = [...perVehicleMonth.entries()]
      .map(([id, cost]) => ({ id, cost, v: vehicles.find((v) => v.id === id) || null }))
      .sort((a, b) => b.cost - a.cost).slice(0, 6);
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
      today, now: p, reportEnd, isPartial,
      vehicles,
      months, curMonth, prevMonth,
      monthlyTarget, annualTotal, annualTarget: monthlyTarget * 12,
      mtdActual, mtdExpected, mtdVariance, daysInMonth, dayOfMonth,
      ytdActual, ytdExpected, ytdVariance, monthsElapsedFull,
      projectedYearEnd, projectedRemaining, runRateMonthly,
      svcOverdue, svcSoon, svcOk,
      regoExp, regoSoon, regoOk, regoUnknown,
      openDefects,
      defCounts: {
        Critical: defByPri('Critical'), High: defByPri('High'),
        Medium: defByPri('Medium'),     Low: defByPri('Low')
      },
      statusCounts, availabilityPct, unknownStatus,
      momPct, vsAvgPct, unplannedShare, unplannedShare12,
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

    if (d.unplannedShare >= 0.4 && d.curMonth.total > 0) add(80, 'High', 'Bring the planned/unplanned balance back',
      `Unplanned repairs were ${pct(d.unplannedShare)} of this month's spend (${aud(d.curMonth.unplanned)} of ${aud(d.curMonth.total)}), against a 12-month norm of ${pct(d.unplannedShare12)}.`,
      'Review the repair invoices and repeat defects behind this share. Check whether the costs are one-off repairs or a recurring maintenance issue.');

    if (d.vsAvgPct !== null && d.vsAvgPct > 0.15) add(76, 'Medium', 'Spend is running ahead of the baseline',
      `${T.MONTHS[d.now.month - 1]} spend is ${pct(d.vsAvgPct)} above the ${d.isPartial ? 'day-adjusted' : 'monthly'} baseline (${aud(d.curMonth.total)} against ${aud(d.mtdExpected)}).`,
      `At the current run rate the year closes near ${aud(d.projectedYearEnd)}, about ${aud(Math.abs(d.projectedYearEnd - d.annualTarget))} ${d.projectedYearEnd > d.annualTarget ? 'over' : 'under'} the rolling baseline. Confirm whether this is timing or a genuine step up.`);

    if (d.topShare >= 0.3 && d.topSpenders.length) add(72, 'Medium', 'Spend is concentrated in one vehicle',
      `${d.topSpenders[0].id} accounted for ${pct(d.topShare)} of the month's cost (${aud(d.topSpenders[0].cost)}).`,
      'Where one asset carries this much of the month, it is worth comparing its running cost against replacement or hire for the same duty.');

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
      `Defects resolved this month took ${Math.round(d.avgResolveDays)} days on average.`,
      'Longer resolution means vehicles spend more of the month degraded. Look at where the time goes — parts, workshop capacity, or approval.');

    if (d.vsAvgPct !== null && d.vsAvgPct < -0.15) add(40, 'Low', 'Spend is running below the baseline',
      `${T.MONTHS[d.now.month - 1]} spend is ${pct(d.vsAvgPct)} below the ${d.isPartial ? 'day-adjusted' : 'monthly'} baseline.`,
      'Worth confirming this is genuine saving rather than work recorded late or deferred into next month.');

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

    // Totals row — bold with top double rule.
    total:    {
      font: { name: FONT_HEAD, size: 11, bold: true, color: { argb: COLOR.navy } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.mintSoft } },
      border: { ...borderAll(), top: { style: 'double', color: { argb: COLOR.navy } } }
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
    if (kind === 'good')  return { font: { color: { argb: COLOR.green } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.greenSoft } } };
    if (kind === 'warn')  return { font: { color: { argb: COLOR.amber } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.amberSoft } } };
    if (kind === 'bad')   return { font: { color: { argb: COLOR.red }   }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.redSoft   } } };
    return {};
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

    // Navy band
    ws.getColumn(1).width = 4;
    for (let c = 2; c <= 10; c++) ws.getColumn(c).width = 12;

    // Band rows 1..7 — solid navy, logo on left, title on right.
    for (let r = 1; r <= 7; r++) {
      ws.getRow(r).height = 24;
      for (let c = 1; c <= 10; c++) {
        ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.navy } };
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
    title.value = 'Fleet Performance Report';
    title.font = { name: FONT_HEAD, size: 32, bold: true, color: { argb: COLOR.navy } };
    title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    ws.mergeCells('B11:J11');
    const sub = ws.getCell('B11');
    sub.value = `${T.MONTHS[data.now.month - 1]} ${data.now.year} · issued ${T.fmtKey(data.today)}`;
    sub.font = { name: FONT_HEAD, size: 14, color: { argb: COLOR.muted } };
    sub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    // Mint accent rule under the title.
    for (let c = 2; c <= 10; c++) {
      ws.getCell(13, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.mint } };
    }
    ws.getRow(13).height = 4;

    // Overview block — plain prose, kept short.
    ws.mergeCells('B16:J16');
    ws.getCell('B16').value = 'Overview';
    applyStyle(ws.getCell('B16'), styles.h2);

    ws.mergeCells('B18:J22');
    const overview = ws.getCell('B18');
    overview.value =
      `This report summarises fleet performance for ${T.MONTHS[data.now.month - 1]} ${data.now.year} against the ` +
      `12-month rolling baseline. It covers monthly and year-to-date spend against ` +
      `target, a snapshot of compliance and defects, and the full vehicle register.\n\n` +
      `The spend target is derived from the trailing twelve months of recorded ` +
      `services and resolved defects. Replace it with a formally set budget once ` +
      `one is in place.`;
    overview.font = { name: FONT_BODY, size: 11, color: { argb: COLOR.ink } };
    overview.alignment = { wrapText: true, vertical: 'top', horizontal: 'left', indent: 1 };

    // Contents block.
    ws.mergeCells('B25:J25');
    ws.getCell('B25').value = 'Contents';
    applyStyle(ws.getCell('B25'), styles.h2);

    const contents = [
      ['1', 'Executive summary',     'Key metrics, composition and trends'],
      ['2', 'Monthly spend',          'Twelve-month table with in-cell visual bars'],
      ['3', 'Compliance and risk',    'Rego, servicing and open defects'],
      ['4', 'Vehicle register',       'Full fleet with odometer bars'],
      ['5', 'Recommendations',        'Data-driven actions ordered by priority']
    ];
    contents.forEach((row, i) => {
      const r = 27 + i;
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
    foot.value = 'Astrea Group Pty Ltd · Fleet Operations · Confidential';
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
    h.value = `Executive summary · ${T.MONTHS[data.now.month - 1]} ${data.now.year}`;
    h.font = { name: FONT_HEAD, size: 18, bold: true, color: { argb: COLOR.navy } };
    h.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    // Mint rule
    for (let c = 2; c <= 6; c++) ws.getCell(2, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.mint } };
    ws.getRow(2).height = 3;

    // Spend block
    const curMonthName = T.MONTHS[data.now.month - 1];
    const varianceKind = (actual, target) => {
      if (!target) return '';
      const pct = (actual - target) / target;
      if (pct > 0.1) return 'bad';
      if (pct < -0.1) return 'good';
      return 'warn';
    };

    sectionBar(ws, 4, 'B', 'F', 'Spend performance');

    const rows = [
      // label, value, target, variance, kind
      [`${curMonthName} spend (month to date)`, data.mtdActual, data.mtdExpected, data.mtdVariance,
        varianceKind(data.mtdActual, data.mtdExpected), 'money'],
      [`Year to date (${data.now.year})`, data.ytdActual, data.ytdExpected, data.ytdVariance,
        varianceKind(data.ytdActual, data.ytdExpected), 'money'],
      [`Projected year-end`, data.projectedYearEnd, data.annualTarget, data.projectedYearEnd - data.annualTarget,
        varianceKind(data.projectedYearEnd, data.annualTarget), 'money'],
      [`Monthly target (rolling 12-mo avg)`, data.monthlyTarget, null, null, '', 'money'],
      [`Annual target (rolling)`, data.annualTarget, null, null, '', 'money']
    ];

    // Header row
    const hdrRow = 6;
    const hdrs = ['Metric', 'Actual', 'Target', 'Variance', 'Status'];
    hdrs.forEach((text, i) => {
      const cell = ws.getCell(hdrRow, 2 + i);
      cell.value = text;
      applyStyle(cell, i === 0 ? styles.th : styles.thRight);
    });
    ws.getRow(hdrRow).height = 24;

    rows.forEach((row, i) => {
      const r = hdrRow + 1 + i;
      ws.getRow(r).height = 22;
      const [label, val, tgt, varc, kind, fmt] = row;
      const money = fmt === 'money';

      ws.getCell(r, 2).value = label;  applyStyle(ws.getCell(r, 2), styles.cell);
      ws.getCell(r, 3).value = val;    applyStyle(ws.getCell(r, 3), styles.cellNum);
      ws.getCell(r, 4).value = tgt;    applyStyle(ws.getCell(r, 4), styles.cellNum);
      ws.getCell(r, 5).value = varc;   applyStyle(ws.getCell(r, 5), styles.cellNum);
      const statusText = kind === 'good' ? 'Under target' : kind === 'bad' ? 'Over target' : kind === 'warn' ? 'On track' : '';
      ws.getCell(r, 6).value = statusText;
      applyStyle(ws.getCell(r, 6), styles.cell, tone(kind));
      ws.getCell(r, 6).alignment = { ...styles.cell.alignment, horizontal: 'center', indent: 0 };
      if (kind) applyStyle(ws.getCell(r, 5), tone(kind));
      if (i % 2 === 1) [2, 3, 4, 5].forEach((c) => applyStyle(ws.getCell(r, c), styles.zebra));
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
      ws.getCell(r, 2).value = label; applyStyle(ws.getCell(r, 2), styles.cell);
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
    if (data.byType.length) {
      ws.addConditionalFormatting({
        ref: 'C' + compFirst + ':C' + compLast,
        rules: [{ type: 'dataBar', priority: 1, showValue: true, gradient: true, cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb: COLOR.mint } }]
      });
    }

    // ---- Top spenders this month ----
    let spRow = compLast + 3;
    sectionBar(ws, spRow, 'B', 'F', 'Top spenders · ' + T.MONTHS[data.now.month - 1]);
    spRow += 2;
    ['Vehicle', 'Type', '', 'Spend'].forEach((t, i) => {
      if (!t) return;
      const cell = ws.getCell(spRow, 2 + i);
      cell.value = t;
      applyStyle(cell, i === 0 ? styles.th : styles.thRight);
    });
    ws.getRow(spRow).height = 24;
    const spFirst = spRow + 1;
    data.topSpenders.forEach(({ id, cost, v }, i) => {
      const r = spRow + 1 + i;
      ws.getRow(r).height = 22;
      ws.getCell(r, 2).value = id;              applyStyle(ws.getCell(r, 2), styles.cell);
      ws.getCell(r, 3).value = v ? v.type : ''; applyStyle(ws.getCell(r, 3), styles.cell);
      ws.getCell(r, 5).value = cost;            applyStyle(ws.getCell(r, 5), styles.cellNum);
      if (i % 2 === 1) [2, 3, 5].forEach((c) => applyStyle(ws.getCell(r, c), styles.zebra));
    });
    const spLast = spRow + data.topSpenders.length;
    if (data.topSpenders.length) {
      ws.addConditionalFormatting({
        ref: 'E' + spFirst + ':E' + spLast,
        rules: [{ type: 'dataBar', priority: 1, showValue: true, gradient: true, cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb: 'FFFBBF24' } }]
      });
    }

    // ---- Month-on-month comparison ----
    let moRow = spLast + 3;
    sectionBar(ws, moRow, 'B', 'F', 'Month-on-month comparison');
    moRow += 2;
    const prevName = data.prevMonth ? data.prevMonth.label.split(' ')[0] : '-';
    [' ', T.MONTHS[data.now.month - 1], prevName, '12-mo avg', 'Trend'].forEach((t, i) => {
      const cell = ws.getCell(moRow, 2 + i);
      cell.value = t;
      applyStyle(cell, i === 0 ? styles.th : styles.thRight);
    });
    ws.getRow(moRow).height = 24;
    const avg12P = data.months.reduce((t, m) => t + m.planned, 0) / 12;
    const avg12U = data.months.reduce((t, m) => t + m.unplanned, 0) / 12;
    const avg12S = data.months.reduce((t, m) => t + m.svcCount, 0) / 12;
    const avg12D = data.months.reduce((t, m) => t + m.defCount, 0) / 12;
    const moStats = [
      ['Total spend',     data.curMonth.total,     data.prevMonth ? data.prevMonth.total : null,     data.monthlyTarget, data.momPct],
      ['Planned spend',   data.curMonth.planned,   data.prevMonth ? data.prevMonth.planned : null,   avg12P, null],
      ['Unplanned spend', data.curMonth.unplanned, data.prevMonth ? data.prevMonth.unplanned : null, avg12U, null],
      ['Service events',  data.curMonth.svcCount,  data.prevMonth ? data.prevMonth.svcCount : null,  Math.round(avg12S), null],
      ['Defects resolved', data.curMonth.defCount, data.prevMonth ? data.prevMonth.defCount : null,  Math.round(avg12D), null]
    ];
    moStats.forEach(([label, cur, prev, avg, trend], i) => {
      const r = moRow + 1 + i;
      ws.getRow(r).height = 22;
      ws.getCell(r, 2).value = label; applyStyle(ws.getCell(r, 2), styles.cell);
      const isMoney = i < 3;
      const fmt = isMoney ? styles.cellNum : styles.cellInt;
      ws.getCell(r, 3).value = cur;  applyStyle(ws.getCell(r, 3), fmt);
      ws.getCell(r, 4).value = prev; applyStyle(ws.getCell(r, 4), fmt);
      ws.getCell(r, 5).value = avg != null ? (isMoney ? Math.round(avg) : avg) : null;
      applyStyle(ws.getCell(r, 5), fmt);
      if (trend != null) {
        const up = trend > 0;
        ws.getCell(r, 6).value = (up ? '+' : '') + Math.round(trend * 100) + '%';
        applyStyle(ws.getCell(r, 6), styles.cell, tone(up ? 'bad' : 'good'));
        ws.getCell(r, 6).alignment = { vertical: 'middle', horizontal: 'center' };
      } else {
        ws.getCell(r, 6).value = ''; applyStyle(ws.getCell(r, 6), styles.cell);
      }
      if (i % 2 === 1) [2, 3, 4, 5, 6].forEach((c) => applyStyle(ws.getCell(r, c), styles.zebra));
    });
    // Data bars on the current-month column
    const moFirst = moRow + 1, moLast = moRow + moStats.length;
    ws.addConditionalFormatting({
      ref: 'C' + moFirst + ':C' + moLast,
      rules: [{ type: 'dataBar', priority: 1, showValue: true, gradient: true, cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb: COLOR.navy2 } }]
    });
  }

  function buildSpend(wb, data) {
    const ws = wb.addWorksheet('Monthly spend', { views: [{ showGridLines: false, state: 'frozen', ySplit: 6 }] });
    ws.getColumn(1).width = 3;
    const widths = [18, 16, 16, 16, 16, 16, 14, 12];
    widths.forEach((w, i) => { ws.getColumn(i + 2).width = w; });

    ws.getRow(1).height = 36;
    ws.mergeCells('B1:I1');
    const h = ws.getCell('B1');
    h.value = 'Monthly spend · last 12 months';
    h.font = { name: FONT_HEAD, size: 18, bold: true, color: { argb: COLOR.navy } };
    h.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    for (let c = 2; c <= 9; c++) ws.getCell(2, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.mint } };
    ws.getRow(2).height = 3;

    // Sub note
    ws.mergeCells('B4:I4');
    ws.getCell('B4').value = `Monthly target: ${aud(data.monthlyTarget)}  ·  derived from 12-month rolling average`;
    ws.getCell('B4').font = { name: FONT_BODY, size: 10, italic: true, color: { argb: COLOR.muted } };
    ws.getCell('B4').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    const hdrRow = 6;
    const headers = ['Month', 'Planned', 'Unplanned', 'Total', 'Target', 'Variance', '% of target', 'Services'];
    headers.forEach((text, i) => {
      const cell = ws.getCell(hdrRow, 2 + i);
      cell.value = text;
      applyStyle(cell, i === 0 ? styles.th : styles.thRight);
    });
    ws.getRow(hdrRow).height = 24;

    data.months.forEach((mo, i) => {
      const r = hdrRow + 1 + i;
      ws.getRow(r).height = 20;
      const isCurrent = i === data.months.length - 1;
      const target = isCurrent ? data.mtdExpected : data.monthlyTarget;
      const variance = mo.total - target;
      const pctOfTarget = target > 0 ? mo.total / target : 0;
      const kind = target > 0 ? (variance / target > 0.1 ? 'bad' : variance / target < -0.1 ? 'good' : 'warn') : '';

      ws.getCell(r, 2).value = mo.label + (isCurrent ? ' (MTD)' : '');
      applyStyle(ws.getCell(r, 2), styles.cell);
      ws.getCell(r, 3).value = mo.planned;    applyStyle(ws.getCell(r, 3), styles.cellNum);
      ws.getCell(r, 4).value = mo.unplanned;  applyStyle(ws.getCell(r, 4), styles.cellNum);
      ws.getCell(r, 5).value = mo.total;      applyStyle(ws.getCell(r, 5), styles.cellNum);
      ws.getCell(r, 6).value = target;        applyStyle(ws.getCell(r, 6), styles.cellNum);
      ws.getCell(r, 7).value = variance;      applyStyle(ws.getCell(r, 7), styles.cellNum);
      if (kind) applyStyle(ws.getCell(r, 7), tone(kind));
      ws.getCell(r, 8).value = pctOfTarget;   applyStyle(ws.getCell(r, 8), styles.cellPct);
      ws.getCell(r, 9).value = mo.svcCount + mo.defCount; applyStyle(ws.getCell(r, 9), styles.cellInt);

      if (isCurrent) {
        for (let c = 2; c <= 9; c++) {
          applyStyle(ws.getCell(r, c), { font: { bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.mintSoft } } });
        }
      } else if (i % 2 === 1) {
        for (let c = 2; c <= 9; c++) applyStyle(ws.getCell(r, c), styles.zebra);
      }
    });

    // Totals
    const totRow = hdrRow + 1 + data.months.length;
    ws.getRow(totRow).height = 24;
    const plannedTotal   = data.months.reduce((t, m) => t + m.planned, 0);
    const unplannedTotal = data.months.reduce((t, m) => t + m.unplanned, 0);
    ws.getCell(totRow, 2).value = 'Twelve-month total';
    ws.getCell(totRow, 3).value = plannedTotal;
    ws.getCell(totRow, 4).value = unplannedTotal;
    ws.getCell(totRow, 5).value = data.annualTotal;
    ws.getCell(totRow, 6).value = data.annualTarget;
    ws.getCell(totRow, 7).value = data.annualTotal - data.annualTarget;
    ws.getCell(totRow, 8).value = data.annualTarget ? data.annualTotal / data.annualTarget : 0;
    ws.getCell(totRow, 9).value = data.months.reduce((t, m) => t + m.svcCount + m.defCount, 0);
    for (let c = 2; c <= 9; c++) {
      const money = c >= 3 && c <= 7;
      applyStyle(ws.getCell(totRow, c), money ? styles.cellNum : c === 8 ? styles.cellPct : c === 2 ? styles.cell : styles.cellInt);
      applyStyle(ws.getCell(totRow, c), styles.total);
    }

    // Data bars — in-cell bar charts for a visual spend profile
    const barFirst = hdrRow + 1, barLast = hdrRow + data.months.length;
    [['C', COLOR.mint], ['D', 'FFFBBF24'], ['E', COLOR.navy2]].forEach(([col, argb]) => {
      ws.addConditionalFormatting({
        ref: col + barFirst + ':' + col + barLast,
        rules: [{
          type: 'dataBar', priority: 1, showValue: true, gradient: true,
          cfvo: [{ type: 'min' }, { type: 'max' }],
          color: { argb }
        }]
      });
    });

    // Projection block
    const projRow = totRow + 3;
    sectionBar(ws, projRow, 'B', 'I', 'Year outlook');

    const projRows = [
      [`${data.now.year} year-to-date actual`, data.ytdActual, data.ytdExpected, data.ytdVariance],
      [`Projected year-end spend`,              data.projectedYearEnd, data.annualTarget, data.projectedYearEnd - data.annualTarget],
      [`Projected remainder of year`,           data.projectedRemaining, null, null]
    ];
    const pHdr = projRow + 2;
    ['Measure', 'Actual / Projected', 'Target', 'Variance'].forEach((t, i) => {
      const cell = ws.getCell(pHdr, 2 + i);
      cell.value = t;
      applyStyle(cell, i === 0 ? styles.th : styles.thRight);
    });
    ws.getRow(pHdr).height = 24;
    projRows.forEach(([label, val, tgt, varc], i) => {
      const r = pHdr + 1 + i;
      ws.getRow(r).height = 22;
      ws.getCell(r, 2).value = label; applyStyle(ws.getCell(r, 2), styles.cell);
      ws.getCell(r, 3).value = val;   applyStyle(ws.getCell(r, 3), styles.cellNum);
      ws.getCell(r, 4).value = tgt;   applyStyle(ws.getCell(r, 4), styles.cellNum);
      ws.getCell(r, 5).value = varc;  applyStyle(ws.getCell(r, 5), styles.cellNum);
      if (tgt) {
        const kind = varc / tgt > 0.1 ? 'bad' : varc / tgt < -0.1 ? 'good' : 'warn';
        applyStyle(ws.getCell(r, 5), tone(kind));
      }
      if (i % 2 === 1) [2, 3, 4, 5].forEach((c) => applyStyle(ws.getCell(r, c), styles.zebra));
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
        ws.getCell(row, 4).value = x.r.state === 'overdue' ? 'Expired' : 'Within 2 weeks';
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
        ws.getCell(row, 4).value = x.s.state === 'overdue' ? 'Overdue' : 'Due soon';
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
      ws.getCell(row, 2).value = label; applyStyle(ws.getCell(row, 2), styles.cell);
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

      // Status cell tone
      const st = v.status;
      if (st === 'Out of service') applyStyle(ws.getCell(r, 6), tone('bad'));
      else if (st === 'In workshop') applyStyle(ws.getCell(r, 6), tone('warn'));

      if (i % 2 === 1) [2, 3, 4, 5, 6, 7, 8, 9, 10].forEach((c) => applyStyle(ws.getCell(r, c), styles.zebra));
    });

    ws.autoFilter = { from: { row: hdrRow, column: 2 }, to: { row: hdrRow, column: 10 } };

    // Data bars on odometer column
    if (sorted.length) {
      ws.addConditionalFormatting({
        ref: 'G' + (hdrRow + 1) + ':G' + (hdrRow + sorted.length),
        rules: [{ type: 'dataBar', priority: 1, showValue: true, gradient: true, cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb: COLOR.paper } }]
      });
    }
  }

  // Section bar — navy row spanning columns, used to break up a sheet.
  function sectionBar(ws, row, startCol, endCol, text) {
    ws.mergeCells(`${startCol}${row}:${endCol}${row}`);
    const cell = ws.getCell(`${startCol}${row}`);
    cell.value = text;
    applyStyle(cell, styles.sectionBar);
    ws.getRow(row).height = 22;
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
    h.value = 'Recommendations · ' + T.MONTHS[data.now.month - 1] + ' ' + data.now.year;
    h.font = { name: FONT_HEAD, size: 18, bold: true, color: { argb: COLOR.navy } };
    h.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    for (let c = 2; c <= 5; c++) ws.getCell(2, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.mint } };
    ws.getRow(2).height = 3;

    ws.mergeCells('B4:E4');
    ws.getCell('B4').value = 'Ordered by priority and urgency. Derived from the fleet data in this report.';
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
    ws.getCell('B' + row).value = 'Methodology';
    applyStyle(ws.getCell('B' + row), styles.h2);
    row += 2;
    ws.mergeCells('B' + row + ':E' + (row + 2));
    ws.getCell('B' + row).value =
      'These recommendations are generated by a rule-based engine that analyses the fleet data recorded in Astrea Drive. ' +
      'Each rule has a threshold and weight; the top 5 by weight are shown above. They are not predictions — they describe ' +
      'what the data shows and suggest a concrete action. Replace or adjust them as operational context warrants.';
    ws.getCell('B' + row).font = { name: FONT_BODY, size: 10, color: { argb: COLOR.muted } };
    ws.getCell('B' + row).alignment = { wrapText: true, vertical: 'top', horizontal: 'left', indent: 1 };
  }

  /* ------------------------------------------------------------------ public */

  async function generate(onProgress, options = {}) {
    const notify = (text) => onProgress && onProgress(text);
    notify('Loading Excel engine…');
    const ExcelJS = await loadExcelJS();
    notify('Gathering fleet data…');
    const data = gather(options.month);
    const logoBuf = await loadLogo();
    notify('Building workbook…');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Astrea Drive';
    wb.company = 'Astrea Group Pty Ltd';
    wb.created = new Date();
    wb.title = 'Fleet Performance Report';
    wb.subject = `${T.MONTHS[data.now.month - 1]} ${data.now.year}`;

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
    const monthName = T.MONTHS[data.now.month - 1];
    const filename = `Astrea Fleet Report — ${monthName} ${data.now.year}.xlsx`;
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

  return { generate, gather, loadLogo, aud };
})();
