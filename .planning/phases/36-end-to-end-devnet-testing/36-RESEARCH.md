# Phase 36: End-to-End Devnet Testing - Research

**Researched:** 2026-02-11
**Domain:** Solana devnet validation -- full protocol E2E testing (swap, tax, staking, epoch, Carnage)
**Confidence:** HIGH

## Summary

Phase 36 validates the complete Dr. Fraudsworth protocol on Solana devnet as an integrated system. No new program code is written -- this is pure validation and evidence gathering. The protocol consists of 5 deployed programs (AMM, TransferHook, TaxProgram, EpochProgram, Staking) interacting via CPI chains up to 4 levels deep.

The standard approach is a TypeScript orchestrator script using the existing `@coral-xyz/anchor` + `@solana/web3.js` stack, directly reusing the Phase 35 VRF validation infrastructure (`loadProvider`, `loadPrograms`, `advanceEpochWithVRF`). The script creates fresh test user wallets, funds them via SOL transfer from the devnet wallet (not faucet airdrop), creates Token-2022 accounts and WSOL accounts, then executes the full protocol flow: swap with tax, verify tax distribution, stake PROFIT, claim SOL yield, advance epochs with VRF, and trigger Carnage.

**Primary recommendation:** Build a single modular orchestrator script (`scripts/e2e/devnet-e2e-validation.ts`) that reuses existing VRF flow and connection infrastructure, executes test flows sequentially with incremental log-to-file, and generates a structured markdown report at `Docs/E2E_Devnet_Test_Report.md`. Known Carnage bugs (held_amount accounting, fallback discriminator) are expected to fail and should be logged as "known issues", not blockers.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@coral-xyz/anchor` | ^0.32.1 | Anchor provider, program loading, typed accounts | Already installed, provides `Program.methods.*`, typed account fetching, CPI context |
| `@solana/web3.js` | ^1.95.5 | Connection, Keypair, Transaction, PublicKey | Already installed, foundation for all Solana client interaction |
| `@solana/spl-token` | ^0.4.9 | Token-2022 account creation, WSOL wrapping, `createTransferCheckedWithTransferHookInstruction` | Already installed (devDep), handles Token-2022 + hook resolution |
| `@switchboard-xyz/on-demand` | ^3.7.3 | Switchboard VRF 3-TX flow (create, commit, reveal) | Already installed, reuse existing `advanceEpochWithVRF` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `fs` (Node built-in) | n/a | Incremental log file, PDA manifest loading, report writing | Always -- log every TX result to file as it happens |
| `path` (Node built-in) | n/a | Resolve file paths relative to project root | IDL loading, manifest loading, report output paths |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual `invoke_signed` CPI | Anchor CPI helpers | Anchor CPI does NOT forward `remaining_accounts` through nested CPI chains -- manual is required for Transfer Hook support |
| `createTransferCheckedWithTransferHookInstruction` | Manual ExtraAccountMeta resolution | The `@solana/spl-token` helper automatically resolves all hook accounts from the on-chain ExtraAccountMetaList -- no reason to hand-roll |
| Fresh faucet airdrop | Transfer from devnet wallet | CONTEXT.md locks this decision: fund via transfer from `8kPzh...` wallet, not faucet |

**Installation:** No new packages needed. All dependencies already installed.

```bash
# Run E2E validation
export PATH="/opt/homebrew/bin:$PATH"
set -a && source .env && set +a && npx tsx scripts/e2e/devnet-e2e-validation.ts
```

## Architecture Patterns

### Recommended Script Structure

```
scripts/e2e/
├── devnet-e2e-validation.ts    # Main orchestrator (entry point)
├── lib/
│   ├── e2e-logger.ts           # Incremental file logger (crash-safe)
│   ├── e2e-reporter.ts         # Final markdown report generator
│   ├── user-setup.ts           # Fresh wallet + token account creation
│   ├── swap-flow.ts            # Build and execute swap transactions
│   ├── staking-flow.ts         # Stake, deposit_rewards, claim flows
│   └── carnage-flow.ts         # Carnage trigger (forced + natural)
```

### Pattern 1: Reuse Existing Infrastructure

**What:** Import `loadProvider`, `loadPrograms` from `scripts/deploy/lib/connection.ts` and `advanceEpochWithVRF` from `scripts/vrf/lib/vrf-flow.ts`. Load all addresses from `scripts/deploy/pda-manifest.json`.

**When to use:** Always. This is the established pattern from Phase 34 (deployment) and Phase 35 (VRF validation).

**Example:**
```typescript
// Source: scripts/vrf/devnet-vrf-validation.ts (Phase 35 template)
import { loadProvider, loadPrograms } from "../deploy/lib/connection";
import { advanceEpochWithVRF, VRFAccounts } from "../vrf/lib/vrf-flow";

const provider = loadProvider();
const programs = loadPrograms(provider);
const manifest = JSON.parse(fs.readFileSync("scripts/deploy/pda-manifest.json", "utf-8"));
```

### Pattern 2: Fresh User Wallet per Test Run

**What:** Generate a new Keypair, fund it via SOL transfer from devnet wallet (not airdrop), create Token-2022 accounts for CRIME/FRAUD/PROFIT, create WSOL account.

**When to use:** At the start of each E2E test run. Ensures clean state with no leftover accounts from previous runs.

**Example:**
```typescript
// Source: tests/integration/helpers/test-wallets.ts
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAccount,
  mintTo,
  createWrappedNativeAccount,
} from "@solana/spl-token";

// 1. Generate keypair + fund via transfer (NOT airdrop)
const testUser = Keypair.generate();
const transferIx = SystemProgram.transfer({
  fromPubkey: wallet.publicKey,
  toPubkey: testUser.publicKey,
  lamports: 2 * LAMPORTS_PER_SOL,
});
await provider.sendAndConfirm(new Transaction().add(transferIx));

// 2. Create Token-2022 accounts (CRIME, FRAUD, PROFIT)
const userCrimeAccount = await createAccount(
  connection, testUser, crimeMint, testUser.publicKey,
  undefined, undefined, TOKEN_2022_PROGRAM_ID
);

// 3. Mint test tokens (devnet wallet is mint authority)
await mintTo(
  connection, wallet.payer, crimeMint, userCrimeAccount,
  wallet.payer, 1_000_000_000, // 1000 CRIME
  undefined, undefined, TOKEN_2022_PROGRAM_ID
);

// 4. Create WSOL account (standard SPL Token, NOT Token-2022)
const userWsolAccount = await createWrappedNativeAccount(
  connection, testUser, testUser.publicKey,
  1 * LAMPORTS_PER_SOL,
  undefined, undefined, TOKEN_PROGRAM_ID
);
```

### Pattern 3: Resolve Transfer Hook remaining_accounts

**What:** Use `createTransferCheckedWithTransferHookInstruction` from `@solana/spl-token` to resolve the ExtraAccountMeta accounts needed for Token-2022 transfers, then extract them as `remaining_accounts` for the Tax Program instruction.

**When to use:** Every swap instruction that involves Token-2022 tokens (CRIME, FRAUD, PROFIT). The AMM uses manual `invoke_signed` with hook accounts appended to both `ix.accounts` and `account_infos`.

**Example:**
```typescript
// Source: tests/integration/cpi-chains.test.ts:90-116
import { createTransferCheckedWithTransferHookInstruction } from "@solana/spl-token";

async function resolveHookAccounts(
  connection: Connection,
  source: PublicKey,
  mint: PublicKey,
  dest: PublicKey,
  authority: PublicKey,
  amount: bigint
): Promise<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]> {
  const transferIx = await createTransferCheckedWithTransferHookInstruction(
    connection, source, mint, dest, authority, amount,
    6, // TOKEN_DECIMALS
    [], "confirmed", TOKEN_2022_PROGRAM_ID
  );
  // Skip first 4 keys (source, mint, dest, authority) -- rest are hook accounts
  return transferIx.keys.slice(4).map((key) => ({
    pubkey: key.pubkey,
    isSigner: key.isSigner,
    isWritable: key.isWritable,
  }));
}
```

### Pattern 4: SOL Pool Swap Account Assembly (~20 accounts + remaining)

**What:** Build the full account set for a `swap_sol_buy` or `swap_sol_sell` instruction. This requires ~20 named accounts plus the Transfer Hook `remaining_accounts`.

**When to use:** Every SOL-pool swap test (E2E-01).

**Example (swap_sol_buy accounts):**
```typescript
// Source: programs/tax-program/src/instructions/swap_sol_buy.rs (SwapSolBuy struct)
const swapAccounts = {
  user: testUser.publicKey,              // Signer
  epochState: manifest.pdas.EpochState,  // UncheckedAccount
  swapAuthority: manifest.pdas.SwapAuthority, // PDA ["swap_authority"] on Tax Program
  taxAuthority: manifest.pdas.TaxAuthority,   // PDA ["tax_authority"] on Tax Program
  pool: manifest.pools["CRIME/SOL"].pool,
  poolVaultA: manifest.pools["CRIME/SOL"].vaultA,   // WSOL vault
  poolVaultB: manifest.pools["CRIME/SOL"].vaultB,   // CRIME vault
  mintA: NATIVE_MINT,                     // WSOL mint
  mintB: manifest.mints.CRIME,
  userTokenA: userWsolAccount,            // User's WSOL
  userTokenB: userCrimeAccount,           // User's CRIME
  stakePool: manifest.pdas.StakePool,
  stakingEscrow: manifest.pdas.EscrowVault,
  carnageVault: manifest.pdas.CarnageSolVault,
  treasury: wallet.publicKey,             // Treasury placeholder
  ammProgram: manifest.programs.AMM,
  tokenProgramA: TOKEN_PROGRAM_ID,        // SPL Token (for WSOL)
  tokenProgramB: TOKEN_2022_PROGRAM_ID,   // Token-2022 (for CRIME)
  systemProgram: SystemProgram.programId,
  stakingProgram: manifest.programs.Staking,
};

// Plus remaining_accounts for Transfer Hook
const hookAccounts = await resolveHookAccounts(
  connection, poolVaultB, crimeMint, userCrimeAccount,
  swapAuthority, BigInt(expectedOutputAmount)
);
```

### Pattern 5: Incremental Crash-Safe Logging

**What:** Append results to a log file after each significant operation. If the script crashes, partial evidence is preserved. Generate the final markdown report from the accumulated log at the end.

**When to use:** Always. CONTEXT.md explicitly requires silent console + incremental file logging.

**Example:**
```typescript
function appendLog(logPath: string, entry: LogEntry): void {
  fs.appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
}
```

### Pattern 6: Before/After State Snapshots

**What:** Capture account balances (SOL, token accounts, pool reserves, EpochState, StakePool, CarnageFund) before and after each test flow. Calculate deltas and include in report.

**When to use:** Every test flow (swap, stake, claim, epoch transition, Carnage).

### Anti-Patterns to Avoid

- **Using `requestAirdrop` for test user funding:** CONTEXT.md locks the decision -- use SOL transfer from devnet wallet, not faucet. Faucet has rate limits and can fail.
- **Using Anchor CPI helpers for Token-2022 transfers:** Anchor's `transfer_checked` does NOT forward `remaining_accounts` through nested CPI chains. Use manual `invoke_signed` (already implemented in AMM).
- **Creating WSOL accounts with Token-2022 program:** WSOL uses standard `TOKEN_PROGRAM_ID`, not `TOKEN_2022_PROGRAM_ID`. Native SOL has no transfer hooks.
- **Hardcoding PDA addresses:** Always load from `scripts/deploy/pda-manifest.json` for consistency with deployed state.
- **Making rapid sequential RPC calls:** Helius free tier is rate-limited. Add 200ms delays between RPC calls (established pattern from Phase 35).
- **Using `getAssociatedTokenAddress` for PDA-owned WSOL:** ATA rejects off-curve (PDA) owners. Use explicit `Keypair` for PDA-owned WSOL accounts.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Transfer Hook account resolution | Manual ExtraAccountMeta parsing | `createTransferCheckedWithTransferHookInstruction` from `@solana/spl-token` | Correctly reads ExtraAccountMetaList PDA and resolves all hook accounts including whitelist PDAs |
| VRF epoch transition | New VRF flow | `advanceEpochWithVRF()` from `scripts/vrf/lib/vrf-flow.ts` | Already tested in Phase 35 with 5/5 transitions + security tests |
| Provider/program setup | New connection code | `loadProvider()` + `loadPrograms()` from `scripts/deploy/lib/connection.ts` | Already handles env vars, wallet loading, typed program instances |
| PDA derivation | Inline `findProgramAddressSync` | Helpers from `tests/integration/helpers/constants.ts` | `derivePoolPDA`, `deriveVaultPDAs`, `deriveWhitelistEntryPDA` with correct seed buffers |
| EpochState reading | Raw account fetch | `readEpochState()` from `scripts/vrf/lib/epoch-reader.ts` | Already handles BN-to-number conversion and cheapSide enum parsing |
| WSOL wrapping | Manual create + transfer | `createWrappedNativeAccount()` from `@solana/spl-token` | Handles rent-exempt minimum, sync native, and correct program ID |
| Report generation | Custom string building | Extend `ValidationReporter` pattern from `scripts/vrf/lib/reporter.ts` | Structured class with `addXxx()` / `generate()` pattern |

**Key insight:** Phase 36 is purely a validation phase. Every piece of infrastructure it needs already exists in the codebase from Phases 31-35. The only new code is the orchestration layer that connects existing building blocks into complete user flows.

## Common Pitfalls

### Pitfall 1: Wrong Token Program for WSOL vs Token-2022

**What goes wrong:** Using `TOKEN_2022_PROGRAM_ID` for WSOL accounts or `TOKEN_PROGRAM_ID` for CRIME/FRAUD/PROFIT accounts causes "IncorrectProgramId" errors.
**Why it happens:** The protocol uses mixed token programs: WSOL uses standard SPL Token (no hooks), while CRIME/FRAUD/PROFIT use Token-2022 (with Transfer Hook extension). SOL pools have `token_program_a = TOKEN_PROGRAM_ID` and `token_program_b = TOKEN_2022_PROGRAM_ID`.
**How to avoid:** Always pass `TOKEN_PROGRAM_ID` for `tokenProgramA` (WSOL side) and `TOKEN_2022_PROGRAM_ID` for `tokenProgramB` (Token-2022 side) in SOL pool swaps. For PROFIT pools, both sides use `TOKEN_2022_PROGRAM_ID`.
**Warning signs:** "IncorrectProgramId" or "Account does not match expected program" errors.

### Pitfall 2: Missing remaining_accounts for Transfer Hook

**What goes wrong:** Swap transactions fail with "Program log: Transfer hook program not found" or similar errors.
**Why it happens:** Token-2022 transfers of CRIME/FRAUD/PROFIT require the Transfer Hook accounts (ExtraAccountMetaList, whitelist PDAs, hook program) in the instruction's remaining_accounts. Without them, Token-2022 cannot invoke the hook.
**How to avoid:** Always resolve hook accounts using `createTransferCheckedWithTransferHookInstruction` and pass them as `.remainingAccounts(hookAccounts)` on the Tax Program instruction. For PROFIT pool swaps (both sides are Token-2022), the AMM splits remaining_accounts at midpoint: first half for input transfer, second half for output transfer.
**Warning signs:** Any transfer-related error in swap CPI logs.

### Pitfall 3: PROFIT Pool remaining_accounts Midpoint Split

**What goes wrong:** PROFIT pool swaps (CRIME/PROFIT or FRAUD/PROFIT) fail because hook accounts are not correctly split between input and output transfers.
**Why it happens:** The AMM's `swap_profit_pool` splits `remaining_accounts` at the midpoint (`ctx.remaining_accounts.len() / 2`). First half is used for the input Token-2022 transfer, second half for the output Token-2022 transfer. If the caller provides hook accounts in the wrong order or with wrong count, the split will be incorrect.
**How to avoid:** Resolve hook accounts separately for input transfer (user -> vault) and output transfer (vault -> user), then concatenate them: `[...inputHookAccounts, ...outputHookAccounts]`.
**Warning signs:** "Transfer hook program not found" on the second transfer in a PROFIT pool swap.

### Pitfall 4: Helius Free Tier Rate Limiting

**What goes wrong:** RPC calls fail with 429 or connection errors.
**Why it happens:** Helius free tier limits requests per second. Rapid sequential calls (especially during VRF polling) can hit the limit.
**How to avoid:** Add `await sleep(200)` between RPC calls. Use 15-second polling intervals for epoch boundary waiting (already established in Phase 35). Wrap `getSlot()` calls in try/catch with retry on transient errors.
**Warning signs:** "429 Too Many Requests" or "Connection error" in logs.

### Pitfall 5: Carnage Known Bugs Will Cause Failures

**What goes wrong:** Carnage-related tests fail: burn fails because `held_amount` stores SOL lamports instead of token count, fallback Carnage discriminator mismatch, fallback missing `swap_authority`.
**Why it happens:** These are documented audit findings (H041, H042, H063, H089, H094 for held_amount; H018, H052, H058, H099 for discriminator; H019, H059 for missing swap_authority). They have NOT been fixed yet -- fixes are planned for Phase 36.1.
**How to avoid:** Cannot avoid -- these are program bugs. The script MUST handle these failures gracefully:
  - Log the failure with full TX signature, error message, expected vs actual behavior
  - Mark as "known issue" in the report (not "unexpected failure")
  - Continue running remaining test flows
  - The report should clearly map each known issue to its audit finding ID
**Warning signs:** Any Carnage burn/sell/fallback failure.

### Pitfall 6: EpochState cheapSide Enum Handling

**What goes wrong:** Code expects `cheapSide` to be a number (0/1) but receives an Anchor enum object like `{ crime: {} }` or `{ fraud: {} }`.
**Why it happens:** Anchor deserializes Rust enums as objects in TypeScript. The `readEpochState` helper already handles this, but custom code that reads EpochState directly may not.
**How to avoid:** Use the `readEpochState()` helper from `scripts/vrf/lib/epoch-reader.ts` which normalizes the enum. If reading directly, check both formats: `typeof cheapSide === 'number' ? cheapSide : 'crime' in cheapSide ? 0 : 1`.
**Warning signs:** "Cannot read property 'crime' of undefined" or unexpected tax rate directions.

### Pitfall 7: Switchboard TX1 Requires skipPreflight

**What goes wrong:** The first VRF transaction (create randomness account) fails with preflight errors.
**Why it happens:** Switchboard's `sb.Randomness.create()` uses lookup tables that may be stale in the preflight simulation. Setting `skipPreflight: true` bypasses this.
**How to avoid:** Already handled in `advanceEpochWithVRF()` -- it sends TX1 with `{ skipPreflight: true, maxRetries: 3 }`. Do not modify this behavior.
**Warning signs:** "Transaction simulation failed" on the randomness creation TX.

### Pitfall 8: Mint Authority Required for Token Minting to Test Users

**What goes wrong:** Cannot mint CRIME/FRAUD/PROFIT tokens to test user accounts.
**Why it happens:** The devnet wallet (`8kPzh...`) is the mint authority for all 3 Token-2022 mints. Minting requires signing with this keypair.
**How to avoid:** Use the devnet wallet keypair (loaded via `loadProvider().wallet.payer`) as the `mintAuthority` parameter in `mintTo()` calls. The mint authorities have NOT been burned on devnet (per deployment report notes).
**Warning signs:** "Signature verification failed" or "Invalid mint authority" on `mintTo`.

### Pitfall 9: Staking Requires Dead Stake

**What goes wrong:** Staking or yield claim produces incorrect results.
**Why it happens:** The StakePool has a 1 PROFIT dead stake (1,000,000 raw units) deposited during deployment to prevent the first-depositor inflation attack. This affects reward-per-token calculations.
**How to avoid:** The dead stake is already deployed. The test user should stake at least `MINIMUM_STAKE` (1,000,000 raw units = 1 PROFIT) to be above the minimum. Account for the dead stake when calculating expected reward-per-token values.
**Warning signs:** Off-by-small-amount errors in yield calculations.

### Pitfall 10: Transaction Size Limits

**What goes wrong:** Swap transactions exceed the 1232-byte Solana transaction size limit.
**Why it happens:** Swap instructions require ~20 named accounts + remaining_accounts for hook resolution (4-8 additional accounts). Combined with instruction data and signatures, this can approach the limit.
**How to avoid:** Use compute budget instructions (`ComputeBudgetProgram.setComputeUnitLimit`) but keep compute units realistic (swap_sol_buy uses 97-122k CU per Docs/Compute_Budget_Profile.md). If size is an issue, consider using Address Lookup Tables (ALTs) -- but this is unlikely to be needed based on integration test experience.
**Warning signs:** "Transaction too large" errors.

## Code Examples

### Complete SOL Pool Swap Flow (swap_sol_buy)

```typescript
// Source: Synthesized from programs/tax-program/src/instructions/swap_sol_buy.rs
//         and tests/integration/cpi-chains.test.ts

import { createTransferCheckedWithTransferHookInstruction } from "@solana/spl-token";

async function executeSolBuySwap(
  provider: AnchorProvider,
  programs: Programs,
  manifest: any,
  testUser: Keypair,
  userWsolAccount: PublicKey,
  userCrimeAccount: PublicKey,
  amountIn: number,   // SOL lamports
  minimumOutput: number,
  isCrime: boolean     // true = CRIME pool, false = FRAUD pool
): Promise<string> {
  const connection = provider.connection;
  const poolKey = isCrime ? "CRIME/SOL" : "FRAUD/SOL";
  const tokenMint = isCrime ? manifest.mints.CRIME : manifest.mints.FRAUD;

  // 1. Resolve Transfer Hook remaining_accounts
  //    For SOL buy: output is Token-2022 (vault -> user)
  const hookAccounts = await resolveHookAccounts(
    connection,
    new PublicKey(manifest.pools[poolKey].vaultB),  // source: pool vault
    new PublicKey(tokenMint),                        // mint
    userCrimeAccount,                                // dest: user
    new PublicKey(manifest.pdas.SwapAuthority),      // authority: swap_authority PDA
    BigInt(minimumOutput)
  );
  await sleep(200); // Rate limit

  // 2. Build swap instruction
  const tx = await programs.taxProgram.methods
    .swapSolBuy(new anchor.BN(amountIn), new anchor.BN(minimumOutput), isCrime)
    .accounts({
      user: testUser.publicKey,
      epochState: new PublicKey(manifest.pdas.EpochState),
      swapAuthority: new PublicKey(manifest.pdas.SwapAuthority),
      taxAuthority: new PublicKey(manifest.pdas.TaxAuthority),
      pool: new PublicKey(manifest.pools[poolKey].pool),
      poolVaultA: new PublicKey(manifest.pools[poolKey].vaultA),
      poolVaultB: new PublicKey(manifest.pools[poolKey].vaultB),
      mintA: NATIVE_MINT,
      mintB: new PublicKey(tokenMint),
      userTokenA: userWsolAccount,
      userTokenB: userCrimeAccount,
      stakePool: new PublicKey(manifest.pdas.StakePool),
      stakingEscrow: new PublicKey(manifest.pdas.EscrowVault),
      carnageVault: new PublicKey(manifest.pdas.CarnageSolVault),
      treasury: provider.wallet.publicKey,
      ammProgram: new PublicKey(manifest.programs.AMM),
      tokenProgramA: TOKEN_PROGRAM_ID,
      tokenProgramB: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      stakingProgram: new PublicKey(manifest.programs.Staking),
    })
    .remainingAccounts(hookAccounts)
    .signers([testUser])
    .rpc();

  return tx;
}
```

### Staking Flow (stake PROFIT)

```typescript
// Source: programs/staking/src/instructions/stake.rs

async function stakePROFIT(
  provider: AnchorProvider,
  programs: Programs,
  manifest: any,
  testUser: Keypair,
  userProfitAccount: PublicKey,
  amount: number  // raw units (6 decimals)
): Promise<string> {
  // Resolve Transfer Hook accounts for PROFIT transfer (user -> stake_vault)
  const hookAccounts = await resolveHookAccounts(
    provider.connection,
    userProfitAccount,                              // source
    new PublicKey(manifest.mints.PROFIT),            // mint
    new PublicKey(manifest.pdas.StakeVault),         // dest
    testUser.publicKey,                              // authority
    BigInt(amount)
  );
  await sleep(200);

  const tx = await programs.staking.methods
    .stake(new anchor.BN(amount))
    .accounts({
      user: testUser.publicKey,
      stakePool: new PublicKey(manifest.pdas.StakePool),
      // userStake: derived PDA ["user_stake", user] -- Anchor auto-derives with init_if_needed
      userTokenAccount: userProfitAccount,
      stakeVault: new PublicKey(manifest.pdas.StakeVault),
      profitMint: new PublicKey(manifest.mints.PROFIT),
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(hookAccounts)
    .signers([testUser])
    .rpc();

  return tx;
}
```

### Claim SOL Yield

```typescript
// Source: programs/staking/src/instructions/claim.rs
// Claim is SOL-only (no token transfer, no hook accounts needed)

async function claimYield(
  provider: AnchorProvider,
  programs: Programs,
  manifest: any,
  testUser: Keypair
): Promise<string> {
  const [userStakePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_stake"), testUser.publicKey.toBuffer()],
    new PublicKey(manifest.programs.Staking)
  );

  const tx = await programs.staking.methods
    .claim()
    .accounts({
      user: testUser.publicKey,
      stakePool: new PublicKey(manifest.pdas.StakePool),
      userStake: userStakePda,
      escrowVault: new PublicKey(manifest.pdas.EscrowVault),
    })
    .signers([testUser])
    .rpc();

  return tx;
}
```

### Tax Distribution Verification

```typescript
// Verify 75/24/1 split by comparing balances before and after a swap

interface TaxVerification {
  totalTax: number;
  stakingReceived: number;   // Should be ~75% of totalTax
  carnageReceived: number;   // Should be ~24% of totalTax
  treasuryReceived: number;  // Should be ~1% of totalTax (remainder)
  stakingPct: number;
  carnagePct: number;
  treasuryPct: number;
  valid: boolean;
}

function verifyTaxDistribution(
  preEscrow: number, postEscrow: number,
  preCarnage: number, postCarnage: number,
  preTreasury: number, postTreasury: number,
  amountIn: number, taxBps: number
): TaxVerification {
  const expectedTax = Math.floor(amountIn * taxBps / 10_000);
  const stakingReceived = postEscrow - preEscrow;
  const carnageReceived = postCarnage - preCarnage;
  const treasuryReceived = postTreasury - preTreasury;
  const totalReceived = stakingReceived + carnageReceived + treasuryReceived;

  // Per tax_math.rs: staking = 75%, carnage = 24%, treasury = remainder
  const expectedStaking = Math.floor(expectedTax * 75 / 100);
  const expectedCarnage = Math.floor(expectedTax * 24 / 100);
  const expectedTreasury = expectedTax - expectedStaking - expectedCarnage;

  return {
    totalTax: totalReceived,
    stakingReceived,
    carnageReceived,
    treasuryReceived,
    stakingPct: (stakingReceived / totalReceived) * 100,
    carnagePct: (carnageReceived / totalReceived) * 100,
    treasuryPct: (treasuryReceived / totalReceived) * 100,
    valid: stakingReceived === expectedStaking
        && carnageReceived === expectedCarnage
        && treasuryReceived === expectedTreasury,
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@solana/spl-token` ATA helpers for all tokens | `createAccount` with explicit `TOKEN_2022_PROGRAM_ID` | Token-2022 adoption | Must specify program ID explicitly for Token-2022 accounts |
| Anchor CPI `transfer_checked` with `with_remaining_accounts` | Manual `invoke_signed` building raw instruction | Phase 30 discovery | Required for Transfer Hook support through nested CPI chains |
| Switchboard V2 VRF | Switchboard On-Demand (`@switchboard-xyz/on-demand` ^3.7.3) | v3 migration | 3-TX flow: create -> commit+trigger -> reveal+consume |
| `connection.requestAirdrop()` for test funding | SOL transfer from funded wallet | Phase 36 decision | More reliable, avoids faucet rate limits |

**Deprecated/outdated:**
- **Switchboard V2 `@switchboard-xyz/solana.js`:** Replaced by `@switchboard-xyz/on-demand` for VRF flows. The project already uses the new SDK.
- **`getAssociatedTokenAddress` for PDA-owned accounts:** Use explicit `Keypair` for WSOL accounts owned by PDAs (ATA rejects off-curve owners).

## Open Questions

1. **Exact remaining_accounts for Carnage execute_carnage**
   - What we know: Carnage's `execute_carnage` performs a tax-exempt swap via CPI, which requires the full swap account set including Transfer Hook accounts. The `execute_carnage_atomic` path is bundled with `consume_randomness` and includes Carnage-specific accounts (CarnageSigner, CarnageCrimeVault, CarnageFraudVault, etc.).
   - What's unclear: The exact remaining_accounts format for standalone `execute_carnage` (fallback path). Integration tests in `tests/integration/carnage.test.ts` set these up, but the fallback path has known discriminator and missing swap_authority bugs.
   - Recommendation: Focus on testing the atomic Carnage path first (triggered via VRF). Test the fallback path but expect it to fail due to known bugs. Log the failure as a known issue.

2. **Staking update_cumulative Timing**
   - What we know: `update_cumulative` must be called before reading reward-per-token to get accurate yield. The `consume_randomness` instruction calls Staking's `deposit_rewards` via CPI, which updates `pending_rewards`.
   - What's unclear: Whether `update_cumulative` is called automatically during `consume_randomness` or needs a separate call before `claim`.
   - Recommendation: Call `update_cumulative` explicitly before `claim` to ensure accurate reward distribution. Check StakePool state after calling it.

3. **Natural Carnage Trigger Probability**
   - What we know: VRF byte 3 < 11 gives ~4.3% per epoch. Over 16 epochs, there's ~50% chance of at least one natural trigger. CONTEXT.md says "run as many epochs as needed, even overnight."
   - What's unclear: How many epochs will be needed. At 5 minutes per epoch (750 slots), 16 epochs = ~80 minutes. 32 epochs = ~160 minutes.
   - Recommendation: Run epochs in a loop with a maximum of 50 (~4 hours). Log each epoch result. The script should be robust for unattended execution.

## Sources

### Primary (HIGH confidence)
- `programs/tax-program/src/instructions/swap_sol_buy.rs` -- Full account struct and CPI chain for SOL buy swaps
- `programs/amm/src/helpers/transfers.rs` -- Transfer Hook CPI pattern with manual `invoke_signed`
- `programs/staking/src/instructions/stake.rs` -- Stake accounts struct
- `programs/staking/src/instructions/claim.rs` -- Claim accounts struct (SOL-only, no token transfer)
- `scripts/vrf/devnet-vrf-validation.ts` -- Phase 35 orchestrator template
- `scripts/vrf/lib/vrf-flow.ts` -- VRF 3-TX flow with Switchboard On-Demand
- `scripts/deploy/lib/connection.ts` -- Provider and program loading utilities
- `scripts/deploy/pda-manifest.json` -- All deployed addresses
- `tests/integration/helpers/test-wallets.ts` -- Token-2022 account creation + WSOL wrapping patterns
- `tests/integration/helpers/constants.ts` -- PDA seeds, derivation helpers
- `tests/integration/cpi-chains.test.ts` -- Transfer Hook remaining_accounts resolution pattern
- `Docs/Devnet_Deployment_Report.md` -- Deployed state, pool reserves, whitelist entries
- `Docs/VRF_Devnet_Validation_Report.md` -- Phase 35 results, EpochState at epoch 77
- `Docs/Compute_Budget_Profile.md` -- CU measurements for all instruction paths
- `.audit/findings/H112.md` -- Compound Carnage failure cascade (held_amount + fallback bugs)

### Secondary (MEDIUM confidence)
- `Docs/AMM_Implementation.md` -- AMM design spec (verified against code)
- `Docs/New_Yield_System_Spec.md` -- Staking system spec (verified against code)
- `Docs/Tax_Pool_Logic_Spec.md` -- Tax distribution spec (verified against code)
- `Docs/Carnage_Fund_Spec.md` -- Carnage mechanics spec (verified against code)
- `Docs/Epoch_State_Machine_Spec.md` -- Epoch state machine with VRF byte allocation

### Tertiary (LOW confidence)
- None. All findings verified against codebase.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All libraries already installed and used in Phases 31-35. No new dependencies needed.
- Architecture: HIGH -- Patterns directly derived from existing Phase 35 orchestrator and Phase 32 integration test code.
- Pitfalls: HIGH -- All pitfalls observed firsthand in codebase (Transfer Hook patterns, WSOL handling, Carnage bugs from audit findings).

**Research date:** 2026-02-11
**Valid until:** 2026-03-11 (stable -- all code is deployed and not changing)

---

*Phase: 36-end-to-end-devnet-testing*
*Research completed: 2026-02-11*
