# Phase 96: Protocol E2E Testing - Context

**Gathered:** 2026-03-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Every protocol feature exercised on the fresh Phase 95 deployment -- swaps, taxes, epochs, carnage, staking, conversion vault, and frontend accuracy. Includes chart fix, 50-wallet stress test, and 24hr crank soak. Requirements: E2E-01 through E2E-12.

</domain>

<decisions>
## Implementation Decisions

### Test execution approach
- Migrate existing `devnet-e2e-validation.ts` and `lib/` helpers to read from `deployments/devnet.json` (not pda-manifest.json)
- Full script suite covering: all 8 swap pairs + tax verification (75/24/1) + staking lifecycle (stake/earn/claim/unstake) + conversion vault (CRIME<->FRAUD)
- User also does thorough manual frontend testing independently (all swap pairs, staking, vault via UI)
- Epoch/VRF and Carnage testing: observe Railway crank advancing epochs naturally (no script-triggered epochs). Script waits for epoch changes, verifies tax rates changed, checks for Carnage events

### Chart debugging and volume generation
- Charts currently broken -- needs diagnosis and fix as a dedicated wave
- After fix, run scripted volume generation (from the 50-wallet stress test) to populate chart data
- User watches charts in real-time to validate OHLCV rendering, candle formation, and visual accuracy
- Falls under E2E-07 (frontend displays correct real-time data)

### Overnight soak test
- Uses existing Railway crank health endpoint for crash detection
- Soak starts AFTER all other E2E tests pass (final gate)
- Verification: quick script reads current EpochState, compares to expected epoch count (24hrs / epoch duration), checks Railway health endpoint, outputs pass/fail
- Priority fee economics (E2E-09) observed during soak -- crank TXs landing reliably = pass

### Edge case testing
- Scripted edge cases added to e2e suite: zero-amount swap rejection, insufficient balance error, slippage protection trigger
- Automated pass/fail for each edge case

### Mobile wallet testing
- E2E-11 PRE-APPROVED: User has already confirmed Phantom mobile deep-link works. Will do additional manual testing in own time. No script needed.

### Multi-wallet stress test
- 50 concurrent wallets generated and funded from devnet wallet
- All 50 bots execute random swaps across all 8 pairs (random pool + direction + small amounts 0.001-0.01 SOL range + random delays 0.5-3s)
- User trades manually via frontend simultaneously -- simulates real production traffic
- Verifies no interference, all TXs succeed, balances correct
- Also serves as volume generation for chart testing

### Verification and reporting
- Formal markdown report: `Docs/e2e-test-report.md` -- each E2E requirement listed with test method (script/manual), result (pass/fail), TX signatures, timestamps
- Becomes mainnet readiness evidence (like pathway2-report.md)
- Frontend data accuracy (E2E-07): script reads on-chain state, user visually cross-checks against frontend display

### Claude's Discretion
- Exact migration approach for e2e scripts (which helpers need changes, adapter pattern vs rewrite)
- 50-wallet script architecture (parallel execution strategy, error handling per wallet)
- Chart debugging approach (diagnose webhook pipeline, Helius indexer, TradingView integration)
- Soak verification script implementation details
- Report formatting and section structure
- Wave ordering within plans

</decisions>

<specifics>
## Specific Ideas

- Charts broken: likely webhook pipeline or OHLCV indexer issue -- needs investigation before volume testing makes sense
- 50-wallet stress test doubles as chart volume generator -- one script serves two purposes
- The stress test with user trading on top is meant to simulate "what launch day could look like"
- Soak test is the final gate -- everything else must pass first
- E2E-11 (mobile) already human-verified, just needs formal sign-off in report

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scripts/e2e/devnet-e2e-validation.ts`: Main e2e orchestrator (swap flow + vault tests, FULL=1 mode)
- `scripts/e2e/lib/`: Shared utilities (user-setup.ts, swap-flow.ts, e2e-logger.ts, e2e-reporter.ts)
- `scripts/e2e/security-verification.ts`: Edge case patterns (can extend for E2E-10)
- `scripts/e2e/smoke-test.ts`: Single swap verification pattern
- `scripts/crank/crank-runner.ts`: Railway crank with health endpoint
- `scripts/deploy/verify.ts`: On-chain state verification (reads deployment.json)

### Established Patterns
- E2E scripts use `loadProvider()` + `loadPrograms()` from `scripts/deploy/lib/connection.ts`
- `createE2EUser()` for funded test wallets
- JSONL logging via `E2ELogger`, markdown reports via `E2EReporter`
- `set -a && source .env.devnet && set +a` for env loading
- `deployments/devnet.json` is canonical address source (Phase 91)

### Integration Points
- `deployments/devnet.json` -- all program IDs, mints, PDAs, pools
- Railway crank health endpoint for soak monitoring
- Helius webhook pipeline -> Postgres -> /api/candles for chart data
- Frontend reads from `shared/constants.ts` (generated from deployment.json)
- TradingView lightweight-charts v5 for chart rendering

</code_context>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 96-protocol-e2e-testing*
*Context gathered: 2026-03-14*
