---
status: resolved
trigger: "SOL->PROFIT swaps leave intermediate CRIME/FRAUD tokens in user wallet + PROFIT->SOL sell fails with insufficient funds on second leg"
created: 2026-03-24T00:00:00Z
updated: 2026-03-25T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED (both directions) -- buildAtomicRoute blindly chains ALL steps sequentially, applying slippage-adjusted previousMinimumOutput as each step's input. This causes TWO bugs: (1) BUY direction: intermediate tokens leak because vault converts less than AMM produced. (2) SELL direction (split): step 3 receives SOL lamports from step 2 instead of its own PROFIT input, causing vault to produce tiny FRAUD, then step 4 tries to sell the original large FRAUD amount -> insufficient funds.
test: Traced full code path for both directions
expecting: Fix must handle both sequential multi-hop AND parallel split route legs
next_action: Implement fix in buildAtomicRoute

## Symptoms

### Original (BUY direction - SOL->PROFIT)
expected: SOL->PROFIT swap yields only PROFIT tokens. All intermediate CRIME/FRAUD from the SOL->faction step should be converted to PROFIT in the faction->PROFIT step.
actual: Users receive both CRIME/FRAUD AND PROFIT tokens -- intermediate tokens leak through
errors: No transaction errors -- transactions succeed but with wrong token distribution
reproduction: Execute a SOL->PROFIT swap. Check wallet afterward -- CRIME or FRAUD tokens appear.

### New (SELL direction - PROFIT->SOL split)
expected: User sells PROFIT for SOL via multi-hop route (PROFIT->faction->SOL, split across both factions). Both sell legs should succeed.
actual: First leg (PROFIT->CRIME->SOL) succeeds. Second leg (PROFIT->FRAUD->SOL) fails with Token-2022 TransferChecked "insufficient funds" (error 0x1) at instruction 8.
errors: "Error processing Instruction 8: custom program error: 0x1" -- Token-2022 TransferChecked insufficient funds during SwapSolSell #2
reproduction: A mainnet user attempted a PROFIT->SOL split sell. Second leg failed with insufficient funds. TX signature and wallet on record with dev team.

## Eliminated

## Evidence

- timestamp: 2026-03-24T00:00:30Z
  checked: route-engine.ts quoteRoute() function (lines 318-386)
  found: Routes are correctly computed with chained BigInt outputs (step N output = step N+1 input). The route-engine quotes are accurate.
  implication: The quote computation itself is correct; the bug is in how quotes are translated to transaction instructions.

- timestamp: 2026-03-24T00:00:40Z
  checked: multi-hop-builder.ts buildAtomicRoute() function (lines 298-365)
  found: Lines 320-341 show the critical logic. For step 2+, `effectiveInput = previousMinimumOutput` where `previousMinimumOutput = Math.floor(step1.outputAmount * (10000 - slippageBps) / 10000)`. This means step 2's vault convert instruction is hardcoded to convert ONLY the slippage-adjusted minimum from step 1, not the actual amount produced.
  implication: ROOT CAUSE CONFIRMED. When step 1 (SOL->CRIME AMM swap) produces its expected output (not the worst-case minimum), the vault convert in step 2 only converts the minimum amount. The difference (actual - minimum) remains as CRIME/FRAUD tokens in the user's wallet.

- timestamp: 2026-03-24T00:00:45Z
  checked: conversion-vault/src/instructions/convert.rs handler (lines 116-174)
  found: The vault convert instruction takes `amount_in: u64` as a parameter and converts exactly that amount. It does NOT convert the user's entire token balance -- only the specified amount.
  implication: Confirms that whatever amount the client passes is all that gets converted. Any excess from step 1 beyond that amount stays in the user's ATA.

- timestamp: 2026-03-24T00:00:50Z
  checked: The slippage math at line 306-309 of buildAtomicRoute
  found: slippageBps is derived from `Math.floor((1 - route.minimumOutput / route.outputAmount) * 10_000)` which reflects the user's configured slippage (e.g., 100 = 1%). With 1% slippage, step 2 would only convert 99% of step 1's expected output. With higher slippage, the leak is proportionally larger.
  implication: The leaked amount is proportional to slippage setting. At 1% slippage, ~1% of intermediate tokens leak. At 5%, ~5% leak.

- timestamp: 2026-03-25T00:00:10Z
  checked: buildProfitToSolSplitSteps() in useRoutes.ts (lines 270-333) and buildAtomicRoute() chaining logic
  found: Split route produces 4 steps: [PROFIT->CRIME(vault), CRIME->SOL(sell), PROFIT->FRAUD(vault), FRAUD->SOL(sell)]. buildAtomicRoute chains them sequentially: step 3 gets previousMinimumOutput from step 2, which is SOL lamports (not PROFIT tokens). Vault converts that tiny amount of PROFIT to FRAUD. Step 4 then tries to sell the original quoted FRAUD amount but user only has the tiny amount -> insufficient funds.
  implication: The chaining logic assumes all steps are sequential hops in a single path, but split routes have TWO INDEPENDENT parallel legs. Steps 3-4 must NOT depend on steps 1-2.

## Resolution

root_cause: buildAtomicRoute() in multi-hop-builder.ts has TWO related bugs caused by blindly applying sequential chaining to all route steps:

1. **BUY direction (non-split 2-hop)**: Step 2 uses slippage-adjusted minimumOutput from step 1 as its input. Since execution is atomic, step 1's ACTUAL output is always the full expected amount (or TX reverts). Using the slippage-reduced amount means ~slippage% of intermediate tokens are never converted, leaking into user's wallet.

2. **SELL direction (split 4-step)**: Steps are [vault1, sell1, vault2, sell2] but chaining treats them as sequential. Step 3 (vault2) receives step 2's SOL output instead of its own PROFIT input. This causes vault2 to convert a wrong tiny amount, then sell2 tries to sell more FRAUD than exists -> "insufficient funds" failure.

**Fix**: For intermediate steps in an atomic transaction, use the FULL expected output (step.outputAmount) as the next step's input, NOT the slippage-adjusted minimum. For split routes, reset the chain at each leg boundary (steps that start a new independent leg should use their own inputAmount, not the previous step's output). Apply slippage ONLY to the final step's minimumOutput.

fix: Rewrote the step-chaining logic in buildAtomicRoute() (multi-hop-builder.ts) with three key changes: (1) Use step.outputAmount (full expected output) for inter-hop chaining instead of slippage-adjusted minimumOutput. (2) Detect split route leg boundaries (step.inputToken == route.inputToken) and reset the chain for each independent leg. (3) Apply slippage only to steps producing route.outputToken (final output steps), not intermediate hops.
verification: Existing 31 vitest tests pass. Manual trace through all 5 route scenarios (direct, 2-hop buy, 2-hop sell, 4-step split buy, 4-step split sell) confirms correct behavior.
files_changed: [app/lib/swap/multi-hop-builder.ts]
