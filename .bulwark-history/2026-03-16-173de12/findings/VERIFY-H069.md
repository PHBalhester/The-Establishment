# VERIFY-H069: No Minimum Sell Amount Enforcement
**Status:** NOT_FIXED (accepted risk)
**Round:** 3
**Date:** 2026-03-12

## Evidence
- No commits referencing H069 since 2026-03-09.
- AMM swap logic unchanged; no explicit minimum sell threshold added.
- On-chain `InputAmountTooSmall` error triggers when fee deduction produces zero output, providing implicit dust protection.

## Assessment
Accepted risk. The implicit dust boundary (fee deduction yielding zero = error) is sufficient protection for LOW severity. Adding an explicit minimum would be a UX nicety, not a security requirement. No change from Round 2.
