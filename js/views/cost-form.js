/* Manual vehicle costs: registration, insurance and other non-fuel spend. */
window.AD = window.AD || {};

AD.COST_CATEGORIES = ['Registration', 'Insurance', 'Fuel', 'Servicing', 'Repairs', 'Tyres', 'Tolls', 'Finance', 'Other'];

AD.vehicleCostForm = function (vehicleId, done) {
  const { esc, options, formData, showErrors, modal, toast } = AD.ui;
  const vehicle = AD.store.get('vehicles', vehicleId);
  if (!vehicle) return toast('Vehicle not found.', 'error');

  const today = AD.time.todayKey();
  modal({
    title: `Add cost · ${vehicle.id}`,
    body: `
      <p class="modal-lede">Add an individual cost to <b>${esc(vehicle.id)}</b> · ${esc(vehicle.rego)}. Imported fuel is added automatically and does not need to be entered again.</p>
      <form class="form-grid" novalidate>
        <div class="field"><label>Cost date <span class="req">*</span></label><input type="date" name="date" value="${today}" max="${today}"></div>
        <div class="field"><label>Cost type <span class="req">*</span></label><select name="category">${options(AD.COST_CATEGORIES, 'Registration')}</select></div>
        <div class="field"><label>Amount (AUD, inc. GST) <span class="req">*</span></label><input type="number" name="amount" min="0.01" step="0.01" inputmode="decimal" placeholder="0.00"></div>
        <div class="field"><label>Supplier / provider</label><input type="text" name="supplier" maxlength="120" placeholder="e.g. NRMA, Service NSW"></div>
        <div class="field"><label>Reference</label><input type="text" name="reference" maxlength="100" placeholder="Invoice, policy or receipt number"></div>
        <div class="field"><label>Renewal / expiry date</label><input type="date" name="renewalDate"><div class="help">Useful for registration and insurance reminders.</div></div>
        <div class="field full"><label>Description</label><textarea name="description" rows="3" maxlength="500" placeholder="What this payment covered"></textarea></div>
      </form>
      <div class="form-actions">
        <button class="btn btn-ghost" data-close type="button">Cancel</button>
        <button class="btn btn-primary" data-save type="button">Save cost</button>
      </div>`,
    onMount(el, close) {
      const form = el.querySelector('form');
      const save = el.querySelector('[data-save]');
      el.querySelector('[data-close]').onclick = close;
      save.onclick = async () => {
        const d = formData(form);
        const errors = {};
        if (!d.date) errors.date = 'Enter the payment date.';
        else if (d.date > today) errors.date = 'The payment date can’t be in the future.';
        if (!AD.COST_CATEGORIES.includes(d.category)) errors.category = 'Choose a cost type.';
        if (!(Number(d.amount) > 0)) errors.amount = 'Enter an amount greater than zero.';
        if (d.renewalDate && d.renewalDate < d.date) errors.renewalDate = 'The renewal date must be on or after the payment date.';
        if (!showErrors(form, errors)) return;

        save.disabled = true;
        try {
          await AD.store.insert('vehicle_costs', {
            vehicleId: vehicle.id,
            date: d.date,
            category: d.category,
            amount: Number(d.amount),
            supplier: d.supplier,
            description: d.description,
            reference: d.reference,
            renewalDate: d.renewalDate || null,
            source: 'Manual',
            createdAt: new Date().toISOString()
          }, 'cost');
          await AD.store.log(`${d.category} cost added for ${vehicle.id}: ${AD.logic.fmtAUD(Number(d.amount))}`, vehicle.id);
        } catch (err) {
          save.disabled = false;
          const msg = String((err && (err.message || err.details || err.hint)) || err);
          const missing = /vehicle_costs|schema cache|relation .* does not exist|could not find the table/i.test(msg);
          toast(missing ? 'The vehicle costs table has not been created in Supabase yet.' : `Could not save cost: ${msg}`, 'error');
          return;
        }
        toast(`${d.category} cost saved for ${vehicle.id}`);
        close();
        if (done) done();
      };
    }
  });
};
