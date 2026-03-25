# Switchboard VRF Integration — Security & Best Practices Review

**Project**: Dr. Fraudsworth's Finance Factory
**Date**: 2026-03-05
**Scope**: Epoch Program Switchboard On-Demand VRF integration (Rust + TypeScript)
**SDK Version**: `switchboard-on-demand = 0.11.3`

---

## Architecture Overview

The Epoch Program manages a 30-minute epoch cycle. Each transition uses Switchboard On-Demand VRF to derive random tax rates and optionally trigger "Carnage" buyback-and-burn operations.

### VRF Flow (3-Transaction Pattern)

| TX | Action | Details |
|----|--------|---------|
| **TX1** | Create randomness account | Off-chain, `skipPreflight: true` (SDK LUT staleness) |
| **TX2** | Commit + trigger_epoch_transition | Binds randomness account, advances epoch, pays bounty |
| **TX3** | Reveal + consume_randomness | Reads VRF bytes, derives taxes, checks Carnage trigger. Optionally bundles `execute_carnage_atomic` in a v0 VersionedTransaction |

A `retry_epoch_vrf` instruction handles oracle timeout recovery (300-slot window). Carnage execution has atomic and fallback paths with lock windows and deadlines.

### Key Files — On-Chain (Rust)

| File | Purpose |
|------|---------|
| `programs/epoch-program/src/instructions/trigger_epoch_transition.rs` | TX2: epoch advance + VRF commit binding |
| `programs/epoch-program/src/instructions/consume_randomness.rs` | TX3: VRF reveal consumption + tax derivation |
| `programs/epoch-program/src/instructions/retry_epoch_vrf.rs` | Oracle timeout recovery |
| `programs/epoch-program/src/instructions/execute_carnage_atomic.rs` | Atomic Carnage (bundled with TX3) |
| `programs/epoch-program/src/instructions/execute_carnage.rs` | Fallback Carnage (separate TX after lock window) |
| `programs/epoch-program/src/instructions/force_carnage.rs` | Devnet-only test helper |
| `programs/epoch-program/src/state/epoch_state.rs` | Epoch state machine |
| `programs/epoch-program/src/helpers/tax_derivation.rs` | VRF bytes → tax rate derivation |
| `programs/epoch-program/src/helpers/carnage.rs` | Carnage action/target derivation |
| `programs/epoch-program/src/constants.rs` | Switchboard PIDs, thresholds |
| `programs/epoch-program/src/errors.rs` | Error codes |

### Key Files — Off-Chain (TypeScript)

| File | Purpose |
|------|---------|
| `scripts/vrf/lib/vrf-flow.ts` | Canonical 3-TX flow with stale recovery + atomic Carnage bundling |
| `scripts/crank/crank-runner.ts` | Production 24/7 epoch advance loop |
| `scripts/vrf/lib/security-tests.ts` | Devnet security edge-case tests |
| `scripts/vrf/devnet-vrf-validation.ts` | Full validation suite orchestrator |
| `scripts/e2e/lib/carnage-flow.ts` | E2E Carnage flow (forced + natural paths) |
| `tests/integration/helpers/mock-vrf.ts` | Binary EpochState manipulation for local tests |
| `tests/integration/carnage.test.ts` | Integration tests using mock VRF |
| `scripts/prepare-carnage-state.ts` | Binary state injection for local validator |
| `tests/devnet-vrf.ts` | Early VRF prototype (not production) |

---

## Overall Assessment

**The Switchboard VRF integration is solid.** No critical vulnerabilities were found. The anti-reroll protection, commit-reveal-consume sequencing, timeout recovery, gateway handling, and atomic Carnage bundling are all well-implemented. The findings below are improvement opportunities, not showstoppers.

---

## Findings

### HIGH Severity

#### H-1: `from_u8_unchecked` silently coerces invalid `cheap_side` values

- **File**: `programs/epoch-program/src/instructions/consume_randomness.rs:194`
- **Issue**: `Token::from_u8_unchecked(epoch_state.cheap_side)` maps any value other than `0` to `Token::Fraud`. If `cheap_side` were ever corrupted to an unexpected value (2–255), the program would silently treat it as Fraud rather than erroring.
- **Context**: `cheap_side` is only set by `consume_randomness` itself (writes 0 or 1 from `TaxConfig`), but `from_u8_unchecked` bypasses a safety net that would catch corruption from future code changes or account manipulation.
- **Impact**: Incorrect tax derivation without any error signal if state is corrupted.
- **Recommendation**: Use `Token::from_u8(epoch_state.cheap_side).ok_or(EpochError::InvalidEpochState)?` instead.

#### H-2: `PublicKey.default` used as carnageWsol placeholder in E2E tests

- **File**: `scripts/e2e/lib/carnage-flow.ts:525, 696`
- **Issue**: `carnageWsol: PublicKey.default` is set as a placeholder with the comment "Resolved inside buildExecuteCarnageAtomicIx from keypair." However, `buildExecuteCarnageAtomicIx` (line 359) simply reads `ca.carnageWsol` and passes it directly — it never resolves or replaces the default. The zero address is sent to the on-chain instruction.
- **Impact**: E2E `testForcedCarnage` and `testNaturalCarnage` will always produce incorrect Carnage transactions. Production crank-runner is unaffected (loads real key at line 154).
- **Recommendation**: Load the real carnageWsol pubkey from env/keypair file, matching crank-runner.ts pattern.

---

### MEDIUM Severity

#### M-1: Bounty payment drains rent-exempt minimum from `carnage_sol_vault`

- **File**: `programs/epoch-program/src/instructions/trigger_epoch_transition.rs:194-227`
- **Issue**: The bounty check is `vault_balance >= TRIGGER_BOUNTY_LAMPORTS` (0.001 SOL) without accounting for rent-exempt minimum. Repeated bounty payments could drain the vault below rent exemption, causing the PDA account to be reaped by the runtime.
- **Impact**: Carnage operations blocked until re-funded. Currently mitigated by crank auto-top-up.
- **Status**: Already tracked in project TODO as "Bounty rent bug (mitigated)".
- **Recommendation**: Check `vault_balance >= TRIGGER_BOUNTY_LAMPORTS + rent_exempt_min` before paying.

#### M-2: `force_carnage` does not set `carnage_lock_slot`

- **File**: `programs/epoch-program/src/instructions/force_carnage.rs:60-67`
- **Issue**: Sets `carnage_pending`, `carnage_action`, `carnage_target`, and `carnage_deadline_slot`, but NOT `carnage_lock_slot`. Since it defaults to 0, the lock window check in `execute_carnage` (`clock.slot > epoch_state.carnage_lock_slot`) always passes immediately, bypassing the atomic-only lock window.
- **Impact**: Devnet-only (`#[cfg(feature = "devnet")]` + admin check), but lock window behavior cannot be faithfully tested via `force_carnage`.
- **Recommendation**: Set `epoch_state.carnage_lock_slot` to match `consume_randomness` behavior.

#### M-3: Multiple epochs can be skipped in a single transition

- **File**: `programs/epoch-program/src/instructions/trigger_epoch_transition.rs:135-139, 176`
- **Issue**: The check is `expected_epoch > epoch_state.current_epoch`, then sets `current_epoch = expected_epoch`. If no one triggers for several epoch periods, `expected_epoch` could jump (e.g., N to N+5) with only one VRF roll determining taxes for all skipped epochs.
- **Impact**: Tax rates stale for longer than intended. The staking `update_cumulative` CPI receives the jumped-to epoch number — depends on how staking handles epoch gaps.
- **Recommendation**: Document as intentional (acceptable for permissionless trigger design) or limit maximum skip to 1.

#### M-4: Pool accounts for slippage check lack owner constraint

- **File**: `programs/epoch-program/src/instructions/execute_carnage.rs:863-889`
- **File**: `programs/epoch-program/src/instructions/execute_carnage_atomic.rs:916-956`
- **Issue**: `read_pool_reserves` reads raw bytes from pool AccountInfo for the slippage check. Pool accounts (`crime_pool`, `fraud_pool`) are unchecked `AccountInfo` with only `#[account(mut)]`. The comment says "Validated by Tax Program during swap_exempt CPI" — true for the swap, but the slippage check happens BEFORE the CPI.
- **Impact**: DoS only — attacker can pass fake pool to fail the slippage check, but cannot extract funds (Tax Program validates during actual swap).
- **Recommendation**: Add owner constraint on pool accounts (e.g., `owner = amm_program_id()`).

#### M-5: Legacy `low_tax_bps` and `high_tax_bps` zeroed after first epoch

- **File**: `programs/epoch-program/src/instructions/consume_randomness.rs:197-199`
- **File**: `programs/epoch-program/src/helpers/tax_derivation.rs:121-122`
- **Issue**: `derive_taxes` returns `TaxConfig` with `low_tax_bps: 0` and `high_tax_bps: 0` (legacy fields). These overwrite the genesis values (300/1400) in `EpochState`. If any program or frontend reads these fields instead of per-token rates, it gets 0% tax.
- **Impact**: Depends on whether anything reads the legacy fields. Per-token rates are correctly set.
- **Recommendation**: Either remove legacy fields in a future migration, or populate with meaningful values.

#### M-6: TOCTOU gap in stale-VRF recovery (multi-crank race condition)

- **File**: `scripts/vrf/lib/vrf-flow.ts:367-400`
- **Issue**: Reads `stateBefore` and checks `vrfPending`. If another crank completes the pending VRF between the read and the recovery attempt, the recovery code tries to reveal an already-consumed randomness account, causing an on-chain error.
- **Impact**: Currently mitigated by single crank instance. Becomes a problem with multiple cranks.
- **Recommendation**: Handle the specific "already consumed" error gracefully, or implement optimistic locking.

#### M-7: Timeout recovery uses absolute slot wait instead of calculating from VRF request slot

- **File**: `scripts/vrf/lib/vrf-flow.ts:631`
- **Issue**: In the happy-path oracle-failure recovery, waits a flat 305 slots from current slot. By this point, ~75 slots have already passed during oracle retries. The stale-VRF recovery path (lines 431-438) correctly calculates from `vrfRequestSlot`, but this path doesn't.
- **Impact**: Wastes ~30 seconds per timeout recovery.
- **Recommendation**: Calculate remaining wait from the VRF request slot, not current slot.

#### M-8: Anti-reroll security test accepts any rejection as "passed"

- **File**: `scripts/vrf/lib/security-tests.ts:163-170`
- **Issue**: If `consumeRandomness` with the wrong randomness account fails for any reason (account not found, insufficient CU, serialization error), the test returns `passed: true`. Could mask a real vulnerability if the anti-reroll check were removed but another error happened to prevent the TX.
- **Recommendation**: Assert the specific `RandomnessAccountMismatch` / `ConstraintAddress` error code.

#### M-9: Crank runner logs full RPC URL including API key

- **File**: `scripts/crank/crank-runner.ts:177`
- **Issue**: `console.log(\`RPC: ${process.env.CLUSTER_URL || "localhost"}\`)` logs the full CLUSTER_URL which typically includes API keys (e.g., Helius `?api-key=xxx`). Railway captures these logs.
- **Context**: `reporter.ts` (line 284) already masks API keys in URLs; this line does not.
- **Recommendation**: Apply the same URL masking pattern from reporter.ts.

#### M-10: `tests/devnet-vrf.ts` missing `skipPreflight: true` on TX1

- **File**: `tests/devnet-vrf.ts:127`
- **Issue**: `connection.sendRawTransaction(createTx.serialize())` called without `{ skipPreflight: true }`. The canonical `vrf-flow.ts` (line 559) uses it because the SDK's LUT creation uses a finalized slot that can be slightly stale.
- **Impact**: Intermittent TX1 failures if this prototype file is used as reference. Not production code.
- **Recommendation**: Add `skipPreflight: true` or add a comment noting this is a prototype.

---

### LOW Severity

#### L-1: Switchboard `get_value` staleness delegated to SDK defaults

- **File**: `programs/epoch-program/src/instructions/consume_randomness.rs:169`
- **Issue**: `randomness_data.get_value(clock.slot)` delegates staleness to Switchboard's internal check. In `trigger_epoch_transition`, a manual `slot_diff <= 1` check is done, but `consume_randomness` relies on the SDK default.
- **Impact**: Low — SDK staleness is appropriate, and anti-reroll binding ensures the same account from trigger is used.

#### L-2: Auto-expire events emit `sol_retained: 0` instead of actual vault balance

- **File**: `programs/epoch-program/src/instructions/consume_randomness.rs:134, 144`
- **Issue**: `CarnageExpired`/`CarnageFailed` events emit `sol_retained: 0` because `consume_randomness` doesn't take `sol_vault` as an account.
- **Impact**: Off-chain monitoring gets inaccurate data for auto-expired Carnage events. No on-chain impact.

#### L-3: `initialize_epoch_state` and `initialize_carnage_fund` have no authority check

- **File**: `programs/epoch-program/src/instructions/initialize_epoch_state.rs:97-116`
- **Issue**: Anyone can call and front the rent. PDA `init` constraint prevents re-initialization. Genesis parameters are hardcoded constants, so state would be identical regardless of caller.
- **Impact**: Low — race-condition only risk. For `initialize_carnage_fund`, an attacker could theoretically front-run with wrong mints since the `token::mint` constraint only validates consistency, not correctness.
- **Recommendation**: Add an authority constraint or validate mint addresses against known constants in `initialize_carnage_fund`.

#### L-4: Hardcoded `MIN_EPOCH_SLOTS = 750` in crank runner

- **File**: `scripts/crank/crank-runner.ts:257`
- **Issue**: Comment says "On-chain SLOTS_PER_EPOCH = 750 (devnet) / 4500 (mainnet)" but the constant is hardcoded to 750.
- **Impact**: Must be updated before mainnet deployment.
- **Recommendation**: Make configurable via env var or derive from on-chain state.

#### L-5: Duplicated binary offsets across mock-vrf.ts and prepare-carnage-state.ts

- **File**: `tests/integration/helpers/mock-vrf.ts:38-61`
- **File**: `scripts/prepare-carnage-state.ts:30-37`
- **Issue**: Both files hardcode byte offsets for EpochState fields with no automated synchronization. If the Rust struct changes, these offsets silently become wrong.
- **Recommendation**: Consolidate into a shared constant file, or add a test that verifies offsets against the Anchor IDL.

#### L-6: Hardcoded Anchor discriminators lack validation tests

- **File**: `programs/epoch-program/src/constants.rs:117`
- **File**: `programs/epoch-program/src/instructions/execute_carnage.rs:767`
- **Issue**: `SWAP_EXEMPT_DISCRIMINATOR` is hardcoded without a validation test. `UPDATE_CUMULATIVE_DISCRIMINATOR` has a test; `SWAP_EXEMPT_DISCRIMINATOR` does not.
- **Recommendation**: Add a matching validation test.

#### L-7: `loadCarnageWsolPubkey` reads full secret key just to derive pubkey

- **File**: `scripts/crank/crank-runner.ts:97-112`
- **Issue**: Reads full Keypair from `keypairs/carnage-wsol.json` and calls `.publicKey`. The WSOL account is a token account, not a signing key — only the pubkey is needed. The `CARNAGE_WSOL_PUBKEY` env var path avoids this.
- **Impact**: Secret key unnecessarily loaded into process memory.
- **Recommendation**: Prefer the env var path, or store just the pubkey in a separate file.

#### L-8: Crank wallet balance warning threshold may be too low

- **File**: `scripts/crank/crank-runner.ts:213`
- **Issue**: Warning triggers at < 1 SOL with only a log line. No alert escalation.
- **Recommendation**: Consider external alerting or a lower threshold for hard-stop.

#### L-9: 10% CU margin in carnage.test.ts may be tight

- **File**: `tests/integration/carnage.test.ts:412, 452`
- **Issue**: Simulation uses 1.4M CU, execution uses `Math.ceil(cuUsed * 1.1)`. CU can vary between simulation and execution due to different slot/state.
- **Impact**: Flaky test failures under CU variance.

---

### INFORMATIONAL (Positive Findings)

| ID | Finding | Assessment |
|----|---------|------------|
| **I-1** | Anti-reroll protection | `pending_randomness_account` binding in `trigger_epoch_transition` + verification in `consume_randomness` correctly prevents VRF reroll attacks. |
| **I-2** | Switchboard PID feature-flagged | `constants.rs` correctly uses `ON_DEMAND_DEVNET_PID` / `ON_DEMAND_MAINNET_PID` with `#[cfg(feature = "devnet")]`. Prevents wrong-PID deployment. |
| **I-3** | VRF timeout recovery | `retry_epoch_vrf` properly validates timeout elapsed (>300 slots), validates fresh randomness, and rebinds the pending account. Prevents protocol deadlock. |
| **I-4** | Randomness freshness check | Both `trigger_epoch_transition` and `retry_epoch_vrf` enforce `slot_diff <= 1`, preventing use of pre-generated randomness accounts. |
| **I-5** | Atomic Carnage bundling | Bundling reveal + consume + executeCarnageAtomic in a single v0 TX means no `CarnagePending` event is visible on-chain before the swap executes. Effectively closes the CARN-002 MEV window. |
| **I-6** | Gateway rotation avoided | `vrf-flow.ts` correctly avoids rotating gateways. Well-documented reasoning: each randomness account is assigned to a specific oracle, alternative gateways serve different oracles whose signatures fail on-chain (0x1780). |
| **I-7** | Checked arithmetic | All operations use `checked_add`, `checked_sub`, `checked_mul`, `checked_div` with `EpochError::Overflow`. No integer overflow vulnerabilities found. |
| **I-8** | State machine fully guarded | `trigger_epoch_transition` requires `!vrf_pending`; `consume_randomness` requires `vrf_pending`; `retry_epoch_vrf` requires `vrf_pending` + timeout; `execute_carnage` requires `carnage_pending` + deadline + lock. No skip or replay vulnerabilities. |
| **I-9** | VRF bytes consumed exactly once | `vrf_pending` flag cleared immediately after reading randomness. Anti-reroll binding prevents account substitution. |
| **I-10** | `force_carnage` double-gated | Compile-time `#[cfg(feature = "devnet")]` + runtime admin pubkey check. Good defense-in-depth. |
| **I-11** | Mock VRF well-designed | Two-phase test approach (init protocol, dump state, restart with modified state) cleanly tests Carnage execution without a real oracle. |

---

### Code Duplication Note

`execute_carnage.rs` and `execute_carnage_atomic.rs` are nearly identical (~900 lines each) with duplicated `burn_held_tokens`, `wrap_sol_to_wsol`, `execute_sell_swap`, `execute_buy_swap`, `execute_swap_exempt_cpi`, `read_pool_reserves`, and `approve_delegate` functions. A fix applied to one but not the other creates divergence. Consider extracting shared logic into `helpers/`.

---

## Recommended Action Priority

| Priority | ID | Action | Effort |
|----------|----|--------|--------|
| 1 | H-1 | Swap `from_u8_unchecked` to checked conversion with error | One-line fix |
| 2 | H-2 | Fix `PublicKey.default` in carnage-flow.ts E2E tests | Small fix |
| 3 | M-9 | Mask RPC URL in crank-runner startup log | One-line fix |
| 4 | M-4 | Add owner constraint on pool accounts in execute_carnage | Small fix |
| 5 | M-2 | Set `carnage_lock_slot` in force_carnage | One-line fix |
| 6 | M-8 | Tighten security test to assert specific error code | Small fix |
| 7 | M-7 | Calculate timeout from VRF request slot, not current slot | Small fix |
| 8 | L-6 | Add SWAP_EXEMPT_DISCRIMINATOR validation test | Small test |
| 9 | L-3 | Add authority check to `initialize_carnage_fund` | Small fix |
| 10 | M-1 | On-chain rent-exempt check for bounty payment | Medium fix (deferred) |
| 11 | M-3 | Document or limit epoch skipping behavior | Design decision |
| 12 | M-5 | Remove or populate legacy tax fields | Migration (deferred) |
| — | L-4 | Update MIN_EPOCH_SLOTS for mainnet | Pre-mainnet checklist |
| — | L-5 | Consolidate binary offsets | Maintenance |

---

*Review performed 2026-03-05. Scope limited to Switchboard VRF integration within the Epoch Program and associated TypeScript scripts.*

---
---

# Helius RPC & API Integration — Efficiency Audit

**Project**: Dr. Fraudsworth's Finance Factory
**Date**: 2026-03-05
**Scope**: Frontend Helius usage across RPC, webhooks, DAS API, priority fees, and data fetching patterns

---

## Architecture Overview

Helius serves as the primary RPC and event ingestion layer. The architecture follows a server-side webhook + SSE pattern that minimizes client-side RPC calls:

```
On-chain Events (Tax/Epoch/Carnage)
         |
    Helius Raw Webhook
         |
/api/webhooks/helius (event parsing + Postgres storage)
         |
    REST API Routes (/api/candles, /api/carnage-events)
         |
    React Hooks + SSE (useChartData + useChartSSE)
         |
    UI Components (CandlestickChart, CarnageCard, etc.)
```

### Key Files — RPC & Connection

| File | Purpose |
|------|---------|
| `app/lib/connection.ts` | Singleton memoized Connection with explicit WebSocket endpoint |
| `shared/constants.ts` | Helius API key + RPC URL constants |
| `app/.env.local` / `.env` | Environment variables for RPC URL |
| `app/next.config.ts` | CSP headers whitelisting Helius endpoints |

### Key Files — Webhook Pipeline

| File | Purpose |
|------|---------|
| `app/app/api/webhooks/helius/route.ts` | Raw webhook receiver: parses Anchor events, stores to Postgres, broadcasts SSE |
| `scripts/webhook-manage.ts` | Webhook CRUD operations (list, create, update, delete) |

### Key Files — Data Fetching Hooks

| File | Purpose |
|------|---------|
| `app/hooks/useTokenBalances.ts` | Token balance polling (30s) via `getParsedTokenAccountsByOwner` |
| `app/hooks/usePoolPrices.ts` | Pool reserves via `getMultipleAccountsInfo` + WebSocket subscriptions |
| `app/hooks/useCarnageData.ts` | Carnage state polling (30s) + vault balance WebSocket |
| `app/hooks/useCurrentSlot.ts` | Wall-clock slot estimation with periodic RPC resync |
| `app/hooks/useProtocolWallet.ts` | Sign-then-send transaction submission |
| `app/lib/confirm-transaction.ts` | Polling-based TX confirmation (2s interval, 90s max) |

---

## Overall Assessment

**The Helius integration is well-optimized.** The webhook-based event ingestion pipeline saves ~900 credits/hr vs client-side transaction parsing. Visibility-aware polling, batched RPC calls, and smart slot estimation demonstrate strong efficiency awareness. The findings below are improvement opportunities for mainnet readiness.

---

## Findings

### Positive Findings (What's Working Well)

| ID | Finding | Assessment |
|----|---------|------------|
| **I-1** | Webhook-based event ingestion | Raw webhook + Anchor EventParser correctly handles custom program events (enhanced webhooks show as "UNKNOWN"). Saves ~900 credits/hr vs client-side `getSignaturesForAddress` + `getParsedTransaction` polling. |
| **I-2** | Singleton Connection | `getConnection()` memoizes a single Connection instance, preventing duplicate WebSocket connections and RPC rate limit exhaustion. |
| **I-3** | Visibility-aware polling | All polling hooks use `useVisibility()` and pause when tab is hidden or irrelevant modal is open. |
| **I-4** | Batched RPC calls | `usePoolPrices` uses `getMultipleAccountsInfo()` (1 credit for 4 pool accounts vs 4 individual calls). |
| **I-5** | Smart slot estimation | `useCurrentSlot` uses wall-clock extrapolation (400ms/slot), only syncs with RPC ~1-2 times/hr. Saves ~9,000 credits/hr vs `onSlotChange` subscription. |
| **I-6** | SSE for real-time charts | Candle/swap updates broadcast via Server-Sent Events from webhook handler — zero RPC polling for chart data. |
| **I-7** | Sign-then-send pattern | `useProtocolWallet` uses `wallet.signTransaction()` + `connection.sendRawTransaction()` instead of wallet-adapter's `signAndSendTransaction()`. Ensures TX goes through Helius RPC, not Phantom's (which silently drops devnet TXs). |
| **I-8** | Webhook idempotency | All Postgres inserts use `onConflictDoNothing()`, preventing duplicate event storage from webhook retries. |
| **I-9** | CSP headers configured | `next.config.ts` whitelists `https://devnet.helius-rpc.com`, `wss://devnet.helius-rpc.com`, `https://api.helius.xyz`, and `https://api-devnet.helius-rpc.com`. |

---

### MEDIUM Severity

#### HEL-M1: Priority fees use hardcoded presets instead of Helius Priority Fee API

- **File**: `app/hooks/useSwap.ts` (lines 94-100)
- **Issue**: Priority fees are hardcoded microLamport values:
  ```typescript
  const PRIORITY_FEE_MAP = {
    none: 0, low: 1_000, medium: 10_000,
    high: 100_000, turbo: 1_000_000,
  }
  ```
  These static values will either overpay (wasting SOL) or underpay (TXs fail to land) on mainnet where fee markets are dynamic.
- **Impact**: Suboptimal TX landing rate and cost efficiency on mainnet.
- **Recommendation**: Integrate Helius `getPriorityFeeEstimate` API which returns real-time market fee rates based on recent slot data and the specific accounts in the transaction.

#### HEL-M2: Token balance polling every 30s could use webhook + SSE

- **File**: `app/hooks/useTokenBalances.ts` (lines 80-90)
- **Issue**: Polls `getBalance()` + `getParsedTokenAccountsByOwner()` every 30 seconds. This is the largest RPC credit consumer (~1.7M credits/month estimate with active users).
- **Impact**: High credit consumption; 30s staleness for balance display.
- **Recommendation**: Expand the existing Helius webhook to monitor token transfer events on CRIME/FRAUD/PROFIT mints. Push balance-change notifications via the existing SSE infrastructure. Falls back to polling on webhook miss.

#### HEL-M3: Carnage data polling could leverage existing webhook

- **File**: `app/hooks/useCarnageData.ts` (lines 76-155)
- **Issue**: Polls `CarnageFundState` PDA every 30s via `program.account.fetch()`. The webhook already monitors the Epoch Program but doesn't push CarnageFundState changes to the frontend.
- **Impact**: ~800 credits/month; unnecessary given the webhook already receives these transactions.
- **Recommendation**: Extract CarnageFundState changes from existing webhook events and broadcast via SSE.

#### HEL-M4: Webhook secret is optional

- **File**: `app/app/api/webhooks/helius/route.ts`
- **Issue**: `HELIUS_WEBHOOK_SECRET` header validation is skipped if the env var is not set. On devnet this is acceptable; on mainnet an attacker could POST fake events to corrupt Postgres data.
- **Impact**: Data integrity risk on mainnet.
- **Recommendation**: Make webhook secret validation mandatory (fail-closed) with a clear error if env var is missing.

---

### LOW Severity

#### HEL-L1: `getParsedTokenAccountsByOwner` could use Helius-exclusive `getTokenAccountsByOwnerV2`

- **File**: `app/hooks/useTokenBalances.ts`
- **Issue**: Standard `getParsedTokenAccountsByOwner` is used. Helius provides `getTokenAccountsByOwnerV2` with cursor-based pagination, which is more efficient for wallets with many token accounts.
- **Impact**: Low for current use case (users hold 3 tokens). Becomes relevant if token count grows.

#### HEL-L2: API key hardcoded in `shared/constants.ts`

- **File**: `shared/constants.ts` (line 407)
- **Issue**: Helius API key is hardcoded with comment "This is a free-tier API key, not a secret." While technically public (browser-visible via `NEXT_PUBLIC_` prefix), hardcoding makes rotation harder.
- **Impact**: Low — key rotation requires code change + redeploy instead of env var update.
- **Recommendation**: Source exclusively from `NEXT_PUBLIC_RPC_URL` env var for production.

#### HEL-L3: Crank runner logs full RPC URL including API key

- **File**: `scripts/crank/crank-runner.ts:177`
- **Issue**: `console.log(\`RPC: ${process.env.CLUSTER_URL || "localhost"}\`)` logs the full URL with API key. Railway captures these logs. `reporter.ts` already has a URL masking function that isn't used here.
- **Impact**: API key exposed in log aggregation.
- **Note**: Also captured as M-9 in Switchboard VRF section above.

#### HEL-L4: No use of Enhanced WebSockets (LaserStream)

- **Issue**: WebSocket connections use standard `wss://devnet.helius-rpc.com`. Helius now offers LaserStream-powered Enhanced WebSockets via `wss://atlas-mainnet.helius-rpc.com` (1.5-2x faster).
- **Impact**: Low on devnet; potential latency improvement on mainnet for pool price subscriptions.
- **Recommendation**: Evaluate for mainnet deployment.

---

### Estimated Credit Consumption (Monthly, Per Active User)

| Operation | Hook | Frequency | Est. Credits/Month |
|-----------|------|-----------|-------------------|
| Token balance polling | `useTokenBalances` | 30s | ~1.7M |
| Pool price fetch (batched) | `usePoolPrices` | Initial + WS | ~450 |
| Carnage data polling | `useCarnageData` | 30s | ~800 |
| Slot fetch | `useCurrentSlot` | 1-2/hr | ~50 |
| TX confirmation polling | `confirm-transaction` | Per swap | ~10-50/swap |
| **Total** | | | **~1.7M** |

Token balance polling dominates. All other operations are well-optimized.

---

## Recommended Action Priority

| Priority | ID | Action | Effort | When |
|----------|----|--------|--------|------|
| 1 | HEL-M1 | Integrate Helius Priority Fee API for dynamic fees | Medium | Pre-mainnet |
| 2 | HEL-M4 | Make webhook secret validation mandatory (fail-closed) | One-line fix | Pre-mainnet |
| 3 | HEL-M2 | Add token transfer webhook + SSE for balance updates | Medium | Pre-mainnet |
| 4 | HEL-M3 | Broadcast CarnageFundState changes via existing webhook/SSE | Small | Pre-mainnet |
| 5 | HEL-L3 | Mask API key in crank-runner log (same as M-9 above) | One-line fix | Now |
| 6 | HEL-L2 | Remove hardcoded API key from constants.ts | Small | Pre-mainnet |
| 7 | HEL-L4 | Evaluate LaserStream Enhanced WebSockets for mainnet | Research | Pre-mainnet |
| 8 | HEL-L1 | Consider `getTokenAccountsByOwnerV2` if token count grows | Small | Optional |

---

*Audit performed 2026-03-05. Scope: frontend Helius RPC, webhook, and data fetching patterns.*

---
---

# Bonding Curve Program — Security & Edge Case Review

**Project**: Dr. Fraudsworth's Finance Factory
**Date**: 2026-03-05
**Scope**: `programs/bonding_curve/` (Rust), graduation scripts, integration tests
**Reviewed through**: Meteora Dynamic Bonding Curve best practices lens

---

## Architecture Overview

The bonding curve program manages a dual-curve token launch (CRIME + FRAUD). Each faction token has its own curve with a linear price ramp from `P_START` to `P_END`. Both curves must fill before graduation to the AMM. If either fails (deadline expires), refunds are available.

### Lifecycle

```
Initialize → Fund → Start → Purchase/Sell (Active)
                                   |
                         ┌─────────┴──────────┐
                    Both Fill              Deadline Expires
                         |                        |
                   Prepare Transition         Mark Failed
                    (both → Graduated)            |
                         |                  Consolidate Escrow
                   Withdraw SOL                   |
                   Close Vault              Claim Refund
                   Distribute Escrow
```

### Key Files

| File | Purpose |
|------|---------|
| `src/math.rs` | Linear bonding curve integral (quadratic formula), price calculations |
| `src/state.rs` | `CurveState` struct, `CurveStatus` enum, refund eligibility logic |
| `src/constants.rs` | Price endpoints, targets, fees, deadlines |
| `src/instructions/purchase.rs` | Buy tokens on curve (with partial fill logic) |
| `src/instructions/sell.rs` | Sell tokens back to curve (15% tax) |
| `src/instructions/prepare_transition.rs` | Graduate both curves atomically |
| `src/instructions/mark_failed.rs` | Mark curve as failed after deadline |
| `src/instructions/consolidate_for_refund.rs` | Move tax escrow SOL to vault for refunds |
| `src/instructions/claim_refund.rs` | Proportional SOL refund (burns tokens) |
| `src/instructions/withdraw_graduated_sol.rs` | Admin withdraws SOL post-graduation |
| `src/instructions/close_token_vault.rs` | Close empty vault, recover rent |
| `src/instructions/distribute_tax_escrow.rs` | Send tax SOL to carnage fund |
| `tests/refund_clock_test.rs` | LiteSVM-based clock boundary tests |
| `scripts/graduation/graduate.ts` | 11-step checkpoint+resume graduation script |
| `tests/integration/lifecycle.test.ts` | Full lifecycle integration tests |

---

## Overall Assessment

**The bonding curve program is well-built.** Math uses defensive u128 intermediates with checked arithmetic throughout. State machine transitions are properly guarded by Anchor constraints. Property-based testing is extensive (500K+ buy iterations, 1M+ sell iterations). The findings below are improvement opportunities, not showstoppers.

---

## Findings

### HIGH Severity

#### BC-H1: Purchase partial fill has no SOL-side slippage check

- **File**: `programs/bonding_curve/src/instructions/purchase.rs:158-162`
- **Issue**: When remaining supply forces a partial fill (tokens_out capped to remaining), the SOL cost is recalculated via `calculate_sol_for_tokens`. However, only the *token* output is checked against `minimum_tokens_out`. The user has no protection on how much SOL they actually spend in the partial fill.
- **Context**: The recalculated SOL should be <= the original `sol_amount` by construction (fewer tokens = less SOL on a monotonic curve), but there's no explicit assertion verifying this invariant.
- **Impact**: If the curve math ever has a precision edge case where partial fill SOL > original SOL, the user overpays with no error.
- **Recommendation**: Add bidirectional slippage check:
  ```rust
  require!(actual_sol <= sol_amount, CurveError::SlippageExceeded);
  ```

---

### MEDIUM Severity

#### BC-M1: Sell solvency assertion doesn't account for refund withdrawals

- **File**: `programs/bonding_curve/src/instructions/sell.rs:276-292`
- **Issue**: Post-sell defence-in-depth check compares vault balance against `calculate_sol_for_tokens(0, curve.tokens_sold)` (the full integral). But `claim_refund` also withdraws SOL from the same vault. If sell could ever run after partial refunds, the assertion would incorrectly fire.
- **Context**: Currently unreachable — sell requires `status == Active`, refund requires `status == Failed`. But the assertion is misleading and fragile if state logic changes.
- **Recommendation**: Document the mutual exclusivity assumption, or adjust formula to subtract `sol_returned`:
  ```rust
  let expected_net = expected_from_integral.saturating_sub(curve.sol_returned);
  ```

#### BC-M2: Rounding direction asymmetry across purchase/sell/refund

- **File**: `programs/bonding_curve/src/instructions/claim_refund.rs:146-149`
- **Issue**: Purchases use ceil rounding (user pays more), sell tax uses ceil rounding (user pays more), refunds use floor rounding (user gets less). The protocol captures rounding bias at every touchpoint.
- **Impact**: Dust accumulates in the vault and becomes unclaimable. Not exploitable, but violates "no leakage" accounting principle. Over many refunds, could amount to a measurable discrepancy.
- **Recommendation**: Document the intentional rounding bias and maximum theoretical leakage. Consider a final dust sweep instruction for the last refund claimant.

#### BC-M3: Partner curve not validated as actual counterpart

- **File**: `programs/bonding_curve/src/instructions/claim_refund.rs`, `consolidate_for_refund.rs`
- **Issue**: Refund eligibility depends on the partner curve's status (e.g., Filled curve can claim refunds if partner is Failed). The constraint only checks `partner_curve_state.key() != curve_state.key()` — it does NOT verify the partner is the actual CRIME/FRAUD counterpart.
- **Impact**: An attacker could create a dummy curve in Failed state and pass it as the "partner" to unlock premature refunds on a curve that shouldn't allow them yet.
- **Recommendation**: Add constraint validating `partner_curve_state.token_mint` is the expected counterpart mint (e.g., if self is CRIME, partner must be FRAUD and vice versa).

#### BC-M4: No compile-time assertion P_END > P_START

- **File**: `programs/bonding_curve/src/constants.rs:20-25`
- **Issue**: `P_START = 900` and `P_END = 3450` are hardcoded constants. If accidentally swapped, the quadratic formula in `calculate_tokens_out` would produce nonsensical results (negative discriminants).
- **Recommendation**: Add compile-time guard:
  ```rust
  const _: () = assert!(P_END > P_START);
  ```

#### BC-M5: Transfer hook remaining_accounts forwarded without validation

- **File**: `programs/bonding_curve/src/instructions/purchase.rs:227-233`
- **Issue**: All `ctx.remaining_accounts` are naively appended to the transfer_checked CPI instruction. No validation of count, metadata, or order.
- **Context**: Token-2022 runtime validates at the CPI level — wrong accounts cause the CPI to fail (not exploitable). But no explicit count check means silent failures if the client provides wrong accounts.
- **Recommendation**: Add explicit validation that remaining_accounts count matches expected hook schema (4 accounts per mint for CRIME/FRAUD).

---

### LOW Severity

#### BC-L1: Localnet feature allows any mint in initialize_curve

- **File**: `programs/bonding_curve/src/instructions/initialize_curve.rs:75-78`
- **Issue**: `cfg!(feature = "localnet")` bypasses mint validation. Intentional for test flexibility, but a localnet build accidentally deployed to devnet would accept arbitrary mints.
- **Recommendation**: Add warning comment about feature flag safety.

#### BC-L2: No multi-sig/timelock on graduated curve authority

- **File**: `programs/bonding_curve/src/instructions/withdraw_graduated_sol.rs`
- **Issue**: Post-graduation SOL withdrawal requires only a single signer. If the authority keypair is compromised after graduation, an attacker can drain all graduated vaults.
- **Recommendation**: Document the authority security assumption. Consider multi-sig for mainnet.

#### BC-L3: No explicit reentrancy guard

- **File**: All instruction files
- **Issue**: No `locked` flag like the AMM has. Relies on Solana runtime's RefCell borrow checker and the fact that CRIME/FRAUD token programs are trusted infrastructure.
- **Recommendation**: Document the assumption that token programs are non-malicious.

#### BC-L4: `get_current_price` masks overflow with `unwrap_or(0)`

- **File**: `programs/bonding_curve/src/math.rs:203-211`
- **Issue**: Uses `.unwrap_or(0)` instead of returning `Result`, silently masking overflow. In practice, `tokens_sold` is capped at `TARGET_TOKENS = 460e12` (well within u64), so overflow is impossible.
- **Recommendation**: Change to `saturating_mul` for consistency with the rest of the math module.

---

### INFORMATIONAL (Positive Findings)

| ID | Finding | Assessment |
|----|---------|------------|
| **BC-I1** | Defensive u128 math | All curve calculations use u128 intermediates with `checked_*` operations. No overflow vulnerabilities found. |
| **BC-I2** | Integer sqrt rounds down (protocol-favored) | `isqrt()` truncation means users receive slightly fewer tokens. Documented and tested across 500K+ proptest iterations. |
| **BC-I3** | Excellent property-based testing | 500K iterations for buy math, 1M iterations for sell math. Multi-user interleaved operations (5-15 ops, 2-5 users). Vault solvency verified continuously. |
| **BC-I4** | Proper Token-2022 hook forwarding | Transfer hooks forwarded via remaining_accounts through CPI. Consistent with AMM pattern. |
| **BC-I5** | Clean state machine | `CurveStatus` enum with explicit guards on every instruction. No skip or replay vulnerabilities found. |
| **BC-I6** | Good event logging | All critical state changes (purchase, sell, fill, graduation, refund) emit events with relevant data for off-chain monitoring. |
| **BC-I7** | Wallet cap enforcement | Per-wallet token limit (20M) enforced via ATA balance reads, preventing whale concentration. |
| **BC-I8** | Tax escrow separation | Tax SOL collected into separate escrow account. Clean separation for refund vs. distribution paths. |
| **BC-I9** | Partial fill logic | Correctly handles final buyer at curve boundary: caps tokens to remaining supply, recalculates proportional SOL cost, refunds excess. |

---

### Test Coverage Gaps

| ID | Missing Scenario | Priority |
|----|-----------------|----------|
| **BC-T1** | One curve fills, other fails → `prepareTransition` rejection | High |
| **BC-T2** | Purchase during grace period → should get `DeadlinePassed` error | High |
| **BC-T3** | Multiple refund claimants in lifecycle.test.ts (only in Rust LiteSVM tests) | High |
| **BC-T4** | Vault solvency invariant breach test (`VaultInsolvency` error never triggered) | Medium |
| **BC-T5** | Exact boundary: 1 token remaining + dust purchase rounding | Medium |
| **BC-T6** | graduate.ts pre-flight: admin balance check before pool seeding | Medium |

---

### Graduation Script (graduate.ts) Notes

**Strengths:**
- Checkpoint+resume pattern with `graduation-state.json` (11 steps tracked)
- Hardcoded graduation amounts (learned from Phase 69 env-sourcing bug)
- Idempotent: re-running safely skips completed steps
- Clear error messages with program log capture

**Gaps:**
- No recovery path for single-curve failure (one fills, other doesn't)
- No pre-flight validation that admin holds enough tokens for pool seeding (2x290M)
- No validation that SOL vault withdrawal matches expected amount

---

## Recommended Action Priority

| Priority | ID | Action | Effort |
|----------|----|--------|--------|
| 1 | BC-H1 | Add `actual_sol <= sol_amount` assertion in purchase partial fill | One-line fix |
| 2 | BC-M3 | Validate partner curve is actual counterpart mint | Small fix |
| 3 | BC-M4 | Add `const _: () = assert!(P_END > P_START);` | One-line fix |
| 4 | BC-T1 | Add single-curve failure integration test | Medium test |
| 5 | BC-T2 | Add grace period purchase test | Small test |
| 6 | BC-M1 | Document solvency assertion scope/mutual exclusivity | Documentation |
| 7 | BC-M2 | Document rounding asymmetry and maximum leakage | Documentation |
| 8 | BC-M5 | Add remaining_accounts count validation | Small fix |
| 9 | BC-L4 | Change `unwrap_or(0)` to `saturating_mul` in get_current_price | One-line fix |
| — | BC-L1 | Add feature flag warning comment | Documentation |
| — | BC-L2 | Document authority assumption; evaluate multi-sig for mainnet | Pre-mainnet |
| — | BC-L3 | Document reentrancy assumption | Documentation |

---

*Review performed 2026-03-05. Scope: bonding curve program (Rust), graduation scripts, integration tests.*

---
---

# AMM Program & Tax Integration — Security & Edge Case Review

**Project**: Dr. Fraudsworth's Finance Factory
**Date**: 2026-03-05
**Scope**: `programs/amm/` (Rust), `programs/tax-program/` (Rust), associated tests
**Reviewed through**: Meteora DAMM best practices lens

---

## Architecture Overview

The AMM is a custom constant-product (x*y=k) pool designed for tax-wrapped swaps. Users never call the AMM directly — all swaps route through the Tax Program, which enforces buy/sell taxes before CPI-ing into the AMM.

```
User → Tax Program (swap_sol_buy / swap_sol_sell)
              |
         Tax deduction
              |
         CPI → AMM (swap_sol_pool)
              |
         Token-2022 transfer_checked
              |
         Transfer Hook (whitelist validation)
```

### Access Control Model

| Action | Who Can Call | Enforcement |
|--------|------------|-------------|
| `swap_sol_pool` | Tax Program only | `swap_authority` PDA derived from Tax Program |
| `swap_exempt` | Epoch Program only | `carnage_authority` PDA derived from Epoch Program |
| `initialize_pool` | Admin only | `AdminConfig` PDA with `has_one = admin` |
| `burn_admin` | Admin only | Permanently disables admin (irreversible) |

### Key Files — AMM

| File | Purpose |
|------|---------|
| `amm/src/helpers/math.rs` | Constant product formula, k-invariant verification |
| `amm/src/helpers/transfers.rs` | Manual `invoke_signed` for Token-2022 + hook forwarding |
| `amm/src/state/pool.rs` | Pool state (reserves, vaults, mints, fees) |
| `amm/src/instructions/swap_sol_pool.rs` | Swap handler with CEI ordering + reentrancy guard |
| `amm/src/instructions/initialize_pool.rs` | Pool creation with canonical mint ordering |
| `amm/src/instructions/burn_admin.rs` | Permanent admin removal |

### Key Files — Tax Program

| File | Purpose |
|------|---------|
| `tax-program/src/instructions/swap_sol_buy.rs` | Buy flow: deduct tax from SOL input, CPI to AMM |
| `tax-program/src/instructions/swap_sol_sell.rs` | Sell flow: CPI to AMM, deduct tax from SOL output |
| `tax-program/src/instructions/swap_exempt.rs` | Tax-exempt swap for Carnage operations |
| `tax-program/src/helpers/pool_reader.rs` | Raw byte reading of pool reserves for floor calc |
| `tax-program/src/helpers/tax_math.rs` | Tax BPS calculation |

---

## Overall Assessment

**The AMM is production-grade from a security perspective.** Constant product math is verified with proptest, all arithmetic uses checked operations, access control is enforced at the PDA level, and reentrancy is guarded. The Tax Program integration is well-designed with one notable gap around canonical mint ordering.

---

## Findings

### HIGH Severity

#### AMM-H1: Tax program pool_reader missing `is_reversed` canonical mint detection

- **File**: `programs/tax-program/src/helpers/pool_reader.rs`
- **Issue**: `read_pool_reserves()` reads `reserve_a` and `reserve_b` from pool bytes at fixed offsets but assumes a fixed mapping (`reserve_a = SOL`, `reserve_b = token`). Per Phase 52.1, when `token_mint < WSOL_mint` in raw bytes, the AMM stores them as `mint_a = token, mint_b = WSOL` — reversing which reserve is which.
- **Context**: The epoch_program already handles this correctly via `is_reversed` detection at `execute_carnage_atomic.rs:930-956`. The tax program never got the same fix.
- **Impact**: On mainnet where vanity mint addresses could have different byte ordering, the floor calculation silently uses swapped reserves, producing either too-strict floors (rejecting valid swaps) or too-loose floors (not protecting against sandwiches).
- **Note**: Currently safe on devnet by luck — `NATIVE_MINT (0x06) < everything`, so SOL is always `mint_a`. Mainnet vanity addresses may not preserve this.
- **Recommendation**: Port the `is_reversed` detection from epoch_program:
  ```rust
  let mint_a = Pubkey::try_from(&pool_bytes[9..41]).unwrap();
  let is_reversed = mint_a != wsol_mint;
  if is_reversed { std::mem::swap(&mut reserve_a, &mut reserve_b); }
  ```

---

### MEDIUM Severity

#### AMM-M1: Reserve drift from vault balances (no runtime validation)

- **File**: `programs/amm/src/state/pool.rs`
- **Issue**: Pool state stores `reserve_a` and `reserve_b` which are updated during swaps. However, there is no runtime check that these values match actual vault token account balances. If any external mechanism modifies vault balances (shouldn't be possible since vaults are PDAs owned by the pool, but defence-in-depth), reserves would drift.
- **Impact**: Mitigated by PDA ownership — only the AMM program can sign vault transfers. Theoretical risk only.
- **Recommendation**: Consider an optional `verify_vault_balance` instruction for periodic auditing.

#### AMM-M2: CPI depth at Solana limit on exempt swap path

- **File**: `programs/tax-program/src/instructions/swap_exempt.rs`
- **Issue**: The exempt swap CPI chain is:
  ```
  Epoch → Tax (swap_exempt) → AMM (swap_sol_pool) → Token-2022 → Transfer Hook = 4 levels
  ```
  This is Solana's maximum CPI depth. Any additional CPI in this chain would cause TX failure.
- **Impact**: Design constraint that must never be violated. Any future logging/monitoring CPI addition breaks this path.
- **Recommendation**: Document the CPI depth constraint prominently. Never add CPI calls to the exempt path.

#### AMM-M3: Missing test coverage for reversed mint order

- **File**: AMM and tax program test suites
- **Issue**: No integration test verifies floor calculations work when `mint_a != SOL` (canonical ordering flipped). Also missing: hook account split validation for pure T22 pools, sell output floor boundary conditions.
- **Recommendation**: Add test with a pool where token mint < SOL mint to verify floor calculation correctness.

---

### LOW Severity

#### AMM-L1: No minimum liquidity check at pool creation

- **File**: `programs/amm/src/instructions/initialize_pool.rs:48`
- **Issue**: Pools can be created with dust liquidity (`amount_a > 0 && amount_b > 0`). This could cause precision loss in swap calculations.
- **Context**: Pool creation requires admin signature, so griefing is limited. Not a security issue.
- **Recommendation**: Consider a minimum liquidity threshold (e.g., 1M tokens per side).

#### AMM-L2: Sandwich attacks possible at Solana level

- **File**: `programs/amm/src/instructions/swap_sol_pool.rs`
- **Issue**: The AMM relies on `minimum_amount_out` for MEV protection. No commitment-reveal scheme or MEV-resistant ordering. Standard for Solana DEXes.
- **Context**: The 50% floor in the tax program provides additional protection against blatant sandwich attacks.

#### AMM-L3: No dynamic fee adjustment

- **File**: `programs/amm/src/constants.rs`
- **Issue**: `lp_fee_bps` is set at pool creation and never changes. Meteora's DAMM adjusts fees based on volatility.
- **Context**: Acceptable for this protocol's design — the AMM is a static liquidity pool for tax-wrapped swaps, not a dynamic LP system.

---

### INFORMATIONAL (Positive Findings)

| ID | Finding | Assessment |
|----|---------|------------|
| **AMM-I1** | Constant product math correct | Formula verified with proptest (10K iterations). k_after >= k_before enforced on every swap via u128 verification. |
| **AMM-I2** | Comprehensive overflow protection | All arithmetic uses `checked_*` operations. u64::MAX reserves + u64::MAX input fits in u128 (verified). |
| **AMM-I3** | Rounding favors protocol | Integer division truncates output (floor), so dust accrues to the pool. Standard and correct. |
| **AMM-I4** | Fee applied before swap math | LP fee deducted from input before computing output. Fee stays in pool, accrues to LPs. Correct ordering. |
| **AMM-I5** | Division by zero guarded | Explicit `if denominator == 0 { return None; }` check. |
| **AMM-I6** | Reentrancy guard present | Pool `locked` flag set at swap start, cleared at end. Defence-in-depth over Solana's RefCell protection. |
| **AMM-I7** | Token-2022 hooks handled correctly | Manual `invoke_signed` helper (not Anchor CPI) correctly appends hook accounts to both `ix.accounts` and `account_infos`. |
| **AMM-I8** | Swap access strictly controlled | `swap_authority` PDA derived from Tax Program via `seeds::program = TAX_PROGRAM_ID`. Users cannot bypass tax. |
| **AMM-I9** | Admin cannot drain pools | Vault authority is pool PDA, not admin. Admin only creates pools and can `burn_admin` (permanent, irreversible). |
| **AMM-I10** | Canonical mint ordering enforced | `require!(mint_a < mint_b)` at pool creation. Deterministic PDA derivation. |
| **AMM-I11** | Strict CEI ordering | Checks → Effects (reserve update) → Interactions (transfers) → Post-check (k-invariant). |
| **AMM-I12** | All accounts validated | Vaults, mints, token programs checked against pool state via Anchor constraints. |
| **AMM-I13** | Tax buy/sell correctly applied | Buy: tax on SOL input (before swap). Sell: tax on SOL output (after swap). Both correct. |
| **AMM-I14** | Webhook idempotency in tests | All CPI access control tests exhaustively verify direct user calls fail with ConstraintSeeds error. |

---

## Recommended Action Priority

| Priority | ID | Action | Effort |
|----------|----|--------|--------|
| 1 | AMM-H1 | Port `is_reversed` detection from epoch_program to tax program pool_reader | Small fix |
| 2 | AMM-M3 | Add reversed mint order integration test | Medium test |
| 3 | AMM-M2 | Document CPI depth constraint (4 levels max on exempt path) | Documentation |
| 4 | AMM-M1 | Consider optional `verify_vault_balance` instruction | Low priority |
| — | AMM-L1 | Evaluate minimum liquidity threshold | Optional |
| — | AMM-L3 | Dynamic fees out of scope for current design | No action |

---

*Review performed 2026-03-05. Scope: AMM program, Tax Program, and associated test suites.*
