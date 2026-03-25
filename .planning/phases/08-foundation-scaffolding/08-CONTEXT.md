# Phase 8: Foundation & Scaffolding - Context

**Gathered:** 2026-02-03
**Status:** Ready for planning

<domain>
## Phase Boundary

AMM program workspace setup, swap math module with comprehensive tests, and test infrastructure for both unit and integration testing. This phase delivers a compiling Anchor workspace with proven-correct math — no pool state, no instructions, no token transfers.

</domain>

<decisions>
## Implementation Decisions

### Fork strategy
- Literal fork of `arrayappy/solana-uniswap-v2` — clone the repo, preserve git history
- Strip depth: Claude's discretion on how aggressively to gut the fork, based on how much original code is reusable vs. security risk of carrying legacy patterns. The fork uses standard SPL Token only (no T22 support), so substantial rewriting is expected
- Delete all existing tests — clean slate. Our specs define exactly what to test
- Workspace location: Claude's discretion on whether Anchor workspace lives at project root or in a subdirectory, based on what works best for a multi-program workspace

### Future program stubs
- AMM program only for now — no empty stubs for Tax Program or Transfer Hook
- Programs added when their milestones begin (v0.3 Transfer Hook, v0.4 Tax Program)
- Mock Tax Program (needed in Phase 13) deferred to that phase, not scaffolded now
- Mock Tax Program location: Claude's discretion (in main workspace or test-only directory)

### Math test rigor
- Hand-picked unit tests PLUS property-based testing with proptest crate
- proptest runs 10,000 randomized swap simulations for k-invariant verification
- Expected values inline in test functions — no separate test vector files
- Test coverage: normal swaps, edge cases (0, 1, u64::MAX), overflow scenarios, rounding behavior, fee application correctness

### Claude's Discretion
- Strip depth when cleaning the fork (balance reusability vs. security of carrying legacy code)
- Workspace directory layout (project root vs. subdirectory)
- Mock Tax Program location (main workspace vs. test-only directory, decided in Phase 13)
- Exact proptest strategy configuration and input distributions
- Test file organization within the workspace

</decisions>

<specifics>
## Specific Ideas

- User wants to learn from the process — break tasks into small steps and explain the "why" of each step
- The fork is a starting point, not a constraint — our specs are authoritative, the fork provides Anchor patterns and structure
- Math module is the invariant-preserving core — bugs here enable fund-draining exploits, hence the proptest requirement
- v3 failure was caused by rushing integration without solid foundations — this phase deliberately isolates math correctness before any token transfer code exists

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 08-foundation-scaffolding*
*Context gathered: 2026-02-03*
