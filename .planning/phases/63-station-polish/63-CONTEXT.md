# Phase 63: Station Polish — Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Apply the component kit (Phase 60) to the three remaining non-Settings station modals — Carnage Cauldron, Staking/Rewards Vat, and Connect Wallet. Plus remove the dead Dashboard grid (Phase 54 testing artifact). Each station gets its own wave with a manual checkpoint after each for user review and edits.

</domain>

<decisions>
## Implementation Decisions

### Wave structure
- **4 waves, manual checkpoint after each** — no auto-executing through the phase
- Wave 1: Carnage Cauldron (CarnageStation.tsx)
- Wave 2: Staking / Rewards Vat (StakingStation.tsx)
- Wave 3: Connect Wallet (WalletStation.tsx)
- Wave 4: Dashboard removal (DashboardGrid.tsx + all card components) — validate no references break

### Frame treatment
- **Same riveted frame everywhere** — all stations get the identical kit-frame riveted-paper treatment as SwapStation. No per-station frame variants.

### Background treatment
- **Start with same dark factory background** — decide at each wave's checkpoint whether a subtle color tint per station is needed. Default: uniform.

### Inner component adoption
- **Replace ALL inner components with kit equivalents** — every button becomes kit-button, every tab becomes kit-tabs, every input becomes kit-input. Full kit adoption, not just outer chrome.

### Gauge/Meter approach
- **Photoshop bezel + CSS/SVG fill** — semi-circle (180° arc) gauge
- User will create a brass bezel asset in Photoshop; Claude overlays dynamic CSS/SVG needle + fill arc
- Single bezel variant reused across all gauge instances with different colors/labels per context
- **Gauges are optional** — apply frame + kit treatment first, then decide at checkpoint whether gauges actually add value for specific metrics. Don't over-engineer upfront.

### Dashboard removal (Wave 4)
- DashboardGrid is dead code — not rendered on main page since Phase 54 factory scene replaced it
- Remove: DashboardGrid.tsx, EpochCard.tsx, TaxRatesCard.tsx, PoolCard.tsx, CarnageCard.tsx (under app/components/dashboard/)
- **Careful validation required** — ensure no other components import from the dashboard directory before deleting. Check hooks that were exclusively used by dashboard.

### Claude's Discretion
- Specific layout adjustments within each station (spacing, ordering)
- How kit tokens map to existing factory-* color classes
- Responsive breakpoint adjustments
- Whether to refactor station internals for cleaner kit integration vs. minimal touch

</decisions>

<specifics>
## Specific Ideas

- Pattern follows Phase 62 SwapStation polish — same riveted frame, same chromeVariant opt-in approach
- Wallet station is connection flow only (minimal content) — smallest wave
- Carnage and Staking have more content to restyle
- Dashboard data hooks (useEpochState, usePoolPrices, etc.) are NOT dashboard-specific — they're used by other parts of the app. Only the dashboard UI components are dead code.

</specifics>

<deferred>
## Deferred Ideas

- **Wallet balances display in Settings modal** — show SOL, CRIME, FRAUD, PROFIT balances. New capability, not part of station polish.
- **Elaborate gauge components** — if gauges aren't needed after checkpoint review, defer to a future visual polish phase

</deferred>

---

*Phase: 63-station-polish*
*Context gathered: 2026-02-27*
