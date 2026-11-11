/*
 * Brand road animation — a small white vehicle drives down the "A" road in
 * the sidebar logo once a minute. Self-contained: builds an overlay layered
 * on top of the existing logo image (nothing about the logo, sidebar or
 * layout is changed), honours Reduce Motion, and pauses when the tab is
 * hidden so it isn't burning CPU in the background.
 */
(function () {
  const INTERVAL_MS = 60000;       // once a minute
  const INTERVAL_JITTER = 8000;    // ± a few seconds so it doesn't feel robotic
  const FIRST_DELAY_MS = 6000;     // wait after the sidebar first appears
  const DRIVE_DURATION_MS = 6000;  // one vehicle's journey top -> bottom

  const reducedMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  // White vehicles only — things that read as road traffic. Excavator and
  // trailer would look odd driving down a highway, so they're not in here.
  function pickVehicleArt() {
    const A = window.AD && window.AD.art;
    if (!A) return '';
    const kinds = ['ute', 'tip', 'van', 'vac'];
    const k = kinds[Math.floor(Math.random() * kinds.length)];
    if (k === 'vac') return A.vac(String(Math.floor(Math.random() * 8) + 1).padStart(2, '0'), 120, 'brand road vehicle');
    return A[k](120, 'brand road vehicle');
  }

  function init() {
    const brand = document.querySelector('.brand');
    if (!brand) return setTimeout(init, 500);
    const img = brand.querySelector('img');
    if (!img || !img.complete || !img.getBoundingClientRect().width) return setTimeout(init, 400);
    if (brand.querySelector('.brand-road')) return; // already wired

    // Non-destructive overlay: positioned exactly over the logo img. We only
    // give .brand position:relative if it isn't already, leaving the padding,
    // size and alignment the designer picked alone.
    if (getComputedStyle(brand).position === 'static') brand.style.position = 'relative';

    const road = document.createElement('div');
    road.className = 'brand-road';
    road.setAttribute('aria-hidden', 'true');
    brand.appendChild(road);

    let timer = null;
    let aborted = false;

    function spawn() {
      if (reducedMotion() || document.hidden) return;
      const car = document.createElement('div');
      car.className = 'brand-road-car';
      car.innerHTML = pickVehicleArt();
      road.appendChild(car);
      // Remove once the animation has finished so the DOM stays clean.
      car.addEventListener('animationend', () => car.remove(), { once: true });
      setTimeout(() => car.remove(), DRIVE_DURATION_MS + 1500); // safety net
    }

    function schedule(firstDelay) {
      clearTimeout(timer);
      if (aborted) return;
      const delay = firstDelay != null ? firstDelay
        : INTERVAL_MS + (Math.random() * 2 - 1) * INTERVAL_JITTER;
      timer = setTimeout(() => {
        spawn();
        schedule();
      }, delay);
    }

    // Don't spin the timer while the tab is in the background.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { clearTimeout(timer); }
      else { schedule(INTERVAL_MS / 2); }
    });

    // Honour Reduce Motion changes mid-session (someone toggling the OS setting).
    if (window.matchMedia) {
      const mq = matchMedia('(prefers-reduced-motion: reduce)');
      mq.addEventListener && mq.addEventListener('change', () => {
        if (mq.matches) { aborted = true; clearTimeout(timer); road.remove(); }
      });
    }

    if (!reducedMotion()) schedule(FIRST_DELAY_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
