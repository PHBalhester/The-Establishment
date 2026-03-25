# Staking/Yield System Implementation Pitfalls

**Domain:** Cumulative reward-per-token staking on Solana (Anchor + Token-2022 + Native SOL escrow)
**Researched:** 2026-02-06
**Confidence:** HIGH for reward math/first-depositor attacks (verified against spec + ERC4626 literature), MEDIUM for CPI integration pitfalls (verified against existing codebase)

**Context:** This document covers pitfalls specific to BUILDING the Dr. Fraudsworth Staking Program. The existing PITFALLS.md covers AMM implementation pitfalls. This document focuses on the staking/yield system that integrates with the existing protocol.

**Spec Validation:** The current New_Yield_System_Spec.md addresses several known attacks:
- First-depositor attack (MINIMUM_STAKE mitigation)
- Flash loan attack (checkpoint pattern prevents same-epoch arbitrage)
- Overflow (u128 precision, checked arithmetic)
- Reentrancy (CEI pattern, no callbacks)
- Escrow solvency (invariant tracking)

This research validates these mitigations and identifies ADDITIONAL pitfalls not covered in the spec.

---

## Critical Pitfalls

Mistakes that cause fund loss or complete system failure. Severity: CRITICAL.

---

### Pitfall S1: First-Depositor Attack Incomplete Mitigation

**Severity:** CRITICAL -- attacker can steal all subsequent depositor rewards

**What goes wrong:**
The spec requires the protocol to stake `MINIMUM_STAKE` (1 PROFIT = 1e6 units) during initialization to prevent the first-depositor inflation attack. However, this mitigation is INCOMPLETE if:
1. The protocol stake is not done atomically with initialization
2. The MINIMUM_STAKE is too small relative to expected rewards
3. An attacker front-runs the initialization sequence

**Attack vector (if mitigation fails):**
1. Attacker stakes 1 unit (1e-6 PROFIT)
2. Waits for reward deposit (e.g., 1 SOL)
3. `rewards_per_token_stored` jumps to 1e18 (1 SOL * PRECISION / 1 unit)
4. Legitimate user stakes 1000 PROFIT
5. User's checkpoint = 1e18 (the inflated value)
6. Next reward of 1 SOL adds only `1e18 * 1 / 1001` to cumulative
7. Attacker claims ~half the first reward despite minuscule stake

**Why the spec mitigation may still fail:**
- The 1 PROFIT "dead stake" prevents the 1-unit extreme case
- BUT: if the dead stake is not included in `total_staked` correctly, math still breaks
- OR: if initialization and staking are separate transactions, attacker can sandwich

**How to avoid:**

```rust
// CORRECT: Initialization includes the dead stake atomically
pub fn initialize_stake_pool(ctx: Context<InitializeStakePool>) -> Result<()> {
    let pool = &mut ctx.accounts.stake_pool;

    // Initialize state
    pool.total_staked = MINIMUM_STAKE;  // CRITICAL: Start with dead stake
    pool.rewards_per_token_stored = 0;
    // ...

    // Transfer MINIMUM_STAKE from protocol wallet to stake vault
    // This must be in the SAME instruction, not a separate stake() call
    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.protocol_profit_account.to_account_info(),
                to: ctx.accounts.stake_vault.to_account_info(),
                // ...
            },
        ),
        MINIMUM_STAKE,
        6,
    )?;

    Ok(())
}
```

**Also consider virtual shares/offset approach (from OpenZeppelin ERC4626):**
```rust
// Alternative: Virtual share offset (no actual dead stake needed)
pub const VIRTUAL_SHARES: u128 = 1_000_000; // Virtual 1 PROFIT

fn compute_rewards_per_token(pending: u64, total_staked: u64) -> u128 {
    let denominator = (total_staked as u128) + VIRTUAL_SHARES;
    (pending as u128).checked_mul(PRECISION)? / denominator
}
```

**Warning signs:**
- `initialize_stake_pool` and the dead stake transfer are separate instructions
- `total_staked` starts at 0 instead of MINIMUM_STAKE
- No constraint preventing initialization when dead stake is missing
- Tests don't verify behavior when first real staker is tiny

**Phase to address:** Staking Program initialization (FIRST thing to implement correctly)

**Sources:**
- [OpenZeppelin ERC4626 Inflation Attack Defense](https://www.openzeppelin.com/news/a-novel-defense-against-erc4626-inflation-attacks)
- [Euler Finance Exchange Rate Manipulation](https://www.euler.finance/blog/exchange-rate-manipulation-in-erc4626-vaults)

---

### Pitfall S2: Precision Loss in Reward Calculation Favoring Users

**Severity:** CRITICAL -- pool becomes insolvent over many claims

**What goes wrong:**
The cumulative reward pattern uses integer division which truncates. If rounding favors users (rounds UP), each claim extracts slightly more than entitled. Over thousands of claims, the escrow becomes insolvent.

The spec correctly states "Rounding: Division truncates (floors), favoring the protocol." But implementation errors can flip this:

```rust
// WRONG: Adding 1 for "rounding" extracts extra lamports
let pending = ((user.staked_balance as u128)
    .checked_mul(reward_delta)?
    .checked_div(PRECISION)?
    + 1) as u64;  // This 1 drains the pool over time

// WRONG: Using round_up instead of floor
let pending = reward_delta
    .checked_mul(user.staked_balance as u128)?
    .div_ceil(PRECISION) as u64;  // div_ceil rounds UP = bad
```

**Why it happens:**
- "Intuitive" rounding to be "fair" to users
- Copy-paste from fee calculation where rounding UP is correct (protocol takes more)
- Rust's division truncates, but helper functions might not

**How to avoid:**

```rust
// CORRECT: Division truncates toward zero (floors)
let pending = (user.staked_balance as u128)
    .checked_mul(reward_delta)
    .ok_or(StakingError::Overflow)?
    .checked_div(PRECISION)
    .ok_or(StakingError::DivisionByZero)? as u64;
// Truncation means user might lose 1 lamport maximum per claim
// Protocol NEVER loses, escrow stays solvent
```

**Verification invariant:**
```rust
// After every claim, this MUST hold:
let total_claimable = sum_all_users(|u| compute_pending(pool, u));
assert!(escrow.lamports() >= total_claimable + pool.pending_rewards);
```

**Warning signs:**
- Any division that adds 1 or uses ceil/round in reward calculation
- No invariant test checking escrow solvency
- Tests only check "approximately correct" rewards, not exact

**Phase to address:** Staking math module (CRITICAL: get right before any other code)

---

### Pitfall S3: Escrow Solvency Accounting Mismatch

**Severity:** CRITICAL -- users cannot claim rewards, funds locked

**What goes wrong:**
The escrow holds native SOL for user rewards. The spec tracks `pending_rewards` (not yet distributed to cumulative) and implicitly expects `total_claimable` (sum of all user's rewards_earned) to be covered. If these get out of sync:
- Escrow has less SOL than sum of pending claims = users cannot claim
- Escrow has more SOL than tracked = dust accumulates (minor issue)

**Desync scenarios:**
1. **Tax Program deposits but pool.pending_rewards not incremented** (CPI failure mid-instruction)
2. **Cumulative updated twice for same epoch** (double-counting rewards)
3. **User claims but rewards_earned not zeroed** (double-spend)
4. **Epoch advances without update_cumulative** (pending never converted)

**Why it happens:**
- Cross-program invariants are hard to maintain atomically
- The deposit (from Tax Program) and the accounting update are separate CPIs
- Edge cases around epoch boundaries not tested

**How to avoid:**

```rust
// In deposit_rewards: Verify SOL actually arrived
pub fn deposit_rewards(ctx: Context<DepositRewards>, amount: u64) -> Result<()> {
    // Record escrow balance BEFORE
    let escrow_before = ctx.accounts.escrow_vault.lamports();

    // Perform transfer (CPI to System Program)
    // ...

    // VERIFY transfer happened
    let escrow_after = ctx.accounts.escrow_vault.lamports();
    require!(
        escrow_after == escrow_before.checked_add(amount).ok_or(StakingError::Overflow)?,
        StakingError::DepositMismatch
    );

    // THEN update accounting
    pool.pending_rewards = pool.pending_rewards.checked_add(amount)?;
    Ok(())
}

// In claim: Verify SOL transfer happened
pub fn claim(ctx: Context<Claim>) -> Result<()> {
    let rewards = user.rewards_earned;

    // Zero FIRST (CEI pattern)
    user.rewards_earned = 0;

    // THEN transfer
    **ctx.accounts.escrow_vault.try_borrow_mut_lamports()? -= rewards;
    **ctx.accounts.user.try_borrow_mut_lamports()? += rewards;

    // Update global tracking
    pool.total_claimed = pool.total_claimed.checked_add(rewards)?;

    Ok(())
}
```

**Invariant that MUST hold:**
```
escrow.lamports() >=
    sum(all_users.rewards_earned) +
    pool.pending_rewards
```

Where `sum(all_users.rewards_earned)` is computed from:
```
For each user: (pool.rewards_per_token_stored - user.rewards_per_token_paid) * user.staked_balance / PRECISION + user.rewards_earned
```

**Warning signs:**
- No balance verification after CPI transfers
- `rewards_earned` updated AFTER transfer (not before)
- No integration test that checks escrow balance = sum of pending claims
- `update_cumulative` can be called without advancing epoch

**Phase to address:** Staking core logic + integration tests

---

### Pitfall S4: Token-2022 Transfer Hook Blocks Stake/Unstake

**Severity:** CRITICAL -- staking becomes unusable

**What goes wrong:**
PROFIT uses Token-2022 with a transfer hook that enforces whitelist validation. The stake vault PDA MUST be whitelisted (entry #14 in Transfer_Hook_Spec.md). If:
1. The whitelist entry is missing
2. The whitelist entry uses wrong vault address
3. The ExtraAccountMeta accounts are not passed correctly

Then ALL stake/unstake operations fail with transfer hook errors.

**Why it happens:**
- Stake vault PDA is derived during staking program deployment
- Whitelist is populated during transfer hook initialization (different program)
- If deployment order is wrong, vault address not known when whitelist created
- ExtraAccountMeta resolution requires specific accounts in the transaction

**How to avoid:**

Correct deployment sequence:
```
1. Deploy Staking Program
2. Initialize StakePool (creates stake_vault PDA)
3. Record stake_vault address
4. Add to Transfer Hook whitelist: add_whitelist_entry(stake_vault)
5. Verify: attempt test stake, confirm success
```

In stake/unstake instructions, include ALL hook accounts:
```rust
// Remaining accounts must include for PROFIT transfers:
// 1. ExtraAccountMetaList PDA for PROFIT mint
// 2. Whitelist PDA for source (user's PROFIT account or stake_vault)
// 3. Whitelist PDA for destination (stake_vault or user's PROFIT account)
// 4. Transfer hook program

// Forward remaining_accounts to transfer_checked CPI
transfer_checked(
    CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        TransferChecked { /* ... */ },
        &[pool_seeds],
    )
    .with_remaining_accounts(ctx.remaining_accounts.to_vec()),
    amount,
    6,
)?;
```

**Warning signs:**
- Deployment scripts don't verify whitelist entry for stake vault
- stake/unstake instructions don't accept remaining_accounts
- Tests mock the transfer hook instead of using real hook
- "No whitelisted party" errors in integration tests

**Phase to address:** Staking deployment + integration testing

**Source:** Transfer_Hook_Spec.md Section 4, Entry #14

---

### Pitfall S5: Cross-Program Signer Spoofing for deposit_rewards

**Severity:** CRITICAL -- attacker inflates rewards without depositing SOL

**What goes wrong:**
The `deposit_rewards` instruction should ONLY be callable by the Tax Program. If signer validation is incorrect, an attacker could call it directly with fabricated amounts, inflating `pending_rewards` without actually depositing SOL.

**Attack vector:**
1. Attacker calls `deposit_rewards(amount: 1_000_000_000)` (1 SOL)
2. No actual SOL transferred to escrow
3. `pending_rewards` increases by 1 SOL
4. Epoch ends, cumulative updated
5. Attacker claims fake rewards, draining the escrow of real SOL

**Why it happens:**
- Using `AccountInfo` instead of `Signer` for the authority
- Not validating the PDA derivation against Tax Program's ID
- Trust "the caller knows what they're doing" without cryptographic verification

**How to avoid:**

```rust
#[derive(Accounts)]
pub struct DepositRewards<'info> {
    /// Tax Program's deposit authority PDA
    /// CRITICAL: seeds::program enforces this is Tax Program's PDA
    #[account(
        seeds = [b"yield_depositor"],  // Must match Tax Program's derivation
        bump,
        seeds::program = TAX_PROGRAM_ID,  // NOT default (staking program)
    )]
    pub tax_authority: Signer<'info>,  // MUST be Signer

    // ... other accounts
}
```

**Also verify the actual transfer:**
```rust
pub fn deposit_rewards(ctx: Context<DepositRewards>, amount: u64) -> Result<()> {
    // Even with correct signer, verify SOL actually arrived
    let escrow_before = ctx.accounts.escrow_vault.lamports();

    // Tax Program must have already transferred SOL
    // OR: perform CPI transfer here with tax_authority signing

    let escrow_after = ctx.accounts.escrow_vault.lamports();
    require!(
        escrow_after >= escrow_before.checked_add(amount)?,
        StakingError::DepositMismatch
    );

    // Only THEN update accounting
    pool.pending_rewards = pool.pending_rewards.checked_add(amount)?;
    Ok(())
}
```

**Warning signs:**
- `tax_authority` is `AccountInfo` not `Signer`
- Missing `seeds::program = TAX_PROGRAM_ID`
- No balance verification before updating pending_rewards
- Tests call deposit_rewards directly from test wallet

**Phase to address:** Staking instruction design (core security boundary)

**Source:** [Helius: A Hitchhiker's Guide to Solana Program Security](https://www.helius.dev/blog/a-hitchhikers-guide-to-solana-program-security)

---

### Pitfall S6: Epoch Authority Spoofing for update_cumulative

**Severity:** CRITICAL -- attacker can drain rewards early or block distribution

**What goes wrong:**
The `update_cumulative` instruction is called by the Epoch Program during VRF callback. It converts `pending_rewards` into cumulative and makes them claimable. If an attacker can call this:
- **Too early:** Rewards distributed before intended, timing attacks possible
- **Multiple times:** Same rewards counted twice
- **With wrong epoch:** Accounting becomes inconsistent

**Why it happens:**
- Same issue as S5: incorrect authority validation
- The spec shows double-update prevention (`epoch > pool.last_update_epoch`) but authority bypass makes this moot

**How to avoid:**

The existing stub-staking correctly implements this:
```rust
#[account(
    seeds = [STAKING_AUTHORITY_SEED],
    bump,
    seeds::program = epoch_program_id(),  // CRITICAL: Epoch Program's ID
)]
pub epoch_authority: Signer<'info>,
```

Ensure the real staking program mirrors this pattern:
```rust
#[derive(Accounts)]
pub struct UpdateCumulative<'info> {
    /// Epoch Program's staking authority PDA
    #[account(
        seeds = [b"staking_authority"],  // Must match Epoch Program's derivation
        bump,
        seeds::program = EPOCH_PROGRAM_ID,
    )]
    pub epoch_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"stake_pool"],
        bump = stake_pool.bump,
    )]
    pub stake_pool: Account<'info, StakePool>,
}

pub fn handler(ctx: Context<UpdateCumulative>) -> Result<()> {
    let pool = &mut ctx.accounts.stake_pool;
    let epoch = /* from EpochState or instruction data */;

    // CRITICAL: Prevent double-update
    require!(
        epoch > pool.last_update_epoch,
        StakingError::AlreadyUpdated
    );

    // Convert pending to cumulative
    add_to_cumulative(pool)?;

    pool.last_update_epoch = epoch;
    Ok(())
}
```

**Warning signs:**
- `epoch_authority` is not `Signer`
- Missing `seeds::program = EPOCH_PROGRAM_ID`
- No epoch advancement check
- Tests call update_cumulative directly

**Phase to address:** Staking instruction design (core security boundary)

---

## High Pitfalls

Mistakes that cause bugs or economic issues. Severity: HIGH.

---

### Pitfall S7: Native SOL Escrow Below Rent-Exempt Minimum

**Severity:** HIGH -- escrow account garbage collected, all rewards lost

**What goes wrong:**
The escrow vault holds native SOL (not wrapped SOL). PDA accounts must maintain rent-exempt balance to persist. If claims drain the escrow below rent-exempt minimum (~0.00089 SOL), the account can be garbage collected, losing any remaining dust and breaking the system.

**Why it happens:**
- Escrow is just a PDA holding lamports, not a token account
- No minimum balance enforcement in claim logic
- After many claims, balance approaches zero
- System program doesn't prevent draining PDAs

**How to avoid:**

```rust
pub const ESCROW_RENT_RESERVE: u64 = 1_000_000; // 0.001 SOL buffer

pub fn claim(ctx: Context<Claim>) -> Result<()> {
    let rewards = user.rewards_earned;

    // CRITICAL: Verify escrow remains rent-exempt after claim
    let escrow_balance = ctx.accounts.escrow_vault.lamports();
    let rent = Rent::get()?;
    let rent_exempt_minimum = rent.minimum_balance(0); // 0 data bytes for pure SOL holder

    require!(
        escrow_balance.checked_sub(rewards).ok_or(StakingError::Underflow)?
            >= rent_exempt_minimum + ESCROW_RENT_RESERVE,
        StakingError::EscrowBelowMinimum
    );

    // Proceed with claim
    // ...
}
```

**Alternative approach: Over-fund escrow initially**
- During deployment, fund escrow with 0.1 SOL as permanent reserve
- Document that this reserve is non-recoverable
- Simplifies logic but costs 0.1 SOL forever

**Warning signs:**
- Claim has no minimum balance check
- Tests use large deposits that never approach zero
- Escrow created with minimal lamports
- No stress test claiming all rewards

**Phase to address:** Staking claim logic + deployment

**Source:** [Solana: Closing Accounts and Revival Attacks](https://solana.com/developers/courses/program-security/closing-accounts)

---

### Pitfall S8: Checkpoint Not Updated Before Balance Change

**Severity:** HIGH -- users receive incorrect rewards (too many or too few)

**What goes wrong:**
The cumulative reward pattern requires that `update_rewards()` is called BEFORE any change to `staked_balance`. If this order is violated:
- Stake increases BEFORE update: user's old balance earns at new cumulative rate = overpayment
- Stake decreases BEFORE update: user's reduced balance earns at old rate = underpayment

**Example of the bug:**
```rust
// WRONG: Balance changes first
user.staked_balance += amount;  // Now has 1000 PROFIT
update_rewards(pool, user)?;    // Calculates rewards on 1000 PROFIT
// But user only had 500 PROFIT during the reward period!
```

**Why it happens:**
- "Optimization" to avoid two updates
- Anchor's account serialization order can confuse the sequence
- Refactoring moves update_rewards call without considering order

**How to avoid:**

```rust
pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
    let pool = &mut ctx.accounts.stake_pool;
    let user = &mut ctx.accounts.user_stake;

    // STEP 1: Update rewards FIRST (uses old balance)
    update_rewards(pool, user)?;

    // STEP 2: THEN change balance
    user.staked_balance = user.staked_balance.checked_add(amount)?;
    pool.total_staked = pool.total_staked.checked_add(amount)?;

    // STEP 3: Transfer tokens
    transfer_checked(/* ... */)?;

    Ok(())
}
```

**Add an invariant check:**
```rust
fn update_rewards(pool: &StakePool, user: &mut UserStake) -> Result<()> {
    // Calculate pending using CURRENT balance (before any change)
    let pending = compute_pending(pool, user)?;

    // Update earned
    user.rewards_earned = user.rewards_earned.checked_add(pending)?;

    // Sync checkpoint AFTER calculation
    user.rewards_per_token_paid = pool.rewards_per_token_stored;

    Ok(())
}
```

**Warning signs:**
- `staked_balance` modified before `update_rewards` call
- `update_rewards` not called in unstake path
- Missing unit tests for stake/unstake order sensitivity

**Phase to address:** Staking stake/unstake implementation

---

### Pitfall S9: User Account Initialization Race Condition

**Severity:** HIGH -- user loses first-stake rewards or gets stuck

**What goes wrong:**
When a user stakes for the first time, their `UserStake` account is created. The spec uses `Init-if-needed` pattern. Race conditions:
1. Two stake transactions submitted simultaneously
2. First creates account, sets checkpoint
3. Second fails (account exists) or overwrites state

Or more subtle:
1. User stakes, account created
2. User unstakes completely, account balance = 0
3. User re-stakes
4. Checkpoint NOT re-synced to current cumulative
5. User claims rewards from period they weren't staked

**Why it happens:**
- `init_if_needed` is convenient but hides state management
- Code assumes "first stake" means "account doesn't exist"
- But account can exist with zero balance from previous unstake

**How to avoid:**

```rust
pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
    let pool = &mut ctx.accounts.stake_pool;
    let user = &mut ctx.accounts.user_stake;

    // Detect if this is effectively a "new" stake
    // (either new account OR returning from zero balance)
    let is_fresh_stake = user.staked_balance == 0;

    if is_fresh_stake {
        // Sync checkpoint to current cumulative
        // This prevents earning rewards from before this stake
        user.rewards_per_token_paid = pool.rewards_per_token_stored;
        user.first_stake_slot = Clock::get()?.slot;
    } else {
        // Existing stake: update rewards before adding
        update_rewards(pool, user)?;
    }

    // Proceed with stake
    user.staked_balance = user.staked_balance.checked_add(amount)?;
    // ...
}
```

**Warning signs:**
- No special handling for zero-balance re-stake
- `init_if_needed` without considering existing-but-empty accounts
- Tests only cover fresh account creation, not re-staking

**Phase to address:** Staking stake logic

---

### Pitfall S10: CPI Depth Exceeded During Epoch Callback

**Severity:** HIGH -- epoch transitions fail, taxes accumulate but never distribute

**What goes wrong:**
Solana limits CPI depth to 4. The epoch callback chain is:
```
1. [External] Crank bot
2. consume_randomness (Epoch Program)
3. update_cumulative (Staking Program) -- CPI
4. [If staking needs CPI] -- would be depth 4
```

If `update_cumulative` makes any CPI (e.g., logging to another program, cross-program read), it could hit depth 4. Currently the stub implementation has no CPIs, but the real implementation might add them.

**Why it happens:**
- "Just add a CPI call for logging" without considering depth
- Using Anchor's CPI helpers that have hidden CPIs
- Future features added without depth analysis

**How to avoid:**

```rust
// update_cumulative MUST NOT make any CPIs
pub fn update_cumulative(ctx: Context<UpdateCumulative>, epoch: u32) -> Result<()> {
    let pool = &mut ctx.accounts.stake_pool;

    // Validate epoch advancement
    require!(epoch > pool.last_update_epoch, StakingError::AlreadyUpdated);

    // Pure state mutation, NO CPIs
    if pool.pending_rewards > 0 && pool.total_staked > 0 {
        let reward_per_token = (pool.pending_rewards as u128)
            .checked_mul(PRECISION)?
            .checked_div(pool.total_staked as u128)?;

        pool.rewards_per_token_stored = pool.rewards_per_token_stored
            .checked_add(reward_per_token)?;
    }

    pool.total_distributed = pool.total_distributed
        .checked_add(pool.pending_rewards)?;
    pool.pending_rewards = 0;
    pool.last_update_epoch = epoch;

    // Emit event (NOT a CPI, just logs)
    emit!(CumulativeUpdated { epoch, /* ... */ });

    Ok(())
}
```

**Rule: Any instruction callable via CPI should minimize its own CPIs**

**Warning signs:**
- `update_cumulative` contains `invoke` or `invoke_signed` calls
- Using Anchor CPI context builders in update_cumulative
- No CPI depth analysis in documentation

**Phase to address:** Staking update_cumulative design

**Source:** Epoch_State_Machine_Spec.md Section 8.3

---

### Pitfall S11: Stale Account Data After CPI

**Severity:** HIGH -- rewards calculated on outdated state

**What goes wrong:**
After a CPI call (like the Token-2022 transfer in stake/unstake), Anchor's deserialized account data is NOT automatically refreshed. If the logic reads account data after a CPI, it gets stale data.

**Example:**
```rust
pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
    // Transfer tokens (CPI to Token-2022)
    transfer_checked(/* ... */)?;

    // WRONG: stake_vault.amount is still the PRE-transfer value
    require!(
        ctx.accounts.stake_vault.amount >= pool.total_staked,
        StakingError::VaultDesync
    );
    // This check might fail even though transfer succeeded!
}
```

**Why it happens:**
- Anchor deserializes accounts at instruction start
- CPI modifies on-chain state but not the deserialized struct
- Developer assumes "the transfer happened, data is updated"

**How to avoid:**

```rust
// After CPI, reload if you need fresh data
transfer_checked(/* ... */)?;

// CORRECT: Reload the account
ctx.accounts.stake_vault.reload()?;

// Now stake_vault.amount reflects the transfer
require!(
    ctx.accounts.stake_vault.amount >= pool.total_staked,
    StakingError::VaultDesync
);
```

**Better approach: Don't rely on vault balance for logic**
```rust
// Use cached reserves like AMM does
// pool.total_staked IS the authoritative value
// Don't read from stake_vault.amount at all
```

**Warning signs:**
- Reading token account amounts after transfers
- Validation checks that sometimes fail unexpectedly
- Tests pass in isolation but fail in complex scenarios

**Phase to address:** Staking stake/unstake implementation

**Source:** [Helius: A Hitchhiker's Guide to Solana Program Security](https://www.helius.dev/blog/a-hitchhikers-guide-to-solana-program-security)

---

## Medium Pitfalls

Mistakes that cause rework or subtle bugs. Severity: MEDIUM.

---

### Pitfall S12: Zero Total Staked Division

**Severity:** MEDIUM -- pending rewards stuck in limbo

**What goes wrong:**
When `total_staked` is zero, `update_cumulative` cannot compute `reward_per_token` (division by zero). The spec handles this: "rewards stay in pending." But edge cases:
1. Large rewards accumulate during zero-stake period
2. First staker gets ALL accumulated rewards (windfall)
3. If rewards are massive, new staker gains outsized share

**Why it happens:**
- Design decision: rewards during zero-stake go to next staker
- Not a bug per se, but economic behavior users might not expect
- Gaming opportunity: unstake all, wait for large reward deposit, re-stake first

**How to avoid:**

The spec's behavior is intentional but should be documented:
```rust
fn add_to_cumulative(pool: &mut StakePool) -> Result<()> {
    if pool.total_staked == 0 {
        // Rewards stay in pending, distributed to next staker
        // This is INTENTIONAL per spec Section 8.1
        msg!("No stakers, {} lamports pending", pool.pending_rewards);
        return Ok(());
    }

    // Normal distribution
    // ...
}
```

**Consider alternative: Time-decay for pending rewards**
- If no stakers for N epochs, rewards revert to treasury
- Prevents indefinite accumulation

**Warning signs:**
- No logging/events when rewards accumulate during zero-stake
- Tests don't verify zero-stake → re-stake reward distribution
- UI doesn't warn users about pending reward windfall opportunity

**Phase to address:** Documentation + UI considerations

---

### Pitfall S13: Compute Budget Exhaustion on Claim

**Severity:** MEDIUM -- large stakers cannot claim

**What goes wrong:**
The claim instruction reads UserStake and StakePool, computes rewards, transfers SOL. For normal operations this is cheap (~50k CU). But if combined with other operations or complex account constraints, it might exceed limits.

More relevant: If someone adds logging, additional validations, or CPI calls to claim, it can exceed budget.

**Why it happens:**
- "It's just a claim, can't be that expensive"
- Adding defense-in-depth checks without CU analysis
- Tests don't profile compute usage

**How to avoid:**

```rust
// Keep claim MINIMAL
pub fn claim(ctx: Context<Claim>) -> Result<()> {
    // ~10k CU: Account validation (Anchor constraints)
    // ~5k CU: update_rewards calculation
    // ~10k CU: Arithmetic checks
    // ~5k CU: SOL transfer
    // ~5k CU: Event emission
    // Total: ~35k CU - safe margin to 200k

    // DON'T add:
    // - Multiple CPI calls
    // - Loops over user data
    // - String formatting for logs
    // - Reading extra accounts
}
```

**Client should still set compute budget:**
```typescript
const computeIx = ComputeBudgetInstruction.setComputeUnitLimit({
    units: 100_000,
});
transaction.add(computeIx, claimIx);
```

**Warning signs:**
- Claim instruction grows beyond core logic
- No compute profiling in tests
- Intermittent "compute budget exceeded" in production

**Phase to address:** Performance testing

---

### Pitfall S14: Event Spam Enables Log-Based Attacks

**Severity:** MEDIUM -- attackers inflate indexer costs or confuse UIs

**What goes wrong:**
Staking events (Staked, Unstaked, Claimed) are used by indexers and UIs. An attacker can spam stake/unstake with dust amounts to:
1. Flood event logs, overwhelming indexers
2. Create confusing UI states
3. Waste their own SOL on gas (minor deterrent)

**Why it happens:**
- No minimum stake amount enforced
- Events emitted for every operation regardless of size

**How to avoid:**

```rust
pub const MINIMUM_STAKE_AMOUNT: u64 = 100_000; // 0.1 PROFIT

pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
    require!(
        amount >= MINIMUM_STAKE_AMOUNT,
        StakingError::StakeTooSmall
    );
    // ...
}
```

**Consider: Rate-limiting via slot-based cooldowns**
```rust
// UserStake includes:
pub last_stake_slot: u64,

// In stake:
require!(
    clock.slot > user.last_stake_slot + COOLDOWN_SLOTS,
    StakingError::Cooldown
);
```

**Warning signs:**
- No minimum stake amount
- Tests use 1-unit stakes
- No documentation of spam vectors

**Phase to address:** Staking constraints

---

### Pitfall S15: Account Closure Without Proper Cleanup

**Severity:** MEDIUM -- zombie accounts, state inconsistencies

**What goes wrong:**
If a user unstakes completely and their UserStake account is closed (to reclaim rent), but the close isn't done properly:
1. Account lamports returned but data not zeroed
2. Account can be "revived" by sending lamports back
3. Stale data in revived account causes incorrect reward claims

**Why it happens:**
- Using `#[account(close = recipient)]` without understanding implications
- Not zeroing data or setting closed discriminator
- Within-transaction revival attacks

**How to avoid:**

**Option A: Never close UserStake accounts**
```rust
// UserStake is permanent once created
// Users pay ~0.002 SOL rent once, forever
// Simpler, no revival attacks
```

**Option B: Proper closure with discriminator**
```rust
pub fn close_user_stake(ctx: Context<CloseUserStake>) -> Result<()> {
    let user = &ctx.accounts.user_stake;

    require!(user.staked_balance == 0, StakingError::NonZeroBalance);
    require!(user.rewards_earned == 0, StakingError::UnclaimedRewards);

    // Zero all data
    let mut data = user.to_account_info().try_borrow_mut_data()?;
    for byte in data.iter_mut() {
        *byte = 0;
    }

    // Set closed discriminator
    data[..8].copy_from_slice(&CLOSED_ACCOUNT_DISCRIMINATOR);

    // Transfer lamports
    let dest = ctx.accounts.recipient.to_account_info();
    let source = user.to_account_info();
    **dest.try_borrow_mut_lamports()? += **source.lamports.borrow();
    **source.try_borrow_mut_lamports()? = 0;

    Ok(())
}
```

**Warning signs:**
- UserStake uses `#[account(close = ...)]` without additional safety
- No test for account revival attack
- Close happens when rewards_earned > 0

**Phase to address:** Design decision (recommend Option A for simplicity)

**Source:** [Solana: Closing Accounts and Revival Attacks](https://solana.com/developers/courses/program-security/closing-accounts)

---

## Integration Pitfalls

---

### Pitfall S16: Tax Program Deposit and Staking Pool Mismatch

**Severity:** HIGH -- SOL sent to wrong escrow, rewards never distributed

**What goes wrong:**
The Tax Program deposits 75% of SOL taxes to the staking escrow. If the Tax Program is configured with the wrong escrow address:
1. SOL goes to unknown account
2. Staking pool never sees the deposits
3. No rewards to distribute

**Why it happens:**
- Escrow address hardcoded in Tax Program
- Staking Program redeployed with new escrow PDA
- Configuration not updated in Tax Program

**How to avoid:**

**Option A: Derive escrow from known seeds**
```rust
// Both Tax and Staking programs derive escrow the same way
pub fn get_escrow_address() -> Pubkey {
    Pubkey::find_program_address(
        &[b"escrow_vault"],
        &STAKING_PROGRAM_ID,
    ).0
}
```

**Option B: Store escrow in on-chain config**
```rust
// Tax Program reads escrow from TaxConfig account
// Updateable by admin, verified at deposit time
```

**Option C: Staking provides deposit_rewards instruction**
```rust
// Tax Program CPIs into Staking with amount
// Staking handles its own escrow
// (This is the current spec approach)
```

**For Option C, verify the CPI succeeds:**
```rust
// In Tax Program after CPI:
// The CPI return value indicates success
// But also verify escrow balance increased
```

**Warning signs:**
- Escrow address hardcoded in multiple places
- No integration test that verifies end-to-end tax → stake flow
- Config mismatch between Tax and Staking programs

**Phase to address:** Integration testing

---

### Pitfall S17: Epoch Program CPI Order Breaks Invariants

**Severity:** HIGH -- rewards distributed before taxes arrive

**What goes wrong:**
The Epoch Program's `consume_randomness` does:
1. Update taxes
2. CPI to Staking: update_cumulative
3. Check Carnage trigger

If the order is wrong, or if Tax Program deposits happen AFTER update_cumulative:
- Pending rewards from previous epoch not yet deposited
- Cumulative updated with incomplete pending_rewards
- Later tax deposits add to next epoch instead of current

**Why it happens:**
- Timing assumption: all tax deposits happen within the epoch
- But swaps can happen right up to epoch boundary
- Epoch transition might process before final tax deposit

**How to avoid:**

**The spec's timing model:**
- Tax deposits happen during swaps (throughout epoch)
- `pending_rewards` accumulates all epoch
- `update_cumulative` at epoch END converts pending to cumulative

**This is actually correct IF:**
- All swaps within epoch have their tax deposited before epoch ends
- The epoch transition (and update_cumulative) happens AFTER the epoch's last swap

**But realistically:**
- Swap at slot N, epoch ends at slot N+1
- Epoch transition might run before swap's tax_deposit CPI completes
- Race condition

**Mitigation:**
```rust
// In update_cumulative, record the slot
pool.last_cumulative_slot = clock.slot;

// In deposit_rewards, check if deposit is for current or previous epoch
// If deposit arrives after cumulative update, add to NEXT epoch's pending
```

**Warning signs:**
- No slot tracking in staking state
- Tests don't simulate near-boundary swaps
- Rewards seem to "miss" epochs

**Phase to address:** Edge case handling in spec + implementation

---

## Pitfall-to-Phase Mapping

| Pitfall | Severity | Prevention Phase | Verification |
|---------|----------|------------------|--------------|
| S1: First-depositor incomplete | CRITICAL | Initialization design | Test: tiny stake before/after dead stake |
| S2: Precision loss favoring user | CRITICAL | Math module | Property test: escrow >= sum(claimable) |
| S3: Escrow solvency mismatch | CRITICAL | Deposit/claim logic | Integration test: full lifecycle |
| S4: Transfer hook blocks stake | CRITICAL | Deployment sequence | Integration test: stake with real hook |
| S5: deposit_rewards spoofing | CRITICAL | Instruction security | Negative test: direct call fails |
| S6: update_cumulative spoofing | CRITICAL | Instruction security | Negative test: direct call fails |
| S7: Escrow below rent-exempt | HIGH | Claim logic | Stress test: claim to near-zero |
| S8: Checkpoint order violation | HIGH | Stake/unstake logic | Unit test: order sensitivity |
| S9: User account init race | HIGH | Stake logic | Test: zero-balance re-stake |
| S10: CPI depth exceeded | HIGH | update_cumulative design | CPI depth analysis |
| S11: Stale account data | HIGH | Post-CPI logic | Avoid vault balance reads |
| S12: Zero total_staked | MEDIUM | Edge case handling | Test: zero-stake period |
| S13: Compute budget | MEDIUM | Performance testing | CU profiling |
| S14: Event spam | MEDIUM | Minimum stake | Document spam vectors |
| S15: Account closure | MEDIUM | Design decision | Don't close accounts |
| S16: Deposit address mismatch | HIGH | Configuration | Integration test |
| S17: Epoch timing race | HIGH | Edge case handling | Near-boundary tests |

---

## Sources

### Verified Sources (HIGH Confidence)

- **Project Specs:**
  - New_Yield_System_Spec.md -- Cumulative reward pattern, MINIMUM_STAKE, security considerations
  - Transfer_Hook_Spec.md -- Stake vault whitelist entry (#14), ExtraAccountMeta requirements
  - Epoch_State_Machine_Spec.md -- CPI chain: consume_randomness → update_cumulative
  - Tax_Pool_Logic_Spec.md -- 75% staking distribution flow

- **Existing Code:**
  - stub-staking/src/lib.rs -- seeds::program pattern for CPI authority validation
  - epoch-program/consume_randomness.rs -- CPI to staking with staking_authority PDA
  - tax-program/swap_sol_buy.rs -- Tax deposit flow to staking_escrow

- **External (Web-verified):**
  - [OpenZeppelin ERC4626 Inflation Attack Defense](https://www.openzeppelin.com/news/a-novel-defense-against-erc4626-inflation-attacks)
  - [Helius: A Hitchhiker's Guide to Solana Program Security](https://www.helius.dev/blog/a-hitchhikers-guide-to-solana-program-security)
  - [Cantina: Securing Solana Developer's Guide](https://cantina.xyz/blog/securing-solana-a-developers-guide)
  - [Neodyme: Token-2022 Security Pitfalls](https://neodyme.io/en/blog/token-2022/)
  - [Solana: Closing Accounts and Revival Attacks](https://solana.com/developers/courses/program-security/closing-accounts)

### Training Data (MEDIUM Confidence)

- Synthetix/Quarry cumulative reward pattern
- ERC4626 vault security patterns
- Solana CPI depth limits and patterns

### Needs Verification (LOW Confidence)

- Exact compute costs for staking operations (estimates only)
- Bankrun behavior with Token-2022 hooks in staking context
- Edge case timing around epoch boundaries (needs integration testing)

---

**Staking/Yield Pitfalls Research for: Dr. Fraudsworth Finance Factory**
**Researched:** 2026-02-06
**Complements:** PITFALLS.md (AMM implementation pitfalls)
