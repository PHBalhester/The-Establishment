# Phase 74: Protocol Integration - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire the bonding curve program (built in Phases 71-73) into the existing 6-program protocol. This covers: Transfer Hook whitelist entries, graduation orchestration script, deploy pipeline extension for the 7th program, ALT updates with curve addresses, and comprehensive lifecycle testing. The launch page frontend is Phase 75 (out of scope here).

Two distinct operational moments:
1. **Deploy-time** (pipeline): build, deploy, initialize curves, fund vaults, start curves, whitelist entries, burn authority
2. **Post-fill** (graduation script): runs days/weeks later when both curves fill — separate from deploy pipeline

</domain>

<decisions>
## Implementation Decisions

### Graduation Orchestration
- **Trigger**: Admin script (manual) — admin runs graduation script when both curves fill. No crank automation for graduation.
- **Failure handling**: Checkpoint + resume — script saves progress to a state file. On re-run, picks up from the last successful step (not idempotent re-check like initialize.ts).
- **Token flow**: Admin intermediary — prepare_transition releases assets to admin wallet first, then admin script seeds pools/vault from admin's token accounts (two-hop).
- **Tax escrow routing**: Part of graduation script — distribute_tax_escrow for both curves is a step in the graduation sequence, not a separate admin action.
- **Full sequence**: prepare_transition (both curves) -> transfer assets to admin -> AMM pool seeding (290M tokens + 1,000 SOL per pool) -> Conversion Vault seeding (250M CRIME + 250M FRAUD + 20M PROFIT) -> distribute_tax_escrow (both curves to carnage fund) -> finalize_transition (both curves)

### Deploy Pipeline Sequencing
- **Whitelist**: Add curve vault whitelist entries to initialize.ts as a new step, placed before the existing whitelist authority burn step. Single script handles everything.
- **Build pattern**: Same two-pass deploy as existing programs — Phase 0 mint keypairs -> Phase 1 build --devnet -> Phase 2 deploy -> Phase 3 init -> rebuild feature-gated -> redeploy.
- **Pipeline structure**: Bonding curve gets its own deploy pipeline phase (not merged into existing program phases). The boundary is clear: deploy pipeline handles program setup + curve initialization; graduation is a completely separate script run post-fill.
- **Feature-gated mints**: Same `cfg(feature = "devnet")` pattern, same file structure as conversion vault/tax/epoch programs. Add CRIME and FRAUD mint constants with devnet/localnet/mainnet variants.

### Lifecycle Test Scope
- **Coverage**: Comprehensive — happy path, failure path, AND edge cases. No corners cut. Safety and security first.
  - Happy path: init -> fund -> start -> buy -> sell -> fill both -> graduate -> pools seeded -> protocol operational
  - Failure path: deadline expires -> mark_failed -> consolidate_for_refund -> claim_refund -> verify SOL returned
  - Edge cases: partial fills, single-curve fill timeout, whitelist validation, Transfer Hook during curve buys/sells, wallet cap enforcement, slippage protection
- **Post-graduation verification**: Full protocol verification after graduation — confirm users can swap via AMM, Transfer Hooks fire correctly, tax program routes taxes, epoch/crank cycle works. Proves "protocol operational" success criteria.
- **Refund E2E**: Full integrated refund flow tested — not just relying on Phase 73's 5M proptest iterations. Refund must work with the full protocol stack (Transfer Hooks, real token accounts).
- **Format**: Claude's discretion based on existing test patterns — but must be thorough, automated, and assertion-heavy.

### ALT + Address Management
- **ALT strategy**: Claude's discretion — extend existing ALT or separate, based on size limits and client complexity.
- **PDA manifest**: Claude's discretion — add to pda-manifest.ts or separate, based on current structure.
- **Feature gates**: Same `cfg(feature)` pattern in the bonding_curve program's constants file, consistent with all other programs.

### Claude's Discretion
- ALT strategy (extend existing vs separate curve ALT)
- PDA manifest organization (add to existing vs separate file)
- Test format (Anchor test suite vs script-based E2E vs hybrid)
- Graduation script: whether to import existing deploy helpers or be self-contained
- Exact checkpoint file format for graduation script resume

</decisions>

<specifics>
## Specific Ideas

- Deploy pipeline boundary is critical: deploy-time setup vs post-fill graduation are two completely separate operational moments separated by days/weeks
- User emphasized "do not cut a single corner" on testing — comprehensive edge case coverage is non-negotiable
- Graduation checkpoint+resume pattern was chosen over idempotent re-run (different from initialize.ts) — suggests user wants explicit progress tracking for this high-stakes operation
- The two-hop token flow (curve vaults -> admin -> pools/vault) was chosen over direct PDA-to-PDA transfer — simpler authority model

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 74-protocol-integration*
*Context gathered: 2026-03-04*
