# Transfer Hook Specification

> Code-first documentation generated from program source.
> Last updated: 2026-03-08 (Phase 88-02)

## 1. Overview

The Transfer Hook program implements whitelist-based transfer validation for Token-2022 tokens. Every transfer of a hooked token (CRIME, FRAUD) passes through this program, which validates that at least one party (source or destination) is a whitelisted protocol-controlled address.

**Program ID:** `FnwnSxgieKBYogwD45KbwtpZMWsdzapg3VwkxTqiaihB`

### 1.1 Which Tokens Have Hooks

| Token | Standard | Hook | Notes |
|-------|----------|------|-------|
| CRIME | Token-2022 | Yes (this program) | Transfer validation |
| FRAUD | Token-2022 | Yes (this program) | Transfer validation |
| PROFIT | Token-2022 | Yes (this program) | Transfer validation |

All three tokens use Token-2022 with transfer hooks. The hook enforces whitelist-based transfer validation on every transfer.

## 2. How Transfer Hooks Work

Token-2022's `transfer_checked` instruction includes a Transfer Hook extension. When a mint has this extension configured:

1. User calls `transfer_checked` on Token-2022
2. Token-2022 resolves extra accounts from the ExtraAccountMetaList PDA
3. Token-2022 sets the `transferring` flag on the source token account
4. Token-2022 CPIs into the Transfer Hook program's execute function
5. Transfer Hook validates the transfer
6. Token-2022 unsets the `transferring` flag
7. Transfer completes (or reverts if hook rejects)

## 3. Instructions

### 3.1 initialize_authority

Creates the WhitelistAuthority PDA with the transaction signer as authority. One-time initialization.

**Accounts:**
- `authority` (Signer) -- Becomes the whitelist authority
- `whitelist_authority` (PDA, init) -- `seeds = ["authority"]`

### 3.2 add_whitelist_entry

Creates a WhitelistEntry PDA for a given address.

**Guards:**
- Signer must be the current authority
- Authority must not be burned
- Address must not already be whitelisted (Anchor init prevents)

**Accounts:**
- `authority` (Signer)
- `whitelist_authority` (PDA) -- `seeds = ["authority"]`
- `whitelist_entry` (PDA, init) -- `seeds = ["whitelist", address.as_ref()]`

### 3.3 burn_authority

Permanently burns the whitelist authority by setting `authority = None`. Makes the whitelist immutable.

**Behavior:**
- Idempotent: calling on already-burned authority succeeds silently
- Signer must be the current authority (when authority exists)
- Emits `AuthorityBurned` event on first burn

### 3.4 initialize_extra_account_meta_list

Creates the ExtraAccountMetaList PDA that Token-2022 uses to resolve whitelist accounts at transfer time. Must be called once per mint before any transfers.

**Requirements:**
- Mint must be Token-2022 with TransferHook extension pointing to this program
- Authority must not be burned
- ExtraAccountMetaList must not already exist for this mint

**Extra accounts defined:**

```rust
vec![
    // Source whitelist PDA: ["whitelist", source_token_account]
    ExtraAccountMeta::new_with_seeds(&[
        Seed::Literal { bytes: b"whitelist".to_vec() },
        Seed::AccountKey { index: 0 },  // source_token_account
    ], false, false),
    // Destination whitelist PDA: ["whitelist", destination_token_account]
    ExtraAccountMeta::new_with_seeds(&[
        Seed::Literal { bytes: b"whitelist".to_vec() },
        Seed::AccountKey { index: 2 },  // destination_token_account
    ], false, false),
]
```

**PDA:** `seeds = ["extra-account-metas", mint.key().as_ref()]`

**Event:** `ExtraAccountMetaListInitialized { mint }`

### 3.5 transfer_hook (Execute)

Invoked by Token-2022 during `transfer_checked`. Validates whitelist rules.

**Uses SPL discriminator:** `#[instruction(discriminator = ExecuteInstruction::SPL_DISCRIMINATOR_SLICE)]`

## 4. Whitelist PDA Pattern

### 4.1 Existence-Based Validation

The whitelist uses an existence-based PDA pattern: if a WhitelistEntry PDA exists for an address, that address is whitelisted. PDA non-existence = not whitelisted.

### 4.2 WhitelistEntry Account

```rust
#[account]
pub struct WhitelistEntry {
    pub address: Pubkey,    // Whitelisted token account pubkey
    pub created_at: i64,    // Audit trail timestamp
}
```

- **Seeds:** `["whitelist", address.as_ref()]`
- **Size:** 8 (discriminator) + 32 (Pubkey) + 8 (i64) = 48 bytes

### 4.3 WhitelistAuthority Account

```rust
#[account]
pub struct WhitelistAuthority {
    pub authority: Option<Pubkey>,  // None = burned
    pub initialized: bool,
}
```

- **Seeds:** `["authority"]`
- **Size:** 8 (discriminator) + 33 (Option Pubkey) + 1 (bool) = 42 bytes

## 5. ExtraAccountMetaList Schema

Token-2022 uses the ExtraAccountMetaList PDA to know which additional accounts to include when invoking the Transfer Hook.

### 5.1 Resolved Accounts (4 per mint)

When `createTransferCheckedWithTransferHookInstruction` is called client-side, it resolves these accounts:

| Index | Account | Source |
|-------|---------|--------|
| 4 | extra_account_meta_list | PDA: `["extra-account-metas", mint]` |
| 5 | whitelist_source | PDA: `["whitelist", source_token_account]` |
| 6 | whitelist_destination | PDA: `["whitelist", destination_token_account]` |
| 7 | hook_program | Transfer Hook program ID |

Indices 0-3 are standard Token-2022 accounts: source_token, mint, destination_token, owner.

### 5.2 Why 4 Accounts (Not 3)

The SDK's `createTransferCheckedWithTransferHookInstruction` automatically appends the hook program ID as the 4th extra account. This is needed for Token-2022 to CPI into the hook. On-chain, `HOOK_ACCOUNTS_PER_MINT` must be 4 to correctly partition remaining_accounts in multi-hook scenarios (e.g., Carnage Sell path).

## 6. Transfer Validation Logic

### 6.1 Validation Order

1. **Zero amount check** (cheapest, fail fast)
2. **Mint owner check** (defense-in-depth: mint.owner == Token-2022)
3. **Transferring flag check** (security: verify legitimate Token-2022 context)
4. **Whitelist check with short-circuit** (business rule)

### 6.2 Whitelist Rule

A transfer is allowed if **either** the source OR destination token account is whitelisted. Both need not be whitelisted.

```rust
let source_whitelisted = is_whitelisted(&whitelist_source, &source_token.key());
if !source_whitelisted {
    let dest_whitelisted = is_whitelisted(&whitelist_destination, &destination_token.key());
    require!(dest_whitelisted, TransferHookError::NoWhitelistedParty);
}
```

Short-circuit: if source is whitelisted, destination check is skipped.

### 6.3 is_whitelisted Function

```rust
fn is_whitelisted(whitelist_pda: &AccountInfo, token_account: &Pubkey) -> bool {
    if whitelist_pda.data_is_empty() { return false; }  // PDA doesn't exist
    let (expected_pda, _) = Pubkey::find_program_address(
        &[WhitelistEntry::SEED_PREFIX, token_account.as_ref()], &crate::ID
    );
    whitelist_pda.key() == expected_pda  // Verify PDA derivation
}
```

Both existence AND derivation are checked. This prevents spoofed accounts (SECU-04).

### 6.4 Direct Invocation Prevention

The `transferring` flag on the source token account is checked. This flag is:
- Set by Token-2022 BEFORE calling the hook
- Unset by Token-2022 AFTER the hook returns

If the flag is not set, someone is trying to invoke the hook directly (attack vector). This is rejected with `DirectInvocationNotAllowed`.

## 7. Remaining Accounts Ordering: Dual-Hook

### 7.1 Single Token Transfer

For a simple transfer of one hooked token, remaining_accounts = 4 accounts (the extra accounts from Section 5.1).

### 7.2 AMM Swap (Dual Token, One Hooked)

For SOL pool swaps (WSOL + CRIME/FRAUD), only the CRIME/FRAUD side has a hook. WSOL (SPL Token) has no hook. remaining_accounts = 4.

### 7.3 PROFIT Pool Swap (Dual Hooked)

PROFIT pools have two hooked tokens. The AMM splits remaining_accounts as:

**`[INPUT hooks, OUTPUT hooks]`** -- NOT `[side A, side B]`

- **Buy (AtoB):** input = A, output = B -> send `[A hooks (4), B hooks (4)]`
- **Sell (BtoA):** input = B, output = A -> send `[B hooks (4), A hooks (4)]`

Getting this wrong causes Transfer Hook error 3005 (AccountNotEnoughKeys) because the wrong `extra_account_meta_list` PDA is passed to the wrong transfer.

### 7.4 Carnage Sell+Buy Path

The Carnage Sell path involves two swaps with different tokens, each needing its own hook accounts:

- `remaining_accounts[0..4]` = sell hook accounts (held token's mint)
- `remaining_accounts[4..8]` = buy hook accounts (target token's mint)

Partitioned by `partition_hook_accounts()` in the Epoch Program.

## 8. Error Codes

| Code | Name | Description |
|------|------|-------------|
| 6000 | NoWhitelistedParty | Neither source nor destination is whitelisted |
| 6001 | ZeroAmountTransfer | Zero amount transfers blocked |
| 6002 | Unauthorized | Signer is not the authority |
| 6003 | AuthorityAlreadyBurned | Whitelist is immutable |
| 6004 | AlreadyWhitelisted | Address already has whitelist entry |
| 6005 | InvalidWhitelistPDA | PDA derivation mismatch |
| 6006 | DirectInvocationNotAllowed | Not called from Token-2022 transfer |
| 6007 | InvalidMint | Mint not owned by Token-2022 |
| 6008 | InvalidTransferHook | Mint's hook extension doesn't point to this program |
| 6009 | NotToken2022Mint | Mint not owned by Token-2022 |

## 9. Account Layouts

### 9.1 WhitelistEntry (48 bytes)

| Field | Type | Bytes | Description |
|-------|------|-------|-------------|
| (discriminator) | [u8; 8] | 8 | Anchor account discriminator |
| address | Pubkey | 32 | Whitelisted token account pubkey |
| created_at | i64 | 8 | Creation timestamp (audit trail) |

PDA: `seeds = ["whitelist", address.as_ref()]`

### 9.2 WhitelistAuthority (42 bytes)

| Field | Type | Bytes | Description |
|-------|------|-------|-------------|
| (discriminator) | [u8; 8] | 8 | Anchor account discriminator |
| authority | Option\<Pubkey\> | 33 | Authority pubkey (None = burned) |
| initialized | bool | 1 | Initialization flag |

PDA: `seeds = ["authority"]`

### 9.3 ExtraAccountMetaList (variable)

TLV-encoded account managed by SPL Transfer Hook interface. Contains the seeds and configuration for resolving whitelist PDAs at transfer time.

PDA: `seeds = ["extra-account-metas", mint.key().as_ref()]`

## 10. CPI Dependencies

### 10.1 Inbound CPIs (Token-2022 calls this program)

| Caller | Instruction | Purpose |
|--------|-------------|---------|
| Token-2022 | `execute` (SPL discriminator) | Transfer validation |

### 10.2 No Outbound CPIs

The Transfer Hook program makes no CPI calls. It only validates and returns.

## 11. PDA Reference

| PDA | Seeds | Purpose |
|-----|-------|---------|
| WhitelistAuthority | `["authority"]` | Controls whitelist management |
| WhitelistEntry | `["whitelist", address]` | Per-address whitelist status |
| ExtraAccountMetaList | `["extra-account-metas", mint]` | Token-2022 account resolution |

## 12. Events

| Event | Fields | Emitted By |
|-------|--------|------------|
| ExtraAccountMetaListInitialized | mint | initialize_extra_account_meta_list |
| AuthorityBurned | (none) | burn_authority |

## 13. Security Model

1. **Whitelist-only transfers:** Every CRIME/FRAUD transfer must have at least one whitelisted party
2. **Protocol-controlled whitelist:** Only AMM pool vaults, user ATAs via protocol operations, and other protocol accounts are whitelisted
3. **Direct invocation blocked:** `transferring` flag check prevents calling hook outside Token-2022 context
4. **PDA derivation verified:** Prevents spoofed whitelist accounts
5. **Mint validation:** Defense-in-depth owner check on mint
6. **Authority burn:** Whitelist can be made permanently immutable
7. **Zero transfer blocked:** Prevents compute waste and potential edge cases
