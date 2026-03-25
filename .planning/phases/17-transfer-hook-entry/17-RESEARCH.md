# Phase 17: Transfer Hook Entry Point & Integration - Research

**Researched:** 2026-02-05
**Domain:** Token-2022 Transfer Hook Execute instruction with whitelist validation
**Confidence:** HIGH

## Summary

This phase implements the `transfer_hook` instruction (SPL Execute interface) that Token-2022 invokes during every `transfer_checked` call for CRIME, FRAUD, and PROFIT tokens. The hook validates that at least one party (source or destination) is whitelisted, preventing unauthorized wallet-to-wallet transfers.

The key technical elements are:
- Using `#[interface(spl_transfer_hook_interface::execute)]` to override Anchor's discriminator with the SPL Execute discriminator
- Checking the `transferring` flag on source token account via `PodStateWithExtensionsMut<PodAccount>::get_extension_mut::<TransferHookAccount>()` to prevent direct invocation attacks
- Validating whitelist PDAs by checking account existence and correct derivation
- Following the established validation order: zero amount -> transferring flag -> whitelist check

The implementation builds directly on Phase 16's ExtraAccountMetaList setup, which already configured the whitelist PDA resolution using `Seed::AccountKey { index: 0 }` (source) and `Seed::AccountKey { index: 2 }` (destination).

**Primary recommendation:** Use the transferring flag check as the primary defense against direct hook invocation, with existence-based whitelist PDA validation for business rule enforcement.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| spl-transfer-hook-interface | 0.10.0 | `ExecuteInstruction` discriminator, interface definitions | Official SPL interface; already in Cargo.toml |
| spl-token-2022 | 8.0.1 | `PodStateWithExtensionsMut`, `TransferHookAccount`, extension access | Already in Cargo.toml; provides transferring flag check |
| anchor-spl | 0.32.1 | `InterfaceAccount<TokenAccount>`, `InterfaceAccount<Mint>` | Already used; provides T22 account types |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| spl-discriminator | 0.4.1 | `SplDiscriminate` trait for ExecuteInstruction | Already in Cargo.toml; used via #[interface] macro |

### No New Dependencies Needed
All required crates are already in `programs/transfer-hook/Cargo.toml`:
```toml
anchor-lang = { version = "0.32.1" }
anchor-spl = { version = "0.32.1", features = ["token_2022"] }
spl-discriminator = "0.4.1"
spl-token-2022 = "8.0.1"
spl-transfer-hook-interface = "0.10.0"
spl-tlv-account-resolution = "0.10.0"
```

## Architecture Patterns

### Instruction Structure

```
programs/transfer-hook/src/
    instructions/
        mod.rs                    # Add: pub mod transfer_hook;
        transfer_hook.rs          # New instruction (Phase 17)
        initialize_extra_account_meta_list.rs  # Phase 16
```

### Pattern 1: #[interface] Macro for Execute Instruction
**What:** Override Anchor's default instruction discriminator with SPL Execute discriminator
**When to use:** The transfer_hook instruction that Token-2022 invokes during transfers
**Example:**
```rust
// Source: Anchor #[interface] macro + SPL Transfer Hook Interface
use spl_discriminator::SplDiscriminate;
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

#[program]
pub mod transfer_hook {
    use super::*;

    #[interface(spl_transfer_hook_interface::execute)]
    pub fn transfer_hook(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
        instructions::transfer_hook::handler(ctx, amount)
    }
}
```

### Pattern 2: Transfer Hook Account Struct
**What:** Standard account layout for transfer hook execution
**When to use:** The TransferHook accounts struct
**Example:**
```rust
// Source: Solana Transfer Hook Guide + Account Index Spec
// Account indices from SPL spec:
// 0 = source_token_account
// 1 = mint
// 2 = destination_token_account
// 3 = owner/authority
// 4 = extra_account_meta_list
// 5+ = resolved extra accounts (our whitelist PDAs)

#[derive(Accounts)]
pub struct TransferHook<'info> {
    #[account(token::mint = mint, token::authority = owner)]
    pub source_token: InterfaceAccount<'info, TokenAccount>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(token::mint = mint)]
    pub destination_token: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: Owner validation done by Token-2022 before calling hook
    pub owner: UncheckedAccount<'info>,

    /// CHECK: Validated via seeds constraint
    #[account(
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    /// Whitelist PDA for source token account
    /// CHECK: Existence checked in handler, derivation verified
    pub whitelist_source: UncheckedAccount<'info>,

    /// Whitelist PDA for destination token account
    /// CHECK: Existence checked in handler, derivation verified
    pub whitelist_destination: UncheckedAccount<'info>,
}
```

### Pattern 3: Transferring Flag Validation
**What:** Check that the hook is invoked from a legitimate Token-2022 transfer context
**When to use:** At the start of transfer_hook handler, after zero amount check
**Example:**
```rust
// Source: Solana Token Extensions Guide + Neodyme Security Blog
use spl_token_2022::extension::{PodStateWithExtensionsMut, transfer_hook::TransferHookAccount};
use spl_token_2022::pod::PodAccount;
use std::cell::RefMut;

fn check_is_transferring(source_token: &AccountInfo) -> Result<()> {
    let account_data_ref: RefMut<&mut [u8]> = source_token.try_borrow_mut_data()?;
    let account = PodStateWithExtensionsMut::<PodAccount>::unpack(*account_data_ref)?;
    let extension = account.get_extension_mut::<TransferHookAccount>()?;

    if !bool::from(extension.transferring) {
        return err!(TransferHookError::DirectInvocationNotAllowed);
    }

    Ok(())
}
```

### Pattern 4: Whitelist PDA Validation
**What:** Verify whitelist PDAs exist and have correct derivation
**When to use:** During whitelist check in transfer_hook handler
**Example:**
```rust
// Source: Transfer_Hook_Spec.md Section 5.4 + Phase 16 patterns
use crate::state::WhitelistEntry;

fn is_whitelisted(
    whitelist_pda: &AccountInfo,
    token_account: &Pubkey,
) -> bool {
    // Account must have data (exists)
    if whitelist_pda.data_is_empty() {
        return false;
    }

    // Verify PDA derivation is correct (prevents spoofed accounts)
    let (expected_pda, _bump) = Pubkey::find_program_address(
        &[WhitelistEntry::SEED_PREFIX, token_account.as_ref()],
        &crate::ID
    );

    whitelist_pda.key() == expected_pda
}
```

### Pattern 5: Validation Order (CONTEXT.md Decision)
**What:** Execute validations in specific order for efficiency and security
**When to use:** In the transfer_hook handler
**Example:**
```rust
// Source: 17-CONTEXT.md Validation Order decision
pub fn handler(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
    // 1. Zero amount check (cheapest, fail fast)
    require!(amount > 0, TransferHookError::ZeroAmountTransfer);

    // 2. Transferring flag check (security - verify legitimate T22 context)
    check_is_transferring(&ctx.accounts.source_token.to_account_info())?;

    // 3. Whitelist check (business rule)
    // Short-circuit: if source is whitelisted, skip destination check
    let source_whitelisted = is_whitelisted(
        &ctx.accounts.whitelist_source,
        &ctx.accounts.source_token.key(),
    );

    if !source_whitelisted {
        let dest_whitelisted = is_whitelisted(
            &ctx.accounts.whitelist_destination,
            &ctx.accounts.destination_token.key(),
        );

        require!(dest_whitelisted, TransferHookError::NoWhitelistedParty);
    }

    Ok(())
}
```

### Anti-Patterns to Avoid
- **Skipping transferring flag check:** Opens attack vector for direct hook invocation
- **Revealing which party failed whitelist:** Use generic `NoWhitelistedParty` error
- **Checking destination before source:** Source check first enables short-circuit
- **Using `try_from_slice` for extension access:** Use `PodStateWithExtensionsMut::unpack`

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Discriminator matching | Manual [u8; 8] arrays | `#[interface(spl_transfer_hook_interface::execute)]` | Anchor handles correctly |
| Transferring state check | Manual byte inspection | `PodStateWithExtensionsMut::get_extension_mut::<TransferHookAccount>()` | Proper TLV parsing |
| Account type validation | Manual owner checks | Anchor constraints `token::mint`, `token::authority` | Type-safe validation |
| Whitelist PDA validation | Manual seed derivation | `Pubkey::find_program_address` with `WhitelistEntry::SEED_PREFIX` | Consistent with Phase 15 pattern |

**Key insight:** The SPL crates provide battle-tested helpers for extension access. Custom implementations would need to handle TLV encoding correctly.

## Common Pitfalls

### Pitfall 1: Missing Transferring Flag Check
**What goes wrong:** Attackers can invoke hook directly without going through Token-2022 transfer
**Why it happens:** Assuming Token-2022 is the only caller
**How to avoid:** Always check `extension.transferring` flag at start of handler
**Warning signs:** Hook processes transactions that shouldn't have reached it

### Pitfall 2: Wrong Extension Access Pattern
**What goes wrong:** Extension data not found or corrupted
**Why it happens:** Using wrong unpacking method for Pod accounts
**How to avoid:** Use `PodStateWithExtensionsMut::<PodAccount>::unpack()` and `get_extension_mut::<TransferHookAccount>()`
**Warning signs:** "Extension not found" or deserialization errors

### Pitfall 3: Not Verifying PDA Derivation
**What goes wrong:** Attacker passes fake whitelist account
**Why it happens:** Only checking account existence, not derivation
**How to avoid:** Verify `find_program_address` result matches passed account
**Warning signs:** Unauthorized transfers succeed

### Pitfall 4: Information Leakage in Errors
**What goes wrong:** Attackers probe whitelist status via error messages
**Why it happens:** Using specific errors like "SourceNotWhitelisted"
**How to avoid:** Use generic `NoWhitelistedParty` error (per CONTEXT.md)
**Warning signs:** Detailed error messages about specific parties

### Pitfall 5: Mint Validation Redundancy
**What goes wrong:** Overcomplicating with explicit mint checks
**Why it happens:** Not understanding implicit validation via ExtraAccountMetaList
**How to avoid:** ExtraAccountMetaList must exist for mint -> implicit mint validation
**Warning signs:** Unnecessary mint ownership checks in transfer_hook
**Note:** Per CONTEXT.md, we still do defense-in-depth with mint.owner == token_2022::ID

## Code Examples

Verified patterns from official sources:

### Complete Transfer Hook Handler
```rust
// Source: Solana Transfer Hook Guide + CONTEXT.md decisions
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount};
use spl_token_2022::extension::{PodStateWithExtensionsMut, transfer_hook::TransferHookAccount};
use spl_token_2022::pod::PodAccount;

use crate::errors::TransferHookError;
use crate::state::WhitelistEntry;

pub fn handler(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
    // Validation 1: Zero amount check (cheapest, fail fast)
    require!(amount > 0, TransferHookError::ZeroAmountTransfer);

    // Validation 2: Transferring flag check (security)
    check_is_transferring(&ctx.accounts.source_token.to_account_info())?;

    // Validation 3: Whitelist check with short-circuit
    let source_whitelisted = is_whitelisted(
        &ctx.accounts.whitelist_source.to_account_info(),
        &ctx.accounts.source_token.key(),
    );

    if !source_whitelisted {
        let dest_whitelisted = is_whitelisted(
            &ctx.accounts.whitelist_destination.to_account_info(),
            &ctx.accounts.destination_token.key(),
        );

        require!(dest_whitelisted, TransferHookError::NoWhitelistedParty);
    }

    // Transfer allowed - Token-2022 will complete the transfer
    Ok(())
}

/// Check that we're being called from a legitimate Token-2022 transfer.
/// The transferring flag is set by Token-2022 before calling the hook.
fn check_is_transferring(source_token: &AccountInfo) -> Result<()> {
    let account_data = source_token.try_borrow_data()?;
    let account = PodStateWithExtensionsMut::<PodAccount>::unpack(&account_data)?;
    let extension = account.get_extension::<TransferHookAccount>()?;

    if !bool::from(extension.transferring) {
        return err!(TransferHookError::DirectInvocationNotAllowed);
    }

    Ok(())
}

/// Check if a token account is whitelisted.
/// Uses existence-based PDA pattern: PDA exists = whitelisted.
fn is_whitelisted(whitelist_pda: &AccountInfo, token_account: &Pubkey) -> bool {
    // Account must have data (exists)
    if whitelist_pda.data_is_empty() {
        return false;
    }

    // Verify PDA derivation is correct (prevents spoofed accounts)
    let (expected_pda, _bump) = Pubkey::find_program_address(
        &[WhitelistEntry::SEED_PREFIX, token_account.as_ref()],
        &crate::ID
    );

    whitelist_pda.key() == expected_pda
}
```

### Transfer Hook Accounts Struct
```rust
// Source: Solana Transfer Hook Guide + SPL Account Index Spec
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount};

#[derive(Accounts)]
pub struct TransferHook<'info> {
    /// Source token account (SPL account index 0)
    #[account(token::mint = mint, token::authority = owner)]
    pub source_token: InterfaceAccount<'info, TokenAccount>,

    /// Token mint (SPL account index 1)
    pub mint: InterfaceAccount<'info, Mint>,

    /// Destination token account (SPL account index 2)
    #[account(token::mint = mint)]
    pub destination_token: InterfaceAccount<'info, TokenAccount>,

    /// Source token owner/authority (SPL account index 3)
    /// CHECK: Validated by Token-2022 before calling hook
    pub owner: UncheckedAccount<'info>,

    /// ExtraAccountMetaList PDA (SPL account index 4)
    /// CHECK: Validated via seeds
    #[account(
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    /// Whitelist PDA for source token account (extra account index 5)
    /// Resolved from ExtraAccountMetaList: ["whitelist", source_token.key()]
    /// CHECK: Existence and derivation checked in handler
    pub whitelist_source: UncheckedAccount<'info>,

    /// Whitelist PDA for destination token account (extra account index 6)
    /// Resolved from ExtraAccountMetaList: ["whitelist", destination_token.key()]
    /// CHECK: Existence and derivation checked in handler
    pub whitelist_destination: UncheckedAccount<'info>,
}
```

### New Errors for Phase 17
```rust
// Source: CONTEXT.md decisions + Transfer_Hook_Spec.md
// Add to errors.rs after existing variants:

/// Transfer hook invoked directly, not through Token-2022 transfer.
/// Prevents attackers from calling hook to bypass transfer validation.
#[msg("Transfer hook must be invoked through Token-2022 transfer")]
DirectInvocationNotAllowed,

/// Mint is not owned by Token-2022 program (defense-in-depth).
/// ExtraAccountMetaList provides implicit validation, this is extra check.
#[msg("Invalid mint - not a Token-2022 mint")]
InvalidMint,
```

### Program Entry Point Update
```rust
// Source: Anchor #[interface] macro pattern
// Add to lib.rs:

/// Transfer hook invoked by Token-2022 during transfer_checked.
///
/// Validates that at least one party (source or destination) is whitelisted.
/// Rejects zero-amount transfers and direct hook invocations.
///
/// # Account Indices (SPL Transfer Hook Spec)
/// - 0: source_token_account
/// - 1: mint
/// - 2: destination_token_account
/// - 3: owner/authority
/// - 4: extra_account_meta_list
/// - 5: whitelist_source (resolved from ExtraAccountMetaList)
/// - 6: whitelist_destination (resolved from ExtraAccountMetaList)
///
/// # Errors
/// - ZeroAmountTransfer: Amount is zero
/// - DirectInvocationNotAllowed: Not called from Token-2022 transfer
/// - NoWhitelistedParty: Neither source nor destination is whitelisted
///
/// Spec reference: Transfer_Hook_Spec.md Section 7.4
#[interface(spl_transfer_hook_interface::execute)]
pub fn transfer_hook(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
    instructions::transfer_hook::handler(ctx, amount)
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual fallback instruction | `#[interface]` macro | Anchor 0.30.0 | Automatic discriminator handling |
| No transferring check | `TransferHookAccount.transferring` flag check | Token-2022 design | Security against direct invocation |
| Manual CPI validation | Transferring flag | SPL standard | Cleaner, less error-prone |

**Deprecated/outdated:**
- Manual discriminator matching via fallback instruction (pre-Anchor 0.30.0)
- `get_instruction_relative()` for caller validation (limits CPI use cases)

## Critical Research Answer: Transferring Flag API

**Question from CONTEXT.md:** Confirm exact API usage pattern for checking transferring flag

**ANSWER (HIGH confidence):**

The transferring flag is accessed via the `TransferHookAccount` extension on token accounts:

```rust
use spl_token_2022::extension::{PodStateWithExtensionsMut, transfer_hook::TransferHookAccount};
use spl_token_2022::pod::PodAccount;

fn check_is_transferring(token_account: &AccountInfo) -> Result<()> {
    let data = token_account.try_borrow_data()?;
    let account = PodStateWithExtensionsMut::<PodAccount>::unpack(&data)?;
    let extension = account.get_extension::<TransferHookAccount>()?;

    if !bool::from(extension.transferring) {
        return err!(TransferHookError::DirectInvocationNotAllowed);
    }
    Ok(())
}
```

**Key points:**
- Import path: `spl_token_2022::extension::transfer_hook::TransferHookAccount`
- Pod type: `spl_token_2022::pod::PodAccount` (not `spl_token_2022::state::Account`)
- Use `get_extension::<TransferHookAccount>()` (non-mut is fine for read-only check)
- The `transferring` field is a `PodBool`, convert with `bool::from()`
- Token-2022 sets this flag to true before calling the hook, unsets after

**Source:** Solana Token Extensions Guide + Neodyme Security Blog

## Open Questions

Things that couldn't be fully resolved:

1. **Exact error type from PodStateWithExtensionsMut::unpack**
   - What we know: Returns ProgramError on invalid data
   - What's unclear: Exact Anchor error conversion behavior
   - Recommendation: Use `?` operator; test with invalid accounts in integration tests

2. **Extension not present scenario**
   - What we know: Token accounts for T22 mints with transfer hook should have TransferHookAccount extension
   - What's unclear: Edge case if extension somehow missing
   - Recommendation: Let `get_extension` fail naturally with appropriate error

## Sources

### Primary (HIGH confidence)
- [Solana Token Extensions: Transfer Hook Guide](https://solana.com/developers/guides/token-extensions/transfer-hook) - transferring flag check pattern, accounts struct
- [Neodyme: Token-2022 Security Blog](https://neodyme.io/en/blog/token-2022/) - transferring flag as security mechanism
- [docs.rs/spl-token-2022/8.0.1](https://docs.rs/spl-token-2022/8.0.1/) - PodStateWithExtensionsMut, TransferHookAccount
- [docs.rs/spl-transfer-hook-interface/0.10.0](https://docs.rs/spl-transfer-hook-interface/0.10.0/) - ExecuteInstruction, interface definitions
- Transfer_Hook_Spec.md Section 7.4 - transfer_hook instruction specification
- 17-CONTEXT.md - Implementation decisions (validation order, error disclosure)

### Secondary (MEDIUM confidence)
- [QuickNode Transfer Hooks Guide](https://www.quicknode.com/guides/solana-development/spl-tokens/token-2022/transfer-hooks) - Anchor accounts struct pattern
- [solana-program.com Transfer Hook Examples](https://www.solana-program.com/docs/transfer-hook-interface/examples) - Account index specification
- [Anchor #[interface] PR #2728](https://github.com/coral-xyz/anchor/pull/2728) - Macro implementation details

### Tertiary (LOW confidence)
- WebSearch results for PodStateWithExtensionsMut patterns - General approach, exact API unverified via docs.rs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Already in Cargo.toml, versions verified
- Architecture patterns: HIGH - Builds on Phase 16 patterns, official guides
- Transferring flag API: HIGH - Multiple sources agree on pattern
- Pitfalls: MEDIUM - Based on security blog and general patterns

**Research date:** 2026-02-05
**Valid until:** 60 days (stable SPL interface)

---

## Implementation Checklist for Planner

1. Add new errors to `errors.rs`:
   - `DirectInvocationNotAllowed`
   - `InvalidMint` (defense-in-depth, per CONTEXT.md)

2. Create instruction file:
   - `instructions/transfer_hook.rs`

3. Update `instructions/mod.rs`:
   - Export new instruction

4. Update `lib.rs`:
   - Add `#[interface(spl_transfer_hook_interface::execute)]`
   - Add instruction handler with `amount: u64` parameter

5. Key implementation details:
   - Validation order: zero amount -> transferring flag -> whitelist
   - Short-circuit: if source whitelisted, skip destination check
   - Use `PodStateWithExtensionsMut::<PodAccount>::unpack()` for extension access
   - Use `WhitelistEntry::SEED_PREFIX` for PDA derivation consistency
   - Generic error messages (no party-specific information)

6. Account struct:
   - 7 accounts total matching SPL indices
   - source_token, mint, destination_token, owner, extra_account_meta_list
   - whitelist_source, whitelist_destination (resolved by Token-2022)

7. Testing considerations (per CONTEXT.md):
   - litesvm with Token-2022 extension support
   - Test blocking: zero amount, direct invocation, non-whitelisted, spoofed PDAs
   - Full integration: AMM -> Token-2022 -> Hook chain
