---
task_id: db-phase1-tx-construction
provides: [tx-construction-findings, tx-construction-invariants]
focus_area: tx-construction
files_analyzed:
  - app/hooks/useSwap.ts
  - app/hooks/useProtocolWallet.ts
  - app/hooks/useStaking.ts
  - app/lib/swap/swap-builders.ts
  - app/lib/swap/multi-hop-builder.ts
  - app/lib/swap/hook-resolver.ts
  - app/lib/swap/wsol.ts
  - app/lib/confirm-transaction.ts
  - app/lib/connection.ts
  - app/lib/staking/staking-builders.ts
  - app/lib/curve/curve-tx-builder.ts
  - scripts/crank/crank-runner.ts
  - scripts/crank/crank-provider.ts
  - scripts/vrf/lib/vrf-flow.ts
  - scripts/graduation/graduate.ts
  - scripts/deploy/initialize.ts
  - scripts/e2e/lib/swap-flow.ts
finding_count: 12
severity_breakdown: {critical: 0, high: 2, medium: 5, low: 5}
---
<!-- CONDENSED_SUMMARY_START -->
# Transaction Construction & Signing -- Condensed Summary

## Key Findings (Top 10)
1. **skipPreflight:true on atomic multi-hop user swaps**: Failed TXs still land on-chain with fees charged but no state change. Error detection relies on post-hoc `confirmation.err` check, which IS implemented but creates a UX gap where the user pays fees for nothing. -- `app/lib/swap/multi-hop-builder.ts:381`
2. **Floating-point arithmetic in financial base-unit conversions**: `Math.floor(parsed * 10 ** decimals)` uses IEEE 754 doubles, which lose precision beyond 2^53. For SOL (9 decimals), amounts above ~9007 SOL silently truncate. For tokens (6 decimals), amounts above ~9B tokens truncate. -- `app/hooks/useSwap.ts:299`
3. **No slippage cap enforcement**: User-set `slippageBps` flows from `useSettings` with no upper-bound clamp. A user could set 10000 bps (100%) slippage, meaning `minimumOutput = 0`, which removes all slippage protection. -- `app/hooks/useSwap.ts:407`
4. **Stale ALT cache in multi-hop builder**: Module-level `cachedALT` is never invalidated. If the protocol ALT is extended with new addresses (e.g., new pool), cached clients would build TXs referencing stale ALT data until page refresh. -- `app/lib/swap/multi-hop-builder.ts:261-277`
5. **WSOL ATA race condition in concurrent swaps**: `buildWsolWrapInstructions` checks `getAccountInfo(wsolAta)` then conditionally adds a create instruction. If two swap TXs are built concurrently, both may skip the create, or both may add it. The second TX would fail. -- `app/lib/swap/wsol.ts:89-103`
6. **Crank runner vault top-up has no balance guard**: The crank tops up the carnage vault with 0.005 SOL but does not verify its own wallet has sufficient balance for the transfer (beyond a warning at 1 SOL). If wallet balance is below VAULT_TOP_UP_LAMPORTS, the TX fails and the vault remains in the danger zone. -- `scripts/crank/crank-runner.ts:225-241`
7. **VRF flow uses skipPreflight:true for randomness creation**: TX1 (create randomness) skips preflight with the rationale of SDK LUT staleness. This means a malformed TX will be submitted to validators without local simulation. -- `scripts/vrf/lib/vrf-flow.ts:559`
8. **Graduation script reads GRADUATION_POOL_SEED_SOL from env with Number() cast**: `Number(process.env.SOL_POOL_SEED_TOKEN_OVERRIDE)` will silently produce NaN for non-numeric strings and 0 for empty strings, falling through to default. NaN would propagate as BN("NaN"). -- `scripts/graduation/graduate.ts:102-107`
9. **Connection singleton may leak between SSR and client**: `getConnection()` uses module-level cache. In Next.js, server components and client components share the same Node process -- if a server-side call initializes the connection with a different URL than the client expects, stale connections could be reused. -- `app/lib/connection.ts:36-51`
10. **No TX size validation before signing**: Multi-hop builder compiles instructions into a v0 message but never checks if the compiled TX exceeds 1232 bytes. If the ALT is missing entries for a new pool, the TX would fail at serialize time. -- `app/lib/swap/multi-hop-builder.ts:339-347`

## Critical Mechanisms
- **Sign-then-send pattern**: `useProtocolWallet.ts:87-121` -- Wallet signs TX, then app submits via own RPC. Prevents Phantom's RPC from silently dropping TXs. Risk: signed TX is serialized and sent without any client-side inspection of what was signed. Concern: if TX construction is compromised upstream, the signed TX goes through unchecked.
- **Atomic v0 multi-hop**: `multi-hop-builder.ts:298-350` -- Combines multiple legacy TXs into one v0 TX with ALT. Strips per-step compute budgets, makes ATA creates idempotent, removes intermediate WSOL closes. Concern: instruction reordering logic depends on discriminator byte matching (TOKEN_CLOSE_ACCOUNT=9) which is fragile.
- **Hook account resolution**: `hook-resolver.ts:46-78` -- Deterministic PDA derivation for Transfer Hook remaining_accounts. No RPC calls. Concern: if hook program is upgraded or seeds change, this silently produces wrong PDAs with no runtime validation.
- **Polling-based confirmation**: `confirm-transaction.ts:29-67` -- HTTP polling replaces WS-based confirmation. 2s interval, 90s timeout, checks block height for expiry. Concern: 90s timeout is generous; a stuck RPC could cause UI to hang.
- **Crank VRF atomic bundling**: `vrf-flow.ts:269-341` -- Bundles reveal + consume + executeCarnageAtomic in single v0 TX. The no-op guard on executeCarnageAtomic makes this safe when Carnage doesn't trigger. Concern: if the atomic TX fails, the recovery path does not attempt atomic Carnage.

## Invariants & Assumptions
- INVARIANT: All user-facing swap TXs use `skipPreflight: false` (simulation before send) -- enforced at `useSwap.ts:747` / NOT enforced for multi-hop at `multi-hop-builder.ts:381` (skipPreflight: true)
- INVARIANT: Every TX that reads blockhash also reads lastValidBlockHeight for expiry tracking -- enforced at `useSwap.ts:740`, `multi-hop-builder.ts:335`, `confirm-transaction.ts:53`
- INVARIANT: Hook accounts are always 4 per Token-2022 mint (meta_list, wl_source, wl_dest, hook_program) -- enforced at `hook-resolver.ts:72-77`
- INVARIANT: WSOL uses TOKEN_PROGRAM_ID (not TOKEN_2022_PROGRAM_ID) -- enforced at `wsol.ts:56`, `wsol.ts:100`, `wsol.ts:118`, `wsol.ts:149`
- ASSUMPTION: Solana slot time is ~400ms -- used for wait calculations in `vrf-flow.ts:171`, `crank-runner.ts:264`. UNVALIDATED -- slot time varies with network conditions
- ASSUMPTION: RPC responses are trustworthy and not spoofed -- all TX construction reads account state from RPC (`getAccountInfo`, `getTokenAccountsByOwner`) without cross-validation. UNVALIDATED
- ASSUMPTION: The protocol's ALT contains all required addresses and does not need invalidation -- `multi-hop-builder.ts:261`. UNVALIDATED -- no TTL or version check

## Risk Observations (Prioritized)
1. **[HIGH] skipPreflight on user-facing multi-hop swaps**: Users pay TX fees even when the swap fails on-chain. While the error IS detected post-confirmation, the fee loss is real. The comment attributes this to "devnet simulation rejects v0 TX" but this must be re-evaluated for mainnet. `multi-hop-builder.ts:381`
2. **[HIGH] No upper bound on user slippage**: Setting slippageBps=10000 results in minimumOutput=0, effectively disabling slippage protection and making the user maximally vulnerable to sandwich attacks. `useSwap.ts:407`
3. **[MEDIUM] Floating-point base unit conversion**: `Math.floor(parsed * 10 ** 9)` for SOL can lose precision for large amounts. Should use BigInt or BN arithmetic. `useSwap.ts:299`
4. **[MEDIUM] No compute unit estimation**: All TXs use hardcoded CU limits (200K for most, 250K for sell, 600K for VRF bundle). Overestimates waste SOL on priority fees; underestimates cause TX failure. `swap-builders.ts:117`, `staking-builders.ts:105`
5. **[MEDIUM] Module-level ALT cache never invalidated**: Page-lifetime cache for ALT. If protocol adds new pools requiring ALT updates, existing browser sessions will build failing TXs. `multi-hop-builder.ts:261`
6. **[MEDIUM] Concurrent TX building can produce conflicting ATA creation instructions**: Two rapid swap requests could both observe "ATA doesn't exist" and both add create instructions. The second TX fails. `swap-builders.ts:229-240`, `wsol.ts:89-103`
7. **[MEDIUM] VRF recovery path does not attempt atomic Carnage**: If the main VRF path fails and recovery succeeds, `carnageExecutedAtomically` is always false, meaning Carnage might trigger without atomic bundling, re-opening the CARN-002 MEV window. `vrf-flow.ts:533`

## Novel Attack Surface
- **Multi-hop instruction stripping**: The `processInstructionsForAtomic` function strips ComputeBudget instructions and modifies ATA creation instructions by pattern-matching on program IDs and discriminator bytes. An attacker who can influence route construction (e.g., via manipulated pool data) could cause unexpected instruction combinations that break the stripping logic. For example, a malicious route step returning a non-standard ATA instruction with data.length > 1 would bypass the idempotent conversion. This is mitigated by the fact that routes are computed client-side from on-chain pool data, but worth investigating if any route data comes from an external API.
- **Devnet-to-mainnet skipPreflight migration**: The codebase has extensive documentation about devnet-specific workarounds (skipPreflight for v0 TXs, 2s post-TX delays). If these are not systematically reviewed before mainnet, the workarounds become vulnerabilities (skipping simulation, unnecessary delays creating race windows).

## Cross-Focus Handoffs
- -> **CHAIN-02 (RPC Client & Node Trust)**: All TX builders read account state from RPC (`getAccountInfo`, `getBalance`) to decide whether to create ATAs. A malicious/compromised RPC could return false "account exists" responses, causing the TX to skip ATA creation and fail. The `connection.ts` singleton uses `confirmed` commitment.
- -> **CHAIN-05 (DEX/Trading)**: Slippage handling in `useSwap.ts` uses `Math.floor(result.outputTokens * (10_000 - slippageBps) / 10_000)` which rounds DOWN, potentially allowing more slippage than intended for very small amounts. The multi-hop slippage is applied per-step (not just final output), which is correct for atomic TXs but needs verification.
- -> **SEC-01 (Key Management)**: `crank-provider.ts` loads private keys from env vars (`WALLET_KEYPAIR`) or filesystem (`WALLET`). The crank runner logs truncated pubkeys to stdout. Railway captures these logs -- verify no sensitive material is logged.
- -> **BOT-01 (Keeper Logic)**: The crank runner's vault top-up logic at `crank-runner.ts:225` transfers SOL without verifying the transfer amount is below the wallet's spendable balance (balance - rent). If the wallet is nearly empty, this TX silently fails and the next epoch transition may fail due to rent-bug.
- -> **LOGIC-02 (Financial Calculations)**: `useSwap.ts` quote computation uses floating-point division for fee percentages (line 409, 435, 474, 505). These are display-only but could mislead users about actual costs.

## Trust Boundaries
The primary trust boundary in transaction construction is between the client (browser) and the on-chain programs. Transactions are constructed entirely client-side using deterministic PDA derivation and hardcoded program IDs from the shared package. The user's wallet acts as the signing authority -- the sign-then-send pattern in `useProtocolWallet.ts` ensures the app controls TX submission through its own RPC, but also means the user trusts the app's TX construction. The crank runner operates as a privileged bot with its own keypair, constructing and signing TXs server-side. The crank's trust boundary is the env-loaded keypair and the RPC endpoint. There is no intermediary server building TXs for user signing -- all user TX construction happens in the browser, which is a strong security posture (no blind signing of server-built TXs, per AIP-063).
<!-- CONDENSED_SUMMARY_END -->

---

# Transaction Construction & Signing -- Full Analysis

## Executive Summary

The Dr. Fraudsworth off-chain codebase implements transaction construction across three domains: (1) browser-based user swaps/staking via React hooks and builder libraries, (2) automated crank operations for epoch advancement with VRF, and (3) admin scripts for deployment, graduation, and initialization. The architecture is well-structured with clear separation of concerns -- builder functions produce unsigned Transactions, hooks orchestrate the lifecycle, and the wallet abstraction handles signing and submission.

The codebase demonstrates strong security awareness: hardcoded program IDs (no dynamic substitution), deterministic PDA derivation (no RPC-dependent hook resolution), proper blockhash + lastValidBlockHeight pairing, and a sign-then-send pattern that prevents Phantom's RPC from silently dropping TXs. The atomic v0 multi-hop builder is particularly sophisticated, handling instruction deduplication, ATA idempotency, and WSOL close ordering.

Key areas of concern center on: (1) skipPreflight usage on user-facing multi-hop swaps, (2) unbounded slippage settings, (3) floating-point arithmetic in base-unit conversions, and (4) several devnet workarounds that must be systematically reviewed before mainnet deployment.

## Scope

All off-chain TypeScript code involved in constructing, signing, submitting, and confirming Solana transactions. This includes:
- **Frontend hooks**: `useSwap.ts`, `useProtocolWallet.ts`, `useStaking.ts`
- **TX builder libraries**: `swap-builders.ts`, `multi-hop-builder.ts`, `staking-builders.ts`, `curve-tx-builder.ts`, `wsol.ts`, `hook-resolver.ts`
- **Confirmation**: `confirm-transaction.ts`
- **Connection**: `connection.ts`
- **Crank/bot**: `crank-runner.ts`, `crank-provider.ts`, `vrf-flow.ts`
- **Admin scripts**: `graduate.ts`, `initialize.ts`
- **E2E test helpers**: `swap-flow.ts`

On-chain Anchor programs in `programs/` are OUT OF SCOPE.

## Key Mechanisms

### 1. Sign-Then-Send Pattern (useProtocolWallet.ts)

**What**: Instead of using wallet-adapter's `sendTransaction()` (which calls `signAndSendTransaction` internally, routing through Phantom's RPC), the app uses `signTransaction()` + `connection.sendRawTransaction()`.

**Why**: Phantom's devnet RPC silently drops transactions. By signing locally and submitting through Helius, the app controls the submission endpoint.

**How it works**:
1. Caller passes an unsigned `Transaction | VersionedTransaction`
2. `signTransaction()` prompts the wallet popup
3. Signed TX is serialized via `.serialize()`
4. `sendRawTransaction()` submits through the app's Connection (Helius)

**Security assessment**:
- GOOD: No blind signing of server-built TXs (all construction is client-side)
- GOOD: The `signTransaction` call triggers Blowfish simulation in compatible wallets
- CONCERN: The `_signers` field is destructured away from options (line 110) -- if a caller passes additional signers, they're silently dropped. This is intentional (the wallet IS the signer) but could cause confusion if misused.
- CONCERN: `preflightCommitment` falls back to `connection.commitment ?? undefined`. The `undefined` fallback means the RPC default is used, which may differ from the app's expected `confirmed`.

### 2. Direct Swap TX Construction (swap-builders.ts)

**What**: Three builder functions produce complete unsigned Transactions for SOL buy, SOL sell, and vault conversion.

**How**:
- Each builder adds ComputeBudget instructions, creates ATAs if needed, resolves hook accounts, and builds the program instruction via Anchor's fluent API.
- All use `accountsStrict()` (not `accounts()`) -- strict mode rejects extra/missing accounts at build time.
- Hook accounts are resolved deterministically via PDA derivation (no RPC).

**Security assessment**:
- GOOD: `accountsStrict()` prevents account substitution at build time
- GOOD: Hook direction is correctly handled (buy: pool->user, sell: user->pool)
- GOOD: All program IDs and PDAs come from `@dr-fraudsworth/shared` constants (hardcoded)
- CONCERN: ATA existence check (`getAccountInfo`) before conditional creation is a TOCTOU race. Between the check and the TX landing, the ATA could be created by another TX, causing the create instruction to fail. This is mitigated for single-user wallets (only one signer) but could theoretically occur with concurrent tabs.
- CONCERN: `amountInLamports` is passed as `number`, not `bigint` or `BN`. JavaScript numbers lose precision above 2^53 (~9007 SOL / ~9B tokens at 6 decimals). In practice, these amounts are well within safe integer range for this protocol, but the type doesn't enforce it.

### 3. Atomic Multi-Hop Builder (multi-hop-builder.ts)

**What**: Combines multiple swap steps into a single v0 VersionedTransaction for atomic execution.

**How**:
1. Builds a legacy Transaction per route step (reusing swap-builders)
2. `processInstructionsForAtomic()` strips ComputeBudget IXs, makes ATA creates idempotent, removes intermediate WSOL closes
3. Prepends combined ComputeBudget (sum of all CU limits, max of all priority fees)
4. Fetches ALT and blockhash in parallel
5. Compiles to v0 message with ALT for address compression

**Security assessment**:
- GOOD: Atomic execution prevents partial-state (all-or-nothing)
- GOOD: ATA idempotent conversion (Create -> CreateIdempotent) handles split routes correctly
- GOOD: Intermediate WSOL close removal lets SOL accumulate across sell legs
- CONCERN: `skipPreflight: true` on user-facing TX (line 381). Comment says "devnet simulation rejects v0 TX" -- this must be re-evaluated for mainnet. Failed TXs still charge fees.
- CONCERN: ALT is cached at module level with no invalidation. If protocol extends ALT, existing sessions use stale data.
- CONCERN: CU summing across steps may over-allocate (wastes priority fee SOL) or under-allocate if steps share compute paths.

### 4. Hook Account Resolution (hook-resolver.ts)

**What**: Deterministic PDA derivation for Transfer Hook remaining_accounts.

**How**: For each Token-2022 transfer, derives 4 accounts:
1. ExtraAccountMetaList PDA: `["extra-account-metas", mint]`
2. Source whitelist entry: `["whitelist", source_token_account]`
3. Dest whitelist entry: `["whitelist", dest_token_account]`
4. Hook program ID (as trailing account)

**Security assessment**:
- GOOD: No RPC dependency -- pure PDA derivation
- GOOD: Avoids browser `buffer` polyfill issues with spl-token helper
- GOOD: Consistent with on-chain expectations (HOOK_ACCOUNTS_PER_MINT = 4)
- CONCERN: If the Transfer Hook program is upgraded with different seeds, this silently produces wrong PDAs. No runtime validation that derived PDAs actually exist on-chain.

### 5. Transaction Confirmation (confirm-transaction.ts)

**What**: HTTP polling replaces WS-based `confirmTransaction()`.

**How**:
- Polls `getSignatureStatuses()` every 2 seconds
- Accepts `confirmed` or `finalized` status
- Checks `getBlockHeight()` against `lastValidBlockHeight` for expiry
- 90-second hard timeout

**Security assessment**:
- GOOD: HTTP polling is more reliable than WS subscriptions
- GOOD: Block height check prevents indefinite hangs on expired TXs
- GOOD: Returns `err` field, allowing callers to detect on-chain failures
- CONCERN: `processed` status is not treated as confirmed (correct behavior)
- CONCERN: 90-second timeout is generous but appropriate for congested networks

### 6. VRF Epoch Flow (vrf-flow.ts)

**What**: Three-transaction VRF cycle: create randomness -> commit + trigger -> reveal + consume + carnage.

**How**:
- TX1: Create randomness account (must finalize before TX2)
- TX2: Commit randomness + trigger_epoch_transition
- TX3: Reveal + consume + executeCarnageAtomic (bundled v0)
- Recovery: stale VRF detection, timeout recovery with fresh randomness

**Security assessment**:
- GOOD: TX1 waits for `finalized` (not just confirmed) before TX2
- GOOD: Atomic bundling of reveal+consume+carnage closes CARN-002 MEV gap
- GOOD: No gateway rotation (each randomness is oracle-specific, documented)
- GOOD: Rate limiting between RPC calls (200ms delays)
- CONCERN: TX1 uses `skipPreflight: true` -- SDK LUT staleness workaround
- CONCERN: Recovery path does not attempt atomic Carnage (CARN-002 gap re-opens during recovery)
- CONCERN: `confirmTransaction(createSig, "finalized")` is the deprecated single-arg form -- should use object-form with lastValidBlockHeight

### 7. Graduation Script (graduate.ts)

**What**: Admin script for transitioning from bonding curves to AMM pools. 11-step checkpoint+resume sequence.

**Security assessment**:
- GOOD: Checkpoint+resume with state file prevents partial completion
- GOOD: Hardcoded graduation amounts (not from .env) to prevent Phase 69 bug recurrence
- GOOD: Balance checks before withdrawal (skip if already withdrawn)
- GOOD: Post-graduation verification checks all expected state
- CONCERN: `Number(process.env.SOL_POOL_SEED_TOKEN_OVERRIDE)` produces NaN for non-numeric strings. The `|| default` fallback catches `0` and `NaN` but not negative numbers.
- CONCERN: State file is written to filesystem with no integrity protection. A corrupted state file could skip steps.

## Trust Model

### User-Facing Transactions (Browser)
- **Trust**: User trusts the app's TX construction code (runs in their browser)
- **Verification**: Wallet popup shows TX preview (Blowfish simulation in Phantom)
- **Control**: User can reject any TX at the wallet popup
- **Risk**: If the app's code is compromised (XSS, supply chain), malicious TXs could be constructed
- **Mitigation**: All instructions use hardcoded program IDs and `accountsStrict()`

### Crank Transactions (Server/Railway)
- **Trust**: Crank trusts its own keypair, RPC endpoint, and PDA manifest
- **Verification**: No human review of TXs before signing
- **Control**: Crank signs all TXs automatically with loaded keypair
- **Risk**: Compromised RPC could feed false state, causing wrong TXs
- **Mitigation**: Crank only operates on known PDAs, all addresses from manifest

### Admin Scripts (Local)
- **Trust**: Admin trusts their local environment, keypair files, and RPC
- **Verification**: Console output shows what each step does
- **Control**: Script fails fast on errors, checkpoint+resume
- **Risk**: Incorrect env vars (wrong cluster URL, wrong keypair) could cause operations on wrong network
- **Mitigation**: Balance and state verification at each step

## State Analysis

### Module-Level Caches
1. **Connection singleton** (`connection.ts:21-22`): Cached by URL. Risk: stale across SSR/client boundary.
2. **ALT cache** (`multi-hop-builder.ts:261`): Never invalidated. Risk: stale if protocol ALT is extended.
3. **Anchor program instances** (`anchor.ts`): Created per connection. Risk: same connection cache issue.

### On-Chain State Dependencies
- ATA existence checks before TX construction (TOCTOU window)
- Pool reserve reads for quoting (not for TX construction -- quotes are display-only)
- Epoch state reads for tax rate determination (display-only, on-chain enforces actual rate)

## Dependencies

### External Packages (TX Construction)
- `@solana/web3.js`: Transaction, VersionedTransaction, Connection, PublicKey
- `@solana/spl-token`: ATA creation, WSOL operations, Transfer Hook helpers
- `@coral-xyz/anchor`: Program, BN, AnchorProvider
- `@switchboard-xyz/on-demand`: VRF randomness creation, commit, reveal

### Internal Dependencies
- `@dr-fraudsworth/shared`: Program IDs, mints, PDAs, pool configs, constants
- `hook-resolver.ts`: Transfer Hook remaining_accounts resolution
- `wsol.ts`: WSOL wrap/unwrap instruction building
- `confirm-transaction.ts`: Polling-based TX confirmation

## Focus-Specific Analysis

### Instruction Injection / Manipulation (OC-106, OC-107)
- **Finding**: No server-built transactions. All TX construction is client-side. No `/api/build-tx` endpoint.
- **Finding**: Instructions are built via Anchor's `accountsStrict()` + `.instruction()` which produces deterministic output. No instruction injection point exists between construction and signing.
- **Finding**: The multi-hop builder's `processInstructionsForAtomic()` modifies instructions (strips compute budget, converts ATA creates), but this operates on instructions it just built, not on externally-supplied instructions.
- **Assessment**: LOW RISK for instruction injection.

### Simulation (OC-108, OC-109, AIP-052)
- **Finding**: Direct swaps (`useSwap.ts:747`) use `skipPreflight: false` -- simulation occurs at RPC before submission. GOOD.
- **Finding**: Multi-hop swaps (`multi-hop-builder.ts:381`) use `skipPreflight: true` with documented rationale (devnet v0 TX simulation issues). The code compensates by checking `confirmation.err` post-confirmation.
- **Finding**: VRF TX1 (`vrf-flow.ts:559`) uses `skipPreflight: true` with documented rationale (SDK LUT staleness).
- **Assessment**: MEDIUM RISK -- skipPreflight on user-facing multi-hop swaps must be re-evaluated for mainnet.

### Partial Signing (OC-110, AIP-058)
- **Finding**: The VRF flow uses `.sign(wallet.payer, rngKp)` (line 554) which is the legacy `Transaction.sign()`. However, this is the FIRST signing operation on a fresh TX, so no existing signatures are destroyed.
- **Finding**: No multi-signer flows in user-facing code -- only the wallet signs user TXs.
- **Finding**: `provider.sendAndConfirm()` in crank code handles signing internally via AnchorProvider.
- **Assessment**: LOW RISK for partial signing issues.

### Transaction Content Display (OC-111, AIP-063)
- **Finding**: No blind signing of server-built TXs. All user TXs are built client-side.
- **Finding**: The sign-then-send pattern (`useProtocolWallet.ts`) calls `signTransaction()` which triggers wallet popup with TX preview.
- **Finding**: No explicit TX content display in the app UI beyond the wallet popup.
- **Assessment**: LOW RISK -- standard wallet popup provides TX visibility.

### Compute Budget (OC-112)
- **Finding**: All builders set explicit ComputeUnitLimit (200K default, 250K for sell, 600K for VRF bundle). No dynamic CU estimation.
- **Finding**: Priority fees are user-configurable via presets (none/low/medium/high/turbo). No dynamic fee estimation based on network congestion.
- **Finding**: Multi-hop builder sums CU across steps, which may over-allocate.
- **Assessment**: LOW RISK -- over-allocation wastes small amounts on priority fees, under-allocation is caught by on-chain rejection.

### Blockhash Handling (AIP-061, AIP-064)
- **Finding**: All TX construction uses `getLatestBlockhash("confirmed")` (not deprecated `getRecentBlockhash`). GOOD.
- **Finding**: `lastValidBlockHeight` is tracked alongside `blockhash` and used in polling confirmation. GOOD.
- **Finding**: Exception: VRF TX1 (`vrf-flow.ts:452-454`) uses `getLatestBlockhash()` without commitment argument -- defaults to the connection's commitment (confirmed). Acceptable.
- **Assessment**: LOW RISK -- proper blockhash handling throughout.

### Slippage (OC-128, OC-129, AIP-053)
- **Finding**: Slippage is user-configurable via `useSettings` hook, stored in browser settings.
- **Finding**: No upper bound clamp on `slippageBps`. A user setting 10000 bps (100%) would get `minimumOutput = 0`.
- **Finding**: Multi-hop atomic TXs apply slippage per-step, which is correct for atomic execution (no inter-step pool changes possible).
- **Finding**: No dynamic slippage based on pair volatility -- single value for all pairs.
- **Assessment**: HIGH RISK -- unbounded slippage is a user self-harm vector and could be exploited via social engineering ("set slippage to 100% to fix errors").

### MEV Protection (OC-127, AIP-062)
- **Finding**: No Jito/MEV-protected RPC for user swaps. All TXs go through standard Helius RPC.
- **Finding**: The crank's VRF+Carnage bundling IS MEV-protected (atomic reveal+swap eliminates the CARN-002 frontrunning window).
- **Finding**: Bonding curve TXs go through standard RPC.
- **Assessment**: MEDIUM RISK for mainnet -- user swaps are sandwichable via standard RPC. Should be addressed before mainnet launch with Jito bundles or MEV-protected endpoint.

## Cross-Focus Intersections

| Focus Area | Intersection | Details |
|------------|-------------|---------|
| CHAIN-02 | RPC trust for ATA checks | TX builders read `getAccountInfo` to decide ATA creation. Spoofed "account exists" response = TX failure |
| CHAIN-03 | Wallet signing flow | `useProtocolWallet` wraps wallet-adapter. Wallet popup is the user's last defense against bad TXs |
| CHAIN-05 | Swap slippage | Slippage values flow from UI settings to TX builders. No MEV protection on user swaps |
| CHAIN-06 | PDA derivation | All PDAs in TX builders use shared constants. Hook resolver uses deterministic derivation |
| SEC-01 | Keypair handling | Crank loads keypair from env/file. Admin scripts load mint keypairs from disk |
| BOT-01 | Crank TX flow | Crank signs/sends VRF and vault top-up TXs autonomously |
| LOGIC-02 | Financial math | Quote computation uses floats; base-unit conversion uses `Math.floor(parsed * 10**decimals)` |
| ERR-01 | Error handling | `parseSwapError` maps Anchor errors to user messages. `pollTransactionConfirmation` throws on timeout |

## Cross-Reference Handoffs

1. **-> CHAIN-02**: Verify commitment levels used for all `getAccountInfo` calls in TX builders (currently using connection default `confirmed`). Verify RPC failover behavior if Helius is down during TX building.
2. **-> CHAIN-05**: Verify that mainnet launch plan includes MEV-protected RPC for swap TXs. Verify dynamic slippage or slippage cap implementation.
3. **-> SEC-01**: Verify crank keypair rotation strategy. Verify that `console.log` in crank runner never outputs full pubkeys or any key material beyond truncated addresses.
4. **-> BOT-01**: Verify crank runner behavior when wallet balance is insufficient for vault top-up. Verify the crank can recover from failed top-up TXs without manual intervention.
5. **-> LOGIC-02**: Verify that `Math.floor(parsed * 10 ** decimals)` precision loss is acceptable for all supported amounts. Consider BigInt conversion at the settings/input boundary.

## Risk Observations

### HIGH
1. **Unbounded slippage on user swaps**: `slippageBps` has no upper-bound validation. Users can set 100% slippage, making `minimumOutput = 0`. Combined with no MEV protection, this makes sandwich attacks trivially profitable. File: `useSwap.ts:407`, `multi-hop-builder.ts:306-309`.
2. **skipPreflight on user-facing multi-hop swaps**: Users pay TX fees for failed TXs. The `confirmation.err` check catches failures but after fees are paid. Must be re-evaluated for mainnet where simulation should work correctly. File: `multi-hop-builder.ts:381`.

### MEDIUM
3. **Floating-point base-unit conversion**: `Math.floor(parsed * 10 ** decimals)` is imprecise for large amounts (>2^53 base units). Unlikely to hit in practice but represents a correctness gap. File: `useSwap.ts:299`.
4. **Stale ALT cache**: Module-level cache with no invalidation strategy. File: `multi-hop-builder.ts:261`.
5. **No MEV protection for user swaps**: Standard RPC submission makes all user swaps sandwichable on mainnet. File: `useSwap.ts:746`, `useProtocolWallet.ts:111`.
6. **TOCTOU race in ATA creation**: Concurrent TX builds can produce conflicting create instructions. File: `swap-builders.ts:229`, `wsol.ts:89`.
7. **VRF recovery path re-opens CARN-002 MEV gap**: Recovery does not attempt atomic Carnage bundling. File: `vrf-flow.ts:533`.

### LOW
8. **Hardcoded CU limits**: May over/under-allocate. File: `swap-builders.ts:117`.
9. **Connection singleton SSR leak**: Module-level cache may persist across SSR/client boundary. File: `connection.ts:36`.
10. **Graduation env override precision**: `Number()` cast on env var can produce NaN. File: `graduate.ts:102`.
11. **90-second confirmation timeout**: Generous but may cause UI to feel stuck. File: `confirm-transaction.ts:16`.
12. **VRF TX1 deprecated confirmTransaction form**: Single-arg `confirmTransaction(sig, "finalized")` is deprecated. File: `vrf-flow.ts:568`.

## Novel Attack Surface Observations

1. **Route-influenced instruction manipulation**: The `processInstructionsForAtomic` function performs instruction surgery based on program ID and data byte matching. If an attacker could influence route construction (e.g., by manipulating pool state that the route engine reads), they could potentially craft routes that produce instructions that survive the stripping logic in unexpected ways. For example, a route step that produces a non-standard ComputeBudget instruction (different discriminator) would not be stripped, potentially doubling the CU allocation and increasing TX fees.

2. **ALT-dependent TX compilation**: The v0 message compilation depends on the ALT containing all required addresses. If a new pool/mint is added to the protocol but the ALT isn't updated, multi-hop TXs through that pool would compile without address compression, potentially exceeding 1232 bytes and failing at serialize. The error would be opaque to users ("Transaction too large").

3. **Devnet-workaround accumulation**: The codebase has accumulated multiple devnet-specific workarounds documented in MEMORY.md: skipPreflight for v0 TXs, 2s post-TX delays, `signTransaction` instead of `signAndSendTransaction`. These workarounds interact with each other in subtle ways. For mainnet, each must be individually re-evaluated, but the interactions between removing them also need testing (e.g., removing skipPreflight AND removing the 2s delay AND switching back to signAndSendTransaction simultaneously could reveal new issues).

## Questions for Other Focus Areas

1. **CHAIN-02**: What commitment level does `getAccountInfo` use when checking ATA existence in swap-builders? Is it the connection default (`confirmed`) or explicit? Could a `processed`-level response cause incorrect ATA creation decisions?
2. **CHAIN-03**: Does the wallet-adapter's `signTransaction` flow provide sufficient TX preview for users to verify instruction contents? Does Blowfish simulation work with v0 VersionedTransactions?
3. **CHAIN-05**: Is there a plan for MEV-protected TX submission before mainnet launch? Does the mainnet readiness checklist include skipPreflight removal?
4. **SEC-01**: Are there any code paths where the crank's private key could be logged (error stack traces, serialized TX logging)?
5. **BOT-01**: What happens to the epoch cycle if the crank's vault top-up TX fails? Does the crank retry or skip?
6. **LOGIC-02**: Has the `Math.floor(parsed * 10 ** decimals)` pattern been tested with amounts near the 2^53 precision boundary? Are there unit tests for base-unit conversion edge cases?

## Raw Notes

### Files Read (Layer 3 -- Full Source)
- `app/hooks/useSwap.ts` (937 lines) -- Complete swap lifecycle orchestration
- `app/hooks/useProtocolWallet.ts` (131 lines) -- Sign-then-send wallet wrapper
- `app/lib/swap/swap-builders.ts` (507 lines) -- SOL buy/sell/vault convert TX builders
- `app/lib/swap/multi-hop-builder.ts` (417 lines) -- Atomic v0 multi-hop builder
- `app/lib/swap/hook-resolver.ts` (79 lines) -- Transfer Hook PDA resolver
- `app/lib/swap/wsol.ts` (152 lines) -- WSOL wrap/unwrap helpers
- `app/lib/confirm-transaction.ts` (67 lines) -- Polling-based confirmation
- `app/lib/connection.ts` (52 lines) -- RPC Connection singleton
- `app/lib/staking/staking-builders.ts` (381 lines) -- Staking TX builders
- `app/lib/curve/curve-tx-builder.ts` (226 lines) -- Bonding curve TX builders
- `scripts/crank/crank-runner.ts` (332 lines) -- 24/7 epoch crank
- `scripts/crank/crank-provider.ts` (178 lines) -- Crank config loader
- `scripts/vrf/lib/vrf-flow.ts` (791 lines) -- VRF 3-TX flow
- `scripts/graduation/graduate.ts` (1011 lines) -- Graduation orchestration
- `scripts/deploy/initialize.ts` (partial -- too large for full read)

### Files Read (Layer 2 -- Signatures)
- `app/hooks/useStaking.ts` (first 100 lines) -- Staking lifecycle hook
- `scripts/e2e/lib/swap-flow.ts` (first 100 lines) -- E2E swap test helper

### Patterns Observed
- Consistent use of `accountsStrict()` across all Anchor instruction builders
- Consistent ComputeBudget instruction pattern (setLimit always, setPrice only if > 0)
- Consistent hook account resolution via `resolveHookAccounts(source, mint, dest)`
- Consistent blockhash + lastValidBlockHeight pairing
- Consistent `confirmed` commitment for financial reads
- `BN` used for all on-chain instruction arguments (correct for Anchor)
- `number` used for amounts in builder params (potential precision issue for very large values)
