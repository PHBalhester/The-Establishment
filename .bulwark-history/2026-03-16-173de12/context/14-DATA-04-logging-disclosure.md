---
task_id: db-phase1-logging-disclosure
provides: [logging-disclosure-findings, logging-disclosure-invariants]
focus_area: logging-disclosure
files_analyzed: [app/app/api/webhooks/helius/route.ts, app/app/api/candles/route.ts, app/app/api/carnage-events/route.ts, app/app/api/health/route.ts, app/app/api/sol-price/route.ts, app/app/api/sse/candles/route.ts, app/app/global-error.tsx, app/lib/sentry.ts, app/lib/connection.ts, app/lib/sse-manager.ts, app/db/connection.ts, app/db/schema.ts, app/db/migrate.ts, app/drizzle.config.ts, app/next.config.ts, app/instrumentation-client.ts, scripts/crank/crank-runner.ts, scripts/crank/crank-provider.ts, scripts/deploy/lib/logger.ts, scripts/deploy/initialize.ts, scripts/vrf/devnet-vrf-validation.ts, scripts/backfill-candles.ts, scripts/webhook-manage.ts, shared/programs.ts, shared/constants.ts, app/hooks/useStaking.ts, app/hooks/useSwap.ts, app/components/scene/FactoryOverlay.tsx, app/components/scene/SceneStation.tsx]
finding_count: 8
severity_breakdown: {critical: 0, high: 0, medium: 3, low: 3, informational: 2}
---
<!-- CONDENSED_SUMMARY_START -->
# Logging & Information Disclosure -- Condensed Summary

## Key Findings (Top 8)

1. **Helius API key hardcoded in shared source committed to Git**: The Helius devnet free-tier API key is hardcoded in `shared/constants.ts:474`, `shared/programs.ts:22`, and `scripts/backfill-candles.ts:47`. Bundled into the Next.js client via `app/lib/connection.ts` which imports `DEVNET_RPC_URL` from `@dr-fraudsworth/shared`. Free tier or not, this key grants RPC + webhook management access and will be visible in browser network inspector and JS bundles. -- `shared/programs.ts:22`, `shared/constants.ts:474`

2. **Webhook handler logs full error objects to server stdout**: `console.error("[webhook] Fatal error:", error)` at `route.ts:284` logs the raw error object, which for database errors can include connection strings, query text, or driver internals. Similarly at lines 237 and 263 the full `candleError` and `txError` objects are logged. -- `app/app/api/webhooks/helius/route.ts:237,263,284`

3. **Health endpoint exposes dependency topology**: `/api/health` returns `{ status, checks: { postgres, solanaRpc }, timestamp }` to any unauthenticated caller. Tells attackers exactly which infrastructure components exist and their current state. -- `app/app/api/health/route.ts:51-55`

4. **Webhook response reveals processing counts**: The 200 response includes `{ ok, processed: { transactions, swaps, epochs, carnages } }`. While not directly exploitable, this confirms to any caller (including those who bypass optional auth) that the system processes specific event types. -- `app/app/api/webhooks/helius/route.ts:272-280`

5. **Crank runner logs RPC URL to stdout**: `console.log(\`  RPC: ${process.env.CLUSTER_URL || "localhost"}\`)` at `crank-runner.ts:177`. On Railway, stdout is persistent log storage. If CLUSTER_URL contains an API key (Helius URLs do), the key is recorded in Railway logs. -- `scripts/crank/crank-runner.ts:177`

6. **Server-side console.error passes full error to Railway logs**: API routes at `candles/route.ts:248` and `carnage-events/route.ts:57` log raw error objects. Postgres driver errors can contain connection parameters. -- `app/app/api/candles/route.ts:248`, `app/app/api/carnage-events/route.ts:57`

7. **No source maps served in production (GOOD)**: No `productionBrowserSourceMaps` or `devtool: "source-map"` found in `next.config.ts`. Source code is not exposed via `.map` files. -- `app/next.config.ts`

8. **Global error boundary does not leak stack traces to UI (GOOD)**: `global-error.tsx` shows generic "Something went wrong" message and sends the error only to Sentry via fire-and-forget fetch. No `err.message` or `err.stack` rendered in the DOM. -- `app/app/global-error.tsx`

## Critical Mechanisms

- **Error Handling in API Routes**: All API routes (`webhooks/helius`, `candles`, `carnage-events`, `health`) follow a pattern: `try { ... } catch (error) { console.error(..., error); return NextResponse.json({ error: "Internal server error" }, { status: 500 }); }`. The client-facing response is generic (good), but the server-side log dumps the raw error object (needs review for what postgres.js errors contain). -- `app/app/api/*/route.ts`

- **Sentry Envelope Reporter**: `lib/sentry.ts` sends error name, message, and parsed stack frames to Sentry ingest API. Stack frames are raw `errorObj.stack` lines (filenames only, no source). Fire-and-forget. No user data or env vars included in the envelope. -- `app/lib/sentry.ts:44-69`

- **Crank Runner Structured Logging**: Logs JSON lines to stdout with epoch data, VRF bytes (first 8 only), cycle metrics. No private keys or wallet secret material logged. Wallet pubkey is logged (public info). Error strings truncated to 300 chars (`String(err).slice(0, 300)`). -- `scripts/crank/crank-runner.ts:286-300,303`

- **Deploy Logger**: Writes TX signatures to timestamped log files in `scripts/deploy/`. Only transaction signatures and step names -- no secrets. -- `scripts/deploy/lib/logger.ts`

## Invariants & Assumptions

- INVARIANT: API error responses never include stack traces or internal details -- enforced at `webhooks/helius/route.ts:286`, `candles/route.ts:249`, `carnage-events/route.ts:58` (all return `{ error: "Internal server error" }`)
- INVARIANT: Source maps are not served in production -- enforced by absence of `productionBrowserSourceMaps` in `next.config.ts`
- INVARIANT: Global error boundary renders generic message only -- enforced at `global-error.tsx:38-40`
- ASSUMPTION: Railway log storage is access-controlled -- UNVALIDATED (crank logs contain RPC URLs, public keys, epoch state)
- ASSUMPTION: Helius API key in shared/programs.ts is truly "not a secret" -- PARTIALLY VALIDATED (free tier, but grants RPC + webhook API access)
- ASSUMPTION: `console.error` with raw error objects in API routes does not leak to HTTP response -- validated (Next.js server-side console goes to stdout, not response body)
- ASSUMPTION: The `DEVNET_RPC_URL` constant bundled into client-side JS does not pose a risk -- UNVALIDATED for mainnet migration

## Risk Observations (Prioritized)

1. **Hardcoded API key bundled into client JS**: `shared/programs.ts:22` exports `DEVNET_RPC_URL` with API key inline. `app/lib/connection.ts:16` imports it. Next.js client bundles will contain this key. While devnet free-tier, this pattern will be catastrophic if replicated for mainnet with a paid Helius key. Immediate concern: anyone with the key can manage webhooks via Helius API.
2. **Full error objects logged server-side**: Postgres driver errors from `postgres.js` may include connection URIs in their string representation. If `DATABASE_URL` contains credentials (standard for Railway Postgres), they could appear in Railway logs when DB queries fail.
3. **Health endpoint without authentication**: Exposes Postgres and RPC connectivity status to the public internet. Useful for targeted timing attacks (knowing when infrastructure is degraded).
4. **Crank runner logs RPC URL un-redacted**: Unlike `devnet-vrf-validation.ts:94` which masks the API key (`replace(/api-key=[^&]+/, "api-key=***")`), `crank-runner.ts:177` logs `CLUSTER_URL` raw.

## Novel Attack Surface

- **Webhook response as oracle**: An attacker who can send crafted POST payloads to `/api/webhooks/helius` (auth is optional if `HELIUS_WEBHOOK_SECRET` is unset) receives back `{ processed: { transactions, swaps, epochs, carnages } }`. This provides a feedback loop: the attacker can probe which transaction structures are parsed as valid swap/epoch/carnage events, iteratively refining payloads to inject fake events into the database. The processing counts act as an oracle for the event parser's behavior.

## Cross-Focus Handoffs

- -> **SEC-02 (Secrets Management)**: Hardcoded Helius API key in `shared/constants.ts:474` and `shared/programs.ts:22` is committed to Git and bundled into client JS. Needs assessment for mainnet migration risk.
- -> **API-04 (Webhooks)**: Webhook handler at `route.ts:136-141` has optional auth (skipped if `HELIUS_WEBHOOK_SECRET` unset). Combined with the processing-count oracle in the response, this enables attacker probing. See DATA-04 risk observation on webhook response oracle.
- -> **INFRA-03 (Infrastructure)**: Railway log persistence + raw error logging + un-redacted RPC URLs in crank runner. Need to verify Railway log access controls and retention policy.
- -> **ERR-02 (Error Handling)**: Full error objects passed to `console.error` in all API routes. Need to verify what postgres.js Error objects contain (connection strings? query text?).

## Trust Boundaries

The logging/disclosure trust model has three zones: (1) Client-facing HTTP responses -- well-protected with generic error messages, no stack traces, no internal details leaked; (2) Server-side stdout/stderr -- moderate concern, Railway captures all console output and error objects may contain connection parameters; (3) Client-side JS bundles -- contain the Helius devnet API key via `DEVNET_RPC_URL` import, currently low-risk for devnet but high-risk pattern for mainnet. The project does NOT use a structured logging library (no winston/pino), relying entirely on `console.log/error/warn`. This means there is no centralized log sanitization or level control -- debug-level logging is controlled per-file via `NODE_ENV` checks in only 2 files (`FactoryOverlay.tsx:49`, `SceneStation.tsx:57`).
<!-- CONDENSED_SUMMARY_END -->

---

# Logging & Information Disclosure -- Full Analysis

## Executive Summary

The Dr. Fraudsworth off-chain codebase demonstrates solid defensive posture on the client-facing side: API error responses are generic, global error boundaries show no stack traces, source maps are not served, and security headers (CSP, X-Frame-Options, nosniff) are configured. However, server-side logging practices have gaps that could leak sensitive infrastructure details into Railway's persistent log storage, and a hardcoded Helius API key is committed to source and bundled into client JavaScript.

## Scope

All off-chain TypeScript/TSX code analyzed through the logging and information disclosure lens. On-chain Anchor/Rust programs in `programs/` skipped (run SOS for on-chain audit).

### Files Analyzed (29 total)
- **API routes (6)**: webhooks/helius, candles, carnage-events, health, sol-price, sse/candles
- **Database (4)**: connection.ts, schema.ts, migrate.ts, drizzle.config.ts
- **Libraries (3)**: sentry.ts, connection.ts, sse-manager.ts
- **Config (2)**: next.config.ts, instrumentation-client.ts
- **Frontend (3)**: global-error.tsx, FactoryOverlay.tsx, SceneStation.tsx
- **Scripts (6)**: crank-runner.ts, crank-provider.ts, logger.ts, initialize.ts, devnet-vrf-validation.ts, backfill-candles.ts
- **Shared (2)**: programs.ts, constants.ts
- **Hooks (2)**: useStaking.ts, useSwap.ts
- **Other scripts (1)**: webhook-manage.ts

## Key Mechanisms

### 1. Client-Facing Error Handling

All API routes follow a consistent pattern:
```
catch (error) {
  console.error("[tag] ...", error);   // Server-side only
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
```

This is the SP-029 secure pattern. No stack traces, no error messages, no internal state leaked to the HTTP client. Verified in:
- `app/app/api/webhooks/helius/route.ts:285-288`
- `app/app/api/candles/route.ts:248-252`
- `app/app/api/carnage-events/route.ts:57-61`

The webhook handler has one special case: its 200 response includes processing counts (`{ ok, processed: { transactions, swaps, epochs, carnages } }`). While not error info, this provides operational insight to callers.

### 2. Server-Side Logging

No structured logging framework is used. All logging is via `console.log/error/warn`. Total occurrences:
- `scripts/`: 698 across 29 files
- `app/`: 18 across 9 files (minimal)

The low app-side count is positive -- production Next.js routes are conservative with logging. Script-side logging is heavier but scripts run in controlled environments (local dev, Railway crank).

### 3. Sentry Error Reporting

`app/lib/sentry.ts` implements a zero-dependency reporter that:
- Sends error name, message, and stack frame filenames to Sentry ingest API
- Does NOT include environment variables, user data, or request context
- Fire-and-forget with silenced errors
- Activated by `NEXT_PUBLIC_SENTRY_DSN` env var
- Client-side hooks in `instrumentation-client.ts` catch `window.error` and `unhandledrejection`

No sensitive data leakage path identified in Sentry reporting.

### 4. API Key Exposure

The Helius devnet API key `[REDACTED-DEVNET-HELIUS-KEY]` appears in:
- `shared/programs.ts:22` -- exported as `DEVNET_RPC_URL` (imported by `app/lib/connection.ts`)
- `shared/constants.ts:474` -- exported as `HELIUS_API_KEY`
- `scripts/backfill-candles.ts:47` -- hardcoded
- `scripts/webhook-manage.ts:28` -- fallback default

The `DEVNET_RPC_URL` is imported client-side via `app/lib/connection.ts:16` and `app/providers/providers.tsx:35`, meaning it will be in the browser JS bundle. The code comments say "not a secret" (free tier), but this key provides:
- Unlimited devnet RPC access
- Webhook management (create/delete/update webhooks)

Some scripts correctly redact: `devnet-vrf-validation.ts:94` uses `replace(/api-key=[^&]+/, "api-key=***")`. The crank runner does NOT.

## Trust Model

| Boundary | Trust Level | Concern |
|----------|-------------|---------|
| HTTP responses to clients | HIGH trust | Generic errors only, no leaks found |
| Browser JS bundles | MEDIUM trust | Contains Helius API key (devnet) |
| Railway stdout logs | LOW trust | Raw error objects, un-redacted URLs |
| Deploy log files | LOW trust | TX signatures only, not secrets |
| Sentry ingest | MEDIUM trust | Stack frames sent, no env vars/secrets |

## State Analysis

### Database Connection
- `app/db/connection.ts`: `DATABASE_URL` loaded from env var, never logged directly
- Connection string passed to `postgres()` constructor -- if the constructor throws, the error object may contain the URL
- `migrate.ts:48-49`: On migration failure, logs `error` object -- same concern

### Caching
- SOL price cache in `sol-price/route.ts`: In-memory, no sensitive data
- SSE manager in `sse-manager.ts`: In-memory subscriber set, no data persisted
- DB connection singleton via `globalThis`: Safe pattern

## Dependencies

- **postgres.js**: Database driver. Error objects from this library should be audited for what they contain (connection URIs? query text?). This is the primary risk vector for credential leakage via `console.error`.
- **Drizzle ORM**: Query builder. Errors from Drizzle may wrap postgres.js errors.
- **Helius APIs**: RPC and webhook management. API key committed to source.

## Focus-Specific Analysis

### OC-172: Sensitive Data in Application Logs

**Server-side `console.error` with raw error objects:**

| Location | What's Logged | Risk |
|----------|--------------|------|
| `webhooks/helius/route.ts:237` | `candleError` (full object) | DB errors may contain connection params |
| `webhooks/helius/route.ts:263` | `txError` (full object) | Same |
| `webhooks/helius/route.ts:284` | `error` (full object) | JSON parse or DB connection errors |
| `candles/route.ts:248` | `error` (full object) | DB query errors |
| `carnage-events/route.ts:57` | `error` (full object) | DB query errors |
| `health/route.ts:37,46` | `err` (full object) | DB/RPC connection errors |
| `migrate.ts:49` | `error` (full object) | Migration errors |

The crank runner is more disciplined: `String(err).slice(0, 300)` at `crank-runner.ts:303` truncates errors. However, 300 chars could still include a connection URL.

**Crank runner logs:**
- Wallet public key: `crank-runner.ts:176` -- public info, acceptable
- RPC URL un-redacted: `crank-runner.ts:177` -- may contain API key
- Epoch state data: `crank-runner.ts:185-187` -- protocol state, public on-chain
- VRF bytes (first 8): `crank-runner.ts:296` -- truncated, acceptable
- Carnage WSOL pubkey (truncated): `crank-runner.ts:131` -- `.slice(0, 12)`, acceptable

### OC-173: Stack Traces Exposed to Users

**Not found.** All API routes return generic error messages. The global error boundary (`global-error.tsx`) renders "Something went wrong" with no technical details. This is well-implemented.

### OC-174: Debug Mode Enabled in Production

**Controlled correctly.** Only two files have debug logging gated by `NODE_ENV`:
- `app/components/scene/FactoryOverlay.tsx:49`: `if (process.env.NODE_ENV === 'development')`
- `app/components/scene/SceneStation.tsx:57`: Same

No debug endpoints found. No `/debug`, `/status` (beyond `/api/health`), or introspection routes.

### OC-175: Source Maps Served in Production

**Not found.** `next.config.ts` does not set `productionBrowserSourceMaps: true` or any `devtool` option. Next.js defaults to no source maps in production builds.

### OC-176: Log Injection Enabling Log Forging

**Low risk but present.** The webhook handler logs transaction signatures and pool types from untrusted Helius payloads:
- `route.ts:191-193`: `console.warn(\`[webhook] Unknown pool type: ${swap.poolType} in tx ${signature}\`)`

The `poolType` and `signature` values come from parsed webhook JSON. An attacker who can POST to the webhook (auth is optional) could inject control characters or fake log lines. In a structured logging system this would be caught, but with raw `console.warn` the injected content becomes part of Railway's log stream.

Mitigation: The values are Anchor-deserialized strings and Solana signatures (base58), which have limited character sets. But the outer JSON body is attacker-controlled, so malformed payloads could contain arbitrary strings before parsing.

## Cross-Focus Intersections

### With SEC-02 (Secrets Management)
The Helius API key is technically a credential. While free-tier, it grants webhook management access. The code treats it as a public constant, but for mainnet migration, this pattern must change. The `NEXT_PUBLIC_RPC_URL` env var override exists (`app/lib/connection.ts:33`) and should be used exclusively.

### With API-04 (Webhooks)
The optional auth on the webhook endpoint (`route.ts:136-141`) combined with the processing-count response creates an information disclosure vector. An attacker can:
1. Send crafted transaction payloads
2. Observe which are processed (counts in response)
3. Learn the event parser's behavior
4. Refine payloads to inject fake events

### With ERR-02 (Error Handling)
The `console.error(..., error)` pattern across all API routes needs coordination with ERR-02 to determine:
- What postgres.js Error objects contain in their string representation
- Whether error serialization includes connection parameters
- Whether a log sanitization layer should be added

### With INFRA-03 (Infrastructure)
Railway log persistence and access controls determine the actual risk of server-side logging. If Railway logs are accessible to the team only and have reasonable retention, the risk is lower. If logs are accessible to any Railway team member or persist indefinitely, the risk increases.

## Cross-Reference Handoffs

| Target Agent | Item | Context |
|-------------|------|---------|
| SEC-02 | Helius API key in source code + client bundle | `shared/programs.ts:22`, `shared/constants.ts:474` |
| API-04 | Webhook response as parser oracle | `webhooks/helius/route.ts:272-280` |
| INFRA-03 | Railway log access controls + retention | Crank runner + API route `console.error` output |
| ERR-02 | postgres.js error object content audit | All API route catch blocks |

## Risk Observations

### Medium Risk

1. **Hardcoded API key in client bundle** (Medium -- possible x medium impact): `shared/programs.ts:22` bundles Helius API key into browser JS. Current impact is low (devnet free tier) but the pattern is a template for mainnet code. If `DEVNET_RPC_URL` is replaced with a mainnet URL containing a paid API key, every browser visitor gets the key.

2. **Raw error objects in server logs** (Medium -- possible x medium impact): `console.error("[webhook] Fatal error:", error)` at `route.ts:284`. If postgres.js includes `DATABASE_URL` in error representations, credentials appear in Railway logs. The probability depends on postgres.js error formatting, which should be verified.

3. **Health endpoint exposes infrastructure topology** (Medium -- probable x low impact): `/api/health` returns which dependencies exist (Postgres, Solana RPC) and their status. No authentication. Useful for reconnaissance but not directly exploitable.

### Low Risk

4. **Crank runner logs un-redacted RPC URL** (Low -- possible x low impact): `crank-runner.ts:177`. Railway logs are team-accessible, and the RPC URL is the same devnet free-tier key. Other scripts redact properly.

5. **Webhook processing counts in response** (Low -- possible x low impact): `route.ts:272-280`. Provides operational insight but limited value to attackers.

6. **Log injection via webhook payload** (Low -- unlikely x low impact): Untrusted strings logged at `route.ts:191-193`. Character set of Anchor-deserialized values limits practical exploitation.

### Informational

7. **No structured logging framework**: The project uses raw `console.*` throughout. No centralized log level control, no field redaction, no structured JSON output (except crank runner's manual JSON lines). For a production crypto protocol, a structured logger with field sanitization would be beneficial.

8. **Development-only debug logging is properly gated**: Only 2 component files use `console.warn` in dev mode, controlled by `NODE_ENV` checks.

## Novel Attack Surface Observations

**Webhook response as an event parser oracle**: The combination of (a) optional webhook authentication and (b) processing counts in the response body creates a novel attack surface. An attacker can iteratively probe the Anchor event parser by sending crafted Helius-format transaction payloads and observing which increment the swap/epoch/carnage counters. This is a form of differential analysis -- by varying the `logMessages` field and watching count changes, the attacker can reverse-engineer the exact log format that triggers event parsing and DB insertion. This is not a standard playbook attack; it's specific to this codebase's combination of optional auth + verbose response.

## Questions for Other Focus Areas

1. **For SEC-02**: Is there a plan to migrate from hardcoded API keys to env-var-only configuration before mainnet? The `NEXT_PUBLIC_RPC_URL` override mechanism exists but the hardcoded fallback remains.

2. **For INFRA-03**: What are Railway's log retention and access control policies? Who can view stdout logs from the crank runner process?

3. **For ERR-02**: What does a postgres.js connection error look like when serialized by `console.error`? Does it include the connection string?

4. **For API-04**: Is `HELIUS_WEBHOOK_SECRET` set in the Railway production environment? If not, the webhook endpoint is fully unauthenticated.

## Raw Notes

- Component logging is minimal: only `FactoryOverlay.tsx` and `SceneStation.tsx` use console.warn, both gated by `NODE_ENV === 'development'`
- Hook error logging (`useStaking.ts:279,596`, `useSwap.ts:778,871`) uses `console.error` with error objects -- acceptable for client-side debugging, not a disclosure risk (stays in browser console)
- `scripts/vrf/devnet-vrf-validation.ts:94` has the correct API key redaction pattern: `replace(/api-key=[^&]+/, "api-key=***")`. This should be standardized across all scripts.
- `scripts/vrf/lib/reporter.ts:285` also redacts API keys in URLs -- consistent pattern in VRF code but not elsewhere
- `scripts/backfill-candles.ts:252` redacts at log time: `RPC_URL.replace(HELIUS_API_KEY, "***")` -- good practice but the key is still hardcoded 5 lines above
- The `db/connection.ts` Proxy pattern means connection errors surface lazily at query time, not at import time. This is good for build safety but means errors during first query in a cold start could be verbose.
