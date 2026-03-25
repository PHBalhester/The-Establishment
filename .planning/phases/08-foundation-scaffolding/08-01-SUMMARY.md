---
phase: 08-foundation-scaffolding
plan: 01
subsystem: infra
tags: [anchor, rust, solana, workspace, cargo, scaffold]

# Dependency graph
requires: []
provides:
  - Compiling Anchor 0.32.1 workspace with AMM program skeleton
  - Multi-program workspace structure (programs/* glob)
  - AMM module tree (state, instructions, helpers, constants, errors, events)
  - Fee constants (SOL_POOL_FEE_BPS=100, PROFIT_POOL_FEE_BPS=50)
  - AmmError enum (Overflow, KInvariantViolation)
  - Pure math module placeholder (zero Anchor imports)
  - proptest 1.9 in dev-dependencies
affects:
  - 08-02 (math module implementation fills helpers/math.rs)
  - Phase 9 (pool initialization fills state/pool.rs, instructions/)
  - Phase 10 (token routing adds to instructions/)
  - Phase 11-12 (swap instructions)
  - Phase 13 (CPI integration)

# Tech tracking
tech-stack:
  added: [anchor-lang 0.32.1, anchor-spl 0.32.1, proptest 1.9]
  patterns: [pure-math-module, multi-program-workspace, overflow-checks-release]

key-files:
  created:
    - Anchor.toml
    - Cargo.toml
    - programs/amm/Cargo.toml
    - programs/amm/src/lib.rs
    - programs/amm/src/constants.rs
    - programs/amm/src/errors.rs
    - programs/amm/src/events.rs
    - programs/amm/src/helpers/mod.rs
    - programs/amm/src/helpers/math.rs
    - programs/amm/src/state/mod.rs
    - programs/amm/src/state/pool.rs
    - programs/amm/src/instructions/mod.rs
    - tests/.gitkeep
  modified:
    - .gitignore

key-decisions:
  - "Pin blake3 to 1.7.0 to avoid edition2024 incompatibility with Solana platform-tools v1.51"
  - "Generate program keypair before first build to avoid placeholder ID issues"
  - "Add target/, .anchor/, node_modules/ to .gitignore for clean repo"

patterns-established:
  - "Pure math module: helpers/math.rs has zero Anchor/Solana imports for fast proptest execution"
  - "Constants trace to spec: every fee constant references AMM_Implementation.md section"
  - "Error contract: math returns Option<T>, instruction layer maps None to AmmError::Overflow"

# Metrics
duration: 5min
completed: 2026-02-03
---

# Phase 8 Plan 01: Workspace Scaffolding Summary

**Anchor 0.32.1 AMM workspace with 9-file module skeleton, overflow-safe release profile, and T22/SPL dual-token anchor-spl configuration**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-03T23:06:41Z
- **Completed:** 2026-02-03T23:11:50Z
- **Tasks:** 2
- **Files modified:** 14

## Accomplishments
- Established compiling Anchor 0.32.1 workspace from arrayappy/solana-uniswap-v2 skeleton pattern (all source written from scratch)
- Created complete AMM module tree: lib.rs entrypoint, constants, errors, events, helpers/math, state/pool, instructions
- Configured anchor-spl with token + token_2022 + associated_token features for mixed SPL/T22 pool support
- Set overflow-checks = true in release profile as defense-in-depth for financial math

## Task Commits

Each task was committed atomically:

1. **Task 1: Fork, strip, and set up Anchor 0.32.1 workspace** - `81ea614` (feat)
2. **Task 2: Create AMM program file structure with empty module scaffolds** - `07fa2db` (feat)

## Files Created/Modified
- `Anchor.toml` - Workspace config with localnet cluster, resolution=true, AMM program ID
- `Cargo.toml` - Workspace root with programs/* glob, overflow-checks=true, lto="fat"
- `Cargo.lock` - Locked dependencies with blake3 pinned to 1.7.0
- `programs/amm/Cargo.toml` - AMM dependencies (anchor-lang, anchor-spl, proptest dev-dep)
- `programs/amm/src/lib.rs` - Program entrypoint with declare_id!, all module declarations
- `programs/amm/src/constants.rs` - Fee BPS constants (100 for SOL pools, 50 for PROFIT pools)
- `programs/amm/src/errors.rs` - AmmError enum (Overflow, KInvariantViolation)
- `programs/amm/src/events.rs` - Empty placeholder for Phase 9
- `programs/amm/src/helpers/mod.rs` - Re-exports math module
- `programs/amm/src/helpers/math.rs` - Pure math module placeholder (zero Anchor imports)
- `programs/amm/src/state/mod.rs` - Re-exports pool module
- `programs/amm/src/state/pool.rs` - Placeholder for Phase 9 PoolState
- `programs/amm/src/instructions/mod.rs` - Placeholder for Phases 9-13 handlers
- `tests/.gitkeep` - Preserves tests directory
- `.gitignore` - Added target/, .anchor/, node_modules/

## Decisions Made
- **blake3 pinned to 1.7.0:** Solana platform-tools v1.51 ships rustc 1.84.1 which does not support edition2024. The latest blake3 (1.8.3) pulls constant_time_eq 0.4.2 which requires edition2024. Pinning blake3 to 1.7.0 resolves this without any functional impact.
- **Program ID generated upfront:** Used `solana-keygen new` to generate `target/deploy/amm-keypair.json` before first build, then set the ID in both lib.rs and Anchor.toml. This avoids the Anchor placeholder-then-update dance.
- **Fork used for pattern only:** Cloned arrayappy/solana-uniswap-v2 to reference its Anchor project structure. No source code was copied -- all .rs files written from scratch per our specs. Fork cleaned up after reference.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Pinned blake3 to 1.7.0 for edition2024 compatibility**
- **Found during:** Task 1 (first `anchor build`)
- **Issue:** blake3 1.8.3 depends on constant_time_eq 0.4.2 which requires Cargo edition2024, not supported by Solana platform-tools v1.51 (rustc 1.84.1)
- **Fix:** Ran `cargo update blake3 --precise 1.7.0` to downgrade blake3 and constant_time_eq
- **Files modified:** Cargo.lock
- **Verification:** `anchor build` succeeds after pinning
- **Committed in:** 81ea614 (Task 1 commit)

**2. [Rule 3 - Blocking] Added build artifacts to .gitignore**
- **Found during:** Task 1 (pre-commit git status)
- **Issue:** `target/` directory (build artifacts) would be committed without .gitignore entry
- **Fix:** Added target/, .anchor/, node_modules/ to existing .gitignore
- **Files modified:** .gitignore
- **Verification:** `git status` no longer shows target/ as untracked
- **Committed in:** 81ea614 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes necessary for build to succeed and repo cleanliness. No scope creep.

## Issues Encountered
- Anchor uses Solana platform-tools (v1.51) with rustc 1.84.1 for BPF compilation, which is older than the system rustc 1.93.0. This means some cutting-edge crate editions are incompatible with `anchor build`. Resolved by pinning blake3 to 1.7.0. This is a known friction point in the Solana ecosystem and may recur if other dependencies adopt edition2024.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Workspace compiles cleanly, ready for Phase 08-02 to implement swap math in helpers/math.rs
- proptest is in dev-dependencies, ready for property-based k-invariant testing
- Error types (Overflow, KInvariantViolation) defined, ready for math module to reference
- Fee constants defined, ready for math tests to validate against

---
*Phase: 08-foundation-scaffolding*
*Completed: 2026-02-03*
