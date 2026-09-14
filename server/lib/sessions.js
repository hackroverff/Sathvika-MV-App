'use strict';
const { db } = require('../db');
const { newToken } = require('./crypto-util');

const CUSTOMER_TTL_HOURS = 24 * 14; // 14 days, "remember me"-ish for a shopping app
const OWNER_OPS_TTL_HOURS = 12; // one shift
const OWNER_ADMIN_TTL_HOURS = 1; // sensitive scope, short-lived on purpose

function create(scope, userId, ttlHours) {
  const token = newToken();
  db.prepare(
    `INSERT INTO sessions(token, user_id, scope, expires_at)
     VALUES (?, ?, ?, datetime('now', ?))`
  ).run(token, userId ?? null, scope, `+${ttlHours} hours`);
  return token;
}

function createCustomerSession(userId) {
  return create('customer', userId, CUSTOMER_TTL_HOURS);
}
function createOwnerOpsSession() {
  return create('owner_ops', null, OWNER_OPS_TTL_HOURS);
}
function createOwnerAdminSession() {
  return create('owner_admin', null, OWNER_ADMIN_TTL_HOURS);
}

function resolve(token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')`
    )
    .get(token);
  return row || null;
}

function destroy(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

module.exports = {
  createCustomerSession,
  createOwnerOpsSession,
  createOwnerAdminSession,
  resolve,
  destroy,
};
