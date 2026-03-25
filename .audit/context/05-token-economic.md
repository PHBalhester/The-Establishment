---
task_id: sos-phase1-token-economic
provides: [token-economic-findings, token-economic-invariants]
focus_area: token-economic
files_analyzed: [tax-program/src/instructions/swap_sol_buy.rs, tax-program/src/instructions/swap_sol_sell.rs, tax-program/src/helpers/tax_math.rs, tax-program/src/helpers/pool_reader.rs, tax-program/src/constants.rs, amm/src/instructions/swap_sol_pool.rs, amm/src/helpers/math.rs, amm/src/helpers/transfers.rs, amm/src/state/pool.rs, epoch-program/src/helpers/carnage_execution.rs, epoch-program/src/helpers/carnage.rs, epoch-program/src/state/carnage_fund_state.rs, staking/src/instructions/stake.rs, staking/src/instructions/unstake.rs, staking/src/instructions/claim.rs, staking/src/instructions/deposit_rewards.rs, staking/src/helpers/math.rs, bonding_curve/src/instructions/purchase.rs, bonding_curve/src/instructions/sell.rs, bonding_curve/src/instructions/distribute_tax_escrow.rs, bonding_curve/src/math.rs, conversion-vault/src/instructions/convert.rs, transfer-hook/src/instructions/transfer_hook.rs]
finding_count: 14
severity_breakdown: {critical: 0, high: 3, medium: 6, low: 5}
---
<!-- CONDENSED_SUMMARY_START -->
# Token & Economic — Condensed Summary

## Key Findings (Top 10)

1. **Treasury pubkey issue resolved**: The non-devnet, non-localnet build of `treasury_pubkey()` now returns the mainnet treasury `3ihhw...`, not the devnet deployer wallet. Previous HOT_SPOTS flagged this as CRITICAL but the code has been updated. — `tax-program/src/constants.rs:146-149`
2. **Sell-side minimum_output checked AFTER tax creates user confusion**: `swap_sol_sell.rs` checks `net_output >= minimum_output` (line 265) where net_output = gross_output - tax. Users must factor in tax when setting minimum_output, but the gross floor calculation (lines 150-167) converts minimum_output back to a gross amount for AMM slippage. This is correct but complex — the two-step slippage (pre-CPI floor + post-CPI net check) creates an asymmetric mental model. — `swap_sol_sell.rs:113-117,265`
3. **Carnage Fund slippage floors differ between atomic (85%) and fallback (75%)**: The fallback path accepts 25% worse pricing than expected. Combined with permissionless execution, a MEV actor could time Carnage executions to maximize extraction from the 75% tolerance window. VRF provides some protection but not against same-block manipulation. — `carnage_execution.rs:324-350`
4. **Bonding curve sell tax uses ceil rounding (protocol-favored)**: `sell.rs:192-197` computes tax with ceil division. This is intentional and documented, ensuring the protocol never under-collects tax. The maximum rounding penalty is 1 lamport per sell. — `bonding_curve/src/instructions/sell.rs:192-197`
5. **Staking escrow solvency check uses `>=` comparison of pending_rewards against live balance**: `deposit_rewards.rs:100` checks `escrow_vault.lamports() >= pool.pending_rewards`. If pending_rewards is incremented but the preceding SOL transfer failed (which would mean the lamports check fails), this correctly catches the inconsistency. Solid reconciliation pattern. — `staking/src/instructions/deposit_rewards.rs:99-102`
6. **Conversion vault uses integer division for CRIME/FRAUD to PROFIT (100:1)**: Remainder tokens are lost. `compute_output_with_mints` (line 103) does `amount_in / CONVERSION_RATE` with no remainder tracking. The `OutputTooSmall` guard (line 104) rejects dust conversions. Acceptable by design. — `conversion-vault/src/instructions/convert.rs:101-105`
7. **Tax distribution micro-tax edge case routes <4 lamports entirely to staking**: `split_distribution` (line 88-90) sends all tax to staking when total_tax < 4. This means Carnage Fund and Treasury receive nothing on micro-transactions. Economically negligible but worth noting for completeness. — `tax-program/src/helpers/tax_math.rs:88-90`
8. **AMM k-invariant check uses u128 but does not protect against u128 overflow on extreme reserves**: `verify_k_invariant` (line 98-102) computes `reserve_in * reserve_out` in u128. With max reserves near u64::MAX, the product fits (verified: (2^64-1)^2 < 2^128-1). The checked_mul handles edge cases. — `amm/src/helpers/math.rs:92-103`
9. **Pool reader raw byte offsets (137/145) are brittle across AMM upgrades**: `read_pool_reserves` hardcodes byte offsets for PoolState. If AMM's `PoolState` struct changes field order, tax calculations silently read wrong values. No version check or discriminator validation beyond AMM owner check. — `tax-program/src/helpers/pool_reader.rs:79-88`
10. **Bonding curve solvency assertion may have cumulative rounding dust**: `sell.rs:316-322` checks vault balance >= integral value of tokens_sold, but the integral uses ceil rounding for buys and the vault balance includes all purchase SOL. Cumulative sell-side ceil rounding plus buy-side floor rounding creates a net protocol-favorable gap. The `SOLVENCY_BUFFER_LAMPORTS` absorbs this. — `bonding_curve/src/instructions/sell.rs:181-184`

## Critical Mechanisms

- **Tax Distribution Pipeline (71/24/5)**: Buy path deducts tax from SOL input before AMM swap; sell path deducts tax from WSOL output after AMM swap. Split: 71% staking escrow, 24% Carnage SOL vault, 5% treasury. Treasury address is hardcoded per build feature. All transfers use `invoke_signed` with System Program CPI (buy) or WSOL intermediary close-and-reinit cycle (sell). Sum invariant: staking + carnage + treasury == total_tax, enforced by remainder-to-treasury pattern. — `swap_sol_buy.rs:116-210`, `swap_sol_sell.rs:270-471`

- **AMM Constant-Product Swap**: `calculate_swap_output` uses `reserve_out * effective_input / (reserve_in + effective_input)` in u128. LP fee (100 bps / 1%) deducted before output calculation via `calculate_effective_input`. Fee stays in pool (accrues to reserves). k-invariant verified post-swap: `k_after >= k_before`. Reentrancy guard (locked bool) set before computation, cleared after transfers. — `amm/src/helpers/math.rs:36-103`, `swap_sol_pool.rs:84-334`

- **Carnage Fund Execution**: VRF-triggered (~4.3% per epoch). Three actions: BuyOnly (no holdings), Burn (98% when holdings exist), Sell (2% when holdings exist). Executes through Tax::swap_exempt (tax-free). Slippage floor: 85% atomic, 75% fallback. SOL capped at MAX_CARNAGE_SWAP_LAMPORTS. Token burn via manual `invoke_signed` with raw `8u8` discriminator. — `carnage_execution.rs:134-399`

- **Staking Reward Distribution (Synthetix/Quarry)**: Cumulative reward-per-token stored in u128 with PRECISION=1e18 scaling. `update_rewards` checkpoints user before any balance change (flash loan protection). `add_to_cumulative` distributes pending SOL rewards pro-rata. Dead stake (1 PROFIT) prevents first-depositor attack. Claims transfer SOL from escrow via direct lamport manipulation with rent-exempt guard. — `staking/src/helpers/math.rs:43-87`, `claim.rs:99-162`

- **Bonding Curve Linear Pricing**: P(x) = P_START + (P_END - P_START) * x / TOTAL_FOR_SALE. Buy uses quadratic formula (floor rounding, protocol-favored). Sell uses reverse integral (ceil rounding on tax, protocol-favored). 15% sell tax routed to escrow. Solvency assertion post-sell. Wallet cap 50 SOL cumulative. — `bonding_curve/src/math.rs:56-193`, `purchase.rs:97-331`, `sell.rs:111-349`

## Invariants & Assumptions

- INVARIANT: `staking_portion + carnage_portion + treasury_portion == total_tax` — enforced at `tax_math.rs:105-107` via remainder-to-treasury pattern
- INVARIANT: AMM k_after >= k_before for every swap — enforced at `swap_sol_pool.rs:171-173` via `verify_k_invariant`
- INVARIANT: AMM swap output < reserve_out (cannot drain pool in one swap) — enforced by constant-product formula at `math.rs:66-75`
- INVARIANT: Bonding curve vault balance >= integral(tokens_sold) minus rent-exempt — enforced at `sell.rs:319-322` post-state check
- INVARIANT: Staking escrow lamports >= pending_rewards — enforced at `deposit_rewards.rs:99-102` reconciliation check
- INVARIANT: User wallet cap <= MAX_TOKENS_PER_WALLET on bonding curve — enforced at `purchase.rs:135-141` and re-checked at line 176-182

- ASSUMPTION: EpochState owned by Epoch Program provides valid tax rates — validated at `swap_sol_buy.rs:60-63` and `swap_sol_sell.rs:74-78` via owner check
- ASSUMPTION: PoolState byte layout at offsets 137/145 matches AMM struct — NOT VALIDATED beyond owner check; silent corruption if layout changes
- ASSUMPTION: WSOL intermediary will have sufficient rent lamports for reinit after close — depends on swap_authority retaining rent from close_account; if swap_authority is drained between close and create, reinit fails
- ASSUMPTION: Token-2022 Transfer Hook program correctly validates hook accounts — delegated to Token-2022 runtime; no per-account validation in application code
- ASSUMPTION: Switchboard VRF provides unbiased randomness for tax rate and Carnage determination — single oracle trust point

## Risk Observations (Prioritized)

1. **Carnage fallback 75% slippage tolerance**: `carnage_execution.rs:324-350` — A sophisticated attacker who can manipulate pool reserves before Carnage execution could extract up to 25% of the Carnage swap value. The VRF makes timing unpredictable, but the fallback path runs after the atomic lock window expires, giving attackers a known execution window.

2. **Raw byte offset pool reader brittleness**: `pool_reader.rs:79-88` — If the AMM program is upgraded and PoolState layout changes, the Tax Program silently reads wrong reserve values. This affects both the output floor calculation and the sell-side gross floor computation. No version field or struct hash is checked.

3. **Sell-side tax deduction from user WSOL after swap**: `swap_sol_sell.rs:289-310` — Tax WSOL is transferred from user's token account using raw SPL discriminator `3u8`. If the WSOL account has a delegate with remaining allowance, the delegate could theoretically complete this transfer. In practice, the user is the signer and authority, but the raw transfer instruction does not explicitly enforce the authority match (Token Program does).

4. **Conversion vault lacks rate limit or cooldown**: `convert.rs:116-174` — No limit on conversion frequency or volume. If vault is funded with limited PROFIT tokens and a user rapidly converts large amounts of CRIME/FRAUD, they could drain the vault's PROFIT supply before other users can convert.

5. **Staking claim uses direct lamport manipulation**: `claim.rs:150-162` — SOL transferred from escrow to user via `try_borrow_mut_lamports`. This is a valid Solana pattern for program-owned accounts, but any same-transaction instruction that reads the user's lamport balance before the claim will see stale data. Not exploitable given claim is the terminal operation.

## Novel Attack Surface

- **Cross-epoch tax rate manipulation via EpochState deserialization**: The Tax Program reads EpochState from raw bytes, but only checks the owner is the Epoch Program. If an attacker could cause the Epoch Program to write a malformed EpochState (e.g., via a bug in consume_randomness), the Tax Program would apply the wrong tax rate. The deserialization validates the discriminator, but the `get_tax_bps` function's logic depends on fields like `cheap_side` and tax rate values being within expected bounds. There is no explicit range check on `tax_bps` in the Tax Program — that validation is delegated entirely to the Epoch Program's VRF derivation logic.

- **Carnage Fund held_token as raw u8 creates implicit trust**: `carnage_execution.rs:183-186` uses `held_token == 1` for CRIME and else for FRAUD. If `held_token` were somehow set to an unexpected value (e.g., 0 or 3), the else branch defaults to FRAUD operations, potentially burning from the wrong vault or selling the wrong token. The enum `Token::from_u8` in the action/target paths has validation, but `held_token` in the burn selection does not use this enum parser.

- **Sell-then-buy within same Carnage execution can compound slippage**: When Carnage sells held tokens first (2% probability), the sell pushes the token price down. The subsequent buy in the same instruction benefits from the now-lower price but the slippage floor is calculated independently. An observer who front-runs with a buy before Carnage sells would profit from the spread.

## Cross-Focus Handoffs

- **Arithmetic Agent**: Verify all `as u64` truncating casts in `carnage_execution.rs:338,344` and `bonding_curve/math.rs:104,109,192`. The u64::try_from guards exist but some paths use raw `as u64`.
- **Arithmetic Agent**: Verify `calculate_output_floor` in `tax_math.rs:141-165` cannot overflow at u64::MAX-scale inputs (the u128 intermediate should prevent this, but confirm).
- **Oracle Agent**: Verify EpochState `get_tax_bps` returns values in [0, 10000] range — Tax Program's `calculate_tax` rejects >10000 but the Tax Program itself does not range-check before calling it.
- **Access Control Agent**: Verify `swap_exempt` instruction in Tax Program properly validates caller is Epoch Program's carnage_signer PDA.
- **State Machine Agent**: Verify Carnage state transitions (Idle -> Triggered -> Executed/Expired) cannot be bypassed to trigger multiple Carnage executions per epoch.
- **Timing Agent**: Verify `expire_carnage` timeout cannot be called prematurely to skip Carnage execution.

## Trust Boundaries

The protocol has three trust tiers: (1) **Trusted programs** — AMM, Tax, Epoch, Staking, Bonding Curve, Transfer Hook, Conversion Vault are all protocol-owned and cross-validate via hardcoded program IDs and PDA seeds. Inter-program trust is established by `address =` constraints and `seeds::program` derivation. (2) **Semi-trusted external** — Switchboard VRF oracle provides randomness; trusted to not be malicious but freshness and staleness are checked. (3) **Untrusted** — User inputs (amounts, minimum_output, is_crime flag, remaining_accounts). Users can set any minimum_output but the 50% output floor prevents zero-slippage sandwich attacks. remaining_accounts are forwarded to Token-2022 without per-account validation; Token-2022 and Transfer Hook validate them internally.
<!-- CONDENSED_SUMMARY_END -->

---

# Token & Economic — Full Analysis

## Executive Summary

The Dr. Fraudsworth protocol implements a multi-token economic system with three tokens (CRIME, FRAUD as Token-2022 with transfer hooks, PROFIT as Token-2022), a custom CPMM AMM, asymmetric buy/sell taxation, VRF-driven Carnage Fund rebalancing, Synthetix-style staking rewards, a linear bonding curve for price discovery, and a fixed-rate conversion vault. The token flow is complex but well-structured with consistent patterns: checked arithmetic throughout, CEI ordering, PDA-based authorization, and defense-in-depth guards.

The economic model's key safety properties hold under analysis: the AMM's k-invariant is enforced, tax distribution sums are invariant, staking rewards use proper checkpoint patterns, and the bonding curve has solvency assertions. The primary economic risks are (1) the Carnage Fund's slippage tolerance creating extraction windows, (2) raw byte offset dependencies between programs creating silent corruption risk on upgrades, and (3) the complexity of the sell-side WSOL intermediary flow introducing operational fragility.

No critical token drainage vulnerabilities were identified. The token transfer patterns are correct: Token-2022 transfers use `transfer_checked` with hook account forwarding via manual `invoke_signed`, SPL transfers use Anchor's CPI framework, and burn operations use the correct authority (carnage_state PDA). The Transfer Hook enforces whitelist requirements, preventing unauthorized transfers.

## Scope

- **Files analyzed (full source read):** 23 files across 7 programs
- **Functions analyzed:** ~45 instruction handlers and helper functions
- **Estimated coverage:** ~90% of TOKEN-tagged code, ~80% of economic logic

### Files Analyzed

| File | Layer | Notes |
|------|-------|-------|
| `tax-program/src/instructions/swap_sol_buy.rs` | 3 (full) | Buy tax flow |
| `tax-program/src/instructions/swap_sol_sell.rs` | 3 (full) | Sell tax flow, WSOL intermediary |
| `tax-program/src/helpers/tax_math.rs` | 3 (full) | Tax calculation, distribution split, output floor |
| `tax-program/src/helpers/pool_reader.rs` | 3 (full) | Raw byte pool reserve reading |
| `tax-program/src/constants.rs` | 3 (full) | Program IDs, seeds, treasury pubkey |
| `amm/src/instructions/swap_sol_pool.rs` | 3 (full) | AMM swap handler |
| `amm/src/helpers/math.rs` | 3 (full) | Swap math, k-invariant |
| `amm/src/helpers/transfers.rs` | 3 (full) | Token transfer helpers |
| `amm/src/state/pool.rs` | 2 (sigs) | PoolState struct |
| `epoch-program/src/helpers/carnage_execution.rs` | 3 (full) | Carnage core logic |
| `epoch-program/src/helpers/carnage.rs` | 3 (full) | VRF byte interpretation |
| `epoch-program/src/state/carnage_fund_state.rs` | 2 (sigs) | CarnageFundState struct |
| `staking/src/instructions/stake.rs` | 3 (full) | Stake PROFIT handler |
| `staking/src/instructions/unstake.rs` | 2 (sigs) | Unstake handler |
| `staking/src/instructions/claim.rs` | 3 (full) | Claim SOL rewards |
| `staking/src/instructions/deposit_rewards.rs` | 3 (full) | Tax -> Staking CPI target |
| `staking/src/helpers/math.rs` | 3 (full, lines 1-120) | Reward math |
| `bonding_curve/src/instructions/purchase.rs` | 3 (full) | Buy from curve |
| `bonding_curve/src/instructions/sell.rs` | 3 (full) | Sell back to curve |
| `bonding_curve/src/instructions/distribute_tax_escrow.rs` | 3 (full) | Escrow to Carnage |
| `bonding_curve/src/math.rs` | 3 (full, lines 1-200) | Linear pricing math |
| `conversion-vault/src/instructions/convert.rs` | 3 (full) | Fixed-rate conversion |
| `transfer-hook/src/instructions/transfer_hook.rs` | 3 (full) | Whitelist enforcement |

## Key Mechanisms

### 1. Tax Distribution Pipeline

**Location:** `tax-program/src/instructions/swap_sol_buy.rs:47-343`, `swap_sol_sell.rs:62-497`, `tax_math.rs:34-165`

**Purpose:** Apply dynamic tax rates (3-14% range, VRF-determined per epoch) to all swap transactions, distributing revenue to staking (71%), Carnage Fund (24%), and treasury (5%).

**How it works:**

**Buy Path (swap_sol_buy):**
1. Lines 59-78: Read EpochState with owner check (must be Epoch Program), discriminator validation, initialized flag check. Calls `get_tax_bps(is_crime, true)` for buy direction.
2. Lines 83-84: Calculate tax = amount_in * tax_bps / 10000 via `calculate_tax` (u128 intermediate).
3. Lines 89-91: Calculate sol_to_swap = amount_in - tax. Check > 0.
4. Lines 105-111: Calculate output floor from pool reserves. Read reserves via `read_pool_reserves` (raw byte offsets). Floor = 50% of expected constant-product output. Require `minimum_output >= output_floor`.
5. Lines 116-118: Split tax into (staking, carnage, treasury) via `split_distribution`.
6. Lines 126-209: Execute three System Program transfers (user -> staking_escrow, user -> carnage_vault, user -> treasury). If staking_portion > 0, also CPI to Staking::deposit_rewards.
7. Lines 256-308: Build AMM CPI with swap_authority PDA signing. Forward remaining_accounts for hooks.
8. Lines 317-320: Reload user_token_b after CPI, compute tokens_received via balance diff.

**Sell Path (swap_sol_sell):**
1. Lines 74-93: Same EpochState validation as buy, but `get_tax_bps(is_crime, false)` for sell direction.
2. Lines 98: Snapshot user's WSOL balance before swap.
3. Lines 112-117: Calculate output floor for sell direction (reserve_in=token, reserve_out=SOL).
4. Lines 127-235: Execute AMM CPI (BtoA direction). `amm_minimum` is computed as gross floor = ceil(minimum_output * 10000 / (10000 - tax_bps)) — this ensures AMM enforces a gross output that after tax still satisfies user's minimum.
5. Lines 240-245: Reload user_token_a. Compute gross_output = wsol_after - wsol_before.
6. Lines 250: Calculate tax = gross_output * sell_tax_bps / 10000.
7. Lines 258-265: Compute net_output = gross_output - tax. Check > 0, check >= minimum_output.
8. Lines 289-310: Transfer tax WSOL from user to intermediary (raw SPL discriminator 3u8).
9. Lines 315-332: Close intermediary to swap_authority (unwrap WSOL to SOL).
10. Lines 338-418: Distribute native SOL from swap_authority to three destinations.
11. Lines 424-471: Recreate and reinitialize intermediary for next sell.

**Assumptions:**
- EpochState is always available and correctly initialized
- Tax rates from EpochState are in valid BPS range [0, 10000]
- Pool reserves read from raw bytes match actual AMM state
- swap_authority PDA has sufficient lamports to fund intermediary reinit after close

**Invariants:**
- staking + carnage + treasury == total_tax (remainder-to-treasury pattern)
- sol_to_swap > 0 after tax deduction (checked at line 94)
- net_output > 0 after sell tax (checked at line 263)
- minimum_output >= 50% of expected output (floor check)

**Concerns:**
- Line 297: Raw SPL discriminator `3u8` for Transfer instruction. If SPL Token changes instruction encoding, this breaks silently. Extremely unlikely but fragile.
- Lines 424-471: Intermediary close-reinit cycle is complex. If any step fails, the intermediary PDA is in an inconsistent state. Subsequent sells would fail (but safely — they'd error on the intermediary account constraint).
- Buy path distributes tax from user's SOL (user signs system transfers). Sell path distributes from swap_authority's SOL (PDA signs after WSOL unwrap). Different patterns for the same economic operation.

### 2. AMM Constant-Product Swap

**Location:** `amm/src/instructions/swap_sol_pool.rs:57-354`, `amm/src/helpers/math.rs:36-131`

**Purpose:** Execute token swaps using x*y=k formula with LP fee deduction.

**How it works:**
1. Lines 70-77: Capture immutable pool values before mutations (RefCell borrow conflict avoidance).
2. Line 84: Set reentrancy guard (locked = true). Constraint `!pool.locked` checked at deserialization.
3. Lines 92-122: Direction-based account selection (AtoB or BtoA).
4. Lines 125-126: `calculate_effective_input` = amount_in * (10000 - fee_bps) / 10000. LP fee stays in pool.
5. Lines 135-136: `calculate_swap_output` = reserve_out * effective_input / (reserve_in + effective_input). Integer division truncates (dust stays in pool).
6. Lines 145-148: Slippage check: amount_out >= minimum_amount_out.
7. Lines 163-168: New reserves: reserve_in += amount_in (pre-fee), reserve_out -= amount_out.
8. Lines 171-173: k-invariant check: k_after >= k_before (u128 multiplication).
9. Lines 176-185: Write new reserves to pool state.
10. Lines 222-327: Direction-aware token transfers. T22 path uses manual invoke_signed with hook accounts; SPL path uses Anchor CPI.
11. Line 334: Clear reentrancy guard.

**Assumptions:**
- Pool reserves are non-zero at swap time (guarded by PoolNotInitialized constraint)
- LP fee BPS is in valid range (MAX_LP_FEE_BPS = 500 enforced at pool init)
- Token transfer amounts match swap math (Token-2022 transfer_checked validates this)

**Invariants:**
- k_after >= k_before (fundamental AMM safety property)
- output < reserve_out (cannot drain pool; guaranteed by constant-product formula)
- effective_input > 0 when amount_in > 0 (ZeroEffectiveInput check)
- amount_out > 0 when effective_input > 0 (ZeroSwapOutput check)

**Concerns:**
- swap_authority is validated as PDA from TAX_PROGRAM_ID (line 382). Only Tax Program can initiate swaps. This is correct access control but means users cannot swap directly through AMM — all swaps go through Tax Program (or swap_exempt for Carnage).
- remaining_accounts are forwarded to both input and output transfers. For SOL pools (one side is WSOL/SPL, other is T22), the non-T22 side ignores extra accounts. For PROFIT pools (both T22), caller must pre-partition. This is documented and correct but error-prone for new pool types.

### 3. Carnage Fund Execution

**Location:** `epoch-program/src/helpers/carnage_execution.rs:134-399`, `carnage.rs:25-64`

**Purpose:** VRF-triggered rebalancing that burns, sells, or buys tokens to create market dynamics.

**How it works:**
1. Lines 145-148: Read pending action (Burn/Sell/None) and target (Crime/Fraud) from EpochState.
2. Lines 169-175: Partition remaining_accounts into sell/buy hook account slices.
3. Lines 178-245: Handle existing holdings — Burn (98%): burn via manual instruction with `8u8` discriminator and carnage_state PDA as authority. Sell (2%): approve delegate, execute sell swap via Tax::swap_exempt, measure WSOL received.
4. Lines 258-355: Buy target token — Calculate available SOL, combine with sell proceeds, wrap to WSOL, execute buy swap, measure tokens received, enforce slippage floor.
5. Lines 357-398: Update carnage state (held_token, held_amount, statistics), clear epoch pending flags, emit event.

**Assumptions:**
- VRF provides unpredictable trigger timing (Switchboard oracle trust)
- MAX_CARNAGE_SWAP_LAMPORTS caps single execution (prevents draining entire SOL vault)
- Carnage state transitions are enforced by calling instruction (Triggered check)

**Invariants:**
- Total buy amount capped at MAX_CARNAGE_SWAP_LAMPORTS
- Slippage floor enforced: bought >= expected * slippage_bps / 10000
- SOL vault retains rent-exempt minimum (line 264: saturating_sub)

**Concerns:**
- Lines 183-186: held_token matched as raw u8 (1=CRIME, else=FRAUD) without exhaustive validation. If held_token is 0 or 3, the else branch selects FRAUD, potentially burning from wrong vault. However, held_token is only ever set to `target.to_u8() + 1` (line 359), which produces 1 or 2. A corrupted held_token value is only possible via memory corruption or state deserialization bug.
- Line 270-273: total_buy_amount combines swap_amount + sol_from_sale, capped at MAX. If sell proceeds are very large, the cap prevents overspending but leaves excess WSOL in carnage_wsol. This WSOL would persist and be available for the next Carnage execution — not lost, but potentially unexpected.
- Lines 331-350: Slippage check skipped when reserve_sol == 0 or reserve_token == 0. In a fully drained pool, Carnage would buy at whatever price the pool offers (or fail due to zero output from AMM).

### 4. Staking Reward Distribution

**Location:** `staking/src/helpers/math.rs:43-120`, `claim.rs:79-182`, `deposit_rewards.rs:83-119`

**Purpose:** Distribute 71% of tax revenue as SOL yield to PROFIT stakers.

**How it works:**
- **Deposit (Tax -> Staking):** Tax Program transfers SOL to escrow via system_instruction::transfer, then CPIs to deposit_rewards. deposit_rewards increments pending_rewards counter and reconciles against escrow balance.
- **Distribution (Epoch -> Staking):** Epoch Program CPIs update_cumulative at epoch end. `add_to_cumulative` converts pending_rewards to reward-per-token: `pending * PRECISION / total_staked`.
- **Claim:** User calls claim. `update_rewards` computes pending = (global_cumulative - user_checkpoint) * balance / PRECISION. SOL transferred from escrow via direct lamport manipulation. Rent-exempt guard prevents escrow destruction.

**Assumptions:**
- PRECISION = 1e18 provides sufficient precision for reward calculations
- pending_rewards is always backed by actual SOL in escrow (reconciliation check)
- total_staked > 0 when distributing (MINIMUM_STAKE dead stake prevents zero case)

**Invariants:**
- Sum of all user claims <= total deposited SOL (floor rounding ensures this)
- User checkpoint updated to current global (prevents double-claiming)
- Escrow balance >= pending_rewards (reconciliation check)
- Escrow retains rent-exempt minimum after claims

**Concerns:**
- `update_rewards` line 84: Clock::get()?.slot in a helper function. This means the function cannot be tested without Solana runtime. Not a security issue but affects testability.
- Overflow safety (BOK Finding): checked_mul handles u128 overflow gracefully at extreme protocol scales (~century of continuous operation). In practice, protocol bounds prevent this.

### 5. Bonding Curve Token Sale

**Location:** `bonding_curve/src/math.rs:56-193`, `purchase.rs:97-331`, `sell.rs:111-349`

**Purpose:** Linear price discovery for CRIME and FRAUD tokens with 15% sell-back tax.

**How it works:**
- **Purchase:** Quadratic formula determines tokens_out for given SOL. Wallet cap (50 SOL cumulative) enforced. Partial fills handled with SOL recalculation. Token transfer via manual invoke_signed with hook accounts.
- **Sell:** Reverse integral determines gross SOL. Ceil-rounded 15% tax. Direct lamport manipulation for SOL payout and tax routing. Post-state solvency assertion.

**Assumptions:**
- P_START=450, P_END=1725 in lamports per human token are economically sound
- TOTAL_FOR_SALE matches actual tokens funded to vault
- All tokens in vault are available for purchase (no locking mechanism)

**Invariants:**
- vault balance >= integral(tokens_sold) - rent_exempt (post-sell solvency)
- actual_sol <= sol_amount (user never overcharged)
- tokens_sold <= TARGET_TOKENS (supply cap)
- Wallet cap: user_balance + tokens_out <= MAX_TOKENS_PER_WALLET

**Concerns:**
- `sell.rs:271-272`: Direct lamport manipulation (`**sol_vault.try_borrow_mut_lamports()? -= sol_net`). This is correct for program-owned accounts but the subtract-then-add pattern is not atomic at the lamport level — between the two operations, the account balances are temporarily inconsistent. However, Solana's instruction atomicity ensures this is safe (if any step fails, the entire instruction reverts).
- `sell.rs:316`: Post-state solvency check uses `saturating_sub(rent_exempt_min as u64)` which is redundant (`rent_exempt_min` is already u64 from Rent::get()). Not a bug, just unnecessary cast.

### 6. Conversion Vault

**Location:** `conversion-vault/src/instructions/convert.rs:60-174`

**Purpose:** Fixed-rate 100:1 conversion between CRIME/FRAUD and PROFIT tokens.

**How it works:**
1. Compute output amount: CRIME/FRAUD -> PROFIT = amount / 100; PROFIT -> CRIME/FRAUD = amount * 100.
2. Split remaining_accounts at midpoint for dual-hook support.
3. Transfer input tokens from user to vault.
4. Transfer output tokens from vault to user.

**Assumptions:**
- Vault has sufficient output tokens for all conversions
- 100:1 rate is fixed and immutable (no dynamic adjustment)
- Both transfers succeed atomically

**Invariants:**
- amount_out > 0 (OutputTooSmall guard for division path)
- amount_in > 0 (ZeroAmount guard)
- input_mint != output_mint (SameMint guard)

**Concerns:**
- No rate limit or daily cap. A single user could drain the vault's PROFIT supply.
- PROFIT -> CRIME/FRAUD path uses checked_mul, correctly preventing u64 overflow.
- Vault token accounts validated via `token::authority = vault_config` and `token::mint = input_mint/output_mint`. Sound validation.
- remaining_accounts split at midpoint (line 141): If total count is odd, the output side gets one fewer account. For 8 accounts (4+4), this works correctly. For 0 accounts, both sides are empty (would fail on T22 transfer).

### 7. Transfer Hook Whitelist

**Location:** `transfer-hook/src/instructions/transfer_hook.rs:77-179`

**Purpose:** Enforce that at least one party (source or destination) in any CRIME/FRAUD/PROFIT transfer is whitelisted.

**How it works:**
1. Zero amount rejection.
2. Mint owner check (must be Token-2022).
3. Transferring flag check (prevents direct invocation attack).
4. PDA derivation check for whitelist entries (existence-based pattern).

**Assumptions:**
- All protocol PDAs (pools, vaults, user ATAs in protocol interactions) are whitelisted
- WhitelistAuthority is not burned (allows adding new entries for new protocol addresses)

**Invariants:**
- source OR destination must be whitelisted (disjunction, not conjunction)
- PDA derivation is verified (prevents spoofed whitelist accounts)
- Only callable from Token-2022 transfer context (transferring flag)

**Concerns:**
- `is_whitelisted` (line 166-178): Uses `data_is_empty()` as existence check. If a whitelist PDA is closed (lamports drained), `data_is_empty()` returns true and the check fails. Since whitelist entries are Anchor `init` accounts, they cannot be closed without a `close` instruction (which doesn't exist in the hook program). Safe by omission.
- Short-circuit optimization (line 101-108): Source checked first. If source is whitelisted, destination is not checked. This is correct — the spec requires only one party to be whitelisted.

## Trust Model

**Fully Trusted:**
- All 7 protocol programs trust each other via hardcoded program IDs and PDA seeds
- Admin/authority PDAs (currently held by devnet wallet, planned for Squads multisig)
- Genesis constants (tax rates, fee BPS, conversion rates, pricing parameters)

**Semi-Trusted:**
- Switchboard VRF oracle: trusted for randomness, but freshness/staleness checks exist
- Token-2022 runtime: trusted to correctly invoke Transfer Hook and enforce transfer_checked semantics

**Untrusted:**
- User inputs: amounts, minimum_output, is_crime flag, remaining_accounts
- User accounts: token accounts, wallets (validated by Token Program during transfers)
- External programs: only protocol-owned programs are called; no arbitrary external CPI

**Trust Boundaries:**
1. Tax Program -> AMM: swap_authority PDA ensures only Tax Program can initiate swaps
2. Tax Program -> Staking: tax_authority PDA ensures only Tax Program can deposit rewards
3. Epoch Program -> Tax: carnage_signer PDA ensures only Epoch Program calls swap_exempt
4. Epoch Program -> Staking: CPI validation in update_cumulative
5. User -> Any program: Standard signer validation, amount validation, slippage checks

## State Analysis

**Read state:**
- EpochState: tax rates, Carnage state, epoch number (read by Tax Program via raw bytes)
- PoolState: reserves, mints, fee BPS (read by Tax Program via raw bytes, read by AMM directly)
- StakePool: rewards_per_token_stored, total_staked, pending_rewards
- CurveState: tokens_sold, sol_raised, status, deadline
- CarnageFundState: held_token, held_amount, total_sol_spent

**Written state:**
- PoolState: reserve_a, reserve_b, locked (written by AMM during swap)
- StakePool: pending_rewards (by deposit_rewards), rewards_per_token_stored (by update_cumulative), total_staked (by stake/unstake), total_claimed (by claim)
- UserStake: staked_balance, rewards_earned, rewards_per_token_paid, last_claim_ts
- CurveState: tokens_sold, sol_raised, status, sol_returned, tokens_returned, tax_collected
- CarnageFundState: held_token, held_amount, total_sol_spent, total_triggers
- EpochState: carnage_pending, carnage_action, last_carnage_epoch

## Dependencies

**External crates:**
- `anchor_lang` (0.32.x): Account framework, PDA derivation, constraint validation
- `anchor_spl`: Token interface types (InterfaceAccount, Interface)
- `spl_token_2022`: Instruction builders (transfer_checked), extensions (TransferHookAccount)
- `spl_token`: SPL Token program ID

**Cross-program:**
- Tax -> AMM (swap_sol_pool via CPI)
- Tax -> Staking (deposit_rewards via CPI)
- Epoch -> Tax (swap_exempt via CPI)
- Epoch -> Staking (update_cumulative via CPI)
- Token-2022 -> Transfer Hook (transfer_hook via CPI)

## Focus-Specific Analysis

### Token Flow Diagram

```
                     USER
                    /    \
          SOL (buy) |    | TOKEN (sell)
                    v    v
              TAX PROGRAM
             /     |     \
        71% SOL  24% SOL  5% SOL
            |      |       |
      STAKING  CARNAGE  TREASURY
      ESCROW   SOL VAULT  WALLET
            |
            v
      [deposit_rewards CPI]
            |
            v
      STAKING POOL
      (pending_rewards++)
            |
            v      (at epoch end)
      [update_cumulative CPI]
            |
            v
      rewards_per_token_stored++
            |
            v      (user claims)
      ESCROW -> USER (SOL lamports)

              TAX PROGRAM
                   |
            [swap_authority PDA signs]
                   |
                   v
              AMM PROGRAM
             /            \
     SOL VAULT        TOKEN VAULT
     (reserve_a)      (reserve_b)
         ^                 |
         |    (transfer)   |
     USER_TOKEN_A    USER_TOKEN_B
         (WSOL)      (CRIME/FRAUD)

              CARNAGE FUND
                   |
            [carnage_signer PDA signs]
                   |
                   v
           TAX::swap_exempt
                   |
                   v
              AMM::swap
                   |
              [no tax applied]
                   |
           CARNAGE VAULTS
          /        |        \
    CRIME_VAULT  FRAUD_VAULT  WSOL
         |           |
    [burn via       [sell via
     Token-2022]    swap_exempt]

         BONDING CURVE
              |
     SOL -> TOKEN (purchase)
     TOKEN -> SOL (sell, -15% tax)
              |
         TAX ESCROW
              |
     [distribute_tax_escrow]
              |
         CARNAGE FUND

    CONVERSION VAULT
    CRIME/FRAUD (100) <-> PROFIT (1)
```

### Fee Analysis

| Fee | Formula | Rounding | Recipient | Rate Change | Source |
|-----|---------|----------|-----------|-------------|--------|
| Buy Tax | amount_in * tax_bps / 10000 | Floor (protocol-favored) | 71% Staking, 24% Carnage, 5% Treasury | Per-epoch via VRF (3-14%) | `tax_math.rs:34-53` |
| Sell Tax | gross_output * tax_bps / 10000 | Floor (protocol-favored) | 71% Staking, 24% Carnage, 5% Treasury | Per-epoch via VRF (3-14%) | `tax_math.rs:34-53` |
| AMM LP Fee | amount_in * lp_fee_bps / 10000 | Floor (stays in pool) | Pool reserves (LPs) | Fixed at pool init (100 bps) | `amm/math.rs:36-40` |
| Bonding Curve Sell Tax | sol_gross * 1500 / 10000 | Ceil (protocol-favored) | Tax escrow PDA | Fixed (15%) | `sell.rs:192-197` |
| Carnage Execution | None (swap_exempt = tax-free) | N/A | N/A | N/A | `swap_exempt.rs` |
| Conversion | None (fixed-rate) | Floor for division (user loses remainder) | Vault retains remainder | Fixed (100:1) | `convert.rs:103` |

**Fee destination control:** Treasury address is hardcoded per build feature (devnet/mainnet). Staking escrow and Carnage vault are PDAs derived from their respective programs. No mutable fee destination — all are compile-time constants or PDA-derived.

### Economic Invariant List

1. **Tax sum invariant:** `staking_portion + carnage_portion + treasury_portion == total_tax` — Enforced by remainder-to-treasury pattern in `split_distribution`.
2. **AMM k-invariant:** `k_after >= k_before` for every swap — Enforced by `verify_k_invariant` post-swap.
3. **AMM output bound:** `amount_out < reserve_out` — Guaranteed by constant-product formula (asymptotic, never reaches reserve_out).
4. **Staking solvency:** `escrow.lamports() >= pending_rewards` — Enforced by reconciliation in `deposit_rewards`.
5. **Bonding curve solvency:** `vault_balance >= integral(tokens_sold) - rent_exempt` — Enforced by post-sell assertion.
6. **Tax rate range:** `0 <= tax_bps <= 10000` — Enforced by `calculate_tax` rejecting > 10000.
7. **Minimum output floor:** `minimum_output >= 50% of expected output` — Enforced by `calculate_output_floor` in both buy and sell paths.
8. **Carnage swap cap:** `total_buy_amount <= MAX_CARNAGE_SWAP_LAMPORTS` — Enforced by `std::cmp::min` in carnage_execution.

### Flash Loan Impact Analysis

| Operation | Flash Loan Impact | Protection |
|-----------|-------------------|------------|
| AMM Swap | Pool manipulation before Tax swap: attacker could inflate/deflate reserves to worsen swap output | 50% output floor prevents extreme manipulation; k-invariant prevents drainage |
| Staking stake/unstake | Same-block stake-claim-unstake: attacker stakes large amount, claims rewards, unstakes | Checkpoint pattern: `update_rewards` before balance change means new stake earns zero until next distribution. Flash loan attack yields zero profit. |
| Bonding Curve Purchase | Large SOL injection to push price up, buy tokens, sell back | Wallet cap (50 SOL) limits single-user exposure; 15% sell tax makes immediate resale unprofitable |
| Carnage Execution | Pool manipulation before Carnage swap | VRF makes timing unpredictable; slippage floor (75-85%) limits extraction; Carnage swap cap limits exposure |
| Conversion Vault | Flash-convert large amounts to drain vault | No protection beyond vault balance — vault can be emptied. Low priority: conversion is a convenience feature, not core protocol |

### Value Extraction Matrix

**Legitimate Extraction:**
- Users receive tokens from swaps (minus tax and LP fee)
- Stakers receive SOL yield from escrow (71% of all taxes)
- Treasury receives 5% of all taxes
- Bonding curve: users receive SOL from sell-back (minus 15% tax)
- Carnage Fund burns tokens (deflationary extraction, value removed from supply)

**Potential Attack Extraction:**
- Sandwich attack on swap: Insert buy before victim's buy, sell after. Limited by 50% output floor — attacker can extract at most the difference between floor and actual output.
- Carnage timing manipulation: Predict VRF trigger (not feasible without oracle compromise), front-run Carnage buy with own buy. Limited by VRF unpredictability and slippage floor.
- Staking reward gaming: Deposit rewards to escrow, stake large amount, claim. Not feasible — rewards require `add_to_cumulative` CPI from Epoch Program, which only runs at epoch boundaries.
- Conversion vault drain: Convert large CRIME/FRAUD -> PROFIT to deplete vault. Feasible but requires holding CRIME/FRAUD tokens, which are illiquid pre-graduation.

## Cross-Focus Intersections

- **Arithmetic (ARITH):** Tax calculation, swap math, bonding curve integrals, staking reward math — all use checked arithmetic. The Arithmetic Agent should verify truncation behavior at edge cases.
- **CPI:** Tax -> AMM, Tax -> Staking, Epoch -> Tax, Token-2022 -> Hook. All CPI calls use manual invoke_signed with raw instruction data. The CPI Agent should verify discriminator correctness and account ordering.
- **State Machine (STATE):** Bonding curve status transitions (Active -> Filled -> Graduated), Carnage state (Idle -> Triggered -> Executed/Expired). The State Machine Agent should verify these transitions are enforced.
- **Access Control (ACCESS):** swap_authority, tax_authority, carnage_signer PDAs. The Access Control Agent should verify seeds match across programs.
- **Timing (TIMING):** Epoch boundaries, bonding curve deadlines, staking cooldowns. The Timing Agent should verify clock-dependent guards.
- **Oracle (ORACLE):** VRF drives tax rates and Carnage trigger/action/target. The Oracle Agent should verify VRF byte interpretation.

## Cross-Reference Handoffs

- **Arithmetic Agent:** Verify `calculate_tokens_out` quadratic formula floor rounding at edge cases (sol_lamports = 1, current_sold = TARGET_TOKENS - 1). Verify `calculate_sol_for_tokens` ceil rounding is consistent (same function used for buy cost and sell refund).
- **Oracle Agent:** Verify `get_tax_bps` in EpochState returns bounded values. The Tax Program accepts any u16 but rejects > 10000 via `calculate_tax`. If EpochState stores a value > 10000 (bug in VRF derivation), the tax calculation returns None -> TaxOverflow error (safe failure but blocks all swaps until next epoch).
- **Access Control Agent:** Verify `swap_exempt` instruction checks that caller is carnage_signer PDA from Epoch Program. If this check is missing, any account could execute tax-free swaps.
- **State Machine Agent:** Verify `execute_carnage_atomic` and `execute_carnage` both check `epoch_state.carnage_pending == true` and that `carnage_pending` is set only by `consume_randomness`. If multiple Carnage executions are possible per epoch, the Fund could be drained faster than intended.
- **Timing Agent:** Verify bonding curve `deadline_slot` check uses `<=` (inclusive) and that `mark_failed` uses `>` (strictly after) to prevent overlap window.

## Risk Observations

1. **Carnage fallback slippage window (75%):** The 25% tolerance means the Carnage Fund could systematically lose value on fallback executions. An attacker who can observe the Carnage trigger (via event or state monitoring) and act within the lock window expiry could profit by manipulating pool reserves before the fallback execution.

2. **Pool reader byte offset coupling:** A version mismatch between AMM and Tax Program after an upgrade could cause silent misreading of pool reserves. This would affect both the output floor calculation (making it too lenient or too strict) and the sell-side gross floor computation.

3. **WSOL intermediary PDA lifecycle:** The close-reinit cycle in sell path creates a brief window where the intermediary does not exist. If two sell transactions are in the same block and the first one's reinit fails, the second would fail at intermediary validation. This is a liveness issue, not a safety issue.

4. **Bonding curve refund proportional calculation:** If the curve fails and multiple users claim refunds, the proportional calculation in `claim_refund.rs` (not fully analyzed here) uses `calculate_proportional_refund` from math.rs. The u128->u64 cast via `u64::try_from(result).ok()` could return None for extremely large values, denying the refund. The function returns Option, and the caller must handle None.

5. **Tax Program does not validate `is_crime` flag on-chain:** The `is_crime` boolean is passed by the user to determine which pool to use and which tax rate to apply. The pool accounts passed must match (validated by AMM's pool constraints), but the Tax Program itself does not verify that the pool's mint matches the is_crime flag. This means a user could pass `is_crime=true` with FRAUD pool accounts. The AMM would enforce correct accounts via its constraint checks, so this is not exploitable, but it represents a defense-in-depth gap.

## Novel Attack Surface Observations

1. **Conversion vault as infinite-capital leverage:** A user with unlimited PROFIT tokens could convert 100:1 to CRIME/FRAUD, sell on AMM, and repeat. The conversion vault has no rate limit, cooldown, or per-user cap. If the vault's CRIME/FRAUD reserves are replenished (e.g., after Carnage burns and re-buys), this creates a circular extraction path. The economic impact depends on PROFIT token scarcity (20M supply, staking locks most of it), making this theoretical but worth monitoring.

2. **Epoch tax rate flip as MEV opportunity:** The VRF determines which faction has low tax (3%) vs high tax (14%). If a trader monitors the `consume_randomness` event, they could front-run the next block's swaps by switching from the newly-expensive faction to the newly-cheap one. The VRF commit-reveal process adds one transaction of latency, but the reveal and consume happen in the same block, so the new rates are known when the reveal TX lands.

3. **Dead stake donation attack on staking rewards:** The first-depositor attack is mitigated by 1 PROFIT dead stake. But if someone donates a large amount of SOL directly to the escrow PDA (without calling deposit_rewards), the reconciliation check (`escrow.lamports() >= pending_rewards`) would pass but the donated SOL would never be distributed — it sits in escrow as excess. This is not an attack (no value extracted) but creates permanently locked SOL. The reverse (withdrawing SOL from escrow without decrementing pending_rewards) is not possible because the escrow is program-owned with no withdrawal instruction.

## Questions for Other Focus Areas

- **For Arithmetic focus:** In `carnage_execution.rs:332-337`, the expected output calculation uses `checked_mul` and `checked_div` with `and_then`. Is the error handling correct if the first checked_mul overflows? The `.ok_or(EpochError::Overflow)?` at line 337 catches it, but verify the chain doesn't silently produce wrong results before reaching the error path.

- **For CPI focus:** The sell path in `swap_sol_sell.rs:289-299` uses a raw SPL Token Transfer instruction (discriminator 3u8) without going through Anchor's CPI framework. Does this correctly propagate the user's signer authority through the CPI chain? The user signed the top-level TX, so their signature should be forwarded, but verify Token Program validates the authority.

- **For State Machine focus:** If `consume_randomness` sets carnage_pending=true but the caller omits the optional `carnage_state` account (HOT_SPOTS line 80), does Carnage get properly queued? If not, taxes update but Carnage is silently skipped.

- **For Access Control focus:** The `distribute_tax_escrow` instruction in bonding curve is permissionless (line 72: any caller, only Graduated status required). Verify that the destination (carnage_fund) is the correct PDA and cannot be substituted.

## Raw Notes

### Previous Finding Recheck

**H008 (Sell path AMM min=0 sandwich):** MITIGATED. The 50% output floor at `swap_sol_sell.rs:112-118` enforces `minimum_output >= calculate_output_floor(token_reserve, sol_reserve, amount_in, 5000)`. Users cannot pass minimum_output=0 through the Tax Program anymore. The AMM also receives a computed `gross_floor` as amm_minimum (lines 150-167) ensuring the AMM itself enforces a minimum. Double protection.

**H012/S003 (Staking escrow rent depletion):** FIXED. `claim.rs:104-111` computes `rent_exempt_min = rent.minimum_balance(0)` and subtracts it from available balance before comparing to rewards_to_claim. Escrow PDA cannot be drained below rent-exempt threshold.

**S005 (No emergency pause):** NOT_FIXED (by design). No pause mechanism exists. This is an accepted design decision — the protocol is designed to be trustless and immutable. The reentrancy guard on AMM pools provides per-pool locking but there is no global pause switch.

**H048 (taxes_confirmed unchecked by Tax):** ACCEPTED. The Tax Program trusts the EpochState it reads. There is no "taxes_confirmed" field check — tax rates come from `get_tax_bps`. The Tax Program validates EpochState owner (Epoch Program) and discriminator, which is sufficient given the Epoch Program is trusted.

**H014 (Buy path 50% output floor):** ACCEPTED. The floor is enforced at `swap_sol_buy.rs:106-111`. The 50% threshold is deliberately generous to absorb LP fees and normal price impact. It prevents bots from setting zero slippage, not from setting low-but-reasonable slippage. This is a design choice, not a vulnerability.
