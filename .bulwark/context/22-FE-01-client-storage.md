---
task_id: db-phase1-fe-01-client-storage
provides: [fe-01-client-storage-findings, fe-01-client-storage-invariants]
focus_area: fe-01-client-storage
files_analyzed: [app/providers/SettingsProvider.tsx, app/providers/ClusterConfigProvider.tsx, app/providers/providers.tsx, app/providers/AudioProvider.tsx, app/hooks/useProtocolWallet.ts, app/hooks/useProtocolState.ts, app/components/wallet/WalletButton.tsx, app/components/station/SettingsStation.tsx, app/components/launch/LaunchWalletButton.tsx, app/components/launch/RefundPanel.tsx, app/lib/protocol-config.ts, app/lib/connection.ts, app/lib/protocol-store.ts, app/lib/bigint-json.ts, app/lib/sentry.ts, app/instrumentation-client.ts, app/middleware.ts, app/next.config.ts, app/app/api/rpc/route.ts, app/components/swap/SlippageConfig.tsx, app/.env.local, app/.env.mainnet]
finding_count: 9
severity_breakdown: {critical: 0, high: 1, medium: 3, low: 5}
---
<!-- CONDENSED_SUMMARY_START -->
# FE-01: Client-Side State & Storage -- Condensed Summary

## Key Findings (Top 9)

1. **NEXT_PUBLIC_RPC_URL contains Helius API key**: The `.env.local` file sets `NEXT_PUBLIC_RPC_URL=https://devnet.helius-rpc.com/?api-key=[REDACTED-DEVNET-KEY]-...` and `.env.mainnet` template specifies the same pattern. Next.js inlines ALL `NEXT_PUBLIC_*` values into the client JavaScript bundle at build time, regardless of whether any client code references the variable. The API key is extractable from the compiled JS. -- `.env.local:1`, `.env.mainnet:49`

2. **No localStorage cleanup on wallet disconnect**: The disconnect handlers (`WalletButton.tsx:54-59`, `SettingsStation.tsx:58-66`, `LaunchWalletButton.tsx:63-68`) call `await disconnect()` but do not clear localStorage. Only user preferences (slippage/volume/mute) are stored -- no secrets or tokens -- but the `dr-fraudsworth-settings` key persists indefinitely. -- `app/components/wallet/WalletButton.tsx:54`, `app/components/station/SettingsStation.tsx:58`

3. **localStorage data validated with field-level type checking**: `loadSettings()` in SettingsProvider validates every field individually with type checks and range bounds (`slippageBps: 0-10000`, `volume: 0-100`, `priorityFeePreset` against allowlist, `muted` as boolean). Corrupted JSON falls back to defaults. This is well-implemented. -- `app/providers/SettingsProvider.tsx:181-222`

4. **ClusterConfigProvider defaults to "devnet" on missing env var**: If `NEXT_PUBLIC_CLUSTER` is unset, `resolveClusterName()` returns "devnet". On mainnet, a missing env var would silently use devnet addresses for all protocol operations. Build-time inlining mitigates this (value frozen at build), but Railway env var misconfiguration could cause mainnet frontend to use devnet addresses. -- `app/providers/ClusterConfigProvider.tsx:27`, `app/lib/protocol-config.ts:25`

5. **No cross-tab state synchronization**: SettingsProvider writes to localStorage inside `useState` setter callbacks but does not listen for `storage` events. If a user has two tabs open and changes slippage in one, the other tab sees stale settings until page refresh. Low risk since settings are non-critical preferences. -- `app/providers/SettingsProvider.tsx:247-256`

6. **globalThis.Buffer assigned unconditionally in client**: `instrumentation-client.ts:29` sets `globalThis.Buffer = Buffer` unconditionally (following the Turbopack singleton guidance from MEMORY.md). Correctly does NOT use `if (NODE_ENV !== "production")` guard. However, the BigInt prototype shimming (`writeBigUInt64LE`, `readBigUInt64LE`) modifies the Buffer prototype globally, which could theoretically conflict with other libraries that expect unshimmed behavior. -- `app/instrumentation-client.ts:10-29`

7. **SSE protocol state held entirely in React useState**: `useProtocolState` stores all protocol account data in a single `useState<ProtocolStateMap>({})`. No persistence layer -- state is lost on page refresh. The SSE `initial-state` event re-populates on reconnect, which is the correct pattern for ephemeral display data. -- `app/hooks/useProtocolState.ts:153`

8. **Math.random() used in audio shuffle only**: Found `Math.random()` in `audio-manager.ts:343,353` for track shuffling. This is non-security-sensitive (no nonces, tokens, or secrets involved). Previous audit H112 cleared this as NOT_VULNERABLE. -- `app/lib/audio-manager.ts:343`

9. **Clipboard writes for wallet address are plain public keys**: `navigator.clipboard.writeText(address)` in WalletButton, SettingsStation, LaunchWalletButton copies only the public key (not sensitive). No clipboard read operations exist. -- `app/components/wallet/WalletButton.tsx:44`

## Critical Mechanisms

- **SettingsProvider (localStorage persistence)**: Single `dr-fraudsworth-settings` key stores slippage BPS, priority fee preset, mute state, and volume. Written synchronously inside React setState callback. Loaded once on hydration with field-level validation. No sensitive data (no tokens, keys, or PII). -- `app/providers/SettingsProvider.tsx:77-256`

- **ClusterConfigProvider (build-time env resolution)**: Reads `NEXT_PUBLIC_CLUSTER` at module level via `getClusterConfig()`. All protocol addresses (mints, pools, PDAs, program IDs) resolved from shared constants package. Frozen at build time. No runtime reconfiguration possible. -- `app/providers/ClusterConfigProvider.tsx:17-65`, `app/lib/protocol-config.ts:1-73`

- **Protocol state SSE pipeline (in-memory only)**: Server-side `protocol-store.ts` holds state in memory (Map). Client-side `useProtocolState` holds state in React useState. No browser-side persistence. State flow: Helius webhook -> protocol-store -> SSE -> useProtocolState -> React components. -- `app/lib/protocol-store.ts:36-108`, `app/hooks/useProtocolState.ts:152-365`

- **RPC proxy (API key isolation)**: Browser connects to `/api/rpc` (same-origin), which proxies to HELIUS_RPC_URL (server-only env var). The proxy has method allowlist, rate limiting, and endpoint masking. API key never sent to browser via RPC calls. But NEXT_PUBLIC_RPC_URL with API key is still build-inlined. -- `app/app/api/rpc/route.ts:1-188`, `app/lib/connection.ts:30-46`

## Invariants & Assumptions

- INVARIANT: Only non-sensitive user preferences are stored in localStorage (slippage, volume, mute, priority fee preset) -- enforced by SettingsProvider being the ONLY localStorage writer at `app/providers/SettingsProvider.tsx:253`
- INVARIANT: localStorage values are validated with type + range checks on load -- enforced at `app/providers/SettingsProvider.tsx:193-217`
- INVARIANT: Corrupted localStorage JSON falls back to safe defaults -- enforced at `app/providers/SettingsProvider.tsx:219-222`
- INVARIANT: Browser RPC calls route through /api/rpc proxy, never directly to Helius -- enforced at `app/lib/connection.ts:35-36` (browser branch returns proxy URL)
- ASSUMPTION: `NEXT_PUBLIC_CLUSTER` env var is correctly set per deployment environment -- validated at build time (inlined), but misconfiguration would cause silent wrong-cluster operation. NOT enforced at runtime. UNVALIDATED at deploy time.
- ASSUMPTION: No sensitive data persists in browser storage after wallet disconnect -- validated by code inspection (no auth tokens, no keys in localStorage). Only `dr-fraudsworth-settings` persists.
- ASSUMPTION: The NEXT_PUBLIC_RPC_URL env var with API key in .env.local is acceptable because the browser doesn't use it at runtime -- PARTIALLY VALID. The value is still inlined in the client bundle by Next.js build tooling, extractable by anyone viewing page source.

## Risk Observations (Prioritized)

1. **NEXT_PUBLIC_RPC_URL API key exposure (HIGH)**: `.env.local:1` contains `NEXT_PUBLIC_RPC_URL=https://devnet.helius-rpc.com/?api-key=[REDACTED-DEVNET-KEY]-...`. Next.js inlines this into the client bundle. An attacker can extract the API key from the production JS bundle and abuse the Helius RPC credits directly. This was flagged as H002 in Audit #1 (FIXED status), but the .env file still contains the value. If `NEXT_PUBLIC_RPC_URL` is set on Railway for mainnet, the mainnet API key would be exposed. The `.env.mainnet` template also uses `NEXT_PUBLIC_RPC_URL` with api-key placeholder. The RPC proxy (`/api/rpc`) exists specifically to avoid this, but having the env var set defeats the purpose.

2. **Cluster fallback to devnet (MEDIUM)**: Missing `NEXT_PUBLIC_CLUSTER` silently defaults to "devnet" in both `ClusterConfigProvider.tsx:27` and `protocol-config.ts:25`. On mainnet, if this env var is accidentally unset during Railway deployment, the frontend would use devnet mint addresses, pool addresses, and program IDs -- transactions would silently fail or target wrong accounts.

3. **No cross-tab settings synchronization (LOW)**: Multiple browser tabs can diverge on slippage settings. User changes slippage to 2% in tab A, tab B still shows 5%. If user submits a swap in tab B, it uses the stale 5% slippage. Low risk because on-chain enforces minimumOutput independently.

4. **localStorage not cleared on disconnect (LOW)**: Settings persist after wallet disconnect. Only contains preferences (slippage, volume), no sensitive data. Audit #1 H074 cleared this as NOT_VULNERABLE.

5. **Buffer prototype modification (LOW)**: `instrumentation-client.ts` shims `writeBigUInt64LE` and `readBigUInt64LE` onto Buffer.prototype. If a future dependency ships its own incompatible shim, this could cause silent data corruption in BigInt serialization paths.

## Novel Attack Surface

- **Build-time env var extraction for RPC abuse**: An attacker who extracts `NEXT_PUBLIC_RPC_URL` (with API key) from the client bundle JS can bypass the `/api/rpc` proxy's method allowlist and rate limiting entirely. They can call any Helius RPC method directly -- including `sendTransaction` (to spam transactions), `getProgramAccounts` (expensive queries to burn credits), or Helius-specific methods like `getAsset` that are not on the proxy allowlist. The proxy is only protective when it's the sole path to Helius, which it isn't if the API key is exposed.

- **SSE state injection via manipulated webhook**: If an attacker could forge webhook payloads (bypassing HMAC auth), they could inject arbitrary account state into protocol-store, which flows to all connected SSE clients. This would cause all browsers to display manipulated pool reserves, prices, epoch state -- potentially leading users to submit transactions with wrong expectations. This is a cross-boundary concern (-> API-04 agent), but the FE-01 observation is that there's no client-side validation of SSE data plausibility (e.g., reserves suddenly dropping to 0).

## Cross-Focus Handoffs

- -> **SEC-02 (Secret Credential)**: Verify whether `NEXT_PUBLIC_RPC_URL` with API key is actually set on Railway for mainnet. If only `HELIUS_RPC_URL` (server-only) is set and `NEXT_PUBLIC_RPC_URL` is unset, the exposure is mitigated. But the .env.mainnet template instructs setting it.
- -> **API-04 (Webhook Callback)**: SSE protocol state (`useProtocolState`) trusts data from `/api/sse/protocol` without client-side plausibility checks. If webhook auth is bypassed, manipulated state flows to all clients.
- -> **CHAIN-02 (RPC Node Trust)**: Cluster config resolution (`protocol-config.ts`) determines which program IDs, mints, and pools the frontend uses. Misconfiguration is a single-point failure for all frontend transactions.
- -> **INFRA-03 (Cloud Config)**: Railway env var management is the sole mechanism ensuring `NEXT_PUBLIC_CLUSTER=mainnet` and correct `HELIUS_RPC_URL` on mainnet. No validation at deploy time.

## Trust Boundaries

The client-side trust model is well-partitioned. The browser is fully untrusted -- it never holds private keys (wallet adapter handles signing), never receives API keys through runtime code paths (the RPC proxy isolates Helius credentials), and only persists non-sensitive user preferences in localStorage. The primary trust boundary concern is the build-time inlining of `NEXT_PUBLIC_*` env vars, which can inadvertently expose secrets set in those variables. The secondary concern is that SSE-delivered protocol state is trusted by the UI without plausibility validation -- an attacker who compromises the webhook pipeline could manipulate what all users see, potentially influencing their transaction decisions. The CSP is strict (`script-src 'self' 'unsafe-inline'`, `frame-ancestors 'none'`), preventing external script injection and clickjacking.
<!-- CONDENSED_SUMMARY_END -->

---

# FE-01: Client-Side State & Storage -- Full Analysis

## Executive Summary

The Dr. Fraudsworth frontend has a well-designed client-side state architecture with minimal attack surface. Only one localStorage key (`dr-fraudsworth-settings`) stores non-sensitive user preferences with robust field-level validation. No auth tokens, session data, API keys, or PII are stored client-side at runtime. The wallet adapter pattern (sign-then-send via `useProtocolWallet`) keeps private key operations within the wallet extension, never exposing key material to the application.

The most significant finding is the `NEXT_PUBLIC_RPC_URL` env var containing a Helius API key, which is inlined into the client bundle by Next.js build tooling even though no browser code actively references it. This undermines the RPC proxy's security purpose.

Protocol state delivery via SSE is ephemeral (React useState only, no persistence), which is the correct pattern for display-only data. The ClusterConfigProvider correctly resolves cluster-specific addresses at build time, but the devnet fallback default creates a silent misconfiguration risk for mainnet.

## Scope

All client-side storage, state management, and data persistence in the Next.js frontend application (`app/` directory). Includes:
- localStorage usage (SettingsProvider)
- React context/state (all providers and hooks)
- Browser APIs (clipboard, visibility, EventSource)
- Build-time env var exposure (NEXT_PUBLIC_*)
- Client-side singleton patterns (globalThis)
- Wallet integration state management

Out of scope: Server-side in-memory stores (protocol-store, sse-manager), Anchor programs, deployment scripts.

## Key Mechanisms

### 1. localStorage: SettingsProvider (`app/providers/SettingsProvider.tsx`)

**Storage key:** `dr-fraudsworth-settings`

**Stored fields:**
| Field | Type | Range | Default |
|-------|------|-------|---------|
| slippageBps | number | 0-10000 | 500 |
| priorityFeePreset | string | none/low/medium/high/turbo | medium |
| muted | boolean | true/false | prefers-reduced-motion |
| volume | number | 0-100 | 20 |

**Write pattern:** Synchronous inside React setState callback (line 250-253). This avoids the "one-render-behind" anti-pattern where a useEffect-based write would lag the state update.

**Read pattern:** Lazy initializer in useState (line 245). `loadSettings()` runs once during hydration. Each field is validated individually -- missing or invalid fields fall back to defaults without rejecting the entire settings object.

**Validation thoroughness (line 181-222):**
- JSON.parse wrapped in try/catch -- corrupted data returns defaults
- Null/non-object check after parse
- Each field validated by type, range, and allowlist
- slippageBps: `typeof === 'number' && >= 0 && <= 10000`
- priorityFeePreset: `typeof === 'string' && VALID_PRIORITY_PRESETS.includes()`
- muted: `typeof === 'boolean'`
- volume: `typeof === 'number' && >= 0 && <= 100`

**Security assessment:** No sensitive data stored. No auth tokens, no wallet keys, no PII. Even if an XSS attacker reads localStorage, they obtain only UX preferences. The slippage value could theoretically be manipulated (set to 50% / 5000 BPS to maximize extractable value on the attacker's sandwich), but on-chain `minimumOutput` enforcement is the security boundary for swap slippage.

### 2. ClusterConfigProvider (`app/providers/ClusterConfigProvider.tsx`)

**Mechanism:** Reads `NEXT_PUBLIC_CLUSTER` at build time via `process.env.NEXT_PUBLIC_CLUSTER || "devnet"`. Calls `getClusterConfig(clusterName)` from the shared package to resolve all cluster-specific addresses (mints, pools, PDAs, program IDs, treasury, ALT).

**Default behavior:** Falls back to "devnet" if env var is unset. The "mainnet" shorthand is accepted and mapped to "mainnet-beta".

**Risk analysis:** Build-time inlining means the cluster choice is frozen at deploy. No runtime reconfiguration. If Railway env var `NEXT_PUBLIC_CLUSTER` is missing during a mainnet build, the production bundle would use devnet addresses for everything -- transactions would fail or interact with devnet programs.

**Mitigations:** The `.env.mainnet` template documents this env var. Railway deployment presumably follows this template. But there's no build-time assertion that validates the cluster matches the deployment target.

### 3. Protocol State SSE Pipeline (Client Side)

**`useProtocolState` hook (`app/hooks/useProtocolState.ts`):**

- Connects to `/api/sse/protocol` via EventSource
- Receives `initial-state` event with full snapshot on connect
- Receives `protocol-update` events for incremental changes
- Stores all data in `useState<ProtocolStateMap>({})`
- No browser-side persistence (no localStorage, no IndexedDB)
- State lost on page refresh, re-populated by SSE initial-state

**Reconnection:** Exponential backoff (1s, 2s, 4s... up to 30s max). After 30s of SSE downtime, activates RPC polling fallback (60s interval) via `getMultipleAccountsInfo`.

**Visibility gating:** Pauses SSE when tab is hidden (`useVisibility`), resumes when tab becomes active. Prevents resource waste for background tabs.

**Data trust model:** The hook trusts SSE data without plausibility validation. Whatever the server sends via SSE is stored and displayed. If an attacker could inject data into the SSE pipeline (via webhook forgery), all connected clients would display manipulated state. The security boundary is the webhook HMAC authentication (server-side), not the client.

### 4. RPC Connection Factory (`app/lib/connection.ts`)

**Browser path (line 35-36):** Returns `${window.location.origin}/api/rpc` -- always routes through the proxy. The Helius API key never flows through the Connection object in the browser.

**Server path (line 39-44):** Uses `HELIUS_RPC_URL` (preferred) or `NEXT_PUBLIC_RPC_URL` (fallback). Throws if neither is set.

**Singleton pattern:** Cached by URL. Only one Connection instance exists per URL. Prevents duplicate WebSocket connections.

### 5. Wallet State (`app/hooks/useProtocolWallet.ts`)

**Sign-then-send pattern:** Uses `signTransaction()` from wallet-adapter to get the wallet to sign only, then submits via `connection.sendRawTransaction()` through the RPC proxy. This gives full control over which RPC receives the transaction.

**State exposed:** `publicKey` (PublicKey | null), `connected` (boolean), `ready` (boolean). No private key material ever flows through the application.

**Disconnect:** Wraps wallet-adapter's `disconnect()`. Does not clear localStorage (only settings stored, not wallet-related data).

### 6. Buffer Polyfill (`app/instrumentation-client.ts`)

**Purpose:** Provides `Buffer` globally for Solana libraries that expect Node.js Buffer. Shims `writeBigUInt64LE` and `readBigUInt64LE` because the `buffer` npm package v6.x lacks BigInt methods.

**Global mutation:** `globalThis.Buffer = Buffer` at line 29. The prototype modifications at lines 10-27 affect all code that uses Buffer.

**Sentry setup:** Registers `window.error` and `window.unhandledrejection` listeners for error capture. The Sentry DSN comes from `NEXT_PUBLIC_SENTRY_DSN` (client-safe -- DSN is meant to be public).

## Trust Model

### Trust Tiers for Client-Side Data

| Tier | Data | Storage | Trust Level |
|------|------|---------|-------------|
| 1 (Display Only) | Protocol state (epoch, pools, prices) | React useState | Untrusted source (SSE from server), display only, no financial decisions |
| 2 (User Preference) | Slippage, volume, mute | localStorage | User-controlled, validated on load, non-sensitive |
| 3 (Build-Time Config) | Cluster, program IDs, mints | Inlined JS | Trusted (frozen at build), single-source-of-truth |
| 4 (Wallet) | Public key, connected state | wallet-adapter state | External (wallet extension), verified by adapter |
| 5 (Secrets) | Private keys, API keys | NEVER in client* | Should never be in client. *Exception: NEXT_PUBLIC_RPC_URL leaks API key |

### Data Flow: Browser to On-Chain

```
User Input (slippage, amount)
  -> React state (hooks)
    -> Transaction Builder (swap-builders, staking-builders)
      -> Wallet Adapter (signTransaction)
        -> RPC Proxy (/api/rpc -> Helius)
          -> Solana RPC
```

At no point does the browser hold private keys or API credentials in application state (except the build-inlined NEXT_PUBLIC_RPC_URL env var).

## State Analysis

### Browser Storage Inventory

| Mechanism | Key/Usage | Data | Sensitive? |
|-----------|-----------|------|-----------|
| localStorage | `dr-fraudsworth-settings` | Slippage BPS, priority fee, mute, volume | No |
| sessionStorage | (not used) | -- | -- |
| IndexedDB | (not used) | -- | -- |
| Cookies | (not used) | -- | -- |
| Service Worker | (not used) | -- | -- |
| Cache API | (not used) | -- | -- |

### React State Inventory (Key Hooks)

| Hook | State Type | Persisted? | Source |
|------|-----------|-----------|--------|
| useProtocolState | ProtocolStateMap (all PDA data) | No | SSE `/api/sse/protocol` |
| useTokenBalances | SOL/CRIME/FRAUD/PROFIT balances | No | RPC polling |
| useCurveState | Bonding curve state | No | SSE (via useProtocolState) |
| useEpochState | Epoch state | No | SSE (via useProtocolState) |
| usePoolPrices | Pool reserves + prices | No | SSE (via useProtocolState) |
| useSwap | Swap form state + TX status | No | User input + RPC |
| useStaking | Staking form state + TX status | No | User input + RPC |

### globalThis Singletons (Client Side)

| Module | Key | Purpose | Browser? |
|--------|-----|---------|----------|
| instrumentation-client.ts | `globalThis.Buffer` | Buffer polyfill | Yes (client) |
| protocol-store.ts | `globalForStore.protocolStore` | PDA cache | No (server only) |
| sse-manager.ts | `globalForSSE.sseManager` | SSE broadcast | No (server only) |
| credit-counter.ts | `globalForCredit.creditCounter` | RPC tracking | No (server only) |
| sse-connections.ts | `globalForSSEConn` | Connection limits | No (server only) |
| ws-subscriber.ts | `globalForWsSub` | WS pipeline | No (server only) |
| db/connection.ts | `globalForDb` | DB connection | No (server only) |
| rate-limit.ts | `CLEANUP_KEY` symbol | Interval dedup | No (server only) |

Only `globalThis.Buffer` is client-side. All other globalThis singletons are server-only (verified by import chains and runtime guards).

## Dependencies

### External APIs Accessed from Client

| API | Access Pattern | Credentials? |
|-----|---------------|-------------|
| Helius RPC | Via /api/rpc proxy | API key server-side only |
| SSE /api/sse/protocol | EventSource (same-origin) | No auth |
| SSE /api/sse/candles | EventSource (same-origin) | No auth |
| Wallet Adapter | Browser extension injection | No credentials |

### Build-Time Dependencies

| Env Var | Client-Exposed? | Sensitive? | Notes |
|---------|----------------|-----------|-------|
| NEXT_PUBLIC_CLUSTER | Yes | No | Cluster identifier |
| NEXT_PUBLIC_RPC_URL | Yes (build-inlined) | YES (has API key) | Should be removed from NEXT_PUBLIC_ |
| NEXT_PUBLIC_SENTRY_DSN | Yes | No | DSNs are designed to be public |
| NEXT_PUBLIC_COMMIT_SHA | Yes | No | Git SHA for release tracking |
| NEXT_PUBLIC_SITE_MODE | Yes | No | launch/live mode |
| NEXT_PUBLIC_CURVE_PHASE | Yes | No | Curve phase flag |
| NEXT_PUBLIC_DOCS_URL | Yes | No | Documentation URL |
| NEXT_PUBLIC_DEMO_MODE | Yes | No | Demo flag |

## Focus-Specific Analysis

### AIP-094 Check: Auth Tokens in localStorage

**Result: NOT APPLICABLE.** This application has no authentication system. No JWT tokens, no session tokens, no auth state in localStorage. The wallet adapter manages connection state internally (not via localStorage). The only localStorage usage is the settings key with UX preferences.

### AIP-096 Check: postMessage Without Origin Validation

**Result: NOT FOUND.** No `postMessage` or `addEventListener('message', ...)` usage found in the application code. The wallet adapter library handles postMessage internally for wallet communication.

### AIP-097 Check: Math.random() for Security Values

**Result: SAFE.** `Math.random()` found only in `audio-manager.ts:343,353` for track shuffle randomization. No security-sensitive uses (no nonces, tokens, CSRFs, or session IDs generated with Math.random).

### AIP-098 Check: Client-Side Route Guards Without Server Enforcement

**Result: NOT APPLICABLE.** No protected routes exist. The middleware (`middleware.ts`) handles site-mode routing (launch vs live) server-side. There are no admin pages, no login-gated content, no role-based access.

### AIP-099 Check: Sensitive Data in NEXT_PUBLIC_ Variables

**Result: FINDING.** `NEXT_PUBLIC_RPC_URL` in `.env.local` (and `.env.mainnet` template) contains the Helius API key. This is the H002 finding from Audit #1. While the browser code does not read this variable at runtime (it uses the /api/rpc proxy), Next.js still inlines the value into the client bundle. An attacker can extract it from the compiled JS and use it to make direct RPC calls to Helius, bypassing the proxy's method allowlist and rate limiting.

### AIP-101 Check: No Data Cleanup on Logout/Disconnect

**Result: CONFIRMED (LOW).** All three disconnect handlers (WalletButton, SettingsStation, LaunchWalletButton) call `disconnect()` without clearing localStorage or React Query caches. However, the only data in localStorage is non-sensitive settings preferences. No wallet addresses, balances, or transaction history are persisted. Audit #1 H074 cleared this as NOT_VULNERABLE for the same reason.

### AIP-102 Check: Seed Phrases in DOM

**Result: NOT APPLICABLE.** This is a dApp frontend, not a wallet. No seed phrases, mnemonics, or private keys are ever rendered or handled by the application.

### AIP-103 Check: Trusting window.solana Without Verification

**Result: SAFE.** No direct `window.solana` or `window.ethereum` access found. The application uses `@solana/wallet-adapter-react` which implements wallet-standard protocol for provider discovery. The wallet-adapter library handles provider verification.

## Cross-Focus Intersections

### FE-01 x SEC-02 (Secrets)
The `NEXT_PUBLIC_RPC_URL` env var bridges these two domains. SEC-02 should verify whether this variable is set on Railway for mainnet production. If only `HELIUS_RPC_URL` (server-only) is set and `NEXT_PUBLIC_RPC_URL` is absent, the API key is not exposed.

### FE-01 x CHAIN-02 (RPC Trust)
The ClusterConfigProvider resolves ALL protocol addresses based on a single env var. If `NEXT_PUBLIC_CLUSTER` is wrong, every RPC call, every transaction, every account lookup targets the wrong cluster. No runtime validation exists.

### FE-01 x API-04 (Webhook Callbacks)
SSE data from `/api/sse/protocol` is consumed by `useProtocolState` without client-side plausibility checks. Webhook auth is the sole defense against state injection. If webhook auth is bypassed (SEC-02 concern), all client displays are compromised.

### FE-01 x LOGIC-01 (Business Logic)
The slippage value from localStorage directly influences transaction construction in swap hooks. An XSS attacker could set `slippageBps` to 5000 (50%) in localStorage to maximize sandwich attack profit on the user's next swap. On-chain `minimumOutput` is the safety net, but a manipulated slippage means the user's expected minimum is 50% lower than optimal.

## Cross-Reference Handoffs

| To Agent | Item | Why |
|----------|------|-----|
| SEC-02 | Verify NEXT_PUBLIC_RPC_URL is NOT set on Railway mainnet | Confirms whether API key is exposed in production bundle |
| API-04 | SSE protocol state has no client-side plausibility validation | Webhook forgery -> UI manipulation -> user harm |
| CHAIN-02 | ClusterConfigProvider devnet fallback | Misconfigured NEXT_PUBLIC_CLUSTER -> wrong-cluster transactions |
| INFRA-03 | Railway env var validation at deploy time | No automated check that required env vars are set correctly |
| WEB-02 | CSP script-src 'unsafe-inline' | Allows inline script injection if an attacker finds an injection vector |

## Risk Observations

### 1. NEXT_PUBLIC_RPC_URL API Key in Client Bundle (HIGH)

**File:** `.env.local:1`, `.env.mainnet:49`
**Impact:** Helius RPC credit abuse, method allowlist bypass, potential DDoS amplification
**Likelihood:** Probable -- extracting env vars from JS bundles is trivial
**Severity:** HIGH (matches Audit #1 H002)

The `.env.local` sets `NEXT_PUBLIC_RPC_URL=https://devnet.helius-rpc.com/?api-key=[REDACTED-DEVNET-HELIUS-KEY]`. Even though no client code references this variable, Next.js inlines ALL `NEXT_PUBLIC_*` env vars into the client bundle's `process.env` polyfill.

The `.env.mainnet` template at line 49 also specifies `NEXT_PUBLIC_RPC_URL` with API key. If deployed as-is, the mainnet Helius API key would be exposed.

**Recommendation:** Remove `NEXT_PUBLIC_RPC_URL` from both .env files. The browser uses the /api/rpc proxy and never needs a direct RPC URL. Server-side code uses `HELIUS_RPC_URL` (no NEXT_PUBLIC_ prefix). The fallback in rpc/route.ts line 131 should be removed and replaced with `HELIUS_RPC_URL_FALLBACK` only.

### 2. Cluster Config Devnet Fallback (MEDIUM)

**File:** `app/providers/ClusterConfigProvider.tsx:27`, `app/lib/protocol-config.ts:25`
**Impact:** Mainnet frontend uses devnet addresses -- all transactions fail or target wrong accounts
**Likelihood:** Possible -- human error during Railway deployment
**Severity:** MEDIUM

Both files default to "devnet" when `NEXT_PUBLIC_CLUSTER` is unset. A deployment that accidentally omits this env var would silently produce a mainnet-branded frontend that interacts with devnet.

**Recommendation:** Add a build-time assertion in `next.config.ts` that throws if `NODE_ENV === 'production'` and `NEXT_PUBLIC_CLUSTER` is not explicitly set.

### 3. Slippage Manipulation via XSS (MEDIUM)

**File:** `app/providers/SettingsProvider.tsx:253`
**Impact:** Attacker sets slippage to 50% (5000 BPS) for maximum sandwich profit
**Likelihood:** Requires XSS vector (mitigated by CSP, but 'unsafe-inline' in script-src is a partial weakening)
**Severity:** MEDIUM (on-chain minimumOutput is the real protection, but user perception of "safe" slippage is undermined)

If an attacker achieves XSS, they can write `localStorage.setItem('dr-fraudsworth-settings', JSON.stringify({slippageBps:5000,...}))`. On next page load, the user's slippage is 50%. The validation accepts 0-10000 BPS as valid range.

**Recommendation:** Consider reducing the valid slippage ceiling from 10000 BPS (100%) to 5000 BPS (50%) in the validation at line 197 to match the 50% hard cap noted in MEMORY.md.

### 4. No Cross-Tab Synchronization (LOW)

**File:** `app/providers/SettingsProvider.tsx:247-256`
**Impact:** Stale settings in background tabs
**Severity:** LOW

### 5. Settings Persist After Disconnect (LOW)

**File:** `app/components/wallet/WalletButton.tsx:54-59`
**Impact:** UX preferences remain -- no sensitive data at risk
**Severity:** LOW (confirmed by Audit #1 H074 clearance)

## Novel Attack Surface Observations

1. **Build artifact env var extraction**: Even when no client code references `NEXT_PUBLIC_RPC_URL`, the value is embedded in the Next.js runtime chunk. Tools like `grep` on the compiled JS or browser DevTools on the `__NEXT_DATA__` object can extract it. This is a framework-level behavior that developers may not realize.

2. **SSE-driven UI manipulation chain**: An attacker who compromises webhook authentication could inject false pool reserve data into protocol-store, which broadcasts to all SSE clients, which updates all user displays. Users see manipulated prices and may submit transactions with incorrect expectations. The attack chain is: webhook bypass -> protocol-store -> sseManager.broadcast -> useProtocolState -> UI components. No client-side sanity check exists (e.g., "reserves changed by >50% in one update" alert).

3. **SlippageConfig accepts 0 BPS**: While `setSlippageBps` accepts any number, the custom input validates `parsed > 0 && parsed <= 50` (line 133). But setting slippage to 0 via a preset or direct `updateSettings({slippageBps: 0})` call is possible. Zero slippage means the transaction would fail if any price movement occurs between quote and execution, but it's not a security risk.

## Questions for Other Focus Areas

- **SEC-02**: Is `NEXT_PUBLIC_RPC_URL` set on Railway mainnet? If yes, what's the API key?
- **API-04**: Does the Helius webhook HMAC verification use the standard SHA-256 algorithm? Could the `timingSafeEqual` implementation be bypassed?
- **CHAIN-02**: Are there any code paths where `useProtocolState` data influences transaction construction (beyond display)? If pool reserves from SSE feed into slippage calculations, a manipulated SSE stream could cause users to accept worse prices.
- **WEB-02**: Does `script-src 'self' 'unsafe-inline'` in CSP provide sufficient XSS protection? Next.js requires `unsafe-inline` for style injection, but it also weakens script protection.

## Raw Notes

- Confirmed no `dangerouslySetInnerHTML` usage anywhere in the app
- Confirmed no `eval()` or `new Function()` in client code
- Confirmed no Service Worker, Cache API, or IndexedDB usage
- Confirmed no `postMessage` listeners in application code
- Confirmed no `window.solana` or `window.ethereum` direct access
- CSP: `script-src 'self' 'unsafe-inline'` -- the `unsafe-inline` is needed for Next.js style injection but does not allow eval
- CSP: `frame-ancestors 'none'` -- prevents clickjacking
- CSP: `connect-src` properly restricts external connections to Helius, WalletConnect, and Sentry
- No cookies used by the application
- No session management (stateless frontend)
- Audio manager's Math.random() is for shuffle only (H112 cleared)
- The Sentry module (`lib/sentry.ts`) uses `crypto.randomUUID()` for event IDs -- correct CSPRNG usage
- The `bigintReviver` in SSE deserialization trusts the `__bigint` tag. An attacker who controls SSE data could inject `{__bigint: "not-a-number"}` causing a BigInt parse error, but this would throw and be caught by the try/catch in useProtocolState's event handlers
