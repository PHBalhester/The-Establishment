# Epoch Program Specification

> Code-first documentation generated from program source.
> Last updated: 2026-03-08 (Phase 88-02)

## 1. Overview

The Epoch Program is the coordination hub for all protocol dynamics. It manages epoch-based time divisions, derives tax rates from Switchboard VRF randomness, and orchestrates Carnage Fund execution. Every swap's tax rate is ultimately determined by this program's state.

**Program ID:** `G6dmJ...` (Epoch Program)
**Singleton PDA:** `seeds = ["epoch_state"]`

## 2. Epoch Lifecycle

```
                   +-------------------+
                   |  Current Epoch    |
                   | (taxes active)    |
                   +--------+----------+
                            |
                   Epoch boundary reached
                   (current_slot >= genesis + (epoch+1) * SLOTS_PER_EPOCH)
                            |
                   +--------v----------+
            TX 1:  | Create randomness  |  (Switchboard SDK, separate TX)
                   +--------+----------+
                            |
                   +--------v----------+
            TX 2:  | commitIx +         |  (bundled in same TX)
                   | trigger_epoch_     |
                   | transition         |
                   +--------+----------+
                            |
                   ~3 slots (oracle reveals)
                            |
                   +--------v----------+
            TX 3:  | revealIx +         |  (bundled in same TX)
                   | consume_randomness |
                   | + execute_carnage_ |
                   |   atomic (optional)|
                   +--------+----------+
                            |
                   +--------v----------+
                   |  New Epoch         |
                   | (new taxes active) |
                   +-------------------+
```

## 3. Instructions

### 3.1 initialize_epoch_state

One-time protocol initialization. Creates the EpochState singleton PDA.

### 3.2 initialize_carnage_fund

One-time Carnage Fund initialization. Creates CarnageFundState PDA, SOL vault, and token vaults.

### 3.3 trigger_epoch_transition

Initiates an epoch transition by validating the epoch boundary and binding a Switchboard randomness account.

**Permissionless:** Anyone can call after the epoch boundary is reached.

**Flow:**
1. Validate epoch boundary reached (`expected_epoch > current_epoch`)
2. Validate no VRF already pending
3. Validate randomness account freshness (seed_slot within 1 slot of current)
4. Validate randomness not yet revealed
5. Advance epoch number to expected epoch
6. Set VRF pending state (`vrf_pending = true`, `taxes_confirmed = false`)
7. Bind randomness account (anti-reroll protection)
8. Pay trigger bounty from Carnage SOL vault (0.001 SOL)

**Bounty system:**
- Amount: `TRIGGER_BOUNTY_LAMPORTS = 1,000,000` (0.001 SOL)
- Source: Carnage SOL vault
- Guard: Only pays if vault balance >= bounty + rent-exempt minimum
- Skip: If insufficient balance, bounty is skipped silently (transition still advances)

**Event:** `EpochTransitionTriggered { epoch, triggered_by, slot, bounty_paid }`

### 3.4 consume_randomness

Reads revealed VRF bytes, derives new tax rates, and optionally triggers Carnage.

**Permissionless:** Anyone can call after oracle reveals randomness.

**Flow:**
0. Auto-expire stale pending Carnage (if deadline passed)
1. Validate VRF is pending
2. Anti-reroll: verify SAME randomness account that was committed (ConstraintAddress)
3. Read revealed randomness bytes (fails if oracle hasn't revealed)
4. Validate sufficient bytes (MIN_VRF_BYTES = 8)
5. Derive tax rates from VRF bytes
6. Update EpochState with new tax configuration
7. Clear VRF pending state (`vrf_pending = false`, `taxes_confirmed = true`)
7.5. CPI to Staking: `update_cumulative` to finalize epoch rewards
8. Emit `TaxesUpdated` event
9. Carnage trigger check (if `carnage_state` provided)

### 3.5 retry_epoch_vrf

Allows re-committing a fresh randomness account after VRF timeout. Prevents protocol deadlock if oracle fails to reveal.

**Permissionless:** Anyone can call.

**Flow:**
1. Validate VRF is pending
2. Validate timeout elapsed (`elapsed_slots > VRF_TIMEOUT_SLOTS`)
3. Validate new randomness account freshness
4. Validate new randomness not yet revealed
5. Overwrite pending state with new randomness account
6. Emit `VrfRetryRequested` event

**Timeout:** `VRF_TIMEOUT_SLOTS = 300` (~2 minutes)

### 3.6 execute_carnage_atomic

See [Carnage Spec](carnage-spec.md) Section 4.1.

### 3.7 execute_carnage (Fallback)

See [Carnage Spec](carnage-spec.md) Section 4.2.

### 3.8 expire_carnage

See [Carnage Spec](carnage-spec.md) Section 4.3.

### 3.9 force_carnage (Devnet Only)

Admin-gated test helper that sets `carnage_pending` on EpochState without waiting for a natural VRF trigger. Allows rapid testing of all Carnage execution paths.

**Security:**
- Gated by `#[cfg(feature = "devnet")]` at module and instruction level
- Without the `devnet` feature, this instruction does not exist in the compiled binary
- Additional admin check: `authority.key() == DEVNET_ADMIN` (hardcoded deployer wallet)

**Parameters:**
- `target`: 0 = CRIME, 1 = FRAUD
- `action`: 0 = None (BuyOnly), 1 = Burn, 2 = Sell

**State changes:** Sets `carnage_pending`, `carnage_action`, `carnage_target`, `carnage_deadline_slot`, `carnage_lock_slot` -- identical to what `consume_randomness` does when Carnage triggers.

## 4. VRF Integration

### 4.1 Switchboard On-Demand

The program uses Switchboard On-Demand for verifiable randomness. The Switchboard program ID is feature-gated:

```rust
#[cfg(feature = "devnet")]
pub const SWITCHBOARD_PROGRAM_ID: Pubkey = switchboard_on_demand::ON_DEMAND_DEVNET_PID;

#[cfg(not(feature = "devnet"))]
pub const SWITCHBOARD_PROGRAM_ID: Pubkey = switchboard_on_demand::ON_DEMAND_MAINNET_PID;
```

### 4.2 VRF Byte Usage

32 bytes of randomness are received; 8 are used:

| Byte | Purpose | Logic |
|------|---------|-------|
| 0 | Cheap side flip | Determines which faction gets low tax |
| 1 | CRIME low rate magnitude | Tax rate derivation |
| 2 | CRIME high rate magnitude | Tax rate derivation |
| 3 | FRAUD low rate magnitude | Tax rate derivation |
| 4 | FRAUD high rate magnitude | Tax rate derivation |
| 5 | Carnage trigger | < 11 triggers Carnage (~4.3%) |
| 6 | Carnage action | < 5 = Sell (~2%), >= 5 = Burn (~98%) |
| 7 | Carnage target | < 128 = CRIME (50%), >= 128 = FRAUD (50%) |

### 4.3 Anti-Reroll Protection

`trigger_epoch_transition` binds the randomness account pubkey in `pending_randomness_account`. `consume_randomness` enforces:

```rust
require!(
    randomness_account.key() == epoch_state.pending_randomness_account,
    EpochError::RandomnessAccountMismatch
);
```

This prevents attackers from creating multiple randomness accounts and only revealing the one with favorable results.

### 4.4 VRF Timeout Recovery

If an oracle fails to reveal within `VRF_TIMEOUT_SLOTS` (300 slots, ~2 minutes):

1. Wait for timeout to elapse
2. Create fresh randomness account (may get a different, working oracle)
3. Call `retry_epoch_vrf` (bundled with new commitIx)
4. Then `consume_randomness` with revealIx

The fresh randomness account may be assigned to a different oracle, working around gateway failures.

**Note:** VRF gateway rotation does NOT work -- each randomness account is assigned to a specific oracle. Alternative gateways serve different oracles whose signatures fail on-chain (error 0x1780). Only retry the default gateway.

## 5. Tax Derivation

### 5.1 Per-Token Rates

The `derive_taxes()` helper produces 4 independent tax rates from VRF bytes:
- `crime_buy_tax_bps`
- `crime_sell_tax_bps`
- `fraud_buy_tax_bps`
- `fraud_sell_tax_bps`

### 5.2 Legacy Summary Fields

`low_tax_bps` and `high_tax_bps` are populated as the explicit min/max of the 4 per-token rates:

```rust
epoch_state.low_tax_bps = crime_buy.min(crime_sell).min(fraud_buy).min(fraud_sell);
epoch_state.high_tax_bps = crime_buy.max(crime_sell).max(fraud_buy).max(fraud_sell);
```

These fields are kept for event emission and external consumers (UI).

### 5.3 Tax Rate Ranges

- Low rates: 100-400 bps (1-4%)
- High rates: 1100-1400 bps (11-14%)
- Genesis defaults: `GENESIS_LOW_TAX_BPS = 300` (3%), `GENESIS_HIGH_TAX_BPS = 1400` (14%)

## 6. Epoch Skip Behavior

Epoch skipping is documented as **by-design behavior**. If the crank is delayed, the expected epoch may be > current_epoch + 1 (e.g., jumping from epoch 100 to 105).

### 6.1 Four Safety Properties

1. **Tax persistence:** Tax rates persist at last-set values during gaps (safe fallback)
2. **No double-count:** No rewards accrue during gaps (staking tracks per-epoch)
3. **No implicit Carnage:** Carnage only triggers from VRF (no implicit triggers from skips)
4. **Direct epoch number:** New epoch is set directly to expected_epoch, not incremented

## 7. EpochState Account Layout

**Total size:** 172 bytes (8 discriminator + 164 data)
**PDA:** `seeds = ["epoch_state"]`
**Attributes:** `#[repr(C)]` for cross-program layout stability

### 7.1 Field Layout

| Offset (data) | Field | Type | Bytes | Description |
|----------------|-------|------|-------|-------------|
| 0 | genesis_slot | u64 | 8 | Protocol genesis slot |
| 8 | current_epoch | u32 | 4 | Current epoch number (0-indexed) |
| 12 | epoch_start_slot | u64 | 8 | Start slot of current epoch |
| 20 | cheap_side | u8 | 1 | 0=CRIME, 1=FRAUD |
| 21 | low_tax_bps | u16 | 2 | Min of 4 per-token rates |
| 23 | high_tax_bps | u16 | 2 | Max of 4 per-token rates |
| 25 | crime_buy_tax_bps | u16 | 2 | CRIME buy tax rate |
| 27 | crime_sell_tax_bps | u16 | 2 | CRIME sell tax rate |
| 29 | fraud_buy_tax_bps | u16 | 2 | FRAUD buy tax rate |
| 31 | fraud_sell_tax_bps | u16 | 2 | FRAUD sell tax rate |
| 33 | vrf_request_slot | u64 | 8 | Slot when VRF committed |
| 41 | vrf_pending | bool | 1 | VRF request pending |
| 42 | taxes_confirmed | bool | 1 | Taxes confirmed for epoch |
| 43 | pending_randomness_account | Pubkey | 32 | Bound randomness (anti-reroll) |
| 75 | carnage_pending | bool | 1 | Carnage execution pending |
| 76 | carnage_target | u8 | 1 | 0=CRIME, 1=FRAUD |
| 77 | carnage_action | u8 | 1 | 0=None, 1=Burn, 2=Sell |
| 78 | carnage_deadline_slot | u64 | 8 | Fallback execution deadline |
| 86 | carnage_lock_slot | u64 | 8 | Atomic-only window end |
| 94 | last_carnage_epoch | u32 | 4 | Last Carnage trigger epoch |
| 98 | reserved | [u8; 64] | 64 | Future schema evolution padding |
| 162 | initialized | bool | 1 | Initialization flag |
| 163 | bump | u8 | 1 | PDA bump seed |

### 7.2 Reserved Padding (DEF-03)

64 bytes of reserved padding at data offset 98 (on-chain offset 106). New fields are added by consuming reserved bytes, avoiding account migration on schema changes.

### 7.3 Compile-Time Assertions (DEF-08)

```rust
const _: () = assert!(EpochState::DATA_LEN == 164);
```

This assertion exists in both the epoch-program and the tax-program mirror struct, catching layout drift at compile time.

## 8. Timing Parameters

| Constant | Devnet | Mainnet | Description |
|----------|--------|---------|-------------|
| SLOTS_PER_EPOCH | 750 | 4,500 | Slots per epoch |
| VRF_TIMEOUT_SLOTS | 300 | 300 | VRF retry timeout |
| CARNAGE_DEADLINE_SLOTS | 300 | 300 | Carnage execution window |
| CARNAGE_LOCK_SLOTS | 50 | 50 | Atomic-only window |
| TRIGGER_BOUNTY_LAMPORTS | 1,000,000 | 1,000,000 | Bounty (0.001 SOL) |
| MS_PER_SLOT_ESTIMATE | 420 | 420 | UI slot duration estimate |

Approximate durations at 400ms/slot:
- Epoch: ~5 minutes (devnet), ~30 minutes (mainnet)
- VRF timeout: ~2 minutes
- Carnage window: ~2 minutes
- Lock window: ~20 seconds

## 9. Error Codes

Epoch Program errors start at Anchor offset 6000:

| Code | Name | Description |
|------|------|-------------|
| 6000 | AlreadyInitialized | EpochState already initialized |
| 6001 | NotInitialized | EpochState not initialized |
| 6002 | InvalidEpochState | Corrupted state data |
| 6003 | EpochBoundaryNotReached | Epoch boundary not yet reached |
| 6004 | VrfAlreadyPending | VRF request already pending |
| 6005 | NoVrfPending | No VRF request pending |
| 6006 | RandomnessParseError | Cannot parse randomness data |
| 6007 | RandomnessExpired | Randomness seed_slot too old |
| 6008 | RandomnessAlreadyRevealed | Randomness already revealed |
| 6009 | RandomnessAccountMismatch | Anti-reroll violation |
| 6010 | RandomnessNotRevealed | Oracle hasn't revealed yet |
| 6011 | InsufficientRandomness | Need >= 8 bytes |
| 6012 | VrfTimeoutNotElapsed | Wait 300 slots for retry |
| 6013 | NoCarnagePending | No Carnage pending |
| 6014 | CarnageDeadlineExpired | Deadline passed |
| 6015 | CarnageDeadlineNotExpired | Deadline not passed (expire) |
| 6016 | CarnageLockActive | Atomic-only period |
| 6017 | InvalidCarnageTargetPool | Invalid target |
| 6018 | CarnageNotInitialized | Fund not initialized |
| 6019 | CarnageAlreadyInitialized | Fund already initialized |
| 6020 | InsufficientCarnageSol | Vault SOL insufficient |
| 6021 | CarnageSwapFailed | Swap failed |
| 6022 | CarnageBurnFailed | Burn failed |
| 6023 | Overflow | Arithmetic overflow |
| 6024 | InsufficientTreasuryBalance | Treasury insufficient for bounty |
| 6025 | InvalidRandomnessOwner | Not Switchboard-owned |
| 6027 | InvalidCarnageWsolOwner | WSOL not owned by carnage_signer |
| 6028 | InvalidStakingProgram | Staking program mismatch |
| 6029 | InvalidMint | Mint doesn't match vault |
| 6031 | CarnageSlippageExceeded | Below minimum output floor |
| 6032 | InvalidTaxProgram | Tax program mismatch |
| 6033 | InvalidAmmProgram | AMM program mismatch |
| 6034 | InvalidCheapSide | Invalid cheap_side value |

## 10. CPI Dependencies

### 10.1 Outbound CPIs (Epoch Program calls)

| Target | Instruction | Purpose |
|--------|-------------|---------|
| Tax Program | `swap_exempt` | Carnage swaps (via carnage_execution.rs) |
| Staking Program | `update_cumulative` | Finalize epoch rewards |
| System Program | `transfer` | Bounty payment, SOL wrapping |
| SPL Token | Various (raw) | WSOL sync, Token-2022 burn/approve |

### 10.2 Inbound Dependencies (other programs read EpochState)

| Consumer | What it reads | How |
|----------|---------------|-----|
| Tax Program | Tax rates, initialized flag | Cross-program deserialization via mirror struct |
| Frontend | All fields | Direct account fetch |

## 11. Events

| Event | Fields | Emitted By |
|-------|--------|------------|
| EpochTransitionTriggered | epoch, triggered_by, slot, bounty_paid | trigger_epoch_transition |
| TaxesUpdated | epoch, cheap_side, low_tax_bps, high_tax_bps, flipped | consume_randomness |
| VrfRetryRequested | epoch, original_request_slot, retry_slot, requested_by | retry_epoch_vrf |
| CarnagePending | epoch, target, action, deadline_slot | consume_randomness |
| CarnageNotTriggered | epoch, vrf_byte | consume_randomness |
| CarnageExecuted | epoch, action, target, sol_spent, tokens_bought, tokens_burned, sol_from_sale, atomic | execute_carnage_core |
| CarnageExpired | epoch, target, action, deadline_slot, sol_retained | expire_carnage, consume_randomness |
| CarnageFailed | epoch, action, target, attempted_amount, vault_balance, slot, atomic | expire_carnage, consume_randomness |

## 12. PDA Reference

| PDA | Seeds | Program | Purpose |
|-----|-------|---------|---------|
| EpochState | `["epoch_state"]` | Epoch | Global state singleton |
| CarnageFundState | `["carnage_fund"]` | Epoch | Carnage state |
| Carnage signer | `["carnage_signer"]` | Epoch | Signs Tax CPI |
| SOL vault | `["carnage_sol_vault"]` | Epoch | Holds native SOL |
| CRIME vault | `["carnage_crime_vault"]` | Epoch | Token-2022 account |
| FRAUD vault | `["carnage_fraud_vault"]` | Epoch | Token-2022 account |
| Staking authority | `["staking_authority"]` | Epoch | Signs Staking CPI |
