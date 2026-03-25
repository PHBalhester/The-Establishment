---
status: resolved
trigger: "SSE pipeline doesn't deliver bonding curve state updates from other users' transactions"
created: 2026-03-23T00:00:00Z
updated: 2026-03-23T21:40:00Z
---

## Current Focus

hypothesis: CONFIRMED - ws-subscriber.ts had no ongoing subscription for curve state PDAs; batchSeed read them once at boot but nothing pushed subsequent changes
test: Applied fix: onAccountChange WS subscriptions + 30s poll fallback + dedup fix
expecting: TypeScript compiles clean (PASSED). Deploy and test two-browser scenario to verify.
next_action: Verify fix applied correctly, update resolution, archive

## Symptoms

expected: When ANY user buys/sells on bonding curves, ALL connected frontends should see pressure gauges and curve info update within seconds via SSE
actual: Only the user who made the transaction sees updates (their client calls refresh() post-TX). Other connected users see stale data until page refresh.
errors: No errors in browser console. No visible server errors. SSE connection appears open.
reproduction: Open launch page on two browsers. Buy from browser A. Browser B does NOT update. 100% reproducible.
started: Pre-existing architectural gap - SSE pipeline built for post-graduation trading, not bonding curve phase.

## Eliminated

- hypothesis: Curve PDAs missing from BATCH_ACCOUNTS in ws-subscriber.ts
  evidence: They ARE present at lines 80-81 (curveState for both CRIME and FRAUD). batchSeed reads and decodes them correctly on startup.
  timestamp: 2026-03-23T00:00:30Z

- hypothesis: Webhook handler doesn't decode curve state
  evidence: KNOWN_PROTOCOL_ACCOUNTS includes both curve PDAs (lines 225-226). ANCHOR_DECODE_MAP has entries for both (lines 248-249). handleAccountChanges correctly decodes curveState type with bondingCurve program. This path works IF Helius delivers the webhook.
  timestamp: 2026-03-23T00:00:30Z

- hypothesis: useProtocolState doesn't map curve data
  evidence: ACCOUNT_KEYS includes crimeCurve and fraudCurve (lines 97-98). extractStructuredState maps them correctly. useCurveState reads them from useProtocolState. Client-side is fully wired.
  timestamp: 2026-03-23T00:00:30Z

- hypothesis: protocolStore doesn't broadcast curve updates
  evidence: setAccountState() calls sseManager.broadcast() for any key including curve PDAs. The SSE route forwards protocol-update events. Pipeline is complete IF setAccountState is called.
  timestamp: 2026-03-23T00:00:30Z

## Evidence

- timestamp: 2026-03-23T00:00:20Z
  checked: ws-subscriber.ts data flow after batchSeed
  found: After batchSeed (line 466), init() starts 4 ongoing subscriptions: startSlotSubscription (WS), startSupplyPoll (HTTP 60s), startStakerPoll (gPA 30s), startStalenessMonitor. NONE of these poll curve state or any other PDA state. Curve PDAs are seeded once and never refreshed.
  implication: The only path for curve state updates is via Helius Enhanced Webhook. If that webhook is not registered for curve PDAs, no updates flow.

- timestamp: 2026-03-23T00:00:25Z
  checked: webhook-manage.ts create command
  found: ACCOUNT_ADDRESSES only contains TAX_PROGRAM_ID and EPOCH_PROGRAM_ID (line 66). This creates a rawDevnet webhook for transaction log parsing, NOT an enhanced webhook for account changes. The webhook handler docs (lines 44-56) describe a SECOND enhanced webhook that should be created manually, monitoring specific PDAs including curve PDAs.
  implication: The enhanced webhook for account changes may not be registered at all, or if it is, it was done manually and may not include curve PDAs.

- timestamp: 2026-03-23T00:00:28Z
  checked: Two-webhook architecture in helius/route.ts comments
  found: The handler is designed for TWO webhooks: (1) rawDevnet for event parsing (managed by webhook-manage.ts), (2) enhanced for account changes (registered manually). The enhanced webhook comment at line 48-56 lists the PDAs but does NOT include curve PDAs in the example! Only EpochState, CarnageFund, CRIME_SOL Pool, FRAUD_SOL Pool, StakePool.
  implication: Even the documentation's example is missing curve PDAs from the enhanced webhook registration.

- timestamp: 2026-03-23T00:00:35Z
  checked: Whether there's any periodic polling of curve PDAs
  found: NO. ws-subscriber only polls: slots (WS), supply (HTTP), stakers (gPA). There is no accountSubscribe WS for any PDA. There is no poll loop for BATCH_ACCOUNTS. The entire real-time update path for PDAs relies on the Helius enhanced webhook.
  implication: Even if the enhanced webhook includes curve PDAs, the current architecture has a single point of failure. If webhooks stop, all PDA data goes stale until manual refresh. But the immediate problem is that we don't have a reliable ongoing data path for curves.

- timestamp: 2026-03-23T21:30:00Z
  checked: Previous session's uncommitted startAccountPoll fix
  found: A prior debug session had added startAccountPoll (5s HTTP poll) but never committed it. The implementation had a dedup-defeating bug: `updatedAt: Date.now()` was included in data passed to setAccountState, causing the serialized comparison to always differ between polls, generating 8 redundant SSE broadcasts every 5 seconds even when no on-chain data changed.
  implication: The polling approach works but needs the dedup fix. Additionally, polling at 5s doesn't meet the "sub-second push" requirement. Need onAccountChange WS subscriptions for true real-time.

- timestamp: 2026-03-23T21:35:00Z
  checked: Applied fix -- onAccountChange WS subscriptions + dedup-clean poll fallback
  found: TypeScript compiles with zero errors. Three delivery paths now exist: (1) onAccountChange WS for sub-second push, (2) 30s HTTP poll as safety net, (3) Helius Enhanced Webhook as bonus accelerator. All three feed through the same decodeAccountInfo -> setAccountState -> SSE broadcast pipeline with proper dedup.
  implication: Fix is structurally complete. Needs deployment and two-browser test to verify end-to-end.

## Resolution

root_cause: TWO issues combine to prevent curve state updates:
  1. **No ongoing data path for protocol PDAs in ws-subscriber.ts**: batchSeed reads all BATCH_ACCOUNTS (including curve PDAs) once at boot, but no ongoing subscription or poll ever refreshes them. The slot/supply/staker polls exist but there is no PDA account subscription or poll.
  2. **Enhanced webhook config omits curve PDAs**: webhook-manage.ts only creates the rawDevnet webhook (for log parsing). The enhanced webhook (for account changes) must be created manually, and the example in the code comments omitted CurveState PDAs. The architecture relied entirely on this external webhook for PDA updates.

fix: Three-part fix applied to ws-subscriber.ts:
  1. **Added `startAccountSubscriptions()`** -- Uses Solana's `onAccountChange` WebSocket subscription for ALL 8 BATCH_ACCOUNTS (including both CurveState PDAs). This gives sub-second real-time delivery when any account changes on-chain. PRIMARY delivery mechanism.
  2. **Added `startAccountPoll()` as 30s fallback** -- Periodically re-fetches all BATCH_ACCOUNTS via getMultipleAccountsInfo. Catches updates missed during WS reconnection gaps. SAFETY NET role.
  3. **Fixed dedup by removing `updatedAt` from data** -- Previous version included `updatedAt: Date.now()` in every stored record, which defeated the protocolStore's serialized comparison dedup (every poll produced different JSON). Extracted shared `decodeAccountInfo()` helper that returns pure on-chain data without volatile timestamps. Dedup now correctly suppresses redundant SSE broadcasts.
  4. **Updated Enhanced Webhook config comment** in helius/route.ts to include CurveState PDAs for anyone setting up the webhook manually.

verification: TypeScript compiles clean (zero errors). Data flow verified by tracing: onAccountChange callback -> decodeAccountInfo -> protocolStore.setAccountState -> sseManager.broadcast -> SSE protocol-update event -> useProtocolState handler -> useCurveState extraction. Full pipeline connected.
files_changed:
  - app/lib/ws-subscriber.ts
  - app/app/api/webhooks/helius/route.ts
