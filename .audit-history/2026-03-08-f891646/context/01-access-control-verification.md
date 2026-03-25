---
task_id: sos-verification-access-control
provides: [access-control-verification]
focus_area: access-control
verification_status: CONCERNS_FOUND
previous_audit_ref: .audit-history/2026-02-22-be95eba/context/01-access-control.md
---
<!-- CONDENSED_SUMMARY_START -->
# Access Control & Account Validation -- Verification Summary

## Verification Status: CONCERNS_FOUND

## Previous Conclusions Checked: 10

### Verified (Still Valid)

- **INV-AC-01** (Only Tax Program can execute AMM swaps): Still holds. No new programs gain swap_authority PDA signing capability. Bonding curve and conversion vault do NOT CPI into the AMM.
- **INV-AC-02** (Only Epoch Program can call Tax::swap_exempt): Still holds. New programs do not derive or use carnage_signer PDA.
- **INV-AC-03** (Only Tax Program can call Staking::deposit_rewards): Still holds. tax_authority PDA chain unchanged.
- **INV-AC-04** (Only Epoch Program can call Staking::update_cumulative): Still holds. staking_authority PDA chain unchanged.
- **INV-AC-05** (Initialization PDAs can only be created once): Still holds for all 5 original programs. Anchor `init` constraint unchanged.
- **INV-AC-06** (Admin burn is irreversible): Still holds. AMM admin model unchanged.
- **INV-AC-07** (Whitelist authority burn is irreversible): Still holds. Transfer hook authority model unchanged.
- **INV-AC-08** (Pool vaults match pool state): Still holds. AMM pool validation unchanged.
- **INV-AC-09** (Token program matches mint owner): Still holds.
- **PDA Chain Verification (all 4 chains)**: All seeds and program IDs remain byte-identical across programs. Tax constants.rs was MODIFIED but cross-program seeds/IDs unchanged (verified by reading current file).

### Needs Recheck (Potentially Invalidated)

- **AC-001 (Initialization front-running)**: The bonding curve's `initialize_curve` and `start_curve` accept ANY `Signer<'info>` as authority without upgrade-authority verification -- **same vulnerability pattern as the 3 programs flagged in AC-001**. The conversion vault's `Initialize` also accepts any payer (comment: "Any signer can initialize -- one-shot, no stored authority"). Both new programs extend the AC-001 attack surface from 3 programs to 5 programs.
- **AC-005 (Mainnet placeholders)**: Bonding curve `constants.rs` has `Pubkey::default()` for `crime_mint()`, `fraud_mint()`, and `epoch_program_id()` in mainnet builds. Conversion vault has `Pubkey::default()` for `crime_mint()`, `fraud_mint()`, `profit_mint()` in mainnet builds. This extends AC-005 from 2 placeholders (tax program) to 8+ across 3 programs.
- **AC-002 (`constraint = true` placeholders)**: Tax program's `swap_sol_buy.rs` and `swap_sol_sell.rs` are MODIFIED -- these must be rechecked by primary auditors to see if `constraint = true` patterns persist or were addressed.

### New Concerns from Changes

- **NC-01: Bonding curve `prepare_transition` and `withdraw_graduated_sol` have no authority binding.** Both accept any `Signer<'info>` as `authority`. There is NO stored authority field in CurveState and NO upgrade-authority check. For `prepare_transition`, any signer can graduate both curves once they are Filled. For `withdraw_graduated_sol`, any signer can withdraw ~1000 SOL from each graduated curve's SOL vault to their own wallet. The SOL is sent directly to `authority` (line 81: `**ctx.accounts.authority.try_borrow_mut_lamports()? += withdrawable`). **This is HIGH severity if unmitigated -- anyone can steal the graduated SOL.** Primary auditors MUST verify whether an off-chain guard (e.g., deploying with upgrade authority checks or using a timelock) protects this.

- **NC-02: Bonding curve `distribute_tax_escrow` sends lamports to epoch program's carnage_sol_vault.** This is a new inflow path to an existing program's PDA. The carnage_sol_vault's balance directly affects epoch/carnage economics. The bonding curve validates the destination via `Pubkey::find_program_address(&[CARNAGE_SOL_VAULT_SEED], &epoch_program_id())` which is correct, but the `CARNAGE_SOL_VAULT_SEED` in bonding_curve/constants.rs (`b"carnage_sol_vault"`) must match epoch-program's seed exactly -- needs cross-program seed verification by primary auditors.

- **NC-03: Conversion vault token transfers trigger transfer hooks.** The vault uses `transfer_t22_checked` with remaining_accounts for hook resolution. This means CRIME/FRAUD transfers through the vault will hit the existing transfer hook whitelist. The vault's token accounts must be whitelisted, creating a new dependency on the transfer hook's whitelist authority (which may already be burned per AC-001/INV-AC-07). If the whitelist authority was burned before the vault accounts were whitelisted, conversions will permanently fail.

- **NC-04: Deleted files (swap_profit_pool.rs, swap_profit_buy.rs, swap_profit_sell.rs) removed PROFIT pool swap paths.** Previous audit noted INV-AC-01 covered Tax->AMM swap authority for these paths. The deletion reduces attack surface (positive), but the conversion vault now handles PROFIT token movement. Primary auditors should verify no orphaned AMM pool state or permissions remain.

## Cross-Focus Handoffs

- **-> 02-arithmetic**: Bonding curve math (linear interpolation in `math.rs`) and conversion vault's integer division (100:1 ratio, remainder lost) need overflow/precision analysis.
- **-> 03-state-machine**: Bonding curve has a 5-state machine (Initialized->Active->Filled->Graduated, or Active->Failed). State transitions in `prepare_transition` and `mark_failed` need verification.
- **-> 05-token-extensions**: Conversion vault's `hook_helper::transfer_t22_checked` with remaining_accounts splitting needs validation against dual-hook ordering rules.

## Summary

The 4 core PDA authority chains (swap_authority, carnage_signer, tax_authority, staking_authority) remain intact and verified. No new programs gain CPI authority over existing programs' gated instructions. However, the bonding curve program introduces **significant new access control concerns**: `withdraw_graduated_sol` allows any signer to withdraw ~1000 SOL from graduated curves (NC-01, potential HIGH), and `initialize_curve`/`start_curve`/`prepare_transition` all lack upgrade-authority verification (extending AC-001). The conversion vault's dependency on transfer hook whitelisting (NC-03) creates a new cross-program trust assumption that may conflict with the whitelist authority burn pattern.
<!-- CONDENSED_SUMMARY_END -->
