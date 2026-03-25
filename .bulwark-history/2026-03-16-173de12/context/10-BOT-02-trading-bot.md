---
task_id: db-phase1-trading-bot-security
provides: [trading-bot-findings, trading-bot-invariants]
focus_area: trading-bot-security
files_analyzed: [scripts/crank/crank-runner.ts, scripts/crank/crank-provider.ts, scripts/e2e/overnight-runner.ts, scripts/e2e/lib/swap-flow.ts, scripts/e2e/lib/carnage-flow.ts, scripts/vrf/lib/vrf-flow.ts, app/lib/swap/route-engine.ts, app/lib/swap/quote-engine.ts, app/lib/swap/swap-builders.ts, app/lib/swap/multi-hop-builder.ts, app/lib/swap/split-router.ts, app/lib/swap/hook-resolver.ts, app/lib/swap/wsol.ts, app/lib/swap/error-map.ts, app/hooks/useSwap.ts, app/hooks/useSettings.ts, app/hooks/useCurveState.ts, app/providers/SettingsProvider.tsx, shared/constants.ts]
finding_count: 12
severity_breakdown: {critical: 0, high: 3, medium: 5, low: 4}
---
<!-- CONDENSED_SUMMARY_START -->
# Trading & DeFi Bot Security -- Condensed Summary

## Key Findings (Top 10)

1. **Crank runner has no spending cap or loss limit**: The crank bot runs indefinitely, topping up the carnage vault with SOL from the operator wallet without any daily/total spending cap or circuit breaker. A bug or on-chain exploit draining the vault repeatedly could drain the crank wallet via unbounded top-ups. -- `scripts/crank/crank-runner.ts:225-241`

2. **User-facing default slippage is 500 bps (5%)**: The frontend defaults to 5% slippage tolerance for all swap types. This is generous for the protocol's own AMM pools and could be exploited by sandwich attackers on mainnet, particularly on stablecoin-like pairs or large trades. -- `app/providers/SettingsProvider.tsx:77`

3. **No maximum trade size enforcement off-chain**: The frontend swap builders accept any `amountInLamports` / `amountInBaseUnits` without capping to a maximum trade size. On-chain, the AMM has no maximum trade size either. A user or bot could execute a single large swap that massively moves the price. -- `app/lib/swap/swap-builders.ts:195-289`

4. **Crank runner infinite retry without escalating delay or max attempt count**: When an epoch cycle fails, the crank retries after a fixed 30-second delay indefinitely. There is no exponential backoff and no maximum retry count. If the failure is permanent (program bug, account closed), the crank burns fees retrying forever. -- `scripts/crank/crank-runner.ts:302-315`

5. **skipPreflight used for all v0 transactions on mainnet path**: Both the crank (`vrf-flow.ts:559`) and the frontend multi-hop builder (`multi-hop-builder.ts:381`) use `skipPreflight: true`. While justified on devnet, this pattern on mainnet means transactions are submitted to the cluster without simulation, making failed TXs consume fees and potentially enabling exploitation. -- `app/lib/swap/multi-hop-builder.ts:380-382`

6. **No MEV/sandwich protection for user swaps**: User swap transactions are submitted through standard RPC (`sendRawTransaction` / `sendTransaction`) without Jito bundles, private mempools, or any MEV protection. Every swap is visible in the mempool before inclusion. -- `app/lib/swap/multi-hop-builder.ts:368-416`

7. **Quote engine uses JavaScript `number` (64-bit float) for all arithmetic**: While the on-chain program uses Rust `u64` integer math, the off-chain quote engine uses `Math.floor()` on JavaScript `number`. For swap amounts above 2^53 (~9 quadrillion lamports, ~9M SOL), precision loss occurs. For the protocol's scale this is safe, but large reserves could theoretically cause divergence. -- `app/lib/swap/quote-engine.ts:37-62`

8. **Carnage WSOL keypair loaded from disk or env with no encryption**: `loadCarnageWsolPubkey()` reads a full keypair from `keypairs/carnage-wsol.json` even though only the public key is needed. The full secret key is parsed into memory unnecessarily. -- `scripts/crank/crank-runner.ts:110-111`

9. **Overnight runner requests devnet airdrops automatically**: While marked deprecated, the overnight runner auto-airdrops when wallet balance is low. If this code is accidentally run on a non-devnet network, `requestAirdrop` would fail gracefully, but the architectural pattern of auto-funding is a risk indicator. -- `scripts/e2e/overnight-runner.ts:141-168`

10. **Crank runner logs wallet balance to stdout on every cycle**: The wallet balance is logged every cycle. On Railway (production hosting), stdout is captured as logs. While not a direct vulnerability, this is operational information that could be useful to attackers. -- `scripts/crank/crank-runner.ts:209-217`

## Critical Mechanisms

- **Crank Epoch Loop**: `crank-runner.ts:197-316` -- Main while-loop reads epoch state, checks vault balance, waits for slot boundary, calls `advanceEpochWithVRF`. Error handling catches all errors and retries after 30s. No per-error-type classification. Graceful shutdown via SIGINT/SIGTERM sets flag; loop finishes current cycle first.

- **Atomic Carnage Bundling (CARN-002)**: `vrf-flow.ts:269-341` -- Reveal + consume + executeCarnageAtomic are bundled in a single v0 VersionedTransaction. The on-chain no-op guard ensures executeCarnageAtomic returns Ok(()) when Carnage doesn't trigger. This eliminates the MEV window between carnage detection and execution. Well-designed anti-MEV pattern for protocol operations.

- **Frontend Swap Pipeline**: `useSwap.ts` -> `route-engine.ts` -> `swap-builders.ts` -> `multi-hop-builder.ts` -- User selects tokens, route engine quotes all paths, swap builders create instructions, multi-hop builder combines into atomic v0 TX. Slippage is enforced via `minimumOutput` parameter passed to on-chain instruction. On-chain validation is the real enforcement; off-chain just constructs the TX.

- **Vault Top-Up**: `crank-runner.ts:220-241` -- Crank monitors carnage vault balance. If below `MIN_VAULT_BALANCE` (~2M lamports), tops up with `VAULT_TOP_UP_LAMPORTS` (0.005 SOL). This mitigates the on-chain rent-exempt bug but introduces an unbounded spending channel from crank wallet to vault.

- **VRF Recovery**: `vrf-flow.ts:388-535` -- If a previous VRF call failed mid-flow (stale VRF), recovery tries to reveal the stale randomness or waits for VRF timeout (300 slots), creates fresh randomness, and retries. This is resilient but adds complexity; the recovery path does NOT attempt atomic Carnage.

## Invariants & Assumptions

- INVARIANT: Slippage protection is enforced on-chain via `minimum_output` parameter -- enforced at `programs/tax-program/src/instructions/swap_sol_buy.rs` (on-chain, out of BOT-02 scope). Off-chain sets `minimumOutput` at `app/lib/swap/swap-builders.ts:257` and `multi-hop-builder.ts:315-317`.
- INVARIANT: AMM swaps MUST go through Tax Program (direct AMM calls blocked) -- enforced on-chain via `InvalidSwapAuthority` error. Off-chain honors this at `app/lib/swap/swap-builders.ts:255-284` (always calls Tax Program).
- INVARIANT: Carnage execution is atomic with epoch transition (no MEV window) -- enforced at `scripts/vrf/lib/vrf-flow.ts:297-327` by bundling reveal+consume+carnage in single TX.
- INVARIANT: Crank runner has graceful shutdown -- enforced at `scripts/crank/crank-runner.ts:79-89` via SIGINT/SIGTERM handlers setting `shutdownRequested` flag.
- ASSUMPTION: JavaScript `number` precision is sufficient for all swap amounts -- UNVALIDATED for very large pool reserves (>2^53 lamports). Current pools are far below this threshold.
- ASSUMPTION: RPC responses are trustworthy for balance checks and state reads -- UNVALIDATED. A compromised or spoofed RPC could return false balance/state data to the crank or frontend.
- ASSUMPTION: 30-second retry delay is sufficient to recover from transient failures -- PARTIALLY VALIDATED. Works for rate limits and oracle delays. Does not differentiate permanent from transient errors.

## Risk Observations (Prioritized)

1. **No spending cap on crank vault top-up (HIGH)**: `crank-runner.ts:225-241` -- An on-chain bug that drains the carnage vault every cycle would drain the crank wallet at 0.005 SOL/cycle. Over 100 cycles (500 seconds at minimum), that's 0.5 SOL. Over a day of rapid cycling, could drain wallet entirely. Need per-day spending cap and alert threshold.

2. **Default 5% slippage enables sandwich attacks on mainnet (HIGH)**: `SettingsProvider.tsx:77` -- The default `slippageBps: 500` means users who don't adjust settings are giving MEV searchers up to 5% of their trade value. Industry best practice is 0.5-1% for standard pairs.

3. **No MEV protection for user swaps (HIGH)**: `multi-hop-builder.ts:380-382` -- All user swaps go through public RPC. On mainnet, this is a direct sandwich attack vector (AIP-137). The Carnage system is well-protected (atomic bundling), but user swaps are not.

4. **Fixed retry delay without error classification (MEDIUM)**: `crank-runner.ts:302-315` -- All errors get the same 30s retry. Permanent errors (program closed, invalid PDA) should trigger alerts and/or shutdown, not infinite retry (AIP-130).

5. **skipPreflight on mainnet (MEDIUM)**: `multi-hop-builder.ts:381`, `vrf-flow.ts:559` -- Documented as devnet workaround but will carry to mainnet. Failed TXs still consume base fee. Should add simulation-before-send on mainnet.

6. **No maximum trade size in frontend (MEDIUM)**: `swap-builders.ts` -- No cap on input amount. While on-chain pool reserves naturally limit output, a huge input could drain one side of the pool, creating severe price impact. Consider a UI warning or cap.

7. **Wallet balance logged to stdout (MEDIUM)**: `crank-runner.ts:214-216` -- Operational info leak. Railway logs are accessible to anyone with project access.

8. **Unnecessary secret key parsing for Carnage WSOL (MEDIUM)**: `crank-runner.ts:110-111` -- Full keypair parsed when only pubkey needed. If an attacker gains read access to the process, they get the WSOL account secret key.

## Novel Attack Surface

- **Carnage vault drain amplification**: If an attacker found a way to drain the carnage vault on-chain (even partially), the crank would automatically refill it indefinitely. The crank becomes an amplifier for any on-chain vault drain vulnerability, since it has no per-epoch or daily spending limit on top-ups.

- **Stale quote exploitation**: The frontend quote engine computes routes from cached pool reserves (WebSocket push). Between quote computation and transaction landing, pool reserves could change. While on-chain slippage protection prevents direct loss, an attacker could manipulate pool reserves between quote display and user confirmation to make the user accept a worse-than-expected trade within their slippage tolerance.

## Cross-Focus Handoffs

- -> **BOT-01 (Keeper Automation)**: The crank runner's infinite retry loop, error handling, and vault top-up spending limits need deeper analysis from the keeper automation perspective. The overlap between BOT-01 and BOT-02 is significant here.
- -> **SEC-01 (Secrets)**: The WALLET_KEYPAIR env var pattern in `crank-provider.ts:41-57` and the unnecessary full keypair parse in `crank-runner.ts:110-111` need secrets management review.
- -> **CHAIN-01 (Transaction Construction)**: The skipPreflight usage, v0 transaction patterns, and RPC commitment levels used in swap construction need chain interaction review.
- -> **ERR-01 (Error Handling)**: The crank runner's catch-all error handling and the frontend's error-map.ts patterns need error handling resilience review.

## Trust Boundaries

The trading/DeFi bot security surface has three distinct trust boundaries. First, the crank runner trusts the RPC endpoint for all state reads (epoch state, vault balance, wallet balance) and the Switchboard oracle network for VRF randomness. A compromised RPC could mislead the crank about vault balances or epoch state. Second, the frontend swap pipeline trusts the user-configured slippage tolerance and the browser-cached pool reserves for quote computation, with on-chain slippage protection as the real safety net. Third, the on-chain/off-chain boundary is well-defined: all financial enforcement (slippage, tax calculation, pool reserves) happens on-chain. The off-chain code constructs transactions but cannot bypass on-chain validation. The weakest trust boundary is between the crank operator wallet and the carnage vault, where the crank's unconditional top-up creates an unbounded spending channel.

<!-- CONDENSED_SUMMARY_END -->

---

# Trading & DeFi Bot Security -- Full Analysis

## Executive Summary

The Dr. Fraudsworth protocol has two distinct trading/DeFi bot contexts: (1) the crank runner, a 24/7 automated bot that advances protocol epochs with VRF and executes Carnage swaps atomically, and (2) the frontend swap pipeline, which constructs swap transactions for end users through the protocol's Tax Program -> AMM CPI chain.

The crank runner is well-architected with atomic Carnage bundling (eliminating MEV windows) and graceful shutdown. However, it lacks spending caps, error classification, and loss circuit breakers. The frontend swap pipeline is clean and uses pure-function quote engines with on-chain slippage enforcement, but defaults to 5% slippage and has no MEV protection for user transactions on mainnet.

No exchange API keys are involved (the protocol uses its own on-chain AMM, not centralized exchanges). No oracle price feeds are read off-chain for trading decisions (the crank uses VRF for randomness, not price oracles). The protocol's unique Carnage mechanism (VRF-triggered market operations) is well-protected by atomic transaction bundling.

## Scope

**In scope (BOT-02 tagged):**
- `scripts/crank/crank-runner.ts` -- Production 24/7 crank bot
- `scripts/crank/crank-provider.ts` -- Keypair/IDL/manifest loading
- `scripts/e2e/overnight-runner.ts` -- Deprecated test runner (reference)
- `scripts/e2e/lib/swap-flow.ts` -- E2E swap execution + tax verification
- `scripts/e2e/lib/carnage-flow.ts` -- Carnage trigger testing
- `scripts/vrf/lib/vrf-flow.ts` -- VRF epoch transition + atomic Carnage
- `app/lib/swap/*` -- Frontend swap pipeline (route-engine, quote-engine, swap-builders, multi-hop-builder, split-router, hook-resolver, wsol, error-map)
- `app/hooks/useSwap.ts`, `useSettings.ts`, `useCurveState.ts` -- React hooks
- `app/providers/SettingsProvider.tsx` -- Slippage/priority settings
- `shared/constants.ts` -- Shared constants

**Out of scope:** All `programs/` on-chain code (Anchor/Rust).

## Key Mechanisms

### 1. Crank Runner (crank-runner.ts)

**Purpose:** 24/7 epoch advancement with atomic Carnage execution on Railway.

**Flow:**
1. Load configuration (provider, programs, manifest, ALT, carnage WSOL pubkey)
2. Build VRF accounts struct from manifest
3. Enter infinite `while (!shutdownRequested)` loop
4. Each cycle: read epoch state -> check wallet balance -> check vault balance (top up if low) -> wait for epoch boundary -> advance epoch with VRF
5. Log JSON results to stdout

**Error handling:** Single try/catch wrapping the entire cycle body. All errors get the same treatment: log and retry after 30 seconds. No error classification (transient vs. permanent), no maximum retry count, no alerting.

**Vault top-up (lines 220-241):** When `vaultBalance < MIN_VAULT_BALANCE` (~2M lamports), transfers `VAULT_TOP_UP_LAMPORTS` (5M lamports = 0.005 SOL) from crank wallet to carnage vault. No per-day cap, no total spending limit, no alert if top-ups happen every cycle.

**Wallet balance warning (line 213):** Logs a WARNING when balance < 1 SOL but does not stop or alert. The crank continues operating until it runs out of SOL for transaction fees.

### 2. VRF Epoch Transition (vrf-flow.ts)

**Purpose:** Execute the 3-TX Switchboard VRF commit-reveal cycle for epoch transitions.

**Flow:**
1. Read epoch state to detect stale VRF (recovery if needed)
2. TX1: Create randomness account (wait for finalization -- critical)
3. TX2: Commit + trigger_epoch_transition
4. Wait 3 slots for oracle processing
5. TX3: Reveal + consume_randomness + executeCarnageAtomic (bundled v0)
6. Read final state, detect if Carnage executed atomically

**CARN-002 MEV Protection (lines 292-329):** When `carnageAccounts` and `alt` are provided, the reveal + consume + executeCarnageAtomic are bundled in a single v0 VersionedTransaction. The on-chain `executeCarnageAtomic` has a no-op guard that returns `Ok(())` when Carnage doesn't trigger. This means the TX always succeeds, and when Carnage DOES trigger, the swap executes atomically -- no CarnagePending event is ever visible on-chain before the swap completes. This is a well-designed anti-MEV pattern.

**Recovery path (lines 388-535):** Handles stale VRF from previous failed attempts. Two strategies: (a) try to reveal the stale randomness (oracle may have responded late), (b) wait for VRF timeout (300 slots), create fresh randomness, use retry_epoch_vrf. Recovery path does NOT attempt atomic Carnage (line 533: `carnageExecutedAtomically: false`).

**skipPreflight usage (line 559):** `skipPreflight: true` for TX1 (create randomness). Documented reason: SDK's LUT creation uses a finalized slot that can be slightly stale. The on-chain execution succeeds even if preflight simulation rejects. This is acceptable for devnet but should be reviewed for mainnet.

### 3. Frontend Quote Engine (quote-engine.ts)

**Purpose:** Pure-function AMM math mirroring on-chain Rust code exactly.

**Functions:**
- `calculateEffectiveInput(amountIn, feeBps)`: `floor(amountIn * (10000 - feeBps) / 10000)`
- `calculateSwapOutput(reserveIn, reserveOut, effectiveInput)`: `floor(reserveOut * effectiveInput / (reserveIn + effectiveInput))`
- `calculateTax(amountLamports, taxBps)`: `floor(amountLamports * taxBps / 10000)`
- `quoteSolBuy/quoteSolSell/quoteVaultConvert`: Compose primitives with correct order-of-operations
- `reverseQuoteSolBuy/reverseQuoteSolSell/reverseQuoteVaultConvert`: Inverse math for "exact output" mode

**Precision note:** Uses JavaScript `number` (IEEE 754 double, 53-bit mantissa). For amounts up to 2^53 (~9 quadrillion), integer arithmetic via `Math.floor` is exact. Current protocol amounts are well within this range (max 1B tokens with 6 decimals = 10^15, safely below 2^53 = 9.007 * 10^15). Would become an issue only for pools with >9M SOL reserves.

### 4. Frontend Route Engine (route-engine.ts)

**Purpose:** Enumerate all viable swap paths and quote each one.

**Architecture:** Static route graph with 4 tokens (SOL, CRIME, FRAUD, PROFIT) and edges for pools/vaults. Enumerates 1-hop and 2-hop paths. No 3+ hop paths (topology constraint). Quotes each path step-by-step, chaining outputs as inputs. Returns routes sorted by output amount descending.

**Slippage handling (line 339):** `minimumOutput = floor(finalOutput * (10000 - slippageBps) / 10000)`. Applied to the final step output. For atomic multi-hop TXs, this is correct since all hops succeed or fail together.

### 5. Frontend Swap Builders (swap-builders.ts)

**Purpose:** Construct complete Transaction objects for each swap type.

**SOL Buy (lines 195-289):** 20 named accounts + 4 hook remaining_accounts. Includes WSOL wrap instructions (create ATA + transfer + syncNative), output token ATA creation, and the Tax Program `swap_sol_buy` instruction.

**SOL Sell (lines 316-404):** 21 named accounts + 4 hook remaining_accounts. Same pattern plus WSOL ATA creation (receives output) and WSOL unwrap at the end.

**Vault Convert (lines 431-507):** 9 named accounts + 8 hook remaining_accounts (4 per Token-2022 transfer leg). Fixed-rate 100:1 conversion.

All builders use hardcoded program IDs from `shared/constants.ts` (SP-018 pattern -- safe). No user-supplied program IDs.

### 6. Atomic Multi-Hop Builder (multi-hop-builder.ts)

**Purpose:** Combine 1-4 step transactions into a single atomic v0 VersionedTransaction.

**Instruction processing (lines 177-254):**
- Strips ComputeBudget instructions from per-step TXs, accumulates CU limits
- Converts ATA creation to idempotent (`CreateIdempotent`) for split routes
- Removes intermediate WSOL closeAccount instructions, keeping only the last one
- Prepends combined compute budget

**ALT caching (lines 261-277):** Module-level `cachedALT` avoids refetching the Address Lookup Table on every swap.

**Execution (lines 368-416):** `skipPreflight: true` with manual `confirmation.err` check. Comment says "devnet simulation rejects v0 TX" -- this needs mainnet review.

### 7. Split Router (split-router.ts)

**Purpose:** Find optimal split ratio for 2-path parallel routes (e.g., SOL->CRIME->PROFIT + SOL->FRAUD->PROFIT).

**Algorithm:** 1% granularity grid search (99 iterations). Split recommended only when >= 50 bps (0.5%) improvement over best single path. Pure function, no RPC calls. Completes in microseconds.

### 8. Settings Provider (SettingsProvider.tsx)

**Purpose:** Persist user preferences (slippage, priority fee, mute, volume) to localStorage.

**Slippage default: 500 bps (5%).** Validation: `0 <= slippageBps <= 10000`. No lower bound warning for very low slippage (could cause frequent failures). No upper bound warning for very high slippage (could enable sandwich attacks).

## Trust Model

1. **Crank -> RPC:** The crank trusts its RPC endpoint (CLUSTER_URL env var, typically Helius) for epoch state, vault balance, wallet balance, slot number. A compromised RPC could manipulate crank behavior.

2. **Crank -> Switchboard Oracle:** The crank trusts Switchboard oracles for VRF randomness. Oracle liveness failures are handled (VRF timeout recovery), but oracle manipulation is not addressed off-chain (on-chain verification handles this).

3. **Frontend -> Pool Reserves:** The frontend trusts WebSocket-pushed pool reserve data for quote computation. Between quote display and TX landing, reserves could change. On-chain slippage protection is the real safety net.

4. **Frontend -> User Settings:** The frontend trusts user-configured slippage tolerance. Users who don't adjust the default 5% are vulnerable to sandwich attacks.

5. **On-chain enforcement:** All financial invariants (slippage, tax calculation, pool reserves, swap authority check) are enforced on-chain. The off-chain code constructs transactions but cannot bypass on-chain validation. This is the correct trust model.

## State Analysis

**Crank state:**
- `shutdownRequested: boolean` -- Set by SIGINT/SIGTERM handlers. Checked at top of main loop.
- `cycleCount: number` -- Monotonically increasing. No upper bound. No overflow concern (JS number handles up to 2^53).
- `carnageTriggerCount: number` -- Carnage trigger counter for logging only.
- Module-level manifest, provider, programs loaded once at startup.

**Frontend state:**
- `cachedALT: AddressLookupTableAccount | null` -- Module-level cache for the protocol's Address Lookup Table. Never invalidated. If the ALT is recreated on-chain, the frontend would use stale data until page refresh.
- `SettingsProvider` state: `{ slippageBps, priorityFeePreset, muted, volume }`. Persisted to localStorage. Loaded once on hydration.
- `useCurveState`, `useEpochState`, `usePoolPrices` -- WebSocket subscriptions with visibility-aware pause/resume. These provide real-time data for quote computation.

## Dependencies

- **Switchboard SDK (`@switchboard-xyz/on-demand`)**: Used by vrf-flow.ts for randomness account creation, commit, reveal. Trusted for oracle interaction. Known quirk: `skipPreflight: true` needed for TX1 due to SDK LUT staleness.
- **Anchor (`@coral-xyz/anchor`)**: Program interaction, account typing, provider management. Well-established, heavily audited.
- **SPL Token (`@solana/spl-token`)**: Token operations including Transfer Hook instruction resolution in E2E scripts. Browser-side uses manual PDA derivation instead (Buffer polyfill limitation).
- **Solana web3.js (`@solana/web3.js`)**: Transaction construction, RPC calls. Standard.

No centralized exchange API dependencies. No external price oracle reads. No third-party trading libraries.

## Focus-Specific Analysis

### Slippage Tolerance Configuration (AIP-131)

The protocol has a **single global slippage setting** (not per-pair) defaulting to **500 bps (5%)**. This applies uniformly to all swap types: SOL pools (where 1-3% is typical), vault conversions (where 0% is correct since conversion is deterministic), and multi-hop routes.

**Concern:** 5% default is too generous for the protocol's own AMM pools. On mainnet, MEV searchers monitoring the public mempool could sandwich any swap with up to 5% profit margin. The vault conversion path doesn't need slippage at all (it's a fixed-rate operation), so the 5% slippage there is pure waste.

**Validation range:** `0 <= slippageBps <= 10000` (0% to 100%). No UI warning for extreme values.

### MEV Protection (AIP-137)

**Crank (Carnage):** Well-protected. Atomic bundling (CARN-002) ensures Carnage swaps are never visible as pending state before execution. This closes the MEV window for protocol operations.

**User swaps:** No MEV protection. Transactions go through standard RPC (`sendRawTransaction` with `skipPreflight: true`). On mainnet, every user swap is sandwichable. The only defense is the on-chain slippage check, but 5% default slippage gives ample room for MEV extraction.

### Trade Size Limits (AIP-129, OC-255)

**No maximum trade size** is enforced off-chain. The swap builders accept any amount. On-chain, the constant-product AMM naturally limits how much output a large trade can extract (diminishing returns), but a single large trade could severely move the price.

**No loss limits or circuit breakers** in the crank runner. The vault top-up operates without daily caps. If the crank wallet had 10 SOL and the vault was drained 2000 times, the crank would attempt 2000 top-ups (10 SOL total).

### Frontrunning Protection (OC-258)

**Protocol-side (Carnage):** Protected by atomic bundling. The VRF randomness is consumed and Carnage executed in the same transaction, preventing front-running of Carnage events.

**User-side:** Unprotected. Standard RPC submission. Need Jito bundles or private transaction submission for mainnet.

### Oracle/Price Feed Staleness (AIP-132, OC-254)

**Not applicable** for off-chain trading decisions. The protocol does not read price oracles off-chain for trading. The VRF is used for randomness (epoch parameters, Carnage trigger), not price data. Pool reserves are read from on-chain state via WebSocket subscriptions, which provide push updates on every account change.

The only staleness risk is the WebSocket connection itself: if the connection drops and reconnects, there's a brief window where the frontend has stale pool reserve data. The `usePoolPrices` hook handles this with visibility-aware pause/resume and burst-refresh on tab activation.

### Retry Logic (AIP-130, OC-249, OC-250)

**Crank runner:** Infinite retry with fixed 30s delay. No exponential backoff. No maximum attempts. No error classification. The same retry behavior for:
- Transient RPC errors (should retry immediately with backoff)
- Oracle timeouts (handled separately by VRF recovery)
- Program errors (should alert and potentially stop)
- Fee-related errors (should stop to prevent fund drain)

**VRF flow (tryReveal):** Bounded retry (configurable `maxAttempts`, default 10) with linear backoff (3s * attempt). Better pattern than the outer loop.

**Frontend:** No retry logic. Failed swaps return error to user. Appropriate for user-initiated actions.

### Idempotency (AIP-135, OC-252)

**Crank runner:** Each epoch transition is inherently idempotent on-chain: `triggerEpochTransition` checks slot boundary and VRF state. Double-calling with the same slot produces `EpochBoundaryNotReached`. Safe.

**VRF recovery:** `retryEpochVrf` replaces the stale VRF request. Calling it twice would fail (no stale VRF to replace). Safe.

**Vault top-up:** NOT idempotent. If the crank crashes between reading vault balance and completing the top-up, a restart would read the same low balance and top up again. This is a minor issue since the top-up amount is small (0.005 SOL), but repeated crashes could waste funds.

## Cross-Focus Intersections

### With BOT-01 (Keeper Automation)
The crank runner is both a keeper (BOT-01) and a trading bot (BOT-02) since it executes Carnage swaps. The overlap areas:
- Error retry logic (BOT-01 focus) affects trading reliability (BOT-02 focus)
- Kill switch / emergency shutdown (BOT-01) would protect against trading losses (BOT-02)
- Fund limits per operation (BOT-01) would cap vault top-up spending (BOT-02)

### With SEC-01 (Secrets)
- `WALLET_KEYPAIR` env var contains the full crank signing key
- `carnage-wsol.json` contains a full keypair when only pubkey is needed
- These are SEC-01 concerns but directly impact BOT-02 security (compromised key = compromised trading bot)

### With CHAIN-01 (Transaction Construction)
- `skipPreflight` usage across crank and frontend
- Commitment levels for balance reads (default `confirmed`)
- v0 VersionedTransaction patterns with ALT

### With ERR-01 (Error Handling)
- Crank's catch-all error handling
- Frontend's error-map.ts parsing
- Overnight runner's deprecated but still-accessible code

## Cross-Reference Handoffs

1. **BOT-01** should investigate: crank runner's infinite retry without max attempts, missing kill switch, vault top-up spending limits
2. **SEC-01** should investigate: WALLET_KEYPAIR env var handling, unnecessary keypair parsing in carnage WSOL loader
3. **CHAIN-01** should investigate: skipPreflight on mainnet path, v0 TX patterns, ALT cache invalidation
4. **ERR-01** should investigate: crank error classification (transient vs permanent), overnight runner's deprecated status but accessible code

## Risk Observations

### HIGH

1. **No spending cap on vault top-up** (`crank-runner.ts:225-241`): The crank unconditionally transfers SOL to the vault when balance is low. No per-cycle, per-day, or total spending cap. An on-chain vulnerability that drains the vault would be amplified by the crank's automatic refilling.

2. **Default 5% slippage on mainnet** (`SettingsProvider.tsx:77`): Industry standard for DEX defaults is 0.5-1%. At 5%, every user swap is a profitable sandwich target. The protocol's own pools have relatively low liquidity (devnet deployed with 2.5 SOL seed), making this even more impactful.

3. **No MEV protection for user swaps** (`multi-hop-builder.ts:380-382`): Standard RPC submission without Jito bundles or private mempools. Combined with 5% default slippage, this is the most exploitable vector for mainnet.

### MEDIUM

4. **Infinite retry without error classification** (`crank-runner.ts:302-315`): Permanent errors waste SOL on tx fees. Need error categorization and different handling per category.

5. **skipPreflight on mainnet** (`multi-hop-builder.ts:381`, `vrf-flow.ts:559`): Devnet workaround that will carry to mainnet. Should simulate before sending on mainnet to avoid fee waste on obviously-failing TXs.

6. **No max trade size** (`swap-builders.ts`): The protocol has no off-chain cap on trade size. While on-chain pool math limits output, price impact is not bounded. Consider a UI warning for high-impact trades.

7. **Wallet balance logging** (`crank-runner.ts:214`): Operational info exposed to Railway logs. Minor but worth noting.

8. **Unnecessary secret key parsing** (`crank-runner.ts:110-111`): Carnage WSOL loader reads full keypair to extract pubkey. If CARNAGE_WSOL_PUBKEY env var is not set, the full secret key is parsed into memory.

### LOW

9. **ALT cache never invalidated** (`multi-hop-builder.ts:261`): If the protocol ALT is recreated, users need to hard-refresh. Edge case but could cause confusing failures.

10. **Deprecated overnight runner still accessible** (`overnight-runner.ts:1-6`): Marked deprecated but not removed. Could be accidentally run. Contains auto-airdrop logic.

11. **Quote engine float precision** (`quote-engine.ts`): JavaScript number used for integer math. Safe for current amounts but lacks explicit BigInt protection for extreme values.

12. **No per-pair slippage differentiation**: Vault conversions (deterministic, 0% slippage needed) use the same 5% slippage as AMM pools. Waste of user value.

## Novel Attack Surface Observations

1. **Carnage vault drain amplifier**: The crank's unconditional vault top-up creates a feedback loop. If an attacker finds any way to extract SOL from the carnage vault (even a small amount per epoch), the crank will keep refilling it from the operator's wallet. The attacker drains the crank wallet indirectly through the vault. This is a novel cross-layer attack that exploits the automation's lack of spending limits.

2. **Stale WebSocket quote divergence**: The frontend computes quotes from WebSocket-pushed pool reserves. An attacker could execute a large swap that changes pool reserves, wait for the victim's frontend to show a favorable quote (based on old reserves), then front-run the victim's swap. The victim accepts the trade because the displayed quote was based on pre-attack reserves, but the actual execution happens at worse reserves. The on-chain slippage check is the only defense, but 5% default slippage gives significant room.

3. **Split route oracle manipulation**: The split router calculates optimal splits based on current pool reserves. An attacker who temporarily manipulates one pool's reserves (via a flash-loan-like pattern within a single slot) could make the split router favor a path that benefits the attacker's position. The 50 bps split threshold means the attacker needs to create a >0.5% artificial advantage for the split to trigger.

## Questions for Other Focus Areas

- **BOT-01**: Does the crank have any monitoring/alerting? The code only logs to stdout. Is Railway configured with alerts for specific log patterns (e.g., "WARNING: Wallet balance low")?
- **SEC-01**: Is the WALLET_KEYPAIR env var visible in Railway's settings UI? Who has access?
- **CHAIN-01**: What commitment level does the crank use for the vault balance check (line 222)? The provider defaults to `confirmed` from env, but is this sufficient for financial decisions?
- **INFRA-03**: Is Railway configured with auto-restart on crash? If so, the infinite retry + auto-restart could create rapid cycle burn.

## Raw Notes

- The overnight runner (`overnight-runner.ts`) is marked `@deprecated` but not deleted. It has significant overlap with the crank runner but includes test-specific logic (auto-airdrop, test user creation, WSOL budget). Should be archived or deleted to avoid accidental use.
- The E2E swap flow (`swap-flow.ts`) uses a different hook resolution approach than the frontend (`hook-resolver.ts`). The E2E version uses `createTransferCheckedWithTransferHookInstruction` (RPC-based), while the frontend uses manual PDA derivation. Both produce the same 4 accounts but via different paths. Consistency concern -- if the hook program's seed derivation changes, only one would break.
- The shared constants file (`shared/constants.ts`) exposes `HELIUS_API_KEY` (line 474). While documented as "free-tier, not a secret," this is an API key that could be abused for rate-limited endpoints. BOT-02 does not flag this (not trading-related) but SEC-02 should review.
- The `useSwap.ts` hook handles vault conversions with `minimumOutput = outputAmount` (line 344) -- correct since vault conversion is deterministic. This is a nice detail showing awareness of the difference between AMM swaps and fixed-rate conversions.
- The `parseSellSwapError` fallback message ("Swap failed. Please try again or reduce the swap amount.") in error-map.ts is generic and could mask real issues. But for user-facing code, this is acceptable.
