---
doc_id: token-interaction-matrix
title: "Dr. Fraudsworth's Finance Factory -- Token Interaction Matrix"
wave: 4
requires: []
provides: [token-interaction-matrix]
status: draft
decisions_referenced: [token-model, cpi-architecture, amm-design, security]
needs_verification: []
---

# Token Interaction Matrix

## Overview

Dr. Fraudsworth's Finance Factory operates 4 tokens across 2 incompatible Solana token programs (Token-2022 and SPL Token). Three tokens (CRIME, FRAUD, PROFIT) use Token-2022 with transfer hooks that enforce a whitelist -- every transfer of these tokens triggers a hook that must validate at least one party is a protocol-controlled PDA. The fourth token (WSOL) uses the legacy SPL Token program, which has no hook mechanism at all.

This creates a matrix of 16 possible token-pair interactions, each with different hook behavior, different CPI requirements, and different failure modes. An incorrect understanding of which hooks fire, in which order, and with which accounts leads to one of three outcomes: silent fund locking, atomic transaction revert, or -- in the worst case -- whitelist bypass.

This document is the single source of truth for:
1. Which operations trigger transfer hooks and which do not
2. How `remaining_accounts` are structured for single-hook vs dual-hook pools
3. The direction-dependent hook account ordering that is the protocol's most common integration footgun
4. Every edge case where tokens can move without hooks (burns, SOL wrapping, reward distribution)

**Source code references**: `programs/transfer-hook/src/instructions/transfer_hook.rs`, `programs/amm/src/instructions/swap_sol_pool.rs`, `programs/conversion-vault/src/instructions/convert.rs`, `programs/amm/src/helpers/transfers.rs`, `Docs/Transfer_Hook_Spec.md`.


## Token Registry

| Token  | Program     | Mint (Devnet)                            | Transfer Hook? | Decimals | Total Supply    | Mint Authority | Extensions                |
|--------|-------------|------------------------------------------|----------------|----------|-----------------|----------------|---------------------------|
| CRIME  | Token-2022  | `8NEgQ...` (8NEgQ)                       | Yes            | 6        | 1,000,000,000   | Burned         | TransferHook, MetadataPointer |
| FRAUD  | Token-2022  | `76ddo...` (76ddo)                       | Yes            | 6        | 1,000,000,000   | Burned         | TransferHook, MetadataPointer |
| PROFIT | Token-2022  | `7X6xx...` (7X6xx)                       | Yes            | 6        | 20,000,000      | Burned         | TransferHook, MetadataPointer |
| WSOL   | SPL Token   | `So11111111111111111111111111111111` (native) | **No**     | 9        | N/A (wrapped)   | N/A            | None (standard SPL Token) |

**Key distinction**: WSOL is the only token in the system that uses SPL Token (program `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`). All three protocol tokens use Token-2022 (program `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`). This means WSOL transfers never trigger the transfer hook program, even when the WSOL vault address is whitelisted. The whitelist entries for WSOL pool vaults (entries #2 and #4) exist so that CRIME/FRAUD/PROFIT tokens can be transferred TO those vaults during swaps -- the whitelist check runs on the T22 token being moved, not on WSOL.


## Pool Configuration

| Pool          | Token A (mint_a) | Token B (mint_b) | Pool Type    | LP Fee   | Token Program A | Token Program B | Hook Accounts in `remaining_accounts` |
|---------------|-------------------|-------------------|--------------|----------|-----------------|-----------------|---------------------------------------|
| CRIME/WSOL    | WSOL              | CRIME             | MixedPool    | 100 bps (1.0%) | SPL Token       | Token-2022      | 4 (single hook, T22 side only)        |
| FRAUD/WSOL    | WSOL              | FRAUD             | MixedPool    | 100 bps (1.0%) | SPL Token       | Token-2022      | 4 (single hook, T22 side only)        |

**Canonical mint ordering**: On-chain enforced `mint_a < mint_b` (byte-wise Pubkey comparison). This determines PDA derivation (`seeds = [b"pool", mint_a, mint_b]`). Pool state stores both `token_program_a` and `token_program_b` pubkeys, validated on every swap via Anchor constraints.

**Fee source**: `programs/amm/src/constants.rs` -- `SOL_POOL_FEE_BPS = 100`.

**PROFIT Conversion**: PROFIT is not acquired via AMM pools. The Conversion Vault program replaces the former CRIME/PROFIT and FRAUD/PROFIT pools with a deterministic 100:1 fixed-rate conversion (100 CRIME or 100 FRAUD -> 1 PROFIT). The vault has zero fees and zero slippage. See `programs/conversion-vault/src/instructions/convert.rs` and the Conversion Vault section below for details.


## Interaction Matrix

### Transfer Rules by Token Pair

This matrix shows whether a transfer of the ROW token (source/destination) involving the COLUMN address type is allowed by the transfer hook. "Allowed" means the hook validates successfully (at least one side is whitelisted). "Blocked" means the hook rejects with `NoWhitelistedParty`. "N/A" means the hook does not fire at all.

| Token \ Destination | SOL Pool Vault (A) | SOL Pool Vault (B) | Vault CRIME Account | Vault FRAUD Account | Vault PROFIT Account | Carnage Vault | Stake Vault | Bonding Curve Vault | Reserve Vault | User Wallet (non-whitelisted) |
|--------------------|--------------------|--------------------|--------------------|--------------------|--------------------|---------------|-------------|---------------------|---------------|-------------------------------|
| **CRIME**          | N/A (wrong mint)   | Allowed (WL dest)  | Allowed (WL dest)  | N/A (wrong mint)   | N/A (wrong mint)   | Allowed (WL dest) | N/A (wrong mint) | Allowed (WL dest) | Allowed (WL dest) | **Blocked** (no WL party)     |
| **FRAUD**          | N/A (wrong mint)   | Allowed (WL dest)  | N/A (wrong mint)   | Allowed (WL dest)  | N/A (wrong mint)   | Allowed (WL dest) | N/A (wrong mint) | Allowed (WL dest) | Allowed (WL dest) | **Blocked** (no WL party)     |
| **PROFIT**         | N/A (wrong mint)   | N/A (wrong mint)   | N/A (wrong mint)   | N/A (wrong mint)   | Allowed (WL dest)  | N/A (wrong mint) | Allowed (WL dest) | N/A (wrong mint) | N/A (wrong mint) | **Blocked** (no WL party)     |
| **WSOL**           | N/A (no hook)      | N/A (no hook)      | N/A (no hook)      | N/A (no hook)      | N/A (no hook)      | N/A (no hook)  | N/A (no hook) | N/A (no hook) | N/A (no hook) | N/A (no hook)                 |

**Reading this table**: "N/A (wrong mint)" means Token-2022 would reject the transfer at the token program level (mint mismatch) before the hook is even invoked. "N/A (no hook)" means WSOL uses SPL Token which has no transfer hook mechanism. "Allowed (WL dest)" means the destination is whitelisted, so the hook allows the transfer. When transferring FROM a whitelisted vault TO a user wallet, the transfer is also allowed because the source is whitelisted (WL source). "Vault CRIME/FRAUD/PROFIT Account" refers to the Conversion Vault's PDA-derived token accounts (seeds: `[b"vault", mint.key()]`), which are whitelisted to enable vault conversions.

**Critical security property**: The hook checks `source OR destination`. For user-initiated transfers, one side is always a whitelisted vault (pool vault, carnage vault, stake vault, etc.) and the other is the user's unwhitelisted wallet. This is why user-to-user (neither side whitelisted) transfers are always blocked.

### Detailed Transfer Scenarios

| From              | To                | Token(s) | Hook Fires? | Result  | Reason                                |
|-------------------|-------------------|----------|-------------|---------|----------------------------------------|
| User wallet       | User wallet       | CRIME    | Yes         | **REJECT** | Neither side whitelisted             |
| User wallet       | User wallet       | FRAUD    | Yes         | **REJECT** | Neither side whitelisted             |
| User wallet       | User wallet       | PROFIT   | Yes         | **REJECT** | Neither side whitelisted             |
| User wallet       | User wallet       | WSOL     | No          | ALLOW   | SPL Token, no hook                     |
| User wallet       | Pool vault (WL)   | CRIME    | Yes         | ALLOW   | Destination whitelisted               |
| Pool vault (WL)   | User wallet       | CRIME    | Yes         | ALLOW   | Source whitelisted                    |
| User wallet       | Stake vault (WL)  | PROFIT   | Yes         | ALLOW   | Destination whitelisted               |
| Stake vault (WL)  | User wallet       | PROFIT   | Yes         | ALLOW   | Source whitelisted                    |
| Carnage vault (WL)| Pool vault (WL)   | CRIME    | Yes         | ALLOW   | Both sides whitelisted (short-circuit)|
| Pool vault A (WL) | Carnage vault (WL)| FRAUD    | Yes         | ALLOW   | Both sides whitelisted               |
| Any               | Any               | (any T22)| Yes         | **REJECT** | amount == 0 (ZeroAmountTransfer)    |


### Hook Firing Matrix

This matrix covers every on-chain operation that moves tokens, documenting whether the transfer hook is invoked.

| Operation                        | Program Path                                     | Token(s) Moved        | Hook Fires?    | Hook Accounts Needed | CPI Depth at Hook |
|----------------------------------|--------------------------------------------------|-----------------------|----------------|----------------------|--------------------|
| **User buy (SOL pool)**          | Tax -> AMM `swap_sol_pool`                       | WSOL in, CRIME/FRAUD out | CRIME/FRAUD: Yes, WSOL: No | 4              | 4 (Tax->AMM->T22->Hook) |
| **User sell (SOL pool)**         | Tax -> AMM `swap_sol_pool`                       | CRIME/FRAUD in, WSOL out | CRIME/FRAUD: Yes, WSOL: No | 4              | 4 (Tax->AMM->T22->Hook) |
| **Vault convert (CRIME/FRAUD -> PROFIT)** | Vault `convert`                         | CRIME/FRAUD in, PROFIT out | Both: Yes (separate transfers) | 4 per transfer (8 total) | 2 (Vault->T22->Hook) |
| **Carnage buy (exempt)**         | Epoch -> Tax `swap_exempt` -> AMM `swap_sol_pool`| WSOL in, CRIME/FRAUD out | CRIME/FRAUD: Yes, WSOL: No | 4              | 4 (Epoch->Tax->AMM->T22->Hook) |
| **Carnage sell (exempt)**        | Epoch -> Tax `swap_exempt` -> AMM `swap_sol_pool`| CRIME/FRAUD in, WSOL out | CRIME/FRAUD: Yes, WSOL: No | 4              | 4 (Epoch->Tax->AMM->T22->Hook) |
| **Carnage burn**                 | Epoch `execute_carnage_atomic`                   | CRIME or FRAUD burned | **No**         | 0                    | 1 (Epoch->T22 burn) |
| **Stake PROFIT**                 | Staking `stake`                                  | PROFIT in              | Yes            | 4                    | 2 (Staking->T22->Hook) |
| **Unstake PROFIT**               | Staking `unstake`                                | PROFIT out             | Yes            | 4                    | 2 (Staking->T22->Hook) |
| **SOL reward claim**             | Staking `claim`                                  | SOL (native lamports)  | **No**         | 0                    | 0 (lamport transfer) |
| **SOL reward deposit**           | Tax `deposit_rewards`                            | SOL (native lamports)  | **No**         | 0                    | 0 (lamport transfer) |
| **SOL -> WSOL wrap**             | Epoch `execute_carnage_atomic`                   | SOL -> WSOL            | **No**         | 0                    | 0 (system + sync)    |
| **Pool initialization**          | AMM `initialize_pool`                            | Token A + Token B      | T22 tokens: Yes | Depends on pool type | 2 (AMM->T22->Hook)  |

**CPI depth ceiling**: The Carnage path hits the Solana 4-level CPI depth limit exactly: `Epoch::execute_carnage_atomic (entry) -> Tax::swap_exempt (1) -> AMM::swap_sol_pool (2) -> Token-2022::transfer_checked (3) -> Transfer Hook::execute (4)`. No additional CPI can be added to this path.


## Swap Paths

### SOL Pool Swaps (Single-Hook)

SOL pool swaps move one T22 token (CRIME or FRAUD) and one SPL token (WSOL). Only the T22 side triggers the transfer hook. The WSOL side uses `transfer_spl()` which calls Anchor's `token_interface::transfer_checked` with no hook accounts.

**Entry points**: `Tax::swap_sol_buy` (SOL -> CRIME/FRAUD) and `Tax::swap_sol_sell` (CRIME/FRAUD -> SOL).

**AMM instruction**: `swap_sol_pool` handles both directions. Direction is an explicit enum argument (`SwapDirection::AtoB` = 0, `SwapDirection::BtoA` = 1), not inferred from account ordering.

**Transfer routing logic** (from `swap_sol_pool.rs:210-315`):

```
For each transfer (input and output):
  if token_program is Token-2022:
    call transfer_t22_checked(... ctx.remaining_accounts)
    // Hook fires, remaining_accounts forwarded
  else:
    call transfer_spl(...)
    // No hook, no remaining_accounts
```

In a `MixedPool`, exactly one of the two transfers uses `transfer_t22_checked` and exactly one uses `transfer_spl`. The same `ctx.remaining_accounts` slice is passed to whichever T22 transfer fires. Since only one side is T22, there is no ambiguity about which hook accounts to use.

**Buy direction (AtoB, WSOL -> CRIME)**:
1. Input: `transfer_spl(user_wsol -> vault_a)` -- no hook
2. Output: `transfer_t22_checked(vault_b -> user_crime, remaining_accounts)` -- hook fires on CRIME

**Sell direction (BtoA, CRIME -> WSOL)**:
1. Input: `transfer_t22_checked(user_crime -> vault_b, remaining_accounts)` -- hook fires on CRIME
2. Output: `transfer_spl(vault_a -> user_wsol)` -- no hook

**`remaining_accounts` structure** (4 accounts total):

| Index | Account                              | Purpose                          |
|-------|--------------------------------------|----------------------------------|
| 0     | `extra_account_meta_list` PDA        | Token-2022 hook resolution       |
| 1     | `whitelist_source` PDA               | Whitelist check for source       |
| 2     | `whitelist_destination` PDA          | Whitelist check for destination  |
| 3     | Transfer Hook program ID             | Token-2022 CPIs into this        |

The ExtraAccountMetaList PDA is derived per-mint: `seeds = ["extra-account-metas", mint.key()]`. The whitelist PDAs are derived per-token-account: `seeds = ["whitelist", token_account.key()]`. These are resolved dynamically by Token-2022 at transfer time using the ExtraAccountMetaList's seed definitions.


### Conversion Vault (PROFIT Acquisition)

PROFIT is acquired via the Conversion Vault program, not via AMM pool swaps. The vault uses a deterministic 100:1 fixed rate: 100 CRIME or 100 FRAUD converts to 1 PROFIT. There are zero fees and zero slippage.

**Entry point**: `Vault::convert` -- called directly by the user (no Tax Program intermediary, no AMM involvement).

**Transfer model**: Each conversion involves two separate `transfer_checked` calls, not a single atomic AMM swap:
1. **Input transfer**: User sends CRIME or FRAUD to the vault's token account (e.g., `user_crime -> vault_crime`)
2. **Output transfer**: Vault sends PROFIT to the user's PROFIT token account (e.g., `vault_profit -> user_profit`)

Both transfers use Token-2022's `transfer_checked`, so the transfer hook fires on each independently. However, unlike the former dual-hook AMM pool swaps, these are two distinct CPI calls -- there is no `remaining_accounts` midpoint split and no direction-dependent hook ordering.

**Hook behavior**:
- Input transfer (CRIME/FRAUD): Hook fires, validates vault token account is whitelisted (destination)
- Output transfer (PROFIT): Hook fires, validates vault PROFIT account is whitelisted (source)
- Each transfer needs its own 4 hook accounts, resolved independently

**`remaining_accounts` structure** (8 accounts total, but structured as two independent sets):

| Index | Account                                | Purpose                               |
|-------|----------------------------------------|---------------------------------------|
| 0     | Input mint `extra_account_meta_list`   | Hook resolution for CRIME/FRAUD       |
| 1     | Input mint `whitelist_source`          | User's token account (source)         |
| 2     | Input mint `whitelist_destination`     | Vault token account (destination, WL) |
| 3     | Transfer Hook program ID               | Hook program for input transfer       |
| 4     | PROFIT `extra_account_meta_list`       | Hook resolution for PROFIT            |
| 5     | PROFIT `whitelist_source`              | Vault PROFIT account (source, WL)     |
| 6     | PROFIT `whitelist_destination`         | User's PROFIT account (destination)   |
| 7     | Transfer Hook program ID               | Hook program for output transfer      |

**Key differences from the former PROFIT pool swaps**:
- **No AMM math**: Fixed 100:1 rate, no constant product curve, no slippage, no price impact
- **No Tax Program routing**: Users call the vault directly (no `swap_profit_buy`/`swap_profit_sell`)
- **Simpler CPI depth**: Vault -> Token-2022 -> Hook = depth 2 (vs depth 4 for the old Tax -> AMM -> T22 -> Hook path)
- **No direction trap**: The vault always takes input first, then sends output. No direction enum, no hook ordering ambiguity
- **Zero fees**: No LP fee, no tax. The vault conversion is fee-free


### Carnage Swaps (Exempt Path)

Carnage operations use `Tax::swap_exempt` which calls `AMM::swap_sol_pool` (Carnage only trades through SOL pools). The swap is tax-exempt (no 71/24/5 distribution), but the AMM LP fee (1%) still applies. The transfer hook still fires on the T22 side because the AMM calls `transfer_t22_checked` identically to taxed swaps.

**CPI chain**: `Epoch::execute_carnage_atomic -> Tax::swap_exempt -> AMM::swap_sol_pool -> Token-2022::transfer_checked -> Transfer Hook::execute`

**Hook account partitioning in Carnage** (from `execute_carnage_atomic.rs:253-265`):

```rust
const HOOK_ACCOUNTS_PER_MINT: usize = 4;

let (sell_hook_accounts, buy_hook_accounts) = if matches!(action, CarnageAction::Sell)
    && ctx.remaining_accounts.len() >= HOOK_ACCOUNTS_PER_MINT * 2
{
    // Sell+Buy: [sell_hook(4), buy_hook(4)] -- different mints may be involved
    (&ctx.remaining_accounts[..HOOK_ACCOUNTS_PER_MINT],
     &ctx.remaining_accounts[HOOK_ACCOUNTS_PER_MINT..])
} else {
    // Burn/BuyOnly: all remaining_accounts are for the buy hook
    (&ctx.remaining_accounts[..0], ctx.remaining_accounts)
};
```

Carnage operations can involve two consecutive swaps (sell held tokens, then buy target tokens). Each swap targets a SOL pool (single-hook), but the two swaps may involve different mints (e.g., sell CRIME then buy FRAUD). The `remaining_accounts` are partitioned:
- **Sell+Buy path**: `[sell_mint_hook(4), buy_mint_hook(4)]` -- 8 total
- **BuyOnly path**: `[buy_mint_hook(4)]` -- 4 total
- **Burn path**: `[buy_mint_hook(4)]` -- burn doesn't trigger hooks, buy does

The hook accounts flow through the CPI chain: Epoch passes them as `remaining_accounts` to Tax, Tax forwards them as `remaining_accounts` to AMM, AMM forwards them to `transfer_t22_checked`, which appends them to the Token-2022 CPI.


## Hook Account Ordering

### Single-Hook Pools (SOL Pools)

For `swap_sol_pool`, `remaining_accounts` contains exactly 4 accounts for the T22 side. These accounts are the same regardless of swap direction because the same mint's hook fires whether the T22 token is the input or output.

```
remaining_accounts = [
  extra_account_meta_list,   // PDA: ["extra-account-metas", t22_mint]
  whitelist_source,          // PDA: ["whitelist", source_token_account]
  whitelist_destination,     // PDA: ["whitelist", destination_token_account]
  transfer_hook_program      // CmNyuLdMeggHS2dKBhzPWHdeTEcpKg4uTevT5tBcBsce
]
```

**Direction affects whitelist PDAs, not structure**: When buying (WSOL -> CRIME), the source is the pool vault and destination is the user's account. When selling (CRIME -> WSOL), the source is the user's account and destination is the pool vault. The whitelist PDA seeds are derived from the actual token account pubkeys, so the whitelist_source and whitelist_destination accounts swap between directions.

### Dual-Hook Transfers (Historical: PROFIT Pools)

> **Note**: PROFIT pools have been replaced by the Conversion Vault. The vault does not use dual-hook AMM pool swaps -- it performs two independent `transfer_checked` calls with no midpoint split or direction-dependent ordering. This section is retained as a reference for the dual-hook pattern used in any remaining dual-T22 pool interactions and for historical context.

For any dual-T22 AMM pool swap (where both sides are Token-2022 tokens), `remaining_accounts` contains 8 accounts: 4 for the input transfer's hook, then 4 for the output transfer's hook.

```
remaining_accounts = [
  // --- INPUT transfer hook accounts (indices 0-3) ---
  input_extra_account_meta_list,     // PDA for input mint
  input_whitelist_source,            // PDA for input source token account
  input_whitelist_destination,       // PDA for input destination token account
  transfer_hook_program,             // Same program for all mints

  // --- OUTPUT transfer hook accounts (indices 4-7) ---
  output_extra_account_meta_list,    // PDA for output mint
  output_whitelist_source,           // PDA for output source token account
  output_whitelist_destination,      // PDA for output destination token account
  transfer_hook_program              // Same program (appears twice)
]
```

The transfer hook program ID (`CmNyuLdMeggHS2dKBhzPWHdeTEcpKg4uTevT5tBcBsce`) appears twice -- once in each half. This is because Token-2022 expects it as part of each transfer's hook account set.

### The Direction Trap (Historical Reference)

> **Note**: With the removal of PROFIT pools, no active AMM pools use dual-hook swaps. The current protocol only has single-hook SOL pools (CRIME/WSOL, FRAUD/WSOL) and the Conversion Vault (which uses independent transfers, not direction-dependent splits). This section is retained as a reference for the dual-hook pattern.

The `remaining_accounts` ordering for dual-hook AMM pool swaps follows `[INPUT hooks, OUTPUT hooks]`, **not** `[side A hooks, side B hooks]`. When the swap direction changes, which mint is "input" and which is "output" flips, which means the entire ordering of `remaining_accounts` must flip.

**What happens if you get it wrong**: Token-2022 resolves the `extra_account_meta_list` by matching it against the mint being transferred. If the wrong mint's `extra_account_meta_list` is passed, Token-2022 emits error **3005** (`AccountNotEnoughKeys`). The transaction atomically reverts. No funds are lost, but the swap fails silently if error handling is poor.


## Edge Cases

### Token Burns (No Hook)

Token-2022's `burn` instruction does **not** trigger transfer hooks. This is a Token-2022 design property -- burns reduce supply but do not invoke the `Execute` hook interface.

**Where this matters**: Carnage burn operations (in `execute_carnage_atomic.rs:499-584`) burn CRIME or FRAUD tokens from the Carnage vaults. The burn uses a raw `invoke_signed` to Token-2022 with instruction discriminator `8` (Burn). No hook accounts are needed, and no CPI depth is consumed for the hook. This means burn operations can execute at lower CPI depth (depth 1: Epoch -> Token-2022) than swap operations (depth 4).

**Security implication**: Burns can only be performed by the vault authority (the `carnage_state` PDA). The whitelist is irrelevant for burns because the hook never fires.

### Mint Authority (Burned)

All three protocol token mints have their mint authority permanently revoked. No new CRIME, FRAUD, or PROFIT tokens can ever be created. This means the total supply can only decrease over time (via Carnage burns). Mint authority burning is performed via Token-2022's `SetAuthority` instruction with `AuthorityType::MintTokens` set to `None`.

Additionally, the transfer hook authority on each mint is burned (set to `None`), preventing anyone from changing which hook program is called during transfers.

### User-to-User Transfers (Blocked)

Any attempt to transfer CRIME, FRAUD, or PROFIT directly between two user wallets (neither of which is whitelisted) will be atomically rejected by the transfer hook with error `NoWhitelistedParty` (error code 6000). The transaction reverts entirely -- no tokens move.

This is the foundational security property of the protocol: all token movement must route through protocol-controlled addresses (pool vaults, Carnage vaults, stake vault, bonding curve vaults, reserve vault). There is no mechanism for peer-to-peer token transfers, OTC trades, or token gifts.

### Wrap/Unwrap SOL (No Hook)

SOL wrapping (native SOL -> WSOL token account) and unwrapping use the SPL Token program. The operations involved are:
1. `system_program::transfer` -- moves native SOL lamports to the WSOL token account
2. `spl_token::sync_native` (instruction discriminator 17) -- tells SPL Token to update the WSOL balance to match lamports

Neither operation involves Token-2022 or transfer hooks. WSOL is entirely outside the hook enforcement system. WSOL security relies on:
- AMM access control (only Tax Program's `swap_authority` PDA can invoke swap instructions)
- Pool vault ownership (vaults are PDAs owned by the pool, not by any user)
- Token program routing (Anchor constraints validate `token_program_a` matches the pool's stored program ID)

### Staking (PROFIT Only)

The Staking Program handles PROFIT deposits and withdrawals. Both operations trigger the transfer hook because PROFIT is Token-2022 with hooks.

**Stake** (`staking/src/instructions/stake.rs`): Transfers PROFIT from user wallet to stake vault PDA. Hook fires -- user's token account is the source (not whitelisted), stake vault is the destination (whitelisted, entry #13). Hook allows because destination is whitelisted.

**Unstake** (`staking/src/instructions/unstake.rs`): Transfers PROFIT from stake vault PDA to user wallet. Hook fires -- stake vault is the source (whitelisted), user's token account is the destination (not whitelisted). Hook allows because source is whitelisted.

Both operations use `transfer_checked_with_hook` (the manual `invoke_signed` pattern identical to the AMM's `transfer_t22_checked`), with `ctx.remaining_accounts` forwarded for the 4 hook accounts.

**SOL rewards** are distributed as native lamport transfers (escrow PDA -> user wallet), which do not involve any token program and have no hook interaction.

### Pool Initialization (Hook Fires)

When pools are initialized via `AMM::initialize_pool`, the initial liquidity deposit transfers tokens from the admin's accounts to the pool vaults. For T22 tokens, `transfer_t22_checked` is used with `ctx.remaining_accounts`, so the transfer hook fires on these initial deposits. The admin's token accounts are not whitelisted, but the pool vault destinations are, so the hook allows the transfers.

### Direct Hook Invocation (Blocked)

The transfer hook includes defense-in-depth validation (`check_is_transferring` in `transfer_hook.rs:140-153`) that reads the `transferring` flag from the source token account's `TransferHookAccount` extension. This flag is set by Token-2022 before calling the hook and cleared after. If someone tries to invoke the hook directly (not through a `transfer_checked` call), this flag will be false, and the hook rejects with `DirectInvocationNotAllowed`.


## Whitelist Coverage

The whitelist contains exactly 13 addresses. All are token account pubkeys (not wallet pubkeys). After the whitelist authority is burned, no entries can be added or removed.

| #  | Address Type                    | Purpose                                          | Token(s) Protected | Used By Program    |
|----|---------------------------------|--------------------------------------------------|--------------------|--------------------|
| 1  | CRIME/SOL pool CRIME vault      | Pool holds CRIME reserve                         | CRIME              | AMM                |
| 2  | CRIME/SOL pool WSOL vault       | Enables CRIME transfers TO this pool             | CRIME (hook on CRIME, not WSOL) | AMM |
| 3  | FRAUD/SOL pool FRAUD vault      | Pool holds FRAUD reserve                         | FRAUD              | AMM                |
| 4  | FRAUD/SOL pool WSOL vault       | Enables FRAUD transfers TO this pool             | FRAUD (hook on FRAUD, not WSOL) | AMM |
| 5  | Vault CRIME token account       | Vault holds CRIME for conversions                | CRIME              | Conversion Vault   |
| 6  | Vault FRAUD token account       | Vault holds FRAUD for conversions                | FRAUD              | Conversion Vault   |
| 7  | Vault PROFIT token account      | Vault holds PROFIT for distribution via conversion | PROFIT           | Conversion Vault   |
| 8  | Carnage CRIME vault             | Holds CRIME for Carnage burn/sell operations     | CRIME              | Epoch Program      |
| 9  | Carnage FRAUD vault             | Holds FRAUD for Carnage burn/sell operations     | FRAUD              | Epoch Program      |
| 10 | CRIME bonding curve token vault | Bonding curve holds CRIME during launch phase    | CRIME              | Bonding Curve      |
| 11 | FRAUD bonding curve token vault | Bonding curve holds FRAUD during launch phase    | FRAUD              | Bonding Curve      |
| 12 | Reserve vault                   | Protocol reserve for transition distribution     | CRIME, FRAUD, PROFIT | Initialization   |
| 13 | Stake vault PDA                 | Receives staked PROFIT from users                | PROFIT             | Staking Program    |

**Whitelist entry storage**: Each entry is a PDA with seeds `["whitelist", token_account_pubkey]` under the Transfer Hook program. The entry contains the address (Pubkey, 32 bytes) and creation timestamp (i64, 8 bytes), totaling 48 bytes with Anchor discriminator. The hook checks entry existence (`!data_is_empty()`) and verifies PDA derivation (`find_program_address` matches) to prevent spoofed accounts.

**Why entries #2 and #4 (WSOL vaults) are whitelisted**: These are SOL pool WSOL vaults. WSOL itself never triggers the hook (SPL Token). However, when CRIME is transferred into the CRIME/SOL pool during a sell, the transfer is `user_crime_account -> vault_b (CRIME vault)`. The CRIME vault (entry #1) is the destination. The WSOL vault (entry #2) is NOT involved in the CRIME transfer -- it is whitelisted so that during pool initialization or other cross-token operations involving the pool, addresses associated with this pool are recognized as protocol-controlled.

<!-- NEEDS_VERIFICATION: Entries #2 and #4 (WSOL vaults) may not strictly need whitelisting since WSOL transfers don't trigger hooks and CRIME/FRAUD transfers to those pools go to entries #1/#3. The original spec whitelists them for forward compatibility, but they may be functionally unnecessary. -->

**Vault token accounts (entries #5-7)**: The Conversion Vault's three PDA-derived token accounts (seeds: `[b"vault", mint.key()]`) are whitelisted to enable conversions. When a user sends CRIME to the vault, the vault's CRIME token account (entry #5) is the whitelisted destination. When the vault sends PROFIT to the user, the vault's PROFIT token account (entry #7) is the whitelisted source.

**Shared whitelist**: All three mints (CRIME, FRAUD, PROFIT) share a single whitelist. A vault whitelisted for CRIME transfers is also recognized for FRAUD and PROFIT transfers. However, Token-2022's own mint validation at the token program level prevents cross-mint transfers -- you cannot send CRIME to a FRAUD vault because the vault's mint field doesn't match. The hook whitelist is necessary-but-not-sufficient for transfer approval; Token-2022 mint checks provide the other half.


## CPI Depth Summary

Every token transfer path in the protocol must fit within Solana's 4-level CPI depth limit. The table below shows the depth consumed by each path.

| Path                                   | Depth 0 (Entry)            | Depth 1            | Depth 2              | Depth 3                  | Depth 4 (Limit)     |
|----------------------------------------|----------------------------|--------------------|----------------------|--------------------------|----------------------|
| User swap (SOL pool)                   | Tax `swap_sol_buy/sell`    | AMM `swap_sol_pool`| Token-2022 `transfer_checked` | Hook `execute`    | --                   |
| Vault convert (CRIME/FRAUD -> PROFIT)  | Vault `convert`            | Token-2022 `transfer_checked` | Hook `execute` | --                | --                   |
| Carnage swap                           | Epoch `execute_carnage_atomic` | Tax `swap_exempt` | AMM `swap_sol_pool` | Token-2022 `transfer_checked` | Hook `execute` |
| Stake/Unstake PROFIT                   | Staking `stake/unstake`    | Token-2022 `transfer_checked` | Hook `execute` | --                | --                   |
| Carnage burn                           | Epoch `execute_carnage_atomic` | Token-2022 `burn` | --                  | --                       | --                   |
| Bonding curve purchase (CRIME/FRAUD)   | BC `purchase`                  | Token-2022 `transfer_checked` | Hook `execute` | --                | --                   |
| Bonding curve sell-back                | BC `sell`                      | Token-2022 `transfer_checked` | Hook `execute` | --                | --                   |
| Bonding curve refund (burn-and-claim)  | BC `claim_refund`              | Token-2022 `burn` | --                  | --                       | --                   |

The Carnage swap path is the only one that reaches depth 4. This is a hard constraint documented in `execute_carnage_atomic.rs:8-13` and `swap_exempt.rs:10-17`: **do not add any CPI calls to the Carnage swap path**.


## Cross-Reference: Transfer Helper Functions

Two transfer helper functions exist, one per token program. Both enforce defense-in-depth validation.

| Helper | Location | Token Program | Hook Support | Validation |
|--------|----------|---------------|--------------|------------|
| `transfer_t22_checked` | `programs/amm/src/helpers/transfers.rs:53` | Token-2022 only | Yes (appends hook accounts to IX + account_infos) | Requires Token-2022 program ID, rejects amount == 0 |
| `transfer_spl` | `programs/amm/src/helpers/transfers.rs:152` | SPL Token only | No (no remaining_accounts) | Requires SPL Token program ID, rejects amount == 0 |
| `transfer_checked_with_hook` | `programs/staking/src/helpers/transfer.rs:34` | Token-2022 only | Yes (identical pattern to AMM's `transfer_t22_checked`) | No explicit program ID check (relies on caller constraints) |

All three helpers use `transfer_checked` (never plain `transfer`). Using plain `transfer` on Token-2022 would silently bypass the hook, defeating whitelist enforcement. This is documented as a critical security invariant in the AMM transfer helper comments.


## Summary Table: When Hooks Fire and When They Don't

| Situation                                    | Hook Fires? | Why |
|----------------------------------------------|-------------|-----|
| T22 token `transfer_checked` via Token-2022  | **Yes**     | Token-2022 invokes hook for all mints with TransferHook extension |
| T22 token `transfer` (plain) via Token-2022  | **No**      | Plain transfer bypasses hooks -- NEVER USED in protocol |
| T22 token `burn` via Token-2022              | **No**      | Burn is not a transfer; hook interface not invoked |
| T22 token `mint_to` via Token-2022           | **No**      | Minting is not a transfer; mint authority is burned anyway |
| WSOL transfer via SPL Token                  | **No**      | SPL Token has no hook mechanism |
| Native SOL lamport transfer (system program) | **No**      | Not a token operation at all |
| SOL reward distribution (Staking escrow)     | **No**      | Direct lamport manipulation, not a token transfer |
| `sync_native` (WSOL balance update)          | **No**      | Updates SPL Token internal balance, not a transfer |

## Common Error Codes for Token Interactions

| Error Code | Name | Source | Trigger Condition |
|------------|------|--------|-------------------|
| 3005 | `AccountNotEnoughKeys` | Token-2022 (hook resolution) | Wrong `remaining_accounts` ordering in dual-hook pools. Passing the wrong mint's `extra_account_meta_list` causes Token-2022 to fail hook resolution. See "The Direction Trap" above. |
| 6000 | `NoWhitelistedParty` | Transfer Hook | Neither source nor destination is whitelisted. Occurs on user-to-user transfers or transfers to non-protocol addresses. |
| 6001 | `ZeroAmountTransfer` | Transfer Hook | Transfer amount is zero. Rejected as a safety check. |
| 6002 | `DirectInvocationNotAllowed` | Transfer Hook | Hook invoked directly (not via Token-2022 `transfer_checked`). The `transferring` flag check catches this. |
