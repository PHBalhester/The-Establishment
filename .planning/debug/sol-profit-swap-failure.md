---
status: resolved
trigger: "SOL<->PROFIT direct swaps failing with toast error since Phase 95 deploy"
created: 2026-03-14T00:00:00Z
updated: 2026-03-18T00:00:00Z
resolved: 2026-03-18
---

## Current Focus

hypothesis: CONFIRMED - Stale ALT address in devnet.json (8Vv3) flows through constants.ts -> protocol-config.ts -> multi-hop-builder.ts. programs.ts was fixed but is NOT used by the swap path.
test: Traced full import chain + verified on-chain existence of all 3 ALT candidates
expecting: Fix devnet.json ALT + regenerate constants.ts -> multi-hop v0 transactions will work
next_action: Deploy to Railway and test SOL->PROFIT swap on live site

## Symptoms

expected: SOL -> PROFIT and PROFIT -> SOL direct swaps should execute successfully on the frontend
actual: Frontend shows toast error "Swap failed. Please try again or reduce the swap amount." for SOL<->PROFIT direct swaps only
errors: "Swap failed. Please try again or reduce the swap amount." toast notification
reproduction: Try to swap SOL -> PROFIT or PROFIT -> SOL on the frontend
started: After Phase 95 deploy (2026-03-14). Other swap pairs all work fine.

## Eliminated

- hypothesis: Missing SOL<->PROFIT AMM pool
  evidence: No SOL<->PROFIT pool exists by design. SOL<->PROFIT routes are multi-hop (SOL->CRIME->PROFIT or SOL->FRAUD->PROFIT via vault). Route engine correctly enumerates these paths.
  timestamp: 2026-03-14T00:00:30Z

- hypothesis: Route engine bug
  evidence: route-engine.ts correctly enumerates 2-hop paths for SOL<->PROFIT. computeRoutes returns valid routes. The issue is downstream in transaction execution.
  timestamp: 2026-03-14T00:00:40Z

## Evidence

- timestamp: 2026-03-14T00:00:10Z
  checked: deployments/devnet.json pools section
  found: Only crimeSol and fraudSol pools exist (no profitSol pool). This is by design.
  implication: SOL<->PROFIT must go through multi-hop route engine

- timestamp: 2026-03-14T00:00:20Z
  checked: useSwap.ts executeRoute code path
  found: SOL<->PROFIT routes have hops > 1, so they use buildAtomicRoute() which creates a v0 VersionedTransaction using DEVNET_ALT from shared/programs.ts
  implication: The multi-hop builder depends on the ALT being correct and containing current addresses

- timestamp: 2026-03-14T00:00:30Z
  checked: shared/programs.ts DEVNET_ALT value vs scripts/deploy/alt-address.json
  found: CRITICAL MISMATCH. programs.ts has "8Vv3ZskjpW7by7ECpTx8jwgwVvxiSEj1aLEDTtTAQguL" (Phase 69 ALT). alt-address.json has "CJ4dhU2GxKfABR7Ns3jko4jEeHX1T6rZ4J42cp4HXTAB" (Phase 95 ALT, 55 addresses, created 2026-03-14).
  implication: All multi-hop v0 transactions use wrong ALT -> transaction fails on-chain

- timestamp: 2026-03-14T00:00:35Z
  checked: devnet.json alt field
  found: Also stale - "8Vv3ZskjpW7by7ECpTx8jwgwVvxiSEj1aLEDTtTAQguL"
  implication: Both devnet.json and programs.ts need updating

- timestamp: 2026-03-14T00:00:40Z
  checked: Why SOL<->CRIME and SOL<->FRAUD work
  found: These are single-hop direct swaps. useSwap.ts executeSwap path uses legacy transactions (no ALT needed). Only multi-hop routes (SOL<->PROFIT) go through buildAtomicRoute which needs the ALT.
  implication: Perfectly explains the symptom pattern

- timestamp: 2026-03-14T00:00:45Z
  checked: generate-constants.ts for ALT handling
  found: Script does NOT read or write the ALT address. ALT is hardcoded in programs.ts separately. The create-alt.ts script saves to alt-address.json but doesn't update programs.ts or devnet.json.
  implication: This is a deploy pipeline gap - ALT address not synced to shared constants

- timestamp: 2026-03-18T00:00:10Z
  checked: Full import chain for multi-hop ALT usage
  found: multi-hop-builder.ts imports PROTOCOL_ALT from protocol-config.ts, which imports from getClusterConfig() in constants.ts. constants.ts line 424 has PROTOCOL_ALT = "8Vv3..." (Phase 69 stale). programs.ts DEVNET_ALT = "CJ4d..." (correct) but is NOT imported by multi-hop-builder.
  implication: The prior fix to programs.ts was a no-op for the actual swap path

- timestamp: 2026-03-18T00:00:15Z
  checked: On-chain existence of all 3 ALT candidates via solana CLI
  found: CJ4d (programs.ts) = EXISTS, owned by AddressLookupTable. 7dy5 (alt-address.json) = DOES NOT EXIST. 8Vv3 (devnet.json/constants.ts) = EXISTS but has Phase 69 addresses.
  implication: The stale ALT 8Vv3 exists on-chain, so fetchProtocolALT succeeds, but compileToV0Message fails because Phase 95 instruction addresses are not in the Phase 69 ALT. This throws before wallet signing, matching the symptom exactly.

- timestamp: 2026-03-18T00:00:20Z
  checked: generate-constants.ts line 584
  found: Script DOES generate PROTOCOL_ALT from devnet.json cfg.alt field. Previous evidence entry was wrong - the script reads it from devnet.json.
  implication: Fixing devnet.json alt + regenerating constants.ts will fix the issue

## Resolution

root_cause: Stale ALT address chain. devnet.json has Phase 69 ALT (8Vv3...). generate-constants.ts reads devnet.json and writes PROTOCOL_ALT = 8Vv3... into constants.ts. protocol-config.ts re-exports it. multi-hop-builder.ts uses it. The Phase 69 ALT exists on-chain but contains old addresses, so compileToV0Message fails when Phase 95 instruction addresses aren't in the ALT. The prior fix only updated programs.ts DEVNET_ALT, which is NOT in the multi-hop builder's import chain. Additionally, alt-address.json was overwritten during Phase 100 mainnet prep with 7dy5... which doesn't exist on devnet.
fix: 1) Update devnet.json alt to CJ4dhU2GxKfABR7Ns3jko4jEeHX1T6rZ4J42cp4HXTAB 2) Regenerate constants.ts 3) Fix alt-address.json
verification: TypeScript compiles cleanly. Full import chain verified: devnet.json -> constants.ts -> protocol-config.ts -> multi-hop-builder.ts all now use CJ4d... (Phase 95 ALT, confirmed on-chain). Deployed to Railway 2026-03-18, user confirmed SOL->PROFIT swaps working. alt-address.json reverted to mainnet value (was incorrectly overwritten by debugger).
files_changed: [deployments/devnet.json, shared/constants.ts]
commit: 1f97113
