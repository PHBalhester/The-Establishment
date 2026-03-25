# Phase 94: Bonding Curve Deadline + Pathway 1 - Context

**Gathered:** 2026-03-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Verify the complete failure path end-to-end: deploy a partial protocol (Bonding Curve + Transfer Hook + CRIME/FRAUD mints), buy/sell tokens on both curves via frontend and scripts, let curves expire after ~30 minutes, claim proportional refunds via frontend, and verify all refund amounts are mathematically correct. Requirements: CURVE-01 through CURVE-05.

</domain>

<decisions>
## Implementation Decisions

### Devnet Deadline Timing
- 30 minutes (~4,500 slots at 400ms/slot) for devnet deadline
- Implemented as a new `#[cfg(feature = "devnet")]` variant in `constants.rs` — same pattern as localnet (500 slots) and mainnet (432,000 slots)
- Three compile-time variants: mainnet=432,000, devnet=4,500, localnet=500
- No runtime override — compile-time only, consistent with existing security pattern

### Devnet Curve Scaling
- TARGET_SOL scaled to 5 SOL per curve for devnet (instead of mainnet value)
- All dependent constants (TOTAL_FOR_SALE, P_START, P_END, pool seeding amounts) scaled proportionally for devnet feature flag
- This makes curves fillable with reasonable devnet SOL amounts

### Partial Deploy Procedure
- Modify `deploy-all.sh` with `--partial` flag to deploy only: Bonding Curve program + Transfer Hook program + CRIME/FRAUD mints (with Arweave metadata) + ALT + BcAdminConfig + whitelist entries for curve PDAs
- NOT deployed: AMM, Tax Program, Epoch Program, Staking, Conversion Vault, PROFIT mint
- Generates a **fresh `deployment.json`** — overwrites Phase 69 addresses (stale anyway, Pathway 2 will overwrite again)
- Curves initialized with 30-min devnet deadline after deploy
- Frontend deployed to Railway with updated env vars pointing to new addresses

### Test Wallet Strategy
- 5+ wallets participate in both curves
- Your devnet wallet: manual buy/sell via frontend on both curves
- 5+ script-controlled wallets: programmatic varied buys AND sells
  - Different amounts per wallet (min buy, medium, near wallet cap)
  - Some buy on both curves, some only one
  - Some buy-then-partial-sell (exercises sell tax escrow inclusion in refund pool)
- All SOL funded from your devnet wallet (no faucet dependency)
- Reusable `pathway1-test.ts` script that generates wallets, funds them, executes varied buy/sell patterns, logs everything to JSON for verification

### Refund Verification
- Automated `verify-refunds.ts` script:
  - Reads pathway1-test.ts log (wallet addresses, buy/sell amounts, token holdings)
  - Calculates expected refund per wallet: proportional to token holdings x (vault SOL + tax escrow)
  - Compares expected to actual SOL received after claiming
  - Pass/fail per wallet with detailed breakdown
- Frontend refund amount compared to on-chain: before claiming on your manual wallet, note the frontend's displayed refund estimate, then verify it matched the actual claim amount
- Manual frontend claim for your wallet (proves refund UI works), script claims for all script wallets
- Formal markdown report: `Docs/pathway1-report.md` with deploy addresses, wallet actions log, pre/post-claim balances, expected vs actual per wallet, pass/fail summary

### Claude's Discretion
- Exact script wallet count (5 is minimum, more if SOL budget allows)
- Buy/sell amount distribution across script wallets
- ALT address set for partial deploy (subset of full protocol ALT)
- Error handling and retry logic in test scripts
- deploy-all.sh --partial implementation details (which pipeline phases to skip)

</decisions>

<specifics>
## Specific Ideas

- pathway1-test.ts should be reusable across fresh deploys — generates its own keypairs, funds them, runs the test, outputs structured JSON log
- verify-refunds.ts consumes that JSON log and produces the markdown report
- Frontend refund estimate should be screenshot-verified or at minimum noted before claim
- The test proves both the on-chain refund math AND the frontend's display of refund amounts

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `programs/bonding_curve/src/constants.rs`: Already has `#[cfg(feature = "localnet")]` DEADLINE_SLOTS variant — add devnet variant following same pattern
- `scripts/deploy/deploy-all.sh`: 7-phase pipeline to extend with --partial flag
- `app/app/launch/page.tsx`: Launch page with pressure gauges, buy/sell panel, countdown timer, state machine rendering — already built
- `app/components/launch/StateMachineWrapper.tsx`: Handles curve state transitions including refund UI
- `deployment-schema.ts`: DeploymentConfig interface for deployment.json

### Established Patterns
- Feature flags: `#[cfg(feature = "devnet")]` for compile-time constants (used across bonding_curve, conversion-vault, tax-program, epoch-program)
- deploy-all.sh pipeline: Phase 0 (keypairs) -> Phase 1 (build --devnet) -> Phase 2 (deploy) -> Phase 3 (initialize) -> Phase 4 (verify)
- Idempotent scripts with checkpoint/resume (initialize.ts pattern)
- `set -a && source .env.devnet && set +a` for env loading before scripts

### Integration Points
- `deployment.json` receives new program IDs and mint addresses from partial deploy
- `.env.devnet` updated with curve-specific env vars
- Railway deployment env vars updated for frontend
- generate-constants.ts regenerates `shared/constants.ts` from new deployment.json
- Arweave metadata URIs from Phase 93 used during mint creation

</code_context>

<deferred>
## Deferred Ideas

- **Mainnet curve target reduced to 500 SOL** (from 1000 SOL): Executive decision made 2026-03-13 due to market conditions. Cascades to TARGET_SOL, P_START/P_END pricing, pool seeding amounts, and all documentation. Needs its own phase/task to update mainnet constants + specs + docs comprehensively. NOT a Phase 94 concern (Phase 94 uses devnet 5 SOL values).

</deferred>

---

*Phase: 94-bonding-curve-deadline-pathway-1*
*Context gathered: 2026-03-13*
