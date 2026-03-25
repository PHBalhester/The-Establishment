# Phase 47: Carnage Hardening - Research

**Researched:** 2026-02-19
**Domain:** Solana on-chain swap protection, MEV resistance, transaction atomicity, constant-product AMM slippage
**Confidence:** HIGH

## Summary

Phase 47 hardens three specific aspects of Carnage Fund execution: slippage protection (SEC-05), fallback path reliability (SEC-04), and atomic bundling of VRF consumption with Carnage execution (FIX-02). The codebase already has substantial Carnage infrastructure from the bug-fix work -- this phase tightens tolerances, upgrades the deadline window, adds a CarnageFailed event, and enforces the on-chain state lock mechanism decided in CONTEXT.md.

The primary MEV risk is the 85-slot gap observed on devnet between `consume_randomness` (which reveals Carnage intent) and `executeCarnageAtomic` (which executes the swap). An attacker watching the mempool can see that Carnage is pending and front-run the swap. The fix is client-side bundling (both instructions in one transaction) PLUS the on-chain state lock already partially implemented (carnage_pending + deadline).

The slippage floor upgrade from 50% to 85% (15% tolerance) for the atomic path and 75% (25% tolerance) for the fallback path is straightforward -- the `read_pool_reserves()` and constant-product calculation infrastructure already exist. The only code change is the threshold comparison and adding a separate constant for the fallback tolerance.

**Primary recommendation:** Bundle consume_randomness + executeCarnageAtomic in one transaction client-side, upgrade slippage thresholds from `expected / 2` to `expected * 85 / 100` (atomic) and `expected * 75 / 100` (fallback), increase CARNAGE_DEADLINE_SLOTS from 100 to 300, add CarnageFailed event, and make the fallback path enforce that only the fallback can execute after deadline.

## Standard Stack

### Core

This phase modifies existing Rust/Anchor programs and TypeScript client code. No new libraries are needed.

| Component | Current | Purpose | Phase 47 Change |
|-----------|---------|---------|-----------------|
| Anchor | 0.30.x | On-chain program framework | Modify existing instructions |
| Rust | Stable | Program language | Constant and threshold changes |
| TypeScript | 5.x | Client code | Bundle consume+execute in one TX |
| @solana/web3.js | 1.x | TX building | Build multi-instruction transactions |

### Supporting

| Tool | Purpose | When Used |
|------|---------|-----------|
| Jito bundles | MEV protection for mainnet | Future mainnet hardening (not this phase) |
| `jitodontfront` prefix | Sandwich mitigation via Jito block engine | Consider for mainnet (see Open Questions) |
| Address Lookup Table | TX size reduction for large instructions | Already in use for Sell path |

### Not Needed

| Considered | Rejected | Why |
|------------|----------|-----|
| Jito bundle integration | Client-side TX bundling | Devnet doesn't have Jito; atomic TX is sufficient |
| Oracle-based price feed | Pool-state reserves | CONTEXT.md decision: pool-state-based calculation |
| External slippage oracle | On-chain constant-product math | Adds dependency, not needed for backstop floor |

## Architecture Patterns

### Pattern 1: Client-Side Atomic Bundling (FIX-02)

**What:** Place `consume_randomness` and `executeCarnageAtomic` instructions in the SAME Solana transaction. Solana transactions are atomic -- all instructions succeed or all fail.

**When to use:** Whenever consume_randomness reveals a Carnage epoch.

**Why it works:**
- Solana runtime executes instructions within a transaction sequentially and atomically
- No instructions from other transactions can interleave between them
- If executeCarnageAtomic fails, consume_randomness also rolls back (VRF stays pending)
- Validators cannot reorder instructions WITHIN a single transaction

**Current state:** `vrf-flow.ts` sends reveal+consume as one TX, then executeCarnageAtomic as a SEPARATE TX (~85 slots later on devnet). This is the CARN-002 vulnerability.

**Fix location:** `scripts/vrf/lib/vrf-flow.ts` function `sendRevealAndConsume` must detect when Carnage will trigger and append the executeCarnageAtomic instruction to the same transaction.

**Key challenge:** Transaction size. consume_randomness has ~7 accounts. executeCarnageAtomic has ~23 named accounts + 4-8 remaining_accounts for hooks. Combined: ~34-38 accounts. This is right at the 1232-byte TX limit.

**Mitigation:** The Address Lookup Table (ALT) is already deployed with 46 addresses (EyUncwUhSwCVyTnbeoKe7Ug33sUDGAQDLDBQ5fVP9Vuf). v0 VersionedTransaction with ALT compresses account addresses from 32 bytes to 1-byte indices. This is the same pattern already used for the Sell path.

**Code pattern (conceptual):**
```typescript
// In vrf-flow.ts, after building revealIx + consumeIx:
if (carnageWillTrigger) {
    const executeCarnageIx = buildExecuteCarnageAtomicIx(/* ... */);
    const tx = new VersionedTransaction(
        MessageV0.compile({
            payerKey: wallet.publicKey,
            instructions: [computeBudgetIx, revealIx, consumeIx, executeCarnageIx],
            addressLookupTableAccounts: [altAccount],
            recentBlockhash,
        })
    );
}
```

### Pattern 2: On-Chain State Lock (Atomicity Enforcement)

**What:** The `carnage_pending` flag + `carnage_deadline_slot` on EpochState already exist. Phase 47 enforces that during the lock window (before deadline), only the atomic path can execute.

**Current state:** Both `execute_carnage_atomic` and `execute_carnage` (fallback) check `carnage_pending = true` but have no differentiation about WHEN they can be called.

**What changes:**
- `execute_carnage_atomic`: No deadline check needed (it runs in the same TX as consume_randomness, always within window)
- `execute_carnage` (fallback): Already checks `clock.slot <= carnage_deadline_slot`. Need to ADD a check that `clock.slot > consume_slot + LOCK_WINDOW` so fallback can ONLY run after the lock window expires.
- The lock window is a subset of the deadline: lock window < deadline.

**CONTEXT.md decision:** Lock window duration is Claude's discretion. Recommendation: 50 slots (~20 seconds). This gives the atomic TX ample time to confirm while keeping fallback available quickly if atomic fails.

**Implementation detail:** Add `carnage_lock_slot` to EpochState (or use `carnage_deadline_slot - FALLBACK_BUFFER`). When consume_randomness sets carnage_pending, it also sets the lock slot. execute_carnage (fallback) requires `clock.slot > lock_slot`.

### Pattern 3: Pool-State-Based Slippage Floor (SEC-05)

**What:** Read current pool reserves, compute expected output using constant-product formula, require actual output >= threshold% of expected.

**Constant-product formula:**
```
expected_output = (reserve_token * amount_in) / (reserve_sol + amount_in)
```

This formula ALREADY includes natural price impact. A large swap into a shallow pool gets a lower `expected_output` because `amount_in` significantly increases the denominator. The 15% tolerance is only for same-TX manipulation (bugs or extreme deviation), NOT for catching sandwich attacks.

**Current code (execute_carnage_atomic.rs lines 399-415):**
```rust
// Current: 50% floor
require!(bought >= expected / 2, EpochError::CarnageSlippageExceeded);
```

**Phase 47 change:**
```rust
// Atomic path: 85% floor (15% tolerance)
const CARNAGE_SLIPPAGE_BPS_ATOMIC: u64 = 8500; // 85%
require!(
    bought >= expected * CARNAGE_SLIPPAGE_BPS_ATOMIC / 10000,
    EpochError::CarnageSlippageExceeded
);

// Fallback path: 75% floor (25% tolerance)
const CARNAGE_SLIPPAGE_BPS_FALLBACK: u64 = 7500; // 75%
```

**CONTEXT.md decision:** Whether 25% fallback tolerance is a separate constant or derived from primary. Recommendation: Separate named constants for clarity and auditability. `CARNAGE_SLIPPAGE_BPS_ATOMIC = 8500` and `CARNAGE_SLIPPAGE_BPS_FALLBACK = 7500`.

### Pattern 4: Failure Recovery with CarnageFailed Event

**What:** When a Carnage swap fails (both atomic and fallback), emit a CarnageFailed event for off-chain monitoring. Funds carry forward automatically.

**Current state:** If atomic fails, the entire transaction rolls back (consume_randomness also fails, VRF stays pending). The fallback has a deadline check. If the deadline passes without execution, consume_randomness auto-expires stale pending Carnage on the next epoch.

**Phase 47 change:**
- The carry-forward mechanism already works: funds stay in carnage_vault, next Carnage epoch retries
- Need to add CarnageFailed event emission when fallback execute_carnage fails
- `expire_carnage.rs` already handles expiry but should emit more diagnostic info

**CarnageFailed event fields (Claude's discretion):**
```rust
#[event]
pub struct CarnageFailed {
    pub epoch: u32,
    pub action: u8,
    pub target: u8,
    pub attempted_amount: u64,    // SOL that was attempted
    pub failure_reason: u8,       // 1=slippage, 2=insufficient_sol, 3=cpi_error
    pub slot: u64,
    pub atomic: bool,             // was this the atomic or fallback attempt
}
```

Recommendation: Keep it lightweight (8 fields max) since this is emitted on failure paths where compute may already be tight. Use a `failure_reason` enum byte rather than a string.

### Anti-Patterns to Avoid

- **Do NOT add slippage protection to swap_exempt.rs in Tax Program:** The `MINIMUM_OUTPUT = 0` in swap_exempt is correct. The slippage check happens in the Epoch handler AFTER the CPI returns, using the vault balance delta. Putting slippage in both places would double-check and the Tax Program version wouldn't have access to pool reserve state.

- **Do NOT try to make consume_randomness call executeCarnageAtomic via CPI:** consume_randomness has only 7 accounts. executeCarnageAtomic needs 23+ accounts. Adding them all would create a massive instruction struct and likely exceed TX size limits. The correct approach is client-side bundling (two instructions, one TX).

- **Do NOT use integer division for slippage comparison:** `expected * 85 / 100` should use u128 intermediate to avoid overflow, exactly as the current code does. The order of operations matters: multiply first, then divide.

- **Do NOT block epoch transitions on Carnage failure:** CONTEXT.md explicitly states epochs move forward regardless of Carnage lock state. The auto-expire in consume_randomness handles stale locks.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Pool reserve reading | Custom AMM client | Existing `read_pool_reserves()` | Already handles byte layout, mint ordering |
| Transfer Hook accounts | Manual account resolution | Existing hook account partitioning | HOOK_ACCOUNTS_PER_MINT=4, already tested |
| WSOL wrapping | Custom SOL->WSOL | Existing `wrap_sol_to_wsol()` | Handles system_program::transfer + sync_native |
| Slippage calculation | External oracle | Constant-product formula from reserves | CONTEXT.md decision, already implemented |
| TX size management | Manual serialization | ALT + VersionedTransaction v0 | Already deployed (46 addresses) |

**Key insight:** Almost all the infrastructure for this phase already exists. The changes are parameter adjustments (50% -> 85%/75%, 100 -> 300 slots), event additions, and client-side TX restructuring. Do not rebuild what already works.

## Common Pitfalls

### Pitfall 1: Transaction Size When Bundling consume_randomness + executeCarnageAtomic

**What goes wrong:** Combining two large instructions exceeds the 1232-byte TX limit.

**Why it happens:** consume_randomness (~7 accounts) + executeCarnageAtomic (~23 named + 4-8 remaining) + Switchboard revealIx + ComputeBudget = potentially 35-40 unique accounts.

**How to avoid:**
1. Use the existing ALT which already contains most program IDs and PDAs
2. Use VersionedTransaction v0 (already used for Sell path)
3. Count accounts carefully: many accounts overlap between consume_randomness and executeCarnageAtomic (epoch_state, carnage_state)
4. If still too large, the BuyOnly path (no sell hook accounts) should fit; Sell path may need the fallback

**Warning signs:** TX serialization exceeding 1232 bytes during testing. Test the WORST CASE (Sell path with all hook accounts for both mints).

### Pitfall 2: Carnage Triggering Detection Before TX Submission

**What goes wrong:** Client bundles executeCarnageAtomic but Carnage doesn't actually trigger (VRF byte 5 >= 11). Wasted compute + TX fails.

**Why it happens:** The client doesn't know the VRF result until after consume_randomness executes. But we need to decide BEFORE submission whether to include executeCarnageAtomic.

**How to avoid:**
- Option A (simple): Always include executeCarnageAtomic. If Carnage doesn't trigger, executeCarnageAtomic fails (carnage_pending = false), which causes the entire atomic TX to fail, which means consume_randomness also rolls back. BAD -- blocks normal epoch transitions.
- Option B (simulation): Simulate the transaction first to see if Carnage triggers, then decide. Possible but adds latency.
- Option C (two-path, recommended): Send consume_randomness alone. If Carnage triggers (detected from event or state poll), immediately send executeCarnageAtomic in a follow-up TX. The state lock ensures no one can front-run within the lock window.
- Option D (conditional): Use Anchor's require! to make executeCarnageAtomic gracefully no-op when no Carnage is pending. This changes the instruction semantics.

**Recommendation:** Option C is the safest. The state lock (50-slot window) provides sufficient protection. The lock ensures that only the original client (who knows the carnage_signer PDA) can execute within the window. After the lock expires, anyone can call the fallback.

IMPORTANT NUANCE: Actually, executeCarnageAtomic IS permissionless (any caller). The lock window doesn't restrict WHO can call, it restricts WHICH instruction (atomic vs fallback). The MEV protection comes from:
1. VRF unpredictability (attacker can't know Carnage will trigger until VRF reveals)
2. Speed (client sends executeCarnageAtomic immediately after detecting pending)
3. Slippage floor (even if front-run, the floor limits extraction)

### Pitfall 3: Stale Account Data After CPI

**What goes wrong:** After a CPI call (e.g., swap_exempt), Anchor's deserialized account data is stale. Reading `.amount` without `.reload()` returns the pre-CPI value.

**Why it happens:** Anchor deserializes account data at instruction entry. CPI calls mutate the underlying AccountInfo data, but Anchor's struct wrappers don't auto-refresh.

**How to avoid:** The codebase already handles this correctly with explicit `.reload()` calls after each CPI. Maintain this pattern for any new CPI paths. Specifically:
- After sell swap: `carnage_wsol.reload()` (already done)
- After buy swap: `crime_vault.reload()` / `fraud_vault.reload()` (already done)
- After target vault reload in step 1.5 (already done)

**Warning signs:** Underflow/overflow errors when calculating vault balance deltas.

### Pitfall 4: Overflow in Slippage Calculation with Tighter Thresholds

**What goes wrong:** Changing from `expected / 2` to `expected * 85 / 100` introduces potential overflow if expected is very large.

**Why it happens:** `expected` is a u64. `expected * 85` can overflow u64 if expected > u64::MAX / 85 (~2.17e17). With MAX_CARNAGE_SWAP_LAMPORTS = 1000 SOL = 1e12 lamports, the maximum expected token output could theoretically be very large for low-value tokens.

**How to avoid:** Use u128 intermediate arithmetic:
```rust
let threshold = (expected as u128)
    .checked_mul(8500)
    .and_then(|n| n.checked_div(10000))
    .ok_or(EpochError::Overflow)? as u64;
require!(bought >= threshold, EpochError::CarnageSlippageExceeded);
```

The current code already uses u128 for the expected output calculation. Extend this pattern to the threshold comparison.

### Pitfall 5: Fallback Deadline vs Lock Window Confusion

**What goes wrong:** The lock window (for atomic-only execution) and the fallback deadline (after which Carnage expires) serve different purposes but share the same timing mechanism.

**Why it happens:** CONTEXT.md specifies a 300-slot fallback timeout. CARNAGE_DEADLINE_SLOTS is currently 100. These need to be reconciled:
- Lock window: ~50 slots (atomic-only period)
- Fallback window: slots 50-300 (anyone can call execute_carnage)
- Expiry: after slot 300 (Carnage expires, funds carry forward)

**How to avoid:** Use clear naming:
```rust
pub const CARNAGE_LOCK_SLOTS: u64 = 50;       // Atomic-only window
pub const CARNAGE_DEADLINE_SLOTS: u64 = 300;   // Total fallback window
```

EpochState stores:
- `carnage_pending: bool` -- Carnage needs execution
- `carnage_deadline_slot: u64` -- Set to `current_slot + CARNAGE_DEADLINE_SLOTS`
- (Optionally) `carnage_lock_slot: u64` -- Set to `current_slot + CARNAGE_LOCK_SLOTS`

Or derive lock expiry: `carnage_lock_expired = clock.slot > carnage_deadline_slot - (CARNAGE_DEADLINE_SLOTS - CARNAGE_LOCK_SLOTS)`

### Pitfall 6: execute_carnage Fallback Has No Separate Slippage Constant

**What goes wrong:** Both atomic and fallback paths currently use the same `expected / 2` (50%) slippage check. Phase 47 needs different thresholds.

**Why it happens:** execute_carnage.rs was duplicated from execute_carnage_atomic.rs and never differentiated.

**How to avoid:** Add separate constants:
```rust
// In constants.rs
pub const CARNAGE_SLIPPAGE_BPS_ATOMIC: u64 = 8500;   // 85% minimum
pub const CARNAGE_SLIPPAGE_BPS_FALLBACK: u64 = 7500;  // 75% minimum
```

Each handler uses its respective constant.

## Code Examples

### Current Slippage Check (to be modified)

```rust
// Source: programs/epoch-program/src/instructions/execute_carnage_atomic.rs lines 399-415
// CURRENT: 50% floor
if reserve_sol > 0 && reserve_token > 0 {
    let expected = (reserve_token as u128)
        .checked_mul(total_buy_amount as u128)
        .and_then(|n| n.checked_div(
            (reserve_sol as u128).checked_add(total_buy_amount as u128)?
        ))
        .ok_or(EpochError::Overflow)? as u64;

    require!(
        bought >= expected / 2,       // <-- Change this line
        EpochError::CarnageSlippageExceeded
    );
}
```

### Target Slippage Check (atomic)

```rust
// Phase 47: 85% floor for atomic path
if reserve_sol > 0 && reserve_token > 0 {
    let expected = (reserve_token as u128)
        .checked_mul(total_buy_amount as u128)
        .and_then(|n| n.checked_div(
            (reserve_sol as u128).checked_add(total_buy_amount as u128)?
        ))
        .ok_or(EpochError::Overflow)? as u64;

    let min_output = (expected as u128)
        .checked_mul(CARNAGE_SLIPPAGE_BPS_ATOMIC as u128)
        .and_then(|n| n.checked_div(10000))
        .ok_or(EpochError::Overflow)? as u64;

    require!(
        bought >= min_output,
        EpochError::CarnageSlippageExceeded
    );
}
```

### Current Deadline Check (execute_carnage.rs)

```rust
// Source: programs/epoch-program/src/instructions/execute_carnage.rs lines 210-213
// CURRENT: Only checks deadline, no lock window distinction
require!(
    clock.slot <= ctx.accounts.epoch_state.carnage_deadline_slot,
    EpochError::CarnageDeadlineExpired
);
```

### Target Deadline Check with Lock Window

```rust
// Phase 47: Fallback requires lock window to have expired
// Option A: Explicit lock_slot field
require!(
    clock.slot > ctx.accounts.epoch_state.carnage_lock_slot,
    EpochError::CarnageLockActive   // New error variant
);
require!(
    clock.slot <= ctx.accounts.epoch_state.carnage_deadline_slot,
    EpochError::CarnageDeadlineExpired
);

// Option B: Derive from deadline (avoids new field)
let lock_expired_slot = ctx.accounts.epoch_state.carnage_deadline_slot
    .saturating_sub(CARNAGE_DEADLINE_SLOTS - CARNAGE_LOCK_SLOTS);
require!(
    clock.slot > lock_expired_slot,
    EpochError::CarnageLockActive
);
```

### CarnageFailed Event (new)

```rust
// Source: CONTEXT.md Claude's Discretion - event field selection
#[event]
pub struct CarnageFailed {
    pub epoch: u32,
    pub action: u8,
    pub target: u8,
    pub attempted_amount: u64,
    pub vault_balance: u64,     // Diagnostic: how much SOL was available
    pub slot: u64,
    pub atomic: bool,
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| MINIMUM_OUTPUT = 0 | 50% slippage floor (pool-based) | Phase 35 (bug fix) | Prevents 100% loss on sandwich |
| Separate TX for Carnage | Client-side TX bundling | Phase 47 (this phase) | Closes 85-slot MEV window |
| Single deadline constant | Lock window + fallback deadline | Phase 47 (this phase) | Enables atomic-only period |
| Fixed 50% tolerance | Adaptive 85%/75% by path | Phase 47 (this phase) | Tighter protection, lenient recovery |

**Key evolution:** The original Carnage implementation treated the swap as "market execution, no slippage protection" (per Carnage_Fund_Spec.md Section 9.3). The bug investigation revealed this was dangerous. Phase 35 added a 50% emergency floor. Phase 47 graduates this to a proper pool-state-based approach with different tolerances for different execution contexts.

## Open Questions

1. **Jito bundle integration for mainnet**
   - What we know: Jito bundles provide cross-transaction atomicity and sandwich mitigation. The `jitodontfront` prefix prevents front-running in the block engine.
   - What's unclear: Whether mainnet Carnage should use Jito bundles for additional MEV protection beyond the on-chain slippage floor.
   - Recommendation: Note for mainnet checklist but out of scope for Phase 47 (devnet focus).

2. **Whether the bundled TX fits in 1232 bytes**
   - What we know: consume_randomness (~7 accounts) + executeCarnageAtomic (~23+8 accounts) with ALT compression.
   - What's unclear: Exact serialized size with all hook accounts for the Sell path.
   - Recommendation: Test during implementation. If Sell+Buy bundled TX is too large, the fallback path handles it (acceptable per CONTEXT.md -- fallback has more lenient slippage).

3. **Whether to add a new EpochState field for lock_slot or derive it**
   - What we know: Adding a field requires account migration (EpochState space increase). Deriving from deadline avoids this.
   - What's unclear: Whether Anchor realloc is needed or if there's padding.
   - Recommendation: Check EpochState for available padding bytes. If padding exists, add the field. Otherwise, derive from deadline math.

4. **CarnageFailed event emission timing**
   - What we know: If atomic fails, the TX rolls back entirely (no event emitted). The CarnageFailed event only makes sense for fallback failures.
   - What's unclear: How to emit CarnageFailed when the fallback TX also reverts on failure. The event would need to be emitted by a DIFFERENT instruction (e.g., expire_carnage).
   - Recommendation: Emit CarnageFailed from `expire_carnage` when it clears stale pending state. This is the only place where we definitively know both paths failed.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `execute_carnage_atomic.rs`, `execute_carnage.rs`, `consume_randomness.rs`, `swap_exempt.rs`, `constants.rs`, `events.rs`, `epoch_state.rs`
- `.planning/phases/47-carnage-hardening/47-CONTEXT.md` - Locked decisions from user
- `Docs/Carnage_Fund_Spec.md` - Authoritative spec
- `Docs/Carnage_Bug_Investigation.md` - Prior bug analysis
- `Docs/Spec_vs_Implementation_Reconciliation.md` - CARN-002, CARN-007, CARN-009 findings

### Secondary (MEDIUM confidence)
- Jito documentation (https://docs.jito.wtf/lowlatencytxnsend) - Bundle mechanics, sandwich mitigation
- Solana Stack Exchange - Transaction instruction ordering, CPI account limits
- Raydium documentation - Constant-product formula verification (x * y = k)
- Solana Kit documentation - Transaction planning and atomic execution patterns

### Tertiary (LOW confidence)
- None - all findings verified against codebase or official documentation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All components already exist in codebase; only parameter changes
- Architecture: HIGH - Patterns verified against codebase + Solana documentation
- Pitfalls: HIGH - Identified from actual codebase analysis and observed devnet behavior (85-slot gap)

**Research date:** 2026-02-19
**Valid until:** 2026-03-19 (stable domain, codebase unlikely to change before Phase 47 execution)
