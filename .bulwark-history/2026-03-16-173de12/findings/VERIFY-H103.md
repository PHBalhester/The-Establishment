# VERIFY-H103: Bounty Rent-Exempt Gap
**Status:** FIXED
**Verified:** 2026-03-09
**Previous:** FIXED

## Evidence
No regression. `programs/epoch-program/src/instructions/trigger_epoch_transition.rs` lines 206-211 still calculate `rent_exempt_min = rent.minimum_balance(0)` and use `bounty_threshold = TRIGGER_BOUNTY_LAMPORTS.checked_add(rent_exempt_min)`. Additionally, `carnage_execution.rs` lines 260-261 also account for rent-exempt minimum when calculating available SOL. Phase 89 commit added a `MAX_TOPUP_LAMPORTS` ceiling (0.1 SOL) to the crank top-up logic as defense in depth.

## Assessment
Fix confirmed and strengthened with spending cap on crank top-ups.
