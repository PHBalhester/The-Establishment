# Dr. Fraudsworth's Finance Factory
## Epoch State Machine Specification

---

## 1. Purpose

This document defines the **Epoch State Machine** that governs tax regime transitions, VRF integration, and Carnage Fund execution.

The epoch system:
- Advances time in discrete 30-minute rounds
- Determines tax regimes via verifiable randomness
- Triggers and executes Carnage Fund operations
- Provides predictable timing for arbitrageurs

This is a **coordination-critical system**. All protocol economics depend on correct epoch transitions.

---

## 2. Design Constraints (Hard)

- Slot-based timing (not wall-clock)
- Single global epoch state (not per-pool)
- Permissionless epoch triggering
- Atomic Carnage execution (no MEV window)
- No admin intervention post-deployment
- Deterministic state transitions

---

## 3. Timing Model

### 3.1 Constants

```rust
pub const SLOTS_PER_EPOCH: u64 = 4_500;      // ~30 minutes at 400ms/slot
pub const MS_PER_SLOT_ESTIMATE: u64 = 420;   // Conservative estimate for UI
pub const VRF_TIMEOUT_SLOTS: u64 = 300;      // ~2 minutes max VRF wait
pub const CARNAGE_DEADLINE_SLOTS: u64 = 100; // ~40 seconds fallback window
pub const TRIGGER_BOUNTY_LAMPORTS: u64 = 10_000_000; // 0.01 SOL
```

### 3.2 Epoch Calculation

```rust
fn current_epoch(slot: u64, genesis_slot: u64) -> u32 {
    ((slot - genesis_slot) / SLOTS_PER_EPOCH) as u32
}

fn epoch_start_slot(epoch: u32, genesis_slot: u64) -> u64 {
    genesis_slot + (epoch as u64 * SLOTS_PER_EPOCH)
}

fn next_epoch_boundary(current_slot: u64, genesis_slot: u64) -> u64 {
    let current_epoch = current_epoch(current_slot, genesis_slot);
    epoch_start_slot(current_epoch + 1, genesis_slot)
}
```

### 3.3 Why Slot-Based

Slot-based timing provides:
- Deterministic epoch boundaries (no clock drift)
- Predictable arbitrage windows
- Unambiguous transition points

Wall-clock time (`unix_timestamp`) can drift up to 25% fast or 150% slow. For 30-minute epochs with time-sensitive arbitrage, this variance is unacceptable.

---

## 4. State Accounts

### 4.1 EpochState (Global Singleton)

```rust
#[account]
pub struct EpochState {
    // Timing
    pub genesis_slot: u64,              // Slot when protocol launched
    pub current_epoch: u32,             // Current epoch number
    pub epoch_start_slot: u64,          // When current epoch started
    
    // Tax Configuration (active)
    pub cheap_side: Token,              // CRIME or FRAUD
    pub low_tax_bps: u16,               // 100-400 (1-4%)
    pub high_tax_bps: u16,              // 1100-1400 (11-14%)
    
    // Derived Tax Rates (cached for efficiency)
    pub crime_buy_tax_bps: u16,
    pub crime_sell_tax_bps: u16,
    pub fraud_buy_tax_bps: u16,
    pub fraud_sell_tax_bps: u16,
    
    // VRF State (Switchboard On-Demand commit-reveal)
    pub vrf_request_slot: u64,          // Slot when randomness was committed (0 = none pending)
    pub vrf_pending: bool,              // Waiting for consume_randomness
    pub taxes_confirmed: bool,          // False until randomness consumed for this epoch
    pub pending_randomness_account: Pubkey, // Switchboard randomness account (anti-reroll binding)
    
    // Carnage State
    pub carnage_pending: bool,          // Atomic execution failed, fallback active
    pub carnage_target: Token,          // CRIME or FRAUD (only valid if pending)
    pub carnage_action: CarnageAction,  // Burn or Sell (only valid if pending)
    pub carnage_deadline_slot: u64,     // Fallback expiration
    pub last_carnage_epoch: u32,        // Last epoch Carnage triggered
    
    // Protocol
    pub initialized: bool,
    pub bump: u8,
}
```

**Size:** 1 + 8 + 4 + 8 + 1 + 2 + 2 + 2 + 2 + 2 + 2 + 8 + 1 + 1 + 32 + 1 + 1 + 1 + 8 + 4 + 1 + 1 = 93 bytes (+ 8 discriminator = 101 bytes)

### 4.2 Token Enum

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Token {
    CRIME,
    FRAUD,
}

impl Token {
    pub fn opposite(&self) -> Token {
        match self {
            Token::CRIME => Token::FRAUD,
            Token::FRAUD => Token::CRIME,
        }
    }
}
```

### 4.3 CarnageAction Enum

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum CarnageAction {
    None,   // No action pending
    Burn,   // 98% path: burn held tokens, then buy
    Sell,   // 2% path: sell held tokens, then buy
}
```

### 4.4 PDA Derivation

```
seeds = ["epoch_state"]
program = epoch_program
```

Single global account, no additional seeds needed.

---

## 5. Genesis State

At protocol initialization:

```rust
EpochState {
    genesis_slot: <deployment_slot>,
    current_epoch: 0,
    epoch_start_slot: <deployment_slot>,
    
    // CRIME cheap, FRAUD expensive
    cheap_side: Token::CRIME,
    low_tax_bps: 300,      // 3%
    high_tax_bps: 1400,    // 14%
    
    // Derived rates
    crime_buy_tax_bps: 300,   // CRIME cheap to buy
    crime_sell_tax_bps: 1400, // CRIME expensive to sell
    fraud_buy_tax_bps: 1400,  // FRAUD expensive to buy
    fraud_sell_tax_bps: 300,  // FRAUD cheap to sell
    
    // No VRF pending at genesis
    vrf_request_slot: 0,
    vrf_pending: false,
    taxes_confirmed: true,  // Genesis taxes are confirmed
    pending_randomness_account: Pubkey::default(), // No pending request
    
    // No Carnage pending
    carnage_pending: false,
    carnage_target: Token::CRIME,  // Ignored
    carnage_action: CarnageAction::None,
    carnage_deadline_slot: 0,
    last_carnage_epoch: 0,
    
    initialized: true,
    bump: <pda_bump>,
}
```

Genesis uses hardcoded tax magnitudes. First VRF-determined taxes apply at epoch 1.

---

## 6. State Transitions

### 6.1 State Diagram

```
                    ┌─────────────────────────────────────────┐
                    │                                         │
                    ▼                                         │
    ┌───────────────────────────┐                            │
    │        ACTIVE             │                            │
    │  (taxes_confirmed = true) │                            │
    │  (vrf_pending = false)    │                            │
    └───────────────────────────┘                            │
                    │                                         │
                    │ Epoch boundary reached                  │
                    │ trigger_epoch_transition()              │
                    │ (client bundles SDK commitIx)           │
                    ▼                                         │
    ┌───────────────────────────┐                            │
    │     VRF_COMMITTED         │                            │
    │  (vrf_pending = true)     │                            │
    │  (taxes_confirmed = false)│                            │
    │  (randomness committed)   │                            │
    └───────────────────────────┘                            │
                    │                                         │
        ┌───────────┴───────────┐                            │
        │                       │                            │
        ▼                       ▼                            │
   Oracle reveals          VRF timeout                       │
   (~3 slots)              (300 slots)                       │
        │                       │                            │
        │                       ▼                            │
        │           ┌───────────────────────┐                │
        │           │    VRF_RETRY          │                │
        │           │ (retry_epoch_vrf())   │                │
        │           └───────────────────────┘                │
        │                       │                            │
        │                       │ New randomness committed   │
        │                       └──────────┐                 │
        │                                  │                 │
        ▼                                  ▼                 │
    ┌───────────────────────────────────────┐                │
    │       CONSUME_RANDOMNESS              │                │
    │  (client bundles SDK revealIx)        │                │
    │  1. Read revealed randomness bytes    │                │
    │  2. Update taxes                      │                │
    │  3. Update staking cumulative         │                │
    │  4. Check Carnage trigger             │                │
    │  5. Execute Carnage (if triggered)    │                │
    └───────────────────────────────────────┘                │
                    │                                         │
        ┌───────────┴───────────┐                            │
        │                       │                            │
        ▼                       ▼                            │
   Carnage atomic          Carnage atomic                    │
   SUCCESS                 FAILURE                           │
        │                       │                            │
        │                       ▼                            │
        │           ┌───────────────────────┐                │
        │           │   CARNAGE_PENDING     │                │
        │           │ (carnage_pending=true)│                │
        │           └───────────────────────┘                │
        │                       │                            │
        │           ┌───────────┴───────────┐                │
        │           │                       │                │
        │           ▼                       ▼                │
        │      execute_carnage()      Deadline expires       │
        │      called                 (100 slots)            │
        │           │                       │                │
        │           │                       ▼                │
        │           │           ┌───────────────────────┐    │
        │           │           │   CARNAGE_EXPIRED     │    │
        │           │           │ SOL stays in fund     │    │
        │           │           └───────────────────────┘    │
        │           │                       │                │
        └───────────┴───────────────────────┴────────────────┘
                              │
                              ▼
                         ACTIVE
```

### 6.2 Transition Rules

**ACTIVE → VRF_COMMITTED:**
- Trigger: `current_slot >= next_epoch_boundary`
- Action: Increment epoch, validate and bind randomness account, set `vrf_pending = true`
- Client: Bundles Switchboard SDK `commitIx` with `trigger_epoch_transition` in same transaction
- Taxes: Old taxes remain active

**VRF_COMMITTED → ACTIVE (via consume):**
- Trigger: Oracle has revealed randomness (~3 slots after commit)
- Action: Client calls `consume_randomness` bundled with SDK `revealIx`. Program reads bytes, updates taxes, attempts Carnage, sets `vrf_pending = false`
- Taxes: New taxes now active

**VRF_COMMITTED → VRF_RETRY:**
- Trigger: `current_slot > vrf_request_slot + VRF_TIMEOUT_SLOTS`
- Action: Anyone can call `retry_epoch_vrf()` with a fresh randomness account
- Client: Bundles SDK `commitIx` with `retry_epoch_vrf` in same transaction
- Taxes: Old taxes still active

**CARNAGE_PENDING → ACTIVE (via execution):**
- Trigger: Anyone calls `execute_carnage()`
- Action: Execute market buy, clear pending flag
- Constraint: Must be within deadline

**CARNAGE_PENDING → ACTIVE (via expiration):**
- Trigger: `current_slot > carnage_deadline_slot`
- Action: Clear pending flag, SOL remains in Carnage Fund
- Effect: Carnage opportunity lost, accumulates for next trigger

### 6.3 Cross-System Interactions

#### Carnage Pending + Epoch Transition Overlap

**Edge case:** What happens if Carnage is pending (atomic execution failed) when the next epoch boundary arrives?

**Scenario:**
1. Epoch N ends, VRF callback triggers Carnage
2. Carnage atomic execution fails, `carnage_pending = true`
3. 100-slot deadline begins (~40 seconds)
4. Meanwhile, epoch N+1 boundary arrives (after ~4,500 slots / ~30 minutes)

**Note:** The 100-slot deadline (~40 seconds) is much shorter than epoch duration (~30 minutes), so the pending state will almost always resolve (executed or expired) before the next epoch. However, the overlap MUST be handled correctly.

**Behavior:**

| State | Can `trigger_epoch_transition`? | Can `execute_carnage_retry`? |
|-------|--------------------------------|------------------------------|
| `carnage_pending = true`, within deadline | Yes | Yes |
| `carnage_pending = true`, deadline expired | Yes | No (use `expire_carnage`) |
| `carnage_pending = false` | Yes | No |

**Resolution:**
- Epoch transitions are INDEPENDENT of Carnage pending state
- `trigger_epoch_transition` checks only `vrf_pending` and epoch boundary -- it does NOT check `carnage_pending`
- The new epoch's VRF callback will:
  1. First check if old Carnage is still pending
  2. If pending and expired (> 100 slots): Clear `carnage_pending`, retain SOL in vault
  3. If pending and NOT expired: This should not happen (100 slots << 4,500 slots per epoch)
  4. Then evaluate new Carnage trigger conditions from fresh randomness bytes
  5. If triggered: New Carnage execution begins

**Why this is safe:**
- Carnage SOL is never lost (retained in vault on expiration)
- Old pending Carnage auto-expires well before next epoch (40s vs 30min)
- New epoch proceeds normally regardless of Carnage state
- No state machine deadlock possible -- `carnage_pending` and `vrf_pending` are independent flags
- Even in the degenerate case where 100 slots somehow overlap (validator slowdown), the VRF callback handles cleanup

**Invariant:** `carnage_pending` NEVER blocks epoch transitions. `vrf_pending` NEVER blocks Carnage execution. These are independent state dimensions.

---

## 7. VRF Integration

### 7.1 Switchboard On-Demand (Commit-Reveal)

The protocol uses **Switchboard On-Demand** for verifiable randomness. This uses a **client-side commit-reveal** pattern — the on-chain program never CPIs into Switchboard. Instead, the client orchestrates the VRF flow across three transactions, and the program only validates and reads a passed-in randomness account.

> **Important:** The legacy Switchboard VRF v2 CPI callback pattern has been shut down. The `solana-randomness-service-lite` and `switchboard-v2` crates are abandoned/deprecated. On-Demand is the only viable Switchboard integration. See `Docs/VRF_Migration_Lessons.md` DISC-04 and `Docs/VRF_Implementation_Reference.md` for full context.

**Three-Transaction Lifecycle:**

```
 Client (crank bot)         Solana                  Switchboard Oracle
   |                         |                           |
   |  TX 1: Create Account   |                           |
   |  (Keypair.generate())   |                           |
   |------------------------>|                           |
   |   (wait for FINALIZE)   |                           |
   |<------------------------|                           |
   |                         |                           |
   |  TX 2: Commit + Trigger |                           |
   |------------------------>|                           |
   |   SDK commitIx          |------- seed_slot -------->|
   |   trigger_epoch_transition()                        |
   |<------------------------|                           |
   |                         |                           |
   |   (wait ~3 slots)       |                           |
   |                         |<--- oracle reveals -------|
   |                         |                           |
   |  TX 3: Reveal + Consume |                           |
   |------------------------>|                           |
   |   SDK revealIx          |                           |
   |   consume_randomness()  |                           |
   |<------------------------|                           |
   |                         |                           |
   |  Epoch advanced, new    |                           |
   |  tax rates applied      |                           |
```

**Why three transactions, not two:** The Switchboard SDK's `commitIx()` reads the randomness account's on-chain data client-side before constructing the commit instruction. The account must exist and be finalized before `commitIx()` can be called. This is a hard SDK constraint — combining TX 1 and TX 2 will always fail.

**On-chain program responsibilities:**
1. **At commit time** (`trigger_epoch_transition`): Validate randomness account freshness, verify it hasn't been revealed yet, store its pubkey for anti-reroll binding
2. **At consume time** (`consume_randomness`): Verify same account that was committed, read revealed bytes, derive taxes, execute Carnage

**On-chain program does NOT:**
- CPI into Switchboard
- Create randomness accounts
- Call SDK functions
- Manage oracle interactions

All Switchboard SDK calls happen client-side in TypeScript. See `Docs/VRF_Implementation_Reference.md` Section 4 for the complete client-side flow with code examples.

**Anti-Reroll Protection:**

The program binds the specific randomness account at commit time:
```rust
// At trigger_epoch_transition: bind the randomness account
epoch.pending_randomness_account = ctx.accounts.randomness_account.key();

// At consume_randomness: verify the EXACT same account
require!(
    ctx.accounts.randomness_account.key() == epoch.pending_randomness_account,
    EpochError::RandomnessAccountMismatch
);
```

This prevents an attacker from committing one randomness request, seeing unfavorable results, and substituting a different account with better values.

**Stale Randomness Prevention:**

Two checks at commit time prevent pre-generated randomness attacks:
```rust
// Freshness: seed_slot must be within 1 slot of current
let slot_diff = clock.slot.saturating_sub(randomness_data.seed_slot);
require!(slot_diff <= 1, EpochError::RandomnessExpired);

// Not-yet-revealed: randomness must still be in commit phase
if randomness_data.get_value(clock.slot).is_ok() {
    return Err(EpochError::RandomnessAlreadyRevealed.into());
}
```

### 7.2 VRF Byte Allocation

The 32-byte VRF result is parsed as follows. Bytes 0-4 are used for tax derivation with independent per-token magnitude rolls. Bytes 5-7 are used for Carnage. MIN_VRF_BYTES = 8.

| Byte | Purpose | Interpretation |
|------|---------|----------------|
| 0 | Regime flip | `< 192` (75%) → flip cheap side |
| 1 | CRIME low/high magnitude | `100 + (byte % 4) * 100` (low) or `1100 + (byte % 4) * 100` (high) |
| 2 | CRIME high/low magnitude | `1100 + (byte % 4) * 100` (high) or `100 + (byte % 4) * 100` (low) |
| 3 | FRAUD low/high magnitude | `100 + (byte % 4) * 100` (low) or `1100 + (byte % 4) * 100` (high) |
| 4 | FRAUD high/low magnitude | `1100 + (byte % 4) * 100` (high) or `100 + (byte % 4) * 100` (low) |
| 5 | Carnage trigger | `< 11` (~4.3%) → trigger Carnage |
| 6 | Carnage action | `< 5` (2%) → sell, else burn |
| 7 | Carnage buy target | `< 128` (50%) → CRIME, else FRAUD |
| 8-31 | Reserved | Future use |

**Independent tax rolls (Phase 37 update):** Each token (CRIME, FRAUD) now gets its own independent magnitude rolls from separate VRF bytes. This means CRIME and FRAUD can have different tax magnitudes within their assigned bands. Both tokens can simultaneously have cheap-side rates or expensive-side rates of different magnitudes.

### 7.3 Tax Derivation Logic

**Phase 37 update: Independent per-token magnitude rolls.** Each token gets its own VRF bytes for low and high magnitudes. The legacy `low_tax_bps` and `high_tax_bps` fields are set to 0 (rates are now independent per token).

```rust
fn derive_taxes(
    vrf_result: &[u8; 32],
    current_cheap: Token,
) -> TaxConfig {
    // Byte 0: Flip decision (75% probability of flipping)
    let should_flip = vrf_result[0] < 192;

    // Bytes 1-2: CRIME magnitude rolls (independent)
    let crime_low_bps  = 100 + ((vrf_result[1] % 4) as u16 * 100);   // 100-400
    let crime_high_bps = 1100 + ((vrf_result[2] % 4) as u16 * 100);  // 1100-1400

    // Bytes 3-4: FRAUD magnitude rolls (independent)
    let fraud_low_bps  = 100 + ((vrf_result[3] % 4) as u16 * 100);   // 100-400
    let fraud_high_bps = 1100 + ((vrf_result[4] % 4) as u16 * 100);  // 1100-1400

    // New cheap side
    let cheap_side = if should_flip {
        current_cheap.opposite()
    } else {
        current_cheap
    };

    // Derive all four rates independently per token
    // When a token is the "cheap side", buying it is cheap (low) and selling expensive (high).
    // Each token uses its OWN magnitude rolls, so rates are independent.
    match cheap_side {
        Token::CRIME => TaxConfig {
            cheap_side: Token::CRIME,
            low_tax_bps: 0,   // Legacy -- rates are now independent per token
            high_tax_bps: 0,  // Legacy -- rates are now independent per token
            crime_buy_tax_bps: crime_low_bps,    // CRIME cheap to buy
            crime_sell_tax_bps: crime_high_bps,   // CRIME expensive to sell
            fraud_buy_tax_bps: fraud_high_bps,    // FRAUD expensive to buy
            fraud_sell_tax_bps: fraud_low_bps,     // FRAUD cheap to sell
        },
        Token::FRAUD => TaxConfig {
            cheap_side: Token::FRAUD,
            low_tax_bps: 0,   // Legacy -- rates are now independent per token
            high_tax_bps: 0,  // Legacy -- rates are now independent per token
            crime_buy_tax_bps: crime_high_bps,    // CRIME expensive to buy
            crime_sell_tax_bps: crime_low_bps,     // CRIME cheap to sell
            fraud_buy_tax_bps: fraud_low_bps,     // FRAUD cheap to buy
            fraud_sell_tax_bps: fraud_high_bps,    // FRAUD expensive to sell
        },
    }
}
```

### 7.4 Tax Band Boundary Conditions

Tax rates are determined by VRF randomness and follow exact discrete values. No intermediate or fractional rates are possible.

#### Achievable Tax Rates

| Band | Possible Values (bps) | VRF Byte Mapping |
|------|----------------------|------------------|
| Low | 100, 200, 300, 400 | `vrf_byte % 4` selects index |
| High | 1100, 1200, 1300, 1400 | `vrf_byte % 4` selects index |

**Exact Calculation:**
```rust
const LOW_RATES: [u16; 4] = [100, 200, 300, 400];      // 1%, 2%, 3%, 4%
const HIGH_RATES: [u16; 4] = [1100, 1200, 1300, 1400]; // 11%, 12%, 13%, 14%

fn select_rate(vrf_byte: u8, band: TaxBand) -> u16 {
    let index = (vrf_byte % 4) as usize;
    match band {
        TaxBand::Low => LOW_RATES[index],
        TaxBand::High => HIGH_RATES[index],
    }
}
```

#### Boundary Behavior

| Question | Answer |
|----------|--------|
| Is 1% exactly achievable? | Yes, when `vrf_byte % 4 == 0` and band is Low |
| Is 14% exactly achievable? | Yes, when `vrf_byte % 4 == 3` and band is High |
| Can values between (e.g., 1.5%) occur? | No, only the 8 discrete values |
| Is there any rounding? | No, rates are selected from array |
| Can 0% tax occur? | No, minimum is 100 bps (1%) |
| Can values above 14% occur? | No, maximum is 1400 bps (14%) |
| Gap between bands (5-10%)? | Intentional, no rate in this range is possible |

#### VRF Byte Distribution

The VRF callback provides a random byte (0-255). After `% 4`:
- 0: Selects first rate (100 or 1100 bps)
- 1: Selects second rate (200 or 1200 bps)
- 2: Selects third rate (300 or 1300 bps)
- 3: Selects fourth rate (400 or 1400 bps)

Each rate has exactly 25% probability (64 of 256 byte values map to each).

#### Testing Implications

For comprehensive testing:
- Test all 8 tax rates explicitly
- Test VRF byte values 0, 1, 2, 3, 252, 253, 254, 255 (boundaries)
- Verify no intermediate values possible
- Verify rate changes at epoch boundary (not mid-epoch)
- Verify both bands are resampled each epoch (even without flip)

---

## 8. Instructions

### 8.1 initialize_epoch_state

Initializes the global epoch state at protocol deployment.

**Accounts:**
| Account | Type | Description |
|---------|------|-------------|
| authority | Signer | Deployer (one-time) |
| epoch_state | Init PDA | Global epoch state |
| system_program | Program | System program |

**Logic:**
```rust
pub fn initialize_epoch_state(ctx: Context<InitializeEpochState>) -> Result<()> {
    let epoch_state = &mut ctx.accounts.epoch_state;
    let clock = Clock::get()?;
    
    epoch_state.genesis_slot = clock.slot;
    epoch_state.current_epoch = 0;
    epoch_state.epoch_start_slot = clock.slot;
    
    // Genesis: CRIME cheap
    epoch_state.cheap_side = Token::CRIME;
    epoch_state.low_tax_bps = 300;
    epoch_state.high_tax_bps = 1400;
    epoch_state.crime_buy_tax_bps = 300;
    epoch_state.crime_sell_tax_bps = 1400;
    epoch_state.fraud_buy_tax_bps = 1400;
    epoch_state.fraud_sell_tax_bps = 300;
    
    epoch_state.vrf_request_slot = 0;
    epoch_state.vrf_pending = false;
    epoch_state.taxes_confirmed = true;
    
    epoch_state.carnage_pending = false;
    epoch_state.carnage_target = Token::CRIME;
    epoch_state.carnage_action = CarnageAction::None;
    epoch_state.carnage_deadline_slot = 0;
    epoch_state.last_carnage_epoch = 0;
    
    epoch_state.initialized = true;
    epoch_state.bump = ctx.bumps.epoch_state;
    
    emit!(EpochStateInitialized {
        genesis_slot: epoch_state.genesis_slot,
        initial_cheap_side: Token::CRIME,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}
```

**Callable:** Once, at deployment

---

### 8.2 trigger_epoch_transition

Initiates an epoch transition by advancing the epoch number and committing a Switchboard randomness account. Permissionless with bounty.

The client **must** bundle this instruction with the Switchboard SDK `commitIx` in the same transaction. The randomness account must have been created and finalized in a prior transaction (see VRF_Implementation_Reference.md Section 4).

**Accounts:**
| Account | Type | Description |
|---------|------|-------------|
| payer | Signer | Receives bounty |
| epoch_state | Mut PDA | Global epoch state |
| treasury | Mut | Protocol treasury (pays bounty) |
| randomness_account | UncheckedAccount | Switchboard On-Demand randomness account (created by client) |
| system_program | Program | System program |

**Logic:**
```rust
pub fn trigger_epoch_transition(ctx: Context<TriggerEpochTransition>) -> Result<()> {
    let epoch_state = &mut ctx.accounts.epoch_state;
    let clock = Clock::get()?;

    // Validate epoch boundary reached
    let expected_epoch = current_epoch(clock.slot, epoch_state.genesis_slot);
    require!(
        expected_epoch > epoch_state.current_epoch,
        EpochError::EpochBoundaryNotReached
    );

    // Validate no VRF already pending
    require!(
        !epoch_state.vrf_pending,
        EpochError::VrfAlreadyPending
    );

    // === Validate randomness account (On-Demand commit) ===
    let randomness_data = {
        let data = ctx.accounts.randomness_account.try_borrow_data()?;
        RandomnessAccountData::parse(data)
            .map_err(|_| EpochError::RandomnessParseError)?
    };

    // Freshness: seed_slot must be within 1 slot of current
    let slot_diff = clock.slot.saturating_sub(randomness_data.seed_slot);
    require!(slot_diff <= 1, EpochError::RandomnessExpired);

    // Not-yet-revealed: must still be in commit phase
    if randomness_data.get_value(clock.slot).is_ok() {
        return Err(EpochError::RandomnessAlreadyRevealed.into());
    }

    // Advance epoch number
    epoch_state.current_epoch = expected_epoch;
    epoch_state.epoch_start_slot = epoch_start_slot(expected_epoch, epoch_state.genesis_slot);
    epoch_state.vrf_request_slot = clock.slot;
    epoch_state.vrf_pending = true;
    epoch_state.taxes_confirmed = false;

    // Bind randomness account (anti-reroll protection)
    epoch_state.pending_randomness_account = ctx.accounts.randomness_account.key();

    // Pay bounty to triggerer
    let bounty_ix = system_instruction::transfer(
        &ctx.accounts.treasury.key(),
        &ctx.accounts.payer.key(),
        TRIGGER_BOUNTY_LAMPORTS,
    );
    invoke_signed(&bounty_ix, &[...], &[treasury_seeds])?;

    emit!(EpochTransitionTriggered {
        epoch: expected_epoch,
        triggered_by: ctx.accounts.payer.key(),
        slot: clock.slot,
        bounty_paid: TRIGGER_BOUNTY_LAMPORTS,
    });

    Ok(())
}
```

**Callable:** By anyone, after epoch boundary. Client must bundle with Switchboard SDK `commitIx`.

**Client-side transaction construction:**
```typescript
// TX 2: Commit + Trigger (bundled in one transaction)
const commitIx = await randomness.commitIx(queueAccount);
const triggerIx = await epochProgram.methods
    .triggerEpochTransition()
    .accounts({
        payer: wallet.publicKey,
        epochState: epochPda,
        treasury: treasuryPda,
        randomnessAccount: rngKp.publicKey,
        systemProgram: SystemProgram.programId,
    })
    .instruction();

const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    commitIx,     // Switchboard SDK commit
    triggerIx,    // Program epoch advancement + randomness binding
);
await provider.sendAndConfirm(tx, [wallet.payer]);
```

### Epoch Skip Behavior

Epoch numbers may skip (e.g., epoch 100 -> 105) if the crank runner is delayed or offline. This is by design:

- **Tax rates**: Persist at last-set values. No tax-free trading window.
- **Staking rewards**: Accumulate per-epoch. Skipped epochs have no yield (no double-counting).
- **Carnage**: Only triggers via VRF in `consume_randomness`. Skipping cannot trigger Carnage.
- **Epoch number**: Set directly to the computed epoch (`(current_slot - genesis) / SLOTS_PER_EPOCH`), not incremented. The on-chain state is always consistent with wall-clock time.

The crank runner logs a warning when `epoch_delta > 1` for operational awareness.

---

### 8.3 consume_randomness

Called by the crank bot after the Switchboard oracle has revealed randomness (~3 slots after commit). Reads the revealed bytes, updates taxes, updates staking cumulative rewards, and executes Carnage atomically.

The client **must** bundle this instruction with the Switchboard SDK `revealIx` in the same transaction. The reveal instruction must precede this instruction in transaction ordering.

**Accounts:**
| Account | Type | Description |
|---------|------|-------------|
| caller | Signer | Anyone (typically same crank bot that triggered) |
| epoch_state | Mut PDA | Global epoch state |
| randomness_account | UncheckedAccount | Same Switchboard randomness account from trigger (anti-reroll verified) |
| stake_pool | Mut PDA | Staking Program pool state (for cumulative update) |
| staking_program | Program | Staking Program |
| carnage_fund | Mut PDA | Carnage Fund state |
| carnage_sol_vault | Mut | Carnage SOL holdings |
| carnage_ip_vault | Mut | Carnage IP token holdings |
| target_pool | Mut PDA | Pool for Carnage buy (CRIME/SOL or FRAUD/SOL) |
| target_pool_vault_ip | Mut | Pool IP vault |
| target_pool_vault_sol | Mut | Pool SOL vault |
| target_mint | Account | CRIME or FRAUD mint |
| amm_program | Program | AMM program |
| token_program | Program | SPL Token program |
| token_2022_program | Program | Token-2022 program |

**Logic:**
```rust
pub fn consume_randomness(ctx: Context<ConsumeRandomness>) -> Result<()> {
    let epoch_state = &mut ctx.accounts.epoch_state;
    let clock = Clock::get()?;

    // Validate VRF is pending
    require!(
        epoch_state.vrf_pending,
        EpochError::NoVrfPending
    );

    // Anti-reroll: verify SAME randomness account that was committed
    require!(
        ctx.accounts.randomness_account.key() == epoch_state.pending_randomness_account,
        EpochError::RandomnessAccountMismatch
    );

    // Read revealed randomness bytes (fails if oracle hasn't revealed yet)
    let vrf_result = {
        let data = ctx.accounts.randomness_account.try_borrow_data()?;
        let randomness_data = RandomnessAccountData::parse(data)
            .map_err(|_| EpochError::RandomnessParseError)?;
        randomness_data
            .get_value(clock.slot)
            .map_err(|_| EpochError::RandomnessNotRevealed)?
    };

    // Validate sufficient bytes for our protocol (8 bytes needed: 5 tax + 3 carnage)
    require!(vrf_result.len() >= 8, EpochError::InsufficientRandomness);

    // === 1. UPDATE TAXES ===
    let tax_config = derive_taxes(&vrf_result, epoch_state.cheap_side);

    epoch_state.cheap_side = tax_config.cheap_side;
    epoch_state.low_tax_bps = tax_config.low_tax_bps;
    epoch_state.high_tax_bps = tax_config.high_tax_bps;
    epoch_state.crime_buy_tax_bps = tax_config.crime_buy_tax_bps;
    epoch_state.crime_sell_tax_bps = tax_config.crime_sell_tax_bps;
    epoch_state.fraud_buy_tax_bps = tax_config.fraud_buy_tax_bps;
    epoch_state.fraud_sell_tax_bps = tax_config.fraud_sell_tax_bps;

    epoch_state.vrf_pending = false;
    epoch_state.taxes_confirmed = true;

    emit!(TaxesUpdated {
        epoch: epoch_state.current_epoch,
        cheap_side: tax_config.cheap_side,
        low_tax_bps: tax_config.low_tax_bps,
        high_tax_bps: tax_config.high_tax_bps,
        flipped: tax_config.cheap_side != epoch_state.cheap_side,
    });

    // === 2. UPDATE STAKING CUMULATIVE REWARDS ===
    // CPI to Staking Program to finalize epoch's yield into cumulative
    let update_cpi = CpiContext::new(
        ctx.accounts.staking_program.to_account_info(),
        staking_program::cpi::accounts::UpdateCumulative {
            epoch_state: ctx.accounts.epoch_state.to_account_info(),
            stake_pool: ctx.accounts.stake_pool.to_account_info(),
        },
    );
    staking_program::cpi::update_cumulative(update_cpi)?;

    // === 3. CHECK CARNAGE TRIGGER ===
    // Carnage bytes shifted to 5-7 to accommodate independent tax rolls (bytes 0-4)
    let carnage_triggered = vrf_result[5] < 11; // ~4.3% (1/24)

    if !carnage_triggered {
        emit!(CarnageNotTriggered {
            epoch: epoch_state.current_epoch,
        });
        return Ok(());
    }

    // === 4. DETERMINE CARNAGE PARAMETERS ===
    let carnage_action = if vrf_result[6] < 5 {
        CarnageAction::Sell
    } else {
        CarnageAction::Burn
    };

    let carnage_target = if vrf_result[7] < 128 {
        Token::CRIME
    } else {
        Token::FRAUD
    };

    // === 5. ATTEMPT ATOMIC CARNAGE EXECUTION ===
    let carnage_result = execute_carnage_inner(
        &mut ctx.accounts.carnage_fund,
        &ctx.accounts.carnage_sol_vault,
        &ctx.accounts.carnage_ip_vault,
        &ctx.accounts.target_pool,
        &ctx.accounts.target_pool_vault_ip,
        &ctx.accounts.target_pool_vault_sol,
        &ctx.accounts.target_mint,
        &ctx.accounts.amm_program,
        carnage_action,
        carnage_target,
    );

    match carnage_result {
        Ok(execution_details) => {
            epoch_state.last_carnage_epoch = epoch_state.current_epoch;

            emit!(CarnageExecuted {
                epoch: epoch_state.current_epoch,
                action: carnage_action,
                target: carnage_target,
                sol_spent: execution_details.sol_spent,
                tokens_bought: execution_details.tokens_bought,
                tokens_burned: execution_details.tokens_burned,
                atomic: true,
            });
        }
        Err(e) => {
            // Atomic execution failed, set pending state
            epoch_state.carnage_pending = true;
            epoch_state.carnage_target = carnage_target;
            epoch_state.carnage_action = carnage_action;
            epoch_state.carnage_deadline_slot = clock.slot + CARNAGE_DEADLINE_SLOTS;

            emit!(CarnagePending {
                epoch: epoch_state.current_epoch,
                target: carnage_target,
                action: carnage_action,
                deadline_slot: epoch_state.carnage_deadline_slot,
                reason: e.to_string(),
            });
        }
    }

    Ok(())
}
```

**Callable:** By anyone, after oracle has revealed randomness. Client must bundle with Switchboard SDK `revealIx`.

**Client-side transaction construction:**
```typescript
// TX 3: Reveal + Consume (bundled in one transaction)
// Wait for slot advancement (~3 slots for oracle to process)
const startSlot = await connection.getSlot();
while ((await connection.getSlot()) < startSlot + 3) {
    await new Promise(r => setTimeout(r, 400));
}

// Retry reveal until oracle is ready
let revealIx;
for (let i = 0; i < 10; i++) {
    try {
        revealIx = await randomness.revealIx();
        break;
    } catch (e) {
        if (i === 9) throw e;
        await new Promise(r => setTimeout(r, 2000));
    }
}

const consumeIx = await epochProgram.methods
    .consumeRandomness()
    .accounts({
        caller: wallet.publicKey,
        epochState: epochPda,
        randomnessAccount: rngKp.publicKey,
        stakePool: stakePoolPda,
        stakingProgram: STAKING_PROGRAM_ID,
        carnageFund: carnagePda,
        // ... remaining Carnage accounts
    })
    .instruction();

const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    revealIx,     // Switchboard SDK reveal
    consumeIx,    // Program reads bytes, updates taxes, does Carnage
);
await provider.sendAndConfirm(tx, [wallet.payer]);
```

---

### 8.4 execute_carnage

Fallback instruction to execute Carnage if atomic execution failed. Permissionless.

**Accounts:**
| Account | Type | Description |
|---------|------|-------------|
| executor | Signer | Anyone |
| epoch_state | Mut PDA | Global epoch state |
| carnage_fund | Mut PDA | Carnage Fund state |
| carnage_sol_vault | Mut | Carnage SOL holdings |
| carnage_ip_vault | Mut | Carnage IP token holdings |
| target_pool | Mut PDA | Pool for Carnage buy |
| target_pool_vault_ip | Mut | Pool IP vault |
| target_pool_vault_sol | Mut | Pool SOL vault |
| target_mint | Account | CRIME or FRAUD mint |
| amm_program | Program | AMM program |
| token_program | Program | SPL Token program |
| token_2022_program | Program | Token-2022 program |

**Logic:**
```rust
pub fn execute_carnage(ctx: Context<ExecuteCarnage>) -> Result<()> {
    let epoch_state = &mut ctx.accounts.epoch_state;
    let clock = Clock::get()?;
    
    // Validate Carnage is pending
    require!(
        epoch_state.carnage_pending,
        EpochError::NoCarnagePending
    );
    
    // Validate deadline not expired
    require!(
        clock.slot <= epoch_state.carnage_deadline_slot,
        EpochError::CarnageDeadlineExpired
    );
    
    // Validate correct target pool
    let expected_target = epoch_state.carnage_target;
    // ... pool validation logic
    
    // Execute Carnage
    let execution_details = execute_carnage_inner(
        &mut ctx.accounts.carnage_fund,
        &ctx.accounts.carnage_sol_vault,
        &ctx.accounts.carnage_ip_vault,
        &ctx.accounts.target_pool,
        &ctx.accounts.target_pool_vault_ip,
        &ctx.accounts.target_pool_vault_sol,
        &ctx.accounts.target_mint,
        &ctx.accounts.amm_program,
        epoch_state.carnage_action,
        epoch_state.carnage_target,
    )?;
    
    // Clear pending state
    epoch_state.carnage_pending = false;
    epoch_state.carnage_action = CarnageAction::None;
    epoch_state.last_carnage_epoch = epoch_state.current_epoch;
    
    emit!(CarnageExecuted {
        epoch: epoch_state.current_epoch,
        action: epoch_state.carnage_action,
        target: epoch_state.carnage_target,
        sol_spent: execution_details.sol_spent,
        tokens_bought: execution_details.tokens_bought,
        tokens_burned: execution_details.tokens_burned,
        atomic: false,
    });
    
    Ok(())
}
```

**Callable:** By anyone, while Carnage is pending and deadline not expired

---

### 8.5 expire_carnage

Clears expired Carnage pending state. SOL remains in fund.

**Accounts:**
| Account | Type | Description |
|---------|------|-------------|
| epoch_state | Mut PDA | Global epoch state |

**Logic:**
```rust
pub fn expire_carnage(ctx: Context<ExpireCarnage>) -> Result<()> {
    let epoch_state = &mut ctx.accounts.epoch_state;
    let clock = Clock::get()?;
    
    // Validate Carnage is pending
    require!(
        epoch_state.carnage_pending,
        EpochError::NoCarnagePending
    );
    
    // Validate deadline has passed
    require!(
        clock.slot > epoch_state.carnage_deadline_slot,
        EpochError::CarnageDeadlineNotExpired
    );
    
    // Clear pending state (SOL stays in fund)
    let expired_epoch = epoch_state.current_epoch;
    let expired_target = epoch_state.carnage_target;
    
    epoch_state.carnage_pending = false;
    epoch_state.carnage_action = CarnageAction::None;
    
    emit!(CarnageExpired {
        epoch: expired_epoch,
        target: expired_target,
        deadline_slot: epoch_state.carnage_deadline_slot,
        current_slot: clock.slot,
    });
    
    Ok(())
}
```

**Callable:** By anyone, after deadline has passed

---

### 8.6 retry_epoch_vrf

Re-commits a new randomness account if the original oracle failed to reveal within the timeout window. Permissionless.

The client **must** bundle this instruction with the Switchboard SDK `commitIx` in the same transaction, same as `trigger_epoch_transition`. A new randomness account must be created and finalized beforehand.

**Accounts:**
| Account | Type | Description |
|---------|------|-------------|
| payer | Signer | Pays for new randomness |
| epoch_state | Mut PDA | Global epoch state |
| randomness_account | UncheckedAccount | Fresh Switchboard randomness account (replaces stale one) |

**Logic:**
```rust
pub fn retry_epoch_vrf(ctx: Context<RetryEpochVrf>) -> Result<()> {
    let epoch_state = &mut ctx.accounts.epoch_state;
    let clock = Clock::get()?;

    // Validate VRF is pending
    require!(
        epoch_state.vrf_pending,
        EpochError::NoVrfPending
    );

    // Validate timeout has elapsed
    require!(
        clock.slot > epoch_state.vrf_request_slot + VRF_TIMEOUT_SLOTS,
        EpochError::VrfTimeoutNotElapsed
    );

    // Validate new randomness account (same checks as trigger)
    let randomness_data = {
        let data = ctx.accounts.randomness_account.try_borrow_data()?;
        RandomnessAccountData::parse(data)
            .map_err(|_| EpochError::RandomnessParseError)?
    };

    let slot_diff = clock.slot.saturating_sub(randomness_data.seed_slot);
    require!(slot_diff <= 1, EpochError::RandomnessExpired);

    if randomness_data.get_value(clock.slot).is_ok() {
        return Err(EpochError::RandomnessAlreadyRevealed.into());
    }

    // Overwrite pending state with new randomness account
    let original_slot = epoch_state.vrf_request_slot;
    epoch_state.vrf_request_slot = clock.slot;
    epoch_state.pending_randomness_account = ctx.accounts.randomness_account.key();

    emit!(VrfRetryRequested {
        epoch: epoch_state.current_epoch,
        original_request_slot: original_slot,
        retry_slot: clock.slot,
        requested_by: ctx.accounts.payer.key(),
    });

    Ok(())
}
```

**Callable:** By anyone, after VRF timeout (300 slots). Client must bundle with Switchboard SDK `commitIx`.

---

## 9. Carnage Execution Logic

### 9.1 Inner Execution Function

```rust
fn execute_carnage_inner(
    carnage_fund: &mut Account<CarnageFund>,
    sol_vault: &AccountInfo,
    ip_vault: &AccountInfo,
    pool: &Account<Pool>,
    pool_ip_vault: &AccountInfo,
    pool_sol_vault: &AccountInfo,
    target_mint: &AccountInfo,
    amm_program: &AccountInfo,
    action: CarnageAction,
    target: Token,
) -> Result<CarnageExecutionDetails> {
    let mut details = CarnageExecutionDetails::default();
    
    // Step 1: Handle existing holdings (if any)
    let held_tokens = get_token_balance(ip_vault)?;
    
    if held_tokens > 0 {
        match action {
            CarnageAction::Burn => {
                // 98% path: burn held tokens
                burn_tokens(ip_vault, target_mint, held_tokens)?;
                details.tokens_burned = held_tokens;
            }
            CarnageAction::Sell => {
                // 2% path: sell held tokens to SOL
                let sol_received = swap_to_sol(
                    ip_vault,
                    sol_vault,
                    pool,
                    pool_ip_vault,
                    pool_sol_vault,
                    amm_program,
                    held_tokens,
                )?;
                details.sol_received_from_sale = sol_received;
            }
            CarnageAction::None => {
                // Should not happen in this context
            }
        }
    }
    
    // Step 2: Market buy target token with all SOL
    let sol_balance = get_sol_balance(sol_vault)?;
    
    if sol_balance > 0 {
        let tokens_bought = swap_sol_to_ip(
            sol_vault,
            ip_vault,
            pool,
            pool_sol_vault,
            pool_ip_vault,
            amm_program,
            sol_balance,
            target,
        )?;
        
        details.sol_spent = sol_balance;
        details.tokens_bought = tokens_bought;
    }
    
    Ok(details)
}
```

### 9.2 Execution Details

```rust
#[derive(Default)]
pub struct CarnageExecutionDetails {
    pub sol_spent: u64,
    pub tokens_bought: u64,
    pub tokens_burned: u64,
    pub sol_received_from_sale: u64,
}
```

---

## 10. Tax Reading (For Swaps)

### 10.1 Get Current Tax

```rust
pub fn get_tax_bps(
    epoch_state: &EpochState,
    token: Token,
    is_buy: bool,
) -> u16 {
    match (token, is_buy) {
        (Token::CRIME, true) => epoch_state.crime_buy_tax_bps,
        (Token::CRIME, false) => epoch_state.crime_sell_tax_bps,
        (Token::FRAUD, true) => epoch_state.fraud_buy_tax_bps,
        (Token::FRAUD, false) => epoch_state.fraud_sell_tax_bps,
    }
}
```

### 10.2 Swap Instruction Integration

Swap instructions read from EpochState and apply the current tax rates. No epoch validation is required—swaps always use whatever taxes are currently stored.

Slippage protection handles the case where taxes change between submission and execution.

---

## 11. Errors

```rust
#[error_code]
pub enum EpochError {
    #[msg("Epoch boundary has not been reached yet")]
    EpochBoundaryNotReached,
    
    #[msg("VRF request is already pending")]
    VrfAlreadyPending,
    
    #[msg("No VRF request is pending")]
    NoVrfPending,
    
    #[msg("Randomness account data could not be parsed")]
    RandomnessParseError,

    #[msg("Randomness account is stale (seed_slot too old)")]
    RandomnessExpired,

    #[msg("Randomness has already been revealed (cannot commit)")]
    RandomnessAlreadyRevealed,

    #[msg("Randomness account does not match committed account")]
    RandomnessAccountMismatch,

    #[msg("Randomness has not been revealed by oracle yet")]
    RandomnessNotRevealed,

    #[msg("Insufficient randomness bytes (need 8)")]
    InsufficientRandomness,
    
    #[msg("VRF timeout has not elapsed (wait 300 slots)")]
    VrfTimeoutNotElapsed,
    
    #[msg("No Carnage execution is pending")]
    NoCarnagePending,
    
    #[msg("Carnage execution deadline has expired")]
    CarnageDeadlineExpired,
    
    #[msg("Carnage deadline has not expired yet")]
    CarnageDeadlineNotExpired,
    
    #[msg("Invalid Carnage target pool")]
    InvalidCarnageTargetPool,
    
    #[msg("Epoch state not initialized")]
    NotInitialized,
    
    #[msg("Epoch state already initialized")]
    AlreadyInitialized,
    
    #[msg("Arithmetic overflow")]
    Overflow,
    
    #[msg("Insufficient SOL in treasury for bounty")]
    InsufficientTreasuryBalance,
}
```

---

## 12. Events

```rust
#[event]
pub struct EpochStateInitialized {
    pub genesis_slot: u64,
    pub initial_cheap_side: Token,
    pub timestamp: i64,
}

#[event]
pub struct EpochTransitionTriggered {
    pub epoch: u32,
    pub triggered_by: Pubkey,
    pub slot: u64,
    pub bounty_paid: u64,
}

#[event]
pub struct TaxesUpdated {
    pub epoch: u32,
    pub cheap_side: Token,
    pub low_tax_bps: u16,
    pub high_tax_bps: u16,
    pub flipped: bool,
}

#[event]
pub struct CarnageNotTriggered {
    pub epoch: u32,
}

#[event]
pub struct CarnageExecuted {
    pub epoch: u32,
    pub action: CarnageAction,
    pub target: Token,
    pub sol_spent: u64,
    pub tokens_bought: u64,
    pub tokens_burned: u64,
    pub atomic: bool,
}

#[event]
pub struct CarnagePending {
    pub epoch: u32,
    pub target: Token,
    pub action: CarnageAction,
    pub deadline_slot: u64,
    pub reason: String,
}

#[event]
pub struct CarnageExpired {
    pub epoch: u32,
    pub target: Token,
    pub deadline_slot: u64,
    pub current_slot: u64,
}

#[event]
pub struct VrfRetryRequested {
    pub epoch: u32,
    pub original_request_slot: u64,
    pub retry_slot: u64,
    pub requested_by: Pubkey,
}
```

---

## 13. UI Integration

### 13.1 Displaying Time Until Next Round

```typescript
const SLOTS_PER_EPOCH = 4500;
const MS_PER_SLOT_ESTIMATE = 420;

function getTimeUntilNextEpoch(
    currentSlot: number,
    genesisSlot: number
): { milliseconds: number; slots: number; percentage: number } {
    const currentEpoch = Math.floor((currentSlot - genesisSlot) / SLOTS_PER_EPOCH);
    const epochStartSlot = genesisSlot + (currentEpoch * SLOTS_PER_EPOCH);
    const slotsIntoEpoch = currentSlot - epochStartSlot;
    const slotsRemaining = SLOTS_PER_EPOCH - slotsIntoEpoch;
    
    return {
        milliseconds: slotsRemaining * MS_PER_SLOT_ESTIMATE,
        slots: slotsRemaining,
        percentage: (slotsIntoEpoch / SLOTS_PER_EPOCH) * 100,
    };
}
```

### 13.2 Display States

| State | Display |
|-------|---------|
| ACTIVE | "Round 47 • CRIME is CHEAP • ~12:34 remaining" |
| VRF_PENDING | "Round 48 starting... waiting for randomness" |
| CARNAGE_PENDING | "⚠️ CARNAGE TRIGGERED • Buying CRIME..." |

### 13.3 Progress Bar

Show slot progress, not time progress. Slots are deterministic; time is estimated.

```
Round 47 of ∞
████████████████░░░░░░  71% (3,195 / 4,500 slots)
~8:42 remaining
```

---

## 14. Security Considerations

### 14.1 VRF Manipulation

- VRF result is cryptographically verified by Switchboard SGX TEE oracles
- Epoch triggerer cannot influence the random outcome
- Anti-reroll protection: randomness account is bound at commit time and verified at consume time
- Stale randomness prevention: seed_slot freshness check prevents pre-generated accounts
- Already-revealed check prevents reuse of consumed randomness

### 14.2 MEV Protection

- Carnage executes atomically in `consume_randomness` (no front-running window)
- Fallback state (if atomic fails) has 100-slot deadline to limit exposure
- Tax changes during VRF delay cannot be exploited (old taxes still apply)
- The ~3-slot gap between commit and consume is not exploitable because randomness is not yet revealed during this window

### 14.3 Denial of Service

- Epoch triggering is permissionless (no single point of failure)
- Bounty incentivizes reliable triggering
- VRF retry mechanism handles Switchboard delays

### 14.4 State Consistency

- Tax updates are atomic within VRF callback
- Carnage state is always consistent (pending XOR executed XOR expired)
- No partial state possible

### 14.5 Compute Budget

- VRF callback with atomic Carnage: ~260k compute units
- Solana limit: 1.4M compute units
- Sufficient headroom for typical operations

### 14.6 Treasury Liveness

**Requirement:** The protocol treasury must maintain sufficient SOL to pay epoch transition bounties.

**Bounty cost:** 0.01 SOL per epoch (every ~30 minutes)
- Daily cost: ~48 bounties × 0.01 SOL = ~0.48 SOL
- Weekly cost: ~3.4 SOL
- Monthly cost: ~14.4 SOL

**Failure mode:** If the treasury has insufficient SOL for the bounty transfer, `trigger_epoch_transition` will fail with `InsufficientTreasuryBalance`. This does NOT halt swaps—users can still trade using the current tax rates.

**Recommended reserve:** Treasury should maintain at least 100 epochs worth of bounties (1 SOL) as a safety buffer. Protocol revenue (from tax distribution) replenishes the treasury over time.

**Monitoring:** Off-chain monitoring should alert when treasury balance falls below 5 SOL (~10 days of runway).

### 14.7 Cranking Delay Fallback

**Scenario:** Epoch boundary passes but no one triggers `trigger_epoch_transition` for an extended period (due to network congestion, lack of incentive awareness, or other factors).

**Behavior during delay:**
1. **Swaps continue normally** — Users can still buy/sell using the previous epoch's tax rates
2. **Tax rates remain static** — No VRF request means no new randomness, so taxes don't change
3. **Carnage cannot trigger** — Carnage only triggers during VRF callback, so it's deferred
4. **No protocol halt** — The delay affects only tax regime changes, not core trading

**Recovery:** When any user eventually calls `trigger_epoch_transition`:
- Epoch advances to the correct epoch number (not just +1)
- New VRF request initiates for current epoch
- Normal operation resumes

**Design rationale:** Epoch transitions are incentivized (0.01 SOL bounty) but not required for protocol operation. This ensures swaps remain available even during cranking disruptions.

---

## 15. Testing Requirements

### 15.1 Unit Tests

- Epoch calculation from slots
- Tax derivation from VRF bytes
- VRF byte parsing (all 6 bytes)
- Tax rate caching correctness

### 15.2 Integration Tests

**Happy Path:**
- Initialize epoch state
- Trigger epoch transition (with randomness commit)
- Consume randomness (with reveal) updates taxes
- Swaps read correct taxes
- Multiple epoch transitions (full 3-TX cycle)

**Carnage Paths:**
- Carnage triggered, atomic execution succeeds
- Carnage triggered, atomic fails, fallback succeeds
- Carnage triggered, atomic fails, deadline expires
- Carnage with existing token holdings (burn path)
- Carnage with existing token holdings (sell path)

**VRF Edge Cases:**
- VRF timeout, retry with new randomness account succeeds
- Multiple retries
- consume_randomness with wrong randomness account (rejected — anti-reroll)
- consume_randomness before oracle reveals (rejected — RandomnessNotRevealed)
- Stale randomness account at commit time (rejected — RandomnessExpired)

**Timing Edge Cases:**
- Trigger exactly at boundary slot
- Trigger 1 slot after boundary
- Multiple trigger attempts in same epoch (only first succeeds)

### 15.3 Negative Tests

- Trigger before boundary (rejected)
- Trigger with VRF pending (rejected)
- consume_randomness without pending commit (rejected)
- consume_randomness with mismatched randomness account (rejected)
- Execute Carnage without pending (rejected)
- Execute Carnage after deadline (rejected)
- Expire Carnage before deadline (rejected)
- Retry VRF before timeout (rejected)

### 15.4 Stress Tests (Critical for Devnet)

> **Important:** Atomic Carnage execution must be validated under extreme conditions during devnet testing. If atomic execution consistently fails, the fallback mechanism becomes the primary path, which has MEV exposure.

**Test scenarios:**
- Carnage Fund with maximum expected SOL (~1000 SOL)
- Carnage execution during high network congestion
- Carnage execution with low pool liquidity
- Simultaneous Carnage and large user swaps
- Compute unit consumption at various fund sizes

**Success criteria:**
- Atomic execution succeeds >95% of the time under normal conditions
- Fallback execution succeeds 100% of the time within deadline
- No state corruption under any failure mode

---

## 16. Invariants Summary

1. **Single global epoch state** — One account governs all pools
2. **Slot-based timing** — Deterministic epoch boundaries
3. **Permissionless triggering** — Anyone can advance epochs
4. **Atomic Carnage preferred** — No MEV window in happy path
5. **Taxes always readable** — Swaps never blocked by epoch state
6. **VRF required for tax changes** — No deterministic fallback
7. **Carnage accumulates on failure** — SOL stays in fund if expired
8. **No admin functions** — All transitions are permissionless post-deployment
9. **Anti-reroll** — Randomness account bound at commit, verified at consume
10. **Client-side VRF** — Program never CPIs into Switchboard; client orchestrates On-Demand flow

---

## Audit Trail

- **Updated:** VRF integration pattern rewritten from deprecated CPI callback to Switchboard On-Demand client-side commit-reveal. Resolved DISC-04 from VRF_Migration_Lessons.md. Changes: Section 4.1 (added `pending_randomness_account` field, updated size to 101 bytes), Section 5 (genesis state), Section 6 (state diagram + transition rules), Section 7 (complete rewrite — On-Demand pattern, anti-reroll, stale randomness prevention), Section 8.2 (trigger_epoch_transition — removed CPI, added randomness account validation), Section 8.3 (renamed vrf_callback → consume_randomness — reads from client-provided account), Section 8.6 (renamed retry_vrf_request → retry_epoch_vrf — commits new randomness account), Section 11 (added 6 VRF-specific error codes), Section 14 (updated security considerations), Section 15 (updated test names). Cross-reference: VRF_Implementation_Reference.md, VRF_Migration_Lessons.md
- **Updated (Phase 37):** Independent tax rolls. VRF byte allocation expanded: bytes 0-4 for tax (flip + 4 independent magnitude rolls for CRIME and FRAUD), bytes 5-7 for Carnage (shifted from 3-5). MIN_VRF_BYTES increased from 6 to 8. Section 7.2 (byte table updated), Section 7.3 (derive_taxes rewritten for independent per-token magnitudes), Section 8.3 (consume_randomness Carnage byte indices updated). Legacy low_tax_bps/high_tax_bps set to 0 (rates now independent per token).