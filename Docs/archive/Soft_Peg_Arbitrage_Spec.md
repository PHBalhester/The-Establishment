# Dr. Fraudsworth’s Finance Factory
## Soft Peg Arbitrage Mechanics

---

## 1. Purpose

This document formally defines the **soft-peg arbitrage mechanics** that
couple the SOL pools and PROFIT pools and create extractable arbitrage
opportunities for bots.

It explains:
- How the no-arbitrage band is formed
- How asymmetric taxes shape that band
- Why tax regime flips create arbitrage
- How much profit is theoretically and practically extractable

This document is **descriptive**, not executable.  
Execution details live in the AMM and Tax specifications.

---

## 2. Explicit Assumptions

This model operates under the following **explicit assumptions**:

1. **SOL pools (CRIME/SOL, FRAUD/SOL)**
   - LP fee: 1%
   - Variable buy and sell taxes
   - Taxes are SOL-denominated

2. **PROFIT pools (CRIME/PROFIT, FRAUD/PROFIT)**
   - LP fee: 0.5%
   - No taxes

3. **AMM model**
   - Constant-product (x × y = k)
   - Marginal price analysis (first-dollar profitability)

4. **Tax regime**
   - Single global regime per epoch
   - One token is cheap-to-buy / expensive-to-sell
   - Regime flips atomically

5. **Execution**
   - Arbitrage is assumed to be **atomic** in the optimal case
   - MEV, latency, and competition are ignored in theoretical bounds

> Real-world extractable profit is **lower** due to slippage, pool depth,
> competition, and execution risk.

---

## 3. Price Definitions

### 3.1 SOL Pool Prices

- \( P_a \) = SOL per CRIME  
- \( P_b \) = SOL per FRAUD  

The SOL price ratio is:

\[
S = \frac{P_a}{P_b}
\]

### 3.2 PROFIT Pool Prices

- \( R_{ao} \) = PROFIT per CRIME  
- \( R_{bo} \) = PROFIT per FRAUD  

The PROFIT price ratio is:

\[
R = \frac{R_{ao}}{R_{bo}}
\]

### 3.3 Peg Definition (Critical)

The **effective peg** is defined as the ratio:

\[
\frac{S}{R}
\]

- LP fees are **included**
- Taxes are **excluded**
- Taxes act as directional friction, not price

---

## 4. LP Fee Factor

Each arbitrage loop traverses:

- 2 SOL pools (1% each)
- 2 PROFIT pools (0.5% each)

Total LP fee factor:

\[
F = (1 - f_{sol})^2 \times (1 - f_{op4})^2
\]

With:
- \( f_{sol} = 1\% \)
- \( f_{op4} = 0.5\% \)

\[
F \approx 0.9703
\]

---

## 5. Loop Friction (Taxes + LP Fees)

Each loop incurs **exactly two tax events**:
- One buy tax
- One sell tax
- On **different tokens**

### 5.1 Loop 1 (Buy CRIME, Sell FRAUD)

\[
F_1 = (1 - T_{CRIME,buy}) \times (1 - T_{FRAUD,sell}) \times F
\]

### 5.2 Loop 2 (Buy FRAUD, Sell CRIME)

\[
F_2 = (1 - T_{FRAUD,buy}) \times (1 - T_{CRIME,sell}) \times F
\]

This asymmetry is fundamental.

---

## 6. Loop Return Formulas

### 6.1 Loop 1  
**SOL → CRIME → PROFIT → FRAUD → SOL**

\[
\text{Return}_1 = \frac{R}{S} \times F_1
\]

### 6.2 Loop 2  
**SOL → FRAUD → PROFIT → CRIME → SOL**

\[
\text{Return}_2 = \frac{S}{R} \times F_2
\]

A loop is profitable if its return exceeds 1.

---

## 7. No-Arbitrage Band

### 7.1 Conditions

- Loop 1 unprofitable if:
  \[
  \frac{R}{S} \times F_1 \le 1 \Rightarrow \frac{S}{R} \ge F_1
  \]

- Loop 2 unprofitable if:
  \[
  \frac{S}{R} \times F_2 \le 1 \Rightarrow \frac{S}{R} \le \frac{1}{F_2}
  \]

### 7.2 Combined Band

\[
F_1 \le \frac{S}{R} \le \frac{1}{F_2}
\]

This is the **no-arbitrage band**.

- Trading pressure moves \( S \)
- Arbitrage moves \( R \)
- Both pools move together to keep \( S/R \) inside the band

---

## 8. Band Shift at Tax Regime Flip

When the tax regime flips:
- \( F_1 \) and \( F_2 \) swap roles
- The no-arb band shifts abruptly

If the current \( S/R \) lies **outside the new band**, arbitrage becomes profitable.

---

## 9. Arbitrage at the Flip

### 9.1 Marginal Profit

If \( S/R \) is outside the new band:

\[
\text{Marginal Profit} = \left(\frac{S}{R}\right) \times F_{new} - 1
\]

### 9.2 Maximum Theoretical Profit

If \( S/R \) was at the old band edge:

\[
\text{Max Profit} = \frac{F_{new}}{F_{old}} - 1
\]

This is a **first-dollar** bound only.

---

## 10. Capital-Constrained Extraction

Marginal profit does **not** equal total extractable profit.

Approximation:

\[
\text{Total Profit} \propto \sqrt{\text{Pool Depth} \times \text{Band Gap}}
\]

Implications:
- First trades capture most value
- Each trade collapses the opportunity
- Competition compresses profits further

---

## 11. Executability Threshold

For arbitrage to be executable:

\[
\text{Marginal Profit} > \text{Slippage} + \text{Gas}
\]

On Solana, this implies a practical threshold of roughly **3–5%**.

- Full flips (1% ↔ 14%): easily executable
- Moderate flips (2% ↔ 12%): executable
- Edge flips (4% ↔ 11%): thin
- No-flip epochs: generally not executable

---

## 12. No-Flip Epochs

When the cheap side does **not** flip:
- The band shifts only slightly
- Trading pressure rapidly re-anchors \( S/R \)
- Any marginal opportunity is transient

No-flip epochs do **not** produce reliable arbitrage.

---

## 13. Key Takeaways

1. The constraint is on **S/R**, not individual prices
2. SOL and PROFIT pools are tightly coupled
3. Each loop includes **two taxes on different tokens**
4. Trading pressure pushes toward band edges
5. Tax flips shift the band discontinuously
6. Profit exists only when old \( S/R \) lies outside the new band
7. Marginal profit ≠ extractable profit
8. Extraction scales sub-linearly with capital
9. PROFIT pools are always tax-free
10. All profits discussed are **upper bounds**

---

## Worked Examples

These examples demonstrate arbitrage profitability under different epoch flip scenarios. All examples assume pool depths of 100,000 SOL / 100,000 CRIME.

### Example 1: Full Flip (1% -> 14%)

**Scenario:** Current epoch has 1% tax on sells, 14% on buys. VRF callback will flip to 14% sells, 1% buys.

**Pre-flip state:**
- CRIME holder wants to sell
- Sell tax: 1% (favorable)
- Buy tax: 14% (unfavorable)

**Arbitrage strategy:**
1. Buy CRIME at 14% tax (accept high tax)
2. Wait for epoch flip
3. Sell CRIME at 1% tax (exploit low tax)

**Calculation:**
- Buy 1000 SOL worth of CRIME at 14% tax
  - Input: 1000 SOL
  - Tax deducted: 140 SOL (14%)
  - Net to swap: 860 SOL
  - CRIME received: ~858 CRIME (0.2% slippage at this depth)

- After flip, sell CRIME at 1% tax
  - Input: 858 CRIME
  - Tax deducted: 8.58 CRIME (1%)
  - Net to swap: 849.42 CRIME
  - SOL received: ~847 SOL

**Result:**
- Spent: 1000 SOL
- Received: 847 SOL
- Loss: 153 SOL (15.3%)
- **Not profitable** despite "full flip"

**Why unprofitable:** The 14% buy tax dominates. First-dollar arbitrageur would need the flip to create >14% price impact to profit.

### Example 2: Marginal Flip (4% -> 11%)

**Scenario:** Current epoch has 4% sell tax, 11% buy tax. Flip to 11% sell, 4% buy.

**Pre-flip arbitrage:**
Same calculation shows ~15% loss due to combined taxes.

**Post-flip opportunistic trading:**
- Regular users buying at 4% (instead of 11%) save 7%
- This is the actual benefit - not arbitrage profit, but reduced trading costs

### Example 3: Price Impact Arbitrage (Different Pool)

**Scenario:** CRIME/SOL pool has 1:1 price. FRAUD/SOL pool has 0.95:1 price (FRAUD is "cheap").

**True arbitrage:**
1. Buy FRAUD with SOL (cheap side)
2. Swap FRAUD -> PROFIT -> CRIME via PROFIT pool
3. Sell CRIME for SOL (if CRIME is at premium)

**Key insight:** Tax-based arbitrage is about relative price differences between pools, not epoch flips within one pool.

### Summary Table

| Scenario | Buy Tax | Sell Tax | Naive Arbitrage Profit | Reality |
|----------|---------|----------|------------------------|---------|
| 1%/14% flip | 14% | 1% | Appears +13% | Actually -15% |
| 4%/11% flip | 11% | 4% | Appears +7% | Actually -15% |
| Cross-pool | Varies | Varies | Depends on spread | Can be +2-5% if spread exists |

**Practical threshold:** Cross-pool arbitrage becomes viable when price spreads exceed ~5% after accounting for both-side taxes (max 28% combined in worst case).
