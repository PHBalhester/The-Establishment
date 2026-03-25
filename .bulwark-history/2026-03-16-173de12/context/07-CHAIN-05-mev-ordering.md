---
task_id: db-phase1-mev-ordering
provides: [mev-ordering-findings, mev-ordering-invariants]
focus_area: mev-ordering
files_analyzed: [app/lib/swap/multi-hop-builder.ts, app/hooks/useSwap.ts, app/hooks/useProtocolWallet.ts, app/providers/SettingsProvider.tsx, app/components/swap/SlippageConfig.tsx, app/components/launch/BuyForm.tsx, app/components/launch/SellForm.tsx, app/lib/swap/swap-builders.ts, app/lib/swap/route-engine.ts, app/lib/swap/quote-engine.ts, app/lib/confirm-transaction.ts, app/lib/curve/curve-tx-builder.ts, scripts/crank/crank-runner.ts, scripts/vrf/lib/vrf-flow.ts, scripts/e2e/lib/carnage-flow.ts, scripts/e2e/lib/alt-helper.ts, scripts/e2e/lib/swap-flow.ts, scripts/deploy/create-alt.ts]
finding_count: 9
severity_breakdown: {critical: 0, high: 3, medium: 4, low: 2}
---
<!-- CONDENSED_SUMMARY_START -->
# MEV & Transaction Ordering -- Condensed Summary

## Key Findings (Top 5-10)
- **Default slippage is 500 BPS (5%)**: Excessively high default exposes all user swaps to sandwich attacks out of the box -- `app/providers/SettingsProvider.tsx:77`
- **No MEV-protected RPC or Jito bundles for user swaps**: All user transactions are sent through standard Helius RPC with `sendRawTransaction`, fully visible in the public mempool -- `app/hooks/useProtocolWallet.ts:111`
- **Bonding curve transactions use skipPreflight=true**: BuyForm and SellForm both set `skipPreflight: true`, sending swap TXs without simulation, allowing broken TXs to land and making them visible to MEV bots immediately -- `app/components/launch/BuyForm.tsx:189`, `app/components/launch/SellForm.tsx:198`
- **Crank Carnage bundling closes MEV gap (CARN-002)**: VRF reveal + consume + executeCarnageAtomic are atomically bundled in a single v0 TX, preventing front-running of Carnage events. Well-implemented. -- `scripts/vrf/lib/vrf-flow.ts:310-328`
- **Slippage upper bound allows 100% (10000 BPS)**: SettingsProvider validates `slippageBps <= 10_000`, meaning a user can set 100% slippage and receive zero output -- `app/providers/SettingsProvider.tsx:104`
- **SlippageConfig custom input caps at 50% but SettingsProvider allows 100%**: Mismatch between UI validation (max 50%) and state validation (max 100%). Programmatic access or localStorage manipulation could set slippage beyond 50% -- `app/components/swap/SlippageConfig.tsx:133` vs `app/providers/SettingsProvider.tsx:104`
- **E2E test scripts use near-zero slippage (minimumOutput=1)**: Test swap flows use `minimumOutput = 1` as fallback, essentially no slippage protection. Acceptable for tests but if any test helper is reused in production paths, it creates an MEV vector -- `scripts/e2e/lib/swap-flow.ts:408,425`
- **No priority fee on bonding curve transactions**: BuyForm and SellForm do not include ComputeBudgetProgram instructions for priority fees. During congestion, these TXs may be delayed or dropped, and have no priority ordering protection -- `app/components/launch/BuyForm.tsx:182`, `app/components/launch/SellForm.tsx:181`
- **ALT cached as module-level singleton (stale state risk)**: The protocol ALT is cached in a module-level variable (`cachedALT`) and never invalidated. If the ALT is extended or recreated, stale cache could cause TX compilation failures -- `app/lib/swap/multi-hop-builder.ts:261`

## Critical Mechanisms
- **Slippage enforcement**: User-controlled via SettingsProvider (localStorage). Default 500 BPS. Applied as `minimumOutput = outputAmount * (10000 - slippageBps) / 10000`. Floor division means actual slippage protection is slightly tighter than configured. -- `app/hooks/useSwap.ts:407,432,472,502`
- **Priority fee presets**: Static map from preset name to microLamports/CU. None=0, Low=1000, Medium=10000, High=100000, Turbo=1000000. No dynamic fee estimation. Default is "medium" (10000 uLamports/CU). -- `app/hooks/useSwap.ts:94-100`
- **Atomic multi-hop execution**: All route steps combined into single v0 VersionedTransaction. Eliminates inter-hop MEV since no intermediate state is exposed between steps. -- `app/lib/swap/multi-hop-builder.ts:298-350`
- **Carnage atomic bundling**: Reveal + consume + executeCarnageAtomic in one TX. No CarnagePending event visible before swap. Closes CARN-002 MEV gap. -- `scripts/vrf/lib/vrf-flow.ts:269-341`
- **Sign-then-send wallet pattern**: User TXs are signed by wallet, then sent via `connection.sendRawTransaction` through the app's Helius RPC. Wallet does not control RPC endpoint. -- `app/hooks/useProtocolWallet.ts:87-121`

## Invariants & Assumptions
- INVARIANT: All user swap outputs must meet `minimumOutput >= expectedOutput * (10000 - slippageBps) / 10000` -- enforced at `app/hooks/useSwap.ts:407` / on-chain program checks
- INVARIANT: Carnage execution is atomic with VRF reveal+consume (no MEV window) -- enforced at `scripts/vrf/lib/vrf-flow.ts:310-328` when carnageAccounts+ALT provided
- INVARIANT: Multi-hop routes execute atomically (all-or-nothing, no partial state) -- enforced at `app/lib/swap/multi-hop-builder.ts:9` via single v0 TX
- ASSUMPTION: Helius RPC does not expose transaction data to MEV searchers before inclusion -- UNVALIDATED (depends on Helius infrastructure)
- ASSUMPTION: 500 BPS default slippage is acceptable for this protocol's liquidity depth -- UNVALIDATED (protocol has thin liquidity pools during early launch)
- ASSUMPTION: Static priority fee presets provide adequate inclusion priority -- UNVALIDATED (no dynamic fee estimation based on network conditions)
- ASSUMPTION: On-chain 50% slippage floor is a sufficient backstop against sandwich attacks -- partially validated at `scripts/e2e/lib/swap-flow.ts:403-425` but 50% is extremely loose

## Risk Observations (Prioritized)
1. **High default slippage (5%) enables profitable sandwich attacks**: `app/providers/SettingsProvider.tsx:77` -- With 500 BPS default slippage on a thin-liquidity memecoin, MEV bots can sandwich every swap for ~4.9% profit minus gas. Most DEX UIs default to 0.5-1%.
2. **No MEV protection on any user-facing swap path**: `app/hooks/useProtocolWallet.ts:111` -- All swaps go through standard RPC. No Jito bundles, no private mempool, no MEV-protected RPC endpoint. Every swap TX is visible pre-inclusion.
3. **Bonding curve TXs lack priority fees**: `app/components/launch/BuyForm.tsx:182` -- Launch page buy/sell TXs have no ComputeBudget instructions. During launch excitement with many concurrent users, these TXs compete poorly and are trivially reordered by validators.
4. **100% slippage settable via localStorage manipulation**: `app/providers/SettingsProvider.tsx:104` -- While UI caps custom at 50%, localStorage injection can set 10000 BPS. A malicious browser extension could set this silently.

## Novel Attack Surface
- **Epoch transition timing as MEV signal**: The crank runner's `waitForSlotAdvance` is public. A searcher monitoring crank wallet activity knows exactly when epoch transitions (and thus tax rate changes) will occur. They can front-run the transition to buy the token that will become "cheap" (low-tax) and sell the one that becomes "expensive". The VRF randomness is revealed in the same TX as consumption, but the crank's TX1 (create randomness) and TX2 (commit+trigger) telegraph that a transition is imminent. -- `scripts/vrf/lib/vrf-flow.ts:537-597`
- **Bonding curve launch front-running**: During bonding curve phase, the linear price curve means early buyers get cheaper prices. First-to-land TXs get the best price. With no priority fee and skipPreflight=true, launch TXs are trivially front-runnable by bots with higher priority fees. -- `app/components/launch/BuyForm.tsx:189`

## Cross-Focus Handoffs
- -> **CHAIN-01 (TX Construction)**: `skipPreflight: true` on bonding curve BuyForm/SellForm -- investigate whether simulation is needed before send, or if the on-chain program provides sufficient guards
- -> **CHAIN-02 (RPC Trust)**: All swap and bonding curve transactions rely on Helius RPC for both state reads (quote computation) and TX submission. Stale pool reserves used for quoting could cause user to set loose slippage, amplifying MEV exposure
- -> **SEC-01 (Key/Wallet)**: Crank runner wallet controls epoch transitions. If compromised, attacker could time transitions to front-run their own trades
- -> **BOT-01 (Crank)**: Crank's vault top-up mechanism transfers SOL without MEV protection. Small amounts but pattern worth noting.

## Trust Boundaries
User swap transactions cross from the browser into the Helius RPC node, which is the sole submission endpoint. The trust model assumes Helius does not front-run or leak transaction data pre-inclusion. The sign-then-send pattern ensures the wallet does not control which RPC receives the TX, but it also means no wallet-level simulation preview (the wallet signs blind). Slippage protection is the primary MEV defense -- set by the user with a dangerously high 500 BPS default. The on-chain 50% floor provides a backstop but is far too loose for practical MEV protection. The Carnage system has a well-designed atomic bundling pattern (CARN-002) that eliminates the crank's MEV window, but user-facing swaps have no equivalent protection.
<!-- CONDENSED_SUMMARY_END -->

---

# MEV & Transaction Ordering -- Full Analysis

## Executive Summary

The Dr. Fraudsworth protocol has a well-designed atomic bundling system for its Carnage mechanism (closing the CARN-002 MEV gap), and multi-hop swap atomicity via v0 VersionedTransactions. However, user-facing swap transactions have significant MEV exposure: a 5% default slippage, no private/MEV-protected RPC submission, no Jito bundle support, and bonding curve transactions that lack priority fees entirely. For a memecoin with thin liquidity pools, these gaps create a profitable sandwich attack surface.

## Scope

All off-chain TypeScript code related to:
- Swap transaction construction and submission (frontend + scripts)
- Slippage configuration and enforcement
- Priority fee configuration
- Transaction ordering mechanisms
- MEV protection patterns (Jito, private mempools, etc.)
- Crank/bot transaction patterns
- Address Lookup Table management

On-chain Anchor programs are out of scope (per auditor rules).

## Key Mechanisms

### 1. Slippage Configuration System

**Source of truth**: `app/providers/SettingsProvider.tsx`
- Default: 500 BPS (5%)
- Persisted to `localStorage` key `dr-fraudsworth-settings`
- Validation: `0 <= slippageBps <= 10000` (allows up to 100%)
- Consumed by `useSettings()` hook -> `useSwap()` hook -> all swap builders

**UI controls**: `app/components/swap/SlippageConfig.tsx`
- Presets: 0.5%, 1%, 2% (50, 100, 200 BPS)
- Custom input: capped at 50% via `parsed <= 50` check (line 133)
- Mismatch: SettingsProvider allows 100%, UI caps at 50%. Gap exploitable via localStorage.

**Application to swaps** (`app/hooks/useSwap.ts`):
- `minimumOutput = Math.floor(outputAmount * (10000 - slippageBps) / 10000)` (line 407 for buy, 432 for sell)
- Floor division provides slightly tighter protection than the configured percentage
- For atomic multi-hop routes, same slippage applied per-step (line 315-316 in multi-hop-builder.ts)

**Bonding curve** (`app/components/launch/BuyForm.tsx:168-169`, `SellForm.tsx:177-178`):
- Uses same SettingsProvider slippage: `minimumTokensOut = tokensOut * (10000n - slippageBps) / 10000n`
- BigInt arithmetic avoids floating-point issues

### 2. Priority Fee System

**Static presets** (`app/hooks/useSwap.ts:94-100`):
```
none: 0, low: 1_000, medium: 10_000, high: 100_000, turbo: 1_000_000
```
Default: "medium" (10,000 microLamports/CU)

**Application**:
- AMM swaps: priority fee included via `ComputeBudgetProgram.setComputeUnitPrice` in swap-builders.ts
- Multi-hop: `maxPriorityFee` from all steps taken as the combined priority (line 192 in multi-hop-builder.ts)
- Bonding curve: **NO** priority fee applied. BuyForm/SellForm build a raw `Transaction` with only the purchase/sell instruction and no ComputeBudget instructions.

**No dynamic estimation**: The system uses fixed presets. No real-time fee estimation (e.g., from `getRecentPrioritizationFees`). During congestion, "turbo" (1M uLamports) may still be insufficient, while "medium" (10K) may be wasteful during quiet periods.

### 3. Transaction Submission Path

**Frontend (user swaps)**: `app/hooks/useProtocolWallet.ts`
- Pattern: `signTransaction()` -> `connection.sendRawTransaction()`
- Sends through Helius RPC (app-controlled endpoint)
- Direct swap path: `skipPreflight: false` (line 747 in useSwap.ts)
- Multi-hop path: `skipPreflight: true` (line 381 in multi-hop-builder.ts) -- documented as devnet v0 TX workaround
- Bonding curve: `skipPreflight: true` (BuyForm line 189, SellForm line 198)

**No MEV protection**: No Jito bundles, no private mempool submission, no MEV-protected RPC. `sendRawTransaction` goes to standard Helius endpoint.

### 4. Atomic Multi-Hop Execution

`app/lib/swap/multi-hop-builder.ts` implements a well-designed atomic routing system:

1. Each route step builds a legacy Transaction
2. `processInstructionsForAtomic()` strips per-step ComputeBudget, converts ATA creates to idempotent, removes intermediate WSOL closeAccount
3. Combined into single v0 `VersionedTransaction` with protocol ALT
4. Single wallet signature, all-or-nothing execution

**MEV benefit**: No intermediate state between hops. A 2-hop SOL->CRIME->PROFIT route exposes no inter-hop CRIME balance for sandwiching.

**Observation**: The slippage is applied per-step (line 315-316), not just on final output. Since execution is atomic, per-step slippage is redundant but not harmful -- the comment at line 305 acknowledges this: "Atomic = no inter-hop risk, same slippage for all steps."

### 5. Carnage Atomic Bundling (CARN-002 Fix)

`scripts/vrf/lib/vrf-flow.ts:269-341`:
- When `carnageAccounts` + `alt` are provided, TX3 bundles: `revealIx + consumeIx + executeCarnageAtomicIx`
- The on-chain `executeCarnageAtomic` has a no-op guard: returns `Ok(())` when Carnage doesn't trigger
- This means the bundled TX always succeeds, and when Carnage triggers, the swap executes atomically in the same TX
- No `CarnagePending` event is visible on-chain before the swap completes
- This is a well-implemented MEV protection pattern

### 6. Crank Transaction Ordering

`scripts/crank/crank-runner.ts`:
- Runs on Railway as a 24/7 process
- Epoch transitions follow: waitForSlots -> TX1(create) -> TX2(commit+trigger) -> wait -> TX3(reveal+consume+carnage)
- No priority fees on crank transactions
- No Jito bundles for crank
- Vault top-up uses plain `SystemProgram.transfer` via standard RPC

## Trust Model

### Trust Boundaries

1. **Browser -> Helius RPC**: User swaps cross this boundary. Trust: Helius does not front-run or leak TXs. No verification.
2. **Wallet -> Application**: Sign-then-send pattern means the app controls submission RPC. The wallet cannot inject a different RPC. However, the wallet signs without simulation preview (signTransaction, not signAndSendTransaction).
3. **Crank -> Helius RPC**: Crank TXs (epoch transitions, vault top-ups) go through standard RPC. The crank wallet is a hot key on Railway.
4. **User -> localStorage**: Slippage settings stored client-side. Any browser extension or XSS can modify them.

### Trust Assumptions

- Helius RPC is non-adversarial (does not extract MEV from submitted transactions)
- Network conditions during mainnet will be accommodated by static priority fee presets
- 50% on-chain slippage floor is a sufficient backstop (it is not -- 50% loss is catastrophic)

## State Analysis

### Client-Side State
- **Slippage/priority settings**: `localStorage['dr-fraudsworth-settings']` -- persistent across sessions
- **ALT cache**: Module-level `cachedALT` in `multi-hop-builder.ts` -- never invalidated during app lifetime
- **Route cache**: `useRoutes` hook recomputes routes on pool/epoch state changes

### No Server-Side State
The protocol has no backend server for swap operations. All transaction construction happens client-side. The crank runner is a standalone process.

## Dependencies

- **@solana/web3.js**: Transaction construction, RPC calls, v0 VersionedTransaction support
- **@solana/spl-token**: Token account resolution, WSOL helpers
- **@coral-xyz/anchor**: Program interaction, IDL-typed method builders
- **@switchboard-xyz/on-demand**: VRF randomness creation, commit, reveal
- **Helius RPC**: Sole RPC provider for all on-chain interactions

## Focus-Specific Analysis

### MEV Attack Surface: User Swaps

**Sandwich attack viability**:
- Default 5% slippage on thin-liquidity memecoin pools = highly profitable sandwiching
- No private mempool protection
- TXs visible in Helius node's mempool
- For a $1000 swap with 5% slippage, sandwich profit ceiling is ~$49 minus gas (~$0.01)
- Attack is scriptable and requires no special access

**Front-running viability**:
- Bonding curve TXs (launch page) have no priority fees and use skipPreflight=true
- First-to-land advantage on linear bonding curve means earlier buys get lower prices
- Bot with higher priority fee will always land before organic users

**Back-running viability**:
- After large swaps move pool price, arbitrage bots can back-run to capture the price deviation
- This is standard Solana MEV behavior, not protocol-specific

### MEV Attack Surface: Crank Operations

**Epoch transition front-running**:
- TX1 (create randomness) and TX2 (commit+trigger) are visible on-chain before TX3 (reveal+consume)
- A searcher who sees TX2 knows an epoch transition is imminent
- However, they don't know the VRF outcome (new tax rates, cheap side, Carnage trigger) until TX3 lands
- Since TX3 is atomic with Carnage execution, there's no window to front-run Carnage swaps
- But: after TX3, if tax rates flip, a searcher could immediately buy the newly-cheap token before organic users react

**Vault top-up**:
- `SystemProgram.transfer` for 0.005 SOL top-ups
- Not worth sandwiching due to tiny amounts
- No MEV concern here

### skipPreflight Usage Analysis

| Location | skipPreflight | Justified? |
|----------|:---:|---|
| `useSwap.ts:747` (direct swap) | false | Yes -- standard submission |
| `multi-hop-builder.ts:381` (atomic route) | true | Partially -- devnet workaround. Should be revisited for mainnet |
| `BuyForm.tsx:189` (bonding curve buy) | true | Needs investigation -- no clear justification in comments |
| `SellForm.tsx:198` (bonding curve sell) | true | Same as above |
| `vrf-flow.ts:559` (VRF create) | true | Yes -- documented SDK LUT staleness issue |
| `alt-helper.ts:414` (sendV0Transaction) | true | Partially -- v0 TX pattern. Checks confirmation.err |

### Slippage Analysis by Path

| Swap Path | Slippage Source | Default | Concern |
|-----------|----------------|---------|---------|
| Direct SOL buy/sell | SettingsProvider | 500 BPS (5%) | Too high for thin pools |
| Multi-hop (atomic) | SettingsProvider (per-step) | 500 BPS | Per-step application redundant but safe |
| Vault conversion | N/A (deterministic) | 0 | No concern -- fixed 100:1 rate |
| Bonding curve buy | SettingsProvider | 500 BPS | 5% on linear curve is generous for bots |
| Bonding curve sell | SettingsProvider | 500 BPS | Same |
| E2E test swaps | Hardcoded `1` or `51%` of expected | ~49% | Test only -- acceptable |

## Cross-Focus Intersections

### CHAIN-01 (TX Construction)
- `skipPreflight: true` on bonding curve paths means broken TXs can be broadcast. If on-chain program rejects, the TX lands as a confirmed-but-failed TX (user pays gas, gets nothing). CHAIN-01 should investigate whether pre-send simulation is needed.
- Multi-hop instruction reordering in `processInstructionsForAtomic` is a TX construction concern that overlaps with MEV (reordering could theoretically change execution semantics).

### CHAIN-02 (RPC Trust)
- All quotes are computed from pool reserves fetched via Helius RPC. If RPC returns stale reserves, the quote will be wrong, and the user may set slippage based on incorrect expectations. Stale reserves + high slippage = amplified MEV exposure.

### CHAIN-03 (Wallet Adapter)
- Sign-then-send pattern means wallet does not simulate the TX before signing. User signs blind. If TX is manipulated before reaching the wallet (e.g., via browser extension), user has no simulation preview.

### SEC-01 (Key/Wallet)
- Crank wallet is a hot key on Railway. If compromised, attacker could time epoch transitions for their own trading benefit (front-run tax rate changes).

### BOT-01 (Crank)
- Crank has no priority fees on any of its TXs. During mainnet congestion, crank TXs could be delayed, causing epochs to run longer than intended.

## Cross-Reference Handoffs

1. **-> CHAIN-01**: Review `skipPreflight: true` on BuyForm/SellForm -- is pre-flight simulation needed?
2. **-> CHAIN-02**: Verify RPC commitment level for pool reserve reads used in quote computation
3. **-> SEC-01**: Crank wallet key security on Railway -- compromise enables epoch transition manipulation
4. **-> BOT-01**: Crank priority fee strategy for mainnet -- current static fees may be insufficient
5. **-> LOGIC-02**: Verify that on-chain 50% slippage floor is intentional and appropriate

## Risk Observations

### R-01: Default 5% Slippage (HIGH)
**File**: `app/providers/SettingsProvider.tsx:77`
**Impact**: Every user who does not change settings is exposed to ~4.9% MEV extraction on every swap.
**Likelihood**: Probable -- MEV bots are ubiquitous on Solana.
**Recommendation**: Reduce default to 100 BPS (1%) or less. Consider dynamic slippage based on pool liquidity depth.

### R-02: No MEV-Protected Transaction Submission (HIGH)
**File**: `app/hooks/useProtocolWallet.ts:111`
**Impact**: All swap transactions are visible in the public mempool. Sandwich attacks are trivially executable.
**Likelihood**: Probable on mainnet.
**Recommendation**: Integrate Jito bundle submission for swap transactions, or use an MEV-protected RPC endpoint (e.g., Helius's protected endpoints, if available).

### R-03: Bonding Curve TXs Lack Priority Fees (HIGH)
**File**: `app/components/launch/BuyForm.tsx:182`, `app/components/launch/SellForm.tsx:181`
**Impact**: During launch, bot TXs with higher priority fees will consistently front-run organic users, getting better bonding curve prices.
**Likelihood**: Probable -- bonding curve launches are heavily targeted by bots.
**Recommendation**: Add ComputeBudget instructions using the user's priority fee preset from SettingsProvider.

### R-04: Slippage Validation Mismatch (MEDIUM)
**File**: `app/providers/SettingsProvider.tsx:104` vs `app/components/swap/SlippageConfig.tsx:133`
**Impact**: UI caps at 50% but state allows 100%. Malicious extension could set 100% slippage via localStorage.
**Likelihood**: Possible -- requires browser extension or XSS.
**Recommendation**: Cap SettingsProvider validation at 5000 BPS (50%) to match UI. Better: cap at 3000 BPS (30%) since even 30% is extremely high.

### R-05: Static Priority Fee Presets (MEDIUM)
**File**: `app/hooks/useSwap.ts:94-100`
**Impact**: During network congestion, even "turbo" (1M uLamports) may be insufficient. During quiet periods, "medium" wastes user SOL.
**Likelihood**: Possible -- Solana congestion is episodic.
**Recommendation**: Add dynamic fee estimation using `getRecentPrioritizationFees` RPC method.

### R-06: Epoch Transition Telegraphing (MEDIUM)
**File**: `scripts/vrf/lib/vrf-flow.ts:537-597`
**Impact**: Crank TX1/TX2 signal that an epoch transition is imminent. Searchers can position ahead of tax rate changes.
**Likelihood**: Possible -- requires monitoring crank wallet activity.
**Recommendation**: Consider whether epoch transitions should use Jito bundles to minimize the visibility window between TX2 and TX3.

### R-07: Module-Level ALT Cache (MEDIUM)
**File**: `app/lib/swap/multi-hop-builder.ts:261`
**Impact**: If ALT is modified (extended/recreated), cached version causes TX compilation failures until page refresh.
**Likelihood**: Unlikely during normal operations. Possible during protocol upgrades.
**Recommendation**: Add TTL-based cache invalidation (e.g., refresh every 30 minutes).

### R-08: skipPreflight on Bonding Curve (LOW)
**File**: `app/components/launch/BuyForm.tsx:189`
**Impact**: TXs that would fail simulation are broadcast anyway. User pays gas for failed TXs.
**Likelihood**: Unlikely for well-formed TXs, but possible during rapid price movement.
**Recommendation**: Set `skipPreflight: false` unless there's a documented v0 TX issue like the multi-hop path.

### R-09: E2E Test Hardcoded Slippage (LOW)
**File**: `scripts/e2e/lib/swap-flow.ts:408,425`
**Impact**: `minimumOutput = 1` in test helpers. No production impact unless helpers are imported in production code paths.
**Likelihood**: Rare -- test helpers are in scripts/ not app/.
**Recommendation**: No action needed unless code reuse patterns change.

## Novel Attack Surface Observations

### Epoch Transition MEV Strategy
An attacker monitoring the crank wallet can observe TX1 (create randomness) confirming on-chain, which guarantees TX2 (commit+trigger) is coming within seconds. While they cannot predict the VRF outcome, they can prepare two conditional transactions: one to buy CRIME (if it becomes cheap) and one to buy FRAUD (if it becomes cheap). After TX3 lands and reveals the new tax rates, the attacker can immediately submit the appropriate transaction. With no MEV protection on user swaps, the attacker's transaction will land before organic users can react to the new tax rates.

This is a **timing oracle attack**: the crank's multi-TX flow creates an information asymmetry between the crank operator (who can bundle) and external observers (who can see individual TXs).

### Bonding Curve Launch Sniping
During bonding curve phase, the linear price curve creates a strong first-mover advantage. The BuyForm lacks priority fees, meaning a bot with a simple `setComputeUnitPrice(1_000_000)` instruction will consistently land before organic users. Combined with `skipPreflight: true` (which broadcasts immediately), the bot can front-run every purchase.

A more sophisticated attack: the bot monitors mempool for user purchase TXs, reads the `solAmount` parameter, and submits a purchase TX with higher priority fee and the maximum allowed amount. This front-runs the user and moves the curve price up. The user's TX then lands at the higher price. If the user's `minimumTokensOut` (with 5% slippage) still clears, both TXs succeed and the bot sells at a profit.

## Questions for Other Focus Areas

1. **CHAIN-02**: What commitment level does `usePoolPrices` use to fetch reserves? If "processed", stale data amplifies MEV risk.
2. **BOT-01**: Does the crank have a priority fee budget for mainnet? Current crank TXs use `sendAndConfirm` with default options (no priority fee).
3. **LOGIC-02**: Is the on-chain 50% slippage floor a deliberate design choice or a placeholder? 50% loss protection is catastrophic for users.
4. **SEC-01**: Is the crank wallet key rotatable without downtime? Key compromise enables epoch manipulation.
5. **CHAIN-03**: Does Blowfish (Phantom's TX simulation) catch sandwich attacks in its preview? The sign-then-send pattern bypasses Phantom's built-in simulation.

## Raw Notes

- `route-engine.ts` line 1 mentions "MEV" only in the context of fee display, not protection
- No imports or references to `jito-ts`, `@jito-labs/*`, or any MEV protection library in the entire codebase
- The only MEV mitigation is the CARN-002 atomic bundling (crank-side only)
- `pollTransactionConfirmation` waits for "confirmed" commitment, not "finalized". This is fine for UX feedback but means the user sees "confirmed" before the TX is truly final. Not an MEV issue per se, but relevant for state consistency.
- The `confirm-transaction.ts` helper checks `confirmationStatus === "confirmed" || "finalized"` and returns `status.err`. This is correctly implemented for the skipPreflight pattern.
- The `sendV0Transaction` helper in `alt-helper.ts` (line 413-444) correctly checks `confirmation.value.err` after skipPreflight send. This is the secure pattern for v0 TX submission.
