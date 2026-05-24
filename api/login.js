'use strict';
const crypto = require('crypto');

function expectedToken() {
  const secret = process.env.SESSION_SECRET || 'dev-secret-change-me';
  return crypto.createHmac('sha256', secret).update('gcc-auth-v1').digest('hex');
}

async function readBody(req) {
  return new Promise(function(resolve, reject) {
    let body = '';
    req.on('data', function(chunk) { body += chunk; });
    req.on('end',   function()      { resolve(body); });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Location', '/login');
    return res.status(302).end();
  }

  const password = process.env.DASHBOARD_PASSWORD || '';
  if (!password) {
    // Env var not configured — let dev through, warn in logs
    console.warn('[auth] DASHBOARD_PASSWORD not set; access denied');
    res.setHeader('Location', '/login?error=config');
    return res.status(302).end();
  }

  const body  = await readBody(req);
  const params = new URLSearchParams(body);
  const input  = params.get('password') || '';

  // Constant-time comparison to prevent timing attacks
  const inputBuf    = Buffer.from(input);
  const passwordBuf = Buffer.from(password);
  const match = inputBuf.length === passwordBuf.length &&
                crypto.timingSafeEqual(inputBuf, passwordBuf);

  if (!match) {
    res.setHeader('Location', '/login?error=1');
    return res.status(302).end();
  }

  const token      = expectedToken();
  const isProduction = process.env.VERCEL_ENV === 'production';
  const cookieParts = [
    'gcc_session=' + token,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    'Max-Age=86400',   // 24 hours
  ];
  if (isProduction) cookieParts.push('Secure');

  res.setHeader('Set-Cookie', cookieParts.join('; '));
  res.setHeader('Location', '/');
  return res.status(302).end();
};
