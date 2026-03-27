# Spec vs Implementation Reconciliation Report

**Date:** 2026-02-15
**Auditor:** Claude Opus 4.6 (4 parallel spec-vs-code agents)
**Scope:** All 4 design specs vs all 5 on-chain programs + client scripts

---

## Executive Summary

Four design specification documents were systematically audited against the actual codebase. Each spec claim was verified against program source code (Rust/Anchor), client scripts (TypeScript), and on-chain transaction evidence from the live devnet deployment.

| Spec Document | Findings | Confirmed | Critical | High | Medium | Low |
|---|---|---|---|---|---|---|
| Carnage_Fund_Spec.md | 20 | 20 | 1 | 2 | 6 | 11 |
| Epoch_State_Machine_Spec.md | 16 | 22 | 0 | 2 | 3 | 11 |
| Tax_Pool_Logic_Spec.md | 13 | 17 | 0 | 1 | 4 | 8 |
| Transfer_Hook_Spec.md | 10 | 18 | 0 | 0 | 2 | 8 |
| **TOTAL** | **59** | **77** | **1** | **5** | **15** | **38** |

Two mainnet blockers were identified:

1. **Carnage MEV vulnerability (CRITICAL):** Carnage execution is not atomic with VRF consumption, creating an MEV window the spec explicitly intended to prevent.
2. **Sell tax bricks users (HIGH):** Sell tax is pulled from native SOL instead of WSOL output, meaning users with low SOL balances cannot sell their tokens.

---

## Table of Contents

1. [Critical Finding](#1-critical-finding)
2. [High Severity Findings](#2-high-severity-findings)
3. [Medium Severity Findings](#3-medium-severity-findings)
4. [Low Severity Findings](#4-low-severity-findings)
5. [Key Architectural Divergence](#5-key-architectural-divergence)
6. [Recommended Actions Before Mainnet](#6-recommended-actions-before-mainnet)
7. [What Was Confirmed Correct](#7-what-was-confirmed-correct)

---

## 1. Critical Finding

### CARN-002: consume_randomness + executeCarnageAtomic Are SEPARATE Transactions

**Spec:** Carnage_Fund_Spec.md Section 9.5 (Two-Instruction Atomic Bundle)

> Both instructions are bundled in the **same transaction**, providing:
> - **MEV protection:** Identical to single-instruction atomic execution -- the transaction is all-or-nothing

**Reality:** `consume_randomness` sets `carnage_pending = true` on EpochState. The client then sends `execute_carnage_atomic` as a **completely separate transaction**.

- `consume_randomness.rs:263` -- sets pending flags only
- `overnight-runner.ts:378-398` -- calls `testForcedCarnage()` as a separate step
- `vrf-flow.ts:217-221` -- consume TX contains only `revealIx + consumeIx`, no Carnage

**On-chain evidence (devnet epoch 41):**
- consume_randomness TX: slot 442,382,116
- executeCarnageAtomic TX: slot 442,382,201
- Gap: **85 slots (~34 seconds)**

**Impact:** An attacker who monitors `CarnagePending` events can see the Carnage target token (CRIME or FRAUD) on-chain before execution. They can front-run the Carnage buy by purchasing the target first, then selling after Carnage drives the price up. At mainnet scale (hundreds of SOL in the Carnage fund), this is a profitable MEV opportunity.

---

## 2. High Severity Findings

### CARN-007: execute_carnage_atomic is PUBLIC, Not Internal

**Spec:** Carnage_Fund_Spec.md Section 13.2 -- "Called within VRF callback. Not a public instruction."

**Reality:** It is a full Anchor instruction with `#[derive(Accounts)]`, callable by anyone when `carnage_pending = true`.

**Impact:** This is the architectural root of CARN-002. Because it is a separate instruction, it cannot run within `consume_randomness`. The spec intended it as an internal function call.

---

### CARN-009: consume_randomness Always Sets Pending (No Atomic Attempt)

**Spec:** Carnage_Fund_Spec.md Section 11.1-11.2 -- Atomic first, fallback on failure:
```
match execute_carnage_inner(...) {
    Ok(details) => { /* atomic success */ }
    Err(e) => { epoch_state.carnage_pending = true; /* fallback */ }
}
```

**Reality:** `consume_randomness.rs:256-277` -- ALWAYS sets `carnage_pending = true`. There is no attempt to execute Carnage atomically. Every Carnage trigger goes through the "pending" path.

**Impact:** The spec's "try atomic, fallback to pending" pattern does not exist. The 100-slot deadline applies to every Carnage, not just failures.

---

### EPOCH-004: Bounty Payment NOT Implemented

**Spec:** Epoch_State_Machine_Spec.md Section 8.2 -- Treasury pays 0.01 SOL bounty to epoch triggerer via `invoke_signed`.

**Reality:** `trigger_epoch_transition.rs:185-214`:
```rust
// === 7. Pay bounty to triggerer (deferred to Phase 25) ===
bounty_paid: 0, // Will be TRIGGER_BOUNTY_LAMPORTS once treasury integrated
```

The `treasury` account has no PDA seed validation -- any arbitrary account can be passed.

**Impact:** No economic incentive for third parties to trigger epoch transitions. Must be implemented with proper treasury PDA before mainnet.

---

### EPOCH-005: consume_randomness Does NOT Execute Carnage Atomically

**Spec:** Epoch_State_Machine_Spec.md Section 8.3 -- `consume_randomness` directly calls `execute_carnage_inner()` with pool, vault, and AMM accounts.

**Reality:** The `ConsumeRandomness` accounts struct has only 7 accounts (no pools, no vaults, no AMM). It only sets `carnage_pending = true`. Actual execution lives in the separate `execute_carnage_atomic` instruction.

**Impact:** Reinforces CARN-002. The spec's account list for `consume_randomness` is materially wrong (EPOCH-006 below).

---

### TAX-006: Sell Tax Collected from Native SOL, Not Deducted from WSOL Output (MAINNET BLOCKER)

**Spec:** Tax_Pool_Logic_Spec.md Section 4 -- "SELL (IP -> SOL): tax deducted from SOL output"

**Reality:** After the AMM deposits WSOL into the user's token account, tax is collected via `system_instruction::transfer` from the user's **native SOL lamport balance**:

```rust
system_instruction::transfer(
    ctx.accounts.user.key,        // from user's native SOL
    ctx.accounts.staking_escrow.key,
    staking_portion,
)
```

User receives full gross WSOL, then pays tax separately from native SOL.

**Impact -- users can get bricked:** A user who has swapped most of their SOL into CRIME/FRAUD tokens will have very little native SOL remaining. When they try to sell:

1. AMM gives them (e.g.) 10 SOL worth of WSOL
2. Sell tax at 14% = 1.4 SOL pulled from native SOL balance
3. User only has 0.05 SOL native --> **entire TX reverts**
4. User cannot sell their tokens -- they are stuck

Due to atomicity, the user loses nothing (the AMM swap rolls back too), but they literally cannot exit their position until they acquire enough native SOL from elsewhere to cover the tax. On mainnet, this creates a scenario where users holding large token positions with low SOL balances are effectively locked out of selling.

The spec intended the tax to be deducted from the WSOL output itself, so the user simply receives less. The current mechanism requires users to maintain a native SOL buffer equal to their maximum expected sell tax.

---

## 3. Medium Severity Findings

### CARN-001: VRF Byte Indices Shifted from Spec

Spec says bytes 3, 4, 5 for Carnage. Code uses bytes 5, 6, 7 (shifted in Phase 37 for independent tax rolls). Code is internally consistent but spec, `constants.rs` comments, `events.rs` docstrings, and `carnage-flow.ts` comments all still reference the old byte indices.

### CARN-006: CarnagePending Event Missing `reason` Field

Spec defines `reason: String` on the event. Code omits it. Less relevant now that pending state is the normal flow (not a failure case).

### CARN-008: 50% Slippage Floor Added (Not in Spec)

Spec Section 9.3 says "No slippage protection." Code adds `require!(bought >= expected / 2, CarnageSlippageExceeded)`. This is a security **improvement** preventing catastrophic sandwich attacks. Spec should be updated.

### CARN-012: WSOL Wrapping Mechanism Not in Spec

Spec implies direct SOL swap. Code adds `carnage_wsol` account, `sync_native` call, and WSOL wrapping before every Carnage buy. Not documented anywhere in the spec.

### CARN-013: Carnage Signer PDA Not Documented

Spec mentions only `carnage_fund` PDA. Code adds a separate `carnage_signer` PDA (seeds = `["carnage_signer"]`) for swap authority. Undocumented in spec Section 4.

### CARN-017: execute_carnage_atomic Reads EpochState, Not VRF Bytes

Spec shows the function receiving `vrf_result: &[u8; 32]` and interpreting bytes directly. Code reads stored `carnage_action` and `carnage_target` u8 fields from EpochState.

### EPOCH-001: SLOTS_PER_EPOCH is 750, Not 4,500

Devnet override. NOT feature-gated (unlike Switchboard PID which IS). Must be manually changed before mainnet -- no compile-time safety net.

### EPOCH-006: Spec's consume_randomness Account List Wrong

Spec lists 14+ accounts (pools, vaults, AMM). Code has 7 accounts. The extra accounts moved to `ExecuteCarnageAtomic` after the architecture split.

### EPOCH-015: Three Undocumented Instructions

`execute_carnage_atomic`, `initialize_carnage_fund`, and `force_carnage` (devnet-only) exist in code but not in spec.

### EPOCH-016: Duplicated Carnage Logic Across Two Files

Spec defines `execute_carnage_inner()` as shared function. Code has two nearly identical files: `execute_carnage.rs` (936 lines) and `execute_carnage_atomic.rs` (933 lines). Maintenance risk.

### TAX-002: TaxedSwap output_amount Hardcoded to 0 in Buy

Buy handler emits `output_amount: 0` (TODO in code). Sell handler correctly emits actual output. Off-chain indexers see no buy-side data.

### TAX-003: UntaxedSwap output_amount and lp_fee Hardcoded to 0

Both PROFIT pool swap events emit zeroed fields. AMM events must be cross-referenced for actual data.

### TAX-007: LP Fee Order Differs from Spec

Spec says Tax Program deducts LP fee first, then taxes remainder. Code taxes full input, then AMM deducts its own LP fee. Difference: `tax_rate * lp_rate * amount` (~0.04% of input).

### TAX-011: Buy Slippage Delegated to AMM, Not Tax Program

Sell handler checks slippage post-tax. Buy handler passes `minimum_output` through to AMM. Frontend must handle slippage errors from two different programs depending on direction.

### HOOK-001: TransferBlocked Event Not Implemented

Spec defines the event. Code returns an error on blocked transfers but emits no event. Observability gap only.

### HOOK-003: burn_authority is Idempotent Instead of Rejecting

Spec says double-burn should error with `AuthorityAlreadyBurned`. Code succeeds silently (deliberate decision documented in 15-CONTEXT.md).

---

## 4. Low Severity Findings

### Carnage Fund Spec (11 LOW)

| ID | Description |
|---|---|
| CARN-003 | Enum naming: `None/Burn/Sell` vs spec's `BuyOnly/SellThenBuy/BurnThenBuy` |
| CARN-004 | `held_token` is `u8` not `Option<Token>` (serialization optimization) |
| CARN-005 | CarnageFundState size 147 bytes, not 148 (from u8 vs Option) |
| CARN-010 | VRF callback never-reverts property holds via different mechanism |
| CARN-011 | Token enum values and `held_token` offset (+1) undocumented |
| CARN-014 | Rent-exempt minimum deduction before swap (correctness improvement) |
| CARN-015 | Sell+Buy combined amount logic differs from spec (economically equivalent) |
| CARN-016 | `CarnageFunded` event not implemented |
| CARN-018 | Auto-expire in `consume_randomness` (improvement, not in spec) |
| CARN-019 | CarnageExpired `sol_retained` always 0 in auto-expire path |
| CARN-020 | Client code comments reference "VRF byte 3" (stale) |

### Epoch State Machine Spec (11 LOW)

| ID | Description |
|---|---|
| EPOCH-002 | EpochState data size 92 bytes, spec says 93 (arithmetic error in spec) |
| EPOCH-003 | Enums stored as raw u8 (serialization optimization) |
| EPOCH-007 | Error message says "need 6" but MIN_VRF_BYTES = 8 |
| EPOCH-008 | TaxesUpdated event emits legacy fields as 0, no per-token fields |
| EPOCH-009 | CarnagePending event missing `reason` field |
| EPOCH-010 | CarnageExpired event has extra fields, removes `current_slot` |
| EPOCH-011 | CarnageNotTriggered event has extra `vrf_byte` field |
| EPOCH-012 | CarnageExecuted event has extra `sol_from_sale` field |
| EPOCH-013 | constants.rs comments reference pre-Phase 37 byte positions |
| EPOCH-014 | Overnight runner VRF byte reconstruction produces negative numbers |

### Tax Pool Spec (8 LOW)

| ID | Description |
|---|---|
| TAX-001 | Event field `yield_portion` vs `staking_portion` naming |
| TAX-004 | EpochState LEN off by 1 byte in Tax Program mirror |
| TAX-005 | Spec says "parallel path" but CPI executes sequentially |
| TAX-008 | 3 extra error codes not in spec (positive) |
| TAX-009 | Spec says Tax Program deducts LP fee on sell (AMM does it) |
| TAX-010 | ExemptSwap event in code but not in spec (positive) |
| TAX-012 | `OutputBelowMinimum` error defined but never raised |
| TAX-013 | STAKING_BPS/CARNAGE_BPS constants defined but unused by split_distribution |

### Transfer Hook Spec (8 LOW)

| ID | Description |
|---|---|
| HOOK-002 | `ExtraAccountMetaListAlreadyInitialized` error missing (System Program catches it) |
| HOOK-004 | Code adds mint owner + transferring flag checks (positive) |
| HOOK-005 | Extra error variants not in spec (positive) |
| HOOK-006 | No account owner check on whitelist PDA (PDA derivation is sufficient) |
| HOOK-007 | `ExtraAccountMetaListInitialized` event not in spec (positive) |
| HOOK-008 | ExtraAccountMetaList init requires authority (positive) |
| HOOK-009 | `add_whitelist_entry` has address validation not in spec (positive) |
| HOOK-010 | 4-account hook pattern (implicit hook_program) undocumented |

---

## 5. Key Architectural Divergence

The most significant divergence across all specs is the **Carnage execution architecture**:

**Spec says:**
1. `consume_randomness` interprets VRF bytes and calls `execute_carnage_inner()` atomically
2. If atomic execution fails (compute limit), set `carnage_pending = true` as fallback
3. `execute_carnage_atomic` is an internal function, not a public instruction
4. MEV protection via same-transaction bundling

**Code does:**
1. `consume_randomness` ALWAYS sets `carnage_pending = true`, stores action/target as u8 fields
2. No atomic attempt ever made -- every Carnage goes through pending path
3. `execute_carnage_atomic` is a PUBLIC permissionless instruction
4. Client sends reveal+consume in one TX, then executeCarnage in a SEPARATE TX
5. An undocumented `carnage_signer` PDA and `carnage_wsol` account were added for WSOL wrapping

This was likely driven by the CPI depth constraint (Solana limit of 4), making it impractical to execute Carnage within `consume_randomness`. The spec's two-instruction-in-one-transaction approach (Section 9.5) was the intended compromise, but the client code does not bundle them.

**Finding chain:** CARN-002 (CRITICAL) + CARN-007 (HIGH) + CARN-009 (HIGH) + EPOCH-005 (HIGH) + CARN-012 (MEDIUM) + CARN-013 (MEDIUM) + CARN-017 (MEDIUM) + EPOCH-006 (MEDIUM) + EPOCH-015 (MEDIUM) + EPOCH-016 (MEDIUM) are all consequences of this single architectural decision.

---

## 6. Recommended Actions Before Mainnet

### Must Fix (Mainnet Blockers)

1. **Bundle consume_randomness + executeCarnageAtomic in one transaction**
   - Findings: CARN-002, EPOCH-005
   - Severity: CRITICAL -- MEV vulnerability at mainnet scale
   - Fix: Client-side change in `vrf-flow.ts` -- add `executeCarnageAtomicIx` to the reveal+consume TX when Carnage triggers
   - Alternative: On-chain fix where `consume_randomness` calls Carnage internally (requires adding ~15 accounts to the struct)

2. **Fix sell tax to deduct from WSOL output, not native SOL**
   - Finding: TAX-006
   - Severity: HIGH -- users with low native SOL cannot sell tokens (position bricking)
   - Fix options:
     - (a) Transfer WSOL tax portion from user's WSOL account to a protocol WSOL account, then close/unwrap to native SOL for distribution. Adds 1-2 accounts but matches spec.
     - (b) Have Tax Program unwrap the user's WSOL tax portion inline (close_account on a split amount). More complex, may need a temporary WSOL account.
     - (c) Change distribution targets to accept WSOL instead of native SOL. Largest architectural change -- affects staking escrow, carnage vault, treasury.
   - Recommended: Option (a) -- protocol-owned WSOL intermediary account

3. **Feature-gate SLOTS_PER_EPOCH for devnet**
   - Finding: EPOCH-001
   - Fix: `#[cfg(feature = "devnet")] pub const SLOTS_PER_EPOCH: u64 = 750;` / `#[cfg(not(feature = "devnet"))] pub const SLOTS_PER_EPOCH: u64 = 4_500;`

4. **Implement bounty payment**
   - Finding: EPOCH-004
   - Fix: Add treasury PDA derivation + `invoke_signed` transfer in `trigger_epoch_transition`

### Should Fix (Correctness / Maintainability)

4. **Update all 4 spec docs** to match current architecture
   - Findings: CARN-001, CARN-006, CARN-008, CARN-012, CARN-013, EPOCH-006, EPOCH-015, TAX-006, TAX-007

5. **Fix stale comments** referencing pre-Phase 37 byte positions
   - Findings: CARN-020, EPOCH-007, EPOCH-013
   - Locations: `constants.rs:111-116`, `events.rs:163`, `carnage-flow.ts:9,63,757`, `errors.rs:53-55`

6. **Extract shared Carnage logic** into `execute_carnage_inner.rs`
   - Finding: EPOCH-016
   - ~1,800 lines of near-duplicate code across two files

7. **Fix TAX-004**: Correct the EpochState LEN constant in Tax Program mirror (101 -> 100)

8. **Populate event fields**: Fix zeroed `output_amount` in buy events (TAX-002, TAX-003)

### Nice to Have

9. Fix VRF byte reconstruction in `vrf-flow.ts` (EPOCH-014)
10. Add `CarnageFunded` event to Tax Program (CARN-016)
11. Add `TransferBlocked` event to Transfer Hook (HOOK-001)
12. Use named constants in `split_distribution` instead of magic numbers (TAX-013)

---

## 7. What Was Confirmed Correct

Across all 4 specs, **77 claims were verified as correctly implemented**:

### Core Protocol Mechanics
- Tax calculation formula: `amount * bps / 10_000` with u128 intermediates
- Tax distribution: 75% staking / 24% carnage / 1% treasury (remainder absorbs rounding)
- VRF byte allocation: bytes 0-7 correctly mapped to tax derivation + Carnage
- Carnage trigger threshold: byte 5 < 11 (~4.3%)
- Carnage action threshold: byte 6 < 5 = Sell (2%), else Burn (98%)
- Carnage target: byte 7 < 128 = CRIME (50%), else FRAUD (50%)
- MAX_CARNAGE_SWAP_LAMPORTS = 1,000 SOL
- CARNAGE_DEADLINE_SLOTS = 100

### PDA Derivation (All Match Spec)
- EpochState: `["epoch_state"]`
- CarnageFundState: `["carnage_fund"]`
- SOL Vault: `["carnage_sol_vault"]`
- CRIME Vault: `["carnage_crime_vault"]`
- FRAUD Vault: `["carnage_fraud_vault"]`
- Swap Authority: `["swap_authority"]`
- Whitelist: `["whitelist", address]`
- Authority: `["authority"]`
- ExtraAccountMetaList: `["extra-account-metas", mint]`

### Security Properties
- Anti-reroll: `pending_randomness_account` binding prevents VRF manipulation
- Stale VRF prevention: `slot_diff <= 1` and `get_value().is_ok() == false`
- Carnage tax exemption: `swap_exempt` validates `carnage_signer` PDA via `seeds::program`
- CPI depth: Never exceeds 4 (Solana limit)
- Transfer Hook: `amount > 0 AND (source OR dest whitelisted)` enforced correctly
- Authority model: burn-only, no reassignment, no admin escape hatches
- EpochState owner validation prevents fake tax rates
- Token-2022 burns do NOT trigger transfer hooks (correct)
- `carnage_pending` never blocks epoch transitions (independent state)
- VRF timeout recovery correctly creates fresh randomness

### State Machine Transitions
- ACTIVE -> VRF_COMMITTED (trigger_epoch_transition): all guards verified
- VRF_COMMITTED -> ACTIVE (consume_randomness): all guards verified
- VRF_COMMITTED -> VRF_RETRY: timeout + freshness checks verified
- Genesis state initialization: all fields match spec exactly
- Epoch calculation: `(slot - genesis) / SLOTS_PER_EPOCH` correct

### Events (Structure Matches)
- EpochStateInitialized, EpochTransitionTriggered, TaxesUpdated
- CarnageFundInitialized, CarnageExecuted, CarnagePending, CarnageExpired
- AuthorityBurned, AddressWhitelisted
- TaxedSwap (field types match, minus naming in TAX-001)

---

*Report generated from 4 parallel audit agents each reading the full spec document and systematically checking every claim against the codebase. Total: ~500,000 tokens of analysis across ~27,000 lines of Rust/TypeScript.*
