---
doc_id: futarchy-pool-spec
title: "Dr. Fraudsworth's Finance Factory -- Four-Pool Futarchy Rebalancing Spec"
wave: 5
requires: [architecture, token-economics-model, liquidity-slippage-analysis, security-model]
provides: [futarchy-pool-spec]
status: draft
decisions_referenced: [amm-design, token-model, security]
needs_verification: [lmsr-parameter-tuning, prediction-market-fee-rate, minimum-participation-threshold, settlement-twap-window, accuracy-tier-thresholds, accuracy-rolling-window-length]
---

# Four-Pool Futarchy Rebalancing Spec

## Overview

This document specifies a post-launch expansion to Dr. Fraudsworth's Finance Factory that introduces four simultaneously active AMM pools (two SOL-denominated, two USDC-denominated) with a weekly futarchy-style prediction market that determines the liquidity allocation ratio between SOL and USDC pools.

The prediction market allows any SOL holder -- not just token holders -- to bet on SOL/USD price direction using a continuous sliding scale (0-100% SOL allocation). The market-clearing ratio physically rebalances protocol liquidity across the four pools. Participants who predict correctly profit from those who predict incorrectly. The protocol takes a fee on every prediction market trade, creating an additional revenue stream for Carnage and staking rewards.

**Core thesis**: Pool growth from collective intelligence, not new inflows. Protocol revenue from outside prediction traders, not token holders. This extends the existing anti-ponzi thesis (yield from trading friction) with two additional non-ponzi value sources.

**Why this is novel**: No existing DeFi protocol combines a physically-settled prediction market with real-time protocol capital allocation. Polymarket does binary prediction markets. DAOs do governance votes. This mechanism uses a continuous sliding-scale prediction market whose resolution directly controls the protocol's liquidity allocation across four live pools.

---

## Architecture

### Pool Matrix (Expanded)

| Pool | Token A | Token B | LP Fee | Token Program A | Token Program B | Status at Launch |
|------|---------|---------|--------|-----------------|-----------------|------------------|
| CRIME/SOL | WSOL | CRIME | 100 bps | SPL Token | Token-2022 | Active (existing) |
| FRAUD/SOL | WSOL | FRAUD | 100 bps | SPL Token | Token-2022 | Active (existing) |
| CRIME/USDC | USDC | CRIME | 100 bps | SPL Token | Token-2022 | Active (new) |
| FRAUD/USDC | USDC | FRAUD | 100 bps | SPL Token | Token-2022 | Active (new) |

All four pools are permanently active and whitelisted in the transfer hook. Users can trade through any pool at any time. The futarchy mechanism determines the liquidity allocation ratio between SOL and USDC pools, not which pools are available.

### Tax Parity Requirement

**Critical**: CRIME/SOL and CRIME/USDC must have identical tax rates at all times. Same for FRAUD/SOL and FRAUD/USDC. Tax rates are determined per token (CRIME or FRAUD), not per pool. The epoch program's tax regime flip applies uniformly to a token regardless of which quote asset it trades against.

If tax parity is broken, users permanently route through the lower-tax pool, defeating the rebalancing mechanism and creating a structural arbitrage that extracts value without contributing to the intended pool allocation.

### Protocol State: Denomination Allocation

A new PDA stores the current allocation ratio and active denomination state:

```
AllocationState {
    sol_allocation_bps: u16,      // 0-10000 (basis points, e.g. 7000 = 70% SOL)
    last_rebalance_slot: u64,     // Slot of most recent rebalancing execution
    last_settlement_slot: u64,    // Slot of most recent market settlement
    market_active: bool,          // Whether prediction market is currently open
    sol_price_at_open: u64,       // SOL/USD price (Pyth, 8 decimals) at market open
    sol_price_at_settle: u64,     // SOL/USD TWAP at settlement
}

Seeds: ["allocation"]
```

### New Programs Required

| Program | Purpose | Interaction with Core |
|---------|---------|----------------------|
| Prediction Market (LMSR) | Continuous sliding-scale market for SOL allocation betting | Standalone. Reads AllocationState. |
| Rebalancing Orchestrator | Executes liquidity moves between SOL and USDC pools post-resolution | Calls AMM pool operations. Swaps via Jupiter CPI or external TX. |
| Settlement Oracle Reader | Reads Pyth SOL/USD price feed for market open/settlement | Writes to AllocationState. |

None of these programs modify or CPI into the core protocol programs (Tax, Epoch, Staking, Transfer Hook, Carnage). They interact only with:
- AMM pools (via existing public swap/liquidity instructions)
- AllocationState PDA (new, owned by Rebalancing Orchestrator)
- Pyth price feed (external, read-only)

---

## Prediction Market Mechanism

### Market Type: LMSR (Logarithmic Market Scoring Rule)

The prediction market uses a Logarithmic Market Scoring Rule, the same mathematical foundation underlying Polymarket and other major prediction markets. LMSR provides:

- Always-available liquidity (no need for counterparties to match orders)
- Smooth price curves that resist manipulation
- Exponentially increasing cost to push prices to extremes
- Well-understood mathematical properties

### How It Works

The market offers positions on a continuous spectrum from 0% SOL (100% USDC) to 100% SOL (0% USDC). Each position represents a bet that the optimal allocation this week is at or near that point on the spectrum.

**Market participation**:

1. User deposits SOL into the prediction market program
2. User buys a position at a specific point on the spectrum (e.g., "70% SOL")
3. LMSR adjusts prices: positions near 70% SOL become more expensive, positions far from 70% become cheaper
4. Other users buy positions at their preferred points
5. The cost-weighted center of all positions becomes the market-clearing allocation ratio

**Price dynamics**:

The LMSR ensures that:
- Moving the market from 50/50 to 60/40 is cheap
- Moving from 80/20 to 90/10 is expensive
- Moving from 90/10 to 100/0 is astronomically expensive
- Extreme positions attract contrarian capital due to favorable odds

This makes manipulation economically irrational. An attacker trying to force 100/0 SOL must spend enormous capital, while anyone taking the other side gets incredible odds. The market self-corrects.

### LMSR Core Math

The cost function for buying shares at position `q` on the spectrum:

```
C(q) = b * ln(Σ exp(q_i / b))
```

Where:
- `q_i` = quantity of shares outstanding at each position on the spectrum
- `b` = liquidity parameter (controls price sensitivity; higher b = less price movement per trade)
- The cost to buy additional shares at any position = C(q_after) - C(q_before)

The liquidity parameter `b` requires tuning:
- Too low: small trades swing the market wildly, noisy signal
- Too high: large trades needed to move the market, low sensitivity
- Target: calibrate so that ~$10K-50K in total market volume produces meaningful but not volatile price movement

> **NEEDS_VERIFICATION**: Optimal `b` parameter depends on expected market volume. Requires simulation with realistic participation estimates before deployment.

### Discretized Spectrum

For implementation simplicity, the continuous 0-100% spectrum is discretized into buckets:

| Bucket | SOL Allocation | USDC Allocation |
|--------|---------------|-----------------|
| 0 | 0% | 100% |
| 10 | 10% | 90% |
| 20 | 20% | 80% |
| 30 | 30% | 70% |
| 40 | 40% | 60% |
| 50 | 50% | 50% |
| 60 | 60% | 40% |
| 70 | 70% | 30% |
| 80 | 80% | 20% |
| 90 | 90% | 10% |
| 100 | 100% | 0% |

11 buckets. The market-clearing allocation is the cost-weighted average of all positions, rounded to the nearest 10%. This avoids the complexity of truly continuous settlement while preserving meaningful granularity.

### Market-Clearing Calculation

At market close, the allocation ratio is determined by the cost-weighted center of mass:

```
allocation_sol_bps = Σ(position_i * total_cost_at_bucket_i) / Σ(total_cost_at_bucket_i)
```

Example:
```
Bucket 60%: $30K in positions
Bucket 70%: $50K in positions  
Bucket 80%: $20K in positions

Weighted average = (60*30 + 70*50 + 80*20) / (30+50+20)
                 = (1800 + 3500 + 1600) / 100
                 = 69%
                 → Rounds to 70% SOL allocation
```

---

## Settlement

### Settlement Metric

The settlement question is: **Did SOL/USD go up or down during the week, and by how much?**

This is deliberately simple. No pool depth measurement, no volume tracking, no complex on-chain metrics. One oracle feed (Pyth SOL/USD), two readings (market open, next Monday), one delta.

This makes settlement immune to:
- Token dumping/manipulation within the protocol
- Volume fluctuations
- LP fee compounding noise
- Carnage event timing
- Any internal protocol activity

The ONLY input is the external SOL/USD price, which is aggregated across dozens of exchanges by Pyth and economically impractical to manipulate.

### Optimal Allocation Calculation

At settlement, the "correct" answer is determined retroactively:

```
SOL price at market open:    $150.00
SOL price at settlement:     $165.00 (10% gain)

Optimal allocation:          100% SOL (SOL outperformed USDC)
```

```
SOL price at market open:    $150.00
SOL price at settlement:     $135.00 (10% loss)

Optimal allocation:          0% SOL (USDC outperformed SOL)
```

```
SOL price at market open:    $150.00
SOL price at settlement:     $150.75 (0.5% gain)

Optimal allocation:          100% SOL (SOL still outperformed, just barely)
```

The optimal allocation is always binary in hindsight (100% SOL if SOL went up, 0% SOL if SOL went down). But the PAYOUT is proportional to distance from optimal:

### Payout Formula

```
For each participant with position P (0-100 representing SOL %):

If SOL went UP (optimal = 100):
    payout_weight = P / 100
    (Someone at 90% SOL gets 90% of max payout)
    (Someone at 30% SOL gets 30% of max payout)

If SOL went DOWN (optimal = 0):
    payout_weight = (100 - P) / 100
    (Someone at 10% SOL gets 90% of max payout)
    (Someone at 70% SOL gets 30% of max payout)

Actual payout = (participant_stake * payout_weight) / Σ(all_stakes * all_payout_weights) * total_pool_after_fees
```

This means:
- You don't have to be exactly right to profit -- just more right than the average
- Extreme conviction pays more when correct
- Hedged positions (near 50/50) earn little regardless of outcome
- The protocol fee is deducted before payout distribution

### Worked Payout Example

**Setup**: $500K total prediction market volume for the week. SOL moves +8%.

```
Total market pool:                $500,000
Protocol fee (2% average*):       $10,000 → Staking/Carnage/Treasury
Remaining for payouts:            $490,000

* Average fee accounting for tiered reductions across participant pool.

Position distribution:
  90% SOL bucket:  $100K staked
  70% SOL bucket:  $200K staked
  50% SOL bucket:  $100K staked
  30% SOL bucket:   $50K staked
  10% SOL bucket:   $50K staked
```

SOL went UP → optimal = 100% SOL. Payout weights by bucket:

```
Bucket   Stake    Weight   Weighted Stake   Payout         Return
------   -----    ------   --------------   ------         ------
90%      $100K    0.90     $90K             $147,000       +47.0%
70%      $200K    0.70     $140K            $228,667       +14.3%
50%      $100K    0.50     $50K             $81,667        -18.3%
30%       $50K    0.30     $15K             $24,500        -51.0%
10%       $50K    0.10     $5K              $8,167         -83.7%
                           ------           --------
                Total:     $300K            $490,000
```

**Key observations**:

- The 90% bucket (high conviction, correct) returns 47% in one week
- The 70% bucket (moderate conviction, correct) returns 14.3%
- The 50% bucket (hedged/neutral) loses 18.3% -- sitting on the fence is punished
- The 30% and 10% buckets (wrong direction) lose heavily
- All $490K is distributed -- this is a zero-sum game between participants after fees

**Smaller SOL move example (+2%)**:

With a small price move, the payout distribution is the same proportionally, but the conviction premium is less dramatic because the market was genuinely uncertain. The key property holds: participants who were more correct than average profit, those less correct lose.

**Flat week example (SOL ±0.1%)**:

When SOL barely moves, the optimal allocation is only marginally better on one side. Payouts cluster near breakeven for most participants. The protocol still collects its 2% fee, but participant P&L is minimal. This correctly reflects that in a flat week, neither side had meaningful edge. The market essentially returns most capital with a small fee haircut.

### Why Payouts Are NOT Weighted by SOL Price Magnitude

The payout formula is purely proportional to position weight. A 100/0 SOL position pays out the same percentage return whether SOL moved 2% or 20%. There is no explicit magnitude multiplier, and this is intentional.

**Why magnitude weighting is unnecessary**:

The SOL price move magnitude already affects payouts naturally through two mechanisms:

1. **Market positioning reflects expected magnitude.** When the market expects a large SOL move, participants crowd into extreme positions (80/90/100). This means the losing side is thin — fewer losers, smaller total pool to redistribute. When the market expects a small move, positions cluster near center — more balanced redistribution. The LMSR pricing itself encodes magnitude expectations.

2. **The redistribution pool size scales with conviction asymmetry, not price magnitude.** In a 2% week where most participants were at 50-60%, the total redistribution between winners and losers is small — most people were close to each other. In a 20% week where participants were polarised between 80% SOL and 20% SOL, the redistribution is large — the wrong side loses heavily to the right side. This happens automatically from the position distribution without needing a multiplier.

**Adding explicit magnitude weighting would double-count**: participants already express magnitude conviction through their bucket choice (further from center = higher conviction of larger move). Multiplying payouts again by actual magnitude would create an outsized reward for extreme positions and punish moderate-but-correct positions unfairly.

**Worked comparison**:

```
Scenario A: SOL +2%, participant at 70% SOL bucket
Scenario B: SOL +20%, participant at 70% SOL bucket

In both cases, 70% SOL was correct direction.
Payout weight = 0.70 in both cases.
Actual dollar return depends on what other participants did,
not on the magnitude of SOL's move.

The participant's CHOICE to be at 70% (moderate conviction)
rather than 100% (extreme conviction) already reflects their
magnitude expectation. No additional weighting needed.
```

**Edge case — near-zero SOL movement (±0.05%)**:

When SOL barely moves, the "correct" side wins by a hair. The payout formula still redistributes from losers to winners, but since positions are likely clustered near center, the absolute P&L for most participants is small. The protocol still collects its fee. This correctly reflects that in a flat week, the prediction market was genuinely uncertain and nobody had meaningful edge. The market essentially returns most capital with a small fee haircut.

> **Design note**: If sustained near-zero weeks become common and participants feel the fee is unfair for what amounts to a coin flip, consider a "dead zone" — if SOL moves less than ±0.5%, all participants are refunded minus a reduced fee (e.g., 0.5% instead of 2%). This would need careful analysis to prevent gaming (deliberately pushing the market to 50/50 to trigger refunds). Currently not specified; revisit based on observed market behavior.

### Payout Comparison: Prediction Market vs. Perp Long/Short

| Factor | Dr. Fraudsworth Prediction Market | Perp DEX (e.g., Drift, Jupiter Perps) |
|--------|-----------------------------------|----------------------------------------|
| Maximum loss | Stake amount (defined at entry) | Entire margin (liquidation) |
| Liquidation risk | None | Yes, cascading |
| Funding rate | None | Continuous, can be significant |
| Leverage | None (conviction expressed via bucket, not leverage) | 1x-100x+ |
| Expression of view | Sliding scale 0-100% (precise conviction) | Binary long/short with variable size |
| Return on correct 8% SOL move | +14% to +47% depending on conviction | +8% to +800% depending on leverage |
| Secondary benefit | Improves protocol pool allocation (benefits PROFIT stakers) | None |
| Participation barrier | SOL only, any wallet | Collateral deposit, margin management |

**The prediction market does not compete with perps on raw returns.** Leveraged perps will always offer higher upside for directional bets. The prediction market competes on: (1) simplicity — no liquidation, no funding, no margin management; (2) the sliding-scale conviction mechanism that perps cannot replicate; and (3) the dual-benefit structure for PROFIT holders.

### Settlement Oracle: TWAP

To prevent snapshot manipulation, settlement uses a Time-Weighted Average Price (TWAP) rather than a single price reading:

```
Settlement TWAP window: Final 2-4 hours of the week
Readings: Pyth SOL/USD sampled every epoch (30 min)
Settlement price = average of all readings in the TWAP window
```

> **NEEDS_VERIFICATION**: Optimal TWAP window length. Longer = more manipulation-resistant but more latency in reflecting true end-of-week price. 2-4 hours is the working range.

The market open price can be a single Pyth reading at 00:00 UTC Monday since there's no incentive to manipulate the opening price (it equally affects all participants).

---

## Weekly Cycle

### Schedule

```
Monday 00:00 UTC     Previous week's settlement calculated (TWAP from Sunday)
                     Payouts distributed to previous week's participants
                     New prediction market opens
                     Rebalancing executes based on new market's starting state (carried from previous week's close)

Monday 23:59 UTC     Prediction market closes
                     Market-clearing allocation ratio determined
                     Rebalancing executes (swap delta between SOL and USDC pools)
                     Protocol operates at new allocation for the week

Tuesday-Sunday       Protocol runs normally across all four pools at the determined allocation
                     TWAP accumulation begins Sunday ~20:00 UTC for settlement
```

### Rebalancing Execution

Rebalancing only moves the delta between current and target allocation:

```
Example:
Current allocation: 60% SOL / 40% USDC
Market resolves: 75% SOL / 25% USDC
Total protocol quote-side liquidity: $200K

Target SOL pools: $150K (75%)
Target USDC pools: $50K (25%)
Current SOL pools: $120K (60%)
Current USDC pools: $80K (25%)

Delta: Move $30K from USDC pools to SOL pools
Action: Withdraw $30K USDC from USDC pools → Swap USDC→SOL on Jupiter → Deposit SOL into SOL pools
```

This is executed by the Rebalancing Orchestrator program/script via the multisig. The individual steps use existing AMM operations and external Jupiter swaps.

**Rebalancing is incremental, not catastrophic.** Most weeks the allocation shifts by 10-20%, meaning small, low-slippage moves. The protocol never goes fully offline during rebalancing -- all four pools remain active throughout.

### What Happens When the Market Says "Stay"

If the protocol is already at 70% SOL and the market resolves at 70% SOL again, nothing happens. No rebalancing, no slippage cost, no downtime. The market confirmed the status quo. Participants are still paid out based on whether SOL/USD moved in their predicted direction.

---

## Arbitrage Implications

### Expanded Arbitrage Axes

With four pools, the arbitrage surface expands from one dimension to six possible paths:

| Path | Trigger | Direction |
|------|---------|-----------|
| CRIME/SOL ↔ CRIME/USDC | SOL/USD price movement | Cross-denomination, same token |
| FRAUD/SOL ↔ FRAUD/USDC | SOL/USD price movement | Cross-denomination, same token |
| CRIME/SOL ↔ FRAUD/SOL | Epoch tax regime flip | Same denomination, cross-token (existing) |
| CRIME/USDC ↔ FRAUD/USDC | Epoch tax regime flip | Same denomination, cross-token (new) |
| CRIME/SOL ↔ FRAUD/USDC | Combined price + regime movement | Cross-denomination, cross-token |
| FRAUD/SOL ↔ CRIME/USDC | Combined price + regime movement | Cross-denomination, cross-token |

**Volume multiplication**: Every SOL/USD price movement now triggers arbitrage across the SOL/USDC pool pairs (paths 1-2). Every epoch flip triggers arbitrage across BOTH denomination pairs (paths 3-4). Carnage events trigger arbitrage across all paths. The cross-denomination, cross-token paths (5-6) activate when both SOL price movement and regime changes coincide.

This fundamentally multiplies the protocol's mechanical volume floor without requiring any new users. The same three existing volume drivers (regime flips, Carnage, soft-peg arb) now operate across a larger surface area.

### Arbitrage and Tax Parity

Because CRIME/SOL and CRIME/USDC have identical tax rates, cross-denomination arbitrage friction is:

```
Buy tax (cheap side): 1-4%
LP fee (source pool): 1%
External SOL↔USDC swap: ~0.1% (Jupiter)
LP fee (destination pool): 1%
Sell tax (cheap side): 1-4%

Total round-trip: ~4.1-10.1%
```

Cross-denomination arb is profitable whenever the SOL/USDC price discrepancy between the two CRIME pools (or two FRAUD pools) exceeds the round-trip friction. Given SOL/USD volatility, this will trigger frequently.

### Cross-Denomination Arbitrage: Worked Example

**Setup**: Protocol is rebalanced to 70% SOL / 30% USDC after Monday's prediction market.

```
CRIME/SOL pool:   700 SOL  + 203M CRIME    (SOL @ $150 = $105K quote side)
CRIME/USDC pool:  $45K USDC + 87M CRIME    ($45K quote side)

Implied CRIME price:
  SOL pool:   700 SOL / 203M CRIME = 0.00000345 SOL/CRIME = $0.000517/CRIME
  USDC pool:  $45,000 / 87M CRIME  = $0.000517/CRIME

Prices are in sync. No arb opportunity.
```

**Wednesday: SOL pumps 10% ($150 → $165)**

```
CRIME/SOL pool reserves haven't changed: still 700 SOL + 203M CRIME
  But 700 SOL is now worth $115,500 (was $105,000)
  Implied CRIME price: 700 SOL / 203M = 0.00000345 SOL = $0.000569/CRIME

CRIME/USDC pool reserves haven't changed: still $45K USDC + 87M CRIME
  Implied CRIME price: $45,000 / 87M = $0.000517/CRIME

Price discrepancy: $0.000569 vs $0.000517 = 10.1% difference
Round-trip arb friction: ~4.1-10.1%

Arb is profitable at the low end of friction (when both CRIME pools 
are on the cheap tax side after an epoch flip).
```

**Arbitrage execution**:

```
1. Buy CRIME from USDC pool (cheap at $0.000517)
   - Pay USDC, receive CRIME
   - Taxed at current CRIME rate (1-4% buy tax + 1% LP fee)

2. Sell CRIME into SOL pool (expensive at $0.000569)  
   - Pay CRIME, receive SOL
   - Taxed at current CRIME rate (1-4% sell tax + 1% LP fee)

3. Swap SOL → USDC on Jupiter (~0.1% fee)
   - Convert SOL proceeds back to USDC for next cycle

Profit = price discrepancy - total friction
       = 10.1% - ~4.1-10.1% (depending on current tax rates)
       = 0% to 6% per cycle
```

**Protocol revenue from this single arb**:

```
Buy tax:  1-4% of USDC input → Staking/Carnage/Treasury
LP fee:   1% of USDC input → USDC pool depth growth
Sell tax: 1-4% of SOL output → Staking/Carnage/Treasury  
LP fee:   1% of SOL output → SOL pool depth growth
```

Both pools deepen from LP fees. Tax revenue flows to stakers and Carnage. The arb corrects the price discrepancy, restoring equilibrium. Everyone benefits.

### How Rebalancing Amplifies Arbitrage Revenue

The prediction market's allocation directly controls how much cross-denomination arb revenue the protocol generates. This is the core economic link between correct rebalancing and protocol value.

**The mechanism**: When SOL pumps, the SOL-side CRIME price rises (in USD terms) while the USDC-side CRIME price stays flat. The arb opportunity is proportional to the SIZE of the SOL pool — a deeper SOL pool means a bigger USD-denominated price gap when SOL moves.

```
Scenario A: 50/50 allocation, SOL pumps 10%
  SOL pool: $75K worth of SOL → now $82.5K → 10% price gap on $75K base
  Arb opportunity size: moderate

Scenario B: 80/20 allocation, SOL pumps 10%  
  SOL pool: $120K worth of SOL → now $132K → 10% price gap on $120K base
  Arb opportunity size: 60% larger than Scenario A

Scenario C: 20/80 allocation, SOL pumps 10%
  SOL pool: $30K worth of SOL → now $33K → 10% price gap on $30K base
  Arb opportunity size: 60% smaller than Scenario A
```

**If the prediction market correctly anticipated SOL pumping** and allocated 80/20 SOL, the protocol earns maximum arb revenue from the move. If it incorrectly allocated 20/80, the arb opportunity is smaller. The collective intelligence directly translates into tax revenue via the arb surface area it creates.

**Conversely, when SOL dumps**: the USDC pools are the "stable" side. A deeper USDC allocation means the protocol's USDC-side pricing stays firm while the SOL-side drops, creating arb in the other direction. Correct prediction of a dump (heavy USDC allocation) maximizes the arb opportunity on the way down too.

**This is why the prediction market is not just a betting game** — it's an economic steering mechanism. Correct collective predictions don't just pay out the winners. They physically position the protocol to extract maximum revenue from whatever price movement occurs. The rebalancing IS the alpha.

---

## Emergent Mean-Reversion Engine

### How Tax Friction Creates Automatic Profit-Taking AND Dip-Buying

A critical emergent property arises from the interaction between cross-denomination arb and the protocol's tax structure. The mechanism is symmetrical — it automatically takes profit when SOL pumps hard AND buys the dip when SOL dumps hard.

**When SOL pumps significantly (10-20%+):**

CRIME becomes more expensive in the SOL pool than in the USDC pool (because SOL appreciated, making the SOL-side CRIME price higher in USD terms). Arb bots buy CRIME cheap from the USDC pool and sell expensive into the SOL pool.

```
Arb flow: USDC into USDC pool → CRIME out → CRIME into SOL pool → SOL out

Net effect on protocol:
  SOL pool gets SHALLOWER in SOL (SOL exits)
  USDC pool gets DEEPER in USDC (USDC enters)
  
Equivalent to: Selling SOL into strength. Automatic profit-taking.
```

**When SOL dumps significantly (10-20%+):**

CRIME becomes cheaper in the SOL pool than in the USDC pool (because SOL depreciated, making the SOL-side CRIME price lower in USD terms). Arb bots buy CRIME cheap from the SOL pool and sell expensive into the USDC pool.

```
Arb flow: SOL into SOL pool → CRIME out → CRIME into USDC pool → USDC out

Net effect on protocol:
  SOL pool gets DEEPER in SOL (SOL enters at discounted prices)
  USDC pool gets SHALLOWER in USDC (USDC exits)

Equivalent to: Buying SOL at the bottom. Automatic dip-buying.
```

**The full symmetry:**

```
SOL pumps hard → Arb sells SOL out of SOL pool → Takes profit at the top
SOL dumps hard → Arb buys SOL into SOL pool    → Buys the dip at the bottom

Both filtered by tax friction:
  Small moves (2-3%):   No arb fires. Protocol rides the move normally.
  Medium moves (5-8%):  Minimal arb. Protocol mostly rides the move.
  Large moves (10-20%+): Arb fires. Protocol mean-reverts automatically.
```

The protocol is running an automated mean-reversion strategy where the arb bots are the execution layer and the tax friction is the entry threshold. Neither function was designed — both emerge from four pools with identical tax rates and rational arbitrageurs.

### Tax Friction as Volatility Filter

Crucially, this mean-reversion only fires when the SOL/USD move is large enough to overcome the cross-denomination arb friction (both pools are subject to the same tax rates, so arb must pay at minimum one high-side tax). The spread needs to be roughly 8-10%+ before arb is profitable.

Large moves — both pumps and dumps — are statistically more likely to retrace than small moves. The tax friction therefore biases the mean-reversion toward exactly the moves where it is most prudent:

- Taking profit on spikes that are likely to retrace
- Buying dips on dumps that are likely to bounce

The protocol has an accidental momentum mean-reversion strategy built into its arb mechanics, and the tax friction calibrates its sensitivity.

### Full Cycle: Pump Profit-Taking + Futarchy Reallocation

```
Monday: Futarchy sets 70/30 SOL
  SOL pools: $140K in SOL
  USDC pools: $60K in USDC
  Total: $200K

Wednesday: SOL pumps 20%
  SOL pools: $168K (appreciated)
  USDC pools: $60K (unchanged)
  Total: $228K
  
  Spread exceeds tax friction. Cross-denomination arb fires.
  ~$8K worth of SOL exits SOL pool → USDC enters USDC pool
  
  Post-arb:
  SOL pools: ~$160K
  USDC pools: ~$68K
  Total: ~$227K (minus arb profit extracted, ~$1K)

Friday: SOL retraces 10%
  SOL pools: $160K × 0.90 = $144K
  USDC pools: $68K (unaffected)
  Total: $212K

  Without arb profit-taking:
  SOL pools: $168K × 0.90 = $151.2K
  USDC pools: $60K
  Total: $211.2K

  Profit-taking preserved: +$800

Next Monday: Futarchy decides what to do with the profits
  Option A (expect more downside): Keep heavier USDC → protect gains
  Option B (expect recovery): Move USDC back into SOL at lower price
           → Protocol just bought the dip with its own arb profits
```

### Full Cycle: Dump Dip-Buying + Futarchy Reallocation

```
Monday: Futarchy sets 70/30 SOL
  SOL pools: $140K in SOL
  USDC pools: $60K in USDC
  Total: $200K

Wednesday: SOL dumps 20%
  SOL pools: $112K (depreciated)
  USDC pools: $60K (unchanged)
  Total: $172K

  Spread exceeds tax friction. Cross-denomination arb fires.
  ~$6K worth of USDC exits USDC pool → SOL enters SOL pool (at low prices)

  Post-arb:
  SOL pools: ~$118K (deeper in SOL terms — more SOL at cheaper price)
  USDC pools: ~$53K
  Total: ~$171K (minus arb profit extracted, ~$1K)

Friday: SOL bounces 10%
  SOL pools: $118K × 1.10 = $129.8K
  USDC pools: $53K (unaffected)
  Total: $182.8K

  Without arb dip-buying:
  SOL pools: $112K × 1.10 = $123.2K
  USDC pools: $60K
  Total: $183.2K

  Dip-buying captured bounce: nearly equivalent total,
  but SOL pool is deeper in SOL terms — more upside exposure
  if the recovery continues.

Next Monday: Futarchy decides strategic allocation
  Option A (expect recovery): Keep heavy SOL → ride the bounce with deeper SOL pool
  Option B (expect further dump): Rebalance toward USDC → lock in the bounce gains
```

**Critical observation on the dip-buying cycle**: The protocol enters Monday with a deeper SOL pool (in SOL terms) than it would have had without arb. If the futarchy correctly predicts recovery and keeps heavy SOL, the protocol has MORE SOL exposure at a lower cost basis. The arb bought the dip, and the futarchy holds the position. If the futarchy predicts more downside, the rebalancing sells the bounced SOL into USDC, effectively completing a buy-low-sell-higher round-trip using arb profits.

### The Two-Layer Alpha Stack

```
Intra-week (automatic, emergent, zero human input):
  Arb takes profit on pumps (sells SOL high)
  Arb buys dips on dumps (buys SOL low)
  Tax friction filters noise — only acts on large, mean-revertible moves
  Protocol mean-reverts toward USD-neutral automatically

Weekly (collective intelligence, human-guided):
  Futarchy decides strategic direction for next week
  Rebalancing positions for anticipated macro trend
  Working from a portfolio that has already been mean-reverted by arb

The two layers operate on different timeframes and different signals.
Neither requires the other, but they compound:
  Arb smooths intra-week volatility → Futarchy allocates from a stable base
  Futarchy positions correctly → Arb has deeper pools to work with
```

### Quantitative Impact Over Time

The mean-reversion effect is small per event (~0.3-0.5% of pool value per qualifying move) but compounds across every large SOL move in both directions. In a typical year with ~20-30 weekly moves exceeding the tax friction threshold (including both pumps and dumps), this generates approximately 2-5% additional USD pool value preservation on top of the futarchy allocation benefit.

---

## Emergent Behaviours

The four-pool futarchy architecture produces several emergent properties that are not explicitly designed but arise naturally from the interaction of pools, tax friction, arb incentives, and weekly rebalancing.

### Emergence 1: Volatility-Proportional Revenue Scaling

When SOL is volatile, cross-denomination arb fires more frequently and on bigger spreads. Every arb execution pays taxes. Therefore protocol revenue naturally scales with market volatility.

```
Low volatility week (SOL ±1-2%):
  Cross-denomination arb: minimal (below friction threshold)
  Revenue: primarily from epoch-flip arb and organic trading

High volatility week (SOL ±10-20%):
  Cross-denomination arb: frequent, large spreads
  Revenue: significantly elevated from arb volume alone
```

This means the protocol's yield peaks when the market is most volatile — which is exactly when traders are most active, most engaged, and most willing to pay for yield. The protocol earns most when its participants value it most.

### Emergence 2: Self-Dampening Allocation Drift

When the futarchy gets direction wrong, the allocation self-corrects before Monday through natural price movement.

```
Monday allocation: 80/20 SOL ($160K SOL / $40K USDC)

SOL dumps 15%:
  SOL pools: $136K / USDC pools: $40K
  Effective allocation: 77/23 (drifted toward safety)

SOL dumps another 15%:
  SOL pools: $115.6K / USDC pools: $40K
  Effective allocation: 74/26 (further self-correction)
```

The worse the wrong call, the faster the allocation drifts toward the safer position. This is the same principle as portfolio drift in traditional finance, but here it's a protective feature — it limits the damage of incorrect futarchy calls before the next Monday correction.

The inverse holds too: a correct 80/20 SOL call during a pump causes the effective allocation to drift even more heavily into SOL as the SOL pools appreciate, amplifying the correct position.

### Emergence 3: Tax-Friction-Gated Information Flow (Pressure and Release)

The epoch tax regime creates alternating windows of tight and loose coupling between cross-denomination pools.

```
Low-tax epoch (CRIME at 1-4%):
  Cross-denomination arb friction: ~4-6%
  Small spreads are profitable
  Prices stay tightly coupled across SOL/USDC pools
  → "Release" phase: accumulated spread gets arbitraged away

High-tax epoch (CRIME at 8-15%):
  Cross-denomination arb friction: ~18-30%
  Only massive spreads are profitable
  Prices can diverge significantly between SOL/USDC pools
  → "Pressure" phase: unrealised arb profit accumulates
```

The epoch flips (every ~30 min, 75% flip chance) create a "pressure and release" cycle. During high-tax epochs, cross-denomination spreads accumulate. When tax flips to the low side, arb bots rush in to close the accumulated spread, generating a concentrated burst of volume and tax revenue.

In-house arb bots would exploit this by monitoring epoch transitions and executing immediately when the low-tax window opens on an accumulated spread. This concentrates arb profits into predictable, high-frequency windows.

### Emergence 4: Natural USDC Yield Generation

USDC sitting in the USDC pools is not dead money. It earns LP fees from every trade against the USDC pools. Unlike SOL (which has staking opportunity cost), USDC earning LP fees in an active AMM is competitive with or better than most USDC yield sources in DeFi.

This means the futarchy's USDC allocation during bear markets or uncertain weeks is not just capital preservation — it is actively yield-generating capital preservation. The USDC pools quietly compound from trading fees regardless of SOL price action.

### Emergence 5: Carnage Cascade Amplification

When Carnage fires and buys CRIME from a SOL pool, it creates a price impact in that pool. With four pools, that single price impact opens arb opportunities across multiple paths simultaneously:

```
Carnage buys CRIME from CRIME/SOL pool
  → CRIME price rises in CRIME/SOL
    → Arb: CRIME/SOL vs CRIME/USDC (cross-denomination)
    → Arb: CRIME/SOL vs FRAUD/SOL (existing soft-peg)
    → Arb: CRIME/USDC vs FRAUD/USDC (cross-token, USDC side)
    → Arb: CRIME/SOL vs FRAUD/USDC (cross-denomination + cross-token)
```

One Carnage event triggers a cascade of arb corrections across up to four paths instead of the original one. Each correction pays taxes. The four-pool architecture multiplies Carnage's revenue impact without changing anything about the Carnage program itself.

### Emergence 6: Prediction Market as Decentralised Sentiment Oracle

The weekly allocation ratio is a publicly readable on-chain value (stored in AllocationState PDA). It is effectively a financially-backed SOL/USD sentiment index — representing the cost-weighted conviction of all prediction market participants.

This signal has properties that social media sentiment, polls, and analyst forecasts do not:

- Every opinion is backed by real capital at risk
- Accuracy is retroactively measurable and the track record is public
- It updates weekly on a predictable schedule
- It is manipulation-resistant via LMSR cost scaling

External protocols, analytics platforms, traders, and media could read this allocation ratio as a high-quality sentiment indicator. The protocol becomes a public good — a decentralised sentiment oracle — creating external value and attention beyond its own ecosystem. This is not a feature to be built; it exists automatically as a side effect of publishing the AllocationState PDA.

---

## Revenue Model

### Revenue Sources (Post-Expansion)

| Source | Mechanism | New/Existing |
|--------|-----------|-------------|
| CRIME/SOL pool taxes | Tax on buy/sell swaps | Existing |
| FRAUD/SOL pool taxes | Tax on buy/sell swaps | Existing |
| CRIME/USDC pool taxes | Tax on buy/sell swaps | New |
| FRAUD/USDC pool taxes | Tax on buy/sell swaps | New |
| Cross-denomination arb volume | Taxed through pools, triggered by SOL/USD movement | New |
| Cross-token arb (SOL-denominated) | Taxed through pools, triggered by epoch flips | Existing |
| Cross-token arb (USDC-denominated) | Taxed through pools, triggered by epoch flips | New |
| Carnage-triggered arb | Taxed through pools, now across 4 pools instead of 2 | Expanded |
| Prediction market fees | Protocol fee on every prediction market trade | New |

### Prediction Market Fee Structure

#### Base Fee

```
Default prediction market fee: 2.0% of position value at entry
```

#### Accuracy-Tiered Fee Reductions

Wallets with a history of accurate predictions receive tiered fee reductions. Accuracy is tracked on-chain via a per-wallet reputation PDA that updates at every settlement.

```
PredictorReputation {
    wallet: Pubkey,
    total_participations: u32,      // Total weeks participated
    accuracy_score: u64,            // Cumulative weighted accuracy (scaled 1e9)
    current_tier: u8,               // 0-3 (Standard, Silver, Gold, Diamond)
    last_updated_week: u32,         // Settlement week number
}

Seeds: ["predictor", wallet]
```

**Accuracy calculation**: Each week, the wallet's position distance from optimal is measured. A position at 90% SOL when optimal was 100% SOL scores 0.90. A position at 30% SOL when optimal was 0% SOL scores 0.70. The rolling accuracy score is the weighted average over the trailing N weeks (recent weeks weighted more heavily).

| Tier | Accuracy Threshold | Fee Rate | Reduction |
|------|-------------------|----------|-----------|
| Standard | < 60th percentile | 2.0% | None |
| Silver | 60th-89th percentile | 1.5% | 25% |
| Gold | 90th-98th percentile | 1.0% | 50% |
| Diamond | 99th+ percentile | 0.5% | 75% |

**Critical design constraints**:

- Tiers are relative (percentile-based), not absolute. Thresholds adjust as the population changes. No permanent discount inflation.
- Fee never reaches zero. The protocol always earns from every participant.
- Tier recalculation happens at settlement, not during market trading. No mid-week tier gaming.
- Minimum participation count before tier eligibility (e.g., 4 weeks). Prevents one lucky week from granting Diamond tier.
- Rolling window (e.g., 12-26 weeks). Historical accuracy decays over time. A wallet must maintain performance to keep its tier.

> **NEEDS_VERIFICATION**: Accuracy tier percentile thresholds and rolling window length. Requires simulation with realistic participation distributions to calibrate. Thresholds must ensure Diamond tier is genuinely elite (top 1%) and Silver is achievable but meaningful (top 40%).

**Game theory**: The wallets most valuable to the protocol (best predictors = most accurate rebalancing signal) receive the strongest incentive to continue participating. Their continued participation improves rebalancing accuracy, which grows pool depth, which benefits all holders. Fee reductions for top predictors are not a cost — they are an investment in signal quality.

#### Fee Distribution

```
All prediction market fees (after tier reductions) split:
  71% → Staking rewards
  24% → Carnage fund
   5% → Treasury
```

This follows the existing tax distribution ratios, maintaining a single unified revenue model across all protocol fee sources.

### Revenue Flow Diagram

```
                    ┌─────────────────────┐
                    │   OUTSIDE CAPITAL    │
                    │ (SOL/USD predictors) │
                    └─────────┬───────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │  PREDICTION MARKET   │───── 2% fee ──→ Staking/Carnage/Treasury
                    │  (Weekly LMSR)       │
                    └─────────┬───────────┘
                              │ Market-clearing ratio
                              ▼
                    ┌─────────────────────┐
                    │    REBALANCING       │───── Jupiter swap fees (external)
                    │    ORCHESTRATOR      │
                    └─────────┬───────────┘
                              │ Liquidity redistribution
                              ▼
          ┌───────────────────┼───────────────────┐
          │                   │                   │
    ┌─────┴─────┐      ┌─────┴─────┐      ┌─────┴─────┐
    │ SOL POOLS │      │USDC POOLS │      │ CROSS-DENOM│
    │ (CRIME +  │      │ (CRIME +  │      │ ARBITRAGE  │
    │  FRAUD)   │      │  FRAUD)   │      │  VOLUME    │
    └─────┬─────┘      └─────┬─────┘      └─────┬─────┘
          │                   │                   │
          └───────────┬───────┘───────────────────┘
                      │ All taxed at existing rates
                      ▼
            ┌─────────────────────┐
            │  TAX DISTRIBUTION   │
            │  71% Staking        │
            │  24% Carnage        │
            │   5% Treasury       │
            └─────────────────────┘
```

---

## Risk Analysis

### Risk 1: Sophisticated Traders Dominate the Market

**Assessment: Not a risk. This is the desired outcome.**

If sophisticated traders consistently win the prediction market, the rebalancing signal is higher quality. The protocol's pools are optimally positioned. All holders benefit from smart money accuracy whether they participated or not. The prediction market fees decrease with lower casual participation, but this is a minor revenue stream compared to pool depth growth from correct rebalancing.

### Risk 2: Bad Actor Attempts Manipulation

**Scenario**: Attacker places massive bet on 100/0 SOL when market fundamentals suggest otherwise.

**LMSR defense**: Positions become exponentially more expensive at extremes. The attacker must spend enormous capital to push the market. Meanwhile, contrarian positions become very cheap, attracting rational actors who take the other side. The market self-corrects.

**Outcome if attack succeeds**: Protocol rebalances to an extreme allocation for one week. If the attacker is wrong, they lose their stake to those who bet against them. The protocol has one suboptimal week and rebalances the following Monday. No structural damage.

**Outcome if attack fails** (most likely): Attacker loses their capital to contrarian traders. Market returns to rational pricing. Protocol allocation is unaffected.

**Cost-benefit for attacker**: Enormous capital at risk for one week of suboptimal protocol allocation. Not economically rational.

### Risk 3: Oracle Manipulation at Settlement

**Attack vector**: Manipulate Pyth SOL/USD price feed at the exact settlement moment to skew payouts.

**Mitigation**: Settlement uses TWAP over the final 2-4 hours of the week, not a single snapshot. Pyth aggregates across dozens of exchanges. Sustaining price manipulation across hours on major exchanges is economically impractical. This attack vector is effectively closed.

### Risk 4: Low Participation / Noisy Signal

**Scenario**: Very few participants in a given week, producing a low-confidence allocation ratio.

**Mitigation**: Minimum participation threshold. If total prediction market volume falls below X SOL, the protocol retains its current allocation. No rebalancing on garbage signal.

```
if total_market_volume < MINIMUM_PARTICIPATION_THRESHOLD:
    skip rebalancing
    refund all participants (minus protocol fee)
```

> **NEEDS_VERIFICATION**: Minimum participation threshold value. Must be high enough to ensure signal quality, low enough to not prevent the mechanism from functioning during quiet periods.

### Risk 5: Smart Contract Risk

**Severity: Highest actual risk.**

The prediction market program holds potentially significant SOL from outside participants. A bug means real losses for people who aren't even protocol users. This is the biggest reputational risk.

**Mitigations**:
- Prediction market program is fully separable from core protocol. A bug cannot affect the AMM, staking, or Carnage programs.
- Prediction market should undergo independent security audit before launch.
- Consider starting with capped maximum market size and increasing over time.
- All prediction market funds held in PDA-controlled vaults, not admin-controlled.

### Risk 6: Rebalancing Slippage

**Scenario**: Large allocation swing (e.g., 30% to 80% SOL) requires substantial external swap on Jupiter.

**Assessment**: Even at protocol maturity, the rebalancing delta is small relative to SOL/USDC liquidity on Jupiter. A $500K protocol with a 50% swing = $250K swap. A $5M protocol with a 30% swing = $1.5M swap. Jupiter handles billions daily. Slippage is negligible in all realistic scenarios.

---

## Game Theory & Incentive Alignment

### Participant Classes

The prediction market serves three distinct participant types with different incentive structures:

| Participant | Primary Incentive | Secondary Incentive | Participation Driver |
|-------------|-------------------|---------------------|----------------------|
| PROFIT holders | Pool depth growth (staking yield) | Prediction market payout | Will participate even at thin prediction margins because correct rebalancing grows their staking yield |
| Outside SOL speculators | Prediction market payout | None | Attracted by market liquidity created by PROFIT holders |
| Sophisticated/quantitative traders | Prediction market payout (fee-reduced) | Accuracy tier maintenance | Highest signal quality; tiered fees incentivise retention |

### The Bootstrap Flywheel

The prediction market bootstraps from the inside out:

```
1. PROFIT holders participate in prediction market
   (dual incentive: payout + pool depth growth from correct rebalancing)

2. Their participation creates baseline market liquidity
   (even at thin prediction margins, the pool depth benefit justifies entry)

3. Liquidity attracts outside SOL speculators seeking favorable odds
   (no need to hold CRIME/FRAUD/PROFIT -- just bet on SOL/USD direction)

4. Outside speculators add volume and pay fees
   (fees flow to staking/Carnage/treasury -- benefits PROFIT holders)

5. Better staking yield attracts more PROFIT demand
   (more users buy CRIME/FRAUD → convert → stake PROFIT)

6. More PROFIT holders participate in prediction market
   (return to step 1 with larger base)
```

**Critical property**: PROFIT holders are the natural liquidity base because they capture value on BOTH sides of the mechanism (prediction payout + staking yield improvement). An outside speculator only captures one side (payout). This means PROFIT holders are willing to accept lower expected prediction returns than pure speculators, because they're monetizing the second-order effect of correct rebalancing on their staking position.

This dual incentive is what prevents the "sophisticated traders dominate and everyone leaves" death spiral seen in most prediction markets. Even if sophisticated traders consistently win the prediction payouts, PROFIT holders continue participating because their net return (smaller payout loss + larger staking yield gain from accurate rebalancing) remains positive.

### Why PROFIT Holders Accept Prediction Market Losses

Worked example:

```
PROFIT holder stakes 100K PROFIT, earning ~10% APY in SOL from staking.
Staking yield per week: ~0.19% of staked value.

Prediction market: holder bets $500 SOL at 70% bucket.
SOL moves 5% up. Optimal was 100%. Holder at 70% makes modest return.

But the rebalancing based on market signal was correct:
  Pool depth grew 3% in USD terms this week from correct allocation.
  Holder's staking yield base increased proportionally.
  Annual yield improvement: 10% * 1.03 = 10.3% APY.

Even if the holder LOST $50 on the prediction market:
  Weekly staking yield on 100K PROFIT: ~$190 equivalent
  Yield improvement from 3% pool growth: ~$5.70/week ongoing
  Prediction market loss: $50 one-time
  Breakeven: ~9 weeks of improved yield covers the prediction loss
```

This math holds even for consistently mediocre predictors. The staking yield improvement from living in a well-rebalanced protocol is a persistent, compounding benefit that offsets periodic prediction market losses — as long as the COLLECTIVE signal is accurate (which it will be, because sophisticated traders keep it honest).

### Incentive Alignment Summary

| Action | Good for actor? | Good for protocol? | Good for all holders? |
|--------|----------------|--------------------|-----------------------|
| PROFIT holder participates in prediction market | Yes (dual benefit) | Yes (liquidity + fees) | Yes (rebalancing signal) |
| Outside speculator participates | Yes (payout opportunity) | Yes (fees + signal) | Yes (better signal + fee revenue) |
| Sophisticated trader dominates | Yes (consistent profits) | Yes (highest quality signal) | Yes (optimal pool allocation) |
| Accurate wallet earns fee reduction | Yes (lower costs) | Yes (retains best signal) | Yes (better rebalancing) |
| Bad actor pushes extreme position | No (LMSR cost + likely loss) | Neutral (one bad week, self-heals) | Neutral (temporary suboptimal allocation) |
| Nobody participates | N/A | No (no rebalancing) | Neutral (protocol stays at current allocation) |

Every rational action by every participant type benefits the protocol. The only negative scenario (nobody participates) results in no rebalancing — which is harmless, not destructive. The mechanism is additive-only to the core protocol.

---

## Quantitative Benefit Analysis

### Does the Futarchy Mechanism Improve Pool Value Over Time?

The core question: does a collectively-steered allocation between SOL and USDC pools produce higher USD pool value than simply holding 100% SOL?

### Model Assumptions

```
SOL weekly moves: ±5% average (symmetric for baseline model)
Futarchy allocation on conviction: 70/30 (toward predicted direction)
Directional accuracy: variable (50% to 80%)
```

### Expected Weekly Returns by Accuracy Level

For each accuracy level, we calculate the expected weekly return of the futarchy-managed portfolio versus a pure SOL baseline (which returns 0% expected on symmetric ±5% moves due to equal up/down probability):

```
At 50% accuracy (coin flip):
  Up weeks:   0.50 × (+3.50%) + 0.50 × (+1.50%) = +2.50%
  Down weeks: 0.50 × (-1.50%) + 0.50 × (-3.50%) = -2.50%
  Net weekly: 0.00% — identical to pure SOL. No benefit, no harm.

At 55% accuracy:
  Net weekly: +0.10% → ~5.3% annualized

At 65% accuracy (Polymarket crypto baseline):
  Up weeks:   0.65 × (+3.50%) + 0.35 × (+1.50%) = +2.80%
  Down weeks: 0.65 × (-1.50%) + 0.35 × (-3.50%) = -2.20%
  Net weekly: +0.30% → ~16.8% annualized

At 75% accuracy:
  Net weekly: +0.50% → ~29.6% annualized

At 80% accuracy:
  Net weekly: +0.60% → ~36.5% annualized
```

**The mechanism is net positive at ANY accuracy above 50%.** Even barely-better-than-random prediction (55%) generates 5.3% annual pool growth in USD terms. At Polymarket's observed 65% baseline for crypto markets, the protocol gains ~17% annual pool growth from collective intelligence alone.

### Why the Asymmetry Favours the Protocol

The benefit comes from a fundamental asymmetry: avoiding downside compounds more powerfully than capturing upside. A 5% loss requires a 5.26% gain to recover. Over many cycles, consistently avoiding more downside than upside missed produces geometric outperformance.

```
Pure SOL over 52 weeks of ±5% random moves:
  Geometric return: slightly negative (volatility drag)
  
Futarchy at 65% accuracy over 52 weeks:
  Geometric return: ~+16.8% (damage avoidance > upside sacrifice)
```

### Bull Market Scenario

In a sustained bull market, the prediction market will allocate heavily SOL (85-90%) with high accuracy because direction is obvious. The mechanism does not force USDC exposure during bull runs.

```
Bull market: SOL up 80% of weeks, average +7%
Prediction accuracy: ~80% (easy to predict in obvious trend)
Allocation: 90/10 SOL

Net weekly return: +3.78%
Pure SOL baseline: +4.20%

Underperformance vs pure SOL: only 0.42% per week
```

The sacrifice is minimal because the collective correctly holds heavy SOL. The small USDC allocation (10%) serves as insurance for the 20% of weeks where SOL pulls back — where it saves significantly more than 0.42%.

### Bear Market Scenario

In a sustained bear market, the mechanism shines brightest. The collective allocates heavy USDC, preserving USD value while SOL declines.

```
Bear market: SOL down 70% of weeks, average -6%
Prediction accuracy: ~75%
Allocation: 20/80 SOL (heavy USDC)

Net weekly return: -1.32%
Pure SOL baseline: -2.40%

Outperformance vs pure SOL: +1.08% per week = massive over a bear cycle
```

### Compounding Effect Over Multi-Year Horizon

```
Starting pool value: $200K
Futarchy accuracy: 65%
Annual futarchy benefit: ~16.8%
Annual LP fee compounding: ~36.5% (at moderate volume)
Annual arb profit-taking benefit: ~2-5%

Year 1: $200K × 1.168 × 1.365 × 1.03 = ~$328K
Year 2: $328K × 1.168 × 1.365 × 1.03 = ~$538K
Year 3: $538K × 1.168 × 1.365 × 1.03 = ~$883K

Pool roughly quadruples in 3 years in USD terms.
Zero new capital required. All growth from:
  - Collective intelligence (futarchy rebalancing)
  - Trading friction (LP fees)
  - Emergent profit-taking (arb mechanics)
```

These numbers are illustrative and assume sustained moderate volume. Actual results depend on SOL volatility, prediction accuracy, and trading volume. But the directional conclusion holds: the mechanism produces compound pool growth from multiple independent sources, none of which require new token buyers.

---

## Interaction with Existing Protocol Mechanics

### Epoch / Tax Regime

No changes. The epoch program flips tax rates per token (CRIME or FRAUD). Both denomination pairs for each token receive the same rate. The epoch program has no awareness of USDC pools or the prediction market.

### Carnage

Carnage currently buys from SOL pools only. Post-expansion, Carnage could:

**Option A**: Continue buying from SOL pools only. Simplest. No Carnage program changes. Cross-denomination arb corrects any resulting price discrepancy to the USDC pools.

**Option B**: Carnage buys from whichever denomination has deeper liquidity (determined by allocation ratio). Requires Carnage to read AllocationState. More efficient burns but adds CPI dependency.

**Recommended**: Option A for initial deployment. Option B as a future optimization if warranted.

### Staking Rewards

Staking rewards accumulate in SOL regardless of pool denomination. Tax revenue from USDC pools is either:

**Option A**: Collected in USDC, auto-swapped to SOL before distribution. Stakers always receive SOL.

**Option B**: Collected in the native quote asset. Stakers claim in whatever denomination is active. Adds UX complexity.

**Recommended**: Option A. Stakers always receive SOL. The auto-swap is a small additional operation on the tax distribution path. This avoids confusing stakers with changing reward denominations.

### Transfer Hook

All four pool vaults must be whitelisted. With multisig-controlled whitelist authority (retained post-launch), this is a straightforward operation: whitelist the two new USDC pool vaults before initializing the USDC pools.

### Conversion Vault

Unaffected. The conversion vault operates on CRIME/FRAUD → PROFIT at a fixed 100:1 rate. It has no awareness of quote-side denomination.

---

## Implementation Phases

### Phase 1: Four-Pool Foundation

- Deploy CRIME/USDC and FRAUD/USDC pool contracts via existing AMM program
- Whitelist new pool vaults in transfer hook
- Seed USDC pools with initial liquidity (allocation TBD)
- Verify tax parity across denomination pairs
- Update frontend to show all four pools and allow quote-side selection
- Update Helius webhooks and indexer for four-pool monitoring

**Dependencies**: Multisig whitelist authority, USDC liquidity source, frontend updates.
**Core protocol changes**: None. Uses existing AMM `initialize_pool` instruction.

### Phase 2: Prediction Market

- Implement LMSR prediction market program (Solana/Anchor)
- Integrate Pyth SOL/USD price feed for market open and settlement
- Implement settlement logic with TWAP
- Implement payout distribution
- Frontend: prediction market UI (buy positions, view market state, claim payouts)
- Audit prediction market program independently

**Dependencies**: Phase 1 complete, Pyth integration, security audit.
**Core protocol changes**: None.

### Phase 3: Rebalancing Orchestrator

- Implement rebalancing program/script
- Integrate Jupiter for SOL↔USDC swaps during rebalancing
- Implement AllocationState PDA
- Connect prediction market resolution → rebalancing execution
- Implement minimum participation threshold
- Frontend: rebalancing status display, historical allocation tracking

**Dependencies**: Phase 2 complete, Jupiter CPI or external swap integration.
**Core protocol changes**: None.

### Phase 4: In-House Arbitrage Expansion

- Extend in-house arbitrage bots to cover all six arbitrage paths
- Cross-denomination arb (SOL/USDC price movement)
- Cross-token arb across USDC pairs (epoch flips)
- Cross-denomination, cross-token arb (combined triggers)
- Route bot profits back to protocol (Carnage amplification or staking boost)

**Dependencies**: Phase 1 complete (four pools active). Independent of Phases 2-3.

---

## Explicit Non-Goals

| Non-Goal | Rationale |
|----------|-----------|
| Continuous rebalancing | Weekly cycle provides clear rhythm, concentrated liquidity in prediction market, and operational simplicity. Continuous rebalancing would produce thin prediction markets and constant slippage drag. |
| Emergency rebalancing mechanism | One suboptimal week is acceptable. Self-heals on Monday. Emergency overrides add governance attack surface that outweighs the benefit. |
| More than two denominations | SOL/USDC captures the primary macro axis (crypto/fiat). Adding more quote assets (e.g., ETH, BTC) multiplies complexity without proportional benefit. |
| General-purpose prediction market | This is a single-purpose mechanism: SOL/USD direction → protocol allocation. Not a platform for arbitrary prediction markets. |
| Governance beyond denomination | The futarchy mechanism controls one parameter: SOL/USDC allocation. It does not extend to tax rates, Carnage parameters, or other protocol settings. |

---

## Open Questions

1. **LMSR `b` parameter**: Requires simulation with realistic participation volume estimates. Too low = noisy, too high = insensitive.

2. **Prediction market fee rate**: Working range 1-3%. Needs market testing. Could start at 2% and adjust via multisig.

3. **Minimum participation threshold**: Below what total market volume is the signal too noisy to act on? Needs empirical calibration.

4. **Settlement TWAP window**: 2-4 hours. Longer = more robust, shorter = more responsive. Needs analysis of historical SOL/USD volatility at weekly close times.

5. **Initial USDC pool seeding**: Where does the initial USDC liquidity come from? Options: treasury, prediction market revenue accumulation pre-launch, or a dedicated seeding phase.

6. **Staking reward denomination**: Option A (always SOL) recommended but adds an auto-swap step on the USDC tax path. Need to verify this doesn't exceed CPI depth limits or compute budget.

7. **Carnage routing**: Option A (SOL pools only) recommended initially. Evaluate Option B (allocation-aware routing) based on observed pool depth asymmetry.

8. **Discretization granularity**: 11 buckets (10% increments) may be too coarse. 21 buckets (5% increments) provides finer control but more complexity. Needs UX testing.

9. **Maximum market cap**: Should the prediction market have a maximum total volume cap in early deployment to limit smart contract risk exposure?

10. **Accuracy tier percentile thresholds**: The 60th/90th/99th split is a starting point. Requires simulation with realistic participation distributions. If the participant pool is small (<100 wallets), percentile-based tiers become noisy. May need minimum absolute thresholds as a fallback.

11. **Accuracy rolling window length**: 12-26 weeks proposed. Shorter windows reward recent performance and allow faster tier changes. Longer windows smooth out lucky/unlucky streaks but slow tier progression. Needs modelling against realistic accuracy variance.

12. **Accuracy metric weighting**: Should all weeks count equally, or should weeks with higher personal stakes weight more heavily? A wallet that bets $10K and gets it right arguably demonstrated more conviction than one that bet $100 and got lucky.

13. **Tier transition smoothing**: Should tiers change immediately at settlement or use a buffer (e.g., must maintain percentile for 2 consecutive weeks before promotion, drop below for 3 consecutive weeks before demotion)? Prevents tier oscillation from week-to-week variance.

14. **PROFIT holder identification in prediction market**: Should the prediction market program verify whether a wallet holds staked PROFIT? This would enable PROFIT-holder-specific features (e.g., bonus payout multiplier, priority access) but adds cross-program state dependency. Alternatively, keep the prediction market fully independent and let the dual-benefit incentive operate implicitly.

---

## Success Criteria

1. **Prediction market produces actionable signal**: Weekly allocation ratios consistently reflect rational SOL/USD directional conviction, not noise or manipulation.

2. **Pool depth grows over time in USD terms**: Correct rebalancing calls result in measurable pool depth growth beyond what LP fee compounding alone would produce.

3. **Outside capital participates**: Non-token-holders use the prediction market, generating fee revenue that flows to stakers and Carnage without requiring new token buyers.

4. **Cross-denomination arbitrage generates measurable volume**: The six arbitrage paths produce tax revenue above and beyond what the original two-pool architecture generated.

5. **No security incidents**: The prediction market program handles funds safely across all market cycles, including edge cases (zero participation, extreme allocation, settlement failures).

6. **Accuracy tiers retain top predictors**: Diamond and Gold tier wallets show higher retention rates than Standard tier wallets, indicating the fee reduction mechanism successfully incentivises the highest-value signal providers to continue participating.

7. **PROFIT holder participation rate**: A meaningful percentage (>30%) of staked PROFIT holders participate in the prediction market, demonstrating that the dual-incentive structure (payout + pool depth growth) drives engagement from the core community.

---

*Spec drafted 2026-03-20. Status: conceptual design. All mechanics require detailed implementation specification, simulation, and security review before development begins.*