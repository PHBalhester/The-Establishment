---
phase: 41
plan: 03
subsystem: frontend-dashboard-enhancements
tags: [carnage-events, warning-banner, error-handling, coingecko, price-display]
requires: [41-02-dashboard-components]
provides: [carnage-event-history, epoch-warning-banner, rpc-error-resilience]
affects: []
tech-stack:
  added: []
  patterns: [anchor-event-discriminator, transaction-log-parsing, global-error-banner, full-decimal-price]
key-files:
  created:
    - app/hooks/useCarnageEvents.ts
  modified:
    - app/components/dashboard/CarnageCard.tsx
    - app/components/dashboard/EpochCard.tsx
    - app/components/dashboard/DashboardGrid.tsx
    - app/components/dashboard/PoolCard.tsx
    - app/lib/jupiter.ts
key-decisions:
  - id: DASH-05
    decision: "CoinGecko free API for SOL/USD instead of Jupiter V3"
    rationale: "Jupiter Price API V2/V3 now requires API key; CoinGecko free endpoint works without auth"
  - id: DASH-06
    decision: "PROFIT pool market cap derived from SOL pool token prices"
    rationale: "PROFIT pools have no SOL side; derive CRIME/FRAUD price from their SOL pools, pass as knownTokenPriceUsd"
  - id: DASH-07
    decision: "Full decimal price display instead of scientific notation"
    rationale: "User prefers $0.0000161 over $1.61e-5 for readability"
  - id: DASH-08
    decision: "Reserve labels use mint-address detection, not positional label splitting"
    rationale: "On-chain mintA/mintB order doesn't match display label (e.g. CRIME/SOL but mintA=WSOL)"
duration: ~15 minutes (including 4 bug fixes during checkpoint)
completed: 2026-02-15
---

# Phase 41 Plan 03: Dashboard Enhancements Summary

**Carnage event history, epoch warning banner, error resilience, plus 4 bug fixes discovered during human-verify checkpoint**

## Performance

- **Duration:** ~15 minutes (tasks 1-2 autonomous + checkpoint with 4 fixes)
- **Tasks:** 3/3 completed (2 auto + 1 human-verify checkpoint)
- **TypeScript:** Zero errors across all modified components
- **Checkpoint bugs found:** 4 (all fixed and committed)

## Accomplishments

1. **useCarnageEvents hook** -- Fetches last 5 Carnage events by parsing Anchor event logs from CarnageFund PDA transactions. Uses `getSignaturesForAddress` + `getParsedTransaction` with Anchor event discriminator (`sha256("event:CarnageExecuted")[0..8]`) for base64 log decoding. Polls every 60 seconds. Graceful fallback when no events exist.

2. **CarnageCard event history** -- Shows up to 5 recent Carnage events with date, token burned, SOL spent, and clickable Solana Explorer links. Empty state shows "No Carnage events recorded yet."

3. **EpochCard warning banner** -- Prominent amber banner (`bg-amber-900/50 border-amber-600`) with `animate-pulse` when epoch transition is within 30 seconds. Satisfies DATA-07 warning requirement.

4. **DashboardGrid error resilience** -- Global RPC error banner when ALL hooks fail simultaneously (total RPC failure). Individual card errors handled independently. WebSocket reconnection handled passively via `@solana/web3.js` Connection internals.

### Bug Fixes During Checkpoint

5. **Jupiter V3 → CoinGecko** (DASH-05) -- Jupiter Price API V2/V3 returns 401 Unauthorized without API key. Switched to CoinGecko free `simple/price` endpoint.

6. **PROFIT pool market cap** (DASH-06) -- PROFIT pools showed "N/A" because they have no SOL side. Added `knownTokenPriceUsd` prop to PoolCard; DashboardGrid derives CRIME/FRAUD prices from their SOL pools and passes to PROFIT pool cards.

7. **Reserve label fix** (DASH-08) -- Labels showed "197.1M SOL" instead of "197.1M CRIME" because on-chain mintA/mintB ordering doesn't match display labels. Fixed to use mint address detection (`mintAIsSOL`/`mintBIsSOL`) for correct name assignment.

8. **Full decimal prices** (DASH-07) -- Changed `formatUsdPrice` from scientific notation (`$1.61e-5`) to full decimal display (`$0.0000161`) with 3 significant figures for readability.

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | useCarnageEvents hook | `060df09` | useCarnageEvents.ts |
| 2 | Event history, warning banner, error handling | `faf4fd8` | CarnageCard.tsx, EpochCard.tsx, DashboardGrid.tsx |
| 3 | Checkpoint: human-verify | approved | -- |
| fix | Jupiter → CoinGecko | `36346ac` | jupiter.ts |
| fix | PROFIT pool market cap | `ad8a770` | PoolCard.tsx, DashboardGrid.tsx |
| fix | Reserve label detection | `6617db8` | PoolCard.tsx |
| fix | Full decimal prices | `baf8385` | PoolCard.tsx |

## Files Created

- `app/hooks/useCarnageEvents.ts` -- Carnage event history from transaction log parsing

## Files Modified

- `app/components/dashboard/CarnageCard.tsx` -- Added event history section with Explorer links
- `app/components/dashboard/EpochCard.tsx` -- Added prominent amber warning banner for imminent epoch transition
- `app/components/dashboard/DashboardGrid.tsx` -- Wired useCarnageEvents, added global RPC error banner, added PROFIT pool price derivation
- `app/components/dashboard/PoolCard.tsx` -- Added knownTokenPriceUsd for PROFIT pools, fixed reserve labels, full decimal prices
- `app/lib/jupiter.ts` -- Switched from Jupiter V3 to CoinGecko free API

## Decisions Made

| ID | Decision | Rationale |
|----|----------|-----------|
| DASH-05 | CoinGecko free API for SOL/USD | Jupiter V3 requires API key; CoinGecko works without auth |
| DASH-06 | PROFIT pool mcap from SOL pool prices | No SOL side in PROFIT pools; derive from CRIME/FRAUD SOL pool prices |
| DASH-07 | Full decimal price display | $0.0000161 more readable than $1.61e-5 for users |
| DASH-08 | Mint-address-based reserve labels | On-chain mint ordering doesn't match display labels |

## Deviations from Plan

- **Added 4 bug fixes** during checkpoint that weren't in the original plan. All discovered via user testing on live devnet data. Each fix was minimal and targeted.

## Issues Encountered

- Jupiter Price API V2/V3 both require API keys now (401 Unauthorized). Resolved by switching to CoinGecko.
- On-chain pool mint ordering (mintA/mintB) doesn't match human-readable labels. Required mint-address detection instead of label parsing.

## Next Phase Readiness

**Phase 41 complete.** All 7 DATA requirements satisfied:
- DATA-01: Epoch number + cheap side -- EpochCard
- DATA-02: Epoch countdown -- EpochCard countdown text
- DATA-03: 4 tax rates -- TaxRatesCard
- DATA-04: Carnage vault balance -- CarnageCard
- DATA-05: Carnage history + lifetime stats -- CarnageCard events + aggregates
- DATA-06: Pool prices as market cap + price toggle -- PoolCard
- DATA-07: Epoch warning banner -- EpochCard imminent banner

Ready for Phase 42 (Swap Interface).
