# Phase 97: Squads Governance - Context

**Gathered:** 2026-03-15
**Status:** Ready for planning

<domain>
## Phase Boundary

All program authorities (7 upgrade + 3 admin PDAs) transferred to a 2-of-3 Squads multisig with configurable timelock on devnet. Full timelocked upgrade round-trip proven (upgrade, revert). Verification scripts confirm all authorities held by Squads vault. Mainnet governance procedure documented step-by-step. Requirements: GOV-01 through GOV-08.

</domain>

<decisions>
## Implementation Decisions

### Signer set
- All 3 signers are the user (solo operator), across different wallets/devices
- Devnet: 3 auto-generated file keypairs (keypairs/squads-signer-{1,2,3}.json) for full scripting automation
- Mainnet: swap 1 key to hardware wallet (Ledger). Scripts support both file and hardware signing modes
- setup-squads.ts generates signer keypairs automatically, funds them from devnet wallet

### Timelock & config
- Devnet timelock: 5 minutes (fast iteration for testing the full propose-approve-wait-execute cycle)
- Mainnet timelock progression (fixed schedule, documented for community):
  - Launch: 15 minutes (early hotfix agility)
  - After 48hr stable: extend to 24 hours
  - After external audit funded + completed: consider authority burn
- Timelock duration configured via `SQUADS_TIMELOCK_SECONDS` env var (devnet .env = 300, mainnet .env = 900)
- Config authority = the multisig itself (changes to multisig settings require 2-of-3 proposal + timelock)

### Transfer ordering
- All 10 authorities transferred in one script run (transfer-authority.ts)
- 7 upgrade authorities: loop through all programs, transfer each, verify each after transfer
- 3 admin PDA authorities: direct TX from deployer (call transfer_admin/transfer_whitelist_authority, set new authority to Squads vault PDA)
- NOT Squads proposals for admin PDA transfer — deployer still holds admin authority, direct transfer is simpler
- verify-authority.ts includes negative test: attempt upgrade from deployer wallet, confirm it fails with authority mismatch
- deployments/devnet.json auto-updated after successful transfer (squadsVault address + transferredAt timestamp)

### Upgrade proof approach
- Guinea pig program: Conversion Vault (simplest, fewest dependencies, least risk)
- Test change: add `msg!("Squads upgrade test v2")` to convert instruction (verifiable via TX logs, trivially reversible)
- Full round-trip: upgrade to modified version, verify, then upgrade BACK to original (proves both directions work)
- Orchestration: test-upgrade.ts script — build modified vault, create Squads proposal with buffer, approve with signer 1+2, wait for timelock, execute, verify bytecode changed. All automated on devnet
- Two complete upgrade cycles tested (upgrade + revert)

### Claude's Discretion
- Squads v4 SDK API specifics and initialization pattern
- Buffer account management for program upgrades via Squads
- Exact verification approach for bytecode comparison (hash vs discriminator check)
- Script error handling and retry logic
- Mainnet procedure document structure and formatting

</decisions>

<specifics>
## Specific Ideas

- Mainnet timelock starts at 15 minutes (not 2 hours as originally specced in security-model.md) — user wants hotfix agility at launch
- Full round-trip revert proves upgrades work in both directions — important for community confidence
- Negative verification (deployer CAN'T upgrade) is as important as positive verification (Squads CAN upgrade)
- Config authority being the multisig itself prevents single-signer governance hijacking

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `deployments/devnet.json`: Already has `authority` section with `squadsVault` and `transferredAt` fields (Phase 91)
- `scripts/deploy/lib/deployment-schema.ts`: AuthorityInfo type with squadsVault validation
- `scripts/deploy/verify.ts`: On-chain verification patterns (reads deployment.json, checks state)
- `scripts/deploy/lib/connection.ts`: `loadProvider()` + `loadPrograms()` pattern for all deploy scripts
- `scripts/deploy/build.sh`: Build pipeline for program compilation

### Established Patterns
- Deploy scripts use `set -a && source .env.devnet && set +a` for env loading
- Env-var-driven configuration (matches SQUADS_TIMELOCK_SECONDS approach)
- `deployments/devnet.json` as single source of truth for all addresses
- Scripts in `scripts/deploy/` follow idempotent patterns (skip completed steps)

### Integration Points
- `deployments/devnet.json` — authority section updated after transfer
- `shared/constants.ts` — may need Squads vault address exposed (via generate-constants.ts)
- Authority Map in PROJECT.md — should be updated to reflect Squads vault as holder
- 7 program ProgramData accounts — upgrade authority field
- 3 admin PDAs: AMM AdminConfig (has_one = admin), WhitelistAuthority (authority field), BcAdminConfig (has_one = authority)

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 97-squads-governance*
*Context gathered: 2026-03-15*
