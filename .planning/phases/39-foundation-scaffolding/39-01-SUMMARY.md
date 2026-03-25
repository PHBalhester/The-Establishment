---
phase: 39-foundation-scaffolding
plan: 01
subsystem: ui
tags: [next.js, tailwind, turbopack, buffer-polyfill, npm-workspaces, monorepo]

# Dependency graph
requires:
  - phase: 30-38 (v0.7 Integration + Devnet)
    provides: Live devnet programs, pda-manifest.json with all program IDs and mints
provides:
  - Working Next.js 16 dev server with Turbopack
  - shared/ package with PROGRAM_IDS, MINTS, SEEDS, TOKEN_DECIMALS
  - npm workspace monorepo linking (shared -> app)
  - Buffer polyfill via instrumentation-client.ts
  - Turbopack resolveAlias for Node.js module stubs (fs/net/tls)
  - Tailwind CSS v4 with CSS-first config
affects: [40-wallet-connection, 41-swap-execution, 42-staking-ui, 43-data-layer, 44-deployment]

# Tech tracking
tech-stack:
  added: [next@16.1.6, react@19.2.3, tailwindcss@4, @tailwindcss/postcss@4, buffer@6, @coral-xyz/anchor@0.32.1 (app)]
  patterns: [instrumentation-client.ts for polyfills, turbopack resolveAlias for Node stubs, transpilePackages for workspace TS, CSS-first Tailwind v4]

key-files:
  created:
    - shared/package.json
    - shared/tsconfig.json
    - shared/constants.ts
    - shared/programs.ts
    - shared/index.ts
    - app/package.json
    - app/next.config.ts
    - app/postcss.config.mjs
    - app/tsconfig.json
    - app/instrumentation-client.ts
    - app/lib/empty.ts
    - app/app/layout.tsx
    - app/app/page.tsx
    - app/app/globals.css
  modified:
    - package.json (added workspaces)
    - .gitignore (added app/.next/, app/idl/)

key-decisions:
  - "turbopack.root set to monorepo parent to fix multiple lockfile detection"
  - "shared/ exports raw .ts files transpiled by Next.js via transpilePackages -- no build step needed"
  - "Buffer.from() in seeds works because instrumentation-client.ts runs before module evaluation"

patterns-established:
  - "Pattern: instrumentation-client.ts for browser polyfills (runs before React hydration)"
  - "Pattern: turbopack.resolveAlias with empty.ts stub for Node.js modules"
  - "Pattern: npm workspaces + transpilePackages for monorepo shared code"
  - "Pattern: Tailwind v4 CSS-first config -- @import 'tailwindcss' only, no tailwind.config.js"

# Metrics
duration: 8min
completed: 2026-02-15
---

# Phase 39 Plan 01: Foundation Scaffolding Summary

**Next.js 16 monorepo scaffold with npm workspace shared constants, Buffer polyfill via instrumentation-client.ts, Turbopack resolveAlias stubs, and Tailwind CSS v4**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-15T19:13:37Z
- **Completed:** 2026-02-15T19:21:16Z
- **Tasks:** 2
- **Files modified:** 20

## Accomplishments
- Created `shared/` package with all 5 program IDs, 3 mints, 21 PDA seeds, fee constants -- all verified against pda-manifest.json and tests/integration/helpers/constants.ts
- Scaffolded Next.js 16.1.6 app with Turbopack, React 19, Tailwind CSS v4
- Configured Buffer polyfill via instrumentation-client.ts and Node.js module stubs via resolveAlias
- Proof-of-life page imports and renders @dr-fraudsworth/shared constants in browser (HTTP 200, no errors)
- npm workspaces link shared/ -> app/ with zero-config hoisting

## Task Commits

Each task was committed atomically:

1. **Task 1: Create shared/ constants package with npm workspace configuration** - `ec62bfb` (feat)
2. **Task 2: Scaffold Next.js 16 project with Tailwind, polyfills, and shared import** - `5266ae8` (feat)

## Files Created/Modified
- `shared/package.json` - Package config for @dr-fraudsworth/shared
- `shared/tsconfig.json` - Standalone TypeScript config for shared package
- `shared/constants.ts` - PROGRAM_IDS, MINTS, SEEDS, TOKEN_DECIMALS, fee constants
- `shared/programs.ts` - DEVNET_ALT, DEVNET_RPC_URL
- `shared/index.ts` - Barrel export for all shared constants
- `package.json` - Added workspaces ["shared", "app"]
- `app/package.json` - Next.js project with Anchor, web3.js, buffer, shared dependency
- `app/next.config.ts` - Turbopack config with resolveAlias, transpilePackages, monorepo root
- `app/postcss.config.mjs` - @tailwindcss/postcss plugin for Tailwind v4
- `app/tsconfig.json` - Next.js TypeScript config with @/* path alias
- `app/instrumentation-client.ts` - Buffer polyfill before React hydration
- `app/lib/empty.ts` - Empty module stub for resolveAlias
- `app/app/layout.tsx` - Root layout with "Dr. Fraudsworth" metadata
- `app/app/page.tsx` - Proof-of-life page importing shared constants
- `app/app/globals.css` - Tailwind v4 CSS-first import
- `.gitignore` - Added app/.next/ and app/idl/

## Decisions Made
- Set `turbopack.root` to monorepo parent (`path.join(__dirname, "..")`) to fix Turbopack's multiple lockfile detection warning. This was documented in 39-RESEARCH.md Pitfall 4 as a potential issue.
- Shared package exports raw .ts files (not compiled JS). Next.js transpilePackages handles compilation. This means no build step for shared/ -- changes are picked up immediately by the dev server.
- Kept default create-next-app public/ SVGs and eslint config for now -- cleanup is a design milestone concern.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed block comment syntax in shared/constants.ts**
- **Found during:** Task 2 (dev server startup)
- **Issue:** The glob pattern `programs/*/src/constants.rs` in a JSDoc comment contained `*/` which Turbopack's SWC parser interpreted as closing the block comment, causing a parse error: "Expected ',', got 'ident'"
- **Fix:** Changed `programs/*/src` to `programs/{each}/src` in the comment
- **Files modified:** shared/constants.ts
- **Verification:** Dev server starts clean, HTTP 200
- **Committed in:** 5266ae8 (part of Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Comment-only fix, no functional change. Required for Turbopack to parse the file.

## Issues Encountered
- Turbopack detected multiple lockfiles (one at user home directory level, one at project root) and initially warned about incorrect root detection. Fixed by setting `turbopack.root` explicitly in next.config.ts.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Dev server starts clean with shared imports working
- Ready for Plan 02: IDL sync, Anchor Program factory, Drizzle schema definition
- Ready for Phase 40: Wallet connection (Privy + wallet adapter providers in layout.tsx)
- No blockers or concerns

---
*Phase: 39-foundation-scaffolding*
*Completed: 2026-02-15*
