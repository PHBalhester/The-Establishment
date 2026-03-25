---
phase: 91-deploy-config-foundation
plan: 02
subsystem: infra
tags: [code-generation, deployment, constants, typescript]

# Dependency graph
requires:
  - phase: 91-01
    provides: "deployments/devnet.json schema and deployment-schema.ts types"
provides:
  - "generate-constants.ts: reads deployment.json, writes shared/constants.ts"
  - "Auto-generated shared/constants.ts replacing hand-maintained version"
affects: ["deploy-all.sh pipeline (Phase 4 step)", "any future deploy that changes addresses"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Code generation via string concatenation (no AST tools)"
    - "AUTO-GENERATED header to prevent manual edits"
    - "Pre-computed PDAs from deployment.json instead of runtime derivation"

key-files:
  created:
    - scripts/deploy/generate-constants.ts
  modified:
    - shared/constants.ts

key-decisions:
  - "Curve PDAs emitted as pre-computed PublicKey constants instead of runtime deriveCurvePdas() function"
  - "Generator accepts cluster argument (devnet|mainnet) for multi-cluster support"
  - "Static values (seeds, decimals, fees) hardcoded in generator template, not read from deployment.json"

patterns-established:
  - "generate-constants.ts is the ONLY writer of shared/constants.ts"
  - "Run generator after any deploy to sync constants with deployment.json"

requirements-completed: [INFRA-02]

# Metrics
duration: 5min
completed: 2026-03-12
---

# Phase 91 Plan 02: Constants Code Generator Summary

**generate-constants.ts reads deployments/{cluster}.json and produces a complete shared/constants.ts with all 30+ exports, replacing the hand-maintained version with zero consumer breakage**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-12T21:21:46Z
- **Completed:** 2026-03-12T21:27:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Built `generate-constants.ts` that reads deployment.json and produces a complete constants.ts
- Generated constants.ts is API-compatible with the old hand-maintained version (all exports identical)
- All 15+ app/ consumer files compile without errors against the generated output
- Generator output is idempotent (re-running produces identical content)
- Curve PDAs are now pre-computed from deployment.json instead of runtime derivation

## Task Commits

Each task was committed atomically:

1. **Task 1: Catalog current constants.ts API surface and build the generator** - `a40f890` (feat)
2. **Task 2: Generate constants.ts and verify all consumers compile** - `09188eb` (feat)

## Files Created/Modified
- `scripts/deploy/generate-constants.ts` - Code generator that reads deployment.json and writes constants.ts (789 lines)
- `shared/constants.ts` - Auto-generated protocol constants with AUTO-GENERATED header (567 lines)

## Decisions Made
- **Pre-computed curve PDAs:** The old constants.ts used a `deriveCurvePdas()` function to compute curve PDAs at import time. The generator emits pre-computed addresses from deployment.json instead, eliminating the runtime computation. The addresses are identical.
- **No mainnet.json required:** When mainnet.json doesn't exist, the generator emits placeholder PublicKey.default values for mainnet config, matching the previous behavior exactly.
- **Consumers import via @dr-fraudsworth/shared package:** The app/ directory imports through the barrel `shared/index.ts`, not directly from `shared/constants.ts`. This means the generator only needs to maintain the constants.ts API, not worry about import paths.

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None -- no external service configuration required.

## Next Phase Readiness
- `generate-constants.ts` is ready to be integrated into the deploy-all.sh pipeline (future Phase 4 step)
- Mainnet support is forward-compatible: when `deployments/mainnet.json` exists, re-running the generator will populate real mainnet addresses

---
*Phase: 91-deploy-config-foundation*
*Completed: 2026-03-12*
