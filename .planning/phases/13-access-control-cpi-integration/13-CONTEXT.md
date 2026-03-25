# Phase 13: Access Control & CPI Integration - Context

**Gathered:** 2026-02-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the AMM CPI-only — all swap instructions require a swap_authority PDA signed by the Tax Program. Direct user calls are rejected. Verified through a Mock Tax Program and negative tests with a Fake Tax Program.

</domain>

<decisions>
## Implementation Decisions

### swap_authority PDA Design
- **Global authority**: Single PDA for all swaps (not per-pool or per-user)
- **Seeds**: Static `["swap_authority"]` seed only — one canonical PDA
- **Tax Program ID**: Hardcoded constant in AMM code (like SPL Token program IDs)
- **Account passing**: swap_authority is an explicit required account in swap instructions, not just a signer check

### Error Message Granularity
- **Specific errors**: Distinct error codes for each failure mode:
  - `MissingSwapAuthority` — no authority account provided
  - `InvalidSwapAuthorityProgram` — PDA derived from wrong program
  - `InvalidSwapAuthoritySeeds` — wrong seeds used
  - `DirectCallNotAllowed` — user tried to call swap directly
  - `CpiDepthExceeded` — transfer chain cannot complete
- **Include context**: Error messages should hint at what went wrong (e.g., "expected TAX_PROGRAM_ID, got {actual}")
- **User guidance**: Direct call errors explicitly say "swaps must go through Tax Program"

### Mock Tax Program Scope
- **Minimal implementation**: Just derives swap_authority, signs, and CPIs to AMM swap instructions
- **Location**: Same workspace under `programs/mock-tax-program/`
- **Interface**: Single `execute_swap` instruction that forwards to AMM
- **Negative testing**: Separate Fake Tax Program (different program ID) to verify AMM rejects non-Tax callers

### CPI Depth Budget
- **No precheck**: Let Solana runtime handle depth violations (don't add overhead for rare edge case)
- **Assume shallow hooks**: Our T22 hooks (CRIME/FRAUD/PROFIT) are simple — document this assumption
- **Expected depth**: Tax Program -> AMM -> Token transfer = 2-3 levels (within limit of 4)
- **Architecture constraint**: Document that callers of Tax Program must be top-level transactions (not nested CPI)

### Claude's Discretion
- Exact error code numbers
- Mock Tax Program account struct naming
- Test file organization within the integration test suite

</decisions>

<specifics>
## Specific Ideas

- The seeds::program = TAX_PROGRAM_ID pattern validates cross-program PDA ownership
- Mock should be just enough to prove the access control works, not a realistic Tax Program
- Fake Tax Program exists only to prove rejection works — minimal code

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 13-access-control-cpi-integration*
*Context gathered: 2026-02-04*
