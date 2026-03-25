# Phase 45: Railway Deployment + Polish - Context

**Gathered:** 2026-02-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Deploy the complete frontend application to Railway with Postgres, configure Helius webhooks to the live endpoint, implement strict security headers, set up error monitoring, and add a health check endpoint. This is the final phase of v0.8 -- everything built in Phases 39-44 goes live on a public URL.

</domain>

<decisions>
## Implementation Decisions

### Deployment setup
- Railway subdomain (*.up.railway.app) for now -- custom domain deferred to later
- Manual deploys (no auto-deploy on push to main) -- user triggers deploys from Railway dashboard
- Single environment (no staging/production split) -- Claude's discretion based on devnet stage
- Railway account already exists -- no account setup needed in this phase

### Database & webhooks
- Postgres provider: Claude's discretion (Railway built-in plugin is simplest, same-network latency)
- Drizzle migrations run automatically on deploy -- pre-start script runs migrations before app boots
- Create a NEW Helius webhook for the Railway endpoint -- existing webhook stays for local dev
- Backfill historical swap data on first deploy -- fetch from Helius and populate candles so charts have data on day one

### Security hardening
- CSP: Strict + explicit whitelist -- enumerate every allowed domain (Privy CDN, Helius RPC, CoinGecko API, etc.), block everything else
- Dependency audit: High/critical zero tolerance + pinned versions -- `npm audit --audit-level=high` must pass, low/moderate reviewed periodically, all versions pinned (no ^ or ~), package-lock.json committed
- Webhook auth: Require HELIUS_WEBHOOK_SECRET in request header -- reject unauthorized callers before parsing

### Health & monitoring
- Health check depth: Claude's discretion (DB + RPC at minimum, webhook freshness check is a good addition)
- Error monitoring: Sentry free tier via @sentry/nextjs -- error alerts, stack traces, breadcrumbs
- Error pages: Next.js defaults for this milestone

### Claude's Discretion
- Railway project structure (single service vs multi-service)
- Nixpacks vs Dockerfile build strategy
- Postgres provider (Railway plugin recommended)
- Health check exact scope beyond DB + RPC
- Environment variable organization
- Staging/production split (single environment recommended for devnet stage)

</decisions>

<specifics>
## Specific Ideas

- "We are building for mainnet" -- security decisions should not be half-assed for devnet convenience; do it right now
- Error pages should use Next.js defaults for this milestone, but NOTE for future: custom branded 404/500 pages needed when full site graphics/assets are built
- Sentry chosen specifically for DeFi operational awareness -- webhook failures, stale chart data, failed swaps should trigger alerts before users notice
- PROFIT-to-SOL multi-hop routing idea noted as deferred (see below)

</specifics>

<deferred>
## Deferred Ideas

- **PROFIT-to-SOL direct routing**: Allow users to sell PROFIT directly to SOL (and vice versa) by routing through intermediate pools for best price. This is a multi-hop routing engine -- its own phase.
- **Custom branded error pages**: Styled 404/500 pages matching app design -- defer to site design/branding phase.
- **Custom domain**: Point a proper domain at Railway -- defer to when domain is purchased.
- **Staging environment**: Separate staging Railway environment -- revisit for mainnet deployment.

</deferred>

---

*Phase: 45-railway-deployment-polish*
*Context gathered: 2026-02-17*
