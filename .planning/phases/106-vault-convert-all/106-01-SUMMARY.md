---
phase: 106-vault-convert-all
plan: 01
subsystem: on-chain-program
tags: [anchor, rust, conversion-vault, token-2022, slippage, proptest]

# Dependency graph
requires:
  - phase: 30-integration
    provides: "Conversion Vault program with convert instruction and compute_output math"
  - phase: 78-bok-audit
    provides: "BOK proptest suite (INV-CV-001 through INV-CV-008)"
provides:
  - "convert_v2 instruction with sentinel balance reading (amount_in=0) and minimum_output slippage guard"
  - "SlippageExceeded (6006) and InvalidOwner (6007) error variants"
  - "BOK proptest invariants INV-CV-009 through INV-CV-013"
  - "Updated IDL with convertV2 method"
affects: [106-02-client-integration, 106-03-devnet-upgrade, 106-04-mainnet-upgrade, 107-jupiter-adapter]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sentinel value pattern: amount_in=0 triggers on-chain balance reading"
    - "Handler-level owner check (not struct constraint) for shared accounts struct"
    - "Conditional cfg imports for feature-gated compute functions"

key-files:
  created:
    - "programs/conversion-vault/src/instructions/convert_v2.rs"
  modified:
    - "programs/conversion-vault/src/error.rs"
    - "programs/conversion-vault/src/instructions/mod.rs"
    - "programs/conversion-vault/src/lib.rs"
    - "programs/conversion-vault/tests/bok_proptest_vault.rs"

key-decisions:
  - "Owner check in handler, not struct -- avoids changing existing convert behavior"
  - "Conditional cfg imports for compute_output vs compute_output_with_mints -- eliminates unused import warnings"
  - "No pub use for convert_v2 in mod.rs -- avoids ambiguous handler re-export, lib.rs references directly"

patterns-established:
  - "Sentinel amount_in=0 for on-chain balance reading in vault instructions"
  - "Appending error variants at end of enum for code stability"

requirements-completed: [VAULT-01, VAULT-02, VAULT-03]

# Metrics
duration: 6min
completed: 2026-03-26
---

# Phase 106 Plan 01: Vault Convert-All On-Chain Summary

**convert_v2 instruction with sentinel balance reading (amount_in=0) and minimum_output slippage guard, plus 5 new BOK proptest invariants (13/13 passing)**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-26T09:53:39Z
- **Completed:** 2026-03-26T10:00:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- New `convert_v2` instruction that reads on-chain token balance when amount_in=0 (convert-all mode) and enforces minimum_output slippage protection
- Two new error variants (SlippageExceeded=6006, InvalidOwner=6007) appended at correct positions preserving existing error codes
- Owner check prevents draining another user's account in convert-all mode
- IDL correctly generates both `convert` (unchanged) and `convertV2` (new) with proper argument shapes
- 5 new BOK proptest invariants (INV-CV-009 through INV-CV-013) covering math equivalence, slippage logic, and FRAUD direction -- all 13/13 pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Add convert_v2 instruction, error variants, and registration** - `ba922cd` (feat)
2. **Task 2: Extend BOK proptest suite with convert_v2 property tests** - `34d015e` (test)

## Files Created/Modified
- `programs/conversion-vault/src/instructions/convert_v2.rs` - New handler with owner check, sentinel balance reading, slippage guard, and identical transfer logic
- `programs/conversion-vault/src/error.rs` - SlippageExceeded (6006) and InvalidOwner (6007) appended after MathOverflow
- `programs/conversion-vault/src/instructions/mod.rs` - Added `pub mod convert_v2` (no glob re-export to avoid handler name collision)
- `programs/conversion-vault/src/lib.rs` - Registered convert_v2 instruction alongside unchanged convert
- `programs/conversion-vault/tests/bok_proptest_vault.rs` - 5 new invariants: math equivalence (CRIME, FRAUD, reverse), slippage pass/fail

## Decisions Made
- Owner check placed in handler function (not Convert struct constraint) because the struct is shared with the existing convert instruction and adding a constraint there would change convert's behavior
- Conditional `#[cfg]` imports used for `compute_output` vs `compute_output_with_mints` to avoid unused import warnings across feature flags
- No `pub use convert_v2::*` in mod.rs to avoid ambiguous `handler` name re-export -- lib.rs references `instructions::convert_v2::handler` directly

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- convert_v2 builds and is ready for client integration (106-02)
- IDL at `target/idl/conversion_vault.json` has both instructions for client code generation
- Error map in `app/lib/curve/error-map.ts` will need 6006/6007 entries added in 106-02
- Devnet upgrade (106-03) can proceed after client integration

---
*Phase: 106-vault-convert-all*
*Completed: 2026-03-26*
