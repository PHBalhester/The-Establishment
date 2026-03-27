---
phase: 104-open-source-release-and-ottersec-verification
plan: 06
subsystem: infra
tags: [ottersec, verified-builds, solana-verify, mainnet, on-chain-verification, solscan, explorer-badge]

requires:
  - phase: 104-open-source-release-and-ottersec-verification
    provides: Public GitHub repo at MetalLegBob/drfraudsworth with commit hash for verification (Plan 05)
provides:
  - All 6 active mainnet programs have OtterSec verified build badges
  - On-chain PDAs linking each program to public repo + commit hash
  - Verification status URLs for all 6 programs
  - Solana Explorer / Solscan "Program Source Verified" badges
affects: []

tech-stack:
  added: [solana-verify]
  patterns: [ottersec-verified-build-submission, on-chain-verification-pda]

key-files:
  created: []
  modified: []

key-decisions:
  - "Deployer wallet can sign verification PDAs even after upgrade authority transferred to Squads vault -- no Squads TX needed"
  - "Cost ~0.016 SOL for 6 PDAs (slightly above 0.012 SOL estimate)"
  - "Bonding Curve program excluded from verification (program account closed after graduation, rent reclaimed)"
  - "Commit hash 0a49574 (HEAD of MetalLegBob/drfraudsworth at time of submission)"

patterns-established:
  - "OtterSec verification: verify-from-repo uploads PDA, then remote submit-job triggers independent build"

requirements-completed: []

duration: ~30min
completed: 2026-03-25
---

# Phase 104 Plan 06: OtterSec Verified Build Submission Summary

**All 6 active mainnet programs submitted and confirmed verified by OtterSec -- deployed bytecode cryptographically matches public repo source, Solscan badges live**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-03-25 (approximate)
- **Completed:** 2026-03-25
- **Tasks:** 2 (submission + human verification checkpoint)
- **Files modified:** 0 (all work was on-chain PDA uploads and API calls)

## Accomplishments
- Uploaded verification PDAs on-chain for all 6 active mainnet programs linking to https://github.com/MetalLegBob/drfraudsworth at commit 0a49574
- Submitted remote verification jobs to OtterSec's builder for all 6 programs
- All 6 programs confirmed verified -- OtterSec independently cloned the public repo, built each program, and confirmed hashes match the deployed on-chain binaries
- Solscan verified badges already showing for all 6 programs
- Deployer wallet successfully signed PDAs despite upgrade authorities being held by Squads vault

## Programs Verified

| Program | Program ID | OtterSec Status URL |
|---------|-----------|-------------------|
| AMM | 5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR | https://verify.osec.io/status/5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR |
| Transfer Hook | CiQPQrmQh6BPhb9k7dFnsEs5gKPgdrvNKFc5xie5xVGd | https://verify.osec.io/status/CiQPQrmQh6BPhb9k7dFnsEs5gKPgdrvNKFc5xie5xVGd |
| Tax Program | 43fZGRtmEsP7ExnJE1dbTbNjaP1ncvVmMPusSeksWGEj | https://verify.osec.io/status/43fZGRtmEsP7ExnJE1dbTbNjaP1ncvVmMPusSeksWGEj |
| Epoch Program | 4Heqc8QEjJCspHR8y96wgZBnBfbe3Qb8N6JBZMQt9iw2 | https://verify.osec.io/status/4Heqc8QEjJCspHR8y96wgZBnBfbe3Qb8N6JBZMQt9iw2 |
| Staking | 12b3t1cNiAUoYLiWFEnFa4w6qYxVAiqCWU7KZuzLPYtH | https://verify.osec.io/status/12b3t1cNiAUoYLiWFEnFa4w6qYxVAiqCWU7KZuzLPYtH |
| Conversion Vault | 5uawA6ehYTu69Ggvm3LSK84qFawPKxbWgfngwj15NRJ | https://verify.osec.io/status/5uawA6ehYTu69Ggvm3LSK84qFawPKxbWgfngwj15NRJ |

**Not verified:** Bonding Curve (DpX3...) -- program account closed after graduation, rent reclaimed.

## Task Commits

No local code changes were made -- all work was on-chain PDA uploads and OtterSec API calls:

1. **Task 1: Submit all 6 programs for OtterSec verification** - on-chain PDAs uploaded, remote verification jobs submitted
2. **Task 2 (checkpoint): User verified OtterSec status** - user confirmed Solscan badges showing for all 6 programs

## Files Created/Modified

None -- this plan involved only on-chain operations (PDA uploads) and external API calls (OtterSec remote builder submissions).

## Decisions Made

1. **Deployer can sign PDAs post-authority-transfer**: The solana-verify CLI allows any signer to upload verification PDAs -- it does not require the current upgrade authority. This meant no Squads multisig transactions were needed, simplifying the process significantly.

2. **PDA cost slightly above estimate**: Actual cost was ~0.016 SOL for 6 PDAs (plan estimated ~0.012 SOL). Negligible difference.

3. **Bonding Curve excluded**: Program account was closed after graduation (rent reclaimed ~4.73 SOL in Phase 100-04), so there is nothing to verify on-chain.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - all 6 programs submitted successfully and verified without hash mismatches or authority errors.

## Next Phase Readiness
- Phase 104 is COMPLETE (6/6 plans done)
- All success criteria from Phase 104 met:
  1. Public GitHub repo MetalLegBob/drfraudsworth exists with curated codebase
  2. 5 consecutive clean sanitization passes found zero secrets
  3. SECURITY_AUDIT_SUMMARY.md at repo root with transparent methodology label
  4. All documentation verified accurate against mainnet state
  5. Comprehensive README with protocol overview, addresses, build instructions, audit links
  6. All 6 active mainnet programs verified by OtterSec with explorer badges
  7. Docs-site GitHub link points to public repo

---
*Phase: 104-open-source-release-and-ottersec-verification*
*Completed: 2026-03-25*
