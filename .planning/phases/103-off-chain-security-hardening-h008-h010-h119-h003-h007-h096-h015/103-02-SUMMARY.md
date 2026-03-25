---
phase: 103
plan: 02
status: complete
started: 2026-03-23
completed: 2026-03-23
---

## Summary

Closed Bulwark findings H119 (webhook decode fail-open) and H096 (missing bounds validation) by making the Helius webhook handler fail-closed and adding per-account-type validation before storage.

## What Changed

### Task 1: Per-account-type bounds validators
- Created `app/lib/webhook-validators.ts` with `validateDecodedAccount()` export
- 5 account-type validators: EpochState (BPS [0,10000]), PoolState (reserves >=0, denominator >0), CarnageFundState (balances >=0), StakePool (staked/rewards >=0), CurveState (price/sold/raised >=0)
- `numericValue()` helper handles both plain numbers and `{ __bigint }` tags from anchorToJson

### Task 2: Fail-closed decode + bounds validation in webhook
- Decode error catch block: removed raw data storage, now logs + fires Sentry + continues
- Missing decode info/data: removed raw fallback storage, now warns + continues
- Added bounds validation gate between anchorToJson() and setAccountState()
- Sentry alerts on both decode failures and bounds validation rejections

## Key Files

### key-files.created
- `app/lib/webhook-validators.ts` — Per-account-type bounds validators

### key-files.modified
- `app/app/api/webhooks/helius/route.ts` — Fail-closed decode + bounds validation

## Commits
- `d2890a2` — feat(103-02): create per-account-type bounds validators
- `3b55828` — fix(103-02): webhook fail-closed on decode errors and bounds validation

## Deviations
None.

## Self-Check: PASSED
- [x] Decode failures do NOT call setAccountState
- [x] Sentry fires on decode failure and bounds rejection
- [x] Bounds validation runs before every setAccountState call
- [x] CarnageSolVault path unchanged
- [x] Build passes with zero TypeScript errors
