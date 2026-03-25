# Phase 25: Carnage Fund Execution - Research

**Researched:** 2026-02-06
**Domain:** Solana Anchor Program / CPI / Token-2022 / Atomic Operations
**Confidence:** HIGH

## Summary

This research covers the implementation of the Carnage Fund execution system within the Epoch Program. The Carnage Fund is an economic chaos mechanism that accumulates 24% of taxes, triggers randomly (~4.3% per epoch), and executes market operations (burns/sells followed by buys) to inject volatility and deflation.

The primary technical challenge is the CPI depth constraint: Carnage execution reaches exactly the Solana limit of 4 nested CPI calls (Epoch -> Tax -> AMM -> Token-2022 -> Hook). This constraint is already handled by the architecture decision to inline Carnage in the Epoch Program rather than a separate program.

Key implementation patterns include: two-instruction atomic bundling for MEV protection, Token-2022 burn operations (which bypass transfer hooks), and existing swap_exempt infrastructure in the Tax Program for tax-free Carnage swaps.

**Primary recommendation:** Implement the two-instruction atomic bundle model (consume_randomness sets pending, execute_carnage_atomic executes) within the same transaction for MEV protection while staying within compute limits.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| anchor-lang | 0.32.x | Solana program framework | Project standard, provides account validation and CPI helpers |
| anchor-spl | 0.32.x | SPL Token interfaces | Token-2022 burn and transfer_checked operations |
| spl-token-2022 | Latest | Token-2022 primitives | Burn instruction, transfer hook compatibility |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| switchboard-on-demand | 0.11.3+ | VRF randomness parsing | Already used in consume_randomness for VRF bytes |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Two-instruction bundle | Single-instruction atomic | Single instruction may exceed ~400k CU budget when VRF + Carnage combined |
| Native SOL in CarnageFundState | Wrapped SOL token account | Native SOL avoids WSOL wrap/unwrap overhead, simpler accounting |

**No installation needed:** All dependencies already present in the project.

## Architecture Patterns

### Recommended Project Structure
```
programs/epoch-program/src/
  instructions/
    mod.rs                          # Add new instruction exports
    consume_randomness.rs           # Modify to set carnage_pending
    execute_carnage_atomic.rs       # NEW: Public atomic execution
    execute_carnage.rs              # NEW: Fallback execution
    expire_carnage.rs               # NEW: Clear expired pending
    initialize_carnage_fund.rs      # NEW: One-time initialization
  state/
    mod.rs                          # Add CarnageFundState export
    carnage_fund_state.rs           # NEW: Carnage state account
    enums.rs                        # Already has Token, CarnageAction
  helpers/
    mod.rs
    carnage_execution.rs            # NEW: Shared execution logic
```

### Pattern 1: Two-Instruction Atomic Bundle
**What:** Client bundles consume_randomness + execute_carnage_atomic in a single transaction
**When to use:** Every Carnage-triggering epoch (primary execution path)
**Why:** Maintains atomicity (no MEV window) while staying within per-instruction compute limits

**Flow:**
```
Transaction {
  Instruction 1: consume_randomness
    - Reads VRF, updates taxes, updates staking
    - Checks Carnage trigger (byte 3 < 11)
    - If triggered: sets carnage_pending = true, carnage_target, carnage_action
    - Does NOT execute Carnage (stays in compute budget)

  Instruction 2: execute_carnage_atomic
    - Requires carnage_pending = true
    - Executes burn/sell-then-buy
    - Clears carnage_pending on success
}
```

**Example:**
```typescript
// Source: Carnage_Fund_Spec.md Section 9.5
const tx = new Transaction().add(
  ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
  revealIx,           // Switchboard SDK reveal
  consumeRandomnessIx,  // Sets carnage_pending if triggered
  executeCarnageAtomicIx // Executes Carnage if pending
);
await provider.sendAndConfirm(tx, [wallet.payer]);
```

### Pattern 2: Fallback with Deadline
**What:** If atomic fails, manual execute_carnage within 100-slot window
**When to use:** Only when atomic bundle fails (should be rare <5% of cases)
**Why:** Ensures protocol never deadlocks; SOL preserved on timeout

### Pattern 3: Native SOL + Token Vault Hybrid
**What:** CarnageFundState PDA holds native SOL, separate token PDAs for CRIME/FRAUD
**When to use:** This phase (locked decision from CONTEXT.md)
**Why:** Native SOL simplifies accumulation (no WSOL wrapping), token accounts for IP holdings

**PDA Derivation:**
```rust
// CarnageFundState PDA
seeds = [b"carnage_fund"]

// SOL Vault (SystemAccount)
seeds = [b"carnage_sol_vault"]

// CRIME Token Vault
seeds = [b"carnage_crime_vault"]

// FRAUD Token Vault
seeds = [b"carnage_fraud_vault"]
```

### Pattern 4: Token-2022 Burn (Transfer Hook Bypass)
**What:** Token-2022 burn instruction does NOT trigger transfer hooks
**When to use:** Carnage burn path (98% of triggered epochs with holdings)
**Why:** Reduces CPI depth, simplifies execution, burns are one-way anyway

```rust
// Source: Verified via RareSkills Token-2022 Spec
// Burns do not trigger transfer hooks in Token-2022
spl_token_2022::instruction::burn(
    token_program.key,
    vault.key,         // Carnage vault (source)
    mint.key,          // CRIME or FRAUD mint
    carnage_pda.key,   // Authority (Carnage PDA owns vault)
    &[],               // No multisig
    amount,
)?;
```

### Anti-Patterns to Avoid
- **Separate Carnage Program:** Would add CPI depth (becomes 5), exceeds Solana limit
- **Atomic Carnage in consume_randomness:** Single instruction may exceed ~400k CU budget
- **Slippage protection on Carnage swaps:** Carnage is designed to cause price impact; slippage would cause failures
- **Allowing reroll of Carnage trigger:** VRF bytes are bound at commit time; same bytes determine Carnage

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tax-exempt swaps | Custom AMM call | Tax::swap_exempt | Already exists, handles CPI properly, validated with carnage_signer |
| Token burns | Direct CPI to Token-2022 | spl_token_2022::instruction::burn | Standard SPL interface, no hook invocation |
| VRF byte parsing | Custom parsing | Existing derive_taxes pattern | Already have VRF parsing in consume_randomness |
| PDA signing | Manual seed management | Anchor seeds constraint | Anchor validates and provides bumps automatically |
| SOL transfers | invoke_signed manually | anchor_lang::system_program::Transfer | Anchor provides type-safe CPI context |

**Key insight:** The codebase already has patterns for CPI-gated access (swap_exempt, update_cumulative). Follow the same pattern for Carnage execution.

## Common Pitfalls

### Pitfall 1: CPI Depth Overflow
**What goes wrong:** Adding any CPI call to Carnage execution path exceeds depth 4 limit
**Why it happens:** Carnage path already at limit: Epoch -> Tax -> AMM -> Token-2022 -> Hook
**How to avoid:**
- Never add CPIs to the execution path
- Burns bypass hooks (don't consume hook depth)
- No additional validations requiring external CPIs
**Warning signs:** "CallDepth" runtime error

### Pitfall 2: Compute Budget Exhaustion
**What goes wrong:** Single instruction exceeds allocated CU, transaction fails
**Why it happens:** VRF (~400k CU) + Carnage swaps (~150-300k CU) combined
**How to avoid:**
- Use two-instruction bundle (each instruction gets separate CU allocation)
- Request 600k CU for the transaction
- 1000 SOL cap bounds swap iterations
**Warning signs:** "Exceeded maximum compute units" error

### Pitfall 3: carnage_pending Deadlock
**What goes wrong:** carnage_pending stays true forever, blocking new Carnage
**Why it happens:** No expiration handling, no auto-cleanup
**How to avoid:**
- consume_randomness auto-expires stale pending if deadline passed
- expire_carnage instruction clears manually
- Epoch transitions are independent of carnage_pending (per spec Section 6.3)
**Warning signs:** carnage_pending = true for multiple epochs

### Pitfall 4: Wrong Pool for Carnage Target
**What goes wrong:** execute_carnage passes CRIME pool when VRF said FRAUD
**Why it happens:** Client provides wrong accounts
**How to avoid:**
- Validate pool's mint_b matches expected target token
- Store carnage_target in EpochState (already exists)
- Reject mismatched pools with InvalidCarnageTargetPool error
**Warning signs:** Carnage buying wrong token

### Pitfall 5: Holdings Tracking Desync
**What goes wrong:** CarnageFundState.held_amount doesn't match actual vault balance
**Why it happens:** Burns/sells update state but vault read failed, or vice versa
**How to avoid:**
- Update state AFTER successful token operations
- Use checked_sub/checked_add for all math
- Read vault balance directly when needed for swap amounts
**Warning signs:** held_amount != 0 but vault balance = 0

### Pitfall 6: Stale Carnage Overlapping Next Epoch
**What goes wrong:** Old carnage_pending conflicts with new trigger
**Why it happens:** Extremely unlikely given 100 slots << 4,500 slots/epoch
**How to avoid:**
- Per CONTEXT.md: consume_randomness auto-expires stale pending first
- Check and clear before evaluating new VRF bytes
**Warning signs:** N/A (architecturally prevented)

## Code Examples

Verified patterns from official sources and existing codebase:

### CarnageFundState Account Structure
```rust
// Source: Carnage_Fund_Spec.md Section 4.1
#[account]
pub struct CarnageFundState {
    /// PDA of the SOL vault
    pub sol_vault: Pubkey,

    /// PDA of the CRIME token vault
    pub crime_vault: Pubkey,

    /// PDA of the FRAUD token vault
    pub fraud_vault: Pubkey,

    /// Which token is currently held (0=None, 1=CRIME, 2=FRAUD)
    pub held_token: u8,

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

impl CarnageFundState {
    // Size: 32 + 32 + 32 + 1 + 8 + 4 + 8 + 8 + 8 + 4 + 1 + 1 = 139 bytes
    // With discriminator: 8 + 139 = 147 bytes
    pub const LEN: usize = 8 + 139;
}
```

### Carnage Trigger Check (VRF Byte 3)
```rust
// Source: Carnage_Fund_Spec.md Section 7.1
pub const CARNAGE_TRIGGER_THRESHOLD: u8 = 11;  // ~4.3% = 11/256

fn is_carnage_triggered(vrf_result: &[u8; 32]) -> bool {
    vrf_result[3] < CARNAGE_TRIGGER_THRESHOLD
}
```

### Carnage Action Determination (VRF Byte 4)
```rust
// Source: Carnage_Fund_Spec.md Section 7.2
pub const SELL_THRESHOLD: u8 = 5;  // 2% = 5/256 - 1/50

fn get_carnage_action(vrf_result: &[u8; 32], has_holdings: bool) -> CarnageAction {
    if !has_holdings {
        return CarnageAction::None; // BuyOnly path
    }

    if vrf_result[4] < SELL_THRESHOLD {
        CarnageAction::Sell  // 2% path
    } else {
        CarnageAction::Burn  // 98% path
    }
}
```

### Carnage Target Determination (VRF Byte 5)
```rust
// Source: Carnage_Fund_Spec.md Section 7.3
fn get_carnage_target(vrf_result: &[u8; 32]) -> Token {
    if vrf_result[5] < 128 {
        Token::Crime
    } else {
        Token::Fraud
    }
}
```

### Token-2022 Burn (No Transfer Hook)
```rust
// Source: Token-2022 specification, verified via RareSkills
// Burns do NOT trigger transfer hooks
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
        1 => carnage_state.total_crime_burned += amount, // CRIME
        2 => carnage_state.total_fraud_burned += amount, // FRAUD
        _ => {}
    }

    // Clear holdings
    carnage_state.held_token = 0;
    carnage_state.held_amount = 0;

    Ok(amount)
}
```

### Tax::swap_exempt CPI (Already Exists)
```rust
// Source: programs/tax-program/src/instructions/swap_exempt.rs
// Already implemented in Phase 20, uses carnage_signer PDA
// Epoch Program calls this with carnage_signer as authority

// In execute_carnage_atomic:
let swap_cpi = CpiContext::new_with_signer(
    ctx.accounts.tax_program.to_account_info(),
    tax_program::cpi::accounts::SwapExempt {
        carnage_authority: ctx.accounts.carnage_signer.to_account_info(),
        swap_authority: ctx.accounts.swap_authority.to_account_info(),
        pool: ctx.accounts.pool.to_account_info(),
        // ... other accounts
    },
    &[carnage_signer_seeds],
);
tax_program::cpi::swap_exempt(swap_cpi, amount_in, direction, is_crime)?;
```

### Fallback Deadline Check
```rust
// Source: Carnage_Fund_Spec.md Section 11.3
pub const CARNAGE_DEADLINE_SLOTS: u64 = 100;  // ~40 seconds

// In execute_carnage (fallback):
require!(
    epoch_state.carnage_pending,
    CarnageError::NoCarnagePending
);
require!(
    clock.slot <= epoch_state.carnage_deadline_slot,
    CarnageError::DeadlineExpired
);

// In expire_carnage:
require!(
    clock.slot > epoch_state.carnage_deadline_slot,
    CarnageError::DeadlineNotExpired
);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single-instruction VRF+Carnage | Two-instruction atomic bundle | DISC-07 resolution | Stays within CU limits while maintaining atomicity |
| Separate Carnage Program | Inline in Epoch Program | CPI depth analysis | Avoids depth 5 overflow |
| Wrapped SOL vault | Native SOL in PDA | CONTEXT.md decision | Simpler accounting |

**Deprecated/outdated:**
- VRF CPI callback pattern: Switchboard infrastructure shut down, use On-Demand commit-reveal
- `solana-randomness-service-lite`: References non-existent accounts

## Open Questions

Things that couldn't be fully resolved:

1. **Exact compute units for Carnage execution**
   - What we know: Spec estimates ~150-300k CU, swap path varies by direction
   - What's unclear: Real-world CU with large pool depths, hook execution variance
   - Recommendation: Test with 1000 SOL swaps on devnet, adjust CU request if needed

2. **WSOL wrapping for SOL vault**
   - What we know: CONTEXT.md says "Native SOL stored as lamports in CarnageFundState PDA"
   - What's unclear: For swap_exempt, user_token_a expects a TokenAccount (WSOL)
   - Recommendation: Need WSOL wrapping step before swap OR modify swap_exempt to handle native SOL transfer

3. **Carnage signer PDA bump storage**
   - What we know: Tax Program's swap_exempt expects carnage_signer signed by Epoch Program
   - What's unclear: Where to store the bump for carnage_signer PDA
   - Recommendation: Add bump to CarnageFundState or derive on-the-fly with find_program_address

## Sources

### Primary (HIGH confidence)
- Docs/Carnage_Fund_Spec.md - Comprehensive 1252-line specification
- Docs/Epoch_State_Machine_Spec.md - State machine, VRF bytes, Carnage integration
- programs/tax-program/src/instructions/swap_exempt.rs - Existing tax-exempt swap implementation
- programs/epoch-program/src/instructions/consume_randomness.rs - Current VRF consumption pattern

### Secondary (MEDIUM confidence)
- Solana Program Limitations docs (https://solana.com/docs/programs/limitations) - Confirmed CPI depth limit = 4
- RareSkills Token-2022 Spec (https://rareskills.io/post/token-2022) - Confirmed burns don't trigger hooks

### Tertiary (LOW confidence)
- SIMD-0268 proposal for raising CPI limit to 8 - Not yet activated, don't rely on this

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All dependencies already in project, patterns established
- Architecture: HIGH - Spec is comprehensive, CONTEXT.md locks key decisions
- Pitfalls: HIGH - Derived from spec constraints and Solana documentation
- CPI depth: HIGH - Verified with official Solana docs (limit = 4)
- Token-2022 burns: HIGH - Verified burns bypass transfer hooks

**Research date:** 2026-02-06
**Valid until:** 2026-03-06 (30 days - stable domain, spec complete)
