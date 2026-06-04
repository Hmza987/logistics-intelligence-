#!/usr/bin/env node
'use strict';
/**
 * Port Dwell Time Model  —  Phase 1.5: Auto-Calibrating Power-Law Regression
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHAT CHANGED FROM PHASE 1
 * ──────────────────────────
 * Phase 1 used a fixed linear formula: T_yard = T_cust × cong_ratio
 * This produced ±28% CI for Sohar because the linear model cannot fit both
 * pre-crisis (~8d) and crisis (30+d) simultaneously with a single T_cust.
 *
 * Phase 1.5 uses a POWER-LAW model:
 *   T_yard = T_cust × cong_ratio^α
 *
 * In log-space this is linear:
 *   log(T_yard) = log(T_cust) + α × log(cong_ratio)
 *
 * This allows α > 1 (Jeddah: customs accelerates super-linearly)
 *           and α < 1 (Sohar: yard has diminishing marginal delay — saturates)
 *
 * CALIBRATION METHOD
 * ──────────────────
 * Weighted OLS in log-space using training data that spans both pre-crisis
 * baselines and confirmed crisis observations. Per-port calibration gives:
 *   - Optimal T_cust (customs/yard baseline)
 *   - Optimal α (congestion exponent, port-specific)
 *   - R² fit quality
 *   - RMSE used directly as CI basis (no more fixed ±14–28%)
 *
 * FORMULA (full)
 * ──────────────
 *   Dwell = T_vessel  +  T_yard
 *
 *   T_vessel = T_s + min(W, B) × T_s / B       (berth time + capped queue)
 *   T_yard   = T_cust × cong_ratio^α            (power-law yard congestion)
 *   cong_ratio = (W + P) / (B × ρ_normal)       (system load vs normal)
 *
 *   CI = max(RMSE_pct × 1.5,  8%)               (residual-based, not fixed)
 *
 * PHASE 2 EXTENSION
 * ─────────────────
 * Collect rolling vessel observations (W, P, λ) with confirmed dwell readings
 * from Portwatch / Vizion / operator reports. Re-run calibration monthly to
 * keep α and T_cust current. Eventually pool all ports for a global β fit:
 *   log(T_yard) = β₀ + β₁·log(cong_ratio) + β₂·port_type + β₃·season + ε
 */

const fs   = require('fs');
const path = require('path');

// ── Port static configuration ────────────────────────────────────────────────
// B     : operational container/general berths
// T_s   : avg vessel service time (days) — Portcast/OPAZ pre-crisis benchmarks
// rho_n : normal utilisation (pre-crisis target fraction)
const PORT_CONFIG = {
  jeddah:      { id:'jeddah',      name:'Jeddah Islamic Port',   B:40, T_s:1.8, rho_n:0.65 },
  yanbu:       { id:'yanbu',       name:'Yanbu Commercial Port', B:28, T_s:2.0, rho_n:0.65 },
  sohar:       { id:'sohar',       name:'Sohar Port (Oman)',     B:12, T_s:2.2, rho_n:0.70 },
  khor_fakkan: { id:'khor_fakkan', name:'Khor Fakkan (UAE)',     B:8,  T_s:1.5, rho_n:0.75 },
  salalah:     { id:'salalah',     name:'Salalah (Oman)',        B:9,  T_s:1.2, rho_n:0.70 }
};

// ── Training data ─────────────────────────────────────────────────────────────
// Each row: one historical observation.
// conf  = weight in regression (1.0 = confirmed primary source; 0.5 = estimate)
// Pre-crisis baselines anchor the low end; crisis obs anchor the high end.
const TRAINING_DATA = [

  // ── Pre-crisis baselines (2024) — high confidence ──────────────────────────
  { portId:'jeddah',      W:2,  P:26, dwell:4.0,  conf:0.95, src:'Portcast 2024' },
  { portId:'yanbu',       W:1,  P:18, dwell:3.5,  conf:0.90, src:'Mawani 2024' },
  { portId:'sohar',       W:1,  P:8,  dwell:8.0,  conf:0.90, src:'OPAZ 2024 pre-crisis' },
  { portId:'khor_fakkan', W:1,  P:6,  dwell:2.5,  conf:0.95, src:'Hutchison Ports 2024' },
  { portId:'salalah',     W:1,  P:6,  dwell:3.5,  conf:0.95, src:'APM Terminals 2024' },

  // ── Mid-crisis observations (Jan–Mar 2026) — higher confidence ─────────────
  { portId:'sohar',       W:75, P:11, dwell:30.0, conf:0.90, src:'Vizion API Mar 2026' },
  { portId:'jeddah',      W:42, P:32, dwell:17.0, conf:0.85, src:'dubaicargos.com May 2026' },

  // ── Estimated crisis observations (Jun 2026) — moderate confidence ─────────
  { portId:'khor_fakkan', W:35, P:7,  dwell:13.0, conf:0.65, src:'Hutchison Ports Jun 2026 est.' },
  { portId:'salalah',     W:32, P:8,  dwell:8.0,  conf:0.70, src:'APM Terminals Jun 2026 est.' },
  { portId:'yanbu',       W:30, P:18, dwell:14.0, conf:0.65, src:'Mawani Jun 2026 est.' },

  // ── Additional intermediate point for Jeddah (Apr–May 2026 transition) ──────
  { portId:'jeddah',      W:22, P:28, dwell:10.5, conf:0.70, src:'GoComet/SeaVantage Apr 2026 est.' }
];

// ── Log-space OLS calibration (per port) ────────────────────────────────────
/**
 * Fits: log(T_yard) = log(T_cust) + α·log(cong_ratio)
 * via weighted OLS. Returns calibrated T_cust, α, R², RMSE.
 */
function calibratePort(portId) {
  const cfg  = PORT_CONFIG[portId];
  const { B, T_s, rho_n } = cfg;

  const obs = TRAINING_DATA.filter(d => d.portId === portId);
  if (obs.length < 2) {
    // Fallback: single data point — set α=1, solve T_cust directly
    const o = obs[0] || { W:1, P:Math.round(B*rho_n), dwell:T_s+2, conf:0.5 };
    const T_vessel = T_s + Math.min(o.W, B) * T_s / B;
    const cr = (o.W + o.P) / Math.max(B * rho_n, 1);
    return { T_cust: Math.max(0.5, (o.dwell - T_vessel) / Math.max(cr, 0.1)),
             alpha: 1.0, r2: null, rmse_pct: 20, n: obs.length };
  }

  // Compute log-space features
  const pts = obs.map(o => {
    const T_vessel  = T_s + Math.min(o.W, B) * T_s / B;
    const cr        = (o.W + o.P) / Math.max(B * rho_n, 1);
    const T_yard_o  = Math.max(0.05, o.dwell - T_vessel);
    return {
      log_c: Math.log(Math.max(cr, 0.01)),
      log_y: Math.log(T_yard_o),
      w:     o.conf,
      cr, T_yard_o, T_vessel, dwell: o.dwell, src: o.src
    };
  });

  // Weighted OLS: log_y = b + alpha·log_c
  let sw=0, sx=0, sy=0, sxy=0, sxx=0;
  for (const p of pts) {
    sw  += p.w;
    sx  += p.w * p.log_c;
    sy  += p.w * p.log_y;
    sxy += p.w * p.log_c * p.log_y;
    sxx += p.w * p.log_c * p.log_c;
  }
  const denom   = sw * sxx - sx * sx;
  const alpha   = denom !== 0 ? (sw * sxy - sx * sy) / denom : 1.0;
  const log_b   = (sy - alpha * sx) / sw;
  const T_cust  = Math.exp(log_b);

  // R² in log space
  const y_mean = sy / sw;
  let sst=0, sse=0;
  for (const p of pts) {
    const yhat = log_b + alpha * p.log_c;
    sst += p.w * Math.pow(p.log_y - y_mean, 2);
    sse += p.w * Math.pow(p.log_y - yhat,   2);
  }
  const r2 = sst > 0 ? Math.max(0, 1 - sse / sst) : 1;

  // Residuals in original dwell space (including T_vessel)
  let sq_err_sum = 0, abs_pct_sum = 0;
  const residuals = pts.map((p, i) => {
    const T_yard_pred = T_cust * Math.pow(Math.exp(p.log_c), alpha);
    const dwell_pred  = p.T_vessel + T_yard_pred;
    const resid       = dwell_pred - obs[i].dwell;
    const pct         = Math.abs(resid / obs[i].dwell) * 100;
    sq_err_sum  += pct * pct;
    abs_pct_sum += pct;
    return { src: obs[i].src, dwell_obs: obs[i].dwell, dwell_pred: r1(dwell_pred), resid: r1(resid), pct: r1(pct) };
  });

  const rmse_pct = Math.sqrt(sq_err_sum / pts.length);
  const mae_pct  = abs_pct_sum / pts.length;

  return {
    T_cust: r3(T_cust),
    alpha:  r3(alpha),
    r2:     r3(r2),
    rmse_pct: r1(rmse_pct),
    mae_pct:  r1(mae_pct),
    n: pts.length,
    residuals
  };
}

// ── Dwell computation (using calibrated parameters) ──────────────────────────
function computeDwell(portId, calib, obs) {
  const cfg = PORT_CONFIG[portId];
  const { B, T_s, rho_n } = cfg;
  const { W, P } = obs;
  const { T_cust, alpha, rmse_pct } = calib;

  // ── Component A: vessel berth time ───────────────────────────────────────
  const T_vessel    = T_s + Math.min(W, B) * T_s / B;

  // ── Component B: yard congestion (power law) ─────────────────────────────
  const cong_ratio  = (W + P) / Math.max(B * rho_n, 1);
  const T_yard      = T_cust * Math.pow(Math.max(cong_ratio, 0.01), alpha);

  const dwell        = T_vessel + T_yard;
  const dwell_precrisis = T_s + T_cust * Math.pow(1.0, alpha); // cong_ratio=1 → pre-crisis

  // ── CI: residual-based (not fixed percentage) ────────────────────────────
  // Use 1.5 × RMSE as approximate 90% CI; floor at 8% for extrapolation buffer
  const ci   = Math.max(0.08, (rmse_pct / 100) * 1.5);
  const dwell_low  = Math.max(T_s + T_cust, dwell * (1 - ci));
  const dwell_high = dwell * (1 + ci);

  const status =
    dwell >= 12  ? 'CRITICAL' :
    dwell >= 8   ? 'HIGH'     :
    dwell >= 5   ? 'MODERATE' : 'CLEAR';

  const color =
    status === 'CRITICAL' ? '#c02030' :
    status === 'HIGH'     ? '#e8673c' :
    status === 'MODERATE' ? '#f0c84b' : '#3dd68c';

  return {
    name:             cfg.name,
    dwell:            r1(dwell),
    dwell_low:        r1(dwell_low),
    dwell_high:       r1(dwell_high),
    dwell_display:    r0(dwell_low) + '–' + r0(dwell_high),
    dwell_precrisis:  r1(dwell_precrisis),
    T_vessel:         r1(T_vessel),
    T_yard:           r1(T_yard),
    cong_ratio:       r2(cong_ratio),
    ci_pct:           Math.round(ci * 100),
    status, color,
    inputs: { W, P, lambda: obs.lambda, B, T_s, rho_n,
              T_cust_cal: T_cust, alpha_cal: alpha }
  };
}

// ── Current vessel observations (Jun 2026, Phase 1 manual estimates) ─────────
const VESSEL_OBS = {
  jeddah:      { W: 52, P: 20, lambda: 4.5 },
  yanbu:       { W: 30, P: 18, lambda: 3.0 },
  sohar:       { W: 80, P: 11, lambda: 4.0 },
  khor_fakkan: { W: 35, P:  7, lambda: 3.5 },
  salalah:     { W: 32, P:  8, lambda: 5.0 }
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function r0(x) { return Math.round(x); }
function r1(x) { return Math.round(x * 10) / 10; }
function r2(x) { return Math.round(x * 100) / 100; }
function r3(x) { return Math.round(x * 1000) / 1000; }

// ── Main ──────────────────────────────────────────────────────────────────────
function runModel() {
  const HR = '═'.repeat(80);

  // ── 1. Calibrate all ports ──────────────────────────────────────────────────
  const calib = {};
  for (const portId of Object.keys(PORT_CONFIG)) {
    calib[portId] = calibratePort(portId);
  }

  // ── 2. Print calibration report ─────────────────────────────────────────────
  console.log('\n╔' + HR + '╗');
  console.log('║  PORT DWELL MODEL — Auto-Calibration Report (Power-Law OLS)' + ' '.repeat(17) + '║');
  console.log('╚' + HR + '╝\n');

  for (const [id, c] of Object.entries(calib)) {
    const p = (s,n) => String(s).padEnd(n);
    console.log(`  ▸ ${id.toUpperCase().padEnd(14)}  T_cust=${c.T_cust.toString().padEnd(6)}  α=${c.alpha.toString().padEnd(6)}  R²=${c.r2 !== null ? c.r2 : 'n/a'}  RMSE=${c.rmse_pct}%  n=${c.n}`);
    for (const r of c.residuals) {
      console.log(`        ${p(r.src,40)}  obs=${r.dwell_obs}d  pred=${r.dwell_pred}d  Δ=${r.resid}d  (${r.pct}%)`);
    }
    console.log('');
  }

  // ── 3. Compute dwell for all ports ──────────────────────────────────────────
  const results = {};
  for (const portId of Object.keys(PORT_CONFIG)) {
    results[portId] = computeDwell(portId, calib[portId], VESSEL_OBS[portId]);
  }

  // ── 4. Print results table ──────────────────────────────────────────────────
  console.log('╔' + HR + '╗');
  console.log('║  PORT DWELL ESTIMATES — Jun 2026' + ' '.repeat(47) + '║');
  console.log('╚' + HR + '╝\n');
  console.log('  Port               α      T_v   T_y   Dwell    Range (CI)    CI%   Status');
  console.log('  ' + '─'.repeat(78));

  for (const [id, r] of Object.entries(results)) {
    const c = calib[id];
    const pad = (s,n) => String(s).padEnd(n);
    const pr  = (s,n) => String(s).padStart(n);
    console.log(
      '  ' + pad(id, 14) +
      '  ' + pr(c.alpha, 6) +
      '  ' + pr(r.T_vessel+'d', 5) +
      '  ' + pr(r.T_yard+'d', 6) +
      '  ' + pr(r.dwell+'d', 7) +
      '   [' + r.dwell_low + '–' + r.dwell_high + 'd]' +
      '    ±' + r.ci_pct + '%' +
      '  ' + r.status
    );
  }

  console.log('\n  Formula: Dwell = T_s + min(W,B)·T_s/B  +  T_cust·cong_ratio^α');
  console.log('  CI = max(RMSE×1.5, 8%)  — residual-based (not fixed percentages)\n');

  // ── 5. Write output JSON ─────────────────────────────────────────────────────
  const output = {
    modelDate:    new Date().toISOString().slice(0, 10),
    modelVersion: '1.5.0',
    formula:      'Dwell = T_vessel + T_cust·cong_ratio^α;  T_vessel=T_s+min(W,B)·T_s/B',
    calibration:  'Weighted OLS in log-space; CI = max(RMSE×1.5, 8%)',
    calibrated_params: Object.fromEntries(
      Object.entries(calib).map(([id, c]) => [id, { T_cust: c.T_cust, alpha: c.alpha, r2: c.r2, rmse_pct: c.rmse_pct, n: c.n }])
    ),
    ports: results
  };

  const outPath = path.join(__dirname, '..', 'data', 'port-dwell-latest.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log('  ✓ Written → ' + outPath + '\n');
  return output;
}

runModel();
