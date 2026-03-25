# VulnHunter Security Audit Report

**Project:** Dr. Fraudsworth's Finance Factory
**Date:** 2026-03-05
**Auditor:** VulnHunter (Claude Opus 4.6) - 7 parallel audit agents
**Scope:** All 7 core on-chain programs (~90 Rust source files)
**Programs:** AMM, Tax Program, Epoch Program, Staking, Transfer Hook, Conversion Vault, Bonding Curve

---

## Executive Summary

7 parallel security agents audited the entire on-chain codebase covering arithmetic safety, access control, PDA validation, CPI safety, state machine logic, MEV resistance, and Token-2022 integration. The audit identified **2 critical**, **4 high**, **16 medium**, **14 low**, and **18 informational** findings across all programs.

**The most urgent findings are:**
1. Bonding Curve admin instructions (including SOL withdrawal) have NO authority validation - any signer can drain graduated curve vaults
2. Staking cooldown mechanism is defined but never enforced - mercenary capital attack is fully open
3. Carnage mechanism can be permanently suppressed by omitting an optional account
4. Multiple mainnet placeholder addresses default to `Pubkey::default()` (System Program) which would burn funds

**Positive observations:** Zero `unsafe` blocks, 166 `checked_*` operations, strong VRF anti-reroll protections, proper CEI ordering in staking, effective AMM reentrancy guard, and solid Transfer Hook layered defenses.

---

## Findings Summary

| Severity | Count | Breakdown |
|----------|-------|-----------|
| Critical | 2 | STAKE-001, BOND-002 |
| High | 4 | TAX-005, STAKE-004, VAULT-001, VAULT-005 |
| Medium | 13 | TAX-001, TAX-004, TAX-006, EPOCH-001, EPOCH-003, EPOCH-006, EPOCH-011, BOND-001, BOND-003, BOND-004, BOND-007, VAULT-004, VAULT-007 |
| Low | 12 | TAX-002, TAX-003, EPOCH-002, EPOCH-004, EPOCH-008, EPOCH-009, EPOCH-010, BOND-005, BOND-006, BOND-011, HOOK-001, HOOK-003 |
| Informational | 14 | Various |

---

## CRITICAL Findings

### STAKE-001: Cooldown Mechanism Defined But Never Enforced

**Severity:** CRITICAL
**Program:** Staking
**Files:** `instructions/claim.rs`, `instructions/unstake.rs`, `state/user_stake.rs:52`, `constants.rs:46`, `errors.rs:116`

The `UserStake` struct has `last_claim_ts: i64`, `COOLDOWN_SECONDS = 43,200` (12 hours) is defined, and `CooldownActive` error exists. However, **no instruction ever reads, writes, or checks these values**. The field stays at 0 permanently.

**Attack:** Mercenary capital can stake large PROFIT position, wait for `update_cumulative` (epoch yield distribution), claim rewards, and immediately unstake - all within seconds. Zero lockup risk. The 12-hour cooldown was designed specifically to prevent this.

**Fix:** In `claim.rs` after SOL transfer: `user.last_claim_ts = clock.unix_timestamp`. In `unstake.rs` before balance checks:
```rust
if user_stake.last_claim_ts > 0 {
    require!(clock.unix_timestamp - user_stake.last_claim_ts >= COOLDOWN_SECONDS, StakingError::CooldownActive);
}
```

**Design decision needed:** Unstake auto-claims rewards. Should auto-claim also set `last_claim_ts`? If yes, partial unstake blocks further unstakes for 12h.

> **RESOLVED (Phase 1-6):** Unstake now **forfeits** pending rewards (added to `pool.pending_rewards` for remaining stakers) instead of auto-claiming. Cooldown is enforced only after `claim` — users who never claimed can unstake immediately.

---

### BOND-002: `withdraw_graduated_sol` Drainable by Any Signer

**Severity:** CRITICAL
**Program:** Bonding Curve
**File:** `instructions/withdraw_graduated_sol.rs:28, 80-81`

After both curves graduate, this instruction transfers the entire SOL vault balance to whichever wallet signs as `authority`. There is NO check that the signer is the protocol deployer. `CurveState` does not store an `authority` field.

**Attack:** After graduation, anyone calls `withdraw_graduated_sol` with their wallet as authority. Receives ~1000 SOL per curve (~2000 SOL total). The legitimate admin's subsequent call returns 0.

**Fix:** Add `authority: Pubkey` field to `CurveState`, set during `initialize_curve`, and add `has_one = authority` constraint to all admin instructions: `withdraw_graduated_sol`, `prepare_transition`, `close_token_vault`, `start_curve`, `fund_curve`.

---

## HIGH Findings

### TAX-005: Mainnet Treasury Defaults to System Program (Burns Funds)

**Program:** Tax Program
**File:** `constants.rs:140-145`

Without `devnet` feature, `treasury_pubkey()` returns `Pubkey::default()` (System Program). 5% of all tax revenue sent there is irrecoverable.

**Fix:** Replace with `compile_error!("MAINNET TREASURY ADDRESS NOT SET")`.

### STAKE-004: Event Field Name Mismatch Blocks Compilation

**Program:** Staking
**Files:** `events.rs:76` (`rewards_forfeited`), `instructions/unstake.rs:238` (`rewards_claimed`)

The `Unstaked` struct field name doesn't match the emit site. This prevents `anchor build`. Likely from commit `fab1e9f` where one location was renamed but not the other.

**Fix:** Rename `rewards_forfeited` to `rewards_claimed` in `events.rs`.

### VAULT-001: User Token Accounts Lack Ownership/Mint Constraints

**Program:** Conversion Vault
**File:** `instructions/convert.rs:22-27`

`user_input_account` and `user_output_account` have only `mut` constraint. No `token::authority = user` or `token::mint` validation. Token-2022's authority check prevents exploitation, but the program relies entirely on external validation.

**Fix:** Add `token::authority = user, token::mint = input_mint` constraints.

### VAULT-005: Mainnet Mint Placeholders Are Pubkey::default()

**Program:** Conversion Vault
**File:** `constants.rs:31-53`

Same pattern as TAX-005. All three mint functions return `Pubkey::default()` without `devnet` feature.

**Fix:** Replace with `compile_error!()`.

---

## MEDIUM Findings

### TAX-001: Sell Flow Passes `minimum_amount_out = 0` to AMM CPI

**File:** `swap_sol_sell.rs:147` | The sell handler hardcodes zero slippage for the AMM CPI. While the Tax Program checks slippage post-CPI, the AMM executes the swap unprotected. Sandwich attacks succeed if users set loose minimums (above 50% floor).

### TAX-004: Intermediary Init Does Not Validate Mint is NATIVE_MINT

**File:** `initialize_wsol_intermediary.rs:116-118` | Combined with TAX-003 (no admin gate), an attacker could create the intermediary PDA with a non-WSOL mint, permanently DoS'ing all sell operations.

### TAX-006: No Validation epoch_state is Canonical Singleton PDA

**File:** `swap_sol_buy.rs:368, swap_sol_sell.rs:503` | Owner+discriminator check passes but doesn't verify PDA derivation. Stale/alternate EpochState with different tax rates could be substituted if Epoch Program ever migrates.

### EPOCH-001: Bounty Payment Can Drain sol_vault Below Rent-Exempt

**File:** `trigger_epoch_transition.rs:194-227` | Bounty check doesn't subtract rent-exempt minimum. Could garbage-collect the vault PDA. Known issue, mitigated by crank auto-top-up.

### EPOCH-003: Optional carnage_state Allows Permanent Carnage Suppression

**File:** `consume_randomness.rs:76-80, 269-315` | Since `consume_randomness` is permissionless and `carnage_state` is Optional, any frontrunner can call it without the carnage account, permanently disabling the buyback-and-burn mechanism.

**Fix:** Make `carnage_state` required (or add `carnage_enabled` flag that rejects calls without it once set).

### EPOCH-006: Pool Accounts Not Validated Before Slippage Calculation

**File:** `execute_carnage.rs:117-143` | Unchecked `AccountInfo` pools are read for slippage before AMM validates them via CPI. Fake pool data could bypass slippage floor (though AMM CPI would then reject).

### EPOCH-011: stake_pool Passed Unchecked to Staking CPI

**File:** `consume_randomness.rs:65-66` | Mutable AccountInfo with no owner/seeds validation. If staking has any validation gap, arbitrary account could be written to.

### BOND-001: Missing Authority Validation on All Admin Instructions

**File:** Multiple | All "admin" instructions accept bare `Signer<'info>` with no stored authority check. See BOND-002 for the critical exploitation path.

### BOND-003: External Token Holders Can Sell Into the Curve

**File:** `sell.rs:129-157` | No check that sellers purchased from the curve. Tokens acquired below curve price (secondary market) can be sold for full integral value minus 15% tax.

### BOND-004: Double Ceil-Rounding on Sell Path

**File:** `math.rs:187-190, sell.rs:174-179` | `calculate_sol_for_tokens` ceil rounds (vault-unfavored on sells), then tax also ceil rounds. Net effect: ~1 lamport leakage per sell. Not economically viable to exploit due to 15% tax.

### BOND-007: Sandwich Attack Vector on Purchase

**File:** `purchase.rs` | Bonding curve price is deterministic. Sandwich possible via Jito bundles. Mitigated by `minimum_tokens_out` parameter and 15% sell tax making the sell leg very expensive for attackers.

### VAULT-004: Hook Account Split Assumes Symmetric Counts

**File:** `convert.rs:140-142` | `remaining.len() / 2` split breaks if mints have different hook configurations. Currently safe (all mints use 4 hook accounts).

### VAULT-007: Localnet Feature Bypasses Mint Validation

**File:** `initialize.rs:63,69,77` | `localnet` feature allows any mint. If accidentally enabled in production build, vault could be initialized with attacker-controlled mints.

---

## LOW Findings

| ID | Program | Summary |
|----|---------|---------|
| TAX-002 | Tax | No pool owner validation in `read_pool_reserves` (AMM rejects downstream) |
| TAX-003 | Tax | `initialize_wsol_intermediary` has no admin access control |
| EPOCH-002 | Epoch | Epoch number can skip multiple boundaries if crank offline |
| EPOCH-004 | Epoch | `force_carnage` doesn't set `carnage_lock_slot` (devnet only) |
| EPOCH-008 | Epoch | Pending Carnage silently overwritten if new epoch triggers Carnage |
| EPOCH-009 | Epoch | Epoch number u32 overflows in ~244K years |
| EPOCH-010 | Epoch | `mint_a` not validated as NATIVE_MINT |
| BOND-005 | Bonding | Solvency check weakened by `saturating_sub` |
| BOND-006 | Bonding | `prepare_transition` doesn't validate Crime/Fraud ordering |
| BOND-011 | Bonding | Mainnet mint placeholders use `Pubkey::default()` |
| HOOK-001 | Hook | Burned authority idempotency skips signer check |
| HOOK-003 | Hook | `initialize_authority` is first-caller-wins |

---

## INFORMATIONAL Findings

| ID | Program | Summary |
|----|---------|---------|
| TAX-007 | Tax | Token programs not constrained to specific IDs (AMM catches) |
| TAX-008 | Tax | EpochState layout drift risk (cross-program struct) |
| TAX-009 | Tax | `swap_exempt` zero slippage by design |
| TAX-010 | Tax | Sell output floor rarely binding at high tax |
| TAX-011 | Tax | Tax floor rounding favors user (correct direction) |
| EPOCH-005 | Epoch | No modular bias in VRF tax derivation (confirmed fair) |
| EPOCH-007 | Epoch | `carnage_target` not cleared on expire |
| EPOCH-012 | Epoch | VRF anti-reroll protection is sound |
| EPOCH-013 | Epoch | Code duplication between atomic/fallback carnage paths |
| STAKE-007 | Staking | No close instruction for abandoned UserStake accounts |
| STAKE-008 | Staking | `init_if_needed` usage confirmed safe |
| HOOK-002 | Hook | No whitelist entry removal mechanism (by design) |
| HOOK-004 | Hook | `find_program_address` in transfer hot path |
| BOND-008/009/010 | Bonding | Silent overflow fallback, refund dust, fund_curve idempotency |

---

## Cross-Program CPI Security Assessment

All CPI targets have validated program IDs. Cross-program PDA seeds are consistent across all programs. AMM reentrancy guard is properly implemented. Transfer Hook has three layers of defense (transferring flag, mint owner check, PDA derivation).

**One notable pattern:** Tax Program, Epoch Program, and Conversion Vault all read pool data from unvalidated `AccountInfo` accounts before passing them to AMM CPI. The AMM validates via PDA seeds, preventing exploitation. Adding `owner = amm_program_id()` constraints would provide defense-in-depth.

---

## Priority Remediation Roadmap

### Before ANY Deployment with Real Funds
1. **BOND-002 + BOND-001:** Add `authority` field to `CurveState` and gate all admin instructions
2. **STAKE-001:** Wire up cooldown enforcement in claim/unstake
3. **STAKE-004:** Fix event field name mismatch

### Before Mainnet
4. **TAX-005 / VAULT-005 / BOND-011:** Replace all `Pubkey::default()` mainnet placeholders with `compile_error!()`
5. **EPOCH-003:** Make `carnage_state` required in `consume_randomness`
6. **VAULT-001:** Add token account ownership/mint constraints to Conversion Vault
7. **TAX-004:** Add NATIVE_MINT validation to intermediary initialization
8. **EPOCH-001:** Add rent-exempt guard to bounty payment
9. **EPOCH-006 / EPOCH-011:** Add owner validation to pool and stake_pool accounts

### Recommended Hardening
10. **TAX-001:** Compute tighter AMM minimum on sell path
11. **TAX-006:** Use PDA seeds validation for epoch_state instead of manual owner check
12. **HOOK-003:** Gate `initialize_authority` to known admin
13. **VAULT-004:** Pass hook split index as instruction argument

---

## Methodology

- 7 parallel VulnHunter agents audited each program independently
- 1 cross-cutting CPI agent analyzed all inter-program interactions
- Manual analysis of arithmetic patterns (336 `.unwrap()`, 166 `checked_*`, 39 `saturating_*`, 0 `unsafe`)
- Variant hunting across all `as u64` casts and `remaining_accounts` usage
- Transfer Hook bypass analysis
- State machine transition verification
- Bonding curve math invariant checking

**Total findings: 54** (2 Critical, 4 High, 16 Medium, 14 Low, 18 Informational)

---

## AMM Findings (Late-arriving agent)

### AMM-001: Reserve Desynchronization Risk with Token-2022 Transfer Fees

**Severity:** Medium
**File:** `instructions/swap_sol_pool.rs:132, 163-185`

Pool reserves track nominal `amount_in`/`amount_out`, not actual vault balances. If Token-2022 `TransferFeeConfig` is ever added to a mint, received amounts would differ from credited reserves, causing drift. Currently safe since no mints have this extension.

**Fix:** After transfers, `reload()` vault accounts and reconcile reserves. Or reject mints with `TransferFeeConfig` during `initialize_pool`.

### AMM-002: No Minimum Seed Liquidity

**Severity:** Medium
**File:** `instructions/initialize_pool.rs:48`

Pool can be initialized with 1 lamport per side. Dust initialization allows massive first-swap price manipulation. Admin-only instruction mitigates external risk.

**Fix:** Enforce `amount_a >= MIN_SEED && amount_b >= MIN_SEED`.

### AMM-003: Reentrancy Guard Per-Pool Only

**Severity:** Low
**File:** `instructions/swap_sol_pool.rs:84, 322, 381`

`pool.locked` prevents same-pool reentrancy but not cross-pool. Mitigated by `swap_authority` PDA requirement (only Tax Program can swap).

### AMM-004: Carnage swap_exempt Uses minimum_amount_out=0

**Severity:** Medium (documented as accepted risk)
**File:** `swap_exempt.rs:111`

Carnage swaps have zero slippage protection. Sandwichable via Jito bundles. Protocol capital at risk.

### AMM-005 through AMM-009: Informational

- AMM-005: `initialize_admin` constraint lacks custom error
- AMM-006: Source token accounts lack explicit ownership constraint (Token program enforces)
- AMM-007: INIT_SPACE comment outdated
- AMM-008: LP fee includes rounding dust (protocol-favorable, correct)
- AMM-009: Duplicate mints check redundant with ordering check
