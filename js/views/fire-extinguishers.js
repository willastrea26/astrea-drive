/* Fire extinguisher register */
AD.views = AD.views || {};

AD.FIRE_EXT_TYPES = ['Dry Chem', 'CO2', 'Foam', 'Wet Chem', 'Other'];

AD.views['fire-extinguishers'] = (function () {
  const { esc, options, badge, formData, showErrors, modal, toast, pageHeader, dash } = AD.ui;
  const T = AD.time;
  const I = AD.icons;
  let root = null;
  let st = {};

  function extState(v) {
    if (!v.fireExtNextDue) return { state: 'unknown', days: null };
    const days = T.daysBetween(T.todayKey(), v.fireExtNextDue);
    if (days < 0) return { state: 'overdue', days };
    if (days <= 30) return { state: 'soon', days };
    return { state: 'ok', days };
  }

  function statePill(v) {
    const k = extState(v);
    if (k.state === 'unknown') return '<span class="flag flag-muted">No inspection</span>';
    if (k.state === 'overdue') return `<span class="flag flag-red">Overdue · ${Math.abs(k.days)}d ago</span>`;
    if (k.state === 'soon') return `<span class="flag flag-amber">Due in ${k.days}d</span>`;
    return `<span class="flag flag-muted">${k.days}d until due</span>`;
  }

  function statusBadge(val) {
    if (!val) return badge('Not recorded', 'grey muted');
    if (val === 'N/A') return badge('N/A', 'grey muted');
    if (val === 'Pass') return badge('Pass', 'green');
    return badge('Fail', 'red');
  }

  function render(el, params) {
    root = el;
    st = { q: params.q || '', size: params.size || '', status: params.status || '' };
    const all = AD.store.all('vehicles').filter((v) => v.type !== 'Trailer');
    const overdue = all.filter((v) => extState(v).state === 'overdue').length;
    const soon = all.filter((v) => extState(v).state === 'soon').length;
    const unrecorded = all.filter((v) => extState(v).state === 'unknown').length;

    el.innerHTML = `
      ${pageHeader({
        title: 'Fire extinguisher register',
        sub: `${all.length} vehicles${overdue ? ' · ' + overdue + ' overdue' : ''}${soon ? ' · ' + soon + ' due soon' : ''}${unrecorded ? ' · ' + unrecorded + ' not yet recorded' : ''}`
      })}
      <div class="toolbar">
        <div class="search">${I.search}<input type="search" id="fe-q" placeholder="Search ID, rego, make or model" value="${esc(st.q)}" aria-label="Search vehicles"></div>
        <select id="fe-size" aria-label="Extinguisher size">${options([['1kg', '1kg'], ['4.5kg', '4.5kg'], ['9kg', '9kg']], st.size, 'All sizes')}</select>
        <select id="fe-status" aria-label="Inspection status">${options([['overdue', 'Overdue'], ['soon', 'Due within 30 days'], ['ok', 'OK'], ['unknown', 'Not yet recorded']], st.status, 'Any status')}</select>
        <span class="count" id="fe-count"></span>
      </div>
      <div class="table-wrap"><table class="data">
        <thead><tr>
          <th style="width:100px">Fleet ID</th>
          <th class="col-opt">Rego</th>
          <th class="col-opt col-wide">Type</th>
          <th>Extinguisher</th>
          <th class="col-opt">Last inspected</th>
          <th>Result</th>
          <th>Next due</th>
          <th style="min-width:140px">Status</th>
          <th class="col-action col-opt"><span class="hide">Actions</span></th>
        </tr></thead>
        <tbody id="fe-body"></tbody>
      </table></div>`;

    const bind = (id, key, ev = 'change') => el.querySelector(id).addEventListener(ev, (e) => { st[key] = e.target.value; sync(); });
    bind('#fe-q', 'q', 'input');
    bind('#fe-size', 'size');
    bind('#fe-status', 'status');
    rows();
  }

  function sync() { AD.setParams(st); rows(); }

  function rows() {
    const q = st.q.toLowerCase();
    const list = AD.store.all('vehicles').filter((v) => {
      if (v.type === 'Trailer') return false;
      if (st.size && v.fireExtSize !== st.size) return false;
      if (st.status && extState(v).state !== st.status) return false;
      if (q) {
        const hay = [v.id, v.rego, v.make, v.model, v.type].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => {
      const ka = extState(a), kb = extState(b);
      const order = { overdue: 0, soon: 1, ok: 2, unknown: 3 };
      if (order[ka.state] !== order[kb.state]) return order[ka.state] - order[kb.state];
      if (ka.days != null && kb.days != null) return ka.days - kb.days;
      return a.id.localeCompare(b.id);
    });

    root.querySelector('#fe-count').textContent = `${list.length} vehicles`;
    const body = root.querySelector('#fe-body');
    body.innerHTML = list.map((v) => {
      return `<tr>
        <td><a class="id" href="#/vehicle/${v.id}">${esc(v.id)}</a></td>
        <td class="col-opt">${esc(v.rego)}</td>
        <td class="col-opt col-wide">${esc(v.type)}</td>
        <td>${v.fireExtType ? esc(v.fireExtType) + (v.fireExtSize ? ' · ' + esc(v.fireExtSize) : '') : dash}</td>
        <td class="col-opt">${v.fireExtInspected ? T.fmtKey(v.fireExtInspected) : dash}</td>
        <td>${statusBadge(v.fireExtStatus)}</td>
        <td>${v.fireExtNextDue ? T.fmtKey(v.fireExtNextDue) : dash}</td>
        <td>${statePill(v)}</td>
        <td class="col-action col-opt">
          <button class="btn btn-sm btn-ghost" data-inspect="${v.id}">Record</button>
        </td>
      </tr>`;
    }).join('') || '<tr><td colspan="9" class="empty">No vehicles match these filters.</td></tr>';

    body.querySelectorAll('[data-inspect]').forEach((btn) => {
      btn.onclick = () => inspectForm(AD.store.get('vehicles', btn.dataset.inspect));
    });
  }

  function inspectForm(v) {
    const today = T.todayKey();
    const sixMonths = T.addDays(today, 183);
    modal({
      title: `Record inspection — ${v.id}`,
      body: `
        <form class="form-grid" novalidate>
          <div class="field"><label>Vehicle</label>
            <input type="text" value="${esc(v.id)} — ${esc(v.make)} ${esc(v.model)}" disabled></div>
          <div class="field"><label>Inspection date <span class="req">*</span></label>
            <input type="date" name="inspected" value="${T.toInput(today)}"></div>
          <div class="field"><label>Result</label>
            <select name="status">${options(['Pass', 'Fail'], v.fireExtStatus || 'Pass')}</select></div>
          <div class="field"><label>Extinguisher type</label>
            <select name="type">${options(AD.FIRE_EXT_TYPES, v.fireExtType || 'Dry Chem')}</select></div>
          <div class="field"><label>Size</label>
            <input type="text" name="size" value="${esc(v.fireExtSize || '')}" placeholder="e.g. 1kg, 4.5kg, 9kg"></div>
          <div class="field"><label>Next inspection due <span class="req">*</span></label>
            <input type="date" name="nextDue" value="${T.toInput(sixMonths)}"></div>
        </form>
        <div class="form-actions">
          <button class="btn btn-ghost" data-close type="button">Cancel</button>
          <button class="btn btn-primary" data-save type="button">Save inspection</button>
        </div>`,
      onMount(el, close) {
        el.querySelector('[data-close]').onclick = close;
        const saveBtn = el.querySelector('[data-save]');
        saveBtn.onclick = async () => {
          const form = el.querySelector('form');
          const d = formData(form);
          const err = {};
          if (!d.inspected) err.inspected = 'Inspection date is required.';
          if (!d.nextDue) err.nextDue = 'Next inspection date is required.';
          if (!showErrors(form, err)) return;
          saveBtn.disabled = true;
          try {
            await AD.store.update('vehicles', v.id, {
              fireExtInspected: T.fromInput(d.inspected),
              fireExtStatus: d.status,
              fireExtType: d.type,
              fireExtSize: d.size,
              fireExtNextDue: T.fromInput(d.nextDue)
            });
            await AD.store.log(`${v.id} fire extinguisher inspected`, v.id);
            toast(`${v.id} inspection recorded`);
          } catch (e) {
            saveBtn.disabled = false;
            toast('Could not save: ' + e.message, 'error');
            return;
          }
          close();
        };
      }
    });
  }

  return { title: 'Fire extinguishers', render, refresh: () => root && render(root, Object.assign({}, st)) };
})();
