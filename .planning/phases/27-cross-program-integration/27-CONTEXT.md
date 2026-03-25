# Phase 27: Cross-Program Integration - Context

**Gathered:** 2026-02-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Enable Tax Program and Epoch Program to securely call Staking Program via CPI. Tax Program deposits 75% of SOL taxes through deposit_rewards. Epoch Program finalizes yields through update_cumulative at epoch end. Replace stub-staking with real CPI. User-facing staking operations (stake/unstake/claim) are Phase 26. Token flow through Transfer Hook is Phase 28.

</domain>

<decisions>
## Implementation Decisions

### CPI Authority Validation
- Generic "Unauthorized" error messages — no info leak about which programs are allowed
- Constraint-only validation via `seeds::program` in `#[account]` derives — no redundant require!() checks
- Atomic behavior: if CPI authority check fails, reject at account validation before instruction runs

### CPI Failure Behavior
- **Fail entire transaction** if update_cumulative CPI fails during consume_randomness
- Epoch cannot end without reward finalization — atomic or nothing
- Integration tests must verify CPI always succeeds before deployment
- No retry mechanism or fallback — CPI failure indicates a real bug needing hot-fix

### Stub Replacement
- Remove stub-staking code entirely — no test/prod divergence
- Real Staking Program used everywhere, including local testing
- In-place swap: remove stub logic, insert CPI to real Staking Program

### Integration Test Scope
- Test full yield loop: swap_sol_buy → tax → deposit_rewards → epoch end → update_cumulative → claim
- Multi-user tests with 5+ stakers to validate proportional distribution and rounding edge cases

### Claude's Discretion
- Program ID source: use existing const fn pattern (tax_program_id(), epoch_program_id()) vs configurable
- Failure logging: minimal msg!() vs none for rejected CPI attempts
- Event content: caller program ID, delta values, epoch number in events
- Debug logging: events only vs events + msg!() for CPI operations
- CPI accounts: minimal vs full context based on update_cumulative signature from Phase 26
- Adversarial CPI tests: include rejection tests vs happy path only
- Solvency checks: per-operation vs end-of-test assertions

</decisions>

<specifics>
## Specific Ideas

- Error messages should reveal nothing about access control design — security-by-obscurity for unauthorized CPI attempts
- The update_cumulative CPI is simple (updates a u128 counter) — if it fails, something is genuinely broken
- Integration tests should catch CPI failure scenarios before deployment, not paper over them with fallbacks
- 5+ stakers provides realistic test scenarios for proportional distribution edge cases

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 27-cross-program-integration*
*Context gathered: 2026-02-06*
