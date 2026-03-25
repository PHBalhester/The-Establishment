---
doc_id: token-economics-model
title: "Dr. Fraudsworth's Finance Factory -- Token Economics Model"
wave: 2
requires: [project-overview, architecture]
provides: [token-economics-model]
status: draft
decisions_referenced: [token-model, amm-design, security, operations, cpi-architecture]
needs_verification: [mainnet-priority-fee-vs-bounty-economics]
---

# Token Economics Model

## Overview

Dr. Fraudsworth's Finance Factory operates a three-token economy where all game rewards derive from trading friction -- not inflation, not external subsidies, and not team-controlled emissions. The system creates a closed-loop SOL extraction machine powered by three mechanical volume drivers: VRF-driven tax regime flips, Carnage buyback-and-burn events, and persistent soft-peg arbitrage via the PROFIT conversion vault.

This document traces every lamport from user entry to exit, proves the rewards model is sustainable under varying volume conditions, and identifies the edge cases where the system degrades gracefully rather than failing catastrophically.

**Core thesis**: Every SOL that enters the system via buy/sell taxes is immutably split -- 71% to staking rewards, 24% to Carnage buyback, 5% to treasury. There is no mechanism for these ratios to change (programs are immutable post-burn). The only variable is volume.


## Token Supply & Distribution

### Fixed Supplies (Token-2022, 6 decimals)

| Token   | Total Supply     | Purpose                       | Mint Authority |
|---------|-----------------|-------------------------------|----------------|
| CRIME   | 1,000,000,000   | IP token (one side of duality) | Burned         |
| FRAUD   | 1,000,000,000   | IP token (other side of duality) | Burned       |
| PROFIT  | 20,000,000      | Reward-bearing staking token  | Burned         |

**Mint burned** means the mint authority has been permanently revoked via Token-2022's `SetAuthority` instruction with `AuthorityType::MintTokens` set to `None`. No new tokens can ever be created.

### Distribution (Zero Team Allocation)

| Destination          | CRIME       | FRAUD       | PROFIT      |
|---------------------|-------------|-------------|-------------|
| Bonding Curve (46%) | 460,000,000 | 460,000,000 | 0           |
| Pool Seeding (29%)  | 290,000,000 | 290,000,000 | 0           |
| Vault Seeding (25%) | 250,000,000 | 250,000,000 | 20,000,000  |
| Team / Insiders     | 0           | 0           | 0           |

**Bonding curve**: Linear price curve from 0.00000045 SOL/token to 0.000001725 SOL/token (~3.83x appreciation for first buyers). Each IP token curve raises 500 SOL. 48-hour deadline. 20M wallet cap per curve. Both curves must complete atomically (either both succeed or both fail).

**Pool seeding**: After bonding curve completes, protocol-owned liquidity is created:

| Pool           | SOL Side      | Token Side    | LP Fee  |
|---------------|---------------|---------------|---------|
| CRIME/SOL     | 500 SOL       | 290,000,000 CRIME | 100 bps (1%) |
| FRAUD/SOL     | 500 SOL       | 290,000,000 FRAUD | 100 bps (1%) |

Source: AMM constants at `/programs/amm/src/constants.rs` -- `SOL_POOL_FEE_BPS = 100`.

**Conversion vault seeding**: The remaining 250,000,000 CRIME and 250,000,000 FRAUD tokens are deposited into the conversion vault alongside the full 20,000,000 PROFIT supply. This provides a cross-conversion buffer for users to convert between factions and acquire PROFIT.

PROFIT is **never sold directly** -- it can only be acquired by converting CRIME or FRAUD tokens through the conversion vault at a fixed 100:1 rate (100 CRIME or FRAUD -> 1 PROFIT).


## Tax Regime Mechanics

### Dynamic Tax Rates (VRF-Driven)

Every epoch (~30 minutes on mainnet, 4,500 slots), a Switchboard VRF oracle produces 32 random bytes. Bytes 0-4 determine the next epoch's tax configuration:

| VRF Byte | Purpose                   | Mechanism                                           |
|----------|---------------------------|-----------------------------------------------------|
| Byte 0   | Flip decision             | `< 192` = flip cheap side (75% probability)         |
| Byte 1   | CRIME low tax magnitude   | `% 4` maps to `[100, 200, 300, 400]` bps (1-4%)    |
| Byte 2   | CRIME high tax magnitude  | `% 4` maps to `[1100, 1200, 1300, 1400]` bps (11-14%) |
| Byte 3   | FRAUD low tax magnitude   | `% 4` maps to `[100, 200, 300, 400]` bps (1-4%)    |
| Byte 4   | FRAUD high tax magnitude  | `% 4` maps to `[1100, 1200, 1300, 1400]` bps (11-14%) |

Source: `/programs/epoch-program/src/helpers/tax_derivation.rs`, lines 23-31.

**Flip threshold**: `FLIP_THRESHOLD = 192`, meaning `192/256 = 75%` probability of flipping each epoch. This creates frequent regime changes that drive reactive trading.

### Tax Assignment Logic

Each token gets **independent** magnitude rolls (CRIME and FRAUD can have different low/high rates in the same epoch):

- **Cheap side** (low buy tax, high sell tax): Attractive to buy, expensive to sell.
- **Expensive side** (high buy tax, low sell tax): Expensive to buy, attractive to sell.

```
If CRIME is cheap:
  CRIME: buy_tax = crime_low_bps (1-4%), sell_tax = crime_high_bps (11-14%)
  FRAUD: buy_tax = fraud_high_bps (11-14%), sell_tax = fraud_low_bps (1-4%)

If FRAUD is cheap:
  FRAUD: buy_tax = fraud_low_bps (1-4%), sell_tax = fraud_high_bps (11-14%)
  CRIME: buy_tax = crime_high_bps (11-14%), sell_tax = crime_low_bps (1-4%)
```

Source: `derive_taxes()` in `/programs/epoch-program/src/helpers/tax_derivation.rs`, lines 84-128.

### Genesis Configuration

At protocol initialization, before first VRF resolve:
- `GENESIS_LOW_TAX_BPS = 300` (3%)
- `GENESIS_HIGH_TAX_BPS = 1400` (14%)

Source: `/programs/epoch-program/src/constants.rs`, lines 99-103.

### Tax Rate Ranges

| Direction        | Minimum | Maximum | Average (uniform) |
|-----------------|---------|---------|-------------------|
| Cheap buy tax    | 100 bps (1%) | 400 bps (4%) | 250 bps (2.5%) |
| Cheap sell tax   | 1100 bps (11%) | 1400 bps (14%) | 1250 bps (12.5%) |
| Expensive buy tax | 1100 bps (11%) | 1400 bps (14%) | 1250 bps (12.5%) |
| Expensive sell tax | 100 bps (1%) | 400 bps (4%) | 250 bps (2.5%) |

### Round-Trip Tax Costs

For a user who buys and later sells the same token:

| Scenario                        | Buy Tax | Sell Tax | Round-Trip |
|---------------------------------|---------|----------|------------|
| Buy cheap, sell cheap (no flip) | 1-4%    | 11-14%   | 12-18%     |
| Buy cheap, sell expensive (flip)| 1-4%    | 1-4%     | 2-8%       |
| Buy expensive, sell expensive (no flip) | 11-14% | 1-4% | 12-18% |
| Buy expensive, sell cheap (flip)| 11-14%  | 11-14%  | 22-28%     |

The 75% flip probability means the "buy cheap, sell expensive" (favorable) path occurs 75% of the time, while the punishing "buy expensive, sell cheap" path occurs 25%. This creates urgency: traders who wait risk a flip.


## SOL Flow Analysis (where every lamport goes)

### Buy Flow (SOL -> CRIME/FRAUD)

Tax is deducted from the SOL INPUT before the swap reaches the AMM.

**Concrete example**: User buys CRIME with 1 SOL when `crime_buy_tax_bps = 300` (3%):

```
Input:           1,000,000,000 lamports (1 SOL)

Step 1: Tax calculation
  tax = 1,000,000,000 * 300 / 10,000 = 30,000,000 lamports (0.03 SOL)

Step 2: Tax distribution (split_distribution)
  staking  = floor(30,000,000 * 71 / 100)   = 21,300,000 lamports (71%)
  carnage  = floor(30,000,000 * 24 / 100)   = 7,200,000 lamports  (24%)
  treasury = 30,000,000 - 21,300,000 - 7,200,000 = 1,500,000 lamports (5%)

Step 3: SOL to swap
  sol_to_swap = 1,000,000,000 - 30,000,000 = 970,000,000 lamports

Step 4: AMM swap (constant product, 1% LP fee)
  effective_input = 970,000,000 * 9,900 / 10,000 = 960,300,000
  output = reserve_b * effective_input / (reserve_a + effective_input)
  (LP fee of 9,700,000 lamports stays in pool, deepening liquidity)

Step 5: Atomic distribution
  21,300,000 -> Staking escrow (+ deposit_rewards CPI updates pending_rewards)
  7,200,000  -> Carnage SOL vault
  1,500,000  -> Treasury
```

Source: `/programs/tax-program/src/instructions/swap_sol_buy.rs`, lines 47-343.

### Sell Flow (CRIME/FRAUD -> SOL)

Tax is deducted from the WSOL OUTPUT after the AMM swap. This is more complex because WSOL must be unwrapped to native SOL for distribution.

**Concrete example**: User sells 100,000 CRIME tokens when `crime_sell_tax_bps = 1200` (12%):

```
Input:           100,000,000,000 base units (100,000 tokens at 6 decimals)

Step 1: AMM swap (full amount, no input deduction)
  effective_input = amount * 9,900 / 10,000 (1% LP fee applied by AMM)
  gross_output = constant-product formula
  Assume gross_output = 185,000,000 lamports (0.185 SOL)

Step 2: Tax calculation on gross output
  tax = 185,000,000 * 1,200 / 10,000 = 22,200,000 lamports

Step 3: Net output
  net_output = 185,000,000 - 22,200,000 = 162,800,000 lamports (0.1628 SOL)

Step 4: Tax distribution
  staking  = floor(22,200,000 * 71 / 100)   = 15,762,000 lamports (71%)
  carnage  = floor(22,200,000 * 24 / 100)   = 5,328,000 lamports  (24%)
  treasury = 22,200,000 - 15,762,000 - 5,328,000 = 1,110,000 lamports (5%)

Step 5: WSOL intermediary cycle
  a) SPL Token transfer: 22,200,000 WSOL from user -> wsol_intermediary PDA
  b) Close intermediary -> swap_authority (unwraps WSOL to native SOL)
  c) System::transfer x3 from swap_authority to staking/carnage/treasury
  d) Recreate + initialize intermediary for next sell
```

Source: `/programs/tax-program/src/instructions/swap_sol_sell.rs`, lines 62-477.

### Conversion Vault (PROFIT Acquisition)

PROFIT is acquired exclusively through the conversion vault -- a standalone program (previously, PROFIT pools served this role). The vault provides:

- **Fixed 100:1 conversion rate**: 100 CRIME or 100 FRAUD converts to 1 PROFIT (deterministic, no slippage)
- **Zero protocol tax**: No buy/sell tax applies to vault conversions
- **Zero LP fee**: No AMM involvement, no liquidity provider fee
- **Bidirectional**: Users can also convert PROFIT back to CRIME or FRAUD at the inverse 1:100 rate

The vault holds 250,000,000 CRIME, 250,000,000 FRAUD, and 20,000,000 PROFIT as cross-conversion reserves. The vault is a leaf-node program (calls Token-2022 transfer_checked only, receives no CPIs from other programs).

Source: `/programs/conversion-vault/src/instructions/convert.rs`

### Carnage Swap (Tax-Exempt)

The Carnage Fund's buys and sells go through `swap_exempt`, which bypasses all tax calculation and distribution. Only the AMM LP fee (1%) still applies. This is enforced: `swap_exempt` requires a `carnage_signer` PDA that only the Epoch Program can produce.

Source: `/programs/tax-program/src/instructions/swap_exempt.rs`, lines 1-18.


## Rewards Model (PROFIT staking)

### Mechanics

Users stake PROFIT tokens to earn SOL game rewards. The staking system uses the Synthetix/Quarry cumulative reward-per-token pattern:

1. **Tax Program deposits SOL**: Each buy/sell triggers `deposit_rewards` CPI, incrementing `pending_rewards` on the global `StakePool`.
2. **Epoch Program finalizes**: At each epoch transition, `update_cumulative` converts `pending_rewards` into the cumulative `rewards_per_token_stored`.
3. **Users claim**: On stake/claim, each user's pending rewards are calculated and `rewards_earned` is updated. The `claim` instruction transfers SOL from escrow to user and sets `last_claim_ts` (starting a 12-hour cooldown). The `unstake` instruction does NOT transfer SOL rewards — it forfeits `rewards_earned` by adding them to `pool.pending_rewards` for redistribution to remaining stakers. Pending reward calculation:

```
pending = staked_balance * (global_cumulative - user_checkpoint) / PRECISION
```

Where `PRECISION = 1,000,000,000,000,000,000` (1e18), providing 18 decimal places of accuracy.

Source: `/programs/staking/src/helpers/math.rs`, lines 36-67 and `/programs/staking/src/constants.rs`, line 21.

### First-Depositor Attack Prevention

The protocol initializes with a "dead stake" of `MINIMUM_STAKE = 1,000,000` base units (1 PROFIT token at 6 decimals). This ensures:
- An attacker cannot be the first depositor (the protocol is always first)
- There is always a nonzero denominator for reward math
- Inflation attack via donation requires > 1M SOL (economically infeasible)

Source: `/programs/staking/src/constants.rs`, lines 23-32.

### Rewards Calculation

For a concrete example, assume a mature protocol:

```
Daily trading volume:  10,000 SOL (across all SOL pools)
Average tax rate:      ~7.5% (midpoint between cheap and expensive sides)
Daily tax collected:   750 SOL
Staking share (71%):   532.5 SOL/day
Total PROFIT staked:   10,000,000 tokens (50% of supply)

Annual SOL rewards:    532.5 * 365 = 194,362.5 SOL
APY at $150/SOL:       ~$30.2M / (10M * implied_price)
```

The APY is strictly a function of volume. At zero volume, APY is zero. There is no inflationary reward or emission schedule.

### Reward Forfeiture on Unstake

On unstake, the user's `rewards_earned` is added to `pool.pending_rewards` rather than being transferred to the user. These forfeited rewards are distributed to remaining stakers at the next `update_cumulative` call, creating a positive externality: users who leave increase rewards for users who stay.

Edge cases:
- If a user has 0 `rewards_earned` (e.g., just claimed), forfeiture is a no-op
- If `total_staked` drops to the dead stake minimum (1 PROFIT), forfeited rewards accrue entirely to the dead stake (protocol keeps them)

Source: `programs/staking/src/instructions/unstake.rs`

### Division Truncation (MATH-05)

All reward calculations truncate (floor) via integer division. This means the sum of all individual user claims is always less than or equal to total deposited rewards. The protocol keeps dust.

Source: Verified in proptest Property 2 (reward conservation) at `/programs/staking/src/helpers/math.rs`, lines 493-527.


## Carnage Mechanics & Deflation

### Trigger Probability

Carnage is determined by VRF bytes 5-7, checked during `consume_randomness`:

| Decision     | VRF Byte | Threshold | Probability          |
|-------------|----------|-----------|----------------------|
| Trigger?    | Byte 5   | `< 11`   | 11/256 = 4.3%        |
| Action type | Byte 6   | `< 5` = Sell, else Burn | Sell: 2%, Burn: 98% |
| Target token| Byte 7   | `< 128` = CRIME, else FRAUD | 50/50      |

Source: `/programs/epoch-program/src/helpers/carnage.rs` and `/programs/epoch-program/src/constants.rs`.

**Expected frequency**: With ~48 epochs/day on mainnet (30-minute epochs), Carnage triggers approximately `48 * 0.043 = ~2 times per day`.

### Carnage Execution Paths (6 paths: 3 action types x 2 target tokens)

Carnage execution uses a shared module (`carnage_execution.rs`, Phase 82 refactor) with a `CarnageAccounts` struct to avoid code duplication across atomic and fallback paths. Each path operates on either CRIME or FRAUD as the target token.

**Path 1: BuyOnly** (no existing holdings)
1. Wrap SOL from Carnage vault -> WSOL
2. Buy target token via `swap_exempt` (tax-free, LP fee still applies)
3. Tokens held in Carnage vault until next trigger

**Path 2: Burn + Buy** (98% when holdings exist)
1. Burn all held tokens via Token-2022 burn (permanent supply reduction)
2. Wrap SOL from Carnage vault -> WSOL
3. Buy new target token via `swap_exempt`
4. New tokens held until next trigger

**Path 3: Sell + Buy** (2% when holdings exist)
1. Sell held tokens -> WSOL via `swap_exempt`
2. Combine: `total_buy_amount = min(tax_sol + wsol_from_sale, MAX_CARNAGE_SWAP_LAMPORTS)`
3. Only wrap the tax SOL portion (sell WSOL already in carnage_wsol)
4. Buy new target token with combined SOL
5. New tokens held until next trigger

Each of these 3 paths can target either CRIME or FRAUD, producing 6 total execution paths (BuyOnly+CRIME, BuyOnly+FRAUD, Burn+CRIME, Burn+FRAUD, Sell+CRIME, Sell+FRAUD).

`MAX_CARNAGE_SWAP_LAMPORTS = 1,000,000,000,000` (1,000 SOL cap per Carnage swap).

Source: `/programs/epoch-program/src/instructions/execute_carnage_atomic.rs`, lines 207-490.

### Slippage Protection

| Path    | Slippage Floor | Window                   |
|---------|---------------|--------------------------|
| Atomic  | 85% (8500 bps) | 0-50 slots (~20 seconds) |
| Fallback| 75% (7500 bps) | 50-300 slots (~100 seconds) |
| Expired | n/a           | > 300 slots              |

Source: `/programs/epoch-program/src/constants.rs`, lines 123-138.

Primary MEV defense is **atomicity** (Carnage executes in the same TX as VRF reveal, giving zero front-running window) plus **VRF unpredictability** (no one knows if Carnage will trigger until the oracle reveals).

### Deflation Model

The burn path (98% of Carnage with holdings) permanently removes tokens from circulation:

```
Assume Carnage SOL vault accumulates ~3 SOL/day (from 24% of taxes)
At 2 triggers/day with ~1.5 SOL average buy each:
  Tokens burned per day = 2 * (tokens_bought_per_trigger)

At pool ratio of ~290M tokens / 500 SOL = 580,000 tokens/SOL:
  ~1.5 SOL buys ~435,000 tokens per trigger (pre-LP-fee)
  ~870,000 tokens burned per day
  ~317,550,000 tokens burned per year (~32% of supply)
```

This is highly approximate and depends on actual volume, pool ratios, and the random interplay of buy targets. The key economic property is that burns are **permanent and one-directional** -- the constant-product AMM self-corrects by increasing the price of the scarcer token, creating arbitrage opportunity that rebalances.


## Soft Peg Mechanism (CRIME <-> FRAUD)

### How the Peg Works

CRIME and FRAUD are economically linked through the conversion vault (previously, PROFIT bridge pools served this role):

```
CRIME/SOL  <->  Vault(CRIME -> PROFIT)  <->  Vault(PROFIT -> FRAUD)  <->  FRAUD/SOL
```

If CRIME becomes cheaper than FRAUD (e.g., due to asymmetric Carnage burns or trading patterns), an arbitrageur executes:

```
1. Buy CRIME cheaply (cheap side, low buy tax 1-4%, 1% LP fee)
2. Convert CRIME -> PROFIT (vault, zero fee, 100:1 rate)
3. Convert PROFIT -> FRAUD (vault, zero fee, 1:100 rate)
4. Sell FRAUD expensively (expensive side, low sell tax 1-4%, 1% LP fee)

Total friction: 1-4% buy tax + 1% LP + 0% vault + 0% vault + 1% LP + 1-4% sell tax = 4-10%
```

This arbitrage is profitable whenever the price divergence exceeds the round-trip friction cost (~4-10% depending on current tax magnitudes). The conversion vault has zero fees, lowering the arbitrage threshold compared to the previous PROFIT pool design where LP fees added 1% round-trip friction on the bridge steps.

### Why the Peg Is Soft

The peg is "soft" because:
1. Round-trip friction (4-10%) means prices can diverge up to that amount before arbitrage is profitable
2. Carnage can asymmetrically burn one token more than the other (50/50 target selection, but random)
3. Tax regime changes every ~30 minutes, shifting which side is cheaper to trade

The AMM's constant-product formula `k = x * y` provides the self-correction mechanism: if one token's supply shrinks (burns), its price rises, making the other token relatively cheaper, drawing buy volume to the cheaper side.


## Arbitrage Loop Analysis

### Three Mechanical Volume Drivers

**Driver 1: Tax Regime Flips (75% probability every 30 minutes)**

When the cheap side flips (CRIME becomes cheap, FRAUD becomes expensive, or vice versa), existing holders of the now-expensive token are incentivized to:
- Sell the expensive token (low sell tax 1-4%)
- Buy the new cheap token (low buy tax 1-4%)

This creates reactive volume at every flip.

**Driver 2: Carnage Events (~2/day)**

Carnage buys create immediate price impact:
- Large buy on target token raises its price
- Burn reduces circulating supply (further price increase over time)
- Creates arbitrage opportunity across the conversion vault if Carnage skews one token

**Driver 3: Persistent Soft-Peg Arbitrage**

Any price divergence between CRIME and FRAUD beyond the ~4-10% friction zone creates a risk-free profit opportunity. Bots monitor the two SOL pools and execute the arb loop through the conversion vault as described above.

### Volume Sustainability Under Declining Interest

The system degrades gracefully:

| Volume Level      | Tax Revenue | Staking APY | Carnage Frequency |
|------------------|-------------|-------------|-------------------|
| High (10K SOL/day)| 750 SOL/day | High        | ~2/day, large buys |
| Medium (1K SOL/day)| 75 SOL/day | Moderate   | ~2/day, smaller buys |
| Low (100 SOL/day) | 7.5 SOL/day | Low        | ~2/day, very small buys |
| Minimal (arb-only)| Variable   | Minimal    | ~2/day, dust buys |

At the minimum, the three mechanical drivers create a volume floor:
- Each regime flip moves ~2-5% of held token value
- Each Carnage event moves the entire Carnage vault balance
- Each peg deviation beyond friction creates arb volume

The protocol never "breaks" at low volume -- it simply pays lower rewards. There are no liquidations, no debt, no obligations that create death spirals.


## Fee Structure (LP fees vs taxes)

### Fee Comparison

| Fee Type     | SOL Pools | Conversion Vault | Recipient           |
|-------------|-----------|-----------------|---------------------|
| Protocol Tax | 1-14% (dynamic) | 0%        | Staking/Carnage/Bounty |
| LP Fee       | 100 bps (1%) | 0%           | Pool reserves (compounds) |

### LP Fee Mechanics

LP fees are deducted **before** the constant-product output calculation. The fee tokens stay in the pool reserves, permanently deepening liquidity:

```rust
// From /programs/amm/src/helpers/math.rs
pub fn calculate_effective_input(amount_in: u64, fee_bps: u16) -> Option<u128> {
    let amount = amount_in as u128;
    let fee_factor = 10_000u128.checked_sub(fee_bps as u128)?;
    amount.checked_mul(fee_factor)?.checked_div(10_000)
}
```

There are **no LP tokens** and **no withdrawal mechanism**. Liquidity is protocol-owned and permanent. LP fees compound into reserves monotonically -- pools only ever get deeper.

Source: Pool seeding is permanent per AMM design decision D4 ("LP fees compound into reserves permanently"). The conversion vault has no LP fee mechanism -- its 100:1 rate is fixed and deterministic.

### Why LP Fee Cap Exists

`MAX_LP_FEE_BPS = 500` (5%) prevents misconfiguration during pool initialization. Once set at init, the fee is immutable for the life of the pool.

Source: `/programs/amm/src/constants.rs`, line 25.


## Edge Cases & Degradation

### Micro-Tax Edge Case

When `total_tax < 4 lamports` (e.g., a swap of 10 lamports at 1% tax = 0 lamports), the entire tax goes to staking. This avoids splitting sub-lamport dust across three destinations:

```rust
// From /programs/tax-program/src/helpers/tax_math.rs, line 82
if total_tax < 4 {
    return Some((total_tax, 0, 0));
}
```

### Zero-Output Sells

If tax would consume the entire sell output (`net_output = 0`), the transaction is rejected with `TaxError::InsufficientOutput`. This prevents users from accidentally burning tokens for zero return.

### Carnage with Zero SOL

If the Carnage SOL vault has zero available balance (after rent-exempt minimum), Carnage buys zero tokens. The trigger still fires (clearing the pending flag), but no market impact occurs.

### Asymmetric Carnage Burns

Over time, Carnage may burn significantly more of one token than the other. The constant-product formula self-corrects:
- If CRIME supply shrinks, its price in the AMM rises
- Higher CRIME price makes FRAUD relatively cheaper
- Arbitrageurs buy cheap FRAUD -> convert via vault to PROFIT -> convert via vault to CRIME -> sell CRIME
- This creates volume (generating fees) and rebalances prices

### Pool Depletion (Extreme Scenario)

If 99%+ of one token is burned, the remaining supply would have extremely high price per unit. The AMM still functions -- it just quotes very small amounts of the scarce token for any given SOL input. Trades become impractical at extremely low supply but the protocol never halts.

### Staking with Zero Stakers

If `total_staked = 0`, rewards stay in `pending_rewards` and are not distributed. When a staker eventually arrives, the accumulated rewards are distributed. The `MINIMUM_STAKE` dead stake prevents this scenario in normal operation.

### VRF Oracle Failure

If the Switchboard oracle fails to reveal within `VRF_TIMEOUT_SLOTS = 300` (~2 minutes), the protocol allows retry with a fresh randomness account. Tax rates from the previous epoch remain in effect until the new epoch resolves. The protocol continues functioning with stale rates indefinitely -- no halt mechanism.


## Economic Invariants

These properties hold at all times and are enforced by on-chain program logic:

### Invariant 1: Tax Conservation
```
staking_portion + carnage_portion + treasury_portion == total_tax
```
Verified by `split_distribution()` which computes the treasury as the remainder after staking and carnage floor divisions. Tested with proptest across all u64 values.

Source: `/programs/tax-program/src/helpers/tax_math.rs`, line 99.

### Invariant 2: Tax Distribution Ratio
```
staking_portion >= floor(total_tax * 71 / 100)
carnage_portion >= floor(total_tax * 24 / 100)
treasury_portion = total_tax - staking - carnage (absorbs rounding dust)
```

Constants: `STAKING_BPS = 7,100`, `CARNAGE_BPS = 2,400`, `TREASURY_BPS = 500`.

Source: `/programs/tax-program/src/constants.rs`, lines 18-25.

### Invariant 3: k-Invariant (AMM Safety)
```
k_after >= k_before (where k = reserve_in * reserve_out)
```
Every swap increases or maintains k. LP fee tokens stay in reserves, so k strictly increases on every non-zero swap. Verified with proptest across 10,000 random iterations.

Source: `/programs/amm/src/helpers/math.rs`, lines 92-103.

### Invariant 4: Staking Cumulative Monotonicity
```
rewards_per_token_stored can only increase (never decrease)
```
add_to_cumulative only ever adds to this value. If it could decrease, users who staked between two distributions would compute negative reward deltas (underflow). Verified with proptest Property 4.

Source: `/programs/staking/src/helpers/math.rs`, lines 114-116.

### Invariant 5: Reward Conservation
```
For any user: user_reward <= total_deposited_rewards
```
Integer division truncation ensures the protocol keeps dust. No single user can extract more than was deposited. Verified with proptest Property 2.

### Invariant 6: Pool Liquidity Monotonicity
```
Pool reserves can only increase (no withdrawal mechanism exists)
```
No LP tokens are minted. No `remove_liquidity` instruction exists. LP fees compound into reserves. The only reserve decrease is via swap outputs -- but those are bounded by the constant-product formula.

### Invariant 7: Supply Can Only Decrease
```
CRIME_supply(t+1) <= CRIME_supply(t)
FRAUD_supply(t+1) <= FRAUD_supply(t)
PROFIT_supply is constant (no burn mechanism for PROFIT)
```
Mint authority is burned. Carnage burns permanently reduce supply. No mechanism exists to increase supply.

### Invariant 8: Tax-Free Swaps Are Carnage-Exclusive
```
swap_exempt requires carnage_signer PDA (derived from Epoch Program)
```
No other caller can bypass taxes. LP fees still apply even to Carnage swaps.

Source: `/programs/tax-program/src/instructions/swap_exempt.rs` -- `carnage_authority` must be `carnage_signer` PDA derived from `[CARNAGE_SIGNER_SEED]` under Epoch Program ID.

### Invariant 9: Protocol Output Floor
```
User's minimum_output >= 50% of constant-product expected output
```
`MINIMUM_OUTPUT_FLOOR_BPS = 5000` (50%) is enforced on all user-facing AMM swaps (buy, sell). The conversion vault has no slippage by design (fixed 100:1 rate), so no output floor is needed for vault conversions. This prevents sandwich attacks where bots set slippage to zero.

Source: `/programs/tax-program/src/constants.rs`, line 40.

---

## Bonding Curve Economics (Launch Phase)

### Overview

Before pool seeding, tokens are distributed via a dual linear bonding curve launch system (v1.2, 7th program). Each curve sells 460M tokens (46% of supply per token) along a linear price path, raising 500 SOL per token (1,000 SOL total across both curves).

### Pricing Formula

Linear curve `P(x) = P_START + (P_END - P_START) * x / TOTAL_FOR_SALE` where:
- `P_START = 450` (0.00000045 SOL/token, scaled as lamports per million tokens)
- `P_END = 1,725` (0.000001725 SOL/token)
- `TOTAL_FOR_SALE = 460,000,000,000,000` (460M with 6 decimals)

Source: `/programs/bonding_curve/src/constants.rs`

The end price is constrained by pool seeding: 500 SOL / 290M tokens = 0.000001725 SOL/token. This eliminates arbitrage at transition.

### Sell Tax & Escrow

When users sell tokens back to the curve, a 15% tax is deducted from the SOL output (not from tokens):

```
SOL_gross = reverse_integral(tokens_sold, tokens_to_sell)
tax = SOL_gross * 15 / 100  (integer division, truncation favors user)
SOL_net = SOL_gross - tax
```

Tax is routed to a per-curve `tax_escrow` PDA (0-byte SOL-only account). On graduation, escrow SOL flows to the Carnage fund via `distribute_tax_escrow`. On failure, escrow is consolidated into the SOL vault via `consolidate_for_refund` and becomes part of the proportional refund pool.

Source: `/programs/bonding_curve/src/constants.rs` -- `SELL_TAX_BPS = 1_500`, `BPS_DENOMINATOR = 10_000`

### SOL Distribution at Graduation

Upon successful dual-curve completion (both curves reach Filled status), the 1,000 SOL raised plus the tax escrow SOL are distributed:

| Destination | Amount | Source |
|-------------|--------|--------|
| CRIME/SOL Pool | 500 SOL | CRIME curve sol_vault |
| FRAUD/SOL Pool | 500 SOL | FRAUD curve sol_vault |
| Carnage Fund | Variable (15% of all sell proceeds) | Both tax escrow PDAs |

### PROFIT Rewards Source: Bonding Curve Tax Escrow

The bonding curve tax escrow adds a one-time SOL injection into the Carnage fund at graduation. This increases the Carnage fund balance for the first epoch cycle post-launch, providing an early boost to Carnage buyback activity. After graduation, this is a one-time event -- ongoing rewards come from the 71/24/5 tax split on AMM swaps.

---

<!-- NEEDS_VERIFICATION: Mainnet crank bounty of 0.001 SOL (TRIGGER_BOUNTY_LAMPORTS = 1,000,000) needs validation against actual mainnet priority fees. If priority fees exceed the bounty, crank operators would lose money per epoch transition, breaking the permissionless crank incentive. See operations decision D3. -->
