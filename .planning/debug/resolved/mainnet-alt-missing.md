---
status: resolved
trigger: "mainnet ALT at FwAetEADes6Q19naJQ5eXBet9M5uVstAhjtvwnHRbMFL does not exist on mainnet but site works fine"
created: 2026-03-24T00:00:00Z
updated: 2026-03-24T00:01:00Z
---

## Current Focus

hypothesis: CONFIRMED - deployments/mainnet.json has the devnet ALT address, not the real mainnet ALT
test: n/a - root cause confirmed
expecting: n/a
next_action: Fix mainnet.json ALT and Docs/external-arb-bot-spec.md

## Symptoms

expected: ALT at FwAetEADes6Q19naJQ5eXBet9M5uVstAhjtvwnHRbMFL should exist on mainnet
actual: `solana address-lookup-table get` returns "not found"
errors: "Lookup table account FwAetEADes6Q19naJQ5eXBet9M5uVstAhjtvwnHRbMFL not found, was it already closed?"
reproduction: Run `solana address-lookup-table get FwAetEADes6Q19naJQ5eXBet9M5uVstAhjtvwnHRbMFL --url mainnet-beta`
started: Discovered during post-Phase-100 address verification. Site has been working on mainnet.

## Eliminated

- hypothesis: Frontend/crank don't use ALT (legacy TX fallback)
  evidence: multi-hop-builder.ts line 348-358 fetches ALT and compiles to v0 with it. It DOES use ALT.
  timestamp: 2026-03-24T00:00:30Z

## Evidence

- timestamp: 2026-03-24T00:00:15Z
  checked: shared/constants.ts line 534
  found: MAINNET_ALT = "7dy5NNvacB8YkZrc3c96vDMDtacXzxVpdPLiC4B7LJ4h" (different from mainnet.json)
  implication: The frontend uses shared/constants.ts for mainnet, NOT deployments/mainnet.json

- timestamp: 2026-03-24T00:00:20Z
  checked: solana address-lookup-table get 7dy5NNvacB8YkZrc3c96vDMDtacXzxVpdPLiC4B7LJ4h --url mainnet-beta
  found: ALT exists on mainnet with 55 entries, authority=23g7xmrt (deployer), still active
  implication: The real mainnet ALT is working fine, just not recorded in mainnet.json

- timestamp: 2026-03-24T00:00:25Z
  checked: scripts/deploy/generate-deployment-json.ts line 189, 198
  found: Line 189 hardcodes "devnet" for BOTH clusters (TODO comment). Line 198 reads alt-address.json which has the devnet ALT.
  implication: generate-deployment-json.ts is the source of the stale ALT in mainnet.json

- timestamp: 2026-03-24T00:00:30Z
  checked: scripts/deploy/alt-address.json
  found: Contains devnet ALT FwAet... with network:"devnet"
  implication: This file only tracks devnet ALT. Mainnet ALT was created in stage-4 but never saved here.

- timestamp: 2026-03-24T00:00:35Z
  checked: Docs/external-arb-bot-spec.md line 773
  found: Says "Mainnet ALT:" but has the devnet address FwAet...
  implication: External arb bot spec also has wrong ALT address

## Resolution

root_cause: generate-deployment-json.ts reads ALT from alt-address.json which only contains the devnet ALT. When run with "mainnet" cluster arg, it still outputs the devnet ALT because (1) line 189 hardcodes anchorCluster="devnet" for both, and (2) alt-address.json only tracks devnet. The site works because the frontend uses shared/constants.ts MAINNET_ALT (7dy5NN...) not deployments/mainnet.json.
fix: Update deployments/mainnet.json ALT to correct address. Update Docs/external-arb-bot-spec.md.
verification: grep confirms 7dy5NN... now appears in mainnet.json, external-arb-bot-spec.md, shared/constants.ts, and mainnet-deploy-checklist.md -- all consistent. On-chain ALT verified active with 55 entries.
files_changed: [deployments/mainnet.json, Docs/external-arb-bot-spec.md]
