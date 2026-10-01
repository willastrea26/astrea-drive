/* Bulk-import documents for the Hired fleet from a local folder tree.
 *
 * The user picks the top folder once (webkitdirectory). For each file,
 * we walk its relative path for a token that matches a hired vehicle's
 * rego / fleet ID; the file is then uploaded to that vehicle's documents
 * with a category inferred from the filename.
 */
window.AD = window.AD || {};

(function () {
  const { esc, modal, toast } = AD.ui;

  // Filename → category rules. First hit wins; order matters.
  const CATEGORY_RULES = [
    { re: /\b(rego|registration|rego exp|rego-|rego\.|certificate of registration)\b/i, cat: 'Registration' },
    { re: /\bgreenslip\b/i, cat: 'Insurance' },
    { re: /\binsurance|cover note|policy\b/i, cat: 'Insurance' },
    { re: /\bservice|repairs?\b|service history|service report|service record/i, cat: 'Service history' },
    { re: /\b(risk assessment|risk assess|r\.?a\.?|hazard|pre-acceptance|checklist|voc|white card|licence|license|mobile plant introduction|sop)\b/i, cat: 'Compliance' },
    { re: /\b(manual|load chart|spec sheet|noise level|owner|operation|maintenance manual|user)\b/i, cat: 'Manual' },
    { re: /\b(photo|front license|back license|back 24|front 24|\.heic$|\.jpe?g$|\.png$)\b/i, cat: 'Other' }
  ];

  function categoryFor(filename) {
    for (const r of CATEGORY_RULES) if (r.re.test(filename)) return r.cat;
    return 'Other';
  }

  /** A pretty name from the filename, trimming the leading rego and extension. */
  function cleanName(filename) {
    const stem = filename.replace(/\.[^.]+$/, '').trim();
    return stem.replace(/^(h-)?[A-Z0-9]{5,8}\s*[-_]?\s*/i, '').trim() || stem;
  }

  /** Walk the file's path for the hired vehicle it belongs to.
   *  Matches on fleet ID (incl. optional H- prefix) or raw rego.
   *  Picks the longest match so Q001/XP24BN style folders beat H-X plain regos. */
  function matchVehicle(file, hired) {
    const parts = (file.webkitRelativePath || file.name).split(/[\\/]/);
    let best = null;
    for (const v of hired) {
      const needles = [v.rego, v.id, v.id.replace(/^H-/, '')].filter(Boolean).map((s) => s.toUpperCase());
      for (const part of parts) {
        const up = part.toUpperCase();
        for (const n of needles) {
          if (up.includes(n) && (!best || n.length > best.len)) best = { v, len: n.length };
        }
      }
    }
    return best && best.v;
  }

  AD.importHiredDocs = function () {
    const hired = AD.store.all('vehicles').filter((v) => v.hired);
    if (!hired.length) { toast('No hired vehicles to import to. Add some first.', 'warn'); return; }

    let step = 'pick';            // 'pick' → 'review' → 'upload' → 'done'
    let plan = [];                // [{file, vehicle, name, category}]
    let unmatched = [];           // files we couldn't match
    let progress = { done: 0, failed: 0, total: 0 };

    const close = modal({
      wide: true,
      title: 'Import documents from folder',
      body: body(),
      onMount(el, closeFn) {
        wire(el, closeFn);
      }
    });

    function body() {
      if (step === 'pick') {
        return `
          <p class="modal-lede">Pick the <b>J.03 - Hired Plant</b> folder (or any folder underneath). Every file inside is uploaded to the hired vehicle whose rego or ID appears in its path.</p>
          <p class="help">Nothing is uploaded until you confirm on the next step.</p>
          <div class="form-actions">
            <button class="btn btn-ghost" data-close type="button">Cancel</button>
            <button class="btn btn-primary" data-pick type="button">${AD.icons.file} Pick folder</button>
            <input type="file" id="imp-input" webkitdirectory directory multiple hidden>
          </div>`;
      }
      if (step === 'review') {
        const byVehicle = new Map();
        plan.forEach((p) => {
          if (!byVehicle.has(p.vehicle.id)) byVehicle.set(p.vehicle.id, []);
          byVehicle.get(p.vehicle.id).push(p);
        });
        const rows = [...byVehicle.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([vid, items]) => {
          const v = items[0].vehicle;
          return `<tr class="imp-vhead"><td colspan="4"><b>${esc(v.id)}</b> · ${esc(v.rego)} <span class="muted">${esc(v.hireCompany || '')}</span> <span class="muted">— ${items.length} file${items.length === 1 ? '' : 's'}</span></td></tr>` +
            items.map((p) => `<tr><td></td><td>${esc(p.file.name)}</td><td>${esc(p.category)}</td><td class="num muted">${AD.fmtBytes(p.file.size)}</td></tr>`).join('');
        }).join('');
        return `
          <p class="modal-lede"><b>${plan.length}</b> file${plan.length === 1 ? '' : 's'} ready across <b>${byVehicle.size}</b> vehicle${byVehicle.size === 1 ? '' : 's'}.${unmatched.length ? ` <span class="muted">${unmatched.length} skipped — no matching vehicle in the path.</span>` : ''}</p>
          <div class="table-wrap" style="max-height:52vh;overflow:auto">
            <table class="data imp-table"><thead><tr><th style="width:40px"></th><th>File</th><th>Category</th><th class="num">Size</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="4" class="empty">Nothing matched.</td></tr>'}</tbody></table>
          </div>
          ${unmatched.length ? `<details style="margin-top:12px"><summary class="muted">${unmatched.length} skipped file${unmatched.length === 1 ? '' : 's'}</summary><ul class="muted" style="font-size:13px;margin:6px 0 0 16px">${unmatched.slice(0, 50).map((f) => `<li>${esc(f.webkitRelativePath || f.name)}</li>`).join('')}${unmatched.length > 50 ? '<li>…and ' + (unmatched.length - 50) + ' more</li>' : ''}</ul></details>` : ''}
          <div class="form-actions">
            <button class="btn btn-ghost" data-close type="button">Cancel</button>
            <button class="btn btn-primary" data-upload type="button" ${plan.length ? '' : 'disabled'}>Upload ${plan.length} file${plan.length === 1 ? '' : 's'}</button>
          </div>`;
      }
      if (step === 'upload') {
        const pct = progress.total ? Math.round((progress.done + progress.failed) / progress.total * 100) : 0;
        return `
          <p class="modal-lede">Uploading… ${progress.done + progress.failed} / ${progress.total}${progress.failed ? ` <span class="flag flag-red">${progress.failed} failed</span>` : ''}</p>
          <div class="imp-progress"><div class="imp-progress-fill" style="width:${pct}%"></div></div>
          <p class="help" id="imp-current" style="margin-top:12px"></p>`;
      }
      return `
        <p class="modal-lede"><b>${progress.done}</b> file${progress.done === 1 ? '' : 's'} uploaded${progress.failed ? ` · <span class="flag flag-red">${progress.failed} failed</span>` : ''}.</p>
        ${progress.failed ? '<p class="help">Failures are usually network blips — try the import again and existing files are kept.</p>' : ''}
        <div class="form-actions"><button class="btn btn-primary" data-close type="button">Done</button></div>`;
    }

    function wire(el, closeFn) {
      el.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => closeFn());
      const pickBtn = el.querySelector('[data-pick]');
      const input = el.querySelector('#imp-input');
      if (pickBtn && input) {
        pickBtn.onclick = () => input.click();
        input.onchange = () => {
          const files = Array.from(input.files || []).filter((f) => !/^\./.test(f.name) && !/\.(zip|dotx|lnk|ini|ds_store)$/i.test(f.name));
          plan = [];
          unmatched = [];
          files.forEach((f) => {
            const v = matchVehicle(f, hired);
            if (!v) { unmatched.push(f); return; }
            plan.push({ file: f, vehicle: v, name: cleanName(f.name), category: categoryFor(f.name) });
          });
          step = 'review';
          redraw(el, closeFn);
        };
      }
      const upBtn = el.querySelector('[data-upload]');
      if (upBtn) upBtn.onclick = () => startUpload(el, closeFn);
    }

    function redraw(el, closeFn) {
      el.querySelector('.modal-body').innerHTML = body();
      wire(el, closeFn);
    }

    async function startUpload(el, closeFn) {
      step = 'upload';
      progress = { done: 0, failed: 0, total: plan.length };
      redraw(el, closeFn);
      const current = () => el.querySelector('#imp-current');
      // Serial to avoid hammering Supabase Storage; a bulk import of ~70 files
      // typically takes well under a minute at this pace.
      for (const p of plan) {
        if (current()) current().textContent = `${p.vehicle.id} — ${p.file.name}`;
        try {
          await AD.store.uploadDocument(p.file, { vehicleId: p.vehicle.id, name: p.name || p.file.name, category: p.category });
          progress.done++;
        } catch (e) {
          progress.failed++;
          console.warn('Import failed', p.file.name, e); // eslint-disable-line no-console
        }
        redraw(el, closeFn);
      }
      try { await AD.store.log(`Hired fleet import: ${progress.done} documents uploaded${progress.failed ? ', ' + progress.failed + ' failed' : ''}`); } catch (e) { /* non-fatal */ }
      step = 'done';
      redraw(el, closeFn);
      AD.views.fleet && AD.views.fleet.refresh && AD.views.fleet.refresh();
    }
  };
})();
