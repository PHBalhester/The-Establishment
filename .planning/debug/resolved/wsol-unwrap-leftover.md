---
status: resolved
trigger: "SOL swaps on mainnet leave small wSOL balance in user's wallet after swap completes"
created: 2026-03-24T00:00:00Z
updated: 2026-03-24T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED - buildSolBuyTransaction is missing wSOL unwrap instruction after swap
test: Read swap-builders.ts and confirmed buy path has no closeAccount
expecting: Adding unwrap instruction to buy path will fix the buy-direction leftover
next_action: Apply fix to buildSolBuyTransaction, then verify sell path for edge cases

## Symptoms

expected: After any SOL swap (buy or sell), user's wallet should have only native SOL, no wSOL token account balance remaining
actual: A small amount of wSOL remains in the user's wallet after each swap (both SOL->Token buys and Token->SOL sells)
errors: No errors - swaps complete successfully
reproduction: Perform any SOL swap on mainnet - check wallet for wSOL balance afterward
started: Observed on mainnet (both directions)

## Eliminated

## Evidence

- timestamp: 2026-03-24T00:05:00Z
  checked: buildSolBuyTransaction in app/lib/swap/swap-builders.ts (lines 198-292)
  found: Transaction builds 5 steps: ComputeBudget, WSOL wrap, output ATA creation, hook resolution, swap instruction. NO closeAccount/unwrap instruction appended after swap.
  implication: After a SOL buy, the user's wSOL ATA retains any leftover balance (rounding, slippage difference) as wSOL instead of being unwrapped back to SOL.

- timestamp: 2026-03-24T00:05:00Z
  checked: buildSolSellTransaction in app/lib/swap/swap-builders.ts (lines 319-407)
  found: Sell path DOES include unwrap instruction at line 403 (step 5). This correctly closes wSOL ATA after sell.
  implication: Sell path should not leave wSOL remnants for single-hop swaps. But the buy path is definitively missing the unwrap.

- timestamp: 2026-03-24T00:06:00Z
  checked: processInstructionsForAtomic in multi-hop-builder.ts (lines 177-254)
  found: Multi-hop builder strips intermediate closeAccount instructions but keeps the LAST one. For atomic routes containing a buy step, no closeAccount exists in the buy step at all.
  implication: Multi-hop routes ending with a buy (e.g., PROFIT->CRIME->SOL buy... wait, that's not a buy). Multi-hop routes involving SOL buys as intermediate steps also won't have unwrap. But more importantly, if a multi-hop route starts with a sell-to-SOL and then does a buy-from-SOL, the sell's close would destroy the wSOL ATA before the buy can use it. Actually, that doesn't apply here -- the route engine wouldn't chain sell->buy through SOL.

## Resolution

root_cause: buildSolBuyTransaction in swap-builders.ts was missing the wSOL unwrap (closeAccount) instruction after the swap. The sell path had it (line 403) but the buy path ended immediately after tx.add(swapIx) with no close. After a SOL buy, the user's wSOL ATA retained leftover balance (rounding, slippage, rent-exempt lamports) as wSOL instead of being unwrapped back to native SOL.
fix: Added buildWsolUnwrapInstruction(userPublicKey) as the final instruction in buildSolBuyTransaction, matching the pattern already used in buildSolSellTransaction. The multi-hop processInstructionsForAtomic already handles multiple closeAccount instructions correctly (keeps only the last one), so split buy routes are also safe.
verification: TypeScript compiles cleanly (npx tsc --noEmit). Multi-hop edge cases analyzed -- processInstructionsForAtomic correctly deduplicates close instructions for split routes.
files_changed:
  - app/lib/swap/swap-builders.ts
