---
phase: 30-program-id-fixes
plan: 03
subsystem: testing, build-verification
tags: [anchor-build, program-ids, litesvm, cpi-testing, verification]

# Dependency graph
requires:
  - phase: 30-01
    provides: Reconciled keypairs and synced declare_id! macros
  - phase: 30-02
    provides: Program ID verification script
provides:
  - All 8 programs compile with consistent IDs
  - Verification script confirms 26/26 checks pass
  - CPI access control tests fixed and passing (12/12)
  - Build artifacts ready for Phase 31+ integration testing
affects: [31-integration-test-infrastructure, 32-cross-program-integration, 33-devnet-deployment]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Test programs must declare_id! to production program ID when deployed at that address (Anchor DeclaredProgramIdMismatch runtime check)"
    - "Verification script supports expectedDeclareId for test programs with intentionally mismatched keypair/declare_id"

key-files:
  created: []
  modified:
    - "programs/mock-tax-program/src/lib.rs"
    - "programs/amm/tests/test_cpi_access_control.rs"
    - "scripts/verify-program-ids.ts"

key-decisions:
  - "Mock Tax Program declare_id! set to real TAX_PROGRAM_ID (FV3k...) so Anchor runtime check passes when deployed at Tax Program address in LiteSVM"
  - "Verification script extended with expectedDeclareId for test-only programs"

patterns-established:
  - "Test mock programs deployed at production addresses must use production declare_id! (Anchor enforces at runtime)"
  - "Pre-existing swap test failures (test_swap_sol_pool, test_swap_profit_pool) deferred -- they predate Phase 13 swap_authority addition"

# Metrics
duration: 42min
completed: 2026-02-09
---

# Phase 30 Plan 03: Build Verification Summary

**All 8 programs build clean, verification script confirms 26/26 ID checks pass, CPI access control tests fixed (12/12), 218 tests passing across all crates**

## Performance

- **Duration:** 42 min
- **Started:** 2026-02-09T23:13:13Z
- **Completed:** 2026-02-09T23:55:18Z
- **Tasks:** 1
- **Files modified:** 3

## Accomplishments

- All 8 programs (5 production + 3 test) compile successfully with `anchor build`
- Verification script (`npm run verify-ids`) reports 26/26 checks passing, `"success": true`
- Fixed CPI access control tests: all 12 tests pass (was 6 failing due to mock_tax_program_id mismatch)
- Zero placeholder or stale program IDs remain in any source file
- All 8 `.so` binaries freshly built in `target/deploy/`

## Verification Results

### Anchor Build
All 8 programs compiled (warnings only, no errors):
- amm.so (416 KB)
- epoch_program.so (411 KB)
- staking.so (371 KB)
- tax_program.so (332 KB)
- transfer_hook.so (285 KB)
- stub_staking.so (207 KB)
- mock_tax_program.so (186 KB)
- fake_tax_program.so (186 KB)

### Program ID Verification
```
26/26 checks passed
- 8 programs: keypair -> declare_id! -> Anchor.toml consistency
- 5 cross-program references: all match
- 0 placeholders found
```

### Test Results (218 pass, 29 pre-existing failures, 2 ignored)

| Test Suite | Pass | Fail | Notes |
|-----------|------|------|-------|
| amm unit tests (math, proptests) | 26 | 0 | |
| amm test_cpi_access_control | 12 | 0 | FIXED in this plan |
| amm test_pool_initialization | 13 | 0 | |
| amm test_transfer_routing | 8 | 0 | |
| amm test_swap_sol_pool | 1 | 7 | Pre-existing: missing swap_authority |
| amm test_swap_profit_pool | 6 | 12 | Pre-existing: missing swap_authority |
| tax-program unit tests | 31 | 0 | |
| tax-program test_carnage_signer_pda | 4 | 0 | |
| tax-program test_swap_exempt | 6 | 0 | 1 ignored |
| tax-program test_swap_profit_buy | 5 | 0 | |
| tax-program test_swap_profit_sell | 5 | 0 | |
| tax-program test_swap_sol_buy | 3 | 5 | Pre-existing: AMM pool vault setup |
| tax-program test_swap_sol_sell | 1 | 5 | Pre-existing: AMM pool vault setup |
| transfer-hook | 11 | 0 | |
| staking unit tests | 38 | 0 | |
| epoch-program | 59 | 0 | 1 ignored |

### Pre-existing Test Failures (29 total, NOT caused by Phase 30)

**AMM swap tests (19 failures):** `test_swap_sol_pool` and `test_swap_profit_pool` were written in Phase 11-12 before Phase 13 added the `swap_authority` PDA requirement. The test instruction builders don't include `swap_authority` as the first account. These will need updating in Phase 31-32 when integration test infrastructure is rebuilt.

**Tax Program SOL swap tests (10 failures):** `test_swap_sol_buy` and `test_swap_sol_sell` fail with `InvalidAccountData` on `pool_vault_b` -- a LiteSVM pool setup issue where the AMM pool vaults are not properly initialized in the test context. Separate from program ID issues.

## Task Commits

Each task was committed atomically:

1. **Task 1: Build all programs and run verification** - `2beabf2` (fix)

**Plan metadata:** (see below)

## Files Created/Modified
- `programs/mock-tax-program/src/lib.rs` - Changed declare_id! to real TAX_PROGRAM_ID for LiteSVM deployment
- `programs/amm/tests/test_cpi_access_control.rs` - Fixed mock_tax_program_id() to return TAX_PROGRAM_ID
- `scripts/verify-program-ids.ts` - Added expectedDeclareId support for test programs

## Decisions Made
- **Mock Tax declare_id! = TAX_PROGRAM_ID:** Anchor enforces `DeclaredProgramIdMismatch` at runtime, so deploying mock_tax_program.so at the Tax Program address requires the mock's declare_id! to match. This is the correct pattern for test programs that simulate production CPI behavior.
- **Verification script expectedDeclareId:** Rather than ignoring mock_tax_program in verification, we added explicit support for documenting the expected mismatch. This maintains full verification coverage while accommodating the test program's intentional override.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed mock_tax_program declare_id! and test mock_tax_program_id()**
- **Found during:** Task 1, Step 3 (cargo test)
- **Issue:** CPI access control tests (6 of 12) failing with ConstraintSeeds error. The mock_tax_program_id() in the test returned the mock keypair ID (9irn...) but the AMM expects TAX_PROGRAM_ID (FV3k...) for swap_authority PDA derivation. Changing only the test ID then caused DeclaredProgramIdMismatch because Anchor checks declare_id! matches runtime program ID.
- **Fix:** (1) Set mock_tax_program declare_id! to TAX_PROGRAM_ID, (2) Set test mock_tax_program_id() to TAX_PROGRAM_ID, (3) Added expectedDeclareId to verification script so mock_tax passes verification
- **Files modified:** programs/mock-tax-program/src/lib.rs, programs/amm/tests/test_cpi_access_control.rs, scripts/verify-program-ids.ts
- **Verification:** All 12 CPI tests pass, verification script 26/26
- **Committed in:** 2beabf2

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Essential fix -- without this, CPI access control tests would be permanently broken and verification script would report failures. Root cause was Plan 30-01 updating mock ID to match keypair without accounting for the AMM's seeds::program constraint.

## Issues Encountered
- Pre-existing test failures (29 tests) discovered across swap test files. These predate Phase 30 and are documented above. They do not affect the Phase 30 success criteria (which focuses on program ID consistency and build verification).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 8 programs build cleanly with consistent, verified program IDs
- Phase 30 success criteria fully met: keypairs reconciled, IDs synced, verification automated, build verified
- Ready for Phase 31 (Integration Test Infrastructure) -- AMM swap tests will need swap_authority added to test helpers
- Ready for Phase 33 (Devnet Deployment) -- all .so binaries are fresh and ID-consistent

---
*Phase: 30-program-id-fixes*
*Completed: 2026-02-09*
