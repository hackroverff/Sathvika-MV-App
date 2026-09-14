'use strict';
const { db } = require('../db');
const sessions = require('./sessions');

function tokenFrom(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

// Attaches req.session (if any valid token present) without requiring one.
function optionalAuth(req, res, next) {
  const token = tokenFrom(req);
  const session = sessions.resolve(token);
  req.session = session;
  if (session && session.scope === 'customer') {
    req.user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
  }
  next();
}

function requireCustomer(req, res, next) {
  const token = tokenFrom(req);
  const session = sessions.resolve(token);
  if (!session || session.scope !== 'customer') {
    return res.status(401).json({ error: 'Please sign in to continue.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
  if (!user) return res.status(401).json({ error: 'Please sign in to continue.' });
  req.session = session;
  req.user = user;
  next();
}

function requireOwnerOps(req, res, next) {
  const token = tokenFrom(req);
  const session = sessions.resolve(token);
  if (!session || (session.scope !== 'owner_ops' && session.scope !== 'owner_admin')) {
    return res.status(401).json({ error: 'Owner PIN sign-in required.' });
  }
  req.session = session;
  next();
}

function requireOwnerAdmin(req, res, next) {
  const token = tokenFrom(req);
  const session = sessions.resolve(token);
  if (!session || session.scope !== 'owner_admin') {
    return res.status(401).json({ error: 'This action needs the owner password sign-in.' });
  }
  req.session = session;
  next();
}

module.exports = { optionalAuth, requireCustomer, requireOwnerOps, requireOwnerAdmin };
