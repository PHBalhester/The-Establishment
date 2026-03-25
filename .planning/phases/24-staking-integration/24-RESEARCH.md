# Phase 24: Staking Integration - Research

**Researched:** 2026-02-06
**Domain:** Anchor CPI patterns, cross-program yield signaling, stub program design
**Confidence:** HIGH

## Summary

Phase 24 connects epoch transitions to staking yield finalization through a CPI from Epoch Program to Staking Program. The research focuses on three domains: (1) the CPI interface design using established project patterns, (2) stub program structure for testing, and (3) the timing/ordering within `consume_randomness`.

This project already has proven CPI-gated access control patterns: Tax Program's `swap_exempt` instruction validates the caller is Epoch Program via `seeds::program = epoch_program_id()` constraint. Phase 24 follows this same pattern in reverse - Staking Program validates caller is Epoch Program.

The stub program should be minimal (like `mock-tax-program`) - just enough to verify the CPI interface works. The full Staking Program is a future milestone; Phase 24 delivers the integration mechanism only.

**Primary recommendation:** Use the established `seeds::program` cross-program PDA verification pattern. Stub tracks `cumulative_epochs`, `last_epoch`, `total_yield_distributed` per CONTEXT.md. CPI occurs after tax derivation, before Carnage check in `consume_randomness`.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| anchor-lang | 0.30+ | Solana program framework | Project standard, CPI context helpers |
| anchor-spl | 0.30+ | SPL token integration | Token interface types |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| solana-program | 2.0+ | Low-level instructions | Manual CPI (if needed) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Anchor CPI helpers | Manual invoke_signed | Manual is more verbose but avoids crate dependency; existing Tax->AMM uses manual pattern, this phase can use either |

**No new dependencies required.** Phase 24 uses the same stack already in the workspace.

## Architecture Patterns

### Recommended Project Structure
```
programs/
├── epoch-program/
│   └── src/
│       └── instructions/
│           └── consume_randomness.rs  # Add CPI to staking
└── stub-staking/                      # New stub program
    └── src/
        ├── lib.rs                     # Entry point + update_cumulative
        ├── state.rs                   # StubStakePool state
        └── errors.rs                  # Error codes
```

### Pattern 1: CPI-Gated Access Control (seeds::program)
**What:** Validate CPI caller by verifying a PDA was derived from the expected calling program.
**When to use:** When only a specific program should call an instruction (like only Epoch Program can finalize epochs).
**Example:**
```rust
// Source: programs/tax-program/src/instructions/swap_exempt.rs lines 186-191
// In Staking Program's UpdateCumulative instruction:
#[account(
    seeds = [EPOCH_AUTHORITY_SEED],  // e.g., b"epoch_authority"
    bump,
    seeds::program = epoch_program_id(),  // Verify caller is Epoch Program
)]
pub epoch_authority: Signer<'info>,
```

**Why this pattern works:**
1. Epoch Program derives a PDA from its own program ID
2. Epoch Program signs CPI with this PDA via `invoke_signed`
3. Staking Program uses `seeds::program = EPOCH_PROGRAM_ID` to verify the signer PDA could only have been derived by Epoch Program
4. If any other program tries to call, PDA derivation check fails

### Pattern 2: Cross-Program Struct Mirroring
**What:** Mirror account structs across programs so Anchor can deserialize cross-program state.
**When to use:** When reading another program's account state (e.g., Epoch Program reading EpochState).
**Example:**
```rust
// Source: STATE.md v0.5 patterns
// In stub-staking/src/state.rs - mirror EpochState for reading
// CRITICAL: Field order must match exactly for AccountDeserialize to work
#[derive(Clone, Copy)]
pub struct EpochStateRef {
    pub genesis_slot: u64,
    pub current_epoch: u32,
    // ... all fields in exact order
}
```

**Note for Phase 24:** Staking Program only needs `current_epoch` from EpochState. Can use `Account<'info, EpochState>` if crate dependency exists, or read raw bytes if avoiding dependency.

### Pattern 3: Minimal Stub Program
**What:** Stub program implements only the interface needed for integration testing.
**When to use:** Testing CPI patterns before building full functionality.
**Example:**
```rust
// Source: programs/mock-tax-program/src/lib.rs
// Stub maintains minimal state to verify CPI completed
#[account]
pub struct StubStakePool {
    pub cumulative_epochs: u64,      // Count of finalize calls
    pub last_epoch: u64,             // Last epoch finalized (for double-call protection)
    pub total_yield_distributed: u64, // Placeholder for yield tracking
    pub initialized: bool,
    pub bump: u8,
}
```

### Anti-Patterns to Avoid
- **Calling Program ID hardcoded in instruction data:** Use PDA verification via `seeds::program` instead - cannot be spoofed
- **Skip double-finalization check:** Always verify `epoch > last_epoch` to prevent replay
- **Tight coupling to full StakePool:** Stub should not depend on full Staking Program types

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PDA signing for CPI | Manual seed derivation | `ctx.bumps.authority` + `invoke_signed` | Anchor handles bump caching |
| Cross-program access control | Custom authority account | `seeds::program` constraint | Anchor verifies at deserialization |
| Account validation | Manual pubkey checks | Anchor constraints | Compile-time verification where possible |

**Key insight:** The project already established these patterns in v0.4 (Carnage CPI) and v0.5 (cross-program state reading). Phase 24 should follow the same patterns, not introduce new ones.

## Common Pitfalls

### Pitfall 1: Mismatched PDA Seeds Between Programs
**What goes wrong:** Epoch Program uses `b"staking_authority"` but Staking Program expects `b"epoch_authority"` - CPI silently fails.
**Why it happens:** Seeds defined in separate crate constants files, easy to diverge.
**How to avoid:** Document exact seed bytes in a shared location (e.g., CONTEXT.md or a constants reference). Add integration test that verifies derivation matches.
**Warning signs:** CPI returns "invalid account" or "PDA mismatch" errors.

### Pitfall 2: Forgetting to Pass epoch_authority Signer
**What goes wrong:** Epoch Program makes CPI but doesn't include the PDA signer seeds.
**Why it happens:** `invoke_signed` requires explicit signer seeds array.
**How to avoid:** Use Anchor's `CpiContext::new_with_signer` or explicit `&[&[SEED, &[bump]]]` pattern.
**Warning signs:** "Missing required signature" error on CPI.

### Pitfall 3: Double Epoch Finalization
**What goes wrong:** `update_cumulative` called twice for same epoch, corrupting cumulative math.
**Why it happens:** Network retry, duplicate transaction, or crank bot bug.
**How to avoid:** Store `last_epoch` in StakePool, require `epoch > last_epoch`.
**Warning signs:** Cumulative value jumps unexpectedly, tests pass individually but fail in sequence.

### Pitfall 4: CPI Depth Exceeded
**What goes wrong:** Adding CPI from consume_randomness pushes call stack beyond Solana's 5-level limit.
**Why it happens:** consume_randomness -> Staking + consume_randomness -> Carnage -> Tax -> AMM -> Token-2022 -> Hook = 6 levels.
**How to avoid:** Staking CPI happens BEFORE Carnage check. Staking CPI doesn't chain further. Current depth: consume(1) -> staking(2) is fine. Carnage path: consume(1) -> carnage(2) -> tax(3) -> amm(4) -> hook(5) stays at limit.
**Warning signs:** "Max invoke stack height reached" error.

### Pitfall 5: Account Order Mismatch in CPI
**What goes wrong:** CpiContext accounts don't match target instruction's expected order.
**Why it happens:** Manual account building doesn't match #[derive(Accounts)] struct order.
**How to avoid:** Use Anchor's typed CPI when possible, or carefully match account order to target's struct definition.
**Warning signs:** "Account not found" or deserialization errors on target program.

## Code Examples

Verified patterns from official sources and existing codebase:

### Epoch Program: CPI to Staking::update_cumulative
```rust
// Source: Based on existing swap_exempt.rs CPI pattern
// In epoch-program/src/instructions/consume_randomness.rs

use anchor_lang::prelude::*;

// Constants (add to epoch-program/src/constants.rs)
pub const STAKING_AUTHORITY_SEED: &[u8] = b"staking_authority";

// In ConsumeRandomness accounts struct:
#[derive(Accounts)]
pub struct ConsumeRandomness<'info> {
    // ... existing accounts ...

    /// Staking authority PDA - Epoch Program signs CPIs to Staking.
    /// CHECK: PDA derived from this program's seeds
    #[account(
        seeds = [STAKING_AUTHORITY_SEED],
        bump,
    )]
    pub staking_authority: AccountInfo<'info>,

    /// Staking Program's pool state (mutable for update_cumulative).
    /// CHECK: Validated by Staking Program during CPI
    #[account(mut)]
    pub stake_pool: AccountInfo<'info>,

    /// Staking Program
    /// CHECK: Program ID validated in CPI
    pub staking_program: AccountInfo<'info>,
}

// In handler, after tax derivation, before Carnage check:
fn handler(ctx: Context<ConsumeRandomness>) -> Result<()> {
    // ... existing tax derivation code ...

    // === CPI TO STAKING: FINALIZE EPOCH YIELD ===
    let staking_authority_bump = ctx.bumps.staking_authority;
    let staking_authority_seeds: &[&[u8]] = &[
        STAKING_AUTHORITY_SEED,
        &[staking_authority_bump],
    ];

    // Build CPI instruction (manual pattern like swap_exempt)
    let update_cumulative_ix = Instruction {
        program_id: ctx.accounts.staking_program.key(),
        accounts: vec![
            AccountMeta::new_readonly(ctx.accounts.staking_authority.key(), true),
            AccountMeta::new(ctx.accounts.stake_pool.key(), false),
            AccountMeta::new_readonly(ctx.accounts.epoch_state.key(), false),
        ],
        data: UPDATE_CUMULATIVE_DISCRIMINATOR.to_vec(), // Precomputed discriminator
    };

    invoke_signed(
        &update_cumulative_ix,
        &[
            ctx.accounts.staking_authority.to_account_info(),
            ctx.accounts.stake_pool.to_account_info(),
            ctx.accounts.epoch_state.to_account_info(),
            ctx.accounts.staking_program.to_account_info(),
        ],
        &[staking_authority_seeds],
    )?;

    msg!("Staking cumulative updated for epoch {}", epoch_state.current_epoch);

    // ... existing Carnage check code ...
    Ok(())
}
```

### Stub Staking Program: update_cumulative Instruction
```rust
// Source: Based on mock-tax-program pattern
// In stub-staking/src/lib.rs

use anchor_lang::prelude::*;

declare_id!("StubStak1ng11111111111111111111111111111111"); // Placeholder

pub const STAKE_POOL_SEED: &[u8] = b"stake_pool";
pub const STAKING_AUTHORITY_SEED: &[u8] = b"staking_authority";

// Must match Epoch Program's constant
pub fn epoch_program_id() -> Pubkey {
    pubkey!("AH7yaWFUrWmXGDKEwr8w2EMEiH6PxaxE2vT9orjRzvod") // Actual Epoch Program ID
}

#[program]
pub mod stub_staking {
    use super::*;

    /// Initialize the stub stake pool.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let pool = &mut ctx.accounts.stake_pool;
        pool.cumulative_epochs = 0;
        pool.last_epoch = 0;
        pool.total_yield_distributed = 0;
        pool.initialized = true;
        pool.bump = ctx.bumps.stake_pool;
        Ok(())
    }

    /// Called by Epoch Program to finalize epoch yield.
    /// Only Epoch Program can call this (validated via seeds::program).
    pub fn update_cumulative(ctx: Context<UpdateCumulative>, epoch: u32) -> Result<()> {
        let pool = &mut ctx.accounts.stake_pool;

        // Prevent double-finalization
        require!(
            epoch as u64 > pool.last_epoch,
            StubStakingError::AlreadyUpdated
        );

        // Update tracking state
        pool.cumulative_epochs = pool.cumulative_epochs.checked_add(1)
            .ok_or(StubStakingError::Overflow)?;
        pool.last_epoch = epoch as u64;

        // In full implementation: pool.total_yield_distributed += pending_rewards
        // For stub: just increment a counter to prove CPI worked
        pool.total_yield_distributed = pool.total_yield_distributed.checked_add(1)
            .ok_or(StubStakingError::Overflow)?;

        emit!(CumulativeUpdated {
            epoch,
            cumulative_epochs: pool.cumulative_epochs,
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + StubStakePool::LEN,
        seeds = [STAKE_POOL_SEED],
        bump,
    )]
    pub stake_pool: Account<'info, StubStakePool>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateCumulative<'info> {
    /// Epoch authority PDA from Epoch Program.
    /// CRITICAL: seeds::program verifies this came from Epoch Program.
    #[account(
        seeds = [STAKING_AUTHORITY_SEED],
        bump,
        seeds::program = epoch_program_id(),
    )]
    pub epoch_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [STAKE_POOL_SEED],
        bump = stake_pool.bump,
    )]
    pub stake_pool: Account<'info, StubStakePool>,
}

#[account]
pub struct StubStakePool {
    pub cumulative_epochs: u64,
    pub last_epoch: u64,
    pub total_yield_distributed: u64,
    pub initialized: bool,
    pub bump: u8,
}

impl StubStakePool {
    pub const LEN: usize = 8 + 8 + 8 + 1 + 1; // 26 bytes
}

#[event]
pub struct CumulativeUpdated {
    pub epoch: u32,
    pub cumulative_epochs: u64,
}

#[error_code]
pub enum StubStakingError {
    #[msg("Cumulative already updated for this epoch")]
    AlreadyUpdated,
    #[msg("Arithmetic overflow")]
    Overflow,
}
```

### Integration Test Pattern
```rust
// Source: Based on existing test patterns
// In tests/staking_integration.rs

#[tokio::test]
async fn test_consume_randomness_cpis_to_staking() {
    // 1. Setup: Initialize Epoch Program + Stub Staking
    // 2. Trigger epoch transition with VRF
    // 3. Consume randomness (should CPI to staking)
    // 4. Verify: stake_pool.cumulative_epochs == 1
    // 5. Verify: stake_pool.last_epoch == current_epoch
}

#[tokio::test]
async fn test_double_finalization_rejected() {
    // 1. Consume randomness for epoch N
    // 2. Try to call update_cumulative for epoch N again
    // 3. Verify: Error::AlreadyUpdated
}

#[tokio::test]
async fn test_unauthorized_caller_rejected() {
    // 1. Create a fake program that tries to CPI to update_cumulative
    // 2. Derive a PDA with same seeds but from fake program ID
    // 3. Verify: seeds::program validation fails
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Callback functions | CPI-gated instructions | N/A (Solana standard) | Clean separation of concerns |
| Admin key authorization | PDA seed verification | N/A (Anchor pattern) | Trustless access control |

**Deprecated/outdated:**
- None for this domain. CPI patterns are stable in Anchor 0.30+.

## Open Questions

Things that couldn't be fully resolved, left to Claude's discretion per CONTEXT.md:

1. **Data passed to update_cumulative**
   - What we know: Stub needs epoch number for double-call protection
   - Options: (a) Pass epoch explicitly as argument, (b) Read from EpochState account
   - Recommendation: Pass epoch as argument - simpler, avoids cross-program struct mirroring in stub

2. **Return data from CPI**
   - What we know: Solana supports return data from CPIs via `sol_set_return_data`
   - Options: (a) No return (just success/failure), (b) Return stats
   - Recommendation: No return data - keep it simple. Emit event instead for observability.

3. **PDA pattern naming**
   - What we know: Need a PDA that Epoch Program signs with
   - Options: (a) `staking_authority` (from Epoch's perspective), (b) `epoch_authority` (from Staking's perspective)
   - Recommendation: Use `staking_authority` in Epoch Program (consistent with `carnage_signer` pattern), use same seed in Staking Program's `seeds::program` constraint

4. **Stub location**
   - What we know: Project has `mock-tax-program` and `fake-tax-program` in `programs/`
   - Options: `programs/stub-staking/`, `programs/mock-staking/`, `tests/fixtures/`
   - Recommendation: `programs/stub-staking/` - consistent with mock-tax-program pattern, workspace members = `programs/*`

5. **Failure handling**
   - What we know: If CPI fails, whole `consume_randomness` reverts
   - Options: (a) Atomic revert (current default), (b) Try-catch and continue
   - Recommendation: Atomic revert - staking update is critical, shouldn't proceed without it. If staking is broken, protocol should pause until fixed.

## Sources

### Primary (HIGH confidence)
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/tax-program/src/instructions/swap_exempt.rs` - CPI-gated access control pattern using `seeds::program`
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/mock-tax-program/src/lib.rs` - Stub program structure
- `/Users/mlbob/Projects/Dr Fraudsworth/Docs/Epoch_State_Machine_Spec.md` - Section 8.3 consume_randomness flow
- `/Users/mlbob/Projects/Dr Fraudsworth/Docs/New_Yield_System_Spec.md` - Section 7.6 update_cumulative interface
- `/Users/mlbob/Projects/Dr Fraudsworth/.planning/phases/24-staking-integration/24-CONTEXT.md` - User decisions

### Secondary (MEDIUM confidence)
- [Anchor CPI Documentation](https://www.anchor-lang.com/docs/basics/cpi) - CpiContext patterns
- [Solana CPI Documentation](https://solana.com/docs/core/cpi) - invoke_signed, depth limits

### Tertiary (LOW confidence)
- WebSearch for "Anchor CPI best practices 2026" - General patterns, verified against codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Uses existing project dependencies only
- Architecture patterns: HIGH - Follows established project patterns (swap_exempt, mock-tax-program)
- Pitfalls: HIGH - Based on actual Solana/Anchor constraints and project experience
- Code examples: MEDIUM - Based on existing code, but not yet tested for Phase 24

**Research date:** 2026-02-06
**Valid until:** 2026-03-06 (30 days - stable domain, no external dependencies)
