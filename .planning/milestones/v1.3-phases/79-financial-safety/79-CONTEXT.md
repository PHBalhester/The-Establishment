# Phase 79: Financial Safety - Context

**Gathered:** 2026-03-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Every SOL transfer instruction protects against rent-exempt drain, zero-minimum CPI, and partial fill edge cases. Five specific fixes across staking, tax, epoch, and bonding curve programs. No new features or capabilities.

</domain>

<decisions>
## Implementation Decisions

### Rent-Exempt Reservation (FIN-01 + FIN-03)
- Use dynamic `Rent::get()?.minimum_balance(0)` at runtime (not hardcoded constant) -- matches existing bonding curve pattern
- **Staking claim (FIN-01):** Hard error (`InsufficientEscrowBalance`) when `escrow_balance - rent_exempt < rewards_to_claim`. User must wait for more tax revenue. No partial claims.
- **Epoch bounty (FIN-03):** Skip bounty (don't block transition) when `vault_balance < TRIGGER_BOUNTY_LAMPORTS + rent_exempt_min`. Epoch still advances, crank just gets no bounty. Protocol never stalls.

### Sell Path AMM Floor (FIN-02)
- Compute gross floor from user's minimum_output: `gross_floor = ceil(minimum_output * 10000 / (10000 - sell_tax_bps))`
- Pass this computed floor to AMM CPI as `minimum_amount_out` (replacing the current `0`)
- User's minimum_output only -- do NOT double-layer with the 50% protocol floor (MINIMUM_OUTPUT_FLOOR_BPS is enforced separately in tax_math)
- Sell path only -- buy path is out of scope for FIN-02 (different mechanics, tax on input not output)

### Partner Curve Identity (FIN-05)
- Add `partner_mint: Pubkey` field to CurveState struct (set during `initialize_curve`)
- `claim_refund` validates `partner_curve_state.token_mint == curve_state.partner_mint`
- Apply same validation to `consolidate_for_refund` (identical partner_curve_state pattern)
- Schema change requires redeploy on devnet -- acceptable, devnet is for testing, v1.4 does full fresh deploy anyway

### Partial Fill Assertion (FIN-04)
- Add explicit `require!(actual_sol <= sol_amount, CurveError::PartialFillOvercharge)` after calculation in purchase.rs
- Also audit sell.rs for any path where actual_sol_out could exceed what vault can safely pay -- apply same defensive assertion pattern
- Simple require!, not silent capping -- bugs should surface as errors, not be hidden

### Claude's Discretion
- Exact error code names and messages for new errors
- Whether to add a new error variant or reuse existing ones
- Test structure (unit vs integration for each fix)
- Sell path audit scope -- which specific sell.rs paths need the assertion

</decisions>

<specifics>
## Specific Ideas

- Bounty is 0.001 SOL (1,000,000 lamports) from carnage_sol_vault -- small enough that skipping is fine
- Crank runner already auto-tops-up vault -- on-chain fix makes the mitigation defense-in-depth
- Partner mint approach is future-proof (works for any curve pair, not just CRIME/FRAUD)

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `Rent::get()?.minimum_balance(0)` pattern: Used in bonding curve sell.rs, claim_refund.rs, execute_carnage.rs
- `calculate_output_floor()` in tax_math.rs: Existing floor calculation that can inform gross floor derivation
- CurveState struct: Already has bump, token_mint, status fields -- partner_mint fits naturally

### Established Patterns
- CEI pattern (Checks-Effects-Interactions) in staking claim.rs -- rent check fits in Checks section
- Bounty skip pattern already in trigger_epoch_transition.rs (lines 195-227) -- just needs rent-aware threshold
- PDA seeds validation for partner_curve_state already in place -- partner_mint adds an inner constraint

### Integration Points
- Staking claim.rs: Add rent-exempt check before rewards transfer (line 103 area)
- Tax swap_sol_sell.rs: Change minimum_amount_out construction (line 146 area)
- Epoch trigger_epoch_transition.rs: Update bounty check condition (line 195)
- Bonding curve purchase.rs: Add require! after actual_sol calculation (line 162 area)
- Bonding curve claim_refund.rs + consolidate_for_refund.rs: Add partner_mint constraint
- Bonding curve state.rs: Add partner_mint field to CurveState
- Bonding curve initialize_curve.rs: Set partner_mint during initialization

</code_context>

<deferred>
## Deferred Ideas

- Buy path AMM floor (same pattern as sell but different mechanics) -- could be a future hardening item
- Full devnet redeploy after schema change -- v1.4 scope (MN-03)

</deferred>

---

*Phase: 79-financial-safety*
*Context gathered: 2026-03-08*
