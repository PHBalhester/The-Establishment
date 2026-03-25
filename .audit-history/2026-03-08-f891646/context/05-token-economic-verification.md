---
task_id: sos-verification-05-token-economic
provides: [05-token-economic-verification]
focus_area: 05-token-economic
verification_status: NEEDS_RECHECK
previous_audit_ref: .audit-history/2026-02-22-be95eba/context/05-token-economic.md
---
<!-- CONDENSED_SUMMARY_START -->
# Token & Economic Model -- Verification Summary

## Verification Status: NEEDS_RECHECK

## Previous Conclusions Checked: 16

### Verified (Still Valid)

- **k-invariant (AMM)**: AMM math.rs and swap_sol_pool.rs MODIFIED but the k-invariant pattern is structural. Post-swap `verify_k_invariant()` is architectural.
- **Tax split 75/24/1**: Tax math.rs MODIFIED -- needs line-level recheck but the remainder-based treasury split is a structural pattern.
- **Dead stake prevents first-depositor**: Staking initialize_stake_pool MODIFIED but dead stake pattern is structural.
- **Exchange rate monotonicity**: Staking math.rs MODIFIED -- `add_to_cumulative()` only adds. Structural.
- **Transfer hook whitelist enforcement**: Transfer hook MODIFIED but whitelist check pattern is architectural.
- **Carnage swap cap (1000 SOL)**: Epoch constants.rs MODIFIED -- needs recheck but cap is a compile-time constant.
- **Output floor (50% BPS)**: Tax constants.rs MODIFIED -- needs recheck.
- **AMM reentrancy guard**: AMM pool.rs MODIFIED but locked flag pattern is structural.
- **CEI ordering in swap paths**: AMM swap handlers MODIFIED but CEI is a structural pattern.
- **TE-006 (Direct lamport manipulation in staking)**: Staking claim.rs and unstake.rs MODIFIED -- pattern persists.
- **TE-007 (Bounty rent-exempt bug)**: Still present (KNOWN).
- **TE-008 (Mainnet treasury Pubkey::default())**: Tax constants.rs MODIFIED -- needs recheck.

### Needs Recheck (Potentially Invalidated)

- **PROFIT pool swap paths (TE-002 hardcoded byte offsets for swap_profit_buy/sell)**: `swap_profit_buy.rs` and `swap_profit_sell.rs` are DELETED. The PROFIT pool swap path through Tax program no longer exists. This resolves TE-002 for those specific files. However, the pool_reader.rs byte offset pattern persists for SOL pool reads and execute_carnage. Primary auditor must verify: (a) all PROFIT pool references removed cleanly from Tax lib.rs/mod.rs, (b) AMM swap_profit_pool.rs also deleted, (c) no orphan byte offset readers for deleted paths.
- **Tax calculation and split**: `tax_math.rs` is MODIFIED. The `calculate_tax()` and `split_distribution()` functions were core to the economic model. Line-level verification needed to confirm 75/24/1 split and checked arithmetic still hold.
- **Sell tax flow (WSOL intermediary pattern)**: `swap_sol_sell.rs` is MODIFIED. The close-and-reinit WSOL pattern was complex. Must be re-audited.
- **Buy tax flow**: `swap_sol_buy.rs` is MODIFIED. Tax deduction from input, distribution to staking/carnage/treasury, and AMM CPI must be re-audited.
- **TE-001 (constraint = true placeholders)**: `swap_sol_buy.rs` and `swap_sol_sell.rs` MODIFIED. Check if placeholders were fixed.
- **TE-003 (as u64 truncation)**: `tax_math.rs` and staking `math.rs` MODIFIED. Verify pattern persists or was addressed.
- **Staking reward math**: `math.rs`, `claim.rs`, `unstake.rs`, `stake.rs`, `update_cumulative.rs` all MODIFIED. The Synthetix cumulative pattern needs full re-audit of these files.

### New Concerns from Changes

- **Bonding curve introduces new token economic flows**: The bonding curve has its own pricing model (linear P_START to P_END), sell tax (15% to escrow), refund mechanism, and graduation path. These create NEW token supply dynamics:
  - 460M tokens sold per curve at prices from 0.0000009 to 0.00000345 SOL
  - 15% sell tax during curve phase (separate from the main 15% tax via Tax Program)
  - Tax escrow distributed to carnage fund on graduation (new inflow to carnage vault)
  - Failed curves allow refunds (token burn + SOL return)
  - **This needs full primary audit as a new economic surface.**

- **Conversion vault creates new token routing**: 1:100 PROFIT<->CRIME/FRAUD conversion. This is a fixed-rate exchange that bypasses the AMM entirely. Economic implications:
  - Creates an arbitrage path between conversion vault rate (1:100) and AMM PROFIT pool rate
  - Wait -- PROFIT pool swaps are DELETED. So the conversion vault may be the REPLACEMENT for PROFIT pools.
  - If so, the fixed conversion rate removes price discovery for PROFIT. This is a design decision, not a vulnerability.
  - **Needs primary auditor to confirm this is intentional and that no AMM PROFIT pool reference remains.**

- **Bonding curve Pubkey::from_str().unwrap()**: Same pattern as previous TE concern in Tax constants. `bonding_curve/constants.rs` has `Pubkey::from_str("...").unwrap()` for crime_mint, fraud_mint, epoch_program_id. Mainnet placeholders are `Pubkey::default()`.

- **New token supply flow**: Bonding curve's `fund_curve` transfers tokens FROM an admin/funder TO the curve vault. `purchase` transfers tokens FROM vault TO user. `sell` transfers FROM user TO vault. `claim_refund` BURNS user tokens. These are new mint/burn/transfer paths that affect total token supply accounting.

## Cross-Focus Handoffs
- -> **03-state-machine**: Bonding curve CurveStatus lifecycle (Pending->Active->Graduated/Failed) is a new state machine needing full audit.
- -> **04-cpi-external**: Verify bonding curve's Transfer Hook integration (remaining_accounts forwarding) follows the same validated pattern.
- -> **06-oracle-data**: Bonding curve uses no oracle/VRF. Conversion vault uses no oracle. Clean.
- -> **07-upgrade-admin**: Bonding curve has an `admin` signer in initialize_curve. Verify admin capability scope.

## Summary
The token and economic model needs RECHECK because multiple core files are MODIFIED (tax_math.rs, swap_sol_buy.rs, swap_sol_sell.rs, all staking instructions). While the architectural patterns (k-invariant, CEI, dead stake, cumulative rewards) are structural and likely persist, line-level changes to financial math and tax flows require full re-audit. Additionally, the bonding curve and conversion vault introduce entirely new economic flows (bonding curve pricing, 15% sell tax, refund mechanism, fixed-rate PROFIT conversion) that need primary auditor coverage. The PROFIT pool deletion is a significant economic model change.
<!-- CONDENSED_SUMMARY_END -->
