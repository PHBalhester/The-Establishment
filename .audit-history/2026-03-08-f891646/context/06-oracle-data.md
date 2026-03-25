---
task_id: sos-phase1-oracle-data
provides: [oracle-data-findings, oracle-data-invariants]
focus_area: oracle-data
files_analyzed: [
  "programs/epoch-program/src/constants.rs",
  "programs/epoch-program/src/lib.rs",
  "programs/epoch-program/src/state/epoch_state.rs",
  "programs/epoch-program/src/state/enums.rs",
  "programs/epoch-program/src/helpers/carnage.rs",
  "programs/epoch-program/src/helpers/tax_derivation.rs",
  "programs/epoch-program/src/instructions/trigger_epoch_transition.rs",
  "programs/epoch-program/src/instructions/consume_randomness.rs",
  "programs/epoch-program/src/instructions/retry_epoch_vrf.rs",
  "programs/epoch-program/src/instructions/force_carnage.rs",
  "programs/epoch-program/src/instructions/initialize_epoch_state.rs",
  "programs/tax-program/src/state/epoch_state_reader.rs",
  "programs/tax-program/src/helpers/pool_reader.rs",
  "programs/tax-program/src/instructions/swap_sol_buy.rs",
  "programs/tax-program/src/instructions/swap_sol_sell.rs",
  "programs/epoch-program/src/instructions/execute_carnage.rs",
  "programs/epoch-program/src/instructions/execute_carnage_atomic.rs"
]
finding_count: 10
severity_breakdown: {critical: 0, high: 1, medium: 4, low: 5}
---
<!-- CONDENSED_SUMMARY_START -->
# Oracle & External Data -- Condensed Summary

## Key Findings (Top 10)

1. **Tax Program does NOT check `taxes_confirmed` before reading tax rates**: During the window between `trigger_epoch_transition` (sets `taxes_confirmed = false`) and `consume_randomness` (sets it to `true`), swaps still execute using previous epoch's tax rates. This is a design choice, not a bypass -- but it means swaps during VRF pending phase use stale rates. -- `swap_sol_buy.rs:67-78`, `swap_sol_sell.rs:82-93`

2. **Switchboard randomness account owner validation is feature-gated**: `SWITCHBOARD_PROGRAM_ID` differs between devnet and mainnet via `#[cfg(feature = "devnet")]`. A mainnet build without `devnet` feature correctly uses `ON_DEMAND_MAINNET_PID`. Verified both paths exist. -- `constants.rs:45-49`

3. **Anti-reroll protection is correctly implemented**: `trigger_epoch_transition` binds `pending_randomness_account` and `consume_randomness` verifies the same account key. This prevents the oracle-cherry-picking attack where an attacker could create multiple randomness accounts and only reveal the favorable one. -- `trigger_epoch_transition.rs:186`, `consume_randomness.rs:153-157`

4. **Randomness freshness check uses slot_diff <= 1**: Requires seed_slot to be within 1 slot of current. This is a tight window that prevents pre-generated randomness from being used but depends on the client bundling correctly. -- `trigger_epoch_transition.rs:159-166`

5. **VRF timeout recovery allows infinite retries**: `retry_epoch_vrf` can be called repeatedly after each 300-slot timeout. Each retry resets `vrf_request_slot`, starting a fresh 300-slot window. No cap on retry count. -- `retry_epoch_vrf.rs:98-103`

6. **No external price oracle (Pyth/Switchboard aggregator) used anywhere**: Protocol uses Switchboard VRF for randomness only. Price discovery happens via AMM constant-product formula. This eliminates all traditional oracle manipulation attack vectors (stale price, confidence interval, TWAP manipulation). -- Confirmed by grep across all programs.

7. **Pool reserve reading uses raw byte offsets**: Both Tax Program and Epoch Program read AMM PoolState reserves at hardcoded offsets 137-153. If AMM PoolState layout changes, these reads silently produce garbage data. -- `pool_reader.rs:46-56`, `execute_carnage_atomic.rs:930+`

8. **`force_carnage` is properly feature-gated**: `#[cfg(feature = "devnet")]` at the instruction level in `lib.rs:261`. Will not compile into mainnet binary. Uses hardcoded `DEVNET_ADMIN` pubkey for access control. -- `lib.rs:261`, `force_carnage.rs:19`

9. **VRF byte interpretation uses modulo-4 for rate selection**: `vrf_result[n] % 4` maps each byte to 4 discrete rates. Byte values 0-255 distribute as 64/64/64/64 across the 4 buckets, giving perfectly uniform distribution. -- `tax_derivation.rs:89-94`

10. **`Token::from_u8_unchecked` maps any non-zero value to Fraud**: If `cheap_side` field is corrupted to a value > 1, it will be interpreted as `Token::Fraud` rather than causing an error. This is defense-in-depth (Fraud is a valid state), but it could mask data corruption. -- `enums.rs:40-45`

## Critical Mechanisms

- **VRF Commit-Reveal Flow**: Three-transaction sequence: (1) create randomness, (2) commit + trigger_epoch_transition, (3) reveal + consume_randomness. Anti-reroll binding at step 2 stores the randomness account key. Freshness check requires seed_slot within 1 slot. Owner check validates Switchboard program ID. -- `trigger_epoch_transition.rs:129-191`, `consume_randomness.rs:108-207`

- **Tax Rate Derivation from VRF**: 5 VRF bytes determine tax configuration: byte 0 (75% flip probability), bytes 1-2 (CRIME low/high magnitude), bytes 3-4 (FRAUD low/high magnitude). Rates are discrete: {100, 200, 300, 400} bps for low, {1100, 1200, 1300, 1400} bps for high. No continuous values possible. -- `tax_derivation.rs:84-127`

- **Carnage Trigger from VRF**: Byte 5 < 11 triggers Carnage (~4.3%). Byte 6 < 5 selects Sell action (~2%). Byte 7 < 128 selects CRIME target (50%). These three decisions are determined entirely by verifiable randomness. -- `carnage.rs:25-63`

- **Cross-Program Tax Rate Consumption**: Tax Program reads EpochState via manual deserialization from `AccountInfo`, validates owner == Epoch Program ID and discriminator matches. Does NOT check `taxes_confirmed` flag. -- `swap_sol_buy.rs:57-78`

- **VRF Timeout Recovery**: If oracle does not reveal within 300 slots (~2 min), `retry_epoch_vrf` allows binding a fresh randomness account. Same freshness and owner checks as trigger. Permissionless. -- `retry_epoch_vrf.rs:57-121`

## Invariants & Assumptions

- INVARIANT: Randomness account must be owned by Switchboard program -- enforced at `trigger_epoch_transition.rs:56`, `consume_randomness.rs:52`, `retry_epoch_vrf.rs:37`
- INVARIANT: Consumed randomness account must match the committed one -- enforced at `consume_randomness.rs:154-157`
- INVARIANT: Randomness seed_slot must be within 1 slot of current -- enforced at `trigger_epoch_transition.rs:166`, `retry_epoch_vrf.rs:90`
- INVARIANT: Only one VRF request can be pending at a time (`vrf_pending` flag) -- enforced at `trigger_epoch_transition.rs:149`
- INVARIANT: Tax rates are within bounded ranges (100-400 bps low, 1100-1400 bps high) -- enforced by discrete lookup tables in `tax_derivation.rs:23-26`
- ASSUMPTION: Switchboard On-Demand oracle will reveal within 300 slots (~2 min) -- recovery via `retry_epoch_vrf.rs` if violated
- ASSUMPTION: Switchboard `RandomnessAccountData::parse()` and `get_value()` correctly validate the oracle signature -- UNVALIDATED by this codebase (trusts SDK)
- ASSUMPTION: Tax Program's EpochState mirror struct matches Epoch Program's layout exactly -- validated by matching field order in `epoch_state_reader.rs` against `epoch_state.rs`, both have static assertions for 100-byte data size
- ASSUMPTION: AMM PoolState layout offsets (137-153 for reserves) remain stable -- NOT validated at runtime; silent corruption if layout changes

## Risk Observations (Prioritized)

1. **Stale tax rates during VRF pending window**: `swap_sol_buy.rs:78`, `swap_sol_sell.rs:93` -- Swaps continue using previous epoch's rates while VRF is pending. The window is typically ~3 slots but could extend to 300+ slots if oracle fails. An attacker who knows the previous rates can trade without uncertainty during transitions. Impact: LOW -- rates are already public on-chain and the protocol intentionally does not pause during transitions.

2. **Hardcoded byte offsets for AMM reserve reads**: `pool_reader.rs:46-56` -- If AMM PoolState struct layout changes (field added/removed before reserves), Tax and Epoch programs silently read wrong values. This could affect slippage floor calculations and Carnage swap sizing. Impact: MEDIUM for upgrade scenarios.

3. **No cap on VRF retry count**: `retry_epoch_vrf.rs` -- Repeated oracle failures could keep the protocol in VRF-pending state indefinitely (each retry restarts 300-slot timer). During this time, taxes_confirmed remains false but swaps still proceed with old rates. Impact: LOW -- protocol remains functional, just not updated.

4. **`from_u8_unchecked` silent default to Fraud**: `enums.rs:40-45` -- Used in `consume_randomness.rs:194` when reading `epoch_state.cheap_side`. A corrupted value silently defaults to Fraud rather than failing. Impact: LOW -- Fraud is a valid state.

## Novel Attack Surface

- **VRF Byte Observation for Carnage Front-Running**: The Switchboard reveal transaction exposes VRF bytes before `consume_randomness` processes them. An MEV-aware actor observing the reveal TX could determine if Carnage will trigger (byte 5 < 11) and front-run with positions that benefit from Carnage execution (e.g., providing liquidity, manipulating pool reserves). The atomic path (bundled in same TX) mitigates this for the primary execution, but the fallback path (separate TX after lock window) is observable. This is protocol-specific because Carnage swaps large amounts against the AMM, creating predictable price impact.

- **Epoch Skip Attack Surface**: If `trigger_epoch_transition` is not called for multiple epoch boundaries, `current_epoch` jumps directly to the latest epoch (line 176). All skipped epochs use the same VRF result. This means tax rates and Carnage decisions for skipped epochs are never independently determined. An attacker could withhold triggers during known-favorable tax regimes, though this is economically irrational (bounty incentivizes timely triggers).

## Cross-Focus Handoffs

- -> **Arithmetic Agent**: Tax rate derivation uses `vrf_result[n] % 4` as array index -- verify no out-of-bounds possible (it cannot be, since u8 % 4 is always 0-3, but confirm). Also, the `current_epoch` function uses `saturating_sub` then division then `as u32` cast at `trigger_epoch_transition.rs:81` -- verify u32 overflow if protocol runs for many years.
- -> **CPI Agent**: `consume_randomness.rs:242-250` performs raw `invoke_signed` CPI to Staking Program's `update_cumulative`. Verify the staking program ID is correctly validated (it is, via address constraint at line 70). Also verify no privilege escalation via the `staking_authority` PDA.
- -> **Token/Economic Agent**: Pool reserve reads at hardcoded byte offsets (`pool_reader.rs:46-56`) feed into slippage floor calculations. If reserves are misread, slippage protection fails. Verify the output floor calculation in `tax_math.rs` is correct given potentially stale reserves (reserves could change between read and swap execution within same TX, but CPI to AMM happens after read, and AMM applies its own k-invariant check).
- -> **State Machine Agent**: The `taxes_confirmed` flag is set to false during VRF pending but is NOT checked by Tax Program. Determine if this is intentional (allow swaps with old rates during transition) or an oversight.
- -> **Upgrade/Admin Agent**: `force_carnage` is feature-gated to devnet. Verify it cannot be compiled into mainnet binary. Also verify that SWITCHBOARD_PROGRAM_ID feature flags cannot be misconfigured.

## Trust Boundaries

The protocol trusts Switchboard On-Demand as the sole source of randomness. Validation is three-fold: (1) owner check against known Switchboard program ID (feature-gated devnet/mainnet), (2) `RandomnessAccountData::parse()` validates internal structure, (3) `get_value()` validates the oracle has revealed valid data. The protocol does NOT use any external price oracle -- all pricing is internal AMM math. The trust boundary for randomness is: if Switchboard On-Demand SDK is compromised or if the program ID constant is wrong, an attacker could inject arbitrary "randomness" controlling tax rates and Carnage decisions. The anti-reroll binding and freshness checks protect against replay and cherry-picking but not against a compromised oracle itself.
<!-- CONDENSED_SUMMARY_END -->

---

# Oracle & External Data -- Full Analysis

## Executive Summary

The Dr Fraudsworth protocol uses Switchboard On-Demand VRF as its sole external data source. There are no traditional price oracles (Pyth, Switchboard aggregator feeds) anywhere in the codebase. This significantly narrows the oracle attack surface compared to typical DeFi protocols -- there are no stale price exploits, confidence interval attacks, or TWAP manipulation vectors.

The VRF integration follows a commit-reveal pattern with strong anti-reroll protection: the randomness account is bound at commit time and verified at reveal time, preventing attackers from cherry-picking favorable outcomes. The randomness determines two critical protocol parameters: (1) asymmetric tax rates for CRIME/FRAUD tokens, and (2) Carnage Fund execution decisions (trigger, action, target).

The most notable observation is that the Tax Program does not check the `taxes_confirmed` flag when reading EpochState, meaning swaps continue with previous epoch's rates during the VRF pending window. This is a design choice that prioritizes liveness over freshness.

Secondary external data is read via raw byte offsets from AMM PoolState accounts for slippage floor calculations. These reads trust hardcoded offsets and would silently break if the AMM PoolState layout changes.

## Scope

- **Files analyzed:** 17 source files across epoch-program, tax-program
- **Functions analyzed:** `trigger_epoch_transition::handler`, `consume_randomness::handler`, `retry_epoch_vrf::handler`, `force_carnage::handler`, `initialize_epoch_state::handler`, `derive_taxes`, `is_carnage_triggered`, `get_carnage_action`, `get_carnage_target`, `read_pool_reserves`, `swap_sol_buy::handler` (partial), `swap_sol_sell::handler` (partial), `EpochState::get_tax_bps`, `Token::from_u8_unchecked`
- **Estimated coverage:** 95% of oracle-relevant code

## Key Mechanisms

### 1. VRF Commit-Reveal Flow

**Location:** `trigger_epoch_transition.rs:129-246`, `consume_randomness.rs:108-318`

**Purpose:** Generates unpredictable randomness for tax rate determination and Carnage trigger decisions using Switchboard On-Demand VRF.

**How it works:**
1. **TX 1** (off-chain): Client creates a Switchboard randomness account via SDK
2. **TX 2**: Client bundles Switchboard `commitIx` + `trigger_epoch_transition`:
   - Lines 133-139: Validates epoch boundary reached (`expected_epoch > current_epoch`)
   - Line 149: Checks no VRF already pending
   - Lines 152-155: Parses randomness account data via `RandomnessAccountData::parse()`
   - Lines 159-166: Freshness check: `seed_slot` within 1 slot of current
   - Lines 170-173: Verifies randomness not yet revealed (must still be in commit phase)
   - Line 186: Binds `pending_randomness_account` for anti-reroll protection
3. **TX 3**: Client bundles Switchboard `revealIx` + `consume_randomness`:
   - Line 151: Validates VRF is pending
   - Lines 154-157: Anti-reroll: verifies randomness account matches bound key
   - Lines 164-171: Reads 32 revealed bytes via `get_value(clock.slot)`
   - Lines 192-203: Derives tax rates from bytes 0-4
   - Line 206-207: Clears VRF pending, sets taxes_confirmed
   - Lines 269-312: Checks Carnage trigger from bytes 5-7

**Assumptions:**
- Switchboard On-Demand oracle is honest and produces cryptographically secure randomness
- `RandomnessAccountData::parse()` correctly validates oracle signatures
- `get_value(clock.slot)` only returns data if the oracle has completed the reveal
- Client correctly bundles Switchboard SDK instructions with protocol instructions

**Invariants:**
- VRF pending flag prevents double-commit
- Bound randomness account prevents reroll
- Freshness check (slot_diff <= 1) prevents stale randomness reuse
- Owner check prevents fake randomness accounts

**Concerns:**
- The freshness check `slot_diff <= 1` relies on `Clock::get()?.slot` matching the slot at which the randomness was created. In practice, the client creates the randomness account in a separate TX, then bundles commit + trigger in the next TX. If there's a 2+ slot gap (network congestion), the trigger fails and must be retried.

### 2. Tax Rate Derivation from VRF Bytes

**Location:** `tax_derivation.rs:84-128`

**Purpose:** Converts 5 bytes of VRF randomness into discrete tax rates for CRIME and FRAUD tokens.

**How it works:**
1. Line 86: Byte 0 determines flip (< 192 = 75% probability of flipping cheap side)
2. Lines 89-90: Bytes 1-2 select CRIME low/high rates via `% 4` index into lookup tables
3. Lines 93-94: Bytes 3-4 select FRAUD low/high rates independently
4. Lines 97-101: Determine new cheap side (flip or stay)
5. Lines 106-117: Assign buy/sell rates based on cheap/expensive side

**Assumptions:**
- VRF bytes are uniformly distributed (Switchboard guarantees this)
- `% 4` produces uniform distribution over 4 buckets (true for 256/4 = 64 values each)

**Invariants:**
- All possible tax rates are bounded: low in {100, 200, 300, 400} bps, high in {1100, 1200, 1300, 1400} bps
- The modulo-4 indexing into fixed arrays cannot go out of bounds

**Concerns:**
- None. The derivation is deterministic, bounded, and simple.

### 3. Carnage Trigger from VRF Bytes

**Location:** `carnage.rs:25-63`

**Purpose:** Uses VRF bytes 5-7 to determine if Carnage triggers, what action to take, and which token to target.

**How it works:**
1. `is_carnage_triggered`: byte 5 < 11 (11/256 = ~4.3%)
2. `get_carnage_action`: If no holdings -> None (BuyOnly). If holdings: byte 6 < 5 -> Sell (2%), else Burn (98%)
3. `get_carnage_target`: byte 7 < 128 -> CRIME (50%), else FRAUD (50%)

**Assumptions:**
- Byte values are independent (Switchboard VRF provides 32 uniform independent bytes)

**Invariants:**
- Trigger probability is exactly 11/256 per epoch
- Sell probability given trigger and holdings is exactly 5/256

**Concerns:**
- None for the on-chain logic. Off-chain: an observer could front-run the Carnage execution by observing the reveal TX (see Novel Attack Surface).

### 4. Randomness Account Validation

**Location:** `trigger_epoch_transition.rs:52-57`, `consume_randomness.rs:50-53`, `retry_epoch_vrf.rs:35-38`

**Purpose:** Ensures the randomness account is genuinely owned by the Switchboard On-Demand program.

**How it works:**
- Anchor `owner` constraint checks `randomness_account.owner == SWITCHBOARD_PROGRAM_ID`
- `SWITCHBOARD_PROGRAM_ID` is set via feature flags to `switchboard_on_demand::ON_DEMAND_DEVNET_PID` or `ON_DEMAND_MAINNET_PID`
- After owner check, `RandomnessAccountData::parse(data)` validates the internal data structure

**Assumptions:**
- The `switchboard_on_demand` crate (v0.11.3) provides correct program IDs
- `parse()` cannot be fooled by a malicious account that happens to be owned by Switchboard

**Invariants:**
- All three VRF instructions (trigger, consume, retry) enforce the same owner check

**Concerns:**
- If the `switchboard-on-demand` crate is updated and program IDs change, the protocol must be redeployed. The pinned version (`=0.11.3`) prevents surprise changes from `cargo update`.

### 5. Cross-Program Tax Rate Consumption

**Location:** `swap_sol_buy.rs:57-78`, `swap_sol_sell.rs:72-93`, `epoch_state_reader.rs:16-75`

**Purpose:** Tax Program reads VRF-derived tax rates from EpochState during swap execution.

**How it works:**
1. Owner check: `epoch_state.owner == epoch_program_id()` (lines 60-63)
2. Discriminator validation: `EpochState::try_deserialize()` checks sha256("account:EpochState")[0..8]
3. Initialized check: `epoch_state.initialized == true`
4. Rate lookup: `epoch_state.get_tax_bps(is_crime, is_buy)`

**Assumptions:**
- EpochState mirror struct in Tax Program matches Epoch Program's layout exactly
- The Epoch Program ID constant in Tax Program's constants.rs matches the deployed program

**Invariants:**
- Tax rates read are whatever is stored in EpochState, regardless of `taxes_confirmed` flag

**Concerns:**
- `taxes_confirmed` is NOT checked. During VRF pending window, swaps use previous epoch's rates. This window is typically ~3 slots (~1.2 seconds) but extends to 300+ slots if oracle fails. The flag exists in the mirror struct (`epoch_state_reader.rs:36`) but is never read by swap logic.
- If the Epoch Program's EpochState struct is updated with new fields, the Tax Program's mirror MUST be updated in lockstep. The static size assertion (`LEN = 108`) helps catch this at compile time.

### 6. Pool Reserve Reading (Secondary External Data)

**Location:** `pool_reader.rs:39-58`, `execute_carnage_atomic.rs:930+`, `execute_carnage.rs:863+`

**Purpose:** Read AMM pool reserves for slippage floor calculations without importing AMM crate.

**How it works:**
- Reads raw bytes at offsets 137-145 (reserve_a) and 145-153 (reserve_b) from PoolState AccountInfo
- Interprets as little-endian u64

**Assumptions:**
- AMM PoolState has the documented byte layout with reserves at offsets 137-153
- The account data is at least 153 bytes long (checked at line 44)

**Invariants:**
- If data is < 153 bytes, returns error
- If byte slice conversion fails, returns error

**Concerns:**
- No owner check on the pool account in `pool_reader.rs` itself (the calling context may validate the pool, but `read_pool_reserves` takes raw `AccountInfo`). Need to verify callers validate pool ownership.
- Hardcoded offsets create tight coupling with AMM PoolState layout. Any AMM upgrade that changes field ordering before reserves would cause silent misreads.

## Trust Model

**Trusted:**
- Switchboard On-Demand program and its oracle network (sole source of randomness)
- The `switchboard-on-demand` crate (v0.11.3) for correct program IDs and data parsing
- AMM PoolState byte layout at hardcoded offsets (for slippage floor reads)
- Feature flag build system (devnet vs mainnet Switchboard program IDs)

**Untrusted:**
- Any user can call `trigger_epoch_transition`, `consume_randomness`, `retry_epoch_vrf` (permissionless)
- The randomness account is user-provided but validated via owner + freshness + not-revealed + binding

**Boundaries:**
- Epoch Program -> Switchboard: trusts oracle output if account passes owner check and SDK parse
- Tax Program -> Epoch Program: trusts EpochState data if account passes owner check and discriminator
- Tax/Epoch Programs -> AMM: trusts pool account data at raw byte offsets

## State Analysis

**VRF-related state in EpochState:**
- `vrf_request_slot: u64` -- when VRF was committed (0 = none)
- `vrf_pending: bool` -- whether a VRF request is in progress
- `taxes_confirmed: bool` -- whether current epoch's taxes have been set from VRF
- `pending_randomness_account: Pubkey` -- bound randomness account key

**Tax state derived from VRF:**
- `cheap_side: u8` -- which token is currently cheap (0=CRIME, 1=FRAUD)
- `crime_buy_tax_bps, crime_sell_tax_bps, fraud_buy_tax_bps, fraud_sell_tax_bps: u16` -- per-token rates

**Carnage state derived from VRF:**
- `carnage_pending: bool`, `carnage_action: u8`, `carnage_target: u8`
- `carnage_deadline_slot: u64`, `carnage_lock_slot: u64`

## Dependencies

- `switchboard-on-demand = "=0.11.3"` -- VRF SDK (pinned exact version)
- `anchor_lang::solana_program::program::invoke_signed` -- for staking CPI in consume_randomness
- AMM PoolState raw byte layout -- implicit dependency (no Cargo dep)

## Focus-Specific Analysis

### Oracle Dependency Map

| Data Point | Oracle Source | Feed Address/ID | Staleness Check? | Confidence Check? | Fallback? |
|-----------|-------------|----------------|-------------------|-------------------|-----------|
| Tax rate randomness | Switchboard VRF On-Demand | Per-request randomness account (ephemeral) | Yes: seed_slot within 1 slot | N/A (VRF, not price) | Yes: retry_epoch_vrf after 300 slots |
| Pool reserves (slippage) | AMM PoolState (internal) | Pool PDA per token pair | No (read at instruction time) | N/A | No |

### Price Manipulation Analysis

**Not applicable** -- The protocol does not use external price oracles. All price discovery is via internal AMM constant-product formula. The VRF randomness determines tax rates and Carnage triggers, not prices.

For the AMM pool reserve reads used in slippage floor calculations:
- Reserves are read from on-chain AMM state, which can change within the same transaction via prior instructions
- However, the slippage floor is a MINIMUM -- it only rejects if user's requested minimum_output is below the floor. The AMM itself enforces actual output >= user's minimum_output during CPI
- Manipulation risk: An attacker could sandwich the slippage floor read by manipulating reserves, but the floor is a lower bound check on the USER's minimum_output parameter, not on the actual swap. The AMM's k-invariant check during CPI is the real slippage protection.

### Staleness Window Assessment

**VRF Staleness:**
- Maximum staleness: 1 slot (~400ms) for randomness account seed_slot
- If oracle fails to reveal: protocol continues with old tax rates indefinitely until retry succeeds
- Maximum VRF pending window before retry: 300 slots (~2 minutes)
- After retry: another 300-slot window before next retry
- Protocol behavior during staleness: swaps continue with previous epoch's tax rates (functional but not updated)

**Pool Reserve Staleness:**
- Read at instruction execution time -- reflects current on-chain state
- Can be manipulated within same transaction by prior instructions
- Protected by: (1) protocol output floor check, (2) user's minimum_output, (3) AMM's k-invariant

### Multi-Source Analysis

**VRF:** Single source (Switchboard On-Demand). No fallback to alternative randomness provider. If Switchboard is unavailable, protocol enters VRF-pending state and retries. Tax rates remain stale but protocol remains functional.

**Pool reserves:** Single source per pool (the AMM pool account itself). This is appropriate since the AMM IS the pricing mechanism.

## Cross-Focus Intersections

- **Arithmetic**: Tax derivation uses `% 4` and array indexing. The `current_epoch` function casts to u32 after division (`as u32` at `trigger_epoch_transition.rs:81`). After ~1.2 million years at 30-minute epochs, this overflows. Not a practical concern.
- **CPI**: `consume_randomness` performs CPI to Staking `update_cumulative` via raw `invoke_signed`. The staking program ID is validated via `address` constraint.
- **State Machine**: The VRF lifecycle (idle -> pending -> confirmed) is a mini state machine. The `taxes_confirmed` flag exists but is not enforced by consumers.
- **Token/Economic**: Tax rates directly affect swap economics. The VRF-derived rates determine whether buying CRIME or FRAUD is favorable.
- **Timing**: The 1-slot freshness window, 300-slot timeout, and 300-slot Carnage deadline are all timing-dependent. Slot skipping could affect these windows.

## Cross-Reference Handoffs

- -> **Arithmetic Agent**: Verify `current_epoch()` at `trigger_epoch_transition.rs:80-82` -- the `as u32` cast on the division result. With `SLOTS_PER_EPOCH = 4500` and `u64` input, the maximum epoch number before u32 overflow is ~953K, which at 30-min epochs = ~54 years. Safe but document the bound.
- -> **CPI Agent**: Verify the raw `invoke_signed` CPI from `consume_randomness.rs:242-250` to staking program. Is the staking_authority PDA correctly derived? Can the instruction data be malformed?
- -> **State Machine Agent**: Investigate whether `taxes_confirmed = false` during VRF pending is intentional. Should swaps be blocked/modified during this window? What is the spec's intent?
- -> **Access Control Agent**: `force_carnage.rs:19` hardcodes `DEVNET_ADMIN` pubkey. Verify this instruction module is not compiled without `devnet` feature. Check the mod.rs and lib.rs feature gating.
- -> **Token/Economic Agent**: The pool reserve reads at `pool_reader.rs:39-58` feed into `calculate_output_floor`. Verify the floor calculation handles edge cases (empty pool, zero reserves). Also verify pool account ownership is checked by the caller (swap_sol_buy account struct).

## Risk Observations

1. **Stale tax rates during VRF pending (LOW)**: `swap_sol_buy.rs:78` -- Swaps execute with previous epoch's rates while VRF is pending. Window typically ~1.2s, extends if oracle fails. Rates are public on-chain so no information asymmetry. Design choice favoring liveness.

2. **Hardcoded AMM byte offsets (MEDIUM for upgrades)**: `pool_reader.rs:46-56` -- Reserves read at offsets 137-153. Any AMM PoolState layout change breaks this silently. Mitigation: AMM and Tax/Epoch programs are deployed together.

3. **Infinite VRF retries (LOW)**: `retry_epoch_vrf.rs` -- No retry cap. Could keep protocol in VRF-pending state indefinitely if Switchboard is systematically down. Taxes remain at old values. No economic damage but reduced dynamism.

4. **Carnage front-running via reveal observation (MEDIUM)**: Reveal TX exposes VRF bytes before Carnage executes. Atomic path mitigates for primary execution but fallback path (after 50-slot lock) is vulnerable. Attacker could position before large Carnage swap.

5. **`from_u8_unchecked` default behavior (LOW)**: `enums.rs:40-45` -- Corrupted `cheap_side` value silently defaults to Fraud. Not exploitable (cannot corrupt on-chain data via normal instructions) but masks potential data integrity issues.

## Novel Attack Surface Observations

1. **VRF-Predictable Carnage Front-Running**: When Carnage triggers via VRF, the reveal TX makes the Carnage decision visible before execution. An MEV-aware actor could:
   - Observe the reveal TX in mempool
   - Determine Carnage will trigger (byte 5 < 11)
   - Determine target token (byte 7)
   - Front-run with a large buy of the target token (knowing Carnage will buy it too, pushing price up)
   - Back-run after Carnage executes to sell at higher price
   The atomic path (bundled TX) prevents this for the primary execution. But if atomic fails and falls back, the 50-slot lock window creates observable intent. After lock expires, the fallback is a separate TX that can be sandwiched.

2. **Epoch Skip Tax Rate Gaming**: If no one triggers the epoch transition for N epochs (perhaps during low-activity periods), the first trigger jumps directly to epoch N+current. Only one VRF result determines the new rates, regardless of how many epochs were skipped. A sophisticated actor could monitor the VRF reveal and only trigger transitions that produce favorable tax rates, though the 0.001 SOL bounty makes this economically marginal.

3. **Cross-Program Layout Drift**: The Tax Program's `epoch_state_reader.rs` is a manual mirror of Epoch Program's EpochState. If a developer adds a field to one but not the other, Borsh deserialization would silently read shifted bytes. The static size assertion (`LEN == 108`) catches size changes but not field reordering. This is a maintenance risk, not an active vulnerability.

## Questions for Other Focus Areas

- **For State Machine focus**: Is the `taxes_confirmed` flag intended as a consumer-side check (should Tax Program block swaps during VRF pending) or purely as internal Epoch Program state? The spec says "taxes_confirmed = false between trigger and consume" but doesn't specify Tax Program behavior during this window.
- **For CPI focus**: The `consume_randomness` instruction builds raw CPI instruction data (`ix_data`) with a hardcoded discriminator. Is the `UPDATE_CUMULATIVE_DISCRIMINATOR` verified correct? (There IS a unit test at `constants.rs:181-192` that verifies it against sha256.)
- **For Access Control focus**: Can the `force_carnage` module be accidentally compiled into mainnet? The lib.rs uses `#[cfg(feature = "devnet")]` on the instruction function but the module itself (`instructions/mod.rs:8`) imports it unconditionally with `pub mod force_carnage;`. Verify the build system ensures mainnet builds never include the `devnet` feature.
- **For Timing focus**: The 1-slot freshness check (`slot_diff <= 1`) for randomness accounts assumes the trigger TX lands within 1 slot of randomness creation. During network congestion, could this window be too tight, effectively preventing epoch transitions?

## Raw Notes

### Previous Finding Recheck: H090 (LOW -- Consume randomness edge cases)

From the previous audit, H090 flagged edge cases in `consume_randomness`. Re-examining against modified code:

- **Anti-reroll binding**: Still correctly implemented at line 154-157
- **VRF byte length check**: Lines 176-179 check `vrf_result.len() >= MIN_VRF_BYTES`. Since `get_value()` returns `[u8; 32]`, this is always true. The check is defensive only.
- **Auto-expire of stale Carnage**: Lines 112-148 handle the case where previous Carnage expired. This is new and addresses a potential state stuck scenario.
- **Carnage state is Optional**: `carnage_state: Option<Account<'info, CarnageFundState>>` at line 80 means the Carnage check can be skipped. This is intentional for backward compatibility.

Assessment: H090 concerns appear addressed in current code. The auto-expire mechanism is new and correctly clears stale Carnage state.

### Switchboard SDK Version Analysis

`switchboard-on-demand = "=0.11.3"` (exact pin):
- This is a relatively recent version of the On-Demand (v2) SDK
- The `=` prefix prevents cargo from selecting a different version
- `RandomnessAccountData::parse()` validates internal account structure
- `get_value(slot)` returns randomness only if the oracle has revealed
- No known vulnerabilities in this SDK version at time of analysis

### VRF Byte Allocation Summary

| Byte | Purpose | Range | Probability |
|------|---------|-------|-------------|
| 0 | Flip cheap side | < 192 = flip | 75% flip, 25% stay |
| 1 | CRIME low magnitude | % 4 | 25% each of {100, 200, 300, 400} bps |
| 2 | CRIME high magnitude | % 4 | 25% each of {1100, 1200, 1300, 1400} bps |
| 3 | FRAUD low magnitude | % 4 | 25% each of {100, 200, 300, 400} bps |
| 4 | FRAUD high magnitude | % 4 | 25% each of {1100, 1200, 1300, 1400} bps |
| 5 | Carnage trigger | < 11 | 4.3% trigger |
| 6 | Carnage action | < 5 = sell | 2% sell / 98% burn (given trigger + holdings) |
| 7 | Carnage target | < 128 = CRIME | 50/50 CRIME/FRAUD |
| 8-31 | Unused | -- | -- |
