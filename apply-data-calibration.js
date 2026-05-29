// apply-data-calibration.js
// AIS-calibrates the PORT_CALLS cur values, updates the map sub-header,
// adds arrivals24h to the API proxy and the popup display.
// Run: node apply-data-calibration.js
'use strict';
const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// 1. Update PORT_CALLS cur values in index.html
// ─────────────────────────────────────────────────────────────────────────────
const HTML_FILE = path.join(__dirname, 'index.html');
let html = fs.readFileSync(HTML_FILE, 'utf8').replace(/\r\n/g, '\n');

// AIS-calibrated updates (name must match exactly as it appears in PORT_CALLS)
const UPDATES = [
  // Inside Hormuz — less collapsed than modelled
  { name: 'Jebel Ali',     oldCur:  5, newCur: 14 },
  { name: 'Bandar Abbas',  oldCur:  2, newCur:  7 },
  { name: 'Dammam',        oldCur:  3, newCur:  7 },
  // Outside Hormuz GCC — corrected
  { name: 'Salalah',       oldCur: 54, newCur: 42 },
  { name: 'Sohar',         oldCur: 26, newCur: 56 },
  { name: 'Jeddah',        oldCur: 72, newCur: 80 },
  // Red Sea / Suez — Port Said major revision
  { name: 'Port Said',     oldCur: 28, newCur: 63 },
  { name: 'Djibouti',      oldCur: 22, newCur: 21 },
  // Cape route — underestimated surge
  { name: 'Durban',        oldCur: 54, newCur: 68 },
  { name: 'Tanger Med',    oldCur: 72, newCur:100 },
  { name: 'Colombo',       oldCur: 82, newCur:100 },
  { name: 'Dar es Salaam', oldCur: 28, newCur: 42 },
  { name: 'Port Louis',    oldCur: 28, newCur: 38 },
  { name: 'Lomé',    oldCur: 24, newCur: 25 },   // Lomé
];

let updatedCount = 0;
UPDATES.forEach(function(u) {
  // Match the exact port entry line and replace cur value
  // Pattern: name:'PORT NAME',...pre:N, cur:OLD_CUR
  var escapedName = u.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var re = new RegExp(
    "(\\{ name:'" + escapedName + "',[^}]+?,\\s*pre:\\d+,\\s*cur:)" + u.oldCur + "(\\s*\\})"
  );
  if (!re.test(html)) {
    console.warn('⚠ No match for: ' + u.name + ' (cur:' + u.oldCur + ')');
    return;
  }
  html = html.replace(re, '$1' + u.newCur + '$2');
  console.log('✓ ' + u.name + ': cur ' + u.oldCur + ' → ' + u.newCur);
  updatedCount++;
});
console.log('PORT_CALLS: ' + updatedCount + '/' + UPDATES.length + ' ports updated\n');

// ─────────────────────────────────────────────────────────────────────────────
// 2. Update the PORT_CALLS data comment (source note for developers)
// ─────────────────────────────────────────────────────────────────────────────
const DATA_COMMENT_OLD = '  // pre = weekly container vessel calls pre-crisis | cur = current (May 2026)';
const DATA_COMMENT_NEW = '  // pre = modelled commercial vessel calls/week pre-crisis | cur = AIS-calibrated May 2026 (myshiptracking.com)';
if (html.includes(DATA_COMMENT_OLD)) {
  html = html.replace(DATA_COMMENT_OLD, DATA_COMMENT_NEW);
  console.log('✓ Developer comment updated');
} else {
  console.warn('⚠ Developer comment not found');
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Update the map sub-header (Option C — data-source note for users)
// ─────────────────────────────────────────────────────────────────────────────
const SUBHDR_OLD = 'Circle size = weekly port calls &bull; dashed ring = pre-crisis volume &bull; hover any port for data &bull; May 2026';
const SUBHDR_NEW = 'Bubble size = commercial vessel calls/week (AIS-calibrated) &bull; dashed ring = pre-crisis volume &bull; badge = live AIS vessel count &bull; hover any port for data &bull; May 2026';
if (html.includes(SUBHDR_OLD)) {
  html = html.replace(SUBHDR_OLD, SUBHDR_NEW);
  console.log('✓ Map sub-header updated');
} else {
  console.warn('⚠ Map sub-header not found');
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Add arrivals24h + inPortRaw to the popup display (Option B)
//    Replace the pc-popup-stat div to include the 24h arrivals metric
// ─────────────────────────────────────────────────────────────────────────────
const POPUP_STAT_OLD =
  `(data.inPort !== null && data.inPort !== undefined
        ? '<div class="pc-popup-stat">&#9679; <b>' + data.inPort + '</b> vessels currently in port</div>'
        : '')`;
const POPUP_STAT_NEW =
  `(data.inPort !== null && data.inPort !== undefined
        ? '<div class="pc-popup-stat">&#9679; <b>' + data.inPort + '</b> in port' +
          (data.arrivals24h !== null && data.arrivals24h !== undefined
            ? ' &nbsp;&#183;&nbsp; <b>' + data.arrivals24h + '</b> arrivals last 24 h'
            : '') +
          (data.arrivals24h !== null && data.arrivals24h !== undefined
            ? ' &nbsp;&#183;&nbsp; <span style="color:#5a8090">~<b>' + Math.round(data.arrivals24h * 7) + '</b>/wk implied</span>'
            : '') +
          '</div>'
        : '')`;

if (html.includes(POPUP_STAT_OLD)) {
  html = html.replace(POPUP_STAT_OLD, POPUP_STAT_NEW);
  console.log('✓ Popup stat line updated (added arrivals24h + implied weekly)');
} else {
  console.warn('⚠ Popup stat anchor not found');
}

// ─────────────────────────────────────────────────────────────────────────────
// Write index.html
// ─────────────────────────────────────────────────────────────────────────────
fs.writeFileSync(HTML_FILE, html, 'utf8');
console.log('\n✓ index.html written (' + Math.round(html.length / 1024) + ' KB)');

// ─────────────────────────────────────────────────────────────────────────────
// 5. Update api/port-calls.js — add arrivals24h parsing
// ─────────────────────────────────────────────────────────────────────────────
const API_FILE = path.join(__dirname, 'api', 'port-calls.js');
let api = fs.readFileSync(API_FILE, 'utf8').replace(/\r\n/g, '\n');

// Add arrivals24h extraction after the expectedTotal extraction
const API_ANCHOR_OLD = `  // Extract "Expected Arrivals" total count
  m = html.match(/[Ee]xpected\\s+[Aa]rrivals[\\s\\S]{0,80}?(\\d{1,4})/);
  if (m) expectedTotal = parseInt(m[1], 10);
  if (expectedTotal === null) {
    m = html.match(/(\\d{1,4})[\\s\\S]{0,50}?[Ee]xpected\\s+[Aa]rrivals/);
    if (m) expectedTotal = parseInt(m[1], 10);
  }`;

const API_ANCHOR_NEW = `  // Extract "Expected Arrivals" total count
  m = html.match(/[Ee]xpected\\s+[Aa]rrivals[\\s\\S]{0,80}?(\\d{1,4})/);
  if (m) expectedTotal = parseInt(m[1], 10);
  if (expectedTotal === null) {
    m = html.match(/(\\d{1,4})[\\s\\S]{0,50}?[Ee]xpected\\s+[Aa]rrivals/);
    if (m) expectedTotal = parseInt(m[1], 10);
  }

  // Extract 24h arrivals count
  var arrivals24h = null;
  m = html.match(/[Aa]rrivals?[\\s\\S]{0,50}?24[\\s\\S]{0,30}?(\\d{1,4})/);
  if (m) arrivals24h = parseInt(m[1], 10);
  if (arrivals24h === null) {
    m = html.match(/(\\d{1,4})[\\s\\S]{0,30}?[Aa]rrivals?[^a-z]{0,20}24/);
    if (m) arrivals24h = parseInt(m[1], 10);
  }`;

if (api.includes(API_ANCHOR_OLD)) {
  api = api.replace(API_ANCHOR_OLD, API_ANCHOR_NEW);
  console.log('✓ api/port-calls.js: arrivals24h regex added');
} else {
  console.warn('⚠ api/port-calls.js: Expected Arrivals anchor not found');
}

// Add arrivals24h to parsePortPage return value
const RETURN_OLD = `  return { inPort: inPort, expectedTotal: expectedTotal, arrivals: arrivals.slice(0, 10) };`;
const RETURN_NEW = `  return { inPort: inPort, expectedTotal: expectedTotal, arrivals24h: arrivals24h, arrivals: arrivals.slice(0, 10) };`;
if (api.includes(RETURN_OLD)) {
  api = api.replace(RETURN_OLD, RETURN_NEW);
  console.log('✓ api/port-calls.js: arrivals24h added to return value');
} else {
  console.warn('⚠ api/port-calls.js: return anchor not found');
}

// Add arrivals24h to the data object in the handler
const DATA_OLD = `    var data = {
      port:          cfg.name,
      portKey:       portKey,
      sourceUrl:     cfg.url,
      inPort:        parsed.inPort,
      expectedTotal: parsed.expectedTotal,
      arrivals:      parsed.arrivals,
      asOf:          new Date().toISOString()
    };`;
const DATA_NEW = `    var data = {
      port:          cfg.name,
      portKey:       portKey,
      sourceUrl:     cfg.url,
      inPort:        parsed.inPort,
      expectedTotal: parsed.expectedTotal,
      arrivals24h:   parsed.arrivals24h,
      arrivals:      parsed.arrivals,
      asOf:          new Date().toISOString()
    };`;
if (api.includes(DATA_OLD)) {
  api = api.replace(DATA_OLD, DATA_NEW);
  console.log('✓ api/port-calls.js: arrivals24h added to data response object');
} else {
  console.warn('⚠ api/port-calls.js: data object anchor not found');
}

fs.writeFileSync(API_FILE, api, 'utf8');
console.log('✓ api/port-calls.js written\n');
console.log('All done. Run: git add . && git commit && npx vercel --prod --yes');
