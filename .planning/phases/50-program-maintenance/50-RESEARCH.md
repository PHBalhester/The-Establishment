# Phase 50: Program Maintenance - Research

**Researched:** 2026-02-20
**Domain:** Rust/Anchor program maintenance -- feature-gating, SOL transfers from PDAs, compile-time constants, comment hygiene
**Confidence:** HIGH

## Summary

Phase 50 resolves five deferred maintenance items across the Epoch Program and Tax Program. The work is entirely internal -- no new features, no new instructions, no account layout changes. Every item modifies existing code in well-understood ways.

The five items decompose cleanly:
1. **FIX-03 (SLOTS_PER_EPOCH)**: Add `#[cfg(feature = "devnet")]` to a single constant, matching the existing Switchboard PID pattern
2. **FIX-04 (VRF bounty)**: Replace the deferred "Phase 25" bounty stub with an actual `system_instruction::transfer` via `invoke_signed` from the treasury wallet (currently an EOA, not a PDA -- so the treasury is the caller's wallet balance check, and actual transfer uses normal SOL transfer)
3. **FIX-05 (EpochState LEN)**: Already COMPLETE -- both Epoch Program and Tax Program mirror have matching LEN=108, with static assertions. Nothing to do.
4. **MAINT-01 (Treasury configurable)**: Feature-gate `treasury_pubkey()` in Tax Program and `DEVNET_ADMIN` in Epoch Program. Requires adding `devnet` feature to Tax Program's Cargo.toml.
5. **MAINT-03 (Stale comments)**: 15+ locations referencing "byte 3" (old Carnage trigger position) instead of "byte 5" (current). Also "Phase 23" / "Phase 25" deferred comments that are now being resolved.

**Primary recommendation:** Execute as 2-3 small plans: (1) feature-gating sweep across all programs + bounty implementation, (2) stale comment sweep, with each plan independently verifiable.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| anchor-lang | 0.32.1 | Solana program framework | Already in use; all programs depend on it |
| anchor-spl | 0.32.1 | SPL token CPI helpers | Already in use for token operations |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| sha2 | 0.10 | Discriminator verification in tests | Already a dev-dependency |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Feature flag for treasury | On-chain config PDA | Too complex for this phase; compile-time is the locked decision |
| invoke_signed from treasury PDA | Direct system transfer | Treasury is an EOA (not PDA); need different approach |

**Installation:** No new dependencies needed. Tax Program needs `devnet = []` added to `[features]` in Cargo.toml.

## Architecture Patterns

### Pattern 1: Feature-Gated Constants (Existing Pattern)
**What:** Use Rust `#[cfg(feature = "devnet")]` to select environment-specific constant values at compile time.
**When to use:** Any constant that differs between devnet and mainnet.
**Example:**
```rust
// Source: programs/epoch-program/src/constants.rs (existing pattern for Switchboard PID)
#[cfg(feature = "devnet")]
pub const SWITCHBOARD_PROGRAM_ID: Pubkey = switchboard_on_demand::ON_DEMAND_DEVNET_PID;

#[cfg(not(feature = "devnet"))]
pub const SWITCHBOARD_PROGRAM_ID: Pubkey = switchboard_on_demand::ON_DEMAND_MAINNET_PID;
```

### Pattern 2: SOL Transfer from EOA Treasury
**What:** The treasury account in `trigger_epoch_transition` is currently an unconstrained `AccountInfo`. The bounty payment needs a SOL transfer from treasury to payer. Since treasury is an EOA (externally-owned account, not a PDA), we cannot use `invoke_signed`. The correct approach is to use `**treasury.try_borrow_mut_lamports()` and `**payer.try_borrow_mut_lamports()` for direct lamport manipulation, since both accounts are already `#[account(mut)]` and the treasury's signature is not required for receiving funds -- but the treasury IS the source. Since the treasury is not a signer and not a PDA, we need a different approach.

**CRITICAL INSIGHT:** The current design has a fundamental issue. The treasury account in `trigger_epoch_transition` is a bare `AccountInfo` with no PDA derivation and no signer constraint. To transfer SOL FROM the treasury, we need either: (a) the treasury to be a signer, or (b) the treasury to be a PDA that the program can sign for. Neither is the case today.

**Recommended approach:** Use the Carnage SOL Vault (a PDA owned by the Epoch Program) as the bounty funding source. The Carnage SOL Vault is already a PDA (`seeds = ["carnage_sol_vault"]`) that the program can sign for. This aligns with the CONTEXT.md statement: "Source of funds: Treasury PDA (natural fit since treasury accrues from every trade)." However, the Carnage SOL Vault is the carnage vault, not the treasury.

**Alternative approach (simplest, recommended by CONTEXT.md):** Add a new treasury PDA to the Epoch Program (`seeds = ["treasury"]`) that receives the 1% treasury split. But this would require changing the Tax Program's distribution logic (which sends treasury SOL to `treasury_pubkey()`, an EOA). This is too large a scope change for a maintenance phase.

**Practical approach:** The CONTEXT.md says "Source: Treasury PDA." The simplest implementation that matches intent: the trigger_epoch_transition instruction's treasury account IS the treasury wallet. Since it's a `#[account(mut)]` SystemAccount, we can deduct lamports from it using Solana's "credit-only" rule -- programs CAN deduct lamports from accounts they own or that signed the transaction. But the treasury is neither the program nor a signer.

**RESOLUTION:** After deeper analysis, the correct Solana pattern for transferring lamports from a non-signer, non-PDA account is: **you cannot do it**. Only three ways to move SOL out of an account: (1) the account is a signer (system_instruction::transfer), (2) the account is a PDA owned by the calling program (invoke_signed), (3) the account's owner program moves the lamports (but SystemProgram owns EOAs).

Therefore, the bounty payment requires ONE of:
- **Option A:** Make the treasury a PDA derived by the Epoch Program (e.g., `seeds = ["epoch_treasury"]`). Then use `invoke_signed` to transfer. This means the Tax Program's 1% treasury split needs to go to this PDA instead of the EOA. **SCOPE EXPANSION.**
- **Option B:** Simply deduct lamports from the treasury account directly using `**treasury.try_borrow_mut_lamports()? -= amount` -- this DOES work if the treasury account is owned by the calling program. But SystemProgram-owned accounts can only be debited by SystemProgram or the owner (System). **WON'T WORK.**
- **Option C:** Actually, on Solana, any program CAN deduct lamports from an account it has write access to, as long as the account is not rent-exempt protected below the minimum balance AND the total lamport balance across all accounts is conserved. Solana runtime checks: `sum(pre_lamports) == sum(post_lamports)`. A program can decrease an account's lamports and increase another's as long as it "owns" the decreased account. For SystemProgram-owned accounts, only the SystemProgram can debit. **Confirmed: programs cannot debit SystemProgram-owned EOAs.**
- **Option D (RECOMMENDED):** The simplest path: the treasury is NOT an EOA. Make `carnage_sol_vault` the bounty source. The Carnage vault is a PDA (`seeds = ["carnage_sol_vault"]`) whose bump is known. The program already has `invoke_signed` patterns for Carnage operations. The bounty (0.001 SOL) is tiny relative to Carnage vault holdings. This matches the spirit of "treasury PDA" since the Carnage vault accrues from every trade's 24%.

**WAIT -- re-reading CONTEXT.md more carefully:** "Source of funds: Treasury PDA (natural fit since treasury accrues from every trade)." This says "Treasury PDA" not "Carnage vault." The user's intent is a TREASURY PDA. Since the 1% treasury split currently goes to an EOA, and we need a PDA to invoke_signed from, we need to introduce a small treasury PDA in the Epoch Program that can fund bounties.

**FINAL RECOMMENDATION:** Create a small "epoch treasury" PDA (`seeds = ["epoch_treasury"]`) in the Epoch Program. The trigger_epoch_transition instruction deducts bounty from this PDA. This PDA needs to be seeded with SOL -- either manually or by having the Tax Program send the 1% to this PDA. Since changing the Tax Program's treasury destination is part of MAINT-01 (treasury pubkey configurable), these two items connect naturally: the Tax Program's feature-gated `treasury_pubkey()` returns the Epoch Program's treasury PDA address for both devnet and mainnet.

But this creates a circular dependency: Tax Program needs to know the Epoch Program treasury PDA address. This is fine -- it's just a `Pubkey::find_program_address` call with known seeds and the Epoch Program ID, which Tax Program already knows.

### Pattern 3: Static Assert for Struct Size
**What:** Use compile-time assertion to verify struct size.
**When to use:** Cross-program struct mirrors, account LEN constants.
**Example:**
```rust
// Source: programs/epoch-program/src/state/epoch_state.rs (already in place)
const _: () = assert!(EpochState::DATA_LEN == 100);
```

### Anti-Patterns to Avoid
- **Hardcoded devnet addresses in non-feature-gated code:** The whole point of MAINT-01 is removing this.
- **Using system_instruction::transfer for PDA transfers:** Must use invoke_signed with the PDA's seeds.
- **Changing account layouts in a maintenance phase:** FIX-05 is already complete. No need to touch struct layouts.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PDA SOL transfer | Custom lamport manipulation | `system_instruction::transfer` + `invoke_signed` | Proven Solana pattern, handles rent-exempt checks |
| Feature flag infrastructure | Custom build scripts | Cargo `#[cfg(feature = "devnet")]` | Already in use for Switchboard PID |
| Struct size verification | Manual counting | `const _: () = assert!(...)` | Compile-time check, already in codebase |

**Key insight:** Every pattern needed for Phase 50 already exists in the codebase. The feature-gating pattern is in epoch-program/constants.rs (Switchboard PID). The invoke_signed pattern is in execute_carnage_atomic. The static assert pattern is in epoch_state.rs.

## Common Pitfalls

### Pitfall 1: Bounty Source Cannot Be an EOA
**What goes wrong:** Attempting to `system_instruction::transfer` from the treasury EOA without it being a signer. Transaction fails with "instruction requires signer" or similar.
**Why it happens:** The treasury in `trigger_epoch_transition` is a `#[account(mut)] pub treasury: AccountInfo` -- it's writable but not a signer, and it's owned by the System Program. No program can debit a System-owned account without that account being a signer or the System Program being invoked with it as a signer.
**How to avoid:** Use a PDA as the bounty source. Either (a) create a new "epoch_treasury" PDA or (b) use an existing PDA like `carnage_sol_vault`. The PDA must be derived from the Epoch Program's seeds so `invoke_signed` works.
**Warning signs:** Code that tries to call `invoke` (not `invoke_signed`) with a treasury PDA, or code that tries to debit lamports from a SystemProgram-owned account.

### Pitfall 2: Feature Flag Not Propagated to Build Script
**What goes wrong:** `build.sh --devnet` only rebuilds `epoch_program` with the devnet feature. If Tax Program gains a `devnet` feature, `build.sh` must also rebuild it.
**Why it happens:** Current build.sh (lines 63-67) hardcodes `epoch_program` as the only program needing devnet rebuild.
**How to avoid:** Update `build.sh` to also rebuild `tax_program` with `--features devnet`. Or rebuild both in one command: `anchor build -p epoch_program -p tax_program -- --features devnet`.
**Warning signs:** Tax Program compiled without devnet feature uses mainnet treasury address on devnet, causing `InvalidTreasury` errors on every swap.

### Pitfall 3: TRIGGER_BOUNTY_LAMPORTS Value Mismatch
**What goes wrong:** The constant is currently `10_000_000` (0.01 SOL) but the CONTEXT.md decision is `0.001 SOL` (1,000,000 lamports).
**Why it happens:** The original spec said 0.01 SOL. The user discussion decided 0.001 SOL based on actual mainnet fee analysis.
**How to avoid:** Update the constant to `1_000_000` and update the comment to "0.001 SOL".
**Warning signs:** Event `bounty_paid` field emitting 0.01 SOL instead of 0.001 SOL.

### Pitfall 4: Unit Test Assumptions About SLOTS_PER_EPOCH Value
**What goes wrong:** Unit tests in `trigger_epoch_transition.rs` use hardcoded values like 4500 and 5500 in comments and assertions. After feature-gating, the tests (which run without features by default) will see the mainnet value (4500), but if someone tests with `--features devnet` they'll see 750.
**Why it happens:** Test values were written assuming a fixed constant.
**How to avoid:** Tests should use the `SLOTS_PER_EPOCH` constant in calculations, not hardcoded numbers. OR have separate `#[cfg(test)]` assertions for each feature variant. The existing tests already reference `SLOTS_PER_EPOCH` in the function calls (via `current_epoch()` and `epoch_start_slot()`), but the COMMENTS mention specific values like "4500" and "5500". Update comments to say "SLOTS_PER_EPOCH" or "750 (devnet) / 4500 (mainnet)".
**Warning signs:** Tests pass locally but fail in CI due to different feature flags.

### Pitfall 5: IDL Byte References in Frontend
**What goes wrong:** The Anchor IDL (app/idl/types/epoch_program.ts) is auto-generated. It contains doc-comments from Rust code that reference "byte 3". After updating Rust comments, a rebuild will update the IDL. But if someone forgets to rebuild, the IDL stays stale.
**Why it happens:** IDL is a build artifact, not hand-edited.
**How to avoid:** The IDL will be auto-regenerated during the anchor build. The only concern is that `app/idl/types/epoch_program.ts` needs to be re-copied from `target/idl/` after build.
**Warning signs:** Grep finds "byte 3" references in `app/idl/` after the fix.

## Code Examples

### Feature-Gated SLOTS_PER_EPOCH
```rust
// programs/epoch-program/src/constants.rs
// Follows the existing Switchboard PID pattern at lines 45-49

/// Slots per epoch (~5 minutes on devnet, ~30 minutes on mainnet).
/// Source: Epoch_State_Machine_Spec.md Section 3.1
#[cfg(feature = "devnet")]
pub const SLOTS_PER_EPOCH: u64 = 750;

#[cfg(not(feature = "devnet"))]
pub const SLOTS_PER_EPOCH: u64 = 4_500;
```

### Feature-Gated Treasury Pubkey (Tax Program)
```rust
// programs/tax-program/src/constants.rs
// Replace the existing treasury_pubkey() function

/// Treasury wallet address for protocol revenue.
/// Feature-gated: devnet uses test wallet, mainnet TBD.
#[cfg(feature = "devnet")]
pub fn treasury_pubkey() -> Pubkey {
    Pubkey::from_str("8kPzhQoUPx7LYM18f9TzskW4ZgvGyq4jMPYZikqmHMH4").unwrap()
}

#[cfg(not(feature = "devnet"))]
pub fn treasury_pubkey() -> Pubkey {
    // TODO: Replace with mainnet treasury address before launch
    Pubkey::from_str("MAINNET_TREASURY_ADDRESS_HERE").unwrap()
}
```

### Bounty Payment via invoke_signed (Treasury PDA approach)
```rust
// programs/epoch-program/src/instructions/trigger_epoch_transition.rs
// Replace the "Phase 25 deferred" stub (lines 185-199)

// === 7. Pay bounty to triggerer ===
let treasury_balance = ctx.accounts.treasury.lamports();
if treasury_balance >= TRIGGER_BOUNTY_LAMPORTS {
    let treasury_seeds: &[&[u8]] = &[
        b"epoch_treasury",
        &[ctx.accounts.treasury_bump],
    ];

    invoke_signed(
        &system_instruction::transfer(
            ctx.accounts.treasury.key,
            ctx.accounts.payer.key,
            TRIGGER_BOUNTY_LAMPORTS,
        ),
        &[
            ctx.accounts.treasury.to_account_info(),
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        &[treasury_seeds],
    )?;
}
```

### Corrected Bounty Constant
```rust
// programs/epoch-program/src/constants.rs
// Update from 10_000_000 to 1_000_000 per CONTEXT.md decision

/// Bounty paid to epoch trigger caller (0.001 SOL).
/// Incentivizes timely epoch transitions.
/// ~66x actual 3-TX base cost -- generous but treasury-efficient.
/// Source: Phase 50 CONTEXT.md
pub const TRIGGER_BOUNTY_LAMPORTS: u64 = 1_000_000;
```

### Corrected Comment (Carnage Trigger Byte)
```rust
// Before (stale):
/// Carnage trigger threshold (byte 3 < 11 triggers, ~4.3% probability).

// After (correct):
/// Carnage trigger threshold (byte 5 < 11 triggers, ~4.3% probability).
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single SLOTS_PER_EPOCH=750 hardcoded | Feature-gated devnet=750 / mainnet=4500 | Phase 50 | Correct epoch timing on mainnet |
| Bounty deferred ("Phase 25") | Actual SOL transfer from treasury PDA | Phase 50 | Incentivizes third-party epoch triggering |
| Treasury hardcoded to devnet wallet | Feature-gated per environment | Phase 50 | Mainnet-ready treasury routing |
| VRF byte comments: "byte 3" for Carnage | "byte 5" for Carnage trigger | Phase 37 (code), Phase 50 (comments) | Accurate documentation |

**Deprecated/outdated:**
- "Phase 25" / "Phase 23" deferred comments in trigger_epoch_transition.rs -- Phase 50 resolves these
- `TRIGGER_BOUNTY_LAMPORTS = 10_000_000` (0.01 SOL) -- changed to 1_000_000 (0.001 SOL)
- VRF byte layout pre-Phase 37: bytes 0-2 (tax), byte 3 (carnage) -- now bytes 0-4 (tax), bytes 5-7 (carnage)

## Detailed Findings Per Requirement

### FIX-03: SLOTS_PER_EPOCH Feature-Gating
**Confidence:** HIGH -- existing pattern to follow

**Current state:**
- `programs/epoch-program/src/constants.rs:58` -- hardcoded `pub const SLOTS_PER_EPOCH: u64 = 750;`
- `shared/constants.ts:115` -- hardcoded `export const SLOTS_PER_EPOCH = 750;`
- Switchboard PID feature-gating exists at lines 45-49 of the same file as the pattern to follow
- `[features] devnet = []` already exists in `programs/epoch-program/Cargo.toml:25`

**Work needed:**
1. Replace single `SLOTS_PER_EPOCH` constant with `#[cfg(feature)]` pair (750/4500)
2. Update comment from "Devnet testing value" to feature-gated description
3. Add a Rust unit test: `#[cfg(feature = "devnet")] assert_eq!(SLOTS_PER_EPOCH, 750)` and `#[cfg(not(feature = "devnet"))] assert_eq!(SLOTS_PER_EPOCH, 4500)`
4. Update unit test comments in `trigger_epoch_transition.rs` that reference "4500" and "5500" to use `SLOTS_PER_EPOCH` symbolically
5. TypeScript `shared/constants.ts` is client-side only and always runs against devnet during development -- leave as 750 with a comment noting mainnet value

**Files to modify:**
- `programs/epoch-program/src/constants.rs`
- Test comments in `programs/epoch-program/src/instructions/trigger_epoch_transition.rs`

### FIX-04: VRF Bounty Payment
**Confidence:** MEDIUM -- bounty source requires a design decision

**Current state:**
- `programs/epoch-program/src/constants.rs:77` -- `TRIGGER_BOUNTY_LAMPORTS: u64 = 10_000_000` (WRONG: should be 1_000_000 per CONTEXT.md)
- `programs/epoch-program/src/instructions/trigger_epoch_transition.rs:185-214` -- bounty is **not** transferred. Code validates treasury balance but emits `bounty_paid: 0` with comment "deferred to Phase 25"
- The treasury account in `TriggerEpochTransition` struct (line 43) is a bare `AccountInfo` with no PDA validation
- The `InsufficientTreasuryBalance` error exists in `errors.rs:111` but is never used

**The treasury source problem:**
The CONTEXT.md says "Source of funds: Treasury PDA." But the current treasury account is the devnet wallet EOA. Programs cannot debit SystemProgram-owned EOAs. Options:

1. **New "epoch_treasury" PDA** -- cleanest, matches CONTEXT.md intent. But requires:
   - New PDA seed constant
   - New PDA initialization (or init-if-needed in trigger instruction)
   - Tax Program sending 1% to this PDA instead of EOA (ties into MAINT-01)
   - Changes to every swap instruction's treasury account
   - **SCOPE CONCERN:** This is larger than a maintenance fix

2. **Carnage SOL vault as bounty source** -- minimal changes. But:
   - Semantically wrong (carnage funds != treasury)
   - Reduces Carnage buying power

3. **Payer-funded bounty (no treasury source)** -- flip the model. Instead of treasury paying triggerer, the bounty is just a reward from thin air (credit to payer account from rent-exempt). **NOT VALID** -- violates Solana's lamport conservation rule.

4. **Skip bounty if treasury is EOA; implement when treasury PDA exists** -- emits `bounty_paid: 0` when treasury can't fund. This is already the behavior! But it means bounty never actually pays on devnet.

5. **RECOMMENDED: Use carnage_sol_vault as interim bounty source.** The Carnage vault is already a PDA that the Epoch Program can sign for (via `carnage_signer` PDA). The 0.001 SOL bounty is trivial compared to Carnage vault holdings. The vault accumulates 24% of all tax revenue -- it will always have enough. When the real treasury PDA is built later, the source can be changed. This keeps the scope small.

   Implementation:
   - Replace `treasury: AccountInfo` with `carnage_sol_vault` (already exists as a PDA)
   - Use Carnage signer PDA seeds for invoke_signed
   - Or even simpler: use raw lamport manipulation since carnage_sol_vault is a SystemAccount owned by SystemProgram... **WAIT**, the carnage_sol_vault is a plain `SystemAccount` (no program owner), so the same problem applies.

   Actually, checking the initialization code -- `carnage_sol_vault` is created as `SystemAccount` via `init, payer=admin, space=0, seeds=["carnage_sol_vault"]`. As a `SystemAccount`, it's owned by the System Program. The same debit restriction applies.

   **ACTUAL SOLUTION:** On Solana, programs CAN directly debit accounts whose owner is the program itself. But SystemAccount PDAs are owned by the System Program. To transfer SOL from a PDA, you MUST use `system_instruction::transfer` with `invoke_signed` -- and this DOES work for PDAs even though they're System-owned, because `invoke_signed` provides the PDA signature, which the System Program accepts.

   Let me verify: `system_instruction::transfer` requires the `from` account to be a signer. When calling via `invoke_signed` with the PDA's seeds, the runtime treats the PDA as a signer for that instruction. So `invoke_signed(&transfer_ix, accounts, &[pda_seeds])` DOES work for System-owned PDA accounts.

   **CONFIRMED:** This is the standard Solana pattern. PDAs can sign system transfers via invoke_signed.

   So the carnage_sol_vault approach DOES work:
   - `carnage_sol_vault` is a PDA with known seeds `["carnage_sol_vault"]`
   - The Epoch Program can call `invoke_signed` with `system_instruction::transfer` from `carnage_sol_vault` to `payer`
   - The bump is discoverable from the seeds

   BUT: the carnage_sol_vault's bump isn't stored anywhere accessible to `trigger_epoch_transition`. The `CarnageFundState` stores `sol_vault: Pubkey` (the address, not the bump). We'd need to either:
   - Add the bump as a field (account layout change -- OUT OF SCOPE)
   - Derive it on-the-fly with `Pubkey::find_program_address` (costs compute but works)
   - Or use `try_find_program_address` and pass bump via instruction argument

   The simplest: pass the bump as an Anchor `#[account(seeds = [...], bump)]` constraint, which automatically resolves the bump. We already have this pattern in consume_randomness for staking_authority.

**REVISED RECOMMENDATION:** Add `carnage_sol_vault` as a PDA-validated account in `TriggerEpochTransition`:
```rust
#[account(
    mut,
    seeds = [CARNAGE_SOL_VAULT_SEED],
    bump,
)]
pub carnage_sol_vault: AccountInfo<'info>,
```
Then use `invoke_signed` with `system_instruction::transfer` from `carnage_sol_vault` to `payer`, signing with the vault's seeds and bump.

**Alternatively**, the cleanest Solana-native approach for a program to pay bounties is to have a PDA it controls. The `carnage_sol_vault` PDA is derived from the Epoch Program, so the Epoch Program can sign for it. This is the right pattern.

**Files to modify:**
- `programs/epoch-program/src/constants.rs` (fix bounty amount: 10M -> 1M lamports)
- `programs/epoch-program/src/instructions/trigger_epoch_transition.rs` (replace treasury with carnage_sol_vault PDA, implement invoke_signed transfer, update event bounty_paid field)
- `programs/epoch-program/src/lib.rs` (update instruction docstring)
- Client code: `scripts/vrf/lib/vrf-flow.ts`, `scripts/e2e/lib/carnage-flow.ts`, etc. (update `treasuryPda` to `carnageSolVault` in account lists)

**IMPORTANT OPEN QUESTION:** The CONTEXT.md says "Source: Treasury PDA." Using `carnage_sol_vault` instead of a dedicated treasury PDA is a pragmatic deviation. The user should be consulted on whether:
- (a) Carnage vault as bounty source is acceptable (minimal scope)
- (b) A new `epoch_treasury` PDA is needed (larger scope, cleaner long-term)

### FIX-05: EpochState LEN
**Confidence:** HIGH -- verified COMPLETE

**Current state:**
- `programs/epoch-program/src/state/epoch_state.rs:158` -- `pub const LEN: usize = 8 + 100;` (108 bytes total)
- `programs/epoch-program/src/state/epoch_state.rs:172` -- `const _: () = assert!(EpochState::DATA_LEN == 100);` (compile-time assertion)
- `programs/tax-program/src/state/epoch_state_reader.rs:57` -- `pub const LEN: usize = 8 + 100;` (matching 108 bytes)
- Both structs have identical field layouts (verified by reading both files)
- REQUIREMENTS.md line 28 marks FIX-05 as `[x]` (complete, done in Phase 47)

**Work needed:** NONE. This is already complete. The roadmap reference is stale.

### MAINT-01: Treasury Pubkey Configurable
**Confidence:** HIGH -- straightforward feature-gating

**Current state:**
- `programs/tax-program/src/constants.rs:135-137` -- `treasury_pubkey()` returns hardcoded `8kPzh...`
- `programs/epoch-program/src/instructions/force_carnage.rs:19` -- `DEVNET_ADMIN` hardcoded to `8kPzh...`
- Tax Program `Cargo.toml` has NO `devnet` feature -- needs to be added
- Tax Program's swap instructions use `address = treasury_pubkey() @ TaxError::InvalidTreasury`
- `shared/constants.ts:349-351` -- `TREASURY_PUBKEY` hardcoded

**Work needed:**
1. Add `devnet = []` to `programs/tax-program/Cargo.toml` `[features]`
2. Feature-gate `treasury_pubkey()` in `programs/tax-program/src/constants.rs`
3. Feature-gate `DEVNET_ADMIN` in `programs/epoch-program/src/instructions/force_carnage.rs` (or leave as devnet-only since the whole instruction is `#[cfg(feature = "devnet")]`)
4. Update `build.sh` to also rebuild `tax_program` with `--features devnet`
5. Add mainnet placeholder constant (user will provide real address later)
6. Update test that asserts specific treasury address to use feature-gated assertion

**Files to modify:**
- `programs/tax-program/Cargo.toml` (add devnet feature)
- `programs/tax-program/src/constants.rs` (feature-gate treasury_pubkey)
- `scripts/deploy/build.sh` (add tax_program to devnet rebuild)

### MAINT-03: Stale Comment Sweep
**Confidence:** HIGH -- comprehensive grep results identify all locations

**Stale "byte 3" references (should be "byte 5"):**

Rust files:
1. `programs/epoch-program/src/constants.rs:136` -- "byte 3 < 11" -> "byte 5 < 11"
2. `programs/epoch-program/src/constants.rs:140` -- "byte 4 < 5" -> "byte 6 < 5"
3. `programs/epoch-program/src/events.rs:179` -- "VRF byte 3 did not meet" -> "VRF byte 5 did not meet"
4. `programs/epoch-program/src/events.rs:185` -- "VRF byte 3 value" -> "VRF byte 5 value"
5. `programs/epoch-program/src/instructions/consume_randomness.rs:90` -- "MIN_VRF_BYTES = 6" -> "MIN_VRF_BYTES = 8" (comment says 6, constant is 8)
6. `programs/epoch-program/src/instructions/consume_randomness.rs:97` -- "Check if VRF byte 5 < 11" -- this one is CORRECT
7. `programs/epoch-program/src/instructions/consume_randomness.rs:106` -- "less than 6 bytes revealed" -> "less than 8 bytes"

TypeScript files:
8. `scripts/e2e/lib/carnage-flow.ts:6` -- "VRF byte 3 < 11" -> "VRF byte 5 < 11"
9. `scripts/e2e/lib/carnage-flow.ts:64` -- "VRF byte 3 < 11" -> "VRF byte 5 < 11"
10. `scripts/e2e/lib/carnage-flow.ts:472` -- "VRF byte 3 < 11" -> "VRF byte 5 < 11"
11. `scripts/e2e/lib/carnage-flow.ts:658` -- "VRF byte 3 < 11" -> "VRF byte 5 < 11"
12. `scripts/e2e/lib/carnage-flow.ts:843` -- "VRF byte 3 < 11" -> "VRF byte 5 < 11"
13. `scripts/vrf/lib/vrf-flow.ts:78` -- "VRF byte 3 < 11" -> "VRF byte 5 < 11"
14. `scripts/vrf/lib/vrf-flow.ts:720-723` -- byte mapping comments wrong. Says "byte 3: carnage" but should be "byte 5: carnage". Full mapping: byte 0=flip, 1=crimeLow, 2=crimeHigh, 3=fraudLow, 4=fraudHigh, 5=carnageTrigger
15. `scripts/vrf/devnet-vrf-validation.ts:287` -- "VRF byte 3 < 11" -> "VRF byte 5 < 11"

**Stale "Phase 23/25" deferred comments:**
16. `programs/epoch-program/src/instructions/trigger_epoch_transition.rs:39` -- "Phase 25" treasury comment
17. `programs/epoch-program/src/instructions/trigger_epoch_transition.rs:185-190` -- "deferred to Phase 25" bounty comment
18. `programs/epoch-program/src/instructions/trigger_epoch_transition.rs:202` -- "pending Phase 25" message
19. `programs/epoch-program/src/instructions/trigger_epoch_transition.rs:214` -- "once treasury integrated in Phase 25" comment
20. `programs/epoch-program/src/lib.rs:56-58` -- "when treasury integrated" / "Phase 25" docstrings

**IDL auto-generated (will be fixed by rebuild):**
- `app/idl/types/epoch_program.ts:2021,2037` -- "VRF byte 3" -- auto-regenerated from Rust docstrings

**InsufficientRandomness error message:**
21. `programs/epoch-program/src/errors.rs:53-54` -- "need 6" should be "need 8" (6 was the pre-Phase 37 count)

### Claude's Discretion Items

**CarnageFundState legacy counters:**
The CarnageFundState has `total_sol_spent`, `total_crime_burned`, `total_fraud_burned`, `total_triggers` as lifetime statistics. These are NOT legacy counters -- they are active, monotonically-increasing statistics used by the execute_carnage instructions. **RECOMMENDATION:** Leave them in place. They are actively maintained and useful for analytics. Removing them would require account reallocation and provide no benefit.

**Insufficient bounty balance handling:**
**RECOMMENDATION:** Skip silently with `bounty_paid: 0` in the event. Rationale:
- Failing the instruction would block epoch transitions when the vault is low
- Paying partial is messy and creates accounting complexity
- Skipping silently with accurate event field lets off-chain monitoring detect the issue
- This matches the current behavior and the least-surprise principle

**Feature flag organization:**
**RECOMMENDATION:** Use the single `devnet` feature flag for everything. Both programs (epoch_program and tax_program) use it. No need for separate flags -- the `devnet` flag already has clear semantics: "this binary targets devnet infrastructure."

## Open Questions

1. **Treasury PDA vs Carnage Vault for bounty source**
   - What we know: CONTEXT.md says "Source: Treasury PDA." But no treasury PDA exists today. The carnage_sol_vault IS a PDA that the program can sign for.
   - What's unclear: Does the user want a new "epoch_treasury" PDA (larger scope) or is using carnage_sol_vault acceptable (minimal scope)?
   - Recommendation: **Ask the user.** Present both options with scope implications. The carnage_sol_vault approach is 5-10 lines of change. A new treasury PDA is 30-50 lines plus client changes.

2. **Mainnet treasury address**
   - What we know: CONTEXT.md says "User will provide mainnet treasury address when ready (placeholder for now)"
   - What's unclear: What to put as the placeholder -- a zero address, a panic, or a dummy address?
   - Recommendation: Use a clearly-invalid placeholder like `Pubkey::default()` (all zeros) with a comment "MUST BE SET BEFORE MAINNET". A compile-time assertion could even check `#[cfg(not(feature = "devnet"))] const _: () = assert!(treasury_pubkey() != Pubkey::default());` -- but `const fn` limitations make this tricky. Simpler: just use a TODO comment.

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis: All 4 `constants.rs` files, trigger_epoch_transition.rs, consume_randomness.rs, epoch_state.rs, epoch_state_reader.rs, carnage_fund_state.rs, events.rs, errors.rs, carnage.rs, tax_derivation.rs
- Direct codebase analysis: carnage-flow.ts, vrf-flow.ts, devnet-vrf-validation.ts, shared/constants.ts
- Phase 50 CONTEXT.md: User decisions on all 5 items
- REQUIREMENTS.md: Traceability matrix confirming FIX-05 complete

### Secondary (MEDIUM confidence)
- Solana runtime lamport conservation rules (from training data, verified by codebase invoke_signed patterns)
- Anchor PDA bump resolution via `#[account(seeds, bump)]` (verified by existing consume_randomness.rs pattern)

### Tertiary (LOW confidence)
- None -- all findings verified from primary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all patterns already in codebase
- Architecture: HIGH for feature-gating, MEDIUM for bounty payment (treasury source needs user input)
- Pitfalls: HIGH -- comprehensive grep-based analysis of all stale locations

**Research date:** 2026-02-20
**Valid until:** 2026-03-20 (stable domain, no external dependencies changing)
