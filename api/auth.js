'use strict';
const crypto = require('crypto');

function expectedToken() {
  const secret = process.env.SESSION_SECRET || 'dev-secret-change-me';
  return crypto.createHmac('sha256', secret).update('gcc-auth-v1').digest('hex');
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach(function(part) {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  });
  return out;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');

  const cookies = parseCookies(req.headers.cookie);
  const ok = !!process.env.DASHBOARD_PASSWORD &&
             cookies['gcc_session'] === expectedToken();

  return res.status(ok ? 200 : 401).json({ ok });
};
