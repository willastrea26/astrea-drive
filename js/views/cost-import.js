/*
 * Fuel-cost import — manual stopgap before the WEX / BP API.
 *
 * Reads a fuel-card spreadsheet (.xlsx / .csv) or BP Plus PDF, then lets the
 * user confirm the rego and cost columns (auto-detected for the WEX export,
 * for any other layout), matches each row to a vehicle by rego, and saves the
 * transactions into fuel_entries. Re-importing the same file upserts on a
 * deterministic row id, so nothing double-counts.
 *
 * The spreadsheet reader (SheetJS) is loaded from a CDN only when the importer
 * is first opened, so it adds no weight to normal page loads.
 */
AD.importFuelData = (function () {
  const esc = AD.ui.esc;
  const fmtDate = (k) => k ? new Date(k + 'T12:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

  const XLSX_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  const PDFJS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = XLSX_SRC;
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => reject(new Error('Could not load the spreadsheet reader — check your internet connection.'));
      document.head.appendChild(s);
    });
  }
  function loadPDFJS() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PDFJS_SRC;
      s.onload = () => {
        if (!window.pdfjsLib) { reject(new Error('The PDF reader did not load.')); return; }
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        resolve(window.pdfjsLib);
      };
      s.onerror = () => reject(new Error('Could not load the PDF reader — check your internet connection.'));
      document.head.appendChild(s);
    });
  }

  // --- small parsers ---------------------------------------------------
  const toNum = (cell) => {
    const n = parseFloat(String(cell == null ? '' : cell).replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  // Fuel-card dates are Australian dd/mm/yyyy; also accept yyyy-mm-dd and Date.
  const toKey = (cell) => {
    if (cell instanceof Date && !isNaN(cell)) return cell.toISOString().slice(0, 10);
    const s = String(cell == null ? '' : cell).trim();
    let m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/.exec(s);
    if (m) { let [, d, mo, y] = m; if (y.length === 2) y = '20' + y; return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
    m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    return m ? m[0] : '';
  };
  const normRego = (r) => String(r || '').toUpperCase().replace(/\s+/g, '');
  // Characters that look alike on a plate — fold the letters to their digit
  // twin so a fuel-card typo like X053YD still matches XO53YD, or D144DT the
  // DI44DT on the register. Collision-guarded in regoMaps() so it never
  // matches when two real vehicles would collapse to the same form.
  const CONFUSABLE = { O: '0', I: '1', S: '5', B: '8', Z: '2', G: '6', Q: '0' };
  const canonRego = (r) => normRego(r).replace(/[OISBZGQ]/g, (c) => CONFUSABLE[c] || c);
  function hashId(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return 'fuel-' + (h >>> 0).toString(36) + '-' + (str.length.toString(36));
  }
  // exact: normalised rego -> vehicle. canon: look-alike-folded rego -> vehicle.
  // If a registration exists as both an owned and hired record, the owned
  // fleet vehicle is authoritative for company fuel cards. Other duplicate
  // combinations remain ambiguous and are not matched silently.
  function regoMaps() {
    const exactCandidates = new Map(), canonCandidates = new Map();
    const add = (map, key, vehicle) => {
      if (!map.has(key)) map.set(key, []);
      if (!map.get(key).some((candidate) => candidate.id === vehicle.id)) map.get(key).push(vehicle);
    };
    AD.store.all('vehicles').forEach((v) => {
      [v.rego, v.netstarRego].forEach((r) => {
        const k = normRego(r); if (!k) return;
        add(exactCandidates, k, v);
        add(canonCandidates, canonRego(r), v);
      });
    });
    const resolve = (candidateMap) => new Map([...candidateMap].map(([key, candidates]) => {
      const owned = candidates.filter((vehicle) => !vehicle.hired);
      if (owned.length === 1) return [key, owned[0]];
      if (!owned.length && candidates.length === 1) return [key, candidates[0]];
      return [key, null];
    }));
    const exact = resolve(exactCandidates), canon = resolve(canonCandidates);
    return { exact, canon };
  }

  // Auto-pick a column index whose header matches one of `pats`, else -1.
  function guess(headers, pats) {
    for (const p of pats) {
      const i = headers.findIndex((h) => p.test(String(h || '')));
      if (i >= 0) return i;
    }
    return -1;
  }

  // --- the modal -------------------------------------------------------
  function open(onDone) {
    let parsed = null; // { headers, rows }
    let fileName = '';

    const close = AD.ui.modal({
      title: 'Import cost data',
      wide: true,
      body: `<div id="fi-body">${dropStep()}</div>`,
      onMount: (el) => wireDrop(el.querySelector('#fi-body'))
    });

    function dropStep(err) {
      return `
        <p class="note">Drop a fuel-card export (<b>.xlsx</b>, <b>.csv</b> or a BP Plus Vehicle Analysis <b>.pdf</b>) or a <b>Linkt detailed statement</b> (<b>.pdf</b>) here. Fuel is matched to vehicles by registration; tolls by registration or Linkt tag number.</p>
        <label class="fi-drop" id="fi-drop">
          <input type="file" id="fi-file" accept=".xlsx,.xls,.csv,.pdf" hidden>
          <span class="fi-drop-ico">${AD.icons.file}</span>
          <span class="fi-drop-main">Drop a file here, or <b>browse</b></span>
          <span class="fi-drop-sub">Nothing is sent anywhere until you press Import.</span>
        </label>
        ${err ? `<p class="fi-err">${esc(err)}</p>` : ''}`;
    }

    function wireDrop(container) {
      const drop = container.querySelector('#fi-drop');
      const input = container.querySelector('#fi-file');
      if (!drop) return;
      input.addEventListener('change', () => input.files[0] && handleFile(input.files[0], container));
      ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
      drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) handleFile(f, container); });
    }

    async function handleFile(file, container) {
      fileName = file.name;
      container.innerHTML = `<p class="note">Reading <b>${esc(file.name)}</b>…</p>`;
      try {
        if (/\.pdf$/i.test(file.name)) {
          const pdfjs = await loadPDFJS();
          // Read the text once, then decide: a Linkt toll statement, or a BP fuel report.
          const pages = await AD.linkt.readPages(file, pdfjs);
          if (AD.linkt.isLinkt(pages)) { renderLinktStep(container, pages); return; }
          const result = AD.bpPdf.parsePages(pages, AD.store.all('vehicles'));
          if (!result.rows.length) throw new Error('No BP fuel transactions could be read from this PDF. Use the BP Plus Vehicle Analysis report or export the transactions to Excel.');
          parsed = { headers: result.headers, rows: result.rows, provider: 'BP', pdfMeta: result.meta };
          renderMapStep(container);
          return;
        }
        const XLSX = await loadXLSX();
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
        // Find the header row — the first row mentioning a registration column.
        let hi = aoa.findIndex((row) => row.some((c) => /regist|rego|plate/i.test(String(c || ''))));
        if (hi < 0) hi = 0;
        const headers = (aoa[hi] || []).map((h, i) => String(h || '').trim() || `Column ${i + 1}`);
        const rows = aoa.slice(hi + 1).filter((r) => r.some((c) => String(c || '').trim() !== ''));
        if (!rows.length) throw new Error('No data rows found under the header.');
        parsed = { headers, rows };
        renderMapStep(container);
      } catch (e) {
        container.innerHTML = dropStep((e && e.message) || 'Could not read that file.');
        wireDrop(container);
      }
    }

    /* ---- Linkt toll statement ------------------------------------------ */
    function renderLinktStep(container, pages) {
      const { rows: lines, meta } = AD.linkt.parse(pages);
      const aud = (n) => Number(n || 0).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
      if (!lines.length) {
        container.innerHTML = dropStep('This looks like a Linkt statement, but no charge lines could be read from it.');
        wireDrop(container);
        return;
      }
      const statementKey = meta.statement || [meta.periodStart, meta.periodEnd].filter(Boolean).join('_') || fileName;
      const match = AD.linkt.matcher(AD.store.all('vehicles'));
      const unmatched = new Map(), ambiguous = new Map(), vehicles = new Set();
      let matchedAmount = 0;
      const rows = AD.linkt.withIds(lines, statementKey).map((r) => {
        const m = match(r);
        if (m.vehicle) { vehicles.add(m.vehicle.id); matchedAmount += r.amount; }
        else if (r.kind !== 'adjustment') {
          const bucket = m.ambiguous.length ? ambiguous : unmatched;
          const label = r.tag ? `Tag ${r.tag}` : `Plate ${r.plate}`;
          const g = bucket.get(m.key) || { label, count: 0, amount: 0, owners: m.ambiguous };
          g.count++; g.amount += r.amount; bucket.set(m.key, g);
        }
        return {
          id: r.id, vehicleId: m.vehicle ? m.vehicle.id : null, date: r.date,
          plate: r.plate || null, state: r.state || null, tag: r.tag || null, class: r.class || null,
          startTime: r.startTime || null, finishTime: r.finishTime || null, details: r.details, road: r.road || null,
          kind: r.kind, amount: r.amount, statement: statementKey,
          periodStart: meta.periodStart || null, periodEnd: meta.periodEnd || null, source: `Linkt PDF · ${fileName}`
        };
      });
      const t = meta.totals, c = meta.counts;
      const groupList = (map) => [...map.values()].sort((a, b) => b.amount - a.amount);
      const um = groupList(unmatched), am = groupList(ambiguous);
      const umAmount = um.reduce((s, g) => s + g.amount, 0) + am.reduce((s, g) => s + g.amount, 0);
      const recon = meta.reconciles === true
        ? `<p class="fi-note-skip"><b>✓ Matches the statement:</b> ${aud(t.all)} read, against Linkt’s “Total charged for statement period” of ${aud(meta.total)}.</p>`
        : meta.reconciles === false
          ? `<p class="fi-warn">The lines read add to ${aud(t.all)}, but the statement says ${aud(meta.total)}. Some lines may not have been read — check before importing.</p>`
          : '';
      const list = (groups, extra) => groups.slice(0, 10).map((g) =>
        `<li><b>${esc(g.label)}</b> · ${g.count} line${g.count === 1 ? '' : 's'} · ${aud(g.amount)}${extra ? extra(g) : ''}</li>`).join('')
        + (groups.length > 10 ? `<li class="muted">+${groups.length - 10} more</li>` : '');

      container.innerHTML = `
        <p class="note">Linkt statement <b>${esc(meta.statement || '')}</b>${meta.periodStart ? ` for <b>${esc(fmtDate(meta.periodStart))}</b> to <b>${esc(fmtDate(meta.periodEnd))}</b>` : ''}, read from <b>${esc(fileName)}</b> (${meta.pages} pages).</p>
        <div class="fi-stats">
          <div class="fi-stat fi-stat-good"><b>${c.trips.toLocaleString('en-AU')}</b><span>toll trips · ${aud(t.trips)}</span></div>
          <div class="fi-stat"><b>${c.fees.toLocaleString('en-AU')}</b><span>No Tag fees · ${aud(t.fees)}</span></div>
          <div class="fi-stat fi-stat-mint"><b>${aud(t.all)}</b><span>total charged${c.adjustments ? ` (after ${aud(Math.abs(t.adjustments))} of credits)` : ''}</span></div>
          <div class="fi-stat"><b>${vehicles.size}</b><span>fleet vehicles matched</span></div>
        </div>
        ${recon}
        <p class="fi-note-skip muted">${meta.payments} payment${meta.payments === 1 ? '' : 's'} (${aud(meta.paymentTotal)}) are not costs and are left out.</p>
        ${um.length ? `<details class="fi-no-fuel"><summary>${um.length} tag${um.length === 1 ? '' : 's'} / plate${um.length === 1 ? '' : 's'} not linked to a fleet vehicle yet (${aud(umAmount)})</summary>
          <ul class="fi-list">${list(um)}</ul>
          <p class="muted">They’re still imported, so the total matches the statement. Link them from the Tolls section of the Cost sheet, or add the tag number to the vehicle in the Fleet register; past trips then move across automatically.</p></details>` : ''}
        ${am.length ? `<p class="fi-warn">${am.length} tag${am.length === 1 ? ' is' : 's are'} recorded against more than one vehicle, so ${am.length === 1 ? 'its' : 'their'} trips can’t be assigned: <span>${am.slice(0, 5).map((g) => `${esc(g.label)} (${esc(g.owners.join(', '))})`).join('; ')}</span>. Fix the tag in the Fleet register.</p>` : ''}
        <p class="fi-note-skip muted">Importing the same statement again is safe: it updates the existing lines instead of adding them twice.</p>
        <div class="fi-actions">
          <button class="btn btn-secondary" id="fi-back" type="button">Choose a different file</button>
          <button class="btn btn-primary" id="fi-import" type="button">Import ${rows.length.toLocaleString('en-AU')} toll lines</button>
        </div>`;
      container.querySelector('#fi-back').onclick = () => { container.innerHTML = dropStep(); wireDrop(container); };
      container.querySelector('#fi-import').onclick = async () => {
        const btn = container.querySelector('#fi-import');
        btn.disabled = true;
        try {
          await AD.store.importTolls(rows, (done, total) => { btn.textContent = `Importing… ${Math.round((done / total) * 100)}%`; });
          try { await AD.store.log(`Linkt statement ${meta.statement || statementKey} imported: ${rows.length.toLocaleString('en-AU')} toll lines, ${aud(t.all)}`); } catch (e) { /* log is best-effort */ }
          AD.ui.toast(`Imported ${rows.length.toLocaleString('en-AU')} toll lines (${aud(t.all)}).`, 'ok');
          close();
          if (onDone) onDone();
        } catch (e) {
          btn.disabled = false; btn.textContent = `Import ${rows.length.toLocaleString('en-AU')} toll lines`;
          const msg = (e && (e.message || e.details)) || 'Import failed.';
          const friendly = /toll_entries|could not find the table|does not exist/i.test(msg)
            ? 'The tolls table hasn’t been created yet: run create-toll-entries.sql in Supabase first, then try again.'
            : msg;
          container.querySelector('.fi-actions').insertAdjacentHTML('beforebegin', `<p class="fi-err">${esc(friendly)}</p>`);
        }
      };
    }

    function colSelect(id, label, required, defIdx) {
      const opts = [`<option value="-1">${required ? '— choose —' : '— none —'}</option>`]
        .concat(parsed.headers.map((h, i) => `<option value="${i}"${i === defIdx ? ' selected' : ''}>${esc(h)}</option>`));
      return `<label class="fi-map-field"><span>${esc(label)}${required ? ' *' : ''}</span>
        <select data-map="${id}">${opts.join('')}</select></label>`;
    }

    function renderMapStep(container) {
      const H = parsed.headers;
      const def = {
        rego: guess(H, [/regist/i, /rego/i, /plate/i]),
        cost: guess(H, [/total incl/i, /including gst/i, /amount/i, /^total$/i, /cost/i]),
        date: guess(H, [/^date$/i, /date/i]),
        litres: guess(H, [/lit/i, /qty/i, /quantity/i]),
        product: guess(H, [/product/i]),
        brand: guess(H, [/fuel brand/i, /brand/i]),
        docket: guess(H, [/receipt/i, /docket/i]),
        card: guess(H, [/card number/i, /^card$/i]),
        holder: guess(H, [/name on card/i, /card ?holder/i])
      };
      const pdfNote = parsed.pdfMeta
        ? `<p class="fi-note-skip">BP PDF: <b>${parsed.pdfMeta.transactions}</b> receipt-level transactions from ${parsed.pdfMeta.lineItems} product lines across ${parsed.pdfMeta.vehicleCards} vehicle cards. ${parsed.pdfMeta.feeRows} card fee rows (${Number(parsed.pdfMeta.feeTotal).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })}) were deliberately excluded.${parsed.pdfMeta.unreadableRows ? ` <b>${parsed.pdfMeta.unreadableRows}</b> dated row${parsed.pdfMeta.unreadableRows === 1 ? '' : 's'} could not be read.` : ''}</p>`
        : '';
      const isBpPdf = parsed.provider === 'BP';
      parsed.fixedMapping = isBpPdf ? def : null;
      const mapping = isBpPdf ? '' : `
        <div class="fi-map fi-map-main">
          ${colSelect('rego', 'Registration', true, def.rego)}
          ${colSelect('cost', 'Cost (incl. GST)', true, def.cost)}
        </div>
        <details class="fi-map-advanced">
          <summary>Advanced column options</summary>
          <div class="fi-map">
            ${colSelect('date', 'Date', false, def.date)}
            ${colSelect('litres', 'Litres', false, def.litres)}
            ${colSelect('product', 'Product', false, def.product)}
            ${colSelect('brand', 'Brand', false, def.brand)}
            ${colSelect('docket', 'Receipt / docket', false, def.docket)}
            ${colSelect('card', 'Card number', false, def.card)}
            ${colSelect('holder', 'Name on card', false, def.holder)}
          </div>
        </details>`;
      container.innerHTML = `
        <p class="note">${isBpPdf
          ? `Found <b>${parsed.rows.length}</b> BP transactions in <b>${esc(fileName)}</b>. Review the import summary below.`
          : `Found <b>${parsed.rows.length}</b> rows in <b>${esc(fileName)}</b>. Check the required columns below.`}</p>
        ${pdfNote}
        ${mapping}
        <div id="fi-preview"></div>
        <div class="fi-actions">
          <button class="btn btn-secondary" id="fi-back" type="button">Choose a different file</button>
          <button class="btn btn-primary" id="fi-import" type="button">Import</button>
        </div>`;
      const refresh = () => renderPreview(container);
      container.querySelectorAll('[data-map]').forEach((s) => s.addEventListener('change', refresh));
      container.querySelector('#fi-back').onclick = () => { container.innerHTML = dropStep(); wireDrop(container); };
      container.querySelector('#fi-import').onclick = () => doImport(container);
      refresh();
    }

    function readMapping(container) {
      if (parsed && parsed.fixedMapping) return { ...parsed.fixedMapping };
      const m = {};
      container.querySelectorAll('[data-map]').forEach((s) => { m[s.dataset.map] = Number(s.value); });
      return m;
    }

    // Turn the sheet + mapping into { importable rows, stats } — shared by
    // the preview and the actual import so what you see is what you save.
    function build(container) {
      const m = readMapping(container);
      const { exact, canon } = regoMaps();
      const rows = [], unmatched = new Set(), fuzzy = new Set(), cardFixes = new Set();
      let noValueRows = 0, noRegoRows = 0, noRegoAmount = 0, unmatchedRows = 0, unmatchedAmount = 0, cardRows = 0,
        fuzzyRows = 0, duplicateRows = 0, identityRows = 0, totalCost = 0, totalLitres = 0;

      // Card-number fallback. A WEX card normally belongs to one vehicle, so when
      // a row's rego is blank or not in the fleet (e.g. a stray "5"), the vehicle
      // the same card is recorded against on its OTHER rows in this file is used.
      // Only when that card points at exactly one fleet vehicle; never a guess.
      const cardKey = (c) => String(c == null ? '' : c).replace(/\D/g, '');
      const cardVehicles = new Map();
      if (m.card >= 0) {
        parsed.rows.forEach((r) => {
          const ck = cardKey(r[m.card]), rg = normRego(r[m.rego]);
          if (!ck || !rg) return;
          const cv = exact.get(rg) || canon.get(canonRego(rg));
          if (!cv) return;
          if (!cardVehicles.has(ck)) cardVehicles.set(ck, new Set());
          cardVehicles.get(ck).add(cv);
        });
      }
      const vehicleByCard = (r) => {
        const set = m.card >= 0 ? cardVehicles.get(cardKey(r[m.card])) : null;
        return set && set.size === 1 ? [...set][0] : null;
      };
      let minDate = '', maxDate = '';
      const vehicles = new Set();
      // Some rows are genuinely identical on every exported field — e.g. two
      // separate fill-ups the same vehicle made on the same day each trigger
      // their own $0.83 "TRANSACTION FEE" line, with nothing else to tell them
      // apart. A bare content hash would collapse those into one id, and
      // Postgres refuses to upsert the same id twice in one batch. So: the
      // first row with a given content hash keeps that id untouched; the 2nd,
      // 3rd... get a numbered suffix, so each stays its own saved row.
      const seenIds = new Map();
      parsed.rows.forEach((r) => {
        const rawRego = String(r[m.rego] || '').trim();
        const rego = normRego(rawRego);
        const cost = toNum(r[m.cost]) || 0;
        const litres = m.litres >= 0 ? toNum(r[m.litres]) : null;
        // Payments (negative) and $0 lines aren't spend.
        if (cost <= 0 && !(litres > 0)) { noValueRows++; return; }
        // Nor are the payment-side lines that come through POSITIVE: a "DD
        // DISHONOUR" re-charges a bounced direct debit (April 2026: +$14,525.01,
        // which would otherwise land as unassigned spend). The fees that come
        // with a dishonour ("DISHONOUR FEE", "SUSPENSION FEE") ARE real costs
        // and stay in.
        const productName = m.product >= 0 ? String(r[m.product] || '').trim() : '';
        if (/^(DIRECT DEBIT PMT|CREDIT CARD PMT|DD DISHONOUR)$|\bPAYMENT\b/i.test(productName)) { noValueRows++; return; }
        let v = rego ? exact.get(rego) : null;
        if (!v && rego) {
          const cv = canon.get(canonRego(rego)); // look-alike (O/0, I/1…) fallback, unambiguous only
          if (cv) { v = cv; fuzzyRows++; fuzzy.add(`${rawRego} → ${v.rego}`); }
        }
        let viaCard = false;
        if (!v) {
          const cv = vehicleByCard(r);
          if (cv) { v = cv; viaCard = true; cardRows++; cardFixes.add(`${rawRego || '(blank)'} → ${cv.rego} (card …${cardKey(r[m.card]).slice(-4)})`); }
        }
        // No fleet vehicle: still imported, as UNASSIGNED spend (no vehicle), so
        // totals match the card statement. Counted in total spend and Spend over
        // time; left out of anything worked out per vehicle. A row for a rego
        // not in the fleet keeps that rego in its id, so re-importing after the
        // vehicle is added to the register attaches it to the vehicle.
        if (!v) {
          if (!rego) { noRegoRows++; noRegoAmount += cost; }
          else { unmatched.add(rego); unmatchedRows++; unmatchedAmount += cost; }
        }
        const date = m.date >= 0 ? toKey(r[m.date]) : '';
        const product = m.product >= 0 ? String(r[m.product] || '').trim() : '';
        const brand = m.brand >= 0 ? String(r[m.brand] || '').trim() : '';
        const docket = m.docket >= 0 ? String(r[m.docket] || '').trim() : '';
        const card = m.card >= 0 ? String(r[m.card] || '').trim() : '';
        let id = '';
        if (parsed.provider === 'BP') {
          id = AD.fuelIdentity.bpId({ cardNumber: card, date, docket });
          if (!id) { identityRows++; return; }
          if (seenIds.has(id)) { duplicateRows++; return; }
          seenIds.set(id, 1);
        } else {
          // Preserve the established WEX identity so re-importing a file that
          // was loaded before PDF support still updates, rather than duplicates.
          // A card-matched row is keyed on the vehicle's real rego, so it keeps the
          // same id if WEX later corrects the rego on the card.
          // A person card (no rego) is keyed on its card number instead.
          const who = viaCard ? normRego(v.rego) : rego || ('CARD' + cardKey(card));
          const baseId = hashId([who, date, cost, litres || '', product].join('|'));
          const n = (seenIds.get(baseId) || 0) + 1;
          seenIds.set(baseId, n);
          id = n === 1 ? baseId : `${baseId}-${n}`;
        }
        const source = parsed.provider === 'BP' ? `BP PDF · ${fileName}` : fileName;
        const row = { id, vehicleId: v ? v.id : null, rego: viaCard ? v.rego : rawRego, date: date || null, litres: litres != null ? litres : null, cost, product, brand: brand || parsed.provider || '', docket, source };
        if (!v) row.cardHolder = m.holder >= 0 ? String(r[m.holder] || '').trim() : '';
        rows.push(row);
        totalCost += cost; totalLitres += litres || 0;
        if (v) vehicles.add(v.id);
        if (date) { if (!minDate || date < minDate) minDate = date; if (!maxDate || date > maxDate) maxDate = date; }
      });
      // Every active, owned vehicle that never appears in this file at all —
      // not just the ones it couldn't match, but ones it never even tried.
      const seenVehicles = vehicles;
      const noFuel = AD.store.all('vehicles')
        .filter((x) => !x.hired && !seenVehicles.has(x.id))
        .map((x) => x.id).sort();
      return { rows, stats: { unmatched: [...unmatched], unmatchedRows, unmatchedAmount, noValueRows, noRegoRows, noRegoAmount, cardRows, cardFixes: [...cardFixes], duplicateRows, identityRows, fuzzy: [...fuzzy], fuzzyRows, totalCost, totalLitres, vehicles: vehicles.size, totalRows: parsed.rows.length, minDate, maxDate, noFuel } };
    }

    function renderPreview(container) {
      const box = container.querySelector('#fi-preview');
      const btn = container.querySelector('#fi-import');
      const m = readMapping(container);
      if (!(m.rego >= 0) || !(m.cost >= 0)) {
        box.innerHTML = `<p class="fi-warn">Pick the registration and cost columns to continue.</p>`;
        btn.disabled = true;
        return;
      }
      const { rows, stats } = build(container);
      btn.disabled = rows.length === 0;
      const aud = (n) => n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
      const aud2 = (n) => n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
      const s = (n) => (n === 1 ? '' : 's');
      box.innerHTML = `
        <div class="fi-stats">
          <div class="fi-stat fi-stat-good"><b>${rows.length}</b><span>transactions to import</span></div>
          <div class="fi-stat fi-stat-mint"><b>${aud(stats.totalCost)}</b><span>total spend</span></div>
          <div class="fi-stat"><b>${stats.vehicles}</b><span>vehicles matched</span></div>
          <div class="fi-stat fi-stat-muted"><b>${stats.noValueRows + stats.duplicateRows + stats.identityRows}</b><span>rows skipped</span></div>
        </div>
        ${stats.cardRows ? `<p class="fi-note-skip">${stats.cardRows} row${s(stats.cardRows)} matched by card number, where the rego was blank or wrong: <span class="muted">${esc(stats.cardFixes.slice(0, 8).join(', '))}${stats.cardFixes.length > 8 ? ` +${stats.cardFixes.length - 8} more` : ''}</span></p>` : ''}
        ${stats.minDate ? `<p class="fi-note-skip">Covers <b>${esc(fmtDate(stats.minDate))}</b> to <b>${esc(fmtDate(stats.maxDate))}</b>.</p>` : ''}
        ${stats.fuzzyRows ? `<p class="fi-note-skip">${stats.fuzzyRows} row${stats.fuzzyRows === 1 ? '' : 's'} matched past a look-alike typo (O/0, I/1): <span class="muted">${esc(stats.fuzzy.slice(0, 8).join(', '))}${stats.fuzzy.length > 8 ? ` +${stats.fuzzy.length - 8} more` : ''}</span></p>` : ''}
        ${stats.noRegoRows || stats.unmatchedRows ? `<p class="fi-note-skip"><b>${aud2(stats.noRegoAmount + stats.unmatchedAmount)}</b> imported as <b>unassigned</b> (not tied to a vehicle): counted in total spend and Spend over time, but not in any vehicle’s figures.</p>
          <ul class="fi-list">
            ${stats.noRegoRows ? `<li>${stats.noRegoRows} row${s(stats.noRegoRows)} (${aud2(stats.noRegoAmount)}) on cards with no registration, usually cards issued to a person</li>` : ''}
            ${stats.unmatchedRows ? `<li>${stats.unmatchedRows} row${s(stats.unmatchedRows)} (${aud2(stats.unmatchedAmount)}) for rego${s(stats.unmatched.length)} not in the fleet: <span class="muted">${esc(stats.unmatched.slice(0, 12).join(', '))}${stats.unmatched.length > 12 ? ` +${stats.unmatched.length - 12} more` : ''}</span></li>` : ''}
          </ul>` : ''}
        ${stats.noValueRows ? `<p class="fi-note-skip muted">${stats.noValueRows} payment${s(stats.noValueRows)}, dishonoured payment${s(stats.noValueRows)} or $0 line${s(stats.noValueRows)} skipped (not spend).</p>` : ''}
        ${stats.duplicateRows ? `<p class="fi-note-skip muted">${stats.duplicateRows} repeated BP receipt${stats.duplicateRows === 1 ? '' : 's'} collapsed so it can’t be counted twice.</p>` : ''}
        ${stats.identityRows ? `<p class="fi-warn">${stats.identityRows} BP transaction${stats.identityRows === 1 ? '' : 's'} had no usable card/date/receipt identity and were skipped.</p>` : ''}
        ${stats.noFuel.length ? `<details class="fi-no-fuel"><summary>${stats.noFuel.length} fleet vehicle${stats.noFuel.length === 1 ? '' : 's'} with no fuel in this file</summary><p class="muted">${esc(stats.noFuel.join(', '))}</p></details>` : ''}
        ${rows.length ? `<p class="fi-note-skip muted">Re-importing the same file is safe — it updates existing rows instead of adding duplicates.${parsed.provider === 'BP' ? ' These receipt IDs are also reserved for the future BP API, so historical PDF rows will be updated rather than added again.' : ''}</p>` : '<p class="fi-warn">Nothing to import with these columns — check the mapping above.</p>'}`;
    }

    async function doImport(container, vehiclesOnly) {
      const built = build(container);
      const stats = built.stats;
      // Fallback for a database without update-fuel-unassigned.sql: matched rows only.
      const rows = vehiclesOnly
        ? built.rows.filter((r) => r.vehicleId).map((r) => { const c = { ...r }; delete c.cardHolder; return c; })
        : built.rows;
      if (!rows.length) return;
      const btn = container.querySelector('#fi-import');
      btn.disabled = true; btn.textContent = 'Importing…';
      try {
        await AD.store.importFuel(rows);
        const unassigned = rows.filter((r) => !r.vehicleId).length;
        AD.ui.toast(`Imported ${rows.length} fuel transaction${rows.length === 1 ? '' : 's'} across ${stats.vehicles} vehicle${stats.vehicles === 1 ? '' : 's'}${unassigned ? ` (${unassigned} unassigned)` : ''}.`, 'ok');
        close();
        if (onDone) onDone();
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Import';
        const box = container.querySelector('#fi-preview');
        const msg = (e && (e.message || e.details)) || 'Import failed.';
        if (!vehiclesOnly && /vehicleId|cardHolder|not-null|23502|PGRST204/i.test(msg + ' ' + (e && e.code))) {
          box.insertAdjacentHTML('afterbegin', `<div class="fi-err">Unassigned fuel can’t be saved yet: run <b>update-fuel-unassigned.sql</b> in Supabase, then import again.
            <p style="margin:8px 0 0"><button class="btn btn-secondary btn-sm" type="button" id="fi-vehicles-only">Import just the vehicle transactions for now</button></p></div>`);
          box.querySelector('#fi-vehicles-only').onclick = () => doImport(container, true);
          return;
        }
        const friendly = /relation .*fuel_entries.* does not exist|could not find the table/i.test(msg)
          ? 'The fuel table hasn’t been created yet — run create-fuel-entries.sql in Supabase first.'
          : /ON CONFLICT DO UPDATE command cannot affect row a second time/i.test(msg)
          ? 'Two rows in this file matched to the same saved record — please try again (if it keeps happening, tell your developer).'
          : msg;
        box.innerHTML = `<p class="fi-err">${esc(friendly)}</p>` + box.innerHTML;
      }
    }
  }

  open._regoMaps = regoMaps;
  return open;
})();
