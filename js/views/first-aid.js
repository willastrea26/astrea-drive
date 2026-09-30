/* First aid kit register */
AD.views = AD.views || {};

AD.views['first-aid'] = (function () {
  const { esc, $, options, badge, formData, showErrors, modal, toast, pageHeader, dash } = AD.ui;
  const T = AD.time;
  const I = AD.icons;
  let root = null;
  let st = {};

  function kitState(v) {
    if (!v.firstAidNextDue) return { state: 'unknown', days: null };
    const days = T.daysBetween(T.todayKey(), v.firstAidNextDue);
    if (days < 0) return { state: 'overdue', days };
    if (days <= 30) return { state: 'soon', days };
    return { state: 'ok', days };
  }

  function statePill(v) {
    const k = kitState(v);
    if (k.state === 'unknown') return '<span class="flag flag-muted">No inspection</span>';
    if (k.state === 'overdue') return `<span class="flag flag-red">Overdue · ${Math.abs(k.days)}d ago</span>`;
    if (k.state === 'soon') return `<span class="flag flag-amber">Due in ${k.days}d</span>`;
    return `<span class="flag flag-muted">${k.days}d until due</span>`;
  }

  function fullBadge(val) {
    if (!val || val === 'N/A') return badge('N/A', 'grey muted');
    if (val === 'Yes' || val === 'YES') return badge('Yes', 'green');
    return badge('No', 'red');
  }

  function render(el, params) {
    root = el;
    st = { q: params.q || '', kit: params.kit || '', status: params.status || '' };
    const all = AD.store.all('vehicles');
    const withKit = all.filter((v) => v.firstAidFull && v.firstAidFull !== 'N/A');
    const overdue = withKit.filter((v) => kitState(v).state === 'overdue').length;
    const soon = withKit.filter((v) => kitState(v).state === 'soon').length;

    el.innerHTML = `
      ${pageHeader({
        title: 'First aid kit register',
        sub: `${withKit.length} kits tracked${overdue ? ' · ' + overdue + ' overdue' : ''}${soon ? ' · ' + soon + ' due soon' : ''}`
      })}
      <div class="toolbar">
        <div class="search">${I.search}<input type="search" id="fa-q" placeholder="Search ID, rego, make or model" value="${esc(st.q)}" aria-label="Search vehicles"></div>
        <select id="fa-kit" aria-label="Kit type">${options([['Car', 'Car kit'], ['Truck', 'Truck kit']], st.kit, 'All kit types')}</select>
        <select id="fa-status" aria-label="Inspection status">${options([['overdue', 'Overdue'], ['soon', 'Due within 30 days'], ['ok', 'OK']], st.status, 'Any status')}</select>
        <span class="count" id="fa-count"></span>
      </div>
      <div class="table-wrap"><table class="data">
        <thead><tr>
          <th style="width:100px">Fleet ID</th>
          <th class="col-opt">Rego</th>
          <th class="col-opt col-wide">Type</th>
          <th>Kit type</th>
          <th class="col-opt">Last inspected</th>
          <th>Full kit</th>
          <th>Next due</th>
          <th style="min-width:140px">Status</th>
          <th class="col-action col-opt"><span class="hide">Actions</span></th>
        </tr></thead>
        <tbody id="fa-body"></tbody>
      </table></div>`;

    const bind = (id, key, ev = 'change') => el.querySelector(id).addEventListener(ev, (e) => { st[key] = e.target.value; sync(); });
    bind('#fa-q', 'q', 'input');
    bind('#fa-kit', 'kit');
    bind('#fa-status', 'status');
    rows();
  }

  function sync() { AD.setParams(st); rows(); }

  function rows() {
    const q = st.q.toLowerCase();
    const list = AD.store.all('vehicles').filter((v) => {
      if (v.firstAidFull === 'N/A' || (!v.firstAidFull && !v.firstAidNextDue)) return false;
      if (st.kit && v.firstAidKitType !== st.kit) return false;
      if (st.status && kitState(v).state !== st.status) return false;
      if (q) {
        const hay = [v.id, v.rego, v.make, v.model, v.type].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => {
      const ka = kitState(a), kb = kitState(b);
      const order = { overdue: 0, soon: 1, ok: 2, unknown: 3 };
      if (order[ka.state] !== order[kb.state]) return order[ka.state] - order[kb.state];
      if (ka.days != null && kb.days != null) return ka.days - kb.days;
      return a.id.localeCompare(b.id);
    });

    root.querySelector('#fa-count').textContent = `${list.length} vehicles`;
    const body = root.querySelector('#fa-body');
    body.innerHTML = list.map((v) => {
      const k = kitState(v);
      return `<tr>
        <td><a class="id" href="#/vehicle/${v.id}">${esc(v.id)}</a></td>
        <td class="col-opt">${esc(v.rego)}</td>
        <td class="col-opt col-wide">${esc(v.type)}</td>
        <td>${v.firstAidKitType ? esc(v.firstAidKitType) + ' kit' : dash}</td>
        <td class="col-opt">${v.firstAidInspected ? T.fmtKey(v.firstAidInspected) : dash}</td>
        <td>${fullBadge(v.firstAidFull)}</td>
        <td>${v.firstAidNextDue ? T.fmtKey(v.firstAidNextDue) : dash}</td>
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
          <div class="field"><label>Full kit?</label>
            <select name="full">${options(['Yes', 'No'], v.firstAidFull || 'Yes')}</select></div>
          <div class="field"><label>Kit type</label>
            <select name="kitType">${options(['Car', 'Truck'], v.firstAidKitType || 'Car')}</select></div>
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
              firstAidInspected: T.fromInput(d.inspected),
              firstAidFull: d.full,
              firstAidKitType: d.kitType,
              firstAidNextDue: T.fromInput(d.nextDue)
            });
            await AD.store.log(`${v.id} first aid kit inspected`, v.id);
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

  return { title: 'First aid kits', render, refresh: () => root && render(root, Object.assign({}, st)) };
})();
