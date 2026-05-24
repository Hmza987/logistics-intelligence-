// ── GLOBAL CORRIDOR STRESS SIMULATOR (GCSS) ──────────────────────────────────

var gcssMapReady = false;
var gcssMap = null;
var gcssRouteLayers = {};
var gcssCpMarkers  = {};
var gcssTimeframe  = '72h';

// Chokepoint state: 1=Open 2=Partial 3=Escort-only 4=Blockade 5=Closed
var GCSS_CP = { hormuz:5, bab:1, suez:1, blacksea:1, malacca:1 };

var CP_LABELS = {
  1:'OPEN', 2:'PARTIAL', 3:'ESCORT', 4:'BLOCKADE', 5:'CLOSED'
};
var CP_COLORS = {
  1:'#3dd68c', 2:'#f0c84b', 3:'#fbbf24', 4:'#e74c3c', 5:'#c0392b'
};

// Chokepoint geographic positions for map markers
var CP_LATLNG = {
  hormuz:   [26.55, 56.45],
  bab:      [12.60, 43.50],
  suez:     [30.00, 32.55],
  blacksea: [41.15, 29.05],
  malacca:  [ 1.30,103.85]
};

var ESC_LABELS = [
  '', 'Level 1 — Diplomatic Tension',
  'Level 2 — Sanctions / Economic',
  'Level 3 — Proxy Escalation',
  'Level 4 — Limited Military',
  'Level 5 — Active Conflict',
  'Level 6 — Existential / WMD Risk'
];

// Timeframe multipliers for trade disruption projection
var TF_MULT = { '72h':0.15, '1W':0.4, '1M':1.0, '3M':2.2, '1Y':4.5 };

// Preset scenarios
var GCSS_PRESETS = [
  // 0: Hormuz Closed (current reality)
  { cp:{ hormuz:5, bab:1, suez:1, blacksea:1, malacca:1 }, esc:5, freight:38, ins:72, cong:55, conf:32, truck:118, oil:104, lng:68 },
  // 1: Dual Closure
  { cp:{ hormuz:5, bab:5, suez:1, blacksea:1, malacca:1 }, esc:6, freight:55, ins:95, cong:80, conf:15, truck:145, oil:133, lng:88 },
  // 2: Houthi Surge (Red Sea / Bab crisis, Hormuz open)
  { cp:{ hormuz:1, bab:4, suez:2, blacksea:1, malacca:1 }, esc:4, freight:32, ins:55, cong:42, conf:48, truck:105, oil:91, lng:72 },
  // 3: Suez blockage
  { cp:{ hormuz:1, bab:1, suez:5, blacksea:1, malacca:1 }, esc:2, freight:28, ins:30, cong:35, conf:62, truck:100, oil:80, lng:58 },
  // 4: Partial recovery
  { cp:{ hormuz:3, bab:2, suez:1, blacksea:1, malacca:1 }, esc:3, freight:22, ins:40, cong:30, conf:58, truck:95, oil:84, lng:60 },
  // 5: All clear
  { cp:{ hormuz:1, bab:1, suez:1, blacksea:1, malacca:1 }, esc:1, freight:12, ins:10, cong:10, conf:88, truck:72, oil:72, lng:44 }
];

// ── GCSS Helpers ──────────────────────────────────────────────────────────────
function setCp(name, val) {
  GCSS_CP[name] = val;
  // Update button selection
  var row = document.querySelector('.gcss-cp-btns[data-cp="' + name + '"]');
  if (row) {
    row.querySelectorAll('.gcss-cp-btn').forEach(function(b) {
      b.classList.toggle('sel', +b.dataset.s === val);
    });
  }
  // Update label
  var lbl = document.getElementById('cp-lbl-' + name);
  if (lbl) { lbl.textContent = CP_LABELS[val]; lbl.style.color = CP_COLORS[val]; }
  applyGCSS();
}

function gcssSliderInput(el, lblId, labelArr) {
  var v = +el.value;
  var lbl = document.getElementById(lblId);
  if (lbl) lbl.textContent = labelArr[v] || v;
  el.style.setProperty('--pct', Math.round((v - el.min) / (el.max - el.min) * 100) + '%');
  applyGCSS();
}

function gcssRawLabel(el, lblId) {
  var lbl = document.getElementById(lblId);
  if (lbl) lbl.textContent = el.value;
  el.style.setProperty('--pct', Math.round((+el.value - +el.min) / (+el.max - +el.min) * 100) + '%');
  applyGCSS();
}

function setTf(tf, btn) {
  gcssTimeframe = tf;
  document.querySelectorAll('.gcss-tf-btn').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active');
  applyGCSS();
}

function loadPreset(idx) {
  var p = GCSS_PRESETS[idx];
  if (!p) return;
  // Mark buttons
  document.querySelectorAll('.gcss-preset-btn').forEach(function(b,i){ b.classList.toggle('active', i===idx); });
  // Apply chokepoints
  ['hormuz','bab','suez','blacksea','malacca'].forEach(function(cp){ setCp(cp, p.cp[cp]); });
  // Sliders
  function setSlider(id, lblId, val, labelArr) {
    var el = document.getElementById(id);
    if (!el) return;
    el.value = val;
    el.style.setProperty('--pct', Math.round((val - +el.min) / (+el.max - +el.min) * 100) + '%');
    var lbl = document.getElementById(lblId);
    if (lbl) lbl.textContent = labelArr ? labelArr[val] || val : val;
  }
  setSlider('gcss-esc',    'gcss-esc-lbl',    p.esc,    ESC_LABELS);
  setSlider('gcss-freight','gcss-freight-lbl', p.freight);
  setSlider('gcss-ins',    'gcss-ins-lbl',    p.ins);
  setSlider('gcss-cong',   'gcss-cong-lbl',   p.cong);
  setSlider('gcss-conf',   'gcss-conf-lbl',   p.conf);
  setSlider('gcss-truck',  'gcss-truck-lbl',  p.truck);
  setSlider('gcss-oil',    'gcss-oil-lbl',    p.oil);
  setSlider('gcss-lng',    'gcss-lng-lbl',    p.lng);
  applyGCSS();
}

function syncGCSSSliderTracks() {
  ['gcss-esc','gcss-freight','gcss-ins','gcss-cong','gcss-conf','gcss-truck','gcss-oil','gcss-lng'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.setProperty('--pct', Math.round((+el.value - +el.min) / (+el.max - +el.min) * 100) + '%');
  });
}

// ── GCSS Simulation Engine ────────────────────────────────────────────────────
function computeGCSS() {
  var cp = GCSS_CP;
  var esc    = +(document.getElementById('gcss-esc')    || {value:5}).value;
  var freight= +(document.getElementById('gcss-freight')|| {value:38}).value;
  var ins    = +(document.getElementById('gcss-ins')    || {value:72}).value;
  var cong   = +(document.getElementById('gcss-cong')   || {value:55}).value;
  var conf   = +(document.getElementById('gcss-conf')   || {value:32}).value;
  var truck  = +(document.getElementById('gcss-truck')  || {value:118}).value;
  var oil    = +(document.getElementById('gcss-oil')    || {value:104}).value;
  var lng    = +(document.getElementById('gcss-lng')    || {value:68}).value;

  // Normalise chokepoints to 0–1 stress
  function cpS(v) { return (v - 1) / 4; }
  var hs = cpS(cp.hormuz);  // Hormuz stress
  var bs = cpS(cp.bab);
  var ss = cpS(cp.suez);
  var bks= cpS(cp.blacksea);
  var ms = cpS(cp.malacca);

  // Escalation contribution (0.0–1.0)
  var escContrib = (esc - 1) / 5 * 20;

  // Corridor stress (0–100) — weighted by trade volume
  var cpStress = hs*38 + bs*25 + ss*20 + bks*10 + ms*7;
  var corridorStress = Math.min(98, cpStress + escContrib + cong*0.08);

  // Trade fragmentation
  var tradeFrag = Math.min(97, corridorStress*0.68 + (1 - conf/100)*32);

  // Maritime risk
  var maritimeRisk = Math.min(99, hs*40 + bs*28 + ss*18 + (ins/100)*20 + (esc-1)*2.5);

  // Time-horizon scaling
  var tfm = TF_MULT[gcssTimeframe] || 1.0;
  var scaledFrag = Math.min(99, tradeFrag * tfm * 0.8 + tradeFrag * 0.2);

  // Gauge values
  var energyRisk   = Math.min(99, hs*55 + bs*25 + (oil - 72)/78*20);
  var supplyDisrupt= Math.min(99, (corridorStress*0.55 + tradeFrag*0.30 + cong*0.15));
  var portCapacity = Math.min(99, cong*0.6 + corridorStress*0.28 + freight/60*12);

  // Resilience scores (inverted — how viable is each corridor)
  var resAsiaGcc  = Math.max(2, 100 - hs*70 - ms*15 - freight/60*15);
  var resAsiaEu   = Math.max(2, 100 - ss*45 - bs*35 - hs*10 - tradeFrag*0.10);
  var resGulfEu   = Math.max(2, 100 - hs*40 - bs*30 - ss*20 - energyRisk*0.10);
  var resBsGrain  = Math.max(2, 100 - bks*80 - tradeFrag*0.20);

  // Oil price impact
  var oilDelta = Math.round((oil - 72) / 72 * 100);
  // Shipping cost multiplier vs pre-crisis
  var freightMult = +(freight / 12).toFixed(1);
  // Annual trade loss estimate ($B)
  var tradeLossB  = +(corridorStress * 0.65 * tfm).toFixed(1);
  // GCC port diversions %
  var portDiv     = Math.min(99, Math.round(hs*62 + bs*28 + cong*0.10));

  return {
    corridorStress: Math.round(corridorStress),
    tradeFrag:      Math.round(scaledFrag),
    maritimeRisk:   Math.round(maritimeRisk),
    energyRisk:     Math.round(energyRisk),
    supplyDisrupt:  Math.round(supplyDisrupt),
    portCapacity:   Math.round(portCapacity),
    resAsiaGcc:     Math.round(resAsiaGcc),
    resAsiaEu:      Math.round(resAsiaEu),
    resGulfEu:      Math.round(resGulfEu),
    resBsGrain:     Math.round(resBsGrain),
    oilDelta:       oilDelta,
    freightMult:    freightMult,
    tradeLossB:     tradeLossB,
    portDiv:        portDiv,
    oil:            oil,
    lng:            lng,
    truck:          truck,
    hs: hs, bs: bs, ss: ss, bks: bks, ms: ms,
    esc: esc, cong: cong, conf: conf, freight: freight
  };
}

function riskColor(v) {
  return v >= 75 ? '#e74c3c' : v >= 55 ? '#fbbf24' : v >= 35 ? '#f0c84b' : '#3dd68c';
}

function el(id) { return document.getElementById(id); }

function applyGCSS() {
  var r = computeGCSS();

  // KPI bar
  function setKpi(vid, sid, val, sub, color) {
    var ve = el(vid), se = el(sid);
    if (ve) { ve.textContent = val + '%'; ve.style.color = color; }
    if (se) se.textContent = sub;
  }
  setKpi('gcss-kv-stress','gcss-ks-stress', r.corridorStress,
    r.corridorStress >= 75 ? 'Critical' : r.corridorStress >= 50 ? 'Severe' : r.corridorStress >= 25 ? 'Elevated' : 'Normal',
    riskColor(r.corridorStress));
  setKpi('gcss-kv-frag','gcss-ks-frag', r.tradeFrag,
    gcssTimeframe + ' projection · ' + (r.tradeFrag >= 70 ? 'Fragmented' : r.tradeFrag >= 40 ? 'Stressed' : 'Resilient'),
    riskColor(r.tradeFrag));
  setKpi('gcss-kv-risk','gcss-ks-risk', r.maritimeRisk,
    r.maritimeRisk >= 70 ? 'War-risk active' : r.maritimeRisk >= 45 ? 'Elevated threat' : 'Manageable',
    riskColor(r.maritimeRisk));

  // Gauges
  function setGauge(vid, fid, val) {
    var ve = el(vid), fe = el(fid);
    var c = riskColor(val);
    if (ve) { ve.textContent = val + '%'; ve.style.color = c; }
    if (fe) { fe.style.width = val + '%'; fe.style.background = c; }
  }
  setGauge('g-energy-val',  'g-energy-fill',  r.energyRisk);
  setGauge('g-supply-val',  'g-supply-fill',  r.supplyDisrupt);
  setGauge('g-port-val',    'g-port-fill',    r.portCapacity);

  // Resilience bars
  function setRes(id, barId, val) {
    var ve = el(id), be = el(barId);
    var c = riskColor(100 - val);  // resilience: high=good
    if (ve) { ve.textContent = val + '%'; ve.style.color = val > 60 ? '#3dd68c' : val > 35 ? '#f0c84b' : '#e74c3c'; }
    if (be) { be.style.width = val + '%'; }
  }
  setRes('r-asia-gcc',   'r-asia-gcc-bar',  r.resAsiaGcc);
  setRes('r-asia-eu',    'r-asia-eu-bar',   r.resAsiaEu);
  setRes('r-gulf-eu',    'r-gulf-eu-bar',   r.resGulfEu);
  setRes('r-bs-grain',   'r-bs-grain-bar',  r.resBsGrain);

  // Global trade impact items
  var gi = el('gcss-global-impact');
  if (gi) {
    var gItems = [
      { name:'Global Freight Rates', val: r.freightMult + 'x pre-crisis', c: riskColor((r.freightMult-1)/4.5*100) },
      { name:'Oil Price', val: '$' + r.oil + '/bbl (' + (r.oilDelta >= 0 ? '+' : '') + r.oilDelta + '%)', c: riskColor(Math.abs(r.oilDelta)) },
      { name:'Trade Route Disruption', val: r.tradeFrag + '% fragmented', c: riskColor(r.tradeFrag) },
      { name:'Estimated Trade Loss', val: '$' + r.tradeLossB + 'B / ' + gcssTimeframe, c: r.tradeLossB > 50 ? '#e74c3c' : r.tradeLossB > 20 ? '#fbbf24' : '#3dd68c' },
      { name:'LNG Flow Impact', val: (r.lng > 70 ? 'High demand' : r.lng > 40 ? 'Moderate' : 'Low') + ' · index ' + r.lng, c: riskColor(r.lng) }
    ];
    gi.innerHTML = gItems.map(function(it) {
      return '<div class="gcss-impact-item" style="border-left-color:' + it.c + '">' +
        '<span class="gcss-impact-item-name">' + it.name + '</span>' +
        '<span class="gcss-impact-item-val" style="color:' + it.c + '">' + it.val + '</span></div>';
    }).join('');
  }

  // GCC logistics impact
  var li = el('gcss-gcc-impact');
  if (li) {
    var lItems = [
      { name:'Jebel Ali / Sohar', val: r.portDiv + '% diverted volume', c: riskColor(r.portDiv) },
      { name:'Inland Trucking', val: 'Index ' + r.truck + (r.truck > 110 ? ' ▲ surge' : ' stable'), c: riskColor((r.truck-50)/100*100) },
      { name:'GCC Port Dwell Time', val: r.portCapacity >= 70 ? '12–18 days' : r.portCapacity >= 40 ? '6–10 days' : '3–5 days', c: riskColor(r.portCapacity) },
      { name:'Saudi Landbridge', val: r.hs >= 0.75 ? 'Saturated' : r.hs >= 0.5 ? 'High demand' : 'Normal', c: riskColor(r.hs*100) },
      { name:'Market Confidence', val: r.conf + '%', c: r.conf > 60 ? '#3dd68c' : r.conf > 35 ? '#f0c84b' : '#e74c3c' }
    ];
    li.innerHTML = lItems.map(function(it) {
      return '<div class="gcss-impact-item" style="border-left-color:' + it.c + '">' +
        '<span class="gcss-impact-item-name">' + it.name + '</span>' +
        '<span class="gcss-impact-item-val" style="color:' + it.c + '">' + it.val + '</span></div>';
    }).join('');
  }

  // Update GCSS map routes and markers
  updateGCSSMap(r);

  // AI Summary
  generateSummary(r);

  // Timestamp
  var ts = el('gcss-last-run');
  if (ts) ts.textContent = 'Updated ' + new Date().toLocaleTimeString('en-AE', {hour:'2-digit',minute:'2-digit'});
}

function generateSummary(r) {
  var sumEl = el('gcss-ai-summary');
  if (!sumEl) return;

  var lines = [];
  // Opening assessment
  if (r.corridorStress >= 75) {
    lines.push('<span class="gcss-sum-em">CRITICAL:</span> Global corridor stress at ' + r.corridorStress + '% — multi-chokepoint crisis scenario active.');
  } else if (r.corridorStress >= 50) {
    lines.push('<span class="gcss-sum-em">SEVERE:</span> Corridor stress at ' + r.corridorStress + '%, significant trade route disruption.');
  } else if (r.corridorStress >= 25) {
    lines.push('<span class="gcss-sum-em">ELEVATED:</span> Moderate corridor stress (' + r.corridorStress + '%), targeted disruption in affected lanes.');
  } else {
    lines.push('<span class="gcss-sum-em">STABLE:</span> Corridor stress at ' + r.corridorStress + '% — near pre-crisis operational baseline.');
  }

  // Hormuz-specific
  if (GCSS_CP.hormuz >= 4) lines.push('Hormuz closure diverts ~' + Math.round(r.hs*21) + 'M bbl/day oil flow. GCC export capacity severely constrained.');
  else if (GCSS_CP.hormuz === 3) lines.push('Hormuz escort-only regime restricts ~60% of pre-crisis traffic. Western carriers avoided.');

  // Bab/Suez
  if (GCSS_CP.bab >= 4 && GCSS_CP.suez >= 4) lines.push('Both Red Sea and Suez choked. Asia–Europe trade routed via Cape (+14-18 days, +' + Math.round(r.freightMult*100-100) + '% cost).');
  else if (GCSS_CP.bab >= 3) lines.push('Bab el-Mandeb disruption isolates Jeddah from seaborne supply. Saudi Landbridge demand up ~' + Math.round(r.bs*180) + '%.');

  // GCC logistics
  lines.push('GCC trucking index at ' + r.truck + '. Jebel Ali / Sohar absorbing ' + r.portDiv + '% diverted cargo — dwell risk ' + (r.portCapacity >= 70 ? 'critical' : r.portCapacity >= 40 ? 'elevated' : 'manageable') + '.');

  // Oil
  if (r.oilDelta > 30) lines.push('Brent at $' + r.oil + '/bbl (+' + r.oilDelta + '% vs pre-crisis). War-risk insurance eroding carrier profitability.');

  // Outlook
  if (r.conf < 35) lines.push('<span class="gcss-sum-em">Outlook:</span> Low market confidence (' + r.conf + '%) signals prolonged disruption. Strategic inventory build recommended.');
  else if (r.conf > 65) lines.push('<span class="gcss-sum-em">Outlook:</span> Market confidence at ' + r.conf + '% — routes normalising, rate stabilisation likely within ' + gcssTimeframe + '.');

  sumEl.innerHTML = lines.map(function(l){ return '<div class="gcss-sum-line">' + l + '</div>'; }).join('');
}

// ── GCSS Map ──────────────────────────────────────────────────────────────────
var GCSS_ROUTE_DEFS = {
  // Asia → GCC via Hormuz (normal, strait open)
  asia_gcc_hormuz: {
    pts: [[31.2,121.5],[22.0,120.5],[10.0,110.0],[1.3,104.0],[-0.5,101.0],[-2.5,98.5],
          [5.0,80.0],[8.0,68.0],[12.0,58.0],[15.0,52.0],[17.0,54.0],[22.0,60.0],
          [24.0,58.0],[24.5,56.8],[25.3,55.4]],
    color:'#5aa3f5', weight:3, dash:null
  },
  // Asia → GCC via Cape (Hormuz closed)
  asia_gcc_cape: {
    pts: [[31.2,121.5],[22.0,120.5],[1.3,104.0],[-0.5,101.0],[-10.0,82.0],
          [-25.0,45.0],[-34.2,18.5],[-28.0,8.0],[-10.0,-2.0],[5.0,-8.0],
          [15.0,0.0],[20.0,10.0],[12.0,43.5],[15.0,42.5],[17.0,45.0],[22.0,59.0],[25.3,55.4]],
    color:'#a78bfa', weight:3, dash:[6,4]
  },
  // Asia → Europe via Suez (Bab+Suez open)
  asia_europe_suez: {
    pts: [[31.2,121.5],[22.0,120.5],[1.3,104.0],[-0.5,101.0],[8.0,68.0],
          [12.0,44.0],[15.0,42.5],[22.0,38.0],[27.0,34.5],[30.0,32.5],
          [31.5,32.0],[33.0,31.0],[36.5,28.0],[37.0,22.0],[36.0,14.0],
          [36.1,-5.4],[43.0,-9.5],[48.5,2.0],[51.5,3.5],[53.3,4.9]],
    color:'#3dd68c', weight:3, dash:null
  },
  // Asia → Europe via Cape (Bab/Suez closed)
  asia_europe_cape: {
    pts: [[31.2,121.5],[1.3,104.0],[-10.0,82.0],[-34.2,18.5],
          [-10.0,-2.0],[5.0,-8.0],[15.0,-18.0],[25.0,-25.0],
          [36.0,-9.0],[36.1,-5.4],[40.0,-2.0],[48.5,2.0],[53.3,4.9]],
    color:'#f0c84b', weight:3, dash:[6,4]
  },
  // Gulf → Europe energy corridor
  gulf_europe: {
    pts: [[26.0,56.3],[22.0,60.0],[15.0,52.0],[12.0,44.0],[15.0,42.5],
          [22.0,38.0],[30.0,32.5],[32.0,31.5],[36.1,-5.4],[43.0,-9.5],[53.3,4.9]],
    color:'#fbbf24', weight:2.5, dash:[4,3]
  },
  // Black Sea exits (grain/energy)
  blacksea_routes: {
    pts: [[43.0,31.5],[41.8,30.0],[41.0,29.0],[40.0,27.5],[39.0,26.5],
          [37.5,24.0],[36.5,21.0],[36.0,18.0],[37.0,14.5],[38.0,10.0],
          [38.5,5.0],[43.0,-9.5],[53.3,4.9]],
    color:'#5aa3f5', weight:2, dash:[3,3]
  }
};

function initGCSSMap() {
  if (gcssMapReady) { if (gcssMap) gcssMap.invalidateSize(); return; }
  var mapEl = document.getElementById('gcss-map');
  if (!mapEl) return;
  gcssMap = L.map('gcss-map', {
    center: [20, 55],
    zoom: 3,
    zoomControl: true,
    attributionControl: false,
    minZoom: 2, maxZoom: 7
  });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_matter_no_labels/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd', maxZoom: 19
  }).addTo(gcssMap);
  gcssMapReady = true;

  // Draw initial routes and markers
  Object.keys(GCSS_ROUTE_DEFS).forEach(function(key) {
    var def = GCSS_ROUTE_DEFS[key];
    var layer = L.polyline(def.pts, {
      color: def.color,
      weight: def.weight || 2,
      opacity: 0.7,
      dashArray: def.dash ? def.dash.join(' ') : null
    }).addTo(gcssMap);
    gcssRouteLayers[key] = layer;
  });

  // Chokepoint markers
  ['hormuz','bab','suez','blacksea','malacca'].forEach(function(cp) {
    var pos = CP_LATLNG[cp];
    if (!pos) return;
    var icon = makeCpIcon(GCSS_CP[cp]);
    var m = L.marker(pos, { icon: icon }).addTo(gcssMap);
    var cpNames = { hormuz:'Strait of Hormuz', bab:'Bab el-Mandeb', suez:'Suez Canal', blacksea:'Black Sea Exit', malacca:'Malacca Strait' };
    m.bindTooltip(cpNames[cp] + ': ' + CP_LABELS[GCSS_CP[cp]], { className:'', direction:'top', permanent:false });
    gcssCpMarkers[cp] = m;
  });

  updateGCSSMap(computeGCSS());
}

function makeCpIcon(state) {
  var c = CP_COLORS[state] || '#fbbf24';
  return L.divIcon({
    html: '<div class="gcss-cp-marker" style="--cp-c:' + c + '"><div class="gcss-cp-marker-ring"></div><div class="gcss-cp-marker-dot"></div></div>',
    iconSize: [14,14], iconAnchor: [7,7], className: ''
  });
}

function updateGCSSMap(r) {
  if (!gcssMapReady || !gcssMap) return;
  var cp = GCSS_CP;

  // Route visibility and opacity
  function showRoute(key, show, opacity) {
    var layer = gcssRouteLayers[key];
    if (!layer) return;
    if (show) { layer.setStyle({ opacity: opacity || 0.75 }); }
    else       { layer.setStyle({ opacity: 0.08 }); }
  }

  showRoute('asia_gcc_hormuz', cp.hormuz <= 2, cp.hormuz === 1 ? 0.85 : 0.5);
  showRoute('asia_gcc_cape',   cp.hormuz >= 3, cp.hormuz >= 4 ? 0.85 : 0.55);
  showRoute('asia_europe_suez', cp.bab <= 2 && cp.suez <= 2, 0.75);
  showRoute('asia_europe_cape', cp.bab >= 3 || cp.suez >= 3, 0.8);
  showRoute('gulf_europe', cp.hormuz <= 3, 0.65);
  showRoute('blacksea_routes', cp.blacksea <= 2, cp.blacksea === 1 ? 0.65 : 0.3);

  // Update chokepoint marker icons
  ['hormuz','bab','suez','blacksea','malacca'].forEach(function(cpName) {
    var m = gcssCpMarkers[cpName];
    if (m) m.setIcon(makeCpIcon(cp[cpName]));
  });
}

// ── Old SCENARIOS preserved as reference (not used by GCSS UI) ───────────────
