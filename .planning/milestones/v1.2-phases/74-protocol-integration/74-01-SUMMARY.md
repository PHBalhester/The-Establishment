---
phase: 74-protocol-integration
plan: 01
subsystem: on-chain
tags: [anchor, rust, solana, bonding-curve, graduation, token-2022, pda]

# Dependency graph
requires:
  - phase: 71-curve-foundation
    provides: "CurveState struct, CurveStatus enum, CurveError variants, PDA seeds"
  - phase: 72-sell-instruction
    provides: "Sell instruction pattern, solvency checks, tax escrow"
  - phase: 73-graduation-refund
    provides: "prepare_transition (Filled->Graduated), claim_refund (lamport manipulation pattern)"
provides:
  - "withdraw_graduated_sol instruction for extracting SOL from graduated vaults"
  - "close_token_vault instruction for closing empty graduated token vaults"
  - "SolWithdrawn and TokenVaultClosed events for indexer/monitoring"
affects: ["74-02 deploy pipeline", "74-04 graduation script", "74-05 lifecycle tests"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Token-2022 close_account CPI with PDA signer for vault cleanup"
    - "Idempotent admin instruction pattern (no-op on repeat calls)"

key-files:
  created:
    - "programs/bonding_curve/src/instructions/withdraw_graduated_sol.rs"
    - "programs/bonding_curve/src/instructions/close_token_vault.rs"
  modified:
    - "programs/bonding_curve/src/instructions/mod.rs"
    - "programs/bonding_curve/src/lib.rs"
    - "programs/bonding_curve/src/events.rs"

key-decisions:
  - "No new error variants added -- reused CurveNotGraduated and InvalidStatus"
  - "Box<InterfaceAccount> for token_vault in CloseTokenVault (BPF stack overflow prevention)"
  - "close_token_vault uses derive-level constraint for empty vault check (amount == 0)"
  - "Both instructions are idempotent: withdraw returns Ok on 0 withdrawable, close enforces 0 balance"

patterns-established:
  - "Admin post-graduation instruction pattern: Graduated constraint + authority signer + PDA seed validation"
  - "Token-2022 close_account CPI with CurveState PDA signer seeds"

# Metrics
duration: 4min
completed: 2026-03-04
---

# Phase 74 Plan 01: Post-Graduation Vault Instructions Summary

**Two new on-chain instructions (withdraw_graduated_sol + close_token_vault) enabling admin to extract SOL and close token vaults from graduated curves for AMM pool seeding**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-04T21:50:43Z
- **Completed:** 2026-03-04T21:55:05Z
- **Tasks:** 2/2
- **Files modified:** 5

## Accomplishments

- Added `withdraw_graduated_sol` instruction: admin withdraws all SOL (minus rent-exempt minimum) from graduated curve's SOL vault using direct lamport manipulation (same pattern as claim_refund.rs)
- Added `close_token_vault` instruction: admin closes empty token vault from graduated curve via Token-2022 close_account CPI with CurveState PDA as authority signer, recovering rent
- Both instructions enforce Graduated status via Anchor constraint, preventing use on Active/Filled/Failed curves
- Program compiles for BPF target (anchor build -p bonding_curve); all 51 existing tests pass (2 pre-existing proptest regressions unchanged)
- Added SolWithdrawn and TokenVaultClosed events for indexer/monitoring integration
- Program now has 12 instructions total (10 original + 2 graduation support)

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement withdraw_graduated_sol instruction** - `cb4aeec` (feat)
2. **Task 2: Implement close_token_vault + wire both in lib.rs + anchor build** - `6801bf6` (feat)

## Files Created/Modified

- `programs/bonding_curve/src/instructions/withdraw_graduated_sol.rs` - Admin SOL withdrawal from graduated curve vault (direct lamport manipulation)
- `programs/bonding_curve/src/instructions/close_token_vault.rs` - Admin token vault close via Token-2022 CPI with PDA signer
- `programs/bonding_curve/src/instructions/mod.rs` - Module registration for both new instructions
- `programs/bonding_curve/src/lib.rs` - Dispatch functions for withdraw_graduated_sol and close_token_vault
- `programs/bonding_curve/src/events.rs` - SolWithdrawn and TokenVaultClosed event definitions

## Decisions Made

- **No new error variants**: Reused existing `CurveNotGraduated` (already defined in Phase 73) and `InvalidStatus` for vault key mismatch and non-empty vault. Adding new errors would increase discriminator space for no practical benefit.
- **Derive-level empty vault check**: `constraint = token_vault.amount == 0` in the Accounts struct rather than handler-level require!. This is cleaner -- Anchor rejects the TX before the handler runs, saving compute units.
- **Box<InterfaceAccount> for token_vault**: Prevents BPF stack overflow with Token-2022 account types (established pattern from Purchase struct in Phase 71).
- **Idempotent design**: withdraw_graduated_sol returns Ok(()) when nothing to withdraw (vault at rent-exempt minimum). close_token_vault enforces empty vault at derive level. Both safe to call multiple times.

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None -- both instructions followed established patterns (claim_refund.rs for lamport manipulation, Token-2022 CPI for vault close).

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness

- Both instructions compiled and wired into the bonding curve program IDL
- Ready for 74-02 (deploy pipeline) to build and deploy the updated program
- Ready for 74-04 (graduation script) to call these instructions in the graduation sequence
- Ready for 74-05 (lifecycle tests) to test graduation flow end-to-end

---
*Phase: 74-protocol-integration*
*Completed: 2026-03-04*
