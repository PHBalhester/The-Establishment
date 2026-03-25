---
phase: 73-graduation-refund
status: validated
nyquist_compliant: true
retroactive: true
created: 2026-03-07
approved: 2026-03-07
---

# Phase 73 — Validation Strategy

> Generated retroactively from execution artifacts (Phase 77). This phase was completed and verified before Nyquist validation was adopted. Evidence is drawn from 73-VERIFICATION.md (22/22 must-haves verified) and proptest/unit test results.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | proptest 1.9 + cargo test |
| **Config file** | `programs/bonding_curve/Cargo.toml` |
| **Quick run command** | `cargo test -p bonding-curve` |
| **Full suite command** | `cargo test -p bonding-curve` |
| **Estimated runtime** | ~60s (53 total tests including 5 refund proptest properties at 1M iterations each = 5M refund iterations) |

## Per-Requirement Verification Map

| Requirement | Test Type | Evidence | Status |
|-------------|-----------|----------|--------|
| CURVE-05 | unit + deterministic | `math.rs::prepare_transition_requires_both_filled` -- verifies both curves must be Filled for graduation. CurveState.deadline_slot = start_slot + 432,000 (~48h). mark_failed grace buffer test confirms slot > deadline + FAILURE_GRACE_SLOTS (150). 73-VERIFICATION.md Truth #1. | COVERED |
| CURVE-06 | unit | `math.rs::mark_failed_grace_buffer_exact_boundary` -- tests exact slot boundary for permissionless failure trigger. mark_failed has no signer constraint (permissionless). 73-VERIFICATION.md Truth #2. | COVERED |
| CURVE-07 | unit | prepare_transition sets both curves to Graduated (terminal state). distribute_tax_escrow routes escrow SOL to carnage fund via cross-program lamport credit. Requires Graduated status. 73-VERIFICATION.md Truth #3. | COVERED |
| CURVE-08 | proptest + unit | `math.rs::refund_order_independent (1M)` -- max N-1 lamport deviation across orderings. `math.rs::refund_solvency_per_claim (1M)` -- vault never goes negative. `math.rs::refund_vault_exhaustion (1M)` -- last claimant gets remaining. `math.rs::refund_floor_rounding_protocol_favored (1M)` -- floor rounding leaves dust in vault. `math.rs::refund_varied_pool_sizes (1M)` -- works across varied curve fill levels. claim_refund burn-and-claim with `floor(balance * pool / total)` proportional math using u128 intermediates. 73-VERIFICATION.md Truth #4. | COVERED |

## Manual-Only Verifications

All phase behaviors have automated verification. No manual-only items.

## Validation Sign-Off

- [x] All requirements have verification evidence mapped
- [x] nyquist_compliant: true set in frontmatter
- [x] Retroactive transparency note included

**Approval:** approved 2026-03-07
