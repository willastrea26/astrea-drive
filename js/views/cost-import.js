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
  // Either map becomes null where two fleet records share the same form; fuel
  // must never be silently assigned to whichever duplicate happened to load last.
  function regoMaps() {
    const exact = new Map(), canon = new Map();
    AD.store.all('vehicles').forEach((v) => {
      [v.rego, v.netstarRego].forEach((r) => {
        const k = normRego(r); if (!k) return;
        exact.set(k, exact.has(k) && exact.get(k) !== v ? null : v);
        const c = canonRego(r);
        canon.set(c, canon.has(c) && canon.get(c) !== v ? null : v);
      });
    });
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
      title: 'Import fuel-card data',
      wide: true,
      body: `<div id="fi-body">${dropStep()}</div>`,
      onMount: (el) => wireDrop(el.querySelector('#fi-body'))
    });

    function dropStep(err) {
      return `
        <p class="note">Drop your fuel-card export here — <b>.xlsx</b>, <b>.csv</b>, or a BP Plus Vehicle Analysis <b>.pdf</b>. Each transaction is matched to a vehicle by its registration; rows for regos not in the fleet are skipped.</p>
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
          const result = await AD.bpPdf.read(file, pdfjs, AD.store.all('vehicles'));
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
        card: guess(H, [/card number/i, /^card$/i])
      };
      const pdfNote = parsed.pdfMeta
        ? `<p class="fi-note-skip">BP PDF: <b>${parsed.pdfMeta.transactions}</b> receipt-level transactions from ${parsed.pdfMeta.lineItems} product lines across ${parsed.pdfMeta.vehicleCards} vehicle cards. ${parsed.pdfMeta.feeRows} card fee rows (${Number(parsed.pdfMeta.feeTotal).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })}) were deliberately excluded.${parsed.pdfMeta.unreadableRows ? ` <b>${parsed.pdfMeta.unreadableRows}</b> dated row${parsed.pdfMeta.unreadableRows === 1 ? '' : 's'} could not be read.` : ''}</p>`
        : '';
      container.innerHTML = `
        <p class="note">Found <b>${parsed.rows.length}</b> rows in <b>${esc(fileName)}</b>. Check the columns below — the <b>registration</b> and <b>cost</b> are required.</p>
        ${pdfNote}
        <div class="fi-map">
          ${colSelect('rego', 'Registration', true, def.rego)}
          ${colSelect('cost', 'Cost (incl. GST)', true, def.cost)}
          ${colSelect('date', 'Date', false, def.date)}
          ${colSelect('litres', 'Litres', false, def.litres)}
          ${colSelect('product', 'Product', false, def.product)}
          ${colSelect('brand', 'Brand', false, def.brand)}
          ${colSelect('docket', 'Receipt / docket', false, def.docket)}
          ${colSelect('card', 'Card number', false, def.card)}
        </div>
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
      const m = {};
      container.querySelectorAll('[data-map]').forEach((s) => { m[s.dataset.map] = Number(s.value); });
      return m;
    }

    // Turn the sheet + mapping into { importable rows, stats } — shared by
    // the preview and the actual import so what you see is what you save.
    function build(container) {
      const m = readMapping(container);
      const { exact, canon } = regoMaps();
      const rows = [], unmatched = new Set(), fuzzy = new Set();
      let blankRows = 0, unmatchedRows = 0, fuzzyRows = 0, duplicateRows = 0, identityRows = 0, totalCost = 0, totalLitres = 0;
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
        const rego = normRego(r[m.rego]);
        const cost = toNum(r[m.cost]) || 0;
        const litres = m.litres >= 0 ? toNum(r[m.litres]) : null;
        if (!rego || (cost <= 0 && !(litres > 0))) { blankRows++; return; }
        let v = exact.get(rego);
        if (!v) {
          const cv = canon.get(canonRego(rego)); // look-alike (O/0, I/1…) fallback, unambiguous only
          if (cv) { v = cv; fuzzyRows++; fuzzy.add(`${String(r[m.rego] || '').trim()} → ${v.rego}`); }
        }
        if (!v) { unmatched.add(rego); unmatchedRows++; return; }
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
          const baseId = hashId([rego, date, cost, litres || '', product].join('|'));
          const n = (seenIds.get(baseId) || 0) + 1;
          seenIds.set(baseId, n);
          id = n === 1 ? baseId : `${baseId}-${n}`;
        }
        const source = parsed.provider === 'BP' ? `BP PDF · ${fileName}` : fileName;
        rows.push({ id, vehicleId: v.id, rego: String(r[m.rego] || '').trim(), date: date || null, litres: litres != null ? litres : null, cost, product, brand: brand || parsed.provider || '', docket, source });
        totalCost += cost; totalLitres += litres || 0; vehicles.add(v.id);
        if (date) { if (!minDate || date < minDate) minDate = date; if (!maxDate || date > maxDate) maxDate = date; }
      });
      // Every active, owned vehicle that never appears in this file at all —
      // not just the ones it couldn't match, but ones it never even tried.
      const seenVehicles = vehicles;
      const noFuel = AD.store.all('vehicles')
        .filter((x) => !x.hired && !seenVehicles.has(x.id))
        .map((x) => x.id).sort();
      return { rows, stats: { unmatched: [...unmatched], unmatchedRows, blankRows, duplicateRows, identityRows, fuzzy: [...fuzzy], fuzzyRows, totalCost, totalLitres, vehicles: vehicles.size, totalRows: parsed.rows.length, minDate, maxDate, noFuel } };
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
      box.innerHTML = `
        <div class="fi-stats">
          <div class="fi-stat fi-stat-good"><b>${rows.length}</b><span>transactions to import</span></div>
          <div class="fi-stat fi-stat-mint"><b>${aud(stats.totalCost)}</b><span>total spend</span></div>
          <div class="fi-stat"><b>${stats.vehicles}</b><span>vehicles matched</span></div>
          <div class="fi-stat fi-stat-muted"><b>${stats.unmatchedRows + stats.blankRows + stats.duplicateRows + stats.identityRows}</b><span>rows skipped</span></div>
        </div>
        ${stats.minDate ? `<p class="fi-note-skip">Covers <b>${esc(fmtDate(stats.minDate))}</b> to <b>${esc(fmtDate(stats.maxDate))}</b>.</p>` : ''}
        ${stats.fuzzyRows ? `<p class="fi-note-skip">${stats.fuzzyRows} row${stats.fuzzyRows === 1 ? '' : 's'} matched past a look-alike typo (O/0, I/1): <span class="muted">${esc(stats.fuzzy.slice(0, 8).join(', '))}${stats.fuzzy.length > 8 ? ` +${stats.fuzzy.length - 8} more` : ''}</span></p>` : ''}
        ${stats.unmatchedRows ? `<p class="fi-note-skip">${stats.unmatchedRows} row${stats.unmatchedRows === 1 ? '' : 's'} for ${stats.unmatched.length} rego${stats.unmatched.length === 1 ? '' : 's'} not in the fleet: <span class="muted">${esc(stats.unmatched.slice(0, 12).join(', '))}${stats.unmatched.length > 12 ? ` +${stats.unmatched.length - 12} more` : ''}</span></p>` : ''}
        ${stats.blankRows ? `<p class="fi-note-skip muted">${stats.blankRows} row${stats.blankRows === 1 ? '' : 's'} with no fuel or cost (e.g. $0 lines) skipped.</p>` : ''}
        ${stats.duplicateRows ? `<p class="fi-note-skip muted">${stats.duplicateRows} repeated BP receipt${stats.duplicateRows === 1 ? '' : 's'} collapsed so it can’t be counted twice.</p>` : ''}
        ${stats.identityRows ? `<p class="fi-warn">${stats.identityRows} BP transaction${stats.identityRows === 1 ? '' : 's'} had no usable card/date/receipt identity and were skipped.</p>` : ''}
        ${stats.noFuel.length ? `<details class="fi-no-fuel"><summary>${stats.noFuel.length} fleet vehicle${stats.noFuel.length === 1 ? '' : 's'} with no fuel in this file</summary><p class="muted">${esc(stats.noFuel.join(', '))}</p></details>` : ''}
        ${rows.length ? `<p class="fi-note-skip muted">Re-importing the same file is safe — it updates existing rows instead of adding duplicates.${parsed.provider === 'BP' ? ' These receipt IDs are also reserved for the future BP API, so historical PDF rows will be updated rather than added again.' : ''}</p>` : '<p class="fi-warn">Nothing to import with these columns — check the mapping above.</p>'}`;
    }

    async function doImport(container) {
      const { rows, stats } = build(container);
      if (!rows.length) return;
      const btn = container.querySelector('#fi-import');
      btn.disabled = true; btn.textContent = 'Importing…';
      try {
        await AD.store.importFuel(rows);
        AD.ui.toast(`Imported ${rows.length} fuel transaction${rows.length === 1 ? '' : 's'} across ${stats.vehicles} vehicle${stats.vehicles === 1 ? '' : 's'}.`, 'ok');
        close();
        if (onDone) onDone();
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Import';
        const box = container.querySelector('#fi-preview');
        const msg = (e && (e.message || e.details)) || 'Import failed.';
        const friendly = /relation .*fuel_entries.* does not exist|could not find the table/i.test(msg)
          ? 'The fuel table hasn’t been created yet — run create-fuel-entries.sql in Supabase first.'
          : /ON CONFLICT DO UPDATE command cannot affect row a second time/i.test(msg)
          ? 'Two rows in this file matched to the same saved record — please try again (if it keeps happening, tell your developer).'
          : msg;
        box.innerHTML = `<p class="fi-err">${esc(friendly)}</p>` + box.innerHTML;
      }
    }
  }

  return open;
})();
