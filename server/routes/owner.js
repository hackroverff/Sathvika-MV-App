'use strict';
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const PDFDocument = require('pdfkit');
const { db, getSetting, setSetting } = require('../db');
const { verifySecret, hashSecret } = require('../lib/crypto-util');
const sessions = require('../lib/sessions');
const { requireOwnerOps, requireOwnerAdmin } = require('../lib/auth-mid');
const { notify } = require('../lib/notify');
const { serializeOrder } = require('./orders');

const router = express.Router();

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ---- Login: PIN (ops) and password (admin) ---------------------------------------
router.post('/login/pin', (req, res) => {
  const { pin } = req.body || {};
  const owner = db.prepare('SELECT * FROM owner_account WHERE id = 1').get();
  if (!owner || !pin || !verifySecret(pin, owner.pin_salt, owner.pin_hash)) {
    return res.status(401).json({ error: 'Incorrect PIN.' });
  }
  const token = sessions.createOwnerOpsSession();
  res.json({ ok: true, token, scope: 'owner_ops' });
});

router.post('/login/password', (req, res) => {
  const { password } = req.body || {};
  const owner = db.prepare('SELECT * FROM owner_account WHERE id = 1').get();
  if (!owner || !password || !verifySecret(password, owner.password_salt, owner.password_hash)) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  const token = sessions.createOwnerAdminSession();
  res.json({ ok: true, token, scope: 'owner_admin' });
});

router.post('/logout', requireOwnerOps, (req, res) => {
  sessions.destroy(req.session.token);
  res.json({ ok: true });
});

// ---- Shop open/closed --------------------------------------------------------------
router.get('/shop-status', (req, res) => {
  res.json({ open: getSetting('shop_open', '1') === '1' });
});
router.post('/shop-status', requireOwnerOps, (req, res) => {
  setSetting('shop_open', req.body?.open ? '1' : '0');
  res.json({ ok: true, open: req.body?.open ? true : false });
});

// ---- Dashboard summary + current shift orders --------------------------------------
router.get('/dashboard', requireOwnerOps, (req, res) => {
  const t = today();
  const orders = db.prepare(`SELECT * FROM orders WHERE shift_date = ? AND status != 'cancelled' ORDER BY id DESC`).all(t);

  const shiftOrders = orders.length;
  const onlineReceived = round2(
    orders.filter((o) => o.payment_method !== 'cod' && o.payment_status === 'received').reduce((s, o) => s + o.total, 0)
  );
  const codReceived = round2(
    orders.filter((o) => o.payment_method === 'cod' && o.status === 'delivered').reduce((s, o) => s + o.total, 0)
  );
  const grandTotal = round2(orders.reduce((s, o) => s + o.total, 0));

  const lowStock = db
    .prepare('SELECT id, name, stock_qty, low_stock_threshold FROM products WHERE active = 1 AND stock_qty <= low_stock_threshold ORDER BY stock_qty ASC')
    .all();

  res.json({
    summary: { shiftOrders, onlineReceived, grandTotal, codReceived },
    orders: orders.map((o) => ({ ...serializeOrder(o), mapsQuery: o.maps_query })),
    lowStockAlerts: lowStock,
    shopOpen: getSetting('shop_open', '1') === '1',
  });
});

router.post('/orders/:id/status', requireOwnerOps, (req, res) => {
  const { status } = req.body || {};
  const flow = ['placed', 'confirmed', 'preparing', 'out_for_delivery', 'delivered'];
  if (!flow.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'Order not found.' });

  db.prepare(`UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, order.id);

  if (status === 'out_for_delivery') {
    notify(order.user_id, order.customer_mobile, `Your order ${order.order_no} is out for delivery.`);
  } else if (status === 'delivered') {
    notify(order.user_id, order.customer_mobile, `Your order ${order.order_no} has been delivered. Thank you for shopping with Sathvika MV!`);
  }
  res.json({ ok: true });
});

// Void/cancel an order with a reason -- removed from active shift totals because
// the dashboard query above filters status != 'cancelled'.
router.post('/orders/:id/void', requireOwnerOps, (req, res) => {
  const { reason } = req.body || {};
  if (!reason) return res.status(400).json({ error: 'A reason is required to void an order.' });
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'Order not found.' });

  db.prepare(`UPDATE orders SET status = 'cancelled', cancel_reason = ?, updated_at = datetime('now') WHERE id = ?`).run(reason, order.id);
  // Restock voided items.
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  const restock = db.prepare('UPDATE products SET stock_qty = stock_qty + ? WHERE id = ?');
  for (const it of items) restock.run(it.qty, it.product_id);

  notify(order.user_id, order.customer_mobile, `Your order ${order.order_no} was cancelled: ${reason}.`);
  res.json({ ok: true });
});

// ---- Online payment reconciliation --------------------------------------------------
router.get('/payments/pending', requireOwnerOps, (req, res) => {
  const rows = db
    .prepare(`SELECT * FROM orders WHERE payment_method != 'cod' AND payment_status = 'pending' ORDER BY id DESC`)
    .all();
  res.json({ orders: rows.map(serializeOrder) });
});

router.post('/payments/:id/mark-received', requireOwnerOps, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  db.prepare(`UPDATE orders SET payment_status = 'received', updated_at = datetime('now') WHERE id = ?`).run(order.id);
  res.json({ ok: true });
});

// ---- Wholesale approvals (owner_ops can view, but approve/reject/suspend needs
// the stronger password scope since it unlocks wholesale pricing) --------------------
router.get('/wholesale-accounts', requireOwnerOps, (req, res) => {
  const status = req.query.status || 'pending';
  const rows = db
    .prepare('SELECT id, full_name, mobile, business_name, business_type, gst_number, wholesale_status, created_at FROM users WHERE role = ? AND wholesale_status = ? ORDER BY id DESC')
    .all('wholesale', status);
  res.json({ accounts: rows });
});

router.post('/wholesale-accounts/:id/decision', requireOwnerAdmin, (req, res) => {
  const { decision } = req.body || {}; // 'approved' | 'suspended' | 'rejected'
  if (!['approved', 'suspended', 'rejected'].includes(decision)) return res.status(400).json({ error: 'Invalid decision.' });
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(Number(req.params.id), 'wholesale');
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  db.prepare('UPDATE users SET wholesale_status = ? WHERE id = ?').run(decision, user.id);

  const messages = {
    approved: 'Your wholesale account is approved! Wholesale pricing is now unlocked.',
    suspended: 'Your wholesale account has been suspended. Please contact the shop.',
    rejected: 'Your wholesale account request was not approved. You can still shop at retail pricing.',
  };
  notify(user.id, user.mobile, messages[decision]);
  res.json({ ok: true });
});

// ---- Menu management (products/categories) -- sensitive, password scope -----------
router.get('/menu/categories', requireOwnerOps, (req, res) => {
  res.json({ categories: db.prepare('SELECT * FROM categories ORDER BY parent_id IS NOT NULL, name').all() });
});
router.post('/menu/categories', requireOwnerAdmin, (req, res) => {
  const { name, parentId } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Category name is required.' });
  const info = db.prepare('INSERT INTO categories(name, parent_id) VALUES (?, ?)').run(name, parentId || null);
  res.json({ id: info.lastInsertRowid });
});

router.get('/menu/products', requireOwnerOps, (req, res) => {
  res.json({ products: db.prepare('SELECT * FROM products ORDER BY id DESC').all() });
});

router.post('/menu/products', requireOwnerAdmin, (req, res) => {
  const p = req.body || {};
  const required = ['name', 'categoryId', 'packSize', 'unit', 'mrp', 'retailPrice', 'wholesaleBasePrice'];
  for (const f of required) if (p[f] === undefined || p[f] === null || p[f] === '') return res.status(400).json({ error: `${f} is required.` });

  const info = db
    .prepare(
      `INSERT INTO products(name, brand, category_id, pack_size, unit, image, mrp, retail_price, wholesale_base_price, moq, stock_qty, low_stock_threshold)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      p.name,
      p.brand || 'Local',
      Number(p.categoryId),
      p.packSize,
      p.unit,
      p.image || null,
      Number(p.mrp),
      Number(p.retailPrice),
      Number(p.wholesaleBasePrice),
      Number(p.moq) || 1,
      Number(p.stockQty) || 0,
      Number(p.lowStockThreshold) || 5
    );

  if (Array.isArray(p.tiers)) {
    const insertTier = db.prepare('INSERT INTO wholesale_tiers(product_id, min_qty, max_qty, unit_price) VALUES (?, ?, ?, ?)');
    for (const t of p.tiers) insertTier.run(info.lastInsertRowid, Number(t.minQty), t.maxQty ? Number(t.maxQty) : null, Number(t.unitPrice));
  }
  res.json({ id: info.lastInsertRowid });
});

router.put('/menu/products/:id', requireOwnerAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Product not found.' });
  const p = req.body || {};
  db.prepare(
    `UPDATE products SET name=?, brand=?, category_id=?, pack_size=?, unit=?, image=?, mrp=?, retail_price=?,
      wholesale_base_price=?, moq=?, stock_qty=?, low_stock_threshold=?, active=? WHERE id=?`
  ).run(
    p.name ?? existing.name,
    p.brand ?? existing.brand,
    p.categoryId ? Number(p.categoryId) : existing.category_id,
    p.packSize ?? existing.pack_size,
    p.unit ?? existing.unit,
    p.image ?? existing.image,
    p.mrp !== undefined ? Number(p.mrp) : existing.mrp,
    p.retailPrice !== undefined ? Number(p.retailPrice) : existing.retail_price,
    p.wholesaleBasePrice !== undefined ? Number(p.wholesaleBasePrice) : existing.wholesale_base_price,
    p.moq !== undefined ? Number(p.moq) : existing.moq,
    p.stockQty !== undefined ? Number(p.stockQty) : existing.stock_qty,
    p.lowStockThreshold !== undefined ? Number(p.lowStockThreshold) : existing.low_stock_threshold,
    p.active !== undefined ? (p.active ? 1 : 0) : existing.active,
    id
  );

  if (Array.isArray(p.tiers)) {
    db.prepare('DELETE FROM wholesale_tiers WHERE product_id = ?').run(id);
    const insertTier = db.prepare('INSERT INTO wholesale_tiers(product_id, min_qty, max_qty, unit_price) VALUES (?, ?, ?, ?)');
    for (const t of p.tiers) insertTier.run(id, Number(t.minQty), t.maxQty ? Number(t.maxQty) : null, Number(t.unitPrice));
  }
  res.json({ ok: true });
});

// Real product photo upload -- the owner takes/picks a photo on their phone
// and it's saved directly, no stock/branded imagery involved. Accepts a
// data: URL (base64) in the body so no extra multipart-parsing dependency
// is needed. 5MB decoded-size cap keeps the app folder from bloating.
router.post('/menu/products/:id/photo', requireOwnerAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Product not found.' });

  const { dataUrl } = req.body || {};
  const match = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(dataUrl || '');
  if (!match) return res.status(400).json({ error: 'Choose a photo (PNG, JPG, or WEBP).' });
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'Photo is too large (max 5MB).' });

  const filename = `product-${id}-${Date.now()}.${ext}`;
  const dir = path.join(__dirname, '..', '..', 'public', 'img', 'products');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), buffer);

  const imagePath = `/img/products/${filename}`;
  db.prepare('UPDATE products SET image = ? WHERE id = ?').run(imagePath, id);
  res.json({ ok: true, image: imagePath });
});

router.get('/menu/products/:id/tiers', requireOwnerOps, (req, res) => {
  res.json({ tiers: db.prepare('SELECT * FROM wholesale_tiers WHERE product_id = ? ORDER BY min_qty').all(Number(req.params.id)) });
});

router.post('/menu/products/:id/stock', requireOwnerAdmin, (req, res) => {
  const { stockQty } = req.body || {};
  db.prepare('UPDATE products SET stock_qty = ? WHERE id = ?').run(Number(stockQty), Number(req.params.id));
  res.json({ ok: true });
});

router.post('/settings/min-order', requireOwnerAdmin, (req, res) => {
  setSetting('min_order_retail', Number(req.body?.value));
  res.json({ ok: true });
});

router.get('/settings/payment', requireOwnerOps, (req, res) => {
  res.json({ vpa: getSetting('upi_vpa', ''), payeeName: getSetting('upi_payee_name', 'Sathvika MV') });
});

router.post('/settings/payment', requireOwnerAdmin, (req, res) => {
  const { vpa, payeeName } = req.body || {};
  if (!vpa) return res.status(400).json({ error: 'UPI ID is required.' });
  setSetting('upi_vpa', vpa);
  setSetting('upi_payee_name', payeeName || 'Sathvika MV');
  res.json({ ok: true });
});

// ---- History + sales summary --------------------------------------------------------
router.get('/history', requireOwnerOps, (req, res) => {
  const rows = fetchHistoryOrders(req.query);
  res.json({ orders: rows.map(serializeOrder) });
});

function fetchHistoryOrders(query) {
  const { from, to, q } = query || {};
  let sql = 'SELECT * FROM orders WHERE 1=1';
  const params = [];
  if (from) { sql += ' AND shift_date >= ?'; params.push(from); }
  if (to) { sql += ' AND shift_date <= ?'; params.push(to); }
  if (q) { sql += ' AND (order_no LIKE ? OR customer_name LIKE ? OR customer_mobile LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  sql += ' ORDER BY id DESC LIMIT 5000';
  return db.prepare(sql).all(...params);
}

// ---- Export order history: real data, not a placeholder file -----------------------
router.get('/history/export.csv', requireOwnerOps, (req, res) => {
  const orders = fetchHistoryOrders(req.query);
  const itemsStmt = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  const csvEscape = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = ['Order ID', 'Date', 'Customer', 'Mobile', 'Items', 'Payment Method', 'Status', 'Subtotal', 'Delivery Charge', 'Total'];
  const lines = [header.join(',')];
  for (const o of orders) {
    const items = itemsStmt.all(o.id).map((i) => `${i.qty}x ${i.name_snapshot}`).join('; ');
    lines.push(
      [o.order_no, o.placed_at, o.customer_name, o.customer_mobile, items, o.payment_method.toUpperCase(), o.status, o.subtotal, o.delivery_charge, o.total]
        .map(csvEscape)
        .join(',')
    );
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="sathvika-mv-orders-${today()}.csv"`);
  res.send(lines.join('\r\n'));
});

router.get('/history/export.pdf', requireOwnerOps, (req, res) => {
  const orders = fetchHistoryOrders(req.query);
  const itemsStmt = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="sathvika-mv-orders-${today()}.pdf"`);

  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  doc.pipe(res);
  doc.fontSize(18).fillColor('#8b3035').text('Sathvika MV', { continued: true }).fillColor('#000').text('  \u2014 Order History');
  doc.fontSize(9).fillColor('#666').text(`Exported ${new Date().toISOString().slice(0, 19).replace('T', ' ')}  \u00b7  ${orders.length} orders`);
  doc.moveDown(0.8);
  doc.fillColor('#000');

  if (orders.length === 0) {
    doc.fontSize(11).text('No orders in this range.');
  }
  for (const o of orders) {
    if (doc.y > 730) doc.addPage();
    const items = itemsStmt.all(o.id).map((i) => `${i.qty}x ${i.name_snapshot}`).join(', ');
    doc.fontSize(11).fillColor('#8b3035').text(o.order_no, { continued: true });
    doc.fillColor('#000').text(`   ${o.placed_at}   [${o.status.replace(/_/g, ' ').toUpperCase()}]`);
    doc.fontSize(9).fillColor('#333');
    doc.text(`Customer: ${o.customer_name}  (${o.customer_mobile})`);
    doc.text(`Items: ${items || '-'}`);
    doc.text(`Payment: ${o.payment_method.toUpperCase()}   Subtotal: Rs.${o.subtotal.toFixed(2)}   Delivery: Rs.${o.delivery_charge.toFixed(2)}   Total: Rs.${o.total.toFixed(2)}`);
    doc.moveDown(0.6);
  }
  doc.end();
});

router.get('/history/summary', requireOwnerOps, (req, res) => {
  const t = today();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const sumSince = (since) =>
    db.prepare(`SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS orders FROM orders WHERE shift_date >= ? AND status != 'cancelled'`).get(since);

  const topProducts = db
    .prepare(
      `SELECT oi.product_id, oi.name_snapshot AS name, SUM(oi.qty) AS unitsSold, SUM(oi.line_total) AS revenue
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.status != 'cancelled' AND o.shift_date >= ?
       GROUP BY oi.product_id ORDER BY unitsSold DESC LIMIT 10`
    )
    .all(monthAgo);

  res.json({
    today: sumSince(t),
    week: sumSince(weekAgo),
    month: sumSince(monthAgo),
    topProducts,
  });
});

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

module.exports = { router };
