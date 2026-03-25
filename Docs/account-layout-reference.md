---
doc_id: account-layout-reference
title: "Dr. Fraudsworth's Finance Factory -- Account Layout Reference"
wave: 2
requires: [data-model]
provides: [account-layout-reference]
status: draft
decisions_referenced: [account-structure, architecture, cpi-architecture, token-model]
needs_verification: []
---

# Account Layout Reference

## Overview

This document provides the exact byte-level layouts for every PDA account in the Dr. Fraudsworth protocol. It is the authoritative reference for off-chain code (TypeScript SDK, indexers, clients) that needs to deserialize account data directly from Solana RPC.

All account data uses **Borsh serialization** via Anchor. Every Anchor account begins with an 8-byte discriminator (first 8 bytes of `sha256("account:<StructName>")`). Fields follow in declaration order with no padding -- Borsh is a packed format.

**Key conventions:**
- All sizes are in bytes
- Offsets start at 0 (the discriminator occupies bytes 0-7)
- `Pubkey` = 32 bytes
- `Option<Pubkey>` = 1 byte discriminant + 32 bytes = 33 bytes
- `u64` = 8 bytes (little-endian), `u128` = 16 bytes, `u32` = 4 bytes, `u16` = 2 bytes, `u8` = 1 byte, `bool` = 1 byte
- Anchor enum variants (e.g., `PoolType`) serialize as a single `u8` index

**Decision D4 (No Account Versioning):** All layouts are final. There is no version byte or migration mechanism. If a struct changes, a new program must be deployed with migration instructions.

---

## Account Map (Visual)

```
                         DR. FRAUDSWORTH PDA TREE
                         ========================

AMM Program (5ANTH...zMj)                Transfer Hook Program (CmNyu...Bsce)
 +-- AdminConfig                            +-- WhitelistAuthority
 |    seeds: ["admin"]                      |    seeds: ["authority"]
 +-- PoolState (x2)                         +-- WhitelistEntry (per address)
 |    seeds: ["pool", mint_a, mint_b]       |    seeds: ["whitelist", address]
 +-- Vault A (per pool)                     +-- ExtraAccountMetaList (per mint)
 |    seeds: ["vault", pool, "a"]                seeds: ["extra-account-metas", mint]
 +-- Vault B (per pool)
      seeds: ["vault", pool, "b"]

Conversion Vault Program (6WwVAc...WFL)
 +-- VaultConfig
 |    seeds: ["vault_config"]
 +-- vault_crime (token account)
 |    seeds: ["vault", crime_mint]
 +-- vault_fraud (token account)
 |    seeds: ["vault", fraud_mint]
 +-- vault_profit (token account)
      seeds: ["vault", profit_mint]

Tax Program (DRjNC...N8uj)                Epoch Program (G6dmJ...pUhz)
 +-- SwapAuthority *                        +-- EpochState
 |    seeds: ["swap_authority"]             |    seeds: ["epoch_state"]
 +-- TaxAuthority *                         +-- CarnageFundState
 |    seeds: ["tax_authority"]              |    seeds: ["carnage_fund"]
 +-- WsolIntermediary                       +-- CarnageSigner *
      seeds: ["wsol_intermediary"]          |    seeds: ["carnage_signer"]
                                            +-- CarnageSolVault
Staking Program (EZFeU...ZSu)              |    seeds: ["carnage_sol_vault"]
 +-- StakePool                              +-- CarnageCrimeVault
 |    seeds: ["stake_pool"]                 |    seeds: ["carnage_crime_vault"]
 +-- UserStake (per user)                   +-- CarnageFraudVault
 |    seeds: ["user_stake", user]           |    seeds: ["carnage_fraud_vault"]
 +-- EscrowVault                            +-- StakingAuthority *
 |    seeds: ["escrow_vault"]                    seeds: ["staking_authority"]
 +-- StakeVault
      seeds: ["stake_vault"]

Bonding Curve Program (AGhdA...cGsL)
 +-- BcAdminConfig
 |    seeds: ["bc_admin"]
 +-- CurveState (per token)
 |    seeds: ["curve", token_mint]
 +-- CurveTokenVault (per token)
 |    seeds: ["curve_token_vault", token_mint]
 +-- CurveSolVault (per token)
 |    seeds: ["curve_sol_vault", token_mint]
 +-- TaxEscrow (per token)
      seeds: ["tax_escrow", token_mint]

 * = Signer-only PDA (no stored data, used for CPI signing)
```

---

## Program IDs

| Program | ID | Anchor.toml Key |
|---|---|---|
| AMM | `5ANTHFtgPgH1fUMywALtrpmT7uMHfWnFbz7hxY3tLzMj` | `amm` |
| Transfer Hook | `CmNyuLdMeggHS2dKBhzPWHdeTEcpKg4uTevT5tBcBsce` | `transfer_hook` |
| Tax Program | `DRjNCjt4tfTisSJXD1VrAduKbgA7KHuGPoYwxrUQN8uj` | `tax_program` |
| Epoch Program | `G6dmJTdC36VRqqi57QhWH444Ju7ieCzHZW9yhH7TpUhz` | `epoch_program` |
| Staking | `EZFeU613CfqzNcEumE293QDmimRHyP2ZNWcbTgCQRZSu` | `staking` |
| Conversion Vault | *TBD — not yet deployed* | `conversion_vault` |

**Note:** The protocol comprises 6 programs total (5 deployed + conversion vault pending deployment).

---

## Accounts

### 1. AdminConfig (AMM Program)

| Property | Value |
|---|---|
| **Program** | AMM (`5ANTH...zMj`) |
| **Type** | Anchor `#[account]` with `#[derive(InitSpace)]` |
| **Seeds** | `["admin"]` |
| **Data Size** | 33 bytes |
| **Total Size** | 8 + 33 = **41 bytes** |
| **Rent** | ~0.001 SOL |
| **Source** | `programs/amm/src/state/admin.rs` |

**Field Layout:**

| Offset | Field | Type | Size | Description |
|--------|-------|------|------|-------------|
| 0 | discriminator | `[u8; 8]` | 8 | `sha256("account:AdminConfig")[0..8]` |
| 8 | `admin` | `Pubkey` | 32 | Admin pubkey authorized to create pools (can be multisig) |
| 40 | `bump` | `u8` | 1 | PDA bump seed |

**Lifetime:** Created once during protocol initialization by the upgrade authority via `initialize_admin`. Never closed. Admin can be burned (set to `Pubkey::default()`) via `burn_admin`.

**Growth:** Fixed size. No variable-length fields.

---

### 2. PoolState (AMM Program)

| Property | Value |
|---|---|
| **Program** | AMM (`5ANTH...zMj`) |
| **Type** | Anchor `#[account]` with `#[derive(InitSpace)]` |
| **Seeds** | `["pool", mint_a.as_ref(), mint_b.as_ref()]` |
| **Data Size** | 224 bytes (INIT_SPACE) |
| **Total Size** | 8 + 224 = **232 bytes** |
| **Rent** | ~0.00250 SOL |
| **Source** | `programs/amm/src/state/pool.rs` |

**Canonical Mint Ordering (Decision D2):** `mint_a < mint_b` is enforced on-chain by byte-wise pubkey comparison. This guarantees exactly one pool PDA per unordered mint pair.

**Field Layout:**

| Offset | Field | Type | Size | Description |
|--------|-------|------|------|-------------|
| 0 | discriminator | `[u8; 8]` | 8 | `sha256("account:PoolState")[0..8]` |
| 8 | `pool_type` | `PoolType` (enum, u8) | 1 | 0 = MixedPool (T22+SPL), 1 = PureT22Pool (T22+T22) |
| 9 | `mint_a` | `Pubkey` | 32 | First mint (canonical: `mint_a < mint_b`) |
| 41 | `mint_b` | `Pubkey` | 32 | Second mint |
| 73 | `vault_a` | `Pubkey` | 32 | PDA token account holding reserve A |
| 105 | `vault_b` | `Pubkey` | 32 | PDA token account holding reserve B |
| 137 | `reserve_a` | `u64` | 8 | Current reserve of token A |
| 145 | `reserve_b` | `u64` | 8 | Current reserve of token B |
| 153 | `lp_fee_bps` | `u16` | 2 | LP fee in basis points (100 = 1.0% for SOL pools). PROFIT pools removed — conversion now handled by fixed-rate vault. |
| 155 | `initialized` | `bool` | 1 | Whether pool has been initialized with liquidity |
| 156 | `locked` | `bool` | 1 | Reentrancy guard (defense-in-depth) |
| 157 | `bump` | `u8` | 1 | Pool PDA bump |
| 158 | `vault_a_bump` | `u8` | 1 | Vault A PDA bump (avoids re-derivation in swaps) |
| 159 | `vault_b_bump` | `u8` | 1 | Vault B PDA bump |
| 160 | `token_program_a` | `Pubkey` | 32 | Token program for mint A (SPL Token or Token-2022) |
| 192 | `token_program_b` | `Pubkey` | 32 | Token program for mint B |

**Size verification:** 1 + 32 + 32 + 32 + 32 + 8 + 8 + 2 + 1 + 1 + 1 + 1 + 1 + 32 + 32 = **224** data bytes. Total with discriminator: **232**.

**Note for off-chain readers:** The `read_pool_reserves()` helper in the Tax Program reads pool reserves directly at offsets **137** (`reserve_a`) and **145** (`reserve_b`) from the raw account data. This avoids an Anchor deserialization dependency.

**Lifetime:** Created by admin via `initialize_pool`. Protocol expects exactly 2 SOL pools (CRIME/SOL, FRAUD/SOL) + conversion vault (replaces former CRIME/PROFIT and FRAUD/PROFIT AMM pools). Never closed.

**Growth:** Fixed size.

---

### 3. Pool Vault A / Vault B (AMM Program)

| Property | Value |
|---|---|
| **Program** | AMM (PDA owner), but account is SPL Token or Token-2022 |
| **Type** | Token Account (SPL or Token-2022 depending on mint) |
| **Seeds (Vault A)** | `["vault", pool.as_ref(), "a"]` |
| **Seeds (Vault B)** | `["vault", pool.as_ref(), "b"]` |
| **Size** | 165 bytes (SPL Token) or 165+ bytes (Token-2022 with extensions) |
| **Source** | `programs/amm/src/instructions/initialize_pool.rs` |

These are standard SPL Token accounts. Their layout follows the SPL Token Account structure (not Anchor). Off-chain code should use `@solana/spl-token` deserialization, not custom byte parsing.

**Lifetime:** Created alongside the PoolState. Never closed.

---

### 4. WhitelistAuthority (Transfer Hook Program)

| Property | Value |
|---|---|
| **Program** | Transfer Hook (`CmNyu...Bsce`) |
| **Type** | Anchor `#[account]` with `#[derive(InitSpace)]` |
| **Seeds** | `["authority"]` |
| **Data Size** | 34 bytes |
| **Total Size** | 8 + 34 = **42 bytes** |
| **Rent** | ~0.001 SOL |
| **Source** | `programs/transfer-hook/src/state/whitelist_authority.rs` |

**Field Layout:**

| Offset | Field | Type | Size | Description |
|--------|-------|------|------|-------------|
| 0 | discriminator | `[u8; 8]` | 8 | `sha256("account:WhitelistAuthority")[0..8]` |
| 8 | `authority` | `Option<Pubkey>` | 33 | Authority pubkey. `None` = burned (whitelist immutable) |
| 41 | `initialized` | `bool` | 1 | Initialization flag |

**Size verification:** 33 + 1 = **34** data bytes. Total with discriminator: **42**.

**Lifetime:** Created once during protocol initialization via `initialize_authority`. Never closed. Authority can be burned (set to `None`) via `burn_authority`, making the whitelist permanently immutable.

**Growth:** Fixed size.

---

### 5. WhitelistEntry (Transfer Hook Program)

| Property | Value |
|---|---|
| **Program** | Transfer Hook (`CmNyu...Bsce`) |
| **Type** | Anchor `#[account]` with `#[derive(InitSpace)]` |
| **Seeds** | `["whitelist", address.as_ref()]` |
| **Data Size** | 40 bytes |
| **Total Size** | 8 + 40 = **48 bytes** |
| **Rent** | ~0.001 SOL |
| **Source** | `programs/transfer-hook/src/state/whitelist_entry.rs` |

**Field Layout:**

| Offset | Field | Type | Size | Description |
|--------|-------|------|------|-------------|
| 0 | discriminator | `[u8; 8]` | 8 | `sha256("account:WhitelistEntry")[0..8]` |
| 8 | `address` | `Pubkey` | 32 | Whitelisted token account pubkey (not wallet address) |
| 40 | `created_at` | `i64` | 8 | Unix timestamp when entry was created (audit trail) |

**Size verification:** 32 + 8 = **40** data bytes. Total with discriminator: **48**.

**Existence-based pattern:** If this PDA exists for an address, that address is whitelisted. PDA non-existence = not whitelisted. The transfer hook checks PDA existence at transfer time.

**Lifetime:** Created via `add_whitelist_entry`. Persists forever (no close instruction). Each whitelisted token account (vault, intermediary, etc.) gets one entry.

**Growth:** Fixed size per entry. New entries are new accounts, not growth of existing ones.

---

### 6. ExtraAccountMetaList (Transfer Hook Program)

| Property | Value |
|---|---|
| **Program** | Transfer Hook (`CmNyu...Bsce`) |
| **Type** | SPL TLV `ExtraAccountMetaList` (not an Anchor `#[account]`) |
| **Seeds** | `["extra-account-metas", mint.as_ref()]` |
| **Size** | `ExtraAccountMetaList::size_of(2)` (2 extra metas: source whitelist, dest whitelist) |
| **Source** | `programs/transfer-hook/src/instructions/initialize_extra_account_meta_list.rs` |

This account is **not** an Anchor account. It uses the SPL TLV (Type-Length-Value) format defined by `spl-tlv-account-resolution`. It stores the resolution rules for extra accounts needed by the transfer hook.

**Contents (2 extra metas):**
1. Source whitelist PDA: `["whitelist", source_token_account.key()]`
2. Destination whitelist PDA: `["whitelist", destination_token_account.key()]`

Off-chain code should use `@solana/spl-token`'s `createTransferCheckedWithTransferHookInstruction` to resolve these automatically. The resolved accounts are:
- `extra_account_meta_list` PDA
- `whitelist_source` PDA
- `whitelist_destination` PDA
- `hook_program` (the Transfer Hook program itself)

Total: **4 extra accounts per mint** (`HOOK_ACCOUNTS_PER_MINT = 4`).

**Lifetime:** Created once per T22 mint during protocol setup. Never closed. One per mint (CRIME, FRAUD, PROFIT = 3 instances).

**Growth:** Fixed after initialization.

---

### 7. EpochState (Epoch Program)

| Property | Value |
|---|---|
| **Program** | Epoch Program (`G6dmJ...pUhz`) |
| **Type** | Anchor `#[account]` (manual LEN, no InitSpace) |
| **Seeds** | `["epoch_state"]` |
| **Data Size** | 164 bytes (`EpochState::DATA_LEN`) |
| **Total Size** | 8 + 164 = **172 bytes** (`EpochState::LEN`) |
| **Rent** | ~0.00144 SOL |
| **Source** | `programs/epoch-program/src/state/epoch_state.rs` |

**Static assertion in source:** `const _: () = assert!(EpochState::DATA_LEN == 164);` (Phase 80 DEF-08)

**Field Layout:**

| Offset | Field | Type | Size | Description |
|--------|-------|------|------|-------------|
| 0 | discriminator | `[u8; 8]` | 8 | `sha256("account:EpochState")[0..8]` |
| **Timing (20 bytes)** |
| 8 | `genesis_slot` | `u64` | 8 | Slot when protocol was initialized |
| 16 | `current_epoch` | `u32` | 4 | Current epoch number (0-indexed) |
| 20 | `epoch_start_slot` | `u64` | 8 | Slot when current epoch started |
| **Tax Configuration (5 bytes)** |
| 28 | `cheap_side` | `u8` | 1 | 0 = CRIME cheap, 1 = FRAUD cheap |
| 29 | `low_tax_bps` | `u16` | 2 | Legacy field (always 0, use per-token cached fields below) |
| 31 | `high_tax_bps` | `u16` | 2 | Legacy field (always 0, use per-token cached fields below) |
| **Derived Tax Rates -- Cached (8 bytes)** |
| 33 | `crime_buy_tax_bps` | `u16` | 2 | **ACTIVE** CRIME buy tax rate (independently derived from VRF bytes 1-2) |
| 35 | `crime_sell_tax_bps` | `u16` | 2 | **ACTIVE** CRIME sell tax rate (independently derived from VRF bytes 1-2) |
| 37 | `fraud_buy_tax_bps` | `u16` | 2 | **ACTIVE** FRAUD buy tax rate (independently derived from VRF bytes 3-4) |
| 39 | `fraud_sell_tax_bps` | `u16` | 2 | **ACTIVE** FRAUD sell tax rate (independently derived from VRF bytes 3-4) |
| **VRF State (42 bytes)** |
| 41 | `vrf_request_slot` | `u64` | 8 | Slot when VRF was committed (0 = none) |
| 49 | `vrf_pending` | `bool` | 1 | VRF request pending |
| 50 | `taxes_confirmed` | `bool` | 1 | Taxes confirmed for current epoch |
| 51 | `pending_randomness_account` | `Pubkey` | 32 | Switchboard randomness account (anti-reroll) |
| **Carnage State (23 bytes)** |
| 83 | `carnage_pending` | `bool` | 1 | Carnage execution pending |
| 84 | `carnage_target` | `u8` | 1 | Target: 0 = CRIME, 1 = FRAUD |
| 85 | `carnage_action` | `u8` | 1 | Action: 0 = None, 1 = Burn, 2 = Sell |
| 86 | `carnage_deadline_slot` | `u64` | 8 | Slot deadline for fallback Carnage |
| 94 | `carnage_lock_slot` | `u64` | 8 | Slot until which only atomic Carnage can execute |
| 102 | `last_carnage_epoch` | `u32` | 4 | Last epoch when Carnage triggered |
| **Reserved Padding (64 bytes -- Phase 80 DEF-03)** |
| 106 | `reserved` | `[u8; 64]` | 64 | Future schema evolution padding (zeroed on init) |
| **Protocol (2 bytes)** |
| 170 | `initialized` | `bool` | 1 | Initialization flag |
| 171 | `bump` | `u8` | 1 | PDA bump |

**Size verification:** 8 + 4 + 8 + 1 + 2 + 2 + 2 + 2 + 2 + 2 + 8 + 1 + 1 + 32 + 1 + 1 + 1 + 8 + 8 + 4 + 64 + 1 + 1 = **164** data bytes. Total: **172**.

**Cross-program mirror:** The Tax Program maintains a read-only mirror struct (`tax-program/src/state/epoch_state_reader.rs`) with identical field ordering for cross-program deserialization. The struct name must be `EpochState` in both programs because Anchor's discriminator is derived from `sha256("account:EpochState")`.

**Lifetime:** Created once during protocol initialization via `initialize_epoch_state`. Never closed.

**Growth:** Fixed size.

---

### 8. CarnageFundState (Epoch Program)

| Property | Value |
|---|---|
| **Program** | Epoch Program (`G6dmJ...pUhz`) |
| **Type** | Anchor `#[account]` (manual LEN) |
| **Seeds** | `["carnage_fund"]` |
| **Data Size** | 139 bytes (`CarnageFundState::DATA_LEN`) |
| **Total Size** | 8 + 139 = **147 bytes** (`CarnageFundState::LEN`) |
| **Rent** | ~0.00187 SOL |
| **Source** | `programs/epoch-program/src/state/carnage_fund_state.rs` |

**Static assertions in source:**
- `const _: () = assert!(CarnageFundState::DATA_LEN == 139);`
- `const _: () = assert!(CarnageFundState::LEN == 8 + CarnageFundState::DATA_LEN);`

**Field Layout:**

| Offset | Field | Type | Size | Description |
|--------|-------|------|------|-------------|
| 0 | discriminator | `[u8; 8]` | 8 | `sha256("account:CarnageFundState")[0..8]` |
| **Vault PDAs (96 bytes)** |
| 8 | `sol_vault` | `Pubkey` | 32 | SOL vault PDA address (SystemAccount) |
| 40 | `crime_vault` | `Pubkey` | 32 | CRIME token vault PDA address (Token-2022) |
| 72 | `fraud_vault` | `Pubkey` | 32 | FRAUD token vault PDA address (Token-2022) |
| **Current Holdings (13 bytes)** |
| 104 | `held_token` | `u8` | 1 | 0 = None, 1 = CRIME, 2 = FRAUD (see `HeldToken` enum) |
| 105 | `held_amount` | `u64` | 8 | Amount of held token (0 if held_token = None) |
| **Timing (4 bytes)** |
| 113 | `last_trigger_epoch` | `u32` | 4 | Last epoch when Carnage triggered |
| **Lifetime Statistics (28 bytes) -- Decision D1: legacy write-only counters** |
| 117 | `total_sol_spent` | `u64` | 8 | Lifetime SOL spent on buys (lamports) |
| 125 | `total_crime_burned` | `u64` | 8 | Lifetime CRIME burned |
| 133 | `total_fraud_burned` | `u64` | 8 | Lifetime FRAUD burned |
| 141 | `total_triggers` | `u32` | 4 | Lifetime trigger count |
| **Protocol (2 bytes)** |
| 145 | `initialized` | `bool` | 1 | Initialization flag |
| 146 | `bump` | `u8` | 1 | PDA bump |

**Size verification:** 32 + 32 + 32 + 1 + 8 + 4 + 8 + 8 + 8 + 4 + 1 + 1 = **139** data bytes. Total: **147**.

**Decision D1 note:** The 4 statistics fields (`total_sol_spent`, `total_crime_burned`, `total_fraud_burned`, `total_triggers`) are legacy write-only counters. They are updated on-chain but never read by any program logic. They exist for off-chain analytics only.

**Lifetime:** Created once during protocol initialization via `initialize_carnage_fund`. Never closed.

**Growth:** Fixed size.

---

### 9. Carnage SOL Vault (Epoch Program)

| Property | Value |
|---|---|
| **Program** | Epoch Program (`G6dmJ...pUhz`) (PDA owner) |
| **Type** | SystemAccount (native SOL) |
| **Seeds** | `["carnage_sol_vault"]` |
| **Size** | 0 bytes (SystemAccount, balance only) |
| **Source** | `programs/epoch-program/src/constants.rs` |

A bare SystemAccount PDA that holds native SOL for the Carnage Fund. SOL is deposited by the Tax Program's fee distribution (24% of tax to Carnage; tax split is 71% staking / 24% Carnage / 5% treasury). SOL is spent during Carnage buy operations.

**Lifetime:** Created (funded) during protocol initialization. Persists forever.

---

### 10. Carnage CRIME Vault / Carnage FRAUD Vault (Epoch Program)

| Property | Value |
|---|---|
| **Program** | Epoch Program (`G6dmJ...pUhz`) (PDA owner) |
| **Type** | Token-2022 token accounts |
| **Seeds (CRIME)** | `["carnage_crime_vault"]` |
| **Seeds (FRAUD)** | `["carnage_fraud_vault"]` |
| **Size** | 165+ bytes (Token-2022 token account with extensions) |
| **Source** | `programs/epoch-program/src/instructions/initialize_carnage_fund.rs` |

Standard Token-2022 token accounts holding tokens purchased during Carnage triggers. Off-chain code should use `@solana/spl-token` for deserialization.

**Lifetime:** Created during `initialize_carnage_fund`. Never closed.

---

### 11. StakePool (Staking Program)

| Property | Value |
|---|---|
| **Program** | Staking (`EZFeU...ZSu`) |
| **Type** | Anchor `#[account]` (manual LEN) |
| **Seeds** | `["stake_pool"]` |
| **Data Size** | 54 bytes |
| **Total Size** | 8 + 54 = **62 bytes** (`StakePool::LEN`) |
| **Rent** | ~0.00112 SOL |
| **Source** | `programs/staking/src/state/stake_pool.rs` |

**Field Layout:**

| Offset | Field | Type | Size | Description |
|--------|-------|------|------|-------------|
| 0 | discriminator | `[u8; 8]` | 8 | `sha256("account:StakePool")[0..8]` |
| 8 | `total_staked` | `u64` | 8 | Total PROFIT currently staked across all users |
| 16 | `rewards_per_token_stored` | `u128` | 16 | Cumulative rewards per token, scaled by PRECISION (1e18) |
| 32 | `pending_rewards` | `u64` | 8 | SOL rewards accumulated this epoch (reset after update) |
| 40 | `last_update_epoch` | `u32` | 4 | Last epoch when cumulative was updated |
| 44 | `total_distributed` | `u64` | 8 | Lifetime SOL distributed (analytics) |
| 52 | `total_claimed` | `u64` | 8 | Lifetime SOL claimed (analytics) |
| 60 | `initialized` | `bool` | 1 | Initialization flag |
| 61 | `bump` | `u8` | 1 | PDA bump |

**Size verification:** 8 + 16 + 8 + 4 + 8 + 8 + 1 + 1 = **54** data bytes. Total: **62**.

**Lifetime:** Created once during protocol initialization via `initialize_stake_pool`. Never closed. Singleton global state.

**Growth:** Fixed size.

---

### 12. UserStake (Staking Program)

| Property | Value |
|---|---|
| **Program** | Staking (`EZFeU...ZSu`) |
| **Type** | Anchor `#[account]` (manual LEN) |
| **Seeds** | `["user_stake", user_pubkey.as_ref()]` |
| **Data Size** | 97 bytes |
| **Total Size** | 8 + 97 = **105 bytes** (`UserStake::LEN`) |
| **Rent** | ~0.00163 SOL |
| **Source** | `programs/staking/src/state/user_stake.rs` |

**Field Layout:**

| Offset | Field | Type | Size | Description |
|--------|-------|------|------|-------------|
| 0 | discriminator | `[u8; 8]` | 8 | `sha256("account:UserStake")[0..8]` |
| 8 | `owner` | `Pubkey` | 32 | Owner wallet pubkey (validated on unstake/claim) |
| 40 | `staked_balance` | `u64` | 8 | PROFIT staked |
| 48 | `rewards_per_token_paid` | `u128` | 16 | User's rewards checkpoint |
| 64 | `rewards_earned` | `u64` | 8 | Accumulated unclaimed rewards |
| 72 | `total_claimed` | `u64` | 8 | Lifetime SOL claimed (analytics) |
| 80 | `first_stake_slot` | `u64` | 8 | Slot of first stake (set once) |
| 88 | `last_update_slot` | `u64` | 8 | Slot of last interaction |
| 96 | `last_claim_ts` | `i64` | 8 | Unix timestamp of last claim (0 = never claimed) |
| 104 | `bump` | `u8` | 1 | PDA bump |

**Size verification:** 32 + 8 + 16 + 8 + 8 + 8 + 8 + 8 + 1 = **97** data bytes. Total: **105**.

**Decision D3 (UserStake persists forever):** ~0.00163 SOL permanent rent per user. There is no close instruction. This is intentional to preserve reward accounting integrity.

**Lifetime:** Created on first `stake` instruction for a user. Never closed.

**Growth:** Fixed size per user. New users = new accounts.

---

### 13. Escrow Vault (Staking Program)

| Property | Value |
|---|---|
| **Program** | Staking (`EZFeU...ZSu`) (PDA owner) |
| **Type** | SystemAccount (native SOL) |
| **Seeds** | `["escrow_vault"]` |
| **Size** | 0 bytes (SystemAccount, balance only) |
| **Source** | `programs/staking/src/constants.rs` |

Holds undistributed SOL rewards (71% of tax revenue). SOL is deposited by Tax Program via `deposit_rewards` CPI and withdrawn by users via `claim`.

**Lifetime:** Created during `initialize_stake_pool`. Persists forever.

---

### 14. Stake Vault (Staking Program)

| Property | Value |
|---|---|
| **Program** | Staking (`EZFeU...ZSu`) (PDA owner) |
| **Type** | Token-2022 token account (PROFIT token) |
| **Seeds** | `["stake_vault"]` |
| **Size** | 165+ bytes (Token-2022 token account) |
| **Source** | `programs/staking/src/constants.rs` |

Holds all staked PROFIT tokens. Users deposit PROFIT via `stake` and withdraw via `unstake`.

**Lifetime:** Created during `initialize_stake_pool`. Persists forever.

---

### 15. WSOL Intermediary (Tax Program)

| Property | Value |
|---|---|
| **Program** | Tax Program (`DRjNC...N8uj`) (PDA, owned by SPL Token) |
| **Type** | SPL Token Account (WSOL / Native Mint) |
| **Seeds** | `["wsol_intermediary"]` |
| **Size** | **165 bytes** (standard SPL Token Account) |
| **Rent** | ~0.00204 SOL |
| **Source** | `programs/tax-program/src/instructions/initialize_wsol_intermediary.rs` |

This is a standard SPL Token account (not Token-2022) at a PDA address. It holds WSOL during the sell flow's transfer-close-distribute-reinit cycle. The token account owner is the `swap_authority` PDA.

**Lifetime:** Created once during protocol deployment via `initialize_wsol_intermediary`. Persists forever. Gets closed and re-initialized during each sell swap cycle.

---

## Signer-Only PDAs (No Stored Data)

These PDAs exist only for CPI signing authority. They have no on-chain account data -- they are derived, never `init`'d, and used solely in `seeds::program` constraints.

### 16. SwapAuthority (Tax Program)

| Property | Value |
|---|---|
| **Seeds** | `["swap_authority"]` |
| **Derived From** | Tax Program (`DRjNC...N8uj`) |
| **Purpose** | Signs CPI calls from Tax Program to AMM for swap execution |
| **Cross-program** | AMM validates via `seeds::program = TAX_PROGRAM_ID` |

Both the Tax Program and AMM define `SWAP_AUTHORITY_SEED = b"swap_authority"`. The PDA is derived from the Tax Program's ID. The AMM accepts this PDA as a signer, gating all swap execution to the Tax Program.

### 17. TaxAuthority (Tax Program)

| Property | Value |
|---|---|
| **Seeds** | `["tax_authority"]` |
| **Derived From** | Tax Program (`DRjNC...N8uj`) |
| **Purpose** | Signs CPI calls from Tax Program to Staking Program for `deposit_rewards` |
| **Cross-program** | Staking validates via `seeds::program = tax_program_id()` |

### 18. CarnageSigner (Epoch Program)

| Property | Value |
|---|---|
| **Seeds** | `["carnage_signer"]` |
| **Derived From** | Epoch Program (`G6dmJ...pUhz`) |
| **Purpose** | Signs CPI calls from Epoch Program to Tax Program for `swap_exempt` |
| **Cross-program** | Tax Program validates via `seeds::program = epoch_program_id()` |

### 19. StakingAuthority (Epoch Program)

| Property | Value |
|---|---|
| **Seeds** | `["staking_authority"]` |
| **Derived From** | Epoch Program (`G6dmJ...pUhz`) |
| **Purpose** | Signs CPI calls from Epoch Program to Staking Program for `update_cumulative` |
| **Cross-program** | Staking validates via `seeds::program = epoch_program_id()` |

---

## Conversion Vault Accounts

### 20. VaultConfig (Conversion Vault Program)

| Property | Value |
|---|---|
| **Program** | Conversion Vault (*TBD*) |
| **Type** | Anchor `#[account]` |
| **Seeds** | `["vault_config"]` |
| **Source** | `programs/conversion-vault/src/state/vault_config.rs` (planned) |

Stores the fixed conversion rate (100:1) and vault bump seeds. Created once during protocol initialization. The conversion rate is hardcoded and immutable -- there is no admin function to change it.

**Lifetime:** Created once during protocol initialization. Never closed. No upgrade path.

### 21-23. Vault Token Accounts (Conversion Vault Program)

| Property | Value |
|---|---|
| **Program** | Conversion Vault (*TBD*) (PDA owner) |
| **Type** | Token-2022 token accounts |
| **Seeds** | `["vault", mint.key().as_ref()]` |
| **Instances** | 3 (vault_crime, vault_fraud, vault_profit) |
| **Source** | `programs/conversion-vault/src/instructions/initialize_vault.rs` (planned) |

Three token accounts holding the vault's reserves:
- **vault_crime**: Seeded with 250M CRIME. Receives CRIME on CRIME-to-PROFIT conversions.
- **vault_fraud**: Seeded with 250M FRAUD. Receives FRAUD on FRAUD-to-PROFIT conversions.
- **vault_profit**: Seeded with 20M PROFIT. Distributes PROFIT on inbound conversions.

All conversions use a fixed rate: 100 CRIME = 1 PROFIT = 100 FRAUD (immutable).

**Lifetime:** Created during vault initialization. Never closed.

---

## Rent Costs Summary

| Account | Total Size (bytes) | Approx. Rent (SOL) | Quantity | Subtotal (SOL) |
|---|---|---|---|---|
| AdminConfig | 41 | 0.00100 | 1 | 0.00100 |
| PoolState | 224 | 0.00240 | 2 | 0.00480 |
| Pool Vault (token acct) | 165 | 0.00204 | 4 | 0.00816 |
| WhitelistAuthority | 42 | 0.00100 | 1 | 0.00100 |
| WhitelistEntry | 48 | 0.00105 | 15 | ~0.01575 |
| ExtraAccountMetaList | ~100 | ~0.00159 | 3 | ~0.00477 |
| EpochState | 172 | 0.00187 | 1 | 0.00187 |
| CarnageFundState | 147 | 0.00187 | 1 | 0.00187 |
| Carnage SOL Vault | 0 | 0.00089 | 1 | 0.00089 |
| Carnage Token Vaults | 165+ | ~0.00204 | 2 | ~0.00408 |
| StakePool | 62 | 0.00112 | 1 | 0.00112 |
| UserStake | 105 | 0.00163 | per user | 0.00163/user |
| Escrow Vault | 0 | 0.00089 | 1 | 0.00089 |
| Stake Vault | 165+ | ~0.00204 | 1 | ~0.00204 |
| WSOL Intermediary | 165 | 0.00204 | 1 | 0.00204 |
| VaultConfig | ~50 | ~0.00100 | 1 | ~0.00100 |
| Vault Token Accounts | 165+ | ~0.00204 | 3 | ~0.00612 |
| **Protocol Total (fixed)** | | | | **~0.068 SOL** |
| **Per-user cost** | | | | **0.00156 SOL** |

**Note:** Rent amounts are approximate. The exact formula is `minimum_balance = max(1, data_length) * 6960 + 890880` lamports. Signer-only PDAs (SwapAuthority, TaxAuthority, CarnageSigner, StakingAuthority) have no on-chain account and cost 0 rent.

---

## PDA Derivation Tree

This section provides the exact derivation code for every PDA in the protocol. Use these to derive PDA addresses in TypeScript/off-chain code.

### AMM Program PDAs

```typescript
// AdminConfig
const [adminPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("admin")],
  AMM_PROGRAM_ID
);

// PoolState (canonical ordering: mint_a < mint_b by bytes)
const [mintA, mintB] = mint1.toBuffer().compare(mint2.toBuffer()) < 0
  ? [mint1, mint2] : [mint2, mint1];
const [poolPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("pool"), mintA.toBuffer(), mintB.toBuffer()],
  AMM_PROGRAM_ID
);

// Vault A
const [vaultA] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault"), poolPda.toBuffer(), Buffer.from("a")],
  AMM_PROGRAM_ID
);

// Vault B
const [vaultB] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault"), poolPda.toBuffer(), Buffer.from("b")],
  AMM_PROGRAM_ID
);
```

### Transfer Hook Program PDAs

```typescript
// WhitelistAuthority
const [authorityPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("authority")],
  TRANSFER_HOOK_PROGRAM_ID
);

// WhitelistEntry
const [entryPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("whitelist"), tokenAccountPubkey.toBuffer()],
  TRANSFER_HOOK_PROGRAM_ID
);

// ExtraAccountMetaList
const [metaListPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("extra-account-metas"), mintPubkey.toBuffer()],
  TRANSFER_HOOK_PROGRAM_ID
);
```

### Epoch Program PDAs

```typescript
// EpochState
const [epochStatePda] = PublicKey.findProgramAddressSync(
  [Buffer.from("epoch_state")],
  EPOCH_PROGRAM_ID
);

// CarnageFundState
const [carnageFundPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("carnage_fund")],
  EPOCH_PROGRAM_ID
);

// CarnageSigner (signer-only PDA)
const [carnageSignerPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("carnage_signer")],
  EPOCH_PROGRAM_ID
);

// Carnage SOL Vault
const [carnageSolVaultPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("carnage_sol_vault")],
  EPOCH_PROGRAM_ID
);

// Carnage CRIME Vault
const [carnageCrimeVaultPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("carnage_crime_vault")],
  EPOCH_PROGRAM_ID
);

// Carnage FRAUD Vault
const [carnageFraudVaultPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("carnage_fraud_vault")],
  EPOCH_PROGRAM_ID
);

// StakingAuthority (signer-only PDA)
const [stakingAuthorityPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("staking_authority")],
  EPOCH_PROGRAM_ID
);
```

### Tax Program PDAs

```typescript
// SwapAuthority (signer-only PDA)
const [swapAuthorityPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("swap_authority")],
  TAX_PROGRAM_ID
);

// TaxAuthority (signer-only PDA)
const [taxAuthorityPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("tax_authority")],
  TAX_PROGRAM_ID
);

// WSOL Intermediary
const [wsolIntermediaryPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("wsol_intermediary")],
  TAX_PROGRAM_ID
);
```

### Staking Program PDAs

```typescript
// StakePool
const [stakePoolPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("stake_pool")],
  STAKING_PROGRAM_ID
);

// UserStake
const [userStakePda] = PublicKey.findProgramAddressSync(
  [Buffer.from("user_stake"), userWalletPubkey.toBuffer()],
  STAKING_PROGRAM_ID
);

// Escrow Vault (SOL)
const [escrowVaultPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("escrow_vault")],
  STAKING_PROGRAM_ID
);

// Stake Vault (PROFIT token)
const [stakeVaultPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("stake_vault")],
  STAKING_PROGRAM_ID
);
```

### Conversion Vault Program PDAs

```typescript
// VaultConfig
const [vaultConfigPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault_config")],
  CONVERSION_VAULT_PROGRAM_ID
);

// Vault token account (per mint: CRIME, FRAUD, PROFIT)
const [vaultTokenPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault"), mintPubkey.toBuffer()],
  CONVERSION_VAULT_PROGRAM_ID
);
```

---

## Account Validation Checklist

This checklist documents the on-chain validation enforced for each account type. All validations are encoded as Anchor constraints in instruction `#[derive(Accounts)]` structs.

### Discriminator Validation
All Anchor `#[account]` types automatically validate the 8-byte discriminator. If the account has a different discriminator (wrong account type), the instruction fails with `AccountDiscriminatorMismatch`.

### PDA Seed Validation
All PDA accounts use Anchor `seeds` constraints with `bump`. This validates:
- The account is at the correct derived address
- The seeds match the expected derivation
- No attacker-controlled account can be substituted

### Cross-Program PDA Gates (Decision: CPI Architecture D5)

| Gate | Signer PDA | Derived From | Validates At |
|---|---|---|---|
| Tax -> AMM (swaps) | `swap_authority` | Tax Program | AMM `seeds::program = TAX_PROGRAM_ID` |
| Tax -> Staking (deposit_rewards) | `tax_authority` | Tax Program | Staking `seeds::program = tax_program_id()` |
| Epoch -> Tax (swap_exempt) | `carnage_signer` | Epoch Program | Tax `seeds::program = epoch_program_id()` |
| Epoch -> Staking (update_cumulative) | `staking_authority` | Epoch Program | Staking `seeds::program = epoch_program_id()` |

### Ownership Validation
- Token accounts: Owner validated as expected PDA (pool PDA for vault accounts, swap_authority for WSOL intermediary)
- UserStake: `owner` field validated against signer on `unstake` and `claim`
- PoolState: `locked` reentrancy guard checked at swap entry

### Initialization Guards
- `AdminConfig`, `WhitelistAuthority`, `EpochState`, `CarnageFundState`, `StakePool`: All have `initialized: bool` flag to prevent re-initialization
- Anchor `init` constraint on account creation prevents account reuse

### Canonical Mint Ordering
- PoolState PDA derivation includes both mints in canonical order (`mint_a < mint_b`)
- `initialize_pool` instruction enforces `mint_a < mint_b` or fails
- This makes it impossible to create duplicate pools for the same pair

---

## Appendix: Borsh Serialization Notes

1. **Anchor enum serialization:** Enum variants are serialized as a single `u8` index (0, 1, 2, ...). This applies to `PoolType` (offset 8 in PoolState). Enums stored as `u8` fields (e.g., `cheap_side`, `held_token`, `carnage_target`, `carnage_action`) are manually converted using `from_u8()` / `to_u8()` helper methods rather than native Borsh enum serialization.

2. **`Option<Pubkey>` serialization:** 1 byte discriminant (0 = None, 1 = Some) followed by 32 bytes of pubkey data (only meaningful if discriminant = 1). Total: 33 bytes. Used by `WhitelistAuthority.authority`.

3. **`u128` alignment:** Borsh does NOT add alignment padding. A `u128` at any offset occupies exactly 16 bytes starting at that offset. This differs from C struct alignment. Relevant for `StakePool.rewards_per_token_stored` (offset 16) and `UserStake.rewards_per_token_paid` (offset 48).

4. **No padding between fields:** Borsh serialization packs fields contiguously. There is no padding between fields of different sizes. The offsets in this document account for this.

5. **Little-endian:** All integer types (`u16`, `u32`, `u64`, `u128`) are serialized in little-endian byte order.

---

## Appendix: Whitelist Entry #13 -- Reserve Vault

Whitelist entry #13 is the "Reserve vault" referenced in the Transfer Hook Spec (Section 6.1). This is a protocol-owned token account intended to hold tokens during the bonding curve to AMM pool transition at launch. It enables the initialization script to transfer seed liquidity tokens through the hook-protected mints. The reserve vault will be created and whitelisted during the bonding curve launch phase (planned Phase 53+). It is not yet deployed on devnet.

## Appendix: Bonding Curve Accounts

**Program ID:** `AGhdAyBgfpNhZ3jzQR4D2pH7BTxsiGTcJRYWqsn7cGsL`

### BcAdminConfig Layout

| Offset | Size | Field | Type | Notes |
|--------|------|-------|------|-------|
| 0 | 8 | discriminator | [u8; 8] | `sha256("account:BcAdminConfig")[0..8]` |
| 8 | 32 | authority | Pubkey | Admin pubkey (Pubkey::default() after burn) |
| 40 | 1 | bump | u8 | PDA bump seed |
| **Total** | **41** | | | |

Seeds: `["bc_admin"]`

### CurveState Layout

| Offset | Size | Field | Type | Notes |
|--------|------|-------|------|-------|
| 0 | 8 | discriminator | [u8; 8] | `sha256("account:CurveState")[0..8]` |
| 8 | 1 | token | Token (u8) | 0=Crime, 1=Fraud |
| 9 | 32 | token_mint | Pubkey | Mint address |
| 41 | 32 | token_vault | Pubkey | Token vault PDA |
| 73 | 32 | sol_vault | Pubkey | SOL vault PDA |
| 105 | 8 | tokens_sold | u64 | Current tokens sold |
| 113 | 8 | sol_raised | u64 | Total SOL raised |
| 121 | 1 | status | CurveStatus (u8) | 0=Init, 1=Active, 2=Filled, 3=Failed, 4=Graduated |
| 122 | 8 | start_slot | u64 | Curve start slot |
| 130 | 8 | deadline_slot | u64 | Deadline slot |
| 138 | 4 | participant_count | u32 | Unique buyers |
| 142 | 8 | tokens_returned | u64 | Cumulative sells |
| 150 | 8 | sol_returned | u64 | Cumulative SOL returned |
| 158 | 8 | tax_collected | u64 | Cumulative tax |
| 166 | 32 | tax_escrow | Pubkey | Tax escrow PDA |
| 198 | 1 | bump | u8 | PDA bump |
| 199 | 1 | escrow_consolidated | bool | Consolidation flag |
| 200 | 32 | partner_mint | Pubkey | Partner curve's token mint |
| **Total** | **232** | | | 8 discriminator + 224 data |

Seeds: `["curve", token_mint.as_ref()]`

### TaxEscrow

0-byte SOL-only PDA. Balance is tracked by account lamports, not data fields.

Seeds: `["tax_escrow", token_mint.as_ref()]`
