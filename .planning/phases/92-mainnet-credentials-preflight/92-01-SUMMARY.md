---
phase: 92-mainnet-credentials-preflight
plan: 01
subsystem: infra
tags: [env, mainnet, wallet, deployment, sha256, credentials]

# Dependency graph
requires:
  - phase: 91-deploy-config-foundation
    provides: deployment.json schema and deploy-all.sh pipeline
provides:
  - Complete .env.mainnet root template with all codebase env vars
  - Complete app/.env.mainnet frontend template with Railway guidance
  - generate-hashes.sh binary hash manifest generator
  - Fresh mainnet deployer wallet (23g7xmrtXA6LSWopQcAUgiptGUArSLEMakBKcY1S59YR)
affects:
  - 92-02 (preflight gate consumes hash manifests and env files)
  - 93 (Arweave upload needs deployer wallet path from .env.mainnet)
  - 95 (full deploy uses .env.mainnet as source of truth)
  - 98 (mainnet checklist references env templates and wallet)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CHANGE_ME_MAINNET placeholder convention for secrets in env templates"
    - "generate-hashes.sh produces deployments/expected-hashes.{cluster}.json from .so binaries"
    - "Mainnet keys stored outside repo at ~/mainnet-keys/"

key-files:
  created:
    - .env.mainnet (gitignored)
    - app/.env.mainnet (gitignored)
    - scripts/deploy/generate-hashes.sh
    - deployments/expected-hashes.devnet.json
  modified: []

key-decisions:
  - "Mainnet deployer wallet stored at ~/mainnet-keys/deployer.json, outside repo"
  - ".env.mainnet files are gitignored -- secrets never committed"
  - "CHANGE_ME_MAINNET placeholder convention for all secrets and cluster-specific values"
  - "generate-hashes.sh uses shasum -a 256 for macOS compatibility (not sha256sum)"

patterns-established:
  - "Env template pattern: every process.env reference in codebase has a corresponding .env.mainnet entry"
  - "Binary hash verification: generate-hashes.sh -> expected-hashes.{cluster}.json -> preflight comparison"

# Metrics
duration: ~25min (across checkpoint pause)
completed: 2026-03-13
---

# Phase 92 Plan 01: Mainnet Env Templates + Deployer Wallet Summary

**Exhaustive env var audit producing complete .env.mainnet templates with CHANGE_ME placeholders, SHA256 binary hash generator, and fresh mainnet deployer wallet at ~/mainnet-keys/deployer.json**

## Performance

- **Duration:** ~25 min (excluding checkpoint pause for wallet generation)
- **Started:** 2026-03-12T21:45:00Z (approximate)
- **Completed:** 2026-03-13T17:21:42Z
- **Tasks:** 2
- **Files created:** 4 (.env.mainnet, app/.env.mainnet, generate-hashes.sh, expected-hashes.devnet.json)

## Accomplishments
- Exhaustive codebase grep of all process.env references, cross-referenced against .env.devnet and app/.env.devnet to produce complete mainnet env templates
- Root .env.mainnet covers all deploy scripts, crank runner, webhook, treasury, and preflight vars with organized categories and explanatory comments
- Frontend app/.env.mainnet covers all server-side and NEXT_PUBLIC_ client vars with Railway deployment guidance header
- generate-hashes.sh produces JSON hash manifest from compiled .so binaries using shasum -a 256 (macOS-compatible)
- Fresh mainnet deployer wallet generated at ~/mainnet-keys/deployer.json (pubkey: 23g7xmrtXA6LSWopQcAUgiptGUArSLEMakBKcY1S59YR)

## Task Commits

Each task was committed atomically:

1. **Task 1: Exhaustive env var audit and complete .env files** - `d3be42a` (feat)
   - .env.mainnet and app/.env.mainnet created but gitignored
   - scripts/deploy/generate-hashes.sh created and made executable
   - deployments/expected-hashes.devnet.json generated as verification
2. **Task 2: Generate mainnet deployer wallet** - Human-action checkpoint (no commit -- wallet at ~/mainnet-keys/deployer.json, outside repo)

## Files Created/Modified
- `.env.mainnet` - Complete root env template with all codebase vars, CHANGE_ME_MAINNET placeholders (gitignored)
- `app/.env.mainnet` - Complete frontend env template with Railway guidance (gitignored)
- `scripts/deploy/generate-hashes.sh` - SHA256 hash manifest generator for compiled .so binaries
- `deployments/expected-hashes.devnet.json` - Generated hash manifest for current devnet binaries
- `~/mainnet-keys/deployer.json` - Fresh mainnet deployer wallet keypair (outside repo)

## Decisions Made
- Mainnet deployer wallet stored at ~/mainnet-keys/deployer.json, outside the git repo for security
- .env.mainnet files are gitignored -- no mainnet secrets can accidentally be committed
- CHANGE_ME_MAINNET placeholder convention used for all secrets and cluster-specific values
- generate-hashes.sh uses shasum -a 256 (macOS-native) instead of sha256sum (Linux)
- Sentry environment separation uses NEXT_PUBLIC_CLUSTER=mainnet (same DSN, different environment tag)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required at this stage. Credentials (Helius API key, Sentry DSN, etc.) will be filled in during later phases.

## Next Phase Readiness
- .env.mainnet templates ready for 92-02 preflight gate to validate against
- generate-hashes.sh ready for preflight binary hash comparison
- Deployer wallet ready for funding in Phase 98
- Requirements addressed: INFRA-08 (fresh wallet), INFRA-09 (Helius placeholder), INFRA-10 (webhook placeholder), INFRA-11 (Sentry env tag), INFRA-12 (Railway template)

---
*Phase: 92-mainnet-credentials-preflight*
*Completed: 2026-03-13*
