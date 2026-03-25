---
phase: 71-curve-foundation
status: validated
nyquist_compliant: true
retroactive: true
created: 2026-03-07
approved: 2026-03-07
---

# Phase 71 — Validation Strategy

> Generated retroactively from execution artifacts (Phase 77). This phase was completed and verified before Nyquist validation was adopted. Evidence is drawn from 71-VERIFICATION.md (5/5 observable truths passed) and proptest/unit test results.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | proptest 1.9 + cargo test |
| **Config file** | `programs/bonding_curve/Cargo.toml` |
| **Quick run command** | `cargo test -p bonding-curve` |
| **Full suite command** | `cargo test -p bonding-curve` |
| **Estimated runtime** | ~15s (23 unit tests + 5 proptest properties at 500K iterations each) |

## Per-Requirement Verification Map

| Requirement | Test Type | Evidence | Status |
|-------------|-----------|----------|--------|
| CURVE-01 | proptest | `math.rs::round_trip_vault_solvent (500K)`, `math.rs::monotonic_pricing (500K)`, constants.rs values match spec (P_START=900, P_END=3450, TOTAL_FOR_SALE=460M). 71-VERIFICATION.md Truth #1. | COVERED |
| CURVE-02 | proptest + unit | `math.rs::no_overflow_tokens_out (500K)`, `math.rs::test_buy_basic`, purchase.rs quadratic solver via `calculate_tokens_out` + slippage check (lines 176-179). 71-VERIFICATION.md Truth #2. | COVERED |
| CURVE-09 | unit | purchase.rs Anchor constraint (lines 135-141): `user_ata_balance + tokens_out <= MAX_TOKENS_PER_WALLET`. Re-checked after partial fill (lines 165-173). 71-VERIFICATION.md Truth #3. | COVERED |
| CURVE-10 | unit | `state.rs::test_curve_state_serialization` confirms CurveState::LEN = 199 (8 discriminator + 191 data). All required fields present: sol_raised, tokens_sold, status, deadline_slot, participant_count. No ParticipantState PDA. 71-VERIFICATION.md Truth #5. | COVERED |
| SAFE-01 | proptest | `math.rs` 5 property tests x 500K iterations = 2.5M total: no_overflow_tokens_out, no_overflow_sol_for_tokens, monotonic_pricing, round_trip_vault_solvent, vault_solvency_sequential. All pass in 15.32s. 71-VERIFICATION.md Truth #4. | COVERED |
| SAFE-03 | proptest | `math.rs::vault_solvency_sequential (500K)` proves cost(floor_tokens) <= sol_input across full curve range. sol_vault is 0-byte PDA (rent-exempt at 890,880 lamports). 71-VERIFICATION.md Truth #4. | COVERED |

## Manual-Only Verifications

All phase behaviors have automated verification. No manual-only items.

## Validation Sign-Off

- [x] All requirements have verification evidence mapped
- [x] nyquist_compliant: true set in frontmatter
- [x] Retroactive transparency note included

**Approval:** approved 2026-03-07
