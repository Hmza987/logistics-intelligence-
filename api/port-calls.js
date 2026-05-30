'use strict';
const fetch = require('node-fetch');

// Confirmed port slugs and IDs from myshiptracking.com (all 31 map ports)
const PORTS = {
  // ── Asian export hubs ──────────────────────────────────────────────────────
  'shanghai':      { name: 'Shanghai',      url: 'https://www.myshiptracking.com/ports/port-of-shanghai-in-cn-china-id-4119' },
  'busan':         { name: 'Busan',         url: 'https://www.myshiptracking.com/ports/port-of-busan-in-kr-korea-id-5487' },
  'hong-kong':     { name: 'Hong Kong',     url: 'https://www.myshiptracking.com/ports/port-of-hong-kong-in-hk-hong-kong-id-5843' },
  'singapore':     { name: 'Singapore',     url: 'https://www.myshiptracking.com/ports/port-of-singapore-in-sg-singapore-id-386' },
  'port-klang':    { name: 'Port Klang',    url: 'https://www.myshiptracking.com/ports/port-of-port-klang-in-my-malaysia-id-5709' },
  // ── Indian Ocean waypoint ──────────────────────────────────────────────────
  'colombo':       { name: 'Colombo',       url: 'https://www.myshiptracking.com/ports/port-of-colombo-in-lk-sri-lanka-id-3662' },
  // ── Gulf inside Hormuz ────────────────────────────────────────────────────
  'jebel-ali':     { name: 'Jebel Ali',     url: 'https://www.myshiptracking.com/ports/port-of-jebel-ali-in-ae-uae-id-228' },
  'bandar-abbas':  { name: 'Bandar Abbas',  url: 'https://www.myshiptracking.com/ports/port-of-bandar-abbas-in-ir-iran-id-3587' },
  'khalifa':       { name: 'Khalifa Port',  url: 'https://www.myshiptracking.com/ports/port-of-khalifa-in-ae-uae-id-3494' },
  'doha':          { name: 'Doha',          url: 'https://www.myshiptracking.com/ports/port-of-doha-in-qa-qatar-id-5833' },
  'bahrain':       { name: 'Bahrain Port',  url: 'https://www.myshiptracking.com/ports/port-of-khalifa-bin-salman-in-bh-bahrain-id-5907' },
  'kuwait':        { name: 'Shuwaikh',      url: 'https://www.myshiptracking.com/ports/port-of-kuwait-in-kw-kuwait-id-255' },
  'dammam':        { name: 'Dammam',        url: 'https://www.myshiptracking.com/ports/port-of-dammam-in-sa-saudi-arabia-id-3445' },
  // ── Gulf outside Hormuz ───────────────────────────────────────────────────
  'fujairah':      { name: 'Fujairah',      url: 'https://www.myshiptracking.com/ports/port-of-fujairah-in-ae-uae-id-3510' },
  'salalah':       { name: 'Salalah',       url: 'https://www.myshiptracking.com/ports/port-of-salalah-in-om-oman-id-3477' },
  'sohar':         { name: 'Sohar',         url: 'https://www.myshiptracking.com/ports/port-of-sohar-in-om-oman-id-3479' },
  // ── Red Sea ───────────────────────────────────────────────────────────────
  'jeddah':        { name: 'Jeddah',        url: 'https://www.myshiptracking.com/ports/port-of-jeddah-in-sa-saudi-arabia-id-3441' },
  'port-said':     { name: 'Port Said',     url: 'https://www.myshiptracking.com/ports/port-of-port-said-in-eg-egypt-id-3167' },
  // ── East Africa ───────────────────────────────────────────────────────────
  'djibouti':      { name: 'Djibouti',      url: 'https://www.myshiptracking.com/ports/port-of-djibouti-in-dj-djibouti-id-3430' },
  'mombasa':       { name: 'Mombasa',       url: 'https://www.myshiptracking.com/ports/port-of-mombasa-in-ke-kenya-id-3429' },
  'dar-es-salaam': { name: 'Dar es Salaam', url: 'https://www.myshiptracking.com/ports/port-of-dar-es-salaam-in-tz-tanzania-id-3427' },
  'maputo':        { name: 'Maputo',        url: 'https://www.myshiptracking.com/ports/port-of-maputo-in-mz-mozambique-id-3413' },
  // ── Cape route hubs ───────────────────────────────────────────────────────
  'durban':        { name: 'Durban',        url: 'https://www.myshiptracking.com/ports/port-of-durban-in-za-south-africa-id-149' },
  'cape-town':     { name: 'Cape Town',     url: 'https://www.myshiptracking.com/ports/port-of-cape-town-in-za-south-africa-id-122' },
  'port-louis':    { name: 'Port Louis',    url: 'https://www.myshiptracking.com/ports/port-of-port-louis-in-mu-mauritius-id-7192' },
  // ── West Africa ───────────────────────────────────────────────────────────
  'lome':          { name: 'Lomé',          url: 'https://www.myshiptracking.com/ports/port-of-lome-in-tg-togo-id-3341' },
  // ── North Africa / Atlantic gateway ──────────────────────────────────────
  'tanger-med':    { name: 'Tanger Med',    url: 'https://www.myshiptracking.com/ports/port-of-tanger-med-in-ma-morocco-id-3296' },
  // ── European hubs ─────────────────────────────────────────────────────────
  'rotterdam':     { name: 'Rotterdam',     url: 'https://www.myshiptracking.com/ports/port-of-rotterdam-in-nl-netherlands-id-361' },
  'hamburg':       { name: 'Hamburg',       url: 'https://www.myshiptracking.com/ports/port-of-hamburg-in-de-germany-id-104' },
  'antwerp':       { name: 'Antwerp',       url: 'https://www.myshiptracking.com/ports/port-of-antwerp-in-be-belgium-id-91' },
  'felixstowe':    { name: 'Felixstowe',    url: 'https://www.myshiptracking.com/ports/port-of-felixstowe-in-gb-united-kingdom-id-166' },
};

// Simplified icon-number → vessel type label (myshiptracking icon codes)
function iconToType(n) {
  n = parseInt(n, 10) || 0;
  if (n === 7 || n === 70 || n === 71 || n === 72 || n === 73 || n === 74 || n === 75 || n === 76 || n === 77 || n === 78 || n === 79) return 'Cargo';
  if (n === 8 || n === 80 || n === 81 || n === 82 || n === 83 || n === 84 || n === 85 || n === 86 || n === 87 || n === 88 || n === 89) return 'Tanker';
  if (n === 6 || (n >= 60 && n <= 69)) return 'Passenger';
  if (n === 9 || (n >= 90 && n <= 99)) return 'Other';
  if (n === 2 || (n >= 20 && n <= 29)) return 'Fishing';
  if (n === 3 || (n >= 30 && n <= 39)) return 'Towing';
  if (n === 5) return 'Military';
  return 'Vessel';
}

function parsePortPage(html) {
  var inPort = null, expectedTotal = null;

  // Extract "Vessels In Port" count — number near that label
  var m = html.match(/[Vv]essels?\s*[Ii]n\s*[Pp]ort[\s\S]{0,80}?(\d{1,4})/);
  if (m) inPort = parseInt(m[1], 10);
  if (inPort === null) {
    m = html.match(/(\d{1,4})[\s\S]{0,50}?[Vv]essels?\s*[Ii]n\s*[Pp]ort/);
    if (m) inPort = parseInt(m[1], 10);
  }

  // Extract "Expected Arrivals" total count
  m = html.match(/[Ee]xpected\s+[Aa]rrivals[\s\S]{0,80}?(\d{1,4})/);
  if (m) expectedTotal = parseInt(m[1], 10);
  if (expectedTotal === null) {
    m = html.match(/(\d{1,4})[\s\S]{0,50}?[Ee]xpected\s+[Aa]rrivals/);
    if (m) expectedTotal = parseInt(m[1], 10);
  }

  // Extract 24h arrivals count
  var arrivals24h = null;
  m = html.match(/[Aa]rrivals?[\s\S]{0,50}?24[\s\S]{0,30}?(\d{1,4})/);
  if (m) arrivals24h = parseInt(m[1], 10);
  if (arrivals24h === null) {
    m = html.match(/(\d{1,4})[\s\S]{0,30}?[Aa]rrivals?[^a-z]{0,20}24/);
    if (m) arrivals24h = parseInt(m[1], 10);
  }

  // Extract individual arrival rows
  // Each row: icon (type) → vessel link /vessels/NAME-mmsi-NNNN → ETA timestamp
  var arrivals = [];

  // Collect icon positions
  var iconRe = /\/icons\/icon(\d+)_/g;
  var iconMatches = [], mr;
  while ((mr = iconRe.exec(html)) !== null) {
    iconMatches.push({ idx: mr.index, icon: mr[1] });
  }

  // Collect vessel link positions — /vessels/ slugs that contain 'mmsi-' (filters nav links)
  var vesselRe = /href="(\/vessels\/[^"]*?)"[^>]*>\s*([A-Z0-9][A-Z0-9 .\-]{1,40}?)\s*<\/a>/g;
  var vesselMatches = [];
  while ((mr = vesselRe.exec(html)) !== null) {
    var href = mr[1];
    var name = mr[2].trim();
    // Only keep links that look like vessel pages (contain mmsi or vessel slug pattern)
    if (/\-mmsi\-|\-imo\-|\/vessel\//.test(href) || (name.length > 2 && /^[A-Z]/.test(name))) {
      vesselMatches.push({ idx: mr.index, href: href, name: name });
    }
  }

  // Collect ETA timestamps
  var etaRe = /(\d{4}-\d{2}-\d{2}[\s ]\d{2}:\d{2})/g;
  var etaMatches = [];
  while ((mr = etaRe.exec(html)) !== null) {
    etaMatches.push({ idx: mr.index, eta: mr[1] });
  }

  // Correlate: for each vessel, find nearest prior icon + nearest following ETA
  var usedEtas = {};
  vesselMatches.slice(0, 15).forEach(function(v) {
    // Find nearest icon before this vessel link
    var iconNum = '7'; // default: cargo
    for (var i = iconMatches.length - 1; i >= 0; i--) {
      if (iconMatches[i].idx < v.idx && v.idx - iconMatches[i].idx < 2000) {
        iconNum = iconMatches[i].icon;
        break;
      }
    }
    // Find nearest ETA after this vessel link (within 500 chars)
    var eta = '';
    for (var j = 0; j < etaMatches.length; j++) {
      if (etaMatches[j].idx > v.idx && etaMatches[j].idx - v.idx < 1000 && !usedEtas[j]) {
        eta = etaMatches[j].eta;
        usedEtas[j] = true;
        break;
      }
    }
    if (eta && v.name.length > 2) {
      arrivals.push({ name: v.name, type: iconToType(iconNum), eta: eta });
    }
  });

  // Deduplicate by name (sometimes vessel link appears twice)
  var seen = {};
  arrivals = arrivals.filter(function(a) {
    if (seen[a.name]) return false;
    seen[a.name] = true;
    return true;
  });

  return { inPort: inPort, expectedTotal: expectedTotal, arrivals24h: arrivals24h, arrivals: arrivals.slice(0, 10) };
}

// In-process cache: port key → { data, ts }
var cache = {};
var CACHE_TTL = 15 * 60 * 1000; // 15 minutes

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=900');
  res.setHeader('Content-Type', 'application/json');

  var portKey = (req.query && req.query.port) || '';
  var cfg = PORTS[portKey];
  if (!cfg) {
    return res.status(400).json({
      error: 'Unknown port key. Valid keys: ' + Object.keys(PORTS).join(', ')
    });
  }

  // Serve from cache if fresh (unless cache-busting ?t= param present)
  var now = Date.now();
  var bustCache = !!(req.query && req.query.t);
  if (!bustCache && cache[portKey] && (now - cache[portKey].ts) < CACHE_TTL) {
    return res.status(200).json(cache[portKey].data);
  }

  try {
    var response = await fetch(cfg.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.myshiptracking.com/'
      },
      timeout: 12000
    });

    if (!response.ok) {
      console.warn('[port-calls] upstream', response.status, 'for', portKey);
      return res.status(502).json({ error: 'Upstream returned HTTP ' + response.status });
    }

    var html = await response.text();
    var parsed = parsePortPage(html);

    var data = {
      port:          cfg.name,
      portKey:       portKey,
      sourceUrl:     cfg.url,
      inPort:        parsed.inPort,
      expectedTotal: parsed.expectedTotal,
      arrivals24h:   parsed.arrivals24h,
      arrivals:      parsed.arrivals,
      asOf:          new Date().toISOString()
    };

    cache[portKey] = { data: data, ts: now };
    return res.status(200).json(data);

  } catch (err) {
    console.error('[port-calls] error for', portKey, ':', err.message);
    // Return stale cache if available rather than an error
    if (cache[portKey]) {
      var stale = Object.assign({}, cache[portKey].data, { stale: true });
      return res.status(200).json(stale);
    }
    return res.status(502).json({ error: 'Fetch failed: ' + err.message });
  }
};
