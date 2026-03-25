---
phase: 18-tax-program-core
plan: 01
subsystem: tax
tags: [anchor, rust, tax-program, scaffold, error-codes, events]

# Dependency graph
requires:
  - phase: 13-amm-access-control
    provides: swap_authority PDA pattern and CPI verification
provides:
  - Tax Program scaffold with Cargo.toml
  - TaxError enum with 11 error codes
  - TaxedSwap event with 12 fields
  - helpers/ module structure for tax_math
  - Program ID registered in Anchor.toml
affects: [18-02, 18-03, 18-04, 19-profit-pool-swap, 20-swap-exempt]

# Tech tracking
tech-stack:
  added: [anchor-lang 0.32.1, anchor-spl 0.32.1]
  patterns:
    - "Stateless routing layer (no state accounts, reads from Epoch Program)"
    - "swap_authority PDA for CPI signing"

key-files:
  created:
    - programs/tax-program/Cargo.toml
    - programs/tax-program/src/lib.rs
    - programs/tax-program/src/constants.rs
    - programs/tax-program/src/errors.rs
    - programs/tax-program/src/events.rs
    - programs/tax-program/src/helpers/mod.rs
    - programs/tax-program/src/helpers/tax_math.rs
  modified:
    - Anchor.toml

key-decisions:
  - "Program ID FV3kWDtSRDHTdd9fK9L1fkqdWis7Sts5x7nNS4uoSiiu synced from target keypair"
  - "MICRO_TAX_THRESHOLD = 4 lamports (below this, all tax to staking)"
  - "STAKING_BPS = 7500, CARNAGE_BPS = 2400, treasury gets remainder"

patterns-established:
  - "Tax constants match AMM's SWAP_AUTHORITY_SEED for CPI compatibility"
  - "PoolType enum: SolCrime, SolFraud for events"
  - "SwapDirection enum: Buy, Sell for events"

# Metrics
duration: 5min
completed: 2026-02-06
---

# Phase 18 Plan 01: Tax Program Scaffold Summary

**Tax Program scaffold with TaxError (11 codes), TaxedSwap event (12 fields), and constants for 75/24/1% distribution split**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-06T10:23:22Z
- **Completed:** 2026-02-06T10:28:36Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Created Tax Program Cargo.toml with anchor-lang 0.32.1, anchor-spl 0.32.1
- Registered tax_program in Anchor.toml with program ID
- Defined all 11 TaxError codes per Tax_Pool_Logic_Spec.md Section 19
- Defined TaxedSwap event with all 12 fields per Section 20
- Established constants for distribution split (STAKING_BPS, CARNAGE_BPS, MICRO_TAX_THRESHOLD)
- Created helpers/ module structure ready for tax_math implementation

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Tax Program Cargo.toml and register in Anchor.toml** - `ab184da` (feat)
2. **Task 2: Create lib.rs, constants.rs, errors.rs, events.rs, helpers/mod.rs** - `4dd9c95` (chore) + `656f352` (fix)

## Files Created/Modified

- `programs/tax-program/Cargo.toml` - Program dependencies (anchor-lang, anchor-spl)
- `programs/tax-program/src/lib.rs` - Program entry point with declare_id
- `programs/tax-program/src/constants.rs` - SWAP_AUTHORITY_SEED, BPS_DENOMINATOR, distribution percentages
- `programs/tax-program/src/errors.rs` - TaxError enum with 11 error codes
- `programs/tax-program/src/events.rs` - TaxedSwap event, PoolType, SwapDirection enums
- `programs/tax-program/src/helpers/mod.rs` - Module declaration for tax_math
- `programs/tax-program/src/helpers/tax_math.rs` - Placeholder for Plan 02 implementation
- `Anchor.toml` - Added tax_program entry

## Decisions Made

- Used FV3kWDtSRDHTdd9fK9L1fkqdWis7Sts5x7nNS4uoSiiu as program ID (synced from target keypair)
- MICRO_TAX_THRESHOLD = 4 lamports per 18-CONTEXT.md discretion (below this, all tax goes to staking)
- Distribution split constants: STAKING_BPS = 7500, CARNAGE_BPS = 2400, treasury gets remainder

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] anchor keys sync updated program IDs**
- **Found during:** Task 1 (Anchor.toml registration)
- **Issue:** Target keypair had different ID than initially registered
- **Fix:** Ran `anchor keys sync` to align Anchor.toml and lib.rs with actual target keypair
- **Files modified:** Anchor.toml, programs/tax-program/src/lib.rs
- **Verification:** `anchor build -p tax-program` succeeds
- **Committed in:** 656f352

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Required for build to succeed. No scope creep.

## Issues Encountered

- Previous session had already created partial scaffold (commit 4dd9c95) - work was completed, just needed sync fix

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Tax Program scaffold compiles with `anchor build -p tax-program`
- All type definitions in place for swap instructions
- helpers/tax_math.rs ready for calculate_tax and split_distribution implementation in Plan 02
- TaxError and TaxedSwap match spec exactly

---
*Phase: 18-tax-program-core*
*Completed: 2026-02-06*
