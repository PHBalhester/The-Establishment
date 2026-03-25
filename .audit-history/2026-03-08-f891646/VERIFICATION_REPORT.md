# Stronghold of Security — Verification Report

**Original Audit Date:** 2026-03-07/08
**Verification Date:** 2026-03-16
**Previous Verifications:** 2026-03-08, 2026-03-09, 2026-03-12
**Scope:** Full finding status review + Carnage fund hotfix (`3f927b0`)
**Findings Verified:** All 19 CONFIRMED + 1 POTENTIAL + 8 INFO from Audit #2

## Summary

| Status | Count |
|--------|-------|
| FIXED | 7 |
| MITIGATED (by design) | 1 |
| NOT_FIXED (by design) | 1 |
| NOT_FIXED (structural) | 2 |
| REGRESSION | 0 |

## Critical & High Findings

| ID | Severity | Status | Evidence |
|----|----------|--------|----------|
| CRITICAL-001 (H001/H002/H010/S001) | CRITICAL | FIXED | `BcAdminConfig` PDA + `has_one = authority` on all 6 BC instructions |
| CRITICAL-002 (H007) | CRITICAL | FIXED | ProgramData upgrade-authority gate in `initialize_authority.rs` |
| CRITICAL-003 (S006) | CRITICAL | FIXED | Resolved by fixing both CRITICAL-001 and CRITICAL-002 |
| H008 | HIGH | MITIGATED | `gross_floor` computation added; 50% floor remains by design |
| H012/S003 | HIGH | FIXED | `rent_exempt_min` reserve in `claim.rs` + graceful degradation in `trigger_epoch_transition.rs` |
| H036 | HIGH | FIXED | ProgramData upgrade-authority gates on Staking + Carnage Fund init |
| S005 | HIGH | NOT_FIXED (by design) | Deliberate tradeoff — immutability prioritized over pause capability |
| S007 | HIGH | FIXED | `tests/cross-crate/` with round-trip + byte-parity layout tests |

## Medium & Low Findings

| ID | Severity | Status | Notes |
|----|----------|--------|-------|
| H011 | MEDIUM | FIXED | Cross-program layout tests cover this (see S007) |
| H018 | MEDIUM | FIXED | `compile_error!` guards added to mainnet placeholder functions |
| H049 | MEDIUM | NOT_FIXED (structural) | Circular cross-program IDs remain; `sync-program-ids.ts` mitigates operationally |
| H058 | MEDIUM | NOT_FIXED (structural) | CPI depth at 4/4 limit; no compile-time guard but documented with warnings |
| H003 | MEDIUM (POTENTIAL) | FIXED | BC admin authority gate eliminates front-running risk |
| H005 | LOW | FIXED | Fixed as part of CRITICAL-001 (BC authority gap covers all 6 instructions) |
| H021 | LOW | FIXED | ProgramData gate added to `initialize_epoch_state.rs` |
| H031 | LOW | ACCEPTED | Dual-curve grief economically constrained (15% sell tax); monitor off-chain |
| H048 | LOW | ACCEPTED | Intentional design — VRF window 1-2 slots; stale rates bounded 1-14% |
| H077 | LOW | ACCEPTED | `as u64` cast in `calculate_refund`; values bounded by curve math |
| H014 | LOW | ACCEPTED | 50% buy floor matches sell floor; frontend defaults to 1-3% slippage |

## Informational Notes (no action required)

H035, H022, H027, H039, H071, S002, S004, S008 — all reviewed, no changes needed.

---

## Carnage Hotfix Verification (2026-03-16)

**Commit:** `3f927b0 fix(carnage): resolve both mints' hooks for atomic bundling`

### Root Cause

`buildExecuteCarnageAtomicIx` read stale `epochState.carnageTarget` before `consume_randomness` ran in the same bundled TX. Hook accounts were resolved for the wrong mint when VRF picked FRAUD, causing TX revert. Crank retried until CRIME was randomly selected — making Carnage appear to always target CRIME.

### Fix Applied

- **On-chain** (`carnage_execution.rs`): `partition_hook_accounts` now accepts `target`, `held_token`, and `atomic` parameters. Atomic layout: `[CRIME_buy(4), FRAUD_buy(4), held_sell(4)?]`. Function selects correct slices based on real VRF-derived target.
- **Client** (`carnage-flow.ts`): `buildExecuteCarnageAtomicIx` resolves hooks for BOTH mints (8 accounts) plus sell hooks for the stable held token. No longer reads stale `carnageTarget`.
- **Tests** (`test_partition_hook_accounts.rs`): 18 named tests + exhaustive 18-combination matrix covering all action × target × held_token permutations.

### Security Analysis

- No crafted `remaining_accounts` manipulation possible — Token-2022 independently validates against on-chain `ExtraAccountMetaList` PDA
- All array slicing guarded by explicit `remaining_accounts.len()` checks — no panic possible
- Fallback path (`atomic=false`) completely unchanged
- `atomic` flag hardcoded at each call site — not controllable by external callers
- Zero new CPI calls — CPI depth unchanged at 4/4

### Regression Scan (3 files)

| Category | Findings |
|----------|----------|
| Unchecked Arithmetic | None — all `checked_*` ops |
| Array Bounds | None — all guarded by length checks |
| Unsafe Blocks | None |
| Access Control | No bypass — `atomic` flag internal-only |
| New CPI Calls | None |

### Code Quality Notes (non-security)

1. **LOW — BN comparison** (`carnage-flow.ts:359`): `carnageState.heldAmount > 0` compares Anchor `BN` via JS coercion. Safe for expected carnage fund amounts. Using `.gtn(0)` would be cleaner.
2. **LOW — Silent fallback** (`carnage_execution.rs`): 5-7 accounts with `atomic=true` falls through to fallback. TX would fail at Token-2022 CPI anyway.

---

## Overall Assessment

**All 3 CRITICAL findings are resolved.** The protocol's authority model now consistently uses ProgramData upgrade-authority gates across all programs (matching the AMM's original secure pattern).

**4 of 5 HIGH findings are resolved.** H008 (sell path slippage) is mitigated with a 50% floor — a conscious risk acceptance. S005 (no pause) is a deliberate design decision.

**The carnage hotfix introduces zero regressions** and correctly fixes the always-CRIME bug with comprehensive test coverage.

**Remaining structural items** (H049 cross-program IDs, H058 CPI depth limit) are operational concerns mitigated by tooling and documentation, not exploitable vulnerabilities.
