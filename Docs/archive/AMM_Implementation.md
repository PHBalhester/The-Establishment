# Dr. Fraudsworth’s Finance Factory
## AMM Implementation Specification

---

## 0. Purpose

This document defines the **Automated Market Maker (AMM)** used by the
Dr. Fraudsworth protocol.

The AMM is a **pure swap primitive**.

It:
- Executes constant-product swaps
- Applies LP fees
- Updates pool reserves
- Enforces Token-2022 transfer hooks
- Is callable directly or via CPI

It explicitly **does NOT**:
- Know about epochs
- Know about tax regimes
- Calculate or collect taxes
- Distribute yield
- Interact with the Carnage Fund

All taxation, epoch logic, yield accounting, and Carnage behavior live in
the **Tax Program**, which wraps AMM swaps via CPI.

---

## 1. Design Constraints (Hard)

The following constraints are non-negotiable:

- Protocol-owned liquidity only
- Exactly four pools
- No liquidity deposits
- No liquidity withdrawals
- No admin swap privileges
- No mutable configuration after initialization
- AMM must be tax-agnostic
- AMM must be safely callable via CPI

---

## 2. Base Implementation

### 2.1 Fork Source

- Repository: `arrayappy/solana-uniswap-v2`
- Framework: Anchor
- License: Apache-2.0

### 2.2 Rationale

- Minimal Uniswap-V2-style design
- Small, auditable code surface
- Clean PDA patterns
- Easy to adapt for Token-2022

---

## 3. Token Standards

### 3.1 Tokens

| Token | Standard | Token Program | Transfer Hook |
|------|----------|---------------|---------------|
| CRIME  | Token-2022 | Token-2022 Program | Yes |
| FRAUD  | Token-2022 | Token-2022 Program | Yes |
| PROFIT  | Token-2022 | Token-2022 Program | Yes |
| SOL  | WSOL (wrapped) | **SPL Token Program** | No |

> **Note:** WSOL uses the original SPL Token program (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`), NOT Token-2022. This is critical because SPL Token has no transfer hook support. See `Docs/Token_Program_Reference.md` for the authoritative token program matrix.

### 3.2 Pool Matrix

| Pool | Token A | Token B | Type | Notes |
|------|---------|---------|------|-------|
| CRIME / SOL | Token-2022 | SPL Token | Mixed | WSOL side has no hook protection |
| FRAUD / SOL | Token-2022 | SPL Token | Mixed | WSOL side has no hook protection |
| CRIME / PROFIT | Token-2022 | Token-2022 | T22 / T22 | Both sides have hook protection |
| FRAUD / PROFIT | Token-2022 | Token-2022 | T22 / T22 | Both sides have hook protection |

> **Note:** "Mixed" means Token-2022 + SPL Token programs are both required. The SPL Token side (WSOL) cannot have transfer hooks.

---

## 4. Pool Architecture

### 4.1 Pool Types

The AMM supports exactly four pool types:

- CRIME / SOL
- FRAUD / SOL
- CRIME / PROFIT
- FRAUD / PROFIT

These are encoded using a fixed `PoolType` enum.

### 4.2 Pool State

Each pool stores:

- Pool type
- Token A mint
- Token B mint
- Token A vault
- Token B vault
- Cached reserves
- LP fee (basis points)
- Initialization flag

> **Note:** Cached reserves are authoritative for swap math and must be
> kept in sync with vault balances.

### 4.3 Pool State Size Calculation

| Field | Type | Size (bytes) |
|-------|------|--------------|
| discriminator | [u8; 8] | 8 |
| pool_type | PoolType (enum) | 1 |
| token_a_mint | Pubkey | 32 |
| token_b_mint | Pubkey | 32 |
| vault_a | Pubkey | 32 |
| vault_b | Pubkey | 32 |
| reserve_a | u64 | 8 |
| reserve_b | u64 | 8 |
| lp_fee_bps | u16 | 2 |
| initialized | bool | 1 |
| bump | u8 | 1 |
| **Total** | | **157 bytes** |

**Rent Calculation:**
- Minimum balance for rent exemption: ~0.00114 SOL (at 157 bytes)
- Calculated via `Rent::get()?.minimum_balance(157)`

**Anchor Space Constraint:**

```rust
#[account(
    init,
    payer = authority,
    space = 8 + 1 + 32 + 32 + 32 + 32 + 8 + 8 + 2 + 1 + 1, // 157 bytes
    seeds = [b"pool", token_a_mint.key().as_ref(), token_b_mint.key().as_ref()],
    bump
)]
pub pool: Account<'info, PoolState>,
```

> **Note:** If additional fields are added in future versions, update both the struct definition and the space calculation. Under-allocation causes account creation failure; over-allocation wastes SOL on rent.

---

## 5. PDA Derivations

### 5.1 Pool PDA

Pool state accounts are PDAs derived from:

```
["pool", token_a_mint, token_b_mint]
```

Token mints must be **canonically ordered** to avoid duplicate pools.

### 5.2 Vault PDAs

Each pool has two vaults:

```
["vault", pool_pubkey, "a"]
["vault", pool_pubkey, "b"]
```

Vaults are owned by the **pool PDA**, never by an admin or user.

---

## 6. Pool Initialization

Pool initialization:

- Is callable exactly once per pool
- Is restricted to the protocol initializer
- Creates the pool state PDA
- Creates both vault token accounts
- Seeds initial liquidity
- Sets the LP fee:
  - 1% (100 bps) for SOL pools
  - 0.5% (50 bps) for PROFIT pools
- Marks the pool as initialized

No post-initialization mutation is permitted.

---

## 7. Swap Interface

### 7.1 Instructions

The AMM exposes two swap instructions:

- `swap_sol_pool`
- `swap_profit_pool`

Both instructions route to the same internal math and transfer helpers.

### 7.2 Responsibility Boundary

The AMM:
- Validates inputs
- Applies LP fees
- Executes constant-product math
- Transfers tokens
- Updates reserves

The AMM never:
- Reads epoch state
- Applies taxes
- Emits yield information

---

## 8. Swap Math

### 8.1 Formula

After LP fee:

```
effective_input = amount_in × (10_000 − lp_fee_bps) / 10_000
```

Output:

```
amount_out = reserve_out × effective_input / (reserve_in + effective_input)
```

### 8.2 Invariants

- Use `u128` for intermediate math
- Round down for outputs
- Enforce `k_after ≥ k_before`
- Abort on overflow

---

## 9. Token Transfers

### 9.1 SPL Token Transfers (WSOL Side)

- WSOL uses the **SPL Token program** (NOT Token-2022)
- Use standard SPL `transfer` instruction
- No transfer hooks possible (SPL Token program does not support hooks)
- Pool PDA signs when transferring from vault
- Vault security relies on AMM access control, not hook-based whitelist

### 9.2 Token-2022 Transfers

- Use `transfer_checked`
- Must include:
  - Token-2022 program
  - Transfer-hook program
  - ExtraAccountMetaList PDA
- Vaults must be whitelisted in the hook program

### 9.3 Mixed Pools (CRIME/SOL, FRAUD/SOL)

SOL pools require **both** token programs because WSOL uses SPL Token (not Token-2022):
- **SPL Token program** (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`) for WSOL side
- **Token-2022 program** (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`) for CRIME/FRAUD side

Transfer routing is conditional on token side:
- CRIME/FRAUD transfers: Use `transfer_checked` with hook support
- WSOL transfers: Use standard SPL `transfer` (no hooks)

---

## 10. Swap Execution Flow

1. Validate input amount > 0  
2. Validate pool is initialized  
3. Validate mints and vaults  
4. Calculate LP fee  
5. Compute output amount  
6. Transfer input token to vault  
7. Transfer output token to user  
8. Update cached reserves  
9. Emit swap event  

Use checks-effects-interactions ordering.

---

## 11. Instruction Accounts

### 11.1 Common Accounts

- User (signer)
- Pool state PDA (mutable)
- User input token account
- User output token account
- Input vault
- Output vault
- Input mint
- Output mint

### 11.2 Programs

- SPL token program (SOL pools)
- Token-2022 program
- Transfer-hook program
- ExtraAccountMetaList PDA

PROFIT pools require hook handling for **both tokens**.

---

## 12. Errors

The AMM must define explicit error codes, including:

- PoolNotInitialized
- InvalidPoolType
- InvalidMint
- VaultMismatch
- ZeroAmount
- SlippageExceeded
- InvariantViolation
- Overflow
- Unauthorized
- TransferFailed

All failures must revert atomically.

---

## 13. Events

### 13.1 Swap Event

Emitted on every successful swap:

- Pool
- User
- Input mint
- Output mint
- Amount in
- Amount out
- LP fee
- Post-swap reserves
- Timestamp

### 13.2 Pool Initialized Event

Emitted once per pool:

- Pool
- Pool type
- Token mints
- Initial reserves

---

## 14. Security Considerations

### 14.1 Reentrancy

- Transfer hooks may execute arbitrary logic
- State updates must occur before external calls
- Consider a reentrancy guard if required

### 14.2 Authority

- No liquidity withdrawal
- No admin swaps
- No mutable config
- All vaults PDA-owned

---

## 15. Integration Contract

### 15.1 Tax Program

The Tax Program:
- Computes taxes
- Withholds SOL
- Calls AMM swaps via CPI
- Distributes tax proceeds

The AMM exposes a **minimal, stable CPI interface**.

### 15.2 Transfer Hook Program

- Enforces whitelist rules
- Ensures only pool vaults receive T22 tokens
- AMM does not interpret hook logic

---

## 16. Testing Requirements

### Unit Tests
- Math correctness
- Fee application
- Rounding behavior
- Overflow protection

### Integration Tests
- All four pool types
- All swap directions
- Mixed T22 / SPL flows
- Hook enforcement
- CPI-initiated swaps

### Negative Tests
- Zero input
- Wrong mint
- Wrong vault
- Slippage exceeded
- Uninitialized pool

---

## 17. Invariants Summary

- AMM is a pure swap engine
- No protocol logic leaks into AMM
- Liquidity is permanent
- Fees are deterministic
- All economic complexity lives outside the AMM

Section X: Access Control

## 18. Caller Authorization

All swap instructions require a signature from the Tax Program PDA.

**Rationale:** Prevents users from calling the AMM directly to bypass taxes.

**Implementation:**

​```rust
#[account(
    seeds = [b"swap_authority"],
    bump,
    seeds::program = TAX_PROGRAM_ID,
)]
pub swap_authority: Signer<'info>,
​```

The Tax Program invokes AMM swap instructions using `invoke_signed` with its PDA as signer.

**Implications:**
- AMM cannot be called directly by users or other programs
- All swaps must route through Tax Program
- Tax Program's exempt instruction (for Carnage) still requires this signature
- This is cryptographically enforced, not logic-enforced

---

## Audit Trail

- **Updated:** T22/WSOL validation (Phase 2 audit) - Added explicit SPL Token clarifications for WSOL, updated token tables with token program column, clarified mixed pool dual-program requirements
- **Updated:** Added Pool State size calculation (Phase 5 convergence - 05-05) - 2026-02-03