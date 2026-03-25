# Dr. Fraudsworth's Finance Factory
## Bonding Curve Launch Specification

---

## 1. Purpose

This document defines the **Bonding Curve Launch System** that handles initial token distribution for CRIME and FRAUD.

The bonding curve:
- Distributes 46% of each token supply via price discovery
- Raises SOL for pool seeding
- Supports sell-back to curve with 15% tax escrow
- Enforces per-wallet caps via ATA balance reads (open access)
- Transitions atomically to pool seeding upon completion
- Provides burn-and-claim refund mechanism if launch fails

This is the **protocol's entry point**. All subsequent mechanics depend on successful curve completion.

---

## 2. Design Constraints (Hard)

- Linear price curve (predictable, auditable)
- Curve end price MUST match pool seeding price (no arbitrage gap)
- Two identical curves (CRIME and FRAUD) launch simultaneously
- Both curves must complete for transition (atomic success/failure)
- Buy and sell-back supported (sell walks curve backward, 15% tax on sells)
- Open access -- 20M token per-wallet cap is sole sybil resistance
- Sells disabled once curve reaches Filled status
- 48-hour deadline with burn-and-claim refunds
- All token holdings in program-controlled PDAs (trustless)

---

## 3. Economic Parameters

### 3.1 Token Allocation (Per Token: CRIME and FRAUD)

| Allocation | Amount | Percentage |
|------------|--------|------------|
| Bonding Curve Sale | 460,000,000 | 46% |
| SOL Pool Seeding | 290,000,000 | 29% |
| Vault Seeding | 250,000,000 | 25% |
| **Total Supply** | **1,000,000,000** | **100%** |

### 3.2 Curve Parameters

| Parameter | Value |
|-----------|-------|
| Tokens for sale | 460,000,000 |
| Target SOL raise | 500 SOL |
| Start price | 0.00000045 SOL per token |
| End price | 0.000001725 SOL per token |
| Price increase | ~3.83× across curve |

### 3.3 Price Derivation

The end price is **constrained** by pool seeding requirements:

```
Pool seeding: 290M tokens + 500 SOL
Pool price = 500 / 290,000,000 = 0.000001725 SOL per token

Curve must end at this price to prevent arbitrage at transition.
```

Start price derived from linear curve integral:

```
Total raised = tokens_sold × (P_start + P_end) / 2
500 = 460,000,000 × (P_start + 0.000001725) / 2

Solving:
P_start = 0.00000045 SOL per token
```

### 3.4 Market Cap Trajectory (at $100/SOL)

| Stage | Price (SOL) | FDV |
|-------|-------------|-----|
| Curve Start | 0.00000045 | ~$45,000 |
| Curve End | 0.000001725 | ~$172,500 |
| Pool Launch | 0.000001725 | ~$172,500 |

### 3.5 Pool Seeding Parameters

At transition, two liquidity pools and a conversion vault are seeded from reserve allocations:

| Pool | Token A | Amount A | Token B | Amount B | Initial Price |
|------|---------|----------|---------|----------|---------------|
| CRIME/SOL | CRIME | 290,000,000 | wSOL | 500 | 0.000001725 SOL/CRIME |
| FRAUD/SOL | FRAUD | 290,000,000 | wSOL | 500 | 0.000001725 SOL/FRAUD |

**Conversion Vault Seeding:**
The conversion vault is seeded with 250M CRIME, 250M FRAUD, and 20M PROFIT (mainnet supply).
The vault provides fixed-rate 100:1 conversion (100 CRIME or FRAUD → 1 PROFIT) with zero fees.
Previously, PROFIT was distributed via CRIME/PROFIT and FRAUD/PROFIT AMM pools — these have been
replaced by the deterministic vault to eliminate leverage amplification vulnerability.

**PROFIT Total Supply:** 20,000,000 (20M) — 100% allocated to conversion vault seeding, no bonding curve for PROFIT.

**Symmetric Launch Confirmation:**
- CRIME/SOL and FRAUD/SOL pools are identically seeded (290M tokens + 500 SOL each)
- Conversion vault is seeded symmetrically with 250M CRIME and 250M FRAUD
- CRIME and FRAUD launch at the same price against SOL and convert to PROFIT at the same fixed rate
- No pricing advantage exists for either token at launch

**Source of Pool & Vault Assets:**
- SOL pools: Funded by bonding curve raises (500 SOL from CRIME curve + 500 SOL from FRAUD curve)
- Conversion vault: PROFIT minted directly to vault; CRIME/FRAUD from reserve allocation (not from curve sale)

---

## 4. Linear Curve Formula

### 4.1 Price Function

```rust
/// Calculate current price based on tokens already sold
fn get_current_price(tokens_sold: u64) -> u64 {
    // Price in lamports per token (scaled by 1e9 for precision)
    // P(x) = P_start + (P_end - P_start) * x / TOTAL_FOR_SALE
    
    const P_START: u128 = 450;           // 0.00000045 SOL = 450 lamports per 1M tokens
    const P_END: u128 = 1725;             // 0.000001725 SOL = 1725 lamports per 1M tokens
    const TOTAL_FOR_SALE: u128 = 460_000_000_000_000; // 460M with 6 decimals
    
    let price_delta = P_END - P_START;
    let progress = (tokens_sold as u128 * PRECISION) / TOTAL_FOR_SALE;
    
    P_START + (price_delta * progress / PRECISION)
}
```

### 4.2 Purchase Calculation

For a purchase of `sol_amount`:

```rust
/// Calculate tokens received for a given SOL input
/// Uses integral of linear price function
fn calculate_tokens_out(
    sol_amount: u64,
    current_sold: u64,
) -> Result<u64> {
    // For linear curve P(x) = a + bx, integral from x1 to x2:
    // SOL = integral(P(x))dx = a*(x2-x1) + b*(x2² - x1²)/2
    //
    // Solving for x2 given SOL and x1:
    // This is a quadratic equation. For simplicity, we use
    // iterative approximation or closed-form solution.
    
    let tokens_out = solve_linear_integral(
        sol_amount,
        current_sold,
        P_START,
        P_END,
        TOTAL_FOR_SALE,
    )?;
    
    // Ensure we don't exceed remaining supply
    let remaining = TOTAL_FOR_SALE - current_sold;
    Ok(std::cmp::min(tokens_out, remaining))
}
```

### 4.3 Closed-Form Solution

For a linear curve `P(x) = a + bx` where:
- `a = P_START`
- `b = (P_END - P_START) / TOTAL_FOR_SALE`

Given SOL input `S` and current sold `x1`, tokens out `Δx = x2 - x1`:

```
S = a*Δx + b*(x2² - x1²)/2
S = a*Δx + b*(x1 + Δx/2)*Δx
S = Δx * (a + b*x1 + b*Δx/2)

Rearranging (quadratic in Δx):
(b/2)*Δx² + (a + b*x1)*Δx - S = 0

Using quadratic formula:
Δx = (-(a + b*x1) + sqrt((a + b*x1)² + 2*b*S)) / b
```

### 4.4 Implementation

```rust
fn solve_linear_integral(
    sol_lamports: u64,
    current_sold: u64,
    p_start: u128,
    p_end: u128,
    total_for_sale: u128,
) -> Result<u64> {
    // Scale everything to avoid precision loss
    const PRECISION: u128 = 1_000_000_000_000; // 1e12
    
    let a = p_start * PRECISION;
    let b = ((p_end - p_start) * PRECISION) / total_for_sale;
    let x1 = current_sold as u128;
    let s = sol_lamports as u128 * PRECISION;
    
    // Coefficients for quadratic: (b/2)*Δx² + (a + b*x1)*Δx - S = 0
    let coef_linear = a + (b * x1 / PRECISION);
    
    // Discriminant: (a + b*x1)² + 2*b*S
    let discriminant = (coef_linear * coef_linear / PRECISION) 
        + (2 * b * s / PRECISION);
    
    let sqrt_disc = integer_sqrt(discriminant)?;
    
    // Δx = (-coef_linear + sqrt_disc) / (b / PRECISION)
    // Only positive root is valid
    let delta_x = ((sqrt_disc - coef_linear) * PRECISION) / b;
    
    Ok(delta_x as u64)
}
```

### 4.5 Reverse Integral (Sell-Back)

Selling walks the curve **backward**: when a user sells `N` tokens back to the curve, `tokens_sold` decreases by `N`, and the price drops for the next buyer. The SOL returned to the seller is computed using the same linear integral as the buy formula, applied in the reverse direction.

**Formula:**

For a linear curve `P(x) = a + bx`, selling `N` tokens when the current state is `tokens_sold = x1`:

```
x2 = x1 - N  (new tokens_sold after sell)

SOL_gross = integral from x2 to x1 of P(x)dx
          = a * N + b * (x1^2 - x2^2) / 2
          = a * N + b * (x1 + x2) * N / 2
          = N * (a + b * (x1 + x2) / 2)
```

This is algebraically identical to the buy formula -- the same area-under-curve calculation, just applied in the reverse direction. No new mathematical machinery is needed.

**Tax Deduction Ordering (Critical):**

The 15% sell tax is deducted from the **SOL output**, NOT from the token count. The exact steps, in order:

1. Compute `SOL_gross` via reverse integral: `SOL_gross = N * (a + b * (x1 + x2) / 2)`
2. Compute tax: `tax = SOL_gross * 15 / 100` (integer math, truncation rounds in protocol's favor)
3. Compute net payout: `SOL_net = SOL_gross - tax`
4. Transfer `SOL_net` to user from `sol_vault` PDA
5. Transfer `tax` to `tax_escrow` PDA (see Section 5.7)
6. Decrement `tokens_sold` by the **full** `N` (NOT by 85% of N -- the tax is on SOL, not tokens)

**Why this ordering matters:** If the tax were applied to tokens instead of SOL, the curve rollback amount would differ from the number of tokens the user actually returned, creating a desync between token supply accounting and integral pricing. Deducting from SOL preserves the integral identity.

**Slippage Protection:**

The sell instruction includes a `minimum_sol_out: u64` parameter. The program validates:

```rust
require!(
    sol_net >= minimum_sol_out,
    CurveError::SlippageExceeded
);
```

This protects sellers from front-running: if another sell executes first (lowering `tokens_sold` and thus the price range), the seller's `SOL_net` may be less than expected, and the transaction reverts if it falls below their minimum.

**Sell Constraints:**

- Sells are only valid when `curve.status == CurveStatus::Active`
- Once the curve reaches `Filled` status, sells are disabled (prevents grief attacks at the finish line)
- Sells are disabled after the deadline passes (curve transitions to `Failed`)
- The user must hold at least `N` tokens in their ATA

**Worked Example:**

Using the same parameters from Section 3.2:
- `P_start = 0.00000045 SOL`, `P_end = 0.000001725 SOL`
- `TOTAL_FOR_SALE = 460,000,000 tokens`
- `a = P_start`, `b = (P_end - P_start) / TOTAL_FOR_SALE`

Suppose `tokens_sold = 230,000,000` (50% filled) and a user wants to sell `10,000,000` tokens:

```
x1 = 230,000,000
x2 = 220,000,000
N  = 10,000,000

Current price at x1: P(230M) = 0.00000045 + (0.000001275 * 230M / 460M)
                              = 0.00000045 + 0.0000006375
                              = 0.0000010875 SOL

Price at x2:         P(220M) = 0.00000045 + (0.000001275 * 220M / 460M)
                              = 0.00000045 + 0.000000610
                              = 0.00000106 SOL

SOL_gross = 10,000,000 * (0.00000045 + 0.000001275 * (230M + 220M) / (2 * 460M))
          = 10,000,000 * (0.00000045 + 0.000001275 * 450M / 920M)
          = 10,000,000 * (0.00000045 + 0.0000006239)
          = 10,000,000 * 0.0000010739
          = 0.010739 SOL (10,739,000 lamports)

tax       = 10,739,000 * 15 / 100 = 1,610,850 lamports
SOL_net   = 10,739,000 - 1,610,850 = 9,128,150 lamports (0.00913 SOL)
```

After this sell:
- `tokens_sold` decreases from 230M to 220M
- The current price drops from ~0.000002175 to ~0.00000212 SOL
- The user's ATA balance decreases by 10M tokens, freeing cap space for future buys
- 3,221,700 lamports are held in the `tax_escrow` PDA

---

## 5. State Accounts

### 5.1 CurveState (Per Token)

```rust
#[account]
pub struct CurveState {
    /// Token this curve is selling (CRIME or FRAUD)
    pub token: Token,                   // 1 byte

    /// Mint address of the token being sold
    pub token_mint: Pubkey,             // 32 bytes

    /// PDA holding tokens for sale
    pub token_vault: Pubkey,            // 32 bytes

    /// PDA holding raised SOL
    pub sol_vault: Pubkey,              // 32 bytes

    /// Total tokens currently sold (decreases on sells)
    pub tokens_sold: u64,               // 8 bytes

    /// Total SOL raised from buys (gross, does not decrease on sells)
    pub sol_raised: u64,                // 8 bytes

    /// Curve status
    pub status: CurveStatus,            // 1 byte

    /// Slot when curve started (0 if not started)
    pub start_slot: u64,                // 8 bytes

    /// Deadline slot (start_slot + DEADLINE_SLOTS)
    pub deadline_slot: u64,             // 8 bytes

    /// Number of unique purchasers (incremented on first buy when user ATA balance was 0)
    pub participant_count: u32,         // 4 bytes

    /// Cumulative tokens returned to curve via sells
    pub tokens_returned: u64,           // 8 bytes

    /// Cumulative SOL returned to sellers (gross, before tax deduction)
    pub sol_returned: u64,              // 8 bytes

    /// Cumulative sell tax collected (15% of gross sell proceeds)
    pub tax_collected: u64,             // 8 bytes

    /// PDA address of this curve's tax escrow account
    pub tax_escrow: Pubkey,             // 32 bytes

    /// PDA bump
    pub bump: u8,                       // 1 byte

    /// Whether tax escrow has been consolidated into sol_vault for refunds (Phase 73)
    pub escrow_consolidated: bool,      // 1 byte

    /// Mint address of the partner curve's token (Phase 79 FIN-05)
    /// CRIME curve stores FRAUD mint, vice versa.
    /// Used to validate partner_curve_state identity in claim_refund / consolidate_for_refund.
    pub partner_mint: Pubkey,           // 32 bytes
}
```

**Size:** 1 + 32 + 32 + 32 + 8 + 8 + 1 + 8 + 8 + 4 + 8 + 8 + 8 + 32 + 1 + 1 + 32 = 224 bytes (+ 8 discriminator = 232 bytes)

**Notes on new fields:**
- `tokens_returned`, `sol_returned`, `tax_collected` are cumulative counters tracking all sell activity. These are convenience fields for display and analytics.
- `tax_collected` is a convenience tracking field; the **authoritative** tax balance is the `tax_escrow` PDA's lamports (no desync risk).
- `participant_count` is a lightweight counter incremented on first buy (when the user's ATA had zero balance before this purchase). Cheaper than requiring an indexer for a basic stat.

### 5.2 CurveStatus Enum

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum CurveStatus {
    /// Curve initialized but not started
    Initialized,

    /// Curve is active, accepting buys and sells
    Active,

    /// Curve reached target (460M sold / 500 SOL raised). Sells disabled.
    Filled,

    /// Deadline passed without filling, or partner failed. Refunds available.
    Failed,

    /// Both curves filled and transition to pools completed. Terminal state.
    Graduated,
}
```

**State Machine Transition Table:**

| From | To | Trigger | Condition |
|------|----|---------|-----------|
| Initialized | Active | `start_curve` | Curve funded, authority calls |
| Active | Filled | `purchase` (fills) | `tokens_sold >= TARGET_TOKENS` after purchase |
| Active | Failed | `mark_failed` | `clock.slot > deadline_slot` |
| Filled | Graduated | `finalize_transition` | Partner curve also Filled or Graduated |
| Filled | Failed (effective) | Partner fails | Partner curve `status == Failed` |

**Terminal states:** `Graduated` and `Failed` are terminal. No transitions out of these states.

**Sells-when-Filled:** Sell instructions are only valid when `status == Active`. Once `Filled`, sells are disabled. This prevents grief attacks at the finish line and ensures the SOL vault is stable once the curve reaches its target.

**Compound States:**

The `Filled` status can exist in two contexts:
1. **Filled, partner Active:** Waiting for partner to fill. Transition pending.
2. **Filled, partner Failed:** Transition impossible. Refunds available.

A Filled curve whose partner fails becomes refund-eligible. The status may remain `Filled`, but `is_refund_eligible()` returns `true` when the partner is `Failed`.

```rust
pub fn is_refund_eligible(&self, partner_status: CurveStatus) -> bool {
    match self.status {
        CurveStatus::Failed => true,
        CurveStatus::Filled => partner_status == CurveStatus::Failed,
        _ => false,
    }
}
```

### 5.3 PDA Derivations

**CurveState:**
```
seeds = ["curve", token_mint]
program = curve_program
```

**Token Vault (holds tokens for sale):**
```
seeds = ["curve_token_vault", token_mint]
program = curve_program
```

**SOL Vault (holds raised SOL):**
```
seeds = ["curve_sol_vault", token_mint]
program = curve_program
```

### 5.4 ParticipantState -- REMOVED (v1.2)

> **ParticipantState eliminated in v1.2.** Per-wallet cap enforcement uses ATA balance reads directly (see Section 6.1). Purchase history is available via emitted events (see Section 10). Refund uses burn-and-claim -- users burn tokens from their ATA to receive proportional SOL (see Section 8). No per-user on-chain PDA is needed.

### 5.5 WhitelistEntry -- REMOVED (v1.2)

> **WhitelistEntry eliminated in v1.2.** Open access -- the 20M token per-wallet cap is the sole sybil resistance. The Transfer Hook whitelist (separate from the curve program) prevents wallet-to-wallet transfers during the curve phase, making ATA balance reads safe for cap enforcement. No Privy verification or on-chain whitelist PDA is needed.

### 5.6 ReserveState -- REMOVED (v1.2)

> **ReserveState eliminated in v1.2.** Reserve tokens (290M pool seed + 250M vault seed per token) are managed by existing protocol infrastructure. The curve program only handles: 460M sale tokens per curve, the SOL vault, and the tax escrow. See `Protocol_Initialization_and_Launch_Flow.md` for reserve token management.

### 5.7 Tax Escrow PDA (Per Curve)

The tax escrow is a SOL-only PDA that accumulates the 15% sell tax. One escrow exists per curve (CRIME escrow, FRAUD escrow).

**PDA Derivation:**
```
seeds = ["tax_escrow", token_mint.key()]
program = curve_program
```

**Data Size:** 0 bytes (SOL-only PDA). The escrow balance IS the PDA's lamports. No data struct is needed.

**Rent:** Must maintain rent-exempt minimum lamports at all times (currently ~890,880 lamports for 0-byte account).

**Balance Reading:**
```rust
// Read tax escrow balance (authoritative source of truth)
let escrow_balance = ctx.accounts.tax_escrow.lamports();
// Do NOT use curve_state.tax_collected for financial calculations --
// it's a convenience counter. The PDA lamports are authoritative.
```

**Lifecycle:**

| Phase | Action | Details |
|-------|--------|---------|
| Initialization | Created | `initialize_curve` creates the tax escrow PDA alongside the curve state |
| Active (sells) | Funded | Each sell transfers `SOL_gross * 15 / 100` lamports from `sol_vault` to `tax_escrow` |
| Graduation (success) | Distributed | `distribute_tax_escrow` transfers all escrow lamports to the carnage fund |
| Failure | Consolidated | `consolidate_for_refund` merges escrow lamports into `sol_vault` PDA before refund claims begin |

**Why separate from sol_vault:** The SOL vault holds curve reserves that must match the integral pricing at all times. Tax proceeds are separate -- they route to the carnage fund on success or merge back into the refund pool on failure. Mixing them in a single account would break the integral identity (`sol_vault_balance == integral(0, tokens_sold)`).

---

## 6. Purchase Constraints

### 6.1 Per-Wallet Token Cap

```rust
pub const MAX_TOKENS_PER_WALLET: u64 = 20_000_000_000_000; // 20M with 6 decimals
```

**Enforcement (ATA Balance Read):**
```rust
// Read current balance directly from user's Associated Token Account
let current_balance = ctx.accounts.user_token_account.amount;

require!(
    current_balance + tokens_to_receive <= MAX_TOKENS_PER_WALLET,
    CurveError::WalletCapExceeded
);
```

**Cap applies per-curve:** A wallet can hold 20M CRIME AND 20M FRAUD (separate caps).

**Selling frees cap space:** After selling tokens back to the curve, the user's ATA balance decreases, allowing future buys up to the cap again. This is intentional -- the 15% sell tax makes cap recycling unprofitable for wash trading.

**Safety guarantee:** The Transfer Hook whitelist prevents wallet-to-wallet transfers during the curve phase. Only protocol PDAs (whitelisted) can be transfer destinations. Users cannot shuffle tokens to a new wallet to circumvent the cap. ATA balance is the authoritative source of "how many tokens does this user hold."

### 6.2 Minimum Purchase

```rust
pub const MIN_PURCHASE_SOL: u64 = 50_000_000; // 0.05 SOL in lamports
```

### 6.3 Whitelist Requirement -- REMOVED (v1.2)

> **Whitelist requirement eliminated in v1.2.** Open access -- no whitelist PDA or verification is needed to purchase. The 20M token per-wallet cap (Section 6.1) is the sole sybil resistance. See Section 2 (Design Constraints) and Section 5.5 note.

---

## 7. Timing

### 7.1 Constants

```rust
/// Deadline in slots (~48 hours at 400ms/slot)
pub const DEADLINE_SLOTS: u64 = 432_000; // 48 * 60 * 60 * 1000 / 400

/// Target tokens to sell
pub const TARGET_TOKENS: u64 = 460_000_000_000_000; // 460M with 6 decimals

/// Target SOL to raise
pub const TARGET_SOL: u64 = 500_000_000_000; // 500 SOL in lamports
```

### 7.2 Deadline Enforcement

The 48-hour deadline applies from when the **first** curve starts (i.e., when `start_curve` is called). Both curves should be started in the same transaction or back-to-back to share the same deadline window. Each curve's `deadline_slot` is set independently in `start_curve`, so starting them simultaneously ensures identical deadlines.

```rust
fn check_deadline(curve: &CurveState) -> Result<()> {
    let clock = Clock::get()?;

    if curve.status == CurveStatus::Active {
        if clock.slot > curve.deadline_slot {
            // Curve has failed - should transition to Failed status
            return Err(CurveError::DeadlinePassed.into());
        }
    }

    Ok(())
}
```

**Deadline applies to both buys and sells.** Once the deadline passes, no further buys or sells are possible. The curve must be marked `Failed` via `mark_failed`.

---

## 8. Instructions

### 8.1 initialize_curve

Creates curve state for CRIME or FRAUD. Called once per token at deployment. Also creates the tax escrow PDA for this curve.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| authority | Signer | Deployer |
| curve_state | Init PDA | Curve state account |
| token_vault | Init PDA | Holds tokens for sale |
| sol_vault | Init PDA | Holds raised SOL |
| tax_escrow | Init PDA | Tax escrow (0-byte SOL-only PDA, see Section 5.7) |
| token_mint | Account | CRIME or FRAUD mint |
| token_program | Program | Token-2022 program |
| system_program | Program | System program |

**Logic:**

```rust
pub fn initialize_curve(
    ctx: Context<InitializeCurve>,
    token: Token,
) -> Result<()> {
    let curve = &mut ctx.accounts.curve_state;

    curve.token = token;
    curve.token_mint = ctx.accounts.token_mint.key();
    curve.token_vault = ctx.accounts.token_vault.key();
    curve.sol_vault = ctx.accounts.sol_vault.key();
    curve.tokens_sold = 0;
    curve.sol_raised = 0;
    curve.status = CurveStatus::Initialized;
    curve.start_slot = 0;
    curve.deadline_slot = 0;
    curve.participant_count = 0;
    curve.tokens_returned = 0;
    curve.sol_returned = 0;
    curve.tax_collected = 0;
    curve.tax_escrow = ctx.accounts.tax_escrow.key();
    curve.bump = ctx.bumps.curve_state;

    emit!(CurveInitialized {
        token,
        token_mint: curve.token_mint,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
```

**Notes:**
- The `tax_escrow` PDA is created as a 0-byte SOL-only account (rent-exempt minimum lamports, no data). Its seeds are `["tax_escrow", token_mint.key()]`.
- The new CurveState fields (`tokens_returned`, `sol_returned`, `tax_collected`) are initialized to 0.
- The `tax_escrow` pubkey is stored in CurveState for convenience; the PDA can also be derived from seeds.

**Callable:** Once per token, at deployment.

---

### 8.2 fund_curve

Transfers tokens from Reserve to Curve vault. Called after minting.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| authority | Signer | Deployer |
| curve_state | Mut PDA | Curve state |
| token_vault | Mut PDA | Curve's token vault |
| reserve_vault | Mut PDA | Reserve's token vault |
| token_mint | Account | Token mint |
| token_program | Program | Token-2022 program |

**Logic:**

```rust
pub fn fund_curve(ctx: Context<FundCurve>) -> Result<()> {
    let curve = &ctx.accounts.curve_state;
    
    require!(
        curve.status == CurveStatus::Initialized,
        CurveError::InvalidStatus
    );
    
    // Transfer 460M tokens from reserve to curve vault
    let transfer_amount = TARGET_TOKENS;
    
    // CPI transfer with reserve PDA signer
    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.reserve_vault.to_account_info(),
                to: ctx.accounts.token_vault.to_account_info(),
                mint: ctx.accounts.token_mint.to_account_info(),
                authority: ctx.accounts.reserve_pda.to_account_info(),
            },
            &[reserve_seeds],
        ),
        transfer_amount,
        6, // decimals
    )?;
    
    emit!(CurveFunded {
        token: curve.token,
        amount: transfer_amount,
    });
    
    Ok(())
}
```

**Callable:** Once per curve, after token minting.

---

### 8.3 start_curve

Activates the curve for purchases. Sets deadline.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| authority | Signer | Deployer |
| curve_state | Mut PDA | Curve state |

**Logic:**

```rust
pub fn start_curve(ctx: Context<StartCurve>) -> Result<()> {
    let curve = &mut ctx.accounts.curve_state;
    let clock = Clock::get()?;
    
    require!(
        curve.status == CurveStatus::Initialized,
        CurveError::InvalidStatus
    );
    
    // Verify curve is funded
    let vault_balance = get_token_balance(&ctx.accounts.token_vault)?;
    require!(
        vault_balance >= TARGET_TOKENS,
        CurveError::CurveNotFunded
    );
    
    curve.status = CurveStatus::Active;
    curve.start_slot = clock.slot;
    curve.deadline_slot = clock.slot + DEADLINE_SLOTS;
    
    emit!(CurveStarted {
        token: curve.token,
        start_slot: curve.start_slot,
        deadline_slot: curve.deadline_slot,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}
```

**Callable:** Once per curve, by deployer.

---

### 8.4 add_to_whitelist -- REMOVED (v1.2)

> **`add_to_whitelist` removed in v1.2.** Open access with per-wallet cap (20M tokens) is the sole sybil resistance. No whitelist PDA, no Privy verification, no backend authority needed. See Section 2 (Design Constraints), Section 5.5, and Section 6.3.
>
> Section number preserved to maintain cross-references within the document.

---

### 8.5 purchase

Buys tokens from the curve. Open access -- no whitelist required.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| user | Signer, Mut | Purchaser |
| curve_state | Mut PDA | Curve state |
| user_token_account | Mut | User's ATA for this token (used for cap enforcement) |
| token_vault | Mut PDA | Curve's token vault |
| sol_vault | Mut PDA | Curve's SOL vault |
| token_mint | Account | Token mint |
| token_program | Program | Token-2022 program |
| system_program | Program | System program |

**Args:**

| Arg | Type | Description |
|-----|------|-------------|
| sol_amount | u64 | SOL to spend (in lamports) |

**Validation:**

1. `curve_state.status == CurveStatus::Active` -- error: `CurveNotActive`
2. `clock.slot <= curve_state.deadline_slot` -- error: `DeadlinePassed`
3. `sol_amount >= MIN_PURCHASE_SOL` -- error: `BelowMinimum`
4. Wallet cap: `user_token_account.amount + tokens_to_receive <= MAX_TOKENS_PER_WALLET` -- error: `WalletCapExceeded`

**Logic:**

```rust
pub fn purchase(
    ctx: Context<Purchase>,
    sol_amount: u64,
) -> Result<()> {
    let curve = &mut ctx.accounts.curve_state;
    let clock = Clock::get()?;

    // === VALIDATIONS ===

    // Curve must be active
    require!(
        curve.status == CurveStatus::Active,
        CurveError::CurveNotActive
    );

    // Check deadline
    require!(
        clock.slot <= curve.deadline_slot,
        CurveError::DeadlinePassed
    );

    // Minimum purchase
    require!(
        sol_amount >= MIN_PURCHASE_SOL,
        CurveError::BelowMinimum
    );

    // === CALCULATE TOKENS ===

    let tokens_out = calculate_tokens_out(sol_amount, curve.tokens_sold)?;

    // Check wallet cap via ATA balance read (no ParticipantState needed)
    let user_ata_balance = ctx.accounts.user_token_account.amount;
    require!(
        user_ata_balance
            .checked_add(tokens_out)
            .ok_or(CurveError::Overflow)?
            <= MAX_TOKENS_PER_WALLET,
        CurveError::WalletCapExceeded
    );

    // Check remaining supply
    let remaining = TARGET_TOKENS - curve.tokens_sold;
    let actual_tokens = std::cmp::min(tokens_out, remaining);

    // Recalculate SOL needed if partial fill
    let actual_sol = if actual_tokens < tokens_out {
        calculate_sol_for_tokens(curve.tokens_sold, actual_tokens)?
    } else {
        sol_amount
    };

    // Re-check cap with actual_tokens (may differ from tokens_out on partial fill)
    require!(
        user_ata_balance + actual_tokens <= MAX_TOKENS_PER_WALLET,
        CurveError::WalletCapExceeded
    );

    // === EXECUTE TRANSFERS ===

    // Transfer SOL from user to vault
    let transfer_sol_ix = system_instruction::transfer(
        &ctx.accounts.user.key(),
        &ctx.accounts.sol_vault.key(),
        actual_sol,
    );
    invoke(
        &transfer_sol_ix,
        &[
            ctx.accounts.user.to_account_info(),
            ctx.accounts.sol_vault.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
    )?;

    // Transfer tokens from vault to user
    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.token_vault.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                mint: ctx.accounts.token_mint.to_account_info(),
                authority: ctx.accounts.curve_pda.to_account_info(),
            },
            &[curve_seeds],
        ),
        actual_tokens,
        6,
    )?;

    // === UPDATE STATE ===

    // Increment participant count on first purchase (ATA was empty before this buy)
    if user_ata_balance == 0 {
        curve.participant_count += 1;
    }

    // Update curve state
    curve.tokens_sold = curve.tokens_sold
        .checked_add(actual_tokens)
        .ok_or(CurveError::Overflow)?;
    curve.sol_raised = curve.sol_raised
        .checked_add(actual_sol)
        .ok_or(CurveError::Overflow)?;

    // Check if curve is now filled
    if curve.tokens_sold >= TARGET_TOKENS {
        curve.status = CurveStatus::Filled;

        emit!(CurveFilled {
            token: curve.token,
            total_sold: curve.tokens_sold,
            total_raised: curve.sol_raised,
            slot: clock.slot,
        });
    }

    emit!(TokensPurchased {
        user: ctx.accounts.user.key(),
        token: curve.token,
        sol_spent: actual_sol,
        tokens_received: actual_tokens,
        new_tokens_sold: curve.tokens_sold,
        current_price: get_current_price(curve.tokens_sold),
        slot: clock.slot,
    });

    Ok(())
}
```

**Notes:**
- Cap enforcement uses the user's ATA balance directly -- no ParticipantState PDA needed. The Transfer Hook whitelist prevents wallet-to-wallet transfers during the curve phase, making ATA balance reads safe (see Section 6.1).
- `participant_count` is incremented when `user_ata_balance == 0` (first purchase). If a user sells all tokens and buys again, they are NOT double-counted because `participant_count` is a convenience stat, not a security-critical field.
- The event name is `TokensPurchased` (renamed from `Purchase` for clarity alongside the `TokensSold` sell event).

**Callable:** By anyone while curve is active. Open access.

---

### 8.6 sell

Sells tokens back to the curve. Walks the curve backward, decreasing `tokens_sold` and lowering the price for the next buyer. A 15% tax is deducted from the SOL output and routed to the tax escrow PDA.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| user | Signer, Mut | The seller |
| curve_state | Mut PDA | PDA for the curve being sold on |
| user_token_account | Mut | User's ATA for this curve's token |
| token_vault | Mut PDA | Program's token vault PDA (receives tokens back) |
| sol_vault | Mut PDA | Program's SOL vault PDA (sends SOL to user) |
| tax_escrow | Mut PDA | Tax escrow PDA (receives 15% tax) |
| token_mint | Account | The token mint (for validation) |
| token_program | Program | Token-2022 program |
| system_program | Program | For SOL transfers |

**Args:**

| Arg | Type | Description |
|-----|------|-------------|
| tokens_to_sell | u64 | Number of tokens to sell back (with decimals) |
| minimum_sol_out | u64 | Minimum SOL (net, after tax) user will accept -- slippage protection |

**Validation:**

1. `curve_state.status == CurveStatus::Active` (NOT Filled, NOT Failed, NOT Graduated) -- error: `CurveNotActiveForSell`
2. `user_token_account.amount >= tokens_to_sell` -- error: `InsufficientTokenBalance`
3. `tokens_to_sell > 0` -- error: `ZeroAmount`
4. `clock.slot <= curve_state.deadline_slot` -- error: `DeadlinePassed` (cannot sell after deadline even if still Active)

**Logic (10 steps -- matches Section 4.5 tax ordering):**

```rust
pub fn sell(
    ctx: Context<Sell>,
    tokens_to_sell: u64,
    minimum_sol_out: u64,
) -> Result<()> {
    let curve = &mut ctx.accounts.curve_state;
    let clock = Clock::get()?;

    // === VALIDATION ===

    require!(
        curve.status == CurveStatus::Active,
        CurveError::CurveNotActiveForSell
    );

    require!(
        ctx.accounts.user_token_account.amount >= tokens_to_sell,
        CurveError::InsufficientTokenBalance
    );

    require!(
        tokens_to_sell > 0,
        CurveError::ZeroAmount
    );

    require!(
        clock.slot <= curve.deadline_slot,
        CurveError::DeadlinePassed
    );

    // === STEP 1: Read current position on curve ===
    let x1 = curve.tokens_sold;

    // === STEP 2: Compute new position after sell ===
    let x2 = x1.checked_sub(tokens_to_sell)
        .ok_or(CurveError::Overflow)?;

    // === STEP 3: Compute SOL_gross via reverse integral (Section 4.5) ===
    // SOL_gross = integral from x2 to x1 of P(x)dx
    //           = N * (a + b * (x1 + x2) / 2)
    let sol_gross = calculate_reverse_integral(
        tokens_to_sell,
        x1,
        x2,
        P_START,
        P_END,
        TOTAL_FOR_SALE,
    )?;

    // === STEP 4: Compute tax (15%, integer division rounds down -- user-favorable) ===
    let tax = sol_gross
        .checked_mul(15)
        .ok_or(CurveError::Overflow)?
        / 100;

    // === STEP 5: Compute SOL_net ===
    let sol_net = sol_gross
        .checked_sub(tax)
        .ok_or(CurveError::Overflow)?;

    // === STEP 6: Slippage check ===
    require!(
        sol_net >= minimum_sol_out,
        CurveError::SlippageExceeded
    );

    // === STEP 7: Transfer tokens from user to vault (tokens return, NOT burned) ===
    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.user_token_account.to_account_info(),
                to: ctx.accounts.token_vault.to_account_info(),
                mint: ctx.accounts.token_mint.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        tokens_to_sell,
        6,
    )?;

    // === STEP 8: Transfer SOL_net from sol_vault to user ===
    **ctx.accounts.sol_vault.try_borrow_mut_lamports()? -= sol_net;
    **ctx.accounts.user.try_borrow_mut_lamports()? += sol_net;

    // === STEP 9: Transfer tax from sol_vault to tax_escrow ===
    **ctx.accounts.sol_vault.try_borrow_mut_lamports()? -= tax;
    **ctx.accounts.tax_escrow.try_borrow_mut_lamports()? += tax;

    // === STEP 10: Update curve_state ===
    curve.tokens_sold = x2;
    curve.sol_returned = curve.sol_returned
        .checked_add(sol_gross)
        .ok_or(CurveError::Overflow)?;
    curve.tokens_returned = curve.tokens_returned
        .checked_add(tokens_to_sell)
        .ok_or(CurveError::Overflow)?;
    curve.tax_collected = curve.tax_collected
        .checked_add(tax)
        .ok_or(CurveError::Overflow)?;

    emit!(TokensSold {
        user: ctx.accounts.user.key(),
        token: curve.token,
        tokens_sold: tokens_to_sell,
        sol_received_net: sol_net,
        tax_amount: tax,
        new_tokens_sold: curve.tokens_sold,
        current_price: get_current_price(curve.tokens_sold),
        slot: clock.slot,
    });

    Ok(())
}
```

**Notes:**
- Tokens go BACK to the vault (not burned) -- they can be re-purchased by another buyer.
- `tokens_sold` decreasing means the price drops for the next buyer (curve walks backward).
- Tax rounding down (integer division `sol_gross * 15 / 100`) means the protocol may collect slightly less than exactly 15% -- acceptable, benefits user.
- Per-wallet cap: selling frees cap space. After selling, the user's ATA balance decreases, allowing future buys up to the 20M cap (see Section 6.1).
- The `sol_returned` field tracks gross SOL (before tax), not net. This preserves the identity: `sol_vault_balance == sol_raised - sol_returned` at all times (tax moves to escrow, not back to users from vault perspective).
- Steps 8 and 9 use direct lamport manipulation (the sol_vault is a program-owned PDA). This is the standard Anchor pattern for PDA-to-user SOL transfers.

**Callable:** By anyone holding tokens, while curve is Active and before deadline.

---

### 8.7 mark_failed

Transitions curve to Failed status after deadline. Permissionless.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| curve_state | Mut PDA | Curve state |

**Logic:**

```rust
pub fn mark_failed(ctx: Context<MarkFailed>) -> Result<()> {
    let curve = &mut ctx.accounts.curve_state;
    let clock = Clock::get()?;

    require!(
        curve.status == CurveStatus::Active,
        CurveError::InvalidStatus
    );

    require!(
        clock.slot > curve.deadline_slot,
        CurveError::DeadlineNotPassed
    );

    curve.status = CurveStatus::Failed;

    emit!(CurveFailed {
        token: curve.token,
        tokens_sold: curve.tokens_sold,
        sol_raised: curve.sol_raised,
        deadline_slot: curve.deadline_slot,
        current_slot: clock.slot,
    });

    Ok(())
}
```

**Callable:** By anyone, after deadline passes on an unfilled curve.

---

### 8.8 claim_refund (Burn-and-Claim)

Claims a proportional SOL refund by burning tokens. Users burn their entire token balance and receive a proportional share of the refund pool (sol_vault after escrow consolidation).

**This is a complete replacement of the v1.0 claim_refund instruction.** The old version used `participant_state.sol_spent` for exact SOL-back refunds. The v1.2 version uses burn-and-claim: burn tokens, receive proportional SOL. This is simpler (no ParticipantState PDA), fairer (accounts for sell activity), and standard (pump.fun, Raydium Launchpad precedent).

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| user | Signer, Mut | The refund claimer |
| curve_state | Mut PDA | Curve state (status must be Failed, OR Filled with partner Failed) |
| user_token_account | Mut | User's ATA for this curve's token |
| sol_vault | Mut PDA | SOL vault PDA (contains sol_raised + consolidated escrow) |
| token_mint | Mut | Token mint (for burning tokens) |
| token_program | Program | Token-2022 program |
| system_program | Program | For SOL transfer |

**Args:** None (burns entire ATA balance).

**Validation:**

1. Curve is refund-eligible: `curve_state.status == CurveStatus::Failed` OR (`curve_state.status == CurveStatus::Filled` AND partner curve is `Failed`) -- error: `CurveNotRefundable`
2. `user_token_account.amount > 0` -- error: `NothingToBurn`
3. Escrow has been consolidated: check that `consolidate_for_refund` has been called (either via a flag on CurveState, or verify the tax_escrow PDA balance is at rent-exempt minimum) -- error: `EscrowNotConsolidated`

**Logic:**

```rust
pub fn claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {
    let curve = &mut ctx.accounts.curve_state;

    // === VALIDATION ===

    // Check refund eligibility (curve failed, or partner failed)
    require!(
        curve.is_refund_eligible(partner_status),
        CurveError::CurveNotRefundable
    );

    // Must have tokens to burn
    let user_balance = ctx.accounts.user_token_account.amount;
    require!(
        user_balance > 0,
        CurveError::NothingToBurn
    );

    // Escrow must be consolidated first
    require!(
        is_escrow_consolidated(&ctx.accounts.tax_escrow),
        CurveError::EscrowNotConsolidated
    );

    // === STEP 1: Read current state ===
    let total_outstanding = curve.tokens_sold;  // current outstanding supply

    // === STEP 2: Compute refund pool ===
    let rent = Rent::get()?;
    let rent_exempt = rent.minimum_balance(0);
    let refund_pool = ctx.accounts.sol_vault.lamports()
        .checked_sub(rent_exempt)
        .ok_or(CurveError::Overflow)?;

    // === STEP 3: Compute proportional refund ===
    let refund_amount = (user_balance as u128)
        .checked_mul(refund_pool as u128)
        .ok_or(CurveError::Overflow)?
        .checked_div(total_outstanding as u128)
        .ok_or(CurveError::DivisionByZero)?
        as u64;

    // === STEP 4: Burn tokens (permanent destruction) ===
    burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.token_mint.to_account_info(),
                from: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        user_balance,
    )?;

    // === STEP 5: Transfer refund SOL to user ===
    **ctx.accounts.sol_vault.try_borrow_mut_lamports()? -= refund_amount;
    **ctx.accounts.user.try_borrow_mut_lamports()? += refund_amount;

    // === STEP 6: Update curve_state (denominator shrinks for next claimer) ===
    curve.tokens_sold = curve.tokens_sold
        .checked_sub(user_balance)
        .ok_or(CurveError::Overflow)?;

    emit!(RefundClaimed {
        user: ctx.accounts.user.key(),
        token: curve.token,
        tokens_burned: user_balance,
        refund_amount,
        remaining_tokens_sold: curve.tokens_sold,
        slot: Clock::get()?.slot,
    });

    Ok(())
}
```

**Why burn-and-claim is correct (worked example):**

Three users hold tokens for a failed curve. The sol_vault holds 800 SOL after escrow consolidation. `tokens_sold = 460,000,000` (460M).

| User | Balance | Share |
|------|---------|-------|
| Alice | 100,000,000 (100M) | 21.7% |
| Bob | 200,000,000 (200M) | 43.5% |
| Carol | 160,000,000 (160M) | 34.8% |

**Alice claims first:**
- `refund = 100M / 460M * 800 SOL = 173.91 SOL`
- Burns 100M tokens. `tokens_sold` drops to 360M. Vault now holds 626.09 SOL.

**Bob claims second:**
- `refund = 200M / 360M * 626.09 SOL = 347.83 SOL`
- Burns 200M tokens. `tokens_sold` drops to 160M. Vault now holds 278.26 SOL.

**Carol claims last:**
- `refund = 160M / 160M * 278.26 SOL = 278.26 SOL`
- Burns 160M tokens. `tokens_sold` drops to 0. Vault now holds 0 SOL.

**Total refunded:** 173.91 + 347.83 + 278.26 = 800 SOL (exactly the pool).

The formula is **order-independent and fully solvent**: because both the numerator (user's tokens) shrinks via burn and the denominator (`tokens_sold`) shrinks by the same amount, subsequent claimers always get their fair proportional share. No double-counting is possible because tokens are permanently burned.

**Notes:**
- Sellers who exited early (via the `sell` instruction) keep their sell proceeds AND get a proportional refund on any remaining tokens they still hold. They took the 15% sell tax hit -- fair game.
- Pure buyers may get back slightly less than deposited (bounded by total sell volume * 15%) because the sell tax reduced the vault balance. The consolidated escrow partially compensates.
- No claim deadline -- refunds available forever on-chain. Frontend removed after ~30 days.
- Double-claim protection is inherent: tokens are burned, so the user cannot call again (validation #2 fails: `amount > 0`).

**Callable:** By any token holder of a refund-eligible curve. Permissionless.

---

### 8.9 consolidate_for_refund

Merges the tax escrow SOL into the sol_vault before refund claims begin. Must be called before any `claim_refund` calls. Permissionless -- anyone can trigger (incentivized by wanting their refund).

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| authority | Signer | Permissionless (anyone can call) |
| curve_state | Mut PDA | Must be in Failed/refund-eligible state |
| tax_escrow | Mut PDA | The curve's tax escrow PDA |
| sol_vault | Mut PDA | The curve's SOL vault PDA |
| system_program | Program | System program |

**Args:** None.

**Validation:**

1. Curve is refund-eligible: `curve_state.status == CurveStatus::Failed` OR (`curve_state.status == CurveStatus::Filled` AND partner curve is `Failed`) -- error: `CurveNotRefundable`
2. Tax escrow has not already been consolidated: `tax_escrow.lamports() > rent_exempt_minimum` (or check a consolidation flag on CurveState) -- error: `EscrowAlreadyConsolidated`

**Logic:**

```rust
pub fn consolidate_for_refund(ctx: Context<ConsolidateForRefund>) -> Result<()> {
    let curve = &mut ctx.accounts.curve_state;

    // Verify refund eligibility
    require!(
        curve.is_refund_eligible(partner_status),
        CurveError::CurveNotRefundable
    );

    // Read escrow balance (minus rent-exempt minimum)
    let rent = Rent::get()?;
    let rent_exempt = rent.minimum_balance(0);
    let escrow_balance = ctx.accounts.tax_escrow.lamports()
        .checked_sub(rent_exempt)
        .ok_or(CurveError::Overflow)?;

    // Guard: nothing to consolidate
    require!(
        escrow_balance > 0,
        CurveError::EscrowAlreadyConsolidated
    );

    // Transfer escrow lamports to sol_vault
    **ctx.accounts.tax_escrow.try_borrow_mut_lamports()? -= escrow_balance;
    **ctx.accounts.sol_vault.try_borrow_mut_lamports()? += escrow_balance;

    emit!(EscrowConsolidated {
        token: curve.token,
        escrow_amount: escrow_balance,
        new_vault_balance: ctx.accounts.sol_vault.lamports(),
        slot: Clock::get()?.slot,
    });

    Ok(())
}
```

**Notes:**
- MUST be called before any `claim_refund` calls. The `claim_refund` instruction validates that consolidation has occurred.
- Permissionless: anyone can trigger. The caller pays no cost beyond the transaction fee.
- Idempotent: calling twice is effectively a no-op (second call sees `escrow_balance == 0` and returns `EscrowAlreadyConsolidated`).
- The escrow PDA retains its rent-exempt minimum lamports (the account is not closed).
- After consolidation, the sol_vault contains the full refund pool: `original_sol_raised - sol_returned_to_sellers + consolidated_tax_escrow`.

**Callable:** By anyone, once the curve is refund-eligible.

---

### 8.10 distribute_tax_escrow

Distributes tax escrow SOL to the carnage fund on successful graduation. This routes the 15% sell tax proceeds to the protocol's carnage mechanism.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| authority | Signer | Permissionless (anyone can call) |
| curve_state | Account | Must be Graduated |
| tax_escrow | Mut PDA | The curve's tax escrow PDA |
| carnage_fund | Mut | Destination for tax SOL (carnage vault) |
| system_program | Program | System program |

**Args:** None.

**Validation:**

1. `curve_state.status == CurveStatus::Graduated` -- error: `CurveNotGraduated`
2. Tax escrow has balance to distribute: `tax_escrow.lamports() > rent_exempt_minimum` -- error: `EscrowAlreadyDistributed`

**Logic:**

```rust
pub fn distribute_tax_escrow(ctx: Context<DistributeTaxEscrow>) -> Result<()> {
    let curve = &ctx.accounts.curve_state;

    require!(
        curve.status == CurveStatus::Graduated,
        CurveError::CurveNotGraduated
    );

    // Read escrow balance (minus rent-exempt minimum)
    let rent = Rent::get()?;
    let rent_exempt = rent.minimum_balance(0);
    let escrow_balance = ctx.accounts.tax_escrow.lamports()
        .checked_sub(rent_exempt)
        .ok_or(CurveError::Overflow)?;

    require!(
        escrow_balance > 0,
        CurveError::EscrowAlreadyDistributed
    );

    // Transfer all escrow lamports to carnage fund
    **ctx.accounts.tax_escrow.try_borrow_mut_lamports()? -= escrow_balance;
    **ctx.accounts.carnage_fund.try_borrow_mut_lamports()? += escrow_balance;

    emit!(EscrowDistributed {
        token: curve.token,
        amount: escrow_balance,
        destination: ctx.accounts.carnage_fund.key(),
        slot: Clock::get()?.slot,
    });

    Ok(())
}
```

**Notes:**
- Called during the graduation orchestration sequence (see Section 8.12).
- Permissionless: anyone can trigger after graduation.
- One-time operation per curve (second call sees `escrow_balance == 0`).
- The carnage fund receives raw SOL lamports. The existing carnage mechanism handles SOL-denominated funds.

**Callable:** By anyone, once the curve has graduated.

---

### 8.11 prepare_transition

Locks both curves for graduation. This is the on-chain state change that marks both curves as `Graduated`. Asset movement (pool seeding, vault seeding, tax escrow distribution) is handled by client-side multi-TX orchestration.

> **v1.2 Note:** This replaces the monolithic `execute_transition` from v1.0 (32 accounts). The v1.2 approach splits graduation into smaller instructions coordinated by a client-side orchestration script. See Section 8.13 (Graduation Orchestration Sequence) for the full flow.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| authority | Signer | Permissionless (anyone can call) |
| crime_curve_state | Mut PDA | CRIME curve state |
| fraud_curve_state | Mut PDA | FRAUD curve state |

**Args:** None.

**Validation:**

1. `crime_curve_state.status == CurveStatus::Filled` -- error: `CRIMECurveNotFilled`
2. `fraud_curve_state.status == CurveStatus::Filled` -- error: `FRAUDCurveNotFilled`

**Logic:**

```rust
pub fn prepare_transition(ctx: Context<PrepareTransition>) -> Result<()> {
    let crime_curve = &mut ctx.accounts.crime_curve_state;
    let fraud_curve = &mut ctx.accounts.fraud_curve_state;

    // Both must be Filled
    require!(
        crime_curve.status == CurveStatus::Filled,
        CurveError::CRIMECurveNotFilled
    );
    require!(
        fraud_curve.status == CurveStatus::Filled,
        CurveError::FRAUDCurveNotFilled
    );

    // Transition both to Graduated (terminal state)
    crime_curve.status = CurveStatus::Graduated;
    fraud_curve.status = CurveStatus::Graduated;

    emit!(TransitionPrepared {
        crime_sol_raised: crime_curve.sol_raised,
        fraud_sol_raised: fraud_curve.sol_raised,
        slot: Clock::get()?.slot,
    });

    Ok(())
}
```

**Notes:**
- Sets both curves to `Graduated` -- a terminal state. No further buys, sells, or refunds are possible.
- Permissionless: anyone can trigger once both curves are Filled.
- This instruction is lightweight (3 accounts). The heavy asset movement is orchestrated client-side.
- After this instruction, the client-side orchestration script proceeds to seed pools, seed vault, and distribute escrow.

**Callable:** By anyone, once both curves are filled.

---

### 8.12 finalize_transition

Called after client-side orchestration completes to confirm graduation is fully done. Optional safety check.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| authority | Signer | Deployer/admin |
| crime_curve_state | Account | CRIME curve state (read-only) |
| fraud_curve_state | Account | FRAUD curve state (read-only) |

**Args:** None.

**Validation:**

1. `crime_curve_state.status == CurveStatus::Graduated` -- error: `InvalidStatus`
2. `fraud_curve_state.status == CurveStatus::Graduated` -- error: `InvalidStatus`

**Logic:**

```rust
pub fn finalize_transition(ctx: Context<FinalizeTransition>) -> Result<()> {
    // Verify both curves are Graduated
    require!(
        ctx.accounts.crime_curve_state.status == CurveStatus::Graduated,
        CurveError::InvalidStatus
    );
    require!(
        ctx.accounts.fraud_curve_state.status == CurveStatus::Graduated,
        CurveError::InvalidStatus
    );

    // Verification: pools and vault should be seeded by this point.
    // The client-side orchestration handles the actual asset movement.
    // This instruction serves as a confirmation checkpoint.

    emit!(TransitionComplete {
        crime_sol_raised: ctx.accounts.crime_curve_state.sol_raised,
        fraud_sol_raised: ctx.accounts.fraud_curve_state.sol_raised,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
```

**Notes:**
- This is an optional safety checkpoint. The critical state change happened in `prepare_transition`.
- Could optionally verify that pools exist, vault is seeded, etc. -- but trusting the client orchestration is acceptable since the asset movement uses existing protocol instructions that have their own validation.
- Future enhancement: could close curve PDAs to reclaim rent.

**Callable:** By admin, after client-side orchestration completes.

---

### 8.13 Graduation Orchestration Sequence

Graduation uses **multi-TX client-side orchestration** rather than a monolithic 32-account instruction. This avoids the Solana transaction size limit and keeps each on-chain instruction simple and composable.

**Sequence:**

| Step | Type | Instruction/Action | Description |
|------|------|--------------------|-------------|
| 1 | On-chain TX | `prepare_transition` | Lock both curves as Graduated (3 accounts) |
| 2 | Client TX | Seed CRIME/SOL pool | 290M CRIME + 500 SOL via existing AMM `initialize_pool` instruction |
| 3 | Client TX | Seed FRAUD/SOL pool | 290M FRAUD + 500 SOL via existing AMM `initialize_pool` instruction |
| 4 | Client TX | Seed Conversion Vault | 250M CRIME + 250M FRAUD + 20M PROFIT via existing vault `seed` instruction |
| 5 | On-chain TX | `distribute_tax_escrow` (CRIME) | Route CRIME curve's escrow to carnage fund |
| 6 | On-chain TX | `distribute_tax_escrow` (FRAUD) | Route FRAUD curve's escrow to carnage fund |
| 7 | On-chain TX | `finalize_transition` | Confirm graduation complete |

**Notes:**
- Steps 2-4 use **existing protocol instructions** (AMM pool initialization, vault seeding). No new instructions needed.
- Steps 2-4 may use Address Lookup Tables if account counts are high (follows the same ALT pattern used for Carnage, see MEMORY.md).
- The SOL for pool seeding comes from the curve sol_vaults (500 SOL each). The tokens come from protocol reserves (not from the curve's token_vault).
- Detailed TX construction is Phase 74 scope. This spec defines the instruction interfaces; the implementation defines the orchestration script.
- If any step fails, the curves are already Graduated (terminal). The orchestration script can be re-run idempotently to complete remaining steps.

> **Why multi-TX?** The v1.0 `execute_transition` required 32 accounts in a single instruction. Solana's 1232-byte TX limit makes this fragile, especially with Token-2022 transfer hook accounts. Splitting into smaller TXs (3-12 accounts each) is robust and composable.

---

## 9. Failure Handling

### 9.1 Failure Conditions

A curve enters the failure path when:

1. **Direct failure:** The curve is still `Active` when the 48-hour deadline passes. Anyone calls `mark_failed` to transition it to `Failed`.
2. **Partner failure:** The curve reached `Filled`, but the partner curve failed. The filled curve becomes refund-eligible even though its own status remains `Filled` (see Section 5.2 Compound States).
3. **Coupled failure:** Neither curve fills by the deadline. Both are marked `Failed`.

**Tax Escrow Consolidation:**

When a curve enters the failure path, its tax escrow must be consolidated into the SOL vault before refunds can begin:

1. Call `consolidate_for_refund` (Section 8.9) -- merges tax escrow lamports into `sol_vault`
2. After consolidation, the combined refund pool = `sol_vault` SOL (original raises minus sell returns plus consolidated escrow)
3. Only then can `claim_refund` be called by token holders

This consolidation step exists because the `claim_refund` instruction reads from a single account (`sol_vault`) for simplicity and atomicity. Without consolidation, the escrow SOL would be stranded and unavailable for refunds.

**A Filled curve whose partner fails is also refund-eligible.** The filled curve's SOL vault and tax escrow follow the same consolidation and refund path. The UI should indicate that both curves are in refund mode if either fails.

### 9.2 Refund Mechanics (Burn-and-Claim)

Users claim refunds by **burning their tokens** in exchange for a proportional share of the refund pool. Tokens are permanently destroyed during the refund -- users do NOT keep their tokens.

**Process:**

1. `consolidate_for_refund` is called (once per curve, permissionless)
2. User calls `claim_refund` -- program reads their ATA balance, burns all tokens, sends proportional SOL
3. Refund formula: `refund = (user_balance / tokens_sold) * sol_vault_balance` (excluding rent-exempt minimum)
4. After each claim, `tokens_sold` decreases by the burned amount -- subsequent claimers get their correct proportional share

See Section 8.8 (`claim_refund`) for the full instruction specification, including the worked solvency example with Alice, Bob, and Carol proving order-independence.

**Key properties:**

- **Sellers who exited early** keep their sell proceeds AND get a proportional refund on any remaining tokens they still hold. They took the 15% sell tax hit -- fair game.
- **Pure buyers** may get back slightly less than deposited (bounded by total sell volume * 15%) because sell tax reduced the vault balance. The consolidated escrow partially compensates.
- **No claim deadline** -- refunds are available forever on-chain. The frontend removes the refund UI after ~30 days, but the on-chain instruction remains callable indefinitely.
- **No double claims** -- tokens are burned on claim, so the user cannot call again (validation fails: `amount > 0`).

### 9.3 Post-Fill Waiting Period

When one curve reaches its target before the other, it enters the `Filled` status and waits for its partner.

**Filled State Behavior:**

| Action | Allowed? | Reason |
|--------|----------|--------|
| Additional purchases | No | Target already reached |
| Sells | No | Sells disabled when Filled (Section 4.5) |
| Refunds | No | Curve succeeded, not failed (yet) |
| View progress | Yes | Read-only access to state |
| Graduation transition | No | Partner not ready |

**Duration:**

The waiting period can last from minutes to the full deadline (48 hours):
- Minimum: Partner fills immediately after
- Maximum: Deadline - time already elapsed

**Example Timeline:**
```
Hour 0:  Both curves start (Active status)
Hour 10: CRIME curve fills (Filled status)
         FRAUD curve at 60% (Active status)

Hour 10-47: Waiting period
         - CRIME curve: Filled, no buys/sells/refunds
         - FRAUD curve: Still accepting purchases and sells

Hour 47: FRAUD curve fills (Filled status)
         Both curves ready for graduation

Hour 47+: prepare_transition called
          Graduation orchestration begins (Section 8.13)
```

**User Guidance:**

For users who contributed to the filled curve:
1. Your contribution is locked until graduation or deadline
2. Monitor partner curve progress via UI
3. If deadline passes with partner unfilled:
   - Both curves enter the failure/refund path
   - `consolidate_for_refund` then `claim_refund` become available
4. If partner fills before deadline:
   - Graduation proceeds (Section 8.13)
   - Protocol launches with seeded pools

**Edge Case: Partner Fails**

If the partner curve fails (deadline expires unfilled):
1. The filled curve becomes refund-eligible (status remains `Filled`, but `is_refund_eligible()` returns `true`)
2. All token holders in BOTH curves can claim burn-and-claim refunds
3. Each curve's tax escrow must be consolidated separately before claims begin

---

## 10. Events

```rust
// === Lifecycle Events ===

#[event]
pub struct CurveInitialized {
    pub token: Token,
    pub token_mint: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct CurveFunded {
    pub token: Token,
    pub amount: u64,
}

#[event]
pub struct CurveStarted {
    pub token: Token,
    pub start_slot: u64,
    pub deadline_slot: u64,
    pub timestamp: i64,
}

#[event]
pub struct CurveFilled {
    pub token: Token,
    pub total_sold: u64,
    pub total_raised: u64,
    pub slot: u64,
}

#[event]
pub struct CurveFailed {
    pub token: Token,
    pub tokens_sold: u64,
    pub sol_raised: u64,
    pub deadline_slot: u64,
    pub current_slot: u64,
}

// === Trade Events ===

#[event]
pub struct TokensPurchased {
    pub user: Pubkey,
    pub token: Token,
    pub sol_spent: u64,
    pub tokens_received: u64,
    pub new_tokens_sold: u64,
    pub current_price: u64,
    pub slot: u64,
}

#[event]
pub struct TokensSold {
    pub user: Pubkey,
    pub token: Token,
    pub tokens_sold: u64,          // number of tokens sold back
    pub sol_received_net: u64,     // SOL sent to user (after tax)
    pub tax_amount: u64,           // 15% tax routed to escrow
    pub new_tokens_sold: u64,      // updated curve.tokens_sold
    pub current_price: u64,        // price after sell
    pub slot: u64,
}

// === Tax Escrow Events ===

#[event]
pub struct TaxCollected {
    pub token: Token,
    pub amount: u64,               // tax amount from this sell
    pub escrow_balance: u64,       // total escrow balance after collection
    pub slot: u64,
}

#[event]
pub struct EscrowConsolidated {
    pub token: Token,
    pub escrow_amount: u64,        // lamports moved from escrow to vault
    pub new_vault_balance: u64,    // sol_vault balance after consolidation
}

#[event]
pub struct EscrowDistributed {
    pub token: Token,
    pub amount: u64,               // lamports sent to carnage fund
    pub destination: Pubkey,       // carnage fund address
    pub slot: u64,
}

// === Refund Events ===

#[event]
pub struct RefundClaimed {
    pub user: Pubkey,
    pub token: Token,
    pub tokens_burned: u64,             // tokens permanently destroyed
    pub refund_amount: u64,             // SOL returned to user
    pub remaining_tokens_sold: u64,     // curve.tokens_sold after this claim
    pub remaining_vault_balance: u64,   // sol_vault balance after this claim
    pub slot: u64,
}

// === Graduation Events ===

#[event]
pub struct TransitionPrepared {
    pub crime_sol_raised: u64,
    pub fraud_sol_raised: u64,
    pub slot: u64,
}

#[event]
pub struct TransitionComplete {
    pub crime_sol_raised: u64,
    pub fraud_sol_raised: u64,
    pub timestamp: i64,
}
```

> **v1.2 Changes:** `Purchase` renamed to `TokensPurchased` for clarity alongside `TokensSold`. `WalletWhitelisted` removed (no whitelist). `RefundClaimed` updated with `tokens_burned` and `remaining_*` fields. New events: `TokensSold`, `TaxCollected`, `EscrowConsolidated`, `EscrowDistributed`, `TransitionPrepared`.

---

## 11. Errors

```rust
#[error_code]
pub enum CurveError {
    // === Status Errors ===

    #[msg("Curve is not active")]
    CurveNotActive,

    #[msg("Curve is not active for sells (must be Active, not Filled/Failed/Graduated)")]
    CurveNotActiveForSell,

    #[msg("Curve is not in a refund-eligible state")]
    CurveNotRefundable,

    #[msg("Curve has not graduated")]
    CurveNotGraduated,

    #[msg("Invalid curve status for this operation")]
    InvalidStatus,

    // === Deadline Errors ===

    #[msg("Curve deadline has passed")]
    DeadlinePassed,

    #[msg("Curve deadline has not passed yet")]
    DeadlineNotPassed,

    // === Purchase/Sell Errors ===

    #[msg("Purchase amount below minimum (0.05 SOL)")]
    BelowMinimum,

    #[msg("Wallet cap exceeded (20M tokens max per wallet)")]
    WalletCapExceeded,

    #[msg("Insufficient token balance for sell")]
    InsufficientTokenBalance,

    #[msg("Cannot sell or buy zero tokens")]
    ZeroAmount,

    #[msg("Slippage exceeded: SOL received is below minimum_sol_out")]
    SlippageExceeded,

    // === Refund Errors ===

    #[msg("Tax escrow has not been consolidated -- call consolidate_for_refund first")]
    EscrowNotConsolidated,

    #[msg("Nothing to burn -- user has zero tokens")]
    NothingToBurn,

    #[msg("Tax escrow already consolidated")]
    EscrowAlreadyConsolidated,

    #[msg("Tax escrow already distributed")]
    EscrowAlreadyDistributed,

    // === Graduation Errors ===

    #[msg("CRIME curve not filled")]
    CRIMECurveNotFilled,

    #[msg("FRAUD curve not filled")]
    FRAUDCurveNotFilled,

    // === Infrastructure Errors ===

    #[msg("Curve not funded with tokens")]
    CurveNotFunded,

    #[msg("Arithmetic overflow")]
    Overflow,

    #[msg("Division by zero")]
    DivisionByZero,

    #[msg("Unauthorized")]
    Unauthorized,
}
```

> **v1.2 Changes:** Removed `NotWhitelisted` (no whitelist), `CurveNotFailed` (replaced by `CurveNotRefundable`), `RefundAlreadyClaimed` (burn-and-claim is inherently non-repeatable), `NothingToRefund` (replaced by `NothingToBurn`). Added `CurveNotActiveForSell`, `InsufficientTokenBalance`, `ZeroAmount`, `SlippageExceeded`, `EscrowNotConsolidated`, `NothingToBurn`, `CurveNotRefundable`, `CurveNotGraduated`, `EscrowAlreadyConsolidated`, `EscrowAlreadyDistributed`, `DivisionByZero`.

---

## 12. Security Considerations

### 12.1 Price Manipulation

**Attack:** Somehow manipulate the price curve.

**Defense:** Price is purely a function of `tokens_sold`. No external inputs. No oracles. Deterministic. The linear curve formula (Section 4) ensures `P(x) = a + bx` where `x = tokens_sold` and `a`, `b` are constants set at deployment.

### 12.2 Front-Running and Sandwich Attacks

**Attack:** MEV bot sees a pending large purchase, front-runs to buy tokens at a lower price, then sells after the victim's purchase pushes the price up.

**Defense (buy-side):** Per-wallet cap (20M tokens) limits the attacker's position size. Even if front-run, the attacker can hold at most 20M tokens per wallet. The linear curve's price increase across 20M tokens (out of 460M total) is modest (~4.3%), and the attacker needs a separate wallet for each 20M chunk.

**Defense (sell-side):** The 15% sell tax makes sandwich attacks a losing proposition. For a sandwich to be profitable, the attacker must:
1. Buy tokens (pushing price up)
2. Wait for victim's purchase (pushing price further up)
3. Sell tokens at the higher price

The attacker's sell incurs a 15% tax on the gross SOL output. For the sandwich to break even, the victim's purchase must move the price by more than 17.6% (calculation: `1 / (1 - 0.15) - 1 = 0.176`). With a 460M token supply and 20M per-wallet cap, a single purchase moving the price by 17.6% would require the victim to buy ~81M tokens in one transaction -- impossible given the 20M cap.

**Conclusion:** Sandwich attacks on this curve are economically irrational due to the 15% sell tax.

### 12.3 Sell Manipulation / Wash Trading

**Attack:** User buys tokens, sells immediately for profit, repeating in a cycle.

**Defense:** A sell+rebuy cycle costs at minimum 15% of the position value. The sell tax is applied to the SOL output, and the curve walks backward on sell (lowering the price). A worked example:

1. User buys 10M tokens at average price X, spending S SOL
2. User immediately sells 10M tokens: receives `S * 0.85` SOL (15% tax deducted)
3. User re-buys with `S * 0.85` SOL: receives fewer tokens (because the curve walked backward and back up, but with less SOL)
4. Net loss: >= 15% per cycle

Each round-trip destroys at least 15% of the position value. Wash trading is economically irrational. Even sophisticated multi-wallet strategies cannot avoid the sell tax -- it is enforced on-chain for every sell transaction.

### 12.4 Cap Enforcement Without Whitelist

**Attack:** User creates multiple wallets to circumvent the 20M per-wallet cap.

**Defense (what the cap prevents):** The 20M cap prevents a single wallet from accumulating a disproportionate share of the curve. ATA balance reads are safe for enforcement because the Transfer Hook prevents wallet-to-wallet token transfers during the curve phase. Users cannot shuffle tokens between wallets to free up cap space.

**What the cap does NOT prevent:** A user CAN create multiple wallets and buy up to 20M on each. This is the **intended design** -- the 20M cap limits single-wallet concentration, not multi-wallet sybil attacks. Full sybil resistance would require KYC, which was explicitly rejected as counter to crypto ethos (see Section 2, Design Constraints). The 15% sell tax provides economic friction against pump-and-dump regardless of wallet count.

### 12.5 Burn-and-Claim Solvency Proof

**Claim:** The refund formula `(user_tokens / total_outstanding) * vault_balance` is provably solvent -- the sum of all possible refunds exactly equals the vault balance.

**Proof:** Let `V` = vault balance, `T` = total outstanding tokens, and users `u_1, u_2, ..., u_n` with balances `b_1, b_2, ..., b_n` where `sum(b_i) = T`.

After user `u_1` claims:
- Refund: `r_1 = (b_1 / T) * V`
- New vault: `V' = V - r_1 = V * (1 - b_1/T) = V * (T - b_1) / T`
- New outstanding: `T' = T - b_1`

For user `u_2`:
- Refund: `r_2 = (b_2 / T') * V' = (b_2 / (T - b_1)) * (V * (T - b_1) / T) = (b_2 / T) * V`

By induction, each user `u_i` receives exactly `(b_i / T) * V` regardless of claim order. The sum `r_1 + r_2 + ... + r_n = V * (b_1 + b_2 + ... + b_n) / T = V * T / T = V`.

The pool is **exactly exhausted** after all claims. No SOL is stranded, and no claim exceeds its fair share. See Section 8.8 for a worked numerical example (Alice/Bob/Carol).

### 12.6 Tax Escrow Integrity

**Attack:** External actor drains the tax escrow PDA.

**Defense:** The tax escrow PDA is program-controlled (`seeds = ["tax_escrow", token_mint]`). Only the bonding curve program can transfer SOL out of it, via two defined paths:
- `consolidate_for_refund` (failure path): merges into sol_vault
- `distribute_tax_escrow` (success path): sends to carnage fund

No external actor can invoke lamport transfers from the PDA because only the program holding the PDA's seeds can sign on its behalf. The two instructions have explicit status checks (`Failed`/`Graduated`) preventing misuse.

### 12.7 Deadline Manipulation

**Attack:** Validator manipulates slot numbers to extend or shorten the deadline.

**Defense:** The 48-hour deadline uses Solana slot numbers (Section 7). Slot times average ~400ms but can vary with network conditions. The deadline is set conservatively: `DEADLINE_SLOTS = 432,000` (48 hours at 2.5 slots/sec). Individual validators cannot meaningfully manipulate the global slot clock -- it advances based on consensus across the validator set.

Slot-based timing is the standard approach for Solana on-chain deadlines (used by SPL Governance, Marinade, and other established protocols). The margin of error (hours vs. minutes at the boundary) is acceptable for a 48-hour window.

### 12.8 Refund Double-Claim

**Attack:** Claim refund multiple times to drain the vault.

**Defense:** Tokens are permanently **burned** during `claim_refund` (Section 8.8). After burning, the user's ATA balance is 0, and the validation check `user_token_account.amount > 0` prevents any subsequent claim. No `refund_claimed` boolean is needed -- the burn mechanism is inherently non-repeatable.

---

## 13. Testing Requirements

### 13.1 Unit Tests

**Buy curve math:**
- Price at 0% sold
- Price at 50% sold
- Price at 100% sold
- Tokens out for various SOL amounts
- Partial fill at end of curve
- Precision/rounding behavior

**Sell curve math:**
- Reverse integral returns correct SOL for given tokens
- `SOL_gross` matches expected area-under-curve
- 15% tax calculation (integer division, rounds down)
- `SOL_net = SOL_gross - tax`
- Sell at various curve positions (10%, 50%, 90%)
- Sell entire balance in one transaction
- Minimum sell amount edge cases

**Constraints:**
- Minimum purchase enforcement (0.05 SOL)
- Wallet cap enforcement via ATA balance read
- Cap recalculation after sell (selling frees cap space)
- Slippage protection: `minimum_sol_out` check on sells

**State machine:**
- All valid transitions (Initialized->Active->Filled->Graduated)
- All invalid transitions rejected (e.g., Active->Graduated)
- Terminal states cannot transition (Graduated, Failed)
- `is_refund_eligible()` with various partner states

### 13.2 Integration Tests

**Happy path (buy + graduation):**
- Initialize both curves (creates tax escrow PDAs)
- Fund curves (460M tokens each)
- Start curves (sets deadlines)
- Multiple purchases across both curves
- Both curves fill
- `prepare_transition` marks both Graduated
- Client-side pool seeding (via existing AMM instructions)
- `distribute_tax_escrow` routes escrow to carnage fund
- `finalize_transition` confirms graduation
- Verify pool seeding correct

**Sell path:**
- Buy tokens, sell back, verify SOL returned matches reverse integral minus 15% tax
- Tax escrow balance increases by correct amount after sell
- `tokens_sold` decreases after sell (curve walks backward)
- Price drops after sell (next buyer gets cheaper price)
- Cap space freed after sell (user can buy again up to 20M)
- Sells disabled when Filled (CurveNotActiveForSell)
- Sells disabled after deadline (DeadlinePassed)

**Failure + refund path:**
- Curve doesn't fill by deadline
- `mark_failed` transitions to Failed
- `consolidate_for_refund` merges escrow into vault
- Multiple users claim burn-and-claim refunds sequentially
- Verify all SOL returned (vault exhausted to rent-exempt minimum)
- Verify all tokens burned (tokens_sold reaches 0)

**Coupled failure path:**
- CRIME fills, FRAUD doesn't
- FRAUD marked Failed
- CRIME is refund-eligible (Filled + partner Failed)
- Both curves' users can claim refunds
- Both escrows consolidated separately

**Edge cases:**
- Exact cap purchase (20M tokens)
- Purchase that would exceed cap (partial fill)
- Last purchase that fills curve exactly
- Last purchase that would overflow (partial)
- Purchase at deadline slot (valid)
- Purchase one slot after deadline (invalid)
- Sell entire balance then rebuy (cap is re-opened)
- Refund claim order independence (3+ users, random order)

### 13.3 Negative Tests

- Purchase below minimum (0.05 SOL)
- Purchase after deadline
- Purchase when curve not active
- Sell when curve is Filled (CurveNotActiveForSell)
- Sell more tokens than user holds (InsufficientTokenBalance)
- Sell zero tokens (ZeroAmount)
- Sell with slippage exceeded (minimum_sol_out too high)
- Claim refund before consolidation (EscrowNotConsolidated)
- Claim refund with zero balance (NothingToBurn)
- Claim refund on non-failed curve (CurveNotRefundable)
- `consolidate_for_refund` on non-failed curve
- `distribute_tax_escrow` on non-graduated curve (CurveNotGraduated)
- `prepare_transition` with only one curve filled
- Double consolidation (EscrowAlreadyConsolidated)

### 13.4 Property Tests (Fuzz / Proptest)

- **Buy/sell round-trip:** For any buy amount, immediately selling all received tokens returns `<= original SOL` after 15% tax. No profitable round-trips possible.
- **Vault solvency:** Across random sequences of buys and sells, `sol_vault.lamports() >= expected_from_integral(tokens_sold) - rent_exempt_minimum` at every state transition.
- **Refund solvency:** After failure and consolidation, across random claim orderings, the vault is never depleted before all holders have claimed. Final vault balance = rent-exempt minimum.
- **State machine validity:** Random instruction sequences never produce an invalid state transition. Terminal states (Graduated, Failed) reject all further state changes.
- **Cap enforcement:** No sequence of buys and sells allows a single wallet to hold > 20M tokens at any point.

---

## 14. UI Integration

> **Note:** These are guidelines for Phase 75 (Launch Page). Exact component APIs will be defined in the Phase 75 spec.

### 14.1 Displaying Current State

```typescript
interface CurveDisplay {
    token: 'CRIME' | 'FRAUD';
    status: 'upcoming' | 'active' | 'filled' | 'failed' | 'graduated';
    tokensSold: number;
    solRaised: number;
    currentPrice: number;
    percentComplete: number;        // tokens_sold / TARGET_TOKENS * 100
    timeRemaining: number;          // seconds until deadline
    userHoldings: number;           // user's ATA balance (changes with buys AND sells)
    userRemainingCap: number;       // MAX_PER_WALLET - userHoldings
    taxEscrowBalance: number;       // SOL in tax escrow (lamports)
    tokensReturned: number;         // cumulative tokens sold back
    participantCount: number;       // unique purchasers
}

function calculateProgress(curve: CurveState): number {
    return (curve.tokensSold / TARGET_TOKENS) * 100;
}

function getCurrentPrice(tokensSold: number): number {
    const P_START = 0.00000045;
    const P_END = 0.000001725;
    const progress = tokensSold / TARGET_TOKENS;
    return P_START + (P_END - P_START) * progress;
}
```

### 14.2 Purchase Preview

Before purchase, show:
- SOL to spend
- Estimated tokens to receive
- New total holdings
- Remaining cap

```typescript
function previewPurchase(
    solAmount: number,
    currentSold: number,
    userCurrentHoldings: number,
): PurchasePreview {
    const tokensOut = calculateTokensOut(solAmount, currentSold);
    const cappedTokens = Math.min(tokensOut, MAX_PER_WALLET - userCurrentHoldings);
    const actualSol = calculateSolForTokens(currentSold, cappedTokens);

    return {
        solToSpend: actualSol,
        tokensToReceive: cappedTokens,
        newTotal: userCurrentHoldings + cappedTokens,
        remainingCap: MAX_PER_WALLET - userCurrentHoldings - cappedTokens,
        partialFill: cappedTokens < tokensOut,
    };
}
```

### 14.3 Sell Preview

Before sell, show:
- Tokens to sell
- Gross SOL (before tax)
- Tax amount (15%)
- Net SOL received (after tax)
- New holdings after sell
- New cap space freed

```typescript
function previewSell(
    tokensToSell: number,
    currentSold: number,
    userCurrentHoldings: number,
): SellPreview {
    const solGross = calculateReverseIntegral(tokensToSell, currentSold);
    const taxAmount = Math.floor(solGross * 15 / 100);
    const solNet = solGross - taxAmount;

    return {
        tokensToSell,
        solGross,
        taxAmount,
        solNet,
        newHoldings: userCurrentHoldings - tokensToSell,
        newCapSpace: MAX_PER_WALLET - (userCurrentHoldings - tokensToSell),
    };
}
```

### 14.4 Refund Preview

For refund-eligible curves, show:
- User's token balance (will be burned)
- Estimated refund amount (proportional share of vault)
- Percentage of refund pool

```typescript
function previewRefund(
    userBalance: number,
    totalTokensOutstanding: number,
    vaultBalance: number,  // lamports, after consolidation, minus rent-exempt
): RefundPreview {
    const refundAmount = Math.floor((userBalance / totalTokensOutstanding) * vaultBalance);
    const sharePercent = (userBalance / totalTokensOutstanding) * 100;

    return {
        tokensToBurn: userBalance,
        estimatedRefund: refundAmount,
        sharePercent,
        // Note: actual refund may differ slightly due to integer rounding
    };
}
```

### 14.5 UI Display Elements

- **Curve position:** Show `tokens_sold / TARGET_TOKENS` as a progress bar/percentage
- **Current price:** Real-time price from `get_current_price(tokens_sold)`
- **Tax escrow counter:** Show SOL collected per curve (read from tax escrow PDA lamports)
- **Sell tax indicator:** Prominently display "15% sell tax" near the sell interface
- **Refund status:** Show consolidation status (has `consolidate_for_refund` been called?) before enabling the claim button
- **No whitelist UI:** Open access -- no verification step, no whitelist status display

---

## 15. Invariants Summary

**Core Invariants (must hold at all times):**

1. **Linear price curve** -- Price = `P_start + (P_end - P_start) * tokens_sold / TOTAL_FOR_SALE`, deterministic, no external inputs
2. **End price = pool price** -- Curve end price (0.000001725 SOL) matches pool seeding price (500 SOL / 290M tokens), no arbitrage gap at graduation
3. **Both curves required** -- Coupled success/failure. Neither curve can graduate alone. If either fails, both enter the refund path.
4. **Per-wallet cap enforced** -- 20M tokens max per wallet per curve, enforced via ATA balance reads. Safe because Transfer Hook prevents wallet-to-wallet transfers during curve phase.
5. **48-hour deadline** -- Slot-based deadline applies to both buys and sells. Enforced on-chain via `clock.slot > deadline_slot`.
6. **All holdings in PDAs** -- Trustless, program-controlled. Token vault, SOL vault, and tax escrow are all PDA-owned.
7. **Sell-back walks curve backward** -- `tokens_sold` decreases on sell, next price decreases. The reverse integral returns the exact area under the curve for the tokens being sold.
8. **15% round-trip cost** -- A sell+rebuy cycle costs >= 15% of position value. Makes wash trading, sandwich attacks, and other manipulation strategies economically irrational.
9. **SOL vault solvency** -- `sol_vault_balance >= integral(0, tokens_sold) - cumulative_sol_returned - rent_exempt_minimum` at all state transitions. Tax moves to escrow (separate PDA), not out of the system.
10. **Tax escrow routing** -- On success: escrow routes to carnage fund via `distribute_tax_escrow`. On failure: escrow consolidates into sol_vault via `consolidate_for_refund`. Never both. The two paths are mutually exclusive (keyed off Graduated vs. Failed/refund-eligible status).
11. **Burn-and-claim solvency** -- Sum of all possible refunds = vault balance (by construction). Proven in Section 12.5. Each claim reduces both the numerator (user's tokens burned) and denominator (total outstanding), maintaining proportional fairness regardless of claim order.
12. **Sells disabled when Filled** -- Once `tokens_sold >= TARGET_TOKENS`, the sell instruction rejects with `CurveNotActiveForSell`. This ensures the SOL vault is stable during the graduation window.
13. **Cap enforcement during sells** -- Selling frees cap space. After selling N tokens, `ATA balance` decreases by N, allowing future buys up to the 20M cap again. The 15% sell tax makes cap recycling unprofitable.
14. **Coupled graduation** -- Both curves must be `Filled` before `prepare_transition` can execute. The instruction atomically sets both to `Graduated`.
15. **Terminal states** -- `Graduated` and `Failed` cannot transition to any other state. No buys, sells, or further state changes are possible.
16. **No double refund** -- Tokens are burned on `claim_refund`. User's ATA balance becomes 0. Subsequent calls fail validation (`NothingToBurn`).
17. **Transition is permissionless** -- `prepare_transition`, `consolidate_for_refund`, `distribute_tax_escrow`, and `mark_failed` are all callable by anyone once conditions are met. No admin keys required for protocol progression.
18. **Price continuity** -- No price jumps. The linear curve is continuous across its entire domain. Buy and sell integrals use the same formula, ensuring bidirectional price consistency.

---

## 16. v1.2 Cross-Reference Notes

This section documents known inconsistencies between the Bonding Curve Spec and other project documents. These are noted for awareness; full reconciliation of archived docs is a separate effort.

### 16.1 Protocol_Initialization_and_Launch_Flow.md

| Item | Inconsistency | Notes |
|------|---------------|-------|
| CRIME/PROFIT and FRAUD/PROFIT pools | Sections 8.1, 12.2, and the PDA manifest reference these pools | Replaced by Conversion Vault in v1.1. Pre-existing inconsistency, not a v1.2 issue. |
| PROFIT supply listed as 50M | Section 7.4 (`PROFIT_TOTAL_SUPPLY = 50_000_000_000_000n`) | Corrected to 20M in v1.1. See MEMORY.md. |
| 6 programs in deploy order | Section 5.1 lists 6 programs | v1.2 adds `bonding_curve` as 7th program. |
| Privy whitelist authority | Section 9.4 references `initializeWhitelistAuthority` for Privy | Removed in v1.2. Open access, no whitelist. |
| 56 transactions | Section 15 lists 56 deployment transactions | v1.2 changes this count (whitelist removal, new curve instructions, multi-TX graduation). |
| Reserve vaults in curve program | PDA manifest includes `reserve` and `reserveXVault` PDAs | ReserveState removed from curve program in v1.2. Reserve tokens managed by existing infrastructure. |

### 16.2 Transfer_Hook_Spec.md

| Item | Inconsistency | Notes |
|------|---------------|-------|
| Entries #5-8 (CRIME/PROFIT and FRAUD/PROFIT pool vaults) | Still listed in whitelist table | Replaced by Conversion Vault token accounts in v1.1. Pre-existing inconsistency. |
| 14 whitelist entries total | May not reflect v1.1 Conversion Vault changes | v1.2 bonding curve token vaults are already in the whitelist (entries #11-12). Tax escrow PDAs do NOT need whitelisting (SOL-only, no token transfers). |
| Integration test cases | Section 14.2 originally only listed "Bonding curve -> User wallet (curve purchase)" | v1.2 adds "User wallet -> Bonding curve token vault (curve sale / sell-back)" as a test case. |

### 16.3 Scope

These discrepancies are pre-existing from v1.1 (Conversion Vault, PROFIT supply correction) or are v1.2 additions that the archived docs have not been updated to reflect. Surgical v1.2 notes have been added to both cross-reference documents. Full reconciliation of archived docs to current protocol state is a separate documentation effort and is tracked in the project todo list.

---

## 17. v1.3 Hardening Changes

This section documents all hardening measures applied to the bonding curve program during v1.3 (Phases 78-86).

### 17.1 Phase 78: Authority Hardening (AUTH-01/AUTH-02)

- **BcAdminConfig PDA** (`seeds: ["bc_admin"]`): Replaces raw upgrade-authority checks. Admin pubkey stored in PDA, validated via `has_one = authority` constraint on all admin instructions.
- **ProgramData validation**: `initialize_bc_admin` validates the caller is the upgrade authority by reading the ProgramData account (standard Anchor pattern).
- **Burn instruction**: `burn_bc_admin` sets authority to `Pubkey::default()`, permanently disabling admin operations.

Source: `/programs/bonding_curve/src/state.rs` (BcAdminConfig struct), `/programs/bonding_curve/src/instructions/initialize_bc_admin.rs`

### 17.2 Phase 79: Financial Safety (FIN-04/FIN-05)

- **Partial fill assertion (FIN-04)**: When a purchase partially fills the curve (buying more SOL than remaining tokens), the recalculated `actual_sol` must satisfy `actual_sol <= sol_amount`. Error: `CurveError::PartialFillOvercharge`.
- **Partner mint validation (FIN-05)**: `partner_mint` field added to CurveState (32 bytes). Set during `initialize_curve`. `claim_refund` and `consolidate_for_refund` validate that the passed partner curve's `token_mint` matches this curve's `partner_mint`. Error: `CurveError::InvalidPartnerCurve`.

Source: `/programs/bonding_curve/src/instructions/purchase.rs`, `/programs/bonding_curve/src/state.rs`

### 17.3 Phase 80: Defense-in-Depth (DEF-05)

- **Remaining accounts count validation**: Token transfer CPI calls validate `remaining_accounts.len() == 4` (exactly 4 Transfer Hook extra accounts per mint). Error: `CurveError::InvalidHookAccounts`.

Source: `/programs/bonding_curve/src/error.rs` (InvalidHookAccounts variant)

### 17.4 Phase 81: Compile-Time Assertions (CTG-03)

- **Price monotonicity**: `const _: () = assert!(P_END > P_START)` -- compile-time guarantee that the curve price increases.
- **Supply consistency**: `const _: () = assert!(TOTAL_FOR_SALE as u64 as u128 == TOTAL_FOR_SALE)` -- round-trip cast validates no u128->u64 truncation.
- **Non-zero supply**: `const _: () = assert!(TOTAL_FOR_SALE > 0)`.

Source: `/programs/bonding_curve/src/constants.rs` (lines 188-200)

---

## 18. Mathematical Proofs

This section provides formal proofs of the bonding curve's financial safety properties. All formulas correspond directly to the on-chain implementation in `/programs/bonding_curve/src/math.rs`.

### 18.1 Vault Solvency Invariant

**Invariant Statement:**

At all times, the SOL vault balance is greater than or equal to the integral of the price function from 0 to `tokens_sold`:

```
vault_sol_balance >= Integral(P(x), 0, tokens_sold)
```

where `P(x) = P_START + (P_END - P_START) * x / TOTAL_FOR_SALE` is the linear price function.

**Integral Derivation:**

For the linear price function `P(x) = a + b*x` where:
- `a = P_START = 450` (lamports per human token)
- `b = (P_END - P_START) / TOTAL_FOR_SALE = 1275 / 460e12`

The integral from 0 to T (in base units) gives the total SOL cost:

```
Integral(P(x), 0, T) = [a * T + (P_END - P_START) * T^2 / (2 * TOTAL_FOR_SALE)] / TOKEN_DECIMAL_FACTOR
```

Expanding with protocol constants:

```
I(T) = [450 * T + 1275 * T^2 / (2 * 460,000,000,000,000)] / 1,000,000
     = [450 * T + 1275 * T^2 / 920,000,000,000,000] / 1,000,000
```

This represents the minimum SOL the vault must hold to cover a complete walk-back (all buyers selling back to position 0).

**Full-curve value:** When `T = TOTAL_FOR_SALE = 460e12`:

```
I(460e12) = [450 * 460e12 + 1275 * (460e12)^2 / (920e12)] / 1e6
          = [207e15 + 1275 * 460e12 / 2] / 1e6
          = [207e15 + 293.25e15] / 1e6
          = 500.25e15 / 1e6
          = ~500.25 SOL (500,250,000,000 lamports)
```

Note: The full-curve integral is ~500.25 SOL (not exactly 500) due to the rounding of P_START from its exact value of ~449.13 lamports. This is documented in the math.rs header and is inherent to the chosen economic parameters.

**Proof: Buy Preserves Invariant**

When a user purchases tokens, `calculate_sol_for_tokens` (in math.rs) computes the SOL cost:

```rust
// From math.rs: calculate_sol_for_tokens
// SOL = ceil((term1 + term2) / (PRECISION * TOKEN_DECIMAL_FACTOR))
//
// Ceil rounding: .checked_add(denominator - 1) / denominator
let sol_lamports = total_scaled
    .checked_add(denominator - 1)  // ceil rounding
    .ok_or(CurveError::Overflow)?
    / denominator;
```

The ceil rounding means:

```
actual_sol_paid = ceil(true_integral_value)
               >= true_integral_value
```

Since the buyer pays `actual_sol_paid >= Integral(P, x1, x1 + tokens)`, and the vault receives this full amount:

```
vault_balance_after = vault_balance_before + actual_sol_paid
                   >= Integral(P, 0, x1) + Integral(P, x1, x1 + tokens)
                    = Integral(P, 0, x1 + tokens)
                    = Integral(P, 0, new_tokens_sold)
```

Therefore, the invariant holds after every buy.

**Proof: Sell Preserves Invariant**

When a user sells tokens back, the gross SOL refund is computed by `calculate_sol_for_tokens(x2, tokens_to_sell)` where `x2 = x1 - tokens_to_sell`. This computes the integral from x2 to x1.

However, `calculate_sol_for_tokens` uses **ceil** rounding for both buys AND sells. This means the gross refund computation technically rounds UP (seller gets slightly more per the raw integral).

The solvency invariant is preserved by two mechanisms:

1. **Tax deduction (primary):** The 15% sell tax is computed with ceil rounding in sell.rs:

```rust
// From sell.rs: tax computation
let tax = sol_gross
    .checked_mul(SELL_TAX_BPS)      // * 1500
    .checked_add(BPS_DENOMINATOR - 1)  // ceil rounding
    / BPS_DENOMINATOR;                 // / 10000
```

The net payout `sol_net = sol_gross - tax` means the seller receives at most 85% of the gross integral value. Since the ceil rounding on tax further reduces the payout:

```
sol_net = sol_gross - ceil(sol_gross * 1500 / 10000)
       <= sol_gross - sol_gross * 0.15
        = 0.85 * sol_gross
```

2. **Post-state solvency assertion (defense-in-depth):** sell.rs Step 16 explicitly verifies:

```rust
// From sell.rs: Step 16
let expected_from_integral = calculate_sol_for_tokens(0, curve.tokens_sold)?;
require!(
    vault_balance >= expected_from_integral.saturating_sub(rent_exempt_min),
    CurveError::VaultInsolvency
);
```

If any math combination could violate solvency, this check catches it at runtime and reverts the transaction.

The 15% tax creates a substantial surplus. For any sell of N tokens with gross value G:

```
vault_gives_back = G - ceil(G * 0.15) < 0.85 * G
vault_obligation_removed = Integral(P, x2, x1) = G (the integral value of those tokens)

surplus_per_sell = obligation_removed - amount_given_back
                = G - (G - ceil(G * 0.15))
                = ceil(G * 0.15)
                >= 0.15 * G
```

The vault retains at least 15% of every sell's integral value as surplus.

**Proof: Refund Cannot Exceed Vault**

In the failure path, `claim_refund` distributes pro-rata from the vault:

```rust
// From claim_refund.rs: Step 6
let refund_amount = floor(user_balance * refund_pool / total_outstanding);
```

Floor rounding ensures the sum of all individual refunds cannot exceed `refund_pool`. Additionally, the `refund_pool` is `sol_vault.lamports() - rent_exempt`, so rent-exempt minimum is always preserved.

### 18.2 Rounding Asymmetry

**Asymmetry Documentation:**

The bonding curve uses directionally-opposite rounding in its two core functions:

| Function | Rounding | Direction | Effect |
|----------|----------|-----------|--------|
| `calculate_sol_for_tokens` | **ceil** | Buyer/seller | Buyer overpays by up to 1 lamport; sell gross rounds up |
| `calculate_tokens_out` | **floor** | Buyer | Buyer receives up to 1 fewer base unit of tokens |

Implementation in math.rs:

```rust
// calculate_sol_for_tokens: ceil rounding
let sol_lamports = total_scaled
    .checked_add(denominator - 1)  // += (PRECISION * TOKEN_DECIMAL_FACTOR - 1)
    / denominator;                 // This is the standard ceil(a/b) = (a + b - 1) / b pattern

// calculate_tokens_out: floor rounding (implicit)
let delta_x = numerator / b_num;   // Integer division truncates = floor
```

**Direction:** Protocol-favored. On every buy:
- The buyer pays ceil(integral) lamports (up to 1 lamport more than the true value)
- The buyer receives floor(quadratic_solution) tokens (up to 1 base unit fewer than the true value)

**Error Bound:**

For a single transaction, the maximum rounding error is:

- **SOL side:** 1 lamport = 1e-9 SOL (the ceil adds at most `denominator - 1` before dividing, which rounds up by at most 1 unit of the result)
- **Token side:** 1 base unit = 1e-6 human tokens (floor division truncates at most 1 base unit)

For a human-scale purchase (e.g., 1 SOL = 1,000,000,000 lamports buying ~460,000 human tokens):
- SOL rounding error: 1 / 1,000,000,000 = 0.0000001% of purchase
- Token rounding error: 1 / 460,000,000,000 (base units) = 0.000000000217% of tokens received

**Composability Note (Phase 86 TEST-07):**

Proptest with 13.5M iterations confirmed that ceil rounding is **not perfectly composable**: buying N tokens then selling N tokens may leave up to N lamports in the vault (not exactly zero). Specifically:

```
deficit = calculate_sol_for_tokens(0, N) - calculate_sol_for_tokens(0, N)
```

When computed as buy (from 0 to N) then sell (from N back to 0), the buy uses ceil and the sell uses ceil too, but the tax deduction means the sell always returns less SOL than the buy cost. Even without tax, the ceil rounding on both paths means:

```
sol_paid_on_buy = ceil(integral)
sol_returned_on_sell = ceil(integral) - ceil(ceil(integral) * 0.15)
```

The vault surplus after a buy-then-sell is at least:
```
surplus >= ceil(integral) * 0.15 >= 1 lamport (for any non-zero transaction)
```

This is a **feature, not a bug** -- it is the solvency surplus that ensures the vault can always cover all outstanding obligations. The on-chain `VaultInsolvency` guard (sell.rs Step 16) enforces this invariant at runtime, rejecting any sell that would violate it.

**Numerical Example with Protocol Constants:**

Consider a small purchase of 1,000,000 base units (1 human token) at position 0:

```
calculate_sol_for_tokens(0, 1_000_000):
  a = 900, b_num = 2550, n = 1_000_000, x1 = 0
  term1 = 900 * 1e12 * 1e6 = 9e20
  term2_sum_x = 2 * 0 + 1e6 = 1e6
  product = 1e6 * 1e6 = 1e12
  quot = 1e12 / (2 * 460e12) = 0 (integer division)
  rem = 1e12
  term2_main = 0
  term2_rem = 2550 * 1e12 * 1e12 / (920e12) = 2,771,739,130,434
  term2 = 2,771,739,130,434
  total_scaled = 9e20 + 2,771,739,130,434 = 900,002,771,739,130,434
  denominator = 1e12 * 1e6 = 1e18
  sol = ceil(900,002,771,739,130,434 / 1e18)
      = ceil(0.900002771...)
      = 1 lamport (ceil rounds 0.9 up to 1)

calculate_tokens_out(1, 0):
  s = 1, a = 900, b_num = 2550, b_den = 460e12
  coef = 900 * 460e12 + 0 = 414e15
  disc_rhs = 2 * 2550 * 1 * 1e6 * 460e12 = 2.346e24
  discriminant = (414e15)^2 + 2.346e24 = 1.71396e35 + 2.346e24 ~ 1.71396e35
  sqrt_disc ~ 414,000,000,002,834
  numerator = 414,000,000,002,834 - 414e15 = 2,834
  delta_x = 2834 / 2550 = 1 (floor)
  tokens_out = 1 base unit
```

For 1 lamport input, the buyer receives 1 base unit. The vault holds 1 lamport against an integral obligation of ~0.9 lamports (ceil rounded to 1). Surplus: 0 to 1 lamport per micro-transaction. Over N transactions, the surplus accumulates monotonically.

---

## 19. Dual-Curve State Machine

The bonding curve protocol operates two simultaneous curves (CRIME and FRAUD) whose lifecycles are coupled at key transitions. This section provides an exhaustive specification of every possible state, transition, and edge case.

### 19.1 State Definitions

| Status | Description | User Actions Allowed | Terminal? |
|--------|-------------|---------------------|-----------|
| **Initialized** | Curve created but not yet funded/started. Admin-only phase. | None (admin: `fund_curve`, `start_curve`) | No |
| **Active** | Curve is accepting purchases and sell-backs. The 48-hour deadline clock is running. | `purchase()`, `sell()` | No |
| **Filled** | Curve has sold all 460M tokens (`tokens_sold >= TARGET_TOKENS`). Awaiting partner curve and admin transition. | None (admin: `prepare_transition()`, permissionless: `mark_failed()` after deadline) | No |
| **Failed** | 48-hour deadline expired without both curves filling, OR partner curve failed. Refunds enabled after escrow consolidation. | `consolidate_for_refund()`, `claim_refund()` | Yes |
| **Graduated** | Both curves filled and admin called `prepare_transition()`. SOL moved to pool seeding. Protocol launch complete. | `withdraw_graduated_sol()`, `distribute_tax_escrow()`, `close_token_vault()` (admin only) | Yes |

### 19.2 Transition Table

Every possible (state, event) combination is enumerated below. "ERROR" rows indicate the transaction reverts with the specified error code.

| Current Status | Event/Instruction | Preconditions | Next Status | Side Effects |
|----------------|-------------------|---------------|-------------|-------------|
| Initialized | `fund_curve()` | Authority is admin, status == Initialized | Initialized | Tokens transferred from reserve to vault |
| Initialized | `start_curve()` | Authority is admin, vault funded (balance >= TARGET_TOKENS) | **Active** | `start_slot` = current slot, `deadline_slot` = start_slot + DEADLINE_SLOTS (432,000) |
| Initialized | `purchase()` | - | ERROR: `CurveNotActive` | - |
| Initialized | `sell()` | - | ERROR: `CurveNotActiveForSell` | - |
| Initialized | `prepare_transition()` | - | ERROR: `CRIMECurveNotFilled` or `FRAUDCurveNotFilled` | - |
| Initialized | `mark_failed()` | - | ERROR: `InvalidStatus` | - |
| Initialized | `claim_refund()` | - | ERROR: `NotRefundEligible` | - |
| Active | `purchase()` | `clock.slot <= deadline_slot`, `sol_amount >= MIN_PURCHASE_SOL`, wallet cap not exceeded, `tokens_remaining > 0` | Active | `vault += actual_sol`, `tokens_sold += actual_tokens`, participant_count++ on first buy |
| Active | `purchase()` (fills curve) | Same as above, but `tokens_sold >= TARGET_TOKENS` after purchase | **Filled** | Same as above + `status = Filled`, emits `CurveFilled` event |
| Active | `sell()` | `clock.slot <= deadline_slot`, `tokens_to_sell > 0`, user holds enough tokens | Active | `vault -= sol_net`, `tax_escrow += tax`, `tokens_sold -= tokens_to_sell` |
| Active | `sell()` after deadline | `clock.slot > deadline_slot` | ERROR: `DeadlinePassed` | - |
| Active | `mark_failed()` | `clock.slot > deadline_slot + FAILURE_GRACE_SLOTS` (432,150) | **Failed** | `status = Failed`, emits `CurveFailed` event |
| Active | `mark_failed()` before deadline | `clock.slot <= deadline_slot + FAILURE_GRACE_SLOTS` | ERROR: `DeadlineNotPassed` | - |
| Active | `prepare_transition()` | - | ERROR: `CRIMECurveNotFilled` or `FRAUDCurveNotFilled` | - |
| Active | `claim_refund()` | - | ERROR: `NotRefundEligible` | - |
| Filled | `purchase()` | - | ERROR: `CurveNotActive` | Status constraint rejects (Filled != Active) |
| Filled | `sell()` | - | ERROR: `CurveNotActiveForSell` | Status constraint rejects (Filled != Active) |
| Filled | `prepare_transition()` | Authority is admin, **BOTH** CRIME and FRAUD curves are Filled | **Graduated** | Both curves set to Graduated, emits `TransitionPrepared` |
| Filled | `prepare_transition()` | Partner curve is NOT Filled | ERROR: `CRIMECurveNotFilled` or `FRAUDCurveNotFilled` | - |
| Filled | `mark_failed()` | `clock.slot > deadline_slot + FAILURE_GRACE_SLOTS` | **Failed** | Even a Filled curve can be marked failed if deadline passes (partner never filled) |
| Filled | `claim_refund()` | Partner curve is Failed, escrow consolidated | Failed (effective) | Refund proceeds via `is_refund_eligible()` compound check |
| Filled | `claim_refund()` | Partner curve is NOT Failed | ERROR: `NotRefundEligible` | - |
| Graduated | `purchase()` | - | ERROR: `CurveNotActive` | - |
| Graduated | `sell()` | - | ERROR: `CurveNotActiveForSell` | - |
| Graduated | `prepare_transition()` | - | ERROR: `CRIMECurveNotFilled` or `FRAUDCurveNotFilled` | Status is Graduated, not Filled |
| Graduated | `mark_failed()` | - | ERROR: `InvalidStatus` | Only Active curves can be marked failed |
| Graduated | `claim_refund()` | - | ERROR: `NotRefundEligible` | Graduated curves are not refund-eligible |
| Graduated | `withdraw_graduated_sol()` | Authority is admin | Graduated | SOL transferred from vault for pool seeding |
| Graduated | `distribute_tax_escrow()` | Curve is Graduated | Graduated | Tax escrow SOL sent to carnage fund |
| Failed | `purchase()` | - | ERROR: `CurveNotActive` | - |
| Failed | `sell()` | - | ERROR: `CurveNotActiveForSell` | - |
| Failed | `prepare_transition()` | - | ERROR: `CRIMECurveNotFilled` or `FRAUDCurveNotFilled` | - |
| Failed | `mark_failed()` | - | ERROR: `InvalidStatus` | Already Failed |
| Failed | `consolidate_for_refund()` | `is_refund_eligible() == true`, `escrow_consolidated == false` | Failed | Tax escrow lamports merged into sol_vault, `escrow_consolidated = true` |
| Failed | `consolidate_for_refund()` | `escrow_consolidated == true` | ERROR: `EscrowAlreadyConsolidated` | - |
| Failed | `claim_refund()` | `escrow_consolidated == true`, user balance > 0, partner validated | Failed | Burns ALL user tokens, transfers `floor(balance * refund_pool / tokens_sold)` SOL, decrements `tokens_sold` |
| Failed | `claim_refund()` | `escrow_consolidated == false` | ERROR: `EscrowNotConsolidated` | - |
| Failed | `claim_refund()` | User balance == 0 | ERROR: `NothingToBurn` | - |

### 19.3 Edge Cases

**1. One-Sided Fill**

CRIME fills (reaches `TARGET_TOKENS`), FRAUD stays in Active. After the 48-hour deadline + 150-slot grace period, anyone can call `mark_failed()` on the FRAUD curve, transitioning it to Failed. At this point:

- CRIME is Filled, partner (FRAUD) is Failed
- `is_refund_eligible(CurveStatus::Failed)` returns `true` for the CRIME Filled curve
- CRIME holders can claim refunds even though their curve was full
- FRAUD holders can also claim refunds (directly Failed)

Both curves' tax escrows must be individually consolidated via `consolidate_for_refund()` before claims begin. The CRIME curve's refund pool includes the full SOL vault (all 1000+ SOL raised from a full fill) minus what was returned to sellers.

**2. Partial Fill Timeout**

Neither curve fills within 48 hours. After deadline + 150-slot grace, both are marked Failed. Refund math for each curve:

```
refund_per_user = floor(user_balance * refund_pool / tokens_sold)

where:
  refund_pool = sol_vault.lamports() - rent_exempt_minimum
  tokens_sold = current outstanding tokens (decremented as users claim)
```

The refund pool includes the original SOL raised minus any SOL returned to sellers (with tax retained). Because the 15% sell tax is retained in the escrow and consolidated back into the vault, the tax is non-refundable in the sense that it reduces the per-token refund value compared to the original purchase price.

**3. Exactly Simultaneous Fill**

Both CRIME and FRAUD fill in the same slot (or very close together). The admin can call `prepare_transition()` immediately, which checks:

```rust
// From prepare_transition.rs
require!(crime_curve_state.status == CurveStatus::Filled, CurveError::CRIMECurveNotFilled);
require!(fraud_curve_state.status == CurveStatus::Filled, CurveError::FRAUDCurveNotFilled);
```

If both are Filled, both transition to Graduated atomically in a single transaction. No race condition possible -- a single `prepare_transition()` call handles both curves.

**4. Race Condition on Transition**

Two callers submit `prepare_transition()` simultaneously (in the same slot):

- **First transaction lands:** Both curves transition Filled -> Graduated. Success.
- **Second transaction lands:** Both curves are now Graduated, not Filled. `CRIMECurveNotFilled` or `FRAUDCurveNotFilled` error. Transaction reverts.

On-chain atomicity (Solana's single-threaded validator execution) prevents double-transition. The first-to-land transaction wins; all subsequent attempts fail safely.

**5. Refund Math and Tax Non-Refundability**

When a curve enters the Failed state, the refund process is:

1. `consolidate_for_refund()` merges tax escrow SOL into the sol_vault, creating a single refund pool
2. Each user calls `claim_refund()`, which burns ALL their tokens and returns proportional SOL

The refund formula uses floor rounding (protocol-favored):

```rust
// From claim_refund.rs: Step 6
let refund_amount = floor(user_balance * refund_pool / total_outstanding);
```

**Key property:** The 15% sell tax collected during the Active phase IS returned to the refund pool (via `consolidate_for_refund`). However, users who sold during Active already received sol_net (85% of gross), and the tax they paid is now part of the pool shared by all remaining holders. This means:

- Users who only bought (never sold) receive a slightly higher per-token refund (because the pool includes consolidated tax from sellers)
- Users who bought then sold received their net SOL already; remaining tokens get the same per-token rate
- The total pool always equals: `original SOL raised - SOL returned to sellers (gross)` because `sol_returned` tracks gross amounts

**Division safety:** `tokens_sold` is checked to be > 0 before the division (`CurveError::NoTokensOutstanding`). As users claim and tokens_sold decreases, the per-token value remains stable because both the numerator (refund_pool) and denominator (tokens_sold) shrink proportionally.

**6. Grace Period Purchase**

A purchase transaction submitted before `deadline_slot` but landing on-chain after `deadline_slot`:

```rust
// From purchase.rs: Step 1
require!(
    clock.slot <= curve.deadline_slot,
    CurveError::DeadlinePassed
);
```

The on-chain check uses `clock.slot` (the slot when the transaction executes, not when it was submitted). If the transaction lands after the deadline, it reverts with `DeadlinePassed`. There is no partial execution -- Solana transactions are atomic.

The 150-slot grace period (FAILURE_GRACE_SLOTS) gives in-flight transactions time to finalize before `mark_failed()` becomes callable:

```rust
// From mark_failed.rs: Step 2-3
let failure_eligible_slot = curve.deadline_slot
    .checked_add(FAILURE_GRACE_SLOTS)?;  // + 150 slots (~60 seconds)
require!(
    clock.slot > failure_eligible_slot,
    CurveError::DeadlineNotPassed
);
```

Note: The grace period does NOT extend the purchase window. Purchases are hard-cutoff at `deadline_slot`. The grace period only delays when failure can be marked.

**7. Sell During Filled**

Once `tokens_sold >= TARGET_TOKENS` and status transitions to Filled, all sell attempts are rejected:

```rust
// From sell.rs: Anchor constraint
constraint = curve_state.status == CurveStatus::Active @ CurveError::CurveNotActiveForSell
```

This prevents a grief attack where a seller un-fills the curve after it reached its target, forcing the curve back to Active and potentially causing it to miss the deadline. The Filled status is a one-way gate: once reached, only `prepare_transition()` (to Graduated) or `mark_failed()` (to Failed after deadline) can change the status.

Source: `/programs/bonding_curve/src/state.rs` (CurveStatus, is_refund_eligible), `/programs/bonding_curve/src/instructions/purchase.rs`, `/programs/bonding_curve/src/instructions/sell.rs`, `/programs/bonding_curve/src/instructions/prepare_transition.rs`, `/programs/bonding_curve/src/instructions/mark_failed.rs`, `/programs/bonding_curve/src/instructions/claim_refund.rs`, `/programs/bonding_curve/src/instructions/consolidate_for_refund.rs`

---

## Changelog

- **2026-03-13**: TARGET_SOL reduced from 1000 to 500 SOL per curve due to market conditions. P_START: 900->450, P_END: 3450->1725. Curve shape ratio (3.83x) preserved. Devnet unchanged at 5 SOL.