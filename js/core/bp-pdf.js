/*
 * Read BP Plus PDFs into receipt-level fuel transactions. Two BP reports:
 *  - Vehicle Analysis: one text line per product line.
 *  - Fleet Control Report (By Card Number): landscape pages, one section per
 *    card (a vehicle's rego, or a person's name), the product name on its own
 *    lines either side of the amounts, and an Account Summary to check against.
 */
window.AD = window.AD || {};

AD.bpPdf = (function () {
  const HEADERS = [
    'Registration Number', 'Date', 'Receipt Number', 'Card Number', 'Location',
    'Product Name', 'Quantity (Litres)', 'Total Including GST', 'Fuel brand', 'Name on card'
  ];
  const number = (value) => {
    const n = Number(String(value == null ? '' : value).replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  const compactRego = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const foldRego = (value) => compactRego(value).replace(/[OISBZGQ]/g, (c) => ({ O: '0', I: '1', S: '5', B: '8', Z: '2', G: '6', Q: '0' }[c]));

  function itemsToLines(items) {
    const groups = [];
    (items || []).forEach((item) => {
      const value = String(item && item.str || '').trim();
      if (!value || !item.transform) return;
      const x = Number(item.transform[4]) || 0;
      const y = Number(item.transform[5]) || 0;
      let group = groups.find((candidate) => Math.abs(candidate.y - y) <= 0.8);
      if (!group) { group = { y, items: [] }; groups.push(group); }
      group.items.push({ x, value });
    });
    return groups
      .sort((a, b) => b.y - a.y)
      .map((group) => group.items.sort((a, b) => a.x - b.x).map((item) => item.value).join(' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  // Text positions in the page as displayed, so a landscape (rotated) page
  // reads across its rows rather than down its columns.
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  function cellsOf(items, viewport) {
    return (items || []).map((item) => {
      const s = String(item && item.str || '').trim();
      if (!s || !item.transform || !viewport) return null;
      const t = mul(viewport.transform, item.transform);
      return { x: t[4], y: t[5], s };
    }).filter(Boolean);
  }
  /** Cells grouped into rows, top to bottom, each row left to right. */
  function rowsOf(cells) {
    const rows = [];
    (cells || []).forEach((cell) => {
      let row = rows.find((r) => Math.abs(r.y - cell.y) <= 2);
      if (!row) { row = { y: cell.y, cells: [] }; rows.push(row); }
      row.cells.push(cell);
    });
    rows.forEach((r) => { r.cells.sort((a, b) => a.x - b.x); r.text = r.cells.map((c) => c.s).join(' '); });
    return rows.sort((a, b) => a.y - b.y);
  }

  function cardFrom(lines) {
    for (const line of lines) {
      const match = /Card Number:\s*([0-9 ]{8,})/i.exec(line);
      if (match) return match[1].replace(/\D/g, '');
    }
    return '';
  }

  function regoFrom(lines, vehicles) {
    for (const line of lines) {
      const part = line.split(/Reference:/i)[1];
      if (!part) continue;
      const candidate = compactRego(part);
      if (candidate.length >= 5 && candidate.length <= 8) return candidate;
    }

    const vehicleLine = lines.find((line) => /Vehicle:/i.test(line)) || '';
    const foldedLine = foldRego(vehicleLine);
    const known = (vehicles || []).filter((vehicle) => {
      const key = foldRego(vehicle && vehicle.rego);
      return key && foldedLine.includes(key);
    });
    if (known.length) return compactRego(known[0].rego);

    const after = vehicleLine.split(/Vehicle:/i)[1] || '';
    const tokens = after.trim().toUpperCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return '';
    if (/^[A-Z0-9]{5,8}$/.test(tokens[0])) return compactRego(tokens[0]);
    if (tokens.length > 1 && /^[A-Z0-9]{2,4}$/.test(tokens[0]) && /^[A-Z0-9]{2,4}$/.test(tokens[1])) {
      return compactRego(tokens[0] + tokens[1]);
    }
    return '';
  }

  function parseTransactionLine(line) {
    const amount = '-?[0-9][0-9,]*\\.\\d{2}';
    const whole = '-?[0-9][0-9,]*(?:\\.\\d+)?';
    const pattern = new RegExp(`^(\\d{2}/\\d{2}/\\d{2})\\s+([A-Z0-9]+)\\s+(.+?)\\s+(${amount})\\s+(${whole})\\s+(${whole})\\s+(${amount})\\s+(${amount})\\s+(${amount})$`, 'i');
    const match = pattern.exec(String(line || '').trim());
    if (!match) return null;
    const middle = match[3].match(/^(.*?)\s+AU\s+(.+)$/i);
    if (!middle) return null;
    return {
      date: AD.fuelIdentity.dateKey(match[1]),
      docket: match[2],
      location: middle[1].trim(),
      product: middle[2].trim(),
      litres: number(match[4]),
      cost: number(match[9])
    };
  }

  const isFleetControl = (pages) => /Fleet Control Report/i.test((pages && pages[0] || []).join(' '));

  /**
   * Fleet Control Report (By Card Number). Column positions are fixed on the
   * landscape page: date and time at the left, location ~110, receipt ~240,
   * product ~330, then excl GST ~430, GST ~480, incl GST ~525, litres ~570.
   * The product name sits on separate lines just above and below its amounts
   * ("AU BP ULS Diesel" / "(10ppm)"), unless it fits on the row ("AU AdBlue").
   * A second product on the same receipt is an amounts-only row under it.
   */
  function parseFleetControl(pages) {
    const DATE = /^\d{2}\/\d{2}\/\d{2}$/, MONEY = /^-?[0-9][0-9,]*\.\d{2}$/;
    const lineItems = [];
    const cards = new Set(), vehicleCards = new Set(), personCards = new Set();
    let feeRows = 0, feeTotal = 0, unreadableRows = 0;
    let accountTotal = null, accountNonProduct = 0, card = null, ctx = null;

    (pages || []).forEach((page) => {
      const rows = rowsOf(page.cells);
      const at = (r, lo, hi) => r.cells.filter((c) => c.x >= lo && c.x < hi);
      const money = (r, lo, hi) => { const c = at(r, lo, hi).find((cell) => MONEY.test(cell.s)); return c ? number(c.s) : null; };

      // BP's own totals for the whole report, to check the read against.
      if (rows.some((r) => /^Account Summary$/i.test(r.text))) {
        rows.forEach((r) => {
          const nums = r.cells.slice(1).map((c) => c.s).filter((s) => MONEY.test(s));
          if (nums.length < 3) return;
          const incl = number(nums[2]);
          if (/^Account Total/i.test(r.text)) accountTotal = incl;
          else if (/^(Card Fees|Transaction Fees|Card Sundry Adjustment)/i.test(r.text)) accountNonProduct += incl;
        });
        return;
      }

      // "Card Details: <number> - <rego> - <model> - <rego>", or "<number> - <NAME>" on a person's card.
      const det = rows.find((r) => /^Card Details:/i.test(r.text));
      if (det) {
        const parts = det.text.replace(/^Card Details:\s*/i, '').split(/\s+-\s+/);
        const num = (parts[0] || '').replace(/\D/g, '');
        const label = (parts[1] || '').trim();
        const compact = compactRego(label);
        const isRego = parts.length >= 3 || (/\d/.test(compact) && compact.length >= 5 && compact.length <= 8);
        if (!card || card.number !== num) ctx = null;
        card = { number: num, rego: isRego ? compact : '', holder: isRego ? '' : label };
        if (num) { cards.add(num); (card.rego ? vehicleCards : personCards).add(num); }
      }
      if (!card) return;

      // The transactions table: from its own column headings down to the card's
      // summary (whose headings also say "Excl GST", so take the first) or the footer.
      const header = rows.find((r) => /Excl GST/i.test(r.text));
      if (!header) return;
      const endRow = rows.find((r) => r.y > header.y && (/^Card Summary$/i.test(r.text) || /Page \d+ of/i.test(r.text)));
      const body = rows.filter((r) => r.y > header.y && (!endRow || r.y < endRow.y));
      const items = [], labels = [];
      body.forEach((r) => {
        const incl = money(r, 500, 548);
        const dated = r.cells[0] && r.cells[0].x < 60 && DATE.test(r.cells[0].s);
        const words = at(r, 320, 400).filter((c) => !MONEY.test(c.s)).map((c) => c.s).join(' ');
        if (incl == null) {
          // A product name or a long site name ("MACQUARIE" / "FIELDS") wrapped
          // onto the lines above and below its row.
          const place = at(r, 100, 185).map((c) => c.s).join(' ');
          if (!dated && (words || place)) { if (words) labels.push({ y: r.y, text: words, kind: 'product' }); if (place) labels.push({ y: r.y, text: place, kind: 'location' }); }
          else if (dated) unreadableRows++;
          return;
        }
        const location = at(r, 100, 185).map((c) => c.s).join(' ');
        const receipt = (at(r, 230, 290)[0] || {}).s || '';
        if (dated && !location && !receipt && !words) { feeRows++; feeTotal += incl; return; }   // the monthly card fee
        if (dated) {
          if (!receipt) { unreadableRows++; return; }
          ctx = { date: AD.fuelIdentity.dateKey(r.cells[0].s), docket: receipt, location, wrapped: !location };
        } else if (!ctx) { unreadableRows++; return; }
        const litres = money(r, 548, 592);
        items.push({ y: r.y, ctx, product: words, litres: litres || 0, cost: incl, labels: [] });
      });
      // Each wrapped line belongs to the nearest row still missing that part.
      labels.forEach((l) => {
        let best = null;
        items.forEach((it) => {
          const wants = l.kind === 'product' ? !it.product : it.ctx.wrapped;
          if (wants && Math.abs(it.y - l.y) <= 10 && (!best || Math.abs(it.y - l.y) < Math.abs(best.y - l.y))) best = it;
        });
        if (best) best.labels.push(l);
      });
      items.forEach((it) => {
        const join = (kind) => it.labels.filter((l) => l.kind === kind).sort((a, b) => a.y - b.y).map((l) => l.text).join(' ');
        if (it.ctx.wrapped && join('location')) { it.ctx.location = join('location'); it.ctx.wrapped = false; }
        const name = it.product || join('product');
        lineItems.push({
          date: it.ctx.date, docket: it.ctx.docket, location: it.ctx.location,
          product: name.replace(/^AU\s+/i, '').trim(), litres: it.litres, cost: it.cost,
          rego: card.rego, cardNumber: card.number, holder: card.holder
        });
      });
    });

    const result = receipts(lineItems);
    const parsedTotal = round2(lineItems.reduce((s, it) => s + it.cost, 0));
    return {
      headers: HEADERS.slice(), rows: result,
      meta: {
        format: 'Fleet Control Report',
        pages: (pages || []).length,
        cards: cards.size,
        vehicleCards: vehicleCards.size,
        personCards: personCards.size,
        lineItems: lineItems.length,
        transactions: result.length,
        feeRows,
        feeTotal: round2(feeTotal),
        unreadableRows,
        // BP's account total less card fees and adjustments = the products we import.
        reconcile: accountTotal == null ? null : { expected: round2(accountTotal - accountNonProduct), parsed: parsedTotal }
      }
    };
  }

  // BP prints diesel and AdBlue as separate lines under one receipt. Astrea
  // stores one receipt-level row so a later API transaction replaces it.
  function receipts(lineItems) {
    const grouped = new Map();
    lineItems.forEach((item) => {
      const key = AD.fuelIdentity.bpReferenceKey(item);
      if (!key) return;
      let t = grouped.get(key);
      if (!t) { t = { ...item, cost: 0, litres: 0, products: [], locations: [] }; grouped.set(key, t); }
      t.cost += item.cost;
      t.litres += item.litres;
      if (item.product && !t.products.includes(item.product)) t.products.push(item.product);
      if (item.location && !t.locations.includes(item.location)) t.locations.push(item.location);
    });
    return [...grouped.values()]
      .sort((a, b) => a.date.localeCompare(b.date) || a.cardNumber.localeCompare(b.cardNumber) || a.docket.localeCompare(b.docket))
      .map((t) => [t.rego, t.date, t.docket, t.cardNumber, t.locations.join(' / '), t.products.join(' + '), round2(t.litres), round2(t.cost), 'BP', t.holder || '']);
  }

  function parsePages(pages, vehicles) {
    if (isFleetControl(pages) && (pages || []).some((p) => p && p.cells)) return parseFleetControl(pages);
    const lineItems = [];
    const cards = new Set(), vehicleCards = new Set(), unassignedCards = new Set();
    let feeRows = 0, feeTotal = 0, unreadableRows = 0;

    (pages || []).forEach((page) => {
      const lines = Array.isArray(page) ? page : String(page || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const cardNumber = cardFrom(lines);
      const rego = regoFrom(lines, vehicles);
      if (cardNumber) cards.add(cardNumber);
      if (cardNumber && rego) vehicleCards.add(cardNumber);
      if (cardNumber && !rego) unassignedCards.add(cardNumber);

      lines.forEach((line) => {
        if (/^Card Fees\b/i.test(line)) {
          const values = line.match(/-?[0-9][0-9,]*\.\d{2}/g) || [];
          feeRows++;
          if (values.length) feeTotal += number(values[values.length - 1]);
          return;
        }
        if (!/^\d{2}\/\d{2}\/\d{2}\s+/.test(line)) return;
        const transaction = parseTransactionLine(line);
        if (!transaction || !rego || !cardNumber) { unreadableRows++; return; }
        lineItems.push({ ...transaction, rego, cardNumber });
      });
    });

    unreadableRows += lineItems.filter((item) => !AD.fuelIdentity.bpReferenceKey(item)).length;
    const rows = receipts(lineItems);
    return {
      headers: HEADERS.slice(), rows,
      meta: {
        pages: (pages || []).length,
        cards: cards.size,
        vehicleCards: vehicleCards.size,
        unassignedCards: unassignedCards.size,
        lineItems: lineItems.length,
        transactions: rows.length,
        feeRows,
        feeTotal: round2(feeTotal),
        unreadableRows
      }
    };
  }

  async function read(file, pdfjs, vehicles) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const document = await pdfjs.getDocument({ data: bytes }).promise;
    const pages = [];
    for (let pageNo = 1; pageNo <= document.numPages; pageNo++) {
      const page = await document.getPage(pageNo);
      const content = await page.getTextContent();
      const lines = itemsToLines(content.items);
      lines.cells = cellsOf(content.items, page.getViewport({ scale: 1 }));
      pages.push(lines);
    }
    return parsePages(pages, vehicles);
  }

  return { HEADERS, itemsToLines, cellsOf, parseTransactionLine, parsePages, read };
})();
