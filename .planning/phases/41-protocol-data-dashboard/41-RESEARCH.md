# Phase 41: Protocol Data Dashboard - Research

**Researched:** 2026-02-15
**Domain:** Solana RPC data fetching, real-time WebSocket subscriptions, Anchor account deserialization, dashboard UI
**Confidence:** HIGH

## Summary

This phase builds a read-only protocol data dashboard that displays live on-chain state (epoch info, tax rates, pool prices, Carnage data) without requiring a wallet connection. The existing codebase already provides the Anchor program factory (`app/lib/anchor.ts`) with typed getter functions for all 5 programs, a connection factory (`app/lib/connection.ts`), and all account type definitions via synced IDLs. The primary new work is creating React hooks for real-time data fetching and building the card-grid UI.

The data refresh strategy requires two patterns: **WebSocket `accountSubscribe`** for pool accounts and Carnage vault (real-time on every swap), and **HTTP polling at 10-second intervals** for epoch state and Carnage fund state (changes only at epoch boundaries). The slot-to-time countdown requires `getSlot()` polling plus a known constant (`SLOTS_PER_EPOCH = 750` on devnet). SOL/USD conversion uses the **Jupiter Price API V3**.

**Primary recommendation:** Use `@solana/web3.js` Connection's `onAccountChange()` for WebSocket subscriptions (already a project dependency) and simple `setInterval` + Anchor `program.account.*.fetch()` for polling. No additional data-fetching libraries needed.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@solana/web3.js` | 1.x (existing) | RPC calls, WebSocket subscriptions, account watching | Already in project, provides `Connection.onAccountChange()` and `getSlot()` |
| `@coral-xyz/anchor` | 0.30.x (existing) | Account deserialization with full TypeScript types | Already in project via `app/lib/anchor.ts`, provides typed `.fetch()` on all accounts |
| React `useState`/`useEffect`/`useCallback`/`useRef` | 18+ (existing) | Hook-based state management | Already used in `useTokenBalances.ts`, same patterns apply |
| Jupiter Price API V3 | Current | SOL/USD price conversion | Official Jupiter API, free tier, up to 50 tokens per request |
| Tailwind CSS v4 | CSS-first (existing) | UI styling | Already configured in project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@dr-fraudsworth/shared` | 0.0.1 (existing) | Constants (PROGRAM_IDS, MINTS, SEEDS, DEVNET_RPC_URL) | All PDA derivation and account address lookups |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw WebSocket + setInterval | TanStack Query / SWR | Adds dependency; overkill for ~8 fixed-address accounts. Direct hooks match existing `useTokenBalances` pattern |
| `@solana/web3.js` onAccountChange | `@solana/kit` rpcSubscriptions | Would require migrating to new Solana SDK; project already uses web3.js v1.x throughout |
| Jupiter Price API | Pyth oracle | Jupiter is simpler (single HTTP GET), Pyth requires on-chain account watching; Jupiter is already the project's SOL price source decision |

**Installation:**
No new packages needed. All dependencies are already in `app/package.json`.

## Architecture Patterns

### Recommended Project Structure
```
app/
├── hooks/
│   ├── useEpochState.ts         # Polls EpochState PDA every 10s
│   ├── usePoolPrices.ts         # WebSocket subscriptions to 4 pool accounts
│   ├── useCarnageData.ts        # Polls CarnageFundState + WS for vault balance
│   ├── useSolPrice.ts           # Jupiter Price API polling (30-60s)
│   ├── useCurrentSlot.ts        # Polls getSlot() every 10s for countdown
│   ├── useTokenBalances.ts      # [existing] wallet token balances
│   └── useProtocolWallet.ts     # [existing] wallet connection
├── components/
│   ├── dashboard/
│   │   ├── EpochCard.tsx         # Epoch number, cheap side, countdown, warning banner
│   │   ├── TaxRatesCard.tsx      # 4 tax rates as percentages
│   │   ├── PoolCard.tsx          # Single pool: price, reserves, market cap
│   │   ├── CarnageCard.tsx       # Vault balance, lifetime stats, recent events
│   │   └── DashboardGrid.tsx     # Card grid layout
│   └── wallet/                   # [existing]
├── lib/
│   ├── anchor.ts                 # [existing] program factory
│   ├── connection.ts             # [existing] connection factory
│   └── jupiter.ts               # Jupiter Price API helper
└── app/
    └── page.tsx                  # Dashboard landing page (replaces current scaffold)
```

### Pattern 1: Anchor Account Polling Hook
**What:** Use Anchor's typed `.fetch()` method with `setInterval` for accounts that change at epoch boundaries.
**When to use:** EpochState, CarnageFundState, tax rates -- data that only changes when epochs transition.
**Example:**
```typescript
// Source: Existing pattern from app/hooks/useTokenBalances.ts + Anchor program factory
import { useEffect, useState, useCallback, useRef } from "react";
import { getEpochProgram } from "@/lib/anchor";
import type { EpochState } from "@/idl/types/epoch_program";

const EPOCH_STATE_PDA = "DVV9ebobxXctrsPZpuSDTj4g85Cg2VmroLLq3chLuBDU";
const POLL_INTERVAL_MS = 10_000;

export function useEpochState() {
  const [epochState, setEpochState] = useState<EpochState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEpochState = useCallback(async () => {
    try {
      const program = getEpochProgram();
      const state = await program.account.epochState.fetch(EPOCH_STATE_PDA);
      setEpochState(state);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEpochState();
    const interval = setInterval(fetchEpochState, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchEpochState]);

  return { epochState, loading, error };
}
```

### Pattern 2: WebSocket Account Subscription Hook
**What:** Use `Connection.onAccountChange()` for accounts that change on every swap (pool reserves, vault balances).
**When to use:** PoolState accounts (4 pools), Carnage SOL vault balance.
**Example:**
```typescript
// Source: @solana/web3.js Connection.onAccountChange + Anchor deserialization
import { useEffect, useState, useRef } from "react";
import { PublicKey } from "@solana/web3.js";
import { getConnection } from "@/lib/connection";
import { getAmmProgram } from "@/lib/anchor";

export function usePoolState(poolAddress: string) {
  const [reserveA, setReserveA] = useState<number>(0);
  const [reserveB, setReserveB] = useState<number>(0);
  const subIdRef = useRef<number | null>(null);

  useEffect(() => {
    const connection = getConnection();
    const program = getAmmProgram(connection);
    const pubkey = new PublicKey(poolAddress);

    // Initial fetch
    program.account.poolState.fetch(pubkey).then((state) => {
      setReserveA(state.reserveA.toNumber());
      setReserveB(state.reserveB.toNumber());
    });

    // WebSocket subscription for real-time updates
    subIdRef.current = connection.onAccountChange(
      pubkey,
      (accountInfo) => {
        // Decode using Anchor's coder
        const decoded = program.coder.accounts.decode("poolState", accountInfo.data);
        setReserveA(decoded.reserveA.toNumber());
        setReserveB(decoded.reserveB.toNumber());
      },
      "confirmed"
    );

    return () => {
      if (subIdRef.current !== null) {
        connection.removeAccountChangeListener(subIdRef.current);
      }
    };
  }, [poolAddress]);

  return { reserveA, reserveB };
}
```

### Pattern 3: Slot-Based Countdown Timer
**What:** Poll `getSlot()` every 10s, compute slots remaining until next epoch, convert to approximate time.
**When to use:** Epoch countdown display, warning banner.
**Example:**
```typescript
// Source: On-chain constants + getSlot RPC
// SLOTS_PER_EPOCH = 750 (from programs/epoch-program/src/constants.rs)
// Average slot time on Solana: ~400ms (variable, this is approximate)
const SLOTS_PER_EPOCH = 750;
const MS_PER_SLOT = 400; // approximate average

function computeCountdown(currentSlot: number, epochStartSlot: number) {
  const nextEpochSlot = epochStartSlot + SLOTS_PER_EPOCH;
  const slotsRemaining = Math.max(0, nextEpochSlot - currentSlot);
  const msRemaining = slotsRemaining * MS_PER_SLOT;
  const secondsRemaining = Math.round(msRemaining / 1000);

  // Format as approximate time string
  if (secondsRemaining > 120) {
    return `~${Math.round(secondsRemaining / 60)} minutes remaining`;
  } else if (secondsRemaining > 30) {
    return `~${secondsRemaining} seconds remaining`;
  } else {
    return "Epoch transition imminent";
  }
}
```

### Pattern 4: Jupiter Price API Helper
**What:** Fetch SOL/USD price from Jupiter V3 API.
**When to use:** Converting pool reserves to USD-denominated market cap.
**Example:**
```typescript
// Source: Jupiter Price API V3 documentation (https://dev.jup.ag/docs/price/v3)
const SOL_MINT = "So11111111111111111111111111111111111111112";
const JUPITER_PRICE_URL = "https://api.jup.ag/price/v3";

export async function fetchSolPrice(): Promise<number | null> {
  try {
    const response = await fetch(`${JUPITER_PRICE_URL}?ids=${SOL_MINT}`);
    const data = await response.json();
    return data[SOL_MINT]?.usdPrice ?? null;
  } catch {
    return null;
  }
}
```

### Pattern 5: Market Cap Computation
**What:** Convert pool reserves to USD market cap.
**When to use:** Default price display on pool cards.
**Example:**
```typescript
// For a SOL pool: mint_a = WSOL, mint_b = CRIME/FRAUD
// Market cap = total token supply implied by pool * token price
// Token price = (reserveA_SOL / reserveB_tokens) * SOL/USD
// Pool TVL = reserveA_SOL * SOL/USD * 2 (both sides equal in constant-product AMM)

function computePoolPrice(
  reserveA: number, // SOL side (in lamports)
  reserveB: number, // Token side (in base units)
  solPriceUsd: number,
  tokenDecimals: number,
) {
  const solAmount = reserveA / 1e9; // lamports -> SOL
  const tokenAmount = reserveB / Math.pow(10, tokenDecimals);
  const pricePerToken = (solAmount / tokenAmount) * solPriceUsd;
  const marketCapUsd = solAmount * solPriceUsd * 2; // TVL = both sides
  return { pricePerToken, marketCapUsd, solAmount, tokenAmount };
}
```

### Anti-Patterns to Avoid
- **Subscribing to EpochState via WebSocket:** Wasteful -- it only changes at epoch boundaries (~every 5 minutes on devnet). Use 10s polling instead.
- **Creating new Connection instances per hook:** Expensive. Always use the shared `getConnection()` factory. The same Connection handles both HTTP and WebSocket.
- **Ignoring WebSocket cleanup:** Memory leak. Always call `removeAccountChangeListener()` in the useEffect cleanup function.
- **BN.toNumber() on large values:** Pool reserves and lamport amounts can exceed JavaScript's safe integer range. Use `.toNumber()` for display but be aware of precision limits. For amounts > 2^53, format as string.
- **Fetching Carnage event history from on-chain state:** CarnageFundState only stores lifetime totals, not individual events. Per-event history requires parsing transaction logs or using a transaction indexer. This is an important limitation to surface.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Account deserialization | Manual buffer parsing | Anchor `program.coder.accounts.decode()` | IDL-derived types, handles discriminator, version-safe |
| WebSocket reconnection | Custom WS client | `@solana/web3.js` Connection internals | Connection handles reconnection and subscription management |
| Price aggregation | Custom AMM math for price | Jupiter Price API V3 | Jupiter already aggregates across all Solana liquidity |
| Slot-to-time conversion | Precise clock sync | `slotsRemaining * 400ms` approximation | Slot timing is inherently variable (~400ms average); precise timing is impossible and unnecessary per CONTEXT.md |
| PDA derivation | Manual seed computation | Pre-computed addresses from `pda-manifest.json` | All PDA addresses are known at deploy time and stored in the manifest |

**Key insight:** The entire protocol state is readable through 3 account types (EpochState, CarnageFundState, PoolState) plus raw SOL balance of the Carnage vault. No new on-chain reads or instructions are needed.

## Common Pitfalls

### Pitfall 1: Helius WebSocket URL Must Be Separate
**What goes wrong:** Passing HTTP URL to WebSocket subscription causes silent failure or connection refused.
**Why it happens:** Helius uses different URLs for HTTP vs WebSocket. The `Connection` constructor can accept a separate `wsEndpoint` option.
**How to avoid:** When creating the Connection for WebSocket subscriptions, pass the WebSocket URL explicitly:
```typescript
const connection = new Connection(httpUrl, {
  commitment: "confirmed",
  wsEndpoint: httpUrl.replace("https://", "wss://"),
});
```
**Warning signs:** `onAccountChange` never fires, no errors logged.

### Pitfall 2: Helius WebSocket 10-Minute Inactivity Timer
**What goes wrong:** WebSocket connection drops after 10 minutes of no messages.
**Why it happens:** Helius enforces a 10-minute inactivity timeout on WebSocket connections.
**How to avoid:** Implement a heartbeat ping every 60 seconds, or rely on the fact that pool accounts on an active protocol will have frequent changes. The `@solana/web3.js` Connection handles WebSocket keep-alive internally, but if no account changes occur for 10 minutes (e.g., no trading), the subscription may silently disconnect.
**Warning signs:** Dashboard shows stale data after period of no activity.

### Pitfall 3: Carnage Event History Not Available On-Chain
**What goes wrong:** Attempting to read "last 5 Carnage events" from CarnageFundState -- it only has aggregate totals.
**Why it happens:** The on-chain account only stores: `totalSolSpent`, `totalCrimeBurned`, `totalFraudBurned`, `totalTriggers`, `lastTriggerEpoch`. Individual event details (date, which token, amount) are only available from transaction logs/events.
**How to avoid:** For Phase 41 (tech layer), show lifetime aggregates from CarnageFundState. Per-event history requires either: (a) parsing `getSignaturesForAddress` + `getParsedTransaction` to decode CarnageExecuted events, or (b) a backend indexer. This is a real constraint that may need discussion with the user.
**Warning signs:** Requirements DATA-05 asks for "last 5 Carnage events with per-event detail" which cannot be served from account state alone.

### Pitfall 4: Pool Reserve Direction Depends on Canonical Ordering
**What goes wrong:** Displaying "SOL reserves" from `reserveA` when mint_a might be the token (not SOL).
**Why it happens:** AMM pools use canonical mint ordering (mint_a < mint_b by byte comparison). WSOL mint (`So11...2`) happens to sort lower than CRIME/FRAUD mints, so in SOL pools, reserve_a IS the SOL side. But this is coincidental and should be verified per pool.
**How to avoid:** Always check the pool's `mintA` and `mintB` fields against known mint addresses to determine which reserve is SOL and which is the token. The `pda-manifest.json` has pool addresses; the pool account itself stores both mint pubkeys.
**Warning signs:** Pool card shows inverted price or wrong token label.

### Pitfall 5: Devnet SLOTS_PER_EPOCH = 750, Not 4500
**What goes wrong:** Countdown timer is wildly wrong.
**Why it happens:** The on-chain constant was changed to 750 for devnet testing (from the spec's 4500). The constant is in `programs/epoch-program/src/constants.rs`.
**How to avoid:** Use `SLOTS_PER_EPOCH = 750` for devnet. This should be added to the `@dr-fraudsworth/shared` package, or derived from the EpochState's `genesisSlot` + `epochStartSlot` + `currentEpoch`.
**Warning signs:** Epoch countdown shows ~30 minutes instead of ~5 minutes on devnet.

### Pitfall 6: BN (Big Number) Handling in UI
**What goes wrong:** `state.reserveA.toNumber()` returns incorrect value for very large amounts, or `.toString()` displays raw base units without decimal adjustment.
**Why it happens:** Anchor returns `BN` objects for u64 fields. Values > 2^53 lose precision with `.toNumber()`. All token amounts need decimal adjustment (TOKEN_DECIMALS = 6, SOL = 9 decimals).
**How to avoid:** For display, divide by the correct power of 10. For typical devnet amounts, `.toNumber()` is safe. Add a `formatTokenAmount(bn: BN, decimals: number): string` utility.
**Warning signs:** Prices showing as millions when they should be fractions, or vice versa.

## Code Examples

### Fetching EpochState with Full Type Safety
```typescript
// Source: Existing app/lib/anchor.ts pattern
import { getEpochProgram } from "@/lib/anchor";
import { PublicKey } from "@solana/web3.js";

const EPOCH_STATE_PDA = new PublicKey("DVV9ebobxXctrsPZpuSDTj4g85Cg2VmroLLq3chLuBDU");

const program = getEpochProgram();
const state = await program.account.epochState.fetch(EPOCH_STATE_PDA);

// All fields are typed:
const epoch: number = state.currentEpoch;           // u32 -> number
const cheapSide: number = state.cheapSide;           // u8 -> number (0=CRIME, 1=FRAUD)
const crimeBuyTaxBps: number = state.crimeBuyTaxBps; // u16 -> number
const epochStartSlot: BN = state.epochStartSlot;     // u64 -> BN
```

### Fetching Carnage Fund State
```typescript
// Source: Existing app/lib/anchor.ts pattern
const CARNAGE_FUND_PDA = new PublicKey("2WUfRt7x2QKbFBuQoiQQ6Y5dmVJWSw93bobyaEhR1eKK");
const CARNAGE_SOL_VAULT = new PublicKey("9q6Xd7VcTHHtN46qsE4hNZstPp1Bb4TDTjjgUgfPhFa1");

const program = getEpochProgram();
const carnage = await program.account.carnageFundState.fetch(CARNAGE_FUND_PDA);

// Lifetime stats
const totalCrimeBurned = carnage.totalCrimeBurned.toNumber();
const totalFraudBurned = carnage.totalFraudBurned.toNumber();
const totalSolSpent = carnage.totalSolSpent.toNumber();
const totalTriggers = carnage.totalTriggers;

// SOL vault balance (native lamports, not an Anchor account -- use getBalance)
const connection = getConnection();
const vaultBalance = await connection.getBalance(CARNAGE_SOL_VAULT);
```

### WebSocket Subscription for Pool Account
```typescript
// Source: @solana/web3.js Connection.onAccountChange
import { Connection, PublicKey } from "@solana/web3.js";
import { getConnection } from "@/lib/connection";
import { getAmmProgram } from "@/lib/anchor";

const connection = getConnection();
const program = getAmmProgram(connection);
const poolPubkey = new PublicKey("2QLDtSMSoEpjZxprGYWZkG35Uqrs4vUucMX2SZLXYUkD"); // CRIME/SOL

const subId = connection.onAccountChange(
  poolPubkey,
  (accountInfo) => {
    const decoded = program.coder.accounts.decode("poolState", accountInfo.data);
    console.log("Reserve A:", decoded.reserveA.toString());
    console.log("Reserve B:", decoded.reserveB.toString());
  },
  "confirmed"
);

// Cleanup
// connection.removeAccountChangeListener(subId);
```

### Tax Rate Display Formatting
```typescript
// Tax rates are in basis points (bps). 100 bps = 1.0%
function formatTaxRate(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}

// Example: crimeBuyTaxBps = 300 -> "3.0%"
// Example: crimeSellTaxBps = 1200 -> "12.0%"
```

### Epoch Countdown Timer with Warning Banner
```typescript
const SLOTS_PER_EPOCH = 750; // devnet constant
const MS_PER_SLOT = 400; // approximate

function useEpochCountdown(epochStartSlot: number | null, currentSlot: number | null) {
  if (!epochStartSlot || !currentSlot) return { text: "Loading...", imminent: false };

  const nextEpochSlot = epochStartSlot + SLOTS_PER_EPOCH;
  const slotsRemaining = Math.max(0, nextEpochSlot - currentSlot);
  const secondsRemaining = Math.round((slotsRemaining * MS_PER_SLOT) / 1000);

  const imminent = secondsRemaining <= 30; // warning banner threshold
  let text: string;

  if (slotsRemaining === 0) {
    text = "Epoch transition pending";
  } else if (secondsRemaining > 120) {
    text = `~${Math.round(secondsRemaining / 60)} minutes remaining`;
  } else if (secondsRemaining > 60) {
    text = `~1 minute remaining`;
  } else {
    text = `~${secondsRemaining} seconds remaining`;
  }

  return { text, imminent, slotsRemaining, secondsRemaining };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@solana/web3.js` v1 Connection | `@solana/kit` (web3.js v2) | 2024-2025 | This project uses v1; no migration needed. v1 is stable and functional. |
| Jupiter Price API V2 | Jupiter Price API V3 | Late 2025 / Early 2026 | V2 is deprecated. Must use V3 endpoint (`api.jup.ag/price/v3`). |
| `lite-api.jup.ag` | `api.jup.ag` | Jan 2026 (postponed) | Lite API URL being deprecated; use `api.jup.ag` with API key |

**Deprecated/outdated:**
- Jupiter Price API V2: Deprecated, use V3
- `lite-api.jup.ag`: Being deprecated, use `api.jup.ag`

## Open Questions

1. **Carnage Event History (DATA-05)**
   - What we know: CarnageFundState only stores lifetime aggregates (totalCrimeBurned, totalFraudBurned, totalSolSpent, totalTriggers, lastTriggerEpoch). Individual event details are emitted as `CarnageExecuted` program events in transaction logs.
   - What's unclear: How to retrieve the last 5 events. Options are: (a) `getSignaturesForAddress` on the CarnageFund PDA + `getTransaction` to parse logs, (b) a backend event indexer, or (c) defer per-event detail to a later phase and show only aggregates now.
   - Recommendation: **Discuss with user.** Option (a) is feasible but slow (multiple RPC calls per event, log parsing is fragile). This is a real architectural question. For tech-layer purposes, showing lifetime aggregates + last trigger epoch may be sufficient. Per-event detail could be Phase 41 stretch or deferred.

2. **Jupiter Price API Key Requirement**
   - What we know: Jupiter Price API V3 documentation mentions an `x-api-key` header. The free tier may or may not require a key for basic price lookups.
   - What's unclear: Whether the API works without a key for simple price queries (it did historically). Rate limits for unauthenticated requests.
   - Recommendation: Test without API key first. If required, generate a free key from `portal.jup.ag` and store in `.env.local` as `NEXT_PUBLIC_JUPITER_API_KEY`.

3. **SLOTS_PER_EPOCH Should Be in Shared Package**
   - What we know: Currently only defined in Rust as `750` in `programs/epoch-program/src/constants.rs`. Not yet in `@dr-fraudsworth/shared`.
   - What's unclear: Whether this should be added to shared or derived from on-chain state (epoch N started at slot X, genesis at slot G, so `SLOTS_PER_EPOCH = (X - G) / N`).
   - Recommendation: Add `SLOTS_PER_EPOCH = 750` to `shared/constants.ts` alongside existing constants. It's a protocol constant that won't change between epochs.

4. **WebSocket URL for Helius Devnet**
   - What we know: Helius WebSocket URL is `wss://devnet.helius-rpc.com/?api-key=...`. The existing `DEVNET_RPC_URL` is `https://devnet.helius-rpc.com/?api-key=[REDACTED-DEVNET-KEY]...`.
   - What's unclear: Whether `@solana/web3.js` Connection automatically converts HTTPS to WSS, or if it needs explicit `wsEndpoint` configuration.
   - Recommendation: The `Connection` constructor can accept `wsEndpoint` in its config. Test with default first (web3.js usually handles the conversion). If WebSocket fails, explicitly set `wsEndpoint: DEVNET_RPC_URL.replace("https://", "wss://")`.

## Sources

### Primary (HIGH confidence)
- `app/lib/anchor.ts` -- Existing Anchor program factory with 5 typed getter functions
- `app/lib/connection.ts` -- Existing Connection factory
- `app/idl/types/epoch_program.ts` -- EpochState and CarnageFundState account types (full field definitions)
- `app/idl/types/amm.ts` -- PoolState account type (reserves, mints, vault addresses)
- `programs/epoch-program/src/constants.rs` -- `SLOTS_PER_EPOCH = 750`
- `scripts/deploy/pda-manifest.json` -- All PDA addresses, pool addresses, mint addresses
- `shared/constants.ts` -- PROGRAM_IDS, MINTS, SEEDS, TOKEN_DECIMALS
- Solana documentation (accountSubscribe WebSocket) -- verified via Helius docs and @solana/web3.js
- Jupiter Price API V3 docs (`dev.jup.ag/docs/price/v3`) -- endpoint `api.jup.ag/price/v3?ids=...`

### Secondary (MEDIUM confidence)
- Helius WebSocket documentation -- 10-minute inactivity timer, WSS URL format
- `@solana/web3.js` `Connection.onAccountChange()` -- verified via QuickNode and Helius docs

### Tertiary (LOW confidence)
- Jupiter Price API V3 rate limits -- documentation unclear on free tier limits
- Slot timing (~400ms average) -- empirical average, varies with network conditions

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in project, no new dependencies
- Architecture: HIGH -- patterns match existing codebase (useTokenBalances.ts), verified account types
- Pitfalls: HIGH -- account types verified from IDL, PDA addresses from manifest, slot constant from source code
- Carnage event history: LOW -- requires discussion on approach

**Research date:** 2026-02-15
**Valid until:** 2026-03-15 (stable -- protocol is deployed, account structures are fixed)
