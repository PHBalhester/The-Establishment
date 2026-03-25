---
phase: 72-sell-back-tax-escrow
plan: 01
subsystem: trading
tags: [anchor, rust, bonding-curve, sell, tax-escrow, token-2022, transfer-hook, solvency]

# Dependency graph
requires:
  - phase: 71-curve-foundation
    provides: "CurveState, math functions (calculate_sol_for_tokens, get_current_price), constants (SELL_TAX_BPS, TAX_ESCROW_SEED), error codes, events, purchase instruction pattern"
provides:
  - "Sell instruction implementing spec Section 8.6 (reverse integral, 15% tax, solvency check)"
  - "VaultInsolvency error variant for defense-in-depth solvency assertion"
  - "Sell dispatch in lib.rs with Transfer Hook lifetime annotations"
affects: [72-02 (property tests), 73 (graduation/refund), 74 (integration testing)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Direct lamport manipulation for program-owned PDA SOL transfers"
    - "Manual invoke (user-signed) for Token-2022 Transfer Hook on sell direction"
    - "Post-state solvency assertion with rent-exempt minimum adjustment"
    - "Ceil-rounded BPS tax computation (protocol-favored)"

key-files:
  created:
    - "programs/bonding_curve/src/instructions/sell.rs"
  modified:
    - "programs/bonding_curve/src/error.rs"
    - "programs/bonding_curve/src/instructions/mod.rs"
    - "programs/bonding_curve/src/lib.rs"

key-decisions:
  - "VaultInsolvency as dedicated error variant (not reusing Overflow) for immediate identifiability in logs/audits"
  - "Ceil-rounded tax using BPS (CONTEXT.md override of spec floor pseudocode)"
  - "Manual invoke (not invoke_signed) for sell token transfer -- user is real signer, not PDA"
  - "Solvency check uses Rent::get()?.minimum_balance(0) dynamically, not hardcoded"
  - "sol_returned tracks gross SOL (before tax) preserving identity: vault = sol_raised - sol_returned"

patterns-established:
  - "Sell instruction as structural mirror of purchase with reversed transfers + tax deduction"
  - "invoke (not invoke_signed) for user-signed Token-2022 transfers with Transfer Hook"
  - "Post-state solvency invariant: vault_balance >= integral(0, tokens_sold) - rent_exempt_min"

# Metrics
duration: 6min
completed: 2026-03-04
---

# Phase 72 Plan 01: Sell Instruction Summary

**Sell instruction with reverse integral pricing, 15% ceil-rounded tax to escrow PDA, direct lamport SOL transfers, and post-state solvency assertion**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-04T17:52:11Z
- **Completed:** 2026-03-04T17:58:00Z
- **Tasks:** 2/2
- **Files modified:** 4

## Accomplishments

- Complete sell instruction implementing all 18 steps from spec Section 8.6
- VaultInsolvency error variant for defense-in-depth solvency assertion
- BPF build passes (no stack overflow with Box'd InterfaceAccount types)
- All 27 existing tests pass including 500K-iteration property tests (no regressions)
- 319-line sell.rs with comprehensive documentation matching purchase.rs quality

## Task Commits

Each task was committed atomically:

1. **Task 1: Add VaultInsolvency error variant** - `4c99c14` (feat)
2. **Task 2: Implement sell instruction** - `4e904a3` (feat)

## Files Created/Modified

- `programs/bonding_curve/src/instructions/sell.rs` - Complete sell instruction: accounts struct (9 accounts), handler with 18 steps (validate, compute, transfer, state update, solvency check, events)
- `programs/bonding_curve/src/error.rs` - Added VaultInsolvency error variant for solvency defense-in-depth
- `programs/bonding_curve/src/instructions/mod.rs` - Added sell module registration and re-export
- `programs/bonding_curve/src/lib.rs` - Added sell dispatch with lifetime annotations for remaining_accounts

## Decisions Made

1. **VaultInsolvency as dedicated error variant** -- A defense-in-depth assertion that should NEVER fire in production. Dedicated error code makes it immediately identifiable in logs and audits vs reusing generic Overflow. Zero runtime cost (one more enum variant).

2. **Ceil-rounded tax** -- CONTEXT.md explicitly overrides spec Section 8.6 pseudocode (`sol_gross * 15 / 100` floor) with ceil rounding using BPS: `(sol_gross * 1500 + 9999) / 10000`. Protocol-favored on both the integral (buy side) and the tax deduction (sell side).

3. **Manual invoke for token transfer** -- Uses `invoke` (not `invoke_signed`) since the user is a real signer. Matches the manual CPI pattern from purchase.rs for consistency, ensuring identical Transfer Hook account resolution behavior.

4. **Dynamic rent-exempt minimum** -- Solvency check uses `Rent::get()?.minimum_balance(0)` rather than hardcoding ~890,880 lamports. Future-proof against Solana parameter changes.

5. **sol_returned tracks gross SOL** -- Per Phase 70-02 decision. This preserves the identity `vault_balance = sol_raised - sol_returned`, making auditing straightforward.

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None -- all code compiled on first attempt, BPF build passed without stack overflow issues (Boxing pattern from purchase.rs applied correctly).

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness

- Sell instruction compiles for BPF and implements complete spec Section 8.6 flow
- Ready for Phase 72 Plan 02: property testing with sell-specific invariants (buy/sell round-trip loss, vault solvency across mixed sequences, tax escrow accumulation)
- All existing Phase 71 property tests (500K iterations) continue to pass
- No blockers or concerns

---
*Phase: 72-sell-back-tax-escrow*
*Completed: 2026-03-04*
