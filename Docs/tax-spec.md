# Tax Program Specification

> Code-first documentation generated from program source.
> Last updated: 2026-03-08 (Phase 88-02)

## 1. Overview

The Tax Program implements asymmetric taxation and atomic distribution for SOL pool swaps. It sits between the user and the AMM, calculating tax based on VRF-derived rates from EpochState, distributing tax revenue to three destinations, and forwarding the remaining amount to the AMM for execution.

**Program ID:** `Eufdhhek6L1cxrYPvXAgJRVzckuzWVVBLckjNwyggViV`
**Tax distribution:** 71% staking escrow, 24% carnage fund, 5% treasury

## 2. Instructions

### 2.1 swap_sol_buy (SOL -> Token)

Executes a SOL -> CRIME/FRAUD swap with buy tax deducted from input.

**Flow:**
1. Read and validate EpochState (owner check, discriminator, initialized)
2. Get tax rate: `epoch_state.get_tax_bps(is_crime, true)`
3. Calculate tax: `tax = amount_in * tax_bps / 10_000`
4. Calculate post-tax swap amount: `sol_to_swap = amount_in - tax`
5. Enforce protocol minimum output floor (SEC-10)
6. Split tax distribution: 71% staking, 24% carnage, 5% treasury
7. Execute native SOL transfers for tax distribution
8. Build and execute AMM CPI with swap_authority PDA signing
9. Emit `TaxedSwap` event

**Tax deduction point:** INPUT (SOL is deducted before swap)

**Parameters:**
- `amount_in` -- Total SOL to spend (including tax)
- `minimum_output` -- Minimum tokens expected (slippage protection)
- `is_crime` -- true = CRIME pool, false = FRAUD pool

### 2.2 swap_sol_sell (Token -> SOL)

Executes a CRIME/FRAUD -> SOL swap with sell tax deducted from output.

**Flow:**
1. Read and validate EpochState
2. Get tax rate: `epoch_state.get_tax_bps(is_crime, false)`
3. Record user's WSOL balance before swap
4. Enforce protocol minimum output floor (SEC-10)
5. Compute gross floor for AMM minimum_amount_out (sell floor propagation)
6. Execute AMM CPI (BtoA direction)
7. Calculate gross output from balance difference
8. Calculate tax on gross output
9. Guard: reject if tax >= gross_output (InsufficientOutput)
10. Check slippage: `net_output >= minimum_output` (AFTER tax)
11. Split tax into 3 portions
12. Transfer-Close-Distribute-Reinit cycle for WSOL tax extraction
13. Emit `TaxedSwap` event

**Tax deduction point:** OUTPUT (WSOL is deducted after swap)

**Parameters:**
- `amount_in` -- Token amount to sell
- `minimum_output` -- Minimum SOL to receive AFTER tax
- `is_crime` -- true = CRIME pool, false = FRAUD pool

### 2.3 swap_exempt (Carnage Tax-Free Swap)

Bidirectional tax-exempt swap exclusively for Carnage Fund rebalancing. Called by Epoch Program during Carnage execution.

**Flow:**
1. Validate amount_in > 0
2. Validate direction (0 = AtoB buy, 1 = BtoA sell)
3. Build and execute AMM CPI with swap_authority PDA signing
4. Emit `ExemptSwap` event

**No tax.** No slippage protection (Carnage accepts market execution). Only the AMM's 1% LP fee applies.

**Security:** The `carnage_authority` is validated as a PDA derived from the Epoch Program via `seeds::program = epoch_program_id()`. Only Epoch Program can produce a valid signer with the `["carnage_signer"]` seeds.

**Parameters:**
- `amount_in` -- Amount to swap
- `direction` -- 0 = buy (SOL->Token), 1 = sell (Token->SOL)
- `is_crime` -- true = CRIME pool, false = FRAUD pool

**CPI depth constraint:** This instruction adds depth 1 to the Carnage CPI chain. The full chain is at Solana's 4-level limit: Epoch -> Tax -> AMM -> Token-2022 -> Transfer Hook.

### 2.4 initialize_wsol_intermediary

One-time admin setup. Creates a WSOL token account at the intermediary PDA, owned by swap_authority. Must be called before the first sell swap.

## 3. Sell Floor Propagation

The sell path propagates the user's minimum output through to the AMM CPI as a computed gross minimum, ensuring the AMM rejects swaps that would fail the post-tax slippage check.

### 3.1 Gross Floor Calculation

```
gross_floor = ceil(minimum_output * 10000 / (10000 - tax_bps))
```

This is the minimum amount the AMM must output so that after tax deduction, the user receives at least `minimum_output`.

### 3.2 Why Not minimum_amount_out = 0

Setting `minimum_amount_out = 0` in the AMM CPI would waste compute on swaps that will ultimately fail the post-tax slippage check. By propagating the floor, failed swaps fail early in the AMM instead of after the full swap + tax calculation.

## 4. Protocol Minimum Output Floor (SEC-10)

### 4.1 Purpose

Prevents zero-slippage sandwich attacks where bots/frontends set `minimum_output = 0`.

### 4.2 Calculation

```
output_floor = expected_output * MINIMUM_OUTPUT_FLOOR_BPS / 10_000
```

Where `expected_output` is computed from the constant-product formula using current pool reserves.

### 4.3 Floor Value

`MINIMUM_OUTPUT_FLOOR_BPS = 5000` (50% of expected output)

User's `minimum_output` must be >= this floor, or the transaction is rejected with `MinimumOutputFloorViolation`.

### 4.4 Buy vs Sell Floor Inputs

- **Buy:** Uses `sol_to_swap` (post-tax), not `amount_in`. Tax is deducted from input before the swap, so using `amount_in` would compute a higher expected output than achievable.
- **Sell:** Uses `amount_in` (token amount) as reserve_in. Checked BEFORE the CPI executes -- catches bots early.

## 5. Pool Reader: is_reversed Detection

### 5.1 Purpose

The Tax Program reads AMM pool reserves from raw bytes without importing the AMM crate, avoiding cross-crate coupling.

### 5.2 Implementation (`pool_reader.rs`)

Reads PoolState bytes at known offsets:

| Offset | Field | Size |
|--------|-------|------|
| [0..8] | Anchor discriminator | 8 bytes |
| [8] | pool_type | 1 byte |
| [9..41] | mint_a | 32 bytes (Pubkey) |
| [41..73] | mint_b | 32 bytes (Pubkey) |
| [73..105] | vault_a | 32 bytes (Pubkey) |
| [105..137] | vault_b | 32 bytes (Pubkey) |
| [137..145] | reserve_a | 8 bytes (u64) |
| [145..153] | reserve_b | 8 bytes (u64) |

### 5.3 is_reversed Detection (DEF-02)

Reads `mint_a` from bytes `[9..41]` and compares to `NATIVE_MINT` (So111...112):
- If `mint_a == NATIVE_MINT`: `reserve_a` = SOL, `reserve_b` = token (normal order)
- If `mint_a != NATIVE_MINT`: pool is reversed, `reserve_b` = SOL, `reserve_a` = token

Returns `(sol_reserve, token_reserve)` regardless of canonical ordering.

### 5.4 Ownership Verification (DEF-01)

Before reading bytes, validates `pool_info.owner == amm_program_id()`. Without this check, an attacker could pass a fake account with arbitrary reserve values, manipulating slippage floor calculations.

Error: `InvalidPoolOwner` if owner doesn't match.

## 6. EpochState Mirror Struct

### 6.1 Cross-Program Deserialization

The Tax Program contains a read-only mirror of Epoch Program's EpochState:

```rust
#[account]
#[repr(C)]
pub struct EpochState { /* same fields */ }
```

**Critical requirements:**
- Struct name must be `EpochState` (Anchor discriminator = `sha256("account:EpochState")[0..8]`)
- Field layout must match exactly (including `#[repr(C)]`)
- `reserved: [u8; 64]` padding must be included

### 6.2 Compile-Time Assertion (DEF-08)

```rust
const _: () = assert!(EpochState::DATA_LEN == 164);
```

If the epoch-program changes its layout, this assertion fails at compile time in the tax-program.

### 6.3 Tax Rate Lookup

```rust
pub fn get_tax_bps(&self, is_crime: bool, is_buy: bool) -> u16 {
    match (is_crime, is_buy) {
        (true, true) => self.crime_buy_tax_bps,
        (true, false) => self.crime_sell_tax_bps,
        (false, true) => self.fraud_buy_tax_bps,
        (false, false) => self.fraud_sell_tax_bps,
    }
}
```

### 6.4 Validation

The handler validates EpochState before use:
1. **Owner check:** `epoch_state.owner == epoch_program_id()` -- prevents fake 0% tax accounts
2. **Discriminator:** `try_deserialize` validates Anchor discriminator automatically
3. **Initialized:** `epoch_state.initialized == true`

## 7. Tax Distribution

### 7.1 Distribution Percentages

| Destination | BPS | Percentage | PDA Seeds |
|-------------|-----|------------|-----------|
| Staking escrow | 7,100 | 71% | `["escrow_vault"]` (Staking Program) |
| Carnage vault | 2,400 | 24% | `["carnage_sol_vault"]` (Epoch Program) |
| Treasury | 500 | 5% (remainder) | Hardcoded pubkey |

Treasury receives `total - staking - carnage` (absorbs rounding).

### 7.2 Micro-Tax Threshold

Below `MICRO_TAX_THRESHOLD = 4 lamports`, all tax goes to staking (avoids dust distribution across 3 destinations).

### 7.3 Staking Notification

After transferring SOL to the staking escrow, the Tax Program CPIs to `Staking::deposit_rewards` to update the `pending_rewards` counter. The SOL is already in escrow; the CPI just updates state.

## 8. WSOL Intermediary (Sell Path)

The sell path uses a protocol-owned WSOL intermediary account for atomic tax extraction:

### 8.1 Transfer-Close-Distribute-Reinit Cycle

1. **Transfer:** SPL Token transfer of tax WSOL from user to intermediary (user signs)
2. **Close:** Close intermediary to swap_authority (unwraps WSOL to native SOL)
3. **Distribute:** System transfers from swap_authority to 3 destinations
4. **Reinit:** Create new account at intermediary PDA + InitializeAccount3

### 8.2 Why Not System::transfer

Tax is deducted from WSOL swap output, not user's native SOL balance. The intermediary pattern converts WSOL to native SOL for distribution.

## 9. Transfer Hook Integration

### 9.1 remaining_accounts Forwarding

Both buy and sell instructions forward `remaining_accounts` to the AMM CPI for Transfer Hook support. The AMM passes these to Token-2022 `transfer_checked` calls.

### 9.2 HOOK_ACCOUNTS_PER_MINT = 4

Each Token-2022 transfer with Transfer Hook requires 4 extra accounts:
1. `extra_account_meta_list`
2. `whitelist_source`
3. `whitelist_destination`
4. `hook_program`

### 9.3 Manual CPI (Not Anchor SPL)

The Tax Program builds CPI instructions manually with `invoke_signed` rather than using Anchor SPL's `transfer_checked`. This is because Anchor SPL's `transfer_checked` does NOT forward `remaining_accounts` to the Token-2022 program, causing Transfer Hook failures.

## 10. Error Codes

Tax Program errors start at Anchor offset 6000:

| Code | Name | Description |
|------|------|-------------|
| 6000 | InvalidPoolType | Wrong pool type for operation |
| 6001 | TaxOverflow | Arithmetic overflow in tax calculation |
| 6002 | SlippageExceeded | Output < user's minimum_output |
| 6003 | InvalidEpochState | EpochState invalid or uninitialized |
| 6004 | InsufficientInput | Input too small for swap |
| 6005 | OutputBelowMinimum | Net output below minimum |
| 6006 | InvalidSwapAuthority | swap_authority PDA incorrect |
| 6007 | WsolProgramMismatch | Expected SPL Token for WSOL |
| 6008 | Token2022ProgramMismatch | Expected Token-2022 for CRIME/FRAUD |
| 6009 | InvalidTokenOwner | Token account owner mismatch |
| 6010 | UnauthorizedCarnageCall | Non-Carnage caller on swap_exempt |
| 6011 | InvalidStakingEscrow | Staking escrow PDA mismatch |
| 6012 | InvalidCarnageVault | Carnage vault PDA mismatch |
| 6013 | InvalidTreasury | Treasury address mismatch |
| 6014 | InvalidAmmProgram | AMM program address mismatch |
| 6015 | InvalidStakingProgram | Staking program address mismatch |
| 6016 | InsufficientOutput | Tax >= gross output (sell too small) |
| 6017 | MinimumOutputFloorViolation | minimum_output below 50% floor |
| 6018 | InvalidPoolOwner | Pool not owned by AMM program |

## 11. Constants

| Constant | Value | Description |
|----------|-------|-------------|
| SWAP_AUTHORITY_SEED | `"swap_authority"` | Signs AMM CPI |
| TAX_AUTHORITY_SEED | `"tax_authority"` | Signs Staking CPI |
| CARNAGE_SIGNER_SEED | `"carnage_signer"` | Carnage authority (Epoch Program) |
| WSOL_INTERMEDIARY_SEED | `"wsol_intermediary"` | Sell tax extraction |
| BPS_DENOMINATOR | 10,000 | Basis points denominator |
| STAKING_BPS | 7,100 | 71% to staking |
| CARNAGE_BPS | 2,400 | 24% to carnage |
| TREASURY_BPS | 500 | 5% to treasury |
| MICRO_TAX_THRESHOLD | 4 | Below this, all to staking |
| MINIMUM_OUTPUT_FLOOR_BPS | 5,000 | 50% minimum output floor |

## 12. CPI Dependencies

### 12.1 Outbound CPIs

| Target | Instruction | Purpose |
|--------|-------------|---------|
| AMM Program | `swap_sol_pool` | Execute swap |
| Staking Program | `deposit_rewards` | Notify of tax revenue |
| System Program | `transfer` | Tax distribution (buy), account creation |
| SPL Token | `transfer` (3), `close_account` (9), `InitializeAccount3` (18) | Sell WSOL flow |

### 12.2 Inbound CPIs

| Caller | Instruction | Purpose |
|--------|-------------|---------|
| Epoch Program (Carnage) | `swap_exempt` | Tax-free Carnage swaps |

## 13. PDA Reference

| PDA | Seeds | Program | Purpose |
|-----|-------|---------|---------|
| swap_authority | `["swap_authority"]` | Tax | Signs AMM CPI |
| tax_authority | `["tax_authority"]` | Tax | Signs Staking CPI |
| wsol_intermediary | `["wsol_intermediary"]` | Tax | Sell tax extraction |
| staking_escrow | `["escrow_vault"]` | Staking | Tax destination (71%) |
| carnage_vault | `["carnage_sol_vault"]` | Epoch | Tax destination (24%) |
| stake_pool | `["stake_pool"]` | Staking | Updated by deposit_rewards |

## 14. Events

| Event | Fields | Emitted By |
|-------|--------|------------|
| TaxedSwap | user, pool_type, direction, input_amount, output_amount, tax_amount, tax_rate_bps, staking_portion, carnage_portion, treasury_portion, epoch, slot | swap_sol_buy, swap_sol_sell |
| ExemptSwap | authority, pool, amount_a, direction, slot | swap_exempt |

## 15. Security Considerations

1. **Fake EpochState prevention:** Owner check ensures only Epoch Program can provide tax rates
2. **Pool spoofing prevention:** DEF-01 owner check on pool accounts
3. **Sandwich attack protection:** SEC-10 minimum output floor at 50%
4. **Carnage authority validation:** seeds::program constraint on swap_exempt
5. **Treasury hardcoding:** Address validated against compile-time constant
6. **Feature gating:** Treasury address uses `compile_error!` on mainnet without explicit address
