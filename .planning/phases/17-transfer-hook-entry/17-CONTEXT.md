# Phase 17: Transfer Hook Entry Point & Integration - Context

**Gathered:** 2026-02-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement the transfer_hook instruction that Token-2022 invokes during every transfer of CRIME, FRAUD, and PROFIT tokens. This instruction validates that at least one party (source or destination) is whitelisted, enforcing pool-mediated transfers only.

Covered requirements: HOOK-01, WHTE-06, WHTE-07, SECU-01, SECU-02, SECU-03, SECU-04

</domain>

<decisions>
## Implementation Decisions

### Validation Order
- Check zero amount first (cheapest check, reject trivially invalid transfers immediately)
- Check transferring flag second (security - verify legitimate Token-2022 context)
- Check whitelist third (business rule - core validation)
- Short-circuit whitelist check: if source is whitelisted, skip destination check
- Order: ZeroAmountTransfer → DirectInvocationNotAllowed → NoWhitelistedParty

### Mint Validation Approach
- Implicit validation via ExtraAccountMetaList: only mints with initialized ExtraAccountMetaList can invoke hook
- Still validate mint.owner == token_2022_program_id as defense-in-depth
- Document the implicit validation pattern clearly in code comments
- New `InvalidMint` error if mint owner validation fails

### Transferring Flag Check
- Use `check_token_account_is_transferring()` from SPL transfer hook library
- New `DirectInvocationNotAllowed` error when flag check fails
- **Research flag:** Confirm exact API usage pattern before planning (STATE.md flagged this)
- Position: after zero amount check, before whitelist check

### Error Disclosure
- Generic `NoWhitelistedParty` error - does not reveal which specific party failed
- Security-focused: prevents attackers from probing whitelist status via error messages

### Testing Strategy
- Use litesvm with Token-2022 extension support (consistent with AMM tests)
- Test all blocking scenarios: zero amount, direct invocation, non-whitelisted, spoofed PDAs
- Include AMM → Token-2022 → Hook chain tests (full integration path)
- Comprehensive negative test coverage required

### Claude's Discretion
- Whitelist entry test coverage: representative samples vs all 14 entries
- Exact structure of integration test setup
- Helper function organization for validation logic

</decisions>

<specifics>
## Specific Ideas

- Validation order mirrors security best practices: cheapest check first, security checks before business rules
- Error messages are intentionally generic to prevent information leakage
- The implicit mint validation via ExtraAccountMetaList is elegant - document it well so future maintainers understand why there's no explicit mint check in the hook

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 17-transfer-hook-entry*
*Context gathered: 2026-02-05*
