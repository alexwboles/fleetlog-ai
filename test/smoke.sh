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

# 12: deleteFuelEntry removes one entry and returns true
node -e "
var F = require('./lib/logic.js');
var v = F.newVehicle({name:'Truck'});
F.addFuelEntry(v, {date:'2026-01-01', odo:10000, gallons:20, pricePerGallon:3.5});
F.addFuelEntry(v, {date:'2026-01-10', odo:10400, gallons:20, pricePerGallon:3.5});
var id = v.fuel[0].id;
if (!F.deleteFuelEntry(v, id)) { console.error('delete returned false'); process.exit(1); }
if (v.fuel.length !== 1 || v.fuel[0].date !== '2026-01-10') { console.error('wrong entry deleted'); process.exit(1); }
if (F.deleteFuelEntry(v, 'nope')) { console.error('delete of unknown id should be false'); process.exit(1); }
console.log('OK');
" && ok "deleteFuelEntry removes one fill-up" || bad "deleteFuelEntry"

# 13: sortFuel sorts by mpg descending, nulls last
node -e "
var F = require('./lib/logic.js');
var v = F.newVehicle({name:'Truck'});
F.addFuelEntry(v, {date:'2026-01-01', odo:10000, gallons:20, pricePerGallon:3.5}); // mpg null
F.addFuelEntry(v, {date:'2026-01-10', odo:10400, gallons:20, pricePerGallon:3.5}); // 20 mpg
F.addFuelEntry(v, {date:'2026-01-20', odo:10700, gallons:20, pricePerGallon:3.5}); // 15 mpg
var s = F.sortFuel(v, 'mpg', 'desc');
if (s[0].mpg !== 20 || s[1].mpg !== 15 || s[2].mpg !== null) { console.error('mpg sort: '+JSON.stringify(s.map(function(e){return e.mpg;}))); process.exit(1); }
var c = F.sortFuel(v, 'cost', 'asc');
if (c.length !== 3) { console.error('cost sort length'); process.exit(1); }
console.log('OK');
" && ok "sortFuel orders history, nulls last" || bad "sortFuel"

# 14: mpgAnomalies flags a >20% MPG drop
node -e "
var F = require('./lib/logic.js');
var v = F.newVehicle({name:'Truck'});
F.addFuelEntry(v, {date:'2026-01-01', odo:10000, gallons:20, pricePerGallon:3.5}); // null mpg
F.addFuelEntry(v, {date:'2026-01-10', odo:10400, gallons:20, pricePerGallon:3.5}); // 20
F.addFuelEntry(v, {date:'2026-01-20', odo:10800, gallons:20, pricePerGallon:3.5}); // 20
F.addFuelEntry(v, {date:'2026-01-30', odo:11100, gallons:20, pricePerGallon:3.5}); // 15 -> 25% drop
F.addFuelEntry(v, {date:'2026-02-05', odo:11500, gallons:20, pricePerGallon:3.5}); // 20 -> fine
var an = F.mpgAnomalies(v);
var keys = Object.keys(an);
if (keys.length !== 1) { console.error('expected 1 anomaly, got '+keys.length); process.exit(1); }
if (an[keys[0]].mpg !== 15 || an[keys[0]].dropPct !== 25) { console.error('anomaly detail: '+JSON.stringify(an)); process.exit(1); }
console.log('OK');
" && ok "mpgAnomalies flags 25% MPG drop" || bad "mpgAnomalies"

# 15: CSV exports — fuel + service
node -e "
var F = require('./lib/logic.js');
var v = F.newVehicle({name:'Truck \"Big\"'});
F.addFuelEntry(v, {date:'2026-01-01', odo:10000, gallons:20, pricePerGallon:3.5});
F.markServiceDone(v, {typeId:'oil', date:'2026-01-02', odo:10050, cost:90, notes:'full \"synthetic\"'});
var fc = F.fuelToCSV(v).split('\n');
if (fc[0] !== 'date,odometer,gallons,price_per_gallon,cost,mpg') { console.error('fuel header'); process.exit(1); }
if (fc[1] !== '2026-01-01,10000,20,3.5,70,') { console.error('fuel row: '+fc[1]); process.exit(1); }
var sc = F.serviceToCSV(v).split('\n');
if (sc[0] !== 'date,service,odometer,cost,notes') { console.error('svc header'); process.exit(1); }
if (sc[1] !== '2026-01-02,Oil change,10050,90,\"full \"\"synthetic\"\"\"') { console.error('svc row: '+sc[1]); process.exit(1); }
console.log('OK');
" && ok "fuelToCSV/serviceToCSV with quoting" || bad "CSV exports"

# 16: filterVehicles matches name/make/plate, case-insensitive
node -e "
var F = require('./lib/logic.js');
var a = F.newVehicle({name:'F-150 Work Truck', make:'Ford', plate:'ABC-1'});
var b = F.newVehicle({name:'Transit Van', make:'Ford', plate:'XYZ-9'});
var all = [a, b];
if (F.filterVehicles(all, '').length !== 2) { console.error('empty query'); process.exit(1); }
if (F.filterVehicles(all, 'transit').length !== 1) { console.error('name match'); process.exit(1); }
if (F.filterVehicles(all, 'ABC-1')[0] !== a) { console.error('plate match'); process.exit(1); }
if (F.filterVehicles(all, 'ford').length !== 2) { console.error('make match'); process.exit(1); }
if (F.filterVehicles(all, 'nope').length !== 0) { console.error('no match'); process.exit(1); }
console.log('OK');
" && ok "filterVehicles search" || bad "filterVehicles"

echo "--- smoke: $PASS passed, $FAIL failed ---"
[ "$FAIL" -eq 0 ]
