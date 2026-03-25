# VERIFY-H039: skipPreflight in Bonding Curve Forms
**Status:** NOT_FIXED (accepted risk)
**Round:** 3
**Date:** 2026-03-12

## Evidence
`BuyForm.tsx:189` and `SellForm.tsx:198` both still use `skipPreflight: true`. No changes to these lines since last round. This is the same pattern used across the codebase for v0 transactions on devnet (documented in MEMORY.md).

## Assessment
Accepted risk. skipPreflight is required on devnet due to simulation rejecting v0 transactions with "Blockhash not found". Will be revisited for mainnet deployment (tracked in mainnet checklist).
