---
phase: 92-mainnet-credentials-preflight
plan: 02
subsystem: infra
tags: [deploy, preflight, safety, mainnet, env-vars, hash-verification]

# Dependency graph
requires:
  - phase: 92-01
    provides: .env.mainnet templates, generate-hashes.sh, deployer wallet
  - phase: 91
    provides: deploy-all.sh pipeline structure
provides:
  - Mandatory preflight safety gate in deploy-all.sh (5 checks)
  - Keypair git-staging detection
  - Env var validation with placeholder detection
  - Mainnet wallet sanity check
  - Deployer balance verification
  - Binary hash manifest comparison
affects:
  - 95 (full deploy uses deploy-all.sh with preflight gate)
  - 98 (mainnet checklist references MAINNET_MIN_BALANCE)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Preflight gate pattern: embedded checks in pipeline, not standalone script"
    - "Collect-all-errors pattern: gather all failures before reporting (no early exit on first)"
    - "PREFLIGHT_FAILED accumulator flag for multi-check validation"

key-files:
  created: []
  modified:
    - scripts/deploy/deploy-all.sh

key-decisions:
  - "Preflight labeled as 'Preflight' section, not renumbered as Phase -1 to avoid shifting existing phase numbers"
  - "All 5 checks run on every deploy; checks 3-5 are mainnet-only gates"
  - "Uses awk for float comparison instead of bc (more reliably available on macOS)"
  - "MAINNET_MIN_BALANCE defaults to 10 SOL if unset"
  - "Hash manifest check iterates manifest keys (not .so files) to catch missing binaries"

patterns-established:
  - "Deploy pipeline safety: git staging scan, env validation, balance check, binary verification"

# Metrics
duration: ~4min
completed: 2026-03-13
---

# Phase 92 Plan 02: Preflight Safety Gate Summary

**Mandatory preflight safety gate in deploy-all.sh with 5 checks: keypair staging, env vars, wallet sanity, deployer balance, and binary hash verification**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-03-13T17:40:29Z
- **Completed:** 2026-03-13T17:44:33Z
- **Tasks:** 1/1
- **Files modified:** 1 (scripts/deploy/deploy-all.sh, +319 lines)

## Accomplishments

- Inserted Preflight Safety Gate section between mainnet confirmation prompt and Phase 0 in deploy-all.sh
- Check 1: Scans `git diff --cached` for keypair/wallet/mint/deployer JSON files in staging area (both clusters)
- Check 2: Validates all required env vars (HELIUS_API_KEY, CLUSTER_URL, COMMITMENT, pool seeds) are set and not CHANGE_ME placeholders; adds DEPLOYER_KEYPAIR, TREASURY_PUBKEY, MAINNET_MIN_BALANCE on mainnet
- Check 3: Blocks mainnet deploys if WALLET contains "devnet" or wallet file doesn't exist; validates DEPLOYER_KEYPAIR file exists
- Check 4: Queries deployer balance via `solana balance` and compares against MAINNET_MIN_BALANCE using awk float comparison
- Check 5: Compares each .so binary's shasum -a 256 against deployments/expected-hashes.{cluster}.json manifest using jq
- All checks use collect-all-errors pattern (PREFLIGHT_FAILED accumulator) for comprehensive failure reporting
- Shell syntax validated via `bash -n`

## Task Commits

1. **Task 1: Insert preflight safety gate into deploy-all.sh** - `e02c403` (feat)
   - 5 preflight checks with clear PREFLIGHT FAILED error messages
   - Existing Phase 0-6 structure completely unchanged

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

- Preflight gate active for all future deploys (devnet passes, mainnet requires credentials)
- INFRA-14 fully satisfied
- Phase 92 complete -- both plans (01: env templates + wallet, 02: preflight gate) delivered
- Ready for Phase 93 (Arweave metadata upload)

---
*Phase: 92-mainnet-credentials-preflight*
*Completed: 2026-03-13*
