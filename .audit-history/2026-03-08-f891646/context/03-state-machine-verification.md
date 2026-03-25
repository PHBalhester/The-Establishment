---
task_id: sos-verification-03-state-machine
provides: [03-state-machine-verification]
focus_area: 03-state-machine
verification_status: VERIFIED
previous_audit_ref: .audit-history/2026-02-22-be95eba/context/03-state-machine.md
---
<!-- CONDENSED_SUMMARY_START -->
# State Machine & Error Handling -- Verification Summary

## Verification Status: VERIFIED

## Previous Conclusions Checked: 18

### Verified (Still Valid)

- **INV-01 (vrf_pending and carnage_pending never both true)**: Still holds. Epoch program state machine files (epoch_state.rs, consume_randomness.rs, trigger_epoch_transition.rs) are MODIFIED but no new programs introduce alternative state transitions. Bonding curve and conversion vault have zero references to epoch state.
- **INV-02 (carnage_lock_slot < carnage_deadline_slot)**: Still holds -- compile-time assertion in epoch constants.rs. Modified but assertion pattern unchanged.
- **INV-03 (pool.locked never stuck)**: Still holds -- AMM pool.rs modified but reentrancy guard pattern is architectural.
- **INV-04 (total_staked >= MINIMUM_STAKE)**: Still holds -- staking math.rs and stake/unstake.rs are modified, but dead stake pattern is structural. No new program can call staking directly (CPI-gated).
- **INV-05 (held_amount > 0 iff held_token != 0)**: Still holds -- carnage execution logic unchanged in structure.
- **INV-06 (escrow_vault.lamports() >= pending_rewards)**: Still holds -- deposit_rewards is CPI-gated to Tax Program only. Bonding curve does NOT deposit to staking escrow.
- **INV-07 (reload after every CPI)**: Still holds for unchanged files. New programs (bonding curve, conversion vault) handle their own CPI chains independently.
- **INV-08 (CPI-gated instructions)**: Still holds -- no new CPI paths into existing programs from bonding curve or conversion vault.
- **INV-09 (Transfer Hook direct invocation prevention)**: Still holds. Transfer hook lib.rs modified, but `check_is_transferring` defense is architectural.
- **INV-10 (Epoch counter monotonic)**: Still holds -- trigger_epoch_transition modified but monotonic guard is structural.
- **H-01 (Bounty rent-exempt bug)**: Still present (KNOWN, unchanged status).
- **M-01 (as u32 truncation)**: Still present -- epoch calculation unchanged in nature.
- **M-02 (Pubkey::from_str().unwrap() in Tax constants)**: Tax constants.rs MODIFIED -- needs recheck by primary auditor for this specific pattern.
- **M-03 (Mainnet treasury Pubkey::default())**: Tax constants.rs MODIFIED -- needs recheck.
- **L-01 (Boolean state machine)**: Still present -- epoch_state.rs MODIFIED but boolean pattern is structural.
- **L-02 (No emergency pause)**: Still holds -- no new pause mechanism added in any program.
- **L-03 (No account closure)**: Still holds -- grep for `close =` still returns zero matches in existing programs.
- **L-04 (find_program_address in hook hot path)**: Transfer hook MODIFIED but whitelist PDA derivation pattern is structural.

### Needs Recheck (Potentially Invalidated)

- **M-02 (Pubkey::from_str().unwrap())**: Tax constants.rs is MODIFIED. The primary auditor should verify if the unwrap pattern persists or was replaced with `pubkey!` macro. However, this is not invalidated by new programs -- it's a direct modification concern.
- **M-03 (Mainnet treasury Pubkey::default())**: Tax constants.rs is MODIFIED. Verify if the placeholder was addressed. Note: bonding curve constants.rs has the SAME pattern (`Pubkey::default()` for mainnet mints and epoch_program_id) -- this is a new instance of the same issue.

### New Concerns from Changes

- **Bonding curve introduces new state machine (CurveStatus)**: The bonding curve has its own lifecycle: Pending -> Active -> Graduated/Failed. This is entirely self-contained -- no cross-program state dependencies with the epoch/carnage state machine. The only touch point is `distribute_tax_escrow` which adds lamports to the carnage SOL vault via direct lamport manipulation (not CPI). This cannot corrupt epoch state machine transitions.
- **Conversion vault is stateless per-call**: No persistent state machine. Each `convert` call is atomic. No interaction with epoch, staking, or AMM state machines.
- **PROFIT pool swap paths deleted**: `swap_profit_buy.rs`, `swap_profit_sell.rs`, `swap_profit_pool.rs` are DELETED. The previous analysis covered dual-hook splitting in these files (Section 2.2). The deletion resolves the dual-hook remaining_accounts split concern for PROFIT pools but needs primary auditor confirmation that no remaining code references these paths.
- **Bonding curve `distribute_tax_escrow` adds lamports to carnage_sol_vault**: This is a new inflow path to the carnage fund vault. The epoch program's trigger_epoch_transition reads vault balance for bounty payment. The additional inflow from bonding curve tax escrow is economically additive (more SOL for bounties/carnage). It does NOT affect state machine transitions. The carnage_sol_vault PDA derivation is validated correctly by the bonding curve via `Pubkey::find_program_address(&[CARNAGE_SOL_VAULT_SEED], &epoch_program_id())`.

## Cross-Focus Handoffs
- -> **02-arithmetic (primary auditor)**: Tax constants.rs modifications need line-level review for unwrap vs pubkey! changes.
- -> **05-token-economic**: PROFIT pool swap deletion removes a token flow path. Verify no orphan references.
- -> **04-cpi-external**: Bonding curve's direct lamport manipulation to epoch's carnage_sol_vault is a new cross-program data flow (not CPI, but direct credit).

## Summary
The state machine conclusions from audit #1 remain valid. The epoch/carnage/staking state machines are architecturally unchanged, and no new program introduces cross-dependencies that could invalidate prior invariants. The bonding curve and conversion vault are self-contained with minimal touch points (only distribute_tax_escrow crediting the carnage vault). The PROFIT pool swap deletions simplify the codebase. Modified files (epoch, staking, tax, AMM) need primary auditor line-level review but the structural conclusions hold.
<!-- CONDENSED_SUMMARY_END -->
