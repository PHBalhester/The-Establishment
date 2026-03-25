---
phase: 80-defense-in-depth
plan: 01
subsystem: security
tags: [anchor, amm, pool-reader, ownership-verification, is-reversed, carnage]

# Dependency graph
requires:
  - phase: 49-security-hardening
    provides: "Original pool_reader.rs raw byte reading pattern"
  - phase: 47-carnage-fund
    provides: "execute_carnage and execute_carnage_atomic with pool accounts"
provides:
  - "Owner-verified pool_reader.rs rejecting non-AMM-owned accounts"
  - "is_reversed detection returning (sol_reserve, token_reserve) regardless of canonical ordering"
  - "Anchor-level owner constraints on Carnage pool accounts"
affects: [mainnet-deploy, devnet-redeploy]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pool account ownership verification before reading reserve bytes"
    - "NATIVE_MINT comparison for canonical mint ordering detection"
    - "Anchor owner constraint on CPI passthrough accounts"

key-files:
  created: []
  modified:
    - "programs/tax-program/src/helpers/pool_reader.rs"
    - "programs/tax-program/src/errors.rs"
    - "programs/tax-program/src/instructions/swap_sol_buy.rs"
    - "programs/tax-program/src/instructions/swap_sol_sell.rs"
    - "programs/epoch-program/src/instructions/execute_carnage.rs"
    - "programs/epoch-program/src/instructions/execute_carnage_atomic.rs"

key-decisions:
  - "Used function-based native_mint() with Pubkey::from_str instead of const, matching existing constants.rs pattern"
  - "Callers renamed destructured vars from (reserve_a, reserve_b) to (sol_reserve, token_reserve) for clarity"

patterns-established:
  - "Pool reader ownership check: require!(*pool_info.owner == amm_program_id()) before any byte reads"
  - "is_reversed detection: read mint_a from bytes [9..41], compare to NATIVE_MINT, swap reserves if needed"

requirements-completed: [DEF-01, DEF-02, DEF-06]

# Metrics
duration: 4min
completed: 2026-03-08
---

# Phase 80 Plan 01: Pool Reader Hardening Summary

**Owner-verified pool_reader.rs with is_reversed detection and Anchor-level pool owner constraints on Carnage accounts**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-08T10:55:55Z
- **Completed:** 2026-03-08T10:59:09Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- read_pool_reserves() now rejects spoofed pool accounts not owned by AMM program (DEF-01)
- read_pool_reserves() returns (sol_reserve, token_reserve) regardless of canonical mint ordering via is_reversed detection (DEF-02)
- Carnage pool accounts (crime_pool, fraud_pool) in both execute_carnage.rs and execute_carnage_atomic.rs have Anchor owner constraints rejecting non-AMM accounts before instruction body (DEF-06)

## Task Commits

Each task was committed atomically:

1. **Task 1: Pool reader ownership verification and is_reversed detection** - `bc68261` (feat)
2. **Task 2: Carnage pool owner constraint** - `4c6e9cd` (feat)

## Files Created/Modified
- `programs/tax-program/src/helpers/pool_reader.rs` - Added AMM ownership check and NATIVE_MINT-based is_reversed detection
- `programs/tax-program/src/errors.rs` - Added InvalidPoolOwner error variant
- `programs/tax-program/src/instructions/swap_sol_buy.rs` - Updated destructured variable names to (sol_reserve, token_reserve)
- `programs/tax-program/src/instructions/swap_sol_sell.rs` - Updated destructured variable names to (sol_reserve, token_reserve)
- `programs/epoch-program/src/instructions/execute_carnage.rs` - Added owner = amm_program_id() on crime_pool and fraud_pool
- `programs/epoch-program/src/instructions/execute_carnage_atomic.rs` - Added owner = amm_program_id() on crime_pool and fraud_pool

## Decisions Made
- Used `Pubkey::from_str("So111...")` via a `native_mint()` function rather than a const, because `pubkey!` macro was unavailable and this matches the existing pattern in constants.rs
- Verified both swap callers already assume (SOL, token) ordering, so the is_reversed change is backward-compatible without caller logic changes (only variable rename for clarity)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Used Pubkey::from_str instead of pubkey! macro for NATIVE_MINT**
- **Found during:** Task 1 (pool_reader.rs)
- **Issue:** `anchor_lang::solana_program::pubkey!` macro not available in this Anchor version
- **Fix:** Used `Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap()` in a `native_mint()` function
- **Files modified:** programs/tax-program/src/helpers/pool_reader.rs
- **Verification:** cargo build -p tax-program compiles cleanly
- **Committed in:** bc68261 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Trivial syntax adaptation. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Pool reader hardening complete, defense-in-depth layer active
- Both tax-program and epoch-program compile cleanly
- Ready for remaining 80-02 and 80-03 plans

---
*Phase: 80-defense-in-depth*
*Completed: 2026-03-08*
