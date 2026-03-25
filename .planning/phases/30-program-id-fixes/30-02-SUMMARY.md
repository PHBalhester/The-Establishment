---
phase: 30-program-id-fixes
plan: 02
subsystem: tooling
tags: [typescript, verification, program-ids, solana, keypairs, anchor]

# Dependency graph
requires:
  - phase: all prior milestones (v0.1-v0.6)
    provides: program keypairs, declare_id! macros, Anchor.toml, cross-program constants
provides:
  - Automated program ID verification script (scripts/verify-program-ids.ts)
  - npm scripts verify-ids and verify-ids:json
  - Baseline scan of all 8 programs and 5 cross-program references
affects: [30-01 (ID fix plan uses verification output), 30-03 (post-fix verification), all future program ID changes]

# Tech tracking
tech-stack:
  added: [tsx (devDependency)]
  patterns: [keypair-as-source-of-truth verification, cross-program ID consistency checking]

key-files:
  created:
    - scripts/verify-program-ids.ts
  modified:
    - package.json

key-decisions:
  - "Keypair-derived pubkey is source of truth; declare_id! and Anchor.toml are compared against it"
  - "Missing keypairs (amm, staking) are reported as failures, not skipped silently"
  - "Devnet section absence is informational (N/A), not an error -- section doesn't exist yet"
  - "Used raw ANSI escape codes instead of adding a color dependency (chalk/kleur)"
  - "Cross-ref extraction uses function-name-then-scan-forward strategy to handle multi-function files"

patterns-established:
  - "Program ID verification: run npm run verify-ids before and after any ID changes"
  - "JSON mode for CI: npm run --silent verify-ids:json for machine-parseable output"

# Metrics
duration: 4min
completed: 2026-02-09
---

# Phase 30 Plan 02: Program ID Verification Script Summary

**TypeScript verification script checking 8 programs across 3 ID layers (keypairs, declare_id!, Anchor.toml), 5 cross-program references, and placeholder detection with colored terminal and JSON output**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-09T22:55:38Z
- **Completed:** 2026-02-09T22:59:28Z
- **Tasks:** 2
- **Files created/modified:** 2

## Accomplishments
- Automated verification script that checks all program ID references for consistency
- Detects mismatches between keypair-derived pubkeys, declare_id! macros, and Anchor.toml entries
- Validates 5 cross-program references (tax->epoch, tax->staking, staking->tax, staking->epoch, amm->tax)
- Scans all Rust source files for placeholder IDs (found 4 EpochProgram1111... placeholders)
- Dual output: ANSI-colored human-readable tables and machine-parseable JSON
- Baseline scan revealed 15 failures across 25 checks -- these are real issues for Plan 30-01/30-03 to fix

## Task Commits

Each task was committed atomically:

1. **Task 1: Create program ID verification script** - `aca9b53` (feat)
2. **Task 2: Install tsx runner and add npm scripts** - `ab3aa8d` (chore)

## Files Created/Modified
- `scripts/verify-program-ids.ts` - 760-line verification script with program registry, cross-ref checks, placeholder scanning, and dual output modes
- `package.json` - Added tsx devDependency and verify-ids/verify-ids:json npm scripts

## Decisions Made
- **Keypair as source of truth:** When a keypair file exists, its derived pubkey is the canonical ID. declare_id! and Anchor.toml are checked against it. This mirrors the Solana deploy flow where the keypair file IS the program's identity.
- **Missing keypair reporting:** AMM and staking programs have no keypair files in the repository (likely vanity keys generated elsewhere). The script reports these as FAIL rather than silently skipping, ensuring they get proper keypair files before devnet deployment.
- **No full TOML parser:** Used simple line-by-line parsing for Anchor.toml since its format is predictable. Avoids adding a dependency for a straightforward task.
- **Function-scoped cross-ref extraction:** Constants files have multiple functions returning different program IDs. The script finds the function by name, then scans forward up to 15 lines for the ID pattern, avoiding false matches from other functions.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Baseline Verification Results

The initial scan found 15 failures across 25 checks:

**Missing keypairs (2):** amm, staking -- no keypair files in repository
**Keypair/declare_id! mismatches (3):** tax_program, mock_tax_program, fake_tax_program
**Anchor.toml mismatches (3):** tax_program, mock_tax_program, fake_tax_program (follow from keypair mismatches)
**Devnet section missing (3):** All production programs (section doesn't exist yet)
**Cross-ref failures (3):** epoch_program_id() placeholder in tax-program, tax_program_id() in staking uses old ID, TAX_PROGRAM_ID in AMM uses old ID
**Placeholder IDs (4):** EpochProgram1111... in constants.rs and 3 test files

These are the issues Plan 30-01 and 30-03 are designed to fix.

## Next Phase Readiness
- Verification script ready to validate Plan 30-01 (ID fixes) and Plan 30-03 (final verification)
- Run `npm run verify-ids` before and after ID changes to confirm all fixes
- Target: 25/25 checks passing after Plan 30-01 completes

---
*Phase: 30-program-id-fixes*
*Completed: 2026-02-09*
