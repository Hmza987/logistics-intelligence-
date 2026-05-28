'use strict';
const fetch = require('node-fetch');

// ── /api/news ──────────────────────────────────────────────────────────────────
// Returns up to 10 live news items relevant to GCC maritime / logistics intel.
//
// Data sources (in priority order):
//   1. NewsAPI.org      — set NEWSAPI_KEY in Vercel env vars (100 req/day free)
//   2. Al Jazeera RSS   — no key; best auto-coverage for Iran/Gulf/ME events
//   3. The Guardian API — free public tier (api-key=test or GUARDIAN_API_KEY)
//   4. BBC Middle East + Business RSS — no key, very reliable
//   5. Reuters RSS      — no key, global fallback
//   6. GDELT Doc API    — last resort; may time out in some regions
//
// Design principle: ALL queries use REGION + EVENT-TYPE patterns rather than
// named events. This means a new Bandar Abbas strike, IRGC retaliation, or any
// other Gulf security incident is captured automatically — no manual updates
// needed. GCC_RE (defined once below) is the single source of truth for what
// counts as "relevant."
//
// Response cached 3 min on CDN edge (matches frontend poll interval).
// ──────────────────────────────────────────────────────────────────────────────

var FETCH_TIMEOUT = 7000; // ms per request

// ── Single-source-of-truth relevance filter ───────────────────────────────────
// Covers: key waterways, regional states, key actors, freight terms, event
// types. Deliberately broad so future incidents are auto-captured without code
// changes. Any Iran/Gulf/shipping story passes; unrelated content is blocked.
var GCC_RE = new RegExp(
  'hormuz|centcom|irgc|iran|strait|houthi|red.?sea|gulf|' +
  'shipping|freight|tanker|cargo|vessel|port|' +
  'saudi|uae|oman|yemen|bab.?el.?mand|bandar.?abbas|' +
  'kuwait|bahrain|qatar|doha|muscat|riyadh|abu.?dhabi|dubai|jeddah|' +
  'aramco|adnoc|naval|warship|blockade|embargo|' +
  'persian.?gulf|iran.*sanction|sanction.*iran|' +
  'jebel.?ali|salalah|sohar|khor.?fakkan|dammam|aqaba|suez|' +
  'maersk|msc|hapag|cma.?cgm|cosco|evergreen|dp.?world|' +
  'attack.*iran|iran.*attack|strike.*gulf|gulf.*strike|' +
  'missile.*gulf|gulf.*missile|drone.*gulf|gulf.*drone|' +
  'naval.*incident|maritime.*incident|ship.*seized|vessel.*hijack',
  'i'
);

// ── Classify headline into ALERT / WATCH / INFO ────────────────────────────────
function classifyTag(text) {
  var t = (text || '').toLowerCase();
  if (/strike|attack|militar|centcom|missile|drone|bomb|war|conflict|explosion|shoot|fired|killed|casualt|threat|escalat|irgc|bandar.?abbas|retaliat|intercept|seized|hijack|blast|shell/.test(t)) return 'ALERT';
  if (/warning|risk|danger|sanction|blockade|closure|suspend|disrupt|halt|surge|divert|reroute|delay|premium|incident|restrict|tension|standoff/.test(t)) return 'WATCH';
  return 'INFO';
}

// ── Parse GDELT date format "20260526T120000Z" → ISO string ───────────────────
function parseGdeltDate(d) {
  if (!d) return '';
  try {
    var m = d.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
    if (!m) return '';
    return new Date(m[1]+'-'+m[2]+'-'+m[3]+'T'+m[4]+':'+m[5]+':'+m[6]+'Z').toISOString();
  } catch(e) { return ''; }
}

// ── Strip known junk suffixes from titles ─────────────────────────────────────
function cleanTitle(t) {
  return (t || '')
    .replace(/\s*[-|]\s*(Reuters|Bloomberg|AP|AFP|BBC|CNN|WSJ|FT|Guardian|NYT|Al Jazeera|CNBC|Forbes)[^-|]*$/i, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .trim();
}

// ── Lightweight RSS/XML parser ────────────────────────────────────────────────
function parseRSS(xml, sourceName) {
  var items = [];
  var itemRx = /<item>([\s\S]*?)<\/item>/g;
  var im;
  while ((im = itemRx.exec(xml)) !== null && items.length < 15) {
    var block = im[1];
    var titleM = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
    var linkM  = block.match(/<link>([\s\S]*?)<\/link>/) ||
                 block.match(/<link[^>]*href="([^"]+)"/);
    var dateM  = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    var descM  = block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/);
    if (!titleM || !linkM) continue;
    var pubDate = '';
    if (dateM) { try { pubDate = new Date(dateM[1].trim()).toISOString(); } catch(e) {} }
    var desc = descM ? descM[1].trim().replace(/<[^>]*>/g, '').slice(0, 160) : '';
    var title = cleanTitle(titleM[1].trim());
    if (!title) continue;
    items.push({
      title:       title,
      description: desc,
      url:         linkM[1].trim(),
      source:      sourceName || 'RSS',
      publishedAt: pubDate,
      tag:         classifyTag(title + ' ' + desc)
    });
  }
  return items;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=60');
  res.setHeader('Access-Control-Allow-Origin', '*');

  var items = [];
  var src   = 'none';
  var seen  = new Set();

  function addItem(item) {
    if (items.length >= 15) return;
    if (!item.url || seen.has(item.url)) return;
    if (!item.title || item.title === '[Removed]') return;
    seen.add(item.url);
    if (!item.tag) item.tag = classifyTag(item.title + ' ' + (item.description || ''));
    items.push(item);
  }

  // ── 1. NewsAPI.org ─────────────────────────────────────────────────────────────
  // Query uses REGION + EVENT-TYPE terms (not named events) so any future Gulf/
  // Iran military or shipping incident is captured without code changes.
  var newsKey = process.env.NEWSAPI_KEY;
  if (newsKey) {
    try {
      var q = [
        // Key waterways & chokepoints
        'Hormuz', '"Strait of Hormuz"', '"Bab el-Mandeb"', '"Red Sea shipping"', '"Persian Gulf"',
        // Key actors (covers all their future actions automatically)
        'IRGC', '"Iran military"', '"Iranian forces"', 'CENTCOM',
        // Freight & port terms
        '"GCC freight"', '"Gulf shipping"', '"Iran tanker"', '"Red Sea freight"',
        '"container ship" Gulf', '"cargo vessel" Iran',
        // Action patterns (region-agnostic — catch any Gulf incident)
        '"Gulf attack"', '"Iran attack"', '"Iran strike"', '"Iran retaliation"',
        '"Iran sanctions"', '"Iran nuclear"'
      ].join(' OR ');
      var r = await fetch(
        'https://newsapi.org/v2/everything' +
        '?q=' + encodeURIComponent(q) +
        '&sortBy=publishedAt&pageSize=20&language=en' +
        '&apiKey=' + newsKey,
        { timeout: FETCH_TIMEOUT }
      );
      if (r.ok) {
        var d = await r.json();
        (d.articles || []).forEach(function(a) {
          addItem({
            title:       cleanTitle(a.title || ''),
            description: (a.description || '').replace(/<[^>]*>/g, '').slice(0, 160),
            url:         a.url || '',
            source:      (a.source && a.source.name) || 'NewsAPI',
            publishedAt: a.publishedAt || '',
            tag:         classifyTag((a.title||'') + ' ' + (a.description||''))
          });
        });
        if (items.length) src = 'NewsAPI';
      }
    } catch(e) { /* fall through */ }
  }

  // ── 2. Al Jazeera RSS (excellent auto-coverage of Iran/Gulf/ME events) ─────────
  // AJ covers this region natively — no special event names needed. Any attack,
  // military movement, or shipping incident in the Gulf will appear here.
  if (items.length < 10) {
    var ajFeeds = [
      { url: 'https://www.aljazeera.com/xml/rss/all.xml',           name: 'Al Jazeera' },
      { url: 'https://www.aljazeera.com/feeds/news-feeds.rss',      name: 'Al Jazeera' }
    ];
    var ajFetched = false;
    for (var ai = 0; ai < ajFeeds.length && !ajFetched; ai++) {
      try {
        var ar = await fetch(ajFeeds[ai].url, {
          timeout: FETCH_TIMEOUT,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GCCLogisticsDashboard/2.0)' }
        });
        if (!ar.ok) continue;
        var axml = await ar.text();
        var aItems = parseRSS(axml, ajFeeds[ai].name);
        aItems.forEach(function(a) {
          if (GCC_RE.test(a.title + ' ' + a.description)) addItem(a);
        });
        ajFetched = true;
        if (items.length && src === 'none') src = 'Al Jazeera';
      } catch(e) { /* try next URL */ }
    }
  }

  // ── 3. The Guardian API ────────────────────────────────────────────────────────
  // Same pattern-based approach: region + event-type, no named events.
  if (items.length < 8) {
    try {
      var guardianKey = process.env.GUARDIAN_API_KEY || 'test';
      var guardianUrl =
        'https://content.guardianapis.com/search' +
        '?q=' + encodeURIComponent(
          'Hormuz OR IRGC OR "Iran military" OR "Red Sea" OR "Persian Gulf" OR ' +
          '"Iran tanker" OR "Gulf shipping" OR "Bab el-Mandeb" OR "Yemen Houthi" OR ' +
          '"GCC freight" OR CENTCOM OR "Iran sanctions" OR "Iran attack" OR ' +
          '"Gulf attack" OR "Iran strike" OR "Iranian forces" OR "Iran nuclear"'
        ) +
        '&api-key=' + guardianKey +
        '&show-fields=trailText' +
        '&page-size=20' +
        '&order-by=newest';
      var gr = await fetch(guardianUrl, { timeout: FETCH_TIMEOUT });
      if (gr.ok) {
        var gd = await gr.json();
        var results = (gd.response && gd.response.results) || [];
        results.forEach(function(a) {
          var title = cleanTitle(a.webTitle || '');
          var desc  = ((a.fields && a.fields.trailText) || '').replace(/<[^>]*>/g, '').slice(0, 160);
          // Apply same relevance filter — Guardian "test" key can return broad results
          if (!GCC_RE.test(title + ' ' + desc)) return;
          addItem({
            title:       title,
            description: desc,
            url:         a.webUrl || '',
            source:      'The Guardian',
            publishedAt: a.webPublicationDate || '',
            tag:         ''
          });
        });
        if (items.length && src === 'none') src = 'Guardian';
      }
    } catch(e) { /* fall through */ }
  }

  // ── 4. BBC Middle East + Business RSS ─────────────────────────────────────────
  if (items.length < 8) {
    var bbcFeeds = [
      { url: 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml', name: 'BBC Middle East' },
      { url: 'https://feeds.bbci.co.uk/news/business/rss.xml',          name: 'BBC Business'    }
    ];
    for (var fi = 0; fi < bbcFeeds.length && items.length < 10; fi++) {
      try {
        var br = await fetch(bbcFeeds[fi].url, {
          timeout: FETCH_TIMEOUT,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GCCLogisticsDashboard/2.0)' }
        });
        if (!br.ok) continue;
        var bxml = await br.text();
        var rssItems = parseRSS(bxml, bbcFeeds[fi].name);
        rssItems.forEach(function(a) {
          if (GCC_RE.test(a.title + ' ' + a.description)) addItem(a);
        });
        if (items.length && src === 'none') src = 'BBC';
      } catch(e) { /* next feed */ }
    }
  }

  // ── 5. Reuters RSS World feed ──────────────────────────────────────────────────
  if (items.length < 6) {
    try {
      var rrss = await fetch('https://feeds.reuters.com/reuters/topNews', {
        timeout: FETCH_TIMEOUT,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GCCLogisticsDashboard/2.0)' }
      });
      if (rrss.ok) {
        var rxml = await rrss.text();
        var rItems = parseRSS(rxml, 'Reuters');
        rItems.forEach(function(a) {
          if (GCC_RE.test(a.title + ' ' + a.description)) addItem(a);
        });
        if (items.length && src === 'none') src = 'Reuters';
      }
    } catch(e) { /* fall through */ }
  }

  // ── 6. GDELT Doc API (last resort) ────────────────────────────────────────────
  // Queries use region + event-type patterns — not named events — so they remain
  // relevant indefinitely without manual updates.
  if (items.length < 3) {
    var GDELT_QUERIES = [
      'Iran military attack Gulf',
      'IRGC attack retaliation',
      'Strait Hormuz shipping incident',
      'Red Sea Houthi vessel',
      'Persian Gulf naval conflict',
      'Iran sanctions oil tanker',
      'GCC freight disruption'
    ];
    for (var qi = 0; qi < GDELT_QUERIES.length && items.length < 12; qi++) {
      try {
        var gdeltUrl =
          'https://api.gdeltproject.org/api/v2/doc/doc' +
          '?query=' + encodeURIComponent(GDELT_QUERIES[qi]) +
          '&mode=ArtList&maxrecords=5&format=json&timespan=3d';
        var r2 = await fetch(gdeltUrl, {
          timeout: 4000,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GCCLogisticsDashboard/2.0)' }
        });
        if (!r2.ok) continue;
        var d2 = await r2.json();
        (d2.articles || []).forEach(function(a) {
          if (!a.title || !a.url) return;
          addItem({
            title:       cleanTitle(a.title),
            description: '',
            url:         a.url,
            source:      a.domain || 'GDELT',
            publishedAt: parseGdeltDate(a.seendate),
            tag:         ''
          });
        });
        if (items.length && src === 'none') src = 'GDELT';
      } catch(e) { /* next query */ }
    }
  }

  // Sort newest first
  items.sort(function(a, b) {
    return (b.publishedAt || '').localeCompare(a.publishedAt || '');
  });

  return res.status(200).json({
    items: items.slice(0, 10),
    ts:    new Date().toISOString(),
    src:   src,
    count: items.length
  });
};
