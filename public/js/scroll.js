/* ==========================================================================
   TERRA — scroll.js
   GSAP ScrollTrigger choreography for the landing hero:
   camera fly-in, plot parcels rising from the earth, floating plot cards,
   stats bar reveal, CTA pulse, and a sand→night gradient shift on scroll.
   Degrades gracefully when GSAP / reduced-motion is unavailable.
   ========================================================================== */
(function () {
  'use strict';

  function reduced() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function init(sceneApi, plots) {
    const hero = document.querySelector('.hero');
    const heroContent = document.querySelector('.hero-content');
    const statsBar = document.querySelector('.stats-bar');
    const cta = document.querySelector('[data-cta="browse"]');

    // Always animate stat number counters when they enter view (cheap, safe).
    setupCounters();

    const gsapOK = typeof window.gsap !== 'undefined' && typeof window.ScrollTrigger !== 'undefined';

    if (!gsapOK || reduced() || !sceneApi || !sceneApi.isMounted || !sceneApi.isMounted()) {
      // Static fallback: just make sure plots are visible and content shown.
      if (sceneApi && sceneApi.raiseAll) sceneApi.raiseAll(1);
      revealStatic();
      return;
    }

    const { gsap } = window;
    gsap.registerPlugin(window.ScrollTrigger);

    const camera = sceneApi.getCamera();
    const controls = sceneApi.getControls();

    // Freeze auto-rotate + user control during the scripted fly-through.
    sceneApi.setAutoRotate(false);
    if (controls) controls.enabled = false;

    // Hero content fade/parallax as we scroll away
    gsap.to(heroContent, {
      scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true },
      opacity: 0, y: -80, ease: 'none',
    });

    // ---- Master timeline: bird's-eye orbit → street level -----------------
    const camState = { x: camera.position.x, y: camera.position.y, z: camera.position.z, tx: 0, ty: 0, tz: 0 };

    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: hero,
        start: 'top top',
        end: '+=1600',
        scrub: 1,
        pin: false,
      },
    });

    // 1) Camera flies from bird's-eye down toward street level
    tl.to(camState, {
      x: 6, y: 10, z: 30, tx: 0, ty: 1, tz: 2,
      ease: 'power2.inOut',
      onUpdate: () => {
        camera.position.set(camState.x, camState.y, camState.z);
        camera.lookAt(camState.tx, camState.ty, camState.tz);
      },
    }, 0);

    // 2) Plots rise out of the ground one-by-one (stagger handled in raiseAll)
    const riseProxy = { p: 0 };
    tl.to(riseProxy, {
      p: 1, ease: 'none',
      onUpdate: () => sceneApi.raiseAll(riseProxy.p),
    }, 0);

    // start fully sunken
    sceneApi.raiseAll(0);

    // 3) Gradient shift sand → night behind the canvas
    tl.fromTo('.hero',
      { backgroundColor: '#F5E6C8' },
      { backgroundColor: '#2C1810', ease: 'none' }, 0);

    // ---- Floating plot cards that track the 3D plots ----------------------
    buildFloatingCards(sceneApi, plots);

    // ---- Stats bar slide-in ----------------------------------------------
    if (statsBar) {
      gsap.from(statsBar, {
        scrollTrigger: { trigger: statsBar, start: 'top 88%' },
        y: 60, opacity: 0, duration: 0.9, ease: 'power3.out',
        onComplete: () => statsBar.style.transform = '',
      });
    }

    // ---- CTA pulse into view ---------------------------------------------
    if (cta) {
      gsap.from(cta, {
        scrollTrigger: { trigger: cta, start: 'top 92%' },
        scale: 0.7, opacity: 0, duration: 0.7, ease: 'back.out(2)',
        onComplete: () => cta.classList.add('pulse'),
      });
    }

    // Re-enable free orbit once the user scrolls back to the very top
    window.ScrollTrigger.create({
      trigger: hero, start: 'top top', end: 'top top-=1',
      onLeaveBack: () => { sceneApi.setAutoRotate(true); if (controls) controls.enabled = !window.matchMedia('(pointer: coarse)').matches; },
      onEnter: () => { sceneApi.setAutoRotate(false); if (controls) controls.enabled = false; },
    });
  }

  // Floating cards positioned over each 3D plot, revealed on scroll.
  function buildFloatingCards(sceneApi, plots) {
    const layer = document.querySelector('.plot-float-layer');
    if (!layer || !plots) return;
    layer.innerHTML = '';

    const T = window.TERRA;
    const cards = {};
    plots.slice(0, 9).forEach((p) => {
      const el = document.createElement('a');
      el.className = 'plot-float-card';
      el.href = '/listing/' + p.id;
      el.style.cssText = 'position:absolute;pointer-events:auto;opacity:0;transform:translate(-50%,-50%) scale(.8);transition:opacity .4s,transform .4s;';
      el.innerHTML = `
        <div style="background:rgba(26,18,8,.82);backdrop-filter:blur(8px);border:1px solid rgba(212,160,23,.5);border-radius:12px;padding:.7rem .9rem;min-width:150px;color:#F0E6D2;box-shadow:0 12px 30px -12px rgba(0,0,0,.6)">
          <div style="font-family:'Playfair Display',serif;font-weight:700;font-size:.95rem;color:#D4A017">${T.escapeHTML(p.title)}</div>
          <div style="font-size:.74rem;opacity:.8;margin:.2rem 0">${T.formatArea(p.area_m2).m2} m² · ${T.escapeHTML(p.status)}</div>
          <div style="font-family:'Playfair Display',serif;font-weight:800;color:#D4A017">${T.formatPrice(p.price_jod).formatted} ${T.formatPrice(p.price_jod).unit}</div>
        </div>`;
      layer.appendChild(el);
      cards[p.id] = el;
    });

    // Track positions each frame while hero is in view
    function update() {
      const rect = layer.getBoundingClientRect();
      const positions = sceneApi.plotScreenPositions();
      Object.entries(cards).forEach(([id, el]) => {
        const pos = positions[id];
        if (!pos) return;
        el.style.left = (pos.x * rect.width) + 'px';
        el.style.top = (pos.y * rect.height) + 'px';
      });
      requestAnimationFrame(update);
    }
    update();

    // Reveal cards progressively as user scrolls into the rise section
    if (window.ScrollTrigger) {
      window.ScrollTrigger.create({
        trigger: '.hero', start: 'top top', end: '+=1600', scrub: true,
        onUpdate: (self) => {
          const ids = Object.keys(cards);
          ids.forEach((id, i) => {
            const threshold = 0.35 + (i / ids.length) * 0.5;
            const on = self.progress >= threshold;
            const el = cards[id];
            el.style.opacity = on ? '1' : '0';
            el.style.transform = on ? 'translate(-50%,-50%) scale(1)' : 'translate(-50%,-50%) scale(.8)';
          });
        },
      });
    }
  }

  function setupCounters() {
    const els = document.querySelectorAll('[data-count]');
    if (!els.length) return;
    const run = (el) => {
      const target = Number(el.dataset.count);
      const dur = 1400; const start = performance.now();
      const prefix = el.dataset.prefix || ''; const suffix = el.dataset.suffix || '';
      function step(now) {
        const t = Math.min(1, (now - start) / dur);
        const eased = 1 - Math.pow(1 - t, 3);
        const val = Math.round(target * eased);
        el.textContent = prefix + val.toLocaleString('en-US') + suffix;
        if (t < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    };
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => { if (e.isIntersecting) { run(e.target); io.unobserve(e.target); } });
      }, { threshold: 0.5 });
      els.forEach((el) => io.observe(el));
    } else {
      els.forEach(run);
    }
  }

  function revealStatic() {
    document.querySelectorAll('.plot-float-card').forEach((el) => { el.style.opacity = '1'; el.style.transform = 'translate(-50%,-50%)'; });
    const cta = document.querySelector('[data-cta="browse"]');
    if (cta) cta.classList.add('pulse');
  }

  window.TerraScroll = { init };
})();
