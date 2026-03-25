# 03 - State Machine & Error Handling Analysis
<!-- Focus: EP-033 through EP-041 (Logic/State Machine), EP-084 through EP-088 (Resource/DoS) -->
<!-- Generated: 2026-02-22 -->
<!-- Auditor: Context Auditor Agent (State Machine Focus) -->
<!-- Codebase: Dr Fraudsworth v0.9 Phase 51 -->

---

## CONDENSED SUMMARY

### Architecture Overview

The protocol uses **5 interconnected Anchor programs** with cross-program state coordination via CPI-gated PDAs. State is tracked primarily through **boolean flags** and **u8-encoded enums** rather than Anchor-native enums, a deliberate design choice for Borsh serialization stability but one that weakens compile-time exhaustiveness checking.

### State Machines Identified

| Program | State Machine | Type | States |
|---------|--------------|------|--------|
| Epoch | VRF Lifecycle | Boolean flags | Idle -> VrfPending -> TaxesConfirmed -> (CarnagePending -> Executed/Expired) |
| Epoch | Carnage Execution | Boolean + lock slots | Pending -> AtomicLock -> FallbackWindow -> Deadline/Expired |
| AMM | Swap Reentrancy | Boolean locked flag | Unlocked -> Locked -> Unlocked |
| Transfer Hook | Transfer Validation | Stateless per-call | (no persistent state machine) |
| Staking | Reward Distribution | Epoch counter + cumulative | Pending -> Distributed -> Claimed |

### Critical Findings (0)
None identified.

### High Findings (1)

**H-01: Bounty Transfer Ignores Rent-Exempt Minimum** (KNOWN BUG)
- File: `programs/epoch-program/src/instructions/trigger_epoch_transition.rs:195`
- The bounty payment checks `vault_balance >= TRIGGER_BOUNTY_LAMPORTS` but does not account for rent-exempt minimum (~890,880 lamports). After transfer, sol_vault can drop below rent floor, causing runtime rejection or account garbage collection.
- EP-034 (Missing State Transition Check): The guard is incomplete -- it checks value sufficiency but not rent preservation.

### Medium Findings (3)

**M-01: Epoch Number `as u32` Truncation**
- File: `programs/epoch-program/src/instructions/trigger_epoch_transition.rs:81`
- `((slot.saturating_sub(genesis_slot)) / SLOTS_PER_EPOCH) as u32` silently truncates if epoch number exceeds u32::MAX (4.29B). At 750 slots/epoch on devnet, this takes ~102 years. At 4500 slots/epoch on mainnet, ~614 years. Practically unreachable but violates the checked-arithmetic principle.
- Pattern: EP-033 (CEI Violation sub-pattern: silent truncation in state transition).

**M-02: `Pubkey::from_str().unwrap()` in Tax Program Constants**
- File: `programs/tax-program/src/constants.rs:51,100,127,137,159`
- Five `Pubkey::from_str("...").unwrap()` calls. These execute at program load time (compile-time constant evaluation via `pubkey!` is available but not used here). If a string is malformed, `unwrap()` panics during deployment, not at compile time. Other programs (staking, epoch) use the `pubkey!` macro correctly.
- Pattern: EP-046 (Panic in Production Path). Severity is Medium because these are constant program IDs that are compile-tested, but the pattern is inconsistent and fragile.

**M-03: Mainnet Treasury Defaults to `Pubkey::default()` (All Zeros)**
- File: `programs/tax-program/src/constants.rs:144`
- Non-devnet `treasury_pubkey()` returns `Pubkey::default()`. If accidentally deployed to mainnet without the devnet feature and without updating this, all treasury distributions would go to the system program address (all zeros), which is on Solana's reserved account list and would have writes silently demoted (EP-106 pattern).
- Pattern: EP-034 (Missing State Transition Check -- no runtime guard against zero-address treasury).

### Low Findings (4)

**L-01: Boolean State Machine Instead of Enum (Epoch Program)**
- Files: `programs/epoch-program/src/state/epoch_state.rs` (all boolean fields)
- The VRF lifecycle uses independent booleans (`vrf_pending`, `taxes_confirmed`, `carnage_pending`) rather than an enum state. This permits invalid combinations (e.g., `vrf_pending=true` AND `carnage_pending=true`) that the instruction guards prevent but the type system does not. Each instruction independently validates its preconditions, which is correct but fragile.
- Pattern: EP-034 (Missing State Transition Check -- compile-time exhaustiveness not enforced).
- Mitigating: All transitions are guarded by Anchor constraints and `require!` checks.

**L-02: No Emergency Pause Mechanism**
- No program in the suite has a pause/unpause capability. If a vulnerability is discovered, the only mitigation is upgrade authority (which requires timelock in production).
- Pattern: EP-034 (Missing State Transition Check -- no "paused" state exists).

**L-03: No Account Closure (`close =`) Anywhere**
- Grep for `close =` returns zero matches across all programs. UserStake accounts created via `init_if_needed` are never closeable. Over time, this leads to account bloat and rent-locked SOL.
- Pattern: Informational -- no security impact but operational cost concern.

**L-04: `find_program_address` in Transfer Hook Hot Path**
- File: `programs/transfer-hook/src/instructions/transfer_hook.rs:173`
- `Pubkey::find_program_address` is called per-transfer in `is_whitelisted()`. This is an iterative operation (~3000 CU per call) that runs on every token transfer. Two calls per transfer (source + destination) consume ~6000 CU.
- Pattern: EP-084 (Compute Unit Exhaustion -- not a DoS vector alone but contributes to CPI depth budget pressure).

### Informational Notes (5)

**I-01: force_carnage is Properly Feature-Gated**
- File: `programs/epoch-program/src/lib.rs:261` -- `#[cfg(feature = "devnet")]`
- The devnet-only force_carnage instruction is correctly gated behind a compile-time feature flag. It will not be included in mainnet builds. No action required.

**I-02: All `assert!()` Calls Are in Test Code**
- All `assert!()` and `assert_eq!()` calls are within `#[cfg(test)]` blocks or compile-time `const` assertions. No runtime `assert!()` in production instruction handlers. Safe pattern.

**I-03: All `panic!()` Calls Are in Test Code**
- All `panic!()` calls are in test helper functions (loading .so files). No panics in production code.

**I-04: `init_if_needed` Usage is Safe**
- File: `programs/staking/src/instructions/stake.rs:44`
- Used only for UserStake accounts. New user detection via `user.owner == Pubkey::default()` is safe because Anchor's `init_if_needed` zero-initializes the account, and `Pubkey::default()` (all zeros) is the zero-initialized value for `owner`. The PDA seeds include the user's pubkey, preventing cross-user reinitialization.
- Pattern: FP-004 + FP-017 from common-false-positives.md.

**I-05: `remaining_accounts` Usage is Validated by Downstream Programs**
- `remaining_accounts` is used extensively for Transfer Hook forwarding across Tax, AMM, Staking, and Epoch programs. The accounts are passed through to Token-2022's `transfer_checked`, which validates them against the ExtraAccountMetaList PDA. The forwarding programs do not directly read or trust these accounts.
- Pattern: FP-015 partial -- remaining_accounts are not validated by the forwarding program, but they are validated by Token-2022's hook resolution. Acceptable given the architecture.

### Cross-Focus Handoffs

- **To 01-access-control**: Verify swap_authority PDA derivation consistency across all 5 programs. Tax uses `seeds::program = tax_program_id()` for AMM; verify AMM accepts this.
- **To 02-math-precision**: The `as u64` casts after u128 division in staking math.rs:50 and carnage slippage calculations need formal overflow analysis.
- **To 04-economic-model**: Carnage slippage floors (85% atomic, 75% fallback) define the maximum extractable value per carnage event. Verify these are economically sound.
- **To 05-integration**: The `Pubkey::from_str().unwrap()` vs `pubkey!()` inconsistency across programs should be standardized.

---

## FULL ANALYSIS

### 1. Epoch Program State Machine

#### 1.1 State Representation

The EpochState struct (100 bytes data, 108 with discriminator) uses boolean flags and u8-encoded values rather than Rust enums:

```
epoch_state.rs fields relevant to state machine:
- vrf_pending: bool           -- VRF commit phase active
- taxes_confirmed: bool       -- Tax rates finalized for this epoch
- carnage_pending: bool       -- Carnage execution window open
- carnage_action: u8          -- 0=None, 1=Burn, 2=Sell
- carnage_target: u8          -- 0=CRIME, 1=FRAUD
- carnage_deadline_slot: u64  -- Slot after which carnage expires
- carnage_lock_slot: u64      -- Slot until which only atomic path works
- pending_randomness_account: Pubkey -- Anti-reroll binding
```

The enums.rs file defines `Token` (Crime=0, Fraud=1) and `CarnageAction` (None=0, Burn=1, Sell=2) with manual `from_u8`/`to_u8` conversions. The `Token::from_u8_unchecked` method defaults any non-zero value to Fraud, which is a safe fallback for a 50/50 binary choice but could mask data corruption.

**Invariant**: At any point in time, exactly one of these state configurations should be true:
1. IDLE: `!vrf_pending && taxes_confirmed && !carnage_pending`
2. VRF_PENDING: `vrf_pending && !taxes_confirmed && !carnage_pending`
3. CARNAGE_PENDING: `!vrf_pending && taxes_confirmed && carnage_pending`

The boolean representation allows the invalid state `vrf_pending=true && carnage_pending=true`, but no instruction transition produces this combination.

#### 1.2 State Transitions

**Transition 1: IDLE -> VRF_PENDING** (`trigger_epoch_transition`)
- Guard: `!epoch_state.vrf_pending` (line ~87), epoch boundary reached (slot check), randomness not stale (slot_diff <= 1), not already revealed
- Effects: `vrf_pending=true`, `taxes_confirmed=false`, `pending_randomness_account` bound, epoch counter advanced
- CEI: Effects (state update) happen BEFORE interaction (bounty transfer). CORRECT pattern.
- Known Bug: Bounty check at line ~195 doesn't account for rent-exempt minimum.

**Transition 2: VRF_PENDING -> IDLE or CARNAGE_PENDING** (`consume_randomness`)
- Guard: `epoch_state.vrf_pending` (constraint), randomness_account matches `pending_randomness_account` (anti-reroll), randomness revealed, >= 6 bytes
- Effects: Reads VRF, derives taxes. If carnage triggered: sets `carnage_pending=true`, `carnage_deadline_slot`, `carnage_lock_slot`. Auto-expires stale pending carnage first.
- CEI: State updates (tax rates, carnage flags) BEFORE CPI to staking `update_cumulative`. CORRECT.
- Anti-reroll: The `pending_randomness_account` binding ensures the same VRF account from trigger is consumed. Cannot swap in a different randomness source.

**Transition 3: VRF_PENDING -> VRF_PENDING (reset)** (`retry_epoch_vrf`)
- Guard: `vrf_pending=true`, elapsed > VRF_TIMEOUT_SLOTS (300, strict >), new randomness fresh (slot_diff <= 1), not already revealed
- Effects: Overwrites `pending_randomness_account` with new one, updates `vrf_request_slot`
- CEI: Pure state update, no CPI. CORRECT.

**Transition 4: CARNAGE_PENDING -> IDLE** (`execute_carnage_atomic`)
- Guard: `carnage_pending` (constraint), `initialized` (constraint), `carnage_state.initialized`
- NO deadline check in atomic path (intentional -- atomic runs within the lock window)
- Effects: Executes burn/sell/buy via CPI chain, updates carnage_state holdings, clears `carnage_pending=false`
- CEI: **Effects AFTER interactions** -- state updates (held_token, held_amount, carnage_pending) happen AFTER all CPI calls. This is inverted CEI. However, `reload()` is called after every CPI, and the Anchor constraint `carnage_pending @ EpochError::NoCarnagePending` prevents re-entry. Reentrancy is also prevented by Solana's runtime (program cannot re-enter itself during CPI). The inverted pattern is acceptable here because:
  1. The constraint check at deserialization time is the "Check"
  2. All CPIs are to trusted programs (Tax, AMM, Token-2022)
  3. State is updated atomically at the end
  4. `reload()` prevents stale data reads

**Transition 5: CARNAGE_PENDING -> IDLE** (`execute_carnage` fallback)
- Guard: `carnage_pending` (constraint), `clock.slot <= carnage_deadline_slot`, `clock.slot > carnage_lock_slot`
- Effects: Same execution logic as atomic, slippage floor 75% vs 85%
- CEI: Same pattern as atomic -- effects after interactions. Same mitigations apply.
- Additional guard: Lock slot check prevents fallback from racing with atomic path.

**Transition 6: CARNAGE_PENDING -> IDLE** (`expire_carnage`)
- Guard: `carnage_pending` (constraint), `clock.slot > carnage_deadline_slot`
- Effects: Clears `carnage_pending=false`, `carnage_action=0`. SOL retained in vault.
- CEI: Pure state update, no CPI. CORRECT.

**Transition 7: IDLE -> CARNAGE_PENDING** (`force_carnage`, devnet only)
- Guard: `#[cfg(feature = "devnet")]`, `DEVNET_ADMIN` pubkey check
- Effects: Sets `carnage_pending=true` with arbitrary target/action
- NOTE: Does NOT set `carnage_lock_slot`. This means on devnet, the fallback path is immediately available. On mainnet this code is excluded. No security impact.

#### 1.3 Carnage Fund State (CarnageFundState)

139 bytes data. Tracks holdings, vault addresses, lifetime statistics.

The `held_token` field uses u8 (0=None, 1=CRIME, 2=FRAUD) with `HeldToken` enum conversions. The `from_u8` method returns `None` for invalid values (>2), which is correctly propagated as an error via `ok_or()`.

**Invariant**: `held_amount > 0` if and only if `held_token != 0`. Both execute_carnage variants maintain this by clearing both fields together during burn/sell and setting both during buy.

#### 1.4 Epoch Timing Constants

```
SLOTS_PER_EPOCH:        750 (devnet) / 4500 (mainnet) -- ~30 min
VRF_TIMEOUT_SLOTS:      300 -- ~2 min retry window
CARNAGE_DEADLINE_SLOTS: 300 -- ~2 min execution window
CARNAGE_LOCK_SLOTS:     50  -- ~20 sec atomic-only window
```

The constants module has compile-time assertions verifying `CARNAGE_LOCK_SLOTS < CARNAGE_DEADLINE_SLOTS` and that the fallback window (deadline - lock) is >= 200 slots.

---

### 2. AMM Reentrancy Guard

#### 2.1 Pool Locked Flag

`programs/amm/src/state/pool.rs:69` -- `pub locked: bool`

Both swap handlers (swap_sol_pool, swap_profit_pool) follow identical CEI:

```
Anchor constraint: constraint = !pool.locked @ AmmError::PoolLocked
1. Set locked = true                          [EFFECT]
2. Calculate swap math (immutable captures)   [CHECK]
3. Write new reserves                         [EFFECT]
4. Verify k-invariant                         [CHECK]
5. Execute token transfers (CPI)              [INTERACTION]
6. Set locked = false                         [EFFECT]
```

**Analysis**: The locked flag is set BEFORE any CPI and cleared AFTER all CPIs. The Anchor constraint at account deserialization prevents any re-entry. Solana's runtime also prevents the AMM from calling itself during CPI (program cannot re-enter). The flag provides defense-in-depth.

**Note**: The flag is cleared in step 6 (after transfers). If any transfer CPI fails, the `?` error propagation will abort the transaction and the flag remains `true` on-chain. However, Solana's transaction atomicity means failed transactions don't persist state changes. So the flag never gets stuck in a locked state from a failed transaction.

**Concern**: If the locked flag were somehow set to `true` outside of a swap (e.g., via a realloc attack or deserialization bug), all swaps would be permanently blocked. There is no admin override to clear the locked flag. This is acceptable because the flag can only be modified by the pool's owner program (AMM), and no other instruction modifies it.

#### 2.2 Dual-Hook Remaining Accounts Split

`swap_profit_pool.rs:178` -- `let hook_account_count = ctx.remaining_accounts.len() / 2;`

For PROFIT/token pools where both sides are Token-2022, remaining_accounts is split at the midpoint: first half for input transfer hooks, second half for output transfer hooks. Integer division means odd-length remaining_accounts favors the output side (gets the extra account). This is correct because if there are 9 accounts (4+4+1 extra), the extra goes to the second transfer which is fine.

---

### 3. Transfer Hook State Safety

#### 3.1 Direct Invocation Prevention

`programs/transfer-hook/src/instructions/transfer_hook.rs`

The hook validates:
1. `amount != 0` (zero-amount bypass prevention)
2. `mint.owner == spl_token_2022::id()` (mint ownership)
3. `check_is_transferring(&mint_info)` -- reads TransferHookAccount extension from mint data to verify this is being called as part of an actual Token-2022 transfer_checked, not invoked directly
4. Whitelist check via PDA derivation

The `check_is_transferring` call is the critical defense. Token-2022 sets a flag in the mint's extension data when it initiates the hook CPI. A direct call from an attacker would not have this flag set.

#### 3.2 Whitelist PDA Derivation

`is_whitelisted` at line 173 uses `Pubkey::find_program_address` with seeds `["whitelist", account_pubkey]` for each transfer participant. This is called twice per transfer (source and destination). The short-circuit logic (source OR destination whitelisted) means most protocol transfers (where at least one side is a whitelisted PDA vault) pass with one check.

---

### 4. Staking State Transitions

#### 4.1 Reward Distribution Lifecycle

**Phase 1: Accumulation** -- Tax Program collects swap fees, transfers SOL to escrow_vault, calls `deposit_rewards` CPI on Staking.
- Guard: `tax_authority` PDA with `seeds::program = tax_program_id()` ensures only Tax Program can deposit.
- Reconciliation: `escrow_vault.lamports() >= pool.pending_rewards` verified after update.

**Phase 2: Distribution** -- Epoch Program calls `update_cumulative` CPI on Staking at epoch transition.
- Guard: `staking_authority` PDA with `seeds::program = epoch_program_id()` ensures only Epoch Program can trigger.
- Double-update prevention: `require!(epoch > pool.last_update_epoch)` with strict `>`.
- Math: `reward_per_token = pending * PRECISION / total_staked` using u128 arithmetic.
- Dead stake: `total_staked` always >= MINIMUM_STAKE (1M units), preventing division by zero.

**Phase 3: User Interaction** -- Users stake/unstake/claim.
- `update_rewards` helper called BEFORE any balance change (checkpoint pattern).
- `init_if_needed` for new users -- safe because PDA seeds include user pubkey and initial state is zero-initialized.

#### 4.2 Staking Math Safety

`programs/staking/src/helpers/math.rs`

**`update_rewards` function (line ~30-52)**:
- u128 intermediate: `(global_cumulative - user_checkpoint) * balance`
- Division by PRECISION (1e18)
- **Critical cast**: `as u64` at line 50 after u128 division

The u128 intermediate can hold: `(max_u128 delta) * (max_u64 balance)` which exceeds u128 range in theory. However, the PRECISION constant (1e18) bounds the `rewards_per_token_stored` value. The proptest suite (10,000 iterations) tests for conservation and no-panic properties. The `as u64` cast is safe because the division by PRECISION brings the result back within u64 range for realistic values. Formal verification would be needed to prove this for all edge cases.

**`add_to_cumulative` function**:
- `reward_per_token = pending * PRECISION / total_staked` -- all checked arithmetic.
- `total_staked >= MINIMUM_STAKE` guaranteed by dead stake invariant.

#### 4.3 Unstake Safety

`programs/staking/src/instructions/unstake.rs`

- Partial unstake: If remaining balance < MINIMUM_STAKE, auto-upgrades to full unstake. This prevents dust positions.
- SOL reward claim: Uses direct lamport manipulation (`try_borrow_mut_lamports`) -- rewards are zeroed BEFORE the lamport transfer (correct CEI).
- PROFIT transfer: Uses manual CPI with hook support via `transfer_checked_with_hook`.

---

### 5. Initialization Safety (EP-037: Reinitialization)

All initialization instructions use Anchor's `#[account(init)]` constraint which creates the account with a discriminator. Re-calling init fails because the account already exists with a non-zero discriminator.

Defense-in-depth: Both epoch and carnage initialization add explicit `require!(!state.initialized)` checks. Staking uses `init` constraint alone (sufficient per FP-004).

**No `init_if_needed` reinitialization risk**: The only `init_if_needed` usage is in `stake.rs:44` for UserStake. The PDA seeds include the user's pubkey, so each user gets a unique account. The `owner == Pubkey::default()` check correctly identifies new accounts because Anchor zero-initializes on creation.

---

### 6. Cross-Instruction State Attack Surface (EP-038)

The protocol's cross-instruction attack surface is limited by:

1. **PDA-gated CPI**: All cross-program calls use `seeds::program` constraints to verify caller identity. Tax->AMM uses `swap_authority`, Epoch->Tax uses `carnage_signer`, Epoch->Staking uses `staking_authority`, Tax->Staking uses `tax_authority`.

2. **Reload after CPI**: Every instruction that reads account data after a CPI call uses `.reload()`:
   - `execute_carnage_atomic.rs`: reload after every burn/sell/buy CPI
   - `execute_carnage.rs`: reload carnage_wsol after sell, reload target vault after disposal
   - Tax swap handlers: reload after AMM swap CPI

3. **Same-transaction multi-instruction**: The AMM's locked flag prevents concurrent swaps in the same transaction. The epoch state's boolean flags prevent concurrent state transitions.

---

### 7. Compute Budget Analysis (EP-084)

**Heaviest instruction**: `execute_carnage_atomic` -- performs up to 3 CPI calls (burn + sell + buy), each with Token-2022 transfer hooks. The CPI chain reaches the 4-level Solana limit: Epoch -> Tax -> AMM -> Token-2022 -> Hook.

**Transfer Hook compute**: Each `find_program_address` call in the hook costs ~3000 CU. Two calls per transfer (source + destination whitelist check) = ~6000 CU. With up to 3 transfers in atomic carnage, that's ~18,000 CU just for hook whitelist checks.

**No unbounded loops**: All iterations are bounded:
- remaining_accounts iteration: bounded by transaction account limit (64 max)
- Token splits: fixed 3-way split (staking/carnage/treasury)
- VRF byte reads: fixed 8 bytes

**No deserialization bombs (EP-088)**: All account sizes are fixed (compile-time assertions in epoch_state.rs, carnage_fund_state.rs, pool.rs, stake_pool.rs, user_stake.rs). No variable-length fields (Vec, String) in any on-chain account.

---

### 8. Error Handling Patterns

#### 8.1 Production Unwraps

**Tax Program constants.rs**: 5x `Pubkey::from_str("...").unwrap()` at lines 51, 100, 127, 137, 159. These are constant program ID functions. The `unwrap()` would panic at program deployment if the string were invalid. This is tested in the module's test suite. However, the `pubkey!` macro (used by staking and epoch programs) provides compile-time validation, which is strictly safer.

**No production unwraps in instruction handlers**: Grep confirms all `.unwrap()` calls outside of constants are in `#[cfg(test)]` blocks.

#### 8.2 Checked Arithmetic

All financial calculations use `checked_add`, `checked_sub`, `checked_mul`, `checked_div` with `.ok_or(Error::Overflow)?` propagation. The `saturating_sub` is used only where underflow should clamp to 0 (e.g., `available_sol = sol_balance.saturating_sub(rent_exempt_min)`).

#### 8.3 `as u64` Casts After u128

Found in production code:
1. `staking/math.rs:50` -- after u128 division by PRECISION. Safe for realistic values (proptested).
2. `execute_carnage_atomic.rs:428,433` -- after u128 slippage calculation. Safe because inputs are u64 and multiplication by BPS (< 10000) fits in u128; division by 10000 brings result back to u64 range.
3. `execute_carnage.rs:435,440` -- same pattern as atomic.
4. `trigger_epoch_transition.rs:81` -- `as u32` from u64 slot math. Addressed in M-01.

The `as u64` casts after checked u128 arithmetic are safe when the intermediate result is proven to fit in u64. The slippage calculations multiply a u64 by a u16-range BPS value and divide by 10000, which always fits in u64. The staking math relies on PRECISION division to bring u128 back to u64 range, which holds for values up to ~18.4 quintillion (u64::MAX).

---

### 9. False Positive Notes

| Pattern | Verdict | Reason |
|---------|---------|--------|
| FP-004: `init_if_needed` in staking | FALSE POSITIVE | PDA seeds include user pubkey; zero-init detection is correct |
| FP-008: CPI reentrancy | FALSE POSITIVE | Solana runtime prevents self-CPI re-entry; AMM locked flag provides defense-in-depth |
| FP-015: `remaining_accounts` without validation | FALSE POSITIVE | Accounts are forwarded to Token-2022 which validates via ExtraAccountMetaList |
| FP-001: Missing owner check on `AccountInfo` pool accounts | FALSE POSITIVE | Pool AccountInfos in execute_carnage are CPI passthroughs; Tax/AMM validate them |
| EP-037: Reinitialization | FALSE POSITIVE | All init instructions use Anchor `init` constraint + defense-in-depth `!initialized` checks |
| EP-085: Unbounded iteration | FALSE POSITIVE | No unbounded loops; all iterations bounded by transaction limits or fixed constants |
| EP-088: Deserialization bomb | FALSE POSITIVE | All account types have fixed sizes with compile-time assertions |

---

### 10. Invariants Catalogue

| ID | Invariant | Enforced By | Verified |
|----|-----------|-------------|----------|
| INV-01 | `vrf_pending` and `carnage_pending` never both true | Instruction guards (consume clears vrf_pending before setting carnage_pending) | Yes (code review) |
| INV-02 | `carnage_lock_slot < carnage_deadline_slot` | Compile-time assertion in constants.rs | Yes (line 277) |
| INV-03 | `pool.locked` is false at rest (not stuck) | Transaction atomicity -- failed TX rolls back | Yes (by Solana design) |
| INV-04 | `total_staked >= MINIMUM_STAKE` always | Dead stake on init; auto-full-unstake when remaining < minimum | Yes (code review) |
| INV-05 | `held_amount > 0 iff held_token != 0` | Both cleared/set together in execute_carnage | Yes (code review) |
| INV-06 | `escrow_vault.lamports() >= pending_rewards` | Reconciliation check in deposit_rewards | Yes (line 99-102) |
| INV-07 | Accounts reloaded after every CPI that mutates them | Manual audit of all CPI sites | Yes (17 reload() calls found) |
| INV-08 | Only one program can trigger each CPI-gated instruction | seeds::program constraints on all cross-program PDAs | Yes (4 cross-program gates verified) |
| INV-09 | Transfer Hook cannot be invoked directly | check_is_transferring validates Token-2022 extension flag | Yes (line ~70) |
| INV-10 | Epoch counter monotonically increases | Strict `>` check in update_cumulative; epoch set from slot math | Yes (code review) |

---

### 11. Files Examined

**Epoch Program (15 files)**:
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/epoch-program/src/state/epoch_state.rs`
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/epoch-program/src/state/carnage_fund_state.rs`
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/epoch-program/src/state/enums.rs`
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/epoch-program/src/constants.rs`
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/epoch-program/src/lib.rs`
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/epoch-program/src/instructions/trigger_epoch_transition.rs`
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/epoch-program/src/instructions/consume_randomness.rs`
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/epoch-program/src/instructions/retry_epoch_vrf.rs`
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/epoch-program/src/instructions/execute_carnage_atomic.rs`
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/epoch-program/src/instructions/execute_carnage.rs`
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/epoch-program/src/instructions/expire_carnage.rs`
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/epoch-program/src/instructions/force_carnage.rs`
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/epoch-program/src/instructions/initialize_epoch_state.rs`
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/epoch-program/src/instructions/initialize_carnage_fund.rs`
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/epoch-program/src/helpers/carnage.rs`

**AMM Program (3 files)**:
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/amm/src/instructions/swap_sol_pool.rs`
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/amm/src/instructions/swap_profit_pool.rs`
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/amm/src/state/pool.rs`

**Transfer Hook Program (1 file)**:
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/transfer-hook/src/instructions/transfer_hook.rs`

**Tax Program (2 files)**:
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/tax-program/src/instructions/swap_exempt.rs`
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/tax-program/src/constants.rs`

**Staking Program (8 files)**:
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/staking/src/instructions/stake.rs`
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/staking/src/instructions/unstake.rs`
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/staking/src/instructions/claim.rs`
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/staking/src/instructions/update_cumulative.rs`
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/staking/src/instructions/deposit_rewards.rs`
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/staking/src/instructions/initialize_stake_pool.rs`
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/staking/src/state/stake_pool.rs`
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/staking/src/state/user_stake.rs`
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/staking/src/helpers/math.rs`
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/staking/src/constants.rs`

**Knowledge Base (5 files)**:
- `/Users/mlbob/Projects/Dr Fraudsworth/.audit/kb/core/secure-patterns.md`
- `/Users/mlbob/Projects/Dr Fraudsworth/.audit/kb/core/common-false-positives.md`
- `/Users/mlbob/Projects/Dr Fraudsworth/.audit/kb/solana/solana-runtime-quirks.md`
- `/Users/mlbob/Projects/Dr Fraudsworth/.audit/kb/solana/anchor-version-gotchas.md`
- `/Users/mlbob/Projects/Dr Fraudsworth/.audit/kb/protocols/amm-dex-attacks.md`

**Audit Infrastructure (3 files)**:
- `/Users/mlbob/Projects/Dr Fraudsworth/.audit/INDEX.md`
- `/Users/mlbob/Projects/Dr Fraudsworth/.audit/HOT_SPOTS.md`
- `/Users/mlbob/Projects/Dr Fraudsworth/.audit/kb/focus-manifests/03-state-machine.md`

---
<!-- Total findings: 0 Critical, 1 High, 3 Medium, 4 Low, 5 Informational -->
<!-- EP patterns checked: EP-033, EP-034, EP-037, EP-038, EP-041, EP-084, EP-085, EP-088 -->
<!-- False positive patterns applied: FP-001, FP-004, FP-008, FP-015, FP-017 -->
