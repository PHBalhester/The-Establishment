---
phase: 37-e2e-bug-fixes
plan: 03
subsystem: epoch, deploy-scripts, e2e-scripts, docs
tags: [bpf-stack, carnage-wsol, vrf-retry, spec-docs, integration-tests, mev-protection]

# Dependency graph
requires:
  - phase: 37-01
    provides: P0 security constraints
  - phase: 37-02
    provides: P1/P2 fixes + independent tax rolls + deposit_rewards escrow_vault
provides:
  - BPF stack overflow resolved for execute_carnage_atomic (MEV protection restored)
  - CarnageSigner-owned WSOL account creation in protocol init
  - VRF reveal retry reduced from 20 to 10 attempts
  - carnage-flow.ts uses proper WSOL (not user placeholder)
  - Spec docs current with 8-byte VRF allocation and independent tax rolls
  - All 5 programs build cleanly, 22/22 integration tests pass
affects: [devnet-redeployment, mainnet-readiness]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CPI passthrough accounts as AccountInfo (not deserialized) to reduce BPF stack usage"
    - "Box<Account<>> for large state accounts in instruction structs"
    - "Explicit Keypair for PDA-owned WSOL (ATA rejects off-curve owners)"
    - "Idempotent WSOL creation with persisted keypair in keypairs/"

key-files:
  created:
    - "keypairs/carnage-wsol.json (generated on first protocol init)"
  modified:
    - "programs/epoch-program/src/instructions/execute_carnage_atomic.rs"
    - "programs/epoch-program/src/instructions/execute_carnage.rs"
    - "programs/tax-program/src/instructions/swap_sol_buy.rs"
    - "programs/tax-program/src/instructions/swap_sol_sell.rs"
    - "programs/staking/src/instructions/deposit_rewards.rs"
    - "tests/integration/access-control.test.ts"
    - "scripts/deploy/initialize.ts"
    - "scripts/vrf/lib/vrf-flow.ts"
    - "scripts/e2e/lib/carnage-flow.ts"
    - "Docs/Epoch_State_Machine_Spec.md"
    - "Docs/VRF_Implementation_Reference.md"

key-decisions:
  - "Root-cause stack fix: downgrade CPI passthroughs to AccountInfo + Box state accounts (not just Box)"
  - "Passthrough accounts: pool_vault_a, pool_vault_b, mint_a, mint_b never read by Epoch -- only forwarded"
  - "deposit_rewards escrow_vault changed from SystemAccount to AccountInfo (PDA owned by Staking, not System)"
  - "VRF retry attempts: 10 (30 seconds) before timeout recovery rotation"

patterns-established:
  - "CPI passthrough = AccountInfo (saves ~165B per TokenAccount, ~82B per Mint on stack)"
  - "Box<Account<>> for state accounts >100 bytes in 20+ account structs"
  - "deposit_rewards CPI must pass escrow_vault as 3rd account meta"

# Metrics
duration: ~25min (including stack fix investigation + full rebuild + integration tests)
completed: 2026-02-13
---

# Phase 37 Plan 03: E2E Fixes + Stack Fix + Rebuild + Validation Summary

**Resolved BPF stack overflow (MEV protection restored), added Carnage WSOL creation, tuned VRF retries, updated spec docs, all 22/22 integration tests passing**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-02-13
- **Completed:** 2026-02-13
- **Tasks:** 1 auto + 1 checkpoint (approved)
- **Files modified:** 13
- **Commits:** 2 (789d414, b68026d)

## Accomplishments

### Critical: BPF Stack Overflow Fix (MEV Protection)
- Root cause: 4 CPI passthrough accounts (`pool_vault_a`, `pool_vault_b`, `mint_a`, `mint_b`) were typed as `InterfaceAccount<TokenAccount>` / `InterfaceAccount<Mint>`, wasting ~494 bytes of stack on deserialization the Epoch Program never reads
- Fix: Downgraded passthroughs to `AccountInfo` (~494 bytes saved) + Box'd `EpochState` and `CarnageFundState` (~247 bytes saved) = ~741 bytes of headroom
- Applied to both `ExecuteCarnageAtomic` and `ExecuteCarnage` structs
- Without this fix, `execute_carnage_atomic` crashes, forcing the multi-TX fallback which is MEV-sandwichable
- Carnage atomic now runs at 106,766 CU with 92.4% headroom

### E2E Infrastructure Fixes
- Added CarnageSigner-owned WSOL account creation to `initialize.ts` (idempotent, keypair persisted to `keypairs/carnage-wsol.json`)
- Reduced VRF reveal retries from 20 to 10 (30 seconds before timeout recovery, down from 60)
- Updated `carnage-flow.ts` to load proper WSOL from keypair file (removed user placeholder)

### CPI Fix: deposit_rewards escrow_vault
- Plan 37-02 added `escrow_vault` to Staking's `DepositRewards` struct, but Tax Program CPI calls only passed 2 accounts
- Fixed `swap_sol_buy.rs` and `swap_sol_sell.rs` to pass escrow_vault as 3rd account meta
- Changed `escrow_vault` type from `SystemAccount` to `AccountInfo` (PDA owned by Staking Program, not System Program)
- Updated `access-control.test.ts` to include escrow_vault in deposit_rewards test cases

### Spec Doc Updates
- `Epoch_State_Machine_Spec.md`: Updated VRF byte allocation to 8-byte scheme, independent tax rolls, shifted Carnage bytes (5/6/7)
- `VRF_Implementation_Reference.md`: Updated byte map, independent magnitude documentation

### Build & Test Validation
- All 5 programs build cleanly (`anchor build`) -- zero errors, zero stack warnings
- 22/22 integration tests pass across 4 phases (smoke, carnage, CPI chain, access control)
- Carnage depth-4 CPI chain test now passes (was failing with BPF stack overflow before fix)

## Task Commits

1. **Task 1: E2E fixes + spec updates + CPI fix + rebuild** - `789d414` (feat)
2. **Stack fix: downgrade passthroughs + Box state accounts** - `b68026d` (fix)

## Deviations from Plan

1. **deposit_rewards CPI missing escrow_vault** - Plan 37-02 added escrow_vault to DepositRewards but didn't update Tax Program's CPI calls. Auto-fixed during build verification.
2. **deposit_rewards escrow_vault type mismatch** - Initially SystemAccount, changed to AccountInfo because the PDA is owned by Staking Program.
3. **BPF stack overflow required root-cause investigation** - Plan noted Boxing as possible fix; actual root cause was unnecessary deserialization of CPI passthroughs. Both passthrough downgrade and Boxing applied.
4. **SBF build cache stale** - Had to delete `target/deploy/staking.so` to force recompilation after modifying deposit_rewards.

## Issues Encountered

- **Pre-existing epoch timing tests** (8 failures) remain from Phase 36 SLOTS_PER_EPOCH changes -- documented in STATE.md, not related to Phase 37.

## User Setup Required

None.

## Next Steps

- Redeploy all 5 programs to devnet (programs changed on-chain)
- Run E2E validation suite on devnet after redeployment
- Phase 37 complete -- v0.7 milestone ready for archival

---
*Phase: 37-e2e-bug-fixes*
*Completed: 2026-02-13*
