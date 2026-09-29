/*
 * Astrea vac truck illustration (side profile, cab facing left as in the
 * reference photo): white cab with the Astrea "A", silver vacuum tank with a
 * blue brand stripe, boom mast and hose over the cab, rear door and hose,
 * dark chassis and three axles.
 *
 * The drawing is defined ONCE as an SVG <symbol>. Every marker and thumbnail
 * reuses it with <use>, and the fleet number is a separate <text> layer on the
 * tank, so one graphic serves all eight trucks.
 */
window.AD = window.AD || {};

AD.truck = (function () {
  const SYMBOL = `
  <symbol id="vac-truck" viewBox="0 0 120 60">
    <ellipse cx="60" cy="54.6" rx="52" ry="3" fill="#101D35" opacity=".16"/>
    <!-- boom mast and suction hose over the cab -->
    <path d="M39.5 43 V6.5" stroke="#2a3140" stroke-width="3.4" stroke-linecap="round"/>
    <path d="M39.5 6.8 C49 3.6 55.5 9 52.3 17.5" stroke="#12161d" stroke-width="3.3" fill="none" stroke-linecap="round"/>
    <!-- chassis rail -->
    <rect x="8" y="40.5" width="104" height="5.5" rx="1.6" fill="#1d2330"/>
    <!-- rear equipment frame -->
    <rect x="106" y="19.5" width="7.5" height="23.5" rx="1.6" fill="#2f3747"/>
    <!-- vacuum tank -->
    <rect x="43" y="12.5" width="64" height="28.5" rx="12.5" fill="#c9d1db" stroke="#8793a3" stroke-width="1"/>
    <rect x="48" y="15.3" width="54" height="3.6" rx="1.8" fill="#f2f5f9"/>
    <rect x="52" y="13" width="2.3" height="27.5" fill="#98a3b2"/>
    <rect x="96" y="13" width="2.3" height="27.5" fill="#98a3b2"/>
    <rect x="56" y="36.6" width="38" height="2.5" rx="1.25" fill="#2463EB"/>
    <rect x="60.5" y="9.4" width="9" height="4" rx="1" fill="#8793a3"/>
    <!-- rear door -->
    <ellipse cx="106" cy="26.8" rx="4.6" ry="12.8" fill="#b4becb" stroke="#8793a3" stroke-width="1"/>
    <!-- rear hose -->
    <path d="M112.5 23 C121 25 120.5 39.5 115.2 49" stroke="#12161d" stroke-width="3.3" fill="none" stroke-linecap="round"/>
    <!-- cab -->
    <path d="M5 44 V27 Q5 23 7.5 19.5 L12 12.5 Q13.5 10.5 16.5 10.5 H32 Q35 10.5 35 13.5 V44 Z" fill="#ffffff" stroke="#aeb8c6" stroke-width="1"/>
    <path d="M10.5 22 L14.2 15.4 Q14.9 14.3 16.3 14.3 H24.5 V22 Z" fill="#26344f"/>
    <rect x="26.5" y="14.3" width="6" height="7.7" rx="1" fill="#26344f"/>
    <path d="M19.2 37 L22.6 28.4 L26 37" stroke="#2463EB" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="3" y="39.5" width="7" height="4.5" rx="1" fill="#1d2330"/>
    <rect x="5" y="31.5" width="3" height="3" rx=".8" fill="#dfe5ec"/>
    <!-- wheels -->
    <g fill="#161b24"><circle cx="21" cy="46.5" r="7"/><circle cx="80" cy="46.5" r="7"/><circle cx="96" cy="46.5" r="7"/></g>
    <g fill="#8a95a5"><circle cx="21" cy="46.5" r="2.8"/><circle cx="80" cy="46.5" r="2.8"/><circle cx="96" cy="46.5" r="2.8"/></g>
  </symbol>`;

  // Inject the shared symbol once per document.
  if (!document.getElementById('vac-truck')) {
    document.body.insertAdjacentHTML('afterbegin',
      `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>${SYMBOL}</defs></svg>`);
  }

  /** "VAC-03" → "03" */
  const num = (id) => String(id).replace(/^\D*-?/, '').padStart(2, '0').slice(-2);

  /** Truck graphic with the fleet number on the tank. */
  function svg(number, width = 88, label = '') {
    const h = Math.round(width / 2);
    return `<svg class="vac-svg" viewBox="0 0 120 60" width="${width}" height="${h}" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'} focusable="false">
      <use href="#vac-truck"/>
      <text x="75" y="27.4" class="vac-num" text-anchor="middle" dominant-baseline="central">${number}</text>
    </svg>`;
  }

  return { svg, num };
})();
