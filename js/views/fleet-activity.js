/* Live GPS and read-only report panel. Booking and measured activity stay separate. */
AD.fleetActivity = (function () {
  const N = AD.telematics, T = AD.time, esc = AD.ui.esc;
  const fmt = n => n.toLocaleString('en-AU', { maximumFractionDigits: 1 });
  let selection = { day: '', days: 1, capacity: null };
  function mount(root, vehicles, day) {
    if (!root) return () => {};
    let alive = true, snapshot = null, report = null, liveError = '', reportError = '';
    let days = selection.day === day ? selection.days : 1, capacity = selection.day === day ? selection.capacity : null;
    let reportLoading = false, liveLoading = false, request = 0;
    let liveTimer = null, reportTimer = null;
    const future = day > T.todayKey();
    root.innerHTML = `
      <div class="section-head"><div><h2>Fleet activity</h2><span class="muted">${vehicles.length} owned vac trucks · GPS activity alongside your bookings</span></div>
        <button class="btn btn-secondary" data-gps-refresh type="button">Refresh GPS</button></div>
      <div class="fa-live-status muted small" role="status"></div>
      <div class="fa-kpis"></div>
      <div class="fa-report-head"><div><h3>Recorded activity</h3><p class="muted small">Netstar reports · available readings only</p></div>
        <div class="fa-controls"><label>Period<select data-report-period ${future ? 'disabled' : ''}>
          <option value="1">${day === T.todayKey() ? 'Today so far' : 'Selected day'}</option>
          <option value="7">7 days ending ${esc(T.fmtKey(day))}</option><option value="30">30 days ending ${esc(T.fmtKey(day))}</option>
        </select></label><label>Available hours per truck in this period<input data-capacity type="number" min="0.1" max="744" step="0.1" placeholder="Enter to calculate %"></label>
        <button type="button" class="btn btn-secondary" data-report-refresh ${future ? 'disabled' : ''}>Refresh reports</button></div></div>
      <p class="fa-report-status muted small" role="status"></p>
      <div class="fa-reports"></div>
      <p class="section-foot muted small">Reported work hours and ignition-on hours are separate measures, not engine-meter readings. Stationary operation can be productive for a vac truck. Missing readings are shown as —, not zero.</p>`;
    const q = selector => root.querySelector(selector);
    q('[data-report-period]').value = String(days);
    q('[data-capacity]').value = capacity || '';
    const age = seen => seen ? `Last reported ${T.fmtDateTime(seen)}` : 'No reliable report time';
    const currentBooking = v => AD.logic.bookingsFor(v.id).some(b => b.status !== 'cancelled' && Date.parse(b.start) <= Date.now() && Date.parse(b.end) > Date.now());
    function paintLive() {
      if (!alive) return;
      const statuses = vehicles.map(v => ({ v, s: N.position(v, snapshot) }));
      const moving = statuses.filter(x => x.s.kind === 'moving').length;
      const stationary = statuses.filter(x => x.s.kind === 'stationary').length;
      const unplanned = statuses.filter(x => ['moving', 'stationary'].includes(x.s.kind) && !currentBooking(x.v)).length;
      const missing = statuses.filter(x => ['unknown', 'stale'].includes(x.s.kind)).length;
      q('[data-gps-refresh]').disabled = liveLoading;
      q('.fa-live-status').textContent = liveError || (snapshot ? `GPS checked ${T.fmtTime(snapshot.fetchedAt || Date.now())} · refreshes every minute while this page is visible · readings older than 15 minutes are flagged` : liveLoading ? 'Connecting to Netstar…' : 'Waiting for Netstar');
      const cards = [['Moving now', moving], ['Stationary · ignition on', stationary], ['Active without a current booking', unplanned], ['Stale / unknown GPS', missing]];
      q('.fa-kpis').innerHTML = cards.map(([label, n], i) => `<div class="fa-kpi${i > 1 && n ? ' fa-caution' : ''}"><span>${esc(label)}</span><strong>${snapshot ? n : '—'}</strong><small>${snapshot ? `of ${vehicles.length} owned vac trucks` : 'Awaiting GPS data'}</small></div>`).join('');
      const host = root.parentElement;
      host.querySelectorAll('[data-live-vehicle]').forEach(cell => {
        const x = statuses.find(x => x.v.id === cell.dataset.liveVehicle);
        if (!x) return;
        const { s, v } = x;
        const warn = ['moving', 'stationary'].includes(s.kind) && !currentBooking(v);
        cell.innerHTML = `<a class="fa-state fa-${s.kind}" href="#/tracker?mode=live&truck=${encodeURIComponent(v.id)}">${esc(s.label)}</a>
          <span class="t2">${esc(s.p?.location || s.p?.city || '')}</span><span class="t2">${esc(age(s.seen))}${liveError ? ' · refresh failed' : ''}</span>
          ${warn ? '<span class="flag flag-amber">Activity without a current booking</span>' : ''}`;
      });
    }
    async function refreshLive(force = false) {
      clearTimeout(liveTimer);
      if (!alive || liveLoading || document.hidden) return;
      liveLoading = true; paintLive();
      try { const result = await N.getLive(force); if (alive) { snapshot = result; liveError = ''; } }
      catch (e) { if (alive) liveError = e.message + (snapshot ? ' Showing the last successful GPS response.' : ''); }
      finally { if (alive) { liveLoading = false; paintLive(); liveTimer = setTimeout(() => refreshLive(), liveError ? 60000 : N.liveDueIn()); } }
    }
    function paintReports() {
      if (!alive) return;
      const from = T.addDays(day, 1 - days);
      q('[data-report-refresh]').disabled = reportLoading || future;
      q('.fa-report-status').textContent = future ? 'Actual activity is available for today and past dates. Future bookings remain in the planning chart.'
        : reportError || (reportLoading ? 'Fetching Netstar activity reports…' : report ? `${T.fmtKey(from)} – ${T.fmtKey(day)}${day === T.todayKey() ? ' · today is partial' : ''} · fetched ${T.fmtTime(report.fetchedAt)} · automatic refresh every 10 minutes while visible` : 'Waiting for report data');
      if (!report) {
        q('.fa-reports').innerHTML = `<p class="empty">${future ? 'Select today or an earlier schedule date to see recorded activity.' : reportLoading ? 'Loading work hours, ignition, idle and distance…' : 'No report data available yet.'}</p>`;
        return;
      }
      const periodHours = (Date.parse(report.to) - Date.parse(report.from)) / 3600000;
      const data = vehicles.map(v => ({ v, values: Object.fromEntries(Object.keys(N.SPECS).map(key => [key, N.reportMetric(report.reports?.[key], key, v, report.vehicles, Number.isFinite(periodHours) ? periodHours : null)])) }));
      const max = Math.max(1, ...data.map(x => x.values.work.value || 0), capacity || 0);
      const total = data.reduce((sum, x) => sum + (x.values.work.value || 0), 0);
      const covered = data.filter(x => x.values.work.value !== null).length;
      const available = capacity > 0;
      const percent = available && covered === vehicles.length && covered ? `${fmt(total / (capacity * covered) * 100)}%` : '—';
      q('.fa-reports').innerHTML = `
        <div class="fa-report-summary"><div><span>Reported work hours</span><strong>${covered ? fmt(total) + ' h' : '—'}</strong><small>${covered}/${vehicles.length} trucks with usable readings${covered !== vehicles.length ? ' · partial coverage' : ''}</small></div>
          <div><span>Reported-work utilisation</span><strong>${percent}</strong><small>${available ? `${fmt(capacity)} available hours per truck · all trucks must have readings` : 'Enter available hours for this period to calculate'}</small></div></div>
        <div class="table-wrap"><table class="data fa-report-table"><thead><tr><th>Truck</th><th>Reported work</th><th>Ignition on</th><th>Reported idle</th><th>Distance</th><th>Utilisation</th></tr></thead><tbody>
          ${data.map(({ v, values: m }) => `<tr><td><a href="#/vehicle/${encodeURIComponent(v.id)}">${esc(v.id)}</a><span class="t2">${esc(v.rego)}</span></td>
            ${Object.keys(N.SPECS).map(k => `<td title="${esc(m[k].reason)}">${m[k].value === null ? '<span class="muted">—</span>' : `${fmt(m[k].value)} ${k === 'trips' ? 'km' : 'h'}`}${k === 'work' && m[k].value !== null ? `<span class="fa-bar"><i style="width:${Math.min(100, m[k].value / max * 100)}%"></i></span>` : ''}</td>`).join('')}
            <td>${available && m.work.value !== null ? `${fmt(m.work.value / capacity * 100)}%` : '—'}</td></tr>`).join('')}
        </tbody></table></div>
        <p class="muted small">Utilisation = reported work hours ÷ the available hours you enter. This is a comparison of Netstar’s work measure, not a verified measure of productive pumping time.</p>
        <div class="fa-sources">${Object.entries(N.SPECS).map(([key, spec]) => {
          const source = report.reports?.[key];
          const count = data.filter(x => x.values[key].value !== null).length;
          return `<details><summary>${esc(spec.title)} · ${source?.ok ? `${count}/${vehicles.length} readings` : 'unavailable'}</summary>
            <p class="muted small">${esc(source?.ok ? 'Readings are only charted when vehicle matching and units are unambiguous. This is the original Netstar response for checking missing fields.' : source?.error || 'No response')}</p>
            ${source?.ok ? `<pre tabindex="0">${esc(JSON.stringify(source.payload, null, 2).slice(0, 100000))}</pre>${JSON.stringify(source.payload).length > 70000 ? '<p class="muted small">Large response: this preview may be shortened.</p>' : ''}` : ''}</details>`;
        }).join('')}</div>`;
    }
    async function refreshReports(force = false) {
      clearTimeout(reportTimer);
      if (!alive || future || document.hidden) return;
      const version = ++request;
      reportLoading = true; reportError = ''; paintReports();
      try {
        const result = await N.getReports(vehicles, T.addDays(day, 1 - days), day, force);
        if (alive && request === version) report = result;
      } catch (e) { if (alive && request === version) reportError = e.message + (report ? ' Showing the previous response for this period.' : ''); }
      finally { if (alive && request === version) {
        reportLoading = false; paintReports();
        reportTimer = setTimeout(() => refreshReports(), reportError ? 600000 : N.reportsDueIn(vehicles, T.addDays(day, 1 - days), day));
      } }
    }
    q('[data-gps-refresh]').onclick = () => refreshLive(true);
    q('[data-report-refresh]').onclick = () => refreshReports(true);
    q('[data-report-period]').onchange = e => { days = Number(e.target.value); report = null; capacity = null; selection = { day, days, capacity }; q('[data-capacity]').value = ''; refreshReports(); };
    q('[data-capacity]').oninput = e => { const n = Number(e.target.value); capacity = n > 0 && n <= days * 25 ? n : null; selection = { day, days, capacity }; paintReports(); };
    const visibility = () => { if (!document.hidden) { refreshLive(); refreshReports(); } };
    document.addEventListener('visibilitychange', visibility);
    paintLive(); paintReports(); refreshLive(); refreshReports();
    return () => { alive = false; ++request; clearTimeout(liveTimer); clearTimeout(reportTimer); document.removeEventListener('visibilitychange', visibility); };
  }
  return { mount };
})();
