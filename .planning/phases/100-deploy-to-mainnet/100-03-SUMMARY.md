---
phase: 100-deploy-to-mainnet
plan: 03
subsystem: infra
tags: [mainnet, launch, bonding-curve, graduation, amm, crank, solana, production]

# Dependency graph
requires:
  - phase: 100-02
    provides: 6 core programs deployed to mainnet, all PDAs initialized, ALT created
  - phase: 98-mainnet-checklist
    provides: Validated stage scripts (stages 5-6), deployment checklist
  - phase: 94.1-launch-page
    provides: Site mode proxy, 500 SOL curve target, dynamic graduation pool seeding
provides:
  - Bonding curve program deployed to mainnet (slot 408541203)
  - Both CRIME and FRAUD curves initialized, filled, and graduated
  - 2 AMM pools created (CRIME/SOL and FRAUD/SOL) with curve proceeds
  - Crank running on Railway mainnet, advancing epochs
  - Frontend switched to live trading mode
  - Helius webhooks registered (raw + enhanced) for mainnet
affects: [100-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "LAUNCH GATE in initialize.ts: manual confirmation prompt before startCurve (irreversible)"
    - "Phantom mainnet: signAndSendTransaction (not sign-then-send) for Blowfish compatibility"
    - "v0 VersionedTransaction with ALT for single-hop taxed swaps (Phantom simulation fix)"
    - "gateway.irys.xyz for metadata URIs (arweave.net unreliable)"

key-files:
  created: []
  modified:
    - scripts/deploy/initialize.ts
    - scripts/graduation/graduate.ts
    - scripts/graduation/graduation-state.json
    - deployments/mainnet.json
    - Docs/mainnet-deploy-checklist.md

key-decisions:
  - "Whitelist authority RETAINED (not burned) -- transfers to Squads at Stage 7 for future flexibility"
  - "Phantom mainnet: switched back to signAndSendTransaction for Blowfish security scanning compatibility"
  - "v0 VersionedTransaction with ALT for single-hop taxed swaps (Phantom simulation fix)"
  - "Graduation state file conflict resolved: devnet state from Phase 102 was skipping all steps"
  - "LAUNCH GATE added to initialize.ts: manual LAUNCH confirmation before startCurve"

patterns-established:
  - "Mainnet launch sequence: BC deploy -> curve init -> community fill -> graduation -> crank -> frontend live"

# Metrics
duration: ~multi-session (launch + fill period + graduation)
completed: 2026-03-25
---

# Phase 100 Plan 03: Execute Stage 5 (Launch) + Stage 6 (Graduation) Summary

**Bonding curve deployed at launch, both curves filled (CRIME 512 SOL, FRAUD 519 SOL), graduated into 2 AMM pools (~500 SOL + 290M tokens each), crank running on Railway, frontend live for trading**

## Performance

- **Duration:** Multi-session (launch, community fill period, graduation, post-graduation fixes)
- **Tasks:** 4 (1 decision gate, 2 auto, 1 human-verify)

## Accomplishments

- Deployed bonding curve program to mainnet (slot 408541203, 4.73 SOL, TX 3tb2GwPQ...)
- Ran initialize.ts Steps 17-25: BcAdminConfig, curves created, vaults whitelisted, curves funded, LAUNCH GATE confirmation, curves started
- Both curves filled by community: CRIME 512 SOL, FRAUD 519 SOL
- Graduation completed all 13 steps: AMM pools created (CRIME/SOL: 500.44 SOL + 290M tokens, FRAUD/SOL: 501.01 SOL + 290M tokens)
- Pool vaults whitelisted, tax escrows distributed to carnage
- Crank started on Railway mainnet, Carnage triggered Epoch 429
- Frontend switched to live mode (SITE_MODE=live, CURVE_PHASE removed)
- Helius webhooks updated: raw (3 programs) + enhanced (7 PDAs) on both URLs
- Phantom simulation fix: converted single-hop taxed swaps to v0 VersionedTransaction with ALT
- Switched mainnet Phantom from sign-then-send to signAndSendTransaction for Blowfish compatibility

## Task Commits

1. **Task 1: Launch timing decision** - N/A (decision checkpoint, approved)
2. **Task 2: Execute Stage 5 (deploy BC + init curves)** - executed across sessions
3. **Task 3: Curve fill verification** - N/A (human-verify checkpoint, both-filled confirmed)
4. **Task 4: Execute Stage 6 (graduation + crank + frontend)** - executed across sessions

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Graduation state file conflict**

- **Found during:** Task 4 (graduation execution)
- **Issue:** graduation-state.json contained devnet state from Phase 102, causing graduate.ts to skip all 13 steps (already-completed markers from devnet)
- **Fix:** Cleared stale graduation state to allow fresh mainnet graduation
- **Files modified:** scripts/graduation/graduation-state.json

**2. [Rule 1 - Bug] Phantom simulation failure on single-hop taxed swaps**

- **Found during:** Task 4 (post-graduation frontend testing)
- **Issue:** Phantom wallet's transaction simulation rejected legacy transactions with transfer hook remaining accounts (too many accounts for legacy TX format)
- **Fix:** Converted single-hop taxed swaps to v0 VersionedTransaction with ALT, matching the pattern already used for multi-hop swaps

**3. [Rule 1 - Bug] Phantom sign-then-send dropping transactions on mainnet**

- **Found during:** Task 4 (post-graduation frontend testing)
- **Issue:** sign-then-send pattern (signTransaction + sendRawTransaction) worked on devnet but Phantom's mainnet Blowfish security scanner requires signAndSendTransaction to display transaction previews
- **Fix:** Switched mainnet to signAndSendTransaction (Phantom sends via its own RPC with Blowfish integration)

**4. [Rule 3 - Blocking] LAUNCH GATE added to initialize.ts**

- **Found during:** Task 2 (pre-launch preparation)
- **Issue:** No manual confirmation gate before startCurve -- an accidental run of initialize.ts could start curves prematurely
- **Fix:** Added LAUNCH confirmation prompt requiring user to type "LAUNCH" before executing startCurve instructions

---

**Total deviations:** 4 auto-fixed (2 bugs, 2 blocking)
**Impact on plan:** All fixes necessary for correct mainnet operation. No scope creep.

## Decisions Made

- Whitelist authority retained (not burned) for future flexibility -- transfers to Squads at Stage 7
- LAUNCH GATE added as safety measure for irreversible curve start
- Phantom mainnet uses signAndSendTransaction (not sign-then-send) for Blowfish compatibility
- v0 VersionedTransaction with ALT for all taxed swap paths on mainnet

## Issues Encountered

- Graduation state file from Phase 102 devnet run was stale -- cleared to allow mainnet graduation
- Metadata gateway (arweave.net to gateway.irys.xyz) was already fixed in earlier session

## Next Phase Readiness

- Protocol is LIVE on mainnet with active trading
- Crank advancing epochs with VRF randomness
- Frontend displays real mainnet data
- Tax distribution working correctly
- Ready for Stage 7 (governance) after 24-48hr stability period

---
*Phase: 100-deploy-to-mainnet*
*Completed: 2026-03-25*
