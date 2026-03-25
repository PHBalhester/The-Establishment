# Confirmed Invariants: Constants Cross-Verification
**Priority Rank: 7** (supporting: configuration correctness across all 4 programs)
**Source:** All 4 programs' `constants.rs` files
**Confirmed:** 23 invariants | Skipped: 0

---

## P0: Cross-Program PDA Seeds (Mismatch = Total Protocol Halt)

### INV-CONST-007: SWAP_AUTHORITY_SEED (AMM <-> Tax)
- **Tool:** LiteSVM
- **Property:** Both use `b"swap_authority"`

### INV-CONST-008: CARNAGE_SIGNER_SEED (Epoch <-> Tax)
- **Tool:** LiteSVM
- **Property:** Both use `b"carnage_signer"`

### INV-CONST-009: CARNAGE_SOL_VAULT_SEED (Epoch <-> Tax)
- **Tool:** LiteSVM
- **Property:** Both use `b"carnage_sol_vault"`

### INV-CONST-010: EPOCH_STATE_SEED (Epoch <-> Tax)
- **Tool:** LiteSVM
- **Property:** Both use `b"epoch_state"`

### INV-CONST-011: TAX_AUTHORITY_SEED (Tax <-> Staking)
- **Tool:** LiteSVM
- **Property:** Both use `b"tax_authority"`

### INV-CONST-012: STAKING_AUTHORITY_SEED (Epoch <-> Staking)
- **Tool:** LiteSVM
- **Property:** Both use `b"staking_authority"`

### INV-CONST-013: ESCROW_VAULT_SEED (Tax <-> Staking)
- **Tool:** LiteSVM
- **Property:** Both use `b"escrow_vault"`

### INV-CONST-014: STAKE_POOL_SEED (Tax <-> Staking)
- **Tool:** LiteSVM
- **Property:** Both use `b"stake_pool"`

### INV-CONST-015: Program IDs Consistent Across All Programs
- **Tool:** LiteSVM
- **Property:** Same string for each program ID in all cross-references

### INV-CONST-016: DEPOSIT_REWARDS_DISCRIMINATOR (Tax <-> Staking)
- **Tool:** LiteSVM
- **Property:** Both match sha256("global:deposit_rewards")[0..8]

### INV-CONST-017: UPDATE_CUMULATIVE_DISCRIMINATOR Correct
- **Tool:** LiteSVM
- **Property:** Matches sha256("global:update_cumulative")[0..8]

---

## P1: Distribution & Fee Constants

### INV-CONST-001: Distribution BPS Sum to 10000
- **Tool:** LiteSVM (compile-time const assertion candidate)
- **Property:** `7100 + 2400 + 500 == 10000`

### INV-CONST-002: Distribution Constants Match Hardcoded Split Logic
- **Tool:** LiteSVM
- **Property:** split_distribution(10000) produces (7100, 2400, 500)

### INV-CONST-003: SOL Pool Fee = 100 BPS (1%)
- **Tool:** LiteSVM
- **Property:** Matches token-economics-model.md

### INV-CONST-004: PROFIT Pool Fee = 50 BPS (0.5%)
- **Tool:** LiteSVM
- **Property:** PROFIT < SOL fee (by design for arb)

### INV-CONST-005: MAX_LP_FEE_BPS = 500 (Audit Fix H030)
- **Tool:** LiteSVM
- **Property:** Both operational fees under cap

### INV-CONST-006: BPS_DENOMINATOR = 10000 Across Programs
- **Tool:** LiteSVM
- **Property:** AMM and Tax both use 10000u128

---

## P2: Carnage & Epoch Constants

### INV-CONST-018: Genesis Tax Rates Within Valid Ranges
- **Tool:** LiteSVM
- **Property:** `100 <= 300 <= 400` (low), `1100 <= 1400 <= 1400` (high)

### INV-CONST-019: Carnage Slippage Floors Ordered
- **Tool:** LiteSVM
- **Property:** `7500 < 8500` (fallback < atomic)

### INV-CONST-020: Carnage Lock < Deadline
- **Tool:** LiteSVM
- **Property:** `50 < 300` (250 slots for fallback window)

### INV-CONST-021: MINIMUM_OUTPUT_FLOOR_BPS = 5000
- **Tool:** LiteSVM
- **Property:** 50% anti-sandwich floor, between 0 and 9900

---

## P3: Staking Constants

### INV-CONST-022: PRECISION = 1e18
- **Tool:** LiteSVM
- **Property:** DeFi standard, fits u128 with u64::MAX inputs

### INV-CONST-023: MINIMUM_STAKE = 1,000,000
- **Tool:** LiteSVM
- **Property:** 1 PROFIT token (6 decimals), prevents first-depositor attack
