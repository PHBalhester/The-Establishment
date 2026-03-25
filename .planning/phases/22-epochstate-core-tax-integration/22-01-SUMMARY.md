---
phase: 22
plan: 01
type: summary
completed: 2026-02-06
duration: 3m 51s
subsystem: epoch
tags: [epoch-program, epochstate, initialization, anchor, pda]

dependency-graph:
  requires: [v0.4-tax-program]
  provides: [epoch-program-scaffold, epochstate-account, initialize-instruction]
  affects: [22-02-trigger-epoch, 23-vrf-integration, tax-program-integration]

tech-stack:
  added: []
  patterns: [anchor-pda-singleton, compile-time-size-assertion]

key-files:
  created:
    - programs/epoch-program/Cargo.toml
    - programs/epoch-program/src/lib.rs
    - programs/epoch-program/src/state/mod.rs
    - programs/epoch-program/src/state/epoch_state.rs
    - programs/epoch-program/src/state/enums.rs
    - programs/epoch-program/src/constants.rs
    - programs/epoch-program/src/errors.rs
    - programs/epoch-program/src/events.rs
    - programs/epoch-program/src/instructions/mod.rs
    - programs/epoch-program/src/instructions/initialize_epoch_state.rs
    - keypairs/epoch-program.json
  modified:
    - Anchor.toml

decisions:
  - id: DISC-22-01-01
    context: "Spec Section 4.1 says 93 data bytes but actual field sum is 92 bytes"
    decision: "Use correct 92-byte calculation (100 bytes with discriminator)"
    rationale: "Spec has arithmetic error; verified by listing all fields"
    outcome: pending

commits:
  - hash: 8afe7d8
    message: "feat(22-01): create epoch-program scaffold with EpochState"
  - hash: f755bdd
    message: "feat(22-01): add initialize_epoch_state instruction"

metrics:
  tasks: 2
  commits: 2
  files-created: 11
  files-modified: 1
  lines-added: ~580
---

# Phase 22 Plan 01: Epoch Program Scaffold Summary

**One-liner:** Epoch Program scaffold with EpochState singleton account and genesis initialization instruction.

## What Was Built

### EpochState Account (100 bytes total)
The global coordination hub for all protocol dynamics:

1. **Timing Fields** (20 bytes)
   - `genesis_slot`: Slot when protocol launched
   - `current_epoch`: Current epoch number (0-indexed)
   - `epoch_start_slot`: When current epoch started

2. **Tax Configuration** (7 bytes)
   - `cheap_side`: 0 = CRIME, 1 = FRAUD
   - `low_tax_bps`: 100-400 (1-4%)
   - `high_tax_bps`: 1100-1400 (11-14%)

3. **Derived Tax Rates** (8 bytes)
   - `crime_buy_tax_bps`, `crime_sell_tax_bps`
   - `fraud_buy_tax_bps`, `fraud_sell_tax_bps`
   - Cached for O(1) lookup during swaps

4. **VRF State** (42 bytes)
   - `vrf_request_slot`: When randomness was committed
   - `vrf_pending`: Waiting for consume_randomness
   - `taxes_confirmed`: False until randomness consumed
   - `pending_randomness_account`: Anti-reroll binding

5. **Carnage State** (15 bytes)
   - `carnage_pending`, `carnage_target`, `carnage_action`
   - `carnage_deadline_slot`, `last_carnage_epoch`

6. **Protocol** (2 bytes)
   - `initialized`, `bump`

### initialize_epoch_state Instruction
Genesis initialization per Epoch_State_Machine_Spec.md Section 8.1:

- Captures `genesis_slot` from Clock sysvar
- Sets CRIME as cheap side (`cheap_side = 0`)
- Genesis rates: 300 bps low, 1400 bps high
- Derived rates:
  - crime_buy=300, crime_sell=1400
  - fraud_buy=1400, fraud_sell=300
- VRF state: no pending, taxes_confirmed=true
- Carnage state: no pending
- Emits `EpochStateInitialized` event

### Supporting Infrastructure
- **Constants**: SLOTS_PER_EPOCH, VRF_TIMEOUT_SLOTS, CARNAGE_DEADLINE_SLOTS, TRIGGER_BOUNTY_LAMPORTS, EPOCH_STATE_SEED
- **Errors**: 18 error codes per spec Section 11
- **Enums**: Token (CRIME/FRAUD), CarnageAction (None/Burn/Sell) - stored as u8
- **Events**: EpochStateInitialized

## Key Implementation Details

### PDA Derivation
```rust
seeds = [EPOCH_STATE_SEED]  // b"epoch_state"
program = epoch_program
```
Single global account, no additional seeds needed.

### Size Assertion
```rust
// Compile-time verification
const _: () = assert!(EpochState::DATA_LEN == 92);
```

### Program ID
```
AH7yaWFUrWmXGDKEwr8w2EMEiH6PxaxE2vT9orjRzvod
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Spec size calculation error**
- **Found during:** Task 1 compilation
- **Issue:** Spec Section 4.1 says "93 bytes" but actual field sum is 92 bytes
- **Analysis:** Spec formula starts with `1 + 8 + 4...` but there's no 1-byte field before genesis_slot
- **Fix:** Used correct 92-byte calculation
- **Files modified:** epoch_state.rs
- **Commit:** 8afe7d8

## Verification Results

All success criteria met:
- [x] epoch-program exists in programs/ directory
- [x] Cargo build succeeds for epoch-program
- [x] EpochState struct has all fields from spec Section 4.1
- [x] EpochState::LEN = 100 bytes (8 discriminator + 92 data)
- [x] initialize_epoch_state instruction creates genesis state
- [x] Genesis: cheap_side=0 (CRIME), low_tax_bps=300, high_tax_bps=1400
- [x] Genesis: crime_buy=300, crime_sell=1400, fraud_buy=1400, fraud_sell=300
- [x] EpochStateInitialized event defined and emitted
- [x] Anchor.toml includes epoch-program with program ID

## Next Phase Readiness

### Ready for Plan 22-02 (trigger_epoch_transition + carnage_signer PDA)
- EpochState account structure complete
- Constants defined for timing/bounty
- Error codes for VRF operations defined
- Carnage signer seed constant added

### Dependencies Satisfied
- Tax Program's `epoch_program_id()` placeholder can be updated with actual ID
- Tax Program's `CARNAGE_SIGNER_SEED` matches Epoch Program's `CARNAGE_SIGNER_SEED`

### Open Items
- Update Tax Program's `constants.rs` with actual Epoch Program ID (Phase 23)
