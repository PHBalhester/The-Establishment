---
phase: 106-vault-convert-all
plan: 04
subsystem: deployment-testing
tags: [solana, devnet, vault, convert-v2, wallet-simulation, multi-hop, split-route, blowfish]

# Dependency graph
requires:
  - phase: 106-vault-convert-all
    plan: 01
    provides: "convert_v2 on-chain instruction with sentinel balance reading"
  - phase: 106-vault-convert-all
    plan: 02
    provides: "Client swap builders using convertV2 with multi-hop convert-all mode"
  - phase: 106-vault-convert-all
    plan: 03
    provides: "SOS diff-audit clearing convert_v2 for devnet deployment"
provides:
  - "Vault convert_v2 deployed in-place on devnet (program ID unchanged)"
  - "8/8 multi-hop routes verified with zero intermediate token leakage"
  - "Split-route greedy consumption bug found and fixed (a11d9b8)"
  - "Backwards compatibility confirmed: convert and convertV2 both present in IDL"
affects: [106-05-mainnet-upgrade, 107-jupiter-adapter]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "In-place program upgrade via solana program deploy --program-id (mirrors mainnet Squads upgrade path)"
    - "Split-route vault boundary: use exact amounts at leg start, convert-all only after preceding AMM step"

key-files:
  created: []
  modified:
    - "app/lib/swap/multi-hop-builder.ts (split-route fix)"

key-decisions:
  - "Split-route vault steps at leg boundaries use exact quoted amounts, not convert-all"
  - "Large swap Blowfish preview deferred to mainnet (devnet simulation unreliable)"
  - "Phase 106.1 inserted mid-testing to centralize devnet skipPreflight override"

patterns-established:
  - "Vault convert-all only after preceding AMM step within same leg (prevents greedy balance consumption in split routes)"

requirements-completed: [VAULT-05]

# Metrics
duration: 6h (including manual wallet testing and Phase 106.1 insertion)
completed: 2026-03-26
---

# Phase 106 Plan 04: Devnet In-Place Upgrade + Wallet Simulation Test Matrix Summary

**Vault convert_v2 deployed in-place on devnet, 8/8 multi-hop routes verified with zero intermediate token leakage, split-route greedy consumption bug found and fixed**

## Performance

- **Duration:** ~6 hours (includes manual wallet testing, Phase 106.1 insertion, and split-route bug fix)
- **Started:** 2026-03-26T10:12:00Z
- **Completed:** 2026-03-26T16:06:42Z
- **Tasks:** 2 (1 auto + 1 checkpoint:human-verify)
- **Files modified:** 1 (plus IDL sync and devnet deploy artifacts)

## Accomplishments
- Vault program upgraded in-place on devnet with convert_v2 instruction (program ID unchanged, mirrors mainnet upgrade path)
- All 8 multi-hop route combinations verified on-chain by user with zero intermediate token leakage:
  - Direct: SOL->CRIME, CRIME->PROFIT, PROFIT->FRAUD
  - 2-hop: SOL->FRAUD->PROFIT, PROFIT->CRIME->SOL, SOL->CRIME->PROFIT
  - 4-step split: SOL->CRIME/FRAUD->PROFIT, PROFIT->CRIME/FRAUD->SOL
- Split-route greedy consumption bug discovered and fixed during testing (vault convert-all at leg boundaries consumed entire balance, starving leg 2)
- Backwards compatibility confirmed: both convert and convertV2 instructions present in deployed program IDL

## Task Commits

Each task was committed atomically:

1. **Task 1: Build with devnet feature flag and deploy in-place upgrade to devnet** - `8976cdd` (feat)
2. **Task 2: Wallet simulation test matrix** - checkpoint:human-verify, approved by user

**Bug fix during testing:** `a11d9b8` (fix) - split-route vault convert-all greedy consumption

## Files Created/Modified
- `app/idl/conversion_vault.json` - IDL synced with both convert and convertV2 instructions
- `app/idl/types/conversion_vault.ts` - TypeScript types synced
- `app/lib/swap/multi-hop-builder.ts` - Split-route fix: vault steps at leg boundaries use exact amounts instead of convert-all

## Decisions Made
- Split-route vault steps at leg boundaries must use exact quoted amounts (not convert-all mode). Convert-all only applies to vault steps that receive tokens from a preceding AMM step within the same leg.
- Large swap Blowfish preview verification deferred to mainnet -- devnet simulation does not support this reliably.
- Phase 106.1 was inserted and completed mid-testing to centralize devnet skipPreflight override in useProtocolWallet, which was blocking all devnet transaction submission.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Split-route vault convert-all greedy consumption**
- **Found during:** Task 2 (wallet simulation testing)
- **Issue:** In split routes (4-step), vault steps at the start of each leg used convert-all mode (amount_in=0), which reads the user's entire balance. Leg 1's vault consumed everything, leaving 0 tokens for leg 2 (ZeroAmount error).
- **Fix:** Only use convert-all for vault steps that receive tokens from a preceding AMM step within the same leg. Vault steps at leg boundaries use exact quoted amounts instead.
- **Files modified:** app/lib/swap/multi-hop-builder.ts
- **Verification:** 4-step split routes (SOL->CRIME/FRAUD->PROFIT and PROFIT->CRIME/FRAUD->SOL) both complete with zero leftover intermediaries
- **Committed in:** `a11d9b8`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Critical bug fix -- split routes would have failed without it. No scope creep.

## Issues Encountered

- **Devnet TX submission blocked:** All devnet frontend transactions were failing due to preflight simulation errors. This triggered the insertion of Phase 106.1 (centralized skipPreflight override in useProtocolWallet). Resolved before wallet testing could proceed.
- **Blowfish preview unavailable on devnet:** Wallet simulation preview for large swaps cannot be verified on devnet (Blowfish simulation infrastructure does not support devnet). Deferred to mainnet verification.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All Phase 106 requirements (VAULT-01 through VAULT-06) verified
- convert_v2 ready for mainnet upgrade via Squads multisig
- Phase 107 (Jupiter AMM Adapter SDK) can proceed -- vault convert-all is deployed and working
- Blowfish large-swap preview must be verified on mainnet before public announcement

---
*Phase: 106-vault-convert-all*
*Completed: 2026-03-26*
