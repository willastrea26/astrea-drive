/* Fleet performance report — A4 PDF.
 *
 * Shares its figures with the Excel export (AD.fleetReport.gather) and draws
 * everything as vector: no rasterised HTML, so text stays sharp and the file
 * stays small. Six pages — cover, executive summary, spend, fleet and
 * compliance, the month in numbers, and recommendations.
 *
 * jsPDF works in millimetres here; A4 is 210 × 297.
 */
window.AD = window.AD || {};

AD.fleetReportPdf = (function () {
  const T = AD.time;

  const PAGE = { w: 210, h: 297 };
  const M = { l: 16, r: 16, t: 18, b: 18 };   // page margins
  const CONTENT_W = PAGE.w - M.l - M.r;        // 178mm

  // Astrea palette as RGB triples.
  const C = {
    navy:     [18, 40, 61],
    navy2:    [30, 58, 82],
    slate:    [44, 71, 98],
    mint:     [95, 224, 180],
    mintInk:  [26, 122, 94],   // mint dark enough to read on white
    mintPale: [222, 248, 239],
    ink:      [30, 49, 72],
    body:     [60, 78, 98],
    muted:    [122, 142, 161],
    rule:     [214, 222, 229],
    ruleSoft: [240, 244, 248],
    white:    [255, 255, 255],
    red:      [201, 66, 62],
    redPale:  [253, 232, 231],
    amber:    [199, 124, 20],
    amberPale:[253, 240, 219],
    green:    [38, 128, 76],
    greenPale:[225, 243, 232],
    blue:     [52, 120, 185]
  };

  const FONT = 'helvetica';

  let enginePromise;
  function loadJsPDF() {
    if (enginePromise) return enginePromise;
    enginePromise = new Promise((resolve, reject) => {
      if (window.jspdf && window.jspdf.jsPDF) return resolve(window.jspdf.jsPDF);
      const s = document.createElement('script');
      const fail = () => { clearTimeout(timer); s.remove(); reject(new Error('Could not load the PDF engine. Please try again.')); };
      const timer = setTimeout(fail, 20000);
      s.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';
      s.onload = () => {
        if (!window.jspdf || !window.jspdf.jsPDF) return fail();
        clearTimeout(timer);
        resolve(window.jspdf.jsPDF);
      };
      s.onerror = fail;
      document.head.appendChild(s);
    }).catch((err) => { enginePromise = null; throw err; });
    return enginePromise;
  }

  async function loadImg(path) {
    try {
      const r = await fetch(path, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return null;
      const blob = await r.blob();
      return await new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = () => res(null);
        fr.readAsDataURL(blob);
      });
    } catch (e) { return null; }
  }

  /* ------------------------------------------------------------------ primitives */

  function mk(doc) {
    let page = 0;

    const fill = (rgb) => doc.setFillColor(rgb[0], rgb[1], rgb[2]);
    const stroke = (rgb) => doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
    const ink = (rgb) => doc.setTextColor(rgb[0], rgb[1], rgb[2]);

    const rect = (x, y, w, h, rgb, style = 'F') => { fill(rgb); doc.rect(x, y, w, h, style); };
    const roundRect = (x, y, w, h, r, rgb, style = 'F') => { fill(rgb); doc.roundedRect(x, y, w, h, r, r, style); };

    function text(str, x, y, o = {}) {
      const size = o.size || 10;
      doc.setFont(FONT, o.bold ? 'bold' : o.italic ? 'italic' : 'normal');
      doc.setFontSize(size);
      ink(o.color || C.body);
      const s = safe(str);
      if (o.maxWidth) {
        const lines = doc.splitTextToSize(s, o.maxWidth);
        const lh = o.lineHeight || size * 0.42;
        lines.forEach((ln, i) => doc.text(ln, x, y + i * lh, { align: o.align || 'left' }));
        return y + lines.length * lh;
      }
      doc.text(s, x, y, { align: o.align || 'left' });
      return y;
    }

    // Measures how tall a wrapped block will be, without drawing it.
    function textHeight(str, o = {}) {
      const size = o.size || 10;
      doc.setFont(FONT, o.bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      const lines = doc.splitTextToSize(safe(str), o.maxWidth || CONTENT_W);
      return lines.length * (o.lineHeight || size * 0.42);
    }

    /* Donut built from polygon-approximated ring segments. jsPDF has no arc
       primitive, so each slice is an outer sweep plus the inner sweep walked
       back, closed into one filled shape. */
    function donut(cx, cy, rOut, rIn, parts, opts = {}) {
      const live = parts.filter((p) => p.value > 0);
      const total = live.reduce((t, p) => t + p.value, 0);
      // Track ring so an empty or part-filled donut still reads as a ring.
      ringTrack(cx, cy, rOut, rIn, opts.track || C.ruleSoft);
      if (!total) return;
      const gapRad = live.length > 1 ? 0.035 : 0;
      let a = -Math.PI / 2;
      live.forEach((p) => {
        const sweep = (p.value / total) * Math.PI * 2;
        const a0 = a + gapRad / 2;
        const a1 = a + sweep - gapRad / 2;
        if (a1 > a0) ringSeg(cx, cy, rOut, rIn, a0, a1, p.color);
        a += sweep;
      });
    }

    function ringTrack(cx, cy, rOut, rIn, rgb) {
      ringSeg(cx, cy, rOut, rIn, 0, Math.PI * 1.999, rgb);
    }

    function ringSeg(cx, cy, rOut, rIn, a0, a1, rgb) {
      const span = a1 - a0;
      const steps = Math.max(6, Math.ceil(span / (Math.PI / 48)));
      const pts = [];
      for (let i = 0; i <= steps; i++) {
        const a = a0 + span * (i / steps);
        pts.push([cx + Math.cos(a) * rOut, cy + Math.sin(a) * rOut]);
      }
      for (let i = steps; i >= 0; i--) {
        const a = a0 + span * (i / steps);
        pts.push([cx + Math.cos(a) * rIn, cy + Math.sin(a) * rIn]);
      }
      const deltas = [];
      for (let i = 1; i < pts.length; i++) {
        deltas.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]);
      }
      fill(rgb);
      doc.lines(deltas, pts[0][0], pts[0][1], [1, 1], 'F', true);
    }

    // Horizontal bar with a track behind it.
    function hbar(x, y, w, h, frac, rgb, trackRgb) {
      roundRect(x, y, w, h, h / 2, trackRgb || C.ruleSoft);
      const fw = Math.max(0, Math.min(1, frac)) * w;
      if (fw > 0.4) roundRect(x, y, Math.max(fw, h), h, h / 2, rgb);
    }

    // Stacked bar made of several segments sharing one track.
    function stackBar(x, y, w, h, segs, total, trackRgb) {
      roundRect(x, y, w, h, h / 2, trackRgb || C.ruleSoft);
      if (!total) return;
      let cx = x;
      segs.filter((s) => s.value > 0).forEach((s) => {
        const sw = (s.value / total) * w;
        if (sw <= 0) return;
        // Square inner joins, rounded outer ends — drawn as plain rects with
        // rounded caps faked by the track beneath.
        rect(cx, y, sw, h, s.color);
        cx += sw;
      });
      // Re-round the ends by punching the corners with white.
      // Simpler: overlay a rounded clip is unavailable, so leave square —
      // visually fine at this height.
    }

    function line(x1, y1, x2, y2, rgb, w = 0.3, dash) {
      stroke(rgb || C.rule);
      doc.setLineWidth(w);
      if (dash) doc.setLineDashPattern(dash, 0);
      doc.line(x1, y1, x2, y2);
      if (dash) doc.setLineDashPattern([], 0);
    }

    const setPage = (n) => { page = n; };
    const getPage = () => page;

    return { doc, fill, stroke, ink, rect, roundRect, text, textHeight, donut, ringSeg, hbar, stackBar, line, setPage, getPage };
  }

  /* ------------------------------------------------------------------ chrome */

  function coverPage(g, data, logoWhite) {
    const { doc } = g;
    // Navy field across the top two-fifths.
    g.rect(0, 0, PAGE.w, 118, C.navy);
    // Subtle diagonal rules, echoing the app's hero.
    g.stroke([255, 255, 255]);
    doc.setLineWidth(0.25);
    doc.saveGraphicsState();
    doc.setGState(new doc.GState({ opacity: 0.07, 'stroke-opacity': 0.07 }));
    for (let i = -60; i < 240; i += 14) doc.line(i, 0, i + 70, 118);
    doc.restoreGraphicsState();

    if (logoWhite) {
      try { doc.addImage(logoWhite, 'PNG', M.l, 20, 52, 14, undefined, 'FAST'); }
      catch (e) { g.text('ASTREA', M.l, 31, { size: 20, bold: true, color: C.white }); }
    } else {
      g.text('ASTREA', M.l, 31, { size: 20, bold: true, color: C.white });
    }

    g.text('FLEET OPERATIONS', PAGE.w - M.r, 30, { size: 8, bold: true, color: C.mint, align: 'right' });

    g.text('Fleet Performance', M.l, 62, { size: 30, bold: true, color: C.white });
    g.text('Report', M.l, 75, { size: 30, bold: true, color: C.white });

    g.rect(M.l, 82, 26, 1.4, C.mint);

    const monthName = T.MONTHS[data.now.month - 1];
    g.text(`${monthName} ${data.now.year}`, M.l, 94, { size: 14, color: C.mint });
    g.text(`${data.isPartial ? 'Month to date' : 'Full month'} through ${T.fmtKey(data.reportEnd)} | Issued ${T.fmtKey(data.today)}`, M.l, 101, { size: 9, color: [160, 180, 198] });

    /* Three headline figures sitting over the fold. */
    const figs = [
      { label: 'SPEND THIS MONTH', value: AD.fleetReport.aud(data.mtdActual),
        sub: data.momPct === null ? 'No prior month' :
          `${data.momPct >= 0 ? '+' : '-'}${Math.round(Math.abs(data.momPct) * 100)}% vs previous full month` },
      { label: 'FLEET AVAILABLE', value: data.vehicles.length ? Math.round(data.availabilityPct * 100) + '%' : 'N/A',
        sub: `${data.statusCounts['Available']} of ${data.vehicles.length} vehicles` },
      { label: 'NEEDS ATTENTION', value: String(data.regoExp.length + data.svcOverdue.length + data.defCounts.Critical),
        sub: 'Expired, overdue or critical' }
    ];
    const cardW = (CONTENT_W - 12) / 3;
    figs.forEach((f, i) => {
      const x = M.l + i * (cardW + 6);
      const y = 106;
      g.roundRect(x, y, cardW, 34, 2.5, C.white);
      g.rect(x, y, cardW, 1.6, i === 2 && figs[2].value !== '0' ? C.red : C.mint);
      g.text(f.label, x + 6, y + 10, { size: 7, bold: true, color: C.muted });
      g.text(f.value, x + 6, y + 21, { size: 17, bold: true, color: C.navy });
      g.text(f.sub, x + 6, y + 28.5, { size: 7.8, color: C.muted, maxWidth: cardW - 12 });
    });

    /* What this report covers. */
    let y = 160;
    g.text('About this report', M.l, y, { size: 13, bold: true, color: C.navy });
    y += 7;
    y = g.text(
      `Recorded costs cover ${monthName} ${data.now.year} through ${T.fmtKey(data.reportEnd)}. ` +
      `${data.isPartial ? 'This is a partial month; the previous-month comparison uses a full month. ' : ''}` +
      `Fleet status, service alerts, registrations and open defects are a current snapshot as of ` +
      `${T.fmtKey(data.today)}, not a reconstruction of historical fleet status.`,
      M.l, y, { size: 10, color: C.body, maxWidth: CONTENT_W, lineHeight: 5 });

    y += 7;
    y = g.text(
      `The spend target is derived from the trailing twelve months of recorded services and resolved ` +
      `defects, including the selected month. It is a comparison baseline, not an approved budget. ` +
      `Missing historical records can lower it. Projections assume the recorded run rate continues.`,
      M.l, y, { size: 10, color: C.body, maxWidth: CONTENT_W, lineHeight: 5 });

    /* Contents. */
    y += 12;
    g.text('Contents', M.l, y, { size: 13, bold: true, color: C.navy });
    y += 3;
    g.line(M.l, y, M.l + CONTENT_W, y, C.rule, 0.3);
    y += 7;
    const toc = [
      ['02', 'Executive summary', 'Spend against target, fleet and compliance at a glance'],
      ['03', 'Spend analysis', 'Twelve months of planned and unplanned cost'],
      ['04', 'Fleet and compliance', 'Availability, servicing, registration and defects'],
      ['05', 'The month in numbers', 'Detailed statistics and the vehicles carrying the cost'],
      ['06', 'Recommendations', 'What the figures suggest should happen next']
    ];
    toc.forEach(([n, title, sub]) => {
      g.text(String(data.sectionPages[title] || n).padStart(2, '0'), M.l, y, { size: 9.5, bold: true, color: C.mintInk });
      g.text(title, M.l + 11, y, { size: 10, bold: true, color: C.navy });
      g.text(sub, M.l + 60, y, { size: 9, color: C.muted });
      y += 6.6;
    });

    // Footer band.
    g.rect(0, PAGE.h - 16, PAGE.w, 16, C.navy);
    g.text('Astrea Group Pty Ltd · Fleet Operations', M.l, PAGE.h - 6.5, { size: 8, color: C.white });
    g.text('Confidential', PAGE.w - M.r, PAGE.h - 6.5, { size: 8, color: C.mint, align: 'right' });
  }

  /** Running header + footer on every page after the cover. */
  function chrome(g, data, title, pageNo) {
    g.rect(0, 0, PAGE.w, 15, C.navy);
    g.text('ASTREA', M.l, 9.5, { size: 9, bold: true, color: C.white });
    g.rect(M.l + 19, 5.5, 0.4, 5, C.mint);
    g.text(title, M.l + 23, 9.5, { size: 9, color: [185, 203, 218] });
    g.text(`${T.MONTHS[data.now.month - 1]} ${data.now.year}`, PAGE.w - M.r, 9.5,
      { size: 8.5, color: C.mint, align: 'right' });

    g.line(M.l, PAGE.h - 13, PAGE.w - M.r, PAGE.h - 13, C.rule, 0.3);
    g.text('Fleet Performance Report', M.l, PAGE.h - 8.5, { size: 7.5, color: C.muted });
    g.text(String(pageNo).padStart(2, '0'), PAGE.w - M.r, PAGE.h - 8.5,
      { size: 7.5, bold: true, color: C.navy, align: 'right' });
  }

  /** Section heading with a mint tick to its left. */
  function heading(g, x, y, text, sub) {
    g.rect(x, y - 4.2, 1.6, 6, C.mint);
    g.text(text, x + 5, y, { size: 14, bold: true, color: C.navy });
    if (sub) g.text(sub, x + 5, y + 5.6, { size: 9, color: C.muted });
    return y + (sub ? 13 : 8);
  }

  /* ------------------------------------------------------------------ page 2 */

  function summaryPage(g, data) {
    let y = 28;
    y = heading(g, M.l, y, 'Executive summary',
      `Performance through ${T.MONTHS[data.now.month - 1]} against the twelve-month baseline`);

    /* Spend against target — three comparison rows. */
    const rows = [
      { label: data.isPartial ? 'Month to date' : 'Selected month', actual: data.mtdActual, target: data.mtdExpected,
        note: `${data.dayOfMonth} of ${data.daysInMonth} days elapsed` },
      { label: `Year to date (${data.now.year})`, actual: data.ytdActual, target: data.ytdExpected,
        note: `${data.monthsElapsedFull} full month${data.monthsElapsedFull === 1 ? '' : 's'} plus current` },
      { label: 'Projected year end', actual: data.projectedYearEnd, target: data.annualTarget,
        note: 'At the current run rate' }
    ];

    g.roundRect(M.l, y, CONTENT_W, 62, 2.5, C.ruleSoft);
    g.text('SPEND AGAINST TARGET', M.l + 7, y + 9, { size: 7.5, bold: true, color: C.muted });

    let ry = y + 17;
    rows.forEach((r) => {
      const over = r.actual > r.target;
      const varc = r.actual - r.target;
      const barW = CONTENT_W - 76;
      g.text(r.label, M.l + 7, ry + 2.6, { size: 9.5, bold: true, color: C.navy });
      g.text(r.note, M.l + 7, ry + 7.4, { size: 7.4, color: C.muted });

      /* Each row carries its own scale. The three measures differ by an order
         of magnitude, so one shared scale would flatten the month to a dot
         and say nothing about how it sits against its own target. */
      const bx = M.l + 52;
      g.roundRect(bx, ry, barW, 5.4, 2.7, [226, 232, 238]);
      const k = (barW * 0.88) / (Math.max(r.actual, r.target) || 1);
      const tw = r.target * k;
      const aw = r.actual * k;
      if (aw > 0.5) g.roundRect(bx, ry, Math.max(aw, 5.4), 5.4, 2.7, over ? C.red : C.mintInk);
      // Target marker.
      if (tw > 0.5) {
        g.rect(bx + tw - 0.35, ry - 1.6, 0.7, 8.6, C.navy);
        g.text('target', bx + tw, ry - 2.8, { size: 6, color: C.navy, align: 'center' });
      }

      g.text(AD.fleetReport.aud(r.actual), M.l + CONTENT_W - 7, ry + 2.6,
        { size: 10, bold: true, color: C.navy, align: 'right' });
      g.text(`${varc >= 0 ? '+' : '-'}${AD.fleetReport.aud(Math.abs(varc))}`, M.l + CONTENT_W - 7, ry + 7.4,
        { size: 7.6, bold: true, color: over ? C.red : C.green, align: 'right' });
      ry += 15.5;
    });

    y += 70;

    /* Four metric tiles. */
    const share = data.unplannedShare;
    const tiles = [
      { label: 'UNPLANNED SHARE', value: data.curMonth.total > 0 ? Math.round(share * 100) + '%' : 'N/A',
        sub: `${AD.fleetReport.aud(data.curMonth.unplanned)} of ${AD.fleetReport.aud(data.curMonth.total)}`,
        tone: share >= 0.4 ? C.red : share >= 0.25 ? C.amber : C.green,
        frac: share },
      { label: 'FLEET AVAILABLE', value: data.vehicles.length ? Math.round(data.availabilityPct * 100) + '%' : 'N/A',
        sub: `${data.statusCounts['Available']} of ${data.vehicles.length} vehicles`,
        tone: !data.vehicles.length ? C.muted : data.availabilityPct >= 0.7 ? C.green : data.availabilityPct >= 0.5 ? C.amber : C.red,
        frac: data.availabilityPct },
      { label: 'VEHICLES CHARGED', value: String(data.vehiclesCharged),
        sub: `of ${data.vehicles.length} in the fleet this month`,
        tone: C.mintInk, frac: data.vehicles.length ? data.vehiclesCharged / data.vehicles.length : 0 },
      { label: 'OPEN DEFECTS', value: String(data.openDefects.length),
        sub: `${data.defCounts.Critical} critical · ${data.defCounts.High} high`,
        tone: data.defCounts.Critical ? C.red : data.defCounts.High ? C.amber : C.green,
        frac: null }
    ];
    const tw2 = (CONTENT_W - 3 * 5) / 4;
    tiles.forEach((t, i) => {
      const x = M.l + i * (tw2 + 5);
      g.roundRect(x, y, tw2, 34, 2.5, C.white);
      g.stroke(C.rule); g.doc.setLineWidth(0.3);
      g.doc.roundedRect(x, y, tw2, 34, 2.5, 2.5, 'S');
      g.rect(x, y, 1.6, 34, t.tone);
      g.text(t.label, x + 6, y + 8, { size: 6.6, bold: true, color: C.muted });
      g.text(t.value, x + 6, y + 18.5, { size: 16, bold: true, color: C.navy });
      g.text(t.sub, x + 6, y + 25, { size: 7, color: C.muted, maxWidth: tw2 - 10, lineHeight: 3.2 });
      if (t.frac !== null) g.hbar(x + 6, y + 29.5, tw2 - 12, 1.8, t.frac, t.tone, [232, 237, 242]);
    });

    y += 44;

    /* Compliance summary table. */
    y = heading(g, M.l, y, 'Compliance at a glance');
    const comp = [
      ['Registration', data.regoExp.length, data.regoSoon.length, data.regoOk.length, 'expired', 'due in 14d', 'current', data.regoUnknown.length],
      ['Servicing',    data.svcOverdue.length, data.svcSoon.length, data.svcOk.length, 'overdue', 'due soon*', 'no alert']
    ];
    comp.forEach((row) => {
      const [label, bad, warn, ok, badL, warnL, okL, unknown = 0] = row;
      const total = bad + warn + ok + unknown || 1;
      g.text(label, M.l, y + 3, { size: 10, bold: true, color: C.navy });

      const bx = M.l + 34, bw = CONTENT_W - 34;
      g.stackBar(bx, y, bw, 6.5, [
        { value: bad,  color: C.red },
        { value: warn, color: C.amber },
        { value: ok,   color: C.mintInk }, { value: unknown, color: C.muted }
      ], total, C.ruleSoft);

      // Legend beneath.
      const legend = [[bad, badL, C.red], [warn, warnL, C.amber], [ok, okL, C.mintInk]];
      if (unknown) legend.push([unknown, 'unknown', C.muted]);
      let lx = bx;
      legend.forEach(([n, lab, col]) => {
        g.rect(lx, y + 9.6, 2.4, 2.4, col);
        g.text(`${n} ${lab}`, lx + 4, y + 11.8, { size: 7.4, color: C.body });
        lx += 34;
      });
      y += 19;
    });

    /* Defects by priority. */
    g.text('* Service: active trigger within 14 days, 500 km or 25 hours. No alert may include missing limits.', M.l, y + 1, { size: 6.8, color: C.muted });
    y += 8;
    const pri = [
      ['Critical', data.defCounts.Critical, C.red],
      ['High',     data.defCounts.High,     C.amber],
      ['Medium',   data.defCounts.Medium,   C.blue],
      ['Low',      data.defCounts.Low,      C.muted]
    ];
    const maxPri = Math.max(...pri.map((p) => p[1]), 1);
    g.text('OPEN DEFECTS BY PRIORITY', M.l, y, { size: 7.5, bold: true, color: C.muted });
    y += 5;
    pri.forEach(([label, n, col]) => {
      g.text(label, M.l, y + 3, { size: 9, color: C.body });
      g.hbar(M.l + 24, y, CONTENT_W - 40, 4.6, n / maxPri, col, C.ruleSoft);
      g.text(String(n), M.l + CONTENT_W, y + 3.4, { size: 9, bold: true, color: C.navy, align: 'right' });
      y += 8;
    });
  }

  /* ------------------------------------------------------------------ page 3 */

  function spendPage(g, data) {
    let y = 28;
    y = heading(g, M.l, y, 'Spend analysis',
      'Planned servicing against unplanned repairs, twelve months to date');

    /* Stacked column chart. */
    const chartH = 74;
    const chartX = M.l + 20, chartY = y, chartW = CONTENT_W - 20;
    const peak = Math.max(...data.months.map((m) => m.total), data.monthlyTarget, 1);
    const top = niceTop(peak * 1.1);

    // Gridlines and y labels.
    [0, 0.25, 0.5, 0.75, 1].forEach((f) => {
      const gy = chartY + chartH - f * chartH;
      g.line(chartX, gy, chartX + chartW, gy, f === 0 ? C.rule : C.ruleSoft, f === 0 ? 0.4 : 0.3);
      if (f === 0 || f === 0.5 || f === 1) {
        g.text(shortAud(top * f), chartX - 3, gy + 1.4, { size: 6.8, color: C.muted, align: 'right' });
      }
    });

    // Target line across the plot.
    const ty = chartY + chartH - (data.monthlyTarget / top) * chartH;
    g.line(chartX, ty, chartX + chartW, ty, C.navy, 0.45, [1.4, 1.2]);

    // Columns.
    const slot = chartW / data.months.length;
    const barW = Math.min(slot * 0.56, 11);
    data.months.forEach((mo, i) => {
      const cx = chartX + slot * (i + 0.5);
      const x = cx - barW / 2;
      const isCur = i === data.months.length - 1;
      const hPlanned = (mo.planned / top) * chartH;
      const hUnplan = (mo.unplanned / top) * chartH;
      const base = chartY + chartH;
      if (hPlanned > 0.3) g.rect(x, base - hPlanned, barW, hPlanned, isCur ? C.mintInk : C.mint);
      if (hUnplan > 0.3) g.rect(x, base - hPlanned - hUnplan, barW, hUnplan, isCur ? [168, 104, 16] : C.amber);
      // Month label.
      const lab = T.MONTHS[mo.m].slice(0, 3);
      g.text(lab, cx, base + 5, { size: 6.6, bold: isCur, color: isCur ? C.navy : C.muted, align: 'center' });
      if (mo.m === 0 || i === 0) g.text(String(mo.year).slice(2), cx, base + 9, { size: 5.8, color: C.muted, align: 'center' });
      // Value over the current month.
      if (isCur && mo.total > 0) {
        g.text(shortAud(mo.total), cx, base - hPlanned - hUnplan - 2.4, { size: 6.6, bold: true, color: C.navy, align: 'center' });
      }
    });

    y = chartY + chartH + 14;

    // Legend.
    const leg = [['Planned servicing', C.mint], ['Unplanned repairs', C.amber], ['12-month baseline', C.navy]];
    let lx = M.l;
    leg.forEach(([lab, col]) => {
      g.rect(lx, y - 2.6, 3, 3, col);
      g.text(lab, lx + 4.6, y, { size: 8, color: C.body });
      lx += 42;
    });

    y += 9;

    /* Data table. */
    const cols = [
      { t: 'Month',      w: 34, a: 'left' },
      { t: 'Planned',    w: 26, a: 'right' },
      { t: 'Unplanned',  w: 26, a: 'right' },
      { t: 'Total',      w: 26, a: 'right' },
      { t: 'Target',     w: 26, a: 'right' },
      { t: 'Variance',   w: 26, a: 'right' },
      { t: 'Jobs',       w: 14, a: 'right' }
    ];
    const tableW = cols.reduce((t, c) => t + c.w, 0);
    const ox = M.l + (CONTENT_W - tableW) / 2;

    // Header.
    g.rect(ox, y, tableW, 7.5, C.navy);
    let hx = ox;
    cols.forEach((c) => {
      g.text(c.t, c.a === 'right' ? hx + c.w - 2.5 : hx + 2.5, y + 5.1,
        { size: 7.4, bold: true, color: C.white, align: c.a });
      hx += c.w;
    });
    y += 7.5;

    data.months.forEach((mo, i) => {
      const isCur = i === data.months.length - 1;
      const target = isCur ? data.mtdExpected : data.monthlyTarget;
      const varc = mo.total - target;
      const rowH = 6.4;
      if (isCur) g.rect(ox, y, tableW, rowH, C.mintPale);
      else if (i % 2 === 1) g.rect(ox, y, tableW, rowH, C.ruleSoft);

      const vals = [
        T.MONTHS[mo.m].slice(0, 3) + ' ' + String(mo.year).slice(2) + (isCur && data.isPartial ? '  MTD' : ''),
        shortAud(mo.planned), shortAud(mo.unplanned), shortAud(mo.total),
        shortAud(target),
        (varc >= 0 ? '+' : '-') + shortAud(Math.abs(varc)),
        String(mo.svcCount + mo.defCount)
      ];
      let cx2 = ox;
      vals.forEach((v, ci) => {
        const c = cols[ci];
        const isVar = ci === 5;
        const col = isVar ? (varc > target * 0.1 ? C.red : varc < -target * 0.1 ? C.green : C.body) : (isCur ? C.navy : C.body);
        g.text(v, c.a === 'right' ? cx2 + c.w - 2.5 : cx2 + 2.5, y + 4.4,
          { size: 7.4, bold: isCur || isVar, color: col, align: c.a });
        cx2 += c.w;
      });
      y += rowH;
    });

    // Totals.
    g.rect(ox, y, tableW, 7.5, C.navy);
    const tot = [
      'Twelve months',
      shortAud(data.months.reduce((t, m) => t + m.planned, 0)),
      shortAud(data.months.reduce((t, m) => t + m.unplanned, 0)),
      shortAud(data.annualTotal),
      shortAud(data.annualTarget),
      '—',
      String(data.months.reduce((t, m) => t + m.svcCount + m.defCount, 0))
    ];
    let tx = ox;
    tot.forEach((v, ci) => {
      const c = cols[ci];
      g.text(v, c.a === 'right' ? tx + c.w - 2.5 : tx + 2.5, y + 5.1,
        { size: 7.4, bold: true, color: C.white, align: c.a });
      tx += c.w;
    });
    y += 14;

    /* Outlook strip. */
    g.roundRect(M.l, y, CONTENT_W, 26, 2.5, C.navy);
    g.text('YEAR OUTLOOK', M.l + 7, y + 8, { size: 7, bold: true, color: C.mint });
    const outlook = [
      ['Run rate / month', AD.fleetReport.aud(data.runRateMonthly)],
      ['Projected year end', AD.fleetReport.aud(data.projectedYearEnd)],
      ['Remaining this year', AD.fleetReport.aud(data.projectedRemaining)],
      ['Against baseline', (data.projectedYearEnd >= data.annualTarget ? '+' : '-') +
        AD.fleetReport.aud(Math.abs(data.projectedYearEnd - data.annualTarget))]
    ];
    const ow = (CONTENT_W - 14) / 4;
    outlook.forEach(([lab, val], i) => {
      const x = M.l + 7 + i * ow;
      g.text(lab, x, y + 15.5, { size: 7, color: [158, 178, 196] });
      const isLast = i === 3;
      g.text(val, x, y + 21.5, { size: 11, bold: true,
        color: isLast ? (data.projectedYearEnd >= data.annualTarget ? [255, 150, 145] : C.mint) : C.white });
    });
  }

  /* ------------------------------------------------------------------ page 4 */

  function fleetPage(g, data) {
    let y = 28;
    y = heading(g, M.l, y, 'Fleet and compliance',
      `Current snapshot as of ${T.fmtKey(data.today)}; not historical month-end status`);

    /* Three donuts across. */
    const availParts = [
      { label: 'Available',      value: data.statusCounts['Available'],      color: C.mintInk },
      { label: 'In use',         value: data.statusCounts['In use'],         color: C.slate },
      { label: 'In workshop',    value: data.statusCounts['In workshop'],    color: C.amber },
      { label: 'Out of service', value: data.statusCounts['Out of service'], color: C.red }
    ];
    const svcParts = [
      { label: 'Overdue',   value: data.svcOverdue.length, color: C.red },
      { label: 'Due soon*', value: data.svcSoon.length,   color: C.amber },
      { label: 'No alert', value: data.svcOk.length,      color: C.mintInk }
    ];
    const regoParts = [
      { label: 'Expired',  value: data.regoExp.length,  color: C.red },
      { label: 'Due in 14d', value: data.regoSoon.length, color: C.amber },
      { label: 'Current',  value: data.regoOk.length,   color: C.mintInk }
    ];
    if (data.unknownStatus) availParts.push({ label: 'Unspecified', value: data.unknownStatus, color: C.muted });
    if (data.regoUnknown.length) regoParts.push({ label: 'Missing date', value: data.regoUnknown.length, color: C.muted });

    const donuts = [
      { title: 'AVAILABILITY', parts: availParts,
        big: data.vehicles.length ? Math.round(data.availabilityPct * 100) + '%' : 'N/A', small: 'available' },
      { title: 'SERVICING', parts: svcParts,
        big: String(data.svcOverdue.length + data.svcSoon.length), small: 'due' },
      { title: 'REGISTRATION', parts: regoParts,
        big: String(data.regoExp.length + data.regoSoon.length), small: 'due' }
    ];

    const dw = (CONTENT_W - 2 * 5) / 3;
    // Tall enough for the four-row availability legend, no taller.
    const dh = data.unknownStatus ? 80 : 74;
    donuts.forEach((d, i) => {
      const x = M.l + i * (dw + 5);
      g.roundRect(x, y, dw, dh, 2.5, C.white);
      g.stroke(C.rule); g.doc.setLineWidth(0.3);
      g.doc.roundedRect(x, y, dw, dh, 2.5, 2.5, 'S');
      g.text(d.title, x + 6, y + 8, { size: 7, bold: true, color: C.muted });

      const cx = x + dw / 2, cy = y + 30;
      g.donut(cx, cy, 15, 9.4, d.parts);
      g.text(d.big, cx, cy + 1.4, { size: 13, bold: true, color: C.navy, align: 'center' });
      g.text(d.small, cx, cy + 6, { size: 5.6, bold: true, color: C.muted, align: 'center' });

      // Legend.
      let ly = y + 52;
      d.parts.forEach((p) => {
        g.rect(x + 7, ly - 2, 2.6, 2.6, p.color);
        g.text(p.label, x + 12, ly, { size: 7.2, color: C.body });
        g.text(String(p.value), x + dw - 7, ly, { size: 7.4, bold: true, color: C.navy, align: 'right' });
        ly += 5.4;
      });
    });

    y += dh + 12;

    /* Fleet by type. */
    y = heading(g, M.l, y, 'Fleet composition', `${data.vehicles.length} vehicles by type`);
    const typeRows = data.byType.slice(0, 6);
    if (data.byType.length > 6) typeRows.push({ type: 'Other types', count: data.byType.slice(6).reduce((n, t) => n + t.count, 0) });
    const maxType = Math.max(...typeRows.map((t) => t.count), 1);
    typeRows.forEach((t) => {
      g.text(t.type, M.l, y + 3.2, { size: 9, color: C.body });
      g.hbar(M.l + 42, y, CONTENT_W - 58, 5, t.count / maxType, C.mintInk, C.ruleSoft);
      g.text(String(t.count), M.l + CONTENT_W, y + 3.4, { size: 9, bold: true, color: C.navy, align: 'right' });
      y += 8.4;
    });

    /* Attention list — the vehicles actually blocking. */
    const attention = [
      ...data.regoExp.map((x) => ({ id: x.v.id, type: x.v.type, issue: 'Registration expired', tone: C.red,
        detail: `${Math.abs(x.r.days)} day${Math.abs(x.r.days) === 1 ? '' : 's'} ago` })),
      ...data.svcOverdue.map((x) => ({ id: x.v.id, type: x.v.type, issue: 'Service overdue', tone: C.red,
        detail: x.s.why || 'Review service limits' })),
      ...data.regoSoon.map((x) => ({ id: x.v.id, type: x.v.type, issue: 'Registration due', tone: C.amber,
        detail: `in ${x.r.days} day${x.r.days === 1 ? '' : 's'}` }))
    ].slice(0, 7);

    if (attention.length) {
      y += 4;
      y = heading(g, M.l, y, 'Needs attention now', 'Priority records to review with the fleet manager');
      g.rect(M.l, y, CONTENT_W, 6.8, C.navy);
      [['Vehicle', 0, 'left'], ['Type', 32, 'left'], ['Issue', 72, 'left'], ['', CONTENT_W, 'right']]
        .forEach(([t, dx, a]) => {
          if (t) g.text(t, M.l + dx + (a === 'right' ? -2.5 : 2.5), y + 4.7,
            { size: 7.2, bold: true, color: C.white, align: a });
        });
      y += 6.8;
      attention.forEach((a, i) => {
        if (i % 2 === 1) g.rect(M.l, y, CONTENT_W, 6.4, C.ruleSoft);
        g.rect(M.l, y, 1.4, 6.4, a.tone);
        g.text(a.id, M.l + 4, y + 4.4, { size: 7.8, bold: true, color: C.navy });
        g.text(a.type || '—', M.l + 34.5, y + 4.4, { size: 7.6, color: C.muted });
        g.text(a.issue, M.l + 74.5, y + 4.4, { size: 7.6, color: a.tone });
        g.text(a.detail, M.l + CONTENT_W - 2.5, y + 4.4, { size: 7.6, color: C.body, align: 'right' });
        y += 6.4;
      });
    }
  }

  /* ------------------------------------------------------------------ page 5 */

  function statsPage(g, data) {
    let y = 28;
    const monthName = T.MONTHS[data.now.month - 1];
    y = heading(g, M.l, y, 'The month in numbers',
      `${monthName} ${data.now.year}${data.isPartial ? ' to date' : ''} | Previous = full month; average = rolling 12 months`);

    /* Comparison table: this month / last month / 12-mo avg. */
    const prev = data.prevMonth || { total: 0, planned: 0, unplanned: 0, svcCount: 0, defCount: 0 };
    const avgPlanned = data.months.reduce((t, m) => t + m.planned, 0) / 12;
    const avgUnplan = data.months.reduce((t, m) => t + m.unplanned, 0) / 12;
    const avgJobs = data.months.reduce((t, m) => t + m.svcCount + m.defCount, 0) / 12;

    const stats = [
      ['Total spend',          data.curMonth.total,     prev.total,     data.monthlyTarget, 'money'],
      ['Planned servicing',    data.curMonth.planned,   prev.planned,   avgPlanned,         'money'],
      ['Unplanned repairs',    data.curMonth.unplanned, prev.unplanned, avgUnplan,          'money'],
      ['Jobs recorded',        data.curMonth.svcCount + data.curMonth.defCount,
                               prev.svcCount + prev.defCount, avgJobs,                      'int'],
      ['Services completed',   data.curMonth.svcCount,  prev.svcCount,  null,               'int'],
      ['Defects raised',       data.defRaisedMonth.length,   null, null,                    'int'],
      ['Defects resolved',     data.defResolvedMonth.length, null, null,                    'int'],
      ['Vehicles charged',     data.vehiclesCharged,    null, null,                         'int']
    ];

    const cw = [58, 34, 34, 34, 18];
    const tableW = cw.reduce((a, b) => a + b, 0);
    const ox = M.l + (CONTENT_W - tableW) / 2;

    g.rect(ox, y, tableW, 7.5, C.navy);
    ['Measure', monthName, 'Previous', '12-mo avg', ''].forEach((t, i) => {
      const x = ox + cw.slice(0, i).reduce((a, b) => a + b, 0);
      g.text(t, i === 0 ? x + 3 : x + cw[i] - 3, y + 5.1,
        { size: 7.4, bold: true, color: C.white, align: i === 0 ? 'left' : 'right' });
    });
    y += 7.5;

    stats.forEach(([label, cur, prv, avg, fmt], i) => {
      const rowH = 8;
      if (i % 2 === 1) g.rect(ox, y, tableW, rowH, C.ruleSoft);
      const f = (n) => n === null || n === undefined ? '—'
        : fmt === 'money' ? shortAud(n) : (Math.round(n * 10) / 10).toString();

      let x = ox;
      g.text(label, x + 3, y + 5.4, { size: 8.4, color: C.body });
      x += cw[0];
      g.text(f(cur), x + cw[1] - 3, y + 5.4, { size: 8.6, bold: true, color: C.navy, align: 'right' });
      x += cw[1];
      g.text(f(prv), x + cw[2] - 3, y + 5.4, { size: 8.4, color: C.muted, align: 'right' });
      x += cw[2];
      g.text(f(avg), x + cw[3] - 3, y + 5.4, { size: 8.4, color: C.muted, align: 'right' });
      x += cw[3];
      // Direction chip against the previous month.
      if (prv !== null && prv !== undefined && prv > 0) {
        const delta = (cur - prv) / prv;
        const up = delta > 0;
        const flat = Math.abs(delta) < 0.02;
        const col = fmt !== 'money' || flat ? C.muted : up ? C.red : C.green;
        g.text(flat ? '—' : `${up ? '+' : '-'}${Math.round(Math.abs(delta) * 100)}%`,
          x + cw[4] - 3, y + 5.4, { size: 7, bold: true, color: col, align: 'right' });
      }
      y += rowH;
    });

    y += 12;

    /* Where the money went — top vehicles this month. */
    y = heading(g, M.l, y, 'Where the cost sat', `Highest spend in ${monthName}`);
    if (!data.topSpenders.length) {
      g.text('No cost recorded against any vehicle this month.', M.l, y + 2,
        { size: 9, italic: true, color: C.muted });
      y += 12;
    } else {
      const maxSpend = data.topSpenders[0].cost || 1;
      data.topSpenders.slice(0, 4).forEach((s) => {
        g.text(s.id, M.l, y + 3.4, { size: 9, bold: true, color: C.navy });
        g.text(s.v ? (s.v.type || '') : '', M.l + 26, y + 3.4, { size: 7.6, color: C.muted });
        g.hbar(M.l + 62, y, CONTENT_W - 92, 5, s.cost / maxSpend, C.mintInk, C.ruleSoft);
        g.text(AD.fleetReport.aud(s.cost), M.l + CONTENT_W, y + 3.4,
          { size: 8.6, bold: true, color: C.navy, align: 'right' });
        y += 8.4;
      });
    }

    y += 8;

    /* Spend mix — the month's planned/unplanned split beside the twelve-month
       norm, so a shift in the balance is visible rather than inferred. */
    y = heading(g, M.l, y, 'Spend mix', 'Planned servicing against unplanned repairs');
    const mixes = [
      { title: 'THIS MONTH', planned: data.curMonth.planned, unplanned: data.curMonth.unplanned },
      { title: 'TWELVE-MONTH AVERAGE', planned: avgPlanned, unplanned: avgUnplan }
    ];
    const mw = (CONTENT_W - 6) / 2, mh = 41;
    mixes.forEach((m, i) => {
      const x = M.l + i * (mw + 6);
      const tot = m.planned + m.unplanned;
      g.roundRect(x, y, mw, mh, 2.5, C.white);
      g.stroke(C.rule); g.doc.setLineWidth(0.3);
      g.doc.roundedRect(x, y, mw, mh, 2.5, 2.5, 'S');
      g.text(m.title, x + 6, y + 7.5, { size: 6.6, bold: true, color: C.muted });

      const cx = x + 17, cy = y + 24;
      g.donut(cx, cy, 10, 6.2, [
        { label: 'Planned',   value: m.planned,   color: C.mintInk },
        { label: 'Unplanned', value: m.unplanned, color: C.amber }
      ]);
      const share = tot > 0 ? m.unplanned / tot : 0;
      g.text(tot > 0 ? Math.round(share * 100) + '%' : 'N/A', cx, cy + 1, { size: 8.5, bold: true, color: C.navy, align: 'center' });
      g.text('unpl.', cx, cy + 4.6, { size: 4.6, bold: true, color: C.muted, align: 'center' });

      let ly = y + 17.5;
      [['Planned', m.planned, C.mintInk], ['Unplanned', m.unplanned, C.amber]].forEach(([lab, v, col]) => {
        g.rect(x + 34, ly - 2.2, 2.6, 2.6, col);
        g.text(lab, x + 39, ly, { size: 7.6, color: C.body });
        g.text(shortAud(v), x + mw - 6, ly, { size: 8, bold: true, color: C.navy, align: 'right' });
        ly += 6.4;
      });
      g.line(x + 34, ly - 2, x + mw - 6, ly - 2, C.rule, 0.3);
      g.text('Total', x + 39, ly + 3, { size: 7.6, color: C.muted });
      g.text(shortAud(tot), x + mw - 6, ly + 3, { size: 8, bold: true, color: C.navy, align: 'right' });
    });
    y += mh + 7;

    /* Narrative strip. */
    const bits = [];
    if (data.momPct !== null) {
      bits.push(`Recorded spend is ${Math.round(Math.abs(data.momPct) * 100)}% ${data.momPct >= 0 ? 'higher' : 'lower'} than the previous full month.${data.isPartial ? ' The selected month is still in progress.' : ''}`);
    }
    bits.push(data.curMonth.total > 0
      ? `Unplanned repairs took ${Math.round(data.unplannedShare * 100)}% of the month, against a twelve-month norm of ${Math.round(data.unplannedShare12 * 100)}%.`
      : 'No spend is recorded for this month. Check the records before treating this as a saving.');
    if (data.avgResolveDays !== null) {
      bits.push(`Defects closed this month took ${Math.round(data.avgResolveDays)} days on average.`);
    }
    if (data.topShare >= 0.2 && data.topSpenders.length) {
      bits.push(`${data.topSpenders[0].id} alone carried ${Math.round(data.topShare * 100)}% of it.`);
    }

    const narrative = bits.join(' ');
    const nh = g.textHeight(narrative, { size: 9.4, maxWidth: CONTENT_W - 14, lineHeight: 4.6 }) + 13;
    // Flow forward instead of shifting the narrative over the charts above.
    if (y + nh > PAGE.h - 18) {
      g.doc.addPage();
      g.setPage(g.getPage() + 1);
      chrome(g, data, 'The month in numbers (continued)', g.getPage());
      y = 28;
    }
    g.roundRect(M.l, y, CONTENT_W, nh, 2.5, C.mintPale);
    g.rect(M.l, y, 1.6, nh, C.mintInk);
    g.text('IN SHORT', M.l + 7, y + 7, { size: 6.8, bold: true, color: C.mintInk });
    g.text(narrative, M.l + 7, y + 13, { size: 9.4, color: C.ink, maxWidth: CONTENT_W - 14, lineHeight: 4.6 });
  }

  /* ------------------------------------------------------------------ page 6 */

  function recsPage(g, data) {
    let y = 28;
    y = heading(g, M.l, y, 'Recommendations',
      'Data-based suggestions for review, not AI-generated advice');

    const TONE = {
      High:   { col: C.red,     pale: C.redPale },
      Medium: { col: C.amber,   pale: C.amberPale },
      Low:    { col: C.mintInk, pale: C.mintPale }
    };

    data.recommendations.forEach((r, i) => {
      const t = TONE[r.priority] || TONE.Low;
      const findingH = g.textHeight(r.finding, { size: 9, maxWidth: CONTENT_W - 32, lineHeight: 4.3 });
      const titleH = g.textHeight(r.title, { size: 10.6, bold: true, maxWidth: CONTENT_W - 50 });
      const actionH  = g.textHeight(r.action,  { size: 9, maxWidth: CONTENT_W - 48, lineHeight: 4.3 });
      const findingY = Math.max(19, 11 + titleH + 3);
      const h = findingY + findingH + 5.6 + actionH + 5;

      // Keep a card whole — push to the next page rather than splitting it.
      if (y + h > PAGE.h - 22) {
        g.doc.addPage();
        chrome(g, data, 'Recommendations', g.getPage() + 1);
        g.setPage(g.getPage() + 1);
        y = 28;
      }

      g.roundRect(M.l, y, CONTENT_W, h, 2.5, C.white);
      g.stroke(C.rule); g.doc.setLineWidth(0.3);
      g.doc.roundedRect(M.l, y, CONTENT_W, h, 2.5, 2.5, 'S');
      g.rect(M.l, y, 1.8, h, t.col);

      // Index disc.
      g.fill(t.pale);
      g.doc.circle(M.l + 11, y + 10, 5, 'F');
      g.text(String(i + 1), M.l + 11, y + 11.8, { size: 9, bold: true, color: t.col, align: 'center' });

      // Priority chip, right-aligned.
      const chipW = 17;
      g.roundRect(M.l + CONTENT_W - chipW - 6, y + 6, chipW, 6, 1.4, t.pale);
      g.text(r.priority.toUpperCase(), M.l + CONTENT_W - 6 - chipW / 2, y + 10.2,
        { size: 6, bold: true, color: t.col, align: 'center' });

      g.text(r.title, M.l + 20, y + 11, { size: 10.6, bold: true, color: C.navy, maxWidth: CONTENT_W - 50 });

      let ty = y + findingY;
      ty = g.text(r.finding, M.l + 20, ty, { size: 9, color: C.body, maxWidth: CONTENT_W - 32, lineHeight: 4.3 });
      ty += 5.6;
      g.text('ACTION', M.l + 20, ty, { size: 6.2, bold: true, color: t.col });
      g.text(r.action, M.l + 36, ty, { size: 9, color: C.ink, maxWidth: CONTENT_W - 48, lineHeight: 4.3 });

      y += h + 5;
    });

    /* Method note. */
    {
      if (y > PAGE.h - 48) {
        g.doc.addPage();
        g.setPage(g.getPage() + 1);
        chrome(g, data, 'Recommendations (continued)', g.getPage());
        y = 28;
      }
      y = Math.max(y + 4, PAGE.h - 42);
      g.line(M.l, y, M.l + CONTENT_W, y, C.rule, 0.3);
      y += 6;
      g.text('How these are produced', M.l, y, { size: 8, bold: true, color: C.navy });
      y += 4.6;
      g.text(
        'Recommendations are generated from the figures in this report by rule — thresholds on spend ' +
        'variance, unplanned share, compliance state, idle time and defect ageing. They are a reading of ' +
        'the data, not a substitute for operational judgement.',
        M.l, y, { size: 7.6, color: C.muted, maxWidth: CONTENT_W, lineHeight: 3.5 });
    }
  }

  /* ------------------------------------------------------------------ helpers */

  /* jsPDF's built-in Helvetica is encoded as CP1252. Anything outside that set
     is written as raw bytes and comes out as mojibake, so swap the few symbols
     worth having for equivalents that do encode, and drop anything else. */
  const SUBS = {
    '−': '-', '–': '-', '—': '-', '\u2011': '-',
    '≤': '<=', '≥': '>=',
    '▲': '+',  '▼': '-',                   // solid triangles
    '↑': '+',  '↓': '-',                   // arrows
    '×': 'x',  '≈': '~'
  };
  const CP1252_EXTRA = new Set([
    0x20AC, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030,
    0x0160, 0x2039, 0x0152, 0x017D, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022,
    0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x017E, 0x0178
  ]);
  function safe(str) {
    let out = '';
    for (const ch of String(str)) {
      if (SUBS[ch] !== undefined) { out += SUBS[ch]; continue; }
      const c = ch.codePointAt(0);
      if (c === 9 || c === 10 || (c >= 32 && c <= 255) || CP1252_EXTRA.has(c)) out += ch;
      // anything else is dropped rather than drawn as noise
    }
    return out;
  }

  function niceTop(max) {
    if (max <= 0) return 1;
    const step = max > 200000 ? 50000 : max > 80000 ? 20000 : max > 20000 ? 5000
      : max > 8000 ? 2000 : max > 2000 ? 500 : 100;
    return Math.ceil(max / step) * step;
  }

  // Compact currency so columns stay narrow: $12.4k, $1.2m.
  function shortAud(n) {
    const v = Number(n || 0);
    const a = Math.abs(v);
    if (a >= 1000000) return '$' + (v / 1000000).toFixed(1).replace(/\.0$/, '') + 'm';
    if (a >= 1000)    return '$' + (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return '$' + Math.round(v);
  }

  /* ------------------------------------------------------------------ public */

  async function generate(onProgress, options = {}) {
    const notify = (t) => onProgress && onProgress(t);
    notify('Loading PDF engine…');
    const jsPDF = await loadJsPDF();
    notify('Gathering fleet data…');
    const data = AD.fleetReport.gather(options.month);
    const logoWhite = await loadImg('assets/logo-lockup.png');
    notify('Drawing report…');

    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    const monthName = T.MONTHS[data.now.month - 1];
    doc.setProperties({
      title: `Astrea Fleet Performance Report — ${monthName} ${data.now.year}`,
      subject: 'Fleet performance',
      author: 'Astrea Drive',
      creator: 'Astrea Drive'
    });

    const g = mk(doc);

    g.setPage(1);
    data.sectionPages = {};

    const pages = [
      ['Executive summary',    summaryPage],
      ['Spend analysis',       spendPage],
      ['Fleet and compliance', fleetPage],
      ['The month in numbers', statsPage],
      ['Recommendations',      recsPage]
    ];
    pages.forEach(([title, draw]) => {
      doc.addPage();
      g.setPage(g.getPage() + 1);
      data.sectionPages[title] = g.getPage();
      chrome(g, data, title, g.getPage());
      draw(g, data);
    });
    doc.setPage(1);
    coverPage(g, data, logoWhite);

    notify('Writing file…');
    const filename = `Astrea Fleet Report — ${monthName} ${data.now.year}.pdf`;
    await doc.save(filename, { returnPromise: true });
    notify('Done.');
    return filename;
  }

  return { generate };
})();
