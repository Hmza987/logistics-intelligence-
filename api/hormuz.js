'use strict';
// Hormuz live-data endpoint
// Priority: 1) IMF PortWatch (public REST API) → 2) straits.live scrape → 3) hardcoded fallback

const https = require('https');
const http  = require('http');

// ─── Cache (serverless warm-instance cache, TTL 10 min) ───────────────────────
let _cache   = null;
let _cacheAt = 0;
const CACHE_TTL = 10 * 60 * 1000;

// ─── Hardcoded fallback (mirrors what index.html uses) ────────────────────────
// Kept in sync manually; scraper/API results replace these when available.
// IMF PortWatch AIS-verified (chokepoint6) — May 11-17 confirmed, May 18-24 estimated
// UNCTAD pre-crisis baseline: ~130/day (Feb 2026). Current: ~2-6/day AIS-verified.
const FALLBACK_COUNTS    = [7,8,6,7,5,4,2,3,4,3,4,5,5,6];
const FALLBACK_TANKERS   = [4,5,4,4,3,2,1,2,2,2,2,3,3,4];
const FALLBACK_CONTAINERS= [0,0,0,0,0,0,0,0,0,0,0,0,0,0];
const FALLBACK_LNG       = [1,1,1,1,1,1,1,1,1,1,1,1,1,1];
const FALLBACK_OTHER     = [2,2,1,2,1,1,0,0,1,0,1,1,1,1];

function buildFallback() {
  const today  = new Date();
  const labels = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    labels.push(
      (d.getMonth() + 1).toString().padStart(2, '0') + '/' +
      d.getDate().toString().padStart(2, '0')
    );
  }
  const lastIdx = FALLBACK_COUNTS.length - 1;
  return {
    source:   'fallback',
    updated:  new Date().toISOString(),
    transits: {
      labels,
      counts:     FALLBACK_COUNTS,
      today:      FALLBACK_COUNTS[lastIdx],
      tankers:    FALLBACK_TANKERS,
      containers: FALLBACK_CONTAINERS,
      lng:        FALLBACK_LNG,
      other:      FALLBACK_OTHER,
    },
    vessels:  {
      tankers:    FALLBACK_TANKERS[lastIdx],
      containers: FALLBACK_CONTAINERS[lastIdx],
      lng:        FALLBACK_LNG[lastIdx],
      other:      FALLBACK_OTHER[lastIdx],
    },
    status: 'Hormuz restricted · ~2–6/day AIS-verified (IMF PortWatch) · dark fleet not counted',
  };
}

// ─── Minimal HTTP fetch (no external deps beyond Node built-ins) ──────────────
function rawFetch(url, maxRedirects = 4) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'GCC-Logistics-Dashboard/1.0 (open-source; maritime data aggregation)',
        'Accept':     'text/html,application/json,*/*',
      },
    }, (res) => {
      // Follow redirects
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return rawFetch(next, maxRedirects - 1).then(resolve).catch(reject);
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.setTimeout(9000, () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

// ─── Source: Yahoo Finance (Brent crude futures BZ=F, free, no key) ──────────
async function fetchBrent() {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/BZ=F?interval=1d&range=5d';
  const { status, body } = await rawFetch(url);
  if (status !== 200) throw new Error(`Yahoo Finance HTTP ${status}`);
  const json = JSON.parse(body);
  const res  = json.chart && json.chart.result && json.chart.result[0];
  if (!res || !res.meta) throw new Error('Yahoo Finance: no result');
  const price   = res.meta.regularMarketPrice;
  const prev    = res.meta.chartPreviousClose;
  const changeP = prev ? +((price - prev) / prev * 100).toFixed(2) : null;
  return { price: +price.toFixed(2), changeP, updated: new Date().toISOString() };
}

// ─── Source: Stooq (Baltic Dry Index, free, no key) ──────────────────────────
async function fetchBDI() {
  const url = 'https://stooq.com/q/d/l/?s=bdi.i&i=d';
  const { status, body } = await rawFetch(url);
  if (status !== 200) throw new Error(`Stooq HTTP ${status}`);
  const lines = body.trim().split('\n').filter(l => l && !l.startsWith('Date'));
  if (lines.length === 0) throw new Error('Stooq: no data rows');
  const last    = lines[lines.length - 1].split(',');
  const prev    = lines.length > 1 ? lines[lines.length - 2].split(',') : null;
  const value   = parseFloat(last[4]);
  const prevV   = prev ? parseFloat(prev[4]) : null;
  const changeP = prevV ? +((value - prevV) / prevV * 100).toFixed(2) : null;
  if (isNaN(value)) throw new Error('Stooq: invalid value');
  return { value, changeP, updated: new Date().toISOString() };
}

// ─── Source 1: IMF PortWatch public ArcGIS REST API ──────────────────────────
// Chokepoint 6 = Strait of Hormuz
// Docs: https://portwatch.imf.org  (ArcGIS FeatureService, open access)
async function fetchIMFPortWatch() {
  const base   = 'https://services8.arcgis.com/RoXJobLkqBWynurN/arcgis/rest/services/portwatch_chokepoints_daily/FeatureServer/0/query';
  const params = new URLSearchParams({
    where:            "chokepoint_id='6'",
    outFields:        'date,n_total,n_tanker,n_container,n_bulk,n_other',
    orderByFields:    'date DESC',
    resultRecordCount: '21',
    f:                'json',
  });
  const url = `${base}?${params}`;

  const { status, body } = await rawFetch(url);
  if (status !== 200) throw new Error(`PortWatch HTTP ${status}`);

  const json = JSON.parse(body);
  if (!json.features || json.features.length === 0) throw new Error('PortWatch: no features');

  // Features come in newest-first; we want oldest-first for the chart
  const rows = json.features
    .map((f) => f.attributes)
    .sort((a, b) => a.date - b.date)
    .slice(-14);

  const labels = rows.map((r) => {
    const d = new Date(r.date);
    return (d.getUTCMonth() + 1).toString().padStart(2, '0') + '/' +
           d.getUTCDate().toString().padStart(2, '0');
  });
  const counts   = rows.map((r) => r.n_total  ?? 0);
  const tankers  = rows.map((r) => r.n_tanker  ?? 0);
  const containers = rows.map((r) => r.n_container ?? 0);
  const lng      = rows.map((r) => r.n_bulk   ?? 0);
  const other    = rows.map((r) => r.n_other  ?? 0);

  const lastRow = rows[rows.length - 1];

  return {
    source:   'imf-portwatch',
    updated:  new Date().toISOString(),
    transits: {
      labels,
      counts,
      today:    counts[counts.length - 1],
      tankers,
      containers,
      lng,
      other,
    },
    vessels: {
      tankers:    lastRow.n_tanker    ?? 1,
      containers: lastRow.n_container ?? 0,
      lng:        lastRow.n_bulk      ?? 1,
      other:      lastRow.n_other     ?? 0,
    },
    status: `Hormuz live · ${counts[counts.length - 1]} transits today (IMF PortWatch)`,
  };
}

// ─── Source 2: straits.live HTML scrape ──────────────────────────────────────
// straits.live shows vessel events per strait. We look for transit-count patterns.
// Selectors/regex here may need updating if their HTML structure changes.
async function fetchStraitsLive() {
  const { status, body } = await rawFetch('https://straits.live');
  if (status !== 200) throw new Error(`straits.live HTTP ${status}`);

  const lines = body
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');

  // Look for patterns like "3 vessels", "5 transits", "2/day" near "Hormuz"
  const hormuzIdx = lines.toLowerCase().indexOf('hormuz');
  if (hormuzIdx === -1) throw new Error('straits.live: Hormuz not found on page');

  // Grab ±800 chars around the first "Hormuz" mention
  const snippet = lines.slice(Math.max(0, hormuzIdx - 200), hormuzIdx + 600);

  // Try to pull a daily count: "N transits" or "N vessels"
  const countMatch = snippet.match(/(\d+)\s*(?:vessel|transit|crossing|ship)/i);
  if (!countMatch) throw new Error('straits.live: no transit count found in snippet');

  const today = parseInt(countMatch[1], 10);

  // Build a rolling 14-day array — we only have today's number from this scrape,
  // so we blend it into the fallback series for the prior 13 days
  const fb     = buildFallback();
  const counts = [...fb.transits.counts.slice(0, 13), today];

  return {
    source:   'straits-live',
    updated:  new Date().toISOString(),
    transits: {
      labels:     fb.transits.labels,
      counts,
      today,
      tankers:    fb.transits.tankers,
      containers: fb.transits.containers,
      lng:        fb.transits.lng,
      other:      fb.transits.other,
    },
    vessels:  fb.vessels,
    status:   `Hormuz live · ${today} transits today (straits.live)`,
  };
}

// ─── Main resolver (waterfall) ────────────────────────────────────────────────
async function getLiveData() {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL) return _cache;

  let data = null;

  try {
    data = await fetchIMFPortWatch();
    console.log('[hormuz] source: imf-portwatch');
  } catch (e1) {
    console.warn('[hormuz] IMF PortWatch failed:', e1.message);
    try {
      data = await fetchStraitsLive();
      console.log('[hormuz] source: straits-live');
    } catch (e2) {
      console.warn('[hormuz] straits.live failed:', e2.message);
      data = buildFallback();
      console.log('[hormuz] source: fallback');
    }
  }

  // Fetch market data concurrently — failures don't break the transit response
  const [brentResult, bdiResult] = await Promise.allSettled([fetchBrent(), fetchBDI()]);
  data.market = {
    brent: brentResult.status === 'fulfilled' ? brentResult.value : null,
    bdi:   bdiResult.status   === 'fulfilled' ? bdiResult.value   : null,
  };
  if (brentResult.status === 'rejected') console.warn('[hormuz] Brent fetch failed:', brentResult.reason.message);
  if (bdiResult.status   === 'rejected') console.warn('[hormuz] BDI fetch failed:',   bdiResult.reason.message);

  _cache   = data;
  _cacheAt = Date.now();
  return data;
}

// ─── Vercel serverless handler ────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Allow forced cache-bust via ?refresh=1 (useful during development)
  if (req.query && req.query.refresh === '1') {
    _cache   = null;
    _cacheAt = 0;
  }

  try {
    const data = await getLiveData();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=300');
    return res.status(200).json(data);
  } catch (err) {
    console.error('[hormuz] fatal:', err);
    return res.status(500).json({ error: 'Internal server error', fallback: buildFallback() });
  }
};
