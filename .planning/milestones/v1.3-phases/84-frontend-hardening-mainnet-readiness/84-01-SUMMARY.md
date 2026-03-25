---
phase: 84-frontend-hardening-mainnet-readiness
plan: 01
subsystem: infra
tags: [rpc-proxy, helius, cluster-config, solscan, security]

# Dependency graph
requires:
  - phase: 69-devnet-redeploy
    provides: Helius RPC URL and devnet program addresses
provides:
  - /api/rpc proxy route with method allowlist (16 methods)
  - CLUSTER_CONFIG object with devnet/mainnet-beta keys
  - getClusterConfig() helper for cluster-aware address resolution
  - Browser-vs-server RPC routing in connection.ts
  - Cluster-aware solscanTxUrl, solscanAccountUrl, solscanTokenUrl
  - getCluster() helper reading NEXT_PUBLIC_CLUSTER env var
affects: [85-launch-page-mobile-polish, v1.4-mainnet-deploy]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "RPC proxy pattern: browser -> /api/rpc -> Helius (API key server-side)"
    - "Cluster-keyed config: CLUSTER_CONFIG['devnet'] vs CLUSTER_CONFIG['mainnet-beta']"
    - "NEXT_PUBLIC_CLUSTER as single env var for frontend cluster switching"

key-files:
  created:
    - app/app/api/rpc/route.ts
  modified:
    - shared/constants.ts
    - shared/index.ts
    - app/lib/connection.ts
    - app/lib/solscan.ts
    - app/providers/providers.tsx

key-decisions:
  - "Mainnet vanity mint addresses used in CLUSTER_CONFIG (cRiME, FraUd, pRoFiT) -- program IDs placeholder until v1.4"
  - "CSP connect-src still whitelists Helius URLs as safety net -- cleanup deferred to v1.4 when proxy is battle-tested"
  - "WebSocket disabled for /api/rpc proxy (HTTP-only) -- browser uses HTTP polling for all current needs"
  - "DEVNET_RPC_URL kept as fallback in connection.ts for local dev without HELIUS_RPC_URL env var"

patterns-established:
  - "RPC proxy: All browser RPC calls go through /api/rpc, never directly to Helius"
  - "Cluster config: getClusterConfig(cluster) returns full address set for any cluster"
  - "Explorer URLs: getCluster() reads NEXT_PUBLIC_CLUSTER with NEXT_PUBLIC_SOLANA_CLUSTER fallback"

# Metrics
duration: 8min
completed: 2026-03-08
---

# Phase 84 Plan 01: RPC Proxy + Cluster Config Summary

**Helius API key secured behind /api/rpc proxy with method allowlist; CLUSTER_CONFIG provides one-env-var mainnet switching for all addresses and explorer links**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-08T12:20:43Z
- **Completed:** 2026-03-08T12:29:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Helius API key no longer exposed to the browser -- all RPC calls route through /api/rpc
- CLUSTER_CONFIG object with devnet values populated and mainnet-beta placeholders (vanity mints included)
- Connection factory auto-detects browser vs server and routes RPC accordingly
- Explorer links (tx, account, token) are cluster-aware via NEXT_PUBLIC_CLUSTER
- Faucet link audit confirmed no remaining references (BalanceDisplay.tsx already deleted)

## Task Commits

Each task was committed atomically:

1. **Task 1: RPC Proxy Route + Cluster-Keyed Config** - `8bcaf4e` (feat)
2. **Task 2: Explorer Links + Conditional Faucet** - `3ef9d67` (feat)

## Files Created/Modified
- `app/app/api/rpc/route.ts` - JSON-RPC proxy with 16-method allowlist, forwards to HELIUS_RPC_URL
- `shared/constants.ts` - Added CLUSTER_CONFIG, ClusterName, ClusterConfig, getClusterConfig()
- `shared/index.ts` - Barrel exports for new cluster config types and helpers
- `app/lib/connection.ts` - Browser/server auto-detection, /api/rpc for browser, HELIUS_RPC_URL for server
- `app/lib/solscan.ts` - Added solscanAccountUrl(), solscanTokenUrl(), getCluster() helper
- `app/providers/providers.tsx` - Removed DEVNET_RPC_URL import, endpoint now /api/rpc

## Decisions Made
- Kept DEVNET_RPC_URL as fallback in connection.ts for local dev (some devs may not have HELIUS_RPC_URL set)
- WebSocket disabled for proxy connections (browser polling sufficient for current hook patterns)
- CSP connect-src retains Helius URLs as safety net during transition period
- Mainnet CLUSTER_CONFIG uses the generated vanity mint addresses from memory (cRiME, FraUd, pRoFiT)

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- RPC proxy ready for all browser RPC calls
- CLUSTER_CONFIG ready for v1.4 mainnet address population
- Explorer links automatically switch with NEXT_PUBLIC_CLUSTER env var
- No blockers for remaining 84-xx plans

---
*Phase: 84-frontend-hardening-mainnet-readiness*
*Completed: 2026-03-08*
