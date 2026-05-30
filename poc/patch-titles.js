'use strict';
const fs   = require('fs');
const path = require('path');
const d    = JSON.parse(fs.readFileSync(path.join(__dirname,'../data/climate-signals-latest.json'),'utf8'));

// Titles follow the pattern: [Observed data] — [GCC logistics consequence]
// The climate fact grounds the title in the topic; the consequence shows why it matters
const titles = {
  'mekong_stress_rice_origin_shift':
    'Mekong Basin -24% below normal rainfall is cutting rice yields — Vietnam and Thai export quotas will force GCC buyers to congested Indian ports',

  'synchronized_grain_deficit_container_squeeze':
    'Australia -62% and East Africa -76% below normal rainfall occurring simultaneously — GCC loses both primary and backup wheat sources at once',

  'sahel_heat_dome_suez_humanitarian_diversion':
    'Sahel at +3.2°C above baseline with -73% rainfall — WFP emergency charters will divert vessels from Europe-Gulf project cargo routes',

  'horn_africa_cool_anomaly_livestock_cascade':
    'East Africa -76% rainfall with unusual cold anomaly collapsing rangelands — GCC protein supply forced onto near-capacity Australia and Brazil lanes',

  'arabian_sea_warming_desalination_load':
    'Arabian Sea -80% below normal rainfall maximising UAE desalination load — Jebel Ali reefer plug capacity at risk of summer grid rationing',

  'enso_transition_watch_capacity_hedging':
    'NINO3.4 index at +0.42°C and rising toward El Niño threshold — carriers already cutting Asia-Gulf allocations 6-9 months ahead',
};

d.signals.forEach(function(sig){
  if (titles[sig.id]) sig.title = titles[sig.id];
});

fs.writeFileSync(path.join(__dirname,'../data/climate-signals-latest.json'), JSON.stringify(d,null,2));
console.log('Titles patched:');
d.signals.forEach(s => console.log(' •', s.title));
