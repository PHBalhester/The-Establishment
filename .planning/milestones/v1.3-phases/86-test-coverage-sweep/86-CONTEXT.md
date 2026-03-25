# Phase 86: Test Coverage Sweep - Context

**Gathered:** 2026-03-08
**Status:** Ready for planning

<domain>
## Phase Boundary

All code changes from phases 78-85 have comprehensive test coverage including bonding curve edge cases. Additionally, a full edge case audit across all 7 programs identifies and tests high/medium risk gaps. Requirements: TEST-01 through TEST-08.

</domain>

<decisions>
## Implementation Decisions

### Test Framework
- All new bonding curve integration tests (TEST-01 through TEST-06) use LiteSVM (Rust)
- Clock control for grace period tests (TEST-02), fast isolated execution, existing type bridge pattern
- No TypeScript layer for these tests — LiteSVM is sufficient

### Dual-Curve Test Setup
- Shared dual-curve helper function deploys both CRIME and FRAUD curves with configurable fill state
- Helper used across TEST-01, TEST-03, TEST-04 — reduces boilerplate, mirrors real dual-curve relationship
- Each test still runs in isolation via LiteSVM (no shared state between tests)

### Insolvency Testing (TEST-04)
- Artificially drain vault balance via LiteSVM account manipulation to trigger VaultInsolvency
- Tests the guard fires correctly, not whether natural operations can cause insolvency (proptest already proves they can't)

### Boundary Tests (TEST-05, TEST-06)
- LiteSVM deterministic tests with crafted exact states
- TEST-05: Set supply to 1 token remaining, attempt dust purchase — verify rounding behavior
- TEST-06: Create pool with reversed mint ordering — verify floor calculation still correct

### Edge Case Audit Scope (TEST-08)
- Full audit across all 7 programs (not just phases 78-85 changes)
- Discovery phase first: identify all edge case gaps across programs
- Prioritization: implement all HIGH and MEDIUM risk gaps (financial, security, correctness with user impact)
- LOW risk gaps documented but not implemented
- Gap report written to `docs/` as persistent project documentation for mainnet readiness review

### Proptest Regression (TEST-07)
- `vault_solvency_mixed_buy_sell` must pass or be fully explained — no open questions
- If root cause is impossible-in-practice rounding edge case: narrow proptest input strategy to exclude unreachable range, document why
- On-chain code stays stable (no changes to deployed math)
- Fixed/updated test validated with 5M proptest iterations

### Claude's Discretion
- Specific file naming for new bonding curve test files (e.g., `dual_curve_test.rs`, `edge_case_test.rs`)
- How to structure the gap report document
- Which specific edge cases qualify as high/medium vs low risk during audit
- Test helper implementation details (dual-curve setup, account manipulation patterns)

</decisions>

<specifics>
## Specific Ideas

- Gap report serves as mainnet readiness artifact — should be useful for v1.4 review
- Proptest validation at 5M iterations matches the v1.2 confidence bar

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `programs/bonding_curve/tests/refund_clock_test.rs`: 12 existing LiteSVM tests with clock manipulation, type bridge helpers, PDA derivation, instruction builders — pattern to follow for new tests
- `programs/bonding_curve/src/math.rs`: Existing proptest strategies (percentage-based derivation) with 5M iterations — pattern for TEST-07 fix
- `programs/amm/tests/`: 4 test files (5,409 lines) with pool setup helpers
- `programs/tax-program/tests/`: 4 test files (3,195 lines) with tax math validation
- `tests/integration/lifecycle.test.ts`: Full 7-program lifecycle (happy + failure paths) — reference for understanding expected behavior

### Established Patterns
- LiteSVM type bridge: converts between Anchor `Pubkey` and LiteSVM `Address` via `.to_bytes()`
- PDA derivation: SHA256-based Anchor discriminator computation for instruction data
- Mock program deployment: LiteSVM loads compiled `.so` binaries at hardcoded addresses
- Proptest: percentage-based derivation (not `prop_assume!`) to avoid >50% rejection rates
- Test isolation: StakePool PDA singleton requires separate validators for parallel test files

### Integration Points
- New bonding curve tests go in `programs/bonding_curve/tests/` as new file(s)
- Edge case tests for other 6 programs extend their existing test files
- Gap report goes in `docs/` directory

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 86-test-coverage-sweep*
*Context gathered: 2026-03-08*
