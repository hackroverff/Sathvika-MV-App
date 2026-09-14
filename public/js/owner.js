'use strict';
/* Owner console. Two auth scopes:
 *  - owner_ops  (PIN)      -> day-to-day: dashboard, order status, view-only lists
 *  - owner_admin (password) -> sensitive: edit prices/products, approve wholesale,
 *                               change minimum order value
 * requireAdminThen() below is the single choke point that asks for the owner
 * password when an ops-scoped screen tries a sensitive action -- see
 * HANDOFF.md "Owner auth scopes" for why this is a modal rather than a
 * full re-login. */

function ownerNavHtml() {
  return `
  <div class="owner-dropdown-backdrop modal-backdrop" id="ownerNavSheet" style="display:none;">
    <div class="owner-dropdown">
      <button data-nav="#/owner/dashboard">${icon('dashboard', 'icon-sm')}Dashboard</button>
      <button data-nav="#/owner/menu">${icon('clipboard', 'icon-sm')}Menu List</button>
      <button data-nav="#/owner/approvals">${icon('checkCircle', 'icon-sm')}Wholesale Approvals</button>
      <button data-nav="#/owner/payments">${icon('card', 'icon-sm')}Online Payment Update</button>
      <button data-nav="#/owner/history">${icon('history', 'icon-sm')}History</button>
      <div class="theme-row">
        <div class="theme-toggle-row">
          <span style="display:flex;align-items:center;gap:6px;font-weight:600;font-size:13px;">${icon('moon', 'icon-sm')}Dark mode</span>
          <label class="switch"><input type="checkbox" id="ownerThemeSwitch" ${currentTheme() === 'dark' ? 'checked' : ''}><span class="slider"></span></label>
        </div>
      </div>
      <button class="logout-item" id="ownerLogoutBtn">${icon('logout', 'icon-sm')}Logout</button>
    </div>
  </div>`;
}

// Dashboard gets a small brand lockup (the one place owner branding shows);
// every other owner screen is back+title+actions, consistent with "don't
// duplicate the logo everywhere."
function ownerDashboardHeader() {
  return `<div class="app-header">
    <div class="brand-lockup">
      <div class="logo-chip" style="width:30px;height:30px;"><img src="/img/brand/logo.png" alt="Sathvika MV"></div>
      <div>
        <div class="brand-name" style="font-size:var(--text-base);">${esc(t('appName'))}</div>
        <div class="brand-sub">Owner dashboard</div>
      </div>
    </div>
    <span class="live-dot" title="Live"></span>
    <button class="icon-btn" id="openOwnerNav" style="margin-left:2px;">${icon('dots', 'icon-sm')}</button>
  </div>`;
}

function ownerTopbar(title) {
  return `<div class="topbar"><button class="icon-btn" data-nav="#/owner/dashboard">${icon('chevronLeft', 'icon-sm')}</button><div class="title">${esc(title)}</div><button class="icon-btn" id="openOwnerNav">${icon('dots', 'icon-sm')}</button></div>`;
}

function wireOwnerChrome() {
  document.querySelectorAll('#ownerNavSheet').forEach((el) => el.remove()); // no duplicates across renders
  document.body.insertAdjacentHTML('beforeend', ownerNavHtml());
  const sheet = document.getElementById('ownerNavSheet');
  const openBtn = document.getElementById('openOwnerNav');
  if (openBtn) openBtn.addEventListener('click', () => (sheet.style.display = sheet.style.display === 'block' ? 'none' : 'block'));
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.style.display = 'none'; });
  document.getElementById('ownerThemeSwitch').addEventListener('change', (e) => applyTheme(e.target.checked ? 'dark' : 'light'));
  document.getElementById('ownerLogoutBtn').addEventListener('click', async () => {
    try { await API.post('/owner/logout', {}, 'owner'); } catch (_) {}
    API.clearToken('owner');
    State.ownerScope = null;
    navigate('#/landing');
  });
}

// Ask for the owner password inline (modal), then run `action`. Used for any
// sensitive call attempted from an ops-scoped screen.
function requireAdminThen(action) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <div class="modal-sheet">
      <h3>Owner password required</h3>
      <p class="supporting-text">This action changes prices, products, or wholesale approvals.</p>
      <div id="adminErr"></div>
      <div class="field">
        <label>Owner password</label>
        <div style="display:flex;gap:var(--space-2);">
          <input type="password" id="adminPwInput" name="smv_owner_pw_${Date.now()}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" style="flex:1;" autofocus>
          <button type="button" class="btn btn-outline btn-sm" id="adminPwShow" style="width:auto;">Show</button>
        </div>
      </div>
      <button class="btn btn-primary" id="adminPwGo">Confirm</button>
      <button class="btn btn-outline" id="adminPwCancel" style="margin-top:var(--space-2);">Cancel</button>
    </div>`;
  document.body.appendChild(wrap);
  const input = document.getElementById('adminPwInput');
  document.getElementById('adminPwShow').addEventListener('click', (e) => {
    input.type = input.type === 'password' ? 'text' : 'password';
    e.currentTarget.textContent = input.type === 'password' ? 'Show' : 'Hide';
  });
  document.getElementById('adminPwCancel').addEventListener('click', () => wrap.remove());
  async function submit() {
    // .trim() guards against a leading/trailing space a mobile keyboard can
    // silently insert; autocomplete/autocorrect are disabled above so a
    // password manager or predictive text can't substitute a different
    // saved value without the owner noticing.
    const pw = input.value.trim();
    try {
      const data = await API.post('/owner/login/password', { password: pw });
      API.setToken('owner', data.token); // escalate: admin token supersedes ops token for this device
      State.ownerScope = 'owner_admin';
      wrap.remove();
      await action();
    } catch (err) {
      document.getElementById('adminErr').innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
    }
  }
  document.getElementById('adminPwGo').addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}

async function ensureOwner() {
  if (!API.token('owner')) { navigate('#/owner/login'); return false; }
  return true;
}

// ================================================================================
// LOGIN (PIN pad)
// ================================================================================
route('/owner/login', () => {
  let entered = '';
  function renderPad() {
    document.getElementById('pinDots').innerHTML = Array.from({ length: 6 }).map((_, i) => `<span class="${i < entered.length ? 'filled' : ''}"></span>`).join('');
  }
  root.innerHTML = shellHtml(
    `<div class="screen no-tabbar">
      <p class="center supporting-text">Enter your 4-6 digit PIN for the counter dashboard.</p>
      <div class="pin-dots" id="pinDots"></div>
      <div id="err"></div>
      <div class="pin-pad" id="pinPad">
        ${[1,2,3,4,5,6,7,8,9].map((n) => `<button data-k="${n}">${n}</button>`).join('')}
        <button data-k="clear">C</button><button data-k="0">0</button><button data-k="back">${icon('chevronLeft', 'icon-sm')}</button>
      </div>
      <p class="hint center">Demo PIN: 4321</p>
    </div>`,
    { topbar: customerTopbar('Owner PIN', { back: '#/landing', hideCart: true }) }
  );
  renderPad();
  document.getElementById('pinPad').addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const k = btn.dataset.k;
    if (k === 'clear') entered = '';
    else if (k === 'back') entered = entered.slice(0, -1);
    else if (entered.length < 6) entered += k;
    renderPad();
    if (entered.length >= 4) {
      try {
        const data = await API.post('/owner/login/pin', { pin: entered });
        API.setToken('owner', data.token);
        State.ownerScope = 'owner_ops';
        navigate('#/owner/dashboard');
      } catch (err) {
        if (entered.length === 6) {
          document.getElementById('err').innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
          entered = '';
          renderPad();
        }
      }
    }
  });
});

// ================================================================================
// DASHBOARD
// ================================================================================
route('/owner/dashboard', async () => {
  if (!(await ensureOwner())) return;
  const data = await API.get('/owner/dashboard', 'owner');

  root.innerHTML = shellHtml(
    `<div class="screen no-tabbar">
      <div class="owner-header">
        <span class="supporting-text">Shop status</span>
        <div class="shop-status-toggle">
          <span class="shop-status-label ${data.shopOpen ? 'open' : 'closed'}" id="shopStatusLabel">${data.shopOpen ? 'Open' : 'Closed'}</span>
          <label class="switch"><input type="checkbox" id="shopToggle" ${data.shopOpen ? 'checked' : ''}><span class="slider"></span></label>
        </div>
      </div>
      ${data.lowStockAlerts.length ? `<div class="low-stock-banner">${icon('warning', 'icon-sm')} Low stock: ${data.lowStockAlerts.map((p) => esc(p.name)).join(', ')}</div>` : ''}
      <div class="kpi-grid">
        <div class="kpi k1"><div class="icon-badge">${icon('clipboard', 'icon-sm')}</div><div class="label">Shift Orders</div><div class="value">${data.summary.shiftOrders}</div></div>
        <div class="kpi k2"><div class="icon-badge">${icon('card', 'icon-sm')}</div><div class="label">Online Received</div><div class="value">${money(data.summary.onlineReceived)}</div></div>
        <div class="kpi k3"><div class="icon-badge">${icon('history', 'icon-sm')}</div><div class="label">Grand Total</div><div class="value">${money(data.summary.grandTotal)}</div></div>
        <div class="kpi k4"><div class="icon-badge">${icon('checkCircle', 'icon-sm')}</div><div class="label">COD Received</div><div class="value">${money(data.summary.codReceived)}</div></div>
      </div>
      <h3 class="section-title">Current shift orders</h3>
      <div id="orderList">
        ${data.orders.length === 0 ? '<p class="supporting-text">No orders yet this shift.</p>' : data.orders.map(shiftOrderCardHtml).join('')}
      </div>
    </div>`,
    { topbar: ownerDashboardHeader() }
  );
  wireOwnerChrome();

  document.getElementById('shopToggle').addEventListener('change', async (e) => {
    await API.post('/owner/shop-status', { open: e.target.checked }, 'owner');
    render();
  });

  wireShiftOrderActions();
});

const STATUS_FLOW = ['placed', 'confirmed', 'preparing', 'out_for_delivery', 'delivered'];

function shiftOrderCardHtml(o) {
  const stepIdx = STATUS_FLOW.indexOf(o.status);
  const stepLabels = ['Placed', 'Confirmed', 'Preparing', 'Out for delivery', 'Delivered'];
  return `
  <div class="card order-card" data-oid="${o.id}">
    <div class="head"><span class="oid">${esc(o.orderNo)}</span><span class="status-pill status-${o.status}">${o.status.replace(/_/g, ' ')}</span></div>
    <div class="items">${esc(o.addressLine)}</div>
    <div class="foot"><span class="total">${money(o.total)} &middot; ${o.paymentMethod.toUpperCase()}</span>
      ${o.mapsQuery ? `<a class="btn btn-outline btn-sm" href="https://www.google.com/maps/dir/?api=1&destination=${o.mapsQuery}&travelmode=driving" target="_blank" rel="noopener">${icon('map', 'icon-sm')} Navigate</a>` : ''}
    </div>
    ${o.status !== 'cancelled' && o.status !== 'delivered' ? `
      <div class="status-stepper">
        ${STATUS_FLOW.map((s, i) => `
          <div class="step ${i < stepIdx ? 'done' : ''} ${i === stepIdx ? 'current' : ''}">
            <button class="dot" data-set-status="${s}">${i < stepIdx ? icon('check', 'icon-sm') : i + 1}</button>
            <span class="lbl">${stepLabels[i]}</span>
          </div>`).join('')}
      </div>
      <button class="void-link" data-void="1">Void this order</button>` : ''}
  </div>`;
}

function wireShiftOrderActions() {
  document.querySelectorAll('[data-set-status]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const oid = btn.closest('[data-oid]').dataset.oid;
      try {
        await API.post(`/owner/orders/${oid}/status`, { status: btn.dataset.setStatus }, 'owner');
        render();
      } catch (err) { alert(err.message); }
    })
  );
  document.querySelectorAll('[data-void]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const oid = btn.closest('[data-oid]').dataset.oid;
      const reason = prompt('Reason for voiding this order:');
      if (!reason) return;
      try {
        await API.post(`/owner/orders/${oid}/void`, { reason }, 'owner');
        render();
      } catch (err) { alert(err.message); }
    })
  );
}

// ================================================================================
// MENU MANAGEMENT
// ================================================================================
route('/owner/menu', async () => {
  if (!(await ensureOwner())) return;
  const [{ products }, { categories }] = await Promise.all([
    API.get('/owner/menu/products', 'owner'),
    API.get('/owner/menu/categories', 'owner'),
  ]);

  root.innerHTML = shellHtml(
    `<div class="screen no-tabbar">
      <button class="btn btn-primary" id="addProductBtn" style="margin-bottom:var(--space-4);">${icon('plus', 'icon-sm')} Add product</button>
      <div class="table-list">
        ${products.map((p) => `
          <div class="row" data-pid="${p.id}">
            <span>${esc(p.name)} <span class="muted">(${esc(p.pack_size)})</span><br><span class="metadata">Stock: ${p.stock_qty} &middot; Retail ${money(p.retail_price)} &middot; Wholesale ${money(p.wholesale_base_price)}</span></span>
            <span><button class="btn btn-outline btn-sm" data-edit="${p.id}">Edit</button></span>
          </div>`).join('')}
      </div>
      <div id="productModalHolder"></div>
    </div>`,
    { topbar: ownerTopbar('Menu List') }
  );
  wireOwnerChrome();

  document.getElementById('addProductBtn').addEventListener('click', () => openProductModal(null, categories));
  document.querySelectorAll('[data-edit]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const p = products.find((x) => x.id === Number(btn.dataset.edit));
      openProductModal(p, categories);
    })
  );
});

function openProductModal(product, categories) {
  const isEdit = !!product;
  let pendingPhotoDataUrl = null; // used only on create -- there's no product id to upload against yet
  const holder = document.getElementById('productModalHolder');
  holder.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal-sheet">
        <h3>${isEdit ? 'Edit product' : 'Add product'}</h3>
        <div id="pmErr"></div>
        <div class="field"><label>Photo</label>
          <div style="display:flex;align-items:center;gap:var(--space-3);">
            <img id="pm_photo_preview" src="${esc(product?.image || '')}" style="width:64px;height:64px;border-radius:var(--radius-md);object-fit:cover;background:var(--surface-sunken);border:1px solid var(--border);">
            <input type="file" id="pm_photo_file" accept="image/png,image/jpeg,image/webp" style="flex:1;">
          </div>
          <p class="hint">${isEdit ? 'Take or choose a real photo of this product. Saves immediately (needs owner password).' : 'Preview now, uploaded automatically when you save this new product.'}</p>
        </div>
        <div class="field"><label>Name</label><input id="pm_name" value="${esc(product?.name || '')}"></div>
        <div class="field"><label>Brand</label><input id="pm_brand" value="${esc(product?.brand || 'Local')}"></div>
        <div class="field"><label>Category</label>
          <select id="pm_category">${categories.filter((c) => !c.parent_id).map((c) => `<option value="${c.id}" ${product?.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Pack size</label><input id="pm_pack" value="${esc(product?.pack_size || '')}"></div>
        <div class="field"><label>Unit</label>
          <select id="pm_unit">${['kg','g','litre','ml','piece','packet','box','dozen'].map((u) => `<option value="${u}" ${product?.unit === u ? 'selected' : ''}>${u}</option>`).join('')}</select>
        </div>
        <div class="field"><label>MRP</label><input id="pm_mrp" type="number" step="0.01" value="${product?.mrp ?? ''}"></div>
        <div class="field"><label>Retail selling price</label><input id="pm_retail" type="number" step="0.01" value="${product?.retail_price ?? ''}"></div>
        <div class="field"><label>Wholesale base price</label><input id="pm_wholesale" type="number" step="0.01" value="${product?.wholesale_base_price ?? ''}"></div>
        <div class="field"><label>MOQ (wholesale)</label><input id="pm_moq" type="number" value="${product?.moq ?? 1}"></div>
        <div class="field"><label>Stock quantity</label><input id="pm_stock" type="number" value="${product?.stock_qty ?? 0}"></div>
        <div class="field"><label>Low stock alert below</label><input id="pm_lowstock" type="number" value="${product?.low_stock_threshold ?? 5}"></div>
        <button class="btn btn-primary" id="pmSave">Save (requires owner password)</button>
        <button class="btn btn-outline" id="pmCancel" style="margin-top:var(--space-2);">Cancel</button>
      </div>
    </div>`;
  document.getElementById('pmCancel').addEventListener('click', () => (holder.innerHTML = ''));

  document.getElementById('pm_photo_file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|jpg|webp)$/.test(file.type)) {
      document.getElementById('pmErr').innerHTML = `<div class="error-box">Choose a PNG, JPG, or WEBP image.</div>`;
      e.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      document.getElementById('pmErr').innerHTML = `<div class="error-box">Photo is too large (max 5MB).</div>`;
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      document.getElementById('pm_photo_preview').src = reader.result; // preview immediately, either way
      if (isEdit) {
        // Existing product: upload right away so it's not lost if the owner
        // navigates away without hitting Save.
        requireAdminThen(async () => {
          try {
            const res = await API.post(`/owner/menu/products/${product.id}/photo`, { dataUrl: reader.result }, 'owner');
            document.getElementById('pm_photo_preview').src = res.image;
          } catch (err) {
            document.getElementById('pmErr').innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
          }
        });
      } else {
        // New product: no id yet -- hold the image and attach it right
        // after creation, in the same Save action below.
        pendingPhotoDataUrl = reader.result;
      }
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('pmSave').addEventListener('click', () => {
    const payload = {
      name: document.getElementById('pm_name').value,
      brand: document.getElementById('pm_brand').value,
      categoryId: Number(document.getElementById('pm_category').value),
      packSize: document.getElementById('pm_pack').value,
      unit: document.getElementById('pm_unit').value,
      mrp: document.getElementById('pm_mrp').value,
      retailPrice: document.getElementById('pm_retail').value,
      wholesaleBasePrice: document.getElementById('pm_wholesale').value,
      moq: document.getElementById('pm_moq').value,
      stockQty: document.getElementById('pm_stock').value,
      lowStockThreshold: document.getElementById('pm_lowstock').value,
    };
    requireAdminThen(async () => {
      try {
        if (isEdit) {
          await API.put(`/owner/menu/products/${product.id}`, payload, 'owner');
        } else {
          const created = await API.post('/owner/menu/products', payload, 'owner');
          if (pendingPhotoDataUrl) {
            await API.post(`/owner/menu/products/${created.id}/photo`, { dataUrl: pendingPhotoDataUrl }, 'owner');
          }
        }
        holder.innerHTML = '';
        render();
      } catch (err) {
        document.getElementById('pmErr').innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
      }
    });
  });
}

// ================================================================================
// WHOLESALE APPROVALS
// ================================================================================
route('/owner/approvals', async () => {
  if (!(await ensureOwner())) return;
  const { accounts } = await API.get('/owner/wholesale-accounts?status=pending', 'owner');
  root.innerHTML = shellHtml(
    `<div class="screen no-tabbar">
      ${accounts.length === 0 ? `<div class="empty-state">${icon('checkCircle', 'icon-lg')}<p style="margin-top:var(--space-3);">No pending requests.</p></div>` : accounts.map((a) => `
        <div class="card" data-uid="${a.id}">
          <b>${esc(a.full_name)}</b> &middot; ${esc(a.mobile)}<br>
          <span class="supporting-text">${esc(a.business_name)} (${esc(a.business_type)})</span>
          ${a.gst_number ? `<br><span class="supporting-text">GST: ${esc(a.gst_number)}</span>` : ''}
          <div class="btn-block-row" style="margin-top:var(--space-3);">
            <button class="btn btn-primary btn-sm" data-decide="approved">Approve</button>
            <button class="btn btn-outline btn-sm" data-decide="rejected">Reject</button>
          </div>
        </div>`).join('')}
    </div>`,
    { topbar: ownerTopbar('Wholesale Approvals') }
  );
  wireOwnerChrome();
  document.querySelectorAll('[data-decide]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const uid = btn.closest('[data-uid]').dataset.uid;
      requireAdminThen(async () => {
        await API.post(`/owner/wholesale-accounts/${uid}/decision`, { decision: btn.dataset.decide }, 'owner');
        render();
      });
    })
  );
});

// ================================================================================
// PAYMENT RECONCILIATION
// ================================================================================
route('/owner/payments', async () => {
  if (!(await ensureOwner())) return;
  const { orders } = await API.get('/owner/payments/pending', 'owner');
  root.innerHTML = shellHtml(
    `<div class="screen no-tabbar">
      ${orders.length === 0 ? `<div class="empty-state">${icon('card', 'icon-lg')}<p style="margin-top:var(--space-3);">Nothing pending.</p></div>` : orders.map((o) => `
        <div class="card" data-oid="${o.id}">
          <div class="head"><b>${esc(o.orderNo)}</b><span>${money(o.total)}</span></div>
          <span class="supporting-text">${o.paymentMethod.toUpperCase()}</span>
          <button class="btn btn-primary btn-sm" style="margin-top:var(--space-2);" data-mark="1">Mark received</button>
        </div>`).join('')}
    </div>`,
    { topbar: ownerTopbar('Online Payment Update') }
  );
  wireOwnerChrome();
  document.querySelectorAll('[data-mark]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const oid = btn.closest('[data-oid]').dataset.oid;
      await API.post(`/owner/payments/${oid}/mark-received`, {}, 'owner');
      render();
    })
  );
});

// ================================================================================
// HISTORY + SALES SUMMARY
// ================================================================================
route('/owner/history', async () => {
  if (!(await ensureOwner())) return;
  const [summary, { orders }] = await Promise.all([
    API.get('/owner/history/summary', 'owner'),
    API.get('/owner/history', 'owner'),
  ]);
  root.innerHTML = shellHtml(
    `<div class="screen no-tabbar">
      <div class="kpi-grid">
        <div class="kpi k1"><div class="icon-badge">${icon('history', 'icon-sm')}</div><div class="label">Today</div><div class="value">${money(summary.today.total)}</div></div>
        <div class="kpi k2"><div class="icon-badge">${icon('history', 'icon-sm')}</div><div class="label">This week</div><div class="value">${money(summary.week.total)}</div></div>
        <div class="kpi k3"><div class="icon-badge">${icon('history', 'icon-sm')}</div><div class="label">This month</div><div class="value">${money(summary.month.total)}</div></div>
        <div class="kpi k4"><div class="icon-badge">${icon('package', 'icon-sm')}</div><div class="label">Orders (month)</div><div class="value">${summary.month.orders}</div></div>
      </div>
      <h3 class="section-title">Top sellers (30 days)</h3>
      <div class="table-list">
        ${summary.topProducts.map((p) => `<div class="row"><span>${esc(p.name)}</span><span>${p.unitsSold} sold &middot; ${money(p.revenue)}</span></div>`).join('') || '<p class="supporting-text">No sales yet.</p>'}
      </div>
      <h3 class="section-title">All orders</h3>
      <div class="btn-block-row" style="margin-bottom:var(--space-3);">
        <button class="btn btn-outline btn-sm" id="downloadCsvBtn" style="width:100%;">${icon('history', 'icon-sm')} Download Excel (CSV)</button>
        <button class="btn btn-outline btn-sm" id="downloadPdfBtn" style="width:100%;">${icon('clipboard', 'icon-sm')} Download PDF</button>
      </div>
      <div class="search-bar">${icon('search')}<input id="histSearch" placeholder="Search order no. / customer / mobile"></div>
      <div id="histList">${orders.map((o) => `
        <div class="card order-card">
          <div class="head"><span class="oid">${esc(o.orderNo)}</span><span class="status-pill status-${o.status}">${o.status.replace(/_/g, ' ')}</span></div>
          <div class="foot"><span class="total">${money(o.total)}</span><span class="metadata">${esc(o.placedAt)}</span></div>
          ${o.cancelReason ? `<div class="metadata">Void reason: ${esc(o.cancelReason)}</div>` : ''}
        </div>`).join('')}</div>
    </div>`,
    { topbar: ownerTopbar('History') }
  );
  wireOwnerChrome();

  async function downloadExport(format) {
    const token = API.token('owner');
    const res = await fetch(`/api/owner/history/export.${format}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { alert('Could not generate the export. Please try again.'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sathvika-mv-orders.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  document.getElementById('downloadCsvBtn').addEventListener('click', () => downloadExport('csv'));
  document.getElementById('downloadPdfBtn').addEventListener('click', () => downloadExport('pdf'));

  let timer;
  document.getElementById('histSearch').addEventListener('input', (e) => {
    clearTimeout(timer);
    const q = e.target.value;
    timer = setTimeout(async () => {
      const res = await API.get(`/owner/history?q=${encodeURIComponent(q)}`, 'owner');
      document.getElementById('histList').innerHTML = res.orders.map((o) => `
        <div class="card order-card">
          <div class="head"><span class="oid">${esc(o.orderNo)}</span><span class="status-pill status-${o.status}">${o.status.replace(/_/g, ' ')}</span></div>
          <div class="foot"><span class="total">${money(o.total)}</span><span class="metadata">${esc(o.placedAt)}</span></div>
        </div>`).join('');
    }, 300);
  });
});
