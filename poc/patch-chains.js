const fs = require('fs');
const path = require('path');
const d = JSON.parse(fs.readFileSync(path.join(__dirname,'../data/climate-signals-latest.json'),'utf8'));

const fixes = {
  'mekong_stress_rice_origin_shift': {
    title: "Mekong Basin -24% rainfall — Vietnam/Thai rice export quotas will push GCC buyers to India, where port congestion and approval backlogs add 8 weeks delay (not longer voyage — India is 5 days vs Vietnam's 17)",
    chain: [
      {order:0, label:"Mekong -24% rainfall deficit cuts Vietnamese and Thai paddy yields ~12% — Q4 2026 rice harvest materially below normal", score:0.75},
      {order:1, label:"Vietnam and Thailand impose rice export quotas within 6-8 weeks — combined 8-10M tonne reduction in available exports; Thailand/Vietnam normally supply 35% of GCC rice imports", score:0.68},
      {order:2, label:"All GCC buyers redirect orders to India simultaneously — India's APEDA export approval system backlogs from 2 weeks to 6-8 weeks under concurrent demand surge; Mundra and Kakinada hit 95%+ berth utilisation", score:0.65},
      {order:3, label:"Jebel Ali rice lead times stretch 4 → 12+ weeks (driven by Indian port congestion, not voyage distance: Mundra is 5 days vs Vietnam 17 days); GCC rice import cost rises 25-35% on Indian basmati premium over Thai jasmine", gcc:true, score:0.60}
    ]
  },
  'synchronized_grain_deficit_container_squeeze': {
    title: "Australia -62% + East Africa -76% rainfall — GCC loses primary and backup wheat sources simultaneously, forcing Black Sea procurement at $25-40/tonne freight premium",
    chain: [
      {order:0, label:"Australia and East Africa — the two origins GCC buyers use interchangeably for wheat — both post record rainfall deficits in the same 90-day window", score:0.88},
      {order:1, label:"Saudi SAGO and UAE strategic buyers trigger concurrent Black Sea procurement — Ukraine/Russia wheat adds $25-40/tonne ocean freight over Australian FOB price; Black Sea-Gulf voyage is 6,200nm (21 days) vs Australia 7,200nm (25 days)", score:0.78},
      {order:2, label:"Panamax bulkers reposition from Asia-Gulf grain corridor to Black Sea-Gulf — Asia-to-Gulf dry bulk vessel availability drops 18-22% as ships reposition westward", score:0.72},
      {order:3, label:"Dammam and Jebel Ali bulk terminals face 3-4 week berthing queue; GCC grain import cost rises 15-20% above contract; Kuwait and Qatar strategic grain reserves fall below 60-day buffer target", gcc:true, score:0.68}
    ]
  },
  'sahel_heat_dome_suez_humanitarian_diversion': {
    title: "Sahel +3.2°C heat / -73% rainfall — WFP emergency will charter Handymax vessels from the same pool serving Saudi giga-project cargo routes, creating 3-5 week breakbulk gaps",
    chain: [
      {order:0, label:"Sahel +3.2°C heat and -73% rainfall collapse crops across Mali, Niger, Burkina Faso — WFP declares emergency requiring 800,000+ MT grain procurement", score:0.90},
      {order:1, label:"WFP charters 15-20 Handymax/Supramax vessels from European pool — the same ships serving Italy-Turkey-Black Sea to GCC breakbulk runs for construction materials", score:0.75},
      {order:2, label:"Diversion reduces Europe-Gulf breakbulk frequency by 25-30%; Suez southbound congestion extends slot booking lead times from 48 hours to 5-7 days for smaller vessels", score:0.68},
      {order:3, label:"NEOM, KAEC and Ras Al-Khair project cargo (Italian steel, Turkish prefab, Spanish machinery) faces 3-5 week vessel availability gap; bulk container alternatives cost 40-60% more for oversized items", gcc:true, score:0.64}
    ]
  },
  'horn_africa_cool_anomaly_livestock_cascade': {
    title: "East Africa -76% rainfall + cold anomaly — herd collapse forces GCC buyers to Australia and Brazil, both near-capacity; livestock carriers oversubscribed 10-14 weeks ahead",
    chain: [
      {order:0, label:"Cold + drought devastates East African rangelands — 30-40% herd mortality in Horn region; Ethiopia, Sudan, Somalia halt livestock exports via Berbera and Djibouti", score:0.92},
      {order:1, label:"Saudi and UAE buyers (35-45% sourced from East Africa) pivot simultaneously to Australia (live export: 8,000nm, 27 days) and Brazil (frozen beef: 11,000nm, 37 days) — both channels already at 80-85% capacity", score:0.80},
      {order:2, label:"Only ~120 purpose-built live-export vessels exist globally; booking queues extend 10-14 weeks; Brazil-Gulf reefer frequency insufficient to absorb full surge — Santos to Jebel Ali runs bi-weekly at best", score:0.73},
      {order:3, label:"Jeddah Islamic Port and Khalifa Port face Ramadan/Hajj protein supply risk — live animal arrivals down 40-50%; Saudi retail beef prices rise 15-25%; Qatar and Kuwait activate strategic buffer stock protocols", gcc:true, score:0.70}
    ]
  },
  'arabian_sea_warming_desalination_load': {
    title: "Arabian Sea -80% precipitation — UAE desalination at 100% load will trigger industrial power rationing, reducing Jebel Ali reefer plug capacity 8-12% during peak hours",
    chain: [
      {order:0, label:"Arabian Sea -80% precipitation removes aquifer recharge — UAE and Oman shift to 100% desalination dependency; 27.8°C seawater intake (vs optimal 24°C) reduces plant efficiency 8-10%", score:0.85},
      {order:1, label:"Desalination plants draw 20-25% more grid power to maintain output — UAE grid margin falls below 12% reserve threshold, triggering DEWA load-shedding protocols from June", score:0.75},
      {order:2, label:"Jebel Ali port reefer plugs reclassified as interruptible industrial load — 8-12% of plug capacity becomes unreliable during 14:00-18:00 peak window daily", score:0.65},
      {order:3, label:"Pharma, fresh produce and dairy cargo faces 2-4 day extra dwell at Jebel Ali; perishable spoilage claims rise; importers divert temperature-sensitive shipments to Salalah or Khalifa Port as backup", gcc:true, score:0.58}
    ]
  },
  'enso_transition_watch_capacity_hedging': {
    title: "ENSO at +0.42°C and rising — 55-60% probability of El Nino by Aug-Sep; carriers pre-positioning to Pacific will reduce Asia-Gulf vessel frequency and raise GCC freight rates 6-9 months ahead",
    chain: [
      {order:0, label:"NINO3.4 at +0.42°C and trending up — crossing +0.5°C threshold (currently 55-60% probability by Aug 2026) will officially trigger El Nino and Panama Canal draft restrictions", score:0.72},
      {order:1, label:"Carriers begin capacity reallocation 6-9 months ahead of confirmed onset — shifting larger 14,000-18,000 TEU vessels to Transpacific; Asia-Europe-Gulf strings downsized or merged", score:0.68},
      {order:2, label:"GCC-bound allocations on Asia-Gulf express services cut 10-15%; sailing frequencies reduced from weekly to 10-day intervals on secondary Gulf ports (Salalah, Sohar, Bahrain)", score:0.62},
      {order:3, label:"GCC spot freight rates rise 15-25% on Asia-Gulf routes from Q4 2026; Q1 2027 peak season bookings hardest hit — importers relying on spot market face capacity rationing", gcc:true, score:0.55}
    ]
  }
};

d.signals.forEach(function(sig) {
  if (fixes[sig.id]) {
    if (fixes[sig.id].title) sig.title = fixes[sig.id].title;
    if (fixes[sig.id].chain) sig.chain = fixes[sig.id].chain;
  }
});

fs.writeFileSync(path.join(__dirname,'../data/climate-signals-latest.json'), JSON.stringify(d,null,2));
console.log('Done. Mekong chain:');
d.signals.find(s=>s.id==='mekong_stress_rice_origin_shift').chain.forEach(c=>console.log('['+c.order+(c.gcc?'/GCC':'')+']',c.label.slice(0,90)));
