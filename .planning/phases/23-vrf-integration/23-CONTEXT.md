# Phase 23: VRF Integration + Anti-Manipulation - Context

**Gathered:** 2026-02-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Integrate Switchboard On-Demand VRF with anti-manipulation protection (anti-reroll, freshness validation, timeout recovery) to determine tax rates with cryptographic unpredictability. This phase builds on EpochState from Phase 22 and adds VRF-dependent epoch transitions.

**In scope:**
- Instructions: trigger_epoch_transition, consume_randomness, retry_epoch_vrf
- VRF byte parsing and tax rate derivation
- Anti-reroll protection (account binding at commit, verified at consume)
- Stale randomness prevention (seed_slot freshness, already-revealed check)
- Timeout recovery (300-slot window, permissionless retry)
- Minimal TypeScript test script for devnet validation

**Out of scope:**
- Carnage execution (Phase 25)
- Staking integration (Phase 24)
- Production crank bot infrastructure (v0.7)

</domain>

<decisions>
## Implementation Decisions

### Attack Test Strategy
- Port v3 security tests (reroll, timeout, stale randomness) as foundation
- Design 5 total attack scenarios: 3 core + front-running + replay
- Core 3 attacks (reroll, timeout, stale) are blocking for Phase 23
- Front-running and replay tests added in Phase 25 when full CPI chain exists
- Test approach: mock RandomnessAccountData for unit tests, real Switchboard devnet for integration tests

### SDK Version Strategy
- Rust crate: Exact pin `switchboard-on-demand = "=0.11.3"` (proven on devnet in v3)
- TypeScript SDK: Minor range `"@switchboard-xyz/on-demand": "^3.7.3"` (client-side recoverable)
- Version update check: before devnet/mainnet deployment milestones only
- Rationale: On-chain code frozen at deploy; client code can be rolled back if broken

### Error Message Verbosity
- Error codes use minimal Anchor #[msg()] strings (compile-time)
- Add msg!() logs with runtime context before returning errors (slot numbers, account keys, differences)
- Log success milestones too (commit success, consume success, VRF bytes used)
- Rationale: All data is already public on-chain; detailed logs help debugging VRF timing issues

### Crank Bot Scope
- Phase 23 includes minimal TypeScript test script for devnet VRF validation
- Script runs 3-TX flow: create randomness account, commit+trigger, reveal+consume
- Production crank bot (monitoring, alerts, systemd service) deferred to v0.7
- Rationale: MUST have some TS code to test VRF; production reliability is separate concern

### Claude's Discretion
- Test script file location (likely `tests/devnet-vrf.ts` or `scripts/`)
- Exact msg!() log formatting
- Test data patterns for attack scenarios
- Compute unit optimization if needed

</decisions>

<specifics>
## Specific Ideas

- V3 archive (`tests/devnet-vrf.ts`) contains working 3-TX flow code to reference
- V3 security tests (`tests/security/vrf-attacks.ts`) contain attack test patterns
- VRF_Implementation_Reference.md Section 4 has complete client-side TypeScript examples
- Anti-reroll test: commit with account A, try consume with account B, expect `RandomnessAccountMismatch`
- Timeout test: commit, wait > 300 slots, retry with new account, expect success
- Stale test: use old randomness account (seed_slot > 1 slot behind), expect `RandomnessExpired`

</specifics>

<deferred>
## Deferred Ideas

- **Timelock upgrade authority policy** — Documented in Protocol_Initialization_and_Launch_Flow.md Section 5.2. 48-72hr timelock for all program upgrades. Not blocking for Phase 23 implementation.
- **Production crank bot** — Full monitoring, alerting, reliability engineering. Belongs in v0.7 (integration/devnet) or separate operations milestone.
- **Compute budget profiling** — May need profiling on devnet for Carnage execution (Phase 25). VRF alone has plenty of headroom.

</deferred>

---

*Phase: 23-vrf-integration*
*Context gathered: 2026-02-06*
