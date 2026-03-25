---
phase: 50-program-maintenance
plan: 04
subsystem: amm
tags: [admin, burn, security, irreversible, access-control]

dependency-graph:
  requires: []
  provides:
    - burn_admin instruction in AMM program
    - AdminBurned event
    - Permanent admin revocation capability
  affects:
    - Mainnet deployment (burn_admin called after all pools created)
    - Future admin tooling / scripts

tech-stack:
  added: []
  patterns:
    - "Pubkey::default() as irrecoverable sentinel for burned admin key"
    - "has_one constraint as dual-purpose auth (normal admin check + permanent lockout after burn)"

file-tracking:
  key-files:
    created:
      - programs/amm/src/instructions/burn_admin.rs
    modified:
      - programs/amm/src/events.rs
      - programs/amm/src/instructions/mod.rs
      - programs/amm/src/lib.rs

decisions:
  - id: "50-04-D1"
    decision: "Use Pubkey::default() (all-zeros) as burned admin sentinel"
    rationale: "No private key exists for Pubkey::default(), so no one can sign as admin after burn. The has_one = admin constraint on initialize_pool will permanently fail."

metrics:
  duration: "3 min"
  completed: "2026-02-20"
---

# Phase 50 Plan 04: Burn Admin Instruction Summary

**One-liner:** Irreversible burn_admin instruction that sets AMM admin to Pubkey::default(), permanently blocking pool creation via has_one constraint.

## What Was Done

### Task 1: Add AdminBurned event and create burn_admin instruction

**Commit:** `71045de`

Four files created/modified:

1. **programs/amm/src/events.rs** -- Added `AdminBurned` event with `burned_by: Pubkey` and `slot: u64` fields, following existing event pattern (PoolInitializedEvent, SwapEvent).

2. **programs/amm/src/instructions/burn_admin.rs** -- New instruction file:
   - `BurnAdmin` accounts struct with `Signer` admin and `Account<AdminConfig>` PDA
   - `has_one = admin @ AmmError::Unauthorized` constraint ensures only current admin can burn
   - Seeds/bump validation on AdminConfig PDA
   - Handler captures `burned_by` before overwrite, sets `admin_config.admin = Pubkey::default()`
   - Emits `AdminBurned` event with burned_by pubkey and clock slot
   - Program log message for on-chain explorer visibility

3. **programs/amm/src/instructions/mod.rs** -- Added `pub mod burn_admin` and `pub use burn_admin::*`, placed alphabetically before `initialize_admin`.

4. **programs/amm/src/lib.rs** -- Added `burn_admin` endpoint between `initialize_admin` and `initialize_pool`, with doc comments explaining irreversibility.

## Security Analysis

**Why this works:** After `burn_admin` executes, `admin_config.admin` is `Pubkey::default()` (all-zeros). The `initialize_pool` instruction has `has_one = admin` which requires the signer to match this stored admin. Since no private key exists for `Pubkey::default()`, no signer can ever pass this check again. Pool creation is permanently disabled.

**Attack surface reduction:** Before burn, a compromised admin key could create malicious pools (e.g., fake token pairs). After burn, this attack vector is eliminated entirely.

**Idempotency note:** Calling `burn_admin` after admin is already burned will fail with `Unauthorized` because the signer cannot match `Pubkey::default()`. This is correct behavior -- no special handling needed.

## Deviations from Plan

None -- plan executed exactly as written.

## Decisions Made

| ID | Decision | Rationale |
|----|----------|-----------|
| 50-04-D1 | Pubkey::default() as burned admin sentinel | No private key for all-zeros pubkey; has_one constraint permanently fails |

## Verification Results

- `burn_admin` endpoint registered in lib.rs (line 33-34)
- `AdminBurned` event defined in events.rs (line 70)
- `Pubkey::default()` used in burn_admin.rs (line 22)
- `has_one = admin @ AmmError::Unauthorized` in burn_admin.rs (line 47)
- AMM program compiles successfully
- Pre-existing test failures (12 swap_authority tests) unrelated to this change, tracked for Phase 51

## Next Phase Readiness

No blockers. This is the final plan in Phase 50. Phase 51 (Test Rebuild) can proceed.

## Commits

| Hash | Message |
|------|---------|
| `71045de` | feat(50-04): add burn_admin instruction to AMM program |
