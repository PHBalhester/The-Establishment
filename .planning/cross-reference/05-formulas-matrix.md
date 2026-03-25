# Formulas Cross-Reference Matrix

**Created:** 2026-02-01
**Phase:** 03-cross-reference
**Plan:** 02
**Category:** Formulas (FORM)

## Purpose

Cross-references all 8 formula concepts across 12 specification documents, tracking mathematical consistency and where calculations are defined vs. relied upon.

## Matrix Summary

| Concept ID | Primary Document | Documents Referencing | Status |
|------------|-----------------|----------------------|--------|
| FORM-001 | AMM_Implementation.md | 2 | AGREEMENT |
| FORM-002 | Tax_Pool_Logic_Spec.md | 2 | AGREEMENT |
| FORM-003 | Epoch_State_Machine_Spec.md | 1 | SINGLE-SOURCE |
| FORM-004 | Yield_System_Spec.md | 1 | SINGLE-SOURCE |
| FORM-005 | Yield_System_Spec.md | 1 | SINGLE-SOURCE |
| FORM-006 | Token_Program_Reference.md | 1 | SINGLE-SOURCE |
| FORM-007 | Bonding_Curve_Spec.md | 1 | SINGLE-SOURCE |
| FORM-008 | Soft_Peg_Arbitrage_Spec.md | 1 | SINGLE-SOURCE |

**Totals:** 2 agreements, 0 discrepancies, 6 single-source

**Note:** High single-source count is expected for formulas - each is defined in its authoritative spec. Phase 4 should verify formulas are not restated incorrectly elsewhere rather than adding redundant definitions.

---

## Detailed Cross-Reference

### FORM-001: AMM Pricing (Constant Product)

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| AMM_Implementation.md | `amount_out = reserve_out * effective_input / (reserve_in + effective_input)` where `effective_input = amount_in * (10000 - lp_fee_bps) / 10000` | Section 8.1 | Primary definition |
| Tax_Pool_Logic_Spec.md | References AMM pricing for output calculation, applies tax after | Section 9.2-9.3 | Relies on formula |

**Status:** AGREEMENT
**Notes:** Standard Uniswap V2 constant product formula. Tax_Pool_Logic correctly treats this as a black box, applying taxes before/after the AMM calculation as appropriate.

**Mathematical Verification:**
- Uses u128 for intermediate calculations to prevent overflow
- LP fee deducted from input before swap calculation
- Output amount rounds down (floor division)
- Invariant: k = reserve_in * reserve_out (approximately maintained, grows due to LP fees)

---

### FORM-002: Tax Calculation

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Tax_Pool_Logic_Spec.md | `tax_amount = sol_amount * tax_rate_bps / 10000` | Section 9.2-9.3 (implicit) | Primary definition |
| Epoch_State_Machine_Spec.md | Tax rates stored in bps, calculation delegated to Tax Program | Section 4.1 | Storage format |

**Status:** AGREEMENT
**Notes:** Simple percentage calculation using basis points. Tax is always in SOL (input for buys, output for sells).

**Mathematical Verification:**
- Integer division truncates (rounds down) - protocol retains the dust
- tax_rate_bps range: 100-400 (low) or 1100-1400 (high)
- Maximum tax: 14% of SOL amount

---

### FORM-003: Epoch Calculation

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Epoch_State_Machine_Spec.md | `current_epoch = (current_slot - genesis_slot) / SLOTS_PER_EPOCH` | Section 3.2 | Only source |

**Status:** SINGLE-SOURCE
**Notes:** Authoritative in Epoch spec. Other documents rely on epochs existing but don't restate the calculation.

**Mathematical Verification:**
- Integer division provides deterministic epoch boundaries
- genesis_slot = slot when protocol launched
- SLOTS_PER_EPOCH = 4500
- No off-by-one: epoch 0 spans slots [genesis, genesis+4499]

---

### FORM-004: Yield Per PROFIT Calculation

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Yield_System_Spec.md | `yield_per_op4 = (epoch_yield_lamports * 1e18) / circulating_op4` | Section 6.3 | Only source |

**Status:** SINGLE-SOURCE
**Notes:** High-precision calculation using 1e18 scaling factor. Critical for fair yield distribution.

**Mathematical Verification:**
- epoch_yield_lamports: 75% of taxes collected in SOL during epoch
- circulating_op4: Total PROFIT minus pool vault holdings
- 1e18 scaling prevents precision loss when dividing small yields by large supply
- Result added to cumulative (monotonically increasing)

---

### FORM-005: Pending Yield Calculation

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Yield_System_Spec.md | `pending = (current_cumulative - user_last_cumulative) * user_balance / 1e18` | Section 6.4 | Only source |

**Status:** SINGLE-SOURCE
**Notes:** Core checkpoint model calculation. Enables single-transaction claim of all pending yield.

**Mathematical Verification:**
- current_cumulative: Global cumulative yield-per-PROFIT (u128)
- user_last_cumulative: User's checkpoint (u128, stored in UserYieldAccount)
- user_balance: User's current PROFIT holdings (read from token account)
- Division by 1e18 reverses the scaling from FORM-004
- Result in lamports (integer)

---

### FORM-006: ATA Derivation

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Token_Program_Reference.md | `ATA = PDA([wallet_address, token_program_id, mint_address], ASSOCIATED_TOKEN_PROGRAM)` | Section 7.1 | Only source |

**Status:** SINGLE-SOURCE
**Notes:** Standard Solana ATA derivation. CRITICAL: token_program_id differs for WSOL vs T22 tokens.

**Mathematical Verification:**
- For WSOL: token_program_id = TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA (SPL Token)
- For CRIME/FRAUD/PROFIT: token_program_id = TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb (Token-2022)
- Same wallet gets different ATA addresses for WSOL vs T22 tokens
- Seeds are deterministic, PDA derivation is one-way

---

### FORM-007: Linear Curve Price Function

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Bonding_Curve_Spec.md | `P(x) = P_START + (P_END - P_START) * x / TOTAL_FOR_SALE` | Section 4.1 | Only source |

**Status:** SINGLE-SOURCE
**Notes:** Linear bonding curve. End price matches pool seeding price (no arbitrage gap at launch).

**Mathematical Verification:**
- P_START = 0.0000009 SOL per token (900 lamports per 1M tokens)
- P_END = 0.00000345 SOL per token (3450 lamports per 1M tokens)
- TOTAL_FOR_SALE = 460,000,000 tokens (460M)
- x = tokens already sold
- Price increases ~3.83x from start to end
- Cost for user buying `n` tokens: integral from x to x+n of P(x) dx

---

### FORM-008: No-Arbitrage Band

| Document | Value | Location | Context |
|----------|-------|----------|---------|
| Soft_Peg_Arbitrage_Spec.md | `F1 <= S/R <= 1/F2` where F1, F2 are loop friction factors | Section 7 | Only source |

**Status:** SINGLE-SOURCE
**Notes:** Defines when arbitrage is profitable. Band shifts on regime flip.

**Mathematical Verification:**
- S = CRIME_SOL_price / FRAUD_SOL_price (SOL price ratio)
- R = CRIME_PROFIT_price / FRAUD_PROFIT_price (PROFIT price ratio)
- F1 = friction for "buy cheap, sell expensive" loop
- F2 = friction for reverse loop
- Friction includes: LP fees (4x), taxes (2x), slippage
- When S/R falls outside band after flip, arbitrage profitable

---

## Normalization Rules Applied

1. **Basis points:** All percentage calculations use bps (10000 = 100%)
2. **Precision scaling:** Yield calculations use 1e18 scaling factor
3. **Integer math:** All formulas use integer division with truncation (no floating point)

## Flags for Phase 4

- **Single-source formulas (6/8):** This is expected - formulas should have one authoritative definition. Phase 4 should verify they aren't incorrectly restated elsewhere rather than adding redundant definitions.
- **FORM-007 (Bonding Curve):** Integration formula for cost calculation not explicitly stated - may need clarification for implementation.
