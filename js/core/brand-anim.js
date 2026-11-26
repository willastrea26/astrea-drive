/*
 * Brand logo animation. Every 25 seconds or so the road in the sidebar logo's "A"
 * comes alive for a few seconds: the centre markings ease into a gentle flow
 * towards you, as if driving, while a pair of tail lights pulls away up the
 * left lane into the distance. The markings then ease back to rest exactly
 * where they're drawn, so between times it's the logo as designed.
 *
 * The <img> is swapped for an inline copy of the same SVG (assets/
 * logo-drive-mark.svg) so the markings can move. Honours Reduce Motion (the
 * plain image stays) and does nothing while the tab is hidden.
 */
(function () {
  const INTERVAL_MS = 25000;       // about every 25 seconds
  const INTERVAL_JITTER = 5000;    // ± a little so it doesn't feel robotic
  const FIRST_DELAY_MS = 4000;     // after the sidebar first appears
  const EPISODE_MS = 8000;         // markings ease in, cruise, ease out
  const DASH_STEPS = 2;            // whole dashes travelled, so they stop where they started
  const LIGHTS_START_MS = 900;     // tail lights pull away once the road is moving
  const LIGHTS_MS = 6000;

  const NS = 'http://www.w3.org/2000/svg';
  const A_PATH = 'M3.6 300L147.91 22.48A36.17 36.17 0 0 1 212.09 22.48L356.4 300A25.32 25.32 0 1 1 311.24 322.91L188.02 73.98A8.95 8.95 0 0 0 171.98 73.98L48.76 322.91A25.32 25.32 0 1 1 3.6 300Z';
  const DRIVE_PATH = 'M4 350H29A28 28 0 0 1 57 378A28 28 0 0 1 29 406H4ZM19 363V393H27A13.5 15 0 0 0 40.5 378A13.5 15 0 0 0 27 363ZM89 350H117A21 21 0 0 1 138 371A21 21 0 0 1 117 392H104V406H89ZM104 363V378H115A6.5 7.5 0 0 0 121.5 370.5A6.5 7.5 0 0 0 115 363ZM102.1 380H121.1L139 406H120ZM172.5 350H187.5V406H172.5ZM216.75 350H233.25L247.5 386.7L261.75 350H278.25L256.5 406H238.5ZM307.5 350H356V363H322.5V370.5H352V383.5H322.5V393H356V406H307.5Z';

  // The road's perspective, read off the logo's own dashes: each is ~0.71x the
  // size of the one nearer and they converge on the apex. k counts dash-steps
  // away from the nearest dash (k = 0 is the logo's bottom dash).
  const R = 0.71, Y0 = 298, STEP = 80.64, W0 = 31, H0 = 64;
  const yAt = (k) => Y0 - STEP * (1 - Math.pow(R, k)) / (1 - R);
  // Inside edge of the A's left leg; we drive on the left.
  const leftEdge = (y) => 48.76 + (322.91 - y) / 248.93 * 123.22;
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const f = (n) => n.toFixed(2);

  const reducedMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  function build(img) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 360 410');
    svg.setAttribute('class', 'brand-live');
    svg.setAttribute('aria-hidden', 'true');   // the link around it carries the label
    svg.innerHTML = `
      <defs>
        <clipPath id="brand-road-clip"><rect x="0" y="0" width="360" height="331"/></clipPath>
        <filter id="brand-glow" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="7"/></filter>
      </defs>
      <g transform="translate(180 4) scale(0.9819) translate(-180 -3)">
        <path fill="#fff" d="${A_PATH}"/>
        <g clip-path="url(#brand-road-clip)"><g class="brand-dashes" fill="#fff"></g><g class="brand-lights"></g></g>
      </g>
      <path fill="#46E8AB" d="${DRIVE_PATH}"/>`;
    img.insertAdjacentElement('afterend', svg);
    img.hidden = true;
    return { svg, dashes: svg.querySelector('.brand-dashes'), lights: svg.querySelector('.brand-lights') };
  }

  // phase 0 = the dashes exactly as the logo draws them.
  function drawDashes(g, phase) {
    let html = '';
    for (let n = 0; n <= 5; n++) {
      const k = n - phase;
      const s = Math.pow(R, k), w = W0 * s, h = H0 * s, y = yAt(k);
      // Fade out as one slides off the bottom of the road, in at the far end.
      const o = clamp(1 + k * 3) * clamp((4.3 - k) / 1.2);
      if (o <= 0.01) continue;
      html += `<rect x="${f(180 - w / 2)}" y="${f(y - h / 2)}" width="${f(w)}" height="${f(h)}" rx="${f(w / 2)}"${o < 1 ? ` opacity="${o.toFixed(3)}"` : ''}/>`;
    }
    g.innerHTML = html;
  }

  // One run of the tail lights, t = 0..1 (anything else clears them). Steady
  // speed away from you means size falls as 1/distance, so it slows as it
  // shrinks; spacing comes from the road's width so it stays in its lane.
  function drawLights(g, t) {
    if (t == null || t < 0 || t > 1) { if (g.firstChild) g.innerHTML = ''; return; }
    const d = 1 + 5.2 * Math.pow(t, 1.25);
    const y = yAt(Math.log(d) / Math.log(1 / R));
    const edge = leftEdge(y), W = 2 * (180 - edge);
    const lane = edge + 0.45 * (180 - edge);
    const half = 0.125 * W, lw = 0.09 * W, lh = 0.042 * W, ly = y - 0.06 * W;
    const o = clamp(t / 0.1) * clamp((1 - t) / 0.25);
    const lamp = (x) => `
      <ellipse cx="${f(x)}" cy="${f(ly)}" rx="${f(lw * 1.5)}" ry="${f(lh * 2.2)}" fill="#ff2e2e" opacity="${(0.8 * o).toFixed(3)}" filter="url(#brand-glow)"/>
      <rect x="${f(x - lw / 2)}" y="${f(ly - lh / 2)}" width="${f(lw)}" height="${f(lh)}" rx="${f(lh / 2)}" fill="#ff6060" opacity="${o.toFixed(3)}"/>`;
    g.innerHTML = lamp(lane - half) + lamp(lane + half);
  }

  function init() {
    const brand = document.querySelector('.brand');
    const img = brand && brand.querySelector('img');
    if (!img) return setTimeout(init, 500);
    if (brand.querySelector('.brand-live') || reducedMotion()) return;

    const logo = build(img);
    drawDashes(logo.dashes, 0);

    let timer = null, raf = 0, running = false, stopped = false;

    function play() {
      if (running || stopped || document.hidden) return;
      running = true;
      const t0 = performance.now();
      const step = (now) => {
        const e = now - t0;
        const p = Math.min(1, e / EPISODE_MS);
        // Ease in and out, travelling exactly DASH_STEPS dashes.
        const phase = DASH_STEPS * (0.5 - 0.5 * Math.cos(Math.PI * p));
        drawDashes(logo.dashes, phase % 1);
        drawLights(logo.lights, (e - LIGHTS_START_MS) / LIGHTS_MS);
        if (p < 1 && !stopped) { raf = requestAnimationFrame(step); return; }
        drawDashes(logo.dashes, 0);
        drawLights(logo.lights, null);
        running = false;
      };
      raf = requestAnimationFrame(step);
    }

    function schedule(delay) {
      clearTimeout(timer);
      if (stopped) return;
      timer = setTimeout(() => { play(); schedule(INTERVAL_MS + (Math.random() * 2 - 1) * INTERVAL_JITTER); }, delay);
    }

    // Nothing runs in a background tab.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) clearTimeout(timer);
      else schedule(INTERVAL_MS / 2);
    });

    // Someone switching Reduce Motion on mid-session gets the plain logo back.
    if (window.matchMedia) {
      const mq = matchMedia('(prefers-reduced-motion: reduce)');
      if (mq.addEventListener) mq.addEventListener('change', () => {
        if (!mq.matches) return;
        stopped = true; clearTimeout(timer); cancelAnimationFrame(raf);
        logo.svg.remove(); img.hidden = false;
      });
    }

    schedule(FIRST_DELAY_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
