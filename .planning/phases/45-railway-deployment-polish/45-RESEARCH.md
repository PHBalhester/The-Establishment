# Phase 45: Railway Deployment + Polish - Research

**Researched:** 2026-02-18
**Domain:** Next.js deployment on Railway, Postgres, CSP, error monitoring, health checks
**Confidence:** HIGH (core deployment, CSP, Sentry) / MEDIUM (Railpack monorepo specifics, backfill strategy)

## Summary

Phase 45 deploys the complete Next.js frontend (Phases 39-44) to Railway with Postgres, Helius webhooks, CSP headers, Sentry error monitoring, and a health check endpoint. The project is an npm workspaces monorepo with the Next.js app in `app/` and shared TypeScript in `shared/`. Railway's Railpack builder auto-detects monorepo structure and handles workspace resolution.

The standard approach is: configure `railway.toml` at the repo root pointing Railway at the `app/` directory, provision Railway Postgres (same private network, zero-latency), use `preDeployCommand` to run Drizzle migrations before boot, set up `proxy.ts` (Next.js 16's replacement for middleware.ts) for CSP headers, integrate `@sentry/nextjs` for error monitoring, and create an `/api/health` endpoint that verifies DB + RPC connectivity.

**Primary recommendation:** Use Railway's Railpack auto-detection with a `railway.toml` config-as-code file. Run Drizzle migrations via `preDeployCommand`. Use the nonce-less CSP approach (via `next.config.ts` `headers()`) since the app is a DeFi frontend where strict-dynamic + nonces would force all pages into dynamic rendering and hurt performance.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Railway (Railpack) | latest | Build + deploy platform | Auto-detects Next.js + monorepo, zero-config container image |
| Railway Postgres | 16+ | Database | Same private network (no egress cost, low latency), `DATABASE_URL` auto-injected |
| @sentry/nextjs | ^9.x | Error monitoring + alerting | Official Sentry SDK for Next.js, supports App Router + Turbopack, free tier |
| drizzle-kit | ^0.31.9 | Migration generation + CLI | Already in project, generates SQL migrations from schema |
| drizzle-orm | ^0.45.1 | Programmatic migrations | Already in project, `migrate()` function for postgres-js driver |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| postgres (postgres.js) | ^3.4.8 | Postgres driver | Already in project, used by Drizzle connection singleton |
| helius-sdk | ^1.x | Webhook creation API | Create rawDevnet webhook pointing at Railway URL |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Railway Postgres | Neon/Supabase | External provider adds latency + egress costs; Railway plugin is same-network |
| `next.config.ts` headers() CSP | `proxy.ts` nonce-based CSP | Nonces force dynamic rendering on ALL pages, killing performance. Non-nonce CSP uses `'unsafe-inline'` for styles but avoids SSR penalty |
| Drizzle `preDeployCommand` migration | Programmatic `migrate()` at app boot | preDeployCommand is cleaner separation; if migration fails, deploy halts before app starts |

**Installation:**
```bash
cd app && npm install @sentry/nextjs --save
```

## Architecture Patterns

### Recommended Project Structure (additions for Phase 45)
```
app/
├── proxy.ts                     # CSP headers (NEW - Next.js 16 convention)
├── instrumentation.ts           # Sentry server init (NEW)
├── instrumentation-client.ts    # Buffer polyfill + Sentry client init (MODIFY)
├── sentry.server.config.ts      # Sentry server SDK config (NEW)
├── sentry.edge.config.ts        # Sentry edge SDK config (NEW)
├── next.config.ts               # Add withSentryConfig wrapper + CSP headers (MODIFY)
├── app/
│   ├── global-error.tsx         # Sentry error boundary (NEW)
│   └── api/
│       └── health/
│           └── route.ts         # Health check endpoint (NEW)
├── db/
│   ├── migrate.ts               # Programmatic migration script (NEW)
│   └── migrations/              # Generated SQL files (NEW, via drizzle-kit generate)
├── scripts/
│   └── backfill.ts              # Historical swap data backfill (NEW)
└── ...
railway.toml                     # Railway config-as-code (NEW, at REPO ROOT)
```

### Pattern 1: Railway Config-as-Code for Monorepo
**What:** `railway.toml` at the repo root tells Railway how to build and deploy the `app/` workspace.
**When to use:** Always -- config-as-code is deterministic and version-controlled.
**Example:**
```toml
# railway.toml (repo root)
# Source: https://docs.railway.com/reference/config-as-code

[build]
builder = "RAILPACK"

[deploy]
startCommand = "npm run start"
preDeployCommand = "npx drizzle-kit migrate"
healthcheckPath = "/api/health"
healthcheckTimeout = 60
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
```

**CRITICAL:** The Railway Config File does NOT follow the Root Directory path. If Root Directory is set to `app/` in Railway dashboard, the `railway.toml` still lives at the repo root level. But `preDeployCommand` executes inside the build context (the `app/` directory), so `npx drizzle-kit migrate` will find `drizzle.config.ts` there.

### Pattern 2: Drizzle Migration via preDeployCommand
**What:** Run `npx drizzle-kit migrate` as Railway's pre-deploy command. This runs between build and deploy, has access to env vars (including DATABASE_URL), and halts deployment on failure.
**When to use:** Every deployment that may have schema changes.
**Example migration script (alternative programmatic approach):**
```typescript
// app/db/migrate.ts
// Source: https://orm.drizzle.team/docs/migrations + community examples
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function runMigrations() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL required");

  // Separate single-connection client for migrations
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);

  try {
    await migrate(db, { migrationsFolder: "./db/migrations" });
    console.log("Migrations complete");
  } finally {
    await client.end();
  }
}

runMigrations().catch(console.error);
```

**NOTE:** `drizzle-kit` is currently in `devDependencies`. Railway's Railpack sets `NPM_CONFIG_PRODUCTION=false` by default, which means devDependencies ARE installed during build. However, if `RAILPACK_PRUNE_DEPS` is enabled, devDependencies are removed after build. The `preDeployCommand` runs in the built image, so if deps are pruned, `drizzle-kit` won't be available. Two options:
1. Move `drizzle-kit` to `dependencies` (safe, adds ~2MB to image)
2. Use programmatic `migrate()` from `drizzle-orm` (already in dependencies) via a custom `db/migrate.ts` script

**Recommendation:** Use the programmatic `migrate()` approach via `tsx db/migrate.ts` (or compile it). This avoids the drizzle-kit devDependency issue entirely and gives more control.

### Pattern 3: CSP Headers via next.config.ts (Non-Nonce)
**What:** Set CSP header via `next.config.ts` `headers()` async function. No nonces, uses `'unsafe-inline'` for styles (Tailwind generates inline styles) and `'strict-dynamic'` is NOT used.
**When to use:** When pages should remain statically optimizable and you don't need per-request nonce rotation.
**Why not nonces:** The Next.js 16 docs explicitly state: "Using nonces has important implications -- all pages must be dynamically rendered. Static optimization and ISR are disabled. Partial Prerendering (PPR) is incompatible." For a DeFi frontend, static optimization of non-authenticated pages is valuable.

**Example:**
```typescript
// In next.config.ts headers()
// Source: https://nextjs.org/docs/app/guides/content-security-policy

const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:;
  font-src 'self';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  child-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org;
  frame-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org https://challenges.cloudflare.com;
  connect-src 'self' https://auth.privy.io wss://relay.walletconnect.com wss://relay.walletconnect.org wss://www.walletlink.org https://*.rpc.privy.systems https://explorer-api.walletconnect.com https://devnet.helius-rpc.com wss://devnet.helius-rpc.com https://api.helius.xyz;
  worker-src 'self';
  manifest-src 'self';
  upgrade-insecure-requests;
`;
```

### Pattern 4: Sentry Integration with Existing instrumentation-client.ts
**What:** The project already has `instrumentation-client.ts` for Buffer polyfills. Sentry's client init must be appended to this file (not replace it). Server init goes in a new `instrumentation.ts` + `sentry.server.config.ts`.
**When to use:** Always -- Sentry needs both client and server initialization.
**Key consideration:** `withSentryConfig()` wraps `next.config.ts` and handles source map upload, breadcrumbs, and error reporting.

### Pattern 5: Health Check Endpoint
**What:** `/api/health` route that verifies Postgres connectivity and Solana RPC availability.
**When to use:** Railway queries this path after deployment to confirm the app is healthy.
**Example:**
```typescript
// app/app/api/health/route.ts
import { NextResponse } from "next/server";
import { db } from "@/db/connection";
import { sql } from "drizzle-orm";
import { getConnection } from "@/lib/connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, boolean> = {};

  // Check Postgres
  try {
    await db.execute(sql`SELECT 1`);
    checks.postgres = true;
  } catch {
    checks.postgres = false;
  }

  // Check Solana RPC
  try {
    const conn = getConnection();
    const slot = await conn.getSlot();
    checks.solanaRpc = slot > 0;
  } catch {
    checks.solanaRpc = false;
  }

  const healthy = Object.values(checks).every(Boolean);
  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", checks },
    { status: healthy ? 200 : 503 },
  );
}
```

### Anti-Patterns to Avoid
- **Running `npm install` in preDeployCommand:** Dependencies should be installed during build, not deploy. preDeployCommand is for data operations (migrations, seeding).
- **Using `output: 'standalone'` with monorepo without `outputFileTracingRoot`:** Without setting `outputFileTracingRoot` to the monorepo root, standalone mode won't trace dependencies from the `shared/` workspace package. However, Railway's Railpack handles this automatically -- don't enable standalone unless Railway's auto-detection fails.
- **Hardcoding DATABASE_URL in code:** Railway injects `DATABASE_URL` as an environment variable. The existing `db/connection.ts` already reads from `process.env.DATABASE_URL` correctly.
- **Using `middleware.ts` instead of `proxy.ts`:** Next.js 16 renamed middleware to proxy. The project currently has neither, so create `proxy.ts` directly.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Database migrations | Custom SQL runner | `drizzle-orm/postgres-js/migrator` `migrate()` | Tracks applied migrations in `__drizzle_migrations` table, idempotent |
| Container image building | Dockerfile | Railpack auto-detection | Railpack handles Node.js, npm workspaces, caching, standalone mode automatically |
| Source map upload | Manual upload script | `@sentry/nextjs` `withSentryConfig` | Handles upload during build, deletes source maps after upload |
| CSP nonce generation | Custom nonce generator | Next.js `proxy.ts` built-in nonce support | Only if nonces become needed later; for now, non-nonce CSP is sufficient |
| Webhook creation | Manual API calls | Helius Dashboard or helius-sdk | Dashboard provides UI for webhook management; SDK for programmatic |
| Connection pooling | PgBouncer sidecar | postgres.js built-in pooling | postgres.js already pools connections (max: 10 in current config) |

**Key insight:** Railway + Railpack eliminates most DevOps work. The biggest risks are in the integration points: CSP domain whitelist completeness, Sentry + existing instrumentation-client.ts coexistence, and Drizzle migration reliability.

## Common Pitfalls

### Pitfall 1: Monorepo Build Context
**What goes wrong:** Railway builds from repo root but the Next.js app is in `app/`. If Root Directory isn't set, Railpack may not find `package.json` or may try to build the wrong package.
**Why it happens:** npm workspaces monorepo with two packages (`shared`, `app`).
**How to avoid:** Set Root Directory to `app/` in Railway service settings. Railpack auto-detects `workspaces` in root `package.json` and installs all workspace dependencies. The `railway.toml` goes at the REPO ROOT (not inside `app/`).
**Warning signs:** "Could not find a production build in the '.next' directory" error.

### Pitfall 2: drizzle-kit in devDependencies
**What goes wrong:** `preDeployCommand` runs `npx drizzle-kit migrate` but drizzle-kit was pruned from the production image.
**Why it happens:** `drizzle-kit` is in `devDependencies` and `RAILPACK_PRUNE_DEPS` removes dev deps.
**How to avoid:** Use programmatic migration via `drizzle-orm/postgres-js/migrator` `migrate()` function (drizzle-orm is in `dependencies`). Or move `drizzle-kit` to `dependencies`.
**Warning signs:** "drizzle-kit: command not found" in deploy logs.

### Pitfall 3: CSP Blocking Privy/WalletConnect
**What goes wrong:** Privy login modal fails to load, WalletConnect QR doesn't appear, or RPC calls fail silently.
**Why it happens:** CSP `connect-src`, `frame-src`, or `child-src` missing required domains.
**How to avoid:** Use the complete Privy CSP domain list from their docs (see Code Examples below). Test every login method and wallet connection flow after deploying.
**Warning signs:** Browser console shows "Refused to connect to..." or "Refused to frame..." CSP violation errors.

### Pitfall 4: Sentry + Existing instrumentation-client.ts
**What goes wrong:** Sentry client init overwrites the Buffer polyfill, breaking Solana transaction signing.
**Why it happens:** Sentry docs say to create `instrumentation-client.ts` with `Sentry.init()`, but the project already has this file with critical Buffer polyfills.
**How to avoid:** APPEND Sentry init to the existing `instrumentation-client.ts`. Buffer polyfills must run FIRST, then Sentry.init().
**Warning signs:** `Buffer.writeBigUInt64LE is not a function` errors after adding Sentry.

### Pitfall 5: Railway Health Check Timeout
**What goes wrong:** First deployment fails health check because the database isn't ready or migrations are still running.
**Why it happens:** Default health check timeout is 300 seconds, but if migrations are slow or Postgres is cold-starting, the app may not be ready.
**How to avoid:** Set `healthcheckTimeout = 120` in railway.toml. Ensure the health endpoint degrades gracefully (returns 503 with details, not 500 with stack trace). The `preDeployCommand` must complete before health check starts.
**Warning signs:** "Healthcheck failed" in Railway deploy logs.

### Pitfall 6: HELIUS_WEBHOOK_SECRET Must Be Required in Production
**What goes wrong:** The current webhook handler skips auth when `HELIUS_WEBHOOK_SECRET` is unset. On Railway, if the env var is forgotten, the webhook is open to the internet.
**Why it happens:** The auth check was made optional for local dev convenience.
**How to avoid:** Either require the secret always (fail startup if unset) or at minimum, set it in Railway env vars and verify it's present via the health check.
**Warning signs:** No auth header check in production = anyone can POST fake swap data.

### Pitfall 7: SSE Streams + Railway Proxy Timeout
**What goes wrong:** SSE connections drop after 60 seconds because Railway's proxy times out idle connections.
**Why it happens:** Railway uses nginx-based proxy with idle timeout.
**How to avoid:** The existing SSE endpoint already has 15-second heartbeats and `X-Accel-Buffering: no` header. This should work. Verify after deployment.
**Warning signs:** SSE "connected" event fires but no candle updates arrive; client keeps reconnecting.

### Pitfall 8: Environment Variables Not Available at Build Time
**What goes wrong:** `NEXT_PUBLIC_*` variables are embedded at build time. If they're only set as Railway runtime variables, the built app won't have them.
**Why it happens:** Next.js inlines `NEXT_PUBLIC_*` values during `next build`.
**How to avoid:** All `NEXT_PUBLIC_*` variables must be set in Railway BEFORE building. Non-public variables (DATABASE_URL, HELIUS_WEBHOOK_SECRET, SENTRY_DSN) are fine as runtime-only.
**Warning signs:** Privy App ID is undefined, RPC URL falls back to hardcoded devnet URL.

## Code Examples

### Railway Environment Variables Checklist
```
# Public (embedded at build time - MUST be set before build)
NEXT_PUBLIC_RPC_URL=https://devnet.helius-rpc.com/?api-key=<key>
NEXT_PUBLIC_PRIVY_APP_ID=<privy-app-id>

# Server-only (runtime - set in Railway env vars)
DATABASE_URL=${{Postgres.DATABASE_URL}}    # Railway variable reference
HELIUS_WEBHOOK_SECRET=<random-secret>
HELIUS_API_KEY=<helius-api-key>

# Sentry (build + runtime)
NEXT_PUBLIC_SENTRY_DSN=<public-dsn>
SENTRY_DSN=<full-dsn>
SENTRY_AUTH_TOKEN=<auth-token>
SENTRY_ORG=<org-slug>
SENTRY_PROJECT=<project-slug>

# Railway auto-injects
PORT=<auto>
DATABASE_URL=<auto-from-postgres-plugin>
```

### Complete Privy + DeFi CSP Domain List
```typescript
// Source: https://docs.privy.io/security/implementation-guide/content-security-policy
// + project-specific domains (Helius RPC, Solana explorers)
const CSP_DOMAINS = {
  'script-src': [
    "'self'",
    "'unsafe-inline'",  // Required for Next.js inline scripts without nonces
    "https://challenges.cloudflare.com",
  ],
  'style-src': [
    "'self'",
    "'unsafe-inline'",  // Tailwind generates inline styles
  ],
  'img-src': [
    "'self'",
    "data:",
    "blob:",
  ],
  'font-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
  'child-src': [
    "https://auth.privy.io",
    "https://verify.walletconnect.com",
    "https://verify.walletconnect.org",
  ],
  'frame-src': [
    "https://auth.privy.io",
    "https://verify.walletconnect.com",
    "https://verify.walletconnect.org",
    "https://challenges.cloudflare.com",
  ],
  'connect-src': [
    "'self'",
    // Privy
    "https://auth.privy.io",
    "https://*.rpc.privy.systems",
    // WalletConnect
    "wss://relay.walletconnect.com",
    "wss://relay.walletconnect.org",
    "wss://www.walletlink.org",
    "https://explorer-api.walletconnect.com",
    // Helius RPC (HTTP + WebSocket)
    "https://devnet.helius-rpc.com",
    "wss://devnet.helius-rpc.com",
    // Helius API (webhooks/indexer)
    "https://api.helius.xyz",
    "https://api-devnet.helius-rpc.com",
    // Sentry
    "https://*.ingest.sentry.io",
  ],
  'worker-src': ["'self'"],
  'manifest-src': ["'self'"],
};
```

### Sentry Integration with Existing instrumentation-client.ts
```typescript
// instrumentation-client.ts (MODIFIED -- append Sentry after Buffer polyfills)
// Source: https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

import { Buffer } from "buffer";

// ... existing Buffer polyfills stay exactly as-is ...
globalThis.Buffer = Buffer;

// ── Sentry Client Init ──────────────────────────────────────────────
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,  // 10% of transactions
  replaysSessionSampleRate: 0,  // No session replay (cost control)
  replaysOnErrorSampleRate: 1.0,  // 100% replay on errors
});
```

### Sentry Server Config
```typescript
// sentry.server.config.ts (NEW)
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.NODE_ENV,
});
```

### Sentry Instrumentation Hook
```typescript
// instrumentation.ts (NEW)
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
```

### Helius Webhook Creation (via API)
```bash
# Source: https://www.helius.dev/docs/api-reference/webhooks/create-webhook
curl -X POST "https://api-devnet.helius-rpc.com/v0/webhooks?api-key=<HELIUS_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "webhookURL": "https://<railway-subdomain>.up.railway.app/api/webhooks/helius",
    "transactionTypes": ["ANY"],
    "accountAddresses": ["<AMM_PROGRAM_ID>", "<TAX_PROGRAM_ID>", "<EPOCH_PROGRAM_ID>"],
    "webhookType": "rawDevnet",
    "authHeader": "<HELIUS_WEBHOOK_SECRET>",
    "txnStatus": "all"
  }'
```

### Programmatic Drizzle Migration Script
```typescript
// app/db/migrate.ts
// Called by: preDeployCommand = "npx tsx db/migrate.ts"
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function runMigrations() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  const client = postgres(url, { max: 1 });
  const db = drizzle(client);

  console.log("Running migrations...");
  await migrate(db, { migrationsFolder: "./db/migrations" });
  console.log("Migrations complete");
  await client.end();
}

runMigrations().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
```

### railway.toml
```toml
# railway.toml (REPO ROOT)
[build]
builder = "RAILPACK"

[deploy]
startCommand = "npm run start"
preDeployCommand = "npx tsx db/migrate.ts"
healthcheckPath = "/api/health"
healthcheckTimeout = 120
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Nixpacks builder | Railpack builder | 2025 | Railpack is default for new services; Nixpacks deprecated |
| `middleware.ts` | `proxy.ts` | Next.js 16 (2025) | middleware convention renamed to proxy; function name changes from `middleware()` to `proxy()` |
| Separate Sentry config per env | `instrumentation.ts` + `instrumentation-client.ts` | @sentry/nextjs 9.x | Matches Next.js 16 instrumentation hooks |
| `drizzle-kit migrate` CLI | Programmatic `migrate()` or CLI | Always available | CLI requires drizzle-kit at runtime; programmatic uses drizzle-orm only |
| Express-style middleware CSP | `next.config.ts` headers() or `proxy.ts` nonce-based | Next.js 14+ | Built-in Next.js patterns replace custom Express middleware |

**Deprecated/outdated:**
- **Nixpacks:** Deprecated, maintenance-mode. New Railway services default to Railpack.
- **`middleware.ts`:** Deprecated in Next.js 16, renamed to `proxy.ts`. Codemod available: `npx @next/codemod@canary middleware-to-proxy .`
- **`output: 'standalone'` manual config:** Railpack handles standalone output automatically for Next.js. Only configure manually if auto-detection fails.

## Open Questions

1. **tsx in preDeployCommand image**
   - What we know: `preDeployCommand` runs in the built container image. `tsx` is in root devDependencies, not `app/` dependencies.
   - What's unclear: Whether Railpack's built image includes `tsx` after build. The `prebuild` script uses `node scripts/sync-idl.mjs` (plain node), not tsx.
   - Recommendation: Either add `tsx` to `app/dependencies`, or compile `db/migrate.ts` to JS during build and run with `node`. Alternatively, use `npx drizzle-kit migrate` and move `drizzle-kit` to dependencies. Test during first Railway deploy attempt.

2. **Helius historical data backfill scope**
   - What we know: Helius offers `getTransactionsForAddress` for historical data. The CONTEXT.md says to "backfill historical swap data on first deploy."
   - What's unclear: How far back swap data exists on devnet. Devnet state may have been reset.
   - Recommendation: Build a `scripts/backfill.ts` that uses Helius `getTransactionsForAddress` on the AMM program ID, parses Anchor events (same logic as webhook handler), and populates swap_events + candle tables. Run manually after first deploy. If devnet has been reset, this may yield zero historical data (which is fine -- the webhook will capture new data going forward).

3. **Railway Postgres connection limits**
   - What we know: The existing code uses `max: 10` connections in postgres.js config. Railway Postgres default limits are not documented clearly.
   - What's unclear: Whether Railway's free/hobby tier has a connection limit.
   - Recommendation: Keep `max: 10` for now (conservative). Monitor connection count via Sentry or Railway metrics. Increase if needed.

4. **Sentry tunnelRoute for ad-blockers**
   - What we know: Sentry offers `tunnelRoute: "/monitoring"` to bypass ad-blockers.
   - What's unclear: Whether this is needed for a DeFi app (most users likely don't use ad-blockers that block Sentry).
   - Recommendation: Implement tunnelRoute as a defensive measure. It's a one-line config addition with zero downside.

5. **`proxy.ts` location in monorepo**
   - What we know: `proxy.ts` must be at the same level as the `app/` directory (i.e., `app/proxy.ts` since the Next.js root is `app/`). The project has no existing middleware.ts.
   - What's unclear: Whether `proxy.ts` is needed at all for non-nonce CSP. If using `next.config.ts` `headers()` for CSP, proxy.ts is not required for CSP specifically. But proxy.ts is the right place for Sentry's tunnelRoute exclusion and any future auth checks.
   - Recommendation: Use `next.config.ts` `headers()` for CSP (simpler, no dynamic rendering cost). Only create `proxy.ts` if needed for other purposes (like excluding Sentry tunnel from CSP). Can be deferred.

## Sources

### Primary (HIGH confidence)
- Next.js 16 Official Docs - CSP guide, proxy.ts convention, output standalone, deploying: https://nextjs.org/docs/app/guides/content-security-policy, https://nextjs.org/docs/app/api-reference/file-conventions/proxy, https://nextjs.org/docs/app/api-reference/config/next-config-js/output, https://nextjs.org/docs/app/getting-started/deploying
- Railway Official Docs - Config-as-code, monorepo, pre-deploy, health checks: https://docs.railway.com/reference/config-as-code, https://docs.railway.com/guides/monorepo, https://docs.railway.com/guides/pre-deploy-command, https://docs.railway.com/reference/healthchecks
- Railway Postgres Docs: https://docs.railway.com/databases/postgresql
- Privy CSP Docs: https://docs.privy.io/security/implementation-guide/content-security-policy
- Sentry Next.js Manual Setup: https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/
- Sentry Build Options: https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/build/
- Railpack Node.js Docs: https://railpack.com/languages/node/
- Helius Webhook API: https://www.helius.dev/docs/api-reference/webhooks/create-webhook
- Drizzle-kit migrate docs: https://orm.drizzle.team/docs/drizzle-kit-migrate

### Secondary (MEDIUM confidence)
- Drizzle programmatic migration pattern (community examples + official discussions): https://github.com/drizzle-team/drizzle-orm/discussions/1901
- Helius getTransactionsForAddress for backfill: https://www.helius.dev/docs/rpc/gettransactionsforaddress
- Railway blog on monorepo deployment: https://blog.railway.com/p/deploying-monorepos

### Tertiary (LOW confidence)
- Railway Postgres connection limits on free/hobby tier: not found in official docs, inferred from existing code comment ("Railway free tier has a 10-connection limit")
- Whether Railpack preserves tsx in built image: needs empirical testing

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries are official, well-documented, and already partially integrated
- Architecture: HIGH - Patterns verified against official Next.js 16 docs and Railway docs
- Pitfalls: HIGH - Each pitfall is grounded in verified documentation or existing codebase analysis
- Backfill strategy: MEDIUM - Helius API exists but devnet data availability is uncertain
- Railpack monorepo specifics: MEDIUM - Auto-detection documented but not tested with this exact project structure

**Research date:** 2026-02-18
**Valid until:** 2026-03-18 (30 days -- stable technologies, no rapid API changes expected)
