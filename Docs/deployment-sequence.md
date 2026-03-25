---
doc_id: deployment-sequence
title: "Dr. Fraudsworth's Finance Factory — Deployment Sequence"
wave: 3
requires: [architecture, operational-runbook]
provides: [deployment-sequence]
status: draft
decisions_referenced: [architecture, security, operations, testing, token-model]
needs_verification: [mainnet-priority-fee-vs-bounty-economics]
---

# Deployment Sequence

## Overview

This document defines the exact step-by-step procedure to deploy the Dr. Fraudsworth protocol from a clean state to a fully operational system. It supersedes the original `Docs/Deployment_Sequence.md` by incorporating:

- WSOL intermediary setup (Phase 48 -- sell tax extraction without requiring user SOL)
- Protocol-wide Address Lookup Table (ALT) for oversized Carnage transactions
- Token-2022 metadata extensions on mints (MetadataPointer + TokenMetadata)
- Authority burn sequence for progressive immutability
- Mainnet deployment differences (program IDs, RPC, priority fees, multisig)

The deployment system consists of four orchestrated phases, executed by `scripts/deploy/deploy-all.sh`:

1. **Build** -- Compile all 6 Anchor programs, verify artifacts and program ID consistency
2. **Deploy** -- Deploy all 6 programs to the target cluster using deterministic keypairs
3. **Initialize** -- Create mints, PDAs, pools, vault, whitelist entries, seed liquidity (23 steps)
4. **Verify** -- Confirm all accounts exist with correct data (36 checks)

After these four phases, additional manual steps are needed: ALT creation, bonding curve launch (mainnet), and the authority burn sequence.

### Key Principle: Idempotency

Every initialization step checks account existence on-chain before executing. Re-running after partial completion skips already-initialized accounts. Re-running after full completion skips all steps without error. This means `deploy-all.sh` is safe to run multiple times.

### Program Registry (Mainnet -- Canonical)

Source of truth: `deployments/mainnet.json`

| Program | Mainnet ID | Feature Flags |
|---------|-----------|---------------|
| AMM | `5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR` | None |
| Transfer Hook | `CiQPQrmQh6BPhb9k7dFnsEs5gKPgdrvNKFc5xie5xVGd` | None |
| Tax Program | `43fZGRtmEsP7ExnJE1dbTbNjaP1ncvVmMPusSeksWGEj` | N/A (mainnet) |
| Epoch Program | `4Heqc8QEjJCspHR8y96wgZBnBfbe3Qb8N6JBZMQt9iw2` | N/A (mainnet) |
| Staking | `12b3t1cNiAUoYLiWFEnFa4w6qYxVAiqCWU7KZuzLPYtH` | None |
| Conversion Vault | `5uawA6ehYTu69Ggvm3LSK84qFawPKxbWgfngwj15NRJ` | N/A (mainnet) |
| Bonding Curve | `DpX3AhSU3BELfBiGbmBMYLPp8VAy3jbEVt6bQjrxUarV` | N/A (closed) |

### Program Registry (Devnet -- Historical)

> **Note:** These are Phase 69 devnet program IDs, retained for deployment procedure reference. Devnet and mainnet use different keypairs.

| Program | Devnet ID | Keypair File | Feature Flags |
|---------|-----------|-------------|---------------|
| AMM | `5ANTHFtgPgH1fUMywALtrpmT7uMHfWnFbz7hxY3tLzMj` | `keypairs/amm-keypair.json` | None |
| Transfer Hook | `CmNyuLdMeggHS2dKBhzPWHdeTEcpKg4uTevT5tBcBsce` | `keypairs/transfer-hook-keypair.json` | None |
| Tax Program | `DRjNCjt4tfTisSJXD1VrAduKbgA7KHuGPoYwxrUQN8uj` | `keypairs/tax-program-keypair.json` | `devnet` |
| Epoch Program | `G6dmJTdC36VRqqi57QhWH444Ju7ieCzHZW9yhH7TpUhz` | `keypairs/epoch-program.json` | `devnet` |
| Staking | `EZFeU613CfqzNcEumE293QDmimRHyP2ZNWcbTgCQRZSu` | `keypairs/staking-keypair.json` | None |
| Conversion Vault | `6WwVAc12B5x8gukgNyXa4agUyvi9PxdYTdPdnb9qEWFL` | `keypairs/vault-keypair.json` | `devnet` |
| Bonding Curve | `AGhdAyBgfpNhZ3jzQR4D2pH7BTxsiGTcJRYWqsn7cGsL` | `keypairs/bonding-curve-keypair.json` | `devnet` |

**Note:** Tax Program, Epoch Program, Conversion Vault, and Bonding Curve require the `devnet` feature flag for devnet builds. These programs use `compile_error!` guards that prevent building without a feature flag. The two-pass deploy is required: first deploy -> init mints/pools -> rebuild with patched mints -> re-deploy feature-flagged programs.

---

## Pre-Deployment Checklist

### Toolchain Requirements

- Rust toolchain via `rustup` (loaded via `source "$HOME/.cargo/env"`)
- Solana CLI (`~/.local/share/solana/install/active_release/bin/`)
- Anchor CLI (`~/.cargo/bin/anchor`, installed via AVM)
- Node.js + npm (`/opt/homebrew/bin/`)

### Environment Setup

Every shell session must source the toolchains before running Rust/Cargo/Anchor/Solana commands:

```bash
source "$HOME/.cargo/env"
export PATH="/Users/mlbob/.local/share/solana/install/active_release/bin:$PATH"
export PATH="/opt/homebrew/bin:$PATH"
```

### Wallet Requirements

| Item | Devnet | Mainnet |
|------|--------|---------|
| Wallet keypair | `keypairs/devnet-wallet.json` | Squads multisig (2-of-3) |
| Wallet address | `8kPzhQoUPx7LYM18f9TzskW4ZgvGyq4jMPYZikqmHMH4` | TBD (mainnet multisig) |
| Minimum SOL balance | 5 SOL (auto-airdrop if < 5) | ~15 SOL (rent + deploy + init + priority fees) |
| Mint keypairs directory | `scripts/deploy/mint-keypairs/` | New keypairs for mainnet |

### Source of Truth Files

| File | Purpose |
|------|---------|
| `shared/constants.ts` | All PDA seeds, program IDs, mint addresses, pool configs |
| `shared/programs.ts` | ALT address, RPC URL |
| `scripts/deploy/pda-manifest.json` | Generated manifest of all deployed addresses |
| `Anchor.toml` | Program IDs, cluster config, test scripts |
| `.env` | Cluster URL, API keys (gitignored) |

### Pre-Flight Checks

1. Confirm all 6 program keypairs exist in `keypairs/` directory
2. Confirm wallet has sufficient SOL (deploy.sh checks automatically)
3. Confirm target cluster is accessible: `solana cluster-version --url <CLUSTER_URL>`
4. Confirm no in-progress upgrades on any program (mainnet: check Squads queue)

---

## Program Build & Deploy

### Phase 1: Build (`scripts/deploy/build.sh`)

The build script performs three steps:

**Step 1/3: Compile all programs**

```bash
anchor build
```

This runs `cargo build-sbf` for each program in `Anchor.toml`, producing `.so` files in `target/deploy/` and IDL files in `target/idl/`.

**Step 1 (devnet addendum): Rebuild feature-flagged programs**

```bash
anchor build -p epoch_program -- --features devnet
anchor build -p tax_program -- --features devnet
```

Why: Both `epoch_program` and `tax_program` use `#[cfg(feature = "devnet")]` to select environment-specific values:
- `epoch_program`: Switchboard program ID (devnet vs mainnet), `SLOTS_PER_EPOCH` (750 devnet / 4500 mainnet)
- `tax_program`: `treasury_pubkey()` returns devnet wallet vs mainnet treasury

Without the devnet feature flag, these programs compile with mainnet Switchboard PID, causing `ConstraintOwner` errors on devnet.

**Step 2/3: Verify build artifacts**

Checks that all 6 `.so` files exist in `target/deploy/`:
- `amm.so`
- `transfer_hook.so`
- `tax_program.so`
- `epoch_program.so`
- `staking.so`
- `conversion_vault.so`

**Step 3/3: Verify program ID consistency**

```bash
npx tsx scripts/verify-program-ids.ts
```

Checks three layers for each program:
1. Keypair files (`keypairs/*.json`) -- derived pubkeys (source of truth)
2. `declare_id!` macros in each program's `lib.rs`
3. `Anchor.toml` `[programs.localnet]` and `[programs.devnet]` sections

Plus cross-program references and placeholder detection.

### Phase 2: Deploy (`scripts/deploy/deploy.sh`)

```bash
./scripts/deploy/deploy.sh <CLUSTER_URL>
```

Why `solana program deploy` instead of `anchor deploy`: `anchor deploy` generates NEW keypairs each time, deploying to random addresses. Our `declare_id!` macros would not match. Using `solana program deploy --program-id <keypair>` deploys to the deterministic address derived from the keypair. The same command handles both first deploy AND upgrades.

For each of the 6 programs:

```bash
solana program deploy \
  "target/deploy/${name}.so" \
  --program-id "$keypair" \
  --keypair "$WALLET" \
  --url "$CLUSTER_URL" \
  --with-compute-unit-price 1
```

The `--with-compute-unit-price 1` adds a minimal priority fee (1 microlamport per CU) that helps transactions land reliably on rate-limited RPC providers. Cost is negligible (~0.0003 SOL per program).

Post-deploy verification: `solana program show <PROGRAM_ID>` for each program confirms it is deployed and executable.

### Combined Invocation

For a clean deployment from scratch:

```bash
# Devnet
./scripts/deploy/deploy-all.sh https://api.devnet.solana.com

# Or with build.sh --devnet flag manually:
./scripts/deploy/build.sh --devnet
./scripts/deploy/deploy.sh https://api.devnet.solana.com
CLUSTER_URL=https://api.devnet.solana.com npx tsx scripts/deploy/initialize.ts
CLUSTER_URL=https://api.devnet.solana.com npx tsx scripts/deploy/verify.ts
```

---

## Account Initialization Sequence

The initialization script (`scripts/deploy/initialize.ts`) executes 23 steps in strict dependency order. Each step is idempotent.

### Step 1: Create 3 Token-2022 Mints

Creates CRIME, FRAUD, and PROFIT mints with two extensions:

1. **TransferHook** extension -- points to the Transfer Hook program, causing Token-2022 to invoke our hook on every `transfer_checked` call
2. **MetadataPointer** extension -- points to the mint itself for on-chain metadata

Mint keypairs are persisted to `scripts/deploy/mint-keypairs/` on first run and loaded on subsequent runs. This ensures pool PDAs (which depend on mint addresses) remain consistent across deployments.

After mint creation, token metadata is initialized via `tokenMetadataInitializeWithRentTransfer`:
- **CRIME**: symbol=CRIME, uri=`https://dr-fraudsworth-production.up.railway.app/api/metadata/crime`
- **FRAUD**: symbol=FRAUD, uri=`https://dr-fraudsworth-production.up.railway.app/api/metadata/fraud`
- **PROFIT**: symbol=PROFIT, uri=`https://dr-fraudsworth-production.up.railway.app/api/metadata/profit`

**Mainnet Mints (Canonical):**

| Mint | Mainnet Address | Decimals | Supply |
|------|----------------|----------|--------|
| CRIME | `cRiMEhAxoDhcEuh3Yf7Z2QkXUXUMKbakhcVqmDsqPXc` | 6 | 1,000,000,000 (1B) |
| FRAUD | `FraUdp6YhtVJYPxC2w255yAbpTsPqd8Bfhy9rC56jau5` | 6 | 1,000,000,000 (1B) |
| PROFIT | `pRoFiTj36haRD5sG2Neqib9KoSrtdYMGrM7SEkZetfR` | 6 | 20,000,000 (20M) |

**Devnet Mints (Phase 69 -- Historical):**

| Mint | Devnet Address | Decimals | Supply |
|------|---------------|----------|--------|
| CRIME | `F65o4zL6imL4g1HLuaqPaUg4K2eY8EPtGw4esD99XZhR` | 6 | 1,000,000,000 (1B) |
| FRAUD | `83gSRtZCvA1n2h3wEqasadhk53haUFWCrsw6qDRRbuRQ` | 6 | 1,000,000,000 (1B) |
| PROFIT | `8y7Mati78NNAn6YfGqiFeSP9mtnThkFL2AGwGpxmtZ11` | 6 | 1,000,000,000 (1B) -- devnet only |

### Step 2: Initialize Transfer Hook WhitelistAuthority

```
Instruction: initializeAuthority()
PDA: ["authority"] -> WhitelistAuthority
Signer: Admin (becomes the whitelist authority)
```

Creates the global authority PDA that controls whitelist additions. Must complete before any `addWhitelistEntry` calls.

### Step 3: Initialize ExtraAccountMetaLists (x3)

For each mint (CRIME, FRAUD, PROFIT):

```
Instruction: initializeExtraAccountMetaList()
PDA: ["extra-account-metas", mint_pubkey] -> ExtraAccountMetaList
```

Creates the PDA that Token-2022 uses to resolve whitelist accounts at transfer time. Must exist before any `transfer_checked` with that mint.

### Step 4: Initialize AMM AdminConfig

```
Instruction: initializeAdmin(admin_pubkey)
PDA: ["admin"] -> AdminConfig
Verification: ProgramData address via BPF Loader Upgradeable
```

The AMM admin is verified against the program's upgrade authority. This prevents unauthorized pool creation.

### Step 5: Create Admin Token Accounts + Mint Seed Liquidity

Creates admin token accounts for WSOL, CRIME, FRAUD, and PROFIT, then mints 1 billion tokens (at 6 decimals) to each T22 account. These accounts provide seed liquidity for pool initialization.

**Optimization**: If all 2 pool PDAs and VaultConfig already exist on-chain, this step is skipped entirely (saves ~55 SOL on re-runs).

### Step 6: Whitelist Admin T22 Accounts

Whitelists each admin token account (CRIME, FRAUD, PROFIT) so that seed liquidity transfers pass the Transfer Hook check.

### Steps 7-8: Initialize 2 AMM Pools (SOL Pools)

Each pool is created with canonical mint ordering (smaller pubkey = mintA) and seeded with initial liquidity:

| Step | Pool | Type | Fee | Seed A | Seed B |
|------|------|------|-----|--------|--------|
| 7 | CRIME/SOL | MixedPool (SPL + T22) | 100 bps (1%) | SOL | CRIME |
| 8 | FRAUD/SOL | MixedPool (SPL + T22) | 100 bps (1%) | SOL | FRAUD |

Transfer Hook remaining_accounts are automatically constructed for each T22 mint involved in the seed liquidity transfer: `[extraAccountMetaList, whitelistSource, whitelistDest, hookProgramId]` per mint.

Note: CRIME/PROFIT and FRAUD/PROFIT AMM pools have been replaced by the Conversion Vault (Steps 9-13), which provides a fixed 100:1 conversion rate with zero fees instead of AMM-based price discovery.

### Steps 9-13: Initialize Conversion Vault

The Conversion Vault replaces the former PROFIT pools with a deterministic 100:1 fixed-rate conversion (zero fees, no slippage).

**Step 9: Deploy Conversion Vault Program**

The vault program (`conversion_vault.so`) is deployed alongside the other 5 programs in Phase 2. This step verifies it is live and executable.

**Step 10: Initialize VaultConfig PDA**

```
Instruction: initialize()
PDA: ["vault_config"] -> VaultConfig
Signer: Admin (becomes the vault authority)
```

Creates the singleton VaultConfig PDA that stores mint references, bump seeds, and authority. The `initialize` instruction also creates the 3 vault token accounts in the same transaction.

**Step 11: Create Vault Token Accounts**

Created atomically with VaultConfig in Step 10:

```
PDAs:
  - ["vault_crime", vault_config] -> Vault CRIME token account (T22)
  - ["vault_fraud", vault_config] -> Vault FRAUD token account (T22)
  - ["vault_profit", vault_config] -> Vault PROFIT token account (T22)
Authority: VaultConfig PDA (all 3 accounts)
```

**Step 12: Seed Vault with Tokens**

Transfers seed liquidity from admin token accounts to the vault:

| Token | Amount (Devnet) | Amount (Mainnet) |
|-------|----------------|------------------|
| CRIME | 10,000 | 250,000,000 (250M) |
| FRAUD | 10,000 | 250,000,000 (250M) |
| PROFIT | 1,000 | 20,000,000 (20M) |

Transfer Hook remaining_accounts are required for each T22 transfer.

**Step 13: Whitelist Vault Token Accounts**

Whitelists the 3 vault token accounts (vault_crime, vault_fraud, vault_profit) so that conversion transfers pass the Transfer Hook check.

### Step 14: Whitelist Pool Vault Addresses

Whitelists all 4 pool vault addresses (vaultA + vaultB for each of 2 SOL pools). This allows token transfers into and out of pools to pass the Transfer Hook check.

### Step 15: Initialize EpochState

```
Instruction: initializeEpochState()
PDA: ["epoch_state"] -> EpochState
```

Creates the singleton epoch state machine that drives VRF-based tax regime transitions.

### Step 16: Initialize StakePool (with Dead Stake)

```
Instruction: initializeStakePool()
PDAs created:
  - ["stake_pool"] -> StakePool (global state)
  - ["escrow_vault"] -> EscrowVault (native SOL for rewards)
  - ["stake_vault"] -> StakeVault (Token-2022 PROFIT vault)
Dead stake: 1,000,000 base units (1 PROFIT)
```

The dead stake prevents the first-depositor share inflation attack. Transfer Hook remaining_accounts for the PROFIT mint are manually derived and passed since the StakeVault PDA does not exist yet when building the instruction.

### Step 17: Whitelist StakeVault

Whitelists the StakeVault PDA so that all stake/unstake transfers pass the hook check. Since StakeVault is always one end of the transfer, only it needs whitelisting (not individual user accounts).

### Step 18: Initialize Carnage Fund

```
Instruction: initializeCarnageFund()
PDAs created:
  - ["carnage_fund"] -> CarnageFundState
  - ["carnage_sol_vault"] -> CarnageSolVault (SystemAccount)
  - ["carnage_crime_vault"] -> CarnageCrimeVault (T22 token account)
  - ["carnage_fraud_vault"] -> CarnageFraudVault (T22 token account)
```

### Step 19: Whitelist Carnage Token Vaults

Whitelists `CarnageCrimeVault` and `CarnageFraudVault` so that Carnage execution can transfer tokens through the hook.

### Step 20: Fund Carnage SOL Vault

Transfers the rent-exempt minimum (~890,880 lamports) to the CarnageSolVault PDA. This ensures the system account remains active.

### Step 21: Create Carnage WSOL Account

Creates a WSOL (SPL Token, NOT Token-2022) account owned by the CarnageSigner PDA. This account is used by `execute_carnage_atomic` for swap_exempt CPI calls.

- Uses an explicit Keypair (persisted to `keypairs/carnage-wsol.json`) because ATAs reject off-curve (PDA) owners
- Funded with 0 lamports initial (actual SOL funded per-swap from sol_vault)
- Owner: CarnageSigner PDA (`["carnage_signer"]` on Epoch Program)

### Step 22: Initialize WSOL Intermediary

```
Instruction: initializeWsolIntermediary()
PDA: ["wsol_intermediary"] on Tax Program -> WsolIntermediary
Owner: SwapAuthority PDA (["swap_authority"] on Tax Program)
```

This is the Phase 48 addition. Creates the protocol-owned WSOL token account used for sell tax extraction. The intermediary holds tax-portion WSOL during the sell flow's transfer-close-distribute-reinit cycle, eliminating the requirement for sellers to hold native SOL equal to the tax amount.

| PDA | Devnet Address |
|-----|---------------|
| WsolIntermediary | `6naDnJUC2GJbrrFbXo7d3LBVqRfzkEwmUgf2DhVdEZbY` |
| SwapAuthority (owner) | `H7Xwvze9D3oJQvj7YQwmQ6aoNF6WfkyUATSW4omJAg3f` |

### Step 23: Generate PDA Manifest

Generates `scripts/deploy/pda-manifest.json` and `scripts/deploy/pda-manifest.md` containing all program IDs, mint addresses, PDA addresses, and pool configurations. This is the single source of truth for all deployed addresses.

---

## Pool Creation & Liquidity Seeding

Pool initialization is handled by Steps 7-8 of the initialize script (SOL pools only). Conversion vault initialization is handled by Steps 9-13. Key details:

### Canonical Mint Ordering

The AMM uses canonical ordering: smaller pubkey = mintA, larger = mintB. This ensures deterministic pool PDA derivation regardless of the order mints are provided.

### Seed Liquidity Amounts (Devnet)

| Pool / Vault | Side A | Side B |
|------|--------|--------|
| CRIME/SOL | 2 SOL (2,000,000,000 lamports) | 20,000 CRIME (20,000,000,000 base units) |
| FRAUD/SOL | 2 SOL (2,000,000,000 lamports) | 20,000 FRAUD (20,000,000,000 base units) |
| Conversion Vault | 10,000 CRIME + 10,000 FRAUD | 1,000 PROFIT |

### Mainnet Pool Seeding

On mainnet, pools are seeded with the full bonding curve proceeds (Decision: Token Model D7):

```
SOL pools: 290M tokens + 500 SOL per pool (bonding curve raises 500 SOL per token)
Conversion vault: 250M CRIME + 250M FRAUD + 20M PROFIT (replaces former PROFIT AMM pools)
```

<!-- RECONCILIATION_FLAG: Devnet seed amounts are placeholder values for testing. Mainnet amounts depend on bonding curve completion and should match Docs/Bonding_Curve_Spec.md Section 3.1 token allocation exactly. Conversion vault replaces PROFIT AMM pools with fixed 100:1 rate (250M CRIME + 250M FRAUD + 20M PROFIT on mainnet). -->

---

## Transfer Hook Whitelist Setup

The Transfer Hook program enforces a whitelist: every `transfer_checked` call checks that at least one party (source OR destination) is whitelisted. The complete whitelist after initialization:

| Entry | Address Purpose | Step Created |
|-------|----------------|-------------|
| 1-3 | Admin CRIME/FRAUD/PROFIT token accounts | Step 6 |
| 4-6 | Vault token accounts (vault_crime, vault_fraud, vault_profit) | Step 13 |
| 7-10 | Pool vaults (2 SOL pools x 2 vaults each) | Step 14 |
| 11 | StakeVault | Step 17 |
| 12 | CarnageCrimeVault | Step 19 |
| 13 | CarnageFraudVault | Step 19 |

**Total: 13 whitelist entries** (verified by deploy report: 10 permanent + 3 admin ephemeral)

Why only protocol accounts need whitelisting: The hook checks source OR destination. Since every legitimate transfer involves at least one protocol account (pool vault, staking vault, carnage vault), user accounts never need individual whitelist entries.

---

## WSOL Intermediary Setup

### Background (Phase 48)

Before Phase 48, sell tax was deducted from the user's native SOL balance via `system_instruction::transfer`. This created a mainnet blocker: any user with tokens but <0.05 SOL native could not sell.

### Solution: Transfer-Close-Distribute-Reinit Pattern

The sell flow now:

1. **Transfer**: User's WSOL (from AMM swap output) -> WSOL intermediary (tax_amount)
2. **Close**: Close intermediary -> SwapAuthority (unwraps WSOL to native SOL)
3. **Distribute**: SwapAuthority sends native SOL to 3 destinations (71% staking, 24% carnage, 5% treasury)
4. **Reinit**: Recreate intermediary at same PDA address (rent lamports recycled from close)

### Initialization

The WSOL intermediary is created once during deployment (Step 22) via `initializeWsolIntermediary`:

```
Admin (payer) -> system_instruction::create_account at PDA
                 -> InitializeAccount3 (discriminator 18) with owner = SwapAuthority PDA
```

The intermediary is a PDA of the Tax Program, so only the Tax Program can sign for its creation via `invoke_signed`. This is why it requires a dedicated initialization instruction rather than client-side creation.

### IDL Impact

The `SwapSolSell` accounts struct now includes `wsolIntermediary` (21 named accounts, up from 20). All sell transactions must include this account.

---

## Address Lookup Table (ALT) Setup

### Why ALTs Are Required

The `execute_carnage_atomic` instruction uses 23+ named accounts plus up to 8 Transfer Hook remaining_accounts (4 per mint: `[extraAccountMetaList, whitelistSource, whitelistDest, hookProgram]`). This exceeds Solana's 1232-byte legacy transaction limit.

An ALT compresses account pubkeys from 32 bytes to 1 byte each in VersionedTransaction (v0) format. On-chain programs are unaffected -- ALTs are purely a client-side wire format optimization.

### ALT Creation Process

ALT is created by `scripts/e2e/lib/alt-helper.ts`:

```typescript
const alt = await getOrCreateProtocolALT(provider, manifest);
// Then use: TransactionMessage.compileToV0Message([alt])
```

The helper:
1. Collects all static protocol addresses (47 addresses for devnet)
2. Checks for a cached ALT address at `scripts/deploy/alt-address.json`
3. If cached ALT exists and has all needed addresses, loads and returns it
4. If missing addresses, extends the existing ALT
5. If no ALT exists, creates a new one, extends in batches of 30, waits for activation

### Addresses in the ALT

The ALT contains:

| Category | Count | Details |
|----------|-------|---------|
| Programs | 6 | AMM, Hook, Tax, Epoch, Staking, Conversion Vault |
| Well-known programs | 3 | SPL Token, Token-2022, System Program |
| Mints | 4 | CRIME, FRAUD, PROFIT, WSOL (NATIVE_MINT) |
| Epoch/Carnage PDAs | 7 | EpochState, CarnageFund, CarnageSolVault, CarnageCrimeVault, CarnageFraudVault, CarnageSigner, Carnage WSOL account |
| Tax/AMM PDAs | 4 | SwapAuthority, TaxAuthority, AdminConfig, WsolIntermediary |
| Staking PDAs | 4 | StakingAuthority, StakePool, EscrowVault, StakeVault |
| Transfer Hook PDAs | 4 | WhitelistAuthority, ExtraAccountMetaList x3 |
| Pool accounts | 6 | 2 SOL pools x (pool + vaultA + vaultB) |
| Vault accounts | 4 | VaultConfig + vault_crime + vault_fraud + vault_profit |
| Whitelist PDAs | 4 | For Carnage-involved token accounts |
| **Total** | **~46** | Deduplicated |

### ALT Cache

```json
{
  "altAddress": "4rW2yu8sJujQ7JUwUAom2UyYzhwpJQfJj7BLRucHzah6",
  "createdAt": "2026-02-20T14:41:29.508Z",
  "addressCount": 47,
  "network": "devnet"
}
```

Persisted to `scripts/deploy/alt-address.json`. The shared constant is `DEVNET_ALT` in `shared/programs.ts`.

### v0 Transaction Patterns

All transactions using the ALT must use VersionedTransaction v0:

```typescript
const messageV0 = new TransactionMessage({
  payerKey: payer,
  recentBlockhash: blockhash,
  instructions,
}).compileToV0Message([alt]);

const vtx = new VersionedTransaction(messageV0);
vtx.sign(signers);

const txSig = await connection.sendTransaction(vtx, {
  skipPreflight: true,  // Required: devnet simulation rejects v0 TX
  maxRetries: 3,
});
```

**Critical**: With `skipPreflight: true`, failed transactions are still "confirmed" on Solana. Always check `confirmation.value.err` after confirmation. Wait 2 seconds before reading state (RPC propagation delay).

### ALT Cost

- Creation: ~0.003 SOL rent
- Persists indefinitely
- Reusable by any caller (permissionless Carnage bots, frontend, etc.)
- One ALT per network (devnet, mainnet)

### Dual-Hook Ordering for remaining_accounts

When building transactions that involve two T22 mints (e.g., Conversion Vault operations or any future PureT22Pool), the AMM splits `remaining_accounts` as **[INPUT hook accounts, OUTPUT hook accounts]**, NOT [side A, side B].

This means:
- **Buy (AtoB)**: input=A, output=B -> send `[A hooks, B hooks]`
- **Sell (BtoA)**: input=B, output=A -> send `[B hooks, A hooks]`

Getting this wrong causes Transfer Hook error **3005** (`AccountNotEnoughKeys`) because the wrong `extra_account_meta_list` PDA is passed to Token-2022's hook invocation.

Each mint's hook accounts are always 4 entries: `[extraAccountMetaList, whitelistSource, whitelistDest, hookProgramId]`. So for dual-T22 pools, `remaining_accounts` has exactly 8 entries.

---

## Bonding Curve Launch

The bonding curve is the protocol's entry point for mainnet. Two identical curves (CRIME and FRAUD) launch simultaneously. The bonding curve program (7th program, `AGhdAzP6Hcf3hmib79MdFbMMF5xjzTUEShB7hsTa62K1`) was shipped in v1.2 with 13.5M proptest iterations and 28/28 requirements verified.

### Parameters (from Bonding Curve Spec)

| Parameter | Value |
|-----------|-------|
| Tokens for sale (per token) | 460,000,000 (46% of supply) |
| Target SOL raise (per token) | 500 SOL |
| Start price | 0.00000045 SOL/token |
| End price | 0.000001725 SOL/token |
| Price increase | ~3.83x across curve |
| Deadline | 48 hours from launch |
| Refund mechanism | Claim-based if deadline expires |

### Token Allocation (Per Token)

| Allocation | Amount | Percentage |
|------------|--------|------------|
| Bonding Curve Sale | 460,000,000 | 46% |
| SOL Pool Seeding | 290,000,000 | 29% |
| Conversion Vault Seeding | 250,000,000 | 25% |

### Post-Curve Transition

Upon curve completion:
1. Bonding curve proceeds (500 SOL) flow to SOL pool seeding
2. SOL pools seeded: 290M tokens + 500 SOL (price = 0.000001725 SOL/token, matching curve end price)
3. Conversion Vault seeded: 250M CRIME + 250M FRAUD + 20M PROFIT (fixed 100:1 rate)
4. Normal trading begins via Tax Program swap instructions

---

## Authority Burn Sequence

The authority burn is the protocol's path to full immutability. It proceeds in stages to allow verification at each step. This sequence implements decisions from Architecture D2 (full immutability), Security D3-D5 (burn order), and Architecture D3 (tiered timelock).

### Prerequisite: Triple Verification

Before ANY burn:
1. All tests pass (staking, token-flow, security, cross-program integration, proptests)
2. Devnet deployment fully validated (36/36 verification checks passing)
3. SVK audit findings resolved or accepted

### Burn Order (Security D5)

```
Deploy -> Create Pools -> Whitelist All Entries -> Verify ->
  Burn Whitelist Authority -> Burn AMM Admin ->
    Tiered Timelock (2hr -> 24hr -> burn) ->
      Burn All 6 Upgrade Authorities
```

### Whitelist Authority Burn

**What it does**: Sets `WhitelistAuthority.authority` to `None`, making the whitelist permanently immutable. No new entries can be added.

**When to execute**: After ALL whitelist entries are confirmed correct (13 entries on devnet).

**Instruction**:
```
Program: Transfer Hook (CmNyuLdMeggHS2dKBhzPWHdeTEcpKg4uTevT5tBcBsce)
Instruction: burn_authority()
Signer: Current whitelist authority (admin wallet)
Effect: WhitelistAuthority.authority = None
Idempotent: Yes (calling on already-burned authority succeeds silently)
Event emitted: AuthorityBurned { burned_by, timestamp }
```

**Verification after burn**:
- `addWhitelistEntry()` calls fail with `AuthorityAlreadyBurned`
- All existing whitelist entries remain functional
- All swap, stake, unstake, Carnage operations continue working

### AMM Admin Burn

**What it does**: Sets `AdminConfig.admin` to `Pubkey::default()`, permanently disabling pool creation.

**When to execute**: After all 2 pools and the Conversion Vault are initialized and verified.

**Instruction**:
```
Program: AMM (5ANTHFtgPgH1fUMywALtrpmT7uMHfWnFbz7hxY3tLzMj)
Instruction: burn_admin()
Signer: Current admin (must match admin_config.admin)
Effect: admin_config.admin = Pubkey::default()
Irreversible: Yes
Event emitted: AdminBurned { burned_by, slot }
```

**Verification after burn**:
- `initializePool()` fails with `Unauthorized` (has_one = admin constraint)
- All existing pool operations (swaps) continue working

### Tiered Timelock

**Architecture Decision D3**: The upgrade authority transitions through three stages:

| Stage | Duration | Purpose |
|-------|----------|---------|
| **2-hour timelock** | First 48-72 hours | Rapid patching if critical bugs found post-launch (Architecture D3) |
| **24-hour timelock** | After 48-72 hours until burn | Community has time to review proposed changes |
| **Burn** | Permanent | Full immutability (Architecture D2) |

**Implementation**: Squads Multisig (2-of-3) with configurable timelock. The timelock duration is adjusted at each stage via a Squads governance proposal.

### Upgrade Authority Burn

**What it does**: Burns the upgrade authority for all 6 programs, making them permanently immutable.

**When to execute**: After sufficient mainnet observation with no critical issues (tiered timelock transitions from 2hr to 24hr after 48-72 hours per Architecture D3).

**Process** (for each of the 6 programs):

```bash
solana program set-upgrade-authority <PROGRAM_ID> --final --keypair <AUTHORITY_KEYPAIR>
```

With Squads multisig, this is executed as a governance proposal that all signers must approve.

**Order**: All 6 programs should be burned in the same session:
1. AMM (`5ANTHFtgPgH1fUMywALtrpmT7uMHfWnFbz7hxY3tLzMj`)
2. Transfer Hook (`CmNyuLdMeggHS2dKBhzPWHdeTEcpKg4uTevT5tBcBsce`)
3. Tax Program (`DRjNCjt4tfTisSJXD1VrAduKbgA7KHuGPoYwxrUQN8uj`)
4. Epoch Program (`G6dmJTdC36VRqqi57QhWH444Ju7ieCzHZW9yhH7TpUhz`)
5. Staking (`EZFeU613CfqzNcEumE293QDmimRHyP2ZNWcbTgCQRZSu`)
6. Conversion Vault (`6WwVAc12B5x8gukgNyXa4agUyvi9PxdYTdPdnb9qEWFL`)

**Verification after burn**:
```bash
solana program show <PROGRAM_ID> --url <CLUSTER_URL>
# Should show: Upgrade Authority: None
```

---

## Post-Deployment Verification

### Automated Verification (`scripts/deploy/verify.ts`)

The verification script performs 36 checks across 10 categories:

| Category | Checks | Details |
|----------|--------|---------|
| Programs | 6 | Deployed, executable, BPF Loader Upgradeable owner |
| Mints | 3 | Exists, decimals=6, supply>0, T22 owner, TransferHook extension |
| Transfer Hook | 4 | WhitelistAuthority + 3 ExtraAccountMetaLists |
| AMM | 3 | AdminConfig + 2 SOL pools (reserveA>0, reserveB>0) |
| Vault | 4 | VaultConfig + 3 vault token accounts (vault_crime, vault_fraud, vault_profit) |
| Epoch | 3 | EpochState, CarnageFund, CarnageSolVault (>0 lamports) |
| Staking | 3 | StakePool, StakeVault (balance >= MINIMUM_STAKE), EscrowVault |
| Whitelist | 10 | 4 pool vaults + 3 vault token accounts + StakeVault + 2 Carnage vaults |
| **Total** | **36** | All must pass |

Run:
```bash
CLUSTER_URL=https://api.devnet.solana.com npx tsx scripts/deploy/verify.ts
```

Output: `scripts/deploy/deployment-report.md` with pass/fail results table.

### Manual Verification Checklist

After automated verification passes:

- [ ] Confirm all 3 mints have metadata (check explorer: name, symbol, URI)
- [ ] Execute a test swap on each of the 2 SOL pools (buy + sell direction)
- [ ] Execute a test conversion on the Conversion Vault (CRIME->PROFIT and FRAUD->PROFIT)
- [ ] Execute a test stake + unstake cycle
- [ ] Trigger an epoch transition via VRF crank
- [ ] Trigger a Carnage execution (all 3 paths: BuyOnly, Burn, Sell)
- [ ] Confirm WSOL intermediary survives a sell swap (recreated correctly)
- [ ] Confirm ALT is active and has all expected addresses

---

## Mainnet-Specific Steps

### 1. Shared Constants Migration

All devnet-specific constants must be updated for mainnet. The mainnet checklist (`Docs/mainnet-checklist.md`) tracks each item:

| Constant | Current (Devnet) | Mainnet Action |
|----------|-----------------|----------------|
| `PROGRAM_IDS` | Devnet program IDs | Redeploy to mainnet, update all 6 IDs |
| `MINTS` | Devnet mint addresses | Create mainnet mints, update 3 addresses |
| `DEVNET_PDAS` / `DEVNET_PDAS_EXTENDED` | Devnet PDA addresses | Re-derive from mainnet program IDs |
| `DEVNET_POOL_CONFIGS` | Devnet pool + vault addresses | Create mainnet pools, update |
| `DEVNET_ALT` | `4rW2yu8sJujQ7JUwUAom2UyYzhwpJQfJj7BLRucHzah6` (48 addresses) | Create mainnet ALT |
| `DEVNET_RPC_URL` | Helius devnet endpoint | Mainnet RPC (Helius/Triton) |
| `TREASURY_PUBKEY` | `8kPzhQ...` (devnet wallet) | Mainnet treasury multisig |
| `HELIUS_API_KEY` | Free-tier key | Production Helius key |

Recommended: Rename `DEVNET_*` constants to environment-aware names driven by `NEXT_PUBLIC_SOLANA_CLUSTER` env var.

### 2. Frontend Configuration

| File | Change |
|------|--------|
| `app/providers/providers.tsx` | `config.solana.rpcs` cluster key: `devnet` -> `mainnet-beta` |
| `app/hooks/useProtocolWallet.ts` | `chain` parameter: `"solana:devnet"` -> `"solana:mainnet"` |
| `app/components/swap/SwapStatus.tsx` | Remove `?cluster=devnet` from explorer links |
| `app/components/dashboard/CarnageCard.tsx` | Remove `?cluster=devnet` from explorer links |
| `app/components/wallet/BalanceDisplay.tsx` | Remove devnet faucet link |
| `app/lib/connection.ts` | `NEXT_PUBLIC_RPC_URL` env var -> mainnet RPC |

### 3. Token Metadata

| Item | Devnet | Mainnet |
|------|--------|---------|
| Token names | CRIME, FRAUD, PROFIT | Final branded names (if different) |
| Metadata URIs | Railway placeholder endpoints | Production endpoints with logos, descriptions, socials |
| Token logos | None | Design and upload final token logos |

### 4. Squads Multisig Setup

Before mainnet deployment:

1. Create Squads multisig (2-of-3 threshold, determine signer set)
2. Transfer upgrade authority for all 6 programs:
   ```bash
   solana program set-upgrade-authority <PROGRAM_ID> \
     --new-upgrade-authority <SQUADS_MULTISIG> \
     --keypair <CURRENT_AUTHORITY>
   ```
3. Separate admin roles: different keys for upgrade authority, AMM admin, whitelist authority
4. Remove keypair files from repository (move to secure vault)
5. Verify on-chain: `solana program show <PROGRAM_ID>` shows multisig as upgrade authority

### 5. Priority Fees

<!-- NEEDS_VERIFICATION: mainnet-priority-fee-vs-bounty-economics -- The optimal priority fee for mainnet transactions needs analysis against Carnage bounty economics. Too high = erodes bounty profitability for permissionless keepers. Too low = transactions fail to land during congestion. -->

Mainnet transactions need priority fees for reliable landing. The deploy script already uses `--with-compute-unit-price 1` (minimal). Production transactions may need dynamic priority fees based on network congestion.

### 6. Crank Bot SOL Budget

**Operations Decision D3**: The crank bot needs 1 SOL manual seed on mainnet. Unlike devnet, there is no faucet. The continuous runner's estimated cost is ~1.5-3 SOL/day.

### 7. Sensitive Data Rotation for Mainnet

Before going live on mainnet, rotate or verify all sensitive configuration:

| Item | Location | Action |
|------|----------|--------|
| `.mcp.json` API keys | `.mcp.json` (gitignored) | Generate fresh keys; revoke devnet keys |
| Helius API key | `.env` / `HELIUS_API_KEY` | Upgrade from free-tier to production plan |
| RPC endpoint | `.env` / `NEXT_PUBLIC_RPC_URL` | Switch to mainnet RPC with rate-limit headroom |
| Railway env vars | Railway dashboard | Mirror `.env` changes to production deployment |
| Webhook secrets | Sentry DSN, monitoring hooks | Verify all monitoring points to production |
| Devnet keypairs | `keypairs/` directory | Generate ALL fresh keypairs for mainnet -- never reuse devnet keys |
| Program binaries | `target/deploy/*.so` | Rebuild WITHOUT `--devnet` flag before mainnet deploy |

**RPC proxy consideration**: For mainnet frontend, implement a backend proxy for RPC calls to avoid exposing the Helius API key in client-side JavaScript (`NEXT_PUBLIC_RPC_URL` is visible in the browser bundle).

---

## Environment Configuration (Devnet vs Mainnet)

### Environment Variables

| Variable | Devnet Value | Mainnet Value |
|----------|-------------|--------------|
| `CLUSTER_URL` | `https://api.devnet.solana.com` or Helius devnet | Helius/Triton mainnet endpoint |
| `NEXT_PUBLIC_RPC_URL` | Same as above | Mainnet RPC endpoint (behind proxy) |
| `NEXT_PUBLIC_SOLANA_CLUSTER` | `devnet` | `mainnet-beta` |
| `WALLET` | `keypairs/devnet-wallet.json` | Hardware wallet or Squads multisig path |
| `HELIUS_API_KEY` | Free-tier key | Production key |

### Feature Flags

Two programs use the `devnet` feature flag:

**Epoch Program** (`programs/epoch-program/Cargo.toml`):
```toml
[features]
default = []
devnet = []
```
Controls: Switchboard program ID selection, `SLOTS_PER_EPOCH` (750 devnet / 4500 mainnet).

**Tax Program** (`programs/tax-program/Cargo.toml`):
```toml
[features]
default = []
devnet = []
```
Controls: `treasury_pubkey()` return value (devnet wallet vs mainnet treasury).

### Build Commands

| Target | Command |
|--------|---------|
| Localnet (testing) | `anchor build` |
| Devnet | `./scripts/deploy/build.sh --devnet` |
| Mainnet | `./scripts/deploy/build.sh` (no --devnet flag) |

### Cluster URLs

| Environment | URL | Notes |
|-------------|-----|-------|
| Localnet | `http://localhost:8899` | Default if no URL specified |
| Devnet | `https://api.devnet.solana.com` | Or Helius devnet endpoint |
| Mainnet | `https://api.mainnet-beta.solana.com` | Or Helius/Triton mainnet endpoint |

---

## Rollback Plan

### Program Rollback (Pre-Burn)

While upgrade authority is held (before the final burn):

1. Identify the last known-good program binary (from build logs or git tag)
2. Rebuild from that commit: `git checkout <commit> && ./scripts/deploy/build.sh`
3. Redeploy: `./scripts/deploy/deploy.sh <CLUSTER_URL>`

With Squads multisig, the rollback deploy requires the timelock period (2hr or 24hr depending on stage).

### Program Rollback (Post-Burn)

**Not possible.** After upgrade authority is burned, programs are permanently immutable. This is by design (Architecture D2). The tiered timelock ensures sufficient testing time before the irreversible burn.

### Account State Rollback

Account state (pools, epoch state, carnage fund) cannot be "rolled back" to a previous state. However:

- **Pools**: Pool reserves change via swaps, not via admin action. There is no rollback mechanism.
- **EpochState**: Epochs advance forward only. VRF timeout recovery creates fresh randomness.
- **Whitelist**: Once the whitelist authority is burned, entries are permanent. Before burn, invalid entries can be managed by the authority.

### ALT Rollback

ALTs can be deactivated and closed by their authority (the wallet that created them). A new ALT can be created and cached at any time. All callers need to be updated to reference the new ALT address.

### Emergency Procedures

1. **Pause mechanism**: The protocol does not have an on-chain pause mechanism. If a critical issue is found pre-burn, the upgrade authority can deploy a patched version.
2. **Crank bot halt**: Stop the continuous runner script. Epochs will not advance, Carnage will not execute. Trading via the Tax Program continues independently.
3. **Frontend disable**: Update the Railway deployment to show a maintenance page. On-chain operations remain possible via direct program interaction.

---

## PDA Seeds Reference

| PDA | Seeds | Program | Devnet Address |
|-----|-------|---------|---------------|
| AdminConfig | `["admin"]` | AMM | `CggwKL3RH7k2PkWuFce6cPo1Hna428kD6SLxgSuPSyE9` |
| PoolState | `["pool", mintA, mintB]` | AMM | (per pool) |
| VaultA | `["vault", pool, "a"]` | AMM | (per pool) |
| VaultB | `["vault", pool, "b"]` | AMM | (per pool) |
| SwapAuthority | `["swap_authority"]` | Tax Program | `H7Xwvze9D3oJQvj7YQwmQ6aoNF6WfkyUATSW4omJAg3f` |
| TaxAuthority | `["tax_authority"]` | Tax Program | `HPsxLbXMgDfjsYeTHznKKg51g4sUaymFGx3ExW82avUg` |
| WsolIntermediary | `["wsol_intermediary"]` | Tax Program | `6naDnJUC2GJbrrFbXo7d3LBVqRfzkEwmUgf2DhVdEZbY` |
| WhitelistAuthority | `["authority"]` | Transfer Hook | `23d4GXjahWZirY1JNYsVcFzQ2LurTJeoaDumRbzAfLi5` |
| WhitelistEntry | `["whitelist", address]` | Transfer Hook | (per entry) |
| ExtraAccountMetaList | `["extra-account-metas", mint]` | Transfer Hook | (per mint) |
| EpochState | `["epoch_state"]` | Epoch Program | `6716g7hsQiaPAf9jhXJ42HXrisAx8xMpifn6Yu4u15AS` |
| CarnageFund | `["carnage_fund"]` | Epoch Program | `HzfNk1XkqUADxDZeUvsKNoEXYSFHieAZ738zgT3vtwUn` |
| CarnageSolVault | `["carnage_sol_vault"]` | Epoch Program | `6EB2aqpvpBRBii9XRjJrYDiYqbqcDzeLGybdwoN49rZU` |
| CarnageCrimeVault | `["carnage_crime_vault"]` | Epoch Program | `6XobYqTbcYnYQmqiyPbRR9JZQ5tqQpikm9EcQCwtsp9Y` |
| CarnageFraudVault | `["carnage_fraud_vault"]` | Epoch Program | `HkQBL2sGSMmzFXFqBboenh79yMGnPJdazcFNRoJfMiED` |
| CarnageSigner | `["carnage_signer"]` | Epoch Program | `3TWM6Yu6VjSAbxZ4TPzNXwrAiZWmZRVr9W1xtbY3yBPi` |
| StakingAuthority | `["staking_authority"]` | Epoch Program | `WoWDFH1ErxDmNodwoyUwoxGSZsEcxgtcVwgKywYs8QH` |
| StakePool | `["stake_pool"]` | Staking | `G7FsjDYC2gQwFVAG5LGzCqrTWqbEzap2mxdRsBdLvoPK` |
| EscrowVault | `["escrow_vault"]` | Staking | `5qNMCWkJkuwx7RHG677LfkitJY3zcjnfxAoeTkimAAhU` |
| StakeVault | `["stake_vault"]` | Staking | `HesFcCQBj9AsZ5nRde9rDC7S7WHgR4K8V3sX7N2DP3cF` |
| VaultConfig | `["vault_config"]` | Conversion Vault | TBD (pending devnet deploy) |
| VaultCrime | `["vault_crime", vault_config]` | Conversion Vault | TBD (pending devnet deploy) |
| VaultFraud | `["vault_fraud", vault_config]` | Conversion Vault | TBD (pending devnet deploy) |
| VaultProfit | `["vault_profit", vault_config]` | Conversion Vault | TBD (pending devnet deploy) |

---

## Quick Reference: Command Cheatsheet

### Full Fresh Deployment (Devnet)

```bash
# 1. Source environment
source "$HOME/.cargo/env"
export PATH="/Users/mlbob/.local/share/solana/install/active_release/bin:$PATH"
export PATH="/opt/homebrew/bin:$PATH"

# 2. Full pipeline (build -> deploy -> initialize -> verify)
./scripts/deploy/deploy-all.sh https://api.devnet.solana.com

# 3. Create ALT (after initialization)
CLUSTER_URL=https://api.devnet.solana.com npx tsx scripts/e2e/lib/alt-helper.ts

# 4. Verify deployment report
cat scripts/deploy/deployment-report.md
```

### Rebuild + Redeploy Only (Devnet)

```bash
./scripts/deploy/build.sh --devnet
./scripts/deploy/deploy.sh https://api.devnet.solana.com
```

### Re-Initialize (Idempotent -- skips existing accounts)

```bash
CLUSTER_URL=https://api.devnet.solana.com npx tsx scripts/deploy/initialize.ts
```

### Verify Existing Deployment

```bash
CLUSTER_URL=https://api.devnet.solana.com npx tsx scripts/deploy/verify.ts
```

### Mainnet Deployment (Planned)

```bash
# 1. Build WITHOUT --devnet flag
./scripts/deploy/build.sh

# 2. Deploy with mainnet URL and production wallet
CLUSTER_URL=https://api.mainnet-beta.solana.com \
  WALLET=keypairs/mainnet-authority.json \
  ./scripts/deploy/deploy.sh

# 3. Initialize (same script, different cluster URL)
CLUSTER_URL=https://api.mainnet-beta.solana.com npx tsx scripts/deploy/initialize.ts

# 4. Verify
CLUSTER_URL=https://api.mainnet-beta.solana.com npx tsx scripts/deploy/verify.ts

# 5. Create mainnet ALT
CLUSTER_URL=https://api.mainnet-beta.solana.com npx tsx scripts/e2e/lib/alt-helper.ts

# 6. Transfer upgrade authority to Squads multisig (per program, all 6)
solana program set-upgrade-authority <PROGRAM_ID> \
  --new-upgrade-authority <SQUADS_MULTISIG> \
  --keypair keypairs/mainnet-authority.json
```

---

---

## Documentation Site Deployment

The Nextra docs site (`docs-site/`) is a separate Next.js 15 application with Pagefind search, deployed independently from the main app.

```bash
cd docs-site
npm install
npm run build     # Next.js build + Pagefind index generation (postbuild script)
npm run start     # Local preview
```

**Deployment target:** Vercel (free tier). The site is static content with no runtime dependencies. Connect the `docs-site/` directory as a separate Vercel project with root directory override. Build command: `npm run build`. Output directory: `.next`.

---

*Source files: `scripts/deploy/deploy-all.sh`, `scripts/deploy/build.sh`, `scripts/deploy/deploy.sh`, `scripts/deploy/initialize.ts`, `scripts/deploy/verify.ts`, `scripts/e2e/lib/alt-helper.ts`*
*Builds on: `Docs/Deployment_Sequence.md`, `Docs/mainnet-checklist.md`, `Docs/Bonding_Curve_Spec.md`*
*Decisions: Architecture D2-D4, Security D3-D5, Token Model D4/D7, Testing D5, Operations D3*
