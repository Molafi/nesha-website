/**
 * db.js — SQLite connection + schema for TERRA
 * -------------------------------------------------
 * Uses Node's built-in `node:sqlite` (Node >= 22.5) so there is
 * NO native compilation and NO external dependency to install.
 * The public API mirrors better-sqlite3 (prepare/run/get/all/exec)
 * closely so the rest of the codebase reads naturally.
 */

'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DB_PATH = path.join(__dirname, 'terra.db');

const db = new DatabaseSync(DB_PATH);

// -- Pragmas for reliability + performance ----------------------------------
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// -- Schema -----------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS listings (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    title          TEXT    NOT NULL,
    parcel_number  TEXT    NOT NULL DEFAULT '',
    land_type      TEXT    NOT NULL DEFAULT 'Residential',
    area_m2        REAL    NOT NULL DEFAULT 0,
    price_jod      REAL    NOT NULL DEFAULT 0,
    location       TEXT    NOT NULL DEFAULT '',
    lat            REAL,
    lng            REAL,
    map_x          REAL,
    map_z          REAL,
    description    TEXT    NOT NULL DEFAULT '',
    status         TEXT    NOT NULL DEFAULT 'Available',
    images         TEXT    NOT NULL DEFAULT '[]',
    featured_image TEXT,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS inquiries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id  INTEGER,
    name        TEXT NOT NULL DEFAULT '',
    email       TEXT NOT NULL DEFAULT '',
    phone       TEXT NOT NULL DEFAULT '',
    message     TEXT NOT NULL DEFAULT '',
    read        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE SET NULL
  );
`);

// ---------------------------------------------------------------------------
// Seed 9 placeholder listings matching the reference map (parcels 1–9).
// Coordinates (map_x, map_z) place each parcel on the Three.js terrain grid.
// The reference image parcel registry numbers (2372, 2373, 1870, 165 …) are
// woven into the parcel_number field for authenticity.
// ---------------------------------------------------------------------------
function seed() {
  const row = db.prepare('SELECT COUNT(*) AS c FROM listings').get();
  if (row.c > 0) return; // already seeded

  const insert = db.prepare(`
    INSERT INTO listings
      (title, parcel_number, land_type, area_m2, price_jod, location,
       lat, lng, map_x, map_z, description, status, images, featured_image)
    VALUES
      (@title, @parcel_number, @land_type, @area_m2, @price_jod, @location,
       @lat, @lng, @map_x, @map_z, @description, @status, @images, @featured_image)
  `);

  const seedData = [
    {
      title: 'Wadi Olive Terrace — Plot 1',
      parcel_number: 'Plot 1 / Parcel 2372',
      land_type: 'Agricultural',
      area_m2: 1850,
      price_jod: 45000,
      location: 'Wadi Al-Seer, Amman',
      lat: 31.9515, lng: 35.8110,
      map_x: -14, map_z: -9,
      description: 'A gently terraced agricultural plot bordered by mature olive trees and a traditional dry-stone wall. South-facing with excellent sun exposure and access from شارع ٢٠ متر.',
      status: 'Available',
    },
    {
      title: 'Stone Wall Vista — Plot 2',
      parcel_number: 'Plot 2 / Parcel 2373',
      land_type: 'Residential',
      area_m2: 1200,
      price_jod: 62000,
      location: 'Wadi Al-Seer, Amman',
      lat: 31.9520, lng: 35.8122,
      map_x: -6, map_z: -9,
      description: 'Elevated residential parcel with panoramic wadi views. Zoned Residence B. Direct frontage on the 20-metre street with utilities at the boundary.',
      status: 'Available',
    },
    {
      title: 'Sunrise Ridge — Plot 3',
      parcel_number: 'Plot 3 / Parcel 1870',
      land_type: 'Residential',
      area_m2: 980,
      price_jod: 58000,
      location: 'Wadi Al-Seer, Amman',
      lat: 31.9528, lng: 35.8131,
      map_x: 2, map_z: -9,
      description: 'Corner residential lot catching the morning sun. Flat, ready to build, and steps from the neighbourhood olive grove.',
      status: 'Reserved',
    },
    {
      title: 'Olive Grove Corner — Plot 4',
      parcel_number: 'Plot 4 / Parcel 165',
      land_type: 'Mixed',
      area_m2: 2100,
      price_jod: 95000,
      location: 'Wadi Al-Seer, Amman',
      lat: 31.9502, lng: 35.8145,
      map_x: 11, map_z: -9,
      description: 'Generous mixed-use parcel suitable for a home with a small orchard or a boutique agritourism venture. Established olive trees included.',
      status: 'Available',
    },
    {
      title: 'The Central Fields — Plot 5',
      parcel_number: 'Plot 5 / Parcel 166',
      land_type: 'Agricultural',
      area_m2: 3200,
      price_jod: 78000,
      location: 'Na\u2019ur, Amman',
      lat: 31.8720, lng: 35.8210,
      map_x: -10, map_z: 2,
      description: 'The largest field in the subdivision — fertile, level ground ideal for cultivation. Bordered on two sides by the internal 12-metre street.',
      status: 'Available',
    },
    {
      title: 'Quiet Wadi Bend — Plot 6',
      parcel_number: 'Plot 6 / Parcel 167',
      land_type: 'Residential',
      area_m2: 1050,
      price_jod: 54000,
      location: 'Na\u2019ur, Amman',
      lat: 31.8712, lng: 35.8224,
      map_x: -2, map_z: 2,
      description: 'Peaceful residential plot nestled where the road bends along the wadi. Sheltered, private, and beautifully framed by natural terrain.',
      status: 'Sold',
    },
    {
      title: 'Merchant\u2019s Frontage — Plot 7',
      parcel_number: 'Plot 7 / Parcel 168',
      land_type: 'Commercial',
      area_m2: 1400,
      price_jod: 120000,
      location: 'Na\u2019ur, Amman',
      lat: 31.8705, lng: 35.8238,
      map_x: 6, map_z: 2,
      description: 'Prime commercial frontage on the main 20-metre street. High visibility, ideal for retail, a café, or a roadside farm shop.',
      status: 'Available',
    },
    {
      title: 'Terraced Highland — Plot 8',
      parcel_number: 'Plot 8 / Parcel 169',
      land_type: 'Agricultural',
      area_m2: 1750,
      price_jod: 49000,
      location: 'Iraq Al-Amir, Amman',
      lat: 31.9110, lng: 35.7510,
      map_x: 14, map_z: 2,
      description: 'Classic Jordanian highland terracing with stone retaining walls. Rain-fed and rich in character, near the historic Iraq Al-Amir caves.',
      status: 'Available',
    },
    {
      title: 'Southern Gate — Plot 9',
      parcel_number: 'Plot 9 / Parcel 170',
      land_type: 'Mixed',
      area_m2: 1620,
      price_jod: 67000,
      location: 'Iraq Al-Amir, Amman',
      lat: 31.9095, lng: 35.7525,
      map_x: 0, map_z: 12,
      description: 'The gateway parcel at the southern entrance of the subdivision. Flexible zoning, mature landscaping, and immediate road access.',
      status: 'Available',
    },
  ];

  db.exec('BEGIN');
  try {
    for (const d of seedData) {
      insert.run({
        title: d.title,
        parcel_number: d.parcel_number,
        land_type: d.land_type,
        area_m2: d.area_m2,
        price_jod: d.price_jod,
        location: d.location,
        lat: d.lat,
        lng: d.lng,
        map_x: d.map_x,
        map_z: d.map_z,
        description: d.description,
        status: d.status,
        images: JSON.stringify([]),
        featured_image: null,
      });
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  // eslint-disable-next-line no-console
  console.log(`[db] Seeded ${seedData.length} placeholder listings.`);
}

seed();

module.exports = { db, DB_PATH };
