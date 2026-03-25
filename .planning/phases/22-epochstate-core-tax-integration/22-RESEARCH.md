# Phase 22: EpochState Core + Tax Integration - Research

**Researched:** 2026-02-06
**Domain:** Anchor cross-program account reading, EpochState account structure, Tax Program integration
**Confidence:** HIGH

## Summary

This research investigates how to implement Phase 22: establishing the EpochState account structure with slot-based epoch timing, and updating the Tax Program to read dynamic tax rates from EpochState instead of hardcoded values.

The core technical challenge is **cross-program account reading** in Anchor. The Tax Program (owned by the Tax Program) must read account data from EpochState (owned by the Epoch Program) and use those values for tax calculations. This is a well-established pattern in Anchor: define a matching struct in the reading program, deserialize the passed account using `AccountDeserialize::try_deserialize()`, and validate the account is owned by the expected program.

The existing Tax Program codebase already has the foundation in place:
- `swap_sol_buy.rs` and `swap_sol_sell.rs` have TODOs marking where EpochState reading should occur
- `swap_exempt.rs` already validates a PDA from Epoch Program using `seeds::program = epoch_program_id()`
- `constants.rs` has a placeholder `epoch_program_id()` function that needs updating
- The error enum already includes `InvalidEpochState`

**Primary recommendation:** Create a minimal `EpochState` struct in the Tax Program that mirrors the Epoch Program's struct layout for reading, pass EpochState as an `UncheckedAccount` to swap instructions, and deserialize manually with owner validation.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| anchor-lang | 0.32.1 | Program framework with account validation | Project already uses this version |
| solana-program | 2.x | Clock sysvar, account primitives | Required for slot-based timing |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| borsh | (via anchor) | Account serialization/deserialization | Cross-program struct reading |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual `try_deserialize` | Anchor `Account<EpochState>` | Anchor's Account type requires same-program ownership; we're reading from Epoch Program |
| `UncheckedAccount` | `AccountInfo` | UncheckedAccount is Anchor's wrapper providing cleaner syntax |

## Architecture Patterns

### Recommended Project Structure

The Epoch Program does not exist yet. Phase 22 creates it. Structure:

```
programs/
├── epoch-program/                    # NEW - Phase 22
│   ├── src/
│   │   ├── lib.rs                    # Program entry + declare_id
│   │   ├── state/
│   │   │   ├── mod.rs
│   │   │   ├── epoch_state.rs        # EpochState account struct
│   │   │   └── enums.rs              # Token, CarnageAction enums
│   │   ├── instructions/
│   │   │   ├── mod.rs
│   │   │   └── initialize_epoch_state.rs
│   │   ├── constants.rs              # SLOTS_PER_EPOCH, tax rates
│   │   └── errors.rs
│   └── Cargo.toml
├── tax-program/                      # EXISTING - Modified
│   ├── src/
│   │   ├── state/                    # NEW directory
│   │   │   ├── mod.rs
│   │   │   └── epoch_state_reader.rs # Read-only EpochState mirror
│   │   ├── instructions/
│   │   │   ├── swap_sol_buy.rs       # MODIFIED: add epoch_state account
│   │   │   └── swap_sol_sell.rs      # MODIFIED: add epoch_state account
│   │   └── constants.rs              # MODIFIED: update epoch_program_id()
```

### Pattern 1: Cross-Program Account Reading

**What:** Read EpochState owned by Epoch Program from within Tax Program.

**When to use:** Any time one program needs to read data from another program's accounts.

**Example:**
```rust
// Source: RareSkills.io "Reading Another Anchor Program's Account Data" pattern
// In tax-program/src/state/epoch_state_reader.rs

use anchor_lang::prelude::*;

/// Read-only mirror of Epoch Program's EpochState account.
/// Struct name MUST match exactly for discriminator verification.
/// Fields MUST match layout exactly for correct deserialization.
#[account]
pub struct EpochState {
    // Timing (exactly matches Epoch Program)
    pub genesis_slot: u64,
    pub current_epoch: u32,
    pub epoch_start_slot: u64,

    // Tax Configuration - what Tax Program reads
    pub cheap_side: u8,               // 0 = CRIME, 1 = FRAUD
    pub low_tax_bps: u16,
    pub high_tax_bps: u16,

    // Derived Tax Rates (cached for efficiency)
    pub crime_buy_tax_bps: u16,
    pub crime_sell_tax_bps: u16,
    pub fraud_buy_tax_bps: u16,
    pub fraud_sell_tax_bps: u16,

    // VRF State (Tax Program doesn't use, but must be in layout)
    pub vrf_request_slot: u64,
    pub vrf_pending: bool,
    pub taxes_confirmed: bool,
    pub pending_randomness_account: Pubkey,

    // Carnage State (Tax Program doesn't use, but must be in layout)
    pub carnage_pending: bool,
    pub carnage_target: u8,
    pub carnage_action: u8,
    pub carnage_deadline_slot: u64,
    pub last_carnage_epoch: u32,

    // Protocol
    pub initialized: bool,
    pub bump: u8,
}

impl EpochState {
    /// Size: matches Epoch_State_Machine_Spec.md Section 4.1
    /// 8 + 4 + 8 + 1 + 2 + 2 + 2 + 2 + 2 + 2 + 8 + 1 + 1 + 32 + 1 + 1 + 1 + 8 + 4 + 1 + 1 = 93 bytes
    /// Plus 8-byte discriminator = 101 bytes
    pub const LEN: usize = 8 + 93;

    /// Get the appropriate tax rate for a swap operation.
    pub fn get_tax_bps(&self, is_crime: bool, is_buy: bool) -> u16 {
        match (is_crime, is_buy) {
            (true, true) => self.crime_buy_tax_bps,
            (true, false) => self.crime_sell_tax_bps,
            (false, true) => self.fraud_buy_tax_bps,
            (false, false) => self.fraud_sell_tax_bps,
        }
    }
}
```

### Pattern 2: Account Validation with Owner Check

**What:** Validate that passed account is owned by Epoch Program before deserializing.

**When to use:** Always, for security. Prevents attacker from passing a fake EpochState.

**Example:**
```rust
// Source: Solana docs + RareSkills pattern + existing project conventions
// In swap_sol_buy.rs handler

use crate::state::epoch_state_reader::EpochState;
use anchor_lang::AccountDeserialize;

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, SwapSolBuy<'info>>,
    amount_in: u64,
    minimum_output: u64,
    is_crime: bool,
) -> Result<()> {
    // =========================================================================
    // 1. Read and validate EpochState
    // =========================================================================

    // Owner check: EpochState must be owned by Epoch Program
    let epoch_program = epoch_program_id();
    require!(
        ctx.accounts.epoch_state.owner == &epoch_program,
        TaxError::InvalidEpochState
    );

    // Deserialize EpochState data
    let epoch_state = {
        let data = ctx.accounts.epoch_state.try_borrow_data()?;
        let mut data_slice: &[u8] = &data;
        EpochState::try_deserialize(&mut data_slice)
            .map_err(|_| error!(TaxError::InvalidEpochState))?
    };

    // Validate EpochState is initialized
    require!(epoch_state.initialized, TaxError::InvalidEpochState);

    // Get the appropriate tax rate
    let tax_bps = epoch_state.get_tax_bps(is_crime, true); // true = buy

    // ... rest of handler using tax_bps instead of hardcoded 400
}
```

### Pattern 3: EpochState PDA Derivation

**What:** Derive EpochState PDA address for validation.

**When to use:** When you need to verify the passed account matches the expected PDA.

**Example:**
```rust
// Source: Epoch_State_Machine_Spec.md Section 4.4
// PDA derivation: seeds = ["epoch_state"], program = epoch_program

/// Derive the EpochState PDA address.
pub fn get_epoch_state_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"epoch_state"],
        &epoch_program_id(),
    )
}

// Usage in validation:
let (expected_pda, _) = get_epoch_state_pda();
require!(
    ctx.accounts.epoch_state.key() == expected_pda,
    TaxError::InvalidEpochState
);
```

### Pattern 4: Initialize EpochState with Clock Sysvar

**What:** Capture genesis_slot from Clock sysvar at initialization time.

**When to use:** In Epoch Program's initialize_epoch_state instruction.

**Example:**
```rust
// Source: Epoch_State_Machine_Spec.md Section 8.1

use anchor_lang::prelude::*;

pub fn initialize_epoch_state(ctx: Context<InitializeEpochState>) -> Result<()> {
    let clock = Clock::get()?;
    let epoch_state = &mut ctx.accounts.epoch_state;

    // Capture genesis slot from Clock sysvar (prevents manipulation)
    epoch_state.genesis_slot = clock.slot;
    epoch_state.current_epoch = 0;
    epoch_state.epoch_start_slot = clock.slot;

    // Genesis: CRIME cheap (per spec Section 5)
    epoch_state.cheap_side = 0; // 0 = CRIME
    epoch_state.low_tax_bps = 300;   // 3%
    epoch_state.high_tax_bps = 1400; // 14%

    // Derived rates (CRIME cheap means CRIME has low buy, high sell)
    epoch_state.crime_buy_tax_bps = 300;
    epoch_state.crime_sell_tax_bps = 1400;
    epoch_state.fraud_buy_tax_bps = 1400;
    epoch_state.fraud_sell_tax_bps = 300;

    // VRF state (no pending at genesis)
    epoch_state.vrf_request_slot = 0;
    epoch_state.vrf_pending = false;
    epoch_state.taxes_confirmed = true; // Genesis taxes are confirmed
    epoch_state.pending_randomness_account = Pubkey::default();

    // Carnage state
    epoch_state.carnage_pending = false;
    epoch_state.carnage_target = 0;
    epoch_state.carnage_action = 0; // CarnageAction::None
    epoch_state.carnage_deadline_slot = 0;
    epoch_state.last_carnage_epoch = 0;

    epoch_state.initialized = true;
    epoch_state.bump = ctx.bumps.epoch_state;

    emit!(EpochStateInitialized {
        genesis_slot: clock.slot,
        initial_cheap_side: 0, // CRIME
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
```

### Anti-Patterns to Avoid

- **Using `Account<EpochState>` in Tax Program:** Anchor's `Account<T>` type enforces same-program ownership. EpochState is owned by Epoch Program, not Tax Program. Use `UncheckedAccount` with manual deserialization.

- **Skipping owner validation:** Always verify `account.owner == &epoch_program_id()` before deserializing. An attacker could create a malicious account with matching data layout.

- **Assuming EpochState is initialized:** Always check `epoch_state.initialized == true` after deserializing.

- **Hardcoding Epoch Program ID in multiple places:** Use a single `epoch_program_id()` function in constants.rs to ensure consistency.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Account deserialization | Manual byte parsing | `AccountDeserialize::try_deserialize()` | Handles discriminator validation, field alignment |
| PDA derivation | String concatenation | `Pubkey::find_program_address()` | Cryptographically secure, handles bump |
| Clock access | System instruction parsing | `Clock::get()` | Sysvar is free to read, no CPI needed |
| Owner validation | Comparing raw bytes | `account.owner == &pubkey` | Anchor provides clean comparison |

**Key insight:** Anchor provides `AccountDeserialize` trait that handles discriminator checking (first 8 bytes of sha256 of struct name) automatically. Manual byte parsing would miss this critical security check.

## Common Pitfalls

### Pitfall 1: Discriminator Mismatch

**What goes wrong:** Tax Program's EpochState struct has a different name than Epoch Program's, causing deserialization to fail.

**Why it happens:** Anchor computes the account discriminator from `sha256("account:<StructName>")[0..8]`. The struct name, not the fields, determines the discriminator.

**How to avoid:** Ensure the struct in Tax Program is named `EpochState` exactly, matching the Epoch Program.

**Warning signs:** `AnchorError: AccountDidNotDeserialize` or `AccountDiscriminatorMismatch` errors.

### Pitfall 2: Field Order Mismatch

**What goes wrong:** Deserialization succeeds but values are wrong (swapped fields, incorrect offsets).

**Why it happens:** Borsh serialization is positional. Fields must be in the exact same order with same sizes.

**How to avoid:** Copy the exact field order from Epoch_State_Machine_Spec.md Section 4.1. Document byte offsets.

**Warning signs:** Tax rates appear nonsensical (e.g., 40960 bps instead of 400 bps).

### Pitfall 3: Missing Owner Check

**What goes wrong:** An attacker passes a malicious account that deserializes correctly but contains fake tax rates (0% tax).

**Why it happens:** Developer assumes PDA derivation provides security, but attacker could compute the PDA and create a competing account (though this is prevented by PDA constraints, the owner check is defense-in-depth).

**How to avoid:** Always verify `account.owner == &epoch_program_id()` before trusting data.

**Warning signs:** Transaction succeeds but taxes are 0% or unexpected values.

### Pitfall 4: Forgetting to Update Epoch Program ID

**What goes wrong:** Tax Program validates against placeholder program ID, all transactions fail.

**Why it happens:** `constants.rs` has a placeholder `EpochProgram1111111111111111111111111111111` that must be updated after Epoch Program deployment.

**How to avoid:** Add deployment checklist step: "Update epoch_program_id() in Tax Program constants.rs".

**Warning signs:** All swap transactions fail with `InvalidEpochState`.

### Pitfall 5: Breaking Existing Tests

**What goes wrong:** Adding EpochState account to swap instructions breaks all existing Tax Program tests.

**Why it happens:** Tests don't have EpochState account to pass.

**How to avoid:**
- For unit tests: Create mock EpochState accounts with test data
- For integration tests: Initialize real EpochState via Epoch Program
- Per CONTEXT.md: Use both approaches - mocks for fast unit tests, real accounts for integration tests

**Warning signs:** Test suite fails with "missing account" errors.

## Code Examples

Verified patterns from project documentation and official sources:

### Reading Tax Rate from EpochState (Spec Section 10)

```rust
// Source: Epoch_State_Machine_Spec.md Section 10.1
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

### Updated SwapSolBuy Accounts Struct

```rust
// Source: Tax_Pool_Logic_Spec.md Section 2.3 + Phase 22 decisions
#[derive(Accounts)]
pub struct SwapSolBuy<'info> {
    /// User initiating the swap
    #[account(mut)]
    pub user: Signer<'info>,

    /// EpochState account from Epoch Program
    /// CHECK: Validated manually - owner check + deserialization
    pub epoch_state: AccountInfo<'info>,

    /// Tax Program's swap_authority PDA
    #[account(
        seeds = [SWAP_AUTHORITY_SEED],
        bump,
    )]
    pub swap_authority: AccountInfo<'info>,

    // ... remaining accounts unchanged
}
```

### Token Enum for Tax Program

```rust
// Source: Epoch_State_Machine_Spec.md Section 4.2
// Simplified for Tax Program (only needs for matching)
pub enum Token {
    Crime = 0,
    Fraud = 1,
}

impl Token {
    pub fn from_is_crime(is_crime: bool) -> Self {
        if is_crime { Token::Crime } else { Token::Fraud }
    }
}
```

### Epoch Program ID Update Pattern

```rust
// Source: Existing tax-program/src/constants.rs pattern
// After Epoch Program deployment:
pub fn epoch_program_id() -> Pubkey {
    // TODO: Replace with actual deployed program ID
    // This MUST match the declare_id! in epoch-program/src/lib.rs
    Pubkey::from_str("Epoc1111111111111111111111111111111111111111").unwrap()
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded tax rates | Dynamic EpochState reading | Phase 22 | Tax rates can change per epoch |
| Placeholder epoch_program_id | Real deployed program ID | After Epoch Program deploy | Cross-program validation works |
| No EpochState account in swaps | Required account | Phase 22 | Breaking change to instruction signatures |

**Deprecated/outdated:**
- Hardcoded `tax_bps: u16 = 400` in swap handlers (replaced with EpochState read)
- Hardcoded `tax_bps: u16 = 1400` in swap_sol_sell (replaced with EpochState read)
- Legacy VRF CPI callback pattern (project uses Switchboard On-Demand client-side)

## Open Questions

Things that couldn't be fully resolved:

1. **Enum Serialization Format**
   - What we know: Anchor uses Borsh, enums serialize as `u8` discriminant by default
   - What's unclear: Whether `Token` enum in spec uses 0/1 or different values
   - Recommendation: Use explicit `#[repr(u8)]` and document: CRIME=0, FRAUD=1

2. **Rate Bounds Validation in Tax Program**
   - What we know: CONTEXT.md marks this as "Claude's Discretion"
   - Options: (a) Trust EpochState values, (b) Add defense-in-depth bounds check
   - Recommendation: Add bounds check (100-1400 bps) as defense-in-depth; costs minimal compute

3. **Carnage Signer PDA Verification**
   - What we know: swap_exempt already has `seeds::program = epoch_program_id()` constraint
   - What's unclear: Whether carnage_signer PDA seeds will match CARNAGE_SIGNER_SEED constant
   - Recommendation: Verify seeds match spec Section 4.4 during implementation

## Sources

### Primary (HIGH confidence)
- Epoch_State_Machine_Spec.md - EpochState account structure (Section 4.1), get_tax_bps pattern (Section 10), initialize_epoch_state (Section 8.1)
- Tax_Pool_Logic_Spec.md - Tax Program architecture (Section 2), cross-program references (Section 2.3)
- VRF_Implementation_Reference.md - Cross-program deserialization pattern (Section 3.3)
- Existing codebase: tax-program/src/instructions/*.rs, tax-program/src/constants.rs

### Secondary (MEDIUM confidence)
- [RareSkills: Reading Another Anchor Program's Account Data](https://rareskills.io/post/anchor-read-account) - Verified discriminator and deserialization patterns
- [Anchor Documentation: Account Types](https://www.anchor-lang.com/docs/account-types) - Account<T> ownership constraints
- [Solana Documentation: Accounts](https://solana.com/docs/core/accounts) - PDA derivation, owner field semantics

### Tertiary (LOW confidence)
- None - all critical patterns verified with primary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Using existing project patterns and Anchor conventions
- Architecture: HIGH - Well-documented in Epoch_State_Machine_Spec.md and VRF_Implementation_Reference.md
- Pitfalls: HIGH - Based on verified Anchor discriminator behavior and project experience

**Research date:** 2026-02-06
**Valid until:** 2026-03-06 (30 days - Anchor patterns are stable)
