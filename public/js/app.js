/* ==========================================================================
   TERRA — app.js
   Shared utilities: API client, formatting, toasts, currency toggle,
   dark mode, favorites (localStorage), WhatsApp CTA, settings.
   Exposed on window.TERRA
   ========================================================================== */
(function () {
  'use strict';

  const USD_RATE = 1.41; // 1 JOD = 1.41 USD (hardcoded local rate)

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
      catch { return fallback; }
    },
    set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ } },
  };

  /* ---------- API ---------- */
  const api = {
    async listings(params = {}) {
      const qs = new URLSearchParams(params).toString();
      const r = await fetch('/api/listings' + (qs ? '?' + qs : ''));
      if (!r.ok) throw new Error('Failed to load listings');
      return r.json();
    },
    async listing(id) {
      const r = await fetch('/api/listings/' + id);
      if (!r.ok) throw new Error('Listing not found');
      return r.json();
    },
    async createListing(formData) {
      const r = await fetch('/api/listings', { method: 'POST', body: formData });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Create failed');
      return r.json();
    },
    async updateListing(id, formData) {
      const r = await fetch('/api/listings/' + id, { method: 'PUT', body: formData });
      if (!r.ok) throw new Error('Update failed');
      return r.json();
    },
    async updateListingJSON(id, obj) {
      const r = await fetch('/api/listings/' + id, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj),
      });
      if (!r.ok) throw new Error('Update failed');
      return r.json();
    },
    async deleteListing(id) {
      const r = await fetch('/api/listings/' + id, { method: 'DELETE' });
      if (!r.ok) throw new Error('Delete failed');
      return r.json();
    },
    async deleteImage(id, filename) {
      const r = await fetch(`/api/listings/${id}/image/${encodeURIComponent(filename)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('Delete image failed');
      return r.json();
    },
    async createInquiry(obj) {
      const r = await fetch('/api/inquiries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Inquiry failed');
      return r.json();
    },
    async inquiries() { const r = await fetch('/api/inquiries'); return r.json(); },
    async patchInquiry(id, obj) {
      const r = await fetch('/api/inquiries/' + id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj),
      });
      return r.json();
    },
    async deleteInquiry(id) {
      const r = await fetch('/api/inquiries/' + id, { method: 'DELETE' });
      return r.json();
    },
    async settings() { const r = await fetch('/api/settings'); return r.json(); },
    async saveSettings(obj) {
      const r = await fetch('/api/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj),
      });
      return r.json();
    },
  };

  /* ---------- Currency ---------- */
  function currency() { return store.get('terra_currency', 'JOD'); }
  function setCurrency(c) { store.set('terra_currency', c); document.dispatchEvent(new CustomEvent('currencychange', { detail: c })); }
  function toggleCurrency() { setCurrency(currency() === 'JOD' ? 'USD' : 'JOD'); }

  function formatPrice(jod) {
    const cur = currency();
    const amount = cur === 'USD' ? jod * USD_RATE : jod;
    const formatted = Math.round(amount).toLocaleString('en-US');
    return { formatted, unit: cur === 'USD' ? 'USD' : 'JD', raw: amount };
  }
  function priceHTML(jod) {
    const p = formatPrice(jod);
    return `${p.formatted} <small>${p.unit}</small>`;
  }

  function formatArea(m2) {
    const dunums = (m2 / 1000).toFixed(2);
    return { m2: Number(m2).toLocaleString('en-US'), dunums };
  }

  /* ---------- Dark mode ---------- */
  function initTheme() {
    const saved = store.get('terra_theme', null);
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved || (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
    return theme;
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    store.set('terra_theme', next);
    document.dispatchEvent(new CustomEvent('themechange', { detail: next }));
    return next;
  }

  /* ---------- Favorites ---------- */
  function favorites() { return store.get('terra_favs', []); }
  function isFav(id) { return favorites().includes(Number(id)); }
  function toggleFav(id) {
    id = Number(id);
    const favs = favorites();
    const i = favs.indexOf(id);
    if (i === -1) { favs.push(id); toast('Added to favorites', 'success'); }
    else { favs.splice(i, 1); toast('Removed from favorites', 'info'); }
    store.set('terra_favs', favs);
    document.dispatchEvent(new CustomEvent('favchange', { detail: favs }));
    return favs.includes(id);
  }

  /* ---------- Toasts ---------- */
  function ensureToastWrap() {
    let w = document.getElementById('toast-wrap');
    if (!w) { w = document.createElement('div'); w.id = 'toast-wrap'; document.body.appendChild(w); }
    return w;
  }
  const TOAST_ICONS = { success: '✓', error: '✕', info: 'ℹ' };
  function toast(msg, type = 'info', ms = 3200) {
    const wrap = ensureToastWrap();
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML = `<span class="t-icon">${TOAST_ICONS[type] || 'ℹ'}</span><span>${escapeHTML(msg)}</span>`;
    wrap.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, ms);
  }

  /* ---------- Helpers ---------- */
  function escapeHTML(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function imgURL(filename) {
    if (!filename) return null;
    if (/^https?:\/\//.test(filename)) return filename;
    return '/uploads/' + filename;
  }
  function whatsappURL(text, number) {
    const base = number ? `https://wa.me/${number}` : 'https://wa.me/';
    return `${base}?text=${encodeURIComponent(text)}`;
  }
  function statusBadge(status) {
    return `<span class="badge status-${status}">${status}</span>`;
  }
  function typeBadge(type) {
    return `<span class="badge badge-type">${type}</span>`;
  }
  function debounce(fn, ms = 300) {
    let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
  }

  /* ---------- Card renderer (shared by listings + favorites) ---------- */
  function cardHTML(l) {
    const img = imgURL(l.featured_image);
    const area = formatArea(l.area_m2);
    const media = img
      ? `<img src="${img}" alt="${escapeHTML(l.title)}" loading="lazy">`
      : `<div class="placeholder"><span>${escapeHTML((l.parcel_number.match(/Plot\s*(\d+)/i) || [,'▲'])[1] || '▲')}</span></div>`;
    return `
      <article class="card" data-id="${l.id}">
        <div class="card-media ${img ? 'lazy' : ''}">
          ${media}
          <span class="stamp">${escapeHTML(l.parcel_number || 'Parcel')}</span>
          <button class="fav-btn ${isFav(l.id) ? 'active' : ''}" data-fav="${l.id}" aria-label="Toggle favorite">${isFav(l.id) ? '♥' : '♡'}</button>
        </div>
        <div class="card-body">
          <div class="badge-row">${typeBadge(l.land_type)} ${statusBadge(l.status)}</div>
          <h3><a href="/listing/${l.id}">${escapeHTML(l.title)}</a></h3>
          <div class="card-loc">📍 ${escapeHTML(l.location || '—')}</div>
          <div class="card-meta">
            <span><b>${area.m2}</b> m²</span>
            <span><b>${area.dunums}</b> dunums</span>
          </div>
          <div class="card-foot">
            <span class="price">${priceHTML(l.price_jod)}</span>
            <a class="btn btn-outline" href="/listing/${l.id}">View Details</a>
          </div>
        </div>
      </article>`;
  }

  // Wire up lazy blur-up + favorite buttons within a container
  function hydrateCards(container) {
    container.querySelectorAll('.card-media.lazy img').forEach((img) => {
      const done = () => img.closest('.card-media').classList.add('loaded');
      if (img.complete) done(); else { img.addEventListener('load', done); img.addEventListener('error', done); }
    });
    container.querySelectorAll('[data-fav]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const on = toggleFav(btn.dataset.fav);
        btn.classList.toggle('active', on);
        btn.textContent = on ? '♥' : '♡';
      });
    });
  }

  /* ---------- Global chrome (nav behaviour, theme/currency buttons, WA) ---------- */
  let SETTINGS = null;
  async function loadSettings() {
    if (SETTINGS) return SETTINGS;
    try { SETTINGS = await api.settings(); } catch { SETTINGS = {}; }
    return SETTINGS;
  }

  function initChrome() {
    initTheme();

    // Nav scroll state
    const nav = document.querySelector('.nav');
    if (nav) {
      const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 30);
      onScroll(); window.addEventListener('scroll', onScroll, { passive: true });
    }

    // Theme + currency toggles (any element with data-action)
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const act = el.dataset.action;
      if (act === 'toggle-theme') { const t = toggleTheme(); el.textContent = t === 'dark' ? '☀' : '☾'; }
      if (act === 'toggle-currency') { toggleCurrency(); el.textContent = currency(); }
      if (act === 'toggle-menu') { document.querySelector('.mobile-drawer')?.classList.toggle('open'); }
    });

    // Sync button labels on load
    document.querySelectorAll('[data-action="toggle-currency"]').forEach((b) => (b.textContent = currency()));
    document.querySelectorAll('[data-action="toggle-theme"]').forEach((b) => {
      b.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀' : '☾';
    });

    // Re-render prices when currency changes
    document.addEventListener('currencychange', () => {
      document.querySelectorAll('[data-price]').forEach((el) => { el.innerHTML = priceHTML(Number(el.dataset.price)); });
    });

    // WhatsApp floating button
    loadSettings().then((s) => {
      const wa = document.getElementById('wa-float');
      if (wa) {
        wa.href = whatsappURL("Hello TERRA — I'm interested in your land listings.", s.whatsapp);
      }
    });
  }

  window.TERRA = {
    api, store, USD_RATE,
    currency, setCurrency, toggleCurrency, formatPrice, priceHTML, formatArea,
    initTheme, toggleTheme,
    favorites, isFav, toggleFav,
    toast, escapeHTML, imgURL, whatsappURL, statusBadge, typeBadge, debounce,
    cardHTML, hydrateCards, loadSettings, initChrome,
  };

  // Auto-init chrome once DOM ready
  if (document.readyState !== 'loading') initChrome();
  else document.addEventListener('DOMContentLoaded', initChrome);
})();
