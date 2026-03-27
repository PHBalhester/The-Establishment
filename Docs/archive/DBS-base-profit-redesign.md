# PROFIT Pool Redesign: From AMM to Fixed-Rate Vault

> **Status: Implemented** — DBS Phase 51 cycle, completed 2026-02-27.
> This spec is retained as a design reference. See current architecture in [architecture.md](architecture.md).

## Status: Approved Architecture Change

---

## 1. The Problem: Leveraged Liquidation via PROFIT Pools

### Discovery

Analysis of the protocol's constant product (x × y = k) PROFIT pools revealed a critical leverage amplification vulnerability. Because PROFIT pools use the same AMM invariant as SOL pools, the CRIME:PROFIT ratio drifts as users convert tokens. This drift creates an escalating leverage multiplier where PROFIT holders can extract disproportionately large amounts of CRIME/FRAUD relative to their investment, then dump that into the SOL pools to drain real liquidity.

### The Mechanism

Under the original design (250M CRIME : 25M PROFIT per pool, 10:1 starting ratio):

1. As users buy CRIME from the SOL pool and convert to PROFIT via the AMM, the PROFIT pool ratio drifts from 10:1 toward extreme values (100:1, 155:1, etc.)
2. At these lopsided ratios, a PROFIT holder selling back into the pool receives a **massively disproportionate** amount of CRIME
3. That avalanche of CRIME then hits the SOL pool, draining real SOL liquidity far beyond what a normal sell would cause

### Severity by Scenario

**Without LP fee compounding (static pools):**

| Buyout Level | Pool Ratio | 1% PROFIT Dump | SOL Drained | Amplification vs Direct Sell |
|-------------|-----------|---------------|-------------|-----|
| 30% | 36:1 | 17.4M CRIME | 7.9% | 1.7x |
| 50% | 62:1 | 29.8M CRIME | 17.0% | 2.6x |
| 70% | 96:1 | 45.2M CRIME | 34.2% | 3.3x |
| 95% | 148:1 | 68.8M CRIME | 82.6% | 2.0x |

At the extreme (95% buyout, no compounding): a single holder of 1% PROFIT supply could drain **83% of all SOL liquidity** in the pool.

**With LP fee compounding (realistic scenarios):**

LP fees compound into pool depth over time, significantly mitigating the problem at scale:

| Scenario | Time | Volume | SOL Pool Depth | 1% PROFIT Drain | Amplification |
|----------|------|--------|---------------|-----------------|---------------|
| Slow Burn | 6 months | 2%/day | $2.1M | 27.3% | 3.6x |
| Healthy Growth | 4 months | 5%/day | $13M | 14.5% | 3.8x |
| Fast Pump | 1 month | 15%/day | $26M | 14.7% | 3.8x |
| Viral Explosion | 2 weeks | 50%/day | $37M | 10.8% | 2.4x |
| Blue Chip | 1 year | 3%/day | $375M | 3.8% | 4.2x |

LP fee compounding reduces severity dramatically at scale, but the early-protocol window remains vulnerable, and 3-4x amplification persists across all mature scenarios.

### Why Alternative AMM Curves Don't Help

**StableSwap (Curve-style):** Testing with amplification parameters A=10 through A=100 revealed that StableSwap makes the problem **worse**, not better. At 30% buyout, amplification jumps from 1.7x (constant product) to 8.8x (StableSwap A=100). The flat curve that reduces friction for small trades equally reduces friction for large dumps — the same property that helps arb bots also helps the nuke.

**Concentrated Liquidity (CLMM):** Same fundamental issue — deeper liquidity within a range means more tokens extractable per dump. Also carries massive implementation complexity and range management problems for an immutable protocol.

**Ratio/Supply Changes:** Changing the initial CRIME:PROFIT ratio or PROFIT supply has zero effect on leverage. The amplification is a structural property of chaining two constant product pools, not a function of the starting parameters.

### Root Cause

The leverage amplification is **inherent to any AMM curve applied to the PROFIT pools**. Every curve that reduces slippage for normal-sized trades (desirable for arb efficiency) equally reduces slippage for large dumps (creating the leverage vulnerability). The ratio drift under any AMM variant creates escalating claims on SOL liquidity that grow disproportionately with pool imbalance.

---

## 2. The Solution: Fixed-Rate Conversion Vault

### Core Change

Replace the two PROFIT AMM pools (CRIME/PROFIT and FRAUD/PROFIT) with a **fixed-rate conversion vault**. The vault performs token swaps at a permanent, immutable exchange rate with zero fees.

**Conversion rate: 100 CRIME = 1 PROFIT = 100 FRAUD (fixed, permanent)**

### Why This Works

With fixed-rate conversion, there is no ratio drift, no pool imbalance, and no leverage multiplier. A 1% PROFIT holder (200K tokens) converts to 20M CRIME or FRAUD — exactly 2% of their supply, which is the correct proportional equivalent since PROFIT's 20M supply represents half the value of each 1B IP token supply at the 100:1 ratio. The amplification factor relative to equivalent dollar investment drops to **1.0x** at every buyout level — a PROFIT dump has identical impact to an equivalent-dollar CRIME dump.

### Token Architecture

| Token | Total Supply | Bonding Curve | SOL Pool | Vault | Max Circulating |
|-------|-------------|--------------|----------|-------|-----------------|
| CRIME | 1,000,000,000 | 460M (46%) | 290M (29%) | 250M (25%) | 750M (75%) |
| FRAUD | 1,000,000,000 | 460M (46%) | 290M (29%) | 250M (25%) | 750M (75%) |
| PROFIT | 20,000,000 | — | — | 20M (100%) | 15M (75%) |

**Bonding curve parameters, SOL pool seeding, and all pricing are unchanged from the original specification.**

### Vault Mechanics

The vault is a single contract holding all three tokens:

**Starting state:** 250M CRIME + 250M FRAUD + 20M PROFIT

**Operations:**
- Send 100 CRIME → Receive 1 PROFIT
- Send 100 FRAUD → Receive 1 PROFIT
- Send 1 PROFIT → Receive 100 CRIME
- Send 1 PROFIT → Receive 100 FRAUD

**Depletion analysis:** The vault is a closed system. Every PROFIT that leaves requires CRIME or FRAUD entering. Every CRIME/FRAUD that leaves requires PROFIT entering. The maximum theoretical demand is 1B CRIME and 1B FRAUD converting simultaneously, requiring 20M PROFIT — which is exactly what the vault holds.

The 250M pre-loaded CRIME and FRAUD in the vault act as a cross-conversion buffer. They can never be extracted without sending PROFIT in first (which nobody starts with), so they are effectively locked permanently — reducing maximum circulating supply to 75% for all three tokens.

### Supply Symmetry

Every token in the system has identical circulation properties:
- 25% permanently locked (vault reserves or unreachable buffer)
- 75% maximum circulating supply
- CRIME and FRAUD are deflationary via the Carnage Fund
- PROFIT supply is fixed (no Carnage Fund exposure, no mint authority)

---

## 3. Impact on Protocol Mechanics

### Arbitrage Loop

The arb loop continues to function identically, with reduced friction:

**Old loop:** SOL → CRIME (1% LP + tax) → PROFIT (0.5% LP) → FRAUD (0.5% LP) → SOL (1% LP + tax)
Round-trip friction: ~4.9%

**New loop:** SOL → CRIME (1% LP + tax) → PROFIT (free) → FRAUD (free) → SOL (1% LP + tax)
Round-trip friction: ~4.0%

The ~1% friction reduction makes arb more profitable at every tax combination, generating more volume and more tax revenue for stakers.

| Tax Regime | Old Friction | New Friction | Arb Profit Increase |
|-----------|-------------|-------------|-------------------|
| 1% / 11% | ~5.0% | ~4.0% | +1.2% per loop |
| 2% / 12% | ~5.1% | ~4.0% | +1.2% per loop |
| 3% / 13% | ~5.2% | ~4.1% | +1.2% per loop |
| 4% / 14% | ~5.3% | ~4.1% | +1.2% per loop |

### Soft Peg

The soft peg between CRIME and FRAUD is preserved. Both tokens convert to each other 1:1 through PROFIT as intermediary (100 CRIME → 1 PROFIT → 100 FRAUD). The peg mechanism is identical — if CRIME becomes cheaper than FRAUD on the SOL pools, arb bots buy CRIME, convert through the vault to FRAUD, and sell FRAUD, pushing prices back toward parity.

The peg becomes marginally tighter because the conversion leg introduces zero friction instead of 1% LP fees.

### Vault Balance & Self-Correction

The vault can become imbalanced if conversions flow predominantly in one direction (e.g., heavy CRIME→PROFIT conversion depletes PROFIT reserves while accumulating CRIME). However:

1. **Arb flows are inherently bidirectional.** Each epoch flip (75% probability, every 30 minutes) reverses which token is cheap to buy, pushing conversion flow in the opposite direction. Over 48 epochs per day, the vault naturally rebalances.

2. **Imbalance creates arb opportunity.** If the vault accumulates excess CRIME (meaning lots of CRIME converted to PROFIT), that implies less CRIME circulating and more FRAUD circulating. FRAUD becomes relatively cheap, incentivising arb bots to buy FRAUD → convert to CRIME via vault → sell CRIME. This pushes FRAUD back into the vault and pulls CRIME out. The imbalance is self-correcting and generates tax revenue during correction.

3. **The 250M pre-loaded buffer provides headroom.** The vault starts with 250M of each IP token, providing substantial cross-conversion capacity before any depletion risk. This buffer exists specifically because of the token allocation structure and costs nothing — the tokens are effectively locked regardless.

4. **Exit flow splits across both tokens.** Users exiting PROFIT positions convert to whichever IP token has the cheaper sell tax at that moment. Since the cheap side alternates every 30 minutes, exit flow naturally distributes across both tokens rather than concentrating on one.

### PROFIT Valuation

Under the new architecture, PROFIT FDV is deterministically linked to CRIME/FRAUD FDV:

**PROFIT price = CRIME price × 100 (always, by definition)**
**PROFIT FDV = PROFIT supply × CRIME price × 100**

At 20M supply with a 100:1 ratio, PROFIT FDV equals 75% of the combined CRIME + FRAUD FDV. There is no leverage, no phantom valuation, and no scenario where PROFIT FDV diverges wildly from the underlying IP token valuations.

### Yield

Yield per dollar invested is unchanged. The same total SOL tax revenue (75% of all taxes) is distributed to staked PROFIT. With 20M supply at 100:1, a user converting $1,000 of CRIME into PROFIT receives fewer tokens at a higher unit price but the same dollar-denominated yield. The staking economics are identical.

---

## 4. Implementation Notes

### What Changes
- PROFIT pools (CRIME/PROFIT AMM and FRAUD/PROFIT AMM) are removed
- A conversion vault contract replaces them
- PROFIT total supply changes from 50M to 20M
- Vault is seeded with 250M CRIME + 250M FRAUD + 20M PROFIT at protocol initialization
- The 0.5% LP fee on PROFIT pools is eliminated (conversion is free)

### What Stays the Same
- Bonding curve parameters (460M tokens, 1,000 SOL raised, per-wallet cap)
- SOL pool configuration (290M tokens + 1,000 SOL, 1% LP fee)
- Tax regime (asymmetric, VRF-driven, 30-minute epochs)
- Staking mechanics (stake PROFIT → earn SOL yield)
- Carnage Fund (24% of tax revenue, burns CRIME/FRAUD)
- Transfer hooks and whitelist enforcement
- All authority burns and immutability guarantees

### Vault Contract Requirements
- Fixed-rate swap: accept one token, send another at immutable ratio
- Whitelist integration: vault addresses must be on the transfer hook whitelist
- No admin functions: ratio is hardcoded, not configurable
- No upgrade path: vault logic is immutable post-deployment
- Atomic execution: conversions either complete fully or revert

---

## 5. Summary

The original AMM-based PROFIT pools created an inherent leverage vulnerability where PROFIT holders could extract disproportionate amounts of CRIME/FRAUD as pool ratios drifted, then dump that into SOL pools for outsized liquidity drain. This is a structural property of constant product math (and all other AMM curves) that cannot be mitigated by parameter tuning.

The fixed-rate vault eliminates this entirely by making the conversion ratio permanent. The amplification factor drops from 3-8x to exactly 1.0x. As a bonus, the vault architecture also reduces arb friction by ~1%, simplifies implementation, creates a clean 25%/75% locked/circulating split across all tokens, and introduces a self-correcting rebalancing mechanism that generates additional tax revenue when stressed.

The vault's pre-loaded IP token reserves (250M each) serve dual purpose: they make the token allocation math clean while providing cross-conversion buffer capacity that improves protocol resilience under asymmetric flow conditions.