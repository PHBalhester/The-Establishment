# Phase 10: Token Transfer Routing - Research

**Researched:** 2026-02-04
**Domain:** Token-2022 transfer CPI with hook account passthrough, SPL Token transfers, Anchor CPI patterns
**Confidence:** HIGH

## Summary

Phase 10 builds the transfer abstraction layer that correctly routes token transfers between SPL Token (WSOL) and Token-2022 (CRIME/FRAUD/PROFIT) with hook account passthrough. This research covers how to implement `transfer_checked` CPI with transfer hook accounts in Anchor 0.32, how to handle PDA-signed vault-to-user transfers, how `remaining_accounts` work for hook account passthrough, and how to test with T22 mints that have the Transfer Hook extension in litesvm.

The key architectural discovery is that there are **two viable approaches** for T22 transfers with hooks, and the CONTEXT.md decision (caller pre-resolves, helper just uses what's passed in) aligns with the simpler approach: using `spl_token_2022::onchain::invoke_transfer_checked` which handles hook account resolution from a flat list of account infos, or manually building a `transfer_checked` CPI and appending the hook accounts. Given the CONTEXT.md decision that "caller pre-resolves ExtraAccountMetas client-side" and hook accounts come via `remaining_accounts`, the cleanest approach is to use Anchor's `token_interface::transfer_checked` with the extra accounts manually appended to the CPI using `with_remaining_accounts`.

**Primary recommendation:** Use Anchor's `token_interface::transfer_checked` via `CpiContext::new().with_signer().with_remaining_accounts()` for T22 transfers, and standard `token_interface::transfer_checked` (no remaining accounts) for SPL Token transfers. The `remaining_accounts` on the instruction carry the hook program, ExtraAccountMetaList, and dynamically-resolved extra accounts that get forwarded into the CPI.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `anchor-lang` | 0.32.1 | Program framework | Already in use, provides CpiContext and account validation |
| `anchor-spl` | 0.32.1 | Token interface CPI wrappers | `token_interface::transfer_checked` is the Anchor-idiomatic way to do T22 transfers |
| `spl-token-2022` | 8.0 | T22 instruction creation, extension types | Already in dev-deps; needed for creating T22 mints with extensions in tests |
| `spl-transfer-hook-interface` | 0.8 | Hook account resolution helpers | `get_extra_account_metas_address()` for ExtraAccountMetaList PDA derivation. **May need for tests.** |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `spl-tlv-account-resolution` | 0.8 | ExtraAccountMeta/Seed types | Only if building the mock hook program's ExtraAccountMetaList in tests |
| `litesvm` | 0.9.1 | Integration testing | Already in use from Phase 9; same type bridge pattern applies |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `token_interface::transfer_checked` + `with_remaining_accounts` | `spl_token_2022::onchain::invoke_transfer_checked` | The `onchain` helper does on-chain resolution from ExtraAccountMetaList data, but requires raw `invoke_signed` instead of Anchor CPI wrappers. More complex, less Anchor-idiomatic, and CONTEXT.md says caller pre-resolves. |
| Separate `transfer_t22_checked()` and `transfer_spl()` | Single generic `transfer()` with runtime dispatch | CONTEXT.md explicitly locks separate functions. Separate is safer -- no accidental hook bypass. |

**Installation:**
```toml
# Already present in Cargo.toml. May need to add:
[dependencies]
spl-transfer-hook-interface = "0.8"  # Only if needed for PDA derivation

[dev-dependencies]
spl-tlv-account-resolution = "0.8"   # For test ExtraAccountMetaList setup
```

Note: Version compatibility needs verification at implementation time. The `spl-transfer-hook-interface` crate depends on `solana-program`, so we need to verify it's compatible with Anchor 0.32's Solana 2.x dependency. If there's a version conflict, we can derive the ExtraAccountMetaList PDA manually (seeds = `["extra-account-metas", mint]` under the hook program).

## Architecture Patterns

### Recommended Module Structure
```
programs/amm/src/
├── helpers/
│   ├── mod.rs           # pub mod math; pub mod transfers;
│   ├── math.rs          # Existing swap math (Phase 8)
│   └── transfers.rs     # NEW: transfer_t22_checked() and transfer_spl()
```

**Rationale:** Dedicated `transfers.rs` keeps transfer helpers separate from math helpers, consistent with the existing module structure. Both are in `helpers/` because they're utility functions called by instruction handlers, not instruction handlers themselves.

### Pattern 1: T22 Transfer with Hook Account Passthrough

**What:** Transfer Token-2022 tokens via `transfer_checked` CPI, forwarding hook accounts from `remaining_accounts`.

**When to use:** Any transfer of CRIME, FRAUD, or PROFIT tokens (all T22 with transfer hooks).

**How it works:**
1. Client pre-resolves ExtraAccountMetas off-chain (standard T22 pattern)
2. Client passes hook accounts as `remaining_accounts` on the instruction
3. AMM instruction handler passes them through to the CPI via `with_remaining_accounts`
4. Token-2022 program receives the transfer_checked instruction with the appended hook accounts
5. Token-2022 internally CPIs to the hook program with the extra accounts

```rust
// Source: Anchor docs + Solana official Transfer Hook Interface docs
pub fn transfer_t22_checked<'info>(
    token_program: &AccountInfo<'info>,
    from: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    amount: u64,
    decimals: u8,
    signer_seeds: &[&[&[u8]]],
    hook_accounts: &[AccountInfo<'info>],
) -> Result<()> {
    // Defense-in-depth: verify token program is T22
    require!(
        *token_program.key == anchor_spl::token_2022::ID,
        AmmError::InvalidTokenProgram
    );
    require!(amount > 0, AmmError::ZeroAmount);

    let cpi_accounts = TransferChecked {
        from: from.clone(),
        mint: mint.clone(),
        to: to.clone(),
        authority: authority.clone(),
    };

    let cpi_ctx = if signer_seeds.is_empty() {
        CpiContext::new(token_program.clone(), cpi_accounts)
    } else {
        CpiContext::new_with_signer(token_program.clone(), cpi_accounts, signer_seeds)
    };

    // Append hook accounts (ExtraAccountMetaList accounts + hook program)
    // These are forwarded to Token-2022 which uses them for the hook CPI
    token_interface::transfer_checked(
        cpi_ctx.with_remaining_accounts(hook_accounts.to_vec()),
        amount,
        decimals,
    )
}
```

### Pattern 2: SPL Token Transfer (WSOL)

**What:** Transfer WSOL using standard SPL Token `transfer` (via `transfer_checked` for consistency, since `transfer_checked` also works with SPL Token).

**When to use:** WSOL side of CRIME/SOL and FRAUD/SOL pools.

```rust
// Source: Anchor docs
pub fn transfer_spl<'info>(
    token_program: &AccountInfo<'info>,
    from: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    amount: u64,
    decimals: u8,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    // Defense-in-depth: verify token program is SPL Token
    require!(
        *token_program.key == anchor_spl::token::ID,
        AmmError::InvalidTokenProgram
    );
    require!(amount > 0, AmmError::ZeroAmount);

    let cpi_accounts = TransferChecked {
        from: from.clone(),
        mint: mint.clone(),
        to: to.clone(),
        authority: authority.clone(),
    };

    let cpi_ctx = if signer_seeds.is_empty() {
        CpiContext::new(token_program.clone(), cpi_accounts)
    } else {
        CpiContext::new_with_signer(token_program.clone(), cpi_accounts, signer_seeds)
    };

    // No remaining_accounts -- SPL Token has no hook support
    token_interface::transfer_checked(cpi_ctx, amount, decimals)
}
```

### Pattern 3: PDA-Signed Vault-to-User Transfer

**What:** Transfer tokens from a PDA-owned vault using the pool PDA as signer.

**When to use:** Output side of every swap (vault sends tokens to user).

```rust
// Source: Anchor docs for CpiContext::new_with_signer
let pool = &ctx.accounts.pool;
let mint_a_key = pool.mint_a;
let mint_b_key = pool.mint_b;
let bump = pool.bump;

// Signer seeds MUST match the PDA derivation exactly
let signer_seeds: &[&[&[u8]]] = &[&[
    POOL_SEED,
    mint_a_key.as_ref(),
    mint_b_key.as_ref(),
    &[bump],
]];

// Then pass signer_seeds to transfer_t22_checked or transfer_spl
```

**Critical detail:** The seed values must be computed from the pool state's stored `mint_a` and `mint_b` pubkeys, not from instruction accounts. This ensures the PDA derivation is always correct even if instruction accounts are somehow wrong (belt-and-suspenders).

### Pattern 4: Hook Account Splitting for Dual-Hook Pools

**What:** For PROFIT pools (PureT22Pool), `remaining_accounts` contains hook accounts for BOTH tokens, split by `hook_accounts_a` argument.

**When to use:** CRIME/PROFIT and FRAUD/PROFIT pool swaps.

```rust
// Instruction receives hook_accounts_a: u8 as an arg
// remaining_accounts layout:
// [0..hook_accounts_a) -> hook accounts for token A
// [hook_accounts_a..)  -> hook accounts for token B

let all_remaining = &ctx.remaining_accounts;
let split_point = hook_accounts_a as usize;

let hook_accounts_a_slice = &all_remaining[..split_point];
let hook_accounts_b_slice = &all_remaining[split_point..];
```

### Anti-Patterns to Avoid

- **Never use plain `transfer` for T22 tokens:** Token-2022 requires `transfer_checked` for tokens with extensions. Plain `transfer` will succeed but SKIP the hook invocation entirely, bypassing whitelist enforcement. This is a critical security vulnerability.
- **Never hardcode the hook program ID:** Read it from the mint's Transfer Hook extension data or accept it as a passed account. CONTEXT.md explicitly requires per-token hook program resolution from mint data.
- **Never call Token-2022 for WSOL:** WSOL is owned by SPL Token. Calling T22's transfer_checked with a SPL Token account will fail with `IncorrectProgramId`.
- **Never derive PDA seeds from instruction accounts for signing:** Always use stored pool state values to prevent substitution attacks.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| T22 transfer CPI | Raw `invoke_signed` with manual instruction serialization | `anchor_spl::token_interface::transfer_checked` | Anchor handles instruction encoding, account validation, and error mapping |
| ExtraAccountMetaList PDA address | Manual seed concatenation | `spl_transfer_hook_interface::get_extra_account_metas_address()` or manual PDA derivation with known seeds `["extra-account-metas", mint]` | Standard derivation, auditors expect it |
| Hook account resolution (off-chain) | Custom account fetching | `spl-transfer-hook-interface` offchain helper | Standard T22 pattern, handles dynamic seed resolution |
| Mock hook program for tests | Full transfer hook implementation | Simple BPF program that always approves | Phase 10 tests hook account passthrough, not hook logic |

**Key insight:** The AMM does NOT interpret hook logic. It just passes the right accounts through to Token-2022, which handles the hook CPI internally. The complexity is in getting the account list right, not in building hook logic.

## Common Pitfalls

### Pitfall 1: Using `transfer` Instead of `transfer_checked` for T22

**What goes wrong:** The transfer succeeds but the transfer hook is NEVER invoked. Whitelist enforcement is silently bypassed. Users can transfer CRIME/FRAUD/PROFIT tokens to any address.

**Why it happens:** SPL Token's `transfer` instruction exists in Token-2022 for backwards compatibility but does not trigger hooks. Only `transfer_checked` (which requires the mint account and decimals) triggers hook invocation.

**How to avoid:** The transfer helpers enforce this at the function level -- `transfer_t22_checked` always uses `transfer_checked`. The AMM never has a code path that calls plain `transfer`.

**Warning signs:** Token transfers succeed without hook program logs in transaction. Test for this by checking hook execution in transaction logs.

### Pitfall 2: Missing Hook Accounts in CPI

**What goes wrong:** `transfer_checked` CPI succeeds if the mint has no hooks, but fails with a cryptic error if the mint has Transfer Hook extension and the hook accounts are missing from the instruction's remaining accounts.

**Why it happens:** Token-2022 looks at the mint's Transfer Hook extension to find the hook program. If present, it expects the ExtraAccountMetaList PDA and any resolved extra accounts to be in the instruction's remaining accounts. If they're missing, the CPI fails.

**How to avoid:** Client MUST pre-resolve ExtraAccountMetas and pass them as remaining_accounts. Tests MUST exercise the full path with real T22 mints configured with the Transfer Hook extension.

**Warning signs:** Transfer failures with generic "invalid account" or "incorrect account" errors.

### Pitfall 3: Incorrect `remaining_accounts` Ordering

**What goes wrong:** Hook accounts are passed but in wrong order, causing the hook program to receive wrong account at wrong index, leading to PDA derivation mismatch or data deserialization failure.

**Why it happens:** The ExtraAccountMetaList encodes account positions by index. If accounts are in a different order than what the ExtraAccountMetaList expects, resolution fails.

**How to avoid:** Follow the T22 standard ordering:
1. First, the extra accounts resolved from ExtraAccountMetaList (in order)
2. Then, the hook program account
3. Then, the ExtraAccountMetaList PDA itself

This ordering is what `spl-transfer-hook-interface` offchain helpers produce. The AMM just forwards them as-is.

### Pitfall 4: PDA Signer Seeds Lifetime Issues

**What goes wrong:** Rust borrow checker complains about temporary values when constructing signer seeds.

**Why it happens:** The signer seeds array references byte slices. If the Pubkey is a temporary (e.g., from a function return), its bytes are dropped before the CPI executes.

**How to avoid:** Bind the Pubkey values to local variables BEFORE constructing the seeds array:

```rust
// CORRECT: bind to locals first
let mint_a_key = pool.mint_a;
let mint_b_key = pool.mint_b;
let bump = pool.bump;
let signer_seeds: &[&[&[u8]]] = &[&[b"pool", mint_a_key.as_ref(), mint_b_key.as_ref(), &[bump]]];

// WRONG: temporary dropped
let signer_seeds: &[&[&[u8]]] = &[&[b"pool", pool.mint_a.as_ref(), ...]]; // May work, but fragile
```

### Pitfall 5: Token Account Size Mismatch for T22 with Extensions

**What goes wrong:** Creating token accounts for T22 mints with Transfer Hook extension using the standard 165-byte size fails because T22 token accounts need extra space for extension data.

**Why it happens:** Phase 9 tests create T22 mints WITHOUT extensions (82-byte mint, 165-byte accounts). Phase 10 tests need T22 mints WITH Transfer Hook extension, which requires larger mint accounts (82 + extension space) and the mint must be initialized with the extension BEFORE `InitializeMint`.

**How to avoid:** Use `ExtensionType::try_calculate_account_len` to compute correct sizes, and initialize extensions BEFORE the mint instruction:
1. `SystemProgram::CreateAccount` with correct extended size
2. `InitializeTransferHook` (sets hook program on mint)
3. `InitializeMint2` (finalizes mint)

### Pitfall 6: anchor-spl `with_remaining_accounts` vs Raw Account Appending

**What goes wrong:** Passing hook accounts via CPI but they don't reach Token-2022 because they weren't added to the CPI instruction's account list.

**Why it happens:** Anchor's `CpiContext::with_remaining_accounts()` is the correct way to append extra accounts to a CPI call. Using `ctx.remaining_accounts` directly without passing them through `with_remaining_accounts` on the CPI context means they're available to the AMM instruction but NOT forwarded to the CPI target.

**How to avoid:** Always use `.with_remaining_accounts(hook_accounts.to_vec())` on the CpiContext when making transfer_checked calls for T22 tokens.

## Code Examples

### Creating a T22 Mint with Transfer Hook Extension (Test Setup)

```rust
// Source: spl-token-2022 docs, adapted for litesvm
// The key difference from Phase 9's create_t22_mint is the extension setup

fn create_t22_mint_with_hook(
    svm: &mut LiteSVM,
    authority: &LiteKeypair,
    decimals: u8,
    hook_program_id: &Pubkey,
) -> Pubkey {
    let mint_kp = LiteKeypair::new();
    let mint_pk = kp_pubkey(&mint_kp);

    // T22 mint with Transfer Hook extension needs more space than base mint
    // Base mint = 82 bytes
    // Transfer Hook extension: ~4 bytes (type) + ~2 bytes (length) + 64 bytes (data: authority + program_id)
    // Use spl_token_2022::extension::ExtensionType::try_calculate_account_len
    // Or hardcode: 82 (base) + 4 + 2 + 64 = ~152+ bytes
    // Safe approach: use the spl-token-2022 helper
    let extensions = &[spl_token_2022::extension::ExtensionType::TransferHook];
    let space = spl_token_2022::extension::ExtensionType::try_calculate_account_len::<
        spl_token_2022::state::Mint,
    >(extensions)
    .unwrap();

    // Instructions in order:
    // 1. CreateAccount (with extended size, owned by Token-2022)
    // 2. InitializeTransferHook (set hook program on mint)
    // 3. InitializeMint2 (finalize mint)

    // ... (construct instructions, send transaction)
}
```

### ExtraAccountMetaList Initialization (Mock Hook Setup in Tests)

```rust
// Source: Transfer Hook Interface docs
// For tests, we need to initialize the ExtraAccountMetaList PDA
// This is normally done by the hook program, but for Phase 10 tests
// we create a mock that stores the whitelist PDA configurations

// ExtraAccountMetaList PDA seeds:
// ["extra-account-metas", mint_pubkey] under hook_program_id

// For Dr Fraudsworth's hook, the extra metas are:
// 1. Whitelist PDA for source: seeds = ["whitelist", source_account_key]
// 2. Whitelist PDA for dest:   seeds = ["whitelist", dest_account_key]
// These use Seed::AccountKey { index: 0 } and Seed::AccountKey { index: 2 }
```

### Transfer Helper with remaining_accounts Forwarding

```rust
// Source: Synthesized from Anchor docs and Transfer Hook Interface docs
use anchor_spl::token_interface::{self, TransferChecked};

pub fn transfer_t22_checked<'info>(
    token_program: &AccountInfo<'info>,
    from: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    amount: u64,
    decimals: u8,
    signer_seeds: &[&[&[u8]]],
    remaining_hook_accounts: &[AccountInfo<'info>],
) -> Result<()> {
    require!(
        *token_program.key == anchor_spl::token_2022::ID,
        AmmError::InvalidTokenProgram
    );
    require!(amount > 0, AmmError::ZeroAmount);

    let cpi_accounts = TransferChecked {
        from: from.clone(),
        mint: mint.clone(),
        to: to.clone(),
        authority: authority.clone(),
    };

    let mut cpi_ctx = if signer_seeds.is_empty() {
        CpiContext::new(token_program.clone(), cpi_accounts)
    } else {
        CpiContext::new_with_signer(token_program.clone(), cpi_accounts, signer_seeds)
    };

    // Forward hook accounts to Token-2022 for hook invocation
    if !remaining_hook_accounts.is_empty() {
        cpi_ctx = cpi_ctx.with_remaining_accounts(remaining_hook_accounts.to_vec());
    }

    token_interface::transfer_checked(cpi_ctx, amount, decimals)
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `spl_token::instruction::transfer` | `transfer_checked` via `token_interface` | Token-2022 launch (2023) | MUST use transfer_checked for T22 tokens or hooks are silently skipped |
| Manual `invoke_signed` for T22 CPI | Anchor `token_interface::transfer_checked` with `with_remaining_accounts` | Anchor 0.30+ (2024) | Idiomatic Anchor pattern, auto-handles instruction encoding |
| Hardcoded hook program in AMM | Resolve from mint's Transfer Hook extension | T22 standard | Decouples AMM from specific hook programs |
| `anchor-litesvm` for integration tests | Direct `litesvm` with type bridge | Anchor 0.32 (confirmed Phase 9) | `anchor-litesvm 0.3.0` requires anchor-lang 1.0.0-rc.2, incompatible |

**Deprecated/outdated:**
- Plain `transfer` instruction for Token-2022 tokens: Silently skips hooks. NEVER use.
- `spl_token_2022::onchain::invoke_transfer_checked` with on-chain resolution: Still valid but more complex than needed when caller pre-resolves off-chain per CONTEXT.md decisions.

## Open Questions

1. **`spl-transfer-hook-interface` Version Compatibility**
   - What we know: The crate exists in the `spl-transfer-hook-interface` package. Version 0.8 is current.
   - What's unclear: Whether version 0.8 is compatible with `solana-program 2.2` (used by Anchor 0.32.1). The SPL crates sometimes lag behind major Solana versions.
   - Recommendation: Try adding it as a dependency. If incompatible, derive the ExtraAccountMetaList PDA manually with `Pubkey::find_program_address(&[b"extra-account-metas", mint.as_ref()], &hook_program_id)`. The PDA derivation is trivial.

2. **T22 Mint with Transfer Hook Extension in litesvm**
   - What we know: Phase 9 creates T22 mints WITHOUT extensions. Phase 10 needs mints WITH Transfer Hook extension. The instruction sequence is CreateAccount -> InitializeTransferHook -> InitializeMint2.
   - What's unclear: Whether litesvm's built-in Token-2022 program handles the Transfer Hook extension fully (it handles basic T22 operations per Phase 9 tests). The Transfer Hook extension itself is just data on the mint -- the question is whether litesvm's T22 program properly CPIs to the hook program during `transfer_checked`.
   - Recommendation: Start by testing. If litesvm's T22 doesn't invoke the hook, the tests can still verify account passthrough by checking that the correct accounts are in the instruction (the hook invocation itself is Token-2022's responsibility, not the AMM's).

3. **Mock Hook Program BPF Binary**
   - What we know: CONTEXT.md says to use a "simple always-approve hook" for tests. This needs to be a deployed BPF program that litesvm can execute.
   - What's unclear: The simplest way to create a minimal BPF program for litesvm. Options: (a) build a minimal Rust program, (b) use the SPL transfer-hook-example program, (c) skip hook invocation and only test account passthrough.
   - Recommendation: Build a minimal Anchor program that implements the `#[interface(spl_transfer_hook_interface::execute)]` pattern. If that's too heavy for Phase 10, option (c) is acceptable since the AMM's responsibility is passing the right accounts, not executing hook logic.

4. **`with_remaining_accounts` Account Info Cloning Cost**
   - What we know: `with_remaining_accounts` takes a `Vec<AccountInfo>`. AccountInfo cloning is cheap (it's reference-counted internally).
   - What's unclear: Whether passing many remaining_accounts (e.g., 4-6 for dual-hook PROFIT pool) hits compute budget concerns.
   - Recommendation: Not a concern for Phase 10. The protocol has at most 2 extra metas per hook invocation (2 whitelist PDAs) + hook program + ExtraAccountMetaList = 4 accounts per side, 8 max for dual-hook. Well within limits.

## Sources

### Primary (HIGH confidence)
- Solana official Transfer Hook Interface docs (`solana-program.com/docs/transfer-hook-interface`) - ExtraAccountMetaList format, on-chain CPI helper pattern, account ordering
- Solana official On-chain Program Guide (`solana-program.com/docs/token-2022/onchain`) - T22 dual-program support, `transfer_checked` requirement
- Anchor 0.30 release notes - `#[interface]` attribute for transfer hooks, Token Extensions CPI wrappers
- Transfer Hook Interface specification - Execute instruction account ordering (source, mint, dest, authority, validation, extras)
- Existing AMM codebase (Phase 8-9) - Account structure, PDA patterns, litesvm type bridge

### Secondary (MEDIUM confidence)
- Anchor expert analysis - PDA signer seed construction patterns, CpiContext::new_with_signer usage
- Stack Exchange answers - `spl_token_2022::onchain::invoke_transfer_checked` usage pattern with remaining_accounts
- SPL Transfer Hook example program - InitializeExtraAccountMetaList pattern

### Tertiary (LOW confidence)
- `spl-transfer-hook-interface` version 0.8 compatibility with Solana 2.x - needs verification at implementation time
- litesvm Transfer Hook extension support completeness - needs testing

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Anchor token_interface and spl-token-2022 are well-documented, already in use
- Architecture: HIGH - Patterns verified against official Solana docs and Anchor docs, aligned with CONTEXT.md decisions
- Pitfalls: HIGH - Identified from official docs, multiple verified sources agree on transfer vs transfer_checked risk
- Test approach: MEDIUM - litesvm T22 extension handling needs verification, mock hook program approach is standard but implementation details unclear

**Research date:** 2026-02-04
**Valid until:** 2026-03-04 (stable domain, Anchor 0.32 is well-established)
