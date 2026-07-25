/* ==========================================================================
   TERRA — listings.js
   Landing page orchestration: hero settings, loader, 3D scene + GSAP scroll,
   listings grid with filters / search / sort.
   ========================================================================== */
(function () {
  'use strict';
  const T = window.TERRA;

  const state = {
    all: [],
    filters: { type: 'all', status: 'all', search: '', sort: 'newest', minPrice: '', maxPrice: '', minArea: '', maxArea: '' },
  };

  const grid = document.getElementById('listings-grid');
  const resultCount = document.getElementById('result-count');

  document.addEventListener('DOMContentLoaded', boot);

  async function boot() {
    // Footer + hero from settings
    applySettings();
    document.getElementById('year').textContent = new Date().getFullYear();

    // Load listings first (needed for 3D plot positions + grid)
    let listings = [];
    try { listings = await T.api.listings({ sort: 'newest' }); }
    catch (e) { T.toast('Could not load listings', 'error'); }
    state.all = listings;

    // Boot 3D scene with real plot data
    initScene(listings);

    // Render grid
    render();
    wireControls();
    hideLoader();
  }

  async function applySettings() {
    try {
      const s = await T.loadSettings();
      if (s.heroHeading) {
        const h = document.getElementById('hero-heading');
        // keep the italic emphasis on last word if present
        h.textContent = s.heroHeading;
      }
      if (s.heroSubheading) document.getElementById('hero-sub').textContent = s.heroSubheading;
      const cta = document.querySelector('[data-cta="browse"]');
      if (cta && s.ctaLabel) cta.textContent = s.ctaLabel + ' ▲';
      const fe = document.getElementById('foot-email');
      if (fe && s.contactEmail) { fe.textContent = s.contactEmail; fe.href = 'mailto:' + s.contactEmail; }
      const fw = document.getElementById('foot-wa');
      if (fw && s.whatsapp) fw.href = T.whatsappURL('Hello TERRA', s.whatsapp);
      document.title = (s.siteTitle || 'TERRA') + ' — ' + (s.tagline || 'Jordanian Land Platform');
    } catch { /* ignore */ }
  }

  function initScene(listings) {
    const canvas = document.getElementById('scene-canvas');
    if (!canvas) return;
    const plots = listings.map((l) => ({
      id: l.id,
      title: l.title,
      area_m2: l.area_m2,
      price_jod: l.price_jod,
      status: l.status,
      map_x: l.map_x,
      map_z: l.map_z,
    }));
    const ok = window.TerraScene.init(canvas, {
      plots: plots.length ? plots : undefined,
      autoRotate: true,
    });
    // Wire GSAP scroll choreography against the mounted scene
    if (window.TerraScroll) window.TerraScroll.init(window.TerraScene, listings);
    if (!ok) {
      // No WebGL/THREE — scroll.js already falls back; nothing else needed.
    }
  }

  function hideLoader() {
    const loader = document.getElementById('loader');
    if (!loader) return;
    // give the fonts + first frame a moment
    setTimeout(() => loader.classList.add('hide'), 1600);
  }

  // -------- Filtering (client-side over loaded data for snappy UX) --------
  function applyFilters(list) {
    const f = state.filters;
    let out = list.slice();
    if (f.type !== 'all') out = out.filter((l) => l.land_type === f.type);
    if (f.status !== 'all') out = out.filter((l) => l.status === f.status);
    if (f.search) {
      const q = f.search.toLowerCase();
      out = out.filter((l) =>
        (l.title || '').toLowerCase().includes(q) ||
        (l.location || '').toLowerCase().includes(q) ||
        (l.parcel_number || '').toLowerCase().includes(q));
    }
    if (f.minPrice) out = out.filter((l) => l.price_jod >= Number(f.minPrice));
    if (f.maxPrice) out = out.filter((l) => l.price_jod <= Number(f.maxPrice));
    if (f.minArea) out = out.filter((l) => l.area_m2 >= Number(f.minArea));
    if (f.maxArea) out = out.filter((l) => l.area_m2 <= Number(f.maxArea));

    const sorters = {
      newest: (a, b) => (b.created_at > a.created_at ? 1 : -1),
      price_asc: (a, b) => a.price_jod - b.price_jod,
      price_desc: (a, b) => b.price_jod - a.price_jod,
      area_asc: (a, b) => a.area_m2 - b.area_m2,
      area_desc: (a, b) => b.area_m2 - a.area_m2,
    };
    out.sort(sorters[f.sort] || sorters.newest);
    return out;
  }

  function render() {
    const list = applyFilters(state.all);
    if (!list.length) {
      grid.innerHTML = '<div class="empty"><div class="big">🏜️</div>No parcels match your filters.</div>';
    } else {
      grid.innerHTML = list.map((l) => T.cardHTML(l)).join('');
      T.hydrateCards(grid);
    }
    if (resultCount) resultCount.textContent = `${list.length} of ${state.all.length} parcels`;
  }

  function wireControls() {
    // Type chips
    document.getElementById('type-chips').addEventListener('click', (e) => {
      const b = e.target.closest('.chip'); if (!b) return;
      document.querySelectorAll('#type-chips .chip').forEach((c) => c.classList.remove('active'));
      b.classList.add('active');
      state.filters.type = b.dataset.type; render();
    });
    // Status chips
    document.getElementById('status-chips').addEventListener('click', (e) => {
      const b = e.target.closest('.chip'); if (!b) return;
      document.querySelectorAll('#status-chips .chip').forEach((c) => c.classList.remove('active'));
      b.classList.add('active');
      state.filters.status = b.dataset.status; render();
    });
    // Search (debounced)
    const search = document.getElementById('search');
    search.addEventListener('input', T.debounce(() => { state.filters.search = search.value.trim(); render(); }, 220));
    // Sort
    document.getElementById('sort').addEventListener('change', (e) => { state.filters.sort = e.target.value; render(); });
    // Ranges
    ['minPrice', 'maxPrice', 'minArea', 'maxArea'].forEach((id) => {
      document.getElementById(id).addEventListener('input', T.debounce((e) => { state.filters[id] = e.target.value; render(); }, 250));
    });
    // Reset
    document.getElementById('reset-filters').addEventListener('click', () => {
      state.filters = { type: 'all', status: 'all', search: '', sort: 'newest', minPrice: '', maxPrice: '', minArea: '', maxArea: '' };
      document.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      document.querySelector('#type-chips .chip[data-type="all"]').classList.add('active');
      document.querySelector('#status-chips .chip[data-status="all"]').classList.add('active');
      ['search', 'minPrice', 'maxPrice', 'minArea', 'maxArea'].forEach((id) => (document.getElementById(id).value = ''));
      document.getElementById('sort').value = 'newest';
      render();
    });
    // Re-render on favorite change (keeps hearts in sync)
    document.addEventListener('favchange', render);
  }
})();
