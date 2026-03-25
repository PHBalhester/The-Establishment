---
status: fixing
trigger: "The last 5 carnage fund triggers on the live devnet deploy have all selected CRIME faction. VRF should produce a random 50/50 split between CRIME and FRAUD."
created: 2026-03-16T00:00:00Z
updated: 2026-03-16T01:00:00Z
---

## Current Focus

hypothesis: CONFIRMED - buildExecuteCarnageAtomicIx reads stale carnage_target to resolve Transfer Hook accounts BEFORE consume_randomness runs, causing FRAUD-targeted TX to fail
test: Traced full code path from crank -> vrf-flow -> carnage-flow -> on-chain
expecting: Fix by resolving hook accounts for BOTH mints and sending all 8 (2x4) as remaining_accounts
next_action: Implement fix in buildExecuteCarnageAtomicIx to always send hook accounts for both mints

## Symptoms

expected: Random 50/50 split between CRIME and FRAUD factions on each carnage trigger, driven by Switchboard VRF randomness
actual: Last 5 consecutive carnage triggers all selected CRIME faction
errors: Not checked yet (FRAUD-targeted attempts fail silently -- TX reverts, crank retries with fresh randomness until CRIME is selected)
reproduction: Observe carnage fund triggers over multiple epochs on current devnet deployment
started: Likely since Phase 95 deployment or whenever atomic carnage bundling was introduced

## Eliminated

## Evidence

- timestamp: 2026-03-16T00:10:00Z
  checked: On-chain get_carnage_target in helpers/carnage.rs
  found: Logic is correct - byte 7 < 128 = Crime, >= 128 = Fraud (perfect 50/50)
  implication: Bug is NOT in on-chain randomness interpretation

- timestamp: 2026-03-16T00:15:00Z
  checked: buildExecuteCarnageAtomicIx in carnage-flow.ts lines 300-410
  found: Function reads rawState.carnageTarget BEFORE consumeRandomness runs (line 312-317), uses stale value to resolve Transfer Hook accounts
  implication: Hook accounts are resolved for the WRONG mint when VRF picks a different target than the stale state

- timestamp: 2026-03-16T00:20:00Z
  checked: sendRevealAndConsume in vrf-flow.ts lines 289-361
  found: TX3 bundles reveal + consume + executeCarnageAtomic. buildExecuteCarnageAtomicIx is called before the TX is sent, reading pre-consume state.
  implication: carnage_target is always stale when hook accounts are resolved

- timestamp: 2026-03-16T00:25:00Z
  checked: epoch_state initialization (initialize_epoch_state.rs line 72)
  found: carnage_target initialized to 0 (CRIME). execute_carnage_core does NOT reset it after execution.
  implication: Stale carnage_target is always 0 (CRIME) until a successful CRIME Carnage runs, then it stays 0

- timestamp: 2026-03-16T00:30:00Z
  checked: Transfer Hook account resolution (resolveHookAccounts in swap-flow.ts)
  found: Uses createTransferCheckedWithTransferHookInstruction which derives mint-specific ExtraAccountMetaList PDA
  implication: CRIME and FRAUD hooks are different - sending CRIME hooks for a FRAUD swap causes on-chain failure

- timestamp: 2026-03-16T00:35:00Z
  checked: Crank VRF retry behavior (vrf-flow.ts lines 737-831)
  found: When TX3 fails, crank falls through to VRF timeout recovery which creates fresh randomness. Fresh VRF may pick either target. Only CRIME succeeds because hooks match.
  implication: The crank keeps retrying until VRF randomly picks CRIME, making it appear that Carnage always selects CRIME

- timestamp: 2026-03-16T00:40:00Z
  checked: on-chain remaining_accounts partitioning (partition_hook_accounts)
  found: For Burn/BuyOnly, all remaining_accounts are buy_hook_accounts. For Sell, first 4 = sell, rest = buy.
  implication: Since hooks are always sent for both targets, we can always send BOTH sets and let on-chain partition correctly

## Resolution

root_cause: buildExecuteCarnageAtomicIx (carnage-flow.ts:312-317) reads stale epochState.carnageTarget before consume_randomness runs in the same TX. It uses this stale value (always 0=CRIME, since carnage_target is never reset) to resolve Transfer Hook remaining_accounts. When VRF picks FRAUD, the wrong hook accounts cause the on-chain Transfer Hook to fail, reverting the entire TX3. The crank retries with fresh randomness until CRIME is randomly selected. Result: Carnage can only ever target CRIME.
fix: Always resolve hook accounts for BOTH CRIME and FRAUD mints (8 accounts total: 4 CRIME + 4 FRAUD), and send them all as remaining_accounts. On-chain execute_carnage_core already receives both pools/vaults as named accounts and selects the correct one based on the fresh carnage_target. The remaining_accounts just need to include hooks for both mints so the correct set is available regardless of which target VRF selects.
verification:
files_changed: []
