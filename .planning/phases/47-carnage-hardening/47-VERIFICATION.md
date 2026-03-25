---
phase: 47-carnage-hardening
verified: 2026-02-19T21:18:22Z
status: passed
score: 4/4 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: 3/4
  gaps_closed:
    - "consume_randomness and executeCarnageAtomic bundled in same transaction"
  gaps_remaining: []
  regressions: []
---

# Phase 47: Carnage Hardening Re-Verification Report

**Phase Goal:** Carnage Fund execution is resilient, slippage-protected, and MEV-resistant -- the fallback path works, swaps have minimum output enforcement, and VRF+Carnage cannot be split across transactions

**Verified:** 2026-02-19T21:18:22Z
**Status:** passed
**Re-verification:** Yes — after gap closure via plan 47-04

## Re-Verification Summary

**Previous verification (2026-02-19T23:30:00Z):** Found 1 gap blocking goal achievement:
- consume_randomness and executeCarnageAtomic were in TWO sequential transactions (Option C)
- CarnagePending event emitted to network between TX3 and TX4
- Violated ROADMAP success criterion #3

**Gap closure plan 47-04 implemented:**
1. Removed `carnage_pending` constraint from ExecuteCarnageAtomic struct
2. Added no-op guard in handler: returns Ok(()) when carnage_pending is false
3. Bundled reveal + consume + executeCarnageAtomic in ONE v0 VersionedTransaction
4. Removed TX4 conditional section entirely
5. Post-TX3 Carnage detection via state inspection (lastCarnageEpoch == currentEpoch)

**Result:** Gap fully closed. All 4 success criteria now verified.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Fallback Carnage path successfully executes with correct discriminator and swap_authority | ✓ VERIFIED | execute_carnage.rs has discriminator [0xf4, 0x5f, 0x5a, 0x24, 0x99, 0xa0, 0x37, 0x0c] matching atomic path (line 767), swap_authority present in ExecuteCarnage struct (line 174) |
| 2 | Carnage swap with output < slippage floor is rejected | ✓ VERIFIED | execute_carnage_atomic.rs: 85% floor (lines 414-422), execute_carnage.rs: 75% floor (lines 437-445), both use u128 BPS arithmetic and CarnageSlippageExceeded error |
| 3 | consume_randomness and executeCarnageAtomic bundled in same transaction | ✓ VERIFIED | vrf-flow.ts lines 287-304: builds v0 TX with reveal + consume + executeCarnageAtomic (600k CU). No TX4 section. No-op guard at execute_carnage_atomic.rs:215-217 enables safe bundling |
| 4 | Old MINIMUM_OUTPUT=0 behavior is gone, reasonable floor enforced | ✓ VERIFIED | Constants.rs has CARNAGE_SLIPPAGE_BPS_ATOMIC=8500, CARNAGE_SLIPPAGE_BPS_FALLBACK=7500. Unit tests verify enforcement (execute_carnage_atomic.rs lines 944-999) |

**Score:** 4/4 truths verified (was 3/4 before gap closure)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `programs/epoch-program/src/constants.rs` | CARNAGE_SLIPPAGE_BPS_ATOMIC/FALLBACK, CARNAGE_LOCK_SLOTS | ✓ VERIFIED | Lines 123 (8500), 128 (7500), 134 (50). CARNAGE_DEADLINE_SLOTS updated to 300 (line 71) |
| `programs/epoch-program/src/errors.rs` | CarnageLockActive error variant | ✓ VERIFIED | Line 74-75. CarnageSlippageExceeded message updated to "below minimum output floor" (line 130) |
| `programs/epoch-program/src/events.rs` | CarnageFailed event struct (7 fields) | ✓ VERIFIED | Lines 160-175: epoch, action, target, attempted_amount, vault_balance, slot, atomic |
| `programs/epoch-program/src/state/epoch_state.rs` | carnage_lock_slot field, LEN=108 | ✓ VERIFIED | Line 136 (field), line 157 (LEN=108), line 171 (DATA_LEN=100), static assertion passes |
| `programs/tax-program/src/state/epoch_state_reader.rs` | carnage_lock_slot field, LEN=108 | ✓ VERIFIED | Line 44 (field), line 57 (LEN=108). Layout mirrors Epoch Program exactly |
| `programs/epoch-program/src/instructions/execute_carnage_atomic.rs` | No-op guard when carnage_pending=false | ✓ VERIFIED | Lines 215-217: early return Ok(()) when !carnage_pending. No constraint in struct (removed). 85% slippage floor (lines 407-422) |
| `programs/epoch-program/src/instructions/consume_randomness.rs` | Sets carnage_lock_slot on trigger | ✓ VERIFIED | Lines 284-287: carnage_lock_slot = clock.slot + CARNAGE_LOCK_SLOTS |
| `programs/epoch-program/src/instructions/execute_carnage.rs` | Lock window check, 75% slippage floor | ✓ VERIFIED | Lines 223-226: lock window gate (clock.slot > carnage_lock_slot), lines 430-445: 75% slippage floor |
| `programs/epoch-program/src/instructions/expire_carnage.rs` | CarnageFailed event emission | ✓ VERIFIED | Lines 105-113: emits CarnageFailed with vault_balance diagnostic |
| `scripts/vrf/lib/vrf-flow.ts` | Atomic bundling of consume+execute in ONE v0 TX | ✓ VERIFIED | Lines 274-305: builds v0 TX with ALT when carnageAccounts provided. TX4 section REMOVED (grep "[tx4]" returns nothing) |

**All artifacts substantive and wired.**

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| execute_carnage_atomic.rs | constants.rs | CARNAGE_SLIPPAGE_BPS_ATOMIC import | ✓ WIRED | Line 30 import, line 415 usage |
| execute_carnage.rs | constants.rs | CARNAGE_SLIPPAGE_BPS_FALLBACK import | ✓ WIRED | Line 26 import, line 438 usage |
| consume_randomness.rs | constants.rs | CARNAGE_LOCK_SLOTS import | ✓ WIRED | Line 17 import, line 286 usage |
| execute_carnage.rs | errors.rs | CarnageLockActive error | ✓ WIRED | Line 225 require! check |
| expire_carnage.rs | events.rs | CarnageFailed event | ✓ WIRED | Line 105 emit! call |
| vrf-flow.ts | carnage-flow.ts | buildExecuteCarnageAtomicIx shared builder | ✓ WIRED | Lines 276-285 dynamic import and call |
| vrf-flow.ts | alt-helper.ts | sendV0Transaction for bundling | ✓ WIRED | Line 289 import, lines 297-303 v0 TX construction |
| vrf-flow.ts | ATOMICITY REQUIREMENT | Bundle in same TX | ✓ WIRED | Lines 287-304: reveal + consume + executeCarnageAtomic in single v0 TX array |

**All critical links verified.**

### Requirements Coverage

| Requirement | Status | Supporting Evidence |
|-------------|--------|---------------------|
| SEC-04 | ✓ SATISFIED | Fallback path has correct discriminator [0xf4, 0x5f, 0x5a, 0x24, 0x99, 0xa0, 0x37, 0x0c] + swap_authority account (execute_carnage.rs line 174, line 767) |
| SEC-05 | ✓ SATISFIED | Dynamic slippage protection: 85% atomic (CARNAGE_SLIPPAGE_BPS_ATOMIC=8500), 75% fallback (CARNAGE_SLIPPAGE_BPS_FALLBACK=7500). Both paths enforce via u128 arithmetic and CarnageSlippageExceeded error |
| FIX-02 | ✓ SATISFIED | consume_randomness + executeCarnageAtomic bundled atomically in ONE v0 VersionedTransaction (vrf-flow.ts lines 287-304). No CarnagePending event emitted before execution completes |

**All Phase 47 requirements satisfied.**

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| N/A | N/A | None found | N/A | All code substantive, no stubs, placeholders, or TODOs |

### Human Verification Required

None. All success criteria are programmatically verifiable and have been verified through:
1. Code inspection (discriminators, slippage constants, no-op guard, bundling logic)
2. Compilation verification (epoch-program compiles cleanly)
3. Unit test verification (8/8 Carnage tests pass)
4. Structural verification (TX4 removed, v0 TX bundling present)

## Gap Closure Analysis

**Gap from previous verification:**
- **Truth 3:** consume_randomness and executeCarnageAtomic bundled in same transaction
- **Status before:** FAILED (two sequential TXs with await between them)
- **Status after:** ✓ VERIFIED (single v0 TX with all three instructions)

**How gap was closed:**

1. **On-chain change (execute_carnage_atomic.rs):**
   - Removed `constraint = epoch_state.carnage_pending @ EpochError::NoCarnagePending` from struct
   - Added no-op guard at handler start: `if !ctx.accounts.epoch_state.carnage_pending { return Ok(()); }`
   - This makes executeCarnageAtomic safe to include in every TX regardless of VRF result
   - When Carnage doesn't trigger: no-op path (~100 CU cost, no state mutation, no events)
   - When Carnage triggers: execution proceeds normally with full swap logic

2. **Client-side change (vrf-flow.ts):**
   - Modified `sendRevealAndConsume` to accept optional carnageAccounts parameter
   - When carnageAccounts + ALT provided: builds v0 VersionedTransaction with 3 instructions
     - ComputeBudgetProgram.setComputeUnitLimit(600_000)
     - revealIx (Switchboard reveal)
     - consumeIx (consume_randomness)
     - carnageIx (executeCarnageAtomic via buildExecuteCarnageAtomicIx)
   - When not provided: builds legacy Transaction with reveal + consume only (backward compatible)
   - Removed entire TX4 conditional section (~85 lines) that previously sent executeCarnageAtomic separately

3. **Post-TX3 detection:**
   - Cannot distinguish Carnage execution from TX success alone (no-op also returns Ok())
   - Reads post-TX3 EpochState to check: `lastCarnageEpoch === currentEpoch`
   - If true AND carnageAccounts were provided AND carnage_pending=false → Carnage executed atomically
   - If false → normal epoch, no Carnage triggered (no-op path taken)

**Security impact:**
- **CARN-002 MEV gap: FULLY CLOSED**
- Previously: CarnagePending event visible on-chain after TX3, before TX4 execution
- Now: All state changes (carnage_pending=true, swap execution, carnage_pending=false, lastCarnageEpoch update) happen atomically
- MEV bots monitoring events see Carnage AFTER swap completes, cannot front-run

**Regressions:** None. All previously passing tests still pass. Backward compatible (legacy TX path preserved).

---

**Compilation Status:**
- epoch-program: ✓ Compiles (20 warnings, no errors)
- tax-program: ✓ Compiles (17 warnings, no errors)

**Test Status:**
- epoch-program unit tests: 79 passed (8 Carnage tests + 71 others), 0 failed
- Phase 47 specific tests: 8/8 passed
  - test_carnage_action_none_value: ✓
  - test_fallback_more_lenient_than_atomic: ✓
  - test_fallback_slippage_floor: ✓
  - test_old_50_percent_floor_is_gone: ✓
  - test_lock_window_check_logic: ✓
  - test_slippage_floor_handles_large_values: ✓
  - test_slippage_floor_rejects_low_output: ✓
  - test_slippage_floor_zero_expected: ✓

**Phase 47 Status:** COMPLETE ✓

All 4 plans executed (47-01, 47-02, 47-03, 47-04). All success criteria verified. All requirements satisfied (SEC-04, SEC-05, FIX-02). No gaps remaining. No human verification needed.

---

_Verified: 2026-02-19T21:18:22Z_
_Verifier: Claude (gsd-verifier)_
_Re-verification: Yes (gap closure via plan 47-04)_
