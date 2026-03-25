---
task_id: sos-phase1-timing-ordering
provides: [timing-ordering-findings, timing-ordering-invariants]
focus_area: timing-ordering
files_analyzed:
  - programs/amm/src/instructions/swap_sol_pool.rs
  - programs/tax-program/src/instructions/swap_sol_buy.rs
  - programs/tax-program/src/instructions/swap_sol_sell.rs
  - programs/tax-program/src/helpers/tax_math.rs
  - programs/tax-program/src/helpers/pool_reader.rs
  - programs/tax-program/src/constants.rs
  - programs/tax-program/src/state/epoch_state_reader.rs
  - programs/epoch-program/src/instructions/trigger_epoch_transition.rs
  - programs/epoch-program/src/instructions/consume_randomness.rs
  - programs/epoch-program/src/instructions/expire_carnage.rs
  - programs/epoch-program/src/instructions/execute_carnage_atomic.rs
  - programs/epoch-program/src/state/epoch_state.rs
  - programs/epoch-program/src/constants.rs
  - programs/bonding_curve/src/instructions/purchase.rs
  - programs/bonding_curve/src/instructions/sell.rs
  - programs/bonding_curve/src/instructions/mark_failed.rs
  - programs/bonding_curve/src/instructions/start_curve.rs
  - programs/bonding_curve/src/constants.rs
  - programs/staking/src/instructions/unstake.rs
  - programs/staking/src/instructions/claim.rs
  - programs/staking/src/constants.rs
finding_count: 12
severity_breakdown: {critical: 1, high: 3, medium: 5, low: 3}
---
<!-- CONDENSED_SUMMARY_START -->
# Timing & Ordering -- Condensed Summary

## Key Findings (Top 10)

1. **AMM sell path passes minimum_amount_out=0 to AMM CPI**: The Tax Program's swap_sol_sell passes `amm_minimum: u64 = 0` at line 147, relying solely on its own post-tax slippage check. Between the AMM CPI (which accepts ANY output) and the Tax Program's check, a sandwich attacker can extract value -- `swap_sol_sell.rs:147`
2. **Protocol output floor reads STALE pool reserves**: `read_pool_reserves()` reads AMM reserves before the swap CPI executes. A front-runner who manipulates reserves before the floor check but after the read can bypass the 50% floor -- `swap_sol_buy.rs:105-111`, `pool_reader.rs:39-57`
3. **Tax rates are stale during epoch transition window**: Between `trigger_epoch_transition` (sets `taxes_confirmed=false`) and `consume_randomness` (sets it `true`), the old epoch's tax rates remain in EpochState. Tax Program reads but does NOT check `taxes_confirmed` -- `swap_sol_buy.rs:67-78`, `epoch_state_reader.rs:36`
4. **Bonding curve deadline uses slot comparison**: `clock.slot <= curve.deadline_slot` is a clean cutoff but slot-skipping means exact timing is unpredictable. Not a vulnerability per se but creates UX unpredictability -- `purchase.rs:108-111`, `sell.rs:142-145`
5. **start_curve sets deadline with unchecked addition**: `curve.deadline_slot = clock.slot + DEADLINE_SLOTS` at `start_curve.rs:66` uses unchecked addition. With DEADLINE_SLOTS=432000 and slot values well below u64::MAX this is safe in practice, but violates the codebase's checked-arithmetic convention
6. **Carnage lock window timing allows frontrunning the fallback path**: After CARNAGE_LOCK_SLOTS (50 slots), anyone can call `execute_carnage` (fallback). An attacker can see carnage_pending state and prepare a sandwich around the fallback -- `epoch-program/constants.rs:138`, `execute_carnage_atomic.rs`
7. **VRF freshness window of 1 slot is tight**: `slot_diff <= 1` for randomness freshness means the commit TX must land within 1 slot of randomness creation. Network congestion could cause spurious failures, requiring retry -- `trigger_epoch_transition.rs:166`
8. **Staking cooldown uses unix_timestamp (manipulable by ~1-2s)**: `claim.rs:119` sets `last_claim_ts = clock.unix_timestamp` and `unstake.rs:126-133` compares against it. Validators can shift timestamps slightly. 12-hour cooldown absorbs this easily -- `unstake.rs:126-133`
9. **No deadline/expiry on user swap transactions**: swap_sol_buy and swap_sol_sell have no transaction deadline parameter. Users rely solely on blockhash expiry (~60s). Long-lived durable nonces could allow delayed execution -- `swap_sol_buy.rs:47-52`, `swap_sol_sell.rs:62-66`
10. **Bonding curve sell has no separate deadline from purchase**: Sells use the same `deadline_slot` as purchases. Both are blocked once deadline passes, but the FAILURE_GRACE_SLOTS (150 slots) gap means there's a period where neither purchases nor sells work but the curve isn't yet marked Failed -- `sell.rs:142-145`, `mark_failed.rs:56-63`

## Critical Mechanisms

- **AMM Reentrancy Guard**: Pool is locked (`pool.locked = true`) at swap entry, unlocked post-transfer. Prevents same-TX reentrancy via CPI. Uses Anchor constraint `!pool.locked` at deserialization. -- `swap_sol_pool.rs:84,322`
- **Protocol Output Floor (SEC-10)**: Enforces `minimum_output >= 50% of expected_output` using raw pool reserve reads before CPI. Prevents zero-slippage sandwich bots but reads reserves at a point-in-time -- `swap_sol_buy.rs:105-111`, `swap_sol_sell.rs:112-118`, `tax_math.rs:141-165`
- **Epoch Transition Timing**: Slot-based epoch boundaries (`expected_epoch > current_epoch`). VRF commit must happen within 1 slot of randomness creation. Anti-reroll binds randomness account at commit time. -- `trigger_epoch_transition.rs:135-186`
- **Bonding Curve Deadline**: Hard slot-based cutoff with 150-slot grace buffer before failure marking. Purchases and sells both blocked at same deadline. -- `purchase.rs:108-111`, `mark_failed.rs:56-63`
- **Carnage Execution Windows**: Lock window (0-50 slots) for atomic-only, fallback window (50-300 slots), expiry after 300 slots. Slippage floors: 85% atomic, 75% fallback. -- `epoch-program/constants.rs:127-138`

## Invariants & Assumptions

- INVARIANT: AMM pool is locked during swap execution -- enforced at `swap_sol_pool.rs:84` (set) and `swap_sol_pool.rs:381` (Anchor constraint `!pool.locked`)
- INVARIANT: k_after >= k_before after every swap -- enforced at `swap_sol_pool.rs:170-173`
- INVARIANT: Bonding curve purchases blocked after deadline_slot -- enforced at `purchase.rs:108-111`
- INVARIANT: VRF consume must use SAME randomness account as commit -- enforced via `pending_randomness_account` binding at `trigger_epoch_transition.rs:186`
- INVARIANT: Carnage expires if not executed within CARNAGE_DEADLINE_SLOTS -- enforced at `expire_carnage.rs:68-71`
- ASSUMPTION: Slot-based timing provides approximately 400ms per slot -- UNVALIDATED on-chain (slot duration varies with network load)
- ASSUMPTION: Pool reserves read by `read_pool_reserves()` are current at time of floor check -- NOT GUARANTEED if front-runner manipulates reserves before the swap TX executes
- ASSUMPTION: Blockhash expiry (~60s) prevents stale swap execution -- VALID for normal transactions, but durable nonces bypass this
- ASSUMPTION: The `taxes_confirmed` flag is informational only -- Tax Program DOES NOT CHECK it, swaps proceed with stale rates during VRF window

## Risk Observations (Prioritized)

1. **CRITICAL -- Sell path AMM minimum_amount_out=0**: `swap_sol_sell.rs:147` passes 0 as the AMM's minimum. This means the AMM itself performs NO slippage protection. The only protection is the Tax Program's post-CPI check at line 245. Between AMM execution and the Tax Program's check, the transaction is committed. If the AMM returns a terrible rate, the Tax Program reverts the whole TX -- but the sandwich attacker has already profited from the price impact. The output floor (SEC-10) at lines 112-118 mitigates this to 50% of expected, but the gap between 50% and the user's intended slippage is exploitable.
2. **HIGH -- Stale reserve reads for output floor**: `read_pool_reserves()` reads bytes at offsets 137-153 from the pool AccountInfo. This happens BEFORE the CPI to the AMM. In a same-block scenario, a front-runner can manipulate pool reserves (via another swap in a prior instruction) to make the floor calculation produce a lower floor, then the actual swap executes against worse reserves.
3. **HIGH -- No `taxes_confirmed` check in Tax Program**: During the VRF transition window (potentially 300+ slots if VRF times out), swaps use the previous epoch's tax rates. This is by design (continuity), but an attacker who knows the next epoch's rates (by watching the VRF reveal in the mempool) could front-run to swap at favorable stale rates before consume_randomness lands.
4. **HIGH -- No transaction-level deadline on swaps**: Neither swap_sol_buy nor swap_sol_sell accepts a deadline/expiry parameter. Combined with durable nonces, a signed swap TX could theoretically be held and submitted later at unfavorable rates. Blockhash expiry mitigates this for normal transactions.
5. **MEDIUM -- Carnage fallback frontrunning**: After 50 slots, the fallback path opens with 75% slippage floor. An attacker seeing `carnage_pending=true` on-chain can prepare a sandwich around the fallback Carnage TX, knowing exactly which pool will be traded.

## Novel Attack Surface

- **Tax-rate transition front-running**: The protocol's unique per-epoch asymmetric tax rates create a novel attack. An attacker can watch for `trigger_epoch_transition` in the mempool, see that VRF is pending, and know that tax rates will change when `consume_randomness` lands. If they can see the VRF reveal bytes (public on Switchboard), they can compute the new rates and execute trades at the old rates that become favorable at the new rates -- a cross-epoch arbitrage that is unique to this protocol's tax asymmetry design.
- **Dual-curve deadline interaction**: Both CRIME and FRAUD curves share the same timing logic but have independent deadlines. If one curve fills (Graduated) and the other doesn't, the prepare_transition instruction requires BOTH curves to be Filled. An attacker could grief by preventing one curve from filling (buying up to MAX_TOKENS_PER_WALLET on both curves from many wallets, then selling on one just before deadline), forcing failure/refund on both.

## Cross-Focus Handoffs

- **Token/Economic Agent**: The sell path's `amm_minimum=0` creates a value extraction point. The output floor (SEC-10) provides a 50% floor but the gap between 50% and the user's stated minimum is where value can be extracted. Analyze the economic impact.
- **Oracle Agent**: VRF randomness freshness check (slot_diff <= 1) is extremely tight. If Switchboard oracle delays, the protocol falls back to retry_epoch_vrf after VRF_TIMEOUT_SLOTS (300 slots). The Oracle agent should verify retry_epoch_vrf security.
- **State Machine Agent**: The taxes_confirmed flag transition (false during VRF pending, true after consume) creates a state where swaps use stale rates. The State Machine agent should verify whether this is intentional design or a gap.
- **CPI Agent**: The sell path's close-recreate cycle for wsol_intermediary (lines 295-451 of swap_sol_sell.rs) happens across multiple CPIs in sequence. Verify atomicity guarantees.

## Trust Boundaries

The protocol trusts: (1) Switchboard VRF oracles to reveal randomness honestly and within VRF_TIMEOUT_SLOTS, (2) the crank runner to trigger epoch transitions and carnage execution in a timely manner, (3) validators not to manipulate slot timing beyond normal ~1-2s variance. Users trust: (1) the protocol's output floor (50%) as MEV protection, (2) the bonding curve deadline as a fair cutoff. The key untrusted boundary is the public mempool -- all state-changing transactions are visible, creating front-running opportunities on every swap, epoch transition, and carnage execution.
<!-- CONDENSED_SUMMARY_END -->

---

# Timing & Ordering -- Full Analysis

## Executive Summary

The Dr Fraudsworth protocol has extensive timing-dependent logic across six programs. The primary concerns are: (1) the sell path passes minimum_amount_out=0 to the AMM, relying on a post-CPI check that doesn't prevent sandwich extraction during the AMM's execution; (2) pool reserves are read for the output floor BEFORE the swap CPI, creating a TOCTOU (time-of-check-time-of-use) gap; (3) tax rates can be stale during epoch transitions with no on-chain enforcement preventing swaps during the VRF window.

The bonding curve timing is well-designed with clear slot-based deadlines and a grace buffer. The staking cooldown mechanism is appropriate for its purpose. Carnage timing follows a tiered approach (lock/fallback/expiry) that is reasonable.

## Scope

- **Files analyzed:** 21 source files across 6 programs (AMM, Tax, Epoch, Bonding Curve, Staking, Transfer Hook)
- **Functions analyzed:** swap_sol_pool::handler, swap_sol_buy::handler, swap_sol_sell::handler, calculate_output_floor, read_pool_reserves, trigger_epoch_transition::handler, consume_randomness::handler, expire_carnage::handler, purchase::handler, sell::handler, mark_failed::handler, start_curve::handler, unstake::handler, claim::handler, current_epoch, epoch_start_slot
- **Estimated coverage:** 90% of timing-critical code paths

## Key Mechanisms

### 1. AMM Swap with Reentrancy Guard and Slippage
**Location:** `programs/amm/src/instructions/swap_sol_pool.rs:57-342`

**Purpose:** Execute constant-product swap with CEI ordering and reentrancy protection.

**How it works:**
1. Line 84: Set `pool.locked = true` (reentrancy guard)
2. Lines 86-148: CHECKS -- validate amount, compute output, check slippage
3. Lines 162-185: EFFECTS -- update reserves, verify k-invariant
4. Lines 210-315: INTERACTIONS -- execute token transfers
5. Line 322: Clear reentrancy guard (`pool.locked = false`)
6. Lines 325-339: Emit event with Clock::get() for timestamp/slot

**Assumptions:**
- Slippage check at line 146 (`amount_out >= minimum_amount_out`) protects users IF the caller passes a non-zero minimum
- The caller (Tax Program) is responsible for setting appropriate minimums

**Invariants:**
- Pool locked during entire swap (lines 84, 322)
- k_after >= k_before (lines 170-173)
- Reserves updated before transfers (CEI)

**Concerns:**
- The AMM itself is well-ordered (CEI). The concern is what callers pass as minimum_amount_out.
- Clock is only used for event emission (line 325), not for any security-critical logic -- this is the correct pattern.

### 2. Tax Program Buy Swap
**Location:** `programs/tax-program/src/instructions/swap_sol_buy.rs:47-343`

**Purpose:** Deduct buy tax from SOL input, distribute tax, then CPI to AMM.

**How it works:**
1. Lines 58-78: Read and validate EpochState (owner check, discriminator, initialized)
2. Lines 83-94: Calculate tax and sol_to_swap
3. Lines 105-111: Read pool reserves, compute output floor, validate minimum_output >= floor
4. Lines 116-210: Distribute tax (staking 71%, carnage 24%, treasury 5%)
5. Lines 256-308: Build AMM CPI with sol_to_swap as amount, user's minimum_output as AMM minimum
6. Lines 317-320: Reload user_token_b to compute actual tokens received

**Assumptions:**
- EpochState tax rates are current and valid (no taxes_confirmed check)
- Pool reserves read at step 3 are still valid when AMM executes at step 5
- The user's minimum_output is passed directly to AMM as minimum_amount_out (line 262)

**Invariants:**
- Tax distribution sum = tax_amount (enforced by split_distribution)
- sol_to_swap > 0 (line 94)

**Concerns:**
- The output floor check uses reserves read BEFORE tax distribution and AMM CPI. If another TX manipulates reserves between the read and the AMM execution, the floor check was based on stale data.
- Buy path correctly passes user's minimum_output to AMM (line 262), unlike sell path.

### 3. Tax Program Sell Swap (CRITICAL)
**Location:** `programs/tax-program/src/instructions/swap_sol_sell.rs:62-477`

**Purpose:** Send tokens to AMM, receive WSOL, deduct sell tax from output.

**How it works:**
1. Lines 71-93: Read and validate EpochState
2. Line 98: Record wsol_before (pre-CPI balance snapshot)
3. Lines 112-118: Output floor check on user's minimum_output
4. Lines 127-215: Build AMM CPI with direction=BtoA, **amm_minimum=0** (line 147)
5. Lines 220-225: Reload user_token_a, compute gross_output via balance-diff
6. Lines 230-245: Calculate tax on gross_output, compute net_output, check slippage
7. Lines 266-451: Transfer-close-distribute-reinit WSOL intermediary

**Assumptions:**
- Passing minimum_amount_out=0 to AMM is safe because the Tax Program checks slippage post-CPI
- The WSOL balance-diff accurately measures AMM output (no other WSOL flows in the same instruction)

**Invariants:**
- net_output >= minimum_output (line 245)
- net_output > 0 (line 243)

**Concerns:**
- **CRITICAL**: Line 147 `let amm_minimum: u64 = 0` -- The AMM will accept ANY output amount, including a heavily sandwiched output. While the Tax Program's check at line 245 will revert if net_output < minimum_output, the sandwich attacker benefits from the price impact itself. The attacker's front-run transaction moves the price, the user's TX (with AMM minimum=0) executes at the bad price, the Tax Program reverts the whole TX, and the attacker's back-run restores price. **The attacker profits from the front-run regardless of whether the user's TX succeeds.** However, if the user's TX reverts, the back-run may not be needed. The real risk is when the sandwich moves the price just enough that the user's slippage tolerance is met but at a worse-than-expected rate.
- The output floor at lines 112-118 enforces minimum_output >= 50% of expected. This means the worst-case sandwich extracts up to ~50% of expected output (minus the user's actual minimum).

### 4. Protocol Output Floor (SEC-10)
**Location:** `programs/tax-program/src/helpers/tax_math.rs:141-165`

**Purpose:** Compute minimum acceptable output as 50% of constant-product expected output.

**How it works:**
1. Lines 148-149: Early return 0 for empty pool/zero amount
2. Lines 154-156: `expected = reserve_out * amount_in / (reserve_in + amount_in)` in u128
3. Lines 159-161: `floor = expected * floor_bps / 10000` where floor_bps=5000

**Assumptions:**
- LP fee (~1%) is absorbed by the generous 50% floor
- Reserves passed are current (TOCTOU concern noted above)

**Invariants:**
- floor <= expected <= reserve_out <= u64::MAX (safe u128->u64 cast at line 164)

**Concerns:**
- The `as u64` cast at line 164 is safe mathematically (floor <= reserve_out which is u64) but violates the project's convention of using `u64::try_from().ok()?`
- Empty pool returns Some(0), allowing floor=0. This is by design but means the floor provides no protection on the very first swap after pool creation.

### 5. Epoch Transition Timing
**Location:** `programs/epoch-program/src/instructions/trigger_epoch_transition.rs:129-246`

**Purpose:** Advance epoch, bind VRF randomness, pay bounty.

**How it works:**
1. Line 131: `Clock::get()`
2. Lines 135-139: `expected_epoch > current_epoch` (boundary check)
3. Line 149: `!vrf_pending` (no double-commit)
4. Lines 152-166: Randomness freshness (`slot_diff <= 1`)
5. Lines 170-173: Not-yet-revealed check
6. Lines 176-186: Advance epoch, set VRF pending state
7. Lines 194-227: Pay bounty from carnage_sol_vault

**Assumptions:**
- VRF commit TX will land within 1 slot of randomness account creation
- Bounty payment doesn't drop vault below rent-exempt (known TODO)

**Invariants:**
- Cannot double-commit (vrf_pending gate at line 149)
- Randomness account bound at commit (anti-reroll at line 186)

**Concerns:**
- Line 81: `((slot.saturating_sub(genesis_slot)) / SLOTS_PER_EPOCH) as u32` -- The `as u32` cast truncates if epoch number exceeds ~4 billion. With SLOTS_PER_EPOCH=4500 and u64 slots, this would require ~2^42 slots (~56 trillion years). Safe in practice but technically unguarded.
- Line 99: `genesis_slot + (epoch as u64 * SLOTS_PER_EPOCH)` -- `epoch as u64 * SLOTS_PER_EPOCH` could overflow for very large epoch values. Same "heat death of the universe" timeline applies.
- The bounty payment check at line 195 (`vault_balance >= TRIGGER_BOUNTY_LAMPORTS`) does NOT account for rent-exempt minimum. Known TODO per project memory.

### 6. Bonding Curve Timing
**Location:** `programs/bonding_curve/src/instructions/purchase.rs:97-310`, `sell.rs:111-319`, `mark_failed.rs:45-78`, `start_curve.rs:54-76`

**Purpose:** Time-boxed token sale with hard deadline and grace period.

**How it works:**
- `start_curve.rs:66`: `deadline_slot = clock.slot + DEADLINE_SLOTS` (432000 slots ~48h)
- `purchase.rs:108-111`: `clock.slot <= curve.deadline_slot` (hard cutoff)
- `sell.rs:142-145`: Same deadline check as purchase
- `mark_failed.rs:56-63`: `clock.slot > deadline_slot + FAILURE_GRACE_SLOTS` (150 slots extra)

**Assumptions:**
- DEADLINE_SLOTS (432000) + clock.slot won't overflow u64 (safe: max slot ~2^63)
- The 150-slot grace buffer is sufficient for in-flight TXs to finalize
- Slot-based timing provides approximately 48 hours at 400ms/slot

**Invariants:**
- Purchases blocked after deadline_slot
- Sells blocked after deadline_slot
- mark_failed only callable after deadline_slot + 150

**Concerns:**
- `start_curve.rs:66` uses unchecked addition: `clock.slot + DEADLINE_SLOTS`. While practically safe, this violates the codebase's checked arithmetic convention.
- There is a ~60-second gap (150 slots) between "purchases/sells blocked" (deadline_slot) and "curve can be marked failed" (deadline_slot + 150). During this gap the curve is in limbo -- Active but not operable. Not exploitable but worth documenting.

### 7. Staking Cooldown
**Location:** `programs/staking/src/instructions/unstake.rs:103-230`, `claim.rs:78-172`

**Purpose:** Prevent mercenary capital by requiring 12-hour cooldown after claiming before unstaking.

**How it works:**
- `claim.rs:119`: `user.last_claim_ts = clock.unix_timestamp` (sets cooldown start)
- `unstake.rs:125-133`: Checks `elapsed >= COOLDOWN_SECONDS` (43200 = 12h)
- `unstake.rs:129`: `clock.unix_timestamp.checked_sub(last_claim_ts).unwrap_or(0)` -- treats clock weirdness as cooldown active (safe default)

**Assumptions:**
- `unix_timestamp` is approximately correct (±1-2 seconds per Solana runtime quirks)
- 12 hours is long enough that ±2 second manipulation is irrelevant

**Invariants:**
- Cooldown enforced before unstake
- Cooldown reset to 0 on full unstake (clean slate)

**Concerns:**
- Using `unix_timestamp` instead of `slot` introduces validator timestamp manipulation risk, but 12-hour cooldown makes this negligible.
- `unwrap_or(0)` on line 129 means if `clock.unix_timestamp < last_claim_ts` (clock going backwards), elapsed = 0 and cooldown is active. This is the safe default.

### 8. Carnage Execution Windows
**Location:** `programs/epoch-program/src/constants.rs:127-138`, `expire_carnage.rs:63-116`

**Purpose:** Tiered execution windows for VRF-triggered buyback-and-burn.

**How it works:**
- Slots 0-50 (CARNAGE_LOCK_SLOTS): Only atomic path (bundled with consume_randomness)
- Slots 50-300: Fallback path also available (permissionless)
- After 300 (CARNAGE_DEADLINE_SLOTS): Expired, SOL retained

**Slippage:**
- Atomic: 85% floor (CARNAGE_SLIPPAGE_BPS_ATOMIC = 8500)
- Fallback: 75% floor (CARNAGE_SLIPPAGE_BPS_FALLBACK = 7500)

**Concerns:**
- The fallback window (50-300 slots) is publicly visible. Once `carnage_pending=true` is on-chain, MEV bots know which pool will be traded and can prepare sandwiches. The 75% floor limits extraction but still allows up to 25% slippage.
- The atomic path being bundled with consume_randomness makes it harder to sandwich (attacker doesn't know Carnage is triggered until the TX lands), but the VRF reveal bytes are public on Switchboard -- a sophisticated attacker monitoring Switchboard state could predict Carnage before the consume TX lands.

## Trust Model

**Trusted entities:**
- Protocol admin (deploy-time authority, can start curves, force carnage, prepare transitions)
- Switchboard VRF oracles (provide randomness for tax rates and carnage decisions)
- Crank runner (triggers epoch transitions, carnage execution -- incentivized by bounty)

**Untrusted entities:**
- All swap users (can set arbitrary slippage, attempt sandwich attacks)
- Bonding curve participants (can attempt to game deadline timing, grief curves)
- MEV bots / validators (can reorder transactions, sandwich swaps)

**Trust boundaries:**
- EpochState is the coordination point -- Tax Program trusts it for tax rates
- AMM trusts Tax Program (via seeds::program) to provide valid swap parameters
- The output floor is the protocol's MEV defense boundary -- below 50% is rejected

## State Analysis

### Timing State Variables
| Variable | Location | Written By | Read By |
|----------|----------|-----------|---------|
| `pool.locked` | AMM PoolState | swap_sol_pool | swap_sol_pool (constraint) |
| `epoch_state.current_epoch` | EpochState | trigger_epoch_transition | Tax (via mirror), Epoch |
| `epoch_state.vrf_pending` | EpochState | trigger/consume/retry | trigger, consume |
| `epoch_state.taxes_confirmed` | EpochState | trigger/consume/init | NOT CHECKED by Tax |
| `epoch_state.vrf_request_slot` | EpochState | trigger | retry (timeout) |
| `epoch_state.carnage_pending` | EpochState | consume/expire/execute | execute, expire |
| `epoch_state.carnage_deadline_slot` | EpochState | consume | execute, expire |
| `epoch_state.carnage_lock_slot` | EpochState | consume | execute_carnage |
| `curve.deadline_slot` | CurveState | start_curve | purchase, sell, mark_failed |
| `user_stake.last_claim_ts` | UserStake | claim | unstake |

## Dependencies

- **Clock sysvar**: Used by all timing operations (slot and unix_timestamp)
- **Switchboard On-Demand SDK**: VRF randomness for epoch transitions
- **AMM pool reserves**: Read raw bytes for output floor calculation (tight coupling to byte layout)

## Focus-Specific Analysis

### Time-Dependent Operations Map

| Instruction | Uses Clock? | Time-Sensitive Calculation | What Happens If Clock Manipulated (±slot)? |
|-------------|------------|---------------------------|---------------------------------------------|
| swap_sol_pool | Yes (event only) | None | No impact (Clock used only for event) |
| swap_sol_buy | Yes (event only) | None | No impact |
| swap_sol_sell | Yes (event only) | None | No impact |
| trigger_epoch_transition | Yes (slot) | Epoch boundary, VRF freshness | ±1 slot: Could miss/hit VRF freshness window |
| consume_randomness | Yes (slot) | VRF value extraction | ±1 slot: Could affect randomness extraction |
| expire_carnage | Yes (slot) | Deadline comparison | ±1 slot: Minor timing shift |
| purchase | Yes (slot) | Deadline comparison | ±1 slot: Could allow/block borderline purchase |
| sell | Yes (slot) | Deadline comparison | ±1 slot: Same as purchase |
| mark_failed | Yes (slot) | Deadline + grace comparison | ±1 slot: Minor shift in failure timing |
| start_curve | Yes (slot) | Deadline setting | No concern (sets future deadline) |
| unstake | Yes (timestamp) | Cooldown comparison | ±2s: Negligible on 12h cooldown |
| claim | Yes (timestamp) | Cooldown start | ±2s: Negligible |

### MEV Attack Surface

| Instruction | Involves Tokens? | Sandwichable? | Slippage Protection | Max Extractable Value |
|-------------|-----------------|---------------|---------------------|----------------------|
| swap_sol_buy | Yes (SOL -> Token) | Yes | User minimum + 50% floor | Up to ~50% of expected output |
| swap_sol_sell | Yes (Token -> SOL) | **YES (AMM minimum=0)** | Post-CPI Tax check + 50% floor | Up to ~50% of expected output |
| purchase (bonding curve) | Yes (SOL -> Token) | Yes | User minimum_tokens_out | Price curve limits extraction |
| sell (bonding curve) | Yes (Token -> SOL) | Yes | User minimum_sol_out | Price curve limits extraction |
| execute_carnage_atomic | Yes (SOL -> Token) | Limited (bundled with VRF) | 85% floor | Up to 15% of swap amount |
| execute_carnage (fallback) | Yes (SOL -> Token) | **Yes** (public, predictable) | 75% floor | Up to 25% of swap amount |

### Front-Running Risk Assessment

1. **trigger_epoch_transition**: Seeing this in mempool reveals VRF is about to change. If an attacker can predict VRF outcomes (by monitoring Switchboard oracle state), they gain information about future tax rates.
2. **consume_randomness**: The VRF reveal bytes are published on Switchboard before the consume TX lands. An attacker can read them, compute new tax rates, and submit swaps at the old rates in the same block before consume_randomness executes.
3. **execute_carnage (fallback)**: carnage_pending is publicly readable on-chain. The target pool and action are known. An attacker can sandwich the Carnage swap knowing the exact pool, direction, and approximate amount.

### Ordering Dependency Analysis

**Critical ordering requirements:**
1. `trigger_epoch_transition` MUST be bundled with Switchboard commitIx (same TX)
2. `consume_randomness` MUST be bundled with Switchboard revealIx (same TX)
3. Tax distribution (step 5 in buy, step 8 in sell) MUST complete before AMM CPI
4. AMM CPI MUST complete before balance-diff calculation (sell path)
5. WSOL intermediary close MUST complete before recreate (sell path)

**What if reordered?**
- If another TX inserts between trigger and consume: VRF is pending, new trigger blocked by `vrf_pending` check. Safe.
- If two sells execute in same TX: wsol_intermediary is closed in first sell, recreated, then second sell uses it. Should work due to same-TX account lifecycle, but edge case worth verifying.

## Cross-Focus Intersections

- **Arithmetic**: The `calculate_output_floor` function's `as u64` cast (line 164) bypasses checked arithmetic convention
- **CPI**: The sell path's multiple sequential CPIs (AMM swap, WSOL transfer, close, distribute, recreate) depend on correct ordering within a single instruction
- **State Machine**: The `taxes_confirmed` flag creates a state gap that overlaps with timing
- **Token/Economic**: The AMM minimum=0 on sell directly affects economic extraction potential
- **Access Control**: Epoch transitions are permissionless, creating timing-based incentives (bounty)

## Cross-Reference Handoffs

- **Token/Economic Agent**: Analyze the economic impact of AMM minimum_amount_out=0 in sell path. What's the maximum extractable value per swap given the 50% output floor?
- **Oracle Agent**: Verify Switchboard VRF freshness guarantees. Is slot_diff <= 1 sufficient? What's the oracle reveal latency?
- **State Machine Agent**: Review the taxes_confirmed flag gap. Is it intentional that swaps proceed during VRF pending? Document the design decision.
- **CPI Agent**: Verify the wsol_intermediary close-recreate cycle in swap_sol_sell for same-TX atomicity. Can a partial failure leave the intermediary in a broken state?
- **Access Control Agent**: The bounty payment in trigger_epoch_transition doesn't check rent-exempt minimum. Verify this is safe.

## Risk Observations

### Re-check: H043 MEDIUM (AMM slippage check ordering)
**Previous finding:** AMM slippage check ordering concern.
**Current status:** The AMM's slippage check at `swap_sol_pool.rs:146` (`amount_out >= minimum_amount_out`) is correctly placed BEFORE reserve updates and token transfers. The ordering is correct within the AMM. However, the concern elevates when considering the Tax Program's sell path passes minimum=0. **The AMM's slippage check is correct but rendered ineffective by the caller.** UPGRADED observation: The slippage concern has shifted from the AMM's internal ordering to the Tax Program's parameter passing.

### Re-check: H064 MEDIUM (Epoch transition timing)
**Previous finding:** Epoch transition timing concern.
**Current status:** The epoch transition timing logic at `trigger_epoch_transition.rs:135-139` is well-structured. The `expected_epoch > current_epoch` comparison correctly handles slot-skipping (if multiple epochs pass, it advances to the current epoch). The VRF freshness check (`slot_diff <= 1`) is tight but appropriate for preventing stale randomness reuse. The bounty rent-exempt concern remains open (known TODO). **Observation maintained at MEDIUM.**

### Additional Observations

1. **TOCTOU in output floor**: The pool reserves read at lines 105/112 in buy/sell handlers are stale by the time the AMM CPI executes. A front-runner manipulating reserves in a prior TX within the same block makes the floor calculation meaningless.

2. **Bonding curve unchecked addition**: `start_curve.rs:66` `clock.slot + DEADLINE_SLOTS` is unchecked. Practically safe but inconsistent with codebase conventions.

3. **No same-slot deposit-swap protection**: The AMM has no restriction on deposits and swaps in the same slot. This matters less here since there's no LP deposit instruction (protocol-seeded pools), but worth noting for future extensions.

## Novel Attack Surface Observations

1. **Cross-epoch tax arbitrage**: The unique asymmetric tax system (3-14% depending on side/direction/epoch) creates a novel timing attack. An attacker monitoring Switchboard VRF oracle state can predict the next epoch's tax rates before `consume_randomness` lands. They can then execute trades at the old (potentially more favorable) rates, knowing the new rates will change the equilibrium. This is specific to this protocol -- standard DEXes don't have VRF-derived asymmetric fees.

2. **Dual-curve grief attack**: The bonding curve's `prepare_transition` requires BOTH curves to be Filled. An attacker could buy MAX_TOKENS_PER_WALLET on the slower-filling curve from multiple wallets, then sell just before deadline, ensuring it fails to reach TARGET_TOKENS. Both curves would fail, triggering refunds and wasting the gas/effort of genuine participants. The 20M per-wallet cap limits this, requiring 23 wallets (460M / 20M) to fill a curve, so the attacker needs many wallets -- but this is trivially cheap on Solana.

3. **Carnage VRF predictability window**: Switchboard On-Demand reveals randomness publicly. Between the oracle reveal and the `consume_randomness` TX landing on-chain, the randomness bytes (and therefore whether Carnage triggers and which pool) are publicly known. A sophisticated MEV bot monitoring Switchboard account changes can front-run the consume_randomness TX with trades that profit from the predicted Carnage direction.

## Questions for Other Focus Areas

- For **Arithmetic focus**: Is the `as u64` cast in `calculate_output_floor` (line 164) provably safe? The comment says `floor <= reserve_out <= u64::MAX` but should this use `try_from`?
- For **CPI focus**: Does the sell path's wsol_intermediary close-at-line-295 and recreate-at-line-409 survive if a mid-instruction CPI fails? Anchor TX atomicity should protect, but verify.
- For **State Machine focus**: What happens if `taxes_confirmed` is false when swaps execute? Is this intentional? The Tax Program never checks it.
- For **Token/Economic focus**: Can the 50% output floor be lowered by an attacker who depletes one side of a pool in a prior instruction within the same TX?

## Raw Notes

### Sell Path AMM Minimum Analysis
```rust
// swap_sol_sell.rs:147
let amm_minimum: u64 = 0;
```
The comment at lines 146-147 says "Pass 0 for AMM's minimum_amount_out - we check slippage ourselves after tax." This is a deliberate design choice because:
1. The Tax Program needs to compute tax on the GROSS output (not the minimum)
2. The user's minimum_output applies to NET output (after tax), not gross
3. Passing user's minimum directly would be too restrictive (user expects to receive minimum AFTER tax deduction)

However, this creates a gap where the AMM provides no protection. The 50% output floor (SEC-10) is the primary defense, enforcing that the user's stated minimum must be >= 50% of expected output BEFORE the swap.

### Pool Reserve TOCTOU Detail
```
Time T0: read_pool_reserves() returns (reserve_a=1000, reserve_b=1000)
Time T0: calculate_output_floor -> floor = 45 for amount=100
Time T0: User's minimum_output=50 >= floor=45 -> PASS
[Front-runner moves price in prior instruction]
Time T1: AMM CPI executes with stale reserves (1500, 700 due to front-run)
Time T1: Actual output is much less than expected
```
The mitigation is that this all happens within a single instruction execution, so the "front-runner" would need to be in a prior instruction within the same transaction. Since the user builds the TX, they wouldn't include a front-run instruction. The risk is from validators/block producers who can insert instructions in the block before the user's TX. This is the standard sandwich vector and is not unique to this protocol.
