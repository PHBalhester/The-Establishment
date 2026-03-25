# Phase 15: Administrative Instructions - Research

**Researched:** 2026-02-05
**Domain:** Anchor instruction patterns for authority lifecycle and whitelist management
**Confidence:** HIGH

## Summary

This phase implements three administrative instructions for the transfer hook program: `initialize_authority`, `add_whitelist_entry`, and `burn_authority`. These follow standard Anchor patterns already established in the codebase (see AMM's `initialize_admin` and `initialize_pool` instructions).

The research confirms that Anchor's `init` constraint with discriminators provides robust reinitialization protection, making the "already initialized" check straightforward. The existing Phase 14 state definitions (`WhitelistAuthority`, `WhitelistEntry`) and error codes (`TransferHookError`) are correctly designed for this phase. The primary implementation work is assembling these pieces into instruction handlers with proper account validation.

Key finding: There is a contradiction between 15-CONTEXT.md ("No event emission on entry creation") and the existing `events.rs` which defines `AddressWhitelisted`. The spec document (Transfer_Hook_Spec.md Section 7.2) shows event emission. **Recommendation:** Follow the spec and emit the event, as it provides valuable audit trail without significant cost.

**Primary recommendation:** Use standard Anchor patterns from the existing AMM codebase, leverage `init` constraint for reinitialization protection, and emit events as specified in Transfer_Hook_Spec.md.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| anchor-lang | 0.32.1 | Solana program framework | Already used in project; provides account constraints, error handling, events |
| solana-program | 2.x | Core Solana types (Pubkey, Clock) | Transitively via anchor-lang |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| litesvm | 0.9.1 | Fast Solana VM testing | Integration tests (established in Phase 9) |
| sha2 | * | Discriminator calculation in tests | Test helpers for building instructions |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Anchor constraints | Manual validation | Anchor is already in use; manual validation error-prone |
| litesvm | solana-program-test | litesvm is faster; already established in codebase |

**Installation:**
Already installed; no new dependencies required.

## Architecture Patterns

### Recommended Project Structure
```
programs/transfer-hook/src/
├── lib.rs                  # Program entry, instruction dispatch
├── instructions/           # NEW: instruction modules
│   ├── mod.rs
│   ├── initialize_authority.rs
│   ├── add_whitelist_entry.rs
│   └── burn_authority.rs
├── state/                  # EXISTS: account definitions
│   ├── mod.rs
│   ├── whitelist_authority.rs
│   └── whitelist_entry.rs
├── errors.rs               # EXISTS: error codes
└── events.rs               # EXISTS: event definitions
```

### Pattern 1: Instruction Module Organization (from AMM)
**What:** Each instruction in its own file with handler function and Accounts struct
**When to use:** Always for Anchor programs with multiple instructions
**Example:**
```rust
// Source: programs/amm/src/instructions/initialize_admin.rs (existing code)
pub fn handler(ctx: Context<InitializeAdmin>, admin: Pubkey) -> Result<()> {
    let admin_config = &mut ctx.accounts.admin_config;
    admin_config.admin = admin;
    admin_config.bump = ctx.bumps.admin_config;
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeAdmin<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + AdminConfig::INIT_SPACE,
        seeds = [ADMIN_SEED],
        bump
    )]
    pub admin_config: Account<'info, AdminConfig>,

    pub system_program: Program<'info, System>,
}
```

### Pattern 2: PDA with Signer as Authority
**What:** Transaction signer becomes the stored authority via `.key()` capture
**When to use:** Single-owner authority patterns
**Example:**
```rust
// Source: Verified Anchor pattern
pub fn handler(ctx: Context<InitializeAuthority>) -> Result<()> {
    let auth = &mut ctx.accounts.whitelist_authority;
    auth.authority = Some(ctx.accounts.signer.key());
    auth.initialized = true;
    Ok(())
}
```

### Pattern 3: Authority Validation with Option<Pubkey>
**What:** Check Option<Pubkey> matches signer before allowing privileged operations
**When to use:** Authority-gated instructions where authority can be burned
**Example:**
```rust
// Pattern for add_whitelist_entry and burn_authority
require!(
    auth.authority == Some(ctx.accounts.signer.key()),
    TransferHookError::Unauthorized
);
```

### Pattern 4: Idempotent Burn (Already Burned = Success)
**What:** Return Ok(()) instead of error when already burned
**When to use:** Operations that should be idempotent (15-CONTEXT.md decision)
**Example:**
```rust
// burn_authority idempotent pattern
pub fn handler(ctx: Context<BurnAuthority>) -> Result<()> {
    let auth = &mut ctx.accounts.whitelist_authority;

    // Idempotent: if already burned, succeed silently
    if auth.authority.is_none() {
        return Ok(());
    }

    // Verify caller is the current authority
    require!(
        auth.authority == Some(ctx.accounts.signer.key()),
        TransferHookError::Unauthorized
    );

    auth.authority = None;
    emit!(AuthorityBurned { ... });
    Ok(())
}
```

### Anti-Patterns to Avoid
- **Manual discriminator checks:** Anchor's `init` constraint handles this automatically
- **Returning error on idempotent operation:** 15-CONTEXT.md specifies burn should succeed silently if already burned
- **Closing WhitelistAuthority on burn:** Keep account with authority=None (15-CONTEXT.md decision)
- **Two-phase burn pattern:** Not needed; single call burns immediately (15-CONTEXT.md decision)

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Account initialization | Manual create_account CPI | Anchor `init` constraint | Handles rent, discriminator, reinitialization protection |
| PDA derivation | Manual find_program_address | Anchor `seeds` + `bump` | Automatic validation, bump stored |
| Reinitialization check | Manual initialized flag check | Anchor discriminator | Automatic via `init` constraint |
| Signer validation | Manual is_signer check | `Signer<'info>` type | Anchor validates automatically |
| Space calculation | Manual byte counting | `#[derive(InitSpace)]` | Already on state structs |

**Key insight:** Anchor's constraint system automatically handles the security-critical validation. The existing state definitions already use `#[derive(InitSpace)]` which provides `INIT_SPACE` constant.

## Common Pitfalls

### Pitfall 1: Reinitialization Vulnerability
**What goes wrong:** Attacker calls initialize_authority twice to replace legitimate authority
**Why it happens:** Missing check for already-initialized state
**How to avoid:** Anchor's `init` constraint prevents this automatically; for extra safety, add explicit error return
**Warning signs:** Tests pass without testing duplicate initialization rejection

### Pitfall 2: Authority Check Before Burn Check
**What goes wrong:** Checking `authority == signer` before checking if already burned causes unauthorized error for idempotent calls
**Why it happens:** Wrong order of validation
**How to avoid:** Check `authority.is_none()` first, return Ok(()); then validate signer
**Warning signs:** Idempotent burn test fails with Unauthorized instead of succeeding

### Pitfall 3: Forgetting to Validate Address in add_whitelist_entry
**What goes wrong:** Whitelisting system program address or null pubkey
**Why it happens:** No validation of the address being whitelisted
**How to avoid:** Add validation: `require!(address != Pubkey::default() && address != system_program::ID, ...)`
**Warning signs:** Can whitelist invalid addresses

### Pitfall 4: AlreadyWhitelisted Not Triggered
**What goes wrong:** Duplicate whitelist entry creation succeeds
**Why it happens:** Anchor's `init` constraint failure gives cryptic error, not custom error
**How to avoid:** Anchor `init` will fail if PDA exists; custom error code maps via constraint
**Warning signs:** Test expects AlreadyWhitelisted but gets different error

### Pitfall 5: Incorrect PDA Seeds
**What goes wrong:** WhitelistEntry PDA uses wrong seeds, causing lookup failures
**Why it happens:** Seeds in instruction don't match seeds in state definition
**How to avoid:** Use `WhitelistEntry::SEED_PREFIX` constant (b"whitelist") from state module
**Warning signs:** Transfer hook can't find whitelist entries created by add_whitelist_entry

## Code Examples

Verified patterns from official sources and existing codebase:

### Initialize Authority Handler
```rust
// Pattern from: Transfer_Hook_Spec.md Section 7.1 + AMM initialize_admin.rs
use anchor_lang::prelude::*;
use crate::state::WhitelistAuthority;
use crate::errors::TransferHookError;

pub fn handler(ctx: Context<InitializeAuthority>) -> Result<()> {
    let auth = &mut ctx.accounts.whitelist_authority;
    auth.authority = Some(ctx.accounts.signer.key());
    auth.initialized = true;

    msg!("WhitelistAuthority initialized. Authority: {}", ctx.accounts.signer.key());
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeAuthority<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        init,
        payer = signer,
        space = 8 + WhitelistAuthority::INIT_SPACE,
        seeds = [WhitelistAuthority::SEED],
        bump
    )]
    pub whitelist_authority: Account<'info, WhitelistAuthority>,

    pub system_program: Program<'info, System>,
}
```

### Add Whitelist Entry Handler
```rust
// Pattern from: Transfer_Hook_Spec.md Section 7.2 + standard Anchor
use anchor_lang::prelude::*;
use crate::state::{WhitelistAuthority, WhitelistEntry};
use crate::errors::TransferHookError;
use crate::events::AddressWhitelisted;

pub fn handler(ctx: Context<AddWhitelistEntry>) -> Result<()> {
    let auth = &ctx.accounts.whitelist_authority;
    let address = ctx.accounts.address_to_whitelist.key();

    // Validate authority exists and matches signer
    require!(
        auth.authority == Some(ctx.accounts.authority.key()),
        TransferHookError::Unauthorized
    );

    // Validate address (reject system program and null)
    require!(
        address != Pubkey::default() && address != solana_program::system_program::ID,
        TransferHookError::InvalidWhitelistPDA  // Reusing existing error for invalid address
    );

    // Populate entry
    let entry = &mut ctx.accounts.whitelist_entry;
    entry.address = address;
    entry.created_at = Clock::get()?.unix_timestamp;

    emit!(AddressWhitelisted {
        address: entry.address,
        added_by: ctx.accounts.authority.key(),
        timestamp: entry.created_at,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct AddWhitelistEntry<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [WhitelistAuthority::SEED],
        bump,
        constraint = whitelist_authority.authority.is_some() @ TransferHookError::AuthorityAlreadyBurned
    )]
    pub whitelist_authority: Account<'info, WhitelistAuthority>,

    #[account(
        init,
        payer = authority,
        space = 8 + WhitelistEntry::INIT_SPACE,
        seeds = [WhitelistEntry::SEED_PREFIX, address_to_whitelist.key().as_ref()],
        bump
    )]
    pub whitelist_entry: Account<'info, WhitelistEntry>,

    /// CHECK: Address being whitelisted (can be any account)
    pub address_to_whitelist: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}
```

### Burn Authority Handler
```rust
// Pattern from: Transfer_Hook_Spec.md Section 6.3 + 15-CONTEXT.md idempotent decision
use anchor_lang::prelude::*;
use crate::state::WhitelistAuthority;
use crate::errors::TransferHookError;
use crate::events::AuthorityBurned;

pub fn handler(ctx: Context<BurnAuthority>) -> Result<()> {
    let auth = &mut ctx.accounts.whitelist_authority;

    // Idempotent: already burned = success
    if auth.authority.is_none() {
        return Ok(());
    }

    // Verify signer is current authority
    require!(
        auth.authority == Some(ctx.accounts.authority.key()),
        TransferHookError::Unauthorized
    );

    auth.authority = None;

    emit!(AuthorityBurned {
        burned_by: ctx.accounts.authority.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    msg!("Authority burned permanently");
    Ok(())
}

#[derive(Accounts)]
pub struct BurnAuthority<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [WhitelistAuthority::SEED],
        bump
    )]
    pub whitelist_authority: Account<'info, WhitelistAuthority>,
}
```

### Test Pattern (from existing test_pool_initialization.rs)
```rust
// Pattern for litesvm testing with Anchor programs
fn anchor_discriminator(name: &str) -> [u8; 8] {
    let mut hasher = Sha256::new();
    hasher.update(format!("global:{}", name));
    let hash = hasher.finalize();
    let mut disc = [0u8; 8];
    disc.copy_from_slice(&hash[..8]);
    disc
}

fn whitelist_authority_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"authority"], program_id)
}

fn whitelist_entry_pda(program_id: &Pubkey, address: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"whitelist", address.as_ref()], program_id)
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual discriminator | Anchor auto-discriminator | Anchor 0.2x+ | No manual is_initialized checks needed |
| Native Rust init | Anchor `init` constraint | Anchor inception | Safer, less boilerplate |
| solana-program-test | litesvm | 2024+ | Faster test execution |

**Deprecated/outdated:**
- `init_if_needed` without careful guards: Risk of reinitialization attacks; we use `init` only
- Manual PDA derivation in instruction: Use Anchor seeds constraint instead

## Open Questions

Things that couldn't be fully resolved:

1. **Event Emission on add_whitelist_entry**
   - What we know: 15-CONTEXT.md says "No event emission on entry creation" but events.rs defines `AddressWhitelisted` and Transfer_Hook_Spec.md Section 7.2 shows emit!
   - What's unclear: Which is authoritative?
   - Recommendation: **Emit the event** per spec. Events are cheap and provide audit trail. The spec is authoritative over context discussion notes.

2. **AlreadyWhitelisted Error Mapping**
   - What we know: Anchor's `init` fails with system error when PDA exists, not custom error
   - What's unclear: How to surface AlreadyWhitelisted error code?
   - Recommendation: Use `#[account(init)]` which fails when account exists. The Anchor error is functionally equivalent. Document in tests that PDA existence = already whitelisted.

3. **Address Validation Granularity**
   - What we know: 15-CONTEXT.md says "Single InvalidAddress error covers all bad address cases"
   - What's unclear: Should we add an InvalidAddress variant to TransferHookError?
   - Recommendation: Reuse `InvalidWhitelistPDA` for invalid addresses, or add new variant if clarity needed. The existing error set may suffice.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `programs/amm/src/instructions/*.rs` - Established Anchor patterns
- Existing codebase: `programs/transfer-hook/src/state/*.rs` - Phase 14 state definitions
- Existing codebase: `programs/transfer-hook/src/errors.rs` - Error definitions
- Existing codebase: `programs/transfer-hook/src/events.rs` - Event definitions
- Existing codebase: `Docs/Transfer_Hook_Spec.md` - Authoritative specification
- [Anchor Account Constraints](https://www.anchor-lang.com/docs/references/account-constraints) - Official constraint reference

### Secondary (MEDIUM confidence)
- [Anchor PDA Documentation](https://www.anchor-lang.com/docs/basics/pda) - Seeds and bump patterns
- [Anchor Custom Errors](https://www.anchor-lang.com/docs/features/errors) - Error handling
- [Anchor Events](https://www.anchor-lang.com/docs/features/events) - Event emission
- [Solana Security Checklist](https://www.zealynx.io/blogs/solana-security-checklist) - Authority patterns

### Tertiary (LOW confidence)
- WebSearch results on idempotent patterns - Community patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Already using Anchor 0.32.1, patterns established in AMM
- Architecture: HIGH - Following existing codebase organization exactly
- Pitfalls: HIGH - Well-documented in Anchor ecosystem
- Code examples: HIGH - Based on existing codebase + official docs

**Research date:** 2026-02-05
**Valid until:** 2026-03-05 (30 days - stable Anchor patterns)
