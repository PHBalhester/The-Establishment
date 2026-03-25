# Tax Program CPI Orchestrator Pitfalls

**Domain:** Solana DeFi Tax/Fee CPI Orchestrator with Asymmetric Taxation
**Researched:** 2026-02-06
**Confidence:** HIGH (domain-specific to existing protocol specs + verified external sources)

**Context:** This document covers pitfalls specific to BUILDING the Dr. Fraudsworth Tax Program -- the CPI orchestrator that routes user swaps through the AMM, calculates taxes based on EpochState, and distributes collected SOL to three destinations.

**Key risks from project context:**
1. Tax calculation overflow (u64 amounts * bps rates)
2. Incorrect tax application point (buy: deduct from input, sell: deduct from output)
3. Distribution rounding errors (75+24+1 must equal 100%)
4. CPI depth limit (Carnage path is at depth 4, max allowed)
5. Mixed T22/SPL handling (WSOL is SPL Token, CRIME/FRAUD/PROFIT are T22)
6. swap_exempt security (only Carnage PDA should be able to call it)

---

## Critical Pitfalls

These mistakes cause security vulnerabilities, loss of funds, or require complete rewrites.

---

### Pitfall 1: Tax Calculation Overflow

**Severity:** CRITICAL -- loss of funds or transaction failure

**What goes wrong:**
Tax calculation uses `amount * tax_rate_bps / 10_000`. For large swap amounts multiplied by tax rates, intermediate multiplication can overflow u64.

The real overflow risk is in distribution calculations:
```rust
// BAD: Can overflow on large tax amounts
let yield_portion = (tax_amount * 75) / 100;  // 75% to staking

// If tax_amount = 1.5 * 10^18 lamports (1.5B SOL equivalent - theoretical max)
// tax_amount * 75 = 1.125 * 10^20 > u64::MAX (~1.8 * 10^19)
```

Even more practical concern -- bps multiplication:
```rust
// If amount = 1 * 10^14 lamports (100,000 SOL) and tax_rate = 1400 bps
// amount * tax_rate = 1.4 * 10^17 (fits in u64)
// But with 1M SOL: 1 * 10^15 * 1400 = 1.4 * 10^18 (still fits, but closer to limit)
```

**Why it happens:**
Developers assume Solana amounts are always "reasonable" sizes. They use simple arithmetic without checking overflow, or they apply percentages in the wrong order (multiply first, which can overflow, vs divide first, which loses precision).

**How to avoid:**
1. Use u128 for all intermediate calculations
2. Always use checked arithmetic: `checked_mul`, `checked_div`
3. Or use the pattern: `amount / 100 * 75` (loses at most 99 lamports precision, but never overflows)
4. For bps calculations: `amount.checked_mul(tax_rate_bps)?.checked_div(BPS_DENOMINATOR)?`

```rust
// GOOD: Safe tax calculation
pub fn calculate_tax(amount: u64, tax_rate_bps: u16) -> Result<u64> {
    let amount_128 = amount as u128;
    let rate_128 = tax_rate_bps as u128;
    const BPS_DENOMINATOR: u128 = 10_000;

    let tax = amount_128
        .checked_mul(rate_128)
        .ok_or(TaxError::TaxOverflow)?
        .checked_div(BPS_DENOMINATOR)
        .ok_or(TaxError::TaxOverflow)?;

    u64::try_from(tax).map_err(|_| TaxError::TaxOverflow)
}
```

**Warning signs:**
- No `checked_*` methods in arithmetic code
- Direct use of `*`, `/` operators on u64 amounts
- Tests only use small amounts (< 1 SOL)
- No u128 intermediate type in calculations

**Phase to address:**
Tax Program Core Implementation - arithmetic module must be reviewed and tested for overflow before any other logic.

**Confidence:** HIGH - This is a well-documented Solana vulnerability. See [Understanding Arithmetic Overflow/Underflows in Rust and Solana](https://www.sec3.dev/blog/understanding-arithmetic-overflow-underflows-in-rust-and-solana) and [Solana Arithmetic Best Practices](https://www.helius.dev/blog/solana-arithmetic).

---

### Pitfall 2: Incorrect Tax Application Point

**Severity:** CRITICAL -- breaks economic model, creates exploitable arbitrage

**What goes wrong:**
The spec defines asymmetric tax application:
- **BUY (SOL -> IP):** Tax deducted from SOL input BEFORE swap
- **SELL (IP -> SOL):** Tax deducted from SOL output AFTER swap

Implementing this backwards (taxing output on buys, input on sells) or taxing the IP token instead of SOL breaks the economic model.

Example of broken implementation:
```rust
// WRONG: Taxing IP token output on buy
fn swap_sol_buy(...) {
    let gross_output = amm.swap(sol_input); // Get IP tokens
    let tax = calculate_tax(gross_output, buy_tax_rate); // WRONG: tax on IP
    let net_output = gross_output - tax; // User receives less IP
    // But tax is supposed to be SOL-denominated!
}
```

**Why it happens:**
- Confusion between "tax on what you give" vs "tax on what you receive"
- The spec uses "input" and "output" which swap meaning between buy/sell
- Developers implement one direction correctly, then copy-paste and forget to flip
- Both approaches "work" in that tokens move and tax is collected -- the bug is subtle

**How to avoid:**
1. Use explicit naming: `tax_from_sol_input` and `tax_from_sol_output`
2. Always verify: "Is the tax amount in SOL lamports?" -- if not, something is wrong
3. Create separate instruction handlers for buy vs sell paths
4. Write tests that verify: `tax_collected` is always native SOL lamports

```rust
// swap_sol_buy: User spends SOL, receives IP
// Tax comes from SOL input BEFORE swap
pub fn swap_sol_buy(ctx: Context<SwapSolBuy>, sol_amount: u64, min_output: u64) -> Result<()> {
    let tax_rate = get_buy_tax_rate(&ctx.accounts.epoch_state, pool_type)?;
    let tax = calculate_tax(sol_amount, tax_rate)?;
    let sol_after_tax = sol_amount.checked_sub(tax).ok_or(TaxError::Underflow)?;

    // CPI to AMM with reduced SOL amount
    let ip_output = amm_swap(&ctx, sol_after_tax)?;
    require!(ip_output >= min_output, TaxError::SlippageExceeded);

    // Distribute tax (SOL lamports)
    distribute_tax(&ctx, tax)?;

    Ok(())
}

// swap_sol_sell: User spends IP, receives SOL
// Tax comes from SOL output AFTER swap
pub fn swap_sol_sell(ctx: Context<SwapSolSell>, ip_amount: u64, min_output: u64) -> Result<()> {
    // CPI to AMM first to get gross SOL output
    let gross_sol_output = amm_swap(&ctx, ip_amount)?;

    let tax_rate = get_sell_tax_rate(&ctx.accounts.epoch_state, pool_type)?;
    let tax = calculate_tax(gross_sol_output, tax_rate)?;
    let net_sol_output = gross_sol_output.checked_sub(tax).ok_or(TaxError::Underflow)?;

    require!(net_sol_output >= min_output, TaxError::SlippageExceeded);

    // User receives net amount
    transfer_sol_to_user(&ctx, net_sol_output)?;

    // Distribute tax (SOL lamports)
    distribute_tax(&ctx, tax)?;

    Ok(())
}
```

**Warning signs:**
- Tax amounts that aren't denominated in lamports
- Single swap function handling both directions with unclear branching
- Missing tests that verify exact SOL amounts after tax
- Comments saying "tax on input" for both buy and sell
- Tests that check "some tax was collected" rather than "correct SOL tax collected"

**Phase to address:**
Tax Program Core Implementation - swap instruction design. This must be correct from the first implementation.

**Confidence:** HIGH - Derived directly from Tax_Pool_Logic_Spec.md Section 4 and Section 14.

---

### Pitfall 3: Distribution Rounding Errors (75+24+1 Split)

**Severity:** HIGH -- funds leak or overdraw

**What goes wrong:**
When distributing tax SOL to three destinations (75% staking, 24% carnage, 1% treasury), rounding errors can cause:
1. Total distributed > tax collected (overdraw -- transaction fails or steals from source)
2. Total distributed < tax collected (dust accumulates, never claimed)
3. Sum of percentages != 100 due to truncation

Example:
```rust
// BAD: Truncation error
let tax = 333; // lamports
let yield_portion = tax * 75 / 100;    // 249
let carnage_portion = tax * 24 / 100;  // 79
let treasury_portion = tax * 1 / 100;  // 3
// Total: 249 + 79 + 3 = 331 lamports
// MISSING: 2 lamports (333 - 331) -- where do they go?
```

**Why it happens:**
- Each percentage calculation truncates independently
- With small amounts, the cumulative truncation error is significant
- Developers add up percentages (75+24+1=100) and assume math works

**How to avoid:**
Calculate the final portion as remainder, not as percentage:

```rust
pub fn distribute_tax(tax_amount: u64) -> Result<(u64, u64, u64)> {
    // Calculate first two portions
    let yield_portion = tax_amount.checked_mul(75)
        .ok_or(TaxError::Overflow)?
        .checked_div(100)
        .ok_or(TaxError::DivisionByZero)?;

    let carnage_portion = tax_amount.checked_mul(24)
        .ok_or(TaxError::Overflow)?
        .checked_div(100)
        .ok_or(TaxError::DivisionByZero)?;

    // Treasury gets REMAINDER - ensures exact sum
    let treasury_portion = tax_amount
        .checked_sub(yield_portion)
        .ok_or(TaxError::Underflow)?
        .checked_sub(carnage_portion)
        .ok_or(TaxError::Underflow)?;

    // Invariant: yield + carnage + treasury == tax_amount (ALWAYS)
    debug_assert_eq!(yield_portion + carnage_portion + treasury_portion, tax_amount);

    Ok((yield_portion, carnage_portion, treasury_portion))
}
```

**Alternative:** Give largest recipient the remainder (yield at 75% is largest):

```rust
let carnage_portion = tax_amount * 24 / 100;
let treasury_portion = tax_amount * 1 / 100;
let yield_portion = tax_amount - carnage_portion - treasury_portion; // Remainder
// yield_portion will be ~75% +/- 1 lamport
```

**Warning signs:**
- All three portions calculated with `* percentage / 100`
- No assertion that `sum == total`
- Tests only check individual portions, not sum
- Protocol slowly accumulates "lost" lamports in source vault
- Or worse: transactions fail with insufficient balance

**Phase to address:**
Tax Program Core Implementation - distribution module.

**Confidence:** HIGH - Standard DeFi precision issue. See [Solana Program Vulnerabilities Guide](https://gist.github.com/zfedoran/9130d71aa7e23f4437180fd4ad6adc8f).

---

### Pitfall 4: CPI Depth Exceeded on Carnage Path

**Severity:** CRITICAL -- Carnage execution permanently broken

**What goes wrong:**
The Carnage execution path is already at CPI depth 4 (the Solana hard limit):

```
Epoch::vrf_callback (entry point)
  |-> Tax::swap_exempt (depth 1)
      |-> AMM::swap (depth 2)
          |-> Token-2022::transfer_checked (depth 3)
              |-> Transfer Hook::execute (depth 4) -- SOLANA LIMIT
```

Adding any additional CPI call (logging to another program, state sync, extra validation) causes immediate transaction failure with "CPI depth limit exceeded."

**Why it happens:**
- Developers add a "small" CPI call for convenience (emit event via another program, update external state)
- They test on paths that don't involve hooks (WSOL side) which have depth 3
- The depth 4 path only triggers on Token-2022 transfers with hooks
- Tests pass on localnet where hooks might not be fully configured

**How to avoid:**
1. Document CPI depth for every instruction path in comments
2. Never add CPI calls to the Carnage execution path
3. If you MUST add functionality, use the two-instruction atomic bundle pattern (see Carnage_Fund_Spec.md Section 9.5)
4. Test with the full CPI chain including transfer hooks on devnet

```rust
// In swap_exempt instruction:
/// CRITICAL: CPI DEPTH ANALYSIS
/// This instruction is called at depth 1 by Epoch Program.
/// It calls AMM at depth 2.
/// AMM calls Token-2022 at depth 3.
/// Token-2022 calls Transfer Hook at depth 4 (LIMIT).
/// DO NOT add any CPI calls to this instruction.
pub fn swap_exempt(ctx: Context<SwapExempt>, amount: u64) -> Result<()> {
    // Direct CPI to AMM only -- no other CPIs allowed
    amm::cpi::swap(...)?;
    Ok(())
}
```

**Warning signs:**
- New CPI calls added without depth analysis
- Tests passing on localnet but failing on devnet (hooks may behave differently)
- "Works for WSOL swaps but fails for CRIME/FRAUD swaps"
- Error message: "Cross-program invocation call depth too deep"

**Phase to address:**
Tax Program swap_exempt instruction - must be designed with zero CPI headroom in mind.

**Confidence:** HIGH - Directly from Carnage_Fund_Spec.md Section 2 and [Solana CPI Limitations](https://solana.com/docs/programs/limitations).

---

### Pitfall 5: Mixed Token Program Confusion (T22/SPL)

**Severity:** CRITICAL -- all SOL pool swaps fail

**What goes wrong:**
WSOL uses SPL Token program, CRIME/FRAUD/PROFIT use Token-2022. Passing the wrong program ID causes:
- Silent failures (wrong program can't operate on account)
- Incorrect ATA derivation (different programs = different ATA addresses)
- Missing hook invocations (SPL Token doesn't support hooks)

Example:
```rust
// BAD: Using Token-2022 program for WSOL transfer
transfer_checked(
    CpiContext::new(
        ctx.accounts.token_2022_program.to_account_info(), // WRONG for WSOL
        TransferChecked {
            from: wsol_account,  // SPL Token account
            mint: wsol_mint,
            to: pool_wsol_vault,
            authority: user,
        }
    ),
    amount,
    9, // decimals
)?;
// Transaction fails: "Account not owned by this program"
```

**Why it happens:**
- Developers use a single `token_program` variable for both sides
- Copy-paste from PROFIT pool code (all T22) to SOL pool code (mixed)
- The error message is not immediately clear about program mismatch
- PROFIT pools work fine, so tests pass until SOL pools are tested

**How to avoid:**
1. Explicitly pass both token programs to mixed-pool instructions
2. Use separate transfer helper functions for each token type
3. Validate token program against mint at instruction start
4. Tax Program already knows pool type -- use it to select program

```rust
#[derive(Accounts)]
pub struct SwapSolBuy<'info> {
    // SPL Token program for WSOL
    pub spl_token_program: Program<'info, Token>,

    // Token-2022 program for IP tokens
    pub token_2022_program: Program<'info, Token2022>,

    // WSOL mint - validate it's owned by SPL Token
    #[account(
        constraint = wsol_mint.key() == NATIVE_MINT,
    )]
    pub wsol_mint: Account<'info, Mint>,

    // IP mint - validate it's owned by Token-2022
    #[account(
        constraint = ip_mint.to_account_info().owner == &token_2022::ID,
    )]
    pub ip_mint: InterfaceAccount<'info, Mint>,
}
```

**Warning signs:**
- Single `token_program` account in mixed-pool instruction
- No validation that program ID matches token type
- Tests work on PROFIT pools but fail on SOL pools
- Error: "Account not owned by the specified program" or "Invalid instruction data"

**Phase to address:**
Tax Program Core Implementation - instruction account structs must enforce correct program IDs.

**Confidence:** HIGH - Documented in Token_Program_Reference.md and verified via [Token-2022 Security Best Practices](https://neodyme.io/en/blog/token-2022/).

---

### Pitfall 6: swap_exempt Unauthorized Access

**Severity:** CRITICAL -- tax bypass exploit, cannot be patched post-launch

**What goes wrong:**
The `swap_exempt` instruction bypasses taxes (Carnage uses it). If not properly secured, attackers can call it directly to trade tax-free, stealing from yield/carnage/treasury.

```rust
// BAD: No authority check
pub fn swap_exempt(ctx: Context<SwapExempt>, amount: u64) -> Result<()> {
    // Just does the swap with no tax... anyone can call!
    amm_swap(ctx, amount)
}
```

**Why it happens:**
- Developer focuses on "how to make Carnage work" and forgets security
- The instruction exists and works, so tests pass
- No negative test: "can a random user call swap_exempt?"
- PDA validation is subtle -- easy to get wrong

**How to avoid:**
The `swap_exempt` instruction must require the Carnage PDA as a signer:

```rust
#[derive(Accounts)]
pub struct SwapExempt<'info> {
    /// The Carnage Fund PDA - MUST be a signer
    /// This is the ONLY authorized caller of swap_exempt
    #[account(
        seeds = [b"carnage_signer"],
        bump,
        seeds::program = epoch_program::ID,
    )]
    pub carnage_authority: Signer<'info>, // <-- SIGNER constraint is critical

    // ... other accounts
}
```

Since only the Epoch Program can produce a valid signature for this PDA (via `invoke_signed`), and the Epoch Program only calls `swap_exempt` during legitimate Carnage execution, the instruction is secure.

**Why this works:**
- PDA derivation is deterministic -- attacker can compute the address
- But PDA signature requires the owning program to call `invoke_signed`
- Epoch Program is the only program that can sign for `["carnage_signer"]`
- Even if attacker passes the correct PDA address, without signature it fails

**Warning signs:**
- `swap_exempt` has no `Signer` constraint on authority account
- Authority is passed as `UncheckedAccount` without manual verification
- No test: "swap_exempt fails when called by user"
- The same swap logic is shared between taxed and exempt paths without clear branching

**Phase to address:**
Tax Program swap_exempt instruction - security review must verify PDA signer validation.

**Confidence:** HIGH - Standard CPI authority pattern. See [Solana CPI Security](https://blog.asymmetric.re/invocation-security-navigating-vulnerabilities-in-solana-cpis/).

---

## High Severity Pitfalls

These cause incorrect behavior or security issues but don't necessarily lose funds.

---

### Pitfall 7: EpochState Read From Wrong Account

**Severity:** HIGH -- incorrect tax rates applied

**What goes wrong:**
Tax Program reads tax rates from EpochState. If the account isn't validated, an attacker could pass a fake EpochState with favorable rates.

```rust
// BAD: No validation that this is the real EpochState
pub epoch_state: Account<'info, EpochState>,

// Attacker creates fake EpochState with buy_tax = 0
// Passes it to swap_sol_buy
// Gets tax-free trades
```

**How to avoid:**
Validate EpochState is the canonical PDA:

```rust
#[account(
    seeds = [b"epoch_state"],
    bump,
    seeds::program = epoch_program::ID,
)]
pub epoch_state: Account<'info, EpochState>,
```

**Phase to address:** Tax Program Core Implementation - account validation.

---

### Pitfall 8: Tax Destination Spoofing

**Severity:** HIGH -- tax sent to attacker instead of protocol

**What goes wrong:**
The three tax destinations (staking_escrow, carnage_vault, treasury) must be validated. If attacker can pass their own accounts, they receive the tax.

```rust
// BAD: Unchecked accounts
pub staking_escrow: AccountInfo<'info>,
pub carnage_vault: AccountInfo<'info>,
pub treasury: AccountInfo<'info>,

// Attacker passes their own wallets as destinations
```

**How to avoid:**
Each destination must be a validated PDA:

```rust
#[account(
    mut,
    seeds = [b"escrow_vault"],
    bump,
    seeds::program = staking_program::ID,
)]
pub staking_escrow: SystemAccount<'info>,

#[account(
    mut,
    seeds = [b"carnage_sol_vault"],
    bump,
    seeds::program = epoch_program::ID,
)]
pub carnage_vault: SystemAccount<'info>,

#[account(
    mut,
    constraint = treasury.key() == TREASURY_PUBKEY, // Hardcoded or config
)]
pub treasury: SystemAccount<'info>,
```

**Phase to address:** Tax Program Core Implementation - account validation.

---

### Pitfall 9: Pool Type Mismatch

**Severity:** HIGH -- taxed pool treated as untaxed or vice versa

**What goes wrong:**
If Tax Program doesn't verify pool type, a PROFIT pool (untaxed) could be passed to taxed swap instruction, or a SOL pool passed to untaxed instruction, breaking the tax model.

```rust
// BAD: No pool type check
pub fn swap_sol_buy(ctx: Context<SwapSolBuy>, ...) -> Result<()> {
    // Attacker passes CRIME/PROFIT pool
    // Instruction applies tax, but PROFIT pools should be untaxed
    // Or worse: applies SOL tax rates to PROFIT swaps
}
```

**How to avoid:**
Validate pool type matches instruction:

```rust
pub fn swap_sol_buy(ctx: Context<SwapSolBuy>, ...) -> Result<()> {
    let pool_type = ctx.accounts.pool.pool_type;
    require!(
        matches!(pool_type, PoolType::CrimeSol | PoolType::FraudSol),
        TaxError::InvalidPoolType
    );
    // ...
}

pub fn swap_profit(ctx: Context<SwapProfit>, ...) -> Result<()> {
    let pool_type = ctx.accounts.pool.pool_type;
    require!(
        matches!(pool_type, PoolType::CrimeProfit | PoolType::FraudProfit),
        TaxError::InvalidPoolType
    );
    // No tax applied for PROFIT pools
}
```

**Phase to address:** Tax Program Core Implementation - pool validation.

---

### Pitfall 10: Stale EpochState (Race Condition)

**Severity:** MEDIUM -- user gets different tax than expected

**What goes wrong:**
User submits swap at epoch N with expected tax rates. By execution time, epoch N+1 has started with new rates. User pays higher/lower tax than expected.

**This is actually acceptable behavior** but must be documented:
- Tax rates are applied at execution time, not submission time
- Frontend should warn users: "Rates may change before execution"
- This is how most DeFi works (AMM prices also change)

**How to avoid false bug reports:**
- Document this behavior explicitly
- Frontend displays current rates with "may change" warning
- Don't treat this as a bug in testing

**Phase to address:** Documentation and frontend, not Tax Program code.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Single token program variable | Less code | Wrong program silently used | Never in mixed pools |
| Unchecked arithmetic with "reasonable" amounts | Simpler code | Overflow on edge cases | Never in production |
| Shared swap logic for taxed/exempt | DRY code | Security risk if branching is wrong | Only if exempt path has separate entry point |
| Hardcoded distribution percentages | Quick implementation | Harder to verify correctness | OK if thoroughly tested |
| Testing only happy paths | Faster test cycles | Security holes in edge cases | Never for security-critical code |
| Skipping devnet tests | Faster iteration | Missing hook interactions | Never for final validation |

---

## Integration Gotchas

Common mistakes when connecting to external services/programs.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| AMM Program CPI | Not signing with Tax PDA | Use `invoke_signed` with `swap_authority` seeds |
| Staking Program deposit | Forgetting to track pending_rewards | `deposit_rewards` updates StakePool.pending_rewards |
| EpochState read | Using stale epoch data | Always pass fresh EpochState account |
| Token-2022 transfer | Omitting ExtraAccountMetaList | Include the PDA for each mint in transfer |
| Carnage CPI | Not validating caller is Epoch Program | Require carnage_signer PDA as Signer |
| Transfer Hook | Vault not whitelisted | Add vault to whitelist BEFORE any transfers |
| WSOL handling | Using Token-2022 program | WSOL uses SPL Token program |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Large swap amounts | Overflow errors | Use u128 intermediates | > 10B lamports in edge cases |
| Many accounts in instruction | Transaction too large | Minimize account list | > 35 accounts |
| Complex CPI chains | Compute budget exceeded | Request 200k CU explicitly | Default budget insufficient |
| Event logging | Compute budget exceeded | Use minimal event data | Many fields in event struct |

---

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Wrong tax rate read | Users pay incorrect tax | Validate EpochState PDA derivation |
| Tax destination spoofing | Tax sent to attacker | Validate escrow/carnage/treasury PDAs |
| Pool type mismatch | Taxed pool treated as untaxed | Verify pool.pool_type matches instruction |
| Skip tax on exempt path | Revenue loss | swap_exempt only callable by Carnage PDA |
| No slippage check | MEV sandwich attacks | Require min_output parameter |
| Missing slippage on Carnage | MEV extraction | Intentional: Carnage has no slippage by design |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Tax calculation:** Often missing u128 intermediate type -- verify overflow protection at u64::MAX
- [ ] **Distribution split:** Often missing remainder-based final portion -- verify sum equals total
- [ ] **swap_exempt:** Often missing PDA signer validation -- verify Carnage authority required as Signer
- [ ] **Mixed pool transfer:** Often missing second token program -- verify both programs passed
- [ ] **AMM CPI:** Often missing Tax PDA signature -- verify `invoke_signed` with swap_authority seeds
- [ ] **Compute budget:** Often missing explicit request -- verify 200k CU for normal swaps
- [ ] **Error handling:** Often missing specific error codes -- verify TaxError enum covers all failure modes
- [ ] **Events:** Often missing yield/carnage/treasury portions in TaxedSwap event
- [ ] **Pool validation:** Often missing pool_type check -- verify instruction matches pool
- [ ] **EpochState validation:** Often missing PDA derivation check -- verify canonical PDA
- [ ] **Destination validation:** Often missing PDA checks on escrow/carnage/treasury

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Tax overflow | LOW | Deploy patched program, no state migration (stateless) |
| Wrong tax direction | MEDIUM | Deploy fix + communicate; lost tax is lost |
| Rounding dust | LOW | Fix in next deploy; accumulated dust stays in source |
| CPI depth exceeded | LOW | Redesign instruction; use two-instruction bundle |
| Token program mismatch | LOW | Fix account struct; transactions just fail, no state corruption |
| swap_exempt exploit | **UNRECOVERABLE** | Cannot patch after authority burn |

**Critical Note:** The protocol burns upgrade authority post-deployment. `swap_exempt` exploit has no recovery path -- it MUST be correct before authority burn. This is the highest-stakes pitfall.

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification Method |
|---------|------------------|---------------------|
| Tax calculation overflow | Tax Program Core | Unit tests with u64::MAX amounts |
| Wrong tax application point | Tax Program Core | Integration tests verify SOL-denominated tax |
| Distribution rounding | Tax Program Core | Property test: sum == total for 1000 random amounts |
| CPI depth exceeded | swap_exempt Implementation | Test with full hook chain on devnet |
| Mixed T22/SPL confusion | Tax Program Core | Instruction struct enforces program IDs |
| swap_exempt unauthorized | swap_exempt Implementation | Negative test: user call fails |
| EpochState validation | Tax Program Core | Anchor PDA seeds constraint |
| Destination validation | Tax Program Core | Anchor PDA seeds constraints |
| Pool type mismatch | Tax Program Core | require! check on pool.pool_type |

---

## Protocol-Specific Risks

These risks are unique to the Dr. Fraudsworth Tax Program design.

### Risk 1: Asymmetric Tax Regime Mismatch

The EpochState contains a "cheap side" regime where one token has low buy/high sell tax and the other has high buy/low sell tax. If the Tax Program reads the wrong token's rates, arbitrage breaks.

**Prevention:**
- Derive tax rates from pool type, not guessing
- `get_tax_rates(pool_type, direction, epoch_state)` function encapsulates rate lookup
- Unit test: all 8 combinations (2 tokens x 2 directions x 2 regimes)

### Risk 2: PROFIT Pool Gets Taxed

PROFIT pools (CRIME/PROFIT, FRAUD/PROFIT) should have 0% tax. If swap_profit instruction accidentally applies tax, it breaks the yield mechanics.

**Prevention:**
- Separate instructions: `swap_sol_buy`, `swap_sol_sell`, `swap_profit`
- `swap_profit` has no tax calculation code at all
- Integration test: verify 0% tax on PROFIT pool swaps

### Risk 3: Carnage SOL Goes to Wrong Vault

Carnage deposits 24% of tax to `carnage_sol_vault`. If this goes to wrong account, Carnage Fund is drained.

**Prevention:**
- Hardcode carnage_sol_vault PDA derivation in Tax Program
- `seeds = [b"carnage_sol_vault"], seeds::program = epoch_program::ID`
- Cannot be spoofed because derivation is deterministic

---

## Test Requirements Summary

Tests that MUST pass before considering Tax Program complete:

**Unit Tests:**
- [ ] Tax calculation with amount = 0, 1, u64::MAX
- [ ] Tax calculation with rate = 0, 100, 400, 1100, 1400 bps
- [ ] Distribution split: verify sum == total for amounts 1 to 10000
- [ ] Distribution split: verify portions are correct (75/24/1)

**Integration Tests:**
- [ ] swap_sol_buy: correct SOL tax deducted from input
- [ ] swap_sol_sell: correct SOL tax deducted from output
- [ ] swap_profit: zero tax applied
- [ ] All three destinations receive correct amounts
- [ ] CRIME and FRAUD pools both work (T22 side)
- [ ] WSOL transfers use SPL Token program

**Security Tests (Negative):**
- [ ] swap_exempt fails when called by user (not Carnage PDA)
- [ ] Fake EpochState rejected (wrong PDA)
- [ ] Fake destination accounts rejected (wrong PDAs)
- [ ] Wrong pool type rejected for each instruction

**Devnet Tests:**
- [ ] Full swap with transfer hooks enabled
- [ ] Carnage path at CPI depth 4 succeeds
- [ ] Compute budget is sufficient (200k CU)

---

## Sources

**Official Documentation:**
- [Solana CPI Documentation](https://solana.com/docs/core/cpi)
- [Solana Program Limitations](https://solana.com/docs/programs/limitations)
- [Token-2022 Transfer Hook Guide](https://solana.com/developers/guides/token-extensions/transfer-hook)

**Security Resources:**
- [Helius: A Hitchhiker's Guide to Solana Program Security](https://www.helius.dev/blog/a-hitchhikers-guide-to-solana-program-security)
- [Asymmetric Research: CPI Vulnerabilities](https://blog.asymmetric.re/invocation-security-navigating-vulnerabilities-in-solana-cpis/)
- [Sec3: Arithmetic Overflow in Solana](https://www.sec3.dev/blog/understanding-arithmetic-overflow-underflows-in-rust-and-solana)
- [Neodyme: Token-2022 Security](https://neodyme.io/en/blog/token-2022/)
- [Helius: Solana Arithmetic Best Practices](https://www.helius.dev/blog/solana-arithmetic)
- [Solana Program Vulnerabilities Guide](https://gist.github.com/zfedoran/9130d71aa7e23f4437180fd4ad6adc8f)

**Protocol Documentation:**
- Tax_Pool_Logic_Spec.md (Sections 4, 5, 11, 14, 19)
- Carnage_Fund_Spec.md (Section 2 - CPI Depth Analysis)
- Token_Program_Reference.md (Mixed pool security)
- Transfer_Hook_Spec.md (Whitelist requirements)
- New_Yield_System_Spec.md (Staking escrow integration)
- VRF_Migration_Lessons.md (Pitfall catalog pattern)

---

*Pitfalls research for: Tax Program CPI Orchestrator*
*Researched: 2026-02-06*
