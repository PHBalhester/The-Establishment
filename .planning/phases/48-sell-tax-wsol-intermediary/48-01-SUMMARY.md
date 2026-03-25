---
phase: 48-sell-tax-wsol-intermediary
plan: 01
subsystem: on-chain
tags: [rust, anchor, wsol, spl-token, pda, tax, sell-flow, close-account]

# Dependency graph
requires:
  - phase: 46-account-validation-hardening
    provides: "Security-hardened account constraints with @ CustomError pattern"
  - phase: 18-21-tax-program
    provides: "swap_sol_sell instruction, tax_math helpers, constants"
provides:
  - "WSOL intermediary PDA constant and derivation helper"
  - "InsufficientOutput error for tax-exceeds-output guard"
  - "Rewritten swap_sol_sell with transfer-close-distribute-reinit tax flow"
  - "initialize_wsol_intermediary admin instruction"
  - "Updated IDL with 21-account SwapSolSell and new init instruction"
affects:
  - "48-02 (client-side: swap-builders.ts, deploy scripts, ALT update)"
  - "51-test-hardening (swap_sol_sell integration tests need intermediary)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Transfer-Close-Distribute-Reinit: atomic WSOL->SOL unwrap via close_account + create_account cycle"
    - "InitializeAccount3 (discriminator 18): owner-as-data token init without rent sysvar"

key-files:
  created:
    - "programs/tax-program/src/instructions/initialize_wsol_intermediary.rs"
  modified:
    - "programs/tax-program/src/constants.rs"
    - "programs/tax-program/src/errors.rs"
    - "programs/tax-program/src/instructions/swap_sol_sell.rs"
    - "programs/tax-program/src/instructions/mod.rs"
    - "programs/tax-program/src/lib.rs"

key-decisions:
  - "WSOL intermediary is a PDA (seeds=[wsol_intermediary]) closed+recreated each sell -- Solana supports same-TX close-and-recreate"
  - "swap_authority PDA receives unwrapped lamports and distributes to 3 destinations via invoke_signed system transfers"
  - "InitializeAccount3 used instead of InitializeAccount to avoid rent sysvar account"
  - "InsufficientOutput guard added in Phase 48 (not deferred to Phase 49) to prevent zero-output sells"
  - "Rent lamports recycle: close sends tax+rent to swap_authority; distribute tax; use retained rent to recreate intermediary"

patterns-established:
  - "Transfer-Close-Distribute-Reinit: protocol extracts tax from WSOL output atomically without requiring user native SOL"
  - "InitializeAccount3 for PDA token account creation without rent sysvar dependency"

# Metrics
duration: 8min
completed: 2026-02-19
---

# Phase 48 Plan 01: On-Chain WSOL Intermediary Tax Flow Summary

**Sell tax now deducted from WSOL swap output via transfer-close-distribute-reinit PDA cycle, eliminating native SOL requirement for sellers**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-19T22:51:22Z
- **Completed:** 2026-02-19T22:59:06Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Rewrote swap_sol_sell handler to extract tax from WSOL output instead of user's native SOL balance
- Added WSOL intermediary PDA constant, derivation helper, and InsufficientOutput error variant
- Created initialize_wsol_intermediary admin instruction for one-time protocol setup
- IDL regenerated with 21-account SwapSolSell and 6-account initializeWsolIntermediary

## Task Commits

Each task was committed atomically:

1. **Task 1: Add WSOL intermediary constant, PDA helper, and error variant** - `3502590` (feat)
2. **Task 2: Rewrite swap_sol_sell handler and accounts struct for WSOL intermediary flow** - `8e3e6bf` (feat)
3. **Task 3: Add initialize_wsol_intermediary instruction to Tax Program** - `3a78458` (feat)

## Files Created/Modified

- `programs/tax-program/src/constants.rs` - Added WSOL_INTERMEDIARY_SEED constant and get_wsol_intermediary_pda() helper
- `programs/tax-program/src/errors.rs` - Added InsufficientOutput error variant for tax-exceeds-output guard
- `programs/tax-program/src/instructions/swap_sol_sell.rs` - Rewritten sell handler with transfer-close-distribute-reinit pattern, wsol_intermediary in accounts struct
- `programs/tax-program/src/instructions/initialize_wsol_intermediary.rs` - New admin instruction to create WSOL intermediary PDA
- `programs/tax-program/src/instructions/mod.rs` - Added module export for initialize_wsol_intermediary
- `programs/tax-program/src/lib.rs` - Added instruction entry point for initialize_wsol_intermediary

## Decisions Made

1. **InsufficientOutput guard in Phase 48** - Added `require!(net_output > 0, TaxError::InsufficientOutput)` immediately rather than deferring to Phase 49. Without this, the transfer-to-intermediary step could try to transfer more WSOL than the user received.

2. **InitializeAccount3 over InitializeAccount** - Uses SPL Token discriminator 18 which takes owner as instruction data (32 bytes) instead of as an account. Eliminates the need for a rent sysvar account in the struct, keeping the account count minimal.

3. **AccountInfo for wsol_intermediary (not InterfaceAccount)** - Since the account is closed and recreated within the handler, Anchor's deserialization would fail mid-instruction. Raw AccountInfo with PDA seed validation is the correct approach.

4. **swap_authority made mutable** - Receives lamports from close_account (WSOL unwrap) and sends them via system transfers to tax destinations. Was previously read-only.

5. **Seed length fix** - Plan specified 18 chars for "wsol_intermediary" but actual length is 17. Corrected in unit test.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed seed length assertion in unit test**
- **Found during:** Task 1 (constants unit test)
- **Issue:** Plan specified `assert_eq!(WSOL_INTERMEDIARY_SEED.len(), 18)` but "wsol_intermediary" is 17 characters
- **Fix:** Changed assertion to `assert_eq!(WSOL_INTERMEDIARY_SEED.len(), 17)`
- **Files modified:** programs/tax-program/src/constants.rs
- **Verification:** Test passes with correct length
- **Committed in:** 3502590 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug in plan specification)
**Impact on plan:** Trivial -- off-by-one in plan's suggested test value. No scope creep.

## Issues Encountered

None -- all three tasks compiled and tested cleanly on first attempt.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness

- On-chain Tax Program changes are feature-complete
- IDL has been regenerated with both instructions
- Ready for Plan 02 (client-side): swap-builders.ts needs wsol_intermediary PDA in accountsStrict, deploy scripts need initialize_wsol_intermediary call, ALT needs the new address
- Integration test updates needed in Phase 51 (tests currently reference old 20-account struct)

---
*Phase: 48-sell-tax-wsol-intermediary*
*Completed: 2026-02-19*
