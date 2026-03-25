---
task_id: db-phase1-chain-01
provides: [chain-01-findings, chain-01-invariants]
focus_area: chain-01
files_analyzed:
  - app/hooks/useSwap.ts
  - app/hooks/useStaking.ts
  - app/hooks/useProtocolWallet.ts
  - app/lib/swap/swap-builders.ts
  - app/lib/swap/multi-hop-builder.ts
  - app/lib/swap/hook-resolver.ts
  - app/lib/swap/wsol.ts
  - app/lib/swap/quote-engine.ts
  - app/lib/swap/route-engine.ts
  - app/lib/staking/staking-builders.ts
  - app/lib/curve/curve-tx-builder.ts
  - app/lib/curve/hook-accounts.ts
  - app/lib/connection.ts
  - app/lib/anchor.ts
  - app/lib/protocol-config.ts
  - app/lib/confirm-transaction.ts
  - app/app/api/rpc/route.ts
  - app/components/launch/BuyForm.tsx
  - app/components/launch/SellForm.tsx
  - app/components/launch/RefundPanel.tsx
  - scripts/deploy/fix-carnage-wsol.ts
finding_count: 14
severity_breakdown: {critical: 0, high: 3, medium: 6, low: 5}
---
<!-- CONDENSED_SUMMARY_START -->
# CHAIN-01: Transaction Construction & Signing — Condensed Summary

## Key Findings (Top 10)

1. **skipPreflight:true on ALL bonding curve TXs (BuyForm, SellForm)**: Bypasses RPC simulation, allowing broken or maliciously-crafted transactions to be broadcast. On-chain slippage is the only safety net. — `app/components/launch/BuyForm.tsx:191`, `app/components/launch/SellForm.tsx:200`

2. **skipPreflight:true on atomic multi-hop routes**: `executeAtomicRoute` sends v0 TXs with `skipPreflight:true`. Documented as devnet workaround but ships to mainnet if not gated. — `app/lib/swap/multi-hop-builder.ts:381`

3. **Number precision loss in toBaseUnits**: `Math.floor(parsed * 10 ** decimals)` where decimals=9 (SOL) can lose precision for amounts > ~9,007 SOL (Number.MAX_SAFE_INTEGER / 10^9). Not yet critical for user amounts but is a latent overflow vector. — `app/hooks/useSwap.ts:238,306`

4. **Stale quote-to-execution gap (TOCTOU)**: Quote is computed with debounced pool reserves, but the transaction uses those same reserves minutes later. On-chain minimumOutput protects against loss, but the gap between quoted and actual output widens during volatile periods. — `app/hooks/useSwap.ts:690-808`

5. **No compute budget on bonding curve TXs**: BuyForm and SellForm build transactions without ComputeBudgetProgram instructions. Under network congestion, these transactions have lower priority and may repeatedly expire. — `app/components/launch/BuyForm.tsx:184-186`, `app/components/launch/SellForm.tsx:192-196`

6. **Module-level ALT cache never invalidated**: `cachedALT` in multi-hop-builder.ts is set once and never cleared. If the ALT is extended or recreated, stale cache causes transactions to fail silently. — `app/lib/swap/multi-hop-builder.ts:261`

7. **ATA existence check is TOCTOU race**: All builders check `getAccountInfo(ata)` then conditionally add `createAssociatedTokenAccountInstruction`. Between check and execution, another TX could create the ATA, causing an "already exists" error. Mitigated for multi-hop by CreateIdempotent conversion but NOT for single-hop. — `app/lib/swap/swap-builders.ts:229-240`

8. **sign-then-send pattern bypasses wallet simulation preview**: `useProtocolWallet` explicitly uses `signTransaction` + `sendRawTransaction` instead of `signAndSendTransaction`. Users sign without seeing wallet-provided simulation results (e.g., Blowfish, Phantom's TX preview). Documented as intentional devnet workaround (Phantom RPC issue), but persists on mainnet. — `app/hooks/useProtocolWallet.ts:87-121`

9. **Sell path WSOL ATA race in single-hop**: `buildSolSellTransaction` checks WSOL ATA existence and creates it if absent. But the sell instruction expects the ATA to already exist for the swap's SOL output. If the ATA check returns null but a concurrent TX creates it before execution, the createATA instruction fails (non-idempotent). — `app/lib/swap/swap-builders.ts:339-350`

10. **RPC proxy allows `sendTransaction`**: The method allowlist includes `sendTransaction` which lets browser code relay pre-signed transactions through the server RPC. Any transaction the wallet signs can be submitted. This is expected behavior but worth noting as it means the proxy trusts all wallet-signed content. — `app/app/api/rpc/route.ts:42`

## Critical Mechanisms

- **Transaction Build Pipeline**: `useSwap` -> `swap-builders.ts` (single-hop) or `multi-hop-builder.ts` (multi-hop) -> `useProtocolWallet.sendTransaction` (sign-then-send) -> `confirm-transaction.ts` (HTTP polling). The chain is: quote -> build instruction -> set blockhash -> wallet.signTransaction -> connection.sendRawTransaction -> pollTransactionConfirmation. — `app/hooks/useSwap.ts:690-808`, `app/lib/swap/multi-hop-builder.ts:298-416`

- **Hook Resolution**: Transfer Hook `remaining_accounts` are resolved deterministically via PDA derivation (no RPC call). Two separate resolvers exist: `hook-resolver.ts` for AMM/vault paths and `hook-accounts.ts` for bonding curve paths. Both produce 4 accounts per mint. Direction (source/dest) is critical and differs between buy/sell. — `app/lib/swap/hook-resolver.ts:46-78`, `app/lib/curve/hook-accounts.ts:36-68`

- **Atomic Multi-Hop Builder**: Strips per-step ComputeBudget instructions, converts ATA creates to idempotent, removes intermediate WSOL closeAccount instructions, then assembles into a single v0 TX with protocol ALT. Single wallet prompt. — `app/lib/swap/multi-hop-builder.ts:177-254`

- **RPC Proxy with Method Allowlist**: Browser RPC calls route through `/api/rpc` to protect Helius API key. Allowlist of 16 methods. Failover across up to 3 endpoints with sticky routing. Rate-limited per IP. — `app/app/api/rpc/route.ts:31-59`

- **Connection Singleton**: Browser always uses `/api/rpc` proxy (no direct Helius connection). Server uses `HELIUS_RPC_URL` directly with WebSocket endpoint. Commitment is `confirmed` by default. — `app/lib/connection.ts:54-87`

## Invariants & Assumptions

- INVARIANT: All AMM swap transactions include exactly 4 Transfer Hook remaining_accounts — enforced by `resolveHookAccounts` returning exactly 4 accounts at `app/lib/swap/hook-resolver.ts:72-77`
- INVARIANT: `getLatestBlockhash("confirmed")` is used for all user-facing transactions — enforced at `app/hooks/useSwap.ts:757`, `app/hooks/useStaking.ts:574`, `app/lib/swap/multi-hop-builder.ts:335`
- INVARIANT: Transaction fee payer is always the user's wallet public key — enforced at `app/hooks/useSwap.ts:759`, `app/hooks/useStaking.ts:576`
- INVARIANT: All program IDs and mint addresses come from cluster-aware `protocol-config.ts`, never hardcoded per-file — enforced at `app/lib/protocol-config.ts:31-39`
- INVARIANT: Slippage-protected `minimumOutput` is passed to every swap instruction — enforced at `app/lib/swap/swap-builders.ts:258`, `app/lib/staking/staking-builders.ts:212`
- ASSUMPTION: Pool reserves read from `usePoolPrices` are reasonably fresh when used in quote computation — PARTIALLY VALIDATED (SSE pipeline provides ~200ms updates, but 300ms debounce + user think time adds latency)
- ASSUMPTION: Wallet adapter's `signTransaction` preserves transaction bytes exactly — UNVALIDATED (relies on wallet implementation fidelity) ⚠
- ASSUMPTION: Anchor's `.accountsStrict()` + `.instruction()` produces correct serialized instruction bytes matching on-chain struct layout — VALIDATED by Anchor IDL type system but fragile if IDL drifts from deployed program
- ASSUMPTION: `PROTOCOL_ALT` address is correct for the active cluster — VALIDATED via `protocol-config.ts` cluster resolution, but ALT content freshness is NOT validated (cache is permanent)

## Risk Observations (Prioritized)

1. **skipPreflight on mainnet multi-hop**: `multi-hop-builder.ts:381` uses `skipPreflight:true` documented as a devnet workaround. If this persists to mainnet, failed TXs are broadcast without simulation, wasting user SOL on tx fees. MEDIUM impact (on-chain slippage protects funds, but user experience degrades).
2. **skipPreflight on bonding curve**: `BuyForm.tsx:191` and `SellForm.tsx:200` use `skipPreflight:true` without explanation or devnet guard. This is higher risk because bonding curve operations involve direct SOL transfers.
3. **sign-then-send bypasses wallet simulation**: Users lose the wallet's built-in Blowfish/simulation preview. The wallet popup shows raw TX bytes rather than "you will send X SOL and receive Y tokens." This degrades user trust and may confuse users into signing malicious TXs if the frontend is compromised.
4. **No ComputeBudget on BC TXs**: BuyForm and SellForm don't set compute unit limit or priority fee. Under congestion, these TXs are deprioritized and may repeatedly expire, frustrating users.
5. **Number-based base unit conversion**: `Math.floor(parsed * 10 ** 9)` for SOL amounts loses precision above ~9,007 SOL. While individual user trades are unlikely to reach this, it's a latent bug.
6. **ALT cache never invalidated**: After initial fetch, `cachedALT` persists for the browser session. If the ALT is extended (new addresses added), the stale cache causes lookup table index failures.
7. **Non-idempotent ATA creation in single-hop paths**: `createAssociatedTokenAccountInstruction` will fail if the ATA was created by another TX between the `getAccountInfo` check and execution. Multi-hop paths have the fix (CreateIdempotent) but single-hop paths do not.

## Novel Attack Surface

- **Frontend compromise -> transaction substitution**: Because `useProtocolWallet` uses sign-then-send, a compromised frontend could build arbitrary instructions, present a legitimate-looking UI, and have the user sign a drainer TX. The wallet's simulation preview (Blowfish) would normally catch this, but sign-then-send bypasses it. The wallet popup shows generic "approve transaction" rather than a detailed breakdown.
- **Stale ALT exploitation**: If an attacker could cause the protocol ALT to be recreated (e.g., by exhausting its address slots), the cached ALT in the browser would point to the old address. V0 transactions would fail silently, causing a soft DoS on multi-hop swaps.
- **WSOL dust accumulation on repeated partial swaps**: If the WSOL close instruction fails (insufficient compute units), the user accumulates stale WSOL balance across swaps. Not a fund loss but could confuse balance displays.

## Cross-Focus Handoffs

- → **SEC-01**: The sign-then-send pattern in `useProtocolWallet.ts` bypasses wallet simulation preview. Investigate whether this creates a viable phishing vector if the frontend is compromised.
- → **CHAIN-05 (MEV)**: `multi-hop-builder.ts:381` sends swaps with `skipPreflight:true` through the public Helius RPC. These are sandwichable. Investigate whether the existing slippage floor (50% maximum BPS, on-chain enforced) is sufficient MEV protection for mainnet.
- → **ERR-02**: `pollTransactionConfirmation` has a 90-second timeout and checks `lastValidBlockHeight` for blockhash expiry. Verify that all callers handle the thrown Error properly and surface it to the user.
- → **LOGIC-01**: The stale quote-to-execution TOCTOU gap could cause user confusion (quoted 100 tokens, received 95). The on-chain minimumOutput prevents loss, but the UX impact should be assessed.

## Trust Boundaries

The transaction construction pipeline has three distinct trust boundaries. (1) **User input -> quote engine**: User-provided amounts are parsed via `parseFloat` and converted to base units via `Math.floor`. No runtime validation beyond `> 0` checks. The quote engine operates on these values with BigInt arithmetic, inheriting any precision loss from the `Number` -> `BigInt` conversion. (2) **Quote output -> instruction builder**: The builders trust the quote's `minimumOutput` and amount parameters without re-validation. If the quote engine is buggy, incorrect slippage bounds propagate to the instruction. (3) **Instruction -> wallet signing**: The sign-then-send pattern means the user signs whatever instruction the client builds. Unlike `signAndSendTransaction`, there is no wallet-side simulation preview. The wallet sees raw bytes, not a human-readable description. This is the most sensitive trust boundary — a compromised or buggy frontend directly controls what the user signs.
<!-- CONDENSED_SUMMARY_END -->

---

# CHAIN-01: Transaction Construction & Signing — Full Analysis

## Executive Summary

The Dr. Fraudsworth protocol's off-chain transaction construction pipeline is architecturally sound with clear separation of concerns: hook resolution is deterministic (no RPC), builders produce complete transactions, and a unified wallet abstraction handles signing. The primary security safeguard is on-chain `minimumOutput` enforcement, which prevents catastrophic fund loss even if the off-chain pipeline produces bad quotes.

However, several patterns warrant attention: (1) `skipPreflight:true` is used in 3 of 5 transaction submission paths, including all bonding curve operations and all multi-hop swaps; (2) the sign-then-send pattern bypasses wallet simulation previews; (3) Number-based conversions introduce latent precision issues; (4) several caches (ALT, Connection) are never invalidated.

## Scope

**Analyzed:** All off-chain code that constructs, signs, or submits Solana transactions. This includes:
- React hooks orchestrating swap/staking/bonding-curve flows
- Transaction builder libraries (swap, staking, curve)
- Transfer Hook account resolution
- WSOL wrapping/unwrapping helpers
- The wallet abstraction layer
- The RPC proxy and connection factory
- Transaction confirmation polling
- Deploy scripts that construct transactions

**Excluded:** On-chain Anchor programs in `programs/` directory (out of scope per instructions).

## Key Mechanisms

### 1. Transaction Construction Pipeline

The pipeline follows a consistent pattern across all 5 transaction types:

```
User Input -> parseFloat -> Math.floor(parsed * 10^decimals) -> BigInt quote engine
                                                                      |
Quote Output -> minimumOutput = Math.floor(output * (10000-slippage)/10000)
                                                                      |
Builder -> ComputeBudget + ATA creation + hook resolution + swap instruction
                                                                      |
Blockhash -> getLatestBlockhash("confirmed") -> tx.recentBlockhash + feePayer
                                                                      |
Wallet -> signTransaction(tx) -> sendRawTransaction(serialized)
                                                                      |
Confirmation -> pollTransactionConfirmation (HTTP polling, 2s interval, 90s timeout)
```

**AMM Swaps (useSwap.ts -> swap-builders.ts)**:
- Direct path: `buildSolBuyTransaction` / `buildSolSellTransaction` -> legacy Transaction
- Multi-hop path: `buildAtomicRoute` -> per-step legacy TXs -> instruction processing -> v0 VersionedTransaction with ALT
- Direct swaps use `skipPreflight:false`; multi-hop uses `skipPreflight:true`

**Staking (useStaking.ts -> staking-builders.ts)**:
- 3 instruction types: stake, unstake, claim
- All use legacy Transactions with `skipPreflight:false`
- Hook direction is correctly reversed between stake (user->vault) and unstake (vault->user)

**Bonding Curve (BuyForm/SellForm -> curve-tx-builder.ts)**:
- Purchase and sell use BigInt args converted to BN via `.toString()` intermediate
- Both use `skipPreflight:true` with no documented justification
- No ComputeBudget instructions added

### 2. Transfer Hook Resolution

Two resolvers exist, both producing identical 4-account structures:

**`hook-resolver.ts`** (AMM/Vault paths):
```typescript
resolveHookAccounts(source, mint, dest) -> [
  ExtraAccountMetaList PDA,
  Source whitelist PDA,
  Dest whitelist PDA,
  Hook program ID
]
```

**`hook-accounts.ts`** (Bonding Curve paths):
```typescript
getCurveHookAccounts(mint, source, destination) -> [same 4 accounts]
```

Both use deterministic PDA derivation — no RPC calls. This is good for performance and eliminates a class of TOCTOU bugs. The seed patterns match the on-chain program's `initialize_extra_account_meta_list` instruction.

**Direction correctness (verified):**
- Buy: source=poolVaultB (vault sends tokens), dest=userATA (user receives) ✓
- Sell: source=userATA (user sends tokens), dest=poolVaultB (vault receives) ✓
- Stake: source=userATA, dest=stakeVault ✓
- Unstake: source=stakeVault, dest=userATA ✓
- Vault input leg: source=userInput, dest=vaultInput ✓
- Vault output leg: source=vaultOutput, dest=userOutput ✓
- BC purchase: source=tokenVault, dest=userATA ✓
- BC sell: source=userATA, dest=tokenVault ✓

### 3. Wallet Abstraction (sign-then-send)

`useProtocolWallet.ts` wraps `@solana/wallet-adapter-react` with a custom `sendTransaction` that:
1. Calls `wallet.signTransaction(tx)` to get a signed transaction
2. Serializes it
3. Calls `connection.sendRawTransaction(serialized, opts)` through our Helius RPC

This deliberately bypasses `wallet.sendTransaction()` / `signAndSendTransaction()` because Phantom's devnet RPC silently drops transactions. The pattern gives the app control over which RPC endpoint receives the TX.

**Security implication:** The wallet's simulation preview (Blowfish, etc.) runs during `signAndSendTransaction` but NOT during `signTransaction`. Users see a less informative approval popup.

### 4. Atomic Multi-Hop Builder

`multi-hop-builder.ts` implements a sophisticated instruction merging strategy:

1. Builds separate legacy Transactions per route step using existing swap-builders
2. Strips all ComputeBudget instructions, accumulates CU totals and max priority fee
3. Converts ATA creation instructions from Create to CreateIdempotent (discriminator change: empty data -> `[1]`)
4. Removes intermediate WSOL closeAccount instructions (keeps only the last one)
5. Prepends combined ComputeBudget
6. Compiles to v0 message with protocol ALT

This is well-engineered. The CreateIdempotent conversion handles the split-route case where two legs reference the same ATA. The WSOL accumulation fix prevents mid-TX WSOL destruction.

### 5. Transaction Confirmation

`confirm-transaction.ts` uses HTTP polling instead of WebSocket-based `confirmTransaction()`:
- 2-second poll interval
- 90-second maximum timeout
- Checks `getSignatureStatuses` for "confirmed" or "finalized"
- Checks `getBlockHeight` against `lastValidBlockHeight` for blockhash expiry
- Returns `{ err }` — callers must check for on-chain errors

This is more reliable than WebSocket confirmation and correctly handles the case where `skipPreflight:true` transactions fail on-chain but are still "confirmed."

### 6. RPC Proxy

`/api/rpc` proxies browser RPC calls to Helius:
- 16-method allowlist (covers all frontend needs)
- Rate limiting per IP
- Failover across up to 3 endpoints (HELIUS_RPC_URL, HELIUS_RPC_URL_FALLBACK, NEXT_PUBLIC_RPC_URL)
- Sticky routing to last-successful endpoint
- Endpoint URLs masked in logs (hides API key)
- Credit tracking per method

The allowlist includes `sendTransaction` which is necessary for the sign-then-send flow but means any wallet-signed TX can be submitted through the proxy. This is by design — the proxy doesn't (and can't) validate transaction content.

## Trust Model

### Trust Boundary 1: User Input -> Base Units
- parseFloat + Math.floor conversion
- No runtime type validation (TypeScript types are compile-time only)
- No explicit range checks beyond `> 0` and `isNaN`
- Precision risk for SOL amounts > 9,007 SOL (exceeds safe integer range for 10^9 multiplication)

### Trust Boundary 2: Client Quote -> On-Chain Instruction
- Quote engine uses BigInt arithmetic (matching on-chain Rust integer math)
- minimumOutput computed from quote output with slippage deduction
- On-chain program enforces minimumOutput independently
- Gap: quoted price may differ from execution price due to TOCTOU

### Trust Boundary 3: Instruction Bytes -> Wallet Signature
- sign-then-send pattern: wallet signs whatever the client builds
- No wallet-side simulation preview in this flow
- A compromised frontend could substitute arbitrary instructions
- On-chain constraints (PDA ownership, minimumOutput) are the final safety net

### Trust Boundary 4: Signed TX -> RPC Submission
- TX goes through /api/rpc proxy to Helius
- Proxy validates method name but NOT transaction content
- Failover provides availability but all endpoints are Helius (single provider)

## State Analysis

### Caches That Could Go Stale

1. **ALT Cache** (`multi-hop-builder.ts:261`): Module-level `cachedALT` is set once, never invalidated. If the protocol ALT is extended, the browser must be refreshed.

2. **Connection Singleton** (`connection.ts:21`): `cachedConnection` is keyed on URL string. If the RPC URL changes dynamically (it doesn't currently), the stale connection persists.

3. **Anchor Program Instances** (`anchor.ts`): New `Program()` instance created on every call (no cache). This is fine — Program instances are lightweight.

### Race Conditions

1. **ATA existence check TOCTOU**: All single-hop builders check `getAccountInfo(ata)` then conditionally create the ATA. Between RPC response and TX execution, the ATA could be created by another TX (e.g., a concurrent wallet interaction), causing a non-idempotent Create instruction to fail. Multi-hop paths fix this with CreateIdempotent.

2. **Quote staleness**: 300ms debounce + user think time + TX build time means the quote can be seconds old when the TX executes. On-chain minimumOutput is the safety net.

## Dependencies

### External Packages
- `@solana/web3.js`: Transaction, VersionedTransaction, Connection, PublicKey
- `@solana/spl-token`: Token program constants, ATA helpers, WSOL helpers
- `@coral-xyz/anchor`: BN, Program for Anchor IDL interaction
- `@solana/wallet-adapter-react`: useWallet hook

### External Services
- **Helius RPC** (via proxy): All blockchain reads and transaction submissions
- **Wallet Adapter** (Phantom, Solflare, etc.): Transaction signing

## Focus-Specific Analysis

### A. Instruction Injection Vectors

**Can instructions be injected or reordered between construction and signing?**

No. All builders return a complete `Transaction` object with instructions already added. The `useProtocolWallet.sendTransaction` calls `signTransaction(tx)` on this complete object. There is no window between builder return and signing where instructions could be modified by external code.

However, if the builder code itself is compromised (supply chain attack), it could inject arbitrary instructions. The builders import from `@/lib/protocol-config` which resolves addresses from env vars. A misconfigured `NEXT_PUBLIC_CLUSTER` could cause the wrong program IDs to be used (cross-cluster attack — previously found as H009, fixed with fail-closed env var handling).

### B. Simulation and Preflight

**skipPreflight usage summary:**

| Path | skipPreflight | Justification |
|------|---------------|---------------|
| Direct SOL swap (useSwap) | false | Correct |
| Staking ops (useStaking) | false | Correct |
| Multi-hop/split route | true | Documented: devnet v0 TX blockhash bug |
| BC purchase (BuyForm) | true | NOT documented (H039 LOW, unfixed) |
| BC sell (SellForm) | true | NOT documented (H039 LOW, unfixed) |
| Refund (RefundPanel) | default (false) | Correct |

The multi-hop `skipPreflight:true` has a legitimate documented reason (devnet simulation rejects v0 TXs with "Blockhash not found"). The code correctly checks `confirmation.err` after confirmation to catch on-chain failures. However, this pattern should be revisited for mainnet where simulation works correctly.

The bonding curve `skipPreflight:true` has no documented justification and was flagged as H039 in Audit #1 (NOT_FIXED).

### C. Transaction Content Visibility

**Is transaction content shown to the user before signing?**

No. The sign-then-send pattern shows the wallet's generic "Approve Transaction" dialog. Wallets like Phantom typically show:
- For `signAndSendTransaction`: Detailed simulation results (tokens in/out, SOL changes)
- For `signTransaction`: Basic TX metadata only (no simulation preview)

This is the AIP-054 pitfall (using `signTransaction` instead of `signAndSendTransaction`). The project documents this as an intentional choice due to Phantom's devnet RPC issues. For mainnet, this should be revisited since Phantom's mainnet RPC is reliable.

### D. Partial Signing Vulnerabilities

No partial signing is used anywhere in the codebase. All user-facing transactions require exactly one signer (the user's wallet). No server-side co-signing, no multisig flows in the frontend. The `Transaction.partialSign` method is never called.

The deploy scripts (out of scope for user-facing analysis) use `Keypair` signing which is the simpler single-signer pattern.

### E. Compute Budget Handling

| Path | CU Limit | Priority Fee |
|------|----------|-------------|
| SOL Buy | 200,000 | User-configurable via settings |
| SOL Sell | 250,000 | User-configurable via settings |
| Vault Convert | 200,000 | User-configurable via settings |
| Stake | 200,000 | User-configurable via settings |
| Unstake | 200,000 | User-configurable via settings |
| Claim | 100,000 | User-configurable via settings |
| Multi-hop | Sum of per-step limits | Max of per-step prices |
| BC Purchase | NONE | NONE |
| BC Sell | NONE | NONE |
| Refund | NONE | NONE |

The AMM and staking paths have proper compute budget management. The bonding curve paths have none — flagged as H041 in Audit #1 (NOT_FIXED). Under congestion, BC transactions will have low priority.

### F. Number Precision Analysis

The `toBaseUnits` function in `useSwap.ts`:
```typescript
const toBaseUnits = (amount: string, token: TokenSymbol): number => {
  const parsed = parseFloat(amount);
  const decimals = getDecimals(token);
  return Math.floor(parsed * 10 ** decimals);
};
```

For SOL (9 decimals): `parsed * 10^9`
- `Number.MAX_SAFE_INTEGER = 9,007,199,254,740,991`
- Max safe SOL amount = 9,007,199,254,740,991 / 10^9 ≈ 9,007,199 SOL
- For typical user amounts (< 1000 SOL), this is fine
- For protocol-level amounts or whale trades, precision loss is possible

For tokens (6 decimals): `parsed * 10^6`
- Max safe token amount = 9,007,199,254,740,991 / 10^6 ≈ 9,007,199,254,740 tokens
- Total token supply is 1B = 1,000,000,000 (well within safe range)

The quote engine correctly uses BigInt for all arithmetic. The precision risk is only in the `parseFloat` -> `Number` conversion at the user input boundary.

**Staking also uses Number-based conversion:**
```typescript
const amountBaseUnits = Math.floor(parsedAmount * 10 ** PROFIT_DECIMALS);
```
Same pattern, 6 decimals. Safe for all practical PROFIT amounts (max supply 20M).

### G. Blockhash Handling

All transaction paths use `getLatestBlockhash("confirmed")` — this is correct per SP-015 and AIP-064. No instances of deprecated `getRecentBlockhash` were found.

All paths store `lastValidBlockHeight` and pass it to `pollTransactionConfirmation`, which checks for blockhash expiry. This correctly handles the case where a transaction never lands.

### H. WSOL Lifecycle

The WSOL handling follows the standard Solana pattern:
1. Create WSOL ATA (if needed) — TOKEN_PROGRAM_ID (not TOKEN_2022)
2. SystemProgram.transfer SOL to WSOL ATA
3. SyncNative to update token balance
4. Execute swap (WSOL is now a regular SPL token)
5. CloseAccount to unwrap remaining WSOL

For sell paths (receiving SOL output):
1. Create WSOL ATA (if needed)
2. Execute swap (SOL deposited into WSOL ATA by the program)
3. CloseAccount to unwrap WSOL back to SOL

The multi-hop builder correctly handles WSOL in split routes by removing intermediate CloseAccount instructions and keeping only the last one.

## Cross-Focus Intersections

### CHAIN-01 x CHAIN-05 (MEV)
The `skipPreflight:true` on multi-hop routes means these transactions are broadcast to the mempool without pre-simulation. Combined with the public Helius RPC (no Jito/private mempool), multi-hop swaps are potentially sandwichable. The 50% slippage floor (on-chain) and user-configured slippage provide protection, but the gap between minimumOutput and actual output is extractable by MEV bots.

### CHAIN-01 x SEC-01 (Access Control)
The sign-then-send pattern in `useProtocolWallet.ts` is the most security-sensitive code path. If the frontend is compromised (XSS, supply chain, CDN poisoning), an attacker can build arbitrary transactions and present them to the user for signing. The wallet's Blowfish simulation (which would normally catch this) is bypassed.

### CHAIN-01 x ERR-02 (Error Handling)
Transaction failures are parsed through `parseSwapError` / `parseStakingError` / `parseCurveError` which decode Anchor error codes into human-readable messages. The `pollTransactionConfirmation` function throws on timeout/expiry — all callers wrap this in try/catch.

### CHAIN-01 x DATA-01 (Data Persistence)
Quote data is ephemeral (React state). Transaction signatures are stored in React state for display. No transaction data is persisted to the database by the frontend. The Helius webhook separately captures on-chain events.

## Cross-Reference Handoffs

- **To SEC-01 auditor**: Review `useProtocolWallet.ts:87-121` sign-then-send pattern for phishing implications. If frontend is compromised, user signs arbitrary instructions without wallet simulation preview.
- **To CHAIN-05 auditor**: Review `multi-hop-builder.ts:381` skipPreflight + public RPC. Multi-hop swaps sent through standard mempool are sandwichable. Quantify MEV exposure given the 50% slippage floor.
- **To ERR-02 auditor**: Verify error recovery in `useSwap.ts:794-798` and `useStaking.ts:612-634` — do all caught errors produce user-facing messages?
- **To LOGIC-01 auditor**: Verify that the stale-quote TOCTOU gap (quote computed 300ms-5s before execution) produces acceptable UX. minimumOutput protects funds but quoted vs actual amounts may diverge.
- **To INFRA-03 auditor**: The ALT cache in `multi-hop-builder.ts:261` is never invalidated. If Railway restarts the Next.js process, the cache is cleared (OK). But within a session, ALT extensions won't be picked up.

## Risk Observations

### HIGH

**H-CHAIN01-01: skipPreflight:true on mainnet multi-hop paths**
- File: `app/lib/swap/multi-hop-builder.ts:381`
- Observation: `skipPreflight:true` is hardcoded, documented as devnet workaround. No environment guard to disable it on mainnet. On mainnet, v0 TX simulation works correctly, so this bypass is unnecessary.
- Why risky: Without preflight simulation, malformed transactions (wrong account order, insufficient funds, stale ALT) are broadcast to validators and fail on-chain. User pays TX fees for failed transactions.
- Potential impact: User SOL wasted on failed TX fees. No fund loss (on-chain slippage check catches bad swaps). UX degradation.
- Recommendation: Gate `skipPreflight` on `NEXT_PUBLIC_CLUSTER === "devnet"`.

**H-CHAIN01-02: Sign-then-send bypasses wallet simulation preview**
- File: `app/hooks/useProtocolWallet.ts:87-121`
- Observation: All user-facing transactions use `signTransaction` + `sendRawTransaction` instead of `signAndSendTransaction`. Users see minimal approval dialogs.
- Why risky: If the frontend is compromised, the user has no wallet-side safety net. Blowfish simulation (standard in Phantom, Solflare) only runs during `signAndSendTransaction`.
- Potential impact: Frontend compromise -> user signs drainer TX without wallet warning.
- Recommendation: Revisit for mainnet. Phantom's mainnet RPC is reliable. Consider using `sendTransaction` (wallet-adapter's standard) for mainnet and only falling back to sign-then-send for devnet.

**H-CHAIN01-03: Non-idempotent ATA creation in single-hop swap paths**
- File: `app/lib/swap/swap-builders.ts:229-240`, `app/lib/swap/swap-builders.ts:339-350`, `app/lib/staking/staking-builders.ts:185-196`
- Observation: Single-hop transaction builders check `getAccountInfo(ata)` and conditionally add `createAssociatedTokenAccountInstruction` (non-idempotent). A race condition exists if the ATA is created between the check and TX execution.
- Why risky: The TX will fail with "Account already in use" error. This is not a fund loss but causes swap failures that confuse users.
- Potential impact: Intermittent swap failures for users who receive tokens from another source between quote and execution.
- Recommendation: Use `createAssociatedTokenAccountIdempotentInstruction` (discriminator `[1]`) for all ATA creation, matching the multi-hop builder's approach.

### MEDIUM

**M-CHAIN01-01: No ComputeBudget on bonding curve transactions**
- File: `app/components/launch/BuyForm.tsx:184-186`, `app/components/launch/SellForm.tsx:192-196`
- Observation: BC transactions lack ComputeBudgetProgram instructions. H041 from Audit #1 (NOT_FIXED).
- Why risky: Under network congestion, these transactions have the default 200k CU limit and zero priority fee, causing frequent timeouts.
- Potential impact: User frustration during high-traffic periods (launch phase). No fund loss.

**M-CHAIN01-02: skipPreflight:true on bonding curve transactions**
- File: `app/components/launch/BuyForm.tsx:191`, `app/components/launch/SellForm.tsx:200`
- Observation: H039 from Audit #1 (NOT_FIXED). No documented reason for bypassing preflight.
- Why risky: Broken transactions (e.g., insufficient SOL balance) are broadcast and fail on-chain instead of being caught locally.

**M-CHAIN01-03: ALT cache never invalidated**
- File: `app/lib/swap/multi-hop-builder.ts:261`
- Observation: `let cachedALT: AddressLookupTableAccount | null = null;` is set once and persists for the browser session.
- Why risky: If the protocol ALT is extended (new addresses added to support new pools or features), browsers with stale cache will build v0 TXs that reference addresses not in the ALT, causing compilation errors.
- Potential impact: Multi-hop swaps fail silently until page refresh.

**M-CHAIN01-04: Number precision in toBaseUnits for SOL**
- File: `app/hooks/useSwap.ts:238,306`
- Observation: `Math.floor(parsed * 10 ** 9)` loses precision for SOL amounts > ~9,007,199 SOL. While impractical for user trades, it's a code quality issue.
- Why risky: Protocol-level operations or whale trades could produce incorrect base unit values.
- Potential impact: Negligible for current user base. Latent bug.

**M-CHAIN01-05: Quote staleness (TOCTOU)**
- File: `app/hooks/useSwap.ts:690-808`
- Observation: Quote is computed with pool reserves at time T, but the TX executes at time T + 0.3s to T + 30s (debounce + user think time + build time).
- Why risky: Pool reserves may change between quote and execution, especially during volatile periods.
- Potential impact: On-chain minimumOutput prevents fund loss, but users may see "Transaction failed: slippage exceeded" errors more frequently than expected.

**M-CHAIN01-06: RPC proxy trusts all wallet-signed content**
- File: `app/app/api/rpc/route.ts:42`
- Observation: `sendTransaction` is in the allowlist, meaning any wallet-signed TX can be submitted through the proxy. The proxy doesn't inspect TX content.
- Why risky: This is architecturally correct (the proxy can't validate TX semantics), but it means the proxy provides no defense-in-depth against frontend compromise.

### LOW

**L-CHAIN01-01: Duplicate PRIORITY_FEE_MAP definitions**
- Files: `app/hooks/useSwap.ts:101-107`, `app/hooks/useStaking.ts:88-94`
- Observation: Identical `PRIORITY_FEE_MAP` is defined in two files. If one is updated but not the other, priority fee presets diverge.

**L-CHAIN01-02: `sendOptions` optional chaining could deference undefined**
- File: `app/hooks/useProtocolWallet.ts:110`
- Observation: `const { signers: _signers, ...sendOptions } = opts ?? {};` then accesses `sendOptions.skipPreflight`. If `opts` is undefined, `sendOptions` is `{}` and `sendOptions.skipPreflight` is `undefined`, which is falsy. This happens to work correctly (undefined maps to "use RPC default") but is fragile.

**L-CHAIN01-03: Multiple Connection instances possible via override**
- File: `app/lib/connection.ts:54`
- Observation: `getConnection(rpcUrl?)` accepts an override URL. If different callers pass different URLs, multiple Connection instances exist despite the singleton pattern.

**L-CHAIN01-04: No minimum swap amount enforcement off-chain**
- File: `app/hooks/useSwap.ts:400-404`
- Observation: Only checks `baseUnits <= 0`. No minimum amount enforcement. Dust swaps (e.g., 1 lamport) could produce 0-output quotes.

**L-CHAIN01-05: Error objects logged to console in production**
- Files: `app/hooks/useSwap.ts:795`, `app/hooks/useStaking.ts:613`
- Observation: `console.error("[useSwap] executeSwap error:", error)` logs full error objects including potentially sensitive stack traces.

## Novel Attack Surface Observations

1. **Frontend supply chain -> transaction substitution**: The most dangerous attack vector specific to this codebase is a supply chain compromise of the frontend (npm package, CDN, or Railway build pipeline) that modifies the transaction builders to include drain instructions. The sign-then-send pattern means the wallet's Blowfish simulation won't catch this. The on-chain `minimumOutput` check would only protect against output manipulation, not against additional drain instructions appended to the transaction. Defense: CSP headers, Subresource Integrity, build pipeline verification.

2. **ALT state desync as DoS**: If an attacker finds a way to invalidate or replace the protocol ALT (which requires authority — currently the admin), all multi-hop swaps would fail because the browser's cached ALT is stale. Single-hop direct swaps (legacy TXs) would still work.

3. **WSOL intermediary as user-visible state**: The sell path creates and destroys a WSOL ATA in every sell transaction. If the close instruction fails (out of compute units), the user accumulates WSOL balance that appears in their wallet. While not a security issue, it could lead to confusion and support tickets.

## Questions for Other Focus Areas

1. **For CHAIN-05 (MEV)**: What is the practical MEV exposure for a multi-hop swap sent with `skipPreflight:true` through Helius RPC? Is Helius's default RPC MEV-protected?
2. **For SEC-01**: Has the sign-then-send pattern been validated against the mainnet Phantom wallet's behavior? On mainnet, does `signAndSendTransaction` reliably submit through the app's RPC or does it still use Phantom's internal RPC?
3. **For LOGIC-01**: Is the 50% slippage floor (on-chain) applied to each hop of a multi-hop route, or only to the final output? The `buildAtomicRoute` applies per-step slippage.
4. **For ERR-02**: What happens if `pollTransactionConfirmation` throws a timeout error while the TX is actually processing? The user sees "failed" but the TX may confirm later.

## Raw Notes

- `DEVNET_POOL_CONFIGS` / `DEVNET_PDAS_EXTENDED` names are misleading — they now resolve to mainnet addresses when `NEXT_PUBLIC_CLUSTER=mainnet`. Naming convention inherited from early development.
- The `resolvePool` / `resolveRoute` functions in `protocol-config.ts` delegate to `@dr-fraudsworth/shared` which contains the actual mapping logic. The off-chain code is a thin wrapper.
- All Anchor `.accountsStrict()` calls use the strict variant (not `.accounts()`), which means missing accounts cause compile-time errors rather than runtime null pointer crashes. Good practice.
- The `BN` class from `@coral-xyz/anchor` is used for Anchor method args, while `BigInt` is used for quote engine arithmetic. The conversion is `new BN(bigintValue.toString())` for Anchor args and `BigInt(bnValue.toString())` for reading Anchor account data. No precision is lost in either direction since both support arbitrary precision integers.
- The `createSyncNativeInstruction` call in `wsol.ts:118` uses `TOKEN_PROGRAM_ID` (correct — WSOL is SPL Token, not Token-2022). This is a common AI-generated code pitfall that this codebase correctly avoids.
- The e2e test scripts (`carnage-flow.ts`, `swap-flow.ts`, etc.) use the same transaction builders, providing integration test coverage of the construction pipeline.
