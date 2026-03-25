---
phase: 45-railway-deployment-polish
plan: 02
status: complete
started: 2026-02-18
completed: 2026-02-18
---

## Summary: CSP Headers + Sentry + Dependency Pinning

### What Was Built

Security hardening and error monitoring for the deployed Railway frontend:

1. **CSP headers** -- Content-Security-Policy on all responses with explicit domain whitelist: Privy, WalletConnect, Helius (HTTP + WSS), CoinGecko, Sentry ingest (US region)
2. **Security headers** -- X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy (camera/mic/geo disabled)
3. **Sentry error monitoring** -- Zero-dependency reporter via lib/sentry.ts that POSTs error envelopes directly to Sentry's ingest API using fetch()
4. **Global error boundary** -- global-error.tsx catches unhandled React errors and reports to Sentry
5. **Client error listeners** -- window error + unhandledrejection handlers in instrumentation-client.ts
6. **Dependency pinning** -- All versions in app/package.json use exact versions (no ^ or ~)
7. **Helius webhook** -- User created rawDevnet webhook pointing at Railway URL for swap event ingestion

### Sentry/Turbopack Compatibility Discovery

Major deployment issue: ALL `@sentry/*` npm packages are incompatible with Next.js Turbopack:

| Package | Failure Mode |
|---------|-------------|
| `@sentry/nextjs` | Monkey-patches webpack internals; SSR "React is not defined" crash |
| `@sentry/browser` | Gets bundled into server code via global-error.tsx SSR; browser globals unavailable |
| `@sentry/node` | Build succeeds but runtime SSR crashes on page routes |

All three cause HTTP 500 on every page route while API routes (no React SSR) work fine.

**Solution**: Zero-dependency `lib/sentry.ts` that constructs Sentry envelope format and POSTs via `fetch()`. No npm packages, no module-level browser references, no webpack patching. Works in both browser and Node.js.

### Commits

- (Plan 02 executor) -- feat(45-02): CSP headers, Sentry @sentry/nextjs, dependency pinning
- b7ceda6 -- fix(45-02): disable Sentry auto-instrumentation for Turbopack SSR compat
- a3bd91c -- fix(45-02): remove tunnel route, fix CSP for Sentry US ingest
- 3ff90ed -- fix(45-02): remove withSentryConfig webpack wrapper for Turbopack compat
- fea63ff -- test(45-02): strip @sentry/nextjs imports to diagnose SSR 500
- e2deafb -- fix(45-02): replace @sentry/nextjs with @sentry/browser + @sentry/node
- bd494f5 -- fix(45-02): zero-dependency Sentry reporter for Turbopack compat

### Verification

- CSP headers visible in browser Network tab on all responses
- No CSP violations during normal app usage (dashboard, swap, wallet connect)
- Sentry test error (`setTimeout(() => { throw new Error("test") }, 0)`) appears in Sentry dashboard
- All pages load without 500 errors (/, /swap)
- Health check at /api/health returns ok
- All dependency versions pinned (no ^ or ~ in package.json)
- npm audit: 3 high from bigint-buffer (Solana ecosystem transitive dep, not exploitable)

### Deviations

- **Zero-dep Sentry instead of @sentry/nextjs**: Plan specified @sentry/nextjs but it's fundamentally incompatible with Turbopack. @sentry/browser and @sentry/node also failed. Built custom lib/sentry.ts using fetch() to Sentry envelope API instead.
- **No server-side Sentry**: instrumentation.ts is a no-op. Server errors surface through Railway logging. The fetch-based reporter could be added server-side later but wasn't needed for launch.
- **sentry.server.config.ts and sentry.edge.config.ts deleted**: Consolidated into instrumentation.ts (which is now a no-op).
- **CSP includes *.ingest.us.sentry.io**: Added US-region wildcard because DSN uses two subdomain levels (*.ingest.sentry.io only matches one level).
