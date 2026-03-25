# Phase 102: Full Devnet Lifecycle Redeploy and Bonding Curve Graduation Test - Context

**Gathered:** 2026-03-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Complete clean-room devnet redeploy following the Phase 100 8-stage schedule (Stages 0-6, skipping Stage 7 governance), test bonding curve purchase/sell mechanics with a remote second tester using their own wallet, graduate both curves, verify the Railway site mode transition from launch→live, and perform light E2E post-graduation testing. NOTHING in this phase may affect the mainnet deployment state (Stages 0-4 complete, 6.87 SOL in deployer, vanity mints deployed).

</domain>

<decisions>
## Implementation Decisions

### Mainnet Isolation
- Trust existing guards — deploy-all.sh cluster arg, .env.devnet/.env.mainnet separation, separate keypair locations (devnet in keypairs/, mainnet in ~/mainnet-keys/)
- Cluster-aware constants already safe: generate-constants.ts reads both deployments/devnet.json and deployments/mainnet.json, embeds both into shared/constants.ts via CLUSTER_CONFIG. protocol-config.ts resolves by NEXT_PUBLIC_CLUSTER
- No additional lockout needed — architecture already prevents cross-cluster contamination
- No Railway mainnet lockout needed — NEXT_PUBLIC_CLUSTER=mainnet on mainnet service resolves mainnet addresses regardless of devnet.json changes

### Authority Handling
- **Mirror mainnet exactly:** Burn mint + freeze authorities at init for all 3 tokens (CRIME, FRAUD, PROFIT)
- **Upgrade authorities:** Stay with devnet deployer wallet (NOT transferred to Squads)
- **Whitelist authority:** Stay with devnet deployer wallet. Pool vaults whitelisted at graduation as normal
- **Admin PDAs (AMM AdminConfig, BcAdminConfig):** Stay with devnet deployer wallet
- **Squads governance:** Skipped entirely (Stage 7 not run). Already proven in Phase 97

### Multi-Person Testing Flow
- Remote tester connects with their own Phantom/Solflare wallet to the devnet Railway frontend
- User (mlbob) sends them devnet SOL from deployer wallet (~2-3 SOL) after they share their wallet address
- **Phase 1 — Manual UX testing:** Both users buy and sell on curves manually via frontend. Test the real user journey — connect wallet, buy CRIME, buy FRAUD, try selling. Watch gauges move together
- **Phase 2 — Fill script:** After manual testing validates UX, run the fill script to complete curves quickly and trigger graduation
- **Full post-graduation testing:** After graduation and site mode switch, both users test swaps, staking, and core protocol features (light E2E, not full Phase 96 checklist)

### Stage Scope & Order (Stages 0-6)
- **Stage 0: Preflight** — toolchain, env, balance check (80+ SOL available)
- **Stage 1: Build** — compile all 7 programs with --devnet feature
- **Stage 2: Deploy 6 Core** — deploy AMM, Hook, Tax, Epoch, Staking, Vault (withhold BC as anti-sniper)
- **Stage 3: Initialize Core** — init mints (burn mint+freeze), init conversion vault, staking, epoch, BcAdminConfig. NO pools (created at graduation)
- **Stage 4: Infrastructure** — ALT, generate-constants, Railway frontend deploy with SITE_MODE=launch
- **⏸ GAP — Simulate pre-launch wait** — Pause between Stage 4 and Stage 5. Tests that deployed state survives across sessions and frontend works in pre-launch state
- **Stage 5: Launch** — deploy Bonding Curve program, whitelist, init curves. Remote tester joins. Manual UX testing, then fill script
- **Stage 6: Graduation** — graduate both curves, seed AMM pools, whitelist pool vaults, start crank, switch SITE_MODE to live on Railway. Light E2E with both testers

### Railway Env Var Management
- Plan must include comprehensive Railway env var update checklist at Stage 4 (initial deploy) and Stage 6 (post-graduation switch)
- Key vars to update: SITE_MODE, CARNAGE_WSOL_PUBKEY, all program IDs, mint addresses, pool addresses, crank-specific env vars
- Reminder at phase start: list all env vars that need changing to switch Railway to launch mode for the new deployment

### Devnet SOL Budget
- Deployer wallet: ~80.82 SOL (more than sufficient)
- Deploy cost: ~25.54 SOL (7 programs + init + ALT)
- Curve fills: ~10 SOL (both curves, devnet P_START=5/P_END=17)
- Remote tester funding: ~2-3 SOL
- Buffer for priority fees + misc: ~5 SOL
- Total: ~43 SOL needed, ~38 SOL headroom

### Claude's Discretion
- Exact Railway env var list derivation from deployment.json
- Fill script configuration (wallet count, buy/sell distribution)
- Post-graduation E2E test selection (which swap pairs, how many epochs to wait)
- Error handling and retry strategies for devnet flakiness
- Whether to reuse existing Phase 95 fill script or create a new one

</decisions>

<specifics>
## Specific Ideas

- This is a dress rehearsal for the real mainnet launch — testing the full lifecycle as a real user would experience it
- The remote tester provides genuine "first-time user" perspective on the bonding curve UX
- Simulating the Stage 4→5 gap validates that the pre-deploy strategy actually works across sessions
- The Railway site mode switch is critical UX — launch page → trading interface must be smooth
- Railway env var checklist at phase start prevents the "what do I change?" confusion mid-deploy

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scripts/deploy/deploy-all.sh`: Full 7-phase pipeline, already handles clean-room devnet deploy
- `scripts/deploy/stage-{0..7}-*.sh`: Independent stage scripts from Phase 98
- `scripts/deploy/initialize.ts`: 23-step idempotent initialization
- `scripts/deploy/verify.ts`: 36-check deep verification
- `scripts/deploy/generate-constants.ts`: Cluster-aware constants writer (reads both devnet.json and mainnet.json)
- `scripts/graduation/graduate.ts`: 11-step graduation orchestrator with checkpoint/resume
- `scripts/deploy/create-alt.ts`: Address Lookup Table creation
- Phase 95 fill script pattern (pathway1-test.ts reference for curve filling)
- `app/lib/protocol-config.ts`: Cluster-aware address resolution via NEXT_PUBLIC_CLUSTER

### Established Patterns
- `deploy-all.sh devnet` pipeline: Phase 0 → Phase 6 with stage gates
- `set -a && source .env.devnet && set +a` for env loading
- Idempotent scripts with checkpoint/resume (initialize.ts, graduate.ts)
- Railway env vars for runtime config (SITE_MODE, RPC URLs, program IDs)
- Cluster-aware constants: deployments/{cluster}.json → generate-constants.ts → shared/constants.ts (CLUSTER_CONFIG) → protocol-config.ts

### Integration Points
- `deployments/devnet.json`: Updated with fresh addresses from new deploy (mainnet.json untouched)
- `.env.devnet`: Updated with new deployment addresses
- Railway devnet service: env vars updated at Stage 4 and Stage 6
- `shared/constants.ts`: Regenerated with new devnet block, mainnet block preserved
- Crank runner on Railway: needs new program IDs and CARNAGE_WSOL_PUBKEY

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 102-full-devnet-lifecycle-redeploy-and-bonding-curve-graduation-test*
*Context gathered: 2026-03-20*
