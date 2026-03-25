---
phase: 50-program-maintenance
plan: 01
subsystem: on-chain-programs
tags: [feature-gates, constants, devnet, mainnet, build-script]
dependency-graph:
  requires: []
  provides:
    - feature-gated SLOTS_PER_EPOCH (epoch-program)
    - feature-gated treasury_pubkey (tax-program)
    - corrected TRIGGER_BOUNTY_LAMPORTS (1_000_000)
    - corrected Carnage byte comments (byte 5/6)
    - devnet feature flag for tax-program
    - build.sh rebuilds both programs with --devnet
  affects:
    - 50-02 (bounty implementation uses corrected TRIGGER_BOUNTY_LAMPORTS)
    - 51 (test rebuild will use feature-gated constants)
tech-stack:
  added: []
  patterns:
    - cfg(feature = "devnet") for environment-specific constants
key-files:
  created: []
  modified:
    - programs/epoch-program/src/constants.rs
    - programs/tax-program/src/constants.rs
    - programs/tax-program/Cargo.toml
    - scripts/deploy/build.sh
decisions:
  - id: "50-01-D1"
    title: "Use Pubkey::default() as mainnet treasury placeholder"
    choice: "Pubkey::default() (all zeros) makes it obvious if accidentally deployed"
    alternatives: "panic!() on mainnet build, hardcoded real address"
    rationale: "All-zeros address is clearly wrong but doesn't break compilation. Mainnet checklist already tracks this."
metrics:
  duration: "3 min"
  completed: "2026-02-20"
---

# Phase 50 Plan 01: Feature-Gate Constants & Fix Bounty Summary

**One-liner:** Feature-gated SLOTS_PER_EPOCH and treasury_pubkey() across both programs, fixed bounty to 0.001 SOL, corrected Carnage byte comments, updated build.sh for dual-program devnet rebuild.

## What Was Done

### Task 1: Feature-gate SLOTS_PER_EPOCH and fix epoch-program constants
- **Feature-gated SLOTS_PER_EPOCH**: 750 slots (devnet, ~5 min) / 4500 slots (mainnet, ~30 min), following existing Switchboard PID pattern
- **Fixed TRIGGER_BOUNTY_LAMPORTS**: Changed from 10_000_000 (0.01 SOL) to 1_000_000 (0.001 SOL) -- ~66x actual 3-TX base cost, generous but treasury-efficient
- **Fixed Carnage byte comments**: Updated stale references from "byte 3" / "byte 4" to "byte 5" / "byte 6" matching actual VRF randomness byte indexing
- **Added unit tests**: test_slots_per_epoch_value (validates compiled value is 750 or 4500) and test_trigger_bounty_lamports (asserts 1_000_000)
- **Commit:** `5800e35`

### Task 2: Feature-gate treasury_pubkey, add devnet feature to Tax Cargo.toml, update build.sh
- **Added devnet feature flag** to tax-program Cargo.toml: `devnet = []`
- **Feature-gated treasury_pubkey()**: devnet returns `8kPzh...` (test wallet), mainnet returns `Pubkey::default()` (placeholder with clear MAINNET PLACEHOLDER comment)
- **Updated build.sh**: devnet rebuild section now runs `anchor build -p tax_program -- --features devnet` alongside epoch_program. Two separate calls needed because Anchor's `-p` flag accepts one program.
- **Updated test**: Renamed to `test_treasury_pubkey_is_valid`, made feature-aware (tests either devnet or mainnet path doesn't panic)
- **Commit:** `1436f26`

## Verification Results

| Check | Result |
|-------|--------|
| `cfg.*devnet` in epoch-program constants.rs | 4 matches (SWITCHBOARD_PROGRAM_ID + SLOTS_PER_EPOCH) |
| `cfg.*devnet` in tax-program constants.rs | 2 matches (treasury_pubkey) |
| `devnet = []` in tax-program Cargo.toml | Present |
| `tax_program` in build.sh devnet section | Present |
| `byte 3` in epoch-program constants.rs | No matches (fixed) |
| `10_000_000` in epoch-program constants.rs | No matches (fixed) |
| epoch-program unit tests | 81/81 passed |
| tax-program unit tests | 44/44 passed |

## Deviations from Plan

None -- plan executed exactly as written.

## Decisions Made

1. **Pubkey::default() as mainnet treasury placeholder** (50-01-D1): Using all-zeros address makes it obvious if accidentally deployed without setting the real treasury. The mainnet checklist (Docs/mainnet-checklist.md) already tracks this as a pre-launch requirement.

## Next Phase Readiness

- Plan 50-02 (bounty implementation) can proceed -- TRIGGER_BOUNTY_LAMPORTS is now correctly set to 1_000_000
- Phase 51 (test rebuild) will benefit from feature-gated constants -- tests will compile with correct environment-specific values
- Treasury pubkey is tracked in mainnet checklist -- no risk of forgotten placeholder
