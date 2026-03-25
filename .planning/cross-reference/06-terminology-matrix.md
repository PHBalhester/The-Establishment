# Terminology Cross-Reference Matrix

**Created:** 2026-02-01
**Phase:** 03-cross-reference
**Plan:** 02
**Category:** Terminology (TERM)

## Purpose

Cross-references all 10 terminology concepts across 12 specification documents, ensuring domain-specific terms are used consistently throughout the documentation.

## Matrix Summary

| Concept ID | Primary Document | Documents Referencing | Status |
|------------|-----------------|----------------------|--------|
| TERM-001 | DrFraudsworth_Overview.md | 4 | AGREEMENT |
| TERM-002 | DrFraudsworth_Overview.md | 3 | AGREEMENT |
| TERM-003 | Epoch_State_Machine_Spec.md | 3 | AGREEMENT |
| TERM-004 | DrFraudsworth_Overview.md | 3 | AGREEMENT |
| TERM-005 | DrFraudsworth_Overview.md | 4 | AGREEMENT |
| TERM-006 | DrFraudsworth_Overview.md | 2 | AGREEMENT |
| TERM-007 | Token_Program_Reference.md | 2 | AGREEMENT |
| TERM-008 | Yield_System_Spec.md | 1 | SINGLE-SOURCE |
| TERM-009 | Yield_System_Spec.md | 1 | SINGLE-SOURCE |
| TERM-010 | Yield_System_Spec.md | 1 | SINGLE-SOURCE |

**Totals:** 7 agreements, 0 discrepancies, 3 single-source

---

## Detailed Cross-Reference

### TERM-001: Cheap Side

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| DrFraudsworth_Overview.md | The IP token with low buy tax and high sell tax in current epoch | Section "Tax Regime Model" | Primary definition |
| Tax_Pool_Logic_Spec.md | cheap_side determines which token gets low buy / high sell rates | Section 5 | Implementation |
| Epoch_State_Machine_Spec.md | EpochState.cheap_side: CRIME or FRAUD | Section 4.1 | Storage field |
| Soft_Peg_Arbitrage_Spec.md | Arbitrage enters via cheap side buy | Section 6 | Strategic usage |

**Status:** AGREEMENT
**Notes:** Consistent usage across all documents. "Cheap to buy, expensive to sell" - the terminology is intuitive and used uniformly.

**Usage Pattern:**
- Overview: Defines the concept
- Tax spec: Uses to determine rate assignment
- Epoch spec: Stores as state field
- Arbitrage spec: References for entry point

---

### TERM-002: Expensive Side

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| DrFraudsworth_Overview.md | The IP token with high buy tax and low sell tax in current epoch | Section "Tax Regime Model" | Primary definition |
| Tax_Pool_Logic_Spec.md | Opposite of cheap_side, gets high buy / low sell rates | Section 5 | Implementation |
| Soft_Peg_Arbitrage_Spec.md | Arbitrage exits via expensive side sell | Section 6 | Strategic usage |

**Status:** AGREEMENT
**Notes:** Consistently defined as opposite of cheap side. "Expensive to buy, cheap to sell."

**Usage Pattern:**
- Always paired with TERM-001 (Cheap Side)
- Used to describe the other IP token in the regime
- Critical for arbitrage direction understanding

---

### TERM-003: Epoch

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Epoch_State_Machine_Spec.md | 30-minute period (4,500 slots) during which tax regime is fixed | Section 3 | Primary definition with slot precision |
| DrFraudsworth_Overview.md | ~30 minutes, regime changes at epoch boundaries | Section "Epochs" | High-level description |
| Tax_Pool_Logic_Spec.md | Tax rates remain fixed within an epoch | Section 5 | Usage context |

**Status:** AGREEMENT
**Notes:** Overview uses "~30 minutes" (approximate), while Epoch spec provides precise slot count (4500 slots). Not a conflict - Overview appropriately simplifies for readability.

**Normalization:**
- 4500 slots x 400ms/slot = 1,800,000ms = 30 minutes
- "~30 minutes" and "4500 slots" are equivalent
- 48 epochs per day

---

### TERM-004: Carnage

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| DrFraudsworth_Overview.md | Protocol chaos mechanism - market buys with accumulated SOL, burns or sells held tokens | Section "Carnage Fund" | Primary definition |
| Carnage_Fund_Spec.md | Detailed mechanics: trigger probability, action selection, target selection, execution | Full document | Authoritative spec |
| Epoch_State_Machine_Spec.md | Triggered during epoch transition when VRF byte 3 < 11 | Section 7.2 | Trigger mechanism |

**Status:** AGREEMENT
**Notes:** Consistent terminology across all documents. "Carnage" is the protocol's signature chaos mechanism.

**Usage Pattern:**
- Overview: Introduces concept
- Carnage spec: Full implementation details
- Epoch spec: Integration with state machine

---

### TERM-005: Regime Flip

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| DrFraudsworth_Overview.md | When cheap side changes from CRIME to FRAUD or vice versa (75% probability per epoch) | Section "Regime Flip" | Primary definition |
| Tax_Pool_Logic_Spec.md | Flip updates cheap_side field, all four taxes swap assignments | Section 8.2 | Implementation detail |
| Epoch_State_Machine_Spec.md | VRF byte 0 < 192 triggers flip | Section 7.2 | Trigger mechanism |
| Soft_Peg_Arbitrage_Spec.md | Flip creates arbitrage opportunity by shifting no-arb band | Section 7 | Strategic impact |

**Status:** AGREEMENT
**Notes:** Critical protocol event. 75% probability (~192/256) creates frequent opportunities.

**Usage Pattern:**
- All documents use "flip" consistently
- Never called "switch," "change," or "toggle" - always "flip"
- The atomic nature (all four taxes flip together) is clearly stated

---

### TERM-006: Soft Peg

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| DrFraudsworth_Overview.md | CRIME and FRAUD loosely pegged to each other through PROFIT pools | Section "Soft Peg Mechanism" | Primary definition |
| Soft_Peg_Arbitrage_Spec.md | Peg = marginal AMM price including LP fees, excluding taxes | Section 2 | Precise definition |

**Status:** AGREEMENT
**Notes:** "Soft" distinguishes from hard pegs - prices can diverge temporarily, arbitrage restores them.

**Clarification from Arbitrage spec:**
- Peg is based on AMM marginal prices
- LP fees are part of the peg (always present)
- Taxes are NOT part of the peg (they're directional friction)
- This distinction is critical for understanding arbitrage mechanics

---

### TERM-007: Mixed Pool

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Token_Program_Reference.md | Pool containing one Token-2022 token and one SPL Token (WSOL) | Section 4 | Primary definition |
| AMM_Implementation.md | Mixed pools require dual token program handling | Section 6.2 | Implementation note |

**Status:** AGREEMENT
**Notes:** CRIME/SOL and FRAUD/SOL are mixed pools. T22 side has transfer hooks, SPL side (WSOL) does not.

**Technical implication:**
- AMM must call correct token program for each side
- ATA derivation uses different token_program_id
- Hook only fires on T22 side of transfers

---

### TERM-008: Checkpoint Model

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Yield_System_Spec.md | Yield distribution model tracking cumulative yield-per-PROFIT globally and user's last claimed value | Section 3.2 | Only source |

**Status:** SINGLE-SOURCE
**Notes:** Technical term specific to yield system. Describes the mathematical model for tracking and claiming yield.

**Definition elements:**
- Global cumulative: Sum of all yield-per-PROFIT since genesis
- User checkpoint: User's last-claimed cumulative value
- Pending yield: (global - user_checkpoint) * user_balance
- Single claim catches all pending regardless of epochs missed

---

### TERM-009: Ghost Yield Attack

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Yield_System_Spec.md | Attack where user claims yield for periods they didn't hold tokens | Section 11.2 | Only source |

**Status:** SINGLE-SOURCE
**Notes:** Security term specific to yield system. Documents a prevented attack vector.

**Attack pattern (prevented):**
1. User holds PROFIT, yield accumulates
2. User sells PROFIT (checkpoint NOT updated in naive model)
3. Wait for more yield to accumulate
4. User rebuys PROFIT
5. User claims yield including periods they didn't hold

**Mitigation:** Auto-claim on balance change (BEH-008) updates checkpoint before sell.

---

### TERM-010: Circulating Supply (PROFIT)

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Yield_System_Spec.md | Total PROFIT supply minus PROFIT held in pool vaults | Section 6.2 | Only source |

**Status:** SINGLE-SOURCE
**Notes:** Specific definition for yield calculation purposes.

**Calculation:**
- Total supply: 50,000,000 PROFIT
- Minus: CRIME/PROFIT pool vault holdings
- Minus: FRAUD/PROFIT pool vault holdings
- Result: PROFIT that earns yield

**Rationale:** PROFIT locked in pools doesn't earn yield (protocol-owned liquidity).

---

## Normalization Rules Applied

1. **Time terminology:** "~30 minutes" equivalent to "4500 slots"
2. **Probability terminology:** "75%" equivalent to "192/256" or "~3/4"
3. **Side terminology:** "Cheap/expensive" always refers to tax burden, not actual price

## Consistency Checks

| Term | Variants Found | Resolution |
|------|---------------|------------|
| Cheap side | "cheap_side" (code), "cheap side" (prose) | Both acceptable in context |
| Epoch | "epoch", "Epoch" (capitalized in some headers) | Style only, no semantic difference |
| Carnage | "Carnage", "Carnage Fund", "Carnage mechanism" | All refer to same system |

## Flags for Phase 4

- **TERM-008/009/010 (Yield terms):** Single-source but appropriate - these are implementation details. Consider if Overview should mention "checkpoint model" for completeness.
- **Mixed Pool:** May warrant mention in Overview since it affects user understanding of how pools work.
