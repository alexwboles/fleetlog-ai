#!/usr/bin/env bash
# e2e.sh — 6 end-to-end flows through fleetlog-ai core logic (the same code the UI runs)
set -u
cd "$(dirname "$0")/.."
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL: $1"; }

node << 'EOF'
var F = require('./lib/logic.js');
var fails = [];
function eq(a, b, label) { if (a !== b) fails.push(label + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }
function t(cond, label) { if (!cond) fails.push(label); }

// FLOW 1: full fuel lifecycle — add truck, two fill-ups, mpg + cost auto-computed
var truck = F.newVehicle({ name:'F-150 Work Truck', type:'truck', year:'2021', make:'Ford', model:'F-150' });
var f1 = F.addFuelEntry(truck, { date:'2026-08-01', odo:50200, gallons:22, pricePerGallon:3.49 });
t(f1.ok, 'flow1 fill-up 1 accepted');
eq(f1.entry.cost, 76.78, 'flow1 fill-up 1 cost auto-computed');
t(f1.entry.mpg === null, 'flow1 no mpg on first fill-up');
var f2 = F.addFuelEntry(truck, { date:'2026-08-15', odo:50640, gallons:20, pricePerGallon:3.55 });
t(f2.ok, 'flow1 fill-up 2 accepted');
eq(f2.entry.mpg, 22, 'flow1 mpg = 440mi / 20gal');
eq(f2.entry.cost, 71, 'flow1 fill-up 2 cost');

// FLOW 2: odometer can't go backwards; service history per vehicle
var bad = F.addFuelEntry(truck, { date:'2026-08-20', odo:50640, gallons:10, pricePerGallon:3.6 });
t(!bad.ok && /greater than/.test(bad.error), 'flow2 flat odometer rejected');
var svc = F.markServiceDone(truck, { typeId:'oil', date:'2026-08-02', odo:50250, cost:95.5, notes:'full synthetic' });
eq(svc.typeName, 'Oil change', 'flow2 service recorded with friendly name');
eq(truck.history.length, 1, 'flow2 history has 1 entry');
var tot = F.vehicleTotals(truck);
eq(tot.fuel, 147.78, 'flow2 fuel total');
eq(tot.maintenance, 95.5, 'flow2 maintenance total');
eq(tot.total, 243.28, 'flow2 combined total');

// FLOW 3: due-date alerts — overdue, due soon, ok
var van = F.newVehicle({ name:'Transit Van', type:'van' });
F.markServiceDone(van, { typeId:'oil', date:'2026-01-05', odo:30000 });
F.addFuelEntry(van, { date:'2026-09-25', odo:34000, gallons:18, pricePerGallon:3.4 });
var oil = F.serviceStatus(van, 'oil', '2026-09-28');
eq(oil.status, 'overdue', 'flow3 oil overdue (date passed)');
F.markServiceDone(van, { typeId:'oil', date:'2026-08-15', odo:33500 });
F.addFuelEntry(van, { date:'2026-09-27', odo:38050, gallons:15, pricePerGallon:3.5 });
var oil2 = F.serviceStatus(van, 'oil', '2026-09-28');
eq(oil2.status, 'due-soon', 'flow3 oil due soon (450 mi left <= 500)');
var brakes = F.serviceStatus(van, 'brakes', '2026-09-28');
eq(brakes.status, 'unknown', 'flow3 brakes unknown = no record yet');
var blurb = F.attentionBlurb(van, '2026-09-28');
t(/Transit Van/.test(blurb) && /due soon/i.test(blurb), 'flow3 plain-language blurb');

// FLOW 4: cost per mile over a selectable period
var cpm30 = F.costPerMile(truck, '2026-08-01', '2026-08-31');
eq(cpm30.miles, 440, 'flow4 miles in August');
eq(cpm30.totalCost, 243.28, 'flow4 total cost in August');
eq(cpm30.costPerMile, 0.553, 'flow4 $0.553/mi');
var cpmNone = F.costPerMile(truck, '2026-01-01', '2026-01-31');
t(cpmNone.costPerMile === null, 'flow4 null when no data in period');

// FLOW 5: dashboard summary across the fleet
var excavator = F.newVehicle({ name:'Mini Ex', type:'equipment' });
t(F.labelFor(excavator) === 'hours', 'flow5 equipment uses hours label');
F.addFuelEntry(excavator, { date:'2026-09-01', odo:1200, gallons:30, pricePerGallon:3.2 });
var sum = F.fleetSummary([truck, van, excavator], '2026-09-28');
eq(sum.count, 3, 'flow5 fleet size');
t(sum.spendThisYear > 400, 'flow5 spend this year accumulates fuel + maintenance');
t(sum.attention >= 1, 'flow5 attention catches overdue/due-soon');
t(sum.avgMpg !== null && sum.avgMpg > 0, 'flow5 fleet avg mpg');

// FLOW 6: edge cases never crash
var empty = F.newVehicle({ name:'Empty' });
t(F.costPerMile(empty, null, null).costPerMile === null, 'flow6 empty cost-per-mile null');
t(F.fleetSummary([], '2026-09-28').count === 0, 'flow6 empty fleet summary');
t(F.vehicleTotals(empty).total === 0, 'flow6 empty totals zero');
t(F.mpgFor(100, 100, 10) === null, 'flow6 zero miles = null mpg');
t(F.fuelCost({ gallons: 0, pricePerGallon: 3 }) === 0, 'flow6 zero gallons = zero cost');
t(F.validateFuel(empty, { odo: -5, gallons: 10, pricePerGallon: 3 }).ok === false, 'flow6 negative reading rejected');

if (fails.length) { fails.forEach(function (f) { console.error('FAIL: ' + f); }); process.exit(1); }
console.log('all 6 flows green');
EOF
[ $? -eq 0 ] && ok "6 e2e flows" || bad "e2e flows"

# HTML sanity: all referenced assets exist
for f in $(grep -o 'src="[^"]*"\|href="[^"]*"' index.html | cut -d'"' -f2 | grep -v '^http'); do
  [ -f "$f" ] && ok "asset $f" || bad "asset $f missing"
done

echo "--- e2e: $PASS passed, $FAIL failed ---"
[ "$FAIL" -eq 0 ]
