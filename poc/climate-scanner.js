#!/usr/bin/env node
'use strict';

/**
 * GCC Logistics — Climate Signal Scanner (Proof of Concept)
 * ──────────────────────────────────────────────────────────
 * Fetches live climate data from two free public APIs:
 *   • Open-Meteo Archive API  — temperature & precipitation per region
 *   • NOAA CPC                — ENSO (El Niño / La Niña) index
 *
 * Passes the data to Claude, which reasons through the transmission
 * chain and outputs structured GCC logistics signals in the same
 * schema used by the dashboard's WL_SIGNALS array.
 *
 * Run:  node poc/climate-scanner.js
 * Needs: ANTHROPIC_API_KEY in environment
 */

const fs   = require('fs');
const path = require('path');

// Load .env.local manually — bypasses any dotenv interceptors
(function loadEnv() {
  const envFiles = [
    path.join(__dirname, '../.env.local'),
    path.join(__dirname, '../.env'),
  ];
  for (const f of envFiles) {
    if (!fs.existsSync(f)) continue;
    fs.readFileSync(f, 'utf8').split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eq = trimmed.indexOf('=');
      if (eq === -1) return;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (key && !process.env[key]) process.env[key] = val;
    });
  }
})();

const Anthropic = require('@anthropic-ai/sdk');
const fetch     = require('node-fetch');

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('\n❌  ANTHROPIC_API_KEY not set.');
  console.error('    Add it to .env.local:  ANTHROPIC_API_KEY=sk-ant-...\n');
  process.exit(1);
}

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

// ── Monitoring regions ────────────────────────────────────────────────────────
// Selected for their direct relevance to GCC logistics transmission chains
const REGIONS = [
  { id: 'arabian_sea',     name: 'Arabian Sea',            lat:  15,  lon:  60 },
  { id: 'east_africa',     name: 'East Africa (Horn)',      lat:   9,  lon:  44 },
  { id: 'australia_grain', name: 'Australian Grain Belt',  lat: -31,  lon: 117 },
  { id: 'mekong_basin',    name: 'Mekong Basin (SE Asia)',  lat:  15,  lon: 104 },
  { id: 'sahel',           name: 'Sahel (West Africa)',     lat:  14,  lon:   2 },
  { id: 'mediterranean',   name: 'Mediterranean (S. Europe)', lat: 38, lon:  15 },
];

// Historical 30-year baseline temperature averages (°C) per region per month
// Source: World Meteorological Organization climatological normals 1991–2020
const TEMP_BASELINE = {
  arabian_sea:     [25.8, 26.2, 27.5, 29.3, 31.2, 30.8, 29.5, 28.9, 29.2, 28.6, 27.1, 26.0],
  east_africa:     [26.8, 27.2, 26.5, 26.0, 25.3, 24.1, 23.8, 24.2, 25.1, 25.8, 26.2, 26.5],
  australia_grain: [23.5, 22.8, 20.4, 17.2, 14.1, 12.0, 11.8, 13.2, 15.6, 18.3, 20.8, 22.6],
  mekong_basin:    [25.2, 27.1, 29.3, 30.8, 29.5, 28.2, 27.8, 27.9, 27.4, 27.0, 25.8, 24.4],
  sahel:           [24.5, 26.8, 29.8, 32.5, 33.2, 32.1, 30.5, 29.8, 30.2, 30.8, 27.4, 24.8],
  mediterranean:   [10.2, 11.0, 13.5, 16.8, 20.5, 24.8, 27.5, 27.2, 24.0, 19.5, 14.8, 11.2],
};

// Historical 30-year baseline precipitation averages (mm/month) per region
const PRECIP_BASELINE = {
  arabian_sea:     [  5,   4,   5,   8,  12,  38,  65,  55,  25,  10,   6,   5],
  east_africa:     [ 18,  22,  58,  82,  35,  12,   8,   9,  15,  48,  75,  38],
  australia_grain: [ 12,  11,  16,  25,  42,  55,  58,  50,  35,  21,  14,  12],
  mekong_basin:    [ 12,  18,  35,  65, 135, 175, 185, 178, 155,  98,  38,  15],
  sahel:           [  1,   1,   3,   8,  25,  68, 145, 168,  98,  22,   3,   1],
  mediterranean:   [ 65,  52,  48,  38,  22,   8,   4,   5,  28,  60,  72,  68],
};

// ── Fetch 90-day data from Open-Meteo ────────────────────────────────────────
async function fetchRegionData(region) {
  const now       = new Date();
  const endDate   = new Date(now);
  endDate.setDate(endDate.getDate() - 3);          // 3-day delay for archive completeness
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 89);     // 90-day window

  const start = startDate.toISOString().split('T')[0];
  const end   = endDate.toISOString().split('T')[0];

  const url = 'https://archive-api.open-meteo.com/v1/archive?' +
    `latitude=${region.lat}&longitude=${region.lon}` +
    `&start_date=${start}&end_date=${end}` +
    `&daily=temperature_2m_mean,precipitation_sum` +
    `&timezone=UTC`;

  const res = await fetch(url, { timeout: 10000 });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status} for ${region.name}`);
  const data = await res.json();

  const temps  = (data.daily.temperature_2m_mean || []).filter(v => v !== null);
  const precip = (data.daily.precipitation_sum   || []).filter(v => v !== null);

  const avgTemp       = temps.reduce((a, b) => a + b, 0) / temps.length;
  const totalPrecip   = precip.reduce((a, b) => a + b, 0);
  const avgDailyPrec  = totalPrecip / precip.length;

  // Compute anomaly vs baseline for the 3 months in the window
  const months = [startDate.getMonth(), (startDate.getMonth()+1)%12, (startDate.getMonth()+2)%12];
  const baselineTemp  = months.reduce((s, m) => s + TEMP_BASELINE[region.id][m],  0) / 3;
  const baselinePrec  = months.reduce((s, m) => s + PRECIP_BASELINE[region.id][m], 0) / 30; // monthly → daily

  const tempAnomaly  = +(avgTemp - baselineTemp).toFixed(1);
  const precipAnomaly = baselinePrec > 0
    ? Math.round(((avgDailyPrec - baselinePrec) / baselinePrec) * 100)
    : 0;

  return {
    region:         region.name,
    period:         `${start} to ${end}`,
    avgTempC:       +avgTemp.toFixed(1),
    tempAnomalyC:   tempAnomaly,
    totalPrecipMm:  Math.round(totalPrecip),
    precipAnomalyPct: precipAnomaly,
    dataPoints:     temps.length,
  };
}

// ── Fetch NINO3.4 SST from NOAA PSL and compute anomaly ──────────────────────
// Source: https://psl.noaa.gov/data/correlation/nina34.data
// Format: year  jan feb mar apr may jun jul aug sep oct nov dec (absolute SST °C)
// Baseline: 1981–2010 monthly climatological means (embedded)
const NINO34_BASELINE = [26.26,26.47,27.15,27.63,27.73,27.39,26.97,26.60,26.38,26.33,26.32,26.22];
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

async function fetchENSO() {
  const url = 'https://psl.noaa.gov/data/correlation/nina34.data';
  const res  = await fetch(url, { timeout: 8000 });
  const text = await res.text();
  const lines = text.split('\n').map(l => l.trim()).filter(l => /^\d{4}/.test(l));

  // Collect all valid (year, month, sst) tuples, most recent last
  const readings = [];
  lines.forEach(l => {
    const parts = l.split(/\s+/);
    const year  = parseInt(parts[0], 10);
    for (let m = 0; m < 12; m++) {
      const sst = parseFloat(parts[m + 1]);
      if (sst !== -99.99 && !isNaN(sst)) readings.push({ year, month: m, sst });
    }
  });

  // Take last 5 valid months
  const recent = readings.slice(-5);
  return recent.map(r => {
    const anomaly = +(r.sst - NINO34_BASELINE[r.month]).toFixed(2);
    return {
      label:   `${MONTH_NAMES[r.month]} ${r.year}`,
      sst:     r.sst,
      anomaly,
      phase:   anomaly >= 1.0 ? 'Strong El Niño'
             : anomaly >= 0.5 ? 'El Niño'
             : anomaly <= -1.0 ? 'Strong La Niña'
             : anomaly <= -0.5 ? 'La Niña'
             : 'Neutral ENSO',
    };
  });
}

// ── Format data briefing for Claude ──────────────────────────────────────────
function buildBriefing(regionResults, ensoRows) {
  const latestENSO = ensoRows[ensoRows.length - 1];
  const lines = [
    `## LIVE CLIMATE DATA BRIEFING — ${new Date().toDateString()}`,
    '',
    '### ENSO STATUS (NINO3.4 SST anomaly — NOAA PSL)',
    ...ensoRows.map(d => `  ${d.label}: SST = ${d.sst}°C  anomaly = ${d.anomaly > 0 ? '+' : ''}${d.anomaly}°C  [${d.phase}]`),
    `  → Current phase: **${latestENSO.phase}** (anomaly ${latestENSO.anomaly > 0 ? '+' : ''}${latestENSO.anomaly}°C)`,
    '',
    '### REGIONAL CLIMATE READINGS vs 1991–2020 Baseline (last 90 days)',
  ];

  regionResults.forEach(r => {
    const tempDir  = r.tempAnomalyC  > 0 ? `+${r.tempAnomalyC}°C ABOVE` : `${r.tempAnomalyC}°C below`;
    const precDir  = r.precipAnomalyPct > 0 ? `+${r.precipAnomalyPct}% ABOVE` : `${r.precipAnomalyPct}% below`;
    const tempFlag = Math.abs(r.tempAnomalyC) >= 1.0 ? ' ⚠' : '';
    const precFlag = Math.abs(r.precipAnomalyPct) >= 20 ? ' ⚠' : '';
    lines.push(
      `\n**${r.region}** (${r.period}):`,
      `  Temperature:   ${r.avgTempC}°C  [${tempDir} baseline]${tempFlag}`,
      `  Precipitation: ${r.totalPrecipMm}mm total  [${precDir} baseline]${precFlag}`,
    );
  });

  return lines.join('\n');
}

// ── Call Claude for signal inference ─────────────────────────────────────────
async function inferSignals(briefing) {
  const systemPrompt = `You are a senior GCC logistics intelligence analyst specialising in early warning signals.

Your role is to analyse real climate data and identify signals that could materially impact:
- GCC seaport operations (Jebel Ali, Dammam, Jeddah, Salalah, Khalifa Port)
- Food and commodity import volumes into GCC countries
- Reefer container and dry bulk vessel availability on GCC trade lanes
- Freight rates and shipping capacity on Asia–Gulf–Europe corridors

CRITICAL THINKING REQUIREMENT:
Do not report the obvious (e.g. "drought in East Africa means food shortage").
Focus on NON-OBVIOUS second and third-order transmission chains, especially:
- How one region's climate anomaly absorbs global shipping capacity, indirectly affecting GCC
- How simultaneous multi-region anomalies eliminate GCC supply chain diversification options
- How climate events in non-GCC regions reshape vessel class availability or container repositioning

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown wrapper, exactly this schema:
{
  "scanDate": "<ISO 8601 date>",
  "ensoPhase": "<current ENSO phase>",
  "dataSourcesUsed": ["Open-Meteo Archive API", "NOAA CPC ONI Index"],
  "signals": [
    {
      "id": "<snake_case_id>",
      "title": "<Observable data point — specific GCC logistics consequence>",
      "category": "Climate / <sub-type>",
      "confidence": <0-100>,
      "horizon": "<X–Y months>",
      "origin": "<geographic origin>",
      "systemicImpact": <0-100>,
      "dataEvidence": "<specific numbers from the briefing that triggered this signal>",
      "chain": [
        {"order": 0, "label": "<root cause>",         "score": <0.0-1.0>},
        {"order": 1, "label": "<1st order effect>",   "score": <0.0-1.0>},
        {"order": 2, "label": "<2nd order effect>",   "score": <0.0-1.0>},
        {"order": 3, "label": "<GCC impact>",         "score": <0.0-1.0>, "gcc": true}
      ],
      "insight": "<2-3 sentences on the non-obvious transmission mechanism>",
      "blindspot": "<the specific second-order consequence most logistics operators will miss>"
    }
  ]
}`;

  const response = await client.messages.create({
    model:      'claude-opus-4-5',
    max_tokens: 4096,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: `Analyse this live climate data and identify the top GCC logistics signals:\n\n${briefing}` }],
  });

  const raw = response.content[0].text.trim();
  // Strip any accidental markdown fencing
  const clean = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(clean);
}

// ── Print results to console ──────────────────────────────────────────────────
function printResults(result) {
  const line = '═'.repeat(70);
  console.log(`\n${line}`);
  console.log('  GCC LOGISTICS SIGNAL SCAN — CLIMATE CATEGORY');
  console.log(`  ${result.scanDate}  |  ENSO: ${result.ensoPhase}`);
  console.log(line);

  result.signals.forEach((sig, i) => {
    const impact = sig.systemicImpact >= 70 ? '🔴' : sig.systemicImpact >= 50 ? '🟠' : '🟡';
    console.log(`\n${impact}  [${i+1}] ${sig.title}`);
    console.log(`     Confidence: ${sig.confidence}%  |  Impact: ${sig.systemicImpact}/100  |  Horizon: ${sig.horizon}`);
    console.log(`     Origin: ${sig.origin}`);
    console.log(`     Data evidence: ${sig.dataEvidence}`);
    console.log(`\n     Transmission chain:`);
    sig.chain.forEach(c => {
      const prefix = c.gcc ? '     → 🇬🇧 GCC:' : `     → [${c.order}]`;
      console.log(`${prefix} ${c.label}  (${(c.score * 100).toFixed(0)}%)`);
    });
    console.log(`\n     Insight:   ${sig.insight}`);
    console.log(`     Blindspot: ${sig.blindspot}`);
  });
  console.log(`\n${line}\n`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🛰  GCC Logistics Climate Signal Scanner — PoC');
  console.log('    Fetching live data from Open-Meteo & NOAA…\n');

  // Fetch ENSO first, then regions sequentially (avoids Open-Meteo rate limits)
  const ensoRows = await fetchENSO().catch(err => {
    console.warn(`  ⚠ ENSO fetch failed: ${err.message} — continuing without it`);
    return [];
  });

  const regionResults = [];
  for (const r of REGIONS) {
    const result = await fetchRegionData(r).catch(err => {
      console.warn(`  ⚠ Skipped ${r.name}: ${err.message}`);
      return null;
    });
    if (result) regionResults.push(result);
    await new Promise(res => setTimeout(res, 300)); // 300ms between requests
  }

  console.log(`  ✓ ENSO data:     ${ensoRows.length} months (PSL NINO3.4)`);
  console.log(`  ✓ Region data:   ${regionResults.length}/${REGIONS.length} regions fetched`);
  console.log('\n  Sending to Claude for signal inference…');

  const briefing = buildBriefing(regionResults, ensoRows);

  // Print briefing (useful for debugging / showing data collected)
  console.log('\n' + '─'.repeat(70));
  console.log(briefing);
  console.log('─'.repeat(70) + '\n');

  const result = await inferSignals(briefing);

  printResults(result);

  // Save timestamped output
  const outDir  = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `signals-climate-${new Date().toISOString().split('T')[0]}.json`);
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf8');
  console.log(`  ✓ Full JSON saved    → ${outFile}`);

  // Also overwrite the live data file served by the dashboard
  const dataDir  = path.join(__dirname, '../data');
  fs.mkdirSync(dataDir, { recursive: true });
  const liveFile = path.join(dataDir, 'climate-signals-latest.json');
  fs.writeFileSync(liveFile, JSON.stringify(result, null, 2), 'utf8');
  console.log(`  ✓ Dashboard data updated → ${liveFile}\n`);
}

main().catch(err => {
  console.error('\n❌ Scanner error:', err.message);
  process.exit(1);
});
