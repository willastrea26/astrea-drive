/*
 * Employee profile — Rates tab: salary / hourly pay rate / charge-out rates.
 *
 * Rates live in their own table (create-employee-rates.sql). Who can see them
 * is decided by the database function can_view_rates(): for now that's every
 * approved user; lock-employee-rates.sql later narrows it to a named list, and
 * everyone else then gets no rows back at all. The tab asks the database once
 * per session whether this user may see rates, and shows a "restricted"
 * message if not — so locking needs no app change.
 *
 * Pay: a salary's hourly equivalent is worked out on 7.6-hour days, 5 days a
 * week, 52 weeks (1,976 hours a year).
 *
 * Shifts: the day charge-out rate plus optional night, Saturday, Sunday and
 * public-holiday rates (stored in "shiftRates"). Each shift can also carry a
 * pay multiplier (e.g. 1.5 = time-and-a-half) so its cost and margin are real.
 * Nothing is assumed: a blank multiplier means pay doesn't change, a blank
 * charge-out means that shift isn't charged. The shift buttons at the top of
 * the tab show what a shift actually comes to — charge, cost and margin.
 *
 * Activity-log entries say that rates changed, never what they are.
 */
AD.employeeRates = (function () {
  const DAY_HOURS = 7.6;                       // construction-industry ordinary day
  const HOURS_PER_YEAR = DAY_HOURS * 5 * 52;    // 1,976 hours a year
  const PAY_TYPES = ['Salary', 'Hourly'];
  const SHIFTS = [
    { key: 'day', label: 'Day' },
    { key: 'night', label: 'Night' },
    { key: 'saturday', label: 'Saturday' },
    { key: 'sunday', label: 'Sunday' },
    { key: 'publicHoliday', label: 'Public holiday' }
  ];
  const EXTRA_SHIFTS = SHIFTS.filter((s) => s.key !== 'day');
  let access = null;     // null = not checked yet, then true / false
  let checking = null;   // the in-flight check, so it only runs once
  let shift = 'day';     // the shift picked at the top of the tab
  let hours = DAY_HOURS; // shift length for the "what it comes to" figures

  const esc = (s) => AD.ui.esc(s);
  const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const money = (n) => '$' + Math.round(n).toLocaleString('en-AU');
  const money2 = (n) => '$' + Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const hrsText = (h) => `${Number(h.toFixed(2))}-hour`;
  const xText = (x) => `×${Number(x.toFixed(3))}`;

  /** Ask the database whether this user may see rates (once per session). */
  function checkAccess() {
    if (!checking) {
      checking = Promise.resolve(AD.sb.rpc('can_view_rates'))
        .then((res) => { access = !!(res && !res.error && res.data === true); })
        .catch(() => { access = false; });
    }
    return checking;
  }

  /** Base pay per hour (salary ÷ 1,976 or the hourly rate) and super. */
  function figures(r) {
    const salary = num(r.annualSalary), hourly = num(r.hourlyRate), sup = num(r.superPercent);
    // Salaried staff: always the salary ÷ 1,976 hours. Hourly staff: their rate.
    const payHour = r.payType !== 'Hourly' && salary != null ? salary / HOURS_PER_YEAR : hourly;
    return { salary, hourly, sup, payHour, salaryEquiv: hourly != null && salary == null ? hourly * HOURS_PER_YEAR : null };
  }

  /** Charge, pay multiplier, cost and margin per hour for one shift. */
  function shiftFig(r, base, key) {
    const sr = (r.shiftRates && r.shiftRates[key]) || {};
    const charge = key === 'day' ? num(r.chargeOutRate) : num(sr.charge);
    const setX = key === 'day' ? null : num(sr.payX);
    const payX = setX != null ? setX : 1;
    const payHour = base.payHour != null ? base.payHour * payX : null;
    const costHour = payHour != null ? payHour * (1 + (base.sup || 0) / 100) : null;
    const margin = charge != null && costHour != null ? charge - costHour : null;
    return { charge, payX, setX, payHour, costHour, margin, pct: margin != null && charge ? Math.round((margin / charge) * 100) : null };
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
        <div class="empty-tidy">${I.receipt}<span>No rates recorded for ${esc(first)} yet.<span class="empty-hint">Add their salary or hourly rate and the rates you charge clients for them — day, night, weekend and public holiday.</span></span></div>
        <p><button type="button" class="btn btn-primary" data-edit-rates>${I.plus} Add rates</button></p>
      </section>`;
    }
    const base = figures(r);
    const notRec = '<span class="muted">Not recorded</span>';
    const who = r.updatedBy ? (AD.logic && AD.logic.userName && AD.logic.userName(r.updatedBy)) || r.updatedBy : '';
    const details = [
      ['Pay type', esc(r.payType || 'Salary')],
      ['Annual salary', base.salary != null ? money(base.salary) : notRec],
      ['Hourly pay rate', base.payHour == null ? notRec
        : r.payType !== 'Hourly' && base.salary != null
          ? `${money2(base.payHour)}<span class="t2">Worked out from the salary — 52 weeks × 5 days × ${DAY_HOURS} hours</span>`
          : money2(base.payHour)],
      ['Super', base.sup != null ? `${base.sup}%` : notRec],
      ['Effective from', r.effectiveFrom ? AD.time.fmtKey(String(r.effectiveFrom).slice(0, 10)) : notRec],
      ['Notes', r.notes ? `<span class="rates-notes">${esc(r.notes)}</span>` : '<span class="muted">None</span>'],
      ['Last updated', r.updatedAt ? `${AD.time.fmtKey(String(r.updatedAt).slice(0, 10))}${who ? ` by ${esc(who)}` : ''}` : notRec]
    ];
    return `<section class="section">
      ${sectionHead({ title: 'Pay & charge-out rates', level: 3, actions: `<button type="button" class="btn btn-ghost btn-sm" data-edit-rates>${I.edit} Edit rates</button>` })}
      <div class="rate-calc-bar">
        <div class="seg" role="group" aria-label="Shift">${SHIFTS.map((s) => `<button type="button" data-shift-btn="${s.key}" class="${shift === s.key ? 'on' : ''}" aria-pressed="${shift === s.key}">${esc(s.label)}</button>`).join('')}</div>
        <label class="rate-hours"><span>Shift length</span><input type="number" data-rate-hours value="${hours}" min="0.25" max="24" step="0.1" inputmode="decimal" aria-label="Shift length in hours"><span>hours</span></label>
      </div>
      <div data-rate-calc>${calc(r, base)}</div>
      ${sectionHead({ title: 'Pay details', level: 3 })}
      <dl class="emp-details">${details.map(([dt, dd]) => `<div><dt>${esc(dt)}</dt><dd>${dd}</dd></div>`).join('')}</dl>
    </section>`;
  }

  /** The figures for the picked shift: KPI cards, the whole-shift totals and the all-shifts table. */
  function calc(r, base) {
    const s = SHIFTS.find((x) => x.key === shift) || SHIFTS[0];
    const f = shiftFig(r, base, s.key);
    const kpi = (label, value, sub, cls = '') => `<div class="cost-kpi${cls}"><span>${esc(label)}</span><strong>${value}</strong><small>${sub}</small></div>`;
    const payKpi = r.payType === 'Hourly'
      ? kpi('Hourly pay rate', base.hourly != null ? money2(base.hourly) : '—', base.salaryEquiv != null ? `≈ ${money(base.salaryEquiv)} a year (7.6-hr days)` : 'Hourly')
      : kpi('Annual salary', base.salary != null ? money(base.salary) : '—', base.payHour != null ? `≈ ${money2(base.payHour)}/hr (7.6-hr days)` : 'Salary');
    const costSub = [f.setX != null && f.setX !== 1 ? `pay ${xText(f.setX)}` : 'pay', base.sup != null ? `+ ${base.sup}% super` : '(no super % recorded)'].join(' ');
    const tot = (n) => (n != null ? money2(n * hours) : '—');
    const total = f.charge == null
      ? `<div class="rate-shift-total is-empty">${AD.icons.alert}<span>No ${esc(s.label)} charge-out rate set for this person yet. Use <b>Edit rates</b> to add one.</span></div>`
      : `<div class="rate-shift-total">
          <span class="rate-shift-what">A ${esc(hrsText(hours))} ${esc(s.label)} shift</span>
          <span><small>Charged to the client</small><b>${tot(f.charge)}</b></span>
          <span><small>Costs Astrea</small><b>${tot(f.costHour)}</b></span>
          <span class="${f.margin != null && f.margin < 0 ? 'is-negative' : ''}"><small>Margin</small><b>${tot(f.margin)}</b>${f.pct != null ? `<small>${f.pct}%</small>` : ''}</span>
        </div>`;
    const rows = SHIFTS.map((x) => {
      const g = shiftFig(r, base, x.key);
      return `<tr data-shift="${x.key}" class="${x.key === s.key ? 'is-on' : ''}" title="Show ${esc(x.label)} figures">
        <td>${esc(x.label)}</td>
        <td class="num">${g.charge != null ? money2(g.charge) : '<span class="muted">Not set</span>'}</td>
        <td class="num">${x.key === 'day' ? '<span class="muted">Base</span>' : g.setX != null ? xText(g.setX) : '<span class="muted">Same as day</span>'}</td>
        <td class="num">${g.costHour != null ? money2(g.costHour) : '—'}</td>
        <td class="num${g.margin != null && g.margin < 0 ? ' is-negative' : ''}">${g.margin != null ? `${money2(g.margin)}${g.pct != null ? ` <span class="t2-inline">${g.pct}%</span>` : ''}` : '—'}</td>
      </tr>`;
    }).join('');
    return `
      <div class="cost-kpis rate-kpis">
        ${payKpi}
        ${kpi(`${s.label} charge-out`, f.charge != null ? money2(f.charge) : '—', 'per hour, charged to clients')}
        ${kpi(`${s.label} cost per hour`, f.costHour != null ? money2(f.costHour) : '—', costSub)}
        ${kpi(`${s.label} margin per hour`, f.margin != null ? money2(f.margin) : '—', f.pct != null ? `${f.pct}% of the charge-out rate` : 'needs a charge-out rate and a pay rate', f.margin != null && f.margin < 0 ? ' is-negative' : '')}
      </div>
      ${total}
      <div class="table-wrap rate-shift-wrap"><table class="data rate-shift-table">
        <thead><tr><th>Shift</th><th class="num">Charge-out /hr</th><th class="num">Pay rate</th><th class="num">Cost /hr</th><th class="num">Margin /hr</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  function bind(el, e, redraw) {
    const b = el.querySelector('[data-edit-rates]');
    if (b) b.onclick = () => form(e, AD.store.get('employee_rates', e.id), () => redraw());
    const calcEl = el.querySelector('[data-rate-calc]');
    if (!calcEl) return;
    const r = AD.store.get('employee_rates', e.id);
    const base = figures(r);
    const pick = (key) => {
      shift = key;
      el.querySelectorAll('[data-shift-btn]').forEach((btn) => {
        const on = btn.dataset.shiftBtn === key;
        btn.classList.toggle('on', on);
        btn.setAttribute('aria-pressed', on);
      });
      calcEl.innerHTML = calc(r, base);
    };
    el.querySelectorAll('[data-shift-btn]').forEach((btn) => (btn.onclick = () => pick(btn.dataset.shiftBtn)));
    calcEl.addEventListener('click', (ev) => { const tr = ev.target.closest('tr[data-shift]'); if (tr) pick(tr.dataset.shift); });
    const hrsIn = el.querySelector('[data-rate-hours]');
    hrsIn.addEventListener('input', () => {
      const h = num(hrsIn.value);
      if (h == null || h <= 0 || h > 24) return; // keep the last good figure while typing
      hours = h;
      calcEl.innerHTML = calc(r, base);
    });
  }

  // ----------------------------------------------------------------- form
  function form(e, r, onSaved) {
    const { formData, showErrors, modal, toast, options } = AD.ui;
    const x = r || { payType: 'Salary', annualSalary: null, hourlyRate: null, chargeOutRate: null, superPercent: 12, effectiveFrom: '', notes: '', shiftRates: {} };
    const sr = x.shiftRates || {};
    const val = (v) => (v != null && v !== '' ? esc(v) : '');
    modal({
      title: `${r ? 'Edit' : 'Add'} rates — ${e.name}`,
      wide: true,
      body: `
        <form class="form-grid" novalidate>
          <div class="field"><label>Pay type</label><select name="payType">${options(PAY_TYPES, x.payType || 'Salary')}</select></div>
          <div class="field"><label>Effective from</label><input type="date" name="effectiveFrom" value="${x.effectiveFrom ? esc(String(x.effectiveFrom).slice(0, 10)) : ''}"></div>
          <div class="field" data-salary-field><label>Annual salary ($)</label><input type="number" name="annualSalary" value="${val(x.annualSalary)}" min="0" step="1" inputmode="decimal" placeholder="e.g. 95000">
            <div class="help">For salaried staff.</div></div>
          <div class="field"><label>Hourly pay rate ($)</label><input type="number" name="hourlyRate" value="${val(x.hourlyRate)}" min="0" step="0.01" inputmode="decimal" placeholder="e.g. 42.50">
            <div class="help" data-hr-help></div></div>
          <div class="field"><label>Day charge-out rate ($ per hour)</label><input type="number" name="chargeOutRate" value="${val(x.chargeOutRate)}" min="0" step="0.01" inputmode="decimal" placeholder="e.g. 120"></div>
          <div class="field"><label>Super (%)</label><input type="number" name="superPercent" value="${val(x.superPercent)}" min="0" max="100" step="0.1" inputmode="decimal" placeholder="e.g. 12"></div>
          <div class="field full">
            <label>Night, weekend &amp; public holiday rates</label>
            <div class="rate-shift-grid">
              <span></span><span class="rate-shift-h">Charge-out ($ per hour)</span><span class="rate-shift-h">Pay rate ×</span>
              ${EXTRA_SHIFTS.map((s) => `
                <span class="rate-shift-name">${esc(s.label)}</span>
                <input type="number" name="sr_${s.key}_charge" value="${val(sr[s.key] && sr[s.key].charge)}" min="0" step="0.01" inputmode="decimal" aria-label="${esc(s.label)} charge-out rate">
                <input type="number" name="sr_${s.key}_payX" value="${val(sr[s.key] && sr[s.key].payX)}" min="0" step="0.05" inputmode="decimal" placeholder="1" aria-label="${esc(s.label)} pay multiplier">`).join('')}
            </div>
            <div class="help"><b>Pay rate ×</b> is how much more this person is paid on that shift — e.g. 1.5 for time-and-a-half, 2 for double time. Leave it blank if their pay doesn’t change. Leave a charge-out rate blank if you don’t charge that shift.</div>
          </div>
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
          const shiftKeys = EXTRA_SHIFTS.flatMap((s) => [`sr_${s.key}_charge`, `sr_${s.key}_payX`]);
          ['annualSalary', 'hourlyRate', 'chargeOutRate', 'superPercent', ...shiftKeys].forEach((k) => {
            if (d[k] !== '' && d[k] != null && !(Number(d[k]) >= 0)) err[k] = 'Enter a number (0 or more).';
          });
          if (d.superPercent !== '' && Number(d.superPercent) > 100) err.superPercent = 'Enter a percentage up to 100.';
          if (d.payType === 'Hourly' && d.hourlyRate === '') err.hourlyRate = 'Enter the hourly pay rate.';
          if (d.payType === 'Salary' && d.annualSalary === '') err.annualSalary = 'Enter the annual salary.';
          if (!showErrors(f, err)) {
            const bad = shiftKeys.find((k) => err[k]);
            if (bad) toast('Check the night, weekend & public holiday rates — each must be a number (0 or more).', 'error');
            return;
          }
          const shiftRates = {};
          EXTRA_SHIFTS.forEach((s) => {
            const charge = num(d[`sr_${s.key}_charge`]), payX = num(d[`sr_${s.key}_payX`]);
            if (charge != null || payX != null) shiftRates[s.key] = { charge, payX };
          });
          const salaried = d.payType === 'Salary';
          const rec = {
            payType: d.payType,
            annualSalary: salaried ? num(d.annualSalary) : null,
            hourlyRate: salaried ? fromSalary(d.annualSalary) : num(d.hourlyRate),
            chargeOutRate: num(d.chargeOutRate),
            shiftRates,
            superPercent: num(d.superPercent), effectiveFrom: d.effectiveFrom || null, notes: d.notes,
            updatedAt: new Date().toISOString(), updatedBy: AD.currentUserEmail || ''
          };
          const write = (row) => (r ? AD.store.update('employee_rates', e.id, row) : AD.store.insert('employee_rates', Object.assign({ id: e.id, employeeId: e.id }, row)));
          saveBtn.disabled = true;
          try {
            try {
              await write(rec);
            } catch (err1) {
              // The shift-rates column arrived after the table was first made.
              const msg = String((err1 && (err1.message || err1.details || err1.hint)) || err1);
              if (!/pgrst204|42703|schema cache|could not find/i.test(msg)) throw err1;
              const rest = Object.assign({}, rec);
              delete rest.shiftRates;
              await write(rest);
              toast('Saved, but night / weekend / public holiday rates couldn’t be stored yet — run supabase/create-employee-rates.sql again in the Supabase SQL Editor.', 'error');
            }
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
