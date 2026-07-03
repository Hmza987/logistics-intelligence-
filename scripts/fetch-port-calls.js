#!/usr/bin/env node
/**
 * fetch-port-calls.js
 * Queries IMF PortWatch ArcGIS REST API for the most recent complete 7-day
 * window of container vessel calls, computes ratios vs Oct-2024 pre-crisis
 * baselines, then patches the PORT_CALLS `cur` values in index.html.
 *
 * Run manually: node scripts/fetch-port-calls.js
 * Called by:   .github/workflows/update-port-calls.yml  (daily cron)
 */

const fs   = require('fs');
const path = require('path');

const ROOT     = path.join(__dirname, '..');
const HTML     = path.join(ROOT, 'index.html');
const DATA_OUT = path.join(ROOT, 'data', 'port_calls.json');

const API = 'https://services9.arcgis.com/weJ1QsnbMYJlCHdG/ArcGIS/rest/services/Daily_Ports_Data/FeatureServer/0/query';

// ── Port name mapping: dashboard label → IMF PortWatch portname ─────────────
// Only include ports where IMF container calls ≈ dashboard AIS vessel calls.
// EXCLUDED from auto-update (require manual calibration):
//   Sohar, Fujairah — tanker/RoRo-dominated diversion hubs; container data
//                      dramatically understates total vessel activity
//   Colombo, Mombasa, Durban, Cape Town, Tanger Med — Cape-route surge driven
//                      by tanker bunkering, not container calls specifically
//   Jeddah — June 2026 calibration (cur:88) reflects AIS vessel presence
//             (82 ships in anchorage), not IMF port call events (29/wk);
//             incompatible metrics until sources are unified
const PORT_MAP = {
  // ── Inside Hormuz (container data directly tracks the crisis) ────────────
  'Jebel Ali':  'Jebel Ali',
  'Shuwaikh':   'Shuwaikh',
  'Dammam':     'Dammam',
  // ── Global container hubs (stable; metric parity confirmed) ─────────────
  'Shanghai':   'Shanghai (Pudong)',
  'Busan':      'Busan',
  'Singapore':  'Singapore',
  'Rotterdam':  'Rotterdam',
  'Antwerp':    'Antwerp',
  // ── Red Sea / Suez (container-primary; ratio directionally consistent) ──
  'Djibouti':   'Djibouti',
};

// Oct 2024 weekly-average container calls (IMF PortWatch, 31-day sum ÷ 4.3)
// Used ONLY to compute the ratio; not displayed to users.
const IMF_PRE = {
  'Jebel Ali':          96,
  'Shuwaikh':          5.1,
  'Dammam':           14.4,
  'Shanghai (Pudong)': 263,
  'Busan':             242,
  'Singapore':         288,
  'Rotterdam':       135.3,
  'Antwerp':            90,
  'Djibouti':         14.2,
};

// Dashboard `pre` values (total AIS calls, from index.html) — held constant
const DASH_PRE = {
  'Jebel Ali':   62,
  'Shuwaikh':    20,
  'Dammam':      35,
  'Shanghai':    95,
  'Busan':       85,
  'Singapore':  185,
  'Rotterdam':   95,
  'Antwerp':     78,
  'Djibouti':    32,
};

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Returns "YYYY-MM-DD" for a Date
function isoDate(d) { return d.toISOString().slice(0, 10); }

// Returns a human-readable "D Mon YYYY" label
function labelDate(d) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).replace(',', '');
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

// Returns the most recent complete 7-day window ending 8+ days ago
// (gives IMF time to publish; data updates Tuesdays)
function getQueryWindow() {
  const end   = new Date();
  end.setUTCDate(end.getUTCDate() - 8);   // 8 days back to clear publication lag
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  return { start: isoDate(start), end: isoDate(end) };
}

async function fetchWeekly(imfNames, start, end) {
  const nameList = imfNames.map(n => `'${n}'`).join(',');
  const where = `portname IN (${nameList}) AND date>='${start}' AND date<='${end}'`;
  const url   = `${API}?where=${encodeURIComponent(where)}&outFields=portname,date,portcalls_container&resultRecordCount=500&f=json`;

  const data = await fetchJSON(url);
  const totals = {};
  for (const f of data.features || []) {
    const { portname, portcalls_container } = f.attributes;
    totals[portname] = (totals[portname] || 0) + (portcalls_container || 0);
  }
  return totals;
}

async function main() {
  const { start, end } = getQueryWindow();
  const imfNames = [...new Set(Object.values(PORT_MAP))];
  console.log(`IMF PortWatch query: ${start} → ${end} (${imfNames.length} ports)`);

  const weekly = await fetchWeekly(imfNames, start, end);

  const updates   = {};
  const skipped   = [];

  for (const [dash, imf] of Object.entries(PORT_MAP)) {
    const imfCur  = weekly[imf] ?? null;
    const imfPre  = IMF_PRE[imf];
    const dashPre = DASH_PRE[dash];

    if (imfCur === null) { skipped.push(`${dash}: no data`); continue; }
    if (!imfPre)         { skipped.push(`${dash}: no pre-crisis baseline`); continue; }
    // Zero IMF calls in a 7-day window often indicates a data gap, not true closure.
    // Skip update for that week to avoid incorrectly zeroing out a port.
    if (imfCur === 0)    { skipped.push(`${dash}: 0 calls this week (possible data gap — skipping)`); continue; }

    const ratio  = imfCur / imfPre;
    const newCur = Math.max(1, Math.round(dashPre * ratio));
    updates[dash] = { newCur, ratio, imfCur, imfPre, dashPre, window: `${start}–${end}` };
    console.log(`  ${dash.padEnd(14)} ${imfCur.toString().padStart(4)} container/wk  →  ratio ${(ratio*100).toFixed(0).padStart(3)}%  →  cur: ${newCur}`);
  }

  if (skipped.length) console.log('\nSkipped:', skipped.join('; '));

  // ── Write data/port_calls.json ────────────────────────────────────────────
  fs.writeFileSync(DATA_OUT, JSON.stringify({
    generated: isoDate(new Date()),
    source: 'IMF PortWatch ArcGIS REST API',
    queryWindow: { start, end },
    updates
  }, null, 2));
  console.log(`\nSaved ${DATA_OUT}`);

  // ── Patch index.html ──────────────────────────────────────────────────────
  let html = fs.readFileSync(HTML, 'utf8');
  let patchCount = 0;

  for (const [dash, info] of Object.entries(updates)) {
    const re = new RegExp(
      `(\\{\\s*name:'${escapeRegex(dash)}'\\s*,\\s*country:'[^']*'\\s*,\\s*lat:[-\\d.]+\\s*,\\s*lng:[-\\d.]+\\s*,\\s*pre:\\d+\\s*,\\s*cur:)\\d+`,
      'g'
    );
    const before = html;
    html = html.replace(re, `$1${info.newCur}`);
    if (html !== before) patchCount++;
  }

  // Update calibration date comment
  const today = labelDate(new Date());
  html = html.replace(
    /\/\/ cur = IMF PortWatch[^\n]*/,
    `// cur = IMF PortWatch / AIS-calibrated ${today} · auto-updated daily`
  );

  // Update map legend date
  html = html.replace(
    /hover any port for data &bull; [\d]+ \w+ \d{4}/,
    `hover any port for data &bull; ${labelDate(new Date(end))}`
  );

  fs.writeFileSync(HTML, html, 'utf8');
  console.log(`Patched ${patchCount} PORT_CALLS entries in index.html`);
  console.log('Done.');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
