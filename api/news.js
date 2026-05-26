'use strict';
const fetch = require('node-fetch');

// ── /api/news ──────────────────────────────────────────────────────────────────
// Returns up to 10 live news items relevant to GCC maritime / logistics intel.
//
// Data sources (in priority order):
//   1. NewsAPI.org      — set NEWSAPI_KEY in Vercel env vars (100 req/day free)
//   2. The Guardian API — free public tier (api-key=test or GUARDIAN_API_KEY)
//   3. BBC Middle East RSS — no key, extremely reliable
//   4. GDELT Doc API   — last resort; may be unreliable from some regions
//
// Response cached 3 min on CDN edge (matches frontend poll interval).
// ──────────────────────────────────────────────────────────────────────────────

var FETCH_TIMEOUT = 7000; // ms per request

// Classify headline into ALERT / WATCH / INFO
function classifyTag(text) {
  var t = (text || '').toLowerCase();
  if (/strike|attack|militar|centcom|missile|drone|bomb|war|conflict|explosion|shoot|fired|killed|casualt|threat|escalat/.test(t)) return 'ALERT';
  if (/warning|risk|danger|sanction|blockade|closure|suspend|disrupt|halt|surge|divert|reroute|delay|premium|incident/.test(t)) return 'WATCH';
  return 'INFO';
}

// Parse GDELT date format "20260526T120000Z" → ISO string
function parseGdeltDate(d) {
  if (!d) return '';
  try {
    var m = d.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
    if (!m) return '';
    return new Date(m[1]+'-'+m[2]+'-'+m[3]+'T'+m[4]+':'+m[5]+':'+m[6]+'Z').toISOString();
  } catch(e) { return ''; }
}

// Strip known junk suffixes from titles
function cleanTitle(t) {
  return (t || '')
    .replace(/\s*[-|]\s*(Reuters|Bloomberg|AP|AFP|BBC|CNN|WSJ|FT|Guardian|NYT|Al Jazeera|CNBC|Forbes)[^-|]*$/i, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .trim();
}

// Lightweight RSS/XML parser — extracts title, link, pubDate, description
function parseRSS(xml, sourceName) {
  var items = [];
  var itemRx = /<item>([\s\S]*?)<\/item>/g;
  var im;
  while ((im = itemRx.exec(xml)) !== null && items.length < 10) {
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
    if (items.length >= 12) return;
    if (!item.url || seen.has(item.url)) return;
    if (!item.title || item.title === '[Removed]') return;
    seen.add(item.url);
    if (!item.tag) item.tag = classifyTag(item.title + ' ' + (item.description || ''));
    items.push(item);
  }

  // ── 1. NewsAPI.org (preferred — richer metadata, most recent) ─────────────────
  var newsKey = process.env.NEWSAPI_KEY;
  if (newsKey) {
    try {
      var q = 'Hormuz OR CENTCOM OR "Red Sea shipping" OR "GCC freight" OR "Iran tanker" OR "Bab el-Mandeb" OR "Gulf shipping"';
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

  // ── 2. The Guardian API (free — no key required with api-key=test) ─────────────
  if (items.length < 5) {
    try {
      // Use GUARDIAN_API_KEY if set (free registration at open-platform.theguardian.com)
      // Falls back to the public "test" key which works without registration
      var guardianKey = process.env.GUARDIAN_API_KEY || 'test';
      var guardianUrl =
        'https://content.guardianapis.com/search' +
        '?q=' + encodeURIComponent(
          'Hormuz OR CENTCOM OR "Red Sea" OR "Iran tanker" OR "Gulf shipping" OR "Bab el-Mandeb" OR "Yemen Houthi" OR "GCC freight"'
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
          addItem({
            title:       cleanTitle(a.webTitle || ''),
            description: ((a.fields && a.fields.trailText) || '').replace(/<[^>]*>/g, '').slice(0, 160),
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

  // ── 3. BBC Middle East RSS (no key, very reliable) ────────────────────────────
  if (items.length < 5) {
    var bbcFeeds = [
      { url: 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml', name: 'BBC Middle East' },
      { url: 'https://feeds.bbci.co.uk/news/business/rss.xml',          name: 'BBC Business'    }
    ];
    for (var fi = 0; fi < bbcFeeds.length && items.length < 8; fi++) {
      try {
        var br = await fetch(bbcFeeds[fi].url, {
          timeout: FETCH_TIMEOUT,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GCCLogisticsDashboard/2.0)' }
        });
        if (!br.ok) continue;
        var bxml = await br.text();
        var rssItems = parseRSS(bxml, bbcFeeds[fi].name);
        // BBC RSS covers all news — only keep items relevant to our region
        var GCC_RE = /hormuz|centcom|iran|strait|houthi|red sea|gulf|shipping|freight|tanker|saudi|uae|oman|yemen|bab el.mand/i;
        rssItems.forEach(function(a) {
          if (GCC_RE.test(a.title + ' ' + a.description)) addItem(a);
        });
        if (items.length && src === 'none') src = 'BBC';
      } catch(e) { /* next feed */ }
    }
  }

  // ── 4. Reuters RSS World feed (fallback) ──────────────────────────────────────
  if (items.length < 5) {
    try {
      var rrss = await fetch('https://feeds.reuters.com/reuters/topNews', {
        timeout: FETCH_TIMEOUT,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GCCLogisticsDashboard/2.0)' }
      });
      if (rrss.ok) {
        var rxml = await rrss.text();
        var rItems = parseRSS(rxml, 'Reuters');
        var GCC_RE2 = /hormuz|centcom|iran|strait|houthi|red sea|gulf|shipping|freight|tanker|saudi|uae|oman|yemen|bab el.mand/i;
        rItems.forEach(function(a) {
          if (GCC_RE2.test(a.title + ' ' + a.description)) addItem(a);
        });
        if (items.length && src === 'none') src = 'Reuters';
      }
    } catch(e) { /* fall through */ }
  }

  // ── 5. GDELT Doc API (last resort — may timeout in some regions) ──────────────
  if (items.length < 3) {
    var GDELT_QUERIES = ['Strait Hormuz', 'CENTCOM Gulf', 'Red Sea freight'];
    for (var qi = 0; qi < GDELT_QUERIES.length && items.length < 12; qi++) {
      try {
        var gdeltUrl =
          'https://api.gdeltproject.org/api/v2/doc/doc' +
          '?query=' + encodeURIComponent(GDELT_QUERIES[qi]) +
          '&mode=ArtList&maxrecords=5&format=json&timespan=3d';
        var r2 = await fetch(gdeltUrl, {
          timeout: 4000, // short timeout — don't block response
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
