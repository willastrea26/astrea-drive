/* Full activity log — the "View all activity" destination from the Dashboard. */
AD.views = AD.views || {};

AD.views.activity = (function () {
  const { esc, options, pageHeader } = AD.ui;
  const L = AD.logic, T = AD.time, I = AD.icons;
  // Matches js/data/store.js ACTIVITY_LIMIT: the store only ever holds the
  // newest N rows, so that's the most this page can ever show.
  const STORE_LIMIT = 100;
  let root = null, st = {};

  function render(el, params) {
    root = el;
    st = { q: params.q || '', vehicle: params.vehicle || '', user: params.user || '' };
    const all = AD.store.all('activity');
    const vehicles = [...new Set(all.map((a) => a.vehicleId).filter(Boolean))].sort();
    const users = [...new Set(all.map((a) => a.userEmail).filter(Boolean))]
      .sort((a, b) => L.userName(a).localeCompare(L.userName(b)));

    el.innerHTML = `
      ${pageHeader({ title: 'Activity', sub: `Most recent ${Math.min(all.length, STORE_LIMIT)} changes across the fleet` })}
      <div class="toolbar">
        <div class="search">${I.search}<input type="search" id="a-q" placeholder="Search activity" value="${esc(st.q)}" aria-label="Search activity"></div>
        <select id="a-vehicle" aria-label="Vehicle">${options(vehicles, st.vehicle, 'All vehicles')}</select>
        <select id="a-user" aria-label="Changed by">${options(users.map((u) => [u, L.userName(u)]), st.user, 'Everyone')}</select>
        <span class="count" id="a-count"></span>
      </div>
      <ul class="rows activity" id="a-list"></ul>
      ${all.length >= STORE_LIMIT ? `<p class="section-foot muted small">Showing the most recent ${STORE_LIMIT} changes stored — older activity isn’t kept.</p>` : ''}`;

    el.querySelector('#a-q').addEventListener('input', (e) => { st.q = e.target.value; AD.setParams(st); rows(); });
    el.querySelector('#a-vehicle').addEventListener('change', (e) => { st.vehicle = e.target.value; AD.setParams(st); rows(); });
    el.querySelector('#a-user').addEventListener('change', (e) => { st.user = e.target.value; AD.setParams(st); rows(); });
    rows();
  }

  function rows() {
    const q = st.q.trim().toLowerCase();
    const list = AD.store.all('activity').filter((a) => {
      if (st.vehicle && a.vehicleId !== st.vehicle) return false;
      if (st.user && a.userEmail !== st.user) return false;
      if (q && !a.text.toLowerCase().includes(q)) return false;
      return true;
    });
    root.querySelector('#a-count').textContent = `${list.length} ${list.length === 1 ? 'entry' : 'entries'}`;
    root.querySelector('#a-list').innerHTML = list.map((a) => {
      const who = L.userName(a.userEmail);
      return `<li${a.vehicleId ? ` class="link" data-veh="${esc(a.vehicleId)}" title="Open ${esc(a.vehicleId)}"` : ''}>
        <span class="what">${esc(a.text)}${who ? `<span class="t2">by ${esc(who)} · ${esc(a.userEmail)}</span>` : ''}</span>
        <span class="when">${esc(AD.ui.relTime(a.ts))}<span class="t2">${esc(T.fmtDateTime(a.ts))}</span></span>
      </li>`;
    }).join('') || '<li class="muted">No activity matches these filters.</li>';
    root.querySelectorAll('li[data-veh]').forEach((li) => li.addEventListener('click', () => AD.go('vehicle/' + li.dataset.veh)));
  }

  return { title: 'Activity', render, refresh: () => root && rows() };
})();
