# Stronghold of Security - Final Audit Report

**Project:** Dr. Fraudsworth's Finance Factory
**Audit Date:** 2026-03-21
**Audit ID:** sos-003-20260321-dc063ec
**Git Ref:** `dc063ec`
**Auditor:** Claude Code Stronghold of Security v1.0
**Scope:** Full codebase security analysis — 7 Solana/Anchor programs + off-chain scripts
**Files Scanned:** 155 files, ~40K LOC
**Audit #:** 3 (stacked on Audit #2 @ `f891646`, 2026-03-08)

---

## Executive Summary

### Overall Security Posture

Dr. Fraudsworth's Finance Factory has undergone significant hardening since Audit #2. All five CRITICAL findings from the prior audit (BC admin authority gap, Transfer Hook front-running, combined deployment attack) have been correctly remediated with the BcAdminConfig PDA pattern, ProgramData upgrade authority gates, and deploy-pipeline automation. The protocol's Anchor constraints, PDA-derived CPI authorization chains, and Synthetix-style staking math are well-implemented and internally consistent.

However, the audit identifies a cluster of interconnected HIGH-severity findings centered on the Carnage Fund mechanism. The optional `carnage_state` account in `consume_randomness` (H009/H014) enables permanent, near-zero-cost suppression of the protocol's core differentiating feature. This suppression composes with the fallback MEV sandwich vector (H010) and VRF pre-reveal information leakage (H019/S008) to form a multi-dimensional attack surface (S001/S006) that a rational economic actor would exploit. Additionally, devnet program keypairs with full secret keys remain committed to git history (S004, CRITICAL), and the absence of an emergency pause mechanism (H020) leaves the protocol unable to halt operations if a vulnerability is discovered post-launch. The single-step admin transfer pattern (H015) introduces irreversible operational risk during the planned Squads governance migration.

The protocol's economic design is sound and self-consistent. The constant-product AMM invariant, the Synthetix reward accumulation model, and the 71/24/5 tax distribution split are correctly implemented. The linear bonding curve math is robust with checked arithmetic throughout. The transfer hook whitelist enforcement and reentrancy check (H059) are correctly implemented.

### Key Statistics

| Metric | Count |
|--------|-------|
| Total Hypotheses Investigated | 75 (65 H-series + 10 S-series) |
| CONFIRMED Vulnerabilities | 36 |
| CONFIRMED FIXED (Previous Findings) | 3 |
| POTENTIAL Issues | 8 |
| Cleared (NOT VULNERABLE / FALSE POSITIVE) | 16 |
| Informational | 12 |

### Severity Breakdown

| Severity | Count | Immediate Action Required |
|----------|-------|---------------------------|
| CRITICAL | 1 | YES - Address before any public deployment |
| HIGH | 9 | YES - Fix before mainnet launch |
| MEDIUM | 10 | Recommended before launch |
| LOW | 16 | Fix when convenient |
| INFORMATIONAL | 12 | No action required |

### Audit Evolution (Stacked Audit #3 on #2)

| # | Date | Git Ref | Confirmed | Potential | Notes |
|---|------|---------|-----------|-----------|-------|
| 1 | 2026-02-22 | `be95eba` | 15 | 11 | Initial audit -- 5 programs |
| 2 | 2026-03-07 | `f891646` | 19 | 1 | +2 programs (BC, Vault), 71 files changed |
| 3 | 2026-03-21 | `dc063ec` | 36 | 8 | All 98 Rust files modified; admin transfers, carnage refactor |

**Previous Finding Resolution:**
- **FIXED:** 12 of 19 prior CONFIRMED findings are verified remediated (H001/H002/H010 BC authority, H007 Hook init, S006 combined attack, H008 sell slippage, H012/S003 rent depletion, H036 init front-running, S007 layout tests, H003 BC init, H005 close_token_vault, H021 epoch init)
- **NOT FIXED (Structural):** 3 findings accepted as architectural limitations (H049/H021 upgrade cascade, H058/H022 CPI depth, S005/H020 no emergency pause)
- **NOT FIXED (Accepted):** 4 findings accepted at current severity (H031/H045 dual-curve grief, H048/H046 taxes_confirmed, H077/H047 unchecked cast, H014/H048 output floor)

**Regressions:** None identified. No previously fixed finding has regressed.

**Recurrent findings (surviving 2+ audits):**
- **H020 (No Emergency Pause)** -- Present in Audit #1 (S005), #2 (S005), and #3 (H020). THREE audits have flagged this. See prominent warning below.
- **H021 (Cross-Program Upgrade Cascade)** -- Present in Audit #2 (H049) and #3 (H021). Structural limitation, accepted.
- **H022 (CPI Depth 4/4)** -- Present in Audit #2 (H058) and #3 (H022). Structural limitation, accepted.

### Top Priority Items

1. **S004**: Devnet program keypairs (full secret keys) committed to git history - CRITICAL
2. **H009/H014**: Carnage suppression via optional `carnage_state` account omission - HIGH
3. **H010/S006**: Carnage fallback MEV sandwich with 25% extraction window - HIGH
4. **H015**: Single-step irreversible admin authority transfer (all 3 programs) - HIGH
5. **H020**: No emergency pause mechanism (RECURRENT -- 3rd audit flagging this) - HIGH

---

## Critical Findings

### S004: Program Keypair Extraction from Git History

**Severity:** CRITICAL
**Status:** CONFIRMED (NEW)
**Category:** Supply Chain, Key Management
**Location:** `keypairs/*.json` (git history, multiple commits)

**Description:**
All 7 production devnet program keypairs — containing full 64-byte secret keys — are committed to the git repository at HEAD and across multiple historical commits. Any person who has cloned the repository holds the private key for every devnet program's upgrade authority. Multiple generations of devnet keypairs are directly extractable from commits spanning Phase 30 through Phase 102.

**Mitigating factor:** Mainnet vanity keypairs (`cRiME...`, `FraUd...`, `pRoFiT...`) are correctly gitignored and have NEVER appeared in the repository's history. The immediate risk is limited to devnet program compromise. However, the practice of committing keypairs normalizes a dangerous pattern and creates operational risk if the gitignore is ever misconfigured for mainnet.

**Impact:**
- Complete devnet program compromise: any repository collaborator can upgrade all 7 devnet programs
- If the repository ever becomes public, all devnet program upgrade authorities are immediately exposed
- Operational precedent risk: normalizing keypair commits increases probability of mainnet key exposure

**Recommended Fix:**
1. Rotate all devnet program keypairs immediately after this audit
2. Purge git history of all keypair files using `git filter-repo` or BFG Repo Cleaner
3. Restrict `keypairs/` file permissions to `chmod 600` (owner read-write only)
4. Add manifest-based address validation to `sync-program-ids.ts` to detect keypair substitution
5. Store production keypairs in a secrets manager, not in any git-tracked path

**Priority:** Address before any public repository access or mainnet deployment

---

## High Priority Findings

### H009: Carnage Suppression via Optional Account Omission

**Severity:** HIGH
**Status:** CONFIRMED (NEW)
**Category:** Access Control, State Machine, Economic
**Location:** `programs/epoch-program/src/instructions/consume_randomness.rs:76-80`

**Description:**
The `carnage_state` account in `consume_randomness` is declared `Option<Account<'info, CarnageFundState>>`. Any caller can submit a valid `consume_randomness` transaction omitting this account, consuming the VRF and advancing epoch taxes while silently skipping the Carnage trigger check entirely. The VRF is spent and cannot be replayed.

**Attack Scenario:**
A MEV bot monitors for oracle reveals, then front-runs `consume_randomness` with a version omitting `carnage_state`. Cost: ~0.000005 SOL per epoch. Effect: 100% of Carnage events permanently suppressed.

**Impact:**
- Carnage Fund rebalancing mechanism permanently disabled
- Accumulated vault SOL sits idle indefinitely (24% of all swap taxes)
- Protocol's core differentiating mechanic (unpredictable buy pressure) neutralized

**Recommended Fix:**
```rust
// Change from Option to mandatory:
#[account(seeds = [CARNAGE_FUND_SEED], bump)]
pub carnage_state: Account<'info, CarnageFundState>,
```

**Priority:** Must fix before mainnet launch -- this is a one-line change that eliminates the entire attack surface.

---

### H014: Carnage Suppression as Economic Manipulation

**Severity:** HIGH
**Status:** CONFIRMED (NEW)
**Category:** Economic, MEV
**Location:** Same root cause as H009

**Description:**
Shares H009's root cause but focuses on the economic incentive dimension. Any actor holding the "expensive" token benefits financially from suppressing Carnage at near-zero cost. The cost/benefit ratio is approximately 175,000:1 (0.00012 SOL cost per day vs. preventing ~21 SOL of expected buy pressure).

**Impact:** The attack is economically rational at essentially any position size. Fix is identical to H009.

---

### H010: Carnage Fallback MEV Sandwich Extraction

**Severity:** HIGH
**Status:** CONFIRMED (NEW)
**Category:** MEV, Token/Economic
**Location:** `epoch-program/src/helpers/carnage_execution.rs:324-350`, `epoch-program/src/constants.rs:132`

**Description:**
After the 50-slot atomic lock window expires, the Carnage fallback path is permissionless with publicly visible `carnage_target` and a 75% slippage floor computed against **live (manipulable) reserves**. A MEV actor can front-run the Carnage buy by pumping the target pool, execute the Carnage swap at the inflated price, then back-run by selling.

**Attack Scenario:**
1. Observe `carnage_pending = true` and target token on-chain
2. Wait for lock window expiry (50 slots)
3. Front-run: Buy target token to inflate price
4. Submit `execute_carnage` -- slippage floor is computed from already-inflated reserves
5. Back-run: Sell position for profit

**Impact:**
- Maximum extraction per fallback event: 250 SOL (25% of 1000 SOL cap)
- Realistic extraction: 50-200 SOL per event with moderate pool depth
- The `MINIMUM_OUTPUT = 0` at the AMM layer provides no backstop

**Recommended Fix:**
1. Minimize fallback window (crank executes at slot 51)
2. Increase fallback slippage floor from 7500 to 8500 BPS
3. Store pre-committed reserve snapshot in EpochState at trigger time for slippage computation
4. Execute fallback via Jito bundles to prevent front-running

---

### H015: Admin Authority Transfer to Wrong Address (Irreversible)

**Severity:** HIGH
**Status:** CONFIRMED (NEW)
**Category:** Access Control, Key Management
**Location:** `amm/instructions/transfer_admin.rs`, `bonding_curve/instructions/transfer_bc_admin.rs`, `transfer-hook/instructions/transfer_authority.rs`

**Description:**
All three authority transfer patterns are single-step: the new authority takes effect immediately with no confirmation from the new key holder. The sole guard is rejection of `Pubkey::default()`. Any other mistyped address is accepted irreversibly. The planned Squads governance migration creates a concrete, high-stakes opportunity window.

**Impact:**
- **AMM:** Cannot create new pools (existing pools unaffected)
- **Bonding Curve:** Graduated SOL permanently stranded in vault (FINANCIAL LOSS)
- **Transfer Hook:** Whitelist permanently frozen; protocol expansion blocked

**Recommended Fix:**
Implement two-step propose-and-accept pattern. Add `pending_admin: Option<Pubkey>` to config PDAs. Current admin proposes; new admin accepts by signing.

---

### H020: No Emergency Pause Mechanism

**Severity:** HIGH
**Status:** CONFIRMED (RECURRENT -- 3rd audit)
**Category:** Upgrade/Admin, Risk Management
**Location:** All 7 programs

> **WARNING: This finding has been flagged in ALL THREE audits (Audit #1 as S005, Audit #2 as S005, Audit #3 as H020). It has survived two remediation cycles. The absence of an emergency pause is the most persistent architectural gap in the protocol.**

**Description:**
No program implements pause, freeze, or emergency halt functionality. Post-launch, the sole response to a critical vulnerability is a full program upgrade through the Squads 2-of-3 multisig with mandatory timelock delay. During the delay (estimated 2-24 hours including triage, fix, build, proposal, and timelock), vulnerable code remains live and exploitable.

**Impact:**
Quantified exploit window: minimum 2 hours for a well-prepared team with a pre-built fix template, up to 24+ hours for a novel vulnerability requiring new code. During this window, all 7 programs continue processing transactions with no circuit breaker.

**Recommended Fix:**
Add a `paused: bool` flag to each program's config PDA. Gate all user-facing instructions behind `require!(!config.paused)`. Admin or multisig can set `paused = true` in a single transaction.

---

### S001: Carnage Suppression + Tax Arbitrage Combined Attack

**Severity:** HIGH
**Status:** CONFIRMED (NEW)
**Category:** Economic, MEV, Access Control
**Location:** Composes H009 + H019

**Description:**
An attacker can suppress Carnage (H009) AND front-run tax rate changes (H019) simultaneously in the same epoch transition. Both attacks exploit the same 2-5 slot window after the Switchboard oracle reveals VRF bytes, require the same funded wallet, and are mechanically independent but temporally aligned. Combined profit is strictly super-additive.

**Impact:** The attacker simultaneously eliminates Carnage buy pressure AND trades ahead of known tax rate changes, amplifying extraction from both vectors.

**Recommended Fix:** Fix H009 (make `carnage_state` mandatory) to break the composition.

---

### S002: Carnage Fund Vault Accumulation Under Suppression

**Severity:** HIGH
**Status:** CONFIRMED (NEW)
**Category:** Economic, State Machine
**Location:** Composes H009 + H014

**Description:**
Under sustained H009 suppression, the Carnage vault grows monotonically at 24% of all swap taxes. When suppression is lifted, the next trigger deploys the full accumulated balance in a single swap, creating a massive, predictable price-impact event that can be sandwich-attacked via H010.

**Impact:** The longer suppression continues, the larger the eventual discharge. This creates a "ticking time bomb" dynamic where fixing H009 itself becomes a sandwichable event.

**Recommended Fix:** Fix H009 AND add a per-trigger spend cap that ramps gradually rather than deploying the entire vault at once.

---

### S003: Stale Mainnet Mints Cause Silent Graduation Failure

**Severity:** HIGH
**Status:** CONFIRMED (NEW)
**Category:** Configuration, Upgrade/Admin
**Location:** `bonding_curve/src/constants.rs:176-195`, `conversion-vault/src/constants.rs:35-68`

**Description:**
Five mint-address functions across Bonding Curve and Conversion Vault contain stale Phase 69/95 devnet addresses in their mainnet branches. Deployment without `patch-mint-addresses.ts` produces non-functional programs. No `compile_error!` guards exist anywhere.

**Impact:** Guaranteed non-functional mainnet deployment if build pipeline is skipped or broken. Programs fail closed (no fund loss), but graduated SOL would be stranded until redeploy. Severity is HIGH due to financial stranding risk.

**Recommended Fix:** Add `compile_error!` guards to all mainnet mint-address functions that hold stale values.

---

### S006: Fallback MEV + Carnage Suppression Alternation Strategy

**Severity:** HIGH
**Status:** CONFIRMED (NEW)
**Category:** MEV, Economic, State Machine
**Location:** Composes H009 + H010

**Description:**
An attacker suppresses Carnage for multiple epochs to grow the vault, then allows exactly one trigger to proceed through the fallback path and sandwiches it. The vault has grown disproportionately, so the sandwich payout is much larger than normal.

**Impact:** Expected compound extraction: 5-30 SOL/day in adversarial conditions. The 1000 SOL per-trigger cap limits individual events but the frequency-scaling strategy maximizes vault utilization.

**Recommended Fix:** Fix H009 to eliminate suppression capability.

---

## Medium Priority Findings

| ID | Title | Status | Location | Recommendation |
|----|-------|--------|----------|----------------|
| H019 | Cross-Epoch Tax Rate Arbitrage | CONFIRMED | `consume_randomness.rs`, `swap_sol_buy.rs` | Consider adding `taxes_confirmed` check to Tax Program or reducing oracle-reveal-to-consume window |
| H021 | Cross-Program Upgrade Cascade | CONFIRMED (RECURRENT) | All 7 programs (15+ cross-refs) | Add struct-hash/version field; create atomic multi-program upgrade playbook |
| H022 | CPI Depth at 4/4 Hard Limit | CONFIRMED (RECURRENT) | `carnage_execution.rs` | Document the constraint prominently; add compile-time depth tracking comment |
| H024 | Single Switchboard Oracle Dependency | CONFIRMED | `trigger_epoch_transition.rs`, `retry_epoch_vrf.rs` | Add admin emergency epoch-advance bypass for network-wide Switchboard outage |
| H026 | Staking Reward Forfeiture Game of Chicken | CONFIRMED (Design) | `staking/unstake.rs` | Document forfeiture mechanic prominently in user-facing docs; consider partial forfeiture |
| H028 | remaining_accounts Forwarding Without Length Validation | CONFIRMED | Tax Program (swap_sol_buy, swap_sol_sell, swap_exempt) | Add `require!(remaining_accounts.len() == expected)` in Tax Program swap paths |
| H030 | Admin SOL Withdrawal Centralization | CONFIRMED | `bonding_curve/withdraw_graduated_sol.rs` | Transfer to Squads multisig; add timelock for withdrawals |
| H037 | AMM Program ID Cluster Mismatch | CONFIRMED | `tax-program/src/constants.rs:99-101` | Add Tax-to-AMM cross-reference to `sync-program-ids.ts` CROSS_REFS registry; fix `Pubkey::from_str` vs `pubkey!` pattern mismatch |
| S007 | Cross-Program Discriminator Mismatch After Rename | CONFIRMED | Tax and Epoch `constants.rs` (3 discriminators) | Add cross-crate discriminator assertion tests to `tests/cross-crate/` |
| S008 | VRF Reveal Enables Carnage Target Prediction | CONFIRMED | `consume_randomness.rs`, Switchboard oracle | Reduce oracle-reveal-to-consume slot window; execute via Jito bundles |
| S009 | PoolState Layout Drift Between Tax and Epoch Readers | CONFIRMED | `pool_reader.rs`, `carnage_execution.rs` | Consolidate into shared utility crate; add PoolState offset test to cross-crate suite |
| H048 | Buy Path 50% Output Floor Adequacy | CONFIRMED (Design) | `tax-program/swap_sol_buy.rs:106-111` | Document that the 50% floor is a backstop, not tight slippage protection |
| H064 | distribute_tax_escrow Timing | CONFIRMED | `bonding_curve/distribute_tax_escrow.rs` | Move status guard to Anchor constraint level |

---

## Low Priority Findings

| ID | Title | Status | Location | Recommendation |
|----|-------|--------|----------|----------------|
| H007 | Cross-Program Layout Test Incomplete Coverage | POTENTIAL (LOW) | `tests/cross-crate/src/lib.rs` | Add PoolState offset test; complete tax_to_epoch field assertions |
| H008 | Mainnet Placeholder Fix Partial | POTENTIAL (HIGH) | BC/Vault `constants.rs` | Add `compile_error!` guards (covered by S003 recommendation) |
| H011 | Cross-Program Byte-Offset Corruption Risk | POTENTIAL (HIGH) | `pool_reader.rs`, `carnage_execution.rs` | Add PoolState layout test; add DATA_LEN assertion; add struct-hash |
| H012 | Build-Pipeline Supply Chain Risk | POTENTIAL (HIGH) | `keypairs/`, `sync-program-ids.ts` | Address validation manifest; restrict permissions (covered by S004) |
| H013 | VRF Freshness Underflow | POTENTIAL (LOW) | `trigger_epoch_transition.rs:174` | Add `require!(seed_slot <= clock.slot)` guard |
| H023 | stake_pool Unconstrained at Epoch Level | POTENTIAL (LOW) | `consume_randomness.rs` | Add PDA seeds constraint or owner check for defense-in-depth |
| H025 | Conversion Vault Fixed-Rate Arbitrage | CONFIRMED (Design, LOW) | `convert.rs:101-113` | Bounded by vault balance and swap taxes; document as intended |
| H027 | Bonding Curve Sybil Cap Bypass | CONFIRMED (Design, INFO) | `purchase.rs:134-141` | Per-wallet cap is a UX feature, not Sybil defense; document clearly |
| H029 | Hardcoded CPI Discriminators Fragility | CONFIRMED (Mitigated, MEDIUM) | Tax/Epoch `constants.rs` | Add test assertions (covered by S007) |
| H031 | Carnage Fund Accumulation as MEV Target | CONFIRMED (MEDIUM) | `carnage_execution.rs` | Add vault ceiling; use Jito bundles for fallback execution |
| H034 | Sequential Multi-Swap Composability | INFORMATIONAL | Tax Program | No action needed; standard DEX composability |
| H036 | Conversion Vault No Rate Limit | CONFIRMED (Design, LOW) | `convert.rs` | Bounded by vault balance; document as intended |
| H039 | Carnage Fallback No Bounty Liveness | CONFIRMED (LOW) | `execute_carnage.rs` | Add small bounty (e.g., 0.001 SOL) to incentivize fallback execution |
| H040 | Manual SPL Discriminator Fragility | CONFIRMED (LOW) | Tax Program `swap_sol_sell.rs` | SPL discriminators stable since 2020; document the assumption |
| H047 | Unchecked as u64 Cast in get_current_price | CONFIRMED (LOW) | `bonding_curve/math.rs:222-225` | Return Result instead of unwrap_or; display-only function |
| H049 | get_current_price Silent Saturation | POTENTIAL (LOW) | `bonding_curve/math.rs` | Same fix as H047 |
| H051 | claim_refund Last-Claimer Rounding | CONFIRMED (LOW) | `claim_refund.rs:159-164` | Bounded to 1 lamport per prior claim; negligible |
| H052 | Conversion Vault Truncation Loss | CONFIRMED (LOW) | `conversion-vault/convert.rs:103` | 99 base units max loss per conversion; negligible |
| H054 | Stale carnage_target After Expiry | CONFIRMED (LOW) | `expire_carnage.rs` | Clear `carnage_target` on expiry for state hygiene |
| H056 | Staking Cooldown Timestamp Manipulation | CONFIRMED (LOW) | `staking/claim.rs` | 0.07% deviation on mainnet; negligible |
| H058 | WSOL Intermediary Rent Assumption | CONFIRMED (LOW) | `swap_sol_sell.rs` | Add explicit balance guard before re-init |
| H059 | Transfer Hook Reentrancy Check | CONFIRMED (Correctly Implemented, LOW) | `transfer_hook.rs:77-113` | No action; check is present and correct |
| H060 | Bonding Curve Refund Ordering | POTENTIAL (LOW) | `claim_refund.rs` | Bounded to dust; negligible |
| H062 | burn_authority Idempotency | CONFIRMED (LOW) | `burn_authority.rs` | Add explicit "already burned" error instead of silent success |
| H065 | Bonding Curve Solvency Buffer | CONFIRMED (LOW) | BC constants | 10 lamports adequate; 2x safety margin over observed worst case |
| S005 | Admin Transfer Frontrun | NOT VULNERABLE (frontrun) | All admin transfers | Frontrunning not possible on Solana; H015 single-step risk remains |
| S010 | Conversion Vault PROFIT Drain | CONFIRMED (LOW) | `convert.rs` | Tax friction prevents profitable grinding; bounded by vault balance |

---

## Informational Notes

| ID | Title | Observation |
|----|-------|-------------|
| H033 | Sell-Then-Buy Carnage Compound Slippage | Not exploitable as described; entirely atomic within one instruction |
| H038 | Transfer Hook Whitelist Bypass via Proxy | Token-2022 enforces hook on all transfers; proxy cannot bypass |
| H046 | taxes_confirmed Unchecked | Intentional design for liveness; negligible economic impact |
| H053 | carnage_lock_slot Not Explicitly Initialized | Anchor zero-fills on init; inconsistency with other fields but harmless |
| H055 | Epoch Skip Reward Forfeiture | No forfeiture occurs; Synthetix model accumulates continuously |
| H057 | Micro-Tax Edge Case | <4 lamports routes 100% to staking; intentional dust handling |
| H063 | force_carnage Devnet Gate | Correctly gated behind `#[cfg(feature = "devnet")]`; absent from mainnet binary |

---

## Investigated & Cleared

The following hypotheses were investigated and found NOT VULNERABLE:

<details>
<summary>Click to expand cleared items (16 total)</summary>

| ID | Hypothesis | Why Safe |
|----|------------|----------|
| H001 | BC Admin Authority Fix | BcAdminConfig PDA with upgrade authority gate correctly implemented across all 6 admin-gated instructions |
| H002 | Transfer Hook Init Front-Run Fix | ProgramData gate correctly closes front-running, re-initialization, and arbitrary authority input vectors |
| H003 | Combined Hook+BC Deployment Attack | Both programs independently hardened; no shared state between init paths |
| H004 | Sell Path Slippage Fix | Two-step slippage architecture correctly implemented; gross_floor passed to AMM |
| H005 | Staking Escrow Rent Depletion Fix | Rent-exempt guard with live Rent sysvar correctly prevents drain below threshold |
| H006 | Init Front-Running Fixes | Both staking and epoch inits correctly gate on ProgramData upgrade authority |
| H016 | swap_exempt Sandwich Within AMM | Reserve snapshot and swap CPI are sequential within single instruction; no inter-instruction gap |
| H017 | Duplicate Mutable Accounts in Carnage | Anchor PDA constraints + Solana runtime duplicate detection provide three prevention layers |
| H018 | Carnage held_token Raw u8 Matching | Encoding path provably closed; internal implementation detail |
| H032 | Cross-Program EpochState Tax Rate Trust | Tax rates bounded by derivation logic; owner check validates EpochState source |
| H035 | WSOL Delegate Authority Exploit | FALSE POSITIVE -- SPL Token semantics prevent delegate exploitation in this context |
| H041 | Epoch Skip Staking Reward Forfeiture | Synthetix model accumulates continuously; no epoch-skip forfeiture occurs |
| H045 | Dual-Curve Grief | Economically constrained; 15% sell tax + buying opportunity make attack prohibitive |
| H050 | Bonding Curve Sell Tax u64 Overflow | Domain constraints (max 500 SOL, hardcoded 1500 BPS) prevent overflow |
| H061 | start_curve Deadline Overflow | Cannot overflow in practice; would require ~year 100,000 of network operation |
| S005 | Admin Transfer Frontrun | `has_one` constraint requires current admin's signature; Solana prevents frontrunning |

</details>

---

## Confirmed Fixed (Previous Findings Remediated)

| ID | Previous Finding | Fix Applied | Verification |
|----|------------------|-------------|--------------|
| H042 | BC initialize_curve front-running (H003) | `has_one = authority` on BcAdminConfig | Verified correct |
| H043 | BC close_token_vault rent extraction (H005) | `has_one = authority` + state guards | Verified correct |
| H044 | Epoch init front-running (H021) | ProgramData upgrade authority gate | Verified correct |

---

## Combination Attack Analysis

### Systematic Combination Matrix

The following matrix identifies non-trivial interactions between CONFIRMED and POTENTIAL findings. Only cells with at least one YES answer to the five combination questions are shown.

| | H009 | H010 | H014 | H015 | H019 | H020 | H024 | S008 |
|------|------|------|------|------|------|------|------|------|
| **H009** | -- | enables | shared_root | -- | enables | amplifies | -- | enables |
| **H010** | -- | -- | -- | -- | -- | amplifies | -- | enables |
| **H014** | shared_root | -- | -- | -- | amplifies | amplifies | -- | -- |
| **H015** | -- | -- | -- | -- | -- | amplifies | -- | -- |
| **H019** | enables | -- | amplifies | -- | -- | -- | -- | shared_root |
| **H020** | amplifies | amplifies | amplifies | amplifies | -- | -- | amplifies | -- |
| **H024** | -- | -- | -- | -- | -- | amplifies | -- | -- |
| **S008** | enables | enables | -- | -- | shared_root | -- | -- | -- |

**Key Interaction Clusters:**

1. **Carnage Manipulation Cluster (H009 + H010 + H014 + S008):** H009 enables vault accumulation; H010 enables MEV extraction; H014 provides economic motivation; S008 provides information advantage. These four findings form a self-reinforcing attack loop.

2. **Emergency Response Gap (H020 + any HIGH):** H020 amplifies every other HIGH finding because the exploit window cannot be closed quickly. Any HIGH finding becomes effectively CRITICAL during the 2-24 hour remediation window.

3. **Information Asymmetry Cluster (H019 + S008 + H009):** VRF pre-reveal (S008/H019) provides the information needed to selectively suppress Carnage (H009) only when it would trigger, maximizing efficiency.

### Identified Attack Chains

#### Chain 1: Carnage Fund Manipulation Loop

**Component Findings:**
- H009: Carnage suppression via optional account omission (ROOT CAUSE)
- H014: Economic incentive for suppression
- S001: Combined suppression + tax arbitrage
- S002: Vault accumulation under suppression
- S006: Alternation strategy (suppress, then sandwich)
- H010: Fallback MEV sandwich extraction
- S008: VRF pre-reveal information leakage

**Combined Attack:**
1. Bot monitors Switchboard oracle reveals (S008)
2. Every epoch: submit `consume_randomness` without `carnage_state` (H009)
3. Optionally front-run tax rate changes (H019/S001)
4. After N epochs of accumulation (S002), allow one Carnage trigger
5. Ensure atomic path fails (or wait for fallback window)
6. Sandwich the inflated Carnage buy (H010/S006)
7. Repeat

**Combined Severity:** CRITICAL (individual HIGHs compound to CRITICAL via systematic exploitation)

**Mitigation:** Fix H009 (one-line change). This single fix breaks steps 2, 3, and the entire accumulation-then-sandwich strategy.

#### Chain 2: Post-Launch Vulnerability Response Failure

**Component Findings:**
- H020: No emergency pause (ROOT CAUSE)
- H015: Irreversible admin transfer during Squads migration
- H024: Oracle dependency -- protocol halt on Switchboard outage

**Combined Attack:**
If a critical vulnerability is discovered post-launch, there is no way to stop transaction processing. During the 2-24 hour upgrade cycle (write fix, build, propose to multisig, wait for timelock), the vulnerability is actively exploitable. If the admin key was accidentally lost during Squads migration (H015), the upgrade authority may also be compromised, extending the window indefinitely.

**Combined Severity:** HIGH

**Mitigation:** Add emergency pause to all 7 programs. This is the single highest-leverage architectural improvement remaining.

---

## Attack Trees

### Goal: Drain Carnage Fund Value via MEV

```
GOAL: Extract maximum value from Carnage Fund
|
+-- PATH A: Direct Suppression + Accumulation + Sandwich (H009 -> S002 -> S006 -> H010)
|   +-- STEP 1: Suppress Carnage every epoch by omitting carnage_state [H009, CONFIRMED]
|   +-- STEP 2: Vault accumulates 24% of all swap taxes [S002, CONFIRMED]
|   +-- STEP 3: Allow one trigger after N epochs of accumulation [S006, CONFIRMED]
|   +-- STEP 4: Ensure fallback path (wait 50 slots or cause atomic failure)
|   +-- STEP 5: Sandwich the Carnage buy with 25% extraction [H010, CONFIRMED]
|   +-- ESTIMATED VALUE: 50-200 SOL per orchestrated event
|
+-- PATH B: Selective Suppression with Tax Arbitrage (S008 -> H009 -> H019 -> S001)
|   +-- STEP 1: Read VRF bytes from oracle reveal [S008, CONFIRMED]
|   +-- STEP 2: Suppress only Carnage-triggering epochs [H009, CONFIRMED]
|   +-- STEP 3: Front-run tax rate change for arbitrage [H019, CONFIRMED]
|   +-- STEP 4: Profit from both suppression and arbitrage [S001, CONFIRMED]
|   +-- ESTIMATED VALUE: 5-30 SOL/day ongoing
|
+-- PATH C: Opportunistic Fallback Sandwich (H010 alone)
    +-- STEP 1: Monitor for carnage_pending state [CONFIRMED]
    +-- STEP 2: Wait for fallback window (slot 50-300)
    +-- STEP 3: Sandwich with front-run buy + back-run sell [H010, CONFIRMED]
    +-- ESTIMATED VALUE: 50-250 SOL per natural fallback event

CRITICAL NODE: H009 -- Fixing this breaks Paths A and B entirely (2 of 3 paths)
SECONDARY NODE: H010 -- Fixing this breaks extraction in Paths A and C (2 of 3 paths)
```

### Goal: Permanently Disable Protocol Functions

```
GOAL: Make protocol non-functional or non-recoverable
|
+-- PATH A: Admin Key Loss During Migration (H015)
|   +-- STEP 1: Clipboard hijack or typo during Squads transfer [H015, CONFIRMED]
|   +-- LEAF: Authority permanently lost; no on-chain recovery [CONFIRMED]
|
+-- PATH B: Oracle-Dependent Protocol Halt (H024)
|   +-- STEP 1: Switchboard network-wide outage [H024, CONFIRMED]
|   +-- LEAF: Epochs cannot advance; tax rates frozen; Carnage disabled [CONFIRMED]
|
+-- PATH C: Deployment with Stale Constants (H008 + H037 + S003)
|   +-- STEP 1: Build without running build.sh [H037, CONFIRMED]
|   +-- STEP 2: Deploy with devnet mints in mainnet binary [S003, CONFIRMED]
|   +-- LEAF: All bonding curves and vault reject real mints [CONFIRMED]
|
+-- PATH D: No Pause + Active Exploit (H020 + any vulnerability)
    +-- STEP 1: Discover exploitable vulnerability post-launch
    +-- STEP 2: Exploit runs unimpeded during 2-24h upgrade window [H020, CONFIRMED]
    +-- LEAF: Accumulated damage proportional to exploit value x time window

CRITICAL NODE: H020 -- Adding pause breaks Path D for ANY future vulnerability
```

### Critical Fix Nodes (Summary)

| Finding | Attack Paths Broken if Fixed | Recommendation Priority |
|---------|------------------------------|------------------------|
| H009 | 2 of 3 Carnage MEV paths + all compound strategies (S001, S002, S006) | Fix FIRST |
| H020 | All future vulnerability exploitation windows | Fix SECOND |
| H010 | 2 of 3 Carnage MEV paths | Fix THIRD |
| H015 | Admin key loss path | Fix FOURTH (before Squads migration) |

---

## Severity Re-Calibration Notes

After reviewing all findings holistically, the following severity adjustments were made:

| Finding | Original Severity | Adjusted Severity | Reason |
|---------|-------------------|-------------------|--------|
| H009 | HIGH | HIGH (confirmed -- no change, but note: combined with S001/S002/S006, the cluster reaches CRITICAL) | Root cause of 5 downstream compound findings |
| H020 | HIGH | HIGH (RECURRENT WARNING) | Third consecutive audit flagging this; amplifies every other HIGH finding |
| S003 | HIGH | HIGH (confirmed -- no change) | Financial stranding risk for graduated SOL |
| H025 | Originally Tier 2 | LOW | Reclassified: bounded by vault balance, swap taxes make arbitrage unprofitable |
| H027 | Originally Tier 2 | INFORMATIONAL | Reclassified: per-wallet cap is UX feature, not security control; Sybil resistance not achievable on Solana |
| H033 | Originally Tier 2 | INFORMATIONAL | Entirely atomic within one instruction; not exploitable as described |
| H034 | Originally Tier 2 | INFORMATIONAL | Standard DEX composability; not a vulnerability |
| H036 | Originally Tier 2 | LOW | Bounded by vault balance; documented as intended design |
| H041 | Originally Tier 2 | INFORMATIONAL | FALSE POSITIVE -- no forfeiture occurs |
| H064 | MEDIUM | MEDIUM (confirmed) | Permissionless + runtime-only guard; upgrade to Anchor constraint recommended |

---

## Requires Manual Expert Review

| ID | Title | Uncertainty | Recommended Expertise |
|----|-------|-------------|----------------------|
| H010 | Carnage Fallback MEV Sandwich | Quantitative extraction depends on pool depth, which varies | DeFi MEV specialist to model realistic extraction vs. pool size curves |
| H020 | Emergency Pause Design | Best pause implementation varies by protocol architecture | Smart contract architect with emergency response experience |
| H015 | Two-Step Transfer Pattern | State space expansion affects PDA size and rent | Anchor/Solana architect for optimal propose-accept PDA design |

---

## Recommendations Summary

### Immediate Actions (Before Mainnet Launch)

1. [ ] **H009/H014**: Make `carnage_state` mandatory in `consume_randomness` (one-line change -- highest leverage fix in the entire audit)
2. [ ] **S004**: Rotate devnet keypairs; purge git history; restrict file permissions
3. [ ] **H015**: Implement two-step propose-and-accept admin transfer before Squads migration
4. [ ] **S003/H008**: Add `compile_error!` guards to all mainnet mint-address functions
5. [ ] **H037**: Add Tax-to-AMM entry in `sync-program-ids.ts` CROSS_REFS; fix pattern matching for `Pubkey::from_str`

### Pre-Launch Requirements

6. [ ] **H020**: Add emergency pause mechanism to all 7 programs
7. [ ] **H010**: Increase fallback slippage floor to 8500 BPS; execute via Jito bundles
8. [ ] **H024**: Add admin emergency epoch-advance instruction for Switchboard outage scenarios
9. [ ] **H011/S009**: Add PoolState layout test to cross-crate suite; consolidate byte readers
10. [ ] **S007**: Add discriminator assertion tests to `tests/cross-crate/`

### Post-Launch Improvements

11. [ ] **H010**: Implement pre-committed reserve snapshot for fallback slippage calculation (program upgrade)
12. [ ] **H019/S008**: Minimize oracle-reveal-to-consume window via protocol crank optimization
13. [ ] **H030**: Transfer BC admin to Squads multisig; add withdrawal timelock
14. [ ] **H054**: Clear `carnage_target` on expiry for state hygiene
15. [ ] **H062**: Add explicit "already burned" error to `burn_authority` idempotency path

### Ongoing Security Practices

- **Crank monitoring**: Alert if Carnage trigger frequency deviates from expected ~4.3% over rolling 48-epoch windows
- **Authority verification**: After each Squads migration step, verify on-chain admin state matches expected values
- **Build-pipeline integrity**: Add pre-deploy grep assertion verifying mainnet mint addresses after patching
- **Audit cadence**: Conduct Audit #4 after implementing H009/H020 fixes and completing Squads migration
- **Bug bounty**: Consider establishing a bug bounty program post-launch
- **Key management**: Move all production keypairs to hardware wallets or secrets managers

---

## Appendix A: Methodology

This audit was performed using Stronghold of Security methodology:

1. **Phase 0: Architectural Analysis**
   - Automated codebase scanning and architecture documentation
   - Knowledge base manifest generation for targeted agent loading

2. **Phase 0.5: Static Pre-Scan**
   - Grep pattern matching against 12 risk categories
   - Hot-spots identification for focused agent analysis

3. **Phase 1: Parallel Context Building**
   - 9 specialized auditors analyzed the codebase through different security lenses
   - Focus areas: Access Control, Arithmetic, State Machine, CPI, Token/Economic, Oracle/Data, Upgrade/Admin, Timing/Ordering, Economic Model
   - 373KB total context output

4. **Phase 1.5: Output Quality Validation**
   - Automated quality gate checking context depth and completeness

5. **Phase 2: Synthesis**
   - Context from all 9 auditors merged into unified architectural understanding
   - Deduplicated observations across focus areas

6. **Phase 3: Strategy Generation**
   - 65 attack hypotheses generated from historical exploits, codebase analysis, and 128 exploit patterns
   - 10 supplemental strategies generated from Batch 1 findings
   - Priority-tiered: 19 Tier 1 (CRITICAL), 22 Tier 2 (HIGH), 24 Tier 3 (MEDIUM-LOW)
   - 27 RECHECK strategies for all previous CONFIRMED findings

7. **Phase 4: Parallel Investigation**
   - All 75 strategies investigated with invariant-first analysis, PoC reasoning, and devil's advocate challenges
   - 100% Tier 1, 100% Tier 2, 100% Tier 3 coverage

8. **Phase 4.5: Coverage Verification**
   - 46/49 instructions covered (3 LOW gaps: mark_failed, consolidate_for_refund, initialize_extra_account_meta_list)
   - 8/8 security patterns verified
   - 3/3 cross-cutting concerns thoroughly analyzed

9. **Phase 5: Final Synthesis**
   - All findings aggregated with systematic N x N combination matrix
   - Attack trees constructed with critical fix nodes identified
   - Severity re-calibration for holistic consistency
   - This report generated

---

## Appendix B: Files Analyzed

<details>
<summary>Click to expand file list (155 files)</summary>

**Programs (98 Rust files across 7 programs):**
- `programs/amm/src/` -- 14 files (lib.rs, state/, instructions/, helpers/, constants.rs, errors.rs)
- `programs/tax-program/src/` -- 16 files (lib.rs, state/, instructions/, helpers/, constants.rs, errors.rs)
- `programs/epoch-program/src/` -- 18 files (lib.rs, state/, instructions/, helpers/, constants.rs, errors.rs)
- `programs/staking/src/` -- 14 files (lib.rs, state/, instructions/, helpers/, constants.rs, errors.rs)
- `programs/bonding_curve/src/` -- 20 files (lib.rs, state/, instructions/, helpers/, constants.rs, errors.rs, math.rs)
- `programs/conversion-vault/src/` -- 8 files (lib.rs, state.rs, instructions/, constants.rs, errors.rs)
- `programs/transfer-hook/src/` -- 8 files (lib.rs, state/, instructions/, errors.rs)

**Tests:**
- `tests/cross-crate/src/lib.rs` -- Cross-program layout verification
- Program-level test suites across all 7 programs

**Scripts (off-chain):**
- `scripts/deploy/build.sh` -- Build pipeline
- `scripts/deploy/sync-program-ids.ts` -- Cross-program ID synchronization
- `scripts/deploy/patch-mint-addresses.ts` -- Mint address patching
- `scripts/deploy/initialize.ts` -- Protocol initialization
- `scripts/deploy/transfer-authority.ts` -- Authority transfer
- `scripts/deploy/verify-authority.ts` -- Authority verification
- `scripts/graduation/graduate.ts` -- Bonding curve graduation

**Configuration:**
- `Anchor.toml` -- Anchor workspace configuration
- All `Cargo.toml` files across workspace

</details>

---

## Appendix C: Full Finding Details

Individual finding files are available at `.audit/findings/`:
- H001-H065: Primary investigation reports
- S001-S010: Supplemental compound strategy reports

Each file contains: status, severity, category, detailed analysis, code evidence, verdict, and specific recommendations.

---

## Disclaimer

This automated security audit is a comprehensive starting point but does not guarantee the absence of vulnerabilities. It should be supplemented with:
- Manual expert code review
- Formal verification where applicable
- Comprehensive test coverage (including property-based tests and fuzzing)
- Bug bounty program
- Ongoing security monitoring

Security is a continuous process, not a one-time event. The three uninvestigated instructions (mark_failed, consolidate_for_refund, initialize_extra_account_meta_list) represent LOW-risk structural instructions that should be included in the next audit cycle.

---

**Report Generated:** 2026-03-21
**Stronghold of Security Version:** 1.0.0
**Audit Lineage:** #3 (stacked on #2 @ f891646, #1 @ be95eba)
