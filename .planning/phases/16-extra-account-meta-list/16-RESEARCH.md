# Phase 16: ExtraAccountMetaList Setup - Research

**Researched:** 2026-02-05
**Domain:** Token-2022 Transfer Hook ExtraAccountMetaList initialization
**Confidence:** HIGH

## Summary

This phase implements the `initialize_extra_account_meta_list` instruction that creates the PDA Token-2022 uses to resolve dynamic whitelist accounts at transfer time. The ExtraAccountMetaList stores two entries: one for source whitelist PDA (using account index 0) and one for destination whitelist PDA (using account index 2).

The implementation uses `spl-transfer-hook-interface` 0.10.0 and `spl-tlv-account-resolution` 0.10.0, which are already available as transitive dependencies through anchor-spl's token_2022 feature. The key technical elements are:
- Using `#[interface(spl_transfer_hook_interface::initialize_extra_account_meta_list)]` to override Anchor's discriminator
- Using `Seed::Literal` for the "whitelist" prefix and `Seed::AccountKey` for dynamic account references
- Validating the mint is Token-2022 (not SPL Token) and has our program as its transfer hook

**Primary recommendation:** Use the `#[interface]` macro for discriminator, `ExtraAccountMeta::new_with_seeds` for dynamic PDA resolution, and validate mint ownership before initialization.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| spl-transfer-hook-interface | 0.10.0 | `ExecuteInstruction` type, discriminator, interface definitions | Official SPL interface; already in Cargo.lock via anchor-spl |
| spl-tlv-account-resolution | 0.10.0 | `ExtraAccountMeta`, `ExtraAccountMetaList`, `Seed` enum | Official companion crate for account resolution |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| anchor-spl | 0.32.1 | `InterfaceMint`, `token_2022::ID` for validation | Already used; provides T22 types |

### Already Available (no Cargo.toml changes needed)
These crates are already in Cargo.lock as transitive dependencies. For Phase 16, we need to add them as explicit dependencies in `programs/transfer-hook/Cargo.toml`:

```toml
[dependencies]
anchor-lang = { version = "0.32.1" }
anchor-spl = { version = "0.32.1", features = ["token_2022"] }
spl-transfer-hook-interface = "0.10.0"
spl-tlv-account-resolution = "0.10.0"
```

**Note:** Version 0.10.0 uses Solana SDK 2.2.1 modular crates, compatible with Anchor 0.32.1. Do NOT use version 2.1.0 which requires Solana SDK v3.

## Architecture Patterns

### Instruction Structure

```
programs/transfer-hook/src/
    instructions/
        mod.rs                              # Add: pub mod initialize_extra_account_meta_list;
        initialize_extra_account_meta_list.rs  # New instruction
```

### Pattern 1: #[interface] Macro for SPL Discriminator
**What:** Override Anchor's default instruction discriminator with SPL interface discriminator
**When to use:** Instructions that implement SPL Transfer Hook interface
**Example:**
```rust
// Source: Anchor 0.30.0 Release Notes
use anchor_lang::prelude::*;

#[program]
pub mod transfer_hook {
    use super::*;

    #[interface(spl_transfer_hook_interface::initialize_extra_account_meta_list)]
    pub fn initialize_extra_account_meta_list(
        ctx: Context<InitializeExtraAccountMetaList>
    ) -> Result<()> {
        instructions::initialize_extra_account_meta_list::handler(ctx)
    }
}
```

### Pattern 2: ExtraAccountMetaList PDA Derivation
**What:** Standard seeds for ExtraAccountMetaList PDA
**When to use:** Deriving the PDA that stores extra account metadata
**Example:**
```rust
// Source: Transfer_Hook_Spec.md Section 8.1
// PDA seeds = ["extra-account-metas", mint.key()]

#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    /// CHECK: Validated via seeds constraint. Account will be initialized by our instruction.
    #[account(
        mut,
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump,
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    pub mint: InterfaceAccount<'info, Mint>,
    // ...
}
```

### Pattern 3: ExtraAccountMeta with Dynamic Seeds
**What:** Configure extra accounts using Seed::Literal and Seed::AccountKey
**When to use:** When extra accounts are derived from transfer instruction accounts
**Example:**
```rust
// Source: Solana Transfer Hook Guide + Transfer_Hook_Spec.md Section 8.2
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta,
    seeds::Seed,
    state::ExtraAccountMetaList,
};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

// Account indices for transfer_hook execute instruction:
// Index 0 = source_token_account
// Index 1 = mint
// Index 2 = destination_token_account
// Index 3 = owner/authority
// Index 4 = extra_account_meta_list
// Index 5+ = resolved extra accounts

let extra_metas = vec![
    // Whitelist PDA for source (seeds: ["whitelist", source_token_account])
    ExtraAccountMeta::new_with_seeds(
        &[
            Seed::Literal { bytes: b"whitelist".to_vec() },
            Seed::AccountKey { index: 0 },  // source_token_account
        ],
        false,  // is_signer
        false,  // is_writable
    )?,
    // Whitelist PDA for destination (seeds: ["whitelist", destination_token_account])
    ExtraAccountMeta::new_with_seeds(
        &[
            Seed::Literal { bytes: b"whitelist".to_vec() },
            Seed::AccountKey { index: 2 },  // destination_token_account
        ],
        false,  // is_signer
        false,  // is_writable
    )?,
];

ExtraAccountMetaList::init::<ExecuteInstruction>(
    &mut extra_account_meta_list_data,
    &extra_metas,
)?;
```

### Pattern 4: Account Size Calculation
**What:** Calculate space needed for ExtraAccountMetaList
**When to use:** When creating the account via CPI to System Program
**Example:**
```rust
// Source: docs.rs/spl-tlv-account-resolution
let account_size = ExtraAccountMetaList::size_of(extra_metas.len())?;
let lamports = Rent::get()?.minimum_balance(account_size);
```

### Pattern 5: Mint Validation (Token-2022 + Hook Extension)
**What:** Validate mint is Token-2022 and has correct transfer hook program
**When to use:** Before initializing ExtraAccountMetaList
**Example:**
```rust
// Source: spl-token-2022 docs
use anchor_spl::token_2022;
use spl_token_2022::extension::{transfer_hook, BaseStateWithExtensions, StateWithExtensions};
use spl_token_2022::state::Mint as T22Mint;

pub fn validate_mint_hook(
    mint_info: &AccountInfo,
    expected_hook_program: &Pubkey,
) -> Result<()> {
    // Check 1: Mint must be owned by Token-2022 program
    require!(
        *mint_info.owner == token_2022::ID,
        TransferHookError::NotToken2022Mint
    );

    // Check 2: Mint must have TransferHook extension pointing to our program
    let mint_data = mint_info.try_borrow_data()?;
    let mint = StateWithExtensions::<T22Mint>::unpack(&mint_data)?;
    let hook_program_id = transfer_hook::get_program_id(&mint);

    require!(
        hook_program_id == Some(*expected_hook_program),
        TransferHookError::InvalidTransferHook
    );

    Ok(())
}
```

### Anti-Patterns to Avoid
- **Manual discriminator computation:** Use `#[interface]` macro, not hand-rolled discriminator
- **Hardcoding account indices:** Use constants or clear comments for index values
- **Skipping mint validation:** Always verify Token-2022 ownership and hook extension
- **Using new_with_pubkey for dynamic accounts:** Use `new_with_seeds` for PDAs derived from transfer accounts

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Discriminator matching | Manual [u8; 8] arrays | `#[interface(spl_transfer_hook_interface::...)]` | Anchor handles correctly |
| Account size calculation | Manual byte counting | `ExtraAccountMetaList::size_of()` | Handles TLV overhead correctly |
| Seed configuration | Custom structs | `Seed::Literal`, `Seed::AccountKey` | SPL standard, tested |
| PDA initialization | Custom serialization | `ExtraAccountMetaList::init::<ExecuteInstruction>()` | Correct TLV encoding |

**Key insight:** The SPL crates provide battle-tested helpers. Custom implementations would need to match exact binary formats.

## Common Pitfalls

### Pitfall 1: Wrong Account Index for Seeds
**What goes wrong:** Using wrong index causes PDA resolution to fail at transfer time
**Why it happens:** Misremembering the standard account order
**How to avoid:** Always reference the spec:
- Index 0 = source_token_account
- Index 1 = mint
- Index 2 = destination_token_account
- Index 3 = owner/authority
**Warning signs:** Transfers fail with "account not found" or wrong PDA errors

### Pitfall 2: Not Validating Mint Before Init
**What goes wrong:** ExtraAccountMetaList created for wrong mint type
**Why it happens:** Assuming all mints are valid
**How to avoid:** Check mint.owner == token_2022::ID AND transfer_hook::get_program_id matches
**Warning signs:** Silent failures when Token-2022 invokes hook

### Pitfall 3: Forgetting to Add spl-transfer-hook-interface Dependency
**What goes wrong:** Compilation errors for ExecuteInstruction, Seed types
**Why it happens:** Assuming transitive dependency is enough for direct use
**How to avoid:** Add explicit dependency in Cargo.toml
**Warning signs:** "unresolved import" errors

### Pitfall 4: Using Version 2.1.0 Instead of 0.10.0
**What goes wrong:** Solana SDK version conflict breaks entire build
**Why it happens:** Newer version looks more current
**How to avoid:** Pin to 0.10.0 explicitly; 2.1.0 requires SDK v3
**Warning signs:** Massive version conflict errors in Cargo

### Pitfall 5: Re-initialization Attempt
**What goes wrong:** Trying to reinitialize existing ExtraAccountMetaList
**Why it happens:** Multiple calls without checking existence
**How to avoid:** Use Anchor's init constraint which fails if account exists; let Anchor handle
**Warning signs:** "account already in use" error (expected, self-correcting)

## Code Examples

### Complete Instruction Handler
```rust
// Source: Solana Transfer Hook Guide + CONTEXT.md decisions
use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta,
    seeds::Seed,
    state::ExtraAccountMetaList,
};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

use crate::errors::TransferHookError;
use crate::events::ExtraAccountMetaListInitialized;
use crate::state::WhitelistAuthority;

pub fn handler(ctx: Context<InitializeExtraAccountMetaList>) -> Result<()> {
    // Validate mint has correct transfer hook extension (defense-in-depth)
    validate_mint_hook(
        &ctx.accounts.mint.to_account_info(),
        &crate::ID,
    )?;

    // Define extra accounts for transfer hook
    let extra_metas = vec![
        // Source whitelist PDA: ["whitelist", source_token_account]
        ExtraAccountMeta::new_with_seeds(
            &[
                Seed::Literal { bytes: b"whitelist".to_vec() },
                Seed::AccountKey { index: 0 },  // source_token_account
            ],
            false,  // is_signer
            false,  // is_writable
        )?,
        // Destination whitelist PDA: ["whitelist", destination_token_account]
        ExtraAccountMeta::new_with_seeds(
            &[
                Seed::Literal { bytes: b"whitelist".to_vec() },
                Seed::AccountKey { index: 2 },  // destination_token_account
            ],
            false,  // is_signer
            false,  // is_writable
        )?,
    ];

    // Calculate required size and lamports
    let account_size = ExtraAccountMetaList::size_of(extra_metas.len())?;
    let lamports = Rent::get()?.minimum_balance(account_size);

    // Create account via CPI to System Program
    let mint_key = ctx.accounts.mint.key();
    let signer_seeds: &[&[u8]] = &[
        b"extra-account-metas",
        mint_key.as_ref(),
        &[ctx.bumps.extra_account_meta_list],
    ];

    anchor_lang::system_program::create_account(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::CreateAccount {
                from: ctx.accounts.payer.to_account_info(),
                to: ctx.accounts.extra_account_meta_list.to_account_info(),
            },
            &[signer_seeds],
        ),
        lamports,
        account_size as u64,
        &crate::ID,
    )?;

    // Initialize the ExtraAccountMetaList
    ExtraAccountMetaList::init::<ExecuteInstruction>(
        &mut ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?,
        &extra_metas,
    )?;

    emit!(ExtraAccountMetaListInitialized {
        mint: ctx.accounts.mint.key(),
    });

    msg!("ExtraAccountMetaList initialized for mint {}", ctx.accounts.mint.key());
    Ok(())
}

/// Validate mint is Token-2022 and has our program as transfer hook
fn validate_mint_hook(
    mint_info: &AccountInfo,
    expected_hook_program: &Pubkey,
) -> Result<()> {
    use anchor_spl::token_2022;
    use spl_token_2022::extension::{transfer_hook, BaseStateWithExtensions, StateWithExtensions};
    use spl_token_2022::state::Mint as T22Mint;

    // Check 1: Mint must be owned by Token-2022 program
    require!(
        *mint_info.owner == token_2022::ID,
        TransferHookError::NotToken2022Mint
    );

    // Check 2: Mint must have TransferHook extension pointing to our program
    let mint_data = mint_info.try_borrow_data()?;
    let mint_state = StateWithExtensions::<T22Mint>::unpack(&mint_data)?;
    let hook_program_id = transfer_hook::get_program_id(&mint_state);

    require!(
        hook_program_id == Some(*expected_hook_program),
        TransferHookError::InvalidTransferHook
    );

    Ok(())
}
```

### Accounts Struct
```rust
// Source: Solana Transfer Hook Guide + CONTEXT.md decisions
#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [WhitelistAuthority::SEED],
        bump,
        constraint = whitelist_authority.authority.is_some() @ TransferHookError::AuthorityAlreadyBurned
    )]
    pub whitelist_authority: Account<'info, WhitelistAuthority>,

    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: Validated in handler. Will be initialized as ExtraAccountMetaList.
    /// Seeds: ["extra-account-metas", mint.key()]
    #[account(
        mut,
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump,
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    /// The mint for which to initialize ExtraAccountMetaList.
    /// Must be Token-2022 with TransferHook extension pointing to this program.
    pub mint: InterfaceAccount<'info, Mint>,

    pub system_program: Program<'info, System>,
}
```

### New Event
```rust
// Source: CONTEXT.md decisions
#[event]
pub struct ExtraAccountMetaListInitialized {
    pub mint: Pubkey,
}
```

### New Errors
```rust
// Source: CONTEXT.md decisions
#[error_code]
pub enum TransferHookError {
    // ... existing errors ...

    #[msg("Mint's transfer hook extension does not point to this program")]
    InvalidTransferHook,

    #[msg("Mint is not a Token-2022 mint")]
    NotToken2022Mint,
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual fallback instruction | `#[interface]` macro | Anchor 0.30.0 | Automatic discriminator handling |
| Hand-compute discriminator | `ExecuteInstruction::SPL_DISCRIMINATOR_SLICE` | SPL interface standardization | Correct discriminators |
| Pass all accounts manually | ExtraAccountMetaList dynamic resolution | Token-2022 design | Automatic account resolution at transfer time |

**Current as of Anchor 0.32.1:** The `#[interface]` macro is the correct approach. Prior research mentioned deprecation in 0.31.0, but verification shows it remains the standard pattern for SPL interface implementations.

## Open Questions

Things that couldn't be fully resolved:

1. **Exact error mapping for StateWithExtensions::unpack**
   - What we know: Returns ProgramError on invalid data
   - What's unclear: Exact error propagation through Anchor's Result
   - Recommendation: Use `?` operator; Anchor will convert ProgramError to AnchorError

2. **Idempotency vs strict failure for re-init**
   - What we know: CONTEXT.md says "Re-initialization fails"
   - What's unclear: System Program create_account will fail if account exists
   - Recommendation: Let it fail naturally; no custom check needed

## Sources

### Primary (HIGH confidence)
- [Anchor 0.30.0 Release Notes](https://www.anchor-lang.com/docs/updates/release-notes/0-30-0) - #[interface] macro documentation
- [docs.rs/spl-tlv-account-resolution/0.10.0](https://docs.rs/spl-tlv-account-resolution/0.10.0/) - ExtraAccountMetaList::init, size_of, Seed enum
- [docs.rs/spl-transfer-hook-interface/0.10.0](https://docs.rs/spl-transfer-hook-interface/0.10.0/) - ExecuteInstruction, get_extra_account_metas_address
- [docs.rs/spl-token-2022/8.0.0](https://docs.rs/spl-token-2022/8.0.0/spl_token_2022/extension/transfer_hook/) - transfer_hook::get_program_id, StateWithExtensions
- Transfer_Hook_Spec.md Section 8 - PDA seeds, extra account configuration
- 16-CONTEXT.md - Implementation decisions (authority model, validation, events)

### Secondary (MEDIUM confidence)
- [Solana Transfer Hook Guide](https://solana.com/developers/guides/token-extensions/transfer-hook) - Implementation patterns, account indices
- [GitHub: solana-developers/anchor-transfer-hook](https://github.com/solana-developers/anchor-transfer-hook) - Reference implementation
- [GitHub: ASCorreia/whitelist-transfer-hook](https://github.com/ASCorreia/whitelist-transfer-hook) - Whitelist-specific example

### Tertiary (LOW confidence)
- WebSearch results for mint validation patterns - General approach confirmed, exact code unverified

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Versions verified in Cargo.lock, official docs
- Architecture patterns: HIGH - Anchor docs + official SPL examples
- Pitfalls: HIGH - Common issues documented in multiple sources
- Code examples: HIGH - Synthesized from official docs and verified patterns

**Research date:** 2026-02-05
**Valid until:** 60 days (stable SPL interface)

---

## Implementation Checklist for Planner

1. Add dependencies to `programs/transfer-hook/Cargo.toml`:
   - `spl-transfer-hook-interface = "0.10.0"`
   - `spl-tlv-account-resolution = "0.10.0"`

2. Add new errors to `errors.rs`:
   - `InvalidTransferHook`
   - `NotToken2022Mint`

3. Add new event to `events.rs`:
   - `ExtraAccountMetaListInitialized { mint: Pubkey }`

4. Create instruction file:
   - `instructions/initialize_extra_account_meta_list.rs`

5. Update `instructions/mod.rs`:
   - Export new instruction

6. Update `lib.rs`:
   - Add `#[interface(spl_transfer_hook_interface::initialize_extra_account_meta_list)]`
   - Add instruction handler

7. Key implementation details:
   - Seed::AccountKey { index: 0 } for source whitelist
   - Seed::AccountKey { index: 2 } for destination whitelist
   - Validate mint is Token-2022 before init
   - Validate mint's hook extension points to our program
   - Authority check same as add_whitelist_entry
