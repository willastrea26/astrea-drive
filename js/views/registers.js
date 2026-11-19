/*
 * Employee, equipment and technology registers — listed under the
 * "Registers" heading in the sidebar. All three share one table renderer.
 *
 * Employee register: REAL data from the Supabase "employees" table
 * (supabase/create-employees.sql), with add / edit / remove. Staff details
 * are never kept in this file or anywhere else in the repository.
 *
 * Technology register: REAL data from the Supabase "tech_devices" table
 * (supabase/create-tech-devices.sql). Devices are assigned to employees, and
 * each employee's profile lists the devices they hold.
 *
 * Equipment register: REAL data from the Supabase "equipment" table
 * (supabase/create-equipment.sql). Items are assigned to employees (or left in
 * the depot pool), and each employee's profile lists the equipment they hold.
 *
 * Both the technology and equipment registers show read-only SAMPLE rows
 * (defined here, never saved) until their first real record is added.
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
  // Teams the employee register is grouped by. Each person's team is worked
  // out from their position (TEAM_RULES, first match wins) unless the Edit
  // form sets it explicitly — so new starters land in the right group with
  // no extra data entry, and anyone who doesn't fit the rule can be moved.
  const TEAMS = ['Management', 'Surveying', 'Locating', 'Vac trucks', 'Civil', 'Design & drafting', 'Workshop', 'Office'];
  const TEAM_RULES = [
    [/managing director|operations manager/i, 'Management'],
    [/survey|spatial/i, 'Surveying'],
    [/\blocat/i, 'Locating'], // word start, so "Resource Allocator" isn't a locator
    [/vac truck/i, 'Vac trucks'],
    [/civil|engineer|labourer|dilapidation|pipe ?layer|plant operator|excavator/i, 'Civil'],
    [/draft|revit|design|\bcad\b/i, 'Design & drafting'],
    [/mechanic|workshop|fitter/i, 'Workshop'],
    [/account|assistant|coordinator|bid|business development|allocator|admin|reception|payroll|office/i, 'Office']
  ];
  const teamFor = (position) => (TEAM_RULES.find(([re]) => re.test(position || '')) || [])[1] || '';
  const teamOf = (r) => r.team || teamFor(r.position) || 'Unassigned';
  // ---- Licence & ticket expiry ---------------------------------------------
  // Expiry dates live in licenceExpiries: { "<licence name>": "YYYY-MM-DD" }.
  // A licence with no date simply doesn't expire (e.g. a White Card).
  const LIC_SOON_DAYS = 60; // same warning window the Dashboard uses for rego renewals
  /** Every licence this person holds, with its expiry state:
   *  'expired' | 'soon' (within LIC_SOON_DAYS) | 'ok' | 'none' (no expiry recorded). */
  function licenceStates(r) {
    const exp = r && r.licenceExpiries && typeof r.licenceExpiries === 'object' ? r.licenceExpiries : {};
    const today = AD.time.todayKey();
    return listOf(r && r.licenceRegister).map((name) => {
      const expiry = exp[name] ? String(exp[name]).slice(0, 10) : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return { name, expiry: '', state: 'none', days: null };
      const days = AD.time.daysBetween(today, expiry);
      return { name, expiry, days, state: days < 0 ? 'expired' : days <= LIC_SOON_DAYS ? 'soon' : 'ok' };
    });
  }
  /** Licences that need attention, most urgent first. */
  const licenceIssues = (r) => licenceStates(r).filter((l) => l.state === 'expired' || l.state === 'soon').sort((a, b) => a.days - b.days);
  /** "Expired 6d ago" / "Expires in 18d" / "Expires today". */
  const licenceRel = (l) => (l.days < 0 ? `Expired ${-l.days}d ago` : l.days === 0 ? 'Expires today' : `Expires in ${l.days}d`);
  const LIC_TONE = { expired: 'red', soon: 'amber' };

  // Shared with the employee profile page (employee.js) and the Dashboard.
  AD.employees = { TEAMS, teamFor, teamOf, listOf, licenceStates, licenceIssues, licenceRel, LIC_SOON_DAYS, LIC_TONE };

  /** Small round photo for register rows (like the fleet's vehicle thumbnails);
   *  initials when no photo has been added yet. */
  const initialsOf = (name) => String(name || '?').trim().split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const empThumb = (r) => `<span class="emp-thumb" aria-hidden="true">${r.photo ? `<img src="${esc(r.photo)}" alt="" loading="lazy">` : esc(initialsOf(r.name))}</span>`;

  /** Insert/update an employee. Columns added by later SQL files (team,
   *  licence expiry dates) may not exist yet — if the database rejects one,
   *  save everything else and say which SQL file to run. */
  const LATER_COLUMNS = [
    ['team', 'supabase/create-employees.sql'],
    ['licenceExpiries', 'supabase/create-employee-documents.sql']
  ];
  async function saveEmployee(fn, rec) {
    try {
      return await fn(rec);
    } catch (e) {
      const msg = String((e && (e.message || e.details || e.hint)) || e);
      if (!/pgrst204|42703|schema cache|could not find/i.test(msg)) throw e;
      const missing = LATER_COLUMNS.filter(([col]) => col in rec && msg.toLowerCase().includes(col.toLowerCase()));
      const strip = missing.length ? missing : LATER_COLUMNS.filter(([col]) => col in rec);
      if (!strip.length) throw e;
      const rest = Object.assign({}, rec);
      strip.forEach(([col]) => delete rest[col]);
      AD.ui.toast(`Saved, but some details couldn’t be stored yet — run ${[...new Set(strip.map(([, file]) => file))].join(' and ')} in the Supabase SQL Editor.`, 'error');
      return fn(rest);
    }
  }

  /** Suggestions for the licence name box: everything already used across the
   *  register first (so names stay consistent), then common civil tickets. */
  const COMMON_LICENCES = ['White Card', 'C Licence', 'LR Licence', 'MR Licence', 'HR Licence', 'HC Licence', 'First Aid', 'CPR', 'Confined Space Card', 'Gas Test Atmospheres', 'Working at Heights', 'RIW Card', 'Traffic Control', 'Working With Children Check', 'EWP Yellow Card', 'Forklift Licence', 'BYDA Certified Locator', 'Drone (RePL)'];
  const licenceSuggestions = () => [...new Set(AD.store.all('employees').flatMap((r) => listOf(r.licenceRegister)).concat(COMMON_LICENCES))].sort((a, b) => a.localeCompare(b));

  /** Add / edit an employee. Pass null to add. */
  AD.employeeForm = function (emp, onSaved) {
    const { formData, showErrors, modal, toast, confirm } = AD.ui;
    const isNew = !emp;
    const e = emp || { name: '', team: '', licencesApplied: '', position: '', mobile: '', email: '', dateOfBirth: '', startDate: '', address: '', suburb: '', state: 'NSW', postcode: '', licenceRegister: '' };
    const dateVal = (v) => (v ? esc(String(v).slice(0, 10)) : '');
    const autoLabel = (position) => `Automatic — ${teamFor(position) || 'Unassigned'}`;
    // One editable row per licence: name (with suggestions) + optional expiry date.
    const licRow = (name = '', expiry = '') => `<div class="lic-row">
        <input type="text" class="lic-name" list="lic-names" value="${esc(name)}" placeholder="e.g. HR Licence" aria-label="Licence, ticket or card">
        <input type="date" class="lic-exp" value="${esc(expiry)}" aria-label="Expiry date">
        <button type="button" class="btn btn-ghost btn-sm lic-del" title="Remove" aria-label="Remove this licence">${AD.icons.x}</button>
      </div>`;

    modal({
      title: isNew ? 'Add employee' : `Edit ${e.name}`,
      wide: true,
      body: `
        <form class="form-grid" novalidate>
          <div class="form-section-title full"><b>Employee</b><span>Name, role and contact details</span></div>
          <div class="field"><label>Name <span class="req">*</span></label><input type="text" name="name" value="${esc(e.name)}"></div>
          <div class="field"><label>Position</label><input type="text" name="position" value="${esc(e.position)}"></div>
          <div class="field"><label>Team</label><select name="team">${AD.ui.options(TEAMS, e.team || '', autoLabel(e.position))}</select>
            <div class="help">Leave on Automatic to group by position, or pick a team to override it.</div></div>
          <div class="field"><label>Mobile phone</label><input type="text" name="mobile" value="${esc(e.mobile)}" inputmode="tel"></div>
          <div class="field"><label>Email</label><input type="email" name="email" value="${esc(e.email)}"></div>
          <div class="field"><label>Date of birth</label><input type="date" name="dateOfBirth" value="${dateVal(e.dateOfBirth)}"></div>
          <div class="field"><label>Date of commencement</label><input type="date" name="startDate" value="${dateVal(e.startDate)}"></div>
          <div class="form-section-title full"><b>Address</b><span>Home address</span></div>
          <div class="field full"><label>Street address</label><input type="text" name="address" value="${esc(e.address)}"></div>
          <div class="field"><label>Suburb</label><input type="text" name="suburb" value="${esc(e.suburb)}"></div>
          <div class="field"><label>State</label><input type="text" name="state" value="${esc(e.state)}" maxlength="3"></div>
          <div class="field"><label>Postcode</label><input type="text" name="postcode" value="${esc(e.postcode)}" maxlength="4" inputmode="numeric"></div>
          <div class="form-section-title full"><b>Licences & tickets</b><span>Add an expiry date to be warned ${LIC_SOON_DAYS} days before it runs out. Leave it blank if it doesn’t expire.</span></div>
          <div class="field"><label>Licences applied</label><input type="text" name="licencesApplied" value="${esc(e.licencesApplied)}" placeholder="e.g. Full, Mobility"></div>
          <div class="field full lic-editor">
            <div class="lic-head" aria-hidden="true"><span>Licence, ticket or card</span><span>Expiry date</span><span></span></div>
            <div id="lic-rows">${licenceStates(e).map((l) => licRow(l.name, l.expiry)).join('')}</div>
            <button type="button" class="btn btn-ghost btn-sm lic-add" id="lic-add">${AD.icons.plus} Add licence or ticket</button>
            <datalist id="lic-names">${licenceSuggestions().map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
          </div>
        </form>
        <div class="form-actions">
          ${isNew ? '' : '<button class="btn btn-danger-ghost" data-remove type="button" style="margin-right:auto">Remove</button>'}
          <button class="btn btn-ghost" data-close type="button">Cancel</button>
          <button class="btn btn-primary" data-save type="button">${isNew ? 'Add employee' : 'Save changes'}</button>
        </div>`,
      onMount(el, close) {
        const form = el.querySelector('form');
        el.querySelector('[data-close]').onclick = close;
        // Keep the "Automatic — <team>" option in step with the position typed.
        form.elements.position.addEventListener('input', () => {
          form.elements.team.options[0].textContent = autoLabel(form.elements.position.value);
        });
        // Licence rows: add / remove; always leave one row to type into.
        const licRows = el.querySelector('#lic-rows');
        const addLic = (focus) => {
          licRows.insertAdjacentHTML('beforeend', licRow());
          if (focus) licRows.lastElementChild.querySelector('.lic-name').focus();
        };
        if (!licRows.children.length) addLic(false);
        el.querySelector('#lic-add').onclick = () => addLic(true);
        licRows.addEventListener('click', (ev) => {
          const del = ev.target.closest('.lic-del');
          if (!del) return;
          del.closest('.lic-row').remove();
          if (!licRows.children.length) addLic(false);
        });
        const removeBtn = el.querySelector('[data-remove]');
        if (removeBtn) removeBtn.onclick = async () => {
          const docs = AD.store.all('employee_documents').filter((d) => d.employeeId === e.id);
          const docNote = docs.length ? ` and their ${docs.length} stored document${docs.length === 1 ? '' : 's'}` : '';
          // Offboarding check: devices and equipment still assigned to them need collecting.
          const devs = AD.store.all('tech_devices').filter((d) => d.employeeId === e.id);
          const gear = AD.store.all('equipment').filter((x) => x.employeeId === e.id);
          const held = devs.map((d) => d.make).concat(gear.map((x) => x.name));
          const devNote = held.length
            ? `<br><br><b>They still have ${held.length} item${held.length === 1 ? '' : 's'}:</b> ${held.map(esc).join(', ')}. ${held.length === 1 ? 'It' : 'They'}’ll become unassigned in the registers — make sure ${held.length === 1 ? 'it’s' : 'they’re'} collected.`
            : '';
          const ok = await confirm({ title: `Remove ${e.name}?`, message: `This permanently deletes their record from the employee register${docNote}. It can’t be undone.${devNote}`, confirmText: 'Remove', danger: true });
          if (!ok) return;
          try {
            // Files first, so personal documents never outlive the record.
            for (const d of docs) await AD.store.removeEmployeeDocument(d);
            await AD.store.remove('employees', e.id);
            // The database unassigns their devices and equipment (on delete set null); mirror that locally.
            devs.concat(gear).forEach((d) => { d.employeeId = null; });
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
          // Collect licence rows: skip blanks, merge repeats (keeping the first
          // expiry given). Commas would split a name in the stored list, so drop them.
          const licences = [], licenceExpiries = {};
          el.querySelectorAll('.lic-row').forEach((row) => {
            const name = row.querySelector('.lic-name').value.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
            const exp = row.querySelector('.lic-exp').value;
            if (!name) return;
            if (!licences.includes(name)) licences.push(name);
            if (exp && !licenceExpiries[name]) licenceExpiries[name] = exp;
          });
          const rec = {
            name: d.name, team: d.team, position: d.position, mobile: d.mobile, email: d.email,
            dateOfBirth: d.dateOfBirth || null, startDate: d.startDate || null,
            address: d.address, suburb: d.suburb, state: d.state.toUpperCase(), postcode: d.postcode,
            licencesApplied: tidyList(d.licencesApplied), licenceRegister: licences.join(', '), licenceExpiries
          };
          saveBtn.disabled = true;
          let saved;
          try {
            if (isNew) {
              saved = await saveEmployee((r) => AD.store.insert('employees', r, 'EMP'), rec);
              await AD.store.log(`${rec.name} added to the employee register`);
              toast(`${rec.name} added`);
            } else {
              saved = await saveEmployee((r) => AD.store.update('employees', e.id, r), rec);
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

  // ========================================================= equipment register
  // Real data from the Supabase "equipment" table (create-equipment.sql). Each
  // item can be assigned to someone from the Employee register, so it also
  // shows on that person's profile (employee.js), and has its own profile
  // page (equipment.js).
  const EQ_CATEGORIES = ['Surveying', 'Locating', 'Civil', 'Safety', 'Traffic control', 'Other'];
  const EQ_STATUSES = ['In service', 'Under repair', 'Out of service'];
  const EQ_TONE = { 'In service': 'aqua', 'Under repair': 'violet', 'Out of service': 'red' };
  const INSPECT_SOON_DAYS = 30;

  /** Sample items that have someone are assigned to REAL staff from the
   *  Employee register: a person from the matching team (survey gear to
   *  surveyors, locating gear to locators, civil / safety / traffic gear to
   *  the Civil team), spread across different people. Nothing is saved —
   *  it just means the samples show, and "Edit" pre-fills, people you
   *  actually have. With no staff loaded, the made-up names stay. */
  const SAMPLE_TEAM = { Surveying: 'Surveying', Locating: 'Locating', Civil: 'Civil', Safety: 'Civil', 'Traffic control': 'Civil' };
  function withRealAssignees(items) {
    const staff = AD.store.all('employees').slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
    if (!staff.length) return items;
    const used = {};
    return items.map((x) => {
      if (!x.sampleAssignee) return x;
      const team = SAMPLE_TEAM[x.category] || '';
      const inTeam = staff.filter((e) => teamOf(e) === team);
      const pool = inTeam.length ? inTeam : staff;
      const n = used[team] || 0;
      used[team] = n + 1;
      const { sampleAssignee, ...rest } = x;
      return Object.assign(rest, { employeeId: pool[n % pool.length].id });
    });
  }

  // SAMPLE EQUIPMENT — shown ONLY while the register has no real items (same
  // rules as the sample devices): never written to Supabase, labelled, and gone
  // as soon as the first real item is added. Item names, numbers and serials
  // are made up; the people are mapped onto real staff (withRealAssignees).
  const SAMPLE_EQUIPMENT = () => withRealAssignees([
    { id: 'sample-SUR-01', sample: true, assetTag: 'SUR-01', name: 'GNSS rover', category: 'Surveying', make: 'Trimble R12i', serial: '6143R00217', location: 'Wetherill Park depot', sampleAssignee: { name: 'Priya Nair', position: 'Registered surveyor' }, status: 'In service', lastInspection: day(-291), nextInspection: day(74), notes: 'Annual calibration with the Trimble dealer.' },
    { id: 'sample-SUR-02', sample: true, assetTag: 'SUR-02', name: 'Robotic total station', category: 'Surveying', make: 'Leica TS16', serial: '1873402', location: 'Site — Parramatta Rd, Granville', sampleAssignee: { name: 'Josh Whitfield', position: 'Survey technician' }, status: 'In service', lastInspection: day(-353), nextInspection: day(12), notes: '' },
    { id: 'sample-SUR-03', sample: true, assetTag: 'SUR-03', name: 'Rotating laser level', category: 'Surveying', make: 'Topcon RL-H5A', serial: 'TP-55120', location: 'Wetherill Park depot', sampleAssignee: null, status: 'Under repair', lastInspection: day(-374), nextInspection: day(-9), notes: 'Dropped on site — sent for repair and recalibration.' },
    { id: 'sample-LOC-01', sample: true, assetTag: 'LOC-01', name: 'Cable & pipe locator', category: 'Locating', make: 'Radiodetection RD8200', serial: 'RD-8200-41187', location: 'Ute UTE-04', sampleAssignee: { name: 'Mia Tanaka', position: 'Utility locator' }, status: 'In service', lastInspection: day(-205), nextInspection: day(160), notes: '' },
    { id: 'sample-LOC-02', sample: true, assetTag: 'LOC-02', name: 'Ground penetrating radar', category: 'Locating', make: 'Leica DS2000', serial: 'DS2-00938', location: 'Site — Church St, Ryde', sampleAssignee: { name: 'Sam Haddad', position: 'Utility locator' }, status: 'In service', lastInspection: day(-340), nextInspection: day(25), notes: '' },
    { id: 'sample-LOC-03', sample: true, assetTag: 'LOC-03', name: 'Sewer inspection camera', category: 'Locating', make: 'Envirosight ROVVER X', serial: 'RVX-2291', location: 'Wetherill Park depot', sampleAssignee: null, status: 'In service', lastInspection: day(-162), nextInspection: day(203), notes: '' },
    { id: 'sample-CIV-01', sample: true, assetTag: 'CIV-01', name: 'Trench shield (3.0 m)', category: 'Civil', make: 'Aluminium box shield', serial: 'TS-3000-07', location: 'Site — Parramatta Rd, Granville', sampleAssignee: { name: 'Liam Carter', position: 'Site supervisor' }, status: 'In service', lastInspection: day(-132), nextInspection: day(48), notes: '' },
    { id: 'sample-SAF-01', sample: true, assetTag: 'SAF-01', name: '4-gas detector', category: 'Safety', make: 'Honeywell BW MicroClip X3', serial: 'MCX3-60814', location: 'Ute UTE-02', sampleAssignee: { name: 'Ben O’Connor', position: 'Pipe layer' }, status: 'In service', lastInspection: day(-183), nextInspection: day(-3), notes: 'Bump test before every confined space entry.' },
    { id: 'sample-SAF-02', sample: true, assetTag: 'SAF-02', name: 'Confined space tripod & winch', category: 'Safety', make: 'Tripod rescue kit', serial: 'CS-TRI-114', location: 'Wetherill Park depot', sampleAssignee: null, status: 'Out of service', lastInspection: day(-406), nextInspection: day(-41), notes: 'Tagged out — winch cable frayed. Do not use.' },
    { id: 'sample-TRF-01', sample: true, assetTag: 'TRF-01', name: 'Variable message sign trailer', category: 'Traffic control', make: 'Solar VMS trailer', serial: 'VMS-0452', location: 'Site — Church St, Ryde', sampleAssignee: null, status: 'In service', lastInspection: day(-89), nextInspection: day(96), notes: '' }
  ]);
  const showingSampleEquipment = () => !AD.store.all('equipment').length;
  const sampleEquipment = (id) => (showingSampleEquipment() ? SAMPLE_EQUIPMENT().find((x) => x.id === id) || null : null);
  const equipmentFor = (employeeId) => AD.store.all('equipment').filter((x) => x.employeeId === employeeId);
  /** "Edit" on a sample item: sample items aren't stored anywhere, so this opens
   *  the Add form pre-filled with the sample's details; saving creates a real
   *  item. The sample's made-up person isn't carried over (they aren't in the
   *  Employee register), so who has it is chosen afresh. */
  function editSampleEquipment(x, onSaved) {
    if (!AD.store.available('equipment')) {
      AD.ui.toast('Run supabase/create-equipment.sql in the Supabase SQL Editor first — then items can be saved.', 'error');
      return;
    }
    // Keep the (real) person the sample is mapped to; a made-up one isn't carried over.
    const { id, sample, sampleAssignee, assignee, ...fields } = x;
    const keep = fields.employeeId && AD.store.get('employees', fields.employeeId) ? fields.employeeId : '';
    AD.equipmentForm(null, onSaved, Object.assign({}, fields, { employeeId: keep, fromSample: true }));
  }

  AD.equipment = { EQ_CATEGORIES, EQ_STATUSES, EQ_TONE, INSPECT_SOON_DAYS, equipmentFor, sampleEquipment, editSample: editSampleEquipment };

  /** Add / edit an equipment item. Pass null to add; `preset` pre-fills a new
   *  one (e.g. { employeeId } when adding from an employee's profile). */
  AD.equipmentForm = function (item, onSaved, preset = {}) {
    const { formData, showErrors, modal, toast, confirm, options } = AD.ui;
    const isNew = !item;
    const x = item || Object.assign({ name: '', category: 'Surveying', make: '', assetTag: '', serial: '', location: '', employeeId: '', status: 'In service', lastInspection: '', nextInspection: '', notes: '' }, preset);
    const dateVal = (v) => (v ? esc(String(v).slice(0, 10)) : '');
    const people = AD.store.all('employees').slice().sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .map((p) => [p.id, p.position ? `${p.name} — ${p.position}` : p.name]);

    modal({
      title: x.fromSample ? `Edit ${x.name || 'equipment'}` : isNew ? 'Add equipment' : `Edit ${x.name || 'equipment'}`,
      wide: true,
      body: `
        ${x.fromSample ? `<div class="sample-note">${AD.icons.alert}<div><b>This is a sample item.</b> Saving adds it to your equipment register as a <b>real item</b> — check the details match your actual equipment and who has it. Once you’ve saved your first real item, the other sample items are hidden.</div></div>` : ''}
        <form class="form-grid" novalidate>
          <div class="form-section-title full"><b>Item</b><span>What it is and how to identify it</span></div>
          <div class="field"><label>Item <span class="req">*</span></label><input type="text" name="name" value="${esc(x.name)}" placeholder="e.g. GNSS rover"></div>
          <div class="field"><label>Category</label><select name="category">${options(EQ_CATEGORIES, x.category || 'Other')}</select></div>
          <div class="field"><label>Make / model</label><input type="text" name="make" value="${esc(x.make)}" placeholder="e.g. Trimble R12i"></div>
          <div class="field"><label>Asset tag</label><input type="text" name="assetTag" value="${esc(x.assetTag)}" placeholder="e.g. SUR-01">
            <div class="help">Your own label for it, if you use one.</div></div>
          <div class="field"><label>Serial number</label><input type="text" name="serial" value="${esc(x.serial)}"></div>
          <div class="field"><label>Status</label><select name="status">${options(EQ_STATUSES, x.status || 'In service')}</select></div>
          <div class="form-section-title full"><b>Where it is and who has it</b><span>Assign it to someone from the Employee register, or leave it in the depot pool</span></div>
          <div class="field"><label>Assigned to</label><select name="employeeId">${options(people, x.employeeId || '', 'Depot pool (not assigned)')}</select></div>
          <div class="field"><label>Location</label><input type="text" name="location" value="${esc(x.location)}" placeholder="e.g. Wetherill Park depot, a site, or a ute"></div>
          <div class="form-section-title full"><b>Inspection & calibration</b><span>Items due within ${INSPECT_SOON_DAYS} days are flagged amber, overdue red</span></div>
          <div class="field"><label>Last inspection</label><input type="date" name="lastInspection" value="${dateVal(x.lastInspection)}"></div>
          <div class="field"><label>Next inspection / calibration</label><input type="date" name="nextInspection" value="${dateVal(x.nextInspection)}"></div>
          <div class="field full"><label>Notes</label><textarea name="notes" rows="2">${esc(x.notes)}</textarea></div>
        </form>
        <div class="form-actions">
          ${isNew ? '' : '<button class="btn btn-danger-ghost" data-remove type="button" style="margin-right:auto">Remove</button>'}
          <button class="btn btn-ghost" data-close type="button">Cancel</button>
          <button class="btn btn-primary" data-save type="button">${x.fromSample ? 'Save as real item' : isNew ? 'Add equipment' : 'Save changes'}</button>
        </div>`,
      onMount(el, close) {
        const form = el.querySelector('form');
        el.querySelector('[data-close]').onclick = close;
        const removeBtn = el.querySelector('[data-remove]');
        if (removeBtn) removeBtn.onclick = async () => {
          const ok = await confirm({ title: `Remove ${x.name || 'this item'}?`, message: 'This permanently deletes it from the equipment register. It can’t be undone. (To keep a record of an item that’s been tagged out, set its status to Out of service instead.)', confirmText: 'Remove', danger: true });
          if (!ok) return;
          try {
            await AD.store.remove('equipment', x.id);
            await AD.store.log(`${x.name || 'Item'} removed from the equipment register`);
            toast(`${x.name || 'Item'} removed`);
          } catch (err) { toast('Could not remove item: ' + err.message, 'error'); return; }
          close();
          onSaved && onSaved(null);
        };
        const saveBtn = el.querySelector('[data-save]');
        saveBtn.onclick = async () => {
          const d = formData(form);
          const err = {};
          if (!d.name) err.name = 'Item is required.';
          if (!showErrors(form, err)) return;
          const rec = {
            name: d.name, category: d.category, make: d.make, assetTag: d.assetTag, serial: d.serial,
            status: d.status, employeeId: d.employeeId || null, location: d.location,
            lastInspection: d.lastInspection || null, nextInspection: d.nextInspection || null, notes: d.notes
          };
          const who = employeeById(rec.employeeId);
          saveBtn.disabled = true;
          let saved;
          try {
            if (isNew) {
              saved = await AD.store.insert('equipment', rec, 'eq');
              await AD.store.log(`${rec.name} added to the equipment register${who ? ` (assigned to ${who.name})` : ''}`);
              toast(`${rec.name} added`);
            } else {
              saved = await AD.store.update('equipment', x.id, rec);
              const moved = (x.employeeId || null) !== rec.employeeId;
              await AD.store.log(moved ? `${rec.name} ${who ? `assigned to ${who.name}` : 'returned to the depot pool'}` : `${rec.name} equipment details updated`);
              toast(`${rec.name} saved`);
            }
          } catch (err2) {
            saveBtn.disabled = false;
            toast('Could not save item: ' + err2.message, 'error');
            return;
          }
          close();
          onSaved && onSaved(saved);
        };
      }
    });
  };

  // ======================================================== technology register
  // Real data from the Supabase "tech_devices" table (create-tech-devices.sql).
  // Each device can be assigned to an employee from the Employee register, so
  // it also shows on that person's profile (employee.js).
  const DEVICE_TYPES = ['Laptop', 'Desktop', 'Phone', 'Tablet', 'Field controller', 'Drone', 'Site internet', 'Other'];
  const DEVICE_STATUSES = ['In use', 'Spare', 'In repair', 'Retired'];
  const IT_TONE = { 'In use': 'blue', Spare: 'aqua', 'In repair': 'violet', Retired: 'grey muted' };
  const WARRANTY_SOON_DAYS = 30;
  const employeeById = (id) => (id ? AD.store.get('employees', id) : null);
  const devicesFor = (employeeId) => AD.store.all('tech_devices').filter((d) => d.employeeId === employeeId);
  /** Small photo/initials + name linking to the person's profile. */
  const assigneeCell = (emp) => emp
    ? `<span class="emp-cell">${empThumb(emp).replace('class="emp-thumb"', 'class="emp-thumb emp-thumb-sm"')}<span class="emp-cell-text"><a href="#/employee/${encodeURIComponent(emp.id)}">${esc(emp.name)}</a>${emp.position ? `<span class="t2">${esc(emp.position)}</span>` : ''}</span></span>`
    : '<span class="muted">Unassigned</span>';
  /** Same look for a made-up person on a sample device (no profile to link to). */
  const sampleAssigneeCell = (p) => `<span class="emp-cell">${empThumb({ name: p.name }).replace('class="emp-thumb"', 'class="emp-thumb emp-thumb-sm"')}<span class="emp-cell-text"><span class="sample-person">${esc(p.name)}</span><span class="t2">${esc(p.position)}</span></span></span>`;

  // SAMPLE DEVICES — shown ONLY while the register has no real devices, so the
  // layout (and a device profile) can be seen before any are added. They live
  // in this file only: never written to Supabase, read-only, clearly labelled,
  // and gone as soon as the first real device is added. Names, numbers and
  // serials are made up.
  const SAMPLE_DEVICES = () => [
    { id: 'sample-001', sample: true, type: 'Laptop', make: 'Dell Latitude 5440', assetTag: 'IT-001', serial: 'DL5440-7H2KQ', sampleAssignee: { name: 'Sophie Kim', position: 'Project coordinator' }, mobile: '', purchased: day(-410), warrantyEnds: day(320), status: 'In use', notes: 'Docking station and second monitor at the Wetherill Park office.' },
    { id: 'sample-002', sample: true, type: 'Laptop', make: 'Panasonic Toughbook 40', assetTag: 'IT-002', serial: 'TB40-1123987', sampleAssignee: { name: 'Priya Nair', position: 'Registered surveyor' }, mobile: '', purchased: day(-1010), warrantyEnds: day(-280), status: 'In use', notes: 'Rugged field laptop. Out of warranty — due for replacement next financial year.' },
    { id: 'sample-003', sample: true, type: 'Field controller', make: 'Trimble TSC7', assetTag: 'IT-003', serial: 'TSC7-55031', sampleAssignee: { name: 'Josh Whitfield', position: 'Survey technician' }, mobile: '', purchased: day(-640), warrantyEnds: day(90), status: 'In use', notes: '' },
    { id: 'sample-004', sample: true, type: 'Tablet', make: 'Samsung Galaxy Tab Active5', assetTag: 'IT-004', serial: 'IMEI 356938110041221', sampleAssignee: { name: 'Mia Tanaka', position: 'Utility locator' }, mobile: '0491 571 491', purchased: day(-200), warrantyEnds: day(530), status: 'In use', notes: '' },
    { id: 'sample-005', sample: true, type: 'Phone', make: 'Samsung Galaxy XCover7', assetTag: 'IT-005', serial: 'IMEI 352719331802465', sampleAssignee: { name: 'Liam Carter', position: 'Site supervisor' }, mobile: '0491 571 804', purchased: day(-150), warrantyEnds: day(580), status: 'In use', notes: '' },
    { id: 'sample-006', sample: true, type: 'Phone', make: 'Apple iPhone 15', assetTag: 'IT-006', serial: 'IMEI 359812447019937', sampleAssignee: { name: 'Sophie Kim', position: 'Project coordinator' }, mobile: '0491 572 549', purchased: day(-330), warrantyEnds: day(22), status: 'In use', notes: '' },
    { id: 'sample-007', sample: true, type: 'Phone', make: 'Samsung Galaxy XCover6 Pro', assetTag: 'IT-007', serial: 'IMEI 351046228861734', sampleAssignee: null, mobile: '', purchased: day(-900), warrantyEnds: day(-170), status: 'Spare', notes: 'Spare for new starters. Wiped and reset.' },
    { id: 'sample-008', sample: true, type: 'Drone', make: 'DJI Matrice 350 RTK', assetTag: 'IT-008', serial: '1ZNBJ7Q00C0093', sampleAssignee: { name: 'Josh Whitfield', position: 'Survey technician' }, mobile: '', purchased: day(-260), warrantyEnds: day(105), status: 'In repair', notes: 'Gimbal fault — with the DJI repair centre.' },
    { id: 'sample-009', sample: true, type: 'Site internet', make: 'Starlink Standard kit', assetTag: 'IT-009', serial: 'KIT-4F2290A1', sampleAssignee: null, mobile: '', purchased: day(-120), warrantyEnds: day(245), status: 'In use', notes: 'Lives in the site shed on the Granville job.' }
  ];
  const showingSampleDevices = () => !AD.store.all('tech_devices').length;
  const sampleDevice = (id) => (showingSampleDevices() ? SAMPLE_DEVICES().find((d) => d.id === id) || null : null);

  AD.devices = { DEVICE_TYPES, DEVICE_STATUSES, IT_TONE, devicesFor, sampleDevice };

  /** Add / edit a device. Pass null to add; `preset` pre-fills a new one
   *  (e.g. { employeeId } when adding from an employee's profile). */
  AD.deviceForm = function (dev, onSaved, preset = {}) {
    const { formData, showErrors, modal, toast, confirm, options } = AD.ui;
    const isNew = !dev;
    const d0 = dev || Object.assign({ type: 'Laptop', make: '', assetTag: '', serial: '', employeeId: '', mobile: '', purchased: '', warrantyEnds: '', status: 'Spare', notes: '' }, preset);
    if (isNew && d0.employeeId) d0.status = 'In use';
    const dateVal = (v) => (v ? esc(String(v).slice(0, 10)) : '');
    const people = AD.store.all('employees').slice().sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .map((p) => [p.id, p.position ? `${p.name} — ${p.position}` : p.name]);

    modal({
      title: isNew ? 'Add device' : `Edit ${d0.make || 'device'}`,
      wide: true,
      body: `
        <form class="form-grid" novalidate>
          <div class="form-section-title full"><b>Device</b><span>What it is and how to identify it</span></div>
          <div class="field"><label>Device type</label><select name="type">${options(DEVICE_TYPES, d0.type || 'Other')}</select></div>
          <div class="field"><label>Make / model <span class="req">*</span></label><input type="text" name="make" value="${esc(d0.make)}" placeholder="e.g. Apple iPhone 15"></div>
          <div class="field"><label>Asset tag</label><input type="text" name="assetTag" value="${esc(d0.assetTag)}" placeholder="e.g. IT-004">
            <div class="help">Your own label for it, if you use one.</div></div>
          <div class="field"><label>Serial number / IMEI</label><input type="text" name="serial" value="${esc(d0.serial)}"></div>
          <div class="form-section-title full"><b>Who has it</b><span>Assign it to someone from the Employee register</span></div>
          <div class="field"><label>Assigned to</label><select name="employeeId">${options(people, d0.employeeId || '', 'Unassigned')}</select></div>
          <div class="field"><label>Status</label><select name="status">${options(DEVICE_STATUSES, d0.status || 'In use')}</select></div>
          <div class="field"><label>Mobile number</label><input type="text" name="mobile" value="${esc(d0.mobile)}" inputmode="tel" placeholder="For phones and tablets with a SIM"></div>
          <div class="form-section-title full"><b>Purchase & warranty</b><span>Warranties ending within ${WARRANTY_SOON_DAYS} days are flagged</span></div>
          <div class="field"><label>Purchase date</label><input type="date" name="purchased" value="${dateVal(d0.purchased)}"></div>
          <div class="field"><label>Warranty ends</label><input type="date" name="warrantyEnds" value="${dateVal(d0.warrantyEnds)}"></div>
          <div class="field full"><label>Notes</label><textarea name="notes" rows="2">${esc(d0.notes)}</textarea></div>
        </form>
        <div class="form-actions">
          ${isNew ? '' : '<button class="btn btn-danger-ghost" data-remove type="button" style="margin-right:auto">Remove</button>'}
          <button class="btn btn-ghost" data-close type="button">Cancel</button>
          <button class="btn btn-primary" data-save type="button">${isNew ? 'Add device' : 'Save changes'}</button>
        </div>`,
      onMount(el, close) {
        const form = el.querySelector('form');
        el.querySelector('[data-close]').onclick = close;
        // Assigning someone a spare device puts it in use; unassigning an in-use one makes it spare.
        form.elements.employeeId.addEventListener('change', () => {
          const st = form.elements.status;
          if (form.elements.employeeId.value && st.value === 'Spare') st.value = 'In use';
          else if (!form.elements.employeeId.value && st.value === 'In use') st.value = 'Spare';
        });
        const removeBtn = el.querySelector('[data-remove]');
        if (removeBtn) removeBtn.onclick = async () => {
          const ok = await confirm({ title: `Remove ${d0.make || 'this device'}?`, message: 'This permanently deletes it from the technology register. It can’t be undone. (To keep a record of an old device, set its status to Retired instead.)', confirmText: 'Remove', danger: true });
          if (!ok) return;
          try {
            await AD.store.remove('tech_devices', d0.id);
            await AD.store.log(`${d0.make || 'Device'} removed from the technology register`);
            toast(`${d0.make || 'Device'} removed`);
          } catch (err) { toast('Could not remove device: ' + err.message, 'error'); return; }
          close();
          onSaved && onSaved(null);
        };
        const saveBtn = el.querySelector('[data-save]');
        saveBtn.onclick = async () => {
          const d = formData(form);
          const err = {};
          if (!d.make) err.make = 'Make / model is required.';
          if (!showErrors(form, err)) return;
          const rec = {
            type: d.type, make: d.make, assetTag: d.assetTag, serial: d.serial,
            employeeId: d.employeeId || null, status: d.status, mobile: d.mobile,
            purchased: d.purchased || null, warrantyEnds: d.warrantyEnds || null, notes: d.notes
          };
          const who = employeeById(rec.employeeId);
          saveBtn.disabled = true;
          let saved;
          try {
            if (isNew) {
              saved = await AD.store.insert('tech_devices', rec, 'dev');
              await AD.store.log(`${rec.make} added to the technology register${who ? ` (assigned to ${who.name})` : ''}`);
              toast(`${rec.make} added`);
            } else {
              saved = await AD.store.update('tech_devices', d0.id, rec);
              const moved = (d0.employeeId || null) !== rec.employeeId;
              await AD.store.log(moved
                ? `${rec.make} ${who ? `assigned to ${who.name}` : 'unassigned'}`
                : `${rec.make} device details updated`);
              toast(`${rec.make} saved`);
            }
          } catch (err2) {
            saveBtn.disabled = false;
            toast('Could not save device: ' + err2.message, 'error');
            return;
          }
          close();
          onSaved && onSaved(saved);
        };
      }
    });
  };

  /** Filter dropdown matching the register's grouping (only groups in use). */
  const groupFilter = (label, groupOf, order) => ({
    label,
    options: (rows) => order.filter((g) => rows.some((r) => groupOf(r) === g)),
    match: (r, v) => groupOf(r) === v
  });

  // ============================================================ registers
  const REGISTERS = [
    {
      route: 'employee-register', title: 'Employee register', noun: 'employee',
      table: 'employees', setupFile: 'supabase/create-employees.sql',
      rows: () => AD.store.all('employees').slice().sort((a, b) => String(a.name).localeCompare(String(b.name))),
      search: ['name', 'position', 'team', 'mobile', 'email', 'suburb', 'postcode', 'licencesApplied', 'licenceRegister'],
      groupOf: teamOf, groupOrder: TEAMS.concat('Unassigned'),
      filters: [
        groupFilter('All teams', teamOf, TEAMS.concat('Unassigned')),
        {
          label: 'Any licence or ticket',
          options: (rows) => [...new Set(rows.flatMap((r) => listOf(r.licenceRegister)))].sort((a, b) => a.localeCompare(b)),
          match: (r, v) => listOf(r.licenceRegister).includes(v)
        },
        {
          label: 'Any licence status',
          options: () => [['expired', 'Has an expired licence'], ['soon', `Expiring within ${LIC_SOON_DAYS} days`], ['nodates', 'No expiry dates recorded']],
          match: (r, v) => {
            const states = licenceStates(r);
            if (v === 'nodates') return states.length > 0 && states.every((l) => l.state === 'none');
            return states.some((l) => l.state === v);
          }
        }
      ],
      summary: (rows) => {
        if (!rows.length) return 'No staff recorded yet';
        const withLic = rows.filter((r) => listOf(r.licenceRegister).length).length;
        const noPhone = rows.filter((r) => !r.mobile).length;
        const all = rows.flatMap(licenceStates);
        const expired = all.filter((l) => l.state === 'expired').length;
        const soon = all.filter((l) => l.state === 'soon').length;
        return `${rows.length} staff · ${withLic} with licences or tickets recorded${noPhone ? ` · ${noPhone} without a mobile number` : ''}`
          + (expired ? ` · <span class="flag flag-red">${plural(expired, 'licence')} expired</span>` : '')
          + (soon ? ` · <span class="flag flag-amber">${soon} expiring within ${LIC_SOON_DAYS} days</span>` : '');
      },
      add: { label: 'Add employee', open: (done) => AD.employeeForm(null, (saved) => (saved ? AD.go('employee/' + saved.id) : done())) },
      edit: (r, done) => AD.employeeForm(r, done),
      href: (r) => '#/employee/' + encodeURIComponent(r.id),
      cols: [
        { head: 'Employee', width: 270, cell: (r) => `<span class="emp-cell">${empThumb(r)}<span class="emp-cell-text"><a class="id" href="#/employee/${encodeURIComponent(r.id)}">${esc(r.name)}</a><span class="t2">${or(r.position)}</span></span></span>` },
        { head: 'Licences applied', width: 130, cls: 'col-opt col-wide', cell: (r) => or(r.licencesApplied) },
        { head: 'Contact', width: 230, cls: 'col-opt', cell: (r) => `${r.mobile ? `<span class="nowrap">${esc(r.mobile)}</span>` : '<span class="muted">No mobile</span>'}${r.email ? `<span class="t2"><a href="mailto:${esc(r.email)}">${esc(r.email)}</a></span>` : ''}` },
        { head: 'Date of birth', width: 115, cls: 'col-opt col-wide nowrap', cell: (r) => fmtDate(r.dateOfBirth) },
        { head: 'Commenced', width: 110, cls: 'col-opt nowrap', cell: (r) => fmtDate(r.startDate) },
        { head: 'Address', width: 220, cls: 'col-opt col-wide', cell: (r) => (r.address || r.suburb) ? `${or(r.address)}<span class="t2">${esc([r.suburb, r.state, r.postcode].filter(Boolean).join(' '))}</span>` : AD.ui.dash },
        { head: 'Licence register', cls: 'col-opt', cell: (r) => {
          const ls = licenceStates(r);
          if (!ls.length) return AD.ui.dash;
          // Expired / expiring licences are coloured, with the date on hover.
          return `<span class="reg-tags">${ls.map((l) => `<span class="reg-tag${LIC_TONE[l.state] ? ' reg-tag-' + LIC_TONE[l.state] : ''}"${l.expiry ? ` title="${esc(`${l.name} — ${l.state === 'expired' ? 'expired' : 'expires'} ${AD.time.fmtKey(l.expiry)}`)}"` : ''}>${esc(l.name)}</span>`).join('')}</span>`;
        } }
      ]
    },
    {
      route: 'equipment-register', title: 'Equipment register', noun: 'item',
      table: 'equipment', setupFile: 'supabase/create-equipment.sql',
      // Until the first real item exists, the sample equipment stands in.
      rows: () => (showingSampleEquipment() ? SAMPLE_EQUIPMENT() : AD.store.all('equipment'))
        .map((x) => Object.assign({}, x, {
          category: x.category || 'Other',
          nextInspection: x.nextInspection ? String(x.nextInspection).slice(0, 10) : null,
          assignee: (employeeById(x.employeeId) || x.sampleAssignee || {}).name || ''
        }))
        .sort((a, b) => String(a.assetTag || a.name).localeCompare(String(b.assetTag || b.name))),
      sample: showingSampleEquipment,
      sampleNote: () => `<b>Sample equipment.</b> These items are made up to show how the equipment register — and each item’s profile — will look. They’re not saved anywhere. Use <b>Edit</b> on one to turn it into a real item with your own details, or <b>Add equipment</b> to start fresh; the samples disappear once your first real item is saved.${!AD.store.available('equipment') ? ' To start adding your own, run <code>supabase/create-equipment.sql</code> in the Supabase SQL Editor.' : ''}`,
      groupOf: (r) => r.category, groupOrder: EQ_CATEGORIES,
      search: ['name', 'category', 'make', 'assetTag', 'serial', 'location', 'assignee', 'status', 'notes'],
      filters: [
        groupFilter('All categories', (r) => r.category, EQ_CATEGORIES),
        { label: 'Any status', options: (rows) => EQ_STATUSES.filter((s) => rows.some((r) => r.status === s)), match: (r, v) => r.status === v },
        { label: 'Inspection status', options: () => [['overdue', 'Overdue for inspection'], ['soon', `Due within ${INSPECT_SOON_DAYS} days`]], match: (r, v) => dueState(r.nextInspection, INSPECT_SOON_DAYS) === v },
        { label: 'Assigned or not', options: () => [['yes', 'Assigned to someone'], ['no', 'Depot pool']], match: (r, v) => (v === 'yes') === !!r.assignee }
      ],
      summary: (rows) => {
        if (!rows.length) return 'No equipment recorded yet';
        const over = rows.filter((r) => dueState(r.nextInspection, INSPECT_SOON_DAYS) === 'overdue').length;
        const soon = rows.filter((r) => dueState(r.nextInspection, INSPECT_SOON_DAYS) === 'soon').length;
        const out = rows.filter((r) => r.status === 'Out of service').length;
        return `${plural(rows.length, 'item')}${out ? ` · ${out} out of service` : ''}`
          + (over ? ` · <span class="flag flag-red">${over} overdue for inspection</span>` : '')
          + (soon ? ` · <span class="flag flag-amber">${soon} due within ${INSPECT_SOON_DAYS} days</span>` : '');
      },
      add: { label: 'Add equipment', open: (done) => AD.equipmentForm(null, (saved) => (saved ? AD.go('equipment/' + saved.id) : done())) },
      edit: (r, done) => AD.equipmentForm(r, done),
      // Editing a sample saves it as a real item, then opens its profile.
      editSample: (r, done) => editSampleEquipment(r, (saved) => (saved ? AD.go('equipment/' + saved.id) : done())),
      href: (r) => '#/equipment/' + encodeURIComponent(r.id),
      cols: [
        { head: 'Item', width: 230, cell: (r) => `<a class="id" href="#/equipment/${encodeURIComponent(r.id)}">${esc(r.name)}</a><span class="t2">${esc(r.assetTag || r.category)}</span>` },
        { head: 'Make / model', width: 200, cls: 'col-opt', cell: (r) => or(r.make) },
        { head: 'Serial #', width: 140, cls: 'col-opt col-wide', cell: (r) => or(r.serial) },
        { head: 'Location', cls: 'col-opt', cell: (r) => or(r.location) },
        { head: 'Assigned to', width: 220, cls: 'col-opt col-wide', cell: (r) => (r.sampleAssignee ? sampleAssigneeCell(r.sampleAssignee) : r.employeeId && employeeById(r.employeeId) ? assigneeCell(employeeById(r.employeeId)) : '<span class="muted">Depot pool</span>') },
        { head: 'Status', width: 140, cell: (r) => AD.ui.badge(r.status, EQ_TONE[r.status] || 'grey') },
        { head: 'Inspection / calibration', width: 170, cell: (r) => dueCell(r.nextInspection, { soon: INSPECT_SOON_DAYS }) }
      ]
    },
    {
      route: 'technology-register', title: 'Technology register', noun: 'device',
      table: 'tech_devices', setupFile: 'supabase/create-tech-devices.sql',
      // assignee (the person's name) is added so search finds devices by who has them.
      // Until the first real device exists, the sample devices stand in.
      rows: () => (showingSampleDevices() ? SAMPLE_DEVICES() : AD.store.all('tech_devices'))
        .map((d) => Object.assign({}, d, { type: d.type || 'Other', assignee: (employeeById(d.employeeId) || d.sampleAssignee || {}).name || '' }))
        .sort((a, b) => String(a.make).localeCompare(String(b.make))),
      sample: showingSampleDevices,
      sampleNote: () => `<b>Sample devices.</b> These are made up to show how the technology register — and each device’s profile — will look. They’re not saved anywhere and disappear as soon as you add your first real device.${!AD.store.available('tech_devices') ? ' To start adding your own, run <code>supabase/create-tech-devices.sql</code> in the Supabase SQL Editor.' : ''}`,
      groupOf: (r) => r.type, groupOrder: DEVICE_TYPES,
      search: ['make', 'type', 'assetTag', 'serial', 'assignee', 'mobile', 'status', 'notes'],
      filters: [
        groupFilter('All device types', (r) => r.type, DEVICE_TYPES),
        { label: 'Any status', options: (rows) => DEVICE_STATUSES.filter((s) => rows.some((r) => r.status === s)), match: (r, v) => r.status === v },
        { label: 'Assigned or not', options: () => [['yes', 'Assigned to someone'], ['no', 'Unassigned']], match: (r, v) => (v === 'yes') === !!r.assignee }
      ],
      summary: (rows) => {
        if (!rows.length) return 'No devices recorded yet';
        const inUse = rows.filter((r) => r.status === 'In use').length;
        const spare = rows.filter((r) => r.status === 'Spare').length;
        const ended = rows.filter((r) => r.status !== 'Retired' && dueState(r.warrantyEnds, WARRANTY_SOON_DAYS) === 'overdue').length;
        const soon = rows.filter((r) => r.status !== 'Retired' && dueState(r.warrantyEnds, WARRANTY_SOON_DAYS) === 'soon').length;
        return `${plural(rows.length, 'device')} · ${inUse} in use · ${spare} spare`
          + (soon ? ` · <span class="flag flag-amber">${soon} warrant${soon === 1 ? 'y' : 'ies'} ending within ${WARRANTY_SOON_DAYS} days</span>` : '')
          + (ended ? ` · ${ended} out of warranty` : '');
      },
      add: { label: 'Add device', open: (done) => AD.deviceForm(null, (saved) => (saved ? AD.go('device/' + saved.id) : done())) },
      edit: (r, done) => AD.deviceForm(r, done),
      href: (r) => '#/device/' + encodeURIComponent(r.id),
      cols: [
        { head: 'Device', width: 240, cell: (r) => `<a class="id" href="#/device/${encodeURIComponent(r.id)}">${esc(r.make)}</a><span class="t2">${esc([r.assetTag, r.status === 'Retired' ? 'Retired' : ''].filter(Boolean).join(' · ') || r.type)}</span>` },
        { head: 'Serial / IMEI', width: 190, cls: 'col-opt', cell: (r) => or(r.serial) },
        { head: 'Assigned to', width: 230, cell: (r) => (r.sampleAssignee ? sampleAssigneeCell(r.sampleAssignee) : assigneeCell(employeeById(r.employeeId))) },
        { head: 'Mobile number', width: 140, cls: 'col-opt nowrap', cell: (r) => or(r.mobile) },
        { head: 'Purchased', width: 110, cls: 'col-opt col-wide nowrap', cell: (r) => fmtDate(r.purchased) },
        { head: 'Warranty', width: 150, cls: 'col-opt', cell: (r) => (r.warrantyEnds ? dueCell(String(r.warrantyEnds).slice(0, 10), { soon: WARRANTY_SOON_DAYS, past: (n) => `Ended ${n}d ago`, future: 'Ends in' }) : AD.ui.dash) },
        { head: 'Status', width: 120, cell: (r) => AD.ui.badge(r.status, IT_TONE[r.status] || 'grey') }
      ]
    }
  ];

  // =============================================================== render
  REGISTERS.forEach((reg) => {
    let root = null, q = '', picks = [];
    const missing = () => reg.table && !AD.store.available(reg.table);
    // Search also matches the group name (e.g. typing "civil" finds the Civil team).
    const haystack = (r) => reg.search.map((k) => r[k]).concat(reg.groupOf ? [reg.groupOf(r)] : []).join(' ').toLowerCase();

    function table() {
      if (!root) return;
      const all = reg.rows();
      const needle = q.trim().toLowerCase();
      const list = all.filter((r) => reg.filters.every((f, i) => !picks[i] || f.match(r, picks[i]))
        && (!needle || haystack(r).includes(needle)));
      // Sample rows get an Edit button only where the register supports turning
      // a sample into a real record (reg.editSample); otherwise they're read-only.
      const editBtn = (r) => (r.sample
        ? (reg.editSample ? `<button class="btn btn-sm btn-ghost" data-edit-sample="${esc(r.id)}">${AD.icons.edit} Edit</button>` : '')
        : `<button class="btn btn-sm btn-ghost" data-edit="${esc(r.id)}">${AD.icons.edit} Edit</button>`);
      const cols = reg.cols.concat(reg.edit ? [{ head: '', cls: 'col-action', cell: editBtn }] : []);
      const colspan = cols.length;
      const rowHtml = (r) => `<tr${reg.href ? ` class="row-link" data-href="${esc(reg.href(r))}" title="Open ${esc(r.name || r.make || r.id)}"` : ''}>${cols.map((c) => `<td class="${c.cls || ''}">${c.cell(r)}</td>`).join('')}</tr>`;
      let body;
      if (reg.groupOf) {
        const groups = reg.groupOrder.concat([...new Set(list.map(reg.groupOf))].filter((g) => !reg.groupOrder.includes(g)));
        body = groups.map((g) => {
          const rows = list.filter((r) => reg.groupOf(r) === g);
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
      root.querySelectorAll('[data-edit-sample]').forEach((b) => {
        b.onclick = () => reg.editSample(all.find((r) => r.id === b.dataset.editSample), () => draw());
      });
      // Clicking anywhere on a row opens its profile (links and buttons keep their own action).
      root.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => {
        if (e.target.closest('a, button')) return;
        location.hash = tr.dataset.href;
      }));
    }

    function draw() {
      const { pageHeader, options } = AD.ui;
      const I = AD.icons;
      const all = reg.rows();
      const opts = reg.filters.map((f) => f.options(all));
      // Drop a filter choice that no longer exists (e.g. its last row was removed).
      const optValue = (o) => (Array.isArray(o) ? o[0] : o); // options may be plain values or [value, label]
      picks = reg.filters.map((f, i) => (picks[i] && opts[i].some((o) => optValue(o) === picks[i]) ? picks[i] : ''));
      // `sample` is true for an all-sample register, or a function for one that
      // shows sample rows only until real data exists.
      const isSample = typeof reg.sample === 'function' ? reg.sample() : !!reg.sample;
      const note = isSample
        ? `<div class="sample-note">${I.alert}<div>${reg.sampleNote ? reg.sampleNote() : `<b>Sample data.</b> These rows are made up for a fictional company, ${esc(COMPANY)}, so you can see how this register will look. Nothing here is saved, and your fleet data isn’t touched.`}</div></div>`
        : missing()
          ? `<div class="sample-note">${I.alert}<div><b>Not set up yet.</b> The table for this register hasn’t been created in Supabase. Run <code>${esc(reg.setupFile)}</code> in the Supabase SQL Editor, then refresh.</div></div>`
          : '';
      const addBtn = reg.add ? `<button class="btn btn-primary" id="reg-add"${missing() ? ' disabled' : ''}>${I.plus} ${esc(reg.add.label)}</button>` : '';
      root.innerHTML = `
        ${pageHeader({ title: reg.title, sub: reg.summary(all), actions: addBtn })}
        ${note}
        <div class="toolbar">
          <div class="search">${I.search}<input type="search" id="reg-q" placeholder="Search ${esc(reg.noun)}s" aria-label="Search ${esc(reg.noun)}s" value="${esc(q)}"></div>
          ${reg.filters.map((f, i) => `<select data-filter="${i}" aria-label="${esc(f.label)}">${options(opts[i], picks[i], f.label)}</select>`).join('')}
          <span class="count" id="reg-count"></span>
        </div>
        <div class="table-wrap"><table class="data reg-table">
          <thead id="reg-head"></thead>
          <tbody id="reg-body"></tbody>
        </table></div>`;
      root.querySelector('#reg-q').addEventListener('input', (e) => { q = e.target.value; table(); });
      root.querySelectorAll('[data-filter]').forEach((s) => s.addEventListener('change', (e) => { picks[Number(s.dataset.filter)] = e.target.value; table(); }));
      const add = root.querySelector('#reg-add');
      if (add) add.onclick = () => reg.add.open(() => draw());
      table();
    }

    AD.views[reg.route] = {
      title: reg.title,
      render(el) { root = el; q = ''; picks = []; draw(); },
      // Background data refresh: redraw but keep the search and filter.
      refresh: () => root && draw()
    };
  });
})();
