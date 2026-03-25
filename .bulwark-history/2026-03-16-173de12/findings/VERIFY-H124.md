# Verification: H124
**Status:** NOT_FIXED
**Evidence:** `app/components/launch/BuyForm.tsx` lines 85-86: `BigInt(Math.floor(crimeBalance * Number(TOKEN_DECIMAL_FACTOR)))`. Converts TOKEN_DECIMAL_FACTOR (likely 1e9 BigInt) to Number, multiplies with float balance, then converts back to BigInt. Precision loss possible for very large balances, but token balances are well within Number safe integer range.
