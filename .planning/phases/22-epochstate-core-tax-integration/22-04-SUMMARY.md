# Phase 22 Plan 04: swap_sol_sell EpochState Integration Summary

## One-liner
Dynamic sell tax rates from EpochState with owner validation and test mocks.

## What Was Built

### Task 1: Update swap_sol_sell to Read EpochState
**Commit:** 7d9cc12

Modified `programs/tax-program/src/instructions/swap_sol_sell.rs`:
- Added imports: `AccountDeserialize`, `epoch_program_id`, `EpochState`
- Added `epoch_state: AccountInfo` to `SwapSolSell` accounts struct (after user, before swap_authority)
- Replaced hardcoded 1400 bps with dynamic `epoch_state.get_tax_bps(is_crime, false)`
- Added owner check: EpochState must be owned by Epoch Program
- Added deserialization with discriminator validation via `try_deserialize`
- Added initialized flag check (defense-in-depth)
- Updated event emission to use `epoch_state.current_epoch`

**Security Pattern:**
```rust
// Owner check prevents fake 0% tax attacks
let epoch_program = epoch_program_id();
require!(ctx.accounts.epoch_state.owner == &epoch_program, TaxError::InvalidEpochState);

// Deserialize validates discriminator
let epoch_state = {
    let data = ctx.accounts.epoch_state.try_borrow_data()?;
    let mut data_slice: &[u8] = &data;
    EpochState::try_deserialize(&mut data_slice)
        .map_err(|_| error!(TaxError::InvalidEpochState))?
};

// Defense-in-depth
require!(epoch_state.initialized, TaxError::InvalidEpochState);

// Dynamic tax rate (is_buy = false for sell)
let tax_bps = epoch_state.get_tax_bps(is_crime, false);
```

### Task 2: Update swap_sol_sell Tests with Mock EpochState
**Commit:** f9e0e51

Modified `programs/tax-program/tests/test_swap_sol_sell.rs`:
- Added `epoch_program_id()` function matching Tax Program constants
- Added `create_mock_epoch_state()` helper with correct discriminator
- Added `epoch_state: Pubkey` to `SellTestContext`
- Updated `setup()` to create mock EpochState account owned by epoch_program_id
- Updated `build_swap_sol_sell_ix()` to include epoch_state account
- Updated `send_sell_swap()` to pass epoch_state
- Added `test_swap_sol_sell_fails_with_invalid_epoch_state` security test

**Mock EpochState Helper:**
```rust
fn create_mock_epoch_state(
    crime_buy_bps: u16,
    crime_sell_bps: u16,
    fraud_buy_bps: u16,
    fraud_sell_bps: u16,
) -> Vec<u8> {
    // Discriminator: sha256("account:EpochState")[0..8]
    let discriminator: [u8; 8] = [191, 63, 139, 237, 144, 12, 223, 210];
    // ... 100-byte serialized data matching EpochState layout
}
```

## Test Results

All 6 swap_sol_sell tests pass:
- `test_sell_crime_with_tax` - CRIME sell with 14% tax
- `test_sell_fraud_with_tax` - FRAUD sell with 14% tax
- `test_sell_slippage_after_tax` - Slippage checked on NET output
- `test_sell_slippage_passes` - 1% slippage buffer works
- `test_consecutive_sells_succeed` - Multiple sells work
- `test_swap_sol_sell_fails_with_invalid_epoch_state` - Security test

Full tax-program test suite: 61 tests pass (27 unit + 34 integration).

## Files Modified

| File | Changes |
|------|---------|
| `programs/tax-program/src/instructions/swap_sol_sell.rs` | +44/-17: EpochState integration |
| `programs/tax-program/tests/test_swap_sol_sell.rs` | +222/-1: Mock EpochState helper and tests |

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 7d9cc12 | feat | Add EpochState reading to swap_sol_sell |
| f9e0e51 | test | Add mock EpochState to swap_sol_sell tests |

## Verification

```bash
# Build passes
cargo build -p tax-program

# All tests pass
cargo test -p tax-program --test test_swap_sol_sell
# 6 passed

# Full suite
cargo test -p tax-program
# 61 passed
```

## Deviations from Plan

None - plan executed exactly as written.

## Pattern Established

Both swap_sol_buy (22-03) and swap_sol_sell (22-04) now share identical patterns:
1. EpochState account position: after user, before swap_authority
2. Owner check against epoch_program_id()
3. try_deserialize with InvalidEpochState on failure
4. initialized flag validation
5. get_tax_bps(is_crime, is_buy) for rate lookup
6. event emission uses epoch_state.current_epoch

Mock EpochState discriminator: `[191, 63, 139, 237, 144, 12, 223, 210]`
(sha256("account:EpochState")[0..8])

## Duration

~5 minutes

## Next Phase Readiness

Plan 22-04 complete. Wave 2 is now complete. Ready to plan Phase 23 (VRF Integration).
