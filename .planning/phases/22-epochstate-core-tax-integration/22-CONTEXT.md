# Phase 22: EpochState Core + Tax Integration - Context

**Gathered:** 2026-02-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Establish EpochState account structure with slot-based epoch timing, and update Tax Program to read dynamic tax rates instead of hardcoded values. This phase creates the foundation accounts and cross-program reading pattern. VRF integration (Phase 23), Staking integration (Phase 24), and Carnage execution (Phase 25) are separate phases.

**Requirements in scope:** EPO-01 through EPO-06, TAX-01 through TAX-03

</domain>

<decisions>
## Implementation Decisions

### Tax Rate Fallback Behavior
- EpochState is **required** for all Tax Program swap instructions (no fallback to defaults)
- If EpochState is missing or invalid, swap transaction fails with clear error
- EpochState account **passed explicitly** to swap instructions (standard Solana pattern, not hardcoded PDA lookup)
- Client must pass EpochState account; this is a breaking change to swap instruction signatures

### Initialization Authority
- genesis_slot captured **automatically from Clock** at initialization time (prevents manipulation)
- Emit **EpochStateInitialized** event with genesis_slot, initial_cheap_side, timestamp for monitoring/indexing

### Testing Strategy
- Use **both approaches**: mock EpochState accounts for fast Tax Program unit tests + real Epoch Program in integration tests
- **Defer comprehensive integration tests to Phase 23** when VRF actually updates rates
- Phase 22 focuses on: EpochState account creation, Tax Program reading from EpochState, basic cross-program verification

### Claude's Discretion
- Corruption handling (constraint checks vs explicit error codes)
- Rate bounds validation (defense-in-depth vs trusting EpochState)
- Initialization authority pattern (admin-only vs permissionless one-time) - spec suggests deployer one-time
- Admin account post-init (spec invariant 8 says "No admin functions post-deployment")
- Rate test coverage (all 8 discrete rates vs boundary values)
- Test continuity during refactor (maintain backward compat vs fix at end)

</decisions>

<specifics>
## Specific Ideas

- Existing Tax Program already has carnage_signer PDA validation implemented in swap_exempt (seeds::program = epoch_program_id())
- The epoch_program_id() in tax-program/src/constants.rs is a placeholder that needs updating with actual deployed program ID
- Hardcoded tax rates in swap_sol_buy.rs (400 bps) and swap_sol_sell.rs (1400 bps) need replacing with EpochState reads
- Epoch_State_Machine_Spec.md Section 10 shows the get_tax_bps() pattern for reading rates

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 22-epochstate-core-tax-integration*
*Context gathered: 2026-02-06*
