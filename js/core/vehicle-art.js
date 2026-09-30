/*
 * Astrea vehicle illustrations, side profile, front facing left.
 *
 *   vac() — white cab with the Astrea "A", silver vacuum tank with a blue
 *           brand stripe, boom mast and hose over the cab, three axles.
 *           Takes a fleet number, drawn on the tank.
 *   ute() — white dual cab with the Astrea wordmark on the front door.
 *           Identical for every ute, so it takes no number.
 *
 * Each drawing is defined ONCE as an SVG <symbol>; markers and thumbnails
 * reuse it with <use>. The vac truck's fleet number is a separate <text>
 * layer per instance, which is why it sits outside the symbol.
 */
window.AD = window.AD || {};

AD.art = (function () {
  const VAC = `
  <symbol id="art-vac" viewBox="0 0 120 60">
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

  // The wordmark is styled with presentation attributes rather than a CSS
  // class: it lives inside the <symbol>, and styling cloned <use> content
  // from a stylesheet is inconsistent across browsers.
  const UTE = `
  <symbol id="art-ute" viewBox="0 0 120 60">
    <ellipse cx="60" cy="54.6" rx="48" ry="3" fill="#101D35" opacity=".16"/>
    <!-- side step, tucked under the sill between the arches -->
    <rect x="36" y="42.5" width="50" height="3.2" rx="1.2" fill="#1d2330"/>
    <!-- body. The tray rail sits 1.5 below the bonnet line so the tub reads
         as a separate box rather than one slab running the whole length. -->
    <path d="M7.4 37 L8.6 31 Q9 29.6 10.6 29.4 L33 27.4 L45 16.2 L72 16.2 L77 29.5 L111 29.5 L111 43
             L102 43 Q94 32.5 86 43 L36 43 Q28 32.5 20 43 L7.4 43 Z"
          fill="#ffffff" stroke="#aeb8c6" stroke-width="1" stroke-linejoin="round"/>
    <!-- cab/tray seam, tray swage line, tailgate -->
    <path d="M77.8 30.3 V42.4 M105 30.5 V42.4" stroke="#d3dae3" stroke-width="1"/>
    <path d="M79.5 35.8 H105" stroke="#e2e8ef" stroke-width="1"/>
    <!-- glass: windscreen, front door, rear door -->
    <path d="M35 27.2 L45 17.4 L47 17.4 L47 27.2 Z" fill="#26344f"/>
    <rect x="48.5" y="17.4" width="14.8" height="9.8" rx="1" fill="#26344f"/>
    <rect x="64.8" y="17.4" width="7.2" height="9.8" rx="1" fill="#26344f"/>
    <!-- door seams -->
    <path d="M47.5 28.6 V42.4 M64 28.6 V42.4 M76.5 29.8 V42.4" stroke="#d3dae3" stroke-width="1"/>
    <!-- door handles -->
    <rect x="58" y="30.6" width="4" height="1.5" rx=".7" fill="#c3ccd7"/>
    <rect x="71.5" y="30.6" width="4" height="1.5" rx=".7" fill="#c3ccd7"/>
    <!-- Astrea wordmark on the front door -->
    <text x="55.7" y="37" text-anchor="middle" textLength="14" lengthAdjust="spacingAndGlyphs"
          font-family="'Segoe UI Variable Display','Segoe UI',system-ui,sans-serif"
          font-size="6" font-weight="700" fill="#2463EB">Astrea</text>
    <!-- mirror on the A-pillar -->
    <path d="M40.2 21.9 L37.2 22.7" stroke="#8b96a4" stroke-width="1.7" fill="none" stroke-linecap="round"/>
    <!-- headlight swept back along the nose, then the bumper -->
    <path d="M9.2 31.4 L14.6 31 Q15.4 30.9 15.4 31.8 L15.4 34.2 Q15.4 35 14.6 35 L8.9 35 Z" fill="#dfe5ec"/>
    <rect x="5.8" y="38.2" width="9" height="4.8" rx="1.3" fill="#1d2330"/>
    <!-- wheels -->
    <g fill="#161b24"><circle cx="28" cy="46.5" r="7.5"/><circle cx="94" cy="46.5" r="7.5"/></g>
    <g fill="#8a95a5"><circle cx="28" cy="46.5" r="3"/><circle cx="94" cy="46.5" r="3"/></g>
  </symbol>`;

  // Inject the shared symbols once per document.
  if (!document.getElementById('art-vac')) {
    document.body.insertAdjacentHTML('afterbegin',
      `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>${VAC}${UTE}</defs></svg>`);
  }

  const open = (width, label) => {
    const h = Math.round(width / 2);
    return `<svg class="veh-svg" viewBox="0 0 120 60" width="${width}" height="${h}" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'} focusable="false">`;
  };

  /** "VAC-03" → "03" */
  const num = (id) => String(id).replace(/^\D*-?/, '').padStart(2, '0').slice(-2);

  /** Vac truck, with the fleet number on the tank. */
  function vac(number, width = 88, label = '') {
    return `${open(width, label)}<use href="#art-vac"/>
      <text x="75" y="27.4" class="vac-num" text-anchor="middle" dominant-baseline="central">${number}</text></svg>`;
  }

  /** Dual cab ute. Same for every ute, so there's no number to pass. */
  function ute(width = 88, label = '') {
    return `${open(width, label)}<use href="#art-ute"/></svg>`;
  }

  return { vac, ute, num };
})();
