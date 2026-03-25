---
doc_id: cpi-interface-contract
title: "Dr. Fraudsworth's Finance Factory -- CPI Interface Contract"
wave: 2
requires: [architecture]
provides: [cpi-interface-contract]
status: draft
decisions_referenced: [cpi-architecture, amm-design, security, architecture]
needs_verification: []
---

# CPI Interface Contract

## Overview

This document defines the exact interface contract for every cross-program invocation (CPI) in Dr. Fraudsworth's Finance Factory. The protocol comprises 7 programs connected by 23 CPI call sites (the Conversion Vault and Bonding Curve are leaf nodes with no CPI surface — they are called directly by users), forming an acyclic directed graph with a maximum depth of 4 (the Solana hard limit). The Tax Program is the busiest CPI caller with 14 call sites.

**An engineer should be able to write correct CPI calls from this document alone.**

All CPI calls use manual `invoke_signed` with raw instruction construction. Anchor's CPI helpers are intentionally avoided because they do not properly forward `remaining_accounts` through nested CPI chains, which is required for Token-2022 transfer hooks.

### Program IDs (Devnet)

| Program | ID | Role |
|---------|-----|------|
| AMM | `5ANTHFtgPgH1fUMywALtrpmT7uMHfWnFbz7hxY3tLzMj` | Constant-product swaps (Uniswap V2 fork) |
| Tax Program | `DRjNCjt4tfTisSJXD1VrAduKbgA7KHuGPoYwxrUQN8uj` | Asymmetric tax + distribution |
| Epoch Program | `G6dmJTdC36VRqqi57QhWH444Ju7ieCzHZW9yhH7TpUhz` | VRF-driven epoch transitions + Carnage |
| Staking | `EZFeU613CfqzNcEumE293QDmimRHyP2ZNWcbTgCQRZSu` | PROFIT staking for SOL game rewards |
| Transfer Hook | `CmNyuLdMeggHS2dKBhzPWHdeTEcpKg4uTevT5tBcBsce` | Whitelist-gated transfer enforcement |
| Conversion Vault | `6WwVAc12B5x8gukgNyXa4agUyvi9PxdYTdPdnb9qEWFL` | Fixed-rate 100:1 token conversion |
| Bonding Curve | `AGhdAyBgfpNhZ3jzQR4D2pH7BTxsiGTcJRYWqsn7cGsL` | Dual linear bonding curve launch |

### Instruction Discriminators

All discriminators are the first 8 bytes of `sha256("global:<instruction_name>")`.

| Instruction | Discriminator (hex) |
|---|---|
| `swap_sol_pool` | `de 80 1e 7b 55 27 91 8a` |
| `swap_exempt` | `f4 5f 5a 24 99 a0 37 0c` |
| `deposit_rewards` | `34 f9 70 48 ce a1 c4 01` |
| `update_cumulative` | `93 84 db 65 a5 17 3d 71` |

---

## Program Interaction Map

```
                            +-----------------+
                            | Switchboard VRF |
                            | (3rd party)     |
                            +--------+--------+
                                     |
                                     | read randomness
                                     v
+--------+    swap_exempt CPI   +---------+   update_cumulative CPI   +---------+
| AMM    | <-----------------  |  Epoch   | -----------------------> | Staking |
|        |                     | Program  |                          |         |
+---^----+                     +----------+                          +----^----+
    |                                                                     |
    | swap_sol_pool CPI                                                   |
    |                              deposit_rewards CPI                    |
    |                          +-------------------------------------+    |
    +--------------------------+        Tax Program                  +----+
                               |  (14 CPI call sites)               |
                               +---^--------------------------------+
                                   |
                                   | user entry (swap_sol_buy, swap_sol_sell)
                                   |
                               +---+----+
                               |  User  |
                               +--------+

    AMM -> Token-2022 -> Transfer Hook (terminal, zero outbound CPIs)

    CPI Depth Ceiling (Carnage path):
      Epoch::execute_carnage_atomic (entry, depth 0)
        -> Tax::swap_exempt (depth 1)
          -> AMM::swap_sol_pool (depth 2)
            -> Token-2022::transfer_checked (depth 3)
              -> Transfer Hook::execute (depth 4 -- SOLANA LIMIT)

    Conversion Vault (leaf node, no CPI surface):
      User calls Vault::convert directly → Token-2022::transfer_checked × 2
      NOT part of the CPI graph above — vault receives no CPIs from protocol programs
```

---

## Cross-Program PDA Gates

Four PDA-gated access control boundaries protect all cross-program calls. Each gate uses `seeds::program` to cryptographically bind the PDA to its originating program.

| Gate Name | PDA Seeds | Derived From | Validated By | Purpose |
|-----------|-----------|--------------|--------------|---------|
| SwapAuthority | `[b"swap_authority"]` | Tax Program | AMM | Only Tax Program can initiate AMM swaps |
| CarnageSigner | `[b"carnage_signer"]` | Epoch Program | Tax Program | Only Epoch Program can call swap_exempt |
| TaxAuthority | `[b"tax_authority"]` | Tax Program | Staking | Only Tax Program can call deposit_rewards |
| StakingAuthority | `[b"staking_authority"]` | Epoch Program | Staking | Only Epoch Program can call update_cumulative |

---

## Interfaces

### Tax Program -> AMM: `swap_sol_pool` CPI

#### When Called

Every user-initiated SOL pool swap: `swap_sol_buy` (direction=AtoB), `swap_sol_sell` (direction=BtoA), and Carnage's `swap_exempt` (either direction).

#### Accounts Passed

The account ordering must exactly match AMM's `SwapSolPool` struct:

| # | Name | Type | Mut | Signer | Description |
|---|------|------|-----|--------|-------------|
| 0 | swap_authority | AccountInfo | no | **yes** | Tax Program PDA, signs via `invoke_signed` |
| 1 | pool | AccountInfo | **yes** | no | AMM PoolState PDA |
| 2 | vault_a | InterfaceAccount<TokenAccount> | **yes** | no | Pool's WSOL vault |
| 3 | vault_b | InterfaceAccount<TokenAccount> | **yes** | no | Pool's CRIME/FRAUD vault |
| 4 | mint_a | InterfaceAccount<Mint> | no | no | WSOL mint |
| 5 | mint_b | InterfaceAccount<Mint> | no | no | CRIME or FRAUD mint (Token-2022) |
| 6 | user_token_a | InterfaceAccount<TokenAccount> | **yes** | no | User's (or Carnage's) WSOL account |
| 7 | user_token_b | InterfaceAccount<TokenAccount> | **yes** | no | User's (or Carnage's) CRIME/FRAUD account |
| 8 | user | Signer | no | **yes** | User wallet (or carnage_signer PDA for swap_exempt) |
| 9 | token_program_a | Interface<TokenInterface> | no | no | SPL Token (for WSOL) |
| 10 | token_program_b | Interface<TokenInterface> | no | no | Token-2022 (for CRIME/FRAUD) |
| 11+ | remaining_accounts | AccountInfo[] | varies | no | Transfer Hook accounts (4 per T22 mint in the transfer) |

#### Signer Seeds

```rust
// Tax Program's swap_authority PDA
let swap_authority_seeds: &[&[u8]] = &[
    b"swap_authority",  // SWAP_AUTHORITY_SEED
    &[bump],            // from ctx.bumps.swap_authority
];
```

#### Data Fields

```
[discriminator: 8 bytes] [amount_in: u64 LE] [direction: u8] [minimum_amount_out: u64 LE]
```

- `discriminator`: `[0xde, 0x80, 0x1e, 0x7b, 0x55, 0x27, 0x91, 0x8a]` (sha256 of `"global:swap_sol_pool"`)
- `direction`: 0 = AtoB (SOL->Token, buy), 1 = BtoA (Token->SOL, sell)
- For `swap_exempt`: `minimum_amount_out` is always 0 (Carnage accepts market execution)

#### AMM-Side Validation

The AMM validates `swap_authority` with:
```rust
#[account(
    seeds = [SWAP_AUTHORITY_SEED],  // b"swap_authority"
    bump,
    seeds::program = TAX_PROGRAM_ID,  // hardcoded Tax Program pubkey
)]
pub swap_authority: Signer<'info>,
```

Additionally: pool PDA seeds verified (`[b"pool", mint_a, mint_b]`), vault keys matched against pool state, token programs matched against pool state, `pool.initialized == true`, `pool.locked == false` (reentrancy guard).

#### Return Value

No explicit return value. Caller measures output via balance-diff pattern:
1. Snapshot output token account `.amount` before CPI
2. Execute CPI
3. `.reload()` the output token account
4. `tokens_received = post_amount - pre_amount`

#### Failure Handling

AMM errors propagate back to Tax Program. Key errors:
- `AmmError::PoolNotInitialized` -- pool PDA not initialized
- `AmmError::PoolLocked` -- reentrancy guard tripped
- `AmmError::ZeroAmount` -- amount_in is 0
- `AmmError::SlippageExceeded` -- output below minimum
- `AmmError::KInvariantViolation` -- constant-product math failure
- `AmmError::VaultMismatch` -- vault substitution attack detected
- `AmmError::InvalidMint` -- wrong mint passed
- `AmmError::InvalidTokenProgram` -- wrong token program

#### Transfer Hook Account Forwarding (SOL Pools)

SOL pools have one T22 side (CRIME/FRAUD) and one SPL side (WSOL). The AMM routes:
- T22 side: calls `transfer_t22_checked` with `remaining_accounts` as hook accounts
- SPL side: calls `transfer_spl` (no hook accounts)

The 4 hook accounts per T22 mint are:
1. `extra_account_meta_list` PDA: `[b"extra-account-metas", mint.key()]` derived from Hook Program
2. `whitelist_source` PDA: `[b"whitelist", source_token.key()]` derived from Hook Program
3. `whitelist_destination` PDA: `[b"whitelist", dest_token.key()]` derived from Hook Program
4. Transfer Hook program ID (`CmNyuLdMeggHS2dKBhzPWHdeTEcpKg4uTevT5tBcBsce`)

---

### Tax Program -> AMM: `swap_profit_pool` CPI (REMOVED)

> **Historical note:** The `swap_profit_pool` CPI interface was removed when PROFIT AMM pools were replaced by the Conversion Vault. The vault uses direct user calls (not CPI) with a fixed 100:1 conversion rate. See the Conversion Vault section below for the replacement interface.

---

### Tax Program -> Staking: `deposit_rewards` CPI

#### When Called

During every taxed swap (`swap_sol_buy` and `swap_sol_sell`) when `staking_portion > 0`. Called AFTER the SOL has been transferred to the escrow vault via `system_instruction::transfer`.

#### Accounts Passed

| # | Name | Type | Mut | Signer | Description |
|---|------|------|-----|--------|-------------|
| 0 | tax_authority | AccountInfo | no | **yes** | Tax Program's PDA, signs via `invoke_signed` |
| 1 | stake_pool | Account<StakePool> | **yes** | no | Staking global state (pending_rewards updated) |
| 2 | escrow_vault | AccountInfo | no | no | SOL escrow PDA (read for balance reconciliation) |

#### Signer Seeds

```rust
// Tax Program's tax_authority PDA
let tax_authority_seeds: &[&[u8]] = &[
    b"tax_authority",   // TAX_AUTHORITY_SEED
    &[bump],            // from ctx.bumps.tax_authority
];
```

#### Data Fields

```
[discriminator: 8 bytes] [amount: u64 LE]
```

- `discriminator`: `[0x34, 0xf9, 0x70, 0x48, 0xce, 0xa1, 0xc4, 0x01]` (sha256 of `"global:deposit_rewards"`)
- `amount`: SOL amount in lamports that was transferred to escrow

#### Staking-Side Validation

```rust
#[account(
    seeds = [b"tax_authority"],
    bump,
    seeds::program = tax_program_id(),  // Tax Program ID
)]
pub tax_authority: Signer<'info>,
```

After incrementing `pending_rewards`, the Staking Program performs balance reconciliation:
```rust
require!(escrow_vault.lamports() >= pool.pending_rewards, StakingError::InsufficientEscrowBalance);
```

#### Pre-conditions

1. SOL must be transferred to `escrow_vault` BEFORE this CPI call
2. `stake_pool.initialized == true`
3. `amount > 0`

#### Failure Handling

- `StakingError::ZeroAmount` -- amount is 0
- `StakingError::Overflow` -- pending_rewards would overflow u64
- `StakingError::InsufficientEscrowBalance` -- escrow balance < pending_rewards (silent transfer failure detected)
- Constraint failure (implicit) -- caller is not Tax Program

---

### Epoch Program -> Staking: `update_cumulative` CPI

#### When Called

During `consume_randomness` after VRF bytes are read and new tax rates are derived. Finalizes the previous epoch's rewards by moving `pending_rewards` into cumulative `rewards_per_token_stored`.

#### Accounts Passed

| # | Name | Type | Mut | Signer | Description |
|---|------|------|-----|--------|-------------|
| 0 | epoch_authority | AccountInfo | no | **yes** | Epoch Program's staking_authority PDA |
| 1 | stake_pool | Account<StakePool> | **yes** | no | Staking global state |

#### Signer Seeds

```rust
// Epoch Program's staking_authority PDA
let staking_authority_seeds: &[&[u8]] = &[
    b"staking_authority",  // STAKING_AUTHORITY_SEED
    &[bump],               // from ctx.bumps.staking_authority
];
```

#### Data Fields

```
[discriminator: 8 bytes] [epoch: u32 LE]
```

- `discriminator`: `[0x93, 0x84, 0xdb, 0x65, 0xa5, 0x17, 0x3d, 0x71]` (sha256 of `"global:update_cumulative"`)
- `epoch`: The epoch number being finalized (from `epoch_state.current_epoch`)

#### Staking-Side Validation

```rust
#[account(
    seeds = [b"staking_authority"],
    bump,
    seeds::program = epoch_program_id(),  // Epoch Program ID
)]
pub epoch_authority: Signer<'info>,
```

Additionally: `epoch > pool.last_update_epoch` (prevents double-update).

#### Cumulative Math

```rust
reward_per_token = (pending_rewards as u128) * PRECISION / (total_staked as u128)
// PRECISION = 1e18
rewards_per_token_stored += reward_per_token
pending_rewards = 0
last_update_epoch = epoch
```

#### Failure Handling

- `StakingError::AlreadyUpdated` -- epoch <= last_update_epoch (idempotency guard)
- `StakingError::Overflow` -- arithmetic overflow in u128 multiplication
- `StakingError::DivisionByZero` -- total_staked is 0 (prevented by dead stake of 1 PROFIT at init)

---

### Epoch Program -> Tax Program: `swap_exempt` CPI

#### When Called

During `execute_carnage_atomic` for Carnage Fund rebalancing. Two possible calls per Carnage trigger:
1. **Sell swap** (if action=Sell): sell held tokens for WSOL (direction=1, BtoA)
2. **Buy swap** (always): buy target tokens with WSOL (direction=0, AtoB)

#### Accounts Passed

Account ordering matches Tax Program's `SwapExempt` struct:

| # | Name | Type | Mut | Signer | Description |
|---|------|------|-----|--------|-------------|
| 0 | carnage_authority | Signer | no | **yes** | Epoch Program's carnage_signer PDA |
| 1 | swap_authority | AccountInfo | no | no | Tax Program's swap_authority PDA (forwarded to AMM) |
| 2 | pool | AccountInfo | **yes** | no | Target AMM PoolState |
| 3 | pool_vault_a | InterfaceAccount<TokenAccount> | **yes** | no | Pool's WSOL vault |
| 4 | pool_vault_b | InterfaceAccount<TokenAccount> | **yes** | no | Pool's CRIME/FRAUD vault |
| 5 | mint_a | InterfaceAccount<Mint> | no | no | WSOL mint |
| 6 | mint_b | InterfaceAccount<Mint> | no | no | CRIME or FRAUD mint (Token-2022) |
| 7 | user_token_a | InterfaceAccount<TokenAccount> | **yes** | no | Carnage's WSOL account (carnage_wsol) |
| 8 | user_token_b | InterfaceAccount<TokenAccount> | **yes** | no | Carnage's CRIME or FRAUD vault |
| 9 | amm_program | AccountInfo | no | no | AMM Program ID |
| 10 | token_program_a | Interface<TokenInterface> | no | no | SPL Token (for WSOL) |
| 11 | token_program_b | Interface<TokenInterface> | no | no | Token-2022 (for CRIME/FRAUD) |
| 12 | system_program | Program<System> | no | no | System Program |
| 13+ | remaining_accounts | AccountInfo[] | varies | no | Transfer Hook accounts (4 per T22 mint) |

#### Signer Seeds

```rust
// Epoch Program's carnage_signer PDA
let carnage_signer_seeds: &[&[u8]] = &[
    b"carnage_signer",  // CARNAGE_SIGNER_SEED
    &[bump],            // from ctx.bumps.carnage_signer
];
```

#### Data Fields

```
[discriminator: 8 bytes] [amount_in: u64 LE] [direction: u8] [is_crime: u8 (bool)]
```

- `discriminator`: `[0xf4, 0x5f, 0x5a, 0x24, 0x99, 0xa0, 0x37, 0x0c]` (sha256 of `"global:swap_exempt"`)
- `direction`: 0 = AtoB (buy), 1 = BtoA (sell)
- `is_crime`: 1 = CRIME pool, 0 = FRAUD pool

#### Tax-Side Validation

```rust
#[account(
    seeds = [b"carnage_signer"],
    bump,
    seeds::program = epoch_program_id(),  // Epoch Program ID
)]
pub carnage_authority: Signer<'info>,
```

#### CPI Depth Budget

This is the deepest CPI chain in the protocol:
```
execute_carnage_atomic (depth 0)
  -> Tax::swap_exempt (depth 1)
    -> AMM::swap_sol_pool (depth 2)
      -> Token-2022::transfer_checked (depth 3)
        -> Transfer Hook::execute (depth 4 -- SOLANA LIMIT)
```

**DO NOT add any CPI calls to this path.** SOL wrapping (system_program::transfer + sync_native) occurs at depth 0 BEFORE the swap chain, so it does not impact depth.

#### Hook Account Partitioning for Carnage

For `execute_carnage_atomic`, remaining_accounts are partitioned differently depending on the action:

- **Sell + Buy**: `remaining_accounts = [sell_hook_accounts(4), buy_hook_accounts(4)]`
  - First 4 for the sell swap's T22 token
  - Last 4 for the buy swap's T22 token
- **Burn + Buy** or **BuyOnly**: `remaining_accounts = [buy_hook_accounts(4)]`
  - Token-2022 burns do NOT trigger transfer hooks
  - All remaining_accounts go to the buy swap

```rust
const HOOK_ACCOUNTS_PER_MINT: usize = 4;

let (sell_hook_accounts, buy_hook_accounts) =
    if matches!(action, CarnageAction::Sell) && remaining.len() >= 8 {
        (&remaining[..4], &remaining[4..])
    } else {
        (&remaining[..0], remaining)  // all for buy
    };
```

#### Failure Handling

Tax Program errors from swap_exempt propagate back to Epoch:
- `TaxError::InsufficientInput` -- amount_in is 0
- `TaxError::InvalidPoolType` -- direction not 0 or 1
- AMM errors propagate through Tax to Epoch

---

### Epoch Program -> Token-2022: `burn` CPI

#### When Called

During `execute_carnage_atomic` when `action == CarnageAction::Burn` and held tokens exist. Burns all tokens held in the Carnage vault.

#### Accounts Passed

| # | Name | Type | Mut | Signer | Description |
|---|------|------|-----|--------|-------------|
| 0 | account | AccountInfo (vault) | **yes** | no | Carnage's CRIME or FRAUD vault |
| 1 | mint | AccountInfo | **yes** | no | The corresponding token mint |
| 2 | authority | AccountInfo (carnage_state) | no | **yes** | CarnageFundState PDA (vault owner) |

#### Signer Seeds

```rust
// CarnageFundState PDA (owns the token vaults)
let carnage_state_seeds: &[&[u8]] = &[
    b"carnage_fund",       // CARNAGE_FUND_SEED
    &[carnage_state.bump],
];
```

#### Data Fields

Raw SPL Token-2022 Burn instruction:
```
[8u8 (Burn discriminator)] [amount: u64 LE]
```

#### Important Notes

- Token-2022 burns do NOT trigger transfer hooks, so no hook accounts are needed
- Burns do NOT add CPI depth to the Carnage swap chain
- After burn, `carnage_state.held_token = 0`, `carnage_state.held_amount = 0`
- Statistics updated: `total_crime_burned` or `total_fraud_burned` incremented

---

### Epoch Program -> Token-2022: `approve` CPI

#### When Called

During `execute_carnage_atomic` when `action == CarnageAction::Sell` and held tokens exist. Approves `carnage_signer` as a delegate on the held token vault before the sell swap.

This is needed because the token vaults are owned by `carnage_state` PDA, but `swap_exempt` uses `carnage_signer` as the user authority. Token-2022's `transfer_checked` accepts a delegate with sufficient allowance.

#### Accounts Passed

| # | Name | Type | Mut | Signer | Description |
|---|------|------|-----|--------|-------------|
| 0 | source | AccountInfo (vault) | **yes** | no | Carnage's CRIME or FRAUD vault |
| 1 | delegate | AccountInfo | no | no | carnage_signer PDA (the delegate) |
| 2 | owner | AccountInfo (carnage_state) | no | **yes** | CarnageFundState PDA (vault owner) |

#### Signer Seeds

```rust
let carnage_state_seeds: &[&[u8]] = &[b"carnage_fund", &[carnage_state.bump]];
```

#### Data Fields

```
[4u8 (Approve discriminator)] [amount: u64 LE]
```

Executes at depth 0 -- no impact on the swap CPI chain.

---

### Epoch Program -> System Program: SOL Transfer (Bounty)

#### When Called

During `trigger_epoch_transition`, after epoch boundary validation. Pays 0.001 SOL bounty to the caller from the Carnage SOL vault.

#### Accounts Passed

Standard `system_instruction::transfer` accounts:

| # | Name | Type | Mut | Signer | Description |
|---|------|------|-----|--------|-------------|
| 0 | carnage_sol_vault | SystemAccount | **yes** | **yes** (PDA) | Source of bounty funds |
| 1 | payer | AccountInfo | **yes** | no | Bounty recipient (triggerer) |
| 2 | system_program | Program<System> | no | no | System Program |

#### Signer Seeds

```rust
let signer_seeds: &[&[u8]] = &[b"carnage_sol_vault", &[vault_bump]];
```

#### Data Fields

Standard system transfer instruction with amount = `TRIGGER_BOUNTY_LAMPORTS` (1,000,000 lamports = 0.001 SOL).

#### Graceful Degradation

If the vault balance is insufficient (`< TRIGGER_BOUNTY_LAMPORTS`), the bounty is skipped (no error). The epoch transition proceeds normally without payment. This prevents protocol deadlock if the Carnage vault is empty.

---

### Epoch Program -> System Program: SOL Wrapping (Carnage)

#### When Called

During `execute_carnage_atomic` in the buy step, wrapping native SOL from `sol_vault` into WSOL in `carnage_wsol` for the AMM swap.

#### Step 1: System Transfer

| # | Name | Type | Mut | Signer | Description |
|---|------|------|-----|--------|-------------|
| 0 | sol_vault | SystemAccount | **yes** | **yes** (PDA) | Carnage SOL vault |
| 1 | carnage_wsol | AccountInfo | **yes** | no | Carnage's WSOL token account |
| 2 | system_program | Program<System> | no | no | System Program |

```rust
let sol_vault_seeds: &[&[u8]] = &[b"carnage_sol_vault", &[sol_vault_bump]];
```

#### Step 2: SyncNative

After transferring lamports to the WSOL token account, `SyncNative` updates the SPL token balance:

```rust
let sync_native_ix = Instruction {
    program_id: token_program_a.key(),       // SPL Token
    accounts: vec![AccountMeta::new(carnage_wsol.key(), false)],
    data: vec![17u8],                         // SyncNative discriminator
};
```

SyncNative is permissionless -- no signer needed.

Both calls execute at depth 0 BEFORE the swap chain, so they do not impact the CPI depth budget.

---

### Tax Program -> System Program: Tax Distribution

#### When Called

During `swap_sol_buy`: user signs SOL transfers directly (no PDA needed for SOL source).
During `swap_sol_sell`: swap_authority PDA signs after WSOL close-and-unwrap.

#### Distribution Split

| Destination | Percentage | Seeds | Derived From |
|-------------|-----------|-------|--------------|
| Staking Escrow | 71% (7100 bps) | `[b"escrow_vault"]` | Staking Program |
| Carnage SOL Vault | 24% (2400 bps) | `[b"carnage_sol_vault"]` | Epoch Program |
| Treasury | 5% (500 bps) | Hardcoded address | N/A |

For amounts below `MICRO_TAX_THRESHOLD` (4 lamports), all tax goes to staking to avoid dust distribution.

#### Buy Flow (user signs)

```rust
// No PDA signer needed -- user is the SOL source
invoke_signed(
    &system_instruction::transfer(user.key, staking_escrow.key, staking_portion),
    &[user, staking_escrow, system_program],
    &[],  // user signs, no PDA signature
)?;
```

#### Sell Flow (swap_authority signs)

After WSOL intermediary close-and-unwrap, native SOL is in swap_authority:
```rust
invoke_signed(
    &system_instruction::transfer(swap_authority.key, staking_escrow.key, staking_portion),
    &[swap_authority, staking_escrow, system_program],
    &[&[b"swap_authority", &[bump]]],  // PDA signs
)?;
```

---

### Tax Program -> SPL Token: WSOL Intermediary Lifecycle (Sell Flow)

#### When Called

During `swap_sol_sell` for the tax extraction from WSOL swap output. This is a 4-step atomic sequence:

#### Step 1: SPL Token Transfer (user -> intermediary)

```rust
// SPL Token Transfer discriminator = 3
let transfer_tax_ix = Instruction {
    program_id: token_program_a.key(),
    accounts: vec![
        AccountMeta::new(user_token_a.key(), false),        // source
        AccountMeta::new(wsol_intermediary.key(), false),    // destination
        AccountMeta::new_readonly(user.key(), true),         // authority (user signs)
    ],
    data: { let mut d = vec![3u8]; d.extend_from_slice(&tax_amount.to_le_bytes()); d },
};
invoke(&transfer_tax_ix, ...)?;  // user signs (no invoke_signed needed)
```

#### Step 2: Close Intermediary (unwrap WSOL)

```rust
// CloseAccount discriminator = 9
let close_ix = Instruction {
    program_id: token_program_a.key(),
    accounts: vec![
        AccountMeta::new(wsol_intermediary.key(), false),            // account to close
        AccountMeta::new(swap_authority.key(), false),               // lamports destination
        AccountMeta::new_readonly(swap_authority.key(), true),       // owner (swap_authority)
    ],
    data: vec![9u8],
};
invoke_signed(&close_ix, ..., &[&[b"swap_authority", &[bump]]])?;
```

#### Step 3: Native SOL Distribution

Three `system_instruction::transfer` calls from swap_authority to staking/carnage/treasury (see Tax Distribution above).

#### Step 4: Recreate Intermediary

```rust
// create_account at PDA address, then InitializeAccount3 (discriminator 18)
let intermediary_seeds: &[&[u8]] = &[b"wsol_intermediary", &[intermediary_bump]];
// Both swap_authority (funder) and wsol_intermediary (PDA) must sign create_account
invoke_signed(&create_ix, ..., &[swap_authority_seeds, intermediary_seeds])?;

// InitializeAccount3: owner as data, no rent sysvar needed
let init_ix = Instruction {
    program_id: token_program_a.key(),
    accounts: vec![
        AccountMeta::new(wsol_intermediary.key(), false),
        AccountMeta::new_readonly(mint_a.key(), false),  // WSOL mint
    ],
    data: { let mut d = vec![18u8]; d.extend_from_slice(&swap_authority.key().to_bytes()); d },
};
invoke(&init_ix, ...)?;
```

---

### AMM -> Token-2022: `transfer_checked` with Hook Accounts

#### When Called

During every AMM swap that involves a Token-2022 token (CRIME, FRAUD, PROFIT). Both input transfer (user->vault) and output transfer (vault->user) use this pattern when the token is T22.

#### Implementation: `transfer_t22_checked` Helper

The AMM uses a custom `transfer_t22_checked` helper (in `programs/amm/src/helpers/transfers.rs`) that builds a raw `spl_token_2022::instruction::transfer_checked` instruction and manually appends hook accounts:

```rust
pub fn transfer_t22_checked<'info>(
    token_program: &AccountInfo<'info>,  // must be Token-2022
    from: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    amount: u64,
    decimals: u8,
    signer_seeds: &[&[&[u8]]],          // empty for user-signed, populated for PDA-signed
    hook_accounts: &[AccountInfo<'info>], // Transfer Hook extra accounts
) -> Result<()>
```

#### Why Manual CPI

Anchor's `token_interface::transfer_checked` with `with_remaining_accounts` does NOT properly forward `remaining_accounts` through the nested CPI chain (AMM -> Token-2022 -> Transfer Hook). The hook accounts must appear in both the instruction's `accounts` keys AND the `account_infos` array. Anchor's CPI framework only adds them to the context but not to the raw instruction keys.

#### Hook Account Structure

For each Token-2022 transfer, 4 extra accounts are appended:

| # | Account | Derivation | Purpose |
|---|---------|-----------|---------|
| 0 | extra_account_meta_list | `[b"extra-account-metas", mint.key()]` from Hook Program | Token-2022 resolves extra accounts from this PDA |
| 1 | whitelist_source | `[b"whitelist", source_token.key()]` from Hook Program | Whitelist check for source |
| 2 | whitelist_destination | `[b"whitelist", dest_token.key()]` from Hook Program | Whitelist check for destination |
| 3 | hook_program | Transfer Hook program ID | Token-2022 CPIs into this program |

#### Security Invariants

- Always uses `transfer_checked` (never plain `transfer`). Plain `transfer` silently bypasses T22 hooks, which would skip whitelist enforcement.
- Token program ID verified to be `spl_token_2022::ID` before CPI
- Amount verified > 0

---

### Token-2022 -> Transfer Hook: `execute` (Implicit CPI)

#### When Called

Token-2022 automatically invokes the Transfer Hook program during every `transfer_checked` call on mints that have the TransferHook extension configured. This is NOT a CPI initiated by protocol code -- it is an implicit CPI by the Token-2022 runtime.

#### Accounts (SPL Transfer Hook Spec)

| Index | Account | Description |
|-------|---------|-------------|
| 0 | source_token_account | Token account being debited |
| 1 | mint | The token mint |
| 2 | destination_token_account | Token account being credited |
| 3 | owner/authority | Transfer authority |
| 4 | extra_account_meta_list | PDA with extra account definitions |
| 5 | whitelist_source | Resolved: `[b"whitelist", source_token.key()]` |
| 6 | whitelist_destination | Resolved: `[b"whitelist", dest_token.key()]` |

#### Hook Logic

1. Reject zero-amount transfers
2. Verify mint is owned by Token-2022 (defense-in-depth)
3. Verify `transferring` flag is set on source token (prevents direct invocation)
4. Check whitelist: source OR destination must have a valid WhitelistEntry PDA

```rust
fn is_whitelisted(whitelist_pda: &AccountInfo, token_account: &Pubkey) -> bool {
    if whitelist_pda.data_is_empty() { return false; }
    let (expected_pda, _) = Pubkey::find_program_address(
        &[b"whitelist", token_account.as_ref()],
        &crate::ID
    );
    whitelist_pda.key() == expected_pda
}
```

#### Terminal Node

The Transfer Hook is a terminal CPI node -- it makes zero outbound CPIs. This is architecturally critical because it sits at CPI depth 4 (the Solana maximum) on the Carnage path. Any CPI from within the hook would exceed the depth limit.

---

## Security Model

### Signer Authority

Every cross-program call is protected by PDA-gated access control. The protocol uses four distinct PDA gates (documented above in Cross-Program PDA Gates). Each gate uses the `seeds::program` Anchor constraint to cryptographically bind the PDA to its originating program.

**Key principle:** The validating program hardcodes the calling program's ID, not vice versa. For example, the AMM has `TAX_PROGRAM_ID` as a constant (`pubkey!("DRjNCjt4tfTisSJXD1VrAduKbgA7KHuGPoYwxrUQN8uj")`). If the Tax Program is redeployed to a different address, the AMM would reject all swap calls until its constant is updated and redeployed too.

**Cross-program seed synchronization requirements:**

| Seed | Programs that must agree | Risk if mismatched |
|------|------------------------|--------------------|
| `b"swap_authority"` | Tax Program, AMM | All swaps fail |
| `b"carnage_signer"` | Epoch Program, Tax Program | All Carnage swaps fail |
| `b"tax_authority"` | Tax Program, Staking | All deposit_rewards fail |
| `b"staking_authority"` | Epoch Program, Staking | All update_cumulative fail |
| `b"stake_pool"` | Tax Program, Staking | Tax PDA address validation fails |
| `b"escrow_vault"` | Tax Program, Staking | Escrow PDA address validation fails |
| `b"carnage_sol_vault"` | Tax Program, Epoch Program | Carnage vault PDA validation fails |

### Re-entrancy Considerations

Re-entrancy is **structurally impossible** due to the acyclic CPI graph. No program can call itself through any chain of CPIs. The call graph is a strict DAG:

```
Epoch -> Tax -> AMM -> Token-2022 -> Hook (terminal)
Epoch -> Staking (terminal -- no outbound CPIs to other protocol programs)
Tax -> Staking (terminal)

  Conversion Vault
    └─► Token-2022 (transfer_checked × 2, leaf node)
```

The AMM retains a `pool.locked` boolean reentrancy guard as **defense-in-depth**. It is set to `true` at the start of every swap and cleared after all transfers complete. This guard catches hypothetical re-entrancy vectors that could arise if the CPI graph were modified in a future update.

### Account Confusion Risks

**EpochState spoofing:** The Tax Program reads `EpochState` to determine tax rates. A fake EpochState with 0% tax would eliminate protocol revenue. This is mitigated by:
1. Owner check: `epoch_state.owner == &epoch_program_id()` (AccountInfo.owner is set by the runtime, not the account data)
2. Discriminator check: `EpochState::try_deserialize` validates the Anchor discriminator
3. Initialized flag: `epoch_state.initialized == true`

**Vault substitution:** The AMM validates all vaults against pool state:
```rust
constraint = vault_a.key() == pool.vault_a @ AmmError::VaultMismatch
constraint = vault_b.key() == pool.vault_b @ AmmError::VaultMismatch
```

**Token program substitution:** The AMM validates token programs against pool state:
```rust
constraint = token_program_a.key() == pool.token_program_a @ AmmError::InvalidTokenProgram
constraint = token_program_b.key() == pool.token_program_b @ AmmError::InvalidTokenProgram
```

**Mint substitution:** The AMM validates mints against pool state:
```rust
constraint = mint_a.key() == pool.mint_a @ AmmError::InvalidMint
constraint = mint_b.key() == pool.mint_b @ AmmError::InvalidMint
```

---

### Staking -> Token-2022: `transfer_checked` with Hook Accounts

#### When Called

During `stake` (user -> stake_vault) and `unstake` (stake_vault -> user). Both transfer PROFIT tokens (Token-2022 with TransferHook extension).

**Note:** `unstake` only transfers PROFIT tokens back to the user — it does NOT transfer SOL. The `escrow_vault` account is not passed for unstake (only needed for `claim` and `deposit_rewards`). Unstake forfeits pending rewards by adding `rewards_earned` to `pool.pending_rewards`. No SOL CPI occurs during unstake.

#### Implementation: `transfer_checked_with_hook` Helper

The Staking Program uses the same manual CPI pattern as the AMM (`programs/staking/src/helpers/transfer.rs`). It builds a raw `spl_token_2022::instruction::transfer_checked` instruction, appends hook accounts from `remaining_accounts` to both the instruction keys and `account_infos`, then calls `invoke_signed`.

- **Stake**: User is the authority (non-PDA), so `signer_seeds` is empty (`&[]`). The user signs the transaction directly.
- **Unstake**: `stake_pool` PDA is the authority (owns the stake_vault). Signs via `invoke_signed` with seeds `[b"stake_pool", &[bump]]`.

The 4 hook accounts (ExtraAccountMetaList, whitelist_source, whitelist_dest, hook_program) are passed as `remaining_accounts` by the client, identical to AMM swap hook accounts. Anchor's built-in `transfer_checked` is not used for the same reason as the AMM: it does not forward `remaining_accounts` to `invoke_signed`, breaking Transfer Hook execution.

---

### Tax Program: Cross-Program EpochState Read

#### When Called

During every taxed swap (`swap_sol_buy`, `swap_sol_sell`). The Tax Program reads the Epoch Program's `EpochState` account to determine the current tax rates (cheap_side, low/high tax BPS, per-token cached rates).

#### Implementation: Anchor Deserialization with Owner Check

The `epoch_state` account is passed as a raw `AccountInfo` (not a typed Anchor account) to avoid cross-crate dependency on the Epoch Program. Validation is a 3-step process:

1. **Owner check**: `epoch_state.owner == &epoch_program_id()` -- the runtime-set `owner` field confirms the account is owned by the Epoch Program, preventing a fake EpochState with 0% tax.
2. **Discriminator check**: `EpochState::try_deserialize(&mut data_slice)` validates the 8-byte Anchor discriminator (`sha256("account:EpochState")[0..8]`), rejecting any account that is not an EpochState.
3. **Initialized flag**: `epoch_state.initialized == true` (defense-in-depth against uninitialized PDAs).

The Tax Program maintains a local mirror struct (`programs/tax-program/src/state/epoch_state_reader.rs`) that exactly replicates the Epoch Program's `EpochState` layout (100 bytes + 8-byte discriminator). The struct name `EpochState` must match exactly because the Anchor discriminator is derived from `sha256("account:EpochState")`.

**Note:** This is distinct from the Tax Program's `pool_reader.rs` which reads AMM PoolState at raw byte offsets (137-153) without deserialization. The EpochState read uses full Anchor deserialization because the Tax Program needs multiple fields (tax rates), whereas pool_reader only needs reserve values.

---

### Conversion Vault: `convert` (Direct User Call)

#### When Called

When a user converts CRIME or FRAUD to PROFIT (or vice versa) via the conversion vault. This is a direct user transaction, NOT a CPI from another protocol program. The vault is a leaf node in the protocol architecture.

#### Accounts

| # | Name | Type | Mut | Signer | Description |
|---|------|------|-----|--------|-------------|
| 0 | user | Signer | no | **yes** | User wallet |
| 1 | vault_config | Account<VaultConfig> | no | no | Vault configuration PDA |
| 2 | user_input_token | InterfaceAccount<TokenAccount> | **yes** | no | User's source token account (CRIME, FRAUD, or PROFIT) |
| 3 | user_output_token | InterfaceAccount<TokenAccount> | **yes** | no | User's destination token account |
| 4 | vault_input_token | InterfaceAccount<TokenAccount> | **yes** | no | Vault's source token account |
| 5 | vault_output_token | InterfaceAccount<TokenAccount> | **yes** | no | Vault's destination token account |
| 6 | input_mint | InterfaceAccount<Mint> | no | no | Input token mint |
| 7 | output_mint | InterfaceAccount<Mint> | no | no | Output token mint |
| 8 | token_program | Interface<TokenInterface> | no | no | Token-2022 |
| 9+ | remaining_accounts | AccountInfo[] | varies | no | Transfer Hook accounts (4 per mint x 2 transfers = 8 total) |

#### Key Properties

- **No PDA gate**: Users call the vault directly. No SwapAuthority or other CPI gate needed.
- **Fixed rate**: 100 input tokens = 1 output token (CRIME/FRAUD -> PROFIT) or 1 input = 100 output (PROFIT -> CRIME/FRAUD).
- **Zero fees**: No tax, no LP fee, no protocol fee.
- **Zero slippage**: Deterministic output amount. No bonding curve math.
- **Leaf node**: The vault calls Token-2022 `transfer_checked` only. It receives no CPIs from other protocol programs.
- **CPI depth**: Max depth 2 (Vault -> Token-2022 -> Transfer Hook). Well under the depth-4 limit.

---

## Third-Party Program Dependencies

### SPL Token Program (spl-token)

Used for WSOL transfers (non-T22). Standard `transfer_checked` CPI via Anchor's `token_interface::transfer_checked`. No hook support needed for WSOL.

### Token-2022 Program (spl-token-2022)

Used for CRIME, FRAUD, and PROFIT token transfers. All transfers MUST use `transfer_checked` (never `transfer`) to ensure Transfer Hook enforcement. The protocol uses manual CPI construction to properly forward hook accounts.

### Switchboard On-Demand VRF

Used by the Epoch Program for randomness. The protocol interacts with Switchboard via:
1. **Client-side:** Creates randomness account (TX1), bundles commit/reveal instructions (TX2, TX3)
2. **On-chain:** Reads `RandomnessAccountData` from the Switchboard-owned account, validates owner against `SWITCHBOARD_PROGRAM_ID` (feature-gated for devnet/mainnet)

The Epoch Program does NOT CPI into Switchboard. It only reads data from Switchboard-owned accounts. The Switchboard SDK instructions (commit, reveal) are built client-side and bundled in the same transaction as protocol instructions.

### System Program

Used for:
- Native SOL transfers (tax distribution, bounty payments, SOL wrapping)
- Account creation (WSOL intermediary re-creation in sell flow)

Standard Solana System Program -- no special integration concerns.
