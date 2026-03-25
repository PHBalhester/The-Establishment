# Verification: H119
**Status:** NOT_FIXED
**Evidence:** AMM on-chain rejects dust with `InputAmountTooSmall` when fee deduction produces zero. No frontend minimum enforcement for tiny amounts that would produce zero fees. The on-chain guard is sufficient protection.
