// server/db.js
// SQLite via Node's built-in node:sqlite (no native build step, no extra dependency).
// Node >=22.5 required. This is a single-store app (low hundreds of products) so a
// single synchronous SQLite file is the right amount of infrastructure -- see
// HANDOFF.md "Why node:sqlite" for the reasoning and the Postgres migration note.
'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.SATHVIKA_DB || path.join(DATA_DIR, 'sathvika.db');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK(role IN ('retail','wholesale')),
  full_name TEXT NOT NULL,
  mobile TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  business_name TEXT,
  business_type TEXT,
  gst_number TEXT,
  wholesale_status TEXT NOT NULL DEFAULT 'none' CHECK(wholesale_status IN ('none','pending','approved','suspended','rejected')),
  language TEXT NOT NULL DEFAULT 'en',
  mobile_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS owner_account (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  pin_salt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER,
  scope TEXT NOT NULL CHECK(scope IN ('customer','owner_ops','owner_admin')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mobile TEXT NOT NULL,
  code TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('signup','reset')),
  consumed INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'Home',
  line1 TEXT NOT NULL,
  line2 TEXT,
  city TEXT NOT NULL DEFAULT 'Chennai',
  pincode TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  is_business INTEGER NOT NULL DEFAULT 0,
  maps_query TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT 'Local',
  category_id INTEGER NOT NULL REFERENCES categories(id),
  pack_size TEXT NOT NULL,
  unit TEXT NOT NULL CHECK(unit IN ('kg','g','litre','ml','piece','packet','box','dozen')),
  image TEXT,
  mrp REAL NOT NULL,
  retail_price REAL NOT NULL,
  wholesale_base_price REAL NOT NULL,
  moq INTEGER NOT NULL DEFAULT 1,
  stock_qty INTEGER NOT NULL DEFAULT 0,
  low_stock_threshold INTEGER NOT NULL DEFAULT 5,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wholesale_tiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  min_qty INTEGER NOT NULL,
  max_qty INTEGER,
  unit_price REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  account_type TEXT NOT NULL CHECK(account_type IN ('retail','wholesale')),
  status TEXT NOT NULL DEFAULT 'placed' CHECK(status IN ('placed','confirmed','preparing','out_for_delivery','delivered','cancelled')),
  subtotal REAL NOT NULL,
  discount REAL NOT NULL DEFAULT 0,
  delivery_charge REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  payment_method TEXT NOT NULL CHECK(payment_method IN ('gpay','phonepe','paytm','upi','cod')),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK(payment_status IN ('pending','received','na')),
  address_line TEXT NOT NULL,
  maps_query TEXT,
  customer_name TEXT NOT NULL,
  customer_mobile TEXT NOT NULL,
  shift_date TEXT NOT NULL,
  cancel_reason TEXT,
  placed_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  name_snapshot TEXT NOT NULL,
  pack_size_snapshot TEXT NOT NULL,
  unit_price REAL NOT NULL,
  tier_label TEXT,
  qty INTEGER NOT NULL,
  line_total REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  channel TEXT NOT NULL DEFAULT 'sms',
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_shift ON orders(shift_date);
CREATE INDEX IF NOT EXISTS idx_tiers_product ON wholesale_tiers(product_id);
`;

db.exec(SCHEMA);

function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

// Seed baseline settings once.
if (!db.prepare('SELECT 1 FROM settings WHERE key = ?').get('min_order_retail')) {
  setSetting('min_order_retail', '70');
  setSetting('shop_open', '1');
  setSetting('delivery_charge_flat', '20');
  // Placeholder VPA -- replace via the owner endpoint below (or edit here and
  // re-run `npm run reset`) with the shop's real UPI ID once confirmed.
  setSetting('upi_vpa', 'vijayakumar4ru-3@okicici');
  setSetting('upi_payee_name', 'Sathvika MV');
  setSetting('store_name', 'Sathvika MV');
  setSetting('store_address', 'Thousand Lights, Chennai');
}

module.exports = { db, getSetting, setSetting, DB_PATH };
