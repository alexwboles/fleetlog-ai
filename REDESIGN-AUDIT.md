# Redesign Audit — fleetlog-ai (2026-10-13)

**Competitors studied:** Fuelly (garage list, fuel-up log with miles/gallons/price→MPG auto-computed, per-fill MPG table, MPG trend charts, service reminders with badges), Samsara fleet dashboards (dark ops consoles, status chips, big telematic numerals), Fleetio (due/overdue service board).

## Visual gaps
1. **Theme is generic light gray.** Fleet ops software has an industrial personality — dark dispatch consoles, odometer numerals, caution-yellow status language. Ours reads like a settings form. → dark "yard office" theme.
2. **Fleet cards are flat text rows.** Fuelly's garage shows each vehicle with its key vitals. Ours shows name + spend only — no MPG, no $/mile, no reading. → vitals chips (avg MPG, $/mile, latest reading).
3. **Stat tiles are plain.** Samsara-style consoles use big telematic numerals with caps labels on dark. → restyle.
4. **No economy readout at a glance.** MPG trend chart exists in fuel history but dashboard cards lack any MPG figure. → per-vehicle avg MPG chip on cards + gauge ring on dashboard.

## Functional / flow gaps
1. **No per-fill MPG on dashboard cards.** → show avg MPG + cost/mile chips (data exists: vehicleTotals, compareVehicles).
2. **Alert rows lack severity color coding beyond flags.** → keep flags; add left severity bars.
3. **"Needs attention" card could deep-link to maintenance.** → add jump buttons to maintenance view.

## Decisions
- Keep: all views, fuel logging + CSV import, MPG/price trend charts, service schedules + projections, cost-per-mile calculator, photo upload, vehicle search, comparison table.
- Identity: "yard office" — dark asphalt surfaces, safety-yellow action accent, red/yellow/green service flags, odometer numerals, stencil kickers, sharp corners.
