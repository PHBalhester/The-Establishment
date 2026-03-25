# Domain Pitfalls: Solana DeFi Frontend Tech Foundations

**Domain:** DeFi frontend for existing Solana on-chain protocol (5 programs, Token-2022, VRF, Transfer Hooks)
**Researched:** 2026-02-15
**Confidence:** MEDIUM-HIGH (based on project codebase analysis + training data; WebSearch/WebFetch unavailable for verification of external library versions)

**Note on sources:** WebSearch and WebFetch were unavailable during this research session. All claims about external libraries (Privy, Helius, TradingView, Railway) are based on training data (cutoff ~May 2025) and are marked with confidence levels accordingly. Claims about this project's specific architecture are HIGH confidence (verified from codebase). All external library claims should be validated against current documentation before implementation begins.

---

## Critical Pitfalls

Mistakes that cause security vulnerabilities, broken user transactions, or require architectural rewrites.

---

### PITFALL-01: VersionedTransaction v0 Requires skipPreflight on Devnet -- But Frontend Must NOT Blindly Trust Confirmation

**Severity:** CRITICAL
**Phase to address:** Swap execution (Phase 1-2)

**What goes wrong:** The project already knows that devnet simulation rejects v0 transactions with "Blockhash not found" (documented in MEMORY.md). The existing workaround in `alt-helper.ts` uses `skipPreflight: true`. The danger is that with `skipPreflight: true`, **failed transactions are still "confirmed" on Solana**. If the frontend only checks for confirmation without inspecting `confirmation.value.err`, users will see "Transaction confirmed!" for transactions that actually failed on-chain.

**Why it happens:** Solana's confirmation endpoint returns success when the transaction lands in a block, regardless of whether the program executed successfully. With preflight disabled, there is no simulation to catch errors before submission. The frontend developer sees "confirmed" and assumes success.

**Warning signs:**
- Users report "successful" swaps but token balances do not change
- Transaction explorer shows the TX as "failed" but the UI said "success"
- No error feedback to users for on-chain program errors

**Prevention:**
1. The project already has the correct pattern in `alt-helper.ts:sendV0Transaction()` lines 385-409 -- it checks `confirmation.value.err` after confirmation. Port this pattern exactly to the frontend transaction layer.
2. After checking `confirmation.value.err`, fetch transaction logs via `getTransaction()` for error details.
3. Parse program error codes into human-readable messages (the protocol has documented error codes across all 5 programs).
4. Consider using `simulateTransaction` separately before sending (even though preflight is skipped) to give users a preview.

**Detection:** Add a test that sends a deliberately invalid transaction (e.g., with zero slippage to a moved pool) and verify the frontend correctly shows an error.

**Confidence:** HIGH -- verified from existing codebase pattern in `alt-helper.ts`.

---

### PITFALL-02: Transfer Hook Remaining Accounts Must Be Resolved Per-Transfer Direction

**Severity:** CRITICAL
**Phase to address:** Swap UI (Phase 1-2)

**What goes wrong:** Every CRIME/FRAUD/PROFIT token transfer requires 4 extra accounts per mint: ExtraAccountMetaList, whitelist PDA for source, whitelist PDA for destination, and the hook program. The frontend must resolve these accounts **dynamically per transaction** because the source and destination change depending on:
- Buy vs sell direction
- Which pool (CRIME/SOL, FRAUD/SOL, CRIME/PROFIT, FRAUD/PROFIT)
- Which user token account is involved

If the frontend caches hook accounts from one direction and reuses them for another, the whitelist PDAs will be wrong and the transaction will fail with a whitelist violation.

**Why it happens:** The whitelist PDA seeds are `["whitelist", token_account_pubkey]`. Different transfer directions have different source/destination accounts, producing different whitelist PDAs. A developer who resolves hook accounts once at page load and reuses them will get failures when the user switches direction.

**Warning signs:**
- "NoWhitelistedParty" errors on some swaps but not others
- Buy works but sell fails (or vice versa)
- Swaps work on one pool but fail on another

**Prevention:**
1. Port the `resolveHookAccounts()` function from `swap-flow.ts` (lines 132-159) to the frontend. It uses `createTransferCheckedWithTransferHookInstruction` to build a dummy instruction, then extracts the 4 extra accounts (`.keys.slice(4)`).
2. Call this resolver **every time** a swap instruction is built, passing the correct source/dest for the specific transfer direction.
3. Do NOT cache hook accounts across different swap directions or pools.
4. The existing code comments explain why `slice(4)` -- first 4 keys are source, mint, dest, authority.

**Detection:** Test all 10 swap permutations: 4 pools x buy/sell + exempt.

**Confidence:** HIGH -- verified from existing `swap-flow.ts` and `carnage-flow.ts` patterns.

---

### PITFALL-03: Sell Path Requires Address Lookup Table -- Legacy Transactions Will Fail

**Severity:** CRITICAL
**Phase to address:** Swap UI (Phase 1-2)

**What goes wrong:** The sell path on SOL pools requires 23+ named accounts plus 4-8 remaining accounts (Transfer Hook). This exceeds Solana's 1,232-byte legacy transaction limit. The transaction must use VersionedTransaction v0 with the protocol's Address Lookup Table (ALT). If the frontend tries to send sell transactions as legacy transactions, they will fail with a serialization error ("Transaction too large").

**Why it happens:** Each account reference is 32 bytes. At 31+ accounts, the transaction exceeds the byte limit before even adding instruction data. The project already solved this with the protocol-wide ALT (46 addresses, cached at `scripts/deploy/alt-address.json`).

**Warning signs:**
- Buy swaps work (fewer accounts) but sell swaps fail
- "Transaction too large" or serialization errors
- Works in testing with fewer accounts but fails with full hook remaining_accounts

**Prevention:**
1. **Always use VersionedTransaction v0 for ALL protocol transactions** (not just sells). This provides consistency and avoids the need to dynamically choose between legacy and versioned.
2. Load the protocol ALT at frontend initialization: `connection.getAddressLookupTable(new PublicKey("EyUncwUhSwCVyTnbeoKe7Ug33sUDGAQDLDBQ5fVP9Vuf"))`.
3. Use `TransactionMessage.compileToV0Message([alt])` for all instruction compilation.
4. Store the ALT address in frontend environment config (different per cluster: devnet vs mainnet).

**Detection:** Test the sell path specifically. If buy works but sell fails, this is likely the issue.

**Confidence:** HIGH -- verified from ALT helper and MEMORY.md documentation.

---

### PITFALL-04: Privy Embedded Wallets vs Standard Wallet Adapters -- Two Signing Interfaces

**Severity:** CRITICAL
**Phase to address:** Wallet connection (Phase 1)

**What goes wrong:** The project wants to support both Privy embedded wallets (for social login) AND standard Solana wallet extensions (Phantom, Solflare, Backpack). These are fundamentally different signing interfaces:

- **Standard wallets** use the `@solana/wallet-adapter` interface: `wallet.signTransaction(transaction)`
- **Privy embedded wallets** use Privy's SDK: `privy.sendTransaction(...)` or `privy.signTransaction(...)`

If the frontend builds a single transaction submission path assuming one interface, users on the other will get signing failures or the transaction will be sent without proper signing.

**Why it happens:** Privy embeds a wallet inside an iframe/webview and manages key material server-side (via MPC or enclave). It does not expose a standard `Signer` or `WalletAdapter` interface by default. The developer must explicitly bridge between the two interfaces or use Privy's built-in wallet adapter wrapper.

**Warning signs:**
- Privy users can connect but transactions fail to sign
- Standard wallet users get errors about missing Privy context
- Transaction signature count mismatches
- "Wallet not connected" errors despite visible connection

**Prevention:**
1. Use Privy's Solana wallet adapter integration. Privy provides a wrapper that makes its embedded wallet appear as a standard wallet adapter. Verify this is available in the current Privy SDK version (MEDIUM confidence -- verify against current docs).
2. Alternatively, build an abstraction layer: `signAndSend(transaction)` that internally detects whether the active wallet is Privy-managed or standard, and routes accordingly.
3. Test BOTH wallet types for every transaction type (buy, sell, stake, unstake, claim).
4. Handle the case where Privy is still initializing (async) when the user tries to transact.
5. Handle the case where the user has BOTH a Privy wallet and a browser extension connected simultaneously.

**Detection:** Create a test matrix: [Privy, Phantom, Solflare, Backpack] x [buy, sell, stake, unstake, claim].

**Confidence:** MEDIUM -- Privy's Solana integration specifics are from training data. Verify against current Privy documentation.

---

### PITFALL-05: DeFi Frontend Phishing and Transaction Spoofing

**Severity:** CRITICAL
**Phase to address:** Security hardening (entire project)

**What goes wrong:** DeFi frontends are high-value phishing targets. The Helius security research (already in project knowledge base) documents incidents including:
- **Parcl Front-End DNS hijacking (Aug 2024):** Attacker hijacked DNS to serve a malicious frontend that drained wallets.
- **Web3.js Supply Chain attack (Dec 2024):** Malicious npm package (`@solana/web3.js` versions 1.95.6-1.95.7) contained a backdoor that exfiltrated private keys.
- **Slope Wallet (Aug 2022):** Private keys logged to analytics service (Sentry).

The Dr. Fraudsworth frontend is a direct money-handling interface. A compromised frontend could:
- Replace transaction instructions with draining instructions
- Harvest private keys from Privy or extension interactions
- Display incorrect token amounts to trick users into bad trades
- Modify slippage settings to enable sandwich attacks

**Why it happens:** Frontend code runs in the user's browser. The supply chain (npm packages) is enormous and partially untrusted. DNS/CDN can be hijacked. Analytics tools can accidentally log sensitive data.

**Warning signs:**
- Unexpected dependencies in `node_modules`
- Network requests to unknown domains
- Users reporting unexpected token transfers
- Analytics capturing wallet addresses or transaction data

**Prevention:**
1. **Lock `@solana/web3.js` to an exact, verified version.** Never use `^` or `~` for security-critical Solana packages. Audit package-lock.json.
2. **Enable Subresource Integrity (SRI)** on all script tags if using CDN.
3. **Content Security Policy (CSP)** headers: restrict script sources, disable inline scripts, limit connect-src to known RPC endpoints.
4. **Transaction simulation display:** Before signing, show the user what the transaction will do (accounts affected, token amounts, programs invoked). This is the DeFi equivalent of a "transaction preview."
5. **Never log wallet addresses or transaction data to analytics.** Configure analytics to exclude URL parameters and request bodies.
6. **Pin all npm dependencies to exact versions** in `package-lock.json`. Run `npm audit` in CI.
7. **Domain security:** DNSSEC, registrar lock, 2FA on DNS management.
8. Use Privy's transaction simulation feature if available to show users what they are approving.

**Detection:** Regular dependency audits. CSP violation reports. Monitor for unauthorized DNS changes.

**Confidence:** HIGH -- based on documented incidents in project's own security research files.

---

### PITFALL-06: Tax Rates Change Every Epoch -- Frontend Shows Stale Rates

**Severity:** HIGH
**Phase to address:** Real-time data display (Phase 2-3)

**What goes wrong:** Tax rates in this protocol change every 30 minutes (750 slots) when VRF produces new randomness. The cheap side can flip (75% probability), and tax magnitudes resample. If the frontend displays tax rates from a cached/stale EpochState, users will see one tax rate but execute at a different one. This creates user trust issues and potential slippage surprises.

Worse: during the ~10-30 second VRF resolution window (commit -> reveal), the epoch is transitioning and the new rates are not yet known. If a user submits a swap during this window, they get the old rates (or potentially fail if the epoch state is mid-transition).

**Why it happens:** The frontend fetches EpochState once and displays it. Without real-time subscription to EpochState changes, the display becomes stale after each epoch transition.

**Warning signs:**
- User sees "4% tax" but gets charged 14%
- Complaints about unexpected tax amounts
- Slippage failures right after epoch transitions

**Prevention:**
1. **Subscribe to EpochState account changes** via WebSocket (`connection.onAccountChange`). When EpochState updates, immediately refresh the displayed tax rates.
2. **Show an "epoch transition in progress" indicator** when `vrf_pending = true` in EpochState. During this window, warn users that rates may change.
3. **Include a "rates as of epoch X" label** on the swap UI with a countdown timer to next epoch.
4. **Use realistic slippage defaults** that account for tax rate uncertainty: suggest higher slippage near epoch boundaries.
5. **Pre-compute the worst-case tax** (14% high band) and show it as a range: "Tax: 4% (current) -- could be up to 14% if epoch transitions."

**Detection:** Monitor user complaints about unexpected tax amounts. Log the epoch number at transaction submission vs execution.

**Confidence:** HIGH -- verified from EpochState structure and VRF flow documentation.

---

### PITFALL-07: Privy Embedded Wallet Cannot Sign VersionedTransactions

**Severity:** HIGH (potentially CRITICAL -- needs validation)
**Phase to address:** Wallet integration (Phase 1)

**What goes wrong:** Privy's embedded Solana wallet may not support `VersionedTransaction` (v0 with Address Lookup Tables). If Privy only supports legacy `Transaction` objects, users with Privy wallets cannot execute sell swaps or any transaction that requires the ALT (which is all protocol transactions per PITFALL-03 recommendation).

**Why it happens:** Privy's embedded wallet runs in a controlled environment (iframe/MPC). The signing interface may only accept serialized legacy transactions. VersionedTransaction support requires explicit SDK support for the v0 message format.

**Warning signs:**
- Privy wallet connects successfully but ALL transactions fail
- "Unsupported transaction version" or serialization errors from Privy
- Standard wallets work fine, only Privy users affected

**Prevention:**
1. **Verify VersionedTransaction support in Privy's current SDK** before committing to this architecture. This is the single most important validation for wallet integration.
2. If Privy does NOT support v0 transactions: consider using legacy transactions for simple operations (buy on smaller accounts) and only use v0 for the sell path, with a warning that Privy users may have limited functionality.
3. If Privy DOES support v0: test with the actual protocol ALT to confirm the lookup resolution works through Privy's signing flow.
4. Alternative: Use Privy's `sendTransaction` method (which handles serialization internally) instead of `signTransaction` + manual submission.

**Detection:** Build a minimal test: connect Privy wallet, build a v0 transaction with ALT, attempt to sign and send.

**Confidence:** LOW-MEDIUM -- Privy's v0 transaction support status is unknown (training data may be outdated). THIS MUST BE VALIDATED BEFORE ARCHITECTURE DECISIONS.

---

## High Pitfalls

Mistakes that cause significant UX degradation, data integrity issues, or multi-day delays.

---

### PITFALL-08: WebSocket Connection Management -- Subscription Leaks and Stale Data

**Severity:** HIGH
**Phase to address:** Real-time data (Phase 2-3)

**What goes wrong:** The frontend needs WebSocket subscriptions to:
- EpochState (tax rates, epoch number, carnage status)
- Pool accounts (token balances for price calculation)
- User token accounts (balance display)
- Potentially Helius websockets for event streaming

Each `connection.onAccountChange()` returns a subscription ID that MUST be cleaned up. In a React app with component mounting/unmounting, subscription leaks cause:
- Memory leaks (hundreds of stale subscriptions)
- RPC rate limit exhaustion (each subscription counts against the limit)
- Stale data display (old subscription callbacks updating unmounted component state)
- WebSocket connection failures when subscription count exceeds provider limits

**Why it happens:** React's useEffect cleanup is easy to get wrong. Hot module replacement during development creates extra subscriptions. Navigation between pages unmounts components but stale subscriptions fire.

**Warning signs:**
- WebSocket disconnections increase over time
- Memory usage grows unbounded
- RPC provider returns 429 (rate limit) errors
- Console warnings about state updates on unmounted components

**Prevention:**
1. **Centralize WebSocket subscriptions** in a single manager (not per-component). Use a React context or Zustand store that owns all subscriptions.
2. **Use AbortController pattern** for cleanup: each subscription gets an AbortController, and cleanup calls `controller.abort()`.
3. **Implement reconnection logic** with exponential backoff for WebSocket drops.
4. **Rate-limit subscription creation:** Deduplicate subscriptions for the same account across components.
5. **Use the Solana web3.js `onAccountChange` return value** to `removeAccountChangeListener()` in cleanup.
6. Consider using Helius's enhanced WebSocket API (DAS) if the standard RPC WebSocket is unreliable.

**Detection:** Monitor active subscription count in development. Log subscription creation/cleanup.

**Confidence:** HIGH -- standard React + WebSocket pattern.

---

### PITFALL-09: Helius Webhook Missed Events and Idempotency

**Severity:** HIGH
**Phase to address:** Historical data indexer (Phase 3-4)

**What goes wrong:** The project plans to use Helius webhooks to index swap events for OHLCV chart data. Helius webhooks have known reliability concerns:
- **Missed events:** Webhooks can miss events during Helius service disruptions, RPC node issues, or webhook endpoint downtime.
- **Duplicate events:** Webhooks may deliver the same event multiple times (at-least-once delivery).
- **Out-of-order delivery:** Events may arrive in a different order than they occurred on-chain.
- **Endpoint failures:** If the webhook endpoint (Railway) returns a non-200 status, Helius may retry (with duplicates) or eventually drop the event.

If the OHLCV data pipeline assumes exactly-once, in-order delivery, the chart data will have gaps or duplicate candles.

**Why it happens:** Webhooks are inherently unreliable (network partitions, service restarts). Helius is a third-party service with its own uptime guarantees. The webhook endpoint (Railway deployment) may also have cold-start latency or downtime.

**Warning signs:**
- Gaps in OHLCV data (missing candles)
- Duplicate candles or inflated volume
- Chart shows no data for recent time periods
- Webhook health dashboard shows delivery failures

**Prevention:**
1. **Design for at-least-once delivery:** Every webhook handler must be idempotent. Use the transaction signature as a unique key in Postgres. ON CONFLICT DO NOTHING.
2. **Implement a gap detector:** Periodically scan for missing data by comparing expected epoch transitions/swap frequency against actual records. Backfill gaps via direct RPC queries.
3. **Store raw webhook payloads** before processing. This allows replay/reprocessing if the parsing logic changes.
4. **Health monitoring:** Track webhook delivery rate. Alert if no events received for X minutes (expect at least epoch transitions every 30 minutes).
5. **Backfill mechanism:** Have a cron job that uses `getSignaturesForAddress` + `getParsedTransaction` to backfill any gaps in the OHLCV data.
6. **Do not rely solely on webhooks for critical data.** Use webhooks as the fast path, with periodic RPC-based reconciliation as the reliable path.

**Detection:** Compare webhook-received event count against on-chain transaction count for the protocol programs.

**Confidence:** MEDIUM -- Helius webhook behavior from training data. Verify current Helius webhook guarantees and retry policies.

---

### PITFALL-10: Next.js SSR + Solana Wallet Adapter Hydration Mismatch

**Severity:** HIGH
**Phase to address:** Frontend scaffolding (Phase 1)

**What goes wrong:** Next.js renders pages on the server (SSR/SSG) before hydrating on the client. Solana wallet state (connected wallet, public key, balance) only exists on the client side (browser). If server-rendered HTML includes wallet-dependent content, it will NOT match the client-side render, causing React hydration errors:
- "Text content did not match" warnings
- UI flicker (server shows "Connect Wallet", client shows "8kPz...MH4")
- Component tree mismatch causing layout shifts

This affects EVERY component that displays wallet address, balance, token amounts, or conditional UI based on connection state.

**Why it happens:** The server has no access to the browser wallet extension. On the server, `wallet.connected === false` and `wallet.publicKey === null`. On the client, after hydration, the wallet auto-connects and these values change, causing a mismatch.

**Warning signs:**
- React hydration warnings in console
- Flash of "Connect Wallet" before showing connected state
- Layout shifts on page load
- Conditional rendering based on wallet state causes flickering

**Prevention:**
1. **Mark ALL wallet-dependent components as `'use client'`** and do NOT render wallet state during SSR.
2. **Use a mounted state pattern:**
   ```tsx
   const [mounted, setMounted] = useState(false);
   useEffect(() => setMounted(true), []);
   if (!mounted) return <Skeleton />;
   // Now safe to render wallet-dependent content
   ```
3. **Use `dynamic(() => import(...), { ssr: false })` for wallet-dependent page sections.**
4. **The SolanaProvider must be a client component.** Use the pattern from `frontend-framework-kit.md` (already in project knowledge base).
5. **Minimize the "use client" boundary.** Keep data-fetching and layout in server components. Only leaf components that touch wallet state need to be client components.

**Detection:** Load the page with JavaScript disabled. The server-rendered version should show a clean loading/skeleton state, not wallet-dependent content.

**Confidence:** HIGH -- well-documented Next.js + Web3 pattern.

---

### PITFALL-11: Compute Budget and Priority Fees Not Set Correctly on Frontend

**Severity:** HIGH
**Phase to address:** Transaction building (Phase 1-2)

**What goes wrong:** The project has measured exact CU requirements for each instruction type (documented in `Docs/Compute_Budget_Profile.md`). If the frontend does not set `ComputeBudgetProgram.setComputeUnitLimit()` and `ComputeBudgetProgram.setComputeUnitPrice()`:
- **Without CU limit:** Default 200,000 CU is used. This is sufficient for all current paths, BUT priority fees are calculated per CU requested, not CU consumed. So the user overpays on priority fees.
- **Without priority fee:** Transactions may be deprioritized during network congestion, causing timeouts and "blockhash expired" errors.
- **CU limit too low:** Transaction fails with `ComputationalBudgetExceeded`.

**Why it happens:** Frontend developers often skip compute budget instructions because transactions "work" without them in testing. The consequences only appear under real network conditions.

**Warning signs:**
- Transactions succeed in testing but timeout on mainnet during congestion
- Users overpaying on priority fees (paying for 200k CU when only 120k needed)
- Intermittent "ComputationalBudgetExceeded" errors for FRAUD swaps (higher CU)

**Prevention:**
1. **Use the exact CU recommendations from Compute_Budget_Profile.md:**
   - CRIME buy/sell: 120,000 CU
   - FRAUD buy/sell: 150,000 CU
   - PROFIT buy/sell: 115,000 CU
   - Carnage atomic: 130,000 CU
   - Staking operations: TBD (measure on devnet)
2. **Always include both `setComputeUnitLimit` and `setComputeUnitPrice`** in every transaction.
3. **Fetch dynamic priority fees** from RPC: use `getRecentPrioritizationFees` to determine appropriate micro-lamport price. Show this to the user as an estimated fee.
4. **Detect the token being swapped** (CRIME vs FRAUD) and use the appropriate CU limit.

**Detection:** Monitor transaction CU consumption vs requested limit. Alert if any transaction is within 90% of its limit.

**Confidence:** HIGH -- CU measurements verified from `Docs/Compute_Budget_Profile.md`.

---

### PITFALL-12: TradingView Lightweight Charts Library Versioning and Data Format

**Severity:** HIGH
**Phase to address:** Chart integration (Phase 3-4)

**What goes wrong:** TradingView's charting libraries come in two forms:
1. **TradingView Advanced Charts (tradingview.com widget):** Full-featured but requires a TradingView account, API key, and potentially licensing fees. Heavy iframe-based.
2. **Lightweight Charts (lightweight-charts npm):** Open-source, self-hosted, no API key needed. But requires you to provide your own data feed.

If the project chooses Lightweight Charts (more likely for a crypto project), the pitfalls are:
- **Data format mismatch:** Lightweight Charts expects `{ time, open, high, low, close, [volume] }` with `time` as a Unix timestamp in seconds (not milliseconds). Using milliseconds produces charts starting in year 50000+.
- **Real-time updates:** Must call `series.update(bar)` for live candle updates. If you accidentally call `series.setData()` on every update, the chart flickers and performance degrades.
- **Time zone handling:** Charts display in local timezone by default. Solana slot times are UTC. Mismatch causes confusing timestamp display.
- **React integration:** The chart container must be managed via refs, not state. Re-rendering the chart component on every data update is catastrophically slow.

**Why it happens:** The library is well-documented but the data format is strict. Developers coming from web2 charting (Chart.js, D3) expect different conventions.

**Warning signs:**
- Charts show dates in the year 50000 (millisecond timestamps)
- Charts flicker or lag during real-time updates
- Candles appear at wrong times (timezone mismatch)
- Browser memory usage spikes when chart is visible

**Prevention:**
1. **Use Unix timestamps in seconds** for all chart data. Convert from Solana slot timestamps: `Math.floor(blockTime)` (already in seconds from `getBlockTime`).
2. **Separate initial data load from real-time updates.** Call `setData()` once on mount with historical OHLCV, then `update()` for each new bar.
3. **Use a React ref for the chart container** and manage the chart instance imperatively, not via React state/re-renders.
4. **Configure timezone explicitly:** `chart.applyOptions({ timeScale: { timeVisible: true, secondsVisible: false } })`.
5. **Build the OHLCV aggregation in the backend (Postgres)** not the frontend. The backend aggregates raw swap events into candle data; the frontend just displays it.

**Detection:** Test with known timestamps and verify the chart shows the correct dates.

**Confidence:** MEDIUM -- Lightweight Charts API from training data. Verify current API version.

---

### PITFALL-13: Railway Cold Starts and Postgres Connection Pooling

**Severity:** HIGH
**Phase to address:** Backend deployment (Phase 3-4)

**What goes wrong:** Railway is a PaaS that can scale down idle services (cold start). When the webhook indexer receives an event after idle period:
- **Cold start delay:** 5-30 seconds for the service to wake up. During this time, Helius retries or drops the webhook.
- **Database connection storm:** After cold start, all pending requests try to connect to Postgres simultaneously, exceeding connection limits.
- **Connection timeout:** Railway's Postgres may have connection limits (e.g., 20 connections on starter plans). A Node.js server without connection pooling opens a new connection per request.

**Why it happens:** Railway scales to zero by default for cost efficiency. The webhook receiver is not constantly active (events arrive in bursts around epoch transitions and swaps).

**Warning signs:**
- Webhook events missed during low-activity periods
- "Connection refused" or "too many connections" Postgres errors
- Webhook health checks fail intermittently
- Data gaps correlating with idle periods

**Prevention:**
1. **Keep the webhook receiver service always-on.** Railway allows disabling scale-to-zero. The cost for a small Node.js service is minimal (~$5/month).
2. **Use a connection pooler.** Use PgBouncer or Railway's built-in connection pooling if available. Alternatively, use a library like `pg-pool` with max connection limit set well below Postgres's limit.
3. **Implement a health check endpoint** that Railway pings to keep the service warm.
4. **Set webhook retry configuration in Helius** to allow enough time for cold start recovery.
5. **Use connection pool settings:** `max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000`.

**Detection:** Monitor Railway service logs for cold start events. Track time between webhook receipt and database write.

**Confidence:** MEDIUM -- Railway behavior from training data. Verify current Railway scaling policies.

---

## Moderate Pitfalls

Mistakes that cause delays, poor UX, or technical debt but are recoverable.

---

### PITFALL-14: Carnage Events -- Frontend Must Handle Sudden Price Movements

**Severity:** MEDIUM
**Phase to address:** Real-time data (Phase 2-3)

**What goes wrong:** Carnage events dump the entire Carnage Fund SOL balance into a market buy of CRIME or FRAUD. This causes:
- Massive price spike in the target token
- Pool ratio dramatically shifts
- Subsequent user swaps may fail due to extreme slippage
- If the frontend auto-refreshes price after Carnage but BEFORE the user adjusts slippage, the user may submit a swap at a terrible price

**Prevention:**
1. **Subscribe to CarnageFundState** account changes. When `carnage_pending = true`, display a prominent "Carnage Imminent" warning.
2. **After Carnage execution**, immediately refresh pool prices and display a "Carnage just occurred -- prices have changed significantly" alert.
3. **Increase default slippage tolerance** during and after Carnage events (e.g., suggest 5-10% instead of 1-2%).
4. **Display Carnage history** -- show when the last Carnage occurred and what happened (buy/burn/sell, which token, amount).

**Confidence:** HIGH -- verified from Carnage Fund spec and EpochState structure.

---

### PITFALL-15: Staking with PROFIT Token-2022 Requires Hook Account Resolution

**Severity:** MEDIUM
**Phase to address:** Staking UI (Phase 2)

**What goes wrong:** PROFIT is a Token-2022 token with a Transfer Hook. Staking (transferring PROFIT to the stake vault) and unstaking (transferring back) both require the hook remaining accounts. If the staking UI builds transactions without hook accounts, the Token-2022 runtime will reject the transfer.

This is the same issue as PITFALL-02 but specifically for staking, where developers might forget that PROFIT also has a transfer hook (since staking feels like a "simple transfer").

**Prevention:**
1. Use `resolveHookAccounts()` for every PROFIT transfer in the staking flow.
2. The stake vault address is in the PDA manifest (`manifest.pdas.StakeVault`).
3. Source is the user's PROFIT token account; destination is the stake vault (for staking) or reverse (for unstaking).

**Confidence:** HIGH -- verified from Transfer Hook spec and staking program.

---

### PITFALL-16: RPC Rate Limiting -- Helius Free Tier and Public Endpoints

**Severity:** MEDIUM
**Phase to address:** RPC configuration (Phase 1)

**What goes wrong:** The frontend needs high-frequency RPC calls for:
- Real-time price display (polling or subscription)
- Transaction submission and confirmation
- Account balance queries
- Hook account resolution per swap

Public Solana RPC endpoints have aggressive rate limits (10-100 req/s). Helius free tier also has limits. If the frontend makes too many concurrent requests (e.g., resolving hook accounts + fetching balances + polling prices), it hits rate limits and the UX degrades to constant loading spinners and failed requests.

**Prevention:**
1. **Use Helius or another dedicated RPC provider** with a plan appropriate for the expected load. The Helius free tier (50 req/s) may be sufficient for devnet testing but not mainnet.
2. **Batch RPC calls** using `getMultipleAccountsInfo` instead of individual `getAccountInfo` calls.
3. **Cache aggressively** on the frontend: EpochState changes once per 30 minutes (epoch), pool prices change per-swap, user balances change per-swap.
4. **Debounce user-triggered refreshes** (e.g., "refresh balance" button with 5s cooldown).
5. **Use WebSocket subscriptions** instead of polling for frequently-changing data.
6. **Existing pattern:** The project already uses `RPC_DELAY_MS = 200` between calls in test scripts. The frontend should implement similar rate-limiting.

**Confidence:** HIGH -- standard Solana RPC pattern.

---

### PITFALL-17: Blockhash Expiry and Transaction Retry Logic

**Severity:** MEDIUM
**Phase to address:** Transaction building (Phase 1-2)

**What goes wrong:** Solana transactions include a recent blockhash that expires after ~60 seconds (~150 slots). If the user takes time to review and sign a transaction (especially with hardware wallets or Privy's MPC flow), the blockhash may expire before submission. The transaction silently fails or returns "Blockhash not found."

**Prevention:**
1. **Fetch blockhash AFTER user confirms the swap parameters, not when the page loads.**
2. **Implement automatic retry with fresh blockhash:** If submission fails with `BlockhashNotFound` or `TransactionExpiredBlockheightExceededError`, refetch blockhash and retry (up to 3 times).
3. **Show a "Transaction expired -- retrying" message** instead of a generic error.
4. **Use `getLatestBlockhash("confirmed")` and track `lastValidBlockHeight`** for proper expiry detection.
5. The existing `isTransientError()` function in `swap-flow.ts` already handles `BlockhashNotFound` and `TransactionExpiredBlockheightExceededError` -- port this to the frontend.

**Confidence:** HIGH -- standard Solana pattern, verified from existing project code.

---

### PITFALL-18: Pool Price Calculation Must Match On-Chain AMM Math Exactly

**Severity:** MEDIUM
**Phase to address:** Price display (Phase 2)

**What goes wrong:** The frontend needs to display swap output amounts ("You will receive ~X CRIME"). This requires replicating the AMM's constant-product math including:
- LP fee deduction (100 bps for SOL pools, 50 bps for PROFIT pools)
- Tax deduction (variable, from EpochState)
- Integer division truncation (Solana uses u64 math, not floating point)

If the frontend uses floating-point JavaScript math, the displayed amount will differ from the actual on-chain output. Small rounding differences cause slippage failures when users set tight slippage tolerances.

**Prevention:**
1. **Use BigInt or BN.js for all token math** in the frontend. Do NOT use JavaScript `Number` for token amounts.
2. **Replicate the exact on-chain formula:**
   ```
   fee = amount_in * fee_bps / 10000
   amount_after_fee = amount_in - fee
   tax = amount_after_fee * tax_bps / 10000  // for SOL pools
   amount_after_tax = amount_after_fee - tax
   output = (reserve_out * amount_after_tax) / (reserve_in + amount_after_tax)
   ```
3. **Always show "approximately" or "minimum" with the calculated output.** Never display an exact number that might differ from on-chain execution.
4. **Suggest slippage of 1-2%** for normal conditions, higher near epoch transitions.

**Confidence:** HIGH -- verified from AMM implementation and Tax Program logic.

---

### PITFALL-19: Environment Variable Exposure in Next.js

**Severity:** MEDIUM
**Phase to address:** Project setup (Phase 1)

**What goes wrong:** Next.js has two types of environment variables:
- `NEXT_PUBLIC_*`: Included in the client bundle, visible to everyone
- Everything else: Server-only, not exposed to the browser

If the developer puts sensitive values (Helius API key, Postgres connection string, webhook secret) in `NEXT_PUBLIC_*` variables, they are exposed in the browser bundle and can be extracted by anyone.

**Prevention:**
1. **RPC endpoint (public):** `NEXT_PUBLIC_SOLANA_RPC_URL` -- OK to expose (users can see it in network requests anyway)
2. **Helius API key:** `HELIUS_API_KEY` -- server-only, used in API routes for webhook verification
3. **Postgres connection string:** `DATABASE_URL` -- server-only, never exposed to client
4. **Webhook secret:** `WEBHOOK_SECRET` -- server-only, for verifying Helius webhook signatures
5. **Privy App ID (public):** `NEXT_PUBLIC_PRIVY_APP_ID` -- OK to expose
6. **Privy App Secret:** `PRIVY_APP_SECRET` -- server-only if applicable
7. **Audit the Next.js build output** to verify no secrets appear in the client bundle.

**Confidence:** HIGH -- well-documented Next.js pattern.

---

### PITFALL-20: Solana web3.js Version 1.x vs 2.x API Incompatibility

**Severity:** MEDIUM
**Phase to address:** Project setup (Phase 1)

**What goes wrong:** The Solana JavaScript ecosystem is in the middle of a major version transition:
- **@solana/web3.js 1.x** (legacy): What the existing scripts use. Mature, widely used.
- **@solana/web3.js 2.x / @solana/kit** (new): Modular, tree-shakeable, different API.

The project's existing scripts (`alt-helper.ts`, `swap-flow.ts`, etc.) all use web3.js 1.x APIs. The `frontend-framework-kit.md` skill file references the new `@solana/client` / `@solana/react-hooks` ecosystem.

If the frontend uses 2.x and tries to share code with the existing 1.x scripts, there will be type incompatibilities (different `PublicKey`, `Transaction`, `Connection` types).

**Prevention:**
1. **Make a conscious decision early:** Use web3.js 1.x (proven, matches existing code) OR 2.x (newer, better tree-shaking). Do NOT mix.
2. **If using 1.x:** Can directly port patterns from `alt-helper.ts`, `swap-flow.ts`. Lower risk but larger bundle.
3. **If using 2.x:** Must rewrite all transaction building logic. Verify that `@solana/wallet-adapter` and Privy SDK are compatible with 2.x.
4. **Recommendation:** Start with 1.x for consistency with existing tested code. Migrate to 2.x later when the ecosystem stabilizes.

**Confidence:** MEDIUM -- web3.js version landscape from training data. Verify current state of 2.x ecosystem.

---

## Minor Pitfalls

Mistakes that cause annoyance but are easily fixable.

---

### PITFALL-21: Token Decimal Display -- All Protocol Tokens Use 6 Decimals

**Severity:** LOW
**Phase to address:** UI implementation

**What goes wrong:** All three protocol tokens (CRIME, FRAUD, PROFIT) and SOL/WSOL use 6 decimals. But if a developer hardcodes 9 (SOL's native lamport decimals for display), or forgets to divide by 10^6, amounts will display incorrectly (e.g., "1,000,000 CRIME" instead of "1.0 CRIME").

**Prevention:** Define a constant `TOKEN_DECIMALS = 6` (already used in `swap-flow.ts`). Use it consistently for all display formatting.

**Confidence:** HIGH -- verified from codebase constant.

---

### PITFALL-22: ALT Address Differs Between Devnet and Mainnet

**Severity:** LOW
**Phase to address:** Deployment config

**What goes wrong:** The protocol ALT is a devnet-specific account (`EyUncwUhSwCVyTnbeoKe7Ug33sUDGAQDLDBQ5fVP9Vuf`). A mainnet deployment will have a different ALT address. If the frontend hardcodes the devnet ALT, mainnet transactions will fail (ALT not found).

**Prevention:** Store ALT address in environment config: `NEXT_PUBLIC_PROTOCOL_ALT_ADDRESS`. Set different values for devnet and mainnet deployments.

**Confidence:** HIGH -- verified from `scripts/deploy/alt-address.json`.

---

### PITFALL-23: React State Updates During Transaction Processing

**Severity:** LOW
**Phase to address:** UI implementation

**What goes wrong:** During a multi-step transaction flow (e.g., VRF epoch transition with 3 TXs), the user may navigate away from the page. React unmounts components and state updates from pending async operations cause "Can't perform a React state update on an unmounted component" warnings or silent failures.

**Prevention:** Use AbortController or a ref-based cancellation flag for all async transaction flows. Check `isMounted` before updating state.

**Confidence:** HIGH -- standard React pattern.

---

### PITFALL-24: AI Development Tool Pitfalls (Claude Code MCPs, Browser Plugins)

**Severity:** LOW-MEDIUM
**Phase to address:** Development process (throughout)

**What goes wrong:** The user asked about AI development tool pitfalls. Based on training data:

1. **MCP (Model Context Protocol) tools:** Claude Code MCPs can provide file access, terminal execution, and web browsing. The pitfall is that MCPs may:
   - Have stale caches for npm package versions
   - Suggest outdated API patterns (e.g., web3.js 1.x patterns when 2.x is current)
   - Not have access to private Privy documentation or Helius dashboard
   - Cannot test actual wallet signing flows

2. **Browser plugins (Copilot, Cursor, etc.):** May autocomplete using training data patterns that are:
   - From pre-Token-2022 era (suggesting SPL Token instead of Token-2022)
   - From pre-VersionedTransaction era (suggesting legacy Transaction)
   - Missing hook remaining_accounts (not in standard examples)

3. **"DeFi template" generators:** Tools like `create-solana-dapp` generate boilerplate that works for simple token transfers but does not handle:
   - Transfer Hook remaining accounts
   - Multi-program CPI chains
   - VersionedTransaction with ALT
   - Dynamic tax rate display

**Prevention:**
1. **Verify all AI-generated Solana code against current documentation** (solana.com/docs.md for LLM-optimized docs).
2. **Test every transaction type manually** before trusting AI-generated transaction builders.
3. **Do not trust AI suggestions for Token-2022 patterns** without verification -- training data may predate Transfer Hook maturity.
4. **Keep the existing tested patterns** (`alt-helper.ts`, `swap-flow.ts`) as reference implementations and port them deliberately rather than regenerating from scratch.

**Confidence:** MEDIUM -- based on general AI tool behavior patterns.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation | Severity |
|-------------|---------------|------------|----------|
| Wallet connection (Phase 1) | PITFALL-04, PITFALL-07: Privy + v0 TX compatibility | Validate Privy v0 support FIRST before any other work | CRITICAL |
| Swap UI (Phase 1-2) | PITFALL-01, PITFALL-02, PITFALL-03: v0 TX, hook resolution, ALT requirement | Port existing patterns from `alt-helper.ts` and `swap-flow.ts` | CRITICAL |
| Next.js setup (Phase 1) | PITFALL-10: SSR hydration | Use `'use client'` for wallet components, mounted state pattern | HIGH |
| Real-time data (Phase 2-3) | PITFALL-06, PITFALL-08: Stale taxes, subscription leaks | WebSocket manager with centralized subscriptions | HIGH |
| Priority fees (Phase 1-2) | PITFALL-11: Missing compute budget | Use Compute_Budget_Profile.md values | HIGH |
| Staking UI (Phase 2) | PITFALL-15: PROFIT hook accounts | Resolve hook accounts for every PROFIT transfer | MEDIUM |
| Chart integration (Phase 3) | PITFALL-12: TradingView data format | Unix seconds, not milliseconds; use refs not state | HIGH |
| Webhook indexer (Phase 3-4) | PITFALL-09: Missed events, duplicates | Idempotent handlers, gap detection, backfill cron | HIGH |
| Railway backend (Phase 3-4) | PITFALL-13: Cold starts | Keep service always-on, connection pooler | HIGH |
| Security (entire project) | PITFALL-05: Phishing, supply chain | Lock dependencies, CSP headers, TX simulation display | CRITICAL |
| Token math (Phase 2) | PITFALL-18: Float vs integer math | BigInt/BN.js only, replicate on-chain formula | MEDIUM |
| web3.js version (Phase 1) | PITFALL-20: 1.x vs 2.x incompatibility | Choose one, document decision, don't mix | MEDIUM |
| Carnage display (Phase 2-3) | PITFALL-14: Sudden price movements | Subscribe to CarnageFundState, warn users | MEDIUM |

---

## Pitfall-to-Phase Mapping (Recommended Resolution Order)

| Priority | Pitfall(s) | When to Address | Verification |
|----------|-----------|-----------------|--------------|
| 1 (BLOCKING) | PITFALL-07: Privy v0 TX support | Before Phase 1 begins | Minimal test: Privy wallet + v0 TX + ALT |
| 2 (Phase 1) | PITFALL-03, PITFALL-10, PITFALL-19, PITFALL-20 | During scaffolding | ALT loads, hydration clean, env vars secure, web3.js version decided |
| 3 (Phase 1-2) | PITFALL-01, PITFALL-02, PITFALL-04, PITFALL-11 | During swap TX building | All 10 swap permutations work with both wallet types |
| 4 (Phase 2) | PITFALL-06, PITFALL-08, PITFALL-14, PITFALL-15 | During real-time data | WebSocket subscriptions clean, epoch transition displayed, staking works |
| 5 (Phase 2) | PITFALL-17, PITFALL-18, PITFALL-21 | During TX UX polish | Retry logic, BigInt math, correct decimal display |
| 6 (Phase 3-4) | PITFALL-09, PITFALL-12, PITFALL-13 | During backend/chart work | Webhooks idempotent, charts render correctly, Railway stable |
| 7 (Ongoing) | PITFALL-05, PITFALL-24 | Continuous | Dependency audit, CSP headers, AI output verification |

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|--------------|----------------|
| PITFALL-01: skipPreflight error masking | LOW | Add `confirmation.value.err` check, fetch TX logs |
| PITFALL-02: Wrong hook accounts | LOW | Use `resolveHookAccounts()` per-swap, no caching |
| PITFALL-03: Legacy TX too large | LOW | Switch to v0 Transaction with ALT |
| PITFALL-04: Privy signing mismatch | MEDIUM | Build abstraction layer or use Privy's adapter wrapper |
| PITFALL-05: Security breach | **CATASTROPHIC** | Incident response, DNS recovery, dependency audit, redeploy |
| PITFALL-06: Stale tax display | LOW | Add WebSocket subscription to EpochState |
| PITFALL-07: Privy no v0 support | HIGH | May require dropping Privy or limiting Privy wallet to simple operations only |
| PITFALL-08: Subscription leaks | MEDIUM | Refactor to centralized subscription manager |
| PITFALL-09: Missing webhook events | MEDIUM | Implement backfill cron from RPC |
| PITFALL-10: Hydration mismatch | LOW | Add mounted state pattern to affected components |
| PITFALL-11: Wrong CU limits | LOW | Add compute budget instructions per Compute_Budget_Profile.md |
| PITFALL-12: Chart data format | LOW | Fix timestamp conversion, use refs |
| PITFALL-13: Railway cold starts | LOW | Enable always-on, add connection pooler |
| PITFALL-14: Carnage price shock | LOW | Add CarnageFundState subscription and UI warning |
| PITFALL-15: PROFIT hook accounts | LOW | Add `resolveHookAccounts()` to staking flows |
| PITFALL-16: RPC rate limiting | MEDIUM | Batch requests, add caching, upgrade RPC plan |
| PITFALL-17: Blockhash expiry | LOW | Add retry logic with fresh blockhash |
| PITFALL-18: Float math errors | MEDIUM | Refactor to BigInt/BN.js |
| PITFALL-19: Env var exposure | LOW | Rename variables, audit build output |
| PITFALL-20: web3.js version mix | HIGH | Choose one version and refactor consistently |

---

## Sources

| Source | Type | Confidence | Items Informed |
|--------|------|------------|----------------|
| `scripts/e2e/lib/alt-helper.ts` | Project code | HIGH | PITFALL-01, PITFALL-03, PITFALL-22 |
| `scripts/e2e/lib/swap-flow.ts` | Project code | HIGH | PITFALL-02, PITFALL-11, PITFALL-17, PITFALL-18, PITFALL-21 |
| `scripts/e2e/lib/carnage-flow.ts` | Project code | HIGH | PITFALL-14 |
| `Docs/Compute_Budget_Profile.md` | Project doc | HIGH | PITFALL-11 |
| `Docs/DrFraudsworth_Overview.md` | Project doc | HIGH | PITFALL-06, PITFALL-14 |
| `.claude/skills/solana-dev/frontend-framework-kit.md` | Project skill | MEDIUM | PITFALL-10, PITFALL-20 |
| `.claude/skills/the-fortress/research/wave2/helius-article-extracted.md` | Project research | HIGH | PITFALL-05 |
| `.claude/skills/the-fortress/knowledge-base/solana/solana-runtime-quirks.md` | Project KB | HIGH | PITFALL-03 |
| `.planning/STATE.md` | Project state | HIGH | PITFALL-22 (ALT address) |
| MEMORY.md (project memory) | Project context | HIGH | PITFALL-01, PITFALL-03 (v0 TX devnet quirks) |
| Privy SDK documentation | Training data (~May 2025) | LOW-MEDIUM | PITFALL-04, PITFALL-07 |
| Helius webhook documentation | Training data (~May 2025) | MEDIUM | PITFALL-09 |
| TradingView Lightweight Charts docs | Training data (~May 2025) | MEDIUM | PITFALL-12 |
| Railway platform documentation | Training data (~May 2025) | MEDIUM | PITFALL-13 |
| Next.js documentation | Training data (~May 2025) | HIGH | PITFALL-10, PITFALL-19 |
| Solana web3.js ecosystem | Training data (~May 2025) | MEDIUM | PITFALL-20 |
| React patterns | Training data (~May 2025) | HIGH | PITFALL-08, PITFALL-23 |

**Critical caveat:** PITFALL-04 and PITFALL-07 (Privy integration) are based on training data with LOW-MEDIUM confidence. Privy's Solana support, VersionedTransaction compatibility, and wallet adapter integration MUST be verified against current Privy documentation before any architecture decisions are made. This is the highest-risk unknown in the entire frontend milestone.
