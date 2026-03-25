# Stronghold of Security -- Final Audit Report

**Audit ID:** `sos-001-20260222-be95eba`
**Git Ref:** `be95eba`
**Date:** 2026-02-22
**Scope:** 5 Anchor Programs, ~30,066 Lines of Code (Rust)
**Tier:** Deep (142 attack hypotheses investigated)
**Auditor:** Stronghold of Security (Automated Adversarial Audit)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Severity Breakdown](#2-severity-breakdown)
3. [Methodology](#3-methodology)
4. [Critical Findings](#4-critical-findings)
5. [High Findings](#5-high-findings)
6. [Medium Findings](#6-medium-findings)
7. [Low Findings](#7-low-findings)
8. [Potential Findings](#8-potential-findings)
9. [Mitigated Findings](#9-mitigated-findings)
10. [Combination Attack Analysis](#10-combination-attack-analysis)
11. [Attack Trees](#11-attack-trees)
12. [Severity Re-Calibration Notes](#12-severity-re-calibration-notes)
13. [Coverage Summary](#13-coverage-summary)
14. [Recommendations](#14-recommendations)
15. [Appendix A: Full Findings Index](#appendix-a-full-findings-index)
16. [Appendix B: Not Vulnerable Summary](#appendix-b-not-vulnerable-summary)
17. [Appendix C: Exploit Pattern Cross-Reference](#appendix-c-exploit-pattern-cross-reference)

---

## 1. Executive Summary

This report presents the results of a deep adversarial security audit of the Dr. Fraudsworth Finance Factory protocol -- a faction-based memecoin/yield farm built on Solana using Anchor 0.32.1 and Token-2022. The protocol comprises five on-chain programs: AMM (constant-product DEX), Tax Program (trade routing with VRF-driven dynamic tax), Epoch Program (epoch lifecycle with Switchboard VRF and Carnage fund management), Transfer Hook (Token-2022 whitelist enforcement), and Staking (PROFIT token staking with SOL yield distribution).

The audit generated 142 attack hypotheses across 11 categories, derived from 128 exploit patterns, 3 protocol-specific playbooks, and 9 parallel analysis agents. All 142 hypotheses were investigated to completion.

### Key Metrics

| Metric | Value |
|--------|-------|
| Total Hypotheses Investigated | 142 |
| Confirmed Vulnerabilities | 15 |
| Potential Vulnerabilities | 11 |
| Mitigated (with workaround) | 3 |
| Duplicates | 2 |
| Not Vulnerable | 111 |
| Instruction Coverage | 38/38 (100%) |
| Exploit Pattern Coverage | 13/13 (100%) |
| Cross-Program Vector Coverage | 5/5 (100%) |

### Severity Distribution (Confirmed Only)

| Severity | Count | Findings |
|----------|-------|----------|
| **Critical** | 3 | H001, H113, S005 |
| **High** | 3 | H041, S001, S010 |
| **Medium** | 7 | H011, H043, H057, H060, H064, H106, H125 |
| **Low** | 2 | H090, H119 |

### Protocol Risk Assessment

The Dr. Fraudsworth protocol demonstrates **strong foundational security** with consistent use of checked arithmetic, PDA-based authority chains, and proper CPI validation. The three Critical findings (H001, H113, S005) all represent **pre-mainnet deployment issues** that must be resolved before launch. No confirmed finding enables direct pool drainage or immediate fund theft from user wallets during normal operation.

The primary risk vectors are:

1. **Initialization security** -- Three programs accept any signer for initialization, creating a front-running window during deployment (S005, H003).
2. **Rent-exempt accounting** -- Bounty and staking escrow transfers fail to account for the rent-exempt minimum, creating protocol liveness risks (H001, S001).
3. **Mint authority retention** -- All three custom token mints retain active mint authorities, creating an infinite-supply risk (H113).

The 15 confirmed findings represent a finding density of **0.50 per 1,000 LoC**, which is below the Sec3 2025 benchmark of 0.58 findings per 1,000 LoC for Solana protocols. The distribution of 3 Critical / 3 High / 7 Medium / 2 Low is consistent with a pre-mainnet codebase that has undergone internal testing but has not yet had a formal external audit.

---

## 2. Severity Breakdown

### Confirmed Findings by Program

| Program | Critical | High | Medium | Low | Total |
|---------|----------|------|--------|-----|-------|
| Epoch Program | 1 | 1 | 3 | 2 | 7 |
| Transfer Hook | 1 | 0 | 0 | 0 | 1 |
| Tax Program | 0 | 1 | 1 | 0 | 2 |
| Staking | 0 | 1 | 0 | 0 | 1 |
| AMM | 0 | 0 | 2 | 0 | 2 |
| Deployment Scripts | 1 | 0 | 0 | 0 | 1 |
| Cross-Program | 0 | 0 | 1 | 0 | 1 |
| **Total** | **3** | **3** | **7** | **2** | **15** |

### Impact Matrix (Confirmed Findings)

| Finding | Fund Loss | Protocol Liveness | Economic | Governance |
|---------|-----------|-------------------|----------|------------|
| H001 | -- | CRITICAL | -- | -- |
| H113 | CRITICAL | -- | CRITICAL | -- |
| S005 | -- | CRITICAL | -- | CRITICAL |
| H041 | HIGH | -- | HIGH | -- |
| S001 | -- | HIGH | -- | -- |
| S010 | -- | HIGH | -- | -- |
| H011 | -- | -- | MEDIUM | -- |
| H043 | -- | -- | MEDIUM | -- |
| H057 | -- | LOW | -- | -- |
| H060 | -- | MEDIUM | -- | -- |
| H064 | -- | INFO | -- | -- |
| H106 | -- | -- | MEDIUM | -- |
| H125 | -- | -- | -- | MEDIUM |
| H090 | -- | -- | LOW | -- |
| H119 | -- | LOW | -- | -- |

---

## 3. Methodology

### Audit Pipeline

The Stronghold of Security audit follows a 6-phase pipeline:

1. **Scan (Phase 0):** Static analysis via Semgrep (160 findings), codebase indexing (101 files, 7,900 LoC indexed at granular level), and hotspot identification (280 hotspots across 99 files).

2. **Analyze (Phase 1):** Nine parallel analysis agents examined the codebase through specialized lenses:
   - 01_access_control (score: 88/100)
   - 02_arithmetic (score: 85/100)
   - 03_state_machine (score: 86/100)
   - 04_cpi_external (score: 87/100)
   - 05_token_economic (score: 83/100)
   - 06_oracle_data (score: 84/100)
   - 07_upgrade_admin (score: 82/100)
   - 08_timing_ordering (score: 85/100)
   - 09_economic_model (score: 81/100)
   - Average quality score: 84.6/100 (passed quality gate)

3. **Strategize (Phase 2):** Architecture synthesis and hypothesis generation produced 142 attack strategies:
   - 18 Tier 1 (Critical priority)
   - 42 Tier 2 (High priority)
   - 72 Tier 3 (Medium-Low priority)
   - 10 Supplemental (generated from Tier 1 findings)
   - 31 novel strategies (23.5%) with no direct exploit pattern precedent

4. **Investigate (Phase 4):** All 142 strategies investigated in 28 batches of 5. Each investigation produces a standalone finding document with evidence, impact assessment, attack scenario analysis, and remediation guidance.

5. **Coverage (Phase 4.5):** Post-investigation verification ensures:
   - 100% instruction coverage (38/38 Anchor instructions examined)
   - 100% exploit pattern coverage (13/13 relevant patterns tested)
   - 100% cross-program vector coverage (5/5 CPI chains traced)
   - Zero critical or high coverage gaps

6. **Report (Phase 5):** Severity calibration, combination analysis, attack tree construction, and final synthesis (this document).

### Severity Definitions

| Severity | Impact | Likelihood | Description |
|----------|--------|------------|-------------|
| **Critical** | Catastrophic fund loss, protocol destruction, or permanent DoS | Medium to High | Requires immediate fix before any deployment |
| **High** | Significant fund loss, extended protocol disruption | Medium | Must be fixed before mainnet |
| **Medium** | Limited economic impact, temporary disruption, degraded security posture | Low to Medium | Should be fixed; acceptable risk if documented |
| **Low** | Negligible direct impact, informational | Low | Fix when convenient; operational concern only |

### Calibration Methodology

Severities are calibrated using:

1. **Impact x Likelihood Matrix** -- Standard 4x4 matrix mapping exploitability to damage
2. **Solana-Specific Considerations** -- Rent-exempt minimums, CPI depth limits, Token-2022 extension behavior, validator slot timing
3. **Protocol-Specific Context** -- Deploy-and-lock model, non-upgradeable programs, whitelist authority burn mechanism
4. **Sec3 2025 Benchmarks** -- 10.3 findings per audit average, 0.58 findings per 1,000 LoC

---

## 4. Critical Findings

### F-001: Bounty Transfer Drains Vault Below Rent-Exempt Minimum [H001]

**Severity:** CRITICAL
**Category:** Arithmetic / State Machine
**EP Reference:** EP-016 (Integer Underflow), EP-034 (Missing State Transition Check)

**Description:**
The `trigger_epoch_transition` instruction pays a 1,000,000 lamport (0.001 SOL) bounty from `carnage_sol_vault` to the epoch transition caller. The balance check (`vault_balance >= TRIGGER_BOUNTY_LAMPORTS`) does not account for the rent-exempt minimum of ~890,880 lamports required for a 0-data SystemAccount.

When the vault balance is in the "danger zone" of [1,000,000, 1,890,879] lamports, the check passes but the Solana runtime rejects the transfer with `InsufficientFundsForRent`, causing epoch advancement to fail permanently until the vault is externally replenished.

**Impact:**
- Permanent epoch transition deadlock
- Staking rewards freeze (no epoch advancement means no reward distribution)
- VRF randomness consumption blocked
- Carnage events cannot execute
- Protocol effectively halted

**Location:**
`programs/epoch-program/src/instructions/trigger_epoch_transition.rs:194-227`

```rust
let vault_balance = ctx.accounts.carnage_sol_vault.lamports();
let bounty_paid = if vault_balance >= TRIGGER_BOUNTY_LAMPORTS {
    invoke_signed(
        &system_instruction::transfer(..., TRIGGER_BOUNTY_LAMPORTS),
        ...
    )?;
    TRIGGER_BOUNTY_LAMPORTS
} else { 0 };
```

**Recommendation:**
Replace the balance check with a rent-aware version:
```
require!(vault_balance >= TRIGGER_BOUNTY_LAMPORTS + RENT_EXEMPT_MINIMUM)
```

Where `RENT_EXEMPT_MINIMUM` is the rent-exempt minimum for a 0-data SystemAccount (890,880 lamports). Alternatively, use `Rent::get()?.minimum_balance(0)` for dynamic calculation.

---

### F-002: Mint Authorities Not Revoked on CRIME/FRAUD/PROFIT [H113]

**Severity:** CRITICAL
**Category:** Token Economic / Governance
**EP Reference:** EP-068 (Single Admin Key), Custom (Token Authority Retention)

**Description:**
All three custom Token-2022 mints (CRIME, FRAUD, PROFIT) retain active mint authorities after deployment. The `initialize.ts` deployment script creates mints with `mintAuthority` set to the deployer wallet but never calls `setAuthority(AuthorityType.MintTokens, null)` to revoke minting capability. The deployer EOA (`8kPzhQoUPx7LYM18f9TzskW4ZgvGyq4jMPYZikqmHMH4`) can call `mintTo` at any time to create unlimited tokens.

**Impact:**
- Infinite supply minting capability
- Complete destruction of tokenomics
- Deflationary burn mechanism rendered meaningless
- User trust violation (users assume capped supply)

**Location:**
`scripts/deploy/initialize.ts:256-262` -- Mint creation without authority revocation

**Recommendation:**
Add authority revocation to `initialize.ts` after mint creation:
```typescript
await setAuthority(connection, payer, mint, payer, AuthorityType.MintTokens, null);
```

Perform this for all three mints (CRIME, FRAUD, PROFIT). Additionally:
- Add `freezeAuthority` revocation if not needed
- Verify revocation on-chain after deployment
- Add to mainnet checklist: "Verify mint authorities are null for all 3 mints"

---

### F-003: Transfer Hook initialize_authority Accepts Any Signer [S005]

**Severity:** CRITICAL
**Category:** Access Control / Initialization
**EP Reference:** EP-075 (Initialization Front-Running), EP-026 (Missing Authority Constraint)

**Description:**
The Transfer Hook program's `initialize_authority` instruction accepts any signer as the authority without verifying they hold the program's upgrade authority. An attacker who front-runs the legitimate deployment can:

1. Call `initialize_authority` with their own wallet as the authority
2. Claim permanent control over the whitelist
3. Block all token transfers by refusing to whitelist protocol vaults
4. Optionally call `burn_authority` to permanently prevent recovery

The AMM program's `initialize_admin` demonstrates the correct pattern: it constrains the authority signer against the program's `ProgramData.upgrade_authority_address`.

**Impact:**
- Protocol-wide DoS (no whitelist entries means no token transfers)
- Ransom opportunity (attacker offers to whitelist for payment)
- Permanent unrecoverable state if authority is burned by attacker
- All three faction tokens (CRIME, FRAUD, PROFIT) affected

**Location:**
`programs/transfer-hook/src/instructions/initialize_authority.rs:15-46`

```rust
pub struct InitializeAuthority<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,  // No upgrade authority check
    #[account(init, ...)]
    pub whitelist_authority: Account<'info, WhitelistAuthority>,
    // Missing: program, program_data accounts
}
```

**Recommendation:**
Add upgrade authority verification matching the AMM pattern:
```rust
#[account(constraint = program_data.upgrade_authority_address == Some(authority.key()))]
pub program_data: Account<'info, ProgramData>,
pub program: Program<'info, TransferHook>,
```

Apply the same fix to Epoch Program's `initialize_epoch_state` and Staking's `initialize_stake_pool`. Bundle all initialization calls in the same transaction as program deployment to minimize the front-running window.

---

## 5. High Findings

### F-004: No On-Chain Zero Slippage Enforcement [H041]

**Severity:** HIGH
**Category:** Token Economic / MEV Protection
**EP Reference:** EP-042 (Arbitrary CPI Program Substitution -- adapted), Custom (Missing Slippage Floor)

**Description:**
All four swap instructions (`swap_sol_buy`, `swap_sol_sell`, `swap_profit_buy`, `swap_profit_sell`) accept a `minimum_output` parameter that is only validated against a 50% floor (`output >= input * 50%`). The instructions do not reject `minimum_output = 0`, which means a compromised or malicious frontend can submit swaps with zero slippage protection, enabling unlimited MEV sandwich attacks.

**Impact:**
- Frontends setting `minimum_output = 0` expose users to unlimited sandwich attacks
- MEV bots can extract up to 49.99% of swap value (constrained only by the 50% floor)
- Users trusting a compromised frontend lose funds to MEV

**Location:**
`programs/tax-program/src/instructions/swap_sol_buy.rs:106-111` (and all 4 swap instructions)

```rust
let minimum_output_floor = amount_in
    .checked_div(2)
    .ok_or(TaxError::Overflow)?;
require!(
    minimum_output >= minimum_output_floor,
    TaxError::SlippageTooHigh
);
```

**Recommendation:**
Add explicit rejection of `minimum_output = 0`:
```rust
require!(minimum_output > 0, TaxError::ZeroMinimumOutput);
```

Consider also raising the 50% floor to 85-90% for typical swaps, or making it configurable per-pool. The existing 50% floor is generous for MEV extractors.

---

### F-005: Staking Escrow Rent-Exempt Drain [S001]

**Severity:** HIGH
**Category:** Arithmetic / State Machine
**EP Reference:** EP-016 (Integer Underflow), Same root cause as H001

**Description:**
The staking program's `claim` and `unstake` instructions transfer SOL from the `escrow_vault` (a 0-data SystemAccount PDA) using `try_borrow_mut_lamports` without checking that the remaining balance stays above the rent-exempt minimum. This is the same class of bug as H001 but affects the staking subsystem.

If `escrow_vault.lamports() - claim_amount < 890,880`, the Solana runtime rejects the transfer, but the error surface is broader than H001 because claim amounts vary per user (not a fixed constant).

**Impact:**
- Stakers unable to claim earned SOL rewards
- Unstake operations blocked if reward payout fails
- Cascading failure: if users cannot unstake, PROFIT tokens are locked

**Location:**
`programs/staking/src/instructions/claim.rs:100-150`
`programs/staking/src/instructions/unstake.rs:160-212`

**Recommendation:**
Before any lamport transfer from `escrow_vault`, verify:
```rust
let remaining = escrow_vault.lamports()
    .checked_sub(rewards_to_claim)
    .ok_or(StakingError::Underflow)?;
require!(remaining >= RENT_EXEMPT_MINIMUM, StakingError::InsufficientEscrowForRent);
```

If the vault cannot pay the full claim while remaining rent-exempt, pay the maximum possible and track the residual as pending.

---

### F-006: Epoch Recovery Requires Unavailable Admin Deposit [S010]

**Severity:** HIGH
**Category:** State Machine / Operational
**EP Reference:** EP-084 (Resource Exhaustion / DoS)

**Description:**
The `carnage_sol_vault` is funded exclusively by the 24% tax allocation from user swaps. There is no `deposit_to_vault` or similar admin instruction that allows direct SOL injection into the vault. If H001 triggers a deadlock (vault balance in the danger zone), recovery requires an external SOL transfer to the vault PDA -- but the only way to do this is via a raw `system_instruction::transfer` signed by an admin wallet.

If the admin key is lost, rotated, or if the team burns the admin before fixing H001, the protocol is permanently frozen.

**Impact:**
- No programmatic recovery path for H001 deadlock
- Dependency on admin key availability for emergency recovery
- Single point of failure combining H001 + admin key management

**Location:**
No instruction exists -- this is a missing-feature finding.
Vault PDA: `carnage_sol_vault` (seeds: `[b"carnage_sol_vault"]`, Epoch Program)

**Recommendation:**
Add a permissionless `deposit_to_carnage_vault` instruction that accepts SOL from any signer:
```rust
pub fn deposit_to_carnage_vault(ctx: Context<DepositVault>, amount: u64) -> Result<()> {
    system_program::transfer(
        CpiContext::new(ctx.accounts.system_program.to_account_info(), ...),
        amount,
    )?;
    Ok(())
}
```

This eliminates admin dependency for vault recovery. The instruction needs no access control since depositing SOL into the vault benefits the protocol.

---

## 6. Medium Findings

### F-007: PROFIT Routing Tax Arbitrage [H011]

**Severity:** MEDIUM
**Category:** Economic Model
**EP Reference:** Custom (Tax Bypass via Routing)

**Description:**
PROFIT pool swaps (`swap_profit_buy`, `swap_profit_sell`) are exempt from protocol tax, paying only the 0.5% AMM LP fee. Cross-faction traders can route through PROFIT to reduce their effective tax from ~15% to ~5%:

1. Buy CRIME at 2% buy tax
2. Swap CRIME to PROFIT (0% tax, 0.5% fee)
3. Swap PROFIT to FRAUD (0% tax, 0.5% fee)
4. Sell FRAUD at 2% sell tax
5. Total cost: ~5% instead of 15%

This reduces protocol tax revenue by up to 67% on cross-faction volume.

**Impact:**
- Staking yield reduction (75% of tax goes to stakers)
- Carnage fund accumulation slowdown (24% of tax)
- Treasury revenue reduction (1% of tax)
- Economic model undermining if widely adopted

**Location:**
`programs/tax-program/src/instructions/swap_profit_buy.rs:1-5` (and `swap_profit_sell.rs`)

**Recommendation:**
This appears to be intentional design (PROFIT as a routing token). Monitor cross-faction routing volume. If it exceeds 40% of total volume, consider:
- Increasing PROFIT pool LP fee from 50 bps to 150-200 bps
- Adding a small tax (1-2%) on PROFIT pool swaps
- Documenting the intended arbitrage range in economic specifications

---

### F-008: AMM Pool Reserves Can Drain to Near-Zero [H043]

**Severity:** MEDIUM
**Category:** Economic Model / AMM Design
**EP Reference:** Custom (Liquidity Floor)

**Description:**
The AMM has no minimum reserve floor. While the constant-product formula prevents exact zero (division by zero would fail), reserves can reach 1 lamport on one side. This creates extreme one-sidedness where:
- The pool becomes unusable for meaningful swaps
- Slippage approaches 100% for any input
- Recovery requires adding liquidity (no LP deposit mechanism exists for protocol-owned pools)

Industry standard (e.g., Uniswap V2) uses a 1,000 unit minimum lock.

**Impact:**
- Pool becomes economically non-functional
- No LP mechanism to rebalance (protocol-owned liquidity)
- Cascading effect on tax revenue if primary pools become unusable

**Location:**
`programs/amm/src/instructions/swap_sol_pool.rs` -- No minimum reserve check after swap
`programs/amm/src/instructions/initialize_pool.rs` -- No minimum seed amount enforcement

**Recommendation:**
Add minimum reserve enforcement:
```rust
const MINIMUM_RESERVE: u64 = 1_000; // 1,000 base units
require!(new_reserve_out >= MINIMUM_RESERVE, AmmError::ReserveTooLow);
```

---

### F-009: Carnage Lock Slot Uninitialized [H057]

**Severity:** MEDIUM
**Category:** State Machine
**EP Reference:** EP-034 (Missing State Transition Check)

**Description:**
The `carnage_lock_slot` field in `EpochState` defaults to 0 after initialization. The lock window check (`current_slot < carnage_lock_slot + LOCK_WINDOW`) passes immediately because `0 + LOCK_WINDOW` is always less than any real slot number. This means the first Carnage event after deployment bypasses the 50-slot atomic-only window.

**Impact:**
- First Carnage event can be front-run (one-time bypass)
- Subsequent Carnage events are correctly protected

**Location:**
`programs/epoch-program/src/state/epoch_state.rs` -- `carnage_lock_slot` defaults to 0

**Recommendation:**
Initialize `carnage_lock_slot` to `u64::MAX` in `initialize_epoch_state`:
```rust
epoch_state.carnage_lock_slot = u64::MAX;
```

This ensures the lock window check fails (correctly enforcing the lock) until the first legitimate Carnage event sets a real slot value.

---

### F-010: EpochState Has No Padding for Future Extension [H060]

**Severity:** MEDIUM
**Category:** State Machine / Upgrade Safety
**EP Reference:** Custom (Account Reallocation)

**Description:**
The `EpochState` account uses exactly 100 bytes of data with zero padding. The protocol's v3 migration lessons explicitly documented the need for padding bytes to accommodate future field additions. Without padding:
- Adding any field requires a program redeployment with `realloc`
- No version field exists to distinguish old vs. new accounts
- Non-upgradeable programs cannot perform `realloc`

**Impact:**
- Future protocol enhancements blocked without full redeployment
- State migration becomes complex (snapshot + redeploy + restore)
- Risk of data corruption if account size changes without proper migration

**Location:**
`programs/epoch-program/src/state/epoch_state.rs`

**Recommendation:**
Add 32 bytes of reserved padding and a version field:
```rust
pub version: u8,        // Start at 1
pub _reserved: [u8; 31], // Future expansion
```

This is a one-time fix that must be applied before mainnet deployment.

---

### F-011: Epoch Number Truncation via `as u32` Cast [H064]

**Severity:** MEDIUM (recalibrated from original investigation)
**Category:** Arithmetic
**EP Reference:** EP-017 (Unsafe Cast)

**Description:**
The `current_epoch()` function uses `as u32` to cast a slot-derived epoch number. While the overflow would occur in approximately 284,000 years (well beyond any realistic concern), this violates the codebase's own defensive casting standards where all other integer conversions use `checked_*` or `try_from()`.

**Impact:**
- No practical impact (overflow in ~284,000 years)
- Code hygiene violation (inconsistent with project standards)

**Location:**
`programs/epoch-program/src/helpers/epoch_math.rs`

**Recommendation:**
Replace `as u32` with `u32::try_from().map_err(|_| EpochError::Overflow)?` for consistency.

---

### F-012: EpochState Exposes Sensitive Economic Data [H106]

**Severity:** MEDIUM (recalibrated from LOW)
**Category:** Information Disclosure / MEV
**EP Reference:** Custom (Information Leakage for MEV)

**Description:**
The `EpochState` account concentrates all actionable economic data in a single world-readable on-chain account: current tax rates for all 4 directions, cheap side indicator, VRF state, Carnage pending flag, and Carnage direction. Sophisticated MEV actors can read this state to:
- Time trades around epoch boundaries
- Front-run Carnage buy events
- Optimize cross-faction routing based on current rates

**Impact:**
- MEV extraction from predictable state transitions
- Information asymmetry between sophisticated and retail users
- Not directly exploitable but amplifies MEV opportunities

**Location:**
`programs/epoch-program/src/state/epoch_state.rs`

**Recommendation:**
This is largely inherent to on-chain transparency. Mitigations include:
- Documenting the MEV surface area for users
- Consider commit-reveal scheme for Carnage direction (higher complexity)
- Monitor MEV extraction rates post-launch

---

### F-013: AMM Pool Mint Validation Missing [H125]

**Severity:** MEDIUM
**Category:** Access Control
**EP Reference:** EP-001 (Missing Account Validation)

**Description:**
The AMM's `initialize_pool` instruction accepts any two Token-2022 mints for pool creation. While admin-gated, there is no on-chain allowlist restricting pool creation to the intended 4 pools (CRIME/SOL, FRAUD/SOL, CRIME/PROFIT, FRAUD/PROFIT). A compromised admin could create pools with malicious token mints.

**Impact:**
- Unauthorized pool creation with malicious tokens (admin-gated)
- No on-chain enforcement of intended pool set
- Limited by admin burn mechanism (pools cannot be created after burn)

**Location:**
`programs/amm/src/instructions/initialize_pool.rs:25-48`

**Recommendation:**
Add an on-chain allowlist of permitted mints, or document that pool creation is a one-time admin operation that is permanently disabled after authority burn. For defense-in-depth, add explicit mint checks:
```rust
require!(
    mint_a.key() == SOL_MINT || mint_a.key() == crime_mint() || ...,
    AmmError::UnauthorizedMint
);
```

---

## 7. Low Findings

### F-014: Randomness Accounts Never Closed [H090]

**Severity:** LOW
**Category:** Operational / Resource Management
**EP Reference:** Custom (Rent Accumulation)

**Description:**
Switchboard VRF randomness accounts created for each epoch are never closed after consumption. Each account costs ~5,616 lamports in rent. At one epoch per 30 minutes (mainnet), this accumulates approximately 0.37 SOL per year in permanently locked rent.

**Impact:**
- ~0.37 SOL/year rent waste on mainnet
- No security impact
- Switchboard owns these accounts; protocol cannot reclaim rent

**Location:**
`programs/epoch-program/src/instructions/consume_randomness.rs` -- No account closure after use

**Recommendation:**
Investigate whether Switchboard provides a `close_randomness` instruction. If not, document as accepted operational cost. Consider batching randomness account cleanup as a periodic maintenance task.

---

### F-015: Single Switchboard VRF Oracle Dependency [H119]

**Severity:** LOW (recalibrated from MEDIUM)
**Category:** External Dependency / Availability
**EP Reference:** Custom (Oracle Single Point of Failure)

**Description:**
The protocol depends on a single Switchboard On-Demand VRF oracle. If the oracle is unavailable, epoch transitions stall because `consume_randomness` cannot obtain VRF bytes. The 300-slot timeout recovery mechanism (`retry_epoch_vrf`) allows creating a fresh randomness account that may be assigned to a different (working) oracle.

**Impact:**
- Temporary liveness degradation during oracle outage
- 300-slot (~2 minute) recovery window
- No funds at risk (epoch stalls, does not corrupt)
- VRF timeout recovery provides adequate resilience

**Location:**
`programs/epoch-program/src/instructions/retry_epoch_vrf.rs`

**Recommendation:**
The existing timeout recovery mechanism is adequate. For enhanced resilience:
- Monitor oracle availability metrics
- Document the recovery procedure for operators
- Consider maintaining a secondary oracle configuration for mainnet

---

## 8. Potential Findings

Potential findings represent vulnerabilities that are theoretically possible but require specific preconditions that may not hold in practice, or where the determination depends on deployment decisions not yet finalized.

### P-001: Initialization Front-Running on 3 Programs [H003]

**Severity:** POTENTIAL HIGH
**Confidence:** HIGH

Three initialization instructions (Transfer Hook `initialize_authority`, Epoch `initialize_epoch_state`, Staking `initialize_stake_pool`) accept any signer without verifying upgrade authority. The AMM's `initialize_admin` demonstrates the correct pattern. The front-running window exists during the deployment-to-initialization gap. Anchor's `init` constraint prevents re-initialization but not first-caller front-running.

**Determination Rationale:** Overlap with S005 (confirmed). The root cause is the same; H003 documents the broader pattern while S005 focuses on the most severe instance (Transfer Hook).

---

### P-002: force_carnage Devnet Backdoor [H004]

**Severity:** POTENTIAL CRITICAL
**Confidence:** HIGH

The `force_carnage` instruction is correctly gated by `#[cfg(feature = "devnet")]` at both module and instruction levels. It will not exist in mainnet builds. However, the current deployed binary (devnet) includes this instruction in the IDL, and the admin key (`8kPzhQoUPx7LYM18f9TzskW4ZgvGyq4jMPYZikqmHMH4`) is committed to git at `keypairs/devnet-wallet.json`.

**Risk:** If the devnet binary is accidentally deployed to mainnet, the admin key holder can trigger Carnage at will, enabling market manipulation.

**Recommendation:** Add IDL verification to CI/CD: `grep force_carnage target/idl/epoch_program.json` must return empty for mainnet builds.

---

### P-003: CPI Depth at Solana Limit [H010]

**Severity:** POTENTIAL MEDIUM
**Confidence:** MEDIUM

The Carnage execution CPI chain (Epoch -> Tax -> AMM -> Token-2022 -> Transfer Hook) is exactly at CPI depth 4 -- the Solana runtime limit. Agave 3.0 raises this to 8, removing the immediate concern. However, if Token-2022 ever adds an internal CPI call, the chain would fail.

**Determination Rationale:** Not actively exploitable. Latent architectural fragility dependent on external runtime changes.

---

### P-004: Combined Admin Key Attack [H037]

**Severity:** POTENTIAL HIGH
**Confidence:** MEDIUM

If an attacker controls both the whitelist authority AND the devnet admin key, AND the devnet binary is deployed to mainnet, they can:
1. Whitelist their own token accounts
2. Force Carnage at predictable times
3. Front-run the Carnage buy with their own purchases
4. Profit from the price pump

**Determination Rationale:** Requires deployment error (devnet binary to mainnet) AND key compromise. Treasury redirect is NOT possible (H005 confirms no `update_treasury` instruction exists).

---

### P-005: Hook Initialize Front-Running [H063]

**Severity:** POTENTIAL MEDIUM
**Confidence:** HIGH

Subset of H003/S005. The Transfer Hook's `initialize_extra_account_meta_list` and `initialize_authority` can both be front-run. The authority front-run is the more severe case (S005). The meta list front-run would prevent hook resolution from working correctly.

---

### P-006: PoolState Size Lacks Compile-Time Assertion [H067]

**Severity:** POTENTIAL LOW
**Confidence:** MEDIUM

The PoolState size appears correct (224 INIT_SPACE + 8 discriminator = 232 bytes), but no compile-time assertion (`const_assert!`) verifies this. If fields are added without updating INIT_SPACE, pools could be created with undersized accounts.

---

### P-007: Reward Precision Loss at Large Total Staked [H075]

**Severity:** POTENTIAL MEDIUM
**Confidence:** MEDIUM

The staking reward calculation `(pending_rewards * PRECISION) / total_staked` floors to zero when `pending_rewards < total_staked / PRECISION`. At `total_staked = u64::MAX`, even 18 lamports of rewards produce zero per-token increment. This is a latent defect that manifests only at extreme TVL scales (>1e15 total staked).

**Determination Rationale:** Current TVL is far below the threshold. Becomes relevant at high adoption. Recommend extending proptest bounds to cover full u64 range.

---

### P-008: Carnage Fund Accumulation Without Spending [H084]

**Severity:** POTENTIAL MEDIUM
**Confidence:** HIGH

The Carnage Fund accumulates 24% of all tax revenue but only spends when VRF triggers (~4.3% probability per epoch). In high-volume scenarios, the fund can grow to levels that exceed pool liquidity. The 1,000 SOL per-swap cap and 85% slippage floor provide guardrails, but no upper bound on fund balance exists.

**Determination Rationale:** Design choice, not a bug. The fund growth is intentional. Recommend monitoring and documenting accumulation expectations.

---

### P-009: Pool Reserve Overflow [H092]

**Severity:** INFORMATIONAL
**Confidence:** HIGH

Pool reserves use `checked_add` for all updates. Token supply constraints (u64 max) prevent any practical overflow. All attack scenarios are blocked by checked arithmetic. Reclassified from POTENTIAL to INFORMATIONAL based on investigation.

---

### P-010: Whitelist Covers Token Accounts, Not Wallets [H104]

**Severity:** POTENTIAL LOW (Design Pattern)
**Confidence:** HIGH

The whitelist operates on token account addresses, not wallet/owner addresses. This is correct by design and more secure than owner-based whitelisting (prevents wallet substitution attacks). Creates UX friction for users creating secondary ATAs.

---

### P-011: Admin Key is Deployer Wallet [H124]

**Severity:** POTENTIAL MEDIUM (devnet), HIGH (if replicated on mainnet)
**Confidence:** HIGH

The devnet deployment uses the deployer wallet as the AMM admin. The admin's scope is limited to pool creation (no drain capability, no parameter modification). Admin can and should be burned after pool creation. The risk is operational: forgetting to burn on mainnet.

---

## 9. Mitigated Findings

### M-001: Staking Unstake Missing Explicit Mint Validation [H034]

**Severity:** INFO (Mitigated by Design)
**Confidence:** HIGH

The staking `unstake` instruction does not explicitly validate the `profit_mint` address against a hardcoded constant. However, the `token::mint = profit_mint` constraint on `stake_vault` implicitly enforces correctness because the vault's mint is immutable after initialization. Adding an explicit mint constraint is recommended as defense-in-depth.

---

### M-002: Bounty Vault Rent-Exempt Drain Griefing [H082]

**Severity:** CRITICAL (on-chain) / MEDIUM (post-mitigation)
**Confidence:** VERY HIGH

This is a duplicate/extension of H001, specifically analyzing the griefing attack vector. The on-chain bug remains unfixed. An off-chain crank runner auto-top-up mechanism (`crank-runner.ts:63-75`, deployed 2026-02-22) keeps the vault above the danger zone by automatically depositing 5,000,000 lamports when the balance drops below 2,000,000.

**Current Status:** Mitigated via off-chain automation. On-chain fix required before mainnet.

---

### M-003: Combined Admin Key Compromise Attack [S008]

**Severity:** MEDIUM (Mitigated by Design)
**Confidence:** HIGH

A combined attack exploiting whitelist authority + bounty mechanism is constrained by: (1) deploy-and-lock model where authorities are burned post-initialization, (2) limited admin scope (cannot drain pools), (3) bounty extraction is economically negligible (~$9.60/day at $200/SOL). The `force_carnage` backdoor (H004) amplifies this to CRITICAL only if devnet binary is deployed to mainnet.

**Determination Rationale:** Attack is economically non-viable without deployment error. Whitelist pollution is permanent but cannot steal funds.

---

## 10. Combination Attack Analysis

### Combination 1: H001 + S010 -- Epoch Deadlock with No Recovery

**Combined Severity:** CRITICAL
**Preconditions:** Vault balance enters danger zone during low-volume period

**Attack Chain:**
1. Vault depletes naturally during extended low-volume period
2. Balance enters H001 danger zone [1M, 1.89M lamports]
3. Epoch transitions fail with `InsufficientFundsForRent`
4. S010 -- No admin deposit instruction exists for recovery
5. External SOL injection requires manual admin intervention

**Amplification:** H001 alone is recoverable via trading tax accumulation. Combined with S010, recovery requires admin key availability. If admin key is lost, the protocol is permanently frozen.

**Mitigation:** Fix H001 (rent-aware check) AND add permissionless vault deposit instruction (S010).

### Combination 2: S005 + H113 -- Authority Capture + Infinite Minting

**Combined Severity:** CRITICAL
**Preconditions:** Attacker front-runs Transfer Hook initialization AND has the mint authority private key

**Attack Chain:**
1. Attacker front-runs `initialize_authority` (S005) to claim whitelist control
2. Attacker whitelists their own token accounts
3. Attacker mints unlimited CRIME/FRAUD/PROFIT via retained mint authority (H113)
4. Attacker sells minted tokens through whitelisted accounts
5. Protocol value extraction via infinite supply + whitelisted exit

**Amplification:** Either finding alone is damaging. Combined, they enable unlimited value extraction.

**Mitigation:** Fix both S005 (upgrade authority verification) AND H113 (revoke mint authorities).

### Combination 3: H004 + H037 -- Devnet Backdoor + Market Manipulation

**Combined Severity:** CRITICAL (conditional on deployment error)
**Preconditions:** Devnet binary deployed to mainnet AND admin key compromised

**Attack Chain:**
1. `force_carnage` available in mainnet binary (H004)
2. Attacker calls `force_carnage` to trigger predictable buy event
3. Attacker front-runs with their own purchase
4. Carnage buy pumps target token price
5. Attacker sells at inflated price
6. Repeat indefinitely with 10-20% profit per cycle

**Mitigation:** Never deploy devnet binary to mainnet. Add CI/CD verification. Verify IDL post-deployment.

---

## 11. Attack Trees

### Attack Tree 1: Protocol Liveness Destruction

```
GOAL: Permanently halt Dr. Fraudsworth protocol
|
+-- [1] Epoch Transition Deadlock (H001 + S010)
|   |-- [1.1] Wait for vault balance in danger zone [1M, 1.89M]
|   |   |-- [1.1.1] Organic: low volume period depletes vault naturally
|   |   +-- [1.1.2] Accelerated: repeatedly trigger bounties (permissionless)
|   |-- [1.2] Call trigger_epoch_transition -> fails with InsufficientFundsForRent
|   |-- [1.3] No admin deposit instruction (S010)
|   |-- [1.4] Recovery requires manual admin SOL transfer
|   +-- [1.5] If admin key lost -> PERMANENT FREEZE
|       |-- Epochs frozen
|       |-- VRF consumption blocked
|       |-- Staking rewards frozen
|       +-- Carnage events impossible
|
+-- [2] Whitelist Authority Capture (S005)
|   |-- [2.1] Front-run initialize_authority during deployment
|   |-- [2.2] Attacker becomes whitelist authority
|   |-- [2.3] Refuse to whitelist protocol vaults
|   |-- [2.4] All token transfers fail (CRIME, FRAUD, PROFIT)
|   +-- [2.5] Call burn_authority -> PERMANENT UNRECOVERABLE
|
+-- [3] Staking Escrow Deadlock (S001)
    |-- [3.1] Escrow vault balance near rent-exempt minimum
    |-- [3.2] Claim/unstake fails with rent error
    |-- [3.3] User PROFIT tokens locked in stake vault
    +-- [3.4] No automated recovery mechanism
```

### Attack Tree 2: Economic Value Extraction

```
GOAL: Extract maximum value from protocol
|
+-- [1] Infinite Token Minting (H113) [CRITICAL]
|   |-- [1.1] Deployer wallet retains mint authority on all 3 tokens
|   |-- [1.2] Call mintTo for CRIME, FRAUD, or PROFIT
|   |-- [1.3] Sell minted tokens via swap
|   +-- [1.4] UNLIMITED extraction until detected
|
+-- [2] Tax Arbitrage via PROFIT Routing (H011) [MEDIUM]
|   |-- [2.1] Route cross-faction trades through PROFIT pools
|   |-- [2.2] Pay 5% effective tax instead of 15%
|   +-- [2.3] 67% tax revenue reduction on cross-faction volume
|
+-- [3] MEV via Zero Slippage (H041) [HIGH]
|   |-- [3.1] Compromise or deploy malicious frontend
|   |-- [3.2] Set minimum_output = 0 on user swaps
|   |-- [3.3] MEV bot sandwiches with up to 49.99% extraction
|   +-- [3.4] User loses funds to sandwich
|
+-- [4] Market Manipulation via force_carnage (H004) [CONDITIONAL]
    |-- [4.1] REQUIRES: devnet binary on mainnet
    |-- [4.2] Pre-buy target token
    |-- [4.3] Force Carnage buy event
    |-- [4.4] Sell at inflated price
    +-- [4.5] 10-20% profit per cycle
```

### Attack Tree 3: Governance Takeover

```
GOAL: Capture protocol governance permanently
|
+-- [1] Whitelist Authority Capture (S005)
|   |-- [1.1] Monitor for Transfer Hook deployment TX
|   |-- [1.2] Submit initialize_authority with attacker key
|   |-- [1.3] Anchor init ensures only first call succeeds
|   |-- [1.4] Attacker controls all token transfer permissions
|   +-- [1.5] Options:
|       |-- [1.5a] Ransom: charge for whitelisting
|       |-- [1.5b] Selective blocking: whitelist own accounts only
|       +-- [1.5c] Permanent destruction: burn_authority
|
+-- [2] AMM Admin Capture (H003 - partial)
|   |-- [2.1] AMM initializeAdmin REQUIRES upgrade authority (SAFE)
|   +-- [2.2] BLOCKED: Cannot front-run AMM admin
|
+-- [3] Epoch/Staking Admin Capture (H003)
    |-- [3.1] Front-run initialize_epoch_state or initialize_stake_pool
    |-- [3.2] Limited impact: these instructions don't grant admin powers
    +-- [3.3] Main risk: incorrect initial parameters, requiring redeploy
```

---

## 12. Severity Re-Calibration Notes

### Upgrades

| Finding | Original | Final | Rationale |
|---------|----------|-------|-----------|
| H106 | LOW | **MEDIUM** | EpochState data concentration creates non-trivial MEV surface. Information asymmetry between sophisticated and retail traders. On-chain data feeds are standard, but the bundled nature (4 tax rates + cheap side + Carnage flag in one account) amplifies MEV utility. |

### Downgrades

| Finding | Original | Final | Rationale |
|---------|----------|-------|-----------|
| H119 | MEDIUM | **LOW** | VRF oracle SPOF has existing 300-slot timeout recovery mechanism. No funds at risk during outage. Liveness-only concern with adequate mitigation already deployed. Switchboard's mainnet track record is strong. |
| H090 | MEDIUM | **LOW** | Rent waste of ~0.37 SOL/year is operationally negligible. Switchboard owns the accounts; protocol cannot reclaim. No security impact. |
| H092 | POTENTIAL MEDIUM | **INFORMATIONAL** | All reserve updates use `checked_add`. Token supply constraints make overflow physically impossible. Comprehensive defense-in-depth (checked arithmetic + k-invariant verification + SPL token supply limits). |

### Maintained

| Finding | Severity | Rationale |
|---------|----------|-----------|
| H001 | CRITICAL | Epoch deadlock is catastrophic. Self-healing via trading tax does NOT work during sustained low-volume periods. Confirmed by off-chain mitigation deployment (H082). |
| H113 | CRITICAL | Infinite minting capability is maximum severity regardless of exploit likelihood. The fix (authority revocation) is trivial and must be applied. |
| S005 | CRITICAL | Protocol-wide DoS from front-running is unrecoverable if authority is burned by attacker. The AMM's correct pattern proves the fix is known and straightforward. |
| H041 | HIGH | Maintained at HIGH rather than CRITICAL because: (1) requires compromised frontend, (2) 50% floor limits maximum extraction, (3) on-chain programs are not directly vulnerable. |

---

## 13. Coverage Summary

### Instruction Coverage: 38/38 (100%)

| Program | Instructions | Coverage |
|---------|-------------|----------|
| AMM | 5 (initialize_admin, burn_admin, initialize_pool, swap_sol_pool, swap_profit_pool) | 5/5 |
| Tax Program | 6 (swap_sol_buy, swap_sol_sell, swap_profit_buy, swap_profit_sell, initialize_wsol_intermediary, swap_exempt) | 6/6 |
| Epoch Program | 9 (initialize_epoch_state, trigger_epoch_transition, consume_randomness, retry_epoch_vrf, initialize_carnage_fund, execute_carnage, execute_carnage_atomic, expire_carnage, force_carnage) | 9/9 |
| Transfer Hook | 5 (initialize_authority, add_whitelist_entry, burn_authority, initialize_extra_account_meta_list, transfer_hook) | 5/5 |
| Staking | 6 (initialize_stake_pool, stake, unstake, claim, deposit_rewards, update_cumulative) | 6/6 |
| **Deployment Scripts** | 7 (initialize, deploy, build, crank, alt-helper, carnage-flow, vrf-flow) | 7/7 |

### Exploit Pattern Coverage: 13/13 (100%)

All 13 relevant exploit patterns from the Stronghold of Security knowledge base were tested against the codebase:

| Pattern | Category | Tested By | Result |
|---------|----------|-----------|--------|
| EP-001 Missing Account Validation | Access Control | H002, H125 | H002: Not Vulnerable, H125: Confirmed |
| EP-016 Integer Underflow | Arithmetic | H001, S001 | Both Confirmed |
| EP-017 Unsafe Cast | Arithmetic | H020, H064 | H020: Not Vulnerable, H064: Confirmed |
| EP-020 Modulo Bias | Oracle | H020 | Not Vulnerable (256%4=0) |
| EP-026 Missing Authority Constraint | Access Control | S005, H003 | S005: Confirmed, H003: Potential |
| EP-034 Missing State Transition | State Machine | H057 | Confirmed |
| EP-042 Arbitrary CPI Substitution | CPI | H002, H041 | H002: Not Vulnerable, H041: Confirmed |
| EP-068 Single Admin Key | Governance | H113, H124 | H113: Confirmed, H124: Potential |
| EP-075 Initialization Front-Running | Initialization | S005, H003, H063 | S005: Confirmed, H003/H063: Potential |
| EP-076 Re-initialization | Initialization | H003 | Not Vulnerable (Anchor `init`) |
| EP-077 Discriminator Collision | CPI | H050 | Not Vulnerable |
| EP-084 Resource Exhaustion | DoS | S010, H084 | S010: Confirmed, H084: Potential |
| EP-090 Race Conditions | Timing | S003, H007 | Not Vulnerable (atomic bundling) |

### Cross-Program Vector Coverage: 5/5 (100%)

| Vector | Programs Involved | Finding(s) |
|--------|-------------------|------------|
| Tax -> AMM -> Token-2022 -> Hook (swap path) | Tax, AMM, Token-2022, Hook | H002, H041, H011 |
| Epoch -> Tax -> AMM (Carnage path) | Epoch, Tax, AMM | H001, H010, S007, H057 |
| Tax -> Staking (reward deposit) | Tax, Staking | S001, H070 |
| Epoch -> Switchboard (VRF) | Epoch, Switchboard | H119, H020, S003 |
| Hook -> ExtraAccountMetaList (whitelist) | Hook, Token-2022 | S005, H063, H104 |

---

## 14. Recommendations

### Immediate (Pre-Mainnet, Blocking)

1. **Fix H001:** Add rent-exempt check to bounty transfer in `trigger_epoch_transition.rs`
2. **Fix H113:** Revoke mint authorities on all 3 token mints (CRIME, FRAUD, PROFIT) in `initialize.ts`
3. **Fix S005:** Add upgrade authority verification to Transfer Hook `initialize_authority` (and Epoch/Staking init instructions per H003)
4. **Fix H041:** Reject `minimum_output = 0` in all 4 swap instructions
5. **Fix S001:** Add rent-exempt check to staking escrow claim/unstake
6. **Fix S010:** Add permissionless `deposit_to_carnage_vault` instruction
7. **Verify H004:** Ensure mainnet build does NOT include `--features devnet`. Add CI/CD verification.
8. **Fix H057:** Initialize `carnage_lock_slot` to `u64::MAX`
9. **Fix H060:** Add 32 bytes padding + version field to `EpochState`

### Short-Term (Pre-Mainnet, Non-Blocking but Recommended)

10. **H043:** Add minimum reserve floor (1,000 base units) to AMM swaps
11. **H064:** Replace `as u32` with `u32::try_from()` for consistency
12. **H125:** Add mint allowlist to `initialize_pool` for defense-in-depth
13. **H067:** Add `const_assert!` for PoolState size verification
14. **H034:** Add explicit PROFIT mint address constraint in staking instructions
15. **H124:** Document deployment procedure requiring multisig admin + authority burn
16. **Mainnet Checklist:**
    - Set mainnet treasury address (replace `Pubkey::default()`)
    - Set mainnet PROFIT mint address
    - Verify all authorities burned post-initialization
    - Verify no keypairs committed to git
    - Run post-deployment verification script

### Long-Term (Post-Mainnet)

17. **H011:** Monitor PROFIT routing volume; adjust fees if cross-faction routing exceeds 40%
18. **H075:** Implement residual-tracking for staking rewards at scale, or prove total_staked is bounded
19. **H084:** Add Carnage fund monitoring with alerts at 500/750 SOL thresholds
20. **H090:** Investigate Switchboard randomness account cleanup mechanism
21. **H106:** Consider commit-reveal scheme for Carnage direction to reduce MEV surface
22. **H119:** Evaluate multi-oracle VRF strategy for enhanced liveness
23. **General:** Engage external audit firm for independent verification before mainnet launch

---

## Appendix A: Full Findings Index

### Confirmed Findings (15)

| ID | Severity | Title | Program | Status |
|----|----------|-------|---------|--------|
| H001 | CRITICAL | Bounty Transfer Drains Vault Below Rent-Exempt | Epoch | Confirmed |
| H113 | CRITICAL | Mint Authorities Not Revoked | Scripts | Confirmed |
| S005 | CRITICAL | Transfer Hook init Accepts Any Signer | Hook | Confirmed |
| H041 | HIGH | No On-Chain Zero Slippage Enforcement | Tax | Confirmed |
| S001 | HIGH | Staking Escrow Rent-Exempt Drain | Staking | Confirmed |
| S010 | HIGH | Epoch Recovery Requires Admin Deposit | Epoch | Confirmed |
| H011 | MEDIUM | PROFIT Routing Tax Arbitrage | Tax/AMM | Confirmed |
| H043 | MEDIUM | Pool Reserves Near-Zero Drain | AMM | Confirmed |
| H057 | MEDIUM | Carnage Lock Slot Uninitialized | Epoch | Confirmed |
| H060 | MEDIUM | EpochState No Padding | Epoch | Confirmed |
| H064 | MEDIUM | Slot as u32 Truncation | Epoch | Confirmed |
| H106 | MEDIUM | EpochState Sensitive Data Exposure | Epoch | Confirmed |
| H125 | MEDIUM | AMM Pool Mint Validation Missing | AMM | Confirmed |
| H090 | LOW | Randomness Accounts Never Closed | Epoch | Confirmed |
| H119 | LOW | VRF Oracle Single Point of Failure | Epoch | Confirmed |

### Potential Findings (11)

| ID | Severity | Title | Program |
|----|----------|-------|---------|
| H003 | HIGH | Initialization Front-Running (3 programs) | Hook/Epoch/Staking |
| H004 | CRITICAL | force_carnage Devnet Backdoor | Epoch |
| H010 | MEDIUM | CPI Depth at Solana Limit | Epoch/Tax/AMM |
| H037 | HIGH | Combined Admin Key Attack | Cross-Program |
| H063 | MEDIUM | Hook Initialize Front-Runnable | Hook |
| H067 | LOW | PoolState Size No Assertion | AMM |
| H075 | MEDIUM | Reward Precision Loss at Scale | Staking |
| H084 | MEDIUM | Carnage Fund Unbounded Accumulation | Epoch |
| H092 | INFO | Pool Reserve Overflow (blocked by checked_add) | AMM |
| H104 | LOW | Whitelist Covers Token Accounts Not Wallets | Hook |
| H124 | MEDIUM | Admin Key is Deployer Wallet | AMM/Scripts |

### Mitigated Findings (3)

| ID | Severity | Title | Program | Mitigation |
|----|----------|-------|---------|------------|
| H034 | INFO | Missing Explicit Mint Validation in Unstake | Staking | Implicit via token::mint constraint |
| H082 | MEDIUM | Bounty Rent-Exempt Griefing | Epoch | Off-chain crank auto-top-up |
| S008 | MEDIUM | Combined Admin Key Compromise | Cross-Program | Deploy-and-lock model + authority burn |

### Duplicate Findings (2)

| ID | Duplicate Of | Reason |
|----|-------------|--------|
| H048 | H041 | Same slippage enforcement concern, different swap instruction |
| S004 | H001 | Same rent-exempt bug from different analysis agent |

### Not Vulnerable Findings (111)

111 hypotheses were investigated and determined to be not vulnerable. See Appendix B for a representative sample.

---

## Appendix B: Not Vulnerable Summary

A representative sample of 10 not-vulnerable findings demonstrates the audit's thoroughness and the protocol's defensive measures:

| ID | Hypothesis | Why Not Vulnerable |
|----|-----------|-------------------|
| H002 | `constraint = true` placeholder allows account substitution | PDA seeds + `seeds::program` provide deterministic validation. Placeholder is dead code, not a bypass. |
| H005 | Treasury address can be redirected via admin | No `update_treasury` instruction exists. Treasury is a compile-time constant. |
| H020 | VRF tax rate computation has u64 truncation | VRF uses direct u8 modulo (not u64 conversion). Array lookup produces bounded u16 values. |
| H050 | Anchor discriminator collision across programs | All 33 instructions have unique names. Collision probability ~10^-17. |
| H070 | Staking reward vault holds wrong token | Rewards are native SOL (system account), not token account. No mint mismatch possible. |
| H100 | Staking checkpoint uses wrong Clock field | All checkpoint logic uses `Clock::slot`. No `unix_timestamp` in financial logic. |
| S002 | Bounty deadlock enables tax rate freezing | Self-defeating: trading (to exploit low rates) refills vault, defeating the deadlock. |
| S003 | VRF prediction + PROFIT routing amplified extraction | VRF reveal + consumption are atomically bundled. No prediction window exists. |
| S006 | Additional devnet feature gates leak to mainnet | Exhaustive audit found only force_carnage (H004). All other gates are safe configuration. |
| S007 | Carnage path exhausts compute units | Measured at 105,017 CU (52.5% of 200K default). 4-6x headroom in production. |

The full set of 111 not-vulnerable findings is available in the individual finding files at `.audit/findings/`.

---

## Appendix C: Exploit Pattern Cross-Reference

### Patterns Tested and Results

| EP-ID | Pattern Name | Findings Tested | Confirmed | Not Vulnerable |
|-------|-------------|----------------|-----------|----------------|
| EP-001 | Missing Account Validation | H002, H125 | 1 | 1 |
| EP-003 | Owner Check Bypass | H002 | 0 | 1 |
| EP-007 | Account Relationship Not Verified | H002 | 0 | 1 |
| EP-015 | Overflow/Underflow | H092 | 0 | 1 |
| EP-016 | Integer Underflow | H001, S001 | 2 | 0 |
| EP-017 | Unsafe Cast | H020, H064 | 1 | 1 |
| EP-020 | Modulo Bias | H020 | 0 | 1 |
| EP-026 | Missing Authority Constraint | S005, H003, H124 | 1 | 0 |
| EP-032 | PDA Authority Without Derivation | H002 | 0 | 1 |
| EP-034 | Missing State Transition Check | H057, S002 | 1 | 1 |
| EP-042 | Arbitrary CPI Program Substitution | H002, H041 | 1 | 1 |
| EP-068 | Single Admin Key | H113, H124, S008 | 1 | 0 |
| EP-069 | No Admin Key Rotation | S008 | 0 | 0 |
| EP-071 | Unprotected Upgrade Authority | S008 | 0 | 0 |
| EP-072 | No Emergency Pause | S008 | 0 | 0 |
| EP-075 | Initialization Front-Running | S005, H003, H063 | 1 | 0 |
| EP-076 | Re-initialization | H003 | 0 | 1 |
| EP-077 | Discriminator Collision | H050 | 0 | 1 |
| EP-084 | Resource Exhaustion / DoS | S010, H084, S007 | 1 | 1 |
| EP-090 | Race Conditions | S003, H007 | 0 | 2 |

### Novel Strategies (No EP Match)

31 of the 142 strategies (23.5%) were protocol-specific with no direct exploit pattern precedent. These covered:

- Faction-specific tax arbitrage paths (H011)
- VRF-driven Carnage timing manipulation (H004, H037)
- Cross-faction PROFIT routing economics (S003)
- Dual-hook remaining_accounts ordering (covered by CPI analysis)
- Epoch state accumulation patterns (H084)
- Transfer Hook whitelist token-account-vs-wallet semantics (H104)
- Reward precision loss at extreme TVL (H075)
- Carnage fund liquidity risk (H084)

---

## Disclaimer

This audit was performed by the Stronghold of Security automated adversarial audit system. While the audit methodology is comprehensive (142 hypotheses, 100% instruction coverage, 100% exploit pattern coverage), automated audits have inherent limitations:

1. **Novel attack vectors** not covered by the exploit pattern knowledge base may exist
2. **Economic model assumptions** (e.g., trading volume, TVL projections) are estimates
3. **External dependencies** (Solana runtime, Switchboard, Token-2022) may introduce vulnerabilities not covered by this scope
4. **Off-chain components** (frontend, crank runner, deployment scripts) received limited coverage compared to on-chain programs

This audit does not constitute a guarantee of security. The protocol team should engage an independent external audit firm for additional verification before mainnet deployment.

---

**Report Generated:** 2026-02-22
**Audit ID:** sos-001-20260222-be95eba
**Total Findings:** 15 confirmed, 11 potential, 3 mitigated, 2 duplicates, 111 not vulnerable
**Coverage:** 38/38 instructions, 13/13 exploit patterns, 5/5 cross-program vectors
