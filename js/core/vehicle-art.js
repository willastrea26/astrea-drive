/*
 * Astrea vehicle illustrations, side profile, front facing left.
 *
 *   vac()  — white cab with the Astrea "A", silver vacuum tank, boom and
 *            hose over the cab, three axles. Takes a fleet number.
 *   ute()  — white dual cab, wordmark on the front door.
 *   tip()  — white tipper, high-sided body with a raised headboard.
 *   dig()  — light blue tracked excavator, wordmark on the house.
 *
 * Every drawing shares the same 120x60 viewBox and ground line (wheels
 * centred on y=46.5, shadow at y=54.6) so they sit consistently wherever
 * they appear together. Each is defined ONCE as an SVG <symbol> and reused
 * with <use>; the vac truck's fleet number is a separate <text> layer per
 * instance, which is why it sits outside the symbol.
 *
 * The door decal is the real brand wordmark (assets/wordmark-*.png) rather
 * than set type, so it matches the logo exactly. Blue on white panels,
 * white on the excavator's blue. Paths are relative to index.html.
 */
window.AD = window.AD || {};

AD.art = (function () {
  // 320x75 artwork, so height is width * 0.2344.
  const mark = (tone, x, y, w) =>
    `<image href="assets/wordmark-${tone}.png" x="${x}" y="${y}" width="${w}" height="${(w * 0.2344).toFixed(2)}"/>`;

  const VAC = `
  <symbol id="art-vac" viewBox="0 0 120 60">
    <ellipse cx="60" cy="54.6" rx="52" ry="3" fill="#101D35" opacity=".16"/>
    <!-- boom mast and suction hose over the cab -->
    <path d="M39.5 43 V6.5" stroke="#2a3140" stroke-width="3.4" stroke-linecap="round"/>
    <path d="M39.5 6.8 C49 3.6 55.5 9 52.3 17.5" stroke="#12161d" stroke-width="3.3" fill="none" stroke-linecap="round"/>
    <rect x="8" y="40.5" width="104" height="5.5" rx="1.6" fill="#1d2330"/>
    <rect x="106" y="19.5" width="7.5" height="23.5" rx="1.6" fill="#2f3747"/>
    <!-- vacuum tank -->
    <rect x="43" y="12.5" width="64" height="28.5" rx="12.5" fill="#c9d1db" stroke="#8793a3" stroke-width="1"/>
    <rect x="48" y="15.3" width="54" height="3.6" rx="1.8" fill="#f2f5f9"/>
    <rect x="52" y="13" width="2.3" height="27.5" fill="#98a3b2"/>
    <rect x="96" y="13" width="2.3" height="27.5" fill="#98a3b2"/>
    <rect x="56" y="36.6" width="38" height="2.5" rx="1.25" fill="#2463EB"/>
    <rect x="60.5" y="9.4" width="9" height="4" rx="1" fill="#8793a3"/>
    <ellipse cx="106" cy="26.8" rx="4.6" ry="12.8" fill="#b4becb" stroke="#8793a3" stroke-width="1"/>
    <path d="M112.5 23 C121 25 120.5 39.5 115.2 49" stroke="#12161d" stroke-width="3.3" fill="none" stroke-linecap="round"/>
    <!-- cab -->
    <path d="M5 44 V27 Q5 23 7.5 19.5 L12 12.5 Q13.5 10.5 16.5 10.5 H32 Q35 10.5 35 13.5 V44 Z" fill="#ffffff" stroke="#aeb8c6" stroke-width="1"/>
    <path d="M10.5 22 L14.2 15.4 Q14.9 14.3 16.3 14.3 H24.5 V22 Z" fill="#26344f"/>
    <rect x="26.5" y="14.3" width="6" height="7.7" rx="1" fill="#26344f"/>
    <path d="M19.2 37 L22.6 28.4 L26 37" stroke="#2463EB" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="3" y="39.5" width="7" height="4.5" rx="1" fill="#1d2330"/>
    <rect x="5" y="31.5" width="3" height="3" rx=".8" fill="#dfe5ec"/>
    <g fill="#161b24"><circle cx="21" cy="46.5" r="7"/><circle cx="80" cy="46.5" r="7"/><circle cx="96" cy="46.5" r="7"/></g>
    <g fill="#8a95a5"><circle cx="21" cy="46.5" r="2.8"/><circle cx="80" cy="46.5" r="2.8"/><circle cx="96" cy="46.5" r="2.8"/></g>
  </symbol>`;

  const UTE = `
  <symbol id="art-ute" viewBox="0 0 120 60">
    <ellipse cx="60" cy="54.6" rx="48" ry="3" fill="#101D35" opacity=".16"/>
    <rect x="36" y="42.5" width="50" height="3.2" rx="1.2" fill="#1d2330"/>
    <!-- body. The tray rail sits 1.5 below the bonnet line so the tub reads
         as a separate box rather than one slab running the whole length. -->
    <path d="M7.4 37 L8.6 31 Q9 29.6 10.6 29.4 L33 27.4 L45 16.2 L72 16.2 L77 29.5 L111 29.5 L111 43
             L102 43 Q94 32.5 86 43 L36 43 Q28 32.5 20 43 L7.4 43 Z"
          fill="#ffffff" stroke="#aeb8c6" stroke-width="1" stroke-linejoin="round"/>
    <path d="M77.8 30.3 V42.4 M105 30.5 V42.4" stroke="#d3dae3" stroke-width="1"/>
    <path d="M79.5 35.8 H105" stroke="#e2e8ef" stroke-width="1"/>
    <path d="M35 27.2 L45 17.4 L47 17.4 L47 27.2 Z" fill="#26344f"/>
    <rect x="48.5" y="17.4" width="14.8" height="9.8" rx="1" fill="#26344f"/>
    <rect x="64.8" y="17.4" width="7.2" height="9.8" rx="1" fill="#26344f"/>
    <path d="M47.5 28.6 V42.4 M64 28.6 V42.4 M76.5 29.8 V42.4" stroke="#d3dae3" stroke-width="1"/>
    <rect x="58" y="30.6" width="4" height="1.5" rx=".7" fill="#c3ccd7"/>
    <rect x="71.5" y="30.6" width="4" height="1.5" rx=".7" fill="#c3ccd7"/>
    ${mark('blue', 48.6, 33.6, 14.6)}
    <path d="M40.2 21.9 L37.2 22.7" stroke="#8b96a4" stroke-width="1.7" fill="none" stroke-linecap="round"/>
    <path d="M9.2 31.4 L14.6 31 Q15.4 30.9 15.4 31.8 L15.4 34.2 Q15.4 35 14.6 35 L8.9 35 Z" fill="#dfe5ec"/>
    <rect x="5.8" y="38.2" width="9" height="4.8" rx="1.3" fill="#1d2330"/>
    <g fill="#161b24"><circle cx="28" cy="46.5" r="7.5"/><circle cx="94" cy="46.5" r="7.5"/></g>
    <g fill="#8a95a5"><circle cx="28" cy="46.5" r="3"/><circle cx="94" cy="46.5" r="3"/></g>
  </symbol>`;

  const TIP = `
  <symbol id="art-tip" viewBox="0 0 120 60">
    <ellipse cx="60" cy="54.6" rx="52" ry="3" fill="#101D35" opacity=".16"/>
    <rect x="8" y="40.5" width="99" height="5.5" rx="1.6" fill="#1d2330"/>
    <!-- hoist ram, tucked between chassis and body -->
    <path d="M47 41.5 L40.5 33" stroke="#8a95a5" stroke-width="2.6" stroke-linecap="round"/>
    <!-- tipping body. The headboard stands proud of the side rail to shield
         the cab, which is the silhouette that reads as a tipper. -->
    <path d="M37.5 10 H42.5 V16.8 H104 V38.5 H37.5 Z" fill="#ffffff" stroke="#aeb8c6" stroke-width="1" stroke-linejoin="round"/>
    <rect x="42.5" y="16.8" width="61.5" height="1.9" fill="#2463EB"/>
    <rect x="37.5" y="10" width="5" height="1.9" fill="#2463EB"/>
    <path d="M54 19.5 V38 M68 19.5 V38 M82 19.5 V38 M96 19.5 V38" stroke="#e2e8ef" stroke-width="1"/>
    <!-- tailgate hinge -->
    <circle cx="103" cy="20.8" r="1.6" fill="#8a95a5"/>
    <!-- cab -->
    <path d="M5 44 V27 Q5 23 7.5 19.5 L12 12.5 Q13.5 10.5 16.5 10.5 H32 Q35 10.5 35 13.5 V44 Z" fill="#ffffff" stroke="#aeb8c6" stroke-width="1"/>
    <path d="M10.5 22 L14.2 15.4 Q14.9 14.3 16.3 14.3 H24.5 V22 Z" fill="#26344f"/>
    <rect x="26.5" y="14.3" width="6" height="7.7" rx="1" fill="#26344f"/>
    ${mark('blue', 10.5, 29.5, 22)}
    <rect x="3" y="39.5" width="7" height="4.5" rx="1" fill="#1d2330"/>
    <rect x="5" y="31.5" width="3" height="3" rx=".8" fill="#dfe5ec"/>
    <g fill="#161b24"><circle cx="21" cy="46.5" r="7"/><circle cx="80" cy="46.5" r="7"/><circle cx="94" cy="46.5" r="7"/></g>
    <g fill="#8a95a5"><circle cx="21" cy="46.5" r="2.8"/><circle cx="80" cy="46.5" r="2.8"/><circle cx="94" cy="46.5" r="2.8"/></g>
  </symbol>`;

  // Sedan silhouette (Astrea Car). The hired variant below shares every path
  // except the body/stroke colours — change one, change both.
  const carBody = (body, stroke, mark_tone) => `
    <ellipse cx="60" cy="54.6" rx="48" ry="3" fill="#101D35" opacity=".16"/>
    <path d="M 9 44 L 7.5 41 Q 7 38 10 36.5 L 24 31 L 36 23 Q 42 18 50 17.5 L 72 17.5 Q 82 18.5 89 24 L 107 32 Q 112 33 112.5 37 L 112 41 L 111 44 L 104 44 A 10 10 0 0 0 86 44 L 34 44 A 10 10 0 0 0 16 44 Z"
          fill="${body}" stroke="${stroke}" stroke-width=".9" stroke-linejoin="round"/>
    <path d="M 37 23.5 Q 42 19 50 19 L 58.5 19 L 58.5 29 L 32 29 Z" fill="#1a3550"/>
    <rect x="59.5" y="19" width="10" height="10" fill="#1a3550"/>
    <path d="M 70.5 19 L 80 19 Q 85 19.5 89 25 L 89 29 L 70.5 29 Z" fill="#1a3550"/>
    <rect x="58.5" y="19" width="1" height="10" fill="#2a3f55"/>
    <rect x="69.5" y="19" width="1" height="10" fill="#2a3f55"/>
    <path d="M59 29 L59 42 M70 29 L70 42" stroke="${stroke}" stroke-width=".7"/>
    <rect x="48" y="34.3" width="6" height="1.4" rx=".6" fill="${stroke}"/>
    <rect x="75" y="34.3" width="6" height="1.4" rx=".6" fill="${stroke}"/>
    ${mark(mark_tone, 42, 36, 14)}
    <path d="M 9 36.5 L 15 36.3 L 15.5 38 L 10.5 39.5 Z" fill="#f0f4f8"/>
    <path d="M 106 36.5 L 112 37 L 112 39.5 L 106.5 39.5 Z" fill="#c93f3f"/>
    <g fill="#161b24"><circle cx="25" cy="46.5" r="8"/><circle cx="95" cy="46.5" r="8"/></g>
    <g fill="#4a5568"><circle cx="25" cy="46.5" r="4.8"/><circle cx="95" cy="46.5" r="4.8"/></g>
    <g fill="#1a2130"><circle cx="25" cy="46.5" r="1.8"/><circle cx="95" cy="46.5" r="1.8"/></g>`;
  const CAR     = `<symbol id="art-car"     viewBox="0 0 120 60">${carBody('#4a90c4', '#2a5c82', 'white')}</symbol>`;
  const CAR_RED = `<symbol id="art-car-red" viewBox="0 0 120 60">${carBody('#c23b3b', '#7a2626', 'white')}</symbol>`;

  const DIG = `
  <symbol id="art-dig" viewBox="0 0 120 60">
    <ellipse cx="62" cy="54.6" rx="42" ry="3" fill="#101D35" opacity=".16"/>
    <!-- tracked undercarriage -->
    <rect x="28" y="43" width="68" height="10.5" rx="5.25" fill="#2a3140"/>
    <g fill="#4a5568">
      <circle cx="34.5" cy="48.2" r="3.4"/><circle cx="89.5" cy="48.2" r="3.4"/>
      <circle cx="48" cy="50.4" r="1.8"/><circle cx="58" cy="50.4" r="1.8"/>
      <circle cx="68" cy="50.4" r="1.8"/><circle cx="78" cy="50.4" r="1.8"/>
    </g>
    <!-- slew ring the house turns on -->
    <rect x="46" y="40.5" width="42" height="3.4" rx="1.7" fill="#4a5568"/>
    <!-- house: deck forward, counterweight rounded off at the rear -->
    <path d="M39 41.5 V30 Q39 26.6 42.4 26.6 L83 26.6 Q89.5 26.6 90.5 31 L91.5 41.5 Z"
          fill="#7cc4e8" stroke="#4a91b8" stroke-width="1" stroke-linejoin="round"/>
    ${mark('white', 65.5, 31.8, 20)}
    <!-- operator cab -->
    <path d="M42.5 27 V15.5 Q42.5 11.8 46.2 11.8 H61 Q64.5 11.8 64.5 15.2 V27 Z" fill="#7cc4e8" stroke="#4a91b8" stroke-width="1"/>
    <rect x="44.8" y="14.4" width="7.6" height="10.4" rx="1" fill="#26344f"/>
    <rect x="54.2" y="14.4" width="8" height="10.4" rx="1" fill="#26344f"/>
    <!-- boom ram -->
    <path d="M40.5 29.5 L31 23" stroke="#8a95a5" stroke-width="2.4" stroke-linecap="round"/>
    <!-- boom, then the stick down to the bucket. A darker stroke under a
         lighter one outlines the arm without a second path to maintain. -->
    <path d="M40 33 L25 19" stroke="#4a91b8" stroke-width="7.6" stroke-linecap="round"/>
    <path d="M40 33 L25 19" stroke="#7cc4e8" stroke-width="5.2" stroke-linecap="round"/>
    <path d="M25 19 L18.5 32" stroke="#4a91b8" stroke-width="6.6" stroke-linecap="round"/>
    <path d="M25 19 L18.5 32" stroke="#7cc4e8" stroke-width="4.2" stroke-linecap="round"/>
    <!-- bucket. Kept angular on purpose: a rounded scoop reads as a wrecking
         ball once it's down at thumbnail size. -->
    <path d="M18.4 28.4 L23.4 31.8 L21.8 38.6 L13 41.8 L11 36.4 L14.4 30.2 Z"
          fill="#5a6b7d" stroke="#46566a" stroke-width=".8" stroke-linejoin="round"/>
  </symbol>`;

  // Inject the shared symbols once per document.
  if (!document.getElementById('art-vac')) {
    document.body.insertAdjacentHTML('afterbegin',
      `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>${VAC}${UTE}${TIP}${DIG}${CAR}${CAR_RED}</defs></svg>`);
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

  const plain = (id) => (width = 88, label = '') => `${open(width, label)}<use href="#${id}"/></svg>`;
  const ute = plain('art-ute'), tip = plain('art-tip'), dig = plain('art-dig');
  const car = plain('art-car'), carRed = plain('art-car-red');

  /** Illustration for a vehicle record, keyed on its fleet type. '' if we have no art for that type. */
  const BY_TYPE = {
    'Vac truck': (v, width, label) => vac(num(v.id), width, label || `${v.id} vac truck`),
    'Ute': (v, width, label) => ute(width, label || `${v.id} ute`),
    'Tipper truck': (v, width, label) => tip(width, label || `${v.id} tipper`),
    'Excavator': (v, width, label) => dig(width, label || `${v.id} excavator`),
    'Car': (v, width, label) => car(width, label || `${v.id} car`),
    'Van': (v, width, label) => car(width, label || `${v.id} van`)
  };
  const forVehicle = (v, width = 88, label = '') => {
    if (v.hired) return carRed(width, label || `${v.id || v.rego} hired`);
    return BY_TYPE[v.type] ? BY_TYPE[v.type](v, width, label) : '';
  };

  return { vac, ute, tip, dig, car, carRed, num, forVehicle };
})();
