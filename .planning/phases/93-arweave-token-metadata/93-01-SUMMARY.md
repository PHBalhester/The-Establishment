---
phase: 93-arweave-token-metadata
plan: 01
subsystem: infra
tags: [arweave, irys, metadata, metaplex, token-2022, deploy-pipeline]

# Dependency graph
requires:
  - phase: 91-deploy-config-foundation
    provides: deployment.json schema with MetadataInfo interface, env var patterns
  - phase: 92-mainnet-config
    provides: .env.{cluster} file conventions, cluster arg patterns
provides:
  - upload-metadata.ts script for permanent Arweave storage via Irys
  - metadata-templates.ts with Metaplex-standard JSON builder and steampunk descriptions
  - initialize.ts reads metadata URIs from env vars / deployment.json (no hardcoded Railway URLs)
affects: [93-02-token-logo-approval, 94-fresh-devnet-redeploy, 95-mainnet-deploy]

# Tech tracking
tech-stack:
  added: ["@irys/upload", "@irys/upload-solana"]
  patterns: ["env-var-with-deployment-json-fallback for metadata URIs", "standalone upload script before deploy pipeline"]

key-files:
  created:
    - scripts/deploy/upload-metadata.ts
    - scripts/deploy/lib/metadata-templates.ts
  modified:
    - scripts/deploy/initialize.ts

key-decisions:
  - "resolveMetadataUri: env var priority over deployment.json, hard error on missing"
  - "Always Irys mainnet for permanent Arweave storage (even devnet tokens)"
  - "arweave.net gateway for URIs (permanent, independent of Irys company)"
  - "Steampunk descriptions as defaults with 3 options per token for user approval in Plan 02"

patterns-established:
  - "Metadata URI resolution: process.env.{TOKEN}_METADATA_URI > deployment.json > hard error"
  - "Upload script idempotent: checks deployment.json, --force to re-upload"

requirements-completed: [META-02, META-03, META-04, META-05, META-06, META-09]

# Metrics
duration: 8min
completed: 2026-03-13
---

# Phase 93 Plan 01: Arweave Token Metadata Upload Script Summary

**Irys upload script for permanent Arweave token metadata, initialize.ts updated to resolve URIs from env vars with deployment.json fallback**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-13T19:04:18Z
- **Completed:** 2026-03-13T19:12:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Created upload-metadata.ts: standalone Irys upload script with --cluster/--force/--keypair args, uploads PNGs then JSON to Arweave, writes URIs to deployment.json + .env.{cluster}, includes verification fetch
- Created metadata-templates.ts: Metaplex-standard JSON builder with steampunk-themed descriptions (3 options per token for user approval)
- Updated initialize.ts: resolveMetadataUri() replaces hardcoded Railway placeholder URIs with env var > deployment.json > hard error resolution

## Task Commits

Each task was committed atomically:

1. **Task 1: Install Irys packages and create upload-metadata.ts** - `48700d1` (feat)
2. **Task 2: Update initialize.ts to read metadata URIs from env vars** - `cf1bb14` (feat)

## Files Created/Modified
- `scripts/deploy/upload-metadata.ts` - Standalone Arweave upload script via Irys (439 lines)
- `scripts/deploy/lib/metadata-templates.ts` - Token metadata content and Metaplex JSON builder (144 lines)
- `scripts/deploy/initialize.ts` - Replaced Railway placeholder URIs with resolveMetadataUri() function

## Decisions Made
- Irys packages (@irys/upload, @irys/upload-solana) were already installed as transitive dependencies -- no new install needed
- bs58 available as transitive dep from Solana packages -- no install needed
- Used arweave.net gateway (not gateway.irys.xyz) for maximum URI permanence
- Metadata update authority explicitly documented as retained (META-09) for Phase 97 Squads transfer
- Token descriptions written as steampunk flavor text with 3 options per token as comments

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Irys packages have type declaration issues under the project's moduleResolution: "node" setting. All errors are in node_modules (not our code) and suppressed by skipLibCheck: true in the project tsconfig. Runtime execution via tsx is unaffected.

## User Setup Required

None - no external service configuration required. Logo PNGs (assets/logos/{crime,fraud,profit}.png) must be placed before running upload-metadata.ts.

## Next Phase Readiness
- upload-metadata.ts ready to run once logo PNGs are in place
- initialize.ts will use Arweave URIs on next deploy (requires env vars or deployment.json metadata section)
- Plan 02 should present steampunk description options for user selection

---
*Phase: 93-arweave-token-metadata*
*Completed: 2026-03-13*
