---
phase: 46-account-validation-security
verified: 2026-02-18T22:46:38Z
status: passed
score: 5/5 must-haves verified
---

# Phase 46: Account Validation Security Verification Report

**Phase Goal:** All on-chain accounts that receive funds or execute CPI calls are cryptographically validated, eliminating account substitution as an attack vector
**Verified:** 2026-02-18T22:46:38Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | Passing a fake staking_escrow, carnage_vault, or treasury address to swap_sol_buy or swap_sol_sell causes the transaction to fail with a constraint violation | VERIFIED | Tests pass: "rejects fake staking_escrow in swap_sol_buy/sell", "rejects fake carnage_vault in swap_sol_buy/sell", "rejects fake treasury in swap_sol_buy/sell" (6 tests, all green) |
| 2 | Passing a fake amm_program to any Tax Program swap instruction, or a fake tax_program/amm_program to Carnage execution, causes the transaction to fail with an address mismatch error | VERIFIED | All 9 SEC-02 tests pass: amm_program constraint with @ TaxError::InvalidAmmProgram confirmed in swap_sol_buy.rs:423, swap_sol_sell.rs:447, swap_profit_buy.rs:216, swap_profit_sell.rs:216, swap_exempt.rs:244; tax_program/amm_program in execute_carnage_atomic.rs:165,170 |
| 3 | Passing a randomness account owned by any program other than Switchboard to trigger_epoch_transition, consume_randomness, or retry_epoch_vrf causes the transaction to fail with InvalidRandomnessOwner | VERIFIED | All 3 SEC-03 tests pass; owner constraint with @ EpochError::InvalidRandomnessOwner confirmed at trigger_epoch_transition.rs:48, consume_randomness.rs:51, retry_epoch_vrf.rs:37 |
| 4 | Passing a carnage_wsol token account whose owner is not the carnage_signer PDA causes execute_carnage_atomic to fail with a constraint violation | VERIFIED | Both SEC-07 tests pass; constraint = carnage_wsol.owner == carnage_signer.key() @ EpochError::InvalidCarnageWsolOwner confirmed at execute_carnage_atomic.rs:90-92 |
| 5 | A test suite covering all 4 validation categories confirms that previously-exploitable substitution attacks now revert | VERIFIED | 20/20 adversarial tests pass in 17 seconds; tests/security-account-validation.ts exists at 1216 lines; Anchor.toml has test-account-validation script at line 35 |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `programs/epoch-program/src/constants.rs` | staking_program_id() function | VERIFIED | staking_program_id() at line 33, unit test test_staking_program_id() at line 211, returns Bb8istpSMj2TZB9h8Fh6H3fWeqAjSjmPBec7i4gWiYRi |
| `programs/epoch-program/src/errors.rs` | InvalidStakingProgram, InvalidTaxProgram, InvalidAmmProgram variants | VERIFIED | All 3 variants present at lines 117-135; also has InvalidRandomnessOwner at line 111, InvalidCarnageWsolOwner at line 114 |
| `programs/epoch-program/src/instructions/consume_randomness.rs` | address constraint on staking_program | VERIFIED | Line 69: `#[account(address = staking_program_id() @ EpochError::InvalidStakingProgram)]` |
| `programs/epoch-program/src/instructions/trigger_epoch_transition.rs` | owner constraint on randomness_account | VERIFIED | Line 48: `#[account(owner = SWITCHBOARD_PROGRAM_ID @ EpochError::InvalidRandomnessOwner)]` |
| `programs/epoch-program/src/instructions/retry_epoch_vrf.rs` | owner constraint on randomness_account | VERIFIED | Line 37: `#[account(owner = SWITCHBOARD_PROGRAM_ID @ EpochError::InvalidRandomnessOwner)]` |
| `programs/epoch-program/src/instructions/execute_carnage_atomic.rs` | address constraints on tax_program and amm_program; owner constraint on carnage_wsol | VERIFIED | tax_program @ EpochError::InvalidTaxProgram at line 165; amm_program @ EpochError::InvalidAmmProgram at line 170; carnage_wsol owner constraint @ EpochError::InvalidCarnageWsolOwner at lines 90-92 |
| `programs/tax-program/src/errors.rs` | InvalidAmmProgram, InvalidStakingProgram variants | VERIFIED | InvalidAmmProgram at line 66, InvalidStakingProgram at line 70 |
| `programs/tax-program/src/instructions/swap_sol_buy.rs` | custom error annotations on all constraints | VERIFIED | staking_escrow @ TaxError::InvalidStakingEscrow (line 397), carnage_vault @ TaxError::InvalidCarnageVault (line 408), treasury @ TaxError::InvalidTreasury (line 416), amm_program @ TaxError::InvalidAmmProgram (line 423), staking_program @ TaxError::InvalidStakingProgram (line 437) |
| `programs/tax-program/src/instructions/swap_sol_sell.rs` | same constraint pattern as swap_sol_buy | VERIFIED | Same pattern confirmed: lines 421, 432, 440, 447, 461 |
| `programs/tax-program/src/instructions/swap_profit_buy.rs` | amm_program constraint | VERIFIED | Line 216: `#[account(address = amm_program_id() @ TaxError::InvalidAmmProgram)]` |
| `programs/tax-program/src/instructions/swap_profit_sell.rs` | amm_program constraint | VERIFIED | Line 216: `#[account(address = amm_program_id() @ TaxError::InvalidAmmProgram)]` |
| `programs/tax-program/src/instructions/swap_exempt.rs` | amm_program constraint | VERIFIED | Line 244: `#[account(address = amm_program_id() @ TaxError::InvalidAmmProgram)]` |
| `tests/security-account-validation.ts` | 20 adversarial tests, 300+ lines | VERIFIED | 1216 lines, 20 tests confirmed via grep; all 20 pass |
| `Anchor.toml` | test-account-validation script | VERIFIED | Line 35: test-account-validation = "npx ts-mocha -p ./tsconfig.json -t 1000000 tests/security-account-validation.ts" |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `consume_randomness.rs` | `constants.rs` | staking_program_id() import + address constraint | WIRED | Line 15 import, line 69 constraint |
| `trigger_epoch_transition.rs` | `constants.rs` | SWITCHBOARD_PROGRAM_ID + InvalidRandomnessOwner | WIRED | Line 12 import, line 48 constraint |
| `retry_epoch_vrf.rs` | `constants.rs` | SWITCHBOARD_PROGRAM_ID + InvalidRandomnessOwner | WIRED | Line 12 import, line 37 constraint |
| `execute_carnage_atomic.rs` | `constants.rs` | tax_program_id() + amm_program_id() | WIRED | Line 26-28 imports, lines 165+170 constraints |
| `swap_sol_buy.rs` | `errors.rs` (tax) | @ TaxError::InvalidStakingEscrow on seeds constraint | WIRED | constraint = true @ TaxError::InvalidStakingEscrow at line 397 |
| `swap_sol_buy.rs` | `errors.rs` (tax) | @ TaxError::InvalidAmmProgram on address constraint | WIRED | address = amm_program_id() @ TaxError::InvalidAmmProgram at line 423 |
| `swap_sol_buy.rs` | `errors.rs` (tax) | @ TaxError::InvalidStakingProgram on address constraint | WIRED | address = staking_program_id() @ TaxError::InvalidStakingProgram at line 437 |
| `tests/security-account-validation.ts` | programs (Tax + Epoch) | 20 adversarial tests calling real program instructions | WIRED | All 20 tests pass: 6 SEC-01, 9 SEC-02, 3 SEC-03, 2 SEC-07 |

### Bare Constraint Scan

All four grep checks for bare constraints return empty (no matches):

| Grep Pattern | Result |
|-------------|--------|
| `owner = SWITCHBOARD_PROGRAM_ID` without `@` | ZERO matches — all 3 have custom errors |
| `address = amm_program_id()` without `@` | ZERO matches — all 5 have custom errors |
| `address = tax_program_id()` without `@` | ZERO matches — both have custom errors |
| `address = staking_program_id()` without `@` | ZERO matches — all have custom errors |

### Requirements Coverage

| Requirement | Status | Notes |
|-------------|--------|-------|
| SEC-01: Fake staking_escrow/carnage_vault/treasury rejected in swap_sol_buy/sell | SATISFIED | 6 tests pass; seeds constraints use constraint=true @ pattern for error documentation |
| SEC-02: Fake amm_program (5 Tax instructions) + fake tax_program/amm_program (Carnage) + fake staking_program rejected | SATISFIED | 9 tests pass; all address constraints have @ custom error |
| SEC-03: Non-Switchboard randomness_account rejected in trigger/consume/retry | SATISFIED | 3 tests pass; owner constraints confirmed |
| SEC-07: Wrong-owner carnage_wsol rejected in execute_carnage_atomic/execute_carnage | SATISFIED | 2 tests pass; custom constraint confirmed |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | - | - | - | No blockers or warnings found |

**Note on seeds constraint pattern:** The `constraint = true @ TaxError::InvalidStakingEscrow` pattern is a deliberate design decision documented in SUMMARY.md. Anchor 0.32.1 does not support `@` directly on `seeds` sub-constraints. The `constraint = true` is always true (never fails independently), but documents the error intent and exposes the variant in the IDL. The actual seeds validation fires via the built-in ConstraintSeeds mechanism. This is not a bug — the test confirms the constraint still rejects fake accounts (with either InvalidStakingEscrow or ConstraintSeeds depending on Anchor evaluation order). The tests accept both error codes.

### Test Run Output

```
  Account Validation Security

    SEC-01: Tax Distribution Destinations
      ✓ rejects fake staking_escrow in swap_sol_buy (530ms)
      ✓ rejects fake staking_escrow in swap_sol_sell (508ms)
      ✓ rejects fake carnage_vault in swap_sol_buy (539ms)
      ✓ rejects fake carnage_vault in swap_sol_sell (523ms)
      ✓ rejects fake treasury in swap_sol_buy (532ms)
      ✓ rejects fake treasury in swap_sol_sell (502ms)
    SEC-02: CPI Program Targets
      ✓ rejects fake amm_program in swap_sol_buy
      ✓ rejects fake amm_program in swap_sol_sell
      ✓ rejects fake amm_program in swap_exempt (493ms)
      ✓ rejects fake amm_program in swap_profit_buy
      ✓ rejects fake amm_program in swap_profit_sell
      ✓ rejects fake tax_program in execute_carnage_atomic (514ms)
      ✓ rejects fake amm_program in execute_carnage_atomic (515ms)
      ✓ rejects fake staking_program in consume_randomness (1039ms)
      ✓ rejects fake staking_program in swap_sol_buy
    SEC-03: VRF Randomness Owner
      ✓ rejects non-Switchboard randomness in trigger_epoch_transition (1018ms)
      ✓ rejects non-Switchboard randomness in consume_randomness (1031ms)
      ✓ rejects non-Switchboard randomness in retry_epoch_vrf (1057ms)
    SEC-07: Carnage WSOL Ownership
      ✓ rejects wrong-owner carnage_wsol in execute_carnage_atomic (1555ms)
      ✓ rejects wrong-owner carnage_wsol in execute_carnage (1527ms)

  20 passing (17s)
```

## Gaps Summary

No gaps. All 5 observable truths verified. All 14 required artifacts exist, are substantive, and are wired. All 4 bare constraint grep checks return zero matches. 20/20 adversarial tests pass on a live local validator with programs deployed.

---

_Verified: 2026-02-18T22:46:38Z_
_Verifier: Claude (gsd-verifier)_
