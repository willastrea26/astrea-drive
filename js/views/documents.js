/* Document upload / download helpers (used by the vehicle Documents tab) */
AD.views = AD.views || {};

AD.DOCUMENT_CATEGORIES = ['Registration', 'Insurance', 'Compliance', 'Service history', 'Manual', 'Receipt', 'Other'];

/** Human-readable file size: "412 KB", "3.2 MB". */
AD.fmtBytes = function (n) {
  const b = Number(n) || 0;
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
  if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(b < 10 * 1024 * 1024 ? 1 : 0) + ' MB';
  return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
};

AD.MAX_DOC_BYTES = 25 * 1024 * 1024; // 25 MB per file

/** Open the file in a new tab via a short-lived signed URL. */
AD.openDocument = async function (doc) {
  const { toast } = AD.ui;
  if (!doc || !doc.storagePath) { toast('That document has no attached file.', 'warn'); return; }
  try {
    const url = await AD.store.signDocumentUrl(doc.storagePath, 300);
    window.open(url, '_blank', 'noopener');
  } catch (e) {
    toast('Could not open document: ' + e.message, 'error');
  }
};

/** Download the file (same signed URL, but hinted with the stored name). */
AD.downloadDocument = async function (doc) {
  const { toast } = AD.ui;
  if (!doc || !doc.storagePath) { toast('That document has no attached file.', 'warn'); return; }
  try {
    const url = await AD.store.signDocumentUrl(doc.storagePath, 300);
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.name || 'document';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (e) {
    toast('Could not download document: ' + e.message, 'error');
  }
};

/** Guess a sensible category from the file name. */
function guessCategory(name) {
  const n = (name || '').toLowerCase();
  if (/rego|registration/.test(n)) return 'Registration';
  if (/insur/.test(n)) return 'Insurance';
  if (/service|invoice/.test(n)) return 'Service history';
  if (/manual|handbook/.test(n)) return 'Manual';
  if (/receipt/.test(n)) return 'Receipt';
  if (/compl|cert|inspection/.test(n)) return 'Compliance';
  return 'Other';
}

/** Multi-file drag-and-drop document uploader. */
AD.documentForm = function (vehicleId, onSaved) {
  const { esc, options, modal, toast } = AD.ui;
  const I = AD.icons || {};
  const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.heic,.txt';
  const UPLOAD_ICO = '<svg viewBox="0 0 24 24" class="ico" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4"/><path d="m6 10 6-6 6 6"/><path d="M4 20h16"/></svg>';

  modal({
    title: 'Upload documents',
    body: `
      <div class="du-wrap">
        <div class="du-drop" id="du-drop" tabindex="0" role="button" aria-label="Drop files here or click to browse">
          <div class="du-drop-ico">${UPLOAD_ICO}</div>
          <div class="du-drop-title">Drop files here</div>
          <div class="du-drop-sub">or <span class="du-link">click to browse</span> — PDFs, images, Word or Excel docs, up to ${AD.fmtBytes(AD.MAX_DOC_BYTES)} each</div>
          <input type="file" id="du-input" accept="${ACCEPT}" multiple hidden>
        </div>
        <ul class="du-list" id="du-list" hidden></ul>
      </div>
      <div class="form-actions">
        <button class="btn btn-ghost" data-close type="button">Cancel</button>
        <button class="btn btn-primary" data-save type="button" disabled>Upload</button>
      </div>`,
    onMount(el, rawClose) {
      // Suppress default drop behaviour page-wide while this modal is open so
      // files landing outside the drop zone don't navigate the browser away.
      const stopDefault = (e) => { e.preventDefault(); };
      window.addEventListener('dragover', stopDefault);
      window.addEventListener('drop', stopDefault);
      const close = () => {
        window.removeEventListener('dragover', stopDefault);
        window.removeEventListener('drop', stopDefault);
        rawClose();
      };
      const drop = el.querySelector('#du-drop');
      const input = el.querySelector('#du-input');
      const list = el.querySelector('#du-list');
      const saveBtn = el.querySelector('[data-save]');
      el.querySelector('[data-close]').onclick = close;

      // Queue of { id, file, name, category, status: 'queued'|'uploading'|'done'|'error', error }
      const queue = [];
      let seq = 0;
      let savedCount = 0;

      const updateSaveBtn = () => {
        const pending = queue.filter((q) => q.status === 'queued').length;
        saveBtn.disabled = pending === 0;
        saveBtn.textContent = pending === 0 ? 'Upload' : `Upload ${pending} file${pending === 1 ? '' : 's'}`;
      };

      const render = () => {
        list.hidden = queue.length === 0;
        list.innerHTML = queue.map((q) => {
          const over = q.file.size > AD.MAX_DOC_BYTES;
          const status = over
            ? `<span class="du-status du-err">Too large (${AD.fmtBytes(q.file.size)})</span>`
            : q.status === 'uploading' ? `<span class="du-status du-up">Uploading…</span>`
            : q.status === 'done' ? `<span class="du-status du-ok">${I && I.check ? I.check : '&#10003;'} Uploaded</span>`
            : q.status === 'error' ? `<span class="du-status du-err" title="${esc(q.error || '')}">Failed</span>`
            : `<span class="du-status du-meta">${AD.fmtBytes(q.file.size)}</span>`;
          const nameInput = q.status === 'queued'
            ? `<input class="du-name" type="text" data-id="${q.id}" value="${esc(q.name)}" aria-label="Document name">`
            : `<span class="du-name-static">${esc(q.name)}</span>`;
          const catInput = q.status === 'queued'
            ? `<select class="du-cat" data-id="${q.id}">${options(AD.DOCUMENT_CATEGORIES, q.category)}</select>`
            : `<span class="du-cat-static">${esc(q.category)}</span>`;
          const removeBtn = q.status === 'queued'
            ? `<button type="button" class="du-del" data-del="${q.id}" title="Remove" aria-label="Remove">${I && I.x ? I.x : '&times;'}</button>`
            : '';
          return `
            <li class="du-row du-${q.status}${over ? ' du-row-err' : ''}" data-row="${q.id}">
              <div class="du-row-main">
                <div class="du-row-name">${nameInput}</div>
                <div class="du-row-meta">${catInput} ${status}</div>
              </div>
              ${removeBtn}
            </li>`;
        }).join('');

        list.querySelectorAll('.du-name').forEach((inp) => {
          inp.addEventListener('input', (e) => {
            const q = queue.find((x) => x.id === e.target.dataset.id);
            if (q) q.name = e.target.value;
          });
        });
        list.querySelectorAll('.du-cat').forEach((sel) => {
          sel.addEventListener('change', (e) => {
            const q = queue.find((x) => x.id === e.target.dataset.id);
            if (q) q.category = e.target.value;
          });
        });
        list.querySelectorAll('[data-del]').forEach((btn) => {
          btn.onclick = () => {
            const i = queue.findIndex((x) => x.id === btn.dataset.del);
            if (i >= 0) queue.splice(i, 1);
            render();
            updateSaveBtn();
          };
        });
        updateSaveBtn();
      };

      const addFiles = (fileList) => {
        const files = Array.from(fileList || []);
        if (!files.length) return;
        files.forEach((file) => {
          queue.push({
            id: 'q' + (++seq),
            file,
            name: file.name.replace(/\.[^.]+$/, ''),
            category: guessCategory(file.name),
            status: 'queued',
            error: ''
          });
        });
        render();
      };

      // Click → file picker
      drop.addEventListener('click', () => input.click());
      drop.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
      });
      input.addEventListener('change', () => {
        addFiles(input.files);
        input.value = '';
      });

      // Drag + drop
      ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => {
        e.preventDefault(); e.stopPropagation();
        drop.classList.add('du-over');
      }));
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
        e.preventDefault(); e.stopPropagation();
        if (ev === 'dragleave' && drop.contains(e.relatedTarget)) return;
        drop.classList.remove('du-over');
      }));
      drop.addEventListener('drop', (e) => {
        addFiles(e.dataTransfer && e.dataTransfer.files);
      });

      saveBtn.onclick = async () => {
        const pending = queue.filter((q) => q.status === 'queued' && q.file.size <= AD.MAX_DOC_BYTES);
        if (!pending.length) return;
        saveBtn.disabled = true;
        for (const q of pending) {
          q.status = 'uploading';
          render();
          try {
            const name = (q.name && q.name.trim()) || q.file.name.replace(/\.[^.]+$/, '');
            const saved = await AD.store.uploadDocument(q.file, { vehicleId, name, category: q.category || 'Other' });
            await AD.store.log(`Document uploaded to ${vehicleId}: ${saved.name}`, vehicleId);
            q.status = 'done';
            savedCount++;
            onSaved && onSaved(saved);
          } catch (e) {
            q.status = 'error';
            q.error = e && e.message ? e.message : String(e);
          }
          render();
        }
        const failed = queue.filter((q) => q.status === 'error').length;
        if (savedCount) toast(`${savedCount} document${savedCount === 1 ? '' : 's'} uploaded${failed ? ` · ${failed} failed` : ''}`);
        else if (failed) toast(`${failed} upload${failed === 1 ? '' : 's'} failed`, 'error');
        if (!failed) close();
        else updateSaveBtn();
      };
    }
  });
};
