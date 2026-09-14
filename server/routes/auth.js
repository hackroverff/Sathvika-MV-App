'use strict';
const express = require('express');
const { db } = require('../db');
const { hashSecret, verifySecret, genOtp } = require('../lib/crypto-util');
const sessions = require('../lib/sessions');
const { requireCustomer } = require('../lib/auth-mid');
const { notify } = require('../lib/notify');

const router = express.Router();

const MOBILE_RE = /^[6-9]\d{9}$/; // Indian mobile numbers, 10 digits starting 6-9

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

// ---- Step 1: request signup OTP -------------------------------------------------
router.post('/signup/request-otp', (req, res) => {
  const { fullName, mobile, password, confirmPassword } = req.body || {};
  if (!fullName || !mobile || !password || !confirmPassword) {
    return badRequest(res, 'Full name, mobile number and password are required.');
  }
  if (!MOBILE_RE.test(mobile)) return badRequest(res, 'Enter a valid 10-digit mobile number.');
  if (password.length < 6) return badRequest(res, 'Password must be at least 6 characters.');
  if (password !== confirmPassword) return badRequest(res, 'Passwords do not match.');

  const existing = db.prepare('SELECT id FROM users WHERE mobile = ?').get(mobile);
  if (existing) return badRequest(res, 'An account with this mobile number already exists.');

  const code = genOtp();
  db.prepare(
    `INSERT INTO otp_codes(mobile, code, purpose, expires_at) VALUES (?, ?, 'signup', datetime('now', '+10 minutes'))`
  ).run(mobile, code);

  notify(null, mobile, `Your Sathvika MV signup OTP is ${code}. Valid for 10 minutes.`);

  // Demo mode: no real SMS gateway is wired up (see HANDOFF.md), so the OTP is
  // returned in the response and logged to the notifications table so the
  // flow is fully testable end-to-end without a paid SMS provider.
  res.json({ ok: true, message: 'OTP sent.', devOtp: code });
});

// ---- Step 2: verify OTP + create account -----------------------------------------
router.post('/signup/verify', (req, res) => {
  const {
    fullName,
    mobile,
    password,
    otp,
    accountType,
    businessName,
    businessType,
    gstNumber,
  } = req.body || {};

  if (!fullName || !mobile || !password || !otp) return badRequest(res, 'Missing required fields.');
  if (!['retail', 'wholesale'].includes(accountType)) return badRequest(res, 'Choose an account type.');
  if (accountType === 'wholesale' && !businessName) {
    return badRequest(res, 'Business name is required for a wholesale account.');
  }

  const otpRow = db
    .prepare(
      `SELECT * FROM otp_codes WHERE mobile = ? AND purpose = 'signup' AND consumed = 0
       AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1`
    )
    .get(mobile);
  if (!otpRow || otpRow.code !== String(otp)) return badRequest(res, 'Incorrect or expired OTP.');

  const existing = db.prepare('SELECT id FROM users WHERE mobile = ?').get(mobile);
  if (existing) return badRequest(res, 'An account with this mobile number already exists.');

  const { hash, salt } = hashSecret(password);
  const wholesaleStatus = accountType === 'wholesale' ? 'pending' : 'none';

  const info = db
    .prepare(
      `INSERT INTO users(role, full_name, mobile, password_hash, password_salt,
        business_name, business_type, gst_number, wholesale_status, mobile_verified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(
      accountType,
      fullName,
      mobile,
      hash,
      salt,
      businessName || null,
      businessType || null,
      gstNumber || null,
      wholesaleStatus
    );

  db.prepare('UPDATE otp_codes SET consumed = 1 WHERE id = ?').run(otpRow.id);

  const token = sessions.createCustomerSession(info.lastInsertRowid);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);

  if (accountType === 'wholesale') {
    notify(
      user.id,
      user.mobile,
      'Thanks for registering a wholesale account. It is pending approval by the shop owner; you will see retail pricing until approved.'
    );
  }

  res.json({ ok: true, token, user: publicUser(user) });
});

// ---- Login -------------------------------------------------------------------------
router.post('/login', (req, res) => {
  const { mobile, password } = req.body || {};
  if (!mobile || !password) return badRequest(res, 'Mobile number and password are required.');
  const user = db.prepare('SELECT * FROM users WHERE mobile = ?').get(mobile);
  if (!user || !verifySecret(password, user.password_salt, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect mobile number or password.' });
  }
  const token = sessions.createCustomerSession(user.id);
  res.json({ ok: true, token, user: publicUser(user) });
});

router.post('/logout', requireCustomer, (req, res) => {
  sessions.destroy(req.session.token);
  res.json({ ok: true });
});

router.get('/me', requireCustomer, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// ---- Password reset via OTP --------------------------------------------------------
router.post('/reset/request-otp', (req, res) => {
  const { mobile } = req.body || {};
  const user = db.prepare('SELECT id FROM users WHERE mobile = ?').get(mobile);
  // Always respond ok (don't leak which numbers are registered), but only
  // actually issue an OTP for real accounts.
  if (user) {
    const code = genOtp();
    db.prepare(
      `INSERT INTO otp_codes(mobile, code, purpose, expires_at) VALUES (?, ?, 'reset', datetime('now', '+10 minutes'))`
    ).run(mobile, code);
    notify(user.id, mobile, `Your Sathvika MV password reset OTP is ${code}.`);
    return res.json({ ok: true, devOtp: code });
  }
  res.json({ ok: true });
});

router.post('/reset/confirm', (req, res) => {
  const { mobile, otp, newPassword } = req.body || {};
  if (!mobile || !otp || !newPassword) return badRequest(res, 'Missing required fields.');
  if (newPassword.length < 6) return badRequest(res, 'Password must be at least 6 characters.');

  const otpRow = db
    .prepare(
      `SELECT * FROM otp_codes WHERE mobile = ? AND purpose = 'reset' AND consumed = 0
       AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1`
    )
    .get(mobile);
  if (!otpRow || otpRow.code !== String(otp)) return badRequest(res, 'Incorrect or expired OTP.');

  const user = db.prepare('SELECT * FROM users WHERE mobile = ?').get(mobile);
  if (!user) return badRequest(res, 'Account not found.');

  const { hash, salt } = hashSecret(newPassword);
  db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').run(hash, salt, user.id);
  db.prepare('UPDATE otp_codes SET consumed = 1 WHERE id = ?').run(otpRow.id);

  res.json({ ok: true });
});

function publicUser(user) {
  return {
    id: user.id,
    role: user.role,
    fullName: user.full_name,
    mobile: user.mobile,
    businessName: user.business_name,
    businessType: user.business_type,
    gstNumber: user.gst_number,
    wholesaleStatus: user.wholesale_status,
    language: user.language,
    // effectivePricingType is what the frontend should key product-card pricing off of --
    // a pending/suspended/rejected wholesale account still sees retail prices.
    effectivePricingType: user.role === 'wholesale' && user.wholesale_status === 'approved' ? 'wholesale' : 'retail',
  };
}

module.exports = { router, publicUser };
