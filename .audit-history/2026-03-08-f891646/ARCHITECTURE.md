# Architecture Document -- Dr Fraudsworth Protocol

**Audit ID:** sos-002-20260307-f891646
**Synthesized from:** 9 primary context auditors + 8 verification agents + 1 economic model agent
**Date:** 2026-03-07

---

## 1. Protocol Overview

Dr. Fraudsworth's Finance Factory is a multi-program DeFi protocol on Solana combining:
- **Dual Bonding Curves** (v1.2): Linear price curves for CRIME and FRAUD token launch
- **Constant-Product AMM**: Post-graduation trading for CRIME/SOL and FRAUD/SOL pairs
- **Asymmetric VRF Taxation**: VRF-derived per-epoch tax rates (1-14%) on all AMM swaps
- **Synthetix-Style Staking**: PROFIT stakers earn 71% of swap taxes as SOL yield
- **Carnage Fund**: VRF-triggered buyback-and-burn (24% of taxes, ~4.3% trigger chance/epoch)
- **Conversion Vault**: Fixed-rate 100:1 CRIME/FRAUD <-> PROFIT conversion
- **Transfer Hook**: Whitelist enforcement on all CRIME/FRAUD token transfers

**Programs (7 production):** AMM, Tax Program, Epoch Program, Staking, Bonding Curve, Conversion Vault, Transfer Hook

**Tokens:** CRIME (1B, T22+hook), FRAUD (1B, T22+hook), PROFIT (20M, T22). All mint authorities burned.

## 2. Unified Trust Model

### Trust Tier 1: CPI-Gated (Cryptographically Enforced)
| Trust Chain | PDA Seed | Caller | Callee | Verification |
|---|---|---|---|---|
| swap_authority | `SWAP_AUTHORITY_SEED` | Tax Program | AMM::swap_sol_pool | `seeds::program = TAX_PROGRAM_ID` |
| tax_authority | `TAX_AUTHORITY_SEED` | Tax Program | Staking::deposit_rewards | `seeds::program = tax_program_id()` |
| staking_authority | `STAKING_AUTHORITY_SEED` | Epoch Program | Staking::update_cumulative | `seeds::program = epoch_program_id()` |
| carnage_signer | `CARNAGE_SIGNER_SEED` | Epoch Program | Tax::swap_exempt | `seeds::program = epoch_program_id()` |

**Verdict:** All 4 chains verified across both audits. Structurally secure -- unauthorized programs cannot derive correct PDA seeds.

### Trust Tier 2: Upgrade Authority Gated (Strong)
- **AMM Admin**: AdminConfig PDA created via ProgramData upgrade-authority check. Admin gates pool creation. Can be irreversibly burned. **MODEL PATTERN.**

### Trust Tier 3: Stored Authority (Moderate)
- **Transfer Hook Authority**: First-caller-wins pattern with burn capability. **FRONT-RUNNABLE** during deployment (S005 -- NOT FIXED).

### Trust Tier 4: Bare Signer (BROKEN)
- **Bonding Curve "Authority"**: 6 instructions accept ANY `Signer<'info>` named `authority` with ZERO on-chain verification. **CRITICAL** -- includes `withdraw_graduated_sol` (~1000 SOL per curve).

### Trust Tier 5: Permissionless (State-Gated)
- `trigger_epoch_transition`, `mark_failed`, `distribute_tax_escrow`, `consolidate_for_refund`, `expire_carnage` -- all correctly gated by state conditions and timing, not identity.

### Trust Tier 6: No Authority
- **Conversion Vault**, **Epoch Init**, **Staking Init**: No stored admin. One-shot init, then autonomous. Cannot be paused or upgraded (besides program upgrade).

## 3. Instruction Map

| Program | Instruction | Access Control | Analysis Coverage |
|---------|------------|----------------|-------------------|
| AMM | initialize_admin | Upgrade authority (ProgramData) | Full |
| AMM | initialize_pool | has_one admin | Full |
| AMM | burn_admin | has_one admin | Full |
| AMM | swap_sol_pool | seeds::program (Tax only) | Full |
| Tax | swap_sol_buy | Permissionless (user signs) | Full |
| Tax | swap_sol_sell | Permissionless (user signs) | Full |
| Tax | swap_exempt | seeds::program (Epoch only) | Full |
| Tax | initialize_wsol_intermediary | Any signer (one-shot) | Partial |
| Epoch | initialize_epoch_state | Any signer (one-shot) | Full |
| Epoch | trigger_epoch_transition | Permissionless (bounty) | Full |
| Epoch | consume_randomness | Permissionless | Full |
| Epoch | execute_carnage_atomic | Permissionless (lock window) | Full |
| Epoch | execute_carnage | Permissionless (fallback) | Full |
| Epoch | expire_carnage | Permissionless (deadline) | Full |
| Epoch | retry_epoch_vrf | Permissionless (timeout) | Full |
| Epoch | initialize_carnage_fund | Any signer (one-shot) | Full |
| Epoch | force_carnage | DEVNET_ADMIN only (cfg devnet) | Full |
| Staking | initialize_stake_pool | Any signer (one-shot) | Full |
| Staking | stake | User (init_if_needed) | Full |
| Staking | unstake | User (owner check) | Full |
| Staking | claim | User (owner check) | Full |
| Staking | deposit_rewards | seeds::program (Tax only) | Full |
| Staking | update_cumulative | seeds::program (Epoch only) | Full |
| BondingCurve | initialize_curve | **ANY SIGNER** | Full |
| BondingCurve | fund_curve | **ANY SIGNER** (needs tokens) | Full |
| BondingCurve | start_curve | **ANY SIGNER** | Full |
| BondingCurve | purchase | User (permissionless) | Full |
| BondingCurve | sell | User (permissionless) | Full |
| BondingCurve | mark_failed | Permissionless (deadline) | Full |
| BondingCurve | prepare_transition | **ANY SIGNER** | Full |
| BondingCurve | withdraw_graduated_sol | **ANY SIGNER** (receives SOL) | Full |
| BondingCurve | close_token_vault | **ANY SIGNER** (receives rent) | Full |
| BondingCurve | distribute_tax_escrow | Permissionless (graduated) | Full |
| BondingCurve | consolidate_for_refund | Permissionless (failed) | Full |
| BondingCurve | claim_refund | User (burns tokens) | Full |
| ConversionVault | initialize | Any signer (one-shot) | Full |
| ConversionVault | convert | Permissionless | Full |
| TransferHook | initialize_authority | **ANY SIGNER** (first wins) | Full |
| TransferHook | add_whitelist_entry | Stored authority | Full |
| TransferHook | burn_authority | Stored authority | Full |
| TransferHook | transfer_hook | Token-2022 runtime | Full |
| TransferHook | initialize_extra_account_meta_list | Any signer (one-shot) | Partial |

## 4. Account Structure

### Global Singletons (PDAs)
| Account | Program | Seeds | Key Fields |
|---------|---------|-------|------------|
| AdminConfig | AMM | `[b"admin"]` | admin: Pubkey, bump |
| EpochState | Epoch | `[b"epoch_state"]` | tax rates, VRF state, carnage state (100 bytes, no padding) |
| CarnageFundState | Epoch | `[b"carnage_fund"]` | held_token, held_amount, counters (139 bytes) |
| StakePool | Staking | `[b"stake_pool"]` | total_staked, rewards_per_token_stored (54 bytes) |
| WhitelistAuthority | Hook | `[b"authority"]` | authority: Option<Pubkey> |
| VaultConfig | ConvVault | `[b"vault_config"]` | bump only |

### Per-Entity (PDAs)
| Account | Program | Seeds | Key Fields |
|---------|---------|-------|------------|
| PoolState | AMM | `[b"pool", mint_a, mint_b]` | reserves, locked, fee_bps |
| CurveState | BondingCurve | `[b"curve", token_mint]` | status, tokens_sold, sol_raised, deadline_slot (192 bytes) |
| UserStake | Staking | `[b"user_stake", user]` | staked_balance, rewards_earned, checkpoint |
| WhitelistEntry | Hook | `[b"whitelist", address]` | existence-based |

## 5. Critical Invariants

| ID | Invariant | Enforcement | Status |
|----|-----------|-------------|--------|
| INV-1 | AMM k_after >= k_before | verify_k_invariant() post-swap | VERIFIED (10K proptest) |
| INV-2 | Tax split sum == total | Treasury = remainder | VERIFIED (10K proptest) |
| INV-3 | BC vault >= integral(0, tokens_sold) | Post-sell solvency assertion | VERIFIED (500K proptest) |
| INV-4 | Staking rewards <= deposited | Floor division + dead stake | VERIFIED (80K proptest) |
| INV-5 | Refund proportionality | Floor division + shrinking denominator | VERIFIED |
| INV-6 | VRF anti-reroll | pending_randomness_account binding | VERIFIED |
| INV-7 | Forward-only state transitions | Anchor constraints per instruction | VERIFIED |
| INV-8 | Tax rates bounded [100-1400] BPS | Discrete lookup tables | VERIFIED |
| INV-9 | Mint authority burned | initialize.ts burns all 3 | VERIFIED |
| INV-10 | CPI access: Tax->AMM only | seeds::program on swap_authority | VERIFIED (both audits) |

## 6. Critical Assumptions

| ID | Assumption | Validation Status |
|----|-----------|------------------|
| A-1 | BC authority signer is deployer | **NOT ENFORCED** -- any signer accepted |
| A-2 | Init instructions called before attackers | **NOT ENFORCED** -- relies on deployment ordering |
| A-3 | Cross-program seed constants match | Verified manually -- fragile if one side changes |
| A-4 | EpochState layout matches Tax mirror | Verified field-by-field -- no compile-time check |
| A-5 | AMM PoolState byte offsets (137-153) stable | Pool.rs MODIFIED -- **MUST RE-VERIFY** |
| A-6 | Switchboard oracle is honest | Trusted dependency -- pinned v0.11.3 |
| A-7 | Programs are non-upgradeable at mainnet | Not yet enforced -- devnet is upgradeable |
| A-8 | Conversion vault whitelisted before authority burn | **NOT VERIFIED** -- could brick conversions |
| A-9 | Mainnet placeholders replaced before deploy | 8+ Pubkey::default() across 3 programs |
| A-10 | taxes_confirmed intentionally unchecked by Tax | Design choice -- swaps use stale rates during VRF window |

## 7. Cross-Cutting Concerns

### 7.1 Bonding Curve Authority Gap (5 agents flagged)
The bonding curve program's 6 admin-labeled instructions accept ANY signer. This is the single most severe finding, flagged by:
- Access Control (CRITICAL), State Machine (HIGH), Token/Economic (HIGH), Upgrade/Admin (CRITICAL), Timing (MEDIUM)

**Root cause:** v1.2 program built without replicating AMM's ProgramData authority pattern.
**Impact:** ~2000 SOL theft (withdraw_graduated_sol), forced graduation (prepare_transition).

### 7.2 Cross-Program Struct Layout Coupling (4 agents flagged)
Tax Program's EpochState mirror and Epoch/Tax pool reserve byte reads create tight coupling:
- CPI (HIGH), Oracle (MEDIUM), Arithmetic (MEDIUM), State Machine (HIGH)

**Root cause:** No compile-time cross-crate verification mechanism.
**Impact:** Silent data corruption on layout changes -> wrong tax rates or broken slippage floors.

### 7.3 Initialization Front-Running (4 agents flagged)
5 programs use open initialization (any signer):
- Access Control (HIGH for transfer hook -- authority ransom), Upgrade/Admin (MEDIUM), Timing (MEDIUM), Verification AC (CONCERNS)

**Root cause:** AMM's ProgramData pattern not replicated across other programs.
**Impact:** Transfer hook authority capture would brick all token transfers.

### 7.4 No Emergency Pause (3 agents flagged)
Zero pause/freeze/emergency mechanisms across all 7 programs:
- Upgrade/Admin (HIGH), Token/Economic (MEDIUM), Economic Model (MEDIUM)

**Root cause:** Design choice -- relies on program upgrade for emergency response.
**Impact:** No circuit breaker if exploit discovered post-launch.

### 7.5 Sell Path AMM minimum_amount_out=0 (3 agents flagged)
Tax Program passes zero slippage to AMM on sell path:
- Timing (CRITICAL), Token/Economic (HIGH), CPI (MEDIUM)

**Root cause:** Tax is computed post-swap on gross output, so user minimum applies to net.
**Impact:** 50% output floor is only protection. Gap between 50% and user's minimum is extractable.

### 7.6 Pool Reserve Read Without Owner Check (2 agents flagged)
execute_carnage reads pool reserves at raw byte offsets without verifying AMM ownership:
- CPI (HIGH), Oracle (MEDIUM)

**Root cause:** Read optimization bypasses account validation.
**Impact:** Spoofed reserves -> invalid slippage floor -> Carnage value extraction.

## 8. Risk Heat Map

| Rank | Risk | Severity | Frequency | Programs Affected |
|------|------|----------|-----------|-------------------|
| 1 | BC authority gap (SOL theft) | CRITICAL | 5 agents | Bonding Curve |
| 2 | Transfer hook init front-running | CRITICAL | 4 agents | Transfer Hook |
| 3 | Sell path zero AMM slippage | HIGH | 3 agents | Tax, AMM |
| 4 | EpochState layout coupling | HIGH | 4 agents | Tax, Epoch |
| 5 | No emergency pause | HIGH | 3 agents | All 7 programs |
| 6 | Pool reserve read no owner check | HIGH | 2 agents | Epoch, Tax |
| 7 | Staking escrow rent depletion | HIGH | 2 agents | Staking |
| 8 | Mainnet Pubkey::default() placeholders | MEDIUM | 3 agents | Tax, BC, ConvVault |
| 9 | Carnage fallback MEV sandwich | MEDIUM | 3 agents | Epoch, Tax, AMM |
| 10 | No timelock on admin actions | MEDIUM | 2 agents | All programs |

## 9. Novel Attack Surface Observations

These are codebase-specific concerns that don't match standard vulnerability patterns:

1. **Bonding curve graduation MEV bundle**: Attacker bundles `prepare_transition` + 2x `withdraw_graduated_sol` to atomically steal ~2000 SOL when both curves reach Filled. No authority check prevents this. (Access Control + Upgrade/Admin)

2. **Two-account slippage oracle manipulation for Carnage**: Provide fake pool AccountInfo for slippage check (with inflated reserves), while real pool is used for CPI swap. Slippage floor becomes ineffective. (CPI + Oracle)

3. **Cross-epoch tax arbitrage via VRF observation**: Attacker monitors Switchboard reveal TX, predicts new tax rates, and executes trades at old (favorable) rates before `consume_randomness` lands. Unique to this protocol's per-epoch asymmetric tax design. (Oracle + Economic Model + Timing)

4. **Dual-curve grief attack**: Strategically prevent one curve from filling (sell near deadline from multiple wallets) to force both curves into refund mode. Costs only gas. (State Machine + Timing)

5. **Staking escrow destruction**: Last reward claimer drains escrow below rent-exempt minimum, destroying the PDA. Next deposit_rewards CPI fails, halting all swap tax distribution. (Token/Economic + Staking)

6. **Carnage VRF predictability window**: VRF reveal bytes are public on Switchboard before consume_randomness processes them. MEV bot can front-run Carnage swaps, especially on the fallback path after 50-slot lock expires. (Oracle + Timing)

7. **WSOL intermediary as DoS vector**: If swap_authority PDA lamports are drained below rent-exempt for intermediary recreation, all sell operations halt. (CPI + Token/Economic)

8. **Cross-program upgrade cascade**: Fixing one program requires rebuilding all programs that reference its ID. Multi-step non-atomic upgrade creates inconsistency window. (Upgrade/Admin)

## 10. Deduplicated Observations

| Observation | Sources | Dedup |
|---|---|---|
| BC authority unverified | AC, SM, TE, UA, TI | -> Single critical finding |
| EpochState mirror coupling | CPI, Oracle, Arith, SM | -> Single high finding |
| Init front-running (multiple programs) | AC, UA, TI, Verify-AC | -> Single high finding |
| Sell path AMM minimum=0 | TI, TE, CPI | -> Single high finding |
| taxes_confirmed not checked by Tax | Oracle, SM, TI | -> Design choice (documented) |
| No emergency pause | UA, TE, EM | -> Single medium finding |
| Bounty rent-exempt gap | AC, SM, EM | -> Known TODO (mitigated) |
| Unchecked `as u64` casts | Arith, CPI | -> Multiple locations (informational) |
| Carnage fallback sandwichable | TI, TE, EM | -> Single medium finding |
| force_carnage devnet gate | Oracle, UA, SM | -> Properly gated (informational) |

## 11. Previous Audit Status

### Confirmed Findings Recheck (15 from Audit #1)
| ID | Verdict in Audit #2 |
|----|---------------------|
| H001 | PARTIALLY MITIGATED (skip when insufficient, rent gap remains) |
| H113 | RESOLVED (mint authority burned in initialize.ts) |
| S005 | NOT FIXED (transfer hook init still front-runnable) |
| H041 | RESOLVED (tax math now uses u128 correctly) |
| S001 | NOT FIXED (staking escrow rent-exempt not checked) |
| S010 | MITIGATED (50% output floor added, sell path still passes 0) |
| H011 | RESOLVED BY REMOVAL (PROFIT pool deleted) |
| H043 | OBSERVATION SHIFTED (AMM ordering correct, caller passes wrong minimum) |
| H057 | NOT FIXED (epoch init no authority check) |
| H060 | STILL PRESENT + EXPANDED (no padding, now 7 programs) |
| H064 | MAINTAINED AT MEDIUM (epoch timing logic correct) |
| H106 | PARTIALLY ADDRESSED (comments added, no range constraints) |
| H125 | FIXED (has_one admin constraint) |
| H090 | ADDRESSED (auto-expire mechanism added) |
| H119 | NO NEW CONCERNS (constants reasonable) |
