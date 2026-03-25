---
phase: 13-access-control-cpi-integration
plan: 01
subsystem: amm
tags: [anchor, cpi, pda, access-control, invoke_signed, seeds::program]

# Dependency graph
requires:
  - phase: 12-profit-pool-swaps-and-swap-validation
    provides: Working swap_sol_pool and swap_profit_pool instructions
provides:
  - swap_authority PDA constraint on both swap instructions
  - TAX_PROGRAM_ID constant for CPI authorization
  - Mock Tax Program with execute_swap using invoke_signed
  - Fake Tax Program for negative testing (different program ID)
affects: [13-02-access-control-tests, tax-program, future-devnet]

# Tech tracking
tech-stack:
  added: []
  patterns: [seeds::program cross-program PDA validation, invoke_signed CPI pattern]

key-files:
  created:
    - programs/mock-tax-program/src/lib.rs
    - programs/mock-tax-program/Cargo.toml
    - programs/fake-tax-program/src/lib.rs
    - programs/fake-tax-program/Cargo.toml
    - keypairs/mock-tax-keypair.json
    - keypairs/fake-tax-keypair.json
  modified:
    - programs/amm/src/constants.rs
    - programs/amm/src/errors.rs
    - programs/amm/src/instructions/swap_sol_pool.rs
    - programs/amm/src/instructions/swap_profit_pool.rs
    - Anchor.toml

key-decisions:
  - "TAX_PROGRAM_ID set to Mock Tax Program ID for testing (J5CK3BiYwiQtt7Yfx3PLNrFr7YWCVGrskXiGvtYBqd5W)"
  - "swap_authority placed first in accounts struct (before pool)"
  - "Single InvalidSwapAuthority error - seeds::program constraint provides specific Anchor errors"

patterns-established:
  - "seeds::program = TAX_PROGRAM_ID: Cross-program PDA validation pattern"
  - "invoke_signed CPI: How authorized programs call AMM via PDA signature"

# Metrics
duration: 6min
completed: 2026-02-04
---

# Phase 13 Plan 01: Access Control Foundation Summary

**swap_authority PDA constraint on AMM swap instructions with Mock/Fake Tax Programs for CPI testing**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-04T22:33:00Z
- **Completed:** 2026-02-04T22:39:00Z
- **Tasks:** 3
- **Files modified:** 11

## Accomplishments

- Added swap_authority Signer account with seeds::program constraint to both swap instructions
- Created Mock Tax Program that derives and signs swap_authority PDA via invoke_signed
- Created Fake Tax Program (different ID) for negative testing of access control
- AMM now rejects direct user calls - only Tax Program CPI is authorized

## Task Commits

Each task was committed atomically:

1. **Task 1: Add TAX_PROGRAM_ID constant and access control errors** - `4eaf8c2` (feat)
2. **Task 2: Add swap_authority account to both swap instructions** - `3ad1745` (feat)
3. **Task 3: Create mock-tax-program and fake-tax-program** - `38ea9d7` (feat)

## Files Created/Modified

**Created:**
- `programs/mock-tax-program/src/lib.rs` - Mock Tax Program with execute_swap CPI instruction
- `programs/mock-tax-program/Cargo.toml` - Mock Tax Program dependencies
- `programs/fake-tax-program/src/lib.rs` - Fake Tax Program (same interface, different ID)
- `programs/fake-tax-program/Cargo.toml` - Fake Tax Program dependencies
- `keypairs/mock-tax-keypair.json` - Program keypair for Mock Tax
- `keypairs/fake-tax-keypair.json` - Program keypair for Fake Tax

**Modified:**
- `programs/amm/src/constants.rs` - Added TAX_PROGRAM_ID and SWAP_AUTHORITY_SEED
- `programs/amm/src/errors.rs` - Added InvalidSwapAuthority error
- `programs/amm/src/instructions/swap_sol_pool.rs` - Added swap_authority account
- `programs/amm/src/instructions/swap_profit_pool.rs` - Added swap_authority account
- `Anchor.toml` - Added mock_tax_program and fake_tax_program entries

## Decisions Made

1. **TAX_PROGRAM_ID = Mock Tax Program ID** - For testing, AMM expects swaps from Mock Tax Program (J5CK3BiYwiQtt7Yfx3PLNrFr7YWCVGrskXiGvtYBqd5W). Production will update to real Tax Program ID.

2. **swap_authority placed first in accounts struct** - Before pool account. This ensures consistent account ordering for CPI callers.

3. **Single error variant (InvalidSwapAuthority)** - The seeds::program constraint provides specific Anchor errors on mismatch. A single error for "not valid Tax Program CPI" is sufficient.

4. **Generated keypairs stored in keypairs/** - Alongside existing devnet wallet for consistent key management.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- **Invalid pubkey length** - Initial plan used "MockTax1111111111111111111111111111111111" which is not a valid base58 pubkey (30 bytes instead of 32). Fixed by generating real keypairs with solana-keygen.

## Next Phase Readiness

- All structural changes complete - AMM requires swap_authority from TAX_PROGRAM_ID
- Mock Tax Program compiles with invoke_signed CPI pattern
- Fake Tax Program ready for negative testing
- Ready for Plan 02: CPI integration tests

**Blockers:** None

---
*Phase: 13-access-control-cpi-integration*
*Completed: 2026-02-04*
