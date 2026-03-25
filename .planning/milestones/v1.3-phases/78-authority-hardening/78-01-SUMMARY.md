---
phase: 78-authority-hardening
plan: 01
subsystem: bonding-curve
tags: [anchor, admin-pda, access-control, solana, bonding-curve]

# Dependency graph
requires: []
provides:
  - "BcAdminConfig PDA for bonding curve admin authority"
  - "initialize_bc_admin and burn_bc_admin instructions"
  - "All 6 admin instructions gated behind BcAdminConfig has_one"
  - "AUTH-01 requirement satisfied"
affects: [deploy-scripts, integration-tests, initialize.ts]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "BcAdminConfig PDA with has_one authority constraint"
    - "ProgramData upgrade authority verification for admin PDA initialization"
    - "Irreversible admin burn via close(admin_config → authority)"

key-files:
  created:
    - programs/bonding_curve/src/instructions/initialize_bc_admin.rs
    - programs/bonding_curve/src/instructions/burn_bc_admin.rs
  modified:
    - programs/bonding_curve/src/state.rs
    - programs/bonding_curve/src/constants.rs
    - programs/bonding_curve/src/error.rs
    - programs/bonding_curve/src/instructions/mod.rs
    - programs/bonding_curve/src/lib.rs
    - programs/bonding_curve/src/instructions/initialize_curve.rs
    - programs/bonding_curve/src/instructions/fund_curve.rs
    - programs/bonding_curve/src/instructions/start_curve.rs
    - programs/bonding_curve/src/instructions/prepare_transition.rs
    - programs/bonding_curve/src/instructions/withdraw_graduated_sol.rs
    - programs/bonding_curve/src/instructions/close_token_vault.rs
---

## Self-Check: PASSED

### What was built
- `BcAdminConfig` PDA struct storing authority pubkey and bump
- `initialize_bc_admin` instruction: only callable by ProgramData upgrade authority, creates the admin PDA
- `burn_bc_admin` instruction: irreversibly closes the admin PDA, permanently removing admin control
- All 6 admin instructions (`initialize_curve`, `fund_curve`, `start_curve`, `prepare_transition`, `withdraw_graduated_sol`, `close_token_vault`) now require `admin_config` account with `has_one = authority`

### Verification
- `cargo check --features localnet` ✓
- `cargo check --features devnet` ✓
- `cargo test` 51/53 pass (2 pre-existing proptest regressions)

### Commits
- `9396def` feat(78-01): add BcAdminConfig PDA with initialize and burn instructions
- `fa68e93` feat(78-01): gate all 6 admin instructions behind BcAdminConfig PDA

### Deviations
- Plan specified 4 admin instructions but code has 6 (`fund_curve` and `start_curve` also existed). All 6 were gated for completeness.
