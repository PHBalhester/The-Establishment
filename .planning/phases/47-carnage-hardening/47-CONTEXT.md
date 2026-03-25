# Phase 47: Carnage Hardening - Context

**Gathered:** 2026-02-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Make Carnage Fund execution resilient, slippage-protected, and MEV-resistant. Fix the fallback path, add minimum output enforcement, enforce VRF+Carnage atomicity on-chain, and handle failure gracefully. No new Carnage capabilities -- this hardens what exists.

</domain>

<decisions>
## Implementation Decisions

### Slippage floor design
- Pool-state-based calculation: read current reserves via `read_pool_reserves()`, compute expected output using constant-product formula, reject if actual output < 85% of expected (15% tolerance)
- No absolute minimum floor -- pool-state-based is sufficient
- Primary MEV defense is atomicity + VRF unpredictability, not the slippage floor
- The floor is a backstop against bugs or extreme same-TX deviations, not a sandwich catcher
- Large swaps into shallow pools will NOT trigger the floor because the expected output already accounts for natural price impact

### Fallback path activation
- Dual-trigger: client immediately retries via fallback on atomic failure, PLUS 300-slot (~2 minute) timeout after which anyone (including external cranker bots) can call `execute_carnage`
- Fallback has a more lenient 25% slippage tolerance (vs 15% on atomic path) -- prioritize executing over optimal price when in recovery mode
- Fallback uses the correct discriminator and swap_authority account (existing bug fix from SEC-04/FIX-02)

### Atomicity enforcement
- On-chain state lock on EpochState: `carnage_pending` flag + `carnage_deadline` slot
- When `consume_randomness` reveals a Carnage epoch, set lock. During lock window, only the atomic CPI path can execute the swap
- After deadline, lock expires and fallback `execute_carnage` becomes callable
- Lock only engages on Carnage epochs -- normal epoch transitions have no lock overhead
- Lock window duration: Claude's discretion (pick based on typical Solana TX confirmation times)

### Failure recovery
- Carry forward: if both paths fail, funds stay in carnage_vault. Next Carnage epoch retries automatically with accumulated balance
- No consecutive failure limit -- update authority will be burnt post-launch, so admin intervention isn't available long-term
- Emit CarnageFailed event on each failure for off-chain monitoring
- Epoch transitions are never blocked by failed Carnage -- epoch moves forward regardless, funds carry

### Claude's Discretion
- CarnageFailed event field selection (balance diagnostic detail vs compute efficiency)
- Exact lock window duration for atomicity state lock (within the 300-slot fallback timeout)
- Whether fallback slippage tolerance (25%) is a separate constant or derived from the primary (15% * 1.67x)

</decisions>

<specifics>
## Specific Ideas

- User noted that update authority will be burnt not long after launch -- all recovery mechanisms must be autonomous, no admin-only escape hatches
- The 50% fixed floor from the original Carnage bug fix was an emergency measure; the pool-state-based approach replaces it with something that adapts to actual pool conditions
- "What if Carnage has 1000 SOL into a shallow pool?" -- confirmed the floor handles this because expected output already includes natural price impact

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 47-carnage-hardening*
*Context gathered: 2026-02-19*
