# Phase 84: Frontend Hardening & Mainnet-Readiness - Context

**Gathered:** 2026-03-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Secure the frontend (RPC key protection via proxy, real-time data via webhook+SSE, dynamic priority fees), make all frontend code environment-aware for mainnet switching, and clean up dead code. 17 requirements: FE-01 through FE-09, MNR-01 through MNR-04, CLN-01 through CLN-04.

</domain>

<decisions>
## Implementation Decisions

### RPC Proxy Architecture (FE-07, FE-01)
- Next.js API route at `/api/rpc` — accepts JSON-RPC requests, forwards to Helius with API key server-side
- **Allowlisted methods only** — only proxy RPC methods the frontend actually calls (getAccountInfo, getBalance, sendTransaction, getPriorityFeeEstimate, etc.). Blocks abuse of Helius plan
- **Global switch in connection.ts** — detects browser environment and uses `/api/rpc` as endpoint automatically. Server-side code (API routes, SSR) still uses direct Helius URL
- **Everything through proxy** including sendTransaction — uniform security model, slight latency overhead acceptable for keeping Helius key fully hidden
- Helius API key in server-only env var (no NEXT_PUBLIC_ prefix)

### Real-time Data Pipeline (FE-03, FE-04)
- **Webhook → in-memory → SSE** architecture: Helius webhook POSTs account changes to API route, route stores latest state in memory (Map/global), SSE endpoint streams from that in-memory store
- **Protocol accounts only** monitored via webhook: EpochState, PoolState (4 pools), StakePool, ConversionVault, CurveState — all known PDAs. User token balances still fetched on-demand (wallet connect, after TX)
- **Auto-reconnect + poll fallback** — SSE client auto-reconnects (built-in EventSource). If SSE down >30s, fall back to polling at 60s. No visual indicator of connection status — data updates silently
- No connection status indicator — users don't need to see the plumbing

### Priority Fee Strategy (FE-05)
- **Dynamic default + user override** — fetch recommended fee from Helius Priority Fee API before each TX. User can override via Settings
- **Through RPC proxy** — getPriorityFeeEstimate added to the proxy allowlist. Same `/api/rpc` endpoint, consistent architecture
- **Low/Medium/High = Helius percentiles** — Low = 25th percentile ("economy"), Medium = 50th ("medium", Helius default), High = 75th ("high"). User picks a speed tier, not a raw number
- **Fallback to hardcoded default** — if Helius Priority Fee API unreachable, use sensible default (e.g., 50,000 micro-lamports). TX still submits, log the fallback

### Environment Switching (MNR-01, MNR-02, MNR-03)
- **NEXT_PUBLIC_CLUSTER env var** — single source of truth: 'devnet' or 'mainnet-beta'. All cluster-dependent logic reads this. Runtime check, no rebuild needed to switch clusters
- **Cluster-keyed config object** in shared/ package: `CONFIG['devnet'].CRIME_MINT`, `CONFIG['mainnet-beta'].CRIME_MINT`. Frontend reads NEXT_PUBLIC_CLUSTER to pick the right set. Mainnet values filled in during v1.4 deploy
- **Explorer links via utility function** — single `getSolscanUrl(address, type)` function in existing `app/lib/solscan.ts`. Reads NEXT_PUBLIC_CLUSTER, appends `?cluster=devnet` only when not on mainnet
- **Faucet link hidden entirely on mainnet** — conditionally rendered only when `cluster === 'devnet'`. No replacement link

### Sentry Hardening (FE-08)
- Existing zero-dependency `app/lib/sentry.ts` (POST to Sentry ingest API via fetch) is the foundation — harden and verify, don't replace

### Token Metadata (FE-09)
- Prepare JSON structure for token metadata. Logos provided externally, Arweave upload deferred to v1.4

### Cleanup (CLN-01 through CLN-04)
- Mechanical deletions: BalanceDisplay.tsx (107 lines), swap/page.tsx legacy route, stale DashboardGrid comments (8 hooks)
- PriorityFeePreset migration from useStaking.ts to SettingsProvider
- MNR-04: Fix staking-builders.ts TS error (removed systemProgram reference)

### Claude's Discretion
- Exact RPC method allowlist (discover by auditing frontend hook usage)
- In-memory store implementation (Map vs module-level variable)
- SSE reconnection timing and poll fallback threshold tuning
- Error map entries for Tax codes 6014-6017 (straightforward additions)
- Webhook secret validation implementation (FE-02) — standard HMAC verify

</decisions>

<specifics>
## Specific Ideas

- connection.ts already has singleton pattern with cached URL — extend it with browser detection for proxy vs direct
- solscan.ts already exists at app/lib/solscan.ts — add cluster-aware URL builder there
- SettingsProvider.tsx already manages priority fee settings — extend with dynamic fetch integration
- SSE infrastructure already exists at app/api/sse/ (used for chart candles) — extend for protocol account updates
- Helius webhook handler already exists at app/api/webhooks/helius/route.ts — extend with account change processing
- Phase 83 VRF-07 covers crank-side RPC URL masking — FE-01 is the same concern for crank startup logs

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `app/lib/connection.ts`: Singleton Connection factory — extend with browser/server detection for proxy routing
- `app/lib/solscan.ts`: Explorer link utilities — extend with cluster-aware URL generation
- `app/lib/sentry.ts`: Zero-dep Sentry reporter — harden error handling and verify envelope format
- `app/providers/SettingsProvider.tsx`: Settings context with priority fee presets — integrate dynamic Helius fees
- `app/hooks/useSettings.ts`: Clean settings hook API — unchanged, benefits from provider changes
- `app/app/api/sse/`: SSE endpoint for chart candles — extend or parallel for protocol account updates
- `app/app/api/webhooks/helius/route.ts`: Helius webhook handler — extend for account change events
- `app/lib/sse-manager.ts`: SSE client manager — extend for new protocol data channels
- `app/components/wallet/BalanceDisplay.tsx`: Dead code (107 lines) — delete (CLN-01)

### Established Patterns
- Environment config via NEXT_PUBLIC_ env vars (already used for RPC URL, Privy app ID)
- Singleton pattern in connection.ts (cached instance, URL-based invalidation)
- SSE with EventSource for real-time data (chart candles pattern)
- Zero-dependency approach for browser-compatible utilities (sentry.ts, no @sentry/*)
- Settings managed via React Context (SettingsProvider → useSettings hook)

### Integration Points
- `packages/shared/`: Add cluster-keyed CONFIG object with devnet/mainnet addresses
- `app/app/api/rpc/route.ts`: New API route for RPC proxy
- `app/lib/connection.ts`: Switch to proxy URL in browser, direct URL on server
- `app/app/api/webhooks/helius/route.ts`: Process account change webhooks
- `app/app/api/sse/`: Stream protocol account updates to browser
- All hooks using Connection: Automatically benefit from proxy switch in connection.ts

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 84-frontend-hardening-mainnet-readiness*
*Context gathered: 2026-03-08*
