# Phase 98: Mainnet Checklist - Context

**Gathered:** 2026-03-15
**Status:** Ready for planning

<domain>
## Phase Boundary

An exhaustive mainnet deployment checklist organized into 7 independently-runnable stages, where every item has a verification command with expected output, validated by executing it as a fresh devnet deploy. The existing `deploy-all.sh` is refactored into stage scripts that can be run individually with manual verification gates between each. The old `Docs/mainnet-checklist.md` (v0.8 era) is replaced entirely.

</domain>

<decisions>
## Implementation Decisions

### Deploy Pipeline Staging (7 Stages)

- Refactor `deploy-all.sh` into 7 independent stage scripts (e.g., `stage-1-build.sh`, `stage-2-deploy.sh`, etc.) that can be run individually
- Each stage is self-contained: can be run, verified, and signed off before proceeding
- This enables pre-deploying everything up to bonding curve initialization days before launch, then only running Stage 5 at launch time

**Stage breakdown:**
1. **Stage 1: Build & Verify Binaries** -- compile all 7 programs, hash check, binary address cross-validation
2. **Stage 2: Deploy Programs** -- deploy 7 programs to cluster, verify each is executable with correct authority
3. **Stage 3: Initialize Core** -- init mints (with Arweave metadata + MetadataPointer), init conversion vault, init staking, init epoch state, init BcAdminConfig. **WARNING: DO NOT create pools here** (pitfall #1 -- pools are created during graduation with SOL from filled curves). **DO NOT burn whitelist authority here** (pitfall #6 -- needed for post-graduation pool vault whitelisting)
4. **Stage 4: Infrastructure** -- ALT creation, generate-constants, IDL sync, frontend deploy to Railway
5. **Stage 5: Launch** -- init bonding curves, open launch page. **THIS IS THE PUBLIC LAUNCH MOMENT.** Everything before this can be done days in advance
6. **Stage 6: Post-Graduation** -- after both curves fill and graduate: pools created with graduated SOL, pool vaults whitelisted, whitelist authority burned, crank started, frontend switches from launch to trading mode
7. **Stage 7: Squads & Monitoring** -- authority transfer to 2-of-3 multisig AFTER launch (deployer keeps control during critical launch window for hot-fix capability), monitoring setup, timelock progression

### Checklist Structure

- Stage-based sections matching the 7 deploy stages, plus a **Stage 0 (Pre-Deploy)** for toolchain verification, wallet setup, env configuration
- Each stage section contains: prerequisites, action items with commands, verification commands with expected output, and a GO/NO-GO checkbox gate
- Phase 95 pitfalls (15 critical lessons) placed as inline WARNING boxes at the exact step where each could occur (not in an appendix)
- Old `Docs/mainnet-checklist.md` replaced entirely by the new document

### Verification Approach

- Every checklist item has: the action command, a verification command, AND the expected output pattern (e.g., `solana program show <ID>` should show `Executable: true, Authority: <deployer>`)
- Operator can visually diff actual vs expected output
- GO/NO-GO gates between stages are markdown checkbox lists -- manually check each verification, then a "PROCEED TO STAGE N" confirmation line (printable, auditable)

### SOL Budget

- Thorough line-item table covering: 7 program deploys (size-based), 3 mints, ~20 PDAs (rent-exempt), 4 pools, ALT, crank funding (monthly estimate), priority fees buffer
- +20% contingency on the total
- Curve SOL (1000 SOL from community buyers) called out in a **separate section** -- not deployer cost, but documented for full picture
- Budget is deployer-wallet-focused: what needs to be in the wallet before Stage 1

### Monitoring During Fill Period

- Between Stage 5 (curve init) and Stage 6 (graduation), a monitoring sub-checklist covers: watch curve progress, monitor for issues, have `graduate.ts` ready, have rollback plan (refund path) documented
- No deploy actions during fill period, just observation + readiness

### Squads Authority Transfer Timing

- Authorities transferred AFTER launch and graduation (Stage 7), not before
- Deployer keeps control during the critical launch/graduation window for hot-fix capability
- Transfer once trading is stable and verified

### Checklist Validation

- Fresh devnet deploy using the checklist step-by-step as the validation method (CHECK-03)
- This also fixes the current devnet state (burned upgrade authorities from Phase 97 bug)
- **This is the final wave** of the phase -- requires waiting for devnet SOL faucet replenishment

### Claude's Discretion
- Exact organization of sub-items within each stage
- Command formatting and visual layout of the checklist document
- Which verify.ts checks to extend vs. which are manual-only
- Stage script naming convention and internal structure

</decisions>

<specifics>
## Specific Ideas

- User wants to pre-deploy everything up to curve initialization days before launch to minimize launch-day risk
- At launch time, only Stage 5 (init curves + open launch page) runs -- everything else is already verified and stable
- The stage scripts ARE the checklist -- the document references the scripts, and the scripts embody the procedure
- The 15 Phase 95 pitfalls are hard-won lessons that cost ~50 SOL and multiple failed deploys; they must be prominent warnings, not footnotes

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scripts/deploy/deploy-all.sh`: Current monolithic pipeline (Phase 0-4) -- refactor target
- `scripts/deploy/build.sh`: Build pipeline with sync-program-ids step [0/4]
- `scripts/deploy/deploy.sh`: Program deployment script
- `scripts/deploy/initialize.ts`: 23-step idempotent initialization
- `scripts/deploy/verify.ts`: 36-check verification script
- `scripts/deploy/generate-constants.ts`: Auto-writes shared/constants.ts from deployment.json
- `scripts/deploy/create-alt.ts`: ALT creation script
- `scripts/deploy/setup-squads.ts`: Squads multisig creation
- `scripts/deploy/transfer-authority.ts`: Authority transfer script
- `scripts/deploy/verify-authority.ts`: Authority verification
- `scripts/deploy/generate-hashes.sh`: Binary hash generation for preflight
- `scripts/graduation/`: Graduation orchestration scripts

### Established Patterns
- `deploy-all.sh` uses Phase 0-4 sequential pattern with `set -e` (currently not atomic -- pitfall #10)
- `initialize.ts` is idempotent (skips completed steps) but has owner-validation gaps (pitfall #13)
- Two-pass deploy pattern: feature-flagged programs need mint addresses baked in at compile time

### Integration Points
- `deployments/{cluster}.json` is the canonical address source (Phase 91)
- `.env.devnet` / `.env.mainnet` credential separation (Phase 92)
- `graduate.ts` creates pools + whitelists pool vaults (moved from init in Phase 95 fix)
- Preflight safety gate already in deploy-all.sh (Phase 92)

</code_context>

<deferred>
## Deferred Ideas

- **Production Infrastructure Staging** -- Helius mainnet RPC setup, domain configuration (fraudsworth.fun), Railway prod environment, and any other production infra that can be set up before launch. User plans to add this as a separate phase (e.g., Phase 98.1).

</deferred>

---

*Phase: 98-mainnet-checklist*
*Context gathered: 2026-03-15*
