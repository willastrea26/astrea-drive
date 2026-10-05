/*
 * Astrea vehicle illustrations, side profile, front facing left.
 *
 *   vac()     â€” white cab with the Astrea "A", silver vacuum tank, boom and
 *               hose over the cab, three axles. Takes a fleet number.
 *   ute()     â€” white dual cab, wordmark on the front door.
 *   tip()     â€” white tipper, high-sided body with a raised headboard.
 *   dig()     â€” light blue tracked excavator, wordmark on the house.
 *   car()     â€” blue sedan for Astrea cars/vans.
 *   trailer() â€” flat-deck trailer with drawbar, tandem axles.
 *
 * Every drawing shares the same 120x60 viewBox and ground line (wheels
 * centred on y=46.5, shadow at y=54.6) so they sit consistently wherever
 * they appear together. Each is defined ONCE as an SVG <symbol> and reused
 * with <use>; the vac truck's fleet number is a separate <text> layer per
 * instance, which is why it sits outside the symbol.
 *
 * Hired fleet uses red variants of every shape so each hire car reads as
 * its real plant type at a glance (red excavator, red ute, etc.) while
 * still being obviously not-owned by Astrea.
 *
 * The door decal is the real brand wordmark (assets/wordmark-*.png) rather
 * than set type, so it matches the logo exactly. Blue on white panels,
 * white on the excavator's blue or any red panel. Paths relative to index.html.
 */
window.AD = window.AD || {};

AD.art = (function () {
  // 320x75 artwork, so height is width * 0.2344.
  const mark = (tone, x, y, w) =>
    `<image href="assets/wordmark-${tone}.png" x="${x}" y="${y}" width="${w}" height="${(w * 0.2344).toFixed(2)}"/>`;

  // Truck palettes (vac/ute/tip): body colour, panel stroke, trim stripe,
  // and the wordmark tone that reads against that body.
  const PAL_WHITE = { body: '#ffffff', stroke: '#aeb8c6', trim: '#2463EB', mark: 'blue' };
  const PAL_RED   = { body: '#c23b3b', stroke: '#7a2626', trim: '#ffffff', mark: 'white' };

  // Excavator palette: light blue by default, deep red for hired.
  const PAL_EXC_BLUE = { body: '#7cc4e8', stroke: '#4a91b8', mark: 'white' };
  const PAL_EXC_RED  = { body: '#c23b3b', stroke: '#7a2626', mark: 'white' };

  const vacSymbol = (id, p) => `
  <symbol id="${id}" viewBox="0 0 120 60">
    <!-- Ground shadow -->
    <ellipse cx="60" cy="54.6" rx="52" ry="3" fill="#101D35" opacity=".16"/>

    <!-- === WHEELS (behind body) === -->
    <!-- Front wheel cx=18 -->
    <circle cx="18" cy="46.5" r="6.5" fill="#161b24"/>
    <circle cx="18" cy="46.5" r="3.9" fill="#8a95a5"/>
    <circle cx="18" cy="46.5" r="1.5" fill="#1a2130"/>
    <circle cx="15.5" cy="44.5" r=".4" fill="#1a2130"/>
    <circle cx="20.5" cy="44.5" r=".4" fill="#1a2130"/>
    <circle cx="15.5" cy="48.5" r=".4" fill="#1a2130"/>
    <circle cx="20.5" cy="48.5" r=".4" fill="#1a2130"/>
    <circle cx="18" cy="42.8" r=".4" fill="#1a2130"/>
    <circle cx="18" cy="50.2" r=".4" fill="#1a2130"/>

    <!-- Rear wheel 1 cx=88 -->
    <circle cx="88" cy="46.5" r="6.5" fill="#161b24"/>
    <circle cx="88" cy="46.5" r="3.9" fill="#8a95a5"/>
    <circle cx="88" cy="46.5" r="1.5" fill="#1a2130"/>
    <circle cx="85.5" cy="44.5" r=".4" fill="#1a2130"/>
    <circle cx="90.5" cy="44.5" r=".4" fill="#1a2130"/>
    <circle cx="85.5" cy="48.5" r=".4" fill="#1a2130"/>
    <circle cx="90.5" cy="48.5" r=".4" fill="#1a2130"/>
    <circle cx="88" cy="42.8" r=".4" fill="#1a2130"/>
    <circle cx="88" cy="50.2" r=".4" fill="#1a2130"/>

    <!-- Rear wheel 2 cx=103 -->
    <circle cx="103" cy="46.5" r="6.5" fill="#161b24"/>
    <circle cx="103" cy="46.5" r="3.9" fill="#8a95a5"/>
    <circle cx="103" cy="46.5" r="1.5" fill="#1a2130"/>
    <circle cx="100.5" cy="44.5" r=".4" fill="#1a2130"/>
    <circle cx="105.5" cy="44.5" r=".4" fill="#1a2130"/>
    <circle cx="100.5" cy="48.5" r=".4" fill="#1a2130"/>
    <circle cx="105.5" cy="48.5" r=".4" fill="#1a2130"/>
    <circle cx="103" cy="42.8" r=".4" fill="#1a2130"/>
    <circle cx="103" cy="50.2" r=".4" fill="#1a2130"/>

    <!-- === CHASSIS FRAME === -->
    <rect x="5" y="39.5" width="110" height="2" rx=".4" fill="${p.stroke}"/>

    <!-- Mud flaps -->
    <rect x="25.5" y="40" width="1.5" height="5" rx=".3" fill="#161b24" opacity=".6"/>
    <rect x="94.5" y="40" width="1.5" height="5" rx=".3" fill="#161b24" opacity=".6"/>

    <!-- Front bumper step -->
    <rect x="3.5" y="37.5" width="3" height="4" rx=".5" fill="#4a5568"/>
    <rect x="3.5" y="37.5" width="3" height="1" rx=".3" fill="#5a6577"/>

    <!-- Rear bumper guard -->
    <rect x="113.5" y="30" width="2" height="11.5" rx=".4" fill="#4a5568"/>

    <!-- === VACUUM TANK (cylindrical) === -->
    <rect x="31" y="15" width="83" height="24" rx="12" fill="${p.body}" stroke="${p.stroke}" stroke-width=".9"/>

    <!-- Tank cylindrical highlight (top) -->
    <rect x="42" y="16.5" width="62" height="2.5" rx="1" fill="#ffffff" opacity=".07"/>

    <!-- Tank cylindrical shadow (bottom) -->
    <rect x="42" y="35.5" width="62" height="2.5" rx="1" fill="#000000" opacity=".05"/>

    <!-- Tank banding straps -->
    <rect x="47" y="15.5" width="1" height="23" rx=".3" fill="${p.trim}" opacity=".55"/>
    <rect x="64" y="15.5" width="1" height="23" rx=".3" fill="${p.trim}" opacity=".55"/>
    <rect x="81" y="15.5" width="1" height="23" rx=".3" fill="${p.trim}" opacity=".55"/>
    <rect x="98" y="15.5" width="1" height="23" rx=".3" fill="${p.trim}" opacity=".55"/>

    <!-- Tank horizontal trim stripe -->
    <rect x="32" y="26" width="81" height="1.8" rx=".6" fill="${p.trim}"/>

    <!-- Rear outlet valve -->
    <circle cx="113" cy="27" r="2" fill="${p.stroke}" opacity=".4"/>
    <circle cx="113" cy="27" r=".9" fill="#4a5568"/>

    <!-- Tank access ladder rungs -->
    <rect x="58" y="37" width="3" height=".9" rx=".3" fill="${p.stroke}" opacity=".4"/>
    <rect x="58" y="34.5" width="3" height=".9" rx=".3" fill="${p.stroke}" opacity=".4"/>
    <rect x="58" y="32" width="3" height=".9" rx=".3" fill="${p.stroke}" opacity=".4"/>

    <!-- === CAB BODY (with front wheel arch cutout) === -->
    <path d="M29 41.5 L26 41.5 A8 4 0 0 0 10 41.5 L5 41.5 L5 15 Q5 13 7.5 13 L27 13 Q29 13 29 15 Z" fill="${p.body}" stroke="${p.stroke}" stroke-width=".9" stroke-linejoin="round"/>

    <!-- Cab windshield (front pane) -->
    <path d="M6.5 15 Q6.5 14.2 7.5 14.2 L14 14.2 L14 25.5 L6.5 25.5 Z" fill="#26344f"/>

    <!-- Cab side window -->
    <rect x="15.5" y="14.2" width="12" height="11.3" rx=".5" fill="#26344f"/>

    <!-- B-pillar divider -->
    <rect x="14.5" y="14.2" width="1" height="11.3" fill="#2a3f55"/>

    <!-- Door panel line -->
    <line x1="21" y1="25.5" x2="21" y2="39" stroke="${p.stroke}" stroke-width=".7"/>

    <!-- Door handle -->
    <rect x="22" y="30.5" width="4.5" height="1.2" rx=".5" fill="${p.stroke}"/>

    <!-- Side mirror stub -->
    <rect x="3.5" y="18" width="2" height="3.5" rx=".6" fill="${p.stroke}"/>

    <!-- Headlight -->
    <path d="M5 32.5 L3.5 33.5 L3.5 36.5 L5 37.5 Z" fill="#f0f4f8"/>

    <!-- Indicator light -->
    <rect x="5" y="30.5" width="1.5" height="1.5" rx=".3" fill="#f5a623"/>

    <!-- Taillight (rear of tank) -->
    <rect x="114" y="20" width="1.5" height="3.5" rx=".5" fill="#c93f3f"/>

    <!-- Cab vent grille -->
    <line x1="7.5" y1="28" x2="7.5" y2="31" stroke="${p.stroke}" stroke-width=".4" opacity=".45"/>
    <line x1="8.7" y1="28" x2="8.7" y2="31" stroke="${p.stroke}" stroke-width=".4" opacity=".45"/>
    <line x1="9.9" y1="28" x2="9.9" y2="31" stroke="${p.stroke}" stroke-width=".4" opacity=".45"/>

    <!-- Exhaust stack on cab -->
    <rect x="27" y="9.5" width="1.2" height="4.5" rx=".4" fill="#4a5568"/>
    <ellipse cx="27.6" cy="9.5" rx=".8" ry=".3" fill="#4a5568"/>

    <!-- === BOOM AND SUCTION HOSE === -->
    <!-- Boom mast (vertical post) -->
    <rect x="31" y="5" width="2.2" height="11" rx=".6" fill="#4a5568"/>

    <!-- Boom pivot head -->
    <circle cx="32.1" cy="5" r="1.5" fill="#4a5568"/>

    <!-- Suction hose curving over -->
    <path d="M32 5 C38 1 50 1 56 5.5 Q59 8 58 12.5" stroke="#4a5568" stroke-width="1.8" fill="none" stroke-linecap="round"/>

    <!-- Hose nozzle -->
    <rect x="56.5" y="11.5" width="3" height="5" rx=".8" fill="#4a5568"/>

    <!-- === WORDMARK === -->
    ${mark(p.mark, 36, 20, 10)}
  </symbol>`;

  const uteSymbol = (id, p) => `
  <symbol id="${id}" viewBox="0 0 120 60">
    <ellipse cx="60" cy="54.6" rx="48" ry="3" fill="#101D35" opacity=".16"/>

    <!-- chassis rail -->
    <rect x="10" y="41.5" width="100" height="3.8" rx="1.2" fill="#1d2330"/>

    <!-- body: bonnet, cab, tray â€” single closed path -->
    <path d="M7 37.5 L8.5 31.5 Q9 30 10.5 29.8 L30 27.5 L38 20 Q39.5 18.2 42 18 L68 18 Q70 18 71.5 20 L74 24 L75.5 28.5 L110.5 28.5 L110.5 42
             L103 42 A 8.5 8.5 0 0 0 85 42
             L37 42 A 8.5 8.5 0 0 0 19 42
             L7 42 Z"
          fill="${p.body}" stroke="${p.stroke}" stroke-width=".9" stroke-linejoin="round"/>

    <!-- tray bed floor -->
    <rect x="76" y="28.5" width="34.5" height="1.2" fill="${p.stroke}" opacity=".3"/>

    <!-- tray side rail (raised) -->
    <path d="M76.5 28.5 V23.5 H110.5 V28.5" fill="none" stroke="${p.stroke}" stroke-width=".8" stroke-linejoin="round"/>
    <!-- tray headboard -->
    <rect x="75.5" y="18" width="1.8" height="24" rx=".4" fill="${p.stroke}" opacity=".5"/>
    <!-- tailgate -->
    <rect x="109.5" y="23.5" width="1.5" height="18.5" rx=".4" fill="${p.stroke}" opacity=".4"/>
    <!-- tray side panel lines -->
    <path d="M85 23.5 V28.5 M93 23.5 V28.5 M101 23.5 V28.5" stroke="${p.stroke}" stroke-width=".5" opacity=".4"/>
    <!-- tray rail top -->
    <rect x="76.5" y="22.8" width="34" height="1.2" rx=".4" fill="${p.stroke}" opacity=".25"/>

    <!-- trim stripe along beltline -->
    <rect x="10" y="28" width="66" height="1.2" rx=".4" fill="${p.trim}"/>

    <!-- windshield (A-pillar raked) -->
    <path d="M31.5 27.5 L38.5 19.5 Q39.5 18.5 41 18.5 L47.5 18.5 V27.5 Z" fill="#26344f"/>
    <!-- front side window -->
    <rect x="49" y="18.5" width="11" height="9" rx=".8" fill="#26344f"/>
    <!-- rear side window -->
    <rect x="61.5" y="18.5" width="9.5" height="9" rx=".8" fill="#26344f"/>
    <!-- B-pillar -->
    <rect x="48" y="18.5" width="1" height="9" fill="#1e2d45"/>
    <!-- C-pillar -->
    <rect x="60.5" y="18.5" width="1" height="9" fill="#1e2d45"/>

    <!-- door panel divider lines -->
    <path d="M48.5 29.2 V41.5" stroke="${p.stroke}" stroke-width=".7"/>
    <path d="M61 29.2 V41.5" stroke="${p.stroke}" stroke-width=".7"/>
    <path d="M75 20 V41.5" stroke="${p.stroke}" stroke-width=".7"/>

    <!-- door handles -->
    <rect x="42" y="33" width="5" height="1.3" rx=".6" fill="${p.stroke}"/>
    <rect x="54" y="33" width="5" height="1.3" rx=".6" fill="${p.stroke}"/>

    <!-- mirror stub -->
    <path d="M31 24 L28.5 23 L28 25.5 L30.5 26" fill="#2a3140" stroke="#1d2330" stroke-width=".4"/>

    <!-- headlight -->
    <path d="M8.5 32 L14 31 L14.5 33.5 L9.5 35 Z" fill="#f0f4f8"/>
    <!-- front indicator -->
    <path d="M8 35.5 L9.5 35.2 L9.8 36.8 L8.2 37 Z" fill="#f5c542" opacity=".8"/>

    <!-- taillight -->
    <path d="M110 30 L111.5 30 L111.5 34.5 L110 34.5 Z" fill="#c93f3f"/>
    <!-- rear indicator -->
    <path d="M110 35 L111.5 35 L111.5 37 L110 37 Z" fill="#f5c542" opacity=".7"/>

    <!-- front bumper bar -->
    <rect x="5.5" y="38" width="8.5" height="4" rx="1" fill="#1d2330"/>
    <!-- rear bumper step -->
    <rect x="107" y="39" width="5" height="3" rx=".8" fill="#1d2330"/>

    <!-- mud flap front -->
    <rect x="14" y="42" width="2" height="2.5" rx=".3" fill="#2a3140" opacity=".6"/>
    <!-- mud flap rear -->
    <rect x="104" y="42" width="2" height="2.5" rx=".3" fill="#2a3140" opacity=".6"/>

    <!-- wordmark on front door -->
    ${mark(p.mark, 36, 35, 11)}

    <!-- wheels: 3-layer (tire / mid ring / hub) -->
    <g fill="#161b24"><circle cx="28" cy="46.5" r="8"/><circle cx="94" cy="46.5" r="8"/></g>
    <g fill="#4a5568"><circle cx="28" cy="46.5" r="4.8"/><circle cx="94" cy="46.5" r="4.8"/></g>
    <g fill="#1a2130"><circle cx="28" cy="46.5" r="1.8"/><circle cx="94" cy="46.5" r="1.8"/></g>
    <!-- wheel nuts (5 per wheel on the mid ring) -->
    <g fill="#1a2130" opacity=".7">
      <circle cx="28" cy="43.2" r=".55"/><circle cx="25.1" cy="45.4" r=".55"/><circle cx="25.9" cy="48.6" r=".55"/><circle cx="30.1" cy="48.6" r=".55"/><circle cx="30.9" cy="45.4" r=".55"/>
      <circle cx="94" cy="43.2" r=".55"/><circle cx="91.1" cy="45.4" r=".55"/><circle cx="91.9" cy="48.6" r=".55"/><circle cx="96.1" cy="48.6" r=".55"/><circle cx="96.9" cy="45.4" r=".55"/>
    </g>
  </symbol>`;

  const tipSymbol = (id, p) => `
  <symbol id="${id}" viewBox="0 0 120 60">
    <!-- Ground shadow -->
    <ellipse cx="60" cy="54.6" rx="52" ry="3" fill="#101D35" opacity=".16"/>

    <!-- Chassis rail -->
    <rect x="8" y="40.5" width="99" height="5.5" rx="1.6" fill="#1d2330"/>
    <!-- Chassis cross-members -->
    <rect x="46" y="41.2" width="1.6" height="4" fill="#2a3140"/>
    <rect x="62" y="41.2" width="1.6" height="4" fill="#2a3140"/>
    <rect x="74" y="41.2" width="1.6" height="4" fill="#2a3140"/>

    <!-- Hoist ram between chassis and body -->
    <path d="M49 41.5 L42.5 31" stroke="#6b7688" stroke-width="2.8" stroke-linecap="round"/>
    <path d="M48 41 L43.5 33" stroke="#b4becb" stroke-width="1.2" stroke-linecap="round"/>

    <!-- Tipping body: headboard stands proud above side rails -->
    <path d="M37.5 9.5 H42.5 V16 H105 V38.5 H37.5 Z"
          fill="${p.body}" stroke="${p.stroke}" stroke-width=".9" stroke-linejoin="round"/>
    <!-- Headboard cap trim -->
    <rect x="37.5" y="9.5" width="5" height="1.8" fill="${p.trim}"/>
    <!-- Top rail trim stripe -->
    <rect x="42.5" y="16" width="62.5" height="1.8" fill="${p.trim}"/>

    <!-- Vertical panel ribs on body -->
    <path d="M55 18.5 V38 M67 18.5 V38 M79 18.5 V38 M91 18.5 V38"
          stroke="${p.stroke}" stroke-width=".7" opacity=".45"/>
    <!-- Horizontal body seam -->
    <path d="M42.5 28 H105" stroke="${p.stroke}" stroke-width=".4" opacity=".25"/>

    <!-- Tailgate -->
    <rect x="103.8" y="16.2" width="1.5" height="22" rx=".3" fill="${p.stroke}" opacity=".35"/>
    <!-- Tailgate hinges -->
    <circle cx="104.5" cy="19.5" r="1.3" fill="#8a95a5"/>
    <circle cx="104.5" cy="34" r="1.3" fill="#8a95a5"/>
    <!-- Hinge pins -->
    <circle cx="104.5" cy="19.5" r=".5" fill="#5a6373"/>
    <circle cx="104.5" cy="34" r=".5" fill="#5a6373"/>

    <!-- Cab (cab-over style, same as vac truck) -->
    <path d="M5 44 V27 Q5 23 7.5 19.5 L12 12.5 Q13.5 10.5 16.5 10.5 H32
             Q35 10.5 35 13.5 V44 Z"
          fill="${p.body}" stroke="${p.stroke}" stroke-width=".9" stroke-linejoin="round"/>

    <!-- Windshield -->
    <path d="M10.2 22 L13.8 15.2 Q14.5 14 16 14 H24.5 V22 Z" fill="#26344f"/>
    <!-- Side window -->
    <rect x="26" y="14" width="6.5" height="8" rx=".8" fill="#26344f"/>
    <!-- B-pillar divider -->
    <rect x="24.5" y="14" width="1.3" height="8" fill="#2a3f55"/>

    <!-- Door panel line -->
    <path d="M20 23 V42" stroke="${p.stroke}" stroke-width=".7"/>
    <!-- Door handle -->
    <rect x="22" y="30.5" width="4.5" height="1.2" rx=".5" fill="${p.stroke}"/>

    <!-- Mirror stub -->
    <path d="M8.8 19.5 L6 18 L5.5 20 L8.2 21" fill="#2a3140" stroke="#1d2330" stroke-width=".4"/>

    <!-- Headlight -->
    <path d="M5.5 32 L8 31 L8 35 L5.5 35.5 Z" fill="#dfe5ec"/>
    <!-- Indicator light below headlight -->
    <rect x="5.5" y="36" width="2.2" height="1" rx=".4" fill="#f5c842"/>

    <!-- Vent grille on cab side -->
    <g stroke="${p.stroke}" stroke-width=".35" opacity=".5">
      <path d="M28 25 H33"/>
      <path d="M28 26.3 H33"/>
      <path d="M28 27.6 H33"/>
    </g>

    <!-- Wordmark on cab door -->
    ${mark(p.mark, 10, 29, 21)}

    <!-- Front bumper/step -->
    <rect x="3" y="39.5" width="7" height="4.5" rx="1" fill="#1d2330"/>
    <!-- Bumper step tread -->
    <rect x="3.8" y="41.2" width="3" height=".8" rx=".3" fill="#4a5568"/>

    <!-- Mud flaps -->
    <rect x="28.5" y="43.5" width="1.8" height="3" rx=".3" fill="#1d2330"/>
    <rect x="101.5" y="43.5" width="1.8" height="3" rx=".3" fill="#1d2330"/>

    <!-- Wheels: 3 axles, 3-layer each (tire, alloy, hub) -->
    <g fill="#161b24">
      <circle cx="21" cy="46.5" r="7.5"/>
      <circle cx="80" cy="46.5" r="7.5"/>
      <circle cx="96" cy="46.5" r="7.5"/>
    </g>
    <g fill="#8a95a5">
      <circle cx="21" cy="46.5" r="4.2"/>
      <circle cx="80" cy="46.5" r="4.2"/>
      <circle cx="96" cy="46.5" r="4.2"/>
    </g>
    <g fill="#1a2130">
      <circle cx="21" cy="46.5" r="1.6"/>
      <circle cx="80" cy="46.5" r="1.6"/>
      <circle cx="96" cy="46.5" r="1.6"/>
    </g>
    <!-- Wheel nuts (6 per wheel on the mid ring) -->
    <g fill="#5a6373">
      <circle cx="21" cy="43.2" r=".45"/><circle cx="24" cy="45.3" r=".45"/>
      <circle cx="24" cy="47.7" r=".45"/><circle cx="21" cy="49.8" r=".45"/>
      <circle cx="18" cy="47.7" r=".45"/><circle cx="18" cy="45.3" r=".45"/>
      <circle cx="80" cy="43.2" r=".45"/><circle cx="83" cy="45.3" r=".45"/>
      <circle cx="83" cy="47.7" r=".45"/><circle cx="80" cy="49.8" r=".45"/>
      <circle cx="77" cy="47.7" r=".45"/><circle cx="77" cy="45.3" r=".45"/>
      <circle cx="96" cy="43.2" r=".45"/><circle cx="99" cy="45.3" r=".45"/>
      <circle cx="99" cy="47.7" r=".45"/><circle cx="96" cy="49.8" r=".45"/>
      <circle cx="93" cy="47.7" r=".45"/><circle cx="93" cy="45.3" r=".45"/>
    </g>
  </symbol>`;

  const digSymbol = (id, p) => `
  <symbol id="${id}" viewBox="0 0 120 60">
    <ellipse cx="60" cy="54.6" rx="46" ry="3" fill="#101D35" opacity=".16"/>

    <!-- === TRACKED UNDERCARRIAGE === -->
    <!-- Track band - stadium shape wrapping around sprockets -->
    <path d="M30 42 H86 A7 7 0 0 1 93 49 A7 7 0 0 1 86 55.5 H30 A7 7 0 0 1 23 49 V48 A7 7 0 0 1 30 42 Z" fill="#161b24" stroke="#0d1117" stroke-width=".4"/>

    <!-- Track shoe grooves - bottom -->
    <g stroke="#2a3040" stroke-width=".5" opacity=".4">
      <line x1="32" y1="55.5" x2="32" y2="54.2"/>
      <line x1="36" y1="55.5" x2="36" y2="54.2"/>
      <line x1="40" y1="55.5" x2="40" y2="54.2"/>
      <line x1="44" y1="55.5" x2="44" y2="54.2"/>
      <line x1="48" y1="55.5" x2="48" y2="54.2"/>
      <line x1="52" y1="55.5" x2="52" y2="54.2"/>
      <line x1="56" y1="55.5" x2="56" y2="54.2"/>
      <line x1="60" y1="55.5" x2="60" y2="54.2"/>
      <line x1="64" y1="55.5" x2="64" y2="54.2"/>
      <line x1="68" y1="55.5" x2="68" y2="54.2"/>
      <line x1="72" y1="55.5" x2="72" y2="54.2"/>
      <line x1="76" y1="55.5" x2="76" y2="54.2"/>
      <line x1="80" y1="55.5" x2="80" y2="54.2"/>
      <line x1="84" y1="55.5" x2="84" y2="54.2"/>
    </g>

    <!-- Track shoe grooves - top -->
    <g stroke="#2a3040" stroke-width=".4" opacity=".3">
      <line x1="33" y1="42" x2="33" y2="43.1"/>
      <line x1="37" y1="42" x2="37" y2="43.1"/>
      <line x1="41" y1="42" x2="41" y2="43.1"/>
      <line x1="45" y1="42" x2="45" y2="43.1"/>
      <line x1="49" y1="42" x2="49" y2="43.1"/>
      <line x1="53" y1="42" x2="53" y2="43.1"/>
      <line x1="57" y1="42" x2="57" y2="43.1"/>
      <line x1="61" y1="42" x2="61" y2="43.1"/>
      <line x1="65" y1="42" x2="65" y2="43.1"/>
      <line x1="69" y1="42" x2="69" y2="43.1"/>
      <line x1="73" y1="42" x2="73" y2="43.1"/>
      <line x1="77" y1="42" x2="77" y2="43.1"/>
      <line x1="81" y1="42" x2="81" y2="43.1"/>
      <line x1="85" y1="42" x2="85" y2="43.1"/>
    </g>

    <!-- Track frame side guard plate -->
    <rect x="29" y="44" width="58" height="8" rx=".8" fill="${p.stroke}" opacity=".22"/>

    <!-- Bottom track rollers (5 sets of 3 concentric circles) -->
    <g>
      <circle cx="38" cy="52.5" r="2.2" fill="#161b24"/>
      <circle cx="38" cy="52.5" r="1.3" fill="#4a5568"/>
      <circle cx="38" cy="52.5" r=".45" fill="#1a2130"/>

      <circle cx="48" cy="52.5" r="2.2" fill="#161b24"/>
      <circle cx="48" cy="52.5" r="1.3" fill="#4a5568"/>
      <circle cx="48" cy="52.5" r=".45" fill="#1a2130"/>

      <circle cx="58" cy="52.5" r="2.2" fill="#161b24"/>
      <circle cx="58" cy="52.5" r="1.3" fill="#4a5568"/>
      <circle cx="58" cy="52.5" r=".45" fill="#1a2130"/>

      <circle cx="68" cy="52.5" r="2.2" fill="#161b24"/>
      <circle cx="68" cy="52.5" r="1.3" fill="#4a5568"/>
      <circle cx="68" cy="52.5" r=".45" fill="#1a2130"/>

      <circle cx="78" cy="52.5" r="2.2" fill="#161b24"/>
      <circle cx="78" cy="52.5" r="1.3" fill="#4a5568"/>
      <circle cx="78" cy="52.5" r=".45" fill="#1a2130"/>
    </g>

    <!-- Top carrier rollers (2) -->
    <circle cx="46" cy="43.2" r="1.4" fill="#161b24"/>
    <circle cx="46" cy="43.2" r=".75" fill="#4a5568"/>
    <circle cx="70" cy="43.2" r="1.4" fill="#161b24"/>
    <circle cx="70" cy="43.2" r=".75" fill="#4a5568"/>

    <!-- Front idler wheel (3 layers) -->
    <circle cx="29" cy="48.5" r="5.5" fill="#161b24"/>
    <circle cx="29" cy="48.5" r="3.3" fill="#4a5568"/>
    <circle cx="29" cy="48.5" r="1.1" fill="#1a2130"/>
    <!-- Idler bolt ring -->
    <g fill="#2a3545">
      <circle cx="29" cy="46" r=".35"/>
      <circle cx="31.2" cy="47.3" r=".35"/>
      <circle cx="31.2" cy="49.7" r=".35"/>
      <circle cx="29" cy="51" r=".35"/>
      <circle cx="26.8" cy="49.7" r=".35"/>
      <circle cx="26.8" cy="47.3" r=".35"/>
    </g>

    <!-- Rear drive sprocket (3 layers) -->
    <circle cx="87" cy="48.5" r="5.5" fill="#161b24"/>
    <circle cx="87" cy="48.5" r="3.3" fill="#4a5568"/>
    <circle cx="87" cy="48.5" r="1.1" fill="#1a2130"/>
    <!-- Sprocket bolt ring -->
    <g fill="#2a3545">
      <circle cx="87" cy="46" r=".35"/>
      <circle cx="89.2" cy="47.3" r=".35"/>
      <circle cx="89.2" cy="49.7" r=".35"/>
      <circle cx="87" cy="51" r=".35"/>
      <circle cx="84.8" cy="49.7" r=".35"/>
      <circle cx="84.8" cy="47.3" r=".35"/>
    </g>

    <!-- === SLEW RING === -->
    <ellipse cx="62" cy="40.5" rx="18" ry="2" fill="#2a3545"/>
    <ellipse cx="62" cy="40.5" rx="12" ry="1.2" fill="#1e2b3a" opacity=".4"/>

    <!-- === UPPER HOUSE / SUPERSTRUCTURE === -->
    <!-- Main body path: cab front, roof step down to engine hood, counterweight curve -->
    <path d="M40 40 L40 25 Q40 21 43 21 L53 21 L53 26 L84 26 Q89 26 91 29 L93 34 Q93.5 37 93 40 Z" fill="${p.body}" stroke="${p.stroke}" stroke-width=".9" stroke-linejoin="round"/>

    <!-- === CAB SECTION === -->
    <!-- Front windshield glass (angled A-pillar) -->
    <path d="M41.5 38 L42.5 26 Q43 23 44.5 22.5 L48.5 22.5 L48.5 38 Z" fill="#1a3550"/>
    <!-- Side window glass -->
    <rect x="49.5" y="22.5" width="3" height="15.5" fill="#1a3550"/>
    <!-- B-pillar divider -->
    <rect x="48.5" y="22.5" width=".8" height="15.5" fill="#2a3f55"/>

    <!-- Cab roof edge highlight -->
    <line x1="42" y1="21.8" x2="53" y2="21.8" stroke="${p.stroke}" stroke-width=".4" opacity=".6"/>

    <!-- Work light on cab roof -->
    <rect x="43" y="20.2" width="2.2" height="1" rx=".4" fill="#f0f4f8"/>

    <!-- Cab door handle -->
    <rect x="50" y="32" width="2" height=".8" rx=".3" fill="${p.stroke}"/>

    <!-- === ENGINE SECTION === -->
    <!-- Hood panel line -->
    <line x1="53.5" y1="26.5" x2="84" y2="26.5" stroke="${p.stroke}" stroke-width=".4" opacity=".4"/>

    <!-- Engine vent grille -->
    <g stroke="${p.stroke}" stroke-width=".35" opacity=".5">
      <line x1="58" y1="30" x2="58" y2="37"/>
      <line x1="60" y1="30" x2="60" y2="37"/>
      <line x1="62" y1="30" x2="62" y2="37"/>
      <line x1="64" y1="30" x2="64" y2="37"/>
      <line x1="66" y1="30" x2="66" y2="37"/>
    </g>

    <!-- === COUNTERWEIGHT === -->
    <!-- Counterweight seam line -->
    <line x1="82" y1="26.5" x2="82" y2="40" stroke="${p.stroke}" stroke-width=".5" opacity=".35"/>
    <!-- Counterweight weight stripes -->
    <g fill="${p.stroke}" opacity=".15">
      <rect x="84" y="31" width="8" height="1.3" rx=".3"/>
      <rect x="84" y="34" width="8" height="1.3" rx=".3"/>
    </g>

    <!-- Exhaust stack -->
    <rect x="73" y="23.5" width="1.6" height="2.5" rx=".4" fill="${p.stroke}"/>
    <rect x="72.6" y="22.5" width="2.4" height="1.3" rx=".5" fill="#2a3545"/>

    <!-- Grab handle / handrail -->
    <path d="M54 26 L54 23 L56 23" fill="none" stroke="${p.stroke}" stroke-width=".5" opacity=".45"/>

    <!-- Swing motor cover on slew ring -->
    <circle cx="62" cy="40.5" r="2.2" fill="${p.stroke}" opacity=".25"/>

    <!-- Wordmark on engine hood -->
    ${mark(p.mark, 68, 32, 12)}

    <!-- === BOOM ARM (beam shape) === -->
    <path d="M44 23.5 L19 7.5 L17 10 L42 27 Z" fill="${p.body}" stroke="${p.stroke}" stroke-width=".7" stroke-linejoin="round"/>
    <!-- Boom pin at base -->
    <circle cx="43" cy="25.2" r="1.4" fill="${p.stroke}"/>
    <circle cx="43" cy="25.2" r=".5" fill="#1a2130"/>
    <!-- Boom pin at tip -->
    <circle cx="18" cy="8.8" r="1.1" fill="${p.stroke}"/>
    <circle cx="18" cy="8.8" r=".4" fill="#1a2130"/>

    <!-- === BOOM HYDRAULIC CYLINDER === -->
    <!-- Cylinder body -->
    <line x1="46" y1="31" x2="32" y2="18" stroke="#8a95a5" stroke-width="2" stroke-linecap="round"/>
    <!-- Piston rod -->
    <line x1="32" y1="18" x2="26" y2="13" stroke="#c0c8d2" stroke-width=".9" stroke-linecap="round"/>
    <!-- Cylinder mount pins -->
    <circle cx="46" cy="31" r=".8" fill="${p.stroke}"/>
    <circle cx="26" cy="13" r=".6" fill="${p.stroke}"/>

    <!-- === STICK ARM (dipper) === -->
    <path d="M19.5 7 L8.5 34 L6.5 35.5 L16.5 9.5 Z" fill="${p.body}" stroke="${p.stroke}" stroke-width=".6" stroke-linejoin="round"/>
    <!-- Stick-to-bucket pin -->
    <circle cx="7.5" cy="34.8" r="1" fill="${p.stroke}"/>
    <circle cx="7.5" cy="34.8" r=".35" fill="#1a2130"/>

    <!-- === STICK HYDRAULIC CYLINDER === -->
    <line x1="36" y1="20" x2="16" y2="15" stroke="#8a95a5" stroke-width="1.2" stroke-linecap="round"/>
    <line x1="16" y1="15" x2="12.5" y2="18" stroke="#c0c8d2" stroke-width=".6" stroke-linecap="round"/>

    <!-- === BUCKET === -->
    <path d="M8 33.5 L4 37.5 Q2.5 40 3 42.5 L9.5 42.5 L10.5 37 L9 34.5 Z" fill="#5a6b7d" stroke="#46566a" stroke-width=".7" stroke-linejoin="round"/>
    <!-- Bucket teeth -->
    <g fill="#8a95a5">
      <rect x="3" y="42.5" width=".9" height="1.4" rx=".2"/>
      <rect x="4.6" y="42.5" width=".9" height="1.4" rx=".2"/>
      <rect x="6.2" y="42.5" width=".9" height="1.4" rx=".2"/>
      <rect x="7.8" y="42.5" width=".9" height="1.4" rx=".2"/>
    </g>
    <!-- Bucket cutting edge -->
    <line x1="3" y1="42.5" x2="9.5" y2="42.5" stroke="#46566a" stroke-width=".5"/>

    <!-- Mud flap behind sprocket -->
    <path d="M95 44 L96.5 44 L96.5 48 Q96.5 50 95.5 51" fill="none" stroke="#161b24" stroke-width=".7" stroke-linecap="round"/>
  </symbol>`;

  const trailerSymbol = (id, p) => `
  <symbol id="${id}" viewBox="0 0 120 60">
    <!-- Ground shadow -->
    <ellipse cx="62" cy="54.6" rx="50" ry="3" fill="#101D35" opacity=".16"/>

    <!-- Drawbar/A-frame -->
    <path d="M4 40.5 L22 38 L22 45.5 L4 44 Z" fill="${p.stroke}" stroke="${p.stroke}" stroke-width=".3" stroke-linejoin="round"/>

    <!-- Coupling eye -->
    <circle cx="4.5" cy="42.2" r="2.5" fill="${p.stroke}"/>
    <circle cx="4.5" cy="42.2" r="1.3" fill="#161b24"/>
    <circle cx="4.5" cy="42.2" r=".5" fill="#8a95a5"/>

    <!-- Safety chain attachment points -->
    <circle cx="9" cy="39.2" r=".7" fill="#8a95a5"/>
    <circle cx="9" cy="44.8" r=".7" fill="#8a95a5"/>

    <!-- Jockey wheel (retracted position) -->
    <rect x="13" y="44.5" width=".8" height="5.5" rx=".3" fill="#8a95a5"/>
    <circle cx="13.4" cy="50.5" r="1.3" fill="#161b24"/>
    <circle cx="13.4" cy="50.5" r=".6" fill="#8a95a5"/>

    <!-- Main trailer body with wheel arches -->
    <path d="M22 33 L112 33 L112 43 L111 43 A8 8 0 0 0 95 43 L93 43 A8 8 0 0 0 77 43 L22 43 Z" fill="${p.body}" stroke="${p.stroke}" stroke-width=".9" stroke-linejoin="round"/>

    <!-- Deck surface edge highlight -->
    <line x1="22" y1="33.8" x2="112" y2="33.8" stroke="${p.trim}" stroke-width=".6" opacity=".3"/>

    <!-- Headboard/bulkhead -->
    <rect x="20" y="23.5" width="3" height="20" rx=".6" fill="${p.stroke}"/>
    <rect x="20.6" y="24.5" width="1.8" height="8" rx=".4" fill="${p.body}" opacity=".4"/>

    <!-- Side rail running along deck -->
    <rect x="23" y="31" width="89" height="2.2" rx=".3" fill="${p.stroke}"/>

    <!-- Vertical stakes/stanchions -->
    <rect x="36" y="26.5" width="1.2" height="5" rx=".3" fill="${p.stroke}"/>
    <rect x="52" y="26.5" width="1.2" height="5" rx=".3" fill="${p.stroke}"/>
    <rect x="68" y="26.5" width="1.2" height="5" rx=".3" fill="${p.stroke}"/>
    <rect x="84" y="26.5" width="1.2" height="5" rx=".3" fill="${p.stroke}"/>
    <rect x="100" y="26.5" width="1.2" height="5" rx=".3" fill="${p.stroke}"/>
    <rect x="110.5" y="26.5" width="1.2" height="5" rx=".3" fill="${p.stroke}"/>

    <!-- Toolbox near front -->
    <rect x="25" y="36" width="10" height="5.5" rx=".8" fill="${p.stroke}"/>
    <line x1="25.5" y1="38.5" x2="34.5" y2="38.5" stroke="${p.trim}" stroke-width=".5"/>
    <rect x="29.5" y="36.5" width="1" height="1.5" rx=".3" fill="${p.trim}"/>

    <!-- Chassis rail (visible forward of wheel area) -->
    <rect x="22" y="42" width="55" height="1.2" rx=".2" fill="${p.stroke}" opacity=".45"/>

    <!-- Panel seam lines -->
    <line x1="48" y1="34" x2="48" y2="42" stroke="${p.stroke}" stroke-width=".5" opacity=".3"/>
    <line x1="72" y1="34" x2="72" y2="42" stroke="${p.stroke}" stroke-width=".5" opacity=".3"/>

    <!-- Mudflaps behind each axle -->
    <rect x="92" y="43.5" width="1.5" height="4.5" rx=".3" fill="#161b24" opacity=".65"/>
    <rect x="110" y="43.5" width="1.5" height="4.5" rx=".3" fill="#161b24" opacity=".65"/>

    <!-- Reflective side markers (amber) -->
    <rect x="24" y="39.5" width="2.2" height="1" rx=".3" fill="#f0c040"/>
    <rect x="55" y="39.5" width="2.2" height="1" rx=".3" fill="#f0c040"/>
    <rect x="74" y="39.5" width="2.2" height="1" rx=".3" fill="#f0c040"/>

    <!-- Rear tail light -->
    <rect x="112" y="35" width="1.2" height="3.5" rx=".4" fill="#c93f3f"/>
    <!-- Rear reflector (amber) -->
    <rect x="112" y="39.2" width="1.2" height="1.2" rx=".3" fill="#f0c040"/>
    <!-- Rear red marker -->
    <rect x="109.5" y="39.5" width="1.5" height="1" rx=".3" fill="#c93f3f"/>

    <!-- Tie-down hooks along deck edge -->
    <circle cx="30" cy="34.5" r=".5" fill="${p.trim}" opacity=".5"/>
    <circle cx="42" cy="34.5" r=".5" fill="${p.trim}" opacity=".5"/>
    <circle cx="54" cy="34.5" r=".5" fill="${p.trim}" opacity=".5"/>
    <circle cx="66" cy="34.5" r=".5" fill="${p.trim}" opacity=".5"/>
    <circle cx="78" cy="34.5" r=".5" fill="${p.trim}" opacity=".5"/>
    <circle cx="90" cy="34.5" r=".5" fill="${p.trim}" opacity=".5"/>
    <circle cx="102" cy="34.5" r=".5" fill="${p.trim}" opacity=".5"/>

    <!-- Wheels - axle 1 at x=85 -->
    <circle cx="85" cy="46.5" r="8" fill="#161b24"/>
    <circle cx="85" cy="46.5" r="4.8" fill="#8a95a5"/>
    <circle cx="85" cy="43" r=".5" fill="#1a2130"/>
    <circle cx="85" cy="50" r=".5" fill="#1a2130"/>
    <circle cx="81.5" cy="46.5" r=".5" fill="#1a2130"/>
    <circle cx="88.5" cy="46.5" r=".5" fill="#1a2130"/>
    <circle cx="82.5" cy="44" r=".5" fill="#1a2130"/>
    <circle cx="87.5" cy="44" r=".5" fill="#1a2130"/>
    <circle cx="82.5" cy="49" r=".5" fill="#1a2130"/>
    <circle cx="87.5" cy="49" r=".5" fill="#1a2130"/>
    <circle cx="85" cy="46.5" r="1.8" fill="#1a2130"/>

    <!-- Wheels - axle 2 at x=103 -->
    <circle cx="103" cy="46.5" r="8" fill="#161b24"/>
    <circle cx="103" cy="46.5" r="4.8" fill="#8a95a5"/>
    <circle cx="103" cy="43" r=".5" fill="#1a2130"/>
    <circle cx="103" cy="50" r=".5" fill="#1a2130"/>
    <circle cx="99.5" cy="46.5" r=".5" fill="#1a2130"/>
    <circle cx="106.5" cy="46.5" r=".5" fill="#1a2130"/>
    <circle cx="100.5" cy="44" r=".5" fill="#1a2130"/>
    <circle cx="105.5" cy="44" r=".5" fill="#1a2130"/>
    <circle cx="100.5" cy="49" r=".5" fill="#1a2130"/>
    <circle cx="105.5" cy="49" r=".5" fill="#1a2130"/>
    <circle cx="103" cy="46.5" r="1.8" fill="#1a2130"/>

    <!-- Wordmark on trailer body -->
    ${mark(p.mark, 52, 36, 14)}
  </symbol>`;

  // Sedan silhouette (Astrea Car / hired car). Blue variant for owned, red for hired.
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

  const SYMBOLS = [
    vacSymbol('art-vac',         PAL_WHITE),
    vacSymbol('art-vac-red',     PAL_RED),
    uteSymbol('art-ute',         PAL_WHITE),
    uteSymbol('art-ute-red',     PAL_RED),
    tipSymbol('art-tip',         PAL_WHITE),
    tipSymbol('art-tip-red',     PAL_RED),
    digSymbol('art-dig',         PAL_EXC_BLUE),
    digSymbol('art-dig-red',     PAL_EXC_RED),
    trailerSymbol('art-trailer',     PAL_WHITE),
    trailerSymbol('art-trailer-red', PAL_RED),
    `<symbol id="art-car"     viewBox="0 0 120 60">${carBody('#4a90c4', '#2a5c82', 'white')}</symbol>`,
    `<symbol id="art-car-red" viewBox="0 0 120 60">${carBody('#c23b3b', '#7a2626', 'white')}</symbol>`,
  ].join('');

  // Inject once per document.
  if (!document.getElementById('art-vac')) {
    document.body.insertAdjacentHTML('afterbegin',
      `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>${SYMBOLS}</defs></svg>`);
  }

  const open = (width, label) => {
    const h = Math.round(width / 2);
    return `<svg class="veh-svg" viewBox="0 0 120 60" width="${width}" height="${h}" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'} focusable="false">`;
  };

  /** "VAC-03" -> "03" */
  const num = (id) => String(id).replace(/^\D*-?/, '').padStart(2, '0').slice(-2);

  /** Vac truck with the fleet number on the tank (owned fleet only). */
  function vac(number, width = 88, label = '') {
    return `${open(width, label)}<use href="#art-vac"/>
      <text x="75" y="27.4" class="vac-num" text-anchor="middle" dominant-baseline="central">${number}</text></svg>`;
  }

  const plain = (id) => (width = 88, label = '') => `${open(width, label)}<use href="#${id}"/></svg>`;
  const ute = plain('art-ute'), tip = plain('art-tip'), dig = plain('art-dig');
  const car = plain('art-car'), carRed = plain('art-car-red');
  const vacRed = plain('art-vac-red');
  const uteRed = plain('art-ute-red'), tipRed = plain('art-tip-red'), digRed = plain('art-dig-red');
  const trailer = plain('art-trailer'), trailerRed = plain('art-trailer-red');

  // Owned fleet: full-colour illustrations per type.
  const BY_TYPE = {
    'Vac truck': (v, width, label) => vac(num(v.id), width, label || `${v.id} vac truck`),
    'Ute': (v, width, label) => ute(width, label || `${v.id} ute`),
    'Tipper truck': (v, width, label) => tip(width, label || `${v.id} tipper`),
    'Excavator': (v, width, label) => dig(width, label || `${v.id} excavator`),
    'Car': (v, width, label) => car(width, label || `${v.id} car`),
    'Van': (v, width, label) => car(width, label || `${v.id} van`),
    'Trailer': (v, width, label) => trailer(width, label || `${v.id} trailer`)
  };

  // Hired fleet: red of the same plant type (red excavator, red ute, â€¦).
  // No fleet number on the hired vac truck â€” those aren't Astrea's numbering.
  const BY_TYPE_RED = {
    'Vac truck': (v, width, label) => vacRed(width, label || `${v.id || v.rego} hired vac truck`),
    'Ute': (v, width, label) => uteRed(width, label || `${v.id || v.rego} hired ute`),
    'Tipper truck': (v, width, label) => tipRed(width, label || `${v.id || v.rego} hired tipper`),
    'Excavator': (v, width, label) => digRed(width, label || `${v.id || v.rego} hired excavator`),
    'Car': (v, width, label) => carRed(width, label || `${v.id || v.rego} hired car`),
    'Van': (v, width, label) => carRed(width, label || `${v.id || v.rego} hired van`),
    'Trailer': (v, width, label) => trailerRed(width, label || `${v.id || v.rego} hired trailer`)
  };

  const forVehicle = (v, width = 88, label = '') => {
    if (v.hired) {
      const fn = BY_TYPE_RED[v.type];
      return fn ? fn(v, width, label) : carRed(width, label || `${v.id || v.rego} hired`);
    }
    return BY_TYPE[v.type] ? BY_TYPE[v.type](v, width, label) : '';
  };

  return { vac, ute, tip, dig, car, carRed, trailer, trailerRed, num, forVehicle };
})();
