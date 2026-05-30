'use strict';
const crypto = require('crypto');

function expectedToken() {
  const secret = process.env.SESSION_SECRET || 'dev-secret-change-me';
  return crypto.createHmac('sha256', secret).update('gcc-auth-v1').digest('hex');
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');

  // If no password configured, allow access (useful for local dev)
  const password = process.env.DASHBOARD_PASSWORD || '';
  if (!password) return res.status(200).json({ ok: true });

  // Parse cookies
  const cookies = {};
  (req.headers.cookie || '').split(';').forEach(function(c) {
    var parts = c.trim().split('=');
    if (parts[0]) cookies[parts[0].trim()] = (parts[1] || '').trim();
  });

  if (cookies.gcc_session === expectedToken()) {
    return res.status(200).json({ ok: true });
  }
  return res.status(401).json({ ok: false });
};
