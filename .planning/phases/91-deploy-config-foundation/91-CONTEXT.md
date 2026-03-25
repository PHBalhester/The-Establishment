# Phase 91: Deploy Config Foundation - Context

**Gathered:** 2026-03-12
**Status:** Ready for planning

<domain>
## Phase Boundary

All protocol addresses flow from a single `deployments/{cluster}.json` file, eliminating manual address copy-paste and preventing wrong-cluster deploys. The deploy pipeline generates this config, `generate-constants.ts` auto-writes `shared/constants.ts` from it, and `verify.ts` confirms everything matches on-chain state. Requirements: INFRA-01 through INFRA-07, INFRA-13.

</domain>

<decisions>
## Implementation Decisions

### Config Schema Design
- Evolve existing `pda-manifest.json` into `deployments/{cluster}.json` — extend with missing fields (BondingCurve program, PROFIT pools, ALT, treasury, metadata URIs, authority state), keep existing consumers working during migration
- File location: `deployments/devnet.json` and `deployments/mainnet.json` at project root
- Both devnet and mainnet configs committed to git — addresses are public on-chain, secrets stay in `.env` files
- Include `"schemaVersion": 1` at top level for future compatibility

### Constants Generation
- `generate-constants.ts` does a FULL OVERWRITE of `shared/constants.ts` — no manual edits allowed, everything derived from deployment.json + static values (seeds, decimals, fees)
- Generated file includes header comment: `// AUTO-GENERATED from deployments/{cluster}.json — DO NOT EDIT MANUALLY`
- Emit pre-computed PDA addresses as constants (eliminates async `findProgramAddress` calls in frontend)
- Emit all pool data (pool account + vault addresses for all 4 pools)
- Crank runner imports `shared/constants.ts` directly for all protocol addresses — env vars only for secrets (RPC key, wallet path) and operator-specific values (CARNAGE_WSOL_PUBKEY)

### Pipeline Extension
- deploy-all.sh grows from 4 phases to 7:
  - Phase 0: Mint keypairs (if fresh deploy)
  - Phase 1: Build (`anchor build --devnet`)
  - Phase 2: Deploy (`anchor deploy`) — mainnet: confirmation prompt with cost estimate
  - Phase 3: Initialize (mints, PDAs, pools, whitelist, BcAdminConfig) — writes `deployments/{cluster}.json` — mainnet: confirmation prompt
  - Phase 4: Generate constants (writes `shared/constants.ts`)
  - Phase 5: Create/extend ALT
  - Phase 6: Verify (reads deployment.json, deep on-chain verification)
- Built-in two-pass mode for chicken-and-egg mint/feature-flag rebuild — auto-detects when needed, no manual intervention
- Cluster argument REQUIRED (no auto-detection from Solana CLI config) — `./deploy-all.sh devnet` or `./deploy-all.sh mainnet`, bare invocation errors
- BcAdminConfig initialization automated in Phase 3 (closes DEPLOY-GAP-01)

### Guard Rails & Errors
- Devnet-address-in-mainnet-binary detection: grep compiled `.so` files for any address from `deployments/devnet.json`, abort if found on mainnet build with clear error listing which addresses and which program
- initialize.ts: hard error on ALL missing required env vars upfront before any execution — pool seed vars, metadata URIs required on non-localhost — single error message lists every missing var
- Cluster cross-validation: deploy-all.sh aborts if `.env.{cluster}` CLUSTER_URL doesn't match the target cluster argument
- verify.ts upgraded to deep verification: reads deployment.json AND checks on-chain (program authorities, mint properties, pool reserves initialized, PDA owners, ALT loaded, authority matches config)

### Claude's Discretion
- Exact deployment.json schema field names and nesting
- TypeScript type definitions for deployment.json
- Verification report formatting
- Error message wording and exit codes
- How `pda-manifest.json` migration/deprecation is handled (redirect or delete)

</decisions>

<specifics>
## Specific Ideas

- Pool seed env var hard-error is non-negotiable — Phase 69 cost 50 SOL due to missing env vars using test defaults
- Mainnet confirmation prompts should show SOL cost estimate and deployer balance
- The pipeline should be the same script for devnet and mainnet — cluster argument is the only difference
- Two-pass detection should be automatic (detect feature-flagged programs needing mint addresses)

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scripts/deploy/pda-manifest.json`: Current address source — schema foundation for deployment.json
- `scripts/deploy/lib/pda-manifest.ts`: `generateManifest()` function that computes all PDAs — extend to produce deployment.json
- `scripts/deploy/lib/connection.ts`, `lib/logger.ts`, `lib/account-check.ts`: Shared deploy library
- `shared/constants.ts`: Current manually-maintained constants — will become auto-generated target
- `scripts/deploy/patch-mint-addresses.ts`: Existing mint address patching for two-pass builds
- `scripts/deploy/create-alt.ts`: ALT creation script — integrate into pipeline Phase 5
- `scripts/deploy/alt-address.json`: Cached ALT address

### Established Patterns
- deploy-all.sh uses `set -e` with phased execution and toolchain version gating
- initialize.ts is idempotent with check-before-init for every step
- verify.ts produces tabular deployment report with pass/fail status
- `.env` sourced at pipeline start with `set -a` for auto-export

### Integration Points
- `shared/constants.ts` consumed by: app/ (frontend), scripts/ (crank, deploy), tests/
- `pda-manifest.json` consumed by: verify.ts, initialize.ts (via lib/pda-manifest.ts)
- `.env` consumed by: deploy-all.sh, initialize.ts, crank runner
- Anchor.toml `[programs.devnet]` section has program IDs (must stay in sync)

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 91-deploy-config-foundation*
*Context gathered: 2026-03-12*
