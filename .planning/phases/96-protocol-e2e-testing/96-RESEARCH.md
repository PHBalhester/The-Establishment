# Phase 96: Protocol E2E Testing - Research

**Researched:** 2026-03-14
**Domain:** Devnet E2E validation -- scripts, chart debugging, stress testing, soak test
**Confidence:** HIGH (codebase investigation, no external libraries needed)

## Summary

Phase 96 validates every protocol feature on the fresh Phase 95 deployment through scripted E2E tests, chart debugging, multi-wallet stress testing, and a 24-hour crank soak. The existing codebase has substantial E2E infrastructure (`scripts/e2e/`) but it is wired to `pda-manifest.json` (the pre-Phase-91 address source) and needs migration to `deployments/devnet.json`.

The protocol has 2 AMM pools (CRIME/SOL, FRAUD/SOL) and a conversion vault (CRIME<->FRAUD at 100:1, CRIME/FRAUD<->PROFIT at 100:1). PROFIT pools were removed in Phase 69. The "8 swap pairs" in E2E-01 refer to the 8 directional routes through these pools + vault (e.g., SOL->CRIME direct, SOL->PROFIT multi-hop via CRIME+vault, CRIME->FRAUD multi-hop via SOL or vault, etc). Some are multi-hop.

Chart data flows through Helius webhooks -> Postgres candle-aggregator -> `/api/candles` REST -> TradingView lightweight-charts. Charts are reported broken and need diagnosis as a prerequisite to chart-related testing.

**Primary recommendation:** Structure work in 4 waves: (1) migrate E2E scripts to deployments/devnet.json + expand to all 8 pairs + tax verification, (2) chart debugging + staking/epoch/carnage observation + edge cases, (3) 50-wallet stress test + volume generation + chart visual validation, (4) 24hr soak test as final gate.

## Standard Stack

No new libraries needed. This phase uses existing infrastructure.

### Core (Already in Project)
| Library | Purpose | Location |
|---------|---------|----------|
| `@coral-xyz/anchor` | Program interaction (Anchor provider + typed IDL) | `scripts/deploy/lib/connection.ts` |
| `@solana/web3.js` | Core Solana RPC + transaction building | All scripts |
| `@solana/spl-token` | Token-2022 account creation, transfer hook resolution | `scripts/e2e/lib/` |
| `scripts/e2e/lib/e2e-logger.ts` | JSONL crash-safe logging | Existing |
| `scripts/e2e/lib/e2e-reporter.ts` | Markdown report generation | Existing |
| `scripts/e2e/lib/user-setup.ts` | Fresh test wallet creation with token accounts | Existing |
| `scripts/e2e/lib/swap-flow.ts` | SOL buy/sell swaps with tax verification | Existing |
| `scripts/e2e/lib/staking-flow.ts` | Stake/claim/unstake lifecycle | Existing |
| `scripts/e2e/lib/carnage-flow.ts` | Carnage trigger + observation | Existing |

### Supporting
| Tool | Purpose | When to Use |
|------|---------|-------------|
| `deployments/devnet.json` | Canonical address source (Phase 91) | Every script that needs program IDs, mints, PDAs, pools |
| `scripts/crank/crank-runner.ts` | Railway crank with `/health` endpoint | Soak test monitoring |
| `app/app/api/candles/route.ts` | OHLCV REST endpoint | Chart debugging |
| `app/app/api/webhooks/helius/route.ts` | Helius webhook -> Postgres | Chart pipeline root |

### Not Needed
| Instead of | Why Not |
|------------|---------|
| Playwright/Cypress | User does manual frontend testing; scripts validate on-chain state |
| New test framework | Existing JSONL logger + reporter pattern is sufficient |
| Additional npm packages | All dependencies already installed |

## Architecture Patterns

### Script Migration Pattern: pda-manifest -> deployments/devnet.json

The key migration is changing address loading from `pda-manifest.json` to `deployments/devnet.json`. Six files reference `pda-manifest.json`:

1. `scripts/e2e/devnet-e2e-validation.ts` (line 93)
2. `scripts/e2e/security-verification.ts` (line 792)
3. `scripts/e2e/carnage-hunter.ts` (line 158)
4. `scripts/e2e/smoke-test.ts` (line 31)
5. `scripts/e2e/overnight-runner.ts` (line 194)
6. `scripts/e2e/lib/user-setup.ts` (comment only -- uses ManifestMints interface)

**Pattern:** Create a `loadDeployment()` adapter function that reads `deployments/devnet.json` and returns an object matching the `PDAManifest` interface shape. This way existing code consuming the manifest needs minimal changes -- only the loading line changes, not every downstream reference.

```typescript
// Adapter: deployments/devnet.json -> PDAManifest shape
import * as fs from "fs";
import * as path from "path";

export function loadDeployment(): PDAManifest {
  const deployPath = path.resolve(__dirname, "../../deployments/devnet.json");
  const deploy = JSON.parse(fs.readFileSync(deployPath, "utf-8"));
  return {
    programs: {
      AMM: deploy.programs.amm,
      TransferHook: deploy.programs.transferHook,
      TaxProgram: deploy.programs.taxProgram,
      EpochProgram: deploy.programs.epochProgram,
      Staking: deploy.programs.staking,
      ConversionVault: deploy.programs.conversionVault,
      BondingCurve: deploy.programs.bondingCurve,
    },
    mints: {
      CRIME: deploy.mints.crime,
      FRAUD: deploy.mints.fraud,
      PROFIT: deploy.mints.profit,
    },
    pdas: deploy.pdas,
    pools: {
      crimeSol: deploy.pools.crimeSol,
      fraudSol: deploy.pools.fraudSol,
    },
  };
}
```

### 8 Swap Pairs Mapping

The protocol has 4 tokens (SOL, CRIME, FRAUD, PROFIT) with 2 AMM pools + conversion vault. The 8 swap pairs from E2E-01 map to:

| # | Pair | Route Type | Mechanism |
|---|------|-----------|-----------|
| 1 | SOL -> CRIME | Direct | AMM CRIME/SOL buy |
| 2 | CRIME -> SOL | Direct | AMM CRIME/SOL sell |
| 3 | SOL -> FRAUD | Direct | AMM FRAUD/SOL buy |
| 4 | FRAUD -> SOL | Direct | AMM FRAUD/SOL sell |
| 5 | CRIME -> PROFIT | Multi-hop | Vault: CRIME -> PROFIT (100:1) |
| 6 | PROFIT -> CRIME | Multi-hop | Vault: PROFIT -> CRIME (1:100) |
| 7 | FRAUD -> PROFIT | Multi-hop | Vault: FRAUD -> PROFIT (100:1) |
| 8 | PROFIT -> FRAUD | Multi-hop | Vault: PROFIT -> FRAUD (1:100) |

**Tax behavior:**
- SOL pool swaps (pairs 1-4): Taxed at epoch rate, distributed 75/24/1 (staking escrow / carnage vault / treasury)
- Vault conversions (pairs 5-8): Untaxed (fixed rate conversion)

Note: The existing `runSwapFlow()` in `swap-flow.ts` tests SOL pool buys/sells. The existing `runVaultTests()` tests vault conversions. Together they cover all 8 pairs but need to be extended with explicit per-pair pass/fail reporting and TX signature capture.

### Tax Distribution Verification Pattern

The existing `swap-flow.ts` already has balance-snapshot-before/after logic for verifying tax splits. The tax split is 75/24/1 (not 71/24/5 as in some older comments in the code). The current on-chain constants should be verified by reading EpochState.

**Pattern:** Before swap: snapshot escrow, carnage vault, treasury SOL balances. After swap: compute deltas. Verify ratios within 1 lamport rounding tolerance.

### 50-Wallet Stress Test Architecture

```
Main script:
1. Generate 50 Keypairs
2. Batch-fund all 50 via single TX (SystemProgram.transfer x 50)
   - Use 0.1 SOL per wallet (0.05 WSOL + 0.05 overhead)
   - Total: 5 SOL from devnet wallet
3. Create token accounts for each wallet (batched, 5 wallets per TX to fit size limit)
4. Run parallel swap loop:
   - Each wallet picks random: pool (CRIME/SOL or FRAUD/SOL), direction (buy/sell), amount (0.001-0.01 SOL)
   - Random delay between swaps: 0.5-3s
   - Run for N minutes (configurable, default 10)
5. Collect results: success count, failure count, error types
6. Verify: no wallet has negative balance, all TXs that succeeded have correct state
```

**Key constraints:**
- Helius free-tier rate limit: ~10 RPC calls/second. With 50 wallets, need staggered timing.
- Each wallet needs its own WSOL account (standard SPL Token) + CRIME/FRAUD token accounts (Token-2022).
- Token acquisition: wallets buy small amounts via SOL pool before attempting sells.
- Devnet SOL conservation: use minimal amounts (0.001-0.01 SOL swaps).

### Chart Debugging Approach

The chart pipeline has 4 stages to diagnose:

1. **Webhook delivery**: Is Helius sending raw TX webhooks to the Railway endpoint?
   - Check: Railway logs for webhook POSTs, or add a `/api/webhooks/helius/debug` temp endpoint
   - Common issue: Webhook URL changed after Phase 95 redeploy, needs re-registration with Helius

2. **Event parsing**: Are SwapExecuted events being parsed from logMessages?
   - Check: Postgres `swap_events` table -- any rows?
   - Common issue: Program ID mismatch in event discriminator after redeploy

3. **Candle aggregation**: Are swap events being aggregated into OHLCV candles?
   - Check: Postgres `candles` table -- any rows?
   - Check: Pool addresses in candle-aggregator match `deployments/devnet.json`

4. **Frontend rendering**: Does `/api/candles?pool=X&resolution=1m` return data?
   - Check: Direct API call
   - Check: TradingView chart component receives and renders the data

**Most likely root cause:** Helius webhook is still pointing at old program IDs / addresses from pre-Phase-95 deployment. Need to re-register webhook with new addresses.

### Soak Test Verification

```
Soak verification script:
1. Record start time + starting epoch number
2. Wait 24 hours (or check after 24 hours)
3. Read current EpochState: epoch_number, last_transition_slot
4. Expected epochs = 24h / epoch_duration (devnet: 750 slots * 0.4s/slot = 5 min = ~288 epochs/24h)
5. Check Railway /health endpoint responds 200
6. Check: no missed epochs (gap in epoch numbers)
7. Check: epoch_number >= start_epoch + expected_count * 0.9 (allow 10% tolerance for slot timing)
8. Output: PASS/FAIL with epoch count, uptime, any anomalies
```

### Report Structure (Docs/e2e-test-report.md)

```markdown
# E2E Test Report -- Phase 96

**Date:** YYYY-MM-DD
**Deployment:** Phase 95 (program IDs from deployments/devnet.json)
**Tester:** Script + Manual (user)

## Summary
| Requirement | Method | Result | Evidence |
|-------------|--------|--------|----------|
| E2E-01 | Script | PASS/FAIL | TX sigs |
| ... | ... | ... | ... |

## Detailed Results

### E2E-01: Swap Pairs (8/8)
[Per-pair results with TX signatures]

### E2E-02: Tax Distribution
[Snapshot deltas showing 75/24/1 split]

...

## Appendix
[Full TX signature log]
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Address loading | Custom parser for each script | `loadDeployment()` adapter over `deployments/devnet.json` | Single migration point, PDAManifest interface preserved |
| Tax verification math | Custom ratio calculator | Balance-delta snapshots (existing pattern in swap-flow.ts) | Already proven, handles rounding |
| Wallet funding | Individual airdrop calls | Batch SystemProgram.transfer in single TX | Airdrop rate-limited, transfer is instant |
| JSONL logging | Custom file writer | `E2ELogger` class (existing) | Crash-safe append, structured entries |
| Report generation | Manual markdown assembly | `E2EReporter` class (extend existing) | Consistent format, TX link generation |
| Hook account resolution | Manual PDA derivation | `resolveHookAccounts()` from swap-flow.ts | Handles Token-2022 ExtraAccountMeta correctly |

## Common Pitfalls

### Pitfall 1: pda-manifest.json Still Referenced Everywhere
**What goes wrong:** Scripts load old addresses from `pda-manifest.json`, not the Phase 95 deployment addresses from `deployments/devnet.json`.
**Why it happens:** 6 scripts still hardcode the pda-manifest path. The crank-runner already migrated (uses `loadManifest()` from crank-provider.ts which reads env vars), but E2E scripts did not.
**How to avoid:** Create a single `loadDeployment()` function; update all 6 scripts to use it.
**Warning signs:** "Account not found" or "Program ID mismatch" errors immediately on first swap attempt.

### Pitfall 2: Tax Split Ratio Changed
**What goes wrong:** Tests verify against 71/24/5 split (old ratio) instead of 75/24/1 (current).
**Why it happens:** Old comments in swap-flow.ts reference 71/24/5. The ratio was updated to 75/24/1 in a later phase.
**How to avoid:** Read the actual tax distribution constants from EpochState on-chain, don't hardcode in test.
**Warning signs:** Tax verification "fails" with off-by-a-few-percent errors.

### Pitfall 3: Helius Webhook Not Re-registered After Redeploy
**What goes wrong:** Charts show no data because webhooks are still monitoring old program IDs.
**Why it happens:** Phase 95 deployed fresh programs with new IDs. Helius webhook config was not updated.
**How to avoid:** Re-register Helius webhook with current program addresses from `deployments/devnet.json` as first step of chart debugging.
**Warning signs:** No new rows in Postgres `swap_events` table despite successful on-chain swaps.

### Pitfall 4: Devnet SOL Exhaustion During Stress Test
**What goes wrong:** 50 wallets * 0.1 SOL = 5 SOL minimum, plus token account rent (0.003 SOL * 4 accounts * 50 wallets = 0.6 SOL). Faucet rate-limits prevent quick recovery.
**Why it happens:** Token-2022 accounts have higher rent than standard SPL. Overhead adds up with 50 wallets.
**How to avoid:** Budget carefully: 0.05 SOL WSOL + 0.015 token account rent + 0.01 TX fees per wallet. Total ~4 SOL. Pre-check devnet wallet balance >= 6 SOL before starting.
**Warning signs:** "Insufficient funds" errors after wallet 30+.

### Pitfall 5: RPC Rate Limiting During Parallel Stress Test
**What goes wrong:** 50 wallets all hitting Helius simultaneously overwhelms free-tier rate limits.
**Why it happens:** Helius free tier allows ~10 TPS for RPC.
**How to avoid:** Stagger wallet activity with random delays (0.5-3s between swaps per wallet). Use `Promise.allSettled` not `Promise.all` so individual failures don't crash the entire test.
**Warning signs:** HTTP 429 errors from RPC, "blockhash not found" due to retry storms.

### Pitfall 6: Sell Swaps Require Pre-Acquired Tokens
**What goes wrong:** Stress test wallets try to sell tokens they don't have.
**Why it happens:** Fresh wallets only have WSOL. Must buy tokens before selling.
**How to avoid:** Each wallet's first swap must be a buy (SOL -> CRIME or SOL -> FRAUD). Track per-wallet token balances to know when sells are possible.
**Warning signs:** "Insufficient token balance" or zero-output swaps.

### Pitfall 7: v0 VersionedTransaction Needed for Sell Path
**What goes wrong:** Sell swaps fail with "Transaction too large" error.
**Why it happens:** Sell path requires 23 named accounts + 8 remaining (transfer hook accounts for both mints). Exceeds legacy TX size limit.
**How to avoid:** Use VersionedTransaction v0 with ALT for sell swaps. The ALT address is in `deployments/devnet.json` at `.alt`. Existing pattern in `carnage-flow.ts` and `alt-helper.ts`.
**Warning signs:** TX serialization error, "packet data too large".

### Pitfall 8: Soak Test -- Epoch Count Mismatch
**What goes wrong:** Soak verification expects ~288 epochs in 24h but gets fewer.
**Why it happens:** Devnet slot times vary (target 400ms but can spike). Crank also has delay between epoch cycles.
**How to avoid:** Use 10% tolerance on expected epoch count. Also check for no-gap (no skipped epoch numbers) rather than exact count.
**Warning signs:** FAIL verdict on an otherwise healthy crank.

## Code Examples

### Loading Deployment Config (Migration Pattern)
```typescript
// Source: deployments/devnet.json schema (Phase 91)
import * as fs from "fs";
import * as path from "path";
import { PDAManifest } from "../devnet-e2e-validation";

export function loadDeployment(): PDAManifest {
  const deployPath = path.resolve(__dirname, "../../../deployments/devnet.json");
  const d = JSON.parse(fs.readFileSync(deployPath, "utf-8"));
  return {
    programs: {
      AMM: d.programs.amm,
      TransferHook: d.programs.transferHook,
      TaxProgram: d.programs.taxProgram,
      EpochProgram: d.programs.epochProgram,
      Staking: d.programs.staking,
      ConversionVault: d.programs.conversionVault,
      BondingCurve: d.programs.bondingCurve,
    },
    mints: { CRIME: d.mints.crime, FRAUD: d.mints.fraud, PROFIT: d.mints.profit },
    pdas: d.pdas,
    pools: { crimeSol: d.pools.crimeSol, fraudSol: d.pools.fraudSol },
  };
}
```

### Batch Wallet Funding (50 Wallets)
```typescript
// Fund multiple wallets in batched TXs (10 per TX to fit size limit)
const BATCH_SIZE = 10;
for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
  const batch = wallets.slice(i, i + BATCH_SIZE);
  const tx = new Transaction();
  for (const w of batch) {
    tx.add(SystemProgram.transfer({
      fromPubkey: provider.wallet.publicKey,
      toPubkey: w.publicKey,
      lamports: FUND_PER_WALLET,
    }));
  }
  await provider.sendAndConfirm(tx, []);
  await sleep(RPC_DELAY_MS);
}
```

### Tax Distribution Verification
```typescript
// Snapshot before/after pattern (existing in swap-flow.ts)
const before = {
  escrow: await connection.getBalance(new PublicKey(manifest.pdas.escrowVault)),
  carnage: await connection.getBalance(new PublicKey(manifest.pdas.carnageSolVault)),
  treasury: await connection.getBalance(new PublicKey(manifest.pdas.treasury ?? treasury)),
};
// ... execute swap ...
const after = { /* same reads */ };
const deltaEscrow = after.escrow - before.escrow;
const deltaCarnage = after.carnage - before.carnage;
const deltaTreasury = after.treasury - before.treasury;
const totalTax = deltaEscrow + deltaCarnage + deltaTreasury;
// Verify ratios (75/24/1 with 1 lamport rounding tolerance)
assert(Math.abs(deltaEscrow - totalTax * 0.75) <= 1, "Escrow should be 75%");
assert(Math.abs(deltaCarnage - totalTax * 0.24) <= 1, "Carnage should be 24%");
assert(Math.abs(deltaTreasury - totalTax * 0.01) <= 1, "Treasury should be 1%");
```

### Soak Verification Script
```typescript
// Read EpochState after 24h soak
const epochState = await readEpochState(provider.connection, epochStatePda);
const elapsedEpochs = epochState.epochNumber - startEpoch;
const expectedEpochs = Math.floor(24 * 3600 / EPOCH_DURATION_SECONDS);
const tolerance = 0.1; // 10%
const pass = elapsedEpochs >= expectedEpochs * (1 - tolerance);

// Check health endpoint
const health = await fetch(`${RAILWAY_URL}/health`);
const healthPass = health.status === 200;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `pda-manifest.json` for addresses | `deployments/devnet.json` (Phase 91) | Phase 91 | E2E scripts must migrate |
| 71/24/5 tax split | 75/24/1 tax split | Phase 78+ | Tax verification assertions must use current ratios |
| PROFIT AMM pools | Conversion vault | Phase 69 | No PROFIT pool swaps -- vault only |
| Legacy TX for all swaps | v0 VersionedTX + ALT for sell path | Phase 52 | Stress test must use ALT for sells |

**Deprecated/outdated in E2E scripts:**
- `overnight-runner.ts`: Marked deprecated, replaced by Railway crank. Not needed for Phase 96.
- `carnage-hunter.ts`: Still uses pda-manifest. Needs migration if used.
- Tax ratio comments (71/24/5): Outdated in swap-flow.ts header comments.

## Open Questions

1. **Exact current tax split ratio**
   - What we know: Requirements say 75/24/1. Code comments say 71/24/5 (stale).
   - What's unclear: Whether it's exactly 75/24/1 or if there's been another update.
   - Recommendation: Read from on-chain EpochState at test time, don't hardcode.

2. **Helius webhook registration state**
   - What we know: Charts are broken, webhook was configured for pre-Phase-95 addresses.
   - What's unclear: Whether it's the webhook URL, auth secret, or program addresses that are stale.
   - Recommendation: First step of chart debugging is checking Helius dashboard for webhook config.

3. **PROFIT pools in E2E-01 wording**
   - What we know: E2E-01 says "8 swap pairs" including "CRIME/PROFIT buy/sell" and "FRAUD/PROFIT buy/sell".
   - What's unclear: These go through the conversion vault, not AMM pools. The wording may be intentional (vault = "swap" from user perspective) or confused.
   - Recommendation: Test all 8 directional routes. For PROFIT pairs, test vault conversion path. Document in report that PROFIT pairs use vault, not AMM.

## Sources

### Primary (HIGH confidence)
- `scripts/e2e/devnet-e2e-validation.ts` -- Current E2E orchestrator, line-by-line analysis
- `scripts/e2e/lib/swap-flow.ts` -- Swap execution + tax verification pattern
- `scripts/e2e/lib/staking-flow.ts` -- Staking lifecycle pattern
- `scripts/e2e/lib/user-setup.ts` -- Wallet creation pattern
- `scripts/crank/crank-runner.ts` -- Health endpoint, soak monitoring pattern
- `deployments/devnet.json` -- Canonical address source (Phase 95 deployment)
- `app/app/api/webhooks/helius/route.ts` -- Chart webhook pipeline
- `app/app/api/candles/route.ts` -- OHLCV REST API
- `app/lib/swap/route-types.ts` -- 8 swap route definitions
- `.planning/phases/96-protocol-e2e-testing/96-CONTEXT.md` -- User decisions

### Secondary (MEDIUM confidence)
- Tax ratio 75/24/1 -- from REQUIREMENTS.md E2E-02 wording. Should verify on-chain.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all code examined directly, no new libraries
- Architecture: HIGH -- patterns derived from existing working code
- Pitfalls: HIGH -- based on actual code issues found during research (stale pda-manifest refs, old tax ratios)
- Chart debugging: MEDIUM -- root cause is hypothesis (webhook re-registration), needs investigation

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable -- no external dependency changes expected)
