# VERIFY-LOW-BATCH: Low-Severity Findings Bulk Verification
**Verified:** 2026-03-09

All LOW findings below were checked for source changes since 2026-03-08. No source changes affect these findings unless noted otherwise.

---

## H021: Build Script Mint Patching
**Status:** NOT_FIXED
**Previous:** NOT_FIXED
Deploy pipeline `scripts/deploy/build.sh` still contains patch-mint logic. Accepted design -- admin-only infrastructure for the chicken-and-egg mint address problem.

## H028: Health Endpoint Information Disclosure
**Status:** NOT_FIXED
**Previous:** NOT_FIXED
`app/app/api/health/route.ts` still returns dependency status (postgres, solanaRpc boolean connectivity). Low risk -- standard health endpoint practice, no version numbers or credentials exposed.

## H031: No Unhandled Rejection Handler
**Status:** NOT_FIXED
**Previous:** NOT_FIXED
No `unhandledRejection`/`uncaughtException` handlers in `scripts/crank/crank-runner.ts`. However, Phase 89 added a circuit breaker (5 consecutive errors = halt), which provides crash recovery for the most common failure mode. The `main().catch()` still handles top-level errors.

## H033: Candle Close Price Ordering
**Status:** NOT_FIXED
**Previous:** NOT_FIXED
`app/db/candle-aggregator.ts` still uses last-write-wins for close price. No ORDER BY timestamp on upsert. Low practical risk since Helius delivers in order.

## H039: skipPreflight on Bonding Curve TXs
**Status:** NOT_FIXED
**Previous:** NOT_FIXED
`BuyForm.tsx` and `SellForm.tsx` still use `skipPreflight: true`. Intentional for devnet (v0 TX workaround). Will be revisited for mainnet.

## H041: No Compute Budget for Bonding Curve TXs
**Status:** NOT_FIXED
**Previous:** NOT_FIXED
No `ComputeBudgetProgram` usage in bonding curve frontend forms. Default 200k CU allocation used. Will be revisited for mainnet priority fee tuning.

## H048: Sign-Then-Send Pattern
**Status:** NOT_FIXED
**Previous:** NOT_FIXED
`useProtocolWallet.ts` still uses sign-then-send (bypasses wallet simulation). Documented workaround for Phantom's broken devnet `signAndSendTransaction`. Will be revisited for mainnet.

## H056: Deprecated Package Audit
**Status:** NOT_FIXED
**Previous:** NOT_FIXED
No automated dependency audit (`npm audit`, `cargo audit`) in CI. Accepted maintenance item.

## H060: Committed API Keys
**Status:** NOT_FIXED
**Previous:** NOT_FIXED
`scripts/deploy/pda-manifest.json` still contains Helius devnet free-tier API key. Phase 89 commit `82fafe0` removed HELIUS_API_KEY from webhook route, but the PDA manifest key remains. Low risk -- devnet free-tier key, not a production secret.

## H069: No Minimum Sell Amount
**Status:** NOT_FIXED
**Previous:** NOT_FIXED
No explicit minimum sell threshold. On-chain `InputAmountTooSmall` error provides sufficient protection against dust sells.

## H072: Additive Price Impact
**Status:** NOT_FIXED
**Previous:** NOT_FIXED
`useRoutes.ts` still sums price impact additively across hops. Low practical impact since most swaps are single-hop.

## H076: Crank Balance Logging
**Status:** NOT_FIXED
**Previous:** NOT_FIXED
Crank logs wallet balance when low. Low risk for operational wallet (public key already logged).

## H084: Cross-Language Constant Sync
**Status:** NOT_FIXED
**Previous:** NOT_FIXED
Constants still exist in multiple locations (Rust, TypeScript). Compile-time offset validation mitigates some drift. Phase 89 added cross-crate serialization tests (`tests/cross-crate/src/lib.rs`) but no cross-language sync mechanism.

## H085: Health Endpoint Always 200
**Status:** NOT_FIXED
**Previous:** NOT_FIXED
Health endpoint still returns HTTP 200 even when degraded. Intentional for Railway healthcheck compatibility.

## H089: Error Message Truncation
**Status:** NOT_FIXED
**Previous:** NOT_FIXED
Crank error messages still truncated to 300 chars. Accepted tradeoff for log readability.

## H091: No Distributed Crank Lock
**Status:** NOT_FIXED
**Previous:** NOT_FIXED
Single-instance crank assumption remains. No distributed locking mechanism. VRF TOCTOU handling provides some protection. Accepted for current scale.

## H092: In-Memory SSE Pub/Sub
**Status:** PARTIALLY_FIXED
**Previous:** NOT_FIXED
SSE manager remains in-memory (single-process). However, Phase 89 added SSE connection caps (`app/lib/sse-connections.ts`): 3 per IP, 100 global maximum, with 30-minute auto-release for zombie connections. This mitigates the resource exhaustion risk even though it doesn't address multi-process scaling.

## H095: Deploy Script Exports All Env Vars
**Status:** NOT_FIXED
**Previous:** NOT_FIXED
`deploy-all.sh` still uses `set -a && source .env`. Standard practice for deploy scripts. Admin-only infrastructure.

## H096: BN.toNumber() Precision Risk
**Status:** NOT_FIXED
**Previous:** NOT_FIXED
Multiple `.toNumber()` calls on BN values in hooks. Safe for current token supplies (max ~1e15, within MAX_SAFE_INTEGER) but fragile if supplies change.

## H110: No On-Chain Timelock
**Status:** NOT_FIXED
**Previous:** NOT_FIXED
No timelock mechanism in programs. Squads multisig planned for mainnet but not yet implemented.

## H111: Localhost RPC Fallback
**Status:** NOT_FIXED
**Previous:** NOT_FIXED
Multiple scripts fallback to `http://localhost:8899` when CLUSTER_URL unset. No guard rejects localhost in production mode.

## H119: No Frontend Minimum Amount
**Status:** NOT_FIXED
**Previous:** NOT_FIXED
No frontend minimum enforcement for tiny swap amounts. On-chain `InputAmountTooSmall` guard is sufficient.

## H124: BigInt/Number Mixing in BuyForm
**Status:** NOT_FIXED
**Previous:** NOT_FIXED
`BuyForm.tsx` still uses `BigInt(Math.floor(crimeBalance * Number(TOKEN_DECIMAL_FACTOR)))`. Precision safe for current token balance ranges.

## H125: BigInt/Number Mixing in Demo Mode
**Status:** NOT_FIXED
**Previous:** NOT_FIXED
`useCurveState.ts` demo mode still uses Number intermediate for BigInt. Demo mode only, no financial impact.

## H131: Discoverable Webhook URL
**Status:** NOT_FIXED
**Previous:** NOT_FIXED
Webhook URL path remains standard (`/api/webhooks/helius`). Auth secret protects against unauthorized access. Phase 89 added timing-safe comparison and rate limiting to the webhook endpoint, strengthening the auth even though the URL remains discoverable.

## H132: Railway Dashboard Access
**Status:** NOT_FIXED
**Previous:** NOT_FIXED
Infrastructure-level access control. Outside scope of code changes.
