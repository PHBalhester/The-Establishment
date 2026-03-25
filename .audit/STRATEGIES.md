# Attack Strategy Catalog

**Project:** Dr. Fraudsworth's Finance Factory
**Generated:** 2026-03-21
**Audit:** #3 (stacked on #2 @ f891646)
**Total Strategies:** 65
**Tier:** standard (target: 50-75)

---

## Strategy Generation Sources

- 9 focus area context analyses (373KB total output)
- Previous audit: 19 CONFIRMED + 1 POTENTIAL findings (all RECHECK — every file modified)
- Historical Solana exploit patterns (128 EPs)
- Protocol playbooks: AMM/DEX, Staking, Oracle
- Bug bounty + audit firm reference databases

## Stacked Audit Notes

All 98 Rust files were modified since audit #2. Therefore:
- **Every previous finding gets RECHECK** (automatic Tier 1 for CONFIRMED)
- **No false positives carried forward** (all target files modified)
- **Previous false positives may be re-evaluated** if hypotheses regenerated

---

## Strategy Index by Priority Tier

### Tier 1 — CRITICAL potential (19 strategies)

**RECHECK — Previous CONFIRMED findings on modified code:**
- H001: BC Admin Authority Fix Verification (RECHECK H001/H002/H010)
- H002: Transfer Hook Init Front-Run Fix Verification (RECHECK H007)
- H003: Combined Hook+BC Deployment Attack Fix (RECHECK S006)
- H004: Sell Path Slippage Fix Verification (RECHECK H008)
- H005: Staking Escrow Rent Depletion Fix (RECHECK H012/S003)
- H006: Init Front-Running Fixes Verification (RECHECK H036)
- H007: Cross-Program Layout Test Adequacy (RECHECK S007/H011)
- H008: Mainnet Placeholder Fix Verification (RECHECK H018)

**New hypotheses:**
- H009: Carnage Suppression via Optional Account Omission
- H010: Carnage Fallback MEV Sandwich Extraction
- H011: Cross-Program Byte-Offset Corruption After AMM Upgrade
- H012: Build-Pipeline Supply Chain — Cross-Program ID Injection
- H013: VRF Freshness Underflow via Future-Dated Seed Slot
- H014: Carnage Suppression as Economic Manipulation
- H015: Admin Authority Transfer to Wrong Address (Irreversible)
- H016: swap_exempt minimum_output=0 Sandwich Within AMM
- H017: Duplicate Mutable Accounts in Carnage Execution Paths
- H018: Carnage held_token Raw u8 Matching — Wrong Token Burn
- H019: Cross-Epoch Tax Rate Arbitrage via Delayed consume_randomness

### Tier 2 — HIGH potential (22 strategies)
- H020: No Emergency Pause Mechanism (RECHECK S005)
- H021: Cross-Program Upgrade Cascade (RECHECK H049)
- H022: CPI Depth at 4/4 Hard Limit (RECHECK H058)
- H023: stake_pool Unconstrained at Epoch Program Level
- H024: Single Switchboard Oracle Dependency — Protocol Halt
- H025: Conversion Vault Fixed-Rate Arbitrage Drain
- H026: Staking Reward Forfeiture Game of Chicken
- H027: Bonding Curve Sybil Attack (Wallet Cap Bypass)
- H028: remaining_accounts Forwarding Without Length Validation
- H029: Hardcoded CPI Discriminators Fragility
- H030: Admin SOL Withdrawal Centralization (withdraw_graduated_sol)
- H031: Carnage Fund Accumulation — Large MEV Target
- H032: Cross-Program EpochState Tax Rate Trust
- H033: Sell-Then-Buy Carnage Compound Slippage
- H034: Sequential Multi-Swap Same Transaction Composability
- H035: Sell-Side WSOL Delegate Authority Exploit
- H036: Conversion Vault No Rate Limit — Rapid PROFIT Drain
- H037: AMM Program ID Cluster Mismatch in Tax Constants
- H038: Transfer Hook Whitelist Bypass via Proxy Contract
- H039: Carnage Fallback Executor — No Bounty Liveness Risk
- H040: Manual SPL Instruction Discriminator Fragility
- H041: Epoch Skip Staking Reward Forfeiture

### Tier 3 — MEDIUM-LOW potential (24 strategies)
- H042: BC initialize_curve Fix Verification (RECHECK H003)
- H043: BC close_token_vault Fix Verification (RECHECK H005)
- H044: Epoch Init Fix Verification (RECHECK H021)
- H045: Dual-Curve Grief (RECHECK H031)
- H046: taxes_confirmed Unchecked by Tax (RECHECK H048)
- H047: Unchecked as u64 Cast in get_current_price (RECHECK H077)
- H048: Buy Path 50% Output Floor Adequacy (RECHECK H014)
- H049: get_current_price Silent Saturation (unwrap_or(0))
- H050: Bonding Curve Sell Tax u64 Overflow Window
- H051: claim_refund Last-Claimer Rounding Advantage
- H052: Conversion Vault Truncation Loss (99 base units)
- H053: carnage_lock_slot Not Explicitly Initialized
- H054: Stale carnage_target After Expiry
- H055: Epoch Skip Reward Forfeiture Quantification
- H056: Staking Cooldown Timestamp Manipulation (~30s drift)
- H057: Micro-Tax Edge Case Routing (<4 lamports all to staking)
- H058: WSOL Intermediary Rent Assumption in Sell Path
- H059: Token-2022 Transfer Hook Reentrancy Check
- H060: Bonding Curve Refund Ordering Advantage
- H061: start_curve Unchecked Addition (deadline overflow)
- H062: WhitelistAuthority burn_authority Idempotency
- H063: force_carnage Devnet Gate Verification (IDL check)
- H064: distribute_tax_escrow Timing Before Graduation
- H065: Bonding Curve Solvency Buffer Adequacy

---

## Strategy Definitions

---

## H001: BC Admin Authority Fix Verification

**Category:** Access Control, Initialization
**Estimated Priority:** Tier 1 (CRITICAL potential)
**Historical Precedent:** RECHECK (H001/H002/H010 from Audit #2)
**Origin:** RECHECK (H001/H002/H010)
**Requires:** [access-control-findings]

### Hypothesis
The fix for the bonding curve authority gap (BcAdminConfig PDA pattern with upgrade authority gating) may have introduced new issues or may not fully close the original atomic SOL theft vector.

### Attack Vector
1. Verify `initialize_bc_admin` validates `program_data.upgrade_authority_address == Some(signer.key())`
2. Verify all BC admin-gated instructions use `has_one = authority` on BcAdminConfig
3. Check if there's any window between program deploy and BcAdminConfig initialization
4. Verify `transfer_bc_admin` rejects `Pubkey::default()` (prevent accidental burn)

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `bonding_curve/src/instructions/initialize_bc_admin.rs` | initialize_bc_admin | New admin init with upgrade authority gate |
| `bonding_curve/src/instructions/transfer_bc_admin.rs` | transfer_bc_admin | Admin transfer mechanism |
| `bonding_curve/src/instructions/burn_bc_admin.rs` | burn_bc_admin | Admin burn mechanism |

### Potential Impact
**Severity if confirmed:** CRITICAL — Attacker could front-run admin initialization and steal all bonding curve SOL.

### Investigation Approach
1. **Check:** Upgrade authority validation at initialize_bc_admin
2. **Check:** has_one constraint on all admin-gated instructions
3. **Check:** No gap exists between deploy and init where an attacker could act
4. **Determine:** Vulnerable if any admin-gated instruction lacks has_one constraint

---

## H002: Transfer Hook Init Front-Run Fix Verification

**Category:** Access Control, Initialization
**Estimated Priority:** Tier 1 (CRITICAL potential)
**Historical Precedent:** RECHECK (H007 from Audit #2)
**Origin:** RECHECK (H007)
**Requires:** [access-control-findings]

### Hypothesis
The ProgramData gate on `initialize_authority` may have edge cases allowing front-running of the whitelist authority setup.

### Attack Vector
1. Verify `initialize_authority` validates upgrade authority via ProgramData
2. Check if Anchor `init` prevents re-initialization
3. Verify the authority stored is the signer's key (not arbitrary input)

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `transfer-hook/src/instructions/initialize_authority.rs` | initialize_authority | Front-run fix with ProgramData gate |

### Potential Impact
**Severity if confirmed:** CRITICAL — Attacker controls whitelist, can block all token transfers.

### Investigation Approach
1. **Check:** ProgramData upgrade authority validation at lines 46-55
2. **Check:** Anchor init prevents double-init
3. **Determine:** Safe if upgrade authority check is present and init is one-shot

---

## H003: Combined Hook+BC Deployment Attack Fix

**Category:** Access Control, Multi-Component
**Estimated Priority:** Tier 1 (CRITICAL potential)
**Historical Precedent:** RECHECK (S006 from Audit #2)
**Origin:** RECHECK (S006)
**Requires:** [access-control-findings, cpi-findings]

### Hypothesis
Both the Transfer Hook and Bonding Curve authority fixes (ProgramData gates) work individually but may have interaction effects when combined with the deployment pipeline.

### Attack Vector
1. Verify both fixes are applied consistently
2. Check deployment ordering — can Hook be initialized before BC admin?
3. Verify no shared state could be manipulated between the two init calls

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `transfer-hook/src/instructions/initialize_authority.rs` | initialize_authority | Hook authority init |
| `bonding_curve/src/instructions/initialize_bc_admin.rs` | initialize_bc_admin | BC admin init |

### Potential Impact
**Severity if confirmed:** CRITICAL — Combined authority compromise.

### Investigation Approach
1. **Check:** Both inits have independent ProgramData validation
2. **Check:** No shared PDA or state between the two
3. **Determine:** Safe if both are independently secured

---

## H004: Sell Path Slippage Fix Verification

**Category:** Token/Economic, MEV
**Estimated Priority:** Tier 1 (CRITICAL potential)
**Historical Precedent:** RECHECK (H008 from Audit #2)
**Origin:** RECHECK (H008)
**Requires:** [token-economic-findings, timing-findings]

### Hypothesis
The 50% output floor mitigation for sell-path sandwich attacks may have gaps, particularly in the two-step slippage check (pre-CPI gross floor + post-CPI net check).

### Attack Vector
1. Check the 50% floor calculation: `calculate_output_floor(reserves, amount, 5000)`
2. Verify sell-side tax deduction doesn't create a gap between gross and net slippage
3. Check if the floor uses current reserves (manipulable) or a protected reference

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `tax-program/src/instructions/swap_sol_sell.rs:113-117,265` | swap_sol_sell | Two-step slippage check |
| `tax-program/src/helpers/tax_math.rs:141-165` | calculate_output_floor | Floor calculation |

### Potential Impact
**Severity if confirmed:** HIGH — Sandwich attacks extract user value.

### Investigation Approach
1. **Check:** Floor uses current on-chain reserves (same-TX manipulable?)
2. **Check:** Tax deduction after floor check doesn't create bypass
3. **Determine:** Vulnerable if floor calculated from stale or manipulable data

---

## H005: Staking Escrow Rent Depletion Fix

**Category:** Token/Economic, State Machine
**Estimated Priority:** Tier 1 (CRITICAL potential)
**Historical Precedent:** RECHECK (H012/S003 from Audit #2)
**Origin:** RECHECK (H012/S003)
**Requires:** [token-economic-findings, state-machine-findings]

### Hypothesis
The rent-exempt minimum guard in claim.rs may have edge cases where escrow balance drops below rent-exempt threshold.

### Attack Vector
1. Verify `claim.rs` checks escrow balance >= rent_exempt_minimum after claim
2. Check if multiple concurrent claims could race past the guard
3. Verify the rent calculation uses current lamports_per_byte_year

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `staking/src/instructions/claim.rs:150-162` | claim | Direct lamport manipulation with rent guard |

### Potential Impact
**Severity if confirmed:** HIGH — Escrow account deleted, all staked rewards lost.

### Investigation Approach
1. **Check:** Rent-exempt guard at claim.rs post-lamport-manipulation
2. **Check:** Concurrent claims handled by Solana's account locking
3. **Determine:** Safe if rent check occurs after lamport subtraction

---

## H006: Init Front-Running Fixes Verification

**Category:** Access Control
**Estimated Priority:** Tier 1 (CRITICAL potential)
**Historical Precedent:** RECHECK (H036 from Audit #2)
**Origin:** RECHECK (H036)
**Requires:** [access-control-findings, upgrade-admin-findings]

### Hypothesis
The ProgramData upgrade authority gates on Staking and Epoch initialization may have been applied inconsistently or may have edge cases.

### Attack Vector
1. Verify `initialize_stake_pool` validates ProgramData upgrade authority
2. Verify `initialize_epoch_state` validates ProgramData upgrade authority
3. Check both use Anchor `init` (one-shot)

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `staking/src/instructions/initialize_stake_pool.rs:88-98` | initialize_stake_pool | Staking init gate |
| `epoch-program/src/instructions/initialize_epoch_state.rs:119-129` | initialize_epoch_state | Epoch init gate |

### Potential Impact
**Severity if confirmed:** HIGH — Attacker front-runs init with malicious configuration.

### Investigation Approach
1. **Check:** ProgramData constraint present on both
2. **Determine:** Safe if upgrade authority check and Anchor init are both present

---

## H007: Cross-Program Layout Test Adequacy

**Category:** CPI, Arithmetic
**Estimated Priority:** Tier 1 (CRITICAL potential)
**Historical Precedent:** RECHECK (S007/H011 from Audit #2)
**Origin:** RECHECK (S007/H011)
**Requires:** [cpi-findings, arithmetic-findings]

### Hypothesis
The cross-crate layout tests may not cover all fields or may have blind spots in the round-trip verification.

### Attack Vector
1. Verify `tests/cross-crate/src/lib.rs` round-trips ALL fields of EpochState
2. Verify DATA_LEN assertions match on both sides (epoch-program and tax-program)
3. Check if any new fields added since tests were written

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `tests/cross-crate/src/lib.rs` | layout tests | Cross-crate verification |
| `tax-program/src/state/epoch_state_reader.rs:64` | DATA_LEN assertion | Tax-side assertion |
| `epoch-program/src/state/epoch_state.rs:187` | DATA_LEN assertion | Epoch-side assertion |

### Potential Impact
**Severity if confirmed:** CRITICAL — Layout mismatch causes wrong tax rates applied.

### Investigation Approach
1. **Check:** All EpochState fields covered in round-trip tests
2. **Check:** DATA_LEN values match (both == 164)
3. **Determine:** Vulnerable if any field is missing from test

---

## H008: Mainnet Placeholder Fix Verification

**Category:** Upgrade/Admin, Configuration
**Estimated Priority:** Tier 1 (CRITICAL potential)
**Historical Precedent:** RECHECK (H018 from Audit #2)
**Origin:** RECHECK (H018)
**Requires:** [upgrade-admin-findings]

### Hypothesis
The `compile_error!` guards on mainnet placeholders may not cover all constant locations, or the treasury address may still be wrong in some code path.

### Attack Vector
1. Verify `treasury_pubkey()` returns correct mainnet address in non-devnet build
2. Verify `compile_error!` is present where `Pubkey::default()` was previously used
3. Check if bonding curve/conversion vault mainnet mint addresses are stale

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `tax-program/src/constants.rs:146-149` | treasury_pubkey | Mainnet treasury |
| `bonding_curve/src/constants.rs:176-195` | mint addresses | BC mint config |
| `conversion-vault/src/constants.rs:35-68` | mint addresses | Vault mint config |

### Potential Impact
**Severity if confirmed:** CRITICAL — Treasury funds sent to wrong address, or wrong mints used.

### Investigation Approach
1. **Check:** Non-devnet/non-localnet branch returns `3ihhw...`
2. **Check:** BC/Vault mainnet branches — are they patched at build time?
3. **Determine:** Vulnerable if any mainnet path returns wrong address AND build-time patching fails

---

## H009: Carnage Suppression via Optional Account Omission

**Category:** Access Control, State Machine, Economic
**Estimated Priority:** Tier 1 (CRITICAL potential)
**Historical Precedent:** Novel
**Origin:** Novel
**Requires:** [access-control-findings, state-machine-findings, economic-findings]

### Hypothesis
A MEV bot can permanently suppress the Carnage Fund by front-running every `consume_randomness` call with a version that omits the `carnage_state` account, preventing Carnage from ever triggering.

### Attack Vector
1. Bot monitors mempool for `consume_randomness` transactions
2. Bot front-runs with own `consume_randomness` that omits `carnage_state`
3. VRF is consumed, taxes update, but Carnage trigger check is skipped
4. Even when VRF would have triggered Carnage (4.3%), it doesn't fire
5. Repeat every epoch — Carnage Fund grows but never executes

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `epoch-program/src/instructions/consume_randomness.rs:76-80` | consume_randomness | Optional carnage_state |

### Potential Impact
**Severity if confirmed:** CRITICAL — Carnage Fund rebalancing mechanism permanently disabled. Accumulated SOL sits idle. Token price equilibrium mechanism broken.

### Investigation Approach
1. **Check:** Is `carnage_state` truly optional (Option<Account>)?
2. **Check:** What happens if carnage_state is omitted — does Carnage check get skipped entirely?
3. **Check:** Can the crank retry with carnage_state after a bot front-runs without it?
4. **Determine:** Vulnerable if omission silently skips Carnage AND there's no recovery

---

## H010: Carnage Fallback MEV Sandwich Extraction

**Category:** MEV, Token/Economic
**Estimated Priority:** Tier 1 (CRITICAL potential)
**Historical Precedent:** EP-060, EP-112 (Missing Slippage, Validator MEV)
**Origin:** KB (EP-060, EP-112)
**Requires:** [token-economic-findings, timing-findings, economic-findings]

### Hypothesis
After the 50-slot lock window, the Carnage fallback path is permissionless with 75% slippage floor and carnage_target visible on-chain. A MEV actor can sandwich the Carnage swap for up to 25% of the swap amount (max 250 SOL).

### Attack Vector
1. Observe `carnage_pending == true` and `carnage_target` from EpochState
2. Wait for lock window to expire (slot > carnage_lock_slot + 50)
3. Manipulate target pool reserves (buy target token to inflate price)
4. Submit `execute_carnage` — Carnage buys at inflated price
5. Sell target token after Carnage buys, capturing spread up to 25%

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `epoch-program/src/instructions/execute_carnage.rs:196-208` | execute_carnage | Fallback path timing |
| `epoch-program/src/helpers/carnage_execution.rs:324-350` | slippage floor | 75% floor calculation |
| `tax-program/src/instructions/swap_exempt.rs:111` | MINIMUM_OUTPUT=0 | AMM-level bypass |

### Potential Impact
**Severity if confirmed:** HIGH — Up to 250 SOL per Carnage fallback execution. MAX_CARNAGE_SWAP_LAMPORTS=1000 SOL * 25% = 250 SOL theoretical max.

### Investigation Approach
1. **Check:** Exact slippage floor calculation for fallback (75% confirmed?)
2. **Check:** Can attacker manipulate pool before Carnage AND the floor calculation uses same reserves?
3. **Check:** How often does fallback path actually trigger vs atomic?
4. **Determine:** Quantify realistic extraction given pool depth and Carnage frequency

---

## H011: Cross-Program Byte-Offset Corruption After AMM Upgrade

**Category:** CPI, Arithmetic
**Estimated Priority:** Tier 1 (CRITICAL potential)
**Historical Precedent:** Novel
**Origin:** Novel
**Requires:** [cpi-findings, arithmetic-findings]

### Hypothesis
If the AMM program is upgraded and PoolState struct layout changes, both Tax Program and Epoch Program would silently read wrong reserve values from hardcoded byte offsets, corrupting tax calculations and Carnage slippage floors.

### Attack Vector
1. AMM upgrade changes PoolState field ordering (e.g., adds field before reserves)
2. Tax Program reads old offsets [137..145] — now reads wrong data
3. Output floor calculation uses garbage values — could be 0 or u64::MAX
4. Sandwich attacks become trivially profitable OR all swaps fail

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `tax-program/src/helpers/pool_reader.rs:79-88` | read_pool_reserves | Hardcoded offsets |
| `epoch-program/src/helpers/carnage_execution.rs:825-851` | read_pool_reserves | Hardcoded offsets |

### Potential Impact
**Severity if confirmed:** CRITICAL — Silent data corruption in all swap operations.

### Investigation Approach
1. **Check:** Are offsets 137/145 correct for current PoolState?
2. **Check:** Is there any version check or length validation?
3. **Check:** What happens if offsets read wrong data — would swaps fail or succeed with wrong params?
4. **Determine:** Assess risk: AMM upgrade is admin-controlled, but offset stability is unvalidated

---

## H012: Build-Pipeline Supply Chain — Cross-Program ID Injection

**Category:** Upgrade/Admin, Supply Chain
**Estimated Priority:** Tier 1 (CRITICAL potential)
**Historical Precedent:** EP-095 (Supply Chain / Dependency Poisoning)
**Origin:** KB (EP-095)
**Requires:** [upgrade-admin-findings, cpi-findings]

### Hypothesis
The build pipeline (`sync-program-ids.ts`, `patch-mint-addresses.ts`) could be used to inject malicious program IDs or mint addresses, routing CPI calls to attacker programs.

### Attack Vector
1. Attacker compromises keypairs/ directory or build scripts
2. sync-program-ids.ts patches declare_id! and cross-program constants with attacker IDs
3. Deployed binary routes CPI calls to malicious programs
4. Malicious AMM approves all swaps, returning full input to attacker

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `scripts/deploy/build.sh:85-99` | Build pipeline | Sync and patch steps |
| `scripts/deploy/sync-program-ids.ts` | ID synchronization | Patches all program IDs |
| `scripts/deploy/patch-mint-addresses.ts` | Mint patching | Patches mint addresses |

### Potential Impact
**Severity if confirmed:** CRITICAL — Total protocol compromise via build pipeline.

### Investigation Approach
1. **Check:** Are keypair files protected (permissions, git-ignored)?
2. **Check:** Does build.sh validate inputs or blindly patch?
3. **Check:** Is there a verification step comparing deployed binary to expected IDs?
4. **Determine:** Operational risk — not a code bug but a process vulnerability

---

## H013: VRF Freshness Underflow via Future-Dated Seed Slot

**Category:** Oracle, Timing
**Estimated Priority:** Tier 1 (CRITICAL potential)
**Historical Precedent:** EP-022 (Stale Oracle Price)
**Origin:** KB (EP-022)
**Requires:** [oracle-findings, timing-findings]

### Hypothesis
The VRF freshness check uses `saturating_sub`, which returns 0 for future-dated `seed_slot` values. A compromised or buggy Switchboard oracle could bypass freshness validation.

### Attack Vector
1. Switchboard oracle produces randomness account with `seed_slot > clock.slot`
2. `clock.slot.saturating_sub(seed_slot)` returns 0
3. 0 <= 1 passes freshness check
4. Attacker controls randomness bytes (if oracle is compromised)

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `epoch-program/src/instructions/trigger_epoch_transition.rs:174` | freshness check | saturating_sub |
| `epoch-program/src/instructions/retry_epoch_vrf.rs:83` | freshness check | Same pattern |

### Potential Impact
**Severity if confirmed:** HIGH — If Switchboard oracle compromised, attacker controls tax rates and Carnage targeting. Requires oracle-level compromise.

### Investigation Approach
1. **Check:** Can Switchboard produce future-dated seed_slot?
2. **Check:** Is there a defensive `require!(seed_slot <= clock.slot)` check?
3. **Determine:** Assess oracle trust model — is future-dating possible?

---

## H014: Carnage Suppression as Economic Manipulation

**Category:** Economic, MEV
**Estimated Priority:** Tier 1 (CRITICAL potential)
**Historical Precedent:** Novel
**Origin:** Novel
**Requires:** [economic-findings, state-machine-findings]

### Hypothesis
An actor holding the "expensive" token can suppress Carnage (which buys the "cheap" token) to prevent price equalization, maintaining an artificial price divergence that benefits their position.

### Attack Vector
1. Actor holds large position in the "expensive" token
2. Price equalization via Carnage would hurt their position
3. Actor front-runs consume_randomness without carnage_state every epoch
4. Carnage never fires, price divergence persists
5. Actor profits from sustained divergence

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `epoch-program/src/instructions/consume_randomness.rs:76-80` | consume_randomness | Optional carnage_state |

### Potential Impact
**Severity if confirmed:** HIGH — Protocol's core rebalancing mechanism disabled for economic gain.

### Investigation Approach
1. **Check:** Is there any mechanism to force Carnage check? (e.g., mandatory account)
2. **Check:** Can the crank operator override a front-runner?
3. **Determine:** Quantify economic impact of Carnage suppression

---

## H015: Admin Authority Transfer to Wrong Address (Irreversible)

**Category:** Access Control, Key Management
**Estimated Priority:** Tier 1 (CRITICAL potential)
**Historical Precedent:** EP-068 (Single Admin Key), EP-069 (No Admin Key Rotation)
**Origin:** KB (EP-068)
**Requires:** [access-control-findings, upgrade-admin-findings]

### Hypothesis
All admin transfer patterns are single-step (no propose + accept). A transfer to a typo'd address permanently loses admin control.

### Attack Vector
1. Admin calls `transfer_admin` with slightly wrong pubkey
2. Transfer succeeds immediately (no confirmation from new authority)
3. Admin control permanently lost — no one can sign as the new key
4. All admin functions become inaccessible

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `amm/src/instructions/transfer_admin.rs` | transfer_admin | AMM admin transfer |
| `bonding_curve/src/instructions/transfer_bc_admin.rs` | transfer_bc_admin | BC admin transfer |
| `transfer-hook/src/instructions/transfer_authority.rs` | transfer_authority | Hook authority transfer |

### Potential Impact
**Severity if confirmed:** HIGH — Permanent loss of admin capabilities. Not exploitable by attacker (requires admin mistake).

### Investigation Approach
1. **Check:** Is there a two-step (propose + accept) pattern?
2. **Check:** Is Pubkey::default() rejection present? Other invalid address checks?
3. **Determine:** Risk assessment — operational, not adversarial

---

## H016: swap_exempt minimum_output=0 Sandwich Within AMM

**Category:** MEV, CPI
**Estimated Priority:** Tier 1 (CRITICAL potential)
**Historical Precedent:** EP-060 (Missing Slippage Protection)
**Origin:** KB (EP-060)
**Requires:** [cpi-findings, timing-findings, token-economic-findings]

### Hypothesis
The Tax Program's swap_exempt passes MINIMUM_OUTPUT=0 to the AMM. While the Epoch Program enforces its own post-swap slippage floor (85%/75%), there may be a gap where the AMM accepts a bad swap that the post-check doesn't catch.

### Attack Vector
1. Carnage swap calls swap_exempt with minimum_output=0
2. AMM allows any output amount (including near-zero)
3. Epoch checks output against expected floor post-swap
4. If attacker manipulates reserves BETWEEN floor calculation and actual swap...
5. The floor was computed from pre-manipulation reserves, swap uses post-manipulation

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `tax-program/src/instructions/swap_exempt.rs:111` | MINIMUM_OUTPUT=0 | AMM bypass |
| `epoch-program/src/helpers/carnage_execution.rs:331-350` | slippage floor | Post-swap check |

### Potential Impact
**Severity if confirmed:** CRITICAL — Carnage Fund drained via gap between floor calculation and execution.

### Investigation Approach
1. **Check:** Are floor calculation and swap in the same TX (atomic)?
2. **Check:** Do both use the same reserve snapshot?
3. **Determine:** If atomic and same reserves, gap doesn't exist

---

## H017: Duplicate Mutable Accounts in Carnage Execution Paths

**Category:** Account Validation
**Estimated Priority:** Tier 1 (CRITICAL potential)
**Historical Precedent:** EP-009 (Duplicate Mutable Accounts)
**Origin:** KB (EP-009)
**Requires:** [access-control-findings, cpi-findings]

### Hypothesis
The Carnage execution paths involve 23+ accounts across multiple programs. If any two mutable accounts can be the same (e.g., crime_pool == fraud_pool), state corruption could occur.

### Attack Vector
1. Attacker passes same account for two different mutable positions
2. Both writes target same account, second write overwrites first
3. Pool state corrupted — k-invariant broken, reserves wrong

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `epoch-program/src/instructions/execute_carnage_atomic.rs` | ExecuteCarnageAtomic struct | 23+ accounts |
| `epoch-program/src/helpers/carnage_execution.rs` | execute_carnage_internal | Account usage |

### Potential Impact
**Severity if confirmed:** CRITICAL — Pool state corruption, potential fund drain.

### Investigation Approach
1. **Check:** Do Anchor constraints prevent duplicate accounts? (seeds/has_one differentiate)
2. **Check:** Are pools differentiated by PDA seeds?
3. **Determine:** Anchor's PDA constraints should prevent this, verify

---

## H018: Carnage held_token Raw u8 Matching — Wrong Token Burn

**Category:** State Machine, Token/Economic
**Estimated Priority:** Tier 1 (CRITICAL potential)
**Historical Precedent:** Novel
**Origin:** Novel
**Requires:** [state-machine-findings, token-economic-findings]

### Hypothesis
`held_token` in Carnage execution is matched as raw u8 (1=CRIME, 2=FRAUD, _=no holdings) instead of using the `HeldToken` enum's validation. If held_token is set to an unexpected value, the wrong token could be burned or the default branch could skip burning.

### Attack Vector
1. Find a path where `held_token` is set to a value outside {0, 1, 2}
2. Burn logic falls to `_ => return Ok(0)` — no burn happens despite holdings existing
3. Protocol accumulates unbounded token holdings without ever burning

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `epoch-program/src/helpers/carnage_execution.rs:477-481` | burn_held_tokens | Raw u8 matching |
| `epoch-program/src/helpers/carnage_execution.rs:359` | target.to_u8() + 1 | held_token encoding |

### Potential Impact
**Severity if confirmed:** MEDIUM — Wrong token burned or burn skipped. Limited by held_token only set via controlled paths.

### Investigation Approach
1. **Check:** All code paths that set `held_token` — can it ever be != 0, 1, or 2?
2. **Check:** Is `to_u8() + 1` pattern consistent across all write sites?
3. **Determine:** Vulnerable only if held_token can be set to unexpected values

---

## H019: Cross-Epoch Tax Rate Arbitrage via Delayed consume_randomness

**Category:** Timing, Economic, MEV
**Estimated Priority:** Tier 1 (CRITICAL potential)
**Historical Precedent:** Novel
**Origin:** Novel
**Requires:** [timing-findings, economic-findings, oracle-findings]

### Hypothesis
Tax rates don't update until consume_randomness is called. An attacker who knows the VRF outcome (from watching Switchboard oracle reveal) can delay calling consume_randomness to trade at old tax rates with knowledge of what the new rates will be.

### Attack Vector
1. Epoch transition triggers — VRF committed
2. Switchboard oracle reveals VRF output (visible off-chain)
3. Attacker reads new tax rates from VRF bytes
4. If new rates are favorable (e.g., their token becomes "cheap" = low buy tax)
5. Buy at old high tax rate vs NOT buying? Actually...
6. OR if current rates are favorable and will change, trade before consume_randomness

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `epoch-program/src/instructions/consume_randomness.rs` | consume_randomness | Tax rate update |
| `epoch-program/src/helpers/tax_derivation.rs:84-128` | VRF byte interpretation | Rate derivation |

### Potential Impact
**Severity if confirmed:** MEDIUM — Information advantage, not direct fund loss. Limited by VRF unpredictability.

### Investigation Approach
1. **Check:** How long between oracle reveal and consume_randomness?
2. **Check:** Can attacker delay consume_randomness while trading?
3. **Determine:** Quantify alpha from rate foreknowledge

---

## H020: No Emergency Pause Mechanism

**Category:** Upgrade/Admin, Risk Management
**Estimated Priority:** Tier 2 (HIGH potential)
**Historical Precedent:** EP-072 (No Emergency Pause), RECHECK (S005)
**Origin:** RECHECK (S005)
**Requires:** [upgrade-admin-findings, state-machine-findings]

### Hypothesis
No program has pause functionality. If a critical bug is found post-launch, the only remedy is a full program upgrade via multisig timelock.

### Attack Vector
1. Critical bug discovered (e.g., pool drain)
2. Multisig timelock delay (300s on devnet, planned longer for mainnet)
3. During delay, attacker exploits the bug
4. No way to stop trading/staking/Carnage execution

### Target Code
All program source files — absence of pause mechanism.

### Potential Impact
**Severity if confirmed:** HIGH — Extended exploit window during upgrade cycle.

### Investigation Approach
1. **Check:** Is there any `is_paused` or equivalent in ANY program?
2. **Check:** How fast can an upgrade be deployed via Squads multisig?
3. **Determine:** This is a known accepted risk — quantify window

---

## H021: Cross-Program Upgrade Cascade

**Category:** CPI, Upgrade/Admin
**Estimated Priority:** Tier 2 (HIGH potential)
**Historical Precedent:** RECHECK (H049)
**Origin:** RECHECK (H049)
**Requires:** [cpi-findings, upgrade-admin-findings]

### Hypothesis
Upgrading one program that changes instruction interfaces requires all dependent programs to be upgraded simultaneously. No on-chain version check exists.

### Target Code
All `constants.rs` files — hardcoded discriminators and program IDs.

### Investigation Approach
1. **Check:** Are there any instructions that changed interface since last deploy?
2. **Check:** Would a partial upgrade break CPI chains?

---

## H022: CPI Depth at 4/4 Hard Limit

**Category:** CPI, Resource/DoS
**Estimated Priority:** Tier 2 (HIGH potential)
**Historical Precedent:** EP-084 (Compute Unit Exhaustion), RECHECK (H058)
**Origin:** RECHECK (H058)
**Requires:** [cpi-findings]

### Hypothesis
Carnage swap chain is at exactly 4 CPI levels. Any change that adds another CPI call would break all Carnage execution.

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `epoch-program/src/helpers/carnage_execution.rs:11-16` | CPI depth comments | 4-level chain documentation |

### Investigation Approach
1. **Check:** Verify exact CPI chain: Epoch → Tax → AMM → T22 → Hook
2. **Check:** Is any additional CPI hidden (logging, events)?

---

## H023: stake_pool Unconstrained at Epoch Program Level

**Category:** Access Control, CPI
**Estimated Priority:** Tier 2 (HIGH potential)
**Historical Precedent:** EP-007 (Account Relationship Not Verified)
**Origin:** KB (EP-007)
**Requires:** [access-control-findings, cpi-findings]

### Hypothesis
`stake_pool` in ConsumeRandomness is `AccountInfo` with only `#[account(mut)]`. A fake stake_pool could be passed, relying solely on Staking Program's CPI validation.

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `epoch-program/src/instructions/consume_randomness.rs:65-66` | stake_pool | No owner/seeds constraint |

### Investigation Approach
1. **Check:** Does Staking CPI validate the stake_pool independently?
2. **Check:** What happens if a fake account is passed — CPI failure or silent success?

---

## H024: Single Switchboard Oracle Dependency — Protocol Halt

**Category:** Oracle, Risk Management
**Estimated Priority:** Tier 2 (HIGH potential)
**Historical Precedent:** EP-023 (Single Oracle Dependency)
**Origin:** KB (EP-023)
**Requires:** [oracle-findings]

### Hypothesis
If Switchboard goes offline, the protocol cannot advance epochs. Tax rates freeze, staking yield stops, Carnage cannot trigger.

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `epoch-program/src/constants.rs:41-49` | Switchboard PIDs | Single oracle config |
| `epoch-program/src/instructions/retry_epoch_vrf.rs` | retry_epoch_vrf | Also requires Switchboard |

### Investigation Approach
1. **Check:** Is there any fallback if Switchboard is completely down?
2. **Check:** Does retry_epoch_vrf help if ALL Switchboard oracles are offline?

---

## H025: Conversion Vault Fixed-Rate Arbitrage Drain

**Category:** Economic, Token/Economic
**Estimated Priority:** Tier 2 (HIGH potential)
**Historical Precedent:** Novel
**Origin:** Novel
**Requires:** [economic-findings, token-economic-findings]

### Hypothesis
The 100:1 fixed conversion rate creates persistent arbitrage when market prices diverge. An arbitrageur could drain the vault's PROFIT supply by exploiting the rate difference.

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `conversion-vault/src/instructions/convert.rs:101-113` | convert | Fixed 100:1 rate |

### Investigation Approach
1. **Check:** Is vault PROFIT supply limited? How much PROFIT is deposited?
2. **Check:** Are swap taxes sufficient friction to close the arbitrage window?

---

## H026: Staking Reward Forfeiture Game of Chicken

**Category:** Economic
**Estimated Priority:** Tier 2 (HIGH potential)
**Historical Precedent:** Novel
**Origin:** Novel
**Requires:** [economic-findings]

### Hypothesis
The unstake forfeiture mechanism creates a game of chicken where each staker is incentivized to be the last one remaining, creating unhealthy dynamics.

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `staking/src/instructions/unstake.rs` | unstake | Reward forfeiture |

### Investigation Approach
1. **Check:** When a large staker unstakes, how do forfeited rewards redistribute?
2. **Check:** Can a 99% holder exploit this to extract disproportionate value?

---

## H027: Bonding Curve Sybil Attack (Wallet Cap Bypass)

**Category:** Access Control, Economic
**Estimated Priority:** Tier 2 (HIGH potential)
**Historical Precedent:** Novel
**Origin:** Novel
**Requires:** [access-control-findings, economic-findings]

### Hypothesis
MAX_TOKENS_PER_WALLET cap can be bypassed by using multiple wallets to accumulate more tokens than intended.

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `bonding_curve/src/instructions/purchase.rs:135-141` | purchase | Wallet cap check |

### Investigation Approach
1. **Check:** Is the cap per-wallet or per-user? (Per-wallet = Sybil-able)
2. **Check:** Does the cap matter economically? What's the intended protection?

---

## H028: remaining_accounts Forwarding Without Length Validation

**Category:** CPI, Token/SPL
**Estimated Priority:** Tier 2 (HIGH potential)
**Historical Precedent:** EP-108 (Remaining Account Spoofing)
**Origin:** KB (EP-108)
**Requires:** [cpi-findings, token-economic-findings]

### Hypothesis
Tax and Epoch forward remaining_accounts without length checks (only BC validates len==4). Extra or missing accounts could cause unexpected behavior.

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `tax-program/src/instructions/swap_sol_buy.rs:242-248` | remaining_accounts forward | No length check |
| `tax-program/src/instructions/swap_sol_sell.rs:193-203` | remaining_accounts forward | No length check |

### Investigation Approach
1. **Check:** What happens with 0 remaining_accounts for T22 tokens?
2. **Check:** What happens with extra accounts — ignored or processed?

---

## H029: Hardcoded CPI Discriminators Fragility

**Category:** CPI, Upgrade
**Estimated Priority:** Tier 2 (HIGH potential)
**Historical Precedent:** Novel
**Origin:** Novel
**Requires:** [cpi-findings, upgrade-admin-findings]

### Hypothesis
Hardcoded instruction discriminator bytes (sha256 hashes) in constants.rs would silently fail if target program instruction names change during an upgrade.

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `tax-program/src/constants.rs:156` | DEPOSIT_REWARDS_DISCRIMINATOR | Hardcoded bytes |
| `epoch-program/src/constants.rs:117,177` | UPDATE_CUMULATIVE, SWAP_EXEMPT | Hardcoded bytes |

### Investigation Approach
1. **Check:** Do discriminator constants match current target instruction hashes?
2. **Check:** Are there tests verifying discriminator correctness?

---

## H030: Admin SOL Withdrawal Centralization

**Category:** Access Control, Key Management
**Estimated Priority:** Tier 2 (HIGH potential)
**Historical Precedent:** EP-073 (Excessive Admin Privileges), EP-101 (Liquidity Extraction)
**Origin:** KB (EP-101)
**Requires:** [access-control-findings, upgrade-admin-findings]

### Hypothesis
Admin can drain all SOL from graduated bonding curve vaults and close token vaults to recover rent. Key compromise enables complete fund extraction.

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `bonding_curve/src/instructions/withdraw_graduated_sol.rs:88-89` | withdraw_graduated_sol | Admin SOL withdrawal |
| `bonding_curve/src/instructions/close_token_vault.rs` | close_token_vault | Rent recovery |

### Investigation Approach
1. **Check:** Are there state guards (only Graduated status)?
2. **Check:** Is this behind Squads multisig or direct key?

---

## H031: Carnage Fund Accumulation — Large MEV Target

**Category:** Economic, MEV
**Estimated Priority:** Tier 2 (HIGH potential)
**Historical Precedent:** Novel
**Origin:** Novel
**Requires:** [economic-findings, timing-findings]

### Hypothesis
With only 4.3% trigger probability and 1000 SOL cap per trigger, the Carnage Fund can accumulate well beyond 1000 SOL, creating a high-value MEV target for the fallback path.

### Investigation Approach
1. **Check:** How much SOL can accumulate between triggers?
2. **Check:** Is the 1000 SOL cap enforced per-trigger or total?

---

## H032: Cross-Program EpochState Tax Rate Trust

**Category:** CPI, Token/Economic
**Estimated Priority:** Tier 2 (HIGH potential)
**Historical Precedent:** Novel
**Origin:** Novel
**Requires:** [cpi-findings, token-economic-findings]

### Hypothesis
Tax Program reads EpochState and trusts tax_bps values without range validation. If Epoch Program had a bug producing out-of-range values, Tax Program would apply them.

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `tax-program/src/instructions/swap_sol_buy.rs:60-63` | EpochState owner check | Only owner validated |

### Investigation Approach
1. **Check:** Does Tax Program validate tax_bps is within [0, 10000]?
2. **Check:** Could a malformed EpochState produce >100% tax?

---

## H033: Sell-Then-Buy Carnage Compound Slippage

**Category:** Economic, MEV
**Estimated Priority:** Tier 2 (HIGH potential)
**Historical Precedent:** Novel
**Origin:** Novel
**Requires:** [economic-findings, token-economic-findings]

### Hypothesis
When Carnage sells held tokens first (2% probability), the sell pushes price down. The subsequent buy benefits from the lower price, but a front-runner could insert a buy between the sell and buy for profit.

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `epoch-program/src/helpers/carnage_execution.rs:134-399` | execute_carnage_internal | Sell then buy sequence |

### Investigation Approach
1. **Check:** Are sell and buy in the same instruction (atomic)?
2. **Check:** Can an attacker insert between them within the TX?

---

## H034: Sequential Multi-Swap Same Transaction Composability

**Category:** Timing, State Machine
**Estimated Priority:** Tier 2 (HIGH potential)
**Historical Precedent:** EP-038 (Cross-Instruction State Attack)
**Origin:** KB (EP-038)
**Requires:** [timing-findings, state-machine-findings]

### Hypothesis
A user can include multiple Tax swap instructions in the same transaction. Each instruction sees pool state as modified by the previous one. Reentrancy guard is cleared between instructions.

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `amm/src/instructions/swap_sol_pool.rs:84,334` | locked flag | Set/cleared per instruction |

### Investigation Approach
1. **Check:** Can buy + sell in same TX create atomic arbitrage?
2. **Check:** Is this standard Solana behavior or exploitable?

---

## H035: Sell-Side WSOL Delegate Authority Exploit

**Category:** Token/SPL, Access Control
**Estimated Priority:** Tier 2 (HIGH potential)
**Historical Precedent:** EP-028 (Delegate Authority Misuse)
**Origin:** KB (EP-028)
**Requires:** [token-economic-findings, access-control-findings]

### Hypothesis
Sell-side tax transfer uses raw SPL discriminator `3u8` from user's WSOL account. If the WSOL account has a delegate with remaining allowance, the delegate could complete the transfer.

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `tax-program/src/instructions/swap_sol_sell.rs:289-310` | Tax WSOL transfer | Raw SPL transfer |

### Investigation Approach
1. **Check:** Does the raw transfer instruction validate authority == user signer?
2. **Check:** SPL Token program behavior — does it check signer matches authority?

---

## H036: Conversion Vault No Rate Limit — Rapid PROFIT Drain

**Category:** Token/Economic, DoS
**Estimated Priority:** Tier 2 (HIGH potential)
**Historical Precedent:** Novel
**Origin:** Novel
**Requires:** [token-economic-findings]

### Hypothesis
No rate limit on conversion frequency. A user could rapidly convert large CRIME/FRAUD amounts, draining all vault PROFIT before others can convert.

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `conversion-vault/src/instructions/convert.rs:116-174` | convert | No cooldown |

### Investigation Approach
1. **Check:** Is there any per-user or per-time limit?
2. **Check:** How much PROFIT is in the vault?

---

## H037: AMM Program ID Cluster Mismatch in Tax Constants

**Category:** CPI, Configuration
**Estimated Priority:** Tier 2 (HIGH potential)
**Historical Precedent:** Novel
**Origin:** Novel
**Requires:** [cpi-findings]

### Hypothesis
Tax Program's constants.rs has mainnet AMM ID (`5JsS...`) while AMM's declare_id uses devnet ID (`J7Jx...`). Build-time sync resolves this, but source-level mismatch means naive builds produce incompatible programs.

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `tax-program/src/constants.rs:100` | amm_program_id | Mainnet ID in source |
| `amm/src/lib.rs:12` | declare_id! | Devnet ID in source |

### Investigation Approach
1. **Check:** Does build.sh always run sync-program-ids.ts?
2. **Check:** What happens if someone runs `anchor build` without build.sh?

---

## H038: Transfer Hook Whitelist Bypass via Proxy Contract

**Category:** Token/SPL, Access Control
**Estimated Priority:** Tier 2 (HIGH potential)
**Historical Precedent:** EP-122 (Programmable Asset Rule Bypass)
**Origin:** KB (EP-122)
**Requires:** [access-control-findings, token-economic-findings]

### Hypothesis
Token-2022 enforces the transfer hook on all transfers. But could a crafted program bypass the hook by using a different transfer mechanism?

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `transfer-hook/src/instructions/transfer_hook.rs:77-113` | handler | Hook enforcement |

### Investigation Approach
1. **Check:** Does Token-2022 guarantee hook invocation for ALL transfer types?
2. **Check:** Can `transfer` (not `transfer_checked`) bypass the hook?
3. **Check:** Token-2022 documentation on hook enforcement guarantees

---

## H039: Carnage Fallback Executor — No Bounty Liveness Risk

**Category:** Economic, Risk Management
**Estimated Priority:** Tier 2 (HIGH potential)
**Historical Precedent:** Novel
**Origin:** Novel
**Requires:** [economic-findings, timing-findings]

### Hypothesis
No economic incentive exists for anyone to execute fallback Carnage. If the protocol crank is down, Carnage execution expires after 300 slots.

### Investigation Approach
1. **Check:** Is there a bounty for fallback execution?
2. **Check:** What happens when Carnage expires — SOL stays in vault?

---

## H040: Manual SPL Instruction Discriminator Fragility

**Category:** CPI
**Estimated Priority:** Tier 2 (HIGH potential)
**Historical Precedent:** Novel
**Origin:** Novel
**Requires:** [cpi-findings]

### Hypothesis
Raw bytes `3u8` (Transfer), `8u8` (Burn), `9u8` (CloseAccount), etc. are used instead of SDK helpers. If SPL Token encoding changes, these silently break.

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `tax-program/src/instructions/swap_sol_sell.rs:297` | Raw discriminator | Manual `3u8` |
| `epoch-program/src/helpers/carnage_execution.rs:497` | Raw discriminator | Manual `8u8` |

### Investigation Approach
1. **Check:** Are these correct for current SPL Token / Token-2022?
2. **Check:** Have these discriminators ever changed historically?

---

## H041: Epoch Skip Staking Reward Forfeiture

**Category:** Timing, Economic
**Estimated Priority:** Tier 2 (HIGH potential)
**Historical Precedent:** Novel
**Origin:** Novel
**Requires:** [timing-findings, economic-findings]

### Hypothesis
If crank delays cause epoch jumps (e.g., 100 → 105), rewards for skipped epochs are silently forfeited. Stakers lose real yield.

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `epoch-program/src/instructions/trigger_epoch_transition.rs:143-149` | epoch skip | Direct set to expected_epoch |

### Investigation Approach
1. **Check:** How does update_cumulative handle epoch gaps?
2. **Check:** Are pending_rewards preserved or reset during epoch skip?

---

## H042-H048: RECHECK Tier 3 (Previous Accepted/Fixed Findings)

These rechecks verify lower-priority previous findings on modified code:

- **H042:** BC initialize_curve admin gate (RECHECK H003)
- **H043:** BC close_token_vault admin gate (RECHECK H005)
- **H044:** Epoch init ProgramData gate (RECHECK H021)
- **H045:** Dual-curve grief economics (RECHECK H031)
- **H046:** taxes_confirmed unchecked by Tax (RECHECK H048)
- **H047:** Unchecked as u64 cast in get_current_price (RECHECK H077)
- **H048:** Buy path 50% output floor adequacy (RECHECK H014)

Investigation approach for all: Verify the fix/acceptance is still valid on the modified code. Check if the modification introduced any regression.

---

## H049: get_current_price Silent Saturation

**Category:** Arithmetic, Error Handling
**Estimated Priority:** Tier 3 (MEDIUM-LOW potential)
**Historical Precedent:** EP-020 (Unsafe Type Casting)
**Origin:** KB (EP-020)
**Requires:** [arithmetic-findings]

### Hypothesis
`get_current_price` uses `.unwrap_or(0)` on division and `.unwrap_or(u64::MAX)` on cast. If tokens_sold exceeds TOTAL_FOR_SALE, price silently becomes 0.

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `bonding_curve/src/math.rs:222-225` | get_current_price | Silent saturation |

### Investigation Approach
1. **Check:** Can tokens_sold ever exceed TOTAL_FOR_SALE?
2. **Check:** Where is get_current_price used — events only or financial logic?

---

## H050: Bonding Curve Sell Tax u64 Overflow Window

**Category:** Arithmetic
**Estimated Priority:** Tier 3 (MEDIUM-LOW potential)
**Historical Precedent:** EP-015 (Integer Overflow)
**Origin:** KB (EP-015)
**Requires:** [arithmetic-findings]

### Hypothesis
`sol_gross.checked_mul(SELL_TAX_BPS)` operates in u64 only. Safe with current params (max 500 SOL * 1500 = 7.5e14), but future parameter increases could overflow.

### Target Code
| File | Function | Relevance |
|------|----------|-----------|
| `bonding_curve/src/instructions/sell.rs:192-197` | sell tax calc | u64 only |

### Investigation Approach
1. **Check:** Current params safe?
2. **Check:** Are params changeable at runtime? (No — hardcoded)

---

## H051-H065: Remaining Tier 3 Strategies

- **H051:** claim_refund last-claimer rounding advantage (`claim_refund.rs:159-162`)
- **H052:** Conversion vault truncation loss — 99 base units per conversion (`convert.rs:103`)
- **H053:** carnage_lock_slot not explicitly initialized — relies on Anchor zero-fill (`initialize_epoch_state.rs`)
- **H054:** Stale carnage_target after expiry — retained value (`expire_carnage.rs:88-89`)
- **H055:** Epoch skip reward forfeiture quantification — economic impact assessment
- **H056:** Staking cooldown timestamp manipulation — ~30s validator drift on 12h cooldown (`unstake.rs:126-133`)
- **H057:** Micro-tax edge case — <4 lamports routes entirely to staking (`tax_math.rs:88-90`)
- **H058:** WSOL intermediary rent assumption — swap_authority retaining rent between close/create
- **H059:** Token-2022 Transfer Hook reentrancy check — `check_is_transferring()` correctness
- **H060:** Bonding curve refund ordering advantage — floor rounding dust accumulation for last claimer
- **H061:** start_curve unchecked addition — `clock.slot + DEADLINE_SLOTS` overflow (u64::MAX unreachable)
- **H062:** WhitelistAuthority burn idempotency — any signer can call after burn (`burn_authority.rs:26-29`)
- **H063:** force_carnage devnet gate verification — IDL exclusion in mainnet builds
- **H064:** distribute_tax_escrow timing — callable after graduation by anyone
- **H065:** Bonding curve solvency buffer adequacy — SOLVENCY_BUFFER_LAMPORTS = 10

---

## Cross-Strategy Analysis

### Potentially Related Strategies

| Strategy A | Strategy B | Potential Combination |
|------------|------------|----------------------|
| H009 (Carnage skip) | H014 (Economic manipulation) | Same root cause — optional carnage_state enables both |
| H010 (Fallback MEV) | H016 (swap_exempt min=0) | Both target Carnage swap path's slippage weakness |
| H010 (Fallback MEV) | H031 (Fund accumulation) | Larger accumulated fund = higher MEV value target |
| H011 (Byte offsets) | H022 (CPI depth) | AMM upgrade affects both offset reads AND CPI chain |
| H012 (Build pipeline) | H037 (Cluster mismatch) | Both target build-time ID synchronization |
| H019 (Tax rate arbitrage) | H009 (Carnage skip) | Both exploit gap between VRF reveal and consume_randomness |
| H020 (No pause) | H011 (Byte corruption) | Byte corruption + no pause = extended exploit window |
| H027 (BC Sybil) | H045 (Dual-curve grief) | Multiple wallets amplify dual-curve grief |
| H033 (Sell+buy slippage) | H010 (Fallback MEV) | Sell path + buy path both vulnerable to sandwich |
| H034 (Multi-swap TX) | H004 (Sell slippage) | Sequential swaps may interact with slippage floor |

### Strategy Chaining

**Chain 1: Carnage Manipulation** — H009 (suppress Carnage) + H014 (economic benefit) + H019 (arbitrage window) = An actor with large token position can suppress Carnage while exploiting tax rate foreknowledge.

**Chain 2: Carnage Extraction** — H031 (fund accumulates) + H010 (fallback MEV) + H016 (min=0 bypass) = Large fund accumulation increases MEV extraction value on fallback path.

**Chain 3: Upgrade Cascade** — H011 (byte offset corruption) + H020 (no pause) + H021 (upgrade cascade) = AMM upgrade corrupts tax calculations, no way to pause during fix deployment.

---

## Supplemental Strategies

**Generated after Tier 1 investigation. 5 CONFIRMED + 5 POTENTIAL findings revealed these supplemental attack surfaces:**

### S001: Carnage Suppression + Tax Arbitrage Combined Attack
**Category:** Economic, MEV | **Priority:** Supplemental (HIGH)
**Inspired by:** H009 (CONFIRMED) + H019 (CONFIRMED)
**Hypothesis:** An attacker combines Carnage suppression (omit carnage_state) with tax rate foreknowledge (watch VRF reveal) to simultaneously suppress buy pressure AND trade with perfect rate information. The combined attack is more profitable than either alone — suppression ensures price divergence persists while rate arbitrage extracts value from each epoch transition.
**Target Code:** `consume_randomness.rs:76-80`, `tax_derivation.rs:84-128`
**Requires:** [economic-findings, timing-findings]

### S002: Carnage Fund Accumulation Under Suppression — Vault Balance Growth
**Category:** Economic | **Priority:** Supplemental (MEDIUM)
**Inspired by:** H009 (CONFIRMED) + H014 (CONFIRMED)
**Hypothesis:** Under sustained Carnage suppression, the Carnage vault accumulates 24% of all swap taxes indefinitely. If suppression is eventually lifted (or the attacker changes strategy), the accumulated vault balance creates a massive single-event market impact when Carnage finally fires — potentially destabilizing pool prices.
**Target Code:** `epoch-program/src/state/carnage_fund_state.rs`, `tax-program/src/helpers/tax_math.rs:88-107`
**Requires:** [economic-findings, token-economic-findings]

### S003: Stale Mainnet Mints Cause Silent Graduation Failure
**Category:** Configuration | **Priority:** Supplemental (HIGH)
**Inspired by:** H008 (POTENTIAL HIGH)
**Hypothesis:** The stale devnet mint addresses in bonding_curve and conversion-vault mainnet branches would cause graduation to silently fail — `prepare_transition` references wrong mints, AMM pool creation uses wrong token accounts, and users holding real mainnet tokens cannot convert. The build-time patch script is the sole safeguard.
**Target Code:** `bonding_curve/src/constants.rs:176-195`, `conversion-vault/src/constants.rs:35-68`
**Requires:** [upgrade-admin-findings, token-economic-findings]

### S004: Program Keypair Extraction from Git History
**Category:** Supply Chain, Key Management | **Priority:** Supplemental (CRITICAL)
**Inspired by:** H012 (POTENTIAL HIGH)
**Hypothesis:** Even if program keypairs are removed from HEAD, git history preserves them permanently. Any collaborator, CI system, or leaked repo clone provides full upgrade authority over all 7 programs. The keypairs must be rotated (redeploy with new IDs) before mainnet launch — deletion from HEAD is insufficient.
**Target Code:** `keypairs/*.json` (git history)
**Requires:** [upgrade-admin-findings]

### S005: Admin Transfer Frontrun During Squads Migration
**Category:** Access Control, MEV | **Priority:** Supplemental (HIGH)
**Inspired by:** H015 (CONFIRMED HIGH)
**Hypothesis:** During the planned Squads multisig migration, the single-step `transfer_admin` calls are observable on-chain. A monitoring bot could detect the transfer TX in mempool and attempt to race it with a transfer to an attacker-controlled address. While the admin must sign, if the transfer TX is observed before landing, the timing window is visible.
**Target Code:** `amm/src/instructions/transfer_admin.rs`, `transfer-hook/src/instructions/transfer_authority.rs`
**Requires:** [access-control-findings, timing-findings]

### S006: Fallback MEV + Carnage Suppression Alternation Strategy
**Category:** MEV, Economic | **Priority:** Supplemental (HIGH)
**Inspired by:** H009 (CONFIRMED) + H010 (CONFIRMED)
**Hypothesis:** A sophisticated MEV actor could alternate between suppressing Carnage (grow the vault) and allowing it to trigger via the fallback path (extract up to 25%). The strategy: suppress for N epochs to build vault balance, then allow one trigger on a favorable pool state, sandwich the fallback execution, then resume suppression. This converts the 4.3% Carnage trigger into a controlled extraction mechanism.
**Target Code:** `consume_randomness.rs:76-80`, `execute_carnage.rs`, `carnage_execution.rs:324-350`
**Requires:** [economic-findings, timing-findings]

### S007: Cross-Program Discriminator Mismatch After Instruction Rename
**Category:** CPI, Upgrade | **Priority:** Supplemental (MEDIUM)
**Inspired by:** H011 (POTENTIAL) — related fragility in cross-program coupling
**Hypothesis:** Tax and Epoch programs hardcode Anchor-generated discriminator bytes for cross-program CPI (DEPOSIT_REWARDS_DISCRIMINATOR, SWAP_EXEMPT_DISCRIMINATOR, UPDATE_CUMULATIVE_DISCRIMINATOR). If an Anchor instruction is renamed during an upgrade, the sha256("global:instruction_name")[0..8] changes silently. The calling program's CPI would fail with an uninformative error.
**Target Code:** `tax-program/src/constants.rs:156`, `epoch-program/src/constants.rs:117,177`
**Requires:** [cpi-findings, upgrade-admin-findings]

### S008: VRF Reveal + Delayed Consume Enables Carnage Target Prediction
**Category:** Oracle, MEV | **Priority:** Supplemental (MEDIUM)
**Inspired by:** H019 (CONFIRMED) — extends the timing window to Carnage targeting
**Hypothesis:** The VRF reveal exposes not just tax rates (bytes 0-4) but also the Carnage decision byte (byte 5) and target byte (byte 6). An attacker watching the reveal can predict whether Carnage will trigger AND which token it will buy, then pre-position before consume_randomness lands. This extends H019's rate-arbitrage window to Carnage-event front-running.
**Target Code:** `epoch-program/src/helpers/carnage.rs`, `epoch-program/src/helpers/tax_derivation.rs`
**Requires:** [oracle-findings, timing-findings, economic-findings]

### S009: PoolState Layout Drift Between Tax and Epoch Readers
**Category:** CPI, Arithmetic | **Priority:** Supplemental (LOW)
**Inspired by:** H011 (POTENTIAL) — the two readers are independent duplicates
**Hypothesis:** Tax Program's `pool_reader.rs:79-88` and Epoch Program's `carnage_execution.rs:825-851` independently hardcode the same byte offsets. If one reader is updated during a bug fix but the other is not, the two programs would disagree on pool reserves, creating inconsistent slippage floors between normal swaps and Carnage swaps.
**Target Code:** `tax-program/src/helpers/pool_reader.rs`, `epoch-program/src/helpers/carnage_execution.rs:825-851`
**Requires:** [cpi-findings, arithmetic-findings]

### S010: Conversion Vault PROFIT Drain via Arbitrage Loop
**Category:** Economic | **Priority:** Supplemental (MEDIUM)
**Inspired by:** H008 (POTENTIAL) — related to conversion vault economics
**Hypothesis:** If the PROFIT market price diverges sufficiently from the 100:1 fixed conversion rate (i.e., 100 CRIME/FRAUD buys more PROFIT on AMM than via vault), the vault is economically safe. But if PROFIT trades BELOW the vault rate, arbitrageurs can buy cheap CRIME/FRAUD on AMM → convert 100:1 to PROFIT → sell PROFIT on AMM → repeat. The vault's PROFIT supply drains to zero. Tax friction (3-14%) is the only brake.
**Target Code:** `conversion-vault/src/instructions/convert.rs:101-113`
**Requires:** [economic-findings, token-economic-findings]

---

## Statistics

| Category | Count | Tier 1 | Tier 2 | Tier 3 | Novel | KB-Based | RECHECK |
|----------|-------|--------|--------|--------|-------|----------|---------|
| Access Control | 10 | 5 | 4 | 1 | 3 | 3 | 4 |
| Arithmetic | 5 | 1 | 0 | 4 | 1 | 1 | 3 |
| State Machine | 5 | 2 | 1 | 2 | 2 | 1 | 2 |
| CPI & External | 10 | 3 | 5 | 2 | 4 | 2 | 4 |
| Token & Economic | 12 | 3 | 5 | 4 | 5 | 2 | 5 |
| Oracle & Data | 3 | 1 | 1 | 1 | 0 | 2 | 1 |
| Upgrade & Admin | 6 | 2 | 2 | 2 | 2 | 2 | 2 |
| Timing & Ordering | 6 | 2 | 2 | 2 | 3 | 1 | 2 |
| Economic Model | 8 | 1 | 2 | 5 | 4 | 0 | 4 |
| **TOTAL** | **65** | **19** | **22** | **24** | **14 (22%)** | **14** | **27** |

### Origin Distribution
- **RECHECK (previous findings):** 27 (42%) — All modified files, every finding re-examined
- **Novel:** 14 (22%) — Codebase-specific, not from known EPs ✓ (>20% threshold met)
- **KB (exploit patterns):** 14 (22%) — From PATTERNS_INDEX cross-reference
- **Playbook:** 10 (15%) — From protocol-specific playbooks

---

## Notes for Investigators

### General Guidance

- Each strategy should be investigated independently
- Reference ARCHITECTURE.md for context
- Write findings to `.audit/findings/H{XXX}.md`
- Don't skip strategies even if they seem unlikely
- Note any discoveries that suggest NEW strategies (→ Supplemental section)
- RECHECK strategies: focus on verifying the fix, not re-investigating the original bug

### Status Definitions

- **CONFIRMED**: Vulnerability exists and is exploitable
- **POTENTIAL**: Could be vulnerable under specific conditions
- **NOT VULNERABLE**: Protected against this attack
- **NEEDS MANUAL REVIEW**: Couldn't determine, needs expert

### Tier-Specific Investigation Depth

- **Tier 1**: Full investigation — read all target code, trace all paths, construct PoC if confirmed
- **Tier 2**: Standard investigation — read target code, verify constraints, assess exploitability
- **Tier 3**: Quick check — verify stated protection exists, spot-check for regression

---

**This catalog is the input for Phase 4: Parallel Investigation**
