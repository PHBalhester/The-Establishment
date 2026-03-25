# Constants Cross-Verification Invariants

**Source Files:**
- `programs/amm/src/constants.rs` (46 lines)
- `programs/tax-program/src/constants.rs` (273 lines)
- `programs/staking/src/constants.rs` (190 lines)
- `programs/epoch-program/src/constants.rs` (319 lines)
**Spec Reference:** `Docs/token-economics-model.md`

---

## Distribution Constants

### INV-CONST-001: Distribution BPS Sum to 10000

**Function:** Constants `STAKING_BPS`, `CARNAGE_BPS`, `TREASURY_BPS` at `programs/tax-program/src/constants.rs:18-25`
**Pattern:** VP-078
**Tool:** LiteSVM (compile-time const assertion)
**Confidence:** high

**Plain English:** The three distribution percentages (75% + 24% + 1%) must sum to exactly 100% (10000 basis points). If they don't, either lamports leak (sum < 10000) or the checked_sub in `split_distribution` underflows (sum > 10000).

**Why It Matters:** If `STAKING_BPS + CARNAGE_BPS + TREASURY_BPS > 10000`, then `floor(total * 75/100) + floor(total * 24/100) > total` for certain inputs, causing the treasury remainder computation `total - staking - carnage` to underflow. This would make ALL swaps fail with `TaxError::TaxOverflow` -- a complete protocol denial-of-service. If the sum is < 10000, lamports are silently locked in the swap_authority PDA forever.

**Formal Property:**
```
STAKING_BPS + CARNAGE_BPS + TREASURY_BPS == 10000

// Current values:
7500 + 2400 + 100 = 10000  // PASSES
```

**Verification Approach:**
A `const` assertion in `constants.rs` that runs at compile time: `const _: () = assert!(STAKING_BPS + CARNAGE_BPS + TREASURY_BPS == 10000);`. Currently this assertion does NOT exist -- the sum correctness is only implied by the documentation. A Rust `const` block should enforce this. Alternatively, a unit test (which exists implicitly through the split_distribution tests but NOT as a direct constant verification).

---

### INV-CONST-002: Distribution Constants Match Hardcoded Split Logic

**Function:** `STAKING_BPS`/`CARNAGE_BPS` at `constants.rs:18-21` vs `split_distribution` at `tax_math.rs:90,94`
**Pattern:** VP-078
**Tool:** LiteSVM
**Confidence:** medium

**Plain English:** The BPS constants (7500, 2400) and the hardcoded percentages in `split_distribution` (75, 24) must represent the same ratios. Currently they do (7500/100=75, 2400/100=24), but there is no compile-time enforcement linking them.

**Why It Matters:** If a developer changes `STAKING_BPS` from 7500 to 8000 (thinking it controls the split), `split_distribution` would still use hardcoded `75`, creating a silent discrepancy. The documentation and constants would say 80% staking, but actual on-chain behavior would remain 75%. This is a maintainability hazard that could become a security issue during an upgrade.

**Formal Property:**
```
STAKING_BPS as u64 / 100 == 75  // hardcoded in tax_math.rs:90
CARNAGE_BPS as u64 / 100 == 24  // hardcoded in tax_math.rs:94
// Remainder: 100 - 75 - 24 = 1 == TREASURY_BPS / 100
```

**Verification Approach:**
Unit test that reads both the constants and calls `split_distribution(10000)` to verify `(7500, 2400, 100)` is the output. If constants change, this test catches the divergence. Alternatively, refactor `split_distribution` to use the constants directly (dividing by BPS_DENOMINATOR instead of 100).

---

## AMM Fee Constants

### INV-CONST-003: SOL Pool Fee Matches Documentation

**Function:** `SOL_POOL_FEE_BPS` at `programs/amm/src/constants.rs:15`
**Pattern:** VP-078
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** The SOL pool LP fee is 100 bps (1.0%), matching the token economics model specification. This fee compounds into pool reserves permanently.

**Why It Matters:** If `SOL_POOL_FEE_BPS` were accidentally changed to 1000 (10%), users would lose 10% per swap to liquidity deepening on top of the 1-14% protocol tax. At 24% combined friction (14% tax + 10% fee), the protocol becomes unusable. The constant is immutable per-pool after initialization, so a wrong value at genesis is permanent.

**Formal Property:**
```
SOL_POOL_FEE_BPS == 100  // 1.0%

// Cross-reference: token-economics-model.md line 49:
// "CRIME/SOL ... 100 bps (1%)"
// "FRAUD/SOL ... 100 bps (1%)"
```

**Verification Approach:**
Direct value assertion in a unit test. Cross-reference against `Docs/token-economics-model.md` table at line 49 which specifies `100 bps (1%)` for SOL pools. Currently no test in `amm/src/constants.rs` verifies this value (the file has no test module).

---

### INV-CONST-004: PROFIT Pool Fee Matches Documentation

**Function:** `PROFIT_POOL_FEE_BPS` at `programs/amm/src/constants.rs:20`
**Pattern:** VP-078
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** The PROFIT pool LP fee is 50 bps (0.5%), intentionally lower than SOL pools to reduce arbitrage friction through the soft-peg bridge.

**Why It Matters:** The soft-peg mechanism relies on arbitrage friction being low enough (3-9% round-trip per token-economics-model.md line 348). If `PROFIT_POOL_FEE_BPS` were set to 100 instead of 50, the arbitrage cost increases by 1% (two PROFIT pool hops), potentially widening the soft-peg band and reducing volume through the bridge -- weakening the core economic mechanism.

**Formal Property:**
```
PROFIT_POOL_FEE_BPS == 50  // 0.5%
PROFIT_POOL_FEE_BPS < SOL_POOL_FEE_BPS  // by design: lower friction for arb

// Cross-reference: token-economics-model.md line 51:
// "CRIME/PROFIT ... 50 bps (0.5%)"
// "FRAUD/PROFIT ... 50 bps (0.5%)"
```

**Verification Approach:**
Direct value assertion plus relational check (`PROFIT < SOL`). Cross-reference against spec.

---

### INV-CONST-005: MAX_LP_FEE_BPS Enforces Audit Fix H030

**Function:** `MAX_LP_FEE_BPS` at `programs/amm/src/constants.rs:25`
**Pattern:** VP-012
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** The maximum LP fee is capped at 500 bps (5%), introduced as audit fix H030 to prevent admin misconfiguration during pool initialization. Without this cap, an admin could set 99% LP fees.

**Why It Matters:** If `MAX_LP_FEE_BPS` were removed or increased to 10000, the `initialize_pool` instruction would accept 100% LP fees. At 100% LP fee, every swap produces zero output (all input retained as fee), making the pool a black hole that traps tokens. Since LP fees compound permanently (no LP token withdrawal), those trapped tokens are irrecoverable.

**Formal Property:**
```
MAX_LP_FEE_BPS == 500  // 5% cap from audit H030
SOL_POOL_FEE_BPS <= MAX_LP_FEE_BPS     // 100 <= 500
PROFIT_POOL_FEE_BPS <= MAX_LP_FEE_BPS  // 50 <= 500
```

**Verification Approach:**
Direct assertions plus relational checks that both operational fee values are under the cap. Verify that `initialize_pool` instruction actually enforces this constraint (search for `MAX_LP_FEE_BPS` in pool init logic).

---

### INV-CONST-006: BPS_DENOMINATOR Consistency Across Programs

**Function:** `BPS_DENOMINATOR` at `programs/amm/src/constants.rs:28` and `programs/tax-program/src/constants.rs:15`
**Pattern:** VP-078
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** Both the AMM and Tax Program define `BPS_DENOMINATOR = 10_000` as u128. These must be identical -- if one program divides by 10000 and another by 1000, fee calculations would be 10x wrong.

**Why It Matters:** A typo changing one BPS_DENOMINATOR to 1000 would mean 100 bps is interpreted as 10% instead of 1%. All LP fees or tax calculations in that program would be 10x higher than intended, immediately breaking the protocol economics.

**Formal Property:**
```
amm::BPS_DENOMINATOR == tax_program::BPS_DENOMINATOR == 10_000u128
```

**Verification Approach:**
Cross-program unit test that imports both constants and asserts equality. Currently each program defines its own copy -- there is no shared crate. The values match (both 10000) but this is verified only by inspection.

---

## Cross-Program Seed Matching

### INV-CONST-007: SWAP_AUTHORITY_SEED Matches Between AMM and Tax Program

**Function:** `SWAP_AUTHORITY_SEED` at `programs/amm/src/constants.rs:5` and `programs/tax-program/src/constants.rs:11`
**Pattern:** Cross-program PDA
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** Both programs must derive the swap_authority PDA using the identical seed `b"swap_authority"`. A mismatch means the Tax Program signs with a PDA the AMM doesn't recognize, causing all CPI swap calls to fail.

**Why It Matters:** If the seeds diverge (e.g., one uses `b"swap_auth"` and the other `b"swap_authority"`), the Tax Program derives PDA-A while the AMM expects PDA-B. Every swap_sol_buy, swap_sol_sell, swap_profit_buy, swap_profit_sell, and swap_exempt instruction would fail with `ConstraintSeeds` error -- complete protocol halt.

**Formal Property:**
```
amm::SWAP_AUTHORITY_SEED == tax_program::SWAP_AUTHORITY_SEED == b"swap_authority"
```

**Verification Approach:**
Cross-program integration test that derives the PDA from both programs' seeds and Tax Program ID, verifying identical addresses. Current state: both are `b"swap_authority"` -- MATCHING.

---

### INV-CONST-008: CARNAGE_SIGNER_SEED Matches Between Epoch and Tax Programs

**Function:** `CARNAGE_SIGNER_SEED` at `programs/epoch-program/src/constants.rs:91` and `programs/tax-program/src/constants.rs:66`
**Pattern:** Cross-program PDA
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** The Epoch Program signs Carnage swap_exempt CPI calls using a PDA derived from `b"carnage_signer"`. The Tax Program validates this same seed. A mismatch blocks all Carnage execution.

**Why It Matters:** If these seeds diverge, Carnage cannot execute. The Carnage SOL vault accumulates tax revenue indefinitely but never performs buyback-and-burn. The deflationary mechanism dies. Worse, the accumulated SOL creates a growing honeypot with no way to spend it (no admin withdrawal function exists).

**Formal Property:**
```
epoch_program::CARNAGE_SIGNER_SEED == tax_program::CARNAGE_SIGNER_SEED == b"carnage_signer"
```

**Verification Approach:**
Derive PDA from both constants using Epoch Program ID, verify identical addresses. Current state: both `b"carnage_signer"` -- MATCHING.

---

### INV-CONST-009: CARNAGE_SOL_VAULT_SEED Matches Between Epoch and Tax Programs

**Function:** `CARNAGE_SOL_VAULT_SEED` at `programs/epoch-program/src/constants.rs:163` and `programs/tax-program/src/constants.rs:56`
**Pattern:** Cross-program PDA
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** The Tax Program deposits tax SOL into the Carnage vault PDA. The Epoch Program withdraws from the same PDA during Carnage execution. Both must use `b"carnage_sol_vault"` to address the same account.

**Why It Matters:** If seeds diverge, Tax Program deposits into vault-A but Epoch Program tries to withdraw from vault-B (a different empty account). Tax SOL is locked in vault-A forever. Carnage operates on empty vault-B, buying zero tokens. All buyback-and-burn activity ceases.

**Formal Property:**
```
epoch_program::CARNAGE_SOL_VAULT_SEED == tax_program::CARNAGE_SOL_VAULT_SEED == b"carnage_sol_vault"
```

**Verification Approach:**
Derive PDA from both constants using Epoch Program ID, verify identical addresses. Current state: both `b"carnage_sol_vault"` -- MATCHING.

---

### INV-CONST-010: EPOCH_STATE_SEED Matches Between Epoch and Tax Programs

**Function:** `EPOCH_STATE_SEED` at `programs/epoch-program/src/constants.rs:86` and `programs/tax-program/src/constants.rs:60`
**Pattern:** Cross-program PDA
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** The Tax Program reads the EpochState PDA to get current tax rates. The Epoch Program owns and updates this PDA. Both must address the same account using `b"epoch_state"`.

**Why It Matters:** If seeds diverge, the Tax Program reads from a nonexistent or stale EpochState PDA. Anchor deserialization would fail, blocking all taxed swaps. Even if it somehow read garbage data, the tax rates would be unpredictable.

**Formal Property:**
```
epoch_program::EPOCH_STATE_SEED == tax_program::EPOCH_STATE_SEED == b"epoch_state"
```

**Verification Approach:**
Derive PDA from both constants using Epoch Program ID, verify identical addresses. Current state: both `b"epoch_state"` -- MATCHING.

---

### INV-CONST-011: TAX_AUTHORITY_SEED Matches Between Tax and Staking Programs

**Function:** `TAX_AUTHORITY_SEED` at `programs/tax-program/src/constants.rs:110` and `programs/staking/src/constants.rs:73`
**Pattern:** Cross-program PDA
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** The Tax Program signs deposit_rewards CPI calls using a PDA derived from `b"tax_authority"`. The Staking Program validates this seed in its `seeds::program` constraint. A mismatch blocks all staking yield distribution.

**Why It Matters:** If these seeds diverge, the Tax Program cannot deposit rewards into the Staking Program. The 75% staking share of every tax would fail to distribute. Users staking PROFIT would earn zero yield. The SOL would either revert the entire swap transaction (if the error propagates) or be stuck in the swap_authority PDA (if the CPI error is caught).

**Formal Property:**
```
tax_program::TAX_AUTHORITY_SEED == staking::TAX_AUTHORITY_SEED == b"tax_authority"
```

**Verification Approach:**
Derive PDA from both constants using Tax Program ID, verify identical addresses. Current state: both `b"tax_authority"` -- MATCHING.

---

### INV-CONST-012: STAKING_AUTHORITY_SEED Matches Between Epoch and Staking Programs

**Function:** `STAKING_AUTHORITY_SEED` at `programs/epoch-program/src/constants.rs:112` and `programs/staking/src/constants.rs:64`
**Pattern:** Cross-program PDA
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** The Epoch Program signs update_cumulative CPI calls using a PDA derived from `b"staking_authority"`. The Staking Program validates this seed. A mismatch blocks all epoch-driven reward finalization.

**Why It Matters:** If these seeds diverge, the Epoch Program cannot call `update_cumulative` on the Staking Program. `pending_rewards` would accumulate in the StakePool but never be converted to `rewards_per_token_stored`. Users could never claim rewards because their checkpoint delta would always be zero. The staking escrow would grow indefinitely with no path to distribution.

**Formal Property:**
```
epoch_program::STAKING_AUTHORITY_SEED == staking::STAKING_AUTHORITY_SEED == b"staking_authority"
```

**Verification Approach:**
Derive PDA from both constants using Epoch Program ID, verify identical addresses. Current state: both `b"staking_authority"` -- MATCHING.

---

### INV-CONST-013: ESCROW_VAULT_SEED Matches Between Tax and Staking Programs

**Function:** `ESCROW_VAULT_SEED` at `programs/tax-program/src/constants.rs:117` and `programs/staking/src/constants.rs:50`
**Pattern:** Cross-program PDA
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** The Tax Program transfers the staking portion of tax to the escrow vault PDA. The Staking Program manages withdrawals from this same PDA. Both must use `b"escrow_vault"`.

**Why It Matters:** If seeds diverge, tax SOL goes to vault-A (derived from Tax Program's seed) but the Staking Program expects vault-B (derived from Staking Program's seed). The 75% staking share is locked in vault-A forever, and stakers claim from empty vault-B, receiving nothing.

**Formal Property:**
```
tax_program::ESCROW_VAULT_SEED == staking::ESCROW_VAULT_SEED == b"escrow_vault"
```

**Verification Approach:**
Derive PDA from both constants using Staking Program ID, verify identical addresses. Current state: both `b"escrow_vault"` -- MATCHING.

---

### INV-CONST-014: STAKE_POOL_SEED Matches Between Tax and Staking Programs

**Function:** `STAKE_POOL_SEED` at `programs/tax-program/src/constants.rs:113` and `programs/staking/src/constants.rs:41`
**Pattern:** Cross-program PDA
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** The Tax Program needs the StakePool PDA address for the deposit_rewards CPI. The Staking Program owns this PDA. Both use `b"stake_pool"`.

**Why It Matters:** A seed mismatch would cause the Tax Program to pass the wrong PDA to the Staking Program's deposit_rewards instruction. Anchor would reject the account with `ConstraintSeeds`, failing the entire swap transaction (since deposit_rewards is a CPI within the swap handler).

**Formal Property:**
```
tax_program::STAKE_POOL_SEED == staking::STAKE_POOL_SEED == b"stake_pool"
```

**Verification Approach:**
Derive PDA from both constants using Staking Program ID, verify identical addresses. Current state: both `b"stake_pool"` -- MATCHING.

---

## Cross-Program ID Constants

### INV-CONST-015: Program IDs Consistent Across All Programs

**Function:** Various `*_program_id()` functions across all four constants files
**Pattern:** Cross-program identity
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** Every program stores the IDs of programs it interacts with. These IDs must be identical across all copies. For example, the Tax Program ID must be the same string in the Epoch Program, Staking Program, and AMM.

**Why It Matters:** If Epoch Program stores a different Tax Program ID than what the Tax Program actually deploys as, all CPI calls from Epoch to Tax would be rejected by the Solana runtime (wrong program ID on the instruction). This would break epoch transitions, Carnage execution, and the entire state machine.

**Formal Property:**
```
// Tax Program ID: DRjNCjt4tfTisSJXD1VrAduKbgA7KHuGPoYwxrUQN8uj
amm::TAX_PROGRAM_ID == epoch::tax_program_id() == staking::tax_program_id()
  == "DRjNCjt4tfTisSJXD1VrAduKbgA7KHuGPoYwxrUQN8uj"

// AMM Program ID: 5ANTHFtgPgH1fUMywALtrpmT7uMHfWnFbz7hxY3tLzMj
tax::amm_program_id() == epoch::amm_program_id()
  == "5ANTHFtgPgH1fUMywALtrpmT7uMHfWnFbz7hxY3tLzMj"

// Staking Program ID: EZFeU613CfqzNcEumE293QDmimRHyP2ZNWcbTgCQRZSu
tax::staking_program_id() == epoch::staking_program_id()
  == "EZFeU613CfqzNcEumE293QDmimRHyP2ZNWcbTgCQRZSu"

// Epoch Program ID: G6dmJTdC36VRqqi57QhWH444Ju7ieCzHZW9yhH7TpUhz
tax::epoch_program_id() == staking::epoch_program_id()
  == "G6dmJTdC36VRqqi57QhWH444Ju7ieCzHZW9yhH7TpUhz"
```

**Verification Approach:**
Individual unit tests exist in each constants file (verified by grep). A cross-program integration test should import all four program IDs and assert bitwise equality. Current state: ALL IDs MATCH across programs based on source inspection.

---

### INV-CONST-016: DEPOSIT_REWARDS_DISCRIMINATOR Matches Between Tax and Staking

**Function:** `DEPOSIT_REWARDS_DISCRIMINATOR` at `programs/tax-program/src/constants.rs:172` and `programs/staking/src/constants.rs:108`
**Pattern:** Cross-program CPI encoding
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** Both programs store the same 8-byte Anchor discriminator for the `deposit_rewards` instruction: `[52, 249, 112, 72, 206, 161, 196, 1]`. The Tax Program uses it to build CPI instruction data; the Staking Program uses it to validate incoming calls.

**Why It Matters:** If the discriminators diverge, the Tax Program would send instruction data that Anchor's dispatch in the Staking Program doesn't recognize. The CPI would fail with "unknown instruction" error, blocking all staking reward distribution from tax collection.

**Formal Property:**
```
tax_program::DEPOSIT_REWARDS_DISCRIMINATOR == staking::DEPOSIT_REWARDS_DISCRIMINATOR
  == sha256("global:deposit_rewards")[0..8]
  == [52, 249, 112, 72, 206, 161, 196, 1]
```

**Verification Approach:**
Both programs already have unit tests computing sha256("global:deposit_rewards") and comparing (tax_program line 229, staking line 178). A cross-program test should additionally verify byte-for-byte equality between the two constants. Current state: MATCHING.

---

### INV-CONST-017: UPDATE_CUMULATIVE_DISCRIMINATOR Is Correct

**Function:** `UPDATE_CUMULATIVE_DISCRIMINATOR` at `programs/epoch-program/src/constants.rs:117`
**Pattern:** Cross-program CPI encoding
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** The Epoch Program stores the 8-byte Anchor discriminator for `update_cumulative`: `[0x93, 0x84, 0xdb, 0x65, 0xa5, 0x17, 0x3d, 0x71]`. It uses this to build CPI calls to the Staking Program.

**Why It Matters:** An incorrect discriminator would cause the Epoch Program's CPI to the Staking Program to fail at every epoch transition. `pending_rewards` would accumulate but never convert to `rewards_per_token_stored`. The staking system would appear functional (users can stake/unstake) but would never pay yield.

**Formal Property:**
```
UPDATE_CUMULATIVE_DISCRIMINATOR == sha256("global:update_cumulative")[0..8]
  == [0x93, 0x84, 0xdb, 0x65, 0xa5, 0x17, 0x3d, 0x71]
```

**Verification Approach:**
Existing unit test at epoch-program line 181 verifies this via sha256 computation. The Staking Program should also have a reciprocal test verifying it recognizes this discriminator (not currently checked -- only the Epoch Program side is tested).

---

## Tax Rate Constants

### INV-CONST-018: Genesis Tax Rates Within Valid Range

**Function:** `GENESIS_LOW_TAX_BPS` and `GENESIS_HIGH_TAX_BPS` at `programs/epoch-program/src/constants.rs:99-103`
**Pattern:** VP-012
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** The genesis tax rates (300 bps low, 1400 bps high) fall within the documented ranges: low [100..400], high [1100..1400]. These are the rates active before the first VRF resolution.

**Why It Matters:** If genesis low were set to 0, initial swaps would pay zero tax and no yield would accrue. If genesis high were set above 1400 (e.g., 9000 by mistake), the first epoch's expensive-side trades would lose 90% to tax, shocking early users and damaging protocol reputation before VRF even activates.

**Formal Property:**
```
100 <= GENESIS_LOW_TAX_BPS <= 400      // 300 is within range
1100 <= GENESIS_HIGH_TAX_BPS <= 1400   // 1400 is within range
GENESIS_LOW_TAX_BPS < GENESIS_HIGH_TAX_BPS  // low < high always

// Cross-reference: token-economics-model.md lines 99-102:
// "GENESIS_LOW_TAX_BPS = 300 (3%)"
// "GENESIS_HIGH_TAX_BPS = 1400 (14%)"
```

**Verification Approach:**
Direct value assertions plus range checks. Verify that `calculate_tax` produces expected results with these genesis values (e.g., 1 SOL at 300 bps = 0.03 SOL, 1 SOL at 1400 bps = 0.14 SOL).

---

## Carnage Constants

### INV-CONST-019: Carnage Slippage Floors Are Ordered Correctly

**Function:** `CARNAGE_SLIPPAGE_BPS_ATOMIC` and `CARNAGE_SLIPPAGE_BPS_FALLBACK` at `programs/epoch-program/src/constants.rs:127-132`
**Pattern:** VP-016
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** The atomic Carnage path has a stricter slippage floor (85%) than the fallback path (75%). This is correct: the atomic path executes in the same TX as VRF reveal (tight window, should get good price), while fallback runs later when price may have moved.

**Why It Matters:** If the values were swapped (atomic=75%, fallback=85%), the fallback path (which runs during potential MEV activity, after the lock window) would demand a better price than the atomic path. This could cause fallback to fail more often, reducing Carnage execution reliability, and make the atomic path accept worse prices unnecessarily.

**Formal Property:**
```
CARNAGE_SLIPPAGE_BPS_FALLBACK < CARNAGE_SLIPPAGE_BPS_ATOMIC
// 7500 < 8500 -- CORRECT

CARNAGE_SLIPPAGE_BPS_FALLBACK > 0    // must have some floor
CARNAGE_SLIPPAGE_BPS_ATOMIC <= 10000  // cannot exceed 100%
```

**Verification Approach:**
Direct assertions and relational check. Existing tests at epoch-program lines 257-267 verify individual values but do NOT test the relational ordering. The test at line 277 verifies `CARNAGE_LOCK_SLOTS < CARNAGE_DEADLINE_SLOTS` but no analogous test exists for slippage ordering.

---

### INV-CONST-020: Carnage Lock Window Within Deadline

**Function:** `CARNAGE_LOCK_SLOTS` and `CARNAGE_DEADLINE_SLOTS` at `programs/epoch-program/src/constants.rs:138,75`
**Pattern:** VP-016
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** The atomic-only lock window (50 slots) must be strictly less than the Carnage deadline (300 slots), leaving at least 200 slots for the fallback path.

**Why It Matters:** If `CARNAGE_LOCK_SLOTS >= CARNAGE_DEADLINE_SLOTS`, the fallback path would never have a valid execution window. Once the lock expires, the deadline has also expired, and the Carnage event is lost. SOL in the Carnage vault would never be spent.

**Formal Property:**
```
CARNAGE_LOCK_SLOTS < CARNAGE_DEADLINE_SLOTS  // 50 < 300
CARNAGE_DEADLINE_SLOTS - CARNAGE_LOCK_SLOTS >= 200  // 250 >= 200 (adequate fallback window)
```

**Verification Approach:**
Existing tests at epoch-program lines 274-298 verify both conditions. This is already well-tested.

---

### INV-CONST-021: MINIMUM_OUTPUT_FLOOR_BPS Value and Documentation Match

**Function:** `MINIMUM_OUTPUT_FLOOR_BPS` at `programs/tax-program/src/constants.rs:40`
**Pattern:** VP-012
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** The protocol-wide minimum output floor is 5000 bps (50%). This means users cannot set `minimum_amount_out` below half of the AMM's expected output. This anti-sandwich protection is distinct from Carnage's slippage floors.

**Why It Matters:** If this value were accidentally set to 0, the output floor check would be meaningless -- bots could sandwich users with zero slippage protection. If set to 10000 (100%), legitimate slippage would cause all swaps to fail (actual output always slightly below expected due to LP fees and rounding).

**Formal Property:**
```
MINIMUM_OUTPUT_FLOOR_BPS == 5000  // 50%

// Must be:
// > 0 (otherwise no protection)
// < 10000 (otherwise all swaps fail due to LP fee + rounding)
// Specifically < (10000 - SOL_POOL_FEE_BPS) to account for LP fee
//   < 9900 for SOL pools (1% LP fee)
//   < 9950 for PROFIT pools (0.5% LP fee)

// Cross-reference: token-economics-model.md line 551:
// "MINIMUM_OUTPUT_FLOOR_BPS = 5000 (50%)"
```

**Verification Approach:**
Direct value assertion. Verify that `calculate_output_floor` with these parameters produces nonzero floors for realistic pool states but does not reject legitimate swaps where LP fee reduces output by 0.5-1%.

---

## Staking Constants

### INV-CONST-022: PRECISION Is DeFi Standard 1e18

**Function:** `PRECISION` at `programs/staking/src/constants.rs:21`
**Pattern:** VP-015
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** The reward-per-token precision multiplier is 1e18, matching the Solidity/DeFi convention. This provides sufficient precision for the cumulative reward calculation without overflowing u128.

**Why It Matters:** If PRECISION were too small (e.g., 1e6), the cumulative reward calculation would lose significant precision over time, causing stakers to receive less than their fair share. If too large (e.g., 1e30), intermediate multiplications (`total_deposited * PRECISION / total_staked`) could overflow u128 when total_staked is small and total_deposited is large.

**Formal Property:**
```
PRECISION == 1_000_000_000_000_000_000  // 1e18

// Overflow check: max_deposited * PRECISION must fit u128
// max_deposited ~ 200M SOL = 2e17 lamports (total Solana supply)
// 2e17 * 1e18 = 2e35 < 3.4e38 (u128::MAX) -- SAFE
```

**Verification Approach:**
Direct value assertion. Overflow boundary check: verify that `u64::MAX as u128 * PRECISION` does not overflow u128.

---

### INV-CONST-023: MINIMUM_STAKE Prevents First-Depositor Attack

**Function:** `MINIMUM_STAKE` at `programs/staking/src/constants.rs:32`
**Pattern:** First-depositor defense
**Tool:** LiteSVM
**Confidence:** high

**Plain English:** The minimum dead stake of 1,000,000 base units (1 PROFIT token at 6 decimals) ensures an attacker cannot be the first depositor and manipulate the reward-per-token ratio.

**Why It Matters:** Without dead stake, an attacker could: (1) stake 1 lamport, (2) donate 1000 SOL to the escrow, (3) the cumulative reward_per_token becomes 1000e18, (4) next staker's checkpoint starts at this inflated value, missing all historical rewards. With 1 PROFIT dead stake, the attacker would need to donate >1M SOL to achieve similar inflation -- economically infeasible.

**Formal Property:**
```
MINIMUM_STAKE == 1_000_000  // 1 PROFIT = 10^6 base units (6 decimals)
MINIMUM_STAKE >= 10^PROFIT_DECIMALS  // at least 1 whole token
```

**Verification Approach:**
Direct value assertion. Cross-reference against PROFIT_DECIMALS (6) to verify that MINIMUM_STAKE equals exactly 1 whole PROFIT token.

---

## Summary of Verification Gaps Found

| Gap | Severity | Description |
|-----|----------|-------------|
| **No compile-time BPS sum assertion** | Medium | `STAKING_BPS + CARNAGE_BPS + TREASURY_BPS == 10000` is not enforced at compile time in `constants.rs`. Only implicit through `split_distribution` tests. |
| **Hardcoded vs constant divergence risk** | Medium | `split_distribution` uses `75` and `24` instead of `STAKING_BPS/100` and `CARNAGE_BPS/100`. No test links these values. |
| **No AMM constants test module** | Low | `programs/amm/src/constants.rs` has NO `#[cfg(test)] mod tests`. Fee values (100, 50, 500 bps) are tested only implicitly through integration tests. |
| **No slippage floor ordering test** | Low | `CARNAGE_SLIPPAGE_BPS_ATOMIC > CARNAGE_SLIPPAGE_BPS_FALLBACK` is not asserted in any test. Individual values are checked but not their relationship. |
| **No `floor_bps` validation in `calculate_output_floor`** | Low | Unlike `calculate_tax` which rejects bps > 10000, `calculate_output_floor` has no guard on `floor_bps`. Callers always pass valid constants, but the function itself is unguarded. |
| **Staking Program has no UPDATE_CUMULATIVE_DISCRIMINATOR** | Low | The discriminator is stored only in Epoch Program. The Staking Program relies on Anchor's automatic dispatch. If the instruction name changes, only the Epoch Program's constant would fail. |
