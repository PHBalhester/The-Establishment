# Phase 34: Devnet Deployment - Context

**Gathered:** 2026-02-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Deploy all 5 programs (AMM, Transfer Hook, Tax, Epoch, Staking) to Solana devnet and initialize full protocol state using the automated scripts built in Phase 33. No new program code is written -- this phase runs the deployment pipeline against a live cluster.

</domain>

<decisions>
## Implementation Decisions

### Pool Liquidity & Pricing
- Use **exact mainnet token amounts** for all pools (Option A)
- SOL pools: 290M tokens / 25 SOL each (micro-cap pricing, ~0.0000000862 SOL/token)
- PROFIT pools: 250M CRIME or FRAUD / 25M PROFIT each (exact mainnet ratios)
- Dead stake: 1 PROFIT (same as mainnet, prevents first-depositor attack)
- Philosophy: mirror mainnet token distribution exactly, SOL is the only free variable

### RPC & Reliability
- Use **Helius free tier** devnet RPC endpoint (stored in `.env`, gitignored)
- `.env` file pattern for API key storage -- scripts read `HELIUS_API_KEY` from environment
- Commitment level: **finalized** (maximum certainty, even on devnet)
- Failure handling: Claude's discretion (build on Phase 33 idempotency)

### Authority & Upgradeability
- Programs **stay upgradeable** on devnet (essential for iteration in Phases 35-36)
- Devnet wallet `8kPzhQoUPx7LYM18f9TzskW4ZgvGyq4jMPYZikqmHMH4` is sole upgrade authority
- **Do NOT burn** mint/hook/whitelist authorities during Phases 34-35
- **Burn authorities before Phase 36** E2E testing to mirror production locked-down state
- Redeploy strategy: Claude's discretion (same program IDs preferred for PDA consistency)

### Deployment Reporting
- Generate a **full Markdown deployment report** at `Docs/Devnet_Deployment_Report.md`
- Include **Solana Explorer links** (devnet) for all programs and key accounts
- Report written **manually** after deployment verification passes (not auto-generated)
- Report should include: program IDs, all PDAs, pool addresses, mint addresses, tx signatures

### Claude's Discretion
- Transaction retry/backoff strategy (building on Phase 33 idempotency)
- Redeploy approach if full reset needed (same IDs vs new)
- Exact `.env` file structure and loading pattern
- Order of verification checks after deployment

</decisions>

<specifics>
## Specific Ideas

- Token distribution mirrors mainnet exactly -- only SOL amounts differ (25 vs 1,000 per pool)
- Helius RPC endpoint: `https://devnet.helius-rpc.com/?api-key=<KEY>` (key in .env)
- Devnet wallet keypair at `keypairs/devnet-wallet.json`
- Phase 33 scripts are the deployment mechanism -- this phase runs them, doesn't rebuild them

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 34-devnet-deployment*
*Context gathered: 2026-02-11*
