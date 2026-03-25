---
phase: 93-arweave-token-metadata
plan: 02
subsystem: infra
tags: [arweave, irys, metadata, token-2022, on-chain-update, wallet-display]

# Dependency graph
requires:
  - phase: 93-arweave-token-metadata
    provides: upload-metadata.ts script, metadata-templates.ts with description options
  - phase: 91-deploy-config-foundation
    provides: deployment.json schema with metadata section, mint addresses
provides:
  - 6 permanent Arweave files (3 PNG logos + 3 metadata JSONs) with arweave.net URIs
  - On-chain Token-2022 metadata URIs updated for all 3 devnet mints
  - update-metadata-uri.ts script for updating existing mint metadata URIs
  - deployments/devnet.json metadata + metadataImages sections populated
  - .env.devnet CRIME/FRAUD/PROFIT_METADATA_URI variables
affects: [94-bonding-curve-deadline, 95-pathway-2-full-deploy, 99-nextra-documentation]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Irys mainnet for permanent Arweave even during devnet testing", "update-metadata-uri.ts as standalone on-chain updater"]

key-files:
  created:
    - scripts/deploy/update-metadata-uri.ts
  modified:
    - scripts/deploy/upload-metadata.ts
    - scripts/deploy/lib/metadata-templates.ts
    - deployments/devnet.json
    - .env.devnet
    - assets/logos/crime.png
    - assets/logos/fraud.png
    - assets/logos/profit.png

key-decisions:
  - "CRIME description: Option B steampunk vault narrative"
  - "FRAUD description: Option C impeccable duplicity narrative"
  - "PROFIT description: Custom F perpetual motion engine narrative"
  - "Irys mainnet funded from mainnet deployer wallet (~0.0004 SOL total)"
  - "Irys gateway (gateway.irys.xyz) for immediate verification; arweave.net for permanent URIs"

patterns-established:
  - "update-metadata-uri.ts reads URIs from deployment.json and updates on-chain Token-2022 metadata"
  - "Upload once to Arweave, reuse URIs across devnet and mainnet (same content, different mints)"

requirements-completed: [META-01, META-07, META-08]

# Metrics
duration: ~45min (across 3 sessions with checkpoints)
completed: 2026-03-13
---

# Phase 93 Plan 02: Arweave Upload and On-Chain Metadata Update Summary

**Uploaded 3 token logos + 3 metadata JSONs to permanent Arweave storage via Irys mainnet, updated on-chain Token-2022 URIs for all devnet mints, verified wallet/explorer display**

## Performance

- **Duration:** ~45 min (across 3 checkpoint sessions)
- **Started:** 2026-03-13
- **Completed:** 2026-03-13
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments
- User selected token descriptions: CRIME (steampunk vault), FRAUD (impeccable duplicity), PROFIT (perpetual motion engine -- custom text)
- 6 files uploaded to permanent Arweave via Irys mainnet: 3 PNG logos + 3 Metaplex-standard metadata JSONs
- On-chain metadata URIs updated for all 3 devnet mints (CRIME=8NEgQ, FRAUD=76ddo, PROFIT=7X6xx) from Railway placeholders to Arweave URIs
- Created update-metadata-uri.ts script for updating existing mint metadata URIs (reusable for mainnet)
- User verified metadata displays correctly via Irys gateway links

## Task Commits

Each task was committed atomically:

1. **Task 1: User provides logos and approves descriptions** - checkpoint:decision (no commit -- creative input)
2. **Task 2: Run upload-metadata.ts and update on-chain URIs** - `cc177ad` (feat)
3. **Task 3: Verify token display in wallets and explorers** - checkpoint:human-verify (no commit -- visual verification)

## Files Created/Modified
- `scripts/deploy/update-metadata-uri.ts` - Standalone script to update on-chain Token-2022 metadata URIs from deployment.json
- `scripts/deploy/upload-metadata.ts` - Modified: always uses Irys mainnet, upfront funding, Irys gateway verification
- `scripts/deploy/lib/metadata-templates.ts` - Modified: user-approved descriptions for all 3 tokens
- `deployments/devnet.json` - Modified: metadata + metadataImages sections with Arweave URIs
- `.env.devnet` - Modified: CRIME/FRAUD/PROFIT_METADATA_URI env vars added
- `assets/logos/crime.png` - CRIME token logo (512x512 PNG)
- `assets/logos/fraud.png` - FRAUD token logo (512x512 PNG)
- `assets/logos/profit.png` - PROFIT token logo (512x512 PNG)

## Arweave URIs (Permanent)

| Token | Metadata JSON | Image PNG |
|-------|--------------|-----------|
| CRIME | https://arweave.net/Az8YzMn5JVUukXu3zGqUr2x6V9wWWTtK8FHSPnSQxUhT | (in metadata JSON) |
| FRAUD | https://arweave.net/2xrXxdsbWRZWX5Ahvp9tG2fLMzqEQ8XDA55eYXDVqjin | (in metadata JSON) |
| PROFIT | https://arweave.net/5212UnivXo5MjQKLSXBToge9PPgeWgSnm6KjEY2XXecL | (in metadata JSON) |

## Decisions Made
- **CRIME description**: Option B -- "Minted in the steam-powered vaults beneath Dr. Fraudsworth's laboratory..."
- **FRAUD description**: Option C -- "A token of impeccable duplicity, crafted by Dr. Fraudsworth himself..."
- **PROFIT description**: Custom F -- "The spoils of Dr. Fraudsworth's perpetual motion engine. Stake your tokens, earn your rewards. Crime does pay, after all."
- Used Irys mainnet (not devnet) so Arweave URIs are permanent and reusable for mainnet tokens
- Funded Irys from mainnet deployer wallet with real SOL (~0.0004 SOL total for all 6 files)
- Arweave gateway propagation takes time; Irys gateway serves immediately for verification

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Arweave gateway propagation delay means arweave.net URIs may not resolve immediately after upload. Irys gateway (gateway.irys.xyz) serves content immediately and was used for verification.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 93 complete -- all token metadata uploaded and on-chain
- Phase 94 can proceed: bonding curve deadline feature flag + Pathway 1 testing
- Mainnet tokens will get fresh uploads using the same scripts (upload-metadata.ts + update-metadata-uri.ts)
- Token logos committed to git at assets/logos/ for reproducibility

---
*Phase: 93-arweave-token-metadata*
*Completed: 2026-03-13*
