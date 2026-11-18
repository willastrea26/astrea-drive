/*
 * Employee profile — opened from the Employee register (#/employee/<id>).
 * Same shape as the vehicle profile: breadcrumb, a header with the key
 * facts and an Edit button, then detail sections underneath.
 *
 * Reads the "employees" table only. Assigned vehicles are found by matching
 * the employee's name to the fleet's driver list (the Fleet register's
 * "Assigned driver"), since the two lists aren't linked by ID.
 */
AD.views = AD.views || {};

AD.views.employee = (function () {
  const { esc, sectionHead, dash, badge, vehicleBadge } = AD.ui;
  const T = AD.time, I = AD.icons;
  let root = null, empId = '';

  const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const initials = (name) => String(name || '?').trim().split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'this person';

  /** Whole years between two YYYY-MM-DD keys. */
  function yearsBetween(from, to) {
    const a = T.parseKey(from), b = T.parseKey(to);
    let y = b.y - a.y;
    if (b.m < a.m || (b.m === a.m && b.d < a.d)) y -= 1;
    return y;
  }

  /** "2 yrs 3 mths", "5 mths", "12 days", or "Starts in 9 days" for a future start. */
  function tenure(start) {
    const today = T.todayKey();
    const days = T.daysBetween(start, today);
    if (days < 0) return `Starts in ${-days} day${days === -1 ? '' : 's'}`;
    if (days < 31) return days === 0 ? 'Started today' : `${days} day${days === 1 ? '' : 's'}`;
    const a = T.parseKey(start), b = T.parseKey(today);
    let months = (b.y - a.y) * 12 + (b.m - a.m) - (b.d < a.d ? 1 : 0);
    const yrs = Math.floor(months / 12);
    months -= yrs * 12;
    return [yrs ? `${yrs} yr${yrs === 1 ? '' : 's'}` : '', months ? `${months} mth${months === 1 ? '' : 's'}` : ''].filter(Boolean).join(' ') || 'Under a month';
  }

  /** Fleet vehicles whose assigned driver has this employee's name. */
  function vehiclesFor(emp) {
    const driverIds = new Set(AD.store.all('drivers').filter((d) => norm(d.name) === norm(emp.name)).map((d) => d.id));
    if (!driverIds.size) return [];
    return AD.store.all('vehicles').filter((v) => driverIds.has(v.driverId)).sort((a, b) => a.id.localeCompare(b.id));
  }

  function draw() {
    const el = root;
    const back = `<nav class="crumbs" aria-label="Breadcrumb"><a href="#/employee-register">Employee register</a>${I.chevR}<span aria-current="page">${esc((AD.store.get('employees', empId) || {}).name || 'Employee')}</span></nav>`;
    if (!AD.store.available('employees')) {
      el.innerHTML = `${back}<p class="empty">The employee register hasn’t been set up yet. Run <code>supabase/create-employees.sql</code> in the Supabase SQL Editor, then refresh.</p>`;
      return;
    }
    const e = AD.store.get('employees', empId);
    if (!e) {
      el.innerHTML = `${back}<p class="empty">This employee wasn’t found. They may have been removed from the register.</p>`;
      return;
    }
    const { teamOf, listOf } = AD.employees;
    const team = teamOf(e);
    const licences = listOf(e.licenceRegister);
    const vehicles = vehiclesFor(e);
    const today = T.todayKey();
    const telHref = e.mobile ? 'tel:' + e.mobile.replace(/[^\d+]/g, '') : '';
    const place = [e.suburb, e.state, e.postcode].filter(Boolean).join(' ');

    const details = [
      ['Mobile', e.mobile ? `<a href="${esc(telHref)}">${esc(e.mobile)}</a>` : '<span class="muted">Not recorded</span>'],
      ['Email', e.email ? `<a href="mailto:${esc(e.email)}">${esc(e.email)}</a>` : '<span class="muted">Not recorded</span>'],
      ['Date of birth', e.dateOfBirth ? `${T.fmtKey(e.dateOfBirth)}<span class="t2">Age ${yearsBetween(e.dateOfBirth, today)}</span>` : '<span class="muted">Not recorded</span>'],
      ['Address', (e.address || place) ? `${e.address ? esc(e.address) : ''}${place ? `<span class="${e.address ? 't2' : ''}">${esc(place)}</span>` : ''}` : '<span class="muted">Not recorded</span>'],
      ['Licences applied', e.licencesApplied ? esc(e.licencesApplied) : '<span class="muted">None recorded</span>'],
      ['Team', `${esc(team)}${e.team ? '' : '<span class="t2">Set automatically from position</span>'}`]
    ];

    el.innerHTML = `
      ${back}
      <header class="veh-hero emp-hero">
        <div class="emp-avatar" aria-hidden="true">${esc(initials(e.name))}</div>
        <div class="veh-ident">
          <h1>${esc(e.name)}</h1>
          <p class="veh-model">${e.position ? esc(e.position) : 'No position recorded'}</p>
          ${badge(team, team === 'Unassigned' ? 'grey ring' : 'blue')}
        </div>
        <dl class="veh-facts">
          <div><dt>Commenced</dt><dd>${e.startDate ? T.fmtKey(e.startDate) : dash}</dd></div>
          <div><dt>With Astrea</dt><dd>${e.startDate ? esc(tenure(e.startDate)) : dash}</dd></div>
          <div><dt>Licences & tickets</dt><dd>${licences.length}</dd></div>
        </dl>
        <div class="veh-actions">
          ${e.mobile ? `<a class="btn btn-secondary" href="${esc(telHref)}">Call</a>` : ''}
          ${e.email ? `<a class="btn btn-secondary" href="mailto:${esc(e.email)}">Email</a>` : ''}
          <button class="btn btn-primary" data-edit-emp>${I.edit} Edit employee</button>
        </div>
      </header>

      <div class="cols-2">
        <section class="section">
          ${sectionHead({ title: 'Contact & personal details', level: 3 })}
          <dl class="emp-details">${details.map(([dt, dd]) => `<div><dt>${esc(dt)}</dt><dd>${dd}</dd></div>`).join('')}</dl>
        </section>
        <section class="section">
          ${sectionHead({ title: 'Licences & tickets', meta: licences.length ? `${licences.length} recorded` : '', level: 3 })}
          ${licences.length
            ? `<div class="reg-tags emp-tags">${licences.map((x) => `<span class="reg-tag">${esc(x)}</span>`).join('')}</div>`
            : `<div class="empty-tidy">${I.file}No licences or tickets recorded for ${esc(firstName(e.name))} yet.</div>`}

          ${sectionHead({ title: 'Assigned vehicles', meta: vehicles.length ? `${vehicles.length} in the fleet` : '', level: 3 })}
          ${vehicles.length
            ? `<ul class="rows emp-vehicles">${vehicles.map((v) => `<li class="link" data-veh="${esc(v.id)}">
                <span class="id">${esc(v.id)}</span>
                <span class="what">${esc(v.make || '')} ${esc((v.model || '').split(' — ')[0])}<span class="t2">${esc(v.rego || '')} · ${esc(v.type || '')}</span></span>
                <span class="when">${vehicleBadge(v.status)}</span>
              </li>`).join('')}</ul>`
            : `<div class="empty-tidy">${I.truck}No fleet vehicles are assigned to ${esc(firstName(e.name))}.</div>`}
        </section>
      </div>`;

    el.querySelector('[data-edit-emp]').onclick = () => AD.employeeForm(e, (saved) => (saved ? draw() : AD.go('employee-register')));
    el.querySelectorAll('li[data-veh]').forEach((li) => li.addEventListener('click', () => AD.go('vehicle/' + li.dataset.veh)));
  }

  return {
    title: (arg) => (AD.store.get('employees', arg) || {}).name || 'Employee',
    render(el, params, arg) { root = el; empId = arg || ''; draw(); },
    refresh: () => root && draw()
  };
})();
