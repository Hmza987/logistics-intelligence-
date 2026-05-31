'use strict';
// Lightweight password verify — called by the in-page overlay on every load.
// Returns {ok:true} if password matches DASHBOARD_PASSWORD env var.
// No cookie is set — auth state lives only in the page's JS memory.
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const correct = process.env.DASHBOARD_PASSWORD || '';
  // If no password configured, always allow (local dev / unconfigured)
  if (!correct) return res.status(200).json({ ok: true });

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const params  = new URLSearchParams(Buffer.concat(chunks).toString());
  const entered = params.get('password') || '';

  // Constant-time comparison
  const crypto  = require('crypto');
  const a = Buffer.from(entered.padEnd(64));
  const b = Buffer.from(correct.padEnd(64));
  const match = entered.length === correct.length &&
                crypto.timingSafeEqual(a, b);

  return res.status(200).json({ ok: match });
};
