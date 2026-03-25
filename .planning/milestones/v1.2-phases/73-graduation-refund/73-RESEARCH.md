# Phase 73: Graduation + Refund - Research

**Researched:** 2026-03-04
**Domain:** Solana/Anchor on-chain state machine (graduation/failure paths), Token-2022 burn, proportional refund math, SOL PDA transfers, slot-based timing
**Confidence:** HIGH

## Summary

Phase 73 implements the bonding curve state machine for success (graduation) and failure (refund) paths. The phase delivers 5 new instructions: `mark_failed`, `consolidate_for_refund`, `claim_refund`, `prepare_transition`, and `distribute_tax_escrow`. The codebase is exceptionally well-prepared: all events, most error codes, the `is_refund_eligible()` helper, and the state enum are already implemented from Phase 71/72. The CurveState struct needs a single field addition (`escrow_consolidated: bool`, changing LEN from 191 to 192).

The key technical domains are: (1) Token-2022 burn via Anchor CPI (no Transfer Hook involvement -- burn does not trigger hooks), (2) proportional refund math using u128 intermediates with floor rounding (protocol-favored), (3) direct lamport manipulation for SOL transfers between program-owned PDAs (bonding curve owns sol_vault, tax_escrow), (4) cross-program lamport credit for distribute_tax_escrow (the carnage_sol_vault is owned by the epoch program, but the Solana runtime allows any program to CREDIT lamports to any account), and (5) slot-based deadline enforcement with the 150-slot grace buffer per CONTEXT.md decision.

All 5 instructions follow existing patterns from the codebase. No new dependencies are needed. The primary complexity is in `claim_refund` where the proportional refund math must be proven correct via property tests (order-independence, full vault exhaustion, no profitable exploits via partial claims).

**Primary recommendation:** Implement all 5 instructions as simple handler files in `programs/bonding_curve/src/instructions/`, following the exact patterns from `sell.rs` and `purchase.rs`. Use `anchor_spl::token_interface::burn` for the Token-2022 burn (user-signed, no PDA signer needed). Use direct lamport manipulation for all SOL transfers. Add the `escrow_consolidated` bool to CurveState, update LEN to 200 (8 disc + 192 data). Property test the refund math with 1M+ iterations including multi-user claim ordering.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| anchor-lang | 0.32.1 | Program framework | Already in use, all 7 programs use it |
| anchor-spl | 0.32.1 (features: `token_2022`) | Token-2022 CPI (burn) | Already in use. `token_interface::burn` for claim_refund |
| proptest | 1.9 | Property-based testing | Already in dev-dependencies from Phase 71/72 |
| litesvm | 0.9.1 | On-chain integration testing | Already in dev-dependencies |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| solana-sdk | 2.2 | Test keypairs, transactions | Already in dev-dependencies |
| sha2 | 0.10 | Discriminator computation for LiteSVM tests | Already in dev-dependencies |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `anchor_spl::token_interface::burn` | Manual `spl_token_2022::instruction::burn` via invoke | Anchor CPI is simpler and sufficient since user signs (not PDA). No Transfer Hook involvement for burn -- confirmed. Anchor CPI is the recommended approach. |
| Direct lamport manipulation for distribute_tax_escrow | CPI to epoch_program | Unnecessary complexity. The bonding curve program can subtract lamports from its own tax_escrow PDA and credit them to the carnage_sol_vault (owned by epoch program). Solana runtime allows crediting lamports to any account. |

**No new dependencies needed.** Everything is already in Cargo.toml.

---

## Architecture Patterns

### Recommended File Structure
```
programs/bonding_curve/src/
├── constants.rs             # Add FAILURE_GRACE_SLOTS = 150
├── error.rs                 # Add DeadlineNotPassed, CurveNotGraduated, NothingToBurn,
│                            # EscrowAlreadyConsolidated, EscrowAlreadyDistributed,
│                            # CRIMECurveNotFilled, FRAUDCurveNotFilled, NoTokensOutstanding
├── events.rs                # Already has all 5 events: CurveFailed, EscrowConsolidated,
│                            # EscrowDistributed, RefundClaimed, TransitionPrepared
├── state.rs                 # Add escrow_consolidated: bool, update LEN 199 -> 200
├── math.rs                  # No changes needed
├── lib.rs                   # Add 5 new instruction dispatches
└── instructions/
    ├── mod.rs               # Add 5 new pub mod + pub use
    ├── mark_failed.rs       # NEW: Active -> Failed (permissionless, slot check + grace)
    ├── consolidate_for_refund.rs  # NEW: Merge escrow into vault (permissionless)
    ├── claim_refund.rs      # NEW: Burn-and-claim proportional refund (permissionless)
    ├── prepare_transition.rs # NEW: Both Filled -> Graduated (admin-only per CONTEXT.md)
    └── distribute_tax_escrow.rs  # NEW: Escrow -> carnage fund (permissionless)
```

### Pattern 1: mark_failed (Permissionless Failure Trigger with Grace Buffer)
**What:** Transitions a curve from Active to Failed after the deadline + grace buffer.
**When to use:** Anyone calls this after deadline_slot + FAILURE_GRACE_SLOTS.
**Key CONTEXT.md decision:** 150-slot grace buffer after deadline_slot. Spec says instant marking (Section 8.7), but CONTEXT.md adds this as an additive safety measure.

```rust
// Source: Bonding_Curve_Spec.md Section 8.7, modified by 73-CONTEXT.md
pub fn handler(ctx: Context<MarkFailed>) -> Result<()> {
    let curve = &mut ctx.accounts.curve_state;
    let clock = Clock::get()?;

    // Only Active curves can be marked failed
    require!(curve.status == CurveStatus::Active, CurveError::InvalidStatus);

    // Deadline + grace buffer must have passed
    // CONTEXT.md: 150-slot grace allows in-flight TXs to finalize
    let failure_eligible_slot = curve.deadline_slot
        .checked_add(FAILURE_GRACE_SLOTS)
        .ok_or(CurveError::Overflow)?;
    require!(clock.slot > failure_eligible_slot, CurveError::DeadlineNotPassed);

    curve.status = CurveStatus::Failed;

    emit!(CurveFailed { ... });
    Ok(())
}
```

**Accounts:** Just `curve_state` (Mut PDA). No signer constraint -- anyone can call. No partner curve needed (partner failure is handled by `is_refund_eligible()`).

### Pattern 2: consolidate_for_refund (Escrow -> Vault Merge)
**What:** Moves all available SOL from tax_escrow PDA to sol_vault PDA, sets the `escrow_consolidated` flag.
**When to use:** Must be called before any `claim_refund`. Permissionless.
**Key CONTEXT.md decision:** Explicit boolean flag `escrow_consolidated` on CurveState (not implicit lamport check).

```rust
// Source: Bonding_Curve_Spec.md Section 8.9, modified by 73-CONTEXT.md
pub fn handler(ctx: Context<ConsolidateForRefund>) -> Result<()> {
    let curve = &mut ctx.accounts.curve_state;

    // Must be refund-eligible (requires partner_curve_state to check)
    require!(
        curve.is_refund_eligible(ctx.accounts.partner_curve_state.status),
        CurveError::NotRefundEligible
    );

    // Must not already be consolidated (explicit flag per CONTEXT.md)
    require!(!curve.escrow_consolidated, CurveError::EscrowAlreadyConsolidated);

    // Read escrow balance minus rent-exempt
    let rent = Rent::get()?;
    let rent_exempt = rent.minimum_balance(0);
    let escrow_lamports = ctx.accounts.tax_escrow.lamports();
    let transferable = escrow_lamports.saturating_sub(rent_exempt as u64);

    // Transfer lamports: escrow -> vault (direct manipulation, both program-owned)
    if transferable > 0 {
        **ctx.accounts.tax_escrow.try_borrow_mut_lamports()? -= transferable;
        **ctx.accounts.sol_vault.try_borrow_mut_lamports()? += transferable;
    }

    // Set flag (CONTEXT.md: explicit over implicit)
    curve.escrow_consolidated = true;

    emit!(EscrowConsolidated { ... });
    Ok(())
}
```

**Important:** This instruction needs the `partner_curve_state` account for the `is_refund_eligible()` check. The partner's status determines if this curve is refund-eligible (Filled + partner Failed, or self Failed).

### Pattern 3: claim_refund (Burn-and-Claim)
**What:** Burns user's entire token balance, transfers proportional SOL refund.
**When to use:** After consolidation, by any token holder of a refund-eligible curve.
**Key CONTEXT.md decisions:**
- All-or-nothing: entire ATA balance burned in single claim
- Floor rounding (protocol-favored): `refund = floor(user_balance * refund_pool / tokens_sold)`
- Defense-in-depth DivisionByZero check even though logically impossible
- Token-2022 burn via standard `spl_token_2022::burn`, user signs, no Transfer Hook

```rust
// Source: Bonding_Curve_Spec.md Section 8.8, 73-CONTEXT.md decisions
pub fn handler(ctx: Context<ClaimRefund>) -> Result<()> {
    let curve = &mut ctx.accounts.curve_state;

    // Check refund eligibility
    require!(
        curve.is_refund_eligible(ctx.accounts.partner_curve_state.status),
        CurveError::NotRefundEligible
    );

    // Check escrow consolidated (explicit flag)
    require!(curve.escrow_consolidated, CurveError::EscrowNotConsolidated);

    // Read user balance (must be > 0)
    let user_balance = ctx.accounts.user_token_account.amount;
    require!(user_balance > 0, CurveError::NothingToBurn);

    // Read total outstanding (denominator)
    let total_outstanding = curve.tokens_sold;
    require!(total_outstanding > 0, CurveError::NoTokensOutstanding);

    // Compute refund pool (vault balance minus rent-exempt)
    let rent = Rent::get()?;
    let rent_exempt = rent.minimum_balance(0);
    let refund_pool = ctx.accounts.sol_vault.lamports()
        .checked_sub(rent_exempt as u64)
        .ok_or(CurveError::Overflow)?;

    // Proportional refund with floor rounding (CONTEXT.md: protocol-favored)
    let refund_amount = (user_balance as u128)
        .checked_mul(refund_pool as u128)
        .ok_or(CurveError::Overflow)?
        / (total_outstanding as u128);  // floor division
    let refund_amount = refund_amount as u64;

    // Step 1: Burn ALL tokens (Token-2022, user signs, no Transfer Hook)
    token_interface::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.token_mint.to_account_info(),
                from: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        user_balance,
    )?;

    // Step 2: Transfer refund SOL (direct lamport manipulation)
    **ctx.accounts.sol_vault.try_borrow_mut_lamports()? -= refund_amount;
    **ctx.accounts.user.try_borrow_mut_lamports()? += refund_amount;

    // Step 3: Update tokens_sold (denominator shrinks for next claimer)
    curve.tokens_sold = curve.tokens_sold
        .checked_sub(user_balance)
        .ok_or(CurveError::Overflow)?;

    emit!(RefundClaimed { ... });
    Ok(())
}
```

**Critical accounts:** user (Signer), curve_state (Mut), partner_curve_state (read-only, for is_refund_eligible), user_token_account (Mut), sol_vault (Mut UncheckedAccount), token_mint (Mut -- burn reduces supply), token_program.

**Token burn details (confirmed via Anchor expert):**
- `anchor_spl::token_interface::burn` is the correct wrapper
- Burn does NOT trigger Transfer Hooks
- Burn DOES reduce the mint's total_supply
- token_mint must be Mut (mutable) because supply decreases
- 3 accounts needed: mint (Mut), from (Mut token account), authority (Signer)

### Pattern 4: prepare_transition (Admin-Only Graduation)
**What:** Transitions both curves from Filled to Graduated.
**When to use:** Admin calls when both curves are Filled.
**Key CONTEXT.md decision:** Admin-only (not permissionless as the spec suggests). Trust the admin.

```rust
// Source: Bonding_Curve_Spec.md Section 8.11, modified by 73-CONTEXT.md
pub fn handler(ctx: Context<PrepareTransition>) -> Result<()> {
    // Both must be Filled
    require!(
        ctx.accounts.crime_curve_state.status == CurveStatus::Filled,
        CurveError::CRIMECurveNotFilled
    );
    require!(
        ctx.accounts.fraud_curve_state.status == CurveStatus::Filled,
        CurveError::FRAUDCurveNotFilled
    );

    // Transition both to Graduated (terminal)
    let crime_curve = &mut ctx.accounts.crime_curve_state;
    crime_curve.status = CurveStatus::Graduated;
    let fraud_curve = &mut ctx.accounts.fraud_curve_state;
    fraud_curve.status = CurveStatus::Graduated;

    emit!(TransitionPrepared { ... });
    Ok(())
}
```

**Accounts:** authority (Signer -- admin constraint), crime_curve_state (Mut PDA), fraud_curve_state (Mut PDA).

**Note:** The spec says permissionless but CONTEXT.md overrides to admin-only. The authority constraint should match the initialize_curve pattern (deployer wallet).

### Pattern 5: distribute_tax_escrow (Escrow -> Carnage Fund)
**What:** Transfers tax escrow SOL to the carnage fund's SOL vault.
**When to use:** After graduation, permissionless.

```rust
// Source: Bonding_Curve_Spec.md Section 8.10
pub fn handler(ctx: Context<DistributeTaxEscrow>) -> Result<()> {
    require!(
        ctx.accounts.curve_state.status == CurveStatus::Graduated,
        CurveError::CurveNotGraduated
    );

    let rent = Rent::get()?;
    let rent_exempt = rent.minimum_balance(0);
    let escrow_lamports = ctx.accounts.tax_escrow.lamports();
    let transferable = escrow_lamports.saturating_sub(rent_exempt as u64);

    require!(transferable > 0, CurveError::EscrowAlreadyDistributed);

    // Transfer: tax_escrow (bonding curve-owned) -> carnage_sol_vault (epoch-owned)
    // Solana runtime: program can DECREASE lamports of accounts it owns,
    // and can INCREASE lamports of ANY account (regardless of owner).
    **ctx.accounts.tax_escrow.try_borrow_mut_lamports()? -= transferable;
    **ctx.accounts.carnage_fund.try_borrow_mut_lamports()? += transferable;

    emit!(EscrowDistributed { ... });
    Ok(())
}
```

**Important cross-program lamport detail:** The tax_escrow PDA is owned by the bonding curve program (created with `init, space = 0`). The carnage_sol_vault is owned by the epoch program. Direct lamport manipulation works here because:
1. The bonding curve program can SUBTRACT lamports from its own PDA (tax_escrow)
2. ANY program can ADD lamports to ANY account (confirmed via Solana runtime rules)

This pattern is used extensively in the existing codebase (e.g., sell.rs transfers SOL to the user's wallet, which is owned by the system program).

### Anti-Patterns to Avoid

- **Using system_program::transfer for program-owned PDAs:** The sol_vault and tax_escrow are owned by the bonding curve program. System program transfer only works for system-program-owned accounts. Always use direct lamport manipulation.
- **Triggering Transfer Hook during burn:** Burn does NOT trigger transfer hooks. Use `token_interface::burn` (Anchor CPI) directly without remaining_accounts.
- **Forgetting rent-exempt minimum in refund pool calculation:** The sol_vault's lamport balance includes ~890,880 lamports of rent-exempt minimum. The refund_pool must subtract this: `refund_pool = sol_vault.lamports() - rent_exempt`.
- **Allowing partial refund claims:** CONTEXT.md explicitly says all-or-nothing. The user's entire ATA balance is burned. No `amount` parameter on claim_refund.
- **Checking escrow consolidation via lamport balance:** CONTEXT.md explicitly chose an `escrow_consolidated: bool` flag over implicit lamport checks. Use the flag.
- **Making prepare_transition permissionless:** CONTEXT.md overrides the spec to make it admin-only. Add authority signer constraint.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token-2022 burn | Manual spl_token_2022 invoke | `anchor_spl::token_interface::burn` | Anchor CPI wrapper handles account validation. User is signer (not PDA), so no invoke_signed needed. Simpler, safer. |
| Proportional refund math | Custom fraction library | u128 intermediate with floor division | Same pattern as the curve integral. u128 can handle `460e12 * 1e12` without overflow. Standard approach. |
| Escrow consolidation check | Lamport balance comparison | `escrow_consolidated: bool` on CurveState | CONTEXT.md decision: explicit flag is more readable and auditable. |
| Refund eligibility | Per-instruction status checks | Existing `CurveState::is_refund_eligible()` | Already implemented and tested in state.rs with comprehensive unit tests. |
| Event definitions | New event structs | Existing events in events.rs | CurveFailed, EscrowConsolidated, EscrowDistributed, RefundClaimed, TransitionPrepared are all pre-defined. |
| Error codes | Ad-hoc errors | Existing + new variants in error.rs | Most error codes already exist (EscrowNotConsolidated, NotRefundEligible). Only need to add: DeadlineNotPassed, CurveNotGraduated, NothingToBurn, EscrowAlreadyConsolidated, EscrowAlreadyDistributed, CRIMECurveNotFilled, FRAUDCurveNotFilled, NoTokensOutstanding. |

**Key insight:** Phase 71/72 pre-provisioned almost everything Phase 73 needs. The events, most error codes, the `is_refund_eligible()` helper, and all PDA seeds already exist. Phase 73 is primarily an assembly task using established patterns.

---

## Common Pitfalls

### Pitfall 1: CurveState LEN Change Breaking Existing Accounts
**What goes wrong:** Adding `escrow_consolidated: bool` increases CurveState from 191 to 192 data bytes (LEN from 199 to 200). If the LEN constant is updated but existing test curves were initialized with the old size, deserialization fails.
**Why it happens:** Anchor's `init` uses `space = CurveState::LEN` at creation time. Existing accounts on devnet would be 199 bytes but the program expects 200.
**How to avoid:**
1. Update `CurveState::LEN` to `8 + 192 = 200`.
2. Update the serialization test to include the new field and assert 200 bytes.
3. For devnet: existing curves would need redeployment (they were test data anyway).
4. The new field defaults to `false` which is correct for the zero-initialized state.
**Warning signs:** "Account not large enough" errors during LiteSVM tests.

### Pitfall 2: Partner Curve Account in Refund Instructions
**What goes wrong:** `consolidate_for_refund` and `claim_refund` need to check `is_refund_eligible(partner_status)`, which requires reading the partner curve's status. If the partner curve account is not included in the accounts struct, the check cannot be performed.
**Why it happens:** The `is_refund_eligible()` method takes `partner_status: CurveStatus` as a parameter. The on-chain instruction must read the partner's CurveState to get this value.
**How to avoid:** Include `partner_curve_state: Account<'info, CurveState>` as a read-only account in the ConsolidateForRefund and ClaimRefund accounts structs. Add seed constraints to ensure the partner is a valid CurveState PDA (different token_mint from the primary curve).
**Warning signs:** Missing account errors, or refund instructions that only check self-status (missing the Filled + partner Failed case).

### Pitfall 3: Refund Pool Reading Stale After Burns
**What goes wrong:** The `refund_pool` is computed from `sol_vault.lamports()` at the start of claim_refund. After the burn and SOL transfer, the vault balance has changed. If there's any re-reading of the vault balance after the transfer (e.g., for event emission), it reflects the post-transfer state.
**Why it happens:** Lamport manipulation is immediate within the instruction. The RefundClaimed event includes `remaining_vault_balance` which should be read AFTER the transfer.
**How to avoid:** Read `refund_pool` once BEFORE the transfer for the math. Read `remaining_vault_balance` AFTER the transfer for the event. Follow the spec's event field definitions (Section 10).
**Warning signs:** Event data showing incorrect remaining vault balance.

### Pitfall 4: Rent-Exempt Minimum After Full Refund Drain
**What goes wrong:** If all users claim refunds, the sol_vault should be left with only the rent-exempt minimum (~890,880 lamports). But floor rounding means there will be some dust (0 to ~N lamports) remaining above rent-exempt.
**Why it happens:** Floor rounding on each individual refund claim means the sum of refunds is slightly less than the total refund pool.
**How to avoid:** Per CONTEXT.md: "Dust left in vault after all claims is acceptable, not swept." The vault will retain rent-exempt minimum + dust. No special handling needed.
**Warning signs:** None -- this is expected behavior.

### Pitfall 5: Grace Buffer Off-by-One
**What goes wrong:** The mark_failed instruction checks `clock.slot > deadline_slot + FAILURE_GRACE_SLOTS`. An off-by-one error could allow marking failed 1 slot too early or require 1 extra slot.
**Why it happens:** Confusion between `>` (strictly after) and `>=` (at or after).
**How to avoid:** Use `clock.slot > curve.deadline_slot + FAILURE_GRACE_SLOTS` (strictly greater). This means the failure can be marked at slot `deadline_slot + FAILURE_GRACE_SLOTS + 1`, giving the full 150-slot buffer. The purchase/sell deadline check uses `clock.slot <= curve.deadline_slot` (purchases blocked starting at slot `deadline_slot + 1`). So there's a clean 150-slot gap between "last possible purchase" and "first possible failure marking."
**Warning signs:** Tests that check exact slot boundaries failing by 1.

### Pitfall 6: Token Mint Mutability for Burn
**What goes wrong:** Token-2022 burn reduces the mint's total_supply. If token_mint is not marked as Mut in the ClaimRefund accounts struct, the burn CPI will fail.
**Why it happens:** In purchase.rs and sell.rs, token_mint is read-only because transfer_checked doesn't modify the mint. But burn DOES modify the mint (decreases supply).
**How to avoid:** In ClaimRefund, mark token_mint as `#[account(mut)]`:
```rust
#[account(mut)]
pub token_mint: Box<InterfaceAccount<'info, Mint>>,
```
**Warning signs:** "Account is not writable" error during burn CPI.

### Pitfall 7: Cross-Program Lamport Transfer for distribute_tax_escrow
**What goes wrong:** The carnage_sol_vault PDA is owned by the epoch program, not the bonding curve program. If someone tries to use system_program::transfer or invoke_signed to transfer TO this account, it fails because the bonding curve can't sign for an epoch program PDA.
**Why it happens:** Confusion about which direction needs program ownership.
**How to avoid:** Use direct lamport manipulation. The bonding curve program SUBTRACTS from its own tax_escrow PDA (which it owns). It then ADDS to the carnage_sol_vault (owned by epoch program). Solana runtime rule: a program can increase lamports of ANY account. This is the same pattern as sell.rs adding lamports to the user's wallet (owned by system program).
**Warning signs:** "Program is not owner" errors when trying to subtract from carnage_sol_vault.

---

## Code Examples

### CurveState Update (escrow_consolidated field)
```rust
// state.rs -- Add after bump field
/// Whether the tax escrow has been consolidated into sol_vault for refunds.
/// Set to true by consolidate_for_refund. Checked by claim_refund.
/// Default: false (set during initialize_curve).
pub escrow_consolidated: bool,  // 1 byte

// Update LEN
pub const LEN: usize = 8 + 192; // Was 8 + 191
```

### Constants Addition
```rust
// constants.rs -- Add to timing section
/// Grace period after deadline_slot before mark_failed can be called.
/// Gives in-flight purchase TXs ~1 minute to finalize on-chain.
/// 150 slots * 400ms/slot = ~60 seconds.
pub const FAILURE_GRACE_SLOTS: u64 = 150;
```

### Error Variants to Add
```rust
// error.rs -- Add to CurveError enum
/// Deadline + grace period has not passed yet.
#[msg("Deadline and grace period have not passed yet")]
DeadlineNotPassed,

/// Curve has not graduated (required for escrow distribution).
#[msg("Curve has not graduated")]
CurveNotGraduated,

/// User has no tokens to burn for refund.
#[msg("No tokens to burn -- user balance is zero")]
NothingToBurn,

/// Tax escrow has already been consolidated.
#[msg("Tax escrow has already been consolidated")]
EscrowAlreadyConsolidated,

/// Tax escrow has already been distributed.
#[msg("Tax escrow has already been distributed")]
EscrowAlreadyDistributed,

/// CRIME curve is not in Filled status (required for graduation).
#[msg("CRIME curve is not filled")]
CRIMECurveNotFilled,

/// FRAUD curve is not in Filled status (required for graduation).
#[msg("FRAUD curve is not filled")]
FRAUDCurveNotFilled,

/// No tokens outstanding (division by zero guard for refund calculation).
#[msg("No tokens outstanding -- cannot calculate refund")]
NoTokensOutstanding,
```

### Anchor Token-2022 Burn Pattern (Verified)
```rust
// Source: Anchor Solana expert, confirmed burn does NOT trigger Transfer Hooks
use anchor_spl::token_interface::{self, Burn, Mint, TokenAccount, TokenInterface};

// In claim_refund handler:
token_interface::burn(
    CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Burn {
            mint: ctx.accounts.token_mint.to_account_info(),
            from: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        },
    ),
    user_balance,  // ALL tokens, all-or-nothing per CONTEXT.md
)?;
```

### Proportional Refund Math
```rust
// Refund formula: floor(user_balance * refund_pool / tokens_sold)
// Uses u128 intermediates to prevent overflow.
// Maximum: 460e12 * 1e12 = 4.6e26 (well within u128 max ~3.4e38)

let refund_amount = (user_balance as u128)
    .checked_mul(refund_pool as u128)
    .ok_or(CurveError::Overflow)?
    / (total_outstanding as u128);  // floor division (implicit in Rust integer division)
let refund_amount = refund_amount as u64;
```

### Property Test: Refund Order Independence
```rust
proptest! {
    #![proptest_config(ProptestConfig::with_cases(1_000_000))]

    /// PROPERTY R1: Refund is order-independent.
    /// Three users with random balances summing to tokens_sold.
    /// All claim in sequence. Final vault should be at ~0 (dust only).
    /// Each user's refund should be the same regardless of claim order.
    #[test]
    fn refund_order_independent(
        vault_sol in 1_000_000u64..=1_000_000_000_000u64,
        pct_a in 1u64..=500_000u64,
        pct_b in 1u64..=500_000u64,
    ) {
        let total = 460_000_000_000_000u64; // tokens_sold
        let balance_a = ((total as u128) * (pct_a as u128) / 1_000_000) as u64;
        let balance_b = ((total as u128) * (pct_b as u128) / 1_000_000) as u64;
        let balance_c = total - balance_a - balance_b;
        if balance_c == 0 || balance_a == 0 || balance_b == 0 { return Ok(()); }

        // Simulate ABC order
        let (ra, rb, rc) = simulate_claims(vault_sol, total, balance_a, balance_b, balance_c);
        // Simulate CBA order
        let (rc2, rb2, ra2) = simulate_claims(vault_sol, total, balance_c, balance_b, balance_a);

        // Each user's refund should be identical regardless of order
        prop_assert_eq!(ra, ra2, "User A refund differs by order");
        prop_assert_eq!(rb, rb2, "User B refund differs by order");
        prop_assert_eq!(rc, rc2, "User C refund differs by order");

        // Total refunded should equal vault (minus dust)
        let total_refunded = ra + rb + rc;
        prop_assert!(
            vault_sol - total_refunded <= 3, // max 3 lamports dust (3 users * 1 lamport floor)
            "Too much dust: {} lamports left",
            vault_sol - total_refunded
        );
    }
}

fn simulate_claims(vault: u64, mut total: u64, b1: u64, b2: u64, b3: u64) -> (u64, u64, u64) {
    let mut pool = vault;
    let r1 = (b1 as u128 * pool as u128 / total as u128) as u64;
    pool -= r1; total -= b1;
    let r2 = (b2 as u128 * pool as u128 / total as u128) as u64;
    pool -= r2; total -= b2;
    let r3 = (b3 as u128 * pool as u128 / total as u128) as u64;
    (r1, r2, r3)
}
```

### Carnage Fund Address Validation
```rust
// distribute_tax_escrow accounts struct
// The carnage_sol_vault is a PDA on the epoch_program with seed ["carnage_sol_vault"].
// We validate it by deriving the expected PDA and comparing.

/// CHECK: Carnage fund SOL vault (owned by epoch program).
/// Validated by constraint matching the expected PDA derivation.
#[account(
    mut,
    constraint = carnage_fund.key() == expected_carnage_sol_vault()
        @ CurveError::InvalidStatus,
)]
pub carnage_fund: UncheckedAccount<'info>,

// In constants.rs:
pub const CARNAGE_SOL_VAULT_SEED: &[u8] = b"carnage_sol_vault";

// Helper (or inline): derive the expected address
pub fn expected_carnage_sol_vault() -> Pubkey {
    let (pda, _) = Pubkey::find_program_address(
        &[CARNAGE_SOL_VAULT_SEED],
        &epoch_program_id(),
    );
    pda
}
```

**Note:** The epoch program ID needs to be known at compile time. This follows the same pattern as the conversion vault which hardcodes mint addresses via feature gates. The epoch program ID can be hardcoded or feature-gated.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ParticipantState PDA for refund tracking | Burn-and-claim with proportional math | v1.2 spec rewrite | Eliminates per-user PDA. Simpler, cheaper, standard (pump.fun precedent). |
| Monolithic execute_transition (32 accounts) | Multi-TX orchestration with prepare_transition + client steps | v1.2 spec rewrite | Avoids TX size limit. Each instruction is lightweight and composable. |
| Implicit escrow check (lamport balance) | Explicit `escrow_consolidated: bool` flag | 73-CONTEXT.md decision | More readable and auditable. No edge cases around rent-exempt thresholds. |
| Instant failure marking | 150-slot grace buffer | 73-CONTEXT.md decision | Additive safety measure for in-flight TXs. ~1 minute buffer. |

**Deprecated/outdated:**
- v1.0 `claim_refund` used `participant_state.sol_spent` for exact refund. This was removed in v1.2 (no ParticipantState PDA).
- v1.0 `execute_transition` was a monolithic 32-account instruction. Replaced by multi-TX orchestration.

---

## Open Questions

### 1. Authority Constraint for prepare_transition
- **What we know:** CONTEXT.md says admin-only. The existing admin pattern uses a Signer constraint but doesn't use a stored authority key (initialize_curve just requires the deployer wallet as Signer).
- **What's unclear:** Whether to hardcode the admin pubkey, use a feature-gated address, or store it on CurveState. The existing initialize_curve doesn't store authority -- it just uses Signer.
- **Recommendation:** Use the same pattern as initialize_curve: just require a Signer named `authority`. In production, only the deployer wallet would know to call this. For additional safety, could compare against a hardcoded/feature-gated admin pubkey (same pattern as mint validation in initialize_curve). This is Claude's discretion per CONTEXT.md.

### 2. Epoch Program ID for Carnage Fund Validation
- **What we know:** distribute_tax_escrow transfers SOL to the carnage_sol_vault PDA owned by the epoch program. The address is derived from `["carnage_sol_vault"]` seed on the epoch program.
- **What's unclear:** Whether to hardcode the epoch program ID or derive it via feature gate.
- **Recommendation:** Feature-gate it like mint addresses: `#[cfg(feature = "devnet")] fn epoch_program_id() -> Pubkey { ... }`. The existing codebase uses this pattern in conversion-vault for mint addresses. Alternatively, accept the carnage_fund as an unchecked account and validate via PDA derivation in the instruction body.

### 3. RefundClaimed Event Missing `remaining_vault_balance`
- **What we know:** The spec's RefundClaimed event (Section 10) includes `remaining_vault_balance`. The existing event definition in events.rs also includes it.
- **What's unclear:** Whether to read this from sol_vault.lamports() AFTER the transfer (correct) or compute it (refund_pool - refund_amount + rent_exempt).
- **Recommendation:** Read it from `ctx.accounts.sol_vault.lamports()` AFTER the SOL transfer. This is authoritative and matches the spec's intent. Direct lamport reads reflect the post-mutation state within the same instruction.

---

## Sources

### Primary (HIGH confidence)
- `programs/bonding_curve/src/` -- All source files read directly (state.rs, constants.rs, error.rs, events.rs, lib.rs, instructions/mod.rs, instructions/sell.rs, instructions/purchase.rs, instructions/initialize_curve.rs, math.rs)
- `Docs/Bonding_Curve_Spec.md` -- Sections 5.2 (CurveStatus), 5.7 (tax escrow), 8.7 (mark_failed), 8.8 (claim_refund), 8.9 (consolidate_for_refund), 8.10 (distribute_tax_escrow), 8.11 (prepare_transition), 8.13 (graduation orchestration), 9 (failure handling), 11 (errors), 12.5 (burn-and-claim solvency proof), 12.6 (tax escrow integrity)
- `.planning/phases/73-graduation-refund/73-CONTEXT.md` -- All locked decisions
- `.planning/phases/71-curve-foundation/71-RESEARCH.md` -- Patterns, stack, architecture
- `.planning/phases/72-sell-back-tax-escrow/72-RESEARCH.md` -- SOL transfer patterns, solvency checks
- Anchor Expert (MCP tool) -- Confirmed Token-2022 burn CPI pattern, burn does NOT trigger Transfer Hooks, burn DOES reduce mint supply
- Solana Expert (MCP tool) -- Confirmed direct lamport manipulation rules: program can decrease own accounts, any program can increase any account's lamports. Confirmed rent-exempt minimum for 0-byte accounts is 890,880 lamports.
- `programs/epoch-program/src/constants.rs` -- CARNAGE_SOL_VAULT_SEED = b"carnage_sol_vault"
- `programs/epoch-program/src/state/carnage_fund_state.rs` -- CarnageFundState structure, sol_vault PDA seed

### Secondary (MEDIUM confidence)
- Solana Stack Exchange answers -- Multiple verified answers confirming direct lamport manipulation patterns for cross-program crediting
- Anchor CPI documentation -- Confirmed CpiContext::new for user-signed burns

### Tertiary (LOW confidence)
- None. All findings verified against authoritative sources.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All dependencies already in Cargo.toml, no new libraries needed
- Architecture: HIGH -- All 5 instructions follow established patterns from purchase.rs/sell.rs
- Burn mechanics: HIGH -- Confirmed via Anchor expert that burn doesn't trigger Transfer Hooks
- Lamport transfers: HIGH -- Confirmed via Solana expert and existing codebase patterns (sell.rs)
- Refund math: HIGH -- Spec provides formal solvency proof (Section 12.5), floor rounding is standard
- State changes: HIGH -- CurveState field addition is minimal (1 bool), LEN update is mechanical

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (stable domain, no external dependencies changing)
