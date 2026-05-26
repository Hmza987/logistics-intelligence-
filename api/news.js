'use strict';
const fetch = require('node-fetch');

// ── /api/news ──────────────────────────────────────────────────────────────────
// Returns up to 12 live news items relevant to GCC maritime intelligence.
//
// Data sources (in priority order):
//   1. NewsAPI.org   — set NEWSAPI_KEY in Vercel env vars (100 req/day free)
//   2. GDELT Doc API — free, no key needed, monitors 65,000+ global news sources
//
// Response cached for 3 minutes on the CDN edge (matches frontend poll interval).
// ──────────────────────────────────────────────────────────────────────────────

// Search queries — ordered by urgency/relevance for GCC logistics dashboard
var GDELT_QUERIES = [
  'Strait Hormuz',
  'CENTCOM Gulf',
  'Iran tanker shipping',
  'Red Sea freight shipping',
  'GCC Saudi oil tanker',
];

// Classify a headline into ALERT / WATCH / INFO
function classifyTag(text) {
  var t = (text || '').toLowerCase();
  if (/strike|attack|militar|centcom|missile|drone|bomb|war|conflict|explosion|shoot|fired|killed|casualt|threat|escalat/.test(t)) return 'ALERT';
  if (/warning|risk|danger|sanction|blockade|closure|suspend|disrupt|halt|surge|divert|reroute|delay|premium/.test(t)) return 'WATCH';
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

// Strip known junk suffixes from titles (e.g. " - Reuters", " | Bloomberg")
function cleanTitle(t) {
  return (t || '').replace(/\s*[-|]\s*(Reuters|Bloomberg|AP|AFP|BBC|CNN|WSJ|FT|Guardian|NYT|Al Jazeera|CNBC|Forbes)[^-|]*$/i, '').trim();
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=60');
  res.setHeader('Access-Control-Allow-Origin', '*');

  var items = [];
  var src = 'none';

  // ── 1. NewsAPI.org (preferred — richer metadata, more recent) ───────────────
  var newsKey = process.env.NEWSAPI_KEY;
  if (newsKey) {
    try {
      var q = 'Hormuz OR CENTCOM OR "Red Sea shipping" OR "GCC freight" OR "Iran tanker" OR "Bab el-Mandeb"';
      var r = await fetch(
        'https://newsapi.org/v2/everything' +
        '?q=' + encodeURIComponent(q) +
        '&sortBy=publishedAt&pageSize=20&language=en' +
        '&apiKey=' + newsKey,
        { timeout: 8000 }
      );
      if (r.ok) {
        var d = await r.json();
        (d.articles || []).forEach(function(a) {
          if (items.length >= 12) return;
          var title = cleanTitle(a.title || '');
          if (!title || title === '[Removed]') return;
          items.push({
            title:       title,
            description: (a.description || '').replace(/<[^>]*>/g,'').slice(0, 160),
            url:         a.url || '',
            source:      (a.source && a.source.name) || '',
            publishedAt: a.publishedAt || '',
            tag:         classifyTag(title + ' ' + (a.description || ''))
          });
        });
        if (items.length) src = 'NewsAPI';
      } else {
        src = 'NewsAPI-err-' + r.status;
      }
    } catch(e) {
      src = 'NewsAPI-exc';
    }
  }

  // ── 2. GDELT Doc API (free fallback, no key needed) ──────────────────────────
  if (items.length < 5) {
    var seen = new Set(items.map(function(x){ return x.url; }));
    for (var qi = 0; qi < GDELT_QUERIES.length && items.length < 12; qi++) {
      try {
        var gdeltUrl =
          'https://api.gdeltproject.org/api/v2/doc/doc' +
          '?query=' + encodeURIComponent(GDELT_QUERIES[qi]) +
          '&mode=ArtList&maxrecords=5&format=json&timespan=3d';
        var r2 = await fetch(gdeltUrl, {
          timeout: 8000,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GCCLogisticsDashboard/2.0)' }
        });
        if (!r2.ok) continue;
        var d2 = await r2.json();
        (d2.articles || []).forEach(function(a) {
          if (items.length >= 12) return;
          if (!a.title || !a.url) return;
          if (seen.has(a.url)) return;
          seen.add(a.url);
          var title = cleanTitle(a.title);
          items.push({
            title:       title,
            description: '',
            url:         a.url,
            source:      a.domain || '',
            publishedAt: parseGdeltDate(a.seendate),
            tag:         classifyTag(title)
          });
        });
        if (src === 'none' && items.length) src = 'GDELT';
      } catch(e) { /* continue to next query */ }
    }
  }

  // Sort by publishedAt descending (newest first)
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
