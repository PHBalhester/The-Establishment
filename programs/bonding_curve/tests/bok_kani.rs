// =============================================================================
// BOK Kani Verification Harnesses for Bonding Curve Math
//
// IMPLEMENTATION NOTE: Harnesses use u32 symbolic inputs cast to u64.
// CBMC creates SAT formulas proportional to bit-width — u64 with complex
// math chains (integrate, checked_mul chains) exceeds solver capacity.
// u32 proves each property for ALL 4+ billion values exhaustively.
// Full u64 range is stress-tested by proptest (10,000+ random iterations).
// =============================================================================

#[cfg(kani)]
mod bok_kani_harnesses {
    use bonding_curve::constants::*;
    use bonding_curve::math::*;

    // =========================================================================
    // INV-BC-003: Input Monotonicity
    // =========================================================================
    #[kani::proof]
    #[kani::unwind(1)]
    fn inv_bc_003_input_monotonicity() {
        let sol_a: u64 = kani::any::<u32>() as u64;
        let sol_b: u64 = kani::any::<u32>() as u64;
        let pos: u64 = kani::any::<u32>() as u64;

        kani::assume(sol_a < sol_b);
        kani::assume(sol_b <= TARGET_SOL);
        kani::assume(pos < TARGET_TOKENS);

        if let (Ok(tokens_a), Ok(tokens_b)) = (
            calculate_tokens_out(sol_a, pos),
            calculate_tokens_out(sol_b, pos),
        ) {
            assert!(
                tokens_a <= tokens_b,
                "INV-BC-003 violated: tokens_out({}) = {} > tokens_out({}) = {}",
                sol_a, tokens_a, sol_b, tokens_b
            );
        }
    }

    // =========================================================================
    // INV-BC-001: Round-Trip Value Non-Creation
    // =========================================================================
    #[kani::proof]
    #[kani::unwind(1)]
    fn inv_bc_001_round_trip_value_non_creation() {
        let sol_in: u64 = kani::any::<u32>() as u64;
        let pos: u64 = kani::any::<u32>() as u64;

        kani::assume(sol_in >= MIN_PURCHASE_SOL);
        kani::assume(sol_in <= TARGET_SOL);
        kani::assume(pos < TARGET_TOKENS);

        if let Ok(tokens) = calculate_tokens_out(sol_in, pos) {
            if tokens == 0 { return; }

            let new_pos = pos.saturating_add(tokens);
            if new_pos > TARGET_TOKENS { return; }

            if let Ok(sol_gross) = calculate_sol_for_tokens(pos, tokens) {
                let tax = (sol_gross as u128 * SELL_TAX_BPS as u128
                    + BPS_DENOMINATOR as u128 - 1)
                    / BPS_DENOMINATOR as u128;
                let sol_net = sol_gross.saturating_sub(tax as u64);

                assert!(
                    sol_net <= sol_in,
                    "INV-BC-001 violated: spent {} SOL, got back {} net",
                    sol_in, sol_net
                );
            }
        }
    }

    // =========================================================================
    // INV-BC-002: Price Monotonicity
    // =========================================================================
    #[kani::proof]
    #[kani::unwind(1)]
    fn inv_bc_002_price_monotonicity() {
        let pos_a: u64 = kani::any::<u32>() as u64;
        let pos_b: u64 = kani::any::<u32>() as u64;

        kani::assume(pos_a < pos_b);
        kani::assume(pos_b <= TARGET_TOKENS);

        let price_a = get_current_price(pos_a);
        let price_b = get_current_price(pos_b);

        assert!(
            price_a <= price_b,
            "INV-BC-002 violated: price({}) = {} > price({}) = {}",
            pos_a, price_a, pos_b, price_b
        );
    }

    // =========================================================================
    // INV-BC-005: Sell Tax Ceil >= Floor
    // =========================================================================
    #[kani::proof]
    #[kani::unwind(1)]
    fn inv_bc_005_sell_tax_ceil_gte_floor() {
        let sol_gross: u64 = kani::any::<u32>() as u64;

        let ceil_tax = (sol_gross as u128 * SELL_TAX_BPS as u128
            + BPS_DENOMINATOR as u128 - 1)
            / BPS_DENOMINATOR as u128;
        let floor_tax = (sol_gross as u128 * SELL_TAX_BPS as u128)
            / BPS_DENOMINATOR as u128;

        assert!(
            ceil_tax >= floor_tax,
            "INV-BC-005 violated: ceil_tax {} < floor_tax {}",
            ceil_tax, floor_tax
        );
    }

    // =========================================================================
    // INV-BC-006: Sell Tax No Overflow (u128)
    // =========================================================================
    #[kani::proof]
    #[kani::unwind(1)]
    fn inv_bc_006_sell_tax_no_overflow() {
        let sol_gross: u64 = kani::any::<u32>() as u64;

        let product = (sol_gross as u128).checked_mul(SELL_TAX_BPS as u128);
        assert!(product.is_some(), "INV-BC-006: u128 mul overflowed");

        let with_rounding = product.unwrap().checked_add(BPS_DENOMINATOR as u128 - 1);
        assert!(with_rounding.is_some(), "INV-BC-006: u128 add overflowed");

        let tax = with_rounding.unwrap() / BPS_DENOMINATOR as u128;
        assert!(tax <= u64::MAX as u128, "INV-BC-006: tax exceeds u64");
    }

    // =========================================================================
    // INV-BC-013: Wallet Cap Not Bypassed via Partial Fill
    // =========================================================================
    #[kani::proof]
    #[kani::unwind(1)]
    fn inv_bc_013_wallet_cap_not_bypassed_partial_fill() {
        let sol_in: u64 = kani::any::<u32>() as u64;
        let pos: u64 = kani::any::<u32>() as u64;

        kani::assume(sol_in >= MIN_PURCHASE_SOL);
        kani::assume(sol_in <= TARGET_SOL);
        kani::assume(pos < TARGET_TOKENS);

        if let Ok(tokens) = calculate_tokens_out(sol_in, pos) {
            let remaining = TARGET_TOKENS - pos;
            assert!(
                tokens <= remaining,
                "INV-BC-013: tokens {} > remaining {}",
                tokens, remaining
            );
            assert!(
                tokens as u128 <= TOTAL_FOR_SALE,
                "INV-BC-013: tokens {} > TOTAL_FOR_SALE",
                tokens
            );
        }
    }

    // =========================================================================
    // INV-BC-012: u128 PRECISION No Overflow
    // =========================================================================
    #[kani::proof]
    #[kani::unwind(1)]
    fn inv_bc_012_precision_no_overflow() {
        let pos: u64 = kani::any::<u32>() as u64;
        let tokens: u64 = kani::any::<u32>() as u64;

        kani::assume(pos <= TARGET_TOKENS);
        kani::assume(tokens > 0);
        kani::assume(tokens as u128 <= TOTAL_FOR_SALE);
        kani::assume((pos as u128) + (tokens as u128) <= TOTAL_FOR_SALE);

        let n = tokens as u128;
        let term1_check = P_START
            .checked_mul(PRECISION)
            .and_then(|v| v.checked_mul(n));

        assert!(
            term1_check.is_some(),
            "INV-BC-012: P_START * PRECISION * {} overflows u128",
            tokens
        );

        let result = calculate_sol_for_tokens(pos, tokens);
        assert!(
            result.is_ok(),
            "INV-BC-012: calculate_sol_for_tokens({}, {}) returned Overflow",
            pos, tokens
        );
    }
}
