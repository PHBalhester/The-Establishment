# Codebase Security Audit Index

**Generated:** 2026-02-22
**Project:** Dr Fraudsworth - Solana Memecoin/Yield Farm
**Total Programs:** 6
**Total .rs Files:** 85
**Total LOC:** ~12,850 (approximate, including tests)

---

## Executive Summary

Dr Fraudsworth consists of 6 interconnected Anchor/Rust programs implementing a tax-coordinated DeFi protocol with VRF-driven epoch advancement and atomic carnage (liquidation) mechanics. The codebase demonstrates professional security practices:

- **CEI Pattern**: Strictly enforced in swaps (Checks-Effects-Interactions)
- **CPI Safety**: Extensive cross-program call validation, anti-reroll protection (VRF)
- **Token Handling**: Proper Token-2022 transfer hook integration with manual CPI forwarding
- **State Machine**: VRF timeout recovery, epoch boundaries, anti-reentrancy guards
- **Arithmetic**: All checked operations with overflow protection (Option<T> pattern)

**High-Risk Areas:**
- CPI depth near Solana 4-level limit (execute_carnage_atomic path)
- Token-2022 transfer hooks with complex account resolution
- Cross-program PDA validation (Tax ↔ Epoch, Staking ↔ Epoch)
- Carnage bounty rent-exempt minimum bug (in MEMORY.md TODO)

---

## Programs Overview

| Program | Files | Focus | Risk |
|---------|-------|-------|------|
| **amm** | 18 | Constant-product AMM (CPMM), pool mgmt | HIGH (CPI, token transfers, math) |
| **tax-program** | 16 | Tax routing, atomic distribution | HIGH (CPI, cross-program) |
| **epoch-program** | 12 | VRF-driven state machine, carnage | CRITICAL (CPI depth, VRF) |
| **transfer-hook** | 9 | Token-2022 whitelist enforcement | HIGH (hook, authorization) |
| **staking** | 11 | PROFIT yield distribution | MEDIUM (staking math) |
| **stub-staking** | 2 | Minimal stub for testing | LOW (test harness) |

---

## Detailed Program Index

### Program: AMM

**Purpose:** Constant-product automated market maker managing CRIME/SOL, FRAUD/SOL, CRIME/PROFIT, FRAUD/PROFIT pools.

**Risk Profile:** HIGH
**Key Concerns:** CPI access control via swap_authority PDA, transfer hook account forwarding, k-invariant maintenance, reentrancy guard.

| File | LOC | Type | Focus Areas | Risk Indicators |
|------|-----|------|-------------|-----------------|
| lib.rs | 93 | program | Instruction dispatch | dispatch, entry point |
| constants.rs | 46 | constant | Hardcoded PDA seeds, fee caps | AC, config |
| errors.rs | 108 | error | 13 distinct errors | error def |
| events.rs | 76 | event | Pool init, swap, admin burn events | instrumentation |
| state/admin.rs | 19 | state | AdminConfig PDA | singleton |
| state/pool.rs | 81 | state | PoolState structure, pool type enum | state def |
| state/mod.rs | 6 | lib | State module export | module |
| helpers/mod.rs | 3 | lib | Helpers module export | module |
| helpers/math.rs | 498 | helper | Pure swap math (tests inline) | arithmetic, proptest |
| helpers/transfers.rs | 191 | helper | T22/SPL transfer CPI helpers | CPI, token |
| instructions/mod.rs | 12 | lib | Instruction module export | module |
| instructions/initialize_admin.rs | 60 | instruction | Admin initialization, upgrade authority check | AC, admin |
| instructions/burn_admin.rs | 51 | instruction | Irreversible admin burn | AC, admin |
| instructions/initialize_pool.rs | 286 | instruction | Pool creation, vault setup, liquidity seeding | AC, CPI, token, arithmetic |
| instructions/swap_sol_pool.rs | 430 | instruction | CRIME/FRAUD ↔ SOL swap routing | CPI, reentrancy, k-invariant |
| instructions/swap_profit_pool.rs | 352 | instruction | CRIME/FRAUD ↔ PROFIT dual-hook routing | CPI, reentrancy, hook accounts |
| tests/test_pool_initialization.rs | 80+ | test | Pool init unit tests | testing |
| tests/test_swap_sol_pool.rs | 120+ | test | SOL pool swap tests | testing |
| tests/test_swap_profit_pool.rs | 100+ | test | PROFIT pool swap tests | testing |

#### Key Files Analysis

**helpers/math.rs**
- **Purpose:** Pure constant-product formula implementation
- **Functions:** `calculate_effective_input`, `calculate_swap_output`, `verify_k_invariant`, zero-output checks
- **Security:** Comprehensive proptest suite (10,000 iterations), all checked arithmetic
- **Risks:** Integer truncation in output calculation (expected per spec)

**instructions/swap_sol_pool.rs**
- **Account Access Control:** Requires `swap_authority` Signer verified via seeds::program = TAX_PROGRAM_ID
- **Reentrancy Guard:** pool.locked boolean set/cleared per swap
- **Transfer Routing:** Direction-aware conditional routing between T22 (CRIME/FRAUD) and SPL (WSOL)
- **Hook Account Forwarding:** remaining_accounts passed directly to transfer_t22_checked
- **k-Invariant Verification:** post-swap reserves checked to ensure k ≥ k_before

**instructions/swap_profit_pool.rs**
- **Dual-Hook Split:** remaining_accounts split at midpoint — first half for input transfer, second half for output
- **Account Structure:** Assumes canonical mint ordering (mint_a < mint_b)
- **CEI Compliance:** Guards reserves before mutations, PDA signer seeds built from immutable captures

**instructions/initialize_pool.rs**
- **Admin Control:** Pool creation gated by AdminConfig.admin via has_one constraint
- **Pool Type Inference:** Derived from token program IDs, not caller-declared (prevents misclassification attacks)
- **Vault Creation:** PDA-owned token accounts created with pool PDA as authority
- **Fee Validation:** MAX_LP_FEE_BPS (500 bps = 5%) enforced to prevent misconfiguration

**Risks & Mitigations:**
- ✅ Swap access control enforced via Tax Program signed swap_authority
- ✅ Pool locked flag prevents concurrent swaps
- ✅ k-invariant maintained across all swap paths
- ⚠️ Vault substitution possible if account validation is missing (mitigated by constraint checks)

---

### Program: Tax Program

**Purpose:** Tax collection, asymmetric distribution, and routing to staking/carnage/treasury. Routes swaps through AMM with tax calculation and CPI.

**Risk Profile:** HIGH
**Key Concerns:** Cross-program CPI to AMM, tax distribution splits, minimum output floor enforcement, canonical mint ordering (Phase 52.1).

| File | LOC | Type | Focus Areas | Risk Indicators |
|------|-----|------|-------------|-----------------|
| lib.rs | 125 | program | 6 instructions: swap_sol_buy/sell, swap_profit_buy/sell, swap_exempt, initialize_wsol | dispatch |
| constants.rs | 50+ | constant | TAX_BPS, STAKING_PERCENT, CARNAGE_PERCENT, treasury, PDA seeds | config |
| errors.rs | 30+ | error | Tax-specific errors | error def |
| events.rs | 50+ | event | TaxedSwap, UntaxedSwap, ExemptSwap | instrumentation |
| state/mod.rs | 5 | lib | State module export | module |
| state/epoch_state_reader.rs | 80+ | helper | Read-only epoch state for tax rate lookup | state reader |
| helpers/mod.rs | 3 | lib | Helpers module export | module |
| helpers/pool_reader.rs | 100+ | helper | Direct PoolState byte reading (offset parsing) | state inspection |
| helpers/tax_math.rs | 80+ | helper | Tax calculation, output floor enforcement | arithmetic |
| instructions/mod.rs | 10 | lib | Instruction module export | module |
| instructions/swap_sol_buy.rs | 250+ | instruction | SOL → CRIME/FRAUD swap with 75/24/1 tax split | CPI, tax, distribution |
| instructions/swap_sol_sell.rs | 250+ | instruction | CRIME/FRAUD → SOL swap with post-swap tax | CPI, tax, distribution |
| instructions/swap_profit_buy.rs | 315 | instruction | CRIME/FRAUD → PROFIT untaxed, output floor enforcement | CPI, mint ordering |
| instructions/swap_profit_sell.rs | 307 | instruction | PROFIT → CRIME/FRAUD untaxed, mint ordering detection | CPI, mint ordering |
| instructions/swap_exempt.rs | 256 | instruction | Carnage tax-exempt bidirectional swap | CPI, carnage, oracle |
| instructions/initialize_wsol_intermediary.rs | 80+ | instruction | WSOL account setup (one-time admin) | initialization |
| tests/test_swap_sol_buy.rs | 100+ | test | Buy path unit tests | testing |
| tests/test_swap_sol_sell.rs | 100+ | test | Sell path unit tests | testing |
| tests/test_swap_profit_buy.rs | 80+ | test | Untaxed buy path tests | testing |
| tests/test_swap_profit_sell.rs | 80+ | test | Untaxed sell path tests | testing |
| tests/test_swap_exempt.rs | 100+ | test | Carnage exempt path tests | testing |

#### Key Files Analysis

**swap_sol_buy.rs / swap_sol_sell.rs**
- **Tax Calculation:** 75% staking, 24% carnage, 1% treasury
- **Buy vs Sell:** Buy taxes input; sell taxes output (asymmetric per spec)
- **Distribution:** Transfers to escrow (staking), carnage vault, treasury via manual instruction CPI
- **CPI Path:** swap_authority signs AMM::swap_sol_pool call

**swap_profit_buy.rs / swap_profit_sell.rs**
- **Untaxed:** Only AMM LP fee (0.5%) applies
- **Canonical Ordering Detection (Phase 52.1):** Reads pool.mint_a from bytes and compares to PROFIT mint
  - If reversed: output snapshot from opposite token account, direction byte inverted
  - Enables single pool PDA for both orderings with runtime direction correction
- **Output Floor Enforcement (SEC-10):** Validates minimum_output ≥ calculated floor before CPI
- **Post-CPI Balance Snapshot:** reload() re-deserializes token account after CPI mutation for event accuracy

**swap_exempt.rs**
- **Carnage Authority PDA:** Requires seeds::program = epoch_program_id() constraint
- **Bidirectional:** Supports both SOL→Token (direction=0/AtoB) and Token→SOL (direction=1/BtoA)
- **No Slippage Protection:** minimum_out = 0 (per Carnage_Fund_Spec Section 9.3)
- **CPI Depth:** Adds depth 1 to critical path (already near Solana 4-level limit)

**Risks & Mitigations:**
- ✅ Tax distribution uses manual instruction CPI (not transfer) for atomicity
- ✅ Mint ordering detection prevents output snapshot from wrong token account
- ✅ Output floor prevents MEV manipulation of slippage
- ⚠️ Pool state byte reading at hardcoded offsets (157-159 for lp_fee_bps) — fragile if PoolState layout changes
- ⚠️ CPI depth near limit; swap_exempt path reaches 4 levels (Epoch → Tax → AMM → T22 → Hook)

---

### Program: Epoch Program

**Purpose:** VRF-driven tax regime coordination, epoch state machine, and Carnage Fund execution. Manages 30-minute epochs with Switchboard On-Demand randomness.

**Risk Profile:** CRITICAL
**Key Concerns:** CPI depth at Solana limit, VRF timeout recovery, anti-reroll protection, carnage rent-exempt minimum bug (TODO in MEMORY.md).

| File | LOC | Type | Focus Areas | Risk Indicators |
|------|-----|------|-------------|-----------------|
| lib.rs | 266 | program | 8 instructions: init, trigger, consume, retry, init_carnage, execute, execute_atomic, expire, force | dispatch, critical |
| constants.rs | 60+ | constant | SLOTS_PER_EPOCH, VRF_TIMEOUT_SLOTS, TRIGGER_BOUNTY, CARNAGE_SOL_VAULT_SEED | config |
| errors.rs | 40+ | error | VRF, epoch, carnage-specific errors | error def |
| events.rs | 60+ | event | EpochTransitionTriggered, CarnageExecuted, CarnageExpired | instrumentation |
| state/enums.rs | 40+ | enum | CheapSide (CRIME/FRAUD), CarnageAction (Burn/Sell), CarnageTarget | state enum |
| state/epoch_state.rs | 150+ | state | EpochState struct (37 fields), tax rates, VRF binding | singleton state |
| state/carnage_fund_state.rs | 100+ | state | CarnagedState struct, vault tracking, statistics | carnage state |
| state/mod.rs | 5 | lib | State module export | module |
| helpers/mod.rs | 3 | lib | Helpers module export | module |
| helpers/carnage.rs | 200+ | helper | Carnage buy/sell/burn execution paths | carnage logic |
| helpers/tax_derivation.rs | 80+ | helper | Tax rate calculation from VRF bytes | tax logic |
| instructions/mod.rs | 15 | lib | Instruction module export | module |
| instructions/initialize_epoch_state.rs | 80+ | instruction | Genesis epoch setup (admin-only) | initialization |
| instructions/trigger_epoch_transition.rs | 390 | instruction | Epoch boundary validation, VRF randomness binding, bounty payment | CPI, oracle, timing |
| instructions/consume_randomness.rs | 200+ | instruction | VRF reveal consumption, tax rate update | oracle, state update |
| instructions/retry_epoch_vrf.rs | 150+ | instruction | VRF timeout recovery, fresh randomness binding | oracle, timeout |
| instructions/initialize_carnage_fund.rs | 100+ | instruction | Carnage vault setup (one-time) | initialization |
| instructions/execute_carnage.rs | 250+ | instruction | Fallback carnage execution (post-deadline) | carnage, fallback |
| instructions/execute_carnage_atomic.rs | 350+ | instruction | Primary carnage path, Tax CPI, ALT v0 TX | carnage, CPI depth |
| instructions/expire_carnage.rs | 100+ | instruction | Pending carnage cleanup after deadline | cleanup |
| instructions/force_carnage.rs | 80+ | instruction | Devnet-only test helper (mark for removal) | testing, admin |

#### Key Files Analysis

**trigger_epoch_transition.rs**
- **Epoch Boundary Check:** Computes expected_epoch from slot; requires expected > current_epoch
- **VRF Freshness:** seed_slot must be ≤ 1 slot old (prevents stale randomness)
- **Not-Yet-Revealed Check:** Calls randomness_data.get_value() to ensure still in commit phase
- **Anti-Reroll Protection:** Binds pending_randomness_account to epoch_state for consume_randomness verification
- **Bounty Payment:** Transfers TRIGGER_BOUNTY_LAMPORTS from carnage_sol_vault via invoke_signed
- **⚠️ BUG (MEMORY.md TODO):** vault_balance >= TRIGGER_BOUNTY_LAMPORTS but doesn't account for rent-exempt minimum (~890,880 lamports). After transfer, vault can drop below rent floor, causing runtime rejection.

**consume_randomness.rs**
- **Anti-Reroll Check:** Validates randomness_account matches epoch_state.pending_randomness_account
- **VRF Reveal:** Reads 6+ bytes of randomness, computes tax rates (dynamic between 1-4% low, 11-14% high)
- **Cheap Side Flipping:** 75% probability to flip CRIME/FRAUD cheap side
- **Carnage Trigger:** ~4.3% probability to set carnage_pending = true
- **Epoch Finalization:** CPI to staking program (stub-staking on devnet) via update_cumulative

**execute_carnage_atomic.rs**
- **CRITICAL CPI DEPTH:** Reaches Solana 4-level limit:
  1. execute_carnage_atomic (Epoch)
  2. → Tax::swap_exempt (depth 1)
  3. → AMM::swap_sol_pool (depth 2)
  4. → Token-2022::transfer_checked (depth 3)
  5. → Transfer Hook::execute (depth 4 — SOLANA LIMIT)
- **Atomicity:** All-or-nothing swap + burn/sell execution
- **Actions:**
  - BuyOnly: Direct swap SOL → target token
  - Burn: Sell holdings → SOL, then buy target
  - Sell: Same as Burn (legacy naming)
- **Swap Cap:** MAX_CARNAGE_SWAP_LAMPORTS (1000 SOL) prevents draining vault
- **Carnage Authority:** PDA with seeds = [CARNAGE_SIGNER_SEED] signs Tax CPI

**retry_epoch_vrf.rs**
- **Timeout Check:** Requires vrf_request_slot + VRF_TIMEOUT_SLOTS (300 slots) elapsed
- **Fresh Randomness:** New randomness account must have valid seed_slot
- **Rebinding:** Replaces pending_randomness_account, resets vrf_pending = true for retry cycle

**Risks & Mitigations:**
- ✅ Anti-reroll protection prevents oracle replay attacks
- ✅ VRF timeout recovery prevents protocol deadlock
- ✅ Bounty skipped (not error) if vault insufficient
- ⚠️ **CRITICAL BUG:** Bounty rent-exempt minimum not accounted for (MEMORY.md TODO)
- ⚠️ CPI depth at absolute Solana limit; no room for additional calls on execute_carnage_atomic path
- ⚠️ Devnet-only force_carnage instruction MUST be removed before mainnet

---

### Program: Transfer Hook

**Purpose:** Token-2022 transfer hook enforcing whitelist-based access control for CRIME, FRAUD, PROFIT mints.

**Risk Profile:** HIGH
**Key Concerns:** Whitelist authorization model, hook invocation validation, SPL interface compatibility.

| File | LOC | Type | Focus Areas | Risk Indicators |
|------|-----|------|-------------|-----------------|
| lib.rs | 110 | program | 5 instructions | dispatch |
| errors.rs | 30+ | error | Transfer hook specific errors | error def |
| events.rs | 30+ | event | WhitelistEntryAdded, AuthorityBurned, ExtraAccountMetaListInitialized | instrumentation |
| state/mod.rs | 5 | lib | State module export | module |
| state/whitelist_authority.rs | 50+ | state | WhitelistAuthority singleton PDA | singleton, auth |
| state/whitelist_entry.rs | 40+ | state | WhitelistEntry PDA per whitelisted address | entry |
| instructions/mod.rs | 10 | lib | Instruction module export | module |
| instructions/initialize_authority.rs | 80+ | instruction | Authority PDA creation (once per mint) | initialization |
| instructions/add_whitelist_entry.rs | 100+ | instruction | Add address to whitelist (authority-gated) | authorization, entry |
| instructions/burn_authority.rs | 80+ | instruction | Irreversible authority burn (idempotent) | authorization, irreversible |
| instructions/initialize_extra_account_meta_list.rs | 120+ | instruction | Create ExtraAccountMetaList for T22 hook resolution | initialization, hook |
| instructions/transfer_hook.rs | 150+ | instruction | Hook invocation (T22 callbacks), whitelist validation | hook, enforcement |
| tests/test_transfer_hook.rs | 150+ | test | Hook authorization and whitelist path tests | testing |

#### Key Files Analysis

**instructions/transfer_hook.rs**
- **Hook Invocation:** Called by Token-2022 during transfer_checked with discriminator validation
- **Account Indices (SPL spec):**
  - 0: source_token_account
  - 1: mint
  - 2: destination_token_account
  - 3: owner/authority
  - 4: extra_account_meta_list
  - 5: whitelist_source (resolved)
  - 6: whitelist_destination (resolved)
- **Validation:** At least one party (source OR destination) must be whitelisted
- **Defense-in-Depth:** Rejects zero-amount transfers, validates mint ownership (Token-2022)
- **Direct Invocation Prevention:** Detects and rejects direct hook invocation (not via transfer_checked)

**instructions/add_whitelist_entry.rs**
- **Access Control:** Authority signer must match WhitelistAuthority.authority
- **Burned Authority Check:** Returns error if authority has been burned (immutable whitelist)
- **PDA Creation:** WhitelistEntry PDA per address, seeds = [WHITELIST_ENTRY_SEED, address.as_ref()]

**instructions/burn_authority.rs**
- **Irreversible:** Sets WhitelistAuthority.authority = None
- **Idempotent:** Calling on already-burned authority succeeds silently (no error on double-burn)
- **Event:** Only emitted on first burn, not on idempotent calls

**Risks & Mitigations:**
- ✅ Whitelist burns are irreversible (prevents regrant of access)
- ✅ Hook validation ensures at least one whitelisted party
- ✅ SPL discriminator validation prevents interface spoofing
- ⚠️ Whitelist entries are immutable once burned (intentional per spec)

---

### Program: Staking

**Purpose:** PROFIT token staking with pro-rata SOL yield distribution using cumulative reward-per-token pattern.

**Risk Profile:** MEDIUM
**Key Concerns:** Reward calculation precision, first-depositor attack mitigation, flash-loan resistance.

| File | LOC | Type | Focus Areas | Risk Indicators |
|------|-----|------|-------------|-----------------|
| lib.rs | 108 | program | 6 instructions: init, stake, unstake, claim, deposit, update_cumulative | dispatch |
| constants.rs | 50+ | constant | MINIMUM_STAKE, yield distribution percentages | config |
| errors.rs | 25+ | error | Staking-specific errors | error def |
| events.rs | 40+ | event | Staked, Unstaked, Claimed, RewardsDeposited, CumulativeUpdated | instrumentation |
| state/mod.rs | 5 | lib | State module export | module |
| state/stake_pool.rs | 100+ | state | StakePool singleton (cumulative tracking) | singleton state |
| state/user_stake.rs | 80+ | state | UserStake per-user account (balance, checkpoint) | user state |
| helpers/mod.rs | 3 | lib | Helpers module export | module |
| helpers/math.rs | 100+ | helper | Reward calculation, precision handling | arithmetic |
| helpers/transfer.rs | 80+ | helper | PROFIT transfer (with T22 hook support) | transfer |
| instructions/mod.rs | 10 | lib | Instruction module export | module |
| instructions/initialize_stake_pool.rs | 100+ | instruction | Pool initialization with MINIMUM_STAKE dead stake | initialization, anti-attack |
| instructions/stake.rs | 120+ | instruction | Stake PROFIT, create UserStake on first stake | state update, CPI |
| instructions/unstake.rs | 130+ | instruction | Unstake + auto-claim, partial unstake logic | withdrawal, claim |
| instructions/claim.rs | 100+ | instruction | Claim pending SOL without unstaking | reward claim |
| instructions/deposit_rewards.rs | 80+ | instruction | Tax Program deposits yield (CPI-gated) | reward deposit |
| instructions/update_cumulative.rs | 100+ | instruction | Epoch Program finalizes epoch rewards (CPI-gated) | reward finalization |

#### Key Files Analysis

**state/stake_pool.rs**
- **Cumulative Reward Tracking:** rewards_per_token_stored (cumulative across all epochs)
- **Precision:** Uses u128 internally to avoid overflow in reward calculations
- **Dead Stake:** MINIMUM_STAKE (1 PROFIT) locked to prevent first-depositor exploit
- **Escrow Vault:** Holds all pending SOL rewards before user claims

**instructions/stake.rs**
- **Update Checkpoint:** Before balance change, calculates pending rewards based on old balance
- **UserStake Creation:** Created on first stake if not exists
- **Flash-Loan Resistance:** Same-epoch stake/unstake = zero rewards (checkpoint prevents gain)

**instructions/deposit_rewards.rs**
- **CPI-Gated:** Requires tax_authority PDA signed by Tax Program (seeds::program constraint)
- **Increments pending_rewards:** SOL already transferred by Tax Program in same TX
- **No Claim Trigger:** Only tracks amount; claim is separate instruction

**instructions/update_cumulative.rs**
- **CPI-Gated:** Requires epoch_authority PDA signed by Epoch Program
- **Reward Distribution:** pending_rewards → rewards_per_token_stored (finalized for epoch)
- **Idempotency Check:** Prevents double-finalization via epoch number tracking

**Risks & Mitigations:**
- ✅ First-depositor attack prevented by MINIMUM_STAKE dead stake
- ✅ Flash-loan resistant via checkpoint-based claim system
- ✅ Precision maintained via u128 intermediate calculations
- ⚠️ Partial unstake logic: if remainder < MINIMUM_STAKE, does full unstake (may surprise users)

---

### Program: Stub Staking

**Purpose:** Minimal staking interface for devnet testing of Epoch Program CPI integration.

**Risk Profile:** LOW
**Key Concerns:** Test harness only; remove before mainnet.

| File | LOC | Type | Focus Areas | Risk Indicators |
|------|-----|------|-------------|-----------------|
| lib.rs | 202 | program | 2 instructions: initialize, update_cumulative | test harness |
| errors.rs | 10+ | error | Stub-specific errors | error def |
| state.rs | 60+ | state | StubStakePool struct | stub state |

#### Key Files Analysis

**instructions/update_cumulative.rs**
- **CPI-Gated:** Requires staking_authority PDA signed by Epoch Program
- **Tracking Only:** Increments cumulative_epochs, last_epoch, total_yield_distributed (stub values)
- **Zero Implementation:** No actual reward calculation or distribution

**Risks & Mitigations:**
- ✅ Test-only program; no production impact
- ⚠️ MUST BE REMOVED before mainnet deployment

---

## Cross-Program Dependencies

### CPI Call Graph

```
User Transactions:
  ├─ AMM::initialize_pool (admin-gated)
  │   └─ Token-2022::initialize_mint (mint owner calls)
  ├─ AMM::swap_sol_pool (tax-routed)
  │   └─ (requires swap_authority signed by Tax Program)
  ├─ AMM::swap_profit_pool (tax-routed)
  │   └─ (requires swap_authority signed by Tax Program)
  │
  ├─ Tax::swap_sol_buy
  │   ├─ AMM::swap_sol_pool (via swap_authority PDA)
  │   ├─ Staking::deposit_rewards (distribution)
  │   └─ [Carnage SOL vault direct transfer]
  │
  ├─ Tax::swap_sol_sell
  │   ├─ Token-2022::transfer_checked (collect tax)
  │   ├─ AMM::swap_sol_pool (via swap_authority PDA)
  │   └─ [distributions same as buy]
  │
  ├─ Tax::swap_profit_buy
  │   └─ AMM::swap_profit_pool (via swap_authority PDA)
  │       └─ Token-2022::transfer_checked (dual-hook)
  │           └─ Transfer-Hook::transfer_hook (whitelist validation)
  │
  ├─ Tax::swap_exempt (Carnage)
  │   └─ AMM::swap_sol_pool (via swap_authority PDA)
  │       └─ Token-2022::transfer_checked
  │           └─ Transfer-Hook::transfer_hook
  │
  ├─ Transfer-Hook::initialize_authority (deployer)
  ├─ Transfer-Hook::add_whitelist_entry (authority-gated)
  ├─ Transfer-Hook::burn_authority (authority self-destructs)
  │
  ├─ Staking::stake / unstake / claim
  │   └─ Token-2022::transfer_checked
  │       └─ Transfer-Hook::transfer_hook
  │
  ├─ Epoch::trigger_epoch_transition
  │   └─ [Carnage SOL vault bounty payment (invoke_signed)]
  │
  ├─ Epoch::consume_randomness
  │   ├─ [Tax rate derivation from VRF]
  │   └─ Staking::update_cumulative (stub-staking on devnet)
  │
  └─ Epoch::execute_carnage_atomic (PRIMARY CARNAGE PATH — CRITICAL DEPTH)
      └─ Tax::swap_exempt (depth 1)
          └─ AMM::swap_sol_pool (depth 2)
              └─ Token-2022::transfer_checked (depth 3)
                  └─ Transfer-Hook::transfer_hook (depth 4 — SOLANA LIMIT)
```

### PDA Cross-Validation

**Critical Seeds That Must Match:**

| PDA | Program | Seed | Usage | Validation |
|-----|---------|------|-------|-----------|
| swap_authority | Tax | `b"swap_authority"` | AMM CPI signer | seeds::program = TAX_PROGRAM_ID (AMM) |
| swap_authority | Tax | `b"swap_authority"` | AMM CPI signer | None (constant in Tax) |
| carnage_signer | Epoch | `b"carnage_signer"` | Tax CPI signer | seeds::program = epoch_program_id() (Tax) |
| staking_authority | Epoch | `b"staking_authority"` | Staking CPI signer | seeds::program = epoch_program_id() (Stub-Staking) |
| stake_pool | Staking | `b"stake_pool"` | Singleton state | None (internal) |

**⚠️ VALIDATION FAILURES:**
- Mismatch in TAX_PROGRAM_ID constant (AMM) vs actual Tax program ID: All swaps blocked
- Mismatch in EPOCH_PROGRAM_ID constant (Tax) vs actual Epoch program ID: Carnage disabled
- Mismatch in EPOCH_PROGRAM_ID constant (Stub-Staking) vs actual Epoch program ID: Epoch finalization blocked

---

## Security Checkpoints

### Access Control

| Instruction | Access Model | Validation |
|-------------|--------------|-----------|
| AMM::initialize_admin | Upgrade authority | ProgramData constraint on upgrade_authority |
| AMM::burn_admin | Current admin | has_one = admin constraint |
| AMM::initialize_pool | Admin gatekeeper | has_one = admin constraint on AdminConfig |
| AMM::swap_sol_pool | Tax Program only | Signer constraint + seeds::program = TAX_PROGRAM_ID |
| AMM::swap_profit_pool | Tax Program only | Signer constraint + seeds::program = TAX_PROGRAM_ID |
| Tax::swap_exempt | Epoch Program only | seeds::program = epoch_program_id() on carnage_authority |
| Transfer-Hook::add_whitelist_entry | Authority-gated | has_one = authority constraint |
| Transfer-Hook::burn_authority | Authority self-destruct | Authority signer required |
| Staking::deposit_rewards | Tax Program only | seeds::program = TAX_PROGRAM_ID |
| Staking::update_cumulative | Epoch Program only | seeds::program = epoch_program_id() |
| Epoch::consume_randomness | Permissionless | Anti-reroll via pending_randomness_account binding |
| Epoch::execute_carnage_atomic | Permissionless (when pending) | Requires carnage_pending = true |

### Arithmetic Safety

| Component | Pattern | Risk |
|-----------|---------|------|
| Swap math (AMM) | Option<T> returns | Maps to error, never panics ✅ |
| Fee calculation (AMM) | checked_mul, checked_div | Overflow → None → AmmError::Overflow ✅ |
| k-invariant (AMM) | u128 intermediate | Prevents overflow for u64 reserves ✅ |
| Tax distribution (Tax) | Percentage-based split | Truncation loss to treasury (intentional) ✅ |
| Reward calculation (Staking) | u128 for precision | Precision maintained through u64 conversion ✅ |
| Epoch calculation (Epoch) | saturating_sub | Handles slot < genesis correctly ✅ |

### State Mutation (CEI Pattern)

| Instruction | Checks | Effects | Interactions | Compliance |
|-------------|--------|---------|--------------|-----------|
| swap_sol_pool | Input validation, fee deduction, output calc, slippage, k-verify | Reserve updates, locked flag set | Token transfers (after effects) | Strict CEI ✅ |
| swap_profit_pool | Direction binding, effective input, slippage, k-verify | Reserve updates, locked flag | Token transfers (after effects) | Strict CEI ✅ |
| deposit_rewards | Amount validation | pending_rewards increment | (none; SOL pre-transferred) | ✅ |
| stake | Amount > 0 | Balance update, checkpoint calc | Token transfer | CEI ✅ |
| execute_carnage_atomic | Holdings check, action logic | Holdings update, statistics | Tax CPI, token transfers | ✅ |

### Token Transfer Safety

| Transfer Type | Method | Hook Handling | Safety |
|---------------|--------|---------------|--------|
| AMM → User (T22) | transfer_t22_checked | remaining_accounts forwarded | ✅ Manual invoke_signed |
| User → AMM (T22) | transfer_t22_checked | remaining_accounts forwarded | ✅ Manual invoke_signed |
| User → Vault (SPL) | transfer_spl via CPI | No hooks | ✅ Anchor CPI |
| Staking (T22) | transfer_checked via manual CPI | remaining_accounts forwarded | ✅ |
| Tax distribution (SOL) | system_instruction::transfer | No hooks (native) | ✅ invoke_signed |

---

## Known Issues & TODO Items

*(From MEMORY.md and codebase analysis)*

### CRITICAL (Mainnet Blocking)

1. **Carnage Bounty Rent-Exempt Bug** (MEMORY.md TODO)
   - **Location:** epoch-program/src/instructions/trigger_epoch_transition.rs, line 195-227
   - **Issue:** Checks `vault_balance >= TRIGGER_BOUNTY_LAMPORTS` but doesn't account for rent-exempt minimum (~890,880 lamports on Solana)
   - **Impact:** After bounty transfer, vault can drop below rent floor, causing runtime rejection on next transfer
   - **Fix:** Check `vault_balance >= bounty + rent_exempt_minimum` (where rent = ~890,880 lamports)
   - **Status:** NOT YET FIXED

### HIGH (Mainnet Before Release)

2. **Remove Devnet-Only force_carnage Instruction**
   - **Location:** epoch-program/src/lib.rs, line 261-264
   - **Issue:** Test helper instruction must not exist on mainnet
   - **Fix:** Delete instruction entirely; move test logic to integration test suite
   - **Status:** REQUIRES MANUAL REMOVAL

3. **Pool State Byte Offset Assumptions**
   - **Locations:** tax-program/src/instructions/swap_profit_buy.rs (line 217-220), swap_profit_sell.rs (line 209-212)
   - **Issue:** Reads lp_fee_bps from hardcoded bytes [153..155]; brittle if PoolState layout changes
   - **Mitigation:** Add #[doc(hidden)] compile-time assertion or migration utility
   - **Status:** ARCHITECTURAL DEBT (low immediate risk due to sealed PoolState)

### MEDIUM (Code Quality)

4. **Devnet-Only Mint Addresses in Constants**
   - **Status:** Phase 52 devnet deployment; update to mainnet mints before release
   - **Files:** tax-program/src/constants.rs, epoch-program/src/constants.rs
   - **Action:** Mainnet checklist (Docs/mainnet-checklist.md) tracks this

5. **ALT (Address Lookup Table) Dependency**
   - **Status:** Sell path uses v0 VersionedTransaction with ALT (client-side only)
   - **Risk:** LOW — no on-chain impact, purely client-side optimization
   - **Docs:** scripts/deploy/alt-address.json caches protocol-wide ALT

---

## Recommendations for Audit

### Phase 1: Automated Analysis

1. **Arithmetic Verification**
   - [ ] Run Cargo audit for dependency vulnerabilities
   - [ ] Verify all arithmetic uses checked_* operations (grep for unchecked ops)
   - [ ] Test proptest suites (helpers/math.rs 10,000 iterations)

2. **CPI Validation**
   - [ ] Trace all CPI chains for depth violations (execute_carnage_atomic at limit)
   - [ ] Verify all seeds::program constraints match actual program IDs
   - [ ] Check that all CPI instruction data matches discriminator constants

3. **Access Control**
   - [ ] Verify all admin-gated instructions have proper signer validation
   - [ ] Check that all cross-program PDAs use seeds::program constraints
   - [ ] Validate has_one = field constraints are correctly applied

### Phase 2: Manual Security Review

1. **Token Safety**
   - [ ] Verify T22 transfer hooks are called with correct remaining_accounts
   - [ ] Check that whitelist validation covers all transfer paths
   - [ ] Confirm WSOL intermediary account is properly managed

2. **State Machine**
   - [ ] Walk through full VRF flow (trigger → consume → retry timeout)
   - [ ] Verify epoch boundary detection is robust (slot edge cases)
   - [ ] Check anti-reroll protection cannot be bypassed

3. **Economic Security**
   - [ ] Verify tax distribution splits are correct (75/24/1)
   - [ ] Check carnage swap cap enforcement (MAX_CARNAGE_SWAP_LAMPORTS = 1000 SOL)
   - [ ] Validate minimum output floor cannot be undercut (SEC-10)

### Phase 3: Integration Testing

1. **Happy Path**
   - [ ] End-to-end buy/sell/swap through all pools
   - [ ] Epoch transition with VRF reveal
   - [ ] Carnage execution (all 3 action types: BuyOnly, Burn, Sell)

2. **Error Cases**
   - [ ] Slippage exceeded on all swap types
   - [ ] Zero-amount transfers rejected
   - [ ] Duplicate pool initialization blocked
   - [ ] VRF timeout recovery works

3. **Edge Cases**
   - [ ] Dust amounts (below fee threshold)
   - [ ] Large amounts (near u64::MAX)
   - [ ] Mint ordering reversals (canonical ordering detection)
   - [ ] Empty whitelist (no whitelisted parties)

---

## File Statistics Summary

| Category | Count | LOC |
|----------|-------|-----|
| Instructions | 34 | ~3,500 |
| State/Helpers | 25 | ~2,000 |
| Errors | 6 | ~200 |
| Events | 6 | ~300 |
| Constants | 6 | ~300 |
| Tests | 12 | ~1,500 |
| Library/Module Exports | 12 | ~100 |
| **TOTAL** | **101** | **~7,900** |

*(Approximate; excludes test-only code in inline #[cfg(test)] blocks)*

---

## Conclusion

Dr Fraudsworth demonstrates professional-grade security practices with strict CEI compliance, comprehensive error handling, and robust CPI validation. The codebase is well-documented with inline security notes (Source: spec comments throughout).

**Primary Risks:**
1. **CPI Depth Limit:** execute_carnage_atomic at Solana 4-level limit; no room for additional features on this path
2. **Bounty Bug:** Rent-exempt minimum not accounted for in trigger_epoch_transition (CRITICAL)
3. **Byte Offset Assumptions:** Pool state reading at hardcoded offsets is fragile

**Recommended Actions Before Mainnet:**
1. Fix carnage bounty rent-exempt minimum check
2. Remove force_carnage devnet-only instruction
3. Add compile-time assertions for PoolState byte offset assumptions
4. Update mint addresses from devnet to mainnet in constants
5. Run full integration test suite through all swap paths and VRF cycles

