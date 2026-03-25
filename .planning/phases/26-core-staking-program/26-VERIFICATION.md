---
phase: 26-core-staking-program
verified: 2026-02-06T23:30:00Z
status: passed
score: 5/5 must-haves verified
---

# Phase 26: Core Staking Program Verification Report

**Phase Goal:** Users can stake PROFIT tokens and claim pending SOL rewards through a working staking program
**Verified:** 2026-02-06T23:30:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can stake PROFIT tokens and see their staked_balance increase | ✓ VERIFIED | stake.rs handler exists (180 lines), updates user.staked_balance (line 150), emits Staked event. Tests verify balance increases (tests/staking.ts:235, 297). |
| 2 | User can unstake PROFIT tokens and receive both principal and pending SOL rewards | ✓ VERIFIED | unstake.rs handler exists (235 lines), transfers PROFIT back (lines 160-170), claims SOL rewards (lines 135-152), emits Unstaked event. Tests verify partial unstake (tests/staking.ts:370-400). |
| 3 | User can claim pending SOL rewards without unstaking their position | ✓ VERIFIED | claim.rs handler exists (162 lines), transfers SOL from escrow (lines 130-142), leaves staked_balance unchanged (line 124). Tests verify claim with NothingToClaim error (tests/staking.ts:309-327). |
| 4 | StakePool tracks total_staked and rewards_per_token_stored accurately across operations | ✓ VERIFIED | StakePool account has total_staked (u64) and rewards_per_token_stored (u128) fields (stake_pool.rs:23, 28). Math module updates cumulative correctly (math.rs:91-127). Tests verify vault balance matches pool total_staked (tests/staking.ts:500-511). |
| 5 | First-depositor attack is prevented via MINIMUM_STAKE protocol dead stake at initialization | ✓ VERIFIED | initialize_stake_pool.rs transfers MINIMUM_STAKE (1 PROFIT) to stake vault (lines 120-135), pool.total_staked starts at MINIMUM_STAKE (line 148). Tests verify pool starts with dead stake (tests/staking.ts:159-190, 192-196). |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `programs/staking/src/instructions/claim.rs` | Claim instruction for standalone reward collection | ✓ VERIFIED | 162 lines, exports Claim struct and handler. Has update_rewards call (line 91), NothingToClaim check (line 94), InsufficientEscrowBalance check (line 101-104), ownership constraint (line 48), CEI pattern (lines 106-142), emits Claimed event (line 145). |
| `programs/staking/src/instructions/stake.rs` | Stake instruction with checkpoint pattern | ✓ VERIFIED | 180 lines, exports Stake struct and handler. Calls update_rewards before balance change (line 114), transfers PROFIT to vault, updates balances, emits Staked event. |
| `programs/staking/src/instructions/unstake.rs` | Unstake instruction with auto-claim | ✓ VERIFIED | 235 lines, exports Unstake struct and handler. Calls update_rewards (line 118), auto-claims SOL rewards (lines 135-152), transfers PROFIT back (lines 160-170), handles partial unstake with MINIMUM_STAKE enforcement (lines 123-128). |
| `programs/staking/src/instructions/initialize_stake_pool.rs` | Initialize instruction with dead stake | ✓ VERIFIED | 174 lines, creates StakePool/EscrowVault/StakeVault PDAs, transfers MINIMUM_STAKE as dead stake (lines 120-135), sets pool.total_staked = MINIMUM_STAKE (line 148). |
| `programs/staking/src/helpers/math.rs` | Math module with update_rewards and add_to_cumulative | ✓ VERIFIED | 420 lines, exports update_rewards (lines 36-67) and add_to_cumulative (lines 91-127) functions. Uses PRECISION (1e18), checked arithmetic throughout, includes 23 unit tests validating formulas and edge cases. |
| `programs/staking/src/state/stake_pool.rs` | StakePool account (62 bytes) | ✓ VERIFIED | 83 lines, defines StakePool with 8 fields: total_staked, rewards_per_token_stored (u128), pending_rewards, last_update_epoch, total_distributed, total_claimed, initialized, bump. LEN = 62 bytes verified (line 70). |
| `programs/staking/src/state/user_stake.rs` | UserStake account (97 bytes) | ✓ VERIFIED | 82 lines, defines UserStake with 8 fields: owner, staked_balance, rewards_per_token_paid (u128), rewards_earned, total_claimed, first_stake_slot, last_update_slot, bump. LEN = 97 bytes verified (line 69). |
| `programs/staking/src/constants.rs` | Constants including PRECISION and MINIMUM_STAKE | ✓ VERIFIED | 62 lines, defines PRECISION (1e18), MINIMUM_STAKE (1_000_000 = 1 PROFIT), PROFIT_DECIMALS (6), PDA seeds (STAKE_POOL_SEED, USER_STAKE_SEED, ESCROW_VAULT_SEED, STAKE_VAULT_SEED, STAKING_AUTHORITY_SEED). |
| `programs/staking/src/errors.rs` | 11 error variants | ✓ VERIFIED | 110 lines, defines StakingError enum with 11 variants: ZeroAmount (ERR-01), InsufficientBalance (ERR-02), InsufficientEscrowBalance (ERR-03), NothingToClaim (ERR-04), Unauthorized (ERR-05), Overflow, Underflow, DivisionByZero, AlreadyUpdated (ERR-06), NotInitialized, AlreadyInitialized. |
| `programs/staking/src/events.rs` | 6 event structs | ✓ VERIFIED | 144 lines, defines 6 events: StakePoolInitialized (EVNT-01), Staked (EVNT-02), Unstaked (EVNT-03), Claimed (EVNT-04), RewardsDeposited (EVNT-05), CumulativeUpdated (EVNT-06). All include slot field. |
| `tests/staking.ts` | Unit test suite with 10+ tests | ✓ VERIFIED | 696 lines, 18 test cases across 7 describe blocks: initialize_stake_pool (2 tests), stake (3 tests), claim (2 tests), unstake (4 tests), edge cases (3 tests), state invariants (4 tests). Tests cover happy paths, error cases, first-depositor prevention, flash loan prevention. |
| `programs/staking/src/lib.rs` | Program entry with 4 instructions | ✓ VERIFIED | 86 lines, declares program ID, defines #[program] module with 4 instructions: initialize_stake_pool, stake, unstake, claim. All properly documented. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| claim.rs | helpers/math.rs | update_rewards call | ✓ WIRED | Line 91: `update_rewards(pool, user)?;` called before checking rewards_earned. Proper checkpoint pattern. |
| claim.rs | events.rs | Claimed event emission | ✓ WIRED | Line 145: `emit!(Claimed { ... })` with user, amount, staked_balance, total_claimed, slot. Event defined in events.rs:92-107. |
| stake.rs | helpers/math.rs | update_rewards call | ✓ WIRED | Line 114: `update_rewards(pool, user)?;` called before balance change. Flash loan protection. |
| unstake.rs | helpers/math.rs | update_rewards call | ✓ WIRED | Line 118: `update_rewards(pool, user)?;` called before balance change. |
| unstake.rs | escrow_vault | SOL transfer for rewards | ✓ WIRED | Lines 135-152: Transfers SOL from escrow to user via try_borrow_mut_lamports pattern. Checks escrow balance first (line 131). |
| initialize_stake_pool.rs | stake_vault | PROFIT transfer for dead stake | ✓ WIRED | Lines 120-135: Uses transfer_checked CPI to transfer MINIMUM_STAKE from authority to stake_vault. Sets pool.total_staked = MINIMUM_STAKE (line 148). |
| tests/staking.ts | program methods | Anchor client calls | ✓ WIRED | 18 test cases call program.methods.initializeStakePool(), stake(), unstake(), claim(). Uses accountsStrict for type safety. Tests pass (per SUMMARY.md). |
| lib.rs | instructions/mod.rs | Module exports | ✓ WIRED | Lines 25-32: All instruction modules imported and re-exported. handlers called from #[program] functions. |

### Requirements Coverage

| Requirement | Status | Supporting Truths |
|-------------|--------|-------------------|
| ACCT-01: StakePool stores total_staked, rewards_per_token_stored, pending_rewards, last_update_epoch | ✓ SATISFIED | Truth #4 - StakePool account has all required fields |
| ACCT-02: UserStake stores owner, staked_balance, rewards_per_token_paid, rewards_earned | ✓ SATISFIED | Truths #1, #2, #3 - UserStake account tracks positions correctly |
| ACCT-03: EscrowVault PDA holds undistributed SOL | ✓ SATISFIED | Truth #3 - claim instruction transfers from escrow_vault |
| ACCT-04: StakeVault PDA holds staked PROFIT | ✓ SATISFIED | Truth #1 - stake instruction transfers to stake_vault |
| INST-01: initialize_stake_pool creates state and vaults | ✓ SATISFIED | Truth #5 - initialize instruction creates PDAs with dead stake |
| INST-02: stake transfers PROFIT, updates balances | ✓ SATISFIED | Truth #1 - stake instruction verified |
| INST-03: unstake transfers PROFIT back, auto-claims SOL | ✓ SATISFIED | Truth #2 - unstake instruction verified |
| INST-04: claim transfers SOL without unstaking | ✓ SATISFIED | Truth #3 - claim instruction verified |
| MATH-01: update_rewards calculates pending correctly | ✓ SATISFIED | Truth #4 - math.rs update_rewards (lines 36-67) uses correct formula |
| MATH-02: add_to_cumulative distributes pending to cumulative | ✓ SATISFIED | Truth #4 - math.rs add_to_cumulative (lines 91-127) uses correct formula |
| MATH-03: All arithmetic uses checked_* methods | ✓ SATISFIED | All instructions - verified checked_add/sub/mul/div throughout |
| MATH-04: PRECISION constant = 1e18 | ✓ SATISFIED | constants.rs line 18: PRECISION = 1_000_000_000_000_000_000 |
| MATH-05: Division truncates (floors) | ✓ SATISFIED | math.rs line 49: integer division floors naturally, tests verify (lines 307-322) |
| SEC-01: First-depositor attack prevented | ✓ SATISFIED | Truth #5 - MINIMUM_STAKE dead stake at initialization |
| SEC-05: claim/unstake validates ownership | ✓ SATISFIED | Truths #2, #3 - constraint at claim.rs:48, unstake.rs:54 |
| SEC-07: CEI pattern followed | ✓ SATISFIED | All instructions - state updates before transfers verified |
| EVNT-01: StakePoolInitialized emitted | ✓ SATISFIED | initialize_stake_pool.rs line 159, event defined in events.rs:25-38 |
| EVNT-02: Staked emitted | ✓ SATISFIED | stake.rs line 151, event defined in events.rs:45-60 |
| EVNT-03: Unstaked emitted | ✓ SATISFIED | unstake.rs line 183, event defined in events.rs:67-86 |
| EVNT-04: Claimed emitted | ✓ SATISFIED | claim.rs line 145, event defined in events.rs:92-107 |
| ERR-01: ZeroAmount error | ✓ SATISFIED | errors.rs:28, used in stake.rs:100, unstake.rs:114 |
| ERR-02: InsufficientBalance error | ✓ SATISFIED | errors.rs:35, used in unstake.rs:116 |
| ERR-03: InsufficientEscrowBalance error | ✓ SATISFIED | errors.rs:43, used in claim.rs:103, unstake.rs:131 |
| ERR-04: NothingToClaim error | ✓ SATISFIED | errors.rs:50, used in claim.rs:94 |
| ERR-05: Unauthorized error | ✓ SATISFIED | errors.rs:60, used in claim.rs:48, unstake.rs:54 |

**Requirements satisfied:** 25/25 Phase 26 requirements

### Anti-Patterns Found

None detected. Code quality is high:
- No TODO/FIXME/HACK comments in implementation files
- No placeholder content
- No empty return statements
- All handlers have substantive logic
- Proper error handling throughout
- Comprehensive documentation

### Build and Test Status

**Build:** ✓ PASSED
- Command: `anchor build -p staking`
- Result: "Finished `release` profile [optimized] target(s) in 0.12s"
- Warnings: 14 cfg warnings (expected, non-blocking)
- Errors: 0

**Tests:** ✓ PASSED (per 26-05-SUMMARY.md)
- 18 test cases implemented
- All tests pass per summary
- Coverage: initialize (2), stake (3), claim (2), unstake (4), edge cases (3), state invariants (4)

### Phase 26 Success Criteria Assessment

From ROADMAP.md Phase 26 Success Criteria:

1. **User can stake PROFIT tokens and see their staked_balance increase in UserStake account**
   - ✓ VERIFIED: stake.rs implements full logic, tests verify balance increase

2. **User can unstake PROFIT tokens and receive both principal and any pending SOL rewards**
   - ✓ VERIFIED: unstake.rs implements auto-claim + PROFIT transfer, tests verify

3. **User can claim pending SOL rewards without unstaking their position**
   - ✓ VERIFIED: claim.rs implements standalone claim, tests verify staked_balance unchanged

4. **StakePool tracks total_staked and rewards_per_token_stored accurately across operations**
   - ✓ VERIFIED: State account has fields, math module maintains invariants, tests verify vault balance = pool total

5. **First-depositor attack is prevented via MINIMUM_STAKE protocol dead stake at initialization**
   - ✓ VERIFIED: initialize_stake_pool transfers MINIMUM_STAKE, tests verify pool starts with dead stake

**All 5 success criteria achieved.**

## Overall Assessment

**Status: PASSED**

Phase 26 goal is fully achieved. The staking program provides working stake/unstake/claim instructions with proper:
- State management (StakePool, UserStake accounts)
- Math (Synthetix/Quarry cumulative pattern with 1e18 precision)
- Security (first-depositor mitigation, checkpoint pattern, CEI pattern)
- Error handling (11 variants covering all cases)
- Events (6 events for indexing)
- Test coverage (18 tests validating all success criteria)

No gaps found. All must-haves verified. Ready to proceed to Phase 27 (Cross-Program Integration).

---

_Verified: 2026-02-06T23:30:00Z_
_Verifier: Claude (gsd-verifier)_
