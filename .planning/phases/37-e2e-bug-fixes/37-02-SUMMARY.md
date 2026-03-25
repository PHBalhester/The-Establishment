---
phase: 37-e2e-bug-fixes
plan: 02
subsystem: security, epoch, amm, staking, tax
tags: [vrf, carnage, tax-derivation, lp-fee, deposit-rewards, event-emission, independent-rolls]

# Dependency graph
requires:
  - phase: 37-01
    provides: P0 security constraints on all vulnerable accounts + program ID constants
provides:
  - Functional fallback Carnage path (correct discriminator + swap_authority)
  - LP fee cap at 500 bps
  - deposit_rewards balance reconciliation
  - ExemptSwap event for off-chain monitoring
  - Independent CRIME/FRAUD tax rolls via 4 VRF bytes
  - Carnage bytes shifted to 5-7, MIN_VRF_BYTES=8
affects: [37-03, devnet-deployment, e2e-testing]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Independent VRF magnitude rolls per token (4 bytes instead of 2)"
    - "Balance reconciliation pattern for CPI counter updates"
    - "Legacy field zeroing for backward-compatible struct evolution"

key-files:
  created: []
  modified:
    - "programs/epoch-program/src/instructions/execute_carnage.rs"
    - "programs/epoch-program/src/helpers/tax_derivation.rs"
    - "programs/epoch-program/src/helpers/carnage.rs"
    - "programs/epoch-program/src/instructions/consume_randomness.rs"
    - "programs/amm/src/constants.rs"
    - "programs/amm/src/instructions/initialize_pool.rs"
    - "programs/amm/src/errors.rs"
    - "programs/staking/src/instructions/deposit_rewards.rs"
    - "programs/tax-program/src/instructions/swap_exempt.rs"
    - "programs/tax-program/src/events.rs"

key-decisions:
  - "Legacy low_tax_bps/high_tax_bps set to 0 (rates now independent per token)"
  - "InsufficientEscrowBalance error variant already existed (reused ERR-03)"
  - "8 pre-existing trigger_epoch_transition test failures are from Phase 36 slot timing changes, not related to this plan"

patterns-established:
  - "VRF byte allocation: 0=flip, 1-4=tax magnitudes, 5-7=Carnage"
  - "Balance reconciliation after CPI counter updates"

# Metrics
duration: 9min
completed: 2026-02-13
---

# Phase 37 Plan 02: P1/P2 Fixes + Independent Tax Rolls Summary

**Fallback Carnage fixed (discriminator + swap_authority), LP fee capped at 500 bps, deposit_rewards reconciles escrow balance, swap_exempt emits ExemptSwap, tax rolls independent via 4 VRF bytes with Carnage shifted to bytes 5-7**

## Performance

- **Duration:** 9 min
- **Started:** 2026-02-13T21:45:04Z
- **Completed:** 2026-02-13T21:54:37Z
- **Tasks:** 3/3
- **Files modified:** 10

## Accomplishments

- Fixed fallback Carnage path: correct swap_exempt discriminator + missing swap_authority account in struct and CPI metas
- Added LP fee cap (MAX_LP_FEE_BPS = 500) with LpFeeExceedsMax validation in initialize_pool
- Added escrow_vault balance reconciliation to deposit_rewards (verifies lamports >= pending_rewards)
- Added ExemptSwap event to Tax Program for off-chain monitoring of Carnage swaps
- Rewrote derive_taxes to use 4 independent VRF bytes (CRIME low/high + FRAUD low/high)
- Shifted Carnage bytes from [3/4/5] to [5/6/7], updated MIN_VRF_BYTES from 6 to 8
- Updated 29 unit tests across tax_derivation, carnage, and consume_randomness -- all passing

## Task Commits

Each task was committed atomically:

1. **Task 1: P1 fixes -- fallback Carnage + LP fee cap** - `43fab5a` (fix)
2. **Task 2: P2 hardening -- deposit_rewards reconciliation + swap_exempt event** - `5740f62` (feat)
3. **Task 3: Independent tax rolls + carnage byte shift + unit test updates** - `c804d02` (feat)

## Files Created/Modified

- `programs/epoch-program/src/instructions/execute_carnage.rs` - Added swap_authority account, fixed discriminator, fixed CPI metas
- `programs/amm/src/constants.rs` - Added MAX_LP_FEE_BPS constant (500)
- `programs/amm/src/instructions/initialize_pool.rs` - Added lp_fee_bps <= MAX_LP_FEE_BPS validation
- `programs/amm/src/errors.rs` - Added LpFeeExceedsMax error variant
- `programs/staking/src/instructions/deposit_rewards.rs` - Added escrow_vault account + balance reconciliation check
- `programs/tax-program/src/instructions/swap_exempt.rs` - Added ExemptSwap event emission after CPI
- `programs/tax-program/src/events.rs` - Added ExemptSwap event struct
- `programs/epoch-program/src/helpers/tax_derivation.rs` - Rewrote derive_taxes for 4 independent VRF bytes + updated tests
- `programs/epoch-program/src/helpers/carnage.rs` - Shifted byte indices 3->5, 4->6, 5->7 + updated tests
- `programs/epoch-program/src/instructions/consume_randomness.rs` - MIN_VRF_BYTES=8, updated log messages + tests

## Decisions Made

- **Legacy fields zeroed:** TaxConfig.low_tax_bps and high_tax_bps set to 0 since rates are now independent per token. EpochState still stores them for backward compatibility but they carry no semantic meaning.
- **Reused existing error:** InsufficientEscrowBalance (ERR-03) already existed in staking errors, no new variant needed.
- **Pre-existing test failures noted:** 8 tests in trigger_epoch_transition fail due to Phase 36 slot timing constants change -- not related to this plan's changes.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All 5 programs build cleanly
- 29 relevant unit tests pass (tax_derivation: 9, carnage: 10, consume_randomness: 8, execute_carnage: 1, execute_carnage_atomic: 1)
- Ready for 37-03 (E2E fixes + validation)
- Pre-existing trigger_epoch_transition test failures (8 tests, Phase 36 slot timing) should be addressed in 37-03 or a follow-up

---
*Phase: 37-e2e-bug-fixes*
*Completed: 2026-02-13*
