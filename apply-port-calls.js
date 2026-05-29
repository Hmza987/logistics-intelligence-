// apply-port-calls.js — Injects live port-calls widget into the chokepoints map
// Run: node apply-port-calls.js
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'index.html');
let html = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n'); // normalise CRLF → LF

// ─────────────────────────────────────────────────────────────────────────────
// 1. CSS — insert after the .cp-popup styles block
// ─────────────────────────────────────────────────────────────────────────────
const CSS_ANCHOR = '.cp-popup .leaflet-popup-content { margin: 10px 12px!important; }';
const CSS_INSERT = `
/* ── PORT CALLS LIVE BADGES ───────────────────────────────────────────────── */
.pc-badge {
  display:inline-flex; align-items:center; gap:4px;
  background:rgba(10,14,20,0.88);
  border:1px solid rgba(61,214,140,0.5);
  border-radius:9px; padding:2px 8px;
  font-family:'IBM Plex Mono',monospace; font-size:8px; color:#3dd68c;
  white-space:nowrap; cursor:pointer;
  box-shadow:0 1px 6px rgba(0,0,0,0.7);
  transition:border-color .15s;
}
.pc-badge:hover { border-color:rgba(61,214,140,0.9); }
.pc-badge-dot { font-size:7px; animation:pcPulse 2.5s ease-in-out infinite; }
.pc-badge-count { font-weight:700; font-size:9px; }
.pc-badge-label { color:#5a7a6a; font-size:7px; }
@keyframes pcPulse { 0%,100%{ opacity:1; } 50%{ opacity:0.45; } }

/* Port calls popup */
.pc-popup .leaflet-popup-content-wrapper {
  background:#0c1018!important; border:1px solid #1e3040!important;
  border-radius:6px!important; box-shadow:0 6px 28px rgba(0,0,0,0.85)!important;
  padding:0!important;
}
.pc-popup .leaflet-popup-tip { background:#0c1018!important; }
.pc-popup .leaflet-popup-content { margin:0!important; padding:0!important; }
.pc-popup-wrap { font-family:'IBM Plex Mono',monospace; font-size:9px; padding:12px 14px; min-width:270px; }
.pc-popup-title { font-size:11px; font-weight:700; color:#7a9eb8; margin-bottom:5px; letter-spacing:.04em; }
.pc-popup-stat  { font-size:9px; color:#3dd68c; margin-bottom:8px; }
.pc-popup-sub   { font-size:8px; color:#4a6070; text-transform:uppercase; letter-spacing:.06em; margin-bottom:4px; }
.pc-popup-table { width:100%; border-collapse:collapse; font-size:8.5px; }
.pc-popup-table th { color:#3a5060; font-weight:600; padding:3px 5px; border-bottom:1px solid #1a2a38; text-align:left; }
.pc-popup-table td { padding:3px 5px; border-bottom:1px solid #101820; color:#c8d4e0; }
.pc-popup-table tr:last-child td { border-bottom:none; }
.pc-popup-more  { color:#4a6878; font-size:8px; margin-top:5px; }
.pc-popup-foot  { color:#334454; font-size:8px; margin-top:7px; border-top:1px solid #1a2a38; padding-top:6px; }

/* Refresh button in map source bar */
.pc-refresh-btn {
  background:rgba(61,214,140,0.08); border:1px solid rgba(61,214,140,0.3);
  border-radius:4px; color:#3dd68c; font-family:'IBM Plex Mono',monospace;
  font-size:8px; padding:2px 8px; cursor:pointer; transition:background .15s;
}
.pc-refresh-btn:hover { background:rgba(61,214,140,0.18); }
.pc-refresh-btn:disabled { opacity:0.45; cursor:default; }`;

if (!html.includes(CSS_ANCHOR)) {
  console.error('CSS anchor not found'); process.exit(1);
}
html = html.replace(CSS_ANCHOR, CSS_ANCHOR + '\n' + CSS_INSERT);
console.log('✓ CSS injected');

// ─────────────────────────────────────────────────────────────────────────────
// 2. HTML — update the map source bar to include Refresh button + live label
// ─────────────────────────────────────────────────────────────────────────────
// Replace: add flex layout + refresh button to the chokepoints map source bar.
// We find the inner close: </span><span class="src-badge">real data</span></div>
// immediately following the IMF PortWatch span and add the button before it.
const SRC_BADGE_OLD = '<span class="src-badge">real data</span></div>\n  </div>\n\n  <!-- RATES + CHART GRID -->';
const SRC_BADGE_NEW =
  '</span>' +
  '<span style="display:flex;align-items:center;gap:8px;flex-shrink:0">' +
    '<span id="pc-last-refresh" style="font-size:8px;color:#3a5060"></span>' +
    '<button class="pc-refresh-btn" onclick="refreshPortCalls()" title="Refresh live port call data">&#8635; Live Arrivals</button>' +
    '<span class="src-badge">real data</span>' +
  '</span></div>\n  </div>\n\n  <!-- RATES + CHART GRID -->';

// Also add flex to the wrapping src div
const SRC_DIV_OLD = '<div class="src" style="padding:5px 14px"><span>IMF PortWatch';
const SRC_DIV_NEW = '<div class="src" style="padding:5px 14px;display:flex;align-items:center;justify-content:space-between"><span>IMF PortWatch';

// Apply both (order matters: content first, then outer div)
if (!html.includes(SRC_BADGE_OLD)) {
  console.error('Map source bar badge anchor not found'); process.exit(1);
}
html = html.replace(SRC_BADGE_OLD, SRC_BADGE_NEW);

if (!html.includes(SRC_DIV_OLD)) {
  // non-fatal: may already have flex
  console.warn('⚠ src div style anchor not found, skipping flex update');
} else {
  html = html.replace(SRC_DIV_OLD, SRC_DIV_NEW);
}
console.log('✓ Map source bar updated');

// ─────────────────────────────────────────────────────────────────────────────
// 3. JS functions — insert before the chokepoints map section
// ─────────────────────────────────────────────────────────────────────────────
const JS_ANCHOR = '// ── GLOBAL CHOKEPOINTS MAP ────────────────────────────────────────────────────';
const JS_FUNCTIONS = `// ── LIVE PORT CALLS ──────────────────────────────────────────────────────────
var GCC_PORTS_LIVE = [
  { key:'jebel-ali', name:'Jebel Ali',  lat:24.98, lng:55.05 },
  { key:'salalah',   name:'Salalah',    lat:17.00, lng:54.08 },
  { key:'sohar',     name:'Sohar',      lat:24.37, lng:56.68 },
  { key:'jeddah',    name:'Jeddah',     lat:21.47, lng:39.08 },
  { key:'dammam',    name:'Dammam',     lat:26.47, lng:50.12 },
  { key:'fujairah',  name:'Fujairah',   lat:25.13, lng:56.33 },
  { key:'doha',      name:'Doha',       lat:24.92, lng:51.56 }
];

var pcLiveMarkers = [];

function addLiveBadge(portCfg, data) {
  if (!chokepointsMap) return;
  var count = (data.inPort !== null && data.inPort !== undefined) ? data.inPort : '?';
  var arrivals = data.arrivals || [];
  var today = new Date().toISOString().slice(0, 10);

  // Badge divIcon
  var badgeHtml =
    '<div class="pc-badge" title="Click for expected arrivals">' +
      '<span class="pc-badge-dot">&#9679;</span>' +
      '<span class="pc-badge-count">' + count + '</span>' +
      '<span class="pc-badge-label">in port</span>' +
    '</div>';

  // Build arrival rows
  var rows = arrivals.slice(0, 8).map(function(a) {
    var parts = (a.eta || '').split(/[\sT]/);
    var etaDate = parts[0] || '';
    var etaTime = (parts[1] || '').slice(0, 5);
    var isToday = etaDate === today;
    var isTomorrow = !isToday && etaDate > today;
    var timeColor = isToday ? '#3dd68c' : (isTomorrow ? '#c8a840' : '#5a7080');
    var typeMap = { Container:'#4a9fe8', Tanker:'#e07850', Passenger:'#9060c8',
                    Cargo:'#7a8494', Fishing:'#4a8060', Vessel:'#5a6878' };
    var typeColor = typeMap[a.type] || '#5a6878';
    return '<tr>' +
      '<td style="font-weight:600;color:#dde4ec;max-width:130px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis" title="' + a.name + '">' + a.name + '</td>' +
      '<td style="color:' + typeColor + '">' + a.type + '</td>' +
      '<td style="color:' + timeColor + ';font-family:\'IBM Plex Mono\',monospace">' +
        (isToday ? etaTime : (isTomorrow ? 'Tomorrow ' + etaTime : etaDate)) +
      '</td>' +
    '</tr>';
  }).join('');

  var moreCount = (data.expectedTotal && arrivals.length > 0 && data.expectedTotal > arrivals.length)
    ? (data.expectedTotal - arrivals.length) : 0;

  var popupHtml =
    '<div class="pc-popup-wrap">' +
      '<div class="pc-popup-title">' + portCfg.name.toUpperCase() + ' — PORT CALLS</div>' +
      (data.inPort !== null && data.inPort !== undefined
        ? '<div class="pc-popup-stat">&#9679; <b>' + data.inPort + '</b> vessels currently in port</div>'
        : '') +
      (arrivals.length > 0
        ? '<div class="pc-popup-sub">Expected Arrivals' + (data.expectedTotal ? ' — ' + data.expectedTotal + ' total' : '') + '</div>' +
          '<table class="pc-popup-table">' +
            '<thead><tr><th>Vessel</th><th>Type</th><th>ETA (UTC)</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
          (moreCount > 0
            ? '<div class="pc-popup-more">+' + moreCount + ' more — <a href="' + (data.sourceUrl || '#') + '" target="_blank" rel="noopener" style="color:#4a9fe8">view all &#8599;</a></div>'
            : '')
        : '<div style="color:#3a5060;font-size:9px;padding:4px 0">No arrivals data available</div>'
      ) +
      '<div class="pc-popup-foot">Source: <a href="' + (data.sourceUrl || '#') + '" target="_blank" rel="noopener" style="color:#4a9fe8">myshiptracking.com</a>' +
        (data.asOf ? ' · ' + new Date(data.asOf).toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'}) + ' UTC' : '') +
      '</div>' +
    '</div>';

  var marker = L.marker([portCfg.lat, portCfg.lng], {
    icon: L.divIcon({
      html: badgeHtml,
      className: '',
      iconSize: [76, 20],
      iconAnchor: [38, -6]   // float above the port name label
    }),
    zIndexOffset: 500,
    interactive: true
  });

  marker.bindPopup(popupHtml, {
    maxWidth: 340,
    className: 'pc-popup',
    autoPan: true
  });

  marker.addTo(chokepointsMap);
  pcLiveMarkers.push(marker);
}

function fetchLivePortCalls(bustCache) {
  if (!chokepointsMap) return;
  // Remove existing badges
  pcLiveMarkers.forEach(function(m) { try { chokepointsMap.removeLayer(m); } catch(e){} });
  pcLiveMarkers = [];

  var pending = GCC_PORTS_LIVE.length;
  var refreshBtn = document.querySelector('.pc-refresh-btn');
  if (refreshBtn) { refreshBtn.disabled = true; refreshBtn.textContent = '↻ Loading…'; }

  GCC_PORTS_LIVE.forEach(function(p) {
    var url = '/api/port-calls?port=' + p.key + (bustCache ? '&t=' + Date.now() : '');
    fetch(url)
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(data) { addLiveBadge(p, data); })
      .catch(function(err) {
        console.warn('[port-calls] ' + p.name + ': ' + (err.message || err));
      })
      .finally(function() {
        pending--;
        if (pending === 0) {
          if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.textContent = '↻ Live Arrivals';
          }
          var el = document.getElementById('pc-last-refresh');
          if (el) el.textContent = 'Updated ' +
            new Date().toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'}) + ' UTC';
        }
      });
  });
}

function refreshPortCalls() { fetchLivePortCalls(true); }

`;

if (!html.includes(JS_ANCHOR)) {
  console.error('JS anchor not found'); process.exit(1);
}
html = html.replace(JS_ANCHOR, JS_FUNCTIONS + JS_ANCHOR);
console.log('✓ JS functions injected');

// ─────────────────────────────────────────────────────────────────────────────
// 4. JS — call fetchLivePortCalls() at the end of initChokepointsMap()
//    Insert just before the final closing } of the function
// ─────────────────────────────────────────────────────────────────────────────
const INIT_ANCHOR = `  });
}

// ── VESSEL ANIMATION ON HORMUZ MAP`;
const INIT_NEW = `  });

  // Fetch live port-call data and overlay badges on GCC ports
  setTimeout(function() { fetchLivePortCalls(false); }, 800);
}

// ── VESSEL ANIMATION ON HORMUZ MAP`;

if (!html.includes(INIT_ANCHOR)) {
  console.error('initChokepointsMap closing anchor not found'); process.exit(1);
}
html = html.replace(INIT_ANCHOR, INIT_NEW);
console.log('✓ fetchLivePortCalls() call added to initChokepointsMap');

// ─────────────────────────────────────────────────────────────────────────────
// Write
// ─────────────────────────────────────────────────────────────────────────────
fs.writeFileSync(FILE, html, 'utf8');
console.log('✓ index.html written (' + Math.round(html.length / 1024) + ' KB)');
console.log('\nAll done. Run: git add . && git commit -m "feat: live port calls map badges" && npx vercel --prod --yes');
