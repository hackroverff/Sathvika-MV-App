'use strict';
/* Requires app.js to have run first (shares State, route(), esc(), money(), t()). */

async function ensureCustomer() {
  if (!API.token('customer')) { navigate('#/customer/login'); return false; }
  if (!State.user) {
    try {
      const { user } = await API.get('/auth/me', 'customer');
      State.user = user;
    } catch (_) {
      API.clearToken('customer');
      navigate('#/customer/login');
      return false;
    }
  }
  return true;
}

function productCardHtml(p) {
  const stockLabel = { in_stock: t('inStock'), low_stock: t('lowStock'), out_of_stock: t('outOfStock') }[p.stockStatus];
  const qty = State.cart[p.id] || 0;
  const disabled = p.stockStatus === 'out_of_stock';
  return `
  <div class="pcard" data-pid="${p.id}">
    <div class="pimg-wrap" data-nav="#/product/${p.id}">
      <img src="${esc(p.image)}" alt="${esc(p.name)}">
      ${p.discountPct > 0 ? `<span class="discount-flag">${p.discountPct}% OFF</span>` : ''}
    </div>
    <div class="pbody">
      <div class="brand">${esc(p.brand)}</div>
      <div class="pname" data-nav="#/product/${p.id}">${esc(p.name)}</div>
      <div class="pack">${esc(p.packSize)}${p.isWholesalePricing ? ` &middot; MOQ ${p.moq}` : ''}</div>
      <div class="price-row">
        <span class="price">${money(p.price)}</span>
        ${p.discountPct > 0 ? `<span class="mrp">${money(p.mrp)}</span>` : ''}
      </div>
      <div class="foot-row">
        <span class="stock-status ${p.stockStatus}"><span class="dot"></span>${esc(stockLabel)}</span>
      </div>
      ${qty > 0
        ? `<div class="stepper" data-pid="${p.id}">
             <button data-cart-action="dec">${icon('minus', 'icon-sm')}</button>
             <span class="qty">${qty}</span>
             <button data-cart-action="inc">${icon('plus', 'icon-sm')}</button>
           </div>`
        : `<button class="add-btn" ${disabled ? 'disabled' : ''} data-cart-action="inc" data-pid="${p.id}">${esc(t('addToCart'))}</button>`}
    </div>
  </div>`;
}

function wireCartButtons(container) {
  container.querySelectorAll('[data-cart-action]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pid = Number(btn.closest('[data-pid]').dataset.pid);
      const product = State.productCache[pid];
      const step = product && product.isWholesalePricing ? product.moq : 1;
      const current = State.cart[pid] || 0;
      if (btn.dataset.cartAction === 'inc') {
        State.cart[pid] = current === 0 ? step : current + 1;
      } else {
        const next = current - 1;
        if (next <= 0) delete State.cart[pid]; else State.cart[pid] = next;
      }
      saveCart();
      render();
    });
  });
}

// ================================================================================
// HOME (branded header + promo + category grid) -- full search/filter browsing
// lives one tap away at #/shop.
// ================================================================================
const CATEGORY_ICON = {
  'Grocery & Staples': 'basket',
  'Beverages': 'cup',
  'Snacks': 'cookie',
  'Dairy & Breakfast': 'milk',
  'Personal Care': 'drop',
  'Household': 'spray',
  'Kitchen Essentials': 'pot',
};
const PROMO_SLIDES = [
  { eyebrow: 'Fresh today', title: 'Daily groceries, delivered fast', body: 'Staples, snacks and dairy from your neighbourhood store.' },
  { eyebrow: 'For businesses', title: 'Wholesale pricing on bulk orders', body: 'Approved business accounts unlock tiered pricing automatically.' },
  { eyebrow: 'Always nearby', title: 'Same-day delivery, Chennai', body: 'Order before evening for same-day delivery to your address.' },
];

route('/home', async () => {
  if (!(await ensureCustomer())) return;
  if (!State.categories.length) {
    const { categories } = await API.get('/catalog/categories');
    State.categories = categories;
  }
  const topCats = State.categories.filter((c) => !c.parent_id);

  const banner = !State.shopOpen
    ? `<div class="error-box">The shop is currently closed. You can browse, but ordering is paused.</div>`
    : State.user.wholesaleStatus === 'pending'
      ? `<div class="pending-banner">${esc(t('pendingWholesale'))}</div>`
      : '';

  root.innerHTML = shellHtml(
    `<div class="screen">
      <div class="search-bar" data-nav="#/shop">${icon('search')}<span class="supporting-text" style="flex:1;">${esc(t('search'))}...</span></div>
      ${banner}
      <div class="promo-banner" id="promoBanner">
        <div class="eyebrow">${esc(PROMO_SLIDES[0].eyebrow)}</div>
        <h2>${esc(PROMO_SLIDES[0].title)}</h2>
        <p>${esc(PROMO_SLIDES[0].body)}</p>
      </div>
      <div class="promo-dots">${PROMO_SLIDES.map((_, i) => `<span class="${i === 0 ? 'active' : ''}"></span>`).join('')}</div>
      <div class="section-heading"><h3 class="section-title" style="margin:0;">Shop by category</h3></div>
      <div class="cat-tile-grid">
        ${topCats.map((c) => `<div class="cat-tile" data-cat="${c.id}">
            <div class="art">${icon(CATEGORY_ICON[c.name] || 'basket')}</div>
            <div class="name">${esc(c.name)}</div>
          </div>`).join('')}
      </div>
    </div>`,
    { topbar: customerAppHeader(), tabbar: customerTabbar('home') }
  );

  document.querySelector('.search-bar').addEventListener('click', () => navigate('#/shop'));
  document.querySelectorAll('[data-cat]').forEach((tile) =>
    tile.addEventListener('click', () => { State.filters.category = tile.dataset.cat; State.filters.q = ''; navigate('#/shop'); })
  );

  // Lightweight auto-rotate for the promo copy -- purely cosmetic, no network cost.
  let idx = 0;
  const banner_el = document.getElementById('promoBanner');
  const dots = document.querySelectorAll('.promo-dots span');
  setInterval(() => {
    idx = (idx + 1) % PROMO_SLIDES.length;
    const s = PROMO_SLIDES[idx];
    banner_el.innerHTML = `<div class="eyebrow">${esc(s.eyebrow)}</div><h2>${esc(s.title)}</h2><p>${esc(s.body)}</p>`;
    dots.forEach((d, i) => d.classList.toggle('active', i === idx));
  }, 3800);
});

route('/shop', async () => {
  if (!(await ensureCustomer())) return;
  const params = new URLSearchParams();
  if (State.filters.category) params.set('category', State.filters.category);
  if (State.filters.q) params.set('q', State.filters.q);
  if (State.filters.brand) params.set('brand', State.filters.brand);

  const [{ categories }, { products, accountType, shopOpen }] = await Promise.all([
    State.categories.length ? Promise.resolve({ categories: State.categories }) : API.get('/catalog/categories'),
    API.get('/catalog/products?' + params.toString(), 'customer'),
  ]);
  State.categories = categories;
  State.accountType = accountType;
  State.shopOpen = shopOpen;
  products.forEach((p) => (State.productCache[p.id] = p));

  const banner = !shopOpen
    ? `<div class="error-box">The shop is currently closed. You can browse, but ordering is paused.</div>`
    : State.user.wholesaleStatus === 'pending'
      ? `<div class="pending-banner">${esc(t('pendingWholesale'))}</div>`
      : accountType === 'wholesale'
        ? `<div class="wholesale-banner">Wholesale pricing active for ${esc(State.user.businessName || '')}</div>`
        : '';

  root.innerHTML = shellHtml(
    `<div class="screen">
      ${banner}
      <div class="search-bar">${icon('search')}<input id="searchBox" placeholder="${esc(t('search'))}" value="${esc(State.filters.q)}"></div>
      <div class="chip-row">
        <button class="chip ${!State.filters.category ? 'active' : ''}" data-cat="">All</button>
        ${categories.filter((c) => !c.parent_id).map((c) => `<button class="chip ${String(State.filters.category) === String(c.id) ? 'active' : ''}" data-cat="${c.id}">${esc(c.name)}</button>`).join('')}
      </div>
      <div class="grid" id="grid">
        ${products.length ? products.map(productCardHtml).join('') : `<div class="empty-state" style="grid-column:1/-1;">${icon('search', 'icon-lg')}<br>No products match.</div>`}
      </div>
    </div>`,
    { topbar: customerTopbar('All Categories', { back: '#/home' }), tabbar: customerTabbar('home') }
  );

  wireCartButtons(document.getElementById('grid'));
  document.querySelectorAll('[data-cat]').forEach((btn) =>
    btn.addEventListener('click', () => { State.filters.category = btn.dataset.cat || null; render(); })
  );
  let searchTimer;
  document.getElementById('searchBox').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const val = e.target.value;
    searchTimer = setTimeout(() => { State.filters.q = val; render(); }, 350);
  });
});

route('/product/:id', async () => {
  if (!(await ensureCustomer())) return;
  const id = Number((matchRoute(window.location.hash).params).id);
  const { product: p } = await API.get(`/catalog/products/${id}`, 'customer');
  State.productCache[p.id] = p;

  root.innerHTML = shellHtml(
    `<div class="screen">
      <div class="pd-image"><img src="${esc(p.image)}" alt="${esc(p.name)}"></div>
      <div class="pd-brand">${esc(p.brand)} &middot; ${esc(p.packSize)}</div>
      <h1 class="pd-title">${esc(p.name)}</h1>
      <div class="pd-price-row"><span class="pd-price">${money(p.price)}</span>${p.discountPct > 0 ? `<span class="pd-mrp">${money(p.mrp)}</span>` : ''}</div>
      ${p.discountPct > 0 ? `<div class="pd-save">${t('youSave')} ${money(p.mrp - p.price)} per unit (${p.discountPct}% off)</div>` : ''}
      <span class="stock-status ${p.stockStatus}"><span class="dot"></span>${esc({ in_stock: t('inStock'), low_stock: t('lowStock'), out_of_stock: t('outOfStock') }[p.stockStatus])}</span>
      ${p.isWholesalePricing ? `<div class="moq-tag" style="margin-top:8px;">Minimum order quantity: ${p.moq}</div>` : ''}
      ${p.isWholesalePricing && p.tiers.length ? `
        <table class="tier-table">
          <tr><th>Quantity</th><th>Unit price</th></tr>
          ${p.tiers.map((tr) => `<tr><td>${tr.min_qty}${tr.max_qty ? '\u2013' + tr.max_qty : '+'}</td><td>${money(tr.unit_price)}</td></tr>`).join('')}
        </table>` : ''}
      <div id="stepperHolder"></div>
    </div>`,
    { topbar: customerTopbar(p.name, { back: '#/shop' }), tabbar: customerTabbar('home') }
  );

  function renderStepper() {
    const q = State.cart[p.id] || 0;
    document.getElementById('stepperHolder').innerHTML = q > 0
      ? `<div class="stepper" style="margin-top:18px;height:44px;"><button data-act="dec">${icon('minus')}</button><span class="qty">${q}</span><button data-act="inc">${icon('plus')}</button></div>`
      : `<button class="btn btn-primary" style="margin-top:18px;" data-act="inc" ${p.stockStatus === 'out_of_stock' ? 'disabled' : ''}>${esc(t('addToCart'))}</button>`;
    document.querySelectorAll('[data-act]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const step = p.isWholesalePricing ? p.moq : 1;
        const current = State.cart[p.id] || 0;
        if (btn.dataset.act === 'inc') State.cart[p.id] = current === 0 ? step : current + 1;
        else { const next = current - 1; if (next <= 0) delete State.cart[p.id]; else State.cart[p.id] = next; }
        saveCart();
        renderStepper();
        updateCartBadge();
      })
    );
  }
  renderStepper();
});

function updateCartBadge() {
  document.querySelectorAll('.tabbar .badge, .topbar .badge, .app-header .badge').forEach((b) => b.remove());
  const count = cartCount();
  if (!count) return;
  document.querySelectorAll('[data-nav="#/cart"]').forEach((el) => {
    const top = el.closest('.tabbar') ? '-2px' : '-4px';
    el.insertAdjacentHTML('beforeend', `<span class="badge" style="top:${top};">${count}</span>`);
  });
}

// ---- Cart ----------------------------------------------------------------------
async function fetchQuote() {
  const items = Object.entries(State.cart).map(([productId, qty]) => ({ productId: Number(productId), qty }));
  if (items.length === 0) return { lines: [], subtotal: 0, discount: 0, deliveryCharge: 0, total: 0, minOrder: 70, meetsMinimum: true };
  return API.post('/catalog/quote', { items }, 'customer');
}

route('/cart', async () => {
  if (!(await ensureCustomer())) return;
  let quote;
  let quoteError = null;
  try {
    quote = await fetchQuote();
  } catch (err) {
    quoteError = err.message;
    quote = { lines: [], subtotal: 0, discount: 0, deliveryCharge: 0, total: 0, minOrder: 70, meetsMinimum: false };
  }

  const isEmpty = Object.keys(State.cart).length === 0;

  root.innerHTML = shellHtml(
    `<div class="screen no-tabbar">
      ${quoteError ? `<div class="error-box">${esc(quoteError)}</div>` : ''}
      ${isEmpty
        ? `<div class="empty-state">${icon('cart', 'icon-lg')}<p style="margin-top:var(--space-3);">Your cart is empty.</p><button class="btn btn-outline" style="margin-top:var(--space-2);width:auto;padding:10px 20px;" data-nav="#/shop">Browse products</button></div>`
        : `
        <div class="card" id="lines" style="padding-top:4px;padding-bottom:0;">
          ${quote.lines.map((l) => `
            <div class="cart-line" data-pid="${l.productId}">
              <img src="${esc((State.productCache[l.productId] || {}).image || '')}" alt="">
              <div class="info">
                <div class="n">${esc(l.name)}</div>
                <div class="p">${esc(l.packSize)} &middot; ${l.qty} &times; ${money(l.unitPrice)}${l.tierLabel ? ` (tier ${l.tierLabel})` : ''}</div>
                <button class="remove-link" data-remove="${l.productId}">Remove</button>
              </div>
              <div class="line-total">${money(l.lineTotal)}</div>
            </div>`).join('')}
        </div>
        <h3 class="section-title">Order summary</h3>
        <div class="summary-card">
          <div class="summary-row"><span>${t('subtotal')}</span><span>${money(quote.subtotal)}</span></div>
          ${quote.discount > 0 ? `<div class="summary-row"><span>${t('youSave')}</span><span class="save">-${money(quote.discount)}</span></div>` : ''}
          <div class="summary-row"><span>${t('deliveryCharge')}</span><span>${quote.deliveryCharge > 0 ? money(quote.deliveryCharge) : 'Free'}</span></div>
          <div class="summary-row total"><span>${t('total')}</span><span>${money(quote.total)}</span></div>
        </div>
        ${!quote.meetsMinimum ? `<div class="min-order-note">${t('minOrderNote')} is ${money(quote.minOrder)}. Add ${money(quote.minOrder - quote.subtotal)} more.</div>` : ''}
        <button class="btn btn-primary" style="margin-top:var(--space-4);" id="toCheckout" ${!quote.meetsMinimum ? 'disabled' : ''}>${esc(t('checkout'))}</button>
        `}
    </div>`,
    { topbar: customerTopbar(t('cart'), { back: '#/shop', hideCart: true }) }
  );

  document.querySelectorAll('[data-remove]').forEach((btn) =>
    btn.addEventListener('click', () => { delete State.cart[Number(btn.dataset.remove)]; saveCart(); render(); })
  );
  const goBtn = document.getElementById('toCheckout');
  if (goBtn) goBtn.addEventListener('click', () => navigate('#/checkout'));
});

// ---- Checkout --------------------------------------------------------------------
const PAY_LABELS = { gpay: 'GPay', phonepe: 'PhonePe', paytm: 'Paytm', upi: 'Other UPI', cod: 'Cash on Delivery' };

route('/checkout', async () => {
  if (!(await ensureCustomer())) return;
  if (Object.keys(State.cart).length === 0) return navigate('#/cart');

  const [{ addresses }, quote] = await Promise.all([API.get('/orders/addresses', 'customer'), fetchQuote()]);

  root.innerHTML = shellHtml(
    `<div class="screen no-tabbar">
      <h3 class="section-title">${esc(t('deliveryAddress'))}</h3>
      <div id="addrList">
        ${addresses.map((a) => `
          <label class="card" style="display:flex;gap:var(--space-3);align-items:flex-start;cursor:pointer;">
            <input type="radio" name="addr" value="${a.id}" ${a.is_default ? 'checked' : ''} style="margin-top:3px;">
            <span><b>${esc(a.label)}</b>${a.is_business ? ' (Business)' : ''}<br><span class="supporting-text">${esc(a.line1)}${a.line2 ? ', ' + esc(a.line2) : ''}, ${esc(a.city)} ${esc(a.pincode)}</span></span>
          </label>`).join('') || '<p class="supporting-text">No saved address yet.</p>'}
      </div>
      <button class="btn btn-outline" id="addAddrBtn" style="margin-bottom:var(--space-4);">+ Add new address</button>
      <div id="addAddrForm" style="display:none;">
        <div class="field"><label>Label</label><input name="label" value="Home"></div>
        <div class="field"><label>Address line</label><input name="line1" required></div>
        <div class="field"><label>Landmark / area</label><input name="line2"></div>
        <div class="field"><label>City</label><input name="city" value="Chennai"></div>
        <div class="field"><label>Pincode</label><input name="pincode" required maxlength="6"></div>
        ${State.accountType === 'wholesale' ? '<label class="supporting-text" style="display:flex;gap:6px;align-items:center;"><input type="checkbox" name="isBusiness"> This is my business address</label>' : ''}
        <button class="btn btn-primary" id="saveAddrBtn" type="button" style="margin-top:var(--space-3);">Save address</button>
      </div>

      <h3 class="section-title">${esc(t('paymentMethod'))}</h3>
      <div class="tabs" id="payTabs" style="flex-wrap:wrap;">
        ${Object.keys(PAY_LABELS).map((m, i) => `<button type="button" data-pay="${m}" class="${i === 0 ? 'active' : ''}">${PAY_LABELS[m]}</button>`).join('')}
      </div>

      <h3 class="section-title">Order summary</h3>
      <div class="summary-card">
        <div class="summary-row"><span>${t('subtotal')}</span><span>${money(quote.subtotal)}</span></div>
        ${quote.discount > 0 ? `<div class="summary-row"><span>${t('youSave')}</span><span class="save">-${money(quote.discount)}</span></div>` : ''}
        <div class="summary-row"><span>${t('deliveryCharge')}</span><span>${quote.deliveryCharge > 0 ? money(quote.deliveryCharge) : 'Free'}</span></div>
        <div class="summary-row total"><span>${t('total')}</span><span>${money(quote.total)}</span></div>
      </div>
      <div id="err"></div>
      <button class="btn btn-primary" id="placeOrderBtn" style="margin-top:var(--space-4);">${esc(t('placeOrder'))}</button>
    </div>`,
    { topbar: customerTopbar(t('checkout'), { back: '#/cart', hideCart: true }) }
  );

  let selectedPay = 'gpay';
  document.getElementById('payTabs').querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => {
      document.querySelectorAll('#payTabs button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      selectedPay = b.dataset.pay;
    })
  );

  document.getElementById('addAddrBtn').addEventListener('click', () => {
    document.getElementById('addAddrForm').style.display = 'block';
  });
  document.getElementById('saveAddrBtn').addEventListener('click', async () => {
    const form = document.getElementById('addAddrForm');
    const get = (n) => form.querySelector(`[name=${n}]`);
    try {
      await API.post('/orders/addresses', {
        label: get('label').value, line1: get('line1').value, line2: get('line2').value,
        city: get('city').value, pincode: get('pincode').value, isDefault: true,
        isBusiness: get('isBusiness') ? get('isBusiness').checked : false,
      }, 'customer');
      render();
    } catch (err) {
      document.getElementById('err').innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
    }
  });

  document.getElementById('placeOrderBtn').addEventListener('click', async () => {
    const addrRadio = document.querySelector('[name=addr]:checked');
    if (!addrRadio) { document.getElementById('err').innerHTML = `<div class="error-box">Choose a delivery address.</div>`; return; }
    const items = Object.entries(State.cart).map(([productId, qty]) => ({ productId: Number(productId), qty }));
    try {
      const res = await API.post('/orders/checkout', { items, addressId: Number(addrRadio.value), paymentMethod: selectedPay }, 'customer');
      State.cart = {};
      saveCart();
      sessionStorage.setItem('smv_last_order', JSON.stringify(res));
      navigate('#/order-confirmed');
    } catch (err) {
      document.getElementById('err').innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
    }
  });
});

route('/order-confirmed', () => {
  const res = JSON.parse(sessionStorage.getItem('smv_last_order') || '{}');
  const hasUpi = !!(res.upiLink && res.paymentMethod !== 'cod');
  root.innerHTML = shellHtml(
    `<div class="screen no-tabbar center" style="padding-top:40px;">
      <div style="color:var(--success);margin-bottom:var(--space-3);">${icon('checkCircle', 'icon-lg')}</div>
      <h2 class="page-title">Order placed!</h2>
      <p class="supporting-text" style="margin-top:var(--space-2);">Order number</p>
      <p class="page-title" style="font-size:var(--text-lg);">${esc(res.orderNo || '')}</p>

      ${hasUpi ? `
        <div class="card" style="text-align:center;margin-top:var(--space-5);">
          <h3 class="section-title" style="margin-bottom:var(--space-1);">Scan to Pay</h3>
          ${res.upiQrDataUrl
            ? `<img src="${res.upiQrDataUrl}" alt="UPI payment QR code" style="width:220px;height:220px;margin:var(--space-3) auto;border-radius:var(--radius-md);border:1px solid var(--border);">`
            : `<div class="error-box">Could not generate a QR code right now.</div>`}
          <div class="eyebrow" style="margin-top:var(--space-2);">Amount to pay</div>
          <div class="page-title" style="font-size:var(--text-2xl);color:var(--brand);">${money(res.total)}</div>
          <p class="supporting-text" style="margin-top:var(--space-2);">Scan using GPay, PhonePe, Paytm, BHIM, or any UPI app</p>
          <a class="btn btn-primary" style="margin-top:var(--space-3);" href="${esc(res.upiLink)}">Or tap to pay on this phone</a>
          <p class="metadata" style="margin-top:var(--space-3);">Order: ${esc(res.orderNo || '')}</p>
        </div>
      ` : `<p class="price-text" style="font-size:var(--text-lg);margin-top:var(--space-4);">Total: ${money(res.total || 0)}</p>`}

      <p class="supporting-text" style="margin-top:var(--space-4);">Estimated: ~${esc(res.estimatedMinutes || 45)} minutes</p>
      <button class="btn btn-primary" style="margin-top:var(--space-3);" data-nav="#/orders">View orders</button>
      <button class="btn btn-outline" style="margin-top:var(--space-2);" data-nav="#/shop">Continue shopping</button>
    </div>`,
    {}
  );
});

// ---- Orders + reorder --------------------------------------------------------------
route('/orders', async () => {
  if (!(await ensureCustomer())) return;
  const { orders } = await API.get('/orders', 'customer');
  root.innerHTML = shellHtml(
    `<div class="screen">
      ${orders.length === 0 ? `<div class="empty-state">${icon('package', 'icon-lg')}<p style="margin-top:var(--space-3);">No orders yet.</p></div>` : orders.map(orderCardHtml).join('')}
    </div>`,
    { topbar: customerTopbar(t('orders'), { hideCart: true }), tabbar: customerTabbar('orders') }
  );
  document.querySelectorAll('[data-reorder]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      try {
        const res = await API.post(`/orders/${btn.dataset.reorder}/reorder`, {}, 'customer');
        res.cartItems.forEach((i) => (State.cart[i.productId] = i.qty));
        saveCart();
        navigate('#/cart');
      } catch (err) {
        alert(err.message);
      }
    })
  );
});

function orderCardHtml(o) {
  const statusLabel = o.status.replace(/_/g, ' ');
  return `
  <div class="card order-card">
    <div class="head"><span class="oid">${esc(o.orderNo)}</span><span class="status-pill status-${o.status}">${esc(statusLabel)}</span></div>
    <div class="items">${o.items.map((i) => `${i.qty}\u00d7 ${esc(i.name_snapshot)}`).join(', ')}</div>
    <div class="foot">
      <span class="total">${money(o.total)}</span>
      ${o.status !== 'cancelled' ? `<button class="btn btn-outline btn-sm" data-reorder="${o.id}">${esc(t('reorder'))}</button>` : ''}
    </div>
  </div>`;
}

// ---- Profile -----------------------------------------------------------------------
route('/profile', async () => {
  if (!(await ensureCustomer())) return;
  const u = State.user;
  const wsPillStatus = u.wholesaleStatus === 'approved' ? 'delivered' : (u.wholesaleStatus === 'rejected' || u.wholesaleStatus === 'suspended') ? 'cancelled' : 'placed';
  root.innerHTML = shellHtml(
    `<div class="screen">
      <div class="card" style="display:flex;gap:var(--space-3);align-items:center;">
        <div class="choice-card" style="padding:0;border:none;box-shadow:none;background:none;flex-shrink:0;">
          <div class="icon-wrap" style="width:52px;height:52px;">${icon('user', 'icon-lg')}</div>
        </div>
        <div style="min-width:0;">
          <div class="page-title" style="font-size:var(--text-lg);">${esc(u.fullName)}</div>
          <div class="supporting-text">${esc(u.mobile)}</div>
          <div style="margin-top:var(--space-2);display:flex;gap:var(--space-2);flex-wrap:wrap;">
            <span class="status-pill status-confirmed">${u.role === 'wholesale' ? t('wholesale') : t('retail')}</span>
            ${u.role === 'wholesale' ? `<span class="status-pill status-${wsPillStatus}">${esc(u.wholesaleStatus)}</span>` : ''}
          </div>
        </div>
      </div>
      ${u.role === 'wholesale' ? `<p class="supporting-text" style="margin:-4px 0 var(--space-3);">${esc(u.businessName || '')} &middot; ${esc(u.businessType || '')}</p>` : ''}

      <h3 class="section-title">Orders</h3>
      <div class="card table-list" style="padding-top:2px;padding-bottom:2px;">
        <div class="row" data-nav="#/orders" style="cursor:pointer;"><span style="display:flex;align-items:center;gap:10px;">${icon('package', 'icon-sm')}My Orders</span>${icon('chevronRight', 'icon-sm')}</div>
      </div>

      <h3 class="section-title">Saved information</h3>
      <div class="card table-list" style="padding-top:2px;padding-bottom:2px;">
        <div class="row" data-nav="#/profile/addresses" style="cursor:pointer;"><span style="display:flex;align-items:center;gap:10px;">${icon('map', 'icon-sm')}Saved Addresses</span>${icon('chevronRight', 'icon-sm')}</div>
      </div>

      <h3 class="section-title">Preferences</h3>
      <div class="card" style="display:flex;flex-direction:column;gap:var(--space-3);">
        <div class="theme-toggle-row">
          <span style="font-weight:600;font-size:var(--text-sm);">Language</span>
          <div class="lang-toggle" style="margin:0;">
            <button data-lang="en" class="${I18N.lang === 'en' ? 'active' : ''}">English</button>
            <button data-lang="ta" class="${I18N.lang === 'ta' ? 'active' : ''}">\u0BA4\u0BAE\u0BBF\u0BB4\u0BCD</button>
          </div>
        </div>
        <div class="theme-toggle-row">
          <span style="display:flex;align-items:center;gap:6px;font-weight:600;font-size:var(--text-sm);">${icon('moon', 'icon-sm')}Dark mode</span>
          <label class="switch"><input type="checkbox" id="themeSwitch" ${currentTheme() === 'dark' ? 'checked' : ''}><span class="slider"></span></label>
        </div>
      </div>

      <h3 class="section-title">Support</h3>
      <div class="card table-list" style="padding-top:2px;padding-bottom:2px;">
        <a class="row" href="https://wa.me/919841305605" target="_blank" rel="noopener" style="cursor:pointer;color:inherit;"><span style="display:flex;align-items:center;gap:10px;">${icon('whatsapp', 'icon-sm')}Help &amp; Support (WhatsApp)</span>${icon('chevronRight', 'icon-sm')}</a>
      </div>

      <h3 class="section-title">About</h3>
      <div class="card">
        <div style="display:flex;align-items:center;gap:var(--space-3);">
          <div class="logo-chip" style="width:40px;height:40px;"><img src="/img/brand/logo.png" alt="Sathvika MV"></div>
          <div>
            <div style="font-weight:700;">${esc(t('appName'))}</div>
            <div class="metadata">Version 1.0 &middot; Thousand Lights, Chennai</div>
          </div>
        </div>
      </div>

      <button class="btn btn-danger" id="logoutBtn" style="margin-top:var(--space-2);">${esc(t('logout'))}</button>
    </div>`,
    { topbar: customerTopbar(t('profile'), { hideCart: true }), tabbar: customerTabbar('profile') }
  );
  root.querySelectorAll('[data-lang]').forEach((btn) => btn.addEventListener('click', () => { I18N.setLang(btn.dataset.lang); render(); }));
  document.getElementById('themeSwitch').addEventListener('change', (e) => applyTheme(e.target.checked ? 'dark' : 'light'));
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try { await API.post('/auth/logout', {}, 'customer'); } catch (_) {}
    API.clearToken('customer');
    State.user = null;
    navigate('#/landing');
  });
});

// ---- Saved addresses (real CRUD against the existing backend) ----------------------
route('/profile/addresses', async () => {
  if (!(await ensureCustomer())) return;
  const { addresses } = await API.get('/orders/addresses', 'customer');
  root.innerHTML = shellHtml(
    `<div class="screen no-tabbar">
      ${addresses.length === 0 ? `<p class="supporting-text">No saved addresses yet.</p>` : addresses.map((a) => `
        <div class="card" data-aid="${a.id}" style="display:flex;justify-content:space-between;align-items:flex-start;gap:var(--space-3);">
          <div><b>${esc(a.label)}</b>${a.is_default ? ' <span class="status-pill status-delivered">Default</span>' : ''}${a.is_business ? ' <span class="status-pill status-confirmed">Business</span>' : ''}
            <div class="supporting-text" style="margin-top:2px;">${esc(a.line1)}${a.line2 ? ', ' + esc(a.line2) : ''}, ${esc(a.city)} ${esc(a.pincode)}</div>
          </div>
          <button class="remove-link" data-del-addr="${a.id}">Remove</button>
        </div>`).join('')}
      <button class="btn btn-outline" id="addAddrBtn2" style="margin-top:var(--space-2);">+ Add new address</button>
      <div id="addAddrForm2" style="display:none;margin-top:var(--space-4);">
        <div class="field"><label>Label</label><input name="label" value="Home"></div>
        <div class="field"><label>Address line</label><input name="line1" required></div>
        <div class="field"><label>Landmark / area</label><input name="line2"></div>
        <div class="field"><label>City</label><input name="city" value="Chennai"></div>
        <div class="field"><label>Pincode</label><input name="pincode" required maxlength="6"></div>
        <div id="addrErr2"></div>
        <button class="btn btn-primary" id="saveAddrBtn2" type="button">Save address</button>
      </div>
    </div>`,
    { topbar: customerTopbar('Saved Addresses', { back: '#/profile', hideCart: true }) }
  );
  document.querySelectorAll('[data-del-addr]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      await API.del(`/orders/addresses/${btn.dataset.delAddr}`, 'customer');
      render();
    })
  );
  document.getElementById('addAddrBtn2').addEventListener('click', () => { document.getElementById('addAddrForm2').style.display = 'block'; });
  document.getElementById('saveAddrBtn2').addEventListener('click', async () => {
    const form = document.getElementById('addAddrForm2');
    const get = (n) => form.querySelector(`[name=${n}]`);
    try {
      await API.post('/orders/addresses', {
        label: get('label').value, line1: get('line1').value, line2: get('line2').value,
        city: get('city').value, pincode: get('pincode').value, isDefault: addresses.length === 0,
      }, 'customer');
      render();
    } catch (err) {
      document.getElementById('addrErr2').innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
    }
  });
});
