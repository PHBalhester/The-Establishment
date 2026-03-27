---
topic: "Operations"
topic_slug: "operations"
status: complete
interview_date: 2026-02-20
decisions_count: 7
provides: ["operations-decisions"]
requires: ["architecture-decisions", "security-decisions", "frontend-decisions"]
verification_items: ["mainnet-priority-fee-vs-bounty-economics"]
---

# Operations — Decisions

## Summary
The protocol runs on Railway (frontend + crank bot in one instance), monitored by Sentry (error tracking + Crons heartbeat), with Helius as the single RPC provider across all environments. Current frontend polling is heavily over-engineered — a 91% credit reduction is planned via interval tuning, webhook migration, and network-aware config. Infrastructure costs stay under $10/month through launch, scaling to ~$75/month at 1,000 DAU.

## Decisions

### D1: Crank Bot Hosting — Railway Single Instance
**Choice:** The crank bot runs as a background worker process on the same Railway instance as the Next.js frontend. Single instance, no redundancy.
**Rationale:** Cranking is permissionless and idempotent — if the bot dies, anyone can crank. Railway's built-in container restart (automatic on crash) provides sufficient supervision. No need for PM2 or systemd — the overnight runner already has per-epoch try/catch with graceful shutdown (SIGINT/SIGTERM). Single instance avoids duplicate SOL spend.
**Alternatives considered:** Separate VPS (unnecessary ops overhead), PM2 inside container (extra dependency for marginal benefit), redundant instances (wastes SOL on duplicate cranking).
**Affects docs:** [operational-runbook, deployment-sequence]

### D2: Monitoring — Sentry Errors + Crons Heartbeat
**Choice:** Two-layer monitoring using the existing zero-dependency Sentry integration:
1. **Error tracking:** Crank bot POSTs exception envelopes to Sentry on crash/error (same pattern as frontend `lib/sentry.ts`). Provides stack traces, context, diagnostics.
2. **Uptime heartbeat:** Sentry Crons monitor — bot sends a check-in every epoch. If Sentry doesn't hear from the bot within the expected window, it alerts (email). This catches the "dead process can't report its own death" gap.

Both use raw HTTP POST to Sentry ingest API — no `@sentry/*` npm packages (Turbopack incompatibility, see frontend decisions).
**Rationale:** Sentry free tier (5K errors/month) is sufficient. Crons heartbeat fills the gap that error tracking can't cover. No additional monitoring infra needed.
**Alternatives considered:** Discord webhook heartbeat (simpler but no error context), UptimeRobot pinging a health endpoint (requires exposing an endpoint), Datadog/Grafana (overkill for single-instance).
**Affects docs:** [operational-runbook, oracle-failure-playbook]

### D3: Mainnet SOL Funding — Manual Seed + Bounty Sustaining
**Choice:** Fund the crank bot wallet with 1 SOL manually at launch. The 0.001 SOL bounty per epoch transition is expected to sustain ongoing gas costs. Monitor balance manually.
**Rationale:** Base transaction fees (~0.000005 SOL × 4 TXs/epoch = 0.00002 SOL) are well under the 0.001 SOL bounty. However, mainnet priority fees could push per-TX costs to 0.0001-0.0005 SOL, potentially exceeding the bounty at peak congestion. This needs validation.
**Alternatives considered:** Auto-refill from a treasury (no treasury mechanism exists post-burn), larger initial seed (unnecessary if bounties sustain).
**Affects docs:** [operational-runbook, token-economics-model]
**NEEDS_VERIFICATION:** Mainnet priority fee costs vs 0.001 SOL bounty — if priority fees consistently exceed bounty, the bounty constant may need adjustment before authority burn.

### D4: RPC Provider — Single Helius Plan
**Choice:** Use a single Helius account for all RPC traffic: crank bot, frontend backend proxy, and development. No provider splitting.
**Rationale:** Helius free tier (1M credits/month, 10 req/s) is sufficient through ~600 DAU after RPC optimizations are applied. Helius provides Solana-native features needed by the protocol: DAS API, webhooks (already used for swap events), priority fee estimation, WebSocket subscriptions. Single provider simplifies ops and billing.
**Alternatives considered:** Split crank/frontend across providers (unnecessary complexity), QuickNode (comparable pricing but less Solana-native tooling), Alchemy (weaker Solana support).
**Affects docs:** [operational-runbook, deployment-sequence, frontend-spec]

### D5: Infrastructure Cost Model
**Choice:** Projected monthly costs by user milestone:

| Milestone | RPC (Helius) | Hosting (Railway) | Other | Total |
|-----------|-------------|-------------------|-------|-------|
| Launch (10 DAU) | $0 (free) | $7 | $1 | ~$8/mo |
| Growing (100 DAU) | $0 (free) | $10 | $1 | ~$11/mo |
| Traction (1,000 DAU) | $49 (Developer) | $25 | $1 | ~$75/mo |
| Success (10,000 DAU) | $499 (Business) | $50 | $3 | ~$550/mo |

Upgrade triggers: ~600 DAU → Helius Developer ($49), ~500 DAU → Railway Pro ($20), ~5K errors/mo → Sentry Team ($26).
**Rationale:** Research verified against Helius pricing page, Railway pricing docs, and Sentry plans (Feb 2026). Full analysis in `Docs/Infrastructure_Cost_Analysis_2026.md`.
**Alternatives considered:** N/A — this is a projection, not a design choice.
**Affects docs:** [operational-runbook, mainnet-readiness-assessment]

### D6: RPC Polling Optimization — 91% Credit Reduction
**Choice:** Six specific fixes to reduce RPC credit consumption from ~75K/day to ~6.5K/day:

**Fix 1: Replace `useCarnageEvents` with Helius webhook**
- Current: Polls `getSignaturesForAddress` (10 credits) + 20× `getParsedTransaction` (1 credit each) every 60s = 43,200 credits/day
- Proposed: Helius webhook pushes CarnageExecuted events to DB, frontend reads from DB
- Savings: 43,200 → 0 credits/day (58% of total burn eliminated)

**Fix 2: `useCurrentSlot` interval 10s → network-aware**
- Current: 8,640 credits/day
- Proposed: Devnet 120s, Mainnet 300s
- Savings: 8,640 → 720 (devnet) / 288 (mainnet) credits/day

**Fix 3: `useEpochState` interval 10s → network-aware**
- Current: 8,640 credits/day
- Proposed: Devnet 60s, Mainnet 300s
- Savings: 8,640 → 1,440 (devnet) / 288 (mainnet) credits/day

**Fix 4: `useCarnageData` interval 10s → network-aware**
- Current: 8,640 credits/day
- Proposed: Devnet 60s, Mainnet 300s
- Savings: 8,640 → 1,440 (devnet) / 288 (mainnet) credits/day

**Fix 5: `useTokenBalances` interval 30s → network-aware + event-triggered refresh**
- Current: 5,760 credits/day
- Proposed: Devnet 60s, Mainnet 120s. Force-refresh on swap/stake TX confirmation.
- Savings: 5,760 → 2,880 (devnet) / 1,440 (mainnet) credits/day

**Fix 6: Dev-mode RPC guard**
- Detect `NODE_ENV === 'development'` and either double all intervals or disable non-essential hooks
- Eliminates hot-reload amplification (~33 RPC calls per file save during development)

**Implementation:** Single `POLLING_CONFIG` object keyed by network (devnet/mainnet), imported by all hooks. One source of truth.

```
POLLING_CONFIG[network] = {
  currentSlot:   devnet ? 120_000 : 300_000,
  epochState:    devnet ? 60_000  : 300_000,
  carnageData:   devnet ? 60_000  : 300_000,
  tokenBalances: devnet ? 60_000  : 120_000,
}
```

**After-fix projections:**

| Network | Credits/day | Credits/month | Helius Plan |
|---------|------------|---------------|-------------|
| Devnet (dev) | ~6,480 | ~194K | Free |
| Mainnet (no users) | ~2,300 | ~69K | Free |
| Mainnet (1,000 DAU) | ~1.4M | ~1.4M | Developer ($49) |

**Rationale:** Audit of Helius dashboard (Feb 2026) showed ~1M credits consumed in one week of frontend development. Root causes: aggressive polling intervals (10-30s for data that changes every 5-30min), `useCarnageEvents` making 30 credits/poll of archival queries, and hot-reload amplification (~33 RPC calls per file save). Helius credit costs verified: standard RPC = 1 credit, `getSignaturesForAddress` = 10 credits (historical/archival).
**Alternatives considered:** Switching to a cheaper provider (wrong solution — the code is inefficient, not the provider), rate-limiting at the connection level (masks the problem).
**Affects docs:** [operational-runbook, frontend-spec, mainnet-readiness-assessment]

### D7: Deployment Process — Mainnet
**Choice:** Deferred to deployment-sequence topic (already covered in existing `Docs/Deployment_Sequence.md` + `Docs/mainnet-checklist.md`). Operations decisions here focus on post-deployment runtime.
**Rationale:** Deployment is a one-time sequence; operations covers ongoing runtime. The deployment-sequence GL doc will consolidate existing docs + authority burn sequence from security decisions.
**Affects docs:** [deployment-sequence]

## Open Questions
- [ ] Mainnet priority fee economics vs 0.001 SOL crank bounty — needs validation under real congestion conditions. If fees consistently exceed bounty, adjust `CRANK_BOUNTY_LAMPORTS` before upgrade authority burn. — confidence: medium, source: interview

## Raw Notes
- Helius credit system: all standard RPC methods = 1 credit, historical queries (getSignaturesForAddress) = 10 credits, enhanced API queries = variable. WebSocket subscriptions = 1 credit per creation.
- Railway Hobby plan: $5/mo base + usage-based CPU/RAM/storage. Per-second billing means idle processes cost very little.
- The continuous runner (overnight-runner.ts) on devnet uses ~5,000-10,000 credits/day when active — contributes to the observed burn but is not the primary culprit.
- `usePoolPrices` uses WebSocket subscriptions (onAccountChange) — this is efficient and should NOT be changed to polling. WebSockets are the right choice for price data.
- `useSolPrice` polls Jupiter Price API (not Helius) — zero Helius credit impact. Implementation via `lib/jupiter.ts`.
- Cost optimization for later: batch `getAccountInfo` into `getMultipleAccounts` (reduces credits when fetching multiple accounts), implement stale-while-revalidate caching.
