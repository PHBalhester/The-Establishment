# Phase 33: Deployment Scripts - Context

**Gathered:** 2026-02-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Automate the full build-deploy-initialize-verify cycle so the Dr. Fraudsworth protocol (5 programs) can be deployed and initialized on any Solana cluster via idempotent scripts. No new program code is written -- this is purely deployment tooling. Scripts live in `scripts/deploy/`.

</domain>

<decisions>
## Implementation Decisions

### Script architecture
- Hybrid approach: shell scripts for build/deploy (anchor build, solana program deploy), TypeScript for init/verify (needs Anchor SDK for complex transactions)
- Scripts live in `scripts/deploy/`
- Fresh init logic modeled on the proven 17-step test sequence but built for deployment (idempotent checks, real error handling, operator-friendly logging). Not reusing test helpers -- different non-functional requirements
- Deploy handles both fresh deploys and upgrades (solana program deploy handles this natively). Post-deploy verify catches mismatches

### Idempotency & recovery
- On-chain detection only: before each init step, check if the target account/PDA already exists. No local state files
- On failure: stop immediately and report which step failed and why. User re-runs after fixing -- idempotency skips already-completed steps
- No retry logic -- fail fast, report clearly

### Output & progress
- Step-by-step terminal output: `[1/32] Creating PROFIT mint... done` (or `SKIPPED` if already exists)
- Transaction signatures written to a log file (not cluttering terminal), useful for Solana Explorer verification
- PDA manifest output in both JSON (machine-readable for verify step) and markdown table (human review)
- Post-verify deployment report as markdown: program IDs, account addresses, pool states, timestamp

### Configuration & targeting
- Default wallet: `keypairs/devnet-wallet.json` (override available)
- No mainnet safety guards -- not needed at this stage
- No airdrop logic -- keep it simple, user handles funding (scripts just check balances)

### Claude's Discretion
- Script composition: whether to use orchestrator + stages or separate per-stage scripts (Claude picks based on what's cleanest)
- Cluster targeting: CLI flag vs Solana CLI config (Claude picks the right approach)
- Verify depth: existence-only vs existence + data checks (Claude picks based on what's practical for catching real issues)
- Auto-airdrop on devnet: Claude decides whether to auto-request SOL or just warn on low balance

</decisions>

<specifics>
## Specific Ideas

- The 17-step init sequence from integration tests (Phase 31) is the proven blueprint for initialization ordering
- All 5 program keypairs are canonical in `keypairs/` directory
- `npm run verify-ids` already validates cross-program ID consistency -- build script should leverage this
- Log file with tx signatures enables easy debugging during Phase 34 devnet deployment
- Deployment report will be valuable reference during Phase 36 end-to-end testing

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 33-deployment-scripts*
*Context gathered: 2026-02-10*
