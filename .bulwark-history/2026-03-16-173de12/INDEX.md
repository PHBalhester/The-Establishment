# Dinh's Bulwark -- Off-Chain Source Index

**Project:** Dr. Fraudsworth's Finance Factory
**Generated:** 2026-03-07
**Scope:** Off-chain TypeScript/TSX/Shell source files. On-chain Anchor/Rust programs (`programs/`) excluded.

---

## Summary

| Directory | Files | LOC (approx) | Languages |
|-----------|------:|-------------:|-----------|
| `scripts/` | 40 | 16,154 | TypeScript, Shell |
| `tests/` | 15 | 13,539 | TypeScript |
| `shared/` | 3 | 478 | TypeScript |
| `app/lib/` | 30 | 5,443 | TypeScript |
| `app/hooks/` | 18 | 4,080 | TypeScript |
| `app/db/` | 4 | 445 | TypeScript |
| `app/app/api/` | 6 | 990 | TypeScript |
| `app/components/` | 67 | 9,125 | TypeScript/TSX |
| `app/providers/` | 3 | 367 | TSX |
| `app/ root` | 4 | ~120 | TypeScript |
| **Total** | **190** | **~50,741** | **TypeScript, TSX, Shell** |

**IDL files:** `app/idl/*.json` and `app/idl/types/*.ts` are auto-generated Anchor type definitions (7 programs). Not individually indexed. Consumed by `app/lib/anchor.ts`.

---

## High-Risk Files (Top 20 by Risk Marker Count)

| # | File | Risk Markers | Focus Tags |
|---|------|--------------|------------|
| 1 | `scripts/crank/crank-runner.ts` | Signs TXs, reads keypair, SOL transfers, 24/7 bot, vault top-up | BOT-01, BOT-02, SEC-01, CHAIN-01, ERR-01 |
| 2 | `scripts/crank/crank-provider.ts` | Loads keypair from env/disk, parses secret key bytes, loads IDLs | SEC-01, SEC-02, INFRA-03 |
| 3 | `scripts/deploy/initialize.ts` | Mints tokens, creates pools, burns authority, reads keypairs from disk | SEC-01, CHAIN-01, CHAIN-02, LOGIC-01 |
| 4 | `app/app/api/webhooks/helius/route.ts` | Webhook auth (optional!), DB writes, event parsing, SSE broadcast | API-04, INJ-03, DATA-01, SEC-02, ERR-02 |
| 5 | `app/hooks/useSwap.ts` | Builds/signs/sends swap TXs, financial math, slippage, priority fees | CHAIN-01, CHAIN-03, LOGIC-01, FE-01, ERR-01 |
| 6 | `app/lib/swap/swap-builders.ts` | Constructs on-chain TX instructions, account resolution, WSOL wrap | CHAIN-01, CHAIN-03, CHAIN-04, LOGIC-02 |
| 7 | `app/lib/swap/multi-hop-builder.ts` | Atomic v0 TX, ALT, skipPreflight, instruction manipulation | CHAIN-01, CHAIN-03, CHAIN-05, SEC-01, ERR-01 |
| 8 | `app/hooks/useProtocolWallet.ts` | Sign-then-send pattern, raw TX serialization, RPC submission | CHAIN-01, SEC-01, FE-01 |
| 9 | `app/lib/swap/quote-engine.ts` | Financial math mirroring on-chain, integer arithmetic, price impact | LOGIC-01, LOGIC-02, CHAIN-06 |
| 10 | `scripts/graduation/graduate.ts` | Irreversible state transitions, SOL/token withdrawals, pool creation | SEC-01, CHAIN-01, CHAIN-02, LOGIC-01 |
| 11 | `scripts/vrf/lib/vrf-flow.ts` | VRF 3-TX flow, Switchboard SDK, atomic carnage bundling | CHAIN-01, BOT-01, SEC-01, ERR-01 |
| 12 | `shared/constants.ts` | Hardcoded program IDs, mints, PDAs, Helius API key, treasury pubkey | SEC-02, CHAIN-06, INFRA-05, DEP-01 |
| 13 | `app/hooks/useStaking.ts` | Staking TX lifecycle, BigInt reward math, cooldown enforcement | CHAIN-01, LOGIC-01, LOGIC-02, FE-01 |
| 14 | `app/lib/staking/staking-builders.ts` | Staking TX construction, hook account resolution direction | CHAIN-01, CHAIN-03, CHAIN-04 |
| 15 | `app/db/connection.ts` | DB connection string from env, connection pooling, singleton | DATA-01, DATA-04, INFRA-03, SEC-02 |
| 16 | `app/db/candle-aggregator.ts` | OHLCV upsert with raw SQL (GREATEST/LEAST), price derivation | DATA-01, INJ-03, LOGIC-01 |
| 17 | `app/lib/event-parser.ts` | Borsh event deserialization, BN-to-number conversion, pubkey parsing | CHAIN-06, ERR-02, INJ-04 |
| 18 | `scripts/e2e/lib/swap-flow.ts` | E2E swap execution, tax verification, hook resolution, WSOL wrap | CHAIN-01, CHAIN-03, SEC-01 |
| 19 | `scripts/deploy/lib/pda-manifest.ts` | PDA derivation, canonical mint ordering, manifest generation | CHAIN-06, LOGIC-02, DEP-01 |
| 20 | `app/lib/swap/route-engine.ts` | Route enumeration, multi-hop quoting, fee aggregation | LOGIC-01, LOGIC-02, CHAIN-06 |

---

## File Index (by directory)

### scripts/crank/

#### `scripts/crank/crank-runner.ts`
- **Purpose:** 24/7 epoch advancement crank bot with atomic Carnage execution
- **Exports:** `main()` (entry point)
- **Focus Tags:** [BOT-01, BOT-02, SEC-01, CHAIN-01, ERR-01, INFRA-03]
- **Risk Markers:** signs transactions via provider, SOL transfers for vault top-up, reads carnage WSOL keypair from disk, infinite loop with error retry, logs wallet balance publicly, graceful shutdown handlers

#### `scripts/crank/crank-provider.ts`
- **Purpose:** Standalone provider/program/manifest loader for crank and Railway environments
- **Exports:** `loadCrankProvider()`, `loadCrankPrograms()`, `loadManifest()`, `CrankPrograms`
- **Focus Tags:** [SEC-01, SEC-02, INFRA-03, INFRA-05]
- **Risk Markers:** reads keypair from WALLET_KEYPAIR env var (JSON byte array), reads keypair from disk file, parses PDA_MANIFEST env var, loads IDL JSON from filesystem

### scripts/deploy/

#### `scripts/deploy/initialize.ts`
- **Purpose:** Full protocol initialization -- mints, pools, whitelist, epoch, staking, carnage, bonding curves
- **Exports:** (script entry point)
- **Focus Tags:** [SEC-01, CHAIN-01, CHAIN-02, LOGIC-01, DEP-01]
- **Risk Markers:** creates Token-2022 mints, seeds pool liquidity, burns whitelist authority (irreversible), generates and saves mint keypairs to disk, large TX construction (17+ steps), idempotent re-run logic

#### `scripts/deploy/verify.ts`
- **Purpose:** Post-deployment verification of all on-chain accounts and state
- **Exports:** (script entry point)
- **Focus Tags:** [CHAIN-06, ERR-01, DEP-01]
- **Risk Markers:** reads on-chain state for verification, loads mint keypairs from disk, exit code drives CI pipeline

#### `scripts/deploy/create-alt.ts`
- **Purpose:** Creates/verifies protocol-wide Address Lookup Table
- **Exports:** (script entry point)
- **Focus Tags:** [CHAIN-01, CHAIN-05]
- **Risk Markers:** creates on-chain ALT account, reads pda-manifest.json

#### `scripts/deploy/burn-excess-supply.ts`
- **Purpose:** One-time fix to burn excess token supply from admin accounts
- **Exports:** (script entry point)
- **Focus Tags:** [CHAIN-01, SEC-01, LOGIC-01]
- **Risk Markers:** burns tokens (irreversible), discovers admin token accounts

#### `scripts/deploy/patch-mint-addresses.ts`
- **Purpose:** Patches hardcoded mint addresses in conversion vault and other feature-flagged programs
- **Exports:** (script entry point)
- **Focus Tags:** [DEP-01, CHAIN-06]
- **Risk Markers:** modifies Rust source files, addresses chicken-and-egg deployment problem

#### `scripts/deploy/lib/connection.ts`
- **Purpose:** Provider factory for deploy scripts with keypair loading
- **Exports:** `loadProvider()`
- **Focus Tags:** [SEC-01, INFRA-03]
- **Risk Markers:** reads keypair from WALLET env var or default path, creates AnchorProvider

#### `scripts/deploy/lib/pda-manifest.ts`
- **Purpose:** Derives all protocol PDA addresses and outputs JSON/markdown manifests
- **Exports:** PDA derivation and manifest generation functions
- **Focus Tags:** [CHAIN-06, LOGIC-02, DEP-01]
- **Risk Markers:** canonical mint ordering for pool PDAs, seed constants must match on-chain

#### `scripts/deploy/lib/logger.ts`
- **Purpose:** Colored console logger for deployment scripts
- **Exports:** Logger class
- **Focus Tags:** []
- **Risk Markers:** none

#### `scripts/deploy/lib/account-check.ts`
- **Purpose:** Utilities for checking on-chain account existence/state
- **Exports:** Account verification helpers
- **Focus Tags:** [CHAIN-06, ERR-01]
- **Risk Markers:** RPC calls for account info

#### `scripts/deploy/deploy-all.sh`
- **Purpose:** Orchestrates full deployment pipeline (mint keypairs, build, deploy, initialize, verify)
- **Focus Tags:** [DEP-01, INFRA-03, SEC-01]
- **Risk Markers:** runs deploy commands, handles two-pass deploy for feature-flagged programs

#### `scripts/deploy/build.sh`
- **Purpose:** Anchor build with optional devnet feature flag
- **Focus Tags:** [DEP-01]
- **Risk Markers:** builds programs with --features devnet

#### `scripts/deploy/deploy.sh`
- **Purpose:** Deploys compiled programs to Solana cluster
- **Focus Tags:** [DEP-01, INFRA-03]
- **Risk Markers:** program deployment commands

### scripts/graduation/

#### `scripts/graduation/graduate.ts`
- **Purpose:** Bonding curve graduation -- transitions from curve phase to AMM trading
- **Exports:** (script entry point)
- **Focus Tags:** [SEC-01, CHAIN-01, CHAIN-02, LOGIC-01]
- **Risk Markers:** irreversible state transitions (Filled -> Graduated), withdraws SOL from curve vaults (~1000 SOL each), creates AMM pools, seeds conversion vault, checkpoint/resume state file, distributes tax escrow to carnage fund

### scripts/vrf/

#### `scripts/vrf/devnet-vrf-validation.ts`
- **Purpose:** VRF validation runner -- executes epoch transitions and produces validation reports
- **Exports:** (script entry point)
- **Focus Tags:** [BOT-01, CHAIN-01, ERR-01]
- **Risk Markers:** executes VRF flow, writes validation reports

#### `scripts/vrf/lib/vrf-flow.ts`
- **Purpose:** Complete Switchboard VRF commit-reveal-consume 3-TX flow with atomic carnage
- **Exports:** `advanceEpochWithVRF()`, `VRFAccounts`, `waitForSlotAdvance()`, `sleep()`
- **Focus Tags:** [CHAIN-01, BOT-01, SEC-01, ERR-01, CHAIN-05]
- **Risk Markers:** 3 sequential transactions, skipPreflight for v0 TX, Switchboard SDK integration, atomic carnage bundling (CARN-002 fix), VRF timeout recovery with fresh randomness

#### `scripts/vrf/lib/epoch-reader.ts`
- **Purpose:** Reads EpochState on-chain account and extracts tax rates
- **Exports:** `readEpochState()`
- **Focus Tags:** [CHAIN-06]
- **Risk Markers:** on-chain state deserialization

#### `scripts/vrf/lib/security-tests.ts`
- **Purpose:** Automated security tests for VRF and epoch transition invariants
- **Exports:** Security test functions
- **Focus Tags:** [SEC-01, CHAIN-01]
- **Risk Markers:** tests attack vectors, validates invariants

#### `scripts/vrf/lib/swap-verifier.ts`
- **Purpose:** Verifies swap execution results against expected outputs
- **Exports:** Swap verification functions
- **Focus Tags:** [LOGIC-01, CHAIN-06]
- **Risk Markers:** validates swap math

#### `scripts/vrf/lib/reporter.ts`
- **Purpose:** Generates validation reports from VRF test results
- **Exports:** Reporter class
- **Focus Tags:** []
- **Risk Markers:** none

### scripts/e2e/

#### `scripts/e2e/devnet-e2e-validation.ts`
- **Purpose:** Devnet E2E validation orchestrator -- defines PDAManifest type
- **Exports:** `PDAManifest` type
- **Focus Tags:** [CHAIN-06, DEP-01]
- **Risk Markers:** defines manifest schema consumed by crank and deploy scripts

#### `scripts/e2e/smoke-test.ts`
- **Purpose:** Quick smoke test for devnet deployment verification
- **Exports:** (script entry point)
- **Focus Tags:** [CHAIN-06, ERR-01]
- **Risk Markers:** executes swap transactions on devnet

#### `scripts/e2e/carnage-hunter.ts`
- **Purpose:** E2E test for all 6 Carnage execution paths
- **Exports:** (script entry point)
- **Focus Tags:** [CHAIN-01, LOGIC-01]
- **Risk Markers:** executes carnage paths, validates token burns and sells

#### `scripts/e2e/overnight-runner.ts`
- **Purpose:** Long-running overnight E2E test runner
- **Exports:** (script entry point)
- **Focus Tags:** [BOT-01, BOT-02, ERR-01]
- **Risk Markers:** creates test users, wraps WSOL, executes swaps, writes JSONL reports

#### `scripts/e2e/security-verification.ts`
- **Purpose:** Automated security verification for devnet deployment
- **Exports:** (script entry point)
- **Focus Tags:** [SEC-01, CHAIN-01]
- **Risk Markers:** tests access control, validates authority checks

#### `scripts/e2e/lib/swap-flow.ts`
- **Purpose:** E2E swap execution with tax distribution verification
- **Exports:** `executeSolBuySwap()`, `resolveHookAccounts()`, `runSwapFlow()`
- **Focus Tags:** [CHAIN-01, CHAIN-03, SEC-01, LOGIC-01]
- **Risk Markers:** constructs swap transactions, verifies 71/24/5 tax split, WSOL wrapping, Transfer Hook account resolution

#### `scripts/e2e/lib/carnage-flow.ts`
- **Purpose:** E2E Carnage execution flow with v0 atomic bundling
- **Exports:** Carnage execution helpers
- **Focus Tags:** [CHAIN-01, CHAIN-05, SEC-01]
- **Risk Markers:** atomic Carnage TX building, dual-pool swaps, ALT usage

#### `scripts/e2e/lib/staking-flow.ts`
- **Purpose:** E2E staking flow -- stake, claim, unstake with verification
- **Exports:** Staking flow helpers
- **Focus Tags:** [CHAIN-01, CHAIN-03, LOGIC-01]
- **Risk Markers:** staking TX construction, reward verification

#### `scripts/e2e/lib/alt-helper.ts`
- **Purpose:** Protocol-wide Address Lookup Table creation and caching
- **Exports:** `getOrCreateProtocolALT()`
- **Focus Tags:** [CHAIN-05, INFRA-03]
- **Risk Markers:** creates on-chain ALT, caches to alt-address.json, adds 46 protocol addresses

#### `scripts/e2e/lib/user-setup.ts`
- **Purpose:** Creates test user wallets with token accounts and WSOL
- **Exports:** User setup helpers
- **Focus Tags:** [SEC-01]
- **Risk Markers:** generates keypairs for test users, requests airdrops

#### `scripts/e2e/lib/e2e-logger.ts`
- **Purpose:** Structured logger for E2E test output
- **Exports:** Logger class
- **Focus Tags:** []
- **Risk Markers:** none

#### `scripts/e2e/lib/e2e-reporter.ts`
- **Purpose:** JSONL report generator for E2E validation results
- **Exports:** Reporter class
- **Focus Tags:** []
- **Risk Markers:** writes files to disk

#### `scripts/e2e/lib/overnight-reporter.ts`
- **Purpose:** Markdown report generator for overnight test runs
- **Exports:** Reporter class
- **Focus Tags:** []
- **Risk Markers:** writes files to disk

### scripts/ (root)

#### `scripts/init-localnet.ts`
- **Purpose:** Initializes local validator with all protocol programs and accounts
- **Exports:** (script entry point)
- **Focus Tags:** [DEP-01, CHAIN-01]
- **Risk Markers:** deploys programs locally, creates accounts

#### `scripts/webhook-manage.ts`
- **Purpose:** Helius webhook CRUD management (list, create, update, delete)
- **Exports:** (script entry point)
- **Focus Tags:** [API-04, INFRA-03, SEC-02]
- **Risk Markers:** uses Helius API key, configures webhook URL and auth secret, manages production webhook endpoints

#### `scripts/verify-program-ids.ts`
- **Purpose:** Verifies deployed program IDs match expected values
- **Exports:** (script entry point)
- **Focus Tags:** [CHAIN-06, DEP-01]
- **Risk Markers:** reads on-chain program data

#### `scripts/backfill-candles.ts`
- **Purpose:** Backfills historical candle data from on-chain swap events
- **Exports:** (script entry point)
- **Focus Tags:** [DATA-01, CHAIN-06]
- **Risk Markers:** bulk DB writes, on-chain event parsing

#### `scripts/prepare-carnage-state.ts`
- **Purpose:** Prepares on-chain state for Carnage testing
- **Exports:** (script entry point)
- **Focus Tags:** [CHAIN-01]
- **Risk Markers:** modifies on-chain state

#### `scripts/run-integration-tests.sh`
- **Purpose:** Shell runner for integration test suites with separate validators
- **Focus Tags:** [DEP-01]
- **Risk Markers:** manages test validator lifecycle

### shared/

#### `shared/constants.ts`
- **Purpose:** Source of truth for program IDs, mint addresses, PDA seeds, fee constants, pool configs, token pairs
- **Exports:** `PROGRAM_IDS`, `MINTS`, `SEEDS`, `DEVNET_PDAS`, `DEVNET_POOL_CONFIGS`, `VALID_PAIRS`, `resolvePool()`, `resolveRoute()`, `TREASURY_PUBKEY`, `HELIUS_API_KEY`, bonding curve constants
- **Focus Tags:** [SEC-02, CHAIN-06, INFRA-05, DEP-01]
- **Risk Markers:** hardcoded Helius API key in source code, hardcoded devnet program IDs and mint addresses, treasury pubkey (mainnet changeover point), PDA seed strings must match on-chain constants.rs exactly

#### `shared/programs.ts`
- **Purpose:** Devnet ALT address and RPC URL
- **Exports:** `DEVNET_ALT`, `DEVNET_RPC_URL`
- **Focus Tags:** [SEC-02, INFRA-05]
- **Risk Markers:** hardcoded Helius RPC URL with API key in source code

#### `shared/index.ts`
- **Purpose:** Barrel re-export for the shared package
- **Exports:** All constants, types, and functions from constants.ts and programs.ts
- **Focus Tags:** []
- **Risk Markers:** none

### app/lib/swap/

#### `app/lib/swap/swap-builders.ts`
- **Purpose:** Constructs unsigned Transaction objects for SOL buy, SOL sell, and vault convert swaps
- **Exports:** `buildSolBuyTransaction()`, `buildSolSellTransaction()`, `buildVaultConvertTransaction()`
- **Focus Tags:** [CHAIN-01, CHAIN-03, CHAIN-04, LOGIC-02]
- **Risk Markers:** constructs on-chain instructions with 20+ accounts, WSOL wrap/unwrap lifecycle, Transfer Hook remaining_accounts resolution (direction-sensitive), creates ATAs, PDA derivation

#### `app/lib/swap/multi-hop-builder.ts`
- **Purpose:** Builds atomic v0 VersionedTransactions combining multiple swap steps
- **Exports:** `buildAtomicRoute()`, `executeAtomicRoute()`, `AtomicBuildResult`, `MultiHopResult`
- **Focus Tags:** [CHAIN-01, CHAIN-03, CHAIN-05, SEC-01, ERR-01]
- **Risk Markers:** skipPreflight=true for v0 TX (must check confirmation.err), instruction deduplication and reordering, intermediate WSOL closeAccount removal, ComputeBudget instruction stripping and recombination, ALT caching (module-level singleton)

#### `app/lib/swap/quote-engine.ts`
- **Purpose:** Client-side AMM math mirroring on-chain programs
- **Exports:** `quoteSolBuy()`, `quoteSolSell()`, `quoteVaultConvert()`, `reverseQuoteSolBuy()`, `reverseQuoteSolSell()`, `reverseQuoteVaultConvert()`
- **Focus Tags:** [LOGIC-01, LOGIC-02, CHAIN-06]
- **Risk Markers:** financial math with integer arithmetic (Math.floor/Math.ceil), must match on-chain Rust exactly, BPS_DENOMINATOR=10000, reverse quote functions use ceiling division, division-by-zero guards

#### `app/lib/swap/route-engine.ts`
- **Purpose:** Route enumeration, multi-hop quoting, and ranking (pure function)
- **Exports:** `computeRoutes()`, `buildRouteGraph()`, `ROUTE_GRAPH`
- **Focus Tags:** [LOGIC-01, LOGIC-02, CHAIN-06]
- **Risk Markers:** fee aggregation uses BPS summation (not amounts) to handle cross-denomination hops, price impact summation across hops, path enumeration must cover all topology edges

#### `app/lib/swap/split-router.ts`
- **Purpose:** Optimal split calculation for parallel 2-path routing
- **Exports:** `computeOptimalSplit()`, `SPLIT_THRESHOLD_BPS`
- **Focus Tags:** [LOGIC-01, LOGIC-02]
- **Risk Markers:** grid search optimization (1% granularity), split threshold (50 bps minimum improvement)

#### `app/lib/swap/hook-resolver.ts`
- **Purpose:** Deterministic Transfer Hook remaining_accounts PDA derivation (no RPC)
- **Exports:** `resolveHookAccounts()`
- **Focus Tags:** [CHAIN-04, CHAIN-06]
- **Risk Markers:** PDA derivation must match on-chain ExtraAccountMetaList exactly, direction-sensitive (source vs dest), browser Buffer polyfill workaround

#### `app/lib/swap/wsol.ts`
- **Purpose:** WSOL wrap/unwrap instruction builders
- **Exports:** `buildWsolWrapInstructions()`, `buildWsolUnwrapInstruction()`, `getWsolAta()`
- **Focus Tags:** [CHAIN-01, CHAIN-03]
- **Risk Markers:** WSOL uses TOKEN_PROGRAM_ID (not TOKEN_2022), ATA creation, SOL transfer for wrapping

#### `app/lib/swap/route-types.ts`
- **Purpose:** Type definitions for routes, steps, pool reserves, and epoch tax state
- **Exports:** `Route`, `RouteStep`, `PoolReserves`, `EpochTaxState`, `RouteGraph`, `RouteGraphEdge`, `TokenSymbol`
- **Focus Tags:** []
- **Risk Markers:** none

#### `app/lib/swap/error-map.ts`
- **Purpose:** Maps Anchor error codes to human-readable swap error messages
- **Exports:** `parseSwapError()`
- **Focus Tags:** [ERR-02]
- **Risk Markers:** error code parsing from nested CPI contexts, program ID matching

#### `app/lib/swap/__tests__/route-engine.test.ts`
- **Purpose:** Unit tests for route engine
- **Focus Tags:** []
- **Risk Markers:** none (test file)

#### `app/lib/swap/__tests__/split-router.test.ts`
- **Purpose:** Unit tests for split router
- **Focus Tags:** []
- **Risk Markers:** none (test file)

### app/lib/staking/

#### `app/lib/staking/staking-builders.ts`
- **Purpose:** Builds stake, unstake, and claim Transaction objects
- **Exports:** `buildStakeTransaction()`, `buildUnstakeTransaction()`, `buildClaimTransaction()`, `deriveUserStakePDA()`
- **Focus Tags:** [CHAIN-01, CHAIN-03, CHAIN-04]
- **Risk Markers:** hook direction REVERSED for unstake vs stake (critical), UserStake PDA derivation, ATA creation, compute budget management

#### `app/lib/staking/rewards.ts`
- **Purpose:** Client-side reward calculation mirroring on-chain Synthetix pattern
- **Exports:** `calculatePendingRewards()`, `calculateRewardRate()`, `PRECISION`
- **Focus Tags:** [LOGIC-01, LOGIC-02]
- **Risk Markers:** BigInt arithmetic throughout (u128 fields), PRECISION = 1e18, BigInt-to-Number conversion at output (safe for lamport range)

#### `app/lib/staking/error-map.ts`
- **Purpose:** Maps Anchor error codes to human-readable staking error messages
- **Exports:** `parseStakingError()`
- **Focus Tags:** [ERR-02]
- **Risk Markers:** error code parsing

### app/lib/curve/

#### `app/lib/curve/curve-tx-builder.ts`
- **Purpose:** Bonding curve TX builders for purchase, sell, and refund
- **Exports:** `buildPurchaseInstruction()`, `buildSellInstruction()`, `buildClaimRefundInstruction()`
- **Focus Tags:** [CHAIN-01, CHAIN-03, CHAIN-04, LOGIC-01]
- **Risk Markers:** BigInt-to-BN conversion for Anchor, hook account direction (purchase=vault->user, sell=user->vault), PDA derivation

#### `app/lib/curve/curve-math.ts`
- **Purpose:** BigInt port of on-chain bonding curve quadratic math
- **Exports:** `calculateTokensOut()`, `calculateSolForTokens()`, `getCurrentPrice()`, `calculateSellTax()`
- **Focus Tags:** [LOGIC-01, LOGIC-02, CHAIN-06]
- **Risk Markers:** BigInt arithmetic with intermediates reaching ~2.5e36, integer square root (Newton's method), must match on-chain Rust exactly, ceil-rounded 15% sell tax

#### `app/lib/curve/curve-constants.ts`
- **Purpose:** BigInt constants mirroring on-chain bonding curve parameters
- **Exports:** `P_START`, `P_END`, `TOTAL_FOR_SALE`, `PRECISION`, `SELL_TAX_BPS`, `BPS_DENOMINATOR`
- **Focus Tags:** [CHAIN-06, LOGIC-02]
- **Risk Markers:** must stay in sync with programs/bonding_curve/src/constants.rs

#### `app/lib/curve/hook-accounts.ts`
- **Purpose:** Transfer Hook account resolver for bonding curve operations
- **Exports:** `getCurveHookAccounts()`
- **Focus Tags:** [CHAIN-04]
- **Risk Markers:** direction matters (purchase vs sell), PDA derivation

#### `app/lib/curve/error-map.ts`
- **Purpose:** Maps bonding curve error codes to UI messages
- **Exports:** `parseCurveError()`
- **Focus Tags:** [ERR-02]
- **Risk Markers:** error code range 6000-6023

### app/lib/ (root)

#### `app/lib/anchor.ts`
- **Purpose:** Read-only Anchor Program factory for all 7 on-chain programs
- **Exports:** `getAmmProgram()`, `getBondingCurveProgram()`, `getEpochProgram()`, `getStakingProgram()`, `getTaxProgram()`, `getHookProgram()`, `getVaultProgram()`
- **Focus Tags:** [CHAIN-06, DEP-01]
- **Risk Markers:** loads IDL JSON at module init, creates Program instances without wallet (read-only)

#### `app/lib/connection.ts`
- **Purpose:** Singleton Solana RPC Connection factory
- **Exports:** `getConnection()`
- **Focus Tags:** [INFRA-03, INFRA-05, SEC-02]
- **Risk Markers:** singleton cache, RPC URL from env var or hardcoded fallback, WebSocket endpoint derivation

#### `app/lib/event-parser.ts`
- **Purpose:** Decodes Anchor emit!() events from raw transaction log messages
- **Exports:** `parseSwapEvents()`, `parseEpochEvents()`, `parseCarnageEvents()`, parsed event types
- **Focus Tags:** [CHAIN-06, ERR-02, INJ-04]
- **Risk Markers:** BN-to-number conversion (safe for <2^53), pubkey reconstruction from _bn field, enum variant parsing (handles both numeric and object formats), EventParser is stateful (fresh per call)

#### `app/lib/confirm-transaction.ts`
- **Purpose:** HTTP polling-based transaction confirmation (replaces unreliable WebSocket)
- **Exports:** `pollTransactionConfirmation()`
- **Focus Tags:** [CHAIN-01, ERR-01]
- **Risk Markers:** 2-second poll interval, 90-second timeout, block height expiry check, must handle "confirmed with error" (skipPreflight case)

#### `app/lib/sentry.ts`
- **Purpose:** Zero-dependency Sentry error reporter via raw fetch()
- **Exports:** `captureException()`
- **Focus Tags:** [WEB-02, SEC-02]
- **Risk Markers:** fire-and-forget fetch (no await), DSN parsing, Sentry envelope construction, silently swallows all errors

#### `app/lib/sse-manager.ts`
- **Purpose:** Server-side SSE broadcast manager singleton
- **Exports:** `sseManager`
- **Focus Tags:** [API-04, INFRA-03]
- **Risk Markers:** in-process event bus, no authentication on SSE connections

#### `app/lib/solscan.ts`
- **Purpose:** Solscan URL builder for transaction/account links
- **Exports:** URL builder functions
- **Focus Tags:** []
- **Risk Markers:** none

#### `app/lib/jupiter.ts`
- **Purpose:** Jupiter DEX integration placeholder
- **Exports:** Jupiter API types/helpers
- **Focus Tags:** [WEB-02]
- **Risk Markers:** external API dependency

#### `app/lib/audio-manager.ts`
- **Purpose:** Audio playback management for UI sound effects
- **Exports:** AudioManager class
- **Focus Tags:** []
- **Risk Markers:** none

#### `app/lib/image-data.ts`
- **Purpose:** Base64-encoded image data for UI assets
- **Exports:** Image data constants
- **Focus Tags:** []
- **Risk Markers:** none

#### `app/lib/empty.ts`
- **Purpose:** Empty module placeholder
- **Focus Tags:** []
- **Risk Markers:** none

### app/hooks/

#### `app/hooks/useSwap.ts`
- **Purpose:** Full swap lifecycle orchestrator (quoting, building, signing, confirming)
- **Exports:** `useSwap()`, `UseSwapReturn`, `SwapQuote`, `SwapStatus`
- **Focus Tags:** [CHAIN-01, CHAIN-03, LOGIC-01, FE-01, ERR-01]
- **Risk Markers:** constructs and signs transactions, financial math (base unit conversion), slippage enforcement, priority fee configuration, auto-reset timer, debounced quoting

#### `app/hooks/useProtocolWallet.ts`
- **Purpose:** Unified wallet abstraction with sign-then-send TX submission
- **Exports:** `useProtocolWallet()`, `ProtocolWallet`
- **Focus Tags:** [CHAIN-01, SEC-01, FE-01]
- **Risk Markers:** sign-then-send pattern (bypasses wallet's RPC), raw transaction serialization, sendRawTransaction to our RPC

#### `app/hooks/useStaking.ts`
- **Purpose:** Full staking lifecycle orchestrator (stake/unstake/claim)
- **Exports:** `useStaking()`, `UseStakingReturn`
- **Focus Tags:** [CHAIN-01, LOGIC-01, LOGIC-02, FE-01]
- **Risk Markers:** BigInt reward calculation, cooldown enforcement, signs transactions, on-chain data polling

#### `app/hooks/useRoutes.ts`
- **Purpose:** Route computation hook with auto-refresh and split routing
- **Exports:** `useRoutes()`
- **Focus Tags:** [LOGIC-01, FE-01]
- **Risk Markers:** 15-second auto-refresh countdown, split route building, route selection state

#### `app/hooks/useEpochState.ts`
- **Purpose:** WebSocket subscription to EpochState PDA with visibility gating
- **Exports:** `useEpochState()`
- **Focus Tags:** [CHAIN-06, FE-01]
- **Risk Markers:** WebSocket subscription lifecycle, Anchor account deserialization, BN-to-number conversion, visibility-aware pause/resume

#### `app/hooks/useCurveState.ts`
- **Purpose:** WebSocket subscription to both CurveState PDAs
- **Exports:** `useCurveState()`
- **Focus Tags:** [CHAIN-06, FE-01]
- **Risk Markers:** dual WebSocket subscriptions, u64 as bigint, Anchor enum normalization, Sentry error reporting after 3 consecutive failures

#### `app/hooks/usePoolPrices.ts`
- **Purpose:** WebSocket subscription to AMM pool reserve state
- **Exports:** `usePoolPrices()`
- **Focus Tags:** [CHAIN-06, FE-01]
- **Risk Markers:** pool state deserialization, reserve byte offset parsing (offset 137/145)

#### `app/hooks/useTokenBalances.ts`
- **Purpose:** Polls SOL, CRIME, FRAUD, PROFIT balances for connected wallet
- **Exports:** `useTokenBalances()`
- **Focus Tags:** [CHAIN-06, FE-01]
- **Risk Markers:** Token-2022 balance fetching, 30-second polling interval

#### `app/hooks/useCarnageEvents.ts`
- **Purpose:** Fetches last 5 carnage events from API
- **Exports:** `useCarnageEvents()`
- **Focus Tags:** [FE-01, API-04]
- **Risk Markers:** API data fetching

#### `app/hooks/useCarnageData.ts`
- **Purpose:** Combines carnage events with carnage fund vault balance
- **Exports:** `useCarnageData()`
- **Focus Tags:** [CHAIN-06, FE-01]
- **Risk Markers:** on-chain vault balance reading

#### `app/hooks/useCurrentSlot.ts`
- **Purpose:** WebSocket subscription to current Solana slot
- **Exports:** `useCurrentSlot()`
- **Focus Tags:** [CHAIN-06]
- **Risk Markers:** slot subscription lifecycle

#### `app/hooks/useChartSSE.ts`
- **Purpose:** SSE EventSource client for real-time candle updates
- **Exports:** `useChartSSE()`
- **Focus Tags:** [FE-01, API-04]
- **Risk Markers:** EventSource lifecycle management

#### `app/hooks/useChartData.ts`
- **Purpose:** Chart data management combining REST history with SSE updates
- **Exports:** `useChartData()`
- **Focus Tags:** [FE-01, DATA-01]
- **Risk Markers:** data merging (historical + real-time)

#### `app/hooks/useSolPrice.ts`
- **Purpose:** Fetches SOL/USD price from API proxy
- **Exports:** `useSolPrice()`
- **Focus Tags:** [WEB-02, FE-01]
- **Risk Markers:** external price dependency

#### `app/hooks/useSettings.ts`
- **Purpose:** Settings context consumer (slippage, priority fees)
- **Exports:** `useSettings()`
- **Focus Tags:** [FE-01]
- **Risk Markers:** none

#### `app/hooks/useModal.ts`
- **Purpose:** Modal visibility state management
- **Exports:** `useModal()`
- **Focus Tags:** []
- **Risk Markers:** none

#### `app/hooks/useVisibility.ts`
- **Purpose:** Tab visibility and station-level visibility tracking
- **Exports:** `useVisibility()`
- **Focus Tags:** []
- **Risk Markers:** none

#### `app/hooks/useAudio.ts`
- **Purpose:** Audio context consumer
- **Exports:** `useAudio()`
- **Focus Tags:** []
- **Risk Markers:** none

### app/db/

#### `app/db/connection.ts`
- **Purpose:** Lazy singleton Postgres connection via Drizzle ORM with globalThis caching
- **Exports:** `db` (Proxy-wrapped DrizzleDB instance)
- **Focus Tags:** [DATA-01, DATA-04, INFRA-03, SEC-02]
- **Risk Markers:** DATABASE_URL from env var, connection string handling, max 10 connections (Railway limit), globalThis singleton survives HMR, Proxy for lazy initialization

#### `app/db/schema.ts`
- **Purpose:** Drizzle ORM table definitions for swap_events, candles, epoch_events, carnage_events
- **Exports:** `swapEvents`, `candles`, `epochEvents`, `carnageEvents`
- **Focus Tags:** [DATA-01, DATA-04]
- **Risk Markers:** schema defines primary keys and unique constraints, TX signature as natural idempotency key

#### `app/db/candle-aggregator.ts`
- **Purpose:** OHLCV candle upsert at 6 resolutions with SQL GREATEST/LEAST
- **Exports:** `upsertCandles()`, `upsertCandlesForSwap()`
- **Focus Tags:** [DATA-01, INJ-03, LOGIC-01]
- **Risk Markers:** raw SQL in onConflictDoUpdate (GREATEST/LEAST), price derivation logic (tax exclusion), 6 parallel DB writes per swap event, division-by-zero guard

#### `app/db/migrate.ts`
- **Purpose:** Programmatic Drizzle migration runner for Railway preDeployCommand
- **Exports:** (script entry point)
- **Focus Tags:** [DATA-01, DATA-04, INFRA-03]
- **Risk Markers:** DATABASE_URL from env var, single-connection migration client, exit code drives deployment

### app/app/api/

#### `app/app/api/webhooks/helius/route.ts`
- **Purpose:** Helius raw webhook handler -- parses Anchor events, stores in Postgres, broadcasts SSE
- **Exports:** `POST()` handler
- **Focus Tags:** [API-04, INJ-03, DATA-01, SEC-02, ERR-02]
- **Risk Markers:** OPTIONAL webhook auth (HELIUS_WEBHOOK_SECRET skipped if unset), parses untrusted JSON body, DB writes (onConflictDoNothing for idempotency), per-transaction error isolation (batch continues on single TX failure), SSE broadcast of price data, ExemptSwap filtering to prevent false price data

#### `app/app/api/candles/route.ts`
- **Purpose:** REST API for historical OHLCV candle data with gap-fill
- **Exports:** `GET()` handler
- **Focus Tags:** [API-04, DATA-01, INJ-03]
- **Risk Markers:** query parameter parsing (pool, resolution, from, to, limit), limit capping at 2000, gap-fill synthetic candle generation

#### `app/app/api/sol-price/route.ts`
- **Purpose:** Server-side SOL/USD price proxy with CoinGecko/Binance fallback
- **Exports:** `GET()` handler
- **Focus Tags:** [WEB-02, API-04]
- **Risk Markers:** external API calls (CoinGecko, Binance), 60-second cache, no auth

#### `app/app/api/sse/candles/route.ts`
- **Purpose:** SSE streaming endpoint for real-time candle updates
- **Exports:** `GET()` handler (ReadableStream)
- **Focus Tags:** [API-04, INFRA-03]
- **Risk Markers:** long-lived HTTP connection, 15-second heartbeat, no authentication, ReadableStream lifecycle

#### `app/app/api/health/route.ts`
- **Purpose:** Health check endpoint checking Postgres and Solana RPC connectivity
- **Exports:** `GET()` handler
- **Focus Tags:** [INFRA-03]
- **Risk Markers:** always returns 200 (even degraded), exposes dependency status

#### `app/app/api/carnage-events/route.ts`
- **Purpose:** REST API for last 5 carnage events from Postgres
- **Exports:** `GET()` handler
- **Focus Tags:** [API-04, DATA-01]
- **Risk Markers:** DB query, no authentication, no pagination

### app/providers/

#### `app/providers/providers.tsx`
- **Purpose:** Root provider composition (wallet-adapter, settings, audio, modal)
- **Exports:** `Providers` component
- **Focus Tags:** [FE-01, INFRA-05]
- **Risk Markers:** wallet-adapter configuration, RPC endpoint setup

#### `app/providers/SettingsProvider.tsx`
- **Purpose:** Settings context provider (slippage BPS, priority fees, preferences)
- **Exports:** `SettingsProvider`, settings context
- **Focus Tags:** [FE-01]
- **Risk Markers:** localStorage persistence of user settings

#### `app/providers/AudioProvider.tsx`
- **Purpose:** Audio context provider for sound effect management
- **Exports:** `AudioProvider`
- **Focus Tags:** []
- **Risk Markers:** none

### app/components/ (Security-Relevant Only)

#### `app/components/swap/SwapForm.tsx`
- **Purpose:** Main swap form UI consuming useSwap hook
- **Focus Tags:** [FE-01]
- **Risk Markers:** displays financial amounts, TX status

#### `app/components/launch/BuySellPanel.tsx`
- **Purpose:** Bonding curve buy/sell panel
- **Focus Tags:** [FE-01, CHAIN-01]
- **Risk Markers:** builds and submits curve purchase/sell TXs

#### `app/components/launch/BuyForm.tsx`
- **Purpose:** Bonding curve buy form with preview
- **Focus Tags:** [FE-01, LOGIC-01]
- **Risk Markers:** BigInt curve math for preview, SOL amount validation

#### `app/components/launch/SellForm.tsx`
- **Purpose:** Bonding curve sell form with 15% tax display
- **Focus Tags:** [FE-01, LOGIC-01]
- **Risk Markers:** sell tax calculation display

#### `app/components/launch/RefundPanel.tsx`
- **Purpose:** Curve refund claim UI (deadline/failed curves)
- **Focus Tags:** [FE-01, CHAIN-01]
- **Risk Markers:** refund TX construction

#### `app/components/launch/LaunchWalletButton.tsx`
- **Purpose:** Wallet connection button for launch page
- **Focus Tags:** [FE-01]
- **Risk Markers:** wallet adapter integration

#### `app/components/wallet/WalletButton.tsx`
- **Purpose:** Global wallet connection/disconnect button
- **Focus Tags:** [FE-01]
- **Risk Markers:** wallet adapter integration

#### `app/components/wallet/ConnectModal.tsx`
- **Purpose:** Wallet selection modal
- **Focus Tags:** [FE-01]
- **Risk Markers:** wallet adapter modal

#### `app/components/staking/StakingForm.tsx`
- **Purpose:** Staking form consuming useStaking hook
- **Focus Tags:** [FE-01]
- **Risk Markers:** displays reward amounts, TX status

_Note: ~50 remaining component files (kit/, scene/, chart/, modal/, etc.) are pure presentational with no security-relevant logic. Not individually indexed._

### app/ (root config)

#### `app/drizzle.config.ts`
- **Purpose:** Drizzle Kit configuration for migration generation
- **Focus Tags:** [DATA-04]
- **Risk Markers:** references DATABASE_URL

#### `app/instrumentation.ts`
- **Purpose:** Next.js server-side instrumentation hook
- **Focus Tags:** []
- **Risk Markers:** none

#### `app/instrumentation-client.ts`
- **Purpose:** Next.js client-side instrumentation hook
- **Focus Tags:** []
- **Risk Markers:** none

#### `app/next.config.ts`
- **Purpose:** Next.js configuration (transpilePackages, webpack, headers)
- **Focus Tags:** [WEB-02, INFRA-05]
- **Risk Markers:** CSP headers, CORS configuration, external package resolution

### tests/

#### `tests/security.ts`
- **Purpose:** Security test suite -- access control, unauthorized actions, overflow checks
- **Focus Tags:** [SEC-01, CHAIN-01]
- **Risk Markers:** tests attack vectors

#### `tests/security-account-validation.ts`
- **Purpose:** Account validation tests -- wrong accounts, missing signers
- **Focus Tags:** [SEC-01]
- **Risk Markers:** tests account substitution attacks

#### `tests/integration/access-control.test.ts`
- **Purpose:** Integration tests for authority checks across all programs
- **Focus Tags:** [SEC-01]
- **Risk Markers:** tests unauthorized callers

#### `tests/integration/cpi-chains.test.ts`
- **Purpose:** CPI chain integration tests (Tax->AMM->Hook)
- **Focus Tags:** [CHAIN-03, CHAIN-04]
- **Risk Markers:** verifies CPI account forwarding

#### `tests/integration/lifecycle.test.ts`
- **Purpose:** Full protocol lifecycle integration tests
- **Focus Tags:** [CHAIN-01, LOGIC-01]
- **Risk Markers:** end-to-end protocol flow

#### `tests/integration/carnage.test.ts`
- **Purpose:** Carnage execution integration tests (6 paths)
- **Focus Tags:** [CHAIN-01, LOGIC-01]
- **Risk Markers:** tests carnage buy/burn/sell paths

#### `tests/integration/smoke.test.ts`
- **Purpose:** Quick smoke tests for basic protocol operations
- **Focus Tags:** [CHAIN-01]
- **Risk Markers:** basic swap execution

#### `tests/staking.ts`
- **Purpose:** Staking program unit tests
- **Focus Tags:** [LOGIC-01, CHAIN-01]
- **Risk Markers:** reward math verification

#### `tests/token-flow.ts`
- **Purpose:** Token flow tests (minting, transfers, hook enforcement)
- **Focus Tags:** [CHAIN-04, SEC-01]
- **Risk Markers:** Transfer Hook whitelist enforcement

#### `tests/cross-program-integration.ts`
- **Purpose:** Cross-program integration tests
- **Focus Tags:** [CHAIN-03]
- **Risk Markers:** CPI chain verification

#### `tests/devnet-vrf.ts`
- **Purpose:** Devnet VRF integration tests
- **Focus Tags:** [CHAIN-01, BOT-01]
- **Risk Markers:** VRF flow execution

#### `tests/integration/helpers/protocol-init.ts`
- **Purpose:** Test protocol initialization (17-step sequence)
- **Focus Tags:** [CHAIN-01, DEP-01]
- **Risk Markers:** creates all protocol state for tests

#### `tests/integration/helpers/test-wallets.ts`
- **Purpose:** Test wallet generation and funding
- **Focus Tags:** [SEC-01]
- **Risk Markers:** keypair generation

#### `tests/integration/helpers/mock-vrf.ts`
- **Purpose:** Mock VRF for deterministic testing
- **Focus Tags:** [BOT-01]
- **Risk Markers:** VRF mocking

#### `tests/integration/helpers/constants.ts`
- **Purpose:** Test constants and PDA seeds
- **Focus Tags:** [CHAIN-06]
- **Risk Markers:** must match on-chain seeds

---

## Focus Area Cross-Reference

| Auditor ID | Description | Relevant Files |
|-----------|-------------|----------------|
| **SEC-01** | Key handling, signing, access control | `crank-provider.ts`, `crank-runner.ts`, `initialize.ts`, `graduate.ts`, `vrf-flow.ts`, `useProtocolWallet.ts`, `multi-hop-builder.ts`, `deploy/lib/connection.ts`, `user-setup.ts`, `security.ts`, `security-account-validation.ts`, `access-control.test.ts`, `deploy-all.sh` |
| **SEC-02** | Secrets in source, auth bypass | `shared/constants.ts` (Helius API key), `shared/programs.ts` (RPC URL with key), `webhooks/helius/route.ts` (optional auth), `db/connection.ts` (DATABASE_URL), `sentry.ts` (DSN), `webhook-manage.ts` |
| **CHAIN-01** | Transaction construction, signing, submission | `swap-builders.ts`, `multi-hop-builder.ts`, `staking-builders.ts`, `curve-tx-builder.ts`, `crank-runner.ts`, `vrf-flow.ts`, `graduate.ts`, `initialize.ts`, `confirm-transaction.ts`, `useSwap.ts`, `useStaking.ts`, `swap-flow.ts`, `carnage-flow.ts` |
| **CHAIN-02** | Irreversible operations | `initialize.ts` (authority burn), `graduate.ts` (Filled->Graduated) |
| **CHAIN-03** | CPI chains, account forwarding | `swap-builders.ts`, `staking-builders.ts`, `multi-hop-builder.ts`, `swap-flow.ts`, `cpi-chains.test.ts` |
| **CHAIN-04** | Transfer Hook accounts | `hook-resolver.ts`, `curve/hook-accounts.ts`, `swap-builders.ts`, `staking-builders.ts`, `curve-tx-builder.ts`, `token-flow.ts` |
| **CHAIN-05** | ALT, v0 transactions | `multi-hop-builder.ts`, `vrf-flow.ts`, `alt-helper.ts`, `carnage-flow.ts`, `create-alt.ts` |
| **CHAIN-06** | On-chain state reading, PDA derivation | `quote-engine.ts`, `route-engine.ts`, `curve-math.ts`, `curve-constants.ts`, `event-parser.ts`, `pda-manifest.ts`, `shared/constants.ts`, `useEpochState.ts`, `useCurveState.ts`, `usePoolPrices.ts`, `epoch-reader.ts`, `anchor.ts` |
| **BOT-01** | Crank/keeper automation | `crank-runner.ts`, `vrf-flow.ts`, `overnight-runner.ts`, `devnet-vrf-validation.ts`, `mock-vrf.ts` |
| **BOT-02** | Bot resilience, retry logic | `crank-runner.ts` (30s retry, graceful shutdown), `overnight-runner.ts` |
| **API-04** | API route security, input validation | `webhooks/helius/route.ts`, `candles/route.ts`, `sse/candles/route.ts`, `carnage-events/route.ts`, `sol-price/route.ts`, `webhook-manage.ts` |
| **INJ-03** | SQL injection, untrusted input | `candle-aggregator.ts` (raw SQL in upsert), `webhooks/helius/route.ts` (parses untrusted JSON), `candles/route.ts` (query params) |
| **INJ-04** | Deserialization of untrusted data | `event-parser.ts` (Borsh deserialization from log messages) |
| **DATA-01** | Database operations, data integrity | `db/connection.ts`, `db/schema.ts`, `candle-aggregator.ts`, `webhooks/helius/route.ts`, `candles/route.ts`, `carnage-events/route.ts`, `backfill-candles.ts`, `migrate.ts` |
| **DATA-04** | Schema/migration safety | `db/schema.ts`, `db/connection.ts`, `drizzle.config.ts`, `migrate.ts` |
| **ERR-01** | Error handling, crash safety | `crank-runner.ts`, `confirm-transaction.ts`, `multi-hop-builder.ts`, `useSwap.ts`, `vrf-flow.ts` |
| **ERR-02** | Error message information leakage | `swap/error-map.ts`, `staking/error-map.ts`, `curve/error-map.ts`, `event-parser.ts`, `webhooks/helius/route.ts` |
| **DEP-01** | Deployment pipeline, build safety | `deploy-all.sh`, `build.sh`, `deploy.sh`, `initialize.ts`, `verify.ts`, `patch-mint-addresses.ts`, `pda-manifest.ts`, `shared/constants.ts`, `anchor.ts` |
| **FE-01** | Frontend security, user-facing display | `useSwap.ts`, `useStaking.ts`, `useProtocolWallet.ts`, `useRoutes.ts`, `useCurveState.ts`, `SwapForm.tsx`, `BuySellPanel.tsx`, `BuyForm.tsx`, `SellForm.tsx`, `providers.tsx` |
| **WEB-02** | External API dependencies, CSP | `sol-price/route.ts`, `sentry.ts`, `jupiter.ts`, `next.config.ts` |
| **LOGIC-01** | Financial math correctness | `quote-engine.ts`, `route-engine.ts`, `split-router.ts`, `curve-math.ts`, `rewards.ts`, `useSwap.ts`, `useStaking.ts`, `candle-aggregator.ts`, `swap-flow.ts` |
| **LOGIC-02** | Math parity with on-chain code | `quote-engine.ts`, `curve-math.ts`, `curve-constants.ts`, `rewards.ts`, `route-engine.ts`, `split-router.ts`, `pda-manifest.ts`, `staking-builders.ts` |
| **INFRA-03** | Infrastructure config, connection management | `db/connection.ts`, `lib/connection.ts`, `crank-provider.ts`, `deploy/lib/connection.ts`, `alt-helper.ts`, `sse-manager.ts`, `health/route.ts`, `migrate.ts` |
| **INFRA-05** | Environment variable handling, config | `shared/constants.ts`, `shared/programs.ts`, `lib/connection.ts`, `providers.tsx`, `next.config.ts` |
