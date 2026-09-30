/* Power & motor tools register */
AD.views = AD.views || {};

AD.views['power-tools'] = (function () {
  const { esc, pageHeader, sectionHead, dash } = AD.ui;

  const TOOLS = [
    { type: 'Demo Saw',     make: '', serial: '', location: 'Various sites', responsible: 'Dale or Beggs', interval: '3 months or 100 hrs', last: '', next: '' },
    { type: 'Demo Saw',     make: '', serial: '', location: 'Various sites', responsible: 'Dale or Beggs', interval: '3 months or 100 hrs', last: '', next: '' },
    { type: 'Demo Saw',     make: '', serial: '', location: 'Various sites', responsible: 'Dale or Beggs', interval: '3 months or 100 hrs', last: '', next: '' },
    { type: 'Vibe Plate',   make: '', serial: '', location: 'Various sites', responsible: 'Dale or Beggs', interval: '3 months or 100 hrs', last: '', next: '' },
    { type: 'Vibe Plate',   make: '', serial: '', location: 'Various sites', responsible: 'Dale or Beggs', interval: '3 months or 100 hrs', last: '', next: '' },
    { type: 'Vibe Plate',   make: '', serial: '', location: 'Various sites', responsible: 'Dale or Beggs', interval: '3 months or 100 hrs', last: '', next: '' },
    { type: 'Jumping Jack', make: '', serial: '', location: 'Various sites', responsible: 'Dale or Beggs', interval: '3 months or 100 hrs', last: '', next: '' },
    { type: 'Jumping Jack', make: '', serial: '', location: 'Various sites', responsible: 'Dale or Beggs', interval: '3 months or 100 hrs', last: '', next: '' },
    { type: 'Jumping Jack', make: '', serial: '', location: 'Various sites', responsible: 'Dale or Beggs', interval: '3 months or 100 hrs', last: '', next: '' },
    { type: 'Generator',    make: '', serial: '', location: 'Various sites', responsible: 'Dale or Beggs', interval: '3 months or 200 hrs', last: '', next: '' },
    { type: 'Generator',    make: '', serial: '', location: 'Various sites', responsible: 'Dale or Beggs', interval: '3 months or 200 hrs', last: '', next: '' },
    { type: 'Generator',    make: '', serial: '', location: 'Various sites', responsible: 'Dale or Beggs', interval: '3 months or 200 hrs', last: '', next: '' },
  ];

  function render(el) {
    const typeCounts = TOOLS.reduce((m, t) => { m[t.type] = (m[t.type] || 0) + 1; return m; }, {});
    const summary = Object.entries(typeCounts).map(([type, n]) => `${n}× ${type}`).join(' · ');
    const typeNums = {};

    el.innerHTML = `
      ${pageHeader({ title: 'Power &amp; motor tools', sub: summary })}
      <div class="table-wrap"><table class="data">
        <thead><tr>
          <th style="width:150px">Tool</th>
          <th class="col-opt">Make / model</th>
          <th class="col-opt">Serial #</th>
          <th class="col-opt col-wide">Location</th>
          <th class="col-opt col-wide">Responsible person</th>
          <th>Service interval</th>
          <th class="col-opt">Last service</th>
          <th class="col-opt">Next service</th>
        </tr></thead>
        <tbody>
          ${TOOLS.map((t) => {
            typeNums[t.type] = (typeNums[t.type] || 0) + 1;
            return `<tr>
              <td><span class="id">${esc(t.type)}</span><span class="t2">#${typeNums[t.type]}</span></td>
              <td class="col-opt">${t.make || dash}</td>
              <td class="col-opt">${t.serial || dash}</td>
              <td class="col-opt col-wide">${esc(t.location)}</td>
              <td class="col-opt col-wide">${esc(t.responsible)}</td>
              <td>${esc(t.interval)}</td>
              <td class="col-opt">${t.last || dash}</td>
              <td class="col-opt">${t.next || dash}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>
      <p class="section-foot muted small" style="margin-top:12px">Serial numbers and service dates to be filled in. Contact Dale or Beggs for current serviceability status.</p>`;
  }

  return { title: 'Power & motor tools', render, refresh: () => {} };
})();
