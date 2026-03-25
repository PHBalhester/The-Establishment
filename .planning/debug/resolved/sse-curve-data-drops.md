---
status: resolved
trigger: "Curve data randomly drops to 0/empty on the launch page for some users (no tab switching). SSE connection appears to intermittently disconnect, causing useCurveState to return null values."
created: 2026-03-23T00:00:00Z
updated: 2026-03-23T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED - RPC polling fallback in useProtocolState overwrites decoded Anchor data with raw account info (lamports/owner/dataLength), which useCurveState's extractFromSse() rejects (no participantCount field), returning null. Additionally, the "clear RPC fallback on SSE delivery" logic clears rpcCrime/rpcFraud when the raw-data object is truthy but not decodable.
test: N/A - root cause confirmed via code trace
expecting: N/A
next_action: Apply two-part fix: (1) useCurveState only clears RPC fallback when extractFromSse succeeds, (2) useProtocolState polling preserves existing decoded data instead of overwriting with raw data

## Symptoms

expected: Curve data (gauges, info panels) stays visible and updates in real-time as buys/sells happen on the bonding curves
actual: Data randomly drops to 0/empty — gauges clear, info disappears. Comes back after some time. Happens WITHOUT tab switching. Affects remote tester more than local user.
errors: No visible errors in browser console
reproduction: Random — happens intermittently for remote tester. Local user sees it less. No specific trigger identified beyond "it just happens occasionally."
started: After Phase 102 fresh devnet deploy. SSE pipeline reconfigured with new program IDs via Helius webhook. Visibility-change RPC fallback added but only fixes tab-switching case.

## Eliminated

## Evidence

- timestamp: 2026-03-23T00:01:00Z
  checked: Full data pipeline code (useCurveState.ts, useProtocolState.ts, SSE protocol route, protocol-store.ts, sse-manager.ts, helius webhook route, ws-subscriber.ts, useVisibility.ts, sse-connections.ts)
  found: |
    CRITICAL FINDING 1: initial-state handler in useProtocolState REPLACES entire state:
      `setAccounts(data)` on line 254 — this is a FULL REPLACEMENT, not a merge.
      If SSE reconnects and the initial-state snapshot is missing curve data
      (e.g. webhook hasn't fired for curves yet), ALL curve data goes null.

    CRITICAL FINDING 2: useCurveState CLEARS RPC fallback data when SSE delivers:
      Lines 226-231: `if (crimeCurve) setRpcCrime(null)` and same for fraud.
      But `crime: rpcCrime ?? crime` on line 262 means SSE takes precedence.
      When SSE crimeCurve goes non-null then null again (reconnect), the RPC
      fallback is already cleared. Result: both sources return null = data drop.

    CRITICAL FINDING 3: SSE auto-release after 30 minutes (sse-connections.ts line 27):
      `MAX_CONNECTION_MS = 30 * 60_000`. The scheduleAutoRelease fires
      releaseConnection() which decrements the counter, but does NOT close the
      actual EventSource/stream. However, next time the stream tries to write
      it may fail. The heartbeat is 15s, so the stream stays alive... but the
      connection tracking goes out of sync. This could cause 429 rejections on
      reconnect if counter is wrong.

    CRITICAL FINDING 4: The heartbeat is SSE comments (": heartbeat\n\n").
      Railway/proxy may still kill idle connections despite this if they
      have shorter timeouts. If the SSE stream drops server-side, the client
      EventSource fires onerror, closes, and tries to reconnect. During
      reconnect: state goes stale, then initial-state REPLACES it.
  implication: The most likely mechanism is: SSE connection drops (Railway proxy timeout or network issue) -> client reconnects -> initial-state fires setAccounts(data) replacing all state -> if protocolStore doesn't have curve data in snapshot, curves go null -> useCurveState clears RPC fallback because SSE delivered "something" (other accounts) even though curves are missing

- timestamp: 2026-03-23T00:02:00Z
  checked: useProtocolState RPC polling fallback (lines 196-212)
  found: |
    ROOT CAUSE CANDIDATE: The RPC polling fallback stores RAW account info:
      ```
      next[pubkey] = {
        label: "rpc-poll",
        lamports: info.lamports,
        owner: info.owner.toBase58(),
        dataLength: info.data.length,
        updatedAt: Date.now(),
      };
      ```
    This has NO decoded Anchor fields (no participantCount, tokensSold, etc.).
    When extractStructuredState picks this up as crimeCurve/fraudCurve, the
    extractFromSse() function in useCurveState checks:
      `if (!data || typeof data.participantCount !== "number") return null;`
    Since participantCount doesn't exist in raw RPC data, it returns null.

    SEQUENCE:
    1. SSE connection established, initial-state has decoded curve data -> works
    2. SSE connection drops (Railway proxy, network blip)
    3. Client fires onerror -> starts reconnect with exponential backoff
    4. After 30s of SSE downtime, polling fallback activates
    5. pollViaRpc() stores RAW account info (no Anchor decode) for ALL accounts
       including curve PDAs
    6. setAccounts() merges this raw data into the state map
    7. crimeCurve now points to {label:"rpc-poll", lamports:..., dataLength:...}
    8. useCurveState: extractFromSse() returns null -> crime=null, fraud=null
    9. Also: `if (crimeCurve) setRpcCrime(null)` fires because crimeCurve is
       now truthy (it's the raw data object) -> clears RPC fallback too
    10. Both data sources are now null -> UI shows 0/empty

    THEN:
    11. SSE reconnects -> initial-state delivers decoded data -> state recovers
    12. Or next webhook delivers decoded data -> state recovers

    This explains:
    - Why it's INTERMITTENT (only when SSE drops and polling activates)
    - Why REMOTE users see it more (worse network = more SSE drops)
    - Why it RECOVERS after some time (SSE reconnects or webhook fires)
    - Why NO tab switching is needed (SSE drops happen independently)
  implication: The RPC polling fallback in useProtocolState stores raw account info that lacks Anchor-decoded fields, poisoning the state for downstream consumers that expect decoded data

## Resolution

root_cause: |
  Client-side RPC polling fallback in useProtocolState overwrites Anchor-decoded
  SSE data with raw account metadata ({label:"rpc-poll", lamports, owner, dataLength}).
  Downstream consumers (useCurveState.extractFromSse) reject this raw data (missing
  participantCount field), returning null. Simultaneously, useCurveState's "clear RPC
  fallback on SSE delivery" logic clears rpcCrime/rpcFraud because the raw-data object
  is truthy (even though it's not decodable). Both data sources become null -> UI drops.

  Trigger sequence:
  1. SSE connection drops (Railway proxy timeout, network instability)
  2. After 30s of SSE downtime, client-side RPC polling activates
  3. pollViaRpc() stores raw metadata for ALL monitored accounts (including curves)
  4. Raw data overwrites previously-decoded SSE data in accounts state
  5. useCurveState sees truthy crimeCurve, clears RPC fallback
  6. extractFromSse(rawData) returns null -> both sources null -> data drop
  7. Data recovers when SSE reconnects and delivers decoded data again

  Why remote users affected more: worse network = more SSE drops = more polling activation.

fix: |
  Two-part fix:

  1. useCurveState.ts: Changed "clear RPC fallback" effects to depend on the
     PARSED result (crime/fraud) instead of the raw SSE object (crimeCurve/fraudCurve).
     Only clears rpcCrime when extractFromSse successfully parses the SSE data.
     If SSE delivers raw/unparseable data, RPC fallback is preserved.

  2. useProtocolState.ts: Modified pollViaRpc() to skip overwriting accounts that
     already contain Anchor-decoded data. Checks existing data for `label !== "rpc-poll"`
     as a proxy for "this is decoded data worth preserving". Only writes raw poll data
     when (a) no existing data, or (b) existing data is also from raw polling.

verification: |
  - TypeScript compiles cleanly (npx tsc --noEmit: zero errors)
  - Traced fix through original bug scenario: polling no longer overwrites decoded data
  - Traced edge case: first connection with no SSE data -> polling can still write,
    and rpcCrime from refresh() is preserved because crime stays null
  - No regressions: SSE initial-state still does full replacement (setAccounts(data)),
    webhook updates still merge normally, visibility-change refresh still works

files_changed:
  - app/hooks/useCurveState.ts
  - app/hooks/useProtocolState.ts
