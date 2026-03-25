---
status: diagnosed
trigger: "ws-subscriber initializes successfully but API routes can't see its state. Health endpoint returns initialized:false despite logs showing success."
created: 2026-03-20T00:00:00Z
updated: 2026-03-20T01:00:00Z
---

## Current Focus

hypothesis: CONFIRMED - The NODE_ENV !== "production" guard on globalThis assignment, combined with Turbopack module duplication across separate entry point chunk graphs, causes each consumer (instrumentation vs API routes) to get its own fresh class instance in production.
test: Read all singleton patterns + Turbopack build output + Next.js instrumentation loader
expecting: Finding that globalThis is never assigned in production AND modules are evaluated separately
next_action: Write root cause report

## Symptoms

expected: After ws-subscriber initializes in instrumentation.ts, API routes should read protocol-store state, credit-counter state, and ws-subscriber status via globalThis singletons. SSE endpoint should broadcast events. Frontend should display data.
actual: ws-subscriber logs show successful init (8 accounts, 6 stakers, slot subscription, supply poll, staker poll all started). But /api/health returns initialized:false, wsConnected:false, latestSlot:0. Credit counter in health shows 3 calls (browser RPC proxy) instead of 5+ calls ws-subscriber made. Frontend shows blank/loading state.
errors: No errors in logs. API routes read from empty/default singleton instances.
reproduction: Deploy to Railway. Check /api/health.
started: First production deploy of DBS migration.

## Eliminated

- hypothesis: "Local .next/ build shows empty register() function — maybe instrumentation code isn't running"
  evidence: Local build is stale (Mar 17) while source was modified Mar 20. Railway logs explicitly show "[ws-subscriber] Batch seed complete" and "[ws-subscriber] Initialized successfully" — confirming init() does execute in the Railway production build.
  timestamp: 2026-03-20

- hypothesis: "Turbopack runtime isn't shared between entry points"
  evidence: Both instrumentation.js and route.js require() the same [turbopack]_runtime.js file. Node.js require cache guarantees they get the same runtime instance. The moduleCache and moduleFactories are shared at runtime level.
  timestamp: 2026-03-20

## Evidence

- timestamp: 2026-03-20
  checked: All 5 singleton files (protocol-store.ts, credit-counter.ts, ws-subscriber.ts, sse-manager.ts, sse-connections.ts)
  found: All 5 use identical pattern — `if (process.env.NODE_ENV !== "production") { globalForX.y = instance; }` — which SKIPS the globalThis assignment in production
  implication: In production, globalThis is never populated. Each module evaluation creates a fresh instance. If modules are evaluated more than once, instances diverge.

- timestamp: 2026-03-20
  checked: Turbopack production build output structure (.next/server/)
  found: instrumentation.js is a SEPARATE entry point from API route .js files. Each loads DIFFERENT chunks (e.g., instrumentation loads "app_instrumentation_ts_12894ad0._.js" while health route loads "[root-of-the-server]__aaeb5dc5._.js" and 5 other chunks). Different chunks can package the same source module with different numeric module IDs.
  implication: If protocol-store.ts gets module ID X in the instrumentation chunk graph and module ID Y in the health route chunk graph, Turbopack's moduleCache treats them as separate modules and evaluates each independently.

- timestamp: 2026-03-20
  checked: instrumentation.ts source — uses dynamic import `await import("@/lib/ws-subscriber")`
  found: Dynamic import creates a separate chunk boundary in Turbopack. The ws-subscriber module (and its transitive dependencies: protocol-store, credit-counter) may be bundled into the instrumentation chunk with different module IDs than the same files bundled for API route chunks.
  implication: Turbopack's code-splitting treats the instrumentation entry and route entries as independent chunk graphs, potentially assigning different IDs to the same source files.

- timestamp: 2026-03-20
  checked: Next.js source code for how instrumentation and API routes are loaded at runtime
  found: Both use Node.js native require() (instrumentation-globals.external.js line 43, require.js line 105). They go through the same Turbopack runtime. However, Turbopack's moduleFactories map is populated by loadRuntimeChunk() — each entry point loads different chunk files. If those chunks contain duplicate module factories with different IDs, both get installed in moduleFactories, and each is instantiated independently into moduleCache.
  implication: Shared Turbopack runtime does NOT guarantee shared module instances. Module instance sharing depends on module ID stability across chunks, which is NOT guaranteed by Turbopack's chunking algorithm.

- timestamp: 2026-03-20
  checked: GitHub discussions on Next.js singleton patterns
  found: Multiple reports confirming this exact issue: vercel/next.js #68572 ("Canonical approach to instantiating singletons"), #65350 ("Inconsistent Singleton"), #84445 ("objects initialised in instrumentation.ts not available in rest of code"), #77776 ("instrumentation.ts not working in production"). The documented solution is to ALWAYS use globalThis in production (not just dev).
  implication: This is a known, well-documented Next.js behavior. The standard Prisma-style pattern (only cache in dev) assumes webpack's module deduplication, which Turbopack does not guarantee across entry points.

- timestamp: 2026-03-20
  checked: Credit counter method names reported by /api/health
  found: Health shows getBalance, getTokenAccountsByOwner, getAccountInfo (browser RPC proxy methods). ws-subscriber records getMultipleAccountsInfo, getTokenSupply, getSlot, getProgramAccounts. These are completely disjoint sets.
  implication: The creditCounter instance in the health route (imported from credit-counter.ts) is a DIFFERENT instance from the one in ws-subscriber. The health route's instance only sees calls from the /api/rpc proxy route (which shares the route-chunk-graph instance). The ws-subscriber's instance (in the instrumentation-chunk-graph) is unreachable from health.

## Resolution

root_cause: |
  **All 5 globalThis singleton modules skip the globalThis assignment in production.**

  Every singleton (protocol-store.ts, credit-counter.ts, ws-subscriber.ts, sse-manager.ts, sse-connections.ts) uses the Prisma-style HMR pattern:

  ```typescript
  export const instance = globalForX.x ?? new Class();
  if (process.env.NODE_ENV !== "production") {
    globalForX.x = instance;
  }
  ```

  This pattern was designed for webpack where all server-side code shares a single module evaluation. In production (`NODE_ENV=production`), the globalThis assignment is intentionally skipped because "there's only one module load."

  **But Turbopack (Next.js 16) does NOT guarantee single module evaluation.** The instrumentation.ts entry point and API route entry points load separate chunk files. Turbopack's chunking algorithm can assign different numeric module IDs to the same source file across different chunk graphs. When this happens:

  1. `instrumentation.js` loads its chunks → protocol-store.ts evaluated → creates `ProtocolStore #1`
  2. `route.js` (health) loads its chunks → protocol-store.ts evaluated AGAIN → creates `ProtocolStore #2`
  3. globalThis is never populated (production guard), so neither instance knows about the other
  4. ws-subscriber populates `ProtocolStore #1` with data
  5. Health endpoint reads from `ProtocolStore #2` which is empty

  Same divergence affects credit-counter (ws-subscriber writes to instance A, health reads from instance B), ws-subscriber state (init sets initialized=true on state A, getStatus reads from state B), and sse-manager (ws-subscriber broadcasts to manager A, SSE route subscribes to manager B).

  **The fix is trivial:** Remove the `NODE_ENV !== "production"` guard from all 5 files, so globalThis is ALWAYS populated regardless of environment.

fix:
verification:
files_changed: []
