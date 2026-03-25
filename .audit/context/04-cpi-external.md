---
task_id: sos-phase1-cpi
provides: [cpi-findings, cpi-invariants]
focus_area: cpi
files_analyzed: [amm/src/helpers/transfers.rs, amm/src/instructions/swap_sol_pool.rs, amm/src/instructions/initialize_pool.rs, amm/src/constants.rs, tax-program/src/instructions/swap_sol_buy.rs, tax-program/src/instructions/swap_sol_sell.rs, tax-program/src/instructions/swap_exempt.rs, tax-program/src/constants.rs, tax-program/src/state/epoch_state_reader.rs, tax-program/src/helpers/pool_reader.rs, epoch-program/src/helpers/carnage_execution.rs, epoch-program/src/instructions/execute_carnage_atomic.rs, epoch-program/src/instructions/execute_carnage.rs, epoch-program/src/instructions/consume_randomness.rs, epoch-program/src/instructions/trigger_epoch_transition.rs, epoch-program/src/constants.rs, epoch-program/src/helpers/tax_derivation.rs, staking/src/helpers/transfer.rs, staking/src/instructions/deposit_rewards.rs, staking/src/instructions/update_cumulative.rs, staking/src/constants.rs, bonding_curve/src/instructions/purchase.rs, bonding_curve/src/instructions/sell.rs, bonding_curve/src/instructions/fund_curve.rs, conversion-vault/src/helpers/hook_helper.rs, transfer-hook/src/instructions/transfer_hook.rs]
finding_count: 14
severity_breakdown: {critical: 0, high: 5, medium: 6, low: 3}
---
<!-- CONDENSED_SUMMARY_START -->
# CPI & External Calls -- Condensed Summary

## Key Findings (Top 10)
1. **Cross-program AMM ID mismatch between Tax and Epoch constants**: Tax Program references AMM at `5JsS...` (the **mainnet** AMM ID per deployments/mainnet.json) while Epoch references `J7Jx...` (the **devnet** AMM ID per deployments/devnet.json). AMM's current `declare_id!` uses the devnet ID. This means the Tax Program's constants are configured for mainnet while other programs target devnet -- a cluster-awareness sync issue. A build from this source without `sync-program-ids.ts` would create CPI mismatches. -- `tax-program/src/constants.rs:100`, `epoch-program/src/constants.rs:26`
2. **CPI depth at Solana's 4-level hard limit**: The Carnage swap chain (Epoch -> Tax::swap_exempt -> AMM::swap_sol_pool -> Token-2022::transfer_checked -> Transfer Hook::execute) is exactly at the 4-level CPI limit. Zero margin. Any accidental addition breaks all Carnage execution. -- `epoch-program/src/helpers/carnage_execution.rs:11-16`
3. **remaining_accounts forwarded without per-account validation at CPI sites**: All 8+ CPI sites forward remaining_accounts to Token-2022 without owner checks or length validation (except bonding curve which validates len==4). Validation is delegated entirely to Token-2022 and the Transfer Hook program. -- `tax-program/src/instructions/swap_sol_buy.rs:242-248`, `swap_sol_sell.rs:193-203`
4. **Manual instruction discriminator bytes**: Raw bytes `3u8` (SPL Transfer), `8u8` (Burn), `9u8` (CloseAccount), `17u8` (SyncNative), `18u8` (InitializeAccount3), `4u8` (Approve) used instead of SDK helpers. Fragile if SPL Token ever changes encoding. -- `swap_sol_sell.rs:297`, `carnage_execution.rs:497`
5. **swap_exempt passes minimum_output=0**: Carnage Fund swaps use zero slippage protection at the AMM level. Slippage is enforced post-swap by Epoch Program's own floor check, but the AMM's own slippage guard is bypassed. -- `tax-program/src/instructions/swap_exempt.rs:111`
6. **Optional carnage_state in ConsumeRandomness**: Anyone calling `consume_randomness` can omit the `carnage_state` account, causing Carnage trigger check to be silently skipped even when VRF randomness would trigger Carnage. -- `epoch-program/src/instructions/consume_randomness.rs:76-80`
7. **stake_pool unconstrained at Epoch Program level**: `stake_pool` in ConsumeRandomness is `AccountInfo` with only `#[account(mut)]` -- no owner or seeds constraint. Protected by downstream Staking CPI validation, but a defense-in-depth gap. -- `consume_randomness.rs:65-66`
8. **Staking constants test asserts wrong value**: `test_tax_program_id()` asserts `43fZ...` (mock-tax-program) but function returns `FGgi...` (real tax-program). Test would fail if run. Does not affect runtime but indicates stale maintenance. -- `staking/src/constants.rs:133-140`
9. **EpochState cross-program deserialization**: Tax Program reads EpochState via full Anchor `try_deserialize` with owner + discriminator checks. Robust. But the struct layout must match exactly across programs -- enforced by compile-time assertion. -- `tax-program/src/state/epoch_state_reader.rs:64`
10. **Pool reserve byte-offset reading**: Both Tax Program and Epoch Program read AMM PoolState reserves via hardcoded byte offsets (137..145, 145..153). If PoolState layout changes, these silently read wrong data. -- `tax-program/src/helpers/pool_reader.rs`, `epoch-program/src/helpers/carnage_execution.rs:825-851`

## Critical Mechanisms
- **CPI Chain (Carnage Swap Path)**: Epoch -> Tax::swap_exempt -> AMM::swap_sol_pool -> Token-2022::transfer_checked -> Transfer Hook. Exactly at Solana's 4-level limit. SOL wrapping happens at depth 0 (before chain). Burns also at depth 0. Any additional CPI in the chain would break Carnage execution permanently. -- `carnage_execution.rs:11-16`
- **swap_authority PDA**: Derived by Tax Program (`seeds=["swap_authority"]`), validated by AMM via `seeds::program = TAX_PROGRAM_ID`. This is the gatekeeper preventing direct user swaps -- only Tax Program can sign. Hardcoded `TAX_PROGRAM_ID` in AMM constants must match Tax's `declare_id!`. -- `amm/src/constants.rs:10`, `amm/src/instructions/swap_sol_pool.rs:379-384`
- **carnage_signer PDA**: Derived by Epoch Program (`seeds=["carnage_signer"]`), validated by Tax's swap_exempt via `seeds::program = epoch_program_id()`. Only Epoch Program can trigger tax-exempt swaps. Seed must match across both programs. -- `tax-program/src/instructions/swap_exempt.rs:193-198`
- **Token-2022 Transfer Hook forwarding**: All T22 transfers use manual `invoke_signed` instead of Anchor CPI because Anchor's CPI framework does not forward `remaining_accounts` through the nested Token-2022 -> Hook CPI chain. Verified in AMM, staking, bonding curve, and conversion vault. -- `amm/src/helpers/transfers.rs:7-52`
- **Cross-program ID validation**: Every CPI target program is validated via either `address = known_program_id()` constraint or `seeds::program = known_program_id()` for PDA signers. No arbitrary program substitution is possible. -- Multiple files

## Invariants & Assumptions
- INVARIANT: AMM swap_sol_pool can only be invoked by Tax Program's swap_authority PDA -- enforced at `amm/src/instructions/swap_sol_pool.rs:379-384` via `Signer` + `seeds::program = TAX_PROGRAM_ID`
- INVARIANT: Tax::swap_exempt can only be invoked by Epoch Program's carnage_signer PDA -- enforced at `tax-program/src/instructions/swap_exempt.rs:193-198` via `Signer` + `seeds::program = epoch_program_id()`
- INVARIANT: Staking::deposit_rewards can only be invoked by Tax Program's tax_authority PDA -- enforced at `staking/src/instructions/deposit_rewards.rs:37-42` via `Signer` + `seeds::program = tax_program_id()`
- INVARIANT: Staking::update_cumulative can only be invoked by Epoch Program's staking_authority PDA -- enforced at `staking/src/instructions/update_cumulative.rs:37-42` via `Signer` + `seeds::program = epoch_program_id()`
- INVARIANT: Token-2022 transfer_checked (not plain transfer) is always used for T22 tokens -- enforced at each transfer helper; plain transfer would bypass hooks
- ASSUMPTION: Hardcoded byte offsets (137..145, 145..153) for AMM PoolState reserves are correct -- validated at `carnage_execution.rs:822-824` via length check (>=153) but NOT validated against a version marker / UNVALIDATED against schema changes
- ASSUMPTION: Cross-program instruction discriminators (precomputed sha256 hashes) match the actual deployed programs -- validated by tests in constants.rs but would silently fail if mismatched at runtime
- ASSUMPTION: All cross-program IDs in constants.rs match the deployed programs' `declare_id!` values -- sync-program-ids.ts automates this at deploy time, but Tax Program's AMM ID (`5JsS...`) does not match AMM's actual `declare_id!` (`J7Jx...`) in the current source

## Risk Observations (Prioritized)
1. **AMM Program ID cluster mismatch in Tax Program**: `tax-program/src/constants.rs:100` -- Tax references `5JsS...` (mainnet AMM ID per deployments/mainnet.json) while AMM's `declare_id!` and Epoch's constants use `J7Jx...` (devnet AMM ID per deployments/devnet.json). The source code is in a mixed-cluster state: Tax constants target mainnet, other programs target devnet. The `sync-program-ids.ts` build step resolves this before deployment, but the source-level mismatch means a naive `anchor build` without sync would produce incompatible programs.
2. **CPI depth at hard limit**: `carnage_execution.rs:11-16` -- Zero headroom. Agave 3.0 raises limit to 8, but until mainnet fully migrates, this is a hard constraint. Any code change adding CPI to the swap path would silently break Carnage.
3. **Optional carnage_state griefing**: `consume_randomness.rs:76-80` -- MEV actor could front-run consume_randomness without carnage_state, causing VRF-triggered Carnage to be silently skipped. The crank operator would need to retry with carnage_state to activate Carnage.
4. **minimum_output=0 in swap_exempt**: `swap_exempt.rs:111` -- AMM's own slippage check is bypassed. Epoch Program enforces slippage post-swap (75-85% floor), but a sandwich attack within the TX could drain more value than the post-swap check catches.
5. **remaining_accounts length not validated in Tax/Epoch CPI sites**: `swap_sol_buy.rs:242`, `swap_sol_sell.rs:193`, `carnage_execution.rs:422` -- Only bonding curve validates `len==4`. Tax and Epoch forward all remaining_accounts without length checks. Extra accounts are harmless (ignored by Token-2022), but zero accounts would cause Token-2022 transfer to fail for T22 tokens.

## Novel Attack Surface
- **Cross-cycle ID drift / Cluster contamination**: The protocol has 7+ programs that reference each other's program IDs via hardcoded constants. A partial redeploy (rebuilding some programs but not others) would create ID mismatches that break CPI chains. The `sync-program-ids.ts` script mitigates this but is a critical deployment dependency. The current source code shows a cluster contamination issue: Tax Program's AMM ID is the mainnet value (`5JsS...`) while other programs use the devnet value (`J7Jx...`). This indicates the sync script ran at different times for different programs, leaving the source in a mixed-cluster state. A build without the sync step would produce incompatible programs.
- **Byte-offset cross-program reads**: Tax and Epoch programs read AMM PoolState via raw byte offsets (not Anchor deserialization) to avoid circular crate dependencies. A change to PoolState's field ordering or sizes would cause silent data corruption in tax calculations and Carnage slippage checks, with no compile-time error.
- **CPI depth limit as protocol-wide fragility**: The 4-level CPI depth constraint means ANY modification to the Carnage swap path (even adding logging or validation) could break Carnage execution. This creates a maintenance trap where security improvements to the swap path are impossible without Agave 3.0's 8-level limit.

## Cross-Focus Handoffs
- -> **Access Control Agent:** swap_exempt's `carnage_authority` Signer + `seeds::program` is the sole access control for tax-exempt swaps. Verify no other path to swap_exempt exists.
- -> **Account Validation Agent:** `stake_pool` in ConsumeRandomness (line 65) has no owner/seeds constraint at Epoch level. `pool` in Tax's swap_sol_buy/sell has no constraints beyond `#[account(mut)]` -- validated only by downstream AMM CPI.
- -> **Token/Economic Agent:** All token transfer CPIs. swap_exempt passes `minimum_output=0` to AMM -- verify Epoch's post-swap slippage floor is sufficient. Tax distribution split (71/24/5) in system_instruction::transfer CPIs.
- -> **Oracle Agent:** consume_randomness CPI to Staking (update_cumulative) happens AFTER VRF consumption. Verify ordering is correct.
- -> **Error Handling Agent:** All `invoke_signed` calls propagate errors via `?` operator. No `let _ = invoke()` patterns found (good). But swap_exempt has no post-swap validation of its own -- relies entirely on AMM's checks.
- -> **Arithmetic Agent:** The `as u64` truncation pattern in slippage floor calculations (execute_carnage_atomic:255,272,284) -- these use `.unwrap()` which panics on None.

## Trust Boundaries
The protocol has a clear layered trust model: User transactions enter via Tax Program (buy/sell), which validates EpochState and deducts taxes before CPI to AMM. AMM trusts only Tax Program's swap_authority PDA (enforced via Signer + seeds::program). Epoch Program triggers Carnage via Tax's swap_exempt, authenticated by carnage_signer PDA. Staking only accepts CPI from Tax (deposit_rewards) and Epoch (update_cumulative) via their respective authority PDAs. Transfer Hook is invoked by Token-2022 (verified via transferring flag), not directly by any protocol program. All cross-program trust is PDA-based with seeds::program constraints, which is the strongest Solana pattern. The weakest trust boundary is the remaining_accounts forwarding, where the protocol trusts clients to provide correct Token-2022 hook accounts without on-chain validation.
<!-- CONDENSED_SUMMARY_END -->

---

# CPI & External Calls -- Full Analysis

## Executive Summary

The Dr. Fraudsworth protocol has a deeply interconnected CPI architecture spanning 7 programs. The primary CPI chain (Epoch -> Tax -> AMM -> Token-2022 -> Transfer Hook) is at Solana's 4-level CPI depth limit, creating zero margin for modification. All cross-program calls use PDA-based authentication with `seeds::program` constraints -- the strongest possible pattern on Solana. Program IDs are hardcoded in constants rather than passed as parameters, preventing arbitrary program substitution.

The most significant finding is a program ID mismatch: Tax Program's `amm_program_id()` returns `5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR` while the AMM's actual `declare_id!` is `J7JxmNkzi3it6Q4TNYjTD6mKdgMaD1pxrstn1RnL3bR5`. This would cause all Tax->AMM CPIs to fail at runtime. This is either a sync issue from a previous deploy cycle (the `sync-program-ids.ts` script updates declare_id but may not update cross-program references), or the current source is awaiting a sync before the next build.

All Token-2022 transfers correctly use manual `invoke_signed` instead of Anchor's CPI framework, which is necessary because Anchor does not forward remaining_accounts through the Token-2022 -> Transfer Hook nested CPI chain. This pattern is consistently applied across AMM, staking, bonding curve, and conversion vault programs.

## Scope
- **Files analyzed:** 26 source files across 7 programs
- **Functions analyzed:** 35+ CPI-related functions
- **Estimated coverage:** ~95% of all CPI call sites

## Key Mechanisms

### 1. CPI Chain: Carnage Swap Path
**Location:** `epoch-program/src/helpers/carnage_execution.rs:11-16`

**Purpose:** Execute Carnage Fund rebalancing swaps (buy/sell tokens using accumulated tax SOL).

**How it works:**
```
execute_carnage[_atomic] (depth 0, entry)
  -> Tax::swap_exempt (depth 1, CPI via invoke_signed)
    -> AMM::swap_sol_pool (depth 2, CPI via invoke_signed)
      -> Token-2022::transfer_checked (depth 3, CPI via invoke_signed)
        -> Transfer Hook::execute (depth 4, CPI from Token-2022)
```

**Assumptions:**
- Solana runtime allows exactly 4 CPI depth levels (confirmed in runtime quirks KB)
- SOL->WSOL wrapping happens at depth 0 (before the chain starts), verified at `carnage_execution.rs:292-294`
- Token burn also happens at depth 0, verified at `carnage_execution.rs:513-521`

**Invariants:**
- No additional CPI calls can be added to the swap path without breaking Carnage
- The SOL wrap (system_program::transfer + sync_native) MUST execute before the swap CPI, not within it

**Concerns:**
- Agave 3.0 raises CPI depth to 8, which would give headroom, but current mainnet is still at 4
- This constraint prevents adding any security checks that require CPI within the swap path (e.g., oracle checks, additional validation CPIs)

### 2. swap_authority PDA Authentication (AMM Gatekeeper)
**Location:** `amm/src/instructions/swap_sol_pool.rs:379-384`, `amm/src/constants.rs:10`

**Purpose:** Ensures only Tax Program can initiate AMM swaps. Users cannot call AMM directly.

**How it works:**
1. AMM's `SwapSolPool` struct requires `swap_authority: Signer<'info>` with `seeds = [SWAP_AUTHORITY_SEED], seeds::program = TAX_PROGRAM_ID`
2. Tax Program derives this PDA using the same seeds and signs CPI via `invoke_signed`
3. AMM hardcodes `TAX_PROGRAM_ID` as a constant (`pubkey!("FGgi...")`) -- not passed as an account

**Assumptions:**
- `TAX_PROGRAM_ID` in AMM matches Tax Program's `declare_id!` -- currently matches: both are `FGgi...`
- `SWAP_AUTHORITY_SEED` in AMM (`b"swap_authority"`) matches Tax Program's seed -- verified: both are `b"swap_authority"`

**Invariants:**
- Post-invariant: Only Tax Program can execute swaps on AMM pools
- This is the PRIMARY access control mechanism for the protocol's trading infrastructure

### 3. carnage_signer PDA Authentication (Tax::swap_exempt Gatekeeper)
**Location:** `tax-program/src/instructions/swap_exempt.rs:193-198`

**Purpose:** Ensures only Epoch Program can trigger tax-exempt swaps for Carnage Fund.

**How it works:**
1. SwapExempt requires `carnage_authority: Signer<'info>` with `seeds = [CARNAGE_SIGNER_SEED], seeds::program = epoch_program_id()`
2. Epoch Program derives carnage_signer PDA with same seeds and signs via `invoke_signed`
3. Tax Program hardcodes `epoch_program_id()` -- returns `E1u6...`, matches Epoch's `declare_id!`

**Assumptions:**
- `CARNAGE_SIGNER_SEED` in Tax (`b"carnage_signer"`) matches Epoch's seed -- verified: both are `b"carnage_signer"`
- `epoch_program_id()` in Tax returns `E1u6...` -- matches Epoch's `declare_id!`

### 4. Token-2022 Transfer Hook Forwarding
**Location:** `amm/src/helpers/transfers.rs:53-126`, `staking/src/helpers/transfer.rs:34-90`, `conversion-vault/src/helpers/hook_helper.rs:23-90`

**Purpose:** Forward Transfer Hook extra accounts through the Token-2022 -> Hook CPI chain.

**How it works:**
1. Build base `transfer_checked` instruction via `spl_token_2022::instruction::transfer_checked()`
2. Append hook accounts (ExtraAccountMetaList PDA, whitelist PDAs, hook program) to both `ix.accounts` and `account_infos`
3. Call `invoke_signed` with the combined account lists

**Why manual (not Anchor CPI):** Anchor's `CpiContext::with_remaining_accounts()` adds accounts to the CpiContext but does NOT propagate them through the raw instruction keys that Token-2022 reads for its nested CPI to the Transfer Hook program.

**Defense-in-depth in AMM's helper:**
- Lines 68-71: `require!(*token_program.key == anchor_spl::token_2022::ID)` -- prevents calling arbitrary programs
- Lines 74-75: `require!(amount > 0)` -- prevents zero-amount waste

**Staking's helper lacks these defenses:** `staking/src/helpers/transfer.rs` does NOT validate the token program ID or zero amount before CPI. It relies entirely on the calling instruction's constraints.

### 5. Cross-Program EpochState Deserialization
**Location:** `tax-program/src/instructions/swap_sol_buy.rs:57-91`, `tax-program/src/state/epoch_state_reader.rs`

**Purpose:** Tax Program reads EpochState from Epoch Program to get current tax rates.

**How it works:**
1. Owner check: `epoch_state.owner == &epoch_program_id()` (prevents fake EpochState)
2. Full Anchor deserialization: `EpochState::try_deserialize()` validates 8-byte discriminator
3. Initialized flag check: `epoch_state.initialized`
4. Compile-time size assertion: `const _: () = assert!(EpochState::DATA_LEN == 164)` ensures mirror struct matches

**Assumptions:**
- Mirror struct layout exactly matches Epoch Program's EpochState -- enforced by compile-time assertion
- No #[repr(C)] misalignment between programs -- both structs use `#[repr(C)]`
- Borsh serialization is deterministic and identical between programs (same Anchor version)

### 6. Raw Byte-Offset Pool Reserve Reading
**Location:** `tax-program/src/helpers/pool_reader.rs`, `epoch-program/src/helpers/carnage_execution.rs:825-851`

**Purpose:** Read AMM PoolState reserves without crate dependency on AMM.

**How it works:**
- Reads raw bytes from PoolState AccountInfo at hardcoded offsets
- Offsets: mint_a at [9..41], reserve_a at [137..145], reserve_b at [145..153]
- Minimum length check: `data.len() >= 153`
- Epoch version additionally checks mint_a to determine canonical ordering (is_reversed)

**Concerns:**
- No version marker or magic number validation beyond Anchor discriminator
- If PoolState adds a field before reserves, the offsets silently read wrong data
- This is a known maintenance risk, documented in INDEX.md

## Trust Model

### Trust Hierarchy
```
Users (untrusted)
  |
  v
Tax Program (validates user input, deducts tax)
  |
  v [swap_authority PDA]
AMM Program (validates pool state, executes swap math)
  |
  v [invoke_signed to Token-2022]
Token-2022 (validates token balances, invokes hook)
  |
  v [nested CPI]
Transfer Hook (validates whitelist, read-only)

Epoch Program (VRF consumer, Carnage executor)
  |
  v [carnage_signer PDA]
Tax Program::swap_exempt (no-tax swap for Carnage)

Epoch Program
  |
  v [staking_authority PDA]
Staking Program::update_cumulative

Tax Program
  |
  v [tax_authority PDA]
Staking Program::deposit_rewards
```

### Trust Boundaries
- **Users -> Tax Program:** User is `Signer`, untrusted. Tax Program validates all inputs.
- **Tax -> AMM:** Authenticated via swap_authority PDA. AMM validates all pool state independently.
- **Epoch -> Tax:** Authenticated via carnage_signer PDA. Tax validates AMM program ID.
- **Epoch -> Staking:** Authenticated via staking_authority PDA. Staking validates pool state.
- **Tax -> Staking:** Authenticated via tax_authority PDA. Staking validates escrow balance.
- **remaining_accounts:** UNTRUSTED input from client. Forwarded to Token-2022 which validates them internally. Protocol programs do NOT validate individual remaining_accounts.

## State Analysis

### State Modified by CPI
| CPI Target | State Modified | Modified By |
|---|---|---|
| AMM::swap_sol_pool | PoolState.reserve_a, reserve_b, locked | Tax Program (buy/sell), Epoch (Carnage) |
| Token-2022::transfer_checked | Token account balances | AMM (swap transfers) |
| Transfer Hook::transfer_hook | None (read-only) | Token-2022 (hook invocation) |
| Staking::deposit_rewards | StakePool.pending_rewards | Tax Program (after tax split) |
| Staking::update_cumulative | StakePool.rewards_per_token_stored, pending_rewards | Epoch Program (per epoch) |
| System::transfer | Account lamport balances | Tax Program (tax distribution), Epoch (bounty, wrap) |

### State Read Cross-Program
| Reader | State Read | Owner Program |
|---|---|---|
| Tax Program | EpochState (tax rates) | Epoch Program |
| Tax Program | PoolState (reserves for output floor) | AMM Program |
| Epoch Program | PoolState (reserves for slippage check) | AMM Program |

## Dependencies

### External Program Dependencies
| Protocol Program | External Dependency | How Validated |
|---|---|---|
| All | System Program | `Program<'info, System>` (Anchor type) |
| AMM, Bonding Curve, Vault | SPL Token (for WSOL) | `Interface<'info, TokenInterface>` + ID check |
| AMM, Bonding Curve, Vault, Staking | Token-2022 (for CRIME/FRAUD/PROFIT) | `Interface<'info, TokenInterface>` + ID check |
| Epoch | Switchboard VRF | `owner = SWITCHBOARD_PROGRAM_ID` constraint |
| Bonding Curve | Associated Token Program | `Program<'info, AssociatedToken>` |

## Focus-Specific Analysis

### CPI Call Map

| Location | Target Program | Method | CPI Type | Program ID Validated? | PDA Seeds (if signed) |
|---|---|---|---|---|---|
| `swap_sol_buy.rs:128` | System Program | transfer (staking) | invoke_signed | Anchor Program type | User signs (no PDA) |
| `swap_sol_buy.rs:166` | Staking Program | deposit_rewards | invoke_signed | `address = staking_program_id()` | `["tax_authority", bump]` |
| `swap_sol_buy.rs:180` | System Program | transfer (carnage) | invoke_signed | Anchor Program type | User signs |
| `swap_sol_buy.rs:197` | System Program | transfer (treasury) | invoke_signed | Anchor Program type | User signs |
| `swap_sol_buy.rs:304` | AMM Program | swap_sol_pool | invoke_signed | `address = amm_program_id()` | `["swap_authority", bump]` |
| `swap_sol_sell.rs:235` | AMM Program | swap_sol_pool | invoke_signed | `address = amm_program_id()` | `["swap_authority", bump]` |
| `swap_sol_sell.rs:302` | SPL Token | transfer (tax WSOL) | invoke | token_program_a (Interface) | N/A (user signs) |
| `swap_sol_sell.rs:324` | SPL Token | close_account | invoke_signed | token_program_a | `["swap_authority", bump]` |
| `swap_sol_sell.rs:339-418` | System Program | transfer x3 | invoke_signed | Anchor Program type | `["swap_authority", bump]` |
| `swap_sol_sell.rs:377` | Staking Program | deposit_rewards | invoke_signed | `address = staking_program_id()` | `["tax_authority", bump]` |
| `swap_sol_sell.rs:438` | System Program | create_account | invoke_signed | Anchor Program type | `["swap_authority", bump]`, `["wsol_intermediary", bump]` |
| `swap_sol_sell.rs:464` | SPL Token | InitializeAccount3 | invoke | token_program_a | N/A (permissionless) |
| `swap_exempt.rs:150` | AMM Program | swap_sol_pool | invoke_signed | `address = amm_program_id()` | `["swap_authority", bump]` |
| `carnage_execution.rs:513` | Token-2022 | burn | invoke_signed | Interface<TokenInterface> | `["carnage_fund", bump]` |
| `carnage_execution.rs:567` | System Program | transfer (wrap SOL) | invoke_signed | system_program ref | `["carnage_sol_vault", bump]` |
| `carnage_execution.rs:586` | SPL Token | sync_native | invoke_signed | token_program_a | N/A (permissionless) |
| `carnage_execution.rs:806` | Tax Program | swap_exempt | invoke_signed | tax_program ref | `["carnage_signer", bump]` |
| `carnage_execution.rs:889` | Token-2022 | approve (delegate) | invoke_signed | token_program_b | `["carnage_fund", bump]` |
| `consume_randomness.rs:255` | Staking Program | update_cumulative | invoke_signed | `address = staking_program_id()` | `["staking_authority", bump]` |
| `trigger_epoch.rs:221` | System Program | transfer (bounty) | invoke_signed | Anchor Program type | `["carnage_sol_vault", bump]` |
| `amm/transfers.rs:119` | Token-2022 | transfer_checked | invoke_signed | `require!(*token_program.key == T22::ID)` | Pool PDA seeds or empty |
| `amm/transfers.rs:189` | SPL Token | transfer_checked | CpiContext | `require!(*token_program.key == spl_token::ID)` | Pool PDA seeds or empty |
| `staking/transfer.rs:83` | Token-2022 | transfer_checked | invoke_signed | **NOT validated** | Pool PDA seeds |
| `purchase.rs:268` | Token-2022 | transfer_checked | invoke_signed | token_program (Interface) | Curve PDA seeds |
| `sell.rs:262` | Token-2022 | transfer_checked | invoke | token_program (Interface) | N/A (user signs) |
| `hook_helper.rs:83` | Token-2022 | transfer_checked | invoke_signed | `require!(*token_program.key == T22::ID)` | Vault PDA seeds |

### Privilege Flow Analysis

**Tax Program buy CPI to AMM:**
- swap_authority (Tax PDA) signs as AMM's authorized swapper
- User's signer status is forwarded to AMM (appears as `user: Signer`)
- All pool accounts are mutable (pool, vault_a, vault_b, user_token_a, user_token_b)
- AMM validates pool state, mint matching, vault ownership independently
- Risk: If AMM program ID is wrong in Tax constants, this CPI would fail (not exploitable, just broken)

**Epoch Program Carnage CPI to Tax::swap_exempt:**
- carnage_signer (Epoch PDA) signs as Tax's authorized Carnage caller
- swap_authority (Tax PDA) is passed as read-only (Tax derives and signs it internally for AMM CPI)
- Both pool sets (CRIME/SOL, FRAUD/SOL) with all vaults are passed
- Risk: Pool vaults passed by Epoch are `AccountInfo` without owner constraints -- Tax validates via AMM CPI

**consume_randomness CPI to Staking::update_cumulative:**
- staking_authority (Epoch PDA) signs for Staking
- stake_pool passed as mutable AccountInfo with NO owner constraint at Epoch level
- Protected by: Staking validates stake_pool via its own `seeds` constraint
- Risk: Defense-in-depth gap -- a fake stake_pool would pass Epoch validation but fail at Staking

### Return Data Analysis

No CPI calls in this codebase use `get_return_data()`. All cross-program communication is done via:
1. Account state mutation (CPI modifies accounts, caller reads back via `.reload()`)
2. Balance difference measurement (snapshot before, reload after)

This is the safe pattern -- no return data spoofing risk.

### remaining_accounts Audit

| Location | Usage | Length Validated? | Individual Account Validated? |
|---|---|---|---|
| `swap_sol_buy.rs:242-248` | Hook accounts forwarded to AMM CPI | No | No |
| `swap_sol_sell.rs:193-203` | Hook accounts forwarded to AMM CPI | No | No |
| `swap_exempt.rs:95-101` | Hook accounts forwarded to AMM CPI | No | No |
| `swap_sol_pool.rs:235-261,277-313` | Hook accounts forwarded to transfer_t22_checked | No | No (Token-2022 validates) |
| `carnage_execution.rs:422-453` | Partitioned for sell/buy hooks | >= check only | No |
| `execute_carnage_atomic.rs:234` | Forwarded to carnage_core | No | No |
| `execute_carnage.rs:239` | Forwarded to carnage_core | No | No |
| `purchase.rs:214` | Hook accounts | **Yes: len == 4** | No |
| `sell.rs:219` | Hook accounts | **Yes: len == 4** | No |
| `fund_curve.rs:103-118` | Hook accounts | No | No |
| `stake.rs:141` | Hook accounts | No | No |
| `unstake.rs:205` | Hook accounts | No | No |
| `convert.rs:140` | Hook accounts | No | No |

**Assessment:** The bonding curve (purchase.rs, sell.rs) is the ONLY program that validates remaining_accounts length. All other programs forward remaining_accounts without length or content validation. This is acceptable because:
1. Token-2022 validates the ExtraAccountMetaList PDA derivation internally
2. Transfer Hook validates whitelist PDA derivation via `find_program_address`
3. Extra accounts beyond what Token-2022 expects are ignored
4. Missing accounts cause Token-2022 to fail with `AccountNotEnoughKeys`

However, this means the protocol trusts Token-2022 and Transfer Hook to validate accounts that the protocol itself passes. If Token-2022 had a validation bug, forged remaining_accounts could bypass whitelist enforcement.

## Cross-Focus Intersections

### CPI x Access Control
- swap_authority PDA is the cornerstone of access control for AMM
- carnage_signer PDA is the cornerstone of access control for swap_exempt
- All authority PDAs use `seeds::program` validation (strongest pattern)
- No `UncheckedAccount` is used for program accounts in CPI targets (all use `address =` or `Program<>`)

### CPI x Arithmetic
- Slippage floor calculations in execute_carnage_atomic use `checked_mul/div` chains ending in `.unwrap()` -- would panic on-chain if None (HIGH risk, but u128 intermediate prevents overflow in practice)
- Tax amount calculations are done BEFORE CPI in buy path, AFTER CPI in sell path -- this asymmetry is by design but must be verified for correctness

### CPI x Token/Economic
- swap_exempt passes `minimum_output = 0` to AMM, bypassing AMM's slippage protection
- Carnage Fund has separate slippage enforcement (75-85% floor) applied AFTER the swap CPI returns
- Tax distribution (71/24/5 split) is done via 3 separate system_program::transfer CPIs -- if any fails, the entire transaction reverts (atomic, good)

### CPI x State Machine
- consume_randomness modifies EpochState (taxes + carnage_pending) and then CPIs to Staking (update_cumulative)
- State is modified BEFORE the Staking CPI -- if the CPI fails, the entire TX reverts, so CEI ordering is not a concern (atomic)
- However, carnage_pending is set in consume_randomness but acted on in execute_carnage_atomic (separate TX) -- this two-TX pattern has a window where carnage_pending is true but Carnage hasn't executed

## Cross-Reference Handoffs

- -> **Access Control Agent:** Verify that no instruction can call swap_exempt without carnage_signer PDA. Check if force_carnage (devnet-only, feature-gated) has any path to production.
- -> **Account Validation Agent:** `stake_pool` in ConsumeRandomness is `AccountInfo<'info>` with `#[account(mut)]` only. `pool` in SwapSolBuy/SwapSolSell is `AccountInfo<'info>` with `#[account(mut)]` only. Both are validated by downstream CPIs but have defense-in-depth gaps at the calling program level.
- -> **Token/Economic Agent:** swap_exempt uses `minimum_output = 0` for Carnage swaps. Verify the post-swap slippage floor in execute_carnage_core is sufficient to prevent value extraction during Carnage.
- -> **Oracle Agent:** VRF randomness consumption triggers both tax rate update AND Carnage trigger check. The optional carnage_state account means Carnage can be skipped. Verify this is acceptable.
- -> **Error Handling Agent:** All `invoke_signed` calls use `?` for error propagation. No silent error swallowing found. The `let _ = ...` pattern was NOT found in any CPI site (good).
- -> **Arithmetic Agent:** The `.unwrap() as u64` pattern in execute_carnage_atomic.rs lines 255, 272, 284 and execute_carnage.rs line 265 would panic on-chain if the checked chain returns None.

## Risk Observations

1. **Program ID cluster mismatch (Tax -> AMM):** Tax Program's `amm_program_id()` returns `5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR` (the mainnet AMM ID, confirmed in `deployments/mainnet.json`) while AMM's source `declare_id!` is `J7JxmNkzi3it6Q4TNYjTD6mKdgMaD1pxrstn1RnL3bR5` (the devnet AMM ID, confirmed in `deployments/devnet.json` and `Anchor.toml`). The source code is in a mixed-cluster state. The `sync-program-ids.ts` build step resolves all cross-program IDs from keypairs before building, so deployed programs are correctly aligned. However, the source-level mismatch means: (a) a naive build without sync produces incompatible programs; (b) cross-program ID tests in constants.rs may fail if they assert against the wrong cluster's IDs. Impact: deployment process dependency, not a runtime vulnerability when built correctly.

2. **Stale test assertions:** Staking Program's `test_tax_program_id()` asserts against `43fZ...` (mock-tax-program's declare_id) but the function returns `FGgi...` (real tax program). Similarly, `test_staking_program_id()` in Tax Program asserts `12b3...` but staking's `declare_id!` is `DrFg...`. These tests would fail if run, indicating they haven't been run after the latest program ID sync. Impact: test maintenance issue, not runtime.

3. **Optional carnage_state griefing vector:** In consume_randomness, `carnage_state: Option<Account<'info, CarnageFundState>>` means any caller can omit it, causing Carnage trigger logic to be silently skipped. A MEV actor could front-run the legitimate crank's consume_randomness call without carnage_state, causing the epoch to advance without Carnage even when VRF randomness would trigger it. The crank would then fail to retroactively trigger Carnage because consume_randomness only runs once per epoch.

4. **swap_exempt minimum_output=0:** The Carnage swap path bypasses AMM's own slippage protection by passing `minimum_output = 0`. While Epoch Program enforces its own slippage floor (75-85%) AFTER the swap, this means the AMM will execute any swap regardless of price impact. In theory, a sandwich attack within the same transaction could manipulate pool reserves between the Carnage swap and the slippage check. In practice, the VRF-driven timing and atomic execution mitigate this.

5. **No token program ID validation in staking transfer helper:** `staking/src/helpers/transfer.rs:transfer_checked_with_hook` does NOT validate that the token_program is Token-2022 before calling `invoke_signed`. The AMM and conversion vault helpers both have this defense-in-depth check. If a future instruction handler calls this helper with a wrong token program, the CPI would go to an unexpected program. Currently, all callers pass validated `Interface<'info, TokenInterface>` accounts, so this is defense-in-depth only.

## Novel Attack Surface Observations

1. **Cross-program ID constellation fragility:** The protocol has a web of 7+ programs that mutually reference each other's program IDs via hardcoded constants in each program's `constants.rs`. A deployment that updates some programs but not others creates a constellation mismatch where some CPI paths work and others fail. The `sync-program-ids.ts` automation mitigates this but is a single point of failure for deployment correctness. The current source already shows one mismatch (Tax AMM ID vs actual AMM ID).

2. **Byte-offset cross-program reads as a silent corruption vector:** Tax and Epoch programs read AMM PoolState via raw byte offsets (e.g., reserve_a at bytes 137-145). If the AMM program is upgraded and PoolState gains or loses a field before the reserves, the Tax and Epoch programs would silently read incorrect reserve values. This would corrupt tax calculations (output floor computation) and Carnage slippage checks without producing an error. The only protection is the `data.len() >= 153` length check, which wouldn't catch field reordering.

3. **CPI depth limit as an architectural trap:** The 4-level CPI depth limit means the Carnage swap path cannot be modified to add any additional CPI call, even for security purposes (e.g., additional oracle checks, rate limiting, or additional validation). This creates a tension between security improvements and architectural constraints. Post-Agave 3.0 migration (CPI depth limit raised to 8), this constraint is relaxed, but until then, the protocol is locked into its current swap path architecture.

## Questions for Other Focus Areas

- **For Arithmetic focus:** The execute_carnage_atomic/execute_carnage slippage floor uses `.unwrap() as u64` after `checked_mul/div` chain. Can the u128 intermediate overflow for realistic values? What are the bounds on `expected` and `slippage_bps`?
- **For State Machine focus:** Can `carnage_pending = true` persist across multiple epochs if execute_carnage is never called? What happens if consume_randomness is called again while carnage_pending is true?
- **For Access Control focus:** The `force_carnage` instruction is gated by `#[cfg(feature = "devnet")]`. Is there any risk of this feature being accidentally enabled in mainnet builds?
- **For Token/Economic focus:** Tax distribution uses 3 separate system_instruction::transfer CPIs. If the swap_authority PDA runs out of SOL mid-distribution (after closing the WSOL intermediary), which transfers fail?
- **For Timing focus:** The consume_randomness -> execute_carnage_atomic flow is designed to be in the same TX. What happens if they're in separate TXs? Is there a window for manipulation between VRF consumption and Carnage execution?

## Raw Notes

### Program ID Cross-Reference Table (Current Source)

| Program | declare_id! (source) | Cluster | Referenced By | Referenced As | Ref Cluster | Match? |
|---|---|---|---|---|---|---|
| AMM | `J7Jxm...` | devnet | Tax constants | `5JsS...` | mainnet | **CLUSTER MISMATCH** |
| AMM | `J7Jxm...` | devnet | Epoch constants | `J7Jxm...` | devnet | YES |
| AMM | `J7Jxm...` | devnet | AMM constants (TAX_PROGRAM_ID) | `FGgi...` (Tax) | same for both | N/A |
| Tax | `FGgi...` | both | AMM constants | `FGgi...` | both | YES |
| Tax | `FGgi...` | both | Epoch constants | `FGgi...` | both | YES |
| Tax | `FGgi...` | both | Staking constants | `FGgi...` | both | YES |
| Epoch | `E1u6...` | both | Tax constants | `E1u6...` | both | YES |
| Epoch | `E1u6...` | both | Staking constants | `E1u6...` | both | YES |
| Staking | `DrFg...` | devnet | Tax constants | `DrFg...` | devnet | YES |
| Staking | `DrFg...` | devnet | Epoch constants | `DrFg...` | devnet | YES |

Cluster mismatch: Tax Program's `amm_program_id()` references mainnet AMM (`5JsS...`) while other programs reference devnet AMM (`J7Jxm...`). Resolved at build time by `sync-program-ids.ts`.

### Previous Findings Recheck

**H058 (MEDIUM, CPI depth at 4/4 limit, execute_carnage_atomic.rs):** CONFIRMED STILL PRESENT. The CPI depth is still at exactly 4 levels. No changes to the depth chain. The swap path comment at carnage_execution.rs:11-16 explicitly documents this constraint. Severity assessment: MEDIUM is appropriate -- it's a hard architectural constraint, not an exploitable vulnerability, but it prevents security improvements and creates maintenance fragility.

**S006 (CRITICAL, Combined deployment attack, Hook+BC):** Need to recheck. The transfer hook enforces whitelist and the bonding curve uses Token-2022 with hook accounts. The concern was about deploying a malicious hook program alongside a bonding curve. In the current code: (a) Transfer Hook program ID is set in the mint's TransferHook extension at mint creation, not at CPI time. (b) The hook program validates `check_is_transferring` (SECU-01) which prevents direct invocation. (c) Hook program validates mint owner is Token-2022. The combined deployment attack vector depends on controlling the hook program address at mint creation time, which is an initialization concern, not a CPI concern. The hook program's own validation (transferring flag, mint owner check, whitelist PDA derivation) provides defense-in-depth.

### Instruction Discriminator Inventory

| Program | Instruction | Discriminator | Format |
|---|---|---|---|
| AMM | swap_sol_pool | `[0xde, 0x80, 0x1e, 0x7b, 0x55, 0x27, 0x91, 0x8a]` | Precomputed sha256 |
| Tax | swap_exempt | `[0xf4, 0x5f, 0x5a, 0x24, 0x99, 0xa0, 0x37, 0x0c]` | Precomputed sha256 |
| Staking | deposit_rewards | `[52, 249, 112, 72, 206, 161, 196, 1]` | Decimal bytes |
| Staking | update_cumulative | `[0x93, 0x84, 0xdb, 0x65, 0xa5, 0x17, 0x3d, 0x71]` | Precomputed sha256 |
| SPL Token | transfer | `[3]` | Raw byte (hardcoded) |
| SPL Token | approve | `[4]` | Raw byte (hardcoded) |
| SPL Token | burn | `[8]` | Raw byte (hardcoded) |
| SPL Token | close_account | `[9]` | Raw byte (hardcoded) |
| SPL Token | sync_native | `[17]` | Raw byte (hardcoded) |
| SPL Token | InitializeAccount3 | `[18]` | Raw byte (hardcoded) |

The Anchor discriminators are verified by tests in constants.rs. The SPL Token discriminators are raw bytes that match the current SPL Token instruction encoding. If SPL Token were to change its encoding (extremely unlikely), these would break silently.
