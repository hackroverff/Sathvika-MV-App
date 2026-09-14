'use strict';
const express = require('express');
const { db, getSetting } = require('../db');
const { optionalAuth } = require('../lib/auth-mid');
const { quoteCart, PricingError } = require('../lib/pricing');

const router = express.Router();

function accountTypeFor(user) {
  if (!user) return 'retail';
  return user.role === 'wholesale' && user.wholesale_status === 'approved' ? 'wholesale' : 'retail';
}

function getProductById(id) {
  return db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(id);
}

function stockStatus(p) {
  if (p.stock_qty <= 0) return 'out_of_stock';
  if (p.stock_qty <= p.low_stock_threshold) return 'low_stock';
  return 'in_stock';
}

function serializeProduct(p, accountType) {
  const tiers = db
    .prepare('SELECT min_qty, max_qty, unit_price FROM wholesale_tiers WHERE product_id = ? ORDER BY min_qty ASC')
    .all(p.id);
  const wholesale = accountType === 'wholesale';
  return {
    id: p.id,
    name: p.name,
    brand: p.brand,
    categoryId: p.category_id,
    packSize: p.pack_size,
    unit: p.unit,
    image: p.image,
    mrp: p.mrp,
    price: wholesale ? (tiers[0] ? tiers[0].unit_price : p.wholesale_base_price) : p.retail_price,
    discountPct: p.mrp > 0
      ? Math.round((1 - (wholesale ? p.wholesale_base_price : p.retail_price) / p.mrp) * 100)
      : 0,
    moq: wholesale ? p.moq : 1,
    stockStatus: stockStatus(p),
    stockQty: p.stock_qty,
    isWholesalePricing: wholesale,
    tiers: wholesale ? tiers : [],
  };
}

router.get('/categories', (req, res) => {
  const rows = db.prepare('SELECT * FROM categories ORDER BY parent_id IS NOT NULL, name').all();
  res.json({ categories: rows });
});

router.get('/products', optionalAuth, (req, res) => {
  const accountType = accountTypeFor(req.user);
  const { category, brand, q, minPrice, maxPrice, inStockOnly } = req.query;

  let sql = 'SELECT * FROM products WHERE active = 1';
  const params = [];
  if (category) {
    sql += ' AND category_id = ?';
    params.push(Number(category));
  }
  if (brand) {
    sql += ' AND brand = ?';
    params.push(brand);
  }
  if (q) {
    sql += ' AND (name LIKE ? OR brand LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY name ASC';

  let products = db.prepare(sql).all(...params).map((p) => serializeProduct(p, accountType));

  if (minPrice) products = products.filter((p) => p.price >= Number(minPrice));
  if (maxPrice) products = products.filter((p) => p.price <= Number(maxPrice));
  if (inStockOnly === '1') products = products.filter((p) => p.stockStatus !== 'out_of_stock');

  res.json({ products, accountType, shopOpen: getSetting('shop_open', '1') === '1' });
});

router.get('/products/:id', optionalAuth, (req, res) => {
  const accountType = accountTypeFor(req.user);
  const p = getProductById(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Product not found.' });
  res.json({ product: serializeProduct(p, accountType) });
});

router.get('/brands', (req, res) => {
  const rows = db.prepare('SELECT DISTINCT brand FROM products WHERE active = 1 ORDER BY brand').all();
  res.json({ brands: rows.map((r) => r.brand) });
});

// Central pricing quote -- every price a customer sees for a set of quantities
// flows through here (or the identical code path used at checkout), never
// computed client-side. items: [{ productId, qty }]
router.post('/quote', optionalAuth, (req, res) => {
  const accountType = accountTypeFor(req.user);
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (items.length === 0) return res.json({ lines: [], subtotal: 0, discount: 0, deliveryCharge: 0, total: 0, minOrder: Number(getSetting('min_order_retail', '70')), meetsMinimum: true });
  try {
    const quote = quoteCart(
      items.map((i) => ({ productId: Number(i.productId), qty: Number(i.qty) })),
      accountType,
      getProductById
    );
    res.json({ ...quote, accountType });
  } catch (err) {
    if (err instanceof PricingError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

module.exports = { router, accountTypeFor, serializeProduct, getProductById };
