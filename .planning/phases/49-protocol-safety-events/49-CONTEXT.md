# Phase 49: Protocol Safety & Events - Context

**Gathered:** 2026-02-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Add operational safety mechanisms (minimum output floor, escrow reconciliation) and comprehensive event emissions for off-chain monitoring. Covers SEC-08, SEC-09, SEC-10, FIX-06. SEC-06 (emergency pause) is explicitly declined by the user.

</domain>

<decisions>
## Implementation Decisions

### Emergency Pause (SEC-06) — DECLINED
- User explicitly decided NOT to implement the pause mechanism
- Rationale: the protocol should never be paused; if an exploit is found, the response is to deploy a patched program
- SEC-06 will be marked as declined in REQUIREMENTS.md
- No `is_paused` field, no `set_paused` instruction, no pause checks

### Sell-side minimum floor (SEC-10)
- Percentage-based floor: output must be >= 50% of constant-product expected output
- Applies to BOTH buy-side AND sell-side swaps (not just sells)
- Consistent with Carnage slippage floor approach (same 50% threshold)
- User's explicit `minimum_amount_out` is still honored if stricter than the floor
- For multi-hop (PROFIT pool) swaps: Claude's discretion on per-leg vs final-output enforcement

### Event emission coverage (SEC-09 + FIX-06)
- Fix broken fields: buy-side TaxedSwap events currently emit output_amount=0 — populate with actual values
- Fix broken fields: UntaxedSwap events currently emit output_amount=0 and lp_fee=0 — populate with actual values
- Add NEW events to: deposit_rewards, epoch transitions, Carnage execution
- Events designed for BOTH operational monitoring AND future analytics dashboard (rich fields)
- Include all relevant fields: amounts, pubkeys, balances, epoch numbers

### Escrow reconciliation (SEC-08)
- deposit_rewards must include escrow_vault in its account struct
- Verify escrow balance increased by expected amount after SOL transfer
- Reconciliation check runs on EVERY call (no threshold-based skipping)
- Claude determines: mismatch behavior (revert vs revert+event), escrow account type, scope expansion to other fund movements

### Claude's Discretion
- Frontend enforcement approach for minimum floor (program-only backstop vs frontend default slippage)
- Multi-hop floor enforcement strategy (per-leg vs final-output)
- UntaxedSwap event field additions (tax breakdown fields or just fix zeros)
- Carnage event field richness (include pool reserves or just amounts)
- Escrow reconciliation mismatch behavior (hard revert vs revert+event)
- Whether to extend reconciliation to other fund movements beyond deposit_rewards
- Escrow vault account type determination (check existing code)

</decisions>

<specifics>
## Specific Ideas

- 50% floor was chosen for consistency with Carnage slippage — same mental model across the protocol
- User wants events rich enough to power a future analytics dashboard without needing program redeployment
- User explicitly asked Claude to explain reasoning before decisions — values understanding over speed

</specifics>

<deferred>
## Deferred Ideas

- Emergency pause mechanism — explicitly declined, not deferred. If reconsidered pre-mainnet, could be added as a quick phase (low complexity: ~35 lines of Rust)
- Rate limiting / per-epoch volume caps — mentioned as alternative to pause, not pursued

</deferred>

---

*Phase: 49-protocol-safety-events*
*Context gathered: 2026-02-20*
