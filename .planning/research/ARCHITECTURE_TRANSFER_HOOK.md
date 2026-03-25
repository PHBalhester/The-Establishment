# Architecture Patterns: Transfer Hook Program Integration

**Domain:** Token-2022 Transfer Hook for AMM Integration
**Researched:** 2026-02-05
**Confidence:** HIGH (verified against official Solana docs and existing AMM implementation)

---

## 1. Integration Points with Existing AMM

### 1.1 Current AMM Transfer Pattern

The existing AMM already implements Token-2022 transfers with hook passthrough. The integration points are:

| Component | File | Integration Role |
|-----------|------|------------------|
| `transfer_t22_checked()` | `programs/amm/src/helpers/transfers.rs` | Forwards `remaining_accounts` as hook accounts |
| `SwapSolPool` instruction | `programs/amm/src/instructions/swap_sol_pool.rs` | Passes `ctx.remaining_accounts` to transfer helper |
| `SwapProfitPool` instruction | `programs/amm/src/instructions/swap_profit_pool.rs` | Splits `remaining_accounts` for dual-hook transfers |

**Key Insight:** The AMM does NOT interpret hook logic. It simply:
1. Receives pre-resolved hook accounts from the client via `remaining_accounts`
2. Forwards them to Token-2022 via `with_remaining_accounts()`
3. Token-2022 CPIs into the Transfer Hook program

### 1.2 Integration Architecture Diagram

```
                          CLIENT (off-chain)
                                 |
            +--------------------+--------------------+
            |                    |                    |
            |  1. Fetch ExtraAccountMetaList PDA      |
            |  2. Resolve whitelist PDAs dynamically  |
            |  3. Build remaining_accounts array      |
            |                    |                    |
            +--------------------+--------------------+
                                 |
                                 v
+----------------------------------------------------------------+
|                         TAX PROGRAM                             |
|                                                                 |
|  Receives: user, swap args, pre-resolved hook accounts          |
|  Action: CPI to AMM with swap_authority signature               |
|                                                                 |
+-----------------------------+----------------------------------+
                              | CPI (depth 1)
                              v
+----------------------------------------------------------------+
|                           AMM PROGRAM                           |
|                                                                 |
|  Receives: swap_authority, pool, vaults, mints, hook accounts   |
|  Action: Call transfer_t22_checked() with hook accounts         |
|                                                                 |
+-----------------------------+----------------------------------+
                              | CPI (depth 2)
                              v
+----------------------------------------------------------------+
|                       TOKEN-2022 PROGRAM                        |
|                                                                 |
|  Receives: source, mint, destination, authority, hook accounts  |
|  Action: Execute transfer_checked, then CPI to Transfer Hook    |
|                                                                 |
+-----------------------------+----------------------------------+
                              | CPI (depth 3)
                              v
+----------------------------------------------------------------+
|                      TRANSFER HOOK PROGRAM                      |
|                                                                 |
|  Receives: source, mint, dest, owner, extra_metas, whitelist    |
|  Action: Validate whitelist, allow or reject transfer           |
|                                                                 |
+----------------------------------------------------------------+
```

### 1.3 CPI Depth Consideration

The chain is:
- Tax Program -> AMM (depth 1)
- AMM -> Token-2022 (depth 2)
- Token-2022 -> Transfer Hook (depth 3)

Solana allows CPI depth up to 4. The hook program at depth 3 should NOT make further CPIs to avoid hitting the limit.

---

## 2. Account Resolution Flow (ExtraAccountMetaList)

### 2.1 How ExtraAccountMetaList Works

ExtraAccountMetaList is a PDA that stores metadata describing additional accounts required by the transfer hook. It uses the `spl-tlv-account-resolution` library for dynamic resolution.

**PDA Derivation:**
```
seeds = ["extra-account-metas", mint_pubkey]
program = transfer_hook_program_id
```

**Storage Format:** The account stores a serialized list of `ExtraAccountMeta` entries, each describing one additional account and how to derive it.

### 2.2 Seed Types for Dynamic Resolution

Per the Transfer Hook Spec (Section 8.2), the whitelist PDAs are dynamically derived:

```rust
// In initialize_extra_account_meta_list
let extra_metas = vec![
    // Whitelist PDA for source (derived from source token account)
    ExtraAccountMeta::new_with_seeds(
        &[
            Seed::Literal { bytes: b"whitelist".to_vec() },
            Seed::AccountKey { index: 0 },  // source_account is index 0
        ],
        false,  // is_signer
        false,  // is_writable
    )?,
    // Whitelist PDA for destination (derived from destination token account)
    ExtraAccountMeta::new_with_seeds(
        &[
            Seed::Literal { bytes: b"whitelist".to_vec() },
            Seed::AccountKey { index: 2 },  // destination_account is index 2
        ],
        false,
        false,
    )?,
];
```

**Seed::AccountKey Resolution:**
- `index: 0` = source token account address (from base transfer accounts)
- `index: 2` = destination token account address (from base transfer accounts)

At transfer time, Token-2022 resolves these seeds using the actual account addresses in the transaction.

### 2.3 Account Resolution Sequence

**Client-side (using @solana/spl-token helper):**

```typescript
import { createTransferCheckedWithTransferHookInstruction } from '@solana/spl-token';

// This function automatically:
// 1. Fetches ExtraAccountMetaList PDA
// 2. Parses stored ExtraAccountMeta entries
// 3. Resolves dynamic seeds using provided accounts
// 4. Returns instruction with all accounts populated

const transferIx = await createTransferCheckedWithTransferHookInstruction(
    connection,
    sourceTokenAccount,
    mint,
    destinationTokenAccount,
    owner,
    amount,
    decimals,
    [],  // additional signers
    'confirmed',
    TOKEN_2022_PROGRAM_ID,
);
```

**What happens under the hood:**

1. Helper fetches `ExtraAccountMetaList` PDA data
2. For each `ExtraAccountMeta`:
   - If `Seed::Literal`: use the literal bytes
   - If `Seed::AccountKey { index }`: resolve to the pubkey at that index
   - Derive PDA using resolved seeds
3. Append all resolved accounts to instruction's account list
4. Append the Transfer Hook program ID as final account

### 2.4 Base Account Indices (Token-2022 Standard)

When Token-2022 CPIs to the Transfer Hook, it passes accounts in this order:

| Index | Account | Writable | Signer |
|-------|---------|----------|--------|
| 0 | Source token account | Yes | No (converted from original) |
| 1 | Mint | No | No |
| 2 | Destination token account | Yes | No |
| 3 | Owner/Authority | No | No (converted to read-only) |
| 4 | ExtraAccountMetaList PDA | No | No |
| 5+ | Dynamically resolved accounts | Per config | No |

**Important:** All accounts are converted to read-only by Token-2022 before the CPI. This prevents the hook from modifying accounts without authorization.

---

## 3. Data Flow During Transfers

### 3.1 Single Token Transfer (SOL Pool)

In a CRIME/SOL swap, only the CRIME side has a transfer hook:

```
User sells CRIME for WSOL:

1. User: CRIME token account -> Pool: CRIME vault
   +-- Hook invoked: checks whitelist_entry(user_ata) OR whitelist_entry(vault)
   +-- Vault is whitelisted -> ALLOW

2. Pool: WSOL vault -> User: WSOL token account
   +-- No hook (WSOL uses SPL Token, not Token-2022)
   +-- Pool PDA signs via signer_seeds
```

**remaining_accounts for SOL pool swap:**
```
[
    extra_account_meta_list,      // For the T22 token
    whitelist_pda_source,         // Derived from source token account
    whitelist_pda_destination,    // Derived from destination token account
    transfer_hook_program,        // Hook program ID
]
```

### 3.2 Dual Token Transfer (PROFIT Pool)

In a CRIME/PROFIT swap, BOTH tokens have transfer hooks:

```
User sells CRIME for PROFIT:

1. User: CRIME ata -> Pool: CRIME vault
   +-- Hook invoked: checks whitelist
   +-- Vault is whitelisted -> ALLOW

2. Pool: PROFIT vault -> User: PROFIT ata
   +-- Hook invoked: checks whitelist
   +-- Vault is whitelisted -> ALLOW
```

**remaining_accounts for PROFIT pool swap (split at midpoint):**
```
// First half: input transfer hook accounts
[
    extra_account_meta_list_input,
    whitelist_pda_input_source,
    whitelist_pda_input_dest,
    transfer_hook_program,
]
// Second half: output transfer hook accounts
[
    extra_account_meta_list_output,
    whitelist_pda_output_source,
    whitelist_pda_output_dest,
    transfer_hook_program,
]
```

The AMM's `swap_profit_pool` handler splits these:
```rust
let hook_account_count = ctx.remaining_accounts.len() / 2;
let (input_hook_accounts, output_hook_accounts) =
    ctx.remaining_accounts.split_at(hook_account_count);
```

### 3.3 Whitelist Validation Logic

The hook's `transfer_hook` instruction validates:

```rust
pub fn transfer_hook(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
    // 1. Block zero-amount transfers
    require!(amount > 0, TransferHookError::ZeroAmountTransfer);

    // 2. Check if source OR destination is whitelisted
    let source_whitelisted = is_whitelist_pda_valid(
        &ctx.accounts.whitelist_entry_source,
        &ctx.accounts.source_account.key()
    );
    let dest_whitelisted = is_whitelist_pda_valid(
        &ctx.accounts.whitelist_entry_dest,
        &ctx.accounts.destination_account.key()
    );

    // 3. At least one must be whitelisted
    require!(
        source_whitelisted || dest_whitelisted,
        TransferHookError::NoWhitelistedParty
    );

    Ok(())
}
```

The `is_whitelist_pda_valid` function verifies:
1. The PDA derivation matches the expected address
2. The account exists (non-empty data)

---

## 4. Component Boundaries

### 4.1 Transfer Hook Program Components

| Component | Responsibility | State |
|-----------|---------------|-------|
| WhitelistAuthority | Controls whitelist modification (until burned) | PDA: `["authority"]` |
| WhitelistEntry | Marks an address as whitelisted | PDA: `["whitelist", address]` |
| ExtraAccountMetaList | Stores account resolution metadata | PDA: `["extra-account-metas", mint]` |

### 4.2 Boundary Rules

**Transfer Hook Program:**
- DOES: Validate whitelist membership
- DOES: Store whitelist entries
- DOES: Define extra account metadata
- DOES NOT: Know about swaps, pools, or AMM logic
- DOES NOT: Modify any accounts (read-only validation)
- DOES NOT: Make further CPIs (depth 3 limit)

**AMM Program:**
- DOES: Execute swap math and transfers
- DOES: Forward hook accounts to Token-2022
- DOES NOT: Interpret hook logic
- DOES NOT: Know which addresses are whitelisted
- DOES NOT: Derive whitelist PDAs (client does this)

**Client:**
- DOES: Resolve ExtraAccountMetaList
- DOES: Derive whitelist PDAs for source/destination
- DOES: Build `remaining_accounts` array
- DOES: Call Tax Program (which calls AMM)

---

## 5. Build Order Rationale

### 5.1 Recommended Implementation Phases

Based on the architecture and existing AMM patterns:

**Phase 1: State Definitions**
```
WhitelistAuthority account
WhitelistEntry account
TransferHookError enum
Events (AuthorityBurned, AddressWhitelisted, TransferBlocked)
```
*Rationale:* State structs are foundational. Define them first so instructions can reference them.

**Phase 2: Admin Instructions**
```
initialize_authority
add_whitelist_entry
burn_authority
```
*Rationale:* Admin functionality allows populating whitelist before hook is active. These instructions are simpler (no CPI complexity) and can be tested independently.

**Phase 3: ExtraAccountMetaList Setup**
```
initialize_extra_account_meta_list
```
*Rationale:* Requires understanding of the Seed enum and ExtraAccountMeta struct. Build after state is solid. Must be initialized before transfers can work.

**Phase 4: Transfer Hook Entry Point**
```
transfer_hook (the Execute instruction)
```
*Rationale:* This is the core hook logic. Build it last because:
1. Depends on WhitelistEntry state
2. Account structure must match ExtraAccountMetaList definition
3. Requires integration testing with Token-2022

### 5.2 Why This Order Mirrors AMM Patterns

The existing AMM followed a similar pattern:
1. State (`PoolState`, `AdminState`) - defined first
2. Initialize instructions - admin setup before main logic
3. Core functionality (`swap_*`) - built on top of stable state

The Transfer Hook follows the same principle:
1. State first (WhitelistEntry, WhitelistAuthority)
2. Setup instructions (admin + extra_account_meta)
3. Core hook last (transfer_hook)

### 5.3 Integration Testing Order

| Test Phase | Tests | Dependencies |
|------------|-------|--------------|
| 1. Unit | Whitelist PDA derivation | None |
| 2. Unit | Authority lifecycle | State definitions |
| 3. Integration | ExtraAccountMetaList resolution | Phase 2 deployed |
| 4. Integration | Standalone hook validation | Phase 3 deployed |
| 5. End-to-end | AMM swap with hook | All phases deployed |

---

## 6. Anti-Patterns to Avoid

### 6.1 Anti-Pattern: Hook Making External CPIs

**Bad:**
```rust
// DON'T do this in transfer_hook
pub fn transfer_hook(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
    // Making another CPI at depth 3 risks hitting depth 4 limit
    some_other_program::cpi::do_something(...)?;  // DANGEROUS
    Ok(())
}
```

**Why:** The hook executes at CPI depth 3. Any further CPI risks hitting the depth 4 limit, causing unpredictable failures.

**Instead:** Keep hook logic self-contained. All validation should use accounts already in the instruction.

### 6.2 Anti-Pattern: Mutable State in Hook

**Bad:**
```rust
// DON'T do this
pub fn transfer_hook(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
    ctx.accounts.some_counter.count += 1;  // Writing state
    Ok(())
}
```

**Why:** Token-2022 converts all accounts to read-only before the CPI. Writing would fail.

**Instead:** The hook should only validate. If you need to track transfer counts, do it in a separate instruction.

### 6.3 Anti-Pattern: Missing Whitelist Entry Tolerance

**Bad:**
```rust
// DON'T do this
fn is_whitelist_pda_valid(account: &AccountInfo, expected: &Pubkey) -> bool {
    // Assumes account always exists - will panic if None
    account.key() == expected_pda  // No existence check
}
```

**Why:** Whitelist PDAs may not exist for non-whitelisted addresses. The function must handle this gracefully.

**Good:**
```rust
fn is_whitelist_pda_valid(account: &Option<AccountInfo>, expected: &Pubkey) -> bool {
    match account {
        Some(acc) => {
            let (expected_pda, _) = Pubkey::find_program_address(
                &[b"whitelist", expected.as_ref()],
                &crate::ID
            );
            acc.key() == expected_pda && !acc.data_is_empty()
        }
        None => false
    }
}
```

### 6.4 Anti-Pattern: Using `transfer` Instead of `transfer_checked`

**Bad:**
```rust
// In AMM - DON'T do this
spl_token_2022::instruction::transfer(...);  // Skips hook!
```

**Why:** Plain `transfer` does NOT invoke transfer hooks. Only `transfer_checked` triggers the hook.

**Instead:** Always use `transfer_checked` for Token-2022 tokens. The existing AMM code correctly uses `transfer_checked`:

```rust
token_interface::transfer_checked(cpi_ctx, amount, decimals)
```

---

## 7. Scalability Considerations

| Concern | At 100 users | At 10K users | At 1M users |
|---------|--------------|--------------|-------------|
| Whitelist PDAs | 14 entries (fixed) | 14 entries | 14 entries |
| ExtraAccountMetaList | 3 accounts (per mint) | 3 accounts | 3 accounts |
| Hook compute | ~5K CU per transfer | Same | Same |
| Client resolution | Simple SDK call | Same | Same |

**Key insight:** The whitelist is fixed at 14 protocol addresses. It does not scale with users. Each user transfer validates against the same 14 whitelist entries (checking if source or destination matches any whitelisted address).

---

## 8. Interface Contract with Existing Code

### 8.1 What AMM Expects from Transfer Hook

The AMM's `transfer_t22_checked` helper (line 36-83 in transfers.rs) expects:

```rust
// AMM passes these as remaining_accounts:
// 1. ExtraAccountMetaList PDA
// 2. Dynamically resolved whitelist PDAs
// 3. Transfer Hook program ID

cpi_ctx = cpi_ctx.with_remaining_accounts(hook_accounts.to_vec());
token_interface::transfer_checked(cpi_ctx, amount, decimals)
```

**The Transfer Hook MUST:**
1. Implement the `Execute` interface (transfer_hook instruction)
2. Have ExtraAccountMetaList initialized for each mint
3. Define whitelist PDAs using the exact seeds from the spec

### 8.2 What Transfer Hook Expects from AMM

The Transfer Hook receives accounts from Token-2022 (not directly from AMM):

```
Index 0: source_account (token account)
Index 1: mint
Index 2: destination_account (token account)
Index 3: owner (authority)
Index 4: extra_account_meta_list
Index 5: whitelist_entry_source (from dynamic resolution)
Index 6: whitelist_entry_dest (from dynamic resolution)
```

**The Transfer Hook should NOT:**
- Assume any specific account ordering beyond the Token-2022 standard
- Try to access AMM-specific accounts (pool state, vaults)
- Make assumptions about who the owner is (could be user or pool PDA)

---

## 9. Sources

**Official Documentation:**
- [Solana Transfer Hook Guide](https://solana.com/developers/guides/token-extensions/transfer-hook) - Account resolution, CPI flow
- [SPL Transfer Hook Interface](https://www.solana-program.com/docs/transfer-hook-interface) - Interface specification

**Project Documentation:**
- `/Users/mlbob/Projects/Dr Fraudsworth/Docs/Transfer_Hook_Spec.md` - Whitelist PDAs, ExtraAccountMeta seeds
- `/Users/mlbob/Projects/Dr Fraudsworth/Docs/AMM_Implementation.md` - Integration contract
- `/Users/mlbob/Projects/Dr Fraudsworth/Docs/Protocol_Initialzation_and_Launch_Flow.md` - Deployment sequence

**Existing Implementation:**
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/amm/src/helpers/transfers.rs` - transfer_t22_checked pattern
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/amm/src/instructions/swap_profit_pool.rs` - Dual-hook splitting
