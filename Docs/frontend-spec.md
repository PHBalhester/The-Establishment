---
doc_id: frontend-spec
title: "Dr. Fraudsworth's Finance Factory -- Frontend Specification"
wave: 2
requires: [architecture]
provides: [frontend-spec]
status: draft
decisions_referenced: [frontend, operations, security, architecture]
needs_verification: []
---

# Frontend Specification

## Overview

| Aspect | Choice | Status |
|--------|--------|--------|
| **Framework** | Next.js 16.1.6, React 19.2.3, App Router | IMPLEMENTED |
| **Bundler** | Turbopack (dev + build), monorepo root set explicitly | IMPLEMENTED |
| **Rendering** | `force-dynamic` on all routes (client-only, no static prerender) | IMPLEMENTED |
| **State Management** | React hooks only -- no Redux, Zustand, or Context. Every data hook is `"use client"` and follows the DashboardGrid orchestrator pattern (one component calls hooks, children receive props). | IMPLEMENTED |
| **Styling** | Tailwind CSS 4.1.18 via `@tailwindcss/postcss`. Global CSS is a single `@import "tailwindcss"` line. No custom theme file; all styling is inline utility classes. | IMPLEMENTED |
| **Wallet** | `@solana/wallet-adapter-react` with `@solana/wallet-adapter-wallets`. External wallets only: Phantom, Solflare, Backpack, and all detected Solana wallets. | IMPLEMENTED |
| **RPC** | Helius devnet via singleton `Connection` (HTTP + WSS). Env var `NEXT_PUBLIC_RPC_URL` overrides default. | IMPLEMENTED |
| **Charts** | TradingView Lightweight Charts v5.1.0 (`lightweight-charts` npm). ESM-only, Turbopack-native. | IMPLEMENTED |
| **Database** | Drizzle ORM 0.45.1 + `postgres` 3.4.8 driver on Railway Postgres. 4 tables: `swap_events`, `candles`, `epoch_events`, `carnage_events`. | IMPLEMENTED |
| **Error Monitoring** | Zero-dependency `lib/sentry.ts` -- raw `fetch()` POST to Sentry envelope API. No `@sentry/*` npm packages (all conflict with Turbopack SSR). | IMPLEMENTED |
| **Hosting** | Railway (`dr-fraudsworth-production.up.railway.app`). `/api/health` health check endpoint for Railway's liveness probe. | IMPLEMENTED |

### Critical Compatibility Notes

- **Turbopack + Sentry**: All `@sentry/*` npm packages break Turbopack SSR (monkey-patch webpack internals or get bundled into server code). The project uses a custom zero-dependency reporter at `app/lib/sentry.ts`.
- **Browser Buffer Polyfill**: `buffer` v6.x lacks `writeBigUInt64LE`/`readBigUInt64LE`. Manual shims are applied in `instrumentation-client.ts` before React hydration.
- **Anchor Node Stubs**: `fs`, `net`, `tls` are stubbed to `lib/empty.ts` via Turbopack `resolveAlias` to prevent "Module not found" build failures from Anchor/web3.js transitive imports.

---

## Scene Architecture (Hotspots to Modals)

> **Status: PLANNED (Decision D1-D3)**. The current implementation uses traditional page routing (`/` = dashboard, `/swap` = swap+staking). The steampunk factory scene has not been built yet.

### Planned Design (from Frontend Decisions D1-D3)

The production frontend will be a **single interactive steampunk factory scene** -- no page navigation, all interactions via modals launched from hotspot clicks.

**Implementation approach**: Layered transparent PNGs over a static factory background. Each layer is a distinct element (machine, cauldron, tube, etc.) with per-element CSS hover effects (glow, brighten).

### Hotspot-to-Modal Mapping

| # | Hotspot Element | Target Modal | Content |
|---|----------------|--------------|---------|
| 1 | Control Panel | Trading Terminal | Candlestick chart + swap UI + epoch tax rates |
| 2 | Machine Screen | Trading Terminal | Same modal as Control Panel (two entry points) |
| 3 | Green Bubbling Tube | Staking | Stake/unstake/claim PROFIT, APY display |
| 4 | Cauldron | Carnage | Fund balance, burn totals, recent events (view-only) |
| 5 | Hanging Sign | Connect Wallet | Wallet picker (external wallets) |
| 6 | Blueprint Stand | How It Works | Brief comedic explainer + link to Nextra docs |
| 7 | Gear on Wall | Settings | Wallet export, explorer pref, priority fees, SOL/USD toggle |

### Current Implementation (Dev Views)

Two page routes exist as **developer-only** functional views (Decision D8):

| Route | Component | Purpose |
|-------|-----------|---------|
| `/` | `app/app/page.tsx` | Protocol data dashboard -- `DashboardGrid` with epoch, tax rates, pool reserves, Carnage stats |
| `/swap` | `app/app/swap/page.tsx` | Swap + staking forms with candlestick chart |

Both pages share a common header with `WalletButton` and use the same dark theme (`bg-zinc-950` / `bg-gray-950`).

---

## Modal Specifications

### Trading Terminal Modal

> **Status: Components IMPLEMENTED as page-level views; modal wrapper PLANNED**

**Layout** (Decision D4): Split panel -- left side is candlestick chart with pool selector tabs, right side is divided into top (swap UI / "Big Red Button") and bottom (epoch tax rates display).

**Implemented components that will be composed into this modal:**

| Component | File | Purpose |
|-----------|------|---------|
| `CandlestickChart` | `app/components/chart/CandlestickChart.tsx` | TradingView Lightweight Charts v5 wrapper. Dark theme, ResizeObserver responsive width, green/red candles, incremental `series.update()` optimization. |
| `ChartControls` | `app/components/chart/ChartControls.tsx` | Pool selector (2 SOL pools), time range buttons (1H/4H/1D/1W), resolution selector, SSE connection status indicator (green/amber/red dot). |
| `SwapForm` | `app/components/swap/SwapForm.tsx` | Sole hook consumer for swap UI. Contains `TokenSelector`, flip button, `FeeBreakdown`, `SlippageConfig`, `SwapStatus`. |
| `TokenSelector` | `app/components/swap/TokenSelector.tsx` | Dropdown for token selection, respects `VALID_PAIRS` constraints. |
| `FeeBreakdown` | `app/components/swap/FeeBreakdown.tsx` | Expandable panel showing LP fee, tax amount, price impact, minimum output, total fee percentage. |
| `SlippageConfig` | `app/components/swap/SlippageConfig.tsx` | Slippage tolerance (bps) + priority fee preset selector (None/Low/Medium/High/Turbo). |
| `SwapStatus` | `app/components/swap/SwapStatus.tsx` | Transaction lifecycle button/status/result display. States: idle, building, signing, sending, confirming, confirmed, failed. |
| `EpochCard` | `app/components/dashboard/EpochCard.tsx` | Current epoch number, cheap side indicator, countdown timer (slots-based). |
| `TaxRatesCard` | `app/components/dashboard/TaxRatesCard.tsx` | CRIME/FRAUD buy/sell tax rates in basis points. |

**Swap flow**: User selects token pair (constrained by `VALID_PAIRS`), enters amount in either direction (bidirectional quoting with 300ms debounce), reviews fee breakdown, clicks swap. Transaction lifecycle: build -> sign (wallet prompt) -> send -> confirm. Auto-resets after 10 seconds.

**Token pairs supported**: SOL<->CRIME, SOL<->FRAUD (4 valid directional pairs across 2 SOL pools). PROFIT is acquired via the Conversion Vault (100:1 fixed rate, zero fees, zero slippage) -- not through AMM pools. The vault replaces the former CRIME/PROFIT and FRAUD/PROFIT AMM pools. Vault conversion steps display as "Vault: 100:1 fixed rate, no fees" in the `RouteCard` component, and `FeeBreakdown` shows "0% fee" for vault legs. `SlippageConfig` is disabled for vault-only routes since the rate is deterministic.

### Staking Modal

> **Status: Components IMPLEMENTED as page-level view; modal wrapper PLANNED**

**Implemented components:**

| Component | File | Purpose |
|-----------|------|---------|
| `StakingForm` | `app/components/staking/StakingForm.tsx` | Sole hook consumer. Tab buttons + active tab content + action button/status. |
| `StakingStats` | `app/components/staking/StakingStats.tsx` | Always-visible stats card: per-epoch rewards, annualized rate, pool share %, pending rewards, lifetime claimed. |
| `StakeTab` | `app/components/staking/StakeTab.tsx` | Amount input for staking PROFIT tokens. Shows wallet PROFIT balance. |
| `UnstakeTab` | `app/components/staking/UnstakeTab.tsx` | Amount input for unstaking. Shows staked balance, forfeiture warning (pending rewards forfeited to pool on unstake), cooldown blocked state with countdown timer, minimum stake warning. |
| `ClaimTab` | `app/components/staking/ClaimTab.tsx` | View-only: pending SOL rewards, lifetime claimed, per-epoch estimate, pool share. Single "Claim" button. |
| `StakingStatus` | `app/components/staking/StakingStatus.tsx` | Transaction lifecycle display (mirrors SwapStatus pattern). |

**Key behaviors**:
- Staking data polled every 30 seconds via Anchor `account.fetch()` on StakePool + UserStake PDAs.
- Client-side pending reward calculation uses `BigInt` arithmetic mirroring on-chain `math.rs` (rewards_per_token_stored is u128, overflows f64).
- Minimum stake warning: if partial unstake would leave remaining balance below `MINIMUM_STAKE` (1 PROFIT = 1,000,000 base units), warns user that full balance will be unstaked.
- Unstake forfeits pending rewards to remaining stakers. Blocked during 12-hour cooldown after claiming.
- Auto-reset after 10 seconds on confirmed state.

### Carnage Modal

> **Status: Components IMPLEMENTED as dashboard card; modal wrapper PLANNED**

Decision D5: **View-only** -- no user actions.

| Component | File | Purpose |
|-----------|------|---------|
| `CarnageCard` | `app/components/dashboard/CarnageCard.tsx` | Displays vault SOL balance (real-time via WebSocket), total CRIME/FRAUD burned, total SOL spent, total triggers, last trigger epoch, time since last trigger, last 5 Carnage events. |

**Data sources**:
- `useCarnageData`: Polls `CarnageFundState` PDA every 10s for lifetime stats; WebSocket subscription on `CarnageSolVault` for real-time vault balance.
- `useCarnageEvents`: Polls `getSignaturesForAddress` every 60s, parses Anchor event logs (`sha256("event:CarnageExecuted")[0..8]` discriminator), returns up to 5 most recent events.

### Wallet Modal

> **Status: IMPLEMENTED**

| Component | File | Purpose |
|-----------|------|---------|
| `ConnectModal` | `app/components/wallet/ConnectModal.tsx` | Two-path connection: (1) "Connect Wallet" for external wallets via `connectWallet()`, (2) "Sign In" for social login via `login()`. |
| `WalletButton` | `app/components/wallet/WalletButton.tsx` | Three states: loading skeleton, "Connect Wallet" button, or connected address (click to copy) + disconnect. |
| `BalanceDisplay` | `app/components/wallet/BalanceDisplay.tsx` | Shows SOL/CRIME/FRAUD/PROFIT balances. |

**Single-path design**: All users connect via external Solana wallets. No embedded wallets or social login.

**Supported wallets**: Phantom, Solflare, Backpack, and all detected Solana wallets.

### How It Works Modal

> **Status: PLANNED (Decision D6)**

Brief comedic explainer of protocol mechanics (dual tokens, epoch tax rotation, Carnage buyback/burn, staking rewards). Links to the full Nextra documentation site.

**Nextra docs site** (Decision D11): Separate deployment at `docs-site/`. Built with Nextra 4 + Next.js 15, Pagefind search, 16 pages of content. Content lives in `docs-site/content/`.

### Settings Modal

> **Status: PLANNED (Decision D7)**

Four settings:

| Setting | Description | Default |
|---------|-------------|---------|
| **Explorer Preference** | Solscan / SolanaFM / Solana Explorer | Solscan |
| **Priority Fee Preset** | None / Low / Medium / High / Turbo (microLamports/CU: 0, 1K, 10K, 100K, 1M) | Medium |
| **SOL/USD Toggle** | Display values in SOL or USD equivalent | SOL |

The priority fee preset is already implemented in `useSwap` and `useStaking` hooks. The Settings modal will persist preferences to `localStorage`.

---

## Components

### Full Component Inventory

```
app/
  components/
    chart/
      CandlestickChart.tsx    [IMPLEMENTED] TradingView v5 wrapper
      ChartControls.tsx        [IMPLEMENTED] Pool/range/resolution selectors
    dashboard/
      DashboardGrid.tsx        [IMPLEMENTED] Orchestrator: calls 6 hooks, passes props to cards
      EpochCard.tsx            [IMPLEMENTED] Epoch number, cheap side, countdown
      TaxRatesCard.tsx         [IMPLEMENTED] CRIME/FRAUD buy/sell tax BPS
      PoolCard.tsx             [IMPLEMENTED] Reserve amounts, price, market cap, cheap-side badge
      CarnageCard.tsx          [IMPLEMENTED] Vault balance, burns, triggers, recent events
    staking/
      StakingForm.tsx          [IMPLEMENTED] Orchestrator: calls useStaking, passes props
      StakingStats.tsx         [IMPLEMENTED] APY, pool share, pending rewards
      StakeTab.tsx             [IMPLEMENTED] Stake PROFIT input
      UnstakeTab.tsx           [IMPLEMENTED] Unstake PROFIT input + minimum stake warning
      ClaimTab.tsx             [IMPLEMENTED] Claim SOL rewards display
      StakingStatus.tsx        [IMPLEMENTED] Transaction lifecycle display
    swap/
      SwapForm.tsx             [IMPLEMENTED] Orchestrator: calls useSwap, passes props
      TokenSelector.tsx        [IMPLEMENTED] Token dropdown with VALID_PAIRS enforcement
      FeeBreakdown.tsx         [IMPLEMENTED] Expandable fee details
      SlippageConfig.tsx       [IMPLEMENTED] Slippage BPS + priority fee preset
      SwapStatus.tsx           [IMPLEMENTED] Transaction lifecycle display
    wallet/
      WalletButton.tsx         [IMPLEMENTED] Header wallet state display
      ConnectModal.tsx         [IMPLEMENTED] Two-path connection modal
      BalanceDisplay.tsx       [IMPLEMENTED] Token balance display
```

**Planned components** (for steampunk scene -- Decision D1-D3, D10):

```
    scene/
      FactoryScene.tsx         [PLANNED] Main scene container, layered PNGs
      Hotspot.tsx              [PLANNED] Individual clickable region with hover glow
      ModalOverlay.tsx         [PLANNED] Generic modal wrapper (backdrop, close, escape key)
      AmbientAnimations.tsx    [PLANNED] CSS keyframe animations: bubbling tube, simmering cauldron
    modals/
      TradingTerminalModal.tsx [PLANNED] Composes chart + swap + tax rates
      StakingModal.tsx         [PLANNED] Wraps StakingForm + StakingStats
      CarnageModal.tsx         [PLANNED] Wraps CarnageCard (view-only)
      HowItWorksModal.tsx      [PLANNED] Comedic explainer + Nextra link
      SettingsModal.tsx        [PLANNED] Wallet export, explorer, fees, SOL/USD
```

### Component Design Pattern

All orchestrator components follow the **DashboardGrid pattern**:

1. **One orchestrator** calls all data hooks (e.g., `DashboardGrid`, `SwapForm`, `StakingForm`).
2. **Presentational children** receive data as props only -- zero hook calls.
3. This makes children trivially testable with mock data and reusable across different contexts.

---

## State Management (Hooks Inventory)

The entire application state is managed through 12 custom hooks. There is no global store, no Context providers (besides wallet-adapter), no Redux, no Zustand. Each hook is self-contained with its own polling/subscription lifecycle.

### Hook Inventory

| Hook | File | Data Source | Update Mechanism | Poll/Sub Interval | Status |
|------|------|-------------|------------------|--------------------|--------|
| `useProtocolWallet` | `app/hooks/useProtocolWallet.ts` | wallet-adapter `useWallet()` + `useConnection()` | Reactive (wallet state changes) | N/A (event-driven) | IMPLEMENTED |
| `useSwap` | `app/hooks/useSwap.ts` | Composes `useProtocolWallet` + `usePoolPrices` + `useEpochState` + `useTokenBalances` | State machine: idle->quoting->building->signing->sending->confirming->confirmed/failed | 300ms debounce on quote | IMPLEMENTED |
| `useStaking` | `app/hooks/useStaking.ts` | Anchor `account.fetch()` on StakePool + UserStake PDAs | Polling + re-fetch on confirmed TX | 30s poll | IMPLEMENTED |
| `usePoolPrices` | `app/hooks/usePoolPrices.ts` | Anchor `account.fetch()` initial + `connection.onAccountChange()` WebSocket | WebSocket push (real-time on every swap) | Initial fetch + WS subscription | IMPLEMENTED |
| `useEpochState` | `app/hooks/useEpochState.ts` | Anchor `account.fetch()` on EpochState PDA | Polling | 10s | IMPLEMENTED |
| `useCurrentSlot` | `app/hooks/useCurrentSlot.ts` | `connection.getSlot()` | Polling | 10s | IMPLEMENTED |
| `useSolPrice` | `app/hooks/useSolPrice.ts` | Jupiter Price API v3 via `lib/jupiter.ts` | Polling | 30s | IMPLEMENTED |
| `useTokenBalances` | `app/hooks/useTokenBalances.ts` | `getBalance()` + `getParsedTokenAccountsByOwner()` with `TOKEN_2022_PROGRAM_ID` | Polling + cross-instance `CustomEvent` sync | 30s poll + manual refresh | IMPLEMENTED |
| `useCarnageData` | `app/hooks/useCarnageData.ts` | Anchor `account.fetch()` on CarnageFundState + `connection.onAccountChange()` on CarnageSolVault | Polling + WebSocket | 10s poll + WS for vault balance | IMPLEMENTED |
| `useCarnageEvents` | `app/hooks/useCarnageEvents.ts` | `getSignaturesForAddress()` + `getParsedTransaction()`, manual Anchor event log parsing | Polling | 60s | IMPLEMENTED |
| `useChartData` | `app/hooks/useChartData.ts` | REST `GET /api/candles` for history + SSE for real-time updates | REST fetch on param change + SSE merge | On-demand + SSE stream | IMPLEMENTED |
| `useChartSSE` | `app/hooks/useChartSSE.ts` | `EventSource("/api/sse/candles")` | SSE push with exponential backoff reconnect (1s->30s max) | Continuous stream | IMPLEMENTED |

### Cross-Instance Balance Sync

`useTokenBalances` implements a cross-instance sync mechanism using browser `CustomEvent`:

- When any hook instance calls `refresh()` (e.g., after a swap completes), it dispatches a `"token-balances-refresh"` event on `window`.
- All other `useTokenBalances` instances listen for this event and re-fetch.
- A `isDispatchingRef` guard prevents the dispatching instance from double-fetching.
- This ensures SwapForm and StakingForm see updated PROFIT balances without a page refresh.

### Polling Configuration Summary

| Data | Interval | Rationale |
|------|----------|-----------|
| EpochState | 10s | Epoch transitions every ~5 min; 10s gives responsive countdown |
| Current Slot | 10s | Needed for countdown computation |
| Pool Reserves | WebSocket (real-time) | Reserves change on every swap; WS push is instant |
| Token Balances | 30s | Balances change less frequently; manual refresh on TX confirm |
| SOL/USD Price | 30s | External market data; slower cadence saves RPC credits |
| Carnage State | 10s poll + WebSocket | PDA stats via polling; vault SOL balance via WS |
| Carnage Events | 60s | Events are rare (~4% per epoch); high RPC cost per fetch |
| Chart (historical) | On-demand | Only fetches when pool/resolution/range changes |
| Chart (live) | SSE stream | Continuous server push from webhook pipeline |

**Planned optimization:** Batch individual `getAccountInfo` calls (from `useEpochState`, `useCarnageData`, etc.) into `getMultipleAccounts` calls to reduce RPC credit consumption. This is part of the 91% RPC credit reduction plan but is not yet implemented. Current hooks poll independently.

<!-- Phase 84 implemented the SSE pipeline and /api/rpc proxy. Polling intervals are now secondary to SSE push with 30s fallback threshold. Mainnet intervals may still need tuning. -->

---

## Data Fetching (RPC, WebSocket, SSE, Webhooks)

### Architecture Diagram

```
                                           Helius RPC (devnet)
                                          /        |         \
                                    HTTP GET    WebSocket    Webhooks
                                      |            |            |
                              +---------+    +--------+    +----------+
                              |  Polls  |    | Pushes |    | Raw TX   |
                              +---------+    +--------+    | delivery |
                                   |              |        +----------+
                                   v              v             |
                              React Hooks    React Hooks    POST /api/webhooks/helius
                              (useEpoch,     (usePool,           |
                               useSlot,       useCarnage         v
                               useBalance,    Data vault)   event-parser.ts
                               useSolPrice)                      |
                                                            +----+----+
                                                            |         |
                                                     swap_events  candle-aggregator.ts
                                                     epoch_events      |
                                                     carnage_events    v
                                                                  SSE Manager
                                                                       |
                                                                  GET /api/sse/candles
                                                                       |
                                                                  useChartSSE (browser)
```

### RPC Connection Management

**Singleton factory** (`app/lib/connection.ts`): A single `Connection` instance is cached and shared across all hooks. This prevents duplicate WebSocket connections (each `Connection` opens its own WS channel). The singleton is invalidated only if the RPC URL changes.

```typescript
// Priority: NEXT_PUBLIC_RPC_URL > DEVNET_RPC_URL from shared package
const url = rpcUrl ?? process.env.NEXT_PUBLIC_RPC_URL ?? DEVNET_RPC_URL;
const wsEndpoint = url.replace("https://", "wss://");
cachedConnection = new Connection(url, { commitment: "confirmed", wsEndpoint });
```

### WebSocket Subscriptions

Three subscriptions via `connection.onAccountChange()`:

| Subscription | Hook | Account | Data |
|-------------|------|---------|------|
| CRIME/SOL pool | `usePoolPrices` | PoolState PDA | Reserve A/B, mint A/B |
| FRAUD/SOL pool | `usePoolPrices` | PoolState PDA | Reserve A/B, mint A/B |
| Carnage Vault | `useCarnageData` | CarnageSolVault (SystemAccount) | `accountInfo.lamports` |

All WebSocket subscriptions clean up via `removeAccountChangeListener()` on component unmount. Reconnection is handled by `@solana/web3.js` Connection internals.

### API Routes

| Route | Method | Runtime | Purpose | Status |
|-------|--------|---------|---------|--------|
| `/api/candles` | GET | Node.js | Historical OHLCV candle data. Query params: `pool`, `resolution` (1m/5m/15m/1h/4h/1d), `from`, `to`, `limit` (max 2000). Gap-fills missing periods with flat candles (carry-forward last price). | IMPLEMENTED |
| `/api/sse/candles` | GET | Node.js | SSE stream for real-time candle updates. Events: `connected`, `candle-update`. 15s heartbeat comment to prevent proxy timeout. | IMPLEMENTED |
| `/api/webhooks/helius` | POST | Node.js | Helius raw webhook ingestion. Parses Anchor events (TaxedSwap, UntaxedSwap, EpochTransitionTriggered, TaxesUpdated, CarnageExecuted), stores to Postgres, triggers candle aggregation + SSE broadcast. `HELIUS_WEBHOOK_SECRET` auth header (optional for devnet testing; **required for mainnet** per Security Decision D14). | IMPLEMENTED |
| `/api/health` | GET | Node.js | Liveness check. Verifies Postgres connectivity (`SELECT 1`) and Solana RPC (`getSlot()`). Returns `200 ok` or `503 degraded`. | IMPLEMENTED |

### SSE Pipeline

The SSE candle pipeline is the real-time data backbone for the chart:

1. **Helius webhook** delivers raw Solana transactions to `/api/webhooks/helius`.
2. **event-parser.ts** extracts Anchor events from `logMessages` using `BorshCoder`/`EventParser`.
3. Swap events are stored in `swap_events` table.
4. **candle-aggregator.ts** upserts OHLCV candles at all 6 resolutions (1m, 5m, 15m, 1h, 4h, 1d).
5. **sse-manager.ts** (singleton in-process) broadcasts `candle-update` events to all connected SSE clients.
6. **useChartSSE** in the browser receives updates via `EventSource` and dispatches to `useChartData`.
7. **useChartData** filters by current pool + resolution, then either updates the last candle in-place or appends a new one.

### Security: Backend RPC Proxy

Decision D14 (updated Phase 84): The `/api/rpc` proxy route hides the Helius API key from client-side code. The frontend's `NEXT_PUBLIC_RPC_URL` points to `/api/rpc` in production. Priority fees are fetched via Helius `getPriorityFeeEstimate` with 5 preset levels (Min/Low/Medium/High/VeryHigh). Fallback: 50,000 micro-lamports when Helius is unreachable. WebSocket disabled for the proxy (HTTP-only); browser uses HTTP polling via SSE.

**SSE Real-Time Data (Phase 84):** The `/api/sse` endpoint provides server-sent events for real-time state updates (epoch transitions, pool reserves, carnage events). The client uses a 30-second downtime threshold before falling back to RPC polling (60-second poll interval with `getMultipleAccountsInfo` for all 7 PDAs in a single call). SSE event filtering uses string prefix matching to avoid parsing all event types.

---

## User Flows

### Flow 1: First-Time Visitor (No Wallet)

1. User navigates to the site.
2. **Dashboard loads immediately** -- all data hooks work without a wallet connected (read-only RPC).
3. Epoch card shows current epoch, countdown, cheap side.
4. Tax rates card shows CRIME/FRAUD buy/sell rates.
5. Pool cards show reserves, prices, market caps for all 2 SOL pools.
6. Carnage card shows vault balance, burn stats, recent events.
7. User clicks "Connect Wallet" in the header.

### Flow 2: Wallet Connection

**Wallet connection (Phantom, Solflare, Backpack, etc.):**
1. User clicks "Connect Wallet" -> `ConnectModal` opens.
2. User selects a wallet from the detected wallet list.
3. Wallet-adapter's `select()` + `connect()` triggers the wallet extension's approval prompt.
4. User approves connection in their wallet extension.
5. Modal closes. `WalletButton` updates to show truncated address (e.g., "8kPz...MH4").
6. `useTokenBalances` begins fetching SOL/CRIME/FRAUD/PROFIT balances.

### Flow 3: Token Swap

1. User navigates to `/swap` (or clicks control panel in planned scene).
2. `SwapForm` renders with default pair SOL -> CRIME.
3. User selects tokens via `TokenSelector` dropdowns (respects `VALID_PAIRS`).
4. User enters amount in either input or output field.
5. 300ms debounce fires, `computeQuote()` runs locally against live pool reserves + epoch tax rates.
6. Output amount populates. `FeeBreakdown` shows LP fee, tax amount, price impact, minimum output.
7. User configures slippage (default 100 bps = 1%) and priority fee (default Medium = 10K microLamports/CU).
8. User clicks "Swap" button.
9. **Transaction lifecycle**: building -> signing (wallet prompt) -> sending -> confirming -> confirmed.
10. On success: balances refresh (via `useTokenBalances.refresh()` cross-instance sync), auto-reset after 10s.
11. On failure: error message from `error-map.ts`, "Try Again" button resets form.

### Flow 4: Staking

1. User opens staking UI (currently `/swap` right column, planned as separate modal).
2. `StakingStats` shows pool-wide and user-specific statistics.
3. User selects tab: **Stake** / **Unstake** / **Claim**.

**Stake tab:**
1. User enters PROFIT amount.
2. Clicks "Stake". Transaction builds, signs, sends, confirms.
3. PROFIT balance decreases, staked balance increases.

**Unstake tab:**
1. User enters PROFIT amount to unstake.
2. If remaining staked balance would be below `MINIMUM_STAKE` (1 PROFIT), warning displays.
3. Clicks "Unstake". Transaction unstakes PROFIT. Pending SOL rewards are forfeited to remaining stakers.
4. PROFIT balance increases, staked balance decreases. SOL balance unchanged (no SOL on unstake).

**Claim tab:**
1. Shows pending SOL rewards (calculated client-side with BigInt math mirroring on-chain `update_rewards()`).
2. Clicks "Claim". SOL rewards transfer to wallet.
3. Note: Claiming starts a 12-hour unstake cooldown. User cannot unstake until cooldown expires.

### Flow 5: Viewing Carnage Events

1. `CarnageCard` on dashboard shows:
   - Current vault SOL balance (real-time via WebSocket).
   - Lifetime burn totals (CRIME + FRAUD).
   - Total SOL spent on buybacks.
   - Total trigger count.
   - Time since last trigger (derived from `lastTriggerEpoch` vs `currentEpoch`).
   - Last 5 Carnage events with action type (Burn/Sell), target token, amounts.
2. All data is view-only (Decision D5). No user actions.

### Flow 6: Launch Page (Bonding Curve -- Phase 75)

1. User navigates to `/launch` during the bonding curve phase.
2. **Dual curve display**: Side-by-side CRIME and FRAUD bonding curves with progress bars, current price, tokens sold, SOL raised.
3. **Purchase flow**: User enters SOL amount, sees estimated tokens out, price impact, and fill percentage. Slippage protection via `minimum_tokens_out`.
4. **Sell-back flow**: User enters token amount, sees estimated SOL out (net of 15% tax). Disabled when curve is Filled.
5. **Countdown timer**: 48-hour deadline displayed as countdown. When expired, "Curve Failed" banner with refund instructions.
6. **Per-wallet cap**: Display shows current holdings vs 20M cap per token.
7. **Post-graduation**: Page redirects to main swap interface once both curves graduate.

### Flow 7: Mobile Wallet Connection (Phase 85.1)

1. **Mobile browser detection**: On mobile Chrome/Safari, the "Connect Wallet" flow shows mobile-specific wallet options.
2. **Deep link approach**: Tapping a wallet (e.g., Phantom) opens a deep link that launches the wallet app.
3. **In-app browser**: The wallet's in-app browser loads the dApp where wallet-standard auto-detection works natively.
4. **"Open App" badges**: Mobile wallets show "Open App" (not "Install") -- deep links open the app or fall back to app store.
5. **No `@solana-mobile/wallet-adapter-mobile`**: Deep links are manual (SMS/Saga-only SDK not used for mobile browser).
6. **Connect prompt in BuySellPanel**: Benefits both mobile and desktop users with a clear CTA when wallet is not connected.

### Flow 8: Staking Eligible Unstake Display (Phase 85.2)

1. **Eligible unstake calculation**: The unstake tab shows the maximum amount the user can unstake accounting for cooldown and minimum stake requirements.
2. **Global stats**: Fetched inside `fetchStakingData` (shares 30s poll lifecycle, no separate timer).

---

## Design System

### Color Palette (Current Implementation)

| Role | Tailwind Class | Hex | Usage |
|------|---------------|-----|-------|
| Background (primary) | `bg-zinc-950` / `bg-gray-950` | `#09090b` / `#030712` | Page backgrounds |
| Card background | `bg-gray-900` / `bg-zinc-900` | `#111827` / `#18181b` | Form cards, modal cards |
| Card background (darker) | `bg-zinc-800` / `bg-gray-800` | `#27272a` / `#1f2937` | Buttons, inputs |
| Border | `border-zinc-700` / `border-gray-800` | `#3f3f46` / `#1f2937` | Card borders, dividers |
| Text (primary) | `text-zinc-100` / `text-white` | `#f4f4f5` / `#ffffff` | Headings, values |
| Text (secondary) | `text-gray-400` / `text-zinc-400` | `#9ca3af` / `#a1a1aa` | Labels, descriptions |
| Text (muted) | `text-gray-500` / `text-zinc-500` | `#6b7280` / `#71717a` | Hints, timestamps |
| Accent (interactive) | `bg-blue-600/20` / `border-blue-500` | | Active tab indicator |
| Accent (CTA) | `bg-zinc-100` / `text-zinc-900` | `#f4f4f5` / `#18181b` | Primary buttons (light-on-dark) |
| Success | `text-green-500` / `#22c55e` | | Up candles, confirmed state |
| Error | `text-red-500` / `bg-red-900/40` | | Down candles, error banners |

<!-- Note: The steampunk scene was implemented in v1.0 with @theme tokens (brass, copper, aged-paper). The table above documents the base Tailwind classes used in non-themed areas. Steampunk theme tokens are defined in CSS and applied via kit components. -->

### Chart Theme

The `CandlestickChart` uses a custom dark theme:

| Element | Color | Source |
|---------|-------|--------|
| Chart background | `#0a0a0f` | Custom (slightly blue-black) |
| Text/axis labels | `#9ca3af` (gray-400) | Tailwind |
| Grid lines | `#1f2937` (gray-800) | Tailwind |
| Borders | `#374151` (gray-700) | Tailwind |
| Crosshair | `#6b7280` (gray-500) | Tailwind |
| Up candle (body + wick) | `#22c55e` (green-500) | Tailwind |
| Down candle (body + wick) | `#ef4444` (red-500) | Tailwind |

### Typography

No custom fonts configured. Uses Tailwind's default system font stack via `antialiased` body class. Monospace used only for wallet addresses (`font-mono` on `WalletButton`).

### CSS Animations (Planned -- Decision D10)

Pure CSS keyframe animations for ambient factory effects:
- **Bubbling tube**: Gentle up-down translation with opacity cycling on bubble particles.
- **Simmering cauldron**: Slow color shift and subtle scale pulse on steam/vapor overlay.

These will be CSS-only (no JavaScript animation libraries) to minimize bundle size and ensure smooth 60fps.

---

## Responsive Breakpoints

**Decision D9**: Desktop-first design. Mobile is TBD because the landscape steampunk factory scene does not suit portrait orientation.

### Current Implementation Breakpoints

The current dev views use Tailwind's standard responsive prefixes:

| Breakpoint | Tailwind Prefix | Current Usage |
|-----------|----------------|---------------|
| Default (< 768px) | (none) | Single-column layout, full-width cards |
| `md` (768px+) | `md:` | Dashboard grid becomes 2-column (`grid-cols-2`) |
| `lg` (1024px+) | `lg:` | Dashboard grid becomes 3-column (`grid-cols-3`). Swap page: side-by-side swap + staking (`flex-row`) |

### Steampunk Scene Responsive Strategy (Planned)

The interactive factory scene is inherently landscape. Planned approaches for smaller screens:

1. **Tablet landscape**: Scale the scene proportionally, reduce hotspot sizes.
2. **Tablet portrait / phone**: Replace scene with a simplified navigation menu that opens the same modals. The modals themselves are already responsive (max-width cards).
3. **Minimum viable width**: ~768px for full scene experience.

---

## Accessibility

### Current Implementation

| Feature | Status | Details |
|---------|--------|---------|
| `aria-label` on close buttons | IMPLEMENTED | `ConnectModal` close button has `aria-label="Close modal"` |
| Keyboard navigation (Escape to close) | IMPLEMENTED | `ConnectModal` listens for Escape key and closes |
| `title` attributes on buttons | IMPLEMENTED | Flip button has `title="Flip tokens"`, address button has `title="Click to copy full address"` |
| `lang="en"` on `<html>` | IMPLEMENTED | Set in `layout.tsx` |
| `antialiased` font rendering | IMPLEMENTED | Tailwind utility on `<body>` |
| `inputMode="decimal"` on amount inputs | IMPLEMENTED | Mobile keyboards show numeric-only input |

### Planned Improvements (for production scene)

| Feature | Priority | Notes |
|---------|----------|-------|
| Full ARIA roles on hotspots | HIGH | `role="button"`, `aria-haspopup="dialog"`, `aria-expanded` |
| Focus trap in modals | HIGH | Tab cycling stays within open modal |
| `prefers-reduced-motion` | MEDIUM | Disable CSS animations (bubbling tube, cauldron simmer) |
| High contrast mode | LOW | Alternative color tokens for `prefers-contrast: more` |
| Screen reader announcements | MEDIUM | `aria-live="polite"` for transaction status changes |
| Skip-to-content link | MEDIUM | For the scene layout (jump past the factory image to functional content) |

---

## Appendix A: IDL Types (Anchor Program Interfaces)

The frontend includes TypeScript IDL types for all 6 on-chain programs, generated from Anchor builds and synced via `scripts/sync-idl.mjs` at dev/build time:

| IDL | File | Program ID | Purpose |
|-----|------|------------|---------|
| AMM | `app/idl/types/amm.ts` | `5ANTHFtgfmJ83SPDFBwJGSoAVPaP6CcFNPEpSKWZ9aGi` | Pool state, swap instructions |
| Transfer Hook | `app/idl/types/transfer_hook.ts` | `CmNyuLdMeggHS2dKBhzPWHdeTEcpKg4uTevT5tBcBsce` | Transfer hook remaining accounts |
| Tax Program | `app/idl/types/tax_program.ts` | `DRjNCjt4RHWFB4sPNLYHKhFm3Gv36P2SvhHauagn3k3n` | Swap execution with tax |
| Epoch Program | `app/idl/types/epoch_program.ts` | `G6dmJTdCDd8Doj8EvVoXM6gmDf2KS27PpNf7nCCTqv9W` | Epoch state, Carnage, VRF |
| Staking | `app/idl/types/staking.ts` | `EZFeU613oP6hqkF51n9VKmFZjFMVgBGRoZGTGS7Jzbbb` | Stake pool, user stake, rewards |
| Conversion Vault | `app/idl/types/conversion_vault.ts` | `[ConversionVaultProgramId]` | Fixed-rate 100:1 CRIME/FRAUD to PROFIT conversion (replaces former PROFIT AMM pools) |

## Appendix B: Library Layer

| Module | File | Purpose |
|--------|------|---------|
| `connection.ts` | `app/lib/connection.ts` | Singleton `Connection` factory (HTTP + WSS) |
| `anchor.ts` | `app/lib/anchor.ts` | Anchor `Program` factories for all 6 programs |
| `sentry.ts` | `app/lib/sentry.ts` | Zero-dependency error reporter (Turbopack-safe) |
| `jupiter.ts` | `app/lib/jupiter.ts` | SOL/USD price fetch from Jupiter Price API |
| `sse-manager.ts` | `app/lib/sse-manager.ts` | In-process pub/sub for SSE broadcast |
| `event-parser.ts` | `app/lib/event-parser.ts` | Anchor event log parser for webhook pipeline |
| `swap/quote-engine.ts` | `app/lib/swap/quote-engine.ts` | Client-side constant-product AMM quoting (4 functions: forward + reverse for 2 SOL pool types). Vault conversions are deterministic 100:1 fixed rate (no AMM quoting needed). |
| `swap/swap-builders.ts` | `app/lib/swap/swap-builders.ts` | Transaction builders for 2 SOL swap types (SOL buy/sell) plus vault conversion builders |
| `swap/hook-resolver.ts` | `app/lib/swap/hook-resolver.ts` | Transfer Hook remaining_accounts resolution (manual PDA derivation, no spl-token browser dependency) |
| `swap/wsol.ts` | `app/lib/swap/wsol.ts` | WSOL wrap/unwrap helpers for SOL pool swaps |
| `swap/error-map.ts` | `app/lib/swap/error-map.ts` | Anchor error code to human-readable message mapping |
| `staking/staking-builders.ts` | `app/lib/staking/staking-builders.ts` | Transaction builders for stake/unstake/claim |
| `staking/rewards.ts` | `app/lib/staking/rewards.ts` | Client-side reward calculation (BigInt math mirroring on-chain `math.rs`) |
| `staking/error-map.ts` | `app/lib/staking/error-map.ts` | Staking error code mapping |

**Unmapped error codes:** The swap error map covers Tax Program 6000-6013 and AMM 6000-6017. Tax Program errors 6014 (`InvalidAmmProgram`), 6015 (`InvalidStakingProgram`), 6016 (`InsufficientOutput`), and 6017 (`MinimumOutputFloorViolation`) are not yet mapped in `error-map.ts`. Of these, 6017 is user-facing (triggered when slippage tolerance is below the 50% protocol floor) and should be mapped before mainnet. The Epoch Program and Transfer Hook program errors (not user-facing) are intentionally unmapped.

## Appendix C: Database Schema

Four Postgres tables managed by Drizzle ORM (`app/db/schema.ts`):

### `swap_events`
Primary key: `tx_signature` (natural idempotency). Indexes on `pool`, `epoch_number`, `timestamp`, `user_wallet`. Stores direction, SOL amount, token amount, price, tax, LP fee, user wallet, epoch.

### `candles`
Auto-incrementing ID. Unique composite index on `(pool, resolution, open_time)`. Stores OHLCV data at 6 resolutions (1m, 5m, 15m, 1h, 4h, 1d) for all 2 SOL pools. Gap-filled at query time (not stored). (The former CRIME/PROFIT and FRAUD/PROFIT pool candles are no longer generated since those AMM pools were replaced by the Conversion Vault.)

### `epoch_events`
Auto-incrementing ID. Unique on `epoch_number`. Stores tax rates, cheap side, staking reward deposited, Carnage fund balance per epoch transition.

### `carnage_events`
Auto-incrementing ID. Unique on `epoch_number`. Stores CRIME/FRAUD burned, SOL used, tokens bought, Carnage action path (BuyOnly/Burn/Sell) -- matches on-chain `CarnageAction` enum (None=BuyOnly, Burn, Sell), target token.

## Appendix D: Content Security Policy

The full CSP is defined in `app/next.config.ts` and applies to all routes:

| Directive | Allowed Sources | Reason |
|-----------|----------------|--------|
| `default-src` | `'self'` | Default deny |
| `script-src` | `'self' 'unsafe-inline'` | Next.js inline scripts |
| `style-src` | `'self' 'unsafe-inline'` | Tailwind + Next.js style injection |
| `img-src` | `'self' data: blob:` | Local images, data URIs, blob URLs |
| `child-src` / `frame-src` | `verify.walletconnect.com/org` | WalletConnect verify |
| `connect-src` | WalletConnect, Helius (HTTP+WSS), Sentry (`*.ingest.sentry.io` AND `*.ingest.us.sentry.io`), Jupiter Price API | RPC, telemetry, price data |
| `frame-ancestors` | `'none'` | Prevent clickjacking |

Additional security headers: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
