---
phase: 39-foundation-scaffolding
plan: 02
subsystem: ui
tags: [anchor, idl, solana, rpc, browser-integration, devnet, proof-of-life]

# Dependency graph
requires:
  - phase: 39-01
    provides: Next.js 16 app scaffold, npm workspaces, Buffer polyfill, shared constants
provides:
  - IDL sync script copying 5 production program IDLs + types from target/ to app/idl/
  - Anchor program factory (5 getter functions for browser-side Program construction)
  - RPC connection factory with env var override
  - Proof-of-life page deserializing real AdminConfig data from Solana devnet
affects: [40-wallet-connection, 41-protocol-data-dashboard, 42-swap-interface, 43-staking-interface]

# Tech tracking
tech-stack:
  added: [drizzle-orm@0.45.1, drizzle-kit@0.31.9]
  patterns: [IDL sync via predev/prebuild hooks, read-only Anchor Program in browser, useEffect RPC fetch with error boundary]

key-files:
  created:
    - app/scripts/sync-idl.mjs
    - app/lib/anchor.ts
    - app/lib/connection.ts
  modified:
    - app/package.json (added predev/prebuild hooks, drizzle deps)
    - app/app/page.tsx (upgraded from shared-only to Anchor RPC proof-of-life)

key-decisions:
  - "Read-only Anchor Program constructor (no wallet) for RPC data fetching"
  - "AdminConfig PDA as proof-of-life target -- simplest single-account fetch to validate full pipeline"
  - "Graceful degradation: IDL sync exits 0 if target/idl/ missing (won't break dev server for frontend-only work)"

patterns-established:
  - "Pattern: IDL sync script in app/scripts/sync-idl.mjs, invoked automatically by predev/prebuild npm hooks"
  - "Pattern: Program factory functions (getAmmProgram, getEpochProgram, etc.) in app/lib/anchor.ts -- all downstream code uses these, never raw Program constructors"
  - "Pattern: Connection factory in app/lib/connection.ts with NEXT_PUBLIC_RPC_URL override"

# Metrics
duration: 6min
completed: 2026-02-15
---

# Phase 39 Plan 02: IDL Sync + Anchor Browser Integration Summary

**IDL sync pipeline for 5 production programs with Anchor program factory, connection factory, and proof-of-life page deserializing AdminConfig from Solana devnet**

## Performance

- **Duration:** ~6 min (Tasks 1-2), plus human verification checkpoint
- **Started:** 2026-02-15T19:21:16Z
- **Completed:** 2026-02-15T19:28:00Z (approx, before checkpoint pause)
- **Tasks:** 3 (2 auto + 1 human-verify checkpoint)
- **Files modified:** 5

## Accomplishments
- Created IDL sync script that copies 5 production program IDLs (amm, epoch_program, staking, tax_program, transfer_hook) and their TypeScript type definitions from `target/idl/` to `app/idl/`
- Built Anchor program factory with 5 getter functions (getAmmProgram, getEpochProgram, getStakingProgram, getTaxProgram, getHookProgram) for browser-side read-only Program construction
- Created connection factory with NEXT_PUBLIC_RPC_URL env var override defaulting to devnet Helius RPC
- Upgraded proof-of-life page to show 3 status indicators: shared imports (OK), Buffer polyfill (OK), Anchor RPC (OK with deserialized AdminConfig admin pubkey)
- User verified in browser: all 3 indicators green, 5 program IDs displayed, 3 token mints displayed, no console errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Create IDL sync script and Anchor program factory** - `6db6ddf` (feat)
2. **Task 2: Update proof-of-life page to deserialize devnet account data** - `e2d1654` (feat)
3. **Task 3: Human verification checkpoint** - APPROVED (no commit, user verified in browser)

## Files Created/Modified
- `app/scripts/sync-idl.mjs` - IDL sync script: copies 5 JSON IDLs + TS types from target/ to app/idl/
- `app/lib/anchor.ts` - Program factory: 5 getter functions returning read-only Anchor Programs
- `app/lib/connection.ts` - Connection factory: getConnection() with env var override
- `app/app/page.tsx` - Proof-of-life page with 3 status indicators and AdminConfig deserialization
- `app/package.json` - Added predev/prebuild sync hooks, drizzle-orm, drizzle-kit dependencies

## Decisions Made
- Used read-only Anchor Program constructor (no wallet provider) for data fetching. All 5 factory functions create Programs that can deserialize accounts but not sign transactions. Wallet-aware Program instances will be created in Phase 40 when wallet connection is available.
- Chose AdminConfig PDA as the proof-of-life target because it is the simplest single-account fetch that validates the entire pipeline (IDL parse, Buffer polyfill, RPC connection, account deserialization).
- IDL sync script exits 0 when `target/idl/` doesn't exist, printing a warning instead of failing. This allows frontend developers to run `npm run dev` without needing a full Anchor build (they would just lack Anchor program access).

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None -- dev server started clean, AdminConfig fetched successfully from devnet, all 3 status indicators showed OK on first attempt.

## User Setup Required

None - `.env.local` was created in `app/` with the devnet Helius RPC URL (file is gitignored by Next.js default).

## Next Phase Readiness
- Anchor browser integration validated end-to-end: IDL sync -> Program factory -> RPC fetch -> account deserialization
- All subsequent phases can import from `@/lib/anchor` to read on-chain data
- Ready for Phase 40 (wallet connection): will wrap Program factory with wallet provider for signing
- Ready for Phase 41 (protocol data): useEffect pattern established for RPC data fetching
- No blockers or concerns

---
*Phase: 39-foundation-scaffolding*
*Completed: 2026-02-15*
