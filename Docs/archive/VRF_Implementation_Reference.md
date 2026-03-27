# Dr. Fraudsworth's Finance Factory
## VRF Implementation Reference

---

## 1. Purpose and Scope

This document captures the **working Switchboard On-Demand VRF integration** from the `v3-archive` branch. The v3 implementation was:
- Successfully migrated from the abandoned `solana-randomness-service-lite` to `switchboard-on-demand` v0.11.3
- Tested and verified on Solana devnet (epoch advanced from 1 to 2 with VRF-derived tax rates)
- Secured with comprehensive attack tests (reroll, wrong account injection, timeout recovery)

**This is a reference document, not a specification.** The authoritative protocol specification lives in `Docs/Epoch_State_Machine_Spec.md`. This document records *what was built and proven working* so the team can reimplement without reverse-engineering archived code.

> **NOTE**: Some implementation details in this reference differ from the current spec. Each discrepancy is flagged inline and summarized in Section 8. See `Docs/VRF_Migration_Lessons.md` for the full discrepancy analysis and migration pitfalls.

---

## 2. Architecture Overview

### 2.1 Switchboard On-Demand Model

Switchboard On-Demand uses a **client-side commit-reveal** pattern, NOT the legacy CPI callback model. This has two major implications:

1. **Program side is simple**: The on-chain program only validates and reads randomness data from a passed account. No CPI to Switchboard is needed.
2. **Client side is complex**: The TypeScript client orchestrates all SDK calls, manages retries, and bundles instructions across multiple transactions.

### 2.2 Three-Transaction Lifecycle

The VRF flow requires **three separate transactions**. This is not a design choice -- it is a constraint imposed by the Switchboard SDK.

```
 Client                    Solana                  Switchboard Oracle
   |                         |                           |
   |  TX 1: Create Account   |                           |
   |------------------------>|                           |
   |   (wait for finalize)   |                           |
   |<------------------------|                           |
   |                         |                           |
   |  TX 2: Commit + Lock    |                           |
   |------------------------>|                           |
   |   SDK commitIx          |------- seed_slot -------->|
   |   Program commitIx      |                           |
   |<------------------------|                           |
   |                         |                           |
   |   (wait ~3 slots)       |                           |
   |                         |<--- oracle reveals -------|
   |                         |                           |
   |  TX 3: Reveal + Consume |                           |
   |------------------------>|                           |
   |   SDK revealIx          |                           |
   |   Program consumeIx     |                           |
   |<------------------------|                           |
   |                         |                           |
   |  Epoch advanced, new    |                           |
   |  tax rates applied      |                           |
```

### 2.3 Why Three Transactions, Not Two

The Switchboard SDK's `commitIx()` method reads the randomness account's on-chain data **client-side** before constructing the commit instruction. If the account does not exist yet, the SDK throws an error. Therefore:

1. **Transaction 1** must create the randomness account and **finalize** (not just confirm)
2. **Transaction 2** can then call `commitIx()` because the account data is now readable
3. **Transaction 3** must wait for slot advancement so the oracle can reveal the randomness

This is the single most important architectural constraint. Attempting to combine Transactions 1 and 2 will always fail.

---

## 3. On-Chain Program (Rust)

### 3.1 EpochState Account Structure

The EpochState account stores both epoch management fields and VRF tracking fields:

```rust
// Source: v3-archive state/epoch_state.rs
#[account]
pub struct EpochState {
    pub epoch_number: u64,
    pub epoch_start: i64,
    pub duration_seconds: i64,
    pub bump: u8,
    // === VRF tracking fields ===
    pub randomness_commit_slot: u64,
    pub randomness_pending: bool,
    pub randomness_commit_time: i64,
    pub pending_randomness_account: Pubkey,
}

impl EpochState {
    // 8 (disc) + 8 + 8 + 8 + 1 + 8 + 1 + 8 + 32 = 82 bytes
    pub const LEN: usize = 8 + 8 + 8 + 8 + 1 + 8 + 1 + 8 + 32;
    pub const DEFAULT_DURATION: i64 = 3600;
}
```

**Byte layout:**

| Field | Type | Offset | Size |
|-------|------|--------|------|
| (discriminator) | `[u8; 8]` | 0 | 8 |
| `epoch_number` | `u64` | 8 | 8 |
| `epoch_start` | `i64` | 16 | 8 |
| `duration_seconds` | `i64` | 24 | 8 |
| `bump` | `u8` | 32 | 1 |
| `randomness_commit_slot` | `u64` | 33 | 8 |
| `randomness_pending` | `bool` | 41 | 1 |
| `randomness_commit_time` | `i64` | 42 | 8 |
| `pending_randomness_account` | `Pubkey` | 50 | 32 |
| **Total** | | | **82** |

> **SPEC DISCREPANCY**: v3 used `DEFAULT_DURATION = 3600` seconds (1 hour, timestamp-based). The current spec uses slot-based timing with `SLOTS_PER_EPOCH = 4_500` (~30 minutes). See VRF_Migration_Lessons.md for analysis.

### 3.2 commit_epoch_randomness Instruction

This instruction locks the epoch into a "randomness pending" state. The program validates the randomness account but does NOT CPI into Switchboard -- it simply reads the account data.

```rust
// Source: v3-archive commit_epoch_randomness.rs
pub fn commit_epoch_randomness(ctx: Context<CommitEpochRandomness>) -> Result<()> {
    let clock = Clock::get()?;
    let epoch = &mut ctx.accounts.epoch_state;

    // Guard: no double-commit
    if epoch.randomness_pending {
        // Allow re-commit only after timeout
        if clock.unix_timestamp - epoch.randomness_commit_time > RANDOMNESS_TIMEOUT {
            msg!("Previous randomness timed out, allowing new commit");
        } else {
            return Err(CustomError::RandomnessAlreadyPending.into());
        }
    }

    // Parse the Switchboard randomness account (no CPI needed)
    let randomness_data = {
        let data = ctx.accounts.randomness_account.try_borrow_data()?;
        RandomnessAccountData::parse(data)
            .map_err(|_| CustomError::RandomnessParseError)?
    };

    // Validate freshness: seed_slot must be current or previous slot
    let slot_diff = clock.slot.saturating_sub(randomness_data.seed_slot);
    require!(slot_diff <= 1, CustomError::RandomnessExpired);

    // Validate NOT yet revealed (must be in commit phase)
    if randomness_data.get_value(clock.slot).is_ok() {
        return Err(CustomError::RandomnessAlreadyRevealed.into());
    }

    // Lock the epoch: store the committed account for anti-reroll verification
    epoch.pending_randomness_account = ctx.accounts.randomness_account.key();
    epoch.randomness_pending = true;
    epoch.randomness_commit_slot = clock.slot;
    epoch.randomness_commit_time = clock.unix_timestamp;

    Ok(())
}
```

**Key validations performed:**
1. **No double-commit**: Rejects if `randomness_pending = true` (unless timed out)
2. **Freshness check**: `seed_slot` must be within 1 slot of current (prevents stale randomness)
3. **Not-yet-revealed check**: Ensures the randomness hasn't already been revealed (prevents reuse)
4. **Account binding**: Stores `pending_randomness_account` pubkey for anti-reroll verification at consume time

### 3.3 consume_randomness Instruction

This instruction reads the revealed randomness, derives tax rates, applies them to pools, and advances the epoch.

```rust
// Source: v3-archive consume_randomness.rs
pub fn consume_randomness(ctx: Context<ConsumeRandomness>) -> Result<()> {
    let clock = Clock::get()?;
    let epoch = &mut ctx.accounts.epoch_state;

    // Guard: must have a pending commit
    require!(epoch.randomness_pending, CustomError::NoRandomnessPending);

    // Anti-reroll: verify SAME randomness account that was committed
    require!(
        ctx.accounts.randomness_account.key() == epoch.pending_randomness_account,
        CustomError::RandomnessAccountMismatch
    );

    // Read revealed randomness (fails if oracle hasn't revealed yet)
    let random_bytes = {
        let data = ctx.accounts.randomness_account.try_borrow_data()?;
        let randomness_data = RandomnessAccountData::parse(data)
            .map_err(|_| CustomError::RandomnessParseError)?;
        randomness_data
            .get_value(clock.slot)
            .map_err(|_| CustomError::RandomnessNotRevealed)?
    };

    // Derive 4 tax rates from 4 random bytes
    let rates = derive_tax_rates(&random_bytes)?;

    // Apply rates to pools via remaining_accounts
    for (i, account_info) in ctx.remaining_accounts.iter().enumerate() {
        if !account_info.is_writable {
            return Err(CustomError::PoolNotWritable.into());
        }
        let mut data = account_info.try_borrow_mut_data()?;
        let mut pool = Pool::try_deserialize(&mut &data[..])
            .map_err(|_| CustomError::InvalidPoolAccount)?;

        let buy_idx = i * 2;
        let sell_idx = buy_idx + 1;
        pool.buy_tax_bps = rates[buy_idx % 4];
        pool.sell_tax_bps = rates[sell_idx % 4];

        pool.try_serialize(&mut &mut data[..])
            .map_err(|_| CustomError::InvalidPoolAccount)?;
    }

    // Reset VRF state and advance epoch
    epoch.randomness_pending = false;
    epoch.epoch_number += 1;
    epoch.epoch_start = clock.unix_timestamp;

    Ok(())
}
```

**Key validations performed:**
1. **Pending check**: Rejects if no randomness is pending (`randomness_pending = false`)
2. **Anti-reroll**: The randomness account key MUST match what was stored at commit time
3. **Reveal check**: `get_value(clock.slot)` fails if oracle hasn't revealed yet
4. **Pool writability**: Each remaining account must be writable
5. **Pool deserialization**: Each remaining account must be a valid Pool

### 3.4 Tax Rate Derivation

The v3 implementation uses a bias-free linear mapping from random bytes to tax rates in basis points.

```rust
// Source: v3-archive state/epoch_state.rs
pub fn derive_tax_rate(random_byte: u8) -> u16 {
    const RANGE: u16 = MAX_TAX_BPS - MIN_TAX_BPS; // 1400 (75 to 1475)
    let scaled = (random_byte as u32 * RANGE as u32) / 255;
    MIN_TAX_BPS + scaled as u16
}

pub fn derive_tax_rates(random_bytes: &[u8]) -> Result<[u16; 4]> {
    if random_bytes.len() < 4 {
        return Err(CustomError::InsufficientRandomness.into());
    }
    Ok([
        derive_tax_rate(random_bytes[0]), // Pool A buy tax
        derive_tax_rate(random_bytes[1]), // Pool A sell tax
        derive_tax_rate(random_bytes[2]), // Pool B buy tax
        derive_tax_rate(random_bytes[3]), // Pool B sell tax
    ])
}
```

**How it works:**
- Input: A single `u8` byte (0-255) from Switchboard randomness
- Output: A tax rate in BPS within the configured range
- Formula: `MIN_TAX_BPS + (byte * RANGE / 255)` -- integer arithmetic, no floating point
- Bias: Minimal. The mapping is linear with integer truncation. Maximum error is 1 BPS.

**Example mappings (v3 range: 75-1475 BPS):**

| Random Byte | Calculation | Tax Rate (BPS) | Percentage |
|-------------|-------------|----------------|------------|
| 0 | 75 + (0 * 1400 / 255) = 75 | 75 | 0.75% |
| 128 | 75 + (128 * 1400 / 255) = 778 | 778 | 7.78% |
| 255 | 75 + (255 * 1400 / 255) = 1475 | 1475 | 14.75% |

> **SPEC DISCREPANCY**: v3 used continuous linear mapping with `MIN_TAX_BPS=75`, `MAX_TAX_BPS=1475`. The current spec uses discrete tax bands: Low (1-4%), High (11-14%) with 4 specific values per band. These are fundamentally different tax models. See VRF_Migration_Lessons.md for analysis.

> **SPEC DISCREPANCY (Phase 37 update)**: v3 used 4 random bytes (one per tax rate). The current spec uses 8 bytes: byte 0 for flip decision, bytes 1-4 for independent CRIME/FRAUD magnitude rolls, bytes 5-7 for Carnage trigger/action/target. MIN_VRF_BYTES = 8. Each token (CRIME, FRAUD) now gets its own independent low and high magnitude from separate VRF bytes. See VRF_Migration_Lessons.md for analysis.

### 3.5 Timeout Recovery

If the oracle fails to reveal randomness (network issue, oracle rotation, etc.), the epoch would be permanently stuck in `randomness_pending = true`. The timeout mechanism prevents this.

```rust
// Source: v3-archive commit_epoch_randomness.rs (timeout check)
pub const RANDOMNESS_TIMEOUT: i64 = 3600; // 1 hour

// In commit_epoch_randomness, before rejecting double-commit:
if epoch.randomness_pending {
    if clock.unix_timestamp - epoch.randomness_commit_time > RANDOMNESS_TIMEOUT {
        msg!("Previous randomness timed out, allowing new commit");
        // Falls through to allow new commit
    } else {
        return Err(CustomError::RandomnessAlreadyPending.into());
    }
}
```

**How it works:**
1. When `commit_epoch_randomness` is called and `randomness_pending = true`, the program checks the elapsed time
2. If more than `RANDOMNESS_TIMEOUT` seconds (3600 = 1 hour) have passed since the original commit, the old request is considered abandoned
3. A new commit is allowed, overwriting the pending state
4. The old randomness account is effectively discarded

**Tradeoff:** 1 hour of stalled epochs is acceptable vs. a permanently stuck protocol. The timeout is generous to avoid false timeouts from temporary oracle congestion.

---

## 4. Client-Side Orchestration (TypeScript)

### 4.1 SDK Setup

The Switchboard On-Demand SDK provides dynamic address resolution. **Never hardcode Switchboard program IDs or queue addresses** -- they differ between devnet/mainnet and change with SDK upgrades.

```typescript
// Source: v3-archive devnet-vrf.ts
import * as sb from "@switchboard-xyz/on-demand";

// Dynamic resolution -- works on both devnet and mainnet
const sbProgramId = await sb.getProgramId(provider.connection);
const sbProgram = new Program(sb.SB_ON_DEMAND_IDL, sbProgramId, provider);
const queueAccount = await sb.getDefaultQueue(
    provider.connection.rpcEndpoint
);
```

### 4.2 Transaction 1 -- Create Randomness Account

A fresh keypair is generated for each randomness request. The account must be created and **finalized** before proceeding.

```typescript
// Source: v3-archive devnet-vrf.ts
import { Keypair } from "@solana/web3.js";

// Generate a fresh keypair for this randomness request
const rngKp = Keypair.generate();

// Create the randomness account via Switchboard SDK
const [randomness, createIx] = await sb.Randomness.create(
    sbProgram,
    rngKp,
    queueAccount
);

// Send and wait for FINALIZATION (not just confirmation!)
const createTx = new Transaction().add(createIx);
createTx.feePayer = wallet.publicKey;
createTx.recentBlockhash = (
    await provider.connection.getLatestBlockhash()
).blockhash;
createTx.sign(wallet.payer, rngKp);

const createSig = await provider.connection.sendRawTransaction(
    createTx.serialize()
);
await provider.connection.confirmTransaction(createSig, "finalized");
```

**Why finalization?** The SDK's `commitIx()` reads account data from the chain. With only "confirmed" status, the account might not be fully materialized on the RPC node being used. "Finalized" guarantees the account is readable.

### 4.3 Transaction 2 -- Commit

The commit transaction bundles the Switchboard SDK commit instruction with the program's commit instruction.

```typescript
// Source: v3-archive devnet-vrf.ts
import { ComputeBudgetProgram } from "@solana/web3.js";

// Switchboard SDK commit (reads account data, constructs oracle instruction)
const commitIx = await randomness.commitIx(queueAccount);

// Program commit (locks epoch state, stores randomness account key)
const programCommitIx = await program.methods
    .commitEpochRandomness()
    .accounts({
        epochState: epochPda,
        randomnessAccount: rngKp.publicKey,
        requester: wallet.publicKey,
    })
    .instruction();

// Bundle with compute budget (400k CU needed for Switchboard operations)
const commitTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    commitIx,
    programCommitIx
);

// Send and confirm
const commitSig = await provider.connection.sendTransaction(
    commitTx,
    [wallet.payer]
);
await provider.connection.confirmTransaction(commitSig, "confirmed");
```

**Compute budget note:** Switchboard's commit instruction alone requires ~150-200k CU. Combined with the program instruction, 400k CU is the safe minimum.

### 4.4 Transaction 3 -- Reveal + Consume

After the commit, the oracle needs time to process and reveal the randomness. The client must wait for slot advancement and retry the reveal instruction.

```typescript
// Source: v3-archive devnet-vrf.ts

// Wait for slot advancement (oracle needs at least 1 slot to process)
// In practice, waiting 3 slots provides reliability
const waitForSlotAdvance = async (slots: number) => {
    const startSlot = await provider.connection.getSlot();
    while ((await provider.connection.getSlot()) < startSlot + slots) {
        await new Promise((resolve) => setTimeout(resolve, 400));
    }
};
await waitForSlotAdvance(3);

// Reveal instruction with retry logic (oracle may not be ready immediately)
let revealIx;
for (let i = 0; i < 10; i++) {
    try {
        revealIx = await randomness.revealIx();
        break;
    } catch (e) {
        if (i === 9) throw e;
        console.log(`Reveal not ready, retry ${i + 1}/10...`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
}

// Program consume (reads revealed bytes, derives tax rates, updates pools)
const programConsumeIx = await program.methods
    .consumeRandomness()
    .accounts({
        epochState: epochPda,
        randomnessAccount: rngKp.publicKey,
        treasury: treasuryDestination,
        advancer: wallet.publicKey,
        systemProgram: SystemProgram.programId,
    })
    .remainingAccounts([
        { pubkey: poolAPda, isSigner: false, isWritable: true },
        { pubkey: poolBPda, isSigner: false, isWritable: true },
    ])
    .instruction();

// Bundle with compute budget
const consumeTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    revealIx,
    programConsumeIx
);

const consumeSig = await provider.connection.sendTransaction(
    consumeTx,
    [wallet.payer]
);
await provider.connection.confirmTransaction(consumeSig, "confirmed");
```

**Retry logic rationale:** The oracle processes commits asynchronously. On devnet, the reveal is typically ready within 3-5 seconds, but network congestion can delay this. The v3 implementation used 10 retries with 2-second delays (20 seconds total timeout) and this proved reliable in testing.

### 4.5 Complete Flow (Condensed)

For reference, here is the complete VRF epoch advancement flow as a single condensed listing:

```typescript
// Source: v3-archive tests/devnet-vrf.ts (condensed)
import * as sb from "@switchboard-xyz/on-demand";
import { Keypair, Transaction, ComputeBudgetProgram, SystemProgram } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";

async function advanceEpochWithVRF(
    program: Program,
    provider: AnchorProvider,
    epochPda: PublicKey,
    poolPdas: PublicKey[],
    treasuryPda: PublicKey
) {
    // --- Setup ---
    const sbProgramId = await sb.getProgramId(provider.connection);
    const sbProgram = new Program(sb.SB_ON_DEMAND_IDL, sbProgramId, provider);
    const sbQueue = await sb.getDefaultQueue(provider.connection.rpcEndpoint);
    const wallet = provider.wallet as AnchorWallet;

    // --- TX 1: Create randomness account ---
    const rngKp = Keypair.generate();
    const [randomness, createIx] = await sb.Randomness.create(sbProgram, rngKp, sbQueue);
    const createTx = new Transaction().add(createIx);
    createTx.feePayer = wallet.publicKey;
    createTx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;
    createTx.sign(wallet.payer, rngKp);
    const createSig = await provider.connection.sendRawTransaction(createTx.serialize());
    await provider.connection.confirmTransaction(createSig, "finalized");

    // --- TX 2: Commit ---
    const commitIx = await randomness.commitIx(sbQueue);
    const programCommitIx = await program.methods
        .commitEpochRandomness()
        .accounts({
            epochState: epochPda,
            randomnessAccount: rngKp.publicKey,
            requester: wallet.publicKey,
        })
        .instruction();
    const commitTx = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        commitIx,
        programCommitIx
    );
    await provider.sendAndConfirm(commitTx, [wallet.payer]);

    // --- TX 3: Reveal + Consume ---
    // Wait for slot advancement
    const startSlot = await provider.connection.getSlot();
    while ((await provider.connection.getSlot()) < startSlot + 3) {
        await new Promise((r) => setTimeout(r, 400));
    }

    // Retry reveal until oracle is ready
    let revealIx;
    for (let i = 0; i < 10; i++) {
        try {
            revealIx = await randomness.revealIx();
            break;
        } catch (e) {
            if (i === 9) throw e;
            await new Promise((r) => setTimeout(r, 2000));
        }
    }

    const programConsumeIx = await program.methods
        .consumeRandomness()
        .accounts({
            epochState: epochPda,
            randomnessAccount: rngKp.publicKey,
            treasury: treasuryPda,
            advancer: wallet.publicKey,
            systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(
            poolPdas.map((pk) => ({ pubkey: pk, isSigner: false, isWritable: true }))
        )
        .instruction();
    const consumeTx = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        revealIx,
        programConsumeIx
    );
    await provider.sendAndConfirm(consumeTx, [wallet.payer]);
}
```

---

## 5. Security Model

### 5.1 Anti-Reroll Protection

**Threat:** An attacker commits randomness, sees the revealed value (which determines tax rates), decides the rates are unfavorable, and commits a new randomness request with a different account to get different rates.

**Mitigation:** Account binding at commit time.

```rust
// At commit: bind the specific randomness account
epoch.pending_randomness_account = ctx.accounts.randomness_account.key();

// At consume: verify the EXACT same account
require!(
    ctx.accounts.randomness_account.key() == epoch.pending_randomness_account,
    CustomError::RandomnessAccountMismatch
);
```

**How it works:**
1. When `commit_epoch_randomness` is called, the program stores the randomness account's public key
2. When `consume_randomness` is called, the program verifies the passed randomness account matches what was committed
3. If an attacker tries to pass a different randomness account (with more favorable values), the transaction fails with `RandomnessAccountMismatch`
4. The `RandomnessAlreadyPending` guard prevents committing a new account while one is pending (unless timed out)

### 5.2 Timeout Recovery

**Threat:** Oracle goes down, rotates, or network congestion prevents randomness fulfillment. The epoch is permanently stuck in `randomness_pending = true`.

**Mitigation:** 1-hour timeout with recovery.

- `RANDOMNESS_TIMEOUT = 3600` seconds (1 hour)
- After timeout, a new `commit_epoch_randomness` call is allowed even though `randomness_pending = true`
- The new commit overwrites the stale pending state
- The old randomness account is effectively abandoned

**Tradeoff:** 1 hour of stalled epochs is the worst case. This is acceptable because:
- Epochs are typically 30-60 minutes, so at most ~1-2 epochs are delayed
- A permanently stuck protocol would be catastrophic
- The oracle is highly available in practice (Switchboard runs redundant TEE infrastructure)

### 5.3 Stale Randomness Prevention

**Threat:** An attacker pre-generates many randomness accounts, waits for favorable oracle reveals, then uses a stale (already-revealed) account to commit.

**Mitigation:** Two checks at commit time:

1. **Freshness check:** The randomness account's `seed_slot` must be within 1 slot of the current slot
   ```rust
   let slot_diff = clock.slot.saturating_sub(randomness_data.seed_slot);
   require!(slot_diff <= 1, CustomError::RandomnessExpired);
   ```

2. **Already-revealed check:** If `get_value()` succeeds, the randomness has already been revealed and cannot be used for a new commit
   ```rust
   if randomness_data.get_value(clock.slot).is_ok() {
       return Err(CustomError::RandomnessAlreadyRevealed.into());
   }
   ```

Together, these ensure only fresh, unrevealed randomness accounts can be committed.

### 5.4 Error Codes

The v3 implementation defines 8 VRF-specific error codes:

| Error Code | When Thrown | Security Purpose |
|------------|------------|-----------------|
| `RandomnessAlreadyPending` | `commit_epoch_randomness` when `randomness_pending = true` and not timed out | Prevents reroll attacks (double-commit) |
| `NoRandomnessPending` | `consume_randomness` when `randomness_pending = false` | Prevents consume without valid commit |
| `InsufficientRandomness` | `derive_tax_rates` when revealed bytes < 4 | Ensures all 4 tax rates can be derived |
| `RandomnessNotRevealed` | `consume_randomness` when oracle hasn't revealed yet | Prevents premature consume with zero bytes |
| `RandomnessAccountMismatch` | `consume_randomness` when account key differs from committed | Core anti-reroll protection |
| `RandomnessExpired` | `commit_epoch_randomness` when `seed_slot` is stale (>1 slot old) | Prevents use of pre-generated randomness |
| `RandomnessAlreadyRevealed` | `commit_epoch_randomness` when randomness is already revealed | Prevents reuse of consumed randomness |
| `RandomnessParseError` | Any instruction when `RandomnessAccountData::parse()` fails | Guards against malformed/fake randomness accounts |

---

## 6. Constants

All constants from the v3-archive implementation:

```rust
// Source: v3-archive constants.rs
pub const ADVANCER_REWARD_BPS: u64 = 10;        // 0.1% of treasury
pub const MAX_ADVANCER_REWARD: u64 = 50_000_000; // 0.05 SOL cap
pub const RANDOMNESS_TIMEOUT: i64 = 3600;        // 1 hour timeout
pub const RANDOMNESS_BYTES: u8 = 4;              // 4 tax rate values (v3 only)
```

| Constant | Value | Unit | Purpose |
|----------|-------|------|---------|
| `ADVANCER_REWARD_BPS` | 10 | basis points | Incentive for calling epoch advancement (0.1% of treasury) |
| `MAX_ADVANCER_REWARD` | 50,000,000 | lamports | Cap on advancer reward (0.05 SOL) |
| `RANDOMNESS_TIMEOUT` | 3600 | seconds | Max wait before allowing new randomness commit |
| `RANDOMNESS_BYTES` | 4 | bytes | Number of random bytes consumed per epoch in v3 (one per tax rate) |

> **Phase 37 update**: The current implementation uses MIN_VRF_BYTES = 8: bytes 0-4 for tax (flip + 4 independent magnitude rolls) and bytes 5-7 for Carnage. The v3 value of 4 bytes is historical only.

> **SPEC DISCREPANCY**: The current spec defines `TRIGGER_BOUNTY_LAMPORTS = 10_000_000` (0.01 SOL fixed). V3 used a percentage-based reward (0.1% of treasury, capped at 0.05 SOL). These are different incentive models. See VRF_Migration_Lessons.md for analysis.

> **SPEC DISCREPANCY**: The current spec defines `VRF_TIMEOUT_SLOTS = 300` (~2 minutes). V3 used `RANDOMNESS_TIMEOUT = 3600` seconds (~1 hour). Significantly different timeout windows. See VRF_Migration_Lessons.md for analysis.

---

## 7. Dependencies

### 7.1 Rust (On-Chain Program)

| Crate | Version | Purpose |
|-------|---------|---------|
| `switchboard-on-demand` | 0.11.3 | Parse `RandomnessAccountData`, read revealed randomness via `get_value()` |
| `anchor-lang` | 0.32.1 | Program framework (accounts, instructions, serialization) |

> **NOTE**: Pin these versions. The `switchboard-on-demand` crate is actively developed and now has `solana-v2` and `solana-v3` feature flags, suggesting a Solana SDK version transition. Verify latest compatible versions when the implementation phase begins.

### 7.2 TypeScript (Client-Side)

| Package | Version | Purpose |
|---------|---------|---------|
| `@switchboard-xyz/on-demand` | ^3.7.3 | Create randomness accounts, build commit/reveal instructions |
| `@coral-xyz/anchor` | (match project) | Anchor client framework |
| `@solana/web3.js` | (match project) | Solana connection, transactions, keypairs |

### 7.3 Deprecated -- Do Not Use

| Library | Status | Problem |
|---------|--------|---------|
| `solana-randomness-service-lite` | Abandoned | References account `DCe143s...` that does not exist on devnet or mainnet |
| `solana-randomness-service` | Outdated | Built with Anchor 0.29, incompatible with 0.32 |
| `switchboard-v2` | Deprecated | Legacy VRF v2 requiring 276 instructions (~48 transactions) |

---

## 8. Known Discrepancies with Current Spec

This section summarizes differences between the v3-archive implementation (this document) and the current specification (`Docs/Epoch_State_Machine_Spec.md`). These are flagged for resolution -- **neither document should be assumed correct over the other**.

For full analysis and resolution recommendations, see `Docs/VRF_Migration_Lessons.md`.

| # | Aspect | V3 Implementation | Current Spec | Impact |
|---|--------|-------------------|--------------|--------|
| 1 | **Epoch timing** | Timestamp-based, `duration_seconds = 3600` (1 hour) | Slot-based, `SLOTS_PER_EPOCH = 4_500` (~30 min) | Affects all time-dependent logic |
| 2 | **Tax model** | Continuous linear mapping, 75-1475 BPS | Discrete "cheap side" regime, 4 values per band | Fundamentally different game theory |
| 3 | **VRF byte usage** | 4 bytes (one per tax rate) | 8 bytes (flip, 4 independent magnitude rolls, Carnage trigger/action/target) | Different randomness consumption model |
| 4 | **VRF integration pattern** | Client-side commit-reveal (On-Demand) | Client-side commit-reveal (On-Demand) | **RESOLVED** -- Spec updated 2026-02-03 |
| 5 | **Trigger bounty** | 0.1% of treasury, capped at 0.05 SOL | Fixed 0.01 SOL (`TRIGGER_BOUNTY_LAMPORTS`) | Different incentive alignment |
| 6 | **Timeout window** | 3600 seconds (1 hour) | 300 slots (~2 minutes) | V3 is much more conservative |
| 7 | **Carnage integration** | Not implemented (separate concern) | Atomic within `consume_randomness` | Spec updated -- Carnage executes atomically in consume_randomness |
| 8 | **Tax range** | Continuous 0.75%-14.75% | Low: 1-4%, High: 11-14% (discrete steps) | Affects arbitrage predictability |

> **Row 4 RESOLVED**: The Epoch_State_Machine_Spec.md has been updated (2026-02-03) to use the client-side commit-reveal pattern. The spec's `trigger_epoch_transition` now validates a client-provided randomness account, and `consume_randomness` (formerly `vrf_callback`) reads revealed bytes. Remaining discrepancies (rows 1-3, 5-8) were resolved as RESOLVED:SPEC in VRF_Migration_Lessons.md — the spec's values were adopted for v4.

---

## Appendix A: V3 Source File Reference

For readers who have access to the `v3-archive` branch, here are the exact source files:

```
programs/solana-uniswap-v2/src/
  instructions/
    commit_epoch_randomness.rs   -- Commit instruction (Section 3.2)
    consume_randomness.rs        -- Consume instruction (Section 3.3)
    initialize_epoch.rs          -- One-time epoch state setup
    resize_epoch.rs              -- Migration helper (50 -> 82 bytes)
  state/
    epoch_state.rs               -- EpochState struct + derive_tax_rates() (Sections 3.1, 3.4)
  constants.rs                   -- All VRF constants (Section 6)
  errors.rs                      -- Error codes (Section 5.4)

tests/
  devnet-vrf.ts                  -- Full devnet integration test (Section 4.5)
  vrf.ts                         -- Local unit tests (tax rate math)
  security/vrf-attacks.ts        -- Security test suite (Section 5)
```

---

## Appendix B: Relationship to Other Documents

| Document | Relationship |
|----------|-------------|
| `Docs/Epoch_State_Machine_Spec.md` | **Authoritative spec** for epoch transitions. This reference documents how VRF was implemented in v3; the spec defines how it should work going forward. Discrepancies listed in Section 8. |
| `Docs/VRF_Migration_Lessons.md` | **Companion document** (06-02). Covers migration pitfalls, lessons learned, and detailed discrepancy analysis. |
| `Docs/Tax_Pool_Logic_Spec.md` | Tax rates derived by VRF (Section 3.4) are applied to pools defined in this spec. |
| `Docs/Carnage_Fund_Spec.md` | Carnage execution was NOT integrated with VRF in v3 (Section 8, Row 7). Future implementation must reconcile. |
