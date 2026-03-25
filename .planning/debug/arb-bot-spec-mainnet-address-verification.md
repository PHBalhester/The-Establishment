---
status: diagnosed
trigger: "External arb bot user getting Error 3008 on tax program. Verify ALL addresses in external-arb-bot-spec.md match mainnet deployment."
created: 2026-03-24T00:00:00Z
updated: 2026-03-24T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED - swap_sol_sell account ordering in spec doc is wrong
test: Compared spec doc account table to on-chain Anchor struct field order
expecting: Mismatched account positions cause system_program slot to receive staking_program
next_action: Report root cause

## Symptoms

expected: External arb bot should call tax program swap instructions using spec doc addresses
actual: Error 3008 "Program ID Was Not As Expected" on tax program
errors: Error 3008 - account has wrong program owner or instruction references wrong program ID
reproduction: Friend following external-arb-bot-spec.md to build arb bot against mainnet
started: After fixing ALT address mismatch in prior debug session

## Eliminated

- hypothesis: Addresses in spec doc are wrong (devnet leaked into mainnet doc)
  evidence: All 40+ addresses in spec doc match deployments/mainnet.json exactly (0 mismatches). Re-derived all PDAs from mainnet program IDs -- all match.
  timestamp: 2026-03-24

- hypothesis: On-chain hardcoded program IDs are wrong
  evidence: tax-program/src/constants.rs has correct AMM (5JsS), Epoch (4Heq), Staking (12b3), Treasury (3ihh) addresses matching mainnet.json
  timestamp: 2026-03-24

- hypothesis: declare_id! mismatch in deployed binary
  evidence: lib.rs has declare_id!("43fZGRtmEsP7ExnJE1dbTbNjaP1ncvVmMPusSeksWGEj") matching the deployed address on mainnet
  timestamp: 2026-03-24

## Evidence

- timestamp: 2026-03-24
  checked: All spec doc addresses vs mainnet.json
  found: All addresses match (programs, mints, pools, PDAs, hook accounts, ALT, treasury)
  implication: The addresses themselves are correct -- the issue is elsewhere

- timestamp: 2026-03-24
  checked: Anchor error code 3008 in anchor-lang 0.32.1
  found: Error 3008 = InvalidProgramId ("Program ID was not as expected"). Fired by Program<> constraint checks (e.g. system_program: Program<'info, System>)
  implication: A Program<> typed account is receiving the wrong public key

- timestamp: 2026-03-24
  checked: SwapSolSell struct field order in swap_sol_sell.rs vs spec doc Section 9
  found: CRITICAL MISMATCH - wsol_intermediary is at position 15 in the on-chain struct (between treasury and amm_program), but the spec doc shows it at position 20 (last account)
  implication: All program accounts (positions 15-20) are shifted by 1 when following spec doc. system_program slot (on-chain position 19) receives staking_program address -> Error 3008

- timestamp: 2026-03-24
  checked: SwapSolBuy account ordering
  found: SwapSolBuy has 20 accounts (0-19) and spec doc matches on-chain struct perfectly. Only SwapSolSell is affected.
  implication: Only the sell path is broken for external users following the spec

## Resolution

root_cause: The swap_sol_sell account table in Docs/external-arb-bot-spec.md (Section 9) has wsol_intermediary listed at position 20 (last) but the on-chain Anchor struct (SwapSolSell in swap_sol_sell.rs) has it at position 15 (between treasury and amm_program). This shifts accounts 15-20 by one position. When the bot follows the spec, position 19 (which on-chain expects system_program = 11111...1111) instead receives staking_program (12b3...), causing Anchor's Program<'info, System> constraint to throw Error 3008 "InvalidProgramId".

fix: Update spec doc Section 9 swap_sol_sell table to match on-chain struct order: wsol_intermediary at position 15, then amm_program(16), token_program_a(17), token_program_b(18), system_program(19), staking_program(20)
verification:
files_changed: []
