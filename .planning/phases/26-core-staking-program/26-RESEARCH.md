# Phase 26: Core Staking Program - Research

**Researched:** 2026-02-06
**Domain:** Solana staking program, cumulative reward-per-token math, Token-2022 PDA vaults
**Confidence:** HIGH

## Summary

Phase 26 implements a standalone staking program where users stake PROFIT tokens to earn SOL rewards. The research covers three primary domains: (1) the Synthetix/Quarry cumulative reward-per-token pattern for fair pro-rata distribution, (2) Anchor patterns for Token-2022 PDA vaults with transfer_checked CPI, and (3) security mitigations for first-depositor inflation attacks.

This project already has comprehensive specifications in `Docs/New_Yield_System_Spec.md` covering account structures, instruction logic, and math formulas. The stub-staking program from Phase 24 provides the CPI interface template. The research validates these designs against industry patterns and documents implementation guidance.

The Synthetix cumulative reward-per-token pattern is battle-tested across billions in TVL. It uses a monotonically-increasing global accumulator (`rewards_per_token_stored`) and per-user checkpoints (`rewards_per_token_paid`) to calculate pending rewards without iterating over all users. This matches the spec's MATH-01/MATH-02 requirements exactly.

**Primary recommendation:** Implement the staking program following `Docs/New_Yield_System_Spec.md` exactly, using project-established patterns from AMM (math.rs checked arithmetic, transfers.rs Token-2022 CPI) and stub-staking (CPI gating via `seeds::program`).

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| anchor-lang | 0.32.1 | Solana program framework | Project standard, PDA constraints, emit! |
| anchor-spl | 0.32.1 | Token interface types | token_interface::transfer_checked |
| spl-token-2022 | 7.0+ | Token-2022 program ID | PROFIT uses Token-2022 extensions |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| solana-program | 2.0+ | System instruction, Clock | SOL transfers, timestamp |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| emit!() | emit_cpi!() | emit!() simpler, emit_cpi!() more robust for truncation; use emit!() per project pattern |
| Manual CPI | Anchor CPI | Manual gives more control, Anchor cleaner; project uses manual pattern |

**No new dependencies required.** Phase 26 uses the same stack already in workspace. The staking program replaces stub-staking in Cargo.toml workspace members.

## Architecture Patterns

### Recommended Project Structure
```
programs/
└── staking/                           # New program (replaces stub-staking)
    └── src/
        ├── lib.rs                     # Entry point + instruction handlers
        ├── state/
        │   ├── mod.rs                 # State module exports
        │   ├── stake_pool.rs          # StakePool global singleton
        │   └── user_stake.rs          # UserStake per-user account
        ├── instructions/
        │   ├── mod.rs                 # Instruction module exports
        │   ├── initialize_stake_pool.rs
        │   ├── stake.rs
        │   ├── unstake.rs
        │   └── claim.rs
        ├── helpers/
        │   ├── mod.rs                 # Helper module exports
        │   ├── math.rs                # update_rewards, add_to_cumulative
        │   └── transfers.rs           # Token-2022 transfer helpers
        ├── constants.rs               # PRECISION, MINIMUM_STAKE, seeds
        ├── errors.rs                  # StakingError enum
        └── events.rs                  # Event structs
```

### Pattern 1: Cumulative Reward-Per-Token (Synthetix Pattern)
**What:** Track a single monotonically-increasing `rewards_per_token_stored` value representing total yield per token across all time. Each user stores a checkpoint of this value at their last interaction.
**When to use:** Any staking/farming system with continuous rewards and changing stake balances.
**Example:**
```rust
// Source: Synthetix StakingRewards.sol pattern, adapted for Solana
// https://rareskills.io/post/staking-algorithm

pub const PRECISION: u128 = 1_000_000_000_000_000_000; // 1e18

/// Update user's pending rewards based on global cumulative.
/// MUST be called before any balance change.
fn update_rewards(pool: &mut StakePool, user: &mut UserStake) -> Result<()> {
    // Calculate delta since user's last checkpoint
    let reward_delta = pool.rewards_per_token_stored
        .checked_sub(user.rewards_per_token_paid)
        .ok_or(StakingError::Underflow)?;

    // pending = balance * delta / PRECISION
    let pending = (user.staked_balance as u128)
        .checked_mul(reward_delta)
        .ok_or(StakingError::Overflow)?
        .checked_div(PRECISION)
        .ok_or(StakingError::DivisionByZero)? as u64;

    // Accumulate to user's earned (don't transfer yet)
    user.rewards_earned = user.rewards_earned
        .checked_add(pending)
        .ok_or(StakingError::Overflow)?;

    // Update user's checkpoint to current global
    user.rewards_per_token_paid = pool.rewards_per_token_stored;

    // Update timestamp
    user.last_update_slot = Clock::get()?.slot;

    Ok(())
}
```

**Why this pattern works:**
1. O(1) complexity per operation - no iteration over users
2. Works with changing stake balances - delta only covers time user was staked
3. Handles late joiners correctly - checkpoint set to current cumulative
4. Flash loan resistant - stake/unstake same epoch = zero delta

### Pattern 2: Token-2022 PDA Vault with Signer Seeds
**What:** Create a token account owned by a PDA, enabling program-signed transfers.
**When to use:** Any vault that holds user tokens (staking, escrow, pool liquidity).
**Example:**
```rust
// Source: programs/amm/src/helpers/transfers.rs pattern
// Stake vault authority pattern

/// Transfer PROFIT from stake_vault to user (unstake).
/// Pool PDA signs via signer_seeds.
fn transfer_from_vault<'info>(
    token_program: &AccountInfo<'info>,
    stake_vault: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    user_token_account: &AccountInfo<'info>,
    pool: &AccountInfo<'info>,  // Pool PDA is vault authority
    amount: u64,
    pool_bump: u8,
    hook_accounts: &[AccountInfo<'info>],
) -> Result<()> {
    let pool_seeds: &[&[u8]] = &[b"stake_pool", &[pool_bump]];

    let cpi_accounts = TransferChecked {
        from: stake_vault.clone(),
        mint: mint.clone(),
        to: user_token_account.clone(),
        authority: pool.clone(),  // Pool PDA signs
    };

    let cpi_ctx = CpiContext::new_with_signer(
        token_program.clone(),
        cpi_accounts,
        &[pool_seeds],
    ).with_remaining_accounts(hook_accounts.to_vec());

    token_interface::transfer_checked(cpi_ctx, amount, 6)  // 6 decimals
}
```

### Pattern 3: First-Depositor Attack Mitigation via Dead Stake
**What:** Protocol stakes MINIMUM_STAKE (1 PROFIT) at initialization, making this stake unclaimable ("dead").
**When to use:** Any vault/pool with share-based accounting or per-token reward math.
**Example:**
```rust
// Source: ERC-4626 inflation attack mitigation pattern
// https://blog.blockmagnates.com/how-to-mitigate-share-inflation-vulnerabilities

pub const MINIMUM_STAKE: u64 = 1_000_000; // 1 PROFIT (6 decimals)

/// Initialize stake pool with dead stake.
/// Protocol transfers MINIMUM_STAKE from authority's token account.
pub fn initialize_stake_pool(ctx: Context<InitializeStakePool>) -> Result<()> {
    let pool = &mut ctx.accounts.stake_pool;

    // Initialize pool state
    pool.total_staked = 0;
    pool.rewards_per_token_stored = 0;
    pool.pending_rewards = 0;
    pool.initialized = true;
    pool.bump = ctx.bumps.stake_pool;

    // Transfer MINIMUM_STAKE from authority to vault (dead stake)
    transfer_to_vault(/* ... */, MINIMUM_STAKE)?;

    // Update total - this stake is never claimable
    pool.total_staked = MINIMUM_STAKE;

    emit!(StakePoolInitialized { /* ... */ });
    Ok(())
}
```

**Why dead stake prevents attacks:**
- Attacker cannot be first depositor (protocol already staked)
- 1 PROFIT dead stake means ~1M units in denominator
- Maximum reward-per-token manipulation requires donating >1M SOL
- Attack becomes economically infeasible

### Pattern 4: Checks-Effects-Interactions (CEI)
**What:** Update all state BEFORE external calls (transfers).
**When to use:** All instructions that transfer tokens or SOL.
**Example:**
```rust
// Source: Solana security best practices
// https://www.zealynx.io/blogs/solana-security-checklist

pub fn claim(ctx: Context<Claim>) -> Result<()> {
    let pool = &mut ctx.accounts.stake_pool;
    let user = &mut ctx.accounts.user_stake;

    // === CHECKS ===
    require!(user.owner == ctx.accounts.user.key(), StakingError::Unauthorized);
    update_rewards(pool, user)?;
    require!(user.rewards_earned > 0, StakingError::NothingToClaim);

    // === EFFECTS (before transfer) ===
    let rewards_to_claim = user.rewards_earned;
    user.rewards_earned = 0;  // Clear BEFORE transfer
    user.total_claimed = user.total_claimed.checked_add(rewards_to_claim)?;
    pool.total_claimed = pool.total_claimed.checked_add(rewards_to_claim)?;

    // === INTERACTIONS (external calls) ===
    // Transfer SOL from escrow to user
    **ctx.accounts.escrow_vault.try_borrow_mut_lamports()? -= rewards_to_claim;
    **ctx.accounts.user.try_borrow_mut_lamports()? += rewards_to_claim;

    emit!(Claimed { /* ... */ });
    Ok(())
}
```

### Anti-Patterns to Avoid
- **Integer division before multiplication:** Always multiply first (`a * b / c` not `a / c * b`) to preserve precision
- **Unchecked arithmetic:** All operations must use `checked_add/sub/mul/div` - Solana compute is cheap, overflow protection is mandatory
- **State update after transfer:** Reentrancy-like bugs - always update state before external calls
- **Saturating arithmetic in reward math:** `saturating_*` hides precision loss - use `checked_*` and return error instead

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Pro-rata reward distribution | Custom tracking per epoch | Cumulative reward-per-token | O(1) vs O(n), handles edge cases |
| Token-2022 transfers | Manual instruction building | anchor_spl::token_interface | Hook account handling |
| Overflow protection | Rely on release mode panic | checked_* on every operation | Explicit error handling |
| PDA authority validation | Manual pubkey comparison | Anchor seeds constraints | Compile-time verification |
| First-depositor protection | Minimum deposit checks | Dead stake at initialization | Cannot be circumvented |

**Key insight:** The spec in `New_Yield_System_Spec.md` already defines the correct patterns. Phase 26 implements them; no novel solutions needed.

## Common Pitfalls

### Pitfall 1: Forgetting update_rewards Before Balance Change
**What goes wrong:** User's pending rewards calculated on NEW balance, causing loss or theft.
**Why it happens:** Easy to add stake/unstake logic without calling update_rewards first.
**How to avoid:** Every instruction that touches staked_balance MUST call update_rewards first. Add integration test that stakes, waits, stakes more, then claims - verify first stake earned correctly.
**Warning signs:** Users earn more/less than expected after additional stakes.

### Pitfall 2: Division Truncation Creating Insolvency
**What goes wrong:** Rounding errors accumulate, escrow runs out of SOL before all users claim.
**Why it happens:** Each claim rounds down; with many small claims, escrow can be drained.
**How to avoid:** Division always truncates (floors), favoring protocol. PRECISION constant (1e18) minimizes per-claim loss to <1 lamport. Add invariant test: sum of all claims <= total deposited.
**Warning signs:** InsufficientEscrowBalance errors on valid claims.

### Pitfall 3: Zero Total Staked Division
**What goes wrong:** `add_to_cumulative` divides by total_staked, panics on zero.
**Why it happens:** All users unstake, then rewards deposited.
**How to avoid:** Dead stake ensures total_staked >= MINIMUM_STAKE always. If somehow zero (bug), skip cumulative update - rewards stay in pending.
**Warning signs:** DivisionByZero errors during epoch transitions.

### Pitfall 4: Stake Vault Not Whitelisted
**What goes wrong:** User tries to stake, transfer_checked fails with hook rejection.
**Why it happens:** PROFIT has transfer hook requiring whitelist. Stake vault PDA not added.
**How to avoid:** Add stake vault to Transfer Hook whitelist during initialization sequence. Document in deployment checklist.
**Warning signs:** "Transfer blocked by hook" errors on stake instruction.

### Pitfall 5: Partial Unstake Below Minimum
**What goes wrong:** User unstakes to remaining 0.5 PROFIT, below MINIMUM_STAKE.
**Why it happens:** Partial unstake validation missing.
**How to avoid:** Per CONTEXT.md: if remaining < MINIMUM_STAKE after unstake, auto-full-unstake instead. Add validation: `if remaining < MINIMUM_STAKE && remaining > 0 { amount = staked_balance }`.
**Warning signs:** Dust positions that cannot be unstaked.

### Pitfall 6: CPI Depth Exceeded with Complex Staking
**What goes wrong:** Staking instruction chains CPIs beyond 5-level limit.
**Why it happens:** stake -> token-2022 -> hook = 3 levels per transfer.
**How to avoid:** Staking instructions are simple: one token transfer. No complex CPI chains. Verify: stake(1) -> transfer_checked(2) -> hook(3) = 3 levels, safe.
**Warning signs:** "Max invoke stack height reached" error.

## Code Examples

Verified patterns from project codebase and official sources:

### Account Structures
```rust
// Source: Docs/New_Yield_System_Spec.md Sections 5.1-5.4

/// StakePool global singleton.
/// Seeds: ["stake_pool"]
#[account]
pub struct StakePool {
    pub total_staked: u64,              // 8 bytes
    pub rewards_per_token_stored: u128, // 16 bytes
    pub pending_rewards: u64,           // 8 bytes
    pub last_update_epoch: u32,         // 4 bytes
    pub total_distributed: u64,         // 8 bytes (analytics)
    pub total_claimed: u64,             // 8 bytes (analytics)
    pub initialized: bool,              // 1 byte
    pub bump: u8,                       // 1 byte
}
// Total: 54 bytes + 8 discriminator = 62 bytes

impl StakePool {
    pub const LEN: usize = 8 + 8 + 16 + 8 + 4 + 8 + 8 + 1 + 1;
}

/// UserStake per-user account.
/// Seeds: ["user_stake", user_pubkey]
#[account]
pub struct UserStake {
    pub owner: Pubkey,                  // 32 bytes
    pub staked_balance: u64,            // 8 bytes
    pub rewards_per_token_paid: u128,   // 16 bytes
    pub rewards_earned: u64,            // 8 bytes
    pub total_claimed: u64,             // 8 bytes (analytics)
    pub first_stake_slot: u64,          // 8 bytes (analytics)
    pub last_update_slot: u64,          // 8 bytes
    pub bump: u8,                       // 1 byte
}
// Total: 89 bytes + 8 discriminator = 97 bytes

impl UserStake {
    pub const LEN: usize = 8 + 32 + 8 + 16 + 8 + 8 + 8 + 8 + 1;
}
```

### Error Enum
```rust
// Source: Project error patterns + SEC-01 requirements

#[error_code]
pub enum StakingError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,

    #[msg("Insufficient staked balance. Current: {0}, Requested: {1}")]
    InsufficientBalance,

    #[msg("Insufficient SOL in escrow. Available: {0}, Requested: {1}")]
    InsufficientEscrowBalance,

    #[msg("No rewards to claim")]
    NothingToClaim,

    #[msg("Unauthorized: signer does not own this stake account")]
    Unauthorized,

    #[msg("Arithmetic overflow")]
    Overflow,

    #[msg("Arithmetic underflow")]
    Underflow,

    #[msg("Division by zero")]
    DivisionByZero,

    #[msg("Cumulative already updated for this epoch")]
    AlreadyUpdated,

    #[msg("Pool not initialized")]
    NotInitialized,

    #[msg("Pool already initialized")]
    AlreadyInitialized,
}
```

### Event Structures
```rust
// Source: Docs/New_Yield_System_Spec.md Section 10 + project patterns

#[event]
pub struct StakePoolInitialized {
    pub escrow_vault: Pubkey,
    pub stake_vault: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct Staked {
    pub user: Pubkey,
    pub amount: u64,
    pub new_balance: u64,
    pub total_staked: u64,
    pub slot: u64,
}

#[event]
pub struct Unstaked {
    pub user: Pubkey,
    pub amount: u64,
    pub rewards_claimed: u64,
    pub new_balance: u64,
    pub total_staked: u64,
    pub slot: u64,
}

#[event]
pub struct Claimed {
    pub user: Pubkey,
    pub amount: u64,
    pub staked_balance: u64,
    pub total_claimed: u64,
    pub slot: u64,
}
```

### Constants
```rust
// Source: Docs/New_Yield_System_Spec.md Section 4

/// Precision multiplier for reward calculations.
/// 1e18 is the DeFi standard, provides ~18 decimal places.
pub const PRECISION: u128 = 1_000_000_000_000_000_000;

/// Minimum initial stake to prevent first-depositor attack.
/// Protocol stakes this amount during initialization.
pub const MINIMUM_STAKE: u64 = 1_000_000; // 1 PROFIT (6 decimals)

/// PDA seeds.
pub const STAKE_POOL_SEED: &[u8] = b"stake_pool";
pub const USER_STAKE_SEED: &[u8] = b"user_stake";
pub const ESCROW_VAULT_SEED: &[u8] = b"escrow_vault";
pub const STAKE_VAULT_SEED: &[u8] = b"stake_vault";

/// Staking authority PDA seed (for Epoch Program CPI verification).
/// Must match Epoch Program's constant.
pub const STAKING_AUTHORITY_SEED: &[u8] = b"staking_authority";
```

### Math Module
```rust
// Source: Docs/New_Yield_System_Spec.md Section 6

use crate::constants::PRECISION;
use crate::errors::StakingError;
use anchor_lang::prelude::*;

/// Update user's pending rewards.
/// MUST be called before any staked_balance change.
pub fn update_rewards(
    pool: &mut StakePool,
    user: &mut UserStake,
) -> Result<()> {
    let reward_delta = pool.rewards_per_token_stored
        .checked_sub(user.rewards_per_token_paid)
        .ok_or(StakingError::Underflow)?;

    let pending = (user.staked_balance as u128)
        .checked_mul(reward_delta)
        .ok_or(StakingError::Overflow)?
        .checked_div(PRECISION)
        .ok_or(StakingError::DivisionByZero)? as u64;

    user.rewards_earned = user.rewards_earned
        .checked_add(pending)
        .ok_or(StakingError::Overflow)?;

    user.rewards_per_token_paid = pool.rewards_per_token_stored;
    user.last_update_slot = Clock::get()?.slot;

    Ok(())
}

/// Add pending rewards to cumulative.
/// Called by Epoch Program via CPI at epoch end.
pub fn add_to_cumulative(pool: &mut StakePool) -> Result<()> {
    if pool.pending_rewards == 0 {
        return Ok(()); // Nothing to distribute
    }

    if pool.total_staked == 0 {
        return Ok(()); // No stakers - rewards stay pending
    }

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

    pool.pending_rewards = 0;

    Ok(())
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-epoch reward tracking | Cumulative reward-per-token | Synthetix 2019 | O(1) operations |
| Manual share calculation | 1e18 PRECISION constant | DeFi standard ~2020 | Cross-platform compatibility |
| Plain transfer | transfer_checked | SPL Token 2022 | Hook support, decimal validation |
| Admin key authorization | PDA seed verification | Anchor standard | Trustless access control |

**Deprecated/outdated:**
- Plain `transfer` CPI: Bypasses Token-2022 hooks, use `transfer_checked`
- u64 precision for cumulative: Use u128 to avoid overflow over long timelines
- Saturating arithmetic: Use checked_* for explicit error handling

## Open Questions

Things that couldn't be fully resolved, left to Claude's discretion per CONTEXT.md:

1. **UserStake account closure**
   - What we know: Users may want to close account to reclaim rent
   - Options: (a) Allow close when balance=0, (b) Keep account forever
   - Recommendation: Allow close if staked_balance=0 AND rewards_earned=0. Return rent to user. Add closeable account logic.

2. **Total users tracking**
   - What we know: Analytics might want total staker count
   - Options: (a) Track in StakePool, (b) Count off-chain via events
   - Recommendation: Track in StakePool with total_users field. Increment on first stake, decrement on full unstake. Simple, useful for UI.

3. **Stake instruction auto-claim behavior**
   - What we know: update_rewards accumulates earnings, but doesn't transfer
   - Options: (a) Checkpoint only (user must call claim), (b) Auto-claim first
   - Recommendation: Checkpoint only. Simpler, matches spec. User explicitly claims when ready.

4. **Claim minimum threshold**
   - What we know: Very small claims waste gas
   - Options: (a) Any amount, (b) Minimum threshold (e.g., 1000 lamports)
   - Recommendation: Any amount. Let users claim dust if they want. No artificial barriers.

5. **Event format**
   - What we know: emit!() vs emit_cpi!() for robustness
   - Options: (a) emit!() per project pattern, (b) emit_cpi!() for truncation protection
   - Recommendation: emit!() - consistent with project, simpler. If truncation becomes issue, revisit.

## Sources

### Primary (HIGH confidence)
- `/Users/mlbob/Projects/Dr Fraudsworth/Docs/New_Yield_System_Spec.md` - Complete staking specification
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/stub-staking/src/lib.rs` - CPI interface pattern (update_cumulative)
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/amm/src/helpers/math.rs` - Checked arithmetic patterns
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/amm/src/helpers/transfers.rs` - Token-2022 transfer patterns
- `/Users/mlbob/Projects/Dr Fraudsworth/.planning/phases/24-staking-integration/24-RESEARCH.md` - CPI gating patterns
- [RareSkills: Synthetix Staking Algorithm](https://rareskills.io/post/staking-algorithm) - Cumulative reward pattern
- [Anchor Events Documentation](https://www.anchor-lang.com/docs/features/events) - Event emission patterns

### Secondary (MEDIUM confidence)
- [Solana PDA Documentation](https://solana.com/docs/core/pda) - PDA derivation best practices
- [Solana Transfer Hook Guide](https://solana.com/developers/guides/token-extensions/transfer-hook) - Token-2022 hook patterns
- [BlockMagnates: ERC-4626 Inflation Attack](https://blog.blockmagnates.com/how-to-mitigate-share-inflation-vulnerabilities-of-erc-4626-compliant-vault-contracts-5328f82b0917) - First-depositor attack mitigation

### Tertiary (LOW confidence)
- [Sec3: Overflow/Underflow in Solana](https://www.sec3.dev/blog/understanding-arithmetic-overflow-underflows-in-rust-and-solana-smart-contracts) - General Solana arithmetic security

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Uses existing project dependencies, no new crates
- Architecture patterns: HIGH - Synthetix pattern is battle-tested, project patterns established
- Math module: HIGH - Spec provides exact formulas, verified against Synthetix reference
- Pitfalls: HIGH - Based on real DeFi exploits and project-specific integration points
- Code examples: HIGH - Derived from spec and existing codebase

**Research date:** 2026-02-06
**Valid until:** 2026-03-06 (30 days - stable domain, patterns well-established)
