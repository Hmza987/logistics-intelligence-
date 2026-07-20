'use strict';
const fetch = require('node-fetch');

// ── /api/traffic ────────────────────────────────────────────────────────────
// Returns live road-congestion signal for each crossing corridor card.
//
// Method: Google Directions API with departure_time=now on a 3-5 km probe
// segment on the SA-side approach road. Congestion ratio = live / free-flow.
// Cost: ~$0.005 per crossing per call × 6 crossings × 48 calls/day ≈ $1.44/day
//       Well within Google Maps $200/month free credit.
//
// Cache: 30 minutes (s-maxage=1800) via Vercel CDN — no redundant API calls.
//
// Required env var: GOOGLE_MAPS_API_KEY
//   → Must be a server-side key (no HTTP-referrer restriction).
//   → Enable "Directions API" in Google Cloud Console for this key.
//   → Restrict to "Directions API" only (not Maps JS) for safety.
// ─────────────────────────────────────────────────────────────────────────────

// Probe segments: short approach road on the SA side of each crossing.
// origin = 3-5 km before the gate; destination = gate area.
// Directions API uses road routing — coordinates just need to be near a road.
const CROSSINGS = [
  {
    id:          'albatha',
    // SA side — Route 55 approach toward Al Bat'ha gate (SA→UAE)
    origin:      '24.0350,51.5350',
    destination: '24.0700,51.5750',
  },
  {
    id:          'kfahd',
    // King Fahd Road, Al Khobar → Passport Island (SA→BH)
    origin:      '26.2900,50.1700',
    destination: '26.1840,50.3240',
  },
  {
    id:          'salwa',
    // Route 10 approach on SA side toward Salwa gate (SA→QA)
    origin:      '24.6700,50.8400',
    destination: '24.7200,50.8500',
  },
  {
    id:          'nuwaiseeb',
    // HWY 95 approach from SA toward Al Khafji gate (SA→KW)
    origin:      '28.5800,48.4200',
    destination: '28.5248,48.4077',
  },
  {
    id:          'sohar',
    // Port access road from HWY 15 toward Sohar Port main gate
    origin:      '24.4700,56.6300',
    destination: '24.5025,56.6062',
  },
  {
    id:          'jeddah',
    // King Abdul Aziz Road, northern Jeddah → Jeddah Islamic Port gate
    origin:      '21.5400,39.1700',
    destination: '21.4838,39.1734',
  },
];

// Map congestion ratio to display label + colour (matches dashboard palette)
function band(ratio) {
  if (ratio === null) return { label: '—',           hex: '#3A3A34' };
  if (ratio < 1.20)  return { label: 'FREE FLOW',   hex: '#3A7D44' };
  if (ratio < 1.50)  return { label: 'LIGHT',       hex: '#B8962E' };
  if (ratio < 2.50)  return { label: 'HEAVY',       hex: '#C06820' };
  return              { label: 'STANDSTILL',         hex: '#C03030' };
}

const DIRECTIONS = 'https://maps.googleapis.com/maps/api/directions/json';

module.exports = async function handler(req, res) {
  // Cache 30 min at Vercel CDN edge; serve stale up to 5 min while revalidating
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=300');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY env var not set' });
  }

  const entries = await Promise.all(
    CROSSINGS.map(async ({ id, origin, destination }) => {
      try {
        const url =
          `${DIRECTIONS}?origin=${origin}&destination=${destination}` +
          `&departure_time=now&key=${key}`;

        const r = await fetch(url, { timeout: 8000 });
        const d = await r.json();

        if (d.status !== 'OK' || !d.routes[0]?.legs[0]) {
          return [id, { ...band(null), ratio: null, apiStatus: d.status }];
        }

        const leg   = d.routes[0].legs[0];
        const free  = leg.duration.value;                          // seconds, no traffic
        const live  = leg.duration_in_traffic
                        ? leg.duration_in_traffic.value
                        : free;                                    // seconds, with traffic
        const ratio = Math.round((live / free) * 100) / 100;

        return [id, { ratio, ...band(ratio) }];
      } catch (err) {
        return [id, { ...band(null), ratio: null, error: err.message }];
      }
    })
  );

  return res.json({
    crossings:  Object.fromEntries(entries),
    fetchedAt:  new Date().toISOString(),
  });
};
