/*
 * Employee profile — Rates tab: salary / hourly pay rate / charge-out rate.
 *
 * Rates live in their own table (create-employee-rates.sql). Who can see them
 * is decided by the database function can_view_rates(): for now that's every
 * approved user; lock-employee-rates.sql later narrows it to a named list, and
 * everyone else then gets no rows back at all. The tab asks the database once
 * per session whether this user may see rates, and shows a "restricted"
 * message if not — so locking needs no app change.
 *
 * Derived figures: a salary's hourly equivalent (7.6-hour days, 5 days a week, 52 weeks — the construction-industry standard), cost
 * per hour including super, and the margin between charge-out and cost.
 * Activity-log entries say that rates changed, never what they are.
 */
AD.employeeRates = (function () {
  const DAY_HOURS = 7.6;                       // construction-industry ordinary day
  const HOURS_PER_YEAR = DAY_HOURS * 5 * 52;    // 1,976 hours a year
  const PAY_TYPES = ['Salary', 'Hourly'];
  let access = null;     // null = not checked yet, then true / false
  let checking = null;   // the in-flight check, so it only runs once

  const esc = (s) => AD.ui.esc(s);
  const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const money = (n) => '$' + Math.round(n).toLocaleString('en-AU');
  const money2 = (n) => '$' + Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /** Ask the database whether this user may see rates (once per session). */
  function checkAccess() {
    if (!checking) {
      checking = Promise.resolve(AD.sb.rpc('can_view_rates'))
        .then((res) => { access = !!(res && !res.error && res.data === true); })
        .catch(() => { access = false; });
    }
    return checking;
  }

  /** Pay per hour (actual, or salary ÷ 1,976), cost per hour incl. super, margin. */
  function figures(r) {
    const salary = num(r.annualSalary), hourly = num(r.hourlyRate), charge = num(r.chargeOutRate), sup = num(r.superPercent);
    // Salaried staff: always the salary ÷ 1,976 hours. Hourly staff: their rate.
    const payHour = r.payType !== 'Hourly' && salary != null ? salary / HOURS_PER_YEAR : hourly;
    const costHour = payHour != null ? payHour * (1 + (sup || 0) / 100) : null;
    const margin = charge != null && costHour != null ? charge - costHour : null;
    return { salary, hourly, charge, sup, payHour, costHour, margin, salaryEquiv: hourly != null && salary == null ? hourly * HOURS_PER_YEAR : null };
  }

  // ---------------------------------------------------------------- panel
  function panel(e) {
    const I = AD.icons;
    const { sectionHead } = AD.ui;
    if (!AD.store.available('employee_rates')) {
      return `<section class="section"><div class="sample-note">${I.alert}<div><b>Rates aren’t set up yet.</b> Run <code>supabase/create-employee-rates.sql</code> in the Supabase SQL Editor, then refresh.</div></div></section>`;
    }
    if (access === null) return `<section class="section"><p class="empty">Checking access…</p></section>`;
    if (!access) {
      return `<section class="section"><div class="rates-locked">
        <span class="rates-lock-ico">${I.shield}</span>
        <div><b>Rates are restricted</b><p>Pay and charge-out rates are only visible to people on the rates access list. If you need access, ask whoever manages Astrea Drive to add your email to it.</p></div>
      </div></section>`;
    }
    const r = AD.store.get('employee_rates', e.id);
    const first = String(e.name || '').trim().split(/\s+/)[0] || 'this person';
    if (!r) {
      return `<section class="section">
        ${sectionHead({ title: 'Pay & charge-out rates', level: 3 })}
        <div class="empty-tidy">${I.receipt}<span>No rates recorded for ${esc(first)} yet.<span class="empty-hint">Add their salary or hourly rate and the rate you charge clients for them.</span></span></div>
        <p><button type="button" class="btn btn-primary" data-edit-rates>${I.plus} Add rates</button></p>
      </section>`;
    }
    const f = figures(r);
    const kpi = (label, value, sub, cls = '') => `<div class="cost-kpi${cls}"><span>${esc(label)}</span><strong>${value}</strong><small>${sub}</small></div>`;
    const payKpi = r.payType === 'Hourly'
      ? kpi('Hourly pay rate', f.hourly != null ? money2(f.hourly) : '—', f.salaryEquiv != null ? `≈ ${money(f.salaryEquiv)} a year (7.6-hr days)` : 'Hourly')
      : kpi('Annual salary', f.salary != null ? money(f.salary) : '—', f.payHour != null ? `≈ ${money2(f.payHour)}/hr (7.6-hr days)` : 'Salary');
    const marginPct = f.margin != null && f.charge ? Math.round((f.margin / f.charge) * 100) : null;
    const notRec = '<span class="muted">Not recorded</span>';
    const who = r.updatedBy ? (AD.logic && AD.logic.userName && AD.logic.userName(r.updatedBy)) || r.updatedBy : '';
    const details = [
      ['Pay type', esc(r.payType || 'Salary')],
      ['Annual salary', f.salary != null ? money(f.salary) : notRec],
      ['Hourly pay rate', f.payHour == null ? notRec
        : r.payType !== 'Hourly' && f.salary != null
          ? `${money2(f.payHour)}<span class="t2">Worked out from the salary — 52 weeks × 5 days × ${DAY_HOURS} hours</span>`
          : money2(f.payHour)],
      ['Charge-out rate', f.charge != null ? `${money2(f.charge)} per hour` : notRec],
      ['Super', f.sup != null ? `${f.sup}%` : notRec],
      ['Effective from', r.effectiveFrom ? AD.time.fmtKey(String(r.effectiveFrom).slice(0, 10)) : notRec],
      ['Notes', r.notes ? `<span class="rates-notes">${esc(r.notes)}</span>` : '<span class="muted">None</span>'],
      ['Last updated', r.updatedAt ? `${AD.time.fmtKey(String(r.updatedAt).slice(0, 10))}${who ? ` by ${esc(who)}` : ''}` : notRec]
    ];
    return `<section class="section">
      ${sectionHead({ title: 'Pay & charge-out rates', level: 3, actions: `<button type="button" class="btn btn-ghost btn-sm" data-edit-rates>${I.edit} Edit rates</button>` })}
      <div class="cost-kpis rate-kpis">
        ${payKpi}
        ${kpi('Charge-out rate', f.charge != null ? money2(f.charge) : '—', 'per hour, charged to clients')}
        ${kpi('Cost per hour', f.costHour != null ? money2(f.costHour) : '—', f.sup != null ? `pay + ${f.sup}% super` : 'pay only (no super % recorded)')}
        ${kpi('Margin per hour', f.margin != null ? money2(f.margin) : '—', marginPct != null ? `${marginPct}% of the charge-out rate` : 'needs a charge-out rate and a pay rate', f.margin != null && f.margin < 0 ? ' is-negative' : '')}
      </div>
      <dl class="emp-details">${details.map(([dt, dd]) => `<div><dt>${esc(dt)}</dt><dd>${dd}</dd></div>`).join('')}</dl>
    </section>`;
  }

  function bind(el, e, redraw) {
    const b = el.querySelector('[data-edit-rates]');
    if (b) b.onclick = () => form(e, AD.store.get('employee_rates', e.id), () => redraw());
  }

  // ----------------------------------------------------------------- form
  function form(e, r, onSaved) {
    const { formData, showErrors, modal, toast, options } = AD.ui;
    const x = r || { payType: 'Salary', annualSalary: null, hourlyRate: null, chargeOutRate: null, superPercent: 12, effectiveFrom: '', notes: '' };
    const val = (v) => (v != null && v !== '' ? esc(v) : '');
    modal({
      title: `${r ? 'Edit' : 'Add'} rates — ${e.name}`,
      body: `
        <form class="form-grid" novalidate>
          <div class="field"><label>Pay type</label><select name="payType">${options(PAY_TYPES, x.payType || 'Salary')}</select></div>
          <div class="field"><label>Effective from</label><input type="date" name="effectiveFrom" value="${x.effectiveFrom ? esc(String(x.effectiveFrom).slice(0, 10)) : ''}"></div>
          <div class="field" data-salary-field><label>Annual salary ($)</label><input type="number" name="annualSalary" value="${val(x.annualSalary)}" min="0" step="1" inputmode="decimal" placeholder="e.g. 95000">
            <div class="help">For salaried staff.</div></div>
          <div class="field"><label>Hourly pay rate ($)</label><input type="number" name="hourlyRate" value="${val(x.hourlyRate)}" min="0" step="0.01" inputmode="decimal" placeholder="e.g. 42.50">
            <div class="help" data-hr-help></div></div>
          <div class="field"><label>Charge-out rate ($ per hour)</label><input type="number" name="chargeOutRate" value="${val(x.chargeOutRate)}" min="0" step="0.01" inputmode="decimal" placeholder="e.g. 120"></div>
          <div class="field"><label>Super (%)</label><input type="number" name="superPercent" value="${val(x.superPercent)}" min="0" max="100" step="0.1" inputmode="decimal" placeholder="e.g. 12"></div>
          <div class="field full"><label>Notes</label><textarea name="notes" rows="2" placeholder="e.g. Award level, allowances, next review date">${esc(x.notes || '')}</textarea></div>
        </form>
        <div class="form-actions">
          <button class="btn btn-ghost" data-close type="button">Cancel</button>
          <button class="btn btn-primary" data-save type="button">Save rates</button>
        </div>`,
      onMount(el, close) {
        const f = el.querySelector('form');
        el.querySelector('[data-close]').onclick = close;
        const saveBtn = el.querySelector('[data-save]');
        // Salaried: the hourly rate works itself out from the salary (read-only).
        // Hourly: type the hourly rate; there's no salary.
        const sal = f.elements.annualSalary, hr = f.elements.hourlyRate, pt = f.elements.payType;
        const hrHelp = el.querySelector('[data-hr-help]');
        const fromSalary = (v) => { const n = num(v); return n != null ? Math.round((n / HOURS_PER_YEAR) * 100) / 100 : null; };
        const sync = () => {
          const salaried = pt.value === 'Salary';
          el.querySelector('[data-salary-field]').style.display = salaried ? '' : 'none';
          hr.readOnly = salaried;
          if (salaried) { const h = fromSalary(sal.value); hr.value = h != null ? h.toFixed(2) : ''; }
          hrHelp.textContent = salaried
            ? `Worked out from the salary: ÷ 52 weeks ÷ 5 days ÷ ${DAY_HOURS} hours (${HOURS_PER_YEAR.toLocaleString('en-AU')} hours a year).`
            : 'The hourly pay rate for this person.';
        };
        pt.addEventListener('change', sync);
        sal.addEventListener('input', sync);
        sync();
        saveBtn.onclick = async () => {
          const d = formData(f);
          const err = {};
          ['annualSalary', 'hourlyRate', 'chargeOutRate', 'superPercent'].forEach((k) => {
            if (d[k] !== '' && !(Number(d[k]) >= 0)) err[k] = 'Enter a number (0 or more).';
          });
          if (d.superPercent !== '' && Number(d.superPercent) > 100) err.superPercent = 'Enter a percentage up to 100.';
          if (d.payType === 'Hourly' && d.hourlyRate === '') err.hourlyRate = 'Enter the hourly pay rate.';
          if (d.payType === 'Salary' && d.annualSalary === '') err.annualSalary = 'Enter the annual salary.';
          if (!showErrors(f, err)) return;
          const who = AD.currentUserEmail || '';
          const salaried = d.payType === 'Salary';
          const rec = {
            payType: d.payType,
            annualSalary: salaried ? num(d.annualSalary) : null,
            hourlyRate: salaried ? fromSalary(d.annualSalary) : num(d.hourlyRate),
            chargeOutRate: num(d.chargeOutRate),
            superPercent: num(d.superPercent), effectiveFrom: d.effectiveFrom || null, notes: d.notes,
            updatedAt: new Date().toISOString(), updatedBy: who
          };
          saveBtn.disabled = true;
          try {
            if (r) await AD.store.update('employee_rates', e.id, rec);
            else await AD.store.insert('employee_rates', Object.assign({ id: e.id, employeeId: e.id }, rec));
            // Say that rates changed — never the figures (the log is visible to everyone).
            await AD.store.log(`Rates updated for ${e.name}`);
            toast(`Rates saved for ${e.name}`);
          } catch (err2) {
            saveBtn.disabled = false;
            toast('Could not save rates: ' + err2.message, 'error');
            return;
          }
          close();
          onSaved && onSaved();
        };
      }
    });
  }

  return { panel, bind, checkAccess, hasChecked: () => access !== null };
})();
