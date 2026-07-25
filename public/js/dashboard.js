/* ==========================================================================
   TERRA — dashboard.js
   Admin: password gate, tab nav, overview (KPIs + Chart.js), listings
   management (sort/search/bulk/edit/delete/status), add/edit form with
   drag-drop image upload + contenteditable description + 3D pin-map picker,
   inquiries, and settings.
   ========================================================================== */
(function () {
  'use strict';
  const T = window.TERRA;
  const AUTH_KEY = 'terra_admin_auth';
  const PASSWORD = 'terra2025';

  let listings = [];
  let inquiries = [];
  let charts = {};
  let pinMap = null;
  let pin = { x: null, z: null };
  let uploads = [];          // { file, url, name } for new files
  let existingImages = [];   // filenames kept when editing
  let featured = null;       // filename or object-url string
  let editingId = null;
  let lstSort = { key: 'created_at', dir: 'desc' };
  let selected = new Set();

  /* ------------------------------------------------------------------ Gate */
  function isAuthed() { return sessionStorage.getItem(AUTH_KEY) === '1'; }
  function initGate() {
    const gate = document.getElementById('gate');
    const shell = document.getElementById('shell');
    if (isAuthed()) { gate.style.display = 'none'; shell.style.display = 'grid'; return start(); }
    document.getElementById('gate-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const val = document.getElementById('gate-pass').value;
      if (val === PASSWORD) {
        sessionStorage.setItem(AUTH_KEY, '1');
        gate.style.display = 'none'; shell.style.display = 'grid';
        T.toast('Welcome to TERRA Admin', 'success');
        start();
      } else {
        T.toast('Incorrect password', 'error');
        document.getElementById('gate-pass').value = '';
      }
    });
  }

  function start() {
    wireNav();
    wireForm();
    wireSettings();
    loadAll();
  }

  /* ------------------------------------------------------------------ Nav */
  const TITLES = { overview: 'Overview', listings: 'Listings', add: 'Add Listing', inquiries: 'Inquiries', settings: 'Settings' };
  function wireNav() {
    document.getElementById('dash-nav').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tab]'); if (!b) return;
      switchTab(b.dataset.tab);
    });
    document.getElementById('logout-btn').addEventListener('click', () => {
      sessionStorage.removeItem(AUTH_KEY);
      location.reload();
    });
  }
  function switchTab(tab) {
    document.querySelectorAll('.dash-nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    document.getElementById('page-title').textContent = TITLES[tab];
    if (tab === 'add' && !editingId) resetForm();
    if (tab === 'add') setTimeout(initPinMap, 60);
  }

  /* --------------------------------------------------------------- Load */
  async function loadAll() {
    try {
      [listings, inquiries] = await Promise.all([T.api.listings({}), T.api.inquiries()]);
    } catch (e) { T.toast('Failed to load data', 'error'); listings = []; inquiries = []; }
    renderOverview();
    renderListingsTable();
    renderInquiries();
    updateInqBadge();
    loadSettingsForm();
  }

  /* ----------------------------------------------------------- Overview */
  function renderOverview() {
    const total = listings.length;
    const active = listings.filter((l) => l.status === 'Available').length;
    const reserved = listings.filter((l) => l.status === 'Reserved').length;
    const sold = listings.filter((l) => l.status === 'Sold');
    const revenue = sold.reduce((s, l) => s + l.price_jod, 0);

    const kpis = [
      { ico: '▦', num: total, lbl: 'Total Listings', cls: '' },
      { ico: '✓', num: active, lbl: 'Available', cls: 'wadi' },
      { ico: '⏳', num: reserved, lbl: 'Reserved', cls: '' },
      { ico: '●', num: sold.length, lbl: 'Sold', cls: '' },
      { ico: '✉', num: inquiries.length, lbl: 'Inquiries', cls: '' },
      { ico: '＄', num: T.formatPrice(revenue).formatted + ' ' + T.formatPrice(revenue).unit, lbl: 'Revenue (sold)', cls: 'gold', raw: true },
    ];
    document.getElementById('kpi-grid').innerHTML = kpis.map((k) => `
      <div class="kpi ${k.cls}">
        <div class="k-ico">${k.ico}</div>
        <div class="k-num">${k.raw ? k.num : Number(k.num).toLocaleString('en-US')}</div>
        <div class="k-lbl">${k.lbl}</div>
      </div>`).join('');

    renderCharts();
    renderActivity();
  }

  function renderCharts() {
    if (typeof Chart === 'undefined') return;
    const types = ['Agricultural', 'Residential', 'Commercial', 'Mixed'];
    const counts = types.map((t) => listings.filter((l) => l.land_type === t).length);
    const palette = ['#6FA86A', '#8B5E3C', '#D4A017', '#2C4A3E'];

    if (charts.type) charts.type.destroy();
    charts.type = new Chart(document.getElementById('chart-type'), {
      type: 'bar',
      data: { labels: types, datasets: [{ label: 'Listings', data: counts, backgroundColor: palette, borderRadius: 8 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }, responsive: true, maintainAspectRatio: false },
    });

    // Inquiries over last 30 days
    const days = [], vals = [];
    const map = {};
    inquiries.forEach((i) => { const d = (i.created_at || '').slice(0, 10); map[d] = (map[d] || 0) + 1; });
    for (let n = 29; n >= 0; n--) {
      const d = new Date(); d.setDate(d.getDate() - n);
      const key = d.toISOString().slice(0, 10);
      days.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
      vals.push(map[key] || 0);
    }
    if (charts.inq) charts.inq.destroy();
    charts.inq = new Chart(document.getElementById('chart-inq'), {
      type: 'line',
      data: { labels: days, datasets: [{ label: 'Inquiries', data: vals, borderColor: '#D4A017', backgroundColor: 'rgba(212,160,23,.15)', fill: true, tension: .35, pointRadius: 2 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { ticks: { maxTicksLimit: 8 } } }, responsive: true, maintainAspectRatio: false },
    });
  }

  function renderActivity() {
    const items = [];
    listings.slice(0, 4).forEach((l) => items.push({ ico: '▦', text: `Listing “${T.escapeHTML(l.title)}” · ${l.status}`, time: l.updated_at || l.created_at }));
    inquiries.slice(0, 4).forEach((i) => items.push({ ico: '✉', text: `Inquiry from ${T.escapeHTML(i.name)}`, time: i.created_at }));
    items.sort((a, b) => (b.time > a.time ? 1 : -1));
    const feed = document.getElementById('activity-feed');
    feed.innerHTML = items.slice(0, 8).map((i) => `
      <li><span class="a-ico">${i.ico}</span><span>${i.text}</span><span class="a-time">${timeAgo(i.time)}</span></li>`).join('')
      || '<li class="muted">No activity yet.</li>';
  }
  function timeAgo(ts) {
    if (!ts) return '';
    const d = new Date(ts.replace(' ', 'T') + (ts.includes('Z') ? '' : 'Z'));
    const s = (Date.now() - d.getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  /* -------------------------------------------------- Listings table */
  function renderListingsTable() {
    const tbody = document.getElementById('lst-tbody');
    const search = (document.getElementById('lst-search').value || '').toLowerCase();
    const fstatus = document.getElementById('lst-filter-status').value;

    let rows = listings.filter((l) => {
      if (fstatus !== 'all' && l.status !== fstatus) return false;
      if (search && !(`${l.title} ${l.location} ${l.parcel_number}`.toLowerCase().includes(search))) return false;
      return true;
    });
    const dir = lstSort.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const av = a[lstSort.key], bv = b[lstSort.key];
      if (typeof av === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });

    tbody.innerHTML = rows.map((l) => {
      const img = T.imgURL(l.featured_image);
      const thumb = img ? `<img class="thumb" src="${img}" alt="">` : `<div class="thumb" style="background:var(--sand);display:grid;place-items:center;font-size:.7rem">▲</div>`;
      return `
      <tr data-id="${l.id}">
        <td><input type="checkbox" class="row-check" data-id="${l.id}" ${selected.has(l.id) ? 'checked' : ''}></td>
        <td style="display:flex;align-items:center;gap:.6rem">${thumb}<a href="/listing/${l.id}" target="_blank">${T.escapeHTML(l.title)}</a></td>
        <td>${T.escapeHTML(l.parcel_number || '—')}</td>
        <td>${T.escapeHTML(l.land_type)}</td>
        <td>${Number(l.area_m2).toLocaleString('en-US')}</td>
        <td>${T.formatPrice(l.price_jod).formatted} ${T.formatPrice(l.price_jod).unit}</td>
        <td><span class="badge status-${l.status} status-pill" data-cycle="${l.id}">${l.status}</span></td>
        <td class="row-actions">
          <button class="mini-btn" data-edit="${l.id}">Edit</button>
          <button class="mini-btn danger" data-del="${l.id}">Delete</button>
        </td>
      </tr>`;
    }).join('') || '<tr><td colspan="8" style="text-align:center;padding:2rem" class="muted">No listings found.</td></tr>';
  }

  function wireListingsTable() {
    document.getElementById('lst-search').addEventListener('input', T.debounce(renderListingsTable, 200));
    document.getElementById('lst-filter-status').addEventListener('change', renderListingsTable);

    document.querySelectorAll('#lst-table th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (lstSort.key === key) lstSort.dir = lstSort.dir === 'asc' ? 'desc' : 'asc';
        else { lstSort.key = key; lstSort.dir = 'asc'; }
        renderListingsTable();
      });
    });

    document.getElementById('lst-tbody').addEventListener('click', async (e) => {
      const edit = e.target.closest('[data-edit]');
      const del = e.target.closest('[data-del]');
      const cycle = e.target.closest('[data-cycle]');
      if (edit) return startEdit(Number(edit.dataset.edit));
      if (del) return doDelete(Number(del.dataset.del));
      if (cycle) return cycleStatus(Number(cycle.dataset.cycle));
    });
    document.getElementById('lst-tbody').addEventListener('change', (e) => {
      const chk = e.target.closest('.row-check');
      if (chk) { const id = Number(chk.dataset.id); chk.checked ? selected.add(id) : selected.delete(id); }
    });
    document.getElementById('check-all').addEventListener('change', (e) => {
      document.querySelectorAll('.row-check').forEach((c) => { c.checked = e.target.checked; const id = Number(c.dataset.id); e.target.checked ? selected.add(id) : selected.delete(id); });
    });
    document.getElementById('bulk-sold').addEventListener('click', bulkSold);
    document.getElementById('bulk-delete').addEventListener('click', bulkDelete);
  }

  async function cycleStatus(id) {
    const l = listings.find((x) => x.id === id); if (!l) return;
    const order = ['Available', 'Reserved', 'Sold'];
    const next = order[(order.indexOf(l.status) + 1) % order.length];
    try {
      const updated = await T.api.updateListingJSON(id, { status: next });
      Object.assign(l, updated);
      renderListingsTable(); renderOverview();
      T.toast(`Status → ${next}`, 'info');
    } catch { T.toast('Update failed', 'error'); }
  }

  async function doDelete(id) {
    const l = listings.find((x) => x.id === id);
    if (!confirm(`Delete “${l ? l.title : 'this listing'}”? This cannot be undone.`)) return;
    try {
      await T.api.deleteListing(id);
      listings = listings.filter((x) => x.id !== id);
      selected.delete(id);
      renderListingsTable(); renderOverview();
      T.toast('Listing deleted', 'success');
    } catch { T.toast('Delete failed', 'error'); }
  }

  async function bulkSold() {
    if (!selected.size) return T.toast('Select rows first', 'info');
    for (const id of selected) {
      try { const u = await T.api.updateListingJSON(id, { status: 'Sold' }); const l = listings.find((x) => x.id === id); if (l) Object.assign(l, u); } catch { /* skip */ }
    }
    selected.clear();
    renderListingsTable(); renderOverview();
    T.toast('Marked selected as Sold', 'success');
  }
  async function bulkDelete() {
    if (!selected.size) return T.toast('Select rows first', 'info');
    if (!confirm(`Delete ${selected.size} selected listing(s)?`)) return;
    for (const id of selected) { try { await T.api.deleteListing(id); } catch { /* skip */ } }
    listings = listings.filter((x) => !selected.has(x.id));
    selected.clear();
    renderListingsTable(); renderOverview();
    T.toast('Selected listings deleted', 'success');
  }

  /* -------------------------------------------------- Add / Edit form */
  function wireForm() {
    wireListingsTable();

    // Rich text
    document.querySelectorAll('.rich-toolbar button').forEach((b) => {
      b.addEventListener('click', () => { document.execCommand(b.dataset.cmd, false, null); document.getElementById('f-desc').focus(); });
    });

    // Dropzone
    const dz = document.getElementById('dropzone');
    const input = document.getElementById('f-images');
    dz.addEventListener('click', () => input.click());
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault(); dz.classList.remove('drag');
      addFiles(e.dataTransfer.files);
    });
    input.addEventListener('change', (e) => addFiles(e.target.files));

    document.getElementById('listing-form').addEventListener('submit', submitForm);
    document.getElementById('cancel-edit').addEventListener('click', () => { resetForm(); switchTab('listings'); });
  }

  function addFiles(fileList) {
    Array.from(fileList).forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      const url = URL.createObjectURL(file);
      const name = 'new::' + url; // pseudo-id for new files
      uploads.push({ file, url, name });
      if (!featured) featured = name;
    });
    renderPreview();
  }

  function renderPreview() {
    const wrap = document.getElementById('preview');
    const items = [];
    existingImages.forEach((fn) => items.push({ src: T.imgURL(fn), key: fn, existing: true }));
    uploads.forEach((u) => items.push({ src: u.url, key: u.name, existing: false }));
    wrap.innerHTML = items.map((it) => `
      <div class="thumb-wrap ${featured === it.key ? 'featured' : ''}">
        <img src="${it.src}" alt="">
        <button type="button" class="rm" data-rm="${encodeURIComponent(it.key)}" title="Remove">✕</button>
        <span class="feat" data-feat="${encodeURIComponent(it.key)}">★ ${featured === it.key ? 'Featured' : 'Set'}</span>
      </div>`).join('');
    wrap.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => removeImage(decodeURIComponent(b.dataset.rm))));
    wrap.querySelectorAll('[data-feat]').forEach((b) => b.addEventListener('click', () => { featured = decodeURIComponent(b.dataset.feat); renderPreview(); }));
  }

  function removeImage(key) {
    existingImages = existingImages.filter((k) => k !== key);
    uploads = uploads.filter((u) => u.name !== key);
    if (featured === key) featured = existingImages[0] || (uploads[0] && uploads[0].name) || null;
    renderPreview();
  }

  function resetForm() {
    editingId = null;
    document.getElementById('form-heading').textContent = 'Add New Listing';
    document.getElementById('listing-form').reset();
    document.getElementById('f-id').value = '';
    document.getElementById('f-desc').innerHTML = '';
    document.getElementById('cancel-edit').style.display = 'none';
    uploads = []; existingImages = []; featured = null; pin = { x: null, z: null };
    document.getElementById('pin-coords').textContent = 'not set';
    renderPreview();
    if (pinMap) pinMap.clearPin && pinMap.clearPin();
  }

  function startEdit(id) {
    const l = listings.find((x) => x.id === id); if (!l) return;
    switchTab('add');
    editingId = id;
    document.getElementById('form-heading').textContent = 'Edit Listing';
    document.getElementById('cancel-edit').style.display = '';
    document.getElementById('f-id').value = id;
    document.getElementById('f-title').value = l.title || '';
    document.getElementById('f-parcel').value = l.parcel_number || '';
    document.getElementById('f-type').value = l.land_type || 'Residential';
    document.getElementById('f-area').value = l.area_m2 || '';
    document.getElementById('f-price').value = l.price_jod || '';
    document.getElementById('f-location').value = l.location || '';
    document.getElementById('f-status').value = l.status || 'Available';
    document.getElementById('f-lat').value = l.lat != null ? l.lat : '';
    document.getElementById('f-lng').value = l.lng != null ? l.lng : '';
    document.getElementById('f-desc').innerHTML = l.description || '';
    existingImages = (l.images || []).slice();
    uploads = [];
    featured = l.featured_image || existingImages[0] || null;
    pin = { x: l.map_x, z: l.map_z };
    document.getElementById('pin-coords').textContent = (l.map_x != null && l.map_z != null) ? `x ${l.map_x}, z ${l.map_z}` : 'not set';
    renderPreview();
    setTimeout(() => { initPinMap(); if (pinMap && l.map_x != null) pinMap.setPin(l.map_x, l.map_z); }, 80);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function validateForm() {
    let ok = true;
    [['f-title', true], ['f-area', true], ['f-price', true]].forEach(([id]) => {
      const el = document.getElementById(id);
      const wrap = el.closest('.form-field');
      if (!el.value.trim()) { wrap.classList.add('invalid'); ok = false; } else wrap.classList.remove('invalid');
    });
    return ok;
  }

  async function submitForm(e) {
    e.preventDefault();
    if (!validateForm()) { T.toast('Please complete the required fields', 'error'); return; }
    const btn = document.getElementById('save-btn');
    btn.disabled = true; btn.textContent = 'Saving…';

    const fd = new FormData();
    fd.append('title', document.getElementById('f-title').value.trim());
    fd.append('parcel_number', document.getElementById('f-parcel').value.trim());
    fd.append('land_type', document.getElementById('f-type').value);
    fd.append('area_m2', document.getElementById('f-area').value);
    fd.append('price_jod', document.getElementById('f-price').value);
    fd.append('location', document.getElementById('f-location').value.trim());
    fd.append('status', document.getElementById('f-status').value);
    fd.append('lat', document.getElementById('f-lat').value);
    fd.append('lng', document.getElementById('f-lng').value);
    fd.append('description', document.getElementById('f-desc').innerHTML);
    if (pin.x != null) { fd.append('map_x', pin.x); fd.append('map_z', pin.z); }
    fd.append('existingImages', JSON.stringify(existingImages));

    // Append new files
    uploads.forEach((u) => fd.append('images', u.file, u.file.name));

    // Featured: if it points to an existing filename, send it; new-file featured
    // is resolved server-side to first image, so we only send known filenames.
    if (featured && !featured.startsWith('new::')) fd.append('featured_image', featured);

    try {
      let saved;
      if (editingId) saved = await T.api.updateListing(editingId, fd);
      else saved = await T.api.createListing(fd);

      // If featured was a new upload, set it now that filenames exist.
      if (featured && featured.startsWith('new::')) {
        const idx = uploads.findIndex((u) => u.name === featured);
        if (idx >= 0 && saved.images && saved.images.length) {
          const startIdx = saved.images.length - uploads.length;
          const fn = saved.images[startIdx + idx];
          if (fn) { saved = await T.api.updateListingJSON(saved.id, { featured_image: fn }); }
        }
      }

      T.toast(editingId ? 'Listing updated' : 'Listing created', 'success');
      resetForm();
      await loadAll();
      switchTab('listings');
    } catch (err) {
      T.toast(err.message || 'Save failed', 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Save Listing';
    }
  }

  /* ------------------------------------------------ 3D pin-map picker */
  function initPinMap() {
    const el = document.getElementById('pin-map');
    if (!el || el.dataset.ready) return;
    if (!window.TerraSceneFactory || !window.TerraScene.hasThree()) {
      el.innerHTML = '<div style="display:grid;place-items:center;height:100%;color:#F0E6D2">3D picker unavailable</div>';
      el.dataset.ready = '1'; return;
    }
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%'; canvas.style.height = '100%';
    el.appendChild(canvas);
    const scene = window.TerraSceneFactory();
    const plots = listings.map((l) => ({ id: l.id, status: l.status, map_x: l.map_x, map_z: l.map_z }));
    scene.init(canvas, { plots, mini: true, autoRotate: false, controls: true, startCam: { x: 0, y: 60, z: 0.1 } });
    el.dataset.ready = '1';

    // Raycast a click onto the ground plane to derive x/z pin coordinates.
    const THREE = window.THREE;
    canvas.addEventListener('click', (ev) => {
      const cam = scene.getCamera(); if (!cam) return;
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, cam);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const hit = new THREE.Vector3();
      if (ray.ray.intersectPlane(plane, hit)) {
        pin.x = Math.round(hit.x); pin.z = Math.round(hit.z);
        document.getElementById('pin-coords').textContent = `x ${pin.x}, z ${pin.z}`;
        scene.setMarker(pin.x, pin.z);
      }
    });

    // Pin helpers used by resetForm / startEdit
    scene.setPin = (x, z) => {
      pin.x = x; pin.z = z;
      document.getElementById('pin-coords').textContent = `x ${x}, z ${z}`;
      if (x != null && z != null) scene.setMarker(x, z);
    };
    scene.clearPin = () => { pin = { x: null, z: null }; document.getElementById('pin-coords').textContent = 'not set'; scene.clearMarker(); };

    pinMap = scene;
  }

  /* --------------------------------------------------------- Inquiries */
  function renderInquiries() {
    const tbody = document.getElementById('inq-tbody');
    tbody.innerHTML = inquiries.map((i) => `
      <tr class="read-${i.read ? 'true' : 'false'}" data-id="${i.id}">
        <td><span class="badge ${i.read ? 'status-Sold' : 'status-Available'}">${i.read ? 'Read' : 'New'}</span></td>
        <td>${T.escapeHTML(i.name)}</td>
        <td><div>${T.escapeHTML(i.email)}</div><div class="muted">${T.escapeHTML(i.phone || '')}</div></td>
        <td>${T.escapeHTML(i.listing_title || '—')}</td>
        <td class="inq-message">${T.escapeHTML(i.message)}</td>
        <td>${new Date((i.created_at || '').replace(' ', 'T') + 'Z').toLocaleDateString()}</td>
        <td class="row-actions">
          <button class="mini-btn" data-read="${i.id}">${i.read ? 'Mark Unread' : 'Mark Read'}</button>
          <button class="mini-btn danger" data-delinq="${i.id}">Delete</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;padding:2rem" class="muted">No inquiries yet.</td></tr>';

    tbody.querySelectorAll('[data-read]').forEach((b) => b.addEventListener('click', () => toggleRead(Number(b.dataset.read))));
    tbody.querySelectorAll('[data-delinq]').forEach((b) => b.addEventListener('click', () => delInquiry(Number(b.dataset.delinq))));
  }
  async function toggleRead(id) {
    const i = inquiries.find((x) => x.id === id); if (!i) return;
    try { const u = await T.api.patchInquiry(id, { read: i.read ? 0 : 1 }); Object.assign(i, u); renderInquiries(); updateInqBadge(); }
    catch { T.toast('Update failed', 'error'); }
  }
  async function delInquiry(id) {
    if (!confirm('Delete this inquiry?')) return;
    try { await T.api.deleteInquiry(id); inquiries = inquiries.filter((x) => x.id !== id); renderInquiries(); updateInqBadge(); renderOverview(); T.toast('Inquiry deleted', 'success'); }
    catch { T.toast('Delete failed', 'error'); }
  }
  function updateInqBadge() {
    const unread = inquiries.filter((i) => !i.read).length;
    const badge = document.getElementById('inq-count');
    const dot = document.getElementById('bell-dot');
    if (unread) { badge.textContent = unread; badge.style.display = ''; dot.style.display = ''; }
    else { badge.textContent = ''; badge.style.display = 'none'; dot.style.display = 'none'; }
  }

  /* ---------------------------------------------------------- Settings */
  async function loadSettingsForm() {
    const s = await T.api.settings();
    document.getElementById('s-title').value = s.siteTitle || '';
    document.getElementById('s-tagline').value = s.tagline || '';
    document.getElementById('s-email').value = s.contactEmail || '';
    document.getElementById('s-wa').value = s.whatsapp || '';
    document.getElementById('s-hero').value = s.heroHeading || '';
    document.getElementById('s-herosub').value = s.heroSubheading || '';
    document.getElementById('s-cta').value = s.ctaLabel || '';
  }
  function wireSettings() {
    document.getElementById('settings-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await T.api.saveSettings({
          siteTitle: document.getElementById('s-title').value,
          tagline: document.getElementById('s-tagline').value,
          contactEmail: document.getElementById('s-email').value,
          whatsapp: document.getElementById('s-wa').value,
          heroHeading: document.getElementById('s-hero').value,
          heroSubheading: document.getElementById('s-herosub').value,
          ctaLabel: document.getElementById('s-cta').value,
        });
        T.toast('Settings saved', 'success');
      } catch { T.toast('Could not save settings', 'error'); }
    });
  }

  // Re-render money-bearing views when currency toggles
  document.addEventListener('currencychange', () => { renderOverview(); renderListingsTable(); });

  document.addEventListener('DOMContentLoaded', initGate);
})();
