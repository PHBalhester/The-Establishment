# Dr. Fraudsworth's Finance Factory
## Staking Yield Specification

---

## 1. Purpose

This document defines the **Staking Yield System** that delivers SOL rewards to PROFIT stakers.

The system:
- Collects 75% of all SOL taxes into an escrow vault
- Distributes yield pro-rata to staked PROFIT holders
- Uses the battle-tested cumulative reward-per-token pattern
- Requires explicit stake/unstake actions (no passive earning)

**Design philosophy:** Simplicity over magic. Users stake to earn, unstake to exit, claim anytime.

---

## 2. Design Constraints (Hard)

- Only staked PROFIT earns yield
- Instant unstake (no lockup)
- Separate claim instruction (no forced unstake to harvest)
- No CPI integration with swap logic
- All math uses checked arithmetic
- u128 precision for cumulative values
- First-depositor attack mitigation required

---

## 3. Architecture Overview

### 3.1 Pattern: Cumulative Reward Per Token

This is the Synthetix/Quarry pattern, proven across billions in TVL.

**Core formula:**
```
pending = (global_cumulative - user_checkpoint) × user_staked / PRECISION
```

**Key insight:** Instead of tracking rewards per epoch, we track a single monotonically-increasing value representing total yield per token across all time.

### 3.2 Flow Summary

```
Tax Program collects SOL taxes
    ↓
75% deposited to Yield Escrow
    ↓
Epoch ends → pending rewards added to cumulative
    ↓
User claims → receives (cumulative - checkpoint) × balance
    ↓
User checkpoint updated to current cumulative
```

---

## 4. Constants

```rust
/// Precision multiplier for reward calculations.
/// 1e18 is the DeFi standard, provides ~18 decimal places.
pub const PRECISION: u128 = 1_000_000_000_000_000_000;

/// Minimum initial stake to prevent first-depositor attack.
/// Protocol stakes this amount during initialization.
pub const MINIMUM_STAKE: u64 = 1_000_000; // 1 PROFIT (6 decimals)
```

---

## 5. State Accounts

### 5.1 StakePool (Global Singleton)

```rust
#[account]
pub struct StakePool {
    /// Total PROFIT currently staked across all users.
    pub total_staked: u64,
    
    /// Cumulative rewards per staked token, scaled by PRECISION.
    /// This value only increases, never decreases.
    pub rewards_per_token_stored: u128,
    
    /// SOL rewards accumulated this epoch, not yet added to cumulative.
    pub pending_rewards: u64,
    
    /// Last epoch when cumulative was updated.
    pub last_update_epoch: u32,
    
    /// Total SOL distributed lifetime (analytics).
    pub total_distributed: u64,
    
    /// Total SOL claimed lifetime (analytics).
    pub total_claimed: u64,
    
    /// Initialization flag.
    pub initialized: bool,
    
    /// PDA bump.
    pub bump: u8,
}
```

**Size:** 8 + 16 + 8 + 4 + 8 + 8 + 1 + 1 = 54 bytes (+ 8 discriminator = 62 bytes)

**PDA Derivation:**
```
seeds = ["stake_pool"]
program = staking_program
```

### 5.2 EscrowVault

Native SOL account holding undistributed yield.

**PDA Derivation:**
```
seeds = ["escrow_vault"]
program = staking_program
```

### 5.3 StakeVault

Token-2022 account holding all staked PROFIT.

**PDA Derivation:**
```
seeds = ["stake_vault"]
program = staking_program
```

### 5.4 UserStake (Per User)

```rust
#[account]
pub struct UserStake {
    /// Owner of this stake account.
    pub owner: Pubkey,
    
    /// Amount of PROFIT staked.
    pub staked_balance: u64,
    
    /// User's checkpoint of rewards_per_token at last update.
    pub rewards_per_token_paid: u128,
    
    /// Accumulated rewards not yet claimed.
    pub rewards_earned: u64,
    
    /// Total SOL claimed lifetime (analytics).
    pub total_claimed: u64,
    
    /// Slot when user first staked.
    pub first_stake_slot: u64,
    
    /// Slot when user last interacted.
    pub last_update_slot: u64,
    
    /// PDA bump.
    pub bump: u8,
}
```

**Size:** 32 + 8 + 16 + 8 + 8 + 8 + 8 + 1 = 89 bytes (+ 8 discriminator = 97 bytes)

**PDA Derivation:**
```
seeds = ["user_stake", user_pubkey]
program = staking_program
```

---

## 6. Core Math

### 6.1 Update Rewards (Internal Helper)

Called before ANY state change.

```rust
fn update_rewards(
    pool: &mut StakePool,
    user: &mut UserStake,
) -> Result<()> {
    // Step 1: Calculate user's pending rewards
    let reward_delta = pool.rewards_per_token_stored
        .checked_sub(user.rewards_per_token_paid)
        .ok_or(StakingError::Underflow)?;
    
    let pending = (user.staked_balance as u128)
        .checked_mul(reward_delta)
        .ok_or(StakingError::Overflow)?
        .checked_div(PRECISION)
        .ok_or(StakingError::DivisionByZero)? as u64;
    
    // Step 2: Add to user's earned balance
    user.rewards_earned = user.rewards_earned
        .checked_add(pending)
        .ok_or(StakingError::Overflow)?;
    
    // Step 3: Update user's checkpoint
    user.rewards_per_token_paid = pool.rewards_per_token_stored;
    
    // Step 4: Update timestamp
    user.last_update_slot = Clock::get()?.slot;
    
    Ok(())
}
```

### 6.2 Add Rewards to Cumulative

Called at epoch end by Epoch Program.

```rust
fn add_to_cumulative(pool: &mut StakePool) -> Result<()> {
    // Skip if nothing to distribute
    if pool.pending_rewards == 0 {
        return Ok(());
    }
    
    // Skip if no stakers (rewards stay in pending)
    if pool.total_staked == 0 {
        return Ok(());
    }
    
    // Calculate reward per token for this epoch
    let reward_per_token = (pool.pending_rewards as u128)
        .checked_mul(PRECISION)
        .ok_or(StakingError::Overflow)?
        .checked_div(pool.total_staked as u128)
        .ok_or(StakingError::DivisionByZero)?;
    
    // Add to cumulative
    pool.rewards_per_token_stored = pool.rewards_per_token_stored
        .checked_add(reward_per_token)
        .ok_or(StakingError::Overflow)?;
    
    // Track total distributed
    pool.total_distributed = pool.total_distributed
        .checked_add(pool.pending_rewards)
        .ok_or(StakingError::Overflow)?;
    
    // Reset pending
    pool.pending_rewards = 0;
    
    Ok(())
}
```

### 6.3 Precision Analysis

**Overflow check for rewards_per_token_stored (u128):**

Worst case:
- Total SOL supply: 580M SOL = 5.8e17 lamports
- Minimum stake: 1 PROFIT = 1e6 units
- If all SOL distributed to 1 staker: `5.8e17 * 1e18 / 1e6 = 5.8e29`
- u128 max: `3.4e38`

**Verdict:** ~1e9 headroom. Safe for any realistic scenario.

**Rounding:** Division truncates (floors), favoring the protocol. Maximum loss: 1 lamport per claim.

---

## 7. Instructions

### 7.1 initialize_stake_pool

Creates global state. Called once at deployment.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| authority | Signer | Deployer |
| stake_pool | Init PDA | Global state |
| escrow_vault | Init PDA | SOL escrow |
| stake_vault | Init PDA | PROFIT vault |
| profit_mint | Account | PROFIT token mint |
| token_program | Program | Token-2022 |
| system_program | Program | System program |

**Logic:**

```rust
pub fn initialize_stake_pool(ctx: Context<InitializeStakePool>) -> Result<()> {
    let pool = &mut ctx.accounts.stake_pool;
    
    pool.total_staked = 0;
    pool.rewards_per_token_stored = 0;
    pool.pending_rewards = 0;
    pool.last_update_epoch = 0;
    pool.total_distributed = 0;
    pool.total_claimed = 0;
    pool.initialized = true;
    pool.bump = ctx.bumps.stake_pool;
    
    emit!(StakePoolInitialized {
        escrow_vault: ctx.accounts.escrow_vault.key(),
        stake_vault: ctx.accounts.stake_vault.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });
    
    Ok(())
}
```

**First-Depositor Mitigation:**

Protocol should stake `MINIMUM_STAKE` (1 PROFIT) immediately after initialization using protocol-controlled tokens. This prevents the inflation attack where an attacker stakes 1 unit then manipulates the reward rate.

---

### 7.2 stake

Stakes PROFIT to begin earning yield.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| user | Signer | Staker |
| stake_pool | Mut PDA | Global state |
| user_stake | Init-if-needed PDA | User's stake account |
| user_profit_account | Mut | User's PROFIT token account |
| stake_vault | Mut PDA | Pool's PROFIT vault |
| profit_mint | Account | PROFIT mint |
| token_program | Program | Token-2022 |
| system_program | Program | System program |

**Logic:**

```rust
pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
    require!(amount > 0, StakingError::ZeroAmount);
    
    let pool = &mut ctx.accounts.stake_pool;
    let user = &mut ctx.accounts.user_stake;
    let clock = Clock::get()?;
    
    // Initialize user account if new
    if user.staked_balance == 0 && user.rewards_per_token_paid == 0 {
        user.owner = ctx.accounts.user.key();
        user.rewards_per_token_paid = pool.rewards_per_token_stored;
        user.first_stake_slot = clock.slot;
        user.bump = ctx.bumps.user_stake;
    }
    
    // Update rewards BEFORE balance change
    update_rewards(pool, user)?;
    
    // Transfer PROFIT from user to vault
    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.user_profit_account.to_account_info(),
                to: ctx.accounts.stake_vault.to_account_info(),
                mint: ctx.accounts.profit_mint.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
        6, // decimals
    )?;
    
    // Update balances
    user.staked_balance = user.staked_balance
        .checked_add(amount)
        .ok_or(StakingError::Overflow)?;
    
    pool.total_staked = pool.total_staked
        .checked_add(amount)
        .ok_or(StakingError::Overflow)?;
    
    emit!(Staked {
        user: ctx.accounts.user.key(),
        amount,
        new_balance: user.staked_balance,
        total_staked: pool.total_staked,
        slot: clock.slot,
    });
    
    Ok(())
}
```

---

### 7.3 unstake

Withdraws staked PROFIT. Also claims any pending rewards.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| user | Signer, Mut | Staker (receives SOL) |
| stake_pool | Mut PDA | Global state |
| user_stake | Mut PDA | User's stake account |
| user_profit_account | Mut | User's PROFIT token account |
| stake_vault | Mut PDA | Pool's PROFIT vault |
| escrow_vault | Mut PDA | SOL escrow |
| profit_mint | Account | PROFIT mint |
| token_program | Program | Token-2022 |
| system_program | Program | System program |

**Logic:**

```rust
pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
    require!(amount > 0, StakingError::ZeroAmount);
    
    let pool = &mut ctx.accounts.stake_pool;
    let user = &mut ctx.accounts.user_stake;
    let clock = Clock::get()?;
    
    require!(
        user.owner == ctx.accounts.user.key(),
        StakingError::Unauthorized
    );
    
    require!(
        user.staked_balance >= amount,
        StakingError::InsufficientBalance
    );
    
    // Update rewards BEFORE balance change
    update_rewards(pool, user)?;
    
    // Claim any pending rewards
    let rewards_to_claim = user.rewards_earned;
    if rewards_to_claim > 0 {
        // Transfer SOL from escrow to user
        **ctx.accounts.escrow_vault.try_borrow_mut_lamports()? -= rewards_to_claim;
        **ctx.accounts.user.try_borrow_mut_lamports()? += rewards_to_claim;
        
        user.rewards_earned = 0;
        user.total_claimed = user.total_claimed
            .checked_add(rewards_to_claim)
            .ok_or(StakingError::Overflow)?;
        
        pool.total_claimed = pool.total_claimed
            .checked_add(rewards_to_claim)
            .ok_or(StakingError::Overflow)?;
    }
    
    // Transfer PROFIT from vault to user
    let pool_seeds = &[b"stake_pool".as_ref(), &[pool.bump]];
    
    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.stake_vault.to_account_info(),
                to: ctx.accounts.user_profit_account.to_account_info(),
                mint: ctx.accounts.profit_mint.to_account_info(),
                authority: ctx.accounts.stake_pool.to_account_info(),
            },
            &[pool_seeds],
        ),
        amount,
        6,
    )?;
    
    // Update balances
    user.staked_balance = user.staked_balance
        .checked_sub(amount)
        .ok_or(StakingError::Underflow)?;
    
    pool.total_staked = pool.total_staked
        .checked_sub(amount)
        .ok_or(StakingError::Underflow)?;
    
    emit!(Unstaked {
        user: ctx.accounts.user.key(),
        amount,
        rewards_claimed: rewards_to_claim,
        new_balance: user.staked_balance,
        total_staked: pool.total_staked,
        slot: clock.slot,
    });
    
    Ok(())
}
```

---

### 7.4 claim

Claims pending SOL rewards without unstaking.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| user | Signer, Mut | Staker (receives SOL) |
| stake_pool | Mut PDA | Global state |
| user_stake | Mut PDA | User's stake account |
| escrow_vault | Mut PDA | SOL escrow |

**Logic:**

```rust
pub fn claim(ctx: Context<Claim>) -> Result<()> {
    let pool = &mut ctx.accounts.stake_pool;
    let user = &mut ctx.accounts.user_stake;
    let clock = Clock::get()?;
    
    require!(
        user.owner == ctx.accounts.user.key(),
        StakingError::Unauthorized
    );
    
    // Update rewards
    update_rewards(pool, user)?;
    
    let rewards_to_claim = user.rewards_earned;
    
    require!(
        rewards_to_claim > 0,
        StakingError::NothingToClaim
    );
    
    // Verify escrow has sufficient balance
    let escrow_balance = ctx.accounts.escrow_vault.lamports();
    require!(
        escrow_balance >= rewards_to_claim,
        StakingError::InsufficientEscrowBalance
    );
    
    // Transfer SOL from escrow to user
    **ctx.accounts.escrow_vault.try_borrow_mut_lamports()? -= rewards_to_claim;
    **ctx.accounts.user.try_borrow_mut_lamports()? += rewards_to_claim;
    
    // Update state
    user.rewards_earned = 0;
    user.total_claimed = user.total_claimed
        .checked_add(rewards_to_claim)
        .ok_or(StakingError::Overflow)?;
    
    pool.total_claimed = pool.total_claimed
        .checked_add(rewards_to_claim)
        .ok_or(StakingError::Overflow)?;
    
    emit!(Claimed {
        user: ctx.accounts.user.key(),
        amount: rewards_to_claim,
        staked_balance: user.staked_balance,
        total_claimed: user.total_claimed,
        slot: clock.slot,
    });
    
    Ok(())
}
```

---

### 7.5 deposit_rewards

Called by Tax Program to deposit the 75% yield portion.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| tax_authority | Signer | Tax Program PDA |
| stake_pool | Mut PDA | Global state |
| escrow_vault | Mut PDA | SOL escrow |
| source_vault | Mut | Tax Program's SOL vault |
| system_program | Program | System program |

**Logic:**

```rust
pub fn deposit_rewards(ctx: Context<DepositRewards>, amount: u64) -> Result<()> {
    require!(amount > 0, StakingError::ZeroAmount);
    
    // Transfer SOL from tax vault to escrow
    let transfer_ix = system_instruction::transfer(
        &ctx.accounts.source_vault.key(),
        &ctx.accounts.escrow_vault.key(),
        amount,
    );
    invoke_signed(
        &transfer_ix,
        &[
            ctx.accounts.source_vault.to_account_info(),
            ctx.accounts.escrow_vault.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        &[tax_authority_seeds],
    )?;
    
    // Add to pending
    let pool = &mut ctx.accounts.stake_pool;
    pool.pending_rewards = pool.pending_rewards
        .checked_add(amount)
        .ok_or(StakingError::Overflow)?;
    
    emit!(RewardsDeposited {
        amount,
        new_pending: pool.pending_rewards,
    });
    
    Ok(())
}
```

---

### 7.6 update_cumulative

Called by Epoch Program during VRF callback to finalize epoch rewards.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| epoch_state | Account | Current epoch (read) |
| stake_pool | Mut PDA | Global state |

**Logic:**

```rust
pub fn update_cumulative(ctx: Context<UpdateCumulative>) -> Result<()> {
    let pool = &mut ctx.accounts.stake_pool;
    let epoch = ctx.accounts.epoch_state.current_epoch;
    
    // Prevent double-update
    require!(
        epoch > pool.last_update_epoch,
        StakingError::AlreadyUpdated
    );
    
    // Add pending to cumulative
    add_to_cumulative(pool)?;
    
    // Record epoch
    pool.last_update_epoch = epoch;
    
    emit!(CumulativeUpdated {
        epoch,
        rewards_added: pool.pending_rewards,
        new_cumulative: pool.rewards_per_token_stored,
        total_staked: pool.total_staked,
    });
    
    Ok(())
}
```

---

## 8. Edge Cases

### 8.1 Zero Total Staked

**Scenario:** All users unstake, then rewards deposit.

**Handling:** `pending_rewards` accumulates but `rewards_per_token_stored` doesn't update. When someone stakes, rewards are still pending. Next `update_cumulative` distributes to new stakers.

**Implication:** Rewards during zero-stake periods go to whoever stakes next. This is intentional—incentivizes being first to stake.

### 8.2 User Stakes Mid-Epoch

**Scenario:** User stakes 5 minutes before epoch ends.

**Handling:** User's checkpoint set to current cumulative. They earn only from the next `update_cumulative` onward.

**No partial epoch rewards.** Clean and simple.

### 8.3 User Unstakes Partially

**Scenario:** User has 1000 PROFIT staked, unstakes 200.

**Handling:**
1. `update_rewards` calculates earnings for 1000 PROFIT
2. All pending rewards added to `rewards_earned`
3. 200 PROFIT returned
4. User now earns on 800 PROFIT going forward

### 8.4 Rapid Stake/Unstake

**Scenario:** User stakes and unstakes within same epoch.

**Handling:** No rewards earned (checkpoint = cumulative, delta = 0). User just pays gas. Not exploitable.

### 8.5 Claim With Zero Rewards

**Scenario:** User calls claim but has nothing pending.

**Handling:** Instruction fails with `NothingToClaim`. No state change.

---

## 9. Security Considerations

### 9.1 First-Depositor Attack

**Attack:** First staker deposits 1 wei, donates rewards to inflate rate, second staker gets nothing.

**Mitigation:** Protocol stakes `MINIMUM_STAKE` (1 PROFIT) during initialization. This "dead stake" ensures the pool always has meaningful liquidity.

### 9.2 Flash Loan Attack

**Attack:** Borrow PROFIT → stake → claim → unstake → repay.

**Why it fails:**
- Rewards based on `rewards_per_token_stored` at time of stake
- User's checkpoint = current cumulative
- No rewards until NEXT `update_cumulative`
- Same-epoch stake/unstake = zero rewards

### 9.3 Overflow Protection

All arithmetic uses checked operations. Any overflow returns an error rather than wrapping.

### 9.4 Reentrancy

- State updates happen BEFORE external calls (transfers)
- No callbacks from PROFIT transfers (transfer hook only checks whitelist)
- SOL transfers don't invoke user code

### 9.5 Escrow Solvency

**Invariant:** `escrow_balance >= sum(all_users.rewards_earned) + pending_rewards`

**Enforcement:** 
- Only `deposit_rewards` adds SOL to escrow
- Only `claim`/`unstake` removes SOL
- Removal requires `rewards_earned > 0`

### 9.6 Authority Validation

- `stake`: User signs, transfers their own tokens
- `unstake`: User signs, must own the UserStake account
- `claim`: User signs, must own the UserStake account
- `deposit_rewards`: Tax Program PDA must sign
- `update_cumulative`: Permissionless, but epoch must have advanced

---

## 10. Events

```rust
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

#[event]
pub struct RewardsDeposited {
    pub amount: u64,
    pub new_pending: u64,
}

#[event]
pub struct CumulativeUpdated {
    pub epoch: u32,
    pub rewards_added: u64,
    pub new_cumulative: u128,
    pub total_staked: u64,
}
```

---

## 11. Errors

```rust
#[error_code]
pub enum StakingError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    
    #[msg("Insufficient staked balance")]
    InsufficientBalance,
    
    #[msg("Insufficient SOL in escrow")]
    InsufficientEscrowBalance,
    
    #[msg("No rewards to claim")]
    NothingToClaim,
    
    #[msg("Unauthorized: signer does not own this account")]
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

---

## 12. Integration Points

### 12.1 Tax Program

On every taxed SOL pool swap:

```rust
// In tax_program::swap_sol_pool
let tax_amount = calculate_tax(...);
let yield_portion = tax_amount * 75 / 100;

// CPI to staking program
staking_program::cpi::deposit_rewards(cpi_ctx, yield_portion)?;
```

### 12.2 Epoch Program

During VRF callback:

```rust
// In epoch_program::vrf_callback
// After tax updates, before Carnage check

staking_program::cpi::update_cumulative(cpi_ctx)?;
```

### 12.3 Transfer Hook

The stake vault must be whitelisted:

| # | Address | Purpose |
|---|---------|---------|
| 14 | Stake Vault PDA | Receives staked PROFIT |

---

## 13. UI Integration

### 13.1 Display Pending Rewards

```typescript
function getPendingRewards(
    pool: StakePool,
    user: UserStake,
): number {
    const delta = pool.rewardsPerTokenStored - user.rewardsPerTokenPaid;
    const pending = (user.stakedBalance * delta) / PRECISION;
    return (Number(pending) + user.rewardsEarned) / LAMPORTS_PER_SOL;
}
```

### 13.2 Display APY

```typescript
function calculateAPY(
    recentEpochRewards: number[], // Last N epochs
    totalStaked: number,
    op4PriceInSol: number,
): number {
    const avgEpochReward = sum(recentEpochRewards) / recentEpochRewards.length;
    const epochsPerYear = 48 * 365; // 30 min epochs
    const annualRewardSol = avgEpochReward * epochsPerYear;
    const stakedValueSol = totalStaked * op4PriceInSol;
    
    return (annualRewardSol / stakedValueSol) * 100;
}
```

### 13.3 UI States

| State | Display |
|-------|---------|
| Not staked | "Stake PROFIT to earn SOL yield" |
| Staked, no pending | "Staked: X PROFIT • Pending: calculating..." |
| Staked, has pending | "Staked: X PROFIT • Claim Y SOL" |
| After claim | "Claimed! Pending: 0 SOL" |

---

## 14. Initialization Sequence

```
1. Deploy Staking Program

2. Initialize StakePool
   → Creates global state PDA
   → Creates escrow vault PDA
   → Creates stake vault PDA

3. Protocol stakes MINIMUM_STAKE (1 PROFIT)
   → Prevents first-depositor attack
   → This PROFIT is effectively "dead"

4. Add stake vault to Transfer Hook whitelist
   → add_whitelist_entry(stake_vault)

5. Configure Tax Program
   → Set staking_program address
   → Set escrow_vault for deposits

6. Configure Epoch Program
   → Set staking_program for update_cumulative CPI

7. Staking system is live
```

---

## 15. Comparison: Old vs New

| Aspect | Checkpoint Model (Old) | Staking Model (New) |
|--------|------------------------|---------------------|
| Who earns | All PROFIT holders | Only stakers |
| User action to earn | None | Stake once |
| User action to harvest | None (auto) or claim | Claim |
| Account creation | On first PROFIT swap | On first stake |
| CPI on swaps | Every PROFIT swap | None |
| Denominator | Circulating supply (complex) | total_staked (simple) |
| Ghost yield attack | Mitigated via auto-claim | Impossible |
| Implementation complexity | High | Low |
| Lines of spec | ~800 | ~400 |

---

## 16. Invariants Summary

1. **Only stakers earn** — Holding PROFIT without staking earns nothing
2. **Instant unstake** — No lockup period
3. **Claim anytime** — Separate from unstake
4. **Update before change** — Always update rewards before balance change
5. **Cumulative only increases** — Never decreases
6. **Checked arithmetic** — All operations use checked_* methods
7. **Escrow always solvent** — Balance >= sum of all pending rewards
8. **No CPI on swaps** — Staking program is isolated
9. **First-depositor mitigated** — Protocol's initial stake prevents attack
10. **No partial epoch rewards** — Stake earns from next epoch, not current

---

## 17. Testing Requirements

### Unit Tests

| Test | Description | Expected Result |
|------|-------------|-----------------|
| Reward calculation precision | Calculate rewards for various stake amounts and durations | Correct to 6 decimal places (PROFIT decimals) |
| Overflow protection | Attempt calculations that would overflow u128/u64 | Graceful error via checked arithmetic, no panic |
| Stake balance updates | Stake/unstake operations update user and pool state correctly | Balances match expected, total_staked accurate |
| Cumulative index updates | Index increases correctly on reward deposit | `index = old + (rewards * PRECISION / total_staked)` |
| Zero total_staked handling | Deposit rewards when no stakes exist | Rewards stay in pending, cumulative unchanged |
| Update_rewards correctness | Verify reward checkpoint math for varied scenarios | `pending = (global - user_checkpoint) * balance / PRECISION` |
| Partial unstake math | Unstake portion, verify remaining balance earns correctly | Rewards calculated on old balance, then reduced |

### Integration Tests

| Test | Description | Expected Result |
|------|-------------|-----------------|
| Full stake lifecycle | Stake -> wait epoch -> claim -> unstake | Correct rewards, full principal returned |
| Multiple users proportional | 3+ users with different stake amounts | Fair pro-rata rewards distribution |
| Epoch transitions | Stakes across multiple epoch boundaries | Rewards accumulate correctly per epoch |
| Tax deposit flow | Tax Program deposits 75% yield via CPI | Escrow balance increases, pending_rewards updated |
| Claim timing | Claim immediately vs after multiple epochs | Proportional to epochs staked through |
| Deposit then update_cumulative | Full flow: deposit_rewards -> update_cumulative -> claim | Rewards flow from pending to cumulative to user |
| Late staker fairness | Staker joins after many epochs of rewards | Only earns from epoch of stake onward |

### Security Tests

| Test | Description | Expected Result |
|------|-------------|-----------------|
| First-depositor attack | Stake 1 lamport, wait for large deposit, claim | MINIMUM_STAKE prevents attack (protocol stakes 1 PROFIT first) |
| Flash loan attack | Stake and unstake in same epoch | Zero rewards (checkpoint = cumulative, delta = 0) |
| Escrow solvency | Attempt to claim more than escrow holds | Transaction fails with InsufficientEscrowBalance |
| Reentrancy | Attempt reentrant claim via malicious program | State updated before transfers (checks-effects-interactions) |
| Authority validation | Non-Tax-Program calls deposit_rewards | Rejected (PDA signer check) |
| Unauthorized claim | User A tries to claim User B's rewards | Rejected (owner != signer check) |
| Double update_cumulative | Call update_cumulative twice for same epoch | Second call fails with AlreadyUpdated |

### Edge Cases

| Test | Description | Expected Result |
|------|-------------|-----------------|
| Stake at epoch boundary | Stake in last slot of epoch | Attributed to current epoch, earns from next |
| Claim with zero pending | Claim when rewards_earned = 0 | Fails with NothingToClaim |
| Partial unstake | Unstake portion of stake | Remaining stake continues earning correctly |
| Maximum stake | Stake u64::MAX / 2 PROFIT tokens | No overflow in reward calculations (u128 intermediates) |
| Minimum stake | Stake exactly MINIMUM_STAKE (1 PROFIT) | Success, earns proportional rewards |
| All users unstake | Everyone unstakes, then rewards deposited | Rewards accumulate in pending; next staker benefits |
| Tiny rewards | Deposit 1 lamport to large total_staked | Truncates to 0 per user (protocol keeps dust) |

### Stress Tests

| Test | Description | Expected Result |
|------|-------------|-----------------|
| Many stakers | 10,000+ concurrent stakers | No performance degradation in reward math |
| Rapid stake/unstake | Many operations within single epoch | State remains consistent, no rewards leaked |
| Large reward deposits | Maximum realistic reward size (~580M SOL theoretical) | No precision loss (u128 has 1e9 headroom) |
| Long-running cumulative | Simulate 1 year of epoch updates | cumulative_index stays within u128 bounds |