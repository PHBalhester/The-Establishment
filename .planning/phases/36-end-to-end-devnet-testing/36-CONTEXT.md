# Phase 36: End-to-End Devnet Testing - Context

**Gathered:** 2026-02-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Validate that the full Dr. Fraudsworth protocol works as a complete system on devnet — real user swap flows with tax collection, staking + yield claims, epoch transitions with VRF, and Carnage triggers. All results documented with transaction signatures and account state evidence. No new program code is written — this is pure validation and evidence gathering.

</domain>

<decisions>
## Implementation Decisions

### Test execution model
- Claude's discretion on orchestration structure (single orchestrator vs separate scripts) — pick based on flow dependencies
- Reuse existing deployed protocol state (Phase 34); create fresh user wallets + token accounts per test run
- Fund test users via transfer from devnet wallet (8kPzh...), NOT faucet airdrop
- Each test run is self-contained: fresh user, fresh accounts, interacting with live protocol

### Carnage trigger strategy
- Test BOTH paths explicitly: forced `execute_carnage` AND natural VRF trigger (byte 3 < 11)
- No epoch cutoff for natural trigger — run as many epochs as needed, even overnight
- Verify Carnage with full state diff: all pool states before/after, token/SOL movements, vault balance changes
- After Carnage fires, verify a swap still works on a surviving pool (post-Carnage health check)

### Evidence & documentation
- Markdown report at `Docs/E2E_Devnet_Test_Report.md`
- Capture before/after account state snapshots for each flow (balances, pool reserves, epoch state)
- Every significant transaction includes its Solana Explorer-linkable signature
- Include explicit "mainnet readiness" section mapping each success criterion to the specific TX/snapshot that proves it

### Failure handling
- Auto-retry with limit on transient TX failures (Claude decides retry count and backoff strategy)
- Fresh start each run (Claude decides — no checkpoint resume needed given fresh user approach)
- If a specific test flow fails: log failure with details (TX sig, expected vs actual, account state), continue running remaining flows
- **Tests are diagnostic, not a gate** — known issues (e.g., Carnage fund clearing balance bug from audit) are expected to fail. Log them thoroughly and move on. Fixes happen in Phase 36.1, then full re-run
- Report should clearly distinguish between "unexpected failure" and "known issue" where possible
- Silent console during execution (no real-time stdout)
- Log to file incrementally during execution — if script crashes, partial evidence is preserved
- Final report generated at the end from the incremental log

### Claude's Discretion
- Orchestration architecture (single script vs modular)
- TX retry count and backoff timing
- Recovery strategy (fresh start vs checkpoint — fresh start expected given fresh-user model)
- Exact verification assertions per flow
- Carnage state diff depth and presentation format

</decisions>

<specifics>
## Specific Ideas

- User is willing to run tests overnight if needed for natural Carnage trigger — script should be robust for unattended long runs
- Report format consistent with existing `Docs/VRF_Devnet_Validation_Report.md` and `Docs/Devnet_Deployment_Report.md`
- "Mainnet readiness" mapping section is important — this is the last gate before the next milestone

</specifics>

<deferred>
## Deferred Ideas

- **Phase 36.1: Bug fixes from E2E results** — Carnage fund clearing balance issue (audit finding) and any other failures discovered during E2E testing. Fix then re-run Phase 36 tests.

</deferred>

---

*Phase: 36-end-to-end-devnet-testing*
*Context gathered: 2026-02-11*
