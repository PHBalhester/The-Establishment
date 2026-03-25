---
task_id: sos-phase1-oracle
provides: [oracle-findings, oracle-invariants]
focus_area: oracle
files_analyzed:
  - programs/epoch-program/src/instructions/trigger_epoch_transition.rs
  - programs/epoch-program/src/instructions/consume_randomness.rs
  - programs/epoch-program/src/instructions/retry_epoch_vrf.rs
  - programs/epoch-program/src/instructions/execute_carnage_atomic.rs
  - programs/epoch-program/src/instructions/execute_carnage.rs
  - programs/epoch-program/src/helpers/carnage.rs
  - programs/epoch-program/src/helpers/carnage_execution.rs
  - programs/epoch-program/src/helpers/tax_derivation.rs
  - programs/epoch-program/src/constants.rs
  - programs/epoch-program/src/state/epoch_state.rs
  - programs/epoch-program/src/state/enums.rs
  - programs/epoch-program/src/errors.rs
  - programs/epoch-program/Cargo.toml
  - programs/tax-program/src/helpers/pool_reader.rs
  - programs/tax-program/src/state/epoch_state_reader.rs
  - programs/tax-program/src/instructions/swap_sol_buy.rs
  - programs/tax-program/src/instructions/swap_sol_sell.rs
finding_count: 8
severity_breakdown: {critical: 0, high: 1, medium: 5, low: 2}
---
<!-- CONDENSED_SUMMARY_START -->
# Oracle & External Data — Condensed Summary

## Key Findings (Top 8)

1. **VRF freshness underflow via `saturating_sub`**: If `randomness_data.seed_slot > clock.slot` (future-dated seed), `saturating_sub` returns 0, which passes the `<= 1` freshness check. A Switchboard oracle reporting a future seed_slot bypasses the freshness window. — `trigger_epoch_transition.rs:174`, `retry_epoch_vrf.rs:83`

2. **Optional `carnage_state` in `consume_randomness` allows Carnage skip**: Anyone can omit the `carnage_state` account, causing the Carnage trigger check to be silently skipped. A MEV actor or griever can consistently call `consume_randomness` without `carnage_state` to suppress all Carnage events permanently. — `consume_randomness.rs:76-80`

3. **Owner validation on pool accounts in Carnage execution is at struct level, not function level**: The Epoch Program's `read_pool_reserves` (carnage_execution.rs:825) does NOT check the pool account's owner internally (unlike the Tax Program version at pool_reader.rs:61). HOWEVER, the Anchor struct constraints on `crime_pool` and `fraud_pool` in `ExecuteCarnageAtomic` (line 118, 133) and `ExecuteCarnage` enforce `owner = amm_program_id()`. The function-level omission is mitigated by struct-level validation. Defense-in-depth gap only. — `carnage_execution.rs:825-851`, `execute_carnage_atomic.rs:118,133`

4. **Single oracle dependency (Switchboard only)**: The protocol depends entirely on Switchboard On-Demand for VRF randomness. No fallback oracle exists. If Switchboard is offline, the protocol cannot advance epochs beyond the retry mechanism (retry_epoch_vrf waits 300 slots, then retries with a fresh randomness account — which also requires Switchboard). — `constants.rs:41-49`

5. **VRF byte interpretation is fixed and deterministic**: Tax rates and Carnage decisions are derived from hardcoded byte positions (0-7) with hardcoded thresholds. Any change to the VRF output format by Switchboard (e.g., different hash function or output encoding) would silently alter all protocol economics without on-chain detection. — `tax_derivation.rs:84-128`, `carnage.rs:25-63`

6. **Switchboard VRF program ID is correctly feature-flagged**: Devnet uses `ON_DEMAND_DEVNET_PID`, mainnet uses `ON_DEMAND_MAINNET_PID`. Owner constraint on randomness accounts prevents fake-randomness injection. — `constants.rs:45-49`

7. **Anti-reroll protection is sound**: `trigger_epoch_transition` binds the randomness account pubkey to `epoch_state.pending_randomness_account`, and `consume_randomness` enforces exact match at line 155. This prevents VRF reroll attacks. — `trigger_epoch_transition.rs:201`, `consume_randomness.rs:154-157`

8. **AMM pool reserves used as internal price oracle for slippage**: Both the Epoch Program (Carnage) and Tax Program read AMM pool reserves from raw bytes at hardcoded offsets to calculate expected swap output. These are not external oracles (they read on-chain state from the protocol's own AMM), but function as a price source for slippage enforcement. — `carnage_execution.rs:285-288`, `pool_reader.rs:57-97`

## Critical Mechanisms

- **Switchboard VRF Commit-Reveal (3-TX flow)**: TX1: Client creates randomness account. TX2: Client bundles Switchboard `commitIx` + `trigger_epoch_transition` (binds account, validates freshness <= 1 slot). TX3: Client bundles Switchboard `revealIx` + `consume_randomness` (reads VRF bytes, derives taxes, checks Carnage). The binding at commit time prevents reroll attacks. — `trigger_epoch_transition.rs:136-266`, `consume_randomness.rs:108-331`

- **VRF Timeout Recovery (`retry_epoch_vrf`)**: If oracle fails to reveal within 300 slots (~2 min), anyone can create a fresh randomness account and rebind it. Same freshness checks apply. This prevents protocol deadlock from oracle failure. — `retry_epoch_vrf.rs:57-122`

- **Tax Rate Derivation from VRF Bytes**: 5 bytes (0-4) produce: flip decision (byte 0 < 192 = 75% flip), 4 independent magnitude rolls (bytes 1-4, each % 4 indexes into [100,200,300,400] or [1100,1200,1300,1400] BPS). Output is entirely deterministic given VRF input. — `tax_derivation.rs:84-128`

- **Carnage Trigger from VRF Bytes**: 3 bytes (5-7): byte 5 < 11 = trigger (~4.3%), byte 6 < 5 = sell (2%), byte 7 < 128 = CRIME target (50%). All deterministic from VRF. — `carnage.rs:25-63`

- **AMM Pool Reserve Slippage Floor**: Carnage reads pool reserves before swap CPI, computes constant-product expected output, enforces minimum (85% atomic / 75% fallback). Tax Program also reads reserves for pre-swap slippage in buy/sell paths. — `carnage_execution.rs:331-350`, `pool_reader.rs:57-97`

## Invariants & Assumptions

- INVARIANT: Randomness account owner == SWITCHBOARD_PROGRAM_ID — enforced at `trigger_epoch_transition.rs:58`, `consume_randomness.rs:52`, `retry_epoch_vrf.rs:37`
- INVARIANT: `consume_randomness` must use the same randomness account bound at trigger time — enforced at `consume_randomness.rs:154-157`
- INVARIANT: VRF bytes produce deterministic tax rates in bounded ranges [100-400] and [1100-1400] BPS — enforced structurally by `LOW_RATES`/`HIGH_RATES` array indexing at `tax_derivation.rs:89-94`
- INVARIANT: Carnage trigger probability is exactly 11/256 (~4.3%) — enforced by `CARNAGE_TRIGGER_THRESHOLD = 11` at `constants.rs:142`
- ASSUMPTION: Switchboard `RandomnessAccountData::parse()` correctly validates account structure — validated by SDK, NOT by on-chain code directly
- ASSUMPTION: `seed_slot` from Switchboard is honest (not future-dated) — UNVALIDATED on-chain; `saturating_sub` masks future-dated seed_slots
- ASSUMPTION: Switchboard oracle will reveal within 300 slots — timeout recovery exists at `retry_epoch_vrf.rs`, but if ALL Switchboard oracles are down, protocol halts
- ASSUMPTION: AMM pool reserves read from raw bytes at offsets [137..145] and [145..153] are current and accurate — validated only by owner check (Tax Program) or NOT validated (Epoch Program Carnage)

## Risk Observations (Prioritized)

1. **VRF freshness `saturating_sub` underflow**: `trigger_epoch_transition.rs:174` — A future-dated `seed_slot` yields `slot_diff = 0`, passing the `<= 1` freshness check. While this requires a Switchboard oracle to report future seed_slots (which should not happen in normal operation), the on-chain code does not defensively reject this case. Same pattern at `retry_epoch_vrf.rs:83`.

2. **Pool owner check is at struct level, not function level (defense-in-depth gap)**: `carnage_execution.rs:825-851` — The function does NOT verify pool account owner, unlike Tax Program's `pool_reader.rs:61`. Mitigated by Anchor struct constraints: `execute_carnage_atomic.rs:118,133` enforce `owner = amm_program_id()`. Not directly exploitable, but if the function is ever reused outside these structs, the omission becomes a vulnerability.

3. **Optional `carnage_state` griefing**: `consume_randomness.rs:76-80` — Permissionless callers can permanently suppress Carnage by always omitting this account. Since `consume_randomness` is permissionless (anyone can call after oracle reveals), a bot can front-run legitimate callers and consume VRF without triggering Carnage.

4. **Modulo bias in VRF byte interpretation**: `tax_derivation.rs:89-94` — `vrf_result[n] % 4` has slight modulo bias: 256 is not evenly divisible by 4 (256/4 = 64 exactly, so no bias). However, `CARNAGE_TRIGGER_THRESHOLD = 11` means 11/256 = 4.296875%, not exactly 4.3%. The Carnage sell threshold `< 5` gives 5/256 = 1.953125%. These are documented accurately. No actual bias issue, but the 50/50 target split (byte 7 < 128) is perfectly unbiased (128/256). Low risk: cosmetic documentation note only.

## Novel Attack Surface

- **Carnage Suppression via Permissionless `consume_randomness`**: A MEV bot could monitor for epoch transitions and always call `consume_randomness` without `carnage_state`, permanently preventing Carnage from ever triggering. This is unique to this protocol's design where a critical economic mechanism (Carnage) is gated by an optional account in a permissionless instruction. The bot has no cost beyond transaction fees.

- **Pool Reserve Manipulation for Carnage Slippage Gaming**: Since Carnage reads AMM pool reserves from raw bytes (without owner check in Epoch Program), and Carnage swaps are VRF-triggered (timing is partially predictable — VRF reveal is 3 slots after commit), a sophisticated attacker could: (1) manipulate pool reserves before the Carnage swap, (2) cause the slippage floor to compute a very low `min_output`, and (3) sandwich the Carnage swap for MEV extraction. The 50-slot atomic lock window mitigates this for the atomic path but not the fallback path (slots 50-300).

- **Protocol Halt via Sustained Switchboard Outage**: No fallback oracle or emergency mechanism exists if Switchboard is down for an extended period. `retry_epoch_vrf` creates a new Switchboard randomness account, so it cannot recover from Switchboard-wide failure. Tax rates freeze at their last values, staking yield stops accumulating, and Carnage cannot trigger. There is no admin override for mainnet builds (force_carnage is devnet-only).

## Cross-Focus Handoffs

- → **Access Control Agent**: `consume_randomness.rs:65-66` — `stake_pool` is `AccountInfo<'info>` with only `#[account(mut)]`; no owner or seeds constraint at Epoch level. The Staking CPI validates it downstream, but a caller passing a fake account succeeds at Epoch level before failing at Staking CPI. Defense-in-depth gap.
- → **Timing Agent**: VRF freshness window of `<= 1` slot (`trigger_epoch_transition.rs:181`, `retry_epoch_vrf.rs:90`) — is 1 slot sufficient to prevent pre-computed randomness? Given Switchboard creates randomness accounts ~1 slot before use, this is by design, but the timing agent should verify the slot gap cannot be exploited for timing manipulation.
- → **CPI Agent**: Pool owner check confirmed at Anchor struct level (`execute_carnage_atomic.rs:118,133`). CPI agent should verify the full validation chain: Epoch struct validates owner, Tax Program's swap_exempt validates pool contents during CPI. Also note: `read_pool_reserves` in `carnage_execution.rs:825` lacks the function-level owner check that `pool_reader.rs:61` has — defense-in-depth gap for future reuse.
- → **Token/Economic Agent**: Tax rates are bounded [1-4%] low and [11-14%] high by VRF byte interpretation. Economic agent should verify these bounds are economically sound and cannot produce degenerate protocol states (e.g., 1% buy tax + 14% sell tax creating arbitrage loops). Also: optional `carnage_state` in `consume_randomness` allows permanent Carnage suppression — economic impact assessment needed.
- → **Arithmetic Agent**: The slippage floor calculation at `carnage_execution.rs:332-344` uses `checked_mul/checked_div` with proper `u128` intermediates and `u64::try_from` — but the `reserve_sol > 0 && reserve_token > 0` guard (line 331) means zero-reserve pools skip slippage entirely.

## Trust Boundaries

The protocol trusts Switchboard On-Demand as the sole source of randomness. The trust boundary is at the `owner = SWITCHBOARD_PROGRAM_ID` constraint on randomness accounts — this ensures only accounts created by the real Switchboard program are accepted. Beyond this, the protocol trusts that Switchboard's `RandomnessAccountData::parse()` correctly validates account structure, that `seed_slot` is honest (not future-dated), and that `get_value()` returns cryptographically secure randomness. There is no secondary oracle or fallback mechanism. The protocol's own AMM pool reserves serve as an internal price oracle for slippage enforcement, creating a self-referential pricing trust model where the protocol trusts its own on-chain state for price validation.
<!-- CONDENSED_SUMMARY_END -->

---

# Oracle & External Data — Full Analysis

## Executive Summary

The Dr Fraudsworth protocol uses a single external data source: **Switchboard On-Demand VRF** for epoch randomness. There are no Pyth, Chainlink, or other price oracle integrations. The protocol does not price tokens against external price feeds — instead, it uses its own AMM pool reserves as an internal price source for slippage calculations during Carnage execution and tax swap operations.

The VRF integration follows a commit-reveal pattern across 3 transactions, with anti-reroll protection via account binding. The implementation is well-structured with proper owner constraints on randomness accounts, a timeout recovery mechanism (retry_epoch_vrf), and deterministic tax rate derivation from VRF bytes.

Key concerns center on: (1) a missing pool owner check in the Epoch Program's reserve reader that could allow slippage floor manipulation, (2) a `saturating_sub` pattern in freshness checks that masks future-dated oracle data, (3) an optional account that enables permanent Carnage suppression, and (4) single-oracle dependency with no fallback.

## Scope

- **Files analyzed (full read):** 17 files across epoch-program, tax-program
- **Functions analyzed:** trigger_epoch_transition::handler, consume_randomness::handler, retry_epoch_vrf::handler, execute_carnage_core, execute_carnage_atomic::handler, execute_carnage::handler, derive_taxes, is_carnage_triggered, get_carnage_action, get_carnage_target, read_pool_reserves (both versions), get_tax_bps, current_epoch, epoch_start_slot
- **Estimated coverage:** 95% of oracle-relevant code paths analyzed

## Key Mechanisms

### 1. Switchboard VRF Commit-Reveal Flow

**Location:** `trigger_epoch_transition.rs:136-266` (commit), `consume_randomness.rs:108-331` (reveal)

**Purpose:** Securely obtain randomness from Switchboard On-Demand to derive new tax rates and determine Carnage events.

**How it works:**
1. **TX1** (client-side): Create a fresh Switchboard randomness account
2. **TX2** (on-chain): `trigger_epoch_transition` validates:
   - Epoch boundary reached (line 150-154)
   - No VRF already pending (line 164)
   - Randomness account is fresh: `seed_slot` within 1 slot of current (line 174-181)
   - Randomness not yet revealed: `get_value()` returns error (line 185-188)
   - Binds randomness account pubkey to `pending_randomness_account` (line 201)
3. **TX3** (on-chain): `consume_randomness` validates:
   - VRF is pending (line 151)
   - Anti-reroll: randomness account matches bound account (line 154-157)
   - Reads 32 VRF bytes via `get_value(clock.slot)` (line 164-171)
   - Derives tax rates from bytes 0-4 (line 196)
   - Checks Carnage trigger from bytes 5-7 (line 282-328)

**Assumptions:**
- Switchboard creates randomness accounts with honest `seed_slot` values
- `RandomnessAccountData::parse()` correctly validates account structure
- VRF output is cryptographically unpredictable before reveal
- `get_value(clock.slot)` accurately determines if randomness has been revealed

**Invariants:**
- ANTI-REROLL: Only the randomness account bound at trigger time can be consumed
- FRESHNESS: Randomness account must have `seed_slot` within 1 slot of current slot
- OWNER: Randomness account must be owned by SWITCHBOARD_PROGRAM_ID
- SINGLE-USE: VRF can only be pending for one epoch at a time (vrf_pending flag)

**Concerns:**
- Line 174: `saturating_sub` underflow — future-dated `seed_slot` produces `slot_diff = 0` which passes freshness check
- Line 181: Freshness threshold of `<= 1` slot is extremely tight — assumes Switchboard creates accounts within 1 slot of use

### 2. VRF Timeout Recovery

**Location:** `retry_epoch_vrf.rs:57-122`

**Purpose:** Prevents protocol deadlock if Switchboard oracle fails to reveal within 300 slots.

**How it works:**
1. Validates VRF is pending (line 62)
2. Validates timeout elapsed: `elapsed_slots > VRF_TIMEOUT_SLOTS` (300 slots) (line 71-74)
3. Validates fresh replacement randomness account (same freshness checks as trigger) (line 77-96)
4. Overwrites pending state with new randomness account (line 102-103)

**Assumptions:**
- A new Switchboard randomness account can be created and will be assigned to a working oracle
- 300 slots (~2 minutes) is sufficient time to determine oracle failure

**Invariants:**
- TIMEOUT: Must wait > 300 slots before retry (strictly greater than, line 72)
- FRESH: Replacement randomness must also pass freshness check

**Concerns:**
- Line 83: Same `saturating_sub` pattern as trigger — future-dated seed_slot bypasses freshness
- No limit on retries — could repeatedly retry if all Switchboard oracles are down
- Timeout uses `saturating_sub(epoch_state.vrf_request_slot)` — if `vrf_request_slot` were somehow corrupted to a future value, timeout check would also pass via saturation to 0 (but 0 is NOT > 300, so this is actually safe — would prevent retry until enough slots pass)

### 3. Tax Rate Derivation from VRF

**Location:** `tax_derivation.rs:84-128`

**Purpose:** Converts VRF bytes 0-4 into bounded tax rates.

**How it works:**
- Byte 0: Flip decision (< 192 = 75% probability of flipping cheap side)
- Byte 1: CRIME low rate: `LOW_RATES[byte % 4]` → [100, 200, 300, 400] BPS
- Byte 2: CRIME high rate: `HIGH_RATES[byte % 4]` → [1100, 1200, 1300, 1400] BPS
- Byte 3: FRAUD low rate: same mapping
- Byte 4: FRAUD high rate: same mapping
- Assignment based on cheap side: cheap gets low buy / high sell, expensive gets high buy / low sell

**Assumptions:**
- VRF bytes are uniformly distributed (Switchboard guarantee)
- 4-element arrays with % 4 indexing has zero modulo bias (256 % 4 == 0)
- Array access via `% 4` cannot go out of bounds (correct: max index = 3)

**Invariants:**
- TAX BOUNDS: All tax rates are in {100, 200, 300, 400, 1100, 1200, 1300, 1400} BPS — no other values are possible
- FLIP PROBABILITY: Exactly 192/256 = 75%

**Concerns:**
- No concern with modulo bias (256 is evenly divisible by 4)
- Legacy fields `low_tax_bps` and `high_tax_bps` are set to 0 by `derive_taxes()` but then overwritten with min/max in `consume_randomness.rs:209-216` — this is correct behavior

### 4. Carnage VRF Byte Interpretation

**Location:** `carnage.rs:25-63`

**Purpose:** Determines whether Carnage triggers, what action to take, and which token to target.

**How it works:**
- Byte 5: `< 11` triggers Carnage (11/256 = 4.296875%)
- Byte 6: `< 5` = Sell action (5/256 = 1.953125%), else Burn (98%)
- Byte 7: `< 128` = CRIME target (50%), else FRAUD (50%)

**Assumptions:**
- VRF bytes are independent (no correlation between byte positions)
- `has_holdings` check is accurate (reads `carnage_state.held_amount > 0`)

**Invariants:**
- TRIGGER PROBABILITY: Exactly 11/256 per epoch
- TARGET BALANCE: 50/50 CRIME/FRAUD split (128/256 each)
- ACTION SPLIT: ~2% Sell, ~98% Burn (conditional on trigger)

**Concerns:**
- Byte 5 threshold of 11 means very slight bias: 11/256 = 4.296875% vs described "~4.3%". This is accurate documentation.
- No exhaustive enum matching — uses raw comparisons on u8 values, which is fine for byte-level interpretation

### 5. AMM Pool Reserve Reading (Internal Price Source)

**Location:** `carnage_execution.rs:825-851` (Epoch Program), `pool_reader.rs:57-97` (Tax Program)

**Purpose:** Read AMM pool reserves from raw bytes for slippage floor calculation.

**How it works (both versions):**
1. Read `mint_a` from bytes [9..41] to determine canonical ordering
2. Read `reserve_a` from bytes [137..145] and `reserve_b` from bytes [145..153]
3. If `mint_a == NATIVE_MINT`: return (reserve_a as SOL, reserve_b as token)
4. Else: return (reserve_b as SOL, reserve_a as token)

**CRITICAL DIFFERENCE:**
- **Tax Program version** (`pool_reader.rs:61-64`): Checks `*pool_info.owner == amm_program_id()` — SECURE
- **Epoch Program version** (`carnage_execution.rs:825-851`): NO owner check — VULNERABLE

**Assumptions:**
- Pool account bytes at documented offsets contain valid reserve data
- AMM PoolState byte layout is stable (hardcoded offsets)
- NATIVE_MINT (So11111111...112) sorts before all token mints

**Invariants:**
- BYTE LAYOUT: PoolState reserves are at offsets 137-145 (reserve_a) and 145-153 (reserve_b)
- MINIMUM SIZE: Account data must be >= 153 bytes

**Concerns:**
- **Missing owner check in Epoch Program version is the most significant finding.** An attacker could pass an account they control with carefully crafted bytes at offsets 137-153 to set arbitrary "reserve" values. This would affect the slippage floor calculation in Carnage execution.
- However, the pool accounts in `ExecuteCarnageAtomic` and `ExecuteCarnage` structs may have Anchor constraints that mitigate this — need to verify with CPI agent.

## Trust Model

### Trusted External Entity: Switchboard On-Demand

**What is trusted:**
- Switchboard program correctly creates randomness accounts with accurate `seed_slot`
- Switchboard oracle network reliably reveals randomness within ~3 slots
- VRF output is cryptographically secure 256-bit randomness
- `RandomnessAccountData::parse()` validates account structure and discriminator
- `get_value(slot)` returns randomness only after oracle has revealed

**What is NOT trusted (validated on-chain):**
- Randomness account ownership — validated via `owner = SWITCHBOARD_PROGRAM_ID` constraint
- Account identity — validated via anti-reroll pubkey binding
- Account freshness — validated via `seed_slot` proximity check (within 1 slot)
- Reveal status — validated via `get_value()` success/failure

### Trusted Internal Entity: Protocol's Own AMM

**What is trusted:**
- AMM pool reserves accurately reflect current token balances
- AMM byte layout at hardcoded offsets is correct
- AMM pool accounts passed to Carnage execution are genuine (PARTIALLY VALIDATED — Tax Program checks owner, Epoch Program does NOT)

### Untrusted Entities

- **Callers of permissionless instructions** (trigger_epoch_transition, consume_randomness, retry_epoch_vrf, execute_carnage, execute_carnage_atomic): Anyone can call these. The concern with `consume_randomness` is the optional `carnage_state`.
- **remaining_accounts**: Forwarded to CPI without individual validation (delegated to downstream programs)

## State Analysis

### Oracle-Related State (EpochState PDA)

| Field | Type | Set By | Read By | Purpose |
|-------|------|--------|---------|---------|
| `vrf_request_slot` | u64 | trigger_epoch_transition | retry_epoch_vrf (timeout check) | Slot when VRF was committed |
| `vrf_pending` | bool | trigger/consume/retry | All VRF instructions | Whether VRF request is active |
| `taxes_confirmed` | bool | trigger (false) / consume (true) | Tax Program swaps | Whether current tax rates are valid |
| `pending_randomness_account` | Pubkey | trigger/retry | consume (anti-reroll) | Bound randomness account |
| Tax rate fields (6) | u16 | consume_randomness | Tax Program | Current epoch tax rates |
| Carnage fields (6) | various | consume_randomness | execute_carnage* | Carnage state machine |

### State Transitions

```
IDLE (vrf_pending=false, taxes_confirmed=true)
  → trigger_epoch_transition
    → PENDING (vrf_pending=true, taxes_confirmed=false, pending_randomness_account=X)
      → consume_randomness
        → CONFIRMED (vrf_pending=false, taxes_confirmed=true, carnage_pending=maybe)
          → [if carnage_pending] execute_carnage_atomic / execute_carnage
            → IDLE (carnage_pending=false)
  → [if timeout] retry_epoch_vrf
    → PENDING (pending_randomness_account=Y, vrf_request_slot=updated)
```

## Dependencies

| Dependency | Version | Purpose | Risk |
|------------|---------|---------|------|
| `switchboard-on-demand` | =0.11.3 (pinned) | VRF randomness parsing | Pinned version — no automatic updates |
| `anchor-lang` | 0.32.1 | Framework | Standard |
| `anchor-spl` | 0.32.1 | Token operations | Standard |
| `spl-token-2022` | 8.0.1 | Token-2022 CPI | Standard |

Note: `switchboard-on-demand` is version-pinned with `=0.11.3`. This is prudent for reproducibility but means the protocol won't automatically receive Switchboard SDK security patches. The Switchboard SDK is used ONLY for `RandomnessAccountData::parse()` and `get_value()` — it does not create accounts or manage oracle infrastructure on-chain.

## Focus-Specific Analysis

### Oracle Dependency Map

| Data Point | Oracle Source | Feed Address/ID | Staleness Check? | Confidence Check? | Fallback? |
|------------|-------------|-----------------|-------------------|--------------------|-----------|
| Epoch randomness | Switchboard On-Demand VRF | Dynamic (per-request randomness accounts) | YES: seed_slot within 1 slot (trigger/retry) | N/A (randomness, not price) | YES: retry_epoch_vrf after 300 slots |
| Tax rates | Derived from VRF bytes | N/A (computed on-chain) | Implicit: derived from fresh VRF | N/A | N/A |
| Carnage trigger | Derived from VRF bytes | N/A (computed on-chain) | Implicit: derived from fresh VRF | N/A | N/A |
| Pool reserves (slippage) | Protocol's own AMM | Hardcoded pool addresses in Anchor structs | NO explicit staleness | N/A | NO |

### Price Manipulation Analysis

This protocol does NOT use external price oracles for financial decisions. The only "price" used is AMM pool reserves for slippage floor enforcement during Carnage swaps.

**Pool reserve manipulation cost (theoretical):**
- The AMM pools are the protocol's own pools (CRIME/SOL, FRAUD/SOL)
- To manipulate reserves by 10%: swap enough to move pool price by 10%. With constant product, for a pool with X SOL: need to add ~10.5% of X SOL (approximately).
- To manipulate by 50%: need to add ~100% of pool SOL reserves
- Carnage reads reserves BEFORE executing the swap. If an attacker front-runs the Carnage swap and manipulates reserves, the slippage floor would be computed against manipulated reserves, potentially allowing the Carnage swap to proceed at a worse rate than the floor intended.

**However:** The atomic Carnage path is bundled in the same transaction as VRF reveal. The VRF result is unknown until reveal, so an attacker cannot pre-compute whether Carnage will trigger or which direction it will trade. The 50-slot lock window gives priority to the atomic path. The fallback path (slots 50-300) is more vulnerable to MEV but uses a more lenient 75% slippage floor.

### Staleness Window Assessment

- **VRF freshness**: Maximum 1 slot old (line 181: `slot_diff <= 1`). At ~400ms/slot, maximum staleness is ~800ms. This is extremely tight and appropriate for randomness commitments.
- **What happens if Switchboard goes offline**: The protocol enters `vrf_pending = true` state and stays there. After 300 slots (~2 min), `retry_epoch_vrf` becomes available. Each retry creates a new randomness account (still requires Switchboard). If Switchboard is completely down, retries fail and the protocol freezes: tax rates stay at last-set values, no new epochs advance, no Carnage events trigger. Tax swaps continue functioning with stale rates.
- **Maximum protocol halt duration**: Unbounded — depends on Switchboard availability. No emergency admin override exists for mainnet (force_carnage is devnet-only, gated by `#[cfg(feature = "devnet")]`).

### Multi-Source Analysis

- **Single oracle**: Switchboard On-Demand is the sole randomness source
- **No secondary oracle**: No Pyth, Chainlink, or other fallback
- **On-chain randomness alternative**: None. Solana does not provide native randomness.
- **Failure mode**: Protocol halts (epoch advancement stops). Tax swaps continue with stale rates. No Carnage events.
- **Mitigation**: The protocol's use of oracle is LIMITED to randomness (not pricing). Stale tax rates are suboptimal but not dangerous — they are bounded between 1-14% BPS regardless of staleness.

## Cross-Focus Intersections

### ORACLE × TIMING
- VRF freshness checks use slot arithmetic with `saturating_sub` — Timing agent should verify the underflow implications
- Epoch boundary detection uses slot-based arithmetic — no timing manipulation possible (Clock sysvar is validator-set)
- Carnage deadline (300 slots) and lock window (50 slots) are timing-critical for oracle-derived actions

### ORACLE × CPI
- `consume_randomness` makes CPI to Staking Program (update_cumulative) — CPI agent should verify this CPI is safe with potentially stale oracle data
- Carnage execution makes CPI to Tax Program (swap_exempt) — CPI depth is at Solana's 4-level limit

### ORACLE × ARITHMETIC
- Tax rate derivation uses `% 4` on VRF bytes — no modulo bias (256 % 4 == 0)
- Slippage floor uses checked arithmetic in u128 — Arithmetic agent should verify overflow bounds

### ORACLE × ACCESS CONTROL
- Optional `carnage_state` creates access control gap where permissionless callers can suppress Carnage

### ORACLE × STATE
- `taxes_confirmed = false` between trigger and consume — Tax Program should handle this state (it reads rates regardless of confirmed status)
- Carnage state machine transitions depend on oracle-derived data

## Cross-Reference Handoffs

- → **Access Control Agent**: Verify constraints on pool accounts in `ExecuteCarnageAtomic` and `ExecuteCarnage` Anchor structs — specifically whether `crime_pool` and `fraud_pool` have owner or address constraints that mitigate the missing owner check in `read_pool_reserves`
- → **Timing Agent**: Verify the `saturating_sub` underflow at `trigger_epoch_transition.rs:174` and `retry_epoch_vrf.rs:83` — is a future-dated `seed_slot` exploitable in practice given Switchboard's architecture?
- → **CPI Agent**: The `consume_randomness` CPI to Staking (`update_cumulative`) sends the epoch number derived from VRF-driven state. Verify this CPI cannot be exploited by calling `consume_randomness` at unexpected times.
- → **Token/Economic Agent**: Verify the economic implications of permanent Carnage suppression (optional `carnage_state`) on token supply and protocol health
- → **Arithmetic Agent**: Verify the slippage floor calculation at `carnage_execution.rs:332-344` handles edge cases (zero reserves, very large swap amounts, reserve overflow)

## Risk Observations

### MEDIUM (Downgraded from HIGH): Pool Owner Check Missing in Function, Present in Struct

**File:** `programs/epoch-program/src/helpers/carnage_execution.rs` lines 825-851

**Observation:** The Epoch Program's `read_pool_reserves` function reads pool reserves from raw bytes but does NOT validate that the pool account is owned by the AMM program. The Tax Program's equivalent function at `pool_reader.rs:61-64` includes this check:

```rust
require!(*pool_info.owner == amm_program_id(), TaxError::InvalidPoolOwner);
```

**Mitigation CONFIRMED:** Both `ExecuteCarnageAtomic` (execute_carnage_atomic.rs:118, 133) and `ExecuteCarnage` enforce `owner = amm_program_id()` on `crime_pool` and `fraud_pool` via Anchor struct constraints:

```rust
#[account(mut, owner = amm_program_id() @ EpochError::InvalidAmmProgram)]
pub crime_pool: AccountInfo<'info>,
```

**Residual Risk:** Defense-in-depth gap only. The function itself is not self-protecting. If `read_pool_reserves` is ever called with a pool account that didn't go through these Anchor constraints (e.g., reuse in a new instruction), the owner check would be missing. Recommend adding the check to the function for defense-in-depth parity with the Tax Program version.

### HIGH: VRF Freshness Underflow via `saturating_sub`

**File:** `trigger_epoch_transition.rs:174`, `retry_epoch_vrf.rs:83`

**Observation:** `clock.slot.saturating_sub(randomness_data.seed_slot)` returns 0 if `seed_slot > clock.slot`. The freshness check `slot_diff <= 1` passes for `slot_diff = 0`. This means a randomness account with a future-dated `seed_slot` would pass the freshness check.

**Analysis:** This requires Switchboard to create a randomness account with `seed_slot` set to a future slot. In normal Switchboard operation, `seed_slot` is set to the current slot when the randomness is created. However, if there's a Switchboard SDK bug, oracle misbehavior, or if an attacker can somehow influence `seed_slot`, this could allow use of pre-computed randomness.

**Practical Exploitability:** Low. The randomness account must also be owned by SWITCHBOARD_PROGRAM_ID (validated at line 58), which means only the real Switchboard program can create it. An attacker cannot forge the account. The risk is limited to Switchboard oracle/SDK bugs producing future-dated seed_slots.

**Fix:** Add explicit check: `require!(randomness_data.seed_slot <= clock.slot, EpochError::RandomnessExpired)`

### MEDIUM: Carnage Suppression via Optional `carnage_state`

**File:** `consume_randomness.rs:76-80`

**Observation:** `carnage_state: Option<Account<'info, CarnageFundState>>` — if not provided, the Carnage trigger check at lines 282-328 is entirely skipped. Since `consume_randomness` is permissionless, a MEV bot could front-run legitimate callers and consume VRF without passing `carnage_state`, permanently suppressing Carnage.

**Impact:** Carnage is a core protocol mechanic (buying/burning tokens from the Carnage Fund). Permanent suppression removes ~4.3% of epoch events from the protocol's economic design.

**Practical Exploitability:** High. Front-running `consume_randomness` is trivial — the VRF reveal transaction is bundled with `consume_randomness`, so a bot could submit the same `revealIx + consume_randomness(without carnage_state)` transaction with higher priority fee.

**Mitigation:** The comment says "backward compatibility and gradual rollout" — this may have been intended as temporary. Making `carnage_state` required would eliminate this vector.

### MEDIUM: Single Oracle Dependency (No Fallback)

**Observation:** If Switchboard On-Demand is unavailable (outage, deprecation, or vulnerability), the protocol cannot advance epochs. Tax rates freeze, Carnage stops, and staking yield stops accumulating. There is no admin override on mainnet.

**Impact:** Protocol functionality degrades but user funds are not at risk. Users can still trade tokens, but tax rates become static and no new epochs begin.

**Practical Likelihood:** Low-medium. Switchboard has been operational on Solana for years, but has experienced outages. The Solana network itself has had multi-hour outages (documented in solana-runtime-quirks.md).

### MEDIUM: Pool Reserve Reading Uses Hardcoded Byte Offsets

**File:** `carnage_execution.rs:829-841`, `pool_reader.rs:66-88`

**Observation:** Both versions read AMM PoolState fields from hardcoded byte offsets (discriminator at 0-8, mint_a at 9-41, reserves at 137-153). If the AMM program is upgraded and the PoolState layout changes, these readers would silently read wrong data.

**Practical Risk:** Low. The AMM program is part of this same protocol and upgrades are controlled. The byte offsets are documented and tested. But if the AMM program is upgraded independently of the Epoch/Tax programs, this could break silently.

### MEDIUM: `taxes_confirmed` Flag Not Checked in Tax Program Swaps

**Observation:** When `taxes_confirmed = false` (between trigger and consume), the Tax Program still reads and applies the old tax rates from EpochState. This is technically correct (stale rates are valid rates), but it means users can trade during the VRF pending period using the previous epoch's rates. If the new rates will be significantly different, this creates a brief arbitrage window.

**Practical Risk:** Very low. The VRF pending period is ~3 slots (~1.2 seconds). The maximum tax rate change between epochs is bounded (from 1% to 14% at most). The arbitrage opportunity is tiny and short-lived.

### LOW: Switchboard SDK Version Pinning

**File:** `Cargo.toml:14`

**Observation:** `switchboard-on-demand = "=0.11.3"` is version-pinned. This prevents automatic security updates.

**Practical Risk:** Very low. The SDK is only used for data parsing (`parse()` and `get_value()`), not for any security-critical CPI. A parsing vulnerability would need to be in the SDK's deserialization code.

### LOW: No Modulo Bias (Confirmed)

**Observation:** VRF byte interpretation uses `% 4` (256/4 = 64, no bias) and threshold comparisons. No modulo bias exists. The `< 128` split for target selection is perfectly balanced. The `< 11` trigger threshold gives exactly 11/256 = 4.296875% probability. All documented probabilities are mathematically correct.

## Novel Attack Surface Observations

### Carnage Suppression via Front-Running

The combination of (1) permissionless `consume_randomness`, (2) optional `carnage_state` account, and (3) Carnage being a critical economic mechanism creates a unique attack surface. A bot could permanently suppress Carnage by front-running every epoch's VRF consumption without `carnage_state`. This is not a generic oracle attack — it's specific to this protocol's design choice of making a critical state-transition gate on an optional account in a permissionless instruction.

The economic impact: Carnage buys/burns tokens from the Carnage Fund (~24% of all tax revenue). Suppressing Carnage means the Carnage Fund accumulates SOL indefinitely without ever buying or burning tokens. This changes the protocol's token supply dynamics fundamentally.

### Self-Referential Slippage Oracle

The protocol reads its own AMM pool reserves to enforce slippage on its own AMM pool swaps. This is inherently circular: the slippage check validates the swap output against the pool's own state, which is modified by the swap. The protocol handles this correctly by reading reserves BEFORE the swap CPI (line 285-288), but a multi-instruction transaction could manipulate the pool reserves in a prior instruction, then execute Carnage in a later instruction within the same transaction (for the fallback path). The atomic path mitigates this by bundling with VRF reveal (unpredictable timing/direction), but the fallback path (slots 50-300 after trigger) is vulnerable to this pattern.

### VRF Predictability Window

After `trigger_epoch_transition` commits a randomness account, there is a window of ~3 slots before `consume_randomness` reveals the result. During this window, the Switchboard oracle knows the randomness value (it generated it). A colluding oracle operator could theoretically predict Carnage trigger/action/target and position accordingly. The anti-reroll binding prevents changing which randomness account is used, but does not prevent the oracle from leaking the value. This is a fundamental trust assumption of all VRF systems and is mitigated by Switchboard's multi-oracle architecture.

## Questions for Other Focus Areas

- **For Access Control focus:** Are the `crime_pool` and `fraud_pool` accounts in `ExecuteCarnageAtomic`/`ExecuteCarnage` Anchor structs constrained by owner or address? This determines whether the missing owner check in Epoch Program's `read_pool_reserves` is exploitable.
- **For CPI focus:** When `consume_randomness` makes CPI to Staking's `update_cumulative`, does the Staking program verify that the caller is the Epoch Program? If not, anyone could call `update_cumulative` directly.
- **For Timing focus:** Is it possible for `clock.slot` to ever be less than a recently-created account's `seed_slot`? This would make the `saturating_sub` underflow a practical concern rather than theoretical.
- **For State Machine focus:** What happens to the protocol if `consume_randomness` is called with `carnage_state = None` for 1000 consecutive epochs? Does the Carnage Fund's SOL balance grow unbounded? Are there any downstream effects?
- **For Arithmetic focus:** In the slippage floor calculation at `carnage_execution.rs:332-337`, if `reserve_sol + total_buy_amount` overflows u128, the checked_add returns None. But both are u64 values, so their sum fits in u128 (max u64 + max u64 < u128::MAX). Is this verified?

## Raw Notes

### Switchboard On-Demand Version Analysis

The project uses `switchboard-on-demand = "=0.11.3"`. Key APIs used:
- `RandomnessAccountData::parse(data)` — parses borrowed account data into structured randomness data
- `randomness_data.seed_slot` — u64 field indicating when randomness was created
- `randomness_data.get_value(clock.slot)` — returns `[u8; 32]` if revealed, error if not
- `switchboard_on_demand::ON_DEMAND_DEVNET_PID` / `ON_DEMAND_MAINNET_PID` — program IDs

### VRF Byte Allocation

```
Byte 0: Flip decision      [< 192 = flip, >= 192 = keep]  (75% flip)
Byte 1: CRIME low tax mag  [% 4 → {100, 200, 300, 400}]
Byte 2: CRIME high tax mag [% 4 → {1100, 1200, 1300, 1400}]
Byte 3: FRAUD low tax mag  [% 4 → {100, 200, 300, 400}]
Byte 4: FRAUD high tax mag [% 4 → {1100, 1200, 1300, 1400}]
Byte 5: Carnage trigger    [< 11 = trigger]               (4.3%)
Byte 6: Carnage action     [< 5 = Sell, >= 5 = Burn]      (2%/98%)
Byte 7: Carnage target     [< 128 = CRIME, >= 128 = FRAUD] (50%/50%)
Bytes 8-31: Unused (24 bytes of entropy available for future features)
```

### Pool Accounts Constraints Check (CONFIRMED)

Verified in `execute_carnage_atomic.rs` (lines 118, 133) and `execute_carnage.rs`:
- `crime_pool: AccountInfo<'info>` — `#[account(mut, owner = amm_program_id() @ EpochError::InvalidAmmProgram)]` -- OWNER CHECKED
- `fraud_pool: AccountInfo<'info>` — `#[account(mut, owner = amm_program_id() @ EpochError::InvalidAmmProgram)]` -- OWNER CHECKED

The Anchor struct-level owner constraint mitigates the missing function-level check in `read_pool_reserves`. The pool accounts cannot be spoofed because only accounts owned by the AMM program pass validation. This is a defense-in-depth gap (function should include the check for self-protection), not an exploitable vulnerability.
