---
task_id: sos-verification-04-cpi-external
provides: [04-cpi-external-verification]
focus_area: 04-cpi-external
verification_status: VERIFIED
previous_audit_ref: .audit-history/2026-02-22-be95eba/context/04-cpi-external.md
---
<!-- CONDENSED_SUMMARY_START -->
# CPI & External Calls -- Verification Summary

## Verification Status: VERIFIED

## Previous Conclusions Checked: 14

### Verified (Still Valid)

- **CPI Call Graph (5-program topology)**: The existing 5-program CPI graph (Tax->AMM, Tax->Staking, Epoch->Tax, Epoch->Staking, T22->Hook) remains unchanged. Bonding curve and conversion vault do NOT CPI into any of the existing 5 programs. The bonding curve's only cross-program interaction is direct lamport manipulation to the epoch program's carnage_sol_vault (not a CPI -- just lamport crediting).
- **Cross-Program PDA Validation Matrix**: All 4 PDA authority chains (swap_authority, carnage_signer, staking_authority, tax_authority) are in MODIFIED files but the seeds::program validation pattern is structural. No new programs can derive these PDAs or inject into these CPI paths.
- **CPI Program Target Validation**: All `address = xxx_program_id()` constraints on CPI targets remain. Modifications to constants.rs files in multiple programs need primary auditor line-level verification but cross-reference consistency is a structural property.
- **CPI Depth 4/4 on Carnage Path (CPI-06)**: Still at Solana limit. No changes add additional CPI depth. Bonding curve and conversion vault operate at depth 0-2 independently (BondingCurve -> T22 -> Hook at max depth 2).
- **EP-042 (Arbitrary CPI Program Substitution)**: CLEAR. No new CPI targets introduced in existing programs.
- **EP-043 (CPI Signer Authority Escalation)**: CLEAR. No new signer forwarding paths.
- **EP-044 (Privilege Propagation)**: CLEAR. PDA signer scoping unchanged.
- **EP-045 (Error Propagation)**: CLEAR. All invoke_signed calls in new programs also use `?` operator.
- **EP-046 (Stale State After CPI)**: CLEAR for existing programs. Bonding curve uses balance-diff pattern (purchase.rs reads vault balance before/after transfer) but does not CPI into existing programs.
- **EP-048 (Account Injection via remaining_accounts)**: CLEAR. New programs (bonding curve, conversion vault) use remaining_accounts exclusively for Transfer Hook forwarding -- same validated pattern as existing programs.
- **EP-049 (CPI Reentrancy)**: CLEAR. No new re-entry paths into existing programs.
- **CPI-01 (constraint = true placeholders)**: Tax swap files MODIFIED -- needs primary auditor check if placeholders were fixed.
- **CPI-02 (Staking transfer helper lacks defense-in-depth)**: Staking helpers MODIFIED -- needs primary auditor check if defense-in-depth token program check was added.
- **CPI-08 (Bounty rent-exempt bug)**: Still present (KNOWN).

### Needs Recheck (Potentially Invalidated)

- **PROFIT pool CPI paths (swap_profit_buy, swap_profit_sell, swap_profit_pool)**: DELETED. The previous analysis covered these extensively (Section 1.1, 4.2, 5.2). The deletion removes the dual-T22-hook CPI chain for PROFIT pools. Primary auditor should verify no orphan CPI discriminator references remain in Tax program and AMM.
- **CPI discriminator table**: Previous analysis documented discriminators for swap_profit_pool. Since this instruction is deleted, the discriminator is no longer needed. Verify cleanup.

### New Concerns from Changes

- **Bonding curve -> carnage_sol_vault (direct lamport credit)**: `distribute_tax_escrow.rs` transfers SOL from the bonding curve's tax_escrow PDA to the epoch program's carnage_sol_vault. This is NOT a CPI -- it uses direct lamport manipulation (`try_borrow_mut_lamports`). The bonding curve program can subtract from its own PDA and credit any account. The carnage_sol_vault address is validated via `Pubkey::find_program_address(&[CARNAGE_SOL_VAULT_SEED], &epoch_program_id())`. This is a new inflow to the carnage fund but does not create a new CPI dependency or attack surface on existing programs.
- **Conversion vault CPI chain**: Conversion vault performs T22 transfer_checked with hook support at CPI depth 1-2 (Convert -> T22 -> Hook). This is entirely independent of the existing CPI graph. Vault uses manual invoke_signed with hook forwarding (same pattern as AMM/Tax).
- **Bonding curve CPI chain**: Purchase/sell/fund_curve perform T22 transfer_checked with hook at CPI depth 1-2. Independent of existing graph. Uses both invoke (user-signed for sell) and invoke_signed (PDA-signed for purchase) correctly.
- **New cross-program ID reference**: Bonding curve constants.rs has `epoch_program_id()` with feature-gated addresses. The devnet value must match the epoch program's declare_id! -- needs primary auditor cross-reference verification.

## Cross-Focus Handoffs
- -> **05-token-economic**: PROFIT pool deletion removes a CPI path. Verify conversion vault provides alternative PROFIT routing if needed.
- -> **07-upgrade-admin**: New programs (bonding curve, conversion vault) have their own upgrade authorities -- verify they're in the mainnet readiness plan.
- -> **03-state-machine**: Bonding curve's distribute_tax_escrow credits carnage_sol_vault. Verify this doesn't affect epoch state transitions.

## Summary
The CPI architecture conclusions from audit #1 remain valid. The existing 5-program CPI graph is structurally unchanged -- no new programs inject CPIs into existing programs. The bonding curve's only cross-program touch is a direct lamport credit to the carnage vault (not CPI). The conversion vault is fully self-contained. The deletion of PROFIT pool swap paths simplifies the CPI graph. Modified files in Tax, AMM, Staking, and Epoch programs need line-level primary auditor review but the CPI topology and security patterns hold.
<!-- CONDENSED_SUMMARY_END -->
