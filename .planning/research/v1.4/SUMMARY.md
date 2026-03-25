# Project Research Summary

**Project:** Dr. Fraudsworth's Finance Factory -- v1.4 Pre-Mainnet
**Domain:** Solana DeFi protocol mainnet deployment infrastructure
**Researched:** 2026-03-12
**Confidence:** MEDIUM (HIGH for project-specific patterns; MEDIUM for external tooling -- Squads v4 SDK, Irys/Arweave)

## Executive Summary

v1.4 is a deployment infrastructure milestone, not a feature milestone. The protocol is code-complete after v1.3 (16 phases, 3 audits, all findings closed). What remains is the operational work to go from "working on devnet" to "live on mainnet with proper governance." This means Squads multisig for upgrade authority, permanent token metadata on Arweave, a canonical deployment config system, and the actual mainnet deploy pipeline execution. No on-chain Rust program changes are needed.

The recommended approach is to build the deployment config foundation first (refactoring the existing scattered address system into a single `deployment.json` source of truth), then tackle Arweave metadata and Squads multisig in parallel (they are independent), followed by a fresh devnet lifecycle test that validates everything end-to-end, and finally the mainnet deployment itself. The existing `deploy-all.sh` pipeline is battle-tested and needs only extension, not replacement. Only 2 new npm packages are needed: `@sqds/multisig` and `@irys/sdk` (or its current equivalent).

The critical risks are all ordering-related: transferring authority to a misconfigured Squads multisig (permanent lockout), building with the wrong feature flag (devnet addresses baked into mainnet binaries), and burning whitelist authority before all bonding curve accounts are whitelisted (permanently broken token transfers). Every one of these is mitigable through devnet dry runs, binary verification steps, and separating irreversible actions into their own gated phases. The 20-step deployment ordering in PITFALLS.md should be treated as canonical.

## Key Findings

### Recommended Stack

The stack additions are minimal and deliberate. Two new npm packages, the rest is refactoring existing code.

**Core technologies:**
- `@sqds/multisig` (v4 SDK): Create 2-of-3 multisig with timelock, transfer program upgrade authorities, execute timelocked governance proposals. De facto standard for Solana program authority management.
- `@irys/sdk` (or current equivalent): Upload token logos and metadata JSON to Arweave via SOL payment. One-time script, devDependency only. Permanent, decentralized storage.
- No new config library: Extend existing `pda-manifest.json` into a `deployment.json` superset. Existing `CLUSTER_CONFIG` pattern in `shared/constants.ts` already supports environment switching -- just needs real mainnet values instead of placeholders.

**What NOT to add:** `@solana/web3.js` v2 (breaking rewrite), Metaplex Sugar (NFT tool, wrong for fungible tokens), `dotenv` (Node 22 has native `--env-file`), any CI/CD SDK (manual deploy is intentional for safety), HashiCorp Vault or similar (overkill for 3-person team).

**Version verification required:** Exact versions for `@sqds/multisig` and `@irys/sdk` could not be verified (researchers lacked web access). Orchestrator must supplement with Exa searches before implementation.

### Expected Features

**Must have (table stakes):**
- Squads 2-of-3 multisig holding all 7 program upgrade authorities (single-wallet authority = immediate red flag)
- Token metadata on Arweave with logos (missing = "Unknown Token" in every wallet)
- Environment-aware deployment config (hardcoded devnet addresses on mainnet = broken app)
- Fresh devnet lifecycle test (validates full pipeline before touching mainnet)
- Mainnet ALT creation (sell-path transactions exceed size limit without it)
- BcAdminConfig automation (DEPLOY-GAP-01 -- manual step = forgotten step)
- Timelocked upgrade proposals (multisig without timelock defeats the purpose)

**Should have (differentiators):**
- Vanity mint addresses (DONE -- keypairs already generated: cRiME, FraUd, pRoFiT)
- Progressive timelock extension (2hr -> 24hr -> burn post-audit)
- Public authority governance documentation (radical transparency for a memecoin)
- Overnight mainnet soak test before public launch
- Pre-launch verification suite (extend existing 36-check verify.ts)

**Defer to post-launch:**
- Immunefi bug bounty (administrative, not technical)
- External audit (funded from protocol revenue, months away)
- Authority burn (post-audit only)
- Token-list submissions (requires trading history)
- Governance token / DAO (premature, adds attack surface)

### Architecture Approach

The architecture is a pipeline extension pattern: the existing `deploy-all.sh` (Phases 0-4) gets three new phases (generate-constants, create-ALT, metadata upload) and two manual post-pipeline steps (Squads setup, authority transfer). The key architectural insight is introducing `deployments/{cluster}.json` as the single source of truth, replacing the current 5-source address scatter (pda-manifest, shared/constants.ts, .env, Anchor.toml, Rust constants.rs). This file is the OUTPUT of the pipeline, and `generate-constants.ts` auto-generates `shared/constants.ts` from it -- eliminating the manual copy-paste that caused the Phase 51 IDL sync disaster.

**Major components:**
1. `deployments/{cluster}.json` -- Single source of truth for all addresses, metadata URIs, and authority state per environment
2. `generate-constants.ts` -- Reads deployment.json, writes shared/constants.ts automatically (no manual sync)
3. `upload-metadata.ts` -- Uploads logos + metadata JSON to Arweave, outputs permanent URIs
4. `setup-squads.ts` + `transfer-authority.ts` -- Creates multisig, transfers program authorities (manual, one-time, separated from automated pipeline)
5. Extended `deploy-all.sh` -- Phases 0-6 automated, authority transfer deliberately excluded (irreversible action stays manual)

**Key anti-patterns to avoid:**
- Runtime config loading in frontend (50+ import sites would need async refactoring)
- Authority transfer in automated pipeline (accidental run = permanent lockout)
- Circular dependency between deployment config and pipeline (deployment.json is OUTPUT only)

### Critical Pitfalls

1. **Squads authority transfer before verifying multisig round-trip** -- Transfer to misconfigured multisig = permanent lockout of all 7 programs. Prevention: full governance cycle on devnet first, transfer ONE program at a time, verify round-trip before proceeding.

2. **Building mainnet binaries with --devnet flag** -- Bakes devnet addresses (treasury, Switchboard PID, mints) into mainnet programs. Prevention: binary verification step that greps compiled .so files for known devnet addresses, deploy script refuses to proceed if found.

3. **Whitelist authority burned before all accounts whitelisted** -- Bonding curve creates new vaults needing whitelisting. If burned too early, those vaults can never transact Token-2022 tokens. Prevention: separate whitelist burn into its own late-stage phase, full lifecycle test covering ALL paths first.

4. **Squads vault PDA vs multisig address confusion** -- Authority set to governance config address instead of vault PDA = programs become permanently immutable. Prevention: verify vault PDA can sign a test transaction on devnet before any mainnet transfer.

5. **Pool seeding with wrong amounts (Phase 69 repeat)** -- Running initialize.ts without sourcing .env uses test defaults (10 SOL / 10K tokens). Pools cannot be re-seeded. Prevention: hard error if seed env vars unset on non-localhost clusters.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Deployment Config Foundation
**Rationale:** Everything downstream depends on the config system. Pure refactoring of existing data flow, no external dependencies, no risk.
**Delivers:** `deployments/{cluster}.json` schema and generation, `generate-constants.ts` auto-generation, extended `deploy-all.sh` with Phases 5-6, modified `verify.ts`.
**Addresses:** Environment-aware deployment config, IDL sync automation, DEVNET_ prefix cleanup.
**Avoids:** Address scatter across 5 sources (Pitfall 8, 9, 10, 18).

### Phase 2: Arweave Token Metadata
**Rationale:** Blocks first impression -- without this, tokens are "Unknown Token" in every wallet. Independent of Squads work. Requires token logo design (human creative dependency -- start early).
**Delivers:** `upload-metadata.ts` script, 3 token logos on permanent Arweave storage, 3 metadata JSON files, URI update flow for Token-2022 mints.
**Uses:** `@irys/sdk` (or current equivalent).
**Avoids:** Stale Railway placeholder URIs (Pitfall 7, 13).

### Phase 3: Squads Multisig Governance
**Rationale:** Independent of Arweave work. Requires human decision (3 signer wallets) -- start discussion early. Must include full devnet dry run with round-trip upgrade proof.
**Delivers:** `setup-squads.ts`, `transfer-authority.ts`, `verify-authority.ts`, documented governance process, devnet practice run.
**Uses:** `@sqds/multisig` (v4 SDK).
**Avoids:** Premature lockout (Pitfall 1, 12). Devnet dry run is non-negotiable.

### Phase 4: Fresh Devnet Lifecycle Test
**Rationale:** Integration test of Phases 1-3 together. Catches config drift, stale keypairs, missed steps. Must include: full deploy pipeline, all swap paths, staking, Carnage, bonding curve buy/sell, epoch cycling, authority transfer to Squads.
**Delivers:** Validated end-to-end pipeline, confidence that mainnet deploy will succeed.
**Addresses:** BcAdminConfig automation (DEPLOY-GAP-01), devnet Squads governance practice.
**Avoids:** Repeating Phase 69 mistakes (Pitfall 11), discovering pipeline gaps on mainnet.

### Phase 5: Mainnet Deployment
**Rationale:** Requires all prior phases. The actual mainnet deploy following the 20-step ordering from PITFALLS.md.
**Delivers:** 7 programs live on mainnet, initialized mints/pools/vault, mainnet ALT, frontend pointing to mainnet, crank running, authorities transferred to Squads.
**Avoids:** Every critical pitfall -- this phase is where they all converge. Binary verification, cluster detection, seed validation, whitelist completeness check, authority round-trip verification all happen here.

### Phase Ordering Rationale

- **Phase 1 first** because deployment.json is consumed by every subsequent phase (metadata upload writes URIs into it, Squads setup writes authority info into it, lifecycle test validates it end-to-end).
- **Phases 2 and 3 parallel** because Arweave upload and Squads setup are completely independent. Both have human dependencies (logo design, signer wallet selection) that benefit from early start.
- **Phase 4 before Phase 5** because the fresh devnet lifecycle test is the final validation gate. Discovering issues on mainnet costs real SOL and may require full redeployment.
- **Authority transfer is the LAST step in Phase 5** -- after all programs deployed, initialized, verified, metadata updated, frontend deployed, and crank running. Irreversible action goes last.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (Arweave Metadata):** Irys SDK has undergone rebrands and API changes. Current package name, import path, and pricing model must be verified with live sources before implementation.
- **Phase 3 (Squads Multisig):** Squads v4 SDK API surface based on training data. Timelock configuration, vault PDA derivation, and proposal execution flow must be verified against current docs. The devnet dry run in this phase doubles as research validation.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Config Foundation):** Pure refactoring of existing codebase patterns. No external dependencies. All patterns already established in the project.
- **Phase 4 (Lifecycle Test):** Uses existing deploy-all.sh pipeline. No new patterns, just execution and verification.
- **Phase 5 (Mainnet Deploy):** Follows the same pipeline as devnet, validated in Phase 4. The ordering is documented in PITFALLS.md.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | Core recommendations solid, but exact versions for @sqds/multisig and @irys/sdk unverified. Researchers lacked web access. Orchestrator must verify with Exa before implementation. |
| Features | HIGH | Feature landscape derived directly from codebase analysis, existing docs (mainnet-checklist, mainnet-readiness-assessment), and established project decisions. No speculation. |
| Architecture | HIGH | Architecture is pipeline extension of existing battle-tested deploy-all.sh. deployment.json pattern is a natural evolution of existing pda-manifest.json. No radical changes. |
| Pitfalls | HIGH | Most pitfalls are project-specific lessons (Phase 51 IDL sync, Phase 69 pool seeding, Phase 78 BcAdminConfig gap). Squads-specific pitfalls (vault PDA confusion) at MEDIUM confidence -- verify with live docs. |

**Overall confidence:** MEDIUM-HIGH

The project-specific knowledge is rock-solid (13 milestones, 94 phases of battle scars). The only uncertainty is in external tooling APIs (Squads v4, Irys) which may have changed since training data cutoff. This is easily resolved with Exa verification before implementation begins.

### Gaps to Address

- **Irys SDK current state:** Package may have been renamed from `@irys/sdk` to `@irys/upload` + `@irys/upload-solana`. Verify on npm before adding dependency.
- **Squads v4 timelock mutation:** Can timelock duration be changed after multisig creation (needed for 2hr -> 24hr progression)? Verify with Squads docs.
- **Squads v4 devnet support:** Confirmed in training data but verify current program deployment on devnet.
- **Mainnet pool seeding strategy:** Clarify whether mainnet SOL pools are pre-seeded by initialize.ts or filled by bonding curve graduation proceeds. This affects seed amount env vars.
- **Mainnet SOL budget:** Estimated 15 SOL base + 10 SOL buffer. Actual costs depend on priority fees during deployment. Budget 25+ SOL.
- **Token logo design:** Not a technical gap but a creative dependency. Logos must exist before Arweave upload. Start design work immediately.
- **Signer wallet selection:** 3 wallets for 2-of-3 Squads multisig. Hardware wallets recommended. Human decision needed before Phase 3.

## Sources

### Primary (HIGH confidence)
- Project codebase: `deploy-all.sh`, `initialize.ts`, `verify.ts`, `build.sh`, `shared/constants.ts`, `pda-manifest.ts`, `patch-mint-addresses.ts`
- Project docs: `Docs/mainnet-readiness-assessment.md`, `Docs/mainnet-checklist.md`, `Docs/deployment-sequence.md`, `Docs/PROJECT_BRIEF.md`
- Project history: Phase 51 (IDL sync lesson), Phase 69 (pool seeding lesson), Phase 78 (BcAdminConfig gap), v1.3 audit findings

### Secondary (MEDIUM confidence)
- Squads v4 multisig architecture and SDK API (training data, well-established by May 2025)
- Metaplex token metadata JSON standard (well-established, unlikely to have changed)
- Arweave permanent storage model (well-established)
- Irys/Bundlr as standard Arweave upload tool for Solana (was standard, may have shifted)

### Tertiary (LOW confidence)
- Exact package versions: `@sqds/multisig` ^2.1.x, `@irys/sdk` ^0.2.x (must verify on npm)
- Irys SDK import path and initialization API (rebranding may have changed these)
- Squads v4 vault PDA derivation specifics (verify against current SDK source)

---
*Research completed: 2026-03-12*
*Ready for roadmap: yes*
