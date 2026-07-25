/* ==========================================================================
   TERRA — listing.js
   Single listing detail: gallery + lightbox, 3D highlighted mini-map,
   facts, map embed, contact form → SQLite, favorites, share, brochure.
   ========================================================================== */
(function () {
  'use strict';
  const T = window.TERRA;

  const root = document.getElementById('listing-root');
  let listing = null;
  let gallery = [];
  let lbIndex = 0;
  let allPlots = [];

  document.getElementById('year').textContent = new Date().getFullYear();
  document.addEventListener('DOMContentLoaded', boot);

  function getId() {
    const m = location.pathname.match(/\/listing\/(\d+)/);
    if (m) return Number(m[1]);
    const q = new URLSearchParams(location.search).get('id');
    return q ? Number(q) : null;
  }

  async function boot() {
    const id = getId();
    if (!id) { root.innerHTML = notFound(); return; }
    try {
      listing = await T.api.listing(id);
      allPlots = await T.api.listings({});
    } catch (e) {
      root.innerHTML = notFound();
      return;
    }
    render();
    initMiniMap();
    wire();
    applyMeta();
  }

  function notFound() {
    return `<div class="empty"><div class="big">🏜️</div>Parcel not found.<br/><a class="btn btn-primary" style="margin-top:1rem" href="/#listings">Back to listings</a></div>`;
  }

  function applyMeta() {
    document.title = `${listing.title} · TERRA`;
    const img = T.imgURL(listing.featured_image) || '/og-image.svg';
    const desc = (listing.description || '').replace(/<[^>]+>/g, '').slice(0, 160) || 'A curated land parcel on TERRA.';
    document.getElementById('meta-desc').content = desc;
    document.getElementById('og-title').content = listing.title + ' · TERRA';
    document.getElementById('og-desc').content = desc;
    document.getElementById('og-image').content = img;
    T.loadSettings().then((s) => {
      const wa = document.getElementById('wa-float');
      if (wa) wa.href = T.whatsappURL(`I'm interested in ${listing.title} (${listing.parcel_number})`, s.whatsapp);
    });
  }

  function render() {
    gallery = (listing.images || []).map(T.imgURL);
    const area = T.formatArea(listing.area_m2);
    const hasImgs = gallery.length > 0;
    const mainImg = hasImgs
      ? `<img id="gmain" src="${gallery[0]}" alt="${T.escapeHTML(listing.title)}" />`
      : `<div class="placeholder" style="width:100%;height:100%">
           <span style="font-family:var(--font-display);font-size:4rem;color:rgba(26,18,8,.5);font-weight:800">
             ${T.escapeHTML((listing.parcel_number.match(/Plot\s*(\d+)/i) || [, '▲'])[1] || '▲')}
           </span>
         </div>`;

    const thumbs = hasImgs
      ? `<div class="gallery-thumbs">${gallery.map((g, i) => `<img data-idx="${i}" class="${i === 0 ? 'active' : ''}" src="${g}" alt="thumb ${i + 1}">`).join('')}</div>`
      : '';

    const coords = (listing.lat && listing.lng)
      ? `${listing.lat.toFixed(5)}, ${listing.lng.toFixed(5)}`
      : 'Coordinates on request';

    const mapEmbed = (listing.lat && listing.lng)
      ? `<iframe class="map-embed" loading="lazy" src="https://www.google.com/maps?q=${listing.lat},${listing.lng}&z=15&output=embed" title="Map"></iframe>`
      : `<div class="map-embed" style="display:grid;place-items:center;background:var(--stone);color:var(--text)"><span class="muted">Map location available on request</span></div>`;

    root.innerHTML = `
      <a href="/#listings" class="muted" style="display:inline-block;margin-bottom:1rem">← All listings</a>

      <div class="detail-hero">
        <div>
          <div class="gallery-main">${mainImg}</div>
          ${thumbs}

          <div style="margin-top:2rem">
            <h2 style="font-size:1.4rem;margin-bottom:.6rem">Location Map</h2>
            ${mapEmbed}
          </div>

          <div style="margin-top:2rem">
            <h2 style="font-size:1.4rem;margin-bottom:.6rem">Parcel on the 3D Terrain</h2>
            <div id="mini-map"></div>
            <p class="pin-hint">This parcel highlighted on the TERRA subdivision terrain. Drag to look around.</p>
          </div>
        </div>

        <div>
          <div class="badge-row" style="margin-bottom:.8rem">${T.typeBadge(listing.land_type)} ${T.statusBadge(listing.status)}</div>
          <h1 style="font-size:2.2rem">${T.escapeHTML(listing.title)}</h1>
          <div class="card-loc" style="margin:.5rem 0 1rem;font-size:1rem">📍 ${T.escapeHTML(listing.location || '—')}</div>
          <div class="price" style="font-size:2rem" data-price="${listing.price_jod}">${T.priceHTML(listing.price_jod)}</div>

          <div class="detail-facts" style="margin-top:1.4rem">
            <div class="fact-row"><span class="k">Parcel Number</span><span class="v">${T.escapeHTML(listing.parcel_number || '—')}</span></div>
            <div class="fact-row"><span class="k">Land Type</span><span class="v">${T.escapeHTML(listing.land_type)}</span></div>
            <div class="fact-row"><span class="k">Area</span><span class="v">${area.m2} m² · ${area.dunums} dunums</span></div>
            <div class="fact-row"><span class="k">Status</span><span class="v">${T.escapeHTML(listing.status)}</span></div>
            <div class="fact-row"><span class="k">Coordinates</span><span class="v">${coords}</span></div>
            <div class="fact-row"><span class="k">Listed</span><span class="v">${new Date(listing.created_at).toLocaleDateString()}</span></div>
          </div>

          <div class="detail-actions">
            <button class="btn btn-gold" id="fav-btn">${T.isFav(listing.id) ? '♥ Saved' : '♡ Add to Favorites'}</button>
            <button class="btn btn-ghost" id="share-btn">↗ Share</button>
            <button class="btn btn-ghost" id="brochure-btn">⤓ Download Brochure</button>
          </div>
        </div>
      </div>

      <section style="margin-top:3rem">
        <h2 style="font-size:1.6rem;margin-bottom:.8rem">About this parcel</h2>
        <div class="muted" style="max-width:60ch;line-height:1.7">${listing.description || 'No description provided.'}</div>
      </section>

      <section style="margin-top:3rem;max-width:560px">
        <h2 style="font-size:1.6rem;margin-bottom:1rem">Inquire about this parcel</h2>
        <form id="inquiry-form" class="detail-facts">
          <div class="form-field"><label>Name *</label><input name="name" required /></div>
          <div class="form-field"><label>Email *</label><input name="email" type="email" required /></div>
          <div class="form-field"><label>Phone</label><input name="phone" /></div>
          <div class="form-field"><label>Message *</label><textarea name="message" required>I'm interested in ${T.escapeHTML(listing.title)} (${T.escapeHTML(listing.parcel_number)}).</textarea></div>
          <button class="btn btn-primary btn-block" type="submit">Send Inquiry</button>
        </form>
      </section>
    `;
  }

  function initMiniMap() {
    const el = document.getElementById('mini-map');
    if (!el || !window.TerraSceneFactory) return;
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%'; canvas.style.height = '100%';
    el.appendChild(canvas);
    const mini = window.TerraSceneFactory();
    const plots = allPlots.map((l) => ({ id: l.id, status: l.status, map_x: l.map_x, map_z: l.map_z }));
    const ok = mini.init(canvas, { plots, mini: true, autoRotate: false, controls: true });
    if (ok) setTimeout(() => mini.highlight(listing.id), 200);
  }

  function wire() {
    // Gallery thumbnails
    root.querySelectorAll('.gallery-thumbs img').forEach((t) => {
      t.addEventListener('click', () => {
        const idx = Number(t.dataset.idx);
        document.getElementById('gmain').src = gallery[idx];
        root.querySelectorAll('.gallery-thumbs img').forEach((x) => x.classList.remove('active'));
        t.classList.add('active');
        lbIndex = idx;
      });
    });
    // Lightbox open
    const gmain = document.getElementById('gmain');
    if (gmain) gmain.addEventListener('click', () => openLightbox(lbIndex));

    // Favorite
    document.getElementById('fav-btn').addEventListener('click', (e) => {
      const on = T.toggleFav(listing.id);
      e.target.textContent = on ? '♥ Saved' : '♡ Add to Favorites';
    });
    // Share
    document.getElementById('share-btn').addEventListener('click', async () => {
      const url = location.href;
      if (navigator.share) { try { await navigator.share({ title: listing.title, url }); return; } catch { /* fall through */ } }
      try { await navigator.clipboard.writeText(url); T.toast('Link copied to clipboard', 'success'); }
      catch { T.toast(url, 'info', 6000); }
    });
    // Brochure (print one-pager)
    document.getElementById('brochure-btn').addEventListener('click', printBrochure);

    // Inquiry form
    document.getElementById('inquiry-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        listing_id: listing.id,
        name: fd.get('name'), email: fd.get('email'),
        phone: fd.get('phone'), message: fd.get('message'),
      };
      let ok = true;
      e.target.querySelectorAll('[required]').forEach((inp) => {
        const wrap = inp.closest('.form-field');
        if (!inp.value.trim()) { wrap.classList.add('invalid'); ok = false; }
        else wrap.classList.remove('invalid');
      });
      if (!ok) { T.toast('Please fill the required fields', 'error'); return; }
      try {
        await T.api.createInquiry(payload);
        T.toast('Inquiry sent — we\'ll be in touch!', 'success');
        e.target.reset();
      } catch (err) { T.toast(err.message || 'Could not send inquiry', 'error'); }
    });

    // Lightbox controls
    document.getElementById('lb-close').addEventListener('click', closeLightbox);
    document.getElementById('lb-prev').addEventListener('click', () => stepLightbox(-1));
    document.getElementById('lb-next').addEventListener('click', () => stepLightbox(1));
    document.getElementById('lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') closeLightbox(); });
    document.addEventListener('keydown', (e) => {
      if (!document.getElementById('lightbox').classList.contains('open')) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') stepLightbox(-1);
      if (e.key === 'ArrowRight') stepLightbox(1);
    });
  }

  function openLightbox(i) {
    if (!gallery.length) return;
    lbIndex = i;
    document.getElementById('lb-img').src = gallery[lbIndex];
    document.getElementById('lightbox').classList.add('open');
  }
  function closeLightbox() { document.getElementById('lightbox').classList.remove('open'); }
  function stepLightbox(d) {
    if (!gallery.length) return;
    lbIndex = (lbIndex + d + gallery.length) % gallery.length;
    document.getElementById('lb-img').src = gallery[lbIndex];
  }

  function printBrochure() {
    const area = T.formatArea(listing.area_m2);
    const price = T.formatPrice(listing.price_jod);
    const img = T.imgURL(listing.featured_image);
    const win = window.open('', '_blank');
    if (!win) { T.toast('Please allow pop-ups to download the brochure', 'error'); return; }
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${T.escapeHTML(listing.title)} — TERRA Brochure</title>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800&family=Inter:wght@400;600&display=swap" rel="stylesheet">
      <style>
        body{font-family:Inter,sans-serif;color:#2C1810;margin:0;padding:40px}
        .hd{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #D4A017;padding-bottom:12px}
        .brand{font-family:'Playfair Display',serif;font-size:28px;font-weight:800}
        .brand span{color:#D4A017}
        h1{font-family:'Playfair Display',serif;font-size:34px;margin:20px 0 4px}
        .hero-img{width:100%;height:320px;object-fit:cover;border-radius:12px;margin:16px 0;background:#C8A96E}
        .facts{width:100%;border-collapse:collapse;margin-top:16px}
        .facts td{padding:10px 6px;border-bottom:1px solid #eadfca}
        .facts td:first-child{color:#8B5E3C;width:40%}
        .price{font-family:'Playfair Display',serif;font-size:30px;color:#D4A017;font-weight:800}
        .ft{margin-top:30px;font-size:12px;color:#999;border-top:1px solid #eadfca;padding-top:12px}
        .placeholder{width:100%;height:320px;border-radius:12px;background:repeating-linear-gradient(115deg,#C8A96E 0 22px,#bfa063 22px 44px);display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-size:60px;color:rgba(26,18,8,.4);font-weight:800}
      </style></head><body>
      <div class="hd"><div class="brand">▲ <span>TERRA</span></div><div>Jordanian Land Platform</div></div>
      <h1>${T.escapeHTML(listing.title)}</h1>
      <div style="color:#8B5E3C">📍 ${T.escapeHTML(listing.location)} · ${T.escapeHTML(listing.parcel_number)}</div>
      ${img ? `<img class="hero-img" src="${img}">` : `<div class="placeholder">▲</div>`}
      <div class="price">${price.formatted} ${price.unit}</div>
      <table class="facts">
        <tr><td>Land Type</td><td>${T.escapeHTML(listing.land_type)}</td></tr>
        <tr><td>Area</td><td>${area.m2} m² (${area.dunums} dunums)</td></tr>
        <tr><td>Status</td><td>${T.escapeHTML(listing.status)}</td></tr>
        <tr><td>Coordinates</td><td>${listing.lat && listing.lng ? listing.lat + ', ' + listing.lng : 'On request'}</td></tr>
      </table>
      <p style="margin-top:16px;line-height:1.6">${(listing.description || '').replace(/<[^>]+>/g, '')}</p>
      <div class="ft">Generated by TERRA · ${new Date().toLocaleDateString()} · This brochure is for informational purposes only.</div>
      <script>window.onload=function(){setTimeout(function(){window.print()},400)}<\/script>
      </body></html>`);
    win.document.close();
  }

  document.addEventListener('currencychange', () => {
    if (!listing) return;
    const el = document.querySelector('.price[data-price]');
    if (el) el.innerHTML = T.priceHTML(listing.price_jod);
  });
})();
