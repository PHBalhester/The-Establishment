# Phase 28: Token Flow and Whitelist - Research

**Researched:** 2026-02-08
**Domain:** Token-2022 Transfer Hook Integration / Staking Program Whitelist
**Confidence:** HIGH

## Summary

This phase connects the Staking Program to the Transfer Hook whitelist so PROFIT token transfers succeed through stake/unstake flows. The research investigates:

1. **Transfer Hook whitelist pattern** - The existing implementation uses existence-based PDA whitelisting (entry #1-13 already implemented). Adding StakeVault as entry #14 follows the same pattern.

2. **remaining_accounts passthrough** - Token-2022 transfers with hooks require ExtraAccountMetas to be resolved and passed as remaining_accounts. The existing stake/unstake instructions already accept remaining_accounts (`Context<'_, '_, 'info, 'info, Stake<'info>>`) and forward them via `.with_remaining_accounts(ctx.remaining_accounts.to_vec())`.

3. **Escrow solvency invariant** - The claim instruction already validates `escrow_balance >= rewards_to_claim` before transfer. The test suite needs to assert this after every operation.

**Primary recommendation:** Use `@solana/spl-token`'s `createTransferCheckedWithTransferHookInstruction` helper to resolve ExtraAccountMetas client-side, then pass them as remaining_accounts to the Staking Program instructions.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @coral-xyz/anchor | 0.30+ | Program framework | Already used in project |
| @solana/spl-token | 0.4+ | Token-2022 helpers | `createTransferCheckedWithTransferHookInstruction` |
| spl-transfer-hook-interface | 0.8+ | Rust hook interface | Already used in transfer-hook program |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| spl-tlv-account-resolution | 0.8+ | ExtraAccountMeta resolution | Resolving hook accounts |
| chai | 4.x | Test assertions | Already used in test suite |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `createTransferCheckedWithTransferHookInstruction` | Manual account resolution | More code, more error-prone |
| beforeAll init | beforeEach init | Slower tests, more airdrop requests |

**Installation:**
Already installed. No new dependencies required.

## Architecture Patterns

### Recommended Project Structure
```
tests/
├── staking.ts                    # Existing unit tests (no Transfer Hook)
├── cross-program-integration.ts  # Existing CPI gating tests
└── token-flow.ts                 # NEW: Transfer Hook integration tests
```

### Pattern 1: ExtraAccountMeta Resolution
**What:** Resolve Transfer Hook accounts client-side before submitting transactions
**When to use:** Any Token-2022 transfer involving PROFIT tokens
**Example:**
```typescript
// Source: @solana/spl-token documentation
import {
  createTransferCheckedWithTransferHookInstruction,
  getExtraAccountMetaAddress,
} from "@solana/spl-token";

// The helper automatically fetches ExtraAccountMetaList and resolves accounts
const transferIx = await createTransferCheckedWithTransferHookInstruction(
  connection,
  sourceTokenAccount,
  profitMint,
  destinationTokenAccount,
  owner,
  BigInt(amount),
  decimals,
  [],  // additional signers
  "confirmed",
  TOKEN_2022_PROGRAM_ID,
);
```

### Pattern 2: Staking Instruction with remaining_accounts
**What:** Pass resolved hook accounts to Staking Program instructions
**When to use:** stake() and unstake() calls with PROFIT tokens
**Example:**
```typescript
// Source: Existing programs/staking/src/instructions/stake.rs pattern
// The instruction already accepts remaining_accounts and forwards them

// Build transfer instruction to extract remaining_accounts
const transferIx = await createTransferCheckedWithTransferHookInstruction(
  connection,
  userTokenAccount,
  profitMint,
  stakeVault,
  userPublicKey,
  BigInt(amount),
  PROFIT_DECIMALS,
  [],
  "confirmed",
  TOKEN_2022_PROGRAM_ID,
);

// Extract the remaining accounts (everything after first 4)
const hookAccounts = transferIx.keys.slice(4);

// Call stake with remaining_accounts
await program.methods
  .stake(new anchor.BN(amount))
  .accountsStrict({
    user: user.publicKey,
    stakePool,
    userStake,
    userTokenAccount,
    stakeVault,
    profitMint,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .remainingAccounts(hookAccounts)  // Pass hook accounts
  .signers([user])
  .rpc();
```

### Pattern 3: Escrow Solvency Assertion
**What:** Assert escrow balance >= sum(pending rewards) after every operation
**When to use:** End of every test that modifies state
**Example:**
```typescript
// Source: 28-CONTEXT.md decision
async function assertEscrowSolvency(
  connection: Connection,
  stakingProgram: Program<Staking>,
  escrowVault: PublicKey,
  stakePool: PublicKey,
): Promise<void> {
  const pool = await stakingProgram.account.stakePool.fetch(stakePool);
  const escrowBalance = await connection.getBalance(escrowVault);

  // Pending rewards + any unclaimed must be covered by escrow
  expect(escrowBalance).to.be.gte(pool.pendingRewards.toNumber());
}
```

### Anti-Patterns to Avoid
- **Direct transfer without hook accounts:** Will fail with `NoWhitelistedParty` error
- **Forgetting to whitelist StakeVault:** All stake/unstake will fail
- **Using plain `transfer` instead of `transfer_checked`:** Bypasses hooks entirely (security hole)
- **Hardcoding account indices:** Use the helper function to resolve dynamically

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Resolving ExtraAccountMetas | Manual PDA derivation | `createTransferCheckedWithTransferHookInstruction` | Handles edge cases, updates with SPL token library |
| Account index mapping | Manual array slicing | Use `.keys.slice(4)` pattern | First 4 are always source/mint/dest/owner |
| Whitelist PDA derivation | Custom function | Existing `WhitelistEntry::SEED_PREFIX` pattern | Consistency with transfer-hook program |
| Epoch time warping | Manual slot math | `warp_to_slot` in bankrun | Already used in other tests |

**Key insight:** The Transfer Hook infrastructure is already fully implemented in this codebase. This phase is about integration testing, not new program logic.

## Common Pitfalls

### Pitfall 1: Missing Whitelist Entry
**What goes wrong:** Stake/unstake fails with `NoWhitelistedParty` error
**Why it happens:** StakeVault PDA not added to Transfer Hook whitelist before testing
**How to avoid:** Initialize whitelist entry in beforeAll hook, before any stake operations
**Warning signs:** `Error: 6001 NoWhitelistedParty` in test output

### Pitfall 2: Wrong Token Program
**What goes wrong:** Transfer fails with program mismatch error
**Why it happens:** Using SPL Token program ID instead of Token-2022
**How to avoid:** Always use `TOKEN_2022_PROGRAM_ID` for PROFIT transfers
**Warning signs:** `Error: Incorrect program id for instruction`

### Pitfall 3: Empty remaining_accounts
**What goes wrong:** Transfer hook cannot find whitelist PDAs
**Why it happens:** Not passing hook accounts through to CPI
**How to avoid:** Always resolve and pass remaining_accounts for Token-2022 transfers
**Warning signs:** `Error: Account not found` or hook validation fails

### Pitfall 4: Stale ExtraAccountMeta Resolution
**What goes wrong:** Transfer fails with wrong accounts
**Why it happens:** Cached or stale account metadata
**How to avoid:** Always resolve fresh with confirmed commitment
**Warning signs:** PDA mismatch errors

### Pitfall 5: Test Order Dependencies
**What goes wrong:** Tests pass individually but fail together
**Why it happens:** Tests depending on state from previous tests
**How to avoid:** Use beforeAll for shared initialization, make tests independent
**Warning signs:** Random test failures, different results on re-runs

## Code Examples

Verified patterns from existing codebase:

### Add Whitelist Entry for StakeVault
```typescript
// Source: programs/transfer-hook/src/instructions/add_whitelist_entry.rs
const [whitelistEntry] = PublicKey.findProgramAddressSync(
  [Buffer.from("whitelist"), stakeVault.toBuffer()],
  transferHookProgram.programId
);

await transferHookProgram.methods
  .addWhitelistEntry()
  .accountsStrict({
    authority: admin.publicKey,
    whitelistAuthority,
    whitelistEntry,
    addressToWhitelist: stakeVault,
    systemProgram: SystemProgram.programId,
  })
  .signers([admin])
  .rpc();
```

### Full Stake with Hook Accounts
```typescript
// Source: Combining patterns from amm/helpers/transfers.rs and staking/stake.rs
async function stakeWithHook(
  connection: Connection,
  program: Program<Staking>,
  user: Keypair,
  amount: number,
  accounts: {
    stakePool: PublicKey;
    userStake: PublicKey;
    userTokenAccount: PublicKey;
    stakeVault: PublicKey;
    profitMint: PublicKey;
  }
): Promise<string> {
  // Resolve hook accounts
  const transferIx = await createTransferCheckedWithTransferHookInstruction(
    connection,
    accounts.userTokenAccount,
    accounts.profitMint,
    accounts.stakeVault,
    user.publicKey,
    BigInt(amount),
    6, // PROFIT_DECIMALS
    [],
    "confirmed",
    TOKEN_2022_PROGRAM_ID,
  );

  // Extract remaining accounts (skip first 4: source, mint, dest, authority)
  const hookAccounts = transferIx.keys.slice(4).map(key => ({
    pubkey: key.pubkey,
    isSigner: key.isSigner,
    isWritable: key.isWritable,
  }));

  return await program.methods
    .stake(new anchor.BN(amount))
    .accountsStrict({
      user: user.publicKey,
      stakePool: accounts.stakePool,
      userStake: accounts.userStake,
      userTokenAccount: accounts.userTokenAccount,
      stakeVault: accounts.stakeVault,
      profitMint: accounts.profitMint,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(hookAccounts)
    .signers([user])
    .rpc();
}
```

### Negative Test: Stake Fails Without Whitelist
```typescript
// Source: 28-CONTEXT.md requirement for explicit negative test
it("stake fails when StakeVault not whitelisted", async () => {
  // Create fresh mint without whitelist setup
  const testMint = await createMint(...);
  const testStakeVault = /* derive from fresh mint */;

  // Attempt stake should fail
  try {
    await stakeWithHook(connection, program, user, 1_000_000, {
      stakePool,
      userStake,
      userTokenAccount,
      stakeVault: testStakeVault,  // Not whitelisted!
      profitMint: testMint,
    });
    expect.fail("Should have failed with NoWhitelistedParty");
  } catch (err: any) {
    expect(err.message).to.include("NoWhitelistedParty");
  }
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual account resolution | `createTransferCheckedWithTransferHookInstruction` | spl-token 0.4+ | Automatic ExtraAccountMeta resolution |
| Plain `transfer` | `transfer_checked` only | Token-2022 launch | Required for hook invocation |
| Hardcoded hook accounts | Dynamic resolution | spl-tlv-account-resolution | Works with any hook configuration |

**Deprecated/outdated:**
- Plain `transfer` instruction: Silently bypasses hooks, security vulnerability
- Manual ExtraAccountMeta parsing: Error-prone, library handles edge cases

## Open Questions

Things that couldn't be fully resolved:

1. **warp_to_slot availability in localnet**
   - What we know: warp_to_slot works in bankrun/test-validator
   - What's unclear: Exact configuration needed for anchor test --localnet
   - Recommendation: Use bankrun for epoch advancement tests, or skip epoch tests in localnet

2. **Escrow rent-exempt minimum**
   - What we know: Escrow is a native SOL PDA (space=0)
   - What's unclear: Minimum balance to remain rent-exempt
   - Recommendation: Calculate `Rent::get()?.minimum_balance(0)` and ensure escrow never drops below

## Sources

### Primary (HIGH confidence)
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/transfer-hook/src/instructions/` - Existing whitelist implementation
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/staking/src/instructions/stake.rs` - Already uses remaining_accounts pattern
- `/Users/mlbob/Projects/Dr Fraudsworth/Docs/Transfer_Hook_Spec.md` - Section 4 (14 whitelist entries including StakeVault)
- `/Users/mlbob/Projects/Dr Fraudsworth/Docs/New_Yield_System_Spec.md` - Section 12.3 (StakeVault whitelist)

### Secondary (MEDIUM confidence)
- https://solana.com/developers/guides/token-extensions/transfer-hook - Official Solana guide
- https://github.com/solana-developers/program-examples/blob/main/tokens/token-2022/transfer-hook/whitelist/ - Official examples

### Tertiary (LOW confidence)
- None - all findings verified against codebase and official docs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Using existing project dependencies
- Architecture: HIGH - Patterns already implemented in codebase (stake.rs, transfers.rs)
- Pitfalls: HIGH - Derived from Transfer Hook spec and existing test patterns
- Code examples: HIGH - Adapted from existing codebase

**Research date:** 2026-02-08
**Valid until:** 2026-03-08 (30 days - stable domain, no breaking changes expected)
