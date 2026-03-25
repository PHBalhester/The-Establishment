---
phase: 71-curve-foundation
plan: 02
subsystem: bonding-curve-math
tags: [rust, bonding-curve, quadratic-formula, proptest, integer-math, tdd]
dependency-graph:
  requires: ["71-01"]
  provides: ["curve-math-module"]
  affects: ["71-04", "72-sell-instruction"]
tech-stack:
  added: []
  patterns: ["u128-isqrt-stdlib", "remainder-recovery-precision", "token-decimal-factor-conversion"]
key-files:
  created: []
  modified: ["programs/bonding_curve/src/math.rs"]
decisions:
  - id: "71-02-D1"
    decision: "Full curve integral is 1000.5 SOL, not 1000 SOL"
    rationale: "P_START=900 is rounded from exact ~898.26; this is inherent to the economic parameters chosen in the spec. Tests verify against the correct mathematical value (1,000,500,000,000 lamports)."
  - id: "71-02-D2"
    decision: "TOKEN_DECIMAL_FACTOR (1e6) division required in integral"
    rationale: "P_START/P_END are lamports per human token; TOTAL_FOR_SALE is in base units (6 decimals). The integral must divide by 1e6 to produce correct lamport values. Without this, the result is 414M SOL instead of 1000 SOL."
  - id: "71-02-D3"
    decision: "Protocol-favored rounding means cost(floor_tokens) <= sol_input"
    rationale: "Floor on tokens_out gives fewer tokens; their cost is naturally less than the input SOL. The vault always has surplus. The correct solvency invariant is cost <= input, not cost >= input."
  - id: "71-02-D4"
    decision: "Remainder recovery in calculate_sol_for_tokens for precision"
    rationale: "Division of N*(2*x1+N) by 2*TOTAL truncates. Recovering the remainder and scaling it separately achieves full-curve integral within 0 lamports of mathematical value."
  - id: "71-02-D5"
    decision: "u128::isqrt() stdlib over hand-rolled Newton's method"
    rationale: "Available on SBF since platform-tools v1.51 (rustc 1.84.1). Karatsuba algorithm, proven correct, zero maintenance, const fn. Strictly superior to hand-rolled."
metrics:
  duration: "~13 minutes"
  completed: "2026-03-03"
---

# Phase 71 Plan 02: Curve Math Module Summary

**One-liner:** Quadratic-formula token solver with u128::isqrt(), remainder-recovery integral, and 2.5M proptest iterations proving vault solvency.

## What Was Done

Implemented the pure math module (`math.rs`) for the bonding curve program using TDD (RED-GREEN cycle). Three public functions for the linear curve P(x) = P_START + (P_END - P_START) * x / TOTAL_FOR_SALE:

1. **`calculate_tokens_out(sol_lamports, current_sold) -> Result<u64>`**
   - Closed-form quadratic solution: dx = [-(a*T + b*x1) + sqrt((a*T + b*x1)^2 + 2*b*S*D*T)] / b
   - Uses `u128::isqrt()` for the discriminant square root (Rust stdlib, Karatsuba algorithm)
   - Floor division for protocol-favored rounding (user gets slightly fewer tokens)
   - Caps output at remaining supply

2. **`calculate_sol_for_tokens(current_sold, tokens) -> Result<u64>`**
   - Linear integral: SOL = [a*N + b_num*N*(2*x1+N)/(2*TOTAL)] / TOKEN_DEC
   - PRECISION (1e12) scaling with remainder recovery for maximum precision
   - Ceil rounding for protocol-favored rounding (user pays slightly more SOL)
   - Full-curve integral achieves EXACT match to mathematical value (0 lamports error)

3. **`get_current_price(tokens_sold) -> u64`**
   - Linear interpolation with PRECISION-scaled progress
   - Returns P_START at 0, P_END at TARGET_TOKENS (exact)

## Key Discovery: Unit Conversion

The spec's pseudocode did not account for TOKEN_DECIMAL_FACTOR (10^6) in the integral. P_START/P_END are in "lamports per human token" but TOTAL_FOR_SALE is in base units (460M * 10^6). Without dividing by 10^6, the integral produces 414M SOL instead of ~1000 SOL. This was discovered during pre-implementation analysis and correctly implemented from the start.

## Integral Identity

The chosen constants (P_START=900, P_END=3450, TOTAL=460e12) produce a full-curve cost of exactly 1,000,500,000,000 lamports (1000.5 SOL), not exactly TARGET_SOL (1000 SOL). This ~0.5 SOL surplus is because P_START was rounded from its exact value of ~898.26 to 900. Tests verify against the correct mathematical value.

## Test Results

| Category | Tests | Iterations | Result |
|----------|-------|------------|--------|
| Integral identities | 3 | 3 | PASS (0 lamport error, 0 token error) |
| Boundary prices | 3 | 3 | PASS (exact P_START, P_END, midpoint) |
| Edge cases | 5 | 5 | PASS (dust, zero, capacity, near-full) |
| Partial purchases | 3 | 3 | PASS (half-sol, sequential, cost curve) |
| Round-trip consistency | 2 | 2 | PASS (vault solvent at all positions) |
| Protocol-favored rounding | 2 | 2 | PASS (floor tokens, ceil SOL) |
| Proptest: no-overflow tokens_out | 1 | 500K | PASS |
| Proptest: no-overflow sol_for_tokens | 1 | 500K | PASS |
| Proptest: monotonic pricing | 1 | 500K | PASS |
| Proptest: round-trip vault solvent | 1 | 500K | PASS |
| Proptest: vault solvency sequential | 1 | 500K | PASS |
| **Total** | **23** | **2,500,018** | **ALL PASS** |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected round-trip rounding direction**
- **Found during:** GREEN phase (proptest round_trip_protocol_favored)
- **Issue:** Initial test asserted `cost(tokens) >= sol_input`, but protocol-favored rounding means `tokens = floor(exact)` which costs LESS than the input. The correct invariant is `cost(tokens) <= sol_input` (vault is solvent with surplus).
- **Fix:** Reversed inequality in round_trip tests and proptest property. Added cost(tokens+1) > sol_input assertion as complementary proof.
- **Files modified:** programs/bonding_curve/src/math.rs (test section)
- **Commit:** 9ea846a (included in GREEN commit)

**2. [Rule 2 - Missing Critical] TOKEN_DECIMAL_FACTOR unit conversion**
- **Found during:** Pre-implementation analysis
- **Issue:** The spec's pseudocode and research code examples did not include division by TOKEN_DECIMALS (10^6) in the integral, producing results off by ~6 orders of magnitude.
- **Fix:** Added TOKEN_DECIMAL_FACTOR constant and division in calculate_sol_for_tokens denominator. Derived the correct quadratic formula that includes the factor.
- **Files modified:** programs/bonding_curve/src/math.rs
- **Commit:** 9ea846a

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Full curve = 1000.5 SOL (not 1000) | Inherent to P_START=900 rounding from ~898.26 |
| TOKEN_DECIMAL_FACTOR in integral | Required for correct unit conversion from lamports/human_token to lamports/base_unit |
| cost(floor_tokens) <= sol_input | Correct protocol-favored solvency direction |
| Remainder recovery in sol_for_tokens | Achieves 0-lamport error on full-curve integral |
| u128::isqrt() stdlib | Available on SBF, proven correct, zero maintenance |

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 86420e0 | test | Add failing tests for curve math module (RED phase) |
| 9ea846a | feat | Implement curve math module with quadratic solver (GREEN phase) |

## Next Phase Readiness

The math module is fully tested and ready for:
- **Plan 04 (Purchase instruction):** Will call `calculate_tokens_out()` in the buy handler
- **Phase 72 (Sell instruction):** Will call `calculate_sol_for_tokens(x1 - N, N)` for sell-back pricing

No blockers. No concerns.
