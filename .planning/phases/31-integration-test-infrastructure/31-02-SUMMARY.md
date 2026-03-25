---
phase: 31-integration-test-infrastructure
plan: 02
subsystem: testing
tags: [anchor, token-2022, transfer-hook, amm, staking, epoch, carnage, integration-test]

# Dependency graph
requires:
  - phase: 31-01
    provides: constants.ts (PDA seeds, fee constants, derivation helpers) and test-wallets.ts (role-based wallet factory)
  - phase: 30
    provides: Correct program IDs across all 5 programs
provides:
  - initializeProtocol() function that sets up complete protocol in local validator
  - ProtocolState interface with all addresses needed for integration tests
  - 17-step initialization sequence covering all 5 programs
affects: [31-03, 32, 33, 34]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Canonical mint ordering for AMM pool init (Buffer.compare)"
    - "Manual hook remaining_accounts for StakePool init (stakeVault not yet created)"
    - "Programs interface decouples init helper from Anchor workspace specifics"

key-files:
  created:
    - tests/integration/helpers/protocol-init.ts
  modified: []

key-decisions:
  - "Authority is provider.wallet.payer (upgrade authority in anchor test context)"
  - "100 SOL airdrop for authority covers all rent + liquidity + fees"
  - "100,000 tokens minted per mint for seed liquidity + dead stake + test headroom"
  - "All pool vaults whitelisted (including WSOL vaults) for simplicity"
  - "Admin PROFIT account whitelisted before StakePool init (needed for dead stake transfer)"

patterns-established:
  - "initPool helper with canonical ordering: pass raw mints, helper sorts and maps token programs"
  - "Step-by-step console.log with numbered steps for diagnosing init failures"
  - "Programs interface pattern: tests load workspace programs, pass to initializeProtocol"

# Metrics
duration: 4min
completed: 2026-02-10
---

# Phase 31 Plan 02: Protocol Initialization Helper Summary

**17-step initializeProtocol() orchestrating T22 mints, 4 AMM pools, Transfer Hook whitelist, Epoch/Staking/Carnage init across all 5 programs**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-10T17:28:24Z
- **Completed:** 2026-02-10T17:32:24Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Created initializeProtocol() implementing complete 17-step protocol setup sequence
- All 4 AMM pools initialized with correct fee bps and pool types (MixedPool for SOL pairs, PureT22Pool for PROFIT pairs)
- Transfer Hook whitelist covers all pool vaults (8), staking vault (1), admin PROFIT account (1), and carnage vaults (2) = 12 total entries
- StakePool initialized with dead stake using manual hook remaining_accounts (proven pattern from init-localnet.ts)
- ProtocolState interface provides every address tests will need

## Task Commits

Each task was committed atomically:

1. **Task 1: Create protocol-init.ts with ProtocolState type and full initialization** - `a58503b` (feat)

**Plan metadata:** (pending)

## Files Created/Modified
- `tests/integration/helpers/protocol-init.ts` - Full protocol initialization helper (946 lines): ProtocolState interface, Programs interface, initializeProtocol() with 17-step sequence, canonical mint ordering helper

## Decisions Made
- **Authority source**: Used `(provider.wallet as any).payer` as the Keypair since `anchor test` sets the provider wallet as the Anchor.toml wallet which is the upgrade authority. This is required for InitializeAdmin which verifies ProgramData.upgrade_authority_address.
- **Mint amount**: 100,000 tokens per mint provides ample headroom for 4 pools of seed liquidity (10,000 each) plus dead stake (1 PROFIT) plus future test minting.
- **WSOL wrapping**: Wrapped enough SOL for both SOL pools plus buffer (25 SOL total) since WSOL uses standard SPL Token program, not Token-2022.
- **Whitelist all pool vaults**: Even WSOL vaults are whitelisted despite not strictly needing it (hook only runs on T22). Keeps logic simple and costs nothing extra.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- protocol-init.ts ready for import by integration test files (plan 31-03)
- All 5 programs initialized in correct dependency order
- ProtocolState provides complete address set for test assertions
- No blockers for plan 31-03 (Integration Test Suites)

---
*Phase: 31-integration-test-infrastructure*
*Completed: 2026-02-10*
