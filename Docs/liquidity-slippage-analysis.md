---
doc_id: liquidity-slippage-analysis
title: "Dr. Fraudsworth's Finance Factory -- Liquidity & Slippage Analysis"
wave: 4
requires: []
provides: [liquidity-slippage-analysis]
status: draft
decisions_referenced: [amm-design, token-model, security]
needs_verification: []
---

# Liquidity & Slippage Analysis

## Overview

Dr. Fraudsworth's Finance Factory operates two constant-product AMM pools (CRIME/SOL, FRAUD/SOL) and a fixed-rate conversion vault (CRIME/FRAUD to PROFIT) with permanent, protocol-owned liquidity. Unlike external DEXs where liquidity providers can withdraw at any time, these pools have no withdrawal mechanism -- liquidity only grows as LP fees compound into reserves. The conversion vault provides zero-slippage PROFIT acquisition at a fixed 100:1 rate, eliminating AMM price impact entirely for PROFIT conversions.

This analysis matters for two reasons:

1. **Carnage events** execute large, protocol-internal swaps against these pools. When Carnage triggers (~4.3% chance per epoch, ~2x daily), it can spend up to 1000 SOL in a single swap. If pools are thin, slippage could be severe.

2. **User swaps** are protected by a 50% minimum output floor that rejects trades with extreme slippage. Understanding when this floor triggers (and when it doesn't) is essential for UI/UX design and user expectations.

This document provides exact formulas from the on-chain code, worked examples at various swap sizes, worst-case scenario modelling, and a mathematical proof that pool drain is impossible under the constant-product invariant.

---

## AMM Math Reference

All swap math lives in `programs/amm/src/helpers/math.rs`. The AMM is a pure constant-product market maker (x * y = k).

### Fee Deduction

```
effective_input = amount_in * (10_000 - fee_bps) / 10_000
```

Source: `calculate_effective_input(amount_in: u64, fee_bps: u16) -> Option<u128>`

- SOL pools: `fee_bps = 100` (1.0%)
- Carnage swap_exempt: `fee_bps = 100` (1.0% LP fee, 0% tax)
- Conversion vault: no fees (fixed 100:1 rate)

### Swap Output (Constant-Product Formula)

```
amount_out = reserve_out * effective_input / (reserve_in + effective_input)
```

Source: `calculate_swap_output(reserve_in: u64, reserve_out: u64, effective_input: u128) -> Option<u64>`

Integer division truncates (rounds down). The protocol keeps dust.

### k-Invariant Verification

```
k_before = reserve_in_before * reserve_out_before
k_after  = reserve_in_after  * reserve_out_after
require: k_after >= k_before
```

Source: `verify_k_invariant(...)`. Every swap is validated against this invariant. Due to integer truncation in the output calculation, k strictly increases on every swap (protocol profit from dust).

### Price Impact Formula

Price impact for a swap of size `dx` into a pool with reserves `(x, y)`:

```
price_impact_pct = dx / (x + dx) * 100
```

This is because the output is `y * dx / (x + dx)`, while the "fair" output at the marginal price would be `y * dx / x`. The ratio is `x / (x + dx)`, so slippage is `1 - x/(x+dx) = dx/(x+dx)`.

Note: The LP fee is applied before the swap math, so `dx` above refers to the post-fee `effective_input`.

---

## Pool Configuration

### Pool Matrix

| Pool | Token A (Vault A) | Token B (Vault B) | LP Fee | Token Program A | Token Program B |
|------|-------------------|-------------------|--------|-----------------|-----------------|
| CRIME/SOL | WSOL | CRIME | 100 bps (1.0%) | SPL Token | Token-2022 |
| FRAUD/SOL | WSOL | FRAUD | 100 bps (1.0%) | SPL Token | Token-2022 |

Note: Token A/B ordering is canonical (smaller pubkey = A). In SOL pools, WSOL (NATIVE_MINT) is always Token A because its pubkey (`So111...`) sorts before any Token-2022 mint.

### Conversion Vault

The conversion vault replaces the former CRIME/PROFIT and FRAUD/PROFIT AMM pools. It provides a fixed-rate mechanism for converting faction tokens (CRIME or FRAUD) into PROFIT.

| Property | Value |
|----------|-------|
| Conversion rate | 100:1 (100 CRIME or FRAUD = 1 PROFIT) |
| Fees | None (0 bps) |
| Slippage | Zero -- fixed rate, no AMM curve |
| Price impact | None -- output is deterministic regardless of trade size |
| MEV vulnerability | None -- fixed-rate conversions cannot be sandwiched or front-run |

The vault operates deterministically: `output = input / 100` (truncated to integer). The only constraint is vault token balance -- if the vault's PROFIT balance is insufficient, the conversion fails. There is no constant-product math, no k-invariant, and no LP fee compounding.

### Seed Liquidity (Devnet / Test)

From `tests/integration/helpers/constants.ts` (defaults used unless env overrides):

| Pool Type | SOL/Token A Seed | Token B Seed | Implied Price |
|-----------|-----------------|--------------|---------------|
| SOL pools | 10 SOL (10e9 lamports) | 10,000 tokens (10e9 base units) | 0.001 SOL/token |

Note: PROFIT pools have been replaced by the conversion vault. Devnet vault seeding uses a fixed PROFIT allocation rather than AMM pool initialization.

These are deliberately small for fast localnet testing. Not representative of production depth.

### Seed Liquidity (Mainnet Planned)

| Pool | Token A Amount | Token B Amount | Implied Price |
|------|---------------|----------------|---------------|
| CRIME/SOL | 500 SOL | 290M CRIME | ~0.000001725 SOL/CRIME |
| FRAUD/SOL | 500 SOL | 290M FRAUD | ~0.000001725 SOL/FRAUD |

**Conversion Vault Seeding:** The vault is funded with 250M CRIME + 250M FRAUD + 20M PROFIT at initialization. The PROFIT balance determines maximum conversion capacity (20M PROFIT supports up to 2B faction tokens converted at 100:1).

Source: env var overrides in `constants.ts` comments:
- `SOL_POOL_SEED_SOL_OVERRIDE` (500 SOL per pool at mainnet)
- `SOL_POOL_SEED_TOKEN_OVERRIDE=290000000000000` (290M tokens)

All worked examples below use **mainnet planned reserves (500 SOL per pool)** unless otherwise noted.

---

## Slippage Analysis

### Notation

For all examples:
- `R_SOL` = SOL reserve in the pool (lamports)
- `R_TOKEN` = Token reserve (base units, 6 decimals)
- `dx` = input amount (post-tax for user swaps, full amount for exempt swaps)
- `dy` = output amount (tokens received)
- `eff` = effective input after LP fee

### User Swaps -- SOL Pools (Buy: SOL -> Token)

**Pool: CRIME/SOL at mainnet seed**
- R_SOL = 500 SOL = 500,000,000,000 lamports
- R_TOKEN = 290,000,000 CRIME = 290,000,000,000,000 base units
- LP fee: 100 bps (1%)

User tax is deducted BEFORE the AMM swap. The AMM only sees `sol_to_swap = amount_in - tax`. Assuming a 4% buy tax (300 bps low regime), `sol_to_swap = amount * 0.96`. Then the AMM deducts LP fee: `eff = sol_to_swap * 0.99`.

| User Sends | Tax (4%) | To AMM | Effective (after 1% LP) | Tokens Out | Price Impact | Effective Price (SOL/token) |
|------------|----------|--------|------------------------|------------|-------------|---------------------------|
| 0.1 SOL | 0.004 SOL | 0.096 SOL | 0.09504 SOL | ~55,097,181 | 0.019% | 0.000001744 |
| 1 SOL | 0.04 SOL | 0.96 SOL | 0.9504 SOL | ~549,519,616 | 0.190% | 0.000001748 |
| 10 SOL | 0.4 SOL | 9.6 SOL | 9.504 SOL | ~5,402,803,528 | 1.87% | 0.000001778 |
| 100 SOL | 4.0 SOL | 96 SOL | 95.04 SOL | ~46,283,932,034 | 15.98% | 0.000002076 |

**Worked example: 1 SOL buy**

```
amount_in     = 1,000,000,000 lamports (1 SOL)
tax (4%)      = 40,000,000 lamports
sol_to_swap   = 960,000,000 lamports
eff           = 960,000,000 * 9900 / 10000 = 950,400,000 lamports
tokens_out    = 290,000,000,000,000 * 950,400,000 / (500,000,000,000 + 950,400,000)
              = 275,616,000,000,000,000,000,000 / 500,950,400,000
              = 550,194,620 (approx, actual depends on integer truncation)
price_impact  = 950,400,000 / (500,000,000,000 + 950,400,000) = 0.190%
```

**Worked example: 100 SOL buy**

```
amount_in     = 100,000,000,000 (100 SOL)
tax (4%)      = 4,000,000,000
sol_to_swap   = 96,000,000,000
eff           = 96,000,000,000 * 9900 / 10000 = 95,040,000,000
tokens_out    = 290,000,000,000,000 * 95,040,000,000 / (500,000,000,000 + 95,040,000,000)
              = 27,561,600,000,000,000,000,000,000 / 595,040,000,000
              = 46,318,579,424 (approx)
price_impact  = 95,040,000,000 / 595,040,000,000 = 15.98%
```

At 100 SOL (20% of pool depth), slippage is significant but still within the 50% floor. Note that slippage is roughly 2x compared to a 1000 SOL pool for the same trade size.

### User Swaps -- SOL Pools (Sell: Token -> SOL)

Sell swaps pay tax on the SOL output side. The AMM executes first at full token amount, then tax is extracted from the SOL received.

| User Sells (tokens) | Equivalent SOL at seed price | Effective (after 1% LP) | SOL Out (pre-tax) | Tax (4%) | SOL Received | Price Impact |
|---------------------|------------------------------|------------------------|-------------------|----------|-------------|-------------|
| 58M CRIME (~0.1 SOL worth) | ~0.1 SOL | ~57,420,000 | ~99,005,901 lamports | ~3,960,236 | ~95,045,665 | 0.020% |
| 580M CRIME (~1 SOL worth) | ~1 SOL | ~574,200,000 | ~989,107,746 | ~39,564,309 | ~949,543,437 | 0.198% |
| 5.8B CRIME (~10 SOL worth) | ~10 SOL | ~5,742,000,000 | ~9,705,882,352 | ~388,235,294 | ~9,317,647,058 | 1.94% |

### Conversion Vault (CRIME/FRAUD to PROFIT)

The conversion vault uses a fixed 100:1 rate. There is no AMM curve, no constant-product math, and no slippage.

| Swap In | PROFIT Out | Slippage | Price Impact |
|---------|-----------|----------|-------------|
| 100 CRIME | 1 PROFIT | 0% | 0% |
| 1M CRIME | 10,000 PROFIT | 0% | 0% |
| 100M CRIME | 1,000,000 PROFIT | 0% | 0% |

The vault operates deterministically: output = input / 100 (truncated). No LP fee, no tax, no price impact.
The only constraint is vault token balance -- if the vault's PROFIT balance is insufficient, the conversion fails.

**MEV immunity**: Fixed-rate conversions cannot be sandwiched or front-run. There is no price to manipulate.

### Carnage Swaps -- Small Vault

Carnage swaps are tax-exempt (0% tax) but still pay the 1% LP fee. They execute via `swap_exempt` in the Tax Program.

**Scenario: CRIME/SOL pool at mainnet seed (500 SOL + 290M CRIME)**

| Carnage Vault SOL | Effective (after 1% LP) | Tokens Bought | Price Impact | Slippage vs. Spot |
|-------------------|------------------------|---------------|-------------|-------------------|
| 1 SOL | 990,000,000 | ~573,457,711 | 0.198% | 1.18% |
| 5 SOL | 4,950,000,000 | ~2,843,564,356 | 0.980% | 1.97% |
| 10 SOL | 9,900,000,000 | ~5,617,647,058 | 1.94% | 2.92% |

**Worked example: 5 SOL Carnage buy**

```
amount_in    = 5,000,000,000 (5 SOL)
tax          = 0 (exempt)
eff          = 5,000,000,000 * 9900 / 10000 = 4,950,000,000
tokens_out   = 290,000,000,000,000 * 4,950,000,000 / (500,000,000,000 + 4,950,000,000)
             = 1,435,500,000,000,000,000,000,000 / 504,950,000,000
             = 2,842,861,670 (approx)
price_impact = 4,950,000,000 / 504,950,000,000 = 0.980%
```

At small vault sizes (1-10 SOL), Carnage swaps cause modest disruption. The pool absorbs these without hitting any slippage floor, though price impact is roughly 2x compared to 1000 SOL pools.

### Carnage Swaps -- Large Vault

| Carnage Vault SOL | Effective (after 1% LP) | Tokens Bought | Price Impact | Slippage vs. Spot |
|-------------------|------------------------|---------------|-------------|-------------------|
| 50 SOL | 49,500,000,000 | ~26,091,735,537 | 9.00% | 9.91% |
| 100 SOL | 99,000,000,000 | ~47,874,749,582 | 16.53% | 17.50% |
| 500 SOL | 495,000,000,000 | ~144,271,356,783 | 49.75% | 50.35% |
| 1000 SOL (MAX) | 990,000,000,000 | ~192,550,335,570 | 66.44% | 66.76% |

**Worked example: 1000 SOL Carnage buy (maximum)**

```
amount_in    = 1,000,000,000,000 (1000 SOL, MAX_CARNAGE_SWAP_LAMPORTS)
eff          = 1,000,000,000,000 * 9900 / 10000 = 990,000,000,000
tokens_out   = 290,000,000,000,000 * 990,000,000,000 / (500,000,000,000 + 990,000,000,000)
             = 287,100,000,000,000,000,000,000,000 / 1,490,000,000,000
             = 192,617,449,664 (approx)

price_impact = 990,000,000,000 / 1,490,000,000,000 = 66.44%
"fair" output at spot = 290,000,000,000,000 * 990,000,000,000 / 500,000,000,000 = 574,200,000,000
actual/fair  = 192,617,449,664 / 574,200,000,000 = 33.55%
slippage     = 66.44%
```

A maximum 1000 SOL Carnage swap against a 500 SOL pool is extremely disruptive -- the swap amount is 2x the pool depth. This is by design -- Carnage is meant to cause large price disruptions that create arbitrage opportunities. The 500 SOL pool amplifies this effect compared to the previous 1000 SOL target.

**After this swap, pool reserves become:**
- R_SOL = 500 + 1,000 = 1,500 SOL (tripling the SOL side)
- R_TOKEN = 290M - 192.6M = ~97.4M CRIME (reducing to ~33% of original)
- New implied price: 1500 / 97.4M = ~0.0000154 SOL/CRIME (~9x higher)

Arbitrageurs will immediately sell CRIME back to the pool to capture the premium, restoring equilibrium.

### Carnage Sell Path -- Dual-Pool Slippage Compounding

The Carnage Sell path (2% probability, VRF byte 6 < 5) performs **two** consecutive pool operations: (1) sell held tokens to the held-token/SOL pool, receiving SOL, then (2) buy target tokens from the target-token/SOL pool using the combined SOL (sale proceeds + existing vault SOL). Each leg independently incurs constant-product slippage, and the effects compound.

**Example:** Carnage holds 10M CRIME, vault has 5 SOL, target = FRAUD (both pools at 500 SOL + 290M tokens):
- **Leg 1 (sell CRIME for SOL):** 10M CRIME -> ~16.7 SOL (after 1% LP fee). Price impact: ~3.3%.
- **Leg 2 (buy FRAUD with ~21.7 SOL total):** ~21.7 SOL -> ~12,030M base units FRAUD (after 1% LP fee). Price impact: ~4.1%.
- **Combined slippage:** ~7.3% -- each leg's impact is independent but additive to the user-observable outcome. Slippage is modestly higher than against 1000 SOL pools due to the shallower liquidity.

The 50% minimum output floor (`MINIMUM_OUTPUT_FLOOR_BPS = 5000`) applies to each leg individually via the `swap_exempt` CPI to the Tax Program. A single-leg failure reverts the entire atomic Carnage transaction. The Carnage-specific 85%/75% floor (atomic/fallback) also applies per-swap, providing tighter protection on each leg. The MAX_CARNAGE_SWAP_LAMPORTS (1000 SOL) cap bounds the buy leg, while the sell leg is bounded by holdings.

---

## Slippage Protection Validation

### 50% User Floor (MINIMUM_OUTPUT_FLOOR_BPS = 5000)

**Source:** `programs/tax-program/src/constants.rs` line 40

The Tax Program enforces a protocol-level minimum output floor on all user swaps. The floor is calculated using the constant-product formula against current pool reserves:

```rust
// From programs/tax-program/src/helpers/tax_math.rs
pub fn calculate_output_floor(reserve_in, reserve_out, amount_in, floor_bps) -> Option<u64> {
    let expected = reserve_out * amount_in / (reserve_in + amount_in);
    let floor = expected * floor_bps / 10_000;
    Some(floor as u64)
}
```

The check in `swap_sol_buy.rs`:
```rust
let output_floor = calculate_output_floor(reserve_a, reserve_b, sol_to_swap, MINIMUM_OUTPUT_FLOOR_BPS)?;
require!(minimum_output >= output_floor, TaxError::MinimumOutputFloorViolation);
```

Note: The floor uses `sol_to_swap` (post-tax), not `amount_in`, because tax is deducted from input before the swap. Using `amount_in` would compute a higher expected output than achievable, making the floor too tight.

**When does the 50% floor trigger?**

The 50% floor rejects transactions where the user's `minimum_output` parameter is less than 50% of the expected constant-product output. This protects against:

1. **Sandwich attacks**: An attacker would need to manipulate the pool so severely that the expected output drops by >50%, which requires moving the price by >50% first (prohibitively expensive).

2. **Accidental 0 slippage**: Users or bots setting `minimum_output = 0` are rejected.

3. **Stale quotes**: Front-end quotes that are extremely outdated get rejected.

**What pool conditions cause >50% price impact on a single swap?**

For a swap of size `dx` to experience >50% slippage:

```
dx / (R_in + dx) > 0.50
dx > R_in + dx - 2*R_in  (wrong rearrangement)

Correctly: price_impact = dx / (R_in + dx)
For impact > 50%: dx > R_in

The swap amount must exceed the input reserve.
```

In the mainnet CRIME/SOL pool (R_SOL = 500 SOL), a user would need to swap more than 500 SOL in a single transaction (after tax deduction) to hit the 50% floor. At 4% tax, that requires sending ~521 SOL.

**Threshold table (mainnet pools, post-tax amounts hitting 50% impact):**

| Pool | Reserve In | Swap Amount for 50% Impact | Pre-tax Amount (at 4%) |
|------|-----------|---------------------------|----------------------|
| CRIME/SOL (buy) | 500 SOL | >500 SOL post-tax | >521 SOL |
| FRAUD/SOL (buy) | 500 SOL | >500 SOL post-tax | >521 SOL |
| CRIME/SOL (sell) | 290M CRIME | >290M CRIME | >290M CRIME |

Note: The conversion vault has no slippage floor because it has no slippage. The 50% floor applies only to the two SOL pools.

In practice, the 50% floor will never trigger for normal users. It exists as a safety net against automated attacks and configuration errors.

### 85% Carnage Atomic Floor (CARNAGE_SLIPPAGE_BPS_ATOMIC = 8500)

**Source:** `programs/epoch-program/src/constants.rs` line 127

The atomic Carnage path (bundled with VRF consume_randomness in the same transaction) enforces an 85% floor:

```rust
// From execute_carnage_atomic.rs
let expected = (reserve_token as u128)
    .checked_mul(total_buy_amount as u128)
    .and_then(|n| n.checked_div(
        (reserve_sol as u128).checked_add(total_buy_amount as u128)?
    ))? as u64;

let min_output = (expected as u128)
    .checked_mul(CARNAGE_SLIPPAGE_BPS_ATOMIC as u128)
    .and_then(|n| n.checked_div(10_000))? as u64;

require!(bought >= min_output, EpochError::CarnageSlippageExceeded);
```

**When does the 85% atomic floor trigger?**

The floor triggers when actual tokens received are less than 85% of expected output at pre-swap reserves. This catches:

1. **Pool manipulation** in the same block (someone front-running the Carnage TX)
2. **Extreme price movement** between reserve snapshot and swap execution

For the 85% floor to trigger, actual slippage must exceed 15%. Against the mainnet 500 SOL pool, this requires:

```
For 15% deviation from expected:
This could happen if ~88 SOL of concurrent swaps hit the pool in the same block
before the Carnage TX, moving reserves enough that the pre-swap snapshot
is 15% stale.
```

In practice, MEV defense for atomic Carnage is primarily through atomicity (VRF result unknown until callback) and VRF unpredictability, not this floor. The 85% floor is a safety net for edge cases.

### 75% Carnage Fallback Floor (CARNAGE_SLIPPAGE_BPS_FALLBACK = 7500)

**Source:** `programs/epoch-program/src/constants.rs` line 132

The fallback Carnage path (callable by anyone after the 50-slot lock window expires) uses a more lenient 75% floor:

```rust
// From execute_carnage.rs
let min_output = (expected as u128)
    .checked_mul(CARNAGE_SLIPPAGE_BPS_FALLBACK as u128)
    .and_then(|n| n.checked_div(10_000))? as u64;
```

**Design rationale:** Fallback runs after the atomic path failed (e.g., compute budget exceeded). Prioritizing execution over optimal price prevents SOL from accumulating indefinitely in the Carnage vault. The 25% tolerance accommodates market movement during the ~20-second lock window plus any concurrent trades.

**Timing windows:**
- Slots 0-50 (CARNAGE_LOCK_SLOTS): Atomic-only. Fallback rejected with `CarnageLockActive`.
- Slots 50-300 (CARNAGE_DEADLINE_SLOTS): Fallback allowed. 75% floor applies.
- Slots 300+: Expired. `expire_carnage` clears pending state. SOL stays in vault.

---

## Liquidity Depth Over Time

### LP Fee Compounding Effect

LP fees are not extracted -- they compound directly into pool reserves. Every swap increases k.

**Fee revenue formula per swap:**

```
fee_captured = amount_in * fee_bps / 10_000
```

This amount stays in the input reserve, increasing k = R_in * R_out.

**Model: SOL pool at various daily volumes**

Assumptions:
- Mainnet initial: 500 SOL + 290M CRIME
- k_initial = 500 * 290,000,000 = 145,000,000,000
- LP fee: 1% (100 bps)
- Average swap size: 1 SOL
- All swaps are buys (SOL in) for simplicity

| Daily Volume (SOL) | Swaps/Day | Daily Fee Revenue (SOL) | Monthly Reserve Growth | Annual Reserve Growth |
|--------------------|-----------|------------------------|----------------------|---------------------|
| 10 SOL | 10 | 0.10 SOL | 3.0 SOL (+0.3%) | 36.5 SOL (+3.65%) |
| 100 SOL | 100 | 1.00 SOL | 30 SOL (+3%) | 365 SOL (+36.5%) |
| 1,000 SOL | 1,000 | 10.0 SOL | 300 SOL (+30%) | 3,650 SOL (+365%) |
| 10,000 SOL | 10,000 | 100.0 SOL | 3,000 SOL (+300%) | 36,500 SOL (+3650%) |

**Note:** This is a simplified linear model. In reality:
- Fees compound (each fee payment increases reserves, reducing slippage, attracting more volume)
- Both sides of the pool grow (sell swaps add tokens, buy swaps add SOL)
- Arbitrage volume (post-Carnage) contributes significant fee revenue
- Tax deduction reduces the SOL reaching the AMM

**Note on conversion vault:** The conversion vault has no LP fees and no fee compounding. Its PROFIT balance is fixed at initialization and depletes as conversions occur. Vault replenishment is a protocol operation (e.g., from staking rewards distribution or treasury allocation). The liquidity growth model above applies only to the two SOL pools.

### Carnage Deflation Effect

Burns reduce circulating supply, permanently removing tokens from the token side. This affects pool dynamics:

**Direct effect:** When Carnage burns tokens held in its vault, the pool reserves are unchanged (tokens were already withdrawn from the pool during the buy). But the circulating supply decreases, making remaining tokens scarcer.

**Price mechanics of Carnage buy-and-burn:**

1. Carnage buys CRIME with 50 SOL from the CRIME/SOL pool
   - Pool: 500 SOL + 290M CRIME -> 550 SOL + ~264.0M CRIME
   - CRIME price increases from 0.000001725 to ~0.00000208 SOL (+20.6%)

2. Carnage burns the 13.8M CRIME it purchased
   - Circulating supply decreases by 13.8M
   - Pool reserves unchanged (burn is from Carnage vault, not pool)

3. Arbitrageurs notice CRIME is overpriced in the pool
   - They sell CRIME back to the pool, extracting the SOL premium
   - Pool gradually rebalances toward equilibrium
   - But equilibrium is at a HIGHER CRIME price because supply is permanently lower

**Self-correction via arbitrage:**

After a Carnage buy pushes CRIME price up in the pool:
- External holders sell CRIME into the pool, extracting the premium
- This restores the pool ratio but at a new equilibrium reflecting reduced supply
- Each burn ratchets the floor price permanently upward

**Cumulative burn impact model (mainnet, first year):**

Assuming:
- 100 SOL daily volume generating ~2.4 SOL/day in Carnage funding (24% of ~4% tax on 100 SOL)
- ~2 Carnage triggers per day
- Each trigger spends accumulated SOL (average ~1.2 SOL)
- 98% of triggers burn (2% sell)

```
Annual Carnage SOL spent:    ~876 SOL
Annual tokens burned:        Depends on pool price at time of burn
At initial price:            ~254M tokens burned per year
As % of initial supply:      ~25.4% of initial 1B supply (per token)
```

This is a significant deflationary force. Over time, burns compound -- each burn makes subsequent burns smaller (same SOL buys fewer tokens as price rises), creating a natural deceleration curve.

---

## Worst-Case Scenarios

### Scenario 1: Thin Pools + Large Carnage

**Setup:** Pools have minimal liquidity (e.g., devnet-like: 10 SOL + 10,000 tokens) and Carnage has accumulated 100 SOL (unlikely but possible if several triggers failed).

```
R_SOL = 10,000,000,000 (10 SOL)
R_TOKEN = 10,000,000,000 (10,000 tokens)
Carnage swap = 100 SOL = 100,000,000,000

eff = 100,000,000,000 * 9900 / 10000 = 99,000,000,000

expected_output = 10,000,000,000 * 99,000,000,000 / (10,000,000,000 + 99,000,000,000)
               = 990,000,000,000,000,000,000 / 109,000,000,000
               = 9,082,568,807

price_impact = 99,000,000,000 / 109,000,000,000 = 90.8%
```

Carnage receives ~9,082 tokens (out of 10,000 in the pool), experiencing 90.8% slippage. This far exceeds the 85% atomic floor (would need 85% of 9,082 = 7,720 tokens, but actually the "expected" in the floor check is the same formula, so the check is `actual >= expected * 85%` -- but actual IS expected, so this always passes).

Wait -- let me reconsider. The slippage floor compares `bought` (actual tokens received from the swap) against `expected` (calculated from pre-swap reserves before the CPI). Since the swap itself uses the same reserves, `bought` should approximately equal `expected` minus rounding. The floor catches external manipulation between the snapshot and execution, not the swap's own price impact.

**Conclusion:** The Carnage slippage floor does NOT prevent large-slippage Carnage swaps against thin pools. It only catches manipulation between the reserve snapshot and swap execution. This is by design -- Carnage is meant to cause disruption, and the 1000 SOL cap bounds the maximum damage.

**Post-swap state:**
- R_SOL = 10 + 100 = 110 SOL
- R_TOKEN = 10,000 - 9,082 = 918 tokens
- New price: 110 / 918 = 0.1198 SOL/token (vs. 0.001 SOL/token before -- 120x increase)

This creates a massive arbitrage opportunity. Anyone holding tokens can sell into the pool at 120x the previous price. The pool will rapidly rebalance.

**Risk assessment:** Low risk. Thin pools only exist on devnet/testnet. Mainnet pools are seeded with 500 SOL, and Carnage accumulation of >1000 SOL (the MAX_CARNAGE_SWAP cap) would take weeks of no triggers (probability: astronomically low given ~4.3% trigger rate per epoch).

### Scenario 2: Asymmetric Burns

**Setup:** Over 6 months, CRIME triggers happen to dominate. Carnage burned 200M CRIME but only 50M FRAUD.

**Effect on CRIME/SOL pool:**
- CRIME supply reduced by 20% more than FRAUD
- CRIME pool has less circulating supply to sell into it
- CRIME price is structurally higher than FRAUD price

**Effect on conversion vault:**
- The conversion vault is unaffected by burn asymmetry -- the 100:1 rate is fixed regardless of circulating supply.
- Cross-token arbitrage now routes through the conversion vault (e.g., sell CRIME for SOL, buy FRAUD with SOL) rather than through PROFIT pools.

**Self-correction mechanisms:**
1. **VRF randomness:** Buy target is 50/50 CRIME vs. FRAUD. Over thousands of triggers, the ratio converges to equal.
2. **Cross-pool arbitrage:** If CRIME becomes expensive relative to FRAUD, arbitrageurs route: sell CRIME (expensive) for SOL -> buy FRAUD (cheap) with SOL through the two SOL pools.
3. **No permanent damage:** Burns are permanent, but the AMM ratio can always rebalance through market activity.

**Quantitative impact:**

If CRIME has 800M circulating (200M burned) and FRAUD has 950M (50M burned):
- CRIME is 19% scarcer than FRAUD
- Equilibrium CRIME/SOL price should be ~19% higher than FRAUD/SOL price
- Arbitrageurs will enforce this across the two SOL pools

This is acceptable -- it is emergent market pricing, not a protocol failure.

### Scenario 3: Zero Volume Period

**Setup:** Nobody trades for 1 week. Then 1 month.

**1 week of zero volume:**
- Pool reserves: Unchanged (no LP fee compounding, but no degradation either)
- Carnage vault: Unchanged (no tax revenue flowing in)
- Pool prices: Frozen at last trade price
- k invariant: Unchanged

**1 month of zero volume:**
- Same as above. Permanent liquidity means zero degradation.
- If a single Carnage trigger occurs (funded by residual vault balance), it operates normally against the unchanged pool.
- First trade after the hiatus executes at the same price as the last trade before it.

**Comparison to LP-token DEXs:** On Uniswap/Raydium, zero volume could lead to LP withdrawal, draining liquidity. Dr. Fraudsworth pools CANNOT be drained. They persist indefinitely at whatever depth they have.

**Re-activation:**
- First trade after a long hiatus faces zero additional slippage from the pause
- If the external market price has drifted, the first trade captures the arbitrage spread
- Normal operation resumes immediately

---

## Pool Drain Impossibility Proof

### Theorem

For any valid swap with `amount_in > 0` and `reserve_in > 0` and `reserve_out > 0`, the output `amount_out` is strictly less than `reserve_out`.

### Proof

From the constant-product formula:

```
amount_out = reserve_out * effective_input / (reserve_in + effective_input)
```

Where `effective_input >= 0` (post-fee input).

**Case 1: effective_input = 0** (fee consumed entire input)

```
amount_out = reserve_out * 0 / (reserve_in + 0) = 0 < reserve_out
```

The `check_effective_input_nonzero` guard catches this and rejects the swap.

**Case 2: effective_input > 0**

```
amount_out = reserve_out * effective_input / (reserve_in + effective_input)
```

Since `reserve_in > 0`:

```
reserve_in + effective_input > effective_input
```

Therefore:

```
effective_input / (reserve_in + effective_input) < 1
```

And:

```
amount_out = reserve_out * (effective_input / (reserve_in + effective_input)) < reserve_out * 1 = reserve_out
```

Since integer division truncates down:

```
amount_out <= floor(reserve_out * effective_input / (reserve_in + effective_input)) < reserve_out
```

**QED.** The output of any valid swap is strictly less than the output reserve. No single swap (or sequence of swaps) can drain a pool.

### Additional Safety: k-Invariant Check

Even if the formula somehow produced an output >= reserve_out (impossible as proven above), the k-invariant check would catch it:

```
k_after = (reserve_in + amount_in) * (reserve_out - amount_out)
```

If `amount_out >= reserve_out`, then `reserve_out - amount_out <= 0`, making `k_after <= 0 < k_before`. The check `k_after >= k_before` would fail, reverting the transaction.

### Additional Safety: ZeroSwapOutput Guard

From `math.rs`, `check_swap_output_nonzero` rejects swaps where `effective_input > 0` but `amount_out = 0`. This prevents dust attacks where users burn tokens for zero output.

### On-Chain Enforcement

The k-invariant is verified by `verify_k_invariant()` in `math.rs`:

```rust
pub fn verify_k_invariant(
    reserve_in_before: u64, reserve_out_before: u64,
    reserve_in_after: u64, reserve_out_after: u64,
) -> Option<bool> {
    let k_before = (reserve_in_before as u128).checked_mul(reserve_out_before as u128)?;
    let k_after = (reserve_in_after as u128).checked_mul(reserve_out_after as u128)?;
    Some(k_after >= k_before)
}
```

This is backed by 10,000-iteration proptest verification (`k_invariant_holds_for_valid_swaps`) and 10,000-iteration verification that `output_never_exceeds_reserve_out`.

---

## Key Findings & Recommendations

### Safe Parameters

1. **User swaps up to ~50 SOL** experience manageable slippage (<10%) against mainnet-seeded pools (500 SOL). The 50% floor will never trigger for reasonable trade sizes. Note: slippage is roughly 2x compared to a 1000 SOL pool for the same trade size.

2. **Carnage swaps up to ~50 SOL** cause <5% price impact. At typical Carnage accumulation rates (~1-2 SOL between triggers), slippage is negligible (<0.2%).

3. **The conversion vault** provides zero-slippage PROFIT acquisition at a fixed 100:1 rate, with no price impact for any trade size (limited only by vault balance).

4. **Pool drain is mathematically impossible.** The constant-product formula guarantees output < reserve, and the k-invariant check provides defense-in-depth.

### Monitor These Conditions

1. **Carnage vault accumulation >100 SOL**: This would mean ~10x normal between-trigger accumulation. Indicates either very high volume (good) or failed triggers (investigate).

2. **Consecutive Carnage failures**: If 5+ triggers fail, the vault will accumulate rapidly. Check compute budget, pool state, and hook program health.

3. **Post-Carnage arbitrage lag**: If pool prices don't revert within 10-15 minutes after a large Carnage event, check if arbitrage bots are operational. Sustained price dislocation means free money is sitting on the table.

### Slippage Floor Summary

| Context | Floor | Tolerance | Source Constant |
|---------|-------|-----------|-----------------|
| User swaps | 50% of expected output | 50% tolerance | `MINIMUM_OUTPUT_FLOOR_BPS = 5000` |
| Carnage atomic | 85% of expected output | 15% tolerance | `CARNAGE_SLIPPAGE_BPS_ATOMIC = 8500` |
| Carnage fallback | 75% of expected output | 25% tolerance | `CARNAGE_SLIPPAGE_BPS_FALLBACK = 7500` |

The user 50% floor is very permissive by design -- it catches automated attacks and misconfiguration, not normal slippage. The Carnage 85%/75% floors catch same-block manipulation, not the inherent price impact of large Carnage swaps.

### Liquidity Growth Trajectory

At moderate daily volume (100 SOL/day), pools grow ~73% annually from LP fee compounding alone (higher percentage growth rate than a 1000 SOL pool because the base is smaller). Combined with Carnage-driven arbitrage volume (which generates additional LP fees), pools should deepen significantly over the first year.

The permanent liquidity model means this growth is monotonic -- pools never shrink. Over time, slippage decreases for all participants, creating a virtuous cycle: deeper pools attract more volume, more volume generates more fees, more fees deepen the pools.
