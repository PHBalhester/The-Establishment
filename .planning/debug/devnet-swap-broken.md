---
status: diagnosed
trigger: "devnet-swap-broken - quote shows 0, swap fails"
created: 2026-03-17T00:00:00Z
updated: 2026-03-17T00:01:00Z
---

## Current Focus

hypothesis: CONFIRMED - shared/constants.ts was regenerated from mainnet.json, replacing all devnet addresses with mainnet addresses
test: Compare devnet.json pool addresses vs constants.ts DEVNET_POOLS
expecting: Addresses mismatch (mainnet in constants, devnet in devnet.json)
next_action: Return diagnosis

## Symptoms

expected: SOL -> CRIME swap with 0.1 SOL input should show a quote and execute successfully
actual: "You receive" shows 0, swap button still clickable, TX fails with generic error
errors: No quote calculated (output = 0), generic swap failure toast
reproduction: Go to devnet website, try any SOL -> CRIME swap
started: After 2026-03-16 changes, was working before

## Eliminated

- hypothesis: Commit 3f927b0 (carnage hook fix) broke the quote/route engine
  evidence: That commit only touches scripts/e2e/lib/carnage-flow.ts and on-chain epoch program code. No changes to frontend app code, route engine, or shared constants.
  timestamp: 2026-03-17T00:00:30Z

## Evidence

- timestamp: 2026-03-17T00:00:10Z
  checked: git show 3f927b0 --stat
  found: Only 3 files changed: epoch program helper, epoch program test, scripts/e2e/lib/carnage-flow.ts. No frontend/shared code.
  implication: Commit 3f927b0 is NOT the cause.

- timestamp: 2026-03-17T00:00:20Z
  checked: route-engine.ts and useRoutes.ts
  found: Both are pure functions with no recent changes. Route engine requires PoolReserves from usePoolPrices. If reserves are null/zero, output is 0.
  implication: Issue is upstream in pool data fetching, not in quote logic.

- timestamp: 2026-03-17T00:00:30Z
  checked: shared/constants.ts header
  found: "AUTO-GENERATED from deployments/mainnet.json -- Generated: 2026-03-15T20:27:19.667Z -- Run: npx tsx scripts/deploy/generate-constants.ts mainnet"
  implication: Constants were regenerated from mainnet.json, not devnet.json.

- timestamp: 2026-03-17T00:00:40Z
  checked: Compared pool addresses between devnet.json and constants.ts
  found: |
    DEVNET_POOLS in constants.ts (from mainnet.json):
      CRIME/SOL pool: ZWUZ3PzGk6bg6g3BS3WdXKbdAecUgZxnruKXQkte7wf
      FRAUD/SOL pool: AngvViTVGd2zxP8KoFUjGU3TyrQjqeM1idRWiKM8p3mq
    Actual devnet pools (from devnet.json):
      CRIME/SOL pool: 7ydi5qjffNqaLiH4Rkg3gJQDCMVtzr4SriHNekjwDsSu
      FRAUD/SOL pool: FmfjYvbRVqjB4hpTt8UALWcSbEp4Tis7ve3HJk6zqSS2
  implication: COMPLETE ADDRESS MISMATCH. Frontend fetches mainnet PDAs from devnet RPC -> accounts don't exist -> reserves = 0.

- timestamp: 2026-03-17T00:00:45Z
  checked: git log for constants.ts changes
  found: Commit 40aa0d9 "feat(100-02): execute mainnet Stages 0-4 pre-deploy pipeline" regenerated constants.ts from mainnet.json
  implication: Phase 100 mainnet prep overwrote the shared constants. Devnet frontend broke as a side effect.

- timestamp: 2026-03-17T00:00:50Z
  checked: usePoolPrices.ts imports
  found: Directly imports DEVNET_POOLS from @dr-fraudsworth/shared. No cluster-switching logic. Frontend always uses the top-level constants regardless of NEXT_PUBLIC_CLUSTER.
  implication: There is no devnet/mainnet address routing in the frontend pool fetcher. It uses whatever addresses are in constants.ts.

## Resolution

root_cause: |
  shared/constants.ts was regenerated from deployments/mainnet.json (commit 40aa0d9,
  Phase 100-02 mainnet pre-deploy) on 2026-03-15. This replaced ALL addresses in
  the shared package (DEVNET_POOLS, DEVNET_POOL_CONFIGS, DEVNET_PDAS, MINTS,
  PROGRAM_IDS) with mainnet addresses. The devnet frontend (Railway) connects to
  devnet RPC but tries to fetch mainnet pool PDAs which don't exist on devnet.
  getMultipleAccountsInfo returns null -> usePoolPrices reports "Account not found"
  -> toPoolReserves returns null -> route engine never runs -> quote output = 0.

  The mints also differ (devnet CRIME = CsHfmZj..., mainnet CRIME = cRiMEhAxo...),
  so even if pools were found, token accounts and hook resolution would all fail.

  The deeper architectural issue: shared/constants.ts is a SINGLE-SOURCE file
  generated for ONE cluster at a time. There is no runtime cluster switching for
  pool/mint/PDA addresses in the frontend. The getClusterConfig() function exists
  in constants.ts but is never used by the frontend hooks.
fix:
verification:
files_changed: []
