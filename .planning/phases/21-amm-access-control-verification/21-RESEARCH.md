# Phase 21: AMM Access Control Verification - Research

**Researched:** 2026-02-06
**Domain:** Solana/Anchor PDA Access Control Verification
**Confidence:** HIGH

## Summary

This phase verifies that the AMM enforces Tax Program-only access via the `seeds::program` constraint on `swap_authority`. Research examined the existing codebase implementation, Anchor constraint mechanics, and established verification patterns from Solana security best practices.

The verification approach combines **code review** (confirming the constraint is correctly implemented) with **integration testing** (proving bypass attempts fail). The codebase already contains comprehensive CPI access control tests in `test_cpi_access_control.rs` that cover most requirements. This phase needs to audit coverage gaps and ensure traceability to AUTH-03/AUTH-04.

**Primary recommendation:** Perform structured code review of all 4 AMM swap instructions, map existing tests to requirements, write gap tests if needed, and document findings in VERIFICATION.md.

## Standard Stack

Since this is a verification phase (not implementation), the "stack" is verification tooling.

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| LiteSVM | 0.9.1 | Fast Solana VM simulation | Already used in test_cpi_access_control.rs |
| Anchor | 0.30.x | Framework constraints | seeds::program is native Anchor |
| Rust/Cargo | stable | Test runner | cargo test integration |

### Supporting
| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| cargo test | n/a | Run integration tests | Executing existing/new tests |
| grep/code search | n/a | Code review | Finding constraint implementations |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| LiteSVM | bankrun | bankrun more common, but LiteSVM already integrated |
| Manual review | Semgrep | Custom rules possible but overkill for single verification |

## Architecture Patterns

### Verification Pattern: Code Review + Integration Test

```
Verification = Code Review (constraint exists) + Test (constraint enforced)

Code Review:
1. Locate swap_authority in SwapSolPool struct
2. Verify seeds = [SWAP_AUTHORITY_SEED]
3. Verify seeds::program = TAX_PROGRAM_ID
4. Verify Signer<'info> type enforces signature

Integration Test:
1. Direct AMM call without swap_authority signed -> FAIL
2. CPI from wrong program (forged PDA) -> FAIL
3. CPI from correct program (Tax Program) -> SUCCESS
```

### Existing Implementation Analysis

**AMM Access Control (swap_sol_pool.rs lines 367-372):**
```rust
#[account(
    seeds = [SWAP_AUTHORITY_SEED],
    bump,
    seeds::program = TAX_PROGRAM_ID,
)]
pub swap_authority: Signer<'info>,
```

**Key constraint mechanics:**
- `seeds = [SWAP_AUTHORITY_SEED]` - Anchor derives expected PDA address
- `seeds::program = TAX_PROGRAM_ID` - Derivation uses Tax Program ID, not AMM
- `Signer<'info>` - Account must have actually signed the transaction
- Anchor validates: `Pubkey::find_program_address(seeds, TAX_PROGRAM_ID) == swap_authority.key()`

**Same pattern in swap_profit_pool.rs (lines 291-296):**
```rust
#[account(
    seeds = [SWAP_AUTHORITY_SEED],
    bump,
    seeds::program = TAX_PROGRAM_ID,
)]
pub swap_authority: Signer<'info>,
```

### Constraint Error Codes

| Error | Anchor Code | Decimal | Meaning |
|-------|-------------|---------|---------|
| ConstraintSeeds | 0x7d6 | 2006 | PDA doesn't match expected derivation |
| AccountNotSigner | varies | varies | Account not marked as signer |

### Test Matrix (from CONTEXT.md)

| Instruction | Bypass Vector | Expected Result |
|-------------|---------------|-----------------|
| swap_sol_pool | Direct user call (no signer) | ConstraintSeeds or AccountNotSigner |
| swap_sol_pool | Forged PDA (wrong program) | ConstraintSeeds (0x7d6/2006) |
| swap_profit_pool | Direct user call (no signer) | ConstraintSeeds or AccountNotSigner |
| swap_profit_pool | Forged PDA (wrong program) | ConstraintSeeds (0x7d6/2006) |

## Don't Hand-Roll

This phase is verification-only, not implementation. However, important guidance:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PDA verification | Custom derivation check | Anchor's seeds::program constraint | Anchor handles canonicalization correctly |
| Test framework | Custom transaction builder | Existing LiteSVM helpers | Reuse test_cpi_access_control.rs patterns |
| Access control | Runtime program_id check | Anchor constraint at deserialization | Fail-fast before handler executes |

**Key insight:** Anchor's `seeds::program` constraint is the idiomatic solution. Verifying it's correctly applied is sufficient - no need for additional runtime checks.

## Common Pitfalls

### Pitfall 1: Incomplete Instruction Coverage
**What goes wrong:** Testing only one swap instruction, missing gaps in others
**Why it happens:** Copy-paste assumes consistency
**How to avoid:** Explicit checklist of all 4 instructions (swap_sol_pool AtoB, swap_sol_pool BtoA, swap_profit_pool AtoB, swap_profit_pool BtoA)
**Warning signs:** Verification doc only mentions one instruction

### Pitfall 2: Testing Wrong Error Path
**What goes wrong:** Test passes because transaction fails for different reason (missing account, wrong type)
**Why it happens:** Not asserting specific error code
**How to avoid:** Check error message/code contains expected constraint failure
**Warning signs:** Test just asserts `is_err()` without checking why

### Pitfall 3: Missing the Signer Requirement
**What goes wrong:** Focusing only on PDA derivation, missing that `Signer<'info>` also enforces signature
**Why it happens:** Two-layer protection (PDA + Signer) not understood
**How to avoid:** Document both protections in verification
**Warning signs:** Verification only mentions seeds::program

### Pitfall 4: Confusing Program IDs in Tests
**What goes wrong:** Test uses wrong Mock Tax vs Fake Tax program ID
**Why it happens:** Multiple program IDs in play (AMM, Mock Tax, Fake Tax, real Tax)
**How to avoid:** Clear mapping of program IDs in test context
**Warning signs:** Tests pass unexpectedly or fail for wrong reason

## Code Examples

### Existing Tests (test_cpi_access_control.rs)

**Direct call rejection test pattern:**
```rust
// Source: programs/amm/tests/test_cpi_access_control.rs
#[test]
fn test_direct_call_swap_sol_pool_fails() {
    let mut ctx = CpiTestContext::setup_sol_pool();
    let amount_in: u64 = 10_000_000;
    let mock_swap_authority = ctx.mock_swap_authority;

    // Try to call AMM directly - user can't sign the PDA
    let swap_data = swap_sol_pool_data(amount_in, DIRECTION_A_TO_B, 0);
    let result = send_direct_amm_swap(&mut ctx, &mock_swap_authority, swap_data);

    assert!(
        result.is_err(),
        "Direct call to swap_sol_pool should fail -- user cannot sign swap_authority PDA"
    );
}
```

**Fake Tax Program rejection test pattern:**
```rust
// Source: programs/amm/tests/test_cpi_access_control.rs
#[test]
fn test_fake_tax_cpi_swap_sol_pool_rejected() {
    let mut ctx = CpiTestContext::setup_sol_pool();
    let fake_swap_authority = ctx.fake_swap_authority;

    let amm_data = swap_sol_pool_data(amount_in, DIRECTION_A_TO_B, 0);
    let result = send_mock_tax_cpi_swap(
        &mut ctx,
        &fake_tax_program_id(),
        &fake_swap_authority,
        amm_data,
    );

    assert!(
        result.is_err(),
        "Fake Tax Program CPI should fail -- swap_authority PDA from wrong program"
    );
}
```

**Mock Tax Program success test pattern:**
```rust
// Source: programs/amm/tests/test_cpi_access_control.rs
#[test]
fn test_mock_tax_cpi_swap_sol_pool_a_to_b() {
    let mut ctx = CpiTestContext::setup_sol_pool();
    let mock_swap_authority = ctx.mock_swap_authority;

    let amm_data = swap_sol_pool_data(amount_in, DIRECTION_A_TO_B, 0);
    let result = send_mock_tax_cpi_swap(
        &mut ctx,
        &mock_tax_program_id(),
        &mock_swap_authority,
        amm_data,
    );

    assert!(result.is_ok(), "Mock Tax CPI swap_sol_pool AtoB should succeed");
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Runtime program_id check | Anchor seeds::program constraint | Anchor ~0.24 | Compile-time safety, fail-fast |
| Manual PDA derivation | Anchor seeds + bump constraint | Standard | Less error-prone, canonical bump |

**Current best practice (verified from Solana docs):**
- Use Anchor's `seeds::program` for cross-program PDA validation
- Combine with `Signer<'info>` to enforce signature
- Test both direct bypass AND forged PDA attacks

## Existing Test Coverage Analysis

From examining `test_cpi_access_control.rs`:

### Covered (HIGH confidence)
| Requirement | Test | Status |
|-------------|------|--------|
| AUTH-03: AMM verifies swap_authority | test_direct_call_swap_sol_pool_fails | Covered |
| AUTH-03: AMM verifies swap_authority | test_direct_call_swap_profit_pool_fails | Covered |
| AUTH-04: User cannot bypass | test_direct_call_with_wrong_signer_fails | Covered |
| AUTH-04: User cannot bypass | test_direct_call_with_user_pda_fails | Covered |
| AUTH-05: Wrong program rejected | test_fake_tax_cpi_swap_sol_pool_rejected | Covered |
| AUTH-05: Wrong program rejected | test_fake_tax_cpi_swap_profit_pool_rejected | Covered |

### Gaps Identified
| Gap | Description | Action |
|-----|-------------|--------|
| No REQ tags | Tests don't have explicit `REQ: AUTH-03` markers | Add markers |
| Program ID mismatch | Tests use Mock Tax ID (J5CK...) but production uses FV3k... | Note but acceptable for test isolation |

**Note on Program IDs:**
- Production TAX_PROGRAM_ID: `FV3kWDtSRDHTdd9fK9L1fkqdWis7Sts5x7nNS4uoSiiu`
- AMM constants.rs: Uses production ID
- Tests use Mock Tax Program: `J5CK3BiYwiQtt7Yfx3PLNrFr7YWCVGrskXiGvtYBqd5W`

The tests are valid because they prove the *pattern* works - the constraint mechanism rejects wrong program PDAs. The specific program ID is configurable.

## Verification Checklist

From this research, the planner should structure tasks around:

1. **Code Review Tasks:**
   - [ ] Verify swap_sol_pool has correct constraints (lines 367-372)
   - [ ] Verify swap_profit_pool has correct constraints (lines 291-296)
   - [ ] Verify TAX_PROGRAM_ID in constants.rs is production value
   - [ ] Verify SWAP_AUTHORITY_SEED matches between AMM and Tax Program

2. **Test Review Tasks:**
   - [ ] Map existing tests to AUTH-03, AUTH-04 requirements
   - [ ] Verify error codes match expected constraint failures
   - [ ] Confirm all 4 swap instructions have bypass coverage

3. **Documentation Tasks:**
   - [ ] Create VERIFICATION.md with Pass/Fail determination
   - [ ] Include traceability: REQ -> Code -> Test
   - [ ] Document any gaps found (for future phases)

## Open Questions

Things that couldn't be fully resolved:

1. **Test Error Code Assertions**
   - What we know: Tests assert `is_err()` but don't always verify specific error code
   - What's unclear: Whether existing tests validate the *right* error (ConstraintSeeds vs other)
   - Recommendation: During verification, inspect test assertions for specificity

2. **BtoA Direction Coverage**
   - What we know: Tests cover AtoB direction explicitly
   - What's unclear: Whether BtoA swap direction has explicit rejection tests
   - Recommendation: Verify during test mapping that both directions are covered

## Sources

### Primary (HIGH confidence)
- Codebase files: `programs/amm/src/instructions/swap_sol_pool.rs`, `swap_profit_pool.rs`
- Codebase files: `programs/amm/tests/test_cpi_access_control.rs`
- Codebase files: `programs/amm/src/constants.rs`

### Secondary (MEDIUM confidence)
- [Solana PDA Documentation](https://solana.com/docs/core/pda)
- [Anchor PDA Constraints](https://www.anchor-lang.com/docs/pdas)
- [Solana Bump Seed Canonicalization](https://solana.com/developers/courses/program-security/bump-seed-canonicalization)
- [Helius Solana Security Guide](https://www.helius.dev/blog/a-hitchhikers-guide-to-solana-program-security)

### Tertiary (LOW confidence)
- [Zealynx Solana Security Checklist](https://www.zealynx.io/blogs/solana-security-checklist) - General patterns

## Metadata

**Confidence breakdown:**
- Code review approach: HIGH - Direct codebase inspection confirms constraints
- Test coverage: HIGH - Extensive existing tests in test_cpi_access_control.rs
- Verification pattern: HIGH - Standard Anchor/Solana security audit pattern

**Research date:** 2026-02-06
**Valid until:** Indefinite (verification of stable implementation)
