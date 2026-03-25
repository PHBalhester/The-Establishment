# Verification: H031 - Dual-curve grief attack

**Original Severity:** LOW
**Verification Status:** NOT_FIXED (By Design - Economic Constraint)

## Changes Found

No code changes related to this finding. The bonding curve sell instruction (`programs/bonding_curve/src/instructions/sell.rs`) retains the 15% sell tax, which is the economic deterrent against grief attacks.

The `CurveStatus::Active` constraint (line 36-37) ensures sells are only possible on active curves, and the curve math functions (`calculate_sol_for_tokens`, `get_current_price`) remain unchanged.

## Verification Analysis

This was always an economic constraint rather than a code fix. The 15% sell tax makes a grief attack cost approximately 32 SOL per 100M token price gap, making it economically irrational. The original finding recommended off-chain monitoring, which is an operational concern outside the scope of on-chain code verification.

## Regression Check

No regression. The sell tax rate remains at 15%. The bonding curve state machine (Active -> Graduated) is unchanged. No new paths bypass the sell tax.
