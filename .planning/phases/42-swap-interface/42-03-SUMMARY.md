---
phase: 42-swap-interface
plan: 03
subsystem: swap-profit-pools
tags: [swap, profit-pool, transaction-builder, hook-resolver, quote-engine, useSwap]
dependency-graph:
  requires: [42-01-swap-library, 42-02-sol-swap-ui]
  provides: [profit-pool-swap-builders, complete-swap-interface]
  affects: [phase-43-staking-ui, phase-44-charts]
tech-stack:
  added: []
  patterns: [dual-hook-resolution, untaxed-pool-routing, switch-case-instruction-dispatch]
key-files:
  created: []
  modified:
    - app/lib/swap/swap-builders.ts
    - app/hooks/useSwap.ts
decisions:
  - id: D42-03-01
    decision: "SwapForm.tsx required no changes for PROFIT pool support"
    rationale: "Component was built generically with isTaxed prop and resolvePool routing; PROFIT pool data flows through unchanged"
  - id: D42-03-02
    decision: "computeQuote no longer requires epochState for PROFIT pools"
    rationale: "PROFIT pools are untaxed; epochState is only needed for SOL pool tax rates. Guard changed from AND to conditional check"
  - id: D42-03-03
    decision: "Removed unused LAMPORTS_PER_SOL import from useSwap.ts"
    rationale: "Import was vestigial from initial scaffolding; cleaned up to prevent lint warnings"
metrics:
  duration: ~9 minutes
  completed: 2026-02-16
---

# Phase 42 Plan 03: PROFIT Pool Swap Support Summary

**PROFIT pool transaction builders with dual Transfer Hook resolution, complete useSwap routing for all 8 token pair combinations, 0% tax display for untaxed pools.**

## What Was Built

### PROFIT Pool Transaction Builders (`app/lib/swap/swap-builders.ts`)

Two new exported builder functions added alongside the existing SOL builders:

**buildProfitBuyTransaction** (CRIME/FRAUD -> PROFIT):
- 11 named accounts matching on-chain `SwapProfitBuy` struct (vs 20 for SOL pools)
- No tax distribution accounts (no epochState, taxAuthority, stakePool, stakingEscrow, carnageVault, treasury, stakingProgram, systemProgram)
- Single token program: `TOKEN_2022_PROGRAM_ID` (both sides are Token-2022)
- Dual hook resolution: `resolveHookAccounts` called twice (side A for CRIME/FRAUD, side B for PROFIT), 4 accounts each = 8 remaining_accounts
- AMM splits hook accounts at midpoint: first 4 = input side, last 4 = output side
- Creates user's PROFIT ATA if needed (TOKEN_2022_PROGRAM_ID)

**buildProfitSellTransaction** (PROFIT -> CRIME/FRAUD):
- Same 11-account structure as buy (AMM determines direction from instruction discriminator)
- Hook resolution reversed: side A = pool vault -> user (output), side B = user -> pool vault (input)
- Creates user's output CRIME/FRAUD ATA if needed (TOKEN_2022_PROGRAM_ID)

Both builders share helper: `getProfitPoolConfig(isCrime)` selecting CRIME_PROFIT or FRAUD_PROFIT from DEVNET_POOL_CONFIGS.

### useSwap Hook Updates (`app/hooks/useSwap.ts`)

**executeSwap routing** -- Replaced if/else chain with exhaustive switch on `poolConfig.instruction`:
- `swapSolBuy` -> `buildSolBuyTransaction`
- `swapSolSell` -> `buildSolSellTransaction`
- `swapProfitBuy` -> `buildProfitBuyTransaction`
- `swapProfitSell` -> `buildProfitSellTransaction`

**Forward quoting** -- Added cases for PROFIT pools in `computeQuote`:
- `swapProfitBuy`: calls `quoteProfitBuy(baseUnits, reserveToken, reserveProfit, PROFIT_POOL_FEE_BPS)`
- `swapProfitSell`: calls `quoteProfitSell(baseUnits, reserveToken, reserveProfit, PROFIT_POOL_FEE_BPS)`
- Both set `taxAmount: 0` in SwapQuote, causing FeeBreakdown to hide the tax line

**Reverse quoting** -- Added cases for PROFIT pools:
- `swapProfitBuy`: calls `reverseQuoteProfitBuy` -> computes input tokens needed
- `swapProfitSell`: calls `reverseQuoteProfitSell` -> computes input PROFIT needed

**Pool reserve mapping** -- PROFIT pools use different reserve layout:
- reserveA = CRIME/FRAUD (token side)
- reserveB = PROFIT
- (vs SOL pools where A = WSOL, B = token)

**epochState guard relaxed** -- `computeQuote` now only requires epochState for taxed (SOL) pools. PROFIT pool quotes work even when epochState hasn't loaded yet.

### SwapForm.tsx (No Changes Needed)

The form was already built generically to handle all pool types:
- `isTaxed = poolConfig?.isTaxed ?? true` correctly passes `false` for PROFIT pools
- Pool label display uses `poolConfig.label` ("CRIME/PROFIT", "FRAUD/PROFIT")
- Token pair validation via `VALID_PAIRS` already includes all 8 combinations
- Max button logic handles CRIME/FRAUD/PROFIT identically (full balance)
- Balance display via `getBalance()` already covers all 4 tokens

## All 8 Token Pair Combinations

| Input | Output | Pool | Instruction | Tax | Hooks |
|-------|--------|------|-------------|-----|-------|
| SOL | CRIME | CRIME/SOL | swapSolBuy | Buy tax | 4 |
| SOL | FRAUD | FRAUD/SOL | swapSolBuy | Buy tax | 4 |
| CRIME | SOL | CRIME/SOL | swapSolSell | Sell tax | 4 |
| FRAUD | SOL | FRAUD/SOL | swapSolSell | Sell tax | 4 |
| CRIME | PROFIT | CRIME/PROFIT | swapProfitBuy | None | 8 |
| FRAUD | PROFIT | FRAUD/PROFIT | swapProfitBuy | None | 8 |
| PROFIT | CRIME | CRIME/PROFIT | swapProfitSell | None | 8 |
| PROFIT | FRAUD | FRAUD/PROFIT | swapProfitSell | None | 8 |

## Decisions Made

| ID | Decision | Rationale |
|---|---|---|
| D42-03-01 | SwapForm.tsx required no changes | Already generic with isTaxed prop and resolvePool routing |
| D42-03-02 | epochState guard relaxed for PROFIT pools | PROFIT pools are untaxed; only SOL pools need epoch tax rates |
| D42-03-03 | Removed unused LAMPORTS_PER_SOL import | Vestigial import from initial scaffolding |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed unused LAMPORTS_PER_SOL import**
- **Found during:** Task 2
- **Issue:** `LAMPORTS_PER_SOL` was imported but never used in useSwap.ts
- **Fix:** Removed the import line
- **Files modified:** app/hooks/useSwap.ts
- **Commit:** 4263192

## Commits

| Task | Name | Commit | Key Files |
|---|---|---|---|
| 1 | PROFIT pool transaction builders | `16ba579` | app/lib/swap/swap-builders.ts |
| 2 | Hook routing in useSwap and form integration | `4263192` | app/hooks/useSwap.ts |

## Verification Results

1. All 4 builder functions exported from swap-builders.ts (grep count = 4)
2. PROFIT pool builders resolve 8 hook accounts (4 per side) -- 4 resolveHookAccounts calls for PROFIT builders
3. useSwap routes to correct builder for all 4 instruction types via switch
4. useSwap routes to correct quote function for all 4 instruction types (forward + reverse)
5. FeeBreakdown hides tax line for PROFIT pools via `isTaxed=false`
6. TypeScript compiles cleanly (`tsc --noEmit` passes)
7. Next.js production build succeeds (`next build` -- all routes compile)

## Phase 42 Completion

This plan completes Phase 42 (Swap Interface). All 3 plans are done:
- **42-01**: Swap library infrastructure (quote engine, error map, WSOL helpers, hook resolver, shared constants)
- **42-02**: SOL swap form and UI (transaction builders, useSwap hook, form components, live-tested on devnet)
- **42-03**: PROFIT pool support (PROFIT builders, dual hooks, complete routing for all 8 pairs)

The swap interface is feature-complete: all 8 token pair combinations work through a single unified form with correct quoting, fee breakdowns, and transaction building.
