# VERIFY-H076: Crank Wallet Balance Logged to Stdout
**Status:** NOT_FIXED (accepted risk)
**Round:** 3
**Date:** 2026-03-12

## Evidence
- No commits referencing H076 since 2026-03-09.
- `scripts/crank/crank-runner.ts` still logs wallet balance when low. No changes to this file in recent commits.
- The crank wallet is an operational hot wallet whose public key is already visible on-chain.

## Assessment
Accepted risk. Balance disclosure of a public operational wallet in Railway server logs is negligible risk. The public key is already on-chain and visible to anyone. Server logs are access-controlled by Railway's platform. No change from Round 2.
