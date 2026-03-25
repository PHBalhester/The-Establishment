# Phase 38: Devnet Redeployment + Overnight E2E Validation - Context

**Gathered:** 2026-02-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Redeploy Phase 37 program changes (Tax, Epoch, Staking, AMM) to devnet via in-place upgrade, then run an extended overnight E2E test runner that cycles 100 epochs with real swaps, staking, and VRF transitions. Captures natural Carnage triggers and validates all Phase 37 fixes under sustained operation. No new on-chain program code is written — this is deployment, validation, and reporting.

</domain>

<decisions>
## Implementation Decisions

### Overnight Runner Behavior
- VRF handling: implement **gateway rotation** (resolves todo #5) — rotate through available Switchboard gateways on each retry instead of hammering the same one. Script-side only, no program changes
- Non-VRF transaction failures: **log and continue** — failures are data points, not stop conditions. Review in morning report
- Epoch cadence: **minimum** (~750 slots / ~5 min per epoch). Transition as soon as epoch boundary allows to maximize epochs overnight
- Runner architecture: Claude's Discretion (TypeScript long-lived process or shell loop — pick what's cleanest for logging/reporting needs)

### Redeployment Strategy
- Deploy mode: **upgrade in-place** via `solana program deploy` to existing program IDs. Preserves all existing PDAs and on-chain state from Phase 34-36
- EpochState: Claude's Discretion (re-initialize fresh or let first new transition overwrite — pick based on what the program expects with new byte layout)
- Carnage WSOL account: **separate manual step** after deploy (not part of the automated pipeline). Easier to debug
- Funding: **pre-fund + auto-airdrop safety net**. Wallet still has >50 SOL from Phase 34 (LP funding was the bulk of prior spend, not needed again). Runner checks balance each epoch and airdrops if below threshold

### Reporting & Morning Summary
- Morning report priority: **balanced** — Carnage triggers, error rate/stability, tax distribution accuracy, staking yield, and epoch count all matter equally
- JSONL granularity: **epoch-level summaries** — one line per epoch, not per-transaction. Compact and readable
- Each epoch record includes: epoch number, CRIME/FRAUD cheapSide, per-token tax bps, VRF random bytes, Carnage trigger status, swaps performed, tax distribution amounts, staking yield delta, errors, TX signatures
- Report format: **Markdown summary file** (Docs/Overnight_Report.md) with tables, stats, and Solana Explorer links
- Notifications: Claude's Discretion

### Carnage Hunting Strategy
- Epoch target: **100 epochs** (~8 hours overnight). ~96.5% probability of at least 1 natural trigger
- On zero triggers: **stop at target and report**. Zero triggers is valid data — proves the probability math. No forced fallback
- No forced Carnage smoke test at start — already tested in Phase 36. Natural triggers only
- On natural trigger: **log + verify pool balances** changed correctly (depth-4 CPI chain with updated byte offsets 5/6/7 executed)

### Claude's Discretion
- Runner architecture choice (TypeScript vs shell loop)
- EpochState handling (re-initialize vs overwrite)
- Notification approach (desktop notification, none, etc.)
- Any additional metrics worth capturing in epoch JSONL records
- Graceful shutdown handling for the long-running process

</decisions>

<specifics>
## Specific Ideas

- Tax rates per epoch are important to record — user wants to reference how rates vary over the overnight run
- Gateway rotation implementation resolves STATE.md todo #5 (devnet shows ~33% oracle failure rate per gateway; rotation reduces recovery from ~5 min to ~10 sec)
- Existing E2E scripts from Phase 36 are the foundation — runner extends them for unattended operation
- Auto-airdrop threshold should be conservative (e.g., airdrop if < 5 SOL, similar to Phase 33 pattern)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 38-devnet-redeployment-overnight-e2e*
*Context gathered: 2026-02-13*
