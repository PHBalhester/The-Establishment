# Carnage Fund Specification

> Code-first documentation generated from program source.
> Last updated: 2026-03-08 (Phase 88-02)

## 1. Overview

The Carnage Fund is a protocol-owned redistribution mechanism triggered by VRF randomness during epoch transitions. It accumulates SOL from trade taxes (24% of all tax revenue) and uses it to perform random buyback operations on CRIME and FRAUD tokens. The fund can also burn or sell previously purchased tokens based on VRF-derived actions.

**Program:** Epoch Program (`G6dmJ...`)
**Key module:** `helpers/carnage_execution.rs` (shared logic extracted in Phase 82)

## 2. Execution Paths

There are **6 execution paths**, derived from the combination of:

- **3 actions** (what to do with currently-held tokens): BuyOnly, Burn, Sell
- **2 targets** (which token to buy): CRIME, FRAUD

### 2.1 Action Determination

Actions are stored as `CarnageAction` enum (u8 in state):

| Value | Action | Description | Probability |
|-------|--------|-------------|-------------|
| 0 | `None` (BuyOnly) | No existing holdings to dispose; just buy | When no tokens held |
| 1 | `Burn` | Burn held tokens, then buy target | ~98% (when holdings exist, VRF byte 6 >= 5) |
| 2 | `Sell` | Sell held tokens for SOL, then buy target | ~2% (when holdings exist, VRF byte 6 < 5) |

### 2.2 Target Determination

Target is stored as `Token` enum (u8 in state):

| Value | Token | Condition |
|-------|-------|-----------|
| 0 | CRIME | VRF byte 7 < 128 (50%) |
| 1 | FRAUD | VRF byte 7 >= 128 (50%) |

### 2.3 The 6 Paths

| Path | Action | Target | remaining_accounts | Notes |
|------|--------|--------|-------------------|-------|
| BuyOnly + CRIME | None | Crime | 4 (buy hook) | Simplest path |
| BuyOnly + FRAUD | None | Fraud | 4 (buy hook) | Simplest path |
| Burn + CRIME | Burn | Crime | 4 (buy hook) | Burns held tokens first |
| Burn + FRAUD | Burn | Fraud | 4 (buy hook) | Burns held tokens first |
| Sell + CRIME | Sell | Crime | 8 (sell hook + buy hook) | Most complex, requires ALT |
| Sell + FRAUD | Sell | Fraud | 8 (sell hook + buy hook) | Most complex, requires ALT |

## 3. Shared Module Architecture

Phase 82 extracted ~1800 lines of duplicated logic from `execute_carnage.rs` and `execute_carnage_atomic.rs` into the shared module `helpers/carnage_execution.rs`. This module contains:

### 3.1 Core Types

**`CarnageAccounts`** -- Shared account references struct (~14 accounts):
- `carnage_signer` -- PDA that signs Tax::swap_exempt CPI
- `sol_vault` -- SystemAccount holding native SOL
- `carnage_wsol` -- WSOL token account (mutable for reload after CPI)
- `crime_vault`, `fraud_vault` -- Token-2022 vaults (mutable for reload)
- `crime_pool`, `fraud_pool` -- AMM pool AccountInfo (CPI passthroughs)
- `crime_pool_vault_a/b`, `fraud_pool_vault_a/b` -- Pool vaults (CPI passthroughs)
- `mint_a` -- WSOL mint
- `crime_mint`, `fraud_mint` -- Token-2022 mints
- `tax_program`, `amm_program`, `swap_authority` -- Program references
- `token_program_a` (SPL Token), `token_program_b` (Token-2022)
- `system_program`

### 3.2 Core Function

**`execute_carnage_core()`** -- Full dispose-buy-update flow:
1. Read pending action and target from EpochState
2. Partition `remaining_accounts` for Transfer Hook
3. Handle existing holdings (Burn/Sell/None)
4. Reload target vault after disposal
5. Buy target token (wrap SOL, execute swap, measure tokens received)
6. Enforce slippage floor
7. Update CarnageFundState and EpochState
8. Emit `CarnageExecuted` event

### 3.3 Helper Functions

| Function | Purpose |
|----------|---------|
| `partition_hook_accounts()` | Split remaining_accounts into sell and buy slices |
| `burn_held_tokens()` | Token-2022 burn via raw invoke_signed |
| `wrap_sol_to_wsol()` | SOL vault -> WSOL via system transfer + sync_native |
| `execute_sell_swap()` | Sell held tokens via Tax::swap_exempt (BtoA) |
| `execute_buy_swap()` | Buy target tokens via Tax::swap_exempt (AtoB) |
| `execute_swap_exempt_cpi()` | Build and invoke Tax::swap_exempt CPI |
| `approve_delegate()` | Approve carnage_signer as delegate on held vault |
| `read_pool_reserves()` | Read AMM pool reserves from raw bytes |

## 4. Execution Handlers

### 4.1 execute_carnage_atomic

- **Purpose:** Atomic Carnage execution bundled with consume_randomness TX
- **Permissionless:** Anyone can call
- **No-op guard:** Returns `Ok(())` if `carnage_pending == false` (safe to include in every reveal+consume TX)
- **Slippage floor:** 85% (8500 bps) -- tighter, tolerant of normal same-TX deviations
- **Event:** `CarnageExecuted { atomic: true }`
- **Account count:** 23 named accounts + remaining_accounts

### 4.2 execute_carnage (Fallback)

- **Purpose:** Permissionless fallback after atomic lock window expires
- **Lock window guard:** Rejects if `clock.slot <= carnage_lock_slot` (CarnageLockActive)
- **Deadline guard:** Rejects if `clock.slot > carnage_deadline_slot` (CarnageDeadlineExpired)
- **Slippage floor:** 75% (7500 bps) -- more lenient, prioritizes execution over optimal price
- **Event:** `CarnageExecuted { atomic: false }`
- **Account count:** 23 named accounts + remaining_accounts

### 4.3 expire_carnage

- **Purpose:** Clear pending Carnage after deadline expires
- **Guard:** `clock.slot > carnage_deadline_slot` required
- **State changes:** Clears `carnage_pending`, sets action to `None`
- **Events:** `CarnageExpired` + `CarnageFailed`
- **SOL retention:** SOL stays in vault for next trigger

## 5. carnage_lock_slot State Machine

The lock slot mechanism prevents MEV bots from front-running atomic execution:

```
Time -->
|--- CARNAGE_LOCK_SLOTS (50) ---|--- Fallback window ---|--- Expired ---|
|    Only atomic path            | Anyone can call       | expire_carnage|
|    execute_carnage_atomic      | execute_carnage       |               |
0                                50                      300 slots
```

**Constants:**
- `CARNAGE_LOCK_SLOTS = 50` (~20 seconds at 400ms/slot)
- `CARNAGE_DEADLINE_SLOTS = 300` (~2 minutes)
- Fallback window: slots 50-300 (250 slots, ~100 seconds)

## 6. Transfer Hook and remaining_accounts

### 6.1 HOOK_ACCOUNTS_PER_MINT = 4

Each Token-2022 transfer with Transfer Hook requires 4 extra accounts per mint:
1. `extra_account_meta_list` -- PDA listing required accounts
2. `whitelist_source` -- Whitelist PDA for source token account
3. `whitelist_destination` -- Whitelist PDA for destination token account
4. `hook_program` -- Transfer Hook program ID

### 6.2 Partitioning

`partition_hook_accounts()` splits remaining_accounts based on action:

- **Sell path:** `remaining_accounts[0..4]` = sell hook, `remaining_accounts[4..8]` = buy hook
- **Burn/BuyOnly:** All remaining_accounts are for the buy hook (sell doesn't trigger hooks)

### 6.3 Dual-Hook Ordering for PROFIT Pools

AMM splits remaining_accounts as `[INPUT hooks, OUTPUT hooks]`, NOT `[side A, side B]`.
- Buy (AtoB): input=A, output=B -> send [A hooks, B hooks]
- Sell (BtoA): input=B, output=A -> send [B hooks, A hooks]

Getting this wrong causes Transfer Hook error 3005 (AccountNotEnoughKeys).

## 7. Slippage Protection

### 7.1 Pre-CPI Reserve Check

`read_pool_reserves()` reads AMM PoolState bytes directly at known offsets:
- `[9..41]` = mint_a (Pubkey)
- `[137..145]` = reserve_a (u64)
- `[145..153]` = reserve_b (u64)

Determines SOL vs token by comparing mint_a to WSOL mint. Returns `(reserve_sol, reserve_token)`.

### 7.2 Slippage Calculation

Expected output computed via constant-product formula:
```
expected = reserve_token * total_buy_amount / (reserve_sol + total_buy_amount)
min_output = expected * slippage_bps / 10_000
```

Actual output (tokens_bought) must be >= min_output.

### 7.3 Slippage Floor Values

| Path | Floor (bps) | Floor (%) | Rationale |
|------|-------------|-----------|-----------|
| Atomic | 8500 | 85% | Tight, MEV defense from atomicity + VRF |
| Fallback | 7500 | 75% | Lenient, prioritize execution in recovery |

## 8. SOL Flow: Sell + Buy Combined

On the Sell path, WSOL from selling held tokens lands in `carnage_wsol`. The buy step combines this with freshly wrapped tax SOL:

```
total_buy_amount = min(swap_amount + sol_from_sale, MAX_CARNAGE_SWAP_LAMPORTS)
wrap_amount = total_buy_amount - sol_from_sale  // only wrap the new portion
```

This prevents stranding sell proceeds in `carnage_wsol`.

## 9. ALT Requirement for Sell Path

The Sell path requires 23 named accounts + 8 remaining_accounts = 31 accounts, exceeding the 1232-byte transaction size limit. Client must use VersionedTransaction v0 with an Address Lookup Table (ALT).

The ALT is client-side only -- no program changes needed. The protocol-wide ALT (46 addresses) is cached at `scripts/deploy/alt-address.json`.

## 10. CPI Depth Chain

The Carnage swap path is exactly at Solana's 4-level CPI depth limit:

```
execute_carnage[_atomic] (entry, depth 0)
  -> Tax::swap_exempt (depth 1)
    -> AMM::swap_sol_pool (depth 2)
      -> Token-2022::transfer_checked (depth 3)
        -> Transfer Hook::execute (depth 4) -- SOLANA LIMIT
```

The SOL->WSOL wrap calls (`system_program::transfer` + `sync_native`) execute BEFORE the swap at CPI depth 0, so they do NOT impact the chain.

**DO NOT add any CPI calls to the swap path.**

## 11. Account Layouts

### 11.1 CarnageFundState (147 bytes total, 139 data)

| Field | Type | Bytes | Description |
|-------|------|-------|-------------|
| sol_vault | Pubkey | 32 | SOL vault PDA address |
| crime_vault | Pubkey | 32 | CRIME vault PDA address |
| fraud_vault | Pubkey | 32 | FRAUD vault PDA address |
| held_token | u8 | 1 | 0=None, 1=CRIME, 2=FRAUD |
| held_amount | u64 | 8 | Amount of held token |
| last_trigger_epoch | u32 | 4 | Last epoch Carnage triggered |
| total_sol_spent | u64 | 8 | Lifetime SOL spent (monotonic) |
| total_crime_burned | u64 | 8 | Lifetime CRIME burned (monotonic) |
| total_fraud_burned | u64 | 8 | Lifetime FRAUD burned (monotonic) |
| total_triggers | u32 | 4 | Lifetime trigger count (monotonic) |
| initialized | bool | 1 | Initialization flag |
| bump | u8 | 1 | PDA bump seed |

PDA: `seeds = ["carnage_fund"]`

### 11.2 PDA Seeds

| PDA | Seeds | Purpose |
|-----|-------|---------|
| CarnageFundState | `["carnage_fund"]` | State account |
| Carnage signer | `["carnage_signer"]` | Signs Tax::swap_exempt CPI |
| SOL vault | `["carnage_sol_vault"]` | Holds native SOL |
| CRIME vault | `["carnage_crime_vault"]` | Token-2022 account |
| FRAUD vault | `["carnage_fraud_vault"]` | Token-2022 account |

## 12. Constants

| Constant | Value | Description |
|----------|-------|-------------|
| MAX_CARNAGE_SWAP_LAMPORTS | 1,000 SOL | Maximum SOL per swap |
| CARNAGE_TRIGGER_THRESHOLD | 11 | VRF byte 5 < 11 triggers (~4.3%) |
| CARNAGE_SELL_THRESHOLD | 5 | VRF byte 6 < 5 = sell (~2%) |
| CARNAGE_LOCK_SLOTS | 50 | Atomic-only window (~20s) |
| CARNAGE_DEADLINE_SLOTS | 300 | Total execution window (~2min) |
| CARNAGE_SLIPPAGE_BPS_ATOMIC | 8500 | 85% slippage floor |
| CARNAGE_SLIPPAGE_BPS_FALLBACK | 7500 | 75% slippage floor |
| HOOK_ACCOUNTS_PER_MINT | 4 | Transfer Hook accounts per mint |

## 13. Error Codes (Epoch Program)

| Code | Name | Description |
|------|------|-------------|
| 6013 | NoCarnagePending | No Carnage execution pending |
| 6014 | CarnageDeadlineExpired | Deadline has passed |
| 6015 | CarnageDeadlineNotExpired | Deadline hasn't passed yet (expire_carnage) |
| 6016 | CarnageLockActive | Lock window still active (fallback blocked) |
| 6017 | InvalidCarnageTargetPool | Invalid target pool |
| 6018 | CarnageNotInitialized | Fund not initialized |
| 6019 | CarnageAlreadyInitialized | Fund already initialized |
| 6020 | InsufficientCarnageSol | Insufficient SOL in vault |
| 6021 | CarnageSwapFailed | Swap execution failed |
| 6022 | CarnageBurnFailed | Burn execution failed |
| 6031 | CarnageSlippageExceeded | Output below slippage floor |
| 6027 | InvalidCarnageWsolOwner | WSOL not owned by carnage_signer |

## 14. CPI Dependencies

| Target Program | Instruction | Purpose |
|----------------|-------------|---------|
| Tax Program | `swap_exempt` | Execute tax-free swap for Carnage |
| System Program | `transfer` | Wrap SOL to WSOL |
| SPL Token | `sync_native` (17) | Update WSOL balance after lamport transfer |
| Token-2022 | `burn` (8) | Burn held tokens |
| Token-2022 | `approve` (4) | Approve carnage_signer as delegate for sell |

## 15. Events

| Event | Fields | Emitted By |
|-------|--------|------------|
| CarnageExecuted | epoch, action, target, sol_spent, tokens_bought, tokens_burned, sol_from_sale, atomic | execute_carnage_core |
| CarnagePending | epoch, target, action, deadline_slot | consume_randomness |
| CarnageNotTriggered | epoch, vrf_byte | consume_randomness |
| CarnageExpired | epoch, target, action, deadline_slot, sol_retained | expire_carnage, consume_randomness |
| CarnageFailed | epoch, action, target, attempted_amount, vault_balance, slot, atomic | expire_carnage, consume_randomness |
