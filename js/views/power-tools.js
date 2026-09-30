/* Power & motor tools register */
AD.views = AD.views || {};

AD.TOOL_TYPES = ['Demo Saw', 'Vibe Plate', 'Jumping Jack', 'Generator', 'Other'];

/** Add / edit tool modal. Calls onSaved(tool) after saving. */
AD.toolForm = function (tool, onSaved) {
  const { esc, options, formData, showErrors, modal, toast } = AD.ui;
  const isNew = !tool;
  const t = tool || { id: '', type: 'Demo Saw', make: '', serial: '', location: 'Various sites', responsible: '', serviceInterval: '', lastService: '', nextService: '' };

  modal({
    title: isNew ? 'Add tool' : `Edit ${t.type}`,
    body: `
      <form class="form-grid" novalidate>
        <div class="field"><label>Tool type <span class="req">*</span></label><select name="type">${options(AD.TOOL_TYPES, t.type)}</select></div>
        <div class="field"><label>Make / model</label><input type="text" name="make" value="${esc(t.make)}"></div>
        <div class="field"><label>Serial #</label><input type="text" name="serial" value="${esc(t.serial)}"></div>
        <div class="field"><label>Location</label><input type="text" name="location" value="${esc(t.location)}"></div>
        <div class="field"><label>Responsible person</label><input type="text" name="responsible" value="${esc(t.responsible)}"></div>
        <div class="field"><label>Service interval</label><input type="text" name="serviceInterval" value="${esc(t.serviceInterval)}" placeholder="e.g. 3 months or 100 hrs"></div>
        <div class="field"><label>Last service</label><input type="date" name="lastService" value="${esc(t.lastService || '')}"></div>
        <div class="field"><label>Next service</label><input type="date" name="nextService" value="${esc(t.nextService || '')}"></div>
      </form>
      <div class="form-actions">
        <button class="btn btn-ghost" data-close type="button">Cancel</button>
        <button class="btn btn-primary" data-save type="button">${isNew ? 'Add tool' : 'Save changes'}</button>
      </div>`,
    onMount(el, close) {
      const form = el.querySelector('form');
      el.querySelector('[data-close]').onclick = close;
      const saveBtn = el.querySelector('[data-save]');
      saveBtn.onclick = async () => {
        const d = formData(form);
        const err = {};
        if (!d.type) err.type = 'Tool type is required.';
        if (!showErrors(form, err)) return;
        const rec = {
          type: d.type, make: d.make, serial: d.serial, location: d.location, responsible: d.responsible,
          serviceInterval: d.serviceInterval, lastService: d.lastService || null, nextService: d.nextService || null
        };
        saveBtn.disabled = true;
        let saved;
        try {
          if (isNew) {
            saved = await AD.store.insert('power_tools', rec, 'PMT');
            await AD.store.log(`${saved.id} (${d.type}) added to power & motor tools`);
            toast(`${d.type} added`);
          } else {
            saved = await AD.store.update('power_tools', t.id, rec);
            await AD.store.log(`${t.id} (${d.type}) details updated`);
            toast(`${d.type} saved`);
          }
        } catch (e) {
          saveBtn.disabled = false;
          toast('Could not save tool: ' + e.message, 'error');
          return;
        }
        close();
        onSaved && onSaved(saved);
      };
    }
  });
};

AD.views['power-tools'] = (function () {
  const { esc, pageHeader, dash } = AD.ui;
  const T = AD.time, I = AD.icons;
  let root = null;

  function dueState(nextService) {
    if (!nextService) return null;
    const days = T.daysBetween(T.todayKey(), nextService);
    if (days < 0) return { tone: 'red', text: `Overdue · ${Math.abs(days)}d ago` };
    if (days <= 30) return { tone: 'amber', text: `Due in ${days}d` };
    return { tone: 'muted', text: `${days}d` };
  }

  function render(el) {
    root = el;
    rows();
  }

  function rows() {
    const tools = AD.store.all('power_tools').slice().sort((a, b) => a.id.localeCompare(b.id));
    const typeCounts = tools.reduce((m, t) => { m[t.type] = (m[t.type] || 0) + 1; return m; }, {});
    const summary = Object.entries(typeCounts).map(([type, n]) => `${n}× ${type}`).join(' · ');

    root.innerHTML = `
      ${pageHeader({
        title: 'Power &amp; motor tools',
        sub: summary || 'No tools recorded yet',
        actions: `<button class="btn btn-primary" id="add-tool">${I.plus} Add tool</button>`
      })}
      <div class="table-wrap"><table class="data">
        <thead><tr>
          <th style="width:150px">Tool</th>
          <th class="col-opt">Make / model</th>
          <th class="col-opt">Serial #</th>
          <th class="col-opt col-wide">Location</th>
          <th class="col-opt col-wide">Responsible person</th>
          <th>Service interval</th>
          <th class="col-opt">Last service</th>
          <th style="min-width:130px">Next service</th>
          <th class="col-action col-opt"><span class="hide">Actions</span></th>
        </tr></thead>
        <tbody>
          ${tools.map((t) => {
            const due = dueState(t.nextService);
            return `<tr>
              <td><span class="id">${esc(t.type)}</span><span class="t2">${esc(t.id)}</span></td>
              <td class="col-opt">${t.make || dash}</td>
              <td class="col-opt">${t.serial || dash}</td>
              <td class="col-opt col-wide">${t.location || dash}</td>
              <td class="col-opt col-wide">${t.responsible || dash}</td>
              <td>${t.serviceInterval || dash}</td>
              <td class="col-opt">${t.lastService ? T.fmtKey(t.lastService) : dash}</td>
              <td>${t.nextService ? `${T.fmtKey(t.nextService)}${due ? ` <span class="flag flag-${due.tone}">· ${due.text}</span>` : ''}` : dash}</td>
              <td class="col-action col-opt"><button class="btn btn-sm btn-ghost" data-edit="${t.id}">Edit</button></td>
            </tr>`;
          }).join('') || '<tr><td colspan="9" class="empty">No tools recorded yet.</td></tr>'}
        </tbody>
      </table></div>`;

    root.querySelector('#add-tool').onclick = () => AD.toolForm(null, () => rows());
    root.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.onclick = () => AD.toolForm(AD.store.get('power_tools', btn.dataset.edit), () => rows());
    });
  }

  return { title: 'Power & motor tools', render, refresh: () => root && rows() };
})();
