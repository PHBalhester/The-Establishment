# Carnage System Bug Investigation & Fix Proposals

**Date:** 2026-02-14
**Status:** Pending team decisions
**Scope:** All Carnage execution paths, MEV analysis, audit cross-reference

---

## 1. Executive Summary

Five issues have been identified in the Carnage execution system. Two were already fixed by the debugger session (WSOL wrapping, held_amount tracking). Three remain open and require code changes + one design question about zero slippage.

| # | Issue | Severity | Status | Fix Complexity |
|---|-------|----------|--------|----------------|
| 1 | REG-001: Burn mint AccountInfo missing | CRITICAL | Open | Medium (struct change) |
| 2 | Sell-path wrong-pool (held != target) | HIGH | Open | Low (3-line guard) |
| 3 | Only one mint available in struct | HIGH | Open | Medium (mint_b -> crime_mint + fraud_mint) |
| 4 | WSOL wrapping missing | CRITICAL | Fixed | Done (debugger) |
| 5 | held_amount tracks input not output | HIGH | Fixed | Done (debugger) |
| 6 | Zero slippage on Carnage swaps (H064) | DESIGN | Discussion needed | See Section 5 |

Issues 1-3 share a root cause: the instruction struct assumes the held token always matches the target. It doesn't -- VRF picks target independently of what's held.

---

## 2. Bug Details

### 2.1 REG-001: Burn Mint AccountInfo Missing in invoke_signed

**Files:**
- `programs/epoch-program/src/instructions/execute_carnage_atomic.rs:407-414`
- `programs/epoch-program/src/instructions/execute_carnage.rs:418-425`

**What happens:**
The `burn_held_tokens` function builds a burn instruction referencing the mint Pubkey in its AccountMeta:

```rust
let burn_ix = Instruction {
    accounts: vec![
        AccountMeta::new(vault.key(), false),        // account to burn from
        AccountMeta::new(mint, false),               // mint <-- referenced here
        AccountMeta::new_readonly(carnage_state.key(), true), // authority
    ],
    ...
};
```

But `invoke_signed` passes `token_program.to_account_info()` where the mint AccountInfo should be:

```rust
invoke_signed(
    &burn_ix,
    &[
        vault,
        token_program.to_account_info(),  // BUG: this is the token program, not the mint!
        carnage_state_info,
    ],
    &[signer_seeds],
)?;
```

Solana runtime requires ALL accounts referenced in instruction metas to be present in the account_infos slice. The mint key is in the metas but its AccountInfo isn't in the slice -- only the token program's AccountInfo is (wrong key). This causes **every burn to fail at runtime**.

**Impact:** 98% of Carnage events (Burn action) are completely broken. Only BuyOnly (first trigger ever) and Sell (2%) paths work. The primary deflationary mechanism is non-functional.

**Root cause:** During Phase 37 stack overflow fix, `InterfaceAccount<Mint>` was downgraded to raw `AccountInfo` for CPI passthroughs, but the mint AccountInfo was not threaded through to the burn function.

**Why tests didn't catch it:** The integration test only tests the BuyOnly path (carnage_action=0, no holdings). It never tests burn or sell.

---

### 2.2 Sell-Path Wrong-Pool When held_token != target

**Files:**
- `programs/epoch-program/src/instructions/execute_carnage_atomic.rs:508-536`
- `programs/epoch-program/src/instructions/execute_carnage.rs:508-536`

**What happens:**
The instruction struct has ONE set of pool accounts: `target_pool`, `pool_vault_a`, `pool_vault_b`, `mint_a`, `mint_b`. These are validated against the TARGET token (the one being bought).

When `action=Sell` and `held_token != target`:
- Sell needs the HELD token's pool (e.g., FRAUD/SOL pool to sell FRAUD)
- But only the TARGET token's pool is available (e.g., CRIME/SOL pool to buy CRIME)
- `execute_sell_swap` sets `is_crime` based on `held_token`, which correctly selects Carnage's vault
- BUT the CPI uses `target_pool`, `pool_vault_a`, `pool_vault_b` -- which are the WRONG pool

Example: Carnage holds FRAUD, VRF says target=CRIME, action=Sell:
1. Sell FRAUD: CPI tries to sell FRAUD into CRIME/SOL pool
2. AMM receives FRAUD tokens but expects CRIME tokens in pool_vault_b
3. Token transfer fails (wrong mint for destination)
4. Entire instruction reverts

**Probability:** 2% (Sell action) x 50% (different target) = **1% of all Carnage events fail silently.**

**Self-healing:** The next trigger has 98% chance of being Burn (which works with the fix), so the failure is temporary. SOL is never lost (retained in vault). But it's still a bug that causes unexpected failures.

**Spec note:** Carnage_Fund_Spec.md Section 8.4 describes the sell-then-buy flow but doesn't address the two-pool problem. Section 7.3 explicitly states "Buy target is VRF-determined regardless of which token is currently held."

---

### 2.3 Only One Mint Available in Struct (Root Cause of Both Above)

The instruction struct has:
- `mint_a: AccountInfo` -- always WSOL (for swap CPI)
- `mint_b: AccountInfo` -- TARGET token's mint (validated: `mint_b.key() == expected_mint`)

But the burn operation needs the HELD token's mint AccountInfo. When held_token == target (50%), `mint_b` works. When held_token != target (50%), there's no AccountInfo for the held token's mint.

Current account count: 19. Adding both mints would bring it to 20 (at the BPF threshold, but Box + AccountInfo optimizations are already in place from Phase 37).

---

## 3. Proposed Fixes

### 3.1 Fix A: Replace mint_b with crime_mint + fraud_mint (Struct Change)

Replace the single `mint_b` with explicit `crime_mint` and `fraud_mint` accounts:

```rust
// REMOVE:
/// Target token mint (CPI passthrough)
pub mint_b: AccountInfo<'info>,

// ADD:
/// CRIME token mint
/// CHECK: Must match crime_vault.mint
#[account(constraint = crime_mint.key() == crime_vault.mint @ EpochError::InvalidMint)]
pub crime_mint: AccountInfo<'info>,

/// FRAUD token mint
/// CHECK: Must match fraud_vault.mint
#[account(constraint = fraud_mint.key() == fraud_vault.mint @ EpochError::InvalidMint)]
pub fraud_mint: AccountInfo<'info>,
```

**Account count:** 19 -> 20 (net +1). Safe with existing Box + AccountInfo optimizations.

**Benefits:**
- Burn can always find the correct mint (based on held_token)
- Swap CPI selects the target mint dynamically
- Explicit validation via constraints (stronger than the current key comparison)
- Both mints validated at deserialization time (fail-fast)

**Impacts:**
- IDL changes (regenerate with `anchor build`)
- Client code updates: `mintB` -> `crimeMint` + `fraudMint` in all callers
- Program upgrade required on devnet (already needed for WSOL wrapping fix)

**Files needing client updates:**
- `tests/integration/carnage.test.ts` (accountsStrict calls)
- `scripts/e2e/lib/carnage-flow.ts` (e2e runner)
- `scripts/e2e/overnight-runner.ts` (if it builds carnage instructions)
- `scripts/e2e/carnage-hunter.ts` (if applicable)

---

### 3.2 Fix B: Update burn_held_tokens to Accept Mint AccountInfo

With both mints available, pass the correct one to `burn_held_tokens`:

```rust
// CALL SITE (in handler):
CarnageAction::Burn => {
    if held_amount > 0 {
        let burn_mint = if held_token == 1 {
            ctx.accounts.crime_mint.to_account_info()
        } else {
            ctx.accounts.fraud_mint.to_account_info()
        };
        let carnage_state = &mut ctx.accounts.carnage_state;
        tokens_burned = burn_held_tokens(
            carnage_state,
            &ctx.accounts.crime_vault,
            &ctx.accounts.fraud_vault,
            &ctx.accounts.token_program_b,
            carnage_state_seeds,
            burn_mint,  // NEW PARAMETER
        )?;
    }
}

// FUNCTION SIGNATURE:
fn burn_held_tokens<'info>(
    carnage_state: &mut Account<'info, CarnageFundState>,
    crime_vault: &InterfaceAccount<'info, TokenAccount>,
    fraud_vault: &InterfaceAccount<'info, TokenAccount>,
    token_program: &Interface<'info, TokenInterface>,
    signer_seeds: &[&[u8]],
    burn_mint: AccountInfo<'info>,  // NEW PARAMETER
) -> Result<u64> {
    // ... existing logic ...

    invoke_signed(
        &burn_ix,
        &[
            vault,
            burn_mint,           // FIXED: actual mint AccountInfo
            carnage_state_info,
        ],
        &[signer_seeds],
    )?;

    // ... rest unchanged ...
}
```

---

### 3.3 Fix C: Add Both Pool Account Sets (CRIME/SOL + FRAUD/SOL)

**DECIDED: Add both pools.** The instruction struct gets both CRIME/SOL and FRAUD/SOL pool accounts, so the sell path can always use the held token's pool and the buy path can always use the target token's pool.

**Token-based naming** (not role-based): Use `crime_pool_*` and `fraud_pool_*` instead of `target_pool_*` and `held_pool_*`. The handler selects which pool to use per operation. Client always passes both -- no conditional logic.

```rust
// CRIME/SOL pool
/// CHECK: Validated by Tax Program during swap_exempt CPI
#[account(mut)]
pub crime_pool: AccountInfo<'info>,
#[account(mut)]
pub crime_pool_vault_a: AccountInfo<'info>,
#[account(mut)]
pub crime_pool_vault_b: AccountInfo<'info>,

// FRAUD/SOL pool
/// CHECK: Validated by Tax Program during swap_exempt CPI
#[account(mut)]
pub fraud_pool: AccountInfo<'info>,
#[account(mut)]
pub fraud_pool_vault_a: AccountInfo<'info>,
#[account(mut)]
pub fraud_pool_vault_b: AccountInfo<'info>,
```

**Handler pool selection:**

```rust
// For sell: use held token's pool
let (sell_pool, sell_va, sell_vb, sell_mint) = if held_is_crime {
    (&ctx.accounts.crime_pool, &ctx.accounts.crime_pool_vault_a,
     &ctx.accounts.crime_pool_vault_b, &ctx.accounts.crime_mint)
} else {
    (&ctx.accounts.fraud_pool, &ctx.accounts.fraud_pool_vault_a,
     &ctx.accounts.fraud_pool_vault_b, &ctx.accounts.fraud_mint)
};

// For buy: use target token's pool
let (buy_pool, buy_va, buy_vb, buy_mint) = match target {
    Token::Crime => (&ctx.accounts.crime_pool, ...crime...),
    Token::Fraud => (&ctx.accounts.fraud_pool, ...fraud...),
};
```

**Stack safety (23 accounts):** Box the 3 InterfaceAccount fields (`carnage_wsol`, `crime_vault`, `fraud_vault`) to move ~495 bytes to heap. Combined with already-boxed `epoch_state` + `carnage_state`, estimated stack usage is ~1.1KB (well within 4KB BPF limit).

**Refactor `execute_swap_exempt_cpi`:** Accept pool accounts as parameters instead of reading from `ctx.accounts.target_pool` directly. This allows using different pools for sell vs buy operations.

---

### 3.4 Fix D: Update Swap CPI to Use Dynamic Mint Selection

In `execute_swap_exempt_cpi`, replace static `mint_b` with dynamic selection:

```rust
// BEFORE:
AccountMeta::new_readonly(ctx.accounts.mint_b.key(), false),  // mint_b (IP token)

// AFTER:
let target_mint_key = if is_crime {
    ctx.accounts.crime_mint.key()
} else {
    ctx.accounts.fraud_mint.key()
};
AccountMeta::new_readonly(target_mint_key, false),  // mint_b (IP token)

// And in account_infos:
// BEFORE:
ctx.accounts.mint_b.to_account_info(),

// AFTER:
if is_crime {
    ctx.accounts.crime_mint.to_account_info()
} else {
    ctx.accounts.fraud_mint.to_account_info()
},
```

---

### 3.5 Fix E: Update mint_b Validation

The handler currently validates `mint_b` against the target:

```rust
let expected_mint = match target {
    Token::Crime => ctx.accounts.crime_vault.mint,
    Token::Fraud => ctx.accounts.fraud_vault.mint,
};
require!(
    ctx.accounts.mint_b.key() == expected_mint,
    EpochError::InvalidCarnageTargetPool
);
```

This validation is no longer needed because `crime_mint` and `fraud_mint` have constraints on the struct:

```rust
#[account(constraint = crime_mint.key() == crime_vault.mint)]
#[account(constraint = fraud_mint.key() == fraud_vault.mint)]
```

The `require!` block can be removed entirely (or repurposed for other validation).

---

## 4. Carnage Flow Correctness Analysis

### 4.1 "Won't It Buy What It's Selling?"

**Short answer:** Yes, 50% of the time on the sell path, and this is by design.

**Spec Section 7.3:** "Buy target is VRF-determined regardless of which token is currently held. This means after a 2% sell, Carnage could immediately rebuy the same token it just sold."

**Scenario analysis:**

| Held Token | Target | Action | What Happens | Net Effect |
|-----------|--------|--------|--------------|------------|
| CRIME | CRIME | Burn (98%) | Burn CRIME, buy CRIME | Deflationary + rebuy |
| CRIME | FRAUD | Burn (98%) | Burn CRIME, buy FRAUD | Switch holdings |
| CRIME | CRIME | Sell (2%) | Sell CRIME, buy CRIME | ~2% LP fee loss, no net change |
| CRIME | FRAUD | Sell (2%) | ~~Sell CRIME, buy FRAUD~~ -> **Converted to Burn** | Deflationary + buy FRAUD |
| None | Either | BuyOnly | Buy target | Initial purchase |

The "sell and rebuy same token" case (row 3) wastes ~2% in LP fees but is intentional chaos. Probability: 2% x 50% = 1% of all Carnage events.

With Fix C (sell-path guard), the "sell different token" case (row 4) becomes a burn, which is actually MORE beneficial (deflationary) than selling.

### 4.2 State Machine Correctness

After each Carnage event, state transitions are:

```
held_token = target_token (u8: 1=CRIME, 2=FRAUD)
held_amount = actual tokens received (vault balance delta, post-debugger-fix)
carnage_pending = false
carnage_action = 0 (None)
```

The held_token always reflects what was just bought, not what was held before. This means the VRF's 50/50 target selection naturally alternates holdings (on average).

### 4.3 Accumulation Behavior

SOL accumulates in `sol_vault` from 24% of all taxes. On each trigger:

```
available_sol = sol_vault.lamports() - rent_exempt_minimum  (post-debugger-fix)
swap_amount = min(available_sol, 1000 SOL)
```

If Carnage triggers every ~24 epochs and each epoch generates ~X SOL in taxes:
- Carnage receives: 24 epochs * X SOL * 24% = 5.76 * X SOL per trigger
- At low volume (0.1 SOL/epoch taxes): 0.576 SOL per Carnage
- At high volume (10 SOL/epoch taxes): 57.6 SOL per Carnage
- Cap only matters above ~174 SOL/epoch taxes (1000 SOL / 5.76)

### 4.4 CPI Depth Safety

Current depth chain: `Epoch -> Tax -> AMM -> Token-2022 -> Transfer Hook = 4 (Solana max)`

The wrapping CPIs (system_program::transfer + sync_native) execute at **depth 0** in the Epoch handler, BEFORE the swap CPI chain. The burn CPI also executes at depth 0. So adding these doesn't increase the CPI chain depth.

```
Handler (depth 0):
  ├── system_program::transfer (sol_vault -> carnage_wsol)  -- depth 1
  ├── sync_native (carnage_wsol)                             -- depth 1
  ├── burn (if action=Burn)                                  -- depth 1
  └── Tax::swap_exempt CPI                                   -- depth 1
       └── AMM::swap                                          -- depth 2
            └── Token-2022::transfer_checked                   -- depth 3
                 └── Transfer Hook::execute                     -- depth 4
```

All safe.

---

## 5. Zero Slippage Analysis (H064)

### 5.1 Current State

`swap_exempt.rs:111`: `const MINIMUM_OUTPUT: u64 = 0;`

Carnage swaps have zero slippage protection. The audit flagged this as CRITICAL.

### 5.2 The User's Argument: Tax Friction as MEV Deterrent

**Atomic execution (happy path):**
- `consume_randomness` + `execute_carnage_atomic` bundled in same TX
- CarnagePending event only visible AFTER execution
- **Zero MEV opportunity** -- no advance notice, no window
- This is the intended path (Spec Section 9.5)

**Fallback execution (unhappy path):**
- 100-slot (~40 second) window between CarnagePending event and deadline
- CarnagePending broadcasts target and action
- MEV bots could potentially sandwich

### 5.3 MEV Profitability Analysis (Fallback Path Only)

**Tax rates per epoch (VRF-determined):**
- Cheap side: buy 1-4%, sell 11-14%
- Expensive side: buy 11-14%, sell 1-4%
- One side is always "cheap buy + expensive sell" and vice versa

**MEV sandwich round-trip cost (same SOL pool):**

| Scenario | MEV Buy Tax | MEV Sell Tax | LP Fees (2x1%) | Total Friction |
|----------|-------------|-------------|----------------|----------------|
| Best case for MEV | 1% (cheap buy) | 1% (cheap sell) | 2% | 4% |
| Typical | 2% (cheap buy) | 12% (expensive sell) | 2% | 16% |
| Worst case for MEV | 14% (expensive buy) | 14% (expensive sell) | 2% | 30% |

**Wait -- can both buy and sell be on the cheap side?**

No. The tax structure is per-TOKEN, not per-direction:
- If CRIME is cheap: CRIME buy=1-4% (low), CRIME sell=11-14% (high)
- MEV bot buying AND selling CRIME pays: (1-4%) + (11-14%) + 2% LP = **14-20%**

**This is symmetric.** Regardless of which side is "cheap," the MEV bot always pays one low tax and one high tax for a round trip on the same token. **Round-trip friction is always 14-20%.**

### 5.4 Price Impact Required for MEV Profit

For MEV to profit, Carnage's price impact must exceed the round-trip friction:

| Pool Liquidity (SOL side) | Carnage Buy (1000 SOL) Price Impact | Profitable? (vs 14-20% friction) |
|---------------------------|-------------------------------------|----------------------------------|
| 500 SOL | ~67% | YES (but pool is dangerously tiny) |
| 2,000 SOL | ~33% | YES (marginal after fees) |
| 5,000 SOL | ~17% | BARELY (best case only) |
| 10,000 SOL | ~9% | NO |
| 50,000+ SOL | <2% | NO |

**Pool liquidity below ~5,000 SOL is the danger zone.** Above that, tax friction exceeds price impact and MEV is unprofitable.

### 5.5 Cross-Pool Arbitrage (PROFIT Pool Bypass?)

Could MEV bots use the tax-free PROFIT pool to avoid taxes?

- PROFIT pools: 0% tax, 0.5% LP fee
- BUT: Carnage buys on the SOL pool, so price impact is on the SOL pool
- PROFIT pool price is independent (different reserve ratio)
- MEV bot still needs to sell on the SOL pool to capture Carnage's price impact
- **Sell on SOL pool still pays 11-14% sell tax**
- Cross-pool route: buy on PROFIT (0.5%) + sell on SOL (12-15%) = 12.5-15.5%
- Still unprofitable for >5,000 SOL pools

### 5.6 Transfer Hook as Additional Defense

The Transfer Hook enforces that ALL token transfers go through whitelisted accounts (pools). MEV bots cannot:
- Transfer tokens wallet-to-wallet (bypassing pools)
- Use private OTC markets
- Use external DEXes (only our AMM pools are whitelisted)

This prevents the "buy on external exchange, sell on our AMM" sandwich vector.

### 5.7 Decision: Add 50% Slippage Floor

**DECIDED: Add a 50% floor.** Atomic bundling is the primary defense, tax friction is the secondary defense, and the 50% floor is a safety net for catastrophic sandwich attacks on the fallback path.

**Implementation (~15 lines, post-swap check in Epoch handler):**

```rust
// After the buy swap CPI (we already measure vault delta from debugger fix):
let tokens_bought = target_vault_after - target_vault_before;

// Read pool reserves from the target pool AccountInfo
let pool_data = Pool::try_deserialize(
    &mut &target_pool.data.borrow()[8..]
)?;
let (reserve_sol, reserve_token) = /* select based on canonical ordering */;

// Constant-product expected output (before LP fee, conservative)
let expected = (reserve_token as u128)
    .checked_mul(swap_amount as u128)
    .and_then(|n| n.checked_div(
        (reserve_sol as u128).checked_add(swap_amount as u128)?
    ))
    .ok_or(EpochError::Overflow)?;

// 50% floor: prevents catastrophic sandwich while tolerating normal volatility
require!(
    tokens_bought >= (expected as u64) / 2,
    EpochError::CarnageSlippageExceeded
);
```

**Why 50% and not tighter:**
- Carnage IS designed to cause price disruption (spec Section 9.3)
- Tighter floors risk legitimate Carnage failures in volatile markets
- 50% catches only catastrophic manipulation (>50% worse than expected)
- The floor is calculated BEFORE LP fee deduction, making it even more generous

**Dependencies:**
- Import `Pool` struct from AMM crate (Epoch already depends on AMM for program IDs)
- Add `CarnageSlippageExceeded` error variant to EpochError
- No Tax Program changes needed (check is post-CPI in Epoch handler)

**Defense layers (in order of strength):**
1. Atomic bundling (consume + execute in same TX) -- eliminates MEV window entirely
2. Tax friction (14-20% round-trip) -- makes sandwich unprofitable in pools >5,000 SOL
3. Transfer Hook (whitelist) -- blocks bypass routes
4. 50% slippage floor (new) -- catches catastrophic manipulation on fallback path

---

## 6. Remaining Audit Findings Status

Cross-referencing `.audit/VERIFICATION_REPORT.md` with debugger fixes:

### 6.1 Now Fixed (By Debugger + This Investigation)

| Finding | Description | Fixed By |
|---------|-------------|----------|
| H006/H007 | held_amount tracks input SOL not output tokens | Debugger: vault balance delta |
| REG-001 | Burn mint AccountInfo missing | This investigation: Fix B |
| (new) | WSOL wrapping missing | Debugger: wrap_sol_to_wsol() |
| (new) | sol_vault rent-exempt drain | Debugger: saturating_sub(rent) |
| (new) | sol_from_sale placeholder | Debugger: wsol balance delta |
| (new) | Sell-path wrong-pool | This investigation: Fix C |

### 6.2 Actionable Before Mainnet (Not Design Choices)

| Finding | Severity | Description | Recommendation |
|---------|----------|-------------|----------------|
| H064 | CRITICAL | Zero slippage on Carnage | Add 50% floor (Section 5.7) |
| H014 | CRITICAL | Upgrade authority single EOA | Transfer to Squads multisig + timelock |
| H016 | HIGH | No emergency pause | Add `is_paused` flag to EpochState |
| H025 | HIGH | AMM swap output zero check | Add `require!(output > 0)` to AMM swap |
| H036/H037 | HIGH | Transfer Hook whitelist bypass | Investigate bypass conditions |

### 6.3 Accepted Risk / Design-Inherent (No Action Needed)

H008, H009, H010, H012, H013, H019, H034, H039, H040, H041, H066, H088, H090, H098, H100 -- all design trade-offs or inherent to the architecture. See verification report for details.

---

## 7. Implementation Plan

### Phase 1: Struct Overhaul (Both Files)

**Target struct (23 accounts):**

```rust
pub struct ExecuteCarnageAtomic<'info> {
    // Core state (5)
    pub caller: Signer<'info>,
    #[account(mut, seeds = [EPOCH_STATE_SEED], bump = epoch_state.bump, ...)]
    pub epoch_state: Box<Account<'info, EpochState>>,
    #[account(mut, seeds = [CARNAGE_FUND_SEED], bump = carnage_state.bump, ...)]
    pub carnage_state: Box<Account<'info, CarnageFundState>>,
    #[account(seeds = [CARNAGE_SIGNER_SEED], bump)]
    pub carnage_signer: AccountInfo<'info>,
    #[account(mut, seeds = [CARNAGE_SOL_VAULT_SEED], bump)]
    pub sol_vault: SystemAccount<'info>,

    // Carnage token accounts (3) -- Box for stack savings
    #[account(mut, constraint = carnage_wsol.owner == carnage_signer.key())]
    pub carnage_wsol: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, constraint = crime_vault.key() == carnage_state.crime_vault)]
    pub crime_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, constraint = fraud_vault.key() == carnage_state.fraud_vault)]
    pub fraud_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    // CRIME/SOL pool (3) -- CPI passthroughs
    /// CHECK: Validated by Tax Program during swap_exempt CPI
    #[account(mut)]
    pub crime_pool: AccountInfo<'info>,
    /// CHECK: Validated by Tax Program during swap_exempt CPI
    #[account(mut)]
    pub crime_pool_vault_a: AccountInfo<'info>,
    /// CHECK: Validated by Tax Program during swap_exempt CPI
    #[account(mut)]
    pub crime_pool_vault_b: AccountInfo<'info>,

    // FRAUD/SOL pool (3) -- CPI passthroughs
    /// CHECK: Validated by Tax Program during swap_exempt CPI
    #[account(mut)]
    pub fraud_pool: AccountInfo<'info>,
    /// CHECK: Validated by Tax Program during swap_exempt CPI
    #[account(mut)]
    pub fraud_pool_vault_a: AccountInfo<'info>,
    /// CHECK: Validated by Tax Program during swap_exempt CPI
    #[account(mut)]
    pub fraud_pool_vault_b: AccountInfo<'info>,

    // Mints (3)
    /// CHECK: Validated by Tax and AMM programs during swap
    pub mint_a: AccountInfo<'info>,  // WSOL mint (shared by both pools)
    /// CHECK: Must match crime_vault.mint
    #[account(constraint = crime_mint.key() == crime_vault.mint @ EpochError::InvalidMint)]
    pub crime_mint: AccountInfo<'info>,
    /// CHECK: Must match fraud_vault.mint
    #[account(constraint = fraud_mint.key() == fraud_vault.mint @ EpochError::InvalidMint)]
    pub fraud_mint: AccountInfo<'info>,

    // Programs (6)
    #[account(address = tax_program_id())]
    pub tax_program: AccountInfo<'info>,
    #[account(address = amm_program_id())]
    pub amm_program: AccountInfo<'info>,
    /// CHECK: PDA derived from Tax Program seeds
    pub swap_authority: AccountInfo<'info>,
    pub token_program_a: Interface<'info, TokenInterface>,
    pub token_program_b: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}
```

1. Replace `target_pool`, `pool_vault_a`, `pool_vault_b` with `crime_pool_*` and `fraud_pool_*`
2. Replace `mint_b` with `crime_mint` and `fraud_mint` (with constraints)
3. Box `carnage_wsol`, `crime_vault`, `fraud_vault` (stack savings ~495 bytes)
4. Mirror all changes in `ExecuteCarnage` struct
5. Remove the `require!` validation on `mint_b` in handler (replaced by struct constraints)

### Phase 2: Burn Fix (REG-001)
1. Add `burn_mint: AccountInfo` parameter to `burn_held_tokens`
2. Select correct mint at call site based on `held_token`:
   ```rust
   let burn_mint = if held_token == 1 {
       ctx.accounts.crime_mint.to_account_info()
   } else {
       ctx.accounts.fraud_mint.to_account_info()
   };
   ```
3. Replace `token_program.to_account_info()` with `burn_mint` in `invoke_signed`

### Phase 3: Refactor execute_swap_exempt_cpi
1. Accept pool accounts as parameters (not from `ctx.accounts.target_pool`):
   ```rust
   fn execute_swap_exempt_cpi<'info>(
       ctx: &Context<...>,
       amount: u64,
       direction: u8,
       is_crime: bool,
       carnage_signer_seeds: &[&[u8]],
       pool: &AccountInfo<'info>,
       pool_vault_a: &AccountInfo<'info>,
       pool_vault_b: &AccountInfo<'info>,
       ip_mint: &AccountInfo<'info>,
   ) -> Result<()>
   ```
2. Update all callers (sell uses held pool, buy uses target pool)
3. Select correct mint dynamically via `ip_mint` parameter

### Phase 4: Add 50% Slippage Floor
1. Import `Pool` struct from AMM crate in Epoch Program
2. After buy swap CPI, read pool reserves from target pool AccountInfo
3. Calculate expected output using constant-product formula
4. Add `require!(tokens_bought >= expected / 2)` check
5. Add `CarnageSlippageExceeded` error variant

### Phase 5: Client Updates
1. Update `carnage.test.ts`:
   - `targetPool` -> `crimePool` / `fraudPool` (pass both)
   - `poolVaultA/B` -> `crimePoolVaultA/B` + `fraudPoolVaultA/B`
   - `mintB` -> `crimeMint` + `fraudMint`
   - Remove WSOL pre-funding, fund sol_vault instead (test on-chain wrapping)
2. Update `scripts/e2e/lib/carnage-flow.ts`: Same account name changes
3. Update `scripts/e2e/carnage-hunter.ts` if applicable
4. Regenerate IDL (`anchor build`)

### Phase 6: Verify
1. `anchor build -p epoch_program` (clean build, check for stack overflow)
2. `anchor build -p epoch_program -- --features devnet` (devnet build)
3. Run carnage integration tests (all paths: BuyOnly, Burn, Sell-same, Sell-different)
4. Deploy to devnet and test with overnight runner

---

## 8. Decisions Made

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | mint_b -> crime_mint + fraud_mint? | **YES** | Both mints always available for burn + sell + swap CPI |
| 2 | Sell-path when held != target? | **Add both pools** | Token-based naming (crime_pool/fraud_pool), 23 accounts total, Box InterfaceAccounts for stack safety |
| 3 | Zero slippage (H064)? | **Add 50% floor** | ~15 lines post-swap check. Atomic bundling is primary defense, tax friction is secondary, floor is safety net |
| 4 | Sell-same-token (held == target)? | **Keep as-is** | Spec says intentional chaos. VRF unpredictability is the feature. 1% occurrence rate |

### Stack Safety Analysis (23 Accounts)

| Account Type | Count | Stack per Account | Total |
|-------------|-------|-------------------|-------|
| Box<Account> | 2 | ~8 bytes (pointer) | 16 |
| Box<InterfaceAccount> | 3 | ~8 bytes (pointer) | 24 |
| AccountInfo | 13 | ~72 bytes | 936 |
| Interface | 2 | ~8 bytes | 16 |
| Program | 1 | ~8 bytes | 8 |
| Signer | 1 | ~32 bytes | 32 |
| SystemAccount | 1 | ~8 bytes | 8 |
| **Total** | **23** | | **~1,040 bytes** |

BPF stack frame limit: 4,096 bytes. Estimated usage: ~1,040 bytes (25%). Safe with margin for local variables.

---

*Investigation by Claude, cross-referenced against Carnage_Fund_Spec.md, VERIFICATION_REPORT.md, and source code.*
*Decisions finalized 2026-02-14 in collaboration with mlbob.*
