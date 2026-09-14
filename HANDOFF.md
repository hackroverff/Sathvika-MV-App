# Sathvika MV — Phase 1 handoff

A working, single-store grocery + wholesale ordering PWA, built to the Phase 1
spec. Everything below reflects what is actually in this codebase and was
actually run — the smoke test in `scripts/smoke-test.js` is real and passes
(`24 passed, 0 failed` on the last run before handoff).

## 1. Quick start

```bash
node -v            # needs >=22.5 (uses node:sqlite, built into Node -- no DB to install)
npm install        # express is the only dependency
npm run reset       # wipes/creates data/sathvika.db, seeds catalog + demo users/orders,
                     # paints placeholder product artwork into public/img/products/
npm start           # http://localhost:4173
```

Then, in another terminal, with the server still running:

```bash
node scripts/smoke-test.js
```

That hits the live API (login, pricing, checkout, owner scopes, order status)
and prints pass/fail per assertion — it's the acceptance check for this
handoff, not a claim I'm asking you to trust.

## 2. Demo credentials (all created by `npm run reset`)

| Role | Login | Notes |
|---|---|---|
| Owner (day-to-day) | PIN `4321` | Dashboard, order status, view-only lists |
| Owner (sensitive actions) | password `owner@123` | Edit products/prices, approve wholesale, change min order |
| Retail customer | `9840012345` / `priya@123` | Has 2 past orders |
| Wholesale customer (approved) | `9840012347` / `ramesh@123` | Iyer Mess & Canteen — sees tiered pricing |
| Wholesale customer (pending) | `9840012348` / `lakshmi@123` | Still sees retail pricing until approved |

Signup OTPs have no real SMS gateway behind them (see §7) — the OTP is
returned in the API response (`devOtp`) and shown on-screen in a "Demo mode"
banner so the flow is testable without one.

## 3. What's actually built (Phase 1 scope from the spec)

- Customer signup (OTP-gated) + login, retail/wholesale account type at
  signup, wholesale accounts start `pending` and see retail pricing until an
  owner approves them.
- Full catalog: categories, search, category filter, brand filter, price
  range filtering, stock status, per-product wholesale tier table.
- **Pricing is computed only on the server** (`server/lib/pricing.js`). The
  frontend never calculates a chargeable total — it displays whatever
  `/api/catalog/quote` or `/api/orders/checkout` returns. The smoke test
  proves a client-supplied `total` field is ignored.
- Cart, minimum order value gate (retail), MOQ gate (wholesale), checkout
  with saved addresses + GPay/PhonePe/Paytm/other-UPI/COD payment method
  selection, order confirmation.
- Order history, status pipeline (placed → confirmed → preparing → out for
  delivery → delivered → cancelled), reorder (re-quoted against *current*
  prices/stock, not the old snapshot).
- Owner console: PIN login for day-to-day ops, a **separate password login**
  for sensitive actions (this is a real scope split enforced server-side —
  see `server/lib/auth-mid.js` — not just a UI gate). Dashboard KPIs (shift
  orders, online received, grand total, COD received), current-shift order
  list with status controls and a "Navigate" link into Google Maps, shop
  open/closed toggle, menu management (products/categories/tiers/stock),
  wholesale approvals, online payment reconciliation, void/cancel with a
  required reason (restocks items), history with date/text search and a
  sales summary (today/week/month + top sellers).
- SMS/WhatsApp-style notifications and low-stock alerts (see §7 — these are
  logged, not sent, in Phase 1).
- Bilingual (English/Tamil) toggle for the core shopping UI strings.
- PWA shell: manifest, service worker caching the static app shell only
  (never `/api/*` — prices and stock must always come from the network).
- Seed data: 55 products across all 7 required categories with realistic
  Chennai-provision-store items, multiple wholesale tiers per product, 4
  demo users, 6 demo orders across different statuses.

## 4. Why this stack

- **Node's built-in `node:sqlite`** instead of a separate database or
  `better-sqlite3`. Zero native compilation, zero extra dependency, and a
  single-store app with "low hundreds of products" (per the spec) doesn't
  need more than SQLite gives it. It's marked experimental by Node itself;
  if that becomes a concern, the schema in `server/db.js` is plain SQL and
  moves to Postgres/MySQL with driver-level changes only — nothing in the
  route or pricing logic is SQLite-specific beyond the couple of
  `datetime('now', ...)` calls.
- **Vanilla JS SPA, no build step** for the same reason: this is a single
  store's ordering app, not a multi-team frontend. `public/js/*.js` are
  loaded directly by the browser — open `index.html` via the Express server
  and it runs, no webpack/vite/babel in the loop. If this grows into
  something a team maintains, migrating the view functions in `shop.js`/
  `owner.js` into components is straightforward since they're already
  pure-ish render functions keyed by route.
- **Express 5** (what `npm install express` resolved to). Note if you've used
  Express 4: wildcard routes (`app.get('*', ...)`) throw at startup on
  Express 5's `path-to-regexp`; the catch-all in `server/index.js` uses a
  plain `app.use((req,res)=>...)` instead.

## 5. The trust boundary that matters most

Every chargeable number a customer sees or pays flows through
`quoteCart()` in `server/lib/pricing.js`, called from both
`/api/catalog/quote` (live cart preview) and `/api/orders/checkout` (the
actual charge). The frontend cart only ever stores `{productId, qty}` pairs
and asks the server what that costs. `scripts/smoke-test.js` includes a test
that sends a spoofed `total: 1` at checkout and asserts the server ignores
it and charges the real computed total instead.

The owner side has an equivalent boundary: a PIN-scope session
(`owner_ops`) cannot call price/product-edit or wholesale-approval routes —
`requireOwnerAdmin` in `server/lib/auth-mid.js` checks the session's `scope`
column, not just "is there a valid token." The smoke test exercises this
both ways (ops token rejected, admin token accepted) against the same route.

## 6. Assumptions made where the spec was silent

- **"Shift"** = calendar day. There's no explicit shift-open/close concept
  yet; `shift_date` on each order is just the date it was placed, and the
  dashboard sums today's `shift_date`. If shifts need to be an explicit
  opened/closed concept (e.g. multiple shifts per day, handover notes),
  that's a small schema addition (a `shifts` table + `shift_id` FK) but
  wasn't specified, so it isn't built.
- **One owner account.** The spec describes "Shop Owner/Admin" as a single
  role; there's no multi-staff-login concept. Adding named staff logins
  under the PIN tier is a Phase 2-shaped change (new `staff` table +
  `session.user_id` for ops scope) not built here.
- **Delivery charge** is a single flat, owner-configurable amount
  (`settings.delivery_charge_flat`, defaults to 0) rather than
  distance/zone-based, since delivery zones are explicitly Phase 2.
- **MOQ defaults**: 3 units for kg/litre-measured products, 6 for
  piece/packet/etc, in the seed data — the spec didn't give a rule, so this
  is a reasonable default per unit type, editable per-product from Menu
  List.
- **Address = free text + pincode**, geocoded only as a URL-encoded Google
  Maps search query (`maps_query`) for the owner's "Navigate" button, not
  lat/lng. Good enough for one store's delivery radius; a proper
  geocode-on-save is straightforward to add later if pin-accurate routing
  matters.
- **OTP delivery**: see §7 — no SMS gateway is wired up, by necessity (no
  gateway credentials exist to wire up). Everything else about the OTP flow
  (generation, 10-minute expiry, single-use, rate limiting isn't
  implemented) is real.

## 7. Known Phase 1 gaps (intentional, not bugs)

- **No real SMS/WhatsApp gateway.** `server/lib/notify.js` logs every
  notification (OTP, order placed, out-for-delivery, delivered, wholesale
  decision) to a `notifications` table instead of sending it. Wiring a real
  gateway (e.g. an SMS API or WhatsApp Business API) is a change inside
  `notify()` only — nothing else in the app needs to change, since every
  call site already goes through this one function.
- **Product photography**: I can't fetch or embed real branded product
  photos from the internet — that's someone else's copyrighted photography,
  regardless of how it's used. `npm run reset` still generates simple
  colored placeholder SVGs (initials + category color band) per product for
  a working demo. For real photos: **Menu List → Edit a product → tap the
  photo field** and choose/take a picture — it uploads straight from the
  owner's phone and replaces the placeholder immediately (`POST
  /owner/menu/products/:id/photo`, admin password required). That's the
  actual way to get real product photos in, one product at a time, whenever
  it's convenient.
- **App icon**: `public/icons/icon.svg` is a placeholder monogram, not the
  shop's real logo. Replace that one file (and consider adding real PNG
  sizes if you want a nicer home-screen icon on iOS, which prefers PNG over
  SVG for `apple-touch-icon`).
- **Experimental `node:sqlite`**: Node itself labels this experimental and
  it prints a warning on startup. It has been fine for this workload in
  testing; if that warning is a blocker for your production comfort level,
  swapping to `better-sqlite3` is a same-shaped, mostly mechanical change
  (the SQL and schema don't need to change, just the `db.js` connection
  code and the one `db.transaction`-style block in `orders.js`).
- **Visual style**: restyled twice. First pass matched the color palette and
  UI patterns of the family's existing "Sathvika MV Stores" app (coral
  header, pill-shaped Add/stepper buttons, WhatsApp floating button,
  category tile grid on Home) once real screenshots of that app were
  shared. Second pass (see §10) switched the brand color from that coral to
  the maroon/gold sampled directly from the shop's real logo, and added a
  full dark mode.
  screenshots of that app were shared — see `public/css/style.css` for the
  brand variables. The WhatsApp button currently links to generic
  `https://wa.me/` with no number pre-filled; add the shop's WhatsApp
  number there once confirmed.
- **Tamil coverage**: `public/js/i18n.js` translates the core navigation and
  shopping UI strings, not the product catalog itself (products are entered
  once, in English, by the owner). Full bilingual catalog entry is a
  Phase 2-shaped feature (a second name/description column per product).

## 8. Phase 2 items (per the spec — not built, noted here only)

Barcode scanning for stock updates, CSV/Excel bulk import, supplier/PO
management, coupons/promotions, reviews & ratings, typo-tolerant search,
delivery zones/slots + third-party delivery integration, SEO structured
data for a public browsing site, native apps, recommendation engine. None of
the Phase 1 schema or routes need to change shape to add these — e.g. a
coupon engine reads `settings`-style config and adjusts `quoteCart()`'s
output without touching checkout's control flow.

## 9. File map

```
server/
  index.js            Express app, route mounting, static serving
  db.js               Schema (single source of truth) + connection
  seed.js             Wipes + repopulates demo data (categories, 55 products,
                       tiers, 4 users, 6 orders) + placeholder product art
  lib/
    pricing.js         The pricing engine (see §5)
    crypto-util.js      Password/PIN hashing (scrypt) + OTP generation
    sessions.js         Session create/resolve/destroy, 3 scopes
    auth-mid.js         Express middleware for the 3 scopes
    notify.js           Notification log (see §7)
  routes/
    auth.js             Customer signup/OTP/login/reset
    catalog.js           Categories/products/search/quote
    orders.js             Addresses/checkout/order history/reorder
    owner.js               PIN+password login, dashboard, menu mgmt,
                            approvals, payments, void, history
public/
  index.html, manifest.json, sw.js, icons/
  css/style.css        Brand variables + all styles
  js/
    api.js              fetch wrapper (dual token: customer/owner)
    i18n.js              EN/TA string dictionary
    app.js                Router, shell, splash/landing/auth screens
    shop.js               Home/catalog/product/cart/checkout/orders/profile
    owner.js               Owner console screens + admin-escalation modal
scripts/
  smoke-test.js         Real end-to-end test against a running server
```

## 10. Round 2 changes (this update)

- **Fixed a real bug**: tapping any item in the owner's hamburger menu
  (Menu List, Wholesale Approvals, etc.) looked stuck and did nothing.
  Cause: that menu is a modal sheet appended to `<body>`, outside the `#app`
  container the router redraws. Navigating never removed it, so the
  invisible full-screen backdrop from the *old* screen sat on top of the
  *new* screen and silently ate every click. Fixed at the router level —
  `render()` in `app.js` now clears any open modal/sheet on every
  navigation, so this class of bug can't recur elsewhere either.
- **Real UPI payments**: checkout now returns a genuine `upi://pay` deep
  link (`server/routes/orders.js`), built server-side from the shop's UPI
  ID (`vijayakumar4ru-3@okicici`, stored in `settings.upi_vpa`) and the
  authoritative order total. The order-confirmation screen shows a
  "Pay via UPI now" button that opens it. Update the ID anytime via
  `POST /api/owner/settings/payment` (owner password required).
- **Minimum order value changed to ₹70** (was ₹150), retail only —
  wholesale still gates on per-product MOQ instead.
- **"You save" added to the checkout page**, not just the cart page.
- **WhatsApp button now links to +91 98413 05605** (`wa.me/919841305605`).
- **Real product photo upload** for owners — see §7.
- **Color palette replaced**: sampled directly from the shop's real logo
  (maroon `#8b3035`, gold `#d9a441`) instead of the earlier coral. All
  colors are CSS variables in `public/css/style.css`, so this is a
  find-and-adjust job if the exact shade ever needs tweaking.
- **Dark mode**: a real toggle (Profile page, and in the owner hamburger
  menu), backed by `data-theme="dark"` on `<html>` and a full set of dark
  variable overrides — not just an inverted filter. Defaults to the
  device's OS-level light/dark preference on first visit, then remembers
  whatever the person picked.
- **Owner UI modernized**: shop open/closed is now a proper sliding toggle
  switch with a colored status pill next to it, and the order status
  controls are a numbered progress stepper (done steps get a checkmark,
  the current step is gold-highlighted) instead of a row of plain buttons.
  Void is now a small text link under the stepper rather than a button in
  the row, so it can't be mistaken for a normal status step.

## 11. Round 3 changes (this update)

- **Fixed a real dark-mode bug**: form inputs, selects, and buttons were
  showing black text regardless of theme. Cause: browsers don't make form
  controls inherit text color by default (they use platform-native
  styling), so they ignored the `--ink` variable entirely. Fixed with one
  global rule in `style.css` (`input, select, textarea, button { color:
  inherit; }`) rather than patching each component.
- **Real shop logo added**: `public/img/brand/logo.png` (from the file you
  sent) is now the splash screen, the landing page logo, the PWA install
  icon (`public/icons/icon-192.png` / `icon-512.png`, regenerated from it),
  and the browser tab favicon.
- **Visual pass toward a more modern look**, inspired by the reference app
  you shared: soft shadows on cards/buttons/topbar instead of flat borders
  only, owner KPI cards changed from solid saturated color blocks to
  neutral cards with a colored value + icon (matches the reference's
  style), and the owner's hamburger menu is now a compact dropdown anchored
  under the ⋮ button (with a live status dot next to it) instead of a
  full-screen sheet.
- One thing worth flagging since it bit us once already: the owner dropdown
  keeps the `modal-backdrop` class (alongside its own styling class)
  specifically so it's still caught by the router's cleanup-on-navigate
  fix from Round 2. If you ever add another popup/sheet to this app, give
  it that class too, or it can reintroduce the "menu item click does
  nothing" bug.

## 12. Round 4 changes — full UI/UX redesign

This was a structural redesign, not another color pass. Full rewrite of
`public/css/style.css` and substantial rewrites of `public/js/app.js`,
`public/js/shop.js`, `public/js/owner.js`, plus a new `public/js/icons.js`.

**Design system**: replaced ad-hoc colors with semantic tokens (`--bg`,
`--surface`, `--surface-elevated`, `--text-primary/secondary/tertiary`,
`--border`, `--brand`, `--accent`, `--success/warning/danger/info` +
`-tint` pairs), a spacing scale (`--space-1..8`), a type scale
(`--text-xs..2xl`), and two elevation levels. Old variable names
(`--ink`, `--muted`, `--paper` etc.) are kept as aliases pointing at the
new tokens so nothing broke mid-rewrite, but every new/rewritten rule
uses the semantic names directly.

**Color usage rebalanced**: KPI cards, category tiles, and status pills
no longer get a different bright color each — brand maroon is used for
primary actions and small accents only, gold is a rare highlight, and
green/amber/red/blue only appear for actual semantic meaning
(success/warning/danger/info), matching the ~70-80% neutral guidance.

**Icon system**: `public/js/icons.js` is a hand-authored set of ~30
inline SVG line icons (stroke-based, sized/colored via CSS `currentColor`
through the `.icon` class) — no external dependency, no build step.
Emoji count in the JS templates went from 109 to 0 (the only remaining
`\u` escapes are the rupee sign, an en-dash/multiplication sign, and the
Tamil-script language label — verified by grep, not by eye).

**Logo integration**: the real logo now appears in a proper white
circular surface (never placed raw on a colored background) in the
splash screen, the landing page, the customer Home header (new
`app-header` component: logo chip + "Sathvika MV" + tagline + cart
action), and a smaller version in the owner dashboard header. It's
intentionally *not* repeated on every sub-screen — those use a plain
back+title bar, per the "don't duplicate the logo excessively" guidance.

**New customer Home header**: previously the Home screen had no header at
all (a real gap from the last round — it was built but never wired in,
caught during this pass). Now it shows the brand lockup + cart action,
with a tap-through search bar and a de-emojified category grid below.

**Dark-mode audit**: re-verified the Round 3 fix (global `color: inherit`
on inputs/selects/buttons) still holds, then went further — the old
approach of patching individual pastel banner/status colors with a
separate `dark-theme` override block is gone. Status pills, banners, and
tags now pull from the same `-tint` tokens as everything else, so dark
mode is correct by construction instead of patched per-component. Grepped
for `#000`/`black` (none) and for hex colors outside the token
definitions (all remaining ones are white text/icons sitting on a solid
brand-colored fill — badges, buttons, the WhatsApp FAB — which is correct
in both themes since the fill itself doesn't change).

**Verification performed**: `node --check` on every JS file, CSS brace
balance check, full reseed, and `node scripts/smoke-test.js` — still
**25/25 passing** (auth, pricing, wholesale tiers, checkout, tamper
resistance, owner scope separation, order lifecycle). Manually spot-
checked that `/`, `/js/icons.js`, `/api/catalog/products`, and
`/api/catalog/categories` all serve correctly post-rewrite.

**What I did not do**: I did not restructure the routing, the API layer,
auth, or the pricing engine — this was scoped to the frontend, as asked.
I did not introduce a build step or an external icon/CSS framework,
per "don't break the current architecture unnecessarily." I did not hand-
polish every single inline `style="margin-top:...spacing"` occurrence out
of the templates — those are layout nudges, not color/theme-breaking, so
they were lower priority than the token system, icons, and dark-mode
correctness; a future pass could move the more repeated ones into
utility classes if it matters for maintainability.

## 13. Round 5 changes — functional fixes + UPI QR + exports + profile

Files changed: `server/db.js`, `server/seed.js`, `server/routes/orders.js`,
`server/routes/owner.js`, `public/css/style.css`, `public/js/shop.js`,
`public/js/owner.js`, `public/js/i18n.js`, `package.json` (added `qrcode`,
`pdfkit`), `scripts/smoke-test.js` (15 new assertions, 40/40 passing).

- **Tamil name period removed**: `சத்விகா எம்.வி` → `சத்விகா எம்வி`, fixed at
  the single source (`i18n.js`), so every screen that renders it is fixed.
- **Landing tagline replaced**: "Shop for your home" → "Your everyday
  essentials, made simple".
- **Delivery charge is real, not just displayed**: `settings.delivery_charge_flat`
  changed from `0` to `20`, which flows through the *existing* pricing
  engine (`quoteCart()` already added this value to the total — it just
  wasn't set to a value) — so checkout, order creation, UPI amount, order
  history, and the owner dashboard all reflect it because they all read
  from the same order row's `total`, not separate calculations. Verified:
  `total === subtotal + 20` exactly, via a live checkout in the smoke test.
- **Order-ID generation fixed in the seed data**: seeded orders used to get
  `SMV-SEED-483`-style random IDs, inconsistent with the real
  `SMV-YYYYMMDD-NNN` format `generateOrderNo()` actually uses in production
  checkouts. Seed now generates proper sequential per-day IDs, and a smoke
  test confirms two orders placed the same day get different, correctly
  formatted, sequential numbers.
- **UPI QR code, with the exact amount encoded**: checkout now generates a
  real QR (via the `qrcode` package, server-side, so no client dependency)
  encoding the *same* `upi://pay?...&am=<exact total>` link already used
  for the "tap to pay" button — scanning it opens the customer's UPI app
  with GPay/PhonePe/Paytm/BHIM all able to read the pre-filled amount. The
  order-confirmation screen shows the QR at a real scannable size (not
  tiny), the exact amount, instructions, and the order number, with a
  fallback message if QR generation ever fails.
- **Owner PIN keypad fixed**: the "elongated oval" bug was `border-radius:
  50%` applied to a button sized by padding on a stretched grid cell —
  never actually square. Fixed with explicit equal width/height + a fixed
  3-column grid, so it's now genuinely circular.
- **Navigate button now gives real directions**: was a `/maps/search/`
  link (destination only). Changed to `/maps/dir/?api=1&destination=...
  &travelmode=driving` — omitting the origin is intentional and correct:
  Google Maps' documented behavior is to default the origin to the
  viewer's current location, which satisfies "directions from the owner's
  current location" without needing browser geolocation permissions
  handled in-app.
- **Add-product image upload now works during creation**, not just after
  saving an existing product: pick/preview a photo before the product
  exists, and on Save it creates the product first, then attaches the
  photo to the new ID in the same admin-authenticated action. Verified
  end-to-end in the smoke test: create → upload photo → confirm the
  customer catalog serves that exact image.
- **Owner-password modal hardened**: the backend check was already correct
  (verified passing both directions in every prior round's smoke test), so
  the fix targets the actual likely real-world cause — added
  `autocomplete="off" autocapitalize="off" autocorrect="off"
  spellcheck="false"` to the password field (a bare password input is
  still subject to a browser's saved-credential autofill or a mobile
  keyboard's autocorrect silently changing what's submitted), trimmed the
  value before sending, added a visible Show/Hide toggle so the owner can
  confirm what they actually typed, and wired Enter-to-submit so a stuck
  old error message can't be mistaken for a fresh failed attempt.
- **History export, with real data**: "Download Excel (CSV)" and "Download
  PDF" buttons on the owner History page. CSV is genuine comma-separated
  data with a header row (Order ID, Date, Customer, Mobile, Items, Payment
  Method, Status, Subtotal, Delivery Charge, Total) — verified to contain
  actual order numbers from a live run. PDF is generated with `pdfkit`,
  confirmed to be a real, valid, non-empty PDF (`file` reports "PDF
  document, version 1.3"), not a placeholder.
- **Customer profile expanded** with working features only: My Orders
  (existing route), Saved Addresses (new `#/profile/addresses` screen —
  full add/remove against the existing address endpoints, nothing new on
  the backend needed), Language + Dark mode (existing), Help & Support
  (real WhatsApp link), and an About card with the real logo. Deliberately
  did not add a notifications/settings section since there's no backend
  for it yet — a fake toggle that does nothing was explicitly out of scope.

**Verification performed**: `node --check` on every JS file, CSS brace
balance, full reseed, and `node scripts/smoke-test.js` — **40/40 passing**
(15 new assertions this round covering delivery charge inclusion, QR
amount matching, order-ID format and collision-safety, add-product +
photo end-to-end, and CSV/PDF export content). Manually spot-checked the
CSV and PDF exports against a live server (`file` confirmed a genuine PDF;
CSV math checked by hand: 158+20=178, 3100+20=3120).

**Genuine remaining limitations**: I could not reproduce the exact browser
condition that caused "correct password rejected" (the backend check
itself was already verified correct every round), so that fix targets the
most likely real cause rather than a confirmed root cause — if it
recurs, the Show/Hide toggle will make it immediately obvious whether the
field actually contains what was typed. CSV satisfies "Excel-compatible
format" by being genuine CSV (opens natively in Excel/Sheets); it is not
a native `.xlsx` binary file, which would need an additional library —
say if that distinction matters and I'll add it. The Google Maps
directions link relies on Maps' own current-location default rather than
the browser's Geolocation API, which is simpler and needs no permission
prompt, but means the exact origin is whatever Google Maps' app/site
resolves as "current location" on the owner's device, not a
server-verified coordinate.
