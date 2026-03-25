# Audit Codebase Index

> 3-layer search index for security audit agents.
> Generated from all `.rs` files under `programs/` (excluding `target/`).

---

## Summary

| Metric | Value |
|--------|-------|
| Total files | 113 |
| Total LOC | 28,308 |
| Programs | 10 |
| Source files | 90 |
| Test files | 13 |
| Largest file | `bonding_curve/src/math.rs` (1,827 LOC) |
| Largest test | `tax-program/tests/test_swap_sol_sell.rs` (1,539 LOC) |

### File Type Breakdown

| Type | Count | LOC |
|------|-------|-----|
| instruction | 33 | 7,254 |
| helper | 12 | 2,688 |
| state | 14 | 1,278 |
| lib | 10 | 1,349 |
| constants | 6 | 1,244 |
| errors | 7 | 568 |
| events | 6 | 745 |
| mock | 3 | 419 |
| test | 13 | 10,577 |
| mod (re-export) | 9 | 86 |

---

## Program 1: AMM (`programs/amm`)

**Program ID:** `EsbMMZtyK4QuEEETj58GRf2wA5Cq1UK9ZBnnrbg6jyst`
**Purpose:** Constant-product AMM with SOL and PROFIT pools. Reentrancy-guarded swaps with CPI access control via `seeds::program`.

### Source Files

| Path | LOC | Type | Key Exports | Security Markers | Description |
|------|-----|------|-------------|-----------------|-------------|
| `src/lib.rs` | 74 | lib | `initialize_admin`, `initialize_pool`, `swap_sol_pool`, `burn_admin` | access control | Program entrypoint with 4 instructions |
| `src/constants.rs` | 40 | constants | `ADMIN_SEED`, `POOL_SEED`, `VAULT_SEED`, `LP_FEE_BPS`, `SWAP_AUTHORITY_SEED` | -- | PDA seeds and fee config |
| `src/errors.rs` | 107 | errors | `AmmError` (17 variants) | -- | Error codes for pool/swap validation |
| `src/events.rs` | 75 | events | `PoolInitialized`, `SwapEvent`, `AdminBurned` | -- | On-chain event structs |
| `src/instructions/mod.rs` | 9 | mod | re-exports | -- | Module re-exports |
| `src/instructions/initialize_admin.rs` | 59 | instruction | `InitializeAdmin`, `handler` | access control (upgrade authority check) | One-time admin PDA creation with programdata authority gate |
| `src/instructions/initialize_pool.rs` | 285 | instruction | `InitializePool`, `handler` | token transfers, arithmetic | Pool creation with canonical mint ordering, seed transfers, pool type inference |
| `src/instructions/swap_sol_pool.rs` | 429 | instruction | `SwapSolPool`, `handler` | CPI (token transfers), reentrancy guard, k-invariant, `seeds::program` access control, arithmetic, `remaining_accounts` | Core swap with CEI ordering; swap_authority PDA gated by `seeds::program = TAX_PROGRAM_ID` |
| `src/instructions/burn_admin.rs` | 50 | instruction | `BurnAdmin`, `handler` | access control | Permanently remove admin by zeroing AdminConfig |
| `src/helpers/mod.rs` | 2 | mod | re-exports | -- | Module re-exports |
| `src/helpers/math.rs` | 497 | helper | `compute_swap_output`, `compute_swap_input`, proptest suite | arithmetic, proptest (10K iterations) | Pure swap math with k-invariant enforcement and overflow protection |
| `src/helpers/transfers.rs` | 190 | helper | `transfer_in`, `transfer_out` | token transfers, `remaining_accounts`, `invoke_signed`, defense-in-depth token program validation | Manual Token-2022 CPI with hook forwarding via remaining_accounts |
| `src/state/mod.rs` | 5 | mod | re-exports | -- | Module re-exports |
| `src/state/admin.rs` | 18 | state | `AdminConfig` | -- | Global admin PDA with authority pubkey |
| `src/state/pool.rs` | 79 | state | `PoolState`, `PoolType`, `SwapDirection` | reentrancy lock field | Pool state with reserves, fee, reentrancy lock, pool type enum |

### Test Files

| Path | LOC | Description |
|------|-----|-------------|
| `tests/test_cpi_access_control.rs` | 1,310 | LiteSVM tests verifying swap_authority PDA gating rejects fake/wrong programs |
| `tests/test_pool_initialization.rs` | 1,296 | LiteSVM tests for pool creation, canonical ordering, duplicate rejection |
| `tests/test_swap_sol_pool.rs` | 1,345 | LiteSVM tests for swap math, slippage, reentrancy guard, edge cases |
| `tests/test_transfer_routing.rs` | 1,458 | LiteSVM tests for Token vs Token-2022 routing and hook forwarding |

---

## Program 2: Bonding Curve (`programs/bonding_curve`)

**Program ID:** `AGhdAzP6Hcf3hmib79MdFbMMF5xjzTUEShB7hsTa62K1`
**Purpose:** Linear bonding curves for CRIME/FRAUD token price discovery. Dual curves with sell tax, refund mechanism, and graduation to AMM.

### Source Files

| Path | LOC | Type | Key Exports | Security Markers | Description |
|------|-----|------|-------------|-----------------|-------------|
| `src/lib.rs` | 113 | lib | `initialize_curve`, `fund_curve`, `start_curve`, `purchase`, `sell`, `mark_failed`, `prepare_transition`, `distribute_tax_escrow`, `consolidate_for_refund`, `claim_refund`, `withdraw_graduated_sol`, `close_token_vault` | -- | 12 instructions spanning full lifecycle |
| `src/constants.rs` | 177 | constants | `P_START`, `P_END`, `TOTAL_FOR_SALE`, `TARGET_SOL`, `SELL_TAX_BPS`, `DEADLINE_SLOTS`, `FAILURE_GRACE_SLOTS`, `MAX_TOKENS_PER_WALLET`, feature-gated mint functions | feature flags (localnet/devnet) | Curve parameters, enforcement limits, timing constants, PDA seeds |
| `src/error.rs` | 109 | errors | `CurveError` (19 variants) | -- | Error codes for all curve states and validations |
| `src/events.rs` | 184 | events | `CurveInitialized`, `CurveStarted`, `CurveFunded`, `TokensPurchased`, `TokensSold`, `CurveFailed`, `CurveGraduated`, `TaxDistributed`, `RefundClaimed` + more | -- | Events for full lifecycle tracking |
| `src/math.rs` | 1,827 | helper | `calculate_tokens_for_sol`, `calculate_sol_for_tokens`, `price_at` | arithmetic (u128 intermediates, quadratic formula), proptest (13.5M iterations) | Linear curve integral math with exhaustive property-based testing |
| `src/state.rs` | 247 | state | `CurveState`, `CurveStatus`, `Token` | state machine (6 states) | Curve state with status transitions, `is_refund_eligible()` logic |
| `src/instructions/mod.rs` | 47 | mod | re-exports | -- | Module re-exports |
| `src/instructions/initialize_curve.rs` | 120 | instruction | `InitializeCurve`, `handler` | access control, feature-gated mint validation | Create CurveState + vault PDAs with token mint verification |
| `src/instructions/fund_curve.rs` | 126 | instruction | `FundCurve`, `handler` | token transfer (T22), `remaining_accounts`, `invoke` | Transfer 460M tokens to vault with Transfer Hook support |
| `src/instructions/start_curve.rs` | 76 | instruction | `StartCurve`, `handler` | access control, state transition | Activate curve: validates vault funded, sets deadline |
| `src/instructions/purchase.rs` | 310 | instruction | `Purchase`, `handler` | arithmetic (u128), token transfer (T22), wallet cap, deadline check, slippage, partial fill, `remaining_accounts`, `invoke_signed` | Buy tokens from curve; enforces per-wallet cap, minimum purchase, deadline |
| `src/instructions/sell.rs` | 319 | instruction | `Sell`, `handler` | arithmetic, token transfer (T22), 15% tax, solvency assertion, direct lamport manipulation, `remaining_accounts`, `invoke_signed` | Sell tokens back; tax to escrow, solvency check, CEI ordering |
| `src/instructions/mark_failed.rs` | 78 | instruction | `MarkFailed`, `handler` | state transition, permissionless, timing (deadline + grace) | Permissionless: marks curve Failed after deadline |
| `src/instructions/prepare_transition.rs` | 78 | instruction | `PrepareTransition`, `handler` | access control, dual-curve status check | Admin: transitions both curves Filled -> Graduated |
| `src/instructions/distribute_tax_escrow.rs` | 103 | instruction | `DistributeTaxEscrow`, `handler` | cross-program lamport transfer, `UncheckedAccount`, permissionless | Permissionless: sends escrow SOL to epoch program carnage vault |
| `src/instructions/consolidate_for_refund.rs` | 123 | instruction | `ConsolidateForRefund`, `handler` | direct lamport manipulation, permissionless, `UncheckedAccount` | Merge tax escrow into SOL vault for refund eligibility |
| `src/instructions/claim_refund.rs` | 206 | instruction | `ClaimRefund`, `handler` | arithmetic (u128 intermediates), token burn (T22), direct lamport manipulation, `remaining_accounts`, proportional math | All-or-nothing: burn tokens, receive proportional SOL |
| `src/instructions/withdraw_graduated_sol.rs` | 91 | instruction | `WithdrawGraduatedSol`, `handler` | access control, direct lamport manipulation, rent-exempt minimum | Admin: extract SOL from graduated vault |
| `src/instructions/close_token_vault.rs` | 98 | instruction | `CloseTokenVault`, `handler` | access control, zero-balance check, token account close | Admin: close empty token vault, recover rent |

### Test Files

| Path | LOC | Description |
|------|-----|-------------|
| `tests/refund_clock_test.rs` | 1,469 | LiteSVM tests for refund flow including clock manipulation, proportional math |

---

## Program 3: Conversion Vault (`programs/conversion-vault`)

**Program ID:** `6WwVAz5vNYhknSLqVBMwWrFRbcUc4ceXCGmhCUTxGkba` (from deploy)
**Purpose:** 100:1 fixed-rate token conversion (e.g., old token -> new token) with Token-2022 hook support.

### Source Files

| Path | LOC | Type | Key Exports | Security Markers | Description |
|------|-----|------|-------------|-----------------|-------------|
| `src/lib.rs` | 36 | lib | `initialize`, `convert` | -- | 2-instruction program |
| `src/constants.rs` | 54 | constants | `CONVERSION_RATE`, `INPUT_DECIMALS`, `OUTPUT_DECIMALS`, feature-gated mint functions | feature flags | Conversion rate, PDA seeds, feature-gated addresses |
| `src/error.rs` | 22 | errors | `VaultError` (4 variants) | -- | Conversion-specific errors |
| `src/state.rs` | 35 | state | `VaultState` | -- | Vault PDA with authority and token mints |
| `src/instructions/mod.rs` | 5 | mod | re-exports | -- | Module re-exports |
| `src/instructions/initialize.rs` | 99 | instruction | `Initialize`, `handler` | access control | Create vault state + token vaults |
| `src/instructions/convert.rs` | 174 | instruction | `Convert`, `handler` | arithmetic, token transfer (T22), `remaining_accounts` split (burn input / transfer output), `invoke_signed` | Fixed-rate conversion with hook forwarding for both tokens |
| `src/helpers/mod.rs` | 1 | mod | re-exports | -- | Module re-exports |
| `src/helpers/hook_helper.rs` | 90 | helper | `transfer_checked_with_hook` | token transfer (T22), `remaining_accounts`, `invoke_signed` | Manual T22 CPI with hook forwarding |

### Test Files

| Path | LOC | Description |
|------|-----|-------------|
| `tests/test_vault.rs` | 277 | LiteSVM tests for vault initialization and conversion flow |

---

## Program 4: Epoch Program (`programs/epoch-program`)

**Program ID:** `5q1X9zGskp8WxpqHyD32vcXJ7Fy5kYJR2YsM1qFuLSeJ`
**Purpose:** Epoch state machine with Switchboard VRF for randomized tax rates and Carnage Fund buyback-and-burn mechanism.

### Source Files

| Path | LOC | Type | Key Exports | Security Markers | Description |
|------|-----|------|-------------|-----------------|-------------|
| `src/lib.rs` | 265 | lib | `initialize_epoch_state`, `trigger_epoch_transition`, `commit_epoch_vrf`, `reveal_epoch_vrf`, `consume_randomness`, `retry_epoch_vrf`, `initialize_carnage_fund`, `execute_carnage`, `execute_carnage_atomic`, `force_carnage`, `expire_carnage` | -- | 11 instructions for epoch lifecycle |
| `src/constants.rs` | 319 | constants | `EPOCH_DURATION_SLOTS`, `CARNAGE_PROBABILITY`, `VRF_TIMEOUT_SLOTS`, `TRIGGER_BOUNTY_LAMPORTS`, `MINIMUM_CARNAGE_SOL`, feature-gated program IDs, `HOOK_ACCOUNTS_PER_MINT` | feature flags, cross-program seeds | Full config for epoch timing, VRF, carnage, cross-program integration |
| `src/errors.rs` | 140 | errors | `EpochError` (21 variants) | -- | Epoch/VRF/Carnage error codes |
| `src/events.rs` | 187 | events | `EpochTransitioned`, `VrfRequested`, `RandomnessConsumed`, `TaxRatesSet`, `CarnageTriggered`, `CarnageExecuted`, `CarnageExpired` | -- | Events for epoch, VRF, and carnage lifecycle |
| `src/helpers/mod.rs` | 9 | mod | re-exports | -- | Module re-exports |
| `src/helpers/carnage.rs` | 174 | helper | `should_trigger_carnage`, `determine_carnage_action`, `determine_carnage_target`, `CarnageAction`, `CarnageTarget` | VRF byte interpretation | VRF randomness -> carnage trigger/action/target decisions |
| `src/helpers/tax_derivation.rs` | 333 | helper | `derive_tax_rates`, `TaxRates` | arithmetic, VRF byte derivation | Independent per-token buy/sell tax rate derivation from VRF bytes |
| `src/instructions/mod.rs` | 23 | mod | re-exports | -- | Module re-exports |
| `src/instructions/initialize_epoch_state.rs` | 116 | instruction | `InitializeEpochState`, `handler` | access control | Create singleton EpochState PDA |
| `src/instructions/initialize_carnage_fund.rs` | 131 | instruction | `InitializeCarnageFund`, `handler` | access control, token account creation | Create CarnageFundState + WSOL/token vaults |
| `src/instructions/trigger_epoch_transition.rs` | 389 | instruction | `TriggerEpochTransition`, `handler` | permissionless, timing (epoch boundary), VRF randomness freshness, bounty payment, arithmetic, `UncheckedAccount` | Permissionless epoch advancement with VRF request and bounty |
| `src/instructions/consume_randomness.rs` | 420 | instruction | `ConsumeRandomness`, `handler` | VRF verification, anti-reroll, CPI to staking (`update_cumulative`), CPI to staking (`invoke_signed`), tax derivation, carnage trigger, auto-expire stale carnage | Process VRF result: set taxes, check carnage, finalize epoch |
| `src/instructions/retry_epoch_vrf.rs` | 175 | instruction | `RetryEpochVrf`, `handler` | VRF timeout recovery, permissionless | Fresh VRF request after timeout |
| `src/instructions/execute_carnage.rs` | 1,002 | instruction | `ExecuteCarnage`, `handler` | CPI chain (4 levels), token burn (T22), `approve_delegate`, pool reserve reading (raw bytes), slippage (75% floor), `remaining_accounts` partitioning, `invoke_signed`, `UncheckedAccount` | Fallback carnage: burn/sell/buy via Tax::swap_exempt CPI |
| `src/instructions/execute_carnage_atomic.rs` | 1,015 | instruction | `ExecuteCarnageAtomic`, `handler` | CPI chain (4 levels), token burn (T22), `approve_delegate`, pool reserve reading (raw bytes), slippage (85% floor), no-op guard, `remaining_accounts` partitioning, `invoke_signed`, `UncheckedAccount` | Atomic carnage: all-or-nothing rebalancing |
| `src/instructions/force_carnage.rs` | 77 | instruction | `ForceCarnage`, `handler` | access control (admin-only) | Admin: force-trigger carnage for testing |
| `src/instructions/expire_carnage.rs` | 141 | instruction | `ExpireCarnage`, `handler` | permissionless, timing (deadline check) | Permissionless: expire stale carnage after deadline |
| `src/state/mod.rs` | 9 | mod | re-exports | -- | Module re-exports |
| `src/state/epoch_state.rs` | 172 | state | `EpochState` | state machine (VRF pending, carnage pending flags) | Singleton with timing, tax config, VRF state, carnage state |
| `src/state/carnage_fund_state.rs` | 196 | state | `CarnageFundState` | -- | Carnage fund with token holdings and statistics tracking |
| `src/state/enums.rs` | 171 | state | `CheapSide`, `CarnageAction`, `CarnageTarget` | -- | Enum types for epoch decisions |

---

## Program 5: Staking (`programs/staking`)

**Program ID:** `HLVyXH5QophmQsTZfZS1N3ZHP8QQ476k3JsnWvrHacr8`
**Purpose:** PROFIT token staking for pro-rata SOL yield distribution using Synthetix/Quarry cumulative reward-per-token pattern.

### Source Files

| Path | LOC | Type | Key Exports | Security Markers | Description |
|------|-----|------|-------------|-----------------|-------------|
| `src/lib.rs` | 118 | lib | `initialize_stake_pool`, `stake`, `unstake`, `claim`, `deposit_rewards`, `update_cumulative`, `test_deposit_and_distribute` (test-only) | feature flag (`test`) | 6 production + 1 test instruction |
| `src/constants.rs` | 202 | constants | `PRECISION` (1e18), `MINIMUM_STAKE`, `COOLDOWN_SECONDS`, `STAKING_AUTHORITY_SEED`, `TAX_AUTHORITY_SEED`, `DEPOSIT_REWARDS_DISCRIMINATOR`, cross-program IDs | cross-program seeds, discriminator verification tests | Staking config, CPI gating seeds, verified discriminator |
| `src/errors.rs` | 117 | errors | `StakingError` (11 variants) | -- | Validation, auth, arithmetic, state errors |
| `src/events.rs` | 175 | events | `StakePoolInitialized`, `Staked`, `Unstaked`, `Claimed`, `RewardsDeposited`, `CumulativeUpdated`, `EscrowInsufficientAttempt` | -- | Events for all staking operations + anomaly monitoring |
| `src/helpers/mod.rs` | 10 | mod | re-exports | -- | Module re-exports |
| `src/helpers/math.rs` | 735 | helper | `update_rewards`, `add_to_cumulative` | arithmetic (u128, checked ops, PRECISION 1e18), proptest (10K iterations x 8 properties) | Cumulative reward-per-token math with exhaustive fuzzing |
| `src/helpers/transfer.rs` | 90 | helper | `transfer_checked_with_hook` | token transfer (T22), `remaining_accounts`, `invoke_signed` | Manual T22 CPI with hook forwarding |
| `src/instructions/mod.rs` | 28 | mod | re-exports | feature flag (`test`) | Module re-exports with conditional test helpers |
| `src/instructions/initialize_stake_pool.rs` | 156 | instruction | `InitializeStakePool`, `handler` | token transfer (T22), dead stake (first-depositor attack prevention), `remaining_accounts` | Create pool + vaults, deposit MINIMUM_STAKE dead stake |
| `src/instructions/stake.rs` | 165 | instruction | `Stake`, `handler` | token transfer (T22), CEI ordering, `init_if_needed`, checkpoint pattern (update_rewards before balance change), `remaining_accounts` | Stake PROFIT with flash-loan protection |
| `src/instructions/unstake.rs` | 230 | instruction | `Unstake`, `handler` | token transfer (T22), CEI ordering, cooldown gate, reward forfeiture, partial unstake minimum, `remaining_accounts`, `invoke_signed` | Unstake with cooldown, forfeiture to remaining stakers |
| `src/instructions/claim.rs` | 172 | instruction | `Claim`, `handler` | direct lamport manipulation, escrow solvency check, `UncheckedAccount`, cooldown timer set | Claim SOL rewards; emits anomaly event before error |
| `src/instructions/deposit_rewards.rs` | 119 | instruction | `DepositRewards`, `handler` | `seeds::program` access control (Tax Program), escrow balance reconciliation, `UncheckedAccount` | CPI target: Tax Program deposits yield SOL |
| `src/instructions/update_cumulative.rs` | 257 | instruction | `UpdateCumulative`, `handler` | `seeds::program` access control (Epoch Program), arithmetic (u128), double-update prevention | CPI target: Epoch Program finalizes epoch rewards |
| `src/instructions/test_helpers.rs` | 101 | mock | `TestDepositAndDistribute`, `handler` | feature-gated (`test`), CPI (system_program::transfer) | Test-only: bypass CPI gating for unit tests |
| `src/state/mod.rs` | 11 | mod | re-exports | -- | Module re-exports |
| `src/state/stake_pool.rs` | 82 | state | `StakePool` | -- | Global singleton: total_staked, cumulative, pending, analytics |
| `src/state/user_stake.rs` | 87 | state | `UserStake` | -- | Per-user position: balance, checkpoint, earned, cooldown |

---

## Program 6: Tax Program (`programs/tax-program`)

**Program ID:** `Eufdhhek6L1cxrYPvXAgJRVzckuzWVVBLckjNwyggViV`
**Purpose:** Asymmetric swap taxation with atomic 3-way distribution (71% staking, 24% carnage, 5% treasury). Routes swaps through AMM via CPI.

### Source Files

| Path | LOC | Type | Key Exports | Security Markers | Description |
|------|-----|------|-------------|-----------------|-------------|
| `src/lib.rs` | 90 | lib | `swap_sol_buy`, `swap_sol_sell`, `initialize_wsol_intermediary`, `swap_exempt` | -- | 4 instructions |
| `src/constants.rs` | 252 | constants | `SWAP_AUTHORITY_SEED`, `STAKING_BPS`, `CARNAGE_BPS`, `TREASURY_BPS`, `MINIMUM_OUTPUT_FLOOR_BPS`, `DEPOSIT_REWARDS_DISCRIMINATOR`, cross-program IDs, PDA derivation helpers | cross-program seeds, feature flags, discriminator verification | Tax splits, program IDs, PDA derivation functions |
| `src/errors.rs` | 85 | errors | `TaxError` (18 variants) | -- | Swap, tax, slippage, authorization errors |
| `src/events.rs` | 78 | events | `TaxedSwap`, `ExemptSwap`, `PoolType`, `SwapDirection` | -- | Events for taxed and exempt swaps |
| `src/helpers/mod.rs` | 4 | mod | re-exports | -- | Module re-exports |
| `src/helpers/tax_math.rs` | 515 | helper | `calculate_tax`, `split_distribution`, `calculate_output_floor` | arithmetic (u128), proptest (10K iterations x 6 properties) | Pure tax math: BPS calculation, 3-way split, slippage floor |
| `src/helpers/pool_reader.rs` | 58 | helper | `read_pool_reserves` | raw byte reading (AMM PoolState offsets 137-153) | Read AMM pool reserves without crate dependency |
| `src/instructions/mod.rs` | 11 | mod | re-exports | -- | Module re-exports |
| `src/instructions/swap_sol_buy.rs` | 478 | instruction | `SwapSolBuy`, `handler` | CPI (AMM swap, staking deposit_rewards, system transfers x3), `invoke_signed`, EpochState owner check + discriminator validation, `remaining_accounts`, arithmetic, protocol output floor, `UncheckedAccount`, `seeds::program` (staking/epoch) | Buy flow: tax from input, 3-way distribute, AMM CPI |
| `src/instructions/swap_sol_sell.rs` | 632 | instruction | `SwapSolSell`, `handler` | CPI (AMM swap, staking deposit_rewards, system transfers x3, SPL token transfer, close_account, create_account, InitializeAccount3), `invoke_signed`, WSOL intermediary cycle, balance-diff output calculation, `remaining_accounts`, `UncheckedAccount`, `seeds::program` | Sell flow: AMM CPI, tax from output WSOL, close-distribute-reinit intermediary |
| `src/instructions/swap_exempt.rs` | 255 | instruction | `SwapExempt`, `handler` | CPI (AMM swap), `seeds::program` access control (Epoch Program), `remaining_accounts`, `invoke_signed` | Tax-exempt Carnage swap; CPI depth 1 (Epoch->Tax->AMM->T22->Hook = 4 max) |
| `src/instructions/initialize_wsol_intermediary.rs` | 126 | instruction | `InitializeWsolIntermediary`, `handler` | CPI (create_account, InitializeAccount3), `invoke_signed` | One-time setup: WSOL intermediary PDA for sell tax flow |
| `src/state/mod.rs` | 2 | mod | re-exports | -- | Module re-exports |
| `src/state/epoch_state_reader.rs` | 75 | state | `EpochState` (mirror) | cross-program deserialization (must match Epoch Program layout exactly) | Read-only mirror of Epoch Program's EpochState for tax rate lookup |

### Test Files

| Path | LOC | Description |
|------|-----|-------------|
| `tests/test_swap_sol_buy.rs` | 1,394 | LiteSVM tests for buy tax calculation, distribution split, slippage |
| `tests/test_swap_sol_sell.rs` | 1,539 | LiteSVM tests for sell tax on output, WSOL intermediary cycle |
| `tests/test_swap_exempt.rs` | 1,173 | LiteSVM tests for Carnage PDA access control, direct call rejection |
| `tests/test_carnage_signer_pda.rs` | 83 | PDA derivation compatibility tests |

---

## Program 7: Transfer Hook (`programs/transfer-hook`)

**Program ID:** `FnwnSxgieKBYogwD45KbwtpZMWsdzapg3VwkxTqiaihB`
**Purpose:** Token-2022 transfer hook enforcing whitelist-based transfer restrictions. At least one party (source or dest) must be whitelisted.

### Source Files

| Path | LOC | Type | Key Exports | Security Markers | Description |
|------|-----|------|-------------|-----------------|-------------|
| `src/lib.rs` | 109 | lib | `initialize_authority`, `add_whitelist_entry`, `burn_authority`, `initialize_extra_account_meta_list`, `transfer_hook` | SPL discriminator overrides | 5 instructions with SPL Transfer Hook interface compliance |
| `src/errors.rs` | 66 | errors | `TransferHookError` (9 variants) | -- | Whitelist, PDA validation, direct invocation errors |
| `src/events.rs` | 46 | events | `AuthorityBurned`, `AddressWhitelisted`, `ExtraAccountMetaListInitialized` | -- | Audit trail events |
| `src/instructions/mod.rs` | 11 | mod | re-exports | -- | Module re-exports |
| `src/instructions/initialize_authority.rs` | 46 | instruction | `InitializeAuthority`, `handler` | access control (init once) | Create WhitelistAuthority PDA |
| `src/instructions/add_whitelist_entry.rs` | 70 | instruction | `AddWhitelistEntry`, `handler` | access control, authority-burned check, address validation | Add address to whitelist; rejects default/system pubkey |
| `src/instructions/burn_authority.rs` | 65 | instruction | `BurnAuthority`, `handler` | access control, idempotent, irreversible | Permanently burn authority making whitelist immutable |
| `src/instructions/initialize_extra_account_meta_list.rs` | 155 | instruction | `InitializeExtraAccountMetaList`, `handler`, `validate_mint_hook` | T22 extension validation, `ExtraAccountMeta` resolution seeds, CPI (create_account) | Create ExtraAccountMetaList PDA for T22 hook resolution |
| `src/instructions/transfer_hook.rs` | 179 | instruction | `TransferHook`, `handler`, `check_mint_owner`, `check_is_transferring`, `is_whitelisted` | `UncheckedAccount` (3: owner, extra_account_meta_list, whitelist PDAs), T22 transferring flag check, PDA derivation verification, defense-in-depth mint owner check | Core hook: validates whitelist, prevents direct invocation |
| `src/state/mod.rs` | 5 | mod | re-exports | -- | Module re-exports |
| `src/state/whitelist_authority.rs` | 25 | state | `WhitelistAuthority` | `Option<Pubkey>` authority (None = burned) | Global authority with burnable pattern |
| `src/state/whitelist_entry.rs` | 25 | state | `WhitelistEntry` | existence-based PDA pattern | Per-address whitelist entry |

### Test Files

| Path | LOC | Description |
|------|-----|-------------|
| `tests/test_transfer_hook.rs` | 465 | Requirement documentation tests + LiteSVM setup helpers for future integration testing |

---

## Program 8: Fake Tax Program (`programs/fake-tax-program`)

**Program ID:** N/A (test-only)
**Purpose:** Negative testing mock -- used to verify AMM rejects CPI from unauthorized programs.

### Source Files

| Path | LOC | Type | Key Exports | Security Markers | Description |
|------|-----|------|-------------|-----------------|-------------|
| `src/lib.rs` | 101 | mock | `fake_swap` | CPI (raw invoke_signed to AMM), fake swap_authority PDA | Attempts AMM swap with own PDA; must be rejected by AMM's seeds::program |

---

## Program 9: Mock Tax Program (`programs/mock-tax-program`)

**Program ID:** N/A (test-only)
**Purpose:** Positive testing mock -- used to verify AMM accepts CPI from authorized swap_authority.

### Source Files

| Path | LOC | Type | Key Exports | Security Markers | Description |
|------|-----|------|-------------|-----------------|-------------|
| `src/lib.rs` | 117 | mock | `mock_swap` | CPI (raw invoke_signed to AMM), correct swap_authority PDA | Passthrough to AMM swap with proper Tax Program PDA derivation |

---

## Program 10: Stub Staking (`programs/stub-staking`)

**Program ID:** N/A (test-only)
**Purpose:** Minimal staking interface mock for testing Epoch Program's CPI to `update_cumulative`.

### Source Files

| Path | LOC | Type | Key Exports | Security Markers | Description |
|------|-----|------|-------------|-----------------|-------------|
| `src/lib.rs` | 201 | mock | `initialize_stake_pool`, `update_cumulative`, `deposit_rewards` | `seeds::program` access control (epoch_program_id), cross-program PDA verification | Mock staking with real CPI gating for integration tests |
| `src/errors.rs` | 22 | errors | `StubStakingError` (4 variants) | -- | Minimal error set |
| `src/state.rs` | 101 | state | `StakePool` | -- | Simplified pool state matching real staking interface |

---

## Cross-Program Security Map

### CPI Chains (Depth)

| Chain | Max Depth | Notes |
|-------|-----------|-------|
| Tax -> AMM -> T22 -> Hook | 4 | **AT SOLANA LIMIT** -- no more CPI calls allowed |
| Epoch -> Tax -> AMM -> T22 -> Hook | 4 (Tax is CPI depth 1) | Carnage swap path |
| Epoch -> Staking (update_cumulative) | 2 | Via staking_authority PDA |
| Tax -> Staking (deposit_rewards) | 2 | Via tax_authority PDA |
| Bonding Curve -> T22 (transfer) | 2 | Purchase/sell/refund token transfers |

### seeds::program Access Control Matrix

| Target Program | Authorized Caller | PDA Seed | Verification In |
|---------------|-------------------|----------|----------------|
| AMM (swap_sol_pool) | Tax Program | `swap_authority` | `amm/swap_sol_pool.rs` |
| Staking (deposit_rewards) | Tax Program | `tax_authority` | `staking/deposit_rewards.rs` |
| Staking (update_cumulative) | Epoch Program | `staking_authority` | `staking/update_cumulative.rs` |
| Tax (swap_exempt) | Epoch Program | `carnage_signer` | `tax-program/swap_exempt.rs` |

### UncheckedAccount Usage

| File | Account | Justification |
|------|---------|---------------|
| `staking/claim.rs` | `escrow_vault` | SOL-only PDA, validated by seeds |
| `staking/deposit_rewards.rs` | `escrow_vault` | SOL-only PDA, read for balance reconciliation |
| `staking/initialize_stake_pool.rs` | `escrow_vault` | SOL-only PDA, created via init |
| `staking/test_helpers.rs` | `escrow_vault` | SOL-only PDA, receives system transfer |
| `bonding_curve/distribute_tax_escrow.rs` | `tax_escrow`, `carnage_sol_vault` | SOL-only PDAs, lamport manipulation |
| `bonding_curve/consolidate_for_refund.rs` | `tax_escrow` | SOL-only PDA, lamport manipulation |
| `tax-program/swap_sol_buy.rs` | `epoch_state`, `swap_authority`, `tax_authority`, `pool`, `staking_escrow`, `carnage_vault`, `treasury`, `amm_program`, `staking_program` | Validated manually (owner check, discriminator, address constraint, seeds::program) |
| `tax-program/swap_sol_sell.rs` | Same pattern as swap_sol_buy + `wsol_intermediary` | Same validations + PDA seeds |
| `tax-program/swap_exempt.rs` | `swap_authority`, `pool`, `amm_program` | PDA seeds, address constraint |
| `transfer-hook/transfer_hook.rs` | `owner`, `extra_account_meta_list`, `whitelist_source`, `whitelist_destination` | owner validated by T22; others validated by seeds/derivation in handler |
| `epoch-program/execute_carnage*.rs` | Multiple token/vault accounts | Validated via CPI (AMM/Tax programs validate downstream) |
| `epoch-program/trigger_epoch_transition.rs` | `carnage_sol_vault` | SOL-only PDA, seeds validated |

### remaining_accounts Usage

| Program | Instruction | Purpose |
|---------|------------|---------|
| AMM | `swap_sol_pool` | Transfer Hook accounts for T22 transfers |
| Bonding Curve | `fund_curve`, `purchase`, `sell`, `claim_refund` | Transfer Hook accounts for T22 transfers |
| Conversion Vault | `convert` | Transfer Hook accounts (split between burn input + transfer output) |
| Staking | `initialize_stake_pool`, `stake`, `unstake` | Transfer Hook accounts for PROFIT transfers |
| Tax Program | `swap_sol_buy`, `swap_sol_sell`, `swap_exempt` | Forwarded to AMM CPI for T22 hook resolution |
| Epoch Program | `execute_carnage`, `execute_carnage_atomic` | Partitioned per mint (HOOK_ACCOUNTS_PER_MINT=4) for dual-pool operations |
