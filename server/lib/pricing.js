'use strict';
// Server-side pricing engine. The frontend only ever displays numbers this
// module produced -- it must never recompute a chargeable total itself.
// See HANDOFF.md "Pricing trust boundary".

const { db, getSetting } = require('../db');

const getTiersStmt = db.prepare(
  'SELECT min_qty, max_qty, unit_price FROM wholesale_tiers WHERE product_id = ? ORDER BY min_qty ASC'
);

/**
 * Resolve the unit price + tier label for a product at a given quantity,
 * for a given account type. Retail always uses retail_price (MRP-derived
 * selling price); wholesale uses the tier table, falling back to the
 * product's wholesale_base_price if no tier matches (e.g. qty below MOQ,
 * which callers should reject before checkout).
 */
function resolveUnitPrice(product, qty, accountType) {
  if (accountType !== 'wholesale') {
    return { unitPrice: product.retail_price, tierLabel: null };
  }
  const tiers = getTiersStmt.all(product.id);
  for (const t of tiers) {
    if (qty >= t.min_qty && (t.max_qty === null || qty <= t.max_qty)) {
      const label = t.max_qty === null ? `${t.min_qty}+` : `${t.min_qty}-${t.max_qty}`;
      return { unitPrice: t.unit_price, tierLabel: label };
    }
  }
  return { unitPrice: product.wholesale_base_price, tierLabel: null };
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Price a full line of {product_id, qty} against the DB. Throws on any
 * invalid product, inactive product, out-of-stock, or below-MOQ line so
 * checkout can never be forced into an inconsistent state.
 */
function quoteCart(items, accountType, getProductById) {
  const lines = [];
  let subtotal = 0;
  let totalSavings = 0;

  for (const { productId, qty } of items) {
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new PricingError(`Invalid quantity for product ${productId}`);
    }
    const product = getProductById(productId);
    if (!product || !product.active) {
      throw new PricingError(`Product ${productId} is not available`);
    }
    if (product.stock_qty <= 0) {
      throw new PricingError(`${product.name} is out of stock`);
    }
    if (accountType === 'wholesale' && qty < product.moq) {
      throw new PricingError(`${product.name} requires a minimum order quantity of ${product.moq}`);
    }
    if (qty > product.stock_qty) {
      throw new PricingError(`Only ${product.stock_qty} of ${product.name} left in stock`);
    }

    const { unitPrice, tierLabel } = resolveUnitPrice(product, qty, accountType);
    const lineTotal = round2(unitPrice * qty);
    const mrpLineTotal = round2(product.mrp * qty);

    lines.push({
      productId: product.id,
      name: product.name,
      packSize: product.pack_size,
      qty,
      unitPrice,
      tierLabel,
      lineTotal,
      mrp: product.mrp,
      youSave: round2(mrpLineTotal - lineTotal),
    });
    subtotal = round2(subtotal + lineTotal);
    totalSavings = round2(totalSavings + round2(mrpLineTotal - lineTotal));
  }

  const deliveryCharge = Number(getSetting('delivery_charge_flat', '0'));
  const total = round2(subtotal + deliveryCharge);
  const minOrder = Number(getSetting('min_order_retail', '70'));
  const meetsMinimum = accountType === 'wholesale' ? true : subtotal >= minOrder;

  return {
    lines,
    subtotal,
    discount: totalSavings,
    deliveryCharge,
    total,
    minOrder,
    meetsMinimum,
  };
}

class PricingError extends Error {}

module.exports = { quoteCart, resolveUnitPrice, round2, PricingError };
