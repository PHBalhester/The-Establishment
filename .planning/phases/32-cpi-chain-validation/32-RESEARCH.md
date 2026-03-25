# Phase 32: CPI Chain Validation - Research

**Researched:** 2026-02-10
**Domain:** Solana CPI chain testing, compute budget profiling, cross-program access control validation
**Confidence:** HIGH

## Summary

Phase 32 validates every cross-program invocation (CPI) path in the Dr. Fraudsworth protocol locally, profiles compute unit consumption, fixes 29 pre-existing test failures, and documents recommended CU limits for integrators. No new on-chain program code is written -- this is testing, validation, and documentation.

The protocol has 5 production programs (AMM, Tax, Staking, Epoch, Transfer Hook) with CPI chains ranging from depth 1 (Epoch->Staking) to depth 4 (Epoch->Tax->AMM->Token-2022->Hook). The depth-4 Carnage chain is exactly at Solana's hard limit. All CPI access control uses Anchor's `seeds::program` constraint for PDA-based authorization between programs.

**Primary recommendation:** Build integration tests in `tests/integration/` using the existing `solana-test-validator` infrastructure (scripts/run-integration-tests.sh), measure CU via `simulateTransaction().unitsConsumed`, and exercise every swap type + the full Carnage chain. Fix the 29 failing Anchor tests by adding the missing `swap_authority` PDA and correcting pool vault setup.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@solana/web3.js` | 1.x | Transaction building, simulation, RPC | Already in project, provides `simulateTransaction` |
| `@solana/spl-token` | 0.4.x | `createTransferCheckedWithTransferHookInstruction` for hook account resolution | Already in project, required for T22 hook flows |
| `@coral-xyz/anchor` | 0.30.x | Program client, account deserialization | Already in project |
| `ts-mocha` | - | Test runner | Already in project, configured in run-integration-tests.sh |
| `chai` | - | Assertions | Already in project |
| `solana-test-validator` | CLI | Local test validator with upgradeable programs | Already configured, required for InitializeAdmin |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `ComputeBudgetProgram` | (in @solana/web3.js) | Set CU limits on transactions | Every test transaction to measure CU precisely |

### Alternatives Considered

None -- the stack is already established in the project. No new dependencies needed.

## Architecture Patterns

### Existing Project Structure

```
tests/
  integration/
    helpers/
      protocol-init.ts    # 17-step full protocol initialization
      constants.ts         # Program IDs, seeds, amounts
      test-wallets.ts      # Test wallet management
    smoke.test.ts          # 2 existing smoke tests (SOL buy + stake)
    [NEW] cpi-chains.test.ts   # All swap type tests + CU profiling
    [NEW] carnage.test.ts      # Carnage depth-4 chain tests
    [NEW] access-control.test.ts  # Negative auth matrix tests
scripts/
  run-integration-tests.sh  # Validator startup + test runner
Docs/
  [NEW] Compute_Budget_Profile.md  # CU measurements + recommendations
```

### Pattern 1: CU Measurement via simulateTransaction

**What:** Simulate each transaction before sending to measure CU consumption without committing.
**When to use:** Every CPI chain test should measure CU.
**Confidence:** HIGH (Solana official docs)

```typescript
// Build the transaction
const tx = new Transaction().add(
  ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), // max to avoid hitting limit
  ...instructionIxs,
);
tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
tx.feePayer = payer.publicKey;

// Simulate to measure CU
const simulation = await connection.simulateTransaction(tx);
const unitsConsumed = simulation.value.unitsConsumed;
console.log(`CU consumed: ${unitsConsumed}`);

// Now send with tighter limit (actual + 10% margin)
const tightLimit = Math.ceil(unitsConsumed * 1.1);
const realTx = new Transaction().add(
  ComputeBudgetProgram.setComputeUnitLimit({ units: tightLimit }),
  ...instructionIxs,
);
```

**Precedent in project:** `tests/devnet-vrf.ts` already uses `ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })` for VRF transactions.

### Pattern 2: Integration Test with Full Protocol Init

**What:** Use `protocol-init.ts` to set up the complete protocol state before running CPI chain tests.
**When to use:** All Phase 32 integration tests.
**Confidence:** HIGH (already working in smoke.test.ts)

The existing `initializeProtocol()` function in `tests/integration/helpers/protocol-init.ts` performs a 17-step initialization:
1. Airdrop SOL to deployer
2. Create CRIME, FRAUD, PROFIT mints (Token-2022 with transfer hooks)
3. Initialize Transfer Hook whitelist authority
4. Initialize ExtraAccountMetaList per mint
5. Create token accounts and whitelist entries
6. Initialize AMM admin
7. Create and seed all 4 AMM pools (CRIME/SOL, FRAUD/SOL, CRIME/PROFIT, FRAUD/PROFIT)
8. Initialize Epoch State
9. Initialize Staking pool with dead stake
10. Initialize Carnage Fund
11. Create and fund test user wallets

### Pattern 3: Transfer Hook Account Resolution

**What:** Use `createTransferCheckedWithTransferHookInstruction` to resolve hook accounts, then extract `remaining_accounts`.
**When to use:** Any test that exercises Token-2022 transfers (all swap types).
**Confidence:** HIGH (already implemented in smoke.test.ts and token-flow.ts)

```typescript
// Resolve hook accounts for a transfer
const transferIx = await createTransferCheckedWithTransferHookInstruction(
  connection,
  sourceTokenAccount,
  mint,
  destinationTokenAccount,
  authority,
  BigInt(amount),
  decimals,
  [],
  "confirmed",
  TOKEN_2022_PROGRAM_ID,
);
// Extract remaining accounts (skip first 4: source, mint, dest, authority)
const hookAccounts = transferIx.keys.slice(4);
```

For CPI chains (Tax->AMM->T22->Hook), the hook accounts must be passed as `remaining_accounts` all the way through.

### Pattern 4: Negative Authorization Testing

**What:** Attempt CPI calls with wrong signers/PDAs and verify they fail with expected errors.
**When to use:** Every CPI entry point that has access control.
**Confidence:** HIGH (already implemented in cross-program-integration.ts and security.ts)

```typescript
try {
  await program.methods.protectedInstruction(args)
    .accountsStrict({
      authority: unauthorizedKeypair.publicKey,  // wrong signer
      ...otherAccounts,
    })
    .signers([unauthorizedKeypair])
    .rpc();
  expect.fail("Should have failed with seeds constraint violation");
} catch (err: any) {
  expect(
    err.message.includes("seeds") ||
    err.error?.errorCode?.code === "ConstraintSeeds"
  ).to.be.true;
}
```

### Anti-Patterns to Avoid

- **Using `anchor test` for integration tests:** Anchor test deploys programs as non-upgradeable via `--bpf-program`, but AMM's `InitializeAdmin` requires `ProgramData.upgrade_authority_address` to be set. Must use `solana-test-validator` with `--upgradeable-program` flags.
- **Setting CU limit to 1.4M for all tests:** Defeats the purpose of profiling. Set to 1.4M for simulation measurement only, then use measured value + margin for actual transactions.
- **Testing Token-2022 transfers without hook accounts:** Will fail silently or error. Always resolve ExtraAccountMetas before any T22 transfer.
- **Splitting Carnage into 2 transactions:** Creates MEV front-running window. Carnage must remain atomic (single transaction).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Hook account resolution | Manual PDA derivation for hook accounts | `createTransferCheckedWithTransferHookInstruction` from @solana/spl-token | Accounts are derived from on-chain ExtraAccountMetaList; manual derivation is fragile |
| CU measurement | Log parsing with regex | `simulateTransaction().value.unitsConsumed` | Direct API field, no parsing needed |
| Test validator lifecycle | Manual process management | Existing `run-integration-tests.sh` script | Already handles startup, health check, cleanup |

**Key insight:** The test infrastructure for integration testing is already built (Phase 31). Phase 32 adds tests to the existing framework, not new framework code.

## Common Pitfalls

### Pitfall 1: CPI Depth Miscounting

**What goes wrong:** Counting CPI depth from 0 instead of recognizing stack height starts at 1.
**Why it happens:** Different documents use different numbering conventions.
**How to avoid:** Solana stack height starts at 1 for the transaction entry point. Maximum is 5. So you get 4 CPI levels: entry(1) -> CPI(2) -> CPI(3) -> CPI(4) -> CPI(5).
**Warning signs:** "Privilege escalation" error in transaction logs means stack depth exceeded.
**Confidence:** HIGH (verified from Solana official docs)

**Protocol depth map (stack heights):**

| Chain | H=1 (entry) | H=2 | H=3 | H=4 | H=5 |
|-------|-------------|-----|-----|-----|-----|
| SOL buy/sell | Tax Program | AMM | Token-2022 | Transfer Hook | - |
| PROFIT buy/sell | Tax Program | AMM | Token-2022 | Transfer Hook | - |
| deposit_rewards | Tax Program | Staking | - | - | - |
| update_cumulative | Epoch (consume_randomness) | Staking | - | - | - |
| Carnage (atomic) | Epoch (execute_carnage_atomic) | Tax (swap_exempt) | AMM | Token-2022 | Transfer Hook |
| Carnage (fallback) | Epoch (execute_carnage) | Tax (swap_exempt) | AMM | Token-2022 | Transfer Hook |

The Carnage chain at H=5 is exactly at Solana's hard limit. The `swap_exempt.rs` and `execute_carnage_atomic.rs` files both have comments: "DO NOT add any CPI calls to this instruction path."

### Pitfall 2: Hook Accounts Not Forwarded Through CPI Chain

**What goes wrong:** Anchor's `token_interface::transfer_checked` with `with_remaining_accounts` does NOT properly forward remaining_accounts through nested CPI chains (Tax->AMM->T22->Hook).
**Why it happens:** Anchor's CPI framework adds hook accounts to the CpiContext but doesn't ensure they appear in the raw instruction keys that Token-2022 reads.
**How to avoid:** Use manual `invoke_signed` with raw `spl_token_2022::instruction::transfer_checked`, appending hook accounts to both `ix.accounts` AND `account_infos`. This is already correctly implemented in `programs/amm/src/helpers/transfers.rs` (`transfer_t22_checked`).
**Warning signs:** "Account not found" or "Missing account" errors when Token-2022 tries to invoke the Transfer Hook.
**Confidence:** HIGH (verified from codebase implementation and comments)

### Pitfall 3: Mixed Token Programs in SOL Pools

**What goes wrong:** Treating WSOL (SPL Token) and IP tokens (Token-2022) with the same transfer function.
**Why it happens:** SOL pools have WSOL (SPL Token, no hooks) on one side and CRIME/FRAUD (Token-2022, with hooks) on the other.
**How to avoid:** AMM's `swap_sol_pool.rs` correctly handles this: uses `transfer_spl` for WSOL side and `transfer_t22_checked` for IP token side, selected based on direction. PROFIT pools use `transfer_t22_checked` for both sides.
**Warning signs:** `InvalidTokenProgram` error from AMM defense-in-depth checks.
**Confidence:** HIGH (verified from `swap_sol_pool.rs` and `swap_profit_pool.rs`)

### Pitfall 4: Precomputed Anchor Discriminators

**What goes wrong:** CPI calls fail because the instruction discriminator bytes don't match what the target program expects.
**Why it happens:** All cross-program CPI in this project uses raw `invoke_signed` with precomputed discriminators (sha256 of "global:instruction_name")[0..8]).
**How to avoid:** The codebase has unit tests that verify discriminators (e.g., `tax-program/src/constants.rs::test_deposit_rewards_discriminator`). If adding new CPI paths, always verify discriminators match.
**Warning signs:** "Invalid instruction data" or discriminator mismatch errors.
**Confidence:** HIGH (verified from codebase)

**Known discriminators in the codebase:**

| Instruction | Discriminator (hex) | Source |
|------------|---------------------|--------|
| `swap_sol_pool` | `de 80 1e 7b 55 27 91 8a` | Tax Program constants |
| `swap_profit_pool` | `ce a3 0b 22 f1 6c 24 a6` | Tax Program swap_profit_buy.rs |
| `swap_exempt` | `f3 5b 9e 48 d3 8a 1c 27` | Epoch Program execute_carnage.rs |
| `deposit_rewards` | `34 f9 70 48 ce a1 c4 01` | Tax Program constants |
| `update_cumulative` | From Epoch constants | Epoch Program consume_randomness.rs |

### Pitfall 5: Carnage CU Varies with Pool State

**What goes wrong:** CU profiling shows safe values during testing but hits limits on mainnet due to different pool states.
**Why it happens:** Constant-product AMM math CU consumption varies slightly with reserve magnitudes, and Token-2022 transfer hooks add per-transfer overhead.
**How to avoid:** Test Carnage with multiple pool states: high liquidity (large reserves), low liquidity (small reserves), and asymmetric reserves. Per CONTEXT.md: "Test Carnage with multiple pool states (varying liquidity levels) to catch worst-case CU scenarios."
**Warning signs:** CU measurements varying by more than 10% across different pool states.
**Confidence:** MEDIUM (logical inference from constant-product math, not empirically measured yet)

### Pitfall 6: Simulation vs Execution CU Differences

**What goes wrong:** CU measured via `simulateTransaction` differs from actual execution.
**Why it happens:** Simulation runs against current validator state; execution may encounter different slot or state. The difference is typically small but can be non-zero.
**How to avoid:** Add 10% margin to simulated CU values (Solana docs recommend this). Per CONTEXT.md thresholds: <80% of limit = OK, 80-95% = Warning, >95% = Critical.
**Confidence:** MEDIUM (Solana docs recommend margin but don't quantify typical variance)

## Code Examples

### CPI Chain Test: SOL Buy (Tax -> AMM -> T22 -> Hook)

```typescript
// Source: adapted from tests/integration/smoke.test.ts (working implementation)
it("completes SOL buy with CU profiling", async () => {
  const { user, crimePool, hookAccounts } = testState;

  // Resolve hook accounts for CRIME/SOL pool
  const transferIx = await createTransferCheckedWithTransferHookInstruction(
    connection, sourceAccount, crimeMint, destAccount, authority,
    BigInt(amount), decimals, [], "confirmed", TOKEN_2022_PROGRAM_ID,
  );
  const remainingAccounts = transferIx.keys.slice(4);

  // Build swap_sol_buy instruction via Tax Program
  const swapIx = await taxProgram.methods
    .swapSolBuy(new BN(solAmount), new BN(0), true)
    .accountsStrict({ /* all accounts */ })
    .remainingAccounts(remainingAccounts)
    .instruction();

  // Measure CU via simulation
  const measureTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    swapIx,
  );
  measureTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  measureTx.feePayer = user.publicKey;

  const sim = await connection.simulateTransaction(measureTx);
  expect(sim.value.err).to.be.null;
  const cuUsed = sim.value.unitsConsumed;
  console.log(`SOL buy CU: ${cuUsed}`);

  // Execute with tight limit
  const execTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: Math.ceil(cuUsed * 1.1) }),
    swapIx,
  );
  await sendAndConfirmTransaction(connection, execTx, [user]);
});
```

### Negative Auth Test: Wrong PDA Seeds

```typescript
// Source: adapted from tests/cross-program-integration.ts (working implementation)
it("rejects swap with wrong swap_authority", async () => {
  const fakeKeypair = Keypair.generate();
  await connection.requestAirdrop(fakeKeypair.publicKey, LAMPORTS_PER_SOL);

  try {
    // Pass a random keypair instead of the Tax Program PDA
    await ammProgram.methods
      .swapSolPool(new BN(100), { aToB: {} }, new BN(0))
      .accountsStrict({
        swapAuthority: fakeKeypair.publicKey,  // not a valid Tax PDA
        ...otherAccounts,
      })
      .signers([fakeKeypair])
      .rpc();
    expect.fail("Should reject unauthorized swap_authority");
  } catch (err) {
    expect(err.error?.errorCode?.code).to.equal("ConstraintSeeds");
  }
});
```

### Carnage Depth-4 Test

```typescript
// Source: new pattern based on execute_carnage_atomic.rs analysis
it("executes Carnage atomic within CU budget", async () => {
  // Prerequisites: set epoch_state.carnage_pending = true via consume_randomness
  // This requires VRF setup or direct state manipulation

  const carnageIx = await epochProgram.methods
    .executeCarnageAtomic()
    .accountsStrict({
      caller: user.publicKey,
      epochState, carnageState, carnageSigner,
      solVault, carnageWsol, crimeVault, fraudVault,
      targetPool, poolVaultA, poolVaultB,
      mintA: wsolMint, mintB: crimeMint,
      taxProgram: TAX_PROGRAM_ID, ammProgram: AMM_PROGRAM_ID,
      tokenProgramA: TOKEN_PROGRAM_ID, tokenProgramB: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(hookAccounts)
    .instruction();

  // Simulate with max CU
  const measureTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    carnageIx,
  );
  const sim = await connection.simulateTransaction(measureTx);
  const cuUsed = sim.value.unitsConsumed;

  console.log(`Carnage atomic CU: ${cuUsed}`);
  console.log(`Headroom: ${((1_400_000 - cuUsed) / 1_400_000 * 100).toFixed(1)}%`);

  // Threshold checks per CONTEXT.md
  const utilization = cuUsed / requestedLimit;
  if (utilization > 0.95) console.warn("CRITICAL: >95% CU utilization");
  else if (utilization > 0.80) console.warn("WARNING: >80% CU utilization");
});
```

## CPI Chain Inventory

Complete enumeration of all CPI paths in the protocol:

### User-Initiated Swap Chains (depth 3, stack height 4)

| Swap Type | Tax Instruction | AMM Instruction | Direction | Token Programs | Has Tax Distribution? |
|-----------|----------------|-----------------|-----------|---------------|----------------------|
| SOL Buy (SOL->CRIME) | `swap_sol_buy` | `swap_sol_pool` (AtoB) | SPL in, T22 out | SPL Token + Token-2022 | Yes (75/24/1 split + deposit_rewards CPI) |
| SOL Buy (SOL->FRAUD) | `swap_sol_buy` | `swap_sol_pool` (AtoB) | SPL in, T22 out | SPL Token + Token-2022 | Yes |
| SOL Sell (CRIME->SOL) | `swap_sol_sell` | `swap_sol_pool` (BtoA) | T22 in, SPL out | SPL Token + Token-2022 | Yes (tax on output) |
| SOL Sell (FRAUD->SOL) | `swap_sol_sell` | `swap_sol_pool` (BtoA) | T22 in, SPL out | SPL Token + Token-2022 | Yes |
| PROFIT Buy (CRIME->PROFIT) | `swap_profit_buy` | `swap_profit_pool` (AtoB) | T22 in, T22 out | Token-2022 x2 | No (untaxed) |
| PROFIT Buy (FRAUD->PROFIT) | `swap_profit_buy` | `swap_profit_pool` (AtoB) | T22 in, T22 out | Token-2022 x2 | No |
| PROFIT Sell (PROFIT->CRIME) | `swap_profit_sell` | `swap_profit_pool` (BtoA) | T22 in, T22 out | Token-2022 x2 | No |
| PROFIT Sell (PROFIT->FRAUD) | `swap_profit_sell` | `swap_profit_pool` (BtoA) | T22 in, T22 out | Token-2022 x2 | No |

**Note on PROFIT pool hooks:** PROFIT pools have transfer hooks on BOTH tokens. AMM splits `remaining_accounts` at midpoint: first half for input transfer hooks, second half for output transfer hooks.

### SOL Swap Tax Distribution Sub-Chain (depth 2, within swap handler)

After the AMM CPI, SOL buy/sell handlers execute:
1. `system_program::transfer` (user -> staking_escrow, 75%)
2. `invoke_signed` to Staking `deposit_rewards` (Tax PDA signs)
3. `system_program::transfer` (user -> carnage_vault, 24%)
4. `system_program::transfer` (user -> treasury, 1%)

This is serial within the Tax handler, NOT nested CPI depth. The `deposit_rewards` CPI is depth 2 (Tax->Staking), separate from the AMM CPI path.

### Carnage Chain (depth 4, stack height 5 -- Solana limit)

| Step | Stack Height | Program | Instruction | Notes |
|------|-------------|---------|-------------|-------|
| 1 | H=1 | Epoch | `execute_carnage_atomic` | Entry point, permissionless |
| 2 | H=2 | Tax | `swap_exempt` | carnage_signer PDA from Epoch signs |
| 3 | H=3 | AMM | `swap_sol_pool` | swap_authority PDA from Tax signs |
| 4 | H=4 | Token-2022 | `transfer_checked` | Pool PDA signs for vault->user |
| 5 | H=5 | Transfer Hook | `execute` | Whitelist validation |

Carnage may execute up to 2 swaps per trigger (sell existing + buy new), meaning the depth-4 chain executes twice within a single transaction. CU budget must cover both.

### Epoch -> Staking Chain (depth 1, stack height 2)

| Step | Stack Height | Program | Instruction |
|------|-------------|---------|-------------|
| 1 | H=1 | Epoch | `consume_randomness` |
| 2 | H=2 | Staking | `update_cumulative` |

This is the simplest CPI chain. `consume_randomness` derives tax rates from VRF, then CPIs to Staking to finalize epoch yield.

## Access Control Matrix

Every CPI entry point and its authorization mechanism:

| Target Program | Instruction | Required Authority | Auth Mechanism | PDA Seeds | Seeds::program |
|---------------|-------------|-------------------|----------------|-----------|----------------|
| AMM | `swap_sol_pool` | Tax Program's `swap_authority` PDA | `Signer` + `seeds::program = TAX_PROGRAM_ID` | `["swap_authority"]` | Tax Program |
| AMM | `swap_profit_pool` | Tax Program's `swap_authority` PDA | `Signer` + `seeds::program = TAX_PROGRAM_ID` | `["swap_authority"]` | Tax Program |
| Staking | `deposit_rewards` | Tax Program's `tax_authority` PDA | `seeds::program = tax_program_id()` | `["tax_authority"]` | Tax Program |
| Staking | `update_cumulative` | Epoch Program's `staking_authority` PDA | `seeds::program = epoch_program_id()` | `["staking_authority"]` | Epoch Program |
| Tax | `swap_exempt` | Epoch Program's `carnage_signer` PDA | `Signer` + `seeds::program = epoch_program_id()` | `["carnage_signer"]` | Epoch Program |

### Negative Test Matrix (per CONTEXT.md)

For each CPI entry point, test:

| Test Category | Description | Expected Error |
|--------------|-------------|----------------|
| Unauthorized caller | Random keypair instead of correct PDA | `ConstraintSeeds` (Anchor 2006) |
| Wrong PDA seeds | Valid PDA but wrong seed derivation | `ConstraintSeeds` |
| Wrong program ID | PDA from wrong program (e.g., Tax PDA trying to call update_cumulative) | `ConstraintSeeds` |
| Missing accounts | Omit required accounts from CPI | Various Anchor deserialization errors |

## Pre-Existing Test Failures Analysis

### Root Causes (from CONTEXT.md + codebase analysis)

**29 failures total: 19 AMM swap + 10 Tax SOL swap**

These tests are in the Anchor test suite (not integration tests) and fail because:

1. **Missing `swap_authority` PDA in test helpers:** The Anchor tests (staking.ts, token-flow.ts, security.ts) don't set up the Tax Program's `swap_authority` PDA that AMM requires. AMM's `swap_sol_pool` and `swap_profit_pool` instructions require `swap_authority` with `seeds::program = TAX_PROGRAM_ID`, meaning the Tax Program must sign via CPI. Direct AMM calls from tests will always fail this constraint.

2. **AMM pool vault setup issues:** Pool vaults are initialized with incorrect token program references or wrong mint associations in the test setup helpers.

3. **Test isolation conflicts:** StakePool PDA is a singleton (`seeds = ["stake_pool"]`). Test files sharing a validator instance (staking.ts, token-flow.ts, security.ts, cross-program-integration.ts) conflict when each tries to initialize the pool with a different mint.

**Fix approach:** These 19 AMM + 10 Tax test failures exercise the same CPI paths being validated in Phase 32. Fix them by:
- For AMM tests: Route through Tax Program (the correct path) instead of calling AMM directly
- For Tax tests: Set up full protocol state including swap_authority PDA derivation
- For isolation: Continue using separate validator instances per test file

### Existing Working Tests

| Test File | Passing Tests | What They Cover |
|-----------|--------------|-----------------|
| `tests/integration/smoke.test.ts` | 2 | SOL buy full CPI chain, Staking stake |
| `tests/staking.ts` | ~10+ | Stake/unstake/claim (no CPI chains) |
| `tests/token-flow.ts` | 12 | Stake/unstake with Transfer Hook |
| `tests/security.ts` | 24 | Attack simulations, edge cases |
| `tests/cross-program-integration.ts` | ~8 | CPI gating, math validation |

## Compute Budget Profile Template

Per CONTEXT.md, the compute profile doc should include:

### Threshold Definitions

| Status | CU Utilization | Action |
|--------|---------------|--------|
| OK | <80% of limit | Document and move on |
| WARNING | 80-95% | Optimize within Phase 32 |
| CRITICAL | >95% | Must optimize before shipping |

### Profile Table Format

| CPI Path | Measured CU | Set CU Limit | Headroom | Status | Pool State |
|----------|------------|-------------|----------|--------|------------|
| SOL buy (CRIME) | TBD | TBD | TBD% | TBD | Standard |
| SOL buy (CRIME) | TBD | TBD | TBD% | TBD | Low liquidity |
| SOL sell (CRIME) | TBD | TBD | TBD% | TBD | Standard |
| ... | ... | ... | ... | ... | ... |
| Carnage atomic (buy only) | TBD | TBD | TBD% | TBD | Standard |
| Carnage atomic (sell + buy) | TBD | TBD | TBD% | TBD | Standard |
| Carnage atomic (burn + buy) | TBD | TBD | TBD% | TBD | Standard |

### SDK/Frontend Recommendations Section

Per CONTEXT.md: "Compute profile doc should include an 'SDK/Frontend Recommendations' section with per-instruction minimum CU limits + suggested padding."

```
| Instruction | Minimum CU | Suggested CU (with padding) | Notes |
|------------|-----------|---------------------------|-------|
| swap_sol_buy | TBD | TBD (+10%) | Includes Tax distribution |
| swap_sol_sell | TBD | TBD (+10%) | Tax on output |
| swap_profit_buy | TBD | TBD (+10%) | Dual T22 hooks |
| swap_profit_sell | TBD | TBD (+10%) | Dual T22 hooks |
| execute_carnage_atomic | TBD | TBD (+10%) | Depth-4, may need >200k |
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Anchor CPI helpers for T22 transfers | Manual `invoke_signed` for T22 with hook forwarding | Phase 31 (Feb 2026) | `transfer_t22_checked` in AMM handles nested hook CPI correctly |
| Direct AMM calls from tests | Route through Tax Program CPI | Phase 32 (this phase) | Tests must mirror production CPI flow |
| `anchor test` for integration | `solana-test-validator` with `--upgradeable-program` | Phase 31 | Required for AMM InitializeAdmin upgrade authority check |

## Open Questions

1. **Carnage CU with 2 swaps**
   - What we know: Carnage may execute sell + buy in a single transaction (both depth-4 chains). Each swap goes through the full Tax->AMM->T22->Hook chain.
   - What's unclear: Total CU for 2 depth-4 CPI chains in one transaction. Estimated ~240-300k per swap based on Tax spec (~120-150k per swap), so ~500-600k total. Well within 1.4M but needs measurement.
   - Recommendation: Measure empirically with actual pool state. This is a critical measurement.

2. **Discriminator for swap_exempt**
   - What we know: Epoch Program uses `[0xf3, 0x5b, 0x9e, 0x48, 0xd3, 0x8a, 0x1c, 0x27]` in execute_carnage.rs and execute_carnage_atomic.rs
   - What's unclear: Whether this precomputed discriminator has been verified with a unit test (like deposit_rewards has in constants.rs)
   - Recommendation: Add unit test verifying sha256("global:swap_exempt")[0..8] matches

3. **Carnage test state setup**
   - What we know: execute_carnage_atomic requires `epoch_state.carnage_pending = true`, which is set by `consume_randomness` based on VRF bytes
   - What's unclear: Whether we can reliably trigger Carnage in tests (VRF byte 3 must be < 11, ~4.3% probability)
   - Recommendation: Either use deterministic VRF mock, or manually set EpochState fields via a test helper. The smoke test framework already initializes EpochState.

4. **PROFIT pool dual-hook remaining_accounts**
   - What we know: PROFIT pools split remaining_accounts at midpoint (first half = input hook, second half = output hook)
   - What's unclear: Whether `createTransferCheckedWithTransferHookInstruction` can resolve hooks for both mints in a single call, or if two separate calls are needed
   - Recommendation: Likely need two separate calls (one per mint), then concatenate results

## Sources

### Primary (HIGH confidence)

- **Codebase analysis** - All 5 program source files read and analyzed for CPI patterns, access control, and transfer hook handling
- **Solana official docs (solana.com/docs/core/fees.md)** - Compute budget defaults (200k/instruction, 1.4M/transaction), ComputeBudgetProgram API
- **Solana official docs (solana.com/docs/rpc/http/simulatetransaction.md)** - `simulateTransaction` response format with `unitsConsumed` field
- **Existing integration tests** - smoke.test.ts, protocol-init.ts verified working patterns
- **Existing Anchor tests** - cross-program-integration.ts, token-flow.ts, security.ts for auth testing patterns

### Secondary (MEDIUM confidence)

- **Solana MCP expert** - Confirmed CPI depth limits (stack height 1-5, max 4 CPI levels)
- **Tax_Pool_Logic_Spec.md Section 12** - CU estimates ~120-150k per swap type (project documentation, not empirically verified)
- **Carnage_Fund_Spec.md** - Depth-4 chain architecture and atomicity requirements

### Tertiary (LOW confidence)

- **CU variance across pool states** - Logical inference that AMM math CU varies with reserve magnitudes; needs empirical measurement

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH - All tools already in the project, no new dependencies
- Architecture: HIGH - Integration test framework verified working (Phase 31)
- CPI chains: HIGH - Every chain traced through source code with exact stack heights
- Access control: HIGH - Every `seeds::program` constraint verified in source
- Compute budgets: MEDIUM - API verified, thresholds defined, but actual CU values not yet measured
- Pitfalls: HIGH - Most pitfalls derived from actual codebase issues and implementation details

**Research date:** 2026-02-10
**Valid until:** 2026-03-10 (30 days -- stable domain, no expected framework changes)
