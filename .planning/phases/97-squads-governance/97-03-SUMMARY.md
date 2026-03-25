---
phase: 97-squads-governance
plan: 03
subsystem: auth
tags: [squads, multisig, governance, upgrade, timelock, bpf-loader, devnet]

# Dependency graph
requires:
  - phase: 97-squads-governance-plan-02
    provides: "Squads 2-of-3 multisig on devnet, setup/transfer/verify scripts, signer keypairs"
  - phase: 97-squads-governance-plan-01
    provides: "transfer_admin/transfer_authority/transfer_bc_admin instructions"
provides:
  - "Proven timelocked upgrade round-trip (upgrade + revert) through Squads on devnet"
  - "test-upgrade.ts (automated upgrade cycle: deploy, buffer, propose, approve, timelock, execute)"
  - "Docs/mainnet-governance.md (9-section step-by-step mainnet procedure)"
affects: [mainnet-deploy, deploy-pipeline, authority-management]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Symlink workaround for Solana CLI path-with-spaces (Dr Fraudsworth project dir)"
    - "confirmOrThrow helper: detect silent failures when using skipPreflight"
    - "Squads vaultTransactionCreate requires creator to be a multisig member"
    - "RPC propagation delay after upgrade: retry loop for last_deploy_slot verification"

key-files:
  created:
    - "scripts/deploy/test-upgrade.ts"
    - "Docs/mainnet-governance.md"
    - "keypairs/test-upgrade-program.json"
  modified: []

key-decisions:
  - "Used fake_tax_program (186KB) instead of conversion_vault (375KB) as test guinea pig to conserve devnet SOL"
  - "Used two different pre-built binaries (fake_tax_program vs mock_tax_program) instead of modify-and-rebuild to avoid expensive anchor build cycles on devnet"
  - "Squads vault TX creator must be a multisig member (deployer is NOT a member)"
  - "Buffer rent from consumed upgrades goes to spill address (vault PDA), not deployer"
  - "Test program left deployed on devnet (authority = vault PDA) -- can be closed via Squads proposal or next full redeploy"

patterns-established:
  - "Upgrade round-trip: write buffer -> set buffer authority -> vault TX create -> propose -> 2-of-3 approve -> wait timelock -> execute -> verify"
  - "BPFLoaderUpgradeable::Upgrade IX: discriminator 3, accounts [programData(w), program(w), buffer(w), spill(w), rent(r), clock(r), authority(s)]"
  - "For Squads: payerKey in TransactionMessage = vault PDA (inner instruction payer)"

requirements-completed: [GOV-04, GOV-08]

# Metrics
duration: 34min
completed: 2026-03-15
---

# Phase 97 Plan 03: Timelocked Upgrade Round-Trip + Mainnet Governance Docs Summary

**Two complete timelocked upgrade cycles proven on devnet (upgrade + revert through 2-of-3 Squads approval + 300s timelock), mainnet governance procedure documented in 9 sections**

## Performance

- **Duration:** 34 min
- **Started:** 2026-03-15T09:41:56Z
- **Completed:** 2026-03-15T10:15:52Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Full timelocked upgrade round-trip proven on devnet: deploy fresh test program, transfer authority to Squads vault PDA, upgrade via propose/approve/timelock/execute, then revert via same flow
- Cycle 1 (Upgrade): last_deploy_slot changed 448624102 -> 448625061 after 300s timelock
- Cycle 2 (Revert): last_deploy_slot changed 448625061 -> 448625930 after 300s timelock
- Comprehensive mainnet governance document (Docs/mainnet-governance.md) with 9 sections covering setup, transfer, upgrade, timelock progression, emergency procedures, and authority burn sequence

## Task Commits

Each task was committed atomically:

1. **Task 1: Prove timelocked upgrade round-trip** - `d952fa3` (feat)
2. **Task 2: Write mainnet governance document** - `fc0f653` (docs)

## Files Created/Modified
- `scripts/deploy/test-upgrade.ts` - Automated timelocked upgrade round-trip test (deploy, buffer, propose, approve x2, timelock, execute, verify -- 2 full cycles)
- `Docs/mainnet-governance.md` - 9-section mainnet governance procedure with exact commands, verification steps, timelock schedule, and authority burn sequence
- `keypairs/test-upgrade-program.json` - Keypair for the disposable test program deployed on devnet

## Decisions Made
- Used fake_tax_program (186KB) instead of conversion_vault (375KB) as guinea pig to conserve devnet SOL -- buffer writes cost ~1.3 SOL vs ~2.6 SOL
- Used pre-built binaries (fake vs mock tax program) for upgrade/revert instead of modifying source and rebuilding -- proves the same governance flow without expensive build cycles
- Deployer is NOT a multisig member -- vaultTransactionCreate requires a member as creator, so signers[0] is used instead
- Added confirmOrThrow helper to detect silent transaction failures when using skipPreflight: true
- Added symlink workaround (~/.dr-fraudsworth-link) for Solana CLI path-with-spaces issue

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Squads vaultTransactionCreate requires member as creator**
- **Found during:** Task 1 (first run attempt)
- **Issue:** Passing deployer.publicKey as creator failed with error 6005 (NotAMember). Deployer is the fee payer but not a multisig member.
- **Fix:** Changed creator from deployer.publicKey to signers[0].publicKey, added signers[0] to signers array.
- **Files modified:** scripts/deploy/test-upgrade.ts
- **Verification:** Vault TX creation succeeded on subsequent run
- **Committed in:** d952fa3

**2. [Rule 1 - Bug] Silent TX failure with skipPreflight: true**
- **Found during:** Task 1 (first successful-looking run)
- **Issue:** confirmTransaction returns success for failed TXs when skipPreflight is used. The vault TX creation failed but the script continued to proposalCreate.
- **Fix:** Added confirmOrThrow helper that checks confirmation.value.err and fetches TX logs on failure.
- **Files modified:** scripts/deploy/test-upgrade.ts
- **Verification:** Subsequent failures caught and reported with error details
- **Committed in:** d952fa3

**3. [Rule 1 - Bug] RPC propagation delay after upgrade**
- **Found during:** Task 1 (Cycle 1 verification)
- **Issue:** Reading ProgramData immediately after upgrade execution returned stale last_deploy_slot (unchanged). RPC needs time to propagate.
- **Fix:** Added retry loop (up to 10 attempts, 3s each) for last_deploy_slot verification.
- **Files modified:** scripts/deploy/test-upgrade.ts
- **Verification:** Verification succeeds after 3 retries on devnet
- **Committed in:** d952fa3

**4. [Rule 3 - Blocking] Solana CLI rejects paths with spaces**
- **Found during:** Task 1 (initial deploy attempt)
- **Issue:** `solana program deploy` with `--program-id` flag fails when the path contains spaces ("Dr Fraudsworth"). Error: "unrecognized signer source".
- **Fix:** Created symlink at ~/.dr-fraudsworth-link -> project root. All CLI paths go through safePath() to use symlink.
- **Files modified:** scripts/deploy/test-upgrade.ts
- **Verification:** Deploy, write-buffer, and set-buffer-authority all succeed through symlink
- **Committed in:** d952fa3

---

**Total deviations:** 4 auto-fixed (3 bugs, 1 blocking)
**Impact on plan:** All fixes necessary for correct operation. The plan assumed conversion vault would be the guinea pig (but its authority is burned), so a fresh test program approach was used instead -- same governance flow proven.

## Issues Encountered
- Devnet upgrade authorities burned (from Plan 97-02 bug) -- adapted by deploying a fresh test program with deployer authority, then transferring to vault
- First test program deployed using conversion_vault binary (375KB, ~2.6 SOL) was closed to reclaim SOL, then re-deployed using smaller fake_tax_program binary (186KB, ~1.3 SOL) for SOL conservation
- Devnet airdrop rate-limited initially but eventually landed additional SOL
- Stale buffer from failed earlier run (~1.3 SOL locked in buffer with vault authority) -- cannot be recovered without Squads proposal

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 97 (Squads Governance) is now COMPLETE: all 3 plans finished
- All GOV requirements satisfied: GOV-01 through GOV-08
- Scripts are mainnet-ready:
  - setup-squads.ts (create multisig)
  - transfer-authority.ts (transfer all 10 authorities, bugs fixed)
  - verify-authority.ts (verify all 11 checks)
  - test-upgrade.ts (prove upgrade round-trip)
- Mainnet governance procedure documented step-by-step
- Next milestone phase can proceed (Arweave metadata, fresh devnet redeploy, lifecycle test, mainnet deploy)

---
*Phase: 97-squads-governance*
*Completed: 2026-03-15*
