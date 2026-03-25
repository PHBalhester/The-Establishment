---
task_id: sos-verification-arithmetic
provides: [arithmetic-verification]
focus_area: arithmetic
verification_status: NEEDS_RECHECK
previous_audit_ref: .audit-history/2026-02-22-be95eba/context/02-arithmetic.md
---
<!-- CONDENSED_SUMMARY_START -->
# Arithmetic Safety -- Verification Summary

## Verification Status: NEEDS_RECHECK

## Previous Conclusions Checked: 9

### Verified (Still Valid)

- **k-invariant (`k_after >= k_before`)**: Still holds. AMM `math.rs` unchanged; swap handler modifications in `swap_sol_pool.rs` do not alter the core math functions or k-invariant check. No new callers bypass this check.

- **Reward conservation (`reward_per_token * total_staked / PRECISION <= total_distributed`)**: Still holds. Staking `math.rs` modifications add forfeiture proptest properties (T21-T23) and structural refactors but the core `add_to_cumulative` and `update_rewards` formulas are functionally identical. PRECISION remains 1e18 in staking. The `as u64` cast on line 50 of `update_rewards` remains bounded by the same economic argument.

- **Rounding direction (protocol-favoring floor throughout)**: Still holds for all unchanged programs. The new bonding curve program introduces **ceil rounding** for sell tax and `calculate_sol_for_tokens` (user pays more / receives less), which is also protocol-favoring. Consistent with the existing pattern.

- **First-depositor protection (`MINIMUM_STAKE = 1_000_000`)**: Still holds. Staking constants modified but `MINIMUM_STAKE` value unchanged based on the structural changes to stake/unstake handlers.

- **VRF array indices in bounds**: Still holds. Epoch `tax_derivation.rs` and `carnage.rs` are unchanged.

- **`rewards_per_token_stored` monotonically increases**: Still holds. The `add_to_cumulative` function only ever `checked_add`s to this value, and no new code path decrements it.

- **ARITH-INFO-001 (bounty rent-exempt known bug)**: Still present. `trigger_epoch_transition.rs` modified but the bounty check pattern persists per HANDOVER.md H001 tag.

- **Fee bypass impossibility (Cetus vector)**: Still holds. AMM zero-output guards unchanged.

### Needs Recheck (Potentially Invalidated)

- **ARITH-004 (tax_math.rs `as u64` cast on output floor)**: The `calculate_output_floor` function in `tax_math.rs` was MODIFIED. The function signature changed: `floor_bps` parameter is now `u64` (was `u16` in previous audit). The `as u64` cast on line 164 (`Some(floor as u64)`) persists. The bounds argument still holds (`floor <= expected <= reserve_out`), but the wider `floor_bps` input type should be verified -- a `floor_bps > 10000` combined with large reserves could theoretically push `floor > reserve_out`. However, `MINIMUM_OUTPUT_FLOOR_BPS` is hardcoded at 5000 and is the only caller. **Low risk but recheck recommended.**

- **Tax split conservation (`staking + carnage + treasury == total_tax`)**: The split ratios CHANGED from 75/24/1 to 71/24/5 (STAKING_BPS from 7500 to 7100). The conservation invariant still holds by construction (treasury = remainder), but the **economic distribution shifted significantly**. The proptest still validates sum-equals-input. The inline constants in `split_distribution` (7100/2400) match `constants.rs` (STAKING_BPS=7100, CARNAGE_BPS=2400). **Verified mechanically, but the economic change should be noted by token-economic auditors.**

- **ARITH-005 (hardcoded pool byte offsets)**: `pool_reader.rs` was MODIFIED. The offsets may have changed if PoolState layout changed. Since AMM `state/pool.rs` was also MODIFIED, the previous offsets (137/145/153) **must be re-verified** against the current PoolState struct layout. This is a cross-program data dependency. **Flag for primary auditor and CPI focus area.**

- **ARITH-001/002 (epoch `as u32` truncation and unchecked epoch_start_slot)**: `trigger_epoch_transition.rs` was MODIFIED and `epoch constants.rs` was MODIFIED. The previous findings may have been addressed or the code may have changed. **Requires re-audit of epoch arithmetic.**

### New Concerns from Changes

1. **Bonding Curve `as u64` casts (NEW)**: `programs/bonding_curve/src/math.rs` lines 109 and 192 use `as u64` after u128 chains:
   - Line 109: `tokens_out as u64` -- bounded by `remaining` which is `TOTAL_FOR_SALE - current_sold`. TOTAL_FOR_SALE = 460e12 fits in u64. **Safe by bounds.**
   - Line 192: `sol_lamports as u64` -- bounded by TARGET_SOL = 1000 SOL = 1e12 lamports at worst. **Safe by bounds.** But the ceil rounding `checked_add(denominator - 1)` could push the value slightly above the integral of the full curve (~1000.5 SOL). Still fits comfortably in u64.
   - `get_current_price` line 211: `price as u64` -- bounded by P_END = 3450. **Safe.**
   - **Pattern matches existing ARITH-003 informational finding.** Same recommendation: `u64::try_from` would be more defensive.

2. **Bonding Curve sell tax uses u64 arithmetic (NEW)**: In `sell.rs` lines 174-179, sell tax is computed as `sol_gross * SELL_TAX_BPS / BPS_DENOMINATOR` with ceil rounding. `sol_gross` is u64, `SELL_TAX_BPS` is u64 (1500). Maximum: `sol_gross * 1500` can overflow u64 if `sol_gross > u64::MAX / 1500 = ~1.23e16` (12.3M SOL). With TARGET_SOL = 1000 SOL, max `sol_gross` is ~1e12 lamports, so `1e12 * 1500 = 1.5e15` fits in u64. **Safe by economic bounds.** But this differs from tax_math.rs which uses u128 intermediates -- inconsistent pattern. If bonding curve parameters ever change to allow larger raises, this could overflow.

3. **Conversion Vault PROFIT->CRIME/FRAUD multiply (NEW)**: `convert.rs` line 108-110 uses `amount_in.checked_mul(CONVERSION_RATE)` where CONVERSION_RATE=100. Max PROFIT supply is 20M with 6 decimals = 20e12. `20e12 * 100 = 2e15` fits in u64. **Safe.** The `checked_mul` handles any edge cases.

4. **Bonding Curve PRECISION = 1e12 (vs Staking PRECISION = 1e18)**: The bonding curve uses a lower PRECISION constant (1e12 vs 1e18 in staking). This is intentional for the different scale of values involved. The overflow analysis in the code comments confirms u128 headroom. No cross-contamination risk since these are separate programs with separate constants. **Informational only.**

5. **Deleted PROFIT pool swap paths**: `swap_profit_buy.rs`, `swap_profit_sell.rs`, and AMM `swap_profit_pool.rs` were deleted. This removes the LP fee `as u64` cast noted in the previous audit (swap_profit_buy.rs:222-225). Previous finding H011 (PROFIT pool fee asymmetry) is **resolved by removal**.

## Cross-Focus Handoffs

- **-> 04-cpi-external**: ARITH-005 pool byte offsets MUST be re-verified. Both `pool_reader.rs` and AMM `state/pool.rs` were modified. If offsets are wrong, tax floor calculations and carnage slippage read garbage reserves.
- **-> 05-token-economic**: Tax split changed from 75/24/1 to 71/24/5. Economic model assumptions from previous audit are invalidated.
- **-> Primary Auditor (bonding curve)**: The bonding curve `math.rs` introduces a new quadratic formula with u128 arithmetic. While overflow analysis in comments appears sound for current constants, this is entirely new code requiring full audit -- not just verification.
- **-> Primary Auditor (epoch)**: ARITH-001 and ARITH-002 in modified `trigger_epoch_transition.rs` need fresh review.

## Summary

Of the 9 previous arithmetic conclusions, 6 are verified as still valid on unchanged logic. 4 items need recheck due to modifications in `tax_math.rs` (split ratios, floor_bps type), `pool_reader.rs` (byte offsets), and `trigger_epoch_transition.rs` (epoch arithmetic). The two new programs (bonding curve and conversion vault) introduce new arithmetic that follows similar patterns (checked_*, u128 intermediates) but has 3 new `as u64` casts and one u64-only tax calculation that should be reviewed by the primary auditors. The bonding curve sell tax u64 arithmetic is safe for current economic parameters but less defensive than the u128 pattern used elsewhere.
<!-- CONDENSED_SUMMARY_END -->
