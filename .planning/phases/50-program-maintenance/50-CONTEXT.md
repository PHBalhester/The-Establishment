# Phase 50: Program Maintenance - Context

**Gathered:** 2026-02-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Resolve all deferred maintenance items before the final rebuild: feature-gate environment-specific constants, implement VRF bounty payment, fix EpochState LEN alignment, make treasury configurable, and clean up stale comments. No new features, no new instructions -- polish and correctness only.

</domain>

<decisions>
## Implementation Decisions

### Treasury Configuration
- Compile-time constant via feature flag (not on-chain configurable)
- Both devnet and mainnet addresses checked into source (transparent, auditable)
- User will provide mainnet treasury address when ready (placeholder for now)
- Tax split 75/24/1 (staking/carnage/treasury) is **locked forever** -- hardcoded, not configurable
- Same `devnet` feature flag as Switchboard PID

### VRF Bounty Payment
- **Bounty amount: 0.001 SOL** (compile-time constant, not on-chain configurable)
- Source of funds: Treasury PDA (natural fit since treasury accrues from every trade)
- Verified with live mainnet fee check: current base cost is ~0.000015 SOL per epoch cycle (3 TXs), priority fees are essentially zero across the network right now
- 0.001 SOL covers gas costs with comfortable margin without draining treasury

### Feature-Gating Strategy
- **Full sweep** of all programs for devnet-vs-mainnet constants (not just SLOTS_PER_EPOCH)
- Use the existing `devnet` Cargo feature flag for all environment-specific constants
- Verify with **both** unit test (Rust assert on constant values) and build script check
- Mainnet checklist updates deferred to Phase 51 (rebuild/deploy is the natural reconciliation point)

### Cleanup Scope
- **Full codebase sweep** for stale comments -- Rust AND TypeScript, not just the 4 files listed in the roadmap
- Target: VRF byte positions, old constants, pre-Phase 37 layout references, any other outdated comments discovered during sweep
- EpochState LEN fix approach and compile-time assertion: Claude's discretion
- Other cleanup items: Claude should review pending todos and deferred items to identify anything that naturally fits this phase

### Claude's Discretion
- EpochState LEN fix: whether to add static_assert or just fix the constant
- CarnageFundState legacy counters: evaluate risk/reward of removal vs leaving in place
- Insufficient bounty balance handling: choose safest approach (skip silently vs pay partial vs fail)
- Whether separate feature flags are needed or everything fits under `devnet`
- Which additional cleanup items (from pending todos/deferred list) belong in this phase vs later

</decisions>

<specifics>
## Specific Ideas

- Live mainnet RPC check confirmed priority fees are ~0 microlamports/CU across 150 recent slots (even for Jupiter). The 0.001 SOL bounty is ~66x the actual 3-TX base cost -- generous but treasury-efficient.
- User wants all environment constants caught in one pass to avoid "one more thing" discoveries during Phase 51 rebuild.

</specifics>

<deferred>
## Deferred Ideas

- Mainnet checklist reconciliation -- Phase 51 (rebuild/deploy)
- Vanity address grinding for programs and mints -- already in pending todos, separate from this phase

</deferred>

---

*Phase: 50-program-maintenance*
*Context gathered: 2026-02-20*
