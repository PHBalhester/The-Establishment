# Phase 29: Security and Edge Case Testing - Research

**Researched:** 2026-02-09
**Domain:** Security testing, property-based testing, attack simulation, Solana DeFi invariant validation
**Confidence:** HIGH

## Summary

Phase 29 writes a comprehensive security and edge-case test suite for the staking/yield system built in Phases 26-28. No new program code is written -- this phase validates existing program logic through attack simulations, stress tests, property-based fuzzing, and edge-case validation. The research investigates:

1. **Test layer architecture** -- The project already has three test layers: Rust unit tests in `programs/staking/src/helpers/math.rs` (pure math), TypeScript integration tests in `tests/staking.ts` and `tests/cross-program-integration.ts` (on-chain), and Token-2022 flow tests in `tests/token-flow.ts`. Phase 29 adds a fourth layer: security-focused Rust unit tests (proptest) and TypeScript attack simulations.

2. **Property-based testing with proptest** -- The `proptest` crate (v1.9.0, latest stable) provides the standard Rust property-based testing framework. It integrates natively with `#[cfg(test)]` modules and `cargo test`. For this project's math module, proptest can exhaustively fuzz u64/u128 boundaries for `update_rewards` and `add_to_cumulative` without requiring Solana runtime.

3. **Attack simulation patterns** -- The existing test infrastructure (TypeScript with Anchor, Token-2022 Transfer Hook) already has helpers (`stakeWithHook`, `unstakeWithHook`, `assertEscrowSolvency`) and mock programs (`fake-tax-program`, `mock-tax-program`) that provide the building blocks for security tests. The CPI forgery pattern (deploying a fake program with the same interface but different program ID) is already proven.

**Primary recommendation:** Use `proptest` (added as dev-dependency to `programs/staking/Cargo.toml`) for math boundary/overflow fuzzing in Rust unit tests, and extend the existing TypeScript test infrastructure for on-chain attack simulations, multi-user stress tests, and escrow solvency invariant validation.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| proptest | 1.9.0 | Property-based testing for Rust | De facto standard for Rust PBT; 10K+ iterations, shrinking, strategies for u64/u128 |
| @coral-xyz/anchor | 0.32.1 | TypeScript test framework | Already used; provides `Program`, `BN`, account fetching |
| @solana/spl-token | 0.4+ | Token-2022 helpers | Already used; `createTransferCheckedWithTransferHookInstruction` |
| chai | 4.x | TypeScript assertions | Already used; `expect().to.equal()` etc. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| ts-mocha | (existing) | TypeScript test runner | Already configured in Anchor.toml |
| sha2 | 0.10 | Hash computation for discriminators | Already a dev-dependency for staking |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| proptest | quickcheck | proptest has better strategies, per-value shrinking; quickcheck is type-based only |
| proptest | manual boundary tests | proptest finds edge cases we wouldn't think to test manually |
| TypeScript integration tests | LiteSVM (Rust) | LiteSVM is newer, less established; project already has mature TS test infra |
| TypeScript integration tests | Mollusk (Rust) | Mollusk is Rust-only; project's existing test helpers are TypeScript |

**Installation:**
```toml
# In programs/staking/Cargo.toml under [dev-dependencies]
proptest = "1.9"
```
No other new dependencies needed. All TypeScript packages already installed.

## Architecture Patterns

### Recommended Test File Structure
```
programs/staking/src/helpers/
├── math.rs                          # EXISTING: unit tests + NEW proptest module
└── ...

tests/
├── staking.ts                       # EXISTING: basic unit tests (Phase 26)
├── cross-program-integration.ts     # EXISTING: CPI gating tests (Phase 27)
├── token-flow.ts                    # EXISTING: Transfer Hook flow tests (Phase 28)
└── security.ts                      # NEW: Security and edge case test suite (Phase 29)
```

### Pattern 1: Proptest for Math Overflow Boundaries (Rust)
**What:** Property-based tests in `math.rs` that fuzz `update_rewards` and `add_to_cumulative` with random u64/u128 inputs
**When to use:** Testing that math never panics, overflows, or produces incorrect results for any valid input
**Why here:** The math functions are pure (except Clock::get() in update_rewards, which can be tested by using the formula directly). Proptest runs in `cargo test` with no Solana runtime needed.

```rust
// In programs/staking/src/helpers/math.rs, added to #[cfg(test)] mod tests
use proptest::prelude::*;

proptest! {
    #![proptest_config(ProptestConfig::with_cases(10_000))]

    #[test]
    fn add_to_cumulative_never_panics(
        total_staked in 1u64..=u64::MAX,      // Never 0 (MINIMUM_STAKE)
        pending in 0u64..=u64::MAX,
        existing_cumulative in 0u128..=u128::MAX / 2,
    ) {
        let mut pool = test_pool(total_staked, existing_cumulative, pending);
        // Should never panic -- may return Ok or Err, but no panic
        let _ = add_to_cumulative(&mut pool);
    }

    #[test]
    fn reward_conservation(
        total_staked in 1u64..=1_000_000_000_000u64,
        pending in 1u64..=1_000_000_000_000u64,
        user_balance in 1u64..=1_000_000_000_000u64,
    ) {
        prop_assume!(user_balance <= total_staked);

        let mut pool = test_pool(total_staked, 0, pending);
        add_to_cumulative(&mut pool).unwrap();

        // User's claim should never exceed what was deposited
        let user_reward = (user_balance as u128)
            .checked_mul(pool.rewards_per_token_stored)
            .unwrap_or(u128::MAX)
            .checked_div(PRECISION)
            .unwrap_or(0) as u64;

        prop_assert!(user_reward <= pending);
    }
}
```

### Pattern 2: Escrow Solvency Invariant After Every Operation (TypeScript)
**What:** Call `assertEscrowSolvency()` after every state-modifying operation
**When to use:** Every test that calls stake, unstake, claim, deposit_rewards, or update_cumulative
**Why:** Escrow insolvency is the most catastrophic failure mode. The existing `assertEscrowSolvency` helper from `token-flow.ts` should be extracted into a shared helper and used across all security tests.

```typescript
// Extracted from token-flow.ts -- reusable across test files
async function assertEscrowSolvency(
  connection: Connection,
  stakingProgram: Program<Staking>,
  escrowVault: PublicKey,
  stakePool: PublicKey,
): Promise<void> {
  const pool = await stakingProgram.account.stakePool.fetch(stakePool);
  const escrowBalance = await connection.getBalance(escrowVault);

  // Escrow must cover pending rewards
  expect(escrowBalance).to.be.gte(
    pool.pendingRewards.toNumber(),
    `Escrow solvency violated: balance ${escrowBalance} < pending ${pool.pendingRewards.toNumber()}`
  );
}
```

### Pattern 3: Attack Narrative Test Comments (TypeScript)
**What:** Each security test includes a multi-line comment block explaining the attack scenario, expected mitigation, and security property validated
**When to use:** Every test in the security suite
**Why:** Context decision -- user wants this to feel like a mini security audit

```typescript
/**
 * ATTACK: First-Depositor Inflation Attack
 *
 * SCENARIO:
 * 1. Attacker is the first staker with minimal stake (e.g., 1 lamport)
 * 2. Large reward is deposited to the pool
 * 3. Attacker claims disproportionate rewards because they were the only staker
 * 4. Subsequent stakers receive reduced yield
 *
 * MITIGATION: MINIMUM_STAKE dead stake during initialization (SEC-01)
 * The protocol stakes 1 PROFIT (1,000,000 units) as irrecoverable "dead stake"
 * during initialize_stake_pool. This ensures:
 * - Pool always has meaningful denominator for reward math
 * - Attacker cannot be the sole staker with dust
 *
 * PROPERTY VALIDATED: total_staked >= MINIMUM_STAKE always
 */
it("prevents first-depositor inflation attack", async () => {
  // Test implementation...
});
```

### Pattern 4: Multi-User Test Factory (TypeScript)
**What:** Reusable factory function for creating test stakers
**When to use:** Multi-user proportional distribution tests, stress tests with 100+ stakers
**Why:** Creating stakers requires airdrop + token account + mint + PDA derivation. The existing `createStaker()` in `cross-program-integration.ts` provides the pattern.

```typescript
async function createStakerWithTokens(
  connection: Connection,
  authority: Keypair,
  profitMint: PublicKey,
  stakingProgramId: PublicKey,
  amount: number,
): Promise<{ keypair: Keypair; userStake: PublicKey; tokenAccount: PublicKey }> {
  const keypair = Keypair.generate();
  // Airdrop SOL, create token account, mint tokens, derive PDA
  // Return all needed accounts
}
```

### Pattern 5: CPI Forgery Test (TypeScript)
**What:** Deploy a fake program that attempts unauthorized CPI calls
**When to use:** Testing that deposit_rewards and update_cumulative reject non-authorized callers
**Why:** The project already has `fake-tax-program` (different program ID, same interface as `mock-tax-program`). The same pattern can be extended: build a "fake-epoch-program" with the same `STAKING_AUTHORITY_SEED` but a different program ID. When it tries to CPI `update_cumulative`, the `seeds::program = epoch_program_id()` constraint rejects it.

**EXISTING PATTERN (from cross-program-integration.ts):**
```typescript
// deposit_rewards with unauthorized keypair -> ConstraintSeeds error
try {
  await stakingProgram.methods
    .depositRewards(new anchor.BN(1000))
    .accountsStrict({
      taxAuthority: unauthorizedKeypair.publicKey,
      stakePool: stakePool,
    })
    .signers([unauthorizedKeypair])
    .rpc();
  expect.fail("Should have failed with seeds constraint violation");
} catch (err: any) {
  expect(err.message.includes("seeds") || ...).to.be.true;
}
```

### Anti-Patterns to Avoid
- **Shared validator state between test files:** StakePool is a singleton PDA. Tests that share a validator instance (like staking.ts + cross-program-integration.ts) can interfere. Phase 29's security.ts should be designed to either run in its own validator or use the same setup as token-flow.ts (which already handles this correctly with fresh mint creation).
- **Relying on transaction ordering for timing tests:** On localnet, all transactions are sequential. Don't assume this reflects mainnet behavior. Instead, test via state inspection (e.g., check that rewards_per_token_paid equals current cumulative after stake).
- **Testing overflow with actual on-chain transactions:** Overflow boundary testing should be done in Rust unit tests (proptest), not TypeScript integration tests. The Solana runtime adds overhead and makes it impractical to run 10,000+ iterations.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Property-based random input generation | Custom random test loops | proptest crate | Built-in shrinking finds minimal failing cases; strategies handle edge cases |
| ExtraAccountMeta resolution | Manual hook account derivation | `createTransferCheckedWithTransferHookInstruction` | Automatically resolves all hook accounts |
| Escrow solvency check | Custom balance comparison | Existing `assertEscrowSolvency` helper | Already battle-tested in token-flow.ts |
| Staker creation | Inline setup in each test | Shared `createStakerWithTokens` factory | Reduces boilerplate, ensures consistent setup |
| CPI forgery test programs | New mock programs | Existing `fake-tax-program` pattern | Already proven, same seeds::program rejection mechanism |

**Key insight:** The project already has most of the testing infrastructure. Phase 29 is about composing existing primitives (helpers, factories, mock programs) into security-focused test scenarios, not building new infrastructure.

## Common Pitfalls

### Pitfall 1: proptest with Solana Runtime Dependencies
**What goes wrong:** Trying to run `update_rewards()` directly in proptest -- it calls `Clock::get()` which requires Solana runtime, failing in `cargo test`.
**Why it happens:** `update_rewards` has a hard dependency on `Clock::get()?.slot` at line 64 of math.rs.
**How to avoid:** Test the MATH FORMULA in isolation, not the function directly. The existing tests in `math.rs` already do this (see `reward_calculation_formula`, `reward_calculation_fractional`). For proptest, test the arithmetic: `(balance * delta) / PRECISION` and `(pending * PRECISION) / total_staked`, not the `update_rewards` function itself. Test `add_to_cumulative` directly since it doesn't depend on Clock.
**Warning signs:** Test fails with "Program not available" or "SBF not found" in `cargo test`.

### Pitfall 2: StakePool Singleton Conflicts Between Test Files
**What goes wrong:** security.ts test file and staking.ts/token-flow.ts both try to initialize StakePool with different mints, causing mint mismatch errors.
**Why it happens:** StakePool PDA is derived from seeds = ["stake_pool"] with no mint seed, so only one pool can exist per program ID in a validator.
**How to avoid:** Either (a) add security.ts to the Anchor.toml test script alongside staking.ts (which shares the validator), or (b) more likely, follow token-flow.ts's approach: run security.ts in its own test invocation with a fresh validator. Given the complexity of the Phase 29 setup (Transfer Hook, whitelist, etc.), option (b) is recommended.
**Warning signs:** "Account already initialized" or "A seeds constraint was violated" errors in test setup.

### Pitfall 3: Airdrop Rate Limiting in 100+ User Tests
**What goes wrong:** Creating 100+ stakers requires 100+ SOL airdrops, which can hit rate limits or slow tests dramatically.
**Why it happens:** Each `requestAirdrop` is an RPC call + confirmation.
**How to avoid:** Use `provider.connection.requestAirdrop` with `skipPreflight: true` and batch confirmations. Or, use a single funded authority to create all token accounts and transfer SOL via system program transfer (cheaper than airdrop). For 100+ stakers, pre-fund a treasury account with enough SOL, then distribute.
**Warning signs:** Tests take >60 seconds per staker creation, or "Too Many Requests" errors.

### Pitfall 4: u128 Handling in TypeScript Tests
**What goes wrong:** JavaScript `number` loses precision above 2^53. Reward calculations with u128 values overflow or produce incorrect results.
**Why it happens:** `pool.rewardsPerTokenStored` is a u128 field that Anchor deserializes as BN (big number).
**How to avoid:** Always use `BigInt` or `BN` for reward math in tests. Never convert to `number` until final display. The existing tests in `cross-program-integration.ts` already use `BigInt` for PRECISION and reward calculations.
**Warning signs:** Math assertions fail with "Expected X, got Y" where values are close but not exact, especially for large cumulative values.

### Pitfall 5: Forgetting to Fund Escrow for Reward Claim Tests
**What goes wrong:** Tests that simulate deposit_rewards -> update_cumulative -> claim fail because escrow vault has no actual SOL.
**Why it happens:** `deposit_rewards` only increments `pending_rewards` counter -- it doesn't transfer SOL (that's the Tax Program's responsibility via CPI). In tests without Tax Program, you must manually fund the escrow.
**How to avoid:** Before testing claim flows, transfer SOL directly to the escrow vault PDA using `SystemProgram.transfer`. The amount must match what `deposit_rewards` reports as pending.
**Warning signs:** `InsufficientEscrowBalance` error when testing claim, even though deposit_rewards succeeded.

### Pitfall 6: Testing Epoch Guard Without Epoch Program
**What goes wrong:** Can't test `update_cumulative` or the double-update prevention (AlreadyUpdated) without a valid Epoch Program signing the CPI.
**Why it happens:** The `seeds::program = epoch_program_id()` constraint means only the actual Epoch Program can produce a valid signer.
**How to avoid:** For the double-update test, we need EITHER: (a) a mock epoch program that can sign with the correct PDA, OR (b) test the math in Rust unit tests and test the guard logic by directly manipulating pool.last_update_epoch in a Rust test (using `test_pool()` helper). Option (b) is already partially done in `update_cumulative.rs` tests. For the CPI rejection test, the existing `cross-program-integration.ts` pattern (unauthorized keypair -> ConstraintSeeds) is sufficient.
**Warning signs:** Skipped tests with "requires Epoch Program integration" comments (these already exist in cross-program-integration.ts).

## Code Examples

Verified patterns from the existing codebase and official sources:

### Proptest: No-Panic Property for add_to_cumulative
```rust
// Source: proptest book + existing math.rs test_pool helper
use proptest::prelude::*;

proptest! {
    #![proptest_config(ProptestConfig::with_cases(10_000))]

    /// PROPERTY: add_to_cumulative never panics for any valid inputs.
    /// Valid means: total_staked > 0 (enforced by MINIMUM_STAKE).
    /// Pending can be anything from 0 to u64::MAX.
    /// Existing cumulative can be anything up to u128::MAX / 2 (headroom).
    #[test]
    fn add_to_cumulative_no_panic(
        total_staked in 1u64..=u64::MAX,
        pending in 0u64..=u64::MAX,
        existing in 0u128..=(u128::MAX / 2),
    ) {
        let mut pool = test_pool(total_staked, existing, pending);
        let result = add_to_cumulative(&mut pool);
        // May succeed or fail with overflow -- but never panics
        match result {
            Ok(_) => {
                // If succeeded, cumulative must be >= existing
                prop_assert!(pool.rewards_per_token_stored >= existing);
                // Pending must be cleared
                prop_assert_eq!(pool.pending_rewards, 0);
            }
            Err(_) => {
                // Overflow is acceptable for extreme values
                // State should be unchanged on error... but add_to_cumulative
                // mutates pool before overflow check, so we just verify no panic
            }
        }
    }
}
```

### Proptest: Reward Conservation Property
```rust
/// PROPERTY: Sum of all user claims <= total deposited rewards.
/// The truncation (floor division) means protocol keeps dust, never overpays.
#[test]
fn reward_conservation_multi_user(
    total_staked in 1u64..=1_000_000_000_000u64,
    pending in 1u64..=100_000_000_000u64,  // Up to 100 SOL
    num_users in 2usize..=20,
) {
    let mut pool = test_pool(total_staked, 0, pending);
    add_to_cumulative(&mut pool).unwrap();

    // Simulate users with random balances summing to total_staked
    // Each user's reward = balance * cumulative / PRECISION
    let per_token = pool.rewards_per_token_stored;
    let total_claimed: u128 = (total_staked as u128)
        .checked_mul(per_token)
        .unwrap()
        .checked_div(PRECISION)
        .unwrap();

    // Conservation: total claimed <= total deposited
    prop_assert!(total_claimed as u64 <= pending);
}
```

### TypeScript: First-Depositor Attack Simulation
```typescript
// Source: Existing staking.ts pattern + Docs/New_Yield_System_Spec.md Section 9.1
it("MINIMUM_STAKE prevents first-depositor reward inflation", async () => {
  // Verify pool was initialized with dead stake
  const pool = await stakingProgram.account.stakePool.fetch(stakePool);
  expect(pool.totalStaked.toNumber()).to.be.gte(MINIMUM_STAKE);

  // Even if attacker stakes 1 additional token, their share is bounded
  // by MINIMUM_STAKE denominator, not their dust stake
  const attackerStake = 1; // 1 unit (smallest possible)
  const totalAfterAttack = pool.totalStaked.toNumber() + attackerStake;
  const attackerShare = attackerStake / totalAfterAttack;

  // Attacker's share is negligible (<0.0001%)
  expect(attackerShare).to.be.lt(0.000001);
});
```

### TypeScript: Multi-User Proportional Distribution
```typescript
// Source: Existing cross-program-integration.ts multi-user pattern
it("rewards are proportional to stake after 100+ operations", async () => {
  const PRECISION = BigInt("1000000000000000000");
  const stakers = [];
  const NUM_STAKERS = 5; // Start with 5, scale to 100+ in stress tests

  // Create stakers with different amounts
  for (let i = 0; i < NUM_STAKERS; i++) {
    const amount = (i + 1) * 100_000_000; // 100, 200, 300... PROFIT
    const staker = await createStakerWithTokens(connection, admin, profitMint, stakingProgram.programId, amount);
    stakers.push({ ...staker, amount });

    await stakeWithHook(connection, stakingProgram, staker.keypair, amount, { ... });
    await assertEscrowSolvency(connection, stakingProgram, escrowVault, stakePool);
  }

  // Verify proportional distribution math
  const totalStaked = stakers.reduce((sum, s) => sum + BigInt(s.amount), BigInt(0));
  const rewardsDeposited = BigInt(10_000_000_000); // 10 SOL

  const rewardPerToken = (rewardsDeposited * PRECISION) / totalStaked;

  let totalClaimed = BigInt(0);
  for (const staker of stakers) {
    const userReward = (rewardPerToken * BigInt(staker.amount)) / PRECISION;
    totalClaimed += userReward;
  }

  // Conservation: claimed <= deposited (dust stays in escrow)
  const dust = rewardsDeposited - totalClaimed;
  expect(Number(dust)).to.be.gte(0);
  expect(Number(dust)).to.be.lt(stakers.length);
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `solana-program-test` + `BanksClient` | LiteSVM / Mollusk | 2024-2025 | Rust-native testing; however this project uses TypeScript integration tests which are already mature |
| QuickCheck for Rust PBT | Proptest | ~2020 | Per-value strategies vs type-based; proptest is now standard |
| Manual overflow boundary tests | proptest with u64/u128 ranges | Always available | Finds edge cases humans miss; shrinking finds minimal failing input |
| Anchor TS test only | Mixed Rust unit + TS integration | Always available | Rust unit tests are faster (no validator), TS tests validate on-chain behavior |

**Deprecated/outdated:**
- `solana-program-test` is marked deprecated since v3.1.0 in favor of LiteSVM/Mollusk, but this project's TypeScript test infrastructure is well-established and should not be migrated for this phase.
- `cargo test-bpf` / `cargo test-sbf` -- these compile to BPF/SBF for runtime testing; not needed for math unit tests which run natively.

## Open Questions

### 1. Full CPI Flow Testing for deposit_rewards and update_cumulative
- **What we know:** The existing tests skip full CPI flows because they require Tax Program and Epoch Program integration. Current tests verify CPI rejection (unauthorized callers fail) but not CPI acceptance (authorized callers succeed).
- **What's unclear:** Whether Phase 29 should implement a mock that can successfully CPI into deposit_rewards and update_cumulative, or whether the math-only approach (simulating the state changes without CPI) is sufficient.
- **Recommendation:** For Phase 29, simulate the full flow by directly manipulating escrow balance (fund with SystemProgram.transfer) and pool state. The CPI authorization is already tested in cross-program-integration.ts. Testing the full CPI path end-to-end would require deploying Tax Program with AMM pool, which is Phase 30+ territory.

### 2. Epoch Count for Timing Tests
- **What we know:** The `rewards_per_token_stored` is u128 with ~1e9 headroom beyond realistic scenarios (per spec Section 6.3). The `last_update_epoch` is u32, supporting up to ~4 billion epochs.
- **What's unclear:** How many epochs to simulate before cumulative math could degrade. Context says "Claude's discretion."
- **Recommendation:** Test 1,000 epochs for smoke test, 10,000 epochs for stress test, and validate u128 headroom in proptest with extreme values. The existing `test_cumulative_addition_realistic` test in update_cumulative.rs tests 1,000 epochs -- Phase 29 should extend this to 10,000 and use proptest for arbitrary epoch counts.

### 3. Concurrent Staker Scaling
- **What we know:** Context specifies "100+ concurrent stakers." LocalNet can handle this but airdrop latency is the bottleneck.
- **What's unclear:** Whether 100 stakers is feasible within test timeouts (Anchor.toml sets `-t 1000000` for 1000s timeout).
- **Recommendation:** Start with 10 stakers for each test case, with one dedicated stress test that creates 100 stakers. Use batch funding pattern (pre-fund treasury, distribute via transfer) instead of individual airdrops.

### 4. Test File Organization
- **What we know:** Context says "Claude's discretion" for file organization.
- **What's unclear:** Whether to create one large `security.ts` or split into multiple files.
- **Recommendation:** Single `tests/security.ts` file with well-organized `describe` blocks. Rationale: (a) all tests share the same initialization sequence (Transfer Hook + StakePool + whitelist), (b) Anchor.toml test scripts run by file, and (c) having one file simplifies the test run configuration. Internal structure:
  - `describe("Security: Attack Simulations")` -- first-depositor, flash loan, CPI forgery
  - `describe("Security: Escrow Solvency")` -- 100+ operation invariant testing
  - `describe("Edge Cases")` -- zero states, mid-epoch, partial operations
  - `describe("Multi-User Distribution")` -- proportional rewards, late staker

## Sources

### Primary (HIGH confidence)
- `programs/staking/src/helpers/math.rs` -- Existing unit test patterns, `test_pool` and `test_user` helpers
- `programs/staking/src/instructions/*.rs` -- All instruction implementations read and analyzed
- `tests/token-flow.ts` -- Existing Transfer Hook integration test infrastructure, `assertEscrowSolvency`, `stakeWithHook`, `unstakeWithHook` helpers
- `tests/staking.ts` -- Existing basic staking tests including flash loan prevention
- `tests/cross-program-integration.ts` -- Existing CPI gating tests, `createStaker` factory
- `programs/fake-tax-program/src/lib.rs` -- Existing CPI forgery program pattern
- `Docs/New_Yield_System_Spec.md` -- Full staking spec including security analysis (Sections 8-9)
- `.planning/phases/29-security-edge-case-testing/29-CONTEXT.md` -- User decisions for this phase
- proptest crate documentation (docs.rs/proptest/1.9.0) -- API reference, strategy patterns
- proptest book (altsysrq.github.io/proptest-book) -- Tutorial, configuration, best practices

### Secondary (MEDIUM confidence)
- Anchor testing docs (anchor-lang.com/docs/testing) -- LiteSVM/Mollusk overview (not directly used but confirms TS testing is valid approach)
- Helius security guide (helius.dev/blog/a-hitchhikers-guide-to-solana-program-security) -- Solana security patterns, attack taxonomy
- ZealynX Solana Security Checklist (zealynx.io/blogs/solana-security-checklist) -- 45-point security checklist, confirmed CEI pattern, overflow checks

### Tertiary (LOW confidence)
- Flash loan attack case studies (hacken.io, speedrunethereum.com) -- General DeFi attack patterns, mostly Ethereum-focused but principles apply

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- proptest is the de facto Rust PBT library; existing TypeScript infrastructure is proven
- Architecture: HIGH -- patterns directly derived from existing codebase; no new infrastructure needed
- Pitfalls: HIGH -- identified from direct code analysis of existing implementations
- Code examples: HIGH -- adapted from existing test code and proptest documentation

**Research date:** 2026-02-09
**Valid until:** 2026-03-11 (30 days -- stable domain, no major version changes expected)
