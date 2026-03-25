# Phase 25: Carnage Fund Execution - Context

**Gathered:** 2026-02-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement Carnage Fund rebalancing with ~4.3% trigger probability per epoch, VRF-determined action/target, and atomic execution at CPI depth 4. Carnage accumulates 24% of taxes and either burns (98%) or sells (2%) held tokens, then buys VRF-determined target with SOL.

The spec (Docs/Carnage_Fund_Spec.md) is comprehensive — this context captures clarifications and decisions made during discussion.

</domain>

<decisions>
## Implementation Decisions

### Vault Architecture
- Native SOL + token accounts: SOL stored as lamports in CarnageFundState PDA, CRIME/FRAUD as separate token account PDAs
- Deposits: Tax Program only — enforced via CPI signer check
- Initialization: Single `initialize_carnage_fund` instruction creates CarnageFundState + both token vaults atomically

### Execution Model
- Two-instruction atomic bundle (preferred):
  - Instruction 1: `consume_randomness` — reads VRF, updates taxes, sets `carnage_pending = true` when triggered
  - Instruction 2: `execute_carnage_atomic` — executes Carnage, clears pending on success
  - Both instructions bundled in same transaction = atomic = no MEV window
- `execute_carnage_atomic` is a **public instruction** (not internal-only)
- Requires `carnage_pending = true` — consume_randomness must be called first
- Fallback path: If bundle fails repeatedly, caller can:
  1. Call `consume_randomness` alone (sets pending, starts 100-slot deadline)
  2. Call `execute_carnage` separately (opens brief MEV window, but allows protocol to continue)

### Fallback Behavior
- `consume_randomness` auto-expires stale pending Carnage if deadline has passed — eliminates overlap edge case
- Holdings unchanged when Carnage expires — tokens stay in vault for next trigger
- No bounty for Carnage execution — the arbitrage opportunity IS the incentive

### Claude's Discretion
- PDA seed strategy for CRIME/FRAUD vaults (pick simplest/cleanest approach)
- Internal helper function structure
- Event field details beyond what spec defines

</decisions>

<specifics>
## Specific Ideas

- The spec (Docs/Carnage_Fund_Spec.md) is the source of truth for VRF byte allocation, trigger thresholds, CPI depth analysis, and account structures
- Two-instruction bundle was chosen because: (1) single instruction approaches CU limit, (2) bundled instructions in same tx maintains atomicity for MEV protection
- Burn uses SPL Token burn instruction (reduces total supply permanently)
- Sell proceeds go to SOL vault and are immediately used for the subsequent buy step

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 25-carnage-fund-execution*
*Context gathered: 2026-02-06*
