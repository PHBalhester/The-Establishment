# Phase 102: Full Devnet Lifecycle Redeploy and Bonding Curve Graduation Test - Research

**Researched:** 2026-03-20
**Domain:** Solana devnet deployment lifecycle, bonding curve graduation, multi-person testing, Railway frontend orchestration
**Confidence:** HIGH

## Summary

Phase 102 is a full dress rehearsal of the mainnet launch sequence: clean-room devnet redeploy (Stages 0-6, skipping Stage 7 governance), bonding curve buy/sell with a remote second tester, curve fill + graduation, Railway site mode switching, and light post-graduation E2E testing. Every tool needed already exists and has been battle-tested across Phases 95, 96, 98, and 100.

The primary work is **operational orchestration** -- running existing scripts in the right order with the right env vars, coordinating with a remote tester, and managing Railway env var updates at two critical points (Stage 4 initial deploy and Stage 6 post-graduation). There is no new code to write. The fill script (`scripts/test/pathway2-fill.ts`), graduation orchestrator (`scripts/graduation/graduate.ts`), stage scripts (`scripts/deploy/stage-{0..6}-*.sh`), and verification (`scripts/deploy/verify.ts`) all exist and are proven.

The key risk is **devnet state contamination** -- specifically, ensuring the new devnet deployment addresses flow through to Railway (env vars + constants.ts) without touching mainnet.json or mainnet Railway env vars. The cluster-aware architecture (protocol-config.ts + NEXT_PUBLIC_CLUSTER) already prevents cross-cluster contamination, but the Railway env var update is a manual step that requires a comprehensive checklist.

**Primary recommendation:** Structure as 5-6 sequential plans following the Stage 0-6 progression, with explicit Railway env var checklists embedded, a deliberate pause between Stage 4 and Stage 5 to validate the pre-launch state, and multi-person testing woven into Stage 5 (manual UX) and Stage 6 (post-graduation E2E).

## Standard Stack

### Core (All Existing -- Zero New Dependencies)

| Tool | Path | Purpose | Proven In |
|------|------|---------|-----------|
| `deploy-all.sh` | `scripts/deploy/deploy-all.sh` | Stages 0-4 pipeline | Phase 95, 98, 100 |
| `stage-5-launch.sh` | `scripts/deploy/stage-5-launch.sh` | Deploy BC, whitelist, init curves | Phase 95 |
| `stage-6-graduation.sh` | `scripts/deploy/stage-6-graduation.sh` | Run graduate.ts, verify, crank/frontend instructions | Phase 95 |
| `graduate.ts` | `scripts/graduation/graduate.ts` | 13-step graduation with checkpoint/resume | Phase 95 |
| `pathway2-fill.ts` | `scripts/test/pathway2-fill.ts` | 50-wallet curve fill with organic traffic | Phase 95 |
| `verify.ts` | `scripts/deploy/verify.ts` | 36-check deep verification | Phase 95, 96 |
| `generate-constants.ts` | `scripts/deploy/generate-constants.ts` | Write shared/constants.ts from deployment.json | Phase 91+ |
| `create-alt.ts` | `scripts/deploy/create-alt.ts` | Address Lookup Table creation | Phase 95, 100 |
| `initialize.ts` | `scripts/deploy/initialize.ts` | 23-step idempotent init (mints, PDAs, whitelist, curves) | Phase 95, 100 |
| `build.sh` | `scripts/deploy/build.sh` | Compile all 7 programs with optional --devnet flag | Phase 95, 100 |
| `crank-runner.ts` | `scripts/crank/crank-runner.ts` | Epoch advancement with /health endpoint | Phase 96 |
| `smoke-test.ts` | `scripts/e2e/smoke-test.ts` | Quick E2E validation after deploy | Phase 96 |

### Supporting

| Tool | Path | Purpose | When to Use |
|------|------|---------|-------------|
| `devnet-e2e-validation.ts` | `scripts/e2e/devnet-e2e-validation.ts` | Extended E2E (8 swap pairs, tax, staking) | Post-graduation E2E |
| `middleware.ts` | `app/middleware.ts` | NEXT_PUBLIC_SITE_MODE toggle (launch/live) | Railway env var |
| `protocol-config.ts` | `app/lib/protocol-config.ts` | Cluster-aware address resolution | Automatic via NEXT_PUBLIC_CLUSTER |
| `deployment.json` | `deployments/devnet.json` | Canonical address registry (regenerated) | Written by initialize.ts |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| pathway2-fill.ts | Manual frontend buys only | Too slow for 50 wallets; fill script completes in 2-3 min vs hours manually |
| Local crank | Railway crank | Either works; local is simpler for devnet testing but Railway validates prod deployment path |
| Full Phase 96 E2E | Light E2E subset | Phase 96 took 4 plans over 2 days; Phase 102 CONTEXT says "light E2E" which means select key paths, not exhaustive |

### No Installation Needed

All dependencies are already in `package.json`. No new npm packages required.

## Architecture Patterns

### Existing Pipeline Flow (Proven)

```
deploy-all.sh devnet (Stages 0-4)
  Stage 0: Preflight        -- toolchain, env, balance, keypair safety
  Stage 1: Build            -- compile 7 programs with --devnet
  Stage 2: Deploy 6 Core    -- AMM, Hook, Tax, Epoch, Staking, Vault
  Stage 3: Initialize       -- mints, PDAs, whitelist entries, BcAdminConfig
  Stage 4: Infrastructure   -- ALT, generate-constants, IDL sync

[PAUSE -- Simulate pre-launch wait, update Railway env vars]

stage-5-launch.sh devnet (Stage 5)
  Step 1: Deploy bonding curve program (anti-sniper delayed deploy)
  Step 2: Run initialize.ts (picks up from step 20+: whitelist curve vaults, init curves)
  Step 3: Verify curves initialized

[MULTI-PERSON MANUAL TESTING -- Both users buy/sell on curves via frontend]

pathway2-fill.ts (Fill both curves)

stage-6-graduation.sh devnet (Stage 6)
  Step 1: Run graduate.ts (13 steps: transition, withdraw, pools, whitelist, vault, escrow)
  Step 2: Crank setup instructions
  Step 3: Frontend mode switch instructions

[POST-GRADUATION E2E -- Both users test swaps, staking, core features]
```

### Deployment Address Flow

```
keypairs/*.json  ──>  build.sh (sync-program-ids)  ──>  anchor build
                                                          │
scripts/deploy/mint-keypairs/*.json  ──>  initialize.ts  ──>  deployments/devnet.json
                                                                    │
                              generate-constants.ts  <──────────────┘
                                     │
                              shared/constants.ts  ──>  protocol-config.ts
                                                             │
                                                   NEXT_PUBLIC_CLUSTER=devnet
                                                             │
                                                      Frontend addresses
```

### Railway Env Var Update Points

**Stage 4 (Initial Deploy):** After ALT and constants are generated, Railway devnet service needs:
- All program IDs (7 programs)
- Mint addresses (CRIME, FRAUD, PROFIT)
- NEXT_PUBLIC_CLUSTER=devnet
- NEXT_PUBLIC_SITE_MODE=launch
- CLUSTER_URL (devnet Helius RPC)
- HELIUS_API_KEY
- Any SSE/DBS env vars

**Stage 6 (Post-Graduation):** After pools are created:
- NEXT_PUBLIC_SITE_MODE=live (launch -> live transition)
- CARNAGE_WSOL_PUBKEY (from keypairs/carnage-wsol.json pubkey)
- Pool addresses (if crank reads them from env)

### Clean-Room Reset Checklist

Before running deploy-all.sh:
1. Delete old mint keypairs: `rm -f scripts/deploy/mint-keypairs/*.json`
2. Delete old graduation state: `rm -f scripts/graduation/graduation-state.json`
3. Delete old ALT address: `rm -f scripts/deploy/alt-address.json`
4. Stop Railway crank if running (manual via Railway dashboard)
5. Verify devnet wallet balance: need ~43 SOL (have ~80.82 SOL)
6. Ensure .env.devnet is sourced (not .env.mainnet)

### Anti-Patterns to Avoid

- **Reusing old graduation-state.json:** Will cause graduate.ts to skip already-completed steps from previous deployment. MUST delete before graduation.
- **Forgetting to delete mint keypairs:** Will reuse old mint addresses instead of generating fresh ones. Fresh keypairs = clean-room deploy.
- **Running generate-constants.ts mainnet:** Would overwrite shared/constants.ts with mainnet addresses. Always specify `devnet` as argument.
- **Touching mainnet Railway env vars:** Phase 102 MUST NOT affect the mainnet deployment state.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Multi-step graduation | Custom graduation logic | `graduate.ts` with checkpoint/resume | 13 interdependent steps with irreversible state transitions; checkpoint/resume handles partial failures |
| Curve filling | Manual buys via frontend | `pathway2-fill.ts` | 50 wallets, parallel waves, organic buy/sell mix; completes in 2-3 min vs hours |
| Address propagation | Manual copy-paste of addresses | `generate-constants.ts` | Reads deployment.json, writes constants.ts; eliminates address mismatch errors |
| On-chain verification | Manual account inspection | `verify.ts` | 36 automated checks; catches misconfigurations that manual inspection misses |
| Site mode toggle | Code deploy | Env var NEXT_PUBLIC_SITE_MODE | middleware.ts reads at request time; Railway env var change + redeploy = ~30 seconds |
| Cluster isolation | Manual address selection | `protocol-config.ts` + NEXT_PUBLIC_CLUSTER | Resolves addresses from CLUSTER_CONFIG automatically |

**Key insight:** This phase is 100% operational orchestration. Every tool exists and is proven. The value is in running them in the right order with the right configuration, not in building new things.

## Common Pitfalls

### Pitfall 1: Forgetting to Source .env.devnet Before initialize.ts

**What goes wrong:** Pool seed amounts default to test values (10 SOL / 10K tokens) instead of env-configured values. Pools cannot be re-seeded -- requires full redeploy.
**Why it happens:** Shell sessions don't persist env vars. New terminal = no env loaded.
**How to avoid:** Always `set -a && source .env.devnet && set +a` before any script. Stage scripts do this internally, but manual runs don't.
**Warning signs:** initialize.ts using default pool params, unexpectedly low pool liquidity.
**Severity:** CRITICAL -- cost ~50 SOL to fix in Phase 69.

### Pitfall 2: Stale graduation-state.json

**What goes wrong:** graduate.ts sees all 13 steps as "completed" and skips everything. Pools don't get created for the new deployment.
**Why it happens:** graduation-state.json persists from the previous deployment and checkpoint/resume logic treats it as resumable.
**How to avoid:** Delete `scripts/graduation/graduation-state.json` before running graduation on a fresh deployment.
**Warning signs:** graduate.ts completing instantly with "already completed" messages.

### Pitfall 3: Stale Mint Keypairs Preventing Clean-Room Deploy

**What goes wrong:** `scripts/deploy/mint-keypairs/*.json` from previous deploy are reused. Programs get rebuilt with old mint addresses baked in. New mints created with different addresses don't match feature-flagged programs.
**Why it happens:** deploy-all.sh Stage 0 skips generation if keypairs already exist (idempotent by design).
**How to avoid:** Explicitly delete mint keypairs before clean-room deploy: `rm -f scripts/deploy/mint-keypairs/*.json`
**Warning signs:** `InvalidMintPair (6002)` during vault initialization.

### Pitfall 4: CARNAGE_WSOL_PUBKEY Not Set on Railway

**What goes wrong:** Crank crashes immediately on Railway because it requires this env var (no fallback to keypair file on Railway).
**Why it happens:** CARNAGE_WSOL_PUBKEY is derived from `keypairs/carnage-wsol.json` which is created during initialization. Railway doesn't have access to the local keypairs directory.
**How to avoid:** After initialization, read the pubkey from `keypairs/carnage-wsol.json` and set it as a Railway env var.
**Warning signs:** Crank crash log: "CARNAGE_WSOL_PUBKEY env var not set."

### Pitfall 5: Railway Env Vars Not Updated After Fresh Deploy

**What goes wrong:** Frontend still shows old deployment's addresses or connects to wrong programs. User sees "Account not found" errors or empty states.
**Why it happens:** Railway env vars from the previous deployment are stale. generate-constants.ts updates shared/constants.ts locally, but Railway needs a manual env var update + redeploy.
**How to avoid:** Use a comprehensive Railway env var checklist at Stage 4 and Stage 6.
**Warning signs:** Frontend rendering old data, RPC queries for non-existent accounts.

### Pitfall 6: Whitelist Authority Burn Text in stage-6-graduation.sh Output

**What goes wrong:** Confusing output -- stage-6 prints "[x] Whitelist authority burned (IRREVERSIBLE)" but graduate.ts actually SKIPS the burn step (retained for Squads transfer).
**Why it happens:** stage-6-graduation.sh output text was written when graduation included the burn. The graduate.ts code was updated to skip it, but the shell script output was not.
**How to avoid:** Not a functional problem -- just confusing output. Can optionally fix the text.
**Warning signs:** Discrepancy between shell output and actual on-chain state.

### Pitfall 7: ALT Stale After Fresh Deploy

**What goes wrong:** Old ALT address in alt-address.json or devnet.json contains addresses from previous deployment. Frontend v0 transactions use wrong ALT and fail.
**Why it happens:** ALT is created per-deployment. Old ALT file not deleted before new deploy.
**How to avoid:** Delete `scripts/deploy/alt-address.json` before clean-room deploy. Stage 4 creates a fresh one.
**Warning signs:** "Transaction too large" or "Blockhash not found" errors on frontend swap.

### Pitfall 8: Devnet RPC Rate Limiting During Fill

**What goes wrong:** pathway2-fill.ts generates 50 wallets and fires parallel transaction waves. Helius devnet RPC may rate-limit, causing transactions to fail or time out.
**Why it happens:** Devnet RPC has tighter rate limits than mainnet.
**How to avoid:** Fill script already has WAVE_DELAY_MS_MIN/MAX (1-2s between waves). If rate-limited, reduce WAVE_SIZE from 5 to 3 or increase delay.
**Warning signs:** "429 Too Many Requests" or "Transaction simulation failed" during fill.

### Pitfall 9: Remote Tester Needs Devnet SOL

**What goes wrong:** Remote tester connects wallet but can't buy -- no devnet SOL in their wallet.
**Why it happens:** Devnet faucet rate-limits aggressively. Tester may not have used devnet before.
**How to avoid:** User (mlbob) sends 2-3 SOL from deployer wallet to tester's address. Budget: ~2-3 SOL from the ~38 SOL headroom.
**Warning signs:** Tester sees "Insufficient balance" when attempting to buy on curve.

### Pitfall 10: Two-Pass Deploy Race Condition (NOT applicable)

**What goes wrong:** Historically, feature-flagged programs (vault, tax, epoch, bonding_curve) needed a two-pass deploy because mint addresses weren't known until after init.
**Why it happens:** Programs compiled with placeholder mint addresses before mints were created.
**How to avoid:** NOT a problem anymore. build.sh Step 0 (sync-program-ids) and Stage 0 (mint keypair generation) happen BEFORE build, so mint addresses are available at compile time. Single-pass deploy is sufficient.
**Status:** Resolved since Phase 98-03.

## Code Examples

### Clean-Room Deploy Sequence

```bash
# Source: Phase 95 proven pattern + Phase 98 stage scripts

# Pre-cleanup (CRITICAL)
rm -f scripts/deploy/mint-keypairs/*.json
rm -f scripts/graduation/graduation-state.json
rm -f scripts/deploy/alt-address.json

# Run Stages 0-4
./scripts/deploy/deploy-all.sh devnet

# Outputs:
#   deployments/devnet.json (fresh addresses)
#   shared/constants.ts (regenerated)
#   scripts/deploy/alt-address.json (new ALT)
#   target/deploy/*.so (compiled binaries)
```

### Stage 5 Launch (After Railway Update)

```bash
# Source: stage-5-launch.sh
./scripts/deploy/stage-5-launch.sh devnet

# Deploys bonding curve program, whitelists curve vaults, initializes curves
# Curves are now LIVE for buying
```

### Fill Curves

```bash
# Source: Phase 95 pathway2-fill.ts
set -a && source .env.devnet && set +a
npx tsx scripts/test/pathway2-fill.ts

# 50 wallets, parallel waves, ~2-3 min to fill both curves
```

### Graduate

```bash
# Source: stage-6-graduation.sh
./scripts/deploy/stage-6-graduation.sh devnet

# Runs graduate.ts 13 steps:
#   verify filled -> transition -> withdraw SOL -> close vaults ->
#   create pools -> whitelist pool vaults -> seed conversion vault ->
#   distribute tax escrow -> skip whitelist burn
```

### Derive CARNAGE_WSOL_PUBKEY

```bash
# Source: initialize.ts creates keypairs/carnage-wsol.json
source "$HOME/.cargo/env"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
solana-keygen pubkey keypairs/carnage-wsol.json
# Output: <base58 pubkey to set on Railway>
```

### Railway Env Var Derivation from deployment.json

```bash
# Source: deployments/devnet.json after Stage 3
cat deployments/devnet.json | jq -r '
  "AMM_PROGRAM_ID=" + .programs.amm,
  "TRANSFER_HOOK_PROGRAM_ID=" + .programs.transferHook,
  "TAX_PROGRAM_ID=" + .programs.taxProgram,
  "EPOCH_PROGRAM_ID=" + .programs.epochProgram,
  "STAKING_PROGRAM_ID=" + .programs.staking,
  "CONVERSION_VAULT_PROGRAM_ID=" + .programs.conversionVault,
  "BONDING_CURVE_PROGRAM_ID=" + .programs.bondingCurve,
  "CRIME_MINT=" + .mints.crime,
  "FRAUD_MINT=" + .mints.fraud,
  "PROFIT_MINT=" + .mints.profit,
  "PROTOCOL_ALT=" + .alt
'
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual address copy-paste | generate-constants.ts from deployment.json | Phase 91 | Eliminates address mismatch errors |
| Two-pass deploy (build-deploy-init-rebuild-redeploy) | Single-pass with Stage 0 mint keypair generation | Phase 98-03 | Saves ~25 SOL and 15 minutes |
| Hardcoded SOL pool seeding | Dynamic balance-delta tracking in graduate.ts | Phase 94.1-03 | AMM starting price matches curve ending price |
| Whitelist authority burned at graduation | Retained, transferred to Squads at Stage 7 | Phase 97 | Future flexibility for new DEX integrations |
| pda-manifest.json | deployments/{cluster}.json | Phase 91 | Single source of truth for all addresses |

**Deprecated/outdated:**
- `pda-manifest.json`: Still exists for backward compatibility but all scripts should use `deployments/devnet.json`
- `SOL_POOL_SEED_SOL_OVERRIDE` env var: Removed from .env.devnet; graduate.ts uses dynamic balance-delta tracking
- Two-pass deploy pattern: No longer needed since build.sh sync-program-ids runs before compilation

## Devnet SOL Budget Analysis

| Item | Cost (SOL) | Notes |
|------|-----------|-------|
| 7 programs deploy | ~21.0 | 1.2x buffer rent per program |
| Initialize (mints, PDAs, whitelist) | ~4.5 | ATAs, whitelist entries, BcAdminConfig |
| ALT creation + extend | ~0.01 | 55 addresses |
| Bonding curve fill (both) | ~10.0 | ~5 SOL per curve (P_START=5, P_END=17) |
| Remote tester funding | ~2-3 | Transfer from deployer |
| Graduation TX fees | ~0.05 | 13 steps, minimal rent |
| Post-graduation swaps | ~0.5 | Light E2E testing |
| Priority fees + misc | ~2.0 | Buffer for retries |
| **Total** | **~40-41** | |
| **Available** | **~80.82** | |
| **Headroom** | **~40** | Comfortable margin |

## Railway Env Var Comprehensive Checklist

### Stage 4 Update (After deploy-all.sh completes)

These env vars must be set on the Railway devnet service before deploying the frontend:

**Program IDs (7):**
- `AMM_PROGRAM_ID` -- from deployments/devnet.json .programs.amm
- `TRANSFER_HOOK_PROGRAM_ID` -- from .programs.transferHook
- `TAX_PROGRAM_ID` -- from .programs.taxProgram
- `EPOCH_PROGRAM_ID` -- from .programs.epochProgram
- `STAKING_PROGRAM_ID` -- from .programs.staking
- `CONVERSION_VAULT_PROGRAM_ID` -- from .programs.conversionVault
- `BONDING_CURVE_PROGRAM_ID` -- from .programs.bondingCurve

**Mints (3):**
- `CRIME_MINT` -- from .mints.crime
- `FRAUD_MINT` -- from .mints.fraud
- `PROFIT_MINT` -- from .mints.profit

**Infrastructure:**
- `PROTOCOL_ALT` -- from .alt (new ALT address)
- `NEXT_PUBLIC_CLUSTER=devnet`
- `NEXT_PUBLIC_SITE_MODE=launch` (lock to launch page)
- `CLUSTER_URL` -- devnet Helius RPC (unchanged if same key)
- `HELIUS_API_KEY` -- unchanged

**Frontend SSE/DBS (if applicable):**
- `WS_SUBSCRIBER_ENABLED`
- `TOKEN_SUPPLY_POLL_INTERVAL_MS`
- `STAKER_COUNT_POLL_INTERVAL_MS`
- `SLOT_BROADCAST_INTERVAL_MS`

### Stage 6 Update (After graduation completes)

- `NEXT_PUBLIC_SITE_MODE=live` -- switch from launch page to trading interface
- `CARNAGE_WSOL_PUBKEY` -- from `solana-keygen pubkey keypairs/carnage-wsol.json`
- Pool addresses may be needed if crank reads from env (verify crank-runner.ts)
- Trigger Railway redeploy after env var changes

## Multi-Person Testing Protocol

### Phase 1: Manual UX Testing (During Stage 5)

1. Both users connect Phantom/Solflare wallet to devnet Railway frontend
2. mlbob sends 2-3 devnet SOL to remote tester's wallet address
3. Both users buy CRIME on the bonding curve (small amounts: 0.05-0.1 SOL)
4. Both users buy FRAUD on the bonding curve
5. Both users try selling (verify sell works, partial sell, etc.)
6. Watch pressure gauges move in real-time on both screens
7. Verify wallet balances update correctly after each transaction
8. Test error states: insufficient balance, maximum wallet cap reached

### Phase 2: Fill Script (After Manual Testing)

1. Run pathway2-fill.ts to complete both curves quickly
2. Watch frontend gauges reach 100% on both curves
3. Verify both curves show "Filled" status

### Phase 3: Post-Graduation E2E (After Stage 6)

Light E2E checklist (subset of Phase 96):
1. Buy CRIME with SOL (frontend swap)
2. Sell CRIME for SOL (frontend swap)
3. Buy FRAUD with SOL
4. Sell FRAUD for SOL
5. Convert CRIME to FRAUD via vault
6. Stake PROFIT (if possible with available PROFIT)
7. Wait 1-2 epochs, verify epoch advancement via crank
8. Verify frontend data updates (epoch info, tax rates, pool reserves)

## Open Questions

1. **Railway devnet service identity**
   - What we know: Railway has a devnet service running from Phase 95 deployment
   - What's unclear: Whether the Railway devnet service is the same Railway instance as mainnet or a separate service. CONTEXT.md mentions Railway env var updates but doesn't specify which service.
   - Recommendation: Verify during planning. The Railway devnet service should be separate from mainnet to avoid interference. NEXT_PUBLIC_CLUSTER env var on each service determines which addresses are used.

2. **Crank deployment target for devnet testing**
   - What we know: Crank can run locally (`npx tsx scripts/crank/crank-runner.ts`) or on Railway
   - What's unclear: Whether to use local crank (simpler) or Railway crank (validates prod path) for this test
   - Recommendation: Use local crank for simplicity unless the user specifically wants to validate Railway crank deployment. Local crank is faster to start and debug.

3. **Helius devnet webhook re-registration**
   - What we know: Helius webhook was registered for Phase 95 program IDs (Phase 96-02 decision). New program IDs = webhook won't catch new transactions.
   - What's unclear: Whether chart data matters for this phase's light E2E or can be deferred
   - Recommendation: Re-register webhook with new program IDs after Stage 2 deploy if frontend chart data is needed. Use `webhook-manage.ts` script.

4. **Remote tester coordination timing**
   - What we know: Remote tester joins at Stage 5 (bonding curve launch)
   - What's unclear: How to coordinate timing -- remote tester needs to be available when Stage 5 runs
   - Recommendation: Complete Stages 0-4 independently, take the deliberate pause, then coordinate a specific time with the remote tester before running Stage 5.

## Sources

### Primary (HIGH confidence)
- `scripts/deploy/deploy-all.sh` -- Full pipeline, inspected line-by-line
- `scripts/deploy/stage-{0..6}-*.sh` -- All 7 stage scripts, inspected
- `scripts/graduation/graduate.ts` -- 13-step graduation, inspected
- `scripts/test/pathway2-fill.ts` -- Fill script, inspected header + constants
- `deployments/devnet.json` -- Current devnet deployment schema (Phase 95)
- `deployments/mainnet.json` -- Current mainnet deployment (Phase 100)
- `.env.devnet` -- Devnet environment configuration
- `app/middleware.ts` -- Site mode toggle implementation
- `app/lib/protocol-config.ts` -- Cluster-aware address resolution
- `scripts/crank/crank-runner.ts` -- CARNAGE_WSOL_PUBKEY loading logic

### Secondary (HIGH confidence -- project history)
- `102-CONTEXT.md` -- User decisions constraining this phase
- `Docs/mainnet-deploy-checklist.md` -- Validated deployment procedure
- `Docs/e2e-test-report.md` -- Phase 96 E2E results (test selection reference)
- `.planning/STATE.md` -- Accumulated decisions and pitfall history

### Tertiary (Not applicable)
- No external research needed. This phase uses exclusively existing project tooling.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all tools exist, proven across multiple phases
- Architecture: HIGH -- pipeline flow is established and documented
- Pitfalls: HIGH -- learned from Phases 69, 95, 96, 98, 100
- Railway env vars: MEDIUM -- checklist derived from deployment.json schema but Railway service identity needs verification
- Multi-person testing: MEDIUM -- protocol established in CONTEXT.md but remote coordination timing is TBD

**Research date:** 2026-03-20
**Valid until:** 2026-04-20 (stable -- all tools are internal project code, not external dependencies)
