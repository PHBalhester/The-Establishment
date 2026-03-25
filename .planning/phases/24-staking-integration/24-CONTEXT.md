# Phase 24: Staking Integration - Context

**Gathered:** 2026-02-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Connect epoch transitions to staking yield finalization. When `consume_randomness` executes successfully, CPI to Staking Program to signal that the epoch has ended and yield for that period is finalized. Stakers can then claim from the accumulated 75% tax bucket.

Phase 24 delivers the integration mechanism — the full Staking Program is a future milestone.

</domain>

<decisions>
## Implementation Decisions

### CPI Interface Design
- Access model: CPI-gated — only Epoch Program can call `Staking::update_cumulative`
- Pattern follows Tax::swap_exempt (carnage_signer PDA authorization)
- Staking validates caller is Epoch Program via `seeds::program = EPOCH_PROGRAM_ID`

### Stub Program Scope
- Behavior: Track cumulative value — maintains simple state that increments each call
- State includes: `cumulative_epochs: u64`, `last_epoch: u64`, `total_yield_distributed: u64`
- Tests can verify: epoch incremented, CPI completed, state mutated, no double-finalization

### Timing & Ordering
- CPI happens **after tax derivation, before Carnage** in `consume_randomness`
- Logical flow: validate randomness → derive new rates → finalize old epoch yield → check Carnage
- Staking receives notification that epoch N closed — doesn't use randomness directly

### Yield Data Flow
- Source: 75% tax bucket from Tax Program's existing `staking_escrow` account
- SOL movement: **Notify only** — SOL stays in vault, stakers claim later
- Phase 24 signals epoch boundary, doesn't move tokens
- Staking_escrow already exists in Tax Program (swap_sol_buy.rs:331-334)

### Claude's Discretion
- Data passed to `update_cumulative` (epoch number, old rates, or minimal)
- Return data from CPI (none, success/failure, yield stats)
- PDA pattern (staking_authority PDA or direct program verification)
- Stub initialization (separate instruction or init-if-needed)
- Stub location (programs/stub-staking/, programs/mock-staking/, or tests/fixtures/)
- Stub event emission on success
- Failure handling (atomic revert vs continue-and-log)
- Recovery mechanism (finalize_yield instruction or rely on atomicity)
- Epoch number passing to Staking (explicit vs implicit tracking)
- Stub vault balance reading (epoch number only vs include balance)

</decisions>

<specifics>
## Specific Ideas

- CPI-gated follows the proven pattern from Tax::swap_exempt — consistency with existing architecture
- "Notify only" keeps Phase 24 focused on integration, not token movement
- Stub with cumulative tracking is the "Goldilocks" fidelity — enough to verify, not overbuilt
- Existing staking_escrow in Tax Program means no new vault infrastructure needed

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 24-staking-integration*
*Context gathered: 2026-02-06*
