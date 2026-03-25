# Phase 29: Security and Edge Case Testing - Context

**Gathered:** 2026-02-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Comprehensive test suite validating all security invariants and edge cases across the staking/yield system (Phases 26-28). No new program code — this phase writes tests that prove the system is secure. Covers attack simulations, stress testing, property-based fuzzing, and edge case validation.

</domain>

<decisions>
## Implementation Decisions

### Attack vector coverage
- Test the three explicit attacks: first-depositor inflation, flash loan same-epoch exploitation, escrow insolvency
- Test economic manipulation via rapid stake/unstake cycling to attempt disproportionate reward capture
- Test griefing vectors: blocking claims, dust stake spam, manipulating reward distribution for non-profit-motivated harm
- Test CPI forgery: deploy mock programs that attempt unauthorized CPI calls to deposit_rewards/update_cumulative
- Test reentrancy-style attacks: cross-program re-entry attempts to verify Anchor's account locks and borrow checker prevent exploitation

### Stress test parameters
- Multi-user tests: 100+ concurrent stakers with varied stake amounts
- Escrow solvency: both randomized operation sequences AND scripted worst-case adversarial ordering
- Stake amount ranges: both realistic DeFi ranges (small to large) AND extreme boundary values (1 lamport, near-u64-max)
- Epoch count: Claude's discretion based on where cumulative math could degrade

### Property test scope (proptest)
- Overflow boundaries: verify math module handles all u64 input combinations without overflow
- Reward conservation: sum(all claimed rewards) <= sum(all deposited rewards) for any operation sequence
- Operation ordering invariance: same-epoch stakers with equal amounts receive equal rewards regardless of transaction order
- No-panic property: update_rewards and add_to_cumulative never panic for any valid u64 inputs
- Iteration count: 10,000+ iterations per property for thorough fuzzing

### Test documentation style
- Full attack narrative: each security test includes a comment block explaining the attack scenario, expected failure, and security property validated
- Audit checklist output: test suite prints a summary table mapping security properties to pass/fail status
- Standalone security document: create SECURITY_TESTS.md mapping invariant -> test name -> attack vector -> mitigation

### Claude's Discretion
- Test naming convention (attack-named vs invariant-named — pick what's clearest in test output)
- Epoch count for timing tests (based on where cumulative math degradation is likely)
- Test file organization and shared setup infrastructure
- Exact proptest strategy configurations and input generators

</decisions>

<specifics>
## Specific Ideas

- User wants this phase to feel like a mini security audit — attack narratives explain what's being tested and why
- Crypto security is a core concern ("crypto is dangerous at the best of times") — thoroughness over speed
- Both randomized and adversarial test patterns for solvency — not just happy-path validation
- 10,000+ proptest iterations signals preference for exhaustive coverage
- SECURITY_TESTS.md serves as a reference document for anyone reviewing the system's security posture

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 29-security-edge-case-testing*
*Context gathered: 2026-02-09*
