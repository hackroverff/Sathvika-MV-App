'use strict';
const path = require('node:path');
const express = require('express');
require('./db'); // ensures schema exists even if reset was never run

const app = express();
app.use(express.json({ limit: '10mb' })); // product photo uploads are base64 JSON (see owner.js photo route)

app.use('/api/auth', require('./routes/auth').router);
app.use('/api/catalog', require('./routes/catalog').router);
app.use('/api/orders', require('./routes/orders').router);
app.use('/api/owner', require('./routes/owner').router);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Static frontend (PWA). Placed after API routes so /api/* never falls
// through to index.html.
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Centralized error handler so an unexpected exception returns JSON, not an
// HTML stack trace, to a fetch() caller.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

const PORT = process.env.PORT || 4173;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Sathvika MV running at http://localhost:${PORT}`);
  });
}

module.exports = app;
