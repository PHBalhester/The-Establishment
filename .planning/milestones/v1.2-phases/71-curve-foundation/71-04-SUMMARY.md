---
phase: 71-curve-foundation
plan: 04
subsystem: program
tags: [anchor, rust, bonding-curve, token-2022, transfer-hook, purchase, linear-integral]

# Dependency graph
requires:
  - phase: 71-01
    provides: CurveState, CurveStatus, Token, CurveError, constants, PDA seeds
  - phase: 71-02
    provides: calculate_tokens_out, calculate_sol_for_tokens, get_current_price math functions
  - phase: 71-03
    provides: initialize_curve, fund_curve, start_curve lifecycle instructions, events
provides:
  - Purchase instruction (buy tokens from curve with SOL)
  - Token-2022 Transfer Hook CPI pattern for bonding curve vault
  - Per-wallet cap enforcement via ATA balance read
  - Partial fill logic for boundary purchases
  - Filled status transition when target reached
  - Complete BPF-compiled bonding_curve program (.so)
  - Program ID registered in Anchor.toml
affects: [72-sell-instruction, 73-graduation-refunds, 74-devnet-deployment]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Manual invoke_signed for Token-2022 transfer_checked with Transfer Hook remaining_accounts"
    - "init_if_needed ATA with Token-2022 InterfaceAccount for first-time buyers"
    - "Box<InterfaceAccount> for Token-2022 accounts to prevent BPF stack overflow"
    - "Lifetime annotations for remaining_accounts forwarding: Context<'_, '_, 'info, 'info, T<'info>>"

key-files:
  created:
    - "programs/bonding_curve/src/instructions/purchase.rs"
  modified:
    - "programs/bonding_curve/src/instructions/mod.rs"
    - "programs/bonding_curve/src/lib.rs"
    - "Anchor.toml"

key-decisions:
  - "Box<InterfaceAccount> for token_vault, user_token_account, token_mint to prevent stack overflow"
  - "Manual invoke_signed for Token-2022 transfer instead of Anchor CPI (remaining_accounts forwarding)"
  - "Slippage parameter (minimum_tokens_out) added per spec Section 8.5"
  - "Program ID: AGhdAzP6Hcf3hmib79MdFbMMF5xjzTUEShB7hsTa62K1"

patterns-established:
  - "Purchase instruction pattern: validate -> calculate -> partial fill -> transfer SOL -> transfer tokens (hook) -> update state -> emit"
  - "Curve PDA as token vault authority with signer seeds [CURVE_SEED, mint.as_ref(), &[bump]]"

# Metrics
duration: 5min
completed: 2026-03-03
---

# Phase 71 Plan 04: Purchase Instruction Summary

**Core buy instruction with linear integral pricing, wallet cap enforcement, partial fills, Token-2022 Transfer Hook CPI, and Filled status transition -- program compiles for BPF (352KB .so)**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-03T22:17:19Z
- **Completed:** 2026-03-03T22:22:02Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Implemented spec Section 8.5 purchase instruction with all 15 validation/logic/event steps
- Token-2022 Transfer Hook CPI via manual invoke_signed with remaining_accounts forwarding
- Per-wallet cap (20M tokens) enforced via ATA balance read before and after partial fill
- Partial fill at boundary: user gets remaining tokens, pays proportional SOL
- Filled status transition when tokens_sold >= TARGET_TOKENS (460M)
- BPF build succeeds with no stack overflow -- Box<InterfaceAccount> for large Token-2022 types
- All 27 tests pass (23 math tests + 5 proptest suites at 500K iterations + serialization/state tests)

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement purchase instruction with all validation and transfer logic** - `5fde2fe` (feat)
2. **Task 2: Anchor build verification and stack size fix** - `7797a81` (chore)

## Files Created/Modified
- `programs/bonding_curve/src/instructions/purchase.rs` - 310 lines: Purchase accounts struct + handler with full spec Section 8.5 logic
- `programs/bonding_curve/src/instructions/mod.rs` - Added purchase module re-export
- `programs/bonding_curve/src/lib.rs` - Real purchase dispatch with lifetime annotations, declare_id! set
- `Anchor.toml` - bonding_curve registered in [programs.devnet] and [programs.localnet]

## Decisions Made
- **Box<InterfaceAccount> for Token-2022 types:** user_token_account, token_vault, and token_mint are Box'd to keep the Purchase struct within BPF stack limits. This follows the project's documented pattern for large instruction structs (20+ accounts).
- **Manual invoke_signed for token transfer:** Following the conversion-vault hook_helper.rs pattern. Anchor's CPI framework does not forward remaining_accounts through the Transfer Hook CPI chain. The curve_state PDA signs with seeds [CURVE_SEED, token_mint.as_ref(), &[bump]].
- **Slippage protection via minimum_tokens_out:** The spec mentions this parameter. Added as a third argument to the purchase instruction for user-side slippage control.
- **Participant count uses saturating_add:** Prevents overflow if participant_count somehow reaches u32::MAX (defensive, not expected in practice).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Solana CLI v3 `solana address -k` command failed for keypair file reading (flag broken in v3). Resolved by reading keypair bytes directly and computing pubkey via bs58 encoding in Node.js.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Bonding curve program is BPF-compiled and ready for Phase 72 (sell instruction)
- All 4 instructions (initialize, fund, start, purchase) compile and link correctly
- Math module proven correct with 2.5M proptest iterations
- Program ready for Phase 74 (devnet deployment) after sell instruction (Phase 72) and graduation (Phase 73)

---
*Phase: 71-curve-foundation*
*Completed: 2026-03-03*
