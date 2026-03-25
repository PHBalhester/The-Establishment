# Crank RPC Billing Audit

**Date:** 2026-03-20
**Context:** DBS Phase 7 — Validation, Cleanup + Crank Audit

## Finding

The crank runner (`scripts/crank/crank-runner.ts`) and the frontend app share the same Helius billing account.

### How it works

- **Crank** uses `CLUSTER_URL` env var on Railway, set to a Helius RPC endpoint
- **Frontend** uses `NEXT_PUBLIC_RPC_URL` (browser-side) and `getConnection()` (server-side), both pointing to the same Helius API key
- **ws-subscriber** uses `getConnection()` from `app/lib/connection.ts`, which reads the same Helius endpoint
- **All three** share the same 50 RPS / 10M credit pool on the Helius Developer plan ($49/mo)

### Credit impact

| Component | Calls/min | Calls/month | % of 10M credits |
|-----------|-----------|-------------|-------------------|
| Crank runner | ~1.3 | ~57,600 | **0.6%** |
| ws-subscriber (slot poll) | ~12 | ~518,400 | ~5.2% |
| ws-subscriber (supply poll) | ~2 | ~86,400 | ~0.9% |
| ws-subscriber (staker gPA) | ~2 | ~86,400 | ~0.9% |
| Browser RPC (per-user balance) | 2/user/min | Varies | ~0.02%/user |
| Helius webhooks | N/A | N/A | Separate (not RPC) |

**Crank is negligible** — 0.6% of the monthly budget.

## Recommendation

**No action needed now.** The crank's RPC usage is trivially small.

### Future optimization (if frontend scales significantly)

If frontend traffic grows to the point where the 50 RPS limit becomes a concern:

1. **Create a separate free-tier Helius account** for the crank. Free tier supports ~10 RPS, which is more than enough for the crank's ~1.3 calls/min.
2. Set crank's `CLUSTER_URL` to the new free-tier endpoint on Railway.
3. This isolates the crank from frontend RPC budget entirely.

### Mainnet consideration

Before mainnet launch, verify:
- [ ] Whether `CLUSTER_URL` on the mainnet Railway service points to the same Helius plan as the frontend
- [ ] If using a dedicated mainnet Helius plan, whether the crank should have its own key
- [ ] Crank call volume may increase on mainnet (shorter epoch slots = more frequent checks)
