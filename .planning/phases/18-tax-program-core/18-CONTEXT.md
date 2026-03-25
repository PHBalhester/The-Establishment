# Phase 18: Tax Program Core - Context

**Gathered:** 2026-02-06
**Status:** Ready for planning

<domain>
## Phase Boundary

SOL pool swap routing with asymmetric taxation and atomic distribution. Users can swap SOL for CRIME/FRAUD (and vice versa) with tax applied and collected SOL distributed atomically to staking (75%), carnage (24%), and treasury (1%).

This phase covers `swap_sol_buy` and `swap_sol_sell` instructions only. PROFIT pool swaps are Phase 19. Carnage-exempt swaps are Phase 20.

</domain>

<decisions>
## Implementation Decisions

### Rounding Behavior
- Treasury gets remainder lamports when 75/24/1% split doesn't divide evenly
- Calculation order: Staking (75%) → Carnage (24%) → Treasury (remainder)
- Formula: `treasury = total_tax - staking_portion - carnage_portion`

### Minimum Swap Amounts
- No minimum enforced by the program
- Let economics self-enforce (tx fees ~5000 lamports + slippage discourage dust)
- `InsufficientInput` error fires when output rounds to zero (natural floor)

### Slippage Handling
- `minimum_output` parameter (absolute, not percentage-based)
- Required on every swap instruction (matches Jupiter/Raydium/Orca pattern)
- Reject swap if calculated output < minimum_output

### Test Strategy
- Both unit and integration tests
- Unit tests: all pure functions (tax calculation, distribution split, validation logic)
- Integration tests: deploy real AMM + Transfer Hook, mock Epoch Program for tax rates
- Full CPI chain validation with real token transfers

### Claude's Discretion
- Micro-tax handling when tax < 4 lamports (all to staking, or allow zero splits)
- u128 intermediate usage scope (everywhere vs just tax calculation)
- Where slippage check happens (Tax Program only vs both Tax + AMM)
- InsufficientInput threshold (output == 0 vs output < tax)
- CRIME vs FRAUD test coverage (both tokens vs parameterized single token)

</decisions>

<specifics>
## Specific Ideas

- Slippage UX: Frontend shows "you'll receive ~100 CRIME (after 4% tax)", user sets minimum_output slightly below
- Industry patterns: Follow Jupiter/Raydium/Orca conventions for slippage handling
- Tax transparency: All tax info in TaxedSwap event for off-chain analytics

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 18-tax-program-core*
*Context gathered: 2026-02-06*
