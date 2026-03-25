---
task_id: sos-phase1-token-economic
provides: [token-economic-findings, token-economic-invariants]
focus_area: token-economic
files_analyzed: [transfer_hook.rs, sell.rs, purchase.rs, fund_curve.rs, claim_refund.rs, swap_sol_buy.rs, swap_sol_sell.rs, tax_math.rs, pool_reader.rs, claim.rs, deposit_rewards.rs, staking/math.rs, stake.rs, unstake.rs, swap_sol_pool.rs, convert.rs, distribute_tax_escrow.rs, consolidate_for_refund.rs, bonding_curve/math.rs, bonding_curve/constants.rs, bonding_curve/state.rs, tax-program/constants.rs, staking/constants.rs, amm/helpers/math.rs, amm/helpers/transfers.rs, initialize_stake_pool.rs, initialize.ts]
finding_count: 14
severity_breakdown: {critical: 2, high: 4, medium: 5, low: 3}
---
<!-- CONDENSED_SUMMARY_START -->
# Token & Economic -- Condensed Summary

## Key Findings (Top 10)

1. **Sell path passes minimum_amount_out=0 to AMM CPI**: The Tax Program swap_sol_sell handler passes `amm_minimum: u64 = 0` to the AMM swap, deferring slippage to post-tax net check. Between the AMM CPI and the net check, the gross output is fully exposed to sandwich manipulation within the transaction -- `swap_sol_sell.rs:147`
2. **Staking escrow rent-exempt not subtracted from claimable balance**: `claim.rs:102` checks `escrow_balance < rewards_to_claim` but does not account for the rent-exempt minimum. If all pending rewards are claimed, the escrow drops below rent-exempt and the account is garbage-collected -- `staking/claim.rs:102-110`
3. **Bonding curve solvency check uses saturating_sub on rent**: `sell.rs:290` uses `expected_from_integral.saturating_sub(rent_exempt_min as u64)` which silently saturates to 0 if integral < rent, making the solvency assertion pass vacuously for very small positions -- `bonding_curve/sell.rs:290`
4. **Mint authority burn confirmed in initialize.ts**: Previous finding H113 is resolved. `initialize.ts:933-960` burns mint authority (sets to null) for all 3 mints after seeding vaults. The check at line 941 skips if already burned.
5. **Tax distribution BPS mismatch between constants and comments**: `swap_sol_buy.rs:38` comments say "75% staking, 24% carnage, 1% treasury" but `tax-program/constants.rs:17-25` defines STAKING_BPS=7100 (71%), CARNAGE_BPS=2400 (24%), TREASURY_BPS=500 (5%). The code is correct (71/24/5), comments in swap_sol_buy are stale -- `swap_sol_buy.rs:38,114`
6. **Conversion vault integer division truncation**: `convert.rs:103` computes CRIME/FRAUD->PROFIT as `amount_in / 100` with no remainder handling. Users converting 99 tokens lose 99 tokens and get 0 PROFIT (blocked by `out > 0` check at line 104, but 199 tokens yields only 1 PROFIT, losing 99 tokens) -- `conversion-vault/convert.rs:103`
7. **Bonding curve sell tax uses ceil rounding (protocol-favored)**: `sell.rs:174-179` applies ceil rounding on sell tax: `(sol_gross * SELL_TAX_BPS + BPS_DENOMINATOR - 1) / BPS_DENOMINATOR`. This is correctly protocol-favored (users pay at most 1 lamport extra) -- noted as positive pattern.
8. **Refund proportional math uses floor rounding (protocol-favored)**: `claim_refund.rs:146-149` floors the refund: `(user_balance * refund_pool / tokens_sold)`. Last claimer gets any residual dust left in vault. This is safe if each claimer's share > 0.
9. **First-depositor attack mitigated in staking**: `initialize_stake_pool.rs:9-11` deposits MINIMUM_STAKE (1 PROFIT) as dead stake, and `staking/math.rs:98-100` returns Ok(0) if total_staked==0, preventing reward inflation.
10. **Transfer hook whitelist existence-based PDA pattern**: `transfer_hook.rs:166-178` validates whitelist by deriving expected PDA and comparing keys. This is correct -- existence of PDA = whitelisted, no spoofing possible.

## Critical Mechanisms

- **Tax Distribution Pipeline (swap_sol_buy/sell)**: Deducts tax from input (buy) or output (sell), splits 71/24/5 across staking/carnage/treasury via system transfers + deposit_rewards CPI. The sell path uses a WSOL intermediary (close-reinit cycle) to convert WSOL tax to native SOL -- `swap_sol_buy.rs:83-209`, `swap_sol_sell.rs:230-451`
- **Bonding Curve Pricing (math.rs)**: Linear curve P(x) = P_START + slope*x with quadratic solver for buy and linear integral for sell. u128 intermediates with PRECISION=1e12 scaling. 13.5M proptest iterations. Floor rounding favors protocol on buys, ceil rounding favors protocol on sell tax -- `bonding_curve/math.rs:56-110`, `sell.rs:174-179`
- **Staking Reward Distribution (Synthetix/Quarry pattern)**: Cumulative reward-per-token with u128 PRECISION=1e18. Epoch program calls update_cumulative to distribute pending_rewards pro-rata. Users checkpoint on stake/unstake/claim. Forfeiture on unstake returns rewards to pool -- `staking/math.rs:36-67`, `staking/math.rs:91-100`
- **Transfer Hook Whitelist**: Token-2022 transfer hook requires at least one party (source or dest) to be whitelisted. Prevents arbitrary token transfers. Direct invocation blocked by transferring flag check -- `transfer_hook.rs:77-113`
- **AMM Constant Product with CEI**: Reserves updated before transfers. k-invariant verified. LP fee deducted from input before output calculation. Reentrancy guard via pool.locked field -- `swap_sol_pool.rs:57-300`

## Invariants & Assumptions

- INVARIANT: `staking + carnage + treasury == total_tax` for all tax splits -- enforced at `tax_math.rs:105-107` (treasury = remainder)
- INVARIANT: `k_after >= k_before` for all AMM swaps -- enforced at `swap_sol_pool.rs:171-173`
- INVARIANT: `vault_balance >= integral(0, tokens_sold)` for bonding curve solvency -- enforced at `sell.rs:286-292` (with saturating_sub caveat)
- INVARIANT: mint authority is null (burned) for CRIME, FRAUD, PROFIT -- enforced at `initialize.ts:933-960`
- ASSUMPTION: Tax Program's EpochState deserialization matches Epoch Program's layout exactly -- validated by owner check + discriminator at `swap_sol_buy.rs:59-75` / UNVALIDATED if Epoch Program is upgraded and layout changes
- ASSUMPTION: Transfer Hook accounts in remaining_accounts are correctly ordered -- UNVALIDATED on-chain; relies on client passing correct accounts
- ASSUMPTION: escrow_vault will always have sufficient lamports to cover all claims -- partially validated at `deposit_rewards.rs:99-102` but NOT validated in `claim.rs` against rent-exempt minimum

## Risk Observations (Prioritized)

1. **AMM slippage bypass in sell path**: `swap_sol_sell.rs:147` sends `amm_minimum=0` to AMM CPI. The Tax Program checks `net_output >= minimum_output` afterward, but the AMM executes with zero slippage protection. A sandwich attacker manipulating the pool between the AMM CPI and the slippage check would succeed because both happen within the same instruction (atomic). However, the AMM's own output floor (MINIMUM_OUTPUT_FLOOR_BPS=5000 at `swap_sol_sell.rs:112-118`) provides pre-CPI protection. Need to verify: is the output floor sufficient to prevent economically significant sandwich attacks? The floor is 50% of expected output -- this is generous enough for most attacks but very large trades against thin liquidity could still be sandwiched.
2. **Escrow rent depletion in staking claim**: `claim.rs:140-145` drains lamports from escrow without checking if the remainder stays above rent-exempt minimum. If the last claimer takes everything, the escrow PDA is destroyed. Next deposit_rewards CPI would fail because the PDA no longer exists.
3. **Conversion vault truncation loss at boundary**: Converting 199 CRIME to PROFIT yields 1 PROFIT (worth 100 CRIME equivalent). 99 CRIME is lost to truncation. No warning to user. The `out > 0` check prevents zero-output but doesn't prevent significant value loss.
4. **Bonding curve sell: sol_returned tracks gross but vault actually loses gross**: `sell.rs:262-265` adds sol_gross to sol_returned, but the vault loses both sol_net (to user) AND tax (to escrow). The identity `vault_balance = sol_raised - sol_returned` does NOT hold because sol_returned only counts gross from sells, not the additional tax escrow drain. The solvency check at line 286-292 uses integral math which is independent of these counters, so it works, but the counters themselves are misleading for off-chain monitoring.
5. **Mainnet treasury address is Pubkey::default()**: `tax-program/constants.rs:141-144` uses `Pubkey::default()` (all zeros) for mainnet. If deployed without setting this, 5% of all tax goes to an unowned address. The `address = treasury_pubkey()` constraint would accept it.

## Novel Attack Surface

- **Dual-curve coupled failure mode**: Both CRIME and FRAUD curves must fill for graduation. If one fills and the other fails, the filled curve enters refund mode. An attacker could strategically prevent one curve from filling (by not buying, or by selling near deadline) to force refunds on the other. This is not exploitable for profit (refunds return proportional SOL) but could be used for griefing/market manipulation.
- **Tax rate derivation from VRF**: Dynamic tax rates per epoch come from Switchboard VRF bytes. An attacker who knows the VRF outcome before it's consumed (unlikely but theoretically possible via observing the randomness commitment) could time large trades to coincide with low-tax epochs. The 4-14% tax range limits the economic impact.
- **WSOL intermediary close-reinit atomicity**: The sell path closes and recreates the WSOL intermediary within a single instruction. If any step fails between close and reinit (e.g., insufficient swap_authority lamports for rent), subsequent sells would fail because the intermediary is gone. This is a DoS vector if the swap_authority PDA's balance is drained somehow.

## Cross-Focus Handoffs

- **-> Arithmetic Agent**: Verify bonding curve math.rs quadratic formula for edge cases at extreme positions (tokens_sold near 0 and near TOTAL_FOR_SALE). The isqrt() at line 97 needs verification for all u128 inputs in range.
- **-> Arithmetic Agent**: Tax math calculate_tax rounds DOWN (floor). Sell.rs tax rounds UP (ceil). Verify these opposing directions don't create an arbitrage loop (buy tax floor + sell tax ceil should net-favor protocol).
- **-> CPI Agent**: Verify swap_sol_sell's WSOL intermediary close-reinit cycle handles all CPI failure modes. The close_account at line 295-312 followed by create_account at line 409-426 must be atomic.
- **-> Access Control Agent**: Who controls fee parameters (STAKING_BPS, CARNAGE_BPS)? They are compile-time constants in constants.rs, not admin-changeable. Verify no upgrade path changes these without full redeploy.
- **-> Timing Agent**: Bonding curve deadline_slot (432k slots = ~48h) + grace period (150 slots = ~60s). Verify slot-based timing is robust against slot skipping and network outages.
- **-> State Machine Agent**: Bonding curve status transitions (Initialized -> Active -> Filled -> Graduated | Failed). Verify mark_failed cannot be called while curve is Filled, and prepare_transition cannot proceed if either curve is Failed.

## Trust Boundaries

The protocol has three trust levels: (1) Admin/deployer who initializes programs and burns mint authority -- trusted during setup, authority burned afterward making supply fixed; (2) Protocol PDAs (swap_authority, tax_authority, staking_authority) which are derived from seeds::program constraints -- trusted because only the correct program can produce valid PDA signers; (3) Users who interact via permissionless instructions (purchase, sell, swap, stake, claim) -- untrusted, all user inputs are validated. The key trust assumption is that admin keys are secure during the initialization phase (before mint authority burn) and that deployed program code matches audited source.
<!-- CONDENSED_SUMMARY_END -->

---

# Token & Economic -- Full Analysis

## Executive Summary

The Dr Fraudsworth protocol implements a multi-layered token economy with three custom tokens (CRIME, FRAUD as Token-2022 with transfer hooks, and PROFIT as Token-2022), a dual bonding curve launch mechanism, constant-product AMM pools, asymmetric swap taxation with 3-way distribution, cumulative reward staking, and a VRF-driven carnage buyback-and-burn system.

The token economic security posture is **strong overall**, with several notable design decisions: mint authority is burned post-initialization, all financial arithmetic uses checked operations with u128 intermediates, the staking system includes first-depositor attack prevention, and the AMM enforces k-invariant with CEI ordering. The bonding curve math has been extensively fuzz-tested (13.5M proptest iterations).

Key concerns center around: (1) the sell path's zero slippage to AMM CPI (mitigated by output floor but still a design smell), (2) staking escrow rent-exempt accounting gaps, and (3) conversion vault truncation losses that could confuse users. The dual-curve coupling creates a novel economic dynamic where strategic non-participation can force refund mode.

## Scope

### Files Analyzed (Layer 3 -- Full Source)
- `programs/transfer-hook/src/instructions/transfer_hook.rs` (179 LOC)
- `programs/bonding_curve/src/instructions/sell.rs` (319 LOC)
- `programs/bonding_curve/src/instructions/purchase.rs` (310 LOC)
- `programs/bonding_curve/src/instructions/fund_curve.rs` (126 LOC)
- `programs/bonding_curve/src/instructions/claim_refund.rs` (206 LOC)
- `programs/bonding_curve/src/instructions/distribute_tax_escrow.rs` (103 LOC)
- `programs/bonding_curve/src/instructions/consolidate_for_refund.rs` (123 LOC)
- `programs/bonding_curve/src/math.rs` (120 LOC read, 1827 total)
- `programs/bonding_curve/src/constants.rs` (177 LOC)
- `programs/bonding_curve/src/state.rs` (247 LOC)
- `programs/tax-program/src/instructions/swap_sol_buy.rs` (478 LOC)
- `programs/tax-program/src/instructions/swap_sol_sell.rs` (632 LOC)
- `programs/tax-program/src/helpers/tax_math.rs` (515 LOC)
- `programs/tax-program/src/constants.rs` (252 LOC)
- `programs/staking/src/instructions/claim.rs` (172 LOC)
- `programs/staking/src/instructions/deposit_rewards.rs` (119 LOC)
- `programs/staking/src/instructions/stake.rs` (165 LOC)
- `programs/staking/src/instructions/unstake.rs` (80 LOC read)
- `programs/staking/src/helpers/math.rs` (100 LOC read)
- `programs/staking/src/instructions/initialize_stake_pool.rs` (60 LOC read)
- `programs/amm/src/instructions/swap_sol_pool.rs` (300 LOC read)
- `programs/conversion-vault/src/instructions/convert.rs` (174 LOC)
- `scripts/deploy/initialize.ts` (mint authority burn section)

### Files Analyzed (Layer 2 -- Signatures Only)
- `programs/amm/src/helpers/math.rs`
- `programs/amm/src/helpers/transfers.rs`
- `programs/staking/src/state/stake_pool.rs`
- `programs/staking/src/state/user_stake.rs`
- `programs/conversion-vault/src/helpers/hook_helper.rs`

### Estimated Coverage
- Token transfer paths: ~95%
- Fee/tax calculation: ~95%
- Reward/staking math: ~85%
- Bonding curve pricing: ~80%
- Conversion vault: ~90%

## Key Mechanisms

### 1. Bonding Curve Pricing (Linear Integral)

**Location:** `programs/bonding_curve/src/math.rs:56-110`

**Purpose:** Price discovery for CRIME and FRAUD tokens during launch phase. Linear price curve from P_START (900 lamports/human token) to P_END (3450 lamports/human token) over 460M tokens.

**How it works:**
- `calculate_tokens_out(sol_lamports, current_sold)`: Uses quadratic formula to solve the integral for number of tokens a given SOL amount buys. Floor division favors protocol.
- `calculate_sol_for_tokens(current_sold, tokens)`: Computes the area under the price curve for a token range. Uses PRECISION=1e12 scaling with remainder recovery.
- All math is u128 with checked operations. Overflow analysis documented inline (worst case ~4.87e36, well within u128 max ~3.4e38).

**Assumptions:**
- P_START and P_END constants are correct and produce ~1000 SOL total raise
- isqrt() on u128 is available and correct in the SBF runtime
- TOKEN_DECIMAL_FACTOR (1e6) correctly bridges human tokens to base units

**Invariants:**
- `calculate_sol_for_tokens(0, TOTAL_FOR_SALE)` produces approximately TARGET_SOL (1000 SOL)
- For any buy followed by immediate sell: sol_returned_gross <= sol_spent (due to floor rounding on buy + protocol-favored math)
- `calculate_tokens_out` is monotonically increasing with sol_lamports

**Concerns:**
- The full-curve integral produces ~1000.5 SOL (not exactly 1000) due to P_START rounding. This is documented and accepted.
- Very small purchases near the end of the curve (tokens_sold close to TARGET_TOKENS) may produce 0 tokens due to floor division at line 104.

### 2. Bonding Curve Sell with Tax

**Location:** `programs/bonding_curve/src/instructions/sell.rs:111-319`

**Purpose:** Allow users to sell tokens back to the curve during the active phase, with a 15% tax sent to escrow.

**How it works:**
1. Validates: Active status, sufficient balance, non-zero, deadline not passed
2. Computes x2 = tokens_sold - tokens_to_sell (checked_sub)
3. Calls calculate_sol_for_tokens(x2, tokens_to_sell) for gross SOL
4. Tax = ceil(sol_gross * 1500 / 10000) -- ceil rounding protocol-favored
5. sol_net = sol_gross - tax (checked_sub)
6. Slippage check: sol_net >= minimum_sol_out
7. Token transfer: user -> vault (invoke with hook accounts)
8. SOL transfer: sol_vault -> user (direct lamport manipulation, sol_net)
9. Tax transfer: sol_vault -> tax_escrow (direct lamport manipulation, tax)
10. State update: tokens_sold = x2
11. Solvency assertion: vault_balance >= integral(0, tokens_sold) - rent_exempt

**Assumptions:**
- sol_vault has sufficient lamports for both sol_net and tax
- Direct lamport manipulation is safe for program-owned PDAs (it is)
- rent_exempt_min for a 0-byte account is accurately computed by Rent::get()

**Invariants:**
- Post-sell: vault_balance >= integral(0, new_tokens_sold)
- sol_returned counter tracks gross (before tax), preserving: vault_balance ~= sol_raised - sol_returned (approximately, modulo tax escrow)

**Concerns:**
- Line 290: `expected_from_integral.saturating_sub(rent_exempt_min as u64)` -- if the integral value is less than rent_exempt_min (extremely unlikely but theoretically possible at very low tokens_sold), this saturates to 0, making the solvency check pass trivially. For this protocol's parameters (P_START=900, even 1 token sold produces integral > 0 lamports but < rent), this is actually a concern for very early sells after very small purchases.
- Counter consistency: sol_returned tracks gross, but the vault loses gross + tax (to escrow). This means `sol_raised - sol_returned != vault_balance` when there's been tax collection. The solvency check uses integral math directly, bypassing this issue.

### 3. Tax Distribution Pipeline (Buy Path)

**Location:** `programs/tax-program/src/instructions/swap_sol_buy.rs:47-343`

**Purpose:** Deduct dynamic tax from SOL input, distribute to 3 destinations, then swap remaining SOL via AMM.

**How it works:**
1. Read EpochState from Epoch Program (owner check + discriminator validation)
2. Get tax_bps for direction/token from EpochState
3. calculate_tax(amount_in, tax_bps) -- floor division
4. sol_to_swap = amount_in - tax_amount
5. Enforce output floor: minimum_output >= 50% of expected AMM output
6. Split tax: 71% staking, 24% carnage, 5% treasury (floor + remainder)
7. System transfers to 3 destinations (user signs)
8. Staking CPI: deposit_rewards to update pending_rewards counter
9. AMM CPI: swap_sol_pool with sol_to_swap and minimum_output
10. Balance-diff to compute actual tokens received
11. Emit event

**Assumptions:**
- EpochState layout in tax-program matches epoch-program's actual layout
- Tax rates from EpochState are within valid bounds (0-10000 bps)
- AMM program at the hardcoded address is the legitimate AMM

**Invariants:**
- staking_portion + carnage_portion + treasury_portion == tax_amount (enforced by remainder pattern)
- sol_to_swap > 0 (checked at line 94)
- minimum_output >= output_floor (50% of expected output)

**Concerns:**
- Stale comments at line 38: "75% staking, 24% carnage, 1% treasury" should be "71%, 24%, 5%"
- The tax calculation uses floor division (user benefits), while bonding curve sell uses ceil (protocol benefits). This inconsistency is intentional but should be documented.

### 4. Tax Distribution Pipeline (Sell Path)

**Location:** `programs/tax-program/src/instructions/swap_sol_sell.rs:62-477`

**Purpose:** Execute token-to-SOL swap, then deduct tax from WSOL output and distribute.

**How it works:**
1. Read EpochState (same validation as buy path)
2. Snapshot user's WSOL balance before AMM CPI
3. Execute AMM CPI with direction=BtoA, **minimum_amount_out=0**
4. Reload WSOL balance, compute gross_output = after - before
5. Calculate tax on gross output
6. net_output = gross - tax; check net > 0 and net >= minimum_output
7. Transfer tax WSOL: user -> wsol_intermediary
8. Close intermediary to swap_authority (unwraps WSOL to native SOL)
9. Distribute native SOL from swap_authority to 3 destinations
10. Recreate intermediary for next sell

**Assumptions:**
- WSOL balance difference accurately represents AMM output (no other WSOL transfers in same instruction)
- swap_authority PDA retains enough lamports from close to fund recreate + distribution
- The close-reinit cycle completes atomically within the instruction

**Invariants:**
- net_output > 0 (line 243)
- net_output >= minimum_output (user-specified slippage, line 245)
- Intermediary is recreated and functional after each sell

**Concerns:**
- **CRITICAL**: Line 147 passes `amm_minimum: u64 = 0` to AMM. The AMM will execute ANY output amount. The protection comes from:
  (a) output_floor at lines 112-118 (50% of expected output pre-CPI), and
  (b) net_output >= minimum_output post-CPI (line 245).
  Since (a) checks `minimum_output` (user parameter) not actual output, and (b) checks after execution, a sandwich attack could manipulate the pool BETWEEN the output floor check and the CPI. However, all of this happens within a SINGLE instruction (atomic on Solana), so a sandwich would have to be across different transactions -- which the output floor at 50% prevents. The real concern is that `minimum_output` could be set to just above the 50% floor while the actual execution gets sandwiched down to near-floor levels. This is by design (the 50% floor is the protocol's defense).

### 5. Staking Reward Math (Synthetix/Quarry Pattern)

**Location:** `programs/staking/src/helpers/math.rs:36-100`

**Purpose:** Pro-rata SOL yield distribution to PROFIT stakers.

**How it works:**
- `update_rewards(pool, user)`: Computes `pending = (global_cumulative - user_checkpoint) * balance / PRECISION`. Updates user.rewards_earned and checkpoint.
- `add_to_cumulative(pool)`: Computes `reward_per_token = pending_rewards * PRECISION / total_staked`. Adds to rewards_per_token_stored. Clears pending_rewards.
- PRECISION = 1e18 (u128) for maximum precision in per-token reward accumulation.
- Dead stake (MINIMUM_STAKE=1 PROFIT at init) prevents division by zero and first-depositor attack.

**Assumptions:**
- update_rewards is always called BEFORE any balance change (checkpoint pattern)
- PRECISION (1e18) is sufficient to avoid truncation for expected reward sizes
- pending_rewards accurately reflects SOL deposited to escrow

**Invariants:**
- Sum of all user rewards_earned + (cumulative_delta * balance / PRECISION for all users) <= total deposited rewards
- rewards_per_token_stored only increases
- total_staked > 0 (due to dead stake)

**Concerns:**
- The `as u64` cast at line 50 truncates u128 to u64. For extremely large cumulative values with very large balances, this could theoretically overflow. The maximum pending for a single user is bounded by `u64::MAX * u128::MAX / 1e18` which exceeds u64::MAX. However, in practice, reward amounts are bounded by SOL deposited (~lamport-scale), and balance is bounded by total PROFIT supply (20M tokens * 1e6 = 2e13), so `2e13 * X / 1e18` where X is cumulative delta. For X to cause u64 overflow, it would need to exceed ~9.2e23, which requires depositing more SOL than exists.

### 6. Claim SOL Rewards

**Location:** `programs/staking/src/instructions/claim.rs:78-172`

**Purpose:** Transfer accumulated SOL rewards from escrow to user.

**How it works:**
1. Verify ownership
2. update_rewards to finalize pending
3. Check rewards_earned > 0
4. Check escrow balance >= rewards_to_claim
5. Clear rewards_earned to 0
6. Set cooldown timer (last_claim_ts)
7. Transfer via direct lamport manipulation

**Concerns:**
- **HIGH**: Line 102-103 checks `escrow_balance < rewards_to_claim` but does NOT check `escrow_balance - rewards_to_claim >= rent_exempt_minimum`. If a claim drains the escrow to below rent-exempt, the escrow PDA (which is a 0-byte account) would be garbage-collected by the runtime. This was flagged as S001 in the previous audit and appears **NOT yet fixed**. The escrow is created with `init, space = 0` in initialize_stake_pool.rs, making it rent-exempt at ~890,880 lamports. If the deposit_rewards flow deposits exactly enough for all claims, and the last claim takes everything, the escrow drops to 0 and is destroyed.

### 7. Transfer Hook Whitelist

**Location:** `programs/transfer-hook/src/instructions/transfer_hook.rs:77-179`

**Purpose:** Enforce that at least one party in any CRIME/FRAUD token transfer is whitelisted.

**How it works:**
1. Zero amount check (line 80)
2. Mint owner check -- must be Token-2022 program (defense-in-depth, line 86)
3. Transferring flag check -- prevents direct invocation (line 90)
4. Whitelist check: derive expected PDA for source token account, compare. If not whitelisted, check destination. Short-circuit optimization.

**Assumptions:**
- Token-2022 runtime correctly sets/clears the transferring flag
- PDA derivation for whitelist entries uses correct seeds

**Invariants:**
- No transfer succeeds unless at least one party (source or dest token account) has a WhitelistEntry PDA

**Concerns:**
- None significant. The pattern is correct. The PDA derivation at lines 173-178 uses `Pubkey::find_program_address` which is deterministic and cannot be spoofed.

### 8. Conversion Vault (Fixed-Rate Token Swap)

**Location:** `programs/conversion-vault/src/instructions/convert.rs:60-174`

**Purpose:** 100:1 conversion between CRIME/FRAUD and PROFIT tokens.

**How it works:**
- CRIME/FRAUD -> PROFIT: `amount_in / 100` (integer division, floor)
- PROFIT -> CRIME/FRAUD: `amount_in * 100` (checked_mul)
- Hook accounts split at midpoint for dual Token-2022 transfers

**Concerns:**
- Truncation loss: Converting 199 CRIME yields 1 PROFIT (99 CRIME worth of value lost to truncation). The `out > 0` check prevents zero-output but doesn't prevent significant relative loss.
- No minimum input enforcement beyond `amount_in > 0`. Users converting small amounts lose disproportionate value.

## Trust Model

- **Admin (deployer)**: Trusted during initialization phase only. Burns mint authority, sets up PDAs, funds bonding curves. Post-init, admin retains:
  - Bonding curve: start_curve, prepare_transition, withdraw_graduated_sol, close_token_vault (all gated by curve status)
  - Epoch: force_carnage (testing only)
  - Transfer hook: add_whitelist_entry (until authority burned), burn_authority (irreversible)
- **Protocol PDAs**: swap_authority, tax_authority, staking_authority -- derived via seeds::program, only producible by the correct program. Highest trust level for automated operations.
- **Users**: Untrusted. All inputs validated. Slippage protection on all swap paths. Wallet caps on bonding curve purchases.
- **External Programs**: AMM, Staking, Epoch, Tax -- all validated via hardcoded program IDs or address constraints.

## State Analysis

### Token State
- CRIME, FRAUD: Token-2022 mints with transfer hooks. Supply = 1B each. Mint authority burned.
- PROFIT: Token-2022 mint. Supply = 20M. Mint authority burned.
- All 3 mints use 6 decimals.

### Economic State
- Bonding curve: CurveState tracks tokens_sold, sol_raised, sol_returned, tax_collected per curve
- AMM: PoolState tracks reserve_a, reserve_b, lp_fee_bps per pool
- Staking: StakePool tracks total_staked, rewards_per_token_stored, pending_rewards. UserStake tracks per-user balance, checkpoint, earned.
- Epoch: EpochState tracks current tax rates (dynamic per epoch, 4-14% range)

## Dependencies

- **Token-2022 Program**: All token transfers use transfer_checked with hook forwarding
- **System Program**: Native SOL transfers for tax distribution
- **Switchboard VRF**: Tax rate derivation (via Epoch Program)
- **AMM Program**: Custom constant-product AMM for swap execution

## Focus-Specific Analysis

### Token Flow Diagram

```
[User SOL] --purchase--> [Bonding Curve SOL Vault] --graduate--> [AMM Pool Vault A]
[Bonding Token Vault] --purchase--> [User Token Account]
[User Token Account] --sell--> [Bonding Token Vault]
[Bonding SOL Vault] --sell--> [User SOL] (net) + [Tax Escrow] (15% tax)
[Tax Escrow] --distribute--> [Carnage Fund] (post-graduation)
[Tax Escrow] --consolidate--> [SOL Vault] (pre-refund)

[User SOL] --swap_buy--> [Tax split: 71% Staking Escrow, 24% Carnage, 5% Treasury]
                     +--> [AMM: SOL -> Token] --> [User Token Account]

[User Token Account] --swap_sell--> [AMM: Token -> WSOL] --> [User WSOL]
                                     +--> [Tax from WSOL: 71/24/5 split]

[PROFIT Token] --stake--> [Stake Vault]
[Staking Escrow SOL] --claim--> [User SOL]

[CRIME/FRAUD] <--convert 100:1--> [PROFIT] (via Conversion Vault)
```

### Fee Analysis

| Fee | Formula | Rounding | Who Receives | Can Be Changed? |
|-----|---------|----------|-------------|-----------------|
| Bonding curve sell tax | 15% of gross SOL (SELL_TAX_BPS=1500) | Ceil (protocol-favored) | Tax escrow PDA | No -- compile-time constant |
| AMM LP fee | pool.lp_fee_bps (set at pool init) | Floor | Pool reserves (accrues to LPs) | No -- set at init, no update instruction |
| Swap buy tax | Dynamic 4-14% from EpochState | Floor | 71% staking, 24% carnage, 5% treasury | Only by VRF (per epoch) |
| Swap sell tax | Dynamic 4-14% from EpochState | Floor | Same 71/24/5 split | Only by VRF (per epoch) |
| Conversion fee | None (but truncation loss on CRIME/FRAUD->PROFIT) | Floor | Lost to protocol (stays in vault) | No |

### Economic Invariant List

1. **Total token supply is fixed**: Mint authority burned. No new tokens can be created.
2. **AMM k-invariant**: k_after >= k_before for every swap.
3. **Bonding curve solvency**: SOL vault >= integral(0, tokens_sold) at all times during active phase.
4. **Tax distribution completeness**: staking + carnage + treasury == total_tax (no SOL lost or created).
5. **Staking reward conservation**: Sum of all distributed rewards <= sum of all deposited rewards (floor rounding ensures this).
6. **Refund proportionality**: Each claimer gets floor(balance * pool / total_outstanding). Last claimer gets remaining dust.

### Flash Loan Impact Analysis

- **Bonding curve**: Per-wallet cap (20M tokens) limits single-TX accumulation. No flash loan concern -- the curve takes SOL (can't be flash-loaned easily on Solana).
- **AMM swaps**: Slippage protection (minimum_output >= 50% of expected) + user-specified slippage. Flash loans could manipulate reserves before a user's TX is included, but this is standard MEV surface, mitigated by output floor.
- **Staking**: update_rewards checkpoint before balance change prevents stake-claim-unstake attacks. Cooldown timer on unstake after claim adds further protection.
- **Conversion vault**: Fixed rate (100:1), no oracle dependency. Flash loan irrelevant -- rate doesn't change based on reserves.

### Value Extraction Matrix

| Path | Legitimate | Attack Potential |
|------|-----------|-----------------|
| Swap tax (71/24/5 split) | Revenue to stakers/carnage/treasury | None -- destinations are PDAs |
| AMM LP fees | Accrue to pool reserves | LP extraction requires liquidity removal (no LP tokens in this design) |
| Bonding curve sell tax | 15% to escrow, then carnage/refund | None -- escrow is PDA |
| Staking rewards | SOL yield to PROFIT stakers | Mercenary capital (mitigated by cooldown) |
| Conversion truncation | Vault retains remainder | Users lose up to 99 units per conversion |
| Graduated SOL withdrawal | Admin extracts SOL from graduated curves | Gated by Graduated status only |

## Cross-Focus Intersections

- **Arithmetic**: All token calculations use checked_* with u128 intermediates. Tax math, bonding curve math, and staking math are separate pure-function modules with independent test suites.
- **CPI**: Tax Program -> AMM, Tax Program -> Staking, Epoch -> Staking, Epoch -> Tax. All gated by seeds::program PDA constraints.
- **Access Control**: Permissionless operations (purchase, sell, swap, claim, mark_failed, consolidate, distribute_tax_escrow) vs admin-only (start_curve, prepare_transition, withdraw_graduated_sol, force_carnage).
- **Timing**: Bonding curve deadline, staking cooldown, epoch transitions, carnage expiration.

## Cross-Reference Handoffs

- **-> Arithmetic Agent**: Verify bonding curve math.rs quadratic formula edge cases. Verify `as u64` cast at staking/math.rs:50 cannot truncate.
- **-> CPI Agent**: Verify AMM swap CPI accounts match expected struct layout (raw instruction building at swap_sol_buy.rs:226-268 and swap_sol_sell.rs:156-192).
- **-> Access Control Agent**: Verify prepare_transition requires correct admin. Verify withdraw_graduated_sol admin check. Verify no path to re-mint tokens after authority burn.
- **-> State Machine Agent**: Verify bonding curve state transitions prevent stuck states (e.g., both curves Filled but prepare_transition fails).
- **-> Timing Agent**: Verify MEV surface on swap operations. Output floor of 50% is generous -- sandwich attacks extracting up to 50% of expected output would pass.
- **-> Error Handling Agent**: Verify WSOL intermediary close-reinit failure modes in swap_sol_sell.

## Risk Observations

1. **Sell path AMM slippage=0**: Architectural concern, mitigated by output floor but represents a design smell where the AMM's own slippage protection is bypassed.
2. **Staking escrow rent depletion**: Previous finding S001. Direct lamport subtraction without rent floor check.
3. **Mainnet treasury placeholder**: Pubkey::default() in non-devnet builds would send 5% of all tax to an uncontrolled address.
4. **Conversion vault truncation**: No minimum input size beyond > 0, allowing users to lose significant value.
5. **EpochState cross-program deserialization fragility**: If Epoch Program's EpochState struct layout changes, the Tax Program's mirror deserialization would break silently (wrong tax rates).
6. **Bonding curve solvency check saturating_sub**: Could mask insolvency in extreme edge cases.

## Novel Attack Surface Observations

1. **Dual-curve economic coupling**: The requirement for both CRIME and FRAUD curves to fill creates a coordination game. A strategic attacker could buy one curve to near-full while ignoring the other, then wait for the deadline to force both into refund mode. The attacker gets proportional refunds on the filled curve (minimal loss due to sell tax being in escrow, which is consolidated back), while the market signal of a "failed launch" could be used for off-chain market manipulation (e.g., shorting related assets).

2. **Tax rate gaming around epoch boundaries**: If an attacker can predict VRF outcomes (difficult but not impossible with randomness commitment observations), they could accumulate tokens during high-tax epochs (less trading activity = better prices) and sell during low-tax epochs. The 4-14% tax range limits this to ~10% advantage at most.

3. **WSOL intermediary as DoS vector**: The swap_sol_sell handler destroys and recreates the WSOL intermediary each time. If the swap_authority PDA accumulates extra lamports (e.g., from failed operations), these could leak. Conversely, if swap_authority is drained of lamports below the rent-exempt minimum needed for intermediary recreation, all sell operations halt until someone sends lamports to swap_authority.

## Questions for Other Focus Areas

- **For Arithmetic focus**: Is the bonding curve isqrt() implementation correct for all values in the expected range? What is the maximum error?
- **For CPI focus**: In swap_sol_sell, between closing the WSOL intermediary (line 295-312) and recreating it (line 409-426), is there any risk that another instruction in the same transaction could interfere with the PDA address?
- **For State Machine focus**: Can both bonding curves be in Filled status simultaneously while prepare_transition fails repeatedly? What happens to the SOL in the vaults?
- **For Timing focus**: The bonding curve uses `Clock::get()?.slot` for deadline checks. If the network experiences an outage during the last hours of a curve's deadline, could this unfairly prevent legitimate purchases?
- **For Access Control focus**: The `fund_curve` instruction has no authority check -- any signer can call it with their own tokens. Is this intentional? Could an attacker fund a curve with wrong tokens?

## Raw Notes

### Previous Finding Recheck Results

**H113 CRITICAL: Mint authority retention -- infinite supply risk**
- **Status: RESOLVED**. `initialize.ts:933-960` explicitly burns mint authority for all 3 mints by calling `createSetAuthorityInstruction` with `AuthorityType.MintTokens` and `null` new authority. Idempotent check at line 941 skips if already burned.

**S001 HIGH: Staking escrow rent-exempt accounting**
- **Status: STILL PRESENT**. `claim.rs:102-110` checks `escrow_balance < rewards_to_claim` without subtracting rent-exempt minimum (~890,880 lamports). If all rewards are claimed down to 0, the escrow PDA is destroyed. The `deposit_rewards.rs:99-102` reconciliation check `escrow_vault.lamports() >= pool.pending_rewards` would also not account for rent.

**S010 HIGH: Slippage bypass in buy path**
- **Status: MITIGATED**. `swap_sol_buy.rs:106-111` now enforces `minimum_output >= output_floor` where output_floor is 50% of expected output. This prevents bots from sending minimum_output=0. However, the sell path at `swap_sol_sell.rs:147` still passes `amm_minimum=0` to AMM CPI (mitigated by the same output floor check at lines 112-118 and post-tax slippage at line 245).

### Token-2022 Extension Analysis

The protocol uses Token-2022 with Transfer Hook extension on CRIME and FRAUD mints. Key observations:
- No Transfer Fee extension detected (fees are protocol-level, not mint-level)
- No Permanent Delegate extension (safe)
- No Mint Close Authority extension (safe)
- Transfer hooks enforce whitelist -- all protocol vaults must be whitelisted before operations work
- Token burns (used in claim_refund, carnage) do NOT trigger transfer hooks -- correctly handled in the code

### Tax Distribution Constants Audit

| Constant | Location | Value | Match |
|----------|----------|-------|-------|
| STAKING_BPS | tax-program/constants.rs:18 | 7100 | Matches tax_math.rs:82 |
| CARNAGE_BPS | tax-program/constants.rs:21 | 2400 | Matches tax_math.rs:83 |
| TREASURY_BPS | tax-program/constants.rs:25 | 500 | Not used in calculation (remainder pattern) |
| BPS_DENOMINATOR | tax-program/constants.rs:15 | 10000 | Matches tax_math.rs:84 |
| MINIMUM_OUTPUT_FLOOR_BPS | tax-program/constants.rs:40 | 5000 | Used in both buy and sell paths |
