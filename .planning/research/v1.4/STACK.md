# Technology Stack: v1.4 Pre-Mainnet

**Project:** Dr. Fraudsworth's Finance Factory
**Researched:** 2026-03-12
**Focus:** Stack additions for Squads multisig, Arweave metadata, canonical deployment config, mainnet deployment tooling

## Important: Confidence Disclaimer

This research was conducted WITHOUT access to WebSearch or WebFetch (tool permissions denied in subagent context). All version numbers and API details are based on training data (cutoff ~May 2025) and MUST be verified with live sources before implementation. The orchestrator should supplement this with Exa searches for current package versions.

---

## Recommended Stack Additions

### 1. Squads v4 Multisig SDK

| Technology | Version | Purpose | Confidence |
|------------|---------|---------|------------|
| `@sqds/multisig` | ^2.1.x | Create/manage Squads v4 multisig, proposals, timelocks | MEDIUM |

**Why `@sqds/multisig` (not `@sqds/sdk`):**
- `@sqds/sdk` is the v3 SDK (deprecated). Squads v4 is the current protocol with the `@sqds/multisig` package.
- v4 is built on Squads Multisig Program v4 (SMPL v4), which is the audited, mainnet-deployed version.
- v4 introduced native timelock functionality (called "Time Lock" in their system) -- critical for the authority strategy documented in PROJECT_BRIEF.md (2hr -> 24hr -> burn).

**Key API surface (verify with current docs):**

```typescript
import * as multisig from "@sqds/multisig";

// Create a 2-of-3 multisig with timelock
const multisigPda = multisig.getMultisigPda({ createKey })[0];
await multisig.rpc.multisigCreateV2({
  createKey,
  creator,
  multisigPda,
  configAuthority: null, // immutable config
  timeLock: 7200,        // 2 hours in seconds (launch)
  threshold: 2,
  members: [
    { key: member1, permissions: multisig.types.Permissions.all() },
    { key: member2, permissions: multisig.types.Permissions.all() },
    { key: member3, permissions: multisig.types.Permissions.all() },
  ],
  rentCollector: null,
});

// Create a proposal to upgrade a program
const transactionIndex = 1n;
await multisig.rpc.vaultTransactionCreate({
  multisigPda,
  transactionIndex,
  creator: member1,
  vaultIndex: 0,
  // ... transaction message with BPF upgrade instruction
});

// Approve + execute
await multisig.rpc.proposalApprove({ multisigPda, transactionIndex, member: member2 });
await multisig.rpc.vaultTransactionExecute({ multisigPda, transactionIndex, member: member1 });
```

**Dependency compatibility:**
- `@sqds/multisig` depends on `@solana/web3.js` v1.x (same as project's ^1.95.5). No conflict.
- Uses `@coral-xyz/anchor` internally but re-exports what it needs. No version conflict with project's ^0.32.1.

**Where it goes:** Root `package.json` (deployment scripts), NOT `app/package.json` (frontend never touches multisig).

**Verification needed (LOW confidence):**
- Exact latest version number (could be 2.0.x, 2.1.x, or higher)
- Whether `timeLock` parameter exists on `multisigCreateV2` or requires separate config
- Whether v4 supports changing timelock duration after creation (for the progressive increase strategy)

---

### 2. Arweave Metadata Upload

| Technology | Version | Purpose | Confidence |
|------------|---------|---------|------------|
| `@irys/sdk` | ^0.2.x | Upload token metadata JSON + images to Arweave via Irys (formerly Bundlr) | MEDIUM |

**Why Irys (not direct Arweave or Metaplex Sugar):**

1. **Direct Arweave (`arweave` npm):** Requires AR tokens, slow confirmation (minutes), complex wallet management. Overkill for uploading 3 metadata files + 3 images.

2. **Metaplex Sugar CLI:** Designed for NFT collections (candy machine). Wrong tool for Token-2022 fungible metadata. Sugar generates collection-oriented JSON, not the simple token metadata format we need.

3. **Irys (formerly Bundlr):** Pay with SOL, instant upload, permanent Arweave storage. Upload 6 files (3 JSON + 3 images) for pennies. Simple API. This is what most Solana projects use for token metadata.

4. **Alternative: `@metaplex-foundation/umi` + `@metaplex-foundation/umi-uploader-irys`:** Metaplex's abstraction over Irys. Adds UMI framework dependency (large). Only worth it if we need other Metaplex operations. We do not -- our mints already exist with MetadataPointer extension. We just need to upload the JSON the URI points to.

**Recommendation: Use `@irys/sdk` directly.** Minimal dependency, does exactly what we need.

**Usage pattern:**

```typescript
import Irys from "@irys/sdk";

// Initialize with SOL payment
const irys = new Irys({
  url: "https://node1.irys.xyz",  // mainnet
  token: "solana",
  key: walletKeypair.secretKey,
  config: { providerUrl: "https://api.mainnet-beta.solana.com" },
});

// Fund the node (pennies for small files)
await irys.fund(irys.utils.toAtomic(0.01)); // 0.01 SOL

// Upload image first
const imageReceipt = await irys.uploadFile("./assets/crime-logo.png", {
  tags: [{ name: "Content-Type", value: "image/png" }],
});
const imageUrl = `https://arweave.net/${imageReceipt.id}`;

// Upload metadata JSON pointing to image
const metadata = {
  name: "CRIME",
  symbol: "CRIME",
  description: "Dr. Fraudsworth's CRIME token",
  image: imageUrl,
};
const metadataReceipt = await irys.upload(JSON.stringify(metadata), {
  tags: [{ name: "Content-Type", value: "application/json" }],
});
const metadataUrl = `https://arweave.net/${metadataReceipt.id}`;
// This URL goes into the Token-2022 metadata URI field
```

**Token-2022 metadata update flow:**
The mints already have `MetadataPointer` extension (confirmed in initialize.ts). To update the URI to point to the Arweave URL, use `tokenMetadataUpdateField` from `@solana/spl-token` (already in devDependencies). No new on-chain program needed.

**Where it goes:** Root `package.json` as a devDependency (one-time upload script, not runtime).

**Verification needed (LOW confidence):**
- Irys SDK has undergone multiple rebrands (Bundlr -> Irys) and API changes. The import path and initialization may have changed.
- The `@irys/sdk` package name may now be `@irys/web-bundlr` or similar. Need to check npm.
- Pricing model -- Irys moved to a "pay per upload" model, may not require pre-funding anymore.
- Alternative: `@irys/upload` and `@irys/upload-solana` may be the current recommended packages (newer, lighter).

---

### 3. Canonical Deployment Config System

| Technology | Version | Purpose | Confidence |
|------------|---------|---------|------------|
| No new dependencies | N/A | Refactor existing `shared/constants.ts` + `CLUSTER_CONFIG` | HIGH |

**Why no new library:**
The project already has 90% of the config system in place:
- `shared/constants.ts` has `CLUSTER_CONFIG` with devnet/mainnet-beta variants
- `getClusterConfig()` resolver exists
- `NEXT_PUBLIC_CLUSTER` env var pattern is documented
- `pda-manifest.json` is the deploy-time source of truth

**What's missing (build, don't buy):**
1. A `scripts/deploy/populate-mainnet-config.ts` that reads mainnet `pda-manifest.json` and fills in the `MAINNET_PLACEHOLDER_KEY` values in `shared/constants.ts`
2. Rename `DEVNET_*` exports to cluster-agnostic names (or deprecate them in favor of `getClusterConfig()`)
3. A validation script that asserts no `PublicKey.default` values remain in the active cluster config

**Architecture:**
```
pda-manifest.json (deploy output)
       |
       v
populate-mainnet-config.ts (one-time script)
       |
       v
shared/constants.ts (CLUSTER_CONFIG["mainnet-beta"] filled)
       |
       v
getClusterConfig(process.env.NEXT_PUBLIC_CLUSTER)
       |
       +---> Frontend (app/)
       +---> Crank runner (scripts/crank/)
       +---> Deploy scripts (scripts/deploy/)
```

This is pure refactoring of existing code. No npm packages needed.

---

### 4. Credential/Secret Management

| Technology | Version | Purpose | Confidence |
|------------|---------|---------|------------|
| No new dependencies | N/A | Pattern enforcement, not a library | HIGH |

**Why no secrets manager library:**
This is a Solana project deploying 7 programs with a 3-person team. The secrets are:
- Deployer keypair (used once for mainnet deploy)
- Multisig member keypairs (3 hardware wallets ideally)
- Helius mainnet API key (env var on Railway)
- Crank runner wallet keypair (env var on Railway)

These are all adequately handled by:
1. `.env` files (gitignored, already in `.gitignore`)
2. Railway environment variables (already used for crank)
3. Hardware wallets for multisig members (Ledger/Trezor via Solana CLI `--keypair usb://ledger`)
4. The existing `WALLET_KEYPAIR` env var pattern from the crank runner

**What to build (not buy):**
- A `scripts/deploy/mainnet-preflight.ts` that checks:
  - No keypair files in git staging area
  - `.env` contains all required vars for the target cluster
  - Deployer wallet has sufficient SOL balance
  - All program binaries match expected hashes
- Add `keypairs/` to `.gitignore` (currently only `keypairs/mainnet-*` is ignored -- devnet keypairs are committed)

**Anti-recommendation: Do NOT add:**
- HashiCorp Vault, AWS Secrets Manager, or similar -- massive overkill for this project
- `dotenv` npm package -- Node 20+ has native `--env-file` support, and the project already uses `set -a && source .env` pattern

---

### 5. Mainnet Deployment Tooling

| Technology | Version | Purpose | Confidence |
|------------|---------|---------|------------|
| `solana-cli` | v3.0.x (Agave) | Program deployment to mainnet | HIGH |
| `anchor-cli` | 0.32.1 | Build + deploy Anchor programs | HIGH |
| No new npm packages | N/A | Extend existing deploy-all.sh | HIGH |

**Why no new tooling:**
The project already has a battle-tested deployment pipeline (`deploy-all.sh`) that handles:
- Mint keypair generation (Phase 0)
- Feature-flagged builds (Phase 1)
- Program deployment (Phase 2)
- Idempotent initialization (Phase 3)
- Verification (Phase 4)

**What to extend (not replace):**
1. Add `--mainnet` flag to `build.sh` (currently only `--devnet`)
2. Add mainnet RPC URL support to `deploy.sh` and `deploy-all.sh`
3. Add Phase 5: "Transfer authorities to Squads multisig" after verify
4. Add Phase 6: "Upload metadata to Arweave" after authority transfer
5. Mainnet-specific safety gates:
   - Require explicit `--mainnet-i-am-sure` flag
   - Display SOL cost estimate before proceeding
   - Require program binary hash verification against local build

**Solana program deploy costs (mainnet):**
- Each program deploy costs roughly `program_size_bytes * 2 / 1e9 * rent_per_byte` SOL for rent-exemption
- For 7 programs totaling ~800KB, expect ~6-8 SOL in rent
- Plus transaction fees (~0.01 SOL total)
- Budget 10 SOL minimum for deployment wallet

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Multisig | `@sqds/multisig` (v4) | Marinade Native Staking multisig, SPL Governance | Squads v4 is the de facto standard for Solana program authority management. SPL Governance is for DAOs, not operational multisig. |
| Multisig | `@sqds/multisig` (v4) | Realms (SPL Governance) | Realms is governance theater for 3-person team. Squads is purpose-built for upgrade authority + timelock. |
| Metadata upload | Irys (direct) | Metaplex Sugar CLI | Sugar is for NFT candy machines, not fungible token metadata. |
| Metadata upload | Irys (direct) | UMI + umi-uploader-irys | UMI adds large framework dependency for a one-time upload of 6 files. Irys SDK is sufficient. |
| Metadata upload | Irys (direct) | Shadow Drive (GenesysGo) | Shadow Drive has had availability issues. Arweave via Irys is the proven permanent storage. |
| Metadata upload | Irys (direct) | IPFS (Pinata/nft.storage) | IPFS requires pinning services (recurring cost, availability risk). Arweave is permanent, pay-once. |
| Config system | Refactor existing | `@solana/web3.js` v2 config patterns | web3.js v2 is a complete rewrite with breaking changes. Not worth migrating for config alone. Revisit post-launch. |
| Secrets | Env vars + .gitignore | Doppler, 1Password CLI | Overkill for 3-person team with one deployment target (Railway). |

---

## What NOT to Add

These are technologies that might seem relevant but should be explicitly avoided:

| Technology | Why Avoid |
|------------|-----------|
| `@solana/web3.js` v2 | Complete API rewrite, would require rewriting every transaction builder. v1.x works fine. |
| `@metaplex-foundation/js` | Deprecated in favor of UMI. Even UMI is overkill -- we just need file upload. |
| `@metaplex-foundation/mpl-token-metadata` | This is for the Metaplex Token Metadata Program (separate program). Our mints use Token-2022's native metadata extension. We do NOT need a separate metadata account. |
| `dotenv` | Node 22 (project requirement) supports `--env-file`. Existing `source .env` pattern works. |
| Any CI/CD platform SDK | Deploy is manual (intentional for mainnet safety). No GitHub Actions for deployment. |
| `@solana/spl-governance` | Wrong tool. Squads is for operational multisig, not DAO governance. |
| Terraform/Pulumi | Infrastructure is Railway (already configured). No IaC needed. |

---

## Installation Plan

```bash
# Root package.json — deployment tooling
cd "/Users/mlbob/Projects/Dr Fraudsworth"
npm install @sqds/multisig          # Squads v4 multisig SDK
npm install -D @irys/sdk            # Arweave upload (dev dep — one-time script)

# app/package.json — NO CHANGES
# Frontend does not interact with multisig or metadata upload
```

**Total new dependencies: 2 packages** (keeping the dependency footprint minimal).

---

## Integration Points with Existing Stack

### Squads + Existing Deploy Pipeline
```
deploy-all.sh Phase 2 (deploy programs)
    |
    v
deploy-all.sh Phase 3 (initialize -- creates mints, pools, etc.)
    |
    v
deploy-all.sh Phase 4 (verify)
    |
    v
NEW Phase 5: scripts/deploy/transfer-to-multisig.ts
    - Creates Squads 2-of-3 multisig with 2hr timelock
    - Transfers upgrade authority for all 7 programs
    - Transfers mint authority (if not already burned by init)
    - Outputs multisig address to pda-manifest.json
    |
    v
NEW Phase 6: scripts/deploy/upload-metadata.ts
    - Uploads 3 token images to Arweave via Irys
    - Uploads 3 metadata JSON files pointing to images
    - Updates Token-2022 metadata URI for each mint
    - (Must happen before mint authority transfer/burn)
```

### Irys + Existing Token-2022 Mints
```
initialize.ts already creates mints with:
    - MetadataPointer extension (pointing to self)
    - TokenMetadata with name/symbol/uri

upload-metadata.ts will:
    1. Upload images -> get Arweave URLs
    2. Upload JSON metadata -> get Arweave URLs
    3. Call tokenMetadataUpdateField to set uri = Arweave URL
    4. This uses @solana/spl-token (already installed)
```

### Config Refactor + Existing CLUSTER_CONFIG
```
Current: shared/constants.ts has CLUSTER_CONFIG["mainnet-beta"] with placeholders
After:   populate-mainnet-config.ts reads pda-manifest.json, fills placeholders
Result:  getClusterConfig("mainnet-beta") returns real addresses
```

---

## Version Verification Checklist

**CRITICAL: Before implementation, the orchestrator MUST verify these with Exa:**

| Package | Claimed Version | Verify At | Risk if Wrong |
|---------|----------------|-----------|---------------|
| `@sqds/multisig` | ^2.1.x | npmjs.com/package/@sqds/multisig | Wrong API, build failure |
| `@irys/sdk` | ^0.2.x | npmjs.com/package/@irys/sdk | Package may be renamed |
| Squads v4 program ID | `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf` | docs.squads.so | Wrong PID = wrong PDAs |
| Irys node URL | `https://node1.irys.xyz` | docs.irys.xyz | Upload failure |
| Token-2022 `tokenMetadataUpdateField` | exists in @solana/spl-token 0.4.x | solana-labs/solana-program-library | If missing, need alternative update path |

---

## Sources

- **HIGH confidence:** Existing codebase analysis (`shared/constants.ts`, `package.json`, `deploy-all.sh`, `mainnet-checklist.md`, `initialize.ts`)
- **HIGH confidence:** `PROJECT_BRIEF.md` decisions on authority strategy, timelock tiers
- **MEDIUM confidence:** Squads v4 SDK API surface (from training data, May 2025 cutoff -- Squads v4 was well-established by then)
- **MEDIUM confidence:** Irys SDK for Arweave upload (from training data -- Irys/Bundlr rebranding was completed by early 2025)
- **LOW confidence:** Exact version numbers for `@sqds/multisig` and `@irys/sdk` (must verify with npm/docs)
- **LOW confidence:** Whether Irys SDK import path has changed since training cutoff
