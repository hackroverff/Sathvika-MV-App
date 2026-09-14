'use strict';
const crypto = require('node:crypto');

function hashSecret(secret, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(secret), salt, 64).toString('hex');
  return { hash, salt };
}

function verifySecret(secret, salt, expectedHash) {
  const { hash } = hashSecret(secret, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

function genOtp() {
  return String(crypto.randomInt(100000, 999999));
}

module.exports = { hashSecret, verifySecret, newToken, genOtp };
