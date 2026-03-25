---
phase: 72-sell-back-tax-escrow
status: validated
nyquist_compliant: true
retroactive: true
created: 2026-03-07
approved: 2026-03-07
---

# Phase 72 — Validation Strategy

> Generated retroactively from execution artifacts (Phase 77). This phase was completed and verified before Nyquist validation was adopted. Evidence is drawn from 72-VERIFICATION.md (5/5 observable truths passed) and proptest/unit test results.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | proptest 1.9 + cargo test |
| **Config file** | `programs/bonding_curve/Cargo.toml` |
| **Quick run command** | `cargo test -p bonding-curve` |
| **Full suite command** | `cargo test -p bonding-curve` |
| **Estimated runtime** | ~47s (37 total tests including 6 sell-specific proptest properties at 1M iterations each) |

## Per-Requirement Verification Map

| Requirement | Test Type | Evidence | Status |
|-------------|-----------|----------|--------|
| CURVE-03 | proptest + unit | `math.rs::buy_sell_round_trip_always_loses (1M)`, `math.rs::sell_at_extremes (1M)`, sell.rs reverse integral via `calculate_sol_for_tokens` (line 166), ceil-rounded 15% tax (lines 174-179), slippage check (line 191). 72-VERIFICATION.md Truth #1, #2. | COVERED |
| CURVE-04 | unit | sell.rs Anchor constraint (line 36): `curve_state.status == CurveStatus::Active @ CurveError::CurveNotActiveForSell`. Handler double-check at lines 121-124. purchase.rs sets Filled when `tokens_sold >= TARGET_TOKENS`. 72-VERIFICATION.md Truth #3. | COVERED |
| SAFE-02 | proptest | `math.rs::vault_solvency_mixed_buy_sell (1M)` -- 3-8 random buy/sell ops with solvency checked after each. `math.rs::multi_user_solvency (1M)` -- 2-5 users with independent actions. sell.rs post-state solvency assertion (lines 284-292) using `Rent::get()?.minimum_balance(0)` and `VaultInsolvency` error. 72-VERIFICATION.md Truth #4, #5. | COVERED |

## Manual-Only Verifications

All phase behaviors have automated verification. No manual-only items.

## Validation Sign-Off

- [x] All requirements have verification evidence mapped
- [x] nyquist_compliant: true set in frontmatter
- [x] Retroactive transparency note included

**Approval:** approved 2026-03-07
