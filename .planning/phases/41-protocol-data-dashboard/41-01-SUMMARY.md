---
phase: 41
plan: 01
subsystem: frontend-data-layer
tags: [react-hooks, websocket, polling, jupiter-api, solana-rpc, anchor]
requires: [phase-39-frontend-foundations, phase-40-wallet-connection]
provides: [data-fetching-hooks, shared-constants, connection-singleton]
affects: [41-02-dashboard-components, 41-03-dashboard-layout]
tech-stack:
  added: []
  patterns: [websocket-subscription-hooks, polling-hooks, singleton-connection, bn-to-number-extraction]
key-files:
  created:
    - app/hooks/useEpochState.ts
    - app/hooks/useCurrentSlot.ts
    - app/hooks/useSolPrice.ts
    - app/hooks/usePoolPrices.ts
    - app/hooks/useCarnageData.ts
    - app/lib/jupiter.ts
  modified:
    - shared/constants.ts
    - shared/index.ts
    - app/lib/connection.ts
key-decisions:
  - decision: "Use 400ms for MS_PER_SLOT (standard Solana approximation)"
    reason: "On-chain constant is 420ms but 400ms is the widely-used standard for UI display"
  - decision: "Connection factory is singleton (module-level cache)"
    reason: "Multiple WebSocket hooks sharing one Connection avoids duplicate WS channels to Helius"
  - decision: "Jupiter Price API V3 with fallback field names (price + usdPrice)"
    reason: "API may return different field names across versions; graceful fallback prevents breakage"
  - decision: "usePoolPrices uses WebSocket (onAccountChange) not polling"
    reason: "Pool reserves change on every swap; WebSocket gives instant updates vs 10s polling delay"
  - decision: "useCarnageData uses hybrid: polling for CarnageFundState + WebSocket for vault balance"
    reason: "Fund state changes infrequently (only on Carnage trigger) but vault balance changes on every tax collection"
  - decision: "All BN fields extracted to plain numbers in hook state"
    reason: "Anchor BN objects cause React serialization issues; plain numbers are safe for useState"
duration: ~5 minutes
completed: 2026-02-15
---

# Phase 41 Plan 01: Data-Fetching Infrastructure Summary

**One-liner:** 5 React hooks + Jupiter helper + shared constants providing real-time protocol data via WebSocket subscriptions and polling for the dashboard UI layer.

## Performance

- **Duration:** ~5 minutes
- **Tasks:** 3/3 completed
- **TypeScript:** Zero errors (tsc --noEmit + next build both pass)
- **No new dependencies:** All imports resolve to existing packages

## Accomplishments

1. **Shared constants expanded** -- Added `SLOTS_PER_EPOCH` (750), `MS_PER_SLOT` (400), `DEVNET_PDAS` (EpochState, CarnageFund, CarnageSolVault), and `DEVNET_POOLS` (all 4 pool addresses) to the shared package. All addresses sourced from pda-manifest.json.

2. **Connection factory upgraded to singleton with WebSocket** -- `getConnection()` now memoizes the Connection instance and includes an explicit `wsEndpoint` (wss:// derived from https:// RPC URL). This is required for Helius WebSocket subscriptions and prevents multiple hooks from opening duplicate WS channels.

3. **Jupiter Price API helper** -- `fetchSolPrice()` hits Jupiter Price API V3 for SOL/USD price. Returns null on any error (never throws). Handles both V3 (`price`) and V2 (`usdPrice`) response field names.

4. **Three polling hooks created:**
   - `useEpochState` -- Polls EpochState PDA every 10s, returns epoch number, cheap side, tax rates, epoch start slot
   - `useCurrentSlot` -- Polls `getSlot()` every 10s for countdown computation
   - `useSolPrice` -- Polls Jupiter API every 30s for SOL/USD market price

5. **Two WebSocket hooks created:**
   - `usePoolPrices` -- Subscribes to all 4 pool accounts via `onAccountChange()`, initial fetch + real-time Anchor decode of PoolState for reserves and mints
   - `useCarnageData` -- Hybrid: polls CarnageFundState PDA every 10s for lifetime stats, subscribes to CarnageSolVault via WebSocket for real-time SOL balance

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Shared constants, Jupiter helper, connection singleton | `e8b6dc9` | shared/constants.ts, shared/index.ts, app/lib/jupiter.ts, app/lib/connection.ts |
| 2 | useEpochState, useCurrentSlot, useSolPrice hooks | `16096e7` | app/hooks/useEpochState.ts, app/hooks/useCurrentSlot.ts, app/hooks/useSolPrice.ts |
| 3 | usePoolPrices WebSocket and useCarnageData hooks | `def4a89` | app/hooks/usePoolPrices.ts, app/hooks/useCarnageData.ts |

## Files Created

| File | Purpose |
|------|---------|
| `app/hooks/useEpochState.ts` | Polls EpochState PDA for epoch number, cheap side, tax rates, start slot |
| `app/hooks/useCurrentSlot.ts` | Polls getSlot() for epoch countdown computation |
| `app/hooks/useSolPrice.ts` | Polls Jupiter Price API V3 for SOL/USD price |
| `app/hooks/usePoolPrices.ts` | WebSocket subscriptions to all 4 pool accounts for real-time reserves |
| `app/hooks/useCarnageData.ts` | Polls CarnageFundState + WebSocket for vault SOL balance |
| `app/lib/jupiter.ts` | Jupiter Price API V3 helper (fetchSolPrice) |

## Files Modified

| File | Changes |
|------|---------|
| `shared/constants.ts` | Added SLOTS_PER_EPOCH, MS_PER_SLOT, DEVNET_PDAS, DEVNET_POOLS |
| `shared/index.ts` | Added barrel exports for new constants |
| `app/lib/connection.ts` | Upgraded to singleton with explicit wsEndpoint for WebSocket |

## Decisions Made

1. **MS_PER_SLOT = 400** -- The on-chain constant is 420ms (conservative estimate), but 400ms is the standard Solana approximation used across the ecosystem for UI display. The difference is negligible for countdown timers.

2. **Singleton Connection** -- Module-level `cachedConnection` variable that's reused when the RPC URL hasn't changed. Without this, each hook would create its own Connection and open separate WebSocket channels, wasting Helius rate limit budget.

3. **BN-to-number extraction** -- All Anchor BN fields are converted to plain JavaScript numbers in hook state. BN objects are not serializable by React and cause issues with useState/context propagation. Slot and lamport values are safe as JS numbers (won't exceed Number.MAX_SAFE_INTEGER for centuries).

4. **WebSocket for pools, polling for most else** -- Pool reserves change on every swap (potentially many times per second), making WebSocket ideal. EpochState changes once per epoch (~5 min), CarnageFundState changes on Carnage triggers (~4% chance per epoch), and SOL price changes continuously but not per-block -- polling at 10-30s is appropriate for these.

5. **useSolPrice preserves last good price on error** -- When Jupiter API returns null, the hook sets an error string but does NOT overwrite the last known good price. This prevents the UI from showing "$0" during transient API failures.

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

**Ready for 41-02** (Dashboard Components). All data hooks are in place:
- `useEpochState` provides epoch number, cheap side, tax rates, start slot
- `useCurrentSlot` provides current slot for countdown timer
- `useSolPrice` provides SOL/USD for dollar-denominated displays
- `usePoolPrices` provides real-time reserve data for price computation
- `useCarnageData` provides lifetime stats and real-time vault balance

The dashboard component plan (41-02) can import these hooks directly and wire them to UI components.
