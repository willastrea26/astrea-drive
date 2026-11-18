/*
 * Employee, equipment and technology registers — listed under the
 * "Registers" heading in the sidebar. All three share one table renderer.
 *
 * Employee register: REAL data from the Supabase "employees" table
 * (supabase/create-employees.sql), with add / edit / remove. Staff details
 * are never kept in this file or anywhere else in the repository.
 *
 * Equipment and technology registers: SAMPLE DATA ONLY, made-up rows for a
 * fictional Sydney civil / survey / locating company, so the layout can be
 * reviewed before their real columns are agreed. Nothing for these two is
 * read from or written to Supabase.
 */
AD.views = AD.views || {};

(function () {
  const COMPANY = 'Ironbark Civil & Survey';
  const esc = (s) => AD.ui.esc(s);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const or = (v) => (v ? esc(v) : AD.ui.dash);
  const fmtDate = (key) => (key ? AD.time.fmtKey(String(key).slice(0, 10)) : AD.ui.dash);
  // Comma-separated list -> unique, trimmed items (the HR export repeats some).
  const listOf = (s) => [...new Set(String(s || '').split(',').map((x) => x.trim()).filter(Boolean))];

  // Sample dates are relative to today, so "due soon" / "overdue" look realistic.
  const day = (offset) => AD.time.addDays(AD.time.todayKey(), offset);

  /** Date with a coloured flag underneath when it's due soon or overdue. */
  function dueCell(key, { soon = 30, past = (n) => `Overdue ${n}d`, future = 'Due in' } = {}) {
    const T = AD.time;
    if (!key) return AD.ui.dash;
    const days = T.daysBetween(T.todayKey(), key);
    let flag = '';
    if (days < 0) flag = `<span class="flag flag-red">${past(-days)}</span>`;
    else if (days <= soon) flag = `<span class="flag flag-amber">${future} ${days}d</span>`;
    return `${T.fmtKey(key)}${flag ? `<span class="t2">${flag}</span>` : ''}`;
  }
  const dueState = (key, soon = 30) => {
    if (!key) return 'ok';
    const days = AD.time.daysBetween(AD.time.todayKey(), key);
    return days < 0 ? 'overdue' : days <= soon ? 'soon' : 'ok';
  };

  // =========================================================== employees
  /** Add / edit an employee. Pass null to add. */
  AD.employeeForm = function (emp, onSaved) {
    const { formData, showErrors, modal, toast, confirm } = AD.ui;
    const isNew = !emp;
    const e = emp || { name: '', licencesApplied: '', position: '', mobile: '', email: '', dateOfBirth: '', startDate: '', address: '', suburb: '', state: 'NSW', postcode: '', licenceRegister: '' };
    const dateVal = (v) => (v ? esc(String(v).slice(0, 10)) : '');

    modal({
      title: isNew ? 'Add employee' : `Edit ${e.name}`,
      wide: true,
      body: `
        <form class="form-grid" novalidate>
          <div class="form-section-title full"><b>Employee</b><span>Name, role and contact details</span></div>
          <div class="field"><label>Name <span class="req">*</span></label><input type="text" name="name" value="${esc(e.name)}"></div>
          <div class="field"><label>Position</label><input type="text" name="position" value="${esc(e.position)}"></div>
          <div class="field"><label>Mobile phone</label><input type="text" name="mobile" value="${esc(e.mobile)}" inputmode="tel"></div>
          <div class="field"><label>Email</label><input type="email" name="email" value="${esc(e.email)}"></div>
          <div class="field"><label>Date of birth</label><input type="date" name="dateOfBirth" value="${dateVal(e.dateOfBirth)}"></div>
          <div class="field"><label>Date of commencement</label><input type="date" name="startDate" value="${dateVal(e.startDate)}"></div>
          <div class="form-section-title full"><b>Address</b><span>Home address</span></div>
          <div class="field full"><label>Street address</label><input type="text" name="address" value="${esc(e.address)}"></div>
          <div class="field"><label>Suburb</label><input type="text" name="suburb" value="${esc(e.suburb)}"></div>
          <div class="field"><label>State</label><input type="text" name="state" value="${esc(e.state)}" maxlength="3"></div>
          <div class="field"><label>Postcode</label><input type="text" name="postcode" value="${esc(e.postcode)}" maxlength="4" inputmode="numeric"></div>
          <div class="form-section-title full"><b>Licences</b><span>Separate each one with a comma</span></div>
          <div class="field"><label>Licences applied</label><input type="text" name="licencesApplied" value="${esc(e.licencesApplied)}" placeholder="e.g. Full, Mobility"></div>
          <div class="field full"><label>Licence register</label><input type="text" name="licenceRegister" value="${esc(e.licenceRegister)}" placeholder="e.g. C Licence, RIW Card, White Card">
            <div class="help">Driver licences, tickets and cards this person holds.</div></div>
        </form>
        <div class="form-actions">
          ${isNew ? '' : '<button class="btn btn-danger-ghost" data-remove type="button" style="margin-right:auto">Remove</button>'}
          <button class="btn btn-ghost" data-close type="button">Cancel</button>
          <button class="btn btn-primary" data-save type="button">${isNew ? 'Add employee' : 'Save changes'}</button>
        </div>`,
      onMount(el, close) {
        const form = el.querySelector('form');
        el.querySelector('[data-close]').onclick = close;
        const removeBtn = el.querySelector('[data-remove]');
        if (removeBtn) removeBtn.onclick = async () => {
          const ok = await confirm({ title: `Remove ${e.name}?`, message: 'This permanently deletes their record from the employee register. It can’t be undone.', confirmText: 'Remove', danger: true });
          if (!ok) return;
          try {
            await AD.store.remove('employees', e.id);
            await AD.store.log(`${e.name} removed from the employee register`);
            toast(`${e.name} removed`);
          } catch (err) { toast('Could not remove employee: ' + err.message, 'error'); return; }
          close();
          onSaved && onSaved(null);
        };
        const saveBtn = el.querySelector('[data-save]');
        saveBtn.onclick = async () => {
          const d = formData(form);
          const err = {};
          if (!d.name) err.name = 'Name is required.';
          if (d.postcode && !/^\d{4}$/.test(d.postcode)) err.postcode = 'Use a 4-digit postcode.';
          if (!showErrors(form, err)) return;
          const tidyList = (s) => listOf(s).join(', ');
          const rec = {
            name: d.name, position: d.position, mobile: d.mobile, email: d.email,
            dateOfBirth: d.dateOfBirth || null, startDate: d.startDate || null,
            address: d.address, suburb: d.suburb, state: d.state.toUpperCase(), postcode: d.postcode,
            licencesApplied: tidyList(d.licencesApplied), licenceRegister: tidyList(d.licenceRegister)
          };
          saveBtn.disabled = true;
          let saved;
          try {
            if (isNew) {
              saved = await AD.store.insert('employees', rec, 'EMP');
              await AD.store.log(`${rec.name} added to the employee register`);
              toast(`${rec.name} added`);
            } else {
              saved = await AD.store.update('employees', e.id, rec);
              await AD.store.log(`${rec.name}’s employee details updated`);
              toast(`${rec.name} saved`);
            }
          } catch (err2) {
            saveBtn.disabled = false;
            toast('Could not save employee: ' + err2.message, 'error');
            return;
          }
          close();
          onSaved && onSaved(saved);
        };
      }
    });
  };

  // ============================================== sample data (equipment, tech)
  // All names, numbers and serials below are made up.
  const EQUIPMENT = () => [
    { id: 'SUR-01', name: 'GNSS rover', category: 'Surveying', make: 'Trimble R12i', serial: '6143R00217', location: 'Wetherill Park depot', assignedTo: 'Priya Nair', status: 'In service', nextInspection: day(74) },
    { id: 'SUR-02', name: 'Robotic total station', category: 'Surveying', make: 'Leica TS16', serial: '1873402', location: 'Site — Parramatta Rd, Granville', assignedTo: 'Josh Whitfield', status: 'In service', nextInspection: day(12) },
    { id: 'SUR-03', name: 'Rotating laser level', category: 'Surveying', make: 'Topcon RL-H5A', serial: 'TP-55120', location: 'Wetherill Park depot', assignedTo: '', status: 'Under repair', nextInspection: day(-9) },
    { id: 'LOC-01', name: 'Cable & pipe locator', category: 'Locating', make: 'Radiodetection RD8200', serial: 'RD-8200-41187', location: 'Ute UTE-04', assignedTo: 'Mia Tanaka', status: 'In service', nextInspection: day(160) },
    { id: 'LOC-02', name: 'Ground penetrating radar', category: 'Locating', make: 'Leica DS2000', serial: 'DS2-00938', location: 'Site — Church St, Ryde', assignedTo: 'Sam Haddad', status: 'In service', nextInspection: day(25) },
    { id: 'LOC-03', name: 'Sewer inspection camera', category: 'Locating', make: 'Envirosight ROVVER X', serial: 'RVX-2291', location: 'Wetherill Park depot', assignedTo: '', status: 'In service', nextInspection: day(203) },
    { id: 'CIV-01', name: 'Trench shield (3.0 m)', category: 'Civil', make: 'Aluminium box shield', serial: 'TS-3000-07', location: 'Site — Parramatta Rd, Granville', assignedTo: 'Liam Carter', status: 'In service', nextInspection: day(48) },
    { id: 'SAF-01', name: '4-gas detector', category: 'Safety', make: 'Honeywell BW MicroClip X3', serial: 'MCX3-60814', location: 'Ute UTE-02', assignedTo: 'Ben O’Connor', status: 'In service', nextInspection: day(-3) },
    { id: 'SAF-02', name: 'Confined space tripod & winch', category: 'Safety', make: 'Tripod rescue kit', serial: 'CS-TRI-114', location: 'Wetherill Park depot', assignedTo: '', status: 'Out of service', nextInspection: day(-41) },
    { id: 'TRF-01', name: 'Variable message sign trailer', category: 'Traffic control', make: 'Solar VMS trailer', serial: 'VMS-0452', location: 'Site — Church St, Ryde', assignedTo: '', status: 'In service', nextInspection: day(96) }
  ];

  const TECHNOLOGY = () => [
    { id: 'IT-001', type: 'Laptop', make: 'Dell Latitude 5440', serial: 'DL5440-7H2KQ', assignedTo: 'Sophie Kim', phone: '', purchased: day(-410), warranty: day(320), status: 'In use' },
    { id: 'IT-002', type: 'Laptop', make: 'Panasonic Toughbook 40', serial: 'TB40-1123987', assignedTo: 'Priya Nair', phone: '', purchased: day(-1010), warranty: day(-280), status: 'In use' },
    { id: 'IT-003', type: 'Field controller', make: 'Trimble TSC7', serial: 'TSC7-55031', assignedTo: 'Josh Whitfield', phone: '', purchased: day(-640), warranty: day(90), status: 'In use' },
    { id: 'IT-004', type: 'Tablet', make: 'Samsung Galaxy Tab Active5', serial: 'IMEI 356938110041221', assignedTo: 'Mia Tanaka', phone: '0491 571 491', purchased: day(-200), warranty: day(530), status: 'In use' },
    { id: 'IT-005', type: 'Phone', make: 'Samsung Galaxy XCover7', serial: 'IMEI 352719331802465', assignedTo: 'Liam Carter', phone: '0491 571 804', purchased: day(-150), warranty: day(580), status: 'In use' },
    { id: 'IT-006', type: 'Phone', make: 'Apple iPhone 15', serial: 'IMEI 359812447019937', assignedTo: 'Sophie Kim', phone: '0491 572 549', purchased: day(-330), warranty: day(22), status: 'In use' },
    { id: 'IT-007', type: 'Phone', make: 'Samsung Galaxy XCover6 Pro', serial: 'IMEI 351046228861734', assignedTo: '', phone: '', purchased: day(-900), warranty: day(-170), status: 'Spare' },
    { id: 'IT-008', type: 'Drone', make: 'DJI Matrice 350 RTK', serial: '1ZNBJ7Q00C0093', assignedTo: 'Josh Whitfield', phone: '', purchased: day(-260), warranty: day(105), status: 'In repair' },
    { id: 'IT-009', type: 'Site internet', make: 'Starlink Standard kit', serial: 'KIT-4F2290A1', assignedTo: '', phone: '', purchased: day(-120), warranty: day(245), status: 'In use' }
  ];

  const EQ_TONE = { 'In service': 'aqua', 'Under repair': 'violet', 'Out of service': 'red' };
  const IT_TONE = { 'In use': 'blue', Spare: 'aqua', 'In repair': 'violet', Retired: 'grey muted' };

  /** Filter dropdown that groups rows by one field. */
  const groupFilter = (key) => ({
    label: 'All groups',
    options: (rows, order) => order.filter((g) => rows.some((r) => r[key] === g)),
    match: (r, v) => r[key] === v
  });

  // ============================================================ registers
  const REGISTERS = [
    {
      route: 'employee-register', title: 'Employee register', noun: 'employee',
      table: 'employees', setupFile: 'supabase/create-employees.sql',
      rows: () => AD.store.all('employees').slice().sort((a, b) => String(a.name).localeCompare(String(b.name))),
      search: ['name', 'position', 'mobile', 'email', 'suburb', 'postcode', 'licencesApplied', 'licenceRegister'],
      filter: {
        label: 'Any licence or ticket',
        options: (rows) => [...new Set(rows.flatMap((r) => listOf(r.licenceRegister)))].sort((a, b) => a.localeCompare(b)),
        match: (r, v) => listOf(r.licenceRegister).includes(v)
      },
      summary: (rows) => {
        if (!rows.length) return 'No staff recorded yet';
        const withLic = rows.filter((r) => listOf(r.licenceRegister).length).length;
        const noPhone = rows.filter((r) => !r.mobile).length;
        return `${rows.length} staff · ${withLic} with licences or tickets recorded${noPhone ? ` · ${noPhone} without a mobile number` : ''}`;
      },
      add: { label: 'Add employee', open: (done) => AD.employeeForm(null, done) },
      edit: (r, done) => AD.employeeForm(r, done),
      cols: [
        { head: 'Employee', width: 220, cell: (r) => `<span class="id">${esc(r.name)}</span><span class="t2">${or(r.position)}</span>` },
        { head: 'Licences applied', width: 130, cls: 'col-opt col-wide', cell: (r) => or(r.licencesApplied) },
        { head: 'Contact', width: 230, cls: 'col-opt', cell: (r) => `${r.mobile ? `<span class="nowrap">${esc(r.mobile)}</span>` : '<span class="muted">No mobile</span>'}${r.email ? `<span class="t2"><a href="mailto:${esc(r.email)}">${esc(r.email)}</a></span>` : ''}` },
        { head: 'Date of birth', width: 115, cls: 'col-opt col-wide nowrap', cell: (r) => fmtDate(r.dateOfBirth) },
        { head: 'Commenced', width: 110, cls: 'col-opt nowrap', cell: (r) => fmtDate(r.startDate) },
        { head: 'Address', width: 220, cls: 'col-opt col-wide', cell: (r) => (r.address || r.suburb) ? `${or(r.address)}<span class="t2">${esc([r.suburb, r.state, r.postcode].filter(Boolean).join(' '))}</span>` : AD.ui.dash },
        { head: 'Licence register', cls: 'col-opt', cell: (r) => listOf(r.licenceRegister).length ? `<span class="reg-tags">${listOf(r.licenceRegister).map((x) => `<span class="reg-tag">${esc(x)}</span>`).join('')}</span>` : AD.ui.dash }
      ]
    },
    {
      route: 'equipment-register', title: 'Equipment register', noun: 'item', sample: true,
      rows: EQUIPMENT, groupBy: 'category', groupOrder: ['Surveying', 'Locating', 'Civil', 'Safety', 'Traffic control'],
      search: ['id', 'name', 'category', 'make', 'serial', 'location', 'assignedTo'],
      filter: groupFilter('category'),
      summary: (rows) => {
        const over = rows.filter((r) => dueState(r.nextInspection) === 'overdue').length;
        const soon = rows.filter((r) => dueState(r.nextInspection) === 'soon').length;
        return `${rows.length} items${over ? ` · <span class="flag flag-red">${over} overdue for inspection</span>` : ''}${soon ? ` · <span class="flag flag-amber">${soon} due within 30 days</span>` : ''}`;
      },
      cols: [
        { head: 'Item', width: 230, cell: (r) => `<span class="id">${esc(r.name)}</span><span class="t2">${esc(r.id)}</span>` },
        { head: 'Make / model', width: 200, cls: 'col-opt', cell: (r) => esc(r.make) },
        { head: 'Serial #', width: 140, cls: 'col-opt col-wide', cell: (r) => esc(r.serial) },
        { head: 'Location', cls: 'col-opt', cell: (r) => esc(r.location) },
        { head: 'Assigned to', width: 150, cls: 'col-opt col-wide', cell: (r) => r.assignedTo ? esc(r.assignedTo) : '<span class="muted">Depot pool</span>' },
        { head: 'Status', width: 140, cell: (r) => AD.ui.badge(r.status, EQ_TONE[r.status] || 'grey') },
        { head: 'Inspection / calibration', width: 170, cell: (r) => dueCell(r.nextInspection) }
      ]
    },
    {
      route: 'technology-register', title: 'Technology register', noun: 'device', sample: true,
      rows: TECHNOLOGY, groupBy: 'type', groupOrder: ['Laptop', 'Tablet', 'Phone', 'Field controller', 'Drone', 'Site internet'],
      search: ['id', 'type', 'make', 'serial', 'assignedTo', 'phone'],
      filter: groupFilter('type'),
      summary: (rows) => {
        const w = rows.filter((r) => dueState(r.warranty) === 'soon').length;
        return `${rows.length} devices · ${rows.filter((r) => r.status === 'In use').length} in use${w ? ` · <span class="flag flag-amber">${w} warrant${w === 1 ? 'y' : 'ies'} ending within 30 days</span>` : ''}`;
      },
      cols: [
        { head: 'Device', width: 240, cell: (r) => `<span class="id">${esc(r.make)}</span><span class="t2">${esc(r.id)}</span>` },
        { head: 'Serial / IMEI', width: 200, cls: 'col-opt', cell: (r) => esc(r.serial) },
        { head: 'Assigned to', width: 160, cell: (r) => r.assignedTo ? esc(r.assignedTo) : '<span class="muted">Unassigned</span>' },
        { head: 'Mobile number', width: 140, cls: 'col-opt nowrap', cell: (r) => or(r.phone) },
        { head: 'Purchased', width: 110, cls: 'col-opt col-wide nowrap', cell: (r) => AD.time.fmtKey(r.purchased) },
        { head: 'Warranty', width: 150, cls: 'col-opt', cell: (r) => dueCell(r.warranty, { past: (n) => `Ended ${n}d ago`, future: 'Ends in' }) },
        { head: 'Status', width: 120, cell: (r) => AD.ui.badge(r.status, IT_TONE[r.status] || 'grey') }
      ]
    }
  ];

  // =============================================================== render
  REGISTERS.forEach((reg) => {
    let root = null, q = '', pick = '';
    const missing = () => reg.table && !AD.store.available(reg.table);

    function table() {
      if (!root) return;
      const all = reg.rows();
      const needle = q.trim().toLowerCase();
      const list = all.filter((r) => (!pick || reg.filter.match(r, pick))
        && (!needle || reg.search.some((k) => String(r[k] || '').toLowerCase().includes(needle))));
      const cols = reg.cols.concat(reg.edit ? [{ head: '', cls: 'col-action', cell: (r) => `<button class="btn btn-sm btn-ghost" data-edit="${esc(r.id)}">${AD.icons.edit} Edit</button>` }] : []);
      const colspan = cols.length;
      const rowHtml = (r) => `<tr>${cols.map((c) => `<td class="${c.cls || ''}">${c.cell(r)}</td>`).join('')}</tr>`;
      let body;
      if (reg.groupBy) {
        const groups = reg.groupOrder.concat([...new Set(list.map((r) => r[reg.groupBy]))].filter((g) => !reg.groupOrder.includes(g)));
        body = groups.map((g) => {
          const rows = list.filter((r) => r[reg.groupBy] === g);
          return rows.length ? `<tr class="fleet-group-row"><th colspan="${colspan}"><span>${esc(g)}</span><small>${plural(rows.length, reg.noun)}</small></th></tr>${rows.map(rowHtml).join('')}` : '';
        }).join('');
      } else {
        body = list.map(rowHtml).join('');
      }
      const empty = !all.length ? `No ${reg.noun}s recorded yet.` : `No ${reg.noun}s match these filters.`;
      root.querySelector('#reg-count').textContent = `${list.length} of ${plural(all.length, reg.noun)}`;
      root.querySelector('#reg-head').innerHTML = `<tr>${cols.map((c) => `<th class="${c.cls || ''}"${c.width ? ` style="width:${c.width}px"` : ''}>${c.head ? esc(c.head) : '<span class="hide">Actions</span>'}</th>`).join('')}</tr>`;
      root.querySelector('#reg-body').innerHTML = body || `<tr><td colspan="${colspan}" class="empty">${empty}</td></tr>`;
      root.querySelectorAll('[data-edit]').forEach((b) => {
        b.onclick = () => reg.edit(AD.store.get(reg.table, b.dataset.edit), () => draw());
      });
    }

    function draw() {
      const { pageHeader, options } = AD.ui;
      const I = AD.icons;
      const all = reg.rows();
      const opts = reg.filter.options(all, reg.groupOrder || []);
      if (pick && !opts.includes(pick)) pick = '';
      const note = reg.sample
        ? `<div class="sample-note">${I.alert}<div><b>Sample data.</b> These rows are made up for a fictional company, ${esc(COMPANY)}, so you can see how this register will look. Nothing here is saved, and your fleet data isn’t touched.</div></div>`
        : missing()
          ? `<div class="sample-note">${I.alert}<div><b>Not set up yet.</b> The table for this register hasn’t been created in Supabase. Run <code>${esc(reg.setupFile)}</code> in the Supabase SQL Editor, then refresh.</div></div>`
          : '';
      const addBtn = reg.add ? `<button class="btn btn-primary" id="reg-add"${missing() ? ' disabled' : ''}>${I.plus} ${esc(reg.add.label)}</button>` : '';
      root.innerHTML = `
        ${pageHeader({ title: reg.title, sub: reg.summary(all), actions: addBtn })}
        ${note}
        <div class="toolbar">
          <div class="search">${I.search}<input type="search" id="reg-q" placeholder="Search ${esc(reg.noun)}s" aria-label="Search ${esc(reg.noun)}s" value="${esc(q)}"></div>
          <select id="reg-filter" aria-label="Filter">${options(opts, pick, reg.filter.label)}</select>
          <span class="count" id="reg-count"></span>
        </div>
        <div class="table-wrap"><table class="data reg-table">
          <thead id="reg-head"></thead>
          <tbody id="reg-body"></tbody>
        </table></div>`;
      root.querySelector('#reg-q').addEventListener('input', (e) => { q = e.target.value; table(); });
      root.querySelector('#reg-filter').addEventListener('change', (e) => { pick = e.target.value; table(); });
      const add = root.querySelector('#reg-add');
      if (add) add.onclick = () => reg.add.open(() => draw());
      table();
    }

    AD.views[reg.route] = {
      title: reg.title,
      render(el) { root = el; q = ''; pick = ''; draw(); },
      // Background data refresh: redraw but keep the search and filter.
      refresh: () => root && draw()
    };
  });
})();
