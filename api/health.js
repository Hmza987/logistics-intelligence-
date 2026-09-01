'use strict';
// /api/health — probes all data sources and reports live vs fallback status
// Returns 200 (healthy/degraded) or 503 (critical — all Hormuz sources down)

const https = require('https');

function rawFetch(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const req = https.get(url, {
      headers: { 'User-Agent': 'GCC-Logistics-Dashboard/health-check' },
    }, (res) => {
      // Follow one redirect level at most
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        return rawFetch(res.headers.location, timeoutMs).then(resolve).catch(reject);
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body, latencyMs: Date.now() - start }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function checkIMFPortWatch() {
  const url =
    'https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query' +
    "?where=chokepoint_id%3D'6'&outFields=date%2Cn_total&orderByFields=date+DESC&resultRecordCount=1&f=json";
  try {
    const { status, body, latencyMs } = await rawFetch(url);
    if (status !== 200) return { ok: false, error: `HTTP ${status}`, latencyMs };
    const json = JSON.parse(body);
    if (!json.features || json.features.length === 0) return { ok: false, error: 'no features', latencyMs };
    const attr   = json.features[0].attributes;
    const latest = new Date(attr.date).toISOString().slice(0, 10);
    return { ok: true, latencyMs, latest, n_total: attr.n_total };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function checkStraitsLive() {
  try {
    const { status, body, latencyMs } = await rawFetch('https://straits.live/api/v1/transits?history=1&limit=2');
    if (status !== 200) return { ok: false, error: `HTTP ${status}`, latencyMs };
    const json = JSON.parse(body);
    if (!json.history || json.history.length === 0) return { ok: false, error: 'empty history', latencyMs };
    const latest = json.history[0].date;  // API returns newest-first
    return { ok: true, latencyMs, latest };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function checkYahooFinance() {
  try {
    const { status, body, latencyMs } = await rawFetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/BZ=F?interval=1d&range=2d'
    );
    if (status !== 200) return { ok: false, error: `HTTP ${status}`, latencyMs };
    const json  = JSON.parse(body);
    const price = json.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (!price) return { ok: false, error: 'no price in response', latencyMs };
    return { ok: true, latencyMs, price: +price.toFixed(2) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function checkStooq() {
  try {
    const { status, body, latencyMs } = await rawFetch('https://stooq.com/q/d/l/?s=bdi.i&i=d');
    if (status !== 200) return { ok: false, error: `HTTP ${status}`, latencyMs };
    const lines = body.trim().split('\n').filter(l => l && !l.startsWith('Date'));
    if (lines.length === 0) return { ok: false, error: 'no data rows', latencyMs };
    const value = parseFloat(lines[lines.length - 1].split(',')[4]);
    if (isNaN(value)) return { ok: false, error: 'invalid BDI value', latencyMs };
    return { ok: true, latencyMs, value };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const checked = new Date().toISOString();

  // All probes run in parallel; individual failures don't crash the response
  const [imfResult, straitsResult, brentResult, bdiResult] = await Promise.allSettled([
    checkIMFPortWatch(),
    checkStraitsLive(),
    checkYahooFinance(),
    checkStooq(),
  ]);

  const toValue = r => r.status === 'fulfilled' ? r.value : { ok: false, error: r.reason?.message ?? 'unknown' };

  const sources = {
    imf_portwatch: toValue(imfResult),
    straits_live:  toValue(straitsResult),
    brent_crude:   toValue(brentResult),
    bdi_stooq:     toValue(bdiResult),
  };

  // Classify Hormuz (primary pipeline): healthy if IMF live, degraded if only straits.live, critical if both down
  const imfOk     = sources.imf_portwatch.ok;
  const straitsOk = sources.straits_live.ok;
  const hormuzStatus = imfOk ? 'live (IMF PortWatch)' : straitsOk ? 'live (straits.live fallback)' : 'FALLBACK — all APIs down';
  const anyHormuzOk = imfOk || straitsOk;

  const marketStatus = {
    brent: sources.brent_crude.ok ? 'live' : 'unavailable',
    bdi:   sources.bdi_stooq.ok   ? 'live' : 'unavailable',
  };

  // overall: healthy = all sources live; degraded = Hormuz live but something else down; critical = Hormuz down
  const overall = anyHormuzOk
    ? (sources.brent_crude.ok && sources.bdi_stooq.ok ? 'healthy' : 'degraded')
    : 'critical';

  const payload = {
    status: overall,
    checked,
    hormuz: hormuzStatus,
    market: marketStatus,
    sources,
  };

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(overall === 'critical' ? 503 : 200).json(payload);
};
