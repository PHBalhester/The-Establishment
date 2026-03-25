# Phase 19: Tax Program PROFIT Swaps - Context

**Gathered:** 2026-02-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Untaxed swap routing for PROFIT pools via CPI to AMM. Users swap CRIME/FRAUD for PROFIT (and vice versa) with 0% protocol tax — only the 0.5% AMM LP fee applies. Tax distribution logic is not involved.

</domain>

<decisions>
## Implementation Decisions

### Instruction Design
- Follow spec exactly: two separate instructions (`swap_profit_buy`, `swap_profit_sell`)
- Consistent with Phase 18 pattern (separate `swap_sol_buy`, `swap_sol_sell`)
- No consolidation to single instruction with direction parameter

### Event Structure
- Use `UntaxedSwap` event as defined in spec (Section 20.3)
- Fields: user, pool_type, direction, input_amount, output_amount, lp_fee, slot
- No additional fields beyond spec

### Account Pattern
- No tax-related accounts (no epoch_state, staking_escrow, carnage_vault, treasury)
- Both input and output use Token-2022 program (dual hooks)
- Same `swap_authority` PDA pattern as Phase 18

### Slippage Handling
- Same pattern as Phase 18: user provides `minimum_output` parameter
- Return `SlippageExceeded` error if output falls below threshold

### Claude's Discretion
- Internal helper organization (reuse Phase 18 patterns where applicable)
- Error message wording for PROFIT-specific edge cases
- Test scenario prioritization

</decisions>

<specifics>
## Specific Ideas

### Technical Flags for Research
1. **Dual transfer hooks** — PROFIT swaps invoke TWO transfer hooks (one per Token-2022 side), unlike SOL swaps which invoke only one. Researcher should verify ExtraAccountMetaList passthrough.

2. **AMM instruction** — Verify `swap_profit_pool` instruction exists in AMM and handles dual Token-2022 transfers correctly.

3. **Account list differences** — Simpler than SOL swaps (no tax distribution accounts), but different validation logic needed.

### Reference Documents
- Tax_Pool_Logic_Spec.md Section 10.4-10.5 (account lists)
- Tax_Pool_Logic_Spec.md Section 20.3 (UntaxedSwap event)
- Tax_Pool_Logic_Spec.md Section 11.3 (CPI depth: 3)
- Phase 18 implementation for CPI routing patterns

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 19-profit-swaps*
*Context gathered: 2026-02-06*
