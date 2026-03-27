> **ARCHIVED - 2026-02-02**
>
> This document describes the OLD yield model (passive yield to all PROFIT holders).
> This model has been replaced by staking-based yield.
>
> **Current spec:** See `Docs/New_Yield_System_Spec.md` for the active yield model.
> **Key difference:** Only staked PROFIT earns yield. Holding alone does not earn.

---

# Dr. Fraudsworth's Finance Factory
## Yield Escrow & Distribution Specification

---

## 1. Purpose

This document defines the **Yield Distribution System** that delivers SOL rewards to OP4 holders.

The yield system:
- Collects 75% of all SOL taxes into an escrow vault
- Tracks cumulative yield-per-OP4 using a checkpoint model
- Auto-claims pending yield on every OP4 balance change
- Allows passive holders to claim manually at any time

This is an **economically critical system**. OP4's value proposition depends entirely on reliable yield distribution.

---

## 2. Design Constraints (Hard)

- No per-epoch accounts (rent-efficient)
- No bitmaps (checkpoint model eliminates double-claim risk)
- Auto-claim on every balance change (prevents ghost yield attack)
- Manual claim always available (for passive holders)
- Claims never expire
- No cranker required for distribution (only for epoch transitions)
- All yield math verifiable on-chain

---

## 3. Architecture Overview

### 3.1 Why Checkpoint Model (Not Merkle)

The protocol has 48 epochs per day. A per-epoch Merkle model would require:
- 17,520 Merkle roots per year
- 17,520 bitmap accounts per year (~1,500 SOL/year in rent)
- Users claiming 17,520 times per year

The checkpoint model eliminates all of this:
- Single global state account
- Per-user account (user pays ~0.002 SOL once)
- Users claim once to collect all pending yield

### 3.2 Core Concept

Instead of tracking "who can claim what for epoch N," we track:
- **Global:** Cumulative yield-per-OP4 across all time
- **Per-user:** The cumulative value when they last claimed

User's pending yield = `(current_cumulative - user_last_cumulative) * user_balance`

### 3.3 Auto-Claim on Balance Change

Every OP4 balance change (buy or sell) triggers an automatic yield claim. This:
- Ensures users always receive earned yield before selling
- Prevents "ghost yield" attack (claiming yield for periods not held)
- Means active traders never need to manually claim

---

## 4. State Accounts

### 4.1 YieldState (Global Singleton)

```rust
#[account]
pub struct YieldState {
    /// Cumulative yield per OP4 token, scaled by 1e18 for precision.
    /// This value only increases, never decreases.
    pub cumulative_yield_per_op4: u128,

    /// Total SOL distributed to date (for analytics/verification).
    pub total_yield_distributed: u64,

    /// SOL accumulated during current epoch, not yet added to cumulative.
    /// Reset to 0 when cumulative is updated.
    pub pending_epoch_yield: u64,

    /// Last epoch when cumulative was updated.
    pub last_update_epoch: u32,

    /// Slot when cumulative was last updated.
    pub last_update_slot: u64,

    /// Initialization flag.
    pub initialized: bool,

    /// PDA bump seed.
    pub bump: u8,
}
```

**Size:** 16 + 8 + 8 + 4 + 8 + 1 + 1 = 46 bytes (+ 8 discriminator = 54 bytes)

**Rent:** ~0.001 SOL (one-time, permanent)

### 4.2 PDA Derivation (YieldState)

```
seeds = ["yield_state"]
program = yield_program
```

Single global account.

### 4.3 EscrowVault (SOL Holder)

```
seeds = ["yield_escrow_vault"]
program = yield_program
```

This is a native SOL account (SystemAccount) controlled by the yield program PDA.

**Holds:** All undistributed yield SOL

### 4.4 UserYieldAccount (Per User)

```rust
#[account]
pub struct UserYieldAccount {
    /// Owner of this yield account.
    pub owner: Pubkey,

    /// Cumulative yield-per-OP4 value at last claim/checkpoint.
    /// Used to calculate pending yield.
    pub last_claimed_cumulative: u128,

    /// Total SOL claimed by this user (lifetime, for analytics).
    pub total_claimed: u64,

    /// Epoch when user last claimed (for analytics).
    pub last_claim_epoch: u32,

    /// PDA bump seed.
    pub bump: u8,
}
```

**Size:** 32 + 16 + 8 + 4 + 1 = 61 bytes (+ 8 discriminator = 69 bytes)

**Rent:** ~0.002 SOL (paid by user on first OP4 purchase)

### 4.5 PDA Derivation (UserYieldAccount)

```
seeds = ["user_yield", user_pubkey]
program = yield_program
```

One account per OP4 holder.

---

## 5. Yield Flow

### 5.1 Collection (During Swaps)

```
User executes SOL pool swap
    -> Tax Program calculates tax
    -> Tax Program splits tax:
        -> 75% -> Yield Escrow Vault
        -> 24% -> Carnage Fund
        -> 1%  -> Treasury
    -> Yield Program increments pending_epoch_yield
```

### 5.2 Cumulative Update (During VRF Callback)

```
Epoch ends, VRF callback executes
    -> Read circulating OP4 supply
    -> Calculate: yield_per_op4 = pending_epoch_yield / circulating
    -> Add to cumulative: cumulative += yield_per_op4 (scaled)
    -> Reset: pending_epoch_yield = 0
    -> Record: last_update_epoch, last_update_slot
```

### 5.3 Auto-Claim (During Swaps)

```
User executes any OP4-involving swap
    -> Before swap executes:
        -> Calculate pending = (cumulative - user_last) * user_balance
        -> Transfer pending SOL from escrow to user
        -> Update user_last = cumulative
    -> Swap executes (balance changes)
```

### 5.4 Manual Claim (Standalone)

```
User calls claim_yield instruction
    -> Calculate pending = (cumulative - user_last) * current_balance
    -> Transfer pending SOL from escrow to user
    -> Update user_last = cumulative
```

---

## 6. Math Specification

### 6.1 Constants

```rust
/// Precision multiplier for yield-per-OP4 calculations.
/// Using 1e18 provides sufficient precision for any realistic yield amount.
pub const YIELD_PRECISION: u128 = 1_000_000_000_000_000_000; // 1e18

/// Total OP4 supply (fixed, never changes).
pub const TOTAL_OP4_SUPPLY: u64 = 50_000_000_000_000; // 50M with 6 decimals
```

### 6.2 Circulating Supply Calculation

```rust
fn calculate_circulating_op4(
    ipa_op4_vault_balance: u64,
    ipb_op4_vault_balance: u64,
) -> u64 {
    TOTAL_OP4_SUPPLY - ipa_op4_vault_balance - ipb_op4_vault_balance
}
```

**Circulating** = Total supply minus OP4 held in pool vaults.

Pool vaults are excluded because:
- They represent protocol-owned liquidity
- Distributing yield to pools would be circular
- Only user-held OP4 should earn yield

### 6.3 Cumulative Update Formula

```rust
fn update_cumulative(
    yield_state: &mut YieldState,
    epoch_yield_lamports: u64,
    circulating_op4: u64,
) {
    if circulating_op4 == 0 {
        // Edge case: all OP4 in pools
        // Yield stays in escrow, captured next epoch
        yield_state.pending_epoch_yield = 0;
        return;
    }

    // Scale yield by precision, then divide by circulating
    let yield_per_op4: u128 = (epoch_yield_lamports as u128 * YIELD_PRECISION)
        / circulating_op4 as u128;

    // Add to cumulative (monotonically increasing)
    yield_state.cumulative_yield_per_op4 += yield_per_op4;

    // Track total distributed
    yield_state.total_yield_distributed += epoch_yield_lamports;

    // Reset pending
    yield_state.pending_epoch_yield = 0;
}
```

### 6.4 Pending Yield Calculation

```rust
fn calculate_pending_yield(
    cumulative_yield_per_op4: u128,
    user_last_claimed_cumulative: u128,
    user_op4_balance: u64,
) -> u64 {
    if user_op4_balance == 0 {
        return 0;
    }

    let cumulative_delta = cumulative_yield_per_op4 - user_last_claimed_cumulative;

    // Multiply by balance, then divide by precision
    let pending: u128 = (cumulative_delta * user_op4_balance as u128) / YIELD_PRECISION;

    // Safe to cast: result is in lamports, bounded by escrow balance
    pending as u64
}
```

### 6.5 Precision Analysis

**Question:** Is u128 with 1e18 scaling sufficient?

**Worst case cumulative growth:**
- Maximum possible SOL: ~580M SOL total supply
- If entire SOL supply were distributed as yield per OP4...
- `580M SOL * 1e9 (lamports) * 1e18 (precision) / 50M OP4`
- = `5.8e17 * 1e18 / 5e13`
- = `1.16e22`
- u128 max: `3.4e38`

**Verdict:** u128 provides ~10^16 times more headroom than needed. Overflow impossible.

**Rounding:**
- Final division by YIELD_PRECISION rounds down
- Maximum rounding loss: 1 lamport per claim
- Acceptable

---

## 7. Instructions

### 7.1 initialize_yield_state

Initializes the global yield state at protocol deployment.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| authority | Signer | Deployer (one-time) |
| yield_state | Init PDA | Global yield state |
| escrow_vault | Init PDA | SOL escrow vault |
| system_program | Program | System program |

**Logic:**

```rust
pub fn initialize_yield_state(ctx: Context<InitializeYieldState>) -> Result<()> {
    let yield_state = &mut ctx.accounts.yield_state;

    yield_state.cumulative_yield_per_op4 = 0;
    yield_state.total_yield_distributed = 0;
    yield_state.pending_epoch_yield = 0;
    yield_state.last_update_epoch = 0;
    yield_state.last_update_slot = Clock::get()?.slot;
    yield_state.initialized = true;
    yield_state.bump = ctx.bumps.yield_state;

    emit!(YieldStateInitialized {
        slot: yield_state.last_update_slot,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
```

**Callable:** Once, at deployment.

---

### 7.2 deposit_yield

Called by Tax Program to deposit the 75% yield portion during swaps.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| tax_program_signer | Signer | Tax Program PDA |
| yield_state | Mut PDA | Global yield state |
| escrow_vault | Mut PDA | SOL escrow vault |
| source_vault | Mut | Tax Program's SOL vault |
| system_program | Program | System program |

**Logic:**

```rust
pub fn deposit_yield(ctx: Context<DepositYield>, amount: u64) -> Result<()> {
    require!(amount > 0, YieldError::ZeroAmount);

    // Transfer SOL from tax program vault to escrow
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
        &[tax_program_seeds],
    )?;

    // Increment pending yield
    let yield_state = &mut ctx.accounts.yield_state;
    yield_state.pending_epoch_yield = yield_state.pending_epoch_yield
        .checked_add(amount)
        .ok_or(YieldError::Overflow)?;

    emit!(YieldDeposited {
        amount,
        new_pending_total: yield_state.pending_epoch_yield,
    });

    Ok(())
}
```

**Callable:** By Tax Program only, on every taxed swap.

---

### 7.3 update_cumulative

Called during VRF callback to finalize epoch yield into cumulative.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| epoch_state | Account | Read current epoch number |
| yield_state | Mut PDA | Global yield state |
| ipa_op4_pool_vault | Account | IPA/OP4 pool's OP4 vault |
| ipb_op4_pool_vault | Account | IPB/OP4 pool's OP4 vault |

**Logic:**

```rust
pub fn update_cumulative(ctx: Context<UpdateCumulative>) -> Result<()> {
    let yield_state = &mut ctx.accounts.yield_state;
    let epoch_state = &ctx.accounts.epoch_state;
    let clock = Clock::get()?;

    // Prevent double-update in same epoch
    require!(
        epoch_state.current_epoch > yield_state.last_update_epoch,
        YieldError::AlreadyUpdatedThisEpoch
    );

    // Calculate circulating supply
    let vault_a_balance = get_token_balance(&ctx.accounts.ipa_op4_pool_vault)?;
    let vault_b_balance = get_token_balance(&ctx.accounts.ipb_op4_pool_vault)?;
    let circulating = calculate_circulating_op4(vault_a_balance, vault_b_balance);

    // Get pending yield for this epoch
    let epoch_yield = yield_state.pending_epoch_yield;

    // Calculate yield per OP4 (handle zero circulating edge case)
    let yield_per_op4: u128 = if circulating > 0 && epoch_yield > 0 {
        (epoch_yield as u128 * YIELD_PRECISION) / circulating as u128
    } else {
        0
    };

    // Update cumulative
    let old_cumulative = yield_state.cumulative_yield_per_op4;
    yield_state.cumulative_yield_per_op4 = yield_state.cumulative_yield_per_op4
        .checked_add(yield_per_op4)
        .ok_or(YieldError::Overflow)?;

    // Track total distributed
    yield_state.total_yield_distributed = yield_state.total_yield_distributed
        .checked_add(epoch_yield)
        .ok_or(YieldError::Overflow)?;

    // Reset pending
    yield_state.pending_epoch_yield = 0;

    // Record update
    yield_state.last_update_epoch = epoch_state.current_epoch;
    yield_state.last_update_slot = clock.slot;

    emit!(CumulativeUpdated {
        epoch: epoch_state.current_epoch,
        epoch_yield,
        circulating,
        yield_per_op4,
        old_cumulative,
        new_cumulative: yield_state.cumulative_yield_per_op4,
        slot: clock.slot,
    });

    Ok(())
}
```

**Callable:** By Epoch Program during VRF callback.

---

### 7.4 claim_yield

Standalone instruction for passive holders to claim pending yield.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| user | Signer | Claimant |
| yield_state | Account | Global yield state (read) |
| user_yield_account | Mut PDA | User's yield tracking account |
| user_op4_account | Account | User's OP4 token account |
| escrow_vault | Mut PDA | SOL escrow vault |
| system_program | Program | System program |

**Logic:**

```rust
pub fn claim_yield(ctx: Context<ClaimYield>) -> Result<()> {
    let yield_state = &ctx.accounts.yield_state;
    let user_account = &mut ctx.accounts.user_yield_account;
    let clock = Clock::get()?;

    // Verify ownership
    require!(
        user_account.owner == ctx.accounts.user.key(),
        YieldError::Unauthorized
    );

    // Get user's current OP4 balance
    let user_balance = get_token_balance(&ctx.accounts.user_op4_account)?;

    // Calculate pending yield
    let pending = calculate_pending_yield(
        yield_state.cumulative_yield_per_op4,
        user_account.last_claimed_cumulative,
        user_balance,
    );

    // Transfer if non-zero
    if pending > 0 {
        // Verify escrow has sufficient balance
        let escrow_balance = ctx.accounts.escrow_vault.lamports();
        require!(
            escrow_balance >= pending,
            YieldError::InsufficientEscrowBalance
        );

        // Transfer SOL from escrow to user
        **ctx.accounts.escrow_vault.try_borrow_mut_lamports()? -= pending;
        **ctx.accounts.user.try_borrow_mut_lamports()? += pending;

        // Update user stats
        user_account.total_claimed = user_account.total_claimed
            .checked_add(pending)
            .ok_or(YieldError::Overflow)?;
    }

    // Update checkpoint (always, even if zero claim)
    user_account.last_claimed_cumulative = yield_state.cumulative_yield_per_op4;
    user_account.last_claim_epoch = yield_state.last_update_epoch;

    emit!(YieldClaimed {
        user: ctx.accounts.user.key(),
        amount: pending,
        user_balance,
        old_checkpoint: user_account.last_claimed_cumulative - (yield_state.cumulative_yield_per_op4 - user_account.last_claimed_cumulative),
        new_checkpoint: user_account.last_claimed_cumulative,
        epoch: user_account.last_claim_epoch,
    });

    Ok(())
}
```

**Callable:** By any user with a UserYieldAccount.

---

### 7.5 create_user_yield_account

Creates a yield tracking account for a new OP4 holder.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| user | Signer, Mut | Account owner, pays rent |
| yield_state | Account | Global yield state (read) |
| user_yield_account | Init PDA | New user yield account |
| system_program | Program | System program |

**Logic:**

```rust
pub fn create_user_yield_account(ctx: Context<CreateUserYieldAccount>) -> Result<()> {
    let yield_state = &ctx.accounts.yield_state;
    let user_account = &mut ctx.accounts.user_yield_account;

    user_account.owner = ctx.accounts.user.key();
    user_account.last_claimed_cumulative = yield_state.cumulative_yield_per_op4;
    user_account.total_claimed = 0;
    user_account.last_claim_epoch = yield_state.last_update_epoch;
    user_account.bump = ctx.bumps.user_yield_account;

    emit!(UserYieldAccountCreated {
        user: ctx.accounts.user.key(),
        starting_cumulative: user_account.last_claimed_cumulative,
        epoch: user_account.last_claim_epoch,
    });

    Ok(())
}
```

**Callable:** By any user, typically integrated into first OP4 purchase.

---

### 7.6 claim_yield_cpi (For Tax Program Integration)

Internal CPI handler for auto-claim during swaps. Creates account if needed.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| user | Signer, Mut | Swapper |
| yield_state | Account | Global yield state |
| user_yield_account | Init-if-needed PDA | User's yield account |
| user_op4_account | Account | User's OP4 token account |
| escrow_vault | Mut PDA | SOL escrow vault |
| system_program | Program | System program |

**Logic:**

```rust
pub fn claim_yield_cpi(ctx: Context<ClaimYieldCpi>) -> Result<()> {
    let yield_state = &ctx.accounts.yield_state;
    let user_account = &mut ctx.accounts.user_yield_account;

    // If account was just created, checkpoint is already current
    // (init_if_needed sets last_claimed_cumulative = current)
    if user_account.last_claimed_cumulative == yield_state.cumulative_yield_per_op4 {
        // New account or already up-to-date, nothing to claim
        return Ok(());
    }

    // Get user's current OP4 balance (BEFORE the swap changes it)
    let user_balance = get_token_balance(&ctx.accounts.user_op4_account)?;

    // Calculate and transfer pending yield
    let pending = calculate_pending_yield(
        yield_state.cumulative_yield_per_op4,
        user_account.last_claimed_cumulative,
        user_balance,
    );

    if pending > 0 {
        let escrow_balance = ctx.accounts.escrow_vault.lamports();
        require!(
            escrow_balance >= pending,
            YieldError::InsufficientEscrowBalance
        );

        **ctx.accounts.escrow_vault.try_borrow_mut_lamports()? -= pending;
        **ctx.accounts.user.try_borrow_mut_lamports()? += pending;

        user_account.total_claimed = user_account.total_claimed
            .checked_add(pending)
            .ok_or(YieldError::Overflow)?;
    }

    // Update checkpoint
    user_account.last_claimed_cumulative = yield_state.cumulative_yield_per_op4;
    user_account.last_claim_epoch = yield_state.last_update_epoch;

    emit!(YieldAutoClaimed {
        user: ctx.accounts.user.key(),
        amount: pending,
        user_balance,
        trigger: "swap".to_string(),
    });

    Ok(())
}
```

**Callable:** By Tax Program via CPI, on every swap involving OP4.

---

## 8. Integration Points

### 8.1 Tax Program Integration

The Tax Program must call the Yield Program at two points:

**1. Deposit yield (on every taxed swap):**

```rust
// In tax_program::swap_sol_pool
let tax_amount = calculate_tax(...);
let yield_portion = tax_amount * 75 / 100;

// CPI to yield program
let deposit_cpi = CpiContext::new_with_signer(
    ctx.accounts.yield_program.to_account_info(),
    DepositYield {
        tax_program_signer: ctx.accounts.tax_authority.to_account_info(),
        yield_state: ctx.accounts.yield_state.to_account_info(),
        escrow_vault: ctx.accounts.escrow_vault.to_account_info(),
        source_vault: ctx.accounts.tax_vault.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
    },
    signer_seeds,
);
yield_program::cpi::deposit_yield(deposit_cpi, yield_portion)?;
```

**2. Auto-claim (on every swap involving OP4):**

```rust
// In tax_program::swap (before AMM swap executes)
// Only for swaps where user's OP4 balance will change

let claim_cpi = CpiContext::new_with_signer(
    ctx.accounts.yield_program.to_account_info(),
    ClaimYieldCpi {
        user: ctx.accounts.user.to_account_info(),
        yield_state: ctx.accounts.yield_state.to_account_info(),
        user_yield_account: ctx.accounts.user_yield_account.to_account_info(),
        user_op4_account: ctx.accounts.user_op4_account.to_account_info(),
        escrow_vault: ctx.accounts.escrow_vault.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
    },
    signer_seeds,
);
yield_program::cpi::claim_yield_cpi(claim_cpi)?;

// Now execute AMM swap
amm_program::cpi::swap(...)?;
```

### 8.2 Epoch Program Integration

The Epoch Program must call `update_cumulative` during VRF callback:

```rust
// In epoch_program::vrf_callback, after tax updates

let update_cpi = CpiContext::new(
    ctx.accounts.yield_program.to_account_info(),
    UpdateCumulative {
        epoch_state: ctx.accounts.epoch_state.to_account_info(),
        yield_state: ctx.accounts.yield_state.to_account_info(),
        ipa_op4_pool_vault: ctx.accounts.ipa_op4_vault.to_account_info(),
        ipb_op4_pool_vault: ctx.accounts.ipb_op4_vault.to_account_info(),
    },
);
yield_program::cpi::update_cumulative(update_cpi)?;
```

### 8.3 Account Setup During First Purchase

When a user first buys OP4, the Tax Program should ensure their UserYieldAccount exists:

```rust
// In tax_program::swap (buy OP4 direction)

#[account(
    init_if_needed,
    payer = user,
    space = 8 + UserYieldAccount::SIZE,
    seeds = [b"user_yield", user.key().as_ref()],
    bump,
)]
pub user_yield_account: Account<'info, UserYieldAccount>,
```

The `init_if_needed` pattern automatically:
- Creates the account if it doesn't exist (user pays rent)
- Uses existing account if it already exists
- Sets initial `last_claimed_cumulative` to current value (via CPI)

---

## 9. Errors

```rust
#[error_code]
pub enum YieldError {
    #[msg("Yield state not initialized")]
    NotInitialized,

    #[msg("Yield state already initialized")]
    AlreadyInitialized,

    #[msg("Cumulative already updated for this epoch")]
    AlreadyUpdatedThisEpoch,

    #[msg("Zero amount not allowed")]
    ZeroAmount,

    #[msg("Arithmetic overflow")]
    Overflow,

    #[msg("Insufficient balance in escrow vault")]
    InsufficientEscrowBalance,

    #[msg("Unauthorized: signer does not own this account")]
    Unauthorized,

    #[msg("Invalid OP4 token account")]
    InvalidOp4Account,

    #[msg("User yield account does not exist")]
    UserAccountNotFound,
}
```

---

## 10. Events

```rust
#[event]
pub struct YieldStateInitialized {
    pub slot: u64,
    pub timestamp: i64,
}

#[event]
pub struct YieldDeposited {
    pub amount: u64,
    pub new_pending_total: u64,
}

#[event]
pub struct CumulativeUpdated {
    pub epoch: u32,
    pub epoch_yield: u64,
    pub circulating: u64,
    pub yield_per_op4: u128,
    pub old_cumulative: u128,
    pub new_cumulative: u128,
    pub slot: u64,
}

#[event]
pub struct YieldClaimed {
    pub user: Pubkey,
    pub amount: u64,
    pub user_balance: u64,
    pub old_checkpoint: u128,
    pub new_checkpoint: u128,
    pub epoch: u32,
}

#[event]
pub struct YieldAutoClaimed {
    pub user: Pubkey,
    pub amount: u64,
    pub user_balance: u64,
    pub trigger: String,
}

#[event]
pub struct UserYieldAccountCreated {
    pub user: Pubkey,
    pub starting_cumulative: u128,
    pub epoch: u32,
}
```

---

## 11. Security Analysis

### 11.1 Attack: Flash Loan Balance Inflation

**Attack:** Borrow OP4 -> claim yield -> repay OP4

**Why it fails:** Transfer hooks block wallet-to-wallet transfers. To "borrow" OP4, attacker must:
1. Buy from pool (pays 1% LP fee + 1-14% tax)
2. Claim yield
3. Sell back to pool (pays 1% LP fee + 1-14% tax)

Round-trip cost: 4-30% of principal. Yield per epoch: tiny fraction of TVL. Deeply unprofitable.

### 11.2 Attack: Ghost Yield (CRITICAL - MITIGATED)

**Attack:** User sells OP4 -> waits -> rebuys -> claims yield for period not held.

**Why it fails:** Auto-claim on every balance change. When user sells:
1. Pending yield is claimed using OLD balance (before sell)
2. Checkpoint updated to current cumulative
3. Sell executes

When user rebuys:
1. Pending = (current_cumulative - checkpoint) * 0 = 0 (their balance was 0)
2. Checkpoint updated
3. Buy executes
4. Future yield calculated from rebuy point forward

**No yield for periods not held.**

### 11.3 Attack: Sandwich Cumulative Update

**Attack:** Buy OP4 before cumulative update -> capture yield -> sell after

**Quantifying:**
- Epoch yield: ~10 SOL (example)
- Attacker buys 1M OP4 (4% of circulating)
- Trading friction: ~5+ SOL (LP fees + taxes)
- Yield captured: ~0.4 SOL

**Net loss.** Trading friction >> yield capture.

### 11.4 Attack: Claim Without Holding

**Attack:** Create UserYieldAccount for address with no OP4.

**Result:** `pending = delta * 0 = 0`. Attacker pays rent, gets nothing.

### 11.5 Attack: Double Claim

**Attack:** Claim twice in same epoch.

**Why it fails:** After first claim, `user_last_cumulative = current_cumulative`. Second claim: `delta = 0`, so `pending = 0`.

### 11.6 Edge Case: Zero Circulating Supply

**Scenario:** All OP4 held in pool vaults.

**Handling:** `yield_per_op4 = 0` for that epoch. SOL remains in escrow. When OP4 eventually returns to circulation, future epochs distribute normally. The "lost" epoch's yield stays in escrow indefinitely (effectively increases future epochs' distributions slightly when balance is drawn down).

### 11.7 Edge Case: User Sells Before Claiming

**Scenario:** User holds 1000 OP4 for 30 days, never claims, sells all.

**What happens:**
1. Auto-claim triggers on sell
2. `pending = (current - last) * 1000` (their balance BEFORE sell)
3. They receive full pending yield
4. Then sell executes

**Users always receive earned yield before selling.** This is the core guarantee.

### 11.8 Failure: Cumulative Update Missed

**Scenario:** VRF callback fails to call `update_cumulative`.

**Impact:** That epoch's yield stays in `pending_epoch_yield`. Next epoch's update will include both epochs' yield in a single cumulative bump.

**No yield lost**, just batched.

### 11.9 Failure: Escrow Drains Below Claims

**Scenario:** More SOL claimed than escrow holds (should be impossible).

**Cause:** Bug in math or unauthorized withdrawal.

**Handling:** Claim instruction checks `escrow_balance >= pending`. Returns `InsufficientEscrowBalance` error. Claim fails atomically, no partial state.

**Detection:** Monitor for this event. If it fires, investigate immediately.

---

## 12. Initialization Sequence

Complete initialization order:

```
1. Deploy Yield Program

2. Initialize YieldState
   -> Creates global state PDA
   -> Creates escrow vault PDA
   -> cumulative = 0, pending = 0

3. Configure Tax Program
   -> Set yield_program address
   -> Set escrow_vault address

4. Configure Epoch Program
   -> Set yield_program address for CPI

5. (No authority to burn - yield program has no admin functions)

6. Yield system is live
   -> Deposits begin accumulating on first swap
   -> Cumulative updates begin on first VRF callback
```

---

## 13. Testing Requirements

### 13.1 Unit Tests

**Math correctness:**
- Cumulative calculation at various yield/circulating ratios
- Pending calculation at various delta/balance combinations
- Precision: verify no significant rounding errors
- Edge: zero balance, zero yield, zero circulating

**State transitions:**
- YieldState updates correctly on deposit
- YieldState updates correctly on cumulative update
- UserYieldAccount updates correctly on claim

### 13.2 Integration Tests

**Happy path:**
- Initialize yield state
- Deposit yield (multiple deposits)
- Update cumulative (multiple epochs)
- Manual claim (user with balance)
- Auto-claim on swap (buy direction)
- Auto-claim on swap (sell direction)

**Multi-user:**
- Multiple users claim same epoch
- Users with different balances receive proportional yield
- User creates account mid-protocol (starts from current cumulative)

**Epoch progression:**
- 10 epochs with varying yield amounts
- Verify cumulative grows monotonically
- Verify per-user claims are correct across epochs

### 13.3 Negative Tests

- Claim with no UserYieldAccount (fails or creates)
- Claim with zero OP4 balance (succeeds with 0 transfer)
- Double-claim same epoch (second claim = 0)
- Deposit zero amount (fails)
- Update cumulative twice same epoch (fails)
- Claim more than escrow balance (fails)

### 13.4 Attack Simulation

- Simulate ghost yield attack: sell, wait, rebuy, claim
  - Verify yield = 0 for gap period
- Simulate flash loan attack: buy, claim, sell
  - Verify net loss due to fees
- Simulate sandwich attack: buy before update, sell after
  - Verify net loss due to fees

### 13.5 Stress Tests

**High volume:**
- 1000 claims in single epoch
- 10,000 deposits in single epoch
- Verify compute units stay reasonable

**Long duration:**
- Simulate 1 year of epochs (17,520)
- Verify cumulative doesn't overflow
- Verify precision remains adequate

---

## 14. UI Integration

### 14.1 Displaying Pending Yield

```typescript
async function getPendingYield(
    connection: Connection,
    userPubkey: PublicKey,
): Promise<{ pending: number; lastClaimEpoch: number }> {
    const yieldState = await fetchYieldState(connection);
    const userAccount = await fetchUserYieldAccount(connection, userPubkey);
    const userOp4Balance = await getTokenBalance(connection, userOp4Account);

    if (!userAccount) {
        return { pending: 0, lastClaimEpoch: 0 };
    }

    const delta = yieldState.cumulativeYieldPerOp4 - userAccount.lastClaimedCumulative;
    const pending = (delta * BigInt(userOp4Balance)) / YIELD_PRECISION;

    return {
        pending: Number(pending) / LAMPORTS_PER_SOL,
        lastClaimEpoch: userAccount.lastClaimEpoch,
    };
}
```

### 14.2 Displaying Yield Rate

```typescript
function calculateApy(
    recentEpochYields: number[],  // Last N epochs
    circulatingOp4: number,
    op4PriceInSol: number,
): number {
    const avgEpochYield = recentEpochYields.reduce((a, b) => a + b, 0) / recentEpochYields.length;
    const epochsPerYear = 48 * 365;  // ~17,520
    const annualYieldSol = avgEpochYield * epochsPerYear;
    const circulatingValueSol = circulatingOp4 * op4PriceInSol;

    return (annualYieldSol / circulatingValueSol) * 100;
}
```

### 14.3 Claim Button States

| State | Display |
|-------|---------|
| No UserYieldAccount | "Create Yield Account" (user pays ~0.002 SOL) |
| Pending > 0 | "Claim X.XXX SOL" |
| Pending = 0 | "No pending yield" (disabled) |
| No OP4 balance | "Hold OP4 to earn yield" |

### 14.4 Auto-Claim Notification

When user swaps and auto-claim triggers:

```
"Swap complete! Also claimed 0.0234 SOL in pending yield."
```

---

## 15. Future Considerations

### 15.1 Multi-Sig Root Publication (Not Implemented)

Current design has no Merkle roots, but if future governance wanted additional verification:

- Could add optional Merkle root publication as a verification layer
- Would not replace checkpoint model, just augment it
- Useful if on-chain math is ever questioned

### 15.2 Yield Boost Mechanisms (Not Implemented)

Future governance could add:

- Lock OP4 for boosted yield multiplier
- Time-weighted yield (longer hold = higher rate)

Would require modifications to UserYieldAccount structure.

### 15.3 Cross-Epoch Claim Batching (Not Needed)

With checkpoint model, this is automatic. Single claim catches all pending yield regardless of epochs elapsed.

---

## 16. Invariants Summary

1. **Cumulative only increases** - Never decreases, monotonically growing
2. **Auto-claim before balance change** - Users always receive earned yield before selling
3. **No ghost yield** - Cannot claim for periods not held
4. **Claims never expire** - Pending yield accumulates indefinitely
5. **No per-epoch storage** - Single global state, per-user accounts only
6. **User pays own rent** - ~0.002 SOL one-time, not protocol expense
7. **No cranker for distribution** - Only for epoch transitions
8. **Escrow always solvent** - Sum of pending claims <= escrow balance (by construction)
9. **Precision sufficient** - u128 with 1e18 scaling, no practical overflow risk
10. **Double-claim impossible** - Checkpoint model prevents by construction
