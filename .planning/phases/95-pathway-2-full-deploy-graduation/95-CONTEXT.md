# Phase 95: Pathway 2 Full Deploy + Graduation - Context

**Gathered:** 2026-03-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Complete clean-room deployment of the entire protocol from absolute zero (fresh program IDs, fresh mints, fresh everything), fill both bonding curves to capacity, graduate them into AMM pools, seed the conversion vault, start the crank, verify the full protocol is operational, and toggle the frontend to live trading mode. Requirements: CURVE-06, CURVE-07, CURVE-08, CURVE-09.

</domain>

<decisions>
## Implementation Decisions

### Deploy Procedure
- Completely fresh clean-room deploy — no reuse from Pathway 1 deployment
- Use full `deploy-all.sh devnet` (no --partial flag) — all 7 programs with fresh IDs
- Phase 94.1 plans 03/04 assumed complete before Phase 95 starts (graduation script fix, docs cascade)
- Check devnet wallet SOL balance before starting — user manually collects from faucets
- Plan includes Railway crank env var updates — Claude provides the values, user updates Railway dashboard

### Curve Filling Strategy
- User buys 0.1 SOL of each curve manually via frontend FIRST (tests UX flow)
- User then runs the fill script in their own terminal while watching frontend gauges in real-time
- Parallel buys AND sells across both curves simultaneously (alternating CRIME/FRAUD)
- Randomized spacing (1-5s between operations) for organic-feeling traffic
- Target ~30 seconds total to fill both curves from user's manual buy to capacity
- Script generates its own wallets, funds them from devnet wallet, executes varied buy/sell patterns

### Frontend Polling for Recording
- Reduce useCurveState.ts RPC fallback poll from 5s to 1s for this devnet test session
- WebSocket subscriptions already provide real-time updates when they work
- 1s fallback compensates for flaky devnet WebSocket — gauge movement appears near real-time on camera
- Revert to 5s after recording is complete
- Note: mainnet with paid Helius plan will have reliable WebSocket = true real-time without fallback

### Graduation Verification
- User manually triggers `graduate.ts` after visually confirming both gauges show 100% filled
- Automated verify script runs after graduation:
  - AMM pools exist with correct reserves (290M tokens + graduated SOL per pool)
  - Conversion vault funded (250M CRIME + 250M FRAUD + 20M PROFIT)
  - Tax escrow transferred to carnage vault
  - Crank can advance one epoch with VRF — proves full protocol loop is operational
  - Pass/fail report for each check
- Formal markdown report: `Docs/pathway2-report.md` with deploy addresses, curve fill log, graduation steps with timestamps, pool reserve verification, crank epoch test, pass/fail checklist
- Conversion vault seeding and tax escrow distribution remain in graduate.ts (steps 9-11)

### Post-Graduation Transition
- Toggle SITE_MODE from `launch` to `live` on Railway after verification passes
- Perform one test swap on CRIME/SOL pool via frontend — proves trading interface is connected to correct addresses and tax distribution works
- /launch page shows graduated banner ("Curves graduated — trading is live!") with link to main app — preserves curve display as historical record (per Phase 94.1 decision)
- Crank started on Railway with new deployment addresses — included in plan scope

### Claude's Discretion
- Fill script wallet count and exact buy/sell amount distribution
- Exact verify script implementation (extend existing verify.ts or new script)
- Railway env var list derivation from deployment.json
- Report formatting and level of detail
- Error handling and retry logic in fill/graduation scripts

</decisions>

<specifics>
## Specific Ideas

- User wants to screen-record the curve filling for promotional/documentation purposes — gauge responsiveness matters
- Fill script should include sells mixed with buys for realistic traffic simulation, not just monotonic buying
- The ~30s fill duration creates a dramatic, watchable sequence on camera
- pathway2-report.md becomes evidence that the full lifecycle works — referenced during mainnet deploy
- The test swap after graduation is the "it works!" moment — simple CRIME/SOL buy proves the entire protocol chain

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scripts/deploy/deploy-all.sh`: Full 7-phase pipeline already handles clean-room deploy (Phase 0-6)
- `scripts/graduation/graduate.ts`: 11-step graduation orchestrator with checkpoint/resume
- `scripts/deploy/verify.ts`: Deep verification of all on-chain state against deployment.json
- `scripts/deploy/generate-constants.ts`: Auto-writes shared/constants.ts from deployment.json
- `scripts/deploy/create-alt.ts`: Creates Address Lookup Table for large transactions
- Pathway 1 scripts (pathway1-test.ts, verify-refunds.ts) as reference for fill script pattern

### Established Patterns
- `deploy-all.sh` pipeline: Phase 0 (keypairs) -> Phase 1 (build --devnet) -> Phase 2 (deploy) -> Phase 3 (initialize) -> Phase 4 (generate-constants) -> Phase 5 (ALT) -> Phase 6 (verify)
- Idempotent scripts with checkpoint/resume (initialize.ts, graduate.ts)
- `set -a && source .env.devnet && set +a` for env loading
- Railway env vars for runtime config (SITE_MODE, RPC URLs, program IDs)
- Formal report pattern: Docs/pathway1-report.md

### Integration Points
- `deployment.json` receives all fresh addresses from full deploy
- `.env.devnet` updated with new addresses
- Railway env vars: SITE_MODE, all program IDs, mint addresses, crank config
- `shared/constants.ts` regenerated from new deployment.json
- Frontend connects to new addresses via shared constants
- Crank runner reads program IDs from env vars

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 95-pathway-2-full-deploy-graduation*
*Context gathered: 2026-03-14*
