# Architecture Research: Epoch/VRF Program Integration

**Project:** Dr. Fraudsworth's Finance Factory
**Dimension:** Epoch/VRF Program Architecture
**Researched:** 2026-02-06
**Confidence:** HIGH (verified against existing codebase and specs)

---

## 1. Executive Summary

The Epoch/VRF Program is the coordination hub for the Dr. Fraudsworth protocol. It manages time-based epoch transitions, VRF-driven tax regime changes, and Carnage Fund execution. This document maps how the new program integrates with the existing AMM, Tax Program, and Transfer Hook infrastructure.

**Key architectural constraint:** CPI depth MUST NOT exceed 4 (Solana hard limit). The Carnage execution path exactly reaches this limit.

---

## 2. Existing Architecture (What Already Exists)

### 2.1 Deployed/Implemented Programs

| Program | Status | Program ID | Purpose |
|---------|--------|------------|---------|
| AMM | Implemented | `zFW9moTqWoBhCJ2eVREhrkasaNwvhprCoKCmJZfrUxa` | Pure swap primitive, no tax logic |
| Transfer Hook | Spec complete | TBD | Whitelist enforcement for T22 tokens |
| Mock Tax Program | Implemented | `9irnHg1ddyLeeDTcuXYMa8Zby7uafL5PpkZ7LPfzzNw9` | Testing scaffold for AMM access control |

### 2.2 AMM Access Control Pattern (Critical)

The AMM is protected by a `swap_authority` PDA pattern:

```rust
// AMM expects this signer on all swaps
#[account(
    seeds = [b"swap_authority"],
    bump,
    seeds::program = TAX_PROGRAM_ID,  // Hardcoded Tax Program ID
)]
pub swap_authority: Signer<'info>,
```

**Implication:** Only the Tax Program can call AMM swaps. The Epoch Program CANNOT directly call AMM - it must route through Tax Program.

### 2.3 Existing CPI Chain (User Swaps)

```
User -> Tax Program -> AMM -> Token-2022 -> Hook
         (entry)     (depth 1)  (depth 2)   (depth 3)
```

This chain is at depth 3 for user-initiated swaps.

---

## 3. Integration Architecture

### 3.1 Program Relationships

```
                                    +-----------------+
                                    |                 |
                                    |  Epoch Program  |
                                    |  (VRF + Epoch   |
                                    |   + Carnage)    |
                                    |                 |
                                    +-------+---------+
                                            |
              +-----------------------------+-----------------------------+
              |                             |                             |
              v                             v                             v
    +-----------------+          +-----------------+           +-----------------+
    |                 |          |                 |           |                 |
    |  Tax Program    |   read   |  Staking        |    CPI    |  AMM Program    |
    |                 |<---------|  Program        |           |                 |
    +-----------------+          +-----------------+           +-----------------+
              |                                                        ^
              |                     CPI (via Tax)                      |
              +--------------------------------------------------------+

Legend:
  -> = CPI call
  <-- = Account read
```

### 3.2 Integration Points

| Integration | Direction | Purpose | Mechanism |
|-------------|-----------|---------|-----------|
| Epoch -> Tax | CPI | Carnage exempt swaps | `swap_exempt` instruction |
| Tax -> EpochState | Read | Get current tax rates | Account deserialization |
| Epoch -> Staking | CPI | Update cumulative rewards | `update_cumulative` instruction |
| Epoch -> AMM | **NONE** | Cannot bypass Tax | Tax::swap_exempt routes to AMM |

### 3.3 Carnage CPI Chain (Critical Path)

This is the deepest CPI chain in the protocol:

```
Epoch::consume_randomness (entry point)
  |
  +-> Tax::swap_exempt (depth 1)
      |
      +-> AMM::swap_sol_pool (depth 2)
          |
          +-> Token-2022::transfer_checked (depth 3)
              |
              +-> Transfer_Hook::execute (depth 4) <-- SOLANA LIMIT
```

**ARCHITECTURAL CONSTRAINT (PERMANENT):**
- CPI depth is EXACTLY at Solana's hard limit (4)
- No additional CPI calls can be added to this path
- Carnage MUST be inlined in Epoch Program (not a separate program)
- If Carnage were separate: Carnage -> Epoch -> Tax -> AMM -> T22 -> Hook = depth 5 (EXCEEDS LIMIT)

---

## 4. New Components to Build

### 4.1 EpochState Account (Global Singleton)

**Seeds:** `["epoch_state"]`
**Program:** epoch_program
**Size:** 101 bytes (8 discriminator + 93 data)

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

    // VRF State (Switchboard On-Demand)
    pub vrf_request_slot: u64,          // When randomness was committed
    pub vrf_pending: bool,              // Waiting for reveal
    pub taxes_confirmed: bool,          // False until consumed
    pub pending_randomness_account: Pubkey, // Anti-reroll binding

    // Carnage State
    pub carnage_pending: bool,
    pub carnage_target: Token,
    pub carnage_action: CarnageAction,
    pub carnage_deadline_slot: u64,
    pub last_carnage_epoch: u32,

    // Protocol
    pub initialized: bool,
    pub bump: u8,
}
```

### 4.2 CarnageFundState Account

**Seeds:** `["carnage_fund"]`
**Program:** epoch_program
**Size:** 148 bytes

```rust
#[account]
pub struct CarnageFundState {
    pub sol_vault: Pubkey,           // PDA for SOL holdings
    pub crime_vault: Pubkey,         // PDA for CRIME holdings
    pub fraud_vault: Pubkey,         // PDA for FRAUD holdings
    pub held_token: Option<Token>,   // What token currently held
    pub held_amount: u64,            // How much held
    pub last_trigger_epoch: u32,
    pub total_sol_spent: u64,
    pub total_crime_burned: u64,
    pub total_fraud_burned: u64,
    pub total_triggers: u32,
    pub initialized: bool,
    pub bump: u8,
}
```

### 4.3 Vault PDAs (Owned by Epoch Program)

| Vault | Seeds | Token Type | Purpose |
|-------|-------|------------|---------|
| Carnage SOL | `["carnage_sol_vault"]` | Native SOL | Accumulates 24% of taxes |
| Carnage CRIME | `["carnage_crime_vault"]` | Token-2022 | Holds purchased CRIME |
| Carnage FRAUD | `["carnage_fraud_vault"]` | Token-2022 | Holds purchased FRAUD |

### 4.4 Carnage Signer PDA

**Seeds:** `["carnage_signer"]`
**Program:** epoch_program
**Purpose:** Signs `Tax::swap_exempt` CPI calls

This PDA has NO associated account data - it exists purely as a signer.

---

## 5. Tax Program Modifications

### 5.1 New Instruction: `swap_exempt`

The Tax Program needs a new instruction for Carnage swaps:

```rust
pub fn swap_exempt<'info>(
    ctx: Context<'_, '_, 'info, 'info, SwapExempt<'info>>,
    amount_in: u64,
    direction: SwapDirection,
    minimum_amount_out: u64,
) -> Result<()>
```

**Account Requirements:**

| Account | Type | Description |
|---------|------|-------------|
| carnage_signer | Signer | **MUST be Epoch Program's carnage_signer PDA** |
| pool | Mut PDA | CRIME/SOL or FRAUD/SOL pool |
| input_vault | Mut | Carnage SOL vault (for buys) or token vault (for sells) |
| output_vault | Mut | Destination vault |
| swap_authority | PDA | Tax Program's swap_authority (signs AMM CPI) |
| amm_program | Program | AMM program |
| token_program | Program | SPL Token (for WSOL) |
| token_2022_program | Program | Token-2022 (for CRIME/FRAUD) |

**Enforcement:**
```rust
// Validate carnage_signer is the correct PDA from Epoch Program
let (expected_carnage_signer, _) = Pubkey::find_program_address(
    &[b"carnage_signer"],
    &EPOCH_PROGRAM_ID
);
require_keys_eq!(
    ctx.accounts.carnage_signer.key(),
    expected_carnage_signer,
    TaxError::UnauthorizedCarnageCall
);
```

### 5.2 Existing Swaps: Read EpochState

All taxed swaps must read from EpochState for current rates:

```rust
// In swap_sol_buy / swap_sol_sell
let epoch_state = &ctx.accounts.epoch_state;

// Determine which tax rate to use
let tax_bps = match (pool_type, direction) {
    (PoolType::CrimeSol, SwapDirection::Buy) => epoch_state.crime_buy_tax_bps,
    (PoolType::CrimeSol, SwapDirection::Sell) => epoch_state.crime_sell_tax_bps,
    (PoolType::FraudSol, SwapDirection::Buy) => epoch_state.fraud_buy_tax_bps,
    (PoolType::FraudSol, SwapDirection::Sell) => epoch_state.fraud_sell_tax_bps,
    _ => return Err(TaxError::InvalidPoolType.into()),
};
```

---

## 6. VRF Integration (Three-Transaction Lifecycle)

### 6.1 Transaction Flow

```
                         [Client/Crank Bot]
                               |
    +--------------------------|---------------------------+
    |                          |                           |
    v                          v                           v
TX 1: Create              TX 2: Commit                TX 3: Reveal
  Account                 + Lock Epoch                + Consume

  Keypair.gen()           SDK commitIx                SDK revealIx
  Randomness.create()     trigger_epoch_transition()  consume_randomness()

  WAIT FOR FINALIZED      WAIT ~3 SLOTS               EPOCH ADVANCED
```

### 6.2 Why Three Transactions (Not Two)

**SDK Constraint:** The Switchboard `commitIx()` method reads the randomness account's on-chain data CLIENT-SIDE before constructing the instruction. The account must exist and be finalized.

Combining TX 1 and TX 2 ALWAYS fails.

### 6.3 On-Chain Program Responsibilities

**At `trigger_epoch_transition`:**
- Validate epoch boundary reached
- Validate randomness account is fresh (seed_slot <= 1 slot old)
- Validate randomness NOT yet revealed
- Store `pending_randomness_account` for anti-reroll
- Set `vrf_pending = true`
- Increment epoch number

**At `consume_randomness`:**
- Verify randomness account matches committed one
- Read revealed bytes
- Derive new tax rates (bytes 0-2)
- Check Carnage trigger (byte 3)
- Execute Carnage if triggered (bytes 4-5 determine action/target)
- Update Staking cumulative rewards
- Set `vrf_pending = false`, `taxes_confirmed = true`

---

## 7. Data Flow Diagrams

### 7.1 Epoch Transition Flow

```
Epoch Boundary Reached
        |
        v
[TX 2: trigger_epoch_transition]
        |
        +-- Client bundles with SDK commitIx
        |
        v
EpochState Updated:
  - current_epoch++
  - vrf_pending = true
  - pending_randomness_account = X
        |
        v
(Wait ~3 slots for oracle)
        |
        v
[TX 3: consume_randomness]
        |
        +-- Client bundles with SDK revealIx
        |
        v
Read VRF Result (32 bytes)
        |
        +-- Byte 0: Regime flip (75% chance)
        +-- Byte 1: Low tax magnitude (1-4%)
        +-- Byte 2: High tax magnitude (11-14%)
        +-- Byte 3: Carnage trigger (~4.3%)
        +-- Byte 4: Carnage action (2% sell, 98% burn)
        +-- Byte 5: Carnage target (50/50 CRIME/FRAUD)
        |
        v
Update EpochState.tax_rates
        |
        v
CPI: staking_program::update_cumulative
        |
        v
If Carnage Triggered:
        |
        +-- Try atomic execution
        |       |
        |       v
        |   CPI: tax_program::swap_exempt
        |       |
        |       v
        |   [Depth 4 reached at Hook]
        |
        +-- On failure: Set carnage_pending = true
                |
                v
            100-slot deadline
```

### 7.2 Carnage Execution Flow

```
Carnage Triggered (vrf_result[3] < 11)
        |
        v
Has Holdings? ----NO----> [Buy Only Path]
        |                        |
       YES                       |
        |                        |
        v                        |
VRF Byte 4 < 5?                  |
        |                        |
   +----+----+                   |
   |         |                   |
  YES       NO                   |
   |         |                   |
   v         v                   |
[Sell]    [Burn]                 |
   |         |                   |
   v         v                   v
   +----> [Buy Target Token] <---+
                |
                v
        Update CarnageFundState:
          - held_token = target
          - held_amount = received
          - total_sol_spent += amount
```

---

## 8. Account Ownership Matrix

| Account | Owner Program | Written By | Read By |
|---------|---------------|------------|---------|
| EpochState | Epoch Program | Epoch Program | Tax Program, UI |
| CarnageFundState | Epoch Program | Epoch Program | UI |
| carnage_sol_vault | System (native) | Epoch Program | Epoch Program |
| carnage_crime_vault | Token-2022 | Epoch Program | Epoch Program |
| carnage_fraud_vault | Token-2022 | Epoch Program | Epoch Program |
| Pool | AMM Program | AMM Program | Tax Program |
| swap_authority | (signer-only) | N/A | AMM Program |
| carnage_signer | (signer-only) | N/A | Tax Program |

---

## 9. CPI Authority Summary

| CPI Call | Caller | Signer PDA | Seeds |
|----------|--------|------------|-------|
| Tax::swap_* | User | N/A (user signs) | - |
| Tax::swap_exempt | Epoch | carnage_signer | `["carnage_signer"]` |
| AMM::swap_* | Tax | swap_authority | `["swap_authority"]` |
| Staking::update_cumulative | Epoch | epoch_state | `["epoch_state"]` |
| Token::transfer (Carnage) | Epoch | carnage_*_vault | `["carnage_*_vault"]` |

---

## 10. Whitelist Requirements

The Transfer Hook whitelist MUST include these Carnage vaults:

| # | Address Type | Purpose |
|---|--------------|---------|
| 9 | Carnage CRIME vault | Receives CRIME from buys |
| 10 | Carnage FRAUD vault | Receives FRAUD from buys |

These are already specified in Transfer_Hook_Spec.md Section 4.

---

## 11. Build Order Recommendation

Based on dependency analysis:

### Phase 1: EpochState Core
1. Create Epoch Program skeleton
2. Implement EpochState account structure
3. Implement `initialize_epoch_state`
4. Implement epoch timing logic (slot-based)

**Why first:** Tax Program needs EpochState to read rates. This is the foundation.

### Phase 2: Tax Program Integration
5. Add `epoch_state` account to Tax Program swap instructions
6. Implement tax rate reading from EpochState
7. Implement `swap_exempt` instruction with carnage_signer validation

**Why second:** Enables taxed swaps to use dynamic rates from EpochState.

### Phase 3: VRF Integration
8. Add Switchboard SDK dependency
9. Implement `trigger_epoch_transition`
10. Implement `consume_randomness`
11. Implement `retry_epoch_vrf`
12. Build crank bot client code

**Why third:** VRF is complex; requires working Tax Program integration first.

### Phase 4: Carnage Implementation
13. Implement CarnageFundState and vaults
14. Implement `initialize_carnage_fund`
15. Implement atomic Carnage execution in consume_randomness
16. Implement fallback `execute_carnage`
17. Implement `expire_carnage`

**Why last:** Carnage uses the full CPI chain. All components must be working.

---

## 12. Testing Implications

### 12.1 CPI Depth Testing

Must verify:
- User swap path: depth 3 (passes)
- Carnage path: depth 4 (passes at limit)
- Any depth 5 path: MUST FAIL

### 12.2 VRF Testing

The v3 implementation verified on devnet includes:
- Anti-reroll protection (randomness account mismatch rejected)
- Stale randomness prevention (seed_slot freshness)
- Timeout recovery (retry after 300 slots)

### 12.3 Carnage Compute Budget

- Atomic execution: ~300k CU
- Two-instruction bundle: More headroom
- Must stay under 400k CU per instruction

---

## 13. Risk Factors

### 13.1 CPI Depth Violation
**Risk:** Adding any CPI level to Carnage path breaks protocol
**Mitigation:** Carnage MUST remain inlined in Epoch Program

### 13.2 VRF Oracle Dependency
**Risk:** Switchboard oracle unavailable
**Mitigation:** 300-slot timeout with retry mechanism; protocol continues with stale taxes

### 13.3 Tax Program ID Hardcoding
**Risk:** AMM has TAX_PROGRAM_ID hardcoded; any Tax Program change requires AMM redeploy
**Mitigation:** Get Tax Program ID right before mainnet; test extensively on devnet

---

## 14. Cross-References

| Topic | Source Document |
|-------|-----------------|
| Epoch state machine | Docs/Epoch_State_Machine_Spec.md |
| VRF implementation details | Docs/VRF_Implementation_Reference.md |
| VRF migration lessons | Docs/VRF_Migration_Lessons.md |
| Carnage logic | Docs/Carnage_Fund_Spec.md |
| Tax distribution | Docs/Tax_Pool_Logic_Spec.md |
| Transfer hook whitelist | Docs/Transfer_Hook_Spec.md |
| AMM access control | Docs/AMM_Implementation.md Section 18 |
| Protocol init sequence | Docs/Protocol_Initialzation_and_Launch_Flow.md |

---

## 15. Invariants

1. **CPI depth <= 4** - Carnage path is exactly at limit
2. **Epoch Program owns Carnage** - Cannot be separate program
3. **Tax Program gates AMM** - All swaps (including Carnage) route through Tax
4. **EpochState is single source of truth** - Tax rates read, never duplicated
5. **VRF is client-side** - Program never CPIs to Switchboard
6. **Anti-reroll is cryptographic** - Randomness account bound at commit
7. **Carnage never blocks epochs** - `carnage_pending` independent of `vrf_pending`

---

## Confidence Assessment

| Area | Confidence | Rationale |
|------|------------|-----------|
| CPI Depth | HIGH | Verified in existing specs; matches Solana docs |
| VRF Pattern | HIGH | v3 implementation proven on devnet |
| Tax Integration | HIGH | Mock Tax Program validates pattern |
| Account Structures | HIGH | Defined in authoritative specs |
| Carnage Execution | MEDIUM | Two-instruction bundle not yet tested |
| Compute Budget | MEDIUM | Estimates from spec; needs devnet validation |
