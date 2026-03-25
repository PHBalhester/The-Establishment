# Domain Pitfalls: Epoch/VRF Program Integration

**Domain:** Switchboard On-Demand VRF and Epoch State Machine for Solana DeFi
**Context:** Adding VRF/Epoch to existing protocol with Tax -> AMM -> Token-2022 -> Hook CPI chain
**Researched:** 2026-02-06
**Confidence:** HIGH (based on v3-archive lessons + current documentation)

---

## Critical Pitfalls

Mistakes that cause rewrites, security vulnerabilities, or protocol deadlocks.

---

### PITFALL-01: CPI Depth Exhaustion on Carnage Path

**Severity:** CRITICAL
**Phase Impact:** Epoch Program architecture, Carnage integration

**What goes wrong:**
The Carnage execution path reaches Solana's maximum CPI depth of 4:
```
consume_randomness (entry point)
  -> Tax::swap_exempt (depth 1)
     -> AMM::swap (depth 2)
        -> Token-2022::transfer_checked (depth 3)
           -> Transfer Hook::execute (depth 4) -- SOLANA LIMIT
```

If any additional CPI is added to this path (e.g., logging, state updates via separate program, or Carnage as a separate program), the transaction fails with "Exceeded maximum invoke depth."

**Why it happens:**
- Developers underestimate Token-2022's internal CPI to the Transfer Hook
- Natural instinct to separate concerns into different programs adds depth
- The v3-archive originally had "3 CPI levels" documented before discovering Token-2022 adds another

**Consequences:**
- Carnage execution always fails
- SOL accumulates indefinitely in Carnage vault
- Protocol loses core economic mechanic
- Requires complete architectural redesign to fix

**Prevention:**
1. **Carnage logic MUST be inline in Epoch Program** -- not a separate program
2. Document CPI depth at every call site with comments
3. Test Carnage path on devnet before any other integration work
4. Add CPI depth assertions to integration tests

**Detection (warning signs):**
- "Exceeded maximum invoke depth" errors on devnet
- Carnage transactions succeed in localnet (no real hooks) but fail on devnet
- Transaction simulation shows >4 program invocations in trace

**Source:** [Solana CPI Documentation](https://solana.com/docs/core/cpi), v3-archive analysis, Carnage_Fund_Spec.md Section 2

---

### PITFALL-02: Reroll Attack via Randomness Account Substitution

**Severity:** CRITICAL
**Phase Impact:** VRF integration, anti-manipulation security

**What goes wrong:**
An attacker commits randomness, waits for oracle reveal, sees unfavorable tax rates, then creates a NEW randomness account and calls `consume_randomness` with the new account that has better values.

Without anti-reroll protection, the attacker can:
1. Commit randomness account A
2. Oracle reveals A with bad rates for attacker's position
3. Attacker creates randomness account B
4. Attacker calls consume with account B (better rates)
5. Protocol uses B instead of A

**Why it happens:**
- The randomness account is passed as an argument, not derived deterministically
- Natural assumption that "if it's a valid Switchboard account, it's fine"
- Missing binding between commit and consume

**Consequences:**
- Tax regime manipulation
- Arbitrageurs can guarantee favorable rates
- Economic model breaks (predictable "random" outcomes)
- Loss of user trust

**Prevention:**
1. **Store randomness account pubkey at commit time:**
   ```rust
   epoch.pending_randomness_account = ctx.accounts.randomness_account.key();
   ```
2. **Verify EXACT match at consume time:**
   ```rust
   require!(
       ctx.accounts.randomness_account.key() == epoch.pending_randomness_account,
       EpochError::RandomnessAccountMismatch
   );
   ```
3. Add `RandomnessAlreadyPending` error to prevent double-commit
4. Test with explicit attack scenarios in security test suite

**Detection (warning signs):**
- Different randomness accounts appearing in commit vs consume events
- Same wallet repeatedly triggering epoch transitions (probing for good rates)
- Tax rate distribution not matching expected VRF distribution

**Source:** v3-archive VRF_Implementation_Reference.md Section 5.1, [Adevar Labs - On-Chain Randomness](https://www.adevarlabs.com/blog/on-chain-randomness-on-solana-predictability-manipulation-safer-alternatives-part-1)

---

### PITFALL-03: Stale/Pre-Generated Randomness Attack

**Severity:** CRITICAL
**Phase Impact:** VRF integration, security

**What goes wrong:**
An attacker pre-generates many randomness accounts, waits for oracles to reveal them all, then selects the one with most favorable values to commit. This bypasses the "commit first, then reveal" security model.

Attack flow:
1. Create 100 randomness accounts
2. Commit all 100 to Switchboard
3. Wait for all reveals
4. Pick the one with 1% tax rate
5. Call protocol's commit with that pre-revealed account

**Why it happens:**
- No freshness check on randomness account's `seed_slot`
- No check for whether randomness has already been revealed
- Assumption that Switchboard handles all validation

**Consequences:**
- Complete bypass of VRF unpredictability
- Attacker can select exact tax rates
- Protocol becomes a deterministic arbitrage machine

**Prevention:**
Two checks at commit time:
1. **Freshness check:**
   ```rust
   let slot_diff = clock.slot.saturating_sub(randomness_data.seed_slot);
   require!(slot_diff <= 1, EpochError::RandomnessExpired);
   ```
2. **Not-yet-revealed check:**
   ```rust
   if randomness_data.get_value(clock.slot).is_ok() {
       return Err(EpochError::RandomnessAlreadyRevealed.into());
   }
   ```

**Detection (warning signs):**
- Randomness accounts with seed_slot far in the past
- Same randomness account used across multiple epoch attempts
- Unexpectedly consistent tax rate patterns

**Source:** v3-archive VRF_Implementation_Reference.md Section 5.3

---

### PITFALL-04: Protocol Deadlock from Missing VRF Timeout

**Severity:** CRITICAL
**Phase Impact:** Epoch state machine, liveness

**What goes wrong:**
Oracle fails to reveal randomness (oracle down, network congestion, oracle rotation). The protocol is stuck in `vrf_pending = true` forever:
- No new epoch can start
- Tax rates frozen
- Carnage never triggers
- Protocol functionally dead

**Why it happens:**
- Switchboard oracles are highly available but not infallible
- No timeout mechanism in initial implementation
- Assumption that "oracle will always respond"

**Consequences:**
- Permanent protocol freeze
- User funds locked (cannot trade with stale taxes)
- No recovery path without upgrade authority (which is burned)

**Prevention:**
1. **Implement timeout recovery:**
   ```rust
   pub const VRF_TIMEOUT_SLOTS: u64 = 300; // ~2 minutes

   // In retry_epoch_vrf:
   require!(
       clock.slot > epoch_state.vrf_request_slot + VRF_TIMEOUT_SLOTS,
       EpochError::VrfTimeoutNotElapsed
   );
   ```
2. Create `retry_epoch_vrf` instruction that allows new commit after timeout
3. Test timeout recovery path explicitly
4. Monitor for stuck VRF states in production

**Detection (warning signs):**
- `vrf_pending = true` for more than 5 minutes
- No `TaxesUpdated` events despite epochs passing
- Epoch number not incrementing

**Source:** v3-archive VRF_Migration_Lessons.md Pitfall 5, Epoch_State_Machine_Spec.md Section 8.6

---

### PITFALL-05: Wrong Timing Model (Timestamp vs Slot)

**Severity:** CRITICAL
**Phase Impact:** Epoch timing, arbitrage predictability

**What goes wrong:**
Using `Clock::unix_timestamp` instead of `Clock::slot` for epoch boundaries causes:
- Drift up to 25% fast or 150% slow per slot
- Epoch boundaries become unpredictable
- Arbitrageurs cannot calculate windows reliably
- Same real-time duration maps to different numbers of epochs

Historical example: Solana's clock drifted 30+ minutes behind real-world time during network congestion periods.

**Why it happens:**
- v3-archive used timestamp-based timing (easier to reason about "1 hour epochs")
- Unix timestamps feel more natural to developers
- Slot-based math is less intuitive

**Consequences:**
- Epoch boundaries unpredictable during network congestion
- Arbitrage calculations fail
- User experience degraded ("why is epoch 30 minutes late?")
- Economic model assumptions violated

**Prevention:**
1. **Use slot-based timing exclusively for epoch logic:**
   ```rust
   fn current_epoch(slot: u64, genesis_slot: u64) -> u32 {
       ((slot - genesis_slot) / SLOTS_PER_EPOCH) as u32
   }
   ```
2. Reserve `unix_timestamp` only for events/logging
3. Document timing model clearly in spec
4. Test epoch boundaries under simulated slot variance

**Detection (warning signs):**
- Epoch durations varying significantly from expected
- "Epoch should have ended" user complaints
- Inconsistent arbitrage profitability reports

**Source:** [Solana Clock Documentation](https://github.com/solana-labs/solana/issues/9874), [Chainstack - Block Time](https://docs.chainstack.com/docs/solana-understanding-block-time), Epoch_State_Machine_Spec.md Section 3.3

---

## High Severity Pitfalls

Mistakes that cause significant delays, require substantial rework, or create operational issues.

---

### PITFALL-06: SDK Requires Account to Exist Before commitIx

**Severity:** HIGH
**Phase Impact:** Client-side VRF integration, transaction flow

**What goes wrong:**
Attempting to create the randomness account and call `commitIx()` in the same transaction fails. The Switchboard SDK reads account data client-side before constructing the commit instruction.

```typescript
// THIS FAILS:
const tx = new Transaction().add(
    createIx,  // Creates randomness account
    commitIx,  // SDK needs to read account data first!
);
```

**Why it happens:**
- SDK architecture constraint, not a bug
- `commitIx()` fetches on-chain data to build the instruction
- Account must be finalized (not just confirmed) before SDK can read it

**Consequences:**
- Confusing "Account not found" errors
- Developers waste time debugging "working" create instructions
- Three-transaction flow is non-negotiable

**Prevention:**
1. **Always use three separate transactions:**
   - TX1: Create randomness account, wait for FINALIZE
   - TX2: Commit (SDK commitIx + program trigger_epoch_transition)
   - TX3: Reveal + Consume (SDK revealIx + program consume_randomness)
2. Document the three-transaction flow prominently
3. Add retry logic between transactions

**Detection (warning signs):**
- "Account not found" errors when calling `commitIx()`
- Create transaction succeeds but commit fails immediately after

**Source:** v3-archive VRF_Migration_Lessons.md Pitfall 2, VRF_Implementation_Reference.md Section 2.3

---

### PITFALL-07: Compute Budget Underestimation

**Severity:** HIGH
**Phase Impact:** VRF transactions, Carnage execution

**What goes wrong:**
VRF transactions fail with "Exceeded maximum compute units" using default compute budgets. Switchboard operations are compute-intensive.

| Operation | Estimated CU |
|-----------|-------------|
| Randomness create | 150-200k |
| Commit bundle | ~400k |
| Reveal + Consume | ~400k |
| Carnage burn-then-buy | ~180k |
| Carnage sell-then-buy | ~300k |
| Combined VRF + Carnage | ~700k |

Default Solana compute budget: 200k CU

**Why it happens:**
- Default compute budget is insufficient
- Developers don't test with realistic compute limits
- Localnet may have different compute behavior

**Consequences:**
- VRF transactions fail on devnet/mainnet
- Epoch transitions don't complete
- Carnage execution fails, triggering fallback

**Prevention:**
1. **Always set explicit compute budget:**
   ```typescript
   const tx = new Transaction().add(
       ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
       // ... other instructions
   );
   ```
2. Use 400k CU for VRF operations minimum
3. Use two-instruction bundle for VRF + Carnage (700k total)
4. Test compute usage on devnet early

**Detection (warning signs):**
- "Exceeded maximum compute units" or "Computational budget exceeded" errors
- Transactions work on localnet but fail on devnet

**Source:** v3-archive VRF_Migration_Lessons.md Pitfall 3, Carnage_Fund_Spec.md Section 9.4

---

### PITFALL-08: revealIx Not Ready Immediately

**Severity:** HIGH
**Phase Impact:** Client-side VRF integration

**What goes wrong:**
Calling `randomness.revealIx()` immediately after commit fails. The Switchboard oracle needs time (~3 slots) to process and reveal.

**Why it happens:**
- Oracle processing is asynchronous
- Oracles observe commit on-chain, compute VRF, submit reveal
- Network latency adds delay

**Consequences:**
- Reveal transaction fails
- Without retry logic, epoch transition stalls
- User-facing error messages confuse users

**Prevention:**
1. **Wait for slot advancement:**
   ```typescript
   const waitForSlotAdvance = async (slots: number) => {
       const startSlot = await connection.getSlot();
       while ((await connection.getSlot()) < startSlot + slots) {
           await new Promise(r => setTimeout(r, 400));
       }
   };
   await waitForSlotAdvance(3);
   ```
2. **Implement retry logic:**
   ```typescript
   for (let i = 0; i < 10; i++) {
       try {
           revealIx = await randomness.revealIx();
           break;
       } catch (e) {
           if (i === 9) throw e;
           await new Promise(r => setTimeout(r, 2000));
       }
   }
   ```

**Detection (warning signs):**
- "Reveal not ready" errors
- Transient failures that resolve after waiting

**Source:** v3-archive VRF_Migration_Lessons.md Pitfall 4, VRF_Implementation_Reference.md Section 4.4

---

### PITFALL-09: Account Resize on Migration

**Severity:** HIGH
**Phase Impact:** Epoch state account, deployment

**What goes wrong:**
Adding VRF tracking fields to existing accounts changes their size. Existing accounts cannot be deserialized after program upgrade.

v3 example: EpochState went from 50 bytes to 82 bytes when VRF fields were added.

**Why it happens:**
- Anchor's `init` creates accounts at fixed size
- Adding fields changes expected size
- Borsh deserializer expects new layout, finds old data

**Consequences:**
- "Failed to deserialize account" errors
- Existing protocol state inaccessible
- May require account migration instruction

**Prevention:**
1. **Plan for schema evolution from the start:**
   - Reserve extra space in initial allocation
   - Or use versioned account format
2. **Create resize instruction for migrations:**
   ```rust
   pub fn resize_epoch_state(ctx: Context<ResizeEpochState>) -> Result<()> {
       // realloc to new size, zero-initialize new fields
   }
   ```
3. Document expected account sizes for each milestone

**Detection (warning signs):**
- "Unexpected account data length" errors after deployment
- Deserialization failures on existing accounts

**Source:** v3-archive VRF_Migration_Lessons.md Pitfall 6

---

### PITFALL-10: Using Abandoned Switchboard Crates

**Severity:** HIGH
**Phase Impact:** Dependency selection, build

**What goes wrong:**
Using deprecated Switchboard crates that compile successfully but fail at runtime because backing infrastructure is shut down.

| Crate | Status | Problem |
|-------|--------|---------|
| `solana-randomness-service-lite` | ABANDONED | References account `DCe143s...` that doesn't exist |
| `solana-randomness-service` | OUTDATED | Anchor 0.29 incompatible with 0.32 |
| `switchboard-v2` | DEPRECATED | Requires 276 instructions across ~48 transactions |

**Why it happens:**
- Crates remain on crates.io without deprecation notices
- Compile successfully but reference ghost infrastructure
- Documentation doesn't mention "On-Demand" replacement

**Consequences:**
- Weeks of debugging "account not found" errors
- Wasted development time on abandoned approaches
- Frustration and project delays

**Prevention:**
1. **Use ONLY `switchboard-on-demand`** (v0.11.3 or later)
2. Check crate update dates on crates.io (avoid >6 months stale)
3. Verify referenced accounts exist on devnet before integration
4. Check GitHub repo activity

**Detection (warning signs):**
- Crate README doesn't mention "On-Demand" or "SGX"
- References unknown account addresses
- No recent issues/PRs on GitHub

**Source:** v3-archive VRF_Migration_Lessons.md Pitfall 1, Section 4

---

### PITFALL-11: Cross-Program PDA Validation Missing

**Severity:** HIGH
**Phase Impact:** Access control, CPI security

**What goes wrong:**
Epoch Program needs to validate PDAs from Tax Program and AMM, but uses wrong program ID in seeds derivation:

```rust
// WRONG: Uses own program ID
#[account(
    seeds = [b"swap_authority"],
    bump,
)]
pub swap_authority: AccountInfo<'info>,

// CORRECT: Uses Tax Program ID
#[account(
    seeds = [b"swap_authority"],
    bump,
    seeds::program = TAX_PROGRAM_ID,
)]
pub swap_authority: AccountInfo<'info>,
```

**Why it happens:**
- Default Anchor behavior uses current program ID
- Copy-paste from single-program examples
- Cross-program PDA validation is less common pattern

**Consequences:**
- PDA validation passes for wrong accounts
- Potential for spoofed authority accounts
- Access control bypass

**Prevention:**
1. **Always use `seeds::program` for cross-program PDAs:**
   ```rust
   #[account(
       seeds = [b"epoch_state"],
       bump,
       seeds::program = EPOCH_PROGRAM_ID,
   )]
   pub epoch_state: Account<'info, EpochState>,
   ```
2. Document which program owns each PDA
3. Test with fake programs attempting to spoof PDAs

**Detection (warning signs):**
- PDA derivations without `seeds::program` constraint
- Accounts validating against wrong program in tests

**Source:** AMM_Implementation.md Section 18, existing Tax Program access control patterns

---

### PITFALL-12: RandomnessAccountData::parse() Failure Handling

**Severity:** HIGH
**Phase Impact:** VRF integration, error handling

**What goes wrong:**
Passing a malformed or fake randomness account to commit/consume. If `RandomnessAccountData::parse()` fails silently or the error isn't properly propagated, the program may proceed with invalid data.

**Why it happens:**
- Account passed as `UncheckedAccount` (not typed)
- Parse result not properly checked
- Anchor constraints don't validate Switchboard account format

**Consequences:**
- Invalid randomness consumed
- Potential for fake randomness injection
- Unpredictable program behavior

**Prevention:**
```rust
let randomness_data = {
    let data = ctx.accounts.randomness_account.try_borrow_data()?;
    RandomnessAccountData::parse(data)
        .map_err(|_| EpochError::RandomnessParseError)?
};
```

**Detection (warning signs):**
- `RandomnessParseError` not in error codes
- Unchecked `.unwrap()` on parse result

**Source:** v3-archive VRF_Implementation_Reference.md Section 3.2

---

## Moderate Pitfalls

Mistakes that cause delays or technical debt but are recoverable.

---

### PITFALL-13: VRF Byte Allocation Mismatch

**Severity:** MEDIUM
**Phase Impact:** VRF integration, tax derivation

**What goes wrong:**
Spec says 6 bytes (tax + Carnage), v3 implementation used 4 bytes (tax only). Mismatch between documentation and implementation causes confusion and bugs.

| Byte | Spec Purpose | v3 Purpose |
|------|-------------|-----------|
| 0 | Flip decision | Pool A buy tax |
| 1 | Low-band magnitude | Pool A sell tax |
| 2 | High-band magnitude | Pool B buy tax |
| 3 | Carnage trigger | Pool B sell tax |
| 4 | Carnage action | (unused) |
| 5 | Carnage buy target | (unused) |

**Why it happens:**
- Spec evolved independently from implementation
- Carnage was not integrated in v3
- "We'll add Carnage later" without updating byte usage

**Prevention:**
1. Maintain single source of truth for VRF byte allocation
2. Update both spec AND implementation when changing
3. Add constants with comments explaining each byte's purpose:
   ```rust
   const VRF_BYTE_FLIP: usize = 0;
   const VRF_BYTE_LOW_MAG: usize = 1;
   const VRF_BYTE_HIGH_MAG: usize = 2;
   const VRF_BYTE_CARNAGE_TRIGGER: usize = 3;
   const VRF_BYTE_CARNAGE_ACTION: usize = 4;
   const VRF_BYTE_CARNAGE_TARGET: usize = 5;
   ```

**Detection (warning signs):**
- Tax rates not matching expected derivation
- Carnage triggering at wrong frequency

**Source:** VRF_Migration_Lessons.md DISC-03

---

### PITFALL-14: Betting and Randomness in Same Transaction

**Severity:** MEDIUM
**Phase Impact:** Client integration, security

**What goes wrong:**
Allowing users to take a position AND receive randomness outcome in the same transaction enables front-running. A validator/builder can simulate outcomes and only include favorable transactions.

**Why it happens:**
- Desire to minimize transaction count
- Not understanding commit-reveal security model
- "It works in tests" mentality

**Prevention:**
1. **Commit-reveal pattern is mandatory:**
   - Commit: Lock in randomness request (no outcome known)
   - Reveal: Receive outcome (position already locked)
2. Tax regime changes happen AFTER reveal, not before
3. Users cannot change positions between commit and reveal

**Detection (warning signs):**
- User trades and epoch transitions in same transaction
- Unusual win rates from specific wallets

**Source:** [Neodyme - Secure Randomness](https://neodyme.io/en/blog/secure-randomness-part-1/), [Adevar Labs - On-Chain Randomness](https://www.adevarlabs.com/blog/on-chain-randomness-on-solana-predictability-manipulation-safer-alternatives-part-1)

---

### PITFALL-15: Carnage Fallback Window MEV Exposure

**Severity:** MEDIUM
**Phase Impact:** Carnage integration, security

**What goes wrong:**
When atomic Carnage execution fails, the 100-slot (~40 second) fallback window creates a known MEV opportunity. Arbitrageurs can front-run the Carnage buy.

**Why it happens:**
- Fallback is necessary for protocol liveness
- Cannot eliminate window entirely
- Trade-off between liveness and MEV protection

**Consequences:**
- Arbitrageurs extract some value during fallback
- Carnage buys less tokens than they would atomically
- Reduced deflation effectiveness

**Prevention:**
1. **Minimize fallback frequency:**
   - Test atomic execution thoroughly on devnet
   - Use two-instruction bundle (VRF + Carnage) for compute headroom
   - Monitor atomic success rate
2. **Accept fallback as rare path:**
   - 100 slots is short
   - Carnage is tax-exempt, arbitrageurs pay taxes
   - Competition compresses MEV profit
3. Monitor fallback usage in production

**Detection (warning signs):**
- Fallback execution rate >5%
- Large trades immediately before Carnage execution

**Source:** Carnage_Fund_Spec.md Section 11.2, Section 16.2

---

### PITFALL-16: Hardcoded Tax Rates During Development

**Severity:** MEDIUM
**Phase Impact:** Tax Program, Epoch integration

**What goes wrong:**
Current Tax Program has hardcoded 4% tax rate:
```rust
// TODO: When Epoch Program exists, deserialize epoch_state and read:
//   - epoch_state.crime_buy_tax_bps (if is_crime)
//   - epoch_state.fraud_buy_tax_bps (if !is_crime)
// For now, use 4% (400 bps) as default
let tax_bps: u16 = 400;
```

Forgetting to replace this with actual EpochState reads after integration.

**Why it happens:**
- Milestone-based development (Tax before Epoch)
- "TODO" comments get forgotten
- Tests pass with hardcoded values

**Prevention:**
1. Add integration tests that verify tax rates change with epochs
2. Search codebase for "TODO" before each milestone completion
3. Create explicit integration checklist:
   - [ ] Tax Program reads crime_buy_tax_bps from EpochState
   - [ ] Tax Program reads crime_sell_tax_bps from EpochState
   - [ ] Tax Program reads fraud_buy_tax_bps from EpochState
   - [ ] Tax Program reads fraud_sell_tax_bps from EpochState

**Detection (warning signs):**
- Tax rates don't change after VRF reveals
- All swaps use same tax rate regardless of epoch

**Source:** Tax Program swap_sol_buy.rs lines 47-54

---

### PITFALL-17: EpochState Account Not Passed to Tax Program

**Severity:** MEDIUM
**Phase Impact:** Tax/Epoch integration

**What goes wrong:**
After implementing Epoch Program, forgetting to update Tax Program instructions to include EpochState account in their accounts struct.

**Why it happens:**
- Tax Program was built before Epoch existed
- Account struct is defined, but epoch_state not added
- Tests mock epoch state differently than production

**Prevention:**
1. Add EpochState to all Tax Program swap instructions:
   ```rust
   #[account(
       seeds = [b"epoch_state"],
       bump,
       seeds::program = EPOCH_PROGRAM_ID,
   )]
   pub epoch_state: Account<'info, EpochState>,
   ```
2. Update client code to derive and pass the account
3. Integration tests must use real Epoch Program

**Detection (warning signs):**
- Tax Program compiles but can't read epoch state at runtime
- Missing account errors in integration tests

---

### PITFALL-18: Staking Cumulative Update Forgotten

**Severity:** MEDIUM
**Phase Impact:** Epoch/Staking integration

**What goes wrong:**
The `consume_randomness` instruction should CPI to Staking Program to update cumulative rewards for the completed epoch. Forgetting this means stakers don't receive yield for completed epochs.

From Epoch_State_Machine_Spec.md Section 8.3:
```rust
// === 2. UPDATE STAKING CUMULATIVE REWARDS ===
// CPI to Staking Program to finalize epoch's yield into cumulative
let update_cpi = CpiContext::new(
    ctx.accounts.staking_program.to_account_info(),
    staking_program::cpi::accounts::UpdateCumulative { ... },
);
staking_program::cpi::update_cumulative(update_cpi)?;
```

**Why it happens:**
- Focus on VRF/tax integration, staking is "separate"
- Staking Program may not exist yet during initial implementation
- CPI is optional-looking but actually required

**Prevention:**
1. Add to consume_randomness implementation checklist
2. Include in integration test: "After epoch advance, cumulative increases"
3. Document as required CPI, not optional

**Detection (warning signs):**
- Staker yield is zero despite epochs passing
- `update_cumulative` never called in transaction logs

---

## Minor Pitfalls

Mistakes that cause annoyance but are easily fixable.

---

### PITFALL-19: Incorrect Event Emission Timing

**Severity:** LOW
**Phase Impact:** Off-chain monitoring

**What goes wrong:**
Events emitted before state changes are confirmed, or with wrong values (e.g., old epoch number instead of new).

**Prevention:**
1. Emit events AFTER state mutations
2. Read values from updated state, not input parameters
3. Test event contents in integration tests

---

### PITFALL-20: Missing Clock Sysvar in Accounts

**Severity:** LOW
**Phase Impact:** Instruction implementation

**What goes wrong:**
Forgetting to include Clock sysvar when timing validation is needed. `Clock::get()` works but explicit account is clearer.

**Prevention:**
1. Use `Clock::get()?` for on-chain reads
2. Document timing dependencies in instruction comments

---

### PITFALL-21: Genesis Slot Not Recorded

**Severity:** LOW
**Phase Impact:** Epoch initialization

**What goes wrong:**
Not storing `genesis_slot` during EpochState initialization. All epoch calculations become wrong.

**Prevention:**
```rust
pub fn initialize_epoch_state(ctx: Context<InitializeEpochState>) -> Result<()> {
    let clock = Clock::get()?;
    epoch_state.genesis_slot = clock.slot;  // MUST record this
    // ...
}
```

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| EpochState account design | PITFALL-09 (resize) | Reserve space, version accounts |
| VRF integration | PITFALL-02, 03, 06, 07, 08, 10, 12 | Follow v3-archive patterns exactly |
| Timeout recovery | PITFALL-04 | Test stuck state recovery |
| Carnage integration | PITFALL-01, 07, 15 | CPI depth audit, compute profiling |
| Tax Program update | PITFALL-16, 17 | Integration tests, cross-program PDAs |
| Client SDK | PITFALL-06, 08, 14 | Three-TX flow, retry logic |
| Staking integration | PITFALL-18 | Include CPI in consume_randomness |

---

## VRF-Specific Attack Summary

| Attack | Description | Prevention |
|--------|-------------|------------|
| Reroll | Substitute different randomness account | Bind account at commit, verify at consume (PITFALL-02) |
| Pre-generation | Use pre-revealed randomness | Freshness + already-revealed checks (PITFALL-03) |
| Front-running | Trade before known outcome | Commit-reveal separation enforced (PITFALL-14) |
| Oracle collusion | Oracle + validator collude | Switchboard SGX TEE, multi-oracle attestation |
| Timeout exploitation | Deliberately timeout to delay | Permissionless retry after timeout (PITFALL-04) |
| Fake randomness | Pass non-Switchboard account | Parse validation (PITFALL-12) |

---

## Integration with Existing System

This milestone adds to an existing CPI chain. Key integration points:

### Tax Program -> Epoch Program
- Tax Program must read EpochState for current tax rates
- Cross-program PDA validation required (PITFALL-11)
- Hardcoded rates must be replaced (PITFALL-16)

### Epoch Program -> Tax Program (Carnage)
- swap_exempt instruction for tax-free Carnage swaps
- Carnage PDA as signer
- CPI depth already at limit (PITFALL-01)

### Epoch Program -> Staking Program
- update_cumulative CPI at epoch transition
- Must happen in consume_randomness (PITFALL-18)

### Epoch Program -> Switchboard
- NO CPI to Switchboard (On-Demand is client-side)
- Only reads passed-in randomness account

---

## Verification Checklist

Before each phase completion:

- [ ] CPI depth traced end-to-end for all paths (max 4)
- [ ] Anti-reroll protection verified (account binding)
- [ ] Stale randomness checks in place
- [ ] Timeout recovery tested
- [ ] Compute budgets profiled on devnet
- [ ] Cross-program PDA validation uses correct program IDs
- [ ] Three-transaction VRF flow documented and tested
- [ ] Fallback paths tested for all failure modes
- [ ] Hardcoded tax rates replaced with EpochState reads
- [ ] Staking cumulative update included in consume_randomness

---

## Sources

**HIGH Confidence (Official/v3-archive):**
- [Solana CPI Documentation](https://solana.com/docs/core/cpi)
- v3-archive: VRF_Migration_Lessons.md, VRF_Implementation_Reference.md
- Epoch_State_Machine_Spec.md, Carnage_Fund_Spec.md, Transfer_Hook_Spec.md
- Tax Program: swap_sol_buy.rs (hardcoded rate reference)

**MEDIUM Confidence (Verified with v3-archive):**
- [Switchboard Documentation](https://docs.switchboard.xyz/)
- [Solana Transfer Hook Guide](https://solana.com/developers/guides/token-extensions/transfer-hook)

**Supporting Research:**
- [Neodyme - Secure Randomness](https://neodyme.io/en/blog/secure-randomness-part-1/)
- [Adevar Labs - On-Chain Randomness](https://www.adevarlabs.com/blog/on-chain-randomness-on-solana-predictability-manipulation-safer-alternatives-part-1)
- [Chainstack - Solana Block Time](https://docs.chainstack.com/docs/solana-understanding-block-time)
- [GitHub Issue #9874 - Clock Drift](https://github.com/solana-labs/solana/issues/9874)
