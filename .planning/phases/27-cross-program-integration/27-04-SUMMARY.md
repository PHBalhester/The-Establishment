---
phase: 27-cross-program-integration
plan: 04
subsystem: staking
tags: [cpi, epoch-program, staking, update_cumulative, discriminator]

# Dependency graph
requires:
  - phase: 27-02
    provides: update_cumulative instruction in Staking Program with seeds::program gating
provides:
  - Verified consume_randomness CPI to real Staking Program update_cumulative
  - Verified UPDATE_CUMULATIVE_DISCRIMINATOR correctness via test
  - Verified Anchor.toml includes staking program for testing
affects: [27-05, integration-testing, devnet-deployment]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - invoke_signed with PDA seeds for cross-program CPI
    - seeds::program constraint for CPI authority validation
    - Anchor discriminator = sha256("global:instruction_name")[0..8]

key-files:
  created: []
  modified: []

key-decisions:
  - "Verification-only plan - existing CPI infrastructure already correct"
  - "STAKING_AUTHORITY_SEED matches between Epoch and Staking programs (b'staking_authority')"
  - "UPDATE_CUMULATIVE_DISCRIMINATOR = [0x93, 0x84, 0xdb, 0x65, 0xa5, 0x17, 0x3d, 0x71]"

patterns-established:
  - "Epoch->Staking CPI: consume_randomness calls update_cumulative with staking_authority PDA"
  - "Verification plans validate cross-program integration without code changes"

# Metrics
duration: 8min
completed: 2026-02-07
---

# Phase 27 Plan 04: Epoch CPI to Staking Summary

**Verified Epoch Program's consume_randomness correctly CPIs to real Staking Program's update_cumulative instruction**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-07T08:35:46Z
- **Completed:** 2026-02-07T08:43:50Z
- **Tasks:** 3 (all verification-only)
- **Files modified:** 0

## Accomplishments

- Verified consume_randomness CPI infrastructure is correctly implemented
- Confirmed UPDATE_CUMULATIVE_DISCRIMINATOR matches sha256("global:update_cumulative")[0..8]
- Verified Anchor.toml has staking = "StakFwVR1u8TuDtfv9tjLTpQbBH3rPLqe5UHJJPkEXF" in [programs.localnet]
- All 59 Epoch Program tests pass
- anchor build succeeds for entire workspace

## Task Commits

This was a verification-only plan. No code changes were required - the existing infrastructure was already correct.

1. **Task 1: Verify CPI infrastructure in consume_randomness** - No commit (verification passed)
   - consume_randomness.rs lines 199-231 correctly implement invoke_signed
   - staking_authority PDA seeds match STAKING_AUTHORITY_SEED
   - Instruction data: 8-byte discriminator + 4-byte epoch (u32)

2. **Task 2: Verify UPDATE_CUMULATIVE_DISCRIMINATOR matches** - No commit (test passes)
   - test_update_cumulative_discriminator confirms discriminator correctness
   - Both Epoch Program and Staking Program use sha256("global:update_cumulative")[0..8]

3. **Task 3: Update Anchor.toml for real Staking Program testing** - No commit (already correct)
   - staking = "StakFwVR1u8TuDtfv9tjLTpQbBH3rPLqe5UHJJPkEXF" already in [programs.localnet]
   - Matches Staking Program's declare_id!

## Files Created/Modified

None - this was a verification-only plan.

## Key Verification Results

**CPI Structure (consume_randomness.rs lines 199-231):**
```rust
// staking_authority PDA seeds
let staking_authority_seeds: &[&[u8]] = &[
    STAKING_AUTHORITY_SEED,  // b"staking_authority"
    &[staking_authority_bump],
];

// Instruction data: discriminator (8) + epoch (4)
let mut ix_data = Vec::with_capacity(12);
ix_data.extend_from_slice(&UPDATE_CUMULATIVE_DISCRIMINATOR);
ix_data.extend_from_slice(&epoch_state.current_epoch.to_le_bytes());

// Account metas match Staking's UpdateCumulative struct
let update_cumulative_ix = Instruction {
    program_id: ctx.accounts.staking_program.key(),
    accounts: vec![
        AccountMeta::new_readonly(ctx.accounts.staking_authority.key(), true),
        AccountMeta::new(ctx.accounts.stake_pool.key(), false),
    ],
    data: ix_data,
};
```

**Discriminator Test:**
```
test constants::tests::test_update_cumulative_discriminator ... ok
```

**Cross-Program Seed Alignment:**
- Epoch Program: `STAKING_AUTHORITY_SEED = b"staking_authority"` (constants.rs line 58)
- Staking Program: `STAKING_AUTHORITY_SEED = b"staking_authority"` (constants.rs line 64)

## Decisions Made

- None - followed plan as specified. Existing implementation was already correct.

## Deviations from Plan

None - plan executed exactly as written. All verification tasks passed without requiring code changes.

## Issues Encountered

None - all verifications passed on first attempt.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Ready for next steps:**
- Epoch Program can successfully CPI to Staking Program's update_cumulative
- 27-05 (Integration Tests) can proceed with full cross-program testing
- Tax Program CPI (27-03) is independent and can be completed in parallel

**Cross-program integration verified:**
- Epoch -> Staking: update_cumulative CPI ready
- Tax -> Staking: deposit_rewards CPI (27-03) pending
- Both CPIs use seeds::program constraint for authority validation

---
*Phase: 27-cross-program-integration*
*Completed: 2026-02-07*
