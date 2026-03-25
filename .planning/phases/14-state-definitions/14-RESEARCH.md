# Phase 14: State Definitions & Program Structure - Research

**Researched:** 2026-02-05
**Domain:** Anchor program architecture for SPL Transfer Hook interface
**Confidence:** HIGH

## Summary

This phase establishes the foundational data structures for the Transfer Hook program: two account structs (WhitelistAuthority, WhitelistEntry), a 6-variant error enum, and two events. The key technical challenge is ensuring the program correctly implements the SPL Transfer Hook interface discriminators so Token-2022 can invoke our hook during transfers.

The project uses Anchor 0.32.1 with spl-transfer-hook-interface 0.10.0 (already in Cargo.lock). A critical finding: **the #[interface] macro mentioned in success criteria was DEPRECATED in Anchor 0.31.0** and replaced by `#[instruction(discriminator = ...)]`. However, Phase 14 only defines state/errors/events -- the discriminator handling applies to instructions in later phases (Phase 16-17). For this phase, standard Anchor patterns apply.

**Primary recommendation:** Use standard Anchor patterns for state/errors/events. Follow the existing AMM project structure (separate modules for state, errors, events). The #[interface] deprecation affects Phase 16-17, not Phase 14.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| anchor-lang | 0.32.1 | Program framework, #[account], #[error_code], #[event] | Already in project, Anchor is the de facto Solana framework |
| anchor-spl | 0.32.1 | Token-2022 account types (InterfaceAccount, Mint, TokenAccount) | Required for Token-2022 integration |

### Supporting (for later phases, documenting for context)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| spl-transfer-hook-interface | 0.10.0 | ExecuteInstruction discriminator | Phase 16-17 when implementing execute instruction |
| spl-tlv-account-resolution | 0.10.0 | ExtraAccountMetaList resolution | Phase 16 when implementing extra account meta initialization |

### Version Compatibility Note
The project's Cargo.lock already contains compatible versions:
- spl-transfer-hook-interface = 0.10.0
- spl-tlv-account-resolution = 0.10.0
- spl-token-2022 = 8.0

These are pulled transitively through anchor-spl's token_2022 feature.

**Dependencies for new transfer_hook program Cargo.toml:**
```toml
[dependencies]
anchor-lang = { version = "0.32.1" }
anchor-spl = { version = "0.32.1", features = ["token_2022"] }
spl-transfer-hook-interface = "0.10.0"
spl-tlv-account-resolution = "0.10.0"
```

## Architecture Patterns

### Recommended Project Structure
```
programs/transfer-hook/src/
    lib.rs           # declare_id!, #[program] mod
    state/
        mod.rs       # pub use statements
        whitelist_authority.rs  # WhitelistAuthority account
        whitelist_entry.rs      # WhitelistEntry account
    errors.rs        # TransferHookError enum
    events.rs        # AuthorityBurned, AddressWhitelisted events
    instructions/    # (Phase 15-17, not this phase)
        mod.rs
```

This mirrors the existing AMM program structure in the codebase.

### Pattern 1: Account Struct with InitSpace
**What:** Use `#[derive(InitSpace)]` for automatic space calculation
**When to use:** All account structs
**Example:**
```rust
// Source: Anchor documentation + existing AMM pattern
use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct WhitelistAuthority {
    /// Authority pubkey, None = burned
    pub authority: Option<Pubkey>,  // 1 + 32 = 33 bytes (Option discriminant + Pubkey)
    /// Whether initialized
    pub initialized: bool,          // 1 byte
}
// Total: 8 (discriminator) + 33 + 1 = 42 bytes
```

### Pattern 2: PDA Seeds as Constants
**What:** Define PDA seeds as constants for reuse
**When to use:** All PDAs
**Example:**
```rust
// Source: Anchor best practices
impl WhitelistAuthority {
    pub const SEED: &'static [u8] = b"authority";
}

impl WhitelistEntry {
    pub const SEED_PREFIX: &'static [u8] = b"whitelist";
}
```

### Pattern 3: Error Enum with Descriptive Messages
**What:** Use #[error_code] with #[msg()] for each variant
**When to use:** All error enums
**Example:**
```rust
// Source: Transfer_Hook_Spec.md Section 10
#[error_code]
pub enum TransferHookError {
    #[msg("Neither source nor destination is whitelisted")]
    NoWhitelistedParty,

    #[msg("Zero amount transfers are not allowed")]
    ZeroAmountTransfer,
    // ... etc
}
```

### Anti-Patterns to Avoid
- **Hardcoding space values:** Use `#[derive(InitSpace)]` instead of manual byte counting
- **Duplicate discriminator definitions:** Let Anchor handle discriminators unless implementing SPL interface (later phases)
- **Missing Option serialization:** `Option<Pubkey>` serializes as 1 + 32 = 33 bytes, not 32

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Space calculation | Manual byte counting | `#[derive(InitSpace)]` | Anchor handles alignment, discriminator |
| Account discriminators | Custom 8-byte arrays | Anchor's automatic generation | Prevents collisions, IDL compatibility |
| Serialization | Custom borsh impl | `AnchorSerialize/AnchorDeserialize` derives | Consistency with ecosystem |
| PDA derivation | Manual find_program_address | `#[account(seeds=..., bump)]` | Anchor validates PDAs automatically |

**Key insight:** Anchor handles all the boilerplate that could go wrong. Only override defaults when implementing external interfaces (Phase 16-17).

## Common Pitfalls

### Pitfall 1: Option<Pubkey> Space Miscalculation
**What goes wrong:** Assuming `Option<Pubkey>` is 32 bytes
**Why it happens:** Forgetting the 1-byte discriminant for Option
**How to avoid:** Use `#[derive(InitSpace)]` which correctly calculates 33 bytes
**Warning signs:** Account creation fails with "insufficient funds" or "account too small"

### Pitfall 2: Forgetting Anchor Discriminator in Space
**What goes wrong:** Calculating space as field sizes only
**Why it happens:** Not accounting for 8-byte discriminator
**How to avoid:** Use `8 + Self::INIT_SPACE` or let Anchor handle via `space = 8 + ...`
**Warning signs:** Deserialization failures, data corruption

### Pitfall 3: #[interface] Macro Usage in 0.32.1
**What goes wrong:** Using deprecated #[interface] macro
**Why it happens:** Old documentation and examples still reference it
**How to avoid:** Use `#[instruction(discriminator = ExecuteInstruction::SPL_DISCRIMINATOR_SLICE)]` instead
**Warning signs:** Deprecation warnings, future incompatibility
**Note:** This applies to Phase 16-17, not Phase 14

### Pitfall 4: Event Field Order
**What goes wrong:** Events with fields in wrong order fail client parsing
**Why it happens:** Anchor events serialize fields in declaration order
**How to avoid:** Match spec exactly: AuthorityBurned has burned_by then timestamp
**Warning signs:** Client-side event parsing returns wrong values

## Code Examples

Verified patterns from official sources and existing codebase:

### WhitelistAuthority Account (from Transfer_Hook_Spec.md Section 6.1)
```rust
// Source: Transfer_Hook_Spec.md + Anchor patterns
use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct WhitelistAuthority {
    /// Authority pubkey. None = authority has been burned (immutable whitelist)
    pub authority: Option<Pubkey>,  // 33 bytes (1 discriminant + 32 pubkey)
    /// Whether this account has been initialized
    pub initialized: bool,          // 1 byte
}
// Space: 8 (anchor discriminator) + 33 + 1 = 42 bytes

impl WhitelistAuthority {
    pub const SEED: &'static [u8] = b"authority";
}
```

### WhitelistEntry Account (from Transfer_Hook_Spec.md Section 5.3)
```rust
// Source: Transfer_Hook_Spec.md Section 5.3
use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct WhitelistEntry {
    /// The whitelisted address
    pub address: Pubkey,      // 32 bytes
    /// Timestamp for audit trail
    pub created_at: i64,      // 8 bytes
}
// Space: 8 (anchor discriminator) + 32 + 8 = 48 bytes
// Spec confirms: "40 bytes (+ 8 byte discriminator = 48 bytes)"

impl WhitelistEntry {
    pub const SEED_PREFIX: &'static [u8] = b"whitelist";
}
```

### Error Enum (from Transfer_Hook_Spec.md Section 10)
```rust
// Source: Transfer_Hook_Spec.md Section 10
use anchor_lang::prelude::*;

#[error_code]
pub enum TransferHookError {
    #[msg("Neither source nor destination is whitelisted")]
    NoWhitelistedParty,

    #[msg("Zero amount transfers are not allowed")]
    ZeroAmountTransfer,

    #[msg("Unauthorized: signer is not the authority")]
    Unauthorized,

    #[msg("Whitelist authority has already been burned")]
    AuthorityAlreadyBurned,

    #[msg("Address is already whitelisted")]
    AlreadyWhitelisted,

    #[msg("Invalid whitelist PDA derivation")]
    InvalidWhitelistPDA,

    // NOTE: ExtraAccountMetaListAlreadyInitialized deferred to Phase 16
}
```

### Events (from Transfer_Hook_Spec.md Section 11)
```rust
// Source: Transfer_Hook_Spec.md Section 11
use anchor_lang::prelude::*;

#[event]
pub struct AuthorityBurned {
    pub burned_by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct AddressWhitelisted {
    pub address: Pubkey,
    pub added_by: Pubkey,
    pub timestamp: i64,
}

// NOTE: TransferBlocked event deferred to Phase 17
```

### Module Organization (lib.rs)
```rust
// Source: Existing AMM pattern in codebase
use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod state;

// Instructions will be added in Phase 15-17
// pub mod instructions;

declare_id!("... program id ...");

#[program]
pub mod transfer_hook {
    use super::*;

    // Instructions will be added in Phase 15-17
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `#[interface(spl_transfer_hook_interface::execute)]` | `#[instruction(discriminator = ExecuteInstruction::SPL_DISCRIMINATOR_SLICE)]` | Anchor 0.31.0 | Must use new syntax for interface discriminators |
| Manual space calculation | `#[derive(InitSpace)]` | Anchor 0.29.0+ | Automatic space calculation |
| Fallback instruction for transfer hooks | `#[interface]` then `#[instruction(discriminator)]` | Anchor 0.30.0/0.31.0 | No longer need fallback handler |

**Deprecated/outdated:**
- `#[interface]` attribute: Deprecated in Anchor 0.31.0, replaced by `#[instruction(discriminator = ...)]`
- Manual discriminator matching via fallback: No longer needed with custom discriminator support

## Open Questions

Things that couldn't be fully resolved:

1. **Exact discriminator value for ExecuteInstruction**
   - What we know: Derived from hash of "spl-transfer-hook-interface:execute"
   - What's unclear: The actual 8-byte value (would need to compute or import)
   - Recommendation: Use `ExecuteInstruction::SPL_DISCRIMINATOR_SLICE` constant from spl-transfer-hook-interface crate (Phase 16-17)

2. **Success Criteria #5 interpretation**
   - What we know: States "Program builds with correct SPL interface discriminator via #[interface] macro"
   - What's unclear: #[interface] is deprecated in our Anchor version
   - Recommendation: The success criteria may be outdated. The equivalent in Anchor 0.32.1 is `#[instruction(discriminator = ...)]`. This affects Phase 16-17, not Phase 14.

## Sources

### Primary (HIGH confidence)
- Anchor 0.31.0 release notes - #[interface] deprecation and #[instruction(discriminator)] replacement
- Anchor 0.32.1 crate documentation - Current API
- Transfer_Hook_Spec.md - Authoritative spec for account/error/event definitions
- Existing AMM program in codebase - Established project patterns
- Cargo.lock analysis - spl-transfer-hook-interface 0.10.0, spl-tlv-account-resolution 0.10.0

### Secondary (MEDIUM confidence)
- [Solana Transfer Hook Guide](https://solana.com/developers/guides/token-extensions/transfer-hook) - Implementation patterns
- [QuickNode Transfer Hook Guide](https://www.quicknode.com/guides/solana-development/spl-tokens/token-2022/transfer-hooks) - Account structure examples
- [SPL Transfer Hook Interface Specification](https://www.solana-program.com/docs/transfer-hook-interface/specification) - Interface requirements

### Tertiary (LOW confidence)
- Various GitHub example repositories (pawsengineer, shoengineerrr) - Outdated Anchor versions (0.29.0)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Using existing project dependencies, verified versions
- Architecture: HIGH - Following existing AMM pattern in codebase
- Space calculations: HIGH - Spec provides exact sizes, Anchor handles automatically
- Discriminator handling: MEDIUM - Deprecated macro requires attention in later phases
- Pitfalls: HIGH - Well-documented Anchor patterns

**Research date:** 2026-02-05
**Valid until:** 60 days (stable Anchor ecosystem)

---

## Critical Clarification for Planner

**Phase 14 Scope:** This phase defines ONLY state structs, errors, and events. The SPL interface discriminator concern (#[interface] / #[instruction(discriminator)]) applies to Phase 16-17 when implementing the `transfer_hook` execute instruction.

For Phase 14, use standard Anchor patterns:
- `#[account]` with `#[derive(InitSpace)]` for state
- `#[error_code]` for errors
- `#[event]` for events
- No special discriminator handling needed

The program WILL build with these definitions. The interface discriminator is added when the execute instruction is implemented in Phase 16-17.
