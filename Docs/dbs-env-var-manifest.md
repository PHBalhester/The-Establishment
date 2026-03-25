# DBS Migration — Environment Variable Manifest

**Date:** 2026-03-20
**Context:** DBS Phase 7 — Complete list of env vars introduced by the server-side SSE migration

## New Environment Variables

All new env vars are **server-side only** (no `NEXT_PUBLIC_` prefix). They must be set in both `app/.env.local` (local dev) and the Railway dashboard (production).

| Env Var | Required | Default | Type | Description |
|---------|----------|---------|------|-------------|
| `WS_SUBSCRIBER_ENABLED` | Yes | `true` | `"true"` / `"false"` | Feature flag — enables/disables the server-side WebSocket subscriber pipeline. Set `false` for instant rollback to pre-DBS behavior. |
| `TOKEN_SUPPLY_POLL_INTERVAL_MS` | No | `60000` | Integer (ms) | How often ws-subscriber calls `getTokenSupply()` for CRIME and FRAUD mints. Lower = fresher supply data but more RPC credits. |
| `STAKER_COUNT_POLL_INTERVAL_MS` | No | `30000` | Integer (ms) | How often ws-subscriber runs `getProgramAccounts()` to aggregate staker count and locked/unlocked classification. This is the most expensive poll (~1 credit per call). |
| `SLOT_BROADCAST_INTERVAL_MS` | No | `5000` | Integer (ms) | Throttle interval for broadcasting slot updates to SSE clients. Solana produces slots every ~400ms; this avoids flooding clients with 2.5 slot updates/sec. |

## Existing Environment Variables (unchanged)

These are **not new** but are used by the DBS infrastructure:

| Env Var | Used By | Notes |
|---------|---------|-------|
| `NEXT_PUBLIC_RPC_URL` | Browser RPC proxy, `getConnection()` | Server-side Helius endpoint — ws-subscriber uses this via `getConnection()`. No separate WS env var needed; ws-subscriber computes `wss://` from the `https://` URL. |
| `NEXT_PUBLIC_CLUSTER` | protocol-config.ts, anchor.ts | Drives address resolution. Must be `devnet` for devnet, `mainnet` for mainnet. |

## Railway Dashboard Setup

For a fresh deploy, add these to the Railway service's environment variables:

```
WS_SUBSCRIBER_ENABLED=true
TOKEN_SUPPLY_POLL_INTERVAL_MS=60000
STAKER_COUNT_POLL_INTERVAL_MS=30000
SLOT_BROADCAST_INTERVAL_MS=5000
```

## Design Note: No HELIUS_WS_URL

The original plan (CONTEXT D5) included a `HELIUS_WS_URL` env var. This was **not needed** — `ws-subscriber.ts` computes the WebSocket URL automatically by replacing `https://` with `wss://` in the connection URL from `getConnection()`. This keeps configuration simpler (one fewer env var to manage).

## Rollback

Setting `WS_SUBSCRIBER_ENABLED=false` disables the entire DBS pipeline:
- ws-subscriber stops subscribing to Solana WebSocket and polling
- protocolStore still receives data from Helius Enhanced Webhooks (pre-DBS path)
- useProtocolState falls back to RPC polling (preserved in Phase 3)

No other env var changes needed for rollback.
