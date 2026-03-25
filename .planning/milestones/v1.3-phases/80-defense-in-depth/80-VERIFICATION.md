---
phase: 80-defense-in-depth
verified: 2026-03-08T12:00:00Z
status: passed
score: 8/8 must-haves verified
---

# Phase 80: Defense-in-Depth Verification Report

**Phase Goal:** All cross-program byte reads are ownership-verified, all u128-to-u64 casts are checked, and struct layout stability is enforced
**Verified:** 2026-03-08T12:00:00Z
**Status:** PASSED
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | read_pool_reserves() rejects accounts not owned by AMM program | VERIFIED | pool_reader.rs:61-64 has `require!(*pool_info.owner == amm_program_id(), TaxError::InvalidPoolOwner)` |
| 2 | read_pool_reserves() returns (sol_reserve, token_reserve) regardless of canonical mint ordering | VERIFIED | pool_reader.rs:76-96 reads mint_a from bytes [9..41], compares to NATIVE_MINT, swaps if reversed |
| 3 | Carnage pool accounts reject non-AMM-owned accounts at Anchor constraint level | VERIFIED | execute_carnage.rs:117 and :132, execute_carnage_atomic.rs:122 and :137 all have `owner = amm_program_id() @ EpochError::InvalidAmmProgram` |
| 4 | No u128-to-u64 truncating casts remain in production math code | VERIFIED | staking math.rs:51 uses try_from; tax_math.rs:52,97,101,164 use try_from().ok(); bonding_curve math.rs:109,192,211,236 use try_from; claim_refund.rs:163 uses try_from; carnage files use try_from. All production `as u64` casts are widening (u16/u32->u64) or in test code. |
| 5 | consume_randomness uses checked Token::from_u8 conversion | VERIFIED | consume_randomness.rs:194-195 uses `Token::from_u8(epoch_state.cheap_side).ok_or(EpochError::InvalidCheapSide)?` |
| 6 | EpochState has 64-byte reserved padding | VERIFIED | epoch_state.rs:152 has `pub reserved: [u8; 64]`, initialize_epoch_state.rs:80 sets `reserved: [0u8; 64]` |
| 7 | EpochState and Tax mirror struct both have #[repr(C)] with compile-time size assertion | VERIFIED | epoch_state.rs:50 has `#[repr(C)]`, line 187 has `const _: () = assert!(EpochState::DATA_LEN == 164)`. epoch_state_reader.rs:20 has `#[repr(C)]`, line 64 has matching assertion |
| 8 | Bonding Curve purchase and sell reject remaining_accounts != 4 | VERIFIED | purchase.rs:214-215 and sell.rs:214-215 both have `require!(ctx.remaining_accounts.len() == 4, CurveError::InvalidHookAccounts)` |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `programs/tax-program/src/helpers/pool_reader.rs` | Owner-verified pool byte reader with is_reversed | VERIFIED | 97 lines, has amm_program_id() owner check, NATIVE_MINT comparison, returns (sol_reserve, token_reserve) |
| `programs/tax-program/src/errors.rs` | InvalidPoolOwner error variant | VERIFIED | Line 91-92, error variant present with DEF-01 source comment |
| `programs/epoch-program/src/instructions/execute_carnage.rs` | Owner-constrained pool accounts | VERIFIED | Lines 117, 132 have `owner = amm_program_id()` on crime_pool and fraud_pool |
| `programs/epoch-program/src/instructions/execute_carnage_atomic.rs` | Owner-constrained pool accounts | VERIFIED | Lines 122, 137 have `owner = amm_program_id()` on crime_pool and fraud_pool |
| `programs/staking/src/helpers/math.rs` | Checked u128->u64 cast for pending rewards | VERIFIED | Line 51: `u64::try_from(pending).map_err(\|_\| error!(StakingError::Overflow))?` |
| `programs/tax-program/src/helpers/tax_math.rs` | Checked u128->u64 cast for output floor | VERIFIED | Line 164: `u64::try_from(floor).ok()`, lines 52/97/101 also use `try_from().ok()` |
| `programs/bonding_curve/src/math.rs` | Checked u128->u64 casts for tokens_out, sol_lamports, price, refund | VERIFIED | Lines 109, 192 use try_from with error; line 211 uses unwrap_or(u64::MAX); line 236 uses try_from().ok() |
| `programs/bonding_curve/src/instructions/claim_refund.rs` | Checked u128->u64 for refund proportion | VERIFIED | Line 163: `u64::try_from(refund_amount_u128).map_err(\|_\| error!(CurveError::Overflow))?` |
| `programs/epoch-program/src/instructions/consume_randomness.rs` | Checked Token::from_u8 conversion | VERIFIED | Lines 194-195: `Token::from_u8(epoch_state.cheap_side).ok_or(EpochError::InvalidCheapSide)?` |
| `programs/epoch-program/src/state/enums.rs` | Token::from_u8 safe method | VERIFIED | Lines 29-35: checked from_u8 returning Option, with unit tests |
| `programs/epoch-program/src/errors.rs` | InvalidCheapSide error variant | VERIFIED | Line 143: `InvalidCheapSide` error variant present |
| `programs/epoch-program/src/state/epoch_state.rs` | Reserved padding, #[repr(C)], compile-time assertion | VERIFIED | reserved: [u8; 64] at line 152, #[repr(C)] at line 50, assertion at line 187 |
| `programs/tax-program/src/state/epoch_state_reader.rs` | Mirror struct with matching layout | VERIFIED | reserved: [u8; 64] at line 53, #[repr(C)] at line 20, assertion at line 64, DATA_LEN == 164 |
| `programs/bonding_curve/src/instructions/purchase.rs` | remaining_accounts count validation | VERIFIED | Lines 214-215: `require!(ctx.remaining_accounts.len() == 4, CurveError::InvalidHookAccounts)` |
| `programs/bonding_curve/src/instructions/sell.rs` | remaining_accounts count validation | VERIFIED | Lines 214-215: `require!(ctx.remaining_accounts.len() == 4, CurveError::InvalidHookAccounts)` |
| `programs/bonding_curve/src/error.rs` | InvalidHookAccounts error variant | VERIFIED | Line 128: `InvalidHookAccounts` error variant present |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| pool_reader.rs | AMM program ID | `require!(*pool_info.owner == amm_program_id())` | VERIFIED | Line 62, rejects non-AMM accounts before any byte reads |
| pool_reader.rs | NATIVE_MINT | `native_mint()` function comparison | VERIFIED | Lines 29-32, 92, returns swapped reserves if mint_a != NATIVE_MINT |
| execute_carnage.rs | EpochError::InvalidAmmProgram | `owner = amm_program_id()` Anchor constraint | VERIFIED | Lines 117, 132 on crime_pool and fraud_pool |
| execute_carnage_atomic.rs | EpochError::InvalidAmmProgram | `owner = amm_program_id()` Anchor constraint | VERIFIED | Lines 122, 137 on crime_pool and fraud_pool |
| staking math.rs | StakingError::Overflow | `try_from map_err` | VERIFIED | Line 51 |
| consume_randomness.rs | EpochError::InvalidCheapSide | `Token::from_u8` checked conversion | VERIFIED | Line 194-195 |
| epoch_state.rs | epoch_state_reader.rs | Identical DATA_LEN == 164 assertion | VERIFIED | Both assert 164, both #[repr(C)], field order matches |
| purchase.rs | CurveError::InvalidHookAccounts | `remaining_accounts.len() == 4` | VERIFIED | Lines 214-215 |
| sell.rs | CurveError::InvalidHookAccounts | `remaining_accounts.len() == 4` | VERIFIED | Lines 214-215 |

### Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| DEF-01: Pool account ownership verification | SATISFIED | pool_reader.rs:61-64 checks owner == amm_program_id() |
| DEF-02: is_reversed canonical mint detection | SATISFIED | pool_reader.rs:76-96 reads mint_a, compares to NATIVE_MINT, swaps reserves |
| DEF-03: EpochState 64-byte reserved padding | SATISFIED | epoch_state.rs:152 has `reserved: [u8; 64]`, init sets to zeroes |
| DEF-04: All u128-to-u64 casts checked | SATISFIED | try_from used in staking, tax, bonding curve, epoch programs; no truncating casts in production code |
| DEF-05: Bonding Curve remaining_accounts validation | SATISFIED | purchase.rs:214, sell.rs:214 both check len() == 4 |
| DEF-06: Carnage pool owner constraint | SATISFIED | execute_carnage.rs:117,132 and execute_carnage_atomic.rs:122,137 have owner constraints |
| DEF-07: Token::from_u8 checked conversion | SATISFIED | consume_randomness.rs:194-195 uses from_u8 + InvalidCheapSide error; execute_carnage*.rs also use from_u8 |
| DEF-08: #[repr(C)] with compile-time layout assertions | SATISFIED | Both structs have #[repr(C)] and `const _: () = assert!(DATA_LEN == 164)` |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| epoch_state.rs | 44-45 | Duplicate comment lines listing "initialized" and "bump" twice in size doc | Info | Documentation only, no code impact |
| enums.rs | 40 | `from_u8_unchecked` method retained | Info | No production callers remain; retained for test coverage only |

### Human Verification Required

None required. All changes are structural (Rust type system + compile-time assertions) and fully verifiable through code inspection.

### Gaps Summary

No gaps found. All 8 requirements (DEF-01 through DEF-08) are fully satisfied with substantive implementations wired into the codebase. The phase goal -- ownership-verified cross-program reads, checked u128-to-u64 casts, and struct layout stability -- is achieved.

---

_Verified: 2026-03-08T12:00:00Z_
_Verifier: Claude (gsd-verifier)_
