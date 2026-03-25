# Phase 83: VRF & Crank Hardening - Context

**Gathered:** 2026-03-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix VRF edge cases (force_carnage lock slot, stale VRF recovery, anti-reroll assertion), consolidate binary offsets into shared constants with validation tests, and make crank runner mainnet-ready (configurable slots, pubkey-only loading, alerting). 12 requirements: VRF-01 through VRF-12.

</domain>

<decisions>
## Implementation Decisions

### Legacy Tax Fields (VRF-03)
- **Populate as summary values**: `low_tax_bps = min(crime_buy, crime_sell, fraud_buy, fraud_sell)`, `high_tax_bps = max(all 4)` — set in `consume_randomness` after tax derivation
- `force_carnage` (devnet-only) does NOT touch tax fields — it only sets carnage state, tax rates come from `consume_randomness`
- Crank runner keeps logging per-token rates (more useful for debugging than summary min/max)
- No migration risk — fields already exist in EpochState, just populated with meaningful values instead of zero

### Epoch Skip Behavior (VRF-02)
- **Document as acceptable** — skipping epochs is harmless (no rewards accrue during gaps, tax rates persist at last-set values, Carnage only triggers from VRF)
- No on-chain guard — adds complexity for zero security benefit
- Documentation in **both** code comment on `trigger_epoch_transition` AND `Epoch_State_Machine_Spec.md`
- Crank runner logs a **distinct warning** when epoch delta > 1 (e.g., `WARNING: skipped 4 epochs (100 -> 105)`)

### Stale VRF Recovery (VRF-04/05)
- **VRF-04 (TOCTOU)**: Crank catches "already consumed" error, logs it, re-reads EpochState, continues to next cycle — no crash, no retry, state is already advanced
- **VRF-05 (timeout wait)**: Crank calculates `remaining = VRF_TIMEOUT_SLOTS - (current_slot - request_slot)` and waits before calling `retry_epoch_vrf` — avoids wasting TX fees on premature retries
- On-chain `retry_epoch_vrf` already correctly uses `request_slot` for timeout validation — **crank-side fix only**, no on-chain changes
- Timeout recovery gets a **distinct log line**: `[crank] VRF timeout recovery: waited X slots, creating fresh randomness` — useful for ops monitoring of oracle failures

### Crank Runner Mainnet-Readiness (VRF-07/08/11/12)
- **VRF-12 (balance alerting)**: Configurable via `CRANK_LOW_BALANCE_SOL` env var (default auto-detected: 0.5 SOL devnet, 1.0 SOL mainnet). Stdout logging only — no external webhooks (that's its own feature, can layer on later)
- **VRF-08 (epoch slots)**: `MIN_EPOCH_SLOTS_OVERRIDE` env var. If not set, auto-detect from CLUSTER_URL: `devnet` in URL = 750, `mainnet` = 4500. Explicit env var always wins
- **VRF-11 (pubkey loading)**: Drop keypair file fallback entirely. `CARNAGE_WSOL_PUBKEY` env var is the only path — no secret key loading in production. Local dev sets env var too
- **VRF-07**: Already implied by VRF-11 — `PublicKey.default` placeholder in carnage-flow.ts replaced with real pubkey

### Claude's Discretion
- Exact error matching for "already consumed" detection (error code vs string match)
- Whether MIN_EPOCH_SLOTS auto-detection uses URL substring or a separate CLUSTER env var
- Implementation of VRF-01 (force_carnage carnage_lock_slot) — straightforward mirror of consume_randomness lines 286-289
- VRF-06 anti-reroll test assertion — which specific ConstraintAddress error code to assert
- VRF-09/10 binary offset consolidation and validation test structure

</decisions>

<specifics>
## Specific Ideas

- Phase 82 promoted SWAP_EXEMPT_DISCRIMINATOR to constants.rs — VRF-10 validation test builds on that directly
- VRF-01 is a 4-line fix: copy the `carnage_lock_slot` assignment from consume_randomness (line 286-289) into force_carnage handler
- The crank runner is only 331 lines — all crank changes are concentrated in this one file plus crank-provider.ts (177 lines)
- RPC URL masking (VRF-07/FE-01 overlap): currently logs full URL at line 177. Replace with truncated/masked version

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scripts/crank/crank-runner.ts` (331 lines): Main crank loop — all VRF-07/08/11/12 changes live here
- `scripts/crank/crank-provider.ts` (177 lines): Provider/program loading — env var config changes here
- `scripts/vrf/lib/vrf-flow.ts`: VRF advancement logic (advanceEpochWithVRF) — timeout recovery changes here
- `scripts/vrf/lib/epoch-reader.ts`: EpochState reading — may need updates for new summary fields

### Established Patterns
- Crank uses JSON log lines (`[epoch] { ... }`) for structured logging — new warnings should follow same pattern
- Environment variable config with fallback defaults (CLUSTER_URL, COMMITMENT, etc.)
- Graceful shutdown via SIGINT/SIGTERM handlers
- Phase 80's hard error philosophy — but crank is ops code, so "catch + continue" is appropriate for TOCTOU

### Integration Points
- `programs/epoch-program/src/instructions/force_carnage.rs`: Add carnage_lock_slot (VRF-01)
- `programs/epoch-program/src/instructions/consume_randomness.rs`: Populate low/high_tax_bps (VRF-03)
- `programs/epoch-program/src/instructions/trigger_epoch_transition.rs`: Add epoch skip doc comment (VRF-02)
- `programs/epoch-program/src/constants.rs`: SWAP_EXEMPT_DISCRIMINATOR already promoted, add EpochState offset constants (VRF-09)
- `Docs/Epoch_State_Machine_Spec.md`: Document epoch skip behavior (VRF-02)

</code_context>

<deferred>
## Deferred Ideas

- External alerting (Discord webhook, PagerDuty) for crank balance — own feature, layer on later
- Tiered warning thresholds (WARNING at 1 SOL, CRITICAL at 0.2 SOL) — can add if stdout proves insufficient

</deferred>

---

*Phase: 83-vrf-crank-hardening*
*Context gathered: 2026-03-08*
