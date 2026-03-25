# Phase 27: Cross-Program Integration - Research

**Researched:** 2026-02-07
**Domain:** Solana CPI, Anchor seeds::program, Cross-Program Authority Validation
**Confidence:** HIGH

## Summary

This phase integrates the Tax Program and Epoch Program with the real Staking Program via CPI. The research confirms that:

1. **The Staking Program is already built** (Phase 26) with all required account structures and events defined
2. **The Epoch Program already has CPI infrastructure** to the stub-staking program using `seeds::program` constraint
3. **The Tax Program already transfers SOL to staking_escrow** but needs CPI to `deposit_rewards` to update pending_rewards state
4. **The stub-staking pattern is production-ready** and can be directly adapted to the real Staking Program

The main work is:
- Adding `deposit_rewards` instruction to Staking Program (SEC-03: Tax Program CPI gating)
- Adding `update_cumulative` instruction to Staking Program (already has the logic, needs CPI gating)
- Updating Epoch Program's consume_randomness to CPI to real Staking Program instead of stub
- Adding CPI from Tax Program's swap instructions to Staking Program's deposit_rewards

**Primary recommendation:** Follow the stub-staking `seeds::program` pattern exactly for both CPI gates. The infrastructure is proven.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Anchor | 0.32.1+ | Program framework | Already in use, seeds::program constraint |
| anchor_lang::solana_program | native | invoke_signed for CPI | Required for cross-program calls |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| sha2 | 0.10+ | Discriminator computation | Pre-computing instruction discriminators |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| seeds::program | require!() program check | seeds::program is atomic at account validation, safer |
| Hardcoded program IDs | Configurable via state | Hardcoded is simpler, no upgrade flexibility needed |

## Architecture Patterns

### Recommended Project Structure
```
programs/staking/src/
    instructions/
        deposit_rewards.rs     # NEW: Tax Program CPI target
        update_cumulative.rs   # NEW: Epoch Program CPI target
        mod.rs                 # Add new instructions
    constants.rs               # Add TAX_AUTHORITY_SEED, epoch_program_id()
    lib.rs                     # Add instruction handlers
```

### Pattern 1: seeds::program Cross-Program PDA Gating

**What:** Anchor constraint that verifies a PDA was derived from a specific external program, ensuring only that program can sign for it.

**When to use:** When instruction should only be callable via CPI from a specific authorized program.

**Example (from stub-staking, verified working):**
```rust
// Source: programs/stub-staking/src/lib.rs lines 160-177
#[derive(Accounts)]
pub struct UpdateCumulative<'info> {
    /// Epoch Program's staking authority PDA.
    /// CRITICAL: seeds::program ensures this PDA is derived from Epoch Program.
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
    pub stake_pool: Account<'info, StakePool>,
}
```

**How it works:**
1. Epoch Program derives PDA with seeds `["staking_authority"]` from its program ID
2. Epoch Program signs CPI with that PDA using `invoke_signed`
3. Staking Program's `seeds::program = epoch_program_id()` constraint validates:
   - The account IS a PDA with seeds `["staking_authority"]`
   - The PDA was derived from Epoch Program specifically
   - The PDA signed the transaction
4. If any validation fails, transaction reverts at account validation (before instruction runs)

### Pattern 2: CPI Instruction Building with Discriminator

**What:** Building CPI instructions with precomputed Anchor discriminators.

**When to use:** When CPI-ing to Anchor programs without using the generated CPI module.

**Example (from consume_randomness.rs, verified working):**
```rust
// Source: programs/epoch-program/src/instructions/consume_randomness.rs lines 209-231
// Discriminator precomputed: sha256("global:update_cumulative")[0..8]
const UPDATE_CUMULATIVE_DISCRIMINATOR: [u8; 8] = [0x93, 0x84, 0xdb, 0x65, 0xa5, 0x17, 0x3d, 0x71];

let staking_authority_seeds: &[&[u8]] = &[
    STAKING_AUTHORITY_SEED,
    &[staking_authority_bump],
];

// Build instruction data: discriminator (8) + epoch (4)
let mut ix_data = Vec::with_capacity(12);
ix_data.extend_from_slice(&UPDATE_CUMULATIVE_DISCRIMINATOR);
ix_data.extend_from_slice(&epoch.to_le_bytes());

let update_cumulative_ix = Instruction {
    program_id: ctx.accounts.staking_program.key(),
    accounts: vec![
        AccountMeta::new_readonly(ctx.accounts.staking_authority.key(), true),
        AccountMeta::new(ctx.accounts.stake_pool.key(), false),
    ],
    data: ix_data,
};

invoke_signed(
    &update_cumulative_ix,
    &[/* account infos */],
    &[staking_authority_seeds],
)?;
```

### Pattern 3: Atomic SOL Transfer + State Update

**What:** Tax Program needs both SOL transfer AND Staking Program state update.

**When to use:** When depositing yield - SOL must arrive AND pending_rewards must increment.

**Current flow (Tax Program swap_sol_buy.rs lines 104-118):**
```rust
// Currently: Just transfers SOL to escrow (no state update)
invoke_signed(
    &system_instruction::transfer(
        ctx.accounts.user.key,
        ctx.accounts.staking_escrow.key,  // escrow_vault PDA
        staking_portion,
    ),
    &[/* accounts */],
    &[], // User signs
)?;
```

**Required flow:**
```rust
// 1. Transfer SOL to escrow (as now)
invoke_signed(
    &system_instruction::transfer(
        ctx.accounts.user.key,
        ctx.accounts.staking_escrow.key,
        staking_portion,
    ),
    &[/* accounts */],
    &[],
)?;

// 2. CPI to Staking::deposit_rewards to update pending_rewards state
// Tax Program's tax_authority PDA signs
invoke_signed(
    &deposit_rewards_ix,
    &[/* accounts */],
    &[tax_authority_seeds],
)?;
```

### Anti-Patterns to Avoid

- **require!() for program ID checks:** Use seeds::program instead - it's atomic at account validation, not in instruction body
- **Revealing authorized program IDs in errors:** Per CONTEXT.md, use generic "Unauthorized" error
- **Retry mechanisms for CPI failure:** Per CONTEXT.md, CPI failure fails entire transaction - no fallback
- **Test/prod divergence:** Per CONTEXT.md, remove stub-staking entirely, use real program everywhere

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-program authority | Manual program ID checks | seeds::program constraint | Atomic, cannot bypass |
| Instruction discriminators | Manual byte arrays | sha256("global:instruction_name")[0..8] | Anchor standard, testable |
| PDA signing | Manual seed management | Anchor bumps with invoke_signed | Bump canonicalization guaranteed |

**Key insight:** The stub-staking program already implements the exact pattern needed. Copy it precisely.

## Common Pitfalls

### Pitfall 1: Seed Mismatch Between Programs

**What goes wrong:** Epoch Program derives PDA with one seed, Staking Program expects different seed.
**Why it happens:** Copy-paste errors, typos in seed constants.
**How to avoid:**
- Both programs define identical const: `pub const STAKING_AUTHORITY_SEED: &[u8] = b"staking_authority";`
- Write unit tests that compute seeds in both programs and assert equality
**Warning signs:** "A seeds constraint was violated" error at runtime.

### Pitfall 2: Program ID Mismatch

**What goes wrong:** seeds::program uses wrong program ID, all CPI calls fail.
**Why it happens:** Program IDs change between deployments, hardcoded IDs not updated.
**How to avoid:**
- Use const fn pattern: `pub fn epoch_program_id() -> Pubkey`
- Document deployment checklist to update IDs
- Integration tests verify CPI works end-to-end
**Warning signs:** All CPI attempts fail with seeds constraint violation.

### Pitfall 3: Missing Signer in CPI Accounts

**What goes wrong:** CPI instruction built correctly but PDA not marked as signer.
**Why it happens:** AccountMeta::new_readonly instead of new_readonly with is_signer=true.
**How to avoid:**
```rust
AccountMeta::new_readonly(authority_pda.key(), true)  // true = is_signer
```
**Warning signs:** "missing required signature" error.

### Pitfall 4: Double-Counting Rewards

**What goes wrong:** deposit_rewards updates pending_rewards, but SOL transfer already happened separately.
**Why it happens:** Tax Program already transfers SOL to escrow before Phase 27.
**How to avoid:**
- deposit_rewards does NOT transfer SOL - just updates state
- SOL already arrives via system_instruction::transfer
- CPI to deposit_rewards only increments pending_rewards counter
**Warning signs:** Escrow balance doesn't match pending_rewards + total_distributed - total_claimed.

### Pitfall 5: Discriminator Computation Error

**What goes wrong:** CPI fails with "invalid instruction discriminator".
**Why it happens:** Wrong instruction name in sha256 hash.
**How to avoid:**
```rust
// Test that verifies discriminator is correct
#[test]
fn test_deposit_rewards_discriminator() {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(b"global:deposit_rewards");
    let result = hasher.finalize();
    let expected: [u8; 8] = result[0..8].try_into().unwrap();
    assert_eq!(DEPOSIT_REWARDS_DISCRIMINATOR, expected);
}
```
**Warning signs:** CPI fails with discriminator mismatch.

## Code Examples

Verified patterns from codebase:

### deposit_rewards Instruction (Staking Program - to be created)

```rust
// Source: Based on stub_staking::update_cumulative pattern + spec Section 7.5
// Seed for Tax Program's authority PDA
pub const TAX_AUTHORITY_SEED: &[u8] = b"tax_authority";

pub fn tax_program_id() -> Pubkey {
    pubkey!("FV3kWDtSRDHTdd9fK9L1fkqdWis7Sts5x7nNS4uoSiiu")
}

#[derive(Accounts)]
pub struct DepositRewards<'info> {
    /// Tax Program's authority PDA - signs CPI
    /// seeds::program ensures only Tax Program can call this
    #[account(
        seeds = [TAX_AUTHORITY_SEED],
        bump,
        seeds::program = tax_program_id(),
    )]
    pub tax_authority: Signer<'info>,

    /// Stake pool state
    #[account(
        mut,
        seeds = [STAKE_POOL_SEED],
        bump = stake_pool.bump,
        constraint = stake_pool.initialized @ StakingError::NotInitialized,
    )]
    pub stake_pool: Account<'info, StakePool>,
}

pub fn handler(ctx: Context<DepositRewards>, amount: u64) -> Result<()> {
    require!(amount > 0, StakingError::ZeroAmount);

    let pool = &mut ctx.accounts.stake_pool;
    let clock = Clock::get()?;

    // Add to pending (SOL already transferred by Tax Program)
    pool.pending_rewards = pool.pending_rewards
        .checked_add(amount)
        .ok_or(StakingError::Overflow)?;

    emit!(RewardsDeposited {
        amount,
        new_pending: pool.pending_rewards,
        slot: clock.slot,
    });

    Ok(())
}
```

### update_cumulative Instruction (Staking Program - to be created)

```rust
// Source: Based on stub_staking::update_cumulative + spec Section 7.6
// Seed must match Epoch Program's STAKING_AUTHORITY_SEED
pub const STAKING_AUTHORITY_SEED: &[u8] = b"staking_authority";

pub fn epoch_program_id() -> Pubkey {
    pubkey!("AH7yaWFUrWmXGDKEwr8w2EMEiH6PxaxE2vT9orjRzvod")
}

#[derive(Accounts)]
pub struct UpdateCumulative<'info> {
    /// Epoch Program's staking authority PDA
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
        constraint = stake_pool.initialized @ StakingError::NotInitialized,
    )]
    pub stake_pool: Account<'info, StakePool>,
}

pub fn handler(ctx: Context<UpdateCumulative>, epoch: u32) -> Result<()> {
    let pool = &mut ctx.accounts.stake_pool;
    let clock = Clock::get()?;

    // Prevent double-update (ERR-06: AlreadyUpdated)
    require!(
        epoch > pool.last_update_epoch,
        StakingError::AlreadyUpdated
    );

    // Add pending to cumulative (from helpers::math)
    if pool.pending_rewards > 0 && pool.total_staked > 0 {
        let reward_per_token = (pool.pending_rewards as u128)
            .checked_mul(PRECISION)
            .ok_or(StakingError::Overflow)?
            .checked_div(pool.total_staked as u128)
            .ok_or(StakingError::DivisionByZero)?;

        pool.rewards_per_token_stored = pool.rewards_per_token_stored
            .checked_add(reward_per_token)
            .ok_or(StakingError::Overflow)?;

        pool.total_distributed = pool.total_distributed
            .checked_add(pool.pending_rewards)
            .ok_or(StakingError::Overflow)?;
    }

    let rewards_added = pool.pending_rewards;
    pool.pending_rewards = 0;
    pool.last_update_epoch = epoch;

    emit!(CumulativeUpdated {
        epoch,
        rewards_added,
        new_cumulative: pool.rewards_per_token_stored,
        total_staked: pool.total_staked,
        slot: clock.slot,
    });

    Ok(())
}
```

### Tax Program CPI to deposit_rewards (Tax Program modification)

```rust
// Source: Tax Program swap_sol_buy.rs modification
// Add after the SOL transfer to staking_escrow

// Tax authority PDA seeds
pub const TAX_AUTHORITY_SEED: &[u8] = b"tax_authority";

// Discriminator: sha256("global:deposit_rewards")[0..8]
const DEPOSIT_REWARDS_DISCRIMINATOR: [u8; 8] = [/* compute with test */];

// After line 118 in swap_sol_buy.rs:
if staking_portion > 0 {
    // First: Transfer SOL (existing code)
    invoke_signed(...)?;

    // Second: CPI to update pending_rewards state
    let tax_authority_seeds: &[&[u8]] = &[
        TAX_AUTHORITY_SEED,
        &[ctx.bumps.tax_authority],
    ];

    let mut ix_data = Vec::with_capacity(16);
    ix_data.extend_from_slice(&DEPOSIT_REWARDS_DISCRIMINATOR);
    ix_data.extend_from_slice(&staking_portion.to_le_bytes());

    let deposit_ix = Instruction {
        program_id: ctx.accounts.staking_program.key(),
        accounts: vec![
            AccountMeta::new_readonly(ctx.accounts.tax_authority.key(), true),
            AccountMeta::new(ctx.accounts.stake_pool.key(), false),
        ],
        data: ix_data,
    };

    invoke_signed(
        &deposit_ix,
        &[
            ctx.accounts.tax_authority.to_account_info(),
            ctx.accounts.stake_pool.to_account_info(),
            ctx.accounts.staking_program.to_account_info(),
        ],
        &[tax_authority_seeds],
    )?;
}
```

### Epoch Program CPI Update (consume_randomness.rs modification)

```rust
// Source: Minimal change - update staking_program ID to real program
// In consume_randomness.rs, the CPI code at lines 209-231 stays the same
// Only change: staking_program account now points to real Staking Program

// In constants.rs - no change needed, already has:
// pub const STAKING_AUTHORITY_SEED: &[u8] = b"staking_authority";
// pub const UPDATE_CUMULATIVE_DISCRIMINATOR: [u8; 8] = [0x93, 0x84, 0xdb, 0x65, 0xa5, 0x17, 0x3d, 0x71];

// The only required change is ensuring the staking_program account
// passed to consume_randomness is the real Staking Program, not stub-staking
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Stub-staking for testing | Real Staking Program everywhere | Phase 27 | No test/prod divergence |
| Manual program ID checks | seeds::program constraint | Anchor 0.24+ | Atomic validation |
| SOL transfer only | SOL transfer + deposit_rewards CPI | Phase 27 | State consistency guaranteed |

**Deprecated/outdated:**
- stub-staking program: Replaced entirely by real Staking Program
- Direct escrow deposits without state update: Now requires deposit_rewards CPI

## Open Questions

Things resolved during research:

1. **Tax Authority Seed Name**
   - Decision needed: What seed should Tax Program use?
   - Recommendation: `b"tax_authority"` (consistent naming pattern)
   - Note: Must be added to Tax Program constants

2. **Escrow SOL Source**
   - Current: User transfers directly to escrow_vault
   - Confirmed: This is correct - deposit_rewards only updates pending_rewards, doesn't move SOL
   - The SOL is already in escrow before CPI happens

3. **Event Content (Claude's Discretion)**
   - Recommendation: Include slot in all events (already in RewardsDeposited, CumulativeUpdated)
   - Caller program ID not needed - already implicit from CPI pattern
   - Delta values included - matches existing event definitions

## Sources

### Primary (HIGH confidence)
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/stub-staking/src/lib.rs` - seeds::program pattern implementation
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/epoch-program/src/instructions/consume_randomness.rs` - CPI to staking pattern
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/staking/src/lib.rs` - Staking Program interface
- `/Users/mlbob/Projects/Dr Fraudsworth/Docs/New_Yield_System_Spec.md` - deposit_rewards and update_cumulative specs
- [Anchor PDA Documentation](https://www.anchor-lang.com/docs/basics/pda) - seeds::program constraint definition

### Secondary (MEDIUM confidence)
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/tax-program/src/instructions/swap_sol_buy.rs` - Current SOL transfer pattern
- [Solana CPI Documentation](https://solana.com/docs/core/cpi) - Cross-program invocation fundamentals

### Tertiary (LOW confidence)
- None - all critical claims verified with codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Using existing Anchor patterns already in codebase
- Architecture: HIGH - Directly adapting proven stub-staking pattern
- Pitfalls: HIGH - Derived from actual codebase analysis and existing test failures

**Research date:** 2026-02-07
**Valid until:** 2026-03-07 (stable patterns, unlikely to change)
