# Phase 73: Graduation + Refund - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement the bonding curve state machine for success (graduation) and failure (refund) paths. Delivers 4 new on-chain instructions: mark_failed, consolidate_for_refund, claim_refund, prepare_transition. Plus the distribute_tax_escrow instruction for routing escrow SOL to carnage fund on graduation. Does NOT include vault withdrawal instructions (Phase 74), finalize_transition (Phase 74), or client-side orchestration (Phase 74).

</domain>

<decisions>
## Implementation Decisions

### Refund Token Handling
- Burn-and-claim: user's tokens are destroyed when claiming refund SOL (spec Section 8.8 authoritative over loose roadmap wording)
- Direct Token-2022 burn — standard spl_token_2022::burn, user signs as token authority, no Transfer Hook involvement (burn doesn't trigger hooks)
- All-or-nothing: user's entire ATA balance is burned in a single claim. No partial refunds — prevents rounding exploitation via many small claims

### Consolidation Mechanism
- Separate permissionless instruction (consolidate_for_refund) must be called before any claim_refund
- Boolean flag `escrow_consolidated: bool` added to CurveState (LEN changes from 191 to 192 bytes)
- Explicit flag over implicit lamport check — more readable and auditable

### Failure Trigger Fairness
- 150-slot grace buffer (~1 minute) after deadline_slot before mark_failed can be called
- New constant: FAILURE_GRACE_SLOTS = 150
- Purchases still blocked at deadline_slot (hard cutoff unchanged). Buffer only delays when failure can be locked in
- Gives in-flight last-second purchase TXs time to finalize on-chain before failure becomes lockable
- Partner failure: automatic via existing is_refund_eligible() compound state check — no explicit "coupled-failed" trigger needed

### Graduation Asset Custody
- prepare_transition is admin-only (deployer authority, not permissionless)
- Trust the admin — no on-chain timeout fallback for unresponsive admin. We are the deployer.
- finalize_transition deferred to Phase 74 (bundled with orchestration it confirms)
- Vault withdrawal instructions deferred to Phase 74 (Phase 73 focuses on state machine)
- distribute_tax_escrow included in Phase 73 (routes escrow to carnage fund, gated on Graduated status)

### Refund Dust and Rounding
- Floor rounding (protocol-favored): refund = floor(user_balance * refund_pool / tokens_sold)
- Consistent with Phase 71/72 buy/sell rounding convention
- Dust left in vault after all claims (0 to ~N lamports) — acceptable, not swept
- Explicit DivisionByZero / NoTokensOutstanding error check even though logically impossible — defense-in-depth, prevents panic

### Claude's Discretion
- Error variant naming and granularity (how specific per-instruction errors should be)
- Plan breakdown structure (number of plans, grouping of instructions)
- Property test design and invariant selection
- Account struct naming conventions

</decisions>

<specifics>
## Specific Ideas

- Grace buffer is a deviation from spec Section 8.7 which says instant failure marking — spec update not required since it's an additive safety measure
- CurveState::LEN change (191 -> 192) will require updating the LEN constant, Borsh serialization test, and account allocation in initialize_curve
- The 5 instructions for Phase 73: mark_failed, consolidate_for_refund, claim_refund, prepare_transition, distribute_tax_escrow
- Events already pre-defined in events.rs: CurveFailed, EscrowConsolidated, EscrowDistributed, RefundClaimed, TransitionPrepared — no new event structs needed

</specifics>

<deferred>
## Deferred Ideas

- Vault withdrawal instructions (withdraw_sol, withdraw_tokens) — Phase 74
- finalize_transition instruction — Phase 74
- Client-side graduation orchestration script — Phase 74
- Permissionless graduation fallback timeout — decided against (trust admin), but could revisit if trust model changes

</deferred>

---

*Phase: 73-graduation-refund*
*Context gathered: 2026-03-04*
