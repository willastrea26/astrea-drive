/*
 * Employee, general equipment and technology registers — listed under the
 * "Registers" heading in the sidebar. Each is a page shell for now: the
 * columns and the Supabase table behind each one are still to be decided,
 * so nothing is stored yet. Once the fields are agreed, each becomes a full
 * register in the same pattern as power-tools.js (table + add/edit form).
 */
AD.views = AD.views || {};

(function () {
  const REGISTERS = [
    { route: 'employee-register', title: 'Employee register', icon: 'users', what: 'staff' },
    { route: 'equipment-register', title: 'General equipment register', icon: 'box', what: 'general equipment' },
    { route: 'technology-register', title: 'Technology register', icon: 'monitor', what: 'technology items such as laptops, phones and tablets' }
  ];

  REGISTERS.forEach((r) => {
    AD.views[r.route] = {
      title: r.title,
      render(el) {
        const { esc, pageHeader } = AD.ui;
        el.innerHTML = `
          ${pageHeader({ title: r.title, sub: 'Not set up yet' })}
          <section class="section">
            <div class="empty-tidy">${AD.icons[r.icon]}This register will list ${esc(r.what)}. Its columns haven't been set up yet.</div>
          </section>`;
      }
    };
  });
})();
