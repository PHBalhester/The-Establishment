# Phase 103: Off-chain Security Hardening - Research

**Researched:** 2026-03-23
**Domain:** Off-chain API security, supply chain integrity, rate limiting
**Confidence:** HIGH

## Summary

This phase addresses 7 confirmed Bulwark (off-chain) audit findings that cluster into 4 fix groups: RPC proxy hardening (H008, H010), webhook decode safety (H119, H096), supply chain integrity (H003, H007), and rate limiter IP extraction (H015). All fixes are off-chain TypeScript/config changes -- no on-chain program modifications.

The research found that every fix has a clear, well-defined implementation path. The existing codebase already demonstrates the correct patterns -- `AbortSignal.timeout()` in `sol-price/route.ts`, `captureException()` in `lib/sentry.ts`, rate limit configs in `lib/rate-limit.ts`. The fixes are surgical: most are under 20 lines of code each. The biggest implementation effort is the per-account-type bounds validators (H096), which requires understanding 5 account type structures.

**Primary recommendation:** Fix all 7 findings in 2-3 plans grouped by affected files: Plan 1 covers RPC proxy + rate limiter (H008, H010, H015, and new rate limit configs), Plan 2 covers webhook decode safety (H119, H096), and Plan 3 covers supply chain (H003, H007). Each plan is independently deployable.

## Standard Stack

No new libraries needed. All fixes use existing project infrastructure.

### Core (Already in Project)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 16.1.6 | API route framework | Already in use; all fixes are in API route handlers |
| AbortSignal | built-in | Fetch timeout | Node.js built-in, already used in sol-price/route.ts |
| lib/sentry.ts | custom | Error alerting | Zero-dep Sentry client already in project, works in Node.js |
| lib/rate-limit.ts | custom | IP-based rate limiting | Already powers RPC, webhook, sol-price rate limits |

### Supporting (No Changes Needed)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lib/protocol-store.ts | custom | Account state cache + SSE broadcast | Webhook handler target -- do NOT call on decode failure |
| lib/bigint-json.ts | custom | BigInt serialization | Account normalization after decode, before validation |

### Alternatives Considered

None. CONTEXT.md has locked decisions for all fixes. No library alternatives need evaluation.

## Architecture Patterns

### Fix Group File Mapping

```
Fix Group 1: RPC Proxy Hardening (H008 + H010)
  app/app/api/rpc/route.ts       # All changes in one file

Fix Group 2: Webhook Decode Safety (H119 + H096)
  app/app/api/webhooks/helius/route.ts  # Decode fail-closed + validation
  app/lib/webhook-validators.ts         # NEW: per-account-type validators

Fix Group 3: Supply Chain (H003 + H007)
  railway-crank.toml             # npm install -> npm ci
  railway.toml                   # Verify/add explicit npm ci
  app/package.json               # workspace:* for @dr-fraudsworth/shared

Fix Group 4: Rate Limiter IP + New Limits (H015)
  app/lib/rate-limit.ts          # rightmost IP + new configs
  app/app/api/candles/route.ts   # Add rate limit call
  app/app/api/carnage-events/route.ts  # Add rate limit call
```

### Pattern 1: Body Size Guard (Before JSON Parsing)

**What:** Enforce max payload size before `request.json()` to prevent memory exhaustion
**When to use:** Any public-facing POST endpoint that accepts JSON

```typescript
// Source: CONTEXT.md decision -- 64KB for RPC proxy
const MAX_BODY_BYTES = 65_536; // 64KB
const contentLength = request.headers.get("content-length");
if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
  return new Response("Request Entity Too Large", { status: 413 });
}
```

**Note:** Content-Length may be absent (chunked encoding). The check is defense-in-depth alongside the batch rejection. The webhook handler already has a 1MB guard at line 308 -- the RPC proxy gets a tighter 64KB guard.

### Pattern 2: Batch Rejection (Fail Fast)

**What:** Reject JSON array bodies before any processing
**When to use:** When batch requests are not a legitimate use case

```typescript
// Source: CONTEXT.md decision -- disable batch support entirely
const body = await request.json();
if (Array.isArray(body)) {
  return NextResponse.json(
    { jsonrpc: "2.0", error: { code: -32600, message: "Batch requests not supported" }, id: null },
    { status: 400 },
  );
}
```

**Critical:** This replaces lines 102-105 of rpc/route.ts. The variable `requests` becomes a single-element array from the non-batch body. The method validation loop still works on a 1-element array.

### Pattern 3: Fetch Timeout (AbortSignal)

**What:** Add hard deadline to upstream fetch calls
**When to use:** Any server-side fetch to external services

```typescript
// Source: Proven pattern from app/app/api/sol-price/route.ts:47-48
const upstream = await fetch(endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: bodyStr,
  signal: AbortSignal.timeout(10_000), // 10s hard deadline
});
```

**Note:** When `AbortSignal.timeout` fires, it throws a `DOMException` with `name === "TimeoutError"`. The existing catch block at line 172 already handles this correctly -- it logs and continues to the next failover endpoint. No additional error handling code needed.

### Pattern 4: Concurrent Request Cap (In-Flight Counter)

**What:** Limit concurrent in-flight requests per IP to prevent worker exhaustion
**When to use:** Proxy endpoints where upstream latency is unpredictable

```typescript
// Module-level in-flight counter
const inFlight = new Map<string, number>();

// At handler start (after rate limit check):
const current = inFlight.get(clientIp) ?? 0;
if (current >= MAX_CONCURRENT) {
  return new Response("Service Unavailable", { status: 503 });
}
inFlight.set(clientIp, current + 1);

// In finally block (MUST decrement regardless of outcome):
try {
  // ... proxy logic ...
} finally {
  const count = inFlight.get(clientIp) ?? 1;
  if (count <= 1) inFlight.delete(clientIp);
  else inFlight.set(clientIp, count - 1);
}
```

**Important:** Use `try/finally` not just decrement-on-success. A fetch that times out or throws must still decrement the counter. Without `finally`, aborted requests permanently consume a slot.

### Pattern 5: Fail-Closed Decode Error

**What:** On Anchor decode failure, log + continue, do NOT store data
**When to use:** Any webhook/API that deserializes untrusted input

```typescript
// Source: H119 recommendation + CONTEXT.md decision
} catch (err) {
  console.error(`[webhook] Failed to decode ${label} at ${pubkey}:`, err);
  captureException(new Error(`[webhook] Decode failed for ${label}: ${err}`));
  continue; // Skip to next account -- existing good data stays in store
}
```

**Critical difference from current code:** Current catch block calls `protocolStore.setAccountState()` with the raw attacker-controlled payload. The fix removes that call entirely. The next legitimate webhook or ws-subscriber poll (within 60s) restores correct data naturally.

### Pattern 6: Per-Account-Type Bounds Validation

**What:** Validate decoded account fields against protocol-specific ranges before storing
**When to use:** Between Anchor decode and protocolStore.setAccountState()

```typescript
// Source: H096 recommendation + CONTEXT.md decision
function validateEpochState(decoded: Record<string, unknown>): boolean {
  const bpsFields = [
    "crimeBuyTaxBps", "crimeSellTaxBps",
    "fraudBuyTaxBps", "fraudSellTaxBps",
    "lowTaxBps", "highTaxBps",
  ];
  return bpsFields.every(
    (f) => typeof decoded[f] === "number" && decoded[f] >= 0 && decoded[f] <= 10_000
  );
}
```

**Design note:** Validators should be in a separate file (`lib/webhook-validators.ts`) for testability. Each account type gets its own validator function. The webhook handler calls the appropriate validator based on the `label` from `KNOWN_PROTOCOL_ACCOUNTS`.

### Pattern 7: Rightmost IP Extraction

**What:** Take the last IP from x-forwarded-for (trusted proxy's observation)
**When to use:** When behind a reverse proxy that appends (like Railway)

```typescript
// Source: Railway documentation confirms rightmost is trustworthy
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const ips = forwarded.split(",").map((s) => s.trim()).filter(Boolean);
    if (ips.length > 0) return ips[ips.length - 1]!;
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;
  // ... production warning + fallback ...
  return "unknown";
}
```

**Verified:** Railway Help Station confirms "the right most value of the X-Forwarded-For header is trustworthy" and that Railway appends (not replaces) the header. This is consistent with standard RFC 7239 proxy behavior.

### Anti-Patterns to Avoid

- **Storing raw payload on decode failure:** The current catch block in the webhook handler stores attacker-controlled `accountData` and `rawAccountData` in the protocol store. This is an injection vector via the error path (H119).
- **Trusting leftmost x-forwarded-for:** Client-controlled; enables rate limit bypass via header injection (H015).
- **`npm install` in production builds:** Does not enforce exact lockfile match; allows lockfile drift on the build host (H003).
- **Bare version strings for workspace packages:** `"0.0.1"` silently falls back to npm registry if workspace context is lost; `"workspace:*"` hard-fails (H007).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Request timeout | Custom setTimeout wrapper | `AbortSignal.timeout(ms)` | Built-in, auto-cleans AbortController, fires DOMException caught by existing handler |
| Error alerting | Custom webhook/logging | `captureException()` from `lib/sentry.ts` | Already exists, works in Node.js, zero-dep |
| Rate limiting | New rate limit library | Existing `checkRateLimit()` from `lib/rate-limit.ts` | Already powers 3 endpoints, just add new config profiles |
| IP extraction | Express trust-proxy | Fix `getClientIp()` (4-line change) | No Express in Next.js 16; fixing the existing function is simpler |

**Key insight:** Every fix in this phase uses existing infrastructure. The project already has rate limiting, Sentry alerting, fetch timeouts (in sol-price), and webhook authentication. The audit findings target gaps in where these patterns are applied, not missing capabilities.

## Common Pitfalls

### Pitfall 1: Forgetting try/finally on Concurrent Request Counter

**What goes wrong:** If the fetch throws or times out, the in-flight counter is never decremented. Over time, legitimate requests are blocked with 503 because their IP shows the maximum concurrent slots permanently consumed.
**Why it happens:** Using decrement-on-success instead of decrement-always.
**How to avoid:** Wrap the entire proxy logic in `try { ... } finally { decrement() }`.
**Warning signs:** 503 errors increasing over time while actual traffic is low.

### Pitfall 2: Content-Length Bypass via Chunked Transfer

**What goes wrong:** An attacker sends a large payload without `Content-Length` header (using `Transfer-Encoding: chunked`). The 64KB body-size check only examines `Content-Length` and passes.
**Why it happens:** Not all HTTP clients send `Content-Length`.
**How to avoid:** The 64KB check is defense-in-depth alongside batch rejection. Since batch is rejected at the JSON level (`Array.isArray(body)` returns 400), a single RPC request cannot exceed ~200 bytes regardless. The content-length check is a belt alongside the batch-rejection suspenders.
**Warning signs:** None -- the batch rejection is the primary defense; content-length is supplementary.

### Pitfall 3: Validators Rejecting Legitimate Data

**What goes wrong:** A bounds validator rejects real on-chain data because the validation ranges are too tight (e.g., reserves exactly 0 during pool initialization).
**Why it happens:** Validators written without considering edge cases in protocol lifecycle.
**How to avoid:** For PoolState reserves, use `>= 0` not `> 0` -- pools may briefly have zero reserves during initialization. For CurveState, use `>= 0` for all numeric fields. Sentry alerts on validation rejection will surface false positives quickly.
**Warning signs:** Sentry alerts firing on every legitimate webhook delivery.

### Pitfall 4: npm ci Fails on Workspace Dependencies

**What goes wrong:** Changing `app/package.json` to `"workspace:*"` while `railway-crank.toml` still uses `npm install` causes a build failure because `npm install` resolves workspace protocol differently than `npm ci`.
**Why it happens:** `workspace:*` is an npm workspace protocol that requires workspace-root context.
**How to avoid:** Change `railway-crank.toml` to `npm ci` FIRST (or simultaneously). The crank runs from the workspace root, so `npm ci` correctly resolves `workspace:*` from the lockfile.
**Warning signs:** Railway crank build fails with "workspace:* not found" error.

### Pitfall 5: Anchor Decode Returns BN Objects, Not Plain Numbers

**What goes wrong:** Validators check `typeof decoded[f] === "number"` but Anchor's `coder.accounts.decode()` returns `BN` objects for u64/u128 fields, not JavaScript numbers. The check fails for every field.
**Why it happens:** Anchor uses `@coral-xyz/anchor`'s BN library for big number fields.
**How to avoid:** Run validators AFTER `anchorToJson()` normalization (which converts BN to number or `{ __bigint: "..." }`). The normalized object has plain `number` or `{ __bigint }` tags. Validate against the normalized form.
**Warning signs:** Every decoded account fails validation, all rejections fire Sentry alerts.

### Pitfall 6: railway.toml buildCommand Already Includes npm Run Build

**What goes wrong:** Changing `railway.toml` buildCommand to `npm ci && npm run --workspace app build` duplicates the build step if Nixpacks already runs it.
**Why it happens:** `railway.toml` currently sets `buildCommand = "npm run --workspace app build"`. Nixpacks may also auto-detect and run `npm ci` before the buildCommand.
**How to avoid:** Verify current Nixpacks behavior. The current `buildCommand` only runs the build; Nixpacks handles `npm ci` when `package-lock.json` exists. If Nixpacks already runs `npm ci`, the main app build is safe. If not, prepend `npm ci &&` to the buildCommand.
**Warning signs:** Double `npm ci` runs (slower builds but not broken).

## Code Examples

### RPC Proxy Hardened (H008 + H010 Combined)

```typescript
// Source: rpc/route.ts -- complete handler start with all 4 guards

// Module-level concurrent request tracking
const inFlight = new Map<string, number>();
const MAX_CONCURRENT = 20;

export async function POST(request: NextRequest) {
  const clientIp = getClientIp(request);

  // Guard 1: Rate limit (existing)
  const rateCheck = checkRateLimit(clientIp, RPC_RATE_LIMIT, "rpc");
  if (!rateCheck.allowed) {
    return new Response("Too Many Requests", {
      status: 429,
      headers: { "Retry-After": String(rateCheck.retryAfter) },
    });
  }

  // Guard 2: Concurrent request cap (H010 -- defense-in-depth)
  const current = inFlight.get(clientIp) ?? 0;
  if (current >= MAX_CONCURRENT) {
    return new Response("Service Unavailable", { status: 503 });
  }
  inFlight.set(clientIp, current + 1);

  try {
    // Guard 3: Body size limit (H008 -- 64KB)
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > 65_536) {
      return new Response("Request Entity Too Large", { status: 413 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null },
        { status: 400 },
      );
    }

    // Guard 4: Batch rejection (H008 -- no legitimate batch use)
    if (Array.isArray(body)) {
      return NextResponse.json(
        { jsonrpc: "2.0", error: { code: -32600, message: "Batch requests not supported" }, id: null },
        { status: 400 },
      );
    }

    // ... single request validation and forwarding with AbortSignal.timeout(10_000) ...

  } finally {
    // ALWAYS decrement, even on timeout/error
    const count = inFlight.get(clientIp) ?? 1;
    if (count <= 1) inFlight.delete(clientIp);
    else inFlight.set(clientIp, count - 1);
  }
}
```

### Webhook Decode with Validation (H119 + H096)

```typescript
// Source: webhooks/helius/route.ts -- handleAccountChanges() decode block

import { validateDecodedAccount } from "@/lib/webhook-validators";

// Inside handleAccountChanges for loop:
try {
  if (!programs) { /* lazy init */ }

  const program = programs[decodeInfo.programKey];
  const rawBuffer = Buffer.from(item.rawAccountData.data, "base64");
  const decoded = program.coder.accounts.decode(
    decodeInfo.accountType,
    rawBuffer,
  );
  const bigintFields = /* ... same as current ... */;
  const normalized = anchorToJson(decoded, bigintFields ? { bigintFields } : undefined);

  // NEW: Bounds validation AFTER normalization (H096)
  if (!validateDecodedAccount(label, normalized)) {
    console.error(`[webhook] Bounds validation failed for ${label} at ${pubkey}`);
    captureException(new Error(`[webhook] Bounds validation rejected ${label} at ${pubkey}`));
    continue; // Do NOT store
  }

  protocolStore.setAccountState(pubkey, {
    ...normalized,
    updatedAt: Date.now(),
  });
} catch (err) {
  // H119: Fail-closed -- do NOT call setAccountState
  console.error(`[webhook] Failed to decode ${label} at ${pubkey}:`, err);
  captureException(new Error(`[webhook] Decode failed for ${label}: ${err}`));
  continue;
}
```

### Rightmost IP Extraction (H015)

```typescript
// Source: lib/rate-limit.ts -- getClientIp() replacement

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const ips = forwarded.split(",").map((s) => s.trim()).filter(Boolean);
    // Rightmost IP is the one Railway's proxy observed -- not attacker-controllable
    if (ips.length > 0) return ips[ips.length - 1]!;
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;

  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[rate-limit] WARNING: No proxy headers (x-forwarded-for, x-real-ip) detected. " +
      "All requests sharing a single rate-limit bucket. " +
      "Check reverse proxy configuration (VH-M002)."
    );
  }

  return "unknown";
}
```

### New Rate Limit Configs (H015)

```typescript
// Source: lib/rate-limit.ts -- new profiles

/** /api/candles -- chart data, polls every 5-15s. 120/min very generous */
export const CANDLES_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60_000,
  maxRequests: 120,
};

/** /api/carnage-events -- loaded once per page, SSE provides updates. 60/min generous */
export const CARNAGE_EVENTS_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60_000,
  maxRequests: 60,
};
```

### Supply Chain Fixes (H003 + H007)

```toml
# railway-crank.toml -- H003 fix (one-line change)
[build]
builder = "NIXPACKS"
buildCommand = "npm ci"
```

```json
// app/package.json -- H007 fix (one-line change)
"@dr-fraudsworth/shared": "workspace:*"
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `x-forwarded-for[0]` (leftmost) | `x-forwarded-for[last]` (rightmost) | Industry standard since RFC 7239 | Prevents IP spoofing behind proxies |
| `npm install` in prod builds | `npm ci` in prod builds | npm v7+ best practice | Enforces exact lockfile; prevents drift |
| Bare version `"0.0.1"` for workspace deps | `workspace:*` protocol | npm v7+ | Hard-fails instead of registry fallback |
| Store raw data on decode failure | Fail-closed (skip + alert) | Security best practice | Prevents injection via error path |

**Nothing deprecated or outdated here.** All fixes use current, stable patterns. `AbortSignal.timeout()` is available in Node.js 18+ (project requires Node 22+). `workspace:*` requires npm 7+ (project uses npm 11.x).

## Open Questions

1. **Railway Nixpacks auto-detection for main app build**
   - What we know: `railway.toml` buildCommand is `npm run --workspace app build`. Nixpacks auto-detects `npm ci` when `package-lock.json` exists.
   - What's unclear: Whether Nixpacks still auto-runs `npm ci` when an explicit `buildCommand` is set (it might skip the install phase).
   - Recommendation: Verify during implementation by checking Railway build logs. If Nixpacks skips `npm ci`, prepend it to the buildCommand. CONTEXT.md leaves this to Claude's discretion.

2. **Validator field names after anchorToJson normalization**
   - What we know: Anchor IDL uses `snake_case` (`crime_buy_tax_bps`), but Anchor 0.32 `convertIdlToCamelCase()` converts to camelCase (`crimeBuyTaxBps`). `anchorToJson` preserves whatever keys decode produces.
   - What's unclear: The exact field names in the normalized object (camelCase vs snake_case).
   - Recommendation: During implementation, log a decoded/normalized object for each account type to confirm field names. Build validators against the actual field names.

3. **npm scope registration (@dr-fraudsworth)**
   - What we know: The scope is unclaimed on npm. Registration is free and takes 30 seconds.
   - What's unclear: Whether the user wants to do this now or defer.
   - Recommendation: Include as a manual step in the plan with clear instructions. The user performs the registration; Claude provides the steps.

## Sources

### Primary (HIGH confidence)

- **Bulwark H008** (`.bulwark/findings/H008.md`) -- RPC proxy batch amplification, full attack path documented
- **Bulwark H010** (`.bulwark/findings/H010.md`) -- RPC proxy no timeout, worker exhaustion DoS
- **Bulwark H119** (`.bulwark/findings/H119.md`) -- Decode failure broadcasts raw data via SSE
- **Bulwark H003** (`.bulwark/findings/H003.md`) -- npm supply chain partial fix (npm install vs npm ci)
- **Bulwark H007** (`.bulwark/findings/H007.md`) -- Dependency confusion via unclaimed npm scope
- **Bulwark H096** (`.bulwark/findings/H096.md`) -- Anchor decode no bounds check on account fields
- **Bulwark H015** (`.bulwark/findings/H015.md`) -- IP spoofing bypasses all per-IP rate limits
- **Source code** -- All 7 affected files read and analyzed directly
- **Anchor IDL** -- Account type structures verified from `app/idl/*.json`

### Secondary (MEDIUM confidence)

- [Railway Help Station: Edge Proxy X-Forwarded-For](https://station.railway.com/questions/edge-proxy-x-forwarded-for-and-x-real-ip-c5a50049) -- Railway employee confirms rightmost x-forwarded-for is trustworthy, Railway appends (not replaces)
- [Railway Edge Networking Docs](https://docs.railway.com/networking/edge-networking) -- Confirms edge proxy terminates TLS and adds headers

### Tertiary (LOW confidence)

- Railway Nixpacks auto-detection behavior (whether it runs `npm ci` before explicit `buildCommand`) -- could not verify definitively; needs live test

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all patterns already proven in codebase
- Architecture: HIGH -- exact files, line numbers, and code patterns identified from source
- Pitfalls: HIGH -- derived from actual code analysis and Anchor decode behavior
- Account type fields: MEDIUM -- field names need confirmation post-anchorToJson normalization

**Research date:** 2026-03-23
**Valid until:** Indefinite (patterns are stable; no library version sensitivity)
