---
doc_id: error-handling-playbook
title: "Dr. Fraudsworth's Finance Factory -- Error Handling Playbook"
wave: 3
requires: [cpi-interface-contract]
provides: [error-handling-playbook]
status: draft
decisions_referenced: [error-handling, cpi-architecture, security]
needs_verification:
  - "VARIANT_COUNT: Decisions file states 94 total variants (AMM:18, Tax:19, Staking:11, Hook:14, Epoch:29, Stub:3). Actual codebase count is 92 (AMM:18, Tax:18, Epoch:32, Staking:11, Hook:10, Stub:3). Tax is 18 not 19; Hook is 10 not 14; Epoch is 32 not 29. Net total differs by 2. Verify whether variants were added/removed after the decisions interview."
  - "FRONTEND_MAP_STALE: app/lib/swap/error-map.ts Tax section covers codes 6000-6013 (14 variants) but Tax Program now has 18 variants (6000-6017). Codes 6014-6017 (InvalidAmmProgram, InvalidStakingProgram, InsufficientOutput, MinimumOutputFloorViolation) are unmapped. The last two are user-facing sell errors."
---

# Error Handling Playbook

## Philosophy

Error handling in Dr. Fraudsworth follows a **distributed, defense-in-depth** pattern governed by three principles:

1. **Each program's `errors.rs` is the canonical source of truth.** There is no single on-chain error catalog. Programs are immutable post-authority-burn, so error variants are frozen forever once deployed. This playbook is the synthesized cross-program view (Decision D1).

2. **CPI errors propagate raw -- no wrapping.** When the AMM returns `AmmError::SlippageExceeded` through a Tax Program CPI call, the client receives the original AMM error code with the AMM program ID. No intermediate program re-wraps or translates (Decision D2). This keeps on-chain logic simple and lets the client-side mapping layer evolve independently.

3. **User-facing translation happens exclusively off-chain.** The frontend's `parseSwapError()` and `parseStakingError()` functions detect the originating program (by program ID in the error string) and map error codes to human-readable messages. Epoch and Hook errors use a generic fallback since they should never reach end users (Decision D3).

### Defense-in-Depth Layers

Critical protections are enforced at multiple independent levels:

| Protection | Layer 1 | Layer 2 | Layer 3 |
|---|---|---|---|
| Zero-amount swap | `AmmError::ZeroAmount` (AMM) | `TaxError::InsufficientInput` (Tax after tax deduction) | `AmmError::ZeroEffectiveInput` (fee deduction) |
| Pool draining | CPMM formula (output < reserve always) | `AmmError::KInvariantViolation` (k-check) | Proptest 10,000 iterations |
| Unauthorized swap | `AmmError::InvalidSwapAuthority` (PDA gate) | `TaxError::InvalidSwapAuthority` (derivation check) | Anchor `has_one` constraints |
| Staking epoch race | Checkpoint pattern (no epoch reads) | `StakingError::AlreadyUpdated` (anti-replay) | Dead stake ensures `total_staked > 0` |

---

## Error Categories

Every error variant falls into exactly one of four categories:

| Category | Who sees it | When it triggers | Action |
|---|---|---|---|
| **User-Facing** | End users via wallet UI | During swap or staking operations | Parsed by `parseSwapError` / `parseStakingError` into friendly message |
| **Crank-Only** | Crank bot operator | During VRF flow, Carnage execution, epoch transitions | Logged by crank; may require operator intervention |
| **Initialization** | Deployer/admin only | During one-time pool/program setup | Fix configuration and retry; happens once per deployment |
| **Defense-in-Depth** | Should never be seen | Bug in program logic or active attack | Investigate immediately; indicates invariant violation |

---

## Error Catalog

All error codes use Anchor's auto-assignment: **`6000 + enum_variant_index`**. Programs are disambiguated by their program ID in the transaction error context. Two programs can both emit code `6000` -- the program ID tells you which error it is.

### Hex Conversion Reference

| Decimal | Hex | Decimal | Hex | Decimal | Hex |
|---|---|---|---|---|---|
| 6000 | `0x1770` | 6010 | `0x177A` | 6020 | `0x1784` |
| 6001 | `0x1771` | 6011 | `0x177B` | 6021 | `0x1785` |
| 6002 | `0x1772` | 6012 | `0x177C` | 6022 | `0x1786` |
| 6003 | `0x1773` | 6013 | `0x177D` | 6023 | `0x1787` |
| 6004 | `0x1774` | 6014 | `0x177E` | 6024 | `0x1788` |
| 6005 | `0x1775` | 6015 | `0x177F` | 6025 | `0x1789` |
| 6006 | `0x1776` | 6016 | `0x1780` | 6026 | `0x178A` |
| 6007 | `0x1777` | 6017 | `0x1781` | 6027 | `0x178B` |
| 6008 | `0x1778` | 6018 | `0x1782` | 6028 | `0x178C` |
| 6009 | `0x1779` | 6019 | `0x1783` | 6029 | `0x178D` |
|       |          |       |          | 6030 | `0x178E` |
|       |          |       |          | 6031 | `0x178F` |

---

### AMM Errors

**Program ID:** `5ANTHFtgPgH1fUMywALtrpmT7uMHfWnFbz7hxY3tLzMj`
**Source:** `programs/amm/src/errors.rs`
**Variants:** 18 (codes 6000--6017)

#### User-Facing (swap path)

| Code | Name | Trigger | User Message | Recovery |
|---|---|---|---|---|
| 6000 | `Overflow` | Swap math `checked_mul`/`checked_add` returns `None`. Extremely large input amounts. | "Swap calculation overflow. Try a smaller amount." | Reduce input amount |
| 6008 | `ZeroAmount` | `amount_in == 0` passed to swap or transfer helper | "Transfer amount must be greater than zero." | Enter a nonzero amount |
| 6009 | `SlippageExceeded` | Computed output < `minimum_amount_out`. Price moved between quote and execution. | "Price moved beyond your slippage tolerance. Try increasing slippage or reducing the swap size." | Increase slippage tolerance or reduce size |
| 6014 | `ZeroEffectiveInput` | Input so small that LP fee deduction produces zero effective input. | "The swap amount is too small -- fees would consume the entire input." | Increase input amount above fee threshold |
| 6015 | `ZeroSwapOutput` | Effective input too small relative to reserves to produce any output tokens (dust). | "The swap amount is too small to produce any output tokens." | Increase input amount |

#### Initialization (one-time)

| Code | Name | Trigger | Recovery |
|---|---|---|---|
| 6002 | `PoolAlreadyInitialized` | `initialize_pool` called on a pool PDA that already has liquidity. | No action needed -- pool exists. |
| 6003 | `MintsNotCanonicallyOrdered` | Mints passed to `initialize_pool` in wrong order (`mint_a >= mint_b` by pubkey). | Swap the mint order so `mint_a < mint_b`. |
| 6005 | `InvalidTokenProgram` | Token program account doesn't match the on-chain owner of its corresponding mint. | Pass the correct token program (SPL Token for WSOL, Token-2022 for CRIME/FRAUD). |
| 6006 | `ZeroSeedAmount` | `amount_a == 0` or `amount_b == 0` in `initialize_pool`. | Provide nonzero seed liquidity on both sides. |
| 6007 | `DuplicateMints` | `mint_a == mint_b` in `initialize_pool`. | Use two different mints. |
| 6017 | `LpFeeExceedsMax` | Admin attempts to set LP fee > 500 bps (5%). | Set fee to 500 bps or below. |

#### Defense-in-Depth (should never happen)

| Code | Name | Trigger | Investigation |
|---|---|---|---|
| 6001 | `KInvariantViolation` | `k_after < k_before` after swap. The constant-product invariant decreased. | **Critical bug.** Swap math is broken. Halt operations and audit `swap_math.rs`. |
| 6004 | `Unauthorized` | Signer is not the admin stored in `AdminConfig`. | Verify the correct admin keypair is being used. |
| 6010 | `PoolNotInitialized` | Swap attempted on uninitialized pool (reserves are zero). | Initialize the pool first. If pool should exist, check PDA derivation. |
| 6011 | `PoolLocked` | Reentrancy guard is active -- a swap is already in progress on this pool. | Solana serializes same-account writes within a slot. This should only trigger from a reentrancy attack. Investigate. |
| 6012 | `VaultMismatch` | Vault account key doesn't match `pool.vault_a` or `pool.vault_b`. | **Possible attack.** Someone substituted a fake vault. Investigate the transaction sender. |
| 6013 | `InvalidMint` | Mint key doesn't match `pool.mint_a` or `pool.mint_b`. | **Possible attack.** Wrong mint passed to swap. Investigate. |
| 6016 | `InvalidSwapAuthority` | Swap called without valid `swap_authority` PDA signed by Tax Program. | Direct AMM call attempted (bypassing Tax). Protocol requires all swaps through Tax Program. |

---

### Tax Program Errors

**Program ID:** `DRjNCjt4tfTisSJXD1VrAduKbgA7KHuGPoYwxrUQN8uj`
**Source:** `programs/tax-program/src/errors.rs`
**Variants:** 18 (codes 6000--6017)

<!-- RECONCILIATION_FLAG: Decisions file states Tax has 19 variants but actual errors.rs has 18. Counted from InvalidPoolType(0) through MinimumOutputFloorViolation(17). Verify if a variant was removed post-interview. -->

#### User-Facing (swap path)

| Code | Name | Trigger | User Message | Recovery |
|---|---|---|---|---|
| 6002 | `SlippageExceeded` | Net output after tax < `minimum_amount_out`. | "Price moved beyond your slippage tolerance. Try increasing slippage or reducing the swap size." | Increase slippage or reduce swap size |
| 6004 | `InsufficientInput` | `sol_to_swap == 0` after setup -- amount too small for any swap. | "The swap amount is too small to produce any output after fees." | Increase input amount |
| 6005 | `OutputBelowMinimum` | Net output after tax deduction is below user's minimum. | "Output amount is below the minimum after tax. Try increasing the swap size." | Increase swap size or slippage |
| 6009 | `InvalidTokenOwner` | Token account owner doesn't match the expected user pubkey. | "Token account ownership error. Make sure you have the correct token account." | Use the correct token account for your wallet |
| 6016 | `InsufficientOutput` | Tax amount >= gross swap output. Sell amount so small that tax consumes everything. | "Tax exceeds gross output -- sell amount too small." | Increase sell amount above the tax threshold |
| 6017 | `MinimumOutputFloorViolation` | User's `minimum_amount_out` is below the 50% protocol floor (SEC-10 anti-sandwich). | "Minimum output below protocol floor (50% of expected)." | Set `minimum_amount_out` to at least 50% of constant-product expected output |

<!-- RECONCILIATION_FLAG: Frontend error-map.ts covers Tax codes 6000-6013 only. Codes 6014-6017 (InvalidAmmProgram, InvalidStakingProgram, InsufficientOutput, MinimumOutputFloorViolation) are NOT in the frontend map. The last two (6016, 6017) are user-facing sell errors that will fall through to the generic "Swap failed" fallback. -->

#### Crank-Only (Carnage path)

| Code | Name | Trigger | Recovery |
|---|---|---|---|
| 6010 | `UnauthorizedCarnageCall` | `swap_exempt` instruction called by a signer that isn't the CarnageSigner PDA. | Only the Epoch Program's CarnageSigner PDA can call this. Verify crank is using the correct instruction path. |

#### Initialization / Configuration

| Code | Name | Trigger | Recovery |
|---|---|---|---|
| 6000 | `InvalidPoolType` | Wrong pool type passed to an instruction. | Use the correct pool type for the instruction variant. *Historical note: previously applied to PROFIT pool type selection; PROFIT pools have been replaced by the Conversion Vault.* |
| 6003 | `InvalidEpochState` | EpochState account is invalid or cannot be read for tax rates. | Ensure Epoch Program is initialized and the correct EpochState PDA is passed. |

#### Defense-in-Depth

| Code | Name | Trigger | Investigation |
|---|---|---|---|
| 6001 | `TaxOverflow` | `checked_mul`/`checked_add` overflow during tax split calculation. | Should not happen with valid token amounts. Investigate if triggered -- possible u64 boundary issue. |
| 6006 | `InvalidSwapAuthority` | SwapAuthority PDA derivation doesn't match. | PDA derivation bug or attack attempt. Verify `seeds::program` in Tax vs AMM. |
| 6007 | `WsolProgramMismatch` | Token program for WSOL operations isn't SPL Token (`TokenkegQEcnQ...`). | Verify correct token program is passed. WSOL uses legacy SPL Token, not Token-2022. |
| 6008 | `Token2022ProgramMismatch` | Token program for CRIME/FRAUD isn't Token-2022 (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`). | Verify correct token program is passed. PROFIT uses Token-2022 but is handled via the Conversion Vault, not direct swaps. |
| 6011 | `InvalidStakingEscrow` | Staking escrow PDA doesn't match expected derivation. | Verify PDA seeds match staking program's derivation. |
| 6012 | `InvalidCarnageVault` | Carnage vault PDA doesn't match expected derivation. | Verify Carnage fund initialization. |
| 6013 | `InvalidTreasury` | Treasury address doesn't match the hardcoded/stored pubkey. | Use the correct treasury address. |
| 6014 | `InvalidAmmProgram` | AMM program account doesn't match expected program ID (`5ANTHFtg...`). | Possible program substitution attack. Investigate. |
| 6015 | `InvalidStakingProgram` | Staking program account doesn't match expected program ID (`EZFeU613...`). | Possible program substitution attack. Investigate. |

---

### Epoch Program Errors

**Program ID:** `G6dmJTdC36VRqqi57QhWH444Ju7ieCzHZW9yhH7TpUhz`
**Source:** `programs/epoch-program/src/errors.rs`
**Variants:** 32 (codes 6000--6031)

<!-- RECONCILIATION_FLAG: Decisions file states Epoch has 29 variants. Actual errors.rs has 32 (0-31). Three additional variants (CarnageSlippageExceeded, InvalidTaxProgram, InvalidAmmProgram) may have been added after the interview. -->

All Epoch errors are **crank-only** -- end users never interact with the Epoch Program directly. The frontend uses a generic fallback for any unrecognized error (Decision D3).

#### VRF Flow Errors

| Code | Name | Trigger | Recovery |
|---|---|---|---|
| 6003 | `EpochBoundaryNotReached` | `advance_epoch` called before current slot crosses the epoch boundary. | Wait for the epoch boundary slot, then retry. Crank should poll slot height. |
| 6004 | `VrfAlreadyPending` | `advance_epoch` called when a VRF request is already in flight. | Wait for the pending VRF to resolve (commit + reveal + consume), or wait for VRF timeout (300 slots) then use `retry_epoch_vrf`. |
| 6005 | `NoVrfPending` | `commit_epoch_vrf` / `reveal_epoch_vrf` / `consume_epoch_vrf` called when no VRF request is pending. | Call `advance_epoch` first to create a VRF request. |
| 6006 | `RandomnessParseError` | Switchboard randomness account data could not be deserialized. | Randomness account may be corrupted or using an unexpected format. Create fresh randomness and retry via `retry_epoch_vrf`. |
| 6007 | `RandomnessExpired` | Randomness account's `seed_slot` is too old (stale). | Create fresh randomness account and start the VRF flow again. |
| 6008 | `RandomnessAlreadyRevealed` | `commit_epoch_vrf` called on randomness that was already revealed. | Create fresh randomness account. Cannot commit after revelation. |
| 6009 | `RandomnessAccountMismatch` | Randomness account key doesn't match the one stored in `epoch_state.vrf_randomness`. | Pass the correct randomness account that was committed during `advance_epoch`. |
| 6010 | `RandomnessNotRevealed` | `consume_epoch_vrf` called before the oracle has revealed the randomness. | Wait for the Switchboard oracle to process the request. Typically 1-4 slots. |
| 6011 | `InsufficientRandomness` | Randomness revealed but contains fewer than 8 bytes. | Oracle malfunction. Wait for timeout (300 slots), then `retry_epoch_vrf` with fresh randomness. |
| 6012 | `VrfTimeoutNotElapsed` | `retry_epoch_vrf` called before 300 slots have elapsed since the original request. | Wait for `VRF_TIMEOUT_SLOTS` (300) to elapse. At ~400ms/slot, that's ~2 minutes. |
| 6025 | `InvalidRandomnessOwner` | Randomness account not owned by the Switchboard program. | Pass a valid Switchboard randomness account. |

#### Carnage Execution Errors

| Code | Name | Trigger | Recovery |
|---|---|---|---|
| 6013 | `NoCarnagePending` | `execute_carnage_atomic` called when `epoch_state.carnage_pending == false`. | Carnage is only pending after VRF consumption determines a Carnage epoch. Wait for next Carnage trigger. |
| 6014 | `CarnageDeadlineExpired` | `execute_carnage_atomic` called after the Carnage execution deadline (300 slots). | Call `expire_carnage` instead to clean up, then advance to the next epoch. |
| 6015 | `CarnageDeadlineNotExpired` | `expire_carnage` called before the deadline has passed. | Wait for 300 slots to elapse, then call `expire_carnage`. Or execute Carnage within the window. |
| 6016 | `CarnageLockActive` | User swap attempted during the Carnage lock window (atomic-only period). | Wait for Carnage execution or expiry. User swaps are blocked during the lock window. |
| 6017 | `InvalidCarnageTargetPool` | Carnage target pool doesn't match the one selected by VRF. | Pass the correct pool accounts matching the VRF-determined target (CRIME or FRAUD). |
| 6020 | `InsufficientCarnageSol` | Carnage SOL vault balance is zero or insufficient. **Note: this error is defined but intentionally NOT raised in current code.** Empty-vault Carnage is a graceful no-op (Decision D8). | No action needed. Vault refills from tax fees over subsequent epochs. |
| 6021 | `CarnageSwapFailed` | CPI to Tax Program's `swap_exempt` failed during Carnage buy step. | Check inner error for root cause (likely AMM error propagating through). |
| 6022 | `CarnageBurnFailed` | Token burn CPI failed during Carnage burn step. | Check inner error. Likely insufficient token balance in the burn source account. |
| 6029 | `CarnageSlippageExceeded` | Carnage swap received too few tokens -- below the minimum output floor. | Pool price may have moved significantly. Retry in the next slot or investigate pool manipulation. |

#### Carnage Fund Management

| Code | Name | Trigger | Recovery |
|---|---|---|---|
| 6018 | `CarnageNotInitialized` | Carnage fund operations on uninitialized Carnage state. | Run `initialize_carnage` first. |
| 6019 | `CarnageAlreadyInitialized` | `initialize_carnage` called when Carnage state already exists. | No action -- already initialized. |
| 6026 | `InvalidCarnageWsolOwner` | Carnage WSOL token account not owned by the CarnageSigner PDA. | Verify WSOL account derivation. Should be an ATA of CarnageSigner. |

#### Initialization

| Code | Name | Trigger | Recovery |
|---|---|---|---|
| 6000 | `AlreadyInitialized` | `initialize_epoch_state` called when epoch state PDA already exists. | No action -- already initialized. |
| 6001 | `NotInitialized` | Epoch operations on uninitialized epoch state. | Run `initialize_epoch_state` first. |

#### Arithmetic / Validation

| Code | Name | Trigger | Recovery |
|---|---|---|---|
| 6002 | `InvalidEpochState` | Epoch state data is corrupted or unexpected. | Re-derive PDA and check account. If corrupted, this is a critical issue. |
| 6023 | `Overflow` | Arithmetic overflow in epoch calculations. | Should not occur with valid parameters. Investigate. |
| 6024 | `InsufficientTreasuryBalance` | Treasury lacks sufficient SOL for the crank bounty payment. | Top up the treasury. Bounty is skipped gracefully if insufficient (no deadlock). |

#### Program Validation (Defense-in-Depth)

| Code | Name | Trigger | Investigation |
|---|---|---|---|
| 6027 | `InvalidStakingProgram` | Staking program ID doesn't match expected. | Possible program substitution attack. |
| 6028 | `InvalidMint` | Mint account doesn't match expected vault mint. | Possible mint substitution attack. |
| 6030 | `InvalidTaxProgram` | Tax program ID doesn't match expected. | Possible program substitution attack. |
| 6031 | `InvalidAmmProgram` | AMM program ID doesn't match expected. | Possible program substitution attack. |

---

### Staking Errors

**Program ID:** `EZFeU613CfqzNcEumE293QDmimRHyP2ZNWcbTgCQRZSu`
**Source:** `programs/staking/src/errors.rs`
**Variants:** 11 (codes 6000--6010)

#### User-Facing (stake/unstake/claim)

| Code | Name | Trigger | User Message | Recovery |
|---|---|---|---|---|
| 6000 | `ZeroAmount` | `amount == 0` passed to stake, unstake, or deposit_rewards. | "Amount must be greater than zero." | Enter a nonzero amount |
| 6001 | `InsufficientBalance` | Unstake amount exceeds user's `staked_balance`. | "You don't have enough PROFIT staked to unstake this amount." | Reduce unstake amount to at most your staked balance |
| 6003 | `NothingToClaim` | Claim called when `rewards_earned == 0`. | "No rewards available to claim." | Wait for the next epoch's reward distribution |

#### Defense-in-Depth

| Code | Name | Trigger | Investigation |
|---|---|---|---|
| 6002 | `InsufficientEscrowBalance` | Escrow vault has fewer lamports than `pool.pending_rewards`. | Should never happen if `deposit_rewards` and transfers are correct. Indicates a token accounting bug or rent-exempt balance issue. |
| 6004 | `Unauthorized` | Signer doesn't own the `UserStake` PDA being operated on. | Someone attempted to claim/unstake another user's position. |
| 6005 | `Overflow` | `checked_add` or `checked_mul` returned `None` in reward calculation. | Investigate -- u128 math has 35x headroom over 10-year worst case. |
| 6006 | `Underflow` | `checked_sub` returned `None`. | Investigate -- indicates balance accounting bug. |
| 6007 | `DivisionByZero` | `checked_div` returned `None` (total_staked == 0). | Should be prevented by dead stake (1 PROFIT minimum at init). If triggered, the dead stake invariant was violated. |

#### State Management (Crank-Only)

| Code | Name | Trigger | Recovery |
|---|---|---|---|
| 6008 | `AlreadyUpdated` | `update_cumulative` called with `epoch <= last_update_epoch`. | Epoch already finalized. This is idempotency protection -- skip and proceed to next epoch. |
| 6009 | `NotInitialized` | Operations on uninitialized `StakePool`. | Run `initialize_stake_pool` first. |
| 6010 | `AlreadyInitialized` | `initialize_stake_pool` called twice. | No action -- pool already exists. |

#### Cooldown Enforcement

| Code | Name | Trigger | Recovery |
|---|---|---|---|
| 6011 | `CooldownActive` | Unstake called when `now - last_claim_ts < COOLDOWN_SECONDS` (43,200 = 12 hours). | Wait until 12 hours have passed since your last claim. Users who have never claimed (`last_claim_ts == 0`) are not affected. |

---

### Transfer Hook Errors

**Program ID:** `CmNyuLdMeggHS2dKBhzPWHdeTEcpKg4uTevT5tBcBsce`
**Source:** `programs/transfer-hook/src/errors.rs`
**Variants:** 10 (codes 6000--6009)

<!-- RECONCILIATION_FLAG: Decisions file states Hook has 14 variants. Actual errors.rs has 10 (0-9). Either 4 variants were removed post-interview or the count was incorrect. -->

Transfer Hook errors should **never reach end users** in normal operation. The whitelist is configured during pool initialization, and only protocol-controlled accounts interact with the hook. No frontend error map exists for Hook errors (Decision D3).

#### Transfer Validation (invoked by Token-2022 during `transfer_checked`)

| Code | Name | Trigger | Investigation |
|---|---|---|---|
| 6000 | `NoWhitelistedParty` | Neither source nor destination token account has a whitelist entry PDA. | Transfer attempted between two non-whitelisted accounts. Only protocol PDAs (pool vaults, escrows, user ATAs during swap) should participate. Check if a new account needs whitelisting. |
| 6001 | `ZeroAmountTransfer` | `amount == 0` in a transfer_checked call. | Client bug sending zero-amount transfer. |

#### Authority / Whitelist Management (admin)

| Code | Name | Trigger | Recovery |
|---|---|---|---|
| 6002 | `Unauthorized` | Signer is not the stored whitelist authority. | Use the correct authority keypair. |
| 6003 | `AuthorityAlreadyBurned` | Whitelist modification attempted after authority was permanently burned. | Cannot modify whitelist after burn. This is by design -- whitelist is immutable post-burn. |
| 6004 | `AlreadyWhitelisted` | Address already has a whitelist entry PDA. | No action needed -- address is already whitelisted. |

#### PDA / Program Validation (Defense-in-Depth)

| Code | Name | Trigger | Investigation |
|---|---|---|---|
| 6005 | `InvalidWhitelistPDA` | Whitelist PDA passed doesn't match expected derivation for the given address. | Fake PDA substitution attack. Investigate the transaction sender. |
| 6006 | `DirectInvocationNotAllowed` | Hook invoked directly, not through Token-2022's `transfer_checked`. | Security violation -- hooks must only be called by Token-2022 during transfer. Direct calls are blocked. |
| 6007 | `InvalidMint` | Mint not owned by Token-2022 program. | Defense-in-depth check. The mint passed is not a valid Token-2022 mint. |
| 6008 | `InvalidTransferHook` | Mint's transfer hook extension doesn't point to this hook program. | ExtraAccountMetaList creation attempted for a mint that uses a different (or no) hook. |
| 6009 | `NotToken2022Mint` | Mint is not owned by Token-2022. | ExtraAccountMetaList can only be created for Token-2022 mints with transfer hook extension. |

---

### Conversion Vault Errors

**Program ID:** `6WwVAc12B5x8gukgNyXa4agUyvi9PxdYTdPdnb9qEWFL`
**Source:** `programs/conversion-vault/src/error.rs`
**Variants:** 6 (codes 6000--6005)

The Conversion Vault replaces the former PROFIT AMM pools with a fixed-rate 100:1 conversion between CRIME/FRAUD and PROFIT. It is a leaf-node program (calls only Token-2022, receives no CPIs).

#### User-Facing (convert path)

| Code | Name | Trigger | User Message | Recovery |
|---|---|---|---|---|
| 6000 | `ZeroAmount` | `amount_in == 0` passed to convert. | "Conversion amount must be greater than zero." | Enter a nonzero amount |
| 6001 | `OutputTooSmall` | Input amount so small that the 100:1 conversion rounds output to zero. | "The conversion amount is too small to produce any output tokens." | Increase input amount (minimum 100 CRIME/FRAUD for 1 PROFIT, or 1 PROFIT for 100 CRIME/FRAUD) |
| 6002 | `InvalidMintPair` | Mints passed are not a valid CRIME/FRAUD <-> PROFIT pair. | "Invalid token pair for conversion." | Use CRIME->PROFIT, FRAUD->PROFIT, PROFIT->CRIME, or PROFIT->FRAUD |
| 6003 | `SameMint` | Input and output mints are identical. | "Input and output tokens must be different." | Select different input and output tokens |

#### Defense-in-Depth

| Code | Name | Trigger | Investigation |
|---|---|---|---|
| 6004 | `InvalidTokenProgram` | Token program is not Token-2022. | All vault mints are Token-2022. Possible account substitution. |
| 6005 | `MathOverflow` | Arithmetic overflow in conversion calculation. | Should not occur with valid token amounts (u64 range). Investigate if triggered. |

---

### Bonding Curve Errors

**Program ID:** `AGhdAyBgfpNhZ3jzQR4D2pH7BTxsiGTcJRYWqsn7cGsL`
**Source:** `programs/bonding_curve/src/error.rs`
**Variants:** 24 (codes 6000--6023)

The Bonding Curve program handles the initial token launch. These errors are relevant during the launch phase only. After graduation, the program is effectively inactive.

#### User-Facing (purchase/sell/refund)

| Code | Name | Trigger | User Message | Recovery |
|---|---|---|---|---|
| 6002 | `CurveNotActive` | Purchase attempted when curve is not Active | "Curve is not active for purchases." | Wait for curve activation |
| 6003 | `CurveNotActiveForSell` | Sell attempted when curve is Filled/Failed/Graduated | "Curve is not active for sells." | Cannot sell in current state |
| 6004 | `DeadlinePassed` | Buy/sell after 48-hour deadline | "Curve deadline has passed." | Wait for mark_failed, then claim refund |
| 6005 | `BelowMinimum` | SOL amount below 0.05 SOL minimum | "Purchase amount is below minimum (0.05 SOL)." | Increase purchase amount |
| 6006 | `WalletCapExceeded` | Would exceed 20M token per-wallet cap | "Purchase would exceed per-wallet cap of 20M tokens." | Reduce purchase or sell some tokens first |
| 6007 | `SlippageExceeded` | Sell output below minimum_sol_out | "Slippage exceeded -- output below minimum specified." | Increase slippage tolerance |
| 6010 | `ZeroAmount` | Zero token amount for sell | "Token amount must be greater than zero." | Enter nonzero amount |
| 6011 | `InsufficientTokenBalance` | Sell amount exceeds ATA balance | "Insufficient token balance for sell." | Reduce sell amount |
| 6014 | `NotRefundEligible` | Refund attempted on non-eligible curve | "Curve is not eligible for refunds." | Wait for mark_failed |
| 6020 | `NothingToBurn` | Refund with zero token balance | "No tokens to burn -- user balance is zero." | Must hold tokens to claim refund |

#### Admin/Initialization

| Code | Name | Trigger | Recovery |
|---|---|---|---|
| 6000 | `Unauthorized` | Caller is not the admin in BcAdminConfig | Use correct admin keypair |
| 6008 | `InvalidStatus` | Operation incompatible with current curve status | Check curve status before calling |
| 6009 | `CurveNotFunded` | start_curve before fund_curve | Call fund_curve first |
| 6015 | `CurveAlreadyFilled` | Curve already at target | No action needed |
| 6017 | `DeadlineNotPassed` | mark_failed before deadline + grace period | Wait for deadline + 150 slots grace |
| 6018 | `CurveNotGraduated` | distribute_tax_escrow before graduation | Wait for graduation |
| 6019 | `CRIMECurveNotFilled` | prepare_transition when CRIME not filled | Wait for CRIME curve to fill |
| 6020 | `FRAUDCurveNotFilled` | prepare_transition when FRAUD not filled | Wait for FRAUD curve to fill |
| 6021 | `NoTokensOutstanding` | Division by zero guard for refund calc | Should not occur with valid state |

#### Defense-in-Depth

| Code | Name | Trigger | Investigation |
|---|---|---|---|
| 6001 | `Overflow` | Arithmetic overflow in curve math | Investigate -- possible u128 boundary issue |
| 6012 | `EscrowNotConsolidated` | claim_refund before consolidate_for_refund | Call consolidate_for_refund first |
| 6013 | `EscrowAlreadyConsolidated` | Double consolidation attempt | Already consolidated -- proceed to refunds |
| 6016 | `InsufficientTokensOut` | Dust buy producing zero tokens | Increase purchase amount |
| 6022 | `PartialFillOvercharge` | Partial fill recalc exceeds input (Phase 79 FIN-04) | **Critical bug** if triggered. Investigate math. |
| 6023 | `InvalidPartnerCurve` | Partner curve token_mint mismatch (Phase 79 FIN-05) | **Possible attack.** Wrong partner curve passed. |
| -- | `InvalidHookAccounts` | remaining_accounts != 4 (Phase 80 DEF-05) | Wrong number of hook accounts passed |

---

### Stub Staking Errors (Test Only)

**Program ID:** `StUbofRk12S7JrEUoQJFjMe6FmACNoRpbNMyjn311ZU`
**Source:** `programs/stub-staking/src/errors.rs`
**Variants:** 3 (codes 6000--6002)

The stub staking program is used during integration testing when the full staking program is not needed. It mirrors a subset of the real staking errors.

| Code | Name | Trigger | Maps To |
|---|---|---|---|
| 6000 | `AlreadyUpdated` | Same as `StakingError::AlreadyUpdated` | Epoch anti-replay |
| 6001 | `Overflow` | Same as `StakingError::Overflow` | Arithmetic safety |
| 6002 | `NotInitialized` | Same as `StakingError::NotInitialized` | Uninitialized pool |

---

## CPI Error Propagation

The protocol has a maximum CPI depth of 4 (the Solana hard limit), reached on the Carnage path:

```
Epoch::execute_carnage_atomic (depth 0)
  -> Tax::swap_exempt (depth 1)
    -> AMM::swap_sol_pool (depth 2)
      -> Token-2022::transfer_checked (depth 3)
        -> TransferHook::execute (depth 4)
```

The Conversion Vault (CRIME/FRAUD to PROFIT) operates at depth 1 only (Vault::convert -> Token-2022::transfer_checked), well within limits.

### Propagation Rules

1. **Errors bubble up unmodified.** A `TransferHookError::NoWhitelistedParty` at depth 4 surfaces to the transaction initiator as error code `6000` with the Transfer Hook program ID. No intermediate program catches or wraps it.

2. **Program ID distinguishes overlapping codes.** Both `AmmError::Overflow` and `StakingError::ZeroAmount` are code `6000`. The Solana runtime includes the failing program's ID in the error context, allowing the client to disambiguate.

3. **CPI failure causes the entire transaction to fail.** Solana transactions are atomic -- if any CPI in the chain fails, all state changes are rolled back.

### Error Flow Diagrams

**User Swap (Buy SOL -> CRIME):**
```
User TX -> Tax::swap_sol_buy
             |-> AMM::swap_sol_pool        -> AmmError bubbles to client
             |    |-> Token-2022::transfer  -> TransferHookError bubbles to client
             |-> Staking::deposit_rewards   -> StakingError bubbles to client
             |-> TaxError                   -> TaxError to client
```

**User Convert (CRIME/FRAUD <-> PROFIT via Vault):**
```
User TX -> Vault::convert
             |-> Token-2022::transfer_checked  -> TransferHookError bubbles to client
             |-> VaultError                    -> VaultError to client
```

**Crank Epoch Advance:**
```
Crank TX -> Epoch::advance_epoch
              |-> EpochError               -> EpochError to crank
```

**Crank Carnage Execution:**
```
Crank TX -> Epoch::execute_carnage_atomic
              |-> Tax::swap_exempt
              |    |-> AMM::swap_sol_pool   -> AmmError bubbles through Tax to Epoch to crank
              |    |    |-> Token-2022      -> TransferHookError bubbles all the way up
              |    |-> TaxError             -> TaxError bubbles to Epoch to crank
              |-> Staking::update_cumulative -> StakingError bubbles to crank
              |-> EpochError                -> EpochError to crank
```

### Key CPI Error Scenarios

| Scenario | Inner Error | Outer Program Sees | Client Sees |
|---|---|---|---|
| Swap slippage during user buy | `AmmError::SlippageExceeded` (6009) | Tax sees CPI failure, rolls back | AMM program ID + code 6009 |
| Hook blocks non-whitelisted transfer | `TransferHookError::NoWhitelistedParty` (6000) | AMM -> Tax -> User all roll back | Hook program ID + code 6000 |
| Carnage buy with empty vault | No error (graceful no-op) | Tax sees 0-amount, returns Ok | Success |
| Staking deposit overflow | `StakingError::Overflow` (6005) | Tax sees CPI failure, rolls back | Staking program ID + code 6005 |
| Vault convert with wrong mint pair | `VaultError::InvalidMintPair` (6002) | Direct to user | Vault program ID + code 6002 |
| Vault convert too small | `VaultError::OutputTooSmall` (6001) | Direct to user | Vault program ID + code 6001 |
| Oracle not revealed during VRF | `EpochError::RandomnessNotRevealed` (6010) | Direct to crank | Epoch program ID + code 6010 |

---

## Client-Side Error Mapping

### Architecture

Two independent error parsers handle the two user-facing flows:

| Parser | File | Covers | Fallback |
|---|---|---|---|
| `parseSwapError()` | `app/lib/swap/error-map.ts` | Tax (6000--6013) + AMM (6000--6017) | "Swap failed. Please try again or reduce the swap amount." |
| `parseStakingError()` | `app/lib/staking/error-map.ts` | Staking (6000--6010) | "Staking operation failed. Please try again." |

Neither parser covers Epoch or Transfer Hook errors. These are backend/crank operations and use the generic fallback if they somehow surface to the UI (Decision D3).

### Error Detection Patterns

Both parsers detect errors via two regex patterns:

1. **Anchor format:** `Error Number: (\d+)` -- extracts the decimal error code directly.
2. **Solana format:** `custom program error: 0x([0-9a-fA-F]+)` -- extracts hex, converts to decimal.

For swap errors, the parser also checks whether the AMM program ID (`5ANTHFtg...`) appears in the error string to determine which error map to consult.

### Common Transport Errors (Non-Program)

Both parsers also handle Solana infrastructure errors that aren't program-specific:

| Pattern | Message | Cause |
|---|---|---|
| `Blockhash not found` / `block height exceeded` | "Transaction expired. Please try again." | Transaction took too long to land; blockhash expired. |
| `insufficient funds` / `Insufficient` | "Insufficient balance for this swap/fees." | Not enough SOL for transaction fees or token balance too low. |
| `Transaction too large` | "Transaction is too large." | Exceeded 1232-byte TX limit. Should not happen with ALT. |
| `User rejected` / `rejected` | "Transaction was cancelled." | User declined signing in wallet. |

### Usage in Hooks

```typescript
// useSwap.ts (line 43)
import { parseSwapError } from "@/lib/swap/error-map";

// On transaction failure:
const userMessage = parseSwapError(error);
// Display userMessage in the UI toast/notification

// useStaking.ts (line 36)
import { parseStakingError } from "@/lib/staking/error-map";

// On transaction failure:
const userMessage = parseStakingError(error);
```

### Transaction Submission Parameters

Both hooks use identical submission settings:

```typescript
{ skipPreflight: false, maxRetries: 2 }
```

- **`skipPreflight: false`**: Simulation runs before sending, catching errors early.
- **`maxRetries: 2`**: Solana RPC will retry sending the transaction up to 2 times if it doesn't land.

**Exception:** v0 transactions with Address Lookup Tables on devnet require `skipPreflight: true` due to "Blockhash not found" simulation bugs. In this case, confirmation status must be checked via `confirmation.value.err`.

---

## Retry Strategy

### User Transactions (Frontend)

| Error Type | Retry? | Strategy |
|---|---|---|
| `SlippageExceeded` | Yes, with adjustment | Show user the current price; suggest increasing slippage tolerance |
| `ZeroEffectiveInput` / `ZeroSwapOutput` | No | Amount is too small. User must increase input. |
| `InsufficientOutput` / `MinimumOutputFloorViolation` | No | Structural -- amount below protocol floor. User must increase amount. |
| `Blockhash not found` | Yes, automatic | `maxRetries: 2` handles this. If persistent, user clicks "Try Again". |
| `Insufficient funds` | No | User needs more SOL/tokens. |
| `User rejected` | No | User explicitly cancelled. |
| `OutputTooSmall` (vault) | No | Conversion amount too small. User must increase input. |
| `InvalidMintPair` (vault) | No | Structural -- wrong token pair for vault conversion. |
| `PoolLocked` | Yes, after delay | Extremely rare. Retry after 1 slot (~400ms). |
| Generic fallback | Yes, once | "Try again" button. If it fails again, suggest reducing amount. |

### Crank Transactions (Backend)

| Error Type | Retry? | Strategy |
|---|---|---|
| `EpochBoundaryNotReached` | Yes, after delay | Poll slot height, retry when boundary crossed. |
| `VrfAlreadyPending` | No | Wait for VRF resolution or timeout. |
| `RandomnessNotRevealed` | Yes, after 1-4 slots | Oracle needs time to process. Exponential backoff: 1s, 2s, 4s. |
| `RandomnessExpired` / `RandomnessParseError` | Yes, with fresh randomness | Create new randomness account, restart VRF flow. |
| `VrfTimeoutNotElapsed` | Yes, after delay | Wait for 300 slots (~2 min), then call `retry_epoch_vrf`. |
| `CarnageDeadlineExpired` | No retry of Carnage | Call `expire_carnage` to clean up, then proceed to next epoch. |
| `CarnageLockActive` | N/A (user error) | User must wait for Carnage to complete. |
| `AlreadyUpdated` (staking) | Skip | Idempotent -- epoch already finalized, proceed to next operation. |
| `InsufficientTreasuryBalance` | Skip bounty | Bounty is gracefully skipped. Epoch transition proceeds. |
| Any unknown error | Log + alert | Report to Sentry, continue with next epoch. |

### VRF Recovery Flow

When a VRF request stalls (oracle down, gateway rotation failure):

```
1. Wait VRF_TIMEOUT_SLOTS (300 slots, ~2 minutes)
2. Create fresh Switchboard randomness account
3. Call retry_epoch_vrf with fresh randomness
4. Fresh randomness may get assigned to a different (working) oracle
5. Proceed with normal commit -> reveal -> consume flow
```

**Critical:** Do NOT rotate to a different Switchboard gateway. Each randomness account is assigned to a specific oracle, and alternative gateways serve different oracles whose signatures fail on-chain with error `0x1780`. Only retry the default gateway.

### Crank Catch-Up After Extended Downtime (Decision D9)

If the crank has been offline for N epochs:

- **Epoch advancement** is permissionless -- anyone can call `advance_epoch`.
- Each missed epoch requires ~3 transactions (advance + VRF commit/reveal/consume, or advance + retry after timeout).
- Catching up 100 missed epochs requires ~300 transactions.
- **Staking rewards accumulate safely** -- `pending_rewards` grows via `deposit_rewards` each epoch. Users' rewards are not lost, just delayed until the crank catches up and `update_cumulative` is called.
- **Carnage deadlines auto-expire** after 300 slots. No manual cleanup needed if the crank was down during a Carnage epoch.
- Estimated recovery cost: ~0.015 SOL per missed epoch (3 TX x ~5000 lamports).

---

## Monitoring & Alerting

### Sentry Integration

The frontend reports errors to Sentry via a zero-dependency custom reporter (`app/lib/sentry.ts`) that POSTs error envelopes directly to the Sentry ingest API. This avoids the `@sentry/nextjs` / `@sentry/browser` packages which break Turbopack SSR.

```typescript
// app/lib/sentry.ts
captureException(error);  // Fire-and-forget, never blocks
```

### Error Severity Classification for Alerts

| Severity | Errors | Alert Channel |
|---|---|---|
| **P0 Critical** | `KInvariantViolation`, `InsufficientEscrowBalance`, `Overflow` (in staking u128 math) | Immediate page. Possible fund loss. |
| **P1 High** | `VaultMismatch`, `InvalidMint`, `InvalidSwapAuthority`, `DirectInvocationNotAllowed` | Alert within 5 min. Possible attack attempt. |
| **P2 Medium** | `RandomnessExpired`, `CarnageSwapFailed`, VRF timeout errors | Alert within 30 min. Crank intervention needed. |
| **P3 Low** | `SlippageExceeded`, `ZeroSwapOutput`, `NothingToClaim` | Log only. Normal operational noise. |
| **P3 Low** | `OutputTooSmall`, `InvalidMintPair`, `SameMint` (vault) | Log only. Normal user input errors. |
| **Info** | `AlreadyInitialized`, `AlreadyUpdated`, `AlreadyWhitelisted` | Log only. Idempotent operations. |

### Key Metrics to Monitor

| Metric | Source | Threshold |
|---|---|---|
| Consecutive VRF failures | Crank logs | >3 = P2 alert |
| Empty Carnage vault epochs | Epoch state | >10 consecutive = P3 alert (vault not refilling) |
| Escrow balance vs pending_rewards | Staking state | Mismatch = P0 alert |
| Swap error rate (user-facing) | Frontend Sentry | >5% of swaps = P2 alert |
| Crank lag (current epoch vs expected) | Epoch state vs slot clock | >5 epochs behind = P2 alert |
| k-invariant checks | AMM transaction logs | Any violation = P0 alert |

---

## Escalation Path

### Tier 1: Automatic Recovery

These errors resolve without human intervention:

- **Blockhash expiry:** `maxRetries: 2` handles re-submission.
- **VRF oracle delay:** Crank retries after 1-4 slots.
- **VRF timeout:** Crank creates fresh randomness and retries after 300 slots.
- **Carnage deadline expiry:** Auto-expires; next epoch proceeds normally.
- **Empty Carnage vault:** Graceful no-op. Vault refills from tax fees (Decision D8).
- **Idempotent calls** (`AlreadyInitialized`, `AlreadyUpdated`): Skip and proceed.

### Tier 2: Operator Intervention

These errors require the crank operator to take specific action:

- **Extended crank downtime:** Run catch-up procedure (~3 TX per missed epoch).
- **Persistent VRF failures (>3 consecutive):** Verify Switchboard gateway health. Check if the oracle assigned to the committed randomness is online.
- **`InsufficientTreasuryBalance`:** Top up the treasury with SOL.
- **`CarnageSwapFailed` / `CarnageBurnFailed`:** Inspect the inner CPI error. May indicate pool state issue.

### Tier 3: Developer Investigation

These errors suggest bugs or attacks:

- **`KInvariantViolation`:** Stop all operations. Audit `swap_math.rs`. The constant-product formula is broken.
- **`InsufficientEscrowBalance`:** Accounting mismatch between deposits and pending_rewards. Audit the escrow flow.
- **`VaultMismatch` / `InvalidMint` / `InvalidSwapAuthority`:** Possible account substitution attack. Check transaction sender and accounts passed.
- **`DirectInvocationNotAllowed`:** Someone is calling the Transfer Hook directly, bypassing Token-2022.
- **`PoolLocked` (persistent):** Reentrancy somehow triggered. Solana's runtime should prevent this.
- **`DivisionByZero` in staking:** Dead stake invariant (1 PROFIT minimum) was violated. Check `total_staked`.
- **`Underflow` in staking:** Balance accounting is wrong. Audit stake/unstake flows.

### Tier 4: Protocol Emergency

If a Tier 3 error is confirmed as a real vulnerability:

1. Pause user-facing operations (frontend kill switch).
2. Analyze all transactions involving the affected program.
3. Determine if funds are at risk.
4. If pre-authority-burn: deploy a patched program.
5. If post-authority-burn: programs are immutable. Mitigation must be off-chain (frontend blocks, crank pauses, user communication).

---

## Appendix A: Complete Error Code Quick Reference

### AMM (`5ANTHFtg...`) -- 18 variants

| Code | Hex | Name |
|---|---|---|
| 6000 | `0x1770` | Overflow |
| 6001 | `0x1771` | KInvariantViolation |
| 6002 | `0x1772` | PoolAlreadyInitialized |
| 6003 | `0x1773` | MintsNotCanonicallyOrdered |
| 6004 | `0x1774` | Unauthorized |
| 6005 | `0x1775` | InvalidTokenProgram |
| 6006 | `0x1776` | ZeroSeedAmount |
| 6007 | `0x1777` | DuplicateMints |
| 6008 | `0x1778` | ZeroAmount |
| 6009 | `0x1779` | SlippageExceeded |
| 6010 | `0x177A` | PoolNotInitialized |
| 6011 | `0x177B` | PoolLocked |
| 6012 | `0x177C` | VaultMismatch |
| 6013 | `0x177D` | InvalidMint |
| 6014 | `0x177E` | ZeroEffectiveInput |
| 6015 | `0x177F` | ZeroSwapOutput |
| 6016 | `0x1780` | InvalidSwapAuthority |
| 6017 | `0x1781` | LpFeeExceedsMax |

### Tax Program (`DRjNCjt4...`) -- 18 variants

| Code | Hex | Name |
|---|---|---|
| 6000 | `0x1770` | InvalidPoolType |
| 6001 | `0x1771` | TaxOverflow |
| 6002 | `0x1772` | SlippageExceeded |
| 6003 | `0x1773` | InvalidEpochState |
| 6004 | `0x1774` | InsufficientInput |
| 6005 | `0x1775` | OutputBelowMinimum |
| 6006 | `0x1776` | InvalidSwapAuthority |
| 6007 | `0x1777` | WsolProgramMismatch |
| 6008 | `0x1778` | Token2022ProgramMismatch |
| 6009 | `0x1779` | InvalidTokenOwner |
| 6010 | `0x177A` | UnauthorizedCarnageCall |
| 6011 | `0x177B` | InvalidStakingEscrow |
| 6012 | `0x177C` | InvalidCarnageVault |
| 6013 | `0x177D` | InvalidTreasury |
| 6014 | `0x177E` | InvalidAmmProgram |
| 6015 | `0x177F` | InvalidStakingProgram |
| 6016 | `0x1780` | InsufficientOutput |
| 6017 | `0x1781` | MinimumOutputFloorViolation |

### Epoch Program (`G6dmJTdC...`) -- 32 variants

| Code | Hex | Name |
|---|---|---|
| 6000 | `0x1770` | AlreadyInitialized |
| 6001 | `0x1771` | NotInitialized |
| 6002 | `0x1772` | InvalidEpochState |
| 6003 | `0x1773` | EpochBoundaryNotReached |
| 6004 | `0x1774` | VrfAlreadyPending |
| 6005 | `0x1775` | NoVrfPending |
| 6006 | `0x1776` | RandomnessParseError |
| 6007 | `0x1777` | RandomnessExpired |
| 6008 | `0x1778` | RandomnessAlreadyRevealed |
| 6009 | `0x1779` | RandomnessAccountMismatch |
| 6010 | `0x177A` | RandomnessNotRevealed |
| 6011 | `0x177B` | InsufficientRandomness |
| 6012 | `0x177C` | VrfTimeoutNotElapsed |
| 6013 | `0x177D` | NoCarnagePending |
| 6014 | `0x177E` | CarnageDeadlineExpired |
| 6015 | `0x177F` | CarnageDeadlineNotExpired |
| 6016 | `0x1780` | CarnageLockActive |
| 6017 | `0x1781` | InvalidCarnageTargetPool |
| 6018 | `0x1782` | CarnageNotInitialized |
| 6019 | `0x1783` | CarnageAlreadyInitialized |
| 6020 | `0x1784` | InsufficientCarnageSol |
| 6021 | `0x1785` | CarnageSwapFailed |
| 6022 | `0x1786` | CarnageBurnFailed |
| 6023 | `0x1787` | Overflow |
| 6024 | `0x1788` | InsufficientTreasuryBalance |
| 6025 | `0x1789` | InvalidRandomnessOwner |
| 6026 | `0x178A` | InvalidCarnageWsolOwner |
| 6027 | `0x178B` | InvalidStakingProgram |
| 6028 | `0x178C` | InvalidMint |
| 6029 | `0x178D` | CarnageSlippageExceeded |
| 6030 | `0x178E` | InvalidTaxProgram |
| 6031 | `0x178F` | InvalidAmmProgram |

### Staking (`EZFeU613...`) -- 11 variants

| Code | Hex | Name |
|---|---|---|
| 6000 | `0x1770` | ZeroAmount |
| 6001 | `0x1771` | InsufficientBalance |
| 6002 | `0x1772` | InsufficientEscrowBalance |
| 6003 | `0x1773` | NothingToClaim |
| 6004 | `0x1774` | Unauthorized |
| 6005 | `0x1775` | Overflow |
| 6006 | `0x1776` | Underflow |
| 6007 | `0x1777` | DivisionByZero |
| 6008 | `0x1778` | AlreadyUpdated |
| 6009 | `0x1779` | NotInitialized |
| 6010 | `0x177A` | AlreadyInitialized |

### Transfer Hook (`CmNyuLdM...`) -- 10 variants

| Code | Hex | Name |
|---|---|---|
| 6000 | `0x1770` | NoWhitelistedParty |
| 6001 | `0x1771` | ZeroAmountTransfer |
| 6002 | `0x1772` | Unauthorized |
| 6003 | `0x1773` | AuthorityAlreadyBurned |
| 6004 | `0x1774` | AlreadyWhitelisted |
| 6005 | `0x1775` | InvalidWhitelistPDA |
| 6006 | `0x1776` | DirectInvocationNotAllowed |
| 6007 | `0x1777` | InvalidMint |
| 6008 | `0x1778` | InvalidTransferHook |
| 6009 | `0x1779` | NotToken2022Mint |

### Conversion Vault (`6WwVAc12...`) -- 6 variants

| Code | Hex | Name |
|---|---|---|
| 6000 | `0x1770` | ZeroAmount |
| 6001 | `0x1771` | OutputTooSmall |
| 6002 | `0x1772` | InvalidMintPair |
| 6003 | `0x1773` | SameMint |
| 6004 | `0x1774` | InvalidTokenProgram |
| 6005 | `0x1775` | MathOverflow |

### Stub Staking (`StUbofRk...`) -- 3 variants (test only)

| Code | Hex | Name |
|---|---|---|
| 6000 | `0x1770` | AlreadyUpdated |
| 6001 | `0x1771` | Overflow |
| 6002 | `0x1772` | NotInitialized |

**Total: 98 variants across 7 programs (95 production + 3 test-only)**

<!-- RECONCILIATION_FLAG: Previous count was 92 across 6 programs. Conversion Vault adds 6 new variants (ZeroAmount, OutputTooSmall, InvalidMintPair, SameMint, InvalidTokenProgram, MathOverflow). -->

---

## Appendix B: Carnage Empty-Vault Behavior (Decision D8)

When the Carnage SOL vault has zero balance:

1. `execute_carnage_atomic` is called normally.
2. The buy step calculates `amount = 0` from the empty vault.
3. `swap_exempt` CPI receives `amount_in = 0` and returns `Ok(())` (graceful no-op).
4. No tokens are purchased or burned.
5. Epoch state still updates: target pool switches, trigger counter increments.
6. The vault refills naturally from the Carnage share of sell taxes in subsequent epochs.

**For operators:** Empty-vault Carnage logs showing zero swaps are **expected behavior**, not errors. The `InsufficientCarnageSol` error (code 6020) exists in the enum but is intentionally never raised -- it serves as documentation of the design intent.

---

## Appendix C: Compute Budget Reference

| Path | CU Used | % of 200K Default | Risk |
|---|---|---|---|
| `swap_sol_buy` (CRIME) | ~98,000 | 49% | Low |
| `swap_sol_buy` (FRAUD) | ~122,000 | 61% | Low |
| `swap_sol_sell` (CRIME) | ~105,000 | 53% | Low |
| `swap_sol_sell` (FRAUD) | ~122,586 | 61% | Low -- heaviest path |
| `convert` (vault) | ~15,000 | 7.5% | Low -- simple fixed-rate math + transfer_checked |
| `execute_carnage_atomic` | ~150,000 | 75% | Moderate -- includes CPI chain |

FRAUD token consistently uses ~24K more CU than CRIME. This is assessed as a test environment artifact (account creation order, validator cache state). Both tokens have identical hook configurations. Flagged for devnet remeasurement.

No path exceeds the 200K default compute budget. No `ComputeBudgetInstruction::set_compute_unit_limit` is needed for any instruction.
