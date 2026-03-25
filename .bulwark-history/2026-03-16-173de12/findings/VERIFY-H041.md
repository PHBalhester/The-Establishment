# VERIFY-H041: No Compute Budget Set for Bonding Curve Transactions
**Status:** NOT_FIXED (accepted risk)
**Round:** 3
**Date:** 2026-03-12

## Evidence
No `ComputeBudgetProgram` usage found in `app/components/launch/BuyForm.tsx` or `SellForm.tsx`. Default 200k CU allocation applies to bonding curve transactions.

## Assessment
Accepted risk. Bonding curve transactions are relatively simple (single CPI, no transfer hooks) and fit within the default 200k CU budget. Priority fees and explicit CU limits are a mainnet optimization concern, not a devnet blocker.
