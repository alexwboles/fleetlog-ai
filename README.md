# 🚚 FleetLog AI

**The fleet notebook that pays for itself** — a vehicle & equipment log for trades and small businesses: fuel tracking, maintenance alerts, and cost-per-mile.

## The problem
Small contractors, landscapers, and trades run trucks, vans, trailers, and equipment on gut feel. Fuel costs vanish into receipts, oil changes get missed, and nobody knows the true cost per mile of each rig — so maintenance surprises and fuel waste eat the margin.

## The solution
FleetLog AI is a single-page app you open in a browser:

1. **Vehicle & equipment log** — name, type (truck/van/car/trailer/equipment), year, make/model, VIN + plate (optional), and an optional photo (stored as a data URL in localStorage, capped at 300 KB with a graceful note if too large).
2. **Fuel log with auto MPG** — date, odometer reading, gallons, price/gal; fill-up cost is automatic and MPG is computed per fill-up (miles since last fill-up ÷ gallons). Odometer readings must increase — a lower reading is rejected with a plain-language error. Delete mistaken fill-ups (MPG recomputes), sort history by date/MPG/cost, flag ⚠ low-MPG anomalies (25%+ drop vs recent average — possible fuel waste), and export fuel or service history as CSV.
3. **Maintenance schedule with due-date alerts** — per-vehicle service types (oil change, tires, brakes, inspection, registration, custom) each with an interval in miles and/or months. Dashboard flags:
   - 🔴 OVERDUE — past the date or mileage
   - 🟡 DUE SOON — within 30 days or 500 miles
   - 🟢 OK — on schedule
   "Mark done" records a dated service entry (cost, notes) and resets the clock.
4. **Cost-per-mile calculator** — total fuel + maintenance ÷ miles driven over a selectable period (30 days, 90 days, 12 months, this year, all time).
5. **Service history per vehicle** — chronological log with dates, readings, type, notes, costs, plus per-vehicle totals.
6. **Dashboard summary** — fleet size, total spend this year, count needing attention, fleet-wide average MPG, plus fleet search by name/make/model/plate.

Everything runs **locally in the browser** (localStorage). No account, no network, no fees. If you set `OPENAI_API_KEY`, maintenance blurbs could optionally be polished by a model — never required.

## Run it
No build step. Open `index.html` in a browser, or serve it:

```bash
npx serve .          # or: python3 -m http.server 8080
```

## Pricing vision
Free for up to 3 vehicles · **Pro $15/mo** — unlimited vehicles, fuel-price alerts, printable service reports · **Fleet $49/mo** — multi-user, mechanic handoff, export to accounting.

## Tests
```bash
bash test/smoke.sh   # 11 checks
bash test/e2e.sh     # 6 flows
```

## Tech
Pure static HTML/CSS/JS. Core logic lives in `lib/logic.js`, shared between the browser and Node tests (UMD wrapper) — so the math the tests verify is exactly the math the UI runs.
