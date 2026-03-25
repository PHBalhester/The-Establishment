---
doc_id: security-model
title: "Dr. Fraudsworth's Finance Factory — Security Model"
wave: 3
requires: [architecture, cpi-interface-contract]
provides: [security-model]
status: draft
decisions_referenced: [security, cpi-architecture, amm-design, architecture, token-model]
needs_verification: [carnage-fallback-front-running-frequency]
---

# Security Model

## Threat Model Overview

Dr. Fraudsworth's Finance Factory is a 7-program Solana DeFi protocol with an asymmetric tax AMM, VRF-driven Carnage buyback-and-burn, PROFIT staking for real SOL game rewards, and a dual bonding curve launch system. The security model is designed around a single, overarching principle: **post-burn immutability**. After the tiered timelock period (2hr -> 24hr -> burn), the protocol has zero admin keys, zero pause mechanisms, and zero governance -- it runs autonomously until Solana itself stops.

This threat model addresses five attack surfaces in order of severity:

1. **Economic attacks** -- sandwich, front-running, arbitrage gaming, reward manipulation
2. **CPI and program-level attacks** -- reentrancy, forgery, account substitution
3. **Transfer Hook bypass** -- circumventing the whitelist to enable unauthorized transfers
4. **VRF manipulation** -- rerolling randomness or predicting Carnage outcomes
5. **Operational failures** -- crank liveness, oracle downtime, key compromise

The protocol manages **three tokens** (CRIME, FRAUD, PROFIT) on Token-2022 with transfer hooks, plus WSOL on SPL Token, across **two permanent SOL liquidity pools (CRIME/SOL, FRAUD/SOL) plus a fixed-rate conversion vault** with no LP tokens and no withdrawal mechanism.

## Actors

| Actor | Trust Level | On-Chain Role | Capabilities |
|-------|-------------|---------------|--------------|
| **Users** | Untrusted | Swap CRIME/FRAUD via Tax Program, stake PROFIT | Can only interact through Tax entry points. Cannot call AMM directly (PDA-gated). Can set slippage params. |
| **Deployer** | Trusted (pre-burn only) | Initialize pools, whitelist addresses, set admin | Holds upgrade authority during tiered timelock. Powers burned permanently after stabilization. |
| **Crank Bot** | Untrusted (permissionless) | Trigger epoch transitions, reveal VRF, execute Carnage | Any wallet can perform these operations. No privileged access. Incentivized by 0.001 SOL bounty per epoch trigger. |
| **Arb Bots** | Untrusted (by-design) | Arbitrage between pools, external DEXes | Desired behavior -- keeps prices aligned. 18% round-trip tax makes MEV unprofitable for most sandwich strategies. |
| **Attackers** | Adversarial | Exploit program bugs, manipulate prices, steal funds | Full spectrum: economic manipulation, fake CPIs, account substitution, VRF gaming, oracle manipulation. |

## Access Control Model

### On-Chain (PDA-Gated)

The protocol enforces access control through four cross-program PDA gates. Each gate uses Anchor's `seeds::program` constraint, which cryptographically verifies that the signing PDA was derived from the expected program ID. No keypair can produce a valid PDA signature for another program's seeds.

| PDA Gate | Seeds | Derived From | Validated By | Purpose | Code Reference |
|----------|-------|-------------|-------------|---------|----------------|
| SwapAuthority | `["swap_authority"]` | Tax Program | AMM (`swap_sol_pool.rs:367-371`) | Only Tax Program can invoke AMM swap instructions | `programs/amm/src/instructions/swap_sol_pool.rs` |
| TaxAuthority | `["tax_authority"]` | Tax Program | Staking (`deposit_rewards`) | Only Tax Program can deposit staking rewards | `programs/staking/src/constants.rs` |
| StakingAuthority | `["staking_authority"]` | Epoch Program | Staking (`update_cumulative`) | Only Epoch Program can finalize epoch rewards | `programs/epoch-program/src/constants.rs` |
| CarnageSigner | `["carnage_signer"]` | Epoch Program | Tax Program (`swap_exempt.rs:193-198`) | Only Epoch Program can invoke tax-exempt swaps | `programs/tax-program/src/instructions/swap_exempt.rs` |

**Evidence these gates work (test references):**

- SEC-03: `tests/security.ts` -- `rejects deposit_rewards from unauthorized keypair` (ConstraintSeeds error)
- SEC-04: `tests/security.ts` -- `rejects update_cumulative from unauthorized keypair` (ConstraintSeeds error)
- CPI Interface: `tests/cross-program-integration.ts` -- `derives expected Tax Program authority PDA`, `derives expected Epoch Program authority PDA`

### Current Authority State (Mainnet, as of 2026-03-25)

All program upgrade authorities and admin PDA authorities have been transferred to the Squads 2-of-3 multisig vault (`4SMcPtixKvjgj3U5N7C4kcnHYcySudLZfFWc523NAvXJ`) with a 3600-second (1-hour) timelock. Mint authorities for all 3 tokens are permanently burned.

| Authority | Current State |
|-----------|--------------|
| 6 Upgrade Authorities | Held by Squads vault (timelocked) |
| Whitelist Authority | Transferred to Squads vault (retained for future flexibility) |
| AMM Admin | Transferred to Squads vault (retained for future plans) |
| BC Admin | N/A (Bonding Curve program closed post-graduation) |
| CRIME Mint Authority | Burned (irreversible) |
| FRAUD Mint Authority | Burned (irreversible) |
| PROFIT Mint Authority | Burned (irreversible) |

Authorities will be burned progressively as the protocol proves stable. See `Docs/mainnet-governance.md` for the complete governance and burn protocol.

### Admin Authority Lifecycle (On-Chain Capabilities)

Three admin keys exist at deployment, all with explicit burn instructions:

| Authority | Program | Burn Instruction | Post-Burn State | Code Reference |
|-----------|---------|-----------------|-----------------|----------------|
| AMM Admin | AMM | `burn_admin` | `admin_config.admin = Pubkey::default()` -- `has_one = admin` constraint always fails | `programs/amm/src/instructions/burn_admin.rs` |
| Whitelist Authority | Transfer Hook | `burn_authority` | `whitelist_authority.authority = None` -- `authority.is_some()` constraint rejects all whitelist modifications | `programs/transfer-hook/src/instructions/burn_authority.rs` |
| BC Admin | Bonding Curve | `burn_bc_admin` | `bc_admin_config.authority = Pubkey::default()` -- admin operations permanently disabled | `programs/bonding_curve/src/instructions/burn_bc_admin.rs` |

**Burn properties:**
- AMM `burn_admin`: Sets admin to `Pubkey::default()`. Since no one can sign as the all-zeros pubkey, `initialize_pool`'s `has_one = admin` constraint permanently fails. Irreversible. Emits `AdminBurned` event.
- Hook `burn_authority`: Sets authority to `None`. Idempotent (calling again succeeds silently). The `constraint = whitelist_authority.authority.is_some()` on `add_whitelist_entry` and `initialize_extra_account_meta_list` makes the whitelist permanently frozen.
- BC `burn_bc_admin` (Phase 78): Sets authority to `Pubkey::default()`. All bonding curve admin instructions (`initialize_curve`, `fund_curve`, `start_curve`, etc.) become permanently disabled. The `BcAdminConfig` PDA validates admin identity with ProgramData upgrade authority check at initialization.

### Phase 78-80 Hardening Summary

**Phase 78 (AUTH-01/AUTH-02) -- Authority Hardening:**
- BcAdminConfig PDA replaces raw upgrade-authority checks in bonding curve
- All 7 programs have upgrade authorities tracked in authority map (10 entries: 7 upgrade + 3 admin PDAs)
- Upgrade authorities never burned (preserved for timelocked bug fixes)
- Admin PDAs burned individually when function no longer needed

**Phase 79 (FIN-01 through FIN-05) -- Financial Safety Guards:**
- Staking claim: hard error on insufficient escrow balance (no partial claims)
- Epoch bounty: skip silently when vault insufficient (transition still advances)
- Tax sell floor: derived from user minimum_output only (no double-layer)
- Pre-transfer vault solvency check in sell.rs
- Partner_mint validation prevents cross-curve attacks in bonding curve refunds

**Phase 80 (DEF-01 through DEF-08) -- Defense-in-Depth:**
- EpochState reserved padding (64 bytes) for future schema evolution
- `#[repr(C)]` on cross-program mirrored structs for layout stability
- Compile-time DATA_LEN assertions (== 164) in both epoch-program and tax-program mirror
- Bonding curve remaining_accounts count validated as exactly 4 (Transfer Hook CPI)
- Pool reader uses function-based `native_mint()` instead of const pubkey! macro

**Devnet-only admin (`force_carnage`):**
- `programs/epoch-program/src/instructions/force_carnage.rs` -- hardcodes `DEVNET_ADMIN = 8kPzh...` and is gated by `#[cfg(feature = "devnet")]`
- **MUST be absent from mainnet build.** Mainnet build omits `--features devnet`. This is tracked in `Docs/mainnet-checklist.md`.

## Attack Surface Analysis

### Economic Attacks

#### ATK-E1: Sandwich Attack on User Swaps

**Vector:** MEV bot detects user swap TX in mempool, front-runs with a large buy (inflating price), lets user buy at inflated price, then back-runs by selling.

**Defenses (dual-layer slippage):**

1. **User-level slippage** (`minimum_amount_out` parameter): User specifies minimum acceptable output. AMM enforces `amount_out >= minimum_amount_out` (`swap_sol_pool.rs:145-148`).

2. **Protocol-level 50% floor** (`MINIMUM_OUTPUT_FLOOR_BPS = 5000`): Tax Program calculates expected constant-product output from current pool reserves, then enforces `minimum_amount_out >= expected * 50%`. Applied in `swap_sol_buy.rs:106`, `swap_sol_sell.rs:113`. Uses `calculate_output_floor()` from `programs/tax-program/src/helpers/tax_math.rs:135-159`.

3. **18% round-trip tax**: A sandwich attacker buying then selling the same token incurs ~4% buy tax + ~14% sell tax = ~18% round-trip cost. The attacker must extract more than 18% of the victim's swap value to profit, which requires extreme price impact -- economically infeasible for typical trade sizes.

**Code references:**
- `programs/tax-program/src/constants.rs:40` -- `MINIMUM_OUTPUT_FLOOR_BPS = 5000`
- `programs/tax-program/src/helpers/tax_math.rs:135-159` -- `calculate_output_floor()`
- `programs/tax-program/src/helpers/pool_reader.rs:39-58` -- `read_pool_reserves()` (raw byte reader, no AMM crate dependency)
- Unit tests: `tax_math.rs` Part D (8 tests) + Part E proptests (6 properties x 10K iterations)

#### ATK-E2: Carnage Front-Running (Atomic Path)

**Vector:** Attacker observes Carnage trigger in `consume_randomness`, front-runs by buying the target token, then sells after Carnage buys (profiting from price impact).

**Defenses:**

1. **Atomic bundling** (zero front-running window): `execute_carnage_atomic` is bundled in the same transaction as `consume_randomness`. The target token is unknown until VRF bytes are revealed. Since Solana transactions are atomic, there is no window between VRF reveal and Carnage execution.

2. **50-slot lock window** (`CARNAGE_LOCK_SLOTS = 50`): During the first 50 slots (~20 seconds) after Carnage triggers, only the atomic path can execute. Fallback `execute_carnage` is rejected with `CarnageLockActive` error (`execute_carnage.rs:223-226`).

3. **85% slippage floor** (atomic path): `CARNAGE_SLIPPAGE_BPS_ATOMIC = 8500`. If actual output < 85% of expected constant-product output, Carnage reverts with `CarnageSlippageExceeded`. Calculated from pre-swap reserves (`execute_carnage_atomic.rs:422-438`).

**Code references:**
- `programs/epoch-program/src/constants.rs:138` -- `CARNAGE_LOCK_SLOTS = 50`
- `programs/epoch-program/src/constants.rs:127` -- `CARNAGE_SLIPPAGE_BPS_ATOMIC = 8500`
- `programs/epoch-program/src/instructions/execute_carnage.rs:223-226` -- Lock window enforcement
- Tests: `execute_carnage_atomic.rs` unit tests (`test_slippage_floor_rejects_low_output`, `test_slippage_floor_handles_large_values`)

#### ATK-E3: Carnage Front-Running (Fallback Path)

**Vector:** If atomic execution fails (e.g., compute budget exceeded), the fallback path opens after 50 slots. Attacker front-runs the fallback.

**Defense:**

1. **75% slippage floor** (`CARNAGE_SLIPPAGE_BPS_FALLBACK = 7500`): More lenient than atomic (85%) to prioritize execution over optimal price in recovery mode.

2. **300-slot deadline** (`CARNAGE_DEADLINE_SLOTS = 300`): After 300 slots (~2 minutes), Carnage expires. SOL is retained in vault for next trigger.

3. **Unpredictable timing**: Fallback window is 250 slots (slots 50-300 after trigger). The crank bot submits at an unpredictable time within this window.

<!-- NEEDS_VERIFICATION: carnage-fallback-front-running-frequency -- What percentage of Carnage events actually fall back to the fallback path? If it's extremely rare (as designed), this attack surface may be negligible. -->

**Code references:**
- `programs/epoch-program/src/constants.rs:132` -- `CARNAGE_SLIPPAGE_BPS_FALLBACK = 7500`
- `programs/epoch-program/src/constants.rs:75` -- `CARNAGE_DEADLINE_SLOTS = 300`
- `programs/epoch-program/src/instructions/execute_carnage.rs:214-226` -- Deadline and lock checks
- Tests: `execute_carnage.rs` unit tests (`test_fallback_slippage_floor`, `test_fallback_more_lenient_than_atomic`, `test_lock_window_check_logic`)

#### ATK-E4: First-Depositor Inflation Attack (Staking)

**Vector:** Attacker stakes 1 lamport as the first depositor, capturing near-100% of subsequent rewards due to trivial denominator in reward math.

**Defense:** Protocol stakes 1 PROFIT (1,000,000 units = `MINIMUM_STAKE`) as irrecoverable "dead stake" during `initialize_stake_pool`. No `UserStake` PDA is created for this dead stake, making it permanently unclaimable.

**Evidence:**
- `tests/security.ts` -- `pool starts with MINIMUM_STAKE dead stake` (pool total_staked >= MINIMUM_STAKE after init)
- `tests/security.ts` -- `attacker with 1 unit cannot capture majority of rewards` (attacker share < 0.0001%)
- `tests/security.ts` -- `dead stake is irrecoverable (no UserStake PDA for dead stake)` (neither admin nor stakePool PDA have a UserStake account)

#### ATK-E5: Flash Loan Same-Epoch Exploitation (Staking)

**Vector:** Attacker flash-loans PROFIT, stakes before epoch end, claims rewards after `update_cumulative`, unstakes and repays -- all within one epoch.

**Defense:** Checkpoint pattern. On stake, `user.rewards_per_token_paid = pool.rewards_per_token_stored`. User only earns from FUTURE cumulative increases. `update_cumulative` is CPI-gated to Epoch Program (ATK-E5 requires bypassing SEC-04, which is cryptographically impossible).

**Evidence:**
- `tests/security.ts` -- `same-epoch stake/unstake earns exactly 0 rewards`
- `tests/security.ts` -- `stake captures current cumulative as checkpoint`
- `math.rs` -- `reward_calculation_zero_delta` (zero delta -> zero rewards)
- `math.rs` -- `late_staker_scenario` (delta == 0 when checkpoint captures current cumulative)

#### ATK-E6: Reward Solvency Drain

**Vector:** Bug in reward accounting causes escrow underfunding. Users claim but escrow lacks SOL.

**Defense:** `assertEscrowSolvency()` checked after every state-modifying operation. CEI pattern ensures state updates occur before SOL transfers. Escrow is funded via `SystemProgram.transfer` before `deposit_rewards` updates pending state.

**Evidence:**
- `tests/security.ts` -- `solvency holds after 100+ stake/unstake operations (single user)` (50 cycles x 2 ops)
- `tests/security.ts` -- `solvency holds after multi-user concurrent operations (5 users)` (5 stakers, 20+ interleaved operations)
- `tests/security.ts` -- `solvency holds with escrow funding simulation`
- Property test: `math.rs` -- `reward_conservation` (10,000 random inputs: user_reward <= pending always)

#### ATK-E7: Pool Draining via Extreme-Ratio Swaps

**Vector:** Attacker executes a series of large swaps in one direction, pushing the pool to an extreme ratio and draining one side of reserves to near-zero.

**Defenses (four layers):**

1. **Constant-product invariant** (`verify_k_invariant`): After every swap, the AMM verifies `k_after >= k_before` where `k = reserve_in * reserve_out`. The constant-product formula `output = reserve_out * input / (reserve_in + input)` mathematically guarantees that `output < reserve_out` for any finite input -- it is impossible to drain an entire side in a single swap. Each successive swap yields diminishing returns as reserves become more imbalanced. (`programs/amm/src/helpers/math.rs:92-103`, `swap_sol_pool.rs:170-173`)

2. **Zero-output rejection**: `check_swap_output_nonzero()` rejects any swap where a non-zero effective input produces zero output (`swap_sol_pool.rs:139-142`). This prevents dust-amount grinding attacks at extreme ratios.

3. **Protocol-level 50% slippage floor** (`MINIMUM_OUTPUT_FLOOR_BPS = 5000`): Tax Program calculates expected output from current reserves and rejects any swap where `minimum_amount_out < expected * 50%` (`tax_math.rs:135-159`). An attacker pushing the pool to extreme ratios would see each successive swap fail as actual output diverges from expected.

4. **Reentrancy guard** (`PoolState.locked`): Set at swap entry (`swap_sol_pool.rs:84`), validated before entry (`swap_sol_pool.rs:381`), cleared post-transfer (`swap_sol_pool.rs:322`). Prevents any attempt to re-enter the swap within a single transaction. (SOL pools only -- Conversion Vault has no reentrancy surface as it is a leaf node.)

**Code references:**
- `programs/amm/src/helpers/math.rs:92-103` -- `verify_k_invariant()` (u128 arithmetic, returns `Some(false)` if k decreases)
- `programs/amm/src/helpers/math.rs:58-76` -- `calculate_swap_output()` (output always < reserve_out)
- `programs/tax-program/src/constants.rs:40` -- `MINIMUM_OUTPUT_FLOOR_BPS = 5000`
- Proptest: `math.rs` Property 2 -- `output_never_exceeds_reserve_out` (10,000 iterations)
- Decision: DECISIONS/error-handling.md D7

#### ATK-E8: Concurrent Carnage and User Swap

**Vector:** Carnage execution and a user swap land in the same slot, both modifying the same pool reserves. Race condition could cause inconsistent state or amplified price impact.

**Defenses:**

1. **Solana runtime serialization**: Transactions touching the same writable accounts within a slot are automatically serialized by the Solana runtime. Both Carnage and user swaps write to pool state, vault accounts, and reserve fields -- they share writable account sets. The runtime ensures they execute sequentially, not concurrently.

2. **AMM reentrancy guard** (`PoolState.locked`): Belt-and-suspenders protection. Even if runtime serialization were somehow bypassed, the `locked` field prevents any second entry to a pool mid-swap (`swap_sol_pool.rs:381`).

3. **Independent slippage floors**: User swaps have a 50% protocol floor (`MINIMUM_OUTPUT_FLOOR_BPS`). Carnage fallback has a 75% floor (`CARNAGE_SLIPPAGE_BPS_FALLBACK`), atomic has 85% (`CARNAGE_SLIPPAGE_BPS_ATOMIC`). If the first-executed transaction moves price significantly, the second transaction's slippage check rejects it.

**Code references:**
- `programs/amm/src/state/pool.rs:69` -- `pub locked: bool`
- `programs/amm/src/instructions/swap_sol_pool.rs:84,322,381` -- Lock/unlock/check cycle
- Decision: DECISIONS/error-handling.md D5

### CPI & Program Attacks

#### ATK-C1: CPI Forgery -- deposit_rewards

**Vector:** Attacker deploys fake program, derives PDA with same `TAX_AUTHORITY_SEED`, CPIs to `deposit_rewards` with inflated amount to inject phantom rewards.

**Defense:** `seeds::program = tax_program_id()` constraint on the TaxAuthority PDA in Staking. Only the real Tax Program's PDA passes validation.

**Evidence:**
- `tests/security.ts` -- `rejects deposit_rewards from unauthorized keypair` (ConstraintSeeds error; pendingRewards remains 0)
- `tests/cross-program-integration.ts` -- `rejects deposit_rewards from unauthorized caller`

#### ATK-C2: CPI Forgery -- update_cumulative

**Vector:** Attacker deploys fake program, derives PDA with same `STAKING_AUTHORITY_SEED`, CPIs to `update_cumulative` to trigger early reward finalization.

**Defense:** `seeds::program = epoch_program_id()` constraint. Only the real Epoch Program's PDA passes.

**Evidence:**
- `tests/security.ts` -- `rejects update_cumulative from unauthorized keypair` (ConstraintSeeds error; rewardsPerTokenStored remains "0")

#### ATK-C3: CPI Forgery -- swap_exempt

**Vector:** Attacker calls Tax Program's `swap_exempt` to perform tax-free swaps, draining pool value.

**Defense:** `seeds::program = epoch_program_id()` on `carnage_authority` in `SwapExempt` struct (`swap_exempt.rs:193-197`). Only the Epoch Program's CarnageSigner PDA is accepted.

**Code reference:** `programs/tax-program/src/instructions/swap_exempt.rs:193-198`

#### ATK-C4: Direct AMM Invocation (Bypassing Tax)

**Vector:** User calls `AMM::swap_sol_pool` directly, skipping tax deduction entirely.

**Defense:** AMM `swap_sol_pool` requires `swap_authority: Signer` with `seeds::program = TAX_PROGRAM_ID` constraint (`swap_sol_pool.rs:367-371`). Only the Tax Program can produce the SwapAuthority PDA signature. Direct user calls fail at deserialization.

**Code reference:** `programs/amm/src/instructions/swap_sol_pool.rs:367-371`

#### ATK-C5: Reentrancy via CPI Callback

**Vector:** Attacker exploits a CPI callback to re-enter a program and double-spend or manipulate state.

**Defenses (three layers):**

1. **Structural impossibility** (acyclic DAG): The CPI call graph is a directed acyclic graph. Transfer Hook makes zero outbound CPIs (terminal node). Token-2022 only calls Hook. AMM only calls Token-2022. Tax calls AMM. Epoch calls Tax. No downstream program ever CPIs back upstream. Reentrancy requires a cycle, which does not exist.

2. **AMM reentrancy guard** (defense-in-depth): `PoolState.locked` field (`pool.rs:69`). Set to `true` at swap entry (`swap_sol_pool.rs:84`), validated via `constraint = !pool.locked @ AmmError::PoolLocked` (`swap_sol_pool.rs:381`), cleared after transfers (`swap_sol_pool.rs:322`). Even if the DAG somehow allowed re-entry, the guard would reject it.

3. **CEI ordering**: All programs follow Checks-Effects-Interactions. State mutations (reserve updates, reward clearing) occur before CPI token transfers.

**Evidence:**
- Architecture DAG diagram (`Docs/architecture.md:150-183`)
- `pool.rs:69` -- `pub locked: bool`
- `swap_sol_pool.rs:84` -- `ctx.accounts.pool.locked = true`
- `swap_sol_pool.rs:381` -- `constraint = !pool.locked @ AmmError::PoolLocked`
- All solvency tests pass under stress (would fail if CEI were violated)

#### ATK-C6: Account Substitution (Vault/Mint/Program Mismatch)

**Vector:** Attacker passes wrong vault, mint, or token program to a swap instruction.

**Defenses (per-constraint):**
- Vault: `constraint = vault_a.key() == pool.vault_a @ AmmError::VaultMismatch` (`swap_sol_pool.rs:389`)
- Mint: `constraint = mint_a.key() == pool.mint_a @ AmmError::InvalidMint` (`swap_sol_pool.rs:401`)
- Token program: `constraint = token_program_a.key() == pool.token_program_a @ AmmError::InvalidTokenProgram` (`swap_sol_pool.rs:423`)
- Program IDs: `#[account(address = tax_program_id())]`, `#[account(address = amm_program_id())]` on all CPI targets

### Transfer Hook Bypass

#### ATK-H1: Direct Hook Invocation

**Vector:** Attacker calls `transfer_hook` instruction directly (not via Token-2022 `transfer_checked`), passing arbitrary accounts.

**Defense:** `check_is_transferring()` function (`transfer_hook.rs:140-153`). Reads the `TransferHookAccount` extension from the source token account data. The `transferring` flag is set by Token-2022 **only** during `transfer_checked` and cleared after the hook returns. Direct invocation finds `transferring = false` and returns `DirectInvocationNotAllowed`.

**Code reference:** `programs/transfer-hook/src/instructions/transfer_hook.rs:140-153`

#### ATK-H2: Non-Whitelisted Transfer (Wallet-to-Wallet)

**Vector:** User attempts direct wallet-to-wallet transfer of CRIME/FRAUD/PROFIT, bypassing AMM and avoiding tax.

**Defense:** Whitelist check with PDA verification (`transfer_hook.rs:96-109`). Transfer allowed only if source OR destination token account has a matching `WhitelistEntry` PDA. 14 protocol-controlled addresses are whitelisted (pool vaults, staking vault, Carnage vaults). User wallets are NOT whitelisted. Both source and destination fail the check -> `NoWhitelistedParty` error.

**Code reference:** `programs/transfer-hook/src/instructions/transfer_hook.rs:96-109`, `is_whitelisted()` at line 166-178

#### ATK-H3: Spoofed Whitelist PDA

**Vector:** Attacker creates a fake account at the expected whitelist PDA address to trick the hook into allowing unauthorized transfers.

**Defense:** `is_whitelisted()` verifies PDA derivation (`transfer_hook.rs:172-178`):
```rust
let (expected_pda, _bump) = Pubkey::find_program_address(
    &[WhitelistEntry::SEED_PREFIX, token_account.as_ref()],
    &crate::ID
);
whitelist_pda.key() == expected_pda
```
The PDA must be derivable from the Transfer Hook program's ID with the correct seeds. Only accounts created by the Transfer Hook program (via `add_whitelist_entry`) satisfy this check. Fake accounts at arbitrary addresses will have different keys.

#### ATK-H4: Using Plain `transfer` Instead of `transfer_checked`

**Vector:** Attacker uses SPL Token `transfer` (not `transfer_checked`) to bypass hook execution entirely.

**Defense:** All CRIME/FRAUD/PROFIT mints are Token-2022 with `TransferHook` extension. Token-2022's `transfer_checked` invokes the hook automatically. The protocol exclusively uses `transfer_checked` for all Token-2022 transfers (enforced by code review -- search for `transfer_checked` across all programs). Plain `transfer` on Token-2022 mints with TransferHook extension is rejected by the Token-2022 runtime itself.

**Code reference:** Architectural constraint documented in `Docs/architecture.md:626` -- "Token-2022 only via `transfer_checked`"

#### ATK-H5: Post-Burn Whitelist Modification

**Vector:** After protocol stabilization, attacker attempts to add their wallet to the whitelist.

**Defense:** `burn_authority` sets `whitelist_authority.authority = None`. The `add_whitelist_entry` instruction has `constraint = whitelist_authority.authority.is_some() @ TransferHookError::AuthorityAlreadyBurned` (`add_whitelist_entry.rs:52`). Similarly, `initialize_extra_account_meta_list` has the same constraint (`initialize_extra_account_meta_list.rs:133`). Both fail with `AuthorityAlreadyBurned` after burn.

**Code reference:**
- `programs/transfer-hook/src/instructions/burn_authority.rs:38` -- `auth.authority = None`
- `programs/transfer-hook/src/instructions/add_whitelist_entry.rs:52` -- `constraint = whitelist_authority.authority.is_some()`

### VRF Manipulation

#### ATK-V1: VRF Reroll (Randomness Account Substitution)

**Vector:** Attacker commits one randomness account via `trigger_epoch_transition`, observes the revealed result, then submits `consume_randomness` with a different randomness account that gives a more favorable outcome.

**Defense:** Anti-reroll binding. `trigger_epoch_transition` stores the randomness account key in `epoch_state.pending_randomness_account` (`trigger_epoch_transition.rs:186`). `consume_randomness` validates `ctx.accounts.randomness_account.key() == epoch_state.pending_randomness_account` (`consume_randomness.rs:155-157`). Mismatched accounts fail with `RandomnessAccountMismatch`.

**Code reference:**
- `programs/epoch-program/src/instructions/trigger_epoch_transition.rs:186` -- Binding
- `programs/epoch-program/src/instructions/consume_randomness.rs:153-157` -- Verification

#### ATK-V2: Stale Randomness (Pre-Generated)

**Vector:** Attacker pre-generates randomness accounts and submits one with known favorable bytes.

**Defense:** Freshness check. `trigger_epoch_transition` validates `seed_slot` is within 1 slot of current (`trigger_epoch_transition.rs:159-166`). Pre-generated randomness has a stale `seed_slot` and fails with `RandomnessExpired`.

**Code reference:** `programs/epoch-program/src/instructions/trigger_epoch_transition.rs:159-166`

#### ATK-V3: Already-Revealed Randomness

**Vector:** Attacker finds a revealed randomness account with favorable bytes and submits it for a new epoch.

**Defense:** `trigger_epoch_transition` calls `randomness_data.get_value(clock.slot)` and requires it to FAIL (`trigger_epoch_transition.rs:170-173`). If `get_value` succeeds, the randomness is already revealed and cannot be used. This ensures only un-revealed (committed but not yet revealed) accounts are accepted.

**Code reference:** `programs/epoch-program/src/instructions/trigger_epoch_transition.rs:170-173`

#### ATK-V4: Double-Commit (VRF State Race)

**Vector:** Two cranks submit `trigger_epoch_transition` simultaneously for the same epoch boundary.

**Defense:** `require!(!epoch_state.vrf_pending, EpochError::VrfAlreadyPending)` (`trigger_epoch_transition.rs:149`). The first transaction sets `vrf_pending = true`; the second fails immediately.

#### ATK-V5: Predicting Carnage Outcomes (~3-Slot Window)

**Vector:** After VRF commit, ~3 slots pass before oracle reveals. During this window, the randomness is theoretically observable by the oracle operator.

**Defense:** Accepted risk. Per decision D8, the ~3-slot window (~1.2 seconds) is accepted because:
1. Carnage actions are protocol-beneficial regardless of target (buy one of two equivalent tokens)
2. The only "exploit" is knowing which token Carnage will buy, enabling front-running -- but this requires the oracle operator to be adversarial
3. Switchboard's reputation and stake slashing make this economically irrational

### Crank Liveness

#### ATK-O1: Crank Bot Goes Down

**Vector:** Crank bot crashes, stops processing epochs, Carnage never fires, staking rewards never finalize.

**Defenses (graceful degradation):**

1. **Permissionless recovery**: Any wallet can call all crank operations (`trigger_epoch_transition`, `consume_randomness`, `execute_carnage_atomic`, `execute_carnage`, `expire_carnage`). No on-chain privileges required.

2. **Incentivized cranking**: 0.001 SOL bounty per epoch trigger (`TRIGGER_BOUNTY_LAMPORTS = 1_000_000`, `trigger_epoch_transition.rs:194-227`). Funded from Carnage SOL vault.

3. **No permanently locked funds**: Users can stake/claim at any time regardless of crank state. Unstaking requires a 12-hour cooldown after claiming rewards (users who have never claimed can unstake immediately). Tax rates remain at their last-set values (not zeroed). Pending Carnage expires after 300 slots and SOL is retained for next trigger.

4. **VRF timeout recovery**: If oracle fails to reveal, `retry_epoch_vrf` (permissionless) creates fresh randomness after `VRF_TIMEOUT_SLOTS = 300` slots (~2 min). Fresh randomness may get assigned to a different (working) oracle.

**Code reference:**
- `programs/epoch-program/src/instructions/retry_epoch_vrf.rs` -- Timeout recovery
- `programs/epoch-program/src/instructions/expire_carnage.rs` -- Carnage expiration
- `programs/epoch-program/src/instructions/trigger_epoch_transition.rs:194-227` -- Bounty payment

## Defense Mechanisms

### Slippage Protection (Dual-Layer)

The protocol implements two independent layers of slippage protection:

| Layer | Constant | Value | Applied In | Purpose |
|-------|----------|-------|------------|---------|
| Protocol floor | `MINIMUM_OUTPUT_FLOOR_BPS` | 5000 (50%) | `swap_sol_buy`, `swap_sol_sell` | Prevents users from accepting extreme slippage (anti-sandwich baseline) |
| User slippage | `minimum_amount_out` parameter | User-specified | AMM `swap_sol_pool` | User's exact slippage tolerance |
| Carnage atomic | `CARNAGE_SLIPPAGE_BPS_ATOMIC` | 8500 (85%) | `execute_carnage_atomic` | Tight floor for atomic (bundled) execution |
| Carnage fallback | `CARNAGE_SLIPPAGE_BPS_FALLBACK` | 7500 (75%) | `execute_carnage` | Lenient floor for recovery execution |

### Forfeiture as Sybil/Mercenary Deterrent

Users who unstake forfeit all pending rewards to remaining stakers (rewards are added to `pool.pending_rewards` for redistribution at the next `update_cumulative` call). This eliminates the "stake for one epoch, claim, unstake" pattern that could extract disproportionate rewards.

Combined with the 12-hour cooldown after claiming, a user must choose: claim (starts cooldown, cannot unstake for 12 hours) or unstake immediately (forfeit pending rewards). No path extracts rewards AND exits quickly.

**How the protocol floor works:**

```
1. Tax Program reads current pool reserves via read_pool_reserves() (raw byte reader)
2. Calculates expected output: expected = reserve_out * amount_in / (reserve_in + amount_in)
3. Calculates floor: floor = expected * MINIMUM_OUTPUT_FLOOR_BPS / 10000
4. If user's minimum_amount_out < floor, the swap reverts
5. The floor value is passed as minimum_amount_out to AMM (replacing the user's value if lower)
```

**Code reference:**
- `programs/tax-program/src/helpers/tax_math.rs:135-159` -- `calculate_output_floor()`
- `programs/tax-program/src/helpers/pool_reader.rs:39-58` -- `read_pool_reserves()`

### Tax Poison Pill

The 18% round-trip tax (buy + sell same token) acts as a "poison pill" for sandwich attacks:

```
Attacker buys CRIME:  ~4% buy tax deducted from SOL input
Victim buys CRIME:    Price inflated (attacker front-run)
Attacker sells CRIME: ~14% sell tax deducted from SOL output
```

Net: Attacker loses ~18% of capital to taxes. To profit, they must extract > 18% of the victim's swap value through price impact alone. For a 100 SOL victim swap in a pool with 10,000 SOL reserves, price impact is ~1%. The attacker would need the victim's trade to be > 1800% of pool reserves to break even -- economically impossible.

Tax rates are randomized per epoch (VRF-driven), ranging from 1-4% (low side) to 11-14% (high side). The 75% probability of flipping which token is "cheap" each epoch prevents persistent arbitrage strategies.

**Code references:**
- `programs/tax-program/src/helpers/tax_math.rs:34-53` -- `calculate_tax()`
- `programs/tax-program/src/helpers/tax_math.rs:79-104` -- `split_distribution()` (71% staking / 24% Carnage / 5% treasury)
- `programs/epoch-program/src/constants.rs:99-103` -- Genesis tax rates: low=300 bps (3%), high=1400 bps (14%)

### Structural Anti-Reentrancy

Reentrancy is impossible by construction, not just by guard:

```
CPI Call Graph (Directed Acyclic):

  Epoch Program
    ├─► Tax Program (swap_exempt)
    └─► Staking (update_cumulative)

  Tax Program
    ├─► AMM (swap_sol_pool)
    ├─► Staking (deposit_rewards)
    └─► System Program (SOL transfers)

  AMM
    ├─► Token-2022 (transfer_checked)
    └─► SPL Token (transfer_checked)

  Token-2022
    └─► Transfer Hook (callback)

  Transfer Hook
    └─► (NONE -- terminal node, zero outbound CPIs)

  Conversion Vault
    └─► Token-2022 (transfer_checked × 2, leaf node — no CPI surface)
```

**No cycle exists.** Transfer Hook cannot call Token-2022 back. Token-2022 cannot call AMM back. AMM cannot call Tax back. The Rust type system + Solana's CPI depth limit (4) further prevent any hidden cycle.

**Defense-in-depth guard:** AMM's `PoolState.locked` field provides a conventional reentrancy guard even though the DAG makes it unnecessary:

```rust
// programs/amm/src/state/pool.rs:69
pub locked: bool,

// programs/amm/src/instructions/swap_sol_pool.rs:381
constraint = !pool.locked @ AmmError::PoolLocked,

// programs/amm/src/instructions/swap_sol_pool.rs:84
ctx.accounts.pool.locked = true;

// programs/amm/src/instructions/swap_sol_pool.rs:322
ctx.accounts.pool.locked = false;
```

### Carnage Empty-Vault Graceful No-Op

When CarnageSolVault has zero available SOL (balance equals rent-exempt minimum), Carnage execution returns `Ok(())` with zero swap amounts rather than reverting. This is by design:

- `execute_carnage_atomic`: Calculates `available_sol = sol_balance.saturating_sub(rent_exempt_min)`, then `swap_amount = min(available_sol, MAX_CARNAGE_SWAP_LAMPORTS)`. When `available_sol = 0`, `total_buy_amount = 0`, and `execute_buy_swap` returns `Ok(())` immediately (`execute_carnage_atomic.rs:768-769`).
- `execute_carnage` (fallback): Same logic at `execute_carnage.rs:709-710`.
- **State still updates**: `carnage_pending` is cleared, `total_triggers` increments, target switches. The system self-corrects as tax fees refill the vault in subsequent epochs.
- **DoS prevention**: Without this graceful no-op, an attacker could drain the Carnage vault (e.g., via many small swaps that generate minimal tax) and cause every Carnage trigger to revert, permanently blocking epoch transitions that depend on Carnage resolution.

**Code references:**
- `programs/epoch-program/src/instructions/execute_carnage_atomic.rs:352-366` -- Available SOL calculation
- `programs/epoch-program/src/instructions/execute_carnage_atomic.rs:368,768-769` -- Zero-amount guard in buy/sell helpers
- Decision: DECISIONS/error-handling.md D8

### Conversion Vault Security

The Conversion Vault is architecturally the simplest program in the protocol:

- **No admin key**: One-shot initialization. No stored authority after init.
- **Leaf node**: Calls Token-2022 `transfer_checked` only. Receives no CPIs from other protocol programs. Not part of the CPI depth chain.
- **Fixed-rate math**: Deterministic 100:1 conversion (checked multiplication/division). No rounding exploits possible -- the math is `output = input / 100` (faction->PROFIT) or `output = input * 100` (PROFIT->faction).
- **No price oracle**: Rate is hardcoded, not derived from pool reserves. No oracle manipulation vector.
- **No slippage**: Deterministic output amount. No sandwich attack surface.
- **No MEV**: Fixed rate means no price impact, no front-running opportunity.
- **PDA-derived token accounts**: Vault token accounts are PDA-owned. No authority key to compromise.
- **Hardcoded mints**: Token mint addresses are compile-time constants (feature-gated for devnet/mainnet). No mint substitution attack.
- **Squads upgrade authority**: Same tiered timelock and burn sequence as all other programs.
- **Transfer Hook enforcement**: All vault transfers use `transfer_checked` on Token-2022, ensuring Transfer Hook whitelist validation fires.

### Compute Budget Analysis

The protocol's compute unit (CU) consumption has been profiled across all instruction paths. All user-facing instructions fit within Solana's 200,000 CU default limit. The Carnage atomic bundle requires an elevated budget.

**User swap paths (Tax -> AMM -> T22 -> Hook):**

| Path | Measured CU | % of 200K Default | Status |
|------|------------|-------------------|--------|
| swap_sol_buy (CRIME/SOL) | 97,901 | 49% | OK |
| swap_sol_buy (FRAUD/SOL) | 121,910 | 61% | OK |
| swap_sol_sell (CRIME/SOL) | 98,585 | 49% | OK |
| swap_sol_sell (FRAUD/SOL) | 122,586 | 61% | OK |

**Carnage atomic bundle (reveal + consume + executeCarnageAtomic):**

The atomic bundle is three instructions in one transaction and requires `ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 })`. Breakdown: reveal (~50K CU) + consume_randomness (~100K CU) + execute_carnage_atomic (~300K CU with sell+buy path). The solo `execute_carnage_atomic` (buy-only) measures at 105,017 CU. (`scripts/vrf/lib/vrf-flow.ts:288-291`)

**CPI depth constraint**: Carnage operates at Solana's maximum CPI depth (4): Epoch -> Tax -> AMM -> Token-2022 -> Transfer Hook. No additional CPI calls can be added to the swap path without exceeding the runtime limit.

**Mainnet considerations:**
- Priority fees are charged per CU *requested*, not per CU consumed. Client-side CU limits should be set tightly (measured + 10-20% padding) to minimize priority fee costs.
- The heaviest user path (swap_sol_sell FRAUD at 122,586 CU) leaves 39% headroom under the 200K default, providing comfortable margin for mainnet variance.
- Carnage 600K CU budget is well under the 1,400,000 CU hard cap but will cost 3x the priority fees of a user swap. The crank bounty (0.001 SOL per epoch trigger) should cover this at typical mainnet priority fee levels.

**Code references:**
- `Docs/Compute_Budget_Profile.md` -- Full measurement table with SDK recommendations
- `scripts/vrf/lib/vrf-flow.ts:288-291` -- 600K CU limit for atomic bundle
- `DECISIONS/error-handling.md` raw notes -- Heaviest path: swap_sol_sell(FRAUD) at 122,586 CU

### Immutability as Security

Post-burn, the protocol's strongest security property is its immutability:

1. **No upgrade authority**: All 6 program upgrade authorities burned via Squads multisig (2-of-3)
2. **No admin keys**: AMM admin burned to `Pubkey::default()`, whitelist authority burned to `None`
3. **No pause mechanism**: No `is_paused` flag in any program
4. **No governance**: No on-chain voting, no parameter adjustment
5. **No LP tokens**: Pool liquidity is permanent and unwithdrawable (no rug-pull vector)

The tradeoff is clear: if a critical bug is discovered post-burn, there is no fix path. Users must exit via existing swap mechanisms. This is an explicit design decision (architecture decision A2).

## Authority Burn Sequence

The full deployment-to-burn sequence ensures each authority is burned in the correct order:

| Step | Action | Prerequisite | Validation |
|------|--------|-------------|------------|
| 1 | Deploy all 6 programs | Mainnet build (no `--features devnet`) | Programs compilable and deployable |
| 2 | Initialize all PDAs, pools, whitelist | Programs deployed | All 14 whitelist entries created |
| 3 | Triple-verify whitelist | All entries created | AI + manual verification that exactly 14 addresses are whitelisted and correct |
| 4 | **Burn whitelist authority** | Whitelist verified | `burn_authority` TX confirmed. No more whitelist modifications possible. |
| 5 | **Burn AMM admin** | Pools initialized | `burn_admin` TX confirmed. No new pools can be created. |
| 6 | Start tiered timelock | Admin keys burned | Squads 2-of-3 multisig configured on all 6 program upgrade authorities |
| 7 | Stabilization period | Timelock started | 2hr -> 24hr -> observation (2-4 weeks total) |
| 8 | **Burn all upgrade authorities** | Stabilization complete | All 6 programs permanently frozen. Protocol is autonomous. |

**Critical ordering:**
- Whitelist must be burned BEFORE upgrade authority, because the whitelist is the last user-controllable surface. If upgrade authority burned first but whitelist remains, the whitelist authority key becomes the sole admin vector.
- AMM admin must be burned BEFORE upgrade authority for the same reason.

## Post-Burn Security Model

After all authorities are burned, the threat model simplifies:

| Threat | Status | User Recourse |
|--------|--------|--------------|
| Admin key compromise | **Eliminated** -- no admin keys exist | N/A |
| Malicious upgrade | **Eliminated** -- no upgrade authority exists | N/A |
| Whitelist modification | **Eliminated** -- authority burned to `None` | N/A |
| Pool manipulation | **Eliminated** -- no admin to change pool params | N/A |
| Smart contract bug | **Accepted risk** -- no fix path | Exit via existing swap mechanisms |
| Oracle manipulation | **Mitigated** -- Switchboard reputation + timeout recovery | Wait for timeout recovery (300 slots) |
| Crank death | **Mitigated** -- permissionless recovery + bounty | Any wallet can crank. Funds not locked. |
| Solana outage | **External risk** -- protocol state preserved | Resume when chain resumes |

## Security Audit Status (SVK)

The protocol uses internal SVK (Solana Vulnerability Kit) tooling for security analysis. No external auditor has been engaged (decision D11). No bug bounty program exists (decision D12).

**Completed security verification:**
- 24 attack simulation tests in `tests/security.ts` covering SEC-01 through SEC-07
- 12 token-flow integration tests in `tests/token-flow.ts`
- 10 cross-program integration tests in `tests/cross-program-integration.ts`
- 28 staking integration tests in `tests/staking.ts`
- 34 Rust unit tests in `programs/staking/src/helpers/math.rs`
- 4 property-based tests (proptest) at 10,000 iterations each (40,000 fuzzing iterations total)
- 6 Carnage hunter tests (6/6 paths pass: BuyOnly+Burn+Sell x CRIME+FRAUD)
- 10 overnight runner epochs validated on devnet
- On-chain security verification (6/6 checks pass, per commit `051f779`)

**Coverage matrix:**

| Category | Requirements | Tests | Coverage |
|----------|-------------|-------|----------|
| Security invariants (SEC-01 to SEC-07) | 7 | 34 test cases across 4 files | 100% |
| Math correctness (MATH-01 to MATH-05) | 5 | 24 test cases + 4 proptests | 100% |
| Error handling (ERR-01 to ERR-06) | 6 | 9 test cases across 3 files | 100% |
| Stress tests | 6 scenarios | 1,100+ operations total | Exhaustive |
| Tax math (calculate_tax, split_distribution) | 2 functions | 10 unit + 6 proptests (60K iterations) | 100% |
| Slippage floor (calculate_output_floor) | 1 function | 8 unit tests | 100% |
| Carnage execution (6 paths) | 6 paths | 6 e2e tests on devnet | 100% |

## Security Checklist

### On-Chain Defenses

- [x] **PDA-gated CPI**: All 4 cross-program gates use `seeds::program` constraint (SwapAuthority, TaxAuthority, StakingAuthority, CarnageSigner)
- [x] **Reentrancy impossible**: Acyclic CPI DAG (Transfer Hook = terminal node). AMM `locked` guard as defense-in-depth.
- [x] **CEI ordering**: All programs mutate state before CPI calls. Verified by code review and stress tests.
- [x] **Checked arithmetic**: All math uses `checked_mul`, `checked_add`, `checked_sub`, `checked_div`. Never panics. 40,000 proptest iterations confirm.
- [x] **u128 intermediates**: All tax/reward calculations use u128 to prevent overflow on large u64 inputs.
- [x] **Transfer Hook whitelist**: 14 protocol PDAs whitelisted. User wallets blocked. PDA derivation verified to prevent spoofing.
- [x] **`transfer_checked` only**: All Token-2022 transfers use `transfer_checked` (hooks always fire). No plain `transfer`.
- [x] **Transferring flag check**: Hook validates `TransferHookAccount.transferring == true` (prevents direct invocation).
- [x] **Mint owner check**: Hook validates `mint.owner == spl_token_2022::id()` (defense-in-depth).
- [x] **Dead stake (anti-inflation)**: 1 PROFIT permanently locked in StakePool. No UserStake PDA for dead stake.
- [x] **Flash-loan resistant staking**: Checkpoint pattern. Same-epoch stake/unstake = zero rewards.
- [x] **Anti-reroll VRF**: Randomness account bound at commit. Freshness check (seed_slot within 1 slot). Already-revealed check.
- [x] **Dual-layer slippage**: User `minimum_amount_out` + protocol 50% floor (`MINIMUM_OUTPUT_FLOOR_BPS`).
- [x] **Carnage slippage floors**: Atomic 85% (`CARNAGE_SLIPPAGE_BPS_ATOMIC`), fallback 75% (`CARNAGE_SLIPPAGE_BPS_FALLBACK`).
- [x] **Carnage lock window**: 50-slot atomic-only window prevents fallback front-running during initial execution.
- [x] **Carnage swap cap**: `MAX_CARNAGE_SWAP_LAMPORTS = 1,000,000,000,000` (1000 SOL) prevents compute-budget failures.
- [x] **VRF timeout recovery**: `VRF_TIMEOUT_SLOTS = 300`. Permissionless `retry_epoch_vrf` with fresh randomness.
- [x] **UserStake owner validation**: PDA seeds include `user_pubkey`. Seeds mismatch = account not found.
- [x] **Account substitution prevented**: Vault, mint, and token program constraints on all swap instructions.
- [x] **Canonical mint ordering**: `mint_a < mint_b` enforced on-chain. One pool PDA per mint pair.
- [x] **No flash loans / TWAP**: Stripped from AMM fork. Emergent MEV resistance.
- [x] **Pool drain resistant**: Constant-product k-invariant (`k_after >= k_before`), zero-output rejection, 50% slippage floor. Proptest: output never exceeds reserve_out (10K iterations).
- [x] **Concurrent Carnage/swap safe**: Solana runtime serializes same-account writes. AMM `locked` guard as belt-and-suspenders. Independent slippage floors per path.
- [x] **Carnage empty-vault no-op**: Zero SOL vault returns `Ok(())` with zero amounts. State updates, system self-corrects as tax fees refill.
- [x] **Compute budget profiled**: All user swaps < 123K CU (61% of 200K default). Carnage atomic bundle at 600K CU. CPI depth-4 at Solana limit.

### Pre-Mainnet Checklist

- [ ] Remove `force_carnage` (devnet-only): Verify `#[cfg(feature = "devnet")]` gate excludes it from mainnet build
- [ ] Set mainnet `treasury_pubkey()` (currently `Pubkey::default()` placeholder in non-devnet build)
- [ ] Mainnet Switchboard `SWITCHBOARD_PROGRAM_ID` activates automatically (feature flag)
- [ ] Mainnet `SLOTS_PER_EPOCH = 4500` activates automatically (feature flag)
- [ ] Triple-verify whitelist (14 entries) before burning whitelist authority
- [ ] Burn whitelist authority, verify `AuthorityBurned` event emitted
- [ ] Burn AMM admin, verify `AdminBurned` event emitted
- [ ] Configure Squads 2-of-3 multisig on all 6 program upgrade authorities
- [ ] Start tiered timelock (2hr -> 24hr -> burn)
- [ ] Burn all upgrade authorities after stabilization period

### Sensitive Data Inventory

| Item | Location | Risk | Mitigation |
|------|----------|------|------------|
| Devnet wallet keypair | `keypairs/devnet-wallet.json` | Low (devnet only, no real value) | Rotate before mainnet. Never commit mainnet keys. |
| Helius RPC API key | Environment variable | Medium (billing exposure) | Proxy via backend. Rate limiting. Rotate on compromise. |
| Sentry webhook secret | Environment variable | Low (monitoring only) | Rotate on compromise. |

---

*Generated by Grand Library (Wave 3). Sources: programs/amm/src/state/pool.rs, programs/amm/src/instructions/swap_sol_pool.rs, programs/amm/src/instructions/burn_admin.rs, programs/transfer-hook/src/instructions/transfer_hook.rs, programs/transfer-hook/src/instructions/add_whitelist_entry.rs, programs/transfer-hook/src/instructions/burn_authority.rs, programs/transfer-hook/src/instructions/initialize_authority.rs, programs/transfer-hook/src/instructions/initialize_extra_account_meta_list.rs, programs/tax-program/src/helpers/tax_math.rs, programs/tax-program/src/helpers/pool_reader.rs, programs/tax-program/src/constants.rs, programs/tax-program/src/instructions/swap_exempt.rs, programs/epoch-program/src/constants.rs, programs/epoch-program/src/instructions/consume_randomness.rs, programs/epoch-program/src/instructions/trigger_epoch_transition.rs, programs/epoch-program/src/instructions/execute_carnage_atomic.rs, programs/epoch-program/src/instructions/execute_carnage.rs, programs/epoch-program/src/instructions/retry_epoch_vrf.rs, programs/epoch-program/src/instructions/expire_carnage.rs, programs/epoch-program/src/instructions/force_carnage.rs, tests/security.ts, Docs/SECURITY_TESTS.md, Docs/architecture.md. Decisions referenced: security (14), cpi-architecture (6), amm-design (8), architecture (5), token-model (10). Total: 43 decisions synthesized.*
