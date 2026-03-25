---
phase: 79-financial-safety
verified: 2026-03-08T11:15:00Z
status: passed
score: 7/7 must-haves verified
---

# Phase 79: Financial Safety Verification Report

**Phase Goal:** Protect protocol finances against rent-exempt drain, sell-path floor manipulation, and bonding curve overcharge/identity attacks
**Verified:** 2026-03-08T11:15:00Z
**Status:** passed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Staking claim rejects when escrow balance minus rent-exempt is less than rewards_to_claim | VERIFIED | `claim.rs:106-113` — `Rent::get()?.minimum_balance(0)` subtracted from escrow_balance before comparison |
| 2 | Tax sell path passes a computed gross floor to AMM CPI instead of 0 | VERIFIED | `swap_sol_sell.rs:147-167` — `gross_floor = ceil(minimum_output * 10000 / (10000 - tax_bps))` using u128 intermediates, assigned to `amm_minimum` and written to CPI instruction data |
| 3 | Epoch trigger skips bounty when vault balance is less than bounty plus rent-exempt minimum | VERIFIED | `trigger_epoch_transition.rs:197-203` — `bounty_threshold = TRIGGER_BOUNTY_LAMPORTS.checked_add(rent_exempt_min)`, bounty skipped if vault_balance < threshold |
| 4 | Bonding curve purchase has explicit `require!(actual_sol <= sol_amount)` after partial fill recalculation | VERIFIED | `purchase.rs:171` — `require!(actual_sol <= sol_amount, CurveError::PartialFillOvercharge)` |
| 5 | Bonding curve sell has defensive assertion that sol_gross does not exceed vault available balance | VERIFIED | `sell.rs:175-179` — pre-transfer guard: `available = vault_lamports.saturating_sub(rent_exempt)`, `require!(sol_gross <= available, CurveError::VaultInsolvency)` |
| 6 | claim_refund validates partner_curve_state.token_mint matches curve_state.partner_mint | VERIFIED | `claim_refund.rs:116-119` — `require!(ctx.accounts.partner_curve_state.token_mint == curve.partner_mint, CurveError::InvalidPartnerCurve)` |
| 7 | consolidate_for_refund validates partner_curve_state.token_mint matches curve_state.partner_mint | VERIFIED | `consolidate_for_refund.rs:98-101` — identical validation |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `programs/staking/src/instructions/claim.rs` | Rent-exempt reservation before reward transfer | VERIFIED | Lines 105-113: `minimum_balance(0)` subtracted, `available < rewards_to_claim` check |
| `programs/tax-program/src/instructions/swap_sol_sell.rs` | Gross floor computation passed to AMM minimum_amount_out | VERIFIED | Lines 147-174: ceil-division formula, `amm_minimum = gross_floor`, written to CPI ix_data |
| `programs/epoch-program/src/instructions/trigger_epoch_transition.rs` | Rent-aware bounty threshold check | VERIFIED | Lines 197-203: `checked_add(rent_exempt_min)` with `Overflow` error variant |
| `programs/bonding_curve/src/state.rs` | CurveState with partner_mint field | VERIFIED | Line 154: `pub partner_mint: Pubkey`, LEN=232 (8+224), test assertions updated |
| `programs/bonding_curve/src/instructions/purchase.rs` | Partial fill overcharge assertion | VERIFIED | Line 171: `require!(actual_sol <= sol_amount, PartialFillOvercharge)` |
| `programs/bonding_curve/src/instructions/sell.rs` | Pre-transfer vault solvency guard | VERIFIED | Lines 175-179: rent-aware available balance check before transfer |
| `programs/bonding_curve/src/instructions/claim_refund.rs` | Partner curve identity validation via partner_mint | VERIFIED | Lines 116-119: token_mint == partner_mint |
| `programs/bonding_curve/src/instructions/consolidate_for_refund.rs` | Partner curve identity validation via partner_mint | VERIFIED | Lines 98-101: token_mint == partner_mint |
| `programs/bonding_curve/src/error.rs` | PartialFillOvercharge and InvalidPartnerCurve error variants | VERIFIED | Lines 117-122: both variants present with descriptive messages |
| `programs/bonding_curve/src/instructions/initialize_curve.rs` | Accepts and stores partner_mint parameter | VERIFIED | Line 102: handler signature includes `partner_mint: Pubkey`, line 121: stored to state |
| `programs/bonding_curve/src/lib.rs` | Updated instruction dispatch with partner_mint | VERIFIED | Line 43-44: `initialize_curve(ctx, token, partner_mint)` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| claim.rs | Rent sysvar | `Rent::get()?.minimum_balance(0)` | WIRED | Line 106: rent obtained, line 110: subtracted from escrow_balance |
| swap_sol_sell.rs | AMM CPI minimum_amount_out | gross_floor replaces hardcoded 0 | WIRED | Line 167: `amm_minimum = gross_floor`, line 174: written to CPI instruction bytes |
| trigger_epoch_transition.rs | Bounty payment condition | rent_exempt added to threshold | WIRED | Lines 200-202: `TRIGGER_BOUNTY_LAMPORTS.checked_add(rent_exempt_min)` |
| initialize_curve.rs | CurveState.partner_mint | Sets partner_mint during initialization | WIRED | Line 121: `curve.partner_mint = partner_mint` |
| claim_refund.rs | CurveState.partner_mint | Validates partner identity | WIRED | Line 117: `partner_curve_state.token_mint == curve.partner_mint` |
| consolidate_for_refund.rs | CurveState.partner_mint | Validates partner identity | WIRED | Line 99: identical validation |

### Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| FIN-01: Staking claim reserves rent-exempt minimum before transferring rewards | SATISFIED | None |
| FIN-02: Tax sell path passes computed gross minimum to AMM CPI (not `minimum_amount_out = 0`) | SATISFIED | None |
| FIN-03: Epoch bounty payment checks vault_balance >= bounty + rent_exempt_min | SATISFIED | None |
| FIN-04: Bonding Curve purchase partial fill has explicit `actual_sol <= sol_amount` assertion | SATISFIED | None |
| FIN-05: Bonding Curve claim_refund validates partner curve is actual CRIME/FRAUD counterpart | SATISFIED | None |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | - | - | - | No anti-patterns detected in modified files |

### Human Verification Required

### 1. Deployment Script Update
**Test:** Verify `scripts/deploy/initialize.ts` passes `partner_mint` to `initialize_curve` instruction
**Expected:** CRIME curve initialized with FRAUD mint as partner_mint, and vice versa
**Why human:** CurveState schema change (LEN 200->232) and new parameter require deployment script update and IDL regeneration. Summary notes this is deferred to deployment phase.

---

_Verified: 2026-03-08T11:15:00Z_
_Verifier: Claude (gsd-verifier)_
