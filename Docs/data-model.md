---
doc_id: data-model
title: "Dr. Fraudsworth's Finance Factory -- Account & Data Model"
wave: 1
requires: []
provides: [data-model]
status: draft
decisions_referenced: [account-structure, architecture, cpi-architecture, token-model]
needs_verification: []
---

# Dr. Fraudsworth's Finance Factory -- Data Model

## Overview

All protocol state lives in rent-exempt Solana accounts owned by one of seven Anchor programs. The data model uses **30+ PDA types** -- 24 singletons and 6+ per-instance families (PoolState x2, Vault x8+, WhitelistEntry x14, UserStake x unbounded, CurveState x2). There are **11 custom state structs** serialized with Anchor's Borsh encoding (8-byte discriminator prefix). Four **cross-program PDAs** are derived from one program but validated as signers by another, forming the CPI access-control gates.

Design principles:
- **Minimal on-chain state**: No lifetime analytics fields in new structs. All analytics derived off-chain from transaction history via Helius webhooks or RPC indexing. Note: CarnageFundState has 4 legacy write-only lifetime counters (total_sol_spent, total_crime_burned, total_fraud_burned, total_triggers) -- these are harmless but not a pattern to replicate.
- **No account versioning**: No version fields, no migration logic. Layouts are final because all upgrade authorities will be burned.
- **Canonical mint ordering**: AMM pool PDAs use lexicographic mint ordering (`mint_a.key() < mint_b.key()`) enforced on-chain in `initialize_pool`, guaranteeing exactly one pool PDA per unordered mint pair.
- **Existence-based patterns**: WhitelistEntry uses PDA existence to encode whitelist membership -- no boolean flag needed.
- **UserStake persists forever**: Never closed, even after full unstake. ~0.00114 SOL permanent rent per user.

## PDA Derivation Tree

```
DR. FRAUDSWORTH PROTOCOL -- PDA HIERARCHY
==========================================

AMM Program (5ANTHFtgPgH1fUMywALtrpmT7uMHfWnFbz7hxY3tLzMj)
|
+-- AdminConfig              seeds: ["admin"]                               SINGLETON
|
+-- PoolState                seeds: ["pool", mint_a, mint_b]                x2 INSTANCES
|   |                        (mint_a < mint_b lexicographic)
|   |
|   +-- VaultA               seeds: ["vault", pool_pda, "a"]               x2 (one per pool)
|   +-- VaultB               seeds: ["vault", pool_pda, "b"]               x2 (one per pool)
|
+-- [SwapAuthority]*         seeds: ["swap_authority"]                      CROSS-PROGRAM
    (derived from Tax Program, validated by AMM)


Transfer Hook Program (CmNyuLdMeggHS2dKBhzPWHdeTEcpKg4uTevT5tBcBsce)
|
+-- WhitelistAuthority       seeds: ["authority"]                           SINGLETON
|
+-- WhitelistEntry           seeds: ["whitelist", address]                  x14 INSTANCES
|                            (one per whitelisted token account)
|
+-- ExtraAccountMetaList     seeds: ["extra-account-metas", mint]           x3 (CRIME, FRAUD, PROFIT)
    (Token-2022 standard PDA, not custom state)


Tax Program (DRjNCjt4tfTisSJXD1VrAduKbgA7KHuGPoYwxrUQN8uj)
|
+-- SwapAuthority*           seeds: ["swap_authority"]                      CROSS-PROGRAM
|   (derived here, used as signer in AMM swaps)
|
+-- TaxAuthority*            seeds: ["tax_authority"]                       CROSS-PROGRAM
|   (derived here, used as signer in Staking deposit_rewards)
|
+-- WsolIntermediary         seeds: ["wsol_intermediary"]                   SINGLETON
    (WSOL token account for sell-tax extraction cycle)

    ** Tax Program stores NO custom state accounts. **
    ** It reads EpochState from Epoch Program for current tax rates. **


Epoch Program (G6dmJTdC36VRqqi57QhWH444Ju7ieCzHZW9yhH7TpUhz)
|
+-- EpochState               seeds: ["epoch_state"]                         SINGLETON
|
+-- CarnageFundState         seeds: ["carnage_fund"]                        SINGLETON
|
+-- CarnageSolVault          seeds: ["carnage_sol_vault"]                   SINGLETON
|   (SystemAccount holding native SOL)
|
+-- CarnageCrimeVault        seeds: ["carnage_crime_vault"]                 SINGLETON
|   (Token-2022 CRIME token account)
|
+-- CarnageFraudVault        seeds: ["carnage_fraud_vault"]                 SINGLETON
|   (Token-2022 FRAUD token account)
|
+-- CarnageSigner*           seeds: ["carnage_signer"]                      CROSS-PROGRAM
|   (derived here, used as signer in Tax Program swap_exempt calls)
|
+-- StakingAuthority*        seeds: ["staking_authority"]                   CROSS-PROGRAM
    (derived here, used as signer in Staking update_cumulative calls)


Staking Program (EZFeU613CfqzNcEumE293QDmimRHyP2ZNWcbTgCQRZSu)
|
+-- StakePool                seeds: ["stake_pool"]                          SINGLETON
|
+-- EscrowVault              seeds: ["escrow_vault"]                        SINGLETON
|   (SystemAccount holding undistributed SOL rewards)
|
+-- StakeVault               seeds: ["stake_vault"]                         SINGLETON
|   (Token-2022 PROFIT token account)
|
+-- UserStake                seeds: ["user_stake", user_pubkey]             UNBOUNDED
    (one per user, never closed)


Conversion Vault Program (6WwVAc12B5x8gukgNyXa4agUyvi9PxdYTdPdnb9qEWFL)
|
+-- VaultConfig              seeds: ["vault_config"]                          SINGLETON
|
+-- VaultCrimeAccount        seeds: ["vault", crime_mint]                     SINGLETON
|   (Token-2022 CRIME token account)
|
+-- VaultFraudAccount        seeds: ["vault", fraud_mint]                     SINGLETON
|   (Token-2022 FRAUD token account)
|
+-- VaultProfitAccount       seeds: ["vault", profit_mint]                    SINGLETON
    (Token-2022 PROFIT token account)


Bonding Curve Program (AGhdAyBgfpNhZ3jzQR4D2pH7BTxsiGTcJRYWqsn7cGsL)
|
+-- BcAdminConfig            seeds: ["bc_admin"]                              SINGLETON
|   (Phase 78: authority hardening, ProgramData validation)
|
+-- CurveState               seeds: ["curve", token_mint]                     x2 INSTANCES
|   (one per token: CRIME, FRAUD -- 232 bytes)
|
+-- CurveTokenVault          seeds: ["curve_token_vault", token_mint]         x2 INSTANCES
|   (Token-2022 token account holding tokens for sale)
|
+-- CurveSolVault            seeds: ["curve_sol_vault", token_mint]           x2 INSTANCES
|   (SystemAccount holding raised SOL)
|
+-- TaxEscrow                seeds: ["tax_escrow", token_mint]                x2 INSTANCES
    (0-byte SOL-only PDA for 15% sell tax)


* = Cross-program PDA (derived from one program, validated/used by another)
```

## Cross-Program PDA Access Control Gates

These four PDAs form the trust boundaries between programs. Each is derived from its **source program** but presented as a signer to the **target program** via `seeds::program` constraints.

```
SOURCE PROGRAM          PDA                    TARGET PROGRAM       GATED INSTRUCTIONS
-----------------       -------------------    -----------------    ----------------------------
Tax Program        -->  SwapAuthority       -->  AMM Program         swap (taxed user swaps)
Tax Program        -->  TaxAuthority        -->  Staking Program     deposit_rewards
Epoch Program      -->  CarnageSigner       -->  Tax Program         swap_exempt (carnage swaps)
Epoch Program      -->  StakingAuthority    -->  Staking Program     update_cumulative
```

## Entities

### AdminConfig
**Program:** AMM
**Storage:** On-chain PDA, rent-exempt
**Seeds:** `["admin"]`
**Size:** 8 (discriminator) + 33 (admin) + 1 (bump) = 42 bytes (Anchor InitSpace)
**Lifecycle:** Created once by upgrade authority during protocol initialization. Never modified after pool creation phase.

| Field | Type | Size | Description | Constraints |
|-------|------|------|-------------|-------------|
| admin | Pubkey | 32 | Admin authorized to create pools. Can be a multisig | Set at init, immutable post-burn |
| bump | u8 | 1 | PDA bump seed for re-derivation | Set at init |

**Relationships:**
- Referenced by `initialize_pool` as gatekeeper -- only `admin` signer can create pools

**Burn mechanism:** The `burn_admin` instruction sets `admin` to `Pubkey::default()`, which is irreversible. After burn, `initialize_pool`'s `has_one = admin` constraint always fails since no wallet can sign as `Pubkey::default()`. Only the current `admin` signer can invoke `burn_admin`. Emits `AdminBurned` event.

---

### PoolState
**Program:** AMM
**Storage:** On-chain PDA, rent-exempt
**Seeds:** `["pool", mint_a.as_ref(), mint_b.as_ref()]` where `mint_a < mint_b` (lexicographic byte comparison)
**Size:** 8 (discriminator) + 224 (data) = 232 bytes
**Instances:** 2 (CRIME/WSOL, FRAUD/WSOL). Previously 4 pools — CRIME/PROFIT and FRAUD/PROFIT pools were replaced by the conversion vault.
**Lifecycle:** Created during protocol initialization with seed liquidity. Reserve fields updated on every swap. `locked` field toggles during swap execution as reentrancy guard.

| Field | Type | Size | Description | Constraints |
|-------|------|------|-------------|-------------|
| pool_type | PoolType (enum) | 1 | `MixedPool` (SPL+T22) or `PureT22Pool` (T22+T22) | Inferred from mint token programs at creation |
| mint_a | Pubkey | 32 | First mint in canonical pair | `mint_a < mint_b` enforced at init |
| mint_b | Pubkey | 32 | Second mint in canonical pair | Immutable after init |
| vault_a | Pubkey | 32 | PDA-owned token account for reserve A | Derived: `["vault", pool, "a"]` |
| vault_b | Pubkey | 32 | PDA-owned token account for reserve B | Derived: `["vault", pool, "b"]` |
| reserve_a | u64 | 8 | Current reserve of token A | Updated atomically on swap; checked arithmetic |
| reserve_b | u64 | 8 | Current reserve of token B | Updated atomically on swap; checked arithmetic |
| lp_fee_bps | u16 | 2 | LP fee in basis points | SOL pools: 100 bps (1%); max 500 bps. (Previously PROFIT pools used 50 bps — now replaced by conversion vault.) |
| initialized | bool | 1 | Whether pool has received seed liquidity | Set to true after `add_liquidity` |
| locked | bool | 1 | Reentrancy guard during swap execution | True during swap, cleared after. Defense-in-depth |
| bump | u8 | 1 | Pool PDA bump seed | Set at init |
| vault_a_bump | u8 | 1 | Vault A PDA bump (avoids re-derivation) | Set at init |
| vault_b_bump | u8 | 1 | Vault B PDA bump (avoids re-derivation) | Set at init |
| token_program_a | Pubkey | 32 | Token program for mint A (SPL Token or Token-2022) | Stored to avoid re-validation per swap |
| token_program_b | Pubkey | 32 | Token program for mint B (SPL Token or Token-2022) | Stored to avoid re-validation per swap |

**Pool Topology:**

| Pool | Type | Mint A | Mint B | Fee |
|------|------|--------|--------|-----|
| CRIME/SOL | MixedPool | CRIME (T22) or WSOL (SPL)* | The other* | 100 bps |
| FRAUD/SOL | MixedPool | FRAUD (T22) or WSOL (SPL)* | The other* | 100 bps |

*Actual A/B assignment depends on lexicographic pubkey ordering of each specific mint keypair.

**Vault conversion:** PROFIT is no longer acquired via AMM pools. Users convert CRIME or FRAUD to PROFIT at a fixed 100:1 rate via the Conversion Vault program (zero fees, zero slippage).

**Relationships:**
- Owns 2 Vault token accounts (vault_a, vault_b) via PDA authority
- Referenced by Tax Program during taxed swaps via SwapAuthority CPI
- Referenced by Epoch Program during Carnage swaps via CarnageSigner CPI

---

### WhitelistAuthority
**Program:** Transfer Hook
**Storage:** On-chain PDA, rent-exempt
**Seeds:** `["authority"]`
**Size:** 8 (discriminator) + 33 (Option\<Pubkey\>) + 1 (initialized) = 42 bytes
**Lifecycle:** Created at protocol initialization. `authority` set to `None` via `burn_authority` instruction to make the whitelist permanently immutable.

| Field | Type | Size | Description | Constraints |
|-------|------|------|-------------|-------------|
| authority | Option\<Pubkey\> | 33 | Authority that can add whitelist entries. `None` = burned/immutable | 1 byte discriminant + 32 bytes pubkey |
| initialized | bool | 1 | Whether account has been initialized | Prevents re-initialization |

**Relationships:**
- Gates `add_whitelist_entry` instruction -- only `authority` signer can add entries
- Once burned, no more WhitelistEntry accounts can be created

---

### WhitelistEntry
**Program:** Transfer Hook
**Storage:** On-chain PDA, rent-exempt (existence-based pattern)
**Seeds:** `["whitelist", address.as_ref()]`
**Size:** 8 (discriminator) + 32 (address) + 8 (created_at) = 48 bytes
**Instances:** 14 (all protocol-owned token accounts that need transfer-hook exemption)
**Lifecycle:** Created during protocol initialization. Never modified or closed. Whitelist membership = PDA existence.

| Field | Type | Size | Description | Constraints |
|-------|------|------|-------------|-------------|
| address | Pubkey | 32 | The whitelisted token account pubkey (not wallet) | Used as PDA seed |
| created_at | i64 | 8 | Unix timestamp when entry was created | Audit trail only |

**Relationships:**
- Checked during every Token-2022 transfer via the `execute` transfer hook instruction
- If PDA exists for source OR destination token accounts, transfer proceeds without tax
- 14 entries cover: 8 pool vaults + 3 carnage vaults + 1 stake vault + 1 wsol intermediary + 1 treasury

---

### ExtraAccountMetaList
**Program:** Transfer Hook (Token-2022 standard, not custom Anchor state)
**Seeds:** `["extra-account-metas", mint.as_ref()]`
**Instances:** 3 (CRIME mint, FRAUD mint, PROFIT mint)
**Lifecycle:** Created per-mint during hook initialization. Contains the list of additional accounts the transfer hook `execute` instruction needs: the WhitelistEntry PDAs for source and destination, plus the hook program itself.

This is a Token-2022 standard account, not a custom Anchor struct. It stores serialized `ExtraAccountMeta` entries that tell the Token-2022 program which additional accounts to pass to the hook at transfer time. Each mint's list encodes 4 extra accounts: `extra_account_meta_list` PDA, WhitelistEntry for source, WhitelistEntry for destination, and the hook program ID.

**Relationships:**
- Referenced by Token-2022 during `transfer_checked` to resolve hook accounts
- One per Token-2022 mint (CRIME, FRAUD, PROFIT)

---

### EpochState
**Program:** Epoch Program
**Storage:** On-chain PDA, rent-exempt
**Seeds:** `["epoch_state"]`
**Size:** 8 (discriminator) + 164 (data) = 172 bytes
**Lifecycle:** Created once during protocol genesis. Updated every epoch transition (VRF commit/reveal cycle). Tax rate fields read cross-program by Tax Program via Borsh deserialization.
**Note:** Phase 80 (DEF-03) added 64 bytes of reserved padding between the carnage fields and the protocol fields (initialized/bump). This allows future schema evolution without account migration. The `#[repr(C)]` attribute ensures stable memory layout. Compile-time assertion validates DATA_LEN == 164.

| Field | Type | Size | Description | Constraints |
|-------|------|------|-------------|-------------|
| genesis_slot | u64 | 8 | Slot when protocol was initialized | Set once, never modified |
| current_epoch | u32 | 4 | Current epoch number (0-indexed) | Increments each `trigger_epoch_transition` |
| epoch_start_slot | u64 | 8 | Slot when current epoch started | `genesis_slot + (current_epoch * SLOTS_PER_EPOCH)` |
| cheap_side | u8 | 1 | Current cheap side: 0=CRIME, 1=FRAUD | Set by VRF randomness |
| low_tax_bps | u16 | 2 | Low tax rate (100-400 bps, i.e., 1-4%) | Randomized per epoch by VRF |
| high_tax_bps | u16 | 2 | High tax rate (1100-1400 bps, i.e., 11-14%) | Randomized per epoch by VRF |
| crime_buy_tax_bps | u16 | 2 | CRIME buy tax (cached from cheap_side + low/high) | Derived, cached for efficiency |
| crime_sell_tax_bps | u16 | 2 | CRIME sell tax | Derived, cached |
| fraud_buy_tax_bps | u16 | 2 | FRAUD buy tax | Derived, cached |
| fraud_sell_tax_bps | u16 | 2 | FRAUD sell tax | Derived, cached |
| vrf_request_slot | u64 | 8 | Slot when VRF was committed (0 = none pending) | Used for timeout detection |
| vrf_pending | bool | 1 | Whether VRF request is pending | True between commit and consume |
| taxes_confirmed | bool | 1 | Whether taxes confirmed for current epoch | False between trigger and consume |
| pending_randomness_account | Pubkey | 32 | Switchboard randomness account bound at commit | Anti-reroll: consume must use this exact account |
| carnage_pending | bool | 1 | Whether Carnage execution is pending | Set by VRF consume |
| carnage_target | u8 | 1 | Target token for Carnage: 0=CRIME, 1=FRAUD | Valid only when carnage_pending=true |
| carnage_action | u8 | 1 | Action: 0=None, 1=Burn, 2=Sell | Valid only when carnage_pending=true |
| carnage_deadline_slot | u64 | 8 | Slot deadline for fallback Carnage execution | After deadline, Carnage expires |
| carnage_lock_slot | u64 | 8 | Slot until which only atomic path can execute | Lock: 50 slots, then fallback unlocks |
| last_carnage_epoch | u32 | 4 | Last epoch when Carnage triggered | Frequency tracking |
| reserved | [u8; 64] | 64 | Future schema evolution padding (Phase 80 DEF-03) | Zeroed on init, consumed by new fields without migration |
| initialized | bool | 1 | Initialization flag | Prevents re-initialization |
| bump | u8 | 1 | PDA bump seed | Set at init |

**Relationships:**
- **Read cross-program** by Tax Program (via `EpochStateReader` mirror struct) to get current tax rates for every swap
- Controls Carnage execution lifecycle (CarnageFundState references this for trigger/execute coordination)
- VRF state binds to external Switchboard randomness accounts

**Tax Rate Derivation (from VRF bytes):** Each epoch, `derive_taxes()` in `epoch-program/src/helpers/tax_derivation.rs` converts 5 VRF bytes into tax rates. Byte 0: flip decision (`< 192` = 75% chance to swap cheap side). Bytes 1-4: independent magnitude rolls per token -- `LOW_RATES[(byte % 4)]` selects from `[100, 200, 300, 400]` bps, `HIGH_RATES[(byte % 4)]` from `[1100, 1200, 1300, 1400]` bps. Byte 1 = CRIME low, byte 2 = CRIME high, byte 3 = FRAUD low, byte 4 = FRAUD high. The cheap side gets its own `low_buy / high_sell`; the expensive side gets its own `high_buy / low_sell`. CRIME and FRAUD rates are fully independent. The `low_tax_bps` and `high_tax_bps` fields in EpochState are populated as the explicit min/max of the 4 per-token rates (Phase 83 VRF-03); `derive_taxes()` returns 0 for these legacy aggregate fields.

<!-- RECONCILIATION_FLAG: Tax Program's EpochStateReader mirror struct MUST match this layout byte-for-byte. Any field additions to EpochState require updating tax-program/src/state/epoch_state_reader.rs -->

---

### CarnageFundState
**Program:** Epoch Program
**Storage:** On-chain PDA, rent-exempt
**Seeds:** `["carnage_fund"]`
**Size:** 8 (discriminator) + 139 (data) = 147 bytes
**Lifecycle:** Created once during protocol initialization. Updated on Carnage trigger (buy tokens) and Carnage execute (burn or sell held tokens).

| Field | Type | Size | Description | Constraints |
|-------|------|------|-------------|-------------|
| sol_vault | Pubkey | 32 | PDA of Carnage SOL vault (SystemAccount) | Seeds: `["carnage_sol_vault"]` |
| crime_vault | Pubkey | 32 | PDA of Carnage CRIME vault (Token-2022) | Seeds: `["carnage_crime_vault"]` |
| fraud_vault | Pubkey | 32 | PDA of Carnage FRAUD vault (Token-2022) | Seeds: `["carnage_fraud_vault"]` |
| held_token | u8 | 1 | Which token is held: 0=None, 1=CRIME, 2=FRAUD | Stored as u8, use `HeldToken` enum for type safety |
| held_amount | u64 | 8 | Amount of held token (0 if held_token=None) | Purchased during Carnage trigger |
| last_trigger_epoch | u32 | 4 | Last epoch when Carnage triggered | Frequency tracking |
| total_sol_spent | u64 | 8 | **Legacy**: Lifetime SOL spent on buys | Write-only counter, do not replicate pattern |
| total_crime_burned | u64 | 8 | **Legacy**: Lifetime CRIME burned | Write-only counter, do not replicate pattern |
| total_fraud_burned | u64 | 8 | **Legacy**: Lifetime FRAUD burned | Write-only counter, do not replicate pattern |
| total_triggers | u32 | 4 | **Legacy**: Lifetime trigger count | Write-only counter, do not replicate pattern |
| initialized | bool | 1 | Initialization flag | Prevents re-initialization |
| bump | u8 | 1 | PDA bump seed | Set at init |

**Relationships:**
- Owns 3 vault accounts (sol_vault, crime_vault, fraud_vault) referenced by address
- Carnage trigger reads EpochState to determine target token and action
- CarnageSigner PDA signs CPI to Tax Program for swap_exempt operations

---

### StakePool
**Program:** Staking
**Storage:** On-chain PDA, rent-exempt
**Seeds:** `["stake_pool"]`
**Size:** 8 (discriminator) + 54 (data) = 62 bytes
**Lifecycle:** Created once during protocol initialization. `pending_rewards` updated when Tax Program deposits SOL rewards. `rewards_per_token_stored` updated each epoch via `update_cumulative`. `total_staked` updated on every user stake/unstake.

| Field | Type | Size | Description | Constraints |
|-------|------|------|-------------|-------------|
| total_staked | u64 | 8 | Total PROFIT staked across all users | Updated on every stake/unstake |
| rewards_per_token_stored | u128 | 16 | Cumulative rewards per token, scaled by PRECISION (1e18) | Monotonically increasing, never decreases |
| pending_rewards | u64 | 8 | SOL rewards accumulated this epoch, not yet cumulative. Also receives forfeited rewards from unstaking users. | Reset to 0 after `update_cumulative` |
| last_update_epoch | u32 | 4 | Last epoch when cumulative was updated | Prevents double-update within same epoch |
| total_distributed | u64 | 8 | Total SOL distributed lifetime | Incremented when pending added to cumulative |
| total_claimed | u64 | 8 | Total SOL claimed lifetime | Incremented when users claim rewards |
| initialized | bool | 1 | Initialization flag | Prevents re-initialization |
| bump | u8 | 1 | PDA bump seed | Set at init |

**Constraints:**
- `MINIMUM_STAKE = 1_000_000` (1 PROFIT, 6 decimals) -- deposited as irrecoverable "dead stake" during `initialize_stake_pool`. Ensures `total_staked > 0` always, preventing first-depositor inflation attacks on `rewards_per_token_stored`. On `unstake`, if the user's remaining balance would fall below `MINIMUM_STAKE`, the unstake auto-converts to a full unstake.
- Note: `escrow_vault` is NOT required for unstake (only for `claim` and `deposit_rewards`).

**Relationships:**
- Receives SOL via `deposit_rewards` from Tax Program (TaxAuthority PDA signer)
- `update_cumulative` called by Epoch Program (StakingAuthority PDA signer)
- Referenced by all UserStake accounts for reward calculation

---

### UserStake
**Program:** Staking
**Storage:** On-chain PDA, rent-exempt
**Seeds:** `["user_stake", user_pubkey.as_ref()]`
**Size:** 8 (discriminator) + 97 (data) = 105 bytes
**Instances:** Unbounded (one per user who ever stakes)
**Lifecycle:** Created on first stake. Updated on stake/unstake/claim. On unstake, pending rewards are forfeited (added to StakePool.pending_rewards) rather than claimed. **Never closed** -- persists forever even after full unstake (~0.00114 SOL permanent rent per user).

| Field | Type | Size | Description | Constraints |
|-------|------|------|-------------|-------------|
| owner | Pubkey | 32 | Owner wallet of this stake account | Validated on unstake/claim to prevent unauthorized access |
| staked_balance | u64 | 8 | Amount of PROFIT currently staked | Updated on stake/unstake |
| rewards_per_token_paid | u128 | 16 | User's checkpoint of rewards_per_token at last update | Used to calculate pending rewards since last interaction |
| rewards_earned | u64 | 8 | Accumulated unclaimed SOL rewards | Updated by `update_rewards` helper before any balance change |
| total_claimed | u64 | 8 | Total SOL claimed lifetime | Incremented on each claim |
| first_stake_slot | u64 | 8 | Slot when user first staked | Set once, never updated |
| last_update_slot | u64 | 8 | Slot when user last interacted | Updated by `update_rewards` helper |
| last_claim_ts | i64 | 8 | Unix timestamp of last claim (0 = never claimed) | Set by claim instruction; read by unstake for cooldown check |
| bump | u8 | 1 | PDA bump seed | Set at init |

**Relationships:**
- Owned by a specific user wallet (seed-derived from `user_pubkey`)
- Reward calculation reads `StakePool.rewards_per_token_stored` and compares to local `rewards_per_token_paid`

---

### BcAdminConfig
**Program:** Bonding Curve
**Storage:** On-chain PDA, rent-exempt
**Seeds:** `["bc_admin"]`
**Size:** 8 (discriminator) + 33 (data) = 41 bytes (Anchor InitSpace)
**Lifecycle:** Created once by upgrade authority during bonding curve initialization. `authority` set to `Pubkey::default()` via `burn_bc_admin` to permanently disable admin operations.

| Field | Type | Size | Description | Constraints |
|-------|------|------|-------------|-------------|
| authority | Pubkey | 32 | Admin authorized to perform admin operations | Set to `Pubkey::default()` after burn |
| bump | u8 | 1 | PDA bump seed | Set at init |

**Relationships:**
- Gates all bonding curve admin instructions: `initialize_curve`, `fund_curve`, `start_curve`, `prepare_transition`, `withdraw_graduated_sol`, `close_token_vault`
- Phase 78: Validates caller is the admin stored in BcAdminConfig. Admin identity validated against ProgramData upgrade authority at init time.

---

### CurveState
**Program:** Bonding Curve
**Storage:** On-chain PDA, rent-exempt
**Seeds:** `["curve", token_mint.as_ref()]`
**Size:** 8 (discriminator) + 224 (data) = 232 bytes
**Instances:** 2 (CRIME curve, FRAUD curve)
**Lifecycle:** Created during bonding curve initialization. Updated on every purchase and sell. Transitions through Initialized -> Active -> Filled -> Graduated (success) or Failed (deadline/partner failure). Terminal states: Graduated, Failed.

| Field | Type | Size | Description | Constraints |
|-------|------|------|-------------|-------------|
| token | Token (enum) | 1 | Which token (Crime or Fraud) | Set at init |
| token_mint | Pubkey | 32 | Mint address of the token being sold | Immutable |
| token_vault | Pubkey | 32 | PDA holding tokens for sale | Seeds: `["curve_token_vault", token_mint]` |
| sol_vault | Pubkey | 32 | PDA holding raised SOL | Seeds: `["curve_sol_vault", token_mint]` |
| tokens_sold | u64 | 8 | Total tokens currently sold (decreases on sells) | Updated on buy/sell |
| sol_raised | u64 | 8 | Total SOL raised from buys (gross) | Monotonically increasing |
| status | CurveStatus (enum) | 1 | Curve lifecycle status | State machine: Init->Active->Filled->Graduated or Failed |
| start_slot | u64 | 8 | Slot when curve started | Set once in start_curve |
| deadline_slot | u64 | 8 | Deadline slot (start_slot + DEADLINE_SLOTS) | 48 hours (~432,000 slots) |
| participant_count | u32 | 4 | Unique purchasers (incremented on first buy) | Convenience counter |
| tokens_returned | u64 | 8 | Cumulative tokens returned via sells | Analytics counter |
| sol_returned | u64 | 8 | Cumulative SOL returned to sellers (gross) | Analytics counter |
| tax_collected | u64 | 8 | Cumulative 15% sell tax collected | Convenience -- escrow PDA lamports are authoritative |
| tax_escrow | Pubkey | 32 | PDA address of tax escrow account | Seeds: `["tax_escrow", token_mint]` |
| bump | u8 | 1 | PDA bump seed | Set at init |
| escrow_consolidated | bool | 1 | Whether tax escrow merged into sol_vault | Set by consolidate_for_refund |
| partner_mint | Pubkey | 32 | Mint of partner curve's token (Phase 79 FIN-05) | Used to validate partner_curve_state identity |

**Relationships:**
- Owns token vault and SOL vault PDAs
- Tax escrow PDA holds 15% sell tax (0-byte SOL-only account)
- partner_mint enables cross-curve validation in refund/consolidation flows
- Dual-curve coupling: both curves must reach Filled for graduation (prepare_transition validates both)

---

### Token Accounts (Non-State)

These are standard SPL Token / Token-2022 token accounts owned by PDAs, not custom Anchor state structs.

**Mints (3):**

| Mint | Standard | Decimals | Supply | Mint Authority |
|------|----------|----------|--------|----------------|
| CRIME | Token-2022 | 6 | 1,000,000,000 (1B) | Burned |
| FRAUD | Token-2022 | 6 | 1,000,000,000 (1B) | Burned |
| PROFIT | Token-2022 | 6 | 20,000,000 (20M) | Burned |

All three mints use Token-2022 with transfer hook extension pointing to the Transfer Hook program. CRIME and FRAUD also have metadata extensions.

**WSOL:** Native Mint (`So11111111111111111111111111111111111111112`), standard SPL Token, 9 decimals. Used as SOL representation in pool vaults.

**Pool Vaults (4):**
2 pools x 2 vaults each. Each vault is a Token-2022 or SPL Token account (matching its mint's program) owned by the PoolState PDA.

**Carnage Vaults (3):**
- CarnageSolVault: SystemAccount (native SOL), owned by Epoch Program PDA
- CarnageCrimeVault: Token-2022 account for CRIME, owned by Epoch Program PDA
- CarnageFraudVault: Token-2022 account for FRAUD, owned by Epoch Program PDA

**Staking Vaults (2):**
- EscrowVault: SystemAccount (native SOL) holding undistributed rewards, owned by Staking Program PDA
- StakeVault: Token-2022 account for PROFIT, holding all staked PROFIT, owned by Staking Program PDA

**WsolIntermediary (1):**
- SPL Token WSOL account owned by SwapAuthority PDA, used in the sell-tax extraction cycle (transfer-close-distribute-reinit)
- **Lifecycle per sell swap:** (a) SPL `Transfer` -- tax WSOL moved from user's ATA to intermediary; (b) SPL `CloseAccount` -- intermediary closed to swap_authority, unwrapping WSOL to native SOL (rent lamports retained); (c) `system_instruction::transfer` x3 -- native SOL distributed from swap_authority to staking escrow (71%), carnage vault (24%), treasury (5%); (d) `CreateAccount` + `InitializeAccount3` -- intermediary re-created at same PDA with retained rent lamports, ready for the next sell.

## Storage Architecture

### Primary Storage: On-Chain PDAs

All authoritative state lives in rent-exempt Solana accounts. There is no off-chain database that serves as source of truth.

| Category | Account Count | Total Rent (~SOL) |
|----------|--------------|-------------------|
| Singleton State (AdminConfig, WhitelistAuthority, EpochState, CarnageFundState, StakePool) | 5 | ~0.005 |
| Pool State (2 PoolState accounts) | 2 | ~0.0035 |
| Pool Vaults (4 token accounts) | 4 | ~0.008 |
| Carnage Vaults (3 accounts) | 3 | ~0.006 |
| Staking Vaults (2 accounts) | 2 | ~0.004 |
| Whitelist Entries (14 accounts) | 14 | ~0.010 |
| ExtraAccountMetaList (3 accounts) | 3 | ~0.006 |
| Cross-program PDA signers (4) | 4 | 0 (signer-only, no data) |
| Vault accounts (VaultConfig + 3 token accounts) | 4 | ~0.008 |
| WsolIntermediary | 1 | ~0.002 |
| Bonding Curve (BcAdminConfig + 2 CurveState + 2 token vaults + 2 SOL vaults + 2 tax escrows) | 9 | ~0.020 |
| UserStake (per user) | unbounded | ~0.00114 each |
| **Total (excluding UserStake)** | **51** | **~0.073** |

### Off-Chain Analytics: Helius Webhooks

On-chain accounts carry zero analytics beyond what's strictly needed for program logic. All historical data is captured off-chain:

- **Helius Webhooks** subscribe to program transaction events and push parsed instruction data to a backend
- **PostgreSQL** stores indexed transaction history for the docs-site frontend
- **Derived metrics**: swap volumes, tax collected per epoch, carnage history, staking APY -- all computed from transaction logs, not from on-chain counters

### Address Lookup Table (ALT)

The protocol uses a single Address Lookup Table (devnet: `4rW2yu8sJujQ7JUwUAom2UyYzhwpJQfJj7BLRucHzah6`) containing 48 addresses. This is a client-side optimization for compressing VersionedTransaction v0 messages -- the Sell path requires 23 named accounts + 8 remaining accounts, exceeding Solana's 1232-byte legacy transaction limit.

The ALT is not part of the data model per se, but is a critical deployment artifact cached at `scripts/deploy/alt-address.json`.

## Data Flow

### State Change Propagation

```
User Action (wallet signs TX)
    |
    v
[1] Tax Program (entry point for user swaps)
    |-- Reads: EpochState (cross-program deser) for tax rates
    |-- Computes: tax amount, distribution split (71/24/5)
    |-- CPI: AMM.swap via SwapAuthority PDA
    |-- CPI: Staking.deposit_rewards via TaxAuthority PDA (71% to escrow)
    |-- Transfer: Carnage SOL vault (24%), Treasury wallet (5%)
    |
    v
[2] AMM Program (executes constant-product swap)
    |-- Validates: SwapAuthority or CarnageSigner as caller
    |-- Updates: PoolState.reserve_a, reserve_b (CEI ordering)
    |-- Transfers: tokens between user and vault accounts
    |
    v
[3] Transfer Hook Program (invoked by Token-2022 on every T22 transfer)
    |-- Checks: WhitelistEntry existence for source + destination
    |-- If both whitelisted: no-op (protocol-internal transfer)
    |-- If not whitelisted: validates caller is Tax Program flow
    |
    v
[4] Epoch Program (crank-driven, once per epoch)
    |-- trigger_epoch_transition: VRF commit
    |-- consume_randomness: VRF reveal -> new tax rates, Carnage decision
    |-- execute_carnage: buyback-and-burn via CarnageSigner -> Tax.swap_exempt
    |-- CPI: Staking.update_cumulative via StakingAuthority PDA
    |
    v
[5] Staking Program
    |-- deposit_rewards: Tax Program deposits SOL to escrow (per swap)
    |-- update_cumulative: Epoch Program finalizes epoch rewards (per epoch)
    |-- stake/unstake/claim: User interactions with PROFIT and SOL
```

### Off-Chain Pipeline

```
On-chain TX confirmed
    |
    v
Helius Webhook fires (parsed instruction data)
    |
    v
Backend API (Railway: dr-fraudsworth-production.up.railway.app)
    |-- Validates + transforms event payload
    |-- Writes to PostgreSQL
    |
    v
Frontend (Next.js docs-site)
    |-- Queries PostgreSQL for historical data
    |-- Queries RPC for live on-chain state (EpochState, PoolState, StakePool)
    |-- Renders dashboards, charts, swap UI
```

## Data Integrity

### On-Chain Integrity Mechanisms

1. **Anchor Discriminators**: Every custom account has an 8-byte SHA-256 discriminator (`sha256("account:StructName")[0..8]`). Anchor rejects deserialization if the discriminator doesn't match, preventing type confusion attacks.

2. **Checked Arithmetic**: All reserve and reward calculations use Rust's checked arithmetic (`checked_add`, `checked_sub`, `checked_mul`, `checked_div`). Overflow/underflow returns an error rather than wrapping.

3. **Constant-Product K-Invariant**: The AMM enforces `new_k >= old_k` after every swap, where `k = reserve_a * reserve_b`. This is checked after fee deduction to ensure the pool never loses value.

4. **CEI (Checks-Effects-Interactions) Ordering**: All instructions follow CEI -- validate inputs, update state, then perform transfers. This prevents state inconsistency if a CPI fails partway through.

5. **Reentrancy Guard**: PoolState has an explicit `locked` boolean set during swap execution (belt-and-suspenders on top of Solana's runtime borrow rules).

6. **PDA-Gated Access Control**: Cross-program calls are gated by PDA signature verification (`seeds::program` constraints). Only the program that derived the PDA can produce a valid signature.

7. **Anti-Reroll Protection**: EpochState binds `pending_randomness_account` at VRF commit time. `consume_randomness` must use the exact same account, preventing an attacker from re-rolling for favorable outcomes.

8. **Minimum Output Floor**: Tax Program enforces a protocol-wide 50% (5000 bps) minimum output floor on all user swaps. Slippage settings below this are rejected, protecting against sandwich attacks.

9. **Canonical Mint Ordering**: Pool PDA derivation enforces `mint_a < mint_b`, making it impossible to create duplicate pools with swapped mint order.

10. **First-Depositor Protection**: Staking Program initializes with a "dead stake" of 1 PROFIT (MINIMUM_STAKE = 1,000,000 base units), ensuring `total_staked > 0` always, preventing inflation attacks on `rewards_per_token_stored`.

### Cross-Program Layout Integrity

The Tax Program contains a read-only mirror struct (`EpochStateReader`) that MUST match the Epoch Program's `EpochState` layout byte-for-byte. Both structs have static assertions verifying `DATA_LEN == 164` (Phase 80 increased from 100 to 164 with reserved padding). If these drift, cross-program deserialization will silently read wrong fields.

<!-- RECONCILIATION_FLAG: If EpochState fields are ever added/reordered, tax-program/src/state/epoch_state_reader.rs MUST be updated in lockstep. Static assertions catch size drift but not field reordering. -->

## Migration Strategy

**None.** All account layouts are final. There are no version fields and no migration logic.

This is a deliberate architectural decision: all seven program upgrade authorities will be burned post-launch, making the programs fully immutable. Account layouts cannot change because the programs that read them cannot be updated.

Consequences:
- Adding fields to any struct is impossible after authority burn
- The 4 legacy counters in CarnageFundState (total_sol_spent, total_crime_burned, total_fraud_burned, total_triggers) are permanent -- they cannot be removed, only ignored
- UserStake accounts persist forever at ~0.00114 SOL rent each -- there is no "close account" instruction and never will be
- Any future protocol evolution requires deploying entirely new programs with new PDAs

This is intentional. Immutability is the security model: users can verify the deployed bytecode once and trust it forever. No admin key can alter program behavior or account layouts.

## Account Size Summary

| Struct | Discriminator | Data | Total | Instances |
|--------|--------------|------|-------|-----------|
| AdminConfig | 8 | 33* | ~42 | 1 |
| PoolState | 8 | 224 | 232 | 2 |
| WhitelistAuthority | 8 | 34 | 42 | 1 |
| WhitelistEntry | 8 | 40 | 48 | 14 |
| EpochState | 8 | 164 | 172 | 1 |
| CarnageFundState | 8 | 139 | 147 | 1 |
| StakePool | 8 | 54 | 62 | 1 |
| UserStake | 8 | 97 | 105 | unbounded |
| VaultConfig | 8 | ~17 | ~25 | 1 |
| BcAdminConfig | 8 | 33* | ~41 | 1 |
| CurveState | 8 | 224 | 232 | 2 |

*AdminConfig and BcAdminConfig use Anchor's `InitSpace` derive; exact data size is 33 bytes (32 Pubkey + 1 bump).

## Appendix: PDA Seed Reference

| PDA Name | Seeds | Deriving Program | Instance Type |
|----------|-------|-----------------|---------------|
| AdminConfig | `["admin"]` | AMM | singleton |
| PoolState | `["pool", mint_a, mint_b]` | AMM | per-pool (x2) |
| VaultA | `["vault", pool_pda, "a"]` | AMM | per-pool (x2) |
| VaultB | `["vault", pool_pda, "b"]` | AMM | per-pool (x2) |
| SwapAuthority | `["swap_authority"]` | Tax Program | singleton (cross-program) |
| TaxAuthority | `["tax_authority"]` | Tax Program | singleton (cross-program) |
| WsolIntermediary | `["wsol_intermediary"]` | Tax Program | singleton |
| WhitelistAuthority | `["authority"]` | Transfer Hook | singleton |
| WhitelistEntry | `["whitelist", address]` | Transfer Hook | per-address (x14) |
| ExtraAccountMetaList | `["extra-account-metas", mint]` | Transfer Hook | per-mint (x3) |
| EpochState | `["epoch_state"]` | Epoch Program | singleton |
| CarnageFundState | `["carnage_fund"]` | Epoch Program | singleton |
| CarnageSolVault | `["carnage_sol_vault"]` | Epoch Program | singleton |
| CarnageCrimeVault | `["carnage_crime_vault"]` | Epoch Program | singleton |
| CarnageFraudVault | `["carnage_fraud_vault"]` | Epoch Program | singleton |
| CarnageSigner | `["carnage_signer"]` | Epoch Program | singleton (cross-program) |
| StakingAuthority | `["staking_authority"]` | Epoch Program | singleton (cross-program) |
| StakePool | `["stake_pool"]` | Staking | singleton |
| EscrowVault | `["escrow_vault"]` | Staking | singleton |
| StakeVault | `["stake_vault"]` | Staking | singleton |
| UserStake | `["user_stake", user_pubkey]` | Staking | per-user (unbounded) |
| VaultConfig | `["vault_config"]` | Conversion Vault | singleton |
| VaultCrimeAccount | `["vault", crime_mint]` | Conversion Vault | singleton |
| VaultFraudAccount | `["vault", fraud_mint]` | Conversion Vault | singleton |
| VaultProfitAccount | `["vault", profit_mint]` | Conversion Vault | singleton |
| BcAdminConfig | `["bc_admin"]` | Bonding Curve | singleton |
| CurveState | `["curve", token_mint]` | Bonding Curve | per-token (x2) |
| CurveTokenVault | `["curve_token_vault", token_mint]` | Bonding Curve | per-token (x2) |
| CurveSolVault | `["curve_sol_vault", token_mint]` | Bonding Curve | per-token (x2) |
| TaxEscrow | `["tax_escrow", token_mint]` | Bonding Curve | per-token (x2) |
