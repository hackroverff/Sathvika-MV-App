'use strict';
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = process.env.SATHVIKA_DB || path.join(DATA_DIR, 'sathvika.db');
for (const suffix of ['', '-wal', '-shm']) {
  const f = DB_PATH + suffix;
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

const { db, setSetting } = require('./db');
const { hashSecret } = require('./lib/crypto-util');

const insertCategory = db.prepare('INSERT INTO categories(name, parent_id) VALUES (?, ?)');
const insertProduct = db.prepare(
  `INSERT INTO products(name, brand, category_id, pack_size, unit, image, mrp, retail_price, wholesale_base_price, moq, stock_qty, low_stock_threshold)
   VALUES (@name, @brand, @categoryId, @packSize, @unit, @image, @mrp, @retailPrice, @wholesaleBasePrice, @moq, @stockQty, @lowStockThreshold)`
);
const insertTier = db.prepare('INSERT INTO wholesale_tiers(product_id, min_qty, max_qty, unit_price) VALUES (?, ?, ?, ?)');

// ---- Owner account: PIN 4321 for the counter, password for sensitive actions ----
const pin = hashSecret('4321');
const pw = hashSecret('owner@123');
db.prepare('INSERT OR REPLACE INTO owner_account(id, password_hash, password_salt, pin_hash, pin_salt) VALUES (1, ?, ?, ?, ?)').run(
  pw.hash, pw.salt, pin.hash, pin.salt
);

setSetting('min_order_retail', '70');
setSetting('shop_open', '1');
setSetting('delivery_charge_flat', '20');
setSetting('upi_vpa', 'vijayakumar4ru-3@okicici');
setSetting('upi_payee_name', 'Sathvika MV');

// ---- Categories -------------------------------------------------------------------
const categoryDefs = [
  'Grocery & Staples',
  'Beverages',
  'Snacks',
  'Dairy & Breakfast',
  'Personal Care',
  'Household',
  'Kitchen Essentials',
];
const catId = {};
for (const name of categoryDefs) {
  catId[name] = insertCategory.run(name, null).lastInsertRowid;
}

// ---- Products (40-60, realistic, placeholder images, no branded artwork) ----------
// image points at a generated placeholder SVG served from /img/products/<slug>.svg
// (painted by scripts/make-product-art.js -- see HANDOFF.md "Product artwork").
function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

const productDefs = [
  // Grocery & Staples
  ['Toor Dal', 'Local', 'Grocery & Staples', '1 kg', 'kg', 145, 130, 118, [[1,5,118],[6,20,112],[21,50,105],[51,null,98]]],
  ['Toor Dal', 'Local', 'Grocery & Staples', '500 g', 'g', 75, 68, 60, [[1,10,60],[11,40,56]]],
  ['Sona Masoori Rice', 'Local', 'Grocery & Staples', '5 kg', 'kg', 340, 310, 285, [[1,4,285],[5,15,270],[16,null,255]]],
  ['Sona Masoori Rice', 'Local', 'Grocery & Staples', '25 kg', 'kg', 1600, 1480, 1380, [[1,3,1380],[4,null,1320]]],
  ['Idli Rice', 'Local', 'Grocery & Staples', '5 kg', 'kg', 320, 295, 270, [[1,4,270],[5,null,255]]],
  ['Sunflower Oil', 'Gold Drop', 'Grocery & Staples', '1 litre', 'litre', 165, 152, 140, [[1,10,140],[11,30,133],[31,null,126]]],
  ['Groundnut Oil', 'Gold Drop', 'Grocery & Staples', '1 litre', 'litre', 210, 195, 180, [[1,10,180],[11,null,170]]],
  ['Toor Dal Premium', 'Everyday', 'Grocery & Staples', '1 kg', 'kg', 155, 140, 128, [[1,5,128],[6,20,120],[21,null,112]]],
  ['Wheat Atta', 'Everyday', 'Grocery & Staples', '5 kg', 'kg', 230, 210, 195, [[1,5,195],[6,20,185],[21,null,175]]],
  ['Wheat Atta', 'Everyday', 'Grocery & Staples', '10 kg', 'kg', 440, 405, 375, [[1,5,375],[6,null,355]]],
  ['Sugar', 'Local', 'Grocery & Staples', '1 kg', 'kg', 48, 44, 40, [[1,10,40],[11,50,38],[51,null,36]]],
  ['Salt (Iodised)', 'Tata', 'Grocery & Staples', '1 kg', 'kg', 28, 26, 22, [[1,20,22],[21,null,20]]],
  ['Chana Dal', 'Local', 'Grocery & Staples', '1 kg', 'kg', 110, 100, 90, [[1,5,90],[6,20,85],[21,null,80]]],
  ['Moong Dal', 'Local', 'Grocery & Staples', '1 kg', 'kg', 135, 122, 112, [[1,5,112],[6,20,106],[21,null,100]]],
  ['Urad Dal', 'Local', 'Grocery & Staples', '1 kg', 'kg', 150, 136, 124, [[1,5,124],[6,20,118],[21,null,110]]],
  ['Rava / Sooji', 'Everyday', 'Grocery & Staples', '1 kg', 'kg', 55, 50, 44, [[1,10,44],[11,null,41]]],
  ['Sambar Powder', 'Aachi', 'Grocery & Staples', '200 g', 'g', 65, 60, 52, [[1,20,52],[21,null,48]]],
  ['Turmeric Powder', 'Aachi', 'Grocery & Staples', '100 g', 'g', 38, 35, 30, [[1,20,30],[21,null,27]]],
  ['Red Chilli Powder', 'Aachi', 'Grocery & Staples', '200 g', 'g', 90, 82, 72, [[1,20,72],[21,null,66]]],
  // Beverages
  ['Filter Coffee Powder', 'Narasus', 'Beverages', '200 g', 'g', 130, 118, 105, [[1,10,105],[11,null,98]]],
  ['Tea Powder', 'Local Estate', 'Beverages', '250 g', 'g', 120, 108, 96, [[1,10,96],[11,null,90]]],
  ['Cola 750ml', 'Local Cola Co', 'Beverages', '750 ml', 'ml', 40, 38, 33, [[1,24,33],[25,null,30]]],
  ['Lemon Drink 600ml', 'Citrus Fizz', 'Beverages', '600 ml', 'ml', 35, 33, 29, [[1,24,29],[25,null,26]]],
  ['Packaged Drinking Water', 'AquaPure', 'Beverages', '1 litre', 'litre', 20, 18, 14, [[1,12,14],[13,null,12]]],
  ['Fruit Juice Mixed', 'Freshee', 'Beverages', '1 litre', 'litre', 110, 100, 88, [[1,12,88],[13,null,82]]],
  // Snacks
  ['Potato Chips Classic Salted', 'Crispy Bite', 'Snacks', '52 g', 'piece', 20, 20, 17, [[1,48,17],[49,null,15]]],
  ['Banana Chips', 'Southern Snacks', 'Snacks', '200 g', 'g', 60, 55, 48, [[1,20,48],[21,null,44]]],
  ['Mixture', 'Southern Snacks', 'Snacks', '200 g', 'g', 55, 50, 44, [[1,20,44],[21,null,40]]],
  ['Glucose Biscuits', 'Sunrise', 'Snacks', '150 g', 'packet', 15, 15, 12, [[1,48,12],[49,null,10]]],
  ['Cream Biscuits', 'Sunrise', 'Snacks', '100 g', 'packet', 25, 24, 20, [[1,36,20],[37,null,18]]],
  ['Cake Rusk', 'Bake House', 'Snacks', '200 g', 'packet', 45, 42, 36, [[1,20,36],[21,null,32]]],
  ['Instant Noodles', 'QuickMeal', 'Snacks', '70 g', 'packet', 14, 14, 11, [[1,48,11],[49,null,10]]],
  // Dairy & Breakfast
  ['Toned Milk', 'DairyFresh', 'Dairy & Breakfast', '500 ml', 'ml', 27, 27, 24, [[1,24,24],[25,null,22]]],
  ['Curd', 'DairyFresh', 'Dairy & Breakfast', '400 g', 'g', 35, 35, 30, [[1,24,30],[25,null,27]]],
  ['Paneer', 'DairyFresh', 'Dairy & Breakfast', '200 g', 'g', 90, 85, 74, [[1,10,74],[11,null,68]]],
  ['Butter', 'DairyFresh', 'Dairy & Breakfast', '100 g', 'g', 58, 55, 48, [[1,20,48],[21,null,44]]],
  ['Corn Flakes', 'MorningStart', 'Dairy & Breakfast', '475 g', 'box', 165, 150, 132, [[1,10,132],[11,null,122]]],
  ['Bread', 'DailyBake', 'Dairy & Breakfast', '400 g', 'packet', 45, 42, 36, [[1,20,36],[21,null,32]]],
  ['Eggs (Tray of 6)', 'Local Farm', 'Dairy & Breakfast', '6 pcs', 'packet', 42, 40, 34, [[1,20,34],[21,null,30]]],
  // Personal Care
  ['Bathing Soap', 'CleanCo', 'Personal Care', '100 g', 'piece', 40, 38, 32, [[1,48,32],[49,null,29]]],
  ['Toothpaste', 'BrightSmile', 'Personal Care', '150 g', 'piece', 95, 88, 76, [[1,24,76],[25,null,70]]],
  ['Shampoo Sachet Box', 'ShineHair', 'Personal Care', '8ml x 12', 'box', 96, 90, 78, [[1,20,78],[21,null,72]]],
  ['Hand Wash', 'CleanCo', 'Personal Care', '200 ml', 'piece', 75, 70, 60, [[1,24,60],[25,null,55]]],
  ['Talcum Powder', 'CoolFresh', 'Personal Care', '100 g', 'piece', 65, 60, 52, [[1,24,52],[25,null,48]]],
  // Household
  ['Dish Wash Bar', 'CleanCo', 'Household', '200 g', 'piece', 20, 19, 16, [[1,48,16],[49,null,14]]],
  ['Dish Wash Liquid', 'CleanCo', 'Household', '500 ml', 'piece', 110, 100, 86, [[1,20,86],[21,null,79]]],
  ['Detergent Powder', 'WhiteWash', 'Household', '1 kg', 'kg', 115, 105, 92, [[1,20,92],[21,null,84]]],
  ['Floor Cleaner', 'ShineFloor', 'Household', '1 litre', 'litre', 130, 120, 104, [[1,20,104],[21,null,96]]],
  ['Agarbatti Pack', 'PureFragrance', 'Household', '20 sticks', 'packet', 35, 32, 27, [[1,48,27],[49,null,24]]],
  ['Mosquito Coil', 'NightGuard', 'Household', 'Pack of 10', 'box', 45, 42, 36, [[1,24,36],[25,null,32]]],
  // Kitchen Essentials
  ['Aluminium Foil', 'WrapIt', 'Kitchen Essentials', '9 m', 'piece', 85, 78, 68, [[1,20,68],[21,null,62]]],
  ['Garbage Bags', 'CleanCo', 'Kitchen Essentials', 'Pack of 30', 'packet', 90, 82, 70, [[1,20,70],[21,null,64]]],
  ['Steel Scrubber', 'ShineTools', 'Kitchen Essentials', 'Pack of 2', 'packet', 25, 22, 18, [[1,48,18],[49,null,16]]],
  ['Match Box', 'FireLite', 'Kitchen Essentials', 'Pack of 10', 'box', 12, 12, 10, [[1,50,10],[51,null,9]]],
  ['Candles (Pack of 6)', 'FireLite', 'Kitchen Essentials', 'Pack of 6', 'packet', 30, 28, 24, [[1,24,24],[25,null,21]]],
];

let stockCounter = 0;
for (const [name, brand, catName, packSize, unit, mrp, retailPrice, wholesaleBasePrice, tiers] of productDefs) {
  stockCounter += 1;
  const stockQty = 20 + (stockCounter % 5 === 0 ? 3 : 40); // a few products land in "low stock"
  const image = `/img/products/${slug(brand + '-' + name + '-' + packSize)}.svg`;
  const id = insertProduct.run({
    name, brand, categoryId: catId[catName], packSize, unit, image,
    mrp, retailPrice, wholesaleBasePrice,
    moq: unit === 'kg' || unit === 'litre' ? 3 : 6,
    stockQty,
    lowStockThreshold: 5,
  }).lastInsertRowid;
  for (const [minQty, maxQty, unitPrice] of tiers) {
    insertTier.run(id, minQty, maxQty, unitPrice);
  }
}

// ---- Sample customers ---------------------------------------------------------------
const insertUser = db.prepare(
  `INSERT INTO users(role, full_name, mobile, password_hash, password_salt, business_name, business_type, gst_number, wholesale_status, mobile_verified)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
);

function makeUser({ role, name, mobile, password, business, businessType, gst, status }) {
  const { hash, salt } = hashSecret(password);
  return insertUser.run(role, name, mobile, hash, salt, business || null, businessType || null, gst || null, status || 'none').lastInsertRowid;
}

const priyaId = makeUser({ role: 'retail', name: 'Priya Raman', mobile: '9840012345', password: 'priya@123' });
const arunId = makeUser({ role: 'retail', name: 'Arun Kumar', mobile: '9840012346', password: 'arun@123' });
const rameshId = makeUser({
  role: 'wholesale', name: 'Ramesh Iyer', mobile: '9840012347', password: 'ramesh@123',
  business: 'Iyer Mess & Canteen', businessType: 'canteen', gst: '33AAAAA0000A1Z5', status: 'approved',
});
const pendingWholesaleId = makeUser({
  role: 'wholesale', name: 'Lakshmi Stores', mobile: '9840012348', password: 'lakshmi@123',
  business: 'Lakshmi Provision Stores', businessType: 'shop', gst: '', status: 'pending',
});

const insertAddress = db.prepare(
  `INSERT INTO addresses(user_id, label, line1, line2, city, pincode, is_default, is_business, maps_query) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
);
insertAddress.run(priyaId, 'Home', '12 Kutchery Road', 'Mylapore', 'Chennai', '600004', 0, encodeURIComponent('12 Kutchery Road, Mylapore, Chennai 600004'));
insertAddress.run(arunId, 'Home', '45 Bazaar Street', 'Triplicane', 'Chennai', '600005', 0, encodeURIComponent('45 Bazaar Street, Triplicane, Chennai 600005'));
insertAddress.run(rameshId, 'Business', '8 Anna Salai', 'Near Bus Stand', 'Chennai', '600002', 1, encodeURIComponent('8 Anna Salai, Near Bus Stand, Chennai 600002'));

// ---- Sample orders in different statuses --------------------------------------------
const { quoteCart } = require('./lib/pricing');
const { getProductById } = require('./routes/catalog');

const seedOrderSeq = {}; // per shift-date counter, mirrors generateOrderNo() in server/routes/orders.js

function placeSeedOrder({ userId, user, addressId, items, accountType, paymentMethod, status, paymentStatus, daysAgo }) {
  const quote = quoteCart(items, accountType, getProductById);
  const address = db.prepare('SELECT * FROM addresses WHERE id = ?').get(addressId);
  const shiftDate = new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
  const stamp = shiftDate.replace(/-/g, '');
  seedOrderSeq[stamp] = (seedOrderSeq[stamp] || 0) + 1;
  const orderNo = `SMV-${stamp}-${String(seedOrderSeq[stamp]).padStart(3, '0')}`;
  const info = db.prepare(
    `INSERT INTO orders(order_no, user_id, account_type, status, subtotal, discount, delivery_charge, total,
      payment_method, payment_status, address_line, maps_query, customer_name, customer_mobile, shift_date, placed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))`
  ).run(
    orderNo, userId, accountType, status, quote.subtotal, quote.discount, quote.deliveryCharge, quote.total,
    paymentMethod, paymentStatus, `${address.line1}, ${address.city} ${address.pincode}`, address.maps_query,
    user, db.prepare('SELECT mobile FROM users WHERE id = ?').get(userId).mobile, shiftDate, `-${daysAgo} days`
  );
  const insertItem = db.prepare(
    `INSERT INTO order_items(order_id, product_id, name_snapshot, pack_size_snapshot, unit_price, tier_label, qty, line_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const line of quote.lines) {
    insertItem.run(info.lastInsertRowid, line.productId, line.name, line.packSize, line.unitPrice, line.tierLabel, line.qty, line.lineTotal);
  }
}

const priyaAddrId = db.prepare('SELECT id FROM addresses WHERE user_id = ?').get(priyaId).id;
const rameshAddrId = db.prepare('SELECT id FROM addresses WHERE user_id = ?').get(rameshId).id;
const arunAddrId = db.prepare('SELECT id FROM addresses WHERE user_id = ?').get(arunId).id;

placeSeedOrder({ userId: priyaId, user: 'Priya Raman', addressId: priyaAddrId, accountType: 'retail', paymentMethod: 'cod', status: 'delivered', paymentStatus: 'received', daysAgo: 3, items: [{ productId: 3, qty: 1 }, { productId: 6, qty: 2 }, { productId: 33, qty: 1 }] });
placeSeedOrder({ userId: priyaId, user: 'Priya Raman', addressId: priyaAddrId, accountType: 'retail', paymentMethod: 'gpay', status: 'out_for_delivery', paymentStatus: 'received', daysAgo: 0, items: [{ productId: 11, qty: 2 }, { productId: 40, qty: 1 }] });
placeSeedOrder({ userId: arunId, user: 'Arun Kumar', addressId: arunAddrId, accountType: 'retail', paymentMethod: 'cod', status: 'preparing', paymentStatus: 'pending', daysAgo: 0, items: [{ productId: 26, qty: 3 }, { productId: 34, qty: 1 }] });
placeSeedOrder({ userId: rameshId, user: 'Ramesh Iyer', addressId: rameshAddrId, accountType: 'wholesale', paymentMethod: 'upi', status: 'confirmed', paymentStatus: 'pending', daysAgo: 0, items: [{ productId: 1, qty: 25 }, { productId: 6, qty: 15 }, { productId: 11, qty: 30 }] });
placeSeedOrder({ userId: rameshId, user: 'Ramesh Iyer', addressId: rameshAddrId, accountType: 'wholesale', paymentMethod: 'cod', status: 'delivered', paymentStatus: 'received', daysAgo: 5, items: [{ productId: 3, qty: 6 }, { productId: 9, qty: 8 }] });
placeSeedOrder({ userId: priyaId, user: 'Priya Raman', addressId: priyaAddrId, accountType: 'retail', paymentMethod: 'phonepe', status: 'placed', paymentStatus: 'pending', daysAgo: 0, items: [{ productId: 20, qty: 1 }, { productId: 39, qty: 1 }] });

// ---- Placeholder product artwork ----------------------------------------------------
// Generates a simple colored SVG per product (initials + category color band) so the
// catalog never shows a broken image. No copyrighted brand art is used anywhere.
const IMG_DIR = path.join(__dirname, '..', 'public', 'img', 'products');
fs.mkdirSync(IMG_DIR, { recursive: true });

const CATEGORY_COLORS = {
  'Grocery & Staples': '#2e7d32',
  'Beverages': '#0277bd',
  'Snacks': '#ef6c00',
  'Dairy & Breakfast': '#6a1b9a',
  'Personal Care': '#00838f',
  'Household': '#5d4037',
  'Kitchen Essentials': '#455a64',
};

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

const allProducts = db
  .prepare('SELECT p.*, c.name AS category_name FROM products p JOIN categories c ON c.id = p.category_id')
  .all();

for (const p of allProducts) {
  const color = CATEGORY_COLORS[p.category_name] || '#37474f';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">
  <rect width="240" height="240" rx="16" fill="#f4f6f4"/>
  <rect y="0" width="240" height="72" fill="${color}"/>
  <text x="120" y="46" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="#ffffff" text-anchor="middle">${initials(p.name)}</text>
  <text x="120" y="132" font-family="Arial, sans-serif" font-size="17" font-weight="600" fill="#1b1b1b" text-anchor="middle">${escapeXml(p.name)}</text>
  <text x="120" y="158" font-family="Arial, sans-serif" font-size="13" fill="#5a5a5a" text-anchor="middle">${escapeXml(p.pack_size)}</text>
  <text x="120" y="210" font-family="Arial, sans-serif" font-size="12" fill="${color}" text-anchor="middle">${escapeXml(p.category_name)}</text>
</svg>`;
  fs.writeFileSync(path.join(IMG_DIR, path.basename(p.image)), svg, 'utf8');
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

console.log(' Product artwork:', allProducts.length, 'placeholder SVGs written to public/img/products/');
console.log('');
console.log('Seed complete:');
console.log(' Products:', db.prepare('SELECT COUNT(*) c FROM products').get().c);
console.log(' Categories:', db.prepare('SELECT COUNT(*) c FROM categories').get().c);
console.log(' Users:', db.prepare('SELECT COUNT(*) c FROM users').get().c);
console.log(' Orders:', db.prepare('SELECT COUNT(*) c FROM orders').get().c);
console.log('');
console.log(' Owner PIN: 4321   Owner password: owner@123');
console.log(' Retail login: 9840012345 / priya@123');
console.log(' Wholesale (approved) login: 9840012347 / ramesh@123');
console.log(' Wholesale (pending) login: 9840012348 / lakshmi@123');
