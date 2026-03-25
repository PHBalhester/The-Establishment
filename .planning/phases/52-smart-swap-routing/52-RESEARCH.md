# Phase 52: Smart Swap Routing - Research

**Researched:** 2026-02-20
**Domain:** Client-side routing engine, multi-hop swap execution, split routing optimization
**Confidence:** HIGH (all components already exist in-house; this phase is wiring + math, no new dependencies)

## Summary

Phase 52 adds a routing engine on top of the existing swap infrastructure. The protocol has exactly 4 pools (CRIME/SOL, FRAUD/SOL, CRIME/PROFIT, FRAUD/PROFIT) and 4 tokens (SOL, CRIME, FRAUD, PROFIT). The current swap UI (`useSwap` hook + `SwapForm` component) only supports direct single-hop swaps between tokens that share a pool.

The routing engine will evaluate multi-hop paths (e.g., SOL -> CRIME -> PROFIT) and split routing (e.g., splitting SOL -> PROFIT across both the CRIME and FRAUD intermediary paths) to find the best execution for all token pairs. Because this is a closed 4-pool ecosystem with deterministic constant-product math, the routing engine is entirely client-side with NO new on-chain code. It reuses the existing quote-engine.ts primitives and swap-builders.ts transaction constructors.

Multi-hop execution requires two sequential swap transactions (not a single atomic transaction) because each swap goes through the Tax -> AMM -> Token-2022 -> Transfer Hook CPI chain at depth 3-4, and fitting two full swap instructions with 20+ accounts each in a single transaction exceeds Solana's 1232-byte limit even with ALT. The CONTEXT.md decision of "single wallet approval" maps to sign-all-then-send-sequentially, not Jito bundles (those require validator infrastructure).

**Primary recommendation:** Build the routing engine as a pure-function module (`route-engine.ts`) that takes pool reserves + epoch state as input and returns ranked routes. Multi-hop execution uses the existing swap-builders to create two transactions, signs both with a single wallet prompt via `signAllTransactions`, and sends them sequentially. Split routing uses the equal-marginal-price optimization between the two intermediary paths. No new npm packages are needed.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react | 19.2.3 | UI framework | Already installed, used by all components |
| @solana/web3.js | 1.98.4 | Transaction construction, RPC | Already installed, used by swap-builders |
| @coral-xyz/anchor | 0.32.1 | Program interaction, account encoding | Already installed, used by swap-builders |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @solana/spl-token | 0.4.14 | Token operations, WSOL wrap/unwrap | Already installed, used by swap-builders |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom routing engine | Jupiter API | Jupiter doesn't know about our custom AMM + Tax Program CPI chain; our pools are protocol-only liquidity, not indexed by Jupiter |
| Two separate TXs for multi-hop | Jito bundles | Jito bundles need validator cooperation and add complexity; two TXs with `signAllTransactions` is simpler and sufficient since partial failure is handled by the UI |
| Custom split optimization | General convex solver | Overkill for 2 pools; closed-form solution exists for equal-marginal-price across 2 constant-product pools |

**Installation:**
```bash
# No new packages needed -- everything is already installed
```

## Architecture Patterns

### Recommended Project Structure
```
app/
  lib/
    swap/
      route-engine.ts        # NEW: Pure routing logic (no React, no RPC)
      route-types.ts          # NEW: Route/path type definitions
      multi-hop-builder.ts    # NEW: Builds + executes multi-hop TX sequences
      split-router.ts         # NEW: Optimal split calculation
      quote-engine.ts         # EXISTING: Single-hop quote primitives (reused)
      swap-builders.ts        # EXISTING: Transaction builders (reused)
      hook-resolver.ts        # EXISTING: Transfer Hook accounts (reused)
      wsol.ts                 # EXISTING: WSOL wrap/unwrap (reused)
      error-map.ts            # EXISTING: Error parsing (reused)
  hooks/
    useSwap.ts                # MODIFIED: Add routing mode toggle, route selection
    useRoutes.ts              # NEW: Route computation hook (wraps route-engine)
  components/
    swap/
      SwapForm.tsx            # MODIFIED: Add Smart Routing toggle + route display
      RouteSelector.tsx       # NEW: Route comparison display
      RouteCard.tsx           # NEW: Individual route card (fees, hops, output)
      RouteBadge.tsx          # NEW: "Best" badge component
      MultiHopStatus.tsx      # NEW: Multi-hop execution progress/failure UI
      FeeBreakdown.tsx        # EXISTING: Modified to handle multi-hop fee aggregation
      TokenSelector.tsx       # EXISTING: Unchanged
      SlippageConfig.tsx      # EXISTING: Unchanged
      SwapStatus.tsx          # EXISTING: Modified for multi-hop status display
shared/
  constants.ts                # MODIFIED: Expand VALID_PAIRS with multi-hop pairs
```

### Pattern 1: Route Engine as Pure Functions (No Side Effects)
**What:** The routing engine is a stateless module that takes pool reserves, epoch state, and input params, and returns ranked routes. No RPC calls, no React hooks, no side effects.
**When to use:** Always -- this separation enables testing, reuse in scripts, and avoids unnecessary re-renders.
**Example:**
```typescript
// route-engine.ts
export interface RouteStep {
  pool: PoolConfig;
  inputToken: TokenSymbol;
  outputToken: TokenSymbol;
  inputAmount: number;   // base units
  outputAmount: number;  // base units
  lpFeeBps: number;
  taxBps: number;
  priceImpactBps: number;
}

export interface Route {
  steps: RouteStep[];
  inputToken: TokenSymbol;
  outputToken: TokenSymbol;
  inputAmount: number;
  outputAmount: number;
  totalLpFee: number;
  totalTax: number;
  totalPriceImpactBps: number;
  totalFeePct: string;
  hops: number;
  isSplit: boolean;
  splitRatio?: [number, number]; // e.g., [60, 40] for 60%/40% split
  label: string; // e.g., "SOL -> CRIME -> PROFIT"
}

export function computeRoutes(
  inputToken: TokenSymbol,
  outputToken: TokenSymbol,
  inputAmount: number,
  poolReserves: Record<string, { reserveA: number; reserveB: number }>,
  epochState: { crimeBuyTaxBps: number; crimeSellTaxBps: number; fraudBuyTaxBps: number; fraudSellTaxBps: number },
  slippageBps: number,
): Route[] {
  // 1. Enumerate all viable paths
  // 2. Quote each path using existing quote primitives
  // 3. For split-eligible pairs, compute optimal split
  // 4. Rank by outputAmount (descending)
  // 5. Return array with "best" first
}
```

### Pattern 2: Multi-Hop Execution via signAllTransactions
**What:** For multi-hop routes (e.g., SOL -> CRIME -> PROFIT), build two separate Transaction objects using existing swap-builders, then sign both with a single `signAllTransactions` call, then send them sequentially.
**When to use:** Any route with `hops > 1`.
**Example:**
```typescript
// multi-hop-builder.ts
export async function executeMultiHopRoute(
  route: Route,
  wallet: ProtocolWallet,
  connection: Connection,
): Promise<MultiHopResult> {
  // 1. Build TX for each step using existing swap-builders
  const txs: Transaction[] = [];
  for (const step of route.steps) {
    const tx = await buildSwapTransaction(step, connection, wallet.publicKey);
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.feePayer = wallet.publicKey;
    txs.push(tx);
  }

  // 2. Sign ALL transactions with one wallet approval
  const signedTxs = await wallet.signAllTransactions(txs);

  // 3. Send sequentially (hop 1 must confirm before sending hop 2)
  const result: MultiHopResult = { signatures: [], status: "pending" };

  for (let i = 0; i < signedTxs.length; i++) {
    try {
      const sig = await connection.sendRawTransaction(signedTxs[i].serialize());
      await connection.confirmTransaction(sig, "confirmed");
      result.signatures.push(sig);
    } catch (error) {
      result.status = "partial";
      result.failedAt = i;
      result.error = parseSwapError(error);
      break;
    }
  }

  if (result.signatures.length === signedTxs.length) {
    result.status = "confirmed";
  }
  return result;
}
```

### Pattern 3: Equal Marginal Price Split Optimization
**What:** For SOL -> PROFIT (the primary split-eligible pair), split the input across two parallel paths: SOL -> CRIME -> PROFIT and SOL -> FRAUD -> PROFIT. The optimal split equalizes the marginal execution price across both paths.
**When to use:** When price impact on a single path exceeds a threshold (Claude's discretion item).
**Example:**
```typescript
// split-router.ts

/**
 * For two constant-product pools with the same output token (PROFIT),
 * the optimal split minimizes total price impact by equalizing marginal
 * execution rates across both paths.
 *
 * Practical approach: binary search over split ratios [0%, 100%] in 1%
 * increments, compute aggregate output for each, pick the maximum.
 * With only 100 iterations and pure math, this runs in <1ms.
 *
 * This is equivalent to the convex optimization approach from
 * "Optimal Routing for Constant Function Market Makers" (Angeris et al.)
 * but simplified for our 2-path topology.
 */
export function computeOptimalSplit(
  totalInput: number,
  pathA: { reserveIn: number; reserveOut: number; feeBps: number; taxBps: number },
  pathB: { reserveIn: number; reserveOut: number; feeBps: number; taxBps: number },
): { splitRatioA: number; totalOutput: number } {
  let bestOutput = 0;
  let bestRatio = 100; // default: all through path A

  // Binary search in 1% increments
  for (let ratioA = 0; ratioA <= 100; ratioA++) {
    const inputA = Math.floor(totalInput * ratioA / 100);
    const inputB = totalInput - inputA;

    const outputA = quoteMultiHopPath(inputA, pathA);
    const outputB = quoteMultiHopPath(inputB, pathB);
    const total = outputA + outputB;

    if (total > bestOutput) {
      bestOutput = total;
      bestRatio = ratioA;
    }
  }

  return { splitRatioA: bestRatio, totalOutput: bestOutput };
}
```

### Pattern 4: 30-Second Auto-Refresh with Timer Reset
**What:** Quotes auto-refresh every 30 seconds. Timer resets on user input changes. A visible countdown or hidden refresh indicator (Claude's discretion).
**When to use:** Whenever routes are displayed.
**Example:**
```typescript
// In useRoutes.ts
useEffect(() => {
  if (!inputAmount || !inputToken || !outputToken) return;

  const refreshRoutes = () => computeAndSetRoutes();
  refreshRoutes(); // initial computation

  const timer = setInterval(refreshRoutes, 30_000);
  return () => clearInterval(timer);
}, [inputAmount, inputToken, outputToken, pools, epochState]);
```

### Anti-Patterns to Avoid
- **DO NOT make RPC calls in the routing engine:** The route-engine.ts must be pure functions accepting reserves/state as params. RPC calls happen in the hooks layer (`useRoutes`), not in the math layer.
- **DO NOT attempt to fit two swap instructions in one transaction:** A single swap needs ~20 accounts + 4-8 hook remaining_accounts. Two swaps would need ~40-50 accounts. Even with ALT, this exceeds Solana's 1232-byte TX size limit because instruction data (discriminators, BN amounts, booleans) is not compressible by ALT.
- **DO NOT use Jito bundles for multi-hop:** The context decision specifies "single wallet approval," and Jito adds complexity (validator cooperation, tip payment, bundle RPC endpoint). Two sequential TXs with `signAllTransactions` achieves the same user experience.
- **DO NOT recompute routes on every render:** Debounce (300ms, matching existing `useSwap` pattern) and use the 30-second refresh interval.
- **DO NOT hard-code route paths:** Build the route graph from the pool topology. When pools change (e.g., mainnet has different addresses), routes should automatically adapt.

## Complete Route Topology

The protocol has exactly 4 tokens and 4 pools, creating a fixed graph:

```
      SOL
     /   \
   CRIME  FRAUD
     \   /
     PROFIT
```

### Currently Supported (Direct Single-Hop)
| Input | Output | Pool | Instruction |
|-------|--------|------|-------------|
| SOL | CRIME | CRIME/SOL | swapSolBuy |
| SOL | FRAUD | FRAUD/SOL | swapSolBuy |
| CRIME | SOL | CRIME/SOL | swapSolSell |
| FRAUD | SOL | FRAUD/SOL | swapSolSell |
| CRIME | PROFIT | CRIME/PROFIT | swapProfitBuy |
| FRAUD | PROFIT | FRAUD/PROFIT | swapProfitBuy |
| PROFIT | CRIME | CRIME/PROFIT | swapProfitSell |
| PROFIT | FRAUD | FRAUD/PROFIT | swapProfitSell |

### New Multi-Hop Routes (Phase 52)
| Input | Output | Path | Hops | Pools Used |
|-------|--------|------|------|------------|
| SOL | PROFIT | SOL -> CRIME -> PROFIT | 2 | CRIME/SOL + CRIME/PROFIT |
| SOL | PROFIT | SOL -> FRAUD -> PROFIT | 2 | FRAUD/SOL + FRAUD/PROFIT |
| PROFIT | SOL | PROFIT -> CRIME -> SOL | 2 | CRIME/PROFIT + CRIME/SOL |
| PROFIT | SOL | PROFIT -> FRAUD -> SOL | 2 | FRAUD/PROFIT + FRAUD/SOL |
| CRIME | FRAUD | CRIME -> PROFIT -> FRAUD | 2 | CRIME/PROFIT + FRAUD/PROFIT |
| FRAUD | CRIME | FRAUD -> PROFIT -> CRIME | 2 | FRAUD/PROFIT + CRIME/PROFIT |
| CRIME | FRAUD | CRIME -> SOL -> FRAUD | 2 | CRIME/SOL + FRAUD/SOL |
| FRAUD | CRIME | FRAUD -> SOL -> CRIME | 2 | FRAUD/SOL + CRIME/SOL |

### Split-Eligible Routes
| Input | Output | Split Across | When Split Wins |
|-------|--------|-------------|-----------------|
| SOL | PROFIT | Path A: SOL->CRIME->PROFIT, Path B: SOL->FRAUD->PROFIT | Large orders where price impact on one path is significant |
| PROFIT | SOL | Path A: PROFIT->CRIME->SOL, Path B: PROFIT->FRAUD->SOL | Large orders where price impact on one path is significant |

### Updated VALID_PAIRS
```typescript
export const VALID_PAIRS: Record<TokenSymbol, TokenSymbol[]> = {
  SOL: ["CRIME", "FRAUD", "PROFIT"],     // +PROFIT (multi-hop)
  CRIME: ["SOL", "PROFIT", "FRAUD"],     // +FRAUD (multi-hop)
  FRAUD: ["SOL", "PROFIT", "CRIME"],     // +CRIME (multi-hop)
  PROFIT: ["CRIME", "FRAUD", "SOL"],     // +SOL (multi-hop)
};
```

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Single-hop quoting | New AMM math | Existing `quote-engine.ts` functions | Already mirrors on-chain math exactly, tested |
| Transaction construction | New TX builders | Existing `swap-builders.ts` | Accounts struct, hook resolution, WSOL wrap all handled |
| Hook account resolution | New resolver | Existing `hook-resolver.ts` | Deterministic PDA derivation, browser-compatible |
| WSOL wrapping | New WSOL helpers | Existing `wsol.ts` | Create/sync/close pattern already correct |
| Pool state reading | New RPC logic | Existing `usePoolPrices` hook | WebSocket subscriptions, real-time reserve updates |
| Epoch state reading | New RPC logic | Existing `useEpochState` hook | Tax rates already available |
| Convex optimization solver | General-purpose solver | 1% granularity grid search | Only 2 paths to split across; 100 iterations in <1ms |

**Key insight:** The entire routing engine is just a composition layer on top of existing primitives. The hard work (on-chain math mirroring, transaction construction, hook resolution, pool state subscriptions) is already done in Phase 42 (swap interface). Phase 52 adds the graph traversal and comparison logic on top.

## Common Pitfalls

### Pitfall 1: Multi-Hop Stale Reserves Between Hops
**What goes wrong:** Hop 1 changes pool reserves. Hop 2 was quoted against pre-hop-1 reserves. If reserves shifted significantly, hop 2 may fail with SlippageExceeded.
**Why it happens:** Routes are quoted with a snapshot of reserves at quote time. By the time hop 2 executes (seconds later), hop 1 has changed the intermediate pool's reserves.
**How to avoid:** Quote hop 2 with a wider slippage tolerance than single-hop swaps. The multi-hop builder should use the output of hop 1 as the input for hop 2 at execution time (not the pre-quoted amount), but since we pre-sign transactions, we must accept the quoted amounts. Use 2x the normal slippage for multi-hop hops. Alternatively, for the "Retry swap" partial-failure flow, re-quote hop 2 with fresh prices.
**Warning signs:** Frequent hop-2 failures on high-volume pairs.

### Pitfall 2: WSOL Intermediary Token Account in Multi-Hop
**What goes wrong:** Multi-hop route SOL -> CRIME -> PROFIT: hop 1 (SOL buy) creates and wraps WSOL, receives CRIME output. Hop 2 (PROFIT buy) sends CRIME, receives PROFIT. The WSOL ATA from hop 1 may still have wrapped SOL (the unwrap instruction is only added for SOL sell paths). For SOL -> CRIME, the output is CRIME tokens (not WSOL), so this is fine. But for PROFIT -> CRIME -> SOL, hop 2 is a SOL sell which outputs WSOL that must be unwrapped. The unwrap instruction is already included in `buildSolSellTransaction`. Just ensure hop 2's unwrap runs in hop 2's TX, not as a separate operation.
**How to avoid:** Multi-hop builder must use the correct swap-builder for each hop. The existing builders already handle WSOL wrap/unwrap correctly.
**Warning signs:** User has WSOL tokens stuck in their ATA after multi-hop.

### Pitfall 3: Transaction Size Exceeding 1232 Bytes
**What goes wrong:** Trying to pack two swap instructions (each with 20+ named accounts + 4-8 remaining_accounts) into one transaction.
**Why it happens:** Intuition says "atomic is better" but Solana's 1232-byte TX limit (even with v0 + ALT) makes this impossible for two full swap instructions.
**How to avoid:** Always use separate transactions for each hop. Accept non-atomicity and handle partial failure in the UI.
**Warning signs:** "Transaction too large" errors at TX construction time.

### Pitfall 4: Split Routes with Tax Asymmetry
**What goes wrong:** SOL -> PROFIT split across CRIME and FRAUD paths. Each path's SOL -> IP hop has DIFFERENT tax rates (due to the tax regime). A naive 50/50 split ignores the tax asymmetry. The "cheap side" has low buy tax, so more SOL should route through it.
**Why it happens:** Split routing that only considers LP fees and reserves but ignores per-path tax rates.
**How to avoid:** The split optimizer MUST include tax in its per-hop quoting. The existing `quoteSolBuy` already accounts for tax. Use it directly in the split computation, not a simplified version that ignores tax.
**Warning signs:** Split route produces worse output than the single best-path route.

### Pitfall 5: Route Refresh Causing UI Flicker
**What goes wrong:** Every 30 seconds, routes recompute. If the "best" route changes, the UI swaps the displayed routes, causing a jarring flicker.
**Why it happens:** Route ranking changes when reserves/tax change.
**How to avoid:** If the current best route is still within 0.1% of the new best route's output, keep the current selection stable. Only switch displayed best route when the delta exceeds a threshold.
**Warning signs:** Route display visually "jumping" between refreshes.

### Pitfall 6: signAllTransactions Not Supported by All Wallets
**What goes wrong:** Some wallet adapters do not implement `signAllTransactions`. Calling it throws.
**Why it happens:** Not all Solana wallets support batch signing.
**How to avoid:** Check for `wallet.signAllTransactions` existence. If not available, fall back to sequential `signTransaction` calls (user signs twice). This is a degraded but functional UX.
**Warning signs:** "signAllTransactions is not a function" errors on certain wallets.

## Code Examples

### Multi-Hop Quote Composition (using existing quote-engine.ts)
```typescript
// Source: existing app/lib/swap/quote-engine.ts primitives
import { quoteSolBuy, quoteProfitBuy } from "./quote-engine";

function quoteMultiHopSolToProfit(
  solAmountLamports: number,
  crimeReserveWsol: number,
  crimeReserveToken: number,
  crimeReserveInProfitPool: number,
  profitReserve: number,
  buyTaxBps: number,
): { outputProfit: number; totalFees: number } {
  // Hop 1: SOL -> CRIME
  const hop1 = quoteSolBuy(
    solAmountLamports,
    crimeReserveWsol,
    crimeReserveToken,
    buyTaxBps,
    100, // SOL pool LP fee = 1%
  );

  // Hop 2: CRIME -> PROFIT (untaxed)
  const hop2 = quoteProfitBuy(
    hop1.outputTokens,
    crimeReserveInProfitPool,
    profitReserve,
    50, // PROFIT pool LP fee = 0.5%
  );

  return {
    outputProfit: hop2.outputProfit,
    totalFees: hop1.lpFee + hop1.taxAmount + hop2.lpFee,
  };
}
```

### Optimal Split Between Two Multi-Hop Paths
```typescript
// Source: derived from equal-marginal-price optimization principle
// (Angeris et al., "Optimal Routing for Constant Function Market Makers")
function computeOptimalSplitSolToProfit(
  totalSolLamports: number,
  crimePath: { solReserve: number; crimeReserve: number; crimeProfitReserve: number; profitReserve: number; buyTaxBps: number },
  fraudPath: { solReserve: number; fraudReserve: number; fraudProfitReserve: number; profitReserve: number; buyTaxBps: number },
): { crimeRatio: number; totalOutput: number; splitOutput: number; bestSingleOutput: number } {
  // Grid search over 1% increments (100 iterations, <1ms)
  let bestOutput = 0;
  let bestRatio = 100;

  for (let crimePercent = 0; crimePercent <= 100; crimePercent++) {
    const solToCrime = Math.floor(totalSolLamports * crimePercent / 100);
    const solToFraud = totalSolLamports - solToCrime;

    let totalProfit = 0;

    if (solToCrime > 0) {
      const hop1 = quoteSolBuy(solToCrime, crimePath.solReserve, crimePath.crimeReserve, crimePath.buyTaxBps, 100);
      const hop2 = quoteProfitBuy(hop1.outputTokens, crimePath.crimeProfitReserve, crimePath.profitReserve, 50);
      totalProfit += hop2.outputProfit;
    }

    if (solToFraud > 0) {
      const hop1 = quoteSolBuy(solToFraud, fraudPath.solReserve, fraudPath.fraudReserve, fraudPath.buyTaxBps, 100);
      const hop2 = quoteProfitBuy(hop1.outputTokens, fraudPath.fraudProfitReserve, fraudPath.profitReserve, 50);
      totalProfit += hop2.outputProfit;
    }

    if (totalProfit > bestOutput) {
      bestOutput = totalProfit;
      bestRatio = crimePercent;
    }
  }

  // Also compute best single-path output for comparison
  const crimeOnly = quoteMultiHopSolToProfit(totalSolLamports, crimePath, 100);
  const fraudOnly = quoteMultiHopSolToProfit(totalSolLamports, fraudPath, 100);
  const bestSingleOutput = Math.max(crimeOnly, fraudOnly);

  return {
    crimeRatio: bestRatio,
    totalOutput: bestOutput,
    splitOutput: bestOutput,
    bestSingleOutput,
  };
}
```

### Route Display Component Pattern
```typescript
// Source: follows existing SwapForm component architecture
interface RouteCardProps {
  route: Route;
  isBest: boolean;
  isSelected: boolean;
  onSelect: () => void;
}

function RouteCard({ route, isBest, isSelected, onSelect }: RouteCardProps) {
  return (
    <button onClick={onSelect} className={isSelected ? "border-blue-500" : "border-gray-700"}>
      {isBest && <span className="text-xs bg-blue-600 px-2 py-0.5 rounded">Best</span>}
      <div>{route.label}</div>
      <div>Output: {formatAmount(route.outputAmount, route.outputToken)}</div>
      <div>LP Fee: {route.totalFeePct}</div>
      {route.totalTax > 0 && <div>Tax: {formatAmount(route.totalTax, "SOL")} SOL</div>}
      <div>Price Impact: {(route.totalPriceImpactBps / 100).toFixed(2)}%</div>
      <div>{route.hops} hop{route.hops > 1 ? "s" : ""}</div>
    </button>
  );
}
```

## Compute Budget Analysis for Multi-Hop

Each hop is a separate transaction. CU costs per swap instruction (from Compute_Budget_Profile.md):

| Instruction | Measured CU | With 20% Padding |
|------------|------------|------------------|
| swap_sol_buy (CRIME) | 97,901 | 120,000 |
| swap_sol_buy (FRAUD) | 121,910 | 150,000 |
| swap_sol_sell (CRIME) | 98,585 | 120,000 |
| swap_sol_sell (FRAUD) | 122,586 | 150,000 |
| swap_profit_buy | 93,769 | 115,000 |
| swap_profit_sell | 93,760 | 115,000 |

Multi-hop SOL -> CRIME -> PROFIT = 120k + 115k = 235k CU total (across 2 TXs, each under 200k default). No elevated compute budget needed for individual hops.

Transaction fee for multi-hop: 2x base fee (5000 lamports each) + priority fee per CU. At medium priority (10,000 microLamports/CU), a 2-hop route costs approximately 0.01 SOL in fees (2 * 5000 base + 2 * ~150k * 10000 / 1e6 priority = ~3.01M lamports = ~0.003 SOL). Negligible.

## Transaction Size Analysis

Single swap TX account counts:
- SOL buy/sell: 20-21 named accounts + 4 hook remaining = 24-25 total
- PROFIT buy/sell: 11 named accounts + 8 hook remaining = 19 total

With v0 + ALT, each unique account address in the ALT costs only 1 byte (lookup index). Named instruction data (discriminator + args) costs ~15-20 bytes per instruction. A single swap instruction fits comfortably in 1232 bytes.

Two swap instructions would need 40-50 unique accounts. Even with ALT, the instruction data (two discriminators + two sets of BN args) plus two instruction metadata structs would push close to or over 1232 bytes. **Verdict: separate transactions for each hop, as designed.**

## Multi-Hop Execution Patterns

### Approach: signAllTransactions + Sequential Send
1. Build TX1 (hop 1) and TX2 (hop 2) using existing swap-builders
2. Set blockhash and fee payer on both
3. Call `wallet.signAllTransactions([tx1, tx2])` -- user sees ONE approval
4. Send TX1, wait for confirmation
5. Send TX2, wait for confirmation
6. If TX2 fails: show partial-failure UI with "Retry swap" (re-quote hop 2) and "Keep [TOKEN]" buttons

**Why not Jito bundles:** Jito bundles guarantee atomicity but add complexity (bundle RPC endpoint, tip payment, validator coverage). The user already trusts the protocol (it is their own swap UI), and partial failure is handled gracefully. Jito is overkill for a 2-hop swap where the intermediate token has real value.

**Fallback for wallets without signAllTransactions:** Call `signTransaction` twice. User signs each hop individually. Degraded UX but functional.

## Split Routing Trigger Threshold (Claude's Discretion)

**Recommendation: Suggest split when it produces >= 0.5% more output than the best single path.**

Rationale:
- Below 0.5%, the split benefit is eaten by the extra transaction fee (multi-hop split = 4 TXs instead of 2)
- Above 0.5%, the benefit is material and visible to the user
- The threshold is dynamically evaluated -- it scales with trade size (larger trades have more price impact, making splits more valuable)

For split route display: show as a single card with "Split route: 60% via CRIME, 40% via FRAUD" annotation. The two legs share the same output token (PROFIT or SOL), so it reads as one operation, not two separate swaps.

## Route Path Visualization (Claude's Discretion)

**Recommendation: Show path arrows in the route card.**

Example: `SOL -> CRIME -> PROFIT` displayed as a horizontal flow with token icons.

Rationale:
- Helps users understand WHY a multi-hop route might be better (lower tax on the cheap side)
- Minimal implementation cost (horizontal flex of token icons + arrows)
- Jupiter and Raydium both show path visualization; users expect it

## Quote Countdown Timer (Claude's Discretion)

**Recommendation: Visible circular countdown timer (30s).**

Rationale:
- Jupiter shows a visible countdown; users are familiar with it
- Hiding the refresh creates confusion ("why did my quote change?")
- A small circular timer near the output amount is unobtrusive
- Timer resets on user input changes (per CONTEXT.md decision)

## Pre-Execution Price Change Handling (Claude's Discretion)

**Recommendation: Use slippage tolerance (existing mechanism), not a pre-execution price check.**

Rationale:
- The existing swap flow already uses `minimumOutput` (computed from quote + slippage tolerance) to protect against price changes
- Adding a pre-check ("Price changed by X%, continue?") adds friction without adding safety (the on-chain slippage check is the real protection)
- If the user's slippage tolerance is tight, the TX will fail cleanly with SlippageExceeded, and the error-map already has a human-readable message for this

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Jupiter Metis routing | Jupiter Iris routing with Brent's method | 2025 | Better split optimization for large orders |
| DFS-based path finding | Graph-based with convex optimization | 2024-2025 | More routes evaluated, better price execution |
| Atomic multi-hop in one TX | Sequential TXs with signAllTransactions | N/A (Solana constraint) | Non-atomic but practical; industry standard |

**Note:** Jupiter's routing complexity (thousands of pools, 100+ DEXes) is many orders of magnitude more complex than ours (4 pools, 1 DEX). We do NOT need their advanced algorithms. A simple enumeration of all possible paths (there are exactly 16 direct + multi-hop combinations) with grid-search split optimization is optimal for our topology.

## Open Questions

1. **Intermediate ATA Creation for Multi-Hop**
   - What we know: If a user has SOL but no CRIME ATA, and they want SOL -> CRIME -> PROFIT, hop 1 needs to create the CRIME ATA (existing swap-builder handles this). After hop 2, the user holds PROFIT but also has a CRIME ATA with 0 balance.
   - What's unclear: Should we close the intermediate ATA to recover rent (~0.002 SOL)? Jupiter does this for intermediate accounts.
   - Recommendation: Add an optional `closeIntermediateAta` instruction to the hop 2 TX. Low priority -- can be deferred or handled in a follow-up.

2. **Split Route Execution: 2 or 4 Transactions?**
   - What we know: A split SOL -> PROFIT route has 4 hops total (2 hops per leg). Each hop is a separate TX.
   - What's unclear: Can we parallelize the two legs (send both leg-1 TXs simultaneously, then both leg-2 TXs)?
   - Recommendation: Sequential is safer (send leg A hop 1, confirm, send leg A hop 2, confirm, then leg B hop 1 + hop 2). Parallelization is an optimization that adds complexity for marginal benefit. Start sequential, optimize later if needed.

3. **Smart Routing Default for Non-Routable Pairs**
   - What we know: CRIME -> FRAUD via multi-hop (CRIME -> SOL -> FRAUD or CRIME -> PROFIT -> FRAUD) involves tax on both ends of the SOL path, or double LP fees on the PROFIT path. These routes may never be optimal.
   - What's unclear: Should CRIME -> FRAUD even be offered, or will it always produce poor output?
   - Recommendation: Include it in the routing engine. If the output is bad, the route will rank low. The engine should show all viable routes and let the user decide. But set expectations in the UI (e.g., if best route output is < 80% of input value after fees, show a "High cost" warning).

## Sources

### Primary (HIGH confidence)
- Codebase: `app/lib/swap/quote-engine.ts` -- existing AMM math primitives, verified against on-chain math.rs
- Codebase: `app/lib/swap/swap-builders.ts` -- existing transaction builders for all 4 swap types
- Codebase: `app/hooks/useSwap.ts` -- existing swap hook with quoting, debouncing, and execution flow
- Codebase: `shared/constants.ts` -- VALID_PAIRS, pool configs, fee constants
- Codebase: `Docs/AMM_Implementation.md` -- pool architecture, 4 pool types, CPI chain
- Codebase: `Docs/Tax_Pool_Logic_Spec.md` -- tax structure, distribution splits, compute budget
- Codebase: `Docs/Compute_Budget_Profile.md` -- measured CU costs per swap instruction

### Secondary (MEDIUM confidence)
- [Jupiter Routing Engines documentation](https://dev.jup.ag/docs/routing) -- Iris engine, split routing approach, Brent's method for split optimization
- [Optimal Routing for Constant Function Market Makers (Angeris et al., 2022)](https://arxiv.org/abs/2204.05238) -- convex optimization framework for CFMM routing; equal-marginal-price principle
- [Jito Bundles documentation](https://www.quicknode.com/guides/solana-development/transactions/jito-bundles) -- sequential atomic execution pattern (considered but not recommended)
- [Solana Transactions documentation](https://solana.com/docs/core/transactions) -- 1232-byte limit, v0 format, address lookup tables

### Tertiary (LOW confidence)
- [NeptuneX Smart Routing Algorithm explanation](https://medium.com/@NeptuneX_io/explanation-of-the-smart-routing-algorithm-for-optimal-order-flow-af7dde10fd1e) -- general SOR overview, not protocol-specific
- [Balancer SOR (GitHub)](https://github.com/balancer/balancer-sor) -- reference implementation for split routing, but for EVM not Solana

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all existing code reused
- Architecture: HIGH -- clear patterns from existing codebase, constrained topology makes routing deterministic
- Pitfalls: HIGH -- verified against on-chain CU measurements and TX size constraints; multi-hop partial failure pattern is well-understood
- Split routing math: MEDIUM -- equal-marginal-price principle is well-established in literature, but our grid-search implementation is a simplification (confirmed sufficient for 2-path topology)
- Multi-hop execution: MEDIUM -- signAllTransactions is the standard pattern, but wallet compatibility varies

**Research date:** 2026-02-20
**Valid until:** 2026-03-20 (stable -- no fast-moving dependencies)
