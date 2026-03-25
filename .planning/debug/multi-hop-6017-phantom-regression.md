---
status: investigating
trigger: "multi-hop-6017-and-phantom-warning - SOL->PROFIT swaps fail with Custom:6017 after multi-hop builder change"
created: 2026-03-24T00:00:00Z
updated: 2026-03-24T00:00:00Z
---

## Current Focus

hypothesis: Step 2 (vault convert) uses full quoted inputAmount but user only has slippage-reduced tokens from step 1, causing token transfer failure
test: Identify which program owns error 6017, which instruction is at index 5, and trace the amount flow
expecting: Error 6017 is a token-amount or slippage error in one of the programs
next_action: Read error enums from all programs, count instructions in atomic TX

## Symptoms

expected: SOL->PROFIT multi-hop swap succeeds. Phantom shows normal balance preview.
actual: Phantom shows "Request blocked - This dApp could be malicious". Transaction fails with InstructionError:[5,{Custom:6017}].
errors: InstructionError:[5,{Custom:6017}] at instruction index 5
reproduction: Any SOL->PROFIT swap via multi-hop route on mainnet
started: After commit 7b37522 changed multi-hop-builder.ts to use step.inputAmount instead of previousMinimumOutput

## Eliminated

## Evidence

## Resolution

root_cause:
fix:
verification:
files_changed: []
