'use strict';
const express = require('express');
const QRCode = require('qrcode');
const { db, getSetting } = require('../db');
const { requireCustomer } = require('../lib/auth-mid');
const { quoteCart, PricingError } = require('../lib/pricing');
const { accountTypeFor, getProductById } = require('./catalog');
const { notify } = require('../lib/notify');

const router = express.Router();

// ---- Addresses ----------------------------------------------------------------
router.get('/addresses', requireCustomer, (req, res) => {
  const rows = db.prepare('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC').all(req.user.id);
  res.json({ addresses: rows });
});

router.post('/addresses', requireCustomer, (req, res) => {
  const { label, line1, line2, city, pincode, isDefault, isBusiness } = req.body || {};
  if (!line1 || !pincode) return res.status(400).json({ error: 'Address line and pincode are required.' });
  if (isDefault) db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').run(req.user.id);
  const mapsQuery = encodeURIComponent(`${line1}, ${line2 || ''}, ${city || 'Chennai'} ${pincode}`);
  const info = db
    .prepare(
      `INSERT INTO addresses(user_id, label, line1, line2, city, pincode, is_default, is_business, maps_query)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(req.user.id, label || 'Home', line1, line2 || null, city || 'Chennai', pincode, isDefault ? 1 : 0, isBusiness ? 1 : 0, mapsQuery);
  res.json({ id: info.lastInsertRowid });
});

router.delete('/addresses/:id', requireCustomer, (req, res) => {
  db.prepare('DELETE FROM addresses WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

// ---- Checkout -------------------------------------------------------------------
function generateOrderNo() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const seq = db.prepare(`SELECT COUNT(*) AS c FROM orders WHERE order_no LIKE ?`).get(`SMV-${stamp}-%`).c + 1;
  return `SMV-${stamp}-${String(seq).padStart(3, '0')}`;
}

router.post('/checkout', requireCustomer, async (req, res, next) => {
  try {
  const { items, addressId, paymentMethod } = req.body || {};
  const accountType = accountTypeFor(req.user);
  const validMethods = ['gpay', 'phonepe', 'paytm', 'upi', 'cod'];

  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Cart is empty.' });
  if (!validMethods.includes(paymentMethod)) return res.status(400).json({ error: 'Choose a valid payment method.' });

  const address = db.prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?').get(Number(addressId), req.user.id);
  if (!address) return res.status(400).json({ error: 'Choose a delivery address.' });

  let quote;
  try {
    quote = quoteCart(
      items.map((i) => ({ productId: Number(i.productId), qty: Number(i.qty) })),
      accountType,
      getProductById
    );
  } catch (err) {
    if (err instanceof PricingError) return res.status(400).json({ error: err.message });
    throw err;
  }

  if (!quote.meetsMinimum) {
    return res.status(400).json({ error: `Minimum order value is \u20b9${quote.minOrder}. Add \u20b9${(quote.minOrder - quote.subtotal).toFixed(2)} more to checkout.` });
  }

  const orderNo = generateOrderNo();
  const today = new Date().toISOString().slice(0, 10);
  const paymentStatus = paymentMethod === 'cod' ? 'pending' : 'pending';

  const insertOrder = db.prepare(
    `INSERT INTO orders(order_no, user_id, account_type, subtotal, discount, delivery_charge, total,
      payment_method, payment_status, address_line, maps_query, customer_name, customer_mobile, shift_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertItem = db.prepare(
    `INSERT INTO order_items(order_id, product_id, name_snapshot, pack_size_snapshot, unit_price, tier_label, qty, line_total)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const decrementStock = db.prepare('UPDATE products SET stock_qty = stock_qty - ? WHERE id = ?');

  // node:sqlite's DatabaseSync has no .transaction() helper (unlike
  // better-sqlite3), so the atomic block is done by hand with explicit
  // BEGIN/COMMIT/ROLLBACK.
  let orderId;
  db.exec('BEGIN');
  try {
    const info = insertOrder.run(
      orderNo,
      req.user.id,
      accountType,
      quote.subtotal,
      quote.discount,
      quote.deliveryCharge,
      quote.total,
      paymentMethod,
      paymentStatus,
      `${address.line1}${address.line2 ? ', ' + address.line2 : ''}, ${address.city} ${address.pincode}`,
      address.maps_query,
      req.user.full_name,
      req.user.mobile,
      today
    );
    orderId = info.lastInsertRowid;
    for (const line of quote.lines) {
      insertItem.run(orderId, line.productId, line.name, line.packSize, line.unitPrice, line.tierLabel, line.qty, line.lineTotal);
      decrementStock.run(line.qty, line.productId);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  notify(req.user.id, req.user.mobile, `Order ${orderNo} placed! Total \u20b9${quote.total}. We'll notify you when it's out for delivery.`);

  // Build the UPI payment request server-side, from the just-computed
  // authoritative total -- never from anything the client sent. Works for
  // gpay/phonepe/paytm/upi; COD gets no link. Generic `upi://pay` intent
  // opens whatever UPI apps are installed (the phone's own app chooser
  // handles GPay vs PhonePe vs Paytm), which is standard behaviour for a
  // web app -- there's no reliable way to force one specific app from a
  // browser without native app wrappers.
  let upiLink = null;
  let upiQrDataUrl = null;
  if (paymentMethod !== 'cod') {
    const vpa = getSetting('upi_vpa', '');
    const payeeName = getSetting('upi_payee_name', 'Sathvika MV');
    if (vpa) {
      upiLink = `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(payeeName)}&am=${quote.total}&cu=INR&tn=${encodeURIComponent('Order ' + orderNo)}`;
      try {
        // The QR encodes the exact same upiLink -- scanning it opens the
        // customer's UPI app with the amount pre-filled via the `am` param,
        // same as tapping the "Pay via UPI" button does on a phone.
        upiQrDataUrl = await QRCode.toDataURL(upiLink, { width: 320, margin: 1 });
      } catch (qrErr) {
        console.error('QR generation failed:', qrErr);
        upiQrDataUrl = null; // fallback: frontend still shows the tappable upiLink button
      }
    }
  }

  res.json({ ok: true, orderId, orderNo, total: quote.total, estimatedMinutes: accountType === 'wholesale' ? 120 : 45, upiLink, upiQrDataUrl, paymentMethod, vpa: getSetting('upi_vpa', '') });
  } catch (err) { next(err); }
});

// ---- Order history / detail / reorder --------------------------------------------
router.get('/', requireCustomer, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  res.json({
    orders: orders.map((o) => ({ ...serializeOrder(o), items: items.all(o.id) })),
  });
});

router.get('/:id', requireCustomer, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  res.json({ order: serializeOrder(order), items });
});

router.post('/:id/reorder', requireCustomer, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  const { productIds } = req.body || {}; // optional: reorder only some items
  let items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  if (Array.isArray(productIds) && productIds.length > 0) {
    items = items.filter((i) => productIds.includes(i.product_id));
  }
  const accountType = accountTypeFor(req.user);
  // Re-quote against *current* prices/stock -- never reuse the old snapshot as
  // the chargeable amount, since prices or stock may have moved since.
  const cartItems = items
    .map((i) => ({ productId: i.product_id, qty: i.qty }))
    .filter((i) => {
      const p = getProductById(i.productId);
      return p && p.active && p.stock_qty > 0;
    });
  if (cartItems.length === 0) return res.status(400).json({ error: 'None of these items are available right now.' });
  try {
    const quote = quoteCart(cartItems, accountType, getProductById);
    res.json({ cartItems, quote });
  } catch (err) {
    if (err instanceof PricingError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

function serializeOrder(o) {
  return {
    id: o.id,
    orderNo: o.order_no,
    status: o.status,
    subtotal: o.subtotal,
    discount: o.discount,
    deliveryCharge: o.delivery_charge,
    total: o.total,
    paymentMethod: o.payment_method,
    paymentStatus: o.payment_status,
    addressLine: o.address_line,
    placedAt: o.placed_at,
    updatedAt: o.updated_at,
    cancelReason: o.cancel_reason,
  };
}

module.exports = { router, generateOrderNo, serializeOrder };
