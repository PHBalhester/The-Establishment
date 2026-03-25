---
task_id: db-phase1-chain-03
provides: [chain-03-findings, chain-03-invariants]
focus_area: chain-03
files_analyzed: [app/providers/providers.tsx, app/hooks/useProtocolWallet.ts, app/hooks/useSwap.ts, app/hooks/useStaking.ts, app/components/wallet/ConnectModal.tsx, app/components/station/WalletStation.tsx, app/lib/mobile-wallets.ts, app/lib/swap/hook-resolver.ts, app/lib/curve/hook-accounts.ts, app/lib/swap/swap-builders.ts, app/lib/swap/multi-hop-builder.ts, app/lib/connection.ts, app/app/api/rpc/route.ts, app/providers/SettingsProvider.tsx, app/providers/ClusterConfigProvider.tsx, app/lib/protocol-config.ts, app/lib/confirm-transaction.ts, app/components/launch/BuyForm.tsx, app/components/launch/SellForm.tsx, app/components/launch/RefundPanel.tsx, app/components/launch/BuySellPanel.tsx, app/lib/swap/route-engine.ts, app/app/layout.tsx]
finding_count: 8
severity_breakdown: {critical: 0, high: 1, medium: 3, low: 4}
---
<!-- CONDENSED_SUMMARY_START -->
# Wallet Integration & Adapter Security (CHAIN-03) -- Condensed Summary

## Key Findings (Top 8)

1. **autoConnect enabled without user gesture**: WalletProvider uses `autoConnect` (truthy) at `app/providers/providers.tsx:47`, which automatically reconnects the last-used wallet on page load. This bypasses explicit user confirmation and reconnects to whatever wallet-standard provider was last selected, including potentially a newly-injected malicious extension that registered with the same name.

2. **Empty wallets array relies entirely on auto-detection**: `providers.tsx:43` passes `wallets = useMemo(() => [], [])` -- no explicit adapter list. All wallet selection is delegated to wallet-standard auto-detection. While this is the modern recommended approach, it means ANY browser extension registering as a wallet-standard provider appears in the wallet list with no filtering or verification.

3. **Sign-then-send pattern bypasses wallet simulation preview (ACCEPTED_RISK, H048)**: `useProtocolWallet.ts:87-121` uses `signTransaction()` + `sendRawTransaction()` instead of `sendTransaction()`. This bypasses the wallet's built-in transaction simulation and preview display. The user signs without the wallet showing "what this transaction will do." Project documentation indicates this is an accepted risk due to Phantom's devnet TX dropping issue. Need to verify this decision is revisited for mainnet.

4. **skipPreflight:true on multi-hop and bonding curve TXs**: `multi-hop-builder.ts:381` and `BuyForm.tsx:191` / `SellForm.tsx:200` use `skipPreflight: true`. Combined with sign-then-send, this means the user signs a transaction that is neither simulated by the wallet nor by the RPC node before broadcast. A malformed or manipulated transaction will land on-chain and fail, costing the user fees.

5. **No wallet name/type validation on connection**: `ConnectModal.tsx:50-53` and `WalletStation.tsx:29-31` call `select(walletName as any)` without checking that the selected wallet name matches a known-good list. Any registered wallet-standard extension with any name can be selected.

6. **Default slippage 500 BPS (5%) is high for mainnet**: `SettingsProvider.tsx:170` defaults `slippageBps: 500`. This is known (H015 NOT_FIXED). For a mainnet DeFi app, 5% default slippage is a significant MEV extraction surface. Users who never change settings are exposed.

7. **localStorage slippage tampering via browser console**: `SettingsProvider.tsx:186-223` reads slippage from `localStorage` with type checking but no upper-bound enforcement at the swap execution layer. The `loadSettings()` caps `slippageBps` at 10000, but the `setSlippageBps` callback at line 260 does not re-validate. An attacker with console access could set extreme slippage values via React devtools. On-chain enforcement is the safety net (per INV-OC1).

8. **Wallet disconnect does not clear sensitive state**: No explicit cleanup of quote data, transaction state, or pending operations on wallet disconnect. `useSwap.ts` and `useStaking.ts` check `wallet.connected` before execution but do not subscribe to disconnect events to abort in-flight operations.

## Critical Mechanisms

- **Wallet Provider Setup**: `providers.tsx:33-83` -- ConnectionProvider (RPC proxy endpoint) > WalletProvider (empty array, autoConnect) > ClusterConfigProvider > SettingsProvider. The empty wallets array with autoConnect means all wallet-standard extensions auto-register and auto-reconnect.

- **Sign-Then-Send Flow**: `useProtocolWallet.ts:87-121` -- signTransaction() for signing only, then sendRawTransaction() through our Helius RPC proxy. Implemented to work around Phantom's devnet TX dropping when using signAndSendTransaction. All TX consumers (useSwap, useStaking, BuyForm, SellForm, RefundPanel) use this abstraction.

- **RPC Proxy**: `app/api/rpc/route.ts:31-59` -- Method allowlist prevents arbitrary RPC calls. `sendTransaction` is in the allowlist (required for sign-then-send). The proxy keeps the Helius API key server-side with rate limiting and failover.

- **Transfer Hook Resolution**: `hook-resolver.ts:46-78` and `hook-accounts.ts:36-68` -- Deterministic PDA derivation (no RPC round-trip). Uses `PROGRAM_IDS.TRANSFER_HOOK` from cluster-aware `protocol-config.ts`. These run client-side before signing.

- **Transaction Confirmation**: `confirm-transaction.ts:29-67` -- HTTP polling of `getSignatureStatuses` instead of WebSocket subscription. Checks both `confirmed` and `finalized` status with blockhash expiry tracking.

## Invariants & Assumptions

- INVARIANT: All transactions are built client-side with known instructions -- `useSwap.ts:700-753`, `useStaking.ts:560-580`, `BuyForm.tsx:160-190`, `SellForm.tsx:170-200`. No server-built transaction signing (prevents OC-106 blind signing).
- INVARIANT: The wallet's `publicKey` is used as `feePayer` -- `useSwap.ts:759`, `useStaking.ts:576`. Transaction fee is always paid by the connected wallet.
- INVARIANT: Transfer Hook accounts are derived deterministically from on-chain seeds -- `hook-resolver.ts:54-76`. No RPC data used in PDA derivation (immune to RPC response spoofing for hook accounts).
- ASSUMPTION: Wallet adapter signTransaction() returns a properly signed transaction that has not been tampered with -- UNVALIDATED (trust placed in wallet extension).
- ASSUMPTION: `autoConnect` reconnects to the same legitimate wallet the user previously selected -- UNVALIDATED (vulnerable to wallet-standard provider replacement between sessions).
- ASSUMPTION: The sign-then-send pattern will be revisited for mainnet (per MEMORY.md note) -- NOT YET VALIDATED. If Phantom mainnet does not drop TXs, switching back to `sendTransaction()` would restore wallet simulation preview.
- ASSUMPTION: On-chain slippage enforcement (minimumOutput) protects users even with client-side slippage manipulation -- VALIDATED per INV-OC1 from HANDOVER.md.

## Risk Observations (Prioritized)

1. **[HIGH] Sign-then-send on mainnet without wallet preview**: `useProtocolWallet.ts:87-121` -- If this pattern ships to mainnet without the wallet's built-in simulation preview, users have no visual confirmation of what they are signing. The MEMORY.md says "Revisit for mainnet." If not revisited, this is a significant UX security gap. Impact: users cannot verify transaction contents before signing; a supply-chain-compromised dependency could inject instructions.

2. **[MEDIUM] autoConnect with empty adapter list**: `providers.tsx:43-47` -- autoConnect reconnects to the last wallet on page load without user gesture. Combined with empty wallets array (all wallet-standard providers accepted), a malicious extension installed between sessions would auto-connect. Impact: session hijacking if malicious extension replaces the legitimate wallet.

3. **[MEDIUM] skipPreflight:true on bonding curve operations**: `BuyForm.tsx:191`, `SellForm.tsx:200` -- These are NOT multi-hop v0 TXs (which have a documented reason for skipPreflight). Regular legacy transactions should use preflight simulation to catch errors before broadcast. Impact: users pay TX fees for guaranteed-to-fail transactions.

4. **[MEDIUM] No double-submit guard on executeRoute**: `useSwap.ts:839-900` -- The `executeRoute` callback does not check if `status !== "idle"` before proceeding. While `executeSwap` is guarded by the `connected && quote` check, rapid double-clicks could trigger concurrent route executions. H034 was marked FIXED but should be re-verified for the route execution path.

5. **[LOW] Default 5% slippage for mainnet**: `SettingsProvider.tsx:170` -- 500 BPS default significantly widens MEV extraction window. Known issue H015 NOT_FIXED.

6. **[LOW] Missing wallet error event handling**: No `onError` handler configured on WalletProvider. Wallet adapter errors (network failures, user rejection, extension crash) are caught per-transaction in try/catch but there is no global error handler.

7. **[LOW] Wallet icon loaded from adapter without sanitization**: `ConnectModal.tsx:127-132`, `WalletStation.tsx:64-69` -- Wallet adapter icons (`wallet.adapter.icon`) are rendered via `<img src={...}>`. These are data URIs or URLs provided by the wallet extension. A malicious extension could provide a tracking pixel URL.

8. **[LOW] No graceful handling of wallet popup blocking**: If the browser blocks the wallet signing popup (popup blocker), the `signTransaction()` call in `useProtocolWallet.ts:102` will throw. The error is caught generically but the UX does not specifically guide the user to allow popups.

## Novel Attack Surface

- **Wallet-standard auto-registration + autoConnect = silent wallet swap**: Unlike the deprecated `window.solana` pattern (which this project correctly avoids), wallet-standard providers register through a discovery mechanism. With `autoConnect` and an empty adapter list, a newly-installed malicious extension that registers with the same name as the user's legitimate wallet would auto-connect on next page load. The user would see no difference in the UI. The malicious wallet could then modify transactions before presenting them for "signing" (which it controls). This is a protocol-level concern with wallet-standard, not specific to this codebase, but the combination of `autoConnect` + empty adapter list maximizes exposure.

- **Sign-then-send creates an interception window**: Between `signTransaction()` returning and `sendRawTransaction()` being called (~0-50ms), the signed transaction exists in client-side JavaScript memory. A compromised browser extension with access to the page context could intercept the signed serialized bytes and submit them to a different RPC node (e.g., for sandwich setup). With `signAndSendTransaction`, the wallet handles submission internally, reducing this window.

## Cross-Focus Handoffs

- **CHAIN-05 (MEV & Transaction Ordering)**: The sign-then-send pattern sends transactions through the public Helius RPC (not a private mempool). Combined with default 5% slippage (H015), this exposes all swap transactions to sandwich attacks. Verify whether MEV protection was addressed.
- **SEC-01 (Access Control)**: Verify that the RPC proxy method allowlist in `app/api/rpc/route.ts` cannot be bypassed to make unauthorized RPC calls (e.g., `getPrivateKey` or similar non-standard methods).
- **FE-01 (Client State)**: The SettingsProvider stores slippage in localStorage. Verify that localStorage manipulation cannot override on-chain safety checks.
- **ERR-02 (Error Handling)**: Transaction confirmation polling in `confirm-transaction.ts` has a 90s timeout but no user-visible countdown. Verify error UX for timeout scenarios.

## Trust Boundaries

The wallet integration operates at the critical boundary between user intent and on-chain execution. All transactions are built client-side (no blind server-TX signing), which is the correct pattern. The primary trust is placed in the wallet extension (signTransaction) and the RPC proxy (sendRawTransaction). The RPC proxy is method-allowlisted and rate-limited. The wallet extension is trusted implicitly via wallet-standard -- no application-level verification of the wallet provider's identity is performed. On-chain enforcement (minimumOutput, program constraints) serves as the ultimate safety net regardless of client-side manipulation. The sign-then-send pattern trades wallet simulation preview for RPC endpoint control, which is a documented tradeoff that should be revisited for mainnet.
<!-- CONDENSED_SUMMARY_END -->

---

# Wallet Integration & Adapter Security (CHAIN-03) -- Full Analysis

## Executive Summary

The Dr. Fraudsworth protocol uses `@solana/wallet-adapter-react` for wallet integration, following the modern wallet-standard approach. No deprecated patterns (`window.solana`, `window.phantom`) are used. The project does NOT use message signing (SIWS) for authentication -- all wallet interaction is transaction signing for DeFi operations.

The primary security concern is the **sign-then-send** pattern (`useProtocolWallet.ts`), which was adopted to work around a Phantom devnet issue but bypasses the wallet's built-in transaction simulation preview. This is documented as an accepted risk (H048) with a note to revisit for mainnet. Combined with `autoConnect` and an empty adapter list, the wallet integration maximizes convenience but also maximizes the attack surface for malicious wallet extensions.

No critical vulnerabilities were identified. The codebase correctly:
- Builds all transactions client-side (no blind server-TX signing)
- Uses on-chain enforcement as the ultimate safety net
- Routes all browser RPC through a method-allowlisted proxy
- Uses deterministic PDA derivation for Transfer Hook accounts
- Implements HTTP polling for transaction confirmation (avoids WS reliability issues)

## Scope

### Files Analyzed (23 total)

**Layer 3 -- Full Source Read (12 files):**
1. `app/providers/providers.tsx` (83 LOC) -- Wallet provider setup, autoConnect, endpoint
2. `app/hooks/useProtocolWallet.ts` (131 LOC) -- Sign-then-send wrapper
3. `app/hooks/useSwap.ts` (955 LOC) -- Full swap lifecycle
4. `app/hooks/useStaking.ts` (715 LOC) -- Full staking lifecycle
5. `app/components/wallet/ConnectModal.tsx` (210 LOC) -- Wallet selection UI
6. `app/components/station/WalletStation.tsx` (146 LOC) -- Alternative wallet selection
7. `app/lib/swap/hook-resolver.ts` (79 LOC) -- Transfer Hook PDA resolution
8. `app/lib/curve/hook-accounts.ts` (69 LOC) -- Bonding curve hook accounts
9. `app/lib/connection.ts` (88 LOC) -- RPC connection factory
10. `app/app/api/rpc/route.ts` (189 LOC) -- RPC proxy with method allowlist
11. `app/lib/confirm-transaction.ts` (68 LOC) -- HTTP polling confirmation
12. `app/lib/protocol-config.ts` (74 LOC) -- Cluster-aware address resolution

**Layer 2 -- Signature Scan (11 files):**
13. `app/providers/SettingsProvider.tsx` (324 LOC) -- Slippage/fee persistence
14. `app/providers/ClusterConfigProvider.tsx` (66 LOC) -- Cluster context
15. `app/lib/mobile-wallets.ts` (33 LOC) -- Mobile deep-link definitions
16. `app/lib/swap/swap-builders.ts` (507 LOC) -- TX instruction assembly
17. `app/lib/swap/multi-hop-builder.ts` (416 LOC) -- Atomic multi-hop TX
18. `app/lib/swap/route-engine.ts` (445 LOC) -- Route optimization (pure functions)
19. `app/components/launch/BuyForm.tsx` -- Bonding curve buy TX
20. `app/components/launch/SellForm.tsx` -- Bonding curve sell TX
21. `app/components/launch/RefundPanel.tsx` -- Refund TX
22. `app/components/launch/BuySellPanel.tsx` -- Combined launch panel
23. `app/app/layout.tsx` (31 LOC) -- Root layout, Providers wrapper

## Key Mechanisms

### 1. Wallet Provider Hierarchy

```
RootLayout (app/layout.tsx)
  └─ Providers (app/providers/providers.tsx)
       ├─ ConnectionProvider (endpoint: /api/rpc proxy)
       │    └─ Connection uses "confirmed" commitment
       ├─ WalletProvider (wallets: [], autoConnect: true)
       │    └─ All wallet-standard extensions auto-detected
       ├─ ClusterConfigProvider (NEXT_PUBLIC_CLUSTER)
       ├─ SettingsProvider (slippage: 500 BPS, priority: medium)
       ├─ AudioProvider
       ├─ ModalProvider
       └─ ToastProvider
```

**Analysis:**
- `ConnectionProvider` endpoint is set to `/api/rpc` (relative to current origin). This correctly avoids exposing the Helius API key. The endpoint is resolved using `window.location.origin` on client side.
- `WalletProvider` receives an empty array for `wallets` prop. This means no explicit adapter constructors are included. Instead, the provider auto-detects all wallet-standard registered providers. This is the modern recommended approach per Solana wallet-adapter docs.
- `autoConnect` is set to `true` (it's a truthy prop without explicit value). This means on page load, the provider attempts to reconnect the previously-connected wallet without user interaction.

### 2. Sign-Then-Send Flow (useProtocolWallet.ts)

The core signing abstraction wraps wallet-adapter's `signTransaction()`:

```
1. Check wallet.publicKey and signTransaction exist
2. Call signTransaction(tx) -- single wallet popup
3. Serialize signed transaction
4. Call connection.sendRawTransaction(serialized, opts)
5. Return signature
```

**Why this exists (documented):**
- Phantom's `signAndSendTransaction` sends TXs via Phantom's internal RPC
- On devnet, Phantom's RPC silently drops transactions
- Using signTransaction + our RPC gives control over submission endpoint

**Security implications:**
- Wallet simulation preview is bypassed (the wallet doesn't show "what this TX will do")
- The Blowfish transaction scanner (integrated in Phantom/Solflare) may still scan the TX during signTransaction, but the preview is less informative
- There is a brief window (~0ms-50ms) where the signed TX exists in JS memory before submission

**All consumers of this abstraction:**
- `useSwap.ts:763` -- AMM swap execution
- `useSwap.ts:875` -- Multi-hop route execution (via executeAtomicRoute)
- `useStaking.ts:580` -- Staking transaction execution
- `BuyForm.tsx:190` -- Bonding curve purchase
- `SellForm.tsx:199` -- Bonding curve sell
- `RefundPanel.tsx:207` -- Bonding curve refund

### 3. RPC Proxy (app/api/rpc/route.ts)

The RPC proxy is the only browser-facing RPC endpoint. It:
1. Rate-limits per client IP (H024 fix)
2. Validates JSON-RPC payload structure
3. Checks method against allowlist (26 methods)
4. Forwards to Helius with failover (H047 fix)
5. Records RPC credits per method

**Allowlist includes `sendTransaction`** -- this is necessary because the sign-then-send pattern calls `connection.sendRawTransaction()` from the browser, which ultimately calls the `sendTransaction` RPC method through the proxy.

**No methods that could leak secrets are in the allowlist.** Only account queries, transaction lifecycle, and Helius-specific priority fee estimation.

### 4. Transfer Hook Account Resolution

Both `hook-resolver.ts` and `hook-accounts.ts` derive Transfer Hook remaining_accounts using `PublicKey.findProgramAddressSync()`. This is:
- **Deterministic**: Same inputs always produce same PDAs
- **No RPC dependency**: PDA derivation is pure math, no network calls
- **Cluster-aware**: Uses `PROGRAM_IDS.TRANSFER_HOOK` from `protocol-config.ts`

The hook program ID comes from the cluster config, which is resolved at build time from `NEXT_PUBLIC_CLUSTER`. A misconfigured cluster env var would cause wrong hook PDAs, but this would result in transaction failure (not fund loss) because the on-chain program validates PDA seeds.

### 5. Transaction Confirmation

`confirm-transaction.ts` uses HTTP polling instead of WebSocket subscription:
- Polls `getSignatureStatuses` every 2 seconds
- Requires `confirmed` or `finalized` status (not `processed`)
- Checks blockhash expiry via `getBlockHeight`
- 90-second safety timeout

This is more reliable than WebSocket-based confirmation and correctly uses `confirmed` commitment for financial operations (SP-015 pattern).

## Trust Model

### Trust Relationships

| Component | Trusts | Trust Type | Validation |
|-----------|--------|------------|------------|
| Browser client | Wallet extension | Full (signing) | None (wallet-standard registration) |
| Browser client | RPC proxy | Partial (submission) | Method allowlist |
| RPC proxy | Helius RPC | Full (data) | API key authentication |
| On-chain programs | Transaction contents | Cryptographic | PDA seeds, account ownership |
| User | Transaction preview | None (bypassed) | sign-then-send pattern |

### Trust Boundary Analysis

1. **User -> Wallet Extension**: The user trusts the wallet extension to correctly display and sign transactions. With sign-then-send, the wallet does not preview the transaction effects.

2. **Client Code -> Wallet Adapter**: The client code trusts that `signTransaction()` returns a validly-signed transaction and that the wallet's `publicKey` property is accurate. No server-side verification of the wallet's identity occurs (no SIWS).

3. **Client Code -> RPC Proxy**: The browser sends raw serialized transactions through the proxy. The proxy forwards without inspection. The method allowlist prevents abuse but does not inspect transaction contents.

4. **RPC Proxy -> Helius**: Full trust. API key authenticates the project but does not validate individual transactions.

## State Analysis

### Client-Side State

| State | Storage | Scope | Sensitivity |
|-------|---------|-------|-------------|
| Connected wallet pubkey | React state (useWallet) | Session | Public (wallet address) |
| Last connected wallet | localStorage (wallet-adapter internal) | Persistent | Low (wallet name) |
| Slippage settings | localStorage (dr-fraudsworth-settings) | Persistent | Low (user preference) |
| Priority fee preset | localStorage (dr-fraudsworth-settings) | Persistent | Low (user preference) |
| Quote data | React state (useSwap) | Component | None (derived from public pool data) |
| TX signature | React state (useSwap/useStaking) | Component | Public (on-chain data) |

**No sensitive data is persisted to localStorage.** Previous audit (H074) confirmed only slippage/volume prefs are stored.

### Server-Side State

The RPC proxy maintains a `lastSuccessfulEndpoint` module-level variable for sticky routing. This is not security-sensitive.

## Dependencies

| Package | Version | Role | Risk |
|---------|---------|------|------|
| @solana/wallet-adapter-react | Latest | Wallet integration | Core dependency, well-maintained |
| @solana/wallet-adapter-base | Latest | Adapter types | Core dependency |
| @solana/web3.js | v1.x | Transaction construction | Core dependency |
| @solana/spl-token | Latest | Token account helpers | Core dependency |
| @coral-xyz/anchor | 0.32 | IDL interaction | Core dependency |

No custom wallet adapter implementations. No third-party signing libraries. No SIWS/authentication dependencies.

## Focus-Specific Analysis

### OC-118: Wallet Adapter Event Injection

**Status: NOT VULNERABLE**

The project does NOT use `window.solana`, `window.phantom`, or any deprecated provider detection patterns. Zero grep matches for these patterns across the entire codebase.

The project uses `@solana/wallet-adapter-react` with the standard `useWallet()` hook, which communicates through the wallet-standard protocol. Custom event listeners on wallet objects are not used.

**One concern**: The empty `wallets` array in `providers.tsx:43` means all wallet-standard providers are accepted. This is the standard pattern but means a malicious extension registering as a wallet-standard provider would appear in the wallet list. Mitigation: wallet-adapter filters to installed/loadable wallets, so only extensions actually present in the browser appear.

### OC-119: Message Signing Misuse (Replay)

**Status: NOT APPLICABLE**

Zero `signMessage` calls found in the entire codebase. No SIWS/sign-in-with-solana implementation exists. The project does not use wallet-based authentication -- all wallet interaction is transaction signing for DeFi operations.

**No authentication system exists that could be vulnerable to message replay.**

### OC-120: Wallet Spoofing / Fake Wallet Injection

**Status: PARTIALLY MITIGATED**

The project correctly avoids `window.solana` and uses wallet-standard through wallet-adapter-react. However:

1. **No explicit adapter list**: `wallets = useMemo(() => [], [])` means any wallet-standard extension is accepted. A malicious extension could register with a legitimate name/icon.

2. **autoConnect reconnects blindly**: If a malicious extension replaces a legitimate wallet between sessions, autoConnect would reconnect to the malicious extension on next page load.

3. **No trusted wallet name validation**: `ConnectModal.tsx` and `WalletStation.tsx` render all detected wallets without checking against a known-good list.

**Mitigation**: This is a protocol-level concern with wallet-standard, not specific to this project. The primary defense is the on-chain program constraints (minimumOutput, PDA validation). A spoofed wallet could modify destination addresses, but the on-chain program validates all account addresses via PDA seeds.

### OC-121: Missing Nonce in SIWS

**Status: NOT APPLICABLE**

No SIWS implementation exists. No message signing for authentication.

### OC-106: Transaction Instruction Injection

**Status: NOT VULNERABLE**

All transactions are built client-side using known program instructions:
- `useSwap.ts` builds via `swap-builders.ts` (known Anchor program methods)
- `useStaking.ts` builds via `staking-builders.ts` (known Anchor program methods)
- `BuyForm.tsx` / `SellForm.tsx` build via `curve-tx-builder.ts`
- Multi-hop routes build via `multi-hop-builder.ts`

No server endpoint returns serialized transactions for the client to sign blindly. The MEMORY.md project decision is explicit: "Build transaction client-side with known instructions."

### OC-111: Transaction Content Not Shown to User

**Status: PARTIALLY VULNERABLE (ACCEPTED RISK, H048)**

The sign-then-send pattern (`useProtocolWallet.ts:87-121`) bypasses the wallet's built-in simulation preview. The user sees a signing prompt but NOT a detailed preview of what the transaction will do (account balance changes, instruction list, etc.).

Modern wallets (Phantom, Solflare) use Blowfish or similar transaction simulators to show users what a transaction will do before signing. With `signTransaction()` (vs `sendTransaction()`), the wallet may still scan the transaction but provides less information.

**Per MEMORY.md**: "Revisit for mainnet" -- the sign-then-send pattern was adopted because Phantom's devnet RPC drops transactions. On mainnet, Phantom's RPC should work correctly, making it possible to switch back to `sendTransaction()` and restore the full preview.

### AIP-054: Using signTransaction Instead of signAndSendTransaction

**Status: PRESENT (DOCUMENTED DECISION)**

This AI-pitfall pattern exactly matches the project's implementation in `useProtocolWallet.ts`. The code comment at line 16-24 documents the rationale. The MEMORY.md entry for "Wallet adapter" confirms the decision and notes it should be revisited for mainnet.

### AIP-056: Static SIWS Message Without Nonce

**Status: NOT APPLICABLE** -- No SIWS implementation exists.

### AIP-057: Using Deprecated window.solana Provider

**Status: NOT PRESENT** -- Zero matches for deprecated patterns.

### AIP-063: Blind Signing of Server-Built Transactions

**Status: NOT PRESENT** -- All transactions are built client-side.

## Cross-Focus Intersections

### CHAIN-03 x CHAIN-05 (MEV Protection)

The sign-then-send pattern sends transactions through the Helius RPC (via /api/rpc proxy), which is a public mempool endpoint. No Jito bundles, no private mempool, no MEV-protected RPC. Combined with:
- Default 5% slippage (H015)
- `skipPreflight: true` on multi-hop and bonding curve TXs

This creates a significant MEV extraction surface for swap transactions. The multi-hop builder explicitly documents this (`multi-hop-builder.ts:374-375`).

### CHAIN-03 x SEC-02 (Signature Verification)

The RPC proxy does not verify the signature on submitted transactions. It blindly forwards the `sendTransaction` call to Helius. This is correct behavior (the on-chain validator verifies signatures), but means the proxy cannot detect if a client submits a manipulated transaction.

### CHAIN-03 x FE-01 (Client State)

Slippage and priority fee settings are stored in localStorage and read on each swap. An attacker with browser console access could manipulate these values. However:
- `loadSettings()` validates types and ranges (0-10000 for slippage)
- On-chain `minimumOutput` is the actual safety net
- `setSlippageBps()` does not re-validate (minor gap)

### CHAIN-03 x CHAIN-04 (State Synchronization)

Pool reserves used for quoting (`usePoolPrices`) may be stale. The quote engine computes `minimumOutput` from potentially-stale reserves. If reserves changed between quoting and transaction execution, the actual output could be lower than quoted. The on-chain slippage check (`minimumOutput` parameter) protects against this.

## Cross-Reference Handoffs

| Target Agent | Item | Context |
|-------------|------|---------|
| **CHAIN-05** | Sign-then-send + public mempool + 5% default slippage | All swap TXs are MEV-extractable |
| **SEC-01** | RPC proxy method allowlist completeness | Verify no dangerous methods can bypass |
| **FE-01** | localStorage slippage manipulation | Verify on-chain safety net is sufficient |
| **ERR-02** | TX confirmation 90s timeout UX | Verify user sees meaningful error |
| **CHAIN-04** | Stale pool reserves in quote | Verify minimumOutput is safe with stale data |
| **LOGIC-01** | Double-submit on executeRoute | H034 may not cover route execution path |

## Risk Observations

### R1: Sign-Then-Send on Mainnet (HIGH)

**File**: `app/hooks/useProtocolWallet.ts:87-121`
**Impact**: Users cannot verify transaction contents before signing
**Likelihood**: Certain if pattern ships to mainnet
**Mitigation**: MEMORY.md notes "Revisit for mainnet." Switching to `sendTransaction()` on mainnet would restore wallet preview.
**Recommendation**: Before mainnet launch, test whether Phantom's mainnet RPC correctly handles `sendTransaction()`. If so, switch back. If not, add explicit transaction simulation and display in the UI.

### R2: autoConnect + Empty Adapter List (MEDIUM)

**File**: `app/providers/providers.tsx:43-47`
**Impact**: Silent reconnection to potentially-malicious wallet extension
**Likelihood**: Low (requires user to install malicious extension)
**Mitigation**: On-chain program constraints protect against fund theft even with malicious wallet
**Recommendation**: Consider adding a known-good wallet name list for display filtering (not blocking, since wallet-standard auto-detection is the correct approach). Alternatively, set `autoConnect={false}` for first-visit users and only enable after explicit consent.

### R3: skipPreflight on Non-v0 Bonding Curve TXs (MEDIUM)

**File**: `app/components/launch/BuyForm.tsx:191`, `app/components/launch/SellForm.tsx:200`
**Impact**: Users pay TX fees for guaranteed-to-fail transactions
**Likelihood**: Moderate (any account state issue causes on-chain failure)
**Mitigation**: None -- error is detected post-submission
**Recommendation**: Remove `skipPreflight: true` from bonding curve TXs. They are legacy Transaction objects (not v0), so the devnet simulation issue does not apply. H039 was NOT_FIXED.

### R4: executeRoute Double-Submit (MEDIUM)

**File**: `app/hooks/useSwap.ts:839-900`
**Impact**: Duplicate transactions if user clicks rapidly
**Likelihood**: Low (UI debounce exists, but not verified for this path)
**Mitigation**: On-chain idempotency varies by operation
**Recommendation**: Add `if (status !== "idle") return;` guard at the top of `executeRoute`.

### R5: Default 5% Slippage (LOW -- Known H015)

**File**: `app/providers/SettingsProvider.tsx:170`
**Impact**: MEV extraction on every swap from users who never change settings
**Recommendation**: Reduce to 100-200 BPS for mainnet. Documented issue.

### R6: No Global Wallet Error Handler (LOW)

**File**: `app/providers/providers.tsx:47`
**Impact**: Unhandled wallet adapter errors could leave UI in inconsistent state
**Recommendation**: Add `onError` prop to WalletProvider to catch and display wallet-level errors globally.

### R7: Wallet Icon from Extension (LOW)

**File**: `app/components/wallet/ConnectModal.tsx:127-132`
**Impact**: Tracking pixel via icon URL
**Recommendation**: Consider CSP `img-src` restrictions or rendering icons as data URIs only.

### R8: No Popup Blocking Guidance (LOW)

**File**: `app/hooks/useProtocolWallet.ts:102`
**Impact**: Poor UX when browser blocks wallet popup
**Recommendation**: Detect `WalletSignTransactionError` or similar and display specific guidance.

## Novel Attack Surface Observations

### Wallet-Standard Auto-Registration Poisoning

The wallet-standard protocol allows any browser extension to register as a Solana wallet provider. With `autoConnect` and an empty adapter list:

1. User connects Phantom and completes a swap
2. User installs a malicious extension that registers with wallet-standard
3. Next page load: `autoConnect` tries to reconnect to "Phantom"
4. If the malicious extension registered with the name "Phantom", wallet-adapter may connect to the malicious one instead
5. Malicious extension intercepts all signing requests

This is a wallet-standard protocol-level concern. The correct defense is wallet-adapter's built-in de-duplication (it tracks the adapter instance, not just the name). However, the exact de-duplication behavior should be verified.

### Signed Transaction Interception Window

The sign-then-send pattern creates a brief window:

```
signTransaction() returns → signed TX in JS memory → sendRawTransaction() called
```

A compromised browser extension with `document.all` or `window` access could:
1. Hook the `Connection.prototype.sendRawTransaction` method
2. Intercept the signed bytes
3. Submit to a different RPC (e.g., for sandwich setup)
4. Allow the original submission to proceed

This is mitigated if the user has transaction simulation enabled in their wallet (Blowfish scans happen during signTransaction), but the interception point is after signing.

### Mobile Deep-Link Open Redirect

`mobile-wallets.ts` constructs deep-link URLs like:
```
https://phantom.app/ul/browse/${encodeURIComponent(url)}
```

The `url` parameter is `window.location.href`. If an attacker can manipulate `window.location.href` (e.g., via an open redirect in the app), they could redirect the user to a phishing page inside Phantom's in-app browser. The `encodeURIComponent` prevents URL injection but not semantic manipulation.

## Questions for Other Focus Areas

1. **CHAIN-05**: Is there any plan to use Jito bundles or MEV-protected RPC for mainnet swap transactions?
2. **SEC-01**: Does the RPC proxy's method allowlist cover all edge cases? Could a batch request bypass the method check?
3. **FE-01**: Is the `dr-fraudsworth-settings` localStorage key accessible to other origins via any CSP or CORS misconfiguration?
4. **ERR-02**: What happens when pollTransactionConfirmation times out during a multi-hop route? Does the user know their TX might still land?
5. **CHAIN-04**: How stale can pool reserves get before the minimumOutput calculated from them becomes dangerous? Is the 30s SSE refresh fast enough?

## Raw Notes

### Grep Results -- No Deprecated Patterns
- `window.solana`: 0 matches
- `window.phantom`: 0 matches
- `signMessage`: 0 matches
- `siws`/`sign-in-with-solana`: 0 matches
- `__solana_wallets`: 0 matches

### Signing Paths Traced
All 6 signing consumers use `useProtocolWallet().sendTransaction`:
1. useSwap.ts:763 (direct swap)
2. useSwap.ts:875 (route swap via executeAtomicRoute)
3. useStaking.ts:580
4. BuyForm.tsx:190
5. SellForm.tsx:199
6. RefundPanel.tsx:207

No paths sign transactions outside the useProtocolWallet abstraction.

### Transaction Construction Verification
All transactions are built client-side using Anchor program methods:
- `getTaxProgram().methods.swapSolBuy(...)` -- swap-builders.ts
- `getTaxProgram().methods.swapSolSell(...)` -- swap-builders.ts
- `getVaultProgram().methods.convert(...)` -- swap-builders.ts
- `getStakingProgram().methods.stake(...)` -- staking-builders.ts
- Bonding curve: direct instruction construction via Anchor IDL

No API endpoints return serialized transactions for blind signing.

### Previous Audit Findings Status
- H048 (Sign-Then-Send): ACCEPTED_RISK -- documented, revisit for mainnet
- H015 (Default 5% Slippage): NOT_FIXED -- known
- H034 (Double-Submit): FIXED -- but needs re-verification for executeRoute path
- H039 (skipPreflight on BC): NOT_FIXED -- bonding curve TXs still use skipPreflight
- H074 (localStorage on disconnect): NOT VULNERABLE -- only prefs stored
- H075 (100% slippage): NOT VULNERABLE -- UI caps at 50%, on-chain enforces
- H127 (autoConnect internal state): NOT VULNERABLE -- standard behavior
