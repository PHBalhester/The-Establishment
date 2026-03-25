---
phase: 31-integration-test-infrastructure
plan: 01
subsystem: testing
tags: [typescript, anchor, pda-seeds, token-2022, spl-token, test-infrastructure]

# Dependency graph
requires:
  - phase: 30-program-id-fixes
    provides: "Verified program IDs and cross-references across all 5 programs"
provides:
  - "Shared PDA seed constants matching all 5 on-chain programs"
  - "PDA derivation helpers (derivePoolPDA, deriveVaultPDAs, deriveWhitelistEntryPDA)"
  - "Role-based test wallet factory (trader, staker, admin, attacker)"
  - "Anchor.toml test-integration script for isolated validator instance"
affects: [31-02-protocol-init-helper, 31-03-smoke-tests, 32-cross-program-wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Centralized PDA seed constants (Buffer.from) mirroring on-chain b\"\" literals"
    - "Role-based wallet factory pattern with Token-2022 + standard SPL Token accounts"
    - "Separate Anchor.toml test scripts per singleton-PDA-conflicting test suites"

key-files:
  created:
    - tests/integration/helpers/constants.ts
    - tests/integration/helpers/test-wallets.ts
  modified:
    - Anchor.toml

key-decisions:
  - "Token accounts do NOT need Transfer Hook whitelisting -- pool vaults (whitelisted in protocol-init) satisfy the one-party-whitelisted requirement"
  - "WSOL uses TOKEN_PROGRAM_ID (standard SPL Token), not Token-2022 -- native SOL has no transfer hook"
  - "Program IDs are passed as parameters to PDA derivation helpers, not hardcoded -- works in any test context"

patterns-established:
  - "Central constants import: all integration tests import from tests/integration/helpers/constants.ts"
  - "Wallet factory: createTestWallets(connection, mintAuthority, mints) returns 4 pre-funded role wallets"
  - "Test isolation: anchor test --run test-integration uses separate validator to avoid PDA conflicts"

# Metrics
duration: 3min
completed: 2026-02-10
---

# Phase 31 Plan 01: Test Infrastructure Foundation Summary

**PDA seed constants for all 5 programs, role-based wallet factory with Token-2022 accounts, and Anchor.toml test-integration script**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-10T17:03:15Z
- **Completed:** 2026-02-10T17:06:01Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Created shared constants.ts with all PDA seeds exactly matching on-chain programs (staking, transfer-hook, AMM, tax, epoch)
- Created test-wallets.ts factory producing 4 role-based wallets with proper Token-2022 accounts and SOL airdrops
- Added test-integration script to Anchor.toml for isolated integration test execution

## Task Commits

Each task was committed atomically:

1. **Task 1: Create shared constants and test wallet helper modules** - `a4eaa56` (feat)
2. **Task 2: Add test-integration script to Anchor.toml** - `148e18c` (chore)

## Files Created/Modified
- `tests/integration/helpers/constants.ts` - PDA seeds, token decimals, fee constants, seed liquidity amounts, PDA derivation helpers
- `tests/integration/helpers/test-wallets.ts` - createTestWallets factory with 4 roles (trader/staker/admin/attacker)
- `Anchor.toml` - Added test-integration script pointing to tests/integration/**/*.test.ts

## Decisions Made
- User token accounts skip Transfer Hook whitelisting because pool vaults (whitelisted during protocol-init) satisfy the "at least one party whitelisted" requirement
- WSOL account uses standard TOKEN_PROGRAM_ID since native SOL has no transfer hook extension
- PDA derivation helpers accept programId as parameter rather than importing from anchor.workspace, making them context-independent

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- constants.ts and test-wallets.ts ready for import by Plan 02 (protocol-init.ts helper)
- Plan 02 will create the protocol initialization helper that uses these constants to set up the full 5-program system
- Plan 03 will create smoke tests that import both helpers

---
*Phase: 31-integration-test-infrastructure*
*Completed: 2026-02-10*
