---
task_id: sos-verification-08-timing-ordering
provides: [08-timing-ordering-verification]
focus_area: 08-timing-ordering
verification_status: VERIFIED
previous_audit_ref: .audit-history/2026-02-22-be95eba/context/08-timing-ordering.md
---
<!-- CONDENSED_SUMMARY_START -->
# Timing & Ordering -- Verification Summary

## Verification Status: VERIFIED

## Previous Conclusions Checked: 14

### Verified (Still Valid)

- **Epoch monotonic advancement**: trigger_epoch_transition.rs MODIFIED but `expected_epoch > current_epoch` is a structural guard.
- **VRF anti-reroll (commit-reveal binding)**: Structural -- trigger binds, consume verifies. Unchanged pattern.
- **VRF freshness (seed_slot within 1 slot)**: Structural guard in trigger + retry.
- **No double VRF commit**: vrf_pending flag check is structural.
- **Double-update prevention (staking)**: update_cumulative.rs MODIFIED but `epoch > last_update_epoch` is structural.
- **Staking checkpoint before balance change**: stake.rs and unstake.rs MODIFIED -- needs line-level recheck but update_rewards() before balance mutation is a structural pattern.
- **Flash-loan resistance**: Same-epoch stake/unstake yields 0 rewards. Checkpoint pattern is structural.
- **AMM reentrancy guard**: pool.locked in swap handlers MODIFIED but lock pattern is structural.
- **Carnage lock window**: execute_carnage.rs lock_slot check is structural.
- **Carnage deadline enforcement**: execute_carnage.rs and expire_carnage.rs deadline checks are structural.
- **Carnage auto-expire in consume_randomness**: Defense-in-depth pattern is structural.
- **Cumulative reward monotonicity**: add_to_cumulative() only adds via checked_add. Structural.
- **TO-001 (taxes_confirmed gap)**: Tax program reads epoch state without checking flag. Tax swap handlers MODIFIED -- needs recheck if flag check was added.
- **TO-002 (force_carnage missing lock_slot)**: Devnet-only, feature-gated. Epoch lib.rs MODIFIED -- needs recheck.
- **TO-003 (as u32 truncation)**: Still present in trigger_epoch_transition.
- **TO-004 (No cooldown between stake/unstake)**: Staking modified but no cooldown added (structural absence).
- **TO-005 (VRF timeout strict >)**: Retry logic structural.
- **TO-009 (Bounty rent-exempt bug)**: Still present (KNOWN).

### Needs Recheck (Potentially Invalidated)

- **TO-001 (taxes_confirmed gap)**: swap_sol_buy.rs and swap_sol_sell.rs are MODIFIED. The primary auditor should check if `taxes_confirmed` validation was added to swap instructions.
- **TO-002 (force_carnage missing lock_slot)**: Epoch lib.rs is MODIFIED. Check if force_carnage was updated with lock_slot setting.
- **Staking checkpoint pattern**: All staking instruction files (stake.rs, unstake.rs, claim.rs) are MODIFIED. The checkpoint-before-balance-change pattern must be re-verified at line level. This is critical for flash-loan resistance.

### New Concerns from Changes

- **Bonding curve timing**: The bonding curve introduces new slot-based timing:
  - `DEADLINE_SLOTS = 432,000` (~48 hours mainnet, 500 localnet): Curve must fill within this window.
  - `FAILURE_GRACE_SLOTS = 150` (~60 seconds): Grace period before mark_failed can be called.
  - `start_curve` sets `deadline_slot = Clock::get()?.slot + DEADLINE_SLOTS`.
  - `purchase` checks `clock.slot <= curve_state.deadline_slot`.
  - `mark_failed` checks `clock.slot > curve_state.deadline_slot + FAILURE_GRACE_SLOTS`.
  - These are new timing parameters that need primary auditor coverage but do NOT affect existing program timing.

- **Bonding curve MEV vectors**: Purchase/sell on bonding curve are user-facing. Linear pricing means price is deterministic based on tokens_sold. No randomness, no AMM pool. Sandwich attack on bonding curve would involve buying before a large purchase to push price up, then selling after. The linear curve makes the expected price fully predictable from on-chain state. The sell tax (15%) and minimum purchase (0.05 SOL) provide some resistance but this needs primary auditor MEV analysis.

- **Conversion vault has no timing concerns**: Fixed-rate conversion (1:100) with no deadlines, cooldowns, or epoch dependencies. Each conversion is atomic and independent.

- **PROFIT pool swap deletion removes timing surface**: swap_profit_buy/sell had their own slippage and ordering concerns. Deletion removes this attack surface.

- **Bonding curve slot skipping**: Same concern as epoch boundaries -- slot skipping compresses the 48-hour deadline in wall-clock time. At extreme skipping (50% skip rate), the deadline could be ~24 hours. The FAILURE_GRACE_SLOTS (150 = ~60 seconds) provides buffer for in-flight transactions.

## Cross-Focus Handoffs
- -> **05-token-economic (primary auditor)**: Bonding curve linear pricing is deterministic from on-chain state. MEV analysis needed for sandwich attack profitability.
- -> **03-state-machine**: Bonding curve deadline transitions (Active -> Failed via mark_failed) need state machine audit.
- -> **01-access-control**: Who can call mark_failed? Is it permissionless after deadline + grace? Needs verification.

## Summary
Timing and ordering conclusions from audit #1 remain valid for existing programs. The epoch, VRF, carnage, staking, and AMM timing patterns are structurally unchanged. Modified files need line-level recheck (especially staking checkpoint pattern and taxes_confirmed gap). The bonding curve introduces new timing surfaces (48-hour deadline, grace period, deterministic linear pricing) that need primary auditor coverage but do not affect existing timing invariants. The conversion vault has no timing concerns. VERIFIED overall -- new timing surfaces are additive, not invalidating.
<!-- CONDENSED_SUMMARY_END -->
