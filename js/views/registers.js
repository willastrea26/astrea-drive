/*
 * Employee, equipment and technology registers — listed under the
 * "Registers" heading in the sidebar.
 *
 * SAMPLE DATA ONLY. Each page shows made-up rows for a fictional Sydney
 * civil / surveying / locating company ("Ironbark Civil & Survey") so the
 * layout can be reviewed before real columns are agreed. Nothing here is
 * read from or written to Supabase — the rows live only in this file. Once
 * the columns are signed off, each register gets its own table and an
 * add/edit form in the same pattern as power-tools.js, and this sample
 * data is removed.
 */
AD.views = AD.views || {};

(function () {
  const COMPANY = 'Ironbark Civil & Survey';

  // Dates relative to today, so "due soon" / "overdue" always look realistic.
  const day = (offset) => AD.time.addDays(AD.time.todayKey(), offset);

  /** "12/03/2027" with a coloured flag underneath when it needs attention. */
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

  // ------------------------------------------------------------------ data
  // All names, numbers and serials below are made up.
  const EMPLOYEES = () => [
    { id: 'EMP-001', name: 'Liam Carter', role: 'Site supervisor', team: 'Civil', phone: '0491 570 156', licence: 'HR', licenceExpiry: day(410), tickets: 'White card · First aid · Confined space', start: day(-2210), status: 'Active' },
    { id: 'EMP-002', name: 'Daniel Rossi', role: 'Excavator operator', team: 'Civil', phone: '0491 570 157', licence: 'HR', licenceExpiry: day(18), tickets: 'White card · Excavator (CN) · Traffic control', start: day(-1340), status: 'Active' },
    { id: 'EMP-003', name: 'Ben O’Connor', role: 'Pipe layer', team: 'Civil', phone: '0491 570 158', licence: 'MR', licenceExpiry: day(-6), tickets: 'White card · Confined space · Gas test atmospheres', start: day(-480), status: 'Active' },
    { id: 'EMP-004', name: 'Priya Nair', role: 'Registered surveyor', team: 'Survey', phone: '0491 570 159', licence: 'C', licenceExpiry: day(1290), tickets: 'White card · First aid', start: day(-3050), status: 'Active' },
    { id: 'EMP-005', name: 'Josh Whitfield', role: 'Survey technician', team: 'Survey', phone: '0491 570 110', licence: 'C', licenceExpiry: day(640), tickets: 'White card · Working at heights · Drone (RePL)', start: day(-720), status: 'On leave' },
    { id: 'EMP-006', name: 'Mia Tanaka', role: 'Utility locator', team: 'Locating', phone: '0491 570 313', licence: 'C', licenceExpiry: day(220), tickets: 'White card · Certified locator · Traffic control', start: day(-910), status: 'Active' },
    { id: 'EMP-007', name: 'Sam Haddad', role: 'Utility locator', team: 'Locating', phone: '0491 570 737', licence: 'MR', licenceExpiry: day(27), tickets: 'White card · Certified locator', start: day(-60), status: 'Inducting' },
    { id: 'EMP-008', name: 'Sophie Kim', role: 'Project coordinator', team: 'Office', phone: '0491 571 266', licence: 'C', licenceExpiry: day(880), tickets: 'White card', start: day(-1500), status: 'Active' }
  ];

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

  // ------------------------------------------------------------ registers
  const EMP_TONE = { Active: 'green', 'On leave': 'amber ring', Inducting: 'blue' };
  const EQ_TONE = { 'In service': 'aqua', 'Under repair': 'violet', 'Out of service': 'red' };
  const IT_TONE = { 'In use': 'blue', Spare: 'aqua', 'In repair': 'violet', Retired: 'grey muted' };
  const or = (v) => (v ? AD.ui.esc(v) : AD.ui.dash);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  const REGISTERS = [
    {
      route: 'employee-register', title: 'Employee register', noun: 'employee',
      rows: EMPLOYEES, groupBy: 'team', groupOrder: ['Civil', 'Survey', 'Locating', 'Office'],
      search: ['id', 'name', 'role', 'team', 'phone', 'tickets'],
      summary: (rows) => {
        const lic = rows.filter((r) => dueState(r.licenceExpiry) !== 'ok').length;
        return `${rows.length} staff · ${rows.filter((r) => r.status === 'Active').length} active${lic ? ` · <span class="flag flag-amber">${plural(lic, 'licence')} expiring or expired</span>` : ''}`;
      },
      cols: [
        { head: 'Employee', width: 200, cell: (r) => `<span class="id">${AD.ui.esc(r.name)}</span><span class="t2">${AD.ui.esc(r.id)}</span>` },
        { head: 'Role', width: 180, cell: (r) => AD.ui.esc(r.role) },
        { head: 'Phone', width: 130, cls: 'col-opt nowrap', cell: (r) => or(r.phone) },
        { head: 'Licence', width: 150, cls: 'col-opt', cell: (r) => `<b>${AD.ui.esc(r.licence)}</b> class<span class="t2">${dueCell(r.licenceExpiry, { past: (n) => `Expired ${n}d ago`, future: 'Expires in' })}</span>` },
        { head: 'Tickets & inductions', cls: 'col-opt col-wide', cell: (r) => AD.ui.esc(r.tickets) },
        { head: 'Started', width: 110, cls: 'col-opt col-wide nowrap', cell: (r) => AD.time.fmtKey(r.start) },
        { head: 'Status', width: 120, cell: (r) => AD.ui.badge(r.status, EMP_TONE[r.status] || 'grey') }
      ]
    },
    {
      route: 'equipment-register', title: 'Equipment register', noun: 'item',
      rows: EQUIPMENT, groupBy: 'category', groupOrder: ['Surveying', 'Locating', 'Civil', 'Safety', 'Traffic control'],
      search: ['id', 'name', 'category', 'make', 'serial', 'location', 'assignedTo'],
      summary: (rows) => {
        const over = rows.filter((r) => dueState(r.nextInspection) === 'overdue').length;
        const soon = rows.filter((r) => dueState(r.nextInspection) === 'soon').length;
        return `${rows.length} items${over ? ` · <span class="flag flag-red">${over} overdue for inspection</span>` : ''}${soon ? ` · <span class="flag flag-amber">${soon} due within 30 days</span>` : ''}`;
      },
      cols: [
        { head: 'Item', width: 230, cell: (r) => `<span class="id">${AD.ui.esc(r.name)}</span><span class="t2">${AD.ui.esc(r.id)}</span>` },
        { head: 'Make / model', width: 200, cls: 'col-opt', cell: (r) => AD.ui.esc(r.make) },
        { head: 'Serial #', width: 140, cls: 'col-opt col-wide', cell: (r) => AD.ui.esc(r.serial) },
        { head: 'Location', cls: 'col-opt', cell: (r) => AD.ui.esc(r.location) },
        { head: 'Assigned to', width: 150, cls: 'col-opt col-wide', cell: (r) => r.assignedTo ? AD.ui.esc(r.assignedTo) : '<span class="muted">Depot pool</span>' },
        { head: 'Status', width: 140, cell: (r) => AD.ui.badge(r.status, EQ_TONE[r.status] || 'grey') },
        { head: 'Inspection / calibration', width: 170, cell: (r) => dueCell(r.nextInspection) }
      ]
    },
    {
      route: 'technology-register', title: 'Technology register', noun: 'device',
      rows: TECHNOLOGY, groupBy: 'type', groupOrder: ['Laptop', 'Tablet', 'Phone', 'Field controller', 'Drone', 'Site internet'],
      search: ['id', 'type', 'make', 'serial', 'assignedTo', 'phone'],
      summary: (rows) => {
        const w = rows.filter((r) => dueState(r.warranty) === 'soon').length;
        return `${rows.length} devices · ${rows.filter((r) => r.status === 'In use').length} in use${w ? ` · <span class="flag flag-amber">${w} warrant${w === 1 ? 'y' : 'ies'} ending within 30 days</span>` : ''}`;
      },
      cols: [
        { head: 'Device', width: 240, cell: (r) => `<span class="id">${AD.ui.esc(r.make)}</span><span class="t2">${AD.ui.esc(r.id)}</span>` },
        { head: 'Serial / IMEI', width: 200, cls: 'col-opt', cell: (r) => AD.ui.esc(r.serial) },
        { head: 'Assigned to', width: 160, cell: (r) => r.assignedTo ? AD.ui.esc(r.assignedTo) : '<span class="muted">Unassigned</span>' },
        { head: 'Mobile number', width: 140, cls: 'col-opt nowrap', cell: (r) => or(r.phone) },
        { head: 'Purchased', width: 110, cls: 'col-opt col-wide nowrap', cell: (r) => AD.time.fmtKey(r.purchased) },
        { head: 'Warranty', width: 150, cls: 'col-opt', cell: (r) => dueCell(r.warranty, { past: (n) => `Ended ${n}d ago`, future: 'Ends in' }) },
        { head: 'Status', width: 120, cell: (r) => AD.ui.badge(r.status, IT_TONE[r.status] || 'grey') }
      ]
    }
  ];

  // --------------------------------------------------------------- render
  REGISTERS.forEach((reg) => {
    let root = null, q = '', group = '';

    function table() {
      const { esc } = AD.ui;
      const all = reg.rows();
      const needle = q.trim().toLowerCase();
      const list = all.filter((r) => (!group || r[reg.groupBy] === group)
        && (!needle || reg.search.some((k) => String(r[k] || '').toLowerCase().includes(needle))));
      const groups = reg.groupOrder.concat([...new Set(list.map((r) => r[reg.groupBy]))].filter((g) => !reg.groupOrder.includes(g)));
      const colspan = reg.cols.length;
      const body = groups.map((g) => {
        const rows = list.filter((r) => r[reg.groupBy] === g);
        if (!rows.length) return '';
        return `<tr class="fleet-group-row"><th colspan="${colspan}"><span>${esc(g)}</span><small>${plural(rows.length, reg.noun)}</small></th></tr>`
          + rows.map((r) => `<tr>${reg.cols.map((c) => `<td class="${c.cls || ''}">${c.cell(r)}</td>`).join('')}</tr>`).join('');
      }).join('');
      root.querySelector('#reg-count').textContent = `${list.length} of ${plural(all.length, reg.noun)}`;
      root.querySelector('#reg-body').innerHTML = body || `<tr><td colspan="${colspan}" class="empty">No ${reg.noun}s match these filters.</td></tr>`;
    }

    AD.views[reg.route] = {
      title: reg.title,
      render(el) {
        const { esc, pageHeader, options } = AD.ui;
        const I = AD.icons;
        root = el; q = ''; group = '';
        const all = reg.rows();
        const groupNames = reg.groupOrder.filter((g) => all.some((r) => r[reg.groupBy] === g));
        el.innerHTML = `
          ${pageHeader({ title: reg.title, sub: reg.summary(all) })}
          <div class="sample-note">${I.alert}<div><b>Sample data.</b> These rows are made up for a fictional company, ${esc(COMPANY)}, so you can see how this register will look. Nothing here is saved, and your fleet data isn’t touched.</div></div>
          <div class="toolbar">
            <div class="search">${I.search}<input type="search" id="reg-q" placeholder="Search ${esc(reg.noun)}s" aria-label="Search ${esc(reg.noun)}s"></div>
            <select id="reg-group" aria-label="Filter by group">${options(groupNames, '', 'All groups')}</select>
            <span class="count" id="reg-count"></span>
          </div>
          <div class="table-wrap"><table class="data reg-table">
            <thead><tr>${reg.cols.map((c) => `<th class="${c.cls || ''}"${c.width ? ` style="width:${c.width}px"` : ''}>${esc(c.head)}</th>`).join('')}</tr></thead>
            <tbody id="reg-body"></tbody>
          </table></div>`;
        el.querySelector('#reg-q').addEventListener('input', (e) => { q = e.target.value; table(); });
        el.querySelector('#reg-group').addEventListener('change', (e) => { group = e.target.value; table(); });
        table();
      }
    };
  });
})();
