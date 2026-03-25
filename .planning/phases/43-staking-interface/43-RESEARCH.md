# Phase 43: Staking Interface - Research

**Researched:** 2026-02-16
**Domain:** Solana staking frontend (Token-2022, Anchor transaction building, React hooks)
**Confidence:** HIGH

## Summary

This phase implements the frontend staking interface for PROFIT tokens, enabling users to stake, unstake (with auto-claimed SOL rewards), claim SOL rewards, and view yield statistics. The on-chain staking program (Bb8istpSMj2TZB9h8Fh6H3fWeqAjSjmPBec7i4gWiYRi) is fully deployed and tested with 28 passing integration tests. The frontend work follows established patterns from Phase 42's swap implementation.

The on-chain program uses the Synthetix/Quarry cumulative reward-per-token pattern with `PRECISION = 1e18`. Three user-facing instructions exist: `stake(amount)`, `unstake(amount)` (auto-claims), and `claim()`. All PROFIT transfers use Token-2022 with a Transfer Hook, requiring 4 hook remaining_accounts per transfer (same as swap). The claim instruction transfers native SOL from an escrow PDA to the user and does NOT involve any token transfers, so no hook accounts are needed for claim.

**Primary recommendation:** Mirror the swap phase architecture exactly -- `app/lib/staking/` for transaction builders and error map, `app/hooks/useStaking.ts` for orchestration, and `app/components/staking/` for tabbed form components. Reuse `resolveHookAccounts()` from `app/lib/swap/hook-resolver.ts` for stake/unstake transactions.

## Standard Stack

### Core

No new libraries needed. This phase uses the same stack as Phase 42:

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@coral-xyz/anchor` | (existing) | IDL-typed program interaction, instruction building | Already in use for swap builders |
| `@solana/web3.js` | (existing) | Transaction, PublicKey, Connection | Core Solana SDK |
| `@solana/spl-token` | (existing) | TOKEN_2022_PROGRAM_ID, ATA derivation | Token-2022 account operations |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@dr-fraudsworth/shared` | (local) | SEEDS, MINTS, PROGRAM_IDS, DEVNET_PDAS_EXTENDED | All PDA derivation, account addresses |
| `app/lib/anchor.ts` | (existing) | `getStakingProgram()` | Account deserialization (StakePool, UserStake) |
| `app/lib/connection.ts` | (existing) | `getConnection()` | RPC calls |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Anchor IDL for account reads | Raw RPC getAccountInfo + manual deserialization | Anchor IDL already available and typed; no benefit to raw approach |
| Polling for reward updates | WebSocket subscription | Epoch-based rewards change only when `update_cumulative` runs; polling every 30s is sufficient and simpler |

**Installation:** No new packages needed.

## Architecture Patterns

### Recommended Project Structure

```
app/
├── lib/staking/
│   ├── staking-builders.ts   # buildStakeTransaction, buildUnstakeTransaction, buildClaimTransaction
│   └── error-map.ts          # parseStakingError (maps StakingError codes 6000-6010)
├── hooks/
│   └── useStaking.ts         # Orchestrates staking lifecycle (mirrors useSwap pattern)
└── components/staking/
    ├── StakingForm.tsx        # Tabbed container (sole hook consumer)
    ├── StakeTab.tsx           # Amount input + "Stake" button
    ├── UnstakeTab.tsx         # Amount input + "Unstake" button + confirmation
    ├── ClaimTab.tsx           # One-click claim button + expandable detail
    ├── StakingStatus.tsx      # Inline status (mirrors SwapStatus)
    └── StakingStats.tsx       # Reward rate, pool share, protocol stats
```

### Pattern 1: Transaction Builder Pattern (from swap-builders.ts)

**What:** Separate transaction construction from orchestration. Each builder creates a complete unsigned Transaction.
**When to use:** For each staking instruction (stake, unstake, claim).

```typescript
// Source: Established pattern from app/lib/swap/swap-builders.ts
export interface StakeParams {
  connection: Connection;
  userPublicKey: PublicKey;
  amount: number;           // PROFIT base units (6 decimals)
  computeUnits?: number;
  priorityFeeMicroLamports?: number;
}

export async function buildStakeTransaction(params: StakeParams): Promise<Transaction> {
  const { connection, userPublicKey, amount, computeUnits = 200_000 } = params;
  const tx = new Transaction();

  // 1. Compute budget
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }));

  // 2. Check if user PROFIT ATA exists (create if needed)
  const userProfitAta = await getToken2022Ata(userPublicKey, MINTS.PROFIT);
  // (ATA check logic)

  // 3. Resolve hook accounts for PROFIT transfer (user -> stake_vault)
  const hookAccounts = resolveHookAccounts(
    userProfitAta,                                 // source: user sends PROFIT
    MINTS.PROFIT,                                  // PROFIT mint
    new PublicKey("P3RoEdDMEXjv4uDX8gttnyPdPsJ5K6LuffuD2wEEorc"), // dest: stake_vault
  );

  // 4. Build stake instruction via Anchor
  const stakingProgram = getStakingProgram(connection);
  const stakeIx = await stakingProgram.methods
    .stake(new BN(amount))
    .accountsStrict({
      user: userPublicKey,
      stakePool: DEVNET_PDAS_EXTENDED.StakePool,
      userStake: deriveUserStakePDA(userPublicKey),
      userTokenAccount: userProfitAta,
      stakeVault: STAKE_VAULT_PUBKEY,
      profitMint: MINTS.PROFIT,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(hookAccounts)
    .instruction();

  tx.add(stakeIx);
  return tx;
}
```

### Pattern 2: Hook-as-Orchestrator Pattern (from useSwap.ts)

**What:** A single React hook manages the entire lifecycle: form state, account reading, transaction building, signing, sending, error parsing.
**When to use:** `useStaking()` follows the exact same state machine as `useSwap()`.

```typescript
// Source: Established pattern from app/hooks/useSwap.ts
export type StakingStatus =
  | "idle"
  | "building"
  | "signing"
  | "sending"
  | "confirming"
  | "confirmed"
  | "failed";

export interface UseStakingReturn {
  // Active tab
  activeTab: "stake" | "unstake" | "claim";
  setActiveTab: (tab: "stake" | "unstake" | "claim") => void;

  // Form state
  amount: string;
  setAmount: (amount: string) => void;

  // On-chain data
  stakePool: StakePoolData | null;
  userStake: UserStakeData | null;
  pendingRewards: number;  // Client-side calculated

  // Execution
  execute: () => Promise<void>;
  status: StakingStatus;
  txSignature: string | null;
  errorMessage: string | null;
  lastResult: { unstaked?: number; claimed?: number } | null;

  // Stats
  rewardRate: RewardRateStats | null;
  poolSharePct: number;

  // Wallet & balance
  connected: boolean;
  profitBalance: number;

  // Reset
  resetForm: () => void;
}
```

### Pattern 3: Sole Hook Consumer (from SwapForm.tsx)

**What:** Only the top-level form component calls `useStaking()`. All children receive data as props.
**When to use:** StakingForm.tsx calls `useStaking()` and passes data to StakeTab, UnstakeTab, ClaimTab, StakingStats, and StakingStatus via props.

### Pattern 4: Expandable Detail (from FeeBreakdown.tsx)

**What:** Collapsed one-line summary, expand for detailed breakdown.
**When to use:** ClaimTab shows "Claim X.XX SOL" collapsed, expands to show epochs since last claim, reward rate, pool share, etc.

### Anti-Patterns to Avoid

- **DO NOT use `createTransferCheckedWithTransferHookInstruction`:** The browser `buffer` polyfill lacks `BigInt` methods. Use `resolveHookAccounts()` from hook-resolver.ts (manual PDA derivation) instead.
- **DO NOT query for hook accounts via RPC:** The existing hook-resolver.ts derives all 4 accounts deterministically (ExtraAccountMetaList, source whitelist, dest whitelist, hook program) with zero RPC calls.
- **DO NOT use `init_if_needed` from the client side for UserStake:** The on-chain `stake` instruction already uses `init_if_needed` for the UserStake PDA. The client just needs to pass the derived PDA address. Anchor will create it if it doesn't exist. However, the first `stake` call WILL cost slightly more SOL (account rent), so the UI should mention this.
- **DO NOT build a live ticker for pending rewards:** Rewards only change when `update_cumulative` runs (epoch boundary). A 30-second poll is appropriate. A live countdown would mislead users into thinking rewards are accruing continuously.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Transfer Hook account resolution | Custom PDA derivation for staking | `resolveHookAccounts()` from `app/lib/swap/hook-resolver.ts` | Already handles PROFIT mint; same 4 accounts needed |
| Anchor program instance | Manual IDL parsing | `getStakingProgram()` from `app/lib/anchor.ts` | Already exists, typed for `StakePool` and `UserStake` |
| Token balance queries | Custom RPC calls | `useTokenBalances()` from `app/hooks/useTokenBalances.ts` | Already handles TOKEN_2022_PROGRAM_ID |
| PDA derivation seeds | Hardcoded strings | `SEEDS.*` from `@dr-fraudsworth/shared` | Seeds already in shared constants, guaranteed to match on-chain |
| Wallet abstraction | Direct Privy calls | `useProtocolWallet()` | Already wraps Privy with signTransaction, works with both embedded and external wallets |

**Key insight:** Phase 42 established all the infrastructure patterns. Phase 43 should ONLY add staking-specific code -- builders, error map, hook, and components. No new infrastructure.

## Common Pitfalls

### Pitfall 1: Missing Hook Remaining Accounts on Stake/Unstake

**What goes wrong:** PROFIT is a Token-2022 token with a Transfer Hook extension. If remaining_accounts are not passed to `stake()` or `unstake()`, the token transfer CPI fails with error 3005 (AccountNotEnoughKeys).
**Why it happens:** Anchor's built-in `transfer_checked` does NOT forward `remaining_accounts`. The on-chain program uses the custom `transfer_checked_with_hook` helper which requires the client to pass hook accounts via `remaining_accounts`.
**How to avoid:** Call `resolveHookAccounts(source, MINTS.PROFIT, dest)` for stake and unstake. For stake: source=userAta, dest=stakeVault. For unstake: source=stakeVault, dest=userAta.
**Warning signs:** Error 3005 (AccountNotEnoughKeys) or error 0x1780 in transaction logs.

### Pitfall 2: Hook Account Direction for Unstake

**What goes wrong:** Unstake transfers PROFIT FROM stake_vault TO user. If hook accounts are resolved with source=user and dest=vault (backwards), the whitelist PDAs won't match.
**Why it happens:** Developer copies stake hook resolution order without flipping source/dest.
**How to avoid:** For unstake: `resolveHookAccounts(stakeVault, MINTS.PROFIT, userProfitAta)` -- the stakeVault is the SOURCE.
**Warning signs:** Transfer hook failure, whitelist check error.

### Pitfall 3: Claim Does NOT Need Hook Accounts

**What goes wrong:** Developer adds hook remaining_accounts to the claim instruction, causing account mismatch errors.
**Why it happens:** Assumption that all staking instructions need hook accounts.
**How to avoid:** Claim transfers native SOL (lamports) from escrow PDA to user -- no Token-2022 transfer involved. The `Claim` account struct has NO `remaining_accounts` (its handler signature uses `Context<Claim>`, not `Context<'_, '_, 'info, 'info, Claim<'info>>`).
**Warning signs:** Too many accounts error, or the instruction simply doesn't accept remaining_accounts.

### Pitfall 4: Client-Side Pending Reward Calculation Must Mirror On-Chain Math

**What goes wrong:** Displayed pending rewards don't match what's actually claimable, leading to user confusion.
**Why it happens:** The client calculates `pending = (global_cumulative - user_checkpoint) * balance / PRECISION` but uses different precision, rounding, or forgets to include already-accrued `rewards_earned`.
**How to avoid:** The correct formula is:
```
delta = stakePool.rewardsPerTokenStored - userStake.rewardsPerTokenPaid
newPending = (userStake.stakedBalance * delta) / PRECISION
totalPending = userStake.rewardsEarned + newPending
```
where PRECISION = 1e18 (BigInt math required for u128).
**Warning signs:** Mismatch between displayed "Pending: X SOL" and actual claimed amount.

### Pitfall 5: u128 rewardsPerTokenStored Requires BigInt

**What goes wrong:** JavaScript `number` cannot represent u128 values accurately. `rewards_per_token_stored` can be ~1e20 or larger.
**Why it happens:** Anchor's deserialization returns BN objects for u128 fields. Converting to `number` loses precision.
**How to avoid:** Use `BigInt` or `BN` arithmetic for the entire pending reward calculation. Only convert to `number` (as lamports) at the final display step.
**Warning signs:** Reward amounts are wildly wrong (off by orders of magnitude).

### Pitfall 6: StakeVault PDA Not in DEVNET_PDAS_EXTENDED

**What goes wrong:** The `StakeVault` PDA address is in `pda-manifest.json` but NOT exported from `DEVNET_PDAS_EXTENDED` in `shared/constants.ts`.
**Why it happens:** `DEVNET_PDAS_EXTENDED` was created for swap builders which don't need StakeVault. Staking builders do.
**How to avoid:** Add `StakeVault` to `DEVNET_PDAS_EXTENDED` in `shared/constants.ts`, value: `P3RoEdDMEXjv4uDX8gttnyPdPsJ5K6LuffuD2wEEorc` (from pda-manifest.json).
**Warning signs:** Undefined address passed to accountsStrict, causing Anchor "AccountNotEnoughKeys" or "Missing account" errors.

### Pitfall 7: Partial Unstake Auto-Full-Unstake Edge Case

**What goes wrong:** User wants to unstake X, but the on-chain program silently unstakes their full balance if remaining < MINIMUM_STAKE (1 PROFIT = 1_000_000 units).
**Why it happens:** The unstake handler checks `if remaining > 0 && remaining < MINIMUM_STAKE: amount = full_balance`.
**How to avoid:** The UI should pre-check: if `stakedBalance - amount < MINIMUM_STAKE && amount < stakedBalance`, warn the user: "Remaining balance would be below minimum. Your full balance will be unstaked."
**Warning signs:** User unstakes 900 from 1000, expected to keep 100 but balance goes to 0.

## Code Examples

### Account Reading: Fetch StakePool and UserStake

```typescript
// Source: On-chain account structs (programs/staking/src/state/)
import { getStakingProgram } from "@/lib/anchor";
import { DEVNET_PDAS_EXTENDED, SEEDS, PROGRAM_IDS } from "@dr-fraudsworth/shared";

// StakePool is a singleton PDA
async function fetchStakePool() {
  const program = getStakingProgram();
  return program.account.stakePool.fetch(DEVNET_PDAS_EXTENDED.StakePool);
}

// UserStake is per-user PDA: seeds = ["user_stake", userPubkey]
function deriveUserStakePDA(userPubkey: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [SEEDS.USER_STAKE, userPubkey.toBuffer()],
    PROGRAM_IDS.STAKING,
  );
  return pda;
}

async function fetchUserStake(userPubkey: PublicKey) {
  const program = getStakingProgram();
  const pda = deriveUserStakePDA(userPubkey);
  try {
    return await program.account.userStake.fetch(pda);
  } catch {
    return null; // Account doesn't exist (user has never staked)
  }
}
```

### Client-Side Pending Reward Calculation

```typescript
// Source: programs/staking/src/helpers/math.rs (update_rewards function)
const PRECISION = BigInt("1000000000000000000"); // 1e18

function calculatePendingRewards(
  poolRewardsPerTokenStored: bigint,  // from stakePool.rewardsPerTokenStored
  userRewardsPerTokenPaid: bigint,    // from userStake.rewardsPerTokenPaid
  userStakedBalance: bigint,          // from userStake.stakedBalance
  userRewardsEarned: bigint,          // from userStake.rewardsEarned
): number {
  // Step 1: reward delta since user's last checkpoint
  const delta = poolRewardsPerTokenStored - userRewardsPerTokenPaid;

  // Step 2: new pending from this delta
  const newPending = (userStakedBalance * delta) / PRECISION;

  // Step 3: total = already-accrued + newly-calculated
  const totalPending = userRewardsEarned + newPending;

  // Convert to lamports (u64, safe for Number since max SOL supply is ~5e17 lamports)
  return Number(totalPending);
}
```

### Reward Rate Calculation

```typescript
// Source: 43-CONTEXT.md -- "Recent epoch average for reward rate calculation"
// Look at the last N CumulativeUpdated events or compare total_distributed snapshots

interface RewardRateStats {
  perEpochLamports: number;     // Average SOL per epoch (last N epochs)
  annualizedPct: number;        // Annualized as percentage
  totalStaked: number;          // Current total staked (PROFIT base units)
  userSharePct: number;         // User's share of pool
}

function calculateRewardRate(
  stakePool: StakePoolAccount,
  userStakedBalance: number,
): RewardRateStats {
  // Simple approach: use pending_rewards as a proxy for "last epoch's deposit"
  // More accurate: track total_distributed across multiple fetches

  const totalStaked = stakePool.totalStaked.toNumber();
  const userSharePct = totalStaked > 0
    ? (userStakedBalance / totalStaked) * 100
    : 0;

  // Reward rate: per-epoch average
  // This requires historical data -- either from event logs or periodic snapshots.
  // For v1, show "last epoch" from pending_rewards (before it was moved to cumulative).

  return {
    perEpochLamports: stakePool.pendingRewards.toNumber(),
    annualizedPct: 0, // Requires epochs-per-year calculation
    totalStaked,
    userSharePct,
  };
}
```

### Stake Transaction Builder

```typescript
// Source: Established pattern from app/lib/swap/swap-builders.ts
import { resolveHookAccounts } from "@/lib/swap/hook-resolver";

export async function buildStakeTransaction(params: StakeParams): Promise<Transaction> {
  const { connection, userPublicKey, amount, computeUnits = 200_000, priorityFeeMicroLamports = 0 } = params;
  const tx = new Transaction();

  // Compute budget
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }));
  if (priorityFeeMicroLamports > 0) {
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFeeMicroLamports }));
  }

  // Derive user's PROFIT ATA
  const userProfitAta = await getAssociatedTokenAddress(
    MINTS.PROFIT, userPublicKey, false, TOKEN_2022_PROGRAM_ID);

  // Check if user's PROFIT ATA exists; create if needed
  const ataInfo = await connection.getAccountInfo(userProfitAta);
  if (!ataInfo) {
    tx.add(createAssociatedTokenAccountInstruction(
      userPublicKey, userProfitAta, userPublicKey, MINTS.PROFIT, TOKEN_2022_PROGRAM_ID));
  }

  // Resolve Transfer Hook accounts: user ATA -> stake vault
  const stakeVaultPubkey = new PublicKey("P3RoEdDMEXjv4uDX8gttnyPdPsJ5K6LuffuD2wEEorc");
  const hookAccounts = resolveHookAccounts(userProfitAta, MINTS.PROFIT, stakeVaultPubkey);

  // Build stake instruction
  const stakingProgram = getStakingProgram(connection);
  const userStakePda = deriveUserStakePDA(userPublicKey);

  const stakeIx = await stakingProgram.methods
    .stake(new BN(amount))
    .accountsStrict({
      user: userPublicKey,
      stakePool: DEVNET_PDAS_EXTENDED.StakePool,
      userStake: userStakePda,
      userTokenAccount: userProfitAta,
      stakeVault: stakeVaultPubkey,
      profitMint: MINTS.PROFIT,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(hookAccounts)
    .instruction();

  tx.add(stakeIx);
  return tx;
}
```

### Claim Transaction Builder (NO hook accounts needed)

```typescript
// Source: programs/staking/src/instructions/claim.rs
export async function buildClaimTransaction(params: ClaimParams): Promise<Transaction> {
  const { connection, userPublicKey, computeUnits = 100_000, priorityFeeMicroLamports = 0 } = params;
  const tx = new Transaction();

  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }));
  if (priorityFeeMicroLamports > 0) {
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFeeMicroLamports }));
  }

  const stakingProgram = getStakingProgram(connection);
  const userStakePda = deriveUserStakePDA(userPublicKey);

  // Claim: 5 accounts, NO remaining_accounts
  const claimIx = await stakingProgram.methods
    .claim()
    .accountsStrict({
      user: userPublicKey,
      stakePool: DEVNET_PDAS_EXTENDED.StakePool,
      userStake: userStakePda,
      escrowVault: DEVNET_PDAS_EXTENDED.EscrowVault,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  tx.add(claimIx);
  return tx;
}
```

### Unstake Transaction Builder (WITH hook accounts + auto-claim)

```typescript
// Source: programs/staking/src/instructions/unstake.rs
export async function buildUnstakeTransaction(params: UnstakeParams): Promise<Transaction> {
  const { connection, userPublicKey, amount, computeUnits = 200_000, priorityFeeMicroLamports = 0 } = params;
  const tx = new Transaction();

  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }));
  if (priorityFeeMicroLamports > 0) {
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFeeMicroLamports }));
  }

  const userProfitAta = await getAssociatedTokenAddress(
    MINTS.PROFIT, userPublicKey, false, TOKEN_2022_PROGRAM_ID);
  const stakeVaultPubkey = new PublicKey("P3RoEdDMEXjv4uDX8gttnyPdPsJ5K6LuffuD2wEEorc");

  // Hook accounts: stake vault -> user ATA (REVERSED direction from stake)
  const hookAccounts = resolveHookAccounts(stakeVaultPubkey, MINTS.PROFIT, userProfitAta);

  const stakingProgram = getStakingProgram(connection);
  const userStakePda = deriveUserStakePDA(userPublicKey);

  // Unstake: 9 named accounts + 4 remaining (hook)
  const unstakeIx = await stakingProgram.methods
    .unstake(new BN(amount))
    .accountsStrict({
      user: userPublicKey,
      stakePool: DEVNET_PDAS_EXTENDED.StakePool,
      userStake: userStakePda,
      userTokenAccount: userProfitAta,
      stakeVault: stakeVaultPubkey,
      escrowVault: DEVNET_PDAS_EXTENDED.EscrowVault,
      profitMint: MINTS.PROFIT,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(hookAccounts)
    .instruction();

  tx.add(unstakeIx);
  return tx;
}
```

## On-Chain Account Structures Reference

### StakePool (singleton PDA, 62 bytes)

Seeds: `["stake_pool"]`, Program: Staking

| Field | Type | Description |
|-------|------|-------------|
| `total_staked` | u64 | Total PROFIT staked across all users |
| `rewards_per_token_stored` | u128 | Cumulative reward-per-token (PRECISION-scaled) |
| `pending_rewards` | u64 | SOL pending finalization this epoch |
| `last_update_epoch` | u32 | Last epoch when cumulative was updated |
| `total_distributed` | u64 | Lifetime SOL distributed (analytics) |
| `total_claimed` | u64 | Lifetime SOL claimed (analytics) |
| `initialized` | bool | Init flag |
| `bump` | u8 | PDA bump |

### UserStake (per-user PDA, 97 bytes)

Seeds: `["user_stake", user_pubkey]`, Program: Staking

| Field | Type | Description |
|-------|------|-------------|
| `owner` | Pubkey | Account owner (validated on unstake/claim) |
| `staked_balance` | u64 | PROFIT staked by this user |
| `rewards_per_token_paid` | u128 | User's checkpoint of global cumulative |
| `rewards_earned` | u64 | Accumulated unclaimed rewards (lamports) |
| `total_claimed` | u64 | Lifetime SOL claimed by this user |
| `first_stake_slot` | u64 | Slot when user first staked |
| `last_update_slot` | u64 | Slot of last interaction |
| `bump` | u8 | PDA bump |

### Staking Error Codes (for error map)

| Code | Name | UI Message |
|------|------|-----------|
| 6000 | ZeroAmount | "Amount must be greater than zero." |
| 6001 | InsufficientBalance | "You don't have enough PROFIT staked to unstake this amount." |
| 6002 | InsufficientEscrowBalance | "The reward escrow doesn't have enough SOL. Please try again later." |
| 6003 | NothingToClaim | "No rewards available to claim." |
| 6004 | Unauthorized | "You don't own this stake account." |
| 6005 | Overflow | "Calculation error. Please try a smaller amount." |
| 6006 | Underflow | "Calculation error. Please try a smaller amount." |
| 6007 | DivisionByZero | "Calculation error. Please report this issue." |
| 6008 | AlreadyUpdated | "Epoch already finalized. This is an internal error." |
| 6009 | NotInitialized | "The staking pool has not been initialized. Please report this issue." |
| 6010 | AlreadyInitialized | "The staking pool is already initialized." |

### Instruction Account Layouts (from IDL + Rust source)

**stake** (8 named + remaining_accounts):
1. `user` (signer, mut) -- wallet
2. `stake_pool` (mut, PDA) -- seeds: ["stake_pool"]
3. `user_stake` (mut, PDA, init_if_needed) -- seeds: ["user_stake", user]
4. `user_token_account` (mut) -- user's PROFIT Token-2022 ATA
5. `stake_vault` (mut, PDA) -- seeds: ["stake_vault"]
6. `profit_mint` -- PROFIT Token-2022 mint
7. `token_program` -- TOKEN_2022_PROGRAM_ID
8. `system_program` -- SystemProgram
+ 4 remaining_accounts (hook: ExtraAccountMetaList, source whitelist, dest whitelist, hook program)

**unstake** (9 named + remaining_accounts):
1. `user` (signer, mut)
2. `stake_pool` (mut, PDA)
3. `user_stake` (mut, PDA)
4. `user_token_account` (mut) -- user's PROFIT ATA (receives unstaked tokens)
5. `stake_vault` (mut, PDA) -- source of unstaked tokens
6. `escrow_vault` (mut, PDA) -- source of SOL rewards, seeds: ["escrow_vault"]
7. `profit_mint`
8. `token_program` -- TOKEN_2022_PROGRAM_ID
9. `system_program`
+ 4 remaining_accounts (hook accounts, REVERSED direction: vault -> user)

**claim** (5 named, NO remaining_accounts):
1. `user` (signer, mut) -- receives SOL
2. `stake_pool` (mut, PDA)
3. `user_stake` (mut, PDA)
4. `escrow_vault` (mut, PDA) -- source of SOL
5. `system_program`

## PDA Address Reference

All from `scripts/deploy/pda-manifest.json`:

| PDA | Address | Seeds | Program |
|-----|---------|-------|---------|
| StakePool | `AL42AsVfBmCHsUMDynaR6h2yLktq1jB5FS65mz4H8GCf` | ["stake_pool"] | Staking |
| EscrowVault | `GzbZBkszg2rkgDLBCQ17YDT9YQeuF4R72fN7F44qjn8e` | ["escrow_vault"] | Staking |
| StakeVault | `P3RoEdDMEXjv4uDX8gttnyPdPsJ5K6LuffuD2wEEorc` | ["stake_vault"] | Staking |
| UserStake | (per-user) | ["user_stake", user_pubkey] | Staking |
| PROFIT Mint | `J4CzJ5zgAV1dVLFtR3ZrvAMik6oZYQaTt9fKxeFvNvZP` | -- | -- |

**IMPORTANT:** StakeVault (`P3RoEdDMEXjv4uDX8gttnyPdPsJ5K6LuffuD2wEEorc`) is NOT in `DEVNET_PDAS_EXTENDED` yet. It must be added to `shared/constants.ts` before staking builders can use it.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Direct Anchor CPI `transfer_checked` | Manual `transfer_checked_with_hook` + remaining_accounts | Phase 28 discovery | All Token-2022 transfers with hooks must use manual CPI |
| RPC-based hook account resolution | Deterministic PDA derivation (hook-resolver.ts) | Phase 42 | No RPC round-trip for hook accounts; works in browser |
| TOKEN_PROGRAM_ID for token queries | TOKEN_2022_PROGRAM_ID for CRIME/FRAUD/PROFIT | Phase 41 | Using wrong program ID returns zero balances |

**Deprecated/outdated:**
- `createTransferCheckedWithTransferHookInstruction` (spl-token helper): Does not work in browser due to `Buffer.writeBigUInt64LE` dependency. Use manual hook-resolver.ts instead.

## Open Questions

1. **Reward Rate Historical Data Source**
   - What we know: 43-CONTEXT.md specifies "Recent epoch average for reward rate calculation (last N epochs of actual deposits)". StakePool has `total_distributed` and `pending_rewards` but no per-epoch history.
   - What's unclear: How to get per-epoch reward deposit amounts for averaging. Options: (a) parse CumulativeUpdated events from transaction logs, (b) store snapshots of `total_distributed` across polls, (c) derive from `pending_rewards` which represents "current epoch's accumulation" before `update_cumulative` runs.
   - Recommendation: For v1, use approach (c): show `pending_rewards` as "this epoch's rewards" and calculate reward rate from that single value. This is simple, accurate enough, and avoids event parsing complexity. Can iterate with historical data in Phase 44.

2. **Staking Form Placement**
   - What we know: 43-CONTEXT.md says "alongside swap interface on the same page (tech prototype)".
   - What's unclear: Whether to add to the existing `/swap` page or create a combined page.
   - Recommendation: Add StakingForm to the `/swap` page below or beside SwapForm. Both fit the "same page" requirement and the layout is simple enough for a tech prototype.

3. **Transaction Size for Unstake**
   - What we know: Unstake has 9 named accounts + 4 hook remaining_accounts = 13 total. This is well within the 1232-byte limit (swap sell has 20+ accounts and fits).
   - What's unclear: Whether an Address Lookup Table is needed.
   - Recommendation: ALT is NOT needed for staking transactions. 13 accounts is small enough for legacy Transaction (not VersionedTransaction). This simplifies the code significantly vs swap's sell path.

## Sources

### Primary (HIGH confidence)
- `programs/staking/src/` -- All Rust source files (lib.rs, state/, instructions/, helpers/, constants.rs, errors.rs, events.rs)
- `target/idl/staking.json` -- Anchor IDL (1560 lines, complete)
- `tests/staking.ts` -- 15 integration tests covering all instructions
- `app/lib/swap/swap-builders.ts` -- Established transaction builder pattern
- `app/hooks/useSwap.ts` -- Established hook orchestration pattern
- `app/lib/swap/hook-resolver.ts` -- Deterministic hook account resolution
- `app/lib/swap/error-map.ts` -- Error parsing pattern
- `app/lib/anchor.ts` -- Program factory (`getStakingProgram()` already exists)
- `shared/constants.ts` -- SEEDS, MINTS, PROGRAM_IDS, DEVNET_PDAS_EXTENDED
- `scripts/deploy/pda-manifest.json` -- All PDA addresses including StakeVault

### Secondary (MEDIUM confidence)
- `Docs/New_Yield_System_Spec.md` -- Referenced by program source as authoritative spec

### Tertiary (LOW confidence)
- None. All findings verified against source code.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- No new libraries, all patterns established in Phase 42
- Architecture: HIGH -- Direct mirror of swap implementation with staking-specific adjustments
- Pitfalls: HIGH -- All identified from actual on-chain source code and known issues (MEMORY.md)
- On-chain interface: HIGH -- Read complete Rust source + IDL + test files
- Reward math: HIGH -- Verified from helpers/math.rs with formula documentation

**Research date:** 2026-02-16
**Valid until:** 2026-03-16 (stable -- on-chain programs are deployed and tested)
