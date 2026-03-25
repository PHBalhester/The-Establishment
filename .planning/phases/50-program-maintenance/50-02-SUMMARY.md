---
phase: 50-program-maintenance
plan: 02
subsystem: on-chain-programs
tags: [bounty, invoke-signed, pda, carnage-vault, epoch-transition, incentives]
dependency-graph:
  requires:
    - 50-01 (TRIGGER_BOUNTY_LAMPORTS, CARNAGE_SOL_VAULT_SEED)
  provides:
    - VRF bounty payment from carnage_sol_vault PDA
    - invoke_signed system transfer to epoch triggerers
    - Graceful degradation when vault has insufficient balance
  affects:
    - 51 (test rebuild may need to pass carnage_sol_vault instead of treasury)
    - Client code (trigger_epoch_transition now expects carnage_sol_vault account)
tech-stack:
  added: []
  patterns:
    - invoke_signed with PDA signer seeds for SOL transfer from SystemAccount
    - Graceful bounty skip on insufficient vault balance (no error, bounty_paid: 0)
key-files:
  created: []
  modified:
    - programs/epoch-program/src/instructions/trigger_epoch_transition.rs
    - programs/epoch-program/src/lib.rs
decisions:
  - id: "50-02-D1"
    title: "SystemAccount for carnage_sol_vault (not raw AccountInfo)"
    choice: "SystemAccount<'info> with seeds/bump validation"
    alternatives: "UncheckedAccount with manual owner check"
    rationale: "Anchor's SystemAccount validates owner == SystemProgram automatically. Combined with seeds constraint, this provides PDA + owner validation with zero manual code."
metrics:
  duration: "3 min"
  completed: "2026-02-20"
---

# Phase 50 Plan 02: VRF Bounty Payment Implementation Summary

**One-liner:** Replaced Phase 23/25 deferred bounty stub with actual invoke_signed SOL transfer from carnage_sol_vault PDA to epoch triggerers, with graceful degradation on insufficient balance.

## What Was Done

### Task 1: Implement bounty payment from carnage_sol_vault PDA
- **Replaced treasury account** with PDA-validated `carnage_sol_vault: SystemAccount<'info>` using `seeds = [CARNAGE_SOL_VAULT_SEED], bump`
- **Added invoke_signed transfer**: When vault has >= TRIGGER_BOUNTY_LAMPORTS (0.001 SOL), transfers bounty from PDA to payer using signer seeds
- **Graceful degradation**: When vault balance is insufficient, logs a message and sets bounty_paid = 0 (no error thrown)
- **Fixed event emission**: `EpochTransitionTriggered.bounty_paid` now emits actual transfer amount instead of hardcoded 0
- **Removed all stale references**: No more "Phase 25", "Phase 23", "deferred bounty", or "when treasury" in the file
- **Updated unit test comments**: Replaced hardcoded SLOTS_PER_EPOCH = 4500 references with symbolic "SLOTS_PER_EPOCH (750 devnet / 4500 mainnet)" comments
- **Updated docstrings**: Helper function examples now use symbolic SLOTS_PER_EPOCH references
- **Commit:** `907f567`

### Task 2: Update lib.rs docstrings for trigger_epoch_transition
- **Replaced stale account docs**: `payer` now documents "receives 0.001 SOL bounty from Carnage SOL vault"
- **Replaced treasury line**: `carnage_sol_vault` now documented as "Carnage SOL vault PDA (funds bounty via invoke_signed)"
- **Removed Phase 25 references**: No stale deferred/treasury references remain
- **Commit:** `f80afe4`

## Verification Results

| Check | Result |
|-------|--------|
| `invoke_signed` in trigger_epoch_transition.rs | 3 matches (import, doc, usage) |
| `CARNAGE_SOL_VAULT_SEED` in trigger_epoch_transition.rs | 3 matches (import, seeds, signer_seeds) |
| `bounty_paid` variable in event emission | Present (not hardcoded 0) |
| `Phase 25` or `Phase 23` in trigger_epoch_transition.rs | No matches |
| `Phase 25` or `when treasury` in lib.rs | No matches |
| `carnage_sol_vault` in lib.rs docstring | Present |
| epoch-program unit tests | 81/81 passed |

## Deviations from Plan

None -- plan executed exactly as written.

## Decisions Made

1. **SystemAccount for carnage_sol_vault** (50-02-D1): Using `SystemAccount<'info>` instead of raw `AccountInfo` because Anchor automatically validates `owner == SystemProgram`. Combined with seeds constraint, this gives PDA + owner validation with no manual checks needed.

## Client Impact

The `trigger_epoch_transition` instruction now expects a `carnage_sol_vault` account (PDA derived from `seeds = [b"carnage_sol_vault"]`) instead of the old `treasury` account. Client code (crank, continuous runner) will need to update the account passed to this instruction. The PDA is already initialized as part of Carnage Fund setup, so no new deployment steps are needed.

## Next Phase Readiness

- Phase 50 is now complete (all 3 plans done)
- Phase 51 (test rebuild) will need to update trigger_epoch_transition test calls to pass carnage_sol_vault PDA instead of treasury
- Pending todo #5 "VRF bounty payment emits 0" is now RESOLVED -- bounty_paid emits actual transfer amount
