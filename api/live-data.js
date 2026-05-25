'use strict';
const fetch = require('node-fetch');

// ── /api/live-data ─────────────────────────────────────────────────────────
// Returns live Brent crude price + (optionally) FBX01 composite index.
//
// Data sources:
//   Brent crude  — Yahoo Finance BZ=F  (no API key required)
//                  fallback: Alpha Vantage (set ALPHAVANTAGE_API_KEY in Vercel env)
//   FBX01        — Freightos Baltic Index (set FREIGHTOS_API_KEY in Vercel env)
//
// Response is CDN-cached for 1 hour so the page load is always fast.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const result = { brent: null, fbx: null, ts: new Date().toISOString(), src: {} };

  // ── 1. Brent crude ────────────────────────────────────────────────────────
  // Primary: Yahoo Finance (BZ=F futures, no key needed)
  try {
    const r = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/BZ=F?interval=1d&range=1d',
      { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }, timeout: 6000 }
    );
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    const price = d?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (price && price > 20 && price < 300) {
      result.brent = Math.round(price * 100) / 100;
      result.src.brent = 'Yahoo Finance BZ=F';
    } else {
      throw new Error('unexpected price: ' + price);
    }
  } catch (e) {
    result.src.brent_yf_err = e.message;

    // Fallback: Alpha Vantage (free tier — register at alphavantage.co)
    const avKey = process.env.ALPHAVANTAGE_API_KEY;
    if (avKey) {
      try {
        const r = await fetch(
          `https://www.alphavantage.co/query?function=BRENT&interval=daily&apikey=${avKey}`,
          { timeout: 6000 }
        );
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        // Response: { data: [{ date, value }, ...] } newest first
        const latest = d?.data?.[0]?.value;
        if (latest && latest !== '.') {
          result.brent = Math.round(parseFloat(latest) * 100) / 100;
          result.src.brent = 'Alpha Vantage (daily)';
        } else {
          throw new Error('no value in response');
        }
      } catch (e2) {
        result.src.brent_av_err = e2.message;
      }
    } else {
      result.src.brent_av = 'no ALPHAVANTAGE_API_KEY set';
    }
  }

  // ── 2. FBX01 composite (Freightos Baltic Index) ───────────────────────────
  // Register free at: https://fbx.freightos.com/get-the-data/
  // Add FREIGHTOS_API_KEY to Vercel environment variables once you have a key.
  const fbxKey = process.env.FREIGHTOS_API_KEY;
  if (fbxKey) {
    try {
      // Endpoint from Freightos API docs — update path if their docs differ
      const r = await fetch(
        'https://fbx.freightos.com/api/v1/rates?index=FBX01',
        {
          headers: { 'Authorization': 'Bearer ' + fbxKey, 'Accept': 'application/json' },
          timeout: 6000
        }
      );
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      // Freightos returns { index, rate, week, currency } or similar
      result.fbx = {
        rate:  d.rate  || d.value || d.price || null,
        week:  d.week  || d.date  || null,
        index: d.index || 'FBX01'
      };
      result.src.fbx = 'Freightos FBX API';
    } catch (e) {
      result.src.fbx_err = e.message;
    }
  } else {
    result.src.fbx = 'no FREIGHTOS_API_KEY set';
  }

  return res.status(200).json(result);
};
