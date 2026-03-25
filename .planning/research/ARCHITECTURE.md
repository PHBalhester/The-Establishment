# Architecture: v1.4 Pre-Mainnet Deployment Infrastructure

**Domain:** Canonical deployment config, Arweave metadata, Squads authority transfer -- integration with existing deploy pipeline
**Researched:** 2026-03-12
**Confidence:** HIGH for deployment.json design and pipeline integration (based on deep codebase analysis). MEDIUM for Squads v4 SDK specifics and Arweave tooling (training data, not live-verified).

---

## 1. Current State Analysis

### 1.1 Address Configuration Today (The Problem)

Addresses are scattered across **5 independent sources** with no single source of truth:

| Source | What it stores | Who consumes it |
|--------|---------------|-----------------|
| `scripts/deploy/pda-manifest.json` | Programs, mints, PDAs, pools (devnet only) | `verify.ts`, manual copy-paste to `shared/constants.ts` |
| `shared/constants.ts` | Hardcoded PublicKey objects for devnet + mainnet placeholders | Frontend (all swap/stake/dashboard hooks), route engine |
| `.env` / `app/.env.local` | RPC URLs, API keys, seed amounts | `deploy-all.sh`, `initialize.ts`, Next.js frontend |
| `Anchor.toml` | Program IDs per cluster | `anchor build`, `anchor deploy` |
| Rust `constants.rs` (4 programs) | Feature-gated mint addresses, cross-program IDs, treasury | On-chain programs (compile-time) |

**The manual sync gap:** After `deploy-all.sh` completes, an operator must manually copy 30+ addresses from `pda-manifest.json` into `shared/constants.ts`. This is error-prone (the Phase 51 IDL sync miss broke all swaps), and there is no automated validation that `shared/constants.ts` matches on-chain reality.

### 1.2 Deploy Pipeline Today

```
deploy-all.sh
  |
  +-- Phase 0: Generate mint keypairs (if missing)
  |     -> scripts/deploy/mint-keypairs/*.json
  |
  +-- Phase 1: build.sh
  |     [0/3] patch-mint-addresses.ts (reads keypairs, patches Rust constants.rs)
  |     [1/3] anchor build (+ --devnet rebuild for 4 feature-flagged programs)
  |     [2/3] Verify .so artifacts exist
  |     [3/3] verify-program-ids.ts (keypair <-> declare_id! <-> Anchor.toml)
  |
  +-- Phase 2: deploy.sh
  |     -> Deploys 7 .so files to cluster
  |
  +-- Phase 3: initialize.ts (idempotent, 23 steps)
  |     -> Creates mints, PDAs, pools, vault, whitelist, seeds liquidity
  |     -> Writes pda-manifest.json + pda-manifest.md
  |     -> Burns mint authorities
  |
  +-- Phase 4: verify.ts (36 checks)
  |     -> Validates all accounts exist with correct data
  |     -> Writes deployment-report.md
  |
  +-- Manual post-deploy:
        1. Create ALT (alt-helper.ts)
        2. Copy pda-manifest.json addresses into shared/constants.ts (MANUAL!)
        3. Sync IDLs (cp target/idl/*.json app/idl/)
        4. npm run build (verify frontend compiles)
```

### 1.3 What Exists Already (Leverage Points)

The codebase already has **partial infrastructure** for environment-aware config:

1. **`shared/constants.ts` has `CLUSTER_CONFIG` map** with `devnet` and `mainnet-beta` entries. Mainnet entries use `PublicKey.default` placeholders. The `getClusterConfig(cluster)` function already exists.

2. **`pda-manifest.ts` generates ALL addresses deterministically** from program IDs + mint keys. This is the canonical derivation logic.

3. **`patch-mint-addresses.ts`** already reads keypairs and patches Rust source. Supports both devnet (auto-generated) and mainnet (pre-placed vanity) keypairs.

4. **`build.sh`** already handles `--devnet` flag for feature-gated rebuilds. Without flag = mainnet build.

5. **Mainnet vanity mint keypairs** already generated and git-ignored at `keypairs/mainnet-*-mint.json`.

---

## 2. Recommended Architecture: deployment.json Config System

### 2.1 Core Design: Pipeline Generates, Everything Consumes

The fundamental insight: **`pda-manifest.ts` already derives every address from program IDs + mints.** The deployment.json is just the pda-manifest with additional operational metadata, elevated to be the single source of truth.

```
                    +-------------------------+
                    |   deployment.json       |
                    |   (per-environment)     |
                    +-------------------------+
                    |  cluster: "devnet"      |
                    |  programs: { ... }      |
                    |  mints: { ... }         |
                    |  pdas: { ... }          |
                    |  pools: { ... }         |
                    |  alt: "8Vv3..."         |
                    |  treasury: "8kPz..."    |
                    |  metadata: { uris }     |
                    |  authority: { squads }   |
                    +-------------------------+
                         |          |
            +------------+    +-----+--------+
            |                 |              |
     shared/constants.ts   crank-runner   verify.ts
     (reads at build time)  (reads env)   (reads file)
```

### 2.2 File Location and Structure

**Location:** `deployments/devnet.json`, `deployments/mainnet.json`

Why a separate `deployments/` directory (not `scripts/deploy/`): the deploy scripts are tools, the deployment files are data. Separating them makes gitignore patterns cleaner (mainnet.json should be gitignored since it contains environment-specific addresses that differ per operator).

```typescript
// TypeScript interface for deployment.json
interface DeploymentConfig {
  // Metadata
  cluster: "devnet" | "mainnet-beta";
  generatedAt: string;          // ISO timestamp
  generatedBy: string;          // deploy-all.sh version

  // Programs (7 program IDs)
  programs: {
    amm: string;
    transferHook: string;
    taxProgram: string;
    epochProgram: string;
    staking: string;
    conversionVault: string;
    bondingCurve: string;
  };

  // Mints (3 token mints)
  mints: {
    crime: string;
    fraud: string;
    profit: string;
  };

  // PDAs (all derived PDAs, same shape as pda-manifest.json)
  pdas: Record<string, string>;

  // Pools (pool + vault addresses)
  pools: Record<string, {
    pool: string;
    vaultA: string;
    vaultB: string;
  }>;

  // Operational
  alt: string;                   // Address Lookup Table
  treasury: string;              // Treasury wallet/multisig
  rpcUrl?: string;               // Optional (sensitive, prefer env var)

  // Token Metadata (Arweave URIs)
  metadata: {
    crime: string;               // ar://... URI
    fraud: string;
    profit: string;
  };

  // Authority state (post-deploy tracking)
  authority: {
    type: "deployer" | "squads";
    squadsMultisig?: string;     // Squads multisig address
    squadsVault?: string;        // Squads vault (PDA that holds authority)
    timelockSeconds?: number;    // Current timelock duration
    transferredAt?: string;      // ISO timestamp of authority transfer
  };
}
```

### 2.3 Generation Flow (Modified Pipeline)

The pipeline changes are minimal -- `initialize.ts` already generates `pda-manifest.json`. We extend it to write `deployment.json` instead (superset of pda-manifest):

```
deploy-all.sh (MODIFIED)
  |
  +-- Phase 0: Generate mint keypairs (unchanged)
  |
  +-- Phase 1: build.sh (unchanged)
  |
  +-- Phase 2: deploy.sh (unchanged)
  |
  +-- Phase 3: initialize.ts (MODIFIED)
  |     -> All existing 23 steps unchanged
  |     -> NEW: Writes deployments/{cluster}.json (superset of pda-manifest)
  |     -> KEEPS pda-manifest.json for backward compatibility
  |
  +-- Phase 4: verify.ts (MODIFIED)
  |     -> NEW: Reads from deployments/{cluster}.json instead of pda-manifest.json
  |     -> NEW: Validates deployment.json matches on-chain state
  |     -> Existing 36 checks unchanged
  |
  +-- Phase 5: generate-constants.ts (NEW)
  |     -> Reads deployments/{cluster}.json
  |     -> Generates shared/constants.ts automatically (no manual copy!)
  |     -> Syncs IDLs from target/ to app/idl/
  |
  +-- Phase 6: create-alt.ts (EXISTING, moved into pipeline)
  |     -> Creates/updates ALT
  |     -> Writes ALT address back into deployments/{cluster}.json
  |
  +-- Post-deploy manual steps:
        1. npm run build (verify frontend compiles)
        2. Authority transfer to Squads (separate script, Phase 7 below)
```

### 2.4 Key Integration Points

#### Frontend (`shared/constants.ts`)

**Current:** 594 lines of hand-maintained hardcoded addresses.

**Proposed:** Auto-generated from deployment.json via `generate-constants.ts`:

```typescript
// generate-constants.ts reads deployments/devnet.json and writes shared/constants.ts
// The generated file is checked into git (it's the build artifact)
// Template-based: the file structure stays identical, only addresses change
```

Why generate rather than read at runtime: The frontend is a static Next.js build. `shared/constants.ts` is imported at build time by dozens of files. Making it read a JSON file at runtime would require changing every import site. Generating the TS file preserves the existing import structure.

The `CLUSTER_CONFIG` map in shared/constants.ts already supports devnet/mainnet switching. The generator fills both entries from their respective deployment.json files.

#### Crank Runner

**Current:** Reads `PDA_MANIFEST` env var (JSON string) on Railway.

**Proposed:** Reads `DEPLOYMENT_CONFIG` env var (same JSON, expanded schema). Backward-compatible: the crank runner can fall back to `PDA_MANIFEST` if `DEPLOYMENT_CONFIG` is not set.

#### Verify Script

**Current:** Reads `pda-manifest.json` from disk + re-derives from keypairs.

**Proposed:** Reads `deployments/{cluster}.json`. Can also validate the deployment.json itself (are all fields populated? do derived PDAs match the stored ones?).

#### Build Script (patch-mint-addresses.ts)

**Unchanged.** This reads keypairs directly, not the deployment config. The keypairs are the INPUT to the pipeline; deployment.json is the OUTPUT.

---

## 3. Arweave Metadata Integration

### 3.1 What Needs to Go on Arweave

Each of the 3 tokens needs a metadata JSON file conforming to the Metaplex Token Metadata standard:

```json
{
  "name": "CRIME",
  "symbol": "CRIME",
  "description": "Dr. Fraudsworth's CRIME token...",
  "image": "ar://HASH_OF_IMAGE",
  "external_url": "https://drfraudsworth.com",
  "properties": {
    "category": "fungible",
    "files": [
      { "uri": "ar://HASH_OF_IMAGE", "type": "image/png" }
    ]
  }
}
```

Plus 3 image files (token logos).

### 3.2 Upload Strategy

**Recommended tool: Irys (formerly Bundlr)**

Irys is the standard Arweave upload service for Solana projects. It handles:
- Paying for Arweave storage with SOL (no AR tokens needed)
- Bundled transactions (cheaper, faster than direct Arweave L1)
- Permanent, immutable URIs

**Confidence: MEDIUM** -- Irys/Bundlr was the standard as of my training data. The ecosystem may have shifted. Verify current status before building.

**Alternative: arkb CLI** -- Direct Arweave upload tool. Requires AR tokens. Simpler but less Solana-native.

### 3.3 Upload Script Design

```
scripts/deploy/upload-metadata.ts (NEW)
  |
  +-- Reads token logo PNGs from assets/tokens/
  +-- Uploads images to Arweave via Irys
  +-- Gets image ar:// URIs
  +-- Builds metadata JSON for each token (with image URIs)
  +-- Uploads metadata JSONs to Arweave
  +-- Gets metadata ar:// URIs
  +-- Writes URIs into deployments/{cluster}.json metadata section
```

### 3.4 Where Metadata URIs are Used

**On-chain:** `initialize.ts` Step 1 creates mints with `TokenMetadata` extension. The URI is set at mint creation time via `createInitializeMetadataPointerInstruction` + `createInitializeInstruction`. For mainnet, this means metadata must be uploaded to Arweave BEFORE `initialize.ts` runs.

**This changes the pipeline ordering.** Arweave upload must happen between Phase 0 (generate keypairs) and Phase 3 (initialize). The upload script needs the token names/symbols but NOT the on-chain addresses (those don't exist yet).

Updated pipeline:

```
Phase 0: Generate mint keypairs
Phase 0.5: Upload metadata to Arweave (NEW)  <-- needs logos, produces ar:// URIs
Phase 1: build.sh (reads mint keypairs, patches Rust)
Phase 2: deploy.sh (deploys programs)
Phase 3: initialize.ts (reads ar:// URIs from env/config, creates mints with metadata)
Phase 4: verify.ts
Phase 5: generate-constants.ts
Phase 6: create-alt.ts
```

### 3.5 Metadata URI Configuration

Two options for getting Arweave URIs into `initialize.ts`:

**Option A (recommended): Environment variables**
```bash
CRIME_METADATA_URI=ar://abc123
FRAUD_METADATA_URI=ar://def456
PROFIT_METADATA_URI=ar://ghi789
```
Read from `.env`, passed through `deploy-all.sh`. Simple, works with existing env var pattern.

**Option B: Read from deployment.json**
Initialize.ts reads `deployments/{cluster}.json` metadata section. Creates a chicken-and-egg: deployment.json is supposed to be OUTPUT of the pipeline, but metadata URIs are INPUT. Solvable (upload script writes a partial deployment.json that initialize.ts reads), but more complex.

**Recommendation: Option A.** Keep it simple. Upload script prints the URIs; operator puts them in `.env`. Pipeline reads them. After initialize.ts runs, the URIs are recorded in the full deployment.json.

---

## 4. Squads Authority Transfer Integration

### 4.1 Authority Transfer Basics

Solana programs have an upgrade authority stored in the program's ProgramData account. Transferring authority means calling `bpf_loader_upgradeable::set_authority` with the new authority (Squads vault PDA).

The Squads v4 SDK provides functions to:
1. Create a multisig
2. Create a time-locked vault
3. Propose transactions (including program upgrades)
4. Approve transactions (2-of-3 signing)
5. Execute after timelock

**Confidence: MEDIUM** -- Squads v4 API specifics may have changed. The conceptual flow is well-established. Verify SDK functions against current docs before implementation.

### 4.2 Authority Transfer Flow

```
scripts/deploy/transfer-authority.ts (NEW)
  |
  +-- Reads deployments/{cluster}.json for program IDs
  +-- Reads SQUADS_MULTISIG_ADDRESS from env or config
  +-- For each of the 7 programs:
  |     1. Verify current authority is deployer wallet
  |     2. Call SetAuthority to transfer to Squads vault PDA
  |     3. Verify new authority is Squads vault
  +-- Updates deployments/{cluster}.json authority section
  +-- Writes authority transfer report
```

### 4.3 Where Authority Transfer Fits in Pipeline

Authority transfer is a POST-DEPLOY step, NOT part of the automated pipeline. Reasons:

1. **Irreversible** -- transferring authority to Squads means the deployer wallet can no longer upgrade programs solo. This should be a deliberate, verified step.
2. **Requires multisig creation first** -- the Squads multisig must exist before authority can be transferred.
3. **Only done once per environment** -- not on every deploy.

```
deploy-all.sh          (automated, repeatable)
  Phase 0-6            (build, deploy, init, verify, constants, ALT)

--- MANUAL CHECKPOINT: operator verifies everything works ---

transfer-authority.ts  (manual, one-time per environment)
  For each program:    transfer upgrade authority to Squads vault
```

### 4.4 Squads Setup Script

```
scripts/deploy/setup-squads.ts (NEW)
  |
  +-- Creates Squads v4 multisig (2-of-3)
  +-- Sets timelock duration (2 hours initially)
  +-- Records multisig address + vault address
  +-- Writes to deployments/{cluster}.json authority section
```

**Signer set decision needed** -- the 3 signers for the 2-of-3 multisig must be determined before this script runs. This is a human decision, not a technical one. The script takes signer pubkeys as input.

### 4.5 Practice Runs on Devnet

The deployment-sequence doc and mainnet-readiness-assessment both emphasize testing the full governance flow on devnet first:

1. Create Squads multisig on devnet
2. Transfer devnet program authorities to Squads
3. Propose a program upgrade via Squads
4. Have 2 of 3 signers approve
5. Wait for timelock
6. Execute upgrade
7. Verify program was upgraded

This practice run validates the tooling and the team's familiarity with the governance process before mainnet.

---

## 5. Component Boundaries

### 5.1 New Components

| Component | Type | Location | Responsibility |
|-----------|------|----------|----------------|
| `deployments/{cluster}.json` | Data file | `deployments/` | Single source of truth for all addresses per environment |
| `generate-constants.ts` | Script | `scripts/deploy/` | Reads deployment.json, writes shared/constants.ts |
| `upload-metadata.ts` | Script | `scripts/deploy/` | Uploads logos + metadata JSON to Arweave, outputs URIs |
| `setup-squads.ts` | Script | `scripts/deploy/` | Creates Squads multisig, records addresses |
| `transfer-authority.ts` | Script | `scripts/deploy/` | Transfers program upgrade authorities to Squads vault |
| `verify-authority.ts` | Script | `scripts/deploy/` | Verifies all 7 programs have correct authority (Squads or deployer) |

### 5.2 Modified Components

| Component | Change | Risk |
|-----------|--------|------|
| `initialize.ts` | Read Arweave metadata URIs from env vars; write deployment.json as output | LOW -- additive change, existing 23 steps unchanged |
| `verify.ts` | Read from deployment.json instead of pda-manifest.json; add authority verification | LOW -- same checks, different input source |
| `deploy-all.sh` | Add Phase 5 (generate-constants) and Phase 6 (create-alt) to automated pipeline | LOW -- these are currently manual steps being automated |
| `shared/constants.ts` | Becomes auto-generated (add `// AUTO-GENERATED` header) | MEDIUM -- must verify all consumers still work after generation |

### 5.3 Unchanged Components

Everything on-chain is unchanged. No Rust program modifications for v1.4 deployment infrastructure.

- All 7 Anchor programs
- `build.sh` (already handles devnet/mainnet flags)
- `deploy.sh` (already handles any cluster URL)
- `patch-mint-addresses.ts` (already supports both keypair sources)
- Frontend React components (they import from shared/constants.ts which keeps its shape)

---

## 6. Data Flow: End-to-End Mainnet Deploy

```
PREREQUISITES:
  - 3 token logo PNGs designed and ready
  - 3 Squads signer wallets determined
  - Mainnet RPC URL available (Helius/Triton)
  - Mainnet vanity mint keypairs at keypairs/mainnet-*-mint.json (already done)

STEP 1: Arweave Upload
  Input:  assets/tokens/*.png, token metadata templates
  Tool:   upload-metadata.ts
  Output: ar:// URIs -> .env (CRIME_METADATA_URI, FRAUD_METADATA_URI, PROFIT_METADATA_URI)

STEP 2: Squads Multisig Setup
  Input:  3 signer pubkeys, timelock duration
  Tool:   setup-squads.ts
  Output: Squads multisig address + vault address -> .env or deployment config

STEP 3: Deploy Pipeline (deploy-all.sh without --devnet)
  Phase 0:   Copy mainnet vanity keypairs to scripts/deploy/mint-keypairs/
  Phase 1:   build.sh (no --devnet flag = mainnet build, compile-time guards active)
  Phase 2:   deploy.sh with mainnet RPC
  Phase 3:   initialize.ts (reads ar:// URIs from env, creates mints with metadata)
  Phase 4:   verify.ts (validates all 36+ checks)
  Phase 5:   generate-constants.ts -> writes shared/constants.ts mainnet-beta section
  Phase 6:   create-alt.ts -> creates mainnet ALT, writes to deployment.json

STEP 4: Frontend Build + Deploy
  Input:  Updated shared/constants.ts, synced IDLs
  Tool:   npm run build, Railway deploy
  Output: Frontend reading mainnet addresses

STEP 5: Verification Window (2-3 days)
  - Run crank on mainnet
  - Test all swap paths with small amounts
  - Verify Carnage fires correctly
  - Monitor for errors

STEP 6: Authority Transfer (after verification)
  Input:  deployments/mainnet.json, SQUADS_MULTISIG env var
  Tool:   transfer-authority.ts
  Output: All 7 program authorities -> Squads vault PDA
  Verify: verify-authority.ts confirms all authorities transferred

STEP 7: Ongoing Governance
  - Timelock starts at 2 hours
  - Progressive extension: 2hr -> 24hr -> longer
  - Authority burn only after external audit
```

---

## 7. Environment Switching Design

### 7.1 The One-Swap-to-Rule-Them-All

The goal: switching from devnet to mainnet requires changing ONE thing: the `NEXT_PUBLIC_CLUSTER` env var (or equivalent).

**How it works with deployment.json:**

1. `deployments/devnet.json` -- already populated by prior deploys
2. `deployments/mainnet.json` -- populated by mainnet deploy pipeline
3. `generate-constants.ts` reads BOTH files, populates both entries in `CLUSTER_CONFIG`
4. Frontend reads `NEXT_PUBLIC_CLUSTER` env var to select which config to use
5. Server-side reads `CLUSTER_URL` env var for RPC endpoint

The existing `getClusterConfig(cluster)` function already handles the selection. The only change is that mainnet values are real addresses instead of `PublicKey.default` placeholders.

### 7.2 Crank Runner Environment Switching

Railway env vars change:
- `CLUSTER_URL` -> mainnet RPC
- `DEPLOYMENT_CONFIG` -> contents of `deployments/mainnet.json`
- `WALLET_KEYPAIR` -> mainnet crank wallet (dedicated, NOT deployer)

### 7.3 What Does NOT Change Per Environment

| Item | Why it's environment-independent |
|------|----------------------------------|
| PDA seeds (shared/constants.ts SEEDS) | Same seeds, different program IDs produce different PDAs |
| Fee constants (SOL_POOL_FEE_BPS etc.) | Hardcoded on-chain, same for all environments |
| Token decimals | Always 6 |
| Vault conversion rate | Always 100:1 |
| Valid trading pairs | Same topology everywhere |

---

## 8. Anti-Patterns to Avoid

### Anti-Pattern 1: Runtime Config Loading in Frontend
**What:** Making shared/constants.ts read deployment.json at runtime via fetch()
**Why bad:** 50+ import sites would need async refactoring. Build-time constants enable dead-code elimination and type checking.
**Instead:** Generate shared/constants.ts at build time from deployment.json. Keep static imports.

### Anti-Pattern 2: Deployment Config in Git (Mainnet)
**What:** Checking deployments/mainnet.json into git
**Why bad:** Contains environment-specific addresses that may differ across operators. Also creates temptation to commit sensitive RPC URLs.
**Instead:** Gitignore mainnet.json. Keep devnet.json in git (it's shared). Generate mainnet.json during deploy. The generated shared/constants.ts IS committed (it's the build artifact).

### Anti-Pattern 3: Authority Transfer in Automated Pipeline
**What:** Including transfer-authority.ts in deploy-all.sh
**Why bad:** Authority transfer is irreversible. Accidentally running the full pipeline would lock out the deployer.
**Instead:** Keep authority transfer as a separate, manual, one-time step with explicit confirmation.

### Anti-Pattern 4: Circular Dependency Between Deployment Config and Pipeline
**What:** Pipeline reads deployment.json to know what to deploy, but deployment.json is output of pipeline
**Why bad:** Chicken-and-egg. Which comes first?
**Instead:** Pipeline inputs are: keypairs (mint + program), env vars (.env), cluster URL. Pipeline output is: deployment.json. Direction is one-way.

### Anti-Pattern 5: Splitting Metadata Upload and Mint Creation
**What:** Uploading to Arweave during one session, creating mints days later
**Why bad:** The URI must be set at mint creation time (TokenMetadata extension). If you lose the URIs between sessions, you have to re-upload or dig them out of Arweave.
**Instead:** Upload script writes URIs to .env immediately. Initialize.ts reads them. Keep the gap minimal, or record URIs in a persistent file (partial deployment.json).

---

## 9. Suggested Build Order

Based on dependency analysis:

### Phase A: Deployment Config Foundation (No External Dependencies)
1. **Define DeploymentConfig TypeScript interface** -- the schema
2. **Modify initialize.ts** to write `deployments/{cluster}.json` alongside existing pda-manifest.json
3. **Create generate-constants.ts** to read deployment.json and write shared/constants.ts
4. **Modify deploy-all.sh** to include Phase 5 (generate-constants) and Phase 6 (ALT in pipeline)
5. **Modify verify.ts** to read from deployment.json

**Why first:** Everything else depends on the config system. No external tools needed. Pure refactoring of existing data flow.

### Phase B: Arweave Metadata (Needs Token Logos)
1. **Design token logos** (blocking -- human creative work)
2. **Create upload-metadata.ts** script
3. **Modify initialize.ts** to read metadata URIs from env vars
4. **Test on devnet** with test metadata

**Why second:** Needs logos (creative dependency). Upload script is independent of Squads. Testing on devnet validates the URI flow before mainnet.

### Phase C: Squads Multisig (Needs Signer Decisions)
1. **Determine signer set** (blocking -- human decision)
2. **Create setup-squads.ts** script
3. **Create transfer-authority.ts** script
4. **Create verify-authority.ts** script
5. **Practice run on devnet** -- full governance cycle

**Why third:** Needs human decisions (signer set). Independent of Arweave. Practice run validates the governance process.

### Phase D: Fresh Devnet Lifecycle Test
1. **Delete existing devnet state** (new deploy from scratch)
2. **Run full pipeline** with deployment.json config system
3. **Verify everything works** -- swaps, staking, Carnage, crank
4. **Transfer devnet authorities to Squads** (practice run)

**Why fourth:** Integration test of A + B + C together. Catches any gaps before mainnet.

### Phase E: Mainnet Deployment
1. **Copy mainnet vanity keypairs** to mint-keypairs/
2. **Run deploy-all.sh** without --devnet
3. **Verify** -- all paths, small amounts
4. **Transfer authorities to Squads**
5. **Go live**

### Dependency Graph

```
Phase A (config) ----+
                     |
Phase B (arweave) ---+--> Phase D (lifecycle test) --> Phase E (mainnet)
                     |
Phase C (squads) ----+
```

A, B, and C can be parallelized (B and C are independent of each other; both depend on A for the deployment.json schema but not the implementation). D requires all three. E requires D.

---

## 10. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| generate-constants.ts produces subtly wrong shared/constants.ts | HIGH | Diff check: generated file must match expected shape. Test by running full E2E after generation. |
| Arweave upload tool (Irys/Bundlr) API has changed | MEDIUM | Verify current SDK before building upload-metadata.ts. Have fallback (arkb CLI). |
| Squads v4 SDK API has changed | MEDIUM | Verify against current docs. Start with devnet practice. |
| Manual copy of mainnet vanity keypairs is forgotten | HIGH | Add explicit check in deploy-all.sh Phase 0: if building for mainnet, require keypairs/mainnet-*-mint.json. |
| Timelock too short allows hasty upgrades | LOW | Start at 2 hours (fast enough for emergencies, slow enough to prevent impulse). Progressive extension documented. |
| deployment.json gets out of sync with on-chain state | MEDIUM | verify.ts already validates against on-chain. Add "config freshness" check: warn if deployment.json is older than latest deploy log. |

---

## Sources

- **HIGH confidence (codebase analysis):**
  - `scripts/deploy/deploy-all.sh` -- current pipeline structure
  - `scripts/deploy/initialize.ts` -- 23-step initialization, pda-manifest generation
  - `scripts/deploy/lib/pda-manifest.ts` -- PDA derivation logic
  - `shared/constants.ts` -- current address configuration, CLUSTER_CONFIG pattern
  - `scripts/deploy/verify.ts` -- current verification checks
  - `scripts/deploy/patch-mint-addresses.ts` -- Rust constant patching
  - `scripts/deploy/build.sh` -- build process with devnet feature flag
  - `Docs/mainnet-checklist.md` -- manual sync steps documented
  - `Docs/mainnet-readiness-assessment.md` -- blocker analysis
  - `Docs/deployment-sequence.md` -- full deployment documentation

- **MEDIUM confidence (training data, not live-verified):**
  - Squads v4 multisig SDK -- conceptual flow verified, specific API calls need validation
  - Irys/Bundlr for Arweave uploads -- was standard tool, may have changed
  - Arweave permanent storage model -- well-established, unlikely to have changed
  - Metaplex token metadata JSON standard -- well-established
