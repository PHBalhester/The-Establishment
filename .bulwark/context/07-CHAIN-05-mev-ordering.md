---
task_id: db-phase1-chain-05
provides: [chain-05-findings, chain-05-invariants]
focus_area: chain-05
files_analyzed:
  - app/hooks/useSwap.ts
  - app/hooks/useStaking.ts
  - app/hooks/useProtocolWallet.ts
  - app/hooks/useRoutes.ts
  - app/lib/swap/swap-builders.ts
  - app/lib/swap/multi-hop-builder.ts
  - app/lib/swap/route-engine.ts
  - app/lib/staking/staking-builders.ts
  - app/lib/confirm-transaction.ts
  - app/lib/connection.ts
  - app/providers/SettingsProvider.tsx
  - app/components/swap/SlippageConfig.tsx
  - app/components/swap/FeeBreakdown.tsx
  - app/components/launch/BuyForm.tsx
  - app/components/launch/SellForm.tsx
  - app/app/api/rpc/route.ts
  - scripts/deploy/fix-carnage-wsol.ts
  - scripts/e2e/lib/stress-wallet.ts
  - scripts/e2e/lib/carnage-flow.ts
  - scripts/vrf/lib/vrf-flow.ts
finding_count: 8
severity_breakdown: {critical: 0, high: 2, medium: 4, low: 2}
---
<!-- CONDENSED_SUMMARY_START -->
# MEV & Transaction Ordering (CHAIN-05) -- Condensed Summary

## Key Findings (Top 8)

1. **Default slippage 500 BPS (5%) for all swap types**: All AMM swaps and bonding curve operations default to 5% slippage tolerance. This is the single most extractable parameter for sandwich bots. On a 10 SOL swap, up to 0.5 SOL is extractable. -- `app/providers/SettingsProvider.tsx:170`
2. **No MEV-protected transaction submission**: All user-facing swap transactions are submitted via standard Helius RPC (`connection.sendRawTransaction`). No Jito bundles, no private mempool, no MEV-protected endpoints used anywhere. -- `app/hooks/useProtocolWallet.ts:111`
3. **skipPreflight:true on multi-hop, bonding curve buys/sells**: Multi-hop v0 transactions and bonding curve operations skip preflight simulation, meaning broken/exploitable transactions reach validators without client-side safety check. -- `app/lib/swap/multi-hop-builder.ts:381`, `app/components/launch/BuyForm.tsx:191`, `app/components/launch/SellForm.tsx:200`
4. **Slippage UI presets don't match default**: SlippageConfig offers 0.5%, 1%, 2% presets, but the default loaded from SettingsProvider is 5% (500 BPS). Most users never open settings, so 5% is the effective default. -- `app/components/swap/SlippageConfig.tsx:43-47` vs `app/providers/SettingsProvider.tsx:170`
5. **No price impact rejection threshold**: The route engine and swap hook compute price impact but never reject routes exceeding a dangerous threshold. A user can submit a swap with 50%+ price impact without any blocking guard. -- `app/lib/swap/route-engine.ts:351-354`, `app/hooks/useSwap.ts:415-431`
6. **Quote-to-execution staleness window**: Quote is computed with 300ms debounce and stored in React state. By the time user signs and TX lands (~5-15 seconds later), pool reserves may have changed. The minimumOutput protects against excess slippage, but the 5% default makes this protection very loose. -- `app/hooks/useSwap.ts:563-566`
7. **Staking claim/unstake not MEV-relevant but uses same submission path**: Staking transactions (claim SOL, unstake PROFIT) go through the same unprotected `sendRawTransaction` path. While less sandwichable than swaps, claim timing could be observable. -- `app/hooks/useStaking.ts:580`
8. **Priority fee controls exist but default to "medium" (10,000 microLamports)**: The PRIORITY_FEE_MAP provides 5 tiers up to "turbo" (1,000,000 uL). Default "medium" at 10,000 uL may be insufficient for mainnet inclusion during congestion, but is appropriate for memecoin pairs. -- `app/hooks/useSwap.ts:101-107`

## Critical Mechanisms

- **Transaction Submission Pipeline**: Browser -> `useProtocolWallet.sendTransaction()` -> `wallet.signTransaction()` -> `connection.sendRawTransaction()` via `/api/rpc` proxy -> Helius RPC -> Solana. No MEV protection at any layer. -- `app/hooks/useProtocolWallet.ts:87-118`
- **Slippage Application**: `minimumOutput = floor(outputAmount * (10_000 - slippageBps) / 10_000)` computed client-side, passed to on-chain `swap_sol_buy`/`swap_sol_sell` as `minimum_output` parameter. On-chain enforces this. Off-chain sets it. -- `app/hooks/useSwap.ts:418,447`
- **Multi-hop Atomic Execution**: v0 VersionedTransaction bundles all hops into one TX. Atomic execution prevents inter-hop sandwich but the overall TX is still sandwichable via Jito bundles. skipPreflight:true used due to devnet v0 simulation bug. -- `app/lib/swap/multi-hop-builder.ts:298-350,368-416`
- **RPC Proxy**: Browser never directly contacts Helius. All RPC goes through `/api/rpc` which has a method allowlist. `sendTransaction` is allowed through the proxy. This means the browser's swap TX goes: browser -> Next.js server -> Helius -> Solana validators. -- `app/app/api/rpc/route.ts:31-59`
- **Sign-Then-Send Pattern**: Wallet signs only (`signTransaction`), then the app submits via `connection.sendRawTransaction`. This prevents the wallet from using its own RPC (Phantom's internal RPC drops devnet TXs). On mainnet, this bypasses any MEV protection Phantom's own RPC might offer. -- `app/hooks/useProtocolWallet.ts:76-118`

## Invariants & Assumptions

- INVARIANT: On-chain `minimum_output` is enforced regardless of client quote accuracy -- enforced at `programs/tax-program/src/instructions/swap_sol_buy.rs` (on-chain, out of scope)
- INVARIANT: Slippage BPS is bounded [0, 10000] in SettingsProvider validation -- enforced at `app/providers/SettingsProvider.tsx:196-197`
- INVARIANT: Multi-hop transactions are atomic (all-or-nothing) -- enforced at `app/lib/swap/multi-hop-builder.ts:7-8` via single VersionedTransaction
- INVARIANT: On-chain 50% output floor protects sell path even when off-chain passes minimum_output=0 -- enforced on-chain (ref. ARCHITECTURE.md section 7.5) / NOT enforced off-chain
- ASSUMPTION: Helius RPC does not expose transactions to MEV searchers before inclusion -- UNVALIDATED (Helius is a standard RPC provider, not MEV-protected)
- ASSUMPTION: 5% default slippage is acceptable for memecoin pairs -- QUESTIONABLE (per MEMORY.md Carnage bug fix: "50% slippage floor" suggests protocol expects high volatility, but 5% is still generous for normal operation)
- ASSUMPTION: Browser RPC proxy does not add meaningful latency to TX submission -- UNVALIDATED (additional hop could increase sandwich window)
- ASSUMPTION: Users will adjust slippage from default before large trades -- UNVALIDATED (most users don't change defaults)

## Risk Observations (Prioritized)

1. **[HIGH] Default 500 BPS slippage on all swaps**: `app/providers/SettingsProvider.tsx:170` -- 5% default creates automatic 5% sandwich profit ceiling on every swap. This is the #1 MEV extraction vector. Previous audit H015 flagged this as NOT_FIXED. Impact: systematic value extraction proportional to swap volume. A user swapping 100 SOL loses up to 5 SOL to sandwich bots.

2. **[HIGH] No MEV-protected submission for swap transactions**: `app/hooks/useProtocolWallet.ts:111` -- All swap TXs go through standard Helius RPC. No Jito bundles, no private transaction relay, no MEV-shielded endpoint. Combined with 5% slippage, every swap is a sandwich target. Impact: Users lose value on every trade in proportion to slippage tolerance.

3. **[MEDIUM] skipPreflight:true on multi-hop and bonding curve TXs**: `app/lib/swap/multi-hop-builder.ts:381`, `app/components/launch/BuyForm.tsx:191` -- Without preflight simulation, malformed or stale transactions reach validators. Previous audit H039 flagged this as NOT_FIXED for bonding curve TXs. Impact: failed TXs waste priority fees; could mask on-chain errors.

4. **[MEDIUM] No price impact guard or warning threshold blocking execution**: `app/lib/swap/route-engine.ts:351-354` -- Price impact is displayed in UI (`FeeBreakdown.tsx:138` shows red above 500 BPS) but execution is never blocked. Impact: Users can execute swaps with extreme price impact, amplifying MEV extraction.

5. **[MEDIUM] Slippage default vs. UI presets mismatch**: `app/providers/SettingsProvider.tsx:170` vs `app/components/swap/SlippageConfig.tsx:43-47` -- Default is 500 BPS (5%) but the highest preset button is 200 BPS (2%). Users who open settings see 0.5%/1%/2% options but start at 5%. Confusing UX that leaves most users at the exploitable default.

6. **[MEDIUM] Quote staleness between computation and execution**: `app/hooks/useSwap.ts:563-566` to `app/hooks/useSwap.ts:757-766` -- 300ms debounce + signing time + RPC round-trip = 5-15 second window where pool state can shift. With 5% slippage, this window is very forgiving for attackers.

7. **[LOW] Bonding curve TXs lack ComputeBudget instructions**: `app/components/launch/BuyForm.tsx:183-186` -- BuyForm and SellForm build transactions without ComputeBudgetProgram instructions. Previous audit H041 flagged this. Impact: TX may fail during congestion due to default 200K CU limit being insufficient.

8. **[LOW] Priority fee "none" option allows zero-priority TXs**: `app/hooks/useSwap.ts:102` -- Users can set priority fee to "none" (0 microLamports), making their TX lowest priority. During congestion, TX may be deprioritized or delayed, widening the sandwich window.

## Novel Attack Surface

- **Cross-epoch tax arbitrage via VRF observation**: The architecture document (Section 9, item 3) notes that an attacker monitoring Switchboard reveal TX can predict new tax rates and front-run `consume_randomness` to trade at old rates. Off-chain code does not bundle reveal+consume+taxUpdate atomically for user-facing operations. The crank handles this atomically, but if the crank is delayed, the window is open.
- **RPC proxy as MEV intelligence**: The `/api/rpc` proxy passes `sendTransaction` through to Helius. If the Next.js server logs or if Railway's infrastructure inspects request bodies, swap transaction contents (amounts, slippage, pool) are observable server-side. This is an operational trust boundary concern.
- **Split route amplifies sandwich surface**: Split routes (SOL->PROFIT via both CRIME and FRAUD pools) create two AMM swap instructions in one TX. A sophisticated MEV bot could sandwich both legs of the split, doubling the extraction surface versus a single-hop route.
- **Sign-then-send bypasses Phantom's MEV protection**: Phantom has been adding MEV protection features (MEV-protected RPC). By using `signTransaction` + `sendRawTransaction` instead of `sendTransaction`, this app explicitly bypasses any wallet-level MEV protection.

## Cross-Focus Handoffs

- **-> SEC-01 (Access Control)**: The `useProtocolWallet.ts` sign-then-send pattern bypasses wallet-level protections. Investigate whether Phantom/Solflare's own MEV protection is being intentionally circumvented and the security implications.
- **-> CHAIN-01 (RPC Trust)**: All transaction submission goes through a single Helius RPC endpoint. If Helius is compromised or cooperating with MEV searchers, all user swap data is exposed. No RPC failover for `sendRawTransaction`.
- **-> LOGIC-01 (Business Logic)**: The 50% on-chain output floor and the off-chain 5% slippage create a gap. On sells, the Tax Program passes minimum_amount_out=0 to AMM (per ARCHITECTURE.md 7.5). The on-chain 50% floor protects against catastrophic loss, but the 5% off-chain default means the zone between 95% and 50% is exploitable.
- **-> BOT-01 (Crank/Keeper)**: The crank runner submits epoch transitions and carnage executions. These are permissionless but time-sensitive. Verify the crank uses adequate priority fees and handles MEV-related ordering concerns for epoch transitions.
- **-> ERR-02 (Error Handling)**: skipPreflight:true means error detection is deferred to confirmation polling. If `pollTransactionConfirmation` misinterprets a failed TX, users may see incorrect status.

## Trust Boundaries

The MEV trust model has three layers: (1) On-chain enforcement (minimumOutput, 50% output floor) provides the hard safety net -- this is the only layer guaranteed to work. (2) Off-chain slippage setting (default 500 BPS / 5%) determines how much value is extractable between the quoted price and the on-chain minimum -- this is the primary MEV attack surface. (3) Transaction submission pathway (standard Helius RPC, no Jito/private mempool) determines whether MEV searchers can observe and sandwich pending transactions. Layers 2 and 3 are both weak: the default slippage is too generous, and the submission path offers zero MEV protection. The protocol relies almost entirely on layer 1 (on-chain) for MEV defense, which is appropriate for a security-first design, but the gap between layer 1 (50%) and layer 2 (5%) represents significant extractable value that on-chain protections cannot prevent.
<!-- CONDENSED_SUMMARY_END -->

---

# MEV & Transaction Ordering (CHAIN-05) -- Full Analysis

## Executive Summary

This audit examines all off-chain code paths related to MEV (Maximal Extractable Value) exposure, transaction ordering vulnerabilities, slippage protection, priority fee handling, and transaction submission security in the Dr. Fraudsworth protocol.

The protocol has **no MEV-protected transaction submission** for any user-facing operation. All swap transactions are sent through a standard Helius RPC endpoint via a proxy, making them visible to MEV searchers. Combined with a **5% default slippage tolerance**, this creates a systematically exploitable attack surface where sandwich bots can extract up to 5% of every swap's value.

The on-chain 50% output floor provides a hard lower bound on swap outputs for the sell path, and the user's `minimumOutput` parameter (derived from the 5% slippage) provides the practical extraction ceiling. The gap between these two values (5% to 50% of swap output) represents varying degrees of extractable value depending on the attacker's capability.

Previous audit finding H015 identified the 5% default slippage as a HIGH-severity issue and marked it NOT_FIXED. This finding remains valid and is the single most impactful MEV concern in the off-chain codebase.

## Scope

### Files Analyzed (Full Read - Layer 3)
1. `app/hooks/useSwap.ts` (954 LOC) -- Complete swap lifecycle orchestration
2. `app/hooks/useStaking.ts` (715 LOC) -- Staking TX building and submission
3. `app/hooks/useProtocolWallet.ts` (131 LOC) -- Sign-then-send wallet abstraction
4. `app/lib/swap/swap-builders.ts` (507 LOC) -- Transaction construction for all swap types
5. `app/lib/swap/multi-hop-builder.ts` (416 LOC) -- Atomic v0 transaction assembly
6. `app/lib/swap/route-engine.ts` (445 LOC) -- Route enumeration and quoting
7. `app/lib/staking/staking-builders.ts` (379 LOC) -- Staking instruction assembly
8. `app/lib/confirm-transaction.ts` (67 LOC) -- HTTP polling confirmation
9. `app/lib/connection.ts` (87 LOC) -- RPC connection factory

### Files Analyzed (Signature Scan - Layer 2)
10. `app/providers/SettingsProvider.tsx` -- Default slippage and priority fee configuration
11. `app/components/swap/SlippageConfig.tsx` -- User-facing slippage controls
12. `app/components/swap/FeeBreakdown.tsx` -- Price impact display
13. `app/components/launch/BuyForm.tsx` -- Bonding curve buy submission
14. `app/components/launch/SellForm.tsx` -- Bonding curve sell submission
15. `app/app/api/rpc/route.ts` -- RPC proxy with method allowlist
16. `app/hooks/useRoutes.ts` -- Split route computation

### Files Analyzed (Index Scan - Layer 1)
17. `scripts/deploy/fix-carnage-wsol.ts` -- One-time fix script
18. `scripts/e2e/lib/stress-wallet.ts` -- Stress test TX submission
19. `scripts/e2e/lib/carnage-flow.ts` -- Carnage E2E test
20. `scripts/vrf/lib/vrf-flow.ts` -- VRF TX submission

## Key Mechanisms

### 1. Transaction Submission Pipeline

All user-initiated transactions follow this path:

```
User Action (click swap/stake/claim)
  -> useSwap.executeSwap() or useStaking.execute() or executeAtomicRoute()
    -> wallet.sendTransaction(tx, connection, opts)
      -> useProtocolWallet.wrappedSendTransaction()
        -> wallet.signTransaction(tx)         [wallet popup]
        -> connection.sendRawTransaction()     [via /api/rpc proxy]
          -> Helius RPC (HELIUS_RPC_URL)
            -> Solana validators
```

**Critical observation**: The sign-then-send pattern (`signTransaction` + `sendRawTransaction`) was chosen to work around Phantom's devnet RPC issue (per MEMORY.md). However, this explicitly bypasses any MEV protection that Phantom or other wallets may offer through their `signAndSendTransaction` endpoint.

The comment at `useProtocolWallet.ts:78-86` documents this as intentional for devnet reliability. For mainnet, this decision should be revisited -- Phantom's RPC has been adding MEV protection features.

### 2. Slippage Protection

Slippage is applied at two levels:

**Off-chain (client-side)**:
```typescript
// app/hooks/useSwap.ts:418
const minimumOutput = Math.floor(outputTokens * (10_000 - slippageBps) / 10_000);
```

This value is passed to the on-chain program as the `minimum_output` parameter.

**On-chain (program-enforced)**:
- Buy path: Tax Program checks `output >= minimumOutput` after tax deduction
- Sell path: Tax Program passes `minimum_amount_out = 0` to AMM, but enforces its own 50% output floor

The off-chain default of 500 BPS (5%) means:
- On a 100 SOL buy, minimumOutput allows up to 5 SOL of slippage
- On a sell, the 50% on-chain floor is the hard bottom, but the 5% off-chain tolerance is the effective ceiling for sandwich extraction

### 3. Priority Fee System

Priority fees are managed through a preset system:

```typescript
// app/hooks/useSwap.ts:101-107
const PRIORITY_FEE_MAP: Record<PriorityFeePreset, number> = {
  none: 0,
  low: 1_000,
  medium: 10_000,     // DEFAULT
  high: 100_000,
  turbo: 1_000_000,
};
```

Priority fees affect MEV exposure in two ways:
1. Higher fees = faster inclusion = smaller sandwich window
2. Higher fees = more attractive to validators who may cooperate with MEV searchers

The default "medium" (10,000 microLamports per CU) is reasonable. At 200,000 CU per swap, this adds 2,000,000 microLamports = 0.002 SOL to transaction cost.

### 4. Atomic Multi-Hop Execution

Multi-hop routes (e.g., SOL -> CRIME -> PROFIT) are packaged into a single VersionedTransaction (v0):

```typescript
// app/lib/swap/multi-hop-builder.ts:298-350
export async function buildAtomicRoute(...) {
  // Build legacy Transaction per step, then combine into one v0 TX
  const instructions = processInstructionsForAtomic(stepTransactions);
  const messageV0 = new TransactionMessage({ ... }).compileToV0Message([alt]);
  return { transaction: new VersionedTransaction(messageV0), ... };
}
```

This atomicity is good -- it prevents inter-hop sandwich attacks where an attacker could change pool state between hop 1 and hop 2. However, the entire atomic TX is still sandwichable as a unit.

### 5. Bonding Curve Transaction Submission

Bonding curve buy/sell operations (`BuyForm.tsx`, `SellForm.tsx`) have their own MEV concerns:
- `skipPreflight: true` (no simulation before broadcast)
- No ComputeBudgetProgram instructions (rely on default 200K CU)
- Use the same 5% default slippage from SettingsProvider
- No priority fee configuration exposed to user

These transactions are potentially sandwichable during the pre-graduation phase when bonding curve liquidity is thin.

## Trust Model

### What the protocol trusts

1. **On-chain programs**: The Tax Program enforces `minimumOutput` and the 50% sell output floor. This is the strongest protection layer.
2. **Helius RPC**: Trusted as an honest relay that doesn't front-run or leak transactions. This is a reasonable trust assumption for a major RPC provider, but it's not verifiable.
3. **Wallet adapter**: Trusted to faithfully sign the exact transaction presented. The sign-then-send pattern verifies this.

### What the protocol does NOT protect against

1. **Validator-level MEV**: Jito validators can reorder transactions within a slot. Without Jito bundles or a private transaction relay, swap TXs are fully visible.
2. **RPC-level observation**: Any entity with access to the RPC pipeline (Helius, network intermediaries) can observe pending transactions before inclusion.
3. **User-level slippage mistakes**: 5% default allows substantial extraction with no guard.

## State Analysis

### Slippage State Flow

1. Default 500 BPS loaded from `SettingsProvider.getDefaults()` -> `app/providers/SettingsProvider.tsx:170`
2. Persisted in localStorage under `"dr-fraudsworth-settings"` -> `app/providers/SettingsProvider.tsx:148`
3. Read by `useSettings()` hook in `useSwap.ts` -> `app/hooks/useSwap.ts:194-196`
4. Applied to quote computation -> `app/hooks/useSwap.ts:418,447,488,520`
5. Applied to route minimumOutput -> `app/lib/swap/route-engine.ts:369`
6. Passed to on-chain instruction as `new BN(minimumOutput)` -> `app/lib/swap/swap-builders.ts:257`

The slippage value flows through 6 layers before reaching the blockchain. At no point is there a safety cap or adaptive adjustment.

### Priority Fee State Flow

1. Default "medium" from `SettingsProvider.getDefaults()` -> `app/providers/SettingsProvider.tsx:171`
2. Mapped to microLamports via `PRIORITY_FEE_MAP` -> `app/hooks/useSwap.ts:101-107`
3. Passed to `ComputeBudgetProgram.setComputeUnitPrice()` -> `app/lib/swap/swap-builders.ts:213`

This is straightforward and well-implemented. No concerns.

## Dependencies

### External APIs
- **Helius RPC**: All transaction submission. Standard (non-MEV-protected) endpoint.
- **Solana web3.js**: `Connection.sendRawTransaction()` for submission, `getSignatureStatuses()` for confirmation.

### Internal Dependencies
- **On-chain Tax Program**: Enforces `minimumOutput` and 50% output floor
- **On-chain AMM**: Enforces k-invariant (constant product)
- **Protocol ALT**: Address Lookup Table for v0 transaction account compression

## Focus-Specific Analysis

### OC-127: Frontrunnable Transaction (No MEV Protection)

**Status: PRESENT**

Every swap transaction in the protocol matches the vulnerable pattern from OC-127:
```typescript
// app/hooks/useProtocolWallet.ts:111
const signature = await connection.sendRawTransaction(serialized, {
  skipPreflight: sendOptions.skipPreflight,
  ...
});
```

No Jito bundle, no private mempool, no MEV-protected RPC endpoint. The Helius RPC URL (`HELIUS_RPC_URL` env var) is a standard endpoint.

Searched for any MEV-protection patterns:
```
jito|nozomi|mev.*protect|private.*mempool|bundle.*endpoint|block.*engine
```
Result: Zero matches in app/ directory (only a comment in the Epoch Program IDL about bundling VRF operations).

**Relevance to FP-020**: Not a false positive. This involves swap transactions with direct financial impact. FP-020 only exempts "simple operations (account creation, non-financial state changes)."

### OC-128: Sandwich Attack on Swap

**Status: PRESENT**

The combination of:
1. Public RPC submission (no private relay)
2. 5% default slippage (500 BPS)
3. No price impact rejection threshold

Creates a textbook sandwich attack surface. Every AMM swap (SOL<->CRIME, SOL<->FRAUD) and every multi-hop route through those pools is sandwichable.

For a 100 SOL swap with 5% slippage:
- Attacker front-runs with a buy, pushing price up
- User's swap executes at the inflated price (up to 5% worse)
- Attacker back-runs with a sell, capturing the difference
- User receives at least 95% of expected output (the minimumOutput enforced on-chain)

### OC-129: Hardcoded Slippage Too High

**Status: PRESENT (as default, user-configurable)**

Default: 500 BPS (5%) at `app/providers/SettingsProvider.tsx:170`.

This is user-configurable (the `SlippageConfig` component offers 0.5%, 1%, 2% presets, plus custom input). However:
1. The default is 5%, not one of the presets
2. Most users never change defaults
3. The UI doesn't show a warning about the default being high (only warns above 5%)
4. There's no per-pair dynamic slippage calculation

**Comparison to AIP-053 (AI pitfall)**: This matches the AI-generated pattern of hardcoding a single high slippage value for all pairs. CRIME/SOL and FRAUD/SOL are volatile memecoin pairs, so higher slippage is more justified than for major pairs, but 5% is still at the upper end of reasonable.

### OC-253/OC-258: Bot Sandwichable Transactions

**Status: N/A (no trading bot in off-chain code)**

The crank runner does not execute swap transactions (only epoch transitions, VRF operations, and vault top-ups). The stress-wallet script executes swaps but is a test tool, not production code.

However, the Carnage Fund execution (epoch program's `execute_carnage_atomic`) does perform swaps and is submitted by the crank. The crank uses `provider.sendAndConfirm()` which goes through the standard RPC -- also not MEV-protected. This is an on-chain concern more than off-chain.

### AIP-062: Sending Swap Through Public RPC

**Status: PRESENT**

Matches exactly. All swap transactions are sent via `connection.sendRawTransaction()` through the Helius RPC endpoint. No alternative submission pathway exists.

### Transaction Ordering Analysis

The protocol does not have explicit transaction ordering requirements for user operations. Each swap is independent. However, there are timing-sensitive operations:

1. **Epoch transitions**: The crank calls `trigger_epoch_transition` permissionlessly. If multiple cranks race, the first wins. No off-chain ordering concern.
2. **Carnage execution**: `execute_carnage_atomic` has a 50-slot lock window. First caller wins within the window. MEV bots could front-run the crank's Carnage execution.
3. **VRF consumption**: `consume_randomness` is bundled with the reveal for MEV protection (per IDL comment: "Typically bundled in the same transaction for MEV protection"). This is handled correctly by the crank.

### skipPreflight Analysis

Three distinct patterns:

1. **Multi-hop swaps** (`multi-hop-builder.ts:381`): `skipPreflight: true` with `maxRetries: 3`. Justified by the documented devnet v0 TX simulation bug. On mainnet, this should be reconsidered.

2. **Bonding curve buy/sell** (`BuyForm.tsx:191`, `SellForm.tsx:200`): `skipPreflight: true` with no documented justification. Previous audit H039 flagged this as NOT_FIXED.

3. **Direct AMM swaps** (`useSwap.ts:764`): `skipPreflight: false` with `maxRetries: 2`. This is the correct pattern.

4. **Staking operations** (`useStaking.ts:581`): `skipPreflight: false` with `maxRetries: 2`. Correct.

The inconsistency between patterns 2/3 and 1/4 suggests the bonding curve forms were built at a different time or by different code generation sessions, and the preflight flag was never unified.

## Cross-Focus Intersections

### CHAIN-01 (RPC Trust)
- Transaction submission goes through a single RPC endpoint (Helius). No fallover for `sendRawTransaction`. If Helius is down, all swaps fail.
- The `/api/rpc` proxy adds latency between quote and execution.

### CHAIN-02 (State Sync)
- Pool reserves used for quoting come from SSE/webhook pipeline. If stale, quotes are inaccurate but on-chain `minimumOutput` still protects.
- `useSwap.ts:658` re-quotes on pool/epoch state changes, but there's no freshness check on the data.

### CHAIN-04 (Instruction Building)
- `swap-builders.ts` constructs instructions with amounts from client-side state. These amounts flow directly to on-chain parameters.
- `multi-hop-builder.ts:processInstructionsForAtomic()` strips ComputeBudget from individual steps and replaces with combined budget. This is correct.

### LOGIC-01 (Business Logic)
- The route engine (`route-engine.ts`) correctly chains BigInt outputs as inputs for multi-hop. No precision loss in the critical path.
- Split route optimization (`useRoutes.ts:133-193`) applies slippage to the combined output, not per-leg. This is correct for atomic execution.

### ERR-02 (Error Handling)
- `pollTransactionConfirmation` correctly checks `confirmation.err` for skipPreflight TXs.
- Multi-hop builder checks `confirmation.err` and returns "failed" status.
- Error messages are parsed through `parseSwapError()` for user display.

## Cross-Reference Handoffs

1. **-> SEC-01**: Investigate whether the sign-then-send bypass of wallet-native TX submission creates additional attack surface for malicious wallet extensions.
2. **-> CHAIN-01**: Evaluate whether the single Helius RPC endpoint creates a single point of failure for all value-carrying operations.
3. **-> LOGIC-01**: Verify the 50% on-chain sell output floor logic matches the off-chain assumption that it provides adequate sandwich protection.
4. **-> BOT-01**: Verify crank submission of Carnage execution uses adequate priority fees and doesn't leak MEV-relevant information.
5. **-> INFRA-03**: Evaluate Railway logging configuration -- do server logs capture RPC request bodies (which would include swap transaction data)?

## Risk Observations

### 1. [HIGH] H015 Recheck: Default 500 BPS Slippage Still Not Fixed

**File**: `app/providers/SettingsProvider.tsx:170`
**Previous Finding**: H015 (HIGH, NOT_FIXED)
**Current Status**: Still 500 BPS. No change in this delta.

The fix is a one-line change:
```typescript
slippageBps: 100, // 1% -- reasonable default for memecoin pairs
```

The architecture's 50% on-chain floor means the protocol is safe from catastrophic loss, but 5% default slippage systematically costs users on every swap.

### 2. [HIGH] No MEV-Protected Transaction Submission

**File**: `app/hooks/useProtocolWallet.ts:111`
**Previous Finding**: H015 noted "no MEV protection" but focused on slippage.

For mainnet deployment, the protocol should consider:
1. Jito bundle submission for swap transactions
2. An MEV-protected RPC endpoint (Helius offers this)
3. At minimum, letting wallets use their own `signAndSendTransaction` which may include MEV protection

### 3. [MEDIUM] skipPreflight on Bonding Curve TXs

**Files**: `app/components/launch/BuyForm.tsx:191`, `app/components/launch/SellForm.tsx:200`
**Previous Finding**: H039 (LOW, NOT_FIXED)

These should be changed to `skipPreflight: false` for consistency with AMM swap and staking operations.

### 4. [MEDIUM] No Price Impact Guard

**Files**: `app/lib/swap/route-engine.ts:351-354`, `app/hooks/useSwap.ts`

Price impact is computed and displayed but never blocks execution. A guard like:
```typescript
if (priceImpactBps > 1000) throw new Error("Price impact exceeds 10%");
```
would prevent extreme-impact swaps from being submitted.

### 5. [MEDIUM] Slippage Default vs UI Preset Mismatch

**Files**: `app/providers/SettingsProvider.tsx:170`, `app/components/swap/SlippageConfig.tsx:43-47`

The default is 5% but the highest preset is 2%. This means:
- A user who opens settings and selects any preset is actually improving their slippage
- A user who never opens settings stays at the dangerous 5% default
- The UI communicates "2% is the highest reasonable value" while defaulting to 5%

### 6. [MEDIUM] Quote-to-Execution Window

**File**: `app/hooks/useSwap.ts:563-566` through `:757-766`

The 300ms debounce, wallet signing, and RPC round-trip create a 5-15 second window where pool state can shift. Combined with 5% slippage, this is exploitable. The on-chain check protects against losses exceeding 5%, but does not prevent losses within the tolerance.

### 7. [LOW] Bonding Curve TXs Lack ComputeBudget

**Files**: `app/components/launch/BuyForm.tsx:183-186`, `app/components/launch/SellForm.tsx:192-196`

Neither BuyForm nor SellForm adds ComputeBudgetProgram instructions. They rely on the Solana runtime default (200K CU). If the bonding curve program requires more, TXs fail silently.

### 8. [LOW] Zero Priority Fee Option

**File**: `app/hooks/useSwap.ts:102`

The "none" preset (0 microLamports) creates lowest-priority TXs that may sit in the validator's queue longer, increasing sandwich window.

## Novel Attack Surface Observations

### 1. Split Route Double-Sandwich

When a user swaps SOL -> PROFIT via a split route (e.g., 60% via CRIME, 40% via FRAUD), the atomic TX contains two AMM swap instructions. An MEV bot with Jito access could:
1. Front-run with buys in BOTH CRIME/SOL and FRAUD/SOL pools
2. Let the user's split TX execute (both legs at inflated prices)
3. Back-run with sells in both pools

The 5% slippage applies to the COMBINED output, so each individual leg could be manipulated by more than 5% as long as the total stays within bounds. The on-chain programs enforce per-swap minimums independently, but the multi-hop builder only sets per-step minimumOutput from the route's overall slippage:
```typescript
// multi-hop-builder.ts:315-317
const minimumOutput = Math.floor(
  step.outputAmount * (10_000 - slippageBps) / 10_000,
);
```
This applies the same slippage BPS to each step individually, which is correct. But the attacker can exploit the fact that both pools are manipulated simultaneously in a single atomic MEV bundle.

### 2. RPC Proxy Intelligence Leak

The `/api/rpc` proxy at `app/app/api/rpc/route.ts` forwards `sendTransaction` calls. The Next.js server processes the full transaction payload. If server-side logging, monitoring (Sentry), or the Railway platform captures request bodies, swap transaction data (amounts, pools, accounts) is stored in server logs. This creates an operational MEV intelligence source.

### 3. Sign-Then-Send as Anti-Pattern on Mainnet

The `useProtocolWallet.ts` sign-then-send pattern was designed for devnet reliability. On mainnet, major wallets (Phantom, Solflare) are increasingly offering MEV protection through their `signAndSendTransaction` endpoints. By bypassing this with `signTransaction` + `sendRawTransaction`, the protocol opts out of wallet-level MEV protection for all users. This should be re-evaluated for mainnet -- the MEMORY.md notes "Revisit for mainnet" regarding this pattern.

## Questions for Other Focus Areas

1. **CHAIN-01**: Is Helius's RPC endpoint shared with MEV searchers? Does Helius offer a separate MEV-protected endpoint?
2. **LOGIC-01**: What is the exact on-chain 50% output floor mechanism? Does it apply to buy path as well as sell?
3. **BOT-01**: Does the crank runner for Carnage execution use any priority fee? Could MEV bots front-run Carnage buyback-and-burn?
4. **INFRA-03**: What does Railway log from request bodies? Could `/api/rpc` request payloads containing swap transactions be persisted in logs?
5. **SEC-02**: Is the Helius API key rotatable? If the RPC endpoint is compromised, what is the blast radius?

## Raw Notes

- `useSwap.ts` line 764: skipPreflight:false -- good
- `useStaking.ts` line 581: skipPreflight:false -- good
- `multi-hop-builder.ts` line 381: skipPreflight:true -- devnet workaround, needs mainnet review
- `BuyForm.tsx` line 191: skipPreflight:true -- unexplained, previous audit flagged
- `SellForm.tsx` line 200: skipPreflight:true -- same as BuyForm
- `SettingsProvider.tsx` line 170: slippageBps:500 -- the core MEV issue
- `SlippageConfig.tsx` lines 43-47: presets are 50/100/200 BPS -- mismatch with 500 default
- `useProtocolWallet.ts` lines 76-118: sign-then-send pattern documented as intentional
- `connection.ts` line 70: Connection commitment "confirmed" -- appropriate
- `confirm-transaction.ts` line 44: Waits for "confirmed" or "finalized" -- appropriate
- No `jito`, `nozomi`, `mev`, `private.*mempool`, `bundle` patterns found in app/ directory
- `route-engine.ts` line 369: minimumOutput uses BigInt -- no precision loss
- `multi-hop-builder.ts` line 306-309: slippageBps derived from route -- correct
- PRIORITY_FEE_MAP consistent between useSwap.ts:101 and useStaking.ts:88
- crank-runner.ts:444 uses `provider.sendAndConfirm()` -- standard, no MEV protection
- VRF flow uses skipPreflight:true for Switchboard SDK compatibility -- justified
