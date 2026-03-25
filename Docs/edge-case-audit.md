# Edge Case Audit Report

Date: 2026-03-08
Scope: All 7 on-chain programs
Phase: 86 (Test Coverage Sweep)

## Summary

- 8 HIGH gaps identified (8 implemented)
- 12 MEDIUM gaps identified (12 implemented)
- 9 LOW gaps documented

## Program: AMM

### Existing Coverage
- **test_cpi_access_control.rs** (7 tests): swap_authority PDA validation, direct call rejection, fake program PDA rejection, full CPI chain with T22 hooks
- **test_pool_initialization.rs** (13 tests): canonical mint ordering, zero seed amounts, duplicate mints, admin auth, LP fee cap, PDA determinism, pool type inference
- **test_swap_sol_pool.rs** (8 tests): basic swap, direction routing, slippage protection, reentrancy guard, zero amount, reserve updates, k-invariant
- **test_transfer_routing.rs** (7 tests): T22 transfer_checked, SPL transfer, mixed-pool routing, hook account passthrough
- **math.rs** (inline, 24 tests): fee calculation, swap output, k-invariant, proptest (10K iterations for k-invariant, output bounds, fee monotonicity)

### Gaps Found

| ID | Risk | Description | Status |
|----|------|-------------|--------|
| AMM-01 | MEDIUM | Zero effective input from dust amount (amount_in=1, fee=100bps -> effective=0 -> ZeroEffectiveInput) never tested at instruction level via LiteSVM | Tested |
| AMM-02 | MEDIUM | ZeroSwapOutput error path never tested at instruction level (small effective_input relative to large reserves -> 0 output) | Tested |
| AMM-03 | LOW | LP fee at exact MAX_LP_FEE_BPS (500) boundary already tested in pool init but not swap behavior at 5% fee | Documented |
| AMM-04 | LOW | Concurrent swap direction (AtoB then BtoA) in same pool within same test not verified | Documented |

## Program: Tax Program

### Existing Coverage
- **test_carnage_signer_pda.rs** (4 tests): PDA derivation consistency
- **test_swap_exempt.rs** (7 tests): exempt swap CPI, discriminator validation, unauthorized caller rejection
- **test_swap_sol_buy.rs** (8 tests): buy flow with tax deduction, slippage, floor enforcement, zero input
- **test_swap_sol_sell.rs** (6 tests): sell flow with tax deduction, treasury/staking/carnage splits, slippage floor

### Gaps Found

| ID | Risk | Description | Status |
|----|------|-------------|--------|
| TAX-01 | HIGH | InsufficientOutput error path untested (tax >= gross output on small sell amounts, TaxError::InsufficientOutput) | Tested |
| TAX-02 | MEDIUM | MinimumOutputFloorViolation error path untested at instruction level (user sets minimum_output below 50% protocol floor) | Tested |
| TAX-03 | MEDIUM | InvalidPoolOwner error path untested (pool account not owned by AMM program -- spoofed pool attack) | Tested |
| TAX-04 | LOW | Tax calculation with u64::MAX input values (overflow path) | Documented |

## Program: Epoch Program

### Existing Coverage
- **trigger_epoch_transition.rs** (inline, 13 tests): epoch boundary detection, epoch number calculation, start slot calculation, saturating_sub safety, epoch consistency
- No integration test files exist in tests/ directory

### Gaps Found

| ID | Risk | Description | Status |
|----|------|-------------|--------|
| EPOCH-01 | HIGH | No integration tests exist for any epoch instruction -- entire program relies on inline unit tests for helper functions only | Tested |
| EPOCH-02 | HIGH | current_epoch with u64::MAX slot value (overflow in division cast to u32) untested | Tested |
| EPOCH-03 | MEDIUM | epoch_start_slot with u32::MAX epoch (overflow in multiplication: u32::MAX * SLOTS_PER_EPOCH) untested | Tested |
| EPOCH-04 | LOW | Double trigger rejection (VrfAlreadyPending) only documented, never exercised in test | Documented |

## Program: Staking

### Existing Coverage
- **math.rs** (inline, 22 tests + 6 proptests): add_to_cumulative, reward calculation formula, truncation, conservation, monotonicity, multi-epoch accumulation, dust handling
- **update_cumulative.rs** (inline, 8 tests): reward_per_token calculation, zero pending, dead stake div-zero prevention, small rewards precision, max values, cumulative addition, epoch comparison
- No integration test files exist in tests/ directory

### Gaps Found

| ID | Risk | Description | Status |
|----|------|-------------|--------|
| STAK-01 | HIGH | Cooldown gate in unstake never tested (CooldownActive error path: unstake within COOLDOWN_SECONDS after claim) | Tested |
| STAK-02 | HIGH | Partial unstake auto-full-unstake logic never tested (remaining < MINIMUM_STAKE triggers full unstake) | Tested |
| STAK-03 | MEDIUM | update_rewards with extreme reward_delta values that would overflow u128 in balance * delta multiplication | Tested |
| STAK-04 | MEDIUM | Reward forfeiture on unstake (rewards_earned > 0 when unstaking -> forfeited to pool.pending_rewards) never explicitly verified at formula level with state tracking | Tested |
| STAK-05 | LOW | Zero-amount stake rejection (ZeroAmount error) documented but no integration test | Documented |

## Program: Transfer Hook

### Existing Coverage
- **test_transfer_hook.rs** (10 tests): All tests are requirement documentation tests using `assert!(true)` -- no actual validation. Setup helpers exist but are unused. Discriminator constant verified.

### Gaps Found

| ID | Risk | Description | Status |
|----|------|-------------|--------|
| HOOK-01 | HIGH | is_whitelisted function logic never tested with actual PDA derivation -- only documented as requirement | Tested |
| HOOK-02 | MEDIUM | WhitelistEntry PDA derivation verification with wrong seed (spoofed PDA) never tested | Tested |
| HOOK-03 | LOW | check_mint_owner function never unit tested (defense-in-depth) | Documented |

## Program: Conversion Vault

### Existing Coverage
- **test_vault.rs** (13 tests): All 4 conversion directions, zero amount rejection, dust rejection, dust boundary acceptance, wrong mint pair, same mint, large amounts, PDA derivation, VaultConfig size, conversion rate constant

### Gaps Found

| ID | Risk | Description | Status |
|----|------|-------------|--------|
| VAULT-01 | MEDIUM | PROFIT->CRIME overflow with u64::MAX input (checked_mul with CONVERSION_RATE=100 should return MathOverflow) never tested | Tested |
| VAULT-02 | MEDIUM | Unknown mint (not CRIME, FRAUD, or PROFIT) produces InvalidMintPair -- tested for CRIME->FRAUD but not for completely unknown mint | Tested |
| VAULT-03 | LOW | VaultConfig localnet vs production code path divergence | Documented |

## Program: Bonding Curve

### Existing Coverage
- **refund_clock_test.rs** (12 tests): Refund lifecycle, clock manipulation, proportional refunds, double-claim rejection
- **dual_curve_test.rs** (4 tests): One-sided fill rejection, grace period purchase blocking, multi-claimant refund, vault insolvency guard
- **boundary_test.rs** (9 tests): Dust purchase at 1-token-remaining, zero-tokens-out rejection, reversed mint reserves, boundary solvency

### Gaps Found

| ID | Risk | Description | Status |
|----|------|-------------|--------|
| BC-01 | HIGH | Per-wallet cap enforcement (WalletCapExceeded) never tested -- 20M token cap per wallet on purchase | Tested |
| BC-02 | MEDIUM | BelowMinimum error (purchase below MIN_PURCHASE_SOL = 0.05 SOL) never tested at instruction level | Tested |
| BC-03 | MEDIUM | InvalidHookAccounts error (remaining_accounts != 4) never tested | Tested |
| BC-04 | LOW | CurveAlreadyFilled error path (purchase after curve filled) | Documented |

## Recommendations for Mainnet

### Systemic Observations

1. **Epoch Program and Staking have zero integration tests**: Both programs rely entirely on inline unit tests for helper functions. The actual instruction handlers (trigger_epoch_transition, stake, claim, unstake) have never been exercised through LiteSVM. The math is well-tested but account validation, PDA constraints, and CPI gating are uncovered. The edge case tests added here cover the most critical paths.

2. **Transfer Hook tests are documentation-only**: All 10 existing tests use `assert!(true)` with comments describing requirements. The setup helpers for LiteSVM exist but are unused. The is_whitelisted function's PDA derivation logic is the most critical untested path and is covered by the edge case tests added here.

3. **Tax Program pool reader validation**: The InvalidPoolOwner defense-in-depth check added in Phase 80 was never tested. This is critical for preventing spoofed pool attacks on the slippage floor.

4. **All programs have strong math test coverage**: AMM, Staking, and Bonding Curve all have comprehensive proptest suites (10K+ iterations) covering arithmetic safety. The gaps identified are primarily in error path coverage and instruction-level integration testing.

5. **Security-critical patterns are well-implemented**: CEI ordering, checked arithmetic, PDA validation, and reentrancy guards are consistently applied across all programs. The untested edge cases are primarily defensive error paths rather than fundamental security flaws.
