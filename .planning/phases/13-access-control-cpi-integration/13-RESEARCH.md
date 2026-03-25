# Phase 13: Access Control & CPI Integration - Research

**Researched:** 2026-02-04
**Domain:** Anchor cross-program PDA validation, CPI signer mechanics
**Confidence:** HIGH

## Summary

This phase implements CPI-only access control for the AMM: all swap instructions require a `swap_authority` PDA signed by the Tax Program, preventing direct user calls. The core mechanism combines Anchor's `Signer` type with `seeds::program` constraint to validate that:
1. The account signed the transaction (Signer requirement)
2. The account is a valid PDA derived from Tax Program's program ID (seeds::program validation)

The implementation requires a Mock Tax Program in the workspace that derives the swap_authority PDA using its own program ID and signs via `invoke_signed` when calling AMM swap instructions. A separate Fake Tax Program (different program ID) proves the access control works by being rejected.

**Primary recommendation:** Use `Signer<'info>` with `seeds = [b"swap_authority"], bump, seeds::program = TAX_PROGRAM_ID` constraint on swap instructions. Mock Tax Program CPIs with `invoke_signed` using those same seeds.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| anchor-lang | 0.32.1 | Framework | Already in use, provides `seeds::program` constraint |
| anchor-spl | 0.32.1 | Token interfaces | Already in use for CPI to Token programs |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| litesvm | 0.9.1 | Test harness | Integration tests with multiple programs |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| seeds::program | Manual PDA derivation check | seeds::program is declarative, less error-prone |
| Signer type | UncheckedAccount + is_signer | Signer enforces signing at deserialization, safer |

**No new dependencies required** -- all needed primitives exist in the current stack.

## Architecture Patterns

### Recommended Project Structure
```
programs/
  amm/                          # Existing AMM program
    src/
      constants.rs              # Add TAX_PROGRAM_ID constant
      instructions/
        swap_sol_pool.rs        # Add swap_authority account
        swap_profit_pool.rs     # Add swap_authority account
      errors.rs                 # Add access control errors
  mock-tax-program/             # NEW: Test-only program
    Cargo.toml
    src/
      lib.rs                    # Single execute_swap instruction
  fake-tax-program/             # NEW: Negative test program
    Cargo.toml
    src/
      lib.rs                    # Same interface, different program ID
```

### Pattern 1: Cross-Program PDA Signer Validation
**What:** Combine Signer type with seeds::program to validate external PDA signers
**When to use:** When requiring an instruction only be callable via CPI from a specific program
**Example:**
```rust
// Source: Anchor docs (seeds::program constraint)
// https://www.anchor-lang.com/docs/references/account-constraints

use anchor_lang::prelude::*;

// Hardcoded Tax Program ID (like spl_token::ID)
pub const TAX_PROGRAM_ID: Pubkey = pubkey!("TaxProg111111111111111111111111111111111111");

#[derive(Accounts)]
pub struct SwapSolPool<'info> {
    // ... existing accounts ...

    /// swap_authority PDA: must be signed by Tax Program via invoke_signed.
    /// The Signer type validates this account actually signed.
    /// The seeds + seeds::program constraint validates the PDA is derived
    /// from TAX_PROGRAM_ID with seeds ["swap_authority"].
    #[account(
        seeds = [b"swap_authority"],
        bump,
        seeds::program = TAX_PROGRAM_ID,
    )]
    pub swap_authority: Signer<'info>,

    // ... rest of accounts ...
}
```

### Pattern 2: Mock Tax Program CPI with PDA Signer
**What:** Caller program derives its PDA and signs via invoke_signed
**When to use:** Tax Program (or mock) calling AMM swap instructions
**Example:**
```rust
// Source: Solana CPI docs
// https://solana.com/docs/core/cpi

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;

declare_id!("MockTax1111111111111111111111111111111111");

#[program]
pub mod mock_tax_program {
    use super::*;

    pub fn execute_swap<'info>(
        ctx: Context<'_, '_, 'info, 'info, ExecuteSwap<'info>>,
        amount_in: u64,
        direction: u8,
        minimum_amount_out: u64,
    ) -> Result<()> {
        // Derive swap_authority PDA from THIS program
        let (swap_authority, bump) = Pubkey::find_program_address(
            &[b"swap_authority"],
            &crate::ID,
        );

        // Verify it matches the account passed in
        require_keys_eq!(ctx.accounts.swap_authority.key(), swap_authority);

        // Build AMM instruction data
        let ix_data = build_swap_instruction_data(amount_in, direction, minimum_amount_out);

        // Build account metas for AMM swap instruction
        let account_metas = vec![
            // ... pool, vaults, mints, user accounts ...
            AccountMeta::new_readonly(swap_authority, true), // signer = true
            // ... token programs ...
        ];

        // Build instruction
        let ix = Instruction {
            program_id: AMM_PROGRAM_ID,
            accounts: account_metas,
            data: ix_data,
        };

        // Sign with PDA using invoke_signed
        let signer_seeds: &[&[&[u8]]] = &[&[b"swap_authority", &[bump]]];

        invoke_signed(
            &ix,
            &ctx.accounts.to_account_infos(),
            signer_seeds,
        )?;

        Ok(())
    }
}
```

### Pattern 3: Forwarding remaining_accounts Through CPI
**What:** Pass hook accounts from Mock Tax Program to AMM to Token-2022
**When to use:** Full CPI chain with transfer hooks
**Example:**
```rust
// Source: Project codebase pattern (swap_profit_pool.rs)

// The CPI chain: Tax Program -> AMM -> Token-2022 transfer_checked
// Each level must forward remaining_accounts for hook resolution.

// Mock Tax Program receives remaining_accounts from client:
// [input_hook_accounts..., output_hook_accounts...]
//
// It forwards ALL of them to the AMM swap instruction.
// The AMM handler splits them at midpoint for dual-hook transfers.

pub fn execute_swap<'info>(
    ctx: Context<'_, '_, 'info, 'info, ExecuteSwap<'info>>,
    // ...
) -> Result<()> {
    // remaining_accounts contains hook accounts
    let remaining_accounts = ctx.remaining_accounts;

    // Build instruction with remaining accounts appended
    let mut account_metas: Vec<AccountMeta> = vec![/* named accounts */];

    // Append remaining accounts with their original is_writable/is_signer flags
    for acc in remaining_accounts {
        account_metas.push(AccountMeta {
            pubkey: acc.key(),
            is_signer: acc.is_signer,
            is_writable: acc.is_writable,
        });
    }

    // invoke_signed with all accounts
    let account_infos: Vec<AccountInfo> = ctx.accounts.to_account_infos()
        .into_iter()
        .chain(remaining_accounts.iter().cloned())
        .collect();

    invoke_signed(&ix, &account_infos, signer_seeds)?;
    Ok(())
}
```

### Anti-Patterns to Avoid
- **UncheckedAccount without validation:** Never accept swap_authority as UncheckedAccount -- use Signer to enforce signing at deserialization
- **Hard-coded bump:** Always use `bump` without value so Anchor derives it; hard-coded bumps can cause issues if the canonical bump differs
- **Forgetting seeds::program:** Without this constraint, PDA would be validated against the AMM program ID, allowing any program to create a valid swap_authority
- **Missing remaining_accounts forwarding:** Transfer hooks will fail if hook accounts are not passed through the CPI chain

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PDA derivation validation | Manual `find_program_address` + comparison | Anchor `seeds` constraint | Constraint validates at deserialization, cleaner errors |
| Cross-program PDA check | Owner check + manual derivation | `seeds::program` constraint | Single declarative constraint, Anchor handles validation |
| Signer verification | `account.is_signer` check | `Signer` type | Enforced at deserialization, cannot be bypassed |
| CPI account building | Manual Vec construction | `CpiContext` / `to_account_infos()` | Less error-prone, handles borrows correctly |

**Key insight:** Anchor constraints compose cleanly. `Signer + seeds + bump + seeds::program` all work together to provide layered validation.

## Common Pitfalls

### Pitfall 1: Wrong seeds::program Target
**What goes wrong:** Developer uses `seeds::program = amm_program.key()` instead of a constant
**Why it happens:** Confusion about which program "owns" the PDA
**How to avoid:** TAX_PROGRAM_ID must be a hardcoded constant, not derived from an account. The PDA belongs to the Tax Program, not the AMM.
**Warning signs:** Constraint passes but wrong program's PDA is accepted

### Pitfall 2: CPI Depth Exceeded
**What goes wrong:** Tax Program -> AMM -> Token-2022 -> Transfer Hook exceeds 4-level limit
**Why it happens:** Solana's CPI depth limit is 4 (stack starts at 1, each invoke adds 1)
**How to avoid:** Document architectural constraint that Tax Program callers must be top-level transactions. Our T22 hooks are simple (whitelist check, no further CPI).
**Warning signs:** Runtime error "Cross-program invocation with unauthorized signer or writable account" at depth 5

### Pitfall 3: Signer Seeds Mismatch
**What goes wrong:** Mock Tax Program uses different seeds than AMM expects
**Why it happens:** Seeds defined in two places (caller and callee) must match exactly
**How to avoid:** Use constants. Both programs import/define `SWAP_AUTHORITY_SEED = b"swap_authority"`.
**Warning signs:** "A]count seeds constraint was violated" error from Anchor

### Pitfall 4: Forgetting bump in invoke_signed
**What goes wrong:** PDA signing fails at runtime
**Why it happens:** invoke_signed requires the bump seed, but developer only passes string seeds
**How to avoid:** Always include bump: `&[b"swap_authority", &[bump]]`
**Warning signs:** "missing required signature for instruction" error

### Pitfall 5: Account Ordering in CPI
**What goes wrong:** AMM receives accounts in wrong order, fails validation
**Why it happens:** AccountMeta order must match target instruction's account struct exactly
**How to avoid:** Document exact account ordering. Consider generating instruction builders.
**Warning signs:** "AccountNotFound" or constraint violations on wrong accounts

### Pitfall 6: remaining_accounts Not Forwarded
**What goes wrong:** Token-2022 transfer_checked fails because hook accounts missing
**Why it happens:** Mock Tax Program builds account list but forgets remaining_accounts
**How to avoid:** Explicitly chain remaining_accounts into the CPI account list
**Warning signs:** "Transfer hook account count mismatch" or hook program errors

## Code Examples

Verified patterns from official sources and project codebase:

### Adding swap_authority to SwapSolPool
```rust
// Source: Based on existing swap_sol_pool.rs + Anchor seeds::program docs

use anchor_lang::prelude::*;
use crate::constants::TAX_PROGRAM_ID;

#[derive(Accounts)]
pub struct SwapSolPool<'info> {
    #[account(
        mut,
        seeds = [POOL_SEED, pool.mint_a.as_ref(), pool.mint_b.as_ref()],
        bump = pool.bump,
        constraint = pool.initialized @ AmmError::PoolNotInitialized,
        constraint = !pool.locked @ AmmError::PoolLocked,
    )]
    pub pool: Account<'info, PoolState>,

    // ... vaults, mints, user accounts (unchanged) ...

    /// swap_authority: PDA derived from Tax Program.
    /// Validates: (1) account signed, (2) PDA from TAX_PROGRAM_ID with seeds ["swap_authority"]
    #[account(
        seeds = [b"swap_authority"],
        bump,
        seeds::program = TAX_PROGRAM_ID,
    )]
    pub swap_authority: Signer<'info>,

    pub user: Signer<'info>,  // Still needed for token transfers

    // ... token programs (unchanged) ...
}
```

### TAX_PROGRAM_ID Constant
```rust
// Source: Pattern from spl_token::ID

// In constants.rs (or a shared crate)
use anchor_lang::prelude::*;

/// Tax Program ID - hardcoded like SPL Token program IDs.
/// This is the program that can sign swap_authority to call AMM swaps.
pub const TAX_PROGRAM_ID: Pubkey = pubkey!("TaxProg111111111111111111111111111111111111");

// For testing, mock program will have a different ID that we substitute
#[cfg(test)]
pub const MOCK_TAX_PROGRAM_ID: Pubkey = pubkey!("MockTax1111111111111111111111111111111111");
```

### New Error Codes
```rust
// Source: Project pattern from errors.rs

#[error_code]
pub enum AmmError {
    // ... existing errors ...

    // --- Phase 13: Access control errors ---

    /// Swap instructions require swap_authority PDA signed by Tax Program.
    /// Direct calls without valid swap_authority are not allowed.
    #[msg("Swaps must go through Tax Program - direct calls not allowed")]
    DirectCallNotAllowed,

    /// The swap_authority PDA was derived from the wrong program.
    /// Expected Tax Program, got a different program ID.
    #[msg("Invalid swap_authority: PDA derived from wrong program")]
    InvalidSwapAuthorityProgram,

    /// The swap_authority seeds do not match expected values.
    #[msg("Invalid swap_authority: wrong seeds used")]
    InvalidSwapAuthoritySeeds,
}
```

### Mock Tax Program Minimal Implementation
```rust
// Source: Pattern from CPI docs + project structure

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;

declare_id!("MockTax1111111111111111111111111111111111");

pub const SWAP_AUTHORITY_SEED: &[u8] = b"swap_authority";

#[program]
pub mod mock_tax_program {
    use super::*;

    /// Forward a swap to the AMM with swap_authority signature.
    /// This is a minimal mock -- real Tax Program would compute taxes.
    pub fn execute_swap<'info>(
        ctx: Context<'_, '_, 'info, 'info, ExecuteSwap<'info>>,
        amount_in: u64,
        direction: u8,
        minimum_amount_out: u64,
    ) -> Result<()> {
        let bump = ctx.bumps.swap_authority;
        let signer_seeds: &[&[&[u8]]] = &[&[SWAP_AUTHORITY_SEED, &[bump]]];

        // Build AMM swap instruction
        // (instruction data building omitted for brevity)

        invoke_signed(
            &instruction,
            &account_infos,
            signer_seeds,
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct ExecuteSwap<'info> {
    /// swap_authority PDA owned by this program
    #[account(
        seeds = [SWAP_AUTHORITY_SEED],
        bump,
    )]
    pub swap_authority: SystemAccount<'info>,

    // All AMM accounts passed through
    // (detailed list matches AMM swap instruction accounts)

    /// CHECK: AMM program for CPI
    pub amm_program: UncheckedAccount<'info>,
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Owner checks only | seeds::program constraint | Anchor 0.27+ | Cleaner, declarative cross-program PDA validation |
| Manual invoke | Anchor CpiContext | Anchor 0.1+ | Type-safe CPI calls |
| is_signer checks | Signer type | Anchor 0.1+ | Validation at deserialization |

**Deprecated/outdated:**
- Manual PDA derivation comparison: Use seeds constraints instead
- `ctx.accounts.signer.is_signer` checks: Signer type enforces this

## Open Questions

Things that couldn't be fully resolved:

1. **Exact seeds::program + Signer combination behavior**
   - What we know: Both constraints work independently. seeds::program validates PDA derivation, Signer validates signing.
   - What's unclear: Whether Anchor handles the bump derivation correctly when seeds::program differs from executing program. Documentation is sparse on this exact combination.
   - Recommendation: Test first with simple case. If issues, fall back to UncheckedAccount with manual validation (less elegant but works).

2. **litesvm multi-program deployment**
   - What we know: litesvm supports multiple programs via repeated set_account calls
   - What's unclear: Whether multiple Anchor programs in same workspace interfere during testing (shared types, IDL conflicts)
   - Recommendation: Each mock program gets its own Cargo.toml, own declare_id!, own deployment

3. **remaining_accounts lifetime through CPI**
   - What we know: Handler signature needs explicit lifetimes for remaining_accounts forwarding (per 11-01 decisions)
   - What's unclear: Whether additional lifetime annotations needed when forwarding through TWO CPI levels (Mock -> AMM -> Token)
   - Recommendation: Start with straightforward forwarding. If lifetime issues, may need explicit `to_account_infos()` clone.

## Sources

### Primary (HIGH confidence)
- [Anchor Account Constraints Reference](https://www.anchor-lang.com/docs/references/account-constraints) - seeds::program syntax
- [Solana CPI Documentation](https://solana.com/docs/core/cpi) - invoke_signed mechanics, CPI depth limits
- [Anchor CPI Documentation](https://www.anchor-lang.com/docs/basics/cpi) - CpiContext usage
- [Anchor PDA Documentation](https://www.anchor-lang.com/docs/basics/pda) - seeds constraint validation
- Project codebase: `programs/amm/src/instructions/swap_sol_pool.rs` - existing pattern for remaining_accounts

### Secondary (MEDIUM confidence)
- [GitHub Anchor PDA source](https://github.com/coral-xyz/anchor/blob/master/docs/content/docs/basics/pda.mdx) - seeds::program constraint details

### Tertiary (LOW confidence)
- WebSearch results on combining Signer with seeds::program - limited real-world examples

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies, existing patterns
- Architecture: HIGH - well-documented Anchor patterns
- Pitfalls: MEDIUM - some patterns extrapolated from general CPI knowledge
- seeds::program + Signer combo: MEDIUM - sparse documentation on exact combination

**Research date:** 2026-02-04
**Valid until:** 30 days (Anchor ecosystem is stable)
