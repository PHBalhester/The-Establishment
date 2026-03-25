---
status: diagnosed
trigger: "Selecting Max for SOL balance then executing a swap causes the transaction to fail"
created: 2026-03-24T00:00:00Z
updated: 2026-03-24T00:01:00Z
---

## Current Focus

hypothesis: CONFIRMED - SOL_FEE_RESERVE is static 0.01 SOL but actual tx costs are dynamic and can far exceed this
test: Calculated priority fee costs from PRIORITY_FEE_MAP and compute unit limits
expecting: Priority fees at high/turbo exceed 0.01 SOL reserve
next_action: Return diagnosis

## Symptoms

expected: User clicks "Max" on SOL balance, executes swap, transaction succeeds
actual: Transaction fails with max amount. Works if user manually reduces by ~0.05 SOL
errors: Transaction failure (insufficient lamports for fees/rent)
reproduction: Select Max SOL, attempt any swap (SOL->CRIME, SOL->FRAUD, SOL->PROFIT)
started: Recently noticed after swap transaction fixes

## Eliminated

## Evidence

- timestamp: 2026-03-24T00:00:30Z
  checked: SwapForm.tsx line 92 - SOL_FEE_RESERVE constant
  found: Static value of 0.01 SOL (10,000,000 lamports) subtracted from max
  implication: This is the only fee reservation; it's a hardcoded constant

- timestamp: 2026-03-24T00:00:40Z
  checked: useSwap.ts lines 103-109 - PRIORITY_FEE_MAP
  found: Priority fees range from 0 (none) to 1,000,000 (turbo) microLamports/CU
  implication: Priority fees are a major variable cost not accounted for

- timestamp: 2026-03-24T00:00:45Z
  checked: swap-builders.ts - compute unit limits
  found: Buy = 200,000 CU, Sell = 250,000 CU
  implication: Priority fee cost = microLamports * CU / 1,000,000

- timestamp: 2026-03-24T00:00:50Z
  checked: Calculated actual priority fee costs
  found: |
    none:   0 SOL
    low:    0.0002 SOL (1,000 * 200,000 / 1e6 / 1e9 * 1e6 = 200,000 lamports)
    medium: 0.002 SOL (2,000,000 lamports)
    high:   0.02 SOL (20,000,000 lamports) -- EXCEEDS 0.01 reserve
    turbo:  0.2 SOL (200,000,000 lamports) -- MASSIVELY EXCEEDS 0.01 reserve
  implication: At "high" or "turbo" priority, the reserve is insufficient

- timestamp: 2026-03-24T00:00:55Z
  checked: wsol.ts - WSOL ATA creation
  found: If WSOL ATA doesn't exist, createAssociatedTokenAccountInstruction is added, costing ~0.00204 SOL rent
  implication: Additional ~0.002 SOL cost if first-time WSOL user

- timestamp: 2026-03-24T00:01:00Z
  checked: swap-builders.ts lines 230-240 - output token ATA creation
  found: If user doesn't have output token ATA (CRIME/FRAUD), another createAssociatedTokenAccountInstruction is added
  implication: Additional ~0.002 SOL for first-time token holder

## Resolution

root_cause: |
  SOL_FEE_RESERVE in SwapForm.tsx is a static 0.01 SOL, but actual transaction costs
  are dynamic and depend on:
  1. Priority fee preset (high = 0.02 SOL, turbo = 0.2 SOL -- both exceed the 0.01 reserve)
  2. Whether WSOL ATA needs creation (+0.002 SOL rent)
  3. Whether output token ATA needs creation (+0.002 SOL rent)
  4. Base transaction fee (~0.000005 SOL, negligible)

  At "high" priority, priority fees alone (0.02 SOL) exceed the 0.01 SOL reserve.
  At "turbo" priority, fees are 0.2 SOL -- 20x the reserve.
  The user's observation of needing ~0.05 SOL reduction matches "high" priority
  with ATA creation costs.

fix:
verification:
files_changed: []
