---
status: resolved
trigger: "Fix all stale program IDs left behind after Phase 95 clean deploy"
created: 2026-03-14T00:00:00Z
updated: 2026-03-14T00:01:00Z
---

## Current Focus

hypothesis: CONFIRMED - all stale IDs replaced
test: cargo check --workspace --features devnet
expecting: clean compilation
next_action: archive and commit

## Symptoms

expected: CI passes (both rust-tests and ts-tests jobs)
actual: Both jobs fail because program IDs in tests/CI don't match declare_id!
errors: Program ID mismatches cause LiteSVM tests to fail
reproduction: Push to main, CI fails
started: After commit 41b1fe0 (Phase 95 clean deploy)

## Eliminated

(none - root cause was pre-identified)

## Evidence

- timestamp: 2026-03-14
  checked: Root cause analysis from caller
  found: 7 program IDs changed, sync script missed ~20 files
  implication: Straightforward find-and-replace fix

- timestamp: 2026-03-14
  checked: grep for all 7 old IDs across *.{rs,ts,tsx,js,json,yml,yaml,toml}
  found: Zero matches remain (found one extra straggler in scripts/vrf/devnet-vrf-validation.ts comment, fixed)
  implication: All old IDs fully purged

- timestamp: 2026-03-14
  checked: cargo check --workspace --features devnet
  found: Finished dev profile in 53s, 0 errors (only warnings)
  implication: All cross-program references resolve correctly

## Resolution

root_cause: sync-program-ids.ts only updated declare_id!, Anchor.toml, and main constants.rs cross-program refs. Missed CI workflow, test files, stub-staking, IDL files, and one VRF script comment.
fix: Replaced all 7 old program IDs with new Phase 95 IDs across 21 files
verification: cargo check --workspace --features devnet passes (0 errors), grep confirms 0 stale IDs remain
files_changed:
  - .github/workflows/ci.yml
  - programs/stub-staking/src/lib.rs
  - programs/staking/src/constants.rs
  - programs/tax-program/src/constants.rs (CRITICAL - amm_program_id() source + test assertions)
  - programs/amm/tests/test_cpi_access_control.rs
  - programs/amm/tests/test_transfer_routing.rs
  - programs/amm/tests/test_pool_initialization.rs
  - programs/amm/tests/test_swap_sol_pool.rs
  - programs/bonding_curve/tests/dual_curve_test.rs
  - programs/bonding_curve/tests/refund_clock_test.rs
  - programs/tax-program/tests/bok_constants.rs
  - programs/tax-program/tests/test_swap_exempt.rs
  - programs/tax-program/tests/test_swap_sol_buy.rs
  - programs/tax-program/tests/test_swap_sol_sell.rs
  - programs/transfer-hook/tests/test_edge_cases.rs
  - programs/transfer-hook/tests/test_transfer_hook.rs
  - app/idl/tax_program.json
  - app/idl/types/tax_program.ts
  - scripts/test/pathway1-log.json
  - scripts/vrf/devnet-vrf-validation.ts
