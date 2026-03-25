# Phase 11: SOL Pool Swaps - Context

**Gathered:** 2026-02-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Execute swaps in both directions through CRIME/SOL and FRAUD/SOL mixed pools (T22/SPL) with correct constant-product math, LP fee deduction, slippage protection, and k-invariant preservation. Uses transfer routing helpers from Phase 10. Access control (CPI-only gating via Tax Program PDA) is Phase 13.

</domain>

<decisions>
## Implementation Decisions

### Swap direction model
- **Direction enum argument:** Single `swap_sol_pool` instruction with a `direction: SwapDirection` parameter (AtoB / BtoA)
- Caller explicitly declares swap direction — no inference from account ordering
- Single account struct serves both directions; instruction uses direction to determine which vault receives input and which sends output
- Chosen for CPI ergonomics: Tax Program passes a direction enum trivially in Phase 13, rather than carefully arranging accounts

### Slippage parameters
- **min_amount_out only** — no deadline/expiry at the AMM level
- Solana's blockhash expiry (~60 seconds) already prevents stale transactions at the runtime level
- AMM is CPI-only; the Tax Program constructs the AMM call in the same transaction as the user's request — no separate AMM transaction sits in a mempool
- If deadline protection is ever needed, it belongs at the Tax Program layer (the user-facing instruction), not the AMM primitive
- min_amount_out flows from user through Tax Program to AMM: Tax Program deducts taxes from input first, then passes the user's slippage floor to the AMM on the post-tax amount

### Reentrancy protection
- **Add a simple bool reentrancy guard** (`locked: bool`) on PoolState
- Set `locked = true` before swap execution, clear after transfers complete
- Solana's runtime borrow rules already prevent same-pool re-entry via CPI, and CEI ordering handles reserve consistency — this is belt-and-suspenders defense-in-depth
- Simple bool, not a status enum — reentrancy guard has one job, a bool does exactly that job. Status enums invite scope creep (Paused, Migrating) which are new capabilities that belong elsewhere
- **Spec deviation:** Adding `locked: bool` to PoolState changes INIT_SPACE (currently 223 bytes → 224 bytes). Document this as a formal deviation since it changes the pool account layout

### Swap event detail level
- **Spec fields + direction + both timestamp and slot**
- Core spec fields (Section 13.1): pool, user, input_mint, output_mint, amount_in, amount_out, lp_fee, reserve_a, reserve_b
- Added: `direction` (SwapDirection, 1 byte) — makes indexer code trivially simpler
- Added: both `timestamp` (unix_timestamp from Clock) AND `slot` (from Clock) — frontends use timestamp for display, data products use slot for precise ordering
- Rationale: protocol aims to be easy for third-party developers to build on. Including both saves every downstream consumer from extra RPC lookups
- Fee rate (lp_fee_bps) omitted from event — it's immutable on pool state, query once and cache

### Claude's Discretion
- Account struct naming: by pool position (a/b) vs by role (input/output) — Claude picks based on Anchor constraint ergonomics
- Instruction args: `amount_in + direction` vs `amount + input_mint` — Claude picks based on consistency with direction enum decision
- Reserve update ordering within CEI pattern
- Exact reentrancy guard error code and message
- Whether to include lp_fee_bps in SwapEvent (leaning omit, but Claude can include if it simplifies indexer DX significantly)

</decisions>

<specifics>
## Specific Ideas

- AMM is a "pure swap primitive" that the Tax Program wraps — the AMM never sees taxes, never knows about epochs, never interacts with governance. All it does is: validate, compute, transfer, update reserves, emit event
- The CPI-only access model (Phase 13) is cryptographically enforced via Tax Program PDA — no frontend can bypass taxes regardless of who builds it
- The user values making the protocol easy for others to build on — event design should favor downstream developer experience over minimal byte count
- Transfer routing helpers from Phase 10 (`transfer_t22_checked`, `transfer_spl`) are consumed directly — Phase 11 is the first real integration test of that abstraction

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 11-sol-pool-swaps*
*Context gathered: 2026-02-04*
