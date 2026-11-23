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

  /* Astrea brand (colour guide): primarily blue #1F68DB and white; navy
     #002A54 where a dark colour is needed, for text clarity; the bright green
     #00EDB5 used sparingly, only to point at something to act on. */
  const C = {
    navy:      [0, 42, 84],       // #002A54 — headings, figures, primary text
    blue:      [31, 104, 219],    // #1F68DB — the brand colour
    blueTint:  [236, 243, 253],   // soft brand-blue panel
    blueLine:  [203, 220, 246],
    green:     [0, 237, 181],     // #00EDB5 — action markers only, never text
    ink:       [0, 42, 84],
    body:      [74, 100, 129],    // #4A6481, 6:1 on white
    muted:     [122, 140, 163],   // #7A8CA3
    rule:      [221, 228, 237],
    ruleSoft:  [244, 247, 251],
    white:     [255, 255, 255],
    // Status — reserved for state (expired, overdue, critical / due soon), always with a label.
    red:       [214, 69, 69],
    redPale:   [252, 236, 236],
    amber:     [227, 160, 8],
    amberInk:  [158, 108, 0],     // amber dark enough to read as text
    amberPale: [253, 244, 221],
    // Older names still used by a few drawing calls, mapped onto the brand.
    mint: [31, 104, 219], mintInk: [31, 104, 219], mintPale: [236, 243, 253],
    slate: [61, 91, 128], navy2: [17, 61, 110], greenPale: [236, 243, 253],
    violet: [31, 104, 219], violetPale: [236, 243, 253], pink: [106, 164, 244]
  };
  /* The four costs. Brand blue for fuel, its lighter step for tolls (both
     road running costs), the deeper brand green for planned servicing and one
     warm orange so unplanned repairs stand out. Run through the data-viz
     palette validator on white: inside the lightness band, above the chroma
     floor, colour-blind separation >= 10.9 and normal vision >= 18.1 across
     every pair. Tolls' light blue is under 3:1 on white, so it always carries
     a text label. */
  const S = {
    fuel:      [31, 104, 219],    // #1F68DB
    toll:      [106, 164, 244],   // #6AA4F4
    planned:   [0, 166, 124],     // #00A67C
    unplanned: [235, 104, 52]     // #EB6834
  };
  const SERIES = [['fuel', 'Fuel'], ['toll', 'Tolls'], ['planned', 'Servicing'], ['unplanned', 'Repairs']];

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

    /* Astrea typography guide: one scale off a 9pt paragraph —
         Large heading   4×     (36pt)    medium weight, 105% line height
         Medium heading  2.8×   (25.2pt)  medium weight, 105%
         Small heading   1.375× (12.4pt)  medium weight, 130%
         Micro heading   1.125× (10.1pt)  medium weight, 145%
         Paragraph       1×     (9pt)     regular,       145%
         Small paragraph 0.75×  (6.75pt)  regular,       145%
       and -4% letter spacing on everything. Any size a page asks for snaps to
       the nearest step, so the whole report sits on the scale. `bold` means
       the guide's medium weight: jsPDF's Helvetica has no medium, so it's the
       regular face with a hairline outline in the same colour. */
    const PT = 0.3528;   // mm per point
    const STEPS = [
      { max: 7.5,  size: 6.75, lh: 1.45 },
      { max: 9.7,  size: 9,    lh: 1.45 },
      { max: 11.4, size: 10.1, lh: 1.45 },
      { max: 18.5, size: 12.4, lh: 1.30 },
      { max: 30,   size: 25.2, lh: 1.05 },
      { max: 999,  size: 36,   lh: 1.05 }
    ];
    const stepFor = (size) => STEPS.find((st) => (size || 9) <= st.max);

    function text(str, x, y, o = {}) {
      const st = stepFor(o.size);
      const size = st.size;
      const col = o.color || C.body;
      doc.setFont(FONT, 'normal');
      doc.setFontSize(size);
      ink(col);
      const s = safe(str);
      // -4% per the guide; the small paragraph eases to -2%, because Helvetica
      // (the only face jsPDF has) is already tighter than the brand font and
      // -4% at 6.75pt runs letters together.
      const opts = { align: o.align || 'left', charSpace: (size < 7 ? -0.02 : -0.04) * size * PT };
      if (o.bold) {
        stroke(col);
        doc.setLineWidth(size * 0.022 * PT);
        opts.renderingMode = 'fillThenStroke';
      }
      if (o.maxWidth) {
        const lines = doc.splitTextToSize(s, o.maxWidth);
        const lh = size * st.lh * PT;
        lines.forEach((ln, i) => doc.text(ln, x, y + i * lh, opts));
        return y + lines.length * lh;
      }
      doc.text(s, x, y, opts);
      return y;
    }

    // Measures how tall a wrapped block will be, without drawing it.
    function textHeight(str, o = {}) {
      const st = stepFor(o.size);
      doc.setFont(FONT, 'normal');
      doc.setFontSize(st.size);
      const lines = doc.splitTextToSize(safe(str), o.maxWidth || CONTENT_W);
      return lines.length * st.size * st.lh * PT;
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

  // Labels: the guide's small paragraph, sentence case, muted.
  function caps(g, str, x, y, o = {}) {
    return g.text(String(str), x, y, { size: 6.75, color: C.muted, ...o });
  }

  /* The Astrea Drive mark, drawn from the logo's own vector (assets/
     logo-drive-mark.svg, viewBox 360 × 410): an "A" that is a road — two
     edges converging on the horizon, rounded at the apex and the feet, with
     centre dashes shrinking ~30% each step toward the vanishing point. */
  const MARK_A = [
    ['M', 3.6, 300], ['L', 147.91, 22.48], ['A', 36.17, 0, 1, 212.09, 22.48], ['L', 356.4, 300],
    ['A', 25.32, 1, 1, 311.24, 322.91], ['L', 188.02, 73.98], ['A', 8.95, 0, 0, 171.98, 73.98],
    ['L', 48.76, 322.91], ['A', 25.32, 1, 1, 3.6, 300]
  ];
  // Centre dashes: [x, y, w, h] in the mark's units, each a fully rounded bar.
  const MARK_DASHES = [[164.5, 266, 31, 64], [168.84, 195.6, 22.32, 44.8], [171.96, 146.32, 16.08, 31.36], [174.21, 111.82, 11.58, 21.96]];
  /** Points along an SVG circular arc (rx = ry, no rotation), endpoint form. */
  function arcPoints(x1, y1, r, large, sweep, x2, y2, n) {
    const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
    const d2 = dx * dx + dy * dy;
    const rr = Math.max(r, Math.sqrt(d2));
    const co = (large !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, (rr * rr - d2) / d2));
    const cxp = co * dy, cyp = -co * dx;
    const cx = cxp + (x1 + x2) / 2, cy = cyp + (y1 + y2) / 2;
    const a1 = Math.atan2((dy - cyp) / rr, (dx - cxp) / rr);
    let da = Math.atan2((-dy - cyp) / rr, (-dx - cxp) / rr) - a1;
    if (sweep && da < 0) da += Math.PI * 2;
    if (!sweep && da > 0) da -= Math.PI * 2;
    return Array.from({ length: n }, (_, i) => { const a = a1 + (da * (i + 1)) / n; return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)]; });
  }
  /** The mark at (x, y) — its top-left — `height` mm tall, in `rgb` at `opacity`. */
  function driveMark(g, x, y, height, rgb, opacity) {
    const { doc } = g;
    const s = height / 330;
    const P = (px, py) => [x + px * s, y + py * s];
    const pts = [];
    let cur = null;
    MARK_A.forEach((cmd) => {
      if (cmd[0] === 'M' || cmd[0] === 'L') { cur = [cmd[1], cmd[2]]; pts.push(P(cur[0], cur[1])); }
      else {
        const [, r, large, sweep, ex, ey] = cmd;
        arcPoints(cur[0], cur[1], r, large, sweep, ex, ey, Math.max(8, Math.round(r))).forEach(([px, py]) => pts.push(P(px, py)));
        cur = [ex, ey];
      }
    });
    doc.saveGraphicsState();
    if (opacity < 1) doc.setGState(new doc.GState({ opacity }));
    g.fill(rgb);
    const deltas = pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]]);
    doc.lines(deltas, pts[0][0], pts[0][1], [1, 1], 'F', true);
    MARK_DASHES.forEach(([dx, dy, w, h]) => {
      const [px, py] = P(dx, dy);
      doc.roundedRect(px, py, w * s, h * s, (w * s) / 2, (w * s) / 2, 'F');
    });
    doc.restoreGraphicsState();
  }

  /** Cover: brand blue, the report's name large, the Astrea Drive road "A" behind it — no figures. */
  function coverPage(g, data, logos) {
    const { doc } = g;
    const P = data.period;
    g.rect(0, 0, PAGE.w, PAGE.h, C.blue);
    // The road "A", large and faint in the upper right, cropped by the page
    // edge, so the title, contents and sign-off sit on clean blue.
    driveMark(g, 102, 30, 152, C.white, 0.09);

    // Product brand at the top: the Astrea Drive lockup (white, DRIVE in green).
    if (logos.driveWhite) {
      try { doc.addImage(logos.driveWhite, 'PNG', M.l, 22, 50, 13.6, undefined, 'FAST'); }
      catch (e) { g.text('Astrea Drive', M.l, 32, { size: 25.2, bold: true, color: C.white }); }
    } else g.text('Astrea Drive', M.l, 32, { size: 25.2, bold: true, color: C.white });

    // The report's name — what this document is — as the dominant line.
    const light = [205, 222, 250];
    let y = 128;
    g.text(P.kind, M.l, y, { size: 25.2, bold: true, color: light });
    y += 14;
    g.text('Fleet Report', M.l, y, { size: 36, bold: true, color: C.white });
    y += 9;
    g.rect(M.l, y, 20, 0.9, C.white);
    y += 11;
    g.text(P.isYear ? `${P.label}${data.isPartial ? ', year to date' : ''}` : `${P.label}${data.isPartial ? ', month to date' : ''}`,
      M.l, y, { size: 12.4, bold: true, color: C.white });
    y += 6.5;
    const longDate = (k) => { const p = T.parseKey(k); return `${p.d} ${T.MONTHS[p.m - 1]} ${p.y}`; };
    const from = longDate(data.periodStart), to = longDate(data.reportEnd);
    g.text(`${from} to ${to}   ·   Issued ${T.fmtKey(data.today)}`, M.l, y, { size: 9, color: light });

    // What's inside — quiet, at the foot.
    y = 232;
    g.text('In this report', M.l, y, { size: 6.75, color: light });
    y += 6;
    const toc = ['Executive summary', 'Spend analysis', 'Fleet and compliance', `${P.name} in numbers`, 'Fleet usage & efficiency', 'Recommendations'];
    toc.forEach((title, i) => {
      const col = i < 3 ? 0 : 1, row = i % 3;
      const tx = M.l + col * 74, ty = y + row * 6;
      g.text(String(data.sectionPages[title] || '').padStart(2, '0'), tx, ty, { size: 9, bold: true, color: light });
      g.text(title, tx + 9, ty, { size: 9, color: C.white });
    });

    // Company sign-off: the Astrea primary logo, bottom left.
    g.rect(M.l, PAGE.h - 26, CONTENT_W, 0.25, [120, 164, 235]);
    if (logos.astreaWhite) {
      try { doc.addImage(logos.astreaWhite, 'PNG', M.l, PAGE.h - 19, 26, 6.1, undefined, 'FAST'); }
      catch (e) { g.text('Astrea', M.l, PAGE.h - 14, { size: 12.4, bold: true, color: C.white }); }
    } else g.text('Astrea', M.l, PAGE.h - 14, { size: 12.4, bold: true, color: C.white });
    g.text('Fleet operations  ·  Internal use', PAGE.w - M.r, PAGE.h - 14.5, { size: 6.75, color: light, align: 'right' });
  }

  /** Running header + footer on every page after the cover: Astrea and Astrea Drive at the top. */
  function chrome(g, data, title, pageNo, logos) {
    logos = logos || {};
    // Company logo left, product logo right.
    if (logos.astreaBlue) {
      try { g.doc.addImage(logos.astreaBlue, 'PNG', M.l, 8.6, 24, 5.64, undefined, 'FAST'); }
      catch (e) { g.text('Astrea', M.l, 13, { size: 12.4, bold: true, color: C.blue }); }
    } else g.text('Astrea', M.l, 13, { size: 12.4, bold: true, color: C.blue });
    if (logos.driveBlue) {
      try { g.doc.addImage(logos.driveBlue, 'PNG', PAGE.w - M.r - 27, 6.4, 27, 7.6, undefined, 'FAST'); }
      catch (e) { g.text('Astrea Drive', PAGE.w - M.r, 13, { size: 9, bold: true, color: C.blue, align: 'right' }); }
    } else g.text('Astrea Drive', PAGE.w - M.r, 13, { size: 9, bold: true, color: C.blue, align: 'right' });
    // Hairline with a short lead of brand blue.
    g.line(M.l, 18.6, PAGE.w - M.r, 18.6, C.rule, 0.25);
    g.rect(M.l, 18.2, 16, 0.8, C.blue);

    // Footer: where you are in the report.
    g.line(M.l, PAGE.h - 13, PAGE.w - M.r, PAGE.h - 13, C.rule, 0.25);
    g.text(`${title}  ·  ${data.period.kind} fleet report  ·  ${data.period.label}`, M.l, PAGE.h - 8.5, { size: 6.75, color: C.muted });
    g.text(String(pageNo).padStart(2, '0'), PAGE.w - M.r, PAGE.h - 8.5, { size: 9, bold: true, color: C.navy, align: 'right' });
  }

  /** Page title — the guide's medium heading in brand blue — with a paragraph line under it. */
  function heading(g, x, y, text, sub) {
    g.text(text, x, y + 3, { size: 25.2, bold: true, color: C.blue });
    if (sub) g.text(sub, x, y + 10, { size: 9, color: C.muted });
    return y + (sub ? 18 : 12);
  }
  /** Table header: navy labels on a brand-blue tint, ruled in navy underneath. */
  function tableHead(g, x, y, w, h, cols) {
    g.rect(x, y, w, h, C.blueTint);
    g.line(x, y + h, x + w, y + h, C.navy, 0.35);
    let hx = x;
    cols.forEach((c) => {
      if (c.t) g.text(c.t, c.a === 'right' ? hx + c.w - 2.5 : hx + 2.5, y + h * 0.66, { size: 7.2, bold: true, color: C.navy, align: c.a });
      hx += c.w;
    });
  }

  /** A heading inside a page — the guide's small heading in brand blue. */
  function subhead(g, x, y, text, note) {
    g.text(text, x, y, { size: 12.4, bold: true, color: C.blue });
    if (note) g.text(note, x + CONTENT_W, y, { size: 6.75, color: C.muted, align: 'right' });
    return y + 6.5;
  }

  /* A full-width bar split into parts, each separated by a white gap, with an
     optional label row underneath (swatch, name, value). */
  function splitBar(g, x, y, w, h, parts, total) {
    g.rect(x, y, w, h, C.ruleSoft);
    if (!(total > 0)) return;
    const live = parts.filter((p) => p.value > 0);
    const gap = live.length > 1 ? 0.7 : 0;
    const usable = w - gap * (live.length - 1);
    let cx = x;
    live.forEach((p) => {
      const sw = (p.value / total) * usable;
      g.rect(cx, y, sw, h, p.color);
      cx += sw + gap;
    });
  }

  /* ------------------------------------------------------------------ page 2 */

  function summaryPage(g, data) {
    const aud = AD.fleetReport.aud;
    const P = data.period;
    const monthName = P.name;
    const cm = data.curMonth;
    const yf = data.yearForecast;
    let y = 30;
    y = heading(g, M.l, y, `${monthName} at a glance`,
      data.isPartial ? `${P.isYear ? 'Year' : 'Month'} to date, as at ${T.fmtKey(data.reportEnd)}` : `${P.label}, full ${P.word}`);

    /* The month in a sentence or two — written from the figures, so the page
       opens with what matters rather than a grid of numbers. */
    const parts = SERIES.map(([k, name]) => ({ k, name, value: Math.max(0, cm[k] || 0) }));
    const biggest = parts.slice().sort((a, b) => b.value - a.value)[0];
    const lead = [
      cm.total > 0
        ? `${monthName} spend is ${aud(cm.total)}${data.isPartial ? ' so far' : ''}, with ${biggest.name.toLowerCase()} the largest cost at ${Math.round((biggest.value / cm.total) * 100)}%.`
        : `No spend recorded for ${monthName} yet.`,
      yf ? `The year is forecast to close near ${aud(yf.total)}.` : '',
      data.vehicles.length ? `${data.statusCounts['Available']} of ${data.vehicles.length} vehicles are available today, and ${data.openDefects.length} defect${data.openDefects.length === 1 ? ' is' : 's are'} open${data.defCounts.Critical ? ` (${data.defCounts.Critical} critical)` : ''}.` : ''
    ].filter(Boolean).join(' ');
    y = g.text(lead, M.l, y + 2, { size: 12, color: C.navy, maxWidth: CONTENT_W, lineHeight: 5.6 }) + 6;

    /* Key figures — three columns split by hairlines, no boxes. */
    const figs = [
      { label: data.isPartial ? `${monthName} to date` : `${monthName} spend`, value: aud(data.mtdActual),
        note: data.momPct === null ? '' : `${data.momPct >= 0 ? '+' : '-'}${Math.round(Math.abs(data.momPct) * 100)}% on ${P.prevLabel}${data.isPartial ? ` (${P.word} running)` : ''}` },
      P.isYear
        ? { label: 'Average month', value: aud(data.avgMonth), note: 'Each cost over its complete months' }
        : { label: `Year to date ${data.now.year}`, value: aud(data.ytdActual), note: `${data.monthsElapsedFull} full month${data.monthsElapsedFull === 1 ? '' : 's'} plus ${monthName}` },
      yf ? { label: `Forecast for ${yf.year}`, value: aud(yf.total), note: `${aud(yf.total - yf.actual)} still to come`, color: C.blue }
        : { label: 'Average month', value: aud(data.avgMonth), note: 'Over the months with complete data' }
    ];
    const colW = CONTENT_W / 3;
    g.line(M.l, y, M.l + CONTENT_W, y, C.rule, 0.3);
    figs.forEach((f, i) => {
      const x = M.l + i * colW + (i ? 6 : 0);
      if (i) g.line(M.l + i * colW, y + 4, M.l + i * colW, y + 28, C.rule, 0.3);
      caps(g, f.label, x, y + 8);
      g.text(f.value, x, y + 19.5, { size: 25.2, bold: true, color: f.color || C.navy });
      g.text(f.note, x, y + 25.5, { size: 6.75, color: C.muted, maxWidth: colW - 10 });
    });
    y += 32;
    g.line(M.l, y, M.l + CONTENT_W, y, C.rule, 0.3);
    y += 12;

    /* Where the money went — one bar for the whole month, split by cost. */
    y = subhead(g, M.l, y, 'Where the money went', `${monthName}${data.isPartial ? ' to date' : ''} · ${aud(cm.total)}`);
    const tollMissing = data.tollsNotIn;
    splitBar(g, M.l, y, CONTENT_W, 8, parts.map((p) => ({ value: p.k === 'toll' && tollMissing ? 0 : p.value, color: S[p.k] })), cm.total);
    y += 14;
    const lw = CONTENT_W / 4;
    parts.forEach((p, i) => {
      const x = M.l + i * lw;
      g.rect(x, y - 2.6, 3, 3, S[p.k]);
      g.text(p.name, x + 5, y, { size: 8.4, bold: true, color: C.navy });
      const v = p.k === 'toll' && tollMissing ? 'not in yet' : `${aud(p.value)}  ·  ${cm.total > 0 ? Math.round((p.value / cm.total) * 100) : 0}%`;
      g.text(v, x + 5, y + 4.6, { size: 8, color: C.body });
    });
    y += 18;

    /* What's in these figures — each cost, its amount, and how far its data
       reaches, so the total can be read for what it is. Tolls that couldn't
       be loaded are said out loud, not quietly left out. */
    y = subhead(g, M.l, y, 'What\'s in these figures', `${P.label}${data.isPartial ? ' to date' : ''} · ${aud(cm.total)} in total`);
    const fk = (k) => T.fmtKey(k);
    const cardsLine = data.fuelCards.length
      ? data.fuelCards.map((c) => `${c.card.toUpperCase()} imported ${fk(c.from)} to ${fk(c.to)}`).join('  ·  ')
      : 'No fuel-card statements imported';
    const tollLine = !data.tollsLoaded
      ? 'Could not be loaded when this report was made, so the total leaves tolls out. Generate the report again.'
      : !data.tollThrough ? 'No Linkt statements imported'
        : `Linkt statements to ${fk(data.tollThrough)}${data.tollThrough < data.reportEnd ? ' — tolls after that aren\'t in yet' : ''}`;
    const inc = [
      ['Fuel', cm.fuel, S.fuel, cardsLine, false],
      ['Tolls', cm.toll, S.toll, tollLine, !data.tollsLoaded],
      ['Servicing', cm.planned, S.planned, `${cm.svcCount || 0} service${cm.svcCount === 1 ? '' : 's'} recorded in Astrea Drive`, false],
      ['Repairs', cm.unplanned, S.unplanned, `${cm.defCount || 0} defect${cm.defCount === 1 ? '' : 's'} resolved with a cost recorded`, false]
    ];
    // Amounts are in the bar above; this says where each one comes from.
    inc.forEach(([label, , col, note, warn]) => {
      g.rect(M.l, y - 2.6, 3, 3, col);
      g.text(label, M.l + 5, y, { size: 9, bold: true, color: C.navy });
      g.text(note, M.l + 28, y, { size: 9, color: warn ? C.red : C.body, bold: warn, maxWidth: CONTENT_W - 28 });
      y += 6.6;
    });
    y += 9;

    /* Compliance — registration and servicing as status bars, then defects. */
    y = subhead(g, M.l, y, 'Compliance', 'Due soon = within 14 days, 500 km or 25 engine hours');
    const comp = [
      ['Registration', [[data.regoExp.length, 'expired', C.red], [data.regoSoon.length, 'due in 14 days', C.amber], [data.regoOk.length, 'current', C.blue], [data.regoUnknown.length, 'no date', C.rule]]],
      ['Servicing', [[data.svcOverdue.length, 'overdue', C.red], [data.svcSoon.length, 'due soon', C.amber], [data.svcOk.length, 'no alert', C.blue]]]
    ];
    comp.forEach(([label, segs]) => {
      const total = segs.reduce((t, s) => t + s[0], 0);
      g.text(label, M.l, y + 4, { size: 9, bold: true, color: C.navy });
      splitBar(g, M.l + 32, y, CONTENT_W - 32, 5.5, segs.map(([n, , col]) => ({ value: n, color: col })), total);
      let sx = M.l + 32;
      segs.filter(([n], i) => n > 0 || i < 3).forEach(([n, lab, col]) => {
        g.rect(sx, y + 8.6, 2.4, 2.4, col);
        const t = `${n} ${lab}`;
        g.text(t, sx + 3.8, y + 10.8, { size: 7.6, color: n && col === C.red ? C.red : C.body, bold: !!(n && col === C.red) });
        sx += 8 + g.doc.getTextWidth(safe(t));
      });
      y += 15.5;
    });
    // Open defects: only the count that needs it is red.
    const dc = data.defCounts;
    g.text('Open defects', M.l, y + 4, { size: 9, bold: true, color: C.navy });
    let dx = M.l + 32;
    [[`${data.openDefects.length} open`, C.navy, true], [`${dc.Critical} critical`, dc.Critical ? C.red : C.body, !!dc.Critical],
      [`${dc.High} high`, C.body, false], [`${dc.Medium} medium`, C.body, false], [`${dc.Low} low`, C.body, false]]
      .forEach(([t, col, b], i) => {
        if (i) { g.text('·', dx, y + 4, { size: 9, color: C.muted }); dx += 4; }
        g.text(t, dx, y + 4, { size: 9, color: col, bold: b });
        g.doc.setFontSize(9);
        dx += g.doc.getTextWidth(safe(t)) + 3;
      });
    y += 15;

    /* Top actions — the three most important recommendations, marked with the
       brand green (the colour for "do this"), pointing to the full list. */
    const recs = (data.recommendations || []).slice(0, 3);
    if (recs.length && y + 6.5 + recs.length * 7 < PAGE.h - 15) {
      y = subhead(g, M.l, y, 'Top actions', `All ${data.recommendations.length} on page ${String(data.sectionPages.Recommendations || 7).padStart(2, '0')}`);
      recs.forEach((r, i) => {
        g.rect(M.l, y - 3.2, 1.2, 4.6, C.green);
        g.text(String(i + 1).padStart(2, '0'), M.l + 4, y, { size: 9, bold: true, color: C.blue });
        g.text(r.title, M.l + 12, y, { size: 9, bold: true, color: C.navy });
        g.text(`${r.priority} priority`, M.l + CONTENT_W, y, { size: 6.75, color: r.priority === 'High' ? C.red : r.priority === 'Medium' ? C.amberInk : C.blue, align: 'right' });
        y += 7;
      });
    }
  }

  /* ------------------------------------------------------------------ page 3 */

  function spendPage(g, data) {
    let y = 30;
    y = heading(g, M.l, y, 'Spend analysis',
      data.isYear ? `January to December ${data.now.year} · fuel, Linkt tolls, servicing and repairs` : 'Last 12 months · fuel, Linkt tolls, servicing and repairs');

    /* Stacked column chart. */
    const chartH = 64;
    const chartX = M.l + 20, chartY = y, chartW = CONTENT_W - 20;
    const peak = Math.max(...data.months.map((m) => m.total), data.avgMonth || 0, 1);
    const top = niceTop(peak * 1.1);

    // Gridlines and y labels.
    [0, 0.25, 0.5, 0.75, 1].forEach((f) => {
      const gy = chartY + chartH - f * chartH;
      g.line(chartX, gy, chartX + chartW, gy, f === 0 ? C.rule : C.ruleSoft, f === 0 ? 0.4 : 0.3);
      if (f === 0 || f === 0.5 || f === 1) {
        g.text(shortAud(top * f), chartX - 3, gy + 1.4, { size: 6.8, color: C.muted, align: 'right' });
      }
    });

    // Columns, stacked in the same order as the legend: fuel at the base (the
    // biggest cost), then tolls, servicing, repairs — with a hairline of white
    // between segments so adjacent colours never touch.
    const slot = chartW / data.months.length;
    const barW = Math.min(slot * 0.5, 9.5);
    const GAP = 0.45;
    data.months.forEach((mo, i) => {
      const cx = chartX + slot * (i + 0.5);
      const x = cx - barW / 2;
      const isCur = i === data.curIdx;
      const base = chartY + chartH;
      let h0 = 0;
      // A month still to come (the rest of the current year): a dashed outline
      // at the average month — a forecast, not spend.
      if (mo.future) {
        if (data.avgMonth > 0) {
          const h = (data.avgMonth / top) * chartH;
          g.stroke(C.navy); g.doc.setLineWidth(0.3); g.doc.setLineDashPattern([0.9, 0.7], 0);
          g.doc.rect(x, base - h, barW, h, 'S');
          g.doc.setLineDashPattern([], 0);
        }
        g.text(T.MONTHS[mo.m].slice(0, 3), cx, base + 5, { size: 6.6, color: C.muted, align: 'center' });
        return;
      }
      SERIES.forEach(([k]) => {
        const h = (Math.max(0, mo[k] || 0) / top) * chartH;
        if (h > 0.35) { g.rect(x, base - h0 - h, barW, Math.max(0.2, h - (h0 ? GAP : 0)), S[k]); h0 += h; }
      });
      // Month label.
      const lab = T.MONTHS[mo.m].slice(0, 3);
      g.text(lab, cx, base + 5, { size: 6.6, bold: isCur, color: isCur ? C.navy : C.muted, align: 'center' });
      if (mo.m === 0 || i === 0) g.text(String(mo.year).slice(2), cx, base + 9, { size: 5.8, color: C.muted, align: 'center' });
      // Value over the current month only — selective labels, not a number on every bar.
      if (isCur && mo.total > 0) g.text(shortAud(mo.total) + (data.isPartial ? ' so far' : ''), cx, base - h0 - 2.4, { size: 6.6, bold: true, color: C.navy, align: 'center' });
    });

    // The forecast's average month: a dashed navy line, labelled at the end.
    if (data.avgMonth > 0) {
      const ay = chartY + chartH - (data.avgMonth / top) * chartH;
      g.line(chartX, ay, chartX + chartW, ay, C.navy, 0.4, [1.4, 1.2]);
      g.text(`average month ${shortAud(data.avgMonth)}`, chartX + chartW, ay - 1.6, { size: 6.2, bold: true, color: C.navy, align: 'right' });
    }

    y = chartY + chartH + 14;

    // Legend — same order as the stack.
    let lx = M.l;
    SERIES.forEach(([k, lab]) => {
      g.rect(lx, y - 2.6, 3, 3, S[k]);
      g.text(lab === 'Tolls' ? 'Tolls (Linkt)' : lab === 'Servicing' ? 'Planned servicing' : lab === 'Repairs' ? 'Unplanned repairs' : lab, lx + 4.6, y, { size: 8, color: C.body });
      lx += k === 'fuel' ? 17 : k === 'toll' ? 27 : 33;
    });
    g.line(lx, y - 1.1, lx + 5, y - 1.1, C.navy, 0.4, [1.2, 0.9]);
    g.text('Average month (forecast)', lx + 6.6, y, { size: 8, color: C.body });
    const through = [
      data.fuelThrough ? `fuel cards to ${T.fmtKey(data.fuelThrough)}` : 'no fuel-card data yet',
      data.tollThrough ? `Linkt tolls to ${T.fmtKey(data.tollThrough)}` : 'no Linkt statements yet'
    ].join(', ');
    g.text(`Imported: ${through}. Months after those dates are missing that cost, not cheaper.`,
      M.l, y + 5, { size: 7, italic: true, color: C.muted });

    y += 12;

    /* Data table. */
    const cols = [
      { t: 'Month',      w: 30, a: 'left' },
      { t: 'Fuel',       w: 24, a: 'right' },
      { t: 'Tolls',      w: 24, a: 'right' },
      { t: 'Servicing',  w: 24, a: 'right' },
      { t: 'Repairs',    w: 24, a: 'right' },
      { t: 'Total',      w: 26, a: 'right' },
      { t: 'Jobs',       w: 16, a: 'right' }
    ];
    const tableW = cols.reduce((t, c) => t + c.w, 0);
    const ox = M.l + (CONTENT_W - tableW) / 2;

    // Header: navy labels on a brand-blue tint.
    tableHead(g, ox, y, tableW, 7.5, cols);
    y += 7.5;

    data.months.forEach((mo, i) => {
      const isCur = i === data.curIdx;
      const rowH = 6.4;
      if (isCur) g.rect(ox, y, tableW, rowH, C.blueTint);
      g.line(ox, y + rowH, ox + tableW, y + rowH, C.ruleSoft, 0.25);
      const vals = mo.future
        ? [T.MONTHS[mo.m].slice(0, 3) + ' ' + String(mo.year).slice(2) + '  to come', '—', '—', '—', '—', '—', '—']
        : [
          T.MONTHS[mo.m].slice(0, 3) + ' ' + String(mo.year).slice(2) + (isCur && data.isPartial ? '  to date' : ''),
          shortAud(mo.fuel || 0), shortAud(mo.toll || 0), shortAud(mo.planned), shortAud(mo.unplanned), shortAud(mo.total),
          String(mo.svcCount + mo.defCount)
        ];
      let cx2 = ox;
      vals.forEach((v, ci) => {
        const c = cols[ci];
        g.text(v, c.a === 'right' ? cx2 + c.w - 2.5 : cx2 + 2.5, y + 4.4,
          { size: 9, bold: !mo.future && (isCur || ci === 5), color: mo.future ? C.muted : isCur ? C.navy : C.body, align: c.a });
        cx2 += c.w;
      });
      y += rowH;
    });

    // Totals.
    g.rect(ox, y, tableW, 7.5, C.navy);
    const sumOf = (k) => data.months.reduce((t, m) => t + (m[k] || 0), 0);
    const tot = [
      data.isYear ? `${data.now.year}${data.isPartial ? ' to date' : ''}` : 'Twelve months', shortAud(sumOf('fuel')), shortAud(sumOf('toll')), shortAud(sumOf('planned')), shortAud(sumOf('unplanned')),
      shortAud(data.annualTotal), String(data.months.reduce((t, m) => t + m.svcCount + m.defCount, 0))
    ];
    let tx = ox;
    tot.forEach((v, ci) => {
      const c = cols[ci];
      g.text(v, c.a === 'right' ? tx + c.w - 2.5 : tx + 2.5, y + 5.1,
        { size: 9, bold: true, color: C.white, align: c.a });
      tx += c.w;
    });
    y += 14;

    /* Year outlook — the Cost sheet's forecast, on a brand-blue tint. */
    const yf = data.yearForecast;
    g.rect(M.l, y, CONTENT_W, 26, C.blueTint);
    g.rect(M.l, y, 1.2, 26, C.blue);
    caps(g, yf ? `Year outlook · ${yf.year}` : 'Twelve-month view', M.l + 7, y + 7.5, { color: C.blue });
    const outlook = yf ? [
      ['Spent so far', AD.fleetReport.aud(yf.actual), C.navy],
      [`Forecast for ${yf.year}`, AD.fleetReport.aud(yf.total), C.blue],
      ['Still to come', AD.fleetReport.aud(yf.total - yf.actual), C.navy],
      ['Average month', AD.fleetReport.aud(data.avgMonth), C.navy]
    ] : [
      [data.isYear ? `${data.now.year} total` : 'Twelve months', AD.fleetReport.aud(data.annualTotal), C.navy],
      ['Average month', AD.fleetReport.aud(data.avgMonth), C.blue],
      ['Fuel share', Math.round(data.fuelShare12 * 100) + '%', C.navy],
      ['Toll share', Math.round(data.tollShare12 * 100) + '%', C.navy]
    ];
    const ow = (CONTENT_W - 14) / 4;
    outlook.forEach(([lab, val, col], i) => {
      const x = M.l + 7 + i * ow;
      g.text(lab, x, y + 15, { size: 7.4, color: C.body });
      g.text(val, x, y + 21.5, { size: 12, bold: true, color: col });
    });
    if (yf) {
      g.text('Forecast = spend so far plus each cost\'s average month for the days not in yet (including any period after the latest fuel import or Linkt statement).',
        M.l, y + 31, { size: 6.8, italic: true, color: C.muted, maxWidth: CONTENT_W, lineHeight: 3.2 });
    }
  }

  /* ------------------------------------------------------------------ page 4 */

  function fleetPage(g, data) {
    let y = 30;
    y = heading(g, M.l, y, 'Fleet and compliance',
      `As at ${T.fmtKey(data.today)}`);

    /* Three donuts across. */
    // Status colours: blue = fine, navy = in use, amber = due soon / in the
    // workshop, red = expired / overdue / out of service. Always with labels.
    const availParts = [
      { label: 'Available',      value: data.statusCounts['Available'],      color: C.blue },
      { label: 'In use',         value: data.statusCounts['In use'],         color: C.navy },
      { label: 'In workshop',    value: data.statusCounts['In workshop'],    color: C.amber },
      { label: 'Out of service', value: data.statusCounts['Out of service'], color: C.red }
    ];
    const svcParts = [
      { label: 'Overdue',   value: data.svcOverdue.length, color: C.red },
      { label: 'Due soon*', value: data.svcSoon.length,   color: C.amber },
      { label: 'No alert', value: data.svcOk.length,      color: C.blue }
    ];
    const regoParts = [
      { label: 'Expired',  value: data.regoExp.length,  color: C.red },
      { label: 'Due in 14d', value: data.regoSoon.length, color: C.amber },
      { label: 'Current',  value: data.regoOk.length,   color: C.blue }
    ];
    if (data.unknownStatus) availParts.push({ label: 'Unspecified', value: data.unknownStatus, color: C.muted });
    if (data.regoUnknown.length) regoParts.push({ label: 'Missing date', value: data.regoUnknown.length, color: C.muted });

    const donuts = [
      { title: 'Availability', parts: availParts,
        big: data.vehicles.length ? Math.round(data.availabilityPct * 100) + '%' : 'N/A', small: 'available' },
      { title: 'Servicing', parts: svcParts,
        big: String(data.svcOverdue.length + data.svcSoon.length), small: 'due' },
      { title: 'Registration', parts: regoParts,
        big: String(data.regoExp.length + data.regoSoon.length), small: 'due' }
    ];

    const dw = (CONTENT_W - 2 * 5) / 3;
    // Tall enough for the four-row availability legend, no taller.
    const dh = data.unknownStatus ? 80 : 74;
    g.line(M.l, y, M.l + CONTENT_W, y, C.rule, 0.3);
    donuts.forEach((d, i) => {
      const x = M.l + i * (dw + 5);
      if (i) g.line(x - 2.5, y + 4, x - 2.5, y + dh - 4, C.rule, 0.3);
      caps(g, d.title, x + 6, y + 8);

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
    y = subhead(g, M.l, y, 'Fleet by type') + 1;
    const typeRows = data.byType.slice(0, 6);
    if (data.byType.length > 6) typeRows.push({ type: 'Other types', count: data.byType.slice(6).reduce((n, t) => n + t.count, 0) });
    const maxType = Math.max(...typeRows.map((t) => t.count), 1);
    typeRows.forEach((t) => {
      g.text(t.type, M.l, y + 3.2, { size: 9, color: C.body });
      g.hbar(M.l + 42, y, CONTENT_W - 58, 5, t.count / maxType, C.blue, C.ruleSoft);
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
      y += 9;
      y = subhead(g, M.l, y, 'Needs attention') + 1;
      tableHead(g, M.l, y, CONTENT_W, 6.8, [{ t: 'Vehicle', w: 32, a: 'left' }, { t: 'Type', w: 40, a: 'left' }, { t: 'Issue', w: 60, a: 'left' }, { t: '', w: CONTENT_W - 132, a: 'right' }]);
      y += 6.8;
      attention.forEach((a) => {
        g.line(M.l, y + 6.4, M.l + CONTENT_W, y + 6.4, C.ruleSoft, 0.25);
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
    let y = 30;
    const P = data.period;
    const monthName = P.name;
    y = heading(g, M.l, y, `${P.label} in numbers`,
      data.isPartial ? `${P.isYear ? 'Year' : 'Month'} to date, against ${P.isYear ? P.prevLabel : 'the month before'}` : `Against ${P.isYear ? P.prevLabel : 'the month before'}`);

    /* Comparison table: this month / last month / the average month (the
       Cost sheet's forecast basis: each cost over its complete months). */
    const prev = data.prevMonth || { total: 0, planned: 0, unplanned: 0, fuel: 0, toll: 0, svcCount: 0, defCount: 0 };
    const b = data.basis || {};
    const avg12 = (k) => data.months.reduce((t, m) => t + (m[k] || 0), 0) / 12;
    const avgPlanned = data.basis ? b.planned : avg12('planned');
    const avgUnplan = data.basis ? b.unplanned : avg12('unplanned');
    const avgFuel = data.basis ? b.fuel : avg12('fuel');
    const avgToll = data.basis ? b.toll : avg12('toll');
    const avgJobs = data.months.reduce((t, m) => t + m.svcCount + m.defCount, 0) / 12;

    const stats = [
      ['Total spend',          data.curMonth.total,     prev.total,     data.avgMonth,      'money'],
      ['Fuel',                 data.curMonth.fuel,      prev.fuel,      avgFuel,            'money'],
      [data.tollsNotIn ? 'Tolls (Linkt) - not in yet' : 'Tolls (Linkt)', data.tollsNotIn ? null : data.curMonth.toll, prev.toll, avgToll, 'money'],
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

    g.rect(ox, y, tableW, 7.5, C.blueTint); g.line(ox, y + 7.5, ox + tableW, y + 7.5, C.navy, 0.35);
    ['Measure', monthName, P.isYear ? P.prevLabel : 'Previous', 'Average month', ''].forEach((t, i) => {
      const x = ox + cw.slice(0, i).reduce((a, b) => a + b, 0);
      g.text(t, i === 0 ? x + 3 : x + cw[i] - 3, y + 5.1,
        { size: 7.2, bold: true, color: C.navy, align: i === 0 ? 'left' : 'right' });
    });
    y += 7.5;

    stats.forEach(([label, cur, prv, avg, fmt], i) => {
      const rowH = 7.2;
      g.line(ox, y + rowH, ox + tableW, y + rowH, C.ruleSoft, 0.25);
      const f = (n) => n === null || n === undefined ? '—'
        : fmt === 'money' ? shortAud(n) : (Math.round(n * 10) / 10).toString();

      let x = ox;
      g.text(label, x + 3, y + 4.9, { size: 8.4, color: C.body });
      x += cw[0];
      g.text(f(cur), x + cw[1] - 3, y + 4.9, { size: 8.6, bold: true, color: C.navy, align: 'right' });
      x += cw[1];
      g.text(f(prv), x + cw[2] - 3, y + 4.9, { size: 8.4, color: C.muted, align: 'right' });
      x += cw[2];
      g.text(f(avg), x + cw[3] - 3, y + 4.9, { size: 8.4, color: C.muted, align: 'right' });
      x += cw[3];
      // Direction chip against the previous month.
      if (cur !== null && prv !== null && prv !== undefined && prv > 0) {
        const delta = (cur - prv) / prv;
        const up = delta > 0;
        const flat = Math.abs(delta) < 0.02;
        const col = flat ? C.muted : C.body;   // a change, not a verdict: spend up isn't wrong in a growing fleet
        g.text(flat ? '—' : `${up ? '+' : '-'}${Math.round(Math.abs(delta) * 100)}%`,
          x + cw[4] - 3, y + 4.9, { size: 7, bold: true, color: col, align: 'right' });
      }
      y += rowH;
    });

    y += 9;

    /* Where the money went — top spending vehicles this month, each bar split
       by type (fuel, tolls, servicing, repairs) as on the Cost sheet. */
    y = subhead(g, M.l, y, 'Top spending vehicles', `Fuel, tolls, servicing and repairs this ${P.word}`) + 1;
    if (!data.topSpenders.length) {
      g.text(`No cost recorded against any vehicle this ${P.word}.`, M.l, y + 2,
        { size: 9, italic: true, color: C.muted });
      y += 12;
    } else {
      const maxSpend = data.topSpenders[0].cost || 1;
      data.topSpenders.slice(0, 4).forEach((s) => {
        const p = s.parts || { fuel: s.cost, toll: 0, planned: 0, unplanned: 0 };
        g.text(s.id, M.l, y + 3.4, { size: 9, bold: true, color: C.navy });
        g.text(s.v ? (s.v.type || '') : '', M.l + 26, y + 3.4, { size: 7.6, color: C.muted, maxWidth: 34 });
        g.stackBar(M.l + 62, y, CONTENT_W - 92, 5, [
          { value: p.fuel, color: S.fuel }, { value: Math.max(0, p.toll), color: S.toll },
          { value: p.planned, color: S.planned }, { value: p.unplanned, color: S.unplanned }
        ], maxSpend, C.ruleSoft);
        g.text(AD.fleetReport.aud(s.cost), M.l + CONTENT_W, y + 3.4,
          { size: 8.6, bold: true, color: C.navy, align: 'right' });
        y += 8.4;
      });
      let lx = M.l + 62;
      [['Fuel', S.fuel], ['Tolls', S.toll], ['Servicing', S.planned], ['Repairs', S.unplanned]].forEach(([lab, col]) => {
        g.rect(lx, y - 1.4, 2.4, 2.4, col);
        g.text(lab, lx + 3.6, y + 0.6, { size: 6.8, color: C.muted });
        lx += 20;
      });
      y += 3;
    }

    y += 6;

    /* Spend mix — the month's planned / unplanned / fuel split beside the twelve-month
       norm, so a shift in the balance is visible rather than inferred. */
    y = subhead(g, M.l, y, 'Spend mix', `This ${P.word} against the average month`) + 1;
    const mixes = [
      { title: P.isYear ? P.label : 'This month', planned: data.curMonth.planned, unplanned: data.curMonth.unplanned, fuel: data.curMonth.fuel, toll: Math.max(0, data.curMonth.toll || 0), tollNA: data.tollsNotIn },
      { title: 'Average month', planned: avgPlanned, unplanned: avgUnplan, fuel: avgFuel, toll: Math.max(0, avgToll || 0) }
    ];
    const mw = (CONTENT_W - 6) / 2, mh = 47;
    mixes.forEach((m, i) => {
      const x = M.l + i * (mw + 6);
      const tot = m.planned + m.unplanned + (m.fuel || 0) + (m.toll || 0);
      g.line(x, y, x + mw, y, C.rule, 0.3);
      // (no box: a hairline above is enough)

      caps(g, m.title, x + 6, y + 7.5);

      const cx = x + 17, cy = y + 26;
      g.donut(cx, cy, 10, 6.2, [
        { label: 'Planned',   value: m.planned,   color: S.planned },
        { label: 'Unplanned', value: m.unplanned, color: S.unplanned },
        { label: 'Fuel',      value: m.fuel || 0, color: S.fuel },
        { label: 'Tolls',     value: m.toll || 0, color: S.toll }
      ]);
      const share = tot > 0 ? (m.fuel || 0) / tot : 0;
      g.text(tot > 0 ? Math.round(share * 100) + '%' : 'N/A', cx, cy + 1, { size: 8.5, bold: true, color: C.navy, align: 'center' });
      g.text('fuel', cx, cy + 4.6, { size: 4.6, bold: true, color: C.muted, align: 'center' });

      let ly = y + 14.5;
      [['Fuel', m.fuel || 0, S.fuel], ['Tolls', m.toll || 0, S.toll], ['Planned', m.planned, S.planned], ['Unplanned', m.unplanned, S.unplanned]].forEach(([lab, v, col]) => {
        g.rect(x + 34, ly - 2.2, 2.6, 2.6, col);
        g.text(lab, x + 39, ly, { size: 7.6, color: C.body });
        g.text(lab === 'Tolls' && m.tollNA ? 'not in yet' : shortAud(v), x + mw - 6, ly, { size: 8, bold: true, color: C.navy, align: 'right' });
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
      const dir = data.momPct >= 0 ? 'up' : 'down';
      bits.push(`${dir.charAt(0).toUpperCase() + dir.slice(1)} ${Math.round(Math.abs(data.momPct) * 100)}% on ${P.isYear ? P.prevLabel : 'last month'}${data.isPartial ? ` (${P.word} still running)` : ''}.`);
    }
    if (data.curMonth.total > 0) {
      bits.push(`Fuel was ${Math.round(data.fuelShare * 100)}% of spend, ${data.tollsNotIn ? 'tolls not in yet' : `tolls ${Math.round(data.tollShare * 100)}%`}, planned servicing ${Math.round(data.plannedShare * 100)}% and unplanned repairs ${Math.round(data.unplannedShare * 100)}%${data.isYear ? '' : ` (12-month: ${Math.round(data.fuelShare12 * 100)}%, ${Math.round(data.tollShare12 * 100)}%, ${Math.round(data.plannedShare12 * 100)}% and ${Math.round(data.unplannedShare12 * 100)}%)`}.`);
      if (data.yearForecast) bits.push(`The year is forecast to close near ${AD.fleetReport.aud(data.yearForecast.total)}.`);
    } else {
      bits.push('Nothing recorded yet — check the source data.');
    }
    if (data.avgResolveDays !== null) {
      bits.push(`Defects took ${Math.round(data.avgResolveDays)} days to close on average.`);
    }
    if (data.topShare >= 0.2 && data.topSpenders.length) {
      bits.push(`${data.topSpenders[0].id} alone was ${Math.round(data.topShare * 100)}% of spend.`);
    }

    const narrative = bits.join(' ');
    const nh = g.textHeight(narrative, { size: 9.4, maxWidth: CONTENT_W - 14, lineHeight: 4.6 }) + 13;
    // Flow forward instead of shifting the narrative over the charts above.
    if (y + nh > PAGE.h - 18) {
      g.doc.addPage();
      g.setPage(g.getPage() + 1);
      chrome(g, data, `${data.period.name} in numbers (continued)`, g.getPage(), data._logo);
      y = 28;
    }
    g.rect(M.l, y, CONTENT_W, nh, C.blueTint);
    g.rect(M.l, y, 1.2, nh, C.blue);
    caps(g, 'In short', M.l + 7, y + 7, { color: C.blue, bold: true });
    g.text(narrative, M.l + 7, y + 13, { size: 9, color: C.navy, maxWidth: CONTENT_W - 14 });
  }

  /* ------------------------------------------------------------------ page 6 */

  function recsPage(g, data) {
    let y = 30;
    y = heading(g, M.l, y, 'Recommendations', 'What the figures say to do next, most important first');

    // Priority is state, so it uses the status colours — always with its word.
    const TONE = {
      High:   { dot: C.red,   text: C.red },
      Medium: { dot: C.amber, text: C.amberInk },
      Low:    { dot: C.blue,  text: C.blue }
    };
    const TEXT_X = M.l + 17, TEXT_W = CONTENT_W - 17;

    g.line(M.l, y - 3, M.l + CONTENT_W, y - 3, C.rule, 0.3);
    data.recommendations.forEach((r, i) => {
      const t = TONE[r.priority] || TONE.Low;
      const titleH = g.textHeight(r.title, { size: 11, bold: true, maxWidth: TEXT_W - 34 });
      const findingH = g.textHeight(r.finding, { size: 9, maxWidth: TEXT_W, lineHeight: 4.3 });
      const actionH = g.textHeight(r.action, { size: 9, maxWidth: TEXT_W - 6, lineHeight: 4.3 });
      const h = 7 + titleH + 2.5 + findingH + 5 + 4.2 + actionH + 7;

      // Keep each recommendation whole: carry it to a new page rather than split it.
      if (y + h > PAGE.h - 24) {
        g.doc.addPage();
        g.setPage(g.getPage() + 1);
        chrome(g, data, 'Recommendations (continued)', g.getPage(), data._logo);
        y = 30;
      }

      // Number, in the brand blue.
      g.text(String(i + 1).padStart(2, '0'), M.l, y + 7.4, { size: 20, bold: true, color: C.blue });
      // Priority: dot + word, right-aligned.
      const pLabel = `${r.priority} priority`;
      caps(g, pLabel, M.l + CONTENT_W, y + 6.2, { color: t.text, align: 'right' });
      g.doc.setFont(FONT, 'normal'); g.doc.setFontSize(6.75);
      const pw = g.doc.getTextWidth(safe(pLabel));
      g.fill(t.dot); g.doc.circle(M.l + CONTENT_W - pw - 2.6, y + 5.2, 1.1, 'F');

      let ty = g.text(r.title, TEXT_X, y + 6.6, { size: 11, bold: true, color: C.navy, maxWidth: TEXT_W - 34, lineHeight: 4.8 });
      ty = g.text(r.finding, TEXT_X, ty + 2.4, { size: 9, color: C.body, maxWidth: TEXT_W, lineHeight: 4.3 });
      // The action — marked with the brand green, the colour for "do this".
      ty += 4;
      g.rect(TEXT_X, ty - 3, 1.2, actionH + 5.2, C.green);
      caps(g, 'Action', TEXT_X + 4, ty, { color: C.navy });
      ty = g.text(r.action, TEXT_X + 4, ty + 4.2, { size: 9, color: C.navy, maxWidth: TEXT_W - 6, lineHeight: 4.3 });

      y = Math.max(y + h, ty + 5);
      g.line(M.l, y - 2, M.l + CONTENT_W, y - 2, C.rule, 0.3);
      y += 4;
    });

    /* Method note. */
    if (y > PAGE.h - 40) {
      g.doc.addPage();
      g.setPage(g.getPage() + 1);
      chrome(g, data, 'Recommendations (continued)', g.getPage(), data._logo);
      y = 30;
    }
    y = Math.max(y + 4, PAGE.h - 34);
    caps(g, 'How these are chosen', M.l, y);
    g.text(
      'Flagged automatically from spend, compliance state, defect ageing and data-coverage checks (fuel-card and Linkt imports), then ranked. Review with the fleet manager before acting.',
      M.l, y + 4.5, { size: 7.4, color: C.muted, maxWidth: CONTENT_W, lineHeight: 3.5 });
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

  // Compact distance for narrow columns.
  function shortKm(n) {
    const v = Math.round(Number(n || 0));
    return v.toLocaleString('en-AU') + ' km';
  }
  function perKmStr(n) {
    return '$' + (n >= 10 ? Math.round(n).toLocaleString('en-AU') : n.toFixed(2));
  }
  function medianOf(nums) {
    if (!nums.length) return 0;
    const s = [...nums].sort((a, b) => a - b), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /**
   * Running cost against actual use per owned GPS-tracked vehicle — taken
   * straight from the Cost sheet's Cost vs usage (AD.views['cost-sheet'].model)
   * so the report and the app always show the same figures: only days that
   * have BOTH GPS and fuel-card data, spend = fuel card + Linkt tolls +
   * servicing + repairs over exactly those days, and a vehicle is ranked once
   * it has READY days of that overlap. Nothing is extrapolated.
   */
  function gatherUsage() {
    const model = AD.views && AD.views['cost-sheet'] && AD.views['cost-sheet'].model;
    const owned = AD.store.all('vehicles').filter((v) => !v.hired);
    const gpsVerified = owned.filter((v) => v.odometerSource === 'telematics').length;
    const empty = { lines: [], collecting: [], medKm: 0, medHr: 0, ownedCount: owned.length, gpsVerified, ready: 28, steady: 60 };
    if (!model) return empty;
    const READY = model.READY_USAGE_DAYS, STEADY = model.STEADY_USAGE_DAYS;
    const kmRes = model.usageMeasures('km');
    const byKm = new Map(kmRes.list.map((m) => [m.v.id, m]));
    const byHr = new Map(model.usageMeasures('hr').list.map((m) => [m.v.id, m]));
    const ids = [...new Set([...byKm.keys(), ...byHr.keys()])];
    const lines = [], collecting = [];
    ids.forEach((id) => {
      const k = byKm.get(id), h = byHr.get(id);
      const ready = (k && k.state === 'ready') || (h && h.state === 'ready');
      const base = (k && k.state !== 'waiting' ? k : null) || (h && h.state !== 'waiting' ? h : null);
      if (!base) return;
      if (!ready) {
        if (base.state === 'collecting') collecting.push({ id, span: base.span, readyBy: T.addDays(base.fromKey, READY - 1), cut: base.cut, reach: base.reach });
        return;
      }
      const m = (k && k.state === 'ready') ? k : h;
      lines.push({
        id, type: m.v.type, from: m.fromKey, to: m.toKey, span: m.span,
        km: k && k.state !== 'waiting' ? k.use : 0, hrs: h && h.state !== 'waiting' ? h.use : 0,
        fuel: m.fuel, toll: m.toll, planned: m.planned, unplanned: m.unplanned, spend: m.spend,
        perKm: k && k.state === 'ready' ? k.rate : null,
        perHr: h && h.state === 'ready' ? h.rate : null,
        l100: k && k.litres > 0 && k.use > 0 ? (k.litres / k.use) * 100 : null,
        hrsWeek: h && h.state !== 'waiting' ? (h.use / h.span) * 7 : 0,
        thin: m.span < STEADY
      });
    });
    const medKm = medianOf(lines.filter((l) => l.perKm != null).map((l) => l.perKm));
    const medHr = medianOf(lines.filter((l) => l.perHr != null).map((l) => l.perHr));
    const medUse = medianOf(lines.filter((l) => l.hrs > 0).map((l) => l.hrsWeek));
    lines.forEach((l) => {
      l.costlyKm = lines.length > 1 && medKm > 0 && l.perKm != null && l.perKm > medKm * 1.3;
      l.costlyHr = lines.length > 1 && medHr > 0 && l.perHr != null && l.perHr > medHr * 1.3;
      l.lowUse = medUse > 0 && l.hrsWeek < medUse * 0.6;
      l.watch = (l.costlyKm || l.costlyHr) && l.lowUse && !l.thin;
    });
    // Highest cost per engine hour first (the fairer measure for vac trucks), then per km.
    lines.sort((a, b) => (b.perHr || 0) - (a.perHr || 0) || (b.perKm || 0) - (a.perKm || 0));
    collecting.sort((a, b) => b.span - a.span);
    // Tolls only go as far as the latest Linkt statement (as the Cost sheet says).
    let tollNote = '';
    if (kmRes.tollReach && lines.length) {
      const minFrom = lines.reduce((a, l) => (l.from < a ? l.from : a), lines[0].from);
      const maxTo = lines.reduce((a, l) => (l.to > a ? l.to : a), lines[0].to);
      if (kmRes.tollReach < minFrom) tollNote = `Tolls aren't in these figures yet: the latest Linkt statement ends ${T.fmtKey(kmRes.tollReach)}, before the days measured.`;
      else if (kmRes.tollReach < maxTo) tollNote = `Tolls are counted to ${T.fmtKey(kmRes.tollReach)} (the latest Linkt statement); later days are fuel, servicing and repairs only.`;
    }
    return { lines, collecting, medKm, medHr, ownedCount: owned.length, gpsVerified, ready: READY, steady: STEADY, tollNote };
  }

  /**
   * Workshop visits detected by the GPS geofences (create-workshop-geofence.sql)
   * during the report month, paired arrival -> departure from the Activity log.
   * Best-effort: [] if the log can't be read or the geofences aren't running.
   */
  async function fetchWorkshopVisits(data) {
    try {
      const { year, month } = data.now;
      // The report's period: the month, or the whole year.
      const start = new Date(data.isYear ? T.fromParts(year, 1, 1) : T.fromParts(year, month, 1)).toISOString();
      const next = data.isYear || month === 12 ? T.fromParts(year + 1, 1, 1) : T.fromParts(year, month + 1, 1);
      const { data: rows, error } = await AD.sb.from('activity')
        .select('ts,vehicleId,text').like('id', 'act-geo-%')
        .gte('ts', start).lt('ts', new Date(next).toISOString())
        .order('ts', { ascending: true }).limit(data.isYear ? 3000 : 500);
      if (error || !Array.isArray(rows)) return [];
      const open = new Map(), visits = [];
      rows.forEach((r) => {
        const arrived = /parked at (.+?) for 30\+ min/.exec(r.text || '');
        const left = /left (.+?) — back to/.exec(r.text || '');
        if (arrived) {
          const v = { id: r.vehicleId, workshop: arrived[1], in: Date.parse(r.ts), out: null };
          open.set(r.vehicleId, v); visits.push(v);
        } else if (left && open.has(r.vehicleId)) {
          open.get(r.vehicleId).out = Date.parse(r.ts);
          open.delete(r.vehicleId);
        }
      });
      return visits;
    } catch (e) { return []; }
  }

  /* ------------------------------------------------------------------ usage page */

  /**
   * What the GPS recorded over the report's period, from the daily telematics
   * rows (vehicle_work_hours_daily: one row per vehicle per day, engine hours
   * and kilometres). Only days the nightly sync holds are counted, and the
   * first one is stated, so a short history reads as short — not as a quiet
   * period.
   */
  function gatherGps(data) {
    const from = data.periodStart, to = data.reportEnd;
    const byId = new Map(AD.store.all('vehicles').map((v) => [v.id, v]));
    const per = new Map();
    let first = '', last = '';
    (AD.store.all('vehicle_work_hours_daily') || []).forEach((r) => {
      const d = String(r.day || '').slice(0, 10);
      if (!d || d < from || d > to) return;
      const km = Number(r.distanceKm) || 0, hrs = Number(r.hours) || 0;
      const t = per.get(r.vehicleId) || { id: r.vehicleId, km: 0, hrs: 0, days: 0, worked: 0 };
      t.km += km; t.hrs += hrs; t.days++;
      if (km >= 1 || hrs >= 0.25) t.worked++;   // a day the vehicle actually did something
      per.set(r.vehicleId, t);
      if (!first || d < first) first = d;
      if (d > last) last = d;
    });
    // Weekdays across the span the GPS covers, for each vehicle's use of them.
    let weekdays = 0;
    if (first) for (let d = first; d <= last; d = T.addDays(d, 1)) if (T.dayOfWeek(d) <= 4) weekdays++;
    const list = [...per.values()].map((t) => ({ ...t, v: byId.get(t.id) || { id: t.id }, kmPerDay: t.worked ? t.km / t.worked : 0, use: weekdays ? Math.min(1, t.worked / weekdays) : 0 }))
      .sort((a, b) => b.km - a.km);
    const totals = list.reduce((a, t) => ({ km: a.km + t.km, hrs: a.hrs + t.hrs, worked: a.worked + t.worked }), { km: 0, hrs: 0, worked: 0 });
    return { list, ...totals, first, last, weekdays, tracked: list.length };
  }

  function usagePage(g, data) {
    const P = data.period;
    const gps = data.gps || { list: [], km: 0, hrs: 0, worked: 0, tracked: 0 };
    const u = data.usage || { lines: [], collecting: [], ownedCount: 0, gpsVerified: 0, ready: 28, steady: 60 };
    const n0 = (n) => Math.round(n).toLocaleString('en-AU');
    let y = 30;
    y = heading(g, M.l, y, 'Fleet usage & efficiency',
      gps.first ? `What the GPS recorded in ${P.label}${data.isPartial ? ' to date' : ''}` : `No daily GPS data in ${P.label}`);
    // Carry on to a new page rather than run off this one.
    const room = (need, title) => {
      if (y + need <= PAGE.h - 20) return;
      g.doc.addPage();
      g.setPage(g.getPage() + 1);
      chrome(g, data, `${title} (continued)`, g.getPage(), data._logo);
      y = 30;
    };

    /* The period in GPS totals — no boxes, hairlines between. */
    const figs = [
      ['Kilometres driven', n0(gps.km), 'by GPS-tracked vehicles'],
      ['Engine hours', n0(gps.hrs), 'engine on, moving or parked'],
      ['Days worked', n0(gps.worked), 'vehicle-days with any use'],
      ['GPS-tracked vehicles', String(gps.tracked), `odometers GPS-verified on ${u.gpsVerified} of ${u.ownedCount}`]
    ];
    const colW = CONTENT_W / 4;
    g.line(M.l, y, M.l + CONTENT_W, y, C.rule, 0.3);
    figs.forEach(([label, value, note], i) => {
      const x = M.l + i * colW + (i ? 5 : 0);
      if (i) g.line(M.l + i * colW, y + 4, M.l + i * colW, y + 27, C.rule, 0.3);
      caps(g, label, x, y + 8);
      g.text(value, x, y + 19.5, { size: 25.2, bold: true, color: C.navy });
      g.text(note, x, y + 25, { size: 6.75, color: C.muted, maxWidth: colW - 8 });
    });
    y += 31;
    g.line(M.l, y, M.l + CONTENT_W, y, C.rule, 0.3);
    y += 6;
    if (gps.first && gps.first > data.periodStart) {
      y = g.text(`Daily GPS data starts ${T.fmtKey(gps.first)}, when the nightly sync began, so these totals cover ${T.daysBetween(gps.first, gps.last) + 1} days of ${P.label}, not all of it.`,
        M.l, y, { size: 6.75, color: C.muted, maxWidth: CONTENT_W }) + 4;
    }
    y += 6;

    /* Most-used vehicles: distance, hours, and how many weekdays each worked. */
    if (gps.list.length) {
      y = subhead(g, M.l, y, 'Most-used vehicles', `By distance · ${gps.weekdays} weekday${gps.weekdays === 1 ? '' : 's'} covered`) + 1;
      const cols = [
        { t: 'Vehicle', w: 22, a: 'left' }, { t: 'Type', w: 34, a: 'left' }, { t: 'Days worked', w: 22, a: 'right' },
        { t: 'Km', w: 22, a: 'right' }, { t: 'Engine hrs', w: 22, a: 'right' }, { t: 'Km per day worked', w: 30, a: 'right' },
        { t: 'Weekdays used', w: 26, a: 'right' }
      ];
      tableHead(g, M.l, y, CONTENT_W, 7.5, cols);
      y += 7.5;
      gps.list.slice(0, 8).forEach((r) => {
        const vals = [r.id, r.v.type || '—', String(r.worked), n0(r.km), n0(r.hrs), r.worked ? n0(r.kmPerDay) : '—', gps.weekdays ? `${Math.round(r.use * 100)}%` : '—'];
        let x = M.l;
        vals.forEach((s, ci) => {
          const c = cols[ci];
          g.text(safe(s), c.a === 'left' ? x + 2.5 : x + c.w - 2.5, y + 4.6, { size: 9, bold: ci === 0, color: ci === 0 ? C.navy : C.body, align: c.a, maxWidth: c.a === 'left' ? c.w - 3 : undefined });
          x += c.w;
        });
        g.line(M.l, y + 6.6, M.l + CONTENT_W, y + 6.6, C.ruleSoft, 0.25);
        y += 6.6;
      });
      if (gps.list.length > 8) { y = g.text(`and ${gps.list.length - 8} more GPS-tracked vehicles.`, M.l, y + 4, { size: 6.75, color: C.muted }) + 1; }
      y += 10;
    }
    room(60, 'Fleet usage & efficiency');

    /* Running cost table. */
    y = subhead(g, M.l, y, 'Running cost per km & per engine hour');
    y = g.text('Fuel, tolls, servicing and repairs over days with both GPS and fuel-card data, highest cost per hour first.', M.l, y, { size: 6.75, color: C.muted }) + 5;
    // Still building up their READY days of GPS and fuel data side by side.
    const collectNote = () => {
      if (!u.collecting.length) return;
      const first = u.collecting.reduce((a, c) => (c.readyBy < a.readyBy ? c : a), u.collecting[0]);
      const cut = u.collecting.some((c) => c.cut);
      y = g.text(`${u.collecting.length} vehicle${u.collecting.length === 1 ? ' is' : 's are'} still collecting data: a vehicle is ranked once it has ${u.ready} days of GPS and fuel-card data side by side, so one tank fill more or less doesn't swing its figure. First ready about ${T.fmtKey(first.readyBy)}${cut ? ', once the fuel statements covering those days are imported' : ''}.`,
        M.l, y + 1, { size: 8, italic: true, color: C.muted, maxWidth: CONTENT_W, lineHeight: 3.8 }) + 5;
    };
    if (!u.lines.length) {
      if (u.collecting.length) collectNote();
      else {
        g.text('No GPS-tracked vehicle has daily GPS data matched to fuel-card data yet. Figures appear as the', M.l, y + 1, { size: 9, italic: true, color: C.muted });
        g.text('nightly sync builds up daily kilometres and engine hours and fuel statements are imported.', M.l, y + 6, { size: 9, italic: true, color: C.muted });
        y += 16;
      }
    } else {
      const cols = [
        { k: 'id', t: 'Vehicle', w: 20, a: 'left' }, { k: 'days', t: 'Days', w: 12, a: 'right' },
        { k: 'km', t: 'Km', w: 18, a: 'right' }, { k: 'hrs', t: 'Eng hrs', w: 16, a: 'right' },
        { k: 'fuel', t: 'Fuel', w: 19, a: 'right' }, { k: 'toll', t: 'Tolls', w: 17, a: 'right' },
        { k: 'maint', t: 'Svc + repairs', w: 22, a: 'right' },
        { k: 'pkm', t: '$ / km', w: 19, a: 'right' }, { k: 'phr', t: '$ / hr', w: 19, a: 'right' },
        { k: 'l100', t: 'L/100km', w: 16, a: 'right' }
      ];
      const tableW = cols.reduce((a, c) => a + c.w, 0);
      const ox = M.l;
      g.rect(ox, y, tableW, 7.5, C.blueTint); g.line(ox, y + 7.5, ox + tableW, y + 7.5, C.navy, 0.35);
      let hx = ox;
      cols.forEach((c) => { g.text(c.t, c.a === 'left' ? hx + 3 : hx + c.w - 3, y + 5.1, { size: 7.2, bold: true, color: C.navy, align: c.a }); hx += c.w; });
      y += 7.5;
      u.lines.slice(0, 12).forEach((l, i) => {
        const rowH = 7.6;
        g.line(ox, y + rowH, ox + tableW, y + rowH, C.ruleSoft, 0.25);
        let x = ox;
        cols.forEach((c) => {
          const tx = c.a === 'left' ? x + 3 : x + c.w - 3;
          const o = { size: 8, color: C.body, align: c.a };
          let s = '';
          if (c.k === 'id') { s = safe(l.id); o.bold = true; o.color = C.navy; o.size = 8.4; }
          else if (c.k === 'days') { s = l.span + (l.thin ? '*' : ''); o.color = l.thin ? C.muted : C.body; }
          else if (c.k === 'km') s = Math.round(l.km).toLocaleString('en-AU');
          else if (c.k === 'hrs') s = Math.round(l.hrs).toLocaleString('en-AU');
          else if (c.k === 'fuel') s = l.fuel ? shortAud(l.fuel) : '—';
          else if (c.k === 'toll') s = l.toll ? shortAud(l.toll) : '—';
          else if (c.k === 'maint') s = l.planned + l.unplanned ? shortAud(l.planned + l.unplanned) : '—';
          else if (c.k === 'pkm') { s = l.perKm != null ? perKmStr(l.perKm) : '—'; o.bold = true; o.color = l.costlyKm ? C.red : C.navy; }
          else if (c.k === 'phr') { s = l.perHr != null ? perKmStr(l.perHr) : '—'; o.bold = true; o.color = l.costlyHr ? C.red : C.navy; }
          else if (c.k === 'l100') s = l.l100 != null ? l.l100.toFixed(1) : '—';
          g.text(s, tx, y + 5.1, o);
          x += c.w;
        });
        y += rowH;
      });
      y += 4;
      const med = [u.medKm > 0 ? `median ${perKmStr(u.medKm)}/km` : '', u.medHr > 0 ? `${perKmStr(u.medHr)}/engine hour` : ''].filter(Boolean).join(' and ');
      g.text(`Red = 30%+ above the fleet ${med || 'median'}.  * Under ${u.steady} days measured, so the figure may still move.`,
        M.l, y + 1, { size: 7, italic: true, color: C.muted });
      y += 5;
      if (u.tollNote) { g.text(u.tollNote, M.l, y + 1, { size: 7, italic: true, color: C.muted }); y += 5; }
      y += 4;
      collectNote();

      /* Replacement watch-list. */
      const watch = u.lines.filter((l) => l.watch);
      if (watch.length) {
        g.roundRect(M.l, y, CONTENT_W, 10 + watch.length * 6.5, 2.5, C.redPale);
        g.text('REPLACEMENT WATCH-LIST · LOW USE, HIGH COST', M.l + 7, y + 8, { size: 7.5, bold: true, color: C.red });
        let wy = y + 15;
        watch.forEach((l) => {
          g.text(safe(l.id), M.l + 7, wy, { size: 8.6, bold: true, color: C.navy });
          g.text(`${l.perHr != null ? perKmStr(l.perHr) + '/hr · ' : ''}only ${Math.round(l.hrsWeek)} engine hrs/week · ${AD.fleetReport.aud(l.spend)} over ${l.span} days`, M.l + 34, wy, { size: 8, color: C.body });
          wy += 6.5;
        });
        y = wy + 4;
      }
    }

    /* Workshop visits detected by the GPS geofences. */
    room(40, "Fleet usage & efficiency");
    y += 4;
    y = subhead(g, M.l, y, 'Workshop visits (GPS)', `Detected by the workshop geofences in ${data.period.label}`) + 2;
    const visits = data.workshopVisits || [];
    if (!visits.length) {
      g.text(`None recorded this ${data.period.word}.` + ' Visits are logged automatically once the workshop geofences are running.', M.l, y + 1, { size: 9, italic: true, color: C.muted });
      return;
    }
    const fmtWhen = (ms) => (ms ? `${T.fmtKey(T.dateKey(ms)).slice(0, 5)} ${T.fmtTime(ms)}` : 'Still there');
    const dur = (v) => {
      if (!v.out) return '—';
      const h = (v.out - v.in) / 3600000;
      return h >= 24 ? `${(h / 24).toFixed(1)} days` : `${h.toFixed(1)} hrs`;
    };
    const vc = [{ t: 'Vehicle', w: 22 }, { t: 'Workshop', w: 72 }, { t: 'Arrived', w: 28 }, { t: 'Left', w: 28 }, { t: 'Time in', w: 28 }];
    g.rect(M.l, y, CONTENT_W, 7, C.blueTint); g.line(M.l, y + 7, M.l + CONTENT_W, y + 7, C.navy, 0.35);
    let vx = M.l;
    vc.forEach((c) => { g.text(c.t, vx + 3, y + 4.8, { size: 7.2, bold: true, color: C.navy }); vx += c.w; });
    y += 7;
    visits.slice(0, 10).forEach((v, i) => {
      g.line(M.l, y + 7, M.l + CONTENT_W, y + 7, C.ruleSoft, 0.25);
      const vals = [safe(v.id), safe(v.workshop), fmtWhen(v.in), v.out ? fmtWhen(v.out) : 'Still there', dur(v)];
      let x = M.l;
      vals.forEach((s, ci) => {
        g.text(s, x + 3, y + 4.8, { size: 7.8, bold: ci === 0, color: ci === 0 ? C.navy : C.body, maxWidth: vc[ci].w - 4 });
        x += vc[ci].w;
      });
      y += 7;
    });
    if (visits.length > 10) g.text(`and ${visits.length - 10} more in the Activity log.`, M.l, y + 4, { size: 7.4, italic: true, color: C.muted });
  }

  /* ------------------------------------------------------------------ public */

  async function generate(onProgress, options = {}) {
    const notify = (t) => onProgress && onProgress(t);
    notify('Loading PDF engine…');
    const jsPDF = await loadJsPDF();
    await AD.fleetReport.ensureTolls(notify);
    notify('Gathering fleet data…');
    const data = AD.fleetReport.gather(options.month, options);
    data.usage = gatherUsage();
    data.gps = gatherGps(data);
    // Logos: the Astrea primary logo (company) and the Astrea Drive logo (product), for the cover and the page headers.
    const logos = {
      astreaBlue: await loadImg('assets/astrea-logo-blue.png'),
      astreaWhite: await loadImg('assets/astrea-logo-white.png'),
      driveBlue: await loadImg('assets/logo-horizontal-white.png'),
      driveWhite: await loadImg('assets/logo-lockup.png')
    };
    notify('Fetching workshop visits…');
    data.workshopVisits = await fetchWorkshopVisits(data);
    notify('Drawing report…');

    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    doc.setProperties({
      title: `Astrea ${data.period.kind} Fleet Report — ${data.period.label}`,
      subject: 'Fleet performance',
      author: 'Astrea Drive',
      creator: 'Astrea Drive'
    });

    const g = mk(doc);

    g.setPage(1);
    data.sectionPages = {};
    data._logo = logos;

    const pages = [
      ['Executive summary',    summaryPage],
      ['Spend analysis',       spendPage],
      ['Fleet and compliance', fleetPage],
      [data.period.name + ' in numbers', statsPage],
      ['Fleet usage & efficiency', usagePage],
      ['Recommendations',      recsPage]
    ];
    pages.forEach(([title, draw]) => {
      doc.addPage();
      g.setPage(g.getPage() + 1);
      data.sectionPages[title] = g.getPage();
      chrome(g, data, title, g.getPage(), logos);
      draw(g, data);
    });
    doc.setPage(1);
    coverPage(g, data, logos);

    notify('Writing file…');
    const filename = `Astrea ${data.period.kind} Fleet Report — ${data.period.label}.pdf`;
    await doc.save(filename, { returnPromise: true });
    notify('Done.');
    return filename;
  }

  return { generate };
})();
