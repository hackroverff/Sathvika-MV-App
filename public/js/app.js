'use strict';
/* Sathvika MV -- single-file vanilla-JS SPA. No build step: open index.html
 * (served by the Express app) and it runs. Hash-based router; state kept in
 * memory + localStorage (cart, tokens, language). See HANDOFF.md "Frontend
 * architecture" for why this over React for a Phase 1 single-store app. */

const State = {
  user: null, // current logged-in customer (public shape from API)
  categories: [],
  products: [],
  brands: [],
  accountType: 'retail',
  shopOpen: true,
  cart: JSON.parse(localStorage.getItem('smv_cart') || '{}'), // { [productId]: qty }
  productCache: {}, // id -> product, filled as we see them
  ownerScope: null, // 'owner_ops' | 'owner_admin' | null
  filters: { category: null, q: '', brand: null },
};

function saveCart() {
  localStorage.setItem('smv_cart', JSON.stringify(State.cart));
}
function cartCount() {
  return Object.values(State.cart).reduce((a, b) => a + b, 0);
}
function money(n) {
  return '\u20b9' + Number(n).toFixed(2).replace(/\.00$/, '');
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function t(k) { return I18N.t(k); }

// ---- Theme (light/dark) --------------------------------------------------------
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('smv_theme', theme);
}
function currentTheme() {
  return localStorage.getItem('smv_theme') || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
applyTheme(currentTheme()); // apply immediately, before first paint/render

const root = document.getElementById('app');

// ---- Router ------------------------------------------------------------------
const routes = {};
function route(pattern, handler) { routes[pattern] = handler; }
function navigate(hash) { window.location.hash = hash; }

function matchRoute(hash) {
  const path = hash.replace(/^#/, '') || '/landing';
  for (const pattern in routes) {
    const paramNames = [];
    const regex = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => { paramNames.push(m.slice(1)); return '([^/]+)'; }) + '$');
    const match = path.match(regex);
    if (match) {
      const params = {};
      paramNames.forEach((name, i) => (params[name] = match[i + 1]));
      return { handler: routes[pattern], params };
    }
  }
  return null;
}

async function render() {
  // Any open modal/sheet (owner nav menu, admin password prompt) is appended
  // to <body>, outside #app -- clear it on every navigation so it can never
  // survive a route change and block the new page underneath it.
  document.querySelectorAll('.modal-backdrop').forEach((el) => el.remove());
  const hash = window.location.hash;
  const matched = matchRoute(hash);
  if (!matched) return navigate('#/landing');
  window.scrollTo(0, 0);
  try {
    await matched.handler(matched.params);
  } catch (err) {
    console.error(err);
    root.innerHTML = shellHtml(`<div class="screen"><div class="error-box">${esc(err.message)}</div></div>`);
  }
}
window.addEventListener('hashchange', render);

// ---- Shell: header / topbar / tabbar -------------------------------------------
function shellHtml(inner, opts = {}) {
  const { topbar, tabbar } = opts;
  return `${topbar || ''}${inner}${tabbar || ''}`;
}

// Branded header (logo + shop name) -- used on the Home screen, the one
// place the logo appears in the main navigation shell (kept off every other
// screen per design direction: brand identity once, not repeated everywhere).
function customerAppHeader() {
  const cartBtn = `<button class="icon-btn" data-nav="#/cart">${icon('cart', 'icon-sm')}${cartCount() ? `<span class="badge">${cartCount()}</span>` : ''}</button>`;
  return `<div class="app-header">
    <div class="brand-lockup">
      <div class="logo-chip"><img src="/img/brand/logo.png" alt="Sathvika MV"></div>
      <div>
        <div class="brand-name">${esc(t('appName'))}</div>
        <div class="brand-sub">${esc(t('tagline'))}</div>
      </div>
    </div>
    ${cartBtn}
  </div>`;
}

// Plain back+title topbar -- used on every sub-page (product, cart, checkout,
// orders, profile, auth screens).
function customerTopbar(title, opts = {}) {
  const backBtn = opts.back ? `<button class="icon-btn" data-nav="${opts.back}">${icon('chevronLeft', 'icon-sm')}</button>` : '';
  const cartBtn = opts.hideCart ? '' : `<button class="icon-btn" data-nav="#/cart">${icon('cart', 'icon-sm')}${cartCount() ? `<span class="badge">${cartCount()}</span>` : ''}</button>`;
  return `<div class="topbar">${backBtn}<div class="title">${esc(title)}</div>${cartBtn}</div>`;
}

function customerTabbar(active) {
  const tabs = [
    ['home', '#/home', 'home', t('home')],
    ['cart', '#/cart', 'cart', t('cart')],
    ['orders', '#/orders', 'package', t('orders')],
    ['profile', '#/profile', 'user', t('profile')],
  ];
  return `<div class="tabbar">${tabs
    .map(
      ([key, href, iconName, label]) =>
        `<button data-nav="${href}" class="${active === key ? 'active' : ''}">${icon(iconName)}${esc(label)}${
          key === 'cart' && cartCount() ? `<span class="badge" style="top:-2px;right:22%;">${cartCount()}</span>` : ''
        }</button>`
    )
    .join('')}<a class="wa-fab" href="https://wa.me/919841305605" target="_blank" rel="noopener" title="Chat on WhatsApp">${icon('whatsapp', 'icon-lg')}</a></div>`;
}

// Global click delegate for data-nav / data-action attributes.
document.addEventListener('click', (e) => {
  const navEl = e.target.closest('[data-nav]');
  if (navEl) { navigate(navEl.getAttribute('data-nav')); return; }
});

// ================================================================================
// SPLASH
// ================================================================================
route('/', () => showSplash());
function showSplash() {
  root.innerHTML = `
    <div class="splash">
      <div class="logo-circle"><img src="/img/brand/logo.png" alt="Sathvika MV"></div>
      <h1>${esc(t('appName'))}</h1>
      <div class="tagline">${esc(t('tagline'))}</div>
      <div class="dots"><span></span><span></span><span></span></div>
    </div>`;
  setTimeout(() => navigate('#/landing'), 1600);
}
if (!window.location.hash) showSplash();

// ================================================================================
// LANDING
// ================================================================================
route('/landing', () => {
  root.innerHTML = `
    <div class="screen no-tabbar">
      <div class="landing-hero">
        <div class="logo-circle"><img src="/img/brand/logo.png" alt="Sathvika MV"></div>
        <h1>${esc(t('appName'))}</h1>
        <p class="supporting-text">${esc(t('tagline'))}</p>
      </div>
      <div class="landing-choices">
        <div class="choice-card" data-nav="#/customer/login">
          <div class="icon-wrap">${icon('cart')}</div>
          <div class="txt"><b>${esc(t('customerLogin'))}</b><span>${esc(t('customerLoginSub'))}</span></div>
          <span class="chev">${icon('chevronRight', 'icon-sm')}</span>
        </div>
        <div class="choice-card" data-nav="#/owner/login">
          <div class="icon-wrap">${icon('key')}</div>
          <div class="txt"><b>${esc(t('ownerLogin'))}</b><span>${esc(t('ownerLoginSub'))}</span></div>
          <span class="chev">${icon('chevronRight', 'icon-sm')}</span>
        </div>
      </div>
      <div class="lang-toggle">
        <button data-lang="en" class="${I18N.lang === 'en' ? 'active' : ''}">English</button>
        <button data-lang="ta" class="${I18N.lang === 'ta' ? 'active' : ''}">\u0BA4\u0BAE\u0BBF\u0BB4\u0BCD</button>
      </div>
    </div>`;
  root.querySelectorAll('[data-lang]').forEach((btn) =>
    btn.addEventListener('click', () => { I18N.setLang(btn.dataset.lang); render(); })
  );
});

// ================================================================================
// CUSTOMER AUTH: login / signup / OTP / reset
// ================================================================================
route('/customer/login', () => {
  root.innerHTML = shellHtml(
    `<div class="screen no-tabbar">
      <div id="err"></div>
      <form id="loginForm">
        <div class="field"><label>${esc(t('mobile'))}</label><input required pattern="[6-9][0-9]{9}" maxlength="10" name="mobile" placeholder="98400 12345"></div>
        <div class="field"><label>${esc(t('password'))}</label><input required type="password" name="password"></div>
        <button class="btn btn-primary" type="submit">${esc(t('login'))}</button>
      </form>
      <p class="center supporting-text" style="margin-top:16px;">
        <button class="link-btn" data-nav="#/customer/reset">Forgot password?</button>
      </p>
      <p class="center supporting-text">New here? <button class="link-btn" data-nav="#/customer/signup">${esc(t('signup'))}</button></p>
      <p class="hint center">Demo: 9840012345 / priya@123 (retail) &middot; 9840012347 / ramesh@123 (wholesale)</p>
    </div>`,
    { topbar: customerTopbar(t('customerLogin'), { back: '#/landing', hideCart: true }) }
  );
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const data = await API.post('/auth/login', { mobile: fd.get('mobile'), password: fd.get('password') });
      API.setToken('customer', data.token);
      State.user = data.user;
      navigate('#/home');
    } catch (err) {
      document.getElementById('err').innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
    }
  });
});

route('/customer/signup', () => {
  root.innerHTML = shellHtml(
    `<div class="screen no-tabbar">
      <div id="err"></div>
      <form id="signupForm">
        <div class="field"><label>${esc(t('fullName'))}</label><input required name="fullName"></div>
        <div class="field"><label>${esc(t('mobile'))}</label><input required pattern="[6-9][0-9]{9}" maxlength="10" name="mobile"></div>
        <div class="field"><label>${esc(t('password'))}</label><input required type="password" minlength="6" name="password"></div>
        <div class="field"><label>${esc(t('confirmPassword'))}</label><input required type="password" minlength="6" name="confirmPassword"></div>
        <div class="tabs" id="accTypeTabs">
          <button type="button" class="active" data-val="retail">${esc(t('retail'))}</button>
          <button type="button" data-val="wholesale">${esc(t('wholesale'))}</button>
        </div>
        <div id="wholesaleFields" style="display:none;">
          <div class="field"><label>${esc(t('businessName'))}</label><input name="businessName"></div>
          <div class="field"><label>${esc(t('businessType'))}</label>
            <select name="businessType">
              <option value="shop">Shop</option><option value="restaurant">Restaurant</option>
              <option value="canteen">Canteen</option><option value="office">Office</option>
              <option value="institution">Institution</option><option value="other">Other</option>
            </select>
          </div>
          <div class="field"><label>${esc(t('gstOptional'))}</label><input name="gstNumber"></div>
        </div>
        <input type="hidden" name="accountType" value="retail">
        <button class="btn btn-primary" type="submit">${esc(t('sendOtp'))}</button>
      </form>
    </div>`,
    { topbar: customerTopbar(t('signup'), { back: '#/customer/login', hideCart: true }) }
  );

  const tabs = document.getElementById('accTypeTabs');
  tabs.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => {
      tabs.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      document.querySelector('[name=accountType]').value = b.dataset.val;
      document.getElementById('wholesaleFields').style.display = b.dataset.val === 'wholesale' ? 'block' : 'none';
    })
  );

  document.getElementById('signupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    if (payload.password !== payload.confirmPassword) {
      document.getElementById('err').innerHTML = `<div class="error-box">Passwords do not match.</div>`;
      return;
    }
    try {
      const res = await API.post('/auth/signup/request-otp', payload);
      sessionStorage.setItem('smv_signup_payload', JSON.stringify(payload));
      sessionStorage.setItem('smv_dev_otp', res.devOtp || '');
      navigate('#/customer/signup-otp');
    } catch (err) {
      document.getElementById('err').innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
    }
  });
});

route('/customer/signup-otp', () => {
  const payload = JSON.parse(sessionStorage.getItem('smv_signup_payload') || '{}');
  const devOtp = sessionStorage.getItem('smv_dev_otp') || '';
  root.innerHTML = shellHtml(
    `<div class="screen no-tabbar">
      <p class="supporting-text">${esc(t('enterOtp'))} <b style="color:var(--text-primary)">${esc(payload.mobile || '')}</b></p>
      ${devOtp ? `<div class="success-box">Demo mode (no SMS gateway) &mdash; your OTP is <b>${esc(devOtp)}</b></div>` : ''}
      <div id="err"></div>
      <form id="otpForm">
        <div class="field"><label>OTP</label><input required maxlength="6" pattern="[0-9]{6}" name="otp" inputmode="numeric"></div>
        <button class="btn btn-primary" type="submit">${esc(t('verifyOtp'))}</button>
      </form>
    </div>`,
    { topbar: customerTopbar('OTP Verification', { back: '#/customer/signup', hideCart: true }) }
  );
  document.getElementById('otpForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const otp = new FormData(e.target).get('otp');
    try {
      const data = await API.post('/auth/signup/verify', { ...payload, otp });
      API.setToken('customer', data.token);
      State.user = data.user;
      sessionStorage.removeItem('smv_signup_payload');
      navigate('#/home');
    } catch (err) {
      document.getElementById('err').innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
    }
  });
});

route('/customer/reset', () => {
  root.innerHTML = shellHtml(
    `<div class="screen no-tabbar">
      <div id="err"></div>
      <form id="reqForm">
        <div class="field"><label>${esc(t('mobile'))}</label><input required maxlength="10" name="mobile"></div>
        <button class="btn btn-primary" type="submit">${esc(t('sendOtp'))}</button>
      </form>
    </div>`,
    { topbar: customerTopbar('Reset password', { back: '#/customer/login', hideCart: true }) }
  );
  document.getElementById('reqForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const mobile = new FormData(e.target).get('mobile');
    try {
      const res = await API.post('/auth/reset/request-otp', { mobile });
      root.querySelector('.screen').innerHTML += `
        ${res.devOtp ? `<div class="success-box">Demo OTP: <b>${esc(res.devOtp)}</b></div>` : '<div class="success-box">If that number is registered, an OTP was sent.</div>'}
        <form id="confirmForm">
          <div class="field"><label>OTP</label><input required maxlength="6" name="otp"></div>
          <div class="field"><label>New password</label><input required type="password" minlength="6" name="newPassword"></div>
          <button class="btn btn-primary" type="submit">Reset password</button>
        </form>`;
      document.getElementById('confirmForm').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const fd = new FormData(ev.target);
        try {
          await API.post('/auth/reset/confirm', { mobile, otp: fd.get('otp'), newPassword: fd.get('newPassword') });
          navigate('#/customer/login');
        } catch (err2) {
          document.getElementById('err').innerHTML = `<div class="error-box">${esc(err2.message)}</div>`;
        }
      });
    } catch (err) {
      document.getElementById('err').innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
    }
  });
});

document.addEventListener('DOMContentLoaded', () => {
  render();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
});
