---
phase: 32-cpi-chain-validation
plan: 02
subsystem: testing
tags: [carnage, cpi-chain, depth-4, swap-exempt, epoch, compute-budget, transfer-hook, token-2022]

# Dependency graph
requires:
  - phase: 32-01
    provides: CPI chain test infrastructure, protocol-init, run-integration-tests.sh
  - phase: 31-03
    provides: Integration test framework with upgradeable program deployment
  - phase: 25-04
    provides: Epoch Program execute_carnage_atomic instruction
  - phase: 21-03
    provides: Tax Program swap_exempt instruction
provides:
  - Carnage depth-4 CPI chain validated locally (Epoch->Tax->AMM->T22->Hook)
  - CU profiling for Carnage atomic buy (105k CU, 92.5% headroom)
  - Mock VRF infrastructure for EpochState binary manipulation
  - Epoch->Staking update_cumulative authorization validated
  - swap_exempt discriminator and account list bugs fixed
affects:
  - 32-03 (access control / negative tests)
  - 35 (devnet deployment -- Carnage CU budget validated)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "EpochState binary manipulation via --account override for mock VRF"
    - "Two-phase test approach: dump state -> modify -> restart validator"
    - "Explicit Keypair for WSOL accounts owned by PDAs (bypasses ATA off-curve check)"
    - "CPI discriminator verification against IDL before hardcoding"

key-files:
  created:
    - tests/integration/carnage.test.ts
  modified:
    - programs/epoch-program/src/instructions/execute_carnage_atomic.rs
    - tests/integration/helpers/protocol-init.ts
    - scripts/run-integration-tests.sh
    - scripts/prepare-carnage-state.ts
    - tests/integration/helpers/mock-vrf.ts

key-decisions:
  - "Use explicit Keypair for Carnage WSOL account (PDA owner = off-curve, ATA rejects it)"
  - "Fund WSOL with sol_vault.lamports() not fixed amount (program reads full vault balance)"
  - "nohup+disown pattern for test validator background process (prevents shell SIGTERM propagation)"
  - "rentEpoch = 0 instead of u64::MAX (JS number precision overflow)"

patterns-established:
  - "PDA-owned WSOL accounts: use createWrappedNativeAccount with explicit keypair, not ATA"
  - "CPI discriminator verification: always check sha256 hash against IDL before hardcoding"
  - "Validator lifecycle: nohup + disown + port check + PID tracking for robust stop/start"

# Metrics
duration: 45min
completed: 2026-02-10
---

# Phase 32 Plan 02: Carnage & Epoch CPI Chain Tests Summary

**Carnage depth-4 CPI chain (Epoch->Tax->AMM->T22->Hook) validated at 105k CU with 92.5% headroom; swap_exempt discriminator and account list bugs fixed**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-02-10T22:10:00Z
- **Completed:** 2026-02-10T22:56:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Carnage depth-4 CPI chain executes end-to-end locally: 105,017 CU consumed (92.5% headroom on 1.4M limit)
- Fixed 3 bugs in execute_carnage_atomic: wrong swap_exempt discriminator, missing swap_authority account, insufficient WSOL funding
- Fixed test infrastructure: validator crash (shell SIGTERM), WSOL off-curve owner, protocol-init skipEpochStateInit
- All 12 integration tests pass: Phase 1a smoke (2), Phase 2 Carnage (3), Phase 3 CPI chains (7)
- CarnageFundState correctly updated: total_triggers=1, held_amount=500890880, held_token=CRIME

## Task Commits

1. **Task 1: Create mock VRF helper** - `fada7d6` (feat) -- committed in prior session
2. **Task 2: Carnage CPI chain tests + bug fixes** - `6087d89` (fix)

## Files Created/Modified

- `tests/integration/carnage.test.ts` - Carnage depth-4 chain test (561 lines): EpochState verification, atomic buy with CU profiling, update_cumulative auth test
- `programs/epoch-program/src/instructions/execute_carnage_atomic.rs` - Fixed swap_exempt discriminator, added swap_authority account to CPI
- `tests/integration/helpers/protocol-init.ts` - Added InitOptions with skipEpochStateInit for --account override tests
- `scripts/run-integration-tests.sh` - Fixed validator lifecycle (nohup/disown/port-check), robust stop/start
- `scripts/prepare-carnage-state.ts` - Fixed rentEpoch precision (u64::MAX -> 0)
- `tests/integration/helpers/mock-vrf.ts` - Fixed rentEpoch precision in accountToJson

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Explicit Keypair for Carnage WSOL | carnage_signer PDA is off-curve; getAssociatedTokenAddressSync rejects it with allowOwnerOffCurve=false by default |
| Fund WSOL with sol_vault.lamports() | Epoch Program reads full vault balance (including rent-exempt) as swap amount; WSOL must match exactly |
| nohup+disown for validator | eval+background caused SIGTERM propagation from shell to validator during Phase 2 restart |
| rentEpoch = 0 not u64::MAX | JS Number.MAX_SAFE_INTEGER < u64::MAX; 18446744073709551615 silently truncated to NaN/0 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Wrong swap_exempt discriminator in execute_carnage_atomic**
- **Found during:** Task 2 (Carnage test execution)
- **Issue:** Hardcoded `[0xf3, 0x5b, 0x9e, 0x48, ...]` did not match `sha256("global:swap_exempt")[0..8]`; Tax Program returned `InstructionFallbackNotFound` (error 101)
- **Fix:** Replaced with correct discriminator `[0xf4, 0x5f, 0x5a, 0x24, 0x99, 0xa0, 0x37, 0x0c]` verified against Tax Program IDL
- **Files modified:** `programs/epoch-program/src/instructions/execute_carnage_atomic.rs`
- **Verification:** CPI now reaches Tax::SwapExempt instruction
- **Committed in:** `6087d89`

**2. [Rule 2 - Missing Critical] Missing swap_authority account in CPI**
- **Found during:** Task 2 (after discriminator fix)
- **Issue:** Tax::SwapExempt requires `swap_authority` PDA as account #2, but ExecuteCarnageAtomic struct and CPI account list omitted it entirely
- **Fix:** Added `swap_authority: AccountInfo<'info>` to ExecuteCarnageAtomic struct and included it in CPI account_metas and account_infos at correct position
- **Files modified:** `programs/epoch-program/src/instructions/execute_carnage_atomic.rs`
- **Verification:** CPI now reaches AMM::SwapSolPool instruction
- **Committed in:** `6087d89`

**3. [Rule 1 - Bug] WSOL account creation fails for PDA owner**
- **Found during:** Task 2 (test execution)
- **Issue:** `createWrappedNativeAccount` with PDA owner throws `TokenOwnerOffCurveError` because default ATA path rejects off-curve keys
- **Fix:** Provide explicit Keypair parameter to bypass ATA derivation and create standalone token account instead
- **Files modified:** `tests/integration/carnage.test.ts`
- **Verification:** WSOL account created successfully with PDA as owner
- **Committed in:** `6087d89`

**4. [Rule 1 - Bug] WSOL insufficient funds for swap**
- **Found during:** Task 2 (after WSOL creation fix)
- **Issue:** WSOL funded with 0.5 SOL but Epoch Program tries to swap sol_vault.lamports() = 0.50089 SOL (includes rent-exempt minimum)
- **Fix:** Read actual sol_vault balance after funding and use that for WSOL wrapping amount
- **Files modified:** `tests/integration/carnage.test.ts`
- **Verification:** SPL Token TransferChecked succeeds with matching amounts
- **Committed in:** `6087d89`

**5. [Rule 3 - Blocking] Validator crash during Phase 2 restart**
- **Found during:** Task 2 (test execution)
- **Issue:** `eval solana-test-validator ... &` allowed shell SIGTERM to propagate to background validator process during Phase 2 restart
- **Fix:** Replaced with `nohup ... > /dev/null 2>&1 &` + `disown` + port availability check via `lsof -i :8899`
- **Files modified:** `scripts/run-integration-tests.sh`
- **Verification:** Validator survives multiple stop/start cycles across all 3 phases
- **Committed in:** `6087d89`

**6. [Rule 1 - Bug] rentEpoch precision overflow in JSON serialization**
- **Found during:** Task 2 (EpochState dump/reload)
- **Issue:** `rentEpoch: 18446744073709551615` (u64::MAX) exceeds JS `Number.MAX_SAFE_INTEGER`, causing silent precision loss in JSON.stringify
- **Fix:** Use `rentEpoch: 0` (test validator does not enforce rent on preloaded accounts)
- **Files modified:** `scripts/prepare-carnage-state.ts`, `tests/integration/helpers/mock-vrf.ts`
- **Verification:** --account override loads correctly with carnage_pending=true
- **Committed in:** `6087d89`

---

**Total deviations:** 6 auto-fixed (3 bugs, 1 missing critical, 1 blocking, 1 bug)
**Impact on plan:** All fixes were necessary for correctness. The 3 Epoch Program bugs (wrong discriminator, missing account, WSOL funding) were latent issues in code written during Phase 25 that could not be detected until full CPI chain execution. No scope creep.

## CU Profile

| Path | CU Consumed | Headroom |
|------|------------|----------|
| Carnage atomic buy (depth-4) | 105,017 | 92.5% on 1.4M |

The Carnage depth-4 chain is well within budget. Even with the default 200k CU limit, it would fit at 52.5% utilization.

## Issues Encountered

- Validator SIGTERM propagation through `eval ... &` pattern required switching to `nohup ... &` + `disown` -- this is a shell behavior difference that only manifests in multi-phase test runners where the validator is stopped and restarted
- JS Number precision silently truncates u64::MAX in JSON serialization -- no runtime error, but the loaded account has incorrect rentEpoch field

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Carnage CPI chain validated: depth-4 works within CU budget
- swap_exempt instruction confirmed working end-to-end
- Ready for Phase 32-03 (access control / negative tests)
- Full VRF flow (trigger_epoch_transition -> consume_randomness -> execute_carnage_atomic) deferred to Phase 35 (devnet)

---
*Phase: 32-cpi-chain-validation*
*Completed: 2026-02-10*
