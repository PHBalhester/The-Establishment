---
status: diagnosed
trigger: "Two devnet swap failures after Phase 106/106.1 changes. SOL->CRIME single-hop and SOL->PROFIT multi-hop both fail."
created: 2026-03-26T00:00:00Z
updated: 2026-03-26T15:00:00Z
---

## Current Focus

hypothesis: CONFIRMED -- Devnet Tax Program deployed at slot 450903202 (2026-03-25 09:58 UTC) was built from post-5ac82c8 source with mainnet cross-program IDs. All three cross-program references (AMM, Epoch, Staking) resolve to mainnet program IDs, causing ConstraintSeeds failures for PDAs derived from those programs.
test: Verified deploy timestamp vs commit history, confirmed constants.rs state at deploy time
expecting: N/A -- root cause confirmed
next_action: Return diagnosis

## Symptoms

expected: SOL->CRIME single-hop swap and SOL->PROFIT multi-hop swap should succeed on devnet
actual: Both fail. SOL->PROFIT: "Transaction failed on-chain: InstructionError:[4,{"Custom":2006}]". SOL->CRIME: "Swap failed. Please try again or reduce swap amount."
errors: (1) InstructionError:[4,{"Custom":2006}] -- Anchor ConstraintSeeds (2006), instruction index 4. (2) Generic "Swap failed" UI error for single-hop (same root cause, error format not recognized by parseSwapError).
reproduction: Any swap on devnet Railway deployment. SOL->PROFIT multi-hop and SOL->CRIME single-hop both fail.
started: Pre-existing since March 25 Tax Program redeploy. NOT caused by Phase 106 or 106.1.

## Eliminated

- hypothesis: Phase 106.1 changes to multi-hop-builder.ts or useProtocolWallet.ts caused the failures
  evidence: Phase 106.1 only changed skipPreflight centralization. Before -- multi-hop set skipPreflight:true via isDevnet check, useProtocolWallet passed it through. After -- multi-hop sets skipPreflight:false, useProtocolWallet overrides to true on devnet. Net behavior identical. No transaction construction changes.
  timestamp: 2026-03-26T13:30:00Z

- hypothesis: Phase 106 vault convert_v2 upgrade broke swap path
  evidence: The vault program (9SGsfhx...) has different error codes (6000-6007). Error 2006 is Anchor ConstraintSeeds which occurs during Tax Program account validation, not vault. Vault instructions are at different instruction indices.
  timestamp: 2026-03-26T14:00:00Z

- hypothesis: ALT missing required addresses
  evidence: Verified ALT FwAetE... contains all 56 addresses including vault program, vault config, vault token accounts, all PDAs, pools, mints, hook accounts. Only treasury is missing from ALT (acceptable -- included as direct reference).
  timestamp: 2026-03-26T14:30:00Z

- hypothesis: Client passing wrong PDA addresses
  evidence: Independently derived all PDAs from devnet program IDs. All match devnet.json exactly -- SwapAuthority=DDLje, TaxAuthority=FAdys, StakePool=HNNet, EscrowVault=Qa1pJ, CarnageSolVault=BLhP2.
  timestamp: 2026-03-26T14:35:00Z

## Evidence

- timestamp: 2026-03-26T13:30:00Z
  checked: Phase 106.1 commit be9b653 diff
  found: Only 2 files changed. useProtocolWallet.ts forces skipPreflight:true on devnet. multi-hop-builder.ts removes isDevnet variable, sets skipPreflight:false (relying on wallet override). Functionally identical behavior.
  implication: Phase 106.1 is not the cause.

- timestamp: 2026-03-26T13:35:00Z
  checked: Phase 106 commits (ba922cd through 8976cdd)
  found: Phase 106 added convert_v2 to vault program, updated swap-builders to use convertV2, deployed vault upgrade to devnet at slot 451134342. Did NOT modify or redeploy Tax Program.
  implication: Phase 106 only affected vault, not the Tax Program where errors originate.

- timestamp: 2026-03-26T13:40:00Z
  checked: Tax Program constants.rs current state
  found: amm_program_id()="5JsSAL3k..." (MAINNET AMM), epoch_program_id()="4Heqc..." (MAINNET Epoch), staking_program_id()="12b3t..." (MAINNET Staking). All three are MAINNET IDs.
  implication: Source code has mainnet IDs, but the deployed binary is what matters.

- timestamp: 2026-03-26T14:00:00Z
  checked: Tax Program deploy timestamp via solana program show
  found: Last Deployed In Slot 450903202 = 2026-03-25 09:58:21 UTC
  implication: Deployed on March 25, need to check which source state was active at that time.

- timestamp: 2026-03-26T14:05:00Z
  checked: Commit history for programs/tax-program/src/constants.rs
  found: |
    Timeline:
    - 0bfa829 (2026-03-24 10:17): Patched amm_program_id to devnet AMM. Epoch+staking already had correct devnet IDs.
    - 5ac82c8 (2026-03-24 12:46): "restore mainnet constants" REVERTED all three cross-program IDs to mainnet.
    - 37de889 (2026-03-25): Added security_txt! macro (no ID changes)
    - Tax Program deployed at slot 450903202 = 2026-03-25 09:58 UTC
  implication: Tax Program was deployed AFTER 5ac82c8 reverted IDs to mainnet. The deployed binary has mainnet IDs.

- timestamp: 2026-03-26T14:10:00Z
  checked: Previous debug session (sol-swap-failures-post-graduation.md from 2026-03-23)
  found: SAME root cause diagnosed on March 23. Fix applied in 0bfa829 on March 24 (only amm_program_id). Then 5ac82c8 reverted. Then Tax Program redeployed on March 25 with mainnet IDs again.
  implication: The fix was undone by the mainnet constants restore, and a subsequent redeploy baked in the wrong IDs.

- timestamp: 2026-03-26T14:15:00Z
  checked: Devnet PDA derivations with mainnet vs devnet program IDs
  found: |
    Client passes (from devnet program IDs):
      StakePool = HNNetqJXr... (seeds=["stake_pool"], program=DrFg87...devnet)
    On-chain Tax Program derives (from mainnet staking ID):
      StakePool = different address (seeds=["stake_pool"], program=12b3t...mainnet)
    These are DIFFERENT because PDA derivation depends on the program ID.
  implication: ConstraintSeeds fails because the PDA address does not match on-chain derivation.

- timestamp: 2026-03-26T14:20:00Z
  checked: Error 2006 (ConstraintSeeds) at instruction index 4 in multi-hop TX
  found: |
    Instruction index 4 in atomic multi-hop TX = Tax Program swap_sol_buy.
    The first seeds::program constraint in SwapSolBuy is stake_pool (account #11).
    On-chain: seeds::program = staking_program_id() = "12b3t..." (mainnet).
    Client passes: StakePool PDA derived from "DrFg87..." (devnet).
    Mismatch = ConstraintSeeds (2006).
  implication: Error traces exactly to the mainnet staking_program_id in Tax Program.

- timestamp: 2026-03-26T14:25:00Z
  checked: Single-hop SOL->CRIME error path
  found: |
    useSwap.ts line 799-802: setErrorMessage(parseSwapError(confirmation.err))
    confirmation.err is a JSON object: {"InstructionError":[N,{"Custom":NNNN}]}
    parseSwapError(confirmation.err) -> String(obj) -> "[object Object]"
    No regex pattern matches "[object Object]" -> falls to generic fallback.
    The ACTUAL error is likely also ConstraintSeeds (2006) or ConstraintAddress (2012).
  implication: Single-hop has the same root cause. The generic UI message masks the real error code.

- timestamp: 2026-03-26T14:30:00Z
  checked: Vault token conversions (CRIME<->PROFIT, FRAUD<->PROFIT)
  found: Vault conversions bypass Tax Program entirely. They go through Conversion Vault which has no cross-program ID dependencies on AMM/Staking/Epoch.
  implication: Vault conversions should still work on devnet (same as March 23 diagnosis).

## Resolution

root_cause: |
  The devnet Tax Program (FGgidfhN..., deployed at slot 450903202 = 2026-03-25 09:58 UTC)
  was built from source that had mainnet cross-program IDs in constants.rs. This happened
  because:

  1. March 24 10:17: Commit 0bfa829 fixed amm_program_id() to devnet AMM and deployed
  2. March 24 12:46: Commit 5ac82c8 "restore mainnet constants" REVERTED all three IDs
     (AMM, Epoch, Staking) back to mainnet values in source code
  3. March 25 09:58: Tax Program was redeployed from the reverted source, baking in
     mainnet IDs: amm="5JsSAL3k...", epoch="4Heqc...", staking="12b3t..."

  This causes ALL SOL swap instructions (swap_sol_buy, swap_sol_sell, swap_exempt) to fail
  because their seeds::program constraints derive PDAs using mainnet program IDs, while the
  client passes PDAs derived from devnet program IDs. First failing constraint: stake_pool
  with seeds::program = staking_program_id() = ConstraintSeeds (2006).

  The ConstraintAddress check on amm_program (using mainnet AMM "5JsSAL3k...") also fails
  with error 2012, but Anchor validates accounts sequentially and stake_pool comes first.

  This is NOT caused by Phase 106 or Phase 106.1. It is a PRE-EXISTING bug that has existed
  since the March 25 Tax Program redeploy. Phase 106 only upgraded the Vault program. Phase
  106.1 only changed skipPreflight centralization (functionally identical behavior).

  Secondary issue: parseSwapError does not handle confirmation.err objects (JSON objects like
  {"InstructionError":[4,{"Custom":2006}]}). It calls String() which produces "[object Object]",
  falling through to the generic "Swap failed" message. This masks the real error for single-hop.

fix: |
  FIX 1 (unblocks devnet swaps):
  - Patch tax-program/src/constants.rs: amm_program_id(), epoch_program_id(), staking_program_id()
    to return devnet program IDs (J7Jxm..., E1u6f..., DrFg8...)
  - Rebuild Tax Program with --features devnet
  - Redeploy to devnet (in-place upgrade)

  FIX 2 (systemic -- prevents recurrence):
  - Add all three cross-program refs to patch-mint-addresses.ts so build.sh auto-patches them
  - OR: Add devnet feature gates to these functions (like treasury_pubkey already has)

  FIX 3 (error display):
  - Update parseSwapError to handle confirmation.err objects by JSON.stringifying them first,
    which allows the regex patterns to match "Custom":NNNN format

verification:
files_changed: []
