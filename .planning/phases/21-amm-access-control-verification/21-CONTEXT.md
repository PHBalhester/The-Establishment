# Phase 21: AMM Access Control Verification - Context

**Gathered:** 2026-02-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Verify that AMM enforces Tax Program-only access, preventing direct user bypass of taxation. This is a verification phase proving the access control design works, not building new features.

**Purpose:** v0.4 milestone gate — prove Tax Program access control before shipping.

</domain>

<decisions>
## Implementation Decisions

### Verification approach
- Code review AND integration tests (not one or the other)
- Full instruction audit — review all AMM swap instructions end-to-end for access control gaps
- Claude performs verification, user validates findings before marking complete
- Gaps found are documented only — fixes belong in separate phase

### Evidence & documentation
- Output: VERIFICATION.md in `.planning/phases/21-amm-access-control-verification/`
- Classification: Pass/Fail binary (access control either works or it doesn't)
- Structure: Claude's discretion based on what's clearest
- Test output embedding: Claude's discretion

### Test scenarios
- Test BOTH bypass vectors: direct AMM calls from user AND forged swap_authority PDA attempts
- Cover all 4 AMM swap instructions: swap_sol_buy, swap_sol_sell, swap_profit_buy, swap_profit_sell
- Expected error codes: Claude determines from code analysis
- Test location: Claude determines based on existing test structure

### Requirements mapping
- AUTH-03 and AUTH-04 traced via explicit `REQ: AUTH-03` tags in code/tests (searchable)
- Detailed traceability: requirement → specific code location → specific test
- Milestone gate scope only (comprehensive audit is separate future effort)

### Claude's Discretion
- VERIFICATION.md structure and organization
- Test output embedding vs references
- Specific error codes expected from bypass attempts
- Test file location based on existing patterns
- Whether to note adjacent security checks reviewed

</decisions>

<specifics>
## Specific Ideas

- Pass/Fail binary recommended because "access control is fundamentally binary — either unauthorized users are rejected, or they aren't"
- This is a milestone gate for v0.4, not a living audit document
- Future comprehensive audit will compile all verifications when preparing for mainnet/external review

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 21-amm-access-control-verification*
*Context gathered: 2026-02-06*
