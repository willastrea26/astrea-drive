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

AD.MAX_DOC_BYTES = 25 * 1024 * 1024; // 25 MB — larger than any PDF a user realistically uploads one-off

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

/** Upload-document modal. Attached to a single vehicleId. */
AD.documentForm = function (vehicleId, onSaved) {
  const { esc, options, formData, showErrors, modal, toast } = AD.ui;
  modal({
    title: 'Upload document',
    body: `
      <form class="form-grid" novalidate>
        <div class="field full"><label>File <span class="req">*</span></label>
          <input type="file" name="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.heic,.txt">
          <div class="help">Up to ${AD.fmtBytes(AD.MAX_DOC_BYTES)}. PDFs, images, Word or Excel docs.</div></div>
        <div class="field full"><label>Document name <span class="req">*</span></label>
          <input type="text" name="name" placeholder="Rego certificate, insurance policy…"></div>
        <div class="field"><label>Category</label>
          <select name="category">${options(AD.DOCUMENT_CATEGORIES, 'Other')}</select></div>
        <div class="field"><label>&nbsp;</label><div class="help" id="doc-info" style="padding-top:9px">No file selected.</div></div>
      </form>
      <div class="form-actions">
        <button class="btn btn-ghost" data-close type="button">Cancel</button>
        <button class="btn btn-primary" data-save type="button">Upload</button>
      </div>`,
    onMount(el, close) {
      const f = el.querySelector('form');
      el.querySelector('[data-close]').onclick = close;
      f.file.addEventListener('change', () => {
        const file = f.file.files[0];
        if (!file) { el.querySelector('#doc-info').textContent = 'No file selected.'; return; }
        el.querySelector('#doc-info').textContent = `${file.name} · ${AD.fmtBytes(file.size)}`;
        if (!f.name.value) f.name.value = file.name.replace(/\.[^.]+$/, '');
      });
      const saveBtn = el.querySelector('[data-save]');
      saveBtn.onclick = async () => {
        const d = formData(f);
        const file = f.file.files[0];
        const err = {};
        if (!file) err.file = 'Choose a file to upload.';
        else if (file.size > AD.MAX_DOC_BYTES) err.file = `File is ${AD.fmtBytes(file.size)}; the limit is ${AD.fmtBytes(AD.MAX_DOC_BYTES)}.`;
        if (!d.name || d.name.trim().length < 2) err.name = 'Give the document a name.';
        if (!showErrors(f, err)) return;
        saveBtn.disabled = true;
        saveBtn.textContent = 'Uploading…';
        let saved;
        try {
          saved = await AD.store.uploadDocument(file, { vehicleId, name: d.name.trim(), category: d.category || 'Other' });
          await AD.store.log(`Document uploaded to ${vehicleId}: ${saved.name}`, vehicleId);
        } catch (e) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Upload';
          toast('Upload failed: ' + e.message, 'error');
          return;
        }
        toast(`${saved.name} uploaded`);
        close();
        onSaved && onSaved(saved);
      };
    }
  });
};
