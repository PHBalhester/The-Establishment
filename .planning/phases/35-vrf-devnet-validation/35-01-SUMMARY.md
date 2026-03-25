---
phase: 35-vrf-devnet-validation
plan: 01
subsystem: infra
tags: [epoch-program, devnet, deployment, slots-per-epoch]

# Dependency graph
requires:
  - phase: 34
    provides: "5 programs deployed to devnet"
provides:
  - "Epoch Program with 750-slot epochs on devnet"
  - "EpochState in usable state for VRF validation"
affects: [35-02, 35-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Option B epoch jump pattern for PDA re-init: accept epoch discontinuity rather than close/re-initialize PDA"

key-files:
  created: []
  modified:
    - "programs/epoch-program/src/constants.rs"

key-decisions:
  - "Option B: Accept epoch jump instead of closing/re-initializing EpochState PDA -- PDA is program-owned and cannot be closed via CLI; epoch jump is harmless for VRF validation"
  - "750-slot epochs for devnet VRF testing (~5 min per epoch at 400ms/slot)"

patterns-established:
  - "Devnet constant overrides: change source constant + redeploy for testing parameters"

# Metrics
duration: ~25min
completed: 2026-02-11
---

# Phase 35 Plan 01: Epoch Program Redeployment Summary

**Redeployed Epoch Program with 750-slot epochs (~5 min) for rapid VRF devnet validation**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-02-11T17:55:00Z (approx)
- **Completed:** 2026-02-11T18:20:00Z (approx)
- **Tasks:** 3/3 (2 auto + 1 human-verify checkpoint)
- **Files modified:** 1
- **Deploy cost:** ~0.002 SOL (program upgrade)

## Accomplishments

- Changed `SLOTS_PER_EPOCH` from 4,500 to 750 in `programs/epoch-program/src/constants.rs`, reducing epoch duration from ~30 minutes to ~5 minutes for rapid VRF iteration
- Rebuilt Epoch Program binary with `anchor build -p epoch_program` -- clean compile
- Redeployed Epoch Program to devnet at `AH7yaWFUrWmXGDKEwr8w2EMEiH6PxaxE2vT9orjRzvod` via `solana program deploy`
- Verified EpochState PDA (`DVV9ebobxXctrsPZpuSDTj4g85Cg2VmroLLq3chLuBDU`) is readable and in usable state
- Confirmed StakePool `last_update_epoch=0` is compatible with epoch jump (no inconsistency)
- Wallet balance confirmed healthy at 79.84 SOL (well above 3 SOL minimum for VRF testing)
- Human verification checkpoint approved by user

## Task Commits

Each task was committed atomically:

1. **Task 1: Modify SLOTS_PER_EPOCH and rebuild Epoch Program** - `e696166` (feat)
2. **Task 2: Redeploy Epoch Program and verify protocol state on devnet** - No commit (deployment/verification only -- no code changes)
3. **Task 3: Human verification checkpoint** - No commit (user approved redeployment)

## Files Created/Modified

- `programs/epoch-program/src/constants.rs` - Changed `SLOTS_PER_EPOCH` from 4,500 to 750; updated doc comment to reflect ~5 min duration and note devnet testing value

## Decisions Made

- **Option B: Accept epoch jump instead of PDA re-init:** The EpochState PDA is program-owned (not System Program-owned) and cannot be closed via the Solana CLI. Rather than writing a custom close instruction, we accepted Option B from the research: the EpochState will jump to approximately epoch ~19 on the first `trigger_epoch_transition` call. This is harmless because the Epoch Program handles arbitrary epoch advancement, and the VRF validation script only needs to observe consecutive transitions from whatever the current epoch is.
- **750-slot epochs:** At 400ms/slot, this gives ~5 min per epoch. Testing 5 consecutive VRF-driven epoch transitions will take ~25 min instead of ~2.5 hours with the original 4,500-slot epochs.

## Deviations from Plan

None -- Option B (accept epoch jump) was explicitly documented in the plan as a fallback approach, and was used as expected after confirming PDA accounts cannot be closed via CLI.

## Issues Encountered

None -- the constant change, rebuild, and redeployment all completed cleanly on first attempt.

## Protocol State Summary (Post-Redeployment)

| Component | Address | Status |
|-----------|---------|--------|
| Epoch Program | `AH7yaWFUrWmXGDKEwr8w2EMEiH6PxaxE2vT9orjRzvod` | Redeployed with 750-slot epochs |
| EpochState PDA | `DVV9ebobxXctrsPZpuSDTj4g85Cg2VmroLLq3chLuBDU` | Readable, will jump to ~epoch 19 on first transition |
| StakePool | (unchanged) | Compatible (last_update_epoch=0) |
| CarnageFund | (unchanged) | Compatible (no epoch fields) |
| Wallet | `8kPzhQoUPx7LYM18f9TzskW4ZgvGyq4jMPYZikqmHMH4` | 79.84 SOL |

## Next Phase Readiness

- Epoch Program is live with 750-slot epochs, ready for Plan 02 (VRF validation script)
- EpochState will epoch-jump on first transition -- this is expected and documented
- StakePool and CarnageFund are compatible with the redeployed program
- Wallet has ample SOL for VRF oracle fees and transaction costs
- No blockers for Plan 02

---
*Phase: 35-vrf-devnet-validation*
*Completed: 2026-02-11*
