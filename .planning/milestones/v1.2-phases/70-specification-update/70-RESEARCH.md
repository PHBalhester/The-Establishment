# Phase 70: Specification Update - Research

**Researched:** 2026-03-03
**Domain:** Specification writing -- bonding curve math, state machines, cross-reference consistency
**Confidence:** HIGH

## Summary

Phase 70 is a documentation-only phase: update `Bonding_Curve_Spec.md` from a buy-only spec to the full v1.2 design (buy+sell, tax escrow, coupled graduation, burn-and-claim refunds, open access), then ensure consistency with two cross-reference documents. No code is written; the output is a single source of truth for Phases 71-75.

The existing spec is 1,500 lines and covers the buy-only design comprehensively (sections 1-15). The v1.2 decisions from CONTEXT.md require adding ~8 new sections and modifying ~10 existing sections. The cross-reference docs (`Protocol_Initialzation_and_Launch_Flow.md`, `Transfer_Hook_Spec.md`) are in the `docs/archive/` folder and need consistency checks but not wholesale rewrites.

The core research question is: "What exactly needs to change, and what are the mathematical/architectural patterns to get it right?" This document provides a precise gap analysis, verified sell-back math, state machine definition, and cross-reference delta so the planner can create tasks that are unambiguous and complete.

**Primary recommendation:** Structure the spec update as a series of targeted section edits (add/modify/remove), not a full rewrite. The existing spec is well-structured; the changes are additive (sell mechanics, tax escrow, refund overhaul, state machine expansion) with surgical removals (whitelist, ParticipantState, ReserveState, buy-only invariants).

## Standard Stack

This phase produces documentation only. No libraries or tools are needed beyond a text editor.

### Core
| Tool | Purpose | Why Standard |
|------|---------|--------------|
| Markdown | Specification format | All project specs are .md files |
| Existing spec structure | Template for new sections | Maintains consistency with 1,500 lines of established patterns |

### Not Applicable
No npm packages, no Rust crates, no build tools. This is a writing task.

## Architecture Patterns

### Spec Document Structure (Existing)

The current `Bonding_Curve_Spec.md` follows this structure:
```
1.  Purpose
2.  Design Constraints
3.  Economic Parameters (3.1-3.5)
4.  Linear Curve Formula (4.1-4.4)
5.  State Accounts (5.1-5.6)
6.  Purchase Constraints (6.1-6.3)
7.  Timing (7.1-7.2)
8.  Instructions (8.1-8.9)
9.  Failure Handling (9.1-9.3)
10. Events
11. Errors
12. Security Considerations (12.1-12.5)
13. Testing Requirements (13.1-13.3)
14. UI Integration (14.1-14.2)
15. Invariants Summary
```

### Recommended Update Pattern

**Do not renumber existing sections.** Add new sections after existing ones; modify in-place where needed. This preserves any external references to section numbers from other docs or team discussions.

### Pattern: Section-Level Delta

Each spec change should be categorized as one of:
- **ADD**: New section that does not exist
- **MODIFY**: Existing section needs content changes
- **REMOVE**: Section or subsection should be deleted entirely
- **REPLACE**: Section exists but content is completely different

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sell-back integral math | Invent new formula | Reverse of existing buy integral (Section 4.3) | Same linear curve, same quadratic; just integrate backward |
| State machine diagram | Prose description only | Explicit enum + transition table | Prevents ambiguity about valid transitions |
| Refund formula | Ad-hoc proportional calculation | Token-weighted pool distribution formula | Standard DeFi pattern (burn-and-claim) avoids double-counting |
| Tax ordering | Describe vaguely | Explicit step-by-step with numbered operations | Tax before vs after integral changes the result by 15% |

## Gap Analysis: Current Spec vs. v1.2 Decisions

This is the core research output. Each item maps to a specific section change.

### Sections to ADD (New Content)

#### GAP-01: Sell-Back Mechanics (New Section ~4.5)
**Current state:** Section 4 covers buy math only. Section 2 explicitly says "Buy-only (no selling back to curve)."
**Required:** Complete reverse integral math for sells, including:
- SOL returned = integral from `(tokens_sold - tokens_being_sold)` to `tokens_sold`
- 15% tax deduction step (deduct from SOL output, NOT from tokens)
- `minimum_sol_out` slippage protection parameter
- `tokens_sold` decreases on sell (curve walks backward)
- Per-wallet cap: selling frees up cap space (NET holdings check)

**Math verification (HIGH confidence):**
For a linear price curve `P(x) = a + bx`:
- Buy integral: `SOL_in = a * delta_x + b * (x2^2 - x1^2) / 2` where `x1 = tokens_sold_before`, `x2 = tokens_sold_after`
- Sell integral is IDENTICAL but in reverse direction: `SOL_out_gross = a * delta_x + b * (x1^2 - x2^2) / 2` where `x1 = tokens_sold_before_sell`, `x2 = tokens_sold_after_sell = x1 - tokens_being_sold`
- `SOL_out_net = SOL_out_gross * 0.85` (15% tax deducted)
- `tax_amount = SOL_out_gross * 0.15`

**Critical: Tax deduction ordering.** Tax is deducted from the SOL output (lamports), NOT from the token count. The user sends back N tokens and receives `integral(N) * 0.85` SOL. The curve's `tokens_sold` decreases by the full N tokens (not 85% of N).

#### GAP-02: Tax Escrow PDA and Lifecycle (New Section ~5.7 + New Instruction ~8.10)
**Current state:** No tax escrow concept exists anywhere in the spec.
**Required:**
- Tax escrow PDA definition: `seeds = ["tax_escrow", token_mint]`, per-curve
- Escrow balance read from PDA lamports directly (no duplicated state field -- decision from CONTEXT.md)
- Lifecycle: On sell -> 15% to escrow. On success -> escrow to carnage fund. On failure -> consolidate into sol_vault
- `consolidate_for_refund` instruction: merges escrow lamports into sol_vault PDA, must be called BEFORE any `claim_refund`
- `distribute_tax_escrow` instruction: transfers escrow lamports to carnage fund on graduation success

#### GAP-03: Sell Instruction (New Instruction ~8.6, renumber existing 8.6+)
**Current state:** Instructions go: initialize_curve, fund_curve, start_curve, add_to_whitelist, purchase, mark_failed, claim_refund, check_transition_ready, execute_transition.
**Required:** New `sell` instruction between purchase and mark_failed:
- Accounts: user, curve_state, user_token_account, token_vault, sol_vault, tax_escrow, token_mint, token_program, system_program
- Validation: curve Active (NOT Filled), deadline not passed, user has tokens, minimum_sol_out check
- Logic: compute SOL via reverse integral, deduct 15% to tax_escrow, transfer 85% to user, burn/return tokens to vault, decrement tokens_sold
- Note: NO ParticipantState account needed (removed per CONTEXT.md decision)

#### GAP-04: Burns-and-Claim Refund Overhaul (Replace Section 8.7 / 9.x)
**Current state:** `claim_refund` uses `participant.sol_spent` (SOL-spent-based refund) with `refund_claimed` boolean.
**Required:** Complete replacement with burn-and-claim:
- User calls `claim_refund`, program reads user's ATA balance
- Program burns tokens from ATA
- Program sends `(user_balance / tokens_sold) * (sol_vault_balance + tax_escrow_balance)` SOL to user
- After burn, `tokens_sold` decreases by burned amount
- Subsequent claimers get correct proportional share (pool shrinks, but so does denominator)
- No `refund_claimed` boolean needed (tokens are burned, can't claim twice)
- `consolidate_for_refund` must have been called first (so sol_vault contains escrow SOL)

**Solvency proof:** At any point during refunds:
- Total SOL in vault = initial vault + consolidated escrow - already refunded
- Total tokens outstanding = initial tokens_sold - already burned
- Each claimer gets `(their_tokens / remaining_tokens) * remaining_SOL`
- Sum of all refunds = total SOL in vault (exactly solvent by construction)
- Sellers who exited early keep their SOL AND get proportional refund on remaining tokens

#### GAP-05: State Machine Expansion (Modify Section 5.2 + New Subsection)
**Current state:** CurveStatus enum: Initialized, Active, Filled, Failed, Transitioned
**Required:** Add `Graduated` status (or rename `Transitioned` to `Graduated` for clarity). Define explicit transition table:

| From | To | Trigger | Condition |
|------|----|---------|-----------|
| Initialized | Active | start_curve | curve funded, authority calls |
| Active | Filled | purchase (fills last tokens) | tokens_sold >= TARGET_TOKENS |
| Active | Failed | mark_failed | deadline passed |
| Filled | Graduated | finalize_transition | partner also Filled/Graduated |
| Filled | Failed (effective) | partner mark_failed | partner deadline passed |

**Sells-disabled-when-Filled:** Sell instruction must check `curve.status == CurveStatus::Active`. Once Filled, no more sells. This prevents grief attacks at the finish line and simplifies the graduation math (SOL vault is stable once Filled).

#### GAP-06: Coupled Graduation Details (Expand Section 8.8-8.9)
**Current state:** `check_transition_ready` and `execute_transition` exist but are skeletal.
**Required per CONTEXT.md decisions:**
- `prepare_transition`: permissionless, locks curves, stages assets
- Graduation is multi-TX client-side orchestration (not single CPI chain)
- Tax escrow -> carnage fund during graduation
- Both curves must be Filled for graduation to proceed
- 48-hour deadline applies from when FIRST curve starts (not from when first fills)

### Sections to MODIFY (Existing Content Changes)

#### GAP-07: Design Constraints Update (Section 2)
**Current:** Lists "Buy-only (no selling back to curve)" and "Per-wallet caps enforced on-chain via whitelist"
**Change to:** Remove buy-only constraint. Change whitelist constraint to "Open access, per-wallet cap (20M tokens) is sole sybil resistance."

#### GAP-08: CurveState Account Update (Section 5.1)
**Current:** 135 bytes, no tax escrow fields, no sell tracking
**Add fields:**
- `tokens_returned: u64` -- total tokens sold back to curve
- `sol_returned: u64` -- total SOL returned to sellers (before tax)
- `tax_collected: u64` -- total tax collected (15% of gross sell proceeds)
- `tax_escrow: Pubkey` -- PDA address of tax escrow account
- Remove `participant_count` from struct (or keep as lightweight counter, Claude's discretion per CONTEXT.md)

**Updated size calculation needed.** Architecture research estimated ~183 bytes; exact calculation is a planner task.

#### GAP-09: Purchase Instruction Update (Section 8.5)
**Current:** Requires `whitelist_entry` PDA account, uses `participant_state` for cap tracking
**Changes:**
- Remove `whitelist_entry` from accounts list
- Remove whitelist check from validation logic
- Change cap enforcement: read user's ATA balance directly (`current_ata_balance + tokens_to_receive <= 20M`)
- ParticipantState still needed for first-buyer tracking (participant_count), OR remove entirely if using events only (Claude's discretion)

**Critical note on cap enforcement without ParticipantState:**
CONTEXT.md says "ParticipantState eliminated entirely." Cap enforcement uses ATA balance reads. This works because:
- Transfer Hook whitelist prevents wallet-to-wallet transfers during curve phase
- User cannot shuffle tokens to a new wallet to circumvent cap
- Only protocol PDAs (whitelisted) can be transfer destinations
- ATA balance is the authoritative source of "how many tokens does this user have"

However: if user sells tokens, their ATA balance decreases, freeing up cap space. This is the intended behavior per CONTEXT.md ("selling frees up cap space").

#### GAP-10: Claim Refund Instruction Overhaul (Section 8.7)
**Current:** Uses `participant_state.sol_spent` and `participant_state.refund_claimed`
**Replace with:** Burn-and-claim pattern (see GAP-04 above). Completely different accounts list and logic.

#### GAP-11: Failure Handling Update (Section 9)
**Current:** Section 9.2 says "users keep their purchased tokens" after refund
**Change:** Users BURN tokens to claim refund. Tokens are destroyed during refund. Update all references.

Section 9.1 needs update for coupled failure with tax escrow: consolidated refund pool includes tax escrow.

#### GAP-12: Events Update (Section 10)
**Current:** No sell events, no tax escrow events, no refund-with-burn events
**Add:**
- `TokensSold` event (user, token, tokens_sold, sol_received_net, tax_amount, new_tokens_sold, current_price, slot)
- `TaxCollected` event (token, amount, escrow_balance, slot)
- `EscrowConsolidated` event (token, escrow_amount, new_vault_balance)
- `RefundClaimed` event -- update to include tokens_burned, refund_amount
- `EscrowDistributed` event (token, amount, destination=carnage_fund)

#### GAP-13: Errors Update (Section 11)
**Add:**
- `CurveNotActiveForSell` -- sells only allowed when Active
- `InsufficientTokenBalance` -- user doesn't have enough tokens to sell
- `SlippageExceeded` -- minimum_sol_out not met
- `EscrowNotConsolidated` -- claim_refund called before consolidate_for_refund
- `NothingToBurn` -- user has no tokens to burn for refund
Remove:
- `NotWhitelisted` -- no longer applicable

#### GAP-14: Security Section Rewrite (Section 12)
**Remove:** Section 12.1 (whitelist bypass -- no whitelist), Section 12.3 (Privy friction -- no Privy)
**Add:**
- Front-running analysis with sell mechanics: 15% tax makes sandwich attacks a 15% loss for attacker
- Sell manipulation bounds: maximum extractable value via buy-sell cycles
- Wash-trading analysis: round-trip cost is >= 15% of position
- Tax escrow routing integrity: escrow PDA is program-controlled, cannot be drained externally
- Burn-and-claim solvency: mathematical proof that refund pool is always sufficient
- Cap enforcement safety: ATA balance reads are safe because Transfer Hook prevents transfers

#### GAP-15: Invariants Summary Update (Section 15)
**Current:** 10 invariants including "Buy-only" and "Whitelist required"
**Remove:** "Buy-only", "Whitelist required", "Refunds preserve tokens"
**Add:**
- Sell-back walks curve backward (tokens_sold decreases, price decreases)
- 15% sell tax makes round-trips unprofitable
- SOL vault solvency: vault_balance >= expected_from_integral at all times
- Tax escrow routed correctly: to carnage on success, consolidated for refund on failure
- Burn-and-claim is token-proportional and always solvent
- Sells disabled when Filled

### Sections to REMOVE

#### GAP-16: WhitelistEntry Account (Section 5.5)
**Current:** Full WhitelistEntry struct definition with verification_hash, Privy reference
**Action:** Remove entirely. Add note: "Open access -- no whitelist. Per-wallet cap (20M) is sole sybil resistance."

#### GAP-17: ReserveState Account (Section 5.6)
**Current:** ReserveState struct with crime_vault, fraud_vault, profit_vault
**Action:** Remove entirely. Add note: "Reserve tokens managed by existing protocol infrastructure (see Protocol_Initialization_and_Launch_Flow.md)."

#### GAP-18: add_to_whitelist Instruction (Section 8.4)
**Current:** Full instruction definition with backend authority
**Action:** Remove entirely.

#### GAP-19: Whitelist Constraint in Purchase (Section 6.3)
**Current:** "Whitelist Requirement" subsection with PDA derivation
**Action:** Remove entirely. Replace with note about open access.

#### GAP-20: ParticipantState Account (Section 5.4)
**Current:** Full ParticipantState struct with tokens_purchased, sol_spent, refund_claimed
**Action:** Remove entirely. Cap enforcement via ATA balance reads. Refund via burn-and-claim. Purchase history via events.

## Cross-Reference Consistency Requirements

### Protocol_Initialzation_and_Launch_Flow.md (docs/archive/)

| Section | Issue | Required Change |
|---------|-------|-----------------|
| Phase 5 (Section 9) | References "Initialize Privy whitelist authority" | Remove Privy whitelist authority step |
| Section 9.4 | `initializeWhitelistAuthority` code block | Remove entire subsection |
| Section 9.5 | Verification checkpoint mentions "Privy whitelist authority set" | Remove that checklist item |
| Phase 2 (Section 6.2) | Whitelist entries list: 14 entries | Verify curve vaults still correct; add tax escrow PDAs if they need whitelisting (they do NOT -- escrow is SOL-only PDA, no token transfers) |
| Phase 8 (Section 12) | `execute_transition` references CRIME/PROFIT and FRAUD/PROFIT pools | These were replaced by Conversion Vault in v1.1 -- already outdated, note discrepancy |
| Overview (Section 2.1) | Phase 5 diagram says "Initialize Privy whitelist authority" | Update diagram text |
| Section 4.1 | Build artifacts list: 6 programs | Add 7th program (curve_program or bonding_curve) |
| Section 5.1 | Deploy order: 6 programs | Add 7th program with dependencies |
| Section 15 | Transaction list: 56 transactions | Will change with whitelist removal and new instructions |
| General | PROFIT supply listed as 50M | Should be 20M (corrected in v1.1, see MEMORY.md) |

### Transfer_Hook_Spec.md (docs/archive/)

| Section | Issue | Required Change |
|---------|-------|-----------------|
| Section 4 | Whitelist: 14 entries, entries #5-8 are CRIME/PROFIT and FRAUD/PROFIT pool vaults | These pools were replaced by Conversion Vault in v1.1. Either update to reference Conversion Vault vaults, or note that these are legacy entries from pre-v1.1 |
| Section 14.2 | Integration tests mention "Bonding curve -> User wallet (curve purchase)" | Add "User wallet -> Bonding curve (curve sale)" for sell-back |
| Section 4 | May need additional whitelist entries | Tax escrow PDAs do NOT need whitelisting (they hold SOL only, not tokens). Conversion Vault token accounts may need whitelisting if not already present. Verify against current deployed whitelist. |

### Key Finding: Cross-Reference Docs Are Already Partially Outdated

Both `Protocol_Initialzation_and_Launch_Flow.md` and `Transfer_Hook_Spec.md` reference CRIME/PROFIT and FRAUD/PROFIT AMM pools, which were **replaced by the Conversion Vault in v1.1** (see MEMORY.md). The Conversion Vault was deployed as the 6th program. The spec update should note these discrepancies but NOT attempt to fully reconcile v1.1 changes to these archived docs -- that was out of scope for v1.1 and would be a separate cleanup effort.

**Recommendation for Phase 70:** Add a "v1.2 Cross-Reference Notes" section to the bottom of Bonding_Curve_Spec.md documenting known inconsistencies in cross-reference docs. Then make the minimum surgical edits to Protocol_Init and Transfer_Hook docs to fix curve-specific inconsistencies (whitelist removal, sell-back, 7th program). Do NOT attempt full reconciliation of v1.1 Conversion Vault changes in these archived docs.

## Common Pitfalls

### Pitfall 1: Tax Deduction Ordering Ambiguity
**What goes wrong:** Spec says "15% tax on sells" but doesn't specify whether tax is deducted from SOL output or token input.
**Why it happens:** Natural language is ambiguous. "15% sell tax" could mean: (a) user gets 85% of integral SOL, or (b) 85% of tokens count toward the integral.
**How to avoid:** Spec MUST include explicit numbered steps:
1. Compute `SOL_gross = integral(tokens_sold - tokens_selling, tokens_sold)`
2. Compute `tax = SOL_gross * 15 / 100`
3. Compute `SOL_net = SOL_gross - tax`
4. Transfer `SOL_net` to user
5. Transfer `tax` to tax_escrow PDA
6. Decrement `tokens_sold` by full `tokens_selling` amount

### Pitfall 2: Refund Formula Denominator Race Condition
**What goes wrong:** Spec says "proportional refund" but doesn't specify what `tokens_sold` means during an ongoing refund window where multiple users are claiming.
**Why it happens:** Each burn-and-claim decreases `tokens_sold`, changing the proportion for subsequent claimers.
**How to avoid:** Spec MUST clarify the exact formula: `refund = (user_tokens / current_tokens_sold) * current_vault_balance`. Because both numerator (user's tokens) and denominator (total outstanding) shrink proportionally, and vault balance shrinks by exactly the refunded amount, subsequent claimers always get their fair share. Include a worked example with 3+ users claiming sequentially to prove correctness.

### Pitfall 3: Inconsistent ParticipantState References
**What goes wrong:** Spec removes ParticipantState but doesn't update all references. Implementation team builds ParticipantState from a missed reference.
**Why it happens:** ParticipantState is referenced in Sections 5.4, 6.1, 8.5, 8.7, 9.2, 13.x, 14.x.
**How to avoid:** Search-and-replace audit. Every `participant_state`, `participant.tokens_purchased`, `ParticipantState` reference must be removed or replaced with ATA balance reads.

### Pitfall 4: Missing Sells-Disabled-When-Filled Check
**What goes wrong:** Spec adds sell instruction but doesn't explicitly state it's disabled when Filled.
**Why it happens:** Easy to assume "Active only" is obvious.
**How to avoid:** Explicit validation in sell instruction: `require!(curve.status == CurveStatus::Active, CurveError::CurveNotActiveForSell)`. Add to state machine transition table. Add to invariants.

### Pitfall 5: Cross-Reference Doc Rabbit Hole
**What goes wrong:** Attempting to fully reconcile Protocol_Init and Transfer_Hook specs with all v1.1 and v1.2 changes turns into a multi-day effort.
**Why it happens:** These docs were written for earlier milestones and have accumulated drift. Full reconciliation requires understanding every v1.1 change.
**How to avoid:** Scope the cross-reference updates to ONLY curve-related changes. Document pre-existing inconsistencies (Conversion Vault replacing PROFIT pools) but mark them as out-of-scope for Phase 70.

## Code Examples

### Reverse Integral (Sell-Back) Formula

```rust
// Source: Derived from existing Section 4.3 buy formula, applied in reverse
// For linear curve P(x) = a + bx:
// SOL returned (gross) = integral from x2 to x1 of P(x)dx
//   where x1 = tokens_sold_before_sell, x2 = tokens_sold_after_sell
//   delta = x1 - x2 = tokens_being_sold
//
// SOL_gross = a * delta + b * (x1^2 - x2^2) / 2
//           = a * delta + b * (x1 + x2) * (x1 - x2) / 2
//           = a * delta + b * (x1 + x2) * delta / 2
//           = delta * (a + b * (x1 + x2) / 2)
//
// This is the SAME formula as buy, just the sign of delta is reversed.
// No new mathematical machinery needed.

fn calculate_sol_for_sell(
    tokens_to_sell: u64,
    current_tokens_sold: u64,
    p_start: u128,
    p_end: u128,
    total_for_sale: u128,
) -> Result<(u64, u64)> {  // Returns (sol_net, tax_amount)
    let x1 = current_tokens_sold as u128;
    let delta = tokens_to_sell as u128;
    let x2 = x1 - delta;  // new tokens_sold after sell

    // SOL_gross = area under curve from x2 to x1
    let b = (p_end - p_start) * PRECISION / total_for_sale;
    let a = p_start;

    let sol_gross = delta * (a + b * (x1 + x2) / (2 * total_for_sale));

    // 15% tax
    let tax = sol_gross * 15 / 100;
    let sol_net = sol_gross - tax;

    Ok((sol_net as u64, tax as u64))
}
```

### Burn-and-Claim Refund Formula

```rust
// Source: Standard DeFi burn-and-claim pattern (pump.fun, Raydium Launchpad)
fn claim_refund(
    user_token_balance: u64,
    total_tokens_outstanding: u64,  // = tokens_sold (from CurveState)
    total_refund_pool: u64,          // = sol_vault lamports (after consolidation)
) -> Result<u64> {
    // Proportional share: user gets (their tokens / total outstanding) * pool
    let refund = (user_token_balance as u128)
        .checked_mul(total_refund_pool as u128)
        .ok_or(CurveError::Overflow)?
        .checked_div(total_tokens_outstanding as u128)
        .ok_or(CurveError::DivisionByZero)?;

    // After this:
    // - tokens_sold decreases by user_token_balance
    // - vault balance decreases by refund
    // - next claimer's proportion is still correct

    Ok(refund as u64)
}
```

### State Machine Transition Table (Spec Format)

```
CurveStatus transitions:

  Initialized --[start_curve]--> Active
    Guard: curve funded, authority signer

  Active --[purchase (fills)]--> Filled
    Guard: tokens_sold >= TARGET_TOKENS after purchase

  Active --[mark_failed]--> Failed
    Guard: clock.slot > deadline_slot

  Filled --[finalize_transition]--> Graduated
    Guard: partner curve also Filled or Graduated

  Filled --[partner fails]--> (Filled, but refund_eligible = true)
    Guard: partner curve status == Failed
    Note: Status stays Filled; is_refund_eligible() returns true

  No other transitions are valid. Graduated and Failed are terminal.
```

## State of the Art

| Old Approach (Current Spec) | New Approach (v1.2) | Impact |
|-------|---------|--------|
| Buy-only curve | Buy + sell with reverse integral | Adds ~4 new sections to spec |
| ParticipantState PDA per user | ATA balance reads (no PDA) | Removes Section 5.4, simplifies purchase/refund |
| WhitelistEntry + Privy | Open access, 20M cap only | Removes Sections 5.5, 6.3, 8.4, 12.1, 12.3 |
| SOL-spent-based refund | Burn-and-claim token-proportional refund | Rewrites Section 8.7, 9.x |
| ReserveState in curve program | Reserve managed by existing infrastructure | Removes Section 5.6 |
| Simple Failed/Transitioned | Full state machine with tax escrow lifecycle | Expands Sections 5.2, 8.x, 9.x |

## Open Questions

1. **Participant count tracking approach**
   - What we know: CONTEXT.md marks this as "Claude's discretion"
   - Options: (a) lightweight counter in CurveState incremented on first buy (check if ATA had zero balance), (b) emit events only, derive count off-chain
   - Recommendation: Option (a) -- counter is cheap (4 bytes), useful for on-chain display, and avoids requiring an indexer for a basic stat. Spec should define the approach clearly.

2. **CurveState field layout and size**
   - What we know: Current spec says 135 bytes. v1.2 adds tax_escrow pubkey, tokens_returned, sol_returned, tax_collected fields
   - What's unclear: Exact byte count depends on whether we keep participant_count and which optional fields are included
   - Recommendation: Spec should include updated size calculation. Planner should create a task specifically for this.

3. **Conversion Vault whitelist entries in Transfer_Hook_Spec.md**
   - What we know: v1.1 replaced CRIME/PROFIT and FRAUD/PROFIT pools with Conversion Vault. The whitelist entries may have been updated during v1.1 deploy but the spec doc wasn't updated.
   - What's unclear: Whether the deployed whitelist matches Transfer_Hook_Spec.md's 14-entry list
   - Recommendation: Note the discrepancy in the spec, but do NOT attempt to fix it in Phase 70. This is a pre-existing v1.1 issue.

4. **Execute_transition vs multi-TX graduation**
   - What we know: Current spec has a monolithic `execute_transition` instruction (32 accounts). CONTEXT.md and SUMMARY.md both specify client-side multi-TX orchestration.
   - What's unclear: Exact instruction breakdown for the multi-TX sequence
   - Recommendation: Replace monolithic `execute_transition` with a set of smaller instructions (`prepare_transition`, `distribute_tax_escrow`, `finalize_transition`) plus client-side orchestration notes. Detailed TX sequence is Phase 73-74 scope, but spec should define the instruction interfaces.

## Spec Section Change Checklist

For planner reference -- every modification needed:

| # | Section | Action | GAP Ref | Priority |
|---|---------|--------|---------|----------|
| 1 | Section 2 (Design Constraints) | MODIFY: remove buy-only, remove whitelist, add sell-back | GAP-07 | HIGH |
| 2 | Section 4 (Curve Formula) | ADD: Section 4.5 reverse integral for sells | GAP-01 | HIGH |
| 3 | Section 5.1 (CurveState) | MODIFY: add sell/tax fields, update size | GAP-08 | HIGH |
| 4 | Section 5.2 (CurveStatus) | MODIFY: expand state machine, add transition table | GAP-05 | HIGH |
| 5 | Section 5.4 (ParticipantState) | REMOVE entirely | GAP-20 | HIGH |
| 6 | Section 5.5 (WhitelistEntry) | REMOVE entirely | GAP-16 | HIGH |
| 7 | Section 5.6 (ReserveState) | REMOVE entirely | GAP-17 | HIGH |
| 8 | Section 5.x (Tax Escrow PDA) | ADD new subsection | GAP-02 | HIGH |
| 9 | Section 6.1 (Wallet Cap) | MODIFY: ATA balance reads, not ParticipantState | GAP-09 | HIGH |
| 10 | Section 6.3 (Whitelist) | REMOVE entirely | GAP-19 | HIGH |
| 11 | Section 8.4 (add_to_whitelist) | REMOVE entirely | GAP-18 | HIGH |
| 12 | Section 8.5 (purchase) | MODIFY: remove whitelist, remove ParticipantState | GAP-09 | HIGH |
| 13 | Section 8.x (sell) | ADD new instruction | GAP-03 | HIGH |
| 14 | Section 8.7 (claim_refund) | REPLACE with burn-and-claim | GAP-04, GAP-10 | HIGH |
| 15 | Section 8.x (consolidate_for_refund) | ADD new instruction | GAP-02 | HIGH |
| 16 | Section 8.x (distribute_tax_escrow) | ADD new instruction | GAP-02 | HIGH |
| 17 | Section 8.8-8.9 (transition) | MODIFY: multi-TX graduation | GAP-06 | MEDIUM |
| 18 | Section 9 (Failure Handling) | MODIFY: burn-and-claim, tax escrow consolidation | GAP-11 | HIGH |
| 19 | Section 10 (Events) | ADD sell/tax/refund events | GAP-12 | MEDIUM |
| 20 | Section 11 (Errors) | ADD/REMOVE errors | GAP-13 | MEDIUM |
| 21 | Section 12 (Security) | REWRITE: remove whitelist, add sell analysis | GAP-14 | HIGH |
| 22 | Section 13 (Testing) | MODIFY: add sell/tax/refund test requirements | - | MEDIUM |
| 23 | Section 14 (UI Integration) | MODIFY: add sell preview, refund preview | - | LOW |
| 24 | Section 15 (Invariants) | MODIFY: replace outdated invariants | GAP-15 | HIGH |
| 25 | Cross-ref: Protocol_Init | MODIFY: remove Privy, add 7th program, fix PROFIT supply | Cross-ref | MEDIUM |
| 26 | Cross-ref: Transfer_Hook | MODIFY: add sell test case, note v1.1 discrepancy | Cross-ref | MEDIUM |

## Sources

### Primary (HIGH confidence)
- `/Users/mlbob/Projects/Dr Fraudsworth/docs/Bonding_Curve_Spec.md` -- 1,500 lines, full existing spec analyzed line by line
- `/Users/mlbob/Projects/Dr Fraudsworth/.planning/phases/70-specification-update/70-CONTEXT.md` -- all v1.2 decisions
- `/Users/mlbob/Projects/Dr Fraudsworth/.planning/research/SUMMARY.md` -- comprehensive v1.2 research synthesis
- `/Users/mlbob/Projects/Dr Fraudsworth/.planning/REQUIREMENTS.md` -- SPEC-01 requirement definition
- `/Users/mlbob/Projects/Dr Fraudsworth/.planning/ROADMAP.md` -- phase success criteria
- `/Users/mlbob/Projects/Dr Fraudsworth/docs/archive/Protocol_Initialzation_and_Launch_Flow.md` -- cross-reference doc (1,915 lines)
- `/Users/mlbob/Projects/Dr Fraudsworth/docs/archive/Transfer_Hook_Spec.md` -- cross-reference doc (666 lines)

### Secondary (MEDIUM confidence)
- [Bonding curve sell-back math (WebSearch)](https://yos.io/2018/11/10/bonding-curves/) -- confirms linear integral approach for buy/sell
- [Pump.fun fee structure (WebSearch)](https://pump.fun/docs/fees) -- confirms industry precedent for sell fees on bonding curves
- [Pump.fun mechanism (WebSearch)](https://flashift.app/blog/bonding-curves-pump-fun-meme-coin-launches/) -- confirms sell-back walks curve backward

### Tertiary (LOW confidence)
- None. All findings verified against primary project sources or established math.

## Metadata

**Confidence breakdown:**
- Gap analysis: HIGH -- direct comparison of existing spec text vs CONTEXT.md decisions
- Sell-back math: HIGH -- linear integral is well-understood; reverse is algebraically identical
- State machine: HIGH -- derived directly from CONTEXT.md decisions + existing CurveStatus enum
- Cross-reference delta: HIGH -- line-by-line comparison performed
- Pitfalls: MEDIUM -- based on experience with specification ambiguity; some pitfalls are project-specific

**Research date:** 2026-03-03
**Valid until:** indefinite (this is a one-time gap analysis for a specific spec version)
