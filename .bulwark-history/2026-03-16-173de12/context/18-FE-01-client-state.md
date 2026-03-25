---
task_id: db-phase1-fe-01-client-state
provides: [fe-01-client-state-findings, fe-01-client-state-invariants]
focus_area: fe-01-client-state
files_analyzed:
  - app/providers/SettingsProvider.tsx
  - app/providers/providers.tsx
  - app/hooks/useSwap.ts
  - app/hooks/useProtocolWallet.ts
  - app/hooks/useStaking.ts
  - app/hooks/useRoutes.ts
  - app/hooks/useCurveState.ts
  - app/hooks/useEpochState.ts
  - app/hooks/usePoolPrices.ts
  - app/hooks/useTokenBalances.ts
  - app/hooks/useSettings.ts
  - app/hooks/useCarnageEvents.ts
  - app/hooks/useChartSSE.ts
  - app/hooks/useSolPrice.ts
  - app/components/wallet/WalletButton.tsx
  - app/components/station/SettingsStation.tsx
  - app/components/launch/BuySellPanel.tsx
  - app/lib/connection.ts
  - app/lib/sentry.ts
  - shared/constants.ts
  - shared/programs.ts
  - app/.env.local
finding_count: 7
severity_breakdown: {critical: 0, high: 1, medium: 3, low: 3}
---
<!-- CONDENSED_SUMMARY_START -->
# FE-01: Client-Side State & Storage -- Condensed Summary

## Key Findings (Top 7)

1. **No client-side storage cleanup on wallet disconnect**: Both `WalletButton.tsx:54-59` and `SettingsStation.tsx:58-66` call `disconnect()` without clearing localStorage. Settings persist across wallet sessions. Not exploitable in current context (settings contain only slippage/volume preferences, no auth tokens or PII), but violates defense-in-depth. -- `app/components/wallet/WalletButton.tsx:54`, `app/components/station/SettingsStation.tsx:58`

2. **Helius API key hardcoded in shared package, bundled into client**: `DEVNET_RPC_URL` in `shared/programs.ts:21-22` embeds the Helius API key `[REDACTED-DEVNET-KEY]-...`. This is imported by `app/lib/connection.ts:33` and `app/providers/providers.tsx:35` as the RPC URL fallback, placing the key in the client-side JavaScript bundle. Currently devnet/free-tier, but the same pattern would leak a paid mainnet key. -- `shared/programs.ts:22`, `app/lib/connection.ts:33`

3. **`NEXT_PUBLIC_RPC_URL` in `.env.local` contains API key**: The env var `NEXT_PUBLIC_RPC_URL=https://devnet.helius-rpc.com/?api-key=[REDACTED-DEVNET-KEY]-...` is client-exposed by design (NEXT_PUBLIC_ prefix). Same key as #2 but via a second path. -- `app/.env.local:1`

4. **localStorage stores only non-sensitive user preferences**: Settings stored under key `dr-fraudsworth-settings` contain slippage BPS, priority fee preset, muted boolean, and volume integer. No auth tokens, no wallet keys, no PII. Validation on load is thorough (type checks, range bounds, enum allowlist). -- `app/providers/SettingsProvider.tsx:88-130`

5. **Floating-point arithmetic for financial base-unit conversion**: `useSwap.ts:299` computes `Math.floor(parsed * 10 ** decimals)` where `decimals` is 9 (SOL) or 6 (tokens). For SOL amounts, `10 ** 9 = 1e9` is exact in IEEE 754, but `parseFloat("0.1") * 1e9 = 100000000.00000001` -- `Math.floor` saves this particular case, but edge-case amounts near precision boundaries could silently lose sub-lamport resolution. On-chain program enforces the authoritative amount, so client-side rounding is informational only. -- `app/hooks/useSwap.ts:297-299`

6. **Demo mode flag exposed via NEXT_PUBLIC_DEMO_MODE**: `useCurveState.ts:168` reads `NEXT_PUBLIC_DEMO_MODE` and when "true", returns mock CurveStateData without any RPC calls. The conditional early return on line 211 is called before `useState` hooks, which violates React's rules-of-hooks (hooks must be called unconditionally). React may not catch this in production builds but it is technically undefined behavior. -- `app/hooks/useCurveState.ts:168-218`

7. **Math.random() used for non-security purposes only**: `app/lib/audio-manager.ts:343,353` uses `Math.random()` for shuffling audio playlist order. This is not a security concern (AIP-097 false positive) -- no nonces, tokens, or cryptographic values generated.

## Critical Mechanisms

- **SettingsProvider (localStorage persistence)**: Stores `{slippageBps, priorityFeePreset, muted, volume}` in `dr-fraudsworth-settings`. Read via `loadSettings()` with per-field type+range validation. Write via `updateSettings()` synchronously inside `useState` setter callback. Corruption-safe (JSON.parse failure falls back to defaults). -- `app/providers/SettingsProvider.tsx:56-164`

- **useProtocolWallet (sign-then-send)**: Wraps wallet-adapter's `signTransaction()` then sends via `connection.sendRawTransaction()`. No client-side state persisted. TX signature exists only in React state (volatile). -- `app/hooks/useProtocolWallet.ts:87-121`

- **useTokenBalances (cross-instance sync)**: Dispatches `CustomEvent("token-balances-refresh")` on `window` for cross-instance coordination. No data stored client-side; all balances re-fetched from RPC. Self-dispatch guard via `isDispatchingRef` prevents infinite loops. -- `app/hooks/useTokenBalances.ts:145-174`

- **Connection singleton**: Caches a single Solana `Connection` in a module-level variable (`cachedConnection`). Not stored in localStorage/sessionStorage. URL comes from `NEXT_PUBLIC_RPC_URL` or hardcoded `DEVNET_RPC_URL`. -- `app/lib/connection.ts:21-52`

## Invariants & Assumptions

- INVARIANT: Only non-sensitive user preferences are stored in localStorage -- enforced at `app/providers/SettingsProvider.tsx:56` (only `slippageBps`, `priorityFeePreset`, `muted`, `volume`)
- INVARIANT: localStorage data is validated on load with type checks + range bounds -- enforced at `app/providers/SettingsProvider.tsx:100-125`
- INVARIANT: No auth tokens or wallet private keys exist in client-side storage -- NOT stored anywhere; wallet-adapter manages connection state internally
- INVARIANT: Transaction signatures exist only in volatile React state (useState), never persisted to storage -- enforced across `useSwap.ts`, `useStaking.ts`

- ASSUMPTION: `wallet-adapter` handles wallet connection state internally and cleans up on disconnect -- UNVALIDATED (no explicit localStorage/sessionStorage cleanup call in disconnect handlers)
- ASSUMPTION: `NEXT_PUBLIC_RPC_URL` will be changed for mainnet to not contain the API key -- UNVALIDATED (documented in `Docs/mainnet-readiness-assessment.md:104` as NOT_STARTED)
- ASSUMPTION: `Math.floor(parseFloat(amount) * 10 ** decimals)` is safe for all user-input amounts -- partially validated (Math.floor prevents over-count; on-chain is authoritative)

## Risk Observations (Prioritized)

1. **Helius API key in client bundle**: `shared/programs.ts:22` + `app/.env.local:1` -- Currently devnet free-tier. For mainnet, this same pattern would expose a paid RPC key to any browser user. Rate-limit abuse and billing exposure. Documented as known issue in `Docs/mainnet-readiness-assessment.md:245`.

2. **No localStorage cleanup on disconnect**: `WalletButton.tsx:54-59`, `SettingsStation.tsx:58-66` -- Settings (slippage, volume) persist. Not exploitable today (no sensitive data stored), but future changes that add stored data could inherit this gap.

3. **Demo mode conditional hook violation**: `useCurveState.ts:211` -- Early return before useState calls. Could cause React runtime errors if demo mode is toggled at runtime (currently build-time only via NEXT_PUBLIC_ prefix, mitigating the risk).

## Novel Attack Surface

- **CustomEvent-based cross-instance balance sync**: `useTokenBalances.ts:172` dispatches a `CustomEvent("token-balances-refresh")` on `window`. Any script running in the same page context (browser extensions, injected scripts, XSS payload) could dispatch this event to force all balance-fetching hooks to re-fetch simultaneously, creating a burst of RPC requests. Not directly exploitable for data theft, but could be used for targeted RPC rate-limit exhaustion against the Helius endpoint.

## Cross-Focus Handoffs

- -> **SEC-02**: Helius API key `[REDACTED-DEVNET-KEY]-...` hardcoded in `shared/constants.ts:474` and `shared/programs.ts:22`, exposed in client bundle. Needs assessment of whether this key has permissions beyond RPC (webhook management is confirmed in `shared/constants.ts:471` comment).
- -> **CHAIN-02**: `app/lib/connection.ts:33` RPC URL resolution chain (NEXT_PUBLIC_RPC_URL > DEVNET_RPC_URL) -- both paths contain the API key. RPC node trust assessment needed for mainnet.
- -> **WEB-01**: No XSS vectors found in this analysis, but if XSS existed, the localStorage settings key and CustomEvent dispatch surface would be accessible.

## Trust Boundaries

The frontend stores only non-sensitive user preferences (slippage, volume) in localStorage. No auth tokens, private keys, or PII touch client-side storage. All wallet operations go through the wallet-adapter library which manages its own connection state. Transaction data exists only in volatile React state and is never persisted. The primary trust boundary concern is the Helius API key exposed in the client bundle via the shared package and NEXT_PUBLIC_RPC_URL env var -- currently devnet/free-tier but a mainnet blocker. The client trusts RPC responses for display purposes (balances, pool reserves, epoch state), with on-chain programs as the authoritative enforcement layer for all financial operations.
<!-- CONDENSED_SUMMARY_END -->

---

# FE-01: Client-Side State & Storage -- Full Analysis

## Executive Summary

The Dr. Fraudsworth frontend follows a clean pattern for client-side state: almost everything is volatile React state (useState/useRef), with a single localStorage key (`dr-fraudsworth-settings`) storing non-sensitive user preferences. No auth tokens, private keys, session data, or PII are stored client-side. The main security concern is the Helius RPC API key being bundled into the client via the shared package and NEXT_PUBLIC_RPC_URL environment variable.

## Scope

All files tagged FE-01 in the Bulwark INDEX, plus related providers, hooks, and lib files. On-chain programs (`programs/`) directory skipped per auditor scope rules.

## Key Mechanisms

### 1. localStorage Persistence (SettingsProvider)

**File:** `app/providers/SettingsProvider.tsx`

The single point of localStorage interaction in the entire application.

**Storage key:** `dr-fraudsworth-settings`

**Data stored:**
```typescript
interface Settings {
  slippageBps: number;      // 0-10000 (basis points)
  priorityFeePreset: string; // "none"|"low"|"medium"|"high"|"turbo"
  muted: boolean;
  volume: number;            // 0-100
}
```

**Read path (lines 88-130):**
- `loadSettings()` called as lazy initializer for `useState`
- Returns defaults if `window` is undefined (SSR safety)
- `JSON.parse(raw)` with try/catch for corruption recovery
- Per-field validation: type check + range check for numbers, enum allowlist for preset string
- Corrupted JSON falls back to full defaults (fail-safe)

**Write path (lines 154-163):**
- `updateSettings()` merges partial updates via `setSettings` callback
- `localStorage.setItem` called synchronously inside the useState setter (avoids one-render-behind staleness)
- SSR guard: checks `typeof window !== 'undefined'` before write

**Security assessment:**
- No sensitive data stored. Slippage and volume are user preferences with no security implications.
- Validation on read is thorough -- protects against tampered localStorage values.
- No encryption needed (data is non-sensitive).
- No cookie interaction anywhere in the application.

### 2. React State (All Hooks)

All protocol data lives in volatile React state:

| Hook | State Type | Sensitive? | Persisted? |
|------|-----------|-----------|-----------|
| useSwap | Token amounts, quote, tx signature, status | TX signature (semi-public) | No |
| useStaking | Staked amounts, rewards, tx signature | TX signature | No |
| useProtocolWallet | Public key, connected state | Public key (public) | No |
| useRoutes | Routes, selected route, countdown | Financial math | No |
| useCurveState | Curve state (tokensSold, solRaised) | On-chain public data | No |
| useEpochState | Tax rates, epoch number | On-chain public data | No |
| usePoolPrices | Pool reserves | On-chain public data | No |
| useTokenBalances | SOL/CRIME/FRAUD/PROFIT balances | Semi-sensitive (balance) | No |
| useSolPrice | SOL/USD price | Public data | No |
| useCarnageEvents | Carnage event history | Public data | No |
| useChartSSE | Connection status | No | No |

**Key observation:** No hook writes to localStorage, sessionStorage, IndexedDB, or cookies. All data is re-fetched from RPC/API on page load.

### 3. Connection Singleton

**File:** `app/lib/connection.ts`

Module-level cache (`cachedConnection`, `cachedUrl`) stores a Solana `Connection` object. Not persisted to storage. URL resolution:
1. `rpcUrl` parameter (if provided)
2. `process.env.NEXT_PUBLIC_RPC_URL` (client-exposed)
3. `DEVNET_RPC_URL` from shared package (hardcoded with API key)

Both paths 2 and 3 contain the Helius API key.

### 4. Wallet Connection/Disconnection

**Disconnect handlers:**

`WalletButton.tsx:54-59`:
```typescript
await disconnect();
// No localStorage cleanup
```

`SettingsStation.tsx:58-66`:
```typescript
await disconnect();
closeModal();
showToast('success', 'Wallet disconnected');
// No localStorage cleanup
```

Neither disconnect handler clears localStorage. The wallet-adapter library manages its own state internally. The `dr-fraudsworth-settings` localStorage entry persists across wallet sessions -- this is intentional for UX (slippage preferences carry over) but means settings from a previous session are visible to the next user of the same browser.

### 5. Cross-Instance Balance Sync

**File:** `app/hooks/useTokenBalances.ts:145-174`

Uses `window.dispatchEvent(new CustomEvent("token-balances-refresh"))` for cross-component coordination. The self-dispatch guard (`isDispatchingRef`) prevents the dispatching instance from double-fetching.

**Attack surface:** Any code running in the same page context can dispatch this event, triggering all `useTokenBalances` instances to fire RPC requests simultaneously. This could be used for RPC rate-limit exhaustion but not data theft.

## Trust Model

| Data Source | Trust Level | Notes |
|-------------|------------|-------|
| localStorage | Low trust | Validated on read with type+range checks |
| Wallet adapter | High trust | Standard library, handles state internally |
| RPC responses | Medium trust | Used for display; on-chain is authoritative |
| User input (amounts) | Low trust | Parsed via parseFloat, validated > 0, on-chain enforces |
| Environment variables | High trust | Build-time injected by Next.js |

## State Analysis

### localStorage
- **Key:** `dr-fraudsworth-settings`
- **Contents:** `{slippageBps: number, priorityFeePreset: string, muted: boolean, volume: number}`
- **Risk:** None (non-sensitive preferences)
- **Cleared on logout:** No
- **Validated on read:** Yes (thorough per-field validation)

### sessionStorage
Not used anywhere in the application.

### IndexedDB
Not used anywhere in the application.

### Cookies
Not used anywhere in the application. No `document.cookie`, `Cookies.set`, or cookie-related imports found.

### In-Memory Caches
- `cachedConnection` in `app/lib/connection.ts` (Connection singleton)
- React state in all hooks (cleared on component unmount)

## Dependencies (External APIs, Packages, Services)

| Dependency | Used For | Client-Exposed? |
|-----------|---------|-----------------|
| Helius RPC (devnet) | All on-chain reads, TX submission | Yes (API key in bundle) |
| Jupiter Price API | SOL/USD price | Yes (public API, no key) |
| Sentry ingest API | Error reporting | Yes (DSN in NEXT_PUBLIC_SENTRY_DSN) |
| @solana/wallet-adapter | Wallet connection | Yes (client library) |

## Focus-Specific Analysis

### AIP-094 Check: Auth Tokens in localStorage
**Result:** Not applicable. No authentication system exists. The app is a wallet-connected dApp with no backend auth, no JWTs, no sessions. The wallet-adapter handles connection state without storing secrets.

### AIP-096 Check: postMessage Without Origin Validation
**Result:** No `postMessage` listeners found anywhere in `app/` directory. Clean.

### AIP-097 Check: Math.random() for Security Values
**Result:** `Math.random()` found only in `app/lib/audio-manager.ts:343,353` for playlist shuffling. Not a security concern. No nonces, tokens, or CSRF values generated with Math.random().

### AIP-098 Check: Client-Side Route Guards Without Server Auth
**Result:** No protected routes exist. The app is fully public -- no admin pages, no authenticated areas. API routes (`/api/`) serve public data (candle charts, carnage events, SOL price). No auth bypass possible because there is no auth to bypass.

### AIP-099 Check: Sensitive Data in NEXT_PUBLIC_ Variables
**Result:**
- `NEXT_PUBLIC_RPC_URL`: Contains Helius API key in the URL query string. Currently devnet free-tier. Mainnet risk documented.
- `NEXT_PUBLIC_SENTRY_DSN`: Sentry DSN with ingest key. Semi-public by design (Sentry says DSNs are not secrets), but enables spam error submission.
- `NEXT_PUBLIC_DEMO_MODE`: Boolean flag, not sensitive.
- `NEXT_PUBLIC_SOLANA_CLUSTER`: Cluster name string, not sensitive.
- `NEXT_PUBLIC_DOCS_URL`: Documentation URL, not sensitive.
- `NEXT_PUBLIC_CURVE_PHASE`: Boolean flag, not sensitive.

### AIP-101 Check: No Data Cleanup on Logout/Disconnect
**Result:** Confirmed. Neither disconnect handler clears localStorage. Currently mitigated by the fact that stored data contains only non-sensitive preferences. If future features add stored data (e.g., recent transactions, address book, preferred wallets), this gap would need addressing.

### Hooks Rules Violation in useCurveState
`useCurveState.ts:211` returns early before `useState` calls when `DEMO_MODE` is true:
```typescript
if (DEMO_MODE) {
  return { crime: getDemoCurveState("crime"), ... };
}
const [crime, setCrime] = useState<CurveStateData | null>(null);
```
This violates React's rules-of-hooks (hooks must be called unconditionally). Since `DEMO_MODE` is a build-time constant (`NEXT_PUBLIC_DEMO_MODE`), the value never changes at runtime within a single build, so React's hook order is consistent within a given build. However, this is still technically undefined behavior and could cause issues with React strict mode or future React versions.

## Cross-Focus Intersections

### SEC-02 (Secrets & Credentials)
The Helius API key `[REDACTED-DEVNET-HELIUS-KEY]` appears in:
1. `shared/constants.ts:474` as `HELIUS_API_KEY` (exported, importable by client code)
2. `shared/programs.ts:22` inside `DEVNET_RPC_URL` (imported by client code)
3. `app/.env.local:1` as `NEXT_PUBLIC_RPC_URL` value

The comment in `shared/constants.ts:471` says "Used for webhook management API calls." If this key has webhook management permissions, it's more sensitive than a simple RPC key.

### CHAIN-02 (RPC Node Trust)
The connection singleton at `app/lib/connection.ts` uses "confirmed" commitment by default. Pool prices, epoch state, and balances all use this commitment level. For display purposes this is acceptable (FP-018), but the swap execution path in `useSwap.ts:740` fetches `getLatestBlockhash("confirmed")` which is used for transaction submission -- this is the correct pattern.

### LOGIC-01 (Financial Math)
`useSwap.ts:297-299` uses `parseFloat` + `Math.floor` for base-unit conversion. This is a client-side preview calculation; the on-chain program is authoritative. The client-computed `minimumOutput` is passed as a slippage floor to the on-chain instruction, which means a rounding error could theoretically set a slightly wrong slippage floor -- but `Math.floor` errs on the conservative side (under-count), making the slippage check stricter, not weaker.

## Cross-Reference Handoffs

| Target Agent | Item | File:Line |
|-------------|------|-----------|
| SEC-02 | Helius API key in client bundle (3 paths) | `shared/programs.ts:22`, `shared/constants.ts:474`, `app/.env.local:1` |
| CHAIN-02 | RPC URL resolution chain with embedded API key | `app/lib/connection.ts:33` |
| WEB-01 | CustomEvent dispatch surface for XSS-assisted rate-limit attacks | `app/hooks/useTokenBalances.ts:172` |
| ERR-01 | Sentry DSN in NEXT_PUBLIC_ variable | `app/lib/sentry.ts:30` |

## Risk Observations

1. **(Medium) Helius API key in client bundle**: Two independent paths expose the same key. For mainnet, need backend RPC proxy or separate client-facing key with lower permissions. Already documented in mainnet readiness assessment.

2. **(Medium) No localStorage cleanup on disconnect**: Settings persist across wallet sessions. Low risk today (non-sensitive data), higher risk if feature scope expands.

3. **(Medium) Demo mode hook violation**: `useCurveState.ts:211` early return violates rules-of-hooks. Build-time constant mitigates runtime risk but is technically undefined behavior.

4. **(Low) Sentry DSN exposed via NEXT_PUBLIC_**: Enables spam error submission to Sentry project. Standard practice for browser Sentry, but worth noting.

5. **(Low) CustomEvent balance sync surface**: Any in-page script can trigger RPC request burst via `token-balances-refresh` event dispatch.

6. **(Low) Floating-point rounding in base-unit conversion**: `Math.floor` makes this conservative (under-count), and on-chain is authoritative. Informational only.

## Novel Attack Surface Observations

The `CustomEvent`-based cross-instance balance synchronization (`useTokenBalances.ts:172`) is an unusual pattern. While the self-dispatch guard prevents infinite loops within the hook, a malicious browser extension or XSS payload could:
1. Dispatch `CustomEvent("token-balances-refresh")` rapidly in a loop
2. Cause all active `useTokenBalances` instances to fire simultaneous RPC requests
3. Hit Helius rate limits (450 req/s on free tier), degrading service for the legitimate user

This is a DoS vector against the user's own session, not a data theft vector. The attack requires existing code execution in the page context (XSS or malicious extension).

## Questions for Other Focus Areas

1. **For SEC-02:** Does the Helius API key `[REDACTED-DEVNET-KEY]-...` have webhook management permissions? If so, an attacker could register malicious webhooks using the client-exposed key.
2. **For WEB-01:** Are there any XSS vectors that could enable the CustomEvent-based RPC rate-limit attack?
3. **For INFRA-05:** Is `NEXT_PUBLIC_RPC_URL` set at build time on Railway? If the mainnet RPC URL contains a paid API key, it would be baked into the production bundle.

## Raw Notes

- No `sessionStorage` usage found anywhere
- No `IndexedDB` usage found anywhere
- No `document.cookie` usage found anywhere
- No `Cookies.set` or cookie library imports found
- No `AsyncStorage` (React Native) usage found (web app only)
- No service workers found (no cache poisoning risk)
- `crypto.randomUUID()` used correctly in `app/lib/sentry.ts:37` for event IDs (CSPRNG)
- wallet-adapter's `autoConnect` prop in `providers.tsx:43` may persist wallet selection in its own internal storage -- this is wallet-adapter's responsibility, not the app's
- The `useChartSSE` hook (`app/hooks/useChartSSE.ts`) processes SSE events via `JSON.parse(event.data)`. Malformed data is caught and silently ignored (line 82-84). The SSE server is internal (`/api/sse/candles`), not user-controlled.
