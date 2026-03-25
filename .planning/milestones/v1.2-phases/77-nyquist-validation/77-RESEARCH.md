# Phase 77: Nyquist Validation (Retroactive) - Research

**Researched:** 2026-03-07
**Domain:** Procedural compliance -- retroactive VALIDATION.md creation for phases 70-75
**Confidence:** HIGH

## Summary

This phase is a documentation-only task: create 6 VALIDATION.md files (one per phase 70-75) to close the Nyquist compliance gap identified in the v1.2 milestone audit. No code changes, no new tests, no new features.

All 6 phases already have passing VERIFICATION.md files (scores: 7/7, 5/5, 5/5, 22/22, 6/6, 8/8). The VALIDATION.md files map these existing verification results into the Nyquist template format. The adapted template skips Wave 0 stubs (tests already exist) and sampling rate (not enforced during execution), adds a retroactive transparency note, and groups by requirement ID.

**Primary recommendation:** Batch-produce all 6 files in 2 plans: Plan 01 covers Rust-heavy phases (70-73, requirement-to-test-function mapping), Plan 02 covers integration + frontend phases (74-75, requirement-to-evidence mapping). Or a single plan with 6 tasks if the planner prefers maximal parallelism.

## Standard Stack

No libraries or tools needed. This is pure markdown authoring.

### Core

| Tool | Purpose | Why |
|------|---------|-----|
| Markdown | VALIDATION.md files | Standard GSD planning artifact format |
| Existing VERIFICATION.md | Evidence source | Already verified and passing for all 6 phases |
| Existing SUMMARY.md | Evidence source | Task completion records with requirement refs |
| REQUIREMENTS.md traceability table | Requirement-to-phase mapping | Canonical mapping of all 28 requirements |

### Alternatives Considered

None -- this is a template-filling exercise.

## Architecture Patterns

### VALIDATION.md Adapted Template Structure

Per CONTEXT.md decisions, the adapted Nyquist template for retroactive validation:

```markdown
---
phase: {N}-{slug}
status: validated
nyquist_compliant: true
retroactive: true
created: 2026-03-07
approved: 2026-03-07
---

# Phase {N} — Validation Strategy

> Generated retroactively from execution artifacts (Phase 77).

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | {anchor test / proptest / manual review / browser testing} |
| **Config file** | {path} |
| **Quick run command** | {command} |
| **Full suite command** | {command} |

## Per-Requirement Verification Map

| Requirement | Test Type | Evidence | Status |
|-------------|-----------|----------|--------|
| {REQ-ID} | {unit/proptest/integration/manual} | {test file::function or VERIFICATION.md check #} | COVERED |

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Verification |
|----------|-------------|------------|--------------|
| {behavior} | {REQ-ID} | {reason} | {VERIFICATION.md reference} |

## Validation Sign-Off

- [x] All requirements have verification evidence mapped
- [x] nyquist_compliant: true set in frontmatter
- [x] Retroactive transparency note included

**Approval:** approved 2026-03-07
```

### Sections Omitted (Per CONTEXT.md Decisions)

- **Wave 0 stubs**: Tests already written and passing
- **Sampling rate**: Not enforced during original execution
- **Per-task verification map**: Grouped by requirement instead
- **Task IDs / Plan / Wave columns**: Not relevant for retroactive mapping

### Per-Phase Content Strategy

| Phase | Type | Requirements | Evidence Source | Manual-Only Items |
|-------|------|-------------|----------------|-------------------|
| 70 (Specification Update) | Doc-only | SPEC-01 | 70-VERIFICATION.md (7/7) | All -- spec review |
| 71 (Curve Foundation) | Rust + proptest | CURVE-01, 02, 09, 10, SAFE-01, 03 | 71-VERIFICATION.md (5/5) + math.rs proptests | None |
| 72 (Sell-Back + Tax Escrow) | Rust + proptest | CURVE-03, 04, SAFE-02 | 72-VERIFICATION.md (5/5) + math.rs sell proptests | None |
| 73 (Graduation + Refund) | Rust + proptest | CURVE-05, 06, 07, 08 | 73-VERIFICATION.md (22/22) + math.rs refund proptests | None |
| 74 (Protocol Integration) | Scripts + integration | INTG-01..06 | 74-VERIFICATION.md (6/6) + lifecycle.test.ts | None |
| 75 (Launch Page) | Frontend | PAGE-01..08 | 75-VERIFICATION.md (8/8) | All -- browser/visual testing |

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Requirement mapping | Custom tracker | REQUIREMENTS.md traceability table | Already maps all 28 reqs to phases |
| Evidence gathering | Re-run tests | VERIFICATION.md files | Already verified and passing |
| Test function names | Grep source code | VERIFICATION.md artifact tables | Already list file paths and test names |

## Common Pitfalls

### Pitfall 1: Inventing coverage that doesn't exist
**What goes wrong:** Claiming a requirement is covered by a test that doesn't actually test it
**How to avoid:** Only reference evidence explicitly cited in VERIFICATION.md files. If a requirement doesn't have direct test coverage, put it in Manual-Only table.

### Pitfall 2: Inconsistent requirement IDs across files
**What goes wrong:** Using CURVE-1 instead of CURVE-01, or mapping to wrong phase
**How to avoid:** Copy requirement IDs directly from REQUIREMENTS.md traceability table

### Pitfall 3: Setting nyquist_compliant without mapping all requirements
**What goes wrong:** Missing requirements in the per-requirement map
**How to avoid:** Cross-check requirement count: Phase 70 (1), Phase 71 (6), Phase 72 (3), Phase 73 (4), Phase 74 (6), Phase 75 (8). Total = 28.

### Pitfall 4: Over-specifying test infrastructure for doc/frontend phases
**What goes wrong:** Listing jest/vitest for phases that have no automated tests
**How to avoid:** Phase 70 and 75 should note "Manual review" / "Browser testing" as framework. No automated test commands.

## Code Examples

### Phase 71 Per-Requirement Map (Representative)

```markdown
| Requirement | Test Type | Evidence | Status |
|-------------|-----------|----------|--------|
| CURVE-01 | proptest | `math.rs::round_trip_vault_solvent (500K)`, `math.rs::monotonic_pricing (500K)` | COVERED |
| CURVE-02 | proptest + unit | `math.rs::no_overflow_tokens_out (500K)`, `math.rs::test_buy_basic` | COVERED |
| CURVE-09 | unit | `purchase.rs` Anchor constraint (lines 135-141), VERIFICATION.md Truth #3 | COVERED |
| CURVE-10 | unit | `state.rs::test_curve_state_serialization`, VERIFICATION.md Truth #5 | COVERED |
| SAFE-01 | proptest | `math.rs` 5 properties x 500K = 2.5M iterations | COVERED |
| SAFE-03 | proptest | `math.rs::vault_solvency_sequential (500K)` + `sell.rs` dynamic rent-exempt | COVERED |
```

### Phase 70 Manual-Only Table (Representative)

```markdown
| Behavior | Requirement | Why Manual | Verification |
|----------|-------------|------------|--------------|
| Spec contains buy+sell mechanics, 15% sell tax escrow, coupled graduation, token-proportional refunds, sells disabled when Filled | SPEC-01 | Documentation review -- no code to test | 70-VERIFICATION.md: 7/7 observable truths verified. Sections 4.1-4.5, 5.2, 8.6-8.10, 9.2, 10, 11, 12, 15, 16 all present and consistent. |
```

## State of the Art

Not applicable -- this is a procedural compliance task, not a technology selection.

## Open Questions

1. **Exact test function name selection**
   - What we know: VERIFICATION.md files reference test functions with varying specificity
   - What's unclear: Whether to use short names (`no_overflow_tokens_out`) or fully qualified (`math.rs::no_overflow_tokens_out (500K iterations)`)
   - Recommendation: Use `file::function (iteration_count)` format for proptest, `file::function` for unit tests -- per CONTEXT.md Claude's discretion

2. **Phase 74 lifecycle test reference granularity**
   - What we know: lifecycle.test.ts has 21 tests across 2044 lines
   - What's unclear: Whether to list individual test names or reference the test file as a whole
   - Recommendation: Reference test file with count (`lifecycle.test.ts: 21 tests`) -- per CONTEXT.md "same treatment as other phases"

## Sources

### Primary (HIGH confidence)
- `.planning/phases/77-nyquist-validation/77-CONTEXT.md` -- all implementation decisions locked
- `.planning/REQUIREMENTS.md` -- canonical requirement-to-phase traceability
- `.planning/v1.2-MILESTONE-AUDIT.md` -- Nyquist gap identification, requirement coverage
- `~/.claude/get-shit-done/templates/VALIDATION.md` -- base template structure
- Phase 70-75 VERIFICATION.md files -- all evidence sources

### Secondary (MEDIUM confidence)
None needed -- all sources are project-internal artifacts.

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no external libraries, pure documentation
- Architecture: HIGH -- template structure locked by CONTEXT.md decisions
- Pitfalls: HIGH -- all derived from existing project artifacts and known patterns

**Research date:** 2026-03-07
**Valid until:** Indefinite (procedural compliance task, no external dependencies)
