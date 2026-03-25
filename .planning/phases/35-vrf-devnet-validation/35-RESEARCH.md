# Phase 35: VRF Devnet Validation - Research

**Researched:** 2026-02-11
**Domain:** Switchboard On-Demand VRF integration on Solana devnet
**Confidence:** HIGH (verified from codebase + installed SDK + official docs)

## Summary

Phase 35 validates the deployed Epoch Program's Switchboard VRF integration against real oracle infrastructure on Solana devnet. No new program code is written -- this is a validation phase that proves the existing programs work with real oracles.

The codebase already contains a minimal devnet VRF test script (`tests/devnet-vrf.ts`) from Phase 23 that demonstrates the 3-TX flow. Phase 35 expands this into a comprehensive validation suite covering 5 consecutive epoch transitions, security edge cases (anti-reroll, stale randomness, double-commit), timeout recovery, and a post-VRF swap verification.

**Primary recommendation:** Build a structured TypeScript validation script at `scripts/vrf/devnet-vrf-validation.ts` that extends the existing `tests/devnet-vrf.ts` pattern with full security testing, multi-epoch iteration, and structured report generation. The SLOTS_PER_EPOCH constant must be changed from 4,500 to 750 and the epoch program redeployed before testing begins.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@switchboard-xyz/on-demand` | ^3.7.3 (3.8.2 installed, 3.9.0 latest) | Create randomness accounts, build commit/reveal instructions | Only viable Switchboard integration -- all alternatives are deprecated |
| `switchboard-on-demand` (Rust) | =0.11.3 (pinned, still latest on crates.io) | On-chain `RandomnessAccountData::parse()` and `get_value()` | Matches deployed program binary |
| `@coral-xyz/anchor` | ^0.32.1 | Anchor client framework for program interaction | Project standard |
| `@solana/web3.js` | ^1.95.5 | Solana connection, transactions, keypairs | Project standard |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `ts-node` | ^10.9.2 | Execute TypeScript validation scripts directly | Running `npx ts-node scripts/vrf/...` |
| `@solana/spl-token` | ^0.4.9 | Token account reading (for post-VRF swap verification) | VRF-04: verifying tax rates affect swap outcomes |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Single validation script | Mocha test suite | Scripts are better for devnet validation (long waits, sequential dependencies, structured reporting). Mocha tests are designed for fast, independent assertions against local validator. |
| Manual report generation | Automated JSON output | Structured report generation during script execution is cleaner than post-hoc analysis |

**Installation:**
No new packages needed. All dependencies already in `package.json`.

## Architecture Patterns

### Recommended Script Structure

```
scripts/vrf/
├── devnet-vrf-validation.ts   # Main validation orchestrator
├── lib/
│   ├── vrf-flow.ts            # 3-TX VRF flow helper (extracted from existing pattern)
│   ├── epoch-reader.ts        # EpochState reading and tax rate extraction
│   ├── swap-verifier.ts       # Post-VRF swap tax rate verification
│   └── reporter.ts            # Validation report generator
└── README.md                  # (only if explicitly requested)
```

### Pattern 1: VRF 3-Transaction Flow (Proven Working)

**What:** The complete commit-reveal cycle for Switchboard On-Demand randomness.
**When to use:** Every epoch transition.
**Source:** `tests/devnet-vrf.ts` (existing), `Docs/VRF_Implementation_Reference.md` Section 4

```typescript
// Verified from installed SDK (3.8.2) and existing codebase
import * as sb from "@switchboard-xyz/on-demand";

// Step 1: Setup (dynamic resolution, no hardcoded addresses)
const sbProgramId = await sb.getProgramId(connection);
const sbIdl = await Program.fetchIdl(sbProgramId, provider);
const sbProgram = new Program(sbIdl, provider);
const queueAccount = await sb.getDefaultQueue(connection.rpcEndpoint);

// Step 2: Create randomness account (TX 1)
const rngKp = Keypair.generate();
const [randomness, createIx] = await sb.Randomness.create(sbProgram, rngKp, queueAccount.pubkey);
// Send + wait for FINALIZATION (not just confirmed)

// Step 3: Commit + trigger (TX 2)
const commitIx = await randomness.commitIx(queueAccount.pubkey);
// Bundle with program's triggerEpochTransition instruction
// CU budget: 400,000

// Step 4: Reveal + consume (TX 3)
await waitForSlotAdvance(connection, 3);
let revealIx;
for (let i = 0; i < 10; i++) {
    try { revealIx = await randomness.revealIx(); break; }
    catch (e) { if (i === 9) throw e; await sleep(2000); }
}
// Bundle with program's consumeRandomness instruction
// CU budget: 400,000
```

**Key API compatibility note (verified 2026-02-11):**
- `Randomness.create(program, kp, queue, payer?)` -- 4th param is optional, existing 3-param call works
- `commitIx(queue, authority?, oracle?)` -- 2nd/3rd params are optional, existing 1-param call works
- `revealIx(payer?)` -- optional param, existing parameterless call works
- `getDefaultQueue(solanaRPCUrl?)` -- takes optional URL, existing `getDefaultQueue(connection.rpcEndpoint)` works
- `SB_ON_DEMAND_IDL` is NO LONGER exported (removed in 3.x). Use `Program.fetchIdl(sbProgramId, provider)` instead (already done in existing code)

### Pattern 2: EpochState Reading for Verification

**What:** Read the EpochState account after each VRF cycle to verify tax rates.
**When to use:** After every `consume_randomness` transaction.

```typescript
// Fetch EpochState and verify tax rates
const epochState = await epochProgram.account.epochState.fetch(epochStatePda);

// Verify tax rates are in expected bands
const lowTax = epochState.lowTaxBps;
const highTax = epochState.highTaxBps;
assert(lowTax >= 100 && lowTax <= 400, `Low tax ${lowTax} out of range [100, 400]`);
assert(highTax >= 1100 && highTax <= 1400, `High tax ${highTax} out of range [1100, 1400]`);

// Verify cheap_side logic
const cheapSide = epochState.cheapSide; // 0 = CRIME, 1 = FRAUD
if (cheapSide === 0) {
    assert(epochState.crimeBuyTaxBps === lowTax);
    assert(epochState.crimeSellTaxBps === highTax);
    assert(epochState.fraudBuyTaxBps === highTax);
    assert(epochState.fraudSellTaxBps === lowTax);
} else {
    assert(epochState.fraudBuyTaxBps === lowTax);
    assert(epochState.fraudSellTaxBps === highTax);
    assert(epochState.crimeBuyTaxBps === highTax);
    assert(epochState.crimeSellTaxBps === lowTax);
}
```

### Pattern 3: Timeout Recovery Testing

**What:** Wait for VRF_TIMEOUT_SLOTS (300 slots, ~2 min on devnet) then retry with fresh randomness.
**When to use:** VRF-03 validation.

```typescript
// After successful commit, do NOT send reveal (simulate oracle failure)
// Wait for 300+ slots (~2 minutes)
await waitForSlotAdvance(connection, 301);

// Create fresh randomness account
const retryRngKp = Keypair.generate();
const [retryRandomness, retryCreateIx] = await sb.Randomness.create(sbProgram, retryRngKp, queueAccount.pubkey);
// ... send + finalize ...

// Bundle retry commit with retry_epoch_vrf
const retryCommitIx = await retryRandomness.commitIx(queueAccount.pubkey);
const retryIx = await epochProgram.methods.retryEpochVrf().accounts({...}).instruction();
// ... send ...

// Then proceed with reveal + consume using the NEW randomness account
```

### Anti-Patterns to Avoid

- **Combining TX 1 and TX 2:** The Switchboard SDK's `commitIx()` reads the randomness account client-side. If the account hasn't been finalized on-chain, `commitIx()` throws "Account not found". This is a hard SDK constraint -- NEVER attempt to combine create and commit.
- **Using "confirmed" for TX 1:** Always use "finalized" confirmation for the create transaction. "Confirmed" is not sufficient -- the account may not be readable by the RPC node.
- **Hardcoding Switchboard addresses:** Always use `getProgramId()` and `getDefaultQueue()` for dynamic resolution. Addresses differ between devnet/mainnet and change with SDK upgrades.
- **Insufficient CU budget:** Always set 400,000 CU for both commit and reveal transactions. Default 200,000 is insufficient for Switchboard operations.
- **Calling revealIx() immediately:** Wait at least 3 slots after commit. Use retry loop (10 attempts, 2-second delay) for reliability.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Switchboard program ID resolution | Hardcode devnet program ID | `sb.getProgramId(connection)` | IDs change with SDK upgrades, differ between clusters |
| Queue address resolution | Hardcode queue PDA | `sb.getDefaultQueue(rpcEndpoint)` | Same reason -- dynamic resolution is the SDK's design |
| Randomness account creation | Manual account creation | `sb.Randomness.create()` | SDK handles LUT setup, recent slot, instruction data |
| Commit instruction | Manual instruction building | `randomness.commitIx()` | SDK reads account state and constructs correct instruction |
| Reveal instruction | Manual instruction building | `randomness.revealIx()` | SDK handles oracle lookup and instruction construction |
| VRF byte parsing on-chain | Custom account parsing | `RandomnessAccountData::parse()` + `get_value()` | Crate provides type-safe parsing with error handling |

**Key insight:** The entire Switchboard integration is split: on-chain program only reads/validates account data (using the Rust crate), while the TypeScript SDK handles all oracle interaction. Never try to CPI into Switchboard from the program.

## Common Pitfalls

### Pitfall 1: SLOTS_PER_EPOCH Not Changed Before Testing

**What goes wrong:** The deployed epoch program has `SLOTS_PER_EPOCH = 4_500` (~30 minutes). Testing 5 consecutive epochs would take ~2.5 hours of waiting per run. With 750 slots (~5 min), it's ~25 min.
**Why it happens:** SLOTS_PER_EPOCH is a compile-time constant (hardcoded in `programs/epoch-program/src/constants.rs`). The Phase 34 deployment used the production value.
**How to avoid:** Before running ANY VRF validation:
1. Change `SLOTS_PER_EPOCH` from `4_500` to `750` in `programs/epoch-program/src/constants.rs`
2. Rebuild: `anchor build -p epoch_program`
3. Redeploy: `solana program deploy target/deploy/epoch_program.so --program-id AH7yaWFUrWmXGDKEwr8w2EMEiH6PxaxE2vT9orjRzvod`
4. Re-initialize EpochState (the existing PDA will need to be closed and recreated, OR the new binary must be compatible with the existing account data)
**Warning signs:** Epoch boundary never reached during testing. Script waits indefinitely for slot advancement.

### Pitfall 2: EpochState Already Initialized with Old Genesis Slot

**What goes wrong:** The EpochState PDA was initialized during Phase 34 with a specific `genesis_slot`. After redeploying the epoch program with new SLOTS_PER_EPOCH, the existing EpochState may have a `genesis_slot` thousands of slots in the past, meaning the "current epoch" calculation could yield a very large number (thousands of epochs have passed since initialization).
**Why it happens:** `current_epoch = (current_slot - genesis_slot) / SLOTS_PER_EPOCH`. If genesis_slot is old and SLOTS_PER_EPOCH is now smaller, many epochs have "passed".
**How to avoid:** Either:
- Close and re-initialize the EpochState PDA with a fresh genesis_slot (preferred -- clean state)
- Accept the large epoch number jump (the program handles this -- `trigger_epoch_transition` advances to the correct epoch, not just +1)
**Warning signs:** `currentEpoch` jumps to hundreds or thousands after redeployment.

### Pitfall 3: consume_randomness Requires Staking CPI Accounts

**What goes wrong:** The `consume_randomness` instruction CPIs to the Staking Program's `update_cumulative`. If the Staking Program accounts (staking_authority PDA, stake_pool PDA) are not correctly passed, the transaction fails.
**Why it happens:** The existing `tests/devnet-vrf.ts` was written during Phase 23 before the Staking CPI was integrated into consume_randomness. The script's `consumeIx` account list is incomplete.
**How to avoid:** The consume_randomness accounts struct requires:
- `caller` (Signer)
- `epoch_state` (PDA)
- `randomness_account` (Switchboard account)
- `staking_authority` (PDA derived from `["staking_authority"]` on epoch_program)
- `stake_pool` (Staking program's pool PDA)
- `staking_program` (Staking program ID)
- `carnage_state` (Optional, CarnageFund PDA)
All these PDAs are documented in `scripts/deploy/pda-manifest.json`.
**Warning signs:** "AccountNotFound" or "ConstraintSeeds" errors on consume_randomness.

### Pitfall 4: Oracle Not Responding on Devnet

**What goes wrong:** The `revealIx()` call fails after all 10 retries. The oracle hasn't processed the commitment.
**Why it happens:** Devnet Switchboard oracles can be slower or temporarily down. Unlike mainnet, devnet oracle infrastructure has no SLA.
**How to avoid:**
- Increase retry count to 20 and delay to 3 seconds (60 seconds total timeout)
- Log slot advancement during waiting to confirm chain is progressing
- If oracle is completely down, the VRF timeout recovery path (300 slots) kicks in -- this IS one of the test scenarios
**Warning signs:** Consistent "Reveal not ready" for >30 seconds. Check Switchboard's oracle status or Discord.

### Pitfall 5: revealIx() Built-in Delay

**What goes wrong:** Unexpected 3-second delay in every `revealIx()` call.
**Why it happens:** The SDK's `revealIx()` implementation includes `await new Promise(f => setTimeout(f, 3000))` as a hardcoded delay before fetching data. This is intentional -- the oracle needs time to process.
**How to avoid:** Account for this in timing expectations. Each reveal attempt takes at minimum 3 seconds plus RPC latency.
**Warning signs:** Each retry taking exactly 3+ seconds even when oracle is ready.

### Pitfall 6: Helius Rate Limiting

**What goes wrong:** Transactions fail with 429 (rate limited) errors on Helius free tier.
**Why it happens:** The validation script makes many RPC calls in succession (getSlot polling, account fetches, transaction sends). Helius free tier has request limits.
**How to avoid:** Add small delays between RPC calls (100-200ms). Use `confirmed` commitment for non-critical reads (slot polling). Reserve `finalized` for TX 1 (create randomness) only.
**Warning signs:** "429 Too Many Requests" errors. Sporadic "getSlot" failures.

## Code Examples

### Complete Epoch Advancement with Verification (Verified Pattern)

```typescript
// Source: Existing tests/devnet-vrf.ts + Epoch_State_Machine_Spec.md Section 7

import * as sb from "@switchboard-xyz/on-demand";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import {
  Keypair, PublicKey, Transaction,
  ComputeBudgetProgram, SystemProgram, Connection,
} from "@solana/web3.js";

interface EpochTransitionResult {
  epoch: number;
  cheapSide: string;
  lowTaxBps: number;
  highTaxBps: number;
  crimeBuyTax: number;
  crimeSellTax: number;
  fraudBuyTax: number;
  fraudSellTax: number;
  flipped: boolean;
  vrfBytes: number[];  // first 6 bytes
  createSig: string;
  commitSig: string;
  consumeSig: string;
  durationMs: number;
}

async function advanceEpochWithVRF(
  provider: AnchorProvider,
  epochProgram: Program,
  epochStatePda: PublicKey,
  treasuryPda: PublicKey,
  stakingAuthorityPda: PublicKey,
  stakePoolPda: PublicKey,
  stakingProgramId: PublicKey,
  carnageFundPda: PublicKey,
): Promise<EpochTransitionResult> {
  const startMs = Date.now();
  const connection = provider.connection;
  const wallet = provider.wallet as Wallet;

  // Read state before transition
  const stateBefore = await epochProgram.account.epochState.fetch(epochStatePda);
  const previousCheapSide = stateBefore.cheapSide;

  // --- Switchboard Setup ---
  const sbProgramId = await sb.getProgramId(connection);
  const sbIdl = await Program.fetchIdl(sbProgramId, provider);
  const sbProgram = new Program(sbIdl!, provider);
  const queueAccount = await sb.getDefaultQueue(connection.rpcEndpoint);

  // --- TX 1: Create randomness account ---
  const rngKp = Keypair.generate();
  const [randomness, createIx] = await sb.Randomness.create(sbProgram, rngKp, queueAccount.pubkey);
  const createTx = new Transaction().add(createIx);
  createTx.feePayer = wallet.publicKey;
  createTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  createTx.sign(wallet.payer, rngKp);
  const createSig = await connection.sendRawTransaction(createTx.serialize());
  await connection.confirmTransaction(createSig, "finalized");

  // --- TX 2: Commit + Trigger ---
  const commitIx = await randomness.commitIx(queueAccount.pubkey);
  const triggerIx = await epochProgram.methods
    .triggerEpochTransition()
    .accounts({
      payer: wallet.publicKey,
      epochState: epochStatePda,
      treasury: treasuryPda,
      randomnessAccount: rngKp.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const commitTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    commitIx,
    triggerIx
  );
  const commitSig = await provider.sendAndConfirm(commitTx, [wallet.payer]);

  // --- Wait for oracle ---
  await waitForSlotAdvance(connection, 3);

  // --- TX 3: Reveal + Consume ---
  let revealIx;
  for (let i = 0; i < 20; i++) {
    try {
      revealIx = await randomness.revealIx();
      break;
    } catch (e) {
      if (i === 19) throw e;
      await sleep(3000);
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
    revealIx!,
    consumeIx
  );
  const consumeSig = await provider.sendAndConfirm(consumeTx, [wallet.payer]);

  // --- Verify final state ---
  const stateAfter = await epochProgram.account.epochState.fetch(epochStatePda);
  const flipped = stateAfter.cheapSide !== previousCheapSide;

  return {
    epoch: stateAfter.currentEpoch,
    cheapSide: stateAfter.cheapSide === 0 ? "CRIME" : "FRAUD",
    lowTaxBps: stateAfter.lowTaxBps,
    highTaxBps: stateAfter.highTaxBps,
    crimeBuyTax: stateAfter.crimeBuyTaxBps,
    crimeSellTax: stateAfter.crimeSellTaxBps,
    fraudBuyTax: stateAfter.fraudBuyTaxBps,
    fraudSellTax: stateAfter.fraudSellTaxBps,
    flipped,
    vrfBytes: [], // Would need to read from randomness account before consume
    createSig,
    commitSig,
    consumeSig,
    durationMs: Date.now() - startMs,
  };
}
```

### Security Test: Anti-Reroll Verification

```typescript
// Source: VRF_Implementation_Reference.md Section 5.1

async function testAntiReroll(
  provider: AnchorProvider,
  epochProgram: Program,
  epochStatePda: PublicKey,
  boundRngKp: Keypair, // The committed randomness account
) {
  const wallet = provider.wallet as Wallet;

  // Create a DIFFERENT randomness account
  const wrongRngKp = Keypair.generate();
  // ... create + finalize wrongRngKp ...

  // Attempt consume with WRONG randomness account
  try {
    const consumeIx = await epochProgram.methods
      .consumeRandomness()
      .accounts({
        caller: wallet.publicKey,
        epochState: epochStatePda,
        randomnessAccount: wrongRngKp.publicKey, // WRONG account
        // ... other accounts
      })
      .instruction();
    // ... send ...
    throw new Error("SECURITY FAILURE: Anti-reroll check should have rejected");
  } catch (e) {
    // Expected: RandomnessAccountMismatch (error code 6004 or similar)
    assert(e.message.includes("RandomnessAccountMismatch") || e.logs?.some(l => l.includes("6004")));
    console.log("Anti-reroll protection verified");
  }
}
```

### Post-VRF Swap Verification (VRF-04)

```typescript
// Source: Epoch_State_Machine_Spec.md Section 10

async function verifyTaxRatesAppliedToSwap(
  provider: AnchorProvider,
  taxProgram: Program,
  epochStatePda: PublicKey,
  poolPda: PublicKey,
) {
  // Read current epoch state
  const epochState = await epochProgram.account.epochState.fetch(epochStatePda);

  // Execute a small test swap via Tax Program
  // The swap should apply the tax rate from EpochState
  const expectedTaxBps = epochState.crimeBuyTaxBps; // For a CRIME buy

  // Execute swap...
  // Verify the output amount reflects the expected tax rate
  // (This is a sanity check -- detailed swap testing is Phase 36)
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `SB_ON_DEMAND_IDL` direct import | `Program.fetchIdl(sbProgramId, provider)` | SDK 3.x | Must fetch IDL dynamically from chain. Already handled in existing code. |
| `solana-randomness-service-lite` CPI callback | `switchboard-on-demand` client-side commit-reveal | 2025 | Legacy infrastructure shut down. Only On-Demand works. |
| VRF v2 (276 instructions, 48 transactions) | On-Demand VRF (3 transactions) | 2025 | Dramatically simpler integration. |
| `SB_ON_DEMAND_PID` constant | `ON_DEMAND_DEVNET_PID` / `ON_DEMAND_MAINNET_PID` | SDK 3.x | Named constants changed, but `getProgramId()` is the recommended approach. |
| Fixed Switchboard queue addresses | `getDefaultQueue()` dynamic resolution | SDK 3.x | Queue addresses are resolved dynamically. |

**Deprecated/outdated:**
- `@switchboard-xyz/solana-randomness-service`: Abandoned CPI callback pattern. Do NOT use.
- `switchboard-v2`: Legacy 276-instruction VRF. Do NOT use.
- `SB_ON_DEMAND_IDL` export: Removed from SDK 3.x. Use `Program.fetchIdl()` instead.
- `SB_ON_DEMAND_PID` export: Removed from SDK 3.x. Use `getProgramId()` instead.

## Critical Pre-Requisite: SLOTS_PER_EPOCH Redeployment

**This is the single most important prerequisite for Phase 35.**

The currently deployed epoch program uses `SLOTS_PER_EPOCH = 4_500` (~30 min). The CONTEXT.md decision requires 750 slots (~5 min) for devnet testing.

**Required steps before ANY VRF validation:**

1. **Modify constant:** Change `SLOTS_PER_EPOCH` from `4_500` to `750` in `programs/epoch-program/src/constants.rs`
2. **Rebuild:** `anchor build -p epoch_program`
3. **Redeploy:** `solana program deploy target/deploy/epoch_program.so --program-id AH7yaWFUrWmXGDKEwr8w2EMEiH6PxaxE2vT9orjRzvod --upgrade-authority keypairs/devnet-wallet.json`
4. **Handle EpochState PDA:** The existing EpochState has a genesis_slot from Phase 34. With the new SLOTS_PER_EPOCH=750, `current_epoch = (current_slot - old_genesis_slot) / 750` will be a very large number. Options:
   - **Option A (Recommended):** Close the EpochState account and re-initialize with fresh genesis_slot. This gives a clean starting state.
   - **Option B:** Accept the epoch number jump. The program handles skipping correctly (trigger advances to computed epoch, not +1).
5. **Re-initialize Carnage Fund** if Option A is chosen (CarnageFund references EpochState)

**Impact on VRF_TIMEOUT_SLOTS:** The `VRF_TIMEOUT_SLOTS = 300` constant is NOT affected by this change. 300 slots at ~400ms/slot is still ~2 minutes. This is correct for devnet testing.

## Deployed Infrastructure Reference

All addresses from `scripts/deploy/pda-manifest.json`:

| Component | Address | Notes |
|-----------|---------|-------|
| Epoch Program | `AH7yaWFUrWmXGDKEwr8w2EMEiH6PxaxE2vT9orjRzvod` | Must be redeployed with SLOTS_PER_EPOCH=750 |
| EpochState PDA | `DVV9ebobxXctrsPZpuSDTj4g85Cg2VmroLLq3chLuBDU` | May need re-init after redeploy |
| CarnageFund PDA | `2WUfRt7x2QKbFBuQoiQQ6Y5dmVJWSw93bobyaEhR1eKK` | May need re-init |
| CarnageSolVault | `9q6Xd7VcTHHtN46qsE4hNZstPp1Bb4TDTjjgUgfPhFa1` | |
| Staking Program | `Bb8istpSMj2TZB9h8Fh6H3fWeqAjSjmPBec7i4gWiYRi` | |
| StakePool PDA | `AL42AsVfBmCHsUMDynaR6h2yLktq1jB5FS65mz4H8GCf` | Required by consume_randomness |
| StakingAuthority | `8DuvdDRQA39vdTTSC6X25d29wX4tuCnihm7D62hr3p8p` | PDA on epoch_program, used for CPI |
| Tax Program | `FV3kWDtSRDHTdd9fK9L1fkqdWis7Sts5x7nNS4uoSiiu` | For VRF-04 swap verification |
| AMM Program | `zFW9moTqWoBhCJ2eVREhrkasaNwvhprCoKCmJZfrUxa` | For swap execution |
| CRIME/SOL Pool | `2QLDtSMSoEpjZxprGYWZkG35Uqrs4vUucMX2SZLXYUkD` | Test swap target |
| FRAUD/SOL Pool | `45C8X2umXxRpRZfcecmSbAS4mBPnv9TYH8CkmVFVyd8F` | Test swap target |
| Devnet Wallet | `8kPzhQoUPx7LYM18f9TzskW4ZgvGyq4jMPYZikqmHMH4` | `keypairs/devnet-wallet.json` |
| Switchboard Devnet PID | `Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2` | Verified from SDK |
| Switchboard Devnet Queue | `EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7` | Verified from SDK |
| Helius RPC | `https://devnet.helius-rpc.com/?api-key=<KEY>` | From `.env` |

## consume_randomness Account Requirements

The `ConsumeRandomness` instruction requires these accounts (verified from deployed code):

```typescript
const consumeIx = await epochProgram.methods
  .consumeRandomness()
  .accounts({
    caller: wallet.publicKey,                   // Signer
    epochState: epochStatePda,                  // Mut PDA [EPOCH_STATE_SEED]
    randomnessAccount: rngKp.publicKey,         // CHECK: Switchboard account
    stakingAuthority: stakingAuthorityPda,       // PDA [STAKING_AUTHORITY_SEED] on epoch_program
    stakePool: stakePoolPda,                    // Mut, Staking program's pool
    stakingProgram: stakingProgramId,            // CHECK: Staking program ID
    carnageState: carnageFundPda,               // Optional Account<CarnageFundState>
  })
  .instruction();
```

**Note:** The `carnageState` field is `Option<Account<CarnageFundState>>` so it can be null. However, for full validation including Carnage trigger detection, it should be provided.

## Validation Report Format

The validation script should generate a structured report at `scripts/vrf/vrf-validation-report.md`:

```markdown
# VRF Devnet Validation Report
Generated: <timestamp>
Cluster: <RPC URL>
Wallet: <wallet address>
SLOTS_PER_EPOCH: 750

## Summary
- Epoch transitions: 5/5 passed
- Security tests: X/Y passed
- Timeout recovery: passed/failed
- Post-VRF swap: passed/failed

## Epoch Transitions

| # | Epoch | Cheap Side | Flipped | Low Tax | High Tax | VRF Bytes[0:6] | Create TX | Commit TX | Consume TX | Duration |
|---|-------|------------|---------|---------|----------|----------------|-----------|-----------|------------|----------|
| 1 | N | CRIME | No | 300 | 1400 | [128, 2, 3, 200, 50, 100] | 5abc... | 3def... | 7ghi... | 42s |
...

## Security Tests
- Anti-reroll: PASSED (RandomnessAccountMismatch correctly thrown)
- Stale randomness: PASSED (RandomnessExpired correctly thrown)
- Double commit: PASSED (VrfAlreadyPending correctly thrown)

## Timeout Recovery
- Initial commit at slot: X
- Waited 301 slots (~2 min)
- Retry commit at slot: Y
- Reveal + consume: PASSED

## Tax Rate Application (VRF-04)
- Pre-swap epoch state: low=N, high=M
- Swap executed: CRIME buy, expected tax=N bps
- Post-swap verification: PASSED
```

## Open Questions

1. **EpochState re-initialization strategy**
   - What we know: Closing an Anchor PDA account requires a specific `close` instruction or `realloc` to zero. The epoch program does not currently have a `close_epoch_state` instruction.
   - What's unclear: Whether we need to add a close instruction, or whether we can use a Solana CLI tool to close the account directly (since we have the upgrade authority).
   - Recommendation: Use `solana account close <address> --authority keypairs/devnet-wallet.json` to close the PDA, then call `initialize_epoch_state` again. Verify this approach works on devnet before relying on it. Alternatively, skip closing and accept the epoch number jump (Option B from Pitfall 2).

2. **Carnage trigger probability during 5 epochs**
   - What we know: Carnage triggers when VRF byte 3 < 11 (~4.3% probability per epoch). Across 5 epochs, the probability of at least one trigger is ~20%.
   - What's unclear: Whether we will observe a Carnage trigger during the validation run.
   - Recommendation: Per CONTEXT.md, Carnage triggering is "nice to have". If VRF byte 3 < 11 in any epoch, validate the Carnage pending state is correctly set. Otherwise defer to Phase 36.

3. **SOL balance for extended testing**
   - What we know: Each VRF cycle costs ~0.003-0.005 SOL (create account + commit TX + consume TX). 5 cycles plus security tests and timeout recovery could cost 0.05-0.1 SOL.
   - What's unclear: Current wallet SOL balance on devnet.
   - Recommendation: Check balance before starting. Airdrop if needed (`solana airdrop 2 --url devnet`).

4. **Staking Program CPI compatibility after Epoch Program redeploy**
   - What we know: The `consume_randomness` instruction CPIs to Staking's `update_cumulative`. The StakePool PDA was initialized with a specific `last_update_epoch`.
   - What's unclear: If we re-initialize EpochState with epoch 0, but StakePool's `last_update_epoch` is > 0, the `update_cumulative` CPI may reject the call (duplicate epoch).
   - Recommendation: Also re-initialize the StakePool if re-initializing EpochState. This ensures both accounts start from epoch 0.

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `programs/epoch-program/src/` -- all instruction handlers, constants, state
- Codebase inspection: `tests/devnet-vrf.ts` -- existing devnet VRF test script
- Codebase inspection: `package.json` -- dependency versions
- Codebase inspection: `scripts/deploy/pda-manifest.json` -- all deployed addresses
- SDK verification: `npm view @switchboard-xyz/on-demand` -- version 3.9.0 latest, 3.8.2 installed
- SDK verification: Node.js introspection of installed `@switchboard-xyz/on-demand` 3.8.2 -- all API methods confirmed compatible
- Rust crate: `cargo search switchboard-on-demand` -- 0.11.3 still latest, matches pinned version
- Project docs: `Docs/VRF_Implementation_Reference.md`, `Docs/VRF_Migration_Lessons.md`, `Docs/Epoch_State_Machine_Spec.md`

### Secondary (MEDIUM confidence)
- Switchboard official docs: https://docs.switchboard.xyz/product-documentation/randomness/tutorials/solana-svm -- API tutorial
- Switchboard examples: https://github.com/switchboard-xyz/sb-on-demand-examples -- reference implementations

### Tertiary (LOW confidence)
- Switchboard devnet oracle reliability: No SLA documentation found. Based on project experience (v3-archive working on devnet) and Switchboard Discord reports.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- verified from installed packages, npm registry, and crates.io
- Architecture: HIGH -- based on working existing code (tests/devnet-vrf.ts) and thorough codebase inspection
- Pitfalls: HIGH -- pitfalls 1-4 identified from actual code analysis; pitfalls 5-6 from SDK source inspection
- Code examples: HIGH -- adapted from verified existing code with API compatibility confirmed

**Research date:** 2026-02-11
**Valid until:** 2026-03-11 (Switchboard SDK is actively developed, check for breaking changes if delayed)
