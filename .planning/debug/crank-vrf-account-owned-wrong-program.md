---
status: investigating
trigger: "crank-vrf-account-owned-wrong-program - Railway crank hits 0xbbf (3007 AccountOwnedByWrongProgram) on every retry_epoch_vrf"
created: 2026-03-24T00:00:00Z
updated: 2026-03-24T00:00:00Z
---

## Current Focus

hypothesis: Epoch program has a stale cross-program reference (tax/amm/staking program ID) that wasn't patched correctly, causing an ownership constraint to fail
test: Compare deployed program cross-refs against actual deployed program IDs
expecting: Mismatch between hardcoded ID and actual deployed program ID
next_action: Read epoch-program constants.rs, sync-program-ids.ts CROSS_REFS, and retry_epoch_vrf instruction

## Symptoms

expected: Crank should recover stale VRF, advance to next epoch, start normal operation
actual: Every cycle: detects stale VRF -> reveal fails 3007 -> timeout retry -> create fresh randomness -> retry_epoch_vrf also fails 3007 -> circuit breaker trips after 5 cycles
errors: "custom program error: 0xbbf" (AccountOwnedByWrongProgram) on Instruction 2 (epoch program instruction after ComputeBudget). Program E1u6fM9Pr3Pgbcz1NGq9KQzFbwD8F1uFkT3c9x1juA5h
reproduction: 100% on every crank cycle
started: After Phase 102 graduation, fresh deploy with new program IDs

## Eliminated

## Evidence

## Resolution

root_cause:
fix:
verification:
files_changed: []
