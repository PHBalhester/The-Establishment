# Phase 46: Account Validation Security - Research

**Researched:** 2026-02-18
**Domain:** Solana/Anchor account constraint validation, adversarial testing
**Confidence:** HIGH

## Summary

This phase addresses Fortress Security Audit P0 findings (CRIT-01, CRIT-02, CRIT-03) and P1 finding SEC-07, which collectively represent the most critical vulnerability class in the protocol: unvalidated accounts that receive funds or execute CPI calls.

**Critical discovery: The P0 security constraints have ALREADY been applied** in commit `2a0e326` (2026-02-13, "fix(37-01): apply P0 security constraints to all vulnerable accounts"). The current codebase already has PDA seeds constraints on `staking_escrow` and `carnage_vault`, `address` constraints on `treasury`, `amm_program`, `tax_program`, and `staking_program` (Tax Program), `owner` constraints on `randomness_account` (Epoch Program), and `owner ==` constraint on `carnage_wsol` (Epoch Program).

However, there is **one unflagged gap**: `consume_randomness.rs` line 69 has `staking_program` as a bare `AccountInfo<'info>` with NO address constraint. This is a CPI target used for `update_cumulative` -- a fake staking program could accept the call and not update staking state. There is also potential for enhanced error messaging (addresses in logs) and the primary deliverable is the comprehensive adversarial test suite.

**Primary recommendation:** Verify existing constraints are complete and correct, fix the one unflagged gap (consume_randomness staking_program), enhance error messages with address logging, and build the adversarial test matrix (15+ tests).

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| anchor-lang | 0.32.1 | Solana framework with account constraints | Already in use across all 5 programs |
| @coral-xyz/anchor | (matching) | TypeScript test SDK | Already used in all test files |
| switchboard-on-demand | 0.11.3+ | VRF randomness | Already in use for Epoch Program |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @solana/web3.js | (existing) | Transaction building for attack tests | Test infrastructure |
| @solana/spl-token | (existing) | Token account creation for test setup | Test infrastructure |
| chai | (existing) | Assertion library for tests | Already used in test suite |
| ts-mocha | (existing) | Test runner | Already configured in Anchor.toml |

### Alternatives Considered
No alternatives needed -- this phase uses the existing stack exclusively. The only changes are constraint additions to existing Rust code and new TypeScript test files.

## Architecture Patterns

### Current Validation Pattern Inventory

The codebase already uses three distinct account validation mechanisms. Understanding these is critical for the planner.

#### Pattern 1: PDA Seeds Constraint (for cross-program PDAs)
**What:** Anchor's `seeds + bump + seeds::program` derives the expected PDA and fails if the provided account doesn't match.
**Where used:** `staking_escrow`, `carnage_vault`, `stake_pool`, `carnage_authority`, `carnage_state`, `epoch_state`, `sol_vault`, `carnage_signer`
**Example (already in codebase):**
```rust
// Source: programs/tax-program/src/instructions/swap_sol_buy.rs:392-398
#[account(
    mut,
    seeds = [ESCROW_VAULT_SEED],
    bump,
    seeds::program = staking_program_id(),
)]
pub staking_escrow: AccountInfo<'info>,
```
**Error behavior:** Returns Anchor error code 2006 (ConstraintSeeds) with no address detail. Custom error can be added with `@ TaxError::InvalidStakingEscrow`.

#### Pattern 2: Address Constraint (for known program IDs and EOA addresses)
**What:** Anchor's `address = <expr>` checks the account's key matches a known pubkey.
**Where used:** `amm_program`, `tax_program`, `staking_program` (Tax Program only), `treasury`
**Example (already in codebase):**
```rust
// Source: programs/tax-program/src/instructions/swap_sol_buy.rs:414-415
#[account(
    mut,
    address = treasury_pubkey() @ TaxError::InvalidTreasury,
)]
pub treasury: AccountInfo<'info>,
```
**Error behavior:** Returns custom error code (6000+) when using `@ CustomError`, or Anchor 2012 (ConstraintAddress) without.

#### Pattern 3: Owner Constraint (for program ownership validation)
**What:** Anchor's `owner = <const_pubkey>` or manual `constraint = account.owner == <expr>` checks the runtime owner field.
**Where used:** `randomness_account` (owner = SWITCHBOARD_PROGRAM_ID), `carnage_wsol` (constraint on .owner field)
**Example (already in codebase):**
```rust
// Source: programs/epoch-program/src/instructions/trigger_epoch_transition.rs:48
#[account(owner = SWITCHBOARD_PROGRAM_ID)]
pub randomness_account: AccountInfo<'info>,

// Source: programs/epoch-program/src/instructions/execute_carnage_atomic.rs:90-91
#[account(
    mut,
    constraint = carnage_wsol.owner == carnage_signer.key()
        @ EpochError::InvalidCarnageWsolOwner,
)]
pub carnage_wsol: Box<InterfaceAccount<'info, TokenAccount>>,
```
**Error behavior:** `owner =` returns Anchor 2015 (ConstraintOwner). `constraint =` with `@` returns custom error.

### Recommended Project Structure for Changes
```
programs/
  epoch-program/src/
    constants.rs          # ADD: staking_program_id() function
    instructions/
      consume_randomness.rs  # FIX: add address constraint on staking_program
  tax-program/src/
    (no structural changes -- constraints already in place)
tests/
  security-account-validation.ts  # NEW: adversarial test matrix
```

### Anti-Patterns to Avoid
- **Bare AccountInfo for fund destinations:** Never use `#[account(mut)] pub dest: AccountInfo<'info>` for an account that receives SOL/tokens without PDA seeds, address, or owner validation.
- **CHECK comments as validation:** A `/// CHECK:` comment is documentation, not enforcement. The actual Anchor constraint attribute is what the runtime verifies.
- **Trusting downstream CPI validation:** "Validated by AMM CPI" is not defense-in-depth. If the AMM program ID is fake, the CPI validation is fake too.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PDA address verification | Manual `require!(account.key() == Pubkey::find_program_address(...))` | `seeds + bump + seeds::program` Anchor constraint | Anchor's generated code is audited, handles bump finding, and produces consistent error codes |
| Program ID checking | Manual `require!(program.key() == KNOWN_ID)` in handler body | `#[account(address = known_id())]` constraint | Fails at deserialization before handler runs -- cannot be bypassed by handler bugs |
| Token account ownership | Manual check in handler | `InterfaceAccount<'info, TokenAccount>` with `constraint = account.owner == expected` | Anchor deserializes and validates the token account structure automatically |

## Common Pitfalls

### Pitfall 1: Thinking Constraints Are Already Complete When They Aren't
**What goes wrong:** The P0 fix commit (2a0e326) applied constraints to the flagged accounts but missed `staking_program` in `consume_randomness.rs`. The comment says "Program ID validated during CPI invocation" -- but this is false. A fake program can accept any CPI call and do nothing.
**Why it happens:** The audit flagged specific files, and the fix only touched those files. The consume_randomness staking_program was not explicitly flagged.
**How to avoid:** Systematic audit of ALL `AccountInfo<'info>` fields that serve as CPI targets, not just the ones the audit flagged.
**Warning signs:** Any `/// CHECK: Validated by <other program>` comment on a program AccountInfo that lacks an `address` constraint.

### Pitfall 2: Anchor `address` Constraint vs `Program<>` Type
**What goes wrong:** Using `AccountInfo<'info>` with `#[account(address = ...)]` validates the address but does NOT check the account is executable (is a program). A frozen regular account at a known address could pass the address check.
**Why it happens:** `address` only checks the pubkey, not the account properties.
**How to avoid:** For program accounts used as CPI targets, either use `Program<'info, SomeProgram>` (validates executable) or `#[account(address = ..., executable)]`. However, in this codebase, `address = known_program_id()` is sufficient because: (a) program IDs are derived from keypairs we control, (b) a non-executable account at these addresses would fail CPI anyway, and (c) `Program<>` type requires a CPI module which doesn't exist for raw CPI targets.
**Warning signs:** N/A in this codebase -- the `address` constraint pattern is the correct choice here.

### Pitfall 3: Error Messages Without Addresses
**What goes wrong:** When a constraint fires, the default Anchor error is generic ("ConstraintAddress" with code 2012). On devnet, this makes it very difficult to debug which account failed and why.
**Why it happens:** Anchor's `#[msg("...")]` on error variants only supports static strings at compile time.
**How to avoid:** Use `msg!()` logging before `require!()` checks, or use Anchor's `@ CustomError` syntax for constraint errors and add `msg!()` calls in the handler body for additional context. The `msg!()` output appears in transaction logs.
**Warning signs:** Constraint failures in test output that just say "Error Code: ConstraintAddress" with no indication of which address was expected.

### Pitfall 4: Test Setup Complexity for Attack Simulation
**What goes wrong:** Adversarial tests need to pass fake accounts to instructions that normally use real accounts. But the fake accounts must be realistic enough that the transaction doesn't fail for unrelated reasons before reaching the constraint under test.
**Why it happens:** Solana transactions fail at the first error. If a fake treasury account is also uninitialized (0 lamports), the transaction might fail on rent exemption before reaching the address constraint.
**How to avoid:** Create properly-funded Keypair accounts for fake substitutions. The fake account needs lamports (for system account targets) but a wrong address. For PDA substitutions, use a different seed to derive a valid PDA that simply isn't the expected one.
**Warning signs:** Test failures with unexpected error codes that don't match the constraint being tested.

### Pitfall 5: Treasury Validation and Phase 50 Conflict
**What goes wrong:** Hardcoding `treasury_pubkey()` as a const function that returns a fixed Pubkey works for now, but Phase 50 makes treasury configurable. If the address constraint uses `address = treasury_pubkey()`, changing to a stored-in-state approach requires modifying every instruction struct.
**Why it happens:** The `address` constraint evaluates at deserialization time and needs a compile-time-resolvable expression.
**How to avoid:** The current `address = treasury_pubkey()` pattern is correct for now. Phase 50's refactor to configurable treasury will need to change this to reading from a config PDA (e.g., `constraint = treasury.key() == config_state.treasury_pubkey`). This is a known, scoped change.
**Warning signs:** Attempts to store treasury in state now would add unnecessary complexity and a new PDA that doesn't exist yet.

## Code Examples

### Example 1: Fixing consume_randomness staking_program
```rust
// BEFORE (current code, consume_randomness.rs:66-69):
/// Staking Program.
/// CHECK: Program ID validated during CPI invocation.
pub staking_program: AccountInfo<'info>,

// AFTER (with address constraint):
/// Staking Program for update_cumulative CPI.
/// CHECK: Address validated against known Staking program ID
#[account(address = staking_program_id())]
pub staking_program: AccountInfo<'info>,
```
This requires adding `staking_program_id()` to `epoch-program/src/constants.rs` (it already exists in `tax-program/src/constants.rs`).

### Example 2: Enhanced Error Logging Pattern
```rust
// In handler body, before CPI or after constraint, add msg! for debugging:
msg!(
    "Tax distribution validated: escrow={}, vault={}, treasury={}",
    ctx.accounts.staking_escrow.key(),
    ctx.accounts.carnage_vault.key(),
    ctx.accounts.treasury.key(),
);
```
Note: This runs AFTER constraint validation passes. For failed constraints, the Anchor error code and the custom error variant name are logged automatically. The `@ TaxError::InvalidTreasury` syntax ensures the error name is meaningful.

### Example 3: Adversarial Test Pattern (TypeScript)
```typescript
// Pattern for testing account substitution rejection:
it("rejects fake staking_escrow in swap_sol_buy", async () => {
  const fakeEscrow = Keypair.generate();
  // Fund fake account so it's rent-exempt (prevents unrelated failures)
  await airdrop(connection, fakeEscrow.publicKey, LAMPORTS_PER_SOL);

  try {
    await program.methods
      .swapSolBuy(new BN(amount), new BN(0), true)
      .accounts({
        // ... all correct accounts EXCEPT:
        stakingEscrow: fakeEscrow.publicKey, // SUBSTITUTED
        // ... rest of accounts
      })
      .remainingAccounts(hookAccounts)
      .rpc();
    expect.fail("Should have rejected fake staking_escrow");
  } catch (err) {
    // Anchor PDA seeds constraint failure
    expect(err.error.errorCode.code).to.equal("ConstraintSeeds");
    // OR if using @ custom error:
    // expect(err.error.errorCode.code).to.equal("InvalidStakingEscrow");
  }
});
```

### Example 4: Existing Error Codes Already Defined
The codebase already has appropriate error variants defined:
```rust
// programs/tax-program/src/errors.rs (already exists):
InvalidStakingEscrow,   // "Staking escrow PDA mismatch"
InvalidCarnageVault,    // "Carnage vault PDA mismatch"
InvalidTreasury,        // "Treasury address mismatch"

// programs/epoch-program/src/errors.rs (already exists):
InvalidRandomnessOwner,      // "Randomness account not owned by Switchboard program"
InvalidCarnageWsolOwner,     // "Carnage WSOL account not owned by CarnageSigner PDA"
```
These error variants exist but some constraints don't use them (they use bare constraint without `@`). Enhancement opportunity: add `@ ErrorVariant` to all constraints for better error reporting.

## State of the Art

### Current Constraint Status (verified from code)

| Account | Instruction(s) | Constraint Type | Status | Custom Error |
|---------|----------------|-----------------|--------|--------------|
| staking_escrow | swap_sol_buy, swap_sol_sell | seeds + seeds::program | DONE | No (bare constraint) |
| carnage_vault | swap_sol_buy, swap_sol_sell | seeds + seeds::program | DONE | No (bare constraint) |
| treasury | swap_sol_buy, swap_sol_sell | address = treasury_pubkey() | DONE | Yes (@ TaxError::InvalidTreasury) |
| amm_program | All 5 Tax swap instructions | address = amm_program_id() | DONE | No (bare constraint) |
| staking_program | swap_sol_buy, swap_sol_sell | address = staking_program_id() | DONE | No (bare constraint) |
| tax_program | execute_carnage_atomic, execute_carnage | address = tax_program_id() | DONE | No (bare constraint) |
| amm_program | execute_carnage_atomic, execute_carnage | address = amm_program_id() | DONE | No (bare constraint) |
| randomness_account | trigger, consume, retry | owner = SWITCHBOARD_PROGRAM_ID | DONE | No (bare constraint) |
| carnage_wsol | execute_carnage_atomic, execute_carnage | constraint = .owner == carnage_signer | DONE | Yes (@ EpochError::InvalidCarnageWsolOwner) |
| **staking_program** | **consume_randomness** | **NONE** | **GAP** | N/A |

### Gap Analysis

**One unflagged gap found:**
- `consume_randomness.rs` line 69: `staking_program` is a bare `AccountInfo<'info>` used as a CPI target for `update_cumulative`. No address constraint. The comment "Program ID validated during CPI invocation" is misleading -- a fake program would accept the CPI and simply not update staking state, silently breaking yield accounting.

**Enhancement opportunities (not bugs, but improvements per CONTEXT.md decisions):**
1. Add `@ CustomError` to all bare constraints for better error messages
2. Add `msg!()` logging with expected vs actual addresses before key constraint checks
3. The `staking_program` gap in consume_randomness needs `address = staking_program_id()` and the epoch program needs a `staking_program_id()` constant function

## Adversarial Test Matrix

Based on the CONTEXT.md requirement for ~15+ tests covering every distinct account in every instruction, here is the complete matrix:

### SEC-01: Tax Distribution Destinations (6 tests)
| Test | Account | Instruction | Attack |
|------|---------|-------------|--------|
| 1 | staking_escrow | swap_sol_buy | Pass random keypair |
| 2 | staking_escrow | swap_sol_sell | Pass random keypair |
| 3 | carnage_vault | swap_sol_buy | Pass random keypair |
| 4 | carnage_vault | swap_sol_sell | Pass random keypair |
| 5 | treasury | swap_sol_buy | Pass random keypair |
| 6 | treasury | swap_sol_sell | Pass random keypair |

### SEC-02: CPI Program Targets (9 tests)
| Test | Account | Instruction | Attack |
|------|---------|-------------|--------|
| 7 | amm_program | swap_sol_buy | Pass System Program ID |
| 8 | amm_program | swap_sol_sell | Pass System Program ID |
| 9 | amm_program | swap_exempt | Pass System Program ID |
| 10 | amm_program | swap_profit_buy | Pass System Program ID |
| 11 | amm_program | swap_profit_sell | Pass System Program ID |
| 12 | tax_program | execute_carnage_atomic | Pass System Program ID |
| 13 | amm_program | execute_carnage_atomic | Pass System Program ID |
| 14 | staking_program (consume_randomness) | consume_randomness | Pass System Program ID |
| 15 | staking_program (swap_sol_buy) | swap_sol_buy | Pass System Program ID |

### SEC-03: VRF Randomness Owner (3 tests)
| Test | Account | Instruction | Attack |
|------|---------|-------------|--------|
| 16 | randomness_account | trigger_epoch_transition | Pass account owned by System Program |
| 17 | randomness_account | consume_randomness | Pass account owned by System Program |
| 18 | randomness_account | retry_epoch_vrf | Pass account owned by System Program |

### SEC-07: Carnage WSOL Ownership (2 tests)
| Test | Account | Instruction | Attack |
|------|---------|-------------|--------|
| 19 | carnage_wsol | execute_carnage_atomic | Pass WSOL owned by different authority |
| 20 | carnage_wsol | execute_carnage | Pass WSOL owned by different authority |

**Total: 20 tests** (exceeds the ~15+ requirement)

### Test Infrastructure Requirements
- Full program deployment (all 5 programs)
- Pool initialization (at least one SOL pool for swap tests)
- EpochState initialization (for VRF tests)
- CarnageFundState initialization (for carnage_wsol tests)
- Token mint setup (CRIME or FRAUD with transfer hook)
- User token accounts with balances
- Switchboard randomness account setup (for VRF tests, can mock owner)

### Test File Organization Recommendation
Create a new dedicated test file: `tests/security-account-validation.ts`

Rationale:
- The existing `security.ts` tests staking-specific attacks (inflation, flash loan, CPI forgery on deposit_rewards). Different scope.
- Account validation security spans Tax Program and Epoch Program. The existing security.ts only covers Staking Program.
- A new file avoids PDA conflicts (StakePool singleton issue documented in MEMORY.md).
- Clear naming maps to the phase name for traceability.

Add to `Anchor.toml`:
```
test-account-validation = "npx ts-mocha -p ./tsconfig.json -t 1000000 tests/security-account-validation.ts"
```

## Open Questions

1. **Should consume_randomness staking_program also use `@ EpochError::InvalidStakingProgram`?**
   - What we know: The epoch program's errors.rs doesn't have an InvalidStakingProgram variant. One would need to be added.
   - What's unclear: Whether the bare `address` constraint (returning ConstraintAddress) is sufficient or whether a custom error is preferred for consistency.
   - Recommendation: Add a new error variant for consistency with the project's error patterns. The additional code is minimal.

2. **Should we add `@ CustomError` to ALL existing bare constraints?**
   - What we know: Most constraints use bare form (no custom error). Only treasury and carnage_wsol use `@ CustomError`. Error variants already exist in errors.rs for staking_escrow and carnage_vault.
   - What's unclear: Whether this enhancement is worth the churn across ~15 constraint sites.
   - Recommendation: Yes, add them. The error variants already exist. This is a trivial change per site but significantly improves debuggability. The CONTEXT.md decision says "Include expected vs actual addresses in error data."

3. **Full integration test feasibility for VRF-related tests**
   - What we know: VRF tests need a Switchboard randomness account. On localnet, there's no real Switchboard oracle.
   - What's unclear: Whether we can test the `owner = SWITCHBOARD_PROGRAM_ID` constraint rejection without a real Switchboard account. We need to create an account owned by a different program.
   - Recommendation: For the "fake randomness" test, create a regular system account (owner = System Program). The `owner = SWITCHBOARD_PROGRAM_ID` constraint will reject it immediately. No need for a real Switchboard setup. For the "real randomness passes" direction, the existing devnet VRF tests already cover this.

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis of all 5 programs' instruction files
- Commit history: `2a0e326` ("fix(37-01): apply P0 security constraints to all vulnerable accounts")
- Fortress Security Audit FINAL_REPORT.md (CRIT-01, CRIT-02, CRIT-03)
- Anchor 0.32.1 constraint behavior (verified from existing codebase patterns)
- Error code ranges from [Anchor documentation](https://www.anchor-lang.com/docs/errors)

### Secondary (MEDIUM confidence)
- Phase 50 roadmap context for treasury configurability decision

### Tertiary (LOW confidence)
- None -- all findings verified from codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- existing stack, no new dependencies
- Architecture: HIGH -- patterns verified from 10+ existing instruction files
- Pitfalls: HIGH -- identified from actual code gaps and audit findings
- Test matrix: HIGH -- derived from exhaustive instruction/account enumeration

**Research date:** 2026-02-18
**Valid until:** 2026-03-18 (stable -- on-chain Rust with locked dependency versions)
