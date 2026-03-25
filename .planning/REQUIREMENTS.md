# Requirements: Dr. Fraudsworth's Finance Factory

**Defined:** 2026-03-12
**Core Value:** Real SOL yield from real trading friction -- not ponzinomics.

## v1.4 Requirements

Requirements for v1.4 Pre-Mainnet milestone. Each maps to roadmap phases.

### Deploy Infrastructure (INFRA)

- [ ] **INFRA-01**: Deploy pipeline generates canonical `deployments/{cluster}.json` as single source of truth for all addresses (programs, mints, PDAs, pools, ALT, treasury, metadata URIs, authority state)
- [ ] **INFRA-02**: `generate-constants.ts` script auto-writes `shared/constants.ts` from deployment.json (eliminates manual address copy-paste)
- [ ] **INFRA-03**: `verify.ts` reads from deployment.json and validates all addresses match on-chain state
- [ ] **INFRA-04**: Binary verification step in build pipeline — grep compiled `.so` files for devnet addresses, abort mainnet build if found
- [ ] **INFRA-05**: `deploy-all.sh` extended with Phase 5 (generate-constants), Phase 6 (ALT creation), and mainnet safety gates (confirmation prompt, SOL cost estimate, cluster-artifact cross-validation)
- [ ] **INFRA-06**: `initialize.ts` hard-errors if pool seed env vars are unset on non-localhost cluster (prevents Phase 69 repeat)
- [ ] **INFRA-07**: BcAdminConfig initialization automated in deploy pipeline (closes DEPLOY-GAP-01)
- [ ] **INFRA-08**: Fresh mainnet deployer wallet generated, devnet wallet retired from mainnet use
- [ ] **INFRA-09**: Fresh Helius mainnet API key provisioned, separate from devnet key
- [ ] **INFRA-10**: Fresh webhook secret for mainnet endpoint
- [ ] **INFRA-11**: Fresh Sentry project or environment tag for mainnet error separation
- [ ] **INFRA-12**: Railway production environment configured separately from devnet
- [ ] **INFRA-13**: Separate `.env.devnet` and `.env.mainnet` files with cluster-aware sourcing in deploy scripts
- [ ] **INFRA-14**: Mainnet preflight script checks: no keypairs in git staging, all env vars present, deployer balance sufficient, program binary hashes verified

### Token Metadata (META)

- [ ] **META-01**: 3 token logos designed (CRIME, FRAUD, PROFIT) as PNG 512x512
- [ ] **META-02**: Token logos uploaded to Arweave via Irys, permanent `arweave.net` URIs obtained
- [ ] **META-03**: Metadata JSON files created for each token following Metaplex standard (name, symbol, description, image, external_url, extensions.website, extensions.twitter)
- [ ] **META-04**: Metadata JSON files uploaded to Arweave, permanent URIs obtained
- [ ] **META-05**: `upload-metadata.ts` script created for repeatable metadata upload workflow
- [ ] **META-06**: `initialize.ts` updated to read metadata URIs from env vars (`CRIME_METADATA_URI`, `FRAUD_METADATA_URI`, `PROFIT_METADATA_URI`)
- [ ] **META-07**: Token metadata renders correctly in Phantom, Solflare, Backpack wallets (logo, name, symbol visible)
- [ ] **META-08**: Token metadata renders correctly on Solscan and Solana Explorer (logo, name, description, website link)
- [ ] **META-09**: Metadata update authority retained with deployer (later transferred to Squads multisig), NOT burned

### Bonding Curve Testing (CURVE)

- [ ] **CURVE-01**: Bonding curve deadline made configurable via `#[cfg(feature = "devnet")]` — ~30 min on devnet, 48hr on mainnet
- [ ] **CURVE-02**: Pathway 1 partial deploy — Bonding Curve program + CRIME/FRAUD mints + Transfer Hook deployed with 30-min deadline curves
- [ ] **CURVE-03**: Pathway 1 buy/sell — user can buy and sell tokens on both curves via frontend launch page during active period
- [ ] **CURVE-04**: Pathway 1 expiry — curves expire after 30 min without filling, frontend shows refund UI
- [ ] **CURVE-05**: Pathway 1 refund — user can claim proportional SOL refund via frontend, refund amount verified correct
- [ ] **CURVE-06**: Pathway 2 full clean-room deploy — all 7 programs with fresh IDs, all 3 mints with Arweave metadata, all pools, ALT, whitelist, crank from absolute zero
- [ ] **CURVE-07**: Pathway 2 fill — both curves filled to capacity (5 SOL each), watched in real-time via frontend gauges
- [ ] **CURVE-08**: Pathway 2 graduation — coupled graduation triggered, AMM pools seeded with curve proceeds (290M tokens + 5 SOL per pool)
- [ ] **CURVE-09**: Pathway 2 post-graduation — tax escrow routed to carnage vault, frontend transitions from launch page to trading interface

### Protocol E2E Testing (E2E)

- [ ] **E2E-01**: All 8 swap pairs execute successfully via frontend (CRIME/SOL buy, CRIME/SOL sell, FRAUD/SOL buy, FRAUD/SOL sell, CRIME/PROFIT buy, CRIME/PROFIT sell, FRAUD/PROFIT buy, FRAUD/PROFIT sell)
- [ ] **E2E-02**: Tax distribution verified — 75% staking escrow, 24% carnage vault, 1% treasury on every SOL pool swap
- [ ] **E2E-03**: Epoch advancement via crank — VRF randomness consumed, tax rates change between epochs
- [ ] **E2E-04**: Carnage fires naturally — either atomic or fallback path, dual-pool rebalancing observed
- [ ] **E2E-05**: Staking lifecycle — stake PROFIT, earn SOL yield across multiple epochs, claim rewards, unstake
- [ ] **E2E-06**: Conversion vault — convert CRIME to FRAUD and FRAUD to CRIME at 100:1 rate
- [ ] **E2E-07**: Frontend displays correct real-time data — epoch info, tax rates, pool reserves, carnage history, staking stats
- [ ] **E2E-08**: Crank runner overnight soak test — 24+ hours of continuous operation, no crashes, no missed epochs, no stale state
- [ ] **E2E-09**: Priority fee economics validated — crank transactions land reliably with dynamic priority fees
- [ ] **E2E-10**: Edge cases tested — zero-amount swaps rejected, insufficient balance errors display correctly, slippage protection triggers, wallet disconnection handled gracefully
- [ ] **E2E-11**: Mobile wallet testing — Phantom/Solflare deep-link connection works, all swap/stake paths functional on mobile
- [ ] **E2E-12**: Multi-wallet testing — multiple browser wallets and embedded wallets can trade simultaneously without interference

### Squads Governance (GOV)

- [ ] **GOV-01**: Squads 2-of-3 multisig created on devnet with `@sqds/multisig` SDK (2 of 3 members must approve, initial timelock configurable)
- [ ] **GOV-02**: All 7 program upgrade authorities transferred to Squads vault PDA on devnet (one at a time, verified after each)
- [ ] **GOV-03**: Admin PDA authorities (AMM AdminConfig, Transfer Hook WhitelistAuthority, BcAdminConfig) transferred to Squads vault on devnet
- [ ] **GOV-04**: Timelocked upgrade round-trip proven on devnet — propose upgrade, 2-of-3 approve, wait for timelock, execute, verify program bytecode changed
- [ ] **GOV-05**: `setup-squads.ts` script created for repeatable multisig creation
- [ ] **GOV-06**: `transfer-authority.ts` script created for repeatable authority transfer (reads deployment.json, transfers all authorities, updates authority section)
- [ ] **GOV-07**: `verify-authority.ts` script created — validates all 7 programs + admin PDAs have correct authority (deployer or Squads vault)
- [ ] **GOV-08**: Exact mainnet governance procedure documented step-by-step (which addresses, which order, which verifications, rollback plan)

### Mainnet Checklist (CHECK)

- [ ] **CHECK-01**: Exhaustive mainnet deployment checklist document covering pre-deploy (toolchain, tests, keypairs, RPC, wallets, metadata), deploy (build, two-pass deploy, init, verify, ALT, IDL sync, constants), post-deploy (frontend, crank, Squads, verification), and launch (bonding curves, monitoring, timelock progression)
- [ ] **CHECK-02**: Every checklist item has a verification command or observable outcome (no "just trust it worked" items)
- [ ] **CHECK-03**: Checklist validated by executing it on devnet fresh deploy (the checklist IS the devnet lifecycle test procedure)
- [ ] **CHECK-04**: SOL budget estimated for mainnet deployment (programs + mints + PDAs + pools + ALT + priority fees + crank funding + bonding curve seeding)

### Nextra Documentation (DOCS)

- [ ] **DOCS-01**: Every Nextra page reviewed and rewritten to reflect production-accurate protocol state
- [ ] **DOCS-02**: Illustrated diagrams created for key protocol concepts (token flow, tax distribution, epoch lifecycle, carnage mechanics, staking rewards, bonding curve mechanics)
- [ ] **DOCS-03**: Bonding curve launch page documentation — how it works, pricing formula, wallet cap, graduation conditions, refund mechanics
- [ ] **DOCS-04**: Authority governance documentation — Squads multisig address, timelock config, burn schedule, published publicly
- [ ] **DOCS-05**: All code examples and addresses updated to reflect mainnet deployment

## v2 Requirements

Deferred to post-launch. Tracked but not in current roadmap.

### Post-Launch Operations

- **POST-01**: Progressive timelock extension (2hr -> 24hr after 48-72hr stability)
- **POST-02**: Immunefi bug bounty program setup
- **POST-03**: External audit funded from protocol revenue
- **POST-04**: Authority burn sequence (whitelist auth -> AMM admin -> upgrade authorities, post-audit only)
- **POST-05**: Token-list submissions (Jupiter, Raydium) after organic trading volume
- **POST-06**: Fix 3 ignored LiteSVM tests (is_reversed bug, test-only impact)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Vanity program addresses | Have vanity mint CAs already, program addresses don't need branding |
| Emergency pause mechanism | Admin pause = rug pull perception. Timelocked upgrade is the safety net |
| Governance token / DAO | Premature, adds complexity and regulatory risk |
| Token-list registry submission | Requires trading history, submit post-launch |
| Multi-region crank deployment | Single instance with auto-restart sufficient, permissionless recovery |
| Automated authority burn timer | Irreversible action needs human judgment, not automation |
| Custom metadata hosting | Railway endpoint = single point of failure. Arweave is permanent |
| Actual mainnet deployment execution | v1.4 ends at "ready to push the button" -- mainnet deploy is a documented checklist, not a code milestone |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 91 | Pending |
| INFRA-02 | Phase 91 | Pending |
| INFRA-03 | Phase 91 | Pending |
| INFRA-04 | Phase 91 | Pending |
| INFRA-05 | Phase 91 | Pending |
| INFRA-06 | Phase 91 | Pending |
| INFRA-07 | Phase 91 | Pending |
| INFRA-08 | Phase 92 | Pending |
| INFRA-09 | Phase 98.1 | Complete |
| INFRA-10 | Phase 92 | Pending |
| INFRA-11 | Phase 92 | Pending |
| INFRA-12 | Phase 98.1 | Complete |
| INFRA-13 | Phase 91 | Pending |
| INFRA-14 | Phase 92 | Pending |
| META-01 | Phase 93 | Pending |
| META-02 | Phase 93 | Pending |
| META-03 | Phase 93 | Pending |
| META-04 | Phase 93 | Pending |
| META-05 | Phase 93 | Pending |
| META-06 | Phase 93 | Pending |
| META-07 | Phase 93 | Pending |
| META-08 | Phase 93 | Pending |
| META-09 | Phase 93 | Pending |
| CURVE-01 | Phase 94 | Pending |
| CURVE-02 | Phase 94 | Pending |
| CURVE-03 | Phase 94 | Pending |
| CURVE-04 | Phase 94 | Pending |
| CURVE-05 | Phase 94 | Pending |
| CURVE-06 | Phase 95 | Pending |
| CURVE-07 | Phase 95 | Pending |
| CURVE-08 | Phase 95 | Pending |
| CURVE-09 | Phase 95 | Pending |
| E2E-01 | Phase 96 | Pending |
| E2E-02 | Phase 96 | Pending |
| E2E-03 | Phase 96 | Pending |
| E2E-04 | Phase 96 | Pending |
| E2E-05 | Phase 96 | Pending |
| E2E-06 | Phase 96 | Pending |
| E2E-07 | Phase 96 | Pending |
| E2E-08 | Phase 96 | Pending |
| E2E-09 | Phase 96 | Pending |
| E2E-10 | Phase 96 | Pending |
| E2E-11 | Phase 96 | Pending |
| E2E-12 | Phase 96 | Pending |
| GOV-01 | Phase 97 | Pending |
| GOV-02 | Phase 97 | Pending |
| GOV-03 | Phase 97 | Pending |
| GOV-04 | Phase 97 | Pending |
| GOV-05 | Phase 97 | Pending |
| GOV-06 | Phase 97 | Pending |
| GOV-07 | Phase 97 | Pending |
| GOV-08 | Phase 97 | Pending |
| CHECK-01 | Phase 98 | Pending |
| CHECK-02 | Phase 98 | Pending |
| CHECK-03 | Phase 98 | Pending |
| CHECK-04 | Phase 98 | Pending |
| DOCS-01 | Phase 99 | Pending |
| DOCS-02 | Phase 99 | Pending |
| DOCS-03 | Phase 99 | Pending |
| DOCS-04 | Phase 99 | Pending |
| DOCS-05 | Phase 99 | Pending |

**Coverage:**
- v1.4 requirements: 61 total
- Mapped to phases: 61
- Unmapped: 0

---
*Requirements defined: 2026-03-12*
*Last updated: 2026-03-12 after roadmap creation (traceability populated)*
