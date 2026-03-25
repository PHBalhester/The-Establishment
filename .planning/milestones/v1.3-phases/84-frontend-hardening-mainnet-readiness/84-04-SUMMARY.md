---
phase: 84-frontend-hardening-mainnet-readiness
plan: 04
subsystem: ui, infra
tags: [helius, priority-fees, sentry, token-metadata, metaplex]

requires:
  - phase: 84-01
    provides: RPC proxy with getPriorityFeeEstimate in allowlist
provides:
  - Dynamic priority fee fetching via Helius getPriorityFeeEstimate
  - getRecommendedFee() hook API for transaction builders
  - Enriched Sentry error reporting with runtime/cluster/release tags + breadcrumbs
  - Metaplex-compatible token metadata JSONs for CRIME, FRAUD, PROFIT
affects: [84-05, 85, 86, 87, 89]

tech-stack:
  added: []
  patterns:
    - "Helius getPriorityFeeEstimate via /api/rpc proxy for dynamic fees"
    - "Module-level breadcrumb ring buffer for Sentry context"

key-files:
  created:
    - Docs/token-metadata/crime.json
    - Docs/token-metadata/fraud.json
    - Docs/token-metadata/profit.json
  modified:
    - app/providers/SettingsProvider.tsx
    - app/hooks/useSettings.ts
    - app/lib/sentry.ts

key-decisions:
  - "Kept all 5 PriorityFeePreset values (none/low/medium/high/turbo) -- mapped to Helius Min/Low/Medium/High/VeryHigh"
  - "Fallback fee set to 50,000 micro-lamports when Helius unreachable"
  - "Breadcrumb buffer capped at 20 entries (module-level array, not localStorage)"
  - "Token metadata image/files fields left empty for v1.4 Arweave upload"

patterns-established:
  - "getRecommendedFee(tier?) pattern: TX builders call before each transaction"
  - "addBreadcrumb(message, category) for tracing user actions before errors"

requirements-completed: [FE-01, FE-05, FE-08, FE-09]

duration: 8min
completed: 2026-03-08
---

# Phase 84 Plan 04: Priority Fees, Sentry Hardening, Token Metadata Summary

**Dynamic priority fees via Helius API with user tier selection, enriched Sentry error envelopes with breadcrumbs, and Metaplex token metadata JSONs for all 3 tokens**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-08T12:27:03Z
- **Completed:** 2026-03-08T12:35:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Dynamic priority fee fetching through Helius getPriorityFeeEstimate via /api/rpc proxy
- User tier selection (none/low/medium/high/turbo) maps to Helius priority levels with 50k fallback
- Sentry reporter enriched with server_name, runtime/cluster tags, release SHA, and breadcrumbs
- Token metadata JSON files created for CRIME, FRAUD, and PROFIT (Metaplex standard)
- FE-01 (crank RPC masking) verified as pre-satisfied from Phase 83

## Task Commits

Each task was committed atomically:

1. **Task 1: Dynamic Priority Fees** - `a2a9b27` (feat)
2. **Task 2: Sentry Hardening + Token Metadata** - `f1638d2` (feat)

## Files Created/Modified
- `app/providers/SettingsProvider.tsx` - Added fetchPriorityFee(), getRecommendedFee(), Helius mapping constants
- `app/hooks/useSettings.ts` - Updated docs to reflect getRecommendedFee availability
- `app/lib/sentry.ts` - Added server_name, release, runtime/cluster tags, breadcrumb support
- `Docs/token-metadata/crime.json` - Metaplex token metadata for CRIME
- `Docs/token-metadata/fraud.json` - Metaplex token metadata for FRAUD
- `Docs/token-metadata/profit.json` - Metaplex token metadata for PROFIT

## Decisions Made
- Kept all 5 PriorityFeePreset values (none/low/medium/high/turbo) to avoid breaking existing UI -- mapped each to corresponding Helius priority level
- Fallback fee of 50,000 micro-lamports chosen as reasonable medium-tier default
- Breadcrumbs stored in module-level array (not localStorage) -- they only need to persist within a page session
- Token metadata descriptions include protocol context (staking, yield source) for wallet/registry display

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- getRecommendedFee() API ready for integration into useSwap, useStaking, curve-tx-builder
- Token metadata ready for Arweave upload in v1.4
- Existing PRIORITY_FEE_MAP in useSwap/useStaking can be replaced with getRecommendedFee() calls in a follow-up plan

---
*Phase: 84-frontend-hardening-mainnet-readiness*
*Completed: 2026-03-08*
