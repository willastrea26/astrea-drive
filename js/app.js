/*
 * App shell: sign-in gate, hash router, navigation, clock and reset.
 * Routes look like  #/fleet?status=Available  or  #/vehicle/VAC-03
 */
window.AD = window.AD || {};
AD.views = AD.views || {};

(function () {
  const { $, esc, toast } = AD.ui;
  const I = AD.icons;

  const NAV = [
    { group: 'Fleet' },
    { route: 'dashboard', label: 'Dashboard', icon: I.dashboard },
    { route: 'fleet', label: 'Fleet register', icon: I.truck },
    { route: 'maintenance', label: 'Maintenance', icon: I.wrench },
    { route: 'defects', label: 'Defects', icon: I.alert, count: () => AD.logic.openDefects().length },
    { route: 'power-tools', label: 'Power & motor tools', icon: I.gauge },
    { route: 'first-aid', label: 'First aid kits', icon: I.firstAid },
    { route: 'fire-extinguishers', label: 'Fire extinguishers', icon: I.fireExt },
    { route: 'workshops', label: 'Workshops', icon: I.garage },
    { group: 'Vac trucks' },
    { route: 'calendar', label: 'Calendar', icon: I.calendar },
    { route: 'tracker', label: 'Tracker', icon: I.map }
  ];

  let current = null; // { name, view, params }

  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const [path, qs] = h.split('?');
    const segs = path.split('/').filter(Boolean).map(decodeURIComponent);
    const params = Object.fromEntries(new URLSearchParams(qs || ''));
    return { name: segs[0] || 'dashboard', arg: segs[1], params };
  }

  AD.go = function (route, params) {
    const qs = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString() : '';
    const target = '#/' + route + (qs ? '?' + qs : '');
    if (location.hash === target) render(); else location.hash = target;
  };

  /** Update the query string without re-rendering (keeps view state in the URL). */
  AD.setParams = function (params) {
    const { name, arg } = parseHash();
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString();
    history.replaceState(null, '', '#/' + name + (arg ? '/' + encodeURIComponent(arg) : '') + (qs ? '?' + qs : ''));
  };

  function renderNav(active) {
    const navRoute = active === 'vehicle' ? 'fleet' : active;
    $('#nav').innerHTML = NAV.map((n) => {
      if (n.group) return `<div class="nav-label">${esc(n.group)}</div>`;
      const c = n.count ? n.count() : 0;
      const on = n.route === navRoute;
      return `<a href="#/${n.route}" class="${on ? 'active' : ''}" ${on ? 'aria-current="page"' : ''}>${n.icon}<span>${esc(n.label)}</span>${c ? `<span class="count" title="${c} open">${c}</span>` : ''}</a>`;
    }).join('');
  }

  function render() {
    const { name, arg, params } = parseHash();
    const view = AD.views[name] || AD.views.dashboard;
    if (current && current.view.destroy) current.view.destroy();
    AD.ui.closeModal();
    current = { name, view, params, arg };
    renderNav(name);
    $('#hero-slot').innerHTML = '';
    const el = $('#view');
    el.innerHTML = '';
    view.render(el, params, arg);
    const title = typeof view.title === 'function' ? view.title(arg) : view.title;
    document.title = `${title} — Astrea Drive`;
    if (AD.closeNav) AD.closeNav(); else document.body.classList.remove('nav-open');
    window.scrollTo(0, 0);
  }

  function refresh() {
    renderNav(current ? current.name : 'dashboard');
    if (!current) return;
    if (current.view.refresh) current.view.refresh();
    else {
      const el = $('#view');
      const y = window.scrollY;
      el.innerHTML = '';
      current.view.render(el, current.params, current.arg);
      window.scrollTo(0, y);
    }
  }

  function tickClock() {
    const now = Date.now();
    $('#tz-clock').innerHTML = `${I.clock} Sydney ${AD.time.fmtTime(now)} ${AD.time.abbr(now)}`;
    $('#phone-time').textContent = AD.time.fmtTime(now);
  }

  // ---------- Computer / iPhone preview ----------
  // iPhone mode loads this same app in a 390px-wide frame so the real phone
  // layout (driven by media queries) is shown. Both share the same Supabase
  // session (same origin), so returning to computer mode just re-fetches to
  // pick up anything changed inside the phone preview.
  const EMBEDDED = new URLSearchParams(location.search).has('embed');
  const DEVICE_KEY = 'astrea-drive-preview-device';
  let device = 'computer';

  function sizePhone() {
    const h = Math.min(864, Math.max(560, window.innerHeight - 96));
    $('.phone').style.setProperty('--phone-h', h + 'px');
  }

  async function setDevice(mode) {
    if (mode === device) return;
    const frame = $('#device-frame');
    if (mode === 'iphone') {
      AD.ui.closeModal();
      document.body.classList.remove('nav-open');
      if (current && current.view.destroy) current.view.destroy();
      frame.src = `${location.pathname}?embed=1${location.hash}`;
      $('#device-stage').hidden = false;
      document.body.classList.add('device-iphone');
      sizePhone();
    } else {
      // Carry the page you were on in the phone back to the computer view.
      let hash = location.hash;
      try { hash = frame.contentWindow.location.hash || hash; } catch (e) { /* file:// frames can't be read */ }
      frame.src = 'about:blank';
      $('#device-stage').hidden = true;
      document.body.classList.remove('device-iphone');
      try { await AD.store.load(); } catch (e) { toast('Could not refresh data: ' + e.message, 'error'); }
      if (location.hash !== hash) location.hash = hash; else render();
    }
    device = mode;
    document.querySelectorAll('#device-toggle [data-device]').forEach((b) => {
      b.classList.toggle('on', b.dataset.device === mode);
      b.setAttribute('aria-pressed', String(b.dataset.device === mode));
    });
    try { localStorage.setItem(DEVICE_KEY, mode); } catch (e) { /* preference only */ }
  }

  function initDevice() {
    if (EMBEDDED) { document.body.classList.add('embedded'); return; }
    const labels = { computer: `${I.monitor} Computer`, iphone: `${I.phone} iPhone` };
    document.querySelectorAll('#device-toggle [data-device]').forEach((b) => {
      b.innerHTML = labels[b.dataset.device];
      b.classList.toggle('on', b.dataset.device === 'computer');
      b.onclick = () => setDevice(b.dataset.device);
    });
    window.addEventListener('resize', () => { if (device === 'iphone') sizePhone(); });
    let saved = 'computer';
    try { saved = localStorage.getItem(DEVICE_KEY) || 'computer'; } catch (e) { /* ignore */ }
    if (saved === 'iphone') setDevice('iphone');
  }

  // ---------- Sign-in gate ----------
  function showGate() {
    $('#app-shell').hidden = true;
    $('#auth-gate').hidden = false;
  }

  function showApp() {
    $('#auth-gate').hidden = true;
    $('#app-shell').hidden = false;
  }

  function wireAuthForm() {
    const form = $('#auth-form');
    const errBox = $('#auth-error');
    form.onsubmit = async (e) => {
      e.preventDefault();
      errBox.hidden = true;
      const btn = form.querySelector('.auth-submit');
      const email = form.email.value.trim();
      const password = form.password.value;
      btn.disabled = true;
      btn.textContent = 'Signing in…';
      try {
        await AD.auth.signIn(email, password);
        form.reset();
      } catch (err) {
        errBox.textContent = /invalid/i.test(err.message) ? 'Incorrect email or password.' : err.message;
        errBox.hidden = false;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Sign in';
      }
    };
  }

  // ---------- Boot ----------
  let pollTimer = null;

  async function enterApp(session) {
    showApp();
    $('#user-tag').textContent = session.user.email;
    try {
      await AD.store.load();
    } catch (e) {
      toast('Could not load fleet data: ' + e.message, 'error');
      return;
    }
    init();
    // Nobody else's edits push to this tab on their own (no realtime), so
    // poll for changes: on a timer, and whenever the tab regains focus.
    clearInterval(pollTimer);
    pollTimer = setInterval(() => AD.store.load().catch(() => {}), 45000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) AD.store.load().catch(() => {});
    });
  }

  let initialised = false;

  function init() {
    if (initialised) { render(); return; }
    initialised = true;
    $('#menu-btn').innerHTML = I.menu;
    $('#signout-btn').innerHTML = `${I.logout} Sign out`;
    const menuBtn = $('#menu-btn');
    menuBtn.setAttribute('aria-controls', 'sidebar');
    menuBtn.setAttribute('aria-expanded', 'false');
    const setNav = (open) => {
      document.body.classList.toggle('nav-open', open);
      menuBtn.setAttribute('aria-expanded', String(open));
      if (open) setTimeout(() => { const a = $('#nav a'); if (a) a.focus(); }, 30);
      else if (document.activeElement && $('#sidebar').contains(document.activeElement)) menuBtn.focus();
    };
    AD.closeNav = () => { if (document.body.classList.contains('nav-open')) setNav(false); };
    menuBtn.onclick = () => setNav(!document.body.classList.contains('nav-open'));
    $('#scrim').onclick = () => setNav(false);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.querySelector('#modal-root.open, .confirm-open')) AD.closeNav(); });
    $('#signout-btn').onclick = async () => {
      clearInterval(pollTimer);
      await AD.auth.signOut();
    };
    AD.store.on(() => refresh());
    window.addEventListener('hashchange', render);
    tickClock();
    setInterval(tickClock, 15000);
    render();
    initDevice();
  }

  async function boot() {
    wireAuthForm();
    let session;
    try { session = await AD.auth.getSession(); }
    catch (e) { session = null; }

    if (session) await enterApp(session);
    else showGate();

    AD.auth.onChange((s) => {
      if (s && $('#auth-gate').hidden === false) enterApp(s);
      else if (!s) { clearInterval(pollTimer); showGate(); }
    });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
