---
doc_id: oracle-failure-playbook
title: "Dr. Fraudsworth's Finance Factory -- Oracle & VRF Failure Playbook"
wave: 4
requires: []
provides: [oracle-failure-playbook]
status: draft
decisions_referenced: [security, operations, error-handling]
needs_verification:
  - "CARNAGE_FALLBACK_FRONT_RUNNING_FREQUENCY: The 50-slot atomic lock window has been implemented but the frequency of fallback path executions under real mainnet conditions is untested."
---

# Oracle & VRF Failure Playbook

## Overview

Dr. Fraudsworth depends on Switchboard On-Demand VRF for every epoch transition. The Epoch Program (`G6dmJTdC36VRqqi57QhWH444Ju7ieCzHZW9yhH7TpUhz`) uses VRF randomness to determine tax regimes (75% flip probability) and Carnage triggers (~4.3% probability) every epoch (~5 minutes on devnet / ~30 minutes on mainnet).

This dependency creates a critical operational surface: if the oracle fails, epoch transitions stall. While swaps continue with stale tax rates and no funds are ever locked, the protocol's core game-theoretic loop (regime changes driving arbitrage) freezes until VRF resumes.

This playbook exists because VRF failures are not theoretical. During devnet operations (50+ epoch overnight runs, Carnage Hunter tests), we have encountered every failure mode documented here. The recovery procedures are battle-tested.

**Key architectural property:** The crank bot is permissionless. It holds no special authority. If it dies, anyone with a funded wallet can crank epoch transitions. The protocol degrades gracefully -- never halts.

### Scope

| In Scope | Out of Scope |
|----------|--------------|
| Switchboard On-Demand VRF failures | AMM swap errors |
| Oracle gateway timeouts | Transfer Hook failures |
| VRF timeout recovery | Staking program errors |
| Crank bot crash recovery | Frontend/UI issues |
| Carnage execution failures | Wallet/key management |
| `cheapSide` deserialization | Switchboard internal infra |

---

## VRF Lifecycle (Happy Path)

The VRF epoch transition requires **three separate transactions**. This is a hard constraint imposed by the Switchboard SDK -- not a design choice.

```
                        Crank Bot             Solana            Switchboard Oracle
                           |                    |                       |
  TX 1: Create Account     |  Keypair.generate  |                       |
  (skipPreflight: true)    |------------------->|                       |
  Wait for FINALIZATION    |<-------------------|                       |
                           |                    |                       |
  TX 2: Commit + Trigger   |  SDK commitIx +    |                       |
  (400,000 CU)             |  triggerEpochTrans  |--- seed_slot ------->|
                           |------------------->|                       |
                           |<-------------------|                       |
                           |                    |                       |
  Wait ~3 slots (~1.2s)    |                    |<-- oracle reveals ----|
                           |                    |                       |
  TX 3: Reveal + Consume   |  SDK revealIx +    |                       |
  (600,000 CU with         |  consumeRandomness  |                       |
   Carnage bundled)        |  + executeCarnageA  |                       |
                           |------------------->|                       |
                           |<-------------------|                       |
                           |                    |                       |
                     Epoch advanced, new taxes applied
```

**Transaction details:**

| TX | Instructions | Confirmation | Cost |
|----|-------------|--------------|------|
| TX 1 | `Randomness.create()` | **Finalized** (not just confirmed) | ~0.003 SOL (rent) |
| TX 2 | `commitIx` + `triggerEpochTransition` | Confirmed | ~0.000005 SOL |
| TX 3 | `revealIx` + `consumeRandomness` + `executeCarnageAtomic` | Confirmed (skipPreflight for v0) | ~0.000005 SOL |

**Why three transactions, not two:** The Switchboard SDK's `commitIx()` reads the randomness account's on-chain data **client-side** before constructing the commit instruction. If the account does not exist yet, the SDK throws. Therefore TX 1 must create the account and wait for **finalization** before TX 2 can call `commitIx()`. Attempting to combine TX 1 + TX 2 always fails.

**Per-epoch cost:** ~0.003 SOL for the randomness account creation + ~0.00001 SOL in transaction fees. The crank bot receives a 0.001 SOL bounty (`TRIGGER_BOUNTY_LAMPORTS`) from the Carnage SOL vault, making each transition net-positive when the vault is funded.

**Timing (devnet):** TX 1 finalization takes ~30-40 seconds. TX 2 confirms in ~0.5s. Oracle reveal takes ~1-3 slots (~0.5-1.2s). TX 3 confirms in ~0.5s. Total happy path: ~45 seconds.

---

## Failure Modes

### F1: Gateway Timeout / Offline

**What happens:** The Switchboard oracle gateway does not respond to `revealIx()` calls. The SDK throws an error when attempting to construct the reveal instruction.

**Symptoms:**
- `revealIx()` throws after multiple retries
- Error messages containing `fetch failed`, `ECONNREFUSED`, or `504 Gateway Timeout`
- TX 1 and TX 2 succeed, but TX 3 never sends
- `vrf_pending` remains `true` on the EpochState account

**Detection:**
- Crank bot logs: `[tx3] Oracle gateway unresponsive after 10 attempts`
- Sentry alert: VRF cron heartbeat missed
- On-chain: `epochState.vrfPending === true` for more than 5 minutes

**Root cause:** Switchboard's oracle gateways are HTTP services that can experience transient downtime, rate limiting, or network partitions. Each randomness account is assigned to a specific oracle at creation time -- you cannot switch oracles after commitment.

**Recovery:**
1. Wait for VRF timeout (300 slots, ~2 minutes)
2. Follow the [VRF Timeout Recovery](#vrf-timeout-recovery-step-by-step) procedure
3. The fresh randomness account may be assigned to a different, working oracle

**DO NOT** attempt to use an alternative gateway (see [F2](#f2-oracle-signature-mismatch-0x1780) for why).

---

### F2: Oracle Signature Mismatch (0x1780)

**What happens:** A `revealIx` is constructed using a different oracle's gateway than the one assigned to the randomness account. The on-chain Switchboard program rejects the reveal because the oracle signature doesn't match.

**Symptoms:**
- Transaction fails with error code `0x1780` (decimal 6016)
- Error message: `custom program error: 0x1780` from the Switchboard program
- The reveal instruction was constructed successfully client-side but fails on-chain

**Root cause:** Each randomness account, when created via `Randomness.create()`, is bound to a specific oracle from the Switchboard queue. The oracle's TEE (Trusted Execution Environment) signs the randomness. Alternative gateways serve different oracles whose signatures fail the on-chain verification.

**This is the single most critical lesson from devnet operations: gateway rotation DOES NOT WORK.**

The Switchboard On-Demand model assigns oracle affinity at randomness account creation time. The SDK's internal gateway selection is opaque -- you get whichever oracle the queue assigns. If that oracle's gateway goes down, no other gateway can produce a valid reveal for that specific randomness account.

**Recovery:**
1. Abandon the current randomness account
2. Wait for VRF timeout (300 slots, ~2 minutes)
3. Create a **fresh** randomness account (`Keypair.generate()`, `Randomness.create()`)
4. Call `retry_epoch_vrf` with the fresh account
5. The fresh account may get a different, working oracle

**Code evidence** (from `scripts/vrf/lib/vrf-flow.ts`, line 196-201):

```typescript
// Why no gateway rotation? Each randomness account is assigned to a specific
// oracle during commit. The reveal instruction verifies the oracle's signature
// on-chain. Alternative gateways serve different oracles, so their signatures
// fail verification (error 0x1780). Only the assigned oracle's gateway can
// produce a valid reveal.
```

---

### F3: VRF Timeout (300 Slots)

**What happens:** The oracle fails to reveal randomness within the timeout window. This can happen due to oracle downtime (F1), signature mismatch (F2), or network congestion preventing the oracle from processing the commitment.

**Symptoms:**
- `epochState.vrfPending === true` persists beyond 300 slots (~2 minutes)
- `current_slot > epochState.vrfRequestSlot + 300`
- The crank bot logs: `[recovery] Oracle failed. Waiting for VRF timeout (300 slots, ~2 min)...`

**On-chain constant:**

```rust
// programs/epoch-program/src/constants.rs, line 70
pub const VRF_TIMEOUT_SLOTS: u64 = 300;
```

**When VRF timeout is triggered in `retry_epoch_vrf`:**

```rust
// programs/epoch-program/src/instructions/retry_epoch_vrf.rs, line 71-74
let elapsed_slots = clock.slot.saturating_sub(epoch_state.vrf_request_slot);
require!(
    elapsed_slots > VRF_TIMEOUT_SLOTS,
    EpochError::VrfTimeoutNotElapsed
);
```

Note the **strict greater-than** (`>`, not `>=`): the retry is permitted at slot 301 after the request, not at slot 300. This is intentional to give the oracle one final slot to reveal.

**Impact during timeout window:**
- Swaps continue normally with previous epoch's tax rates
- Staking works normally, rewards accumulate safely
- Carnage cannot trigger (requires `consume_randomness`)
- No funds are locked
- Protocol is functional but tax rates are stale

**Recovery:** See [VRF Timeout Recovery (Step-by-Step)](#vrf-timeout-recovery-step-by-step).

---

### F4: Stale LUT in Switchboard SDK

**What happens:** The Switchboard SDK internally uses an Address Lookup Table (LUT) for the `Randomness.create()` instruction. When the LUT was recently created or extended, the RPC may return stale data during preflight simulation, causing the transaction to be rejected.

**Symptoms:**
- TX 1 (`Randomness.create()`) fails during **preflight simulation** with `Blockhash not found` or `Transaction simulation failed: Blockhash not found`
- The actual on-chain state would accept the transaction -- the rejection is a simulation artifact

**Root cause:** Solana's transaction simulation (preflight) uses the RPC's current view of the ledger, which may lag behind the actual validator state. The Switchboard SDK's LUT references can be slightly stale, causing simulation to reject transactions that would succeed on-chain.

**Solution:** Always use `skipPreflight: true` for TX 1:

```typescript
// scripts/vrf/lib/vrf-flow.ts, line 536-539
const createSig = await connection.sendRawTransaction(createTx.serialize(), {
  skipPreflight: true,
  maxRetries: 3,
});
```

**Important:** When using `skipPreflight: true`, the transaction may fail silently on-chain. Always wait for confirmation and check `confirmation.value.err` to detect actual failures:

```typescript
await connection.confirmTransaction(createSig, "finalized");
```

If finalization fails, the randomness account was not created. Start over with a new keypair.

---

### F5: Crank Bot Crash / Extended Downtime

**What happens:** The overnight runner process crashes, the Railway container restarts, or the operator's machine loses power. No one is calling `trigger_epoch_transition`.

**Symptoms:**
- No `EpochTransitionTriggered` events in the Solana explorer for the Epoch Program
- `epochState.currentEpoch` falls behind `(currentSlot - genesisSlot) / SLOTS_PER_EPOCH`
- Tax rates remain static across what should be multiple epochs

**Impact:**
1. **Swaps continue normally** -- users buy/sell using the previous epoch's tax rates
2. **Tax rates remain static** -- no VRF means no regime changes
3. **Carnage cannot trigger** -- deferred until the next successful `consume_randomness`
4. **Staking rewards pause** -- `update_cumulative` CPI happens inside `consume_randomness`, so rewards don't finalize for new epochs until the crank resumes
5. **No protocol halt** -- the delay affects only game dynamics, not core trading
6. **No funds at risk** -- all accounts remain accessible

**Recovery:** When the crank bot restarts (or anyone cranks manually):
- Epoch advances to the **correct** epoch number (not just +1). If 5 epochs were missed, the first `trigger_epoch_transition` jumps straight to the correct epoch.
- Only **one** VRF cycle is needed per catch-up epoch. The epoch number advances in `trigger_epoch_transition` before VRF is committed.
- Cost per missed epoch: ~0.003 SOL (randomness account rent) x 3 TXs = ~0.003 SOL total
- If `vrf_pending` is true from a partial prior transition, the bot's built-in recovery (see vrf-flow.ts lines 377-512) automatically detects and resolves the stale state.

**Catching up N missed epochs requires N sequential 3-TX cycles**, each taking ~45 seconds on devnet. There is no batch catch-up -- each epoch needs its own VRF randomness.

---

### F6: Carnage Execution Failure

**What happens:** Carnage is triggered by VRF bytes (byte 5 < 11, ~4.3% probability) but the execution step fails. This can happen in the atomic path (bundled in TX 3) or the fallback path.

**Carnage execution timeline:**

```
consume_randomness (TX 3)
  |
  +-- VRF byte 5 < 11? --> No: emit CarnageNotTriggered, done
  |
  +-- Yes: set carnage_pending=true, carnage_lock_slot=now+50, carnage_deadline_slot=now+300
  |
  +-- executeCarnageAtomic (bundled in same TX 3)
        |
        +-- Success: clear pending, emit CarnageExecuted(atomic=true)
        |
        +-- Failure: carnage_pending stays true
              |
              +-- Slots 0-50: LOCK WINDOW (no fallback allowed)
              |
              +-- Slots 50-300: FALLBACK WINDOW (anyone can call execute_carnage)
              |
              +-- Slot 300+: EXPIRED (expire_carnage clears state, SOL stays in vault)
```

**Atomic path failure reasons:**
- Compute limit exceeded (CarnageSwapFailed, code 6021)
- Insufficient SOL in Carnage vault (InsufficientCarnageSol, code 6020)
- Slippage exceeded for the atomic path (CarnageSlippageExceeded, code 6028 -- floor is 85%, i.e., 8500 bps)

**Fallback path failure reasons:**
- Pool liquidity too low
- Slippage exceeded for the fallback path (floor is 75%, i.e., 7500 bps)
- No one calls `execute_carnage` within the 250-slot fallback window

**Empty vault = graceful no-op:** If the Carnage SOL vault has 0 SOL, the execution succeeds but buys 0 tokens. This is by design -- the protocol self-corrects as the vault accrues SOL from trade taxes (24% of all tax revenue flows to the Carnage vault).

**Recovery:**
- If atomic fails, the crank bot (or anyone) can call `execute_carnage` during the fallback window (slots 50-300 after trigger)
- If fallback also fails or no one calls it, `expire_carnage` can be called after slot 300 to clear the pending state
- SOL is **never lost** -- it stays in the vault and accumulates for the next Carnage trigger
- The next `consume_randomness` auto-expires stale pending Carnage before proceeding

---

### F7: cheapSide Deserialization Issue

**What happens:** The `cheap_side` field in EpochState is a `u8` on-chain (0 = CRIME, 1 = FRAUD), but Anchor's IDL serialization can represent it in different formats depending on the client version and serialization context.

**Symptoms:**
- Client code receives `cheapSide` as a number (`0` or `1`) in some contexts
- Client code receives `cheapSide` as an object (`{ crime: {} }` or `{ fraud: {} }`) in other contexts
- Comparison logic breaks: `cheapSide === 0` fails when value is `{ crime: {} }`

**Root cause:** Anchor's TypeScript client can serialize enums as either numeric values or discriminated union objects. The behavior depends on:
- Anchor version
- Whether the account is fetched via `program.account.epochState.fetch()` vs raw bytes
- Whether the value comes from an event or account data

**Solution (implemented in `vrf-flow.ts`):**

```typescript
// scripts/vrf/lib/vrf-flow.ts, line 180-185
function cheapSideToStr(val: any): string {
  if (typeof val === "number") return val === 0 ? "CRIME" : "FRAUD";
  if (val && val.crime !== undefined) return "CRIME";
  if (val && val.fraud !== undefined) return "FRAUD";
  return String(val) === "0" ? "CRIME" : "FRAUD";
}
```

Always use a conversion function like this. Never compare `cheapSide` directly with `===` against a number or string. The same pattern applies to `carnage_target` and `carnage_action` fields.

---

## Recovery Procedures

### VRF Timeout Recovery (Step-by-Step)

This is the primary recovery mechanism for any VRF failure that leaves `vrf_pending=true` on the EpochState account. The automated crank bot (`vrf-flow.ts`) implements this internally, but operators should understand the manual steps.

**Prerequisites:**
- Funded wallet (0.01 SOL minimum)
- Access to Solana CLI or a TypeScript script with `@switchboard-xyz/on-demand`

**Step 1: Verify VRF is stuck**

```typescript
const epochState = await epochProgram.account.epochState.fetch(epochStatePda);
console.log("vrf_pending:", epochState.vrfPending);
console.log("vrf_request_slot:", epochState.vrfRequestSlot.toString());

const currentSlot = await connection.getSlot();
const elapsedSlots = currentSlot - Number(epochState.vrfRequestSlot);
console.log("Slots elapsed since VRF request:", elapsedSlots);
console.log("Timeout threshold:", 300);
console.log("Can retry:", elapsedSlots > 300);
```

If `vrfPending` is `false`, VRF is not stuck -- the issue is elsewhere.

**Step 2: Wait for timeout (if needed)**

```typescript
const VRF_TIMEOUT_SLOTS = 300;
const slotsToWait = Math.max(0,
  Number(epochState.vrfRequestSlot) + VRF_TIMEOUT_SLOTS - currentSlot + 5
);

if (slotsToWait > 0) {
  console.log(`Waiting ${slotsToWait} slots (~${(slotsToWait * 0.4).toFixed(0)}s)...`);
  await waitForSlotAdvance(connection, slotsToWait);
}
```

The +5 buffer ensures we are safely past the boundary (the on-chain check is strict `>`, not `>=`).

**Step 3: Create fresh randomness account**

```typescript
const rngKp = Keypair.generate();
const [randomness, createIx] = await sb.Randomness.create(
  sbProgram, rngKp, queueAccount.pubkey
);

const createTx = new Transaction().add(createIx);
createTx.feePayer = wallet.publicKey;
createTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
createTx.sign(wallet.payer, rngKp);

const createSig = await connection.sendRawTransaction(createTx.serialize(), {
  skipPreflight: true,  // REQUIRED: Switchboard LUT staleness
  maxRetries: 3,
});
await connection.confirmTransaction(createSig, "finalized"); // MUST finalize
```

**Step 4: Commit + `retry_epoch_vrf`**

```typescript
const commitIx = await randomness.commitIx(queueAccount.pubkey);
const retryIx = await epochProgram.methods
  .retryEpochVrf()
  .accounts({
    payer: wallet.publicKey,
    epochState: epochStatePda,
    randomnessAccount: rngKp.publicKey,
  })
  .instruction();

const retryTx = new Transaction().add(
  ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
  commitIx,
  retryIx
);
await provider.sendAndConfirm(retryTx, [wallet.payer]);
```

**Step 5: Wait for oracle + Reveal + Consume**

```typescript
await waitForSlotAdvance(connection, 3);

let revealIx;
for (let i = 0; i < 10; i++) {
  try {
    revealIx = await randomness.revealIx();
    break;
  } catch (e) {
    if (i === 9) throw new Error("Oracle still not responding after retry");
    await sleep(3000 * (i + 1)); // Exponential backoff
  }
}

const consumeIx = await epochProgram.methods
  .consumeRandomness()
  .accounts({
    caller: wallet.publicKey,
    epochState: epochStatePda,
    randomnessAccount: rngKp.publicKey,
    stakingAuthority: stakingAuthorityPda,
    stakePool: stakePoolPda,
    stakingProgram: stakingProgramId,
    carnageState: carnageFundPda,
  })
  .instruction();

const consumeTx = new Transaction().add(
  ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
  revealIx,
  consumeIx
);
await provider.sendAndConfirm(consumeTx, [wallet.payer]);
```

**If Step 5 fails again:** The fresh randomness may have been assigned to the same broken oracle. Repeat from Step 2 -- each fresh randomness account may get a different oracle from the Switchboard queue.

**Observed recovery time from overnight runs:**
- VRF duration for epoch index 3 was 357,512ms (~6 minutes) vs the normal ~45 seconds. This was a real VRF timeout recovery in production that completed successfully after creating fresh randomness.

---

### Catching Up Missed Epochs

When the crank bot has been down for multiple epoch durations, multiple epochs need to be caught up sequentially.

**Cost estimate per missed epoch:**
| Item | Cost |
|------|------|
| Randomness account rent | ~0.003 SOL |
| TX fees (3 transactions) | ~0.00002 SOL |
| Bounty received | +0.001 SOL (if Carnage vault funded) |
| **Net cost per epoch** | **~0.002 SOL** |

**Time estimate:** ~45 seconds per epoch on devnet (dominated by TX 1 finalization).

**Procedure:**

1. Read current on-chain epoch vs expected epoch:
   ```typescript
   const state = await epochProgram.account.epochState.fetch(epochStatePda);
   const currentSlot = await connection.getSlot();
   const expectedEpoch = Math.floor(
     (currentSlot - Number(state.genesisSlot)) / SLOTS_PER_EPOCH
   );
   const epochsBehind = expectedEpoch - state.currentEpoch;
   console.log(`Behind by ${epochsBehind} epochs`);
   ```

2. For each missed epoch, execute the full 3-TX VRF flow. The first `trigger_epoch_transition` will jump to the correct epoch (not +1), but subsequent transitions still need one VRF cycle each because each epoch needs its own randomness.

3. After the first catch-up epoch, wait for the epoch boundary to advance before triggering the next. On devnet with `SLOTS_PER_EPOCH=750`, you cannot immediately trigger another transition -- the slot must advance past the next boundary.

4. The crank bot's `advanceEpochWithVRF` function handles all of this automatically, including stale VRF recovery. Simply restarting the overnight runner is sufficient.

---

### Manual VRF Crank

Epoch transitions are fully permissionless. Anyone can crank them. Here is the minimal procedure for manual cranking:

**Prerequisites:**
- Node.js 18+
- A funded Solana wallet (0.01 SOL minimum)
- The project's `scripts/vrf/lib/vrf-flow.ts` library

**Quick manual crank:**

```bash
# From project root
set -a && source .env && set +a
npx tsx scripts/vrf/devnet-vrf-validation.ts
```

This script runs a single VRF validation cycle that triggers one epoch transition.

**For extended manual cranking**, use the overnight runner with a low epoch count:

```bash
OVERNIGHT_EPOCHS=1 npx tsx scripts/e2e/overnight-runner.ts
```

**External operators** who want to crank without the project codebase need:
1. The Epoch Program IDL
2. The EpochState PDA address (`6716g7hsQiaPAf9jhXJ42HXrisAx8xMpifn6Yu4u15AS` on devnet)
3. The CarnageSolVault PDA address (`6EB2aqpvpBRBii9XRjJrYDiYqbqcDzeLGybdwoN49rZU` on devnet)
4. `@switchboard-xyz/on-demand` npm package
5. Knowledge of the 3-TX flow documented in this playbook

---

## Detection & Monitoring

### Sentry Crons Heartbeat

The crank bot emits heartbeat signals that can be monitored via Sentry Crons:

| Signal | Frequency | Meaning if missed |
|--------|-----------|-------------------|
| Epoch transition complete | Every ~5 min (devnet) / ~30 min (mainnet) | Crank bot is down or VRF is stuck |
| VRF recovery triggered | Ad hoc | Oracle failure occurred (informational) |
| Carnage executed | ~4.3% of epochs | Expected to be sparse |

**Implementation:** The zero-dependency Sentry integration (`app/lib/sentry.ts`) POSTs error envelopes via fetch(). No `@sentry/*` npm packages (they break Turbopack SSR).

### Error Patterns to Watch

| Pattern | Indicates | Severity | Action |
|---------|-----------|----------|--------|
| `0x1774` (`VrfAlreadyPending`) | Stale VRF from a crashed prior run | Medium | Auto-recovery handles this; verify it resolves within 5 minutes |
| `0x1780` (from Switchboard PID) | Oracle signature mismatch | High | DO NOT retry with same randomness. Wait for timeout + fresh randomness. |
| `0x177C` (`VrfTimeoutNotElapsed`) | Tried to retry too early | Low | Wait more slots. Check clock. |
| `0x1775` (`NoVrfPending`) | Tried to consume when no VRF pending | Low | State already recovered. Proceed with fresh transition. |
| `0x177A` (`RandomnessNotRevealed`) | Oracle hasn't revealed yet | Medium | Wait more slots. Retry `revealIx()`. May need timeout recovery. |
| VRF duration > 60s | Potential oracle slowness | Low | Monitor. If persistent, may need timeout recovery. |
| VRF duration > 300s | VRF timeout recovery occurred | Medium | Recovery is automatic. Verify epoch advanced after recovery. |
| `Blockhash not found` on TX 1 | Switchboard SDK LUT staleness | Low | Using `skipPreflight: true` should prevent this. |
| 3+ consecutive VRF failures | Switchboard systemic issue | Critical | Check Switchboard status page. Consider temporary pause of crank. |

### Log Messages That Indicate Problems

From the on-chain program (`msg!` output in transaction logs):

```
"VRF timeout check: elapsed=N slots, timeout=300 slots"  -- Retry was attempted
"Previous randomness timed out, allowing new commit"       -- V3 timeout path (if present)
"Auto-expiring stale Carnage: deadline=X, current=Y"       -- Stale Carnage auto-cleanup
"Carnage vault balance insufficient for bounty: X < Y"     -- Vault underfunded
```

From the crank bot (`console.log` output):

```
"[recovery] Stale VRF detected (vrf_pending=true). Recovering..."
"[recovery] Oracle failed. Waiting for VRF timeout (300 slots, ~2 min)..."
"[recovery] Creating fresh randomness for retry..."
"[tx3] Oracle gateway unresponsive after 10 attempts"
"VRF FAILED: <error details>"
```

---

## Decision Tree

When an epoch transition fails, follow this diagnosis path:

```
                         Epoch transition failed
                                  |
                    Is vrf_pending == true on-chain?
                         /                    \
                       Yes                     No
                        |                       |
              Did TX 2 (commit)          Did TX 2 fail?
              succeed?                        |
               /        \              Check error code
             Yes          No                  |
              |            |           EpochBoundaryNotReached (0x1773)?
              |            |            --> Wait for boundary slot
  Can you get revealIx()?  |
     /              \      |           VrfAlreadyPending (0x1774)?
   Yes               No   |            --> vrf_pending is actually true
    |                 |    |                (shouldn't reach this branch)
    |                 |    |
  Send TX 3       Wait for timeout      Other error?
  (reveal+consume)   (300 slots)         --> Check error-handling-playbook.md
    |                 |
  TX 3 fails?    Create fresh randomness
    |                 |
  Error 0x1780?   retry_epoch_vrf
    |                 |
  YES: oracle      Reveal succeeds?
  mismatch.         /          \
  --> Wait for    Yes           No
  timeout +        |             |
  fresh RNG    Send TX 3      Oracle down.
               (complete!)     Repeat from
                              "Create fresh"
                              (may get different oracle)
```

**Critical decision point:** When `revealIx()` fails, the ONLY recovery is:
1. Wait for VRF timeout (300 slots)
2. Create **fresh** randomness
3. Call `retry_epoch_vrf`

Never try gateway rotation. Never try to reuse the stuck randomness account.

---

## Epoch Program Error Reference (VRF-Related)

All error codes use Anchor's `6000 + variant_index` scheme. The Epoch Program ID is `G6dmJTdC36VRqqi57QhWH444Ju7ieCzHZW9yhH7TpUhz`.

| Code | Hex | Name | When | Recovery |
|------|-----|------|------|----------|
| 6003 | `0x1773` | `EpochBoundaryNotReached` | `trigger_epoch_transition` before boundary | Wait for slot to pass boundary |
| 6004 | `0x1774` | `VrfAlreadyPending` | `trigger_epoch_transition` when VRF pending | Wait for consume or timeout recovery |
| 6005 | `0x1775` | `NoVrfPending` | `consume_randomness` or `retry_epoch_vrf` when no VRF pending | No action needed -- state is already clean |
| 6006 | `0x1776` | `RandomnessParseError` | Randomness account data corrupt or not Switchboard-owned | Verify account is owned by Switchboard program |
| 6007 | `0x1777` | `RandomnessExpired` | `seed_slot` > 1 slot behind current | Create fresh randomness (account is stale) |
| 6008 | `0x1778` | `RandomnessAlreadyRevealed` | Attempting to commit already-revealed randomness | Create fresh randomness |
| 6009 | `0x1779` | `RandomnessAccountMismatch` | `consume_randomness` with wrong account (anti-reroll) | Use the exact account that was committed |
| 6010 | `0x177A` | `RandomnessNotRevealed` | `consume_randomness` before oracle reveals | Wait more slots; retry `revealIx()` |
| 6011 | `0x177B` | `InsufficientRandomness` | VRF returned < 8 bytes | Should not happen with Switchboard (returns 32) |
| 6012 | `0x177C` | `VrfTimeoutNotElapsed` | `retry_epoch_vrf` before 300 slots elapsed | Wait longer; check `vrf_request_slot` |
| 6025 | `0x1789` | `InvalidRandomnessOwner` | Randomness account not owned by Switchboard PID | Use a real Switchboard randomness account |

---

## What NOT To Do

### DO NOT Rotate Gateways

Each randomness account is bound to a specific oracle at creation time. Alternative gateways serve different oracles whose signatures **will fail on-chain** with error `0x1780`. The only solution for a stuck oracle is fresh randomness via `retry_epoch_vrf`.

### DO NOT Force-Kill Stuck Transactions

If a transaction is in-flight (submitted but not confirmed), do not send a conflicting transaction. Solana will eventually expire the blockhash (after ~60-90 seconds) and the transaction will be dropped. Wait for expiration, then proceed with recovery.

### DO NOT Panic on Empty Carnage Vault

An empty Carnage vault is a normal operational state when the protocol is young or after a Carnage execution drains it. The vault self-replenishes from trade taxes (24% of all tax revenue). When Carnage triggers with an empty vault, the swap buys 0 tokens -- a graceful no-op. SOL accumulates naturally over time.

### DO NOT Skip `skipPreflight: true` on TX 1

The Switchboard SDK's internal LUT can be stale relative to the RPC's simulation state. Without `skipPreflight: true`, TX 1 may be rejected during simulation even though it would succeed on-chain. This was discovered empirically during devnet testing and is documented in MEMORY.md.

### DO NOT Hardcode Switchboard Program IDs

Switchboard addresses differ between devnet and mainnet, and change with SDK upgrades. Always use dynamic resolution:

```typescript
const sbProgramId = await sb.getProgramId(connection);
const queueAccount = await sb.getDefaultQueue(connection.rpcEndpoint);
```

The on-chain program uses feature-flagged constants:
```rust
#[cfg(feature = "devnet")]
pub const SWITCHBOARD_PROGRAM_ID: Pubkey = switchboard_on_demand::ON_DEMAND_DEVNET_PID;

#[cfg(not(feature = "devnet"))]
pub const SWITCHBOARD_PROGRAM_ID: Pubkey = switchboard_on_demand::ON_DEMAND_MAINNET_PID;
```

### DO NOT Combine TX 1 and TX 2

The Switchboard SDK's `commitIx()` reads the randomness account's on-chain data **client-side** before constructing the commit instruction. If the account does not exist yet (because TX 1 hasn't finalized), the SDK throws. This is the single most important architectural constraint of Switchboard On-Demand VRF. Attempting to combine TX 1 and TX 2 will **always** fail.

### DO NOT Use "confirmed" for TX 1

TX 1 must wait for **finalization**, not just confirmation. With only "confirmed" status, the account might not be fully materialized on the RPC node being queried by `commitIx()`. Finalization guarantees readability.

---

## Appendix A: On-Chain Constants Reference

| Constant | Value (devnet) | Value (mainnet) | Source |
|----------|---------------|-----------------|--------|
| `SLOTS_PER_EPOCH` | 750 (~5 min) | 4,500 (~30 min) | `constants.rs:58-61` |
| `VRF_TIMEOUT_SLOTS` | 300 (~2 min) | 300 (~2 min) | `constants.rs:70` |
| `CARNAGE_DEADLINE_SLOTS` | 300 (~2 min) | 300 (~2 min) | `constants.rs:75` |
| `CARNAGE_LOCK_SLOTS` | 50 (~20 sec) | 50 (~20 sec) | `constants.rs:138` |
| `TRIGGER_BOUNTY_LAMPORTS` | 1,000,000 (0.001 SOL) | 1,000,000 (0.001 SOL) | `constants.rs:81` |
| `CARNAGE_SLIPPAGE_BPS_ATOMIC` | 8500 (85%) | 8500 (85%) | `constants.rs:127` |
| `CARNAGE_SLIPPAGE_BPS_FALLBACK` | 7500 (75%) | 7500 (75%) | `constants.rs:132` |
| `CARNAGE_TRIGGER_THRESHOLD` | 11 (~4.3%) | 11 (~4.3%) | `constants.rs:142` |
| `MIN_VRF_BYTES` | 8 | 8 | `consume_randomness.rs:29` |

## Appendix B: VRF Byte Allocation

The 32-byte Switchboard VRF output is consumed as follows:

| Byte | Purpose | Interpretation | Probability |
|------|---------|----------------|-------------|
| 0 | Tax regime flip | `< 192` = flip cheap side | 75% flip |
| 1 | CRIME low magnitude | `100 + (byte % 4) * 100` bps | 25% each of 100/200/300/400 |
| 2 | CRIME high magnitude | `1100 + (byte % 4) * 100` bps | 25% each of 1100/1200/1300/1400 |
| 3 | FRAUD low magnitude | `100 + (byte % 4) * 100` bps | 25% each of 100/200/300/400 |
| 4 | FRAUD high magnitude | `1100 + (byte % 4) * 100` bps | 25% each of 1100/1200/1300/1400 |
| 5 | Carnage trigger | `< 11` = trigger | ~4.3% trigger |
| 6 | Carnage action | `< 5` = Sell, else Burn | 2% Sell, 98% Burn |
| 7 | Carnage buy target | `< 128` = CRIME, else FRAUD | 50/50 |
| 8-31 | Reserved | Unused | -- |

## Appendix C: Real Operational Data

From the overnight E2E run on 2026-02-20 (10 epochs):

| Metric | Value |
|--------|-------|
| Epochs completed | 10 / 10 |
| VRF recoveries observed | 1 (epoch index 3, duration 357s vs normal 45s) |
| Carnage triggers | 0 (expected ~0.4 in 10 epochs, P(zero) = 64.4%) |
| Total errors | 0 |
| Avg normal VRF duration | ~45s |
| VRF recovery duration | ~357s (6 minutes) |
| SOL consumed | 0.15 SOL over 10 epochs |
| CheapSide distribution | CRIME: 4, FRAUD: 6 |
| Flip rate | Observed ~60% (expected 75%) |

The epoch index 3 VRF duration of 357,512ms (vs ~45,000ms normal) indicates a real VRF timeout recovery occurred automatically. The crank bot detected the oracle failure, waited for the 300-slot timeout, created fresh randomness, and completed the transition without human intervention.
