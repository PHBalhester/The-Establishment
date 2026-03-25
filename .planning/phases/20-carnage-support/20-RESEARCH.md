# Phase 20: Tax Program Carnage Support - Research

**Researched:** 2026-02-06
**Domain:** Solana CPI authorization, PDA signer verification, tax-exempt swap routing
**Confidence:** HIGH

## Summary

This phase implements `swap_exempt`, a specialized Tax Program instruction that allows the Epoch Program's Carnage Fund to execute tax-free swaps. The key challenge is implementing cryptographic PDA signer verification to ensure only the Epoch Program's Carnage signer PDA can invoke this instruction.

The existing Tax Program architecture (Phase 18-19) provides solid patterns for AMM CPI routing. The new `swap_exempt` instruction follows the same structure as `swap_sol_buy` but replaces user signing with Carnage PDA signing and removes tax calculation/distribution entirely. The instruction must operate at CPI depth 1 (when called from Epoch Program's VRF callback), leaving exactly 3 more levels for AMM -> Token-2022 -> Transfer Hook, which is exactly at Solana's hard limit of 4.

The core security requirement is ensuring direct user calls to `swap_exempt` fail immediately with `UnauthorizedCarnageCall` error. This is achieved by requiring the Carnage signer PDA (derived from Epoch Program with seeds `["carnage_signer"]`) as the first signer account and verifying both the PDA derivation AND its signature.

**Primary recommendation:** Use Anchor's `seeds::program` constraint pattern (same as AMM's swap_authority verification) to verify the Carnage PDA is derived from the Epoch Program ID, combined with `Signer` type to require actual signature.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Anchor | 0.30.x | PDA derivation and signer constraints | Already used throughout codebase |
| anchor-spl | 0.30.x | Token-2022 transfer integration | Required for transfer_checked CPI |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| solana-sdk | 2.1.x | CPI primitives, invoke_signed | Raw instruction building |
| sha2 | 0.10.x | Anchor discriminator generation | Manual CPI instruction building |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual PDA verification | Trust owner check only | Less secure - attacker could pass any account owned by Epoch Program |
| Hardcoded Epoch Program ID | Account-passed program ID | Hardcoded is safer - prevents substitution attacks |

**No installation required** - all dependencies already in project.

## Architecture Patterns

### Recommended Project Structure
```
programs/tax-program/src/
  instructions/
    mod.rs                    # Add swap_exempt module export
    swap_exempt.rs            # New file - Carnage tax-exempt swap instruction
  constants.rs                # Add EPOCH_PROGRAM_ID, CARNAGE_SIGNER_SEED
  errors.rs                   # UnauthorizedCarnageCall already exists
  events.rs                   # Optional: CarnageSwap event
```

### Pattern 1: Cross-Program PDA Signer Verification
**What:** Anchor constraint that verifies a PDA was derived from a specific external program
**When to use:** When accepting a PDA signer from another program as authorization
**Example:**
```rust
// Source: AMM swap_sol_pool.rs (existing pattern in codebase)
#[account(
    seeds = [CARNAGE_SIGNER_SEED],
    bump,
    seeds::program = EPOCH_PROGRAM_ID,
)]
pub carnage_authority: Signer<'info>,
```

**Why this works:**
1. `Signer` type ensures the account actually signed the transaction
2. `seeds` + `seeds::program` verifies the PDA derivation matches expected seeds from expected program
3. Combined, these guarantee only Epoch Program's `invoke_signed` can pass this check

### Pattern 2: Simplified Account Struct (No User, No Tax Distribution)
**What:** Account struct without user signer, tax distribution targets, or epoch_state
**When to use:** For Carnage-only instructions that bypass taxation
**Example:**
```rust
#[derive(Accounts)]
pub struct SwapExempt<'info> {
    /// Carnage authority PDA from Epoch Program - must sign
    #[account(
        seeds = [CARNAGE_SIGNER_SEED],
        bump,
        seeds::program = EPOCH_PROGRAM_ID,
    )]
    pub carnage_authority: Signer<'info>,

    /// Tax Program's swap_authority PDA - signs AMM CPI
    #[account(
        seeds = [SWAP_AUTHORITY_SEED],
        bump,
    )]
    pub swap_authority: AccountInfo<'info>,

    // Pool and vault accounts (same as swap_sol_buy)
    #[account(mut)]
    pub pool: AccountInfo<'info>,
    // ... remaining pool/vault/mint accounts
}
```

### Pattern 3: Buy-Only Instruction (Per CONTEXT.md Decision)
**What:** Single instruction variant scoped to SOL pool buys only
**When to use:** Carnage only buys from SOL pools (never PROFIT pools, per user context)
**Example:**
```rust
/// Execute tax-exempt SOL -> CRIME/FRAUD swap for Carnage Fund.
///
/// ARCHITECTURAL CONSTRAINT: This instruction adds CPI depth 1.
/// The full Carnage CPI chain is:
///   Epoch::vrf_callback (entry) -> Tax::swap_exempt (depth 1)
///   -> AMM::swap (depth 2) -> Token-2022::transfer_checked (depth 3)
///   -> Transfer Hook::execute (depth 4 -- SOLANA LIMIT)
///
/// DO NOT add any CPI calls to this instruction path.
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, SwapExempt<'info>>,
    amount_in: u64,
    is_crime: bool,
) -> Result<()> {
    // No slippage parameter per Carnage_Fund_Spec.md Section 9.3
    // Carnage executes without minimum output protection
```

### Anti-Patterns to Avoid
- **Trusting account owner without PDA re-derivation:** An attacker could craft an account owned by Epoch Program that isn't the Carnage signer PDA
- **Adding CPI calls to swap_exempt:** Would exceed Solana's depth-4 limit when called from Carnage
- **Using Account type instead of Signer for carnage_authority:** Would allow unsigned accounts to pass constraint checks
- **Accepting PROFIT pools:** Carnage never operates on PROFIT pools per CONTEXT.md

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PDA verification | Manual pubkey comparison | Anchor `seeds::program` constraint | Anchor constraint is compiled-time checked, less error-prone |
| AMM CPI | New instruction builder | Existing raw instruction pattern from swap_sol_buy | Tested and working in 10+ integration tests |
| Discriminator calculation | Manual sha256 | anchor_discriminator helper from tests | Consistent with existing code |

**Key insight:** The swap_sol_buy handler already contains 95% of the logic needed for swap_exempt. The difference is: no tax calculation, no tax distribution, Carnage PDA signs instead of user.

## Common Pitfalls

### Pitfall 1: Forgetting seeds::program in PDA verification
**What goes wrong:** Instruction only checks `seeds = [CARNAGE_SIGNER_SEED]` without `seeds::program`
**Why it happens:** Developer assumes seeds are enough, forgetting PDAs are program-specific
**How to avoid:** Always pair `seeds` with `seeds::program` for cross-program PDAs
**Warning signs:** Tests pass with correct Epoch Program but would accept any program's PDA

### Pitfall 2: Using Account Instead of Signer
**What goes wrong:** Account constraint passes but unauthorized callers can invoke instruction
**Why it happens:** Anchor's `seeds` constraint verifies derivation but not signature
**How to avoid:** Use `Signer<'info>` type for carnage_authority
**Warning signs:** Direct user calls don't fail with signature error

### Pitfall 3: Adding Event Emission Without Considering CPI Depth
**What goes wrong:** Adding emit! or msg! macro increases compute but isn't the problem; adding CPI would exceed depth
**Why it happens:** Developer adds logging/events without checking depth impact
**How to avoid:** swap_exempt emits no events (Epoch Program emits CarnageExecuted); all logging is within same program
**Warning signs:** Integration tests fail with CPI depth exceeded

### Pitfall 4: Passing minimum_output Parameter
**What goes wrong:** Including slippage protection causes Carnage failures when market moves
**Why it happens:** Copy-paste from swap_sol_buy without reading Carnage_Fund_Spec.md Section 9.3
**How to avoid:** swap_exempt takes no minimum_output; Carnage is designed to execute regardless
**Warning signs:** Carnage swaps fail intermittently during volatility

### Pitfall 5: Testing Only Happy Path
**What goes wrong:** Unauthorized call test missing, security hole ships
**Why it happens:** Developer focuses on "does it work" not "does it reject unauthorized"
**How to avoid:** Write negative test first: direct user call MUST fail with UnauthorizedCarnageCall
**Warning signs:** No test explicitly verifies rejection of non-Carnage callers

## Code Examples

Verified patterns from project codebase:

### PDA Signer Verification Pattern (from AMM swap_sol_pool.rs)
```rust
// Source: programs/amm/src/instructions/swap_sol_pool.rs lines 367-372
#[account(
    seeds = [SWAP_AUTHORITY_SEED],
    bump,
    seeds::program = TAX_PROGRAM_ID,
)]
pub swap_authority: Signer<'info>,
```

This exact pattern applies to Carnage PDA verification:
```rust
// Apply same pattern for Carnage signer
#[account(
    seeds = [CARNAGE_SIGNER_SEED],
    bump,
    seeds::program = EPOCH_PROGRAM_ID,
)]
pub carnage_authority: Signer<'info>,
```

### Raw CPI Instruction Building (from swap_sol_buy.rs)
```rust
// Source: programs/tax-program/src/instructions/swap_sol_buy.rs lines 177-191
const AMM_SWAP_SOL_POOL_DISCRIMINATOR: [u8; 8] = [0xde, 0x80, 0x1e, 0x7b, 0x55, 0x27, 0x91, 0x8a];

let mut ix_data = Vec::with_capacity(25);
ix_data.extend_from_slice(&AMM_SWAP_SOL_POOL_DISCRIMINATOR);
ix_data.extend_from_slice(&sol_to_swap.to_le_bytes());
ix_data.push(0u8); // SwapDirection::AtoB = 0
ix_data.extend_from_slice(&minimum_output.to_le_bytes());

let ix = Instruction {
    program_id: ctx.accounts.amm_program.key(),
    accounts: account_metas,
    data: ix_data,
};
```

### Test Pattern for Unauthorized Access (recommended)
```rust
// Pattern to verify direct user calls fail
#[test]
fn test_swap_exempt_rejects_direct_user_call() {
    let mut ctx = SwapExemptTestContext::setup();

    // Create a fake "carnage_authority" that user controls
    let fake_carnage = LiteKeypair::new();
    ctx.svm.airdrop(&fake_carnage.pubkey(), 1_000_000).expect("airdrop");

    // Attempt swap_exempt with user-controlled signer instead of Carnage PDA
    let result = send_swap_exempt_with_signer(&mut ctx, &fake_carnage, 1_000_000_000, true);

    // Must fail - the fake signer won't match the PDA derivation
    assert!(result.is_err(), "Direct call with non-Carnage signer must fail");
    // Verify specific error code if possible
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Whitelist check (boolean flag) | PDA signer verification | Anchor best practice | Cryptographic enforcement, cannot be bypassed |
| Multiple exempt instructions | Single swap_exempt | Project decision | Simpler codebase, matches actual Carnage behavior (buy only) |

**Deprecated/outdated:**
- None relevant - this is greenfield implementation

## Open Questions

Things that couldn't be fully resolved:

1. **Epoch Program ID value**
   - What we know: Epoch Program doesn't exist yet; Tax Program needs its ID for PDA verification
   - What's unclear: Whether Epoch Program will be deployed with predictable address or random
   - Recommendation: Use placeholder pubkey constant, update during Epoch Program implementation

2. **Carnage vault accounts for input/output**
   - What we know: Carnage has its own SOL vault and token vaults (per Carnage_Fund_Spec.md)
   - What's unclear: Exact PDA seeds for Carnage token accounts that will be swap input/output
   - Recommendation: Use generic user_token_a/user_token_b naming as in swap_sol_buy; Epoch Program passes correct accounts

3. **Event emission decision**
   - What we know: CONTEXT.md marks this as Claude's discretion
   - Options: (A) swap_exempt emits own event, (B) rely on Epoch's CarnageExecuted event
   - Recommendation: Option B - no Tax Program event. Reduces compute budget usage and avoids CPI depth concerns. Epoch Program's CarnageExecuted event provides complete audit trail.

## Sources

### Primary (HIGH confidence)
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/amm/src/instructions/swap_sol_pool.rs` - PDA signer verification pattern (lines 367-372)
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/tax-program/src/instructions/swap_sol_buy.rs` - CPI instruction building pattern
- `/Users/mlbob/Projects/Dr Fraudsworth/Docs/Tax_Pool_Logic_Spec.md` - Section 13.3 (Carnage PDA seeds), Section 19.1 (UnauthorizedCarnageCall error)
- `/Users/mlbob/Projects/Dr Fraudsworth/Docs/Carnage_Fund_Spec.md` - Section 2 (CPI depth), Section 9.3 (no slippage), Section 16.1 (PDA signer requirement)
- `https://solana.com/docs/core/cpi.md` - Confirmed max CPI depth is 4 (stack height 5)

### Secondary (MEDIUM confidence)
- `/Users/mlbob/Projects/Dr Fraudsworth/Docs/Epoch_State_Machine_Spec.md` - Carnage execution flow context

### Tertiary (LOW confidence)
- None - all findings verified with primary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - using existing project dependencies
- Architecture: HIGH - following proven AMM/Tax Program patterns from codebase
- Pitfalls: HIGH - derived from actual failure modes in similar CPI authorization code

**Research date:** 2026-02-06
**Valid until:** 2026-03-06 (30 days - stable patterns, no external dependency changes expected)

---

## Implementation Recommendations (Claude's Discretion Items)

Based on research, here are recommendations for items marked as Claude's discretion in CONTEXT.md:

### Instruction Variants
**Recommendation:** Single `swap_exempt` instruction, not separate buy/sell variants
**Rationale:** Carnage only buys (per CONTEXT.md: "Carnage will never buy from PROFIT pools"). One instruction is simpler and matches actual behavior.

### Pool Scope
**Recommendation:** SOL pools only, reject PROFIT pools explicitly
**Rationale:** Simplicity per CONTEXT.md guidance. Add explicit `InvalidPoolType` error if someone passes a PROFIT pool.

### Event Emission
**Recommendation:** No event from swap_exempt
**Rationale:** Epoch Program emits CarnageExecuted with full details. Duplicate event wastes compute, adds no value.

### Program ID Source
**Recommendation:** Hardcode EPOCH_PROGRAM_ID constant (like TAX_PROGRAM_ID in AMM)
**Rationale:** Prevents substitution attacks, follows established project pattern.

### PDA Verification Method
**Recommendation:** Re-derive via Anchor seeds::program constraint
**Rationale:** Cryptographic verification, compiler-checked, follows AMM pattern.

### Bump Seed Storage
**Recommendation:** Derive fresh (use `bump` in constraint)
**Rationale:** Simpler, no additional state needed, follows project pattern.

### Error Granularity
**Recommendation:** Single UnauthorizedCarnageCall error (already exists in errors.rs)
**Rationale:** Simpler, error already defined per spec.

### PROFIT Pool Handling
**Recommendation:** Explicit InvalidPoolType error if PROFIT pool passed
**Rationale:** Fail fast with clear error rather than silent unexpected behavior.

### CPI Error Handling
**Recommendation:** Propagate AMM errors directly (no wrapping)
**Rationale:** Simpler debugging, AMM errors are already descriptive.

### Input Validation
**Recommendation:** Check non-zero upfront (same as swap_sol_buy line 88)
**Rationale:** Fail fast, consistent with existing pattern.
