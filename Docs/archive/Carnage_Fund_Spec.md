# Dr. Fraudsworth's Finance Factory
## Carnage Fund State & Execution Specification

---

## 1. Purpose

This document defines the **Carnage Fund** subsystem that injects controlled chaos, deflation, and volatility into the protocol.

The Carnage Fund:
- Accumulates 24% of all SOL taxes
- Triggers randomly (~1/24 epochs, ~2× daily)
- Market-buys CRIME or FRAUD with accumulated SOL
- Burns or sells held tokens on subsequent triggers
- Creates large, temporary arbitrage windows

This is an **economic chaos mechanism**. Its unpredictability is a feature, not a bug.

---

## 2. Architectural Decision

The Carnage Fund is **not a separate program**. It is implemented as:
- State accounts owned by the Epoch Program
- Execution logic inline within the Epoch Program

**Rationale:** CPI depth constraints. The decision to inline Carnage in the Epoch Program was made specifically to stay within Solana's CPI depth limit.

### CPI Depth Analysis

**Execution Path:**
```
Epoch::vrf_callback (entry point)
  |-> Tax::swap_exempt (depth 1)
      |-> AMM::swap (depth 2)
          |-> Token-2022::transfer_checked (depth 3)
              |-> Transfer Hook::execute (depth 4) -- SOLANA LIMIT
```

**Total CPI Depth:** 4 (exactly at Solana's hard limit)

> **ARCHITECTURAL CONSTRAINT -- PERMANENT**
>
> The Carnage execution path reaches the maximum CPI depth allowed by Solana (4).
> - No additional CPI calls can be added to this path
> - Future Token-2022 changes requiring more depth would break Carnage
> - This constraint is UNCHANGEABLE without redesigning the entire execution flow
> - The decision to inline Carnage in Epoch Program was made specifically to stay within this limit
>
> If Carnage were a separate program, the path would be:
> ```
> Carnage Program -> Epoch -> Tax -> AMM -> Token-2022 -> Hook = depth 5 (EXCEEDS LIMIT)
> ```

This depth analysis supersedes the earlier understanding of "3 CPI levels", which did not account for Token-2022's internal CPI to the Transfer Hook program.

---

## 3. Design Constraints (Hard)

- Carnage logic lives in Epoch Program
- State accounts are PDAs owned by Epoch Program
- Tax-exempt swaps only (1% LP fee, 0% tax)
- Maximum 1000 SOL per swap execution
- No admin intervention post-deployment
- All randomness from single VRF result
- Atomic execution preferred, fallback available

---

## 4. State Accounts

### 4.1 CarnageFundState

```rust
#[account]
pub struct CarnageFundState {
    /// PDA of the SOL vault
    pub sol_vault: Pubkey,
    
    /// PDA of the CRIME token vault
    pub crime_vault: Pubkey,
    
    /// PDA of the FRAUD token vault
    pub fraud_vault: Pubkey,
    
    /// Which token is currently held (None if vaults empty)
    pub held_token: Option<Token>,
    
    /// Amount of held token (0 if none)
    pub held_amount: u64,
    
    /// Last epoch when Carnage triggered
    pub last_trigger_epoch: u32,
    
    /// Lifetime statistics: total SOL spent on buys
    pub total_sol_spent: u64,
    
    /// Lifetime statistics: total CRIME burned
    pub total_crime_burned: u64,
    
    /// Lifetime statistics: total FRAUD burned
    pub total_fraud_burned: u64,
    
    /// Lifetime statistics: total triggers executed
    pub total_triggers: u32,
    
    /// Initialization flag
    pub initialized: bool,
    
    /// PDA bump seed
    pub bump: u8,
}
```

**Size:** 32 + 32 + 32 + 2 + 8 + 4 + 8 + 8 + 8 + 4 + 1 + 1 = 140 bytes (+ 8 discriminator = 148 bytes)

**Rent:** ~0.002 SOL

### 4.2 PDA Derivation (CarnageFundState)

```
seeds = ["carnage_fund"]
program = epoch_program
```

Single global account.

### 4.3 SOL Vault

```
seeds = ["carnage_sol_vault"]
program = epoch_program
```

Native SOL account (SystemAccount) controlled by Epoch Program PDA.

**Holds:** Accumulated SOL from 24% tax split.

### 4.4 CRIME Vault

```
seeds = ["carnage_crime_vault"]
program = epoch_program
```

Token-2022 account for CRIME tokens, owned by Epoch Program PDA.

**Holds:** CRIME tokens purchased by Carnage, awaiting burn/sell.

### 4.5 FRAUD Vault

```
seeds = ["carnage_fraud_vault"]
program = epoch_program
```

Token-2022 account for FRAUD tokens, owned by Epoch Program PDA.

**Holds:** FRAUD tokens purchased by Carnage, awaiting burn/sell.

---

## 5. Funding Flow

### 5.1 Tax Split

On every taxed SOL pool swap, the Tax Program splits collected taxes:

| Destination | Percentage | Recipient |
|-------------|------------|-----------|
| Yield Escrow | 75% | PROFIT holders |
| Carnage Fund | 24% | Carnage SOL vault |
| Treasury | 1% | Protocol multisig |

### 5.2 Deposit Instruction

The Tax Program deposits to Carnage via CPI:

```rust
pub fn deposit_to_carnage(
    ctx: Context<DepositToCarnage>,
    amount: u64,
) -> Result<()> {
    require!(amount > 0, CarnageError::ZeroAmount);
    
    // Transfer SOL from tax vault to carnage sol vault
    let transfer_ix = system_instruction::transfer(
        &ctx.accounts.tax_vault.key(),
        &ctx.accounts.carnage_sol_vault.key(),
        amount,
    );
    invoke_signed(&transfer_ix, &[...], &[tax_signer_seeds])?;
    
    emit!(CarnageFunded {
        amount,
        new_balance: ctx.accounts.carnage_sol_vault.lamports(),
    });
    
    Ok(())
}
```

**Note:** This is a simple SOL transfer. No state updates to CarnageFundState required on deposit—the vault balance is the source of truth.

---

## 6. VRF Byte Allocation

The Carnage Fund consumes bytes from the single VRF result shared with tax rolls:

| Byte | Purpose | Interpretation |
|------|---------|----------------|
| 3 | Carnage trigger | `< 11` (~4.3%, or 1/24) → trigger Carnage |
| 4 | Carnage action | `< 5` (2%) → sell held tokens; else → burn held tokens |
| 5 | Carnage buy target | `< 128` (50%) → buy CRIME; else → buy FRAUD |

Bytes 0-2 are consumed by tax regime logic (see Epoch_State_Machine_Spec.md).

Bytes 6-31 are reserved for future use.

---

## 7. Trigger Logic

### 7.1 Trigger Probability

```rust
const CARNAGE_TRIGGER_THRESHOLD: u8 = 11;  // ~4.3% = 11/256 ≈ 1/24

fn is_carnage_triggered(vrf_result: &[u8; 32]) -> bool {
    vrf_result[3] < CARNAGE_TRIGGER_THRESHOLD
}
```

**Expected frequency:** ~2 triggers per day (48 epochs × 4.3%)

### 7.2 Action Determination

```rust
const SELL_THRESHOLD: u8 = 5;  // 2% = 5/256 ≈ 1/50

fn get_carnage_action(vrf_result: &[u8; 32], has_holdings: bool) -> CarnageAction {
    if !has_holdings {
        return CarnageAction::BuyOnly;
    }
    
    if vrf_result[4] < SELL_THRESHOLD {
        CarnageAction::SellThenBuy
    } else {
        CarnageAction::BurnThenBuy
    }
}
```

### 7.3 Buy Target Determination

```rust
fn get_buy_target(vrf_result: &[u8; 32]) -> Token {
    if vrf_result[5] < 128 {
        Token::CRIME
    } else {
        Token::FRAUD
    }
}
```

**Note:** Buy target is VRF-determined regardless of which token is currently held. This means after a 2% sell, Carnage could immediately rebuy the same token it just sold.

---

## 8. Execution Paths

### 8.1 Path Overview

```
Carnage Triggered
    │
    ├─── Has Holdings? ───┬─── No ──→ [Buy Only]
    │                     │
    │                     └─── Yes ──→ VRF Action?
    │                                      │
    │                           ┌──────────┴──────────┐
    │                           │                     │
    │                      98% Burn              2% Sell
    │                           │                     │
    │                     [Burn Then Buy]      [Sell Then Buy]
    │
    └─── All Paths End With: Buy Target Token (VRF-determined)
```

### 8.2 Buy Only Path (No Holdings)

**Trigger:** First Carnage ever, or after a burn cleared holdings.

**Execution:**
1. Read SOL vault balance
2. Calculate swap amount: `min(sol_balance, MAX_SWAP_LAMPORTS)`
3. Execute tax-exempt swap: SOL → Target Token
4. Update state: `held_token = target`, `held_amount = tokens_received`

### 8.3 Burn Then Buy Path (98%)

**Trigger:** Carnage has holdings, VRF byte 4 ≥ 5.

**Execution:**
1. Burn all held tokens (CRIME or FRAUD)
2. Update stats: `total_X_burned += held_amount`
3. Clear holdings: `held_token = None`, `held_amount = 0`
4. Read SOL vault balance
5. Calculate swap amount: `min(sol_balance, MAX_SWAP_LAMPORTS)`
6. Execute tax-exempt swap: SOL → Target Token
7. Update state: `held_token = target`, `held_amount = tokens_received`

### 8.4 Sell Then Buy Path (2%)

**Trigger:** Carnage has holdings, VRF byte 4 < 5.

**Execution:**
1. Execute tax-exempt swap: Held Token → SOL
2. Clear holdings: `held_token = None`, `held_amount = 0`
3. Read SOL vault balance (now includes sale proceeds)
4. Calculate swap amount: `min(sol_balance, MAX_SWAP_LAMPORTS)`
5. Execute tax-exempt swap: SOL → Target Token
6. Update state: `held_token = target`, `held_amount = tokens_received`

**Note:** Target token is VRF-determined and may be the same token that was just sold.

---

## 9. Swap Execution

### 9.1 Maximum Swap Cap

```rust
pub const MAX_CARNAGE_SWAP_LAMPORTS: u64 = 1_000_000_000_000;  // 1000 SOL
```

**Rationale:**
- Bounds compute requirements
- Prevents "too big to execute" failures
- Spreads extreme accumulations across multiple triggers
- 1000 SOL is sufficient for significant market impact

**Behavior:** If SOL vault exceeds 1000 SOL, only 1000 SOL is swapped. Remainder stays in vault for next trigger.

### 9.2 Tax-Exempt Swap

Carnage swaps route through the Tax Program's exempt instruction:

```rust
// Epoch Program calls Tax Program
let swap_cpi = CpiContext::new_with_signer(
    ctx.accounts.tax_program.to_account_info(),
    SwapExempt {
        carnage_authority: ctx.accounts.carnage_pda.to_account_info(),
        pool: ctx.accounts.target_pool.to_account_info(),
        input_vault: ctx.accounts.carnage_sol_vault.to_account_info(),
        output_vault: ctx.accounts.carnage_ip_vault.to_account_info(),
        // ... other accounts
    },
    &[carnage_signer_seeds],
);

tax_program::cpi::swap_exempt(swap_cpi, amount)?;
```

**Tax Program's `swap_exempt` instruction:**
- Requires signer to be Carnage Fund PDA (cryptographically enforced)
- Applies 0% tax
- Applies standard LP fee (1% for SOL pools)
- Calls AMM via CPI

### 9.3 No Slippage Protection

Carnage swaps have no minimum output requirement.

**Rationale:**
- Carnage is designed to cause price disruption
- Slippage protection could cause frequent failures
- Failed Carnage = larger accumulation = bigger chaos later
- Arbitrageurs will restore the peg (that's the point)

### 9.4 Compute Budget Analysis

Carnage execution performs atomic buy operations after burn/sell. Compute requirements depend on execution path.

| Path | Operations | Estimated CU | Notes |
|------|------------|--------------|-------|
| Burn-then-buy (CRIME) | Token burn + Tax swap | ~180k | Burn: ~20k, Swap: ~150k (includes hook) |
| Burn-then-buy (FRAUD) | Token burn + Tax swap | ~180k | Same as CRIME |
| Sell-then-buy (PROFIT) | Tax swap + Tax swap | ~300k | Two full swap operations |

**1000 SOL Cap Justification:**

The 1000 SOL cap bounds worst-case compute:
- Single SOL-paired swap: ~150k CU
- PROFIT sell-then-buy: ~300k CU
- Buffer for hook execution variance: ~50k CU

At 1000 SOL with large pool depths:
- Swap iterations remain O(1) (constant product formula)
- Hook invocation is per-transfer (fixed cost)
- No CU scaling with SOL amount

**VRF Callback Total Budget:**
- VRF callback requests 260k CU (Epoch spec)
- Carnage execution: 150-300k CU
- Total with buffer: Should request 400k CU when Carnage is expected

**Failure Threshold:**
If atomic execution would exceed available CU:
- Transaction reverts automatically
- `carnage_pending` flag set to true
- 100-slot deadline begins for retry
- SOL retained in Carnage vault (never lost)

### 9.5 Two-Instruction Atomic Bundle (Preferred Approach)

Per VRF Migration Lessons (DISC-07 resolution), the preferred approach for combined VRF + Carnage execution is a **two-instruction atomic bundle**:

1. **Instruction 1:** `consumeRandomness` -- reads VRF result, updates tax regime, determines Carnage trigger/action/target
2. **Instruction 2:** `executeCarnageAtomic` -- executes Carnage based on values written by Instruction 1

Both instructions are bundled in the **same transaction**, providing:
- **MEV protection:** Identical to single-instruction atomic execution -- the transaction is all-or-nothing
- **Compute headroom:** Each instruction gets its own compute budget allocation
- **CPI depth isolation:** Carnage's depth-4 CPI chain runs in its own instruction context

This approach resolves the compute budget concern (VRF ~400k CU + Carnage ~300k CU = ~700k CU total, which may exceed single-instruction limits) while maintaining the atomic execution guarantee.

**Fallback:** If even the two-instruction bundle fails, the existing `carnage_pending` fallback mechanism (Section 11.2) activates with its 100-slot deadline.

> **Cross-Reference:** See `Docs/VRF_Migration_Lessons.md` Section 5, DISC-07 for the full analysis.

---

## 10. Burn Mechanism

### 10.1 Burn Authority

Carnage Fund vaults (CRIME and FRAUD) are owned by the Epoch Program PDA. As owner, the PDA can burn tokens from its own vaults.

**No external burn authority is required.**

Token mint authorities are burned at initialization, so no other entity can mint replacement tokens.

### 10.2 Burn Implementation

```rust
fn burn_held_tokens(
    carnage_state: &mut CarnageFundState,
    vault: &AccountInfo,
    mint: &AccountInfo,
    token_program: &AccountInfo,
    carnage_pda: &AccountInfo,
    signer_seeds: &[&[u8]],
) -> Result<u64> {
    let amount = carnage_state.held_amount;
    
    if amount == 0 {
        return Ok(0);
    }
    
    // Token-2022 burn instruction
    let burn_ix = spl_token_2022::instruction::burn(
        token_program.key,
        vault.key,
        mint.key,
        carnage_pda.key,
        &[],
        amount,
    )?;
    
    invoke_signed(
        &burn_ix,
        &[vault.clone(), mint.clone(), carnage_pda.clone()],
        &[signer_seeds],
    )?;
    
    // Update stats
    match carnage_state.held_token {
        Some(Token::CRIME) => carnage_state.total_crime_burned += amount,
        Some(Token::FRAUD) => carnage_state.total_fraud_burned += amount,
        None => {}
    }
    
    // Clear holdings
    carnage_state.held_token = None;
    carnage_state.held_amount = 0;
    
    Ok(amount)
}
```

### 10.3 Transfer Hook Bypass

Token-2022 `burn` instruction does **not** trigger transfer hooks.

**Implication:** Burns execute without whitelist checks. This is correct behavior—burn destination is "nowhere," not another account.

---

## 11. Atomic vs Fallback Execution

### 11.1 Atomic Execution (Happy Path)

Carnage executes within the VRF callback transaction:

```
VRF Callback Transaction:
  1. Update taxes (always succeeds first)
  2. Check Carnage trigger
  3. If triggered: Execute Carnage atomically
  4. Update epoch state
```

**Benefits:**
- No MEV window
- Single transaction for all epoch logic
- Predictable timing

### 11.2 Fallback Execution

If atomic execution fails, the VRF callback catches the error and sets pending state:

```rust
match execute_carnage_atomic(...) {
    Ok(details) => {
        // Success - record and continue
        carnage_state.last_trigger_epoch = epoch_state.current_epoch;
        carnage_state.total_triggers += 1;
        emit!(CarnageExecuted { ... });
    }
    Err(e) => {
        // Failure - don't revert, set pending state
        epoch_state.carnage_pending = true;
        epoch_state.carnage_target = buy_target;
        epoch_state.carnage_action = action;
        epoch_state.carnage_deadline_slot = clock.slot + CARNAGE_DEADLINE_SLOTS;
        
        emit!(CarnagePending {
            reason: e.to_string(),
            deadline_slot: epoch_state.carnage_deadline_slot,
        });
    }
}
```

**The VRF callback never reverts due to Carnage failure.** Taxes still update, epoch still advances.

> **Cross-System Note:** Epoch transitions are independent of Carnage pending state. `trigger_epoch_transition` can be called while `carnage_pending = true`. See [Epoch_State_Machine_Spec.md](./Epoch_State_Machine_Spec.md) Section 6.3 for the full overlap analysis and safety proof.

### 11.3 Fallback Deadline

```rust
pub const CARNAGE_DEADLINE_SLOTS: u64 = 100;  // ~40 seconds
```

**Rules:**
- Anyone can call `execute_carnage` while pending and within deadline
- Failed execution attempts do NOT reset the deadline
- After deadline expires, `expire_carnage` clears pending state
- SOL remains in vault for next trigger

### 11.4 Why Fixed Deadline?

**No deadline extension on failure because:**
1. If Carnage fails repeatedly in 100 slots, something is fundamentally wrong
2. Extending could be exploited (intentional failures to delay)
3. SOL isn't lost—it's deferred to next trigger
4. Prevents infinite retry loops

---

## 12. Failure Modes

### 12.1 Atomic Failure Causes

| Cause | Likelihood | Handling |
|-------|------------|----------|
| Compute limit exceeded | Low | Fallback to manual execution |
| Pool liquidity insufficient | Very low | Fallback, swap fails gracefully |
| CPI error | Very low | Fallback, investigate |
| Account constraint failure | Bug | Should never happen with correct PDAs |

### 12.2 Persistent Failure Scenario

**Scenario:** Every Carnage trigger fails for extended period.

**What happens:**
1. SOL accumulates in Carnage vault
2. Eventually exceeds 1000 SOL cap
3. Each trigger attempts 1000 SOL, excess remains
4. If failure persists, investigate root cause

**Root causes requiring investigation:**
- Bug in Carnage logic
- Pool state degenerate (near-zero liquidity)
- Compute limits (addressed by 1000 SOL cap)

**The 1000 SOL cap ensures Carnage can always attempt execution,** even after extreme accumulation.

### 12.3 Operational Monitoring

Carnage is permissionless and cannot be modified by admins. Monitoring is observational only.

#### Key Metrics to Track

| Metric | Description | Source | Alert Threshold |
|--------|-------------|--------|-----------------|
| `carnage_sol_balance` | SOL accumulated in Carnage vault | On-chain account | > 1000 SOL (cap reached) |
| `trigger_rate` | % of epochs that trigger Carnage | Event history | < 50% of expected (~2/day) |
| `success_rate` | % of triggers with atomic success | Event history | < 80% (investigate) |
| `retry_success_rate` | % of pending that succeed on retry | Event history | < 90% (CU issues) |
| `crime_burned_total` | Cumulative CRIME burned | CarnageFundState | Informational |
| `fraud_burned_total` | Cumulative FRAUD burned | CarnageFundState | Informational |

#### Alert Levels

**Level 1 - Informational:**
- Carnage triggered but executed via retry (not atomic)
- SOL balance approaching cap (> 800 SOL)

**Level 2 - Warning:**
- 3+ consecutive retries in a row
- SOL balance at cap for 2+ epochs
- Trigger rate below 50% of expected for 10 epochs

**Level 3 - Investigation Required:**
- 5+ consecutive Carnage execution failures
- SOL retained but never executed (potential bug)
- Unusual burn ratios (CRIME/FRAUD not proportional to activity)

#### Investigation Checklist

If persistent Carnage failures occur:

1. **Check Compute Budget:**
   - Is swap CU exceeding estimates?
   - Are hook costs higher than expected?
   - Action: None (protocol is immutable), but document for future reference

2. **Check Pool State:**
   - Are pool reserves in unexpected state?
   - Is k value correct?
   - Action: Verify AMM invariants

3. **Check Token Program:**
   - Are transfer hooks executing correctly?
   - Any unexpected Token-2022 behavior?
   - Action: Verify hook program state

4. **Check VRF:**
   - Is Switchboard responding?
   - Are callbacks being delivered?
   - Action: Check Switchboard dashboard

**Important:** No admin intervention is possible. If a fundamental issue exists:
- SOL is retained (never lost)
- Users may need to manually execute via permissionless retry
- Protocol continues operating (just without Carnage burns)

#### Monitoring Implementation

No on-chain monitoring is required. Off-chain monitoring should:
1. Subscribe to Carnage events via WebSocket
2. Index CarnageFundState account changes
3. Track epoch transitions and Carnage triggers
4. Alert on threshold violations

**Dashboard Recommendations:**
- Real-time: Current SOL balance, pending status
- Daily: Trigger rate, success rate, total burned
- Weekly: Burn trends, SOL throughput

---

## 13. Instructions (Within Epoch Program)

### 13.1 initialize_carnage_fund

Creates Carnage state and vault accounts.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| authority | Signer | Deployer (one-time) |
| carnage_state | Init PDA | Carnage fund state |
| sol_vault | Init PDA | SOL vault (SystemAccount) |
| crime_vault | Init PDA | CRIME token vault |
| fraud_vault | Init PDA | FRAUD token vault |
| crime_mint | Account | CRIME token mint |
| fraud_mint | Account | FRAUD token mint |
| token_program | Program | Token-2022 program |
| system_program | Program | System program |

**Logic:**

```rust
pub fn initialize_carnage_fund(ctx: Context<InitializeCarnageFund>) -> Result<()> {
    let carnage_state = &mut ctx.accounts.carnage_state;
    
    carnage_state.sol_vault = ctx.accounts.sol_vault.key();
    carnage_state.crime_vault = ctx.accounts.crime_vault.key();
    carnage_state.fraud_vault = ctx.accounts.fraud_vault.key();
    carnage_state.held_token = None;
    carnage_state.held_amount = 0;
    carnage_state.last_trigger_epoch = 0;
    carnage_state.total_sol_spent = 0;
    carnage_state.total_crime_burned = 0;
    carnage_state.total_fraud_burned = 0;
    carnage_state.total_triggers = 0;
    carnage_state.initialized = true;
    carnage_state.bump = ctx.bumps.carnage_state;
    
    emit!(CarnageFundInitialized {
        sol_vault: carnage_state.sol_vault,
        crime_vault: carnage_state.crime_vault,
        fraud_vault: carnage_state.fraud_vault,
        timestamp: Clock::get()?.unix_timestamp,
    });
    
    Ok(())
}
```

**Callable:** Once, at deployment.

---

### 13.2 execute_carnage_atomic (Internal)

Called within VRF callback. Not a public instruction.

```rust
fn execute_carnage_atomic(
    carnage_state: &mut CarnageFundState,
    vrf_result: &[u8; 32],
    // ... accounts
) -> Result<CarnageExecutionResult> {
    // Determine action and target
    let has_holdings = carnage_state.held_amount > 0;
    let action = get_carnage_action(vrf_result, has_holdings);
    let target = get_buy_target(vrf_result);
    
    let mut result = CarnageExecutionResult::default();
    
    // Step 1: Handle existing holdings
    match action {
        CarnageAction::BurnThenBuy => {
            result.tokens_burned = burn_held_tokens(carnage_state, ...)?;
        }
        CarnageAction::SellThenBuy => {
            result.sol_from_sale = sell_held_tokens(carnage_state, ...)?;
        }
        CarnageAction::BuyOnly => {
            // No holdings to handle
        }
    }
    
    // Step 2: Buy target token
    let sol_balance = get_sol_balance(&sol_vault)?;
    let swap_amount = std::cmp::min(sol_balance, MAX_CARNAGE_SWAP_LAMPORTS);
    
    if swap_amount > 0 {
        let tokens_received = execute_exempt_swap(
            swap_amount,
            target,
            // ... accounts
        )?;
        
        // Update holdings
        carnage_state.held_token = Some(target);
        carnage_state.held_amount = tokens_received;
        carnage_state.total_sol_spent += swap_amount;
        
        result.sol_spent = swap_amount;
        result.tokens_bought = tokens_received;
    }
    
    Ok(result)
}
```

---

### 13.3 execute_carnage (Public Fallback)

Permissionless instruction for fallback execution.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| executor | Signer | Anyone |
| epoch_state | Mut PDA | Epoch state (has pending flags) |
| carnage_state | Mut PDA | Carnage fund state |
| sol_vault | Mut PDA | Carnage SOL vault |
| crime_vault | Mut PDA | Carnage CRIME vault |
| fraud_vault | Mut PDA | Carnage FRAUD vault |
| target_pool | Mut PDA | Pool for buy (CRIME/SOL or FRAUD/SOL) |
| target_pool_vault_ip | Mut | Pool's IP vault |
| target_pool_vault_sol | Mut | Pool's SOL vault |
| target_mint | Account | CRIME or FRAUD mint |
| tax_program | Program | Tax program |
| amm_program | Program | AMM program |
| token_program | Program | Token-2022 program |
| system_program | Program | System program |

**Logic:**

```rust
pub fn execute_carnage(ctx: Context<ExecuteCarnage>) -> Result<()> {
    let epoch_state = &mut ctx.accounts.epoch_state;
    let carnage_state = &mut ctx.accounts.carnage_state;
    let clock = Clock::get()?;
    
    // Validate pending state
    require!(
        epoch_state.carnage_pending,
        CarnageError::NoCarnagePending
    );
    
    // Validate deadline
    require!(
        clock.slot <= epoch_state.carnage_deadline_slot,
        CarnageError::DeadlineExpired
    );
    
    // Validate target pool matches pending target
    validate_target_pool(
        &ctx.accounts.target_pool,
        epoch_state.carnage_target,
    )?;
    
    // Execute based on pending action
    let result = execute_carnage_inner(
        carnage_state,
        epoch_state.carnage_action,
        epoch_state.carnage_target,
        // ... accounts
    )?;
    
    // Clear pending state
    epoch_state.carnage_pending = false;
    epoch_state.carnage_action = CarnageAction::None;
    
    // Update stats
    carnage_state.last_trigger_epoch = epoch_state.current_epoch;
    carnage_state.total_triggers += 1;
    
    emit!(CarnageExecuted {
        epoch: epoch_state.current_epoch,
        action: epoch_state.carnage_action,
        target: epoch_state.carnage_target,
        sol_spent: result.sol_spent,
        tokens_bought: result.tokens_bought,
        tokens_burned: result.tokens_burned,
        atomic: false,
    });
    
    Ok(())
}
```

**Callable:** By anyone, while Carnage is pending and within deadline.

---

### 13.4 expire_carnage

Clears expired pending state.

**Accounts:**

| Account | Type | Description |
|---------|------|-------------|
| epoch_state | Mut PDA | Epoch state |
| carnage_state | Account | Carnage fund state (read for event) |

**Logic:**

```rust
pub fn expire_carnage(ctx: Context<ExpireCarnage>) -> Result<()> {
    let epoch_state = &mut ctx.accounts.epoch_state;
    let clock = Clock::get()?;
    
    // Validate pending
    require!(
        epoch_state.carnage_pending,
        CarnageError::NoCarnagePending
    );
    
    // Validate deadline passed
    require!(
        clock.slot > epoch_state.carnage_deadline_slot,
        CarnageError::DeadlineNotExpired
    );
    
    let expired_target = epoch_state.carnage_target;
    let expired_action = epoch_state.carnage_action;
    
    // Clear pending (SOL stays in vault)
    epoch_state.carnage_pending = false;
    epoch_state.carnage_action = CarnageAction::None;
    
    emit!(CarnageExpired {
        epoch: epoch_state.current_epoch,
        target: expired_target,
        action: expired_action,
        deadline_slot: epoch_state.carnage_deadline_slot,
        sol_retained: ctx.accounts.carnage_state.sol_vault_balance(),
    });
    
    Ok(())
}
```

**Callable:** By anyone, after deadline expires.

---

## 14. Events

```rust
#[event]
pub struct CarnageFundInitialized {
    pub sol_vault: Pubkey,
    pub crime_vault: Pubkey,
    pub fraud_vault: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct CarnageFunded {
    pub amount: u64,
    pub new_balance: u64,
}

#[event]
pub struct CarnageExecuted {
    pub epoch: u32,
    pub action: CarnageAction,
    pub target: Token,
    pub sol_spent: u64,
    pub tokens_bought: u64,
    pub tokens_burned: u64,
    pub sol_from_sale: u64,
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
    pub action: CarnageAction,
    pub deadline_slot: u64,
    pub sol_retained: u64,
}
```

---

## 15. Errors

```rust
#[error_code]
pub enum CarnageError {
    #[msg("Carnage fund not initialized")]
    NotInitialized,
    
    #[msg("Carnage fund already initialized")]
    AlreadyInitialized,
    
    #[msg("No Carnage execution is pending")]
    NoCarnagePending,
    
    #[msg("Carnage execution deadline has expired")]
    DeadlineExpired,
    
    #[msg("Carnage deadline has not expired yet")]
    DeadlineNotExpired,
    
    #[msg("Invalid target pool for pending Carnage")]
    InvalidTargetPool,
    
    #[msg("Zero amount not allowed")]
    ZeroAmount,
    
    #[msg("Arithmetic overflow")]
    Overflow,
    
    #[msg("Insufficient SOL in vault")]
    InsufficientSol,
    
    #[msg("Swap execution failed")]
    SwapFailed,
    
    #[msg("Burn execution failed")]
    BurnFailed,
}
```

---

## 16. Security Considerations

### 16.1 Tax Exemption

Carnage swaps are tax-exempt via a dedicated `swap_exempt` instruction in the Tax Program.

**Enforcement:**
- `swap_exempt` requires Carnage Fund PDA as signer
- PDA signatures are cryptographically enforced (invoke_signed)
- No way for users to claim exemption

**Not a whitelist check.** Explicit instruction separation.

### 16.2 MEV Protection

**Atomic execution:** VRF result unknown until callback executes. Taxes and Carnage happen in same transaction. No front-running window.

**Fallback execution:** 100-slot window creates theoretical MEV opportunity.

**Mitigation:**
- 100 slots is short (~40 seconds)
- Attacker pays full taxes, Carnage is tax-exempt
- Arbitrageur competition compresses any profit
- Practical MEV risk is low

### 16.3 Burn Safety

- Burns don't trigger transfer hooks (Token-2022 behavior)
- Carnage PDA owns the vaults, so it has burn authority
- Mint authorities are burned, so no replacement tokens possible
- Burn is truly deflationary

### 16.4 Direct AMM Access Prevention

Users cannot call the AMM directly to bypass taxes.

**Enforcement:** AMM swap instructions require Tax Program PDA as signer.

**See:** AMM_Implementation.md (pending update)

---

## 17. Whitelist Requirements

The Transfer Hook whitelist must include Carnage vaults:

| # | Address | Purpose |
|---|---------|---------|
| 9 | Carnage CRIME Vault | Receives CRIME from buys, source for burns/sells |
| 10 | Carnage FRAUD Vault | Receives FRAUD from buys, source for burns/sells |

**Note:** Carnage SOL Vault is not in the whitelist—it holds native SOL, not tokens.

---

## 18. Integration Points

### 18.1 Tax Program

**Deposits 24% of taxes:**
```rust
// In tax_program::swap_sol_pool
let carnage_portion = tax_amount * 24 / 100;
epoch_program::cpi::deposit_to_carnage(cpi_ctx, carnage_portion)?;
```

**Provides exempt swap:**
```rust
// tax_program::swap_exempt
// Requires Carnage PDA signer
// Applies 0% tax, 1% LP fee
// Calls AMM via CPI
```

### 18.2 Epoch Program (VRF Callback)

```rust
// In vrf_callback, after tax updates

if is_carnage_triggered(&vrf_result) {
    match execute_carnage_atomic(&mut carnage_state, &vrf_result, ...) {
        Ok(result) => {
            carnage_state.last_trigger_epoch = epoch_state.current_epoch;
            carnage_state.total_triggers += 1;
            emit!(CarnageExecuted { atomic: true, ... });
        }
        Err(e) => {
            // Set pending state, don't revert
            epoch_state.carnage_pending = true;
            epoch_state.carnage_target = get_buy_target(&vrf_result);
            epoch_state.carnage_action = get_carnage_action(&vrf_result, has_holdings);
            epoch_state.carnage_deadline_slot = clock.slot + CARNAGE_DEADLINE_SLOTS;
            emit!(CarnagePending { reason: e.to_string(), ... });
        }
    }
} else {
    emit!(CarnageNotTriggered { epoch: epoch_state.current_epoch });
}
```

---

## 19. Testing Requirements

### 19.1 Unit Tests

**VRF parsing:**
- Trigger threshold (byte 3 < 11)
- Action determination (byte 4 < 5 = sell)
- Target determination (byte 5 < 128 = CRIME)

**Math:**
- Swap cap enforcement (min of balance and 1000 SOL)
- Holdings tracking accuracy

### 19.2 Integration Tests

**Happy paths:**
- Initialize Carnage fund
- Deposit SOL from taxes
- Trigger with no holdings → buy
- Trigger with holdings, 98% → burn then buy
- Trigger with holdings, 2% → sell then buy
- Sell CRIME, rebuy CRIME (same token)
- Sell CRIME, rebuy FRAUD (different token)

**Fallback paths:**
- Atomic fails → pending state set
- Manual `execute_carnage` succeeds
- Manual `execute_carnage` fails → still pending
- Deadline expires → `expire_carnage` succeeds
- SOL retained after expiration

**Edge cases:**
- Exactly 1000 SOL (cap boundary)
- Over 1000 SOL (partial swap, remainder stays)
- Under 1000 SOL (full swap)
- Zero SOL (nothing to swap)
- Multiple triggers before holdings cleared

### 19.3 Negative Tests

- `execute_carnage` with no pending (fails)
- `execute_carnage` after deadline (fails)
- `expire_carnage` before deadline (fails)
- Wrong target pool for pending Carnage (fails)
- Double initialization (fails)

### 19.4 Stress Tests

- Maximum SOL balance (1000+ SOL accumulation)
- Rapid successive triggers
- Concurrent fallback execution attempts

---

## 20. UI Integration

### 20.1 Displaying Carnage State

```typescript
interface CarnageDisplayState {
    solBalance: number;
    heldToken: 'CRIME' | 'FRAUD' | null;
    heldAmount: number;
    lastTriggerEpoch: number;
    isPending: boolean;
    pendingDeadlineSlot?: number;
    pendingTarget?: 'CRIME' | 'FRAUD';
}

function formatCarnageStatus(state: CarnageDisplayState): string {
    if (state.isPending) {
        const slotsLeft = state.pendingDeadlineSlot - currentSlot;
        return `⚠️ CARNAGE PENDING: Buying ${state.pendingTarget} (~${slotsLeft * 0.4}s remaining)`;
    }
    
    if (state.heldToken) {
        return `💀 Holding ${formatTokenAmount(state.heldAmount)} ${state.heldToken}`;
    }
    
    return `💰 ${formatSol(state.solBalance)} SOL loaded`;
}
```

### 20.2 Historical Stats

Display from CarnageFundState:
- Total SOL spent
- Total CRIME burned
- Total FRAUD burned
- Total triggers
- Average SOL per trigger

---

## 21. Initialization Sequence

```
1. Deploy Epoch Program (contains Carnage logic)

2. Initialize Epoch State

3. Initialize Carnage Fund:
   → Create CarnageFundState PDA
   → Create SOL vault PDA
   → Create CRIME vault (Token-2022 account)
   → Create FRAUD vault (Token-2022 account)

4. Add Carnage vaults to Transfer Hook whitelist:
   → add_whitelist_entry(carnage_crime_vault)
   → add_whitelist_entry(carnage_fraud_vault)

5. (Continue with other initialization steps...)

6. Burn whitelist authority

7. Carnage Fund is operational
   → Deposits begin on first taxed swap
   → First trigger possible at epoch 1
```

---

## 22. Invariants Summary

1. **Inline in Epoch Program** — No separate Carnage program, 3 CPI levels max
2. **Tax-exempt swaps only** — 0% tax, 1% LP fee
3. **Maximum 1000 SOL per swap** — Prevents compute failures
4. **VRF-determined buy target** — Even on 2% sell path
5. **Atomic preferred, fallback available** — 100-slot deadline
6. **Fixed deadline** — No extension on failed attempts
7. **SOL never lost** — Retained in vault on expiration
8. **Burns are deflationary** — No token replacement possible
9. **No admin functions** — Permissionless post-deployment
10. **Holdings always tracked** — State reflects actual vault balances