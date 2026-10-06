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

/** Pick the file-type family (and its colour) from a filename or storage path.
 *  Returns { kind: 'pdf'|'doc'|'xls'|'img'|'txt'|'file', label: 'PDF'|… }. */
AD.fileKind = function (nameOrPath) {
  const m = String(nameOrPath || '').match(/\.([a-z0-9]+)$/i);
  const ext = (m ? m[1] : '').toLowerCase();
  if (ext === 'pdf') return { kind: 'pdf', label: 'PDF' };
  if (ext === 'doc' || ext === 'docx') return { kind: 'doc', label: 'DOC' };
  if (ext === 'xls' || ext === 'xlsx' || ext === 'csv') return { kind: 'xls', label: 'XLS' };
  if (['png', 'jpg', 'jpeg', 'webp', 'heic', 'gif', 'bmp', 'svg'].includes(ext)) return { kind: 'img', label: 'IMG' };
  if (ext === 'txt' || ext === 'md' || ext === 'rtf') return { kind: 'txt', label: 'TXT' };
  if (ext === 'ppt' || ext === 'pptx') return { kind: 'ppt', label: 'PPT' };
  if (ext === 'zip' || ext === 'rar' || ext === '7z') return { kind: 'zip', label: 'ZIP' };
  return { kind: 'file', label: ext ? ext.slice(0, 3).toUpperCase() : 'FILE' };
};

/** Small inline-SVG file badge — a document silhouette with a coloured
 *  corner-fold and the extension label across the body. Scales with font-size
 *  (uses em units) so it visually matches the row it's in. */
AD.fileIcon = function (nameOrPath) {
  const { kind, label } = AD.fileKind(nameOrPath);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return `<span class="file-ico file-ico-${kind}" aria-hidden="true"><span class="file-ico-ext">${esc(label)}</span></span>`;
};

/** Pick a sensible download filename: use the document's name, keeping (or
 *  adding) the correct extension from the stored path. */
function downloadFilename(doc) {
  const base = (doc.name || 'document').replace(/[\\/:*?"<>|]+/g, '_');
  const pathExt = (doc.storagePath || '').match(/\.[a-z0-9]{1,8}$/i);
  const nameExt = base.match(/\.[a-z0-9]{1,8}$/i);
  if (pathExt && !nameExt) return base + pathExt[0];
  return base;
}

/** Open the file via its system default app (Adobe Reader for PDFs, Excel
 *  for xlsx, etc). We ask Supabase for a signed URL with Content-Disposition
 *  attachment so the browser downloads instead of rendering inline — once the
 *  file is on disk, Windows hands it to the user's default handler for that
 *  file type. */
AD.openDocument = async function (doc) {
  const { toast } = AD.ui;
  if (!doc || !doc.storagePath) { toast('That document has no attached file.', 'warn'); return; }
  try {
    const filename = downloadFilename(doc);
    const url = await AD.store.signDocumentUrl(doc.storagePath, 300, { download: filename });
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (e) {
    toast('Could not open document: ' + e.message, 'error');
  }
};

/** Download the file to disk (same mechanism as Open — kept as a separate
 *  entry point so views that want to label the action "Download" still can). */
AD.downloadDocument = AD.openDocument;

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
  const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.heic,.txt,.csv,.zip,.rar,.7z';
  const UPLOAD_ICO = '<svg viewBox="0 0 24 24" class="ico" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4"/><path d="m6 10 6-6 6 6"/><path d="M4 20h16"/></svg>';

  modal({
    title: 'Upload documents',
    body: `
      <div class="du-wrap">
        <div class="du-drop" id="du-drop" tabindex="0" role="button" aria-label="Drop files here or click to browse">
          <div class="du-drop-ico">${UPLOAD_ICO}</div>
          <div class="du-drop-title">Drop files here</div>
          <div class="du-drop-sub">or <span class="du-link" id="du-browse-files">click to browse</span> · <span class="du-link" id="du-browse-folder">browse a folder</span></div>
          <div class="du-drop-hint">PDFs, images, Word, Excel, PowerPoint, ZIPs — up to ${AD.fmtBytes(AD.MAX_DOC_BYTES)} each</div>
          <input type="file" id="du-input" accept="${ACCEPT}" multiple hidden>
          <input type="file" id="du-input-dir" webkitdirectory directory multiple hidden>
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

      // Map a subfolder name to the nearest DOCUMENT_CATEGORIES entry, or null.
      const categoryFromFolder = (folderName) => {
        if (!folderName) return null;
        const lower = folderName.toLowerCase();
        for (const cat of AD.DOCUMENT_CATEGORIES) {
          if (cat.toLowerCase().includes(lower) || lower.includes(cat.toLowerCase())) return cat;
        }
        return null;
      };

      // Recursively walk a DirectoryEntry (from webkitGetAsEntry) and collect
      // { file, rel } pairs where rel is the path relative to the dropped root.
      // Skips hidden files (.DS_Store, .git, etc).
      const walkEntry = (entry, prefix) => new Promise((resolve) => {
        const pfx = prefix || '';
        if (!entry) return resolve([]);
        if (entry.isFile) {
          entry.file((f) => resolve([{ file: f, rel: pfx + f.name }]), () => resolve([]));
          return;
        }
        if (entry.isDirectory) {
          const reader = entry.createReader();
          const all = [];
          const readBatch = () => reader.readEntries(async (entries) => {
            if (!entries.length) return resolve(all);
            for (const e of entries) {
              if (e.name && e.name.startsWith('.')) continue;
              const items = await walkEntry(e, pfx + entry.name + '/');
              all.push(...items);
            }
            readBatch();
          }, () => resolve(all));
          readBatch();
        } else {
          resolve([]);
        }
      });
      const drop = el.querySelector('#du-drop');
      const input = el.querySelector('#du-input');
      const dirInput = el.querySelector('#du-input-dir');
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

      // Accept either plain File objects or { file, rel } pairs from walkEntry.
      // rel is the path relative to the dropped folder root (e.g. "Registration/truck.pdf").
      // The first path segment (if any) is used as the category hint.
      const addFiles = (items) => {
        const arr = Array.from(items || []);
        if (!arr.length) return;
        arr.forEach((item) => {
          const file = item.file || item;
          const rel = item.rel || file.webkitRelativePath || file.name;
          // Strip the top-level folder name that webkitdirectory prepends (e.g. "MyDocs/Rego/x.pdf" → "Rego/x.pdf")
          const parts = rel.split('/').filter(Boolean);
          // If there are 3+ segments the first is the root folder name; subfolder is second.
          // If 2 segments the first IS the subfolder.
          const subFolder = parts.length >= 2 ? parts[parts.length - 2] : null;
          const category = (subFolder && categoryFromFolder(subFolder)) || guessCategory(file.name);
          queue.push({
            id: 'q' + (++seq),
            file,
            name: file.name.replace(/\.[^.]+$/, ''),
            category,
            status: 'queued',
            error: ''
          });
        });
        render();
      };

      // Click handlers — the drop zone itself opens the file picker, and the
      // two inline links target files vs folder specifically.
      drop.addEventListener('click', (e) => {
        if (e.target.id === 'du-browse-folder') { e.stopPropagation(); dirInput.click(); return; }
        input.click();
      });
      drop.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
      });
      input.addEventListener('change', () => {
        addFiles(input.files);
        input.value = '';
      });
      dirInput.addEventListener('change', () => {
        // webkitdirectory populates files with webkitRelativePath set to the path
        // within the chosen folder (e.g. "MyDocs/Registration/truck.pdf").
        // Skip dotfiles the OS adds (.DS_Store, Thumbs.db, …).
        const items = Array.from(dirInput.files || [])
          .filter((f) => !f.name.startsWith('.') && f.name !== 'Thumbs.db')
          .map((f) => ({ file: f, rel: f.webkitRelativePath || f.name }));
        addFiles(items);
        dirInput.value = '';
      });

      // Drag + drop. For a native file drop e.dataTransfer.files has the files
      // flat; for a FOLDER drop we have to walk the DirectoryEntry tree via
      // the webkitGetAsEntry API or we only get the folder's name, no contents.
      ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => {
        e.preventDefault(); e.stopPropagation();
        drop.classList.add('du-over');
      }));
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
        e.preventDefault(); e.stopPropagation();
        if (ev === 'dragleave' && drop.contains(e.relatedTarget)) return;
        drop.classList.remove('du-over');
      }));
      drop.addEventListener('drop', async (e) => {
        const dtItems = e.dataTransfer && e.dataTransfer.items;
        const hasEntries = dtItems && dtItems.length && typeof dtItems[0].webkitGetAsEntry === 'function';
        if (!hasEntries) {
          // Plain file drop — no path info, falls back to filename-based guessing.
          addFiles(e.dataTransfer && e.dataTransfer.files);
          return;
        }
        // Walk each dropped entry. walkEntry returns { file, rel } pairs where
        // rel is relative to the dropped item itself (e.g. "Registration/truck.pdf").
        const entries = Array.from(dtItems).map((it) => it.webkitGetAsEntry()).filter(Boolean);
        const collected = [];
        for (const entry of entries) {
          const items = await walkEntry(entry, '');
          collected.push(...items);
        }
        addFiles(collected);
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
