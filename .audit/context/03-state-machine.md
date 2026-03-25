---
task_id: sos-phase1-state-machine
provides: [state-machine-findings, state-machine-invariants]
focus_area: state-machine
files_analyzed: [epoch-program/src/state/epoch_state.rs, epoch-program/src/state/carnage_fund_state.rs, epoch-program/src/state/enums.rs, epoch-program/src/instructions/initialize_epoch_state.rs, epoch-program/src/instructions/trigger_epoch_transition.rs, epoch-program/src/instructions/consume_randomness.rs, epoch-program/src/instructions/execute_carnage_atomic.rs, epoch-program/src/instructions/execute_carnage.rs, epoch-program/src/instructions/expire_carnage.rs, epoch-program/src/instructions/force_carnage.rs, epoch-program/src/instructions/retry_epoch_vrf.rs, epoch-program/src/helpers/carnage_execution.rs, tax-program/src/state/epoch_state_reader.rs, tax-program/src/helpers/pool_reader.rs, staking/src/state/stake_pool.rs, staking/src/state/user_stake.rs, staking/src/instructions/stake.rs, staking/src/instructions/unstake.rs, staking/src/instructions/claim.rs, staking/src/instructions/deposit_rewards.rs, staking/src/instructions/update_cumulative.rs, bonding_curve/src/state.rs, bonding_curve/src/instructions/start_curve.rs, bonding_curve/src/instructions/purchase.rs, bonding_curve/src/instructions/mark_failed.rs, bonding_curve/src/instructions/prepare_transition.rs, bonding_curve/src/instructions/close_token_vault.rs, amm/src/state/pool.rs, amm/src/instructions/swap_sol_pool.rs, transfer-hook/src/state/whitelist_authority.rs, tests/cross-crate/src/lib.rs]
finding_count: 12
severity_breakdown: {critical: 0, high: 3, medium: 6, low: 3}
---
<!-- CONDENSED_SUMMARY_START -->
# State Machine & Error Handling -- Condensed Summary

## Key Findings (Top 10)
1. **Optional CarnageState in consume_randomness allows Carnage skip**: A caller can omit `carnage_state` to suppress Carnage triggering while still advancing taxes -- `consume_randomness.rs:76-80`
2. **carnage_lock_slot not explicitly initialized**: `initialize_epoch_state.rs` does not set `carnage_lock_slot` to 0. Anchor `init` zero-fills, so it is safe in practice, but it deviates from the explicit initialization pattern used for every other field -- `initialize_epoch_state.rs:68-75`
3. **carnage_target not cleared on expire/auto-expire**: When Carnage expires, `carnage_pending` and `carnage_action` are cleared but `carnage_target` retains its stale value -- `expire_carnage.rs:88-89`, `consume_randomness.rs:126-127`
4. **held_token matched as raw u8 without CarnageAction/HeldToken from_u8**: In `burn_held_tokens`, `held_token` is matched directly as `1`/`2`/`_` without going through `HeldToken::from_u8()`, bypassing the enum's validation -- `carnage_execution.rs:477-481`
5. **Epoch skipping silently accepted**: `trigger_epoch_transition` allows jumping from epoch N to N+K (K>1) with no intermediate processing, meaning staking rewards for skipped epochs are silently forfeited -- `trigger_epoch_transition.rs:143-153`
6. **Cross-program EpochState layout now has parity tests (S007 FIXED)**: `tests/cross-crate/src/lib.rs` round-trip tests plus compile-time `DATA_LEN == 164` assertions on both sides confirm layout parity -- `epoch_state_reader.rs:64`, `epoch_state.rs:187`
7. **H011 recheck: epoch_state_reader.rs still safe**: The mirror struct matches field-for-field with `#[repr(C)]` on both, identical DATA_LEN assertions, and cross-crate round-trip tests. No layout corruption risk detected.
8. **AMM reentrancy guard is belt-and-suspenders**: `pool.locked` set at swap entry, cleared at exit. Solana's runtime already prevents same-account reentry via CPI. Guard provides explicit defense-in-depth -- `swap_sol_pool.rs:84`
9. **Bonding curve has no backward state transitions**: CurveStatus enum transitions are strictly forward (Initialized->Active->Filled->Graduated, Active->Failed). No instruction can move a curve backward. Terminal states (Graduated, Failed) have no exit.
10. **No pause/freeze mechanism exists for any program**: No `is_paused`, `frozen`, or emergency stop pattern was found in any production program. Protocol cannot be halted short of upgrade authority patching.

## Critical Mechanisms
- **Epoch VRF State Machine**: Governs tax rate changes via 3-TX flow: trigger (commit) -> consume (reveal) -> next epoch. Anti-reroll protection binds the randomness account at commit time. VRF pending flag prevents double-commit. Timeout recovery via `retry_epoch_vrf` after 300 slots. -- `trigger_epoch_transition.rs`, `consume_randomness.rs`, `retry_epoch_vrf.rs`
- **Carnage State Machine**: Nested within EpochState. States: Idle -> Triggered (via VRF in consume_randomness) -> Executed (via execute_carnage_*) or Expired (via expire_carnage or auto-expire). Lock window (50 slots) gives atomic bundled execution priority before permissionless fallback. -- `consume_randomness.rs:289-314`, `execute_carnage_atomic.rs:202`, `execute_carnage.rs:206-209`, `expire_carnage.rs:68-71`
- **Bonding Curve Lifecycle**: 5 states, strictly forward. Initialized->Active (admin: start_curve), Active->Filled (automatic at TARGET_TOKENS), Active->Failed (permissionless after deadline+grace), Filled->Graduated (admin: prepare_transition on both curves). Refunds only from Failed, or Filled-with-Failed-partner. -- `state.rs:44-69`, `purchase.rs:306-307`, `mark_failed.rs:49-66`
- **Staking Reward Checkpoint**: Synthetix/Quarry pattern. `update_rewards()` called BEFORE any balance change prevents flash-loan reward extraction. Dead stake (1 PROFIT locked at init) prevents first-depositor attack by ensuring `total_staked > 0` always. -- `stake.rs:118`, `unstake.rs:line~4`, `update_cumulative.rs:88`

## Invariants & Assumptions
- INVARIANT: `epoch_state.vrf_pending == true` implies exactly one pending VRF request -- enforced at `trigger_epoch_transition.rs:164` (VrfAlreadyPending check)
- INVARIANT: `epoch_state.carnage_pending == true` implies exactly one pending Carnage execution -- enforced at `consume_randomness.rs:115` (auto-expire stale) and `expire_carnage.rs:33` (NoCarnagePending constraint)
- INVARIANT: CurveStatus transitions are monotonically forward (never backward) -- enforced by Anchor constraints requiring specific status at each instruction entry point
- INVARIANT: `pool.locked == false` at swap entry -- enforced at `swap_sol_pool.rs` Anchor constraint (implicit), set to true at line 84
- INVARIANT: `stake_pool.total_staked >= MINIMUM_STAKE` (dead stake ensures non-zero) -- enforced at `initialize_stake_pool.rs` (transfers 1 PROFIT dead stake)
- ASSUMPTION: Anchor `init` zero-initializes all account bytes -- validated for `carnage_lock_slot` which is not explicitly set in `initialize_epoch_state.rs`
- ASSUMPTION: `update_cumulative` called at most once per epoch -- validated by `epoch > pool.last_update_epoch` check at `update_cumulative.rs:78-81`
- ASSUMPTION: Cross-program EpochState layout between epoch-program and tax-program remains identical -- validated by compile-time assertions and cross-crate tests

## Risk Observations (Prioritized)
1. **Optional carnage_state griefing**: `consume_randomness.rs:80` -- A MEV actor can call consume_randomness without carnage_state to suppress Carnage triggering. The epoch advances and taxes update, but Carnage never queues. This is documented as "backward compatibility" but creates a griefing vector where Carnage events are selectively suppressed.
2. **No emergency stop mechanism**: No program has pause/freeze capability. If a critical bug is found post-launch, the only remediation is program upgrade (requires multisig timelock delay). During the timelock window, the vulnerable code remains active.
3. **Epoch skip reward forfeiture**: `trigger_epoch_transition.rs:150` -- If crank is delayed and epoch jumps from N to N+5, rewards accumulated during epochs N+1 through N+4 are silently lost (pending_rewards reset to 0 at each update_cumulative). The protocol documentation says this is "harmless" but stakers lose real yield.
4. **Stale carnage_target after expiry**: `expire_carnage.rs:88-89` -- carnage_target retains its old value (0 or 1) after Carnage expires. If read elsewhere without checking carnage_pending first, it could be misinterpreted. Currently benign because all consumers check carnage_pending first.
5. **held_token raw u8 matching**: `carnage_execution.rs:477-481` -- Direct u8 matching (1/2/_) instead of using `HeldToken::from_u8()` introduces a semantic gap. Values 3-255 silently fall to the `_ => return Ok(0)` branch instead of returning an error. Currently benign because held_token is only set to 0/1/2 by the protocol.

## Novel Attack Surface
- **Carnage suppression as economic manipulation**: An attacker who wants Carnage NOT to trigger (because they hold the token that would be bought, driving up price) can monitor the mempool and front-run consume_randomness with their own call that omits carnage_state. This suppresses the buy pressure from Carnage while still advancing the epoch.
- **Epoch skip + Carnage timing**: If an attacker delays epoch transitions (e.g., by not running the crank and no one else does), they can cause epoch skips that forfeit staking rewards. Combined with Carnage suppression, this creates an asymmetric information advantage.

## Cross-Focus Handoffs
- **-> Access Control Agent**: `consume_randomness.rs:80` carnage_state is optional, meaning any caller can suppress Carnage triggering. Investigate whether this should be mandatory.
- **-> Access Control Agent**: `consume_randomness.rs:65` stake_pool is `AccountInfo` with no owner constraint at Epoch level (defense-in-depth gap).
- **-> Timing Agent**: Epoch skip behavior at `trigger_epoch_transition.rs:150` -- what happens to staking rewards during skipped epochs?
- **-> Timing Agent**: Carnage lock window (50 slots) and deadline window (300 slots) timing at `consume_randomness.rs:297-300`.
- **-> Token/Economic Agent**: Staking reward forfeiture during epoch skips -- quantify economic impact.
- **-> Error Handling Agent**: `carnage_execution.rs:477-481` raw u8 matching returns Ok(0) for invalid held_token values instead of an error.

## Trust Boundaries
The protocol has three trust tiers: (1) Admin operations (initialize, start_curve, prepare_transition, transfer/burn authority) require the upgrade authority or admin config signer -- these are fully trusted. (2) Permissionless operations (trigger_epoch, consume_randomness, execute_carnage, expire_carnage, mark_failed, purchase, sell, claim, stake, unstake) are callable by anyone and rely entirely on on-chain constraints for safety. (3) Cross-program CPI (Tax->AMM, Epoch->Staking, Epoch->Tax) uses PDA-derived signers with `seeds::program` constraints, establishing trust through cryptographic derivation rather than explicit authorization. The Switchboard oracle is an external trust dependency -- the protocol trusts VRF output from accounts owned by SWITCHBOARD_PROGRAM_ID.
<!-- CONDENSED_SUMMARY_END -->

---

# State Machine & Error Handling -- Full Analysis

## Executive Summary

The Dr. Fraudsworth protocol implements four distinct state machines across seven programs: (1) the Epoch/VRF state machine governing tax rate transitions, (2) the Carnage state machine nested within EpochState for fund rebalancing, (3) the Bonding Curve lifecycle managing token price discovery, and (4) the Staking reward accumulation state. Additionally, the AMM pool has a reentrancy guard state and the Transfer Hook has an authority lifecycle.

The state machines are well-designed with strictly forward transitions, explicit guard conditions, and defense-in-depth patterns. The most significant concern is the optional carnage_state parameter in consume_randomness, which allows suppression of Carnage triggering. The protocol lacks any pause/freeze emergency mechanism, relying entirely on upgrade authority for emergency response. Cross-program layout parity (the H011/S007 prior findings) has been properly addressed with compile-time assertions and cross-crate round-trip tests.

## Scope
- Files analyzed: 31 source files across 7 programs + 1 cross-crate test
- Functions analyzed: ~50 instruction handlers, ~15 helper functions, ~10 state structs
- Estimated coverage: 95% of state-machine-relevant code

## Key Mechanisms

### 1. Epoch VRF State Machine

**Location:** `epoch-program/src/instructions/trigger_epoch_transition.rs`, `consume_randomness.rs`, `retry_epoch_vrf.rs`

**Purpose:** Governs epoch transitions via Switchboard VRF commit-reveal pattern.

**How it works:**
1. `trigger_epoch_transition`: Validates epoch boundary reached (line 151), no VRF pending (line 164), randomness account freshness (line 174-181). Sets `vrf_pending = true`, `taxes_confirmed = false`, advances `current_epoch`.
2. `consume_randomness`: Validates VRF pending (line 151), anti-reroll match (line 155), reads revealed VRF bytes, derives new tax rates, sets `vrf_pending = false`, `taxes_confirmed = true`, CPIs to Staking update_cumulative.
3. `retry_epoch_vrf`: If oracle fails to reveal within 300 slots, allows rebinding to fresh randomness account. Validates timeout elapsed (line 72).

**State transitions:**
```
Idle (vrf_pending=false) --> Pending (vrf_pending=true)  [trigger_epoch_transition]
Pending                  --> Idle                         [consume_randomness]
Pending                  --> Pending (re-bound)           [retry_epoch_vrf, after 300 slots]
```

**Assumptions:**
- Switchboard oracle will reveal within 300 slots (2 minutes). If not, retry is available.
- Clock sysvar is accurate (not manipulable by non-validator)
- `saturating_sub` on seed_slot freshness check (line 174) returns 0 for future-dated seeds, which passes the `<= 1` check. This is a secondary trust assumption on Switchboard correctness. See HOT_SPOTS for discussion.

**Invariants:**
- At most one VRF request pending at any time (enforced by VrfAlreadyPending check)
- Anti-reroll: consume_randomness MUST use the exact account bound at trigger time
- Epoch number is monotonically increasing (enforced by `expected_epoch > current_epoch`)

**Concerns:**
- `carnage_lock_slot` is not explicitly set in `initialize_epoch_state.rs` (lines 68-75). All other Carnage fields are explicitly set to 0. Anchor's `init` constraint zero-initializes account data, so `carnage_lock_slot = 0` in practice. However, this is an inconsistency in explicit initialization that could become a bug if initialization logic changes.
- Epoch skipping: if `expected_epoch = current_epoch + 5`, the epoch jumps directly. Staking rewards for intermediate epochs are lost because `update_cumulative` is only called once (for the final epoch). The `pending_rewards` counter is reset to 0 after each cumulative update.

---

### 2. Carnage State Machine

**Location:** `epoch-program/src/instructions/consume_randomness.rs:279-328`, `execute_carnage_atomic.rs`, `execute_carnage.rs`, `expire_carnage.rs`, `helpers/carnage_execution.rs`

**Purpose:** VRF-triggered fund rebalancing -- burn or sell held tokens, then buy target token.

**How it works:**
1. **Trigger** (consume_randomness line 283): VRF byte 5 < 11 (~4.3% chance) triggers Carnage. Sets `carnage_pending = true`, `carnage_action`, `carnage_target`, `carnage_deadline_slot = slot + 300`, `carnage_lock_slot = slot + 50`.
2. **Atomic execution** (execute_carnage_atomic): Bundled in same TX as consume_randomness. No-ops if `carnage_pending == false` (line 202). Calls `execute_carnage_core`.
3. **Fallback execution** (execute_carnage): Callable by anyone after lock window (slot > carnage_lock_slot, line 207). Same core logic, different slippage (75% vs 85%).
4. **Expiry** (expire_carnage): Callable after deadline (slot > carnage_deadline_slot, line 69). Clears `carnage_pending` and `carnage_action`. SOL retained in vault.
5. **Auto-expire** (consume_randomness line 115): If stale Carnage is pending when next consume_randomness runs, auto-clears it.

**State transitions:**
```
Idle (carnage_pending=false) --> Triggered (carnage_pending=true)   [consume_randomness, VRF]
Triggered                    --> Executed (carnage_pending=false)    [execute_carnage_atomic OR execute_carnage]
Triggered                    --> Expired (carnage_pending=false)     [expire_carnage OR auto-expire in consume_randomness]
```

**Assumptions:**
- Optional carnage_state in consume_randomness means Carnage triggering can be suppressed
- Lock window (50 slots) is long enough for atomic bundled TX to land
- Deadline (300 slots) is long enough for fallback execution

**Invariants:**
- Only one Carnage can be pending at a time
- Execute_carnage cannot run during lock window (only atomic can)
- After expiry/execution, carnage_pending is always set to false

**Concerns:**
- **carnage_target not cleared on expiry**: `expire_carnage.rs:88-89` clears `carnage_pending` and `carnage_action` but NOT `carnage_target`. Similarly in auto-expire at `consume_randomness.rs:126-127`. The stale `carnage_target` value persists in state. Currently benign because all code paths check `carnage_pending` before reading `carnage_target`, but it violates the principle of cleaning up all related state.
- **Optional carnage_state**: The most significant state machine concern. A MEV actor monitoring for Carnage-triggering VRF outcomes could front-run consume_randomness with their own call that omits carnage_state, effectively vetoing Carnage execution while still advancing the epoch. This is an intentional design choice for "backward compatibility" but creates a real griefing vector.

---

### 3. Bonding Curve Lifecycle

**Location:** `bonding_curve/src/state.rs`, `instructions/start_curve.rs`, `purchase.rs`, `mark_failed.rs`, `prepare_transition.rs`, `close_token_vault.rs`

**Purpose:** Linear price discovery for CRIME and FRAUD tokens with graduation to AMM pools.

**How it works:**
```
Initialized -> Active      [start_curve: admin, vault >= TARGET_TOKENS]
Active      -> Filled       [purchase: automatic when tokens_sold >= TARGET_TOKENS]
Active      -> Failed       [mark_failed: permissionless, slot > deadline + grace]
Filled      -> Graduated    [prepare_transition: admin, both curves Filled]
```

**State transition guards:**
- `start_curve`: Anchor constraint `status == CurveStatus::Initialized` (line 33), admin signer via has_one (line 24), vault balance >= TARGET_TOKENS (line 64-67)
- `purchase`: Anchor constraint `status == CurveStatus::Active` (line 33), deadline check (line 108-111), automatic transition to Filled at line 306-307
- `mark_failed`: Handler checks `status == Active` (line 50), slot > deadline + FAILURE_GRACE_SLOTS (line 60-63)
- `prepare_transition`: Both curves must be Filled (lines 62-71), admin signer

**Assumptions:**
- No instruction exists to move backward (Graduated->Filled, Failed->Active, etc.) -- this is enforced structurally
- `sell.rs` allows selling during Active status only (not Filled/Graduated/Failed) -- verified via Anchor constraint
- `claim_refund.rs` checks `is_refund_eligible()` which returns true only for Failed status (or Filled with Failed partner)

**Invariants:**
- Terminal states (Graduated, Failed) have no exits -- no instruction accepts them as valid input status for further transitions
- `tokens_sold` increases monotonically during purchases (decreases only on sells, which are Active-only)
- Deadline is immutable once set by `start_curve` (line 74)

**Concerns:**
- No concern with backward transitions -- structurally impossible
- `prepare_transition` requires BOTH curves to be Filled. If one curve fills but the other fails, the filled curve becomes refund-eligible via `is_refund_eligible(CurveStatus::Failed)` -- this is correct behavior
- `close_token_vault` is only callable on Graduated status with empty vault (amount == 0) -- safe

---

### 4. Staking State Machine

**Location:** `staking/src/state/stake_pool.rs`, `user_stake.rs`, `instructions/stake.rs`, `unstake.rs`, `claim.rs`, `deposit_rewards.rs`, `update_cumulative.rs`

**Purpose:** PROFIT token staking for SOL yield distribution using cumulative reward-per-token pattern.

**How it works:**
1. **Initialize** (initialize_stake_pool): Creates StakePool singleton, transfers 1 PROFIT dead stake
2. **Stake** (stake.rs): `init_if_needed` creates UserStake PDA. Calls `update_rewards` BEFORE balance change (line 118). Updates `staked_balance` and `total_staked`
3. **Unstake** (unstake.rs): Cooldown gate, `update_rewards` before balance change, forfeits pending rewards back to pool
4. **Claim** (claim.rs): `update_rewards`, transfers SOL from escrow to user
5. **Deposit rewards** (deposit_rewards.rs): Tax Program CPIs to add SOL to `pending_rewards`
6. **Update cumulative** (update_cumulative.rs): Epoch Program CPIs to finalize `pending_rewards` into `rewards_per_token_stored`

**Key state transitions:**
- UserStake: Created (owner=default) -> Active (owner=user, staked_balance>0) -> Unstaked (staked_balance=0, but account persists)
- StakePool: `pending_rewards` accumulates during epoch -> reset to 0 by `update_cumulative` -> `rewards_per_token_stored` monotonically increases

**Assumptions:**
- `update_rewards` is always called before any balance change (flash loan protection)
- Dead stake (1 PROFIT) ensures `total_staked > 0` always (prevents division by zero in `update_cumulative.rs:93`)
- `update_cumulative` called at most once per epoch (enforced by `epoch > last_update_epoch` at line 79)

**Invariants:**
- `rewards_per_token_stored` is monotonically increasing
- `total_staked >= MINIMUM_STAKE` (1 PROFIT) at all times
- `pending_rewards` is zeroed after each epoch finalization
- UserStake.owner matches signer on unstake/claim (enforced by Anchor constraint)

**Concerns:**
- `init_if_needed` on UserStake at `stake.rs:44`: Anchor's discriminator check prevents true reinitialization. The `owner == Pubkey::default()` check at line 106 correctly detects first-time users. This is safe.
- `update_cumulative` double-call protection: `epoch > pool.last_update_epoch` is strictly greater-than, so calling twice with the same epoch fails. This is correct.
- Unstake rewards forfeiture: When a user unstakes, their pending rewards are returned to the pool (`pending_rewards += rewards_earned`). This is by design per the spec, not a bug.

---

### 5. AMM Reentrancy Guard

**Location:** `amm/src/state/pool.rs:68`, `amm/src/instructions/swap_sol_pool.rs:84`

**Purpose:** Defense-in-depth reentrancy protection beyond Solana's runtime borrow rules.

**How it works:**
- `pool.locked` is set to `true` at swap entry (line 84)
- All swap logic executes with lock held
- `pool.locked` is cleared at the end (after transfers)
- Anchor constraint validates `!pool.locked` at entry (implicit via account deserialization)

**Concerns:**
- If swap reverts after setting `pool.locked = true` but before clearing it, Solana's transaction atomicity ensures the lock is not persisted (full TX rollback). No stuck-lock risk.
- Solana's runtime already prevents same-pool reentry during CPI (program cannot be reentered when it has an outstanding borrow). The lock is strictly belt-and-suspenders.

---

### 6. Transfer Hook Authority Lifecycle

**Location:** `transfer-hook/src/state/whitelist_authority.rs`, various instruction files

**Purpose:** Manages who can add whitelist entries.

**State transitions:**
```
Uninitialized -> Active (authority=Some(pubkey))     [initialize_authority]
Active        -> Active (authority=Some(new_pubkey))  [transfer_authority]
Active        -> Burned (authority=None)              [burn_authority]
```

**Concerns:**
- `initialize_authority` is permissionless (any signer becomes authority). In practice, this must be called immediately after program deployment before anyone else can claim authority. If an attacker initializes first, they control the whitelist permanently.
- Once burned, authority is None and no new entries can ever be added. The whitelist becomes immutable.

---

## Trust Model

**Trusted entities:**
1. **Upgrade authority / Admin**: Can modify program code, initialize admin configs, execute admin-only operations (start_curve, prepare_transition, transfer/burn authority)
2. **Switchboard oracle**: VRF output is trusted. If oracle is compromised, tax rates and Carnage triggers are deterministic from attacker-controlled bytes
3. **Cross-program PDA signers**: Tax->AMM (swap_authority), Epoch->Staking (staking_authority), Epoch->Tax (carnage_signer) -- trust established via `seeds::program` derivation

**Untrusted entities:**
1. **Any caller**: trigger_epoch, consume_randomness, execute_carnage, expire_carnage, mark_failed, purchase, sell, stake, unstake, claim are all permissionless
2. **remaining_accounts**: Passed through to Token-2022 CPI without per-account validation at the caller level. Validation delegated to Token-2022 and Transfer Hook programs.

**Trust boundaries:**
- Program boundaries are enforced by Anchor constraints (address, seeds, owner, has_one)
- Cross-program data reading (Tax reads EpochState from Epoch) relies on byte-level layout compatibility, enforced by compile-time assertions and cross-crate tests
- Token transfer authorization is PDA-based (vaults owned by program PDAs)

## State Analysis

### Global State Accounts
| Account | Program | Type | Lifecycle | Close? |
|---------|---------|------|-----------|--------|
| EpochState | Epoch | Singleton PDA | Init once, mutated per epoch | Never |
| CarnageFundState | Epoch | Singleton PDA | Init once, mutated per Carnage | Never |
| StakePool | Staking | Singleton PDA | Init once, mutated per epoch/stake | Never |
| UserStake | Staking | Per-user PDA | Created on first stake, never closed | Never |
| CurveState | Bonding Curve | Per-token PDA | Init -> Active -> Filled/Failed -> Graduated | Never |
| PoolState | AMM | Per-pair PDA | Init once, mutated per swap | Never |
| AdminConfig | AMM | Singleton PDA | Init once, authority transferable/burnable | Never |
| BcAdminConfig | Bonding Curve | Singleton PDA | Init once, authority transferable/burnable | Never |
| WhitelistAuthority | Transfer Hook | Singleton PDA | Init once, authority transferable/burnable | Never |
| WhitelistEntry | Transfer Hook | Per-address PDA | Created once, never modified | Never |

### Key Observation: No Account Closing
No production program uses Anchor's `close` constraint or manual account closing (except `close_token_vault` which closes a token account, not a program data account). This means:
- No account revival attacks are possible (EP-036 pattern is N/A)
- No rent reclamation for stale UserStake accounts (minor inefficiency)
- No "closed account data reuse" attacks (EP-035 pattern is N/A)

## Dependencies

### Cross-Program State Dependencies
```
Tax Program reads:
  - EpochState (via epoch_state_reader.rs mirror struct)
  - AMM PoolState (via pool_reader.rs byte-offset reading)

Epoch Program CPIs to:
  - Staking: update_cumulative (at epoch boundary)
  - Tax: swap_exempt (during Carnage execution)

Tax Program CPIs to:
  - AMM: swap_sol_pool (during buy/sell)
  - Staking: deposit_rewards (after tax distribution)

AMM CPIs to:
  - Token-2022: transfer_checked (during swap)
  - Transfer Hook: execute (via Token-2022's nested CPI)
```

### Layout Dependency Chain
Tax Program's `epoch_state_reader.rs` MUST match Epoch Program's `epoch_state.rs` byte-for-byte. This is enforced by:
1. Identical struct field order with `#[repr(C)]` on both
2. Compile-time assertion: `DATA_LEN == 164` on both
3. Cross-crate round-trip tests in `tests/cross-crate/src/lib.rs`

## Focus-Specific Analysis

### State Diagram

#### Epoch/VRF State Machine
```
                          trigger_epoch_transition
    [Idle] ─────────────────────────────────────────> [VRF Pending]
      ^                                                   │
      │                                                   │
      │ consume_randomness                                │
      │ (VRF revealed)                                    │ retry_epoch_vrf
      │                                                   │ (after 300 slots)
      │                                                   │
      └───────────────────────────────────────────────────┘
                                                     (re-bind)
```

#### Carnage State Machine (nested in EpochState)
```
                  consume_randomness (VRF byte < 11)
    [Idle] ──────────────────────────────────────────> [Triggered]
      ^                                                   │
      │                                                   │
      │ execute_carnage_atomic                            │ (0-50 slots: atomic only)
      │ execute_carnage (fallback)                        │ (50-300 slots: fallback ok)
      │                                                   │
      ├───────────────── (success) ───────────────────────┘
      │                                                   │
      │ expire_carnage                                    │
      │ auto-expire in consume_randomness                 │ (after 300 slots)
      │                                                   │
      └───────────────── (expiry) ────────────────────────┘
```

#### Bonding Curve Lifecycle
```
    [Initialized] ──── start_curve ────> [Active] ──── purchase (target met) ────> [Filled]
                                            │                                        │
                                            │ mark_failed                            │ prepare_transition
                                            │ (deadline + grace)                     │ (both curves Filled)
                                            v                                        v
                                        [Failed]                                 [Graduated]
                                        (terminal)                               (terminal)
```

#### Staking Lifecycle
```
    [Uninitialized] ──── initialize_stake_pool ────> [Active]
    (pool + vault)                                      │
                                                        │ deposit_rewards (Tax CPI)
                                                        │ update_cumulative (Epoch CPI)
                                                        │ stake/unstake/claim (user)
                                                        │
                                                        └──── (cycles per epoch) ────>
```

### Transition Matrix

| From | To | Instruction | Guard Condition | Can Attacker Trigger? |
|------|-----|-------------|-----------------|----------------------|
| Idle (VRF) | VRF Pending | trigger_epoch_transition | epoch boundary reached, no VRF pending, fresh randomness | Yes (permissionless) |
| VRF Pending | Idle | consume_randomness | VRF pending, anti-reroll match, oracle revealed | Yes (permissionless) |
| VRF Pending | VRF Pending | retry_epoch_vrf | VRF pending, 300 slots elapsed, fresh randomness | Yes (permissionless) |
| Idle (Carnage) | Triggered | consume_randomness (VRF) | VRF byte 5 < 11, carnage_state provided | Yes (but can suppress by omitting carnage_state) |
| Triggered | Executed | execute_carnage_atomic | carnage_pending, bundled in same TX | Yes (permissionless) |
| Triggered | Executed | execute_carnage | carnage_pending, lock window expired | Yes (permissionless) |
| Triggered | Expired | expire_carnage | carnage_pending, deadline expired | Yes (permissionless) |
| Initialized (BC) | Active | start_curve | admin signer, vault funded | No (admin only) |
| Active (BC) | Filled | purchase | tokens_sold >= TARGET_TOKENS | Yes (automatic) |
| Active (BC) | Failed | mark_failed | deadline + grace passed | Yes (permissionless) |
| Filled (BC) | Graduated | prepare_transition | admin, both curves Filled | No (admin only) |

### Account Lifecycle Map

| Account Type | Creation | Modifications | Close | Can Reopen? |
|-------------|----------|---------------|-------|-------------|
| EpochState | init (initialize_epoch_state) | Every epoch transition | Never | N/A |
| CarnageFundState | init (initialize_carnage_fund) | Every Carnage execution | Never | N/A |
| StakePool | init (initialize_stake_pool) | Every stake/unstake/deposit/update | Never | N/A |
| UserStake | init_if_needed (first stake) | Every stake/unstake/claim | Never | N/A |
| CurveState | init (initialize_curve) | purchase/sell/mark_failed/prepare_transition | Never | N/A |
| PoolState | init (initialize_pool) | Every swap | Never | N/A |
| WhitelistAuthority | init (initialize_authority) | transfer/burn_authority | Never | N/A |
| Token Vault (BC) | init (initialize_curve) | purchase/sell/graduation | close_token_vault (admin, Graduated, empty) | No (Anchor init prevents re-init at same PDA) |

### Invariant Registry

| # | Invariant | Enforced At | Status |
|---|-----------|-------------|--------|
| INV-01 | At most one VRF request pending | trigger_epoch_transition.rs:164 | Enforced |
| INV-02 | Anti-reroll: consume must use bound randomness | consume_randomness.rs:155 | Enforced |
| INV-03 | Epoch number is strictly increasing | trigger_epoch_transition.rs:152 | Enforced |
| INV-04 | At most one Carnage pending | consume_randomness.rs:115 (auto-expire) + structural | Enforced |
| INV-05 | Carnage deadline is always in the future at trigger time | consume_randomness.rs:293-296 (checked_add) | Enforced |
| INV-06 | Bonding curve transitions are forward-only | Structural (no backward instruction exists) | Enforced |
| INV-07 | Both curves must be Filled for graduation | prepare_transition.rs:62-71 | Enforced |
| INV-08 | total_staked >= MINIMUM_STAKE (1 PROFIT) | initialize_stake_pool (dead stake transfer) | Enforced |
| INV-09 | update_rewards called before any balance change | stake.rs:118, unstake.rs (line ~4) | Enforced |
| INV-10 | update_cumulative at most once per epoch | update_cumulative.rs:78-81 | Enforced |
| INV-11 | AMM pool.locked prevents reentrant swaps | swap_sol_pool.rs:84 | Enforced |
| INV-12 | Cross-program EpochState layout parity | epoch_state.rs:187, epoch_state_reader.rs:64, cross-crate tests | Enforced |
| INV-13 | carnage_lock_slot starts at 0 | Implicit via Anchor init zero-fill | Assumed (not explicit) |

## Cross-Focus Intersections

### State x Timing
- Epoch boundaries are slot-based, Carnage deadlines are slot-based, bonding curve deadlines are slot-based
- All use `Clock::get()?.slot` which is validator-controlled (not user-manipulable)
- Cooldown in staking uses `unix_timestamp` which can vary 1-2 seconds

### State x Access Control
- Admin-gated transitions: start_curve, prepare_transition, transfer/burn authority
- Permissionless transitions: trigger_epoch, consume_randomness, execute_carnage, mark_failed
- CPI-gated transitions: deposit_rewards (Tax only), update_cumulative (Epoch only)

### State x Token/Economic
- Bonding curve Filled transition triggers at economic threshold (TARGET_TOKENS)
- Carnage execution involves token burns and swaps that affect supply
- Staking rewards are economic state tied to epoch transitions

## Cross-Reference Handoffs

- **-> Access Control Agent**: Optional carnage_state in consume_randomness.rs:80 allows Carnage suppression. Should this be mandatory?
- **-> Access Control Agent**: stake_pool AccountInfo at consume_randomness.rs:65 has no owner constraint at Epoch level.
- **-> Timing Agent**: Epoch skip behavior at trigger_epoch_transition.rs:143-153. Quantify reward loss from skipped epochs.
- **-> Timing Agent**: Carnage timing windows (50-slot lock, 300-slot deadline). Assess MEV timing attack viability.
- **-> Token/Economic Agent**: Staking reward forfeiture during epoch skips.
- **-> Token/Economic Agent**: Carnage suppression economic impact (missed buy pressure).
- **-> Error Handling Agent**: held_token raw u8 matching at carnage_execution.rs:477-481 silently returns Ok(0) for invalid values.
- **-> CPI Agent**: execute_carnage_core makes extensive CPIs. Verify account reloads after CPI are complete.
- **-> Account Validation Agent**: No account closing in production programs. EP-036 (revival) is N/A.

## Risk Observations

1. **Optional carnage_state griefing (HIGH)**: `consume_randomness.rs:80` -- carnage_state is Optional. Omitting it suppresses Carnage triggering. A MEV actor could selectively suppress Carnage to manipulate token prices.

2. **No emergency stop (HIGH)**: No program implements pause/freeze. The only remediation for a critical vulnerability is program upgrade, which requires multisig timelock. During the timelock window, the protocol is exposed.

3. **Epoch skip reward forfeiture (MEDIUM)**: `trigger_epoch_transition.rs:150` -- Multi-epoch jumps cause staking rewards to be silently lost. Documented as "harmless" but has real economic impact on stakers.

4. **Stale carnage_target after expiry (MEDIUM)**: `expire_carnage.rs:88-89` -- carnage_target retains its value after Carnage expires. Currently benign but violates clean state principle.

5. **carnage_lock_slot not explicitly initialized (MEDIUM)**: `initialize_epoch_state.rs` -- Every other Carnage field is explicitly set to 0, but carnage_lock_slot relies on Anchor's zero-fill. Asymmetric initialization pattern.

6. **held_token raw u8 matching (MEDIUM)**: `carnage_execution.rs:477-481` -- Direct matching without `HeldToken::from_u8()`. Invalid values (3-255) silently fall to Ok(0) instead of returning an error.

7. **Permissionless initialize_authority (MEDIUM)**: `transfer-hook/src/instructions/initialize_authority.rs` -- Any signer can initialize. Must be called immediately after deployment to prevent authority hijacking.

8. **Token::from_u8_unchecked fallback to Fraud (LOW)**: `enums.rs:40-45` -- `from_u8_unchecked` maps any non-zero value to Fraud. If used on corrupt state, silently misidentifies the cheap side. Currently only used in contexts where input is validated first.

9. **UserStake accounts never closed (LOW)**: Users who unstake fully leave empty UserStake accounts consuming rent. No economic impact but minor state bloat.

10. **Cross-program EpochState has reserved padding (LOW)**: The 64-byte reserved field enables future schema evolution without migration. However, if new fields are added by consuming reserved bytes, the Tax Program's mirror must be updated simultaneously or deserialization fails. The compile-time assertions and cross-crate tests catch this.

## Novel Attack Surface Observations

1. **Carnage suppression as economic strategy**: An attacker holding a large position in one faction token could systematically suppress Carnage by front-running consume_randomness with calls that omit carnage_state. This prevents the protocol's rebalancing mechanism from firing, allowing the attacker's token to maintain artificial price levels. This is unique to this protocol's optional-account design pattern and doesn't match any standard exploit pattern.

2. **Epoch skip + Carnage timing compound attack**: An attacker who controls crank execution (or can censor others' transactions) could delay epoch transitions to cause epoch skips (forfeiting staking rewards for other users). Combined with Carnage suppression, this creates an information asymmetry where the attacker knows Carnage won't fire and can position accordingly. The combination of permissionless operations with optional parameters creates attack surfaces that wouldn't exist if all parameters were mandatory.

3. **Stale Carnage target leaking future intent**: After Carnage expires, `carnage_target` retains its value. While currently benign on-chain, off-chain indexers reading EpochState may misinterpret the stale target as indicating future Carnage direction, potentially influencing trading decisions. This is an information leakage through uncleared state.

## Questions for Other Focus Areas

- **For Arithmetic focus**: In `update_cumulative`, is `rewards_per_token_stored` guaranteed not to overflow over protocol lifetime? What are the maximum realistic values?
- **For CPI focus**: In `execute_carnage_core`, after the sell CPI, `carnage_wsol.reload()` is called. Is there any scenario where the reload could fail silently (returning stale data)?
- **For Timing focus**: The 50-slot Carnage lock window -- is this sufficient to prevent MEV front-running of the atomic execution?
- **For Oracle focus**: The VRF freshness check at `trigger_epoch_transition.rs:174` uses `saturating_sub`. If Switchboard produces a future-dated `seed_slot`, the freshness check passes. Is this a realistic oracle failure mode?
- **For Token/Economic focus**: What is the economic impact of epoch skipping on stakers? Can an attacker profit from deliberately causing epoch skips?

## Previous Finding Rechecks

### H011 (MEDIUM): EpochState cross-program layout corruption -- STILL ADDRESSED
**File:** `tax-program/src/state/epoch_state_reader.rs`
The mirror struct at `epoch_state_reader.rs` matches the source struct at `epoch_state.rs` field-for-field. Both have:
- `#[repr(C)]` annotation
- Identical field ordering (verified line-by-line)
- Compile-time assertion `DATA_LEN == 164` (epoch_state.rs:187, epoch_state_reader.rs:64)
- Cross-crate round-trip tests (tests/cross-crate/src/lib.rs) that serialize from one and deserialize into the other
The layout corruption risk identified in H011 is effectively mitigated by the compile-time assertions and cross-crate tests.

### S007 (HIGH): No cross-program layout tests -- NOW FIXED
**File:** `tests/cross-crate/src/lib.rs`
Three tests exist:
1. `epoch_to_tax_round_trip`: Serializes EpochState from epoch-program, deserializes as tax-program mirror, verifies all 22 fields match
2. `tax_to_epoch_round_trip`: Reverse direction
3. `byte_length_parity`: Verifies serialized byte lengths AND byte content are identical
These tests catch any field order, type, or padding drift between the two structs. S007 is fully resolved.

## Raw Notes

### Account Initialization Patterns
All singleton PDAs use Anchor `init` constraint which:
1. Checks account is uninitialized (system-owned, zero data)
2. Allocates space
3. Transfers rent
4. Sets owner to program
5. Writes discriminator

Additional re-initialization protection:
- EpochState: explicit `!initialized` check at handler level (line 37)
- CarnageFundState: explicit `!initialized` check
- StakePool: explicit `initialized` check at handler level
- CurveState: Anchor constraint `status == Initialized` limits to one-time path
- UserStake: `init_if_needed` with `owner == Pubkey::default()` new-user detection

### State Mutation Ordering
All programs follow CEI (Checks-Effects-Interactions) pattern:
1. Validate all preconditions
2. Update state (effects)
3. Execute external calls (interactions)
4. Post-interaction validation/cleanup

Notable exceptions:
- `swap_sol_pool.rs`: Sets reentrancy guard (effect) before checks, but this is intentional (must lock before validation to prevent TOCTOU)
- `purchase.rs`: Token transfer (interaction) before state update, but Solana TX atomicity prevents partial state

### `#[repr(C)]` Usage
Only `EpochState` (both epoch-program and tax-program mirror) uses `#[repr(C)]`. Other structs rely on Borsh serialization ordering (which follows field declaration order regardless of `#[repr(C)]`). The `#[repr(C)]` is important for the cross-program reading pattern because it guarantees consistent memory layout for byte-offset access patterns (like pool_reader.rs). For Borsh-only serialization, it's unnecessary but harmless.
