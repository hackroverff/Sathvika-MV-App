'use strict';
// Real, runnable smoke test -- `npm test` starts nothing on its own; run this
// against a server already started with `npm start` (see HANDOFF.md "How to
// verify this yourself"). Exits non-zero on any failure so it's CI-friendly.
const BASE = process.env.SATHVIKA_URL || 'http://localhost:4173';
let pass = 0, fail = 0;

async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = {};
  try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}

function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  - ${name}`); }
  else { fail++; console.log(`  FAIL - ${name}`); }
}

async function main() {
  console.log('== Health ==');
  { const r = await req('GET', '/api/health'); check('health returns ok', r.data.ok === true); }

  console.log('== Customer auth ==');
  let custToken;
  { const r = await req('POST', '/api/auth/login', { mobile: '9840012345', password: 'priya@123' });
    check('retail login succeeds', r.status === 200 && r.data.token);
    custToken = r.data.token; }
  { const r = await req('POST', '/api/auth/login', { mobile: '9840012345', password: 'wrong' });
    check('wrong password rejected with 401', r.status === 401); }
  { const r = await req('GET', '/api/auth/me', undefined, custToken);
    check('me returns retail effective pricing', r.data.user.effectivePricingType === 'retail'); }

  console.log('== Wholesale pricing (pending vs approved) ==');
  { const r = await req('POST', '/api/auth/login', { mobile: '9840012348', password: 'lakshmi@123' });
    const me = await req('GET', '/api/auth/me', undefined, r.data.token);
    check('pending wholesale account still sees retail pricing', me.data.user.effectivePricingType === 'retail'); }
  let wsToken;
  { const r = await req('POST', '/api/auth/login', { mobile: '9840012347', password: 'ramesh@123' });
    wsToken = r.data.token;
    const me = await req('GET', '/api/auth/me', undefined, wsToken);
    check('approved wholesale account sees wholesale pricing', me.data.user.effectivePricingType === 'wholesale'); }

  console.log('== Tiered pricing correctness ==');
  { const r = await req('POST', '/api/catalog/quote', { items: [{ productId: 13, qty: 3 }] }, wsToken);
    const line = r.data.lines[0];
    check('qty 3 (tier 1-5, at MOQ) prices at tier-1 rate', line.unitPrice === 90);
  }
  { const r = await req('POST', '/api/catalog/quote', { items: [{ productId: 13, qty: 10 }] }, wsToken);
    const line = r.data.lines[0];
    check('qty 10 (tier 6-20) prices at tier-2 rate', line.unitPrice === 85);
  }
  { const r = await req('POST', '/api/catalog/quote', { items: [{ productId: 13, qty: 25 }] }, wsToken);
    const line = r.data.lines[0];
    check('qty 25 (tier 21+) prices at tier-3 rate', line.unitPrice === 80);
  }

  console.log('== Pricing trust boundary ==');
  { // A retail account must never get wholesale pricing no matter what it asks for.
    const r = await req('POST', '/api/catalog/quote', { items: [{ productId: 13, qty: 25 }] }, custToken);
    check('retail account quoted at retail price regardless of qty', r.data.lines[0].unitPrice === 100);
  }
  { // Below MOQ for a wholesale account must be rejected, not silently allowed.
    const r = await req('POST', '/api/catalog/quote', { items: [{ productId: 13, qty: 1 }] }, wsToken);
    check('below-MOQ wholesale line is rejected', r.status === 400);
  }

  console.log('== Checkout + minimum order + stock ==');
  const addrList = await req('GET', '/api/orders/addresses', undefined, custToken);
  const addressId = addrList.data.addresses[0].id;
  { const r = await req('POST', '/api/orders/checkout', { items: [{ productId: 54, qty: 1 }], addressId, paymentMethod: 'cod' });
    check('checkout without auth is rejected', r.status === 401); }
  { const r = await req('POST', '/api/orders/checkout', { items: [{ productId: 54, qty: 1 }], addressId, paymentMethod: 'cod' }, custToken);
    check('checkout below minimum order value (\u20b912 < \u20b970) is rejected', r.status === 400); }
  let orderTotal, orderNo;
  { const before = await req('GET', '/api/catalog/products/13', undefined, custToken);
    const quoted = await req('POST', '/api/catalog/quote', { items: [{ productId: 13, qty: 2 }, { productId: 6, qty: 1 }] }, custToken);
    const r = await req('POST', '/api/orders/checkout', { items: [{ productId: 13, qty: 2 }, { productId: 6, qty: 1 }], addressId, paymentMethod: 'upi', total: 1 }, custToken);
    check('checkout succeeds when minimum met (client "total":1 tamper ignored)', r.status === 200 && r.data.total > 1);
    check('UPI checkout returns a upi:// payment link', typeof r.data.upiLink === 'string' && r.data.upiLink.startsWith('upi://pay?'));
    check('UPI checkout returns a QR code data URL', typeof r.data.upiQrDataUrl === 'string' && r.data.upiQrDataUrl.startsWith('data:image/png;base64,'));
    check('QR-encoded amount matches the final total (via the upiLink am= param)', r.data.upiLink.includes(`am=${r.data.total}`));
    check('delivery charge (\u20b920) is actually included in the total, not just displayed', r.data.total === quoted.data.subtotal + 20);
    check('order number matches SMV-YYYYMMDD-NNN format', /^SMV-\d{8}-\d{3}$/.test(r.data.orderNo));
    orderTotal = r.data.total;
    orderNo = r.data.orderNo;
    const after = await req('GET', '/api/catalog/products/13', undefined, custToken);
    check('stock decremented after checkout', after.data.product.stockQty === before.data.product.stockQty - 2);
  }
  { // A second order the same day must get the next sequential number, not collide.
    const r = await req('POST', '/api/orders/checkout', { items: [{ productId: 54, qty: 10 }], addressId, paymentMethod: 'cod' }, custToken);
    check('second same-day order gets a different, still-valid order number', r.data.orderNo !== orderNo && /^SMV-\d{8}-\d{3}$/.test(r.data.orderNo));
  }
  { // COD orders must not carry a UPI link/QR at all.
    const r = await req('POST', '/api/orders/checkout', { items: [{ productId: 54, qty: 10 }], addressId, paymentMethod: 'cod' }, custToken);
    check('COD checkout has no UPI link', r.data.upiLink === null);
  }

  console.log('== Owner auth scope separation ==');
  let opsToken, adminToken;
  { const r = await req('POST', '/api/owner/login/pin', { pin: '9999' }); check('wrong PIN rejected', r.status === 401); }
  { const r = await req('POST', '/api/owner/login/pin', { pin: '4321' }); opsToken = r.data.token; check('correct PIN logs in', r.status === 200 && opsToken); }
  { const r = await req('GET', '/api/owner/dashboard', undefined, opsToken); check('ops token can read dashboard', r.status === 200); }
  { const r = await req('POST', '/api/owner/wholesale-accounts/4/decision', { decision: 'approved' }, opsToken);
    check('ops-only token CANNOT approve wholesale accounts (needs admin)', r.status === 401); }
  { const r = await req('POST', '/api/owner/login/password', { password: 'wrong' }); check('wrong owner password rejected', r.status === 401); }
  { const r = await req('POST', '/api/owner/login/password', { password: 'owner@123' }); adminToken = r.data.token; check('correct owner password logs in (admin scope)', r.status === 200 && adminToken); }
  { const r = await req('POST', '/api/owner/wholesale-accounts/4/decision', { decision: 'approved' }, adminToken);
    check('admin token CAN approve wholesale accounts', r.status === 200); }
  { const r = await req('GET', '/api/auth/login'); } // no-op, keep req symmetrical

  console.log('== Order lifecycle on the owner side ==');
  const dash = await req('GET', '/api/owner/dashboard', undefined, opsToken);
  const anOrder = dash.data.orders.find((o) => o.status !== 'delivered' && o.status !== 'cancelled');
  if (anOrder) {
    const r = await req('POST', `/api/owner/orders/${anOrder.id}/status`, { status: 'confirmed' }, opsToken);
    check('ops token can advance order status', r.status === 200);
    const voidR = await req('POST', `/api/owner/orders/${anOrder.id}/void`, {}, opsToken);
    check('void without a reason is rejected', voidR.status === 400);
  } else {
    check('(skipped: no advanceable order in fixture)', true);
  }

  console.log('== Navigate link uses real directions, not a destination-only search ==');
  check(
    'shift order "Navigate" link is a /maps/dir/ directions URL (origin defaults to current location when omitted)',
    (await (async () => {
      // Rendered client-side in owner.js; verify the exact URL pattern it builds.
      const fs = require('node:fs');
      const src = fs.readFileSync(require('node:path').join(__dirname, '..', 'public', 'js', 'owner.js'), 'utf8');
      return src.includes('/maps/dir/?api=1&destination=') && !src.includes('/maps/search/?api=1&query=');
    })())
  );

  console.log('== Add product (with photo) end-to-end ==');
  { const r = await req(
      'POST',
      '/api/owner/menu/products',
      { name: 'Test Biscuits', brand: 'TestCo', categoryId: 1, packSize: '100 g', unit: 'packet', mrp: 30, retailPrice: 28, wholesaleBasePrice: 24, moq: 6, stockQty: 20 },
      adminToken
    );
    check('admin token can create a new product', r.status === 200 && r.data.id);
    const newId = r.data.id;
    const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const photoR = await req('POST', `/api/owner/menu/products/${newId}/photo`, { dataUrl: tinyPng }, adminToken);
    check('photo uploads and attaches to the newly created product', photoR.status === 200 && photoR.data.image);
    const fetched = await req('GET', `/api/catalog/products/${newId}`, undefined, custToken);
    check('the uploaded photo is what the customer catalog now serves for this product', fetched.data.product.image === photoR.data.image);
  }

  console.log('== History export (real files, not empty placeholders) ==');
  { const res = await fetch(BASE + '/api/owner/history/export.csv', { headers: { Authorization: `Bearer ${opsToken}` } });
    const text = await res.text();
    check('CSV export responds 200 with a CSV content-type', res.status === 200 && (res.headers.get('content-type') || '').includes('csv'));
    check('CSV export contains a header row and at least one real order row', text.startsWith('Order ID,') && text.split('\r\n').length > 1);
    check('CSV export contains an actual order number from this run', text.includes(orderNo));
  }
  { const res = await fetch(BASE + '/api/owner/history/export.pdf', { headers: { Authorization: `Bearer ${opsToken}` } });
    const buf = Buffer.from(await res.arrayBuffer());
    check('PDF export responds 200 with a PDF content-type', res.status === 200 && (res.headers.get('content-type') || '').includes('pdf'));
    check('PDF export is a real, non-empty PDF file (starts with %PDF, >1KB)', buf.slice(0, 4).toString() === '%PDF' && buf.length > 1024);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
