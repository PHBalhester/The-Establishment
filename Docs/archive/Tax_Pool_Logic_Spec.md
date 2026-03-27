# Dr. Fraudsworth’s Finance Factory  
*Tax & Pool Logic Specification (Canonical Execution Spec)*

---

## 1. Purpose & Scope

This document defines the **mechanical execution rules** for:
- SOL-pool taxation
- PROFIT yield funding (via Staking Program)
- Epoch transitions
- Tax regime selection
- Carnage Fund behavior
- Yield distribution via staking

This document is **implementation-facing**.
Narrative explanations live in `DrFraudsworthOverview.md`.

**Terminology:** Throughout this document, "IP token" is used as a collective noun meaning **either CRIME or FRAUD** — the two tokens that share the same protocol role as SOL-paired, taxed assets. When a section applies to both tokens identically, "IP" avoids repeating "CRIME or FRAUD" in every reference. PROFIT is always named explicitly.

---

## 2. Account Architecture

The Tax Program is a **stateless routing layer** that reads tax configuration from the Epoch Program's EpochState account and routes swap transactions through the AMM with proper tax collection and distribution.

### 2.1 Design Philosophy: Stateless

The Tax Program does not maintain its own state account because:
- **Tax configuration** is owned by EpochState (single source of truth)
- **Pool state** is owned by the AMM Program
- **Distribution targets** (escrow, carnage, treasury) are external accounts

This design eliminates state synchronization complexity and reduces account rent requirements.

### 2.2 swap_authority PDA

The Tax Program owns a Program Derived Address that signs AMM swap invocations. This is a **signer-only PDA** with no data storage.

```rust
// PDA Derivation
seeds = ["swap_authority"]
program = tax_program

// The swap_authority PDA:
// - Has no associated data account
// - Signs CPI calls to AMM Program
// - Enables AMM to validate swaps come from Tax Program
// - Is automatically derived (no initialization needed)
```

**Purpose:**
The AMM Program accepts swap calls only from whitelisted authorities. The swap_authority PDA proves to the AMM that:
1. The swap request originates from the Tax Program
2. Tax collection logic has been properly executed
3. Distribution splits have been applied

**Access Control Pattern:**
```rust
// In Tax Program swap instruction
let swap_authority_seeds: &[&[u8]] = &[
    b"swap_authority",
    &[ctx.bumps.swap_authority],
];

// CPI to AMM with PDA signature
invoke_signed(
    &amm_swap_instruction,
    &[...accounts...],
    &[swap_authority_seeds],
)?;
```

### 2.3 Cross-Program References

The Tax Program reads from and writes to accounts owned by other programs:

| Account | Owner Program | Access | Purpose |
|---------|---------------|--------|---------|
| EpochState | Epoch Program | Read | Current tax rates |
| Pool | AMM Program | Read/CPI | Pool state, swap execution |
| pool_vault_a | Token Program | CPI | Pool liquidity (via AMM) |
| pool_vault_b | Token Program | CPI | Pool liquidity (via AMM) |
| staking_escrow | Staking Program | CPI | 75% tax destination |
| carnage_vault | System Program | Transfer | 24% tax destination (native SOL) |
| treasury | System Program | Transfer | 1% tax destination (native SOL) |

### 2.4 Token Program References

Swaps involve two different token programs depending on the pool:

| Pool Type | Input Token | Output Token | Input Program | Output Program |
|-----------|-------------|--------------|---------------|----------------|
| CRIME/SOL (buy) | WSOL | CRIME | SPL Token | Token-2022 |
| CRIME/SOL (sell) | CRIME | WSOL | Token-2022 | SPL Token |
| FRAUD/SOL (buy) | WSOL | FRAUD | SPL Token | Token-2022 |
| FRAUD/SOL (sell) | FRAUD | WSOL | Token-2022 | SPL Token |
| CRIME/PROFIT | CRIME/PROFIT | PROFIT/CRIME | Token-2022 | Token-2022 |
| FRAUD/PROFIT | FRAUD/PROFIT | PROFIT/FRAUD | Token-2022 | Token-2022 |

**Critical Note:** WSOL uses SPL Token (not Token-2022). All IP tokens (CRIME, FRAUD, PROFIT) use Token-2022 with transfer hooks. See `Token_Program_Reference.md` for complete token program compatibility matrix.

---

## 3. Fee & Tax Structure

### 3.1 Pools

| Pool        | LP Fee | Tax (Buy) | Tax (Sell) |
|-------------|--------|-----------|------------|
| CRIME / SOL   | 1%     | Variable  | Variable   |
| FRAUD / SOL   | 1%     | Variable  | Variable   |
| CRIME / PROFIT   | 0.5%   | None      | None       |
| FRAUD / PROFIT   | 0.5%   | None      | None       |

LP fees **always apply** and compound into pool reserves.

Taxes apply **only** to SOL pools.

---

## 4. SOL-Denominated Tax Design

All taxes are collected in **native SOL**.

- **BUY (SOL → IP)**: tax deducted from SOL input (after LP fee)
- **SELL (IP → SOL)**: tax deducted from SOL output

Rationale:
- PROFIT yield is paid in SOL
- Carnage Fund operates in SOL
- Treasury holds SOL
- Avoids conversion complexity and hidden slippage

---

## 5. Tax Distribution Split

Collected SOL tax is split immediately:

- **75% → Staking Program Escrow** (for PROFIT stakers)
- **24% → Carnage Fund**
- **1% → Treasury Multisig**

No tax accumulation occurs inside swap logic.

---

## 6. Tax Regime Model (Critical)

The protocol operates under a **single global tax regime per epoch**.

### 6.1 Regime Properties

- Exactly **one IP token is the “cheap side”**
- Cheap side:
  - Low buy tax
  - High sell tax
- Expensive side:
  - High buy tax
  - Low sell tax
- All four SOL-pool tax rates are **derived from this single regime**

**Independent tax rolls are explicitly disallowed.**

This coherence is required for:
- Predictable soft-peg bounds
- Stable arbitrage loops
- Economic symmetry between CRIME and FRAUD

---

## 7. Tax Bands

- **Low tax:** 1–4% (100–400 bps)
- **High tax:** 11–14% (1100–1400 bps)
- Zero tax is never possible
- Values are sampled uniformly within each band

---

## 8. Epoch System

### 8.1 Epoch Timing
- Epoch length: **30 minutes**

### 8.2 Epoch Transition Sequence

At epoch boundary:

1. Request randomness from **Switchboard VRF**
2. On VRF callback:
   - Determine regime flip
   - Sample new low/high tax magnitudes
3. Activate new tax configuration
4. Evaluate Carnage Fund trigger
5. Update Staking Program cumulative rewards (via CPI to `staking_program::update_cumulative`)

Yield is **added to cumulative**, not pushed to users, at this stage.

---

## 9. Tax Regime Flip Logic

### 9.1 Flip Probability
- **75% chance** to flip the cheap side
- Flip applies to the **entire regime**
- Either all four taxes flip together or none do

### 9.2 Tax Roll Pseudocode

```rust
fn roll_new_taxes(
    vrf: [u8; 32],
    current_cheap: Token
) -> TaxConfig {
    let flip = vrf[0] < 192; // 75%
    let low = 100 + ((vrf[1] % 4) * 100);
    let high = 1100 + ((vrf[2] % 4) * 100);

    let cheap = if flip {
        current_cheap.opposite()
    } else {
        current_cheap
    };

    match cheap {
        Token::CRIME => TaxConfig {
            crime_buy: low,
            crime_sell: high,
            fraud_buy: high,
            fraud_sell: low,
        },
        Token::FRAUD => TaxConfig {
            crime_buy: high,
            crime_sell: low,
            fraud_buy: low,
            fraud_sell: high,
        },
    }
}
```

Low/high magnitudes are resampled every epoch even if no flip occurs.

---

## 10. Swap Instructions

This section defines the complete account lists for each Tax Program swap instruction. All swaps are routed through the Tax Program, which enforces tax collection before delegating to the AMM.

### 10.1 Common Account Pattern

All swap instructions share a common set of accounts with variations based on pool type:

| Category | SOL Pools | PROFIT Pools |
|----------|-----------|--------------|
| Tax applied | Yes | No |
| Tax destinations | staking_escrow, carnage_vault, treasury | None |
| Input token program | SPL Token (WSOL) or Token-2022 | Token-2022 |
| Output token program | Token-2022 or SPL Token (WSOL) | Token-2022 |

### 10.2 swap_sol_buy (SOL -> CRIME or SOL -> FRAUD)

Buy IP token with SOL. Tax deducted from SOL input.

| Account | Type | Description |
|---------|------|-------------|
| user | Signer | The trader initiating the swap |
| epoch_state | Account | EpochState PDA - source of current tax rates (Epoch Program) |
| pool | Mut PDA | AMM pool state for CRIME/SOL or FRAUD/SOL (AMM Program) |
| user_wsol_account | Mut | User's WSOL Associated Token Account |
| user_ip_account | Mut | User's CRIME or FRAUD Associated Token Account |
| pool_wsol_vault | Mut | Pool's WSOL vault |
| pool_ip_vault | Mut | Pool's CRIME or FRAUD vault |
| staking_escrow | Mut | Staking Program escrow - receives 75% of tax |
| carnage_vault | Mut | Carnage Fund SOL vault - receives 24% of tax |
| treasury | Mut | Protocol treasury multisig - receives 1% of tax |
| swap_authority | PDA | Tax Program PDA that signs AMM CPI calls |
| amm_program | Program | AMM program ID |
| token_program | Program | SPL Token program (for WSOL) |
| token_2022_program | Program | Token-2022 program (for CRIME/FRAUD) |
| system_program | Program | System program (for native SOL transfers) |

**Constraints:**
- `epoch_state` must be valid EpochState PDA from Epoch Program
- `pool` must be CRIME/SOL or FRAUD/SOL pool (determined by IP token mint)
- `user_wsol_account` must be owned by `user`
- `user_ip_account` must be owned by `user`
- All vaults must match pool configuration

### 10.3 swap_sol_sell (CRIME -> SOL or FRAUD -> SOL)

Sell IP token for SOL. Tax deducted from SOL output.

| Account | Type | Description |
|---------|------|-------------|
| user | Signer | The trader initiating the swap |
| epoch_state | Account | EpochState PDA - source of current tax rates (Epoch Program) |
| pool | Mut PDA | AMM pool state for CRIME/SOL or FRAUD/SOL (AMM Program) |
| user_ip_account | Mut | User's CRIME or FRAUD Associated Token Account |
| user_wsol_account | Mut | User's WSOL Associated Token Account |
| pool_ip_vault | Mut | Pool's CRIME or FRAUD vault |
| pool_wsol_vault | Mut | Pool's WSOL vault |
| staking_escrow | Mut | Staking Program escrow - receives 75% of tax |
| carnage_vault | Mut | Carnage Fund SOL vault - receives 24% of tax |
| treasury | Mut | Protocol treasury multisig - receives 1% of tax |
| swap_authority | PDA | Tax Program PDA that signs AMM CPI calls |
| amm_program | Program | AMM program ID |
| token_2022_program | Program | Token-2022 program (for CRIME/FRAUD) |
| token_program | Program | SPL Token program (for WSOL) |
| system_program | Program | System program (for native SOL transfers) |

**Constraints:**
- Same constraints as `swap_sol_buy`, with input/output reversed
- Tax calculated from gross SOL output, then deducted before user receives

### 10.4 swap_profit_buy (CRIME -> PROFIT or FRAUD -> PROFIT)

Buy PROFIT with IP token. No tax - LP fee only.

| Account | Type | Description |
|---------|------|-------------|
| user | Signer | The trader initiating the swap |
| pool | Mut PDA | AMM pool state for CRIME/PROFIT or FRAUD/PROFIT (AMM Program) |
| user_input_account | Mut | User's CRIME or FRAUD Associated Token Account |
| user_output_account | Mut | User's PROFIT Associated Token Account |
| pool_input_vault | Mut | Pool's CRIME or FRAUD vault |
| pool_output_vault | Mut | Pool's PROFIT vault |
| swap_authority | PDA | Tax Program PDA that signs AMM CPI calls |
| amm_program | Program | AMM program ID |
| token_2022_program | Program | Token-2022 program (for all tokens) |

**Note:** No `epoch_state`, `staking_escrow`, `carnage_vault`, or `treasury` accounts required - PROFIT pools are untaxed.

**Constraints:**
- `pool` must be CRIME/PROFIT or FRAUD/PROFIT pool
- LP fee (0.5%) applied to input amount
- Both input and output use Token-2022 (all IP tokens are Token-2022)

### 10.5 swap_profit_sell (PROFIT -> CRIME or PROFIT -> FRAUD)

Sell PROFIT for IP token. No tax - LP fee only.

| Account | Type | Description |
|---------|------|-------------|
| user | Signer | The trader initiating the swap |
| pool | Mut PDA | AMM pool state for CRIME/PROFIT or FRAUD/PROFIT (AMM Program) |
| user_input_account | Mut | User's PROFIT Associated Token Account |
| user_output_account | Mut | User's CRIME or FRAUD Associated Token Account |
| pool_input_vault | Mut | Pool's PROFIT vault |
| pool_output_vault | Mut | Pool's CRIME or FRAUD vault |
| swap_authority | PDA | Tax Program PDA that signs AMM CPI calls |
| amm_program | Program | AMM program ID |
| token_2022_program | Program | Token-2022 program (for all tokens) |

**Note:** Same structure as `swap_profit_buy` with input/output reversed.

**Constraints:**
- `pool` must be CRIME/PROFIT or FRAUD/PROFIT pool
- LP fee (0.5%) applied to input amount

### 10.6 Pool Type Differences Summary

| Instruction | Tax Accounts | Token Programs | CPI Depth |
|-------------|--------------|----------------|-----------|
| swap_sol_buy | epoch_state, escrow, carnage, treasury | SPL Token + Token-2022 | 3 (with hook) |
| swap_sol_sell | epoch_state, escrow, carnage, treasury | Token-2022 + SPL Token | 3 (with hook) |
| swap_profit_buy | None | Token-2022 only | 3 (with hooks on both sides) |
| swap_profit_sell | None | Token-2022 only | 3 (with hooks on both sides) |

### 10.7 Transfer Hook Integration

For Token-2022 transfers (CRIME, FRAUD, PROFIT), the Token-2022 program internally invokes the Transfer Hook program. This adds one CPI level:

```
Tax Program::swap_*
  |-> AMM Program::swap (depth 1)
      |-> Token-2022::transfer_checked (depth 2)
          |-> Transfer Hook Program::execute (depth 3)
```

The Transfer Hook validates that source/destination are whitelisted. See `Transfer_Hook_Spec.md` for whitelist details.

---

## 11. CPI Depth Analysis

This section documents the complete CPI chains for each swap variant, including all nested program invocations. Understanding CPI depth is critical because Solana enforces a hard limit of 4 CPI levels.

### 11.1 swap_sol_buy CPI Chain

```
Tax Program::swap_sol_buy (entry point)
  └─> AMM Program::swap_sol_pool (depth 1)
      ├─> Token-2022::transfer_checked (depth 2) [CRIME/FRAUD output]
      │   └─> Transfer Hook Program::execute (depth 3)
      └─> SPL Token::transfer (depth 2) [WSOL input, no hook]
  └─> Staking Program::deposit_rewards (depth 1, parallel path)
      └─> System Program::transfer (depth 2)
```

**Max Depth:** 3 (CRIME/FRAUD path with hook)

### 11.2 swap_sol_sell CPI Chain

```
Tax Program::swap_sol_sell (entry point)
  └─> AMM Program::swap_sol_pool (depth 1)
      ├─> Token-2022::transfer_checked (depth 2) [CRIME/FRAUD input]
      │   └─> Transfer Hook Program::execute (depth 3)
      └─> SPL Token::transfer (depth 2) [WSOL output, no hook]
  └─> Staking Program::deposit_rewards (depth 1, parallel path)
      └─> System Program::transfer (depth 2)
```

**Max Depth:** 3 (CRIME/FRAUD path with hook)

### 11.3 swap_profit_buy / swap_profit_sell CPI Chain

```
Tax Program::swap_profit_buy (entry point)
  └─> AMM Program::swap (depth 1)
      ├─> Token-2022::transfer_checked (depth 2) [CRIME/FRAUD side]
      │   └─> Transfer Hook Program::execute (depth 3)
      └─> Token-2022::transfer_checked (depth 2) [PROFIT side]
          └─> Transfer Hook Program::execute (depth 3)
```

**Max Depth:** 3 (both sides have hooks)

**Note:** No staking deposit CPI on PROFIT pool swaps because PROFIT pools are untaxed.

### 11.4 Depth Summary

| Instruction | Max CPI Depth | Limiting Path |
|-------------|---------------|---------------|
| swap_sol_buy | 3 | Token-2022 -> Transfer Hook |
| swap_sol_sell | 3 | Token-2022 -> Transfer Hook |
| swap_profit_buy | 3 | Token-2022 -> Transfer Hook (both sides) |
| swap_profit_sell | 3 | Token-2022 -> Transfer Hook (both sides) |

**Important:** User-initiated swaps through the Tax Program max at depth 3. Carnage execution (triggered via Epoch Program VRF callback) adds one more level, reaching depth 4 -- the Solana hard limit. See `Carnage_Fund_Spec.md` Section 2 for the full Carnage CPI depth analysis and architectural constraint documentation.

---

## 12. Compute Budget Analysis

Compute unit (CU) estimates for each swap variant, accounting for CPI overhead, transfer hooks, and tax distribution. These estimates help frontend clients set appropriate `ComputeBudgetInstruction::set_compute_unit_limit` values.

| Operation | CPI Chain | Estimated CU | Notes |
|-----------|-----------|--------------|-------|
| swap_sol_buy (CRIME) | Tax->AMM->T22->Hook | ~120k | Hook adds ~30k CU |
| swap_sol_sell (CRIME) | Tax->AMM->SPL+T22->Hook | ~130k | Mixed token programs add overhead |
| swap_sol_buy (FRAUD) | Tax->AMM->T22->Hook | ~120k | Same as CRIME |
| swap_sol_sell (FRAUD) | Tax->AMM->SPL+T22->Hook | ~130k | Same as CRIME |
| swap_profit_buy | Tax->AMM->T22->Hook x2 | ~150k | Both sides have hooks |
| swap_profit_sell | Tax->AMM->T22->Hook x2 | ~150k | Both sides have hooks |

**Breakdown of major CU consumers:**
- AMM constant-product computation: ~20k CU
- Token-2022 `transfer_checked`: ~30k CU per transfer
- Transfer Hook `execute`: ~30k CU per hook invocation
- Tax calculation + distribution (3 transfers): ~20k CU
- Account deserialization + validation: ~10k CU

**Recommendations:**
- Frontend should request **200k CU** for all standard swaps (provides ~40% safety margin)
- Request **300k CU** for complex multi-hop trades (e.g., SOL -> CRIME -> PROFIT)
- Carnage execution has a dedicated **260k CU** budget (see Epoch_State_Machine_Spec.md Section 14.5)

**Note:** These are estimates based on expected program complexity. Actual values will be determined during implementation and testing. The 200k CU recommendation stays within Solana's default transaction compute budget (200k) but should be explicitly set to avoid future default changes.

---

## 13. CPI Authority Chain

This section documents which PDA signs each CPI invocation. Incorrect signers cause immediate transaction failure, so this mapping is critical for implementation.

### 13.1 User Swap Flow

```
Tax Program::swap_sol_buy
  User signs ──────────────────────────────────────────────┐
  │                                                         │
  └─> AMM::swap                                             │
      Tax PDA signs as swap_authority ────────────────┐    │
      │                                                │    │
      └─> Token-2022::transfer_checked [user -> pool]  │    │
          User signs (via instruction signer) ─────────┘    │
      └─> Token-2022::transfer_checked [pool -> user]       │
          Pool PDA signs via AMM program                     │
```

**Why user signs twice:** The user is the original transaction signer, and that signature propagates through CPI. The user signs the top-level instruction; the AMM uses that signature for the user's token transfer.

### 13.2 Carnage Execution Flow (Permissionless)

```
Epoch Program::execute_carnage_inner (no user signer - permissionless)
  │
  └─> Tax Program::swap_exempt
      Carnage PDA signs ──────────────────────────────┐
      │                                                │
      └─> AMM::swap                                    │
          Tax PDA signs ──────────────────────────┐   │
          │                                        │   │
          └─> Token transfers                      │   │
              Carnage vault PDA or Pool PDA signs ─┘   │
                                                       │
```

**Why no user signer:** Carnage execution is permissionless (anyone can crank it). The Carnage PDA (derived by Epoch Program) serves as the authority. The Tax Program's `swap_exempt` instruction validates the Carnage PDA signer instead of requiring a user signature.

### 13.3 Key Signers

| PDA | Seeds | Program | Signs For |
|-----|-------|---------|-----------|
| swap_authority | `["swap_authority"]` | Tax Program | AMM swap invocation |
| carnage_signer | `["carnage_signer"]` | Epoch Program | Tax::swap_exempt invocation |
| pool_authority | `["pool", pool_id]` | AMM Program | Token transfers from pool vaults |
| carnage_sol_vault | `["carnage_sol"]` | Epoch Program | SOL transfers for Carnage buys |
| carnage_token_vault | `["carnage_token", mint]` | Epoch Program | Token transfers for Carnage sells/burns |

**Signing chain summary:** Each CPI level requires the calling program's PDA to sign. The chain of trust flows: User -> Tax PDA -> AMM PDA -> Token Program. For Carnage: Epoch PDA -> Tax PDA -> AMM PDA -> Token Program.

---

## 14. SOL Pool Swap Logic

### 14.1 Constants

```rust
LP_FEE_BPS = 100
BPS_DENOMINATOR = 10_000
```

### 14.2 BUY: SOL → IP

Order of operations:

1. LP fee (1%) from SOL input
2. Tax from remaining SOL
3. AMM swap
4. Update reserves
5. Distribute tax

### 14.3 SELL: IP → SOL

Order of operations:

1. LP fee (1%) from IP input
2. AMM swap (gross SOL)
3. Tax from SOL output
4. Update reserves
5. Distribute tax

---

## 15. PROFIT Pool Swap Logic

- LP fee only (0.5%)
- No taxes
- Standard constant-product AMM

---

## 16. AMM Pricing Function

```rust
fn compute_swap_output(
    reserve_in: u64,
    reserve_out: u64,
    amount_in: u64
) -> u64 {
    (reserve_out * amount_in) / (reserve_in + amount_in)
}
```

---

## 17. Carnage Fund

### 17.1 Properties

- Funded by 24% of SOL taxes
- Holds SOL and, temporarily, IP tokens
- Tax-exempt (LP fees still apply)

### 17.2 Trigger

1/24 chance per epoch

### 17.3 Execution Logic

If holding IP tokens:

- 98%: burn tokens
- 2%: sell to SOL

Select CRIME or FRAUD via VRF

Market-buy selected token with all SOL

Hold purchased tokens until next trigger

Carnage introduces deflation, volatility, and large arbitrage windows.

---

## 18. PROFIT Yield System (Staking-Based)

### 18.1 Yield Source

75% of SOL taxes per epoch, deposited to Staking Program via `deposit_rewards` CPI.

### 18.2 Eligibility

**Only staked PROFIT earns yield.** Holding PROFIT without staking does not earn.

PROFIT held in protocol pool vaults is excluded (cannot stake).

### 18.3 Distribution Mechanism: Staking Program

Yield is distributed via cumulative reward-per-token pattern.

Process:

1. Tax Program deposits 75% of taxes to Staking Program escrow
2. At epoch end, Epoch Program calls `staking_program::update_cumulative`
3. Cumulative reward-per-token increases
4. Users claim SOL rewards at any time

Properties:

- Claims are permissionless
- Claims never expire
- Claimant pays transaction fees
- Instant unstake (no lockup)

**See `Docs/New_Yield_System_Spec.md` for complete specification.**

---

## 19. Error Handling

All Tax Program instructions return specific error codes for debugging and user-facing error messages. This follows the same pattern as `Epoch_State_Machine_Spec.md` Section 11.

```rust
#[error_code]
pub enum TaxError {
    #[msg("Invalid pool type for this operation")]
    InvalidPoolType,

    #[msg("Tax calculation overflow")]
    TaxOverflow,

    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,

    #[msg("Invalid epoch state - cannot determine tax rates")]
    InvalidEpochState,

    #[msg("Insufficient input amount for swap")]
    InsufficientInput,

    #[msg("Output amount below minimum")]
    OutputBelowMinimum,

    #[msg("Invalid swap authority PDA")]
    InvalidSwapAuthority,

    #[msg("Token program mismatch - expected SPL Token for WSOL")]
    WsolProgramMismatch,

    #[msg("Token program mismatch - expected Token-2022 for CRIME/FRAUD/PROFIT")]
    Token2022ProgramMismatch,

    #[msg("Invalid token account owner")]
    InvalidTokenOwner,

    #[msg("Carnage-only instruction called by non-Carnage authority")]
    UnauthorizedCarnageCall,
}
```

### 19.1 Error Conditions

| Error | Raised When |
|-------|-------------|
| `InvalidPoolType` | Instruction receives a pool that doesn't match the expected type (e.g., PROFIT pool passed to `swap_sol_buy`) |
| `TaxOverflow` | Tax calculation produces a value exceeding u64, typically from extreme tax rates or amounts |
| `SlippageExceeded` | The computed output amount is less than the user-specified `minimum_output` parameter |
| `InvalidEpochState` | EpochState account is not initialized, or epoch number is stale/invalid |
| `InsufficientInput` | Input amount is zero or too small to produce any output after fees and tax |
| `OutputBelowMinimum` | AMM output amount after tax deduction falls below the user's minimum threshold |
| `InvalidSwapAuthority` | The swap_authority PDA derivation does not match expected seeds `["swap_authority"]` |
| `WsolProgramMismatch` | A WSOL account is passed with Token-2022 program instead of SPL Token |
| `Token2022ProgramMismatch` | A CRIME/FRAUD/PROFIT account is passed with SPL Token instead of Token-2022 |
| `InvalidTokenOwner` | A token account's owner does not match the expected owner (user or pool PDA) |
| `UnauthorizedCarnageCall` | `swap_exempt` instruction called without valid Carnage PDA signer from Epoch Program |

---

## 20. Events

The Tax Program emits events for all swap operations to enable off-chain tracking and analytics.

### 20.1 TaxedSwap Event

Emitted after every successful taxed swap operation (SOL pool swaps only).

```rust
#[event]
pub struct TaxedSwap {
    /// The user performing the swap
    pub user: Pubkey,

    /// Pool type: SolCrime, SolFraud, CrimeProfit, FraudProfit
    pub pool_type: PoolType,

    /// Direction: Buy or Sell (relative to IP token)
    pub direction: SwapDirection,

    /// Input amount before tax
    pub input_amount: u64,

    /// Output amount after swap
    pub output_amount: u64,

    /// Total tax amount deducted
    pub tax_amount: u64,

    /// Tax rate in basis points (e.g., 400 = 4%)
    pub tax_rate_bps: u16,

    /// Portion sent to yield escrow (75%)
    pub yield_portion: u64,

    /// Portion sent to Carnage vault (24%)
    pub carnage_portion: u64,

    /// Portion sent to treasury (1%)
    pub treasury_portion: u64,

    /// Current epoch number
    pub epoch: u32,

    /// Slot of the transaction
    pub slot: u64,
}
```

### 20.2 SwapDirection Enum

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub enum SwapDirection {
    Buy,   // Buying IP token (CRIME/FRAUD/PROFIT)
    Sell,  // Selling IP token
}
```

### 20.3 UntaxedSwap Event

Emitted after every successful untaxed swap operation (PROFIT pool swaps only).

```rust
#[event]
pub struct UntaxedSwap {
    /// The user performing the swap
    pub user: Pubkey,

    /// Pool type: CrimeProfit or FraudProfit
    pub pool_type: PoolType,

    /// Direction: Buy or Sell (relative to PROFIT)
    pub direction: SwapDirection,

    /// Input amount
    pub input_amount: u64,

    /// Output amount after LP fee
    pub output_amount: u64,

    /// LP fee amount deducted
    pub lp_fee: u64,

    /// Slot of the transaction
    pub slot: u64,
}
```

### 20.4 Event Usage

**Off-chain indexers can use these events to:**
- Track total tax collected per epoch
- Calculate individual user swap history
- Monitor yield distribution accuracy
- Verify Carnage funding rates
- Build analytics dashboards

**Example Event Log (TaxedSwap):**
```json
{
  "name": "TaxedSwap",
  "data": {
    "user": "7xKX...abc",
    "pool_type": "SolCrime",
    "direction": "Buy",
    "input_amount": 1000000000,
    "output_amount": 980000000,
    "tax_amount": 40000000,
    "tax_rate_bps": 400,
    "yield_portion": 30000000,
    "carnage_portion": 9600000,
    "treasury_portion": 400000,
    "epoch": 42,
    "slot": 123456789
  }
}
```

---

## 21. Summary (Invariants)

- Taxes fund yield, carnage, and treasury only
- No emissions, no inflation
- All liquidity is permanent
- No admin intervention post-deployment
- Economic incentives rely solely on real trading friction


