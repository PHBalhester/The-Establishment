---
phase: 84-frontend-hardening-mainnet-readiness
plan: 03
subsystem: api, ui
tags: [sse, webhook, helius, real-time, eventSource, protocol-state]

# Dependency graph
requires:
  - phase: 84-01
    provides: "RPC proxy + cluster-keyed config with DEVNET_PDAS_EXTENDED"
provides:
  - "Fail-closed webhook auth in production (FE-02)"
  - "In-memory protocol account store with SSE broadcast"
  - "SSE endpoint for protocol state streaming (/api/sse/protocol)"
  - "useProtocolState hook with reconnect + polling fallback"
  - "Enhanced Account Change webhook handler for Helius"
affects: [84-04, 85, 86, 87]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Protocol store with globalThis singleton pattern (same as sse-manager.ts)"
    - "SSE event filtering via payload prefix check"
    - "Polling fallback after SSE downtime threshold"

key-files:
  created:
    - app/lib/protocol-store.ts
    - app/app/api/sse/protocol/route.ts
    - app/hooks/useProtocolState.ts
  modified:
    - app/app/api/webhooks/helius/route.ts

key-decisions:
  - "Enhanced webhook payload discrimination via accountData field presence"
  - "30s SSE downtime threshold before RPC polling fallback activates"
  - "getMultipleAccountsInfo for polling fallback (single RPC call for all 7 PDAs)"
  - "Protocol-update event filtering in SSE endpoint via string prefix match"

patterns-established:
  - "protocolStore.setAccountState() as unified write path for account changes"
  - "SSE initial-state snapshot pattern for new client hydration"

# Metrics
duration: 8min
completed: 2026-03-08
---

# Phase 84 Plan 03: Real-Time Protocol Data Pipeline Summary

**Fail-closed webhook auth + Helius Enhanced Webhook handler + SSE protocol streaming with useProtocolState hook and 30s polling fallback**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-08T12:26:56Z
- **Completed:** 2026-03-08T12:35:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Webhook auth hardened: production rejects all requests with 500 if HELIUS_WEBHOOK_SECRET is unset (fail-closed)
- Real-time data pipeline: Helius Enhanced Webhook -> protocol-store -> SSE -> useProtocolState hook
- SSE endpoint sends initial state snapshot on connect + protocol-update events
- useProtocolState hook with exponential backoff reconnect, 30s polling fallback, visibility-aware lifecycle

## Task Commits

Each task was committed atomically:

1. **Task 1: Webhook Auth Hardening + Protocol Account Store** - `e24568c` (feat)
2. **Task 2: SSE Protocol Endpoint + React Hook** - `ed335d1` (feat)

## Files Created/Modified
- `app/lib/protocol-store.ts` - In-memory protocol account store with SSE broadcast on write
- `app/app/api/sse/protocol/route.ts` - SSE endpoint streaming protocol-update events with initial state snapshot
- `app/hooks/useProtocolState.ts` - React hook consuming SSE with reconnect + RPC polling fallback
- `app/app/api/webhooks/helius/route.ts` - Fail-closed auth + Enhanced Account Change handler

## Decisions Made
- Enhanced webhook payload discrimination uses `accountData` field presence on first array element to distinguish from raw transaction payloads
- 30s SSE downtime threshold chosen to balance responsiveness vs unnecessary polling
- getMultipleAccountsInfo fetches all 7 monitored PDAs in a single RPC call (efficient polling)
- SSE event filtering done via string prefix match (`payload.startsWith("event: protocol-update\n")`) rather than parsing all events

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. Helius Enhanced Webhook registration is documented in code comments but is a deployment-time task.

## Next Phase Readiness
- Protocol state pipeline complete and ready for consumption by existing hooks
- Existing hooks (useEpochState, usePoolPrices, etc.) can adopt useProtocolState for SSE-based updates
- Helius Enhanced Webhook registration needed at deployment time (documented in useProtocolState.ts header)

---
*Phase: 84-frontend-hardening-mainnet-readiness*
*Completed: 2026-03-08*
