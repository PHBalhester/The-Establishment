# Phase 30: Program ID Fixes - Context

**Gathered:** 2026-02-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix all cross-program ID references so the 5 on-chain programs (AMM, Transfer Hook, Tax, Epoch, Staking) correctly reference each other using production keypair-derived IDs. Build an automated verification script. Update Anchor.toml for devnet. No new program logic — purely configuration, verification, and build consistency.

</domain>

<decisions>
## Implementation Decisions

### Program keypair management
- All 5 program keypairs live in `keypairs/` directory, committed to repo
- Keypair files are the source of truth for program IDs (public keys derived from keypair files)

### Verification script output
- Human-readable colored terminal output by default (table with pass/fail per program)
- `--json` flag for machine-parseable output (CI/scripting use)

### Cluster configuration
- Default cluster in Anchor.toml stays as **localnet** (safest for development)
- Devnet work uses explicit `--provider.cluster devnet` flag
- Helius RPC URL configured via **environment variable** (`$HELIUS_RPC_URL`) — no API keys in the repo

### Claude's Discretion
- **ID source of truth approach**: Whether to use a manifest JSON, Anchor.toml as source, or keypairs-as-source — pick what fits the codebase best
- **Verification script language**: Shell vs TypeScript — pick based on what the script needs to do
- **Verification script scope**: How much beyond ID matching to verify (keypair existence, build check, Anchor.toml consistency)
- **Auto-fix behavior**: Whether script reports only or offers `--fix` flag
- **Pre-build integration**: Whether to hook into build process or keep standalone
- **Anchor.toml cluster sections**: Whether localnet/devnet share IDs, whether to pre-populate mainnet-beta
- **Change process documentation**: Whether a formal checklist is needed or the verification script is sufficient safety net

</decisions>

<specifics>
## Specific Ideas

- User is getting a paid Helius plan for devnet RPC — configure for this in later phases (Phase 34+)
- Env var pattern for RPC: `HELIUS_RPC_URL` (established in this phase, used in deployment phases)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 30-program-id-fixes*
*Context gathered: 2026-02-09*
