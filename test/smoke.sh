#!/usr/bin/env bash
# smoke.sh — 11 quick checks for fleetlog-ai
set -u
cd "$(dirname "$0")/.."
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL: $1"; }

[ -f index.html ] && ok "index.html exists" || bad "index.html missing"
[ -f css/style.css ] && ok "css/style.css exists" || bad "css missing"
[ -f js/app.js ] && ok "js/app.js exists" || bad "js missing"
[ -f lib/logic.js ] && ok "lib/logic.js exists" || bad "logic missing"
[ -f README.md ] && ok "README exists" || bad "README missing"

node --check lib/logic.js 2>/dev/null && ok "logic.js syntax valid" || bad "logic.js syntax"
node --check js/app.js 2>/dev/null && ok "app.js syntax valid" || bad "app.js syntax"

node -e "
var F = require('./lib/logic.js');
// fuel math: 19 gal @ 3.6 = 68.40
var c = F.fuelCost({gallons: 19, pricePerGallon: 3.6});
if (c !== 68.4) { console.error('fuelCost '+c); process.exit(1); }
// mpg: 380 mi / 19 gal = 20.0
var m = F.mpgFor(10000, 10380, 19);
if (m !== 20) { console.error('mpg '+m); process.exit(1); }
// UMD wrapper exact shape
var fs = require('fs');
var src = fs.readFileSync('./lib/logic.js', 'utf8');
if (src.indexOf('module.exports = factory()') < 0) { console.error('umd node'); process.exit(1); }
if (src.indexOf('root.FleetLog = factory()') < 0) { console.error('umd browser'); process.exit(1); }
// odometer validation: decreasing reading rejected
var v = F.newVehicle({name:'Truck', type:'truck'});
var ok1 = F.addFuelEntry(v, {date:'2026-01-01', odo:10000, gallons:20, pricePerGallon:3.5});
if (!ok1.ok) { console.error('fill1 failed'); process.exit(1); }
var bad1 = F.addFuelEntry(v, {date:'2026-01-02', odo:10000, gallons:20, pricePerGallon:3.5});
if (bad1.ok || !/greater than/.test(bad1.error)) { console.error('odo validation'); process.exit(1); }
// maintenance flags: oil due 2026-07-05, now 2026-05-01 -> ok (65 days out); 2026-09-28 -> overdue
F.markServiceDone(v, {typeId:'oil', date:'2026-01-05', odo:10000, cost:89.99});
var s1 = F.serviceStatus(v, 'oil', '2026-05-01');
if (s1.status !== 'ok') { console.error('ok flag '+s1.status); process.exit(1); }
var s1b = F.serviceStatus(v, 'oil', '2026-06-10');
if (s1b.status !== 'due-soon') { console.error('due-soon flag '+s1b.status); process.exit(1); }
var s2 = F.serviceStatus(v, 'oil', '2026-09-28');
if (s2.status !== 'overdue') { console.error('overdue flag '+s2.status); process.exit(1); }
// service with no record -> unknown (needs setup)
var s3 = F.serviceStatus(v, 'tires', '2026-09-28');
if (s3.status !== 'unknown') { console.error('unknown flag '+s3.status); process.exit(1); }
// cost per mile exact: total 228.39 / 380 mi = 0.601
var ok2 = F.addFuelEntry(v, {date:'2026-01-20', odo:10380, gallons:19, pricePerGallon:3.6});
if (!ok2.ok) { console.error('fill2 failed'); process.exit(1); }
var cpm = F.costPerMile(v, '2026-01-01', '2026-12-31');
if (cpm.costPerMile !== 0.601) { console.error('cpm '+cpm.costPerMile); process.exit(1); }
// dashboard summary: 1 vehicle, attention 1 (oil overdue), spend this year
var sum = F.fleetSummary([v], '2026-09-28');
if (sum.count !== 1 || sum.attention !== 1) { console.error('summary '+JSON.stringify(sum)); process.exit(1); }
if (sum.spendThisYear !== 228.39) { console.error('spend '+sum.spendThisYear); process.exit(1); }
// photo size cap: oversized data URL rejected
var big = F.checkPhotoSize('data:image/png;base64,' + new Array(500*1024).join('A'));
if (big.ok) { console.error('photo cap'); process.exit(1); }
console.log('logic checks ok');
" && ok "logic: fuel/mpg/umd/validation/flags/cpm/summary/photo-cap" || bad "logic checks"

grep -q "localStorage" js/app.js && ok "localStorage persistence" || bad "no persistence"
grep -q "window.FleetLog" js/app.js && ok "app uses FleetLog global" || bad "no FleetLog global use"
grep -q "data-view" index.html && ok "topbar nav views wired" || bad "nav missing"

echo "--- smoke: $PASS passed, $FAIL failed ---"
[ "$FAIL" -eq 0 ]
