/*
 * Safety equipment — one sidebar tab for two registers that share the same
 * overdue/due-soon/recorded layout. Delegates straight to the existing
 * first-aid and fire-extinguishers views, unchanged, so a toggle at the top
 * just swaps which one draws into the body below it.
 */
AD.views = AD.views || {};

AD.views['safety-equipment'] = (function () {
  const { esc } = AD.ui;
  const I = AD.icons;
  const PREF_KEY = 'astrea-drive-safety-tab';
  const TABS = [
    { key: 'first-aid', label: 'First aid kits', icon: I.firstAid },
    { key: 'fire-extinguishers', label: 'Fire extinguishers', icon: I.fireExt }
  ];
  let root = null, active = TABS[0].key;

  function loadTab() {
    try {
      const v = localStorage.getItem(PREF_KEY);
      return TABS.some((t) => t.key === v) ? v : TABS[0].key;
    } catch (e) { return TABS[0].key; }
  }
  function saveTab(v) { try { localStorage.setItem(PREF_KEY, v); } catch (e) { /* preference only */ } }

  function render(el, params) {
    root = el;
    active = TABS.some((t) => t.key === params.type) ? params.type : loadTab();
    el.innerHTML = `
      <div class="seg safety-tabs" role="tablist" aria-label="Safety equipment register">
        ${TABS.map((t) => `<button type="button" role="tab" class="${t.key === active ? 'on' : ''}" data-tab="${t.key}" aria-selected="${t.key === active}">${t.icon}${esc(t.label)}</button>`).join('')}
      </div>
      <div id="se-body"></div>`;
    el.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => select(b.dataset.tab)));
    draw();
  }

  function select(key) {
    if (key === active) return;
    active = key;
    saveTab(active);
    root.querySelectorAll('[data-tab]').forEach((b) => {
      const on = b.dataset.tab === active;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
    draw();
  }

  function draw() {
    AD.views[active].render(root.querySelector('#se-body'), {});
  }

  return {
    title: () => AD.views[active].title,
    render,
    refresh: () => root && AD.views[active].refresh && AD.views[active].refresh()
  };
})();
