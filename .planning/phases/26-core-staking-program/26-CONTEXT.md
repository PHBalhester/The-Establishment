# Phase 26: Core Staking Program - Context

**Gathered:** 2026-02-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can stake PROFIT tokens and claim pending SOL rewards through stake/unstake/claim instructions. State accounts (StakePool, UserStake) track positions. Math module uses cumulative reward-per-token pattern for fair distribution. First-depositor attack prevented via MINIMUM_STAKE dead stake.

Cross-program integration (Tax Program deposit_rewards, Epoch Program update_cumulative) is Phase 27.

</domain>

<decisions>
## Implementation Decisions

### Instruction Behavior
- Partial unstake allowed with minimum enforcement: remaining balance must be >= MINIMUM_STAKE, otherwise auto-full-unstake
- Instant unstake: no cooldown period, user receives PROFIT immediately
- Unstake and claim in same transaction: unstake returns principal + pending rewards atomically

### Error Handling
- Errors include recovery hints (e.g., "StakeBelowMinimum: minimum is 1000 PROFIT")
- Pre-validate balance before transfer attempt (better error: "Insufficient PROFIT balance" vs cryptic Token-2022 error)

### Claude's Discretion
- Account state design: UserStake history fields, PDA seed schemes, closeable accounts, total_users tracking
- Stake instruction auto-claim behavior (checkpoint only vs claim-first)
- Claim minimum threshold (any amount vs minimum lamports)
- Error message verbosity and math error granularity
- Event types, fields, format (Anchor emit! vs custom), and indexer-friendly fields

</decisions>

<specifics>
## Specific Ideas

- Follow Synthetix/Quarry cumulative reward-per-token pattern (established in v0.6 research)
- Use 1e18 PRECISION constant for DeFi math (from research)
- Checkpoint pattern prevents flash loan attacks (stake->claim same epoch blocked)
- MINIMUM_STAKE dead stake at pool initialization prevents first-depositor attack

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 26-core-staking-program*
*Context gathered: 2026-02-06*
