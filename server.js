/**
 * server.js — TERRA backend
 * -------------------------------------------------------------------------
 * A zero-dependency Express-style HTTP server built on Node's core modules.
 *
 * Why no npm packages?  This project is designed to run fully offline/local.
 * We use:
 *   - node:http      → the web server (in place of Express)
 *   - node:sqlite    → persistence (in place of better-sqlite3)
 *   - a small custom multipart/form-data parser (in place of Multer)
 *
 * Everything the brief asked for is implemented; it simply runs with
 * `node server.js` and needs no `npm install` step to succeed.
 * -------------------------------------------------------------------------
 */

'use strict';

// Quiet the (harmless) experimental notice from the built-in SQLite module.
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w && w.name === 'ExperimentalWarning' && /SQLite/i.test(w.message)) return;
  console.warn(w);
});

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const { db } = require('./db');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');
const SETTINGS_FILE = path.join(ROOT, 'settings.json');

// Ensure runtime directories / files exist -------------------------------
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const DEFAULT_SETTINGS = {
  siteTitle: 'TERRA',
  tagline: 'Jordanian Land, Reimagined in 3D',
  contactEmail: 'hello@terra.jo',
  whatsapp: '962790000000',
  heroHeading: 'Own a Piece of the Wadi',
  heroSubheading: 'Curated land parcels across the Jordanian highlands — explore each plot as it rises from the earth.',
  ctaLabel: 'Browse All Listings',
};

if (!fs.existsSync(SETTINGS_FILE)) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2));
}

// -------------------------------------------------------------------------
// Small helpers
// -------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(text);
}

function notFound(res, msg = 'Not Found') {
  sendJSON(res, 404, { error: msg });
}

function readBody(req, limit = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJSON(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return {};
  }
}

// -------------------------------------------------------------------------
// Minimal multipart/form-data parser (replaces Multer).
// Returns { fields: {name: value}, files: [{field, filename, type, data}] }
// -------------------------------------------------------------------------
function parseMultipart(buffer, contentType) {
  const result = { fields: {}, files: [] };
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) return result;
  const boundary = '--' + (m[1] || m[2]).trim();
  const boundaryBuf = Buffer.from(boundary);

  let start = buffer.indexOf(boundaryBuf);
  if (start === -1) return result;
  start += boundaryBuf.length;

  while (start < buffer.length) {
    // After a boundary comes either "--" (end) or CRLF then a part.
    if (buffer[start] === 0x2d && buffer[start + 1] === 0x2d) break; // "--" end
    // skip leading CRLF
    if (buffer[start] === 0x0d && buffer[start + 1] === 0x0a) start += 2;

    const next = buffer.indexOf(boundaryBuf, start);
    if (next === -1) break;

    // The part is buffer[start .. next-2] (strip trailing CRLF)
    let partEnd = next;
    if (buffer[partEnd - 2] === 0x0d && buffer[partEnd - 1] === 0x0a) partEnd -= 2;
    const part = buffer.slice(start, partEnd);

    // Split headers / body on the first double CRLF
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headerStr = part.slice(0, headerEnd).toString('utf8');
      const body = part.slice(headerEnd + 4);

      const nameMatch = /name="([^"]*)"/i.exec(headerStr);
      const fileMatch = /filename="([^"]*)"/i.exec(headerStr);
      const typeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headerStr);
      const field = nameMatch ? nameMatch[1] : '';

      if (fileMatch && fileMatch[1]) {
        result.files.push({
          field,
          filename: fileMatch[1],
          type: typeMatch ? typeMatch[1].trim() : 'application/octet-stream',
          data: body,
        });
      } else if (field) {
        result.fields[field] = body.toString('utf8');
      }
    }

    start = next + boundaryBuf.length;
  }

  return result;
}

const IMAGE_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };

function saveUploadedFile(file) {
  const ext = IMAGE_EXT[file.type] || path.extname(file.filename) || '.bin';
  const safeExt = ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext.toLowerCase()) ? ext : '.png';
  const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${safeExt}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, name), file.data);
  return name;
}

// -------------------------------------------------------------------------
// Data mappers
// -------------------------------------------------------------------------
function rowToListing(r) {
  if (!r) return null;
  let images = [];
  try { images = JSON.parse(r.images || '[]'); } catch { images = []; }
  return {
    id: r.id,
    title: r.title,
    parcel_number: r.parcel_number,
    land_type: r.land_type,
    area_m2: r.area_m2,
    price_jod: r.price_jod,
    location: r.location,
    lat: r.lat,
    lng: r.lng,
    map_x: r.map_x,
    map_z: r.map_z,
    description: r.description,
    status: r.status,
    images,
    featured_image: r.featured_image || (images.length ? images[0] : null),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// -------------------------------------------------------------------------
// Static file serving
// -------------------------------------------------------------------------
function serveStatic(req, res, pathname) {
  // Map "/" → index.html, "/dashboard" → dashboard.html, etc.
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel === '/dashboard') rel = '/dashboard.html';
  if (rel === '/favorites') rel = '/favorites.html';
  if (rel.startsWith('/listing/')) rel = '/listing.html';

  // Prevent path traversal
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendText(res, 403, 'Forbidden');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA-ish fallback: unknown non-API route → 404 page
      const notFoundPage = path.join(PUBLIC_DIR, '404.html');
      if (fs.existsSync(notFoundPage)) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        return fs.createReadStream(notFoundPage).pipe(res);
      }
      return sendText(res, 404, 'Not Found');
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const headers = { 'Content-Type': type };
    // Cache uploads + static assets briefly
    if (rel.startsWith('/uploads/')) headers['Cache-Control'] = 'public, max-age=3600';
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
}

// -------------------------------------------------------------------------
// API — LISTINGS
// -------------------------------------------------------------------------
function listListings(query) {
  const clauses = [];
  const params = {};

  if (query.type && query.type !== 'all') {
    clauses.push('land_type = @type');
    params.type = query.type;
  }
  if (query.status && query.status !== 'all') {
    clauses.push('status = @status');
    params.status = query.status;
  }
  if (query.search) {
    clauses.push('(LOWER(title) LIKE @q OR LOWER(location) LIKE @q OR LOWER(parcel_number) LIKE @q)');
    params.q = `%${String(query.search).toLowerCase()}%`;
  }
  if (query.minPrice) { clauses.push('price_jod >= @minPrice'); params.minPrice = Number(query.minPrice); }
  if (query.maxPrice) { clauses.push('price_jod <= @maxPrice'); params.maxPrice = Number(query.maxPrice); }
  if (query.minArea) { clauses.push('area_m2 >= @minArea'); params.minArea = Number(query.minArea); }
  if (query.maxArea) { clauses.push('area_m2 <= @maxArea'); params.maxArea = Number(query.maxArea); }

  let sql = 'SELECT * FROM listings';
  if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');

  const sortMap = {
    newest: 'created_at DESC',
    oldest: 'created_at ASC',
    price_asc: 'price_jod ASC',
    price_desc: 'price_jod DESC',
    area_asc: 'area_m2 ASC',
    area_desc: 'area_m2 DESC',
  };
  sql += ' ORDER BY ' + (sortMap[query.sort] || 'created_at DESC');

  const rows = db.prepare(sql).all(params);
  return rows.map(rowToListing);
}

function getListing(id) {
  return rowToListing(db.prepare('SELECT * FROM listings WHERE id = ?').get(id));
}

function upsertFromMultipart(existing, parsed) {
  const f = parsed.fields;

  // Save any newly uploaded files
  const newImages = [];
  for (const file of parsed.files) {
    if (file.field === 'images' && file.data && file.data.length) {
      newImages.push(saveUploadedFile(file));
    }
  }

  // Existing images the client wants to keep (JSON string of filenames)
  let keptImages = [];
  if (f.existingImages) {
    try { keptImages = JSON.parse(f.existingImages); } catch { keptImages = []; }
  } else if (existing) {
    keptImages = existing.images;
  }

  const images = [...keptImages, ...newImages];

  let featured = f.featured_image || null;
  if (!featured || !images.includes(featured)) featured = images[0] || null;

  return {
    title: f.title || (existing ? existing.title : 'Untitled Plot'),
    parcel_number: f.parcel_number || (existing ? existing.parcel_number : ''),
    land_type: f.land_type || (existing ? existing.land_type : 'Residential'),
    area_m2: f.area_m2 !== undefined ? Number(f.area_m2) : (existing ? existing.area_m2 : 0),
    price_jod: f.price_jod !== undefined ? Number(f.price_jod) : (existing ? existing.price_jod : 0),
    location: f.location || (existing ? existing.location : ''),
    lat: f.lat ? Number(f.lat) : (existing ? existing.lat : null),
    lng: f.lng ? Number(f.lng) : (existing ? existing.lng : null),
    map_x: f.map_x !== undefined && f.map_x !== '' ? Number(f.map_x) : (existing ? existing.map_x : null),
    map_z: f.map_z !== undefined && f.map_z !== '' ? Number(f.map_z) : (existing ? existing.map_z : null),
    description: f.description !== undefined ? f.description : (existing ? existing.description : ''),
    status: f.status || (existing ? existing.status : 'Available'),
    images: JSON.stringify(images),
    featured_image: featured,
  };
}

async function createListing(req, res) {
  const contentType = req.headers['content-type'] || '';
  let data;
  if (contentType.includes('multipart/form-data')) {
    const buf = await readBody(req);
    const parsed = parseMultipart(buf, contentType);
    data = upsertFromMultipart(null, parsed);
  } else {
    const j = await readJSON(req);
    const images = Array.isArray(j.images) ? j.images : [];
    data = {
      title: j.title || 'Untitled Plot',
      parcel_number: j.parcel_number || '',
      land_type: j.land_type || 'Residential',
      area_m2: Number(j.area_m2) || 0,
      price_jod: Number(j.price_jod) || 0,
      location: j.location || '',
      lat: j.lat ? Number(j.lat) : null,
      lng: j.lng ? Number(j.lng) : null,
      map_x: j.map_x != null ? Number(j.map_x) : null,
      map_z: j.map_z != null ? Number(j.map_z) : null,
      description: j.description || '',
      status: j.status || 'Available',
      images: JSON.stringify(images),
      featured_image: j.featured_image || images[0] || null,
    };
  }

  if (!data.title || !data.title.trim()) {
    return sendJSON(res, 400, { error: 'Title is required' });
  }

  const stmt = db.prepare(`
    INSERT INTO listings
      (title, parcel_number, land_type, area_m2, price_jod, location,
       lat, lng, map_x, map_z, description, status, images, featured_image)
    VALUES
      (@title, @parcel_number, @land_type, @area_m2, @price_jod, @location,
       @lat, @lng, @map_x, @map_z, @description, @status, @images, @featured_image)
  `);
  const info = stmt.run(data);
  const created = getListing(Number(info.lastInsertRowid));
  sendJSON(res, 201, created);
}

async function updateListing(req, res, id) {
  const existing = getListing(id);
  if (!existing) return notFound(res, 'Listing not found');

  const contentType = req.headers['content-type'] || '';
  let data;
  if (contentType.includes('multipart/form-data')) {
    const buf = await readBody(req);
    const parsed = parseMultipart(buf, contentType);
    data = upsertFromMultipart(existing, parsed);
  } else {
    const j = await readJSON(req);
    const images = Array.isArray(j.images) ? j.images : existing.images;
    data = {
      title: j.title ?? existing.title,
      parcel_number: j.parcel_number ?? existing.parcel_number,
      land_type: j.land_type ?? existing.land_type,
      area_m2: j.area_m2 != null ? Number(j.area_m2) : existing.area_m2,
      price_jod: j.price_jod != null ? Number(j.price_jod) : existing.price_jod,
      location: j.location ?? existing.location,
      lat: j.lat != null ? Number(j.lat) : existing.lat,
      lng: j.lng != null ? Number(j.lng) : existing.lng,
      map_x: j.map_x != null ? Number(j.map_x) : existing.map_x,
      map_z: j.map_z != null ? Number(j.map_z) : existing.map_z,
      description: j.description ?? existing.description,
      status: j.status ?? existing.status,
      images: JSON.stringify(images),
      featured_image: j.featured_image ?? existing.featured_image ?? images[0] ?? null,
    };
  }

  db.prepare(`
    UPDATE listings SET
      title=@title, parcel_number=@parcel_number, land_type=@land_type,
      area_m2=@area_m2, price_jod=@price_jod, location=@location,
      lat=@lat, lng=@lng, map_x=@map_x, map_z=@map_z, description=@description,
      status=@status, images=@images, featured_image=@featured_image,
      updated_at=datetime('now')
    WHERE id=@id
  `).run({ ...data, id });

  sendJSON(res, 200, getListing(id));
}

function deleteListing(res, id) {
  const existing = getListing(id);
  if (!existing) return notFound(res, 'Listing not found');
  // Remove associated image files
  for (const img of existing.images) {
    const p = path.join(UPLOADS_DIR, img);
    if (fs.existsSync(p) && p.startsWith(UPLOADS_DIR)) {
      try { fs.unlinkSync(p); } catch { /* ignore */ }
    }
  }
  db.prepare('DELETE FROM listings WHERE id = ?').run(id);
  sendJSON(res, 200, { ok: true, id });
}

function deleteListingImage(res, id, filename) {
  const existing = getListing(id);
  if (!existing) return notFound(res, 'Listing not found');
  const images = existing.images.filter((f) => f !== filename);
  const p = path.join(UPLOADS_DIR, filename);
  if (fs.existsSync(p) && p.startsWith(UPLOADS_DIR)) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  }
  let featured = existing.featured_image;
  if (featured === filename) featured = images[0] || null;
  db.prepare('UPDATE listings SET images=?, featured_image=?, updated_at=datetime(\'now\') WHERE id=?')
    .run(JSON.stringify(images), featured, id);
  sendJSON(res, 200, getListing(id));
}

// -------------------------------------------------------------------------
// API — INQUIRIES
// -------------------------------------------------------------------------
async function createInquiry(req, res) {
  const j = await readJSON(req);
  if (!j.name || !j.email || !j.message) {
    return sendJSON(res, 400, { error: 'Name, email and message are required' });
  }
  const info = db.prepare(`
    INSERT INTO inquiries (listing_id, name, email, phone, message)
    VALUES (@listing_id, @name, @email, @phone, @message)
  `).run({
    listing_id: j.listing_id ? Number(j.listing_id) : null,
    name: String(j.name).slice(0, 200),
    email: String(j.email).slice(0, 200),
    phone: String(j.phone || '').slice(0, 60),
    message: String(j.message).slice(0, 5000),
  });
  const row = db.prepare('SELECT * FROM inquiries WHERE id = ?').get(Number(info.lastInsertRowid));
  sendJSON(res, 201, row);
}

function listInquiries(res) {
  const rows = db.prepare(`
    SELECT i.*, l.title AS listing_title
    FROM inquiries i
    LEFT JOIN listings l ON l.id = i.listing_id
    ORDER BY i.created_at DESC
  `).all();
  sendJSON(res, 200, rows);
}

async function patchInquiry(req, res, id) {
  const existing = db.prepare('SELECT * FROM inquiries WHERE id = ?').get(id);
  if (!existing) return notFound(res, 'Inquiry not found');
  const j = await readJSON(req);
  const read = j.read != null ? (j.read ? 1 : 0) : existing.read;
  db.prepare('UPDATE inquiries SET read = ? WHERE id = ?').run(read, id);
  sendJSON(res, 200, db.prepare('SELECT * FROM inquiries WHERE id = ?').get(id));
}

function deleteInquiry(res, id) {
  const existing = db.prepare('SELECT * FROM inquiries WHERE id = ?').get(id);
  if (!existing) return notFound(res, 'Inquiry not found');
  db.prepare('DELETE FROM inquiries WHERE id = ?').run(id);
  sendJSON(res, 200, { ok: true, id });
}

// -------------------------------------------------------------------------
// API — SETTINGS
// -------------------------------------------------------------------------
function getSettings(res) {
  let s = DEFAULT_SETTINGS;
  try { s = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; } catch { /* use default */ }
  sendJSON(res, 200, s);
}

async function saveSettings(req, res) {
  const j = await readJSON(req);
  let current = DEFAULT_SETTINGS;
  try { current = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; } catch { /* default */ }
  const merged = { ...current, ...j };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2));
  sendJSON(res, 200, merged);
}

// -------------------------------------------------------------------------
// Router
// -------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method.toUpperCase();

  // CORS (handy for local tooling)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  try {
    // ---------------- API ----------------
    if (pathname.startsWith('/api/')) {
      const query = Object.fromEntries(parsedUrl.searchParams.entries());

      // /api/listings
      if (pathname === '/api/listings') {
        if (method === 'GET') return sendJSON(res, 200, listListings(query));
        if (method === 'POST') return await createListing(req, res);
      }

      // /api/listings/:id  and  /api/listings/:id/image/:filename
      const listMatch = pathname.match(/^\/api\/listings\/(\d+)$/);
      if (listMatch) {
        const id = Number(listMatch[1]);
        if (method === 'GET') {
          const l = getListing(id);
          return l ? sendJSON(res, 200, l) : notFound(res, 'Listing not found');
        }
        if (method === 'PUT') return await updateListing(req, res, id);
        if (method === 'DELETE') return deleteListing(res, id);
      }

      const imgMatch = pathname.match(/^\/api\/listings\/(\d+)\/image\/(.+)$/);
      if (imgMatch && method === 'DELETE') {
        return deleteListingImage(res, Number(imgMatch[1]), decodeURIComponent(imgMatch[2]));
      }

      // /api/inquiries
      if (pathname === '/api/inquiries') {
        if (method === 'GET') return listInquiries(res);
        if (method === 'POST') return await createInquiry(req, res);
      }
      const inqMatch = pathname.match(/^\/api\/inquiries\/(\d+)$/);
      if (inqMatch) {
        const id = Number(inqMatch[1]);
        if (method === 'PATCH') return await patchInquiry(req, res, id);
        if (method === 'DELETE') return deleteInquiry(res, id);
      }

      // /api/settings
      if (pathname === '/api/settings') {
        if (method === 'GET') return getSettings(res);
        if (method === 'POST') return await saveSettings(req, res);
      }

      return notFound(res, 'Unknown API route');
    }

    // ---------------- Static ----------------
    return serveStatic(req, res, pathname);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[server] error:', err);
    sendJSON(res, 500, { error: 'Internal Server Error', detail: String(err && err.message || err) });
  }
});

server.listen(PORT, () => {
  /* eslint-disable no-console */
  console.log('\n  \x1b[33m▲ TERRA\x1b[0m — Jordanian Land Platform');
  console.log(`  \x1b[32m➜\x1b[0m  Local:      http://localhost:${PORT}`);
  console.log(`  \x1b[32m➜\x1b[0m  Dashboard:  http://localhost:${PORT}/dashboard  (password: terra2025)`);
  console.log(`  \x1b[90m➜  Uploads:    ${UPLOADS_DIR}\x1b[0m\n`);
  /* eslint-enable no-console */
});
