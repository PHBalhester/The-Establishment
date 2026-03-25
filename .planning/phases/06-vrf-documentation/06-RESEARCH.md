# Phase 6: VRF Documentation - Research

**Researched:** 2026-02-03
**Domain:** Capturing Switchboard VRF implementation knowledge from archive-V3 branch
**Confidence:** HIGH (primary source is our own code; secondary is Switchboard documentation)

## Summary

Phase 6 is a **documentation phase**, not an implementation phase. The goal is to capture the working Switchboard VRF integration from the `v3-archive` git branch before that knowledge is lost, and to document the lessons learned during the migration from the old CPI-callback approach to the current client-side commit-reveal pattern.

The v3-archive branch contains a **complete, tested, and devnet-verified** Switchboard On-Demand randomness integration. The implementation successfully:
- Migrated from `solana-randomness-service-lite` (abandoned crate) to `switchboard-on-demand` v0.11.3
- Implemented the three-transaction commit-reveal pattern
- Validated on devnet with real Switchboard oracles (epoch advanced from 1 to 2 with VRF-derived tax rates)
- Included comprehensive security tests for reroll attacks, wrong account injection, and timeout recovery

**Primary recommendation:** Document the v3 implementation as-is since it was proven working. Structure documentation around: (1) the VRF lifecycle flow (request/callback/timeout), (2) the Rust program patterns, (3) the TypeScript client orchestration, (4) the migration story from old to new Switchboard, and (5) spec discrepancies that must be resolved before reimplementation.

## Standard Stack

This phase is documentation-only -- no libraries need to be installed. However, for reference, here is what was used in v3 and will be needed for future reimplementation:

### Core (from v3 working implementation)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `switchboard-on-demand` | 0.11.3 | Rust: parse RandomnessAccountData, read randomness | Current Switchboard crate; actively maintained |
| `@switchboard-xyz/on-demand` | ^3.7.3 | TypeScript: create/commit/reveal randomness | Official Switchboard TS SDK for On-Demand pattern |
| `anchor-lang` | 0.32.1 | Rust: program framework | Project standard |

### Deprecated/Abandoned (lessons learned)
| Library | Status | Problem | Replacement |
|---------|--------|---------|-------------|
| `solana-randomness-service-lite` | Abandoned | References account `DCe143s...` that doesn't exist on devnet/mainnet | `switchboard-on-demand` |
| `solana-randomness-service` | Outdated | Built with Anchor 0.29, version mismatch with 0.32 | `switchboard-on-demand` |
| `switchboard-v2` | Deprecated | Legacy VRF v2 requiring 276 instructions (~48 txs) | `switchboard-on-demand` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Switchboard On-Demand | ORAO VRF | ORAO costs ~0.001 SOL per request; Switchboard is more established on Solana. Project decided on Switchboard. |
| Client-side commit-reveal | CPI callback (old pattern) | CPI callback was simpler conceptually but relied on abandoned crates and callback infrastructure that could silently fail |

## Architecture Patterns

### V3 Implementation Structure (What Worked)
```
programs/solana-uniswap-v2/src/
  instructions/
    commit_epoch_randomness.rs   # Phase 1: Client-initiated commit
    consume_randomness.rs        # Phase 2: Client-initiated consume after reveal
    initialize_epoch.rs          # One-time epoch state setup
    resize_epoch.rs              # Migration helper for account resizing
  state/
    epoch_state.rs               # EpochState account + derive_tax_rates()
  constants.rs                   # RANDOMNESS_TIMEOUT, ADVANCER_REWARD_BPS, etc.
  errors.rs                      # VRF-specific error codes

tests/
  devnet-vrf.ts                  # Full devnet integration test (working!)
  vrf.ts                         # Local unit tests (tax rate derivation math)
  security/vrf-attacks.ts        # Security test suite
```

### Pattern 1: Three-Transaction Commit-Reveal (CRITICAL LEARNING)

The Switchboard On-Demand SDK requires the randomness account to **already exist** before `commitIx()` can be called. This means three separate transactions:

```
Transaction 1: Create randomness account
  - Randomness.create(sbProgram, rngKp, queue) -> createIx
  - Send createIx, wait for FINALIZATION

Transaction 2: Commit randomness + program lock
  - randomness.commitIx(queue) -> commitIx
  - program.methods.commitEpochRandomness() -> programCommitIx
  - Bundle: [computeBudgetIx, commitIx, programCommitIx]
  - Send, wait for confirmation

Transaction 3: Reveal randomness + program consume (after slot advances)
  - randomness.revealIx() -> revealIx (may need retries)
  - program.methods.consumeRandomness() -> programConsumeIx
  - Bundle: [computeBudgetIx, revealIx, programConsumeIx]
  - Send, wait for confirmation
```

**Why three transactions, not two:** The Switchboard SDK's `commitIx()` method reads the randomness account's on-chain data. If the account doesn't exist yet, the SDK throws. Transaction 1 must be finalized before Transaction 2 can be constructed.

### Pattern 2: Program-Side Validation (No CPI Needed)

The key simplification of On-Demand vs legacy VRF: the program never calls Switchboard via CPI. Instead:

```rust
// Source: v3-archive commit_epoch_randomness.rs
// Program just validates the randomness account data
let randomness_data = {
    let data = ctx.accounts.randomness_account.try_borrow_data()?;
    RandomnessAccountData::parse(data)
        .map_err(|_| CustomError::RandomnessParseError)?
};

// Check freshness: seed_slot should be current or previous slot
let slot_diff = clock.slot.saturating_sub(randomness_data.seed_slot);
require!(slot_diff <= 1, CustomError::RandomnessExpired);

// Check NOT yet revealed (commit phase)
if randomness_data.get_value(clock.slot).is_ok() {
    return Err(CustomError::RandomnessAlreadyRevealed.into());
}
```

```rust
// Source: v3-archive consume_randomness.rs
// At consume time, read the revealed value
let random_bytes = {
    let data = ctx.accounts.randomness_account.try_borrow_data()?;
    let randomness_data = RandomnessAccountData::parse(data)
        .map_err(|_| CustomError::RandomnessParseError)?;
    randomness_data
        .get_value(clock.slot)
        .map_err(|_| CustomError::RandomnessNotRevealed)?
};
```

### Pattern 3: Anti-Reroll with Account Binding

The program stores the committed randomness account pubkey and verifies it at consume time:

```rust
// At commit: store the account
epoch.pending_randomness_account = ctx.accounts.randomness_account.key();
epoch.randomness_pending = true;

// At consume: verify same account
require!(
    ctx.accounts.randomness_account.key() == epoch.pending_randomness_account,
    CustomError::RandomnessAccountMismatch
);
```

### Pattern 4: Dynamic Switchboard Address Resolution

Never hardcode Switchboard addresses. The v3 test used SDK methods:

```typescript
// Source: v3-archive devnet-vrf.ts
const sbProgramId = await sb.getProgramId(provider.connection);
const queueAccount = await sb.getDefaultQueue(provider.connection.rpcEndpoint);
```

### Pattern 5: Pool Tax Rate Update via remaining_accounts

The v3 implementation uses `remaining_accounts` for flexible pool updates:

```rust
// Source: v3-archive consume_randomness.rs
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
```

### Anti-Patterns to Avoid
- **Using `solana-randomness-service-lite`**: Abandoned crate, references non-existent accounts
- **CPI callback pattern**: More fragile than client-side commit-reveal; silent failures possible
- **Hardcoding Switchboard addresses**: Use SDK dynamic resolution methods
- **Single-transaction create+commit**: SDK requires account to exist before calling commitIx

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Randomness account creation | Manual account init | `Randomness.create()` from SDK | SDK handles PDA derivation and account structure |
| Commit/reveal instructions | Raw instruction construction | `randomness.commitIx()` / `randomness.revealIx()` | SDK knows the correct oracle and account layout |
| Randomness data parsing | Manual deserialization | `RandomnessAccountData::parse()` + `get_value()` | Complex internal structure; SDK handles versioning |
| Queue/program ID resolution | Hardcoded addresses | `sb.getProgramId()` / `sb.getDefaultQueue()` | Addresses differ between devnet/mainnet and change with upgrades |

**Key insight:** The Switchboard On-Demand approach pushes complexity to the client side. The on-chain program is remarkably simple (just validate and read). The client code, however, requires careful SDK usage and retry logic.

## Common Pitfalls

### Pitfall 1: Abandoned Crate (`solana-randomness-service-lite`)
**What went wrong in v3:** Initial implementation used `solana-randomness-service-lite` which references account `DCe143sY8nC6SNwZWwi7qeFco7FxSvKrGrZ62vsufTJa` that doesn't exist on devnet or mainnet.
**Root cause:** Switchboard deprecated the old CPI-callback randomness service but the crate remained on crates.io with no deprecation notice.
**How to avoid:** Always use `switchboard-on-demand` (currently v0.11.3). Verify crate activity on crates.io before adopting.
**Warning signs:** Crate hasn't been updated in >6 months; references unknown account addresses.

### Pitfall 2: SDK Requires Account to Exist Before commitIx
**What went wrong:** Trying to create the randomness account and call commitIx in the same transaction fails because the SDK reads the account data client-side before building the instruction.
**Root cause:** `Randomness.create()` returns a `createIx` but the SDK's `commitIx()` method fetches the account from the chain before constructing the commit instruction.
**How to avoid:** Always send `createIx` in a separate transaction and wait for finalization before calling `commitIx()`.
**Warning signs:** "Account not found" errors when trying to call `commitIx()`.

### Pitfall 3: Compute Unit Underestimation
**What went wrong:** Default compute units insufficient for Switchboard instructions.
**Root cause:** Switchboard's `createIx` needs ~150-200k CU; `commitIx + program commit` needs ~400k CU.
**How to avoid:** Always include `ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })` in VRF transactions.
**Warning signs:** "Exceeded maximum compute units" errors.

### Pitfall 4: revealIx Not Ready Immediately
**What went wrong:** Calling `randomness.revealIx()` immediately after commit fails.
**Root cause:** The oracle needs time to process the commitment. Need to wait for slot advancement (~3 slots).
**How to avoid:** Wait for slot advancement and implement retry logic with exponential backoff (v3 used up to 10 retries with 2s delays).
**Warning signs:** "Reveal not ready" or similar errors from the SDK.

### Pitfall 5: Timeout Recovery Required
**What went wrong:** If randomness request is never fulfilled, epoch is permanently stuck.
**Root cause:** Oracle could be down, rotated, or network congestion prevents fulfillment.
**How to avoid:** Implement timeout recovery -- v3 uses `RANDOMNESS_TIMEOUT = 3600` seconds (1 hour). After timeout, a new commit is allowed even if `randomness_pending = true`.
**Warning signs:** `randomness_pending = true` for more than an hour.

### Pitfall 6: Epoch State Account Resize on Migration
**What went wrong:** Adding VRF fields to EpochState changed the account size from 50 to 82 bytes. Existing accounts couldn't be deserialized.
**Root cause:** Anchor's `init` constraint creates accounts at a fixed size. Adding fields requires resizing.
**How to avoid:** V3 created a `resize_epoch` instruction using manual realloc. Document this pattern for future migrations.
**Warning signs:** "Failed to deserialize account" when loading EpochState after adding fields.

## Code Examples

All code examples are from the v3-archive branch, verified working on devnet.

### EpochState Account (with VRF fields)
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

### Tax Rate Derivation (Bias-Free Linear Mapping)
```rust
// Source: v3-archive state/epoch_state.rs
pub fn derive_tax_rate(random_byte: u8) -> u16 {
    const RANGE: u16 = MAX_TAX_BPS - MIN_TAX_BPS; // 1475 (in v3: 75 to 1475)
    let scaled = (random_byte as u32 * RANGE as u32) / 255;
    MIN_TAX_BPS + scaled as u16
}

pub fn derive_tax_rates(random_bytes: &[u8]) -> Result<[u16; 4]> {
    if random_bytes.len() < 4 {
        return Err(CustomError::InsufficientRandomness.into());
    }
    Ok([
        derive_tax_rate(random_bytes[0]), // Pool A buy
        derive_tax_rate(random_bytes[1]), // Pool A sell
        derive_tax_rate(random_bytes[2]), // Pool B buy
        derive_tax_rate(random_bytes[3]), // Pool B sell
    ])
}
```

### Constants
```rust
// Source: v3-archive constants.rs
pub const ADVANCER_REWARD_BPS: u64 = 10;        // 0.1% of treasury
pub const MAX_ADVANCER_REWARD: u64 = 50_000_000; // 0.05 SOL
pub const RANDOMNESS_TIMEOUT: i64 = 3600;        // 1 hour
pub const RANDOMNESS_BYTES: u8 = 4;              // 4 tax values
```

### Error Codes
```rust
// Source: v3-archive errors.rs (VRF-specific)
RandomnessAlreadyPending,    // Reroll prevention
NoRandomnessPending,         // Consume without commit
InsufficientRandomness,      // < 4 bytes
RandomnessNotRevealed,       // Consume before oracle reveal
RandomnessAccountMismatch,   // Wrong account at consume
RandomnessExpired,           // Stale seed_slot
RandomnessAlreadyRevealed,   // Commit with already-revealed account
RandomnessParseError,        // Failed to parse RandomnessAccountData
```

### TypeScript Client Flow (Working Devnet Test)
```typescript
// Source: v3-archive tests/devnet-vrf.ts (condensed)
// Step 1: Create randomness account (separate tx, must finalize)
const rngKp = Keypair.generate();
const [randomness, createIx] = await sb.Randomness.create(sbProgram, rngKp, sbQueue);
// Send createIx... wait for finalization

// Step 2: Bundle commitIx + program commit
const commitIx = await randomness.commitIx(sbQueue);
const programCommitIx = await program.methods
    .commitEpochRandomness()
    .accounts({
        epochState: epochPda,
        randomnessAccount: rngKp.publicKey,
        requester: wallet.publicKey,
    })
    .instruction();
// Bundle and send [computeBudget, commitIx, programCommitIx]

// Step 3: Wait for slots, then reveal + consume
await waitForSlotAdvance(3);
const revealIx = await randomness.revealIx(); // May need retries
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
        { pubkey: poolPda, isSigner: false, isWritable: true },
    ])
    .instruction();
// Bundle and send [computeBudget, revealIx, programConsumeIx]
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `solana-randomness-service-lite` (CPI callback) | `switchboard-on-demand` (client-side commit-reveal) | 2024 | Program is simpler; client is more complex; no silent callback failures |
| Switchboard VRF v2 (276 instructions for proof) | Switchboard On-Demand (SGX TEE) | 2024 | Single-slot fulfillment possible; massively simpler |
| Program CPIs to request randomness | Program only reads randomness from passed account | 2024 | No CPI accounts needed; program side drastically simplified |
| `switchboard-v2` / `switchboard-solana` crates | `switchboard-on-demand` crate | 2024 | New API: `RandomnessAccountData::parse()` + `get_value()` |

**Deprecated/outdated:**
- `solana-randomness-service-lite`: Abandoned, references non-existent accounts
- `solana-randomness-service`: Not updated for Anchor 0.32+
- Switchboard VRF v2: Deprecated, extremely high cost (276 instructions)
- CPI callback pattern: Replaced by client-side commit-reveal

## Critical Discrepancy: Epoch_State_Machine_Spec.md vs V3 Implementation

**This must be flagged for the human reviewer at the Q&A checkpoint.**

The current `Docs/Epoch_State_Machine_Spec.md` on the main branch describes a **different VRF model** than what was actually implemented and proven working in v3:

| Aspect | Epoch_State_Machine_Spec.md (main) | V3 Implementation (archive) |
|--------|--------------------------------------|----------------------------|
| **Timing** | Slot-based (4,500 slots per epoch) | Timestamp-based (3,600 seconds) |
| **Tax model** | "Cheap side" regime: one token cheap, one expensive; 4 discrete rates per band | Independent tax rates per pool: continuous 75-1475 bps range per rate |
| **VRF byte usage** | 6 bytes: flip decision, low/high magnitude, Carnage trigger/action/target | 4 bytes: one per tax rate (pool A buy, pool A sell, pool B buy, pool B sell) |
| **VRF integration** | CPI to Switchboard (old VRF v2 pattern) | Client-side commit-reveal (On-Demand pattern) |
| **Epoch duration** | ~30 minutes (slot-based) | 1 hour (timestamp-based) |
| **Carnage integration** | Atomic in VRF callback | Not integrated in v3 VRF (separate concern) |
| **Trigger bounty** | Fixed 0.01 SOL | 0.1% of treasury, capped at 0.05 SOL |
| **Tax range** | Low: 1-4%, High: 11-14% (discrete steps) | Continuous: 0.75%-14.75% (linear interpolation) |

**This is not a bug in either document.** The spec was written for the intended design; the v3 implementation was a working prototype that used different parameters. Phase 5 (convergence) should have reconciled these, but the VRF specifics were deferred to this phase.

**Recommendation:** Documentation in Phase 6 should:
1. Document what v3 actually implemented (the working code)
2. Note where it differs from the spec
3. Flag each difference for resolution before reimplementation
4. Do NOT choose one over the other -- let the human decide at the Q&A checkpoint

## Open Questions

### 1. Spec vs Implementation Tax Model
- **What we know:** V3 used continuous linear tax rates (75-1475 bps). Spec uses discrete "cheap side" regime (4 values per band).
- **What's unclear:** Which model will the rebuild use? The spec model is more game-theoretically interesting (creates clear arbitrage windows), but the v3 implementation proved a simpler model works.
- **Recommendation:** Flag for Q&A checkpoint. This is a design decision, not a documentation decision.

### 2. Slot-Based vs Timestamp-Based Timing
- **What we know:** V3 used `unix_timestamp` (simpler). Spec uses slot-based timing (more deterministic).
- **What's unclear:** The spec argues slot-based is better for predictable arbitrage windows. V3 proved timestamp-based works.
- **Recommendation:** Flag for Q&A checkpoint. Both work; tradeoffs are real.

### 3. Switchboard SDK Version Stability
- **What we know:** `switchboard-on-demand` v0.11.3 worked in Jan 2026. The crate is actively developed.
- **What's unclear:** Whether v0.11.3 will still be compatible when we reimplementation begins. The `switchboard-on-demand` crate now has `solana-v2` and `solana-v3` feature flags suggesting a Solana SDK version transition is happening.
- **Recommendation:** Pin to v0.11.3 for documentation. Verify latest version when implementation phase begins.

### 4. Carnage Integration in VRF Callback
- **What we know:** The spec describes atomic Carnage execution within the VRF callback. V3 didn't implement Carnage.
- **What's unclear:** Whether the client-side commit-reveal pattern can accommodate Carnage's compute requirements (multiple CPI calls for market buys/burns).
- **Recommendation:** Document that v3 didn't address Carnage integration. Flag as future design work.

### 5. Cost Per VRF Request
- **What we know:** V3 test results showed the flow works on devnet. Historical estimates suggest ~0.002 SOL per request.
- **What's unclear:** Exact mainnet cost with current Switchboard pricing.
- **Recommendation:** LOW confidence on costs. Test on devnet during implementation phase.

## Sources

### Primary (HIGH confidence)
- `v3-archive` branch code: `programs/solana-uniswap-v2/src/instructions/commit_epoch_randomness.rs` - Working commit instruction
- `v3-archive` branch code: `programs/solana-uniswap-v2/src/instructions/consume_randomness.rs` - Working consume instruction
- `v3-archive` branch code: `programs/solana-uniswap-v2/src/state/epoch_state.rs` - EpochState with VRF fields + tax derivation
- `v3-archive` branch: `.planning/phases/08-devnet-deployment/VRF-MIGRATION-NOTES.md` - Devnet test results
- `v3-archive` branch: `.planning/phases/08-devnet-deployment/VRF-MIGRATION.md` - Migration architecture doc
- `v3-archive` branch: `.planning/phases/06-vrf-integration/06-RESEARCH.md` - Original VRF research
- `v3-archive` branch: `tests/devnet-vrf.ts` - Working devnet integration test
- `v3-archive` branch: `tests/security/vrf-attacks.ts` - Security test documentation
- `Docs/Epoch_State_Machine_Spec.md` - Current spec (for comparison)

### Secondary (MEDIUM confidence)
- [switchboard-on-demand crate](https://crates.io/crates/switchboard-on-demand) - v0.11.3, confirmed actively maintained
- [Switchboard Randomness On-Demand Getting Started](https://github.com/switchboard-xyz/gitbook-randomness-on-demand/blob/main/getting-started.md) - Commit-reveal pattern documentation
- [Switchboard docs](https://docs.switchboard.xyz/) - Official documentation hub

### Tertiary (LOW confidence)
- Exa search results on Switchboard On-Demand architecture - General context only
- Stack Exchange posts on Solana VRF options - Community guidance, not authoritative

## Metadata

**Confidence breakdown:**
- V3 implementation documentation: HIGH - We have the full source code and devnet test results
- Migration story (old vs new): HIGH - VRF-MIGRATION.md and VRF-MIGRATION-NOTES.md capture this in detail
- Spec discrepancies: HIGH - Side-by-side comparison reveals clear differences
- Current Switchboard SDK state: MEDIUM - Verified crate exists and is maintained, but detailed API docs were inaccessible
- Future reimplementation guidance: MEDIUM - Based on working code, but spec decisions still pending

**Research date:** 2026-02-03
**Valid until:** 2026-03-03 (30 days - this is documentation of existing code, not fast-moving ecosystem research)
