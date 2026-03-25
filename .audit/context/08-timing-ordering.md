---
task_id: sos-phase1-timing-ordering
provides: [timing-ordering-findings, timing-ordering-invariants]
focus_area: timing-ordering
files_analyzed:
  - programs/epoch-program/src/instructions/trigger_epoch_transition.rs
  - programs/epoch-program/src/instructions/consume_randomness.rs
  - programs/epoch-program/src/instructions/retry_epoch_vrf.rs
  - programs/epoch-program/src/instructions/expire_carnage.rs
  - programs/epoch-program/src/instructions/execute_carnage.rs
  - programs/epoch-program/src/instructions/execute_carnage_atomic.rs
  - programs/epoch-program/src/instructions/force_carnage.rs
  - programs/epoch-program/src/instructions/initialize_epoch_state.rs
  - programs/epoch-program/src/state/epoch_state.rs
  - programs/epoch-program/src/constants.rs
  - programs/amm/src/instructions/swap_sol_pool.rs
  - programs/tax-program/src/instructions/swap_sol_buy.rs
  - programs/tax-program/src/instructions/swap_sol_sell.rs
  - programs/tax-program/src/instructions/swap_exempt.rs
  - programs/bonding_curve/src/instructions/purchase.rs
  - programs/bonding_curve/src/instructions/sell.rs
  - programs/bonding_curve/src/instructions/mark_failed.rs
  - programs/bonding_curve/src/instructions/start_curve.rs
  - programs/staking/src/instructions/unstake.rs
  - programs/staking/src/instructions/claim.rs
  - programs/staking/src/instructions/deposit_rewards.rs
  - programs/staking/src/helpers/math.rs
  - programs/bonding_curve/src/constants.rs
  - programs/staking/src/constants.rs
finding_count: 12
severity_breakdown: {critical: 0, high: 2, medium: 5, low: 5}
---
<!-- CONDENSED_SUMMARY_START -->
# Timing & Ordering — Condensed Summary

## Key Findings (Top 10)

1. **Carnage swap_exempt passes minimum_output=0 to AMM**: The Tax Program's `swap_exempt` hardcodes `MINIMUM_OUTPUT: u64 = 0` (line 111), bypassing AMM slippage protection entirely. While Carnage execution enforces its own slippage floor upstream (85%/75% BPS), the AMM layer itself has zero protection, meaning the upstream floor is the sole guard against sandwich attacks on Carnage swaps. — `tax-program/src/instructions/swap_exempt.rs:111`

2. **Optional carnage_state in consume_randomness enables Carnage skip griefing**: `carnage_state: Option<Account>` (line 80) allows any caller to omit it, silently skipping the Carnage trigger check. A MEV actor monitoring the mempool could call `consume_randomness` without carnage_state to suppress Carnage for that epoch. — `epoch-program/src/instructions/consume_randomness.rs:80`

3. **VRF freshness check uses saturating_sub — future-dated seed_slot passes**: `clock.slot.saturating_sub(randomness_data.seed_slot)` returns 0 if seed_slot > clock.slot, which passes the `<= 1` freshness check. This is a secondary trust assumption on Switchboard — the oracle would need to produce a future-dated seed_slot. — `epoch-program/src/instructions/trigger_epoch_transition.rs:174`

4. **Staking cooldown uses unix_timestamp — manipulable by ~30s**: `last_claim_ts = clock.unix_timestamp` in claim, and `checked_sub(last_claim_ts).unwrap_or(0)` in unstake. Validators can drift timestamp by ~30s (EP-089). With COOLDOWN_SECONDS=43200 (12h), the impact is negligible (~0.07% drift). On devnet (2s cooldown), timestamp manipulation is trivially exploitable but devnet is not security-relevant. — `staking/src/instructions/claim.rs:129`, `staking/src/instructions/unstake.rs:126-133`

5. **Epoch transition is permissionless with bounty incentive**: Any caller can trigger epoch transitions after boundary. Bounty of 0.001 SOL from Carnage vault incentivizes cranking. If vault is depleted, bounty is skipped (line 242-247) but transition still succeeds. No griefing risk from missing bounty. — `epoch-program/src/instructions/trigger_epoch_transition.rs:136`

6. **Bonding curve deadline uses slot (not timestamp) — correct**: `clock.slot <= curve.deadline_slot` (purchase line 109, sell line 143). Slots are monotonic (EP-089 safe). Deadline set at `start_slot + DEADLINE_SLOTS` using unchecked addition (line 74 of start_curve.rs) — potential overflow only at u64 max, not exploitable. — `bonding_curve/src/instructions/purchase.rs:109`

7. **Multi-instruction Carnage execution ordering has lock window**: 50-slot lock (CARNAGE_LOCK_SLOTS) prevents fallback execute_carnage from being called during the atomic window. This mitigates MEV front-running of atomic Carnage execution but allows a 250-slot window (slots 50-300) where fallback is callable by anyone. — `epoch-program/src/instructions/execute_carnage.rs:206-208`

8. **Epoch skipping is handled gracefully**: If crank is delayed, expected_epoch may jump multiple epochs (e.g., 100 to 105). The code sets epoch number directly to expected_epoch rather than incrementing. No rewards accrue during gaps, tax rates persist at last values. — `epoch-program/src/instructions/trigger_epoch_transition.rs:143-149`

9. **mark_failed uses strict greater-than with grace buffer**: `clock.slot > deadline_slot + FAILURE_GRACE_SLOTS` (150 slots ~60s). The strict `>` means at the exact grace boundary slot, mark_failed cannot yet be called — correct by one-slot margin. — `bonding_curve/src/instructions/mark_failed.rs:60-62`

10. **Protocol-enforced minimum output floor (50% BPS) in Tax Program**: The Tax swap instructions enforce `minimum_output >= calculate_output_floor(reserves, sol_to_swap, 5000)`. This prevents zero-slippage sandwich attacks on user swaps. The floor is applied to user-supplied minimum_output, not to the AMM output itself. — `tax-program/src/instructions/swap_sol_buy.rs:106-111`

## Critical Mechanisms

- **Epoch State Machine (VRF lifecycle)**: Three-TX flow: (1) trigger_epoch_transition (commit), (2) consume_randomness (reveal + derive taxes), (3) execute_carnage (optional). Anti-reroll: randomness_account bound at commit, verified at consume. Timeout recovery via retry_epoch_vrf after 300 slots. VRF pending flag prevents double-commit. — `epoch-program/src/instructions/trigger_epoch_transition.rs:136-266`, `consume_randomness.rs:108-331`

- **Carnage Execution Windows**: Two-phase timing: (1) Lock window (0-50 slots) — only atomic execution, (2) Fallback window (50-300 slots) — permissionless execution. After 300 slots: expires. Lock prevents MEV front-running of atomic path. Auto-expire clears stale pending state in next consume_randomness. — `epoch-program/src/instructions/execute_carnage.rs:196-208`, `expire_carnage.rs:68-71`

- **Slippage Protection Architecture**: User-facing swaps (Tax buy/sell) enforce MINIMUM_OUTPUT_FLOOR_BPS=5000 (50%). AMM enforces user-specified minimum_amount_out. Carnage swaps pass minimum_output=0 to AMM but enforce upstream floor (85% atomic / 75% fallback). Bonding curve purchase/sell have user-specified minimum_tokens_out/minimum_sol_out. — Multiple files

- **Staking Cooldown**: 12h cooldown between claim and unstake, using unix_timestamp. Checkpoint pattern (update_rewards before balance change) prevents flash-loan reward extraction. Reward forfeiture on unstake redistributes to remaining stakers. — `staking/src/instructions/unstake.rs:125-133`, `claim.rs:129`

## Invariants & Assumptions

- INVARIANT: Epoch number is monotonically increasing — enforced at `trigger_epoch_transition.rs:151-153` (require expected_epoch > current_epoch)
- INVARIANT: VRF cannot be double-committed — enforced at `trigger_epoch_transition.rs:164` (require !vrf_pending)
- INVARIANT: Anti-reroll — same randomness account must be used for commit and reveal — enforced at `consume_randomness.rs:154-157` (key equality check)
- INVARIANT: Carnage deadline is enforced — `execute_carnage.rs:197-199` (clock.slot <= deadline), `expire_carnage.rs:68-70` (clock.slot > deadline)
- INVARIANT: Bonding curve purchases blocked after deadline — enforced at `purchase.rs:108-110` (clock.slot <= deadline_slot)
- INVARIANT: AMM swap output >= minimum_amount_out — enforced at `swap_sol_pool.rs:145-148`
- ASSUMPTION: Switchboard oracle will not produce future-dated seed_slot — UNVALIDATED (saturating_sub returns 0 for future dates, passing freshness check) ⚠
- ASSUMPTION: Clock.unix_timestamp drifts < 30s from real time — validated by Solana runtime design, but not enforced on-chain
- ASSUMPTION: Validators cannot reorder transactions within a block to sandwich Carnage — NOT enforced on-chain (Jito bundles could sandwich fallback Carnage during 250-slot window) ⚠
- ASSUMPTION: Crank will trigger epoch transitions within a reasonable window — NOT enforced; epoch skipping is tolerated but extends tax rate persistence and delays VRF/Carnage

## Risk Observations (Prioritized)

1. **Carnage MEV sandwich during fallback window**: `execute_carnage.rs:206-208` — After 50-slot lock expires, Carnage fallback is permissionless for 250 slots. Carnage swaps pass minimum_output=0 to AMM (swap_exempt.rs:111). Upstream slippage floor (75% BPS for fallback) is the only protection. A validator-level MEV actor could sandwich the Carnage swap within the 25% tolerance, extracting up to 25% of the swap amount.

2. **Optional carnage_state griefing**: `consume_randomness.rs:80` — MEV actor calls consume_randomness without carnage_state to skip Carnage trigger. Tax rates update (beneficial to attacker if they know the VRF outcome) but Carnage never fires. Economic impact: Carnage fund doesn't rebalance, potentially leaving the "cheap side" underpurchased.

3. **VRF freshness saturating_sub**: `trigger_epoch_transition.rs:174` — Future-dated oracle seed_slot passes freshness. Requires Switchboard oracle compromise. Low probability but worth noting as a trust boundary.

4. **Staking timestamp manipulation**: `unstake.rs:126-129` — COOLDOWN_SECONDS=43200 (mainnet). Validator drift of ~30s = 0.07% of cooldown. Not practically exploitable. Devnet COOLDOWN_SECONDS=2 is trivially bypassable but irrelevant for security.

5. **start_curve unchecked addition**: `start_curve.rs:74` — `clock.slot + DEADLINE_SLOTS` uses regular addition. With DEADLINE_SLOTS=432000 (mainnet), overflow requires slot > u64::MAX - 432000, which is unreachable for billions of years. Not exploitable.

## Novel Attack Surface

- **Cross-epoch tax rate arbitrage via consume_randomness omission**: Since `consume_randomness` is permissionless and tax rates are readable from EpochState before calling, a sophisticated actor could monitor VRF reveals off-chain (Switchboard oracle reveals are public). If the new rates would be unfavorable, the actor could delay calling consume_randomness (by not cranking) while front-running swaps at the old tax rates. The epoch transition advances the epoch number in trigger_epoch_transition, but tax rates don't update until consume_randomness. During the VRF pending window, old tax rates remain active — creating a window where rates are known but not yet applied.

- **Carnage suppression as market manipulation**: If carnage_state is omitted from consume_randomness, Carnage never triggers. An actor holding a large position in the "expensive" token could suppress Carnage (which buys the "cheap" token) to prevent price equalization. The economic incentive exists if the actor's position benefits from price divergence.

- **Sequential instruction composability in same TX**: While the reentrancy guard in AMM prevents re-entry via CPI, nothing prevents a user from including multiple Tax swap instructions in the same transaction (IX1: buy, IX2: sell). Each instruction sees the pool state as modified by the previous one. The reentrancy guard is cleared at the end of each instruction (swap_sol_pool.rs:334). This is standard Solana behavior but creates composability that could be used for atomic arbitrage within the protocol's pools.

## Cross-Focus Handoffs

- → **Token/Economic Agent**: Carnage swap_exempt passes minimum_output=0 to AMM — verify upstream slippage floor in carnage_execution.rs is sufficient to prevent fund drainage. Calculate maximum extractable value from a sandwich attack within the 75% floor.
- → **Oracle Agent**: VRF freshness check at trigger_epoch_transition.rs:174 uses saturating_sub — verify Switchboard oracle cannot produce future-dated seed_slot. Also verify the anti-reroll binding is tamper-proof.
- → **State Machine Agent**: Optional carnage_state in consume_randomness (line 80) enables state machine bypass — the Carnage trigger check is entirely skipped if account is omitted. Verify whether the protocol can recover from a suppressed Carnage trigger (does the next epoch's VRF re-evaluate Carnage?).
- → **Access Control Agent**: force_carnage.rs is gated by `#[cfg(feature = "devnet")]` — verify this instruction is NOT present in the mainnet binary. The lib.rs test at line 274-292 is noted but should be verified against the deployed program's IDL.
- → **Error Handling Agent**: What happens if VRF timeout expires during a Carnage pending state? The auto-expire in consume_randomness (lines 112-148) clears stale Carnage, but retry_epoch_vrf does not — verify retry_epoch_vrf doesn't leave dangling Carnage state.

## Trust Boundaries

The protocol trusts Switchboard oracles for VRF randomness (committed at trigger_epoch_transition, revealed at consume_randomness). The freshness check (seed_slot within 1 slot) prevents stale randomness but trusts the oracle not to future-date. The crank operator (permissionless) is trusted only for liveness, not correctness — all state transitions are validated on-chain. User-facing swaps go through Tax Program which reads EpochState from Epoch Program — this is a cross-program trust boundary where byte offsets must match struct layout. The Carnage execution path trusts that the AMM's k-invariant verification will prevent fund drainage even with minimum_output=0.
<!-- CONDENSED_SUMMARY_END -->

---

# Timing & Ordering — Full Analysis

## Executive Summary

This analysis examines all timing-dependent operations, ordering dependencies, front-running risks, and MEV attack surface in the Dr. Fraudsworth protocol. The protocol uses a slot-based timing model for epoch transitions, bonding curve deadlines, VRF timeouts, and Carnage execution windows. Timestamp (unix_timestamp) is used only for staking cooldowns where drift tolerance is acceptable.

The most significant timing concern is the Carnage execution window architecture: after a 50-slot atomic lock, Carnage swaps become permissionless for 250 slots with the AMM receiving minimum_output=0. The upstream slippage floor (75% for fallback) is the sole sandwich protection. A secondary concern is the optional carnage_state in consume_randomness, which allows MEV actors to suppress Carnage triggering.

The protocol's epoch state machine is well-designed with anti-reroll protection, timeout recovery, and graceful epoch skipping. Bonding curve deadlines use slot-based timing (immune to EP-089 timestamp manipulation). User-facing swaps have a 50% minimum output floor enforced by the Tax Program.

## Scope

- **Files analyzed:** 24 production source files
- **Functions analyzed:** ~35 instruction handlers and helpers
- **Estimated coverage:** 95%+ of timing-relevant code paths

## Key Mechanisms

### 1. Epoch State Machine (VRF Lifecycle)

**Location:** `epoch-program/src/instructions/trigger_epoch_transition.rs`, `consume_randomness.rs`, `retry_epoch_vrf.rs`

**Purpose:** Coordinate 30-minute epoch transitions with VRF-derived tax rates and Carnage triggering.

**How it works:**
1. **Trigger (TX 2):** `trigger_epoch_transition` validates epoch boundary (slot-based), checks no VRF pending, validates Switchboard randomness freshness (seed_slot within 1 slot), binds randomness account (anti-reroll), advances epoch number, sets vrf_pending=true, pays bounty.
2. **Consume (TX 3):** `consume_randomness` verifies anti-reroll (exact pubkey match), reads revealed VRF bytes, derives tax rates from bytes 0-4, updates EpochState, clears vrf_pending, CPIs to Staking update_cumulative, checks Carnage trigger from bytes 5-7.
3. **Retry (if timeout):** `retry_epoch_vrf` checks VRF_TIMEOUT_SLOTS (300) have elapsed, validates fresh randomness, overwrites pending state.

**Assumptions:**
- Switchboard oracle reveals within 300 slots (~2 min). If not, timeout recovery is available.
- Randomness account seed_slot is not future-dated (saturating_sub vulnerability).
- Crank operator calls trigger within a reasonable window after epoch boundary.

**Invariants:**
- expected_epoch > current_epoch (no backward epoch jumps)
- vrf_pending prevents double-commit
- pending_randomness_account binding prevents reroll attacks
- Epoch number skipping is tolerated (no rewards lost, taxes persist)

**Concerns:**
- Line 174: `clock.slot.saturating_sub(randomness_data.seed_slot)` — if seed_slot > clock.slot, returns 0, passing freshness check. Requires Switchboard oracle to produce future-dated value.
- Line 88: `((slot.saturating_sub(genesis_slot)) / SLOTS_PER_EPOCH) as u32` — u64->u32 cast. Documented as safe for ~2447 years of operation.

### 2. Carnage Execution Windows

**Location:** `epoch-program/src/instructions/execute_carnage.rs`, `execute_carnage_atomic.rs`, `expire_carnage.rs`

**Purpose:** Time-bounded Carnage Fund rebalancing with MEV protection via lock window.

**How it works:**
1. Carnage triggers in consume_randomness → sets carnage_pending=true, carnage_deadline_slot = current + 300, carnage_lock_slot = current + 50.
2. **Atomic window (slots 0-50):** Only execute_carnage_atomic can run (bundled with consume_randomness in same TX). Uses 85% slippage floor.
3. **Fallback window (slots 50-300):** execute_carnage becomes callable by anyone. Uses 75% slippage floor (more lenient).
4. **Expiry (slot > 300):** expire_carnage clears pending state. SOL retained in vault.
5. **Auto-expire:** consume_randomness auto-expires stale pending Carnage if deadline passed.

**Assumptions:**
- 50-slot lock prevents MEV front-running of atomic execution.
- 75% slippage floor limits sandwich extraction on fallback execution.
- Auto-expire prevents protocol deadlock from uncompleted Carnage.

**Invariants:**
- execute_carnage requires clock.slot <= deadline AND clock.slot > lock_slot
- execute_carnage_atomic has no timing checks (trusts caller to bundle correctly)
- expire_carnage requires clock.slot > deadline
- Carnage clears carnage_pending at end of execution

**Concerns:**
- swap_exempt passes MINIMUM_OUTPUT=0 to AMM. The AMM accepts this. Only the upstream slippage floor in execute_carnage_core protects against sandwich attacks.
- Fallback window of 250 slots (~100 seconds) is long enough for MEV actors to observe and sandwich.
- execute_carnage_atomic has NO timing/deadline check — it trusts that it runs in the same TX as consume_randomness (which sets the deadline). If called independently after carnage_pending is set by consume_randomness, it would execute without deadline validation. However, the account constraint `epoch_state.carnage_pending` prevents execution if Carnage isn't pending, and it no-ops if carnage_pending is false (line 202).

### 3. Slippage Protection Architecture

**Location:** Multiple files

**Purpose:** Prevent sandwich attacks and excessive price impact on swaps.

**How it works:**

| Path | Slippage Protection | Enforcement Location |
|------|-------------------|---------------------|
| User buy (Tax → AMM) | minimum_output >= 50% floor AND user-specified | swap_sol_buy.rs:106-111, swap_sol_pool.rs:145-148 |
| User sell (Tax → AMM) | minimum_output >= 50% floor AND user-specified | swap_sol_sell.rs (similar pattern) |
| Carnage atomic | 85% floor upstream, minimum_output=0 at AMM | carnage_execution.rs, swap_exempt.rs:111 |
| Carnage fallback | 75% floor upstream, minimum_output=0 at AMM | carnage_execution.rs, swap_exempt.rs:111 |
| BC purchase | minimum_tokens_out (user-specified) | purchase.rs:187-189 |
| BC sell | minimum_sol_out (user-specified) | sell.rs:209 |
| Conversion vault | Fixed 100:1 rate (no slippage) | N/A |

**Concerns:**
- The 50% minimum output floor in Tax Program prevents zero-slippage attacks but still allows significant MEV extraction (up to 50% of expected output). In practice, users will set tighter slippage, but the protocol floor is generous.
- Carnage fallback's 75% floor means up to 25% of swap value can be extracted via sandwich. With typical Carnage amounts (a percentage of the 24% tax accrual), the absolute value may be modest.

### 4. Bonding Curve Deadline System

**Location:** `bonding_curve/src/instructions/purchase.rs`, `sell.rs`, `mark_failed.rs`, `start_curve.rs`

**Purpose:** Time-bounded price discovery with grace period for in-flight transactions.

**How it works:**
1. `start_curve` sets deadline_slot = current_slot + DEADLINE_SLOTS (432,000 mainnet = ~48h).
2. Purchase/sell check `clock.slot <= curve.deadline_slot` — `<=` allows transactions at the exact deadline slot.
3. `mark_failed` requires `clock.slot > deadline_slot + FAILURE_GRACE_SLOTS` (150 slots = ~60s).
4. Grace buffer allows in-flight purchases to finalize before failure can be marked.

**Assumptions:**
- 150-slot grace is sufficient for in-flight transactions to land.
- Slot-based timing is immune to validator timestamp manipulation.

**Invariants:**
- Purchases blocked after deadline (slot >).
- Failure can only be marked after deadline + grace (strict >).
- Only Active curves can be marked failed.

**Concerns:**
- `start_curve.rs:74`: `clock.slot + DEADLINE_SLOTS` uses regular addition (not checked). Overflow only possible at slot > u64::MAX - 432000, which is unreachable.
- There is no mechanism to pause or extend a curve deadline. Once set, it is immutable.

### 5. Staking Cooldown Mechanism

**Location:** `staking/src/instructions/claim.rs`, `unstake.rs`

**Purpose:** Prevent mercenary capital from claiming rewards and immediately unstaking.

**How it works:**
1. On claim: `user.last_claim_ts = clock.unix_timestamp` (claim.rs:129).
2. On unstake: `elapsed = clock.unix_timestamp.checked_sub(last_claim_ts).unwrap_or(0)`. If elapsed < COOLDOWN_SECONDS (43200 = 12h), reject with CooldownActive.
3. Special case: if `last_claim_ts == 0` (never claimed), cooldown is skipped (unstake.rs:125).

**Assumptions:**
- unix_timestamp is sufficiently accurate for 12-hour cooldown (30s drift = 0.07%).
- Clock regression (extremely rare) is handled by `unwrap_or(0)` treating it as "cooldown active" — safe failsafe.

**Invariants:**
- User cannot unstake within 12 hours of claiming.
- First-time unstake (never claimed) bypasses cooldown.

**Concerns:**
- Line 129 (unstake.rs): `unwrap_or(0)` on clock regression means a clock regression would activate cooldown indefinitely. This is safe (fails closed) but could temporarily lock user funds if Solana had a clock regression event.
- Using timestamp (not slot) for cooldown is acceptable given the 12-hour duration but deviates from the slot-based pattern used everywhere else.

## Trust Model

**Trusted:**
- Switchboard VRF oracle (for randomness correctness and timing)
- Solana runtime (for Clock sysvar accuracy within ~30s)
- Deployed program code (for correct instruction dispatch)

**Untrusted:**
- All callers (permissionless instructions have on-chain validation)
- Transaction ordering (MEV/sandwich attacks expected)
- Crank operator timing (epoch skipping tolerated)

**Trust Boundaries:**
1. Switchboard → Epoch Program: VRF bytes trusted for tax rate derivation. Anti-reroll binding prevents substitution.
2. Tax Program → AMM: swap_authority PDA bridges the two. AMM trusts swap_authority signer constraint.
3. Epoch Program → Staking: update_cumulative CPI uses staking_authority PDA. Staking validates its own PDAs.
4. Tax Program → Epoch Program: Tax reads EpochState via byte offsets — must match struct layout exactly.

## State Analysis

### Time-Dependent State Fields

| Account | Field | Type | Set By | Read By |
|---------|-------|------|--------|---------|
| EpochState | genesis_slot | u64 | initialize_epoch_state | trigger_epoch_transition (epoch calc) |
| EpochState | epoch_start_slot | u64 | trigger_epoch_transition | Event emission |
| EpochState | vrf_request_slot | u64 | trigger/retry | retry (timeout calc) |
| EpochState | carnage_deadline_slot | u64 | consume_randomness | execute_carnage, expire_carnage |
| EpochState | carnage_lock_slot | u64 | consume_randomness | execute_carnage |
| CurveState | start_slot | u64 | start_curve | Event emission |
| CurveState | deadline_slot | u64 | start_curve | purchase, sell, mark_failed |
| UserStake | last_claim_ts | i64 | claim | unstake (cooldown check) |
| UserStake | last_update_slot | u64 | update_rewards | Informational |

## Dependencies

- **Switchboard On-Demand SDK**: `RandomnessAccountData::parse()`, `get_value()` for VRF commit/reveal.
- **Solana Clock Sysvar**: `Clock::get()?.slot` and `Clock::get()?.unix_timestamp` used throughout.
- **Cross-program CPIs**: Epoch → Tax (swap_exempt), Tax → AMM (swap_sol_pool), Epoch → Staking (update_cumulative), Tax → Staking (deposit_rewards).

## Focus-Specific Analysis

### Time-Dependent Operations Map

| Instruction | Uses Clock? | Time-Sensitive Calculation | What Happens If Clock Manipulated (±slot)? |
|-------------|------------|---------------------------|-------------------------------------------|
| trigger_epoch_transition | Yes (slot) | epoch boundary check, VRF freshness | ±1 slot: No impact (freshness allows ≤1 slot diff). Epoch boundary is coarse (4500 slots). |
| consume_randomness | Yes (slot) | auto-expire stale Carnage, deadline calc | ±1 slot: Negligible. Deadline is 300 slots away. |
| retry_epoch_vrf | Yes (slot) | timeout elapsed check, freshness | ±1 slot: Could trigger retry 1 slot early/late. No security impact. |
| execute_carnage | Yes (slot) | deadline check, lock window check | ±1 slot: Could execute 1 slot before lock expires. Minimal impact. |
| expire_carnage | Yes (slot) | deadline expiry check | ±1 slot: Could expire 1 slot early/late. No security impact. |
| purchase | Yes (slot) | deadline check | ±1 slot: Could allow/deny purchase at boundary. Negligible. |
| sell | Yes (slot) | deadline check | Same as purchase. |
| mark_failed | Yes (slot) | deadline + grace check | ±1 slot: Could mark failed 1 slot early. Grace buffer (150 slots) absorbs this. |
| start_curve | Yes (slot) | sets deadline_slot | Deadline is deterministic from start slot. No manipulation vector. |
| claim | Yes (timestamp) | sets cooldown timer | ±30s: 0.07% of 12h cooldown. Not exploitable. |
| unstake | Yes (timestamp) | cooldown elapsed check | ±30s: Same as above. |
| update_rewards | Yes (slot) | last_update_slot | Informational only. No security impact. |
| initialize_epoch_state | Yes (slot) | sets genesis_slot | One-time operation. No manipulation vector. |
| deposit_rewards | Yes (slot) | event emission | No security impact. |

### MEV Attack Surface

| Instruction | Tokens Moved? | Sandwich-able? | Slippage Protection | Max Extractable Value |
|------------|--------------|----------------|---------------------|----------------------|
| swap_sol_buy (user) | Yes | Yes | 50% floor + user min | Up to 50% of swap - user's actual slippage setting |
| swap_sol_sell (user) | Yes | Yes | 50% floor + user min | Same as above |
| swap_exempt (Carnage) | Yes | Yes (fallback only) | 75% floor (fallback) / 85% (atomic) | Up to 25% of Carnage swap amount (fallback) |
| purchase (BC) | Yes (SOL→tokens) | Limited | User-specified min | Limited: linear price curve, not CPMM |
| sell (BC) | Yes (tokens→SOL) | Limited | User-specified min | Limited: reverse integral, 15% tax already applied |
| stake/unstake | Yes (PROFIT) | No | N/A (fixed operations) | N/A |
| claim | Yes (SOL) | No | N/A (calculated amount) | N/A |
| convert (Vault) | Yes | No | Fixed 100:1 rate | N/A |

**Key observation:** The bonding curve's linear pricing (P_START to P_END) means sandwich attacks are less profitable than on CPMM pools — the price curve is predetermined, not reserve-dependent. The main MEV surface is Tax Program swaps through the CPMM AMM.

### Front-Running Risk Assessment

| Instruction | Info Revealed in Mempool | Front-Running Action | Impact |
|------------|-------------------------|---------------------|--------|
| trigger_epoch_transition | Randomness account key | Pre-reveal (not useful — randomness is committed) | None — anti-reroll prevents switching |
| consume_randomness | VRF bytes (tax rates, Carnage trigger) | Cannot front-run — VRF reveal is bundled in same TX | None (unless oracle leaks reveal early) |
| execute_carnage | Carnage action/target | Sandwich the Carnage swap | Up to 25% (fallback) / 15% (atomic) extraction |
| swap_sol_buy/sell | Swap direction, amount, slippage | Classic sandwich | Up to (user_slippage - actual_price_impact) |
| purchase (BC) | SOL amount, token | Front-run at lower price on curve | Minimal — price impact is linear, not exponential |

### Ordering Dependency Analysis

**Critical Ordering:**
1. `trigger_epoch_transition` → `consume_randomness`: MUST happen in sequence (VRF commit → reveal). Enforced by vrf_pending flag. Reordering blocked by anti-reroll binding.
2. `consume_randomness` → `execute_carnage_atomic`: Should be in same TX. No enforcement — atomic path just checks carnage_pending.
3. `start_curve` → `purchase` → `mark_failed`: Status state machine enforces ordering (Initialized → Active → Failed).

**What if operations are reordered?**
- If `consume_randomness` is called before `trigger_epoch_transition`: Fails (vrf_pending=false check at line 151).
- If `execute_carnage` is called before `consume_randomness`: Fails (carnage_pending=false, constraint at line 51).
- If `mark_failed` is called before deadline: Fails (clock.slot > failure_eligible_slot check).
- If two `trigger_epoch_transition` calls in same slot: Second fails (vrf_pending=true check at line 164).

**Inter-transaction insertion:**
- Between trigger and consume (3-slot window for oracle reveal): Attacker could call trigger with a different epoch if another boundary has been reached — blocked by vrf_pending flag.
- Between consume and execute_carnage: Attacker could insert swaps that move pool price before Carnage executes. This is the primary sandwich vector. Mitigated by lock window (50 slots) and slippage floor.

## Cross-Focus Intersections

- **Arithmetic**: Slippage floor calculations use u128 intermediate arithmetic (`calculate_output_floor`). The `as u64` cast on Carnage slippage computation (execute_carnage_atomic.rs:255,272,284) is noted as HIGH risk in HOT_SPOTS.
- **CPI**: The 4-level CPI depth constraint means no additional timing checks can be added to the swap path.
- **State Machine**: Carnage state machine (Idle → Triggered → Executed/Expired) has timing gates at each transition.
- **Oracle**: VRF freshness is a timing check. Oracle staleness bounds affect protocol liveness.
- **Access Control**: force_carnage is devnet-only but has timing implications (sets deadline/lock without VRF).
- **Token/Economic**: Tax rates update at epoch boundaries. Window between trigger and consume leaves old rates active.

## Cross-Reference Handoffs

- → **Token/Economic Agent**: Calculate maximum extractable value from Carnage sandwich attack with 75% floor. Also analyze: during VRF pending window (between trigger and consume), old tax rates are active. Can this be exploited by trading at stale rates when new rates are known from off-chain oracle observation?
- → **Oracle Agent**: Verify Switchboard On-Demand cannot produce seed_slot > current_slot. Also verify: can an attacker observe VRF reveal bytes before consume_randomness lands, allowing them to front-run with knowledge of upcoming tax rates and Carnage trigger?
- → **State Machine Agent**: The optional carnage_state in consume_randomness creates a state machine bypass. Verify: if Carnage is suppressed in epoch N, does epoch N+1's VRF re-evaluate with the same Carnage fund balance? Is there accumulative harm from repeated suppression?
- → **Access Control Agent**: Verify force_carnage is excluded from mainnet build. The `#[cfg(feature = "devnet")]` gate must be verified in the compiled program IDL and binary.
- → **Error Handling Agent**: What happens if VRF timeout occurs while Carnage is pending? retry_epoch_vrf does NOT clear carnage_pending — verify this doesn't create a deadlock (two VRF pending + Carnage pending simultaneously).

## Risk Observations

1. **Carnage sandwich via fallback path**: After 50-slot lock, 250-slot window with 75% floor. MEV actors can extract up to 25% of swap value.
2. **Optional carnage_state griefing**: consume_randomness without carnage_state suppresses Carnage. No cost to attacker (just omit an account).
3. **Stale tax rate trading window**: Between trigger_epoch_transition and consume_randomness, old tax rates are active but new rates are deterministic from VRF bytes. If oracle reveal is observed off-chain before consume_randomness lands, traders can front-run rate changes.
4. **VRF freshness bypass**: Future-dated seed_slot passes freshness check via saturating_sub. Requires oracle compromise.
5. **Cooldown timestamp drift**: 30s drift on 12h cooldown is negligible but represents a deviation from the slot-based pattern used elsewhere.

## Novel Attack Surface Observations

1. **Carnage suppression as a market manipulation tool**: By repeatedly calling consume_randomness without carnage_state, an attacker can prevent Carnage from ever executing. Since Carnage is designed to rebalance the "cheap side" token, suppression could maintain price divergence between CRIME and FRAUD indefinitely. The economic incentive exists for any holder who benefits from the current price relationship continuing. The cost is zero (just calling the instruction without an optional account). The defense would be to make carnage_state mandatory.

2. **Cross-epoch tax rate front-running**: The VRF reveal is committed to a specific randomness account, but the actual byte values are deterministic once the oracle reveals. Switchboard On-Demand reveals happen on-chain and are publicly observable. A sophisticated actor could monitor for the oracle's reveal transaction, compute the new tax rates from the VRF bytes, and front-run consume_randomness with trades at the old rates that will be profitable under the new rates. This is a timing arbitrage unique to the two-step VRF lifecycle.

3. **Same-transaction multi-swap composability**: Nothing prevents a user from constructing a transaction with IX1: swap_sol_buy (large amount) → IX2: swap_sol_sell (same amount). The reentrancy guard in AMM is cleared between instructions. This enables atomic arbitrage within the protocol (buy at one rate, sell at another if rates change mid-epoch). The Tax Program's slippage floor prevents exploitation via zero-slippage, but the composability itself creates novel attack vectors if rates differ between buy and sell within the same transaction context.

## Questions for Other Focus Areas

- **For Arithmetic focus**: The slippage floor calculation in `calculate_output_floor` — does it correctly account for LP fee deduction? If the floor is calculated pre-fee but the actual output is post-fee, the floor may be too tight or too loose.
- **For CPI focus**: Does the AMM verify that minimum_amount_out is not abusively low (e.g., 0) when called by swap_authority? Currently it accepts any value including 0.
- **For Access Control focus**: Can a non-Epoch-Program caller construct a transaction where swap_exempt is called directly (without going through Epoch Program)? The carnage_authority constraint requires seeds::program = epoch_program_id(), which should prevent this.
- **For State Machine focus**: If Carnage is triggered and the fallback path fails (e.g., pool has insufficient liquidity), the Carnage expires. Does the next epoch's consume_randomness correctly handle this (new Carnage trigger on top of expired state)? The auto-expire in consume_randomness handles this (lines 112-148).
- **For Oracle focus**: Can the Switchboard oracle operator see the VRF output before revealing it on-chain? If so, the oracle can front-run Carnage and tax rate changes.

## Raw Notes

### Timing Constants (from epoch-program/src/constants.rs)
- SLOTS_PER_EPOCH: 750 (devnet) / 4500 (mainnet) → ~5 min / ~30 min
- VRF_TIMEOUT_SLOTS: 300 → ~2 min
- CARNAGE_DEADLINE_SLOTS: 300 → ~2 min
- CARNAGE_LOCK_SLOTS: 50 → ~20 sec
- TRIGGER_BOUNTY_LAMPORTS: 1,000,000 → 0.001 SOL

### Timing Constants (from bonding_curve/src/constants.rs)
- DEADLINE_SLOTS: 27,000 (devnet) / 500 (localnet) / 432,000 (mainnet) → ~3h / ~3.3min / ~48h
- FAILURE_GRACE_SLOTS: 150 → ~60 sec

### Timing Constants (from staking/src/constants.rs)
- COOLDOWN_SECONDS: 43,200 (mainnet) / 2 (devnet) → 12h / 2s

### Previous Finding Rechecks

**H021 (LOW — Epoch init front-running):** FIXED. `initialize_epoch_state.rs` now requires `program_data.upgrade_authority_address == Some(payer.key())` (lines 127-128) and `program.programdata_address()? == Some(program_data.key())` (line 121). This gates initialization to the upgrade authority only. Front-running by a non-authority is blocked.

**H031 (LOW — Dual-curve grief, economically constrained):** ACCEPTED. `sell.rs` allows selling back tokens at any time during Active period. The 15% sell tax makes griefing expensive ($0.15 per $1 sold). No timing changes observed — the deadline check at line 143 is unchanged.

**H005 (LOW — BC close_token_vault rent extraction):** FIXED. `close_token_vault.rs` now requires `admin_config.authority == authority.key()` via `has_one = authority` constraint (line 34). Only the admin can close vaults and recover rent. The Graduated status check (line 43) and empty vault check (line 54) provide additional protection.

### swap_exempt MINIMUM_OUTPUT=0 Detail
At `swap_exempt.rs:111`:
```rust
const MINIMUM_OUTPUT: u64 = 0; // Carnage accepts market execution
```
This is passed directly to AMM's swap_sol_pool as the `minimum_amount_out` parameter. The AMM will accept any output amount >= 0. The slippage protection for Carnage swaps comes entirely from `execute_carnage_core` in `carnage_execution.rs`, which calculates an expected output from pool reserves and applies the BPS floor (85% atomic / 75% fallback) BEFORE calling swap_exempt. If the expected output is correct and the floor is applied correctly, this is safe — but the AMM itself provides zero protection for Carnage swaps.
