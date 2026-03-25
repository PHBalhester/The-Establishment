# Phase 35: VRF Devnet Validation - Context

**Gathered:** 2026-02-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Prove Switchboard VRF works with real oracles on Solana devnet. The full 3-transaction commit-reveal flow must complete, epoch transitions must produce genuine randomness that derives tax rates within expected bands, timeout recovery must work, and tax rates must be applied to swaps. No new program code is written — this validates existing deployed programs against real oracle infrastructure.

</domain>

<decisions>
## Implementation Decisions

### Epoch Duration for Testing
- Deploy Epoch Program to devnet with **750 slots (~5 min)** epoch duration instead of production 4,500 slots
- Rationale: Fast enough for automated VRF test iterations, slow enough for manual front-end interaction during E2E testing (Phase 36)
- SLOTS_PER_EPOCH is a **hardcoded compile-time constant** — different builds for devnet (750) vs mainnet (4,500)
- This means redeploying the Epoch Program binary when transitioning to mainnet

### Validation Depth
- **Full security suite on devnet** — not just happy path
- Test scenarios include:
  - Happy path: complete 3-TX VRF flow (create, commit+trigger, reveal+consume)
  - Anti-reroll: attempt consume with wrong randomness account (expect rejection)
  - Stale randomness: attempt commit with old/pre-generated randomness account (expect rejection)
  - Double-commit: attempt trigger while VRF already pending (expect rejection)
  - Timeout recovery: wait real **300 slots (~2 min)**, then retry with fresh randomness account
- Include **one swap after VRF updates taxes** to verify the Tax Program reads the new rates correctly (quick sanity check bridging into Phase 36 territory)

### Success Threshold
- **5 consecutive successful VRF-driven epoch transitions** required
- Each transition gets **full verification**: read EpochState, verify tax rates are in 100-400 bps (low) / 1100-1400 bps (high) bands, verify cheap_side logic, log the randomness bytes used
- At ~5 min epochs, the 5 transitions take ~25 min of waiting plus test execution time
- Carnage triggering is **nice to have** — if VRF byte 3 < 11 during any of the 5 epochs, validate the Carnage execution. If not, defer full Carnage testing to Phase 36

### Claude's Discretion
- **Script location and structure**: Claude decides whether scripts live in `scripts/vrf/`, `tests/devnet/`, or elsewhere based on project structure. Also decides whether to build toward crank bot reusability or keep scripts focused on validation
- **VRF validation report format**: Generate a structured report (like Phase 34's deployment report) with transaction signatures, randomness values, derived tax rates, and timing data — exact format at Claude's discretion

</decisions>

<specifics>
## Specific Ideas

- "750 slots is good because we'll also use this devnet ecosystem for front-end testing and E2E — 40 seconds is too quick for manual things"
- The v3-archive had a working devnet VRF test (`tests/devnet-vrf.ts`) that can serve as reference for the orchestration pattern
- Switchboard On-Demand SDK version should be validated — v3 used 0.11.3 but the SDK is actively evolving (has `solana-v2`/`solana-v3` feature flags now)
- All spec discrepancies from VRF_Migration_Lessons.md are RESOLVED:SPEC — the spec's values were adopted for v4

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 35-vrf-devnet-validation*
*Context gathered: 2026-02-11*
