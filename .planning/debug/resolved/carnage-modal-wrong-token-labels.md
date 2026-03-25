---
status: resolved
trigger: "carnage-fund-modal-wrong-token-labels"
created: 2026-03-25T00:00:00Z
updated: 2026-03-25T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED - storeCarnageEvent assigns tokensBurned to crimeBurned/fraudBurned based on `target` (buy target), but burned tokens come from held tokens (previous epoch's buy target)
test: Trace on-chain carnage flow to verify target=buy target, burned=held tokens
expecting: target is the token being BOUGHT, not burned
next_action: Implement fix in storeCarnageEvent and CarnageStation display

## Symptoms

expected: When carnage triggers, show correct labels - "Burned 2.33M CRIME" and "Bought 60K FRAUD"
actual: Modal shows "Burned 2.33M FRAUD" - labels are swapped/incorrect
errors: No errors - display/logic bug only
reproduction: View Carnage Fund modal, check Epoch 468 event against on-chain TX
started: Long-standing display bug, on-chain logic is correct

## Eliminated

## Evidence

- timestamp: 2026-03-25
  checked: On-chain CarnageExecuted event struct
  found: target field = which token to BUY (VRF-selected). tokensBurned = held tokens from previous epoch, which could be different token.
  implication: storeCarnageEvent maps tokensBurned to crimeBurned/fraudBurned based on target, which is wrong

- timestamp: 2026-03-25
  checked: burn_held_tokens function in carnage_execution.rs
  found: Burns based on carnage_state.held_token (1=CRIME, 2=FRAUD). held_token is set to target.to_u8()+1 after each execution. So held_token for epoch N = target from epoch N-1.
  implication: The burned token is NOT the current target, it's the PREVIOUS epoch's target

- timestamp: 2026-03-25
  checked: CarnageStation.tsx display logic lines 232-256
  found: Shows "Burned {tokensBurned} {event.targetToken}" where targetToken = buy target, not burned token
  implication: Display labels burned amount with wrong token name

- timestamp: 2026-03-25
  checked: On-chain CarnageFundState.total_crime_burned / total_fraud_burned
  found: These are correctly tracked on-chain using held_token (not target). useCarnageData reads these directly.
  implication: LIFETIME STATS are correct (from on-chain state). Only PER-EVENT labels are wrong.

## Resolution

root_cause: storeCarnageEvent in webhook route.ts assigns tokensBurned to crimeBurned/fraudBurned based on `target` (the token being BOUGHT), but burned tokens come from held tokens (the PREVIOUS epoch's buy target, a different token). CarnageStation.tsx then displays "Burned X {targetToken}" where targetToken is the buy target, compounding the error with wrong label AND wrong column.
fix: 1) Fixed storeCarnageEvent in webhook route.ts to query previous carnage event's targetToken to determine which token was burned (held tokens = previous epoch's buy target). 2) Fixed CarnageStation.tsx display to derive burnedToken from crimeBurned/fraudBurned columns (whichever is non-zero) and show correct labels for burned vs bought. 3) Added `desc` import from drizzle-orm for the previous-event query. 4) Created scripts/fix-carnage-burned-columns.sql to correct historical DB data.
verification: TypeScript compiles without new errors. SQL script includes dry-run preview query and post-update verification SELECT. Script is idempotent (safe to run multiple times). Awaiting user to run SQL against Railway Postgres and deploy code changes.
files_changed:
- app/app/api/webhooks/helius/route.ts (storeCarnageEvent + desc import)
- app/components/station/CarnageStation.tsx (display logic)
- scripts/fix-carnage-burned-columns.sql (one-time DB correction)
