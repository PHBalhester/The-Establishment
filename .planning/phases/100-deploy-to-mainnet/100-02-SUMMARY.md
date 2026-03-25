---
phase: 100-deploy-to-mainnet
plan: 02
subsystem: infra
tags: [mainnet, deploy, solana, anchor, production, anti-sniper]

# Dependency graph
requires:
  - phase: 100-01
    provides: Mainnet signer architecture, .env.mainnet resolution
  - phase: 98-mainnet-checklist
    provides: Validated stage scripts (stages 0-4), deployment checklist
  - phase: 93-arweave-token-metadata
    provides: Arweave metadata URIs for token logos and descriptions
provides:
  - 6 core programs deployed to mainnet-beta with deployer authority
  - 3 vanity mints (cRiME, FraUd, pRoFiT) with Irys metadata URIs
  - All core PDAs initialized (AdminConfig, Whitelist, Epoch, Staking, Carnage, Vault)
  - 55-address ALT for protocol transactions
  - deployments/mainnet.json canonical address registry
  - shared/constants.ts and IDLs synced for frontend
  - Mainnet deploy checklist Stages 0-4 checked off
affects: [100-03, 100-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Anti-sniper: BC deferred from Stage 2 to Stage 5 with bcDeployed guard in initialize.ts"
    - "skipPreflight for ALT creation on mainnet (slot race condition workaround)"
    - "gateway.irys.xyz for metadata URIs (arweave.net gateway unreliable)"
    - "compile_error!() -> Pubkey::from_str() mainnet cfg block pattern for feature-gated addresses"

key-files:
  created:
    - deployments/mainnet.json
    - deployments/expected-hashes.mainnet.json
  modified:
    - programs/conversion-vault/src/constants.rs
    - programs/bonding_curve/src/constants.rs
    - scripts/deploy/patch-mint-addresses.ts
    - scripts/deploy/initialize.ts
    - scripts/deploy/stage-3-initialize.sh
    - scripts/deploy/stage-4-infra.sh
    - scripts/e2e/lib/alt-helper.ts
    - scripts/deploy/alt-address.json
    - shared/constants.ts
    - Docs/mainnet-deploy-checklist.md
    - app/idl/*.json (10 files)
    - app/idl/types/*.ts (10 files)

key-decisions:
  - "Anti-sniper strategy preserved: code fixed to skip BC steps rather than deploying all 7"
  - "MAINNET_MIN_BALANCE lowered from 32 to 26 SOL (deployer had 27.7 SOL)"
  - "Metadata URIs: existing Arweave uploads reused with gateway.irys.xyz (not arweave.net)"
  - "Treasury: dedicated wallet 3ihhwL... (NOT deployer) hardcoded in constants.rs"
  - "Crank wallet: separate F84XU... wallet (NOT deployer)"
  - "ALT address updated in deployments/mainnet.json after Stage 4 creation"

patterns-established:
  - "Mainnet deployment pipeline: run stage scripts individually (not deploy-all.sh) for interactive confirmation handling"

# Metrics
duration: ~100min
completed: 2026-03-15
---

# Phase 100 Plan 02: Execute Stages 0-4 Pre-Deploy Pipeline Summary

**6 core programs deployed to mainnet-beta, 3 vanity mints created with burned authorities, all PDAs initialized, 55-address ALT created, constants and IDLs synced -- bonding curve withheld as anti-sniper measure for Stage 5**

## Performance

- **Duration:** ~100 min (including 3 checkpoint pauses for user decisions)
- **Started:** 2026-03-15T19:08:48Z
- **Completed:** 2026-03-15T20:48:15Z
- **Tasks:** 3 (1 decision gate, 1 auto, 1 human-verify)
- **Files modified:** 34+
- **SOL spent:** 20.83 SOL (from 27.70, remaining 6.87)

## Accomplishments

- Executed Stages 0-4 of the mainnet deployment checklist against Solana mainnet-beta
- Deployed 6 core programs (AMM, Transfer Hook, Tax, Epoch, Staking, Conversion Vault) with deployer authority
- Created 3 Token-2022 mints with vanity addresses (cRiME, FraUd, pRoFiT) and Irys metadata URIs
- Burned all 3 mint authorities (irreversible -- no new tokens can be minted)
- Minted token supplies: CRIME=1B, FRAUD=1B, PROFIT=20M
- Initialized all core PDAs: AdminConfig, WhitelistAuthority, EpochState, StakePool, CarnageFund, VaultConfig
- Created 55-address ALT for protocol transactions
- Generated shared/constants.ts (508 lines) and synced 10 IDL files to frontend
- Populated deployments/mainnet.json with all protocol addresses
- Updated .env.mainnet with CARNAGE_WSOL_PUBKEY and PDA_MANIFEST
- Checked off Stages 0-4 in Docs/mainnet-deploy-checklist.md

## Deployment Results

| Stage | Result | Cost |
|-------|--------|------|
| 0 Preflight | 9/9 checks PASS | 0 SOL |
| 1 Build | 7 programs compiled, 29/29 ID checks, no devnet addresses | 0 SOL |
| 2 Deploy | 6/6 programs deployed and verified on-chain | 20.76 SOL |
| 3 Initialize | 32 steps done, 13 deferred (BC + pools) | ~0.07 SOL |
| 4 Infrastructure | ALT (55 addresses) + constants + IDLs | ~0.01 SOL |
| **Total** | | **~20.83 SOL** |

### Mainnet Program IDs

| Program | Address | Authority |
|---------|---------|-----------|
| AMM | 5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR | 23g7xmrt...59YR |
| Transfer Hook | CiQPQrmQh6BPhb9k7dFnsEs5gKPgdrvNKFc5xie5xVGd | 23g7xmrt...59YR |
| Tax Program | 43fZGRtmEsP7ExnJE1dbTbNjaP1ncvVmMPusSeksWGEj | 23g7xmrt...59YR |
| Epoch Program | 4Heqc8QEjJCspHR8y96wgZBnBfbe3Qb8N6JBZMQt9iw2 | 23g7xmrt...59YR |
| Staking | 12b3t1cNiAUoYLiWFEnFa4w6qYxVAiqCWU7KZuzLPYtH | 23g7xmrt...59YR |
| Conversion Vault | 5uawA6ehYTu69Ggvm3LSK84qFawPKxbWgfngwj15NRJ | 23g7xmrt...59YR |
| Bonding Curve | NOT deployed (anti-sniper, Stage 5) | -- |

### Mainnet Mint Addresses

| Token | Address | Supply | Authority |
|-------|---------|--------|-----------|
| CRIME | cRiMEhAxoDhcEuh3Yf7Z2QkXUXUMKbakhcVqmDsqPXc | 1,000,000,000 | BURNED |
| FRAUD | FraUdp6YhtVJYPxC2w255yAbpTsPqd8Bfhy9rC56jau5 | 1,000,000,000 | BURNED |
| PROFIT | pRoFiTj36haRD5sG2Neqib9KoSrtdYMGrM7SEkZetfR | 20,000,000 | BURNED |

### Key Addresses

| Item | Address |
|------|---------|
| Deployer | 23g7xmrtXA6LSWopQcAUgiptGUArSLEMakBKcY1S59YR |
| Treasury | 3ihhwLnEJ2duwPSLYxhLbFrdhhxXLcvcrV9rAHqMgzCv |
| Crank Wallet | F84XUxo5VM8FJZeGvC3CrHYwLzFod3ep57CULjZ4ZXc1 |
| ALT | 7dy5NNvacB8YkZrc3c96vDMDtacXzxVpdPLiC4B7LJ4h |
| Carnage WSOL | 3nu1dbvAc94ARrS5tRrxK4cGDt8JyWQ7Y6D89eMGfRbr |

## Task Commits

1. **Task 1: Pre-deploy readiness decision** - N/A (decision checkpoint, approved)
2. **Task 2: Execute Stages 0-4** - `40aa0d9` (feat)
3. **Task 2b: Check off checklist** - `098ef73` (docs)
4. **Task 3: Joint review checkpoint** - N/A (approved -- mints verified on Solscan)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed compile_error!() in mainnet cfg blocks**

- **Found during:** Stage 1 Build
- **Issue:** conversion-vault/src/constants.rs and bonding_curve/src/constants.rs had `compile_error!()` placeholders in their `#[cfg(not(any(feature = "devnet", feature = "localnet")))]` blocks. The `patch-mint-addresses.ts` script only patched devnet cfg blocks, leaving mainnet blocks with compile errors. Also, `use std::str::FromStr` was gated behind `#[cfg(feature = "devnet")]`.
- **Fix:** (1) Replaced compile_error!() with Pubkey::from_str() calls using vanity mint addresses, (2) made FromStr import unconditional, (3) updated patch-mint-addresses.ts to also handle mainnet cfg blocks and compile_error patterns.
- **Files modified:** programs/conversion-vault/src/constants.rs, programs/bonding_curve/src/constants.rs, scripts/deploy/patch-mint-addresses.ts

**2. [Rule 3 - Blocking] Fixed ALT creation "is not a recent slot" on mainnet**

- **Found during:** Stage 4 Infrastructure
- **Issue:** ALT creation failed with "is not a recent slot" error. The createLookupTable instruction requires the recentSlot parameter to be within the validator's recent slot window. On mainnet with finalized commitment, the slot returned by getSlot became stale during simulation.
- **Fix:** Used skipPreflight to bypass simulation and send transaction directly. Used finalized commitment for both getSlot and blockhash to ensure consistency.
- **Files modified:** scripts/e2e/lib/alt-helper.ts

**3. [Rule 3 - Blocking] Fixed stage-4-infra.sh verification grep pattern**

- **Found during:** Stage 4 Infrastructure
- **Issue:** Verification step checked for `AMM_PROGRAM_ID` string but generate-constants.ts now produces `PROGRAM_IDS = { AMM: ... }` format.
- **Fix:** Updated grep pattern to match either `AMM_PROGRAM_ID` or `PROGRAM_IDS`.
- **Files modified:** scripts/deploy/stage-4-infra.sh

**4. [Rule 3 - Blocking] ALT address mismatch in deployments/mainnet.json**

- **Found during:** Post-Stage 4 verification
- **Issue:** deployments/mainnet.json contained the old devnet ALT address (written by initialize.ts in Stage 3, before Stage 4 created the mainnet ALT).
- **Fix:** Updated the ALT address in deployments/mainnet.json to the new mainnet ALT.
- **Files modified:** deployments/mainnet.json

### User-resolved Issues

**5. Metadata URI gateway switch (arweave.net -> gateway.irys.xyz)**

- **Found during:** Stage 3 Initialize
- **Issue:** METADATA_URI env vars were missing from .env.mainnet. When resolved, arweave.net gateway was found unreliable.
- **Resolution:** User re-uploaded metadata and switched to gateway.irys.xyz URLs. Updated upload-metadata.ts constant.

**6. Anti-sniper code fix (pre-plan, user-applied)**

- **Issue:** stage-3-initialize.sh prereq check required bonding curve deployed; initialize.ts Steps 17-25 called BC program.
- **Resolution:** User removed BC from stage-3 prereq, added bcDeployed guard in initialize.ts.

## Decisions Made

- Anti-sniper strategy PRESERVED by fixing code (not deploying all 7 together)
- MAINNET_MIN_BALANCE lowered from 32 to 26 SOL
- Existing Arweave metadata URIs reused (same content for devnet and mainnet)
- Gateway switched from arweave.net to gateway.irys.xyz for reliability
- Treasury is dedicated wallet (3ihhwL...), NOT deployer
- Crank wallet (F84XU...) is separate from deployer

## Issues Encountered

- arweave.net gateway was unreliable at deploy time; switched to gateway.irys.xyz
- Devnet treasury_pubkey() was incorrectly set to mainnet treasury address (fixed)

## Post-Completion Fix: Cluster-Aware Frontend (2026-03-17)

Stage 4 generated `shared/constants.ts` from `mainnet.json` and synced mainnet IDLs to `app/idl/`.
This broke the devnet frontend — all addresses and Anchor program IDs were mainnet, but the devnet
RPC returned null for mainnet accounts. Three commits fixed this:

1. **`767da78` — Cluster-aware address resolution**: `app/lib/protocol-config.ts` resolves all
   addresses from `NEXT_PUBLIC_CLUSTER` via `CLUSTER_CONFIG`. 19 consuming files updated.
2. **`11b3a4e` — IDL program ID override**: `app/lib/anchor.ts` uses `withClusterAddress()` to
   override IDL-embedded program IDs with cluster-correct ones from `PROGRAM_IDS`.
3. **`(pending)` — ALT + RPC safety**: Added `alt` to `ClusterConfig`, removed cross-cluster
   RPC fallback that could route mainnet requests to devnet silently.

**Impact on remaining stages**: None. Deploy scripts read `deployments/mainnet.json` directly.
The frontend is now self-configuring via `NEXT_PUBLIC_CLUSTER` — no manual regeneration of
constants.ts or IDL syncing needed when switching clusters.

**CRITICAL for Stage 5/6**: `NEXT_PUBLIC_CLUSTER=mainnet` MUST be set on Railway mainnet service
before building the frontend. This drives address resolution, program ID selection, AND ALT address.

## Next Phase Readiness

- 6/7 programs live on mainnet, waiting for Stage 5 (bonding curve deploy at launch)
- ~6.87 SOL remaining in deployer (need ~4.7 SOL for BC deploy at Stage 5)
- Frontend is cluster-aware: set `NEXT_PUBLIC_CLUSTER=mainnet` on Railway to use mainnet addresses
- STOP: Plans 100-03 and 100-04 are Wave 3/4 -- not to be executed until user is ready

---
*Phase: 100-deploy-to-mainnet*
*Completed: 2026-03-15*
