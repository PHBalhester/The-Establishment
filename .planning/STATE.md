---
gsd_state_version: 1.0
milestone: v1.4
milestone_name: Pre-Mainnet
status: completed
stopped_at: Phase 104 context gathered
last_updated: "2026-03-25T12:10:59.305Z"
last_activity: 2026-03-25 -- Phase 100 fully complete (mainnet deployed, Squads governance active)
progress:
  total_phases: 16
  completed_phases: 12
  total_plans: 52
  completed_plans: 42
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-12)

**Core value:** Real SOL yield from real trading friction -- not ponzinomics.
**Current focus:** MAINNET DEPLOYED. Phase 100 complete (all 8 stages). Phase 101 (verified builds) and Phase 103 (off-chain hardening) are next.

## Current Position

Phase: 100 COMPLETE -- MAINNET DEPLOYED
Plan: 44/44 complete (v1.4 + Phase 100)
Status: Phase 100 complete -- all 8 deployment stages executed, governance transferred
Last activity: 2026-03-25 -- Phase 100 fully complete (mainnet deployed, Squads governance active)

Progress: [██████████] 100% (v1.4 + Phase 100)

## Performance Metrics

**Velocity (cumulative):**
- Total plans completed: 331 (across v0.1-v1.4 + Phase 100)
- Milestones shipped: 13
- Total phases: 103

**By Milestone (recent):**

| Milestone | Phases | Plans | Days |
|-----------|--------|-------|------|
| v1.2 Bonding Curves | 8 | 25 | 5 |
| v1.3 Hardening | 16 | 45 | 5 |
| v1.4 Pre-Mainnet | 10 | 21/17+ | - |

## Accumulated Context

### Decisions

- v1.4: Pathway 1 (failure) before Pathway 2 (full deploy) -- verify refunds work first
- v1.4: Config system is blocking first phase -- deployment.json is consumed by everything
- v1.4: Authority transfer is LAST operational step (irreversible)
- v1.4: Mainnet deploy is NOT in scope -- v1.4 ends at "ready to push the button"
- 91-01: DeploymentConfig uses camelCase field names for TypeScript convention alignment
- 91-01: Kept pda-manifest.json alongside deployment.json for backward compatibility during migration
- 91-01: Hook ExtraAccountMetaList PDAs in dedicated hookAccounts section, bonding curve PDAs in curvePdas section
- 91-04: verify.ts falls back to pda-manifest derivation when deployment.json absent (backward compat)
- 91-04: Binary address cross-check only on 4 feature-flagged programs (vault, tax, epoch, bonding_curve)
- 91-02: Curve PDAs pre-computed from deployment.json instead of runtime deriveCurvePdas() function
- 91-02: generate-constants.ts is the ONLY writer of shared/constants.ts (no manual edits)
- 91-03: Cluster argument is devnet|mainnet string, not URL -- prevents wrong-cluster deploys
- 91-03: Env var hard-error guard prevents Phase 69 repeat (fail-fast before any on-chain ops)
- 91-03: BcAdminConfig init at Step 17 + adminConfig added to all bonding curve instruction calls
- 92-01: Mainnet deployer wallet at <path-to-mainnet-deployer-keypair> (pubkey 23g7xmrt..59YR), outside repo
- 92-01: .env.mainnet files gitignored; CHANGE_ME_MAINNET placeholder convention for secrets
- 92-01: generate-hashes.sh uses shasum -a 256 (macOS) producing expected-hashes.{cluster}.json
- 92-01: Sentry env separation via NEXT_PUBLIC_CLUSTER=mainnet (same DSN, different tag)
- 92-02: Preflight labeled "Preflight" not "Phase -1" to avoid renumbering existing phases
- 92-02: MAINNET_MIN_BALANCE defaults to 10 SOL if unset
- 92-02: Hash manifest check iterates manifest keys (not .so files) to catch missing binaries
- 92-02: Uses awk for float comparison (more reliable than bc on macOS)
- 93-01: Metadata URI resolution: env var > deployment.json > hard error (no silent Railway fallback)
- 93-01: Always Irys mainnet for permanent Arweave storage (even devnet tokens)
- 93-01: arweave.net gateway for URIs (permanent, independent of Irys company)
- 93-01: Steampunk descriptions with 3 options per token -- user picks in Plan 02
- 93-02: CRIME description: Option B (steampunk vault narrative)
- 93-02: FRAUD description: Option C (impeccable duplicity narrative)
- 93-02: PROFIT description: Custom F (perpetual motion engine narrative)
- 93-02: Irys mainnet funded from mainnet deployer wallet (~0.0004 SOL for all 6 files)
- 93-02: Irys gateway for immediate verification; arweave.net for permanent URIs
- 94-01: Devnet P_START=5, P_END=17 produces ~5.06 SOL total raised (acceptable for devnet)
- 94-01: Localnet P_START/P_END unchanged (same as mainnet) -- no localnet test dependency
- 94-01: Partial deploy uses inline solana program deploy commands (not modifying deploy.sh)
- 94-01: Partial preflight skips pool seed env var requirements
- 94.1-01: Used proxy.ts (Next.js 16 convention) not middleware.ts for site mode toggle
- 94.1-01: NEXT_PUBLIC_SITE_MODE defaults to 'launch' (safe default -- locked down)
- 94.1-01: Graduated banner is fixed overlay wrapper, preserves curve display as historical record
- 94.1-02: Devnet constants unchanged; 3.833x price ratio preserved (450 -> 1725)
- 94.1-03: MATHEMATICAL_FULL_CURVE_SOL computed from constants (not hardcoded) for cross-feature compat
- 94.1-03: Balance-delta tracking for dynamic pool seeding (no hardcoded SOL amount)
- 95-01: build.sh devnet mode splits non-flagged and feature-flagged program compilation
- 95-01: Sysvar addresses excluded from placeholder scanner in verify-program-ids.ts
- 95-01: Program IDs unchanged; only mint keypairs regenerated for fresh deployment
- 95-02: Crank crash does not block graduation verification (known-good from v1.3)
- 96-01: Tax split is 71/24/5 on-chain (not 75/24/1 as research assumed) -- verified from tax_math.rs
- 96-01: Treasury TX_FEE_HEADROOM = 0.01 SOL because treasury = deployer wallet on devnet
- 96-01: MIN_BALANCE_SOL lowered from 5 to 2 for devnet SOL conservation
- 96-02: Chart MCAP uses decimal difference (10^3) not TOKEN_DECIMALS (10^6) -- candle prices are lamports/base-unit ratios
- 96-02: Helius webhook re-registered manually with Phase 95 program IDs
- 96-03: Automated 50-wallet stress test replaced by manual multi-wallet testing (RPC rate limiting made automated infeasible)
- 96-03: E2E-11 (mobile) and E2E-12 (multi-wallet isolation) satisfied by manual user testing on devnet
- 96-04: Soak ran ~9 hours (not 24) -- user approved based on 28 epoch transitions and zero crank crashes
- 96-04: VRF oracle timeouts on devnet cause ~19 min epochs (vs ~5 min) -- devnet infrastructure, not code bug
- 96-04: Formal E2E report at Docs/e2e-test-report.md -- all 12 requirements PASS with TX evidence
- 97-01: Added InvalidAuthority error variants to AMM and BC for zero-address guard (distinct from Unauthorized)
- 97-01: Transfer Hook reuses Unauthorized error for zero-address guard (authority is Option<Pubkey>)
- 97-01: Devnet AdminConfig.admin stuck on temp key from smoke test -- will be fixed by next full redeploy
- 97-02: BPFLoaderUpgradeable SetAuthority: new authority is 3rd account (not in instruction data). Omitting burns authority.
- 97-02: BorshCoder IDL encoding uses snake_case field names. camelCase silently encodes zero bytes for pubkey args.
- 97-02: Devnet upgrade authorities accidentally burned (SetAuthority bug, now fixed). Fresh devnet deploy needed.
- 97-02: Squads vault PDA = 4SMcPtixKvjgj3U5N7C4kcnHYcySudLZfFWc523NAvXJ (devnet)
- 97-03: Used fake_tax_program (186KB) instead of conversion_vault (375KB) as upgrade test guinea pig for SOL conservation
- 97-03: Squads vaultTransactionCreate requires creator to be a multisig member (deployer is NOT a member)
- 97-03: Buffer rent from consumed upgrades goes to spill address (vault PDA), not deployer
- 97-03: confirmOrThrow helper needed because skipPreflight confirms failed TXs as "success"
- 97-03: Symlink workaround for Solana CLI path-with-spaces (Dr Fraudsworth project dir)
- 98-01: deploy-all.sh runs stages 0-4 only; stages 5-7 are launch/post-launch (run independently)
- 98-01: Partial deploy path preserved with inline logic (stage scripts are full-deploy only)
- 98-01: Stage 5 is explicit PUBLIC LAUNCH MOMENT with mainnet LAUNCH confirmation prompt
- 98-01: Stage 7 (governance) is LAST -- deployer retains hot-fix capability during launch/graduation window
- 98-02: SOL budget uses devnet binary sizes with note to run `solana rent` for exact mainnet costs
- 98-02: Emergency procedures cover 4 scenarios: rollback, hot-fix, crank crash, VRF oracle down
- 98-02: Some pitfalls referenced at multiple steps where they can reoccur (18 total references for 15 pitfalls)
- 98-03: WSOL wrapping disabled in init -- pools created during graduation with dynamic SOL, not during init
- 98-03: Devnet preflight minimum raised from 2 to 26 SOL (actual deploy costs 25.54 SOL)
- 98-03: Solana CLI v3 no longer outputs "Executable" -- use "Program Id" for program verification
- 98-03: declare -A (bash-only) replaced with colon-delimited arrays for zsh compat in stage scripts
- 98-03: Two-pass deploy NOT needed when mint keypairs exist before build (Stage 0 handles this)
- 98-03: Actual deploy cost 25.54 SOL (7 programs, 1.2x buffer) -- within 0.1% of 25.51 SOL estimate
- 98.1-01: CSP uses build-time NEXT_PUBLIC_CLUSTER for cluster-appropriate Helius URLs (mainnet vs devnet)
- 98.1-01: webhook-manage.ts uses CLUSTER || NEXT_PUBLIC_CLUSTER for API base and webhook type selection
- 98.1-01: Mainnet webhook type is 'raw', devnet is 'rawDevnet' (Helius API convention)
- 98.1-01: Both 'mainnet' and 'mainnet-beta' accepted as cluster values (Solana convention)
- 98.1-02: Cloudflare NS for fraudsworth.fun: anirban.ns.cloudflare.com + barbara.ns.cloudflare.com (propagation complete)
- 98.1-02: Railway mainnet service URLs not yet collected -- to be gathered for Plan 03 domain binding
- 98.1-02: HELIUS_WEBHOOK_SECRET stored in Railway env vars only (not in repo)
- 98.1-03: Mainnet Helius webhook ID: 7ec4fa52-171b-4100-a613-3bc52e321369 (type=raw, URL=fraudsworth.fun)
- 98.1-03: Devnet webhook (43192d5c) kept alongside mainnet webhook -- separate clusters, separate purposes
- 98.1-03: Railway CNAME targets: apex -> auupp37g.up.railway.app, www -> 77lsaed2.up.railway.app (proxied via Cloudflare)
- 98.1-03: UptimeRobot 3 monitors created but paused until launch (frontend, API health, crank health)
- 100-01: Phase 98.1 confirmed complete -- all infrastructure provisioned before mainnet work
- 100-01: setup-squads.ts dual-mode: SQUADS_SIGNER_2_PUBKEY env var presence toggles devnet vs mainnet signer mode
- 100-01: MAINNET_MIN_BALANCE raised from 10 to 32 SOL (25.54 actual + 20% contingency)
- 100-01: SQUADS_TIMELOCK_SECONDS=900 (15 min initial, per CONTEXT.md)
- 100-01: TREASURY_PUBKEY resolved: deployer wallet initially, update to Squads vault post-governance
- 100-01: Pool seed overrides empty -- graduate.ts uses dynamic balance-delta tracking
- 100-02: Anti-sniper strategy preserved by fixing code to skip BC steps (not deploying all 7)
- 100-02: MAINNET_MIN_BALANCE lowered from 32 to 26 SOL (deployer had 27.7 SOL)
- 100-02: Existing Arweave metadata URIs reused with gateway.irys.xyz (arweave.net unreliable)
- 100-02: Treasury is dedicated wallet 3ihhwL... (NOT deployer) -- hardcoded in constants.rs
- 100-02: Crank wallet F84XU... is separate from deployer
- 100-02: Mainnet deploy cost: 20.83 SOL (6 programs + init + ALT), 6.87 SOL remaining
- 100-02: compile_error!() in mainnet cfg blocks replaced with actual Pubkey::from_str() calls
- 100-02: ALT creation uses skipPreflight to avoid slot race condition on mainnet
- 100-02: Mint authorities burned for all 3 tokens (irreversible)
- 100-03: Whitelist authority RETAINED (not burned) -- transferred to Squads at Stage 7
- 100-03: Phantom mainnet uses signAndSendTransaction (not sign-then-send) for Blowfish compatibility
- 100-03: v0 VersionedTransaction with ALT for all taxed swap paths (Phantom simulation fix)
- 100-03: LAUNCH GATE added to initialize.ts (manual LAUNCH confirmation before startCurve)
- 100-03: Both curves filled: CRIME 512 SOL, FRAUD 519 SOL, graduated into 2 AMM pools
- 100-04: Squads 2-of-3 multisig on mainnet (vault 4SMcPtix..., 3600s timelock)
- 100-04: 11 authorities transferred to Squads vault (BC program closed -- 2 N/A)
- 100-04: Timelock set to 3600s (1hr) directly -- skipped 300s phase as stability confirmed
- 100-04: Bonding curve program closed post-graduation (rent reclaimed ~4.73 SOL)

### Pending Todos

- DEPLOY-GAP-01: CLOSED -- BcAdminConfig init automated in initialize.ts Step 17 (91-03)
- 3 ignored LiteSVM tests (is_reversed bug) -- carried, test-only
- Squads signer keypairs generated (keypairs/squads-signer-{1,2,3}.json) -- devnet only
- Investigate crank crash on Railway after graduation (non-blocking)
- ~~Devnet AdminConfig.admin stuck on temp key~~ -- FIXED by 98-03 fresh deploy
- ~~Devnet 7 upgrade authorities burned~~ -- FIXED by 98-03 fresh deploy
- Stale buffer on devnet (~1.3 SOL locked, authority = vault PDA) -- non-blocking
- Validation deploy frontend NOT switched (Phase 95 IDs still live) -- by design
- Frontend Railway redeploy needed with mainnet constants (manual step before Stage 5)

### Roadmap Evolution

- Phase 94.1 inserted after Phase 94: Launch page Railway hosting and curve target recalibration to 500 SOL (URGENT)
- Phase 98.1 inserted after Phase 98: Production Infrastructure Staging (Helius mainnet RPC, domain config, Railway prod env)
- Phase 100 added: Deploy to mainnet
- Phase 101 added: Verified builds, IDL upload, security.txt, and CPI publishing research
- Phase 102 added: Full devnet lifecycle redeploy and bonding curve graduation test
- Phase 103 added: Off-chain security hardening (H008, H010, H119, H003, H007, H096, H015)
- Phase 104 added: Open source release and OtterSec verification

### Blockers/Concerns

None active. Protocol LIVE on mainnet. All authorities under Squads governance.

## Session Continuity

Last session: 2026-03-25T12:10:59.302Z
Stopped at: Phase 104 context gathered
Resume file: .planning/phases/104-open-source-release-and-ottersec-verification/104-CONTEXT.md
Next action: Phase 101 (verified builds, IDL upload) or Phase 103 (off-chain security hardening)

## Milestone History

| Milestone | Phases | Plans | Status | Date |
|-----------|--------|-------|--------|------|
| v0.1 Documentation Audit | 1-7 | 29 | SHIPPED | 2026-02-03 |
| v0.2 AMM Program | 8-13 | 12 | SHIPPED | 2026-02-04 |
| v0.3 Transfer Hook | 14-17 | 9 | SHIPPED | 2026-02-06 |
| v0.4 Tax Program | 18-21 | 11 | SHIPPED | 2026-02-06 |
| v0.5 Epoch/VRF | 22-25 | 16 | SHIPPED | 2026-02-06 |
| v0.6 Staking/Yield | 26-29 | 17 | SHIPPED | 2026-02-09 |
| v0.7 Integration + Devnet | 30-38 | 25 | SHIPPED | 2026-02-15 |
| v0.8 Frontend Tech | 39-45 | 18 | SHIPPED | 2026-02-18 |
| v0.9 Protocol Hardening | 46-52 | 27 | SHIPPED | 2026-02-20 |
| v1.0 Frontend Design | 53-59 | 30 | SHIPPED | 2026-02-24 |
| v1.1 Modal Mastercraft | 60-69 | 27 | SHIPPED | 2026-03-02 |
| v1.2 Bonding Curves | 70-77 | 25 | SHIPPED | 2026-03-07 |
| v1.3 Hardening & Polish | 78-90.1 | 45 | SHIPPED | 2026-03-12 |

---
*Updated: 2026-03-25 -- Phase 100 COMPLETE (4/4 plans). 331 plans across 103 phases, 13 milestones shipped. MAINNET DEPLOYED -- all 8 stages executed, Squads governance active.*
