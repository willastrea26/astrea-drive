/*
 * Linkt "Detailed Statement" PDFs -> toll charge lines, plus the shared
 * tag/plate -> vehicle matcher used by the importer and the Cost sheet.
 *
 * Built against a real Linkt tag-account statement. Each charge is one text
 * line in the "Daily charges" table:
 *
 *   trip (tag read):   29 Jun 2026 233208682226 CAR 06:45:56 06:49:45 WCX General Holmes Dr to Kingsgrove Rd $7.67
 *   trip (plate read): 29 Jun 2026 GDS30C NSW CAR 08:06:00 08:06:00 M7 Old Windsor Rd to M2 Motorway $0.89
 *   fee:               29 Jun 2026 GDS30C NSW CAR No Tag in Vehicle Fee $0.75
 *   adjustment:        05 Aug 2026 <account no> M8/M5E NSW Truck Multiplier Rebate - $15.62 cr
 *   payment (skipped): 10 Jul 2026 Payment - thank you $1,000.00 cr
 *
 * Trips + fees - credits reconcile to the cent with the statement's own
 * "Total charged for statement period", which the importer checks and shows.
 */
window.AD = window.AD || {};

AD.linkt = (function () {
  const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
  const pad = (n) => String(n).padStart(2, '0');
  const money = (s) => Number(String(s || '').replace(/[$,\s]/g, '')) || 0;
  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const dateKey = (d, m, y) => {
    const mo = MON[m]; if (!mo) return '';
    const yr = String(y).length === 2 ? '20' + y : String(y);
    return `${yr}-${pad(mo)}-${pad(d)}`;
  };

  const STATES = 'NSW|VIC|QLD|ACT|SA|WA|TAS|NT';
  const DATE = '(\\d{1,2}) ([A-Z][a-z]{2}) (\\d{4})';
  const AMT = '\\$([0-9][0-9,]*\\.\\d{2})( cr)?';
  const TIME = '(\\d{2}:\\d{2}:\\d{2})';
  const RE_TRIP = new RegExp(`^${DATE} (\\S+)(?: (${STATES}))? ([A-Z]+) ${TIME} ${TIME} (.+?) ${AMT}$`);
  const RE_FEE = new RegExp(`^${DATE} (\\S+)(?: (${STATES}))? ([A-Z]+) (.*?\\bFee\\b.*?) ${AMT}$`);
  const RE_PAYMENT = new RegExp(`^${DATE} Payment\\b.* ${AMT}$`);
  const RE_ANY = new RegExp(`^${DATE} (.+?) -? ?${AMT}$`);

  /** "M7 Old Windsor Rd to M2 Motorway" -> "Westlink M7". Unknown roads keep their own first words. */
  const ROADS = [
    [/^M2\b/, 'Hills M2'], [/^M7\b/, 'Westlink M7'], [/^WCX\b/, 'WestConnex'],
    [/^M8\b|^M8\/M5E/, 'M8 / M5 East'], [/^M5\b/, 'M5 South-West'], [/^M4\b/, 'M4'],
    [/^M1\b/, 'Eastern Distributor'], [/^Lane Cove Tunnel/, 'Lane Cove Tunnel'],
    [/^Sydney Harbour Tunnel/, 'Sydney Harbour Tunnel'], [/^Sydney Harbour Bridge/, 'Sydney Harbour Bridge'],
    [/^NorthConnex/, 'NorthConnex'], [/^CCT\b/, 'Cross City Tunnel'], [/^Legacy Way/, 'Legacy Way (QLD)'],
    [/^Go Between/, 'Go Between Bridge (QLD)'], [/^EL\b/, 'EastLink (VIC)'], [/^CL\b|^CityLink/, 'CityLink (VIC)'],
    [/^(Toombul|Bowen Hills|Murarrie|Kedron|Heathwood|Loganlea|Kuraby)\b/, 'Brisbane tolls (QLD)'], [/^T2\/T3/, 'T2/T3 lanes']
  ];
  function roadOf(details) {
    const d = String(details || '').trim();
    for (const [re, name] of ROADS) if (re.test(d)) return name;
    return d.split(/\s+/).slice(0, 2).join(' ');
  }

  /** Tag numbers print with or without leading zeros / spaces ("000 5640759"). */
  const tagKey = (s) => String(s || '').replace(/\D/g, '').replace(/^0+/, '');

  function isLinkt(pages) {
    const first = (pages[0] || []).join('\n');
    return /Total trip charges/i.test(first) && /Statement period/i.test(first);
  }

  function metaFrom(pages) {
    const text = (pages[0] || []).join('\n');
    const m = {};
    let x;
    if ((x = /Total trip charges \$([0-9,]+\.\d{2})/i.exec(text))) m.tripTotal = money(x[1]);
    if ((x = /Total fees and adjustments (-?)\$([0-9,]+\.\d{2})( cr)?/i.exec(text))) m.feeTotal = (x[1] || x[3] ? -1 : 1) * money(x[2]);
    if ((x = /Total charged for statement period (-?)\$([0-9,]+\.\d{2})/i.exec(text))) m.total = (x[1] ? -1 : 1) * money(x[2]);
    if ((x = /Total GST included \$([0-9,]+\.\d{2})/i.exec(text))) m.gst = money(x[1]);
    if ((x = /(\d{1,2}) ([A-Z][a-z]{2}) (\d{2}) - (\d{1,2}) ([A-Z][a-z]{2}) (\d{2})/.exec(text))) {
      m.periodStart = dateKey(x[1], x[2], x[3]);
      m.periodEnd = dateKey(x[4], x[5], x[6]);
    }
    // "<account no> <statement no>" — account number, then statement number.
    const nums = (pages[0] || []).map((l) => /^(\d{8,11}) (\d{10,14})$/.exec(l.trim())).find(Boolean);
    if (nums) { m.account = nums[1]; m.statement = nums[2]; }
    return m;
  }

  /** Text lines per page -> { rows, meta }. Rows are plain objects, not yet matched to vehicles. */
  function parse(pages) {
    const meta = metaFrom(pages);
    const rows = [];
    let payments = 0, paymentTotal = 0, unread = 0;
    const unreadSamples = [];
    pages.forEach((lines) => (lines || []).forEach((raw) => {
      const line = String(raw || '').trim();
      if (!/^\d{1,2} [A-Z][a-z]{2} \d{4} /.test(line)) return;      // not a charge line
      let x;
      if ((x = RE_PAYMENT.exec(line))) { payments++; paymentTotal += money(x[4]); return; }
      if ((x = RE_TRIP.exec(line))) {
        const [, d, mo, y, who, state, cls, start, finish, details, amt, cr] = x;
        rows.push(lineRow({ date: dateKey(d, mo, y), who, state, cls, start, finish, details, kind: 'trip', amount: (cr ? -1 : 1) * money(amt) }));
        return;
      }
      if ((x = RE_FEE.exec(line))) {
        const [, d, mo, y, who, state, cls, details, amt, cr] = x;
        rows.push(lineRow({ date: dateKey(d, mo, y), who, state, cls, details, kind: 'fee', amount: (cr ? -1 : 1) * money(amt) }));
        return;
      }
      if ((x = RE_ANY.exec(line))) {
        // Account-level adjustment, e.g. "<account no> M8/M5E NSW Truck Multiplier Rebate - $15.62 cr".
        const [, d, mo, y, rest, amt, cr] = x;
        const details = rest.replace(/^\d{8,11} /, '').trim();
        rows.push({ date: dateKey(d, mo, y), plate: '', state: '', tag: '', class: '', startTime: '', finishTime: '',
                    details, road: roadOf(details), kind: 'adjustment', amount: (cr ? -1 : 1) * money(amt) });
        return;
      }
      // A dated line with no amount is the page header ("11 Oct 2026 <account no>").
      if (/\$[0-9]/.test(line)) { unread++; if (unreadSamples.length < 5) unreadSamples.push(line); }
    }));

    function lineRow({ date, who, state, cls, start = '', finish = '', details, kind, amount }) {
      const isTag = !state && /^\d{6,}$/.test(who);
      return {
        date, plate: isTag ? '' : who, state: state || '', tag: isTag ? who : '', class: cls,
        startTime: start, finishTime: finish, details: details.trim(), road: kind === 'trip' ? roadOf(details) : '',
        kind, amount
      };
    }

    const sum = (k) => round2(rows.filter((r) => r.kind === k).reduce((t, r) => t + r.amount, 0));
    const totals = { trips: sum('trip'), fees: sum('fee'), adjustments: sum('adjustment') };
    totals.all = round2(totals.trips + totals.fees + totals.adjustments);
    return {
      rows,
      meta: Object.assign(meta, {
        pages: pages.length, payments, paymentTotal: round2(paymentTotal), unread, unreadSamples,
        counts: { trips: rows.filter((r) => r.kind === 'trip').length, fees: rows.filter((r) => r.kind === 'fee').length, adjustments: rows.filter((r) => r.kind === 'adjustment').length },
        totals,
        reconciles: meta.total != null ? Math.abs(totals.all - meta.total) < 0.005 : null
      })
    };
  }

  /** Stable ids: statement + line content + repeat number within the statement. */
  function withIds(rows, statementKey) {
    const seen = new Map();
    const hash = (str) => {
      let h = 0x811c9dc5;
      for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
      return (h >>> 0).toString(36);
    };
    return rows.map((r) => {
      const base = 'toll-' + hash([statementKey, r.date, r.plate, r.tag, r.startTime, r.finishTime, r.details, r.amount, r.kind].join('|'));
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      return Object.assign({ id: `${base}-${n}` }, r);
    });
  }

  /**
   * Who a toll line belongs to, from the CURRENT register: the plate (exact,
   * Netstar alias, or a look-alike O/0 typo, as with fuel) or the vehicle's
   * Linkt tag number(s). A tag recorded against two vehicles is ambiguous and
   * matches neither — it is reported instead of guessed.
   */
  function matcher(vehicles) {
    const tagOwners = new Map();
    (vehicles || []).forEach((v) => {
      String(v.linktTag || '').split(/[,;/]/).map(tagKey).filter(Boolean).forEach((k) => {
        if (!tagOwners.has(k)) tagOwners.set(k, []);
        if (!tagOwners.get(k).includes(v)) tagOwners.get(k).push(v);
      });
    });
    const maps = AD.importFuelData && AD.importFuelData._regoMaps ? AD.importFuelData._regoMaps() : { exact: new Map(), canon: new Map() };
    const norm = (r) => String(r || '').toUpperCase().replace(/\s+/g, '');
    const canon = (r) => norm(r).replace(/[OISBZGQ]/g, (c) => ({ O: '0', I: '1', S: '5', B: '8', Z: '2', G: '6', Q: '0' }[c]));
    return function match(row) {
      if (row.tag) {
        const owners = tagOwners.get(tagKey(row.tag)) || [];
        const owned = owners.filter((v) => !v.hired);
        const pick = owned.length === 1 ? owned[0] : (!owned.length && owners.length === 1 ? owners[0] : null);
        return { vehicle: pick, ambiguous: pick ? [] : owners.map((v) => v.id), key: 'tag:' + tagKey(row.tag) };
      }
      if (row.plate) {
        const v = maps.exact.get(norm(row.plate)) || maps.canon.get(canon(row.plate)) || null;
        return { vehicle: v, ambiguous: [], key: 'plate:' + norm(row.plate) };
      }
      return { vehicle: null, ambiguous: [], key: 'account' };
    };
  }

  async function readPages(file, pdfjs) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      pages.push(AD.bpPdf.itemsToLines(content.items));
    }
    return pages;
  }

  return { isLinkt, parse, withIds, matcher, readPages, roadOf, tagKey };
})();
