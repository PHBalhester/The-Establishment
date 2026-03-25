# Phase 38: Devnet Redeployment + Overnight E2E Validation - Research

**Researched:** 2026-02-13
**Domain:** Solana program upgrade-in-place, long-running E2E runner, Switchboard VRF gateway rotation
**Confidence:** HIGH (internal codebase) / MEDIUM (Switchboard SDK internals)

## Summary

Phase 38 has three workstreams: (1) redeploy Phase 37 program changes to devnet via in-place upgrade, (2) build an overnight runner that cycles 100 epochs with real swaps, staking, and VRF transitions, and (3) generate a morning report with JSONL epoch records and a Markdown summary.

The codebase already contains 95% of the building blocks needed. The deployment pipeline (`scripts/deploy/deploy.sh`) handles upgrades natively. The E2E scripts (`carnage-hunter.ts`, `swap-flow.ts`, `staking-flow.ts`, `vrf-flow.ts`, `carnage-flow.ts`) provide all the individual flow functions. The logger (`e2e-logger.ts`) and reporter (`e2e-reporter.ts`) handle JSONL and Markdown generation. The primary new work is: wiring these into an unattended overnight loop with gateway rotation, auto-airdrop safety net, graceful shutdown, and an epoch-level JSONL schema.

**Primary recommendation:** Build the overnight runner as a single TypeScript long-lived process extending the `carnage-hunter.ts` pattern. Implement gateway rotation at the `revealIx()` layer by catching gateway failures and fetching alternative gateways from the Crossbar client's `fetchGateways()` endpoint. Keep deployment as a manual pre-step using the existing `deploy.sh` script.

## Standard Stack

### Core (Already Installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@switchboard-xyz/on-demand` | 3.8.2 | VRF commit-reveal randomness | Already integrated in vrf-flow.ts |
| `@switchboard-xyz/common` | 5.7.0 | Gateway, CrossbarClient, feed utilities | Re-exported by on-demand SDK |
| `@coral-xyz/anchor` | workspace | Program interaction, IDL loading | Standard Solana framework |
| `@solana/web3.js` | 1.x | Solana RPC, transactions, keypairs | Core Solana SDK |
| `@solana/spl-token` | 0.4.x | Token-2022 transfers, Transfer Hook | Token operations |

### Supporting (Already Available)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `fs` (Node built-in) | N/A | JSONL append, report write | Crash-safe logging with appendFileSync |
| `path` (Node built-in) | N/A | File path resolution | Log/report file paths |
| `axios` | 1.x | Gateway HTTP calls (used by Switchboard SDK internally) | Not called directly; SDK wraps it |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| TypeScript long-lived process | Bash shell loop calling `npx tsx` per epoch | Shell loop has simpler error isolation but loses in-memory state, gateway cache, and connection reuse. TypeScript process is cleaner for 100-epoch runs with shared Switchboard setup |
| `appendFileSync` JSONL | SQLite or structured DB | JSONL is crash-safe (each write is atomic), human-readable, and zero-dependency. DB is overkill for 100 records |

**Installation:** No new packages needed. All dependencies already in `package.json`.

## Architecture Patterns

### Recommended Project Structure

```
scripts/
├── deploy/
│   ├── deploy.sh              # Existing -- handles upgrades
│   ├── build.sh               # Existing -- anchor build + verify
│   ├── initialize.ts          # Existing -- 19-step init (idempotent)
│   └── verify.ts              # Existing -- 34-check verification
├── e2e/
│   ├── overnight-runner.ts    # NEW -- main overnight loop
│   ├── lib/
│   │   ├── swap-flow.ts       # Existing -- executeSolBuySwap
│   │   ├── staking-flow.ts    # Existing -- stakePROFIT, claimYield
│   │   ├── carnage-flow.ts    # Existing -- testNaturalCarnage
│   │   ├── e2e-logger.ts      # Existing -- JSONL append logger
│   │   ├── e2e-reporter.ts    # Existing -- will need new OvernightReporter
│   │   └── user-setup.ts      # Existing -- createE2EUser
│   └── carnage-hunter.ts      # Existing reference pattern
└── vrf/
    └── lib/
        ├── vrf-flow.ts        # Existing -- advanceEpochWithVRF (needs gateway rotation)
        └── epoch-reader.ts    # Existing -- readEpochState, EpochStateSnapshot
```

### Pattern 1: Long-Lived TypeScript Process with Epoch Loop

**What:** Single `overnight-runner.ts` process that runs a for-loop over 100 epochs, calling existing flow functions in sequence per epoch. Each epoch: wait for slot boundary -> VRF transition -> swap -> log -> check balance -> repeat.

**When to use:** When running unattended overnight with shared connection/provider state.

**Why TypeScript over shell loop:**
- Reuses the Switchboard `sbProgram` and `queueAccount` objects across epochs (avoids ~3s IDL fetch per epoch = 5 min saved over 100 epochs)
- Connection pooling and RPC rate limiting is handled in-process
- Error handling is granular (catch per-epoch, log, continue)
- Gateway rotation state lives in-memory

**Example structure:**
```typescript
// Source: carnage-hunter.ts pattern + staking-flow.ts epoch cycling
async function main() {
  const provider = loadProvider();
  const programs = loadPrograms(provider);
  const manifest = loadManifest();
  const logger = new E2ELogger("overnight-run.jsonl");

  // Create test user with enough WSOL for 100 epochs of swaps
  const user = await createE2EUser(provider, manifest.mints, WSOL_BUDGET);

  // Pre-compute VRF accounts (same for all epochs)
  const vrfAccounts = buildVRFAccounts(manifest, provider);

  for (let epoch = 0; epoch < TARGET_EPOCHS; epoch++) {
    try {
      // 1. Check balance, airdrop if needed
      await checkAndAirdrop(provider);

      // 2. Wait for epoch boundary (750 slots)
      if (epoch > 0) await waitForSlotAdvance(connection, 760);

      // 3. VRF epoch transition (with gateway rotation on retry)
      const result = await advanceEpochWithVRF(provider, programs.epochProgram, vrfAccounts);

      // 4. Inter-epoch swap (generates tax revenue)
      const swapSig = await executeSolBuySwap(provider, programs, manifest, user, logger);

      // 5. If Carnage triggered, execute it
      if (result.carnageTriggered) {
        await executeCarnage(provider, programs, manifest, logger);
      }

      // 6. Log epoch record
      logger.logEpochRecord({ epoch, result, swapSig, ... });
    } catch (err) {
      // Log and continue -- failures are data points
      logger.logError(epoch, err);
    }
  }

  // Generate morning report
  generateOvernightReport(logger.entries);
}
```

### Pattern 2: Gateway Rotation for VRF Reveal

**What:** When `revealIx()` fails (oracle returns 404 or timeout), rotate to a different gateway by fetching the gateway list from CrossbarClient and trying each one.

**When to use:** Every VRF reveal retry cycle. Devnet shows ~33% oracle failure rate per gateway; rotating reduces recovery from ~5 min (timeout) to ~10 sec (try next gateway).

**How the SDK works (from source code analysis):**

The current `revealIx()` flow in `@switchboard-xyz/on-demand` (v3.8.2) is:
1. Load randomness account data -> get `data.oracle` pubkey
2. Load oracle data -> extract `gatewayUri` from `oracleData.gatewayUri` bytes
3. Create `Gateway(gatewayUrl)` instance
4. Call `gateway.fetchRandomnessReveal({...})` -> HTTP POST to `/gateway/api/v1/randomness_reveal`
5. If gateway is down, the call throws and `revealIx()` fails

**The key insight:** The gateway URL is read from the **oracle** account's `gatewayUri` field. The oracle was chosen during `commitIx()` via `queueAccount.fetchOracleByLatestVersion()` which randomly selects from the queue's oracle list. A different oracle = different gateway.

**Gateway rotation implementation options:**

Option A (Recommended): **Re-select oracle at reveal time.**
- When revealIx() fails, instead of retrying the same oracle/gateway, use `CrossbarClient.fetchGateways('devnet')` to get all gateway URLs
- Try each gateway URL directly with a manual `gateway.fetchRandomnessReveal()` call using the same randomness account data
- This works because the randomness account stores the `oracle` pubkey, and any gateway can serve the reveal for any oracle (the signature is oracle-specific, but the gateway just proxies the TEE response)

Option B: **Queue-level oracle enumeration.**
- Use `queueAccount.fetchOracleKeys()` to get all oracles
- For each oracle, read `oracleData.gatewayUri`
- Try each gateway until one responds
- This is more correct but requires N RPC calls to fetch oracle data

**The CrossbarClient.fetchGateways() API (verified from source):**
```typescript
// Source: node_modules/@switchboard-xyz/common/dist/esm/crossbar-client.js line 442
async fetchGateways(network = 'mainnet'): Promise<string[]> {
  const gateways = await axios.get(`${this.crossbarUrl}/gateways?network=${network}`);
  return gateways;
}
```
Returns an array of gateway URL strings for the specified network.

**Queue.fetchGatewayByLatestVersion() (verified from source):**
```typescript
// Source: node_modules/@switchboard-xyz/on-demand/dist/esm/accounts/queue.js line 126
// 1. Fetches all gateway URLs via crossbar.fetchGateways()
// 2. Health-checks each gateway via GET /gateway/api/v1/test
// 3. Groups by version, finds majority version
// 4. Randomly selects from majority-version gateways
```

**Example gateway rotation wrapper:**
```typescript
// Source: Derived from SDK source analysis
async function revealWithGatewayRotation(
  randomness: sb.Randomness,
  crossbar: sb.CrossbarClient,
  network: 'devnet' | 'mainnet',
  maxRetries: number = 5
): Promise<any> {
  // Try default revealIx first (uses oracle's own gateway)
  try {
    return await randomness.revealIx();
  } catch (firstError) {
    console.log(`Primary gateway failed: ${String(firstError).slice(0, 100)}`);
  }

  // Fetch all available gateways
  const gatewayUrls = await crossbar.fetchGateways(network);
  const data = await randomness.loadData();

  // Try each gateway until one works
  for (const url of gatewayUrls) {
    try {
      const gateway = new sb.Gateway(url);
      const revealResponse = await gateway.fetchRandomnessReveal({
        randomnessAccount: randomness.pubkey,
        slothash: bs58.encode(data.seedSlothash),
        slot: data.seedSlot.toNumber(),
        rpc: randomness.program.provider.connection.rpcEndpoint,
      });

      // Build the reveal instruction manually from the response
      // (same logic as revealIx but with our chosen gateway)
      const stats = PublicKey.findProgramAddressSync(
        [Buffer.from('OracleRandomnessStats'), data.oracle.toBuffer()],
        randomness.program.programId
      )[0];

      return randomness.program.instruction.randomnessReveal({
        signature: Buffer.from(revealResponse.signature, 'base64'),
        recoveryId: revealResponse.recovery_id,
        value: revealResponse.value,
      }, {
        accounts: {
          randomness: randomness.pubkey,
          oracle: data.oracle,
          queue: data.queue,
          stats,
          authority: data.authority,
          payer: randomness.program.provider.publicKey,
          recentSlothashes: SYSVAR_SLOT_HASHES_PUBKEY,
          systemProgram: SystemProgram.programId,
          rewardEscrow: getAssociatedTokenAddressSync(NATIVE_MINT, randomness.pubkey),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          wrappedSolMint: NATIVE_MINT,
          programState: sb.State.keyFromSeed(randomness.program),
        },
      });
    } catch (err) {
      console.log(`Gateway ${url} failed: ${String(err).slice(0, 80)}`);
    }
  }

  throw new Error('All gateways failed for randomness reveal');
}
```

### Pattern 3: Auto-Airdrop Safety Net

**What:** Check wallet SOL balance at the start of each epoch. If below threshold, request devnet airdrop.

**When to use:** Before each epoch to prevent transaction failures from insufficient funds.

**Example:**
```typescript
// Source: scripts/deploy/deploy.sh pattern (auto-airdrop on devnet if < 5 SOL)
const AIRDROP_THRESHOLD = 5 * LAMPORTS_PER_SOL;
const AIRDROP_AMOUNT = 2 * LAMPORTS_PER_SOL;

async function checkAndAirdrop(provider: AnchorProvider): Promise<void> {
  const balance = await provider.connection.getBalance(provider.wallet.publicKey);
  if (balance < AIRDROP_THRESHOLD) {
    console.log(`Balance ${balance / LAMPORTS_PER_SOL} SOL < ${AIRDROP_THRESHOLD / LAMPORTS_PER_SOL} SOL, requesting airdrop...`);
    const sig = await provider.connection.requestAirdrop(provider.wallet.publicKey, AIRDROP_AMOUNT);
    await provider.connection.confirmTransaction(sig, 'confirmed');
    console.log(`Airdropped ${AIRDROP_AMOUNT / LAMPORTS_PER_SOL} SOL`);
  }
}
```

### Pattern 4: Epoch-Level JSONL Record Schema

**What:** One JSONL line per epoch with all data needed for the morning report.

**Schema (from CONTEXT.md requirements):**
```typescript
interface EpochRecord {
  timestamp: string;           // ISO 8601
  epochIndex: number;          // 0-based index in this run
  epochNumber: number;         // On-chain epoch number
  cheapSide: string;           // "CRIME" | "FRAUD"
  crimeBuyTaxBps: number;      // Per-token independent tax rate
  crimeSellTaxBps: number;
  fraudBuyTaxBps: number;
  fraudSellTaxBps: number;
  vrfBytes: number[];          // First 8 VRF bytes
  carnageTriggered: boolean;
  carnageExecuted: boolean;    // If triggered, was it successfully executed?
  swapPerformed: boolean;
  swapPool: string;            // "CRIME/SOL" | "FRAUD/SOL"
  swapSig: string | null;
  taxDistribution: {           // From swap verification
    staking: number;           // Lamports to staking escrow
    carnage: number;           // Lamports to carnage vault
    treasury: number;          // Lamports to treasury
  } | null;
  stakingYieldDelta: number;   // Change in escrow balance this epoch
  errors: string[];            // Non-fatal errors this epoch
  txSignatures: string[];      // All TX sigs this epoch
  vrfDurationMs: number;       // Time for VRF 3-TX flow
  totalDurationMs: number;     // Total epoch processing time
  walletBalance: number;       // Post-epoch wallet balance (lamports)
  carnageVaultBalance: number; // Post-epoch carnage vault balance (lamports)
}
```

### Pattern 5: Graceful Shutdown

**What:** Handle SIGINT/SIGTERM to stop the epoch loop cleanly, write final JSONL summary, and generate the morning report.

**Example:**
```typescript
let shutdownRequested = false;

process.on('SIGINT', () => {
  console.log('\nGraceful shutdown requested. Finishing current epoch...');
  shutdownRequested = true;
});
process.on('SIGTERM', () => {
  console.log('\nSIGTERM received. Finishing current epoch...');
  shutdownRequested = true;
});

// In the epoch loop:
for (let epoch = 0; epoch < TARGET_EPOCHS; epoch++) {
  if (shutdownRequested) {
    console.log(`Shutdown after epoch ${epoch}. Generating report...`);
    break;
  }
  // ... epoch logic
}
```

### Anti-Patterns to Avoid

- **Shell loop with `npx tsx` per epoch:** Each invocation pays 3-5 second startup cost, re-fetches Switchboard IDL, loses connection state. Over 100 epochs = 5-8 min of pure overhead.
- **Hardcoded gateway URLs:** Switchboard gateways rotate and may change. Always use dynamic resolution via `CrossbarClient.fetchGateways()` or `sb.getDefaultQueue()`.
- **Stopping on first error:** Non-VRF failures should be logged and continued. The whole point of overnight running is to gather data on failure patterns.
- **Re-creating test user per epoch:** One user with sufficient WSOL budget for all 100 epochs. Creating users costs SOL and RPC calls.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| VRF commit-reveal flow | Custom Switchboard interaction | `advanceEpochWithVRF()` from `vrf-flow.ts` | Already handles 3-TX flow, stale VRF recovery, timeout recovery |
| Transfer Hook account resolution | Manual ExtraAccountMeta lookup | `resolveHookAccounts()` from `swap-flow.ts` | Already handles `createTransferCheckedWithTransferHookInstruction` |
| Program deployment | Custom deploy script | `scripts/deploy/deploy.sh` | Already handles upgrades, priority fees, auto-airdrop |
| JSONL crash-safe logging | Custom file writer | `E2ELogger` from `e2e-logger.ts` | Already uses `appendFileSync` for crash safety |
| Markdown report generation | Custom template engine | Extend `E2EReporter` from `e2e-reporter.ts` | Already generates structured tables, Explorer links |
| Protocol initialization | Custom init script | `scripts/deploy/initialize.ts` | 19-step idempotent init with check-before-init |

**Key insight:** This phase is primarily **composition** of existing scripts, not new feature development. The overnight runner is a loop that calls existing functions.

## Common Pitfalls

### Pitfall 1: EpochState Schema Mismatch After Upgrade

**What goes wrong:** After upgrading the Epoch Program, the on-chain EpochState PDA may have a different byte layout than the new program expects, causing deserialization failures.

**Why it happens:** Phase 37 added independent per-token tax rates (`crime_buy_tax_bps`, `crime_sell_tax_bps`, `fraud_buy_tax_bps`, `fraud_sell_tax_bps`). If the on-chain data still has the old layout, the new program reads garbage.

**How to avoid:** The EpochState struct is 100 bytes (8 discriminator + 92 data) and has NOT changed size between Phase 34 and Phase 37. The new fields (`crime_buy_tax_bps` etc.) overlap with previously zero-padded space or replace legacy fields (`low_tax_bps`, `high_tax_bps` are still present but set to 0). The first `consume_randomness` call after upgrade will populate the new fields correctly. **No re-initialization needed.** However, the first epoch's legacy `low_tax_bps`/`high_tax_bps` values will be stale until the first VRF transition writes new values.

**Warning signs:** `Error: Account does not exist or has no data` or `Error processing Instruction: custom program error: 0x...` on the first VRF transition after upgrade.

**Claude's Discretion recommendation:** Let the first VRF transition overwrite the stale values. No re-initialization required. The struct size hasn't changed, and the discriminator is the same.

### Pitfall 2: Devnet Airdrop Rate Limiting

**What goes wrong:** Solana devnet rate-limits airdrop requests. If the runner requests airdrops too frequently, they get throttled or rejected.

**Why it happens:** Devnet airdrops are limited to ~2 SOL per request and may have cooldown periods.

**How to avoid:** Set threshold conservatively high (5 SOL) so airdrops happen rarely. The wallet has >50 SOL from Phase 34, and the overnight run should use <10 SOL total (100 swaps at 0.1 SOL = 10 SOL max, but most SOL is recycled through the protocol). Pre-fund the user with sufficient WSOL in one shot rather than topping up per epoch.

**Warning signs:** `Error: airdrop request limit reached` or transactions failing with `InsufficientFundsForRent`.

### Pitfall 3: Switchboard Oracle Downtime (>33% Failure Rate)

**What goes wrong:** VRF reveal fails because the assigned oracle's gateway is down. Without gateway rotation, the flow falls through to timeout recovery (wait 300 slots = ~2 min), wasting time.

**Why it happens:** Devnet oracles are less reliable than mainnet. Phase 35 observed ~33% failure rate per gateway.

**How to avoid:** Implement gateway rotation (this phase's key feature). When `revealIx()` fails, immediately try alternative gateways from `CrossbarClient.fetchGateways('devnet')` rather than waiting for the 300-slot timeout.

**Warning signs:** Multiple consecutive `[tx3] Reveal not ready` messages, or `VRF recovery failed` errors.

### Pitfall 4: Helius RPC Rate Limiting

**What goes wrong:** Helius free tier limits `sendTransaction` to 1/sec. Bursts of transactions in the VRF flow (create, commit, reveal) hit rate limits.

**Why it happens:** The VRF 3-TX flow sends 3 transactions in quick succession without delays.

**How to avoid:** The existing `vrf-flow.ts` already has 200ms `sleep()` calls between RPC operations. The overnight runner should maintain these delays and add similar delays between swap and VRF calls within each epoch.

**Warning signs:** `429 Too Many Requests` or transactions landing slowly/dropping.

### Pitfall 5: WSOL Account Exhaustion

**What goes wrong:** The test user runs out of WSOL mid-run, causing all swap operations to fail.

**Why it happens:** Each swap uses 0.1 SOL. Over 100 epochs = 10 SOL of WSOL needed, plus buffer for failed/retried swaps.

**How to avoid:** Pre-fund the user with 15 SOL of WSOL (10 SOL for swaps + 5 SOL buffer). Monitor WSOL balance in the epoch loop and log a warning if it drops below 2 SOL. Consider creating a fresh WSOL account mid-run if needed.

**Warning signs:** Swap failures with `InsufficientFunds` or `TokenAccountNotFound`.

### Pitfall 6: Carnage WSOL Account Not Created

**What goes wrong:** The Carnage execution fails because the Carnage WSOL account doesn't exist or isn't funded.

**Why it happens:** Phase 37-03 added Carnage WSOL creation to `initialize.ts`, but if redeployment happens without re-initialization, the WSOL account from Phase 34 may not match the new program's expectations.

**How to avoid:** After upgrade-in-place, run a focused verification step that checks the Carnage WSOL account exists and has correct ownership. This is documented in 38-CONTEXT.md as a "separate manual step after deploy."

**Warning signs:** Carnage triggers in EpochState but `execute_carnage_atomic` fails with account errors.

## Code Examples

### Existing VRF Flow Integration

```typescript
// Source: scripts/vrf/lib/vrf-flow.ts line 226
// This function encapsulates the complete 3-TX VRF flow.
// The overnight runner calls this once per epoch.
const result = await advanceEpochWithVRF(provider, programs.epochProgram, vrfAccounts);
// Returns: EpochTransitionResult with epoch, cheapSide, tax rates, carnageTriggered, etc.
```

### Existing Swap Flow Integration

```typescript
// Source: scripts/e2e/lib/swap-flow.ts
// executeSolBuySwap handles Transfer Hook account resolution, tax verification, retry logic
const swapSig = await executeSolBuySwap(
  provider, programs, manifest, user, logger, "CRIME/SOL", 100_000_000 // 0.1 SOL
);
```

### Existing JSONL Logger

```typescript
// Source: scripts/e2e/lib/e2e-logger.ts
// appendFileSync for crash safety -- even if process dies, all logged entries survive
const logger = new E2ELogger("overnight-run.jsonl");
logger.log({ timestamp: new Date().toISOString(), phase: "epoch", status: "pass", ... });
```

### Deployment Command

```bash
# Source: scripts/deploy/deploy.sh
# deploy.sh handles both fresh deploys and upgrades via solana program deploy
# It auto-detects whether the program exists and deploys/upgrades accordingly
source "$HOME/.cargo/env" && export PATH="/Users/mlbob/.local/share/solana/install/active_release/bin:$PATH"
export PATH="/opt/homebrew/bin:$PATH"
set -a && source .env && set +a
bash scripts/deploy/build.sh    # anchor build + verify IDs
bash scripts/deploy/deploy.sh   # deploy/upgrade 5 programs
```

### Reading EpochState

```typescript
// Source: scripts/vrf/lib/epoch-reader.ts
// Returns typed EpochStateSnapshot with all fields including independent tax rates
const snapshot = await readEpochState(programs.epochProgram, epochStatePda);
// snapshot.crimeBuyTaxBps, snapshot.crimeSellTaxBps, etc.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single `low_tax_bps`/`high_tax_bps` | Independent `crime_buy/sell`, `fraud_buy/sell` tax rates | Phase 37-02 | 4 VRF bytes for independent per-token magnitudes |
| Carnage at VRF byte 3 | Carnage at VRF bytes 5-7 | Phase 37-02 | MIN_VRF_BYTES=8, Carnage offset shifted |
| InterfaceAccount for CPI passthroughs | AccountInfo for CPI passthroughs + Box for state | Phase 37-03 | Root-cause fix for BPF stack overflow |
| Hardcoded Switchboard PID | Feature-flagged `#[cfg(feature = "devnet")]` | Phase 37-01 | Compile-time PID resolution |
| Same gateway retry | Gateway rotation (this phase) | Phase 38 | ~5 min -> ~10 sec VRF recovery |

**Deprecated/outdated:**
- `switchboard-v2` crate: Use `switchboard-on-demand` (migration completed Phase 35)
- `low_tax_bps`/`high_tax_bps` legacy fields: Set to 0 as of Phase 37-02, replaced by per-token rates

## Open Questions

1. **Carnage WSOL account state after upgrade**
   - What we know: Phase 37-03 added Carnage WSOL creation to `initialize.ts`. The original Phase 34 deployment created a Carnage WSOL account.
   - What's unclear: Whether the Phase 34 Carnage WSOL account is still valid after the Phase 37 program upgrade (ownership, balance, correct association).
   - Recommendation: Include a focused verification step post-deploy that checks the Carnage WSOL account. If invalid, re-create it as a manual step (per CONTEXT.md decision).

2. **Exact gateway rotation failure modes**
   - What we know: The SDK's `revealIx()` reads the gateway URL from the oracle account data. `CrossbarClient.fetchGateways('devnet')` returns an array of gateway URLs. `Gateway.fetchRandomnessReveal()` is the HTTP call that can fail.
   - What's unclear: Whether a gateway that is "up" (responds to health checks) can still fail specifically for randomness reveal requests. The failure mode may be gateway-specific (down) or oracle-specific (the assigned oracle's TEE is unavailable regardless of which gateway proxies the request).
   - Recommendation: Implement gateway rotation as first-pass fix. If all gateways fail for the same oracle, fall back to the existing 300-slot timeout recovery path. Log which gateways succeed/fail for diagnostic data.

3. **Devnet airdrop reliability for multi-hour runs**
   - What we know: Phase 34 used auto-airdrop at <5 SOL threshold. The wallet has >50 SOL from Phase 34.
   - What's unclear: Whether devnet airdrop will remain available throughout an 8-hour overnight run. Devnet may have maintenance windows.
   - Recommendation: Pre-fund wallet to >50 SOL before starting. With 0.1 SOL swaps and VRF costs, 50 SOL should last well beyond 100 epochs. Airdrop is a safety net, not primary funding.

## Sources

### Primary (HIGH confidence)
- `scripts/vrf/lib/vrf-flow.ts` -- Full VRF 3-TX flow implementation, recovery logic
- `scripts/e2e/carnage-hunter.ts` -- Existing epoch cycling pattern (50 epochs max)
- `scripts/e2e/lib/swap-flow.ts` -- Swap execution with Transfer Hook + tax verification
- `scripts/e2e/lib/staking-flow.ts` -- Multi-epoch cycling with slot waits
- `scripts/e2e/lib/e2e-logger.ts` -- JSONL crash-safe logger pattern
- `scripts/e2e/lib/e2e-reporter.ts` -- Markdown report generator pattern
- `scripts/deploy/deploy.sh` -- Upgrade-in-place deployment
- `scripts/deploy/initialize.ts` -- 19-step idempotent initialization
- `programs/epoch-program/src/state/epoch_state.rs` -- EpochState struct (100 bytes)
- `node_modules/@switchboard-xyz/on-demand/dist/esm/accounts/randomness.js` -- SDK revealIx() internals
- `node_modules/@switchboard-xyz/on-demand/dist/esm/accounts/queue.js` -- Queue.fetchGatewayByLatestVersion(), fetchOracleByLatestVersion()
- `node_modules/@switchboard-xyz/common/dist/esm/crossbar-client.js` -- CrossbarClient.fetchGateways(), fetchGateway()
- `node_modules/@switchboard-xyz/common/dist/esm/gateway.js` -- Gateway.fetchRandomnessReveal()

### Secondary (MEDIUM confidence)
- Switchboard On-Demand SDK v3.8.2 source code analysis -- Gateway rotation feasibility confirmed by reading actual SDK source
- `@switchboard-xyz/common` v5.7.0 source code -- CrossbarClient API for gateway enumeration confirmed

### Tertiary (LOW confidence)
- Switchboard documentation (docs.switchboard.xyz) -- General architecture. Does not specifically document gateway rotation for randomness use cases.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All libraries already installed and integrated in the codebase
- Architecture: HIGH -- Patterns derived from existing codebase scripts, extending proven patterns
- Gateway rotation: MEDIUM -- Feasibility confirmed from SDK source code analysis, but untested in practice. The API surface exists (`CrossbarClient.fetchGateways`, `Gateway.fetchRandomnessReveal`) but combining them for randomness reveal rotation is novel for this project
- Deployment/upgrade: HIGH -- `deploy.sh` already handles upgrades, tested in Phase 34
- Pitfalls: HIGH -- Based on direct experience from Phase 34-37 devnet testing

**Research date:** 2026-02-13
**Valid until:** 2026-03-13 (stable -- no fast-moving dependencies)
