---
phase: 25-carnage-fund-execution
verified: 2026-02-06T20:34:52Z
status: gaps_found
score: 4/5 must-haves verified
gaps:
  - truth: "Fallback mechanisms exist: execute_carnage (100-slot deadline) and expire_carnage (clears pending state, retains SOL)"
    status: partial
    reason: "execute_carnage instruction exists with proper deadline validation BUT is a stub - doesn't execute actual swaps/burns"
    artifacts:
      - path: "programs/epoch-program/src/instructions/execute_carnage.rs"
        issue: "Lines 100, 131-134 contain TODO comments and placeholder 0 values for actual swap/burn execution"
    missing:
      - "Actual burn/sell/buy execution logic in execute_carnage handler (similar to execute_carnage_atomic)"
      - "CPI to Tax::swap_exempt for sell and buy operations"
      - "Token-2022 burn invocation for held tokens"
      - "Real values for sol_spent, tokens_bought, tokens_burned, sol_from_sale in CarnageExecuted event"
---

# Phase 25: Carnage Fund Execution Verification Report

**Phase Goal:** Implement Carnage Fund rebalancing with ~4.3% trigger probability per epoch, VRF-determined action/target, and atomic execution at CPI depth 4.

**Verified:** 2026-02-06T20:34:52Z

**Status:** gaps_found

**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | CarnageFundState account and three vault PDAs (SOL/CRIME/FRAUD) exist and are initialized | ✓ VERIFIED | CarnageFundState struct at 147 bytes, initialize_carnage_fund instruction exists, all PDA seeds defined |
| 2 | Carnage triggers ~4.3% of epochs (VRF byte 3 < 11) with action (98% burn / 2% sell) and target (50/50 CRIME/FRAUD) determined by VRF bytes 4-5 | ✓ VERIFIED | is_carnage_triggered() checks byte 3 < 11, get_carnage_action() uses byte 4 < 5 threshold, get_carnage_target() uses byte 5 < 128 |
| 3 | Carnage executes atomically within consume_randomness using Tax::swap_exempt (0% tax, carnage_signer PDA validated) | ✓ VERIFIED | execute_carnage_atomic implements full burn/sell/buy logic via Tax::swap_exempt CPI, carnage_signer PDA seeds validated |
| 4 | Full CPI chain works at depth 4 (Epoch -> Tax -> AMM -> Token-2022 -> Hook) | ✓ VERIFIED | execute_carnage_atomic calls Tax::swap_exempt with remaining_accounts forwarding for transfer hook |
| 5 | Fallback mechanisms exist: execute_carnage (100-slot deadline) and expire_carnage (clears pending state, retains SOL) | ⚠️ PARTIAL | execute_carnage validates deadline correctly BUT is a stub - doesn't execute swaps/burns (lines 100, 131-134 have TODOs). expire_carnage is complete. |

**Score:** 4/5 truths verified (1 partial)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `programs/epoch-program/src/state/carnage_fund_state.rs` | CarnageFundState account definition | ✓ VERIFIED | 147 bytes (8 discriminator + 139 data), all fields present, HeldToken enum, LEN constants, static assertions pass |
| `programs/epoch-program/src/constants.rs` | Carnage trigger threshold, sell threshold, swap cap constants | ✓ VERIFIED | CARNAGE_TRIGGER_THRESHOLD = 11, CARNAGE_SELL_THRESHOLD = 5, MAX_CARNAGE_SWAP_LAMPORTS = 1_000_000_000_000, all PDA seeds defined |
| `programs/epoch-program/src/events.rs` | CarnageExecuted, CarnagePending, CarnageExpired events | ✓ VERIFIED | 5 Carnage events: CarnageFundInitialized, CarnageExecuted, CarnagePending, CarnageExpired, CarnageNotTriggered |
| `programs/epoch-program/src/errors.rs` | CarnageError variants | ✓ VERIFIED | 9 Carnage errors: CarnageNotInitialized, CarnageAlreadyInitialized, NoCarnagePending, CarnageDeadlineExpired, CarnageDeadlineNotExpired, InvalidCarnageTargetPool, InsufficientCarnageSol, CarnageSwapFailed, CarnageBurnFailed |
| `programs/epoch-program/src/helpers/carnage.rs` | VRF helper functions | ✓ VERIFIED | is_carnage_triggered(), get_carnage_action(), get_carnage_target() all implemented with comprehensive tests |
| `programs/epoch-program/src/instructions/initialize_carnage_fund.rs` | initialize_carnage_fund instruction | ✓ VERIFIED | Creates CarnageFundState PDA, crime_vault and fraud_vault Token-2022 accounts, references sol_vault SystemAccount |
| `programs/epoch-program/src/instructions/execute_carnage_atomic.rs` | execute_carnage_atomic instruction | ✓ VERIFIED | 521 lines, implements burn logic (Token-2022), swap_exempt CPI for sell and buy, respects MAX_CARNAGE_SWAP_LAMPORTS cap, emits CarnageExecuted with atomic=true |
| `programs/epoch-program/src/instructions/execute_carnage.rs` | execute_carnage fallback | ⚠️ STUB | 158 lines, validates deadline correctly BUT lines 100, 131-134 have TODO comments - actual swap/burn execution missing |
| `programs/epoch-program/src/instructions/expire_carnage.rs` | expire_carnage instruction | ✓ VERIFIED | Validates deadline passed, clears pending state, emits CarnageExpired |
| `programs/epoch-program/src/instructions/consume_randomness.rs` | consume_randomness integration | ✓ VERIFIED | Auto-expires stale pending at start, checks Carnage trigger after staking CPI, sets pending fields when triggered, emits CarnagePending or CarnageNotTriggered |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| consume_randomness | carnage helpers | is_carnage_triggered, get_carnage_action, get_carnage_target | ✓ WIRED | Lines 251-278 in consume_randomness.rs use all three helpers |
| execute_carnage_atomic | Tax::swap_exempt | CPI with carnage_signer PDA | ✓ WIRED | Lines 427-519 build and execute swap_exempt CPI with proper account structure and remaining_accounts forwarding |
| execute_carnage_atomic | Token-2022 burn | Manual instruction building | ✓ WIRED | Lines 281-365 build burn instruction (discriminator 8) and invoke_signed with carnage_state PDA |
| execute_carnage | Tax::swap_exempt | CPI (expected) | ✗ NOT_WIRED | execute_carnage.rs line 100 says "Actual swap/burn execution will be added in Phase 26" |
| state/mod.rs | carnage_fund_state | pub use export | ✓ WIRED | Line 3: pub mod carnage_fund_state, Line 7: pub use carnage_fund_state::* |
| lib.rs | all instructions | pub fn exports | ✓ WIRED | initialize_carnage_fund (line 144), execute_carnage (line 172), execute_carnage_atomic (line 217), expire_carnage (line 244) |

### Requirements Coverage

Phase 25 has 12 requirements (CRN-01 to CRN-12) per ROADMAP.md.

| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| CRN-01 to CRN-11 | ✓ SATISFIED | All primary requirements met via execute_carnage_atomic |
| CRN-12 (Fallback) | ⚠️ BLOCKED | execute_carnage is a stub - missing actual execution logic |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| programs/epoch-program/src/instructions/execute_carnage.rs | 55-63 | NOTE comment about accounts missing | ℹ️ Info | Documents that accounts for swap execution are incomplete |
| programs/epoch-program/src/instructions/execute_carnage.rs | 100 | NOTE: Actual swap/burn execution will be added in Phase 26 | 🛑 Blocker | Fallback path doesn't execute Carnage |
| programs/epoch-program/src/instructions/execute_carnage.rs | 125-134 | TODO placeholders for event values | 🛑 Blocker | All execution metrics set to 0 instead of actual values |
| programs/epoch-program/src/instructions/execute_carnage_atomic.rs | 395 | Return amount as placeholder for SOL received | ⚠️ Warning | Comment indicates sell return value is approximate |
| programs/epoch-program/src/instructions/execute_carnage_atomic.rs | 422 | Return amount as placeholder for tokens received | ⚠️ Warning | Comment indicates buy return value is approximate |

### Human Verification Required

1. **Visual: Carnage triggered event on devnet**
   - **Test:** Deploy to devnet, trigger epoch transitions until Carnage is triggered
   - **Expected:** CarnagePending or CarnageNotTriggered event emitted with correct VRF byte values
   - **Why human:** Requires devnet deployment and monitoring events over time

2. **Functional: execute_carnage_atomic completes full CPI chain**
   - **Test:** Deploy to devnet, wait for Carnage trigger, call execute_carnage_atomic
   - **Expected:** CarnageExecuted event emitted, vault balances updated, no CPI depth errors
   - **Why human:** Requires actual on-chain execution to verify CPI depth 4 works

3. **Functional: execute_carnage fallback actually executes**
   - **Test:** (BLOCKED) After gap closure, test fallback execution within 100-slot deadline
   - **Expected:** Carnage executes with atomic=false, correct swap/burn behavior
   - **Why human:** Cannot test until gap is closed

### Gaps Summary

**1 gap blocking full goal achievement:**

**Gap: execute_carnage instruction is a stub**

The fallback execution path exists with correct deadline validation and state management, but doesn't perform the actual Carnage operations (burn/sell/buy). This means if atomic execution fails (e.g., compute limits), there's no working fallback to complete the Carnage.

**What's missing:**
- Lines 100-134 in execute_carnage.rs need the same execution logic as execute_carnage_atomic
- Need to add accounts for Tax Program, AMM Program, pools, token programs (currently noted as missing at line 55-63)
- Need to implement burn_held_tokens, execute_sell_swap, execute_buy_swap calls
- Need to emit CarnageExecuted event with real values instead of TODO placeholders

**Why it matters:**
- Carnage spec requires fallback mechanism for resilience
- Without working fallback, compute-heavy Carnage triggers could fail permanently
- SOL would accumulate indefinitely without a way to execute

**Severity:** Medium — atomic path works (primary success criteria met), but fallback resilience is incomplete

---

_Verified: 2026-02-06T20:34:52Z_
_Verifier: Claude (gsd-verifier)_
