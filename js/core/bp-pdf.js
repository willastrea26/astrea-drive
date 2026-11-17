/* Read BP Plus Vehicle Analysis PDFs into receipt-level fuel transactions. */
window.AD = window.AD || {};

AD.bpPdf = (function () {
  const HEADERS = [
    'Registration Number', 'Date', 'Receipt Number', 'Card Number', 'Location',
    'Product Name', 'Quantity (Litres)', 'Total Including GST', 'Fuel brand'
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

  function parsePages(pages, vehicles) {
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

    // BP prints diesel and AdBlue as separate lines under one receipt. Astrea
    // stores one receipt-level row so a later API transaction replaces it.
    const grouped = new Map();
    lineItems.forEach((item) => {
      const key = AD.fuelIdentity.bpReferenceKey(item);
      if (!key) { unreadableRows++; return; }
      let transaction = grouped.get(key);
      if (!transaction) {
        transaction = { ...item, products: [], locations: [] };
        grouped.set(key, transaction);
      }
      if (!transaction.products.includes(item.product)) transaction.products.push(item.product);
      if (!transaction.locations.includes(item.location)) transaction.locations.push(item.location);
    });

    // The first item was copied into each group before the accumulator ran.
    grouped.forEach((transaction) => {
      const matching = lineItems.filter((item) => AD.fuelIdentity.bpReferenceKey(item) === AD.fuelIdentity.bpReferenceKey(transaction));
      transaction.cost = round2(matching.reduce((sum, item) => sum + item.cost, 0));
      transaction.litres = round2(matching.reduce((sum, item) => sum + item.litres, 0));
    });

    const transactions = [...grouped.values()].sort((a, b) => a.date.localeCompare(b.date) || a.cardNumber.localeCompare(b.cardNumber) || a.docket.localeCompare(b.docket));
    const rows = transactions.map((item) => [
      item.rego, item.date, item.docket, item.cardNumber, item.locations.join(' / '),
      item.products.join(' + '), item.litres, item.cost, 'BP'
    ]);
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
      pages.push(itemsToLines(content.items));
    }
    return parsePages(pages, vehicles);
  }

  return { HEADERS, itemsToLines, parseTransactionLine, parsePages, read };
})();
