---
task_id: sos-verification-07-upgrade-admin
provides: [07-upgrade-admin-verification]
focus_area: 07-upgrade-admin
verification_status: NEEDS_RECHECK
previous_audit_ref: .audit-history/2026-02-22-be95eba/context/07-upgrade-admin.md
---
<!-- CONDENSED_SUMMARY_START -->
# Upgrade & Admin -- Verification Summary

## Verification Status: NEEDS_RECHECK

## Previous Conclusions Checked: 12

### Verified (Still Valid)

- **INV-UA-01 (burn_admin irreversible)**: AMM admin.rs not in modified file list. Burn mechanism unchanged.
- **INV-UA-02 (burn_authority irreversible)**: Transfer hook authority burn unchanged.
- **INV-UA-03 (No pool parameter modification after init)**: No new instruction to modify PoolState.lp_fee_bps. AMM modified but structurally no update_fee added.
- **INV-UA-04 (No pool vault drain path)**: No close constraints added. No withdraw instruction.
- **INV-UA-05 (Tax distribution ratios compile-time)**: Tax constants.rs MODIFIED -- needs line-level recheck but ratios are compile-time constants.
- **INV-UA-06 (force_carnage devnet-only)**: Feature gate is structural. Epoch lib.rs MODIFIED but cfg gate is structural.
- **INV-UA-07 (All init instructions one-time)**: Existing programs unchanged in init protection. New programs need separate init audit.
- **INV-UA-08 (Cross-program IDs consistent)**: Constants files MODIFIED across programs. Needs line-level recheck for ID consistency but structural property holds.
- **INV-UA-09 (No realloc/close/set_authority)**: No such instructions added to existing programs.
- **UA-001 (Mainnet treasury Pubkey::default())**: Tax constants.rs MODIFIED -- needs recheck if placeholder addressed.
- **UA-002 (force_carnage devnet backdoor)**: Still present and feature-gated.
- **UA-003 (No emergency pause)**: Still absent across all programs. New programs also have no pause.
- **UA-004 (No admin key rotation)**: AMM admin unchanged.
- **UA-005 (Upgrade authority strategy unaddressed)**: Now applies to 7 programs instead of 5.

### Needs Recheck (Potentially Invalidated)

- **Admin Capability Map expanded**: Two new programs (bonding curve, conversion vault) have their own admin/authority patterns that need full audit:
  - **Bonding curve `initialize_curve`**: Has an `admin` signer. The admin's powers need mapping -- can they initialize curves, set parameters, withdraw funds?
  - **Bonding curve `prepare_transition`** and **`withdraw_graduated_sol`**: Likely admin-gated instructions for graduation process. Need capability audit.
  - **Conversion vault `initialize`**: Has initialization authority. Need to verify one-time protection and authority scope.
  - These are entirely NEW admin surfaces not covered by audit #1.

- **UA-005 (Upgrade authority strategy)**: Now covers 7 programs (AMM, Tax, Epoch, Hook, Staking, BondingCurve, ConversionVault). The mainnet deployment strategy must include upgrade authority decisions for the two new programs.

- **Cross-program ID references expanded**: Bonding curve constants.rs has `epoch_program_id()` (feature-gated). This is a new cross-program reference that must be consistent with epoch program's declare_id!. Primary auditor needs to verify the devnet value matches.

- **Mainnet placeholder pattern propagated**: Bonding curve constants.rs introduces `Pubkey::default()` for mainnet epoch_program_id, crime_mint, and fraud_mint. Same pattern as UA-001 (Tax treasury). These are new mainnet-blocking items.

### New Concerns from Changes

- **Bonding curve admin scope unknown**: The bonding curve program has admin-gated instructions (initialize_curve, potentially others). Previous audit only covered AMM admin and Transfer Hook authority. The bonding curve admin's maximum damage potential needs assessment: Can they drain SOL vaults? Manipulate curve state? The `withdraw_graduated_sol` instruction name suggests admin can withdraw SOL after graduation -- this needs careful review of access controls and timing guards.
- **Conversion vault authority scope unknown**: The conversion vault's VaultConfig likely has an authority. Need to verify: Can the authority drain vault token accounts? Is there a burn mechanism?
- **New Pubkey::from_str().unwrap() instances**: Bonding curve constants.rs uses `Pubkey::from_str("...").unwrap()` for devnet mints and epoch_program_id. Same fragile pattern as Tax Program (M-02 from audit #1). Six new instances.
- **7 programs = larger key management surface**: Mainnet deployment now requires upgrade authority strategy for 7 programs, not 5. The operational security assessment needs expansion.

## Cross-Focus Handoffs
- -> **01-access-control (primary auditor)**: Bonding curve admin capabilities need full access control audit. Who can call initialize_curve, prepare_transition, withdraw_graduated_sol, mark_failed?
- -> **05-token-economic**: Bonding curve's withdraw_graduated_sol extracts SOL from graduated curves. Verify this is properly time-gated and only available after graduation.
- -> **03-state-machine**: Bonding curve CurveStatus transitions need audit for re-init protection and state manipulation resistance.

## Summary
The upgrade and admin conclusions from audit #1 are partially valid -- the existing 5 programs' admin patterns (AMM admin, Transfer Hook authority, CPI-gated autonomous programs) remain structurally sound. However, two new programs introduce admin/authority surfaces that were not covered. The bonding curve has admin-gated instructions including SOL withdrawal capability that needs full audit. The mainnet placeholder pattern (Pubkey::default()) has propagated to the bonding curve. The upgrade authority strategy now covers 7 programs. NEEDS_RECHECK for the expanded admin surface.
<!-- CONDENSED_SUMMARY_END -->
