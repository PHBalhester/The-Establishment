---
phase: 71-curve-foundation
plan: 03
subsystem: bonding-curve-program
tags: [anchor, solana, bonding-curve, lifecycle, token-2022, pda]
dependency-graph:
  requires: [71-01]
  provides: [initialize_curve, fund_curve, start_curve, events]
  affects: [71-04, 72, 73]
tech-stack:
  added: []
  patterns: [anchor-instruction-dispatch, token-2022-transfer-checked, sol-only-pda, feature-gated-mint-validation]
key-files:
  created:
    - programs/bonding_curve/src/events.rs
    - programs/bonding_curve/src/instructions/initialize_curve.rs
    - programs/bonding_curve/src/instructions/fund_curve.rs
    - programs/bonding_curve/src/instructions/start_curve.rs
  modified:
    - programs/bonding_curve/src/instructions/mod.rs
    - programs/bonding_curve/src/lib.rs
decisions:
  - "fund_curve uses authority as direct signer (not PDA signer) -- admin holds tokens and transfers directly"
  - "fund_curve accepts remaining_accounts for Transfer Hook forwarding via .with_remaining_accounts()"
  - "Mint validation uses OR constraint (crime_mint || fraud_mint) with localnet bypass, matching conversion-vault pattern"
  - "Dispatch uses fully qualified paths (instructions::module::handler) to avoid glob re-export ambiguity"
metrics:
  duration: "~3 minutes"
  completed: "2026-03-03"
---

# Phase 71 Plan 03: Lifecycle Instructions Summary

**One-liner:** Three admin-only lifecycle instructions (initialize, fund, start) with 13 spec-exact events, Token-2022 transfer_checked, and 4-PDA initialization.

## What Was Built

### events.rs (160 lines)
All 13 event structs from Bonding_Curve_Spec.md Section 10, covering the full program lifecycle:
- **Lifecycle:** CurveInitialized, CurveFunded, CurveStarted, CurveFilled, CurveFailed
- **Trade:** TokensPurchased, TokensSold
- **Tax Escrow:** TaxCollected, EscrowConsolidated, EscrowDistributed
- **Refund:** RefundClaimed
- **Graduation:** TransitionPrepared, TransitionComplete

All events defined upfront so future phases (72, 73) won't need to modify this file.

### initialize_curve.rs (119 lines)
Creates 4 PDAs in a single transaction:
- `curve_state`: CurveState account with seeds `["curve", token_mint]`
- `token_vault`: Token-2022 account with seeds `["curve_token_vault", token_mint]`, authority = curve_state
- `sol_vault`: 0-byte SOL-only PDA with seeds `["curve_sol_vault", token_mint]`
- `tax_escrow`: 0-byte SOL-only PDA with seeds `["tax_escrow", token_mint]`

Sets all CurveState fields per spec Section 8.1: status = Initialized, all counters zeroed, stores PDA keys and bump. Feature-gated mint validation (localnet bypass).

### fund_curve.rs (100 lines)
Transfers TARGET_TOKENS (460M) from admin's token account to curve token vault using `anchor_spl::token_2022::transfer_checked`. Key design decisions:
- Authority signs directly (not PDA signer) -- admin holds tokens during deployment
- Status constraint: curve must be Initialized
- Passes `ctx.remaining_accounts` through to CPI for Transfer Hook support
- Uses generic `'info` lifetime for remaining_accounts compatibility

### start_curve.rs (76 lines)
Activates the curve after funding:
- Validates status == Initialized (account constraint)
- Validates `token_vault.amount >= TARGET_TOKENS` (rejects unfunded curves)
- Sets status = Active, start_slot = current slot, deadline_slot = start_slot + 432,000 (~48h)
- Emits CurveStarted event

### lib.rs dispatch
Replaced all stub dispatchers with real handler calls:
- `initialize_curve(ctx, token)` -> `instructions::initialize_curve::handler`
- `fund_curve(ctx)` -> `instructions::fund_curve::handler`
- `start_curve(ctx)` -> `instructions::start_curve::handler`
- `purchase` kept as stub for Plan 04

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Authority signs fund_curve directly (not PDA signer) | Simpler deployment flow -- admin holds minted tokens and transfers them. No need for a separate reserve PDA. |
| remaining_accounts forwarded to transfer CPI | CRIME/FRAUD use Token-2022 Transfer Hooks. Hook accounts must be passed through or transfer fails with error 3005. |
| Mint validation uses OR constraint with localnet bypass | Matches conversion-vault pattern exactly. Devnet/mainnet validate against known addresses; localnet accepts any mint for testing. |
| Fully qualified handler paths in dispatch | Avoids Rust ambiguous glob re-export warning when multiple modules export `handler`. |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `pub mod events;` to lib.rs in Task 1**
- **Found during:** Task 1
- **Issue:** Instruction modules import from `crate::events`, but the module wasn't declared in lib.rs yet (planned for Task 2). This blocked compilation.
- **Fix:** Added `pub mod events;` to lib.rs as part of Task 1 to unblock instruction compilation.
- **Files modified:** programs/bonding_curve/src/lib.rs
- **Commit:** cfc7f74

## Verification Results

| Check | Result |
|-------|--------|
| `cargo check -p bonding-curve` | Pass (zero errors, only standard Anchor cfg warnings) |
| events.rs has all 13 spec events | Pass (13 `#[event]` attributes) |
| initialize_curve creates 4 PDAs | Pass (4 seed constants referenced) |
| fund_curve uses transfer_checked | Pass (Token-2022 transfer_checked CPI) |
| start_curve validates funding + sets deadline | Pass (TARGET_TOKENS check + DEADLINE_SLOTS addition) |
| lib.rs dispatches all 3 instructions | Pass (3 fully qualified handler calls) |

## Next Phase Readiness

Plan 03 is complete. The program is ready for:
- **Plan 04 (purchase instruction):** All lifecycle setup is in place. The purchase instruction will reference CurveState, events (TokensPurchased, CurveFilled), and the math module (from Plan 02).
- **Phase 72 (sell instruction):** Events for TokensSold, TaxCollected are already defined.
- **Phase 73 (graduation/refund):** Events for RefundClaimed, TransitionPrepared, TransitionComplete are already defined.

No blockers.
