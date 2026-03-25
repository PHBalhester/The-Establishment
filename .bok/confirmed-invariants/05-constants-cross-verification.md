# Constants Cross-Verification -- Confirmed Invariants
# Priority Rank: 5 (Quick wins -- simple assertions, catastrophic if wrong)

Source: All 4 programs' `constants.rs` files

---

## INV-CONST-001: Distribution BPS Sum to 10000 [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 1 (GAP: no compile-time assert)
- **Property:** `STAKING_BPS + CARNAGE_BPS + TREASURY_BPS == 10000`
- **Code:** `tax-program/constants.rs:18-25`

## INV-CONST-002: Distribution Constants Match Hardcoded Split [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 2 (GAP: maintainability hazard)
- **Property:** `STAKING_BPS/100 == 75`, `CARNAGE_BPS/100 == 24`
- **Code:** `constants.rs:18-21` vs `tax_math.rs:90,94`

## INV-CONST-007: SWAP_AUTHORITY_SEED (AMM <-> Tax) [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 3
- **Property:** Both programs use `b"swap_authority"`

## INV-CONST-008: CARNAGE_SIGNER_SEED (Epoch <-> Tax) [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 4
- **Property:** Both programs use `b"carnage_signer"`

## INV-CONST-009: CARNAGE_SOL_VAULT_SEED (Epoch <-> Tax) [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 5
- **Property:** Both programs use `b"carnage_sol_vault"`

## INV-CONST-010: EPOCH_STATE_SEED (Epoch <-> Tax) [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 6
- **Property:** Both programs use `b"epoch_state"`

## INV-CONST-011: TAX_AUTHORITY_SEED (Tax <-> Staking) [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 7
- **Property:** Both programs use `b"tax_authority"`

## INV-CONST-012: STAKING_AUTHORITY_SEED (Epoch <-> Staking) [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 8
- **Property:** Both programs use `b"staking_authority"`

## INV-CONST-013: ESCROW_VAULT_SEED (Tax <-> Staking) [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 9
- **Property:** Both programs use `b"escrow_vault"`

## INV-CONST-014: STAKE_POOL_SEED (Tax <-> Staking) [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 10
- **Property:** Both programs use `b"stake_pool"`

## INV-CONST-015: Program IDs Consistent Across All Programs [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 11
- **Property:** All 4 program IDs match across all cross-references

## INV-CONST-016: DEPOSIT_REWARDS_DISCRIMINATOR (Tax <-> Staking) [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 12
- **Property:** `sha256("global:deposit_rewards")[0..8]` matches both copies

## INV-CONST-017: UPDATE_CUMULATIVE_DISCRIMINATOR [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 13
- **Property:** `sha256("global:update_cumulative")[0..8]` matches stored bytes

## INV-CONST-006: BPS_DENOMINATOR Consistency [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 14
- **Property:** `amm::BPS_DENOMINATOR == tax::BPS_DENOMINATOR == 10_000u128`

## INV-CONST-003: SOL Pool Fee = 100 bps [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 15
- **Property:** `SOL_POOL_FEE_BPS == 100`

## INV-CONST-004: PROFIT Pool Fee = 50 bps [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 16
- **Property:** `PROFIT_POOL_FEE_BPS == 50`, `< SOL_POOL_FEE_BPS`

## INV-CONST-005: MAX_LP_FEE_BPS = 500 (Audit H030) [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 17
- **Property:** `MAX_LP_FEE_BPS == 500`, both fee constants <= cap

## INV-CONST-018: Genesis Tax Rates Within Valid Range [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 18
- **Property:** `100 <= GENESIS_LOW <= 400`, `1100 <= GENESIS_HIGH <= 1400`, `low < high`

## INV-CONST-019: Carnage Slippage Floors Ordered [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 19 (GAP: no ordering test)
- **Property:** `FALLBACK_BPS < ATOMIC_BPS`

## INV-CONST-020: Carnage Lock Within Deadline [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 20
- **Property:** `LOCK_SLOTS < DEADLINE_SLOTS`, gap >= 200

## INV-CONST-021: MINIMUM_OUTPUT_FLOOR_BPS = 5000 [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 21
- **Property:** Value is 5000, within (0, 9900) safe range

## INV-CONST-022: PRECISION = 1e18 [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 22
- **Property:** `PRECISION == 1_000_000_000_000_000_000`

## INV-CONST-023: MINIMUM_STAKE First-Depositor Defense [CONFIRMED]
- **Tool:** LiteSVM
- **Priority:** 23
- **Property:** `MINIMUM_STAKE == 1_000_000` (1 PROFIT at 6 decimals)
