---
status: diagnosed
trigger: "All swaps involving SOL fail post-graduation. Token-to-token swaps work. SOL->CRIME, FRAUD->SOL, SOL->PROFIT etc all fail."
created: 2026-03-23T00:00:00Z
updated: 2026-03-23T01:30:00Z
---

## Current Focus

hypothesis: CONFIRMED — Tax Program has hardcoded mainnet AMM program ID, mismatching devnet AMM
test: Compared tax-program/constants.rs amm_program_id() against deployments/devnet.json AMM address
expecting: Mismatch proves root cause
next_action: Report findings — do not fix (investigate-only mode)

## Symptoms

expected: SOL swaps should work via AMM pools (CRIME/SOL pool, FRAUD/SOL pool) created during graduation
actual: Any swap involving SOL fails. Token-to-token conversions (CRIME<>FRAUD<>PROFIT via conversion vault) work fine. Staking works fine.
errors: TaxError::InvalidAmmProgram constraint failure (address mismatch on amm_program account)
reproduction: Any SOL swap on devnet Railway frontend post-graduation. 100% failure for SOL swaps, 100% success for token-to-token.
started: Immediately after Phase 102 graduation (Stage 6). AMM pools just created with ~5 SOL + 290M tokens each.

## Eliminated

- hypothesis: Pool addresses not in ALT
  evidence: ALT (FwAetE...) contains all 6 pool addresses (pool + vaultA + vaultB for both pools) at indices 45-50
  timestamp: 2026-03-23T00:10:00Z

- hypothesis: Pool addresses wrong in constants.ts / devnet.json
  evidence: Pool addresses in constants.ts match devnet.json, match on-chain accounts (verified pool 7Auii... has 224 bytes, vaultA BjNeT... has ~5 SOL)
  timestamp: 2026-03-23T00:15:00Z

- hypothesis: Pool vaults not whitelisted in Transfer Hook
  evidence: Whitelist PDAs 9hgwp... and 9R9PT... exist on-chain, owned by hook program 5X5ST...
  timestamp: 2026-03-23T00:20:00Z

- hypothesis: EpochState missing / not delivering data to frontend
  evidence: EpochState DR2Eg... exists on-chain (172 bytes, owned by epoch program)
  timestamp: 2026-03-23T00:25:00Z

- hypothesis: SSE pipeline not delivering pool data
  evidence: ws-subscriber subscribes to correct pool PDAs via protocol-config.ts; pool data flows through SSE correctly
  timestamp: 2026-03-23T00:30:00Z

- hypothesis: Canonical mint ordering wrong
  evidence: NATIVE_MINT (0x06) always < anything, so mint_a=SOL, mint_b=token. Code convention matches.
  timestamp: 2026-03-23T00:35:00Z

## Evidence

- timestamp: 2026-03-23T00:05:00Z
  checked: deployments/devnet.json pool addresses
  found: CRIME/SOL pool=7Auii, vaultA=BjNeT, vaultB=BYNNx; FRAUD/SOL pool=Fj555, vaultA=4vdvG, vaultB=5Jkcj
  implication: Pool addresses are correctly configured in deployment config

- timestamp: 2026-03-23T00:10:00Z
  checked: ALT (FwAetE...) contents on devnet via solana CLI
  found: 54 addresses including all pool+vault addresses at indices 45-50
  implication: ALT is complete, not the cause

- timestamp: 2026-03-23T00:15:00Z
  checked: On-chain pool account 7Auii... and vaultA BjNeT...
  found: Pool has 224 bytes (correct PoolState size), vaultA has ~5 SOL balance
  implication: Pools exist and are funded

- timestamp: 2026-03-23T00:20:00Z
  checked: Whitelist PDAs for pool vaultBs (9hgwp... and 9R9PT...)
  found: Both exist on-chain, owned by hook program 5X5ST...
  implication: Transfer hook whitelist is correctly configured

- timestamp: 2026-03-23T00:40:00Z
  checked: tax-program/src/constants.rs amm_program_id() function
  found: Returns "5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR" (MAINNET AMM)
  implication: Deployed Tax Program on devnet checks for mainnet AMM address

- timestamp: 2026-03-23T00:41:00Z
  checked: deployments/devnet.json AMM program address
  found: "J7JxmNkzi3it6Q4TNYjTD6mKdgMaD1pxrstn1RnL3bR5" (DEVNET AMM)
  implication: Frontend passes correct devnet AMM but Tax Program expects wrong (mainnet) AMM

- timestamp: 2026-03-23T00:42:00Z
  checked: SwapSolBuy struct constraint on amm_program account
  found: '#[account(address = amm_program_id() @ TaxError::InvalidAmmProgram)]' — hard address check
  implication: Every SOL swap fails this constraint because addresses don't match

- timestamp: 2026-03-23T00:45:00Z
  checked: sync-program-ids.ts CROSS_REFS list
  found: Tax -> AMM cross-reference is MISSING from the CROSS_REFS list. Only Staking->Tax/Epoch, Epoch->Tax/AMM/Staking, AMM->Tax are listed.
  implication: sync-program-ids.ts never patches tax-program's amm_program_id() during build

- timestamp: 2026-03-23T00:46:00Z
  checked: Pattern compatibility between sync-program-ids.ts and tax-program/constants.rs
  found: sync-program-ids uses patchPubkeyMacroFn() which looks for pubkey!("ADDRESS") pattern. Tax program uses Pubkey::from_str("ADDRESS").unwrap() pattern. INCOMPATIBLE.
  implication: Even if the cross-ref were added, the patcher wouldn't match the Pubkey::from_str pattern

- timestamp: 2026-03-23T00:47:00Z
  checked: Tax -> Staking and Tax -> Epoch cross-program IDs
  found: Staking="DrFg87..." matches devnet. Epoch="E1u6f..." matches devnet. These happen to match because same keypairs were used, but they are ALSO not in CROSS_REFS.
  implication: Tax program has 3 untracked cross-program refs. AMM is the one that's wrong.

- timestamp: 2026-03-23T00:50:00Z
  checked: Why vault conversions work but SOL swaps don't
  found: Vault conversions go through Conversion Vault program which does NOT CPI into AMM. SOL swaps go through Tax Program which CPIs into AMM with address constraint. The address mismatch only affects the Tax->AMM CPI path.
  implication: This perfectly explains why token-to-token works and SOL swaps fail.

## Resolution

root_cause: |
  The Tax Program deployed on devnet (FGgidfhN...) has a hardcoded MAINNET AMM program ID 
  ("5JsSAL3k...") in its constants.rs amm_program_id() function, but the devnet AMM program 
  has a DIFFERENT ID ("J7JxmNkzi..."). The SwapSolBuy and SwapSolSell account structs enforce 
  `#[account(address = amm_program_id())]` on the amm_program account, causing every SOL swap 
  to fail with TaxError::InvalidAmmProgram.
  
  Root cause chain:
  1. sync-program-ids.ts CROSS_REFS list is MISSING "Tax -> AMM" (and Tax -> Staking, Tax -> Epoch)
  2. Even if added, the patcher uses pubkey!() macro pattern but tax-program uses Pubkey::from_str()
  3. Phase 102 build deployed the Tax Program with the stale mainnet AMM ID
  4. Vault conversions bypass the Tax Program entirely, so they still work
  5. Staking bypasses AMM entirely, so it still works
  
fix: |
  TWO fixes needed:
  
  FIX 1 (immediate — unblocks devnet):
  - Update programs/tax-program/src/constants.rs amm_program_id() to return the devnet AMM ID
    "J7JxmNkzi3it6Q4TNYjTD6mKdgMaD1pxrstn1RnL3bR5"
  - Rebuild Tax Program with --devnet feature
  - Redeploy Tax Program to devnet (anchor upgrade)
  
  FIX 2 (systemic — prevents recurrence):
  - Add Tax -> AMM, Tax -> Staking, Tax -> Epoch to sync-program-ids.ts CROSS_REFS
  - Add a new patcher function patchFromStrFn() to handle Pubkey::from_str("...") pattern 
    (or migrate tax-program to use pubkey!() macro like other programs)
  - Add test assertions for tax-program cross-program IDs
  
verification: []
files_changed: []
