---
status: diagnosed
trigger: "SOL->PROFIT swaps leave intermediate CRIME/FRAUD tokens in user wallet"
created: 2026-03-24T00:00:00Z
updated: 2026-03-24T00:01:00Z
---

## Current Focus

hypothesis: CONFIRMED -- buildAtomicRoute uses previousMinimumOutput (slippage-adjusted) as step 2's input amount, but step 1's actual on-chain output is larger, leaving the difference as leaked intermediate tokens
test: Traced the full code path from route computation through atomic TX building
expecting: Step 2 input amount < step 1 actual output, confirmed
next_action: Return root cause diagnosis

## Symptoms

expected: SOL->PROFIT swap yields only PROFIT tokens. All intermediate CRIME/FRAUD from the SOL->faction step should be converted to PROFIT in the faction->PROFIT step.
actual: Users receive both CRIME/FRAUD AND PROFIT tokens -- intermediate tokens leak through
errors: No transaction errors -- transactions succeed but with wrong token distribution
reproduction: Execute a SOL->PROFIT swap. Check wallet afterward -- CRIME or FRAUD tokens appear.
started: Recently noticed after swap transaction fixes in previous session

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

## Resolution

root_cause: In multi-hop-builder.ts buildAtomicRoute(), step 2 (vault convert) uses step 1's minimumOutput (slippage-adjusted) as its input amount instead of step 1's full expected output. Since both steps execute atomically in a single transaction, there is no inter-hop risk -- if step 1 produces fewer tokens than expected, the vault convert would fail (insufficient balance). The slippage guard should be on the FINAL output only, not applied to intermediate hop amounts. The vault convert should use step 1's full quoted output amount, and only the final step's output should have slippage applied.
fix:
verification:
files_changed: []
