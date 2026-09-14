'use strict';
const { db } = require('../db');

// Phase 1 has no paid SMS/WhatsApp Business API wired up (see HANDOFF.md). Every
// customer-facing notification is still generated at the right moment and
// recorded here, so swapping in a real gateway later is a one-function change
// in this file, not an app-wide rework.
function notify(userId, mobile, message, channel = 'sms') {
  db.prepare('INSERT INTO notifications(user_id, channel, message) VALUES (?, ?, ?)').run(
    userId,
    channel,
    message
  );
  return { userId, mobile, message, channel };
}

module.exports = { notify };
