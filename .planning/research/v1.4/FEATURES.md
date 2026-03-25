# Feature Landscape: v1.4 Pre-Mainnet

**Domain:** Solana DeFi protocol mainnet deployment infrastructure
**Researched:** 2026-03-12
**Confidence:** MEDIUM (training knowledge for Squads/Arweave patterns; HIGH for project-specific features based on codebase review)

---

## Table Stakes

Features users/community expect. Missing = protocol feels unfinished or untrustworthy.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Squads 2-of-3 multisig holding upgrade authority** | Every serious Solana DeFi protocol uses multisig governance for upgrade authorities. Single-wallet authority = immediate red flag for any user checking on-chain. Rug risk perception. | Medium | Squads v4 SDK. 7 programs need authority transfer. Devnet practice run essential. |
| **Token metadata on permanent storage (Arweave)** | Wallets (Phantom, Solflare, Backpack) and explorers (Solscan, SolanaFM) display token name, symbol, logo from on-chain metadata URI. Missing/broken metadata = tokens show as "Unknown Token" with no logo. Destroys first impression. | Low-Medium | JSON + image upload to Arweave. URI set during mint creation via Token-2022 TokenMetadata extension (already in initialize.ts). |
| **Correct token logos** | Every legitimate token has a recognizable logo in wallets and explorers. Missing logo = scam perception. | Low (design) | PNG/SVG, typically 256x256 or 512x512. Must be uploaded to Arweave alongside metadata JSON. |
| **Environment-aware deployment config** | Hardcoded devnet addresses in mainnet frontend = broken app. `?cluster=devnet` in explorer links on mainnet = embarrassing. Faucet links on mainnet = confusing. | Low | Already tracked in mainnet-checklist.md. Mechanical find-and-replace + env var system. |
| **Fresh devnet lifecycle test** | Validates the full deploy pipeline works end-to-end before touching mainnet. Catches config drift, stale keypairs, missed steps. | Medium | Full deploy-all.sh run with all 7 programs. Epoch cycling, Carnage firing, swaps, staking, bonding curve -- complete lifecycle. |
| **Mainnet ALT creation** | Protocol requires Address Lookup Table for oversized sell-path transactions (23 + 8 accounts). Without ALT, sell transactions fail with size limit errors. | Low | alt-helper.ts already exists. Just needs mainnet addresses. |
| **IDL sync after mainnet build** | Stale IDLs caused all swaps to fail during Phase 51 redeployment. Lesson learned the hard way. | Low | Automated in deploy-all.sh. But must verify IDL `address` fields match mainnet program IDs. |
| **Sensitive data rotation** | Devnet keys reused on mainnet = security incident waiting to happen. Fresh keypairs, API keys, webhook secrets required. | Low | Checklist item. No code changes. |
| **BcAdminConfig initialization in deploy pipeline** | DEPLOY-GAP-01 from v1.3. Bonding curve admin config not automated in initialize.ts. Manual step = forgotten step. | Low | Add to initialize.ts. Pattern identical to existing AdminConfig init. |
| **Mainnet program deployment** | Obviously required. Build without --devnet flag, deploy all 7 programs, initialize. | Medium | compile_error! macros enforce mainnet addresses are set. Two-pass deploy for feature-flagged programs. |
| **Timelocked upgrade proposals** | Squads timelock on upgrade proposals gives community visibility into pending changes. Without timelock, multisig signers could instantly upgrade programs (defeats purpose). | Medium | Squads v4 supports time locks natively. Config during multisig creation. |
| **Crank wallet mainnet funding** | Crank bot needs real SOL for transaction fees + Carnage execution. Underfunded crank = dead protocol. | Low | Manual SOL transfer. Budget documented: ~5 SOL covers months. |

## Differentiators

Features that set the protocol apart. Not strictly expected, but create trust and polish.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Vanity mint addresses** | CRIME starts with `cRiME`, FRAUD with `FraUd`, PROFIT with `pRoFiT`. Adds brand recognition when users see addresses in explorers/wallets. Very few projects do this. | DONE | Keypairs already generated (keypairs/mainnet-*-mint.json). Just need to use them during mainnet mint creation. |
| **Progressive timelock extension** | Start at 2hr, extend to 24hr after 48-72hrs stable, then eventual burn post-audit. Shows commitment to decentralization without risking inability to patch. | Low | Squads v4 supports changing timelock duration via proposal. Document the schedule publicly. |
| **Compile-time mainnet guards** | `compile_error!` macros prevent accidentally deploying with placeholder addresses. Defense-in-depth for deployment. | DONE | Already implemented in v1.3. |
| **Pre-launch verification suite** | Automated triple-verification of whitelist completeness, all swap paths, pool reserves, vault balances before going live. | Low | verify.ts already does 36 checks. Extend for mainnet-specific validation. |
| **Bug bounty program (Immunefi)** | Signals confidence in code quality. Gives security researchers incentive to report rather than exploit. | Low | Immunefi listing is administrative, not technical. Scope definition is the work. |
| **Public authority governance documentation** | Publish the Squads multisig address, signer identities (or pseudonyms), timelock config, and burn schedule. Radical transparency for a memecoin. | Low | Documentation only. But the transparency itself is the differentiator. |
| **Overnight mainnet soak test** | Run mainnet for 24hrs with small amounts before public launch. Validates priority fees, CU budgets, crank economics in production environment. | Medium | Requires careful SOL budgeting. Can run with tiny pool liquidity. |

## Anti-Features

Features to explicitly NOT build. Common mistakes in this domain.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Burning authorities before external audit** | Protocol manages real SOL. Three internal audits are strong but not equivalent to independent verification. Burning = no ability to patch critical bugs. | Retain behind timelocked Squads multisig. Burn only post-external-audit. Already decided (PROJECT_BRIEF). |
| **Emergency pause mechanism** | Adds centralization vector. If you can pause, you can rug. Contradicts the "unkillable protocol" thesis. | Retained upgrade authority provides the safety net. SEC-06 already DECLINED. |
| **Governance token / DAO at launch** | Premature governance adds complexity, attack surface, and regulatory risk. Protocol parameters are simple enough to not need governance. | Fixed parameters. Authority burn is the endgame. Governance only if needed post-burn (unlikely given design). |
| **Custom metadata hosting** | Railway endpoints for metadata are a single point of failure. Server goes down = tokens show "Unknown" in wallets. | Arweave is permanent, decentralized storage. Upload once, works forever. This is the standard approach. |
| **Token-list registry submission before launch** | Jupiter, Raydium token lists require trading history and liquidity verification. Submitting prematurely gets rejected. | Launch first, accumulate organic trading volume, then submit to aggregator token lists. |
| **Multi-region crank deployment** | Overengineering. Single Railway instance with auto-restart is sufficient. Permissionless recovery means anyone can crank if primary fails. | Keep single-instance crank. Monitor with Sentry. Budget for occasional missed epochs (graceful degradation). |
| **Automated authority burn timer** | On-chain timer that auto-burns authorities creates irreversible risk. What if a critical bug is found at hour 47 of a 48hr timer? | Manual burn via Squads proposal. Human judgment in the loop for an irreversible action. |

---

## Feature Deep Dives

### 1. Squads v4 Multisig Setup

**What it is:** Squads Protocol v4 is the standard Solana multisig solution. It creates an on-chain multisig that can hold program upgrade authorities, execute timelocked transactions, and require M-of-N approvals.

**Confidence:** MEDIUM (based on training knowledge of Squads v4 architecture; web verification was unavailable)

**Required steps:**

1. **Create Squads multisig (2-of-3)**
   - Choose 3 signer wallets (hardware wallets strongly recommended for mainnet)
   - Set threshold to 2 (any 2 of 3 must approve)
   - Configure time lock (start at 2 hours per PROJECT_BRIEF)
   - The multisig creates a Vault PDA that becomes the new authority

2. **Transfer upgrade authority for all 7 programs**
   - For each program: `solana program set-upgrade-authority <PROGRAM_ID> --new-upgrade-authority <SQUADS_VAULT>`
   - This is a one-way operation (authority transfers from deployer wallet to Squads vault)
   - Must be done AFTER all deployment and initialization is complete
   - Order: deploy all 7 programs -> initialize everything -> verify -> THEN transfer authorities

3. **Practice the governance flow on devnet**
   - Create a test proposal to upgrade one program
   - Have 2 of 3 signers approve
   - Wait for timelock to expire
   - Execute the upgrade
   - This catches any misunderstandings before mainnet

4. **Burn sequence (post-audit, future milestone)**
   - Whitelist authority -> AMM admin -> upgrade authorities
   - Each burn is a separate Squads proposal
   - Burn is `SetAuthority` to `None` (or Squads' built-in burn mechanism)

**Dependency:** None. Can be done in parallel with other v1.4 work. But must be the LAST step before going live (after all programs deployed and initialized).

**Complexity notes:**
- Squads v4 has both a web UI (app.squads.so) and an SDK (@sqds/multisig)
- The web UI is sufficient for setup and daily operations
- SDK is needed if we want to script authority transfers
- Squads v4 supports devnet -- test everything there first

### 2. Token Metadata on Arweave

**What it is:** Solana tokens store metadata (name, symbol, logo) as a JSON file at a URI. The URI is stored on-chain in the token's metadata. Wallets and explorers fetch this URI to display token information.

**Confidence:** HIGH for the metadata JSON format (well-established Metaplex standard). MEDIUM for Arweave upload tooling specifics (could not verify current tooling).

**Token-2022 metadata approach (already implemented):**

The project already uses Token-2022's native `TokenMetadata` extension (via `MetadataPointer`). This stores name, symbol, and URI directly on the mint account. The `initialize.ts` script already sets these during mint creation:

```typescript
tokenMetadataInitializeWithRentTransfer(
  connection,
  authority,       // payer
  mint,            // mint address
  authority,       // update authority
  authority,       // mint authority signer
  name,            // e.g., "CRIME"
  symbol,          // e.g., "CRIME"
  uri,             // metadata JSON URI
);
```

Currently points to Railway placeholder: `https://dr-fraudsworth-production.up.railway.app/api/metadata/crime`

**Off-chain metadata JSON format (Metaplex standard):**

```json
{
  "name": "CRIME",
  "symbol": "CRIME",
  "description": "Dr. Fraudsworth's CRIME token. One half of the dual-faction DeFi protocol.",
  "image": "https://arweave.net/<IMAGE_TX_ID>",
  "external_url": "https://drfraudsworth.com",
  "properties": {
    "category": "currency",
    "creators": []
  },
  "extensions": {
    "website": "https://drfraudsworth.com",
    "twitter": "https://twitter.com/DrFraudsworth"
  }
}
```

**Required fields (wallets will display):**
| Field | Required | What It Does |
|-------|----------|-------------|
| `name` | YES | Token name in wallet list |
| `symbol` | YES | Ticker symbol (CRIME, FRAUD, PROFIT) |
| `image` | YES | Token logo URL (PNG/SVG, 256x256 or 512x512 recommended) |
| `description` | Strongly recommended | Shows in token detail views |
| `external_url` | Recommended | Links to project website |

**Optional but nice:**
| Field | Purpose |
|-------|---------|
| `extensions.website` | Some explorers show this separately |
| `extensions.twitter` | Social link in explorer profile |
| `properties.category` | "currency" for fungible tokens |
| `animation_url` | Animated logo (overkill for fungible tokens) |

**Upload workflow:**
1. Design 3 token logos (CRIME, FRAUD, PROFIT) -- PNG 512x512
2. Upload images to Arweave (returns permanent `arweave.net/<TX_ID>` URLs)
3. Create 3 metadata JSON files with image URLs
4. Upload JSON files to Arweave (returns permanent URIs)
5. Update `initialize.ts` token metadata URIs to Arweave JSON URLs
6. On mainnet mint creation, the permanent URIs are baked in

**Arweave upload options:**
- **Irys (formerly Bundlr):** Most popular Arweave upload tool for Solana projects. Pay with SOL. CLI and SDK available.
- **ArDrive:** Web UI for manual uploads. Simpler but less scriptable.
- **Direct Arweave:** Upload with AR tokens. More friction (need AR wallet).

**Recommendation:** Use Irys. It accepts SOL payment, has good SDK, and is the standard for Solana token metadata uploads. Cost is negligible (a few KB of JSON + images = fractions of a cent).

**Important: Metadata update authority.** Token-2022's TokenMetadata extension has an `update_authority` field. Since we burn mint authority but want to potentially update metadata URI later (e.g., to fix a logo), we need to decide:
- Keep metadata update authority with Squads multisig (allows URI updates)
- Burn metadata update authority (fully immutable, even metadata)
- **Recommendation:** Keep with Squads multisig initially. Metadata is cosmetic (not financial), and being unable to fix a broken logo is unnecessarily rigid.

### 3. Deployment Configuration System

**What it is:** Environment-aware addressing so the same codebase works for devnet, mainnet-beta, and localnet without manual constant swapping.

**Confidence:** HIGH (this is a project-specific feature with clear existing patterns in the codebase)

**Current state:**
- On-chain: `#[cfg(feature = "devnet")]` / `#[cfg(feature = "localnet")]` / `#[cfg(not(any(...)))]` feature flags handle compile-time address selection (already working)
- Frontend: `DEVNET_*` prefixed constants in `shared/constants.ts` and `shared/programs.ts` -- these need to become environment-aware
- Mainnet checklist already documents all 12 sections of switch-points

**Recommended approach:**

```typescript
// shared/constants.ts
const CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "devnet";

export const PROGRAM_IDS = CLUSTER === "mainnet-beta" ? {
  AMM: "...",
  Hook: "...",
  // ...
} : {
  AMM: "5ANTH...",
  Hook: "CmNyu...",
  // ...
};

// Explorer links
export const explorerSuffix = CLUSTER === "mainnet-beta" ? "" : `?cluster=${CLUSTER}`;
```

**Key migration items (from mainnet-checklist.md):**
1. Rename `DEVNET_PDAS` -> `PDAS` with environment selection
2. Remove `?cluster=devnet` from explorer links (conditional)
3. Remove faucet link
4. Set `NEXT_PUBLIC_RPC_URL` to mainnet Helius endpoint
5. IDL sync with mainnet program IDs
6. Crank env vars: `CLUSTER_URL`, `PDA_MANIFEST`, `WALLET_KEYPAIR`

**Complexity:** Low. Mechanical work. The mainnet-checklist.md is already comprehensive.

### 4. Mainnet Deployment Checklist

**What it is:** The complete sequence of operations to go from "devnet working" to "mainnet live."

**Confidence:** HIGH (derived directly from existing deployment docs and codebase)

**Checklist categories:**

**Pre-deploy (before touching mainnet):**
- [ ] Toolchain version gate: solana-cli v3.0.x, anchor-cli 0.32.x, rustc 1.79+
- [ ] Fresh devnet lifecycle test passes (all 7 programs, full epoch cycle, Carnage, swaps, staking)
- [ ] All Rust tests pass (`cargo test --workspace`)
- [ ] All TS integration tests pass
- [ ] Mainnet vanity mint keypairs accessible (keypairs/mainnet-*-mint.json)
- [ ] Mainnet RPC endpoint provisioned (Helius mainnet plan)
- [ ] Mainnet wallet funded (deployer + crank + treasury)
- [ ] Token logos designed and uploaded to Arweave
- [ ] Metadata JSON uploaded to Arweave with permanent URIs
- [ ] Signer set determined for Squads multisig (3 hardware wallets)

**Deploy (mainnet execution):**
- [ ] Set mainnet mint addresses in bonding_curve/src/constants.rs and other feature-flagged files
- [ ] Build without --devnet: `./scripts/deploy/build.sh` (triggers compile_error! guards if addresses missing)
- [ ] Two-pass deploy: first deploy -> init mints/pools -> rebuild feature-flagged programs with real mints -> re-deploy 3 programs
- [ ] Run initialize.ts with mainnet env vars (source .env with mainnet overrides)
- [ ] Run verify.ts (36 checks)
- [ ] Create mainnet ALT (alt-helper.ts)
- [ ] Sync IDLs to frontend
- [ ] Add BcAdminConfig initialization (DEPLOY-GAP-01)

**Post-deploy (before public launch):**
- [ ] Frontend constant migration (environment-aware switching)
- [ ] Remove devnet explorer suffixes
- [ ] Remove faucet link
- [ ] Update Railway env vars for crank (mainnet RPC, wallet, PDA manifest)
- [ ] Create Squads 2-of-3 multisig with 2hr timelock
- [ ] Transfer all 7 program upgrade authorities to Squads vault
- [ ] Verify authority transfer on-chain (each program's ProgramData.upgrade_authority = Squads vault)
- [ ] Pre-launch verification: all swap paths, pool reserves, vault balances, whitelist completeness
- [ ] Optional: overnight soak test with small amounts

**Launch:**
- [ ] Bonding curve goes live (if applicable)
- [ ] Announce publicly
- [ ] Monitor crank for first 24hrs
- [ ] Verify priority fee economics (is 0.001 SOL bounty sufficient?)

**Post-launch (future):**
- [ ] Extend timelock to 24hr after 48-72hrs stable
- [ ] Launch Immunefi bug bounty
- [ ] Fund external audit from protocol revenue
- [ ] After audit: execute burn sequence (whitelist auth -> AMM admin -> upgrade authorities)

### 5. Bonding Curve Deadline Configurability

**What it is:** The bonding curve has a 48hr deadline (432,000 slots at 400ms/slot). This is currently a compile-time constant with `localnet` override for testing.

**Confidence:** HIGH (verified directly from codebase)

**Current pattern:**
```rust
#[cfg(not(feature = "localnet"))]
pub const DEADLINE_SLOTS: u64 = 432_000;  // ~48 hours

#[cfg(feature = "localnet")]
pub const DEADLINE_SLOTS: u64 = 500;      // ~200 seconds (for tests)
```

**Is configurability needed for v1.4?**

No. The 48hr deadline is a fixed protocol parameter per the token economics design. Making it runtime-configurable would:
- Add admin authority surface area (who can change it?)
- Create a potential attack vector (shorten deadline to prevent fills)
- Contradict the "fixed parameters, immutable protocol" design philosophy

The existing compile-time pattern is correct:
- `localnet`: 500 slots for fast testing
- `devnet` / `mainnet`: 432,000 slots (48 hours)

**If configurability were needed in the future**, the pattern would be:
- Store in BcAdminConfig PDA (already has admin authority)
- Set during `initialize_bc_admin` instruction
- Gate changes behind the admin authority (which is then burned)
- This would need to be done BEFORE authority burn

**Recommendation:** No changes needed. The compile-time constant with feature-flag override is the right pattern for a parameter that should never change post-launch.

---

## Feature Dependencies

```
Token Logos (design work)
    |
    v
Arweave Upload (images + JSON)
    |
    v
initialize.ts URI Update --------+
                                  |
Fresh Devnet Lifecycle Test       |
    |                             |
    v                             v
Mainnet Build (compile-time     Mainnet Build
  address patching)               |
    |                             |
    v                             |
Mainnet Deploy (deploy-all.sh) <--+
    |
    v
Mainnet ALT Creation
    |
    v
Frontend Constant Migration
    |
    v
Crank Env Var Update
    |
    v
Pre-Launch Verification
    |
    v
Squads Multisig Creation -----> Authority Transfer (LAST STEP)
                                    |
                                    v
                                MAINNET LIVE
```

**Key dependency insight:** Squads multisig setup is the final step but has NO upstream dependencies. It can be practiced on devnet in parallel with all other work. The actual authority transfer just has to be the very last thing before announcing.

---

## MVP Recommendation

For v1.4 MVP (minimum viable mainnet launch), prioritize:

1. **Token logos + Arweave metadata** -- blocks first impression. Without this, tokens are "Unknown Token" in every wallet.
2. **Frontend constant migration** -- without this, the app literally does not work on mainnet.
3. **Mainnet deploy pipeline execution** -- the core deliverable.
4. **Squads multisig + authority transfer** -- security requirement, non-negotiable.
5. **Pre-launch verification** -- catches showstoppers before real money is at risk.
6. **BcAdminConfig automation** -- closes DEPLOY-GAP-01.
7. **Fresh devnet lifecycle test** -- validates everything works before mainnet.

Defer to post-launch:
- **Immunefi bug bounty:** Administrative setup, not blocking launch. Can go live within a week post-launch.
- **External audit:** Explicitly gated on protocol revenue funding. Months away.
- **Authority burn:** Post-audit. Could be 3-6 months.
- **Token-list submissions (Jupiter, etc.):** Requires trading history and liquidity. Submit after 1-2 weeks of organic volume.
- **Progressive timelock extension:** Operational task post-launch (2hr -> 24hr after stability proven).

---

## Sources

- `/Users/mlbob/Projects/Dr Fraudsworth/Docs/mainnet-readiness-assessment.md` -- blockers, risks, remaining roadmap
- `/Users/mlbob/Projects/Dr Fraudsworth/Docs/mainnet-checklist.md` -- 12-section switch-point inventory
- `/Users/mlbob/Projects/Dr Fraudsworth/Docs/deployment-sequence.md` -- full deploy pipeline documentation
- `/Users/mlbob/Projects/Dr Fraudsworth/Docs/PROJECT_BRIEF.md` -- decisions on authority strategy, governance
- `/Users/mlbob/Projects/Dr Fraudsworth/scripts/deploy/initialize.ts` -- current metadata implementation
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/bonding_curve/src/constants.rs` -- feature flag patterns
- Squads v4 architecture: MEDIUM confidence (training knowledge, web verification unavailable)
- Metaplex Token Metadata JSON standard: MEDIUM confidence (well-established standard, but could not verify latest spec)
- Arweave/Irys upload tooling: LOW confidence (training knowledge only, verify current SDK before implementation)
