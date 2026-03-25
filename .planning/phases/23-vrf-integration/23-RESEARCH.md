# Phase 23: VRF Integration + Anti-Manipulation - Research

**Researched:** 2026-02-06
**Domain:** Switchboard On-Demand VRF for Solana
**Confidence:** HIGH

## Summary

Phase 23 integrates Switchboard On-Demand VRF (verifiable randomness) into the existing EpochState infrastructure from Phase 22. The research confirms that:

1. **Switchboard On-Demand is the only viable VRF approach** - All legacy patterns (CPI callback, VRF v2) are deprecated/abandoned. The On-Demand pattern using SGX TEE attestation is proven working in v3-archive.

2. **Three-transaction flow is mandatory** - SDK architecture requires: (1) Create randomness account and wait for finalization, (2) Bundle commitIx + trigger_epoch_transition, (3) Bundle revealIx + consume_randomness. This is a hard constraint imposed by the Switchboard SDK's client-side data fetching.

3. **Anti-manipulation patterns are well-documented** - V3-archive contains proven implementations for anti-reroll (account binding), stale randomness prevention (seed_slot freshness), and timeout recovery (300-slot window per spec).

**Primary recommendation:** Use switchboard-on-demand v0.11.3 Rust crate (exact pin) and @switchboard-xyz/on-demand ^3.7.3 TypeScript SDK. Port v3-archive patterns directly - they are proven working on devnet.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `switchboard-on-demand` | =0.11.3 | Parse RandomnessAccountData, read revealed randomness | Only current VRF solution for Solana; proven on devnet in v3 |
| `@switchboard-xyz/on-demand` | ^3.7.3 | Client-side VRF orchestration (create, commit, reveal) | Official TypeScript SDK for On-Demand pattern |
| `anchor-lang` | 0.32.1 | Program framework (already in use) | Project standard |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@coral-xyz/anchor` | ^0.32.1 | TypeScript Anchor client | Instruction building for tests |
| `@solana/web3.js` | (match project) | Transaction construction, keypairs | VRF account creation |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `switchboard-on-demand` | None | All alternatives deprecated (see VRF_Migration_Lessons.md) |

**Installation (Rust):**
```toml
[dependencies]
switchboard-on-demand = "=0.11.3"
```

**Installation (TypeScript):**
```bash
npm install @switchboard-xyz/on-demand@^3.7.3
```

## Architecture Patterns

### Recommended Project Structure
```
programs/epoch-program/src/
  instructions/
    mod.rs
    initialize_epoch_state.rs      # Phase 22 (exists)
    trigger_epoch_transition.rs    # Phase 23 (new)
    consume_randomness.rs          # Phase 23 (new)
    retry_epoch_vrf.rs             # Phase 23 (new)
  helpers/
    mod.rs
    tax_derivation.rs              # Phase 23 (new) - VRF byte parsing
  state/
    mod.rs
    epoch_state.rs                 # Phase 22 (exists)
    enums.rs                       # Phase 22 (exists)
  constants.rs                     # Phase 22 (exists, extend)
  errors.rs                        # Phase 22 (exists, extend)
  events.rs                        # Phase 22 (exists, extend)
  lib.rs

tests/
  devnet-vrf.ts                    # Phase 23 (new) - minimal devnet validation
```

### Pattern 1: Client-Side Commit-Reveal (Three-Transaction Flow)
**What:** The program never CPIs into Switchboard. Client orchestrates all SDK calls.
**When to use:** All VRF epoch transitions (trigger, consume, retry)
**Example:**
```typescript
// Source: v3-archive/tests/devnet-vrf.ts (validated on devnet)

// TX 1: Create randomness account (MUST finalize before TX 2)
const rngKp = Keypair.generate();
const [randomness, createIx] = await sb.Randomness.create(sbProgram, rngKp, sbQueue);
const createTx = new Transaction().add(createIx);
createTx.sign(wallet.payer, rngKp);
await provider.connection.sendRawTransaction(createTx.serialize());
await provider.connection.confirmTransaction(sig, "finalized"); // MUST be finalized

// TX 2: Commit + Trigger (bundled)
const commitIx = await randomness.commitIx(sbQueue);
const triggerIx = await epochProgram.methods
    .triggerEpochTransition()
    .accounts({ epochState, randomnessAccount: rngKp.publicKey, ... })
    .instruction();
const commitTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    commitIx,
    triggerIx
);
await provider.sendAndConfirm(commitTx, [wallet.payer]);

// Wait ~3 slots for oracle to reveal
await waitForSlotAdvance(3);

// TX 3: Reveal + Consume (bundled)
let revealIx;
for (let i = 0; i < 10; i++) {
    try { revealIx = await randomness.revealIx(); break; }
    catch { await sleep(2000); }
}
const consumeIx = await epochProgram.methods
    .consumeRandomness()
    .accounts({ epochState, randomnessAccount: rngKp.publicKey, ... })
    .instruction();
const consumeTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    revealIx,
    consumeIx
);
await provider.sendAndConfirm(consumeTx, [wallet.payer]);
```

### Pattern 2: Anti-Reroll Account Binding
**What:** Bind randomness account at commit time, verify at consume time
**When to use:** Always in trigger_epoch_transition and consume_randomness
**Example:**
```rust
// Source: VRF_Implementation_Reference.md Section 5.1, v3-archive

// At trigger_epoch_transition (commit time):
epoch.pending_randomness_account = ctx.accounts.randomness_account.key();

// At consume_randomness:
require!(
    ctx.accounts.randomness_account.key() == epoch.pending_randomness_account,
    EpochError::RandomnessAccountMismatch
);
```

### Pattern 3: Stale Randomness Prevention
**What:** Two-check validation at commit time
**When to use:** trigger_epoch_transition and retry_epoch_vrf
**Example:**
```rust
// Source: VRF_Implementation_Reference.md Section 5.3, Epoch_State_Machine_Spec.md Section 7.1

// Parse the Switchboard randomness account
let randomness_data = {
    let data = ctx.accounts.randomness_account.try_borrow_data()?;
    RandomnessAccountData::parse(data)
        .map_err(|_| EpochError::RandomnessParseError)?
};

// Check 1: Freshness (seed_slot within 1 slot of current)
let slot_diff = clock.slot.saturating_sub(randomness_data.seed_slot);
require!(slot_diff <= 1, EpochError::RandomnessExpired);

// Check 2: Not-yet-revealed (must still be in commit phase)
if randomness_data.get_value(clock.slot).is_ok() {
    return Err(EpochError::RandomnessAlreadyRevealed.into());
}
```

### Pattern 4: Discrete Tax Band Derivation
**What:** Map VRF bytes to discrete 4-step bands per spec
**When to use:** consume_randomness tax calculation
**Example:**
```rust
// Source: Epoch_State_Machine_Spec.md Section 7.3

const LOW_RATES: [u16; 4] = [100, 200, 300, 400];      // 1%, 2%, 3%, 4%
const HIGH_RATES: [u16; 4] = [1100, 1200, 1300, 1400]; // 11%, 12%, 13%, 14%

fn derive_taxes(vrf_result: &[u8], current_cheap: Token) -> TaxConfig {
    // Byte 0: Flip decision (75% probability)
    let should_flip = vrf_result[0] < 192;

    // Byte 1: Low tax magnitude (4 discrete values)
    let low_bps = LOW_RATES[(vrf_result[1] % 4) as usize];

    // Byte 2: High tax magnitude (4 discrete values)
    let high_bps = HIGH_RATES[(vrf_result[2] % 4) as usize];

    let cheap_side = if should_flip { current_cheap.opposite() } else { current_cheap };

    // Derive all four rates based on cheap side
    // ...
}
```

### Anti-Patterns to Avoid
- **CPI to Switchboard:** Never CPI into Switchboard programs. On-chain code only reads passed-in accounts.
- **Combining TX 1 + TX 2:** SDK's commitIx() reads account data client-side. Account must be finalized first.
- **Default compute budget:** VRF transactions need 400k CU. Always include ComputeBudgetProgram.setComputeUnitLimit.
- **Immediate revealIx:** Oracle needs ~3 slots to process. Always wait and retry.
- **Timestamp-based epoch timing:** Use slot-based timing per spec (SLOTS_PER_EPOCH = 4,500).

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Randomness parsing | Custom RandomnessAccountData parser | `RandomnessAccountData::parse()` from switchboard-on-demand | Account format may change; SDK handles versions |
| Value extraction | Custom byte reading | `randomness_data.get_value(slot)` | Handles reveal timing, returns error if not ready |
| Queue discovery | Hardcode queue addresses | `sb.getDefaultQueue(rpcEndpoint)` | Different on devnet/mainnet, changes over time |
| Program ID discovery | Hardcode Switchboard program ID | `sb.getProgramId(connection)` | Changes between networks |
| Commit instruction | Manual instruction building | `randomness.commitIx(queue)` | Complex account setup handled by SDK |
| Reveal instruction | Manual instruction building | `randomness.revealIx()` | Oracle interaction handled by SDK |

**Key insight:** The Switchboard SDK exists to abstract complex oracle interactions. Rolling custom solutions risks breaking when Switchboard updates their infrastructure (which has happened - see VRF_Migration_Lessons.md).

## Common Pitfalls

### Pitfall 1: SDK Requires Account to Exist Before commitIx
**What goes wrong:** Attempting to bundle createIx + commitIx in same transaction fails with "Account not found"
**Why it happens:** SDK's commitIx() fetches account data client-side before constructing the instruction
**How to avoid:** Always send createIx in separate transaction and wait for "finalized" confirmation
**Warning signs:** "Account not found" or "Account does not exist" errors on commitIx call

### Pitfall 2: Compute Unit Underestimation
**What goes wrong:** VRF transactions fail with "Exceeded maximum compute units"
**Why it happens:** Switchboard operations need ~150-200k CU; combined with program logic exceeds 200k default
**How to avoid:** Always include `ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })` as first instruction
**Warning signs:** Works on localnet, fails on devnet; "Computational budget exceeded" errors

### Pitfall 3: revealIx Not Ready Immediately
**What goes wrong:** Calling revealIx() immediately after commit fails
**Why it happens:** Switchboard oracle (in SGX) needs time to observe commitment and produce attestation (~3 slots)
**How to avoid:** Wait for slot advancement, then retry revealIx up to 10 times with 2-second delays
**Warning signs:** "Reveal not ready" or similar SDK errors that resolve after waiting

### Pitfall 4: Protocol Deadlock from VRF Failure
**What goes wrong:** Oracle goes down or rotates; epoch permanently stuck with vrf_pending = true
**Why it happens:** Without timeout, failed VRF request creates permanent deadlock
**How to avoid:** Implement retry_epoch_vrf with VRF_TIMEOUT_SLOTS (300 slots, ~2 min) timeout check
**Warning signs:** vrf_pending = true persisting beyond timeout; epoch number stops incrementing

### Pitfall 5: Abandoned Crates
**What goes wrong:** Using deprecated VRF crates that compile but fail at runtime
**Why it happens:** solana-randomness-service-lite, switchboard-v2 are abandoned but still on crates.io
**How to avoid:** Only use `switchboard-on-demand`. Check crate update dates and referenced accounts exist on devnet.
**Warning signs:** References unknown account addresses; crate not updated in >6 months

### Pitfall 6: Reroll Attack
**What goes wrong:** Attacker commits randomness, sees unfavorable result, commits different account
**Why it happens:** Missing account binding at commit time
**How to avoid:** Store `pending_randomness_account` pubkey at commit; verify exact match at consume
**Warning signs:** Multiple commit calls in same epoch; different randomness accounts between commit/consume

## Code Examples

Verified patterns from v3-archive and official sources:

### Reading Randomness (Rust)
```rust
// Source: VRF_Implementation_Reference.md Section 3.3

use switchboard_on_demand::RandomnessAccountData;

// In instruction handler:
let random_bytes = {
    let data = ctx.accounts.randomness_account.try_borrow_data()?;
    let randomness_data = RandomnessAccountData::parse(data)
        .map_err(|_| EpochError::RandomnessParseError)?;
    randomness_data
        .get_value(clock.slot)
        .map_err(|_| EpochError::RandomnessNotRevealed)?
};

// random_bytes is now Vec<u8> with 32 bytes of randomness
// Use bytes 0-5 per spec for tax + Carnage decisions
```

### Dynamic SDK Setup (TypeScript)
```typescript
// Source: v3-archive/tests/devnet-vrf.ts

import * as sb from "@switchboard-xyz/on-demand";

// Dynamic resolution - works on both devnet and mainnet
const sbProgramId = await sb.getProgramId(provider.connection);
const sbIdl = await anchor.Program.fetchIdl(sbProgramId, provider);
const sbProgram = new anchor.Program(sbIdl, provider);

const queueAccount = await sb.getDefaultQueue(
    provider.connection.rpcEndpoint
);
await queueAccount.loadData(); // Validate queue exists
const sbQueue = queueAccount.pubkey;
```

### Slot Advancement Wait (TypeScript)
```typescript
// Source: v3-archive/tests/devnet-vrf.ts

async function waitForSlotAdvance(targetSlots: number): Promise<void> {
    const startSlot = await connection.getSlot();
    while (true) {
        await new Promise(r => setTimeout(r, 500));
        const currentSlot = await connection.getSlot();
        if (currentSlot >= startSlot + targetSlots) {
            return;
        }
    }
}

// Usage: wait for oracle to process
await waitForSlotAdvance(3);
```

### Retry Logic for Reveal (TypeScript)
```typescript
// Source: v3-archive/tests/devnet-vrf.ts

let revealIx;
const maxRetries = 10;
for (let i = 0; i < maxRetries; i++) {
    try {
        revealIx = await randomness.revealIx();
        console.log("Got reveal instruction");
        break;
    } catch (e) {
        console.log(`Reveal not ready (attempt ${i + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, 2000));
    }
}
if (!revealIx) {
    throw new Error("Failed to get reveal instruction after retries");
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| CPI callback (solana-randomness-service-lite) | Client-side commit-reveal | ~2024 | Infrastructure shut down; old approach impossible |
| VRF v2 (276 instructions, 48 transactions) | On-Demand (3 transactions) | ~2024 | Massive complexity reduction |
| Timestamp-based epochs | Slot-based epochs | Spec decision | More deterministic, no clock drift |
| Continuous tax range (0.75-14.75%) | Discrete bands (1-4%, 11-14%) | Spec decision | Clearer arbitrage signals |

**Deprecated/outdated:**
- `solana-randomness-service-lite`: Abandoned, references non-existent accounts
- `solana-randomness-service`: Built with Anchor 0.29, incompatible with 0.32
- `switchboard-v2`: Legacy VRF v2 with prohibitive complexity (48 transactions)

## Open Questions

Things that couldn't be fully resolved:

1. **Mainnet VRF Cost Per Request**
   - What we know: Devnet testing works; ~0.002 SOL estimated per request (historical)
   - What's unclear: Exact current mainnet pricing
   - Recommendation: Test on devnet during implementation; budget 0.01 SOL trigger bounty covers cost

2. **Compute Budget for Combined VRF + Carnage**
   - What we know: VRF consume alone needs ~400k CU; Carnage adds CPI calls
   - What's unclear: Whether atomic Carnage execution fits in single instruction
   - Recommendation: Per CONTEXT.md, Carnage is Phase 25 scope. Phase 23 tests VRF alone.

3. **SDK Version Stability**
   - What we know: v0.11.3 proven on devnet; crate has `solana-v2` and `solana-v3` feature flags
   - What's unclear: API stability guarantees
   - Recommendation: Pin to =0.11.3; test before upgrading at deployment milestones

## Sources

### Primary (HIGH confidence)
- `Docs/VRF_Implementation_Reference.md` - Working v3 code patterns (comprehensive)
- `Docs/Epoch_State_Machine_Spec.md` - Authoritative specification (updated 2026-02-03)
- `Docs/VRF_Migration_Lessons.md` - Discrepancy analysis and pitfall catalog
- `v3-archive/tests/devnet-vrf.ts` - Proven devnet integration test code
- `v3-archive/tests/security/vrf-attacks.ts` - Security test patterns
- `programs/epoch-program/` - Phase 22 existing implementation

### Secondary (MEDIUM confidence)
- `https://docs.rs/switchboard-on-demand/0.11.3/` - Crate API documentation (97% documented)
- `https://crates.io/crates/switchboard-on-demand` - Version confirmation (v0.11.3)

### Tertiary (LOW confidence)
- WebSearch results for "switchboard-on-demand" - Confirmed SDK existence and purpose

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - v3-archive proven on devnet; SDK versions verified
- Architecture: HIGH - Three-transaction flow documented in multiple sources
- Pitfalls: HIGH - Documented in VRF_Migration_Lessons.md with root cause analysis
- Tax derivation: HIGH - Spec Section 7.3 is authoritative
- Attack tests: HIGH - v3-archive contains working security test patterns

**Research date:** 2026-02-06
**Valid until:** 2026-03-06 (30 days - Switchboard is actively developed but core patterns stable)
